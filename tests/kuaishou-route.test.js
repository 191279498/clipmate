#!/usr/bin/env node
/**
 * 快手「站内跳转」接管验收（v2.5.87）
 *
 * 要钉住的事只有一件：**同一个详情页地址，站内点进去和整页刷新，行为必须一样。**
 *
 * 真机对照实验（2026-10-28，借用户 Edge）：
 *   | 操作                    | 地址                        | 文档导航次数 | 按钮数 |
 *   | 打开同城网格页          | /samecity                   | 1            | 0      |
 *   | 点开一条作品            | /short-video/xxx?authorId=  | 1（没换文档）| 0  ❌  |
 *   | 同一地址按 F5 刷新      | 同上                        | 1（新文档）  | 1  ✅  |
 *
 * 本脚本九节：
 *   一、静态契约：manifest 装了文件、加载顺序在 content-main 之前、版本号
 *   二、URL 判定：只认 /short-video、/video、/photo 三种（宁少不多）
 *   三、端到端：网格页 0 按钮 → 站内跳详情 1 按钮 → 回网格 0 按钮 → 再进仍是 1 个
 *   四、详情页之间换作品：按钮不动、不重复，作品 ID 跟着换
 *   五、熔断：连续 3 次等内容超时 → 本次会话不再接管
 *   六、门禁：非快手域名不挂监听；推荐流 /new-reco 不抢
 *   七、整页加载详情页（老路径）：行为与 v2.5.85 一致，仍是 1 个按钮
 *   八、空壳瞬间：只有 video、正文没渲染 → 不许出按钮
 *   九、真机地址形态（带查询串）：进得去也退得出（v2.5.87 回归点）
 *
 * 用法：
 *   node tests/kuaishou-route.test.js
 *   node tests/kuaishou-route.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const ROUTE_PATH = path.join(ROOT, 'src/content/ui/kuaishou-route-watcher.js');
const MAIN_PATH = path.join(ROOT, 'src/content/content-main.js');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  cyan: '\u001b[36m', gray: '\u001b[90m'
};

let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual, detail) {
  if (actual) ok(name, detail);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual, detail) {
  if (!actual) ok(name, detail);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ 页面模板 ============================ */

const GRID_URL = 'https://www.kuaishou.com/discover';
const DETAIL_URL = 'https://www.kuaishou.com/short-video/3x9m62i72wh6sws';
const DETAIL_URL_2 = 'https://www.kuaishou.com/short-video/3xr8w2hxubpwdza';

function gridHtml() {
  return `<!doctype html><html><head><title>发现 - 快手</title></head><body>
    <div id="root">
      <div class="video-grid">
        <a class="video-card-main" href="/short-video/3x9m62i72wh6sws">作品一</a>
        <a class="video-card-main" href="/short-video/3xr8w2hxubpwdza">作品二</a>
      </div>
    </div>
  </body></html>`;
}

/** 模拟详情页渲染完成后的内容（站内跳转后由页面自己插入，这里手动插） */
const DETAIL_BLOCK = `
  <div class="detail-wrap">
    <div class="video-container"><video src="https://v.kuaishou.com/x.mp4"></video></div>
    <h1 class="videoInfoTitle">一条测试作品</h1>
    <div class="video-info-line">发布时间 2026-10-26 ｜ 1234 点赞 ｜ 56 评论</div>
    <div class="video-info-text">这是一条用于铺足正文长度的测试文案，真实详情页在内容就绪时正文约四百多字。这是一条用于铺足正文长度的测试文案，真实详情页在内容就绪时正文约四百多字。这是一条用于铺足正文长度的测试文案，真实详情页在内容就绪时正文约四百多字。这是一条用于铺足正文长度的测试文案，真实详情页在内容就绪时正文约四百多字。</div>
  </div>`;

/** 等实例出现（网格页 isInitialized 恒为 false，不能用 waitForInit） */
async function waitForInstance(page, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const inst = page.bridge && page.bridge.getInstance ? page.bridge.getInstance() : null;
    if (inst) return inst;
    await sleep(50);
  }
  return null;
}

function insertDetail(w) {
  w.document.body.insertAdjacentHTML('beforeend', DETAIL_BLOCK);
}
function removeDetail(w) {
  const el = w.document.querySelector('.detail-wrap');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}
function buttonCount(w) {
  return w.document.querySelectorAll('.media-extractor-button').length;
}

