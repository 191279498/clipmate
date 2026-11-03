/**
 * 站点明暗判定（v2.9.3）
 *
 * 这一层决定「浮窗、按钮、提示条要不要换深色」。判错了不是崩溃，是「白板贴在黑页面上」，
 * 所以每条判据都得能真的变红：
 *   · 深底判深、浅底判浅 —— 阈值两侧各取一个样本；
 *   · body 透明时要往上看 html —— 大量站点把背景设在 html 上；
 *   · 两处都读不到色（背景图/渐变）时退回系统设置 —— 不能一律当浅色；
 *   · 缓存要真的生效 —— 浮窗一秒开好几次，每次都算会掉帧；
 *   · 元素被移除后监听要自注销 —— 否则开一次浮窗留一个僵尸回调。
 */

'use strict';

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
  throw new Error('找不到 jsdom，请设置 NODE_PATH');
}

const { JSDOM } = loadJsdom();
const MODULE = path.join(__dirname, '..', 'ClipMate_chrome', 'src/content/ui/site-theme.js');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };
let pass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(C.green + '  ✓ ' + C.reset + name);
  } else {
    fails.push(name + (extra !== undefined ? '（实际：' + extra + '）' : ''));
    console.log(C.red + '  ✗ ' + name + C.reset + (extra !== undefined ? C.dim + '  → ' + extra + C.reset : ''));
  }
}
function eq(name, actual, expected) {
  ok(name + (JSON.stringify(actual) === JSON.stringify(expected) ? '' : ' ← 期望 ' + JSON.stringify(expected)),
    JSON.stringify(actual) === JSON.stringify(expected), actual);
}
function section(t) { console.log('\n' + C.bold + t + C.reset); }

/**
 * 每个用例一套干净环境。
 * @param {object} opts { bodyBg, htmlBg, systemDark }
 */
function makeEnv(opts) {
  const o = opts || {};
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom 不实现 matchMedia，这里给个可切换的桩：测「系统深色」这条退路要用
  window.matchMedia = (q) => ({
    matches: q.indexOf('dark') !== -1 ? !!o.systemDark : !o.systemDark,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });

  if (o.htmlBg) window.document.documentElement.style.backgroundColor = o.htmlBg;
  if (o.bodyBg) window.document.body.style.backgroundColor = o.bodyBg;

  global.window = window;
  global.document = window.document;
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.MutationObserver = window.MutationObserver;
  global.requestAnimationFrame = window.requestAnimationFrame;

  // 每套环境重新 require，避免模块级状态（单例、监听器）串味
  delete require.cache[require.resolve(MODULE)];
  const SiteTheme = require(MODULE);
  return { dom, window, document: window.document, SiteTheme };
}

/* ============================================================
   一、判底：深色 / 浅色
   ============================================================ */
section('一、读页面背景判明暗');

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  eq('白底判浅色', t.isDark(), false);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(15, 15, 15)' });
  const t = new SiteTheme();
  eq('接近纯黑的底判深色', t.isDark(), true);
}

{
  // 大量站点（YouTube 深色、X 深色）真正的底就在这一档，不是纯黑
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(51, 51, 51)' });
  const t = new SiteTheme();
  eq('#333 深灰底判深色', t.isDark(), true);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(238, 238, 238)' });
  const t = new SiteTheme();
  eq('#EEE 浅灰底判浅色', t.isDark(), false);
}

{
  // 阈值两侧各取一个，确认不是「永远返回 false」
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(0, 0, 0)' });
  const t = new SiteTheme();
  eq('纯黑底判深色（排除「永远浅色」的假绿）', t.isDark(), true);
}

/* ============================================================
   二、body 没有底色时往上看 html
   ============================================================ */
section('二、body 透明时取 html 的底色');

{
  const { SiteTheme } = makeEnv({ htmlBg: 'rgb(20, 20, 20)' });
  const t = new SiteTheme();
  eq('只有 html 有黑底 → 判深色', t.isDark(), true);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)', htmlBg: 'rgb(0, 0, 0)' });
  const t = new SiteTheme();
  eq('body 白、html 黑 → 以 body 为准（判浅色）', t.isDark(), false);
}

