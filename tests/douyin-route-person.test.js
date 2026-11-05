/**
 * v2.12.3 —— 抖音站内跳转进作者主页后，按钮不许消失
 *
 * 用户 2026-11-05 报（真机 3 次复现，截图 `_shots/dy_bug_nobtn.png`）：
 *   在关注页 / 推荐页点作者头像进 `/user/<sec_uid>`，地址换了、文档没换，
 *   init 不重跑；而弹层监听那边 `signature()` 从 `closed` 到 `closed` 没变，
 *   `emit()` 直接 return —— **一个回调都不会来**，按钮永久消失，只能 F5。
 *
 * 这个文件钉三件事：
 *   一、端到端（真 harness 跑全部内容脚本）：信息流 → 主页，按钮回来、6 列人物模板、
 *       档案装；再跳回信息流，按钮撤、褪回普通蓝。
 *   二、状态机（mixin + 真/假按钮管理器）：弹层关掉时人已在主页 → 不许走「撤按钮」；
 *       从主页点开作品 → 模板必须换成 social（否则整列全空，快手 v2.7.17 的老坑）。
 *   三、接线与门禁：非抖音域一个定时器都不多、重复调用不叠第二份、退出能摘干净。
 *
 * 用法：
 *   node tests/douyin-route-person.test.js
 *   node tests/douyin-route-person.test.js --verbose
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./lib/harness');
const env = require('./lib/env');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');
const VERBOSE = process.argv.includes('--verbose');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const cands = [
    path.join(process.env.NODE_PATH || '', 'jsdom'),
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'jsdom'),
    'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules/jsdom'
  ];
  for (const dir of cands) {
    try { return require(dir); } catch (e) { /* 下一个 */ }
  }
  console.error('缺少 jsdom：请设置 NODE_PATH 指向全局 node_modules');
  process.exit(1);
}
const { JSDOM } = loadJsdom();

const DY_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/douyin-spa-handler.js'), 'utf8');
const BTN_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/button-manager.js'), 'utf8');
const MAIN_CODE = fs.readFileSync(path.join(SRC, 'src/content/content-main.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log('  ✓ ' + name); return; }
  fails.push(name + (detail ? '  → ' + String(detail).slice(0, 240) : ''));
  console.log('  ✗ ' + name + (detail ? '  → ' + String(detail).slice(0, 240) : ''));
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expect));
}
function truthy(name, v) { ok(name, !!v, '实际 ' + JSON.stringify(v)); }
function falsy(name, v) { ok(name, !v, '实际 ' + JSON.stringify(v)); }
function section(t) { console.log('\n' + t); }

async function waitFor(fn, timeout = 5000, step = 40) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v = null;
    try { v = fn(); } catch (e) { v = null; }
    if (v) return v;
    await sleep(step);
  }
  return null;
}

/* ============================================================
 * 页面素材：一个「信息流页」和一个「作者主页」（取自 douyin-profile 的真实结构）
 * ==========================================================*/

const SEC = 'MS4wLjABAAAATeeWHaXZ7dWwyDuDEOZAXpKT2EWH2pdixzq9cU3cBkZstCaNaPwYy724UjSZPxMZ';

/** 信息流页：整页没有可提取的整页内容（不带弹层，也不带沉浸流那一条） */
const FEED_HTML = '<!DOCTYPE html><html><body><div id="root">'
  + '<div>精选</div><div>推荐</div><div>关注</div>'
  + '</div></body></html>';

/** 作者主页：h1 昵称 / 抖音号 / 两行签名（克隆自 douyin-profile.test.js 的 HTML_WITH_BIO） */
const PROFILE_HTML = '<!DOCTYPE html><html><body>'
  + '<div data-e2e="user-detail"><div class="hash-a">'
  + '<h1><span>阿尔弗雷德</span></h1>'
  + '<div class="stat">关注</div><div class="stat">粉丝</div><div class="stat">获赞</div>'
  + '<span class="hash-b">抖音号：61339369848</span>'
  + '<div class="hash-c">这是签名第一行</div><div class="hash-d">这是签名第二行</div>'
  + '<div class="hash-e">我公开展示的群聊</div>'
  + '<span class="hash-f">作品</span><span class="hash-f">私密作品</span><span class="hash-f">合集</span>'
  + '</div></div></body></html>';

