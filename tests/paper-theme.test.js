/**
 * 纸色落地 + popup 空状态 契约测试（v2.9.1）
 *
 * 为什么要有这个文件：
 * 设计系统里早就定了纸色（--paper #F7F6F2 那一套），但代码里散着 150 多处旧灰蓝/旧紫，
 * 文档和实现长期对不上。这一轮把它们统一了，所以必须把「文档里的色值 == 代码里的色值」
 * 钉成断言 —— 否则下次谁手改一处，界面就悄悄回到旧配色，而且没人能发现。
 *
 * 断言分四组：
 *   一、文档与实现同一个值（从设计系统 HTML 里读 token，跟代码比对）
 *   二、旧色不许回来（列名单，逐个查）
 *   三、同一语义在三处必须同色（浮窗 / 页面提示条 / popup）
 *   四、popup 空状态的结构与文案
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const SRC = path.join(CHROME, 'src');

const F = {
  design: path.join(ROOT, '设计系统', 'ClipMate_设计系统_v1.html'),
  windowStyles: path.join(SRC, 'content/ui/floating-window-styles.js'),
  pageStyles: path.join(SRC, 'content/content-styles.css'),
  notice: path.join(SRC, 'content/ui/notice.js'),
  popupCss: path.join(SRC, 'popup/popup.css'),
  popupHtml: path.join(SRC, 'popup/popup.html'),
  popupJs: path.join(SRC, 'popup/popup.js'),
  manifest: path.join(CHROME, 'manifest.json')
};

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
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name + (a === b ? '' : '  ← 期望 ' + b), a === b, actual);
}

function section(t) {
  console.log('\n' + C.bold + t + C.reset);
}

const read = (p) => fs.readFileSync(p, 'utf8');

const DESIGN = read(F.design);
const WIN = read(F.windowStyles);
const PAGE = read(F.pageStyles);
const POPUP_CSS = read(F.popupCss);
const POPUP_HTML = read(F.popupHtml);
const POPUP_JS = read(F.popupJs);

/** 从设计系统 HTML 的 :root 里取一个 token 的值（取第一次出现） */
function token(name) {
  const m = new RegExp('--' + name + '\\s*:\\s*(#[0-9a-fA-F]{3,8})').exec(DESIGN);
  return m ? m[1].toUpperCase() : null;
}

/** 取某条规则块里某个属性的值（块内第一次出现） */
function propIn(css, selector, prop) {
  const sel = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(sel + '\\s*\\{([^}]*)\\}').exec(css);
  if (!m) return null;
  const p = new RegExp('(?:^|;|\\s)' + prop + '\\s*:\\s*([^;]+);').exec(m[1]);
  return p ? p[1].trim() : null;
}

/**
 * 把 var(--cm-x, 回退值) 还原成回退值。
 *
 * v2.9.3 起浮窗/按钮的颜色从写死改成走 --cm-* 变量（为了能整体切深色），
 * 断言不能因此失效 —— 否则「改个变量名」就能让这条测试永远是绿的。
 * 这里剥掉变量壳，比对的仍然是「最终会渲染成什么颜色」。
 *
 * 为什么手写括号计数而不是正则：回退值本身可能带括号，
 * 例如 var(--cm-shadow-a30, rgba(0, 0, 0, 0.3))，正则会把 rgba 的 ) 当成结尾。
 */
function resolveVars(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  let guard = 0;
  while (out.indexOf('var(') !== -1 && guard++ < 50) {
    const start = out.lastIndexOf('var(');
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < out.length; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) break;
    const inner = out.slice(start + 4, end);
    let d = 0;
    let comma = -1;
    for (let i = 0; i < inner.length; i++) {
      if (inner[i] === '(') d++;
      else if (inner[i] === ')') d--;
      else if (inner[i] === ',' && d === 0) { comma = i; break; }
    }
    if (comma === -1) break;                       // 没有回退值的 var 不动它
    const fallbackValue = inner.slice(comma + 1).trim();
    out = out.slice(0, start) + fallbackValue + out.slice(end + 1);
  }
  return out;
}

