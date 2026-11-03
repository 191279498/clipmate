/**
 * v2.8.5 —— 吉祥物主按钮 + 浮窗按钮层级
 *
 * 用户 2026-11-02 的要求，逐条钉死：
 *   1. 页面右上角大按钮改成吉祥物头像，文字从「提取信息」缩成「提取」；
 *   2. 四种状态各有表情：待命 normal / 成功 happy / 失败 sad；
 *   3. 头像用 background-image 载入，不是 <img> —— 站点对 img 的全局样式会改烂它；
 *   4. 浮窗按使用频率重排：复制 Markdown > 复制 Notion > 复制纯文本 > 补齐网址 >（细线）低频；
 *   5. 最高频的复制 Markdown 是全窗唯一实心蓝主按钮；
 *   6. 复制一次之后按钮要还原成原来的**字色**（白字蓝底不能变成蓝底灰字）。
 *
 * 断言写法约定（防假绿）：结构断言锚在本模块自己的代码上，
 * 每条都要能在「把实现改坏」时真的变红。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
const BTN_JS = path.join(ROOT, 'src/content/ui/button-manager.js');
const CSS = path.join(ROOT, 'src/content/content-styles.css');
const MODAL_JS = path.join(ROOT, 'src/content/ui/modal-manager.js');
const MANIFEST = path.join(ROOT, 'manifest.json');

/**
 * 解一张 8 位 RGBA 的 PNG（支持 0~4 四种 filter），返回 { w, h, px }。
 * 图标断言要看逐像素颜色，只读 IHDR/首像素不够。
 */
