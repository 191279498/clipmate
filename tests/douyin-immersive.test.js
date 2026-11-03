#!/usr/bin/env node
/**
 * 抖音「沉浸流」（推荐 / 关注 / 朋友）识别与接线验收（v2.5.80 批 8）
 *
 * 这三页和弹窗页是**同一套结构**，差别只在「怎么认出当前这一条」：
 * 地址栏不变，靠 `<div data-e2e="feed-active-video" class="... video_<作品ID> ...">` 认。
 * 本脚本钉住六节：
 *
 *   一、URL 判定：只认 `/`、`/follow`、`/friend`，其余一律不认（宁少不多）
 *   二、认「当前这一条」：正常 / 关注页 2 个 video-info / ID 对不上 / 空壳 / 多条候选
 *   三、弹窗永远优先：地址栏有 modal_id、或弹层真的立起来了 → 交回弹窗逻辑
 *   四、playbackMode / isOpen / resolve 的一致性
 *   五、watch：切条能感知、切到不归本模块管的页面会变成 closed
 *   六、端到端（真实 content-main）：出按钮 + 锚点标记 douyin-immersive + 7 个字段
 *
 * 用法：
 *   node tests/douyin-immersive.test.js
 *   node tests/douyin-immersive.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const CONTEXT_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/shared/douyin-modal-context.js');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
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
  if (actual === expected) ok(name, `${JSON.stringify(actual)}`);
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual) {
  if (actual) ok(name);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual) {
  if (!actual) ok(name);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================== 载入 jsdom ============================== */

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请设置 NODE_PATH 或 CLIPMATE_NODE_PATH（见 tests/README.md）');
}
const { JSDOM } = loadJsdom();

/**
 * 以「这个 jsdom window 就是浏览器的 window」的方式加载被测模块。
 *
 * 为什么要这么做：模块 IIFE 形参是 `typeof window !== 'undefined' ? window : null`，
 * 里面所有 `global.location` / `global.document` 都指向它。只有把 window 换成
 * 每节自己的 jsdom 实例，才能测「不同住址的页面」，且和浏览器里的语义完全一致。
 */
function loadContext(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  delete require.cache[require.resolve(CONTEXT_PATH)];
  const prevWindow = global.window;
  global.window = dom.window;
  let api;
  try {
    api = require(CONTEXT_PATH);
  } finally {
    global.window = prevWindow;
  }
  return { dom, api, d: dom.window.document, w: dom.window };
}

/* ============================== 页面模板 ============================== */

/** 真机实测的 class 串（关注页 2026-10-27 20:49 抓的原样，只把 ID 换成占位） */
function realClass(id) {
  return `NhEiLku8 video_${id} sliderVideo dC20kVxI y65SoqsA side-card-typography-scope celP7Xjg Sqo3SkC7 relatedUiA`;
}

/**
 * 一个沉浸流页。infoCount 控制「本条容器里有几个 video-info」，
 * outerInfo 用来模拟「关注页整页有 2 个 video-info，另一个在别的容器里」。
 */
function immersiveHtml({ id = '7700906375912991603', nick = '芝知', desc = '这个卡点～帅！#呀吖摇', withContent = true, extraFeeds = [] } = {}) {
  const feed = (fid, fnick, fdesc, fidClass, fidInfo) => `
  <div data-e2e="feed-active-video" class="${realClass(fidClass || fid)}">
    <video></video>
    <div data-e2e="video-info" data-e2e-aweme-id="${fidInfo === undefined ? fid : fidInfo}">
      <a data-e2e="video-avatar" href="//www.douyin.com/user/MS4wLjABAAAAhyMn2j4zwK_XsDqho7-keujlh-4JkVReb9iB"></a>
      <span data-e2e="feed-video-nickname">@${fnick}</span><span>· 1天前</span>
      <div data-e2e="video-desc">${fdesc}展开</div>
    </div>
  </div>`;

  const main = withContent
    ? feed(id, nick, desc, id, id)
    : `
  <div data-e2e="feed-active-video" class="${realClass(id)}">
    <video></video>
    <div data-e2e="video-info" data-e2e-aweme-id="${id}">
      <a data-e2e="video-avatar" href=""></a>
      <span data-e2e="feed-video-nickname"></span>
      <div data-e2e="video-desc"></div>
    </div>
  </div>`;

  return `<!DOCTYPE html><html><head><title>抖音 - 记录美好生活</title></head><body>
  <div id="header">抖音</div>
  ${main}
  ${extraFeeds.join('\n')}
  </body></html>`;
}

const URL_RECOMMEND = 'https://www.douyin.com/?recommend=1';
const URL_FOLLOW = 'https://www.douyin.com/follow';
const URL_FRIEND = 'https://www.douyin.com/friend';

/* ============================ 一、URL 判定 ============================ */

