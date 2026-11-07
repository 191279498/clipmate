/**
 * v2.12.7 —— 页面内吉祥物改成内联 data URL（干掉 "Unsafe attempt to load URL"）
 *
 * 背景（用户 2026-11-06 在 edge://extensions 看到的错误，栈指向 site-theme.js:194）：
 *   吉祥物是以 background-image: url(chrome-extension://…/hero-doc.svg) 挂在**页面 DOM** 上的。
 *   页面引用 chrome-extension:// 属跨源请求 → 浏览器先打一条
 *     "Unsafe attempt to load URL … Domains, protocols and ports must match."
 *   再按 web_accessible_resources 放行。图能显示，但错误页长期挂红字；
 *   个别站点的 CSP img-src 还会把它直接掐掉。
 *
 * 修法：6 张页面用图内联成 data URL（生成物 mascot-inline.js），取用统一走 mascot-url.js。
 *
 * 断言纪律（防假绿）：
 *   ① 生成物必须与源 SVG 逐字节一致 —— 手改生成物、改图忘了重跑生成脚本，都会红；
 *   ② 端到端从真实 ButtonManager / MediaFloatingWindow 进，断言真实 DOM 上的
 *      background-image 不再是 chrome-extension://；
 *   ③ 4 个注入 <style> 的模块不能靠「方法名出现过」判定 —— 先剥注释再比位置，
 *      免得注释里提一句就算过（v2.11.x 踩过这个坑）。
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
  throw new Error('找不到 jsdom，请设置 NODE_PATH');
}

const { JSDOM } = loadJsdom();

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (rel) => path.join(ROOT, rel);
const INLINE = P('src/content/shared/mascot-inline.js');
const RESOLVER = P('src/content/shared/mascot-url.js');
const BTN = P('src/content/ui/button-manager.js');
const FLOAT = P('src/content/ui/floating-window.js');
const MANIFEST = P('manifest.json');
const ICON_DIR = P('icons/mascot');

const INLINE_CODE = fs.readFileSync(INLINE, 'utf8');
const RESOLVER_CODE = fs.readFileSync(RESOLVER, 'utf8');
const BTN_CODE = fs.readFileSync(BTN, 'utf8');
const FLOAT_CODE = fs.readFileSync(FLOAT, 'utf8');
const MANIFEST_JSON = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${JSON.stringify(got)}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
  }
}
function ok(label, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ✓ ${label}`); }
  else { fails.push(label); console.log(`  ✗ ${label}${detail ? `\n      → ${detail}` : ''}`); }
}

const DATA_PREFIX = 'data:image/svg+xml,';
const EXT_PREFIX = 'chrome-extension://';

/* ============================================================
 * 一、生成物：mascot-inline.js 必须是源 SVG 的忠实压缩版
 * ==========================================================*/

/** 与 scripts/gen_mascot_inline.py 的 minify_svg() 必须逐条一致（改了要同时改）。 */
function minifySvg(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+\/>/g, '/>')
    .replace(/\s+>/g, '>')
    .trim();
}

function freshWindow(extraCode) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/page',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};
  win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  for (const code of (extraCode || [])) {
    const s = win.document.createElement('script');
    s.textContent = code;
    win.document.documentElement.appendChild(s);
  }
  return win;
}

const W = freshWindow([INLINE_CODE, RESOLVER_CODE]);
const TABLE = (W.ClipMateMascotInline && W.ClipMateMascotInline.TABLE) || {};
const M = W.ClipMateMascot;

ok('生成物有「不要手改」的头注释', /【这个文件是生成物】/.test(INLINE_CODE) && /不要手改/.test(INLINE_CODE));
ok('生成物挂到 window.ClipMateMascotInline', !!W.ClipMateMascotInline && typeof W.ClipMateMascotInline.get === 'function');
ok('解析器挂到 window.ClipMateMascot', !!M && typeof M.url === 'function');

const WANT_ICONS = ['hero-doc', 'hero-done', 'hero-cry', 'hero-archive', 'face-busy', 'face-idle'];
eq('内联表正好收了 content 用到的 6 张', Object.keys(TABLE).sort().join(','), WANT_ICONS.slice().sort().join(','));

