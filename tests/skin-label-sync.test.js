/**
 * v2.12.2 —— 按钮「文案跟着皮肤走」+ 抖音主页弹层换装
 *
 * 起因（用户 2026-11-05 真机截图）：
 *   抖音作者主页点「整理档案」→ 提取完 3 秒后，按钮的 class 还是 `clipmate-arch`
 *   （深蓝底 + 金边 + 档案吉祥物），文字却被打回「提取」。
 *
 * 根因：`_restoreButtonSoon()` 里写死 `_renderButton('normal', this.LABEL_IDLE)`，
 * 它不知道此刻穿的哪套皮肤。这里用 jsdom 把 ButtonManager 真跑起来，
 * 必须走「真点击 → 真 setLoading → 真 setSuccess → 真 3 秒回流」这条链路，
 * 而不是手写 `_renderButton('normal','提取')` 再断言 —— 那样从原理上抓不到这个 bug。
 *
 * 第二部分验抖音主页那条轻监听：弹层开 → default，关 → arch。
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const cands = [
    path.join(process.env.NODE_PATH || '', 'jsdom'),
    'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules/jsdom'
  ];
  for (const dir of cands) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  console.error('缺少 jsdom：请设置 NODE_PATH 指向全局 node_modules');
  process.exit(1);
}

const { JSDOM } = loadJsdom();
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');

const BTN_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/button-manager.js'), 'utf8');
const DY_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/douyin-spa-handler.js'), 'utf8');
const KS_SPA_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/kuaishou-spa-handler.js'), 'utf8');
const KS_ROUTE_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/kuaishou-route-watcher.js'), 'utf8');

let pass = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? '  → ' + String(detail).slice(0, 220) : ''));
}

function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expect));
}

/**
 * 按钮管理器夹具。
 * 定时器全部改成「记录、手动触发」：3 秒回流不用真等，而且必定能跑到。
 */
function setup(url) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: url || 'https://www.douyin.com/user/MS4wLjABAAAA_test',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};
  win.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://kniejllhnjpcbbdaghfhbpdbpcckaccp/' + p
    }
  };

  const script = win.document.createElement('script');
  script.textContent = BTN_CODE;
  win.document.documentElement.appendChild(script);

  const bm = new win.ButtonManager();
  bm.setClickHandler(() => {});      // 相当于 initUI 接上动作（isReady=true）

  // 记录型定时器：只记录，不自动跑
  win.__timers = [];
  win.setTimeout = (fn) => { win.__timers.push(fn); return win.__timers.length; };
  win.clearTimeout = () => {};
  return { win, bm, btn: bm.button };
}

/** 跑最后一个被排队的定时器（`_restoreButtonSoon` 的 3 秒回流） */
function runLastTimer(win) {
  const fn = win.__timers[win.__timers.length - 1];
  if (typeof fn === 'function') fn();
}

function bgOf(btn) {
  const f = btn.querySelector('.clipmate-mascot');
  return f ? (f.style.backgroundImage || '') : '';
}

/* ============================================================
 * 一、档案页：走完整链路后，3 秒回流不许把文案打回「提取」
 * ==========================================================*/
console.log('一、档案皮肤 + 成功回流');
{
  const t = setup();
  t.bm.setSkin('arch');
  eq('进入档案页后文案是「整理档案」', t.btn.textContent.trim(), '整理档案');
  eq('档案页 title 说的是「整理作者档案」', t.btn.title, '点击整理作者档案，拖动可移动按钮位置');

  // 模拟「换肤先发生、initUI 后接上动作」的时序：title 不能退回普通版
  t.bm.setClickHandler(() => {});
  eq('后接上的点击动作也用档案版 title', t.btn.title, '点击整理作者档案，拖动可移动按钮位置');

  t.bm.setLoading(true);
  eq('提取中文案（用户 2026-11-05 拍板不改「整理中」）', t.btn.textContent.trim(), '提取中');

  t.bm.setSuccess();
  eq('成功态文案是「完成」', t.btn.textContent.trim(), '完成');
  eq('成功态 title 跟皮肤走', t.btn.title, '点击再次整理，拖动可移动按钮位置');

  runLastTimer(t.win);   // 3 秒回流
  eq('回流后文案必须回到「整理档案」而不是「提取」', t.btn.textContent.trim(), '整理档案');
  ok('回流后档案类名还在', t.btn.classList.contains('clipmate-arch'));
  ok('回流后头像还是档案吉祥物', /hero-archive\.svg/.test(bgOf(t.btn)), bgOf(t.btn));
  eq('回流后 title 仍是档案版', t.btn.title, '点击整理作者档案，拖动可移动按钮位置');
  eq('回流后皮肤字段仍是 arch', t.bm._skin, 'arch');
}

