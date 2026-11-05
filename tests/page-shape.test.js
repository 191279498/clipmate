/**
 * v2.10.0 —— 页面形态判定 + 作者档案皮肤
 *
 * 用户 2026-11-04 的三条要求，逐条钉死：
 *   1. 微博非单条详情页（首页 / 热门 / 搜索）不要出现大提取按钮，
 *      但**作者主页要保留**（它提的是整份档案，不是某条内容）；
 *   2. 微博搜索页 s.weibo.com 的「滚动自动关浮窗」要和首页一致
 *      （根因是站点清单漏登记这个域名，被当成陌生站）；
 *   3. 「顺手对齐其他同类站」—— 拍板只做**有逐条小按钮**的站（微博 / X / IG），
 *      抖音 / 快手 / B站 / YouTube / 小红书 一律不碰（它们没有小按钮，藏了就没入口）。
 *
 * 另外两条新行为：
 *   · 作者档案页的大按钮换成「档案皮肤」（新吉祥物 + 深蓝底金黄边 + 整理档案）；
 *   · 点逐帖小按钮开窗时，浮窗贴那颗小按钮下方（信息流页没有大按钮可贴）。
 *
 * 断言写法约定（防假绿）：每条都要能在「把实现改坏」时真的变红。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

const PageShape = require(path.join(SRC, 'src/content/utils/page-shape.js'));

const CONTENT_MAIN = read('src/content/content-main.js');
const BUTTON_MANAGER = read('src/content/ui/button-manager.js');
const MODAL_WINDOW = read('src/content/ui/modal-window.js');
const CSS = read('src/content/content-styles.css');
const MANIFEST = JSON.parse(read('manifest.json'));
const SITE_CONFIG = read('src/shared/site-config.js');
const WEIBO_MIXIN = read('src/content/ui/weibo-spa-handler.js');
const X_MIXIN = read('src/content/ui/x-spa-handler.js');
const IG_MIXIN = read('src/content/ui/ig-spa-handler.js');
const WEIBO_BTN = read('src/content/ui/weibo-feed-buttons.js');
const X_BTN = read('src/content/ui/x-feed-buttons.js');
const IG_BTN = read('src/content/ui/instagram-feed-buttons.js');

let pass = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? '  → ' + String(detail).slice(0, 200) : ''));
}

function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expect));
}

/* ============================================================
 * A. shapeOf：每个站的「信息流 / 详情 / 档案」判定
 * ==========================================================*/
console.log('A. 页面形态判定（表驱动）');

