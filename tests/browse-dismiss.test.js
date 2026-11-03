/**
 * 浮窗自动收起（v2.9.4）
 *
 * 用户需求（原话）：
 *   「当我在首页点击小按钮弹出浮窗后，我再滚动几下鼠标，浮窗应该自己关闭。
 *     在弹层里切换作品时也要关闭，这样不会因为看下一条作品时，被浮窗挡住画面。」
 *
 * 两个信号：滚动累计 200px / pathname 变化。三个必须防住的误关：
 *   ① 浮窗自己的滚动（modal-table-renderer 每次刷新表格都会写 contentElement.scrollTop）
 *   ② 翻图（小红书 / 抖音只改 ?image_index=，pathname 不变）
 *   ③ 刚打开 350ms 内的惯性滚动
 *
 * 用法：node tests/browse-dismiss.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SRC = R('ClipMate_chrome/src/content/ui/browse-dismiss.js');
const MODAL_WINDOW = R('ClipMate_chrome/src/content/ui/modal-window.js');
const CONTENT_MAIN = R('ClipMate_chrome/src/content/content-main.js');
const MANIFEST = JSON.parse(R('ClipMate_chrome/manifest.json'));
const SCHEMA = R('ClipMate_chrome/src/shared/settings-schema.js');
const BACKGROUND = R('ClipMate_chrome/src/background/background.js');

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

// ---------------- 环境 ----------------

// 用微博做基准域名：它属于「站点自己没管换条判定」那一类，
// 本模块要在这里负责 pathname 信号（小红书 / 抖音等 5 站不负责，另有专门用例）
const START_URL = 'https://weibo.com/detail/aaa111';

function makeEnv(options) {
  const opts = options || {};
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="page"></div></body></html>',
    { url: opts.url || START_URL, runScripts: 'dangerously', pretendToBeVisual: true }
  );
  const { window } = dom;

  // 可控时钟
  let clock = 1000000;
  window.Date.now = () => clock;
  const tick = (ms) => { clock += ms; };

  window.eval(SRC);
  const bd = window.ClipMateBrowseDismiss;

  // 浮窗宿主（Shadow DOM host 在 jsdom 里就用普通元素代替 —— 判断逻辑走的是
  // 「target === host」这一支，跟真浏览器的 retarget 行为等价）
  const fwEl = window.document.createElement('div');
  fwEl.id = 'media-info-floating-window';
  window.document.body.appendChild(fwEl);

  const state = { closed: 0, reasons: [] };
  const host = {
    isOpen: true,
    isEditMode: !!opts.isEditMode,
    floatingWindow: { windowElement: fwEl },
    close() {
      state.closed++;
      this.isOpen = false;
      // 真实 close() 里也会 disarm，这里照做，保证「关一次之后不再重复关」
      if (window.ClipMateBrowseDismiss) window.ClipMateBrowseDismiss.disarm();
    }
  };

  function setScrollY(y) {
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
  }

  /** 整页滚动：dispatch 到 document（真浏览器里页面滚动的 target 就是 document） */
  function scrollPage(y) {
    setScrollY(y);
    window.document.dispatchEvent(new window.Event('scroll'));
  }

  /** 容器滚动（弹层内部）：改 scrollTop 后 dispatch 到容器本身 */
  function scrollBox(el, top) {
    el.scrollTop = top;
    el.dispatchEvent(new window.Event('scroll'));
  }

  function cleanup() {
    try { bd.disarm(); } catch (e) { /* 忽略 */ }
    try { dom.window.close(); } catch (e) { /* 忽略 */ }
  }

  return { dom, window, bd, host, state, tick, setScrollY, scrollPage, scrollBox, fwEl, cleanup };
}

// ============ 正例 1：整页滚满 200px 就关 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(400); // 越过 350ms 宽限期
  e.scrollPage(100);
  eq('整页滚 100px 还不关', e.state.closed, 0);
  e.scrollPage(210);
  eq('整页累计 210px → 关窗', e.state.closed, 1);
  e.cleanup();
})();

// ============ 正例 2：弹层容器内部滚动也累计 ============

(function () {
  const e = makeEnv();
  const box = e.window.document.createElement('div');
  box.id = 'note-detail';
  e.window.document.body.appendChild(box);

  e.bd.arm(e.host);
  e.tick(400);
  e.scrollBox(box, 60);          // 首见这个容器：只记基线，不累加
  eq('容器首次滚动只记基线，不关', e.state.closed, 0);
  e.scrollBox(box, 200);         // +140
  eq('容器累计 140px 还不关', e.state.closed, 0);
  e.scrollBox(box, 330);         // +130 → 累计 270
  eq('容器累计 270px → 关窗（弹层里滚动也能收）', e.state.closed, 1);
  e.cleanup();
})();