/* ============================================================
 * 二、档案页：失败回流同样不许打回「提取」
 * ==========================================================*/
console.log('二、档案皮肤 + 失败回流');
{
  const t = setup();
  t.bm.setSkin('arch');
  t.bm.setLoading(true);
  t.bm.setError();
  eq('失败态文案是「重试」', t.btn.textContent.trim(), '重试');
  runLastTimer(t.win);
  eq('失败回流后文案回到「整理档案」', t.btn.textContent.trim(), '整理档案');
  ok('失败回流后档案类名还在', t.btn.classList.contains('clipmate-arch'));
}

/* ============================================================
 * 三、普通页基线：不许因为上面的改动变成「整理档案」
 * ==========================================================*/
console.log('三、普通皮肤基线');
{
  const t = setup('https://weibo.com/u/1188742767');
  eq('普通页文案是「提取」', t.btn.textContent.trim(), '提取');
  eq('普通页 title 是提取那句', t.btn.title, '点击提取页面媒体信息，拖动可移动按钮位置');

  t.bm.setLoading(true);
  t.bm.setSuccess();
  runLastTimer(t.win);
  eq('普通页回流后仍是「提取」', t.btn.textContent.trim(), '提取');
  ok('普通页没有档案类名', !t.btn.classList.contains('clipmate-arch'));
  ok('普通页头像还是举纸吉祥物', /hero-doc\.svg/.test(bgOf(t.btn)), bgOf(t.btn));
}

/* ============================================================
 * 四、提取中途切皮肤（例如弹层打开 / 关闭）：文案必须立刻跟上
 * ==========================================================*/
console.log('四、瞬态里切皮肤');
{
  const t = setup();
  t.bm.setSkin('arch');
  t.bm.setLoading(true);           // 「提取中」
  t.bm.setSkin('default');
  eq('提取中切到普通皮肤不改瞬态文案', t.btn.textContent.trim(), '提取中');
  t.bm.setSuccess();
  runLastTimer(t.win);
  eq('回流后落到普通皮肤的「提取」', t.btn.textContent.trim(), '提取');
  ok('回流后没有档案类名', !t.btn.classList.contains('clipmate-arch'));
}

/* ============================================================
 * 五、抖音主页「只换装」监听
 * ==========================================================*/