function section1() {
  section('一、URL 判定：只认 / /follow /friend');
  const { api } = loadContext(immersiveHtml(), URL_RECOMMEND);

  const yes = [
    ['https://www.douyin.com/', '推荐（pathname 就是 /）'],
    ['https://www.douyin.com/?recommend=1', '推荐（带查询串）'],
    ['https://www.douyin.com/follow', '关注'],
    ['https://www.douyin.com/follow?from_nav=1', '关注（带查询串）'],
    ['https://www.douyin.com/friend', '朋友'],
    ['https://www.douyin.com/friend?from_nav=1', '朋友（带查询串）']
  ];
  const no = [
    ['https://www.douyin.com/jingxuan', '精选（瀑布流，走弹窗）'],
    ['https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F', '搜索'],
    ['https://www.douyin.com/user/MS4wLjABAAAA', '用户主页'],
    ['https://www.douyin.com/video/7496043889296559386', '视频详情页'],
    ['https://www.douyin.com/note/7516480886684568891', '图文详情页'],
    ['https://v.douyin.com/iAbCdEf/', '短链（别的域名）'],
    ['https://www.douyin.com/follow/extra', '子路径也不认（宁少不多）'],
    ['https://www.douyin.com.cn/follow', '相似域名不认'],
    ['not a url at all', '非法输入不崩']
  ];

  yes.forEach(([u, why]) => truthy(`认：${why}`, api.isImmersivePage(u)));
  no.forEach(([u, why]) => falsy(`不认：${why}`, api.isImmersivePage(u)));
  eq('三个路径的白名单就这三条', Object.keys(api.IMMERSIVE_PATHS).sort().join(','), '/,/follow,/friend');
}

/* ======================= 二、认出「当前这一条」 ======================= */

function section2() {
  section('二、认出当前这一条（宁空不错）');

  // --- 2.1 正常：class 与 info 的 ID 一致 ---
  {
    const { api, d } = loadContext(immersiveHtml(), URL_FOLLOW);
    const ctx = api.immersiveContext(d);
    truthy('认出了当前这一条', ctx);
    eq('作品 ID 来自本条容器', ctx && ctx.id, '7700906375912991603');
    eq('模式标成 immersive', ctx && ctx.mode, 'immersive');
    truthy('scope 是 feed-active-video 那个节点',
      ctx && ctx.scope && ctx.scope.getAttribute('data-e2e') === 'feed-active-video');
    truthy('info 是本条里的 video-info',
      ctx && ctx.info && ctx.info.getAttribute('data-e2e-aweme-id') === '7700906375912991603');
    eq('能读到文案', api.textOf(ctx && ctx.info && ctx.info.querySelector('[data-e2e="video-desc"]')).slice(0, 4), '这个卡点');
    eq('能读到作者主页',
      ctx && api.extractAvatarHref(ctx.scope).slice(0, 30), '//www.douyin.com/user/MS4wLjAB');
    // getWorkId / getRoot 与 resolve 一致
    eq('getWorkId 同源', api.getWorkId(d), '7700906375912991603');
    truthy('getRoot 拿到的是同一个节点', api.getRoot(d) === ctx.scope);
  }

  // --- 2.2 关注页：整页有 2 个 video-info，另一个在别的条目里 ---
  {
    const html = immersiveHtml({
      extraFeeds: [`
  <div data-e2e="feed-video" class="video_7700622539806520994">
    <div data-e2e="video-info" data-e2e-aweme-id="7700622539806520994">
      <span data-e2e="feed-video-nickname">@列表里另一条</span>
      <div data-e2e="video-desc">不是正在播的那条</div>
    </div>
  </div>`]
    });
    const { api, d } = loadContext(html, URL_FOLLOW);
    eq('整页确实有 2 个 video-info', d.querySelectorAll('[data-e2e="video-info"]').length, 2);
    const ctx = api.immersiveContext(d);
    eq('取的是正在播的那一条，不是列表里另一条', ctx && ctx.id, '7700906375912991603');
    eq('昵称也是本条作者的',
      api.textOf(ctx && ctx.info && ctx.info.querySelector('[data-e2e="feed-video-nickname"]')), '@芝知');
    falsy('没有把列表里那条的文案带上',
      String(api.textOf(ctx && ctx.info)).includes('不是正在播的那条'));
  }

  // --- 2.3 class 与 info 的 ID 对不上 = 正在切条，绝不凑 ---
  {
    const html = immersiveHtml({ id: '7700906375912991603' }).replace(
      'data-e2e-aweme-id="7700906375912991603"', 'data-e2e-aweme-id="7700622539806520994"');
    const { api, d } = loadContext(html, URL_FOLLOW);
    const ctx = api.immersiveContext(d);
    falsy('两个 ID 一新一旧 → 认不出，返回空', ctx);
    eq('getWorkId 也为空', api.getWorkId(d), '');
    falsy('isOpen 也不认（宁空不错）', api.isOpen(d));
  }

  // --- 2.4 空壳：容器在、内容全空 ---
  {
    const { api, d } = loadContext(immersiveHtml({ withContent: false }), URL_FOLLOW);
    falsy('内容全空 → 认不出', api.immersiveContext(d));
  }

  // --- 2.5 同一个 video_<id> 还挂在侧栏空壳上（弹窗批 2 踩过的坑） ---
  {
    const html = immersiveHtml().replace('</body>', `
  <div data-e2e="feed-active-video" class="${realClass('7700906375912991603')} side-card-typography-scope">
    <div data-e2e="video-info" data-e2e-aweme-id="7700906375912991603"></div>
  </div>
  </body>`);
    const { api, d } = loadContext(html, URL_FOLLOW);
    eq('有 2 个 feed-active-video', d.querySelectorAll('[data-e2e="feed-active-video"]').length, 2);
    const ctx = api.immersiveContext(d);
    eq('空壳被排除，仍然认出真正那一条', ctx && ctx.id, '7700906375912991603');
    truthy('拿到的是有内容的那个', ctx && api.textOf(ctx.info).includes('这个卡点'));
  }

  // --- 2.6 两条都像「当前」且 ID 不同 → 认不出，不猜 ---
  {
    const html = immersiveHtml({
      extraFeeds: [`
  <div data-e2e="feed-active-video" class="${realClass('7700622539806520994')}">
    <div data-e2e="video-info" data-e2e-aweme-id="7700622539806520994">
      <span data-e2e="feed-video-nickname">@另一个也在播</span>
      <div data-e2e="video-desc">也像当前这条</div>
    </div>
  </div>`]
    });
    const { api, d } = loadContext(html, URL_FOLLOW);
    falsy('两条都像当前 → 返回空（绝不猜）', api.immersiveContext(d));
  }

  // --- 2.7 没有 feed-active-video（切条瞬间真机实测出现过） ---
  {
    const { api, d } = loadContext(immersiveHtml().replace('data-e2e="feed-active-video"', 'data-e2e="feed-video"'), URL_FOLLOW);
    falsy('没有正在播的那一条 → 返回空', api.immersiveContext(d));
  }
}