for (const name of WANT_ICONS) {
  const v = TABLE[name];
  const label = `「${name}」是 data URL`;
  if (!v) { ok(label, false, '表里没有这张'); continue; }
  ok(label, v.indexOf(DATA_PREFIX) === 0);

  const raw = fs.readFileSync(path.join(ICON_DIR, name + '.svg'), 'utf8');
  let decoded = '';
  try { decoded = decodeURIComponent(v.slice(DATA_PREFIX.length)); } catch (e) { decoded = ''; }
  // 逐字节：手改生成物 / 改了图没重跑脚本，这条必红
  ok(`「${name}」解码后与源 SVG 压缩结果逐字节一致`, decoded === minifySvg(raw),
    `长度 ${decoded.length} vs ${minifySvg(raw).length}`);
  ok(`「${name}」解码后是 svg 且带 viewBox`, /^<svg[\s>]/.test(decoded) && /viewBox=/.test(decoded));
  ok(`「${name}」里没有残留注释/元数据`, decoded.indexOf('<!--') === -1 && decoded.indexOf('<metadata') === -1);
  ok(`「${name}」压过（不长于源文件）`, Buffer.byteLength(decoded, 'utf8') <= Buffer.byteLength(raw, 'utf8'),
    `${Buffer.byteLength(decoded, 'utf8')} vs ${Buffer.byteLength(raw, 'utf8')}`);
}

ok('popup 专用图没有塞进来（体积守卫）', !Object.prototype.hasOwnProperty.call(TABLE, 'hero-peek') &&
  !Object.prototype.hasOwnProperty.call(TABLE, 'face-blank'));
const inlineKb = fs.statSync(INLINE).size / 1024;
ok('生成物体积在预算内（< 200KB）', inlineKb < 200, `${inlineKb.toFixed(0)} KB`);

/* 防「加了新图忘了重跑生成脚本」：扫 content 目录的实际引用，必须都被表覆盖 */
(function scanReferences() {
  const found = new Set();
  const walk = (dir) => {
    for (const fn of fs.readdirSync(dir)) {
      const p = path.join(dir, fn);
      const st = fs.statSync(p);
      if (st.isDirectory()) { walk(p); continue; }
      if (!fn.endsWith('.js')) continue;
      // 这两个是「解析器自己」和「生成物」，正文里本来就会写到图标路径，不算引用
      if (fn === 'mascot-url.js' || fn === 'mascot-inline.js') continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/icons\/mascot\/([A-Za-z0-9_-]+)\.svg/g)) found.add(m[1]);
      // 独立的 mascotUrl('hero-done')；排除 button-manager 的 _mascotUrl('busy')（那是状态不是文件名）
      for (const m of src.matchAll(/(?<![_A-Za-z])mascotUrl\(\s*'([A-Za-z0-9_-]+)'/g)) found.add(m[1]);
      for (const line of src.split('\n')) {
        if (line.indexOf('MASCOT') === -1 && line.indexOf('mascot') === -1) continue;
        for (const m of line.matchAll(/'([a-z0-9-]+\.svg)'/g)) found.add(m[1].slice(0, -4));
      }
    }
  };
  walk(P('src/content'));
  const missing = Array.from(found).filter((n) => !Object.prototype.hasOwnProperty.call(TABLE, n));
  ok('content 目录引用的每张图都在内联表里', missing.length === 0, missing.join(', '));
})();

/* ============================================================
 * 二、解析器语义：两种入参写法、缺图回落、无运行时返回空
 * ==========================================================*/
eq('nameOf(裸名字)', M.nameOf('hero-doc'), 'hero-doc');
eq('nameOf(相对路径)', M.nameOf('icons/mascot/hero-doc.svg'), 'hero-doc');
eq('nameOf(空串) 默认 face-idle', M.nameOf(''), 'face-idle');
eq('nameOf(undefined) 默认 face-idle', M.nameOf(undefined), 'face-idle');
eq('nameOf(认不出来的串)', M.nameOf('../../etc/passwd'), '');

ok('url(裸名字) 走内联', M.url('hero-doc') === TABLE['hero-doc']);
ok('url(相对路径) 走内联', M.url('icons/mascot/hero-archive.svg') === TABLE['hero-archive']);
ok('url(空) 给 face-idle', M.url('') === TABLE['face-idle']);
ok('isInline 认得出收录的图', M.isInline('hero-doc') === true);
ok('isInline 认得出没收录的图', M.isInline('hero-peek') === false);