/* ============================ 一、静态契约 ============================ */

function section1() {
  section('一、静态契约：文件装上了、顺序对、版本号跟上');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  eq('版本号是 2.9.8', manifest.version, '2.9.8');

  const js = manifest.content_scripts[0].js;
  const iRoute = js.indexOf('src/content/ui/kuaishou-route-watcher.js');
  const iMain = js.indexOf('src/content/content-main.js');
  truthy('manifest 装了 kuaishou-route-watcher.js', iRoute >= 0, 'index=' + iRoute);
  truthy('在 content-main.js 之前加载', iRoute >= 0 && iMain >= 0 && iRoute < iMain, `${iRoute} < ${iMain}`);
  truthy('在 kuaishou-spa-handler.js 之后加载',
    iRoute > js.indexOf('src/content/ui/kuaishou-spa-handler.js'));

  const main = fs.readFileSync(MAIN_PATH, 'utf8');
  truthy('init 失败分支调了 _startKuaishouRouteWatcher', /_startKuaishouRouteWatcher\(\)\)\s*return/.test(main));
  truthy('init 成功分支也挂了监听', /this\._startKuaishouRouteWatcher\(\);\s*\} catch/.test(main));
  truthy('原型上装配了 KuaishouRouteMixin', /Object\.assign\(MediaExtractor\.prototype,\s*KuaishouRouteMixin\)/.test(main));

  const route = fs.readFileSync(ROUTE_PATH, 'utf8');
  truthy('域名门禁写死 www.kuaishou.com', /location\.hostname === 'www\.kuaishou\.com'/.test(route));
  truthy('用轮询比对地址（隔离世界包 pushState 收不到）', /setInterval\(this\._ksRouteHandler, POLL_MS\)/.test(route));
  truthy('没有去包页面自己的 pushState', !/history\.pushState\s*=/.test(route));
  truthy('详情路径白名单只三种', /short-video\|video\|photo/.test(route));
  truthy('熔断阈值 3 次', /BREAKER_MAX = 3/.test(route));

  // v2.7.19：个人主页不许被当成「网格页」摘掉按钮
  truthy('有个人主页路径正则', /PROFILE_RE\s*=\s*\/\^\\\/profile\\\//.test(route));
  const profileGuards = (route.match(/this\._ksRouteIsProfile\(location\.pathname\)/g) || []).length;
  eq('主页门禁挂在两处（启动 + 离开详情页）', profileGuards, 2);
  truthy('有 _ksRouteRestoreProfilePerson 回切', /_ksRouteRestoreProfilePerson\(\)\s*\{/.test(route));
}

/* ============================ 二、URL 判定 ============================ */

async function section2() {
  section('二、URL 判定：只认三种详情路径');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({ url: GRID_URL, html: gridHtml(), mediaConfigs: cfg });
  const inst = await H.waitForInit(page, 8000);
  truthy('拿得到实例', inst);

  eq('/short-video/xxx 认成详情', inst._ksRouteIsDetail('/short-video/3x9m62i72wh6sws'), true);
  eq('/video/xxx 认成详情', inst._ksRouteIsDetail('/video/3x9m62i72wh6sws'), true);
  eq('/photo/xxx 认成详情', inst._ksRouteIsDetail('/photo/3x9m62i72wh6sws'), true);
  eq('/discover 不算详情', inst._ksRouteIsDetail('/discover'), false);
  eq('/ 不算详情', inst._ksRouteIsDetail('/'), false);
  eq('/new-reco 不算详情', inst._ksRouteIsDetail('/new-reco'), false);
  eq('/profile/xxx 不算详情', inst._ksRouteIsDetail('/profile/3x5ixtd9ifaatig'), false);
  eq('抠作品 ID', inst._ksRouteWorkId('/short-video/3x9m62i72wh6sws?authorId=abc'), '3x9m62i72wh6sws');
  eq('抠不到就空串', inst._ksRouteWorkId('/discover'), '');

  page.window.close();
  await sleep(30);
}

/* ============================ 三、端到端 ============================ */

async function section3() {
  section('三、端到端：网格 0 → 站内跳详情 1 → 回网格 0 → 再进 1');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({ url: GRID_URL, html: gridHtml(), mediaConfigs: cfg });
  const w = page.window;
  const d = w.document;
  const inst = await H.waitForInit(page, 8000);
  truthy('拿得到实例', inst);

  /* 基线：网格页一个按钮都不许有 */
  await sleep(200);
  eq('网格页按钮数 0（与 v2.5.85 一致）', buttonCount(w), 0);
  truthy('网格页挂了地址监听', !!inst._ksRouteTimer);
  falsy('网格页没有接管态', inst._ksRouteActive);

  /* 站内跳详情：只改地址 + 页面自己把内容渲染出来 */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  insertDetail(w);
  inst._ksRouteCheck();
  await sleep(350);

  eq('站内跳详情后按钮数 1', buttonCount(w), 1);
  truthy('接管后 isInitialized 为真', inst.isInitialized);
  eq('类型认成 social', inst.detectMediaType(), 'social');
  truthy('记录了接管态', inst._ksRouteActive);
  const btn = d.querySelector('.media-extractor-button');
  truthy('按钮可点（不是置灰 pending）', btn && !btn.disabled);

  /* 回网格：撤按钮、关浮窗 */
  w.history.pushState({}, '', '/discover');
  removeDetail(w);
  inst._ksRouteCheck();
  await sleep(250);
  eq('回到网格后按钮数 0', buttonCount(w), 0);
  falsy('回到网格后 isInitialized 为假（popup 提取会提示未初始化）', inst.isInitialized);

  /* 再进一次：仍然只有 1 个按钮（不许叠出两个） */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  insertDetail(w);
  inst._ksRouteCheck();
  await sleep(350);
  eq('再次进入仍然是 1 个按钮', buttonCount(w), 1);
  truthy('再次进入恢复可提取', inst.isInitialized);

  w.close();
  await sleep(50);
}

/* ============================ 四、详情页之间换作品 ============================ */

async function section4() {
  section('四、详情页之间换作品：按钮不动，作品 ID 跟着换');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({ url: GRID_URL, html: gridHtml(), mediaConfigs: cfg });
  const w = page.window;
  const inst = await H.waitForInit(page, 8000);

  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  insertDetail(w);
  inst._ksRouteCheck();
  await sleep(350);
  eq('先进详情：1 个按钮', buttonCount(w), 1);
  const cacheKey1 = inst.cacheKey;

  /* 同一条作品只是参数变了（快手会自己 replaceState 加 streamSource） */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws?streamSource=samecity');
  inst._ksRouteCheck();
  await sleep(120);
  eq('参数变化不重建按钮', buttonCount(w), 1);
  truthy('参数变化不会把 isInitialized 打掉', inst.isInitialized);

  /* 换成另一条作品 */
  w.history.pushState({}, '', '/short-video/3xr8w2hxubpwdza');
  inst._ksRouteCheck();
  await sleep(150);
  eq('换作品后仍然只有 1 个按钮', buttonCount(w), 1);
  truthy('缓存键跟着换了（不会命中上一条）', inst.cacheKey !== cacheKey1, `旧=${cacheKey1} 新=${inst.cacheKey}`);
  truthy('缓存键里含新作品 ID', String(inst.cacheKey).indexOf('3xr8w2hxubpwdza') >= 0, inst.cacheKey);

  w.close();
  await sleep(50);
}

/* ============================ 五、熔断 ============================ */

async function section5() {
  section('五、熔断：连续 3 次等内容超时 → 本次会话不再接管');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({ url: GRID_URL, html: gridHtml(), mediaConfigs: cfg });
  const w = page.window;
  const inst = await H.waitForInit(page, 8000);

  /* 已经失败过 2 次，这一次再失败就该熔断 */
  inst._ksRouteFailStreak = 2;
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  /* 故意不放详情内容：地址是详情页，但 DOM 还是网格的骨架 */
  inst._ksRouteCheck();

  /* 等内容超时上限 8 秒 */
  const t0 = Date.now();
  while (Date.now() - t0 < 9500 && !inst._ksRouteDisabled) await sleep(200);

  truthy('超时后熔断置位', inst._ksRouteDisabled, `${Date.now() - t0}ms`);
  eq('超时分支没有出按钮', buttonCount(w), 0);
  falsy('超时分支没有建立接管态', inst._ksRouteActive);

  /* 熔断后即便内容出来了也不再接管 */
  insertDetail(w);
  inst._ksRouteCheck();
  await sleep(300);
  eq('熔断后不再接管（按钮仍 0）', buttonCount(w), 0);

  w.close();
  await sleep(50);
}

/* ============================ 六、门禁 ============================ */

async function section6() {
  section('六、门禁：非快手域名不挂；推荐流 /new-reco 不抢');

  const H = require('./lib/harness');

  /* 非快手域名 */
  const dyCfg = { 'www.douyin.com': { type: 'social', patterns: ['/'] } };
  const dy = await H.openPage({
    url: 'https://www.douyin.com/video/7411950642865917225',
    html: '<!doctype html><html><head><title>抖音</title></head><body><div class="video_7411950642865917225"></div></body></html>',
    mediaConfigs: dyCfg
  });
  const dyInst = await waitForInstance(dy);
  truthy('抖音页也拿得到实例（脚本是同一套）', dyInst);
  eq('抖音页调用返回 false', dyInst._startKuaishouRouteWatcher(), false);
  falsy('抖音页没有挂地址定时器', dyInst._ksRouteTimer);
  dy.window.close();
  await sleep(30);

  /* 推荐流：/new-reco 交给 KuaishouSpaMixin，route watcher 不挂 */
  const ksCfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const reco = await H.openPage({
    url: 'https://www.kuaishou.com/new-reco',
    html: '<!doctype html><html><head><title>推荐 - 快手</title></head><body><div class="swiper-slide-active"></div></body></html>',
    mediaConfigs: ksCfg
  });
  const recoInst = await waitForInstance(reco);
  truthy('推荐流也拿得到实例', recoInst);
  eq('推荐流上 route watcher 拒绝接管', recoInst._startKuaishouRouteWatcher(), false);
  falsy('推荐流没有挂地址定时器', recoInst._ksRouteTimer);
  reco.window.close();
  await sleep(30);
}

/* ============================ 七、整页加载详情页 ============================ */

async function section7() {
  section('七、整页加载详情页（老路径）：仍 1 个按钮，且挂上了监听');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({
    url: DETAIL_URL,
    html: `<!doctype html><html><head><title>@颖宝宝 的精彩视频-快手</title></head><body>${DETAIL_BLOCK}</body></html>`,
    mediaConfigs: cfg
  });
  const w = page.window;
  const inst = await H.waitForInit(page, 8000);

  truthy('详情页正常初始化', inst && inst.isInitialized);
  eq('按钮数 1（与 v2.5.85 一致）', buttonCount(w), 1);
  truthy('详情页也挂了地址监听（用来感知离开）', !!inst._ksRouteTimer);
  eq('类型是 social', inst.detectMediaType(), 'social');

  w.close();
  await sleep(50);
}

/* ============================ 八、空壳瞬间 ============================ */

async function section8() {
  section('八、空壳瞬间：只有 video、正文还没渲染 → 不许出按钮');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };
  const page = await H.openPage({ url: GRID_URL, html: gridHtml(), mediaConfigs: cfg });
  const w = page.window;
  const d = w.document;
  const inst = await H.waitForInit(page, 8000);

  /* 真机 465ms 的样子：video 已经在了，正文只有几十字 */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  d.body.insertAdjacentHTML('beforeend', '<div class="shell-wrap"><video src="x.mp4"></video><div>加载中</div></div>');
  inst._ksRouteCheck();
  await sleep(900);

  eq('空壳阶段按钮数 0', buttonCount(w), 0);
  falsy('空壳阶段没有接管', inst._ksRouteActive);
  eq('空壳阶段就绪判据为假', inst._ksRouteDetailReady(), false);

  /* 真机 601ms 的样子：正文到位 */
  d.querySelector('.shell-wrap').insertAdjacentHTML('beforeend',
    '<div>' + '真正的内容区文字，够长才会被当成就绪。'.repeat(12) + '</div>');
  eq('正文到位后判据为真', inst._ksRouteDetailReady(), true);

  await sleep(700);
  eq('正文到位后接管出按钮', buttonCount(w), 1);
  truthy('接管态建立', inst._ksRouteActive);

  w.close();
  await sleep(50);
}