/* ==================== 三、弹窗永远优先 ==================== */

function section3() {
  section('三、弹窗优先：地址栏 modal_id / 弹层立起来时交回弹窗逻辑');

  // --- 3.1 地址栏有 modal_id ---
  {
    const { api, d } = loadContext(immersiveHtml(), URL_FOLLOW + '?modal_id=7700906375912991603');
    falsy('沉浸流让位（addressbar 有 modal_id）', api.immersiveContext(d));
    eq('playbackMode 判成弹窗', api.playbackMode(d), 'modal');
    truthy('isOpen 仍然为真（弹窗态）', api.isOpen(d));
    const r = api.resolve(d);
    eq('resolve 走的是弹窗分支（mode=modal）', r && r.mode, 'modal');
  }

  // --- 3.2 弹层真的立起来了（没有 modal_id，但有 modal-video-container + 文案） ---
  {
    const html = immersiveHtml().replace('</body>', `
  <div data-e2e="modal-video-container">
    <div data-e2e="video-desc">弹层里的文案</div>
  </div>
  </body>`);
    const { api, d } = loadContext(html, URL_FOLLOW);
    falsy('沉浸流让位（弹层立起来了）', api.immersiveContext(d));
    eq('playbackMode 判成弹窗', api.playbackMode(d), 'modal');
  }

  // --- 3.3 只有空壳 modal-video-container（没文案）→ 不算弹窗 ---
  {
    const html = immersiveHtml().replace('</body>', `
  <div data-e2e="modal-video-container"></div>
  </body>`);
    const { api, d } = loadContext(html, URL_FOLLOW);
    falsy('空壳弹层不算弹窗', api.hasModalLayer(d));
    eq('playbackMode 仍然是沉浸流', api.playbackMode(d), 'immersive');
    truthy('沉浸流照常认出', api.immersiveContext(d));
  }

  // --- 3.4 不在沉浸流页 → 一律返回空 ---
  {
    const { api, d } = loadContext(immersiveHtml(), 'https://www.douyin.com/jingxuan');
    falsy('精选页不走沉浸流', api.immersiveContext(d));
    eq('playbackMode 为空', api.playbackMode(d), '');
    falsy('isOpen 为假', api.isOpen(d));
    falsy('resolve 为 null', api.resolve(d));
  }
}

/* ==================== 四、三个函数的一致性 ==================== */

function section4() {
  section('四、playbackMode / isOpen / resolve 必须互相自洽');
  const { api, d } = loadContext(immersiveHtml(), URL_FRIEND);

  eq('playbackMode = immersive', api.playbackMode(d), 'immersive');
  truthy('isOpen = true', api.isOpen(d));
  const ctx = api.resolve(d);
  eq('resolve.mode = immersive', ctx && ctx.mode, 'immersive');
  eq('resolve.id = getWorkId', ctx && ctx.id, api.getWorkId(d));

  // 日期片段：切掉昵称后剩「· 1天前这个卡点…」，交给 aweme-id-date 解析
  const seg = api.extractDateSegment(ctx.info);
  truthy('日期片段里能看见相对时间', seg.includes('1天前'));
  falsy('日期片段里不含昵称', seg.includes('芝知'));
}

