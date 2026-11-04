/**
 * 逐帖小按钮 · 头像版契约（v2.9.0）
 *
 * 背景
 * ----
 * Instagram / X / 微博 三站的逐帖小按钮一直是「灰底盘 + 文档线稿图标」，
 * 是整套视觉里最后一块没换吉祥物的地方（v2.8.5 主按钮、v2.8.6 应用图标已换）。
 * 用户 2026-11-02 拍板：**B 案——去掉底盘，吉祥物直接站在页面上**，
 * 成功/失败时才亮起一块浅绿/浅红底。
 *
 * 这份测试盯死五件事（每条都是「以后有人顺手改回去」会出事故的地方）：
 *   1. 形象只能是 `icons/mascot/` 下的矢量形态（v2.9.2 起），且必须走 background-image
 *      —— 用 <img> 会被站点的全局 img 规则（max-width / object-fit / border-radius）改烂；
 *      28px 只能用「头部特写」，全身像缩到这个尺寸只剩一团白；
 *   2. 扩展内资源必须在 manifest 的 web_accessible_resources 里登记，
 *      否则页面上是一片空白（jsdom 测不出加载，所以这条只能静态断言 + 真机看）；
 *   3. 按钮是 28px 正方形，图按母版比例 480:409 缩放，不许压扁/拉长；
 *   4. 状态是「浅色背光」不是「实心色块」——实心色会把白机身吞掉；
 *   5. 没有扩展运行时（单测 / 资源缺失）时降级成 none，不许抛错。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const FILES = {
  instagram: path.join(CHROME, 'src/content/ui/instagram-feed-buttons.js'),
  weibo: path.join(CHROME, 'src/content/ui/weibo-feed-buttons.js'),
  x: path.join(CHROME, 'src/content/ui/x-feed-buttons.js')
};
const MASCOT_DIR = path.join(CHROME, 'icons/mascot');
const MASCOT = path.join(MASCOT_DIR, 'face-idle.svg');   // 小按钮用的就是这张
const MANIFEST = path.join(CHROME, 'manifest.json');

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (arguments.length < 2) throw new Error('ok(name, cond) 必须传两个参数: ' + name);
  if (typeof cond !== 'boolean') throw new Error('ok() 第二参数必须是布尔: ' + name);
  if (cond) {
    pass++;
    console.log('  ' + C.green + '✓' + C.reset + ' ' + name);
  } else {
    fail++;
    const extra = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
    failures.push(name + extra);
    console.log('  ' + C.red + '✗' + C.reset + ' ' + name + extra);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

function section(title) {
  console.log('\n' + C.cyan + title + C.reset);
}

const SRC = {};
for (const [key, p] of Object.entries(FILES)) SRC[key] = fs.readFileSync(p, 'utf8');

/* ============ 一、形象只有一张，且只能是背景图 ============ */
section('一、形象来源：icons/mascot/ 下的矢量形态，且走 background-image');