/* ============ 九、真机地址形态（带查询串）—— v2.5.87 补 ============ */

/**
 * 为什么单独一节：
 *   2026-10-28 真机验收抓到「从详情页点回网格，按钮不撤」。
 *   根因是 DETAIL_RE 带 `$`，而判断「上一拍是不是详情页」时传的是
 *   `pathname + search`（真机详情页一定带 ?authorId=…）→ 永远判成非详情。
 *   之前的用例里详情地址恰好不带查询串，所以一直是绿的。
 *   这一节所有地址都用真机上抠下来的原样形态。
 */
async function section9() {
  section('九、真机地址形态（带查询串）：进得去、也退得出');

  const H = require('./lib/harness');
  const cfg = { 'www.kuaishou.com': { type: 'social', patterns: ['/short-video/', '/video/'] } };

  const REAL_GRID = 'https://www.kuaishou.com/?isHome=1&source=NewReco';
  const REAL_DETAIL = '/short-video/3xfhczq5hhn5kf9?authorId=3xwtm72eb4pvtv6&streamSource=find&area=homexxbrilliant';
  const REAL_DETAIL_2 = '/short-video/3xph9iwp6x25uva?authorId=3xg2qk7h98uu7pe&streamSource=find&area=homexxbrilliant';

  const page = await H.openPage({ url: REAL_GRID, html: gridHtml(), mediaConfigs: cfg });
  const w = page.window;
  const inst = await H.waitForInit(page, 8000);
  const d = w.document;

  eq('网格页起点按钮 0', buttonCount(w), 0);

  /* 纯函数兜住根因：带查询串的详情地址必须判成详情页 */
  truthy('路径判定认带查询串的详情地址', inst._ksRouteIsDetail(REAL_DETAIL), REAL_DETAIL);
  truthy('路径判定认不带查询串的详情地址', inst._ksRouteIsDetail('/short-video/3x9m62i72wh6sws'));
  falsy('网格地址带查询串仍判非详情', inst._ksRouteIsDetail('/?isHome=1&source=NewReco'));
  falsy('详情路径后面挂了别的段也不认', inst._ksRouteIsDetail('/short-video/3x9m62i72wh6sws/comment'));

  /* 站内点开：地址带 query、内容后到 */
  w.history.pushState({}, '', REAL_DETAIL);
  insertDetail(w);
  await sleep(700);
  eq('站内进详情出按钮', buttonCount(w), 1);
  truthy('接管态建立', inst._ksRouteActive);

  /* 站内点回网格：按钮必须撤、接管态必须退 */
  w.history.pushState({}, '', REAL_GRID);
  await sleep(900);
  eq('回到网格按钮撤干净（真机 bug 的回归点）', buttonCount(w), 0);
  falsy('回到网格接管态退出', inst._ksRouteActive);
  falsy('回到网格 isInitialized 归位', inst.isInitialized);

  /* 再进另一条（也带 query）：仍然只有 1 个按钮，缓存键换成新作品 */
  removeDetail(w);
  w.history.pushState({}, '', REAL_DETAIL_2);
  insertDetail(w);
  await sleep(700);
  eq('再进详情仍是 1 个按钮（不叠加）', buttonCount(w), 1);
  truthy('缓存键含新作品 ID', String(inst.cacheKey).indexOf('3xph9iwp6x25uva') >= 0, inst.cacheKey);

  /* 带 query 的详情之间换作品：不关按钮、不叠按钮 */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws?authorId=3x5ixtd9ifaatig&streamSource=samecity');
  await sleep(600);
  eq('带 query 换作品后仍是 1 个按钮', buttonCount(w), 1);
  truthy('带 query 换作品后缓存键跟着换', String(inst.cacheKey).indexOf('3x9m62i72wh6sws') >= 0, inst.cacheKey);

  w.close();
  await sleep(50);
}