/* ==================== 五、watch：切条与切页 ==================== */

async function section5() {
  section('五、watch：切条能感知、切到别的页面会变成 closed');

  const { api, d } = loadContext(immersiveHtml(), URL_FOLLOW);
  const events = [];
  const stop = api.watch((e) => events.push(e), { debounceMs: 20 });

  await sleep(60);
  eq('初始回调：认出这一条', events.length && events[0].id, '7700906375912991603');
  eq('初始回调带 mode', events.length && events[0].mode, 'immersive');
  truthy('初始回调 opened=true', events.length && events[0].opened);

  // 切条：真机实测是「换掉整个条目节点」（childList 变化 14 次），不是只改属性。
  // 所以这里也整块替换，模拟真实切条。
  const oldAct = d.querySelector('[data-e2e="feed-active-video"]');
  const holder = d.createElement('div');
  holder.innerHTML = `
  <div data-e2e="feed-active-video" class="${realClass('7700622539806520994')}">
    <video></video>
    <div data-e2e="video-info" data-e2e-aweme-id="7700622539806520994">
      <a data-e2e="video-avatar" href="//www.douyin.com/user/MS4wLjABAAAAnew"></a>
      <span data-e2e="feed-video-nickname">@下一条</span><span>· 2小时前</span>
      <div data-e2e="video-desc">下一条的文案</div>
    </div>
  </div>`;
  oldAct.parentNode.replaceChild(holder.firstElementChild, oldAct);
  await sleep(160);
  const last = events[events.length - 1];
  eq('切条后回调新的一条', last && last.id, '7700622539806520994');
  eq('切条后仍是 immersive', last && last.mode, 'immersive');

  // 切到精选页（不归本模块管）
  const before = events.length;
  d.defaultView.history.replaceState({}, '', '/jingxuan');
  await sleep(160);
  const after = events[events.length - 1];
  eq('切到精选页 → 多了一次通知', events.length > before, true);
  eq('切到精选页 → opened=false', after && after.opened, false);
  eq('切到精选页 → id 清空', after && after.id, '');

  // 切回关注页 → 重新认出
  d.defaultView.history.replaceState({}, '', '/follow');
  await sleep(160);
  const back = events[events.length - 1];
  eq('切回关注页 → 又认出来了', back && back.opened, true);
  eq('切回关注页 → mode=immersive', back && back.mode, 'immersive');

  // 同一条重复抖动（点赞数变化之类）不该重复回调
  const n = events.length;
  const desc = d.querySelector('[data-e2e="video-desc"]');
  desc.textContent = '这个卡点～帅！#呀吖摇 #卡点（点赞数变了）';
  await sleep(120);
  eq('内容抖动不重复回调', events.length, n);

  stop();
}

/* ==================== 六、端到端（真实 content-main） ==================== */

/**
 * 从 background.js 的真源码里抠出抖音的媒体配置。
 *
 * 为什么不用手写常量：这三页能不能「不出按钮但挂上监听」，完全取决于
 * `noContentFallback: true` 这一条（路径不匹配就放弃，不按正文猜类型）。
 * 一旦有人把它删了，/follow 会被猜成 social → 走全流程 → 监听压根挂不上 →
 * 这三页又会退回「没按钮」。所以直接从源码读，改了就会被这条测试抓到。
 */
function douyinMediaConfigFromSource() {
  const backgroundPath = path.resolve(__dirname, '../ClipMate_chrome/src/background/background.js');
  const src = fs.readFileSync(backgroundPath, 'utf8');
  const anchor = src.indexOf("'www.douyin.com':");
  if (anchor < 0) throw new Error('background.js 里找不到 www.douyin.com 的媒体配置');
  // 只取抖音这一段 —— 截到下一个站点（v.douyin.com）为止。
  // 用固定字符窗口会把 v.douyin / 快手的规则一起抓进来，
  // 它们里面有 `patterns: ['/']`，对 /follow 直接命中 '/' → 判定成 social，测试当场假红。
  const endAnchor = src.indexOf("'v.douyin.com':", anchor);
  const tail = src.slice(anchor, endAnchor > anchor ? endAnchor : anchor + 2400);

  // v2.7.11：抖音从「单条 type/patterns」升级成 rules 多规则
  // （`/user/<sec_uid>` 是作者主页 = person，带 `?modal_id=` 时是作品弹窗，必须排除）。
  // 这里按规则逐条解析，不再取第一个 type/patterns —— 否则抓到的是 person 那条，
  // 会把「详情页只认两条」的断言变成假红/假绿。
  const rules = [];
  const ruleRe = /\{\s*type:\s*'([^']+)',\s*patterns:\s*\[([^\]]*)\]([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(tail)) && rules.length < 4) {
    const rest = m[3] || '';
    const exM = /excludeQuery:\s*\[([^\]]*)\]/.exec(rest);
    rules.push({
      type: m[1],
      patterns: m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean),
      excludeQuery: exM
        ? exM[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
        : []
    });
  }

  return {
    rules,
    noContentFallback: /noContentFallback:\s*true/.test(tail)
  };
}

