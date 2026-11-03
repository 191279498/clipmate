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
  (propIn(WIN, '.floating-window-content', 'background') || '').toUpperCase(), PAPER);
eq('浮窗标题栏底色 = 文档 --surface-2',
  (propIn(WIN, '.floating-window-header', 'background') || '').toUpperCase(), SURFACE2);
eq('浮窗标题栏下边框 = 文档 --line',
  (propIn(WIN, '.floating-window-header', 'border-bottom') || '').replace(/\s+/g, ' ').toUpperCase(),
  '1PX SOLID ' + LINE);
eq('浮窗正文字色 = 文档 --ink',
  (propIn(WIN, '.floating-window-content', 'color') || '').toUpperCase(), INK);

// 收起后的胶囊也是一张纸，不能退回纯白
eq('胶囊底色 = 文档 --paper',
  (propIn(WIN, '.floating-window-capsule', 'background') || '').toUpperCase(), PAPER);

// 外层兜底容器（content-styles.css 里那条 !important）也要跟着，否则外层白底会盖住纸色
ok('浮窗外层兜底背景也是纸色（content-styles.css）',
  /\.media-floating-window\s*\{[^}]*background-color:\s*#F7F6F2/i.test(PAGE),
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
  /button\.media-extractor-button\s*\{[^}]*background:\s*#056bf4/i.test(PAGE));

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
ok('空状态里有吉祥物 image', /class="pop-empty-art"[^>]*src="\.\.\/\.\.\/icons\/mascot\/mascot\.png"/.test(POPUP_HTML),
  (POPUP_HTML.match(/pop-empty-art[^>]*/) || [''])[0]);
ok('吉祥物母版文件存在',
  fs.existsSync(path.join(CHROME, 'icons/mascot/mascot.png')));
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

ok('js 有 _showEmpty 方法', /_showEmpty\s*\(\s*title\s*,\s*desc\s*\)/.test(POPUP_JS));
ok('js 里内部页走空状态（浏览器自己的页面读不到）',
  /浏览器自己的页面读不到/.test(POPUP_JS));
ok('js 里没收录的站走空状态', /这个页面还没有可提取的内容/.test(POPUP_JS));
ok('空状态会收起设置行（不留能点但没用的开关）',
  /document\.getElementById\('siteRows'\)\.hidden\s*=\s*true/.test(POPUP_JS));
ok('空状态出口指到设置页的 #sites', /'#sites'/.test(POPUP_JS));

// 旧行为必须真的被删掉：不能再残留「不支持单独设置」那行灰字
ok('旧的「不支持单独设置」灰字已移除', !/不支持单独设置/.test(POPUP_JS) && !/不支持单独设置/.test(POPUP_HTML));

/* ============================================================
   五、版本号
   ============================================================ */
section('五、版本号');

const MANIFEST = JSON.parse(read(F.manifest));
eq('manifest 版本是 2.9.1', MANIFEST.version, '2.9.1');

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
