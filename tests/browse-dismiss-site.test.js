/**
 * 浮窗自动收起 —— 站点级开关（v2.9.6）
 *
 * 用户需求（原话）：
 *   「社交媒体类型的网站都需要加上，默认是开启功能的，需要关闭时，在设置中单个网站
 *     单独设置。其他类型下的网站的可以加，但默认是关闭功能的，需要开启时，在设置中
 *     单个网站单独设置。加这些功能时，一定不能影响提取信息的功能。」
 *
 * 覆盖四块：
 *   A. site-config.resolve()：社交站默认开 / 其余站默认关 / 老配置迁移 / 站点覆盖
 *   B. browse-dismiss 的站点 watch 信号（抖音沉浸流地址不变、页面不滚，只有这条能抓到）
 *   C. wheel 补基线：弹层里第一次滚就生效（v2.9.4 会吞掉第一滚）
 *   D. 静态接线：三个 handler 的分叉、popup / 设置页 / 批量的入口
 *
 * 用法：node tests/browse-dismiss-site.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SRC = R('ClipMate_chrome/src/content/ui/browse-dismiss.js');
const SITES_SRC = R('ClipMate_chrome/src/shared/site-config.js');
const SCHEMA = R('ClipMate_chrome/src/shared/settings-schema.js');
const POPUP_HTML = R('ClipMate_chrome/src/popup/popup.html');
const POPUP_JS = R('ClipMate_chrome/src/popup/popup.js');
const OPTIONS_HTML = R('ClipMate_chrome/src/options/options.html');
const OPTIONS_JS = R('ClipMate_chrome/src/options/options.js');
const DOUYIN = R('ClipMate_chrome/src/content/ui/douyin-spa-handler.js');
const KUAISHOU = R('ClipMate_chrome/src/content/ui/kuaishou-spa-handler.js');
const IG = R('ClipMate_chrome/src/content/ui/ig-spa-handler.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? '：' + detail : ''));
}

function eq(name, got, want) {
  ok(name, got === want, `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`);
}

// ---------------- A. site-config.resolve ----------------

const SITES = require(path.join(ROOT, 'ClipMate_chrome/src/shared/site-config.js'));

(function () {
  // 社交 9 站默认开
  const social = ['weibo.com', 'www.bilibili.com', 'www.douyin.com', 'www.kuaishou.com',
    'www.xiaohongshu.com', 'x.com', 'www.instagram.com', 'www.youtube.com', 'www.tiktok.com'];
  social.forEach((h) => {
    eq(`社交站 ${h} 默认开`, SITES.resolve({}, h).autoDismiss, true);
  });

  // 其余站默认关（每组抽一个）
  const others = ['movie.douban.com', 'book.douban.com', 'www.themoviedb.org', 'www.imdb.com',
    'bgm.tv', 'www.qidian.com', 'www.douban.com', 'store.steampowered.com',
    'www.metacritic.com', 'www.mobygames.com'];
  others.forEach((h) => {
    eq(`非社交站 ${h} 默认关`, SITES.resolve({}, h).autoDismiss, false);
  });

  // 别名域名跟主站走
  eq('别名 m.weibo.cn 也算社交', SITES.resolve({}, 'm.weibo.cn').autoDismiss, true);
  eq('别名 bangumi.tv 属于影视（默认关）', SITES.resolve({}, 'bangumi.tv').autoDismiss, false);

  // 没收录的站：找不到类型 → 保守关
  eq('没收录的站默认关', SITES.resolve({}, 'example.com').autoDismiss, false);

  // 老配置迁移：v2.9.4 的全局开关明确 false = 全部关闭
  eq('老配置 autoDismiss=false → 社交站也关', SITES.resolve({ settings: { autoDismiss: false } }, 'weibo.com').autoDismiss, false);
  eq('老配置 autoDismiss=false → 非社交站关', SITES.resolve({ settings: { autoDismiss: false } }, 'movie.douban.com').autoDismiss, false);
  // true 不携带信息（那本来就是当时的默认值），交给类型判断
  eq('老配置 autoDismiss=true 不压类型默认（社交仍开）', SITES.resolve({ settings: { autoDismiss: true } }, 'weibo.com').autoDismiss, true);
  eq('老配置 autoDismiss=true 不压类型默认（非社交仍关）', SITES.resolve({ settings: { autoDismiss: true } }, 'movie.douban.com').autoDismiss, false);

  // 站点覆盖最高优先
  eq('站点覆盖：社交站可单独关', SITES.resolve({ siteOverrides: { 'weibo.com': { autoDismiss: false } } }, 'weibo.com').autoDismiss, false);
  eq('站点覆盖：非社交站可单独开', SITES.resolve({ siteOverrides: { 'movie.douban.com': { autoDismiss: true } } }, 'movie.douban.com').autoDismiss, true);

  // 上层域名继承
  eq('继承：book.douban.com 沿用 douban.com 的单独设置', SITES.resolve({ siteOverrides: { 'douban.com': { autoDismiss: true } } }, 'book.douban.com').autoDismiss, true);

  // autoDismissDefault 直接暴露（popup 未来要用也不必绕 resolve）
  eq('autoDismissDefault(weibo.com)=true', SITES.autoDismissDefault('weibo.com'), true);
  eq('autoDismissDefault(movie.douban.com)=false', SITES.autoDismissDefault('movie.douban.com'), false);

  // 别的项目不被顺手改坏
  const eff = SITES.resolve({}, 'weibo.com');
  eq('resolve 其他键不受影响：showButton', eff.showButton, true);
  eq('resolve 其他键不受影响：autoCopy', eff.autoCopy, false);
})();

// ---------------- B. 站点 watch 信号 ----------------

function makeEnv(options) {
  const opts = options || {};
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="page"></div></body></html>',
    { url: opts.url || 'https://weibo.com/detail/aaa111', runScripts: 'dangerously', pretendToBeVisual: true }
  );
  const { window } = dom;

  let clock = 1000000;
  window.Date.now = () => clock;
  const tick = (ms) => { clock += ms; };

  window.eval(SRC);
  const bd = window.ClipMateBrowseDismiss;

  const fwEl = window.document.createElement('div');
  fwEl.id = 'media-info-floating-window';
  window.document.body.appendChild(fwEl);

  const state = { closed: 0 };
  const host = {
    isOpen: true,
    isEditMode: !!opts.isEditMode,
    floatingWindow: { windowElement: fwEl },
    close() {
      state.closed++;
      this.isOpen = false;
      if (window.ClipMateBrowseDismiss) window.ClipMateBrowseDismiss.disarm();
    }
  };

  /** 桩一个站点 context：arm 会被订阅，emit 手动触发回调 */
  function stubProvider(name, initialWorkId) {
    let cb = null;
    const api = {
      getWorkId: () => (initialWorkId == null ? '' : String(initialWorkId)),
      watch: function (fn) { cb = fn; return function () { cb = null; }; }
    };
    window[name] = api;
    return {
      emit(evt) { if (cb) cb(evt); },
      hasListener: () => cb !== null
    };
  }

  function cleanup() {
    try { bd.disarm(); } catch (e) { /* 忽略 */ }
    try { dom.window.close(); } catch (e) { /* 忽略 */ }
  }

  return { dom, window, bd, host, state, tick, stubProvider, fwEl, cleanup };
}