const CASES = [
  // ---- 微博主站 ----
  ['微博首页算信息流', 'weibo.com', '/', null, 'feed'],
  ['微博热门算信息流', 'weibo.com', '/hot/weibo/102803', 'social', 'feed'],
  ['微博站内搜索算信息流', 'weibo.com', '/weibo', 'social', 'feed'],
  ['微博单条博文算详情', 'weibo.com', '/1188742767/Rp4Su9dUT', 'social', 'detail'],
  ['微博单条博文带尾斜杠', 'weibo.com', '/1188742767/Rp4Su9dUT/', 'social', 'detail'],
  ['微博 /detail/ 短链算详情', 'weibo.com', '/detail/Rp4Su9dUT', 'social', 'detail'],
  ['微博作者主页保留（person）', 'weibo.com', '/u/1188742767', 'person', 'person'],
  ['微博自定义域名作者主页保留', 'weibo.com', '/someone', 'person', 'person'],
  ['www.weibo.com 与 weibo.com 同口径', 'www.weibo.com', '/hot/weibo/102803', 'social', 'feed'],
  // ---- 手机版微博 ----
  ['手机版首页算信息流', 'm.weibo.cn', '/', 'social', 'feed'],
  ['手机版 /detail/ 算详情', 'm.weibo.cn', '/detail/Rp4Su9dUT', 'social', 'detail'],
  ['手机版 /status/ 算详情', 'm.weibo.cn', '/status/Rp4Su9dUT', 'social', 'detail'],
  ['手机版作者主页放行（media-detector 无 person 规则）', 'm.weibo.cn', '/profile/1188742767', 'social', 'detail'],
  // ---- 微博搜索页（独立域名）----
  ['搜索页整页都是内容流', 's.weibo.com', '/weibo', 'social', 'feed'],
  ['搜索页任意路径都算内容流', 's.weibo.com', '/weibo?q=%E7%8C%AB', 'social', 'feed'],
  // ---- X ----
  ['X 首页算信息流', 'x.com', '/home', 'social', 'feed'],
  ['X 探索页算信息流', 'x.com', '/explore', 'social', 'feed'],
  ['X 搜索页算信息流', 'x.com', '/search', 'social', 'feed'],
  ['X 通知页算信息流', 'x.com', '/notifications', 'social', 'feed'],
  ['X 单条推文算详情', 'x.com', '/elonmusk/status/1723456789012345678', 'social', 'detail'],
  ['X /i/status/ 算详情', 'x.com', '/i/status/1723456789012345678', 'social', 'detail'],
  ['X 个人主页保留（person）', 'x.com', '/elonmusk', 'person', 'person'],
  ['www.x.com 与 x.com 同口径', 'www.x.com', '/home', 'social', 'feed'],
  // ---- 本次刻意不碰的站 ----
  ['抖音没配规则 → 不知道', 'www.douyin.com', '/', 'social', 'unknown'],
  ['抖音作品页也没配（照旧显示）', 'www.douyin.com', '/video/7300000000000000000', 'social', 'unknown'],
  ['快手推荐流没配', 'www.kuaishou.com', '/new-reco', 'social', 'unknown'],
  ['B站首页没配', 'www.bilibili.com', '/', 'social', 'unknown'],
  ['YouTube 首页没配', 'www.youtube.com', '/', 'social', 'unknown'],
  ['小红书没配', 'www.xiaohongshu.com', '/explore', 'social', 'unknown'],
  ['IG 没配藏按钮的规则（显隐仍归它自己）', 'www.instagram.com', '/', 'social', 'unknown'],
  ['完全未知站点', 'example.com', '/anything', null, 'unknown'],
  // ---- 异常入参不许炸 ----
  ['空入参给 unknown 而不是抛错', null, null, null, 'unknown']
];

CASES.forEach(function (c) {
  const ctx = c[1] === null ? null : { hostname: c[1], pathname: c[2], mediaType: c[3] };
  eq(c[0], PageShape.shapeOf(ctx), c[4]);
});

/* ============================================================
 * B. 该不该藏大按钮
 * ==========================================================*/
console.log('B. 大按钮显隐判定');

eq('信息流 → 藏', PageShape.shouldHideMainButton({ hostname: 'weibo.com', pathname: '/', mediaType: 'social' }), true);
eq('详情页 → 显示', PageShape.shouldHideMainButton({ hostname: 'weibo.com', pathname: '/1188742767/Rp4Su9dUT', mediaType: 'social' }), false);
eq('作者主页 → 显示', PageShape.shouldHideMainButton({ hostname: 'weibo.com', pathname: '/u/1188742767', mediaType: 'person' }), false);
eq('没配规则的站 → 显示（宁多不漏）', PageShape.shouldHideMainButton({ hostname: 'www.douyin.com', pathname: '/', mediaType: 'social' }), false);
eq('空入参 → 不藏', PageShape.shouldHideMainButton(null), false);

/* ============================================================
 * C. 哪些站需要盯地址变化
 * ==========================================================*/
console.log('C. 地址监听范围');

ok('微博主站要盯', PageShape.watches('weibo.com'));
ok('微博主站带 www 也要盯', PageShape.watches('www.weibo.com'));
ok('手机版微博要盯', PageShape.watches('m.weibo.cn'));
ok('微博搜索页要盯', PageShape.watches('s.weibo.com'));
ok('X 要盯', PageShape.watches('x.com'));
ok('抖音不盯（一个定时器都不多）', !PageShape.watches('www.douyin.com'));
// v2.12.5：原先这里是「IG 不盯」。真机抓到 IG 主页点开帖子后按钮仍顶着「整理档案」
// 却提这一条作品 —— 它的入口显隐只管露不露、不管皮肤，站内换页没人重算皮肤。
ok('IG 要盯（站内点开帖子要重算皮肤）', PageShape.watches('www.instagram.com'));
ok('IG 带裸域也要盯', PageShape.watches('instagram.com'));