async function section6() {
  section('六、端到端：真实 content-main 在沉浸流页出按钮 + 锚点标记');

  const H = require('./lib/harness');

  const douyinCfg = douyinMediaConfigFromSource();
  eq('background 的抖音配置声明了 noContentFallback（少了这条这三页就废）', douyinCfg.noContentFallback, true);

  const socialRule = douyinCfg.rules.find((r) => r.type === 'social') || { patterns: [] };
  const personRule = douyinCfg.rules.find((r) => r.type === 'person') || { patterns: [], excludeQuery: [] };
  eq('详情页那条仍然是 social，且只认两条路径', socialRule.patterns.join(','), '/video/,/note/');
  eq('person 那条只认作者主页', personRule.patterns.join(','), '/user/');
  truthy('person 那条必须排除 modal_id（否则作品弹窗被当成作者主页）',
    personRule.excludeQuery.indexOf('modal_id') > -1,
    'excludeQuery=' + JSON.stringify(personRule.excludeQuery));
  truthy('规则顺序：person 在前、social 在后',
    douyinCfg.rules[0].type === 'person' && douyinCfg.rules[1].type === 'social',
    '实际顺序 ' + douyinCfg.rules.map((r) => r.type).join(' → '));

  const mediaConfigs = { 'www.douyin.com': douyinCfg };

  const page = await H.openPage({
    url: URL_FOLLOW,
    // 页面上放一个**常驻空弹层**（抖音真实页面就有），验证按钮锚点不会去拿它
    html: immersiveHtml().replace('</body>', '<div data-e2e="modal-video-container"></div></body>'),
    mediaConfigs
  });
  const inst = await H.waitForInit(page, 8000);
  const w = page.window;
  const d = w.document;

  truthy('拿得到 content-main 实例', inst);
  eq('页面上一共 1 个提取按钮', d.querySelectorAll('.media-extractor-button').length, 1);
  const btn = d.querySelector('.media-extractor-button');
  eq('按钮打了沉浸流锚点标记', btn && btn.getAttribute('data-clipmate-anchor'), 'douyin-immersive');
  truthy('实例已接管（isInitialized）', inst && inst.isInitialized);
  eq('记下的作品 ID 是当前这一条', inst && inst._douyinModalId, '7700906375912991603');
  eq('模式标成 immersive', inst && inst._douyinMode, 'immersive');
  eq('类型补认成 social', inst && inst.detectMediaType(), 'social');
  truthy('挂了监听', inst && typeof inst._douyinWatch === 'function');

  // 锚点必须取「本条容器」，不能取常驻的空弹层
  // （真机踩过：空壳 modal-video-container 几何为 0 → 按钮飘到顶边 top=20，正确是 72）
  const anchorEl = inst && inst._douyinAnchorElement ? inst._douyinAnchorElement() : null;
  eq('锚点取的是本条容器（不是空弹层）',
    anchorEl && anchorEl.getAttribute('data-e2e'), 'feed-active-video');

  // 点按钮 → 7 个字段
  let data = null;
  try {
    data = await inst.extractFromCurrentPage();
  } catch (e) {
    bad('提取抛错', e && e.message);
  }
  truthy('提取出了字段', data && typeof data === 'object');
  // 7 个业务字段（字段清单与弹窗页、详情页共用同一份 SOCIAL_FIELDS）
  const SOCIAL_KEYS = ['本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'];
  const keys = data ? Object.keys(data) : [];
  eq('7 个社交业务字段一个不少', SOCIAL_KEYS.every((k) => keys.includes(k)), true);
  eq('URL 指向这条作品', data && data['URL'], 'https://www.douyin.com/video/7700906375912991603');
  eq('作者昵称', data && data['作者昵称'], '芝知');
  eq('作者主页', data && data['作者主页'], 'https://www.douyin.com/user/MS4wLjABAAAAhyMn2j4zwK_XsDqho7-keujlh-4JkVReb9iB');
  truthy('本页文案非空且去掉了「展开」', data && data['本页文案'] && !/展开$/.test(data['本页文案']));
  truthy('发布日期非空', data && data['发布日期']);
  truthy('本页标题非空', data && data['本页标题']);
  eq('媒体类型是 social（浮窗才会按 7 行显示）', data && data.mediaType, 'social');
  eq('站点标识不变', data && data.sourceSite, 'douyin_social');
  eq('平台字段', data && data['平台'], '抖音');

  w.close();
  await sleep(50);
}