/* ============================ 十、个人主页不许摘按钮（v2.7.19） ============================ */

const PROFILE_URL = 'https://www.kuaishou.com/profile/3xb7355iu5cb6r4?source=SEARCH';

function profileHtml() {
  return `<!doctype html><html><head><title>东莞安然无恙 - 快手</title></head><body>
    <div id="root">
      <div class="profile-top"><h1 class="user"><span class="name">东莞安然无恙</span></h1></div>
      <div class="info"><span class="uid">快手号：5405486592</span></div>
      <div class="text-count"><div class="text _qu-ellipsis-multi" title="每日更新热门短剧">每日更新热门短剧</div></div>
      <div class="count"><span> 关注 <span>30</span></span><span> 粉丝 <span>6619</span></span><span class="stat-item"> 获赞 <span>3.2万</span></span></div>
    </div>
  </body></html>`;
}

/**
 * 真机 bug（2026-10-31 验收发现）：刷新快手个人主页，页面上**一个按钮都没有**，
 * 必须点开一条作品弹层（弹层接管会再造一个）按钮才出现。
 *
 * 根因：`_startKuaishouRouteWatcher()` 启动时把「不是详情页」的页面一律当成网格页，
 * 摘掉正常流程刚建好的按钮 —— 而 `/profile/<id>` 恰好不是详情页，于是主页中招。
 *
 * 这一节钉的就是「主页必须一开始就有按钮」，改回老实现必须变红。
 */