/* ============================================================
   一、文档里的 token 与代码里的实际值必须是同一个字符串
   ============================================================ */
section('一、设计系统的色板与代码实际值对齐');

const PAPER = token('paper');
const LINE = token('line');
const SURFACE2 = token('surface-2');
const INK = token('ink');

ok('设计系统里能读到 --paper', !!PAPER, PAPER);
ok('设计系统里能读到 --line', !!LINE, LINE);

eq('popup 底色 = 文档 --paper', (propIn(POPUP_CSS, 'body', 'background') || '').toUpperCase(), PAPER);
eq('浮窗内容区底色 = 文档 --paper',
  resolveVars(propIn(WIN, '.floating-window-content', 'background') || '').toUpperCase(), PAPER);
eq('浮窗标题栏底色 = 文档 --surface-2',
  resolveVars(propIn(WIN, '.floating-window-header', 'background') || '').toUpperCase(), SURFACE2);
eq('浮窗标题栏下边框 = 文档 --line',
  resolveVars(propIn(WIN, '.floating-window-header', 'border-bottom') || '').replace(/\s+/g, ' ').toUpperCase(),
  '1PX SOLID ' + LINE);
eq('浮窗正文字色 = 文档 --ink',
  resolveVars(propIn(WIN, '.floating-window-content', 'color') || '').toUpperCase(), INK);

// 收起后的胶囊也是一张纸，不能退回纯白
eq('胶囊底色 = 文档 --paper',
  resolveVars(propIn(WIN, '.floating-window-capsule', 'background') || '').toUpperCase(), PAPER);

// 外层兜底容器（content-styles.css 里那条 !important）也要跟着，否则外层白底会盖住纸色
ok('浮窗外层兜底背景也是纸色（content-styles.css）',
  resolveVars(propIn(PAGE, '.media-floating-window', 'background-color') || '')
    .replace(/\s*!important/gi, '').toUpperCase() === PAPER,
  (propIn(PAGE, '.media-floating-window', 'background-color') || ''));

/* ============================================================
   二、旧色名单：一个都不许回来
   ============================================================ */
section('二、旧配色已清除，不许回流');

const OLD = [
  ['#f5f5f5', '旧浮窗灰底'],
  ['#e5e5e5', '旧分隔线'],
  ['#eaf3de', '旧成功绿'],
  ['#fcebeb', '旧失败红'],
  ['#e6f1fb', '旧信息蓝'],
  ['#185fa5', '旧链接蓝'],
  ['#0066cc', '旧表格链接蓝']
];

OLD.forEach(([hex, label]) => {
  const re = new RegExp(hex.replace('#', '#'), 'i');
  const hits = [];
  if (re.test(WIN)) hits.push('floating-window-styles.js');
  if (re.test(PAGE)) hits.push('content-styles.css');
  ok('浮窗与页面样式里没有 ' + hex + '（' + label + '）', hits.length === 0, hits.join(','));
});

const OLD_POPUP = [
  ['#6d5ce7', '旧紫色开关'],
  ['#4c1d95', '旧深紫'],
  ['#ddd6fe', '旧淡紫边框'],
  ['#1b2130', '旧深蓝底'],
  ['#f6f7f9', '旧行分隔灰']
];
OLD_POPUP.forEach(([hex, label]) => {
  ok('popup.css 里没有 ' + hex + '（' + label + '）', !new RegExp(hex, 'i').test(POPUP_CSS));
});

// 品牌蓝必须还是那一个（按钮主色不能被顺手改掉）
ok('主按钮仍是品牌蓝 #056bf4（没被本轮换色带走）',
  resolveVars(propIn(PAGE, '.media-extractor-button', 'background') || '').toUpperCase().indexOf('#056BF4') !== -1,
  (propIn(PAGE, '.media-extractor-button', 'background') || ''));