/* ============================================================
 * C2. IG 纳入监听的安全性（v2.12.5）
 *
 * 关键前提：IG 在这套规则里**永远算不出 feed**。
 * 一旦哪天有人给 IG 加了 RULES，`_applyPageShape()` 就会开始 setVisible(false)，
 * 把 IG 自己（`_syncInstagramEntryVisibility`）管着的按钮藏掉 —— 那套藏/露是按
 * 「弹层开没开」算的，跟我们按路径算的不是一回事。这里逐条钉死。
 * ==========================================================*/
console.log('C2. IG 纳入监听的安全性');

const IG_PATHS = [
  ['/', 'social'],                                   // 首页信息流
  ['/explore/', 'social'],                           // 探索页
  ['/nayawashi/', 'person'],                         // 作者主页
  ['/nayawashi/reels/', 'social'],                   // 某人 reels 列表
  ['/p/DQRQZ6kE6a3/', 'social'],                     // 帖子详情 / 弹层
  ['/reel/DfWutqaAg5F/', 'social'],                  // reel 详情
  ['/stories/nayawashi/123456/', 'social'],          // story
  ['/accounts/login/', 'social'],                    // 登录页
  ['/direct/inbox/', 'social']                       // 私信
];

IG_PATHS.forEach(function (p) {
  const shape = PageShape.shapeOf({ hostname: 'www.instagram.com', pathname: p[0], mediaType: p[1] });
  ok('IG ' + p[0] + ' 不算「信息流」（不会触发藏按钮）', shape !== 'feed', '实际 ' + shape);
  eq('IG ' + p[0] + ' 的形态', shape, p[1] === 'person' ? 'person' : 'unknown');
  eq('IG ' + p[0] + ' 不藏大按钮', PageShape.shouldHideMainButton({
    hostname: 'www.instagram.com', pathname: p[0], mediaType: p[1]
  }), false);
});


/* ============================================================
 * D. 静态接线：光有判定不够，得接进流程
 * ==========================================================*/
console.log('D. 接线');

const pageShapeScript = MANIFEST.content_scripts[0].js.indexOf('src/content/utils/page-shape.js');
ok('manifest 注册了 page-shape.js', pageShapeScript !== -1);
ok('page-shape.js 排在 content-main.js 之前',
  pageShapeScript !== -1 && pageShapeScript < MANIFEST.content_scripts[0].js.indexOf('src/content/content-main.js'));