(function () {
  // arm 时 getWorkId 有值 → 作为基线；watch 立刻回调同一条 → 不关
  const e = makeEnv({ url: 'https://www.douyin.com/follow' });
  const p = e.stubProvider('DouyinModalContext', 'AAA111');
  e.bd.arm(e.host);
  ok('arm 后订阅了站点 watch', p.hasListener());
  e.tick(400);
  p.emit({ id: 'AAA111', opened: true, mode: 'immersive' });
  eq('同一条作品回调 → 不关', e.state.closed, 0);

  p.emit({ id: 'BBB222', opened: true, mode: 'immersive' });
  eq('换成另一条 → 关窗', e.state.closed, 1);

  // 关窗（close 里 disarm）后再来事件必须安静
  p.emit({ id: 'CCC333', opened: true, mode: 'immersive' });
  eq('disarm 后站点信号不再关窗', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // 基线为空（抖音弹层刚开、信息区还没渲染）：首个非空 id 只当基线
  const e = makeEnv({ url: 'https://www.douyin.com/follow' });
  const p = e.stubProvider('DouyinModalContext', '');
  e.bd.arm(e.host);
  ok('getWorkId 为空时也订阅了 watch', p.hasListener());
  e.tick(400);

  p.emit({ id: 'AAA111', opened: true, mode: 'modal' });
  eq('首个认出的作品只记基线 → 不关（防「认出来」被当成「换了一条」）', e.state.closed, 0);

  p.emit({ id: 'AAA111', opened: true, mode: 'modal' });
  eq('同一条再回调 → 仍不关', e.state.closed, 0);

  p.emit({ id: 'BBB222', opened: true, mode: 'modal' });
  eq('之后真换了一条 → 关', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // 宽限期内换条 → 不关（防开窗瞬间的抖动）
  const e = makeEnv({ url: 'https://www.kuaishou.com/new-reco' });
  const p = e.stubProvider('KuaishouImmersiveContext', 'K1');
  e.bd.arm(e.host);
  p.emit({ id: '', opened: false, mode: '' });   // opened=false 永远不管
  p.emit(null);                                   // 空事件不管
  e.host.isOpen = false;                          // 宽限期内的空 ID 也不许关
  p.emit({ id: '', opened: true, mode: 'immersive' });
  e.host.isOpen = true;
  p.emit({ id: 'K2', opened: true, mode: 'immersive' }); // 还在 350ms 内
  eq('宽限期内换条 → 不关', e.state.closed, 0);

  e.tick(400);
  p.emit({ id: 'K3', opened: true, mode: 'immersive' });
  eq('过宽限期换条 → 关', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // v2.9.6 真机（2026-11-03）：抖音从视频切到直播时事件是 {id:'', opened:true}，
  // 浮窗会挂着旧作品数据挡在直播上。抖音/快手 context 的 pending 保护保证
  // 「切视频的 0.9s 空窗」不发空 ID 事件 → 稳定收到的空 ID = 停在直播上。
  const e = makeEnv({ url: 'https://www.kuaishou.com/new-reco' });
  const p = e.stubProvider('KuaishouImmersiveContext', 'K1');
  e.bd.arm(e.host);
  e.tick(400);

  p.emit({ id: '', opened: false, mode: '' });
  eq('离开播放态（opened=false）→ 不关（浮窗由站点自己收）', e.state.closed, 0);
  p.emit(null);
  eq('空事件 → 不关', e.state.closed, 0);

  p.emit({ id: '', opened: true, mode: 'immersive' });
  eq('切到直播（稳定空 ID）→ 关窗不留旧数据', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // 同样的空 ID，但浮窗没开 → 什么都不许做（尤其不许把 armed 状态搞乱）
  const e = makeEnv({ url: 'https://www.douyin.com/follow' });
  const p = e.stubProvider('DouyinModalContext', 'D1');
  e.host.isOpen = false;
  e.bd.arm(e.host);
  e.tick(400);
  p.emit({ id: '', opened: true, mode: 'immersive' });
  eq('浮窗没开时空 ID → 不关、不掉状态', e.state.closed, 0);

  e.host.isOpen = true;
  p.emit({ id: 'D2', opened: true, mode: 'immersive' });
  eq('空 ID 之后来真换条 → 照常关（armed 没被误拆）', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // 编辑模式 + 开关关闭，站点信号也必须让路
  const e = makeEnv({ url: 'https://www.douyin.com/follow', isEditMode: true });
  const p = e.stubProvider('DouyinModalContext', 'A1');
  e.bd.arm(e.host);
  e.tick(400);
  p.emit({ id: 'A2', opened: true, mode: 'immersive' });
  eq('编辑模式下换条 → 不关', e.state.closed, 0);

  e.bd.setEnabled(false);
  p.emit({ id: 'A3', opened: true, mode: 'immersive' });
  eq('开关关掉后换条 → 不关', e.state.closed, 0);
  eq('shouldCloseOnSwitch 跟着开关走', e.bd.shouldCloseOnSwitch(), false);

  e.bd.setEnabled(true);
  eq('重新开启后 shouldCloseOnSwitch=true', e.bd.shouldCloseOnSwitch(), true);
  e.cleanup();
})();

// ---------------- C. wheel 补基线（修首滚被吞） ----------------

(function () {
  const e = makeEnv({ url: 'https://www.xiaohongshu.com/explore/aaa111' });
  const box = e.window.document.createElement('div');
  box.id = 'note-detail';
  e.window.document.body.appendChild(box);
  // jsdom 没有布局，手工把「看起来能滚」撑出来
  Object.defineProperty(box, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 500, configurable: true });

  e.bd.arm(e.host);
  e.tick(400);

  // 用户第一滚：wheel 先来（真实浏览器顺序），随后 scroll
  box.dispatchEvent(new e.window.WheelEvent('wheel', { bubbles: true, deltaY: 300 }));
  box.scrollTop = 300;
  box.dispatchEvent(new e.window.Event('scroll'));
  eq('弹层里第一滚 300px 就关（v2.9.4 会把它整段吞掉）', e.state.closed, 1);
  e.cleanup();
})();

(function () {
  // 反向：没滚过的容器、wheel 也不算位移 —— wheel 只记基线，不触发关窗
  const e = makeEnv();
  const box = e.window.document.createElement('div');
  e.window.document.body.appendChild(box);
  Object.defineProperty(box, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(box, 'clientHeight', { value: 500, configurable: true });

  e.bd.arm(e.host);
  e.tick(400);
  box.dispatchEvent(new e.window.WheelEvent('wheel', { bubbles: true, deltaY: 900 }));
  eq('只有 wheel、没有真实滚动 → 不关', e.state.closed, 0);

  // 浮窗内部的 wheel 不补基线也不影响
  e.fwEl.dispatchEvent(new e.window.WheelEvent('wheel', { bubbles: true, deltaY: 500 }));
  eq('浮窗内的 wheel → 不关', e.state.closed, 0);
  e.cleanup();
})();

// ---------------- D. 静态接线 ----------------

ok('抖音 handler：换条时问过 shouldCloseOnSwitch',
  /shouldCloseOnSwitch\(\)/.test(DOUYIN) && /_closeDouyinPanelOnly\('换了下一条/.test(DOUYIN));

ok('快手 handler：换条时问过 shouldCloseOnSwitch',
  /shouldCloseOnSwitch\(\)/.test(KUAISHOU));

ok('IG handler：换帖时问过 shouldCloseOnSwitch',
  /shouldCloseOnSwitch\(\)/.test(IG));

ok('browse-dismiss 定义了 shouldCloseOnSwitch',
  /shouldCloseOnSwitch: function/.test(SRC));

ok('browse-dismiss 的信号源含抖音与快手 context',
  SRC.indexOf("'DouyinModalContext'") !== -1 && SRC.indexOf("'KuaishouImmersiveContext'") !== -1);

ok('豁免名单已清空（v2.9.6 不再让任何站自己管地址）',
  /var pathOwned = \[\];/.test(SRC) && SRC.indexOf("'xiaohongshu.com', 'instagram.com', 'kuaishou.com'") === -1);

ok('popup 有「换作品时收起浮窗」开关',
  POPUP_HTML.indexOf('siteAutoDismiss') !== -1 && POPUP_HTML.indexOf('换作品时收起浮窗') !== -1);

ok('popup 的 SITE_KEYS 含 autoDismiss（底部「已单独设置 N 项」才数得对）',
  /SITE_KEYS = \[[^\]]*'autoDismiss'[^\]]*\]/.test(POPUP_JS));

// v2.12.11：写盘快照统一抽到 site-config.siteSnapshot()，两处都调用它。
// 断言改成「调用点 + 快照里真的带 autoDismiss」，行为另有 popup-slim / settings-page 的写盘形状断言钉住。
ok('popup 写规则时快照带上 autoDismiss（否则改别的开关会把它弄丢）',
  /Sites\.siteSnapshot\(this\.config, this\.hostname, eff\)/.test(POPUP_JS) &&
  /autoDismiss: e\.autoDismiss/.test(SITES_SRC));

ok('设置页站点卡片渲染 autoDismiss（siteItems 会带上）',
  /writeSite\(site, item\.key, next\)/.test(OPTIONS_JS));

ok('设置页 writeSite / 批量快照都走统一函数且带 autoDismiss',
  (OPTIONS_JS.match(/SITES\.siteSnapshot\(/g) || []).length >= 3 &&
  /autoDismiss: e\.autoDismiss/.test(SITES_SRC));

ok('设置页批量入口有 dismiss-on / dismiss-off',
  OPTIONS_HTML.indexOf('dismiss-on') !== -1 && OPTIONS_HTML.indexOf('dismiss-off') !== -1 &&
  /which === 'dismiss-on'/.test(OPTIONS_JS));

ok('通用页隐藏 siteOnly 项',
  /SCHEMA\.ITEMS\.filter\(\(it\) => it\.group === group\.id && !it\.siteOnly\)/.test(OPTIONS_JS));

ok('schema 里 autoDismiss 标记为 siteOnly + 站点可覆盖',
  /key: 'autoDismiss'[\s\S]{0,560}siteOverridable: true[\s\S]{0,60}siteOnly: true/.test(SCHEMA));

// v2.11.4：判定从 refreshConfig 里抽成了 `_applyAutoDismiss`（豆瓣收藏列表页走不到
// refreshConfig，但同样需要滚动自动关）。所以不能再盯着那一行源码，要盯两件事：
//   ① refreshConfig 把 eff 交给这个方法（判据仍以 eff 为准，不直读全局键）
//   ② 判定只有一份实现 —— 方法定义 1 次 + 调用 2 次（refreshConfig / 列表页）≥ 3 次
{
  const CM = R('ClipMate_chrome/src/content/content-main.js');
  ok('content-main 把 eff 交给 _applyAutoDismiss（判据仍走 eff，不直读全局键）',
    /this\._applyAutoDismiss\(eff\)/.test(CM) &&
    /ClipMateBrowseDismiss\.setEnabled\(autoDismissOn\)/.test(CM));

  ok('自动收起的判定只有一份实现（refreshConfig 与豆瓣列表页共用）',
    /_applyAutoDismiss\(eff\)\s*\{/.test(CM) &&
    (CM.match(/_applyAutoDismiss\(/g) || []).length >= 3,
    '出现 ' + (CM.match(/_applyAutoDismiss\(/g) || []).length + ' 次');

  // feed 形态（豆瓣收藏三态）自行开启；用户显式设过则完全听用户
  ok('feed 形态会开自动收起，但用户显式设置优先',
    /e\.autoDismissExplicit\s*\?/.test(CM) &&
    /e\.autoDismiss === true \|\| feedShape/.test(CM));

  // 开窗宽限期：feed 形态放宽，其余站仍是 350ms
  ok('feed 形态的开窗宽限期单独放宽（抓完才弹窗，350ms 盖不住惯性滚动）',
    /setGlide\(feedShape \? ClipMateBrowseDismiss\.GLIDE_MS_FEED : 350\)/.test(CM) &&
    /GLIDE_MS_FEED = 1000/.test(R('ClipMate_chrome/src/content/ui/browse-dismiss.js')));
}

// ---------------- 汇总 ----------------

console.log('');
console.log(`browse-dismiss-site：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