/* ============================================================
   三、同一语义在三处必须同色
   ============================================================ */
section('三、同一语义在浮窗 / 页面提示条 / 图标里同色');

const winOk = propIn(WIN, '.clipmate-notice--success', 'background');
const pageOk = propIn(PAGE, '.clipmate-notice--page.clipmate-notice--success', 'background');
eq('成功底色：浮窗与页面条一致（都去掉 !important 后比）',
  (winOk || '').toUpperCase(), (pageOk || '').replace(/\s*!important/, '').toUpperCase());

const winBad = propIn(WIN, '.clipmate-notice--error', 'background');
const pageBad = propIn(PAGE, '.clipmate-notice--page.clipmate-notice--error', 'background');
eq('失败底色：浮窗与页面条一致',
  (winBad || '').toUpperCase(), (pageBad || '').replace(/\s*!important/, '').toUpperCase());

const winInfo = propIn(WIN, '.clipmate-notice--info', 'background');
const pageInfo = propIn(PAGE, '.clipmate-notice--page.clipmate-notice--info', 'background');
eq('信息底色：浮窗与页面条一致',
  (winInfo || '').toUpperCase(), (pageInfo || '').replace(/\s*!important/, '').toUpperCase());

const NOTICE = read(F.notice);
const okIcon = /success:\s*\{\s*fill:\s*'(#[0-9a-fA-F]{6})'/.exec(NOTICE);
ok('提示图标用自己的语义色（成功）', !!okIcon, okIcon && okIcon[1]);
ok('成功图标色与成功条左边线同色',
  !!okIcon && new RegExp(okIcon[1], 'i').test(propIn(WIN, '.clipmate-notice--success', 'border-left-color') || ''),
  okIcon && okIcon[1]);

/* ============================================================
   四、popup 空状态
   ============================================================ */
section('四、popup 空状态（吉祥物 + 一句话 + 出口）');

ok('popup.html 有 #popEmpty 容器', /id="popEmpty"/.test(POPUP_HTML));
ok('空状态里有吉祥物 image（v2.9.2 起是矢量形态）',
  /class="pop-empty-art"[^>]*src="\.\.\/\.\.\/icons\/mascot\/[a-z-]+\.svg"/.test(POPUP_HTML),
  (POPUP_HTML.match(/pop-empty-art[^>]*/) || [''])[0]);
ok('吉祥物素材是 24 个矢量形态（旧 mascot.png 已退役；v2.10.0 加了整理档案那张）',
  fs.readdirSync(path.join(CHROME, 'icons/mascot')).filter((f) => f.endsWith('.svg')).length === 24);
ok('空状态标题用设计稿文案',
  /id="popEmptyTitle"[^>]*>这个页面还没有可提取的内容</.test(POPUP_HTML));
ok('空状态有「查看支持的站点」出口', /id="openSites"[^>]*>查看支持的站点</.test(POPUP_HTML));

ok('css 有 .pop-empty 版式', /\.pop-empty\s*\{/.test(POPUP_CSS));
ok('css 里空状态默认隐藏（[hidden] 有 display:none）',
  /\.pop-empty\[hidden\]\s*\{[^}]*display:\s*none/.test(POPUP_CSS));
ok('css 里空状态描述做了两行均衡（text-wrap: balance）',
  /\.pop-empty-desc\s*\{[^}]*text-wrap:\s*balance/.test(POPUP_CSS));
ok('深色主题给空状态标题另配了亮色',
  /\.theme-dark\s+\.pop-empty-title\s*\{[^}]*color:\s*#F5F1E8/i.test(POPUP_CSS));

ok('js 有 _showEmpty 方法（v2.9.2 多了第三个参数：换用哪张图）',
  /_showEmpty\s*\(\s*title\s*,\s*desc\s*,\s*art\s*\)/.test(POPUP_JS));
ok('两种「空」用两张不同的图（内部页 face-blank / 没收录 hero-peek）',
  /'face-blank'/.test(POPUP_JS) && /'hero-peek'/.test(POPUP_JS));
ok('js 里内部页走空状态（浏览器自己的页面读不到）',
  /浏览器自己的页面读不到/.test(POPUP_JS));
ok('js 里没收录的站走空状态', /这个页面还没有可提取的内容/.test(POPUP_JS));
ok('空状态会收起设置行（不留能点但没用的开关）',
  /document\.getElementById\('siteRows'\)\.hidden\s*=\s*true/.test(POPUP_JS));
ok('空状态出口指到设置页的 #sites', /'#sites'/.test(POPUP_JS));

// 旧行为必须真的被删掉：不能再残留「不支持单独设置」那行灰字
ok('旧的「不支持单独设置」灰字已移除', !/不支持单独设置/.test(POPUP_JS) && !/不支持单独设置/.test(POPUP_HTML));

/* ============================================================
   四·五、深色可切换（v2.9.3）
   ============================================================ */
section('四·五、深色站点上整体换暖黑');

// 变量层存在的理由就是「能整体切」，所以先确认颜色真的走了变量，不是又写死一份
ok('浮窗底色走 --cm-bg 变量（不是写死）', /background:\s*var\(--cm-bg/.test(WIN));
ok('页面按钮底色走 --cm-blue 变量', /background:\s*var\(--cm-blue/.test(PAGE));
ok('深色组 .clipmate-dark 在页面样式里', /\.clipmate-dark\s*\{/.test(PAGE));

const darkBlock = (/\.clipmate-dark\s*\{([^}]*)\}/.exec(PAGE) || [null, ''])[1];
ok('深色底色是暖黑 #191817', /--cm-bg:\s*#191817/i.test(darkBlock), darkBlock.slice(0, 40));
ok('深色正文字是暖白 #EDE9E0', /--cm-ink:\s*#EDE9E0/i.test(darkBlock));
ok('深色强调色是浅蓝 #8FB6FF', /--cm-blue:\s*#8FB6FF/i.test(darkBlock));
// 浅蓝底上必须是深字。复用 --cm-white 就会变成「浅蓝底 + 暖白字」，糊成一片
ok('强调色上的文字在深色下反向变深', /--cm-on-accent:\s*#1[0-9a-f]{5}/i.test(darkBlock));

/** 取某选择器块里定义的全部 --cm-* 变量名 */
function varsIn(block) {
  const names = new Set();
  const re = /--cm-([a-z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(block)) !== null) names.add(m[1]);
  return names;
}
const rootVars = varsIn((/:root\s*\{([^}]*)\}/.exec(PAGE) || [null, ''])[1]);
const darkVars = varsIn(darkBlock);
const missingVars = [...rootVars].filter((v) => !darkVars.has(v));
ok('深色组覆盖了全部 ' + rootVars.size + ' 个变量（少一个就在深色下露浅色）',
  rootVars.size >= 35 && missingVars.length === 0, missingVars.join(', '));

/* ---- 待命按钮在深色下必须「沉下去」，不能跟着强调色变亮 ----
   这是本轮最容易做反的一处：--cm-blue 在深色下翻成浅蓝（那是给字和边用的），
   按钮底要是也用它，黑色页面上就是一块亮蓝板，比原来的白底更刺眼。 */
const btnRule = propIn(PAGE, 'button.media-extractor-button', 'background') || '';
ok('待命按钮底色走 --cm-btn 专用变量（不跟 --cm-blue 变亮）',
  /var\(--cm-btn,/.test(btnRule), btnRule);
ok('深色下按钮底色是暖黑面 #222120',
  /--cm-btn:\s*#222120/i.test(darkBlock));
ok('深色下按钮字色是浅蓝 #8FB6FF',
  /--cm-btn-ink:\s*#8FB6FF/i.test(darkBlock));
ok('待命按钮字色也走变量', /color:\s*var\(--cm-btn-ink,/.test(PAGE));
// 成功/失败是瞬态反馈，底保持亮色；但亮底上必须换成近黑字，否则浅色字糊在亮绿/亮红上
ok('成功态显式给了字色（不继承按钮默认字色）',
  /\.media-extractor-button\.success\s*\{[^}]*color:\s*var\(--cm-on-accent/.test(PAGE.replace(/\n/g, ' ')));
ok('失败态显式给了字色',
  /\.media-extractor-button\.error\s*\{[^}]*color:\s*var\(--cm-on-accent/.test(PAGE.replace(/\n/g, ' ')));

// 判定模块必须真被加载，否则 .clipmate-dark 永远不会挂上去
const MANIFEST_RAW = read(F.manifest);
const jsList = (MANIFEST_RAW.match(/"src\/content\/ui\/[a-z-]+\.js"/g) || []);
ok('site-theme.js 已登记进 content_scripts',
  jsList.some((x) => x.indexOf('site-theme') !== -1), jsList.length + ' 个 ui 模块');
const idxTheme = MANIFEST_RAW.indexOf('src/content/ui/site-theme.js');
const idxFwStyles = MANIFEST_RAW.indexOf('src/content/ui/floating-window-styles.js');
ok('site-theme.js 排在浮窗样式之前加载（按钮/浮窗创建时就能用）',
  idxTheme !== -1 && idxFwStyles !== -1 && idxTheme < idxFwStyles);

/* ============================================================
   五、设置页也进纸色体系（v2.9.3）
   ============================================================ */
section('五、设置页配色');

const OPT_CSS = read(path.join(SRC, 'options/options.css'));
const optLight = (/:root\s*\{([^}]*)\}/.exec(OPT_CSS) || [null, ''])[1];
const optDark = (/html\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(OPT_CSS) || [null, ''])[1];
const optForceLight = (/html\[data-theme="light"\]\s*\{([^}]*)\}/.exec(OPT_CSS) || [null, ''])[1];

ok('设置页浅色底 = 纸色 #F7F6F2', /--bg:\s*#F7F6F2/i.test(optLight));
ok('设置页强调色 = 品牌蓝 #056BF4', /--accent:\s*#056BF4/i.test(optLight));
ok('设置页深色底 = 暖黑 #191817', /--bg:\s*#191817/i.test(optDark));
ok('设置页深色正文字 = 暖白 #EDE9E0', /--ink:\s*#EDE9E0/i.test(optDark));
// 这是本轮修掉的真 bug：只覆盖前 16 个变量的话，「系统深色 + 手动选浅色」
// 会让 --danger 一直是粉色，浅底上「删除」这类字发飘
ok('手动选浅色时把 --danger / --shadow 一起给回来',
  /--danger:/.test(optForceLight) && /--shadow:/.test(optForceLight));
ok('设置页三套变量个数一致（不会漏定义）',
  varsIn(optLight).size === varsIn(optDark).size &&
  varsIn(optLight).size === varsIn(optForceLight).size,
  [varsIn(optLight).size, varsIn(optDark).size, varsIn(optForceLight).size].join(' / '));

// 旧色名单：设置页原来那套紫灰必须清干净
ok('设置页没有旧紫 #6b4ef2 残留', !/6b4ef2/i.test(OPT_CSS));
ok('设置页没有旧浅紫 #9b8cff 残留', !/9b8cff/i.test(OPT_CSS));
ok('设置页没有旧冷灰底 #f6f7f8 残留', !/f6f7f8/i.test(OPT_CSS));

/* ============================================================
   六、版本号
   ============================================================ */
section('六、版本号');

const MANIFEST = JSON.parse(read(F.manifest));
eq('manifest 版本是 2.11.1', MANIFEST.version, '2.11.1');

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