async function section10() {
  section('十、个人主页：按钮不许被摘（v2.7.19 真机回归点）');

  const H = require('./lib/harness');
  const cfg = {
    'www.kuaishou.com': {
      rules: [
        { type: 'person', patterns: ['/profile/'] },
        { type: 'social', patterns: ['/short-video/', '/video/'] }
      ]
    }
  };
  const page = await H.openPage({ url: PROFILE_URL, html: profileHtml(), mediaConfigs: cfg });
  const w = page.window;
  const inst = await H.waitForInit(page, 8000);
  truthy('拿得到实例', inst);

  eq('主页认成人物档案', inst.detectMediaType(), 'person');
  eq('/profile/<id> 认成主页', inst._ksRouteIsProfile('/profile/3xb7355iu5cb6r4'), true);
  eq('带查询串也认成主页', inst._ksRouteIsProfile('/profile/3xb7355iu5cb6r4?source=SEARCH'), true);
  eq('/profile/ 光杆不算主页', inst._ksRouteIsProfile('/profile/'), false);
  eq('/discover 不算主页', inst._ksRouteIsProfile('/discover'), false);
  eq('/short-video/xxx 不算主页', inst._ksRouteIsProfile('/short-video/3x9m62i72wh6sws'), false);

  await sleep(400);
  eq('主页刷新后按钮数 1（真机原来是 0）', buttonCount(w), 1);
  truthy('主页也挂了地址监听', !!inst._ksRouteTimer);
  const btn = w.document.querySelector('.media-extractor-button');
  truthy('按钮还挂在文档上（不是被摘下来的游离节点）', btn && !!btn.parentNode);
  truthy('按钮就是 ButtonManager 手里那个', inst.buttonManager && btn === inst.buttonManager.button);
  truthy('主页按钮可点（不是置灰 pending）', btn && !btn.disabled && !btn.classList.contains('pending'));
  // 直接断言映射器：**不能只测 detectMediaType()** —— 它每次按地址重算，
  // 会把「模板没切回来」掩盖掉（变异测试第 ⑤ 条就是这样漏过去的）。
  eq('主页模板是 6 列人物档案', inst.fieldMapper && inst.fieldMapper.mediaType, 'person');

  /* 从主页站内进详情页 → 再退回主页：按钮不许消失、模板要切回人物 */
  w.history.pushState({}, '', '/short-video/3x9m62i72wh6sws');
  insertDetail(w);
  inst._ksRouteCheck();
  await sleep(400);
  eq('主页进详情后仍是 1 个按钮', buttonCount(w), 1);
  eq('详情态类型切成 social', inst.detectMediaType(), 'social');
  eq('详情态模板是 7 列社交', inst.fieldMapper && inst.fieldMapper.mediaType, 'social');

  removeDetail(w);
  w.history.pushState({}, '', '/profile/3xb7355iu5cb6r4');
  inst._ksRouteCheck();
  await sleep(600);
  eq('退回主页按钮还在（不许摘）', buttonCount(w), 1);
  truthy('退回主页 isInitialized 恢复', inst.isInitialized);
  eq('退回主页类型回到 person', inst.detectMediaType(), 'person');
  eq('退回主页模板切回 6 列人物档案', inst.fieldMapper && inst.fieldMapper.mediaType, 'person');

  w.close();
  await sleep(50);
}

/* ============================ 跑 ============================ */

(async () => {
  console.log(`${C.cyan}快手「站内跳转」接管验收（v2.5.86）${C.reset}`);

  section1();
  await section2();
  await section3();
  await section4();
  await section5();
  await section6();
  await section7();
  await section8();
  await section9();
  await section10();

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
    failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? ' :: ' + f.detail : ''}`));
    process.exit(1);
  }
})().catch((e) => {
  console.error(`${C.red}测试脚本自身出错：${C.reset}`, e);
  process.exit(2);
});