// ============ 正例 3：pathname 变化（换作品）就关 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(400);
  e.window.history.pushState({}, '', '/detail/bbb222');
  e.bd._checkPath();
  eq('pathname 变了 → 关窗', e.state.closed, 1);
  e.cleanup();
})();

// ============ 反例 1：没滚够 200px 不关 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(400);
  e.scrollPage(80);
  e.scrollPage(180);
  eq('只滚到 180px → 不关', e.state.closed, 0);
  e.cleanup();
})();

// ============ 反例 2：浮窗自己的滚动不算（最容易踩的坑） ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(400);
  // 模拟 modal-table-renderer 刷新表格时写 contentElement.scrollTop
  e.scrollBox(e.fwEl, 500);
  e.scrollBox(e.fwEl, 1200);
  eq('浮窗内滚动 1200px → 不关（否则点个刷新窗自己就没了）', e.state.closed, 0);

  // 再确认页面的滚动仍然照常生效 —— 排除逻辑不能把正常路径也废掉
  e.scrollPage(300);
  eq('排除浮窗后，页面滚动依然能关', e.state.closed, 1);
  e.cleanup();
})();

// ============ 反例 3：宽限期内不关 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(100); // 还没到 350ms
  e.scrollPage(400);
  eq('开窗 100ms 内滚 400px → 不关（防惯性滚动）', e.state.closed, 0);

  e.tick(400);
  e.scrollPage(650);
  eq('过了宽限期再滚 → 关', e.state.closed, 1);
  e.cleanup();
})();

// ============ 反例 4：编辑模式下完全不自动关 ============

(function () {
  const e = makeEnv({ isEditMode: true });
  e.bd.arm(e.host);
  e.tick(400);
  e.scrollPage(900);
  e.window.history.pushState({}, '', '/explore/ccc333');
  e.bd._checkPath();
  eq('编辑模式下滚动 + 换地址都不关', e.state.closed, 0);

  // 退出编辑模式后立刻恢复（实时读，不是 arm 时快照）
  e.host.isEditMode = false;
  e.scrollPage(1500);
  eq('退出编辑模式后滚动照常关', e.state.closed, 1);
  e.cleanup();
})();

// ============ 反例 5：翻图（只改 query）不关 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.tick(400);
  // 小红书 / 抖音切图：只改 ?image_index=，pathname 一个字不变
  e.window.history.pushState({}, '', '/detail/aaa111?image_index=2');
  e.bd._checkPath();
  eq('只改 ?image_index= → 不关（v2.5.95 定的规矩，翻图不是换作品）', e.state.closed, 0);

  e.window.history.pushState({}, '', '/detail/aaa111#comment');
  e.bd._checkPath();
  eq('只改 hash → 不关', e.state.closed, 0);
  e.cleanup();
})();

// ============ v2.9.6：豁免名单废除，全站统一由本模块判地址 ============

(function () {
  const SITES = [
    ['https://www.xiaohongshu.com/explore/aaa111', '小红书'],
    ['https://www.douyin.com/video/123', '抖音'],
    ['https://www.tiktok.com/@a/video/123', 'TikTok'],
    ['https://www.kuaishou.com/short-video/123', '快手'],
    ['https://www.instagram.com/p/abc/', 'Instagram']
  ];
  SITES.forEach(([url, name]) => {
    const e = makeEnv({ url });
    ok(`${name}：地址信号由本模块负责（v2.9.6 起不再豁免）`, e.bd.pathSignalEnabled() === true);

    e.bd.arm(e.host);
    ok(`${name}：启了地址轮询`, e.bd._pollTimer !== null);
    ok(`${name}：挂了 popstate`, e.bd._onPopState !== null);

    e.tick(400);
    const before = e.window.location.pathname;
    e.window.history.pushState({}, '', before + '-next');
    e.bd._checkPath();
    eq(`${name}：pathname 变了 → 本模块关窗`, e.state.closed, 1);
    e.cleanup();
  });

  // 抖音沉浸流：地址不变、页面不滚 —— 地址信号抓不到它，靠站点 watch（见 site 测试）
  const e2 = makeEnv({ url: 'https://www.douyin.com/follow' });
  e2.bd.arm(e2.host);
  e2.tick(400);
  e2.bd._checkPath();
  eq('抖音沉浸流地址不变 → 不误关', e2.state.closed, 0);
  e2.cleanup();
})();

// ============ declarePathOwner：将来新站接管地址信号只需一行 ============

