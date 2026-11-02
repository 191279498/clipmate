#!/usr/bin/env node
/**
 * 快手「搜索页弹层」接管验收（v2.5.88）
 *
 * 要钉住的事：**搜索页点开卡片盖上 `.player-pop` 之后，按钮要出现，7 个字段要正确，
 * 关掉弹层按钮要撤干净，而且弹层里跑出来的字符串必须和详情页逐字一致。**
 *
 * 真机证据（2026-10-28，借用户 Edge，`/search/video?searchKey=街拍`）：
 *   | 时刻                | 地址            | 文档导航次数 | 页内 video | 按钮 |
 *   | 打开搜索页          | /search/video   | 1            | 0          | 0（对）|
 *   | 点开卡片            | **一个字没变**  | 1            | 0 → 2      | **0 ❌** |
 *   弹层结构（逐项核对，与推荐流几乎同构）：
 *     `.player-pop` → `.swiper-slide-active` → `a.name`（profile 链接）→ `.caption`
 *     → `img.background`（作品 ID 与日期都在这条地址里）
 *   弹层关着时 `.player-pop` / `.swiper` / `.swiper-slide-active` **都是 0 个**（不是常驻空壳）。
 *
 * 日期到秒的实证（A 方案）：
 *   弹层封面 `.../upic/2026/03/15/18/BMjAyNjAzMTUxODE2NTdf..._ccc_....jpg`
 *   → Base64 解出 `20260315181657` → `2026/03/15 18:16:57`
 *   → 打开 `/short-video/3xc8n9zzuu9xy3i`，详情页封面**同一串 base64**，逐字相同。
 *
 * 本脚本十节：
 *   一、页面判定：哪些 page 认、哪些不认（宁少不多）
 *   二、弹层识别：5 个字段 + mode=popup
 *   三、作用域隔离：列表页自己的 slide 不许被认（这是本批最大的坑）
 *   四、日期到秒 + 交叉校验回落
 *   五、watch 状态机：出现 / 切条 / 移除 / 认不出时保持
 *   六、端到端：搜索页 → 弹层开 → 1 个按钮（锚点 kuaishou-popup）→ 7 字段 → 关弹层 0 按钮
 *   七、弹层里点「查看详情」转详情页：按钮交给 route，不许两边打架
 *   八、入口门禁与互斥：/new-reco 不挂 route，搜索页两条都挂
 *   九、类型补认 + 工厂岔路口
 *   十、回归：推荐流行为完全不变（同一份产物两套态互不干扰）
 *
 * 用法：
 *   node tests/kuaishou-popup.test.js
 *   node tests/kuaishou-popup.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const CTX_PATH = path.join(ROOT, 'src/content/shared/kuaishou-immersive-context.js');
const COVER_PATH = path.join(ROOT, 'src/content/shared/kuaishou-cover-time.js');
const SPA_PATH = path.join(ROOT, 'src/content/ui/kuaishou-spa-handler.js');
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

/* ============================ 真机抓到的原样数据 ============================ */

/** 弹层里抓到的第一条封面（真机原样，未改一个字符） */
const REAL_POP_COVER =
  'https://p2.a.yximgs.com/upic/2026/03/15/18/'
  + 'BMjAyNjAzMTUxODE2NTdfNDgzNDg2ODkzNV8xOTA0NDExNDk2MzhfMF8z_ccc_B418cd316aab009f5736d909fcab106da.jpg'
  + '?tag=1-1793156525-xpcwebsearch-0-y57txehmmw-e59ff9d5181affee'
  + '&clientCacheKey=3xc8n9zzuu9xy3i_ccc.jpg&di=JA4DkZACbHBBhNXOssS7pw==&bp=10004';

/** 同一页的下一条（用来验证「切条会换 ID」） */
const REAL_POP_COVER_2 =
  'https://p23.a.yximgs.com/upic/2026/06/28/08/'
  + 'BMjAyNjA2MjgwODA4NDRfMjcwNTI2NzE1Nl8yMDAyOTQ0NTk1OThfMl8z_B9bcbfac0cee07763e533b4ffcfa142a5.jpg'
  + '?clientCacheKey=3xyme56rx8vimrm.jpg&bp=10004';

const SEARCH_URL = 'https://www.kuaishou.com/search/video?searchKey=%E8%A1%97%E6%8B%8D';

/* ============================ 页面模板 ============================ */