/* ====== 七、开关独立：沉浸流关掉不影响弹窗，弹窗关掉不影响沉浸流 ====== */

async function section7() {
  section('七、两个开关互不牵连');

  const H = require('./lib/harness');
  const mediaConfigs = { 'www.douyin.com': douyinMediaConfigFromSource() };

  // 7.1 沉浸流开关关掉 → 沉浸流页不出按钮
  {
    const page = await H.openPage({
      url: URL_FOLLOW,
      html: immersiveHtml(),
      mediaConfigs,
      chromePatch: (chrome) => { chrome.storage.local.set({ douyinImmersiveEnabled: false }); }
    });
    await H.waitForInit(page, 3000);
    const inst = page.bridge.getInstance ? page.bridge.getInstance() : null;
    const d = page.window.document;
    eq('沉浸流关掉 → 一个按钮都没有', d.querySelectorAll('.media-extractor-button').length, 0);
    // 手动喂一次沉浸流事件也不许接管（开关是最后一道闸）
    if (inst && inst._onDouyinModalState) {
      inst._onDouyinModalState({ id: '7700906375912991603', opened: true, mode: 'immersive' });
      await sleep(60);
    }
    eq('喂了事件也不接管', d.querySelectorAll('.media-extractor-button').length, 0);
    page.window.close();
    await sleep(50);
  }

  // 7.2 沉浸流关掉但弹窗开着 → 弹窗页照样接管
  {
    const page = await H.openPage({
      url: 'https://www.douyin.com/jingxuan?modal_id=7700906375912991603',
      html: immersiveHtml(),
      mediaConfigs,
      chromePatch: (chrome) => {
        chrome.storage.local.set({ douyinImmersiveEnabled: false });
      }
    });
    await H.waitForInit(page, 3000);
    const inst = page.bridge.getInstance ? page.bridge.getInstance() : null;
    truthy('弹窗页仍能拿到实例', inst);
    // 直接把弹窗态推给它（真实弹层结构不在本测试的 HTML 里）
    if (inst && inst._onDouyinModalState) {
      await inst._onDouyinModalState({ id: '7700906375912991603', opened: true, mode: 'modal' });
      await sleep(80);
    }
    const d = page.window.document;
    eq('弹窗关掉沉浸流也照样接管（开关互不牵连）',
      d.querySelectorAll('.media-extractor-button').length, 1);
    page.window.close();
    await sleep(50);
  }
}

/* ==================== 八、残影节点（v2.5.81 主修） ==================== */

/** 给 jsdom 元素伪造版面尺寸（jsdom 里 getBoundingClientRect 恒为 0） */
function geo(el, width, height) {
  el.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON() { return {}; }
  });
  return el;
}

/** 一条 feed-active-video（真机 class 串） */
function actNode(id, nick, desc) {
  return `
  <div data-e2e="feed-active-video" class="${realClass(id)}">
    <video></video>
    <div data-e2e="video-info" data-e2e-aweme-id="${id}">
      <a data-e2e="video-avatar" href="//www.douyin.com/user/MS4wLjABAAAA${id}"></a>
      <span data-e2e="feed-video-nickname">@${nick}</span><span>· 1天前</span>
      <div data-e2e="video-desc">${desc}展开</div>
    </div>
  </div>`;
}

function wrap(inner) {
  return `<!DOCTYPE html><html><head><title>抖音</title></head><body><div id="header">抖音</div>${inner}</body></html>`;
}

