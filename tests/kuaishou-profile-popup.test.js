#!/usr/bin/env node
/**
 * 快手「作者主页弹层」接管验收（v2.7.0）
 *
 * 要钉住的事：**作者主页 `/profile/*` 点开卡片盖上 `.player-pop` 之后，按钮要出现、
 * 7 个字段要正确、关掉弹层按钮要撤干净。**
 *
 * 真机证据（2026-10-29 21:45，借用户 Edge，`/profile/3xjspr8kqrpynxg?source=SEARCH`）：
 *   | 时刻        | 地址                        | 文档导航次数 | 弹层 | 按钮 |
 *   | 打开主页    | /profile/3xjspr8kqrpynxg    | 1            | 0    | 0（历史缺口）|
 *   | 点开卡片    | **一个字没变**              | 1            | 1    | **0 ❌** |
 *   弹层结构与搜索页**完全同构**：
 *     `.player-pop` → `.swiper-slide-active`（恰好 1 个，1398×698）
 *     → `a.name`（`/profile/<id>` 链接）+ `.caption`
 *   弹层里**没有任何 `/short-video/` 链接**，也没有 Vue/React 实例钩子
 *   （`__vueParentComponent` / `__vnode` / `__vue__` 全是 undefined）→ 只能从 DOM 抠。
 *
 * 本批最关键的实况：**主页弹层的封面地址有时带 `clientCacheKey`、有时不带**
 *   - 带：`...jpg?tag=1-...&clientCacheKey=3xe456wj9c4ei86.jpg`
 *   - 不带：`...jpg?tag=1-...`
 * 而不带的那一份文件名是 **base64 编码的发布时间**（`BMjAyNjEwMjMxODQ1Mzdf...jpg`），
 * 按 `_` 切第一段有可能落在 8~25 位、被当成作品 ID —— 那是**假数据**（会拼出打不开的地址）。
 * 同一 slide 里的 `<video>` 地址**一定带** `clientCacheKey`
 * （`...mp4?tag=1-...&clientCacheKey=3xe456wj9c4ei86_b.mp4`，`_b` 是清晰度后缀），
 * 所以 ID 改成「强证据优先」：封面强 → 视频强 → 封面弱 → 视频弱 → 站内链接。
 *
 * 本脚本七节：
 *   一、页面判定：/profile/* 认、前缀边界、别的站不认、原来不认的仍不认
 *   二、主页弹层识别：5 个字段 + mode=popup
 *   三、作品 ID 优先级：强证据压弱证据、base64 时间碎片不许冒充 ID
 *   四、日期：封面解不出时用视频地址的 /upic/，封面能解时到秒
 *   五、作用域隔离：主页里列表页自己的 slide 不许被认
 *   六、watch 状态机：出现 / 关掉
 *   七、接线与结构：日志口径、manifest、options 开关、api 导出
 *
 * 用法：
 *   node tests/kuaishou-profile-popup.test.js
 *   node tests/kuaishou-profile-popup.test.js --verbose
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
const NOAUTO_PATH = path.join(ROOT, 'src/content/kuaishou-no-autoplay.js');
const FLAG_PATH = path.join(ROOT, 'src/content/kuaishou-no-autoplay-flag.js');
const OPTIONS_HTML = path.join(ROOT, 'src/options/options.html');
const OPTIONS_JS = path.join(ROOT, 'src/options/options.js');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

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

/* ======================== 真机抓到的原样数据 ======================== */

const PROFILE_URL = 'https://www.kuaishou.com/profile/3xjspr8kqrpynxg';

/**
 * 主页弹层里「封面不带 clientCacheKey」的那一份（真机原样）。
 * 文件名 `BMjAyNjEwMjMxODQ1Mzdf...` 是 base64，解出来是 `20261023184537_4834868935_...`。
 */
const COVER_NO_KEY =
  'https://p23.a.yximgs.com/upic/2026/10/23/18/'
  + 'BMjAyNjEwMjMxODQ1MzdfNDgzNDg2ODkzNV8xOTA0NDExNDk2MzhfMF8z_B418cd316aab009f5736d909fcab106da.jpg'
  + '?tag=1-1793280816-xpcw';