const PERSON_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];

(async function main() {

  /* ============================================================
   * 一、端到端：信息流 → 作者主页（用户在真机上报的那条路）
   * ==========================================================*/
  section('一、端到端：/search 页 → 点作者头像 → /user/');

  const page = await H.openPage({
    url: 'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F',
    html: FEED_HTML,
    // 必须是**真实**的媒体配置：detector 拿到空的 siteConfigs 会退回「按正文猜」，
    // 返回字符串 'unknown'（真值）→ 永远进不了「类型为空」那条分支，
    // 测的就不是真机那条路了（v2.11.5 踩过同一个坑）。
    mediaConfigs: await env.loadBackgroundMediaConfigs()
  });
  const w = page.window;
  const d = w.document;

  const inst = await waitFor(() => {
    const i = page.bridge.getInstance ? page.bridge.getInstance() : null;
    return (i && i._douyinRouteTimer) ? i : null;
  }, 8000);

  truthy('信息流页：内容脚本已加载并走进「挂监听」那条分支', !!inst);
  if (!inst) {
    report();
    return;
  }

  eq('信息流页：按钮已被摘下来（v2.5.77 起的既有行为不能变）',
    d.body.contains(inst.buttonManager.button), false);
  truthy('信息流页：站内路由监听已挂上（本轮新增）', !!inst._douyinRouteTimer);
  eq('信息流页：路由形态 = feed', inst._douyinRouteKind(), 'feed');

  /* ---- 站内跳转：地址换成 /user/、DOM 换成主页 ---- */
  d.body.innerHTML = PROFILE_HTML;
  w.history.pushState({}, '', '/user/' + SEC);

  const restored = await waitFor(() => inst._douyinPersonPage === true && inst.buttonManager.button.parentNode, 3000);
  truthy('站内走进主页：路由监听把按钮送回来了（这是本次的主 bug）', !!restored);
  eq('主页：路由形态 = person', inst._douyinRouteKind(), 'person');
  eq('主页：字段模板换成 6 列人物',
    inst.fieldMapper && inst.fieldMapper.mediaType, 'person');
  eq('主页：皮肤 = 档案装', inst.buttonManager._skin, 'arch');
  eq('主页：待命文案 = 整理档案', String(inst.buttonManager.button.textContent || '').trim(), '整理档案');
  ok('主页：title 也是档案版',
    /整理作者档案/.test(String(inst.buttonManager.button.title || '')), inst.buttonManager.button.title);
  eq('主页：按钮不再挂「贴弹层」标记',
    inst.buttonManager.button.getAttribute('data-clipmate-anchor'), null);
  eq('主页：「作品接管」状态已清空（类型会落回 URL 规则 → person）',
    inst._douyinActivated, false);
  eq('主页：缓存键不带作品维度', inst.activeShortcode, null);

  /* ---- 按钮真点一下：提出来必须是人物档案那 6 列 ---- */
  const data = await inst.extractFromCurrentPage();
  eq('主页：点按钮提的就是人物档案（6 列）',
    JSON.stringify(PERSON_KEYS.filter((k) => k in (data || {}))), JSON.stringify(PERSON_KEYS));
  eq('主页：昵称取自 h1', (data || {})['昵称'], '阿尔弗雷德');
  eq('主页：账号ID 取自地址栏', (data || {})['账号ID'], SEC);
  eq('主页：简介只取签名两行', (data || {})['简介'], '这是签名第一行\n这是签名第二行');
  truthy('主页：影人字段全空（模板没串骨架）',
    !(data || {})['姓名'] && !(data || {})['出生日期'] && !(data || {})['国家'],
    JSON.stringify({ 姓名: (data || {})['姓名'], 出生日期: (data || {})['出生日期'], 国家: (data || {})['国家'] }));

  /* ---- 从主页再退回信息流：按钮要撤、褪回普通蓝 ---- */
  d.body.innerHTML = FEED_HTML;
  w.history.pushState({}, '', '/search/%E7%BE%8E%E9%A3%9F');
  const left = await waitFor(() => inst._douyinPersonPage === false && !inst.buttonManager.button.parentNode, 3000);
  truthy('退回信息流：按钮已撤下（不留死按钮）', !!left);
  eq('退回信息流：皮肤褪回普通蓝', inst.buttonManager._skin, 'default');

  try { w.close(); } catch (e) { /* 忽略 */ }

  /* ============================================================
   * 二、状态机：弹层关掉时人已经在主页（真机最常见的时序）
   * ==========================================================*/
  section('二、弹层关闭 / 打开时的模板换向');

  /** 造一个只带「监听状态」的宿主：真 mixin + 真按钮元素 + 记录型依赖 */
  function makeHost(url) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url, runScripts: 'dangerously'
    });
    const win = dom.window;
    win.chrome = { runtime: { getURL: (p) => 'chrome-extension://x/' + p } };
    for (const code of [BTN_CODE, DY_CODE]) {
      const el = win.document.createElement('script');
      el.textContent = code;
      win.document.documentElement.appendChild(el);
    }

    const bm = new win.ButtonManager();
    const calls = { mapperTypes: [], skins: [], shows: 0, initUI: 0, refreshConfig: 0 };

    const host = Object.assign({}, win.DouyinSpaMixin);
    host.buttonManager = bm;
    host._douyinEnabled = true;
    host._douyinModalOn = true;
    host._douyinImmersiveOn = true;
    host._douyinLog = () => {};
    host.initFieldMapper = async (type) => { calls.mapperTypes.push(type); return { mediaType: type }; };
    host.initUI = () => { calls.initUI++; bm.setClickHandler(() => {}); };
    host.refreshConfig = async () => { calls.refreshConfig++; };
    host.modalManager = { isOpen: false, close() { this.isOpen = false; } };
    win.__calls = calls;
    return { win, host, bm, calls };
  }

  /* ---- 2.1 作品弹层关掉，人已经在主页 → 不许撤按钮 ---- */
  {
    const t = makeHost('https://www.douyin.com/user/' + SEC);
    t.bm.setSkin('default');
    t.bm.show();                                  // 弹层接管时按钮在页面上
    t.host._douyinModalId = '7496043889296559386'; // 刚从弹层接管过
    t.host._douyinActivated = true;
    t.host._douyinPersonPage = false;
    t.host._douyinMapperType = 'social';
    t.host.fieldMapper = { mediaType: 'social' };
    // 贴弹层时按钮被写到弹层右上角；关掉弹层后必须清掉这些内联坐标
    t.bm.button.style.left = '640px';
    t.bm.button.style.top = '88px';

    await t.host._onDouyinModalState({ id: '', opened: false, mode: '' });

    truthy('弹层关掉后按钮仍在页面上（主页的唯一入口）',
      t.win.document.body.contains(t.bm.button));
    truthy('弹层关掉后把点击动作接上了（initUI 被调用）', t.calls.initUI >= 1, t.calls.initUI);
    truthy('弹层关掉后读了配置（refreshConfig 被调用）', t.calls.refreshConfig >= 1, t.calls.refreshConfig);
    eq('弹层关掉后清掉贴弹层的 left', t.bm.button.style.left, '');
    eq('弹层关掉后清掉贴弹层的 top', t.bm.button.style.top, '');
    eq('弹层关掉后模板换回 person', t.host._douyinMapperType, 'person');
    eq('弹层关掉后 initFieldMapper 收到的是 person',
      t.calls.mapperTypes[t.calls.mapperTypes.length - 1], 'person');
    eq('弹层关掉后皮肤换回档案装', t.bm._skin, 'arch');
    eq('弹层关掉后待命文案是「整理档案」',
      String(t.bm.button.textContent || '').trim(), '整理档案');
    eq('弹层关掉后「接管中」标记复位', t.host._douyinActivated, false);
    eq('弹层关掉后档案页标记立起来', t.host._douyinPersonPage, true);
    truthy('弹层关掉时没有再摘一次按钮（show/hide 的账要平）',
      t.win.document.body.contains(t.bm.button));

    try { t.win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ---- 2.2 主页上点开作品 → 模板必须换成 social（不许沿用人物 6 列）---- */
  {
    const t = makeHost('https://www.douyin.com/user/' + SEC);
    t.bm.setSkin('arch');
    t.bm.show();
    t.host._douyinPersonPage = true;
    t.host._douyinMapperType = 'person';
    t.host.fieldMapper = { mediaType: 'person' };

    await t.host._onDouyinModalState({ id: '7496043889296559386', opened: true, mode: 'modal' });

    eq('点开作品后模板换成 social', t.host._douyinMapperType, 'social');
    eq('点开作品后 initFieldMapper 收到的是 social',
      t.calls.mapperTypes[t.calls.mapperTypes.length - 1], 'social');
    eq('点开作品后皮肤 = 普通蓝', t.bm._skin, 'default');
    eq('点开作品后「档案页」标记落下', t.host._douyinPersonPage, false);
    eq('点开作品后按钮贴的是弹层', t.bm.button.getAttribute('data-clipmate-anchor'), 'douyin-modal');

    /* 再把弹层关掉 → 回到主页那一套（一来一回都要对） */
    await t.host._onDouyinModalState({ id: '', opened: false, mode: '' });
    eq('一来一回：模板又回到 person', t.host._douyinMapperType, 'person');
    eq('一来一回：皮肤又回到档案装', t.bm._skin, 'arch');
    truthy('一来一回：按钮始终在页面上', t.win.document.body.contains(t.bm.button));

    try { t.win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ---- 2.3 非主页（信息流）关弹层 → 仍按老规矩全撤 ---- */
  {
    const t = makeHost('https://www.douyin.com/jingxuan');
    t.bm.show();
    t.host._douyinModalId = '7496043889296559386';
    t.host._douyinActivated = true;
    t.host._douyinMapperType = 'social';
    t.host.fieldMapper = { mediaType: 'social' };

    await t.host._onDouyinModalState({ id: '', opened: false, mode: '' });
    falsy('信息流页关弹层：按钮照老规矩撤干净',
      t.win.document.body.contains(t.bm.button));
    eq('信息流页关弹层：不动字段模板',
      t.calls.mapperTypes.length, 0);

    try { t.win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ---- 2.5 正常 init 在主页上（v2.12.2 那条轻监听）：退回信息流也要撤按钮 ---- */
  {
    const t = makeHost('https://www.douyin.com/user/' + SEC);
    // 主页上的「只换装」监听需要 DouyinModalContext.watch
    t.win.DouyinModalContext = { watch() { return () => {}; } };
    t.host._pageShape = 'person';
    t.bm.setSkin('arch');
    t.bm.show();

    eq('整页加载的主页上也挂路由监听', t.host._startDouyinPersonSkinWatcher(), true);
    truthy('主页从一开始就标记成「档案页」', t.host._douyinPersonPage === true);

    t.win.history.pushState({}, '', '/follow');
    await t.host._onDouyinRouteChange();
    falsy('从主页退回关注页：按钮撤下', t.win.document.body.contains(t.bm.button));
    eq('从主页退回关注页：皮肤褪回普通蓝', t.bm._skin, 'default');

    // 再走回主页 → 恢复
    t.win.history.pushState({}, '', '/user/' + SEC);
    await t.host._onDouyinRouteChange();
    truthy('再走回主页：按钮回来', t.win.document.body.contains(t.bm.button));
    eq('再走回主页：又是档案装', t.bm._skin, 'arch');

    try { t.win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ---- 2.4 路由形态判定 ---- */
  section('三、路由形态判定（person / detail / feed）');
  {
    const t = makeHost('https://www.douyin.com/user/' + SEC);
    eq('/user/<id> → person', t.host._douyinRouteKind(), 'person');

    t.win.history.pushState({}, '', '/user/' + SEC + '?modal_id=7496043889296559386');
    eq('/user/<id>?modal_id= 是「一条作品」不是档案页', t.host._douyinRouteKind(), 'detail');

    t.win.history.pushState({}, '', '/video/7496043889296559386');
    eq('/video/<id> → detail（本项目不改这条路）', t.host._douyinRouteKind(), 'detail');

    t.win.history.pushState({}, '', '/note/7516480886684568891');
    eq('/note/<id> → detail', t.host._douyinRouteKind(), 'detail');

    for (const p of ['/follow', '/', '/friend', '/jingxuan', '/search/%E7%BE%8E%E9%A3%9F']) {
      t.win.history.pushState({}, '', p);
      eq(p + ' → feed', t.host._douyinRouteKind(), 'feed');
    }

    /* 路由形态是**活值**：地址一变就要跟着变，不能缓存 */
    t.win.history.pushState({}, '', '/user/' + SEC);
    eq('地址改回主页 → 立刻又是 person', t.host._douyinRouteKind(), 'person');
    try { t.win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ============================================================
   * 四、门禁：非抖音域一个定时器都不多、重复调用不叠第二份
   * ==========================================================*/
  section('四、域名门禁与幂等');
  {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.kuaishou.com/profile/3xabc', runScripts: 'dangerously'
    });
    const win = dom.window;
    const el = win.document.createElement('script');
    el.textContent = DY_CODE;
    win.document.documentElement.appendChild(el);

    const host = Object.assign({}, win.DouyinSpaMixin);
    host._douyinLog = () => {};
    eq('其他站不挂路由监听', host._startDouyinRouteWatcher(), false);
    falsy('其他站没有多出定时器', host._douyinRouteTimer);

    win.history.pushState({}, '', '/user/x');      // 就算地址长得像抖音也不该管
    eq('换到别的站的 /user/ 也不挂', host._startDouyinRouteWatcher(), false);
    try { win.close(); } catch (e) { /* 忽略 */ }
  }
  {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.douyin.com/jingxuan', runScripts: 'dangerously'
    });
    const win = dom.window;
    const el = win.document.createElement('script');
    el.textContent = DY_CODE;
    win.document.documentElement.appendChild(el);

    const host = Object.assign({}, win.DouyinSpaMixin);
    host._douyinLog = () => {};
    eq('抖音页挂得上', host._startDouyinRouteWatcher(), true);
    const first = host._douyinRouteTimer;
    truthy('定时器存在', !!first);
    eq('重复调用不叠第二份', host._startDouyinRouteWatcher(), true);
    eq('定时器还是同一个', host._douyinRouteTimer, first);
    host._stopDouyinRouteWatcher();
    falsy('退出时能摘干净', host._douyinRouteTimer);
    try { win.close(); } catch (e) { /* 忽略 */ }
  }

  /* ============================================================
   * 五、接线：方法写了但没人调用 = 等于没写（v2.11.4 踩过）
   * ==========================================================*/
  section('五、接线与守卫检查（源码级）');
  {
    function bodyOf(fnName) {
      const i = DY_CODE.indexOf(fnName + '(');
      if (i < 0) return '';
      // 取到下一个同缩进的方法定义为止（够用：只在本文件的方法里找关键调用）
      const rest = DY_CODE.slice(i);
      const end = rest.indexOf('\n    },', 200);
      return end > 0 ? rest.slice(0, end) : rest.slice(0, 4000);
    }

    ok('_startDouyinModalWatcher 里挂了路由监听',
      /_startDouyinRouteWatcher\(\)/.test(bodyOf('async _startDouyinModalWatcher')));
    ok('_startDouyinPersonSkinWatcher 里也挂了路由监听',
      /_startDouyinRouteWatcher\(\)/.test(bodyOf('_startDouyinPersonSkinWatcher')));
    ok('关弹层那条分支先问「是不是主页」再决定撤不撤',
      /_douyinRouteKind\(\) === 'person'/.test(bodyOf('async _onDouyinModalState')));
    ok('_activateDouyinComponents 有「模板不是 social 就重建」的守卫',
      /_douyinMapperType !== 'social'/.test(bodyOf('async _activateDouyinComponents')));
    ok('退出时摘掉路由监听', /_stopDouyinRouteWatcher\(\)/.test(bodyOf('_stopDouyinModalWatcher')));

    ok('content-main 没被误改（抖音站内跳转仍不进 page-shape 的地址监听）',
      !/'douyin\.com'/.test((MAIN_CODE.match(/WATCHED_HOSTS[\s\S]{0,400}/) || [''])[0]));
  }

  report();

  function report() {
    console.log('\n' + '='.repeat(60));
    if (!fails.length) {
      console.log('全部通过：' + pass + ' 项');
      process.exit(0);
    }
    console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项：');
    fails.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
})();