W.chrome = { runtime: { getURL: (p) => EXT_PREFIX + 'EXT/' + p } };
eq('内联表缺这张时回落 getURL（兜底不白屏）', M.url('hero-peek'), EXT_PREFIX + 'EXT/icons/mascot/hero-peek.svg');
eq('认不出来的串不给地址', M.url('../../x'), '');

const W2 = freshWindow([INLINE_CODE, RESOLVER_CODE]);   // 没有 chrome
eq('既无内联也无扩展运行时 → 空串', W2.ClipMateMascot.url('hero-peek'), '');
eq('没运行时但内联命中 → 照样有地址', W2.ClipMateMascot.url('hero-done'), TABLE['hero-done']);

/* ============================================================
 * 三、端到端：真实 ButtonManager 画出来的头像不能再是 chrome-extension://
 * ==========================================================*/
function setupButton(withResolver) {
  const win = freshWindow(withResolver ? [INLINE_CODE, RESOLVER_CODE] : []);
  const s = win.document.createElement('script');
  s.textContent = BTN_CODE;
  win.document.documentElement.appendChild(s);
  const bm = new win.ButtonManager();
  win.chrome = { runtime: { getURL: (p) => EXT_PREFIX + 'kniejllhnjpcbbdaghfhbpdbpcckaccp/' + p } };
  return { win, bm, btn: bm.button };
}

function bgOf(btn) {
  const face = btn.querySelector('.clipmate-mascot');
  if (!face) return null;
  return String(face.style.backgroundImage || '').replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
}

const A = setupButton(true);
A.bm._renderButton('normal', '提取');
const normalBg = bgOf(A.btn);
ok('★ 端到端：待命头像用 data URL', normalBg && normalBg.indexOf(DATA_PREFIX) === 0, String(normalBg).slice(0, 40));
ok('★ 端到端：待命头像里没有 chrome-extension://', normalBg && normalBg.indexOf(EXT_PREFIX) === -1);
eq('端到端：待命头像就是 hero-doc 那张', normalBg, TABLE['hero-doc']);

A.bm._renderButton('success', '完成');
eq('端到端：成功态是 hero-done', bgOf(A.btn), TABLE['hero-done']);
A.bm._renderButton('error', '重试');
eq('端到端：失败态是 hero-cry', bgOf(A.btn), TABLE['hero-cry']);
A.bm._renderButton('busy', '提取中');
eq('端到端：忙碌态是 face-busy', bgOf(A.btn), TABLE['face-busy']);

A.bm._renderButton('normal', '整理档案');
A.bm.setSkin('arch');
eq('端到端：档案皮肤是 hero-archive（也是 data URL）', bgOf(A.btn), TABLE['hero-archive']);

/* 没有解析器时（老环境 / 单测）仍走 getURL —— 兜底链路不能断 */
const B = setupButton(false);
B.bm._renderButton('normal', '提取');
ok('解析器缺席时回落 chrome-extension://（老链路保留）',
  String(bgOf(B.btn)).indexOf(EXT_PREFIX) === 0, String(bgOf(B.btn)).slice(0, 50));

/* 浮窗标题栏头像 */
(function floatingFace() {
  const win = freshWindow([INLINE_CODE, RESOLVER_CODE]);
  const s = win.document.createElement('script');
  s.textContent = FLOAT_CODE;
  win.document.documentElement.appendChild(s);
  const Ctor = win.MediaFloatingWindow;
  if (!Ctor || !Ctor.prototype || typeof Ctor.prototype._mascotFaceUrl !== 'function') {
    ok('浮窗头像方法存在', false, '拿不到 MediaFloatingWindow.prototype._mascotFaceUrl');
    return;
  }
  win.chrome = { runtime: { getURL: (p) => EXT_PREFIX + 'EXT/' + p } };
  eq('端到端：浮窗标题栏头像也是 data URL', Ctor.prototype._mascotFaceUrl.call({}), TABLE['face-idle']);
})();

