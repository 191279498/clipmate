/**
 * v2.12.5 —— Instagram 站内点开帖子后，按钮皮肤要跟着换
 *
 * 真机取证（2026-11-05，接管已登录 Edge，截图 `_shots/v2124_ig_post_archskin.png`）：
 *   作者主页 `/nayawashi/` 点开一条帖子（站内换页、文档不换）
 *   → 按钮仍是「整理档案」+ 金边档案装
 *   → 点下去浮窗里却是**这一条作品**的 7 列（本页标题 / 作者ID / 发布日期 / 本页文案 …）
 *   对照：同一地址整页加载进来 → 普通蓝「提取」，7 列，正确。
 *
 * 根因：IG 在 v2.12.2 被**刻意排除**在地址监听白名单外（理由「它有自己的显隐主人」），
 * 但那套主人（`_syncInstagramEntryVisibility`）只决定按钮露不露、**不管皮肤**。
 * 站内换页不重跑 init → 皮肤永远停在主页算好的 arch 上。
 *
 * 本文件钉四件事：
 *   一、端到端（真 harness 跑全部内容脚本）：主页 arch → 跳帖子 default → 回主页 arch；
 *   二、不抢显隐：整个过程中 `setVisible` 一次都不许因为形态判定被调用（IG 自己管的）；
 *   三、安全前提：IG 在这套规则里**永远算不出 feed**（否则会把 IG 的按钮藏掉）；
 *   四、接线：白名单里真有 instagram.com，且没有第二套 IG 专属换肤补丁（防方案漂移）。
 *
 * 用法：
 *   node tests/ig-skin-follow.test.js
 *   node tests/ig-skin-follow.test.js --verbose
 */
'use strict';

const path = require('path');
const H = require('./lib/harness');
const env = require('./lib/env');
const PageShape = require(path.join(__dirname, '..', 'ClipMate_chrome/src/content/utils/page-shape.js'));