async function section8() {
  section('八、残影节点：切走的页面留下的 0×0 不许算候选（v2.5.81）');

  // 8.0 hasGeometry 本身
  {
    const { api, d } = loadContext(immersiveHtml(), URL_FOLLOW);
    const act = d.querySelector('[data-e2e="feed-active-video"]');
    falsy('jsdom 默认 0×0 → 没版面', api.hasGeometry(act));
    geo(act, 597, 809);
    truthy('597×809 → 有版面', api.hasGeometry(act));
    geo(act, 0, 809);
    falsy('只有宽是 0 → 也算没版面', api.hasGeometry(act));
    falsy('传 null 不崩', api.hasGeometry(null));
  }

  // 8.1 真机 2026-10-27 现场原样：推荐留下的残影 0×0 + 关注当前 597×809
  {
    const html = wrap(actNode('7701311909727863225', '推荐页留下的', '推荐页那一条')
      + actNode('7700943436304125625', '关注页当前', '关注页正在播的'));
    const { api, d } = loadContext(html, URL_FOLLOW);
    const acts = Array.from(d.querySelectorAll('[data-e2e="feed-active-video"]'));
    geo(acts[0], 0, 0);       // 切走那一页的残影
    geo(acts[1], 597, 809);   // 真正在播的

    const ctx = api.immersiveContext(d);
    truthy('[切标签] 认出了当前这一条', ctx);
    eq('[切标签] 取的是「有版面」的那条，不是残影', ctx && ctx.id, '7700943436304125625');
    eq('[切标签] 文案也来自这一条',
      ctx && api.textOf(ctx.info).indexOf('关注页正在播的') >= 0, true);
    eq('[切标签] getWorkId 一致', api.getWorkId(d), '7700943436304125625');
    truthy('[切标签] isOpen 为真（不是 closed）', api.isOpen(d));
    eq('[切标签] playbackMode 仍是 immersive', api.playbackMode(d), 'immersive');
  }

  // 8.2 切回推荐页：几何互换（原残影变成有版面、原来那条缩成 0×0）
  {
    const html = wrap(actNode('7701311909727863225', '推荐页当前', '推荐页正在播的')
      + actNode('7700943436304125625', '关注页留下的', '关注页那一条'));
    const { api, d } = loadContext(html, URL_RECOMMEND);
    const acts = Array.from(d.querySelectorAll('[data-e2e="feed-active-video"]'));
    geo(acts[0], 805, 809);   // 推荐页当前
    geo(acts[1], 0, 0);       // 关注页残影
    eq('[切回推荐] 取推荐页当前这条', api.getWorkId(d), '7701311909727863225');
  }

  // 8.3 两条都真有版面 → 仍然不许猜（宁空不错这条规矩不能被「按版面过滤」冲掉）
  {
    const html = wrap(actNode('7701311909727863225', '甲', '甲')
      + actNode('7700943436304125625', '乙', '乙'));
    const { api, d } = loadContext(html, URL_FOLLOW);
    const acts = Array.from(d.querySelectorAll('[data-e2e="feed-active-video"]'));
    geo(acts[0], 597, 809);
    geo(acts[1], 597, 809);
    eq('[两条都有版面] 认不出就返回空（不猜）', api.immersiveContext(d), null);
    falsy('[两条都有版面] isOpen 为假', api.isOpen(d));
  }

  // 8.4 全都没版面（jsdom / 刚渲染还没布局）→ 退回旧判据，行为不变
  {
    const html = wrap(actNode('7701311909727863225', '甲', '甲'));
    const { api, d } = loadContext(html, URL_FOLLOW);
    eq('[全都没版面] 唯一一条仍然认得出（jsdom 兼容）', api.getWorkId(d), '7701311909727863225');

    const html2 = wrap(actNode('7701311909727863225', '甲', '甲')
      + actNode('7700943436304125625', '乙', '乙'));
    const r2 = loadContext(html2, URL_FOLLOW);
    eq('[全都没版面·两条] 退回旧判据 → 认不出', r2.api.immersiveContext(r2.d), null);
  }

  // 8.5 watch 层：切标签（残影+新条）→ 回调新页那条，而不是 opened=false
  //     —— 这条就是用户报的那个 bug 的「最小复现」
  //     （v2.5.80 会在这里回调 opened=false，然后按钮永久消失）
  {
    const { api, d } = loadContext(wrap(actNode('7701311909727863225', '推荐', '推荐页那一条')), URL_RECOMMEND);
    let act = d.querySelector('[data-e2e="feed-active-video"]');
    geo(act, 805, 809);

    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 150 });
    await sleep(60);
    eq('[watch·起点] 认出推荐页这条', events.length && events[0].id, '7701311909727863225');

    // 切到关注页：抖音把推荐那条缩成 0×0，另挂一个关注页的节点
    geo(act, 0, 0);
    const holder = d.createElement('div');
    holder.innerHTML = actNode('7700943436304125625', '关注', '关注页正在播的');
    const newAct = holder.firstElementChild;
    geo(newAct, 597, 809);
    d.body.appendChild(newAct);

    await sleep(200);
    const last = events[events.length - 1];
    eq('[watch·切标签] 回调的是关注页那条', last && last.id, '7700943436304125625');
    eq('[watch·切标签] opened 仍为 true（没被当成关闭）', last && last.opened, true);
    eq('[watch·切标签] mode=immersive', last && last.mode, 'immersive');
    eq('[watch·切标签] 全程没有任何 opened=false',
      events.filter((e) => !e.opened).length, 0);
    stop();
  }

  // 8.6 真机另一种现场：换页瞬间只剩上一页的残影（候选全 0×0，但整页明明有版面）
  //     → 不许把按钮贴到看不见的残影上，按「认不出」处理
  {
    const html = wrap(actNode('7701311909727863225', '上一页残影', '上一页那一条'));
    const { api, d } = loadContext(html, URL_RECOMMEND);
    const act = d.querySelector('[data-e2e="feed-active-video"]');
    geo(act, 0, 0);

    eq('[换页残影·无版面页] 仍退回旧判据（jsdom 兼容）', api.getWorkId(d), '7701311909727863225');
    falsy('[换页残影·无版面页] hasPageLayout 为假', api.hasPageLayout(d));

    // 模拟真机：整页有版面（jsdom 的 scrollHeight 恒为 0，这里手工盖掉）
    Object.defineProperty(d.body, 'scrollHeight', { value: 809, configurable: true });
    truthy('[换页残影·有版面页] hasPageLayout 为真', api.hasPageLayout(d));
    eq('[换页残影·有版面页] 候选全 0×0 → 认不出（不拿残影当锚点）',
      api.immersiveContext(d), null);
    falsy('[换页残影·有版面页] isOpen 为假 → watch 走 pending', api.isOpen(d));
  }
}