/** 同一个 slide 的播放地址（一定带 clientCacheKey，`_b` 是清晰度后缀） */
const VIDEO_SRC =
  'https://v2-1.a.yximgs.com/upic/2026/10/23/18/'
  + 'BMjAyNjEwMjMxODQ1MzdfNDgzNDg2ODkzNV8xOTA0NDExNDk2MzhfMF8z.mp4'
  + '?tag=1-1793280816-xpcw&clientCacheKey=3xe456wj9c4ei86_b.mp4&di=JA4DkZ&bp=10004';

/**
 * 只有 base64 时间戳、没有哈希尾巴的封面（危险形状）。
 * 文件名整个就是 base64（21 位，解出 `20261023184537_...`），
 * 走「通用 `.jpg` 兜底」会被当成 21 位作品 ID —— 那会拼出打不开的地址。
 */
const COVER_B64_BARE =
  'https://p1.a.yximgs.com/upic/2026/10/23/18/BMjAyNjEwMjMxODQ1Mzdf.jpg';

/** 封面带 clientCacheKey 的那一份（另一条样本） */
const COVER_WITH_KEY =
  'https://p2.a.yximgs.com/upic/2026/06/28/08/'
  + 'BMjAyNjA2MjgwODA4NDRfMjcwNTI2NzE1Nl8yMDAyOTQ0NTk1OThfMl8z_B9bcbfac.jpg'
  + '?clientCacheKey=3xyme56rx8vimrm.jpg&bp=10004';

/* ======================== 页面模板 ======================== */

/** 主页本体（弹层关着时真机就是这样：卡片网格，没有 .player-pop） */
function profilePageHtml(listSlides) {
  return `<!doctype html><html><head><title>黑蛇的主页 - 快手</title></head><body>
<div class="workbench profile-view">
  <div class="profile-header"><a class="name" href="/profile/3xjspr8kqrpynxg">@黑蛇</a></div>
  <div class="feeds-container">
    <div class="photo-card"><img src="${COVER_NO_KEY}"></div>
    <div class="photo-card"><img src="${COVER_WITH_KEY}"></div>
  </div>
  ${listSlides || ''}
</div>
</body></html>`;
}