/* ============================================================
 * 四、四个注入 <style> 的模块：必须先走解析器（剥注释再判，防注释误命中）
 * ==========================================================*/
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function bodyOf(src, head) {
  const clean = stripComments(src);
  const start = clean.indexOf(head);
  if (start === -1) return '';
  let depth = 0, i = clean.indexOf('{', start);
  const from = i;
  for (; i < clean.length; i++) {
    if (clean[i] === '{') depth++;
    else if (clean[i] === '}') { depth--; if (depth === 0) return clean.slice(from, i + 1); }
  }
  return '';
}

const CALL_SITES = [
  ['douban-list-buttons.js', 'src/content/ui/douban-list-buttons.js', 'function mascotUrl(name)'],
  ['instagram-feed-buttons.js', 'src/content/ui/instagram-feed-buttons.js', 'function mascotUrl(name)'],
  ['weibo-feed-buttons.js', 'src/content/ui/weibo-feed-buttons.js', 'function mascotUrl(name)'],
  ['x-feed-buttons.js', 'src/content/ui/x-feed-buttons.js', 'function mascotUrl(name)'],
  ['button-manager.js', 'src/content/ui/button-manager.js', '_mascotUrl(state) {']
];

for (const [label, rel, head] of CALL_SITES) {
  const body = bodyOf(fs.readFileSync(P(rel), 'utf8'), head);
  const inlineAt = body.indexOf('ClipMateMascot.url(');
  const runtimeAt = body.indexOf('chrome.runtime.getURL(');
  ok(`${label}：函数体里确实引用了 ClipMateMascot.url(`,
    !!body && inlineAt !== -1, body ? `body 片段 ${body.slice(0, 60)}` : '找不到函数体');
  ok(`${label}：解析器排在 getURL 之前`, inlineAt !== -1 && runtimeAt !== -1 && inlineAt < runtimeAt,
    `inline@${inlineAt} runtime@${runtimeAt}`);
  ok(`${label}：仍保留 getURL 兜底`, runtimeAt !== -1);
  ok(`${label}：没有裸写死图标路径直连 getURL`, !/getURL\('icons\/mascot\//.test(stripComments(fs.readFileSync(P(rel), 'utf8'))));
}

/* ============================================================
 * 五、manifest：注册顺序 + 版本
 * ==========================================================*/
const JS_LIST = MANIFEST_JSON.content_scripts[0].js;
const idx = (f) => JS_LIST.indexOf(f);
const INLINE_JS = 'src/content/shared/mascot-inline.js';
const RESOLVER_JS = 'src/content/shared/mascot-url.js';

ok('manifest 注册了 mascot-inline.js', idx(INLINE_JS) !== -1);
ok('manifest 注册了 mascot-url.js', idx(RESOLVER_JS) !== -1);
for (const dep of [
  'src/content/ui/site-theme.js', 'src/content/ui/floating-window.js', 'src/content/ui/button-manager.js',
  'src/content/ui/douban-list-buttons.js', 'src/content/ui/instagram-feed-buttons.js',
  'src/content/ui/weibo-feed-buttons.js', 'src/content/ui/x-feed-buttons.js'
]) {
  ok(`manifest 里两个新脚本排在 ${path.basename(dep)} 之前`,
    idx(INLINE_JS) < idx(dep) && idx(RESOLVER_JS) < idx(dep),
    `inline@${idx(INLINE_JS)} resolver@${idx(RESOLVER_JS)} dep@${idx(dep)}`);
}
ok('web_accessible_resources 仍保留吉祥物（popup/兜底还要用）',
  JSON.stringify(MANIFEST_JSON.web_accessible_resources || []).indexOf('icons/mascot/*') !== -1);

eq('版本号是 2.12.11', MANIFEST_JSON.version, '2.12.11');
ok('mascot-inline.js 在成品清单里可被加载（文件确实存在于包内）',
  fs.existsSync(path.join(ROOT, INLINE_JS)) && fs.existsSync(path.join(ROOT, RESOLVER_JS)));

/* ============================================================
 * 汇总
 * ==========================================================*/
console.log('');
if (fails.length === 0) {
  console.log(`\x1b[32m全部通过：${pass} 项\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m失败 ${fails.length} 项 / 共 ${pass + fails.length} 项\x1b[0m`);
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