/* ============== 九、pending：这一瞬间认不出 ≠ 真的没了 ============== */

async function section9() {
  section('九、pending：认不出不回调，超时才按 closed 处理（v2.5.81）');

  // 9.1 关注页切条空窗（真机实测约 0.9 秒「有版面的 active = 0」）→ 不许回调 opened=false
  {
    const { api, d } = loadContext(wrap(actNode('7700943436304125625', '关注', '先播着的这条')), URL_FOLLOW);
    const act = d.querySelector('[data-e2e="feed-active-video"]');
    geo(act, 597, 809);

    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 400 });
    await sleep(60);
    eq('[切条·起点] 认出这一条', events.length && events[0].id, '7700943436304125625');

    // 切条空窗：节点缩成 0×0（真机就是这个形态），稍后才换上新节点
    const beforeCount = events.length;
    geo(act, 0, 0);
    d.body.appendChild(d.createElement('span'));
    await sleep(200);
    eq('[切条空窗] 没有回调 opened=false（浮窗不会被关）',
      events.filter((e) => !e.opened).length, 0);
    eq('[切条空窗] 也没有多余回调', events.length, beforeCount);

    // 新条装好了
    const holder = d.createElement('div');
    holder.innerHTML = actNode('7700622539806520994', '下一条', '切条后的新文案');
    const newAct = holder.firstElementChild;
    geo(newAct, 597, 809);
    d.body.replaceChild(newAct, act);
    await sleep(200);
    const last = events[events.length - 1];
    eq('[切条完成] 回调新的一条', last && last.id, '7700622539806520994');
    eq('[切条完成] 中途始终没有 opened=false',
      events.filter((e) => !e.opened).length, 0);
    stop();
  }

  // 9.2 一直认不出超过 pendingMs → 兜底按 closed 处理（按钮不能永久僵在页面上）
  {
    const { api, d } = loadContext(wrap(actNode('7700943436304125625', '关注', '先播着的这条')), URL_FOLLOW);
    const act = d.querySelector('[data-e2e="feed-active-video"]');
    geo(act, 597, 809);

    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 200 });
    await sleep(60);
    // 内容真的没了（节点被摘掉），但地址栏还停在 /follow
    act.parentNode.removeChild(act);
    d.body.appendChild(d.createElement('span'));
    await sleep(500);
    const closed = events.filter((e) => !e.opened);
    eq('[超时兜底] 回调了一次 opened=false', closed.length, 1);
    eq('[超时兜底] 关闭时 id 为空', closed.length && closed[0].id, '');

    // 再抖动一次也不该重复回调关闭
    d.body.appendChild(d.createElement('span'));
    await sleep(300);
    eq('[超时兜底] 不重复回调关闭', events.filter((e) => !e.opened).length, 1);
    stop();
  }

  // 9.3 切到精选页 → 立即 closed，不等 pendingMs
  {
    const { api, d } = loadContext(wrap(actNode('7700943436304125625', '关注', '先播着的这条')), URL_FOLLOW);
    const act = d.querySelector('[data-e2e="feed-active-video"]');
    geo(act, 597, 809);

    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 3000 });
    await sleep(60);
    const t0 = Date.now();
    d.defaultView.history.replaceState({}, '', '/jingxuan');
    geo(act, 0, 0);
    d.body.appendChild(d.createElement('span'));
    // 260ms < pendingMs(3000)，如果误走 pending 就等不到
    await sleep(260);
    const last = events[events.length - 1];
    eq('[切到精选] 立刻 opened=false（不走 pending 兜底）', last && last.opened, false);
    truthy('[切到精选] 用时远小于 pendingMs', Date.now() - t0 < 1500);
    stop();
  }
}

/* ============================== 收尾 ============================== */

(async () => {
  console.log(`${C.cyan}抖音沉浸流识别与接线验收（v2.5.81）${C.reset}`);
  section1();
  section2();
  section3();
  section4();
  await section5();
  await section6();
  await section7();
  await section8();
  await section9();

  console.log('');
  if (failures.length) {
    console.log(`${C.red}失败 ${failures.length} 项${C.reset} / 通过 ${pass} 项`);
    failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name}${f.detail ? C.gray + '  ' + f.detail + C.reset : ''}`));
    process.exit(1);
  }
  console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
})().catch((e) => {
  console.error(`${C.red}测试脚本自身崩了：${C.reset}`, e);
  process.exit(2);
});