/** 一条弹层内 slide（结构照真机抄；`noCover` / `noVideo` 用来造缺件场景） */
function popSlideHtml(opt) {
  const o = opt || {};
  const cls = 'swiper-slide' + (o.active ? ' swiper-slide-active' : '');
  const cover = o.cover === undefined ? COVER_NO_KEY : o.cover;
  const videoSrc = o.video === undefined ? VIDEO_SRC : o.video;
  const nick = o.nick || '@黑蛇';
  const profile = o.profile || 'https://www.kuaishou.com/profile/3xjspr8kqrpynxg';
  const caption = o.caption === undefined
    ? '今天带你们看看 <a class="tag" href="/search?tag=1">#万万没想到</a> <a class="tag" href="/search?tag=2">#沙发</a>'
    : o.caption;
  const nameEl = o.noName ? '' :
    `<a class="name" href="${profile}">${nick}</a><span class="timestamp">· 3 小时前</span>`;
  return `
  <div class="${cls}" data-v-d1a10ccb="" style="height:701px;">
    <div class="video-sidebar-layout">
      ${o.noCover ? '' : `<img class="background" src="${cover}">`}
      <div class="main-area">
        <div class="video-container"><div class="kplayer-wrap VideoPlayer">
          <video${videoSrc ? ` src="${videoSrc}"` : ''}></video>
        </div></div>
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

function popLayerHtml(slides) {
  return `
<div class="player-pop-mask" data-v-bb88b204=""></div>
<div class="player-pop" data-v-bb88b204="">
  <div class="swiper swiper-feed swiper-initialized swiper-vertical swiper-autoheight">
    <div class="swiper-wrapper">${slides}</div>
  </div>
</div>`;
}

/* ======================== 装载工具 ======================== */

function makeDoc(html, url) {
  const { JSDOM } = require('jsdom');
  return new JSDOM(html, { url }).window.document;
}

/**
 * 用同一个 window/document 装载 context（和 kuaishou-popup.test.js 同一套做法）。
 * MutationObserver 必须从 jsdom 的 window 借，否则 node 里没有。
 */
function withContext(doc, url, fn) {
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
    innerWidth: 1440,
    innerHeight: 900
  };
  global.document = doc;
  global.location = { href: url, pathname: new URL(url).pathname };
  global.KuaishouCoverTime = require(COVER_PATH);
  delete require.cache[require.resolve(CTX_PATH)];
  try {
    return fn(require(CTX_PATH));
  } finally {
    global.window = savedWin;
    global.document = savedDoc;
    global.location = savedLoc;
    if (savedCT === undefined) delete global.KuaishouCoverTime;
    else global.KuaishouCoverTime = savedCT;
  }
}

/* ======================== 一、页面判定 ======================== */

function section1() {
  section('一、页面判定：/profile/* 认，前缀要有边界，别的站不认');

  const Ctx = require(CTX_PATH);

  eq('[判] /profile/3x… → 会挂监听', Ctx.isPopupPage(PROFILE_URL + '?source=SEARCH'), true);
  eq('[判] /profile（裸） → 会挂监听', Ctx.isPopupPage('https://www.kuaishou.com/profile'), true);
  eq('[判] /profile/3x…/video 子路径 → 会挂监听',
    Ctx.isPopupPage('https://www.kuaishou.com/profile/3xjspr8kqrpynxg/video'), true);
  eq('[判] /profilexxx → 不认（前缀要有边界）',
    Ctx.isPopupPage('https://www.kuaishou.com/profilexxx'), false);
  eq('[判] 别的域名 /profile/… → 不认',
    Ctx.isPopupPage('https://www.douyin.com/profile/3xjspr8kqrpynxg'), false);

  // 原来就不认的，放行 /profile 之后仍然不认（别顺手放宽）
  eq('[判] /myFollow 关注页 → 仍不认', Ctx.isPopupPage('https://www.kuaishou.com/myFollow'), false);
  eq('[判] /samecity 同城页 → 仍不认', Ctx.isPopupPage('https://www.kuaishou.com/samecity'), false);
  eq('[判] 发现页 / → 仍不认', Ctx.isPopupPage('https://www.kuaishou.com/'), false);
  eq('[判] /short-video/xxx 详情页 → 仍不认',
    Ctx.isPopupPage('https://www.kuaishou.com/short-video/3xabc'), false);
  eq('[判] /new-reco 推荐流 → 不算弹层页',
    Ctx.isPopupPage('https://www.kuaishou.com/new-reco'), false);
  eq('[判] /search/video → 仍然会挂（老能力没丢）',
    Ctx.isPopupPage('https://www.kuaishou.com/search/video?searchKey=x'), true);

  eq('[判] 白名单是数组且含 /search 与 /profile',
    JSON.stringify(Ctx.POPUP_PATH_PREFIXES), JSON.stringify(['/search', '/profile']));

  eq('[门] shouldWatch 在 /profile 上为真', Ctx.shouldWatch(PROFILE_URL), true);
}

/* ======================== 二、主页弹层识别 ======================== */

function section2() {
  section('二、主页弹层识别：封面不带 clientCacheKey 也要认得出（靠视频地址）');

  const url = PROFILE_URL + '?source=SEARCH';
  const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({ active: true }))), url);

  withContext(doc, url, (ctx) => {
    const c = ctx.immersiveContext(doc);
    truthy('[识] 认出了当前这一条', !!c);
    if (!c) return;

    eq('[识] 作品 ID 从视频地址拿到', c.id, '3xe456wj9c4ei86');
    eq('[识] mode 是 popup', c.mode, 'popup');
    eq('[识] 昵称去掉 @', c.nickname, '黑蛇');
    eq('[识] 作者主页是完整地址', c.homepage, 'https://www.kuaishou.com/profile/3xjspr8kqrpynxg');
    eq('[识] 日期取封面 base64（到秒）', c.date, '2026/10/23 18:45:37');
    eq('[识] 文案里话题之间有空格（与详情页同口径）',
      c.caption, '今天带你们看看 #万万没想到 #沙发');
  });

  // 反向：封面整个没有时也要能认（视频才是主来源）
  const doc2 = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({ active: true, noCover: true }))), url);
  withContext(doc2, url, (ctx) => {
    const c = ctx.immersiveContext(doc2);
    eq('[识] 连封面都没有时仍靠视频认出', c && c.id, '3xe456wj9c4ei86');
  });
}

/* ======================== 三、作品 ID 优先级 ======================== */

function section3() {
  section('三、作品 ID 优先级：强证据压弱证据，base64 时间碎片不许冒充 ID');

  const url = PROFILE_URL;
  const api = require(CTX_PATH);

  // 浏览器里 KuaishouCoverTime 是全局（manifest 里排在 context 之前），
  // node 里必须手动挂到 global 上，否则 context 里那两处 `typeof KuaishouCoverTime`
  // 会静默跳过 —— 之前就这么漏掉一次（断言绿得毫无意义）。
  const savedCT = global.KuaishouCoverTime;
  global.KuaishouCoverTime = require(COVER_PATH);
  try {
    runIdCases(url, api);
  } finally {
    if (savedCT === undefined) delete global.KuaishouCoverTime;
    else global.KuaishouCoverTime = savedCT;
  }
}

function runIdCases(url, api) {
  eq('[ID] 视频地址里 clientCacheKey 的 `_b` 要剥掉',
    api.idFromVideoSrc(VIDEO_SRC), '3xe456wj9c4ei86');
  eq('[ID] 老的 Key= 形态也认（mp4）',
    api.idFromVideoSrc('https://v1.a.yximgs.com/x.mp4?Key=3xs9ezatr424bpa_b.mp4'), '3xs9ezatr424bpa');
  eq('[ID] 无关地址返回空', api.idFromVideoSrc('https://v1.a.yximgs.com/x.m3u8'), '');

  // ① 封面带 clientCacheKey → 用封面（与 v2.5.82 一致）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({
      active: true, cover: COVER_WITH_KEY
    }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[ID] 封面有 clientCacheKey 时用封面', c && c.id, '3xyme56rx8vimrm');
    });
  }

  // ② 封面的「弱证据」会抠出 base64 碎片，但视频有强证据 → 必须用视频
  {
    const junkCover =
      'https://p1.a.yximgs.com/bfs/BMjAyNjEwMjMx_NDgzNDg2ODkzNV8.jpg?tag=1-1793280816-xpcw';
    // 先确认这确实是个会误伤的形状：按 `_` 切第一段是 14 位纯字母数字
    eq('[ID] 构造的假封面确实会被弱兜底抠出碎片',
      api.idFromCoverSrc(junkCover), 'BMjAyNjEwMjMx');

    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({
      active: true, cover: junkCover
    }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[ID] 视频强证据压过封面碎片（不许拿 base64 当作品 ID）',
        c && c.id, '3xe456wj9c4ei86');
    });
  }

  // ③ 封面是 base64 时间戳且没有视频 → 宁可认不出，也不拼假地址
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({
      active: true, cover: COVER_B64_BARE, video: ''
    }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[ID] 只有 base64 时间戳封面 → 认不出（宁空不错）', c, null);
    });
    eq('[ID] 时间戳文件名不参与弱兜底（否则会抠出 21 位 base64 当 ID）',
      api.idFromCoverSrc(COVER_B64_BARE), '');
  }

  // ④ 封面是「真 ID 文件名」（不是 base64 时间戳）→ 弱兜底照旧认
  {
    const plainCover = 'https://p1.a.yximgs.com/upic/2026/10/15/3xs9ezatr424bpa.jpg';
    eq('[ID] 文件名就是作品 ID 的封面照旧认',
      api.idFromCoverSrc(plainCover), '3xs9ezatr424bpa');
  }

  // ⑤ 只有站内链接时用链接（老兜底还在）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(`
      <div class="swiper-slide swiper-slide-active">
        <a href="/short-video/3xs9ezatr424bpa">
          <div class="caption">只有链接</div>
        </a>
      </div>`)), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[ID] 只剩站内链接时也能认', c && c.id, '3xs9ezatr424bpa');
    });
  }
}

/* ======================== 四、日期 ======================== */

function section4() {
  section('四、日期：封面解不出时用视频地址的 /upic/，能解时到秒');

  const url = PROFILE_URL;

  // 封面完全没有日期信息 → 落到视频
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({
      active: true,
      cover: 'https://p1.a.yximgs.com/bfs/feed.jpg?tag=1',
      video: 'https://v1.a.yximgs.com/upic/2026/10/23/18/video.mp4?clientCacheKey=3xe456wj9c4ei86.mp4'
    }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[日] 封面没有日期时用视频地址的 /upic/', c && c.date, '2026/10/23');
    });
  }

  // 封面能解 → 到秒（不许退化成日）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({ active: true }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[日] 封面能解出秒级时间时到秒', c && c.date, '2026/10/23 18:45:37');
    });
  }

  // 两边都没有 → 空串（不许编）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({
      active: true,
      cover: 'https://p1.a.yximgs.com/bfs/feed.jpg',
      video: 'https://v1.a.yximgs.com/bfs/x.mp4?clientCacheKey=3xe456wj9c4ei86.mp4'
    }))), url);
    withContext(doc, url, (ctx) => {
      const c = ctx.immersiveContext(doc);
      eq('[日] 两边都没日期 → 空串（不编）', c && c.date, '');
    });
  }
}

/* ======================== 五、作用域隔离 ======================== */

function section5() {
  section('五、作用域隔离：主页里列表页自己的 slide 不许被认');

  const url = PROFILE_URL;

  // 主页本身没有 .player-pop，但页面上有 .swiper-slide-active（真机就有）→ 不许出按钮
  {
    const doc = makeDoc(profilePageHtml(popSlideHtml({ active: true })), url);
    withContext(doc, url, (ctx) => {
      eq('[域] 没有 .player-pop 时，页面上的 active slide 不算播放态',
        ctx.immersiveContext(doc), null);
    });
  }

  // 弹层开着但这一帧没渲染出 active → null（不能退回去认列表页的 slide）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(popSlideHtml({ active: false }))), url);
    withContext(doc, url, (ctx) => {
      eq('[域] 弹层在但没认出当前条 → null（不拿列表页顶包）',
        ctx.immersiveContext(doc), null);
    });
  }

  // 弹层里两条都像「当前」→ 认不出（宁空不错）
  {
    const doc = makeDoc(profilePageHtml(popLayerHtml(
      popSlideHtml({ active: true }) + popSlideHtml({ active: true, cover: COVER_WITH_KEY })
    )), url);
    withContext(doc, url, (ctx) => {
      eq('[域] 两条都像当前 → 认不出', ctx.immersiveContext(doc), null);
    });
  }
}

/* ======================== 六、watch 状态机 ======================== */

async function section6() {
  section('六、watch 状态机：弹层出现 → 认得出，关掉 → closed');

  const url = PROFILE_URL;
  const doc = makeDoc(profilePageHtml(''), url);
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
    innerWidth: 1440,
    innerHeight: 900
  };
  global.document = doc;
  global.location = { href: url, pathname: new URL(url).pathname };
  global.KuaishouCoverTime = require(COVER_PATH);
  delete require.cache[require.resolve(CTX_PATH)];
  const ctx = require(CTX_PATH);

  let stop = null;
  try {
    stop = ctx.watch((e) => events.push({ id: e.id, opened: e.opened, mode: e.mode }), { debounceMs: 60 });
    await sleep(140);
    eq('[watch] 一开始没弹层 → 不误报打开',
      events.filter((e) => e.opened).length, 0);

    doc.body.insertAdjacentHTML('beforeend', popLayerHtml(popSlideHtml({ active: true })));
    await sleep(280);
    const last = events[events.length - 1] || {};
    eq('[watch] 弹层出现 → popup|<ID>', last.id, '3xe456wj9c4ei86');
    eq('[watch] mode=popup', last.mode, 'popup');
    eq('[watch] opened=true', last.opened, true);

    doc.querySelector('.player-pop').remove();
    doc.querySelector('.player-pop-mask').remove();
    await sleep(420);
    const end = events[events.length - 1] || {};
    eq('[watch] 关掉弹层 → closed', end.opened, false);
    eq('[watch] closed 时 id 为空', end.id, '');
  } finally {
    try { if (stop) stop(); } catch (e) { /* 忽略 */ }
    global.window = savedWin;
    global.document = savedDoc;
    global.location = savedLoc;
    if (savedCT === undefined) delete global.KuaishouCoverTime;
    else global.KuaishouCoverTime = savedCT;
  }
}

/* ======================== 七、接线与结构 ======================== */

function section7() {
  section('七、接线与结构：日志口径 / manifest / 开关 / api 导出');

  const SPA = fs.readFileSync(SPA_PATH, 'utf8');
  const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const OPT_JS = fs.readFileSync(OPTIONS_JS, 'utf8');
  const FLAGS_JS = fs.readFileSync(path.join(ROOT, 'src/shared/feature-flags.js'), 'utf8');
  const CTX_SRC = fs.readFileSync(CTX_PATH, 'utf8');

  truthy('[接] 启动日志写明 /profile/* 也在白名单里',
    SPA.indexOf("'页内播放态监听已启动（模式白名单：/new-reco 与 /search/*、/profile/*）'") > -1);
  truthy('[接] 撤按钮时的日志不再写死「搜索页弹层」',
    SPA.indexOf("(wasMode === 'popup' ? '播放弹层' : '推荐流')") > -1);
  truthy('[接] spa-handler 顶部注释说明两处弹层同构',
    SPA.indexOf('/profile/*') > -1 && SPA.indexOf('页内播放弹层') > -1);

  eq('[构] 版本号已升到 2.9.3', MANIFEST.version, '2.9.3');

  // 关连播：必须是一个独立的 MAIN world 块，document_start
  const blocks = MANIFEST.content_scripts || [];
  const noAutoBlock = blocks.filter((b) => (b.js || []).indexOf('src/content/kuaishou-no-autoplay.js') > -1);
  eq('[构] 关连播脚本单独一个注入块', noAutoBlock.length, 1);
  if (noAutoBlock.length === 1) {
    const b = noAutoBlock[0];
    eq('[构] 注入世界是 MAIN（隔离世界拦不住页面自己的监听）', b.world, 'MAIN');
    eq('[构] 注入时机是 document_start（抢在快手注册监听之前）', b.run_at, 'document_start');
    eq('[构] 只注入快手', JSON.stringify(b.matches), JSON.stringify(['https://www.kuaishou.com/*']));
    eq('[构] 不动 iframe', b.all_frames, false);
  }

  // 开关桥：必须在主内容脚本里、且在 content-main 之前
  const mainJs = (blocks[0] || {}).js || [];
  const iFlag = mainJs.indexOf('src/content/kuaishou-no-autoplay-flag.js');
  const iMain = mainJs.indexOf('src/content/content-main.js');
  truthy('[构] 开关桥进了主内容脚本', iFlag > -1);
  truthy('[构] 开关桥排在 content-main 之前', iFlag > -1 && iMain > -1 && iFlag < iMain);
  truthy('[构] 两个脚本文件都真实存在',
    fs.existsSync(NOAUTO_PATH) && fs.existsSync(FLAG_PATH));

  // 设置页开关（v2.8.0：开关从 options.html 的独立复选框收编成
  // 「站点专属功能」注册表里的一条，显示在快手的站点卡片里）
  truthy('[开] feature-flags 注册了「关闭自动连播」',
    /key:\s*'kuaishouNoAutoplay'[\s\S]{0,400}?legacyKey:\s*'kuaishouNoAutoplayEnabled'/.test(FLAGS_JS));
  truthy('[开] 该功能缺省 = 开（defaultEnabled 不是 false）',
    /key:\s*'kuaishouNoAutoplay'[\s\S]{0,400}?defaultEnabled:\s*true/.test(FLAGS_JS));
  truthy('[开] options.js 会把这个值双写回旧键（内容脚本读的是旧键）',
    OPT_JS.indexOf('extras[feature.legacyKey] = !!enabled') > -1);
  truthy('[开] 文案与「出不出按钮」的开关区分开（写的是只改播完怎么办）',
    /key:\s*'kuaishouNoAutoplay'[\s\S]{0,400}?只改「播完怎么办」/.test(FLAGS_JS));

  // api 导出
  truthy('[接] 导出 idFromVideoSrc', CTX_SRC.indexOf('idFromVideoSrc: idFromVideoSrc') > -1);
  truthy('[接] 导出 POPUP_PATH_PREFIXES', CTX_SRC.indexOf('POPUP_PATH_PREFIXES: POPUP_PATH_PREFIXES') > -1);
  falsy('[接] 不再导出旧的单值 POPUP_PATH_PREFIX（防止两套白名单并行）',
    /^\s*POPUP_PATH_PREFIX:/m.test(CTX_SRC));
}

/* ======================== 主流程 ======================== */

(async function main() {
  console.log('快手「作者主页弹层」接管验收（v2.7.0）\n');
  section1();
  section2();
  section3();
  section4();
  section5();
  await section6();
  section7();

  console.log('\n' + '─'.repeat(60));
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}❌${C.reset} ${f.name}` + (f.detail ? `  ${C.gray}${f.detail}${C.reset}` : '')));
  process.exit(1);
})();