for (const [key, code] of Object.entries(SRC)) {
  ok('[' + key + '] 从 icons/mascot/ 取矢量形态',
    code.indexOf("'icons/mascot/'") !== -1 && code.indexOf("'.svg'") !== -1);
  ok('[' + key + '] 待命态是头部特写 face-idle（28px 全身像会糊）',
    /face-idle/.test(code));
  ok('[' + key + '] 有结果时换一张脸（face-happy / face-blank）',
    /face-happy/.test(code) && /face-blank/.test(code));
  // 注意：注释里允许出现「不要用 <img>」这种说明文字，所以只查真正的创建/注入行为
  ok('[' + key + '] 没有创建 <img> 元素（会被站点全局样式改烂）',
    !/createElement\(\s*['"]img['"]\s*\)/.test(code) && !/<img\s+[^>]*src=/i.test(code));
  ok('[' + key + '] 里没有残留的文档图标 SVG（ICON_SVG / <svg）',
    code.indexOf('ICON_SVG') === -1 && !/<svg\b/i.test(code));
  ok('[' + key + '] 用 chrome.runtime.getURL 取扩展内地址',
    /chrome\.runtime\.getURL/.test(code));
  ok('[' + key + '] 通过 background-image 承载形象',
    /background-image/.test(code));
}

/* ============ 二、按钮几何：28px 正方形 + 母版比例 ============ */
section('二、按钮几何：28px 正方形，图不压扁');

for (const [key, code] of Object.entries(SRC)) {
  if (key === 'x') {
    ok('[x] BTN_SIZE = 28', /var BTN_SIZE = 28;/.test(code));
  }
  if (key === 'weibo') {
    ok('[weibo] BTN_SIZE = 28', /var BTN_SIZE = 28;/.test(code));
  }
  if (key === 'instagram') {
    ok('[instagram] 宽高都是 28px', /width:28px !important; height:28px !important/.test(code));
  }
  ok('[' + key + '] 没有 box-shadow（底盘已去掉，不该再有投影）',
    code.indexOf('box-shadow') === -1);
}

const W = {};
const H = {};
for (const [key, code] of Object.entries(SRC)) {
  const mw = /var MASCOT_W = ([\d.]+);/.exec(code);
  const mh = /var MASCOT_H = ([\d.]+);/.exec(code);
  W[key] = mw ? Number(mw[1]) : null;
  H[key] = mh ? Number(mh[1]) : null;
}
ok('三站都声明了 MASCOT_W',
  W.instagram !== null && W.weibo !== null && W.x !== null, W);
ok('三站都声明了 MASCOT_H',
  H.instagram !== null && H.weibo !== null && H.x !== null, H);
ok('三站的图片宽度一致（同一套尺寸，不许各写各的）',
  W.instagram === W.weibo && W.weibo === W.x, W);
ok('三站的图片高度一致', H.instagram === H.weibo && H.weibo === H.x, H);

// 素材真实比例 → 断言图不会被拉变形（误差 2% 以内，留一点抗锯齿余量）
{
  const txt = fs.readFileSync(MASCOT, 'utf8');
  const m = txt.match(/viewBox="([-\d.\s]+)"/);
  const vb = m ? m[1].trim().split(/\s+/).map(Number) : [];
  ok('face-idle 的 viewBox 读得出来', vb.length === 4 && vb[2] > 0 && vb[3] > 0,
    m ? m[1] : '无 viewBox');
  const ratioSrc = vb[2] / vb[3];
  const ratioCss = W.instagram / H.instagram;
  ok('CSS 里的宽高比 = 素材宽高比（图不被压扁）',
    vb.length === 4 && Math.abs(ratioCss - ratioSrc) / ratioSrc < 0.02, { ratioCss, ratioSrc });

  // 31px 装进 28px 按钮：四周各溢 1.5px，边缘不发虚；再大就会溢出画面被邻元素盖住
  ok('图比按钮大一圈（29~34px，装进 28px）',
    W.instagram >= 29 && W.instagram <= 34, W.instagram);
}

/* ============ 三、状态：浅色背光，不是实心色块 ============ */
section('三、状态：浅色背光（实心色会吞掉白机身）');

function alphaOf(code, selector) {
  const re = new RegExp(selector.source + '[^\\n]*?rgba\\([^)]*?,\\s*([\\d.]+)\\)');
  const m = re.exec(code);
  return m ? Number(m[1]) : null;
}

{
  const pairs = [
    ['x', /\[data-state="ok"\]/],
    ['x', /\[data-state="fail"\]/],
    ['weibo', /\[data-state="ok"\]/],
    ['weibo', /\[data-state="fail"\]/],
    ['instagram', /\.is-ok/],
    ['instagram', /\.is-err/]
  ];
  for (const [key, sel] of pairs) {
    const a = alphaOf(SRC[key], sel);
    ok('[' + key + '] ' + sel.source + ' 是半透明浅底（alpha ≤ .35）',
      a !== null && a <= 0.35, a);
  }
  // 反向：任何一个站都不许再把状态写成不透明实心
  for (const [key, code] of Object.entries(SRC)) {
    ok('[' + key + '] 没有把状态色写成 .95 这种实心值',
      !/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*\.9/.test(code));
  }
}

/* ============ 四、manifest 必须登记素材，否则页面上是空白 ============ */
section('四、manifest：web_accessible_resources 覆盖素材');

{
  const mf = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const war = mf.web_accessible_resources || [];
  // 只认能真正覆盖 23 个形态的那一条写法：整个目录通配。
  // 写成 icons/mascot/other/* 这种「同前缀但盖不到」的，不算数（变异测试盯着）
  const hit = war.some(function (e) {
    const res = e && e.resources ? e.resources : [];
    return res.some(function (r) { return r === 'icons/mascot/*'; });
  });
  ok('web_accessible_resources 登记了 icons/mascot/*', hit, war);
  const coversAll = war.some(function (e) {
    const m = e && e.matches ? e.matches : [];
    return m.indexOf('<all_urls>') !== -1;
  });
  ok('matches 是 <all_urls>（三站都能取到图）', coversAll, war);
}

/* ============ 五、真渲染：桩 chrome.runtime 后样式里必须带扩展 URL ============ */
section('五、真渲染：注入的样式里是扩展内地址 / 无运行时降级为 none');

const { JSDOM } = (function () {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const dirs = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(require('os').homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const d of dirs) {
    try { return require(path.join(d, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom（见 tests/README.md）');
})();

const FAKE_EXT = 'chrome-extension://abcdefghijklmnop';

function render(key, opts) {
  const o = opts || {};
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    url: o.url,
    pretendToBeVisual: true,
    runScripts: 'dangerously'          // 不开启的话 window.eval 是空的，class 挂不上 window
  });
  const w = dom.window;
  if (o.withRuntime !== false) {
    w.chrome = { runtime: { getURL: function (p) { return FAKE_EXT + '/' + p; } } };
  }
  // 三站各自的上下文桩：只要能让 start() 走过去调 ensureStyle 就够
  // （容器一律返回空，等于「页面上没有帖子可挂」，不会真的去操作 DOM）
  const emptyCtx = {
    getSite: function () { return 'desktop'; },
    findContainers: function () { return []; },
    findCards: function () { return []; },
    readPost: function () { return null; },
    currentStatusId: function () { return null; },
    CARET: null
  };
  w.XFeedContext = emptyCtx;
  w.WeiboFeedContext = emptyCtx;
  w.InstagramEntryContext = { isFeedPage: function () { return true; } };

  const code = SRC[key];
  w.eval(code);

  const Ctor = key === 'x' ? w.XFeedButtons
    : key === 'weibo' ? w.WeiboFeedButtons
      : w.InstagramFeedButtons;
  if (typeof Ctor !== 'function') throw new Error(key + ' 没有导出按钮类');

  const mgr = new Ctor({ onExtract: function () { return true; } });
  if (typeof mgr.start === 'function') mgr.start();

  const styleId = {
    x: 'clipmate-x-feed-style',
    weibo: 'clipmate-weibo-feed-style',
    instagram: 'clipmate-ig-feed-style'
  }[key];
  const el = w.document.getElementById(styleId);
  const css = el ? el.textContent : '';
  try { mgr.stop(); } catch (e) { /* 停不掉不影响断言 */ }
  return css;
}

const URLS = {
  x: 'https://x.com/home',
  weibo: 'https://weibo.com/',
  instagram: 'https://www.instagram.com/'
};

for (const key of Object.keys(SRC)) {
  const css = render(key, { url: URLS[key] });
  ok('[' + key + '] 样式节点真的注入了（有 <style id>）', css.length > 0);
  ok('[' + key + '] 样式里的 background-image 是扩展内地址',
    css.indexOf('background-image:url("' + FAKE_EXT + '/icons/mascot/face-idle.svg")') !== -1,
    css.slice(0, 240));
  // 素材换成 .svg 之后，样式里本来就带 "svg" 字样（url(".../face-idle.svg")），
  // 所以不能再粗暴地 indexOf('svg') —— 只查「有没有把 svg 当元素选择器用」。
  ok('[' + key + '] 样式里没有把 svg 当元素选择器（图标走背景图，不靠内联标签）',
    !/[\s>]svg[\s{,:]/.test(css), css.slice(0, 240));
}

for (const key of Object.keys(SRC)) {
  const css = render(key, { url: URLS[key], withRuntime: false });
  ok('[' + key + '] 没有扩展运行时不抛错，降级成 background-image:none',
    css.indexOf('background-image:none') !== -1, css.slice(0, 200));
}

/* ============ 六、素材本身：必须带透明通道 ============ */
section('六、素材：矢量、结构完整、不带烘焙白底');

{
  const txt = fs.readFileSync(MASCOT, 'utf8').trim();
  ok('是 SVG（<svg 开头、</svg> 结尾）',
    /^<svg[\s>]/.test(txt) && txt.endsWith('</svg>'));
  ok('体积正常（> 2KB，说明不是空图）', Buffer.byteLength(txt) > 2048, Buffer.byteLength(txt));
  // 白底一旦烘焙进去，叠在任意站点上都是一块白方块，且没法用 CSS 去掉
  ok('没有整幅白底矩形（d="M0 0..." + fill 白）',
    !/d="M\s*0[,.\s]+0[^"]*"[^>]*fill="(#fff|#ffffff|white)"/i.test(txt) &&
    !/fill="(#fff|#ffffff|white)"[^>]*d="M\s*0[,.\s]+0/i.test(txt));
  const all = fs.readdirSync(MASCOT_DIR).filter((f) => f.endsWith('.svg'));
  // v2.10.0：23 + 「整理档案」= 24（档案皮肤那张也在同一目录）
  ok('素材目录里是 24 个形态', all.length === 24, all.length);
}

/* ============ 汇总 ============ */
console.log('\n' + '─'.repeat(56));
if (fail === 0) {
  console.log(C.green + '全部通过：' + pass + ' 项' + C.reset + ' — 逐帖小按钮 · 头像版（v2.9.2）');
  process.exit(0);
} else {
  console.log(C.red + '失败 ' + fail + ' 项，通过 ' + pass + ' 项' + C.reset);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