const VERBOSE = process.argv.includes('--verbose');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
let pass = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    if (VERBOSE) console.log(C.green + '  ✓ ' + name + C.reset);
    return;
  }
  fails.push(name + (detail === undefined ? '' : '  → ' + String(detail).slice(0, 200)));
  console.log(C.red + '  ✗ ' + name + (detail === undefined ? '' : '  → ' + String(detail).slice(0, 200)) + C.reset);
}
function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expect));
}
function truthy(name, cond, detail) { ok(name, !!cond, detail); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

function report() {
  console.log('');
  if (fails.length) {
    console.log(C.red + `失败 ${fails.length} 项 / 通过 ${pass} 项` + C.reset);
    fails.forEach((f) => console.log(C.red + '  · ' + f + C.reset));
    process.exit(1);
  }
  console.log(C.green + `全部通过：${pass} 项` + C.reset);
  process.exit(0);   // 页面里挂着 250ms 形态轮询，不显式退出进程不会自己结束
}

/** IG 作者主页的最小真实骨架：够 media-detector 认出 person、够 init 跑完 */
const PROFILE_HTML = `<!DOCTYPE html><html><head>
  <title>nayawashi (@nayawashi) • Instagram photos and videos</title>
  <meta property="og:title" content="nayawashi (@nayawashi)">
  </head><body>
  <main>
    <header><h2>nayawashi</h2><span>shi naya hong 나야와시</span></header>
    <section>
      <ul><li>411 posts</li><li>11.7万 followers</li><li>1,234 following</li></ul>
      <div>shinayahong@gmail.com</div>
      <a href="https://youtube.com/@nayawashii">youtube.com/@nayawashii</a>
    </section>
    <article>
      <a href="/p/DQRQZ6kE6a3/"><img alt="post"></a>
    </article>
  </main>
  </body></html>`;

(async function main() {
  console.log(`${C.cyan}Instagram 站内跳转皮肤跟随（v2.12.5）${C.reset}`);

  /* ============================================================
   * 一、端到端（真 harness）
   * ==========================================================*/
  section('一、端到端：/nayawashi/ → /p/<code>/ → 回主页');

  const page = await H.openPage({
    url: 'https://www.instagram.com/nayawashi/',
    html: PROFILE_HTML,
    // 必须是真实媒体配置：空的 siteConfigs 会让 detector 退回「按正文猜」，
    // 主页就判不成 person，测的就不是真机那条路（v2.11.5 踩过）。
    mediaConfigs: await env.loadBackgroundMediaConfigs()
  });
  const inst = await H.waitForInit(page, 8000);
  truthy('内容脚本初始化完成', !!inst);
  if (!inst) { report(); return; }

  const bm = inst.buttonManager;
  truthy('按钮已创建', !!(bm && bm.button));
  eq('主页：媒体类型 = person', inst.detectMediaType(), 'person');
  eq('主页：页面形态 = person', inst._pageShape, 'person');
  eq('主页：皮肤 = 档案装', bm._skin, 'arch');
  eq('主页：文案 = 整理档案', String(bm.button.textContent || '').trim(), '整理档案');
  ok('主页：title 也是档案版（v2.12.2 的 _idleTitle 生效）',
    /整理作者档案/.test(String(bm.button.title || '')), bm.button.title);

  /* ---- v2.12.5 的接线：地址监听真的挂在 IG 上了 ---- */
  truthy('主页：地址监听已挂上（本轮新增，v2.12.2 前 IG 被排除）', !!inst._pageShapeWatcher);

  /* ---- 记录 setVisible：形态判定不许**关掉** IG 的按钮 ---- */
  const visCalls = [];
  const origSetVisible = bm.setVisible.bind(bm);
  bm.setVisible = function (v) {
    visCalls.push(v);
    return origSetVisible(v);
  };

  /* ---- 站内跳进帖子（IG 是弹层 + 换地址，文档不换）---- */
  page.window.history.pushState({}, '', '/p/DQRQZ6kE6a3/');
  await sleep(900);

  eq('帖子：页面形态 = unknown（IG 没配藏按钮的规则）', inst._pageShape, 'unknown');
  eq('帖子：皮肤褪回普通蓝', bm._skin, 'default');
  eq('帖子：文案 = 提取', String(bm.button.textContent || '').trim(), '提取');
  ok('帖子：title 也回普通版（不是档案那句）',
    /点击提取页面媒体信息/.test(String(bm.button.title || '')), bm.button.title);
  ok('帖子：按钮还在 DOM 里、仍是可见的（这一页要能提取）',
    !!(bm.button.parentNode) && bm.isVisible !== false,
    'parentNode=' + !!bm.button.parentNode + ' isVisible=' + bm.isVisible);
  eq('帖子：形态判定**没有**调用过 setVisible（显隐归 IG 自己）', visCalls.length, 0);

  /* ---- 关掉帖子回主页（IG 把地址推回作者主页）---- */
  page.window.history.pushState({}, '', '/nayawashi/');
  await sleep(900);

  eq('回主页：形态又是 person', inst._pageShape, 'person');
  eq('回主页：皮肤回到档案装', bm._skin, 'arch');
  eq('回主页：文案 = 整理档案', String(bm.button.textContent || '').trim(), '整理档案');
  // person 形态会走 `setVisible(true)`（作者主页本来就该显示），这是对的；
  // 真正不能发生的是**关掉** —— 关掉就会把 IG 那套（按弹层开没开算的）藏好的按钮
  // 和管理权搅在一起。所以这里只盯 false。
  eq('回主页：形态判定从没关过按钮（只可能开）',
    visCalls.filter((v) => v === false).length, 0);
  ok('回主页：开的那次就是 person 形态该做的',
    visCalls.every((v) => v === true), JSON.stringify(visCalls));

  /* ---- 列表页：皮肤要 default，且按钮是 IG 自己藏的（不是我们藏的）---- */
  const beforeExplore = visCalls.length;
  page.window.history.pushState({}, '', '/explore/');
  await sleep(900);
  eq('探索页：皮肤 = default', bm._skin, 'default');
  // 这一页的 `setVisible(false)` 是 IG 自己那套干的（它判定「没有单条内容」→ 藏）。
  // 我们要证的是：**形态判定没有把按钮又翻出来**（多一个 true 就是抢主人的证据）。
  eq('探索页：没有多出任何「显示」调用（形态判定没去抢 IG 的显隐）',
    visCalls.slice(beforeExplore).filter((v) => v === true).length, 0);
  ok('探索页：按钮既不显示也没被摘掉（藏是 IG 那套干的）',
    bm.isVisible === false && !!bm.button.parentNode,
    'isVisible=' + bm.isVisible + ' inDom=' + !!bm.button.parentNode);

  bm.setVisible = origSetVisible;

  /* ============================================================
   * 二、安全前提：IG 永远算不出 feed
   *
   * 这是「把 IG 加进监听白名单」不会跟 IG 抢显隐的**唯一理由**。
   * 哪天有人给 IG 补了 RULES，这条会立刻红 —— 那时候必须改设计，不能硬上。
   * ==========================================================*/
  section('二、安全前提：IG 算不出 feed，所以碰不到显隐');

  const IG_CASES = [
    ['/', 'social', 'unknown', '首页信息流'],
    ['/explore/', 'social', 'unknown', '探索页'],
    ['/nayawashi/', 'person', 'person', '作者主页'],
    ['/nayawashi/reels/', 'social', 'unknown', '某人 reels 列表'],
    ['/p/DQRQZ6kE6a3/', 'social', 'unknown', '帖子详情 / 弹层'],
    ['/reel/DfWutqaAg5F/', 'social', 'unknown', 'reel 详情'],
    ['/stories/nayawashi/123456/', 'social', 'unknown', 'story'],
    ['/accounts/login/', 'social', 'unknown', '登录页'],
    ['/direct/inbox/', 'social', 'unknown', '私信']
  ];
  IG_CASES.forEach(function (c) {
    const shape = PageShape.shapeOf({ hostname: 'www.instagram.com', pathname: c[0], mediaType: c[1] });
    eq('IG ' + c[3] + ' ' + c[0] + ' → ' + c[2], shape, c[2]);
    ok('IG ' + c[3] + ' 不算信息流（不会触发藏按钮）', shape !== 'feed', shape);
  });

  /* ============================================================
   * 三、接线与防漂移
   * ==========================================================*/
  section('三、接线与防漂移');

  ok('白名单里真有 instagram.com', PageShape.watches('www.instagram.com'));
  ok('裸域同口径', PageShape.watches('instagram.com'));
  ok('抖音仍然排除（它有自己的只盯 pathname 的路由监听）', !PageShape.watches('www.douyin.com'));

  const IG_MIXIN = require('fs').readFileSync(
    path.join(__dirname, '..', 'ClipMate_chrome/src/content/ui/ig-spa-handler.js'), 'utf8');
  ok('没有另起一套 IG 专属换肤（换肤只走 _applyPageShape 这一条路）',
    IG_MIXIN.indexOf('setSkin(') === -1,
    'ig-spa-handler.js 里出现了 setSkin 调用，两套换肤会互相打架');

  report();
})();