ok('init 里调了 _applyPageShape', /this\._applyPageShape\(\)/.test(CONTENT_MAIN));
ok('init 里调了 _startPageShapeWatcher', /this\._startPageShapeWatcher\(\)/.test(CONTENT_MAIN));
ok('_applyPageShape 用 PageShape.shapeOf 判定',
  /PageShape\.shapeOf\(\{/.test(CONTENT_MAIN));
ok('_applyPageShape 只在 person 时换档案皮肤',
  /bm\.setSkin\(shape === 'person' \? 'arch' : 'default'\)/.test(CONTENT_MAIN));
ok('显隐：用户关掉按钮时任何站都藏',
  /if \(this\._showButtonByConfig === false\) \{\s*bm\.setVisible\(false\);/.test(CONTENT_MAIN));
ok('显隐：信息流页藏',
  /\} else if \(shape === 'feed'\) \{\s*bm\.setVisible\(false\);/.test(CONTENT_MAIN));
ok('显隐：没配规则的站一个字节都不碰（IG / 抖音有自己的显隐主人）',
  /\} else if \(shape !== 'unknown'\) \{\s*bm\.setVisible\(true\);/.test(CONTENT_MAIN));
ok('refreshConfig 记下了配置层面的显示意愿',
  /this\._showButtonByConfig = eff\.showButton !== false;/.test(CONTENT_MAIN));
ok('refreshConfig 不再自己直接 setVisible（避免覆盖形态判定）',
  !/this\.buttonManager\.setVisible\(eff\.showButton !== false\)/.test(CONTENT_MAIN));

ok('地址监听包了 pushState', /wrap\('pushState'\)/.test(CONTENT_MAIN));
ok('地址监听包了 replaceState', /wrap\('replaceState'\)/.test(CONTENT_MAIN));
ok('地址监听挂了 popstate', /addEventListener\('popstate', onUrlChange\)/.test(CONTENT_MAIN));
ok('地址监听还有 250ms 轮询兜底', /setInterval\(onUrlChange, 250\)/.test(CONTENT_MAIN));
ok('地址没变就不重复算（幂等守卫）', /location\.href === this\._lastShapeHref/.test(CONTENT_MAIN));
ok('重复挂监听会被拦住', /if \(this\._pageShapeWatcher\) return;/.test(CONTENT_MAIN));
ok('没加载 PageShape 时安全退出',
  /typeof PageShape === 'undefined' \|\| !PageShape \|\| typeof PageShape\.watches !== 'function'/.test(CONTENT_MAIN));

ok('handleExtract 接收 anchorEl', /opts\.anchorEl \|\| opts\.anchor\)/.test(CONTENT_MAIN));
ok('handleExtract 把它交给浮窗当锚点',
  /this\.modalManager\.setAnchorElement\(anchorElForWindow\)/.test(CONTENT_MAIN));

ok('微博逐帖混入传了 anchorEl', /anchorEl: \(target && target\.anchor\) \|\| null/.test(WEIBO_MIXIN));
ok('X 逐帖混入传了 anchorEl', /anchorEl: \(target && target\.anchor\) \|\| null/.test(X_MIXIN));
ok('IG 逐帖混入传了 anchorEl', /anchorEl: \(target && target\.anchor\) \|\| null/.test(IG_MIXIN));
ok('微博小按钮把自身当锚点传出去', /anchor: btn \}\)/.test(WEIBO_BTN));
ok('X 小按钮把自身当锚点传出去', /anchor: btn \}\)/.test(X_BTN));
ok('IG 小按钮把自身当锚点传出去', /anchor: btn \}\)/.test(IG_BTN));

ok('站点清单补了 s.weibo.com', /'s\.weibo\.com'/.test(SITE_CONFIG));

/* ============================================================
 * E. 档案皮肤（按钮侧）
 * ==========================================================*/
console.log('E. 档案皮肤');