{
  // 半透明底等于没设：下面透出来的才是用户看到的
  const { SiteTheme } = makeEnv({ bodyBg: 'rgba(0, 0, 0, 0.1)', htmlBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  eq('body 底色透明度太高 → 跳过它，看 html（判浅色）', t.isDark(), false);
}

/* ============================================================
   三、两处都读不到 → 退回系统设置
   ============================================================ */
section('三、读不到背景色时退回系统设置');

{
  const { SiteTheme } = makeEnv({ systemDark: true });
  const t = new SiteTheme();
  eq('全透明 + 系统深色 → 判深色', t.isDark(), true);
}

{
  const { SiteTheme } = makeEnv({ systemDark: false });
  const t = new SiteTheme();
  eq('全透明 + 系统浅色 → 判浅色', t.isDark(), false);
}

/* ============================================================
   四、挂类 / 跟随变化
   ============================================================ */
section('四、给元素挂 .clipmate-dark');

{
  const { SiteTheme, document } = makeEnv({ bodyBg: 'rgb(15, 15, 15)' });
  const t = new SiteTheme();
  const el = document.createElement('div');
  t.apply(el);
  ok('深色站点上挂上 clipmate-dark', el.classList.contains('clipmate-dark'));
}

{
  const { SiteTheme, document } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const el = document.createElement('div');
  el.classList.add('clipmate-dark');   // 先脏着，看会不会被摘掉
  t.apply(el);
  ok('浅色站点上不会挂 clipmate-dark（已有的也摘掉）', !el.classList.contains('clipmate-dark'));
}

{
  const { SiteTheme, document, window } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const el = document.createElement('div');
  document.body.appendChild(el);
  t.attach(el);
  eq('刚 attach 时跟着当前判定走', el.classList.contains('clipmate-dark'), false);

  // 站点自己切深色：改 body 底色后手动 refresh（真实的 refresh 由 MutationObserver/系统事件触发）
  window.document.body.style.backgroundColor = 'rgb(15, 15, 15)';
  t.refresh();
  eq('页面变深后类自动挂上', el.classList.contains('clipmate-dark'), true);
}

{
  const { SiteTheme, document } = makeEnv({ bodyBg: 'rgb(15, 15, 15)' });
  const t = new SiteTheme();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const off = t.attach(el);
  eq('attach 后监听器数量为 1', t._listeners.size, 1);
  off();
  eq('取消跟随会摘掉监听器', t._listeners.size, 0);
}

{
  // 浮窗关掉后元素被移出页面：监听必须自注销，否则每开一次留一个僵尸
  const { SiteTheme, document } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const el = document.createElement('div');
  document.body.appendChild(el);
  t.attach(el);
  el.remove();
  t.refresh();
  eq('元素被移出页面后监听自注销', t._listeners.size, 0);
}

/* ============================================================
   五、缓存与常量
   ============================================================ */
section('五、缓存与常量');

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  let calls = 0;
  const orig = t._compute.bind(t);
  t._compute = () => { calls++; return orig(); };
  t.isDark(); t.isDark(); t.isDark();
  eq('连续取三次只计算一次（浮窗一秒开好几次，不能每次都读布局）', calls, 1);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const orig = t._compute.bind(t);
  let calls = 0;
  t._compute = () => { calls++; return orig(); };
  t.isDark();
  t.refresh();
  eq('refresh 才会重算', calls, 2);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  ok('亮度阈值是 0.4', SiteTheme.DARK_LUMA === 0.4, SiteTheme.DARK_LUMA);
  ok('属性变化节流 300ms（站点切主题常连改好几个属性）', SiteTheme.DEBOUNCE_MS === 300, SiteTheme.DEBOUNCE_MS);
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const a = SiteTheme.shared;
  const b = SiteTheme.shared;
  ok('shared 是单例（浮窗和按钮必须用同一份判定）', a === b && a instanceof SiteTheme);
}

{
  // 相对亮度用 WCAG 线性化而不是简单加权：中间灰在两套算法下差一倍
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const lumaWhite = t._luma({ r: 255, g: 255, b: 255 });
  const lumaBlack = t._luma({ r: 0, g: 0, b: 0 });
  const lumaMid = t._luma({ r: 128, g: 128, b: 128 });
  ok('白色亮度 = 1', Math.abs(lumaWhite - 1) < 1e-6, lumaWhite);
  ok('黑色亮度 = 0', Math.abs(lumaBlack) < 1e-6, lumaBlack);
  ok('中灰 #808080 亮度约 0.216（线性化后的值，不是 0.5）',
    Math.abs(lumaMid - 0.2158) < 0.01, lumaMid.toFixed(4));
}

{
  const { SiteTheme } = makeEnv({ bodyBg: 'rgb(255, 255, 255)' });
  const t = new SiteTheme();
  const p = t._parseColor('rgba(17, 24, 32, 0.35)');
  ok('能解析 rgba 的 alpha', p && p.a === 0.35 && p.r === 17 && p.b === 32, JSON.stringify(p));
  eq('解析不了的颜色返回 null', t._parseColor('linear-gradient(#fff, #000)'), null);
  eq('空字符串返回 null', t._parseColor(''), null);
}

{
  const { SiteTheme, document } = makeEnv({ bodyBg: 'rgb(15, 15, 15)' });
  const t = new SiteTheme();
  t.attach(document.createElement('div'));
  ok('reset 会清掉监听器与缓存', (t.reset(), t._listeners.size === 0 && t._dark === null));
}

/* ============================================================
   汇总
   ============================================================ */
console.log('\n' + '─'.repeat(56));
if (fails.length === 0) {
  console.log(C.green + '✅ 全部通过：' + pass + ' 项' + C.reset);
  process.exit(0);
} else {
  console.log(C.red + '❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项' + C.reset);
  fails.forEach((f) => console.log('   · ' + f));
  process.exit(1);
}