/** 搜索页本体（弹层关着时真机就是这样：没有 .player-pop、没有 .swiper） */
function searchPageHtml(listSlides) {
  return `<!doctype html><html><head><title>街拍 - 快手搜索</title></head><body>
<div class="workbench search-view">
  <div class="search-result">
    <div class="cards">
      <div class="photo-card"><img src="${REAL_POP_COVER}"></div>
      <div class="photo-card"><img src="${REAL_POP_COVER_2}"></div>
    </div>
  </div>
  ${listSlides || ''}
</div>
</body></html>`;
}

/** 一条弹层内 slide（结构照真机抄） */
function popSlideHtml(opt) {
  const o = opt || {};
  const cover = o.cover || REAL_POP_COVER;
  const nick = o.nick || '@杏仁街拍';
  const profile = o.profile || 'https://www.kuaishou.com/profile/3xjwwbgbieafb99';
  const caption = o.caption || '#瑜伽裤 <a class="tag" href="/hashtag/1?source=3">#完美好身材</a>';
  const cls = 'swiper-slide' + (o.active ? ' swiper-slide-active' : '');
  const nameEl = o.noName ? '' :
    `<a class="name" href="${profile}">${nick}</a><span class="timestamp">· 7 个月前</span>`;
  return `
  <div class="${cls}" data-v-d1a10ccb="" style="height:701px;">
    <div class="video-sidebar-layout">
      ${o.noCover ? '' : `<img class="background" src="${cover}">`}
      <div class="main-area">
        <div class="video-container"><div class="kplayer-wrap VideoPlayer"><video></video></div></div>
      </div>
      <div class="video-interact-panel">
        <div class="mask">
          <div class="lb">
            <div class="line-1 _qu-ellipsis">${nameEl}</div>
            <div class="caption _qu-ellipsis-multi">${o.noCaption ? '' : caption}</div>
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

/** 整个弹层（关着时页面上压根没有这个节点） */
function popLayerHtml(slides) {
  return `
<div class="player-pop-mask" data-v-bb88b204=""></div>
<div class="player-pop" data-v-bb88b204="">
  <div class="swiper swiper-feed swiper-initialized swiper-vertical swiper-autoheight">
    <div class="swiper-wrapper">${slides}</div>
  </div>
</div>`;
}

/* ============================ 装载工具 ============================ */

function freshContext(doc, url) {
  // 每次重新 require 一份干净的（模块里有可变状态的就靠这个隔离）
  delete require.cache[require.resolve(CTX_PATH)];
  delete require.cache[require.resolve(COVER_PATH)];
  const CT = require(COVER_PATH);
  const savedWin = global.window;
  const savedDoc = global.document;
  const savedLoc = global.location;
  const savedCT = global.KuaishouCoverTime;
  global.window = { document: doc, location: { href: url }, addEventListener() {}, removeEventListener() {} };
  global.document = doc;
  global.location = { href: url, pathname: new URL(url).pathname };
  // 浏览器里 cover-time 挂在 window 上，context 直接看得见；node 里手工放同一位置
  global.KuaishouCoverTime = CT;
  delete require.cache[require.resolve(CTX_PATH)];
  const ctx = require(CTX_PATH);
  return {
    ctx,
    restore() {
      global.window = savedWin;
      global.document = savedDoc;
      global.location = savedLoc;
      if (savedCT === undefined) delete global.KuaishouCoverTime;
      else global.KuaishouCoverTime = savedCT;
    }
  };
}

function makeDoc(html, url) {
  const { JSDOM } = require('jsdom');
  return new JSDOM(html, { url }).window.document;
}

/* ============================ 一、页面判定 ============================ */

function section1() {
  section('一、页面判定：哪些页面认、哪些不认（宁少不多）');

  const Ctx = require(CTX_PATH);

  eq('[判] /search/video → 会挂监听', Ctx.isPopupPage('https://www.kuaishou.com/search/video?searchKey=x'), true);
  eq('[判] /search/photo → 会挂监听', Ctx.isPopupPage('https://www.kuaishou.com/search/photo?searchKey=x'), true);
  eq('[判] /search（裸） → 会挂监听', Ctx.isPopupPage('https://www.kuaishou.com/search'), true);

  eq('[判] /samecity 网格页 → 不认', Ctx.isPopupPage('https://www.kuaishou.com/samecity'), false);
  eq('[判] /myFollow 关注页 → 不认', Ctx.isPopupPage('https://www.kuaishou.com/myFollow'), false);
  eq('[判] /new-reco 推荐流 → 不算弹层页', Ctx.isPopupPage('https://www.kuaishou.com/new-reco'), false);
  eq('[判] /short-video/xxx 详情页 → 不认', Ctx.isPopupPage('https://www.kuaishou.com/short-video/3xabc'), false);
  // 前缀匹配必须带边界，否则 /searchxxx 这种会被误认（真机没有，但宁严不松）
  eq('[判] /searchxxx → 不认（前缀要有边界）', Ctx.isPopupPage('https://www.kuaishou.com/searchxxx'), false);
  eq('[判] 别的域名 /search/video → 不认', Ctx.isPopupPage('https://www.douyin.com/search/video'), false);

  eq('[判] shouldWatch：推荐流仍然认', Ctx.shouldWatch('https://www.kuaishou.com/new-reco'), true);
  eq('[判] shouldWatch：搜索页认', Ctx.shouldWatch('https://www.kuaishou.com/search/video'), true);
  eq('[判] shouldWatch：详情页不认', Ctx.shouldWatch('https://www.kuaishou.com/short-video/3xabc'), false);
  eq('[判] isImmersivePage 仍然只认 /new-reco（没被放宽）',
    Ctx.isImmersivePage('https://www.kuaishou.com/search/video'), false);
}

/* ============================ 二、弹层识别 ============================ */

function section2() {
  section('二、弹层识别：5 个字段 + mode=popup');

  const { ctx, restore } = freshContext(
    makeDoc(searchPageHtml(popLayerHtml(
      popSlideHtml({ active: true })
      + popSlideHtml({ cover: REAL_POP_COVER_2 })
    )), SEARCH_URL),
    SEARCH_URL
  );

  try {
    const c = ctx.immersiveContext();
    truthy('[识] 认出了当前这一条', c);
    if (!c) return;

    eq('[识] 模式是 popup（不是 immersive）', c.mode, 'popup');
    eq('[识] 作品 ID 从封面 clientCacheKey 抠出来', c.id, '3xc8n9zzuu9xy3i');
    eq('[识] 昵称去掉了 @', c.nickname, '杏仁街拍');
    eq('[识] 作者主页是完整地址', c.homepage, 'https://www.kuaishou.com/profile/3xjwwbgbieafb99');
    eq('[识] 文案（话题标签之间补空格，与详情页一致）', c.caption, '#瑜伽裤 #完美好身材');
    eq('[识] 日期精确到秒（封面文件名 Base64 解出）', c.date, '2026/03/15 18:16:57');

    // 作用域必须落在弹层里的 active slide 上（不是整个 document）
    truthy('[识] scope 是那条 slide 本身', c.scope && c.scope.classList.contains('swiper-slide-active'));

    eq('[识] getWorkId 同步可用', ctx.getWorkId(), '3xc8n9zzuu9xy3i');
    eq('[识] isOpen 为真', ctx.isOpen(), true);
  } finally {
    restore();
  }
}

/* ============================ 三、作用域隔离（最大的坑） ============================ */

function section3() {
  section('三、作用域隔离：列表页自己的 slide 不许被认；弹层关着/空壳不许认');

  // ① 弹层关着：页面上 0 个 .player-pop、但列表自己有一个 .swiper-slide-active
  {
    const listSwiper = `
<div class="swiper swiper-cards">
  <div class="swiper-wrapper">
    <div class="swiper-slide swiper-slide-active">
      <img src="${REAL_POP_COVER_2}">
      <a class="name" href="https://www.kuaishou.com/profile/3xlistowner">@列表里的别人</a>
    </div>
  </div>
</div>`;
    const url = SEARCH_URL;
    const { ctx, restore } = freshContext(makeDoc(searchPageHtml(listSwiper), url), url);
    try {
      eq('[隔] 弹层关着 → 不认（绝不拿列表的 slide 顶替）', ctx.immersiveContext(), null);
      eq('[隔] popupRoot 为 null', ctx.popupRoot(), null);
      eq('[隔] isOpen 为假', ctx.isOpen(), false);
    } finally {
      restore();
    }
  }

  // ② 弹层开着，但里面还没有 active（刚打开、还没渲染）
  {
    const url = SEARCH_URL;
    const { ctx, restore } = freshContext(
      makeDoc(searchPageHtml(popLayerHtml(popSlideHtml({ active: false }))), url), url);
    try {
      eq('[隔] 弹层里没有 active → 不认', ctx.immersiveContext(), null);
      truthy('[隔] 但 popupRoot 认得出来（用于判定「弹层开着」）', ctx.popupRoot());
    } finally {
      restore();
    }
  }

  // ③ 弹层开着、有 active，但没封面（拿不到作品 ID）→ 不认
  {
    const url = SEARCH_URL;
    const { ctx, restore } = freshContext(
      makeDoc(searchPageHtml(popLayerHtml(popSlideHtml({ active: true, noCover: true }))), url), url);
    try {
      eq('[隔] 没有封面就拿不到作品 ID → 不认', ctx.immersiveContext(), null);
    } finally {
      restore();
    }
  }

  // ④ 弹层外同时还有一个 active（真机列表页可能自带 swiper）→ 仍然只认弹层里那条
  {
    const listSwiper = `
<div class="swiper swiper-cards"><div class="swiper-wrapper">
  <div class="swiper-slide swiper-slide-active">
    <img src="${REAL_POP_COVER_2}"><a class="name" href="/profile/3xlistowner">@列表里的别人</a>
  </div>
</div></div>`;
    const url = SEARCH_URL;
    const { ctx, restore } = freshContext(
      makeDoc(searchPageHtml(listSwiper + popLayerHtml(popSlideHtml({ active: true }))), url), url);
    try {
      const c = ctx.immersiveContext();
      truthy('[隔] 内外都有 active 时仍认得出', c);
      if (c) {
        eq('[隔] 认的是弹层里那条（ID 不是列表的）', c.id, '3xc8n9zzuu9xy3i');
        eq('[隔] 昵称也不是列表的', c.nickname, '杏仁街拍');
      }
    } finally {
      restore();
    }
  }
}

/* ============================ 四、日期到秒 ============================ */

function section4() {
  section('四、日期到秒 + 三步交叉校验（真机原样 URL）');

  const CT = require(COVER_PATH);
  const saved = global.KuaishouCoverTime;
  global.KuaishouCoverTime = CT;
  try {
    eq('[秒] 弹层封面 → 2026/03/15 18:16:57',
      CT.publishDateTimeFromSrc(REAL_POP_COVER), '2026/03/15 18:16:57');
    eq('[秒] 同页第二条 → 2026/06/28 08:08:44',
      CT.publishDateTimeFromSrc(REAL_POP_COVER_2), '2026/06/28 08:08:44');

    // 路径日期与解出来的对不上 → 宁可只到日
    const wrongPath = REAL_POP_COVER.replace('/upic/2026/03/15/', '/upic/2026/04/20/');
    eq('[秒] 路径日期与解码不符 → 回落「只到日」',
      CT.publishDateTimeFromSrc(wrongPath), '2026/04/20');

    // 头像地址（/uhead/）压根不该认
    const avatar = 'https://p2.a.yximgs.com/uhead/AB/2026/10/05/BMjAyNjEwMDUxMjAwMDBfMTIz_x.jpg';
    eq('[秒] 头像地址不算封面 → 空串', CT.publishDateTimeFromSrc(avatar), '');

    // 解不出来（文件名不像 base64 时间）→ 只到日
    const junk = 'https://p2.a.yximgs.com/upic/2026/03/15/18/not-a-timestamp.jpg';
    eq('[秒] 文件名解不出来 → 只到日', CT.publishDateTimeFromSrc(junk), '2026/03/15');

    // 通过 context 的 dateFromSrc 也要走同一条（浏览器里它靠 window 上的工具）
    const Ctx = require(CTX_PATH);
    eq('[秒] context.dateFromSrc 同样到秒',
      Ctx.dateFromSrc(REAL_POP_COVER), '2026/03/15 18:16:57');
  } finally {
    if (saved === undefined) delete global.KuaishouCoverTime;
    else global.KuaishouCoverTime = saved;
  }
}

/* ============================ 五、watch 状态机 ============================ */

async function section5() {
  section('五、watch 状态机：出现 / 切条 / 移除 / 认不出时保持');

  const url = SEARCH_URL;
  const doc = makeDoc(searchPageHtml(''), url);
  const events = [];

  const savedWin = global.window;
  const savedDoc = global.document;
  const savedLoc = global.location;
  const savedCT = global.KuaishouCoverTime;
  global.window = {
    document: doc,
    location: { href: url },
    addEventListener() {},
    removeEventListener() {},
    MutationObserver: doc.defaultView.MutationObserver,
    history: {},
    innerWidth: 1280,
    innerHeight: 800
  };
  global.document = doc;
  global.location = { href: url, pathname: new URL(url).pathname };
  global.KuaishouCoverTime = require(COVER_PATH);
  delete require.cache[require.resolve(CTX_PATH)];
  const ctx = require(CTX_PATH);

  let stop = null;
  try {
    stop = ctx.watch(function (e) { events.push({ id: e.id, opened: e.opened, mode: e.mode }); }, { debounceMs: 60 });
    await sleep(120);
    // 初始会立刻通知一次「现在没有播放态」（opened=false），这是既有设计：
    // 调用方（_onKuaishouImmersiveState）收到就撤按钮，本来也无害。
    // 要钉的是「不许误报打开」。
    eq('[watch] 一开始没弹层 → 不会误报打开',
      events.filter(function (e) { return e.opened; }).length, 0);

    // ① 弹层被插进 DOM
    doc.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));
    await sleep(260);
    eq('[watch] 弹层出现 → 发出 popup|ID', events.length && events[events.length - 1].id, '3xc8n9zzuu9xy3i');
    eq('[watch] mode 是 popup', events.length && events[events.length - 1].mode, 'popup');
    eq('[watch] opened 为真', events.length && events[events.length - 1].opened, true);

    // ② 弹层里切到下一条：active 挪到第二个 slide
    const pop = doc.querySelector('.player-pop');
    const first = pop.querySelector('.swiper-slide-active');
    first.classList.remove('swiper-slide-active');
    first.insertAdjacentHTML('afterend', popSlideHtml({ cover: REAL_POP_COVER_2, nick: '@第二个人', active: true }));
    await sleep(260);
    eq('[watch] 弹层内切条 → 新 ID', events[events.length - 1].id, '3xyme56rx8vimrm');
    eq('[watch] 仍然是 popup 态', events[events.length - 1].mode, 'popup');

    // ③ 弹层整个被移除（用户关掉）
    pop.remove();
    doc.querySelector('.player-pop-mask').remove();
    await sleep(400);
    eq('[watch] 关掉弹层 → 发 closed（opened=false）', events[events.length - 1].opened, false);
    eq('[watch] closed 时 id 为空', events[events.length - 1].id, '');
  } finally {
    try { if (stop) stop(); } catch (e) { /* 忽略 */ }
    global.window = savedWin;
    global.document = savedDoc;
    global.location = savedLoc;
    if (savedCT === undefined) delete global.KuaishouCoverTime;
    else global.KuaishouCoverTime = savedCT;
  }

  // ④ 弹层开着但内容没渲染（没有 active）→ 必须是 pending，一个事件都不发
  {
    const d2 = makeDoc(searchPageHtml(''), url);
    const ev2 = [];
    const sW = global.window, sD = global.document, sL = global.location, sC = global.KuaishouCoverTime;
    global.window = {
      document: d2, location: { href: url }, addEventListener() {}, removeEventListener() {},
      MutationObserver: d2.defaultView.MutationObserver, history: {}, innerWidth: 1280, innerHeight: 800
    };
    global.document = d2;
    global.location = { href: url, pathname: new URL(url).pathname };
    global.KuaishouCoverTime = require(COVER_PATH);
    delete require.cache[require.resolve(CTX_PATH)];
    const c2 = require(CTX_PATH);
    let st = null;
    try {
      st = c2.watch(function (e) { ev2.push(e); }, { debounceMs: 60 });
      await sleep(120);
      const before = ev2.length; // 初始那一条「现在没播放」的通知
      // 弹层在、但里面没有 active
      d2.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: false })));
      await sleep(400);
      eq('[watch] 弹层开着但认不出 → 保持现状，不新增事件', ev2.length, before);
    } finally {
      try { if (st) st(); } catch (e) { /* 忽略 */ }
      global.window = sW; global.document = sD; global.location = sL;
      if (sC === undefined) delete global.KuaishouCoverTime; else global.KuaishouCoverTime = sC;
    }
  }
}

/* ============================ 端到端公用 ============================ */

function kuaishouMediaConfig() {
  const src = fs.readFileSync(path.resolve(ROOT, 'src/background/background.js'), 'utf8');
  const anchor = src.indexOf("'www.kuaishou.com':");
  const tail = src.slice(anchor, anchor + 900);
  const typeM = /type:\s*'([^']+)'/.exec(tail);
  const patM = /patterns:\s*\[([^\]]*)\]/.exec(tail);
  return {
    type: typeM ? typeM[1] : '',
    patterns: patM ? patM[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [],
    noContentFallback: /noContentFallback:\s*true/.test(tail)
  };
}

const FETCH_STUB = `
  window.fetch = function () {
    return Promise.resolve({
      ok: true, status: 200,
      text: function () { return Promise.resolve('<html>{"kwaiId":"xingrenjiepai"}</html>'); }
    });
  };
`;

async function openSearchPage() {
  const H = require('./lib/harness');
  const cfg = kuaishouMediaConfig();
  return H.openPage({
    url: SEARCH_URL,
    html: searchPageHtml(''),
    mediaConfigs: { 'www.kuaishou.com': cfg },
    beforeMainScript: FETCH_STUB
  });
}

/* ============================ 六、端到端 ============================ */

async function section6() {
  section('六、端到端：搜索页 → 弹层开 → 1 个按钮 + 7 字段 → 关弹层 → 0 按钮');

  const H = require('./lib/harness');
  const page = await openSearchPage();
  const w = page.window;
  const d = w.document;

  const inst = await H.waitForInit(page, 8000);
  truthy('[端] 拿得到 content-main 实例', inst);
  eq('[端] 搜索页刚打开时没有按钮（本来就没内容）', d.querySelectorAll('.media-extractor-button').length, 0);
  truthy('[端] 监听已挂上', w.KuaishouImmersiveContext && inst._ksWatch);

  // 用户点开卡片 → 弹层出现
  d.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));

  // 等 watch（debounce 320ms）+ 贴位重试（250/700/1500ms）
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    if (d.querySelector('.media-extractor-button') && inst._ksWorkId) break;
  }
  await sleep(1400); // 等布局稳定再读位置（铁律：按钮一出立刻读 rect 读不准）

  eq('[端] 弹层打开后 1 个按钮', d.querySelectorAll('.media-extractor-button').length, 1);
  const btn = d.querySelector('.media-extractor-button');
  eq('[端] 锚点标记是 kuaishou-popup', btn && btn.getAttribute('data-clipmate-anchor'), 'kuaishou-popup');
  eq('[端] 记下的作品 ID 正确', inst._ksWorkId, '3xc8n9zzuu9xy3i');
  eq('[端] 类型补认成 social', inst.detectMediaType(), 'social');
  truthy('[端] isInitialized 为真', inst.isInitialized);

  // 7 个字段
  const data = await inst.extractFromCurrentPage();
  truthy('[端] 提取到数据', data && typeof data === 'object');
  const v = (k) => String((data && data[k]) || '');
  eq('[端] 作者昵称', v('作者昵称'), '杏仁街拍');
  eq('[端] 作者主页', v('作者主页'), 'https://www.kuaishou.com/profile/3xjwwbgbieafb99');
  eq('[端] 发布日期（到秒）', v('发布日期'), '2026/03/15 18:16:57');
  // v2.6.1：文案出口去掉话题井号（用户 2026-10-29 要求）
  eq('[端] 本页文案', v('本页文案'), '瑜伽裤 完美好身材');
  eq('[端] URL 是规范作品地址', v('URL'), 'https://www.kuaishou.com/short-video/3xc8n9zzuu9xy3i');
  truthy('[端] 作者ID 有值（走抓主页那套，桩已给）', v('作者ID'), v('作者ID'));
  truthy('[端] 本页标题有值', v('本页标题'), v('本页标题').slice(0, 40));

  // 关掉弹层 → 按钮撤干净、浮窗关
  const pop = d.querySelector('.player-pop');
  try { await inst.handleExtract(); } catch (e) { /* 浮窗开不开都不影响下面 */ }
  await sleep(200);
  const hadWin = !!(inst.modalManager && inst.modalManager.isOpen);
  pop.remove();
  d.querySelector('.player-pop-mask').remove();
  for (let i = 0; i < 30; i++) {
    await sleep(120);
    if (d.querySelectorAll('.media-extractor-button').length === 0) break;
  }
  eq('[端] 关掉弹层后按钮 0 个', d.querySelectorAll('.media-extractor-button').length, 0);
  eq('[端] 记下的作品 ID 已清空', inst._ksWorkId, '');
  if (hadWin) truthy('[端] 浮窗一并关掉', !inst.modalManager.isOpen);

  // 再开一次：仍是 1 个（不许叠加）
  d.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    if (d.querySelector('.media-extractor-button')) break;
  }
  await sleep(600);
  eq('[端] 再打开仍是 1 个按钮（不叠加）', d.querySelectorAll('.media-extractor-button').length, 1);

  w.close();
}

/* ============================ 七、转详情页 ============================ */

async function section7() {
  section('七、弹层里点「查看详情」转详情页：按钮交给 route，两边不许打架');

  const H = require('./lib/harness');
  const page = await openSearchPage();
  const w = page.window;
  const d = w.document;

  const inst = await H.waitForInit(page, 8000);
  d.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    if (d.querySelector('.media-extractor-button')) break;
  }
  await sleep(1200);
  eq('[转] 弹层态先出了按钮', d.querySelectorAll('.media-extractor-button').length, 1);

  // 用户点弹层里的「查看详情」：地址变详情页 + 弹层被移除 + 详情内容渲染出来
  w.history.pushState({}, '', '/short-video/3xc8n9zzuu9xy3i?authorId=3xjwwbgbieafb99');
  const pop = d.querySelector('.player-pop');
  pop.remove();
  d.querySelector('.player-pop-mask').remove();
  // 详情内容就位（真机 600ms 左右）
  d.body.insertAdjacentHTML('beforeend',
    '<video></video><div class="video-info-title">#瑜伽裤 #完美好身材</div><div class="video-info-text">'
    + '这条作品的详情区正文，用来满足「有 video 且有正文」的就绪判据。'.repeat(6) + '</div>');

  // route 的轮询是 400ms，等它接管完
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    if (inst._ksRouteActive && d.querySelector('.media-extractor-button')) break;
  }
  await sleep(1200);

  truthy('[转] 详情页接管成功（_ksRouteActive）', inst._ksRouteActive);
  eq('[转] 详情页仍是 1 个按钮（没被播放态那边撤掉，也没叠加）',
    d.querySelectorAll('.media-extractor-button').length, 1);
  eq('[转] 按钮锚点标记换回 none（详情页不是贴边锚点）',
    (d.querySelector('.media-extractor-button') || {}).getAttribute
      ? (d.querySelector('.media-extractor-button').getAttribute('data-clipmate-anchor') || 'none') : 'none',
    'none');
  falsy('[转] 播放态的 _ksWorkId 已清空（不抢）', inst._ksWorkId);

  w.close();
}

/* ============================ 八、入口门禁与互斥 ============================ */

function section8() {
  section('八、入口门禁与互斥：搜索页两条监听都挂，/new-reco 只挂播放态那条');

  const spa = fs.readFileSync(SPA_PATH, 'utf8');

  // 搜索页必须补挂 route（否则「查看详情」后详情页没按钮）
  truthy('[门] spa-handler 里补挂了 route 监听',
    /_startKuaishouRouteWatcher/.test(spa) && spa.indexOf('查看详情') >= 0);
  // 入口判定用 shouldWatch（不是只有 isImmersivePage）
  truthy('[门] 入口判定改成了 shouldWatch',
    /shouldWatch/.test(spa) && /typeof\s+ctx\.shouldWatch\s*===\s*'function'/.test(spa));
  // 留了退路：拿不到 shouldWatch 就退回老判定
  truthy('[门] 拿不到 shouldWatch 时退回 isImmersivePage',
    /:\s*ctx\.isImmersivePage\(\)/.test(spa));

  const route = fs.readFileSync(ROUTE_PATH, 'utf8');
  truthy('[门] route 仍然「推荐流不抢」', /ctx\.isImmersivePage\s*\(\)\)\s*return false/.test(route));

  // 交接门禁：地址已是详情页时，播放态那边不许撤按钮
  truthy('[门] 播放态撤离时检查「是否已交棒给详情页」', /handover/.test(spa));
  truthy('[门] 交棒判断用的是 route 的详情页判定',
    /_ksRouteIsDetail\(location\.pathname\)/.test(spa));
  const iHand = spa.indexOf('if (handover) {');
  truthy('[门] 找到交棒分支', iHand > 0);
  if (iHand > 0) {
    // 只取到分支内第一个 return 为止，避免误把分支外面的 _hideKuaishouButton 算进来
    const seg = spa.slice(iHand, iHand + 800);
    const iEnd = seg.indexOf('return;');
    const body = iEnd > 0 ? seg.slice(0, iEnd) : seg;
    falsy('[门] 交棒分支里不撤按钮', /_hideKuaishouButton/.test(body));
    truthy('[门] 交棒分支里解绑锚点', /_unbindKuaishouAnchor/.test(body));
    truthy('[门] 交棒分支里把按钮位置还原成默认', /_ksResetButtonPosition/.test(body));
  }

  // content-main 的接线没被破坏
  const main = fs.readFileSync(MAIN_PATH, 'utf8');
  truthy('[门] init 里仍在「类型为空」分支调用播放态接管',
    /_startKuaishouImmersiveWatcher/.test(main));
  truthy('[门] 站内跳转接管仍挂在原处', /_startKuaishouRouteWatcher/.test(main));
}

/* ============================ 九、类型补认 + 工厂 ============================ */

async function section9() {
  section('九、类型补认 + 工厂岔路口：弹层态也要走沉浸流提取器');

  const H = require('./lib/harness');
  const page = await openSearchPage();
  const w = page.window;
  const d = w.document;

  const inst = await H.waitForInit(page, 8000);

  // 还没认出来之前，不许补认（否则 init 会走全流程、监听挂不上）
  eq('[补] 弹层还没开时 detectMediaType 为空', inst.detectMediaType(), null);

  d.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));
  for (let i = 0; i < 40; i++) {
    await sleep(120);
    if (inst._ksWorkId) break;
  }
  eq('[补] 接管后补认成 social', inst.detectMediaType(), 'social');

  // 工厂岔路口：得选出 KuaishouImmersiveExtractor（不是父类）
  const F = w.ExtractorFactory;
  truthy('[补] 工厂类可用', F);
  if (F) {
    const f = new F();
    const cls = f._pickKuaishouImmersiveClass('www.kuaishou.com', 'social');
    eq('[补] 岔路口选中沉浸流提取器', cls && cls.name, 'KuaishouImmersiveExtractor');
  }

  // 提取器本身认得这是 popup 态
  if (inst.extractor) {
    const c = w.KuaishouImmersiveContext.immersiveContext();
    eq('[补] 提取器上下文是 popup', c && c.mode, 'popup');
  }

  w.close();
}

/* ============================ 十、回归：推荐流不变 ============================ */

async function section10() {
  section('十、回归：推荐流行为完全不变（两套态互不干扰）');

  const H = require('./lib/harness');
  const cfg = kuaishouMediaConfig();
  const RECO = 'https://www.kuaishou.com/new-reco';

  const page = await H.openPage({
    url: RECO,
    html: `<!doctype html><html><head><title>推荐 - 快手</title></head><body>
<div class="swiper swiper-feed"><div class="swiper-wrapper">
  ${popSlideHtml({ active: true })}
</div></div>
</body></html>`,
    mediaConfigs: { 'www.kuaishou.com': cfg },
    beforeMainScript: FETCH_STUB
  });
  const w = page.window;
  const d = w.document;
  const inst = await H.waitForInit(page, 8000);
  await sleep(1500);

  eq('[归] 推荐流仍是 1 个按钮', d.querySelectorAll('.media-extractor-button').length, 1);
  const btn = d.querySelector('.media-extractor-button');
  eq('[归] 锚点标记仍是 kuaishou-immersive', btn && btn.getAttribute('data-clipmate-anchor'), 'kuaishou-immersive');
  eq('[归] 作品 ID 正确', inst._ksWorkId, '3xc8n9zzuu9xy3i');

  const c = w.KuaishouImmersiveContext.immersiveContext();
  eq('[归] 推荐流上下文 mode 仍是 immersive', c && c.mode, 'immersive');

  const data = await inst.extractFromCurrentPage();
  eq('[归] 日期仍到秒', String(data['发布日期'] || ''), '2026/03/15 18:16:57');
  eq('[归] 昵称不变', String(data['作者昵称'] || ''), '杏仁街拍');
  eq('[归] URL 不变', String(data['URL'] || ''), 'https://www.kuaishou.com/short-video/3xc8n9zzuu9xy3i');
  // v2.6.1：同上，井号被清掉
  eq('[归] mode=caption caption', String(data['本页文案'] || ''), '瑜伽裤 完美好身材');

  w.close();
}

/* ================================ 主流程 ================================ */

(async () => {
  console.log(`${C.cyan}快手「搜索页弹层」接管验收（v2.5.88）${C.reset}`);

  section1();
  section2();
  section3();
  section4();
  await section5();
  await section6();
  await section7();
  section8();
  await section9();
  await section10();

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项（通过 ${pass} 项）${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name} — ${f.detail || ''}`));
  process.exit(1);
})();