ok('档案文案是「整理档案」', /get LABEL_ARCH\(\) \{ return '整理档案'; \}/.test(BUTTON_MANAGER));
ok('档案图标指向 hero-archive.svg',
  /get _MASCOT_ARCH\(\) \{\s*\n\s*return 'icons\/mascot\/hero-archive\.svg';/.test(BUTTON_MANAGER));
ok('_mascotUrl 在档案皮肤 + 常态时换图',
  /this\._skin === 'arch' && \(!state \|\| state === 'normal'\)/.test(BUTTON_MANAGER));
ok('档案皮肤下成功/失败/提取中仍用原图标（else 分支走原 map）',
  /rel = \(map && map\[state\]\) \|\| this\._MASCOT_FALLBACK;/.test(BUTTON_MANAGER));
ok('setSkin 幂等（同皮肤直接返回）', /if \(this\._skin === next\) return;/.test(BUTTON_MANAGER));
ok('setSkin 切 class', /classList\.toggle\('clipmate-arch', next === 'arch'\)/.test(BUTTON_MANAGER));
// v2.12.2：待命文案改由 _idleLabel 统一提供（因为 _restoreButtonSoon 也要用同一份），
// 判定条件仍是「只有当前是待命文案才换」，瞬态文案（提取中/完成/重试）一个字节都不碰。
ok('setSkin 只换「提取 ⇄ 整理档案」，不动瞬态文案',
  /cur === this\.LABEL_IDLE \|\| cur === this\.LABEL_ARCH/.test(BUTTON_MANAGER) &&
  /last\.textContent = this\._idleLabel;/.test(BUTTON_MANAGER));
ok('_skin 默认是 default', /this\._skin = 'default';/.test(BUTTON_MANAGER));

const iconPath = path.join(SRC, 'icons/mascot/hero-archive.svg');
ok('档案图标文件存在', fs.existsSync(iconPath));
const ICON = fs.existsSync(iconPath) ? fs.readFileSync(iconPath, 'utf8') : '';
ok('图标已删掉整画布白底（深色站点不出白方块）',
  !/fill="white" d="M0 0L1024 0L1024 1024L0 1024L0 0Z"/.test(ICON));
ok('图标已裁到图形边界（不留 78px 空白）',
  /viewBox="78 78 874 860"/.test(ICON));
ok('图标仍保留角色本体（白底之外的白件不能一起删掉）',
  (ICON.match(/fill="white"/g) || []).length > 0);
ok('图标登记在 web_accessible_resources 通配里',
  JSON.stringify(MANIFEST.web_accessible_resources).indexOf('icons/mascot/*') !== -1);

/* ============================================================
 * F. 档案皮肤（CSS）
 * ==========================================================*/
console.log('F. 档案配色');

// 切片要带花括号：注释里也出现过 .clipmate-dark 这个词，只按类名切会把浅色块截断
const darkStart = CSS.indexOf('.clipmate-dark {');
const lightBlock = CSS.slice(CSS.indexOf(':root {'), darkStart);
const darkBlock = CSS.slice(darkStart, darkStart + 4000);
ok('切到了两个变量块', darkStart !== -1 && lightBlock.length > 500 && darkBlock.length > 500);

['--cm-arch-btn', '--cm-arch-btn-hover', '--cm-arch-ink', '--cm-arch-edge', '--cm-arch-shadow'].forEach(function (v) {
  ok('浅色组有 ' + v, lightBlock.indexOf(v) !== -1);
  ok('深色组有 ' + v, darkBlock.indexOf(v) !== -1);
});

const archRule = CSS.match(/\.media-extractor-button\.clipmate-arch \{[^}]*\}/);
ok('有 .clipmate-arch 规则', !!archRule);
ok('档案底色走变量', !!archRule && /background: var\(--cm-arch-btn/.test(archRule[0]));
ok('档案描边是金黄', !!archRule && /border-color: var\(--cm-arch-edge/.test(archRule[0]));
ok('深色站点不换第二套亮蓝（面仍是暖黑）',
  /--cm-arch-btn: #222120;/.test(darkBlock));
ok('浅色站点档案底是深海军蓝', /--cm-arch-btn: #001FB5;/.test(lightBlock));
ok('档案规则**不写** button 前缀（否则会压住 success 的绿色反馈）',
  !/button\.media-extractor-button\.clipmate-arch/.test(CSS));
ok('提取中也保持档案底色', /\.media-extractor-button\.clipmate-arch\.loading \{/.test(CSS));

const successIdx = CSS.indexOf('.media-extractor-button.success {');
const archIdx = CSS.indexOf('.media-extractor-button.clipmate-arch {');
ok('档案规则写在 success 之前（让状态反馈后写覆盖）',
  archIdx !== -1 && successIdx !== -1 && archIdx < successIdx);

/* ============================================================
 * G. 浮窗锚点
 * ==========================================================*/
console.log('G. 浮窗贴小按钮');

ok('modal 有 setAnchorElement', /setAnchorElement\(el\) \{/.test(MODAL_WINDOW));
ok('_anchorRect 先试显式锚点', /const byClick = pick\(this\._anchorEl\);/.test(MODAL_WINDOW));
ok('显式锚点失效才退回大按钮',
  /if \(byClick\) return byClick;/.test(MODAL_WINDOW) &&
  /document\.querySelector\('\.media-extractor-button'\)/.test(MODAL_WINDOW));
ok('锚点必须还在 DOM 里（SPA 回收后不能再用旧坐标）',
  /if \(!el \|\| !el\.isConnected\) return null;/.test(MODAL_WINDOW));
ok('位置计算改用 _anchorRect', /const anchor = this\._anchorRect\(\);/.test(MODAL_WINDOW));
ok('关窗清掉锚点（下次不沿用上一颗）',
  /this\._anchorEl = null;/.test(MODAL_WINDOW));

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