function decodePngRGBA(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (off < buf.length - 8) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`只支持 8 位 RGBA，实际 ${bitDepth}/${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.slice(pos, pos + stride); pos += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);        // slice 共享内存，能直接写
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 255;
      }
      cur[i] = v;
    }
  }
  return { w, h, px: out };
}

const BTN_CODE = fs.readFileSync(BTN_JS, 'utf8');
const CSS_CODE = fs.readFileSync(CSS, 'utf8');
const MODAL_CODE = fs.readFileSync(MODAL_JS, 'utf8');
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

/* ============================================================
 * 一、主按钮：DOM 行为
 * ==========================================================*/
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/page',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};

  const script = win.document.createElement('script');
  script.textContent = BTN_CODE;
  win.document.documentElement.appendChild(script);

  // 构造时不挂 chrome：和现有测试一样走「拿不到扩展资源」的降级路径，
  // 避免构造函数里读 chrome.storage 报错。需要头像的用例在下面单独注入 runtime。
  const bm = new win.ButtonManager();
  return { win, bm, btn: bm.button };
}

function withRuntime(win) {
  win.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://kniejllhnjpcbbdaghfhbpdbpcckaccp/' + p
    }
  };
}

const A = setup();
withRuntime(A.win);

const RING = 'clipmate-mascot-ring';
const FACE = 'clipmate-mascot';

function faceOf(btn) { return btn.querySelector('.' + FACE); }
function bgOf(face) {
  const raw = (face.style.backgroundImage || '');
  return raw.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
}

/* --- 初始外观 --- */
A.bm._renderButton('normal', A.bm.LABEL_IDLE);
ok('按钮里有头像容器（v2.8.6 起不再垫白色圆底）', !!A.btn.querySelector('.' + RING));
ok('头像节点是 span.clipmate-mascot', faceOf(A.btn) && faceOf(A.btn).tagName === 'SPAN');
eq('初始文字是「提取」', A.btn.textContent.trim(), '提取');
ok('初始头像指向唯一的 mascot.png',
  bgOf(faceOf(A.btn)).endsWith('icons/mascot/mascot.png'), bgOf(faceOf(A.btn)));
ok('待命态不挂角标（常态不需要提示）', !A.btn.querySelector('.clipmate-badge'));
ok('按钮里没有 <img>（站点 img 全局样式碰不到背景图）', A.btn.querySelectorAll('img').length === 0);

/* --- 四种状态 --- */
A.bm.setLoading(true);
eq('提取中：文字', A.btn.textContent.trim(), '提取中');
ok('提取中：加上 loading 类', A.btn.classList.contains('loading'));
ok('提取中：头像不变（晃头靠 CSS 动画）',
  bgOf(faceOf(A.btn)).endsWith('icons/mascot/mascot.png'), bgOf(faceOf(A.btn)));
ok('提取中：不挂角标（还在跑，没有结果可报）', !A.btn.querySelector('.clipmate-badge'));

A.bm.setSuccess();
eq('成功：文字', A.btn.textContent.trim(), '完成');
ok('成功：加上 success 类', A.btn.classList.contains('success'));
ok('成功：头像不变（只有一张脸，状态交给角标）',
  bgOf(faceOf(A.btn)).endsWith('icons/mascot/mascot.png'), bgOf(faceOf(A.btn)));
ok('成功：结构仍是 1 个头像 + 1 个容器（没有重复挂载）',
  A.btn.querySelectorAll('.' + FACE).length === 1 &&
  A.btn.querySelectorAll('.' + RING).length === 1);
{
  const b = A.btn.querySelector('.clipmate-badge');
  ok('成功：挂上 success 角标', !!b && b.getAttribute('data-tone') === 'success',
    b ? b.getAttribute('data-tone') : '无角标');
  ok('成功：角标只有一个', A.btn.querySelectorAll('.clipmate-badge').length === 1);
  ok('成功：角标不污染按钮文字（textContent 仍是「完成」两字）',
    A.btn.textContent.trim() === '完成', A.btn.textContent.trim());
  ok('成功：角标对读屏隐藏（纯装饰）', !!b && b.getAttribute('aria-hidden') === 'true');
}

A.bm.setError();
eq('失败：文字', A.btn.textContent.trim(), '重试');
ok('失败：加上 error 类', A.btn.classList.contains('error'));
{
  const b = A.btn.querySelector('.clipmate-badge');
  ok('失败：角标换成 error 语义色', !!b && b.getAttribute('data-tone') === 'error',
    b ? b.getAttribute('data-tone') : '无角标');
  ok('失败：文字仍是「重试」两字', A.btn.textContent.trim() === '重试', A.btn.textContent.trim());
}

/* --- 3 秒后自动恢复 --- */
{
  const timers = [];
  const realSet = A.win.setTimeout;
  const realClear = A.win.clearTimeout;
  A.win.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  A.win.clearTimeout = () => {};
  if (A.bm._restoreTimer) { /* 清掉上一轮真定时器，避免干扰 */ }
  A.bm._restoreTimer = null;
  A.bm.setSuccess();
  const t = timers.find((x) => x.ms === 3000);
  ok('成功态后有 3 秒恢复定时器', !!t);
  if (t) t.fn();
  eq('3 秒后文字回到「提取」', A.btn.textContent.trim(), '提取');
  ok('3 秒后角标被摘掉', !A.btn.querySelector('.clipmate-badge'));
  ok('3 秒后头像不变（本来就同一张）',
    bgOf(faceOf(A.btn)).endsWith('icons/mascot/mascot.png'), bgOf(faceOf(A.btn)));
  ok('3 秒后 success 类被摘掉', !A.btn.classList.contains('success'));
  A.win.setTimeout = realSet;
  A.win.clearTimeout = realClear;
}

/* --- 降级：拿不到扩展资源时必须有线稿图标，不许空白 --- */
{
  const B = setup(); // 没有 chrome.runtime
  B.bm._renderButton('normal', '提取');
  const face = faceOf(B.btn);
  ok('无扩展运行时：仍然有头像容器', !!face);
  ok('无扩展运行时：退回内联 SVG 线稿图标', face && !!face.querySelector('svg'));
  ok('无扩展运行时：标记 is-fallback 便于排查', face && face.classList.contains('is-fallback'));
  eq('无扩展运行时：没有 background-image', face.style.backgroundImage || '', '');
}

/* ============================================================
 * 二、资源与配置
 * ==========================================================*/
{
  const war = MANIFEST_JSON.web_accessible_resources || [];
  const flat = war.reduce((acc, g) => acc.concat(g.resources || []), []);
  ok('manifest 声明了吉祥物资源（否则页面上是空白圆圈）',
    flat.some((r) => /icons\/mascot\/\*/.test(r) || /mascot\/.+\.png/.test(r)), JSON.stringify(flat));

  const dir = path.join(ROOT, 'icons/mascot');
  // v2.8.6 定稿：只有一张脸。四态 SVG 已归档到 backups（表情等以后再做）。
  const png = path.join(dir, 'mascot.png');
  const pngSize = fs.existsSync(png) ? fs.statSync(png).size : 0;
  ok(`头像资源存在且非空：mascot.png（${(pngSize / 1024).toFixed(1)}KB）`, pngSize > 20000);
  ok('头像资源是带透明通道的 PNG（原图带白底就会在按钮上留白边）',
    (() => {
      try {
        const buf = fs.readFileSync(png);
        // PNG：1~3 字节是 "PNG"，第 25 字节是 IHDR 的色彩类型，6 = RGBA
        return buf.slice(1, 4).toString() === 'PNG' && buf[25] === 6;
      } catch (e) { return false; }
    })());
  ok('头像 PNG 是 8 位 RGBA（否则透明底无从谈起）', (() => {
    try {
      const buf = fs.readFileSync(png);
      const colorType = buf[25];
      const bitDepth = buf[24];
      return colorType === 6 && bitDepth === 8;
    } catch (e) { return false; }
  })());
  ok('已抠图：图像左上角是透明的（棋盘格白底没去干净时这里会是不透明）', (() => {
    try {
      // 解 PNG 第一行的第一个像素。第一行的左邻与上行都是 0，
      // 所以无论 scanline 用哪种 filter，还原值都等于原始字节 —— 直接读即可。
      const buf = fs.readFileSync(png);
      let off = 8;
      const idat = [];
      let w = 0;
      while (off < buf.length - 8) {
        const len = buf.readUInt32BE(off);
        const type = buf.slice(off + 4, off + 8).toString('latin1');
        const data = buf.slice(off + 8, off + 8 + len);
        if (type === 'IHDR') w = data.readUInt32BE(0);
        else if (type === 'IDAT') idat.push(data);
        else if (type === 'IEND') break;
        off += 12 + len;
      }
      const raw = zlib.inflateSync(Buffer.concat(idat));
      const alpha = raw[1 + 3];            // 第 0 行、第 0 个像素的 A 通道
      return w > 0 && alpha < 16;          // < 6% 不透明即视为透明
    } catch (e) { return false; }
  })());
  ok('旧的四态 SVG 已清除（否则打包会带上废弃素材）',
    ['m-normal.svg', 'm-happy.svg', 'm-sad.svg', 'm-ask.svg']
      .every((f) => !fs.existsSync(path.join(dir, f))));

  // v2.9.0：四个尺寸的应用图标都由 mascot.png 直接合成（旧版是手绘矢量 app-icon.svg）
  const ICONS = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
  ICONS.forEach((f) => {
    const p = path.join(ROOT, 'icons', f);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    ok(`应用图标存在且非空：${f}（${(size / 1024).toFixed(1)}KB）`, exists && size > 600);
  });

  // 逐像素解析：判「图里是这个吉祥物」以及「小尺寸换过裁切」
  const icons = {};
  const broken = [];
  ICONS.forEach((f) => {
    try { icons[f] = decodePngRGBA(path.join(ROOT, 'icons', f)); }
    catch (e) { broken.push(f + ':' + e.message); }
  });
  ok('四个图标都是 8 位 RGBA，且能逐像素解出来', broken.length === 0, broken.join(', '));

  if (Object.keys(icons).length === 4) {
    ICONS.forEach((f) => {
      const n = parseInt(f.replace(/\D/g, ''), 10);
      const im = icons[f];
      ok(`${f} 的实际像素是 ${n}×${n}`, im.w === n && im.h === n, `${im.w}×${im.h}`);
    });
    // 圆角：四个角必须是透明的，否则是方块
    const cornerTransparent = (im) => {
      const at = (x, y) => im.px[((y * im.w) + x) * 4 + 3];
      return [at(0, 0), at(im.w - 1, 0), at(0, im.h - 1), at(im.w - 1, im.h - 1)]
        .every((a) => a < 40);
    };
    ok('图标是圆角方底（四角透明）',
      ICONS.every((f) => cornerTransparent(icons[f])));

    // 计数：母版的描边色 #0C1E32（r<45 g<55 b<80）与机身白
    const count = (im, fn) => {
      let hit = 0, opaque = 0;
      for (let i = 0; i < im.w * im.h; i++) {
        const r = im.px[i * 4], g = im.px[i * 4 + 1], b = im.px[i * 4 + 2], a = im.px[i * 4 + 3];
        if (a < 40) continue;
        opaque++;
        if (fn(r, g, b)) hit++;
      }
      return { hit, opaque, ratio: opaque ? hit / opaque : 0 };
    };
    const navy = (r, g, b) => r < 45 && g < 55 && b < 80;          // 深藏青描边 / 面罩
    const white = (r, g, b) => r > 225 && g > 235 && b > 235;       // 白机身与纸

    const navy128 = count(icons['icon128.png'], navy);
    ok(`icon128 里带着母版的深藏青描边（${navy128.hit} 像素）——` +
       '旧矢量图标的描边是 #0B3C8F（g=60），这条会红',
      navy128.hit > 800);

    ICONS.forEach((f) => {
      const w = count(icons[f], white);
      ok(`${f} 里有白机身（占不透明像素 ${(w.ratio * 100).toFixed(1)}%）`, w.ratio > 0.05);
    });

    // 16/32 是「头部方裁」，脸在画面里更大 → 面罩占比明显高于 48/128
    const small = (count(icons['icon16.png'], navy).ratio + count(icons['icon32.png'], navy).ratio) / 2;
    const large = (count(icons['icon48.png'], navy).ratio + count(icons['icon128.png'], navy).ratio) / 2;
    ok(`小尺寸换过头像裁切：16/32 面罩占比 ${(small * 100).toFixed(1)}% > ` +
       `48/128 的 ${(large * 100).toFixed(1)}%（改成同一张图缩小时这条会红）`,
      small > large * 1.15);
  }

  // 母版换图后必须重跑脚本，别手改 PNG（脚本在仓库根的 scripts/，不进扩展包）
  const genScript = path.resolve(__dirname, '..', 'scripts', 'make-icons.py');
  ok('图标生成脚本在（换母版后重跑，而不是手改 PNG）', fs.existsSync(genScript));
  if (fs.existsSync(genScript)) {
    const code = fs.readFileSync(genScript, 'utf8');
    ok('脚本里写着 16/32 用头部方裁', /CROP_HEAD\s*=\s*\(\s*19\s*,\s*19\s*,\s*400\s*,\s*400\s*\)/.test(code));
    ok('脚本里写着品牌蓝渐变 #3D8BFF → #1668E6',
      /BG_TOP\s*=\s*'#3D8BFF'/.test(code) && /BG_BOTTOM\s*=\s*'#1668E6'/.test(code));
  }
  ok('manifest 的四个尺寸都指向 icons/iconN.png',
    ['16', '32', '48', '128'].every((n) => (MANIFEST_JSON.icons || {})[n] === `icons/icon${n}.png`),
    JSON.stringify(MANIFEST_JSON.icons));
}

/* ============================================================
 * 三、样式契约
 * ==========================================================*/
ok('CSS 有头像容器 .clipmate-mascot-ring', /\.clipmate-mascot-ring\s*\{/.test(CSS_CODE));
ok('CSS 有头像 .clipmate-mascot 且用 background 承载图片',
  /\.clipmate-mascot\s*\{[\s\S]{0,400}?background-size:\s*contain/.test(CSS_CODE));
ok('CSS 提取中给了摇头动画 clipmate-nod',
  /\.loading\s+\.clipmate-mascot\s*\{[\s\S]{0,200}?animation:\s*clipmate-nod/.test(CSS_CODE));
ok('旧的转圈 spinner 已删除（不再有 .loading-spinner 规则）',
  !/\.loading-spinner\s*\{/.test(CSS_CODE));

/* v2.8.6 视觉契约：头像透明、撑满按钮左端、按钮左端直边。
   这几条是「看起来是不是一个整体」的量化尺子，任何一条被改回去都会立刻变红。 */
const ringRule = (CSS_CODE.match(/\.clipmate-mascot-ring\s*\{[\s\S]*?\}/) || [''])[0];
ok('头像容器不再垫白圆底（background: none）',
  /background:\s*none/.test(ringRule) && !/background:\s*#fff/i.test(ringRule), ringRule);
ok('头像容器不再裁切（overflow 必须 visible，否则溢出的头会被切一刀）',
  /overflow:\s*visible/.test(ringRule), ringRule);
ok('头像放大到 80px（比按钮 48px 高，溢出上下沿）',
  /width:\s*80px/.test(ringRule) && /height:\s*80px/.test(ringRule), ringRule);
ok('头像用负左边距压住按钮左边界',
  /margin-left:\s*-18px/.test(ringRule), ringRule);
const btnRule = (CSS_CODE.match(/button\.media-extractor-button\s*\{[\s\S]*?\n\}/) || [''])[0];
ok('按钮左端收成直边（border-radius 首值 8px）',
  /border-radius:\s*8px\s+26px\s+26px\s+8px/.test(btnRule), btnRule);
ok('按钮左侧不留内边距（头像自己占住左端，不再留蓝边）',
  /padding:\s*0\s+32px\s+0\s+0/.test(btnRule), btnRule);
ok('按钮右侧留出角标的位置（padding-right >= 26px）',
  (() => { const m = btnRule.match(/padding:\s*0\s+(\d+)px/); return !!m && Number(m[1]) >= 26; })(), btnRule);

/* --- v2.8.6 状态角标（不换表情，用角标反馈结果）--- */
{
  const badgeRule = (CSS_CODE.match(/\.clipmate-badge\s*\{[\s\S]*?\}/) || [''])[0];
  ok('CSS 有角标 .clipmate-badge', !!badgeRule, badgeRule.slice(0, 40));
  ok('角标绝对定位（不参与排版，不会挤动文字）',
    /position:\s*absolute/.test(badgeRule), badgeRule);
  ok('角标在文字右侧、上下居中',
    /right:\s*8px/.test(badgeRule) && /top:\s*50%/.test(badgeRule) &&
    /translateY\(-50%\)/.test(badgeRule), badgeRule);
  ok('角标是 18px 白圆',
    /width:\s*18px/.test(badgeRule) && /height:\s*18px/.test(badgeRule) &&
    /border-radius:\s*50%/.test(badgeRule) && /background:\s*#ffffff/i.test(badgeRule), badgeRule);
  ok('角标不吃点击（点角标等于点按钮）',
    /pointer-events:\s*none/.test(badgeRule), badgeRule);
  ok('角标有弹入动画', /animation:\s*clipmate-badge-pop/.test(badgeRule), badgeRule);
  ok('三种语义色各自绑了符号 ✓ / ! / ?（形状编码，不只靠颜色）',
    /data-tone='success'\]::after\s*\{\s*content:\s*'✓'/.test(CSS_CODE) &&
    /data-tone='error'\]::after\s*\{\s*content:\s*'!'/.test(CSS_CODE) &&
    /data-tone='ask'\]::after\s*\{\s*content:\s*'\?'/.test(CSS_CODE));
  ok('弹入动画每帧都保留 translateY(-50%)（否则角标会先掉到下半截）',
    /@keyframes\s+clipmate-badge-pop\s*\{[\s\S]*?translateY\(-50%\)\s*scale\(0\.35\)[\s\S]*?translateY\(-50%\)\s*scale\(1\)/.test(CSS_CODE));
}

/* --- 头像向下溢出量必须小于浮窗间距 ---
   这条是跨文件的几何约束：头像放大后浮窗仍然贴按钮下沿，
   若溢出量超过间距，浮窗会压住吉祥物的下巴（v2.8.5 已经踩过一次）。 */
{
  const WIN_JS = path.join(ROOT, 'src/content/ui/modal-window.js');
  const winSrc = fs.readFileSync(WIN_JS, 'utf8');
  const gm = winSrc.match(/const\s+BTN_GAP\s*=\s*(\d+)/);
  ok('浮窗有独立的「贴按钮间距」常量 BTN_GAP', !!gm && /y\s*=\s*r\.bottom\s*\+\s*BTN_GAP/.test(winSrc));

  const ringW = Number((ringRule.match(/width:\s*(\d+)px/) || [])[1] || 0);
  ok('能读到头像容器宽度（否则下面的几何断言会假绿）', ringW > 40, 'ringW=' + ringW);

  const buf = fs.readFileSync(path.join(ROOT, 'icons/mascot/mascot.png'));
  const pw = buf.readUInt32BE(16);
  const ph = buf.readUInt32BE(20);
  const drawH = ringW * (ph / pw);            // background-size:contain → 按宽度铺满
  const overflow = Math.max(0, (drawH - 48) / 2);  // 按钮高 48px，上下平分溢出

  ok(`头像向下溢出 ${overflow.toFixed(1)}px 小于浮窗间距 ${gm ? gm[1] : '?'}px`,
    !!gm && overflow < Number(gm[1]), `溢出 ${overflow.toFixed(1)}px`);
}
ok('按钮自身 overflow 可见（头像要溢出上下沿）',
  /overflow:\s*visible/.test(btnRule), btnRule);
ok('主色统一成设计系统蓝 #056bf4',
  /button\.media-extractor-button\s*\{[\s\S]{0,400}?background:\s*#056bf4/.test(CSS_CODE));

/* ============================================================
 * 四、浮窗按钮顺序（静态契约，锚在非编辑分支的 push 块上）
 * ==========================================================*/
function nonEditPushBlock(src) {
  // 从「第一档 三种复制」注释往后截到该 push 调用的右括号
  const i = src.indexOf('第一档 三种复制');
  if (i < 0) return '';
  const j = src.indexOf('buttons.push(', i);
  if (j < 0) return '';
  let depth = 0;
  for (let k = src.indexOf('(', j); k < src.length; k++) {
    if (src[k] === '(') depth++;
    else if (src[k] === ')') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  return '';
}

const BLOCK = nonEditPushBlock(MODAL_CODE);

function orderOf(tokens) {
  return tokens.map((t) => ({ t, i: BLOCK.indexOf(t) }));
}

{
  ok('找得到浮窗非编辑态的按钮装配块', BLOCK.length > 0);

  const seq = ['copyMarkdownBtn', 'copyDataBtn', 'makePlainTextBtn()', 'makeTitleDivider()',
    'enterEditModeBtn', 'makeSearchBtn()', 'toggleDisplayModeBtn', 'makeResetOrderBtn()', 'makeMinimizeBtn()'];
  const pos = orderOf(seq);
  pos.forEach((p, idx) => {
    ok(`装配块里出现 ${p.t}`, p.i >= 0);
    if (idx > 0) ok(`${seq[idx - 1]} 排在 ${p.t} 前面`, pos[idx - 1].i >= 0 && p.i > pos[idx - 1].i);
  });

  ok('复制 Markdown 排在复制 Notion 之前（高频在前）',
    BLOCK.indexOf('copyMarkdownBtn') < BLOCK.indexOf('copyDataBtn'));
  ok('三个复制按钮都排在细线之前',
    BLOCK.indexOf('makePlainTextBtn()') < BLOCK.indexOf('makeTitleDivider()'));
  ok('补齐网址也排在细线之前（豆瓣/影视页常用）',
    BLOCK.indexOf('makeCrossSiteBtn') < BLOCK.indexOf('makeTitleDivider()') ||
    BLOCK.indexOf('canCrossSite') < BLOCK.indexOf('makeTitleDivider()'));
  ok('低频组（编辑/搜索/横向/重置/最小化）排在细线之后',
    BLOCK.indexOf('makeTitleDivider()') < BLOCK.indexOf('enterEditModeBtn') &&
    BLOCK.indexOf('makeTitleDivider()') < BLOCK.indexOf('toggleDisplayModeBtn'));
}

ok('横向/纵向不再「无条件插到最前面」',
  !/^\s*buttons\.push\(toggleDisplayModeBtn\);\s*$/m.test(MODAL_CODE));

ok('复制 Markdown 是唯一实心蓝主按钮（#056bf4 + 白字）',
  /copyMarkdownBtn\.style\.cssText\s*=\s*`[\s\S]{0,400}?background:\s*#056bf4[\s\S]{0,80}?color:\s*#ffffff/.test(MODAL_CODE));

ok('全部按钮里只有一处 #056bf4 做主色（没有第二个主按钮）',
  (MODAL_CODE.match(/background:\s*#056bf4/g) || []).length === 1);

ok('「编辑」不再是实心蓝（降级为 ghost）',
  /enterEditModeBtn\.style\.cssText\s*=\s*`[\s\S]{0,300}?background:\s*transparent[\s\S]{0,80}?color:\s*#6b7278/.test(MODAL_CODE));

ok('分隔线是真元素（span + class），不是伪元素',
  /createElement\('span'\)[\s\S]{0,200}?floating-window-title-divider/.test(MODAL_CODE));

ok('阴影 DOM 样式表里有分隔线规则',
  /\.floating-window-title-divider\s*\{[\s\S]{0,200}?width:\s*1px/.test(
    fs.readFileSync(path.join(ROOT, 'src/content/ui/floating-window-styles.js'), 'utf8')));

/* --- 复制反馈必须还原字色（否则蓝底变灰字） --- */
ok('复制反馈记住原始字色',
  /btn\.dataset\.idleColor\s*=/.test(MODAL_CODE));
ok('复制反馈还原时用记住的字色，不写死 #333',
  /btn\.style\.color\s*=\s*idleColor/.test(MODAL_CODE) &&
  !/btn\.style\.color\s*=\s*'#333'/.test(MODAL_CODE));

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