console.log('五、抖音主页换装监听');
{
  // 用 jsdom 真跑 mixin，`location` 才落在抖音域上
  function makeHost(url, shape) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: url, runScripts: 'dangerously'
    });
    const win = dom.window;
    const script = win.document.createElement('script');
    script.textContent = DY_CODE;
    win.document.documentElement.appendChild(script);

    const calls = [];
    win.DouyinModalContext = {
      watch(cb) { calls.push(cb); return () => { calls.stopped = true; }; }
    };

    const host = Object.assign({}, win.DouyinSpaMixin);
    host._pageShape = shape;
    host._douyinLog = () => {};
    host.buttonManager = {
      skin: 'arch',
      setSkin(s) { this.skin = s; }
    };
    return { win, host, calls };
  }

  const person = makeHost('https://www.douyin.com/user/MS4wLjABAAAA_x', 'person');
  eq('主页形态下挂得上', person.host._startDouyinPersonSkinWatcher(), true);
  ok('确实订阅了弹层状态', person.calls.length === 1, person.calls.length);

  // 弹层开 → 普通蓝「提取」
  person.calls[0]({ id: '123', opened: true, mode: 'modal' });
  eq('弹层打开 → 换回普通蓝皮肤', person.host.buttonManager.skin, 'default');

  // 弹层关 → 档案装
  person.calls[0]({ id: '', opened: false, mode: '' });
  eq('弹层关闭 → 回到档案装', person.host.buttonManager.skin, 'arch');

  // 幂等：重复调用不再订阅第二份
  person.host._startDouyinPersonSkinWatcher();
  ok('重复调用不重复订阅', person.calls.length === 1, person.calls.length);

  const notPerson = makeHost('https://www.douyin.com/video/7500000000000000000', 'detail');
  eq('非档案页不挂（详情页有自己的流程）', notPerson.host._startDouyinPersonSkinWatcher(), false);
  ok('非档案页没有订阅', notPerson.calls.length === 0, notPerson.calls.length);

  const other = makeHost('https://www.kuaishou.com/profile/3xabc', 'person');
  eq('其他站不挂', other.host._startDouyinPersonSkinWatcher(), false);
  ok('其他站没有订阅', other.calls.length === 0, other.calls.length);
}

/* ============================================================
 * 六、与完整弹窗接管互斥（两边同时挂会互相摘按钮）
 * ==========================================================*/
console.log('六、与完整弹窗接管互斥');
{
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.douyin.com/user/x', runScripts: 'dangerously'
  });
  const win = dom.window;
  const script = win.document.createElement('script');
  script.textContent = DY_CODE;
  win.document.documentElement.appendChild(script);

  let called = 0;
  win.DouyinModalContext = { watch() { called++; return () => {}; } };
  const host = Object.assign({}, win.DouyinSpaMixin);
  host._pageShape = 'person';
  host._douyinLog = () => {};
  host._douyinWatch = () => {};     // 假装完整接管已在跑
  host.buttonManager = { setSkin() {} };

  eq('完整接管在跑时不重复挂', host._startDouyinPersonSkinWatcher(), false);
  ok('没有多订阅一份', called === 0, called);
}

/* ============================================================
 * 七、content-main 的接线（防止方法写了却没人调用）
 * ==========================================================*/
console.log('七、接线检查');
{
  const main = fs.readFileSync(path.join(SRC, 'src/content/content-main.js'), 'utf8');
  ok('init 里调用了 _startDouyinPersonSkinWatcher', main.indexOf('this._startDouyinPersonSkinWatcher()') !== -1);
  const dyn = fs.readFileSync(path.join(SRC, 'src/content/ui/douyin-spa-handler.js'), 'utf8');
  ok('mixin 里定义了 _startDouyinPersonSkinWatcher',
    dyn.indexOf('_startDouyinPersonSkinWatcher()') !== -1);
  // 反向：不许再有任何地方把待命文案写死成 LABEL_IDLE
  // 注意：必须先剥掉注释再查 —— 上文注释里就写着这句反面教材，
  // 直接 indexOf 会被注释命中（项目里踩过一次的坑）。
  const btn = fs.readFileSync(path.join(SRC, 'src/content/ui/button-manager.js'), 'utf8');
  const btnCode = btn
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const hardcoded = btnCode.split('\n').filter((l) =>
    /_renderButton\(\s*'normal'\s*,\s*this\.LABEL_IDLE\s*\)/.test(l));
  ok('没有地方再把待命文案写死成 LABEL_IDLE', hardcoded.length === 0, hardcoded.join(' | '));
  ok('待命文案确实改走 _idleLabel',
    /_renderButton\('normal', this\._idleLabel\)/.test(btnCode));
}

/* ============================================================
 * 八、地址监听范围（除了抖音，其余社交站都靠它重算皮肤）
 * ==========================================================*/