(function () {
  const e = makeEnv(); // weibo.com，默认由本模块负责
  ok('微博默认由本模块判定地址', e.bd.pathSignalEnabled() === true);

  e.bd.arm(e.host);
  e.tick(400);
  ok('微博启了地址轮询', e.bd._pollTimer !== null);

  e.bd.declarePathOwner('weibo.com');
  ok('声明后微博不再由本模块判定', e.bd.pathSignalEnabled() === false);
  ok('声明后轮询立刻停掉', e.bd._pollTimer === null);

  e.window.history.pushState({}, '', '/detail/zzz');
  e.bd._checkPath();
  eq('声明后 pathname 变化不再关窗', e.state.closed, 0);
  e.cleanup();
})();

// ============ 反例 6：设置开关关掉后不生效 ============

(function () {
  const e = makeEnv();
  e.bd.setEnabled(false);
  e.bd.arm(e.host);
  e.tick(400);
  e.scrollPage(900);
  eq('开关关掉后滚动不关', e.state.closed, 0);
  ok('开关关掉时不挂 scroll 监听', e.bd._onScroll === null);
  ok('开关关掉时不启轮询', e.bd._pollTimer === null);

  // 重新打开：浮窗还开着，应该自动重新挂上
  e.bd.setEnabled(true);
  ok('重新开启后监听挂回来了', e.bd._onScroll !== null);
  e.tick(400);
  e.scrollPage(1800);
  eq('重新开启后滚动恢复生效', e.state.closed, 1);
  e.cleanup();
})();

// ============ 反例 7：disarm 之后彻底安静 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.bd.disarm();
  e.tick(400);
  e.scrollPage(900);
  eq('disarm 后滚动不关', e.state.closed, 0);
  ok('disarm 后 scroll 监听已摘', e.bd._onScroll === null);
  ok('disarm 后 popstate 监听已摘', e.bd._onPopState === null);
  ok('disarm 后轮询已停', e.bd._pollTimer === null);
  ok('disarm 后 host 已清', e.bd._host === null);
  e.cleanup();
})();

// ============ 结构：arm 幂等，不会越挂越多 ============

(function () {
  const e = makeEnv();
  e.bd.arm(e.host);
  e.bd.arm(e.host); // 重复 arm 必须先摘旧的
  ok('重复 arm 后仍只有一个 timer', !!e.bd._pollTimer);
  e.tick(400);
  e.scrollPage(210);
  eq('重复 arm 后只关一次（监听没有叠加）', e.state.closed, 1);
  e.cleanup();
})();

// ============ 静态接线断言（这类漏接 jsdom 测不出来，必须查源码） ============

ok('modal-window.js 打开浮窗后调用了 arm',
  /this\.isOpen = true;[\s\S]{0,400}ClipMateBrowseDismiss\.arm\(this\)/.test(MODAL_WINDOW));

ok('modal-window.js 关闭浮窗时调用了 disarm',
  /this\.isClosing = true;[\s\S]{0,600}ClipMateBrowseDismiss\.disarm\(\)/.test(MODAL_WINDOW));

ok('content-main.js 读了 autoDismiss 设置',
  /ClipMateBrowseDismiss\.setEnabled\(/.test(CONTENT_MAIN) && /autoDismiss/.test(CONTENT_MAIN));

(function () {
  const scripts = (MANIFEST.content_scripts || []).map((cs) => (cs.js || []));
  const uiGroup = scripts.filter((js) => js.indexOf('src/content/content-main.js') !== -1)[0] || [];
  const idxBd = uiGroup.indexOf('src/content/ui/browse-dismiss.js');
  const idxMw = uiGroup.indexOf('src/content/ui/modal-window.js');
  ok('manifest 在 UI 组注册了 browse-dismiss.js', idxBd !== -1);
  ok('browse-dismiss.js 排在 modal-window.js 之前（后者要用它）',
    idxBd !== -1 && idxMw !== -1 && idxBd < idxMw, `idx=${idxBd} / ${idxMw}`);
})();

ok('settings-schema 有 autoDismiss（v2.9.6 起默认值交给类型判断，schema 里给保守的 false）',
  /key: 'autoDismiss'/.test(SCHEMA) && /key: 'autoDismiss'[\s\S]{0,560}default: false/.test(SCHEMA));

ok('settings-schema 里 autoDismiss 已改为站点可覆盖',
  /key: 'autoDismiss'[\s\S]{0,560}siteOverridable: true/.test(SCHEMA));

ok('settings-schema 里 autoDismiss 标记 siteOnly（通用页不显示）',
  /key: 'autoDismiss'[\s\S]{0,560}siteOnly: true/.test(SCHEMA));

(function () {
  // background.js 里 defaultConfig 出现两处，漏一处就是「老用户读到 undefined」
  const hits = BACKGROUND.match(/autoDismiss:\s*true/g) || [];
  eq('background.js 两处 defaultConfig 都加了 autoDismiss', hits.length, 2);
})();

// ---------------- 汇总 ----------------

console.log('');
console.log(`browse-dismiss：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('');
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