console.log('八、地址监听范围');
{
  const PageShape = require(path.join(SRC, 'src/content/utils/page-shape.js'));
  ['www.kuaishou.com', 'www.xiaohongshu.com', 'www.youtube.com',
    'www.tiktok.com', 'space.bilibili.com', 'www.weibo.com', 'x.com'].forEach((h) => {
    ok('要盯 ' + h, PageShape.watches(h));
  });
  ok('抖音不盯（它按弹层判断，看地址会被 modal_id 被抹掉坑到）',
    !PageShape.watches('www.douyin.com'));
  ok('IG 不盯（有自己的入口显隐）', !PageShape.watches('www.instagram.com'));
  ok('无关站点不盯（一个定时器都不多）', !PageShape.watches('www.baidu.com'));
}

/* ============================================================
 * 九、快手：弹层开 / 关 的换装（主页点开作品不改地址，只能显式换）
 * ==========================================================*/
async function kuaishouSection() {
  console.log('九、快手换装');

  function makeKs(startPath) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'https://www.kuaishou.com' + startPath,
      runScripts: 'dangerously'
    });
    const win = dom.window;
    for (const code of [KS_SPA_CODE, KS_ROUTE_CODE]) {
      const s = win.document.createElement('script');
      s.textContent = code;
      win.document.documentElement.appendChild(s);
    }

    const skins = [];
    let restored = 0;
    const host = Object.assign({}, win.KuaishouSpaMixin, win.KuaishouRouteMixin);
    host.buttonManager = {
      button: win.document.createElement('button'),
      setSkin(s) { skins.push(s); },
      show() {}, hide() {}
    };
    host._ksLog = () => {};
    host._ksRouteLog = () => {};
    host.initFieldMapper = async (t) => ({ type: t });
    host.refreshConfig = async () => {};
    host.initUI = () => {};
    host.generateCacheKey = () => 'k';
    // 真方法要跑（它会切模板 + 换皮肤），只加一层计数，别用桩替掉它
    const realRestore = host._restoreKuaishouProfilePerson.bind(host);
    host._restoreKuaishouProfilePerson = async () => { restored++; return realRestore(); };
    host._anchorKuaishouButton = () => {};
    return { win, host, skins, restored: () => restored };
  }

  // ① 弹层 / 推荐流接管 → 普通蓝
  {
    const t = makeKs('/profile/3xabc');
    await t.host._activateKuaishouComponents();
    eq('接管到一条作品 → 换普通蓝皮肤', t.skins[t.skins.length - 1], 'default');
  }

  // ② 弹层关掉回主页 → 档案装
  {
    const t = makeKs('/profile/3xabc');
    await t.host._restoreKuaishouProfilePerson();
    eq('回到个人主页 → 换档案装', t.skins[t.skins.length - 1], 'arch');
  }

  // ③ 站内跳进详情页 → 普通蓝
  {
    const t = makeKs('/short-video/3xabc123');
    await t.host._ksRouteActivate();
    eq('站内进入作品详情页 → 普通蓝皮肤', t.skins[t.skins.length - 1], 'default');
  }

  // ④ 网格页 → 个人主页：按钮与档案模板都要回来
  {
    const t = makeKs('/discover');
    t.host._ksRouteLast = '/discover';
    t.win.history.pushState({}, '', '/profile/3xabc987');
    t.host._ksRouteCheck();
    await new Promise((r) => setTimeout(r, 0));
    eq('网格页走进主页 → 恢复人物档案模板', t.restored(), 1);
  }
}

/* ============================================================
 * 汇总
 * ==========================================================*/
kuaishouSection().then(() => {
  console.log('');
  if (fails.length === 0) {
    console.log(`\x1b[32m全部通过：${pass} 项\x1b[0m`);
    process.exit(0);
  } else {
    console.log(`\x1b[31m失败 ${fails.length} 项 / 共 ${pass + fails.length} 项\x1b[0m`);
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
});
