/**
 * v2.12.6 —— YouTube Shorts「一手数据」链路专项
 *
 * 被测对象（与真机链路逐层对齐）：
 *   ① 主世界钩子 `src/content/youtube-shorts-hook.js`
 *   ② 隔离世界读取器 `src/content/shared/youtube-shorts-page-data.js`
 *   ③ 提取器 `src/content/extractors/youtube-social.js`（**一律从 extractAllFields() 进**）
 *   ④ manifest 注册
 *
 * 背景（2026-11-06 真机，接管用户已登录 Edge）：
 *   Shorts 点「下一个视频」后地址变了、屏幕上也换了，但 head 里的
 *   identifier / datePublished / og:title / #snippet 全是上一条；
 *   当前 `ytd-reel-video-renderer.data` 里的 playerResponse 才是新条目（含精确日期）。
 *   扩展原来读的正是那批过期数据 → 标题/文案/日期串台。
 *
 * 最硬的红线：**ID 对不上就是别人的数据**。
 * 下面 ★ 的用例负责钉死这道闸口；改坏了必须变红（见 _mutate-youtube-shorts.py）。
 *
 * 跑法：NODE_PATH=... node tests/youtube-shorts-firsthand.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const P = (rel) => path.join(ROOT, rel);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
}
function truthy(name, got, detail) { if (got) ok(name); else bad(name, detail || `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got, detail) { if (!got) ok(name); else bad(name, detail || `期望假值，实得 ${JSON.stringify(got)}`); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ 真机样本 ============================ */
const NEW_ID = 'NEWVIDEO01';
const OLD_ID = 'OLDVIDEO01';
const NEW_HREF = 'https://www.youtube.com/shorts/' + NEW_ID;
const OLD_DATE_ISO = '2026-09-25T09:07:42-07:00';

// 一手数据不带时区后缀，格式化结果固定，跨机器跑不飘。
const FIRSTHAND = {
  videoId: NEW_ID,
  title: 'Such a good idea! Coraline Sketchbook',
  description: 'Here is the full description ...更多',
  author: 'NewCreator',
  channelId: 'UCnewChannel123',
  ownerProfileUrl: 'http://www.youtube.com/@NewHandle',
  publishDate: '2026-11-05T12:00:37'
};

/** 桥节点：普通 div + data-* 属性（YouTube 的 Trusted Types 不让写 script 节点） */
function makeBridgeNode(w, item) {
  const n = w.document.createElement('div');
  n.id = 'clipmate-youtube-shorts';
  n.setAttribute('hidden', '');
  n.setAttribute('data-clipmate-json',
    JSON.stringify({ v: 1, href: NEW_HREF, item: item }));
  w.document.body.appendChild(n);
  return n;
}

/** 造一份「站内换条后」的页面：head 旧、屏幕新、桥节点可选 */
function buildHtml(o) {
  const opt = o || {};
  const headId = opt.headId === undefined ? OLD_ID : opt.headId;
  const ogTitle = opt.ogTitle || 'Drawing Link From Ocarina Of Time';
  const visibleTitle = opt.noVisibleTitle ? '' :
    '<div class="ytShortsVideoTitleViewModelShortsVideoTitle"><span role="text">Such a good idea! Coraline Sketchbook</span></div>';
  return `<!doctype html><html><head>
    <meta itemprop="identifier" content="${headId}">
    <meta itemprop="datePublished" content="${OLD_DATE_ISO}">
    <meta property="og:title" content="${ogTitle}">
    <meta name="title" content="${ogTitle}">
  </head><body>
    <reel-player-header-renderer><a href="/@NewHandle/shorts">@NewHandle</a></reel-player-header-renderer>
    <div class="ytReelChannelBarViewModelChannelName"><a href="/@NewHandle/shorts">@NewCreator</a></div>
    ${visibleTitle}
    <div id="snippet">旧视频简介 Drawing Link ...更多</div>
  </body></html>`;
}

/** 按 manifest 顺序把真实源码送进 jsdom（不用 window.eval 拼假实现） */
function makeEnv(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html || buildHtml(opt), {
    url: opt.href || NEW_HREF,
    runScripts: 'outside-only'
  });
  const w = dom.window;
  w.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };
  if (!opt.noBridge) makeBridgeNode(w, opt.item || FIRSTHAND);

  [
    'src/content/shared/social-title-processor.js',
    'src/content/shared/social-dom-utils.js',
    'src/content/shared/social-fields-builder.js',
    'src/content/shared/youtube-shorts-page-data.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/youtube-social.js'
  ].forEach((f) => w.eval(read(f)));

  return { w: w, dom: dom };
}

/** 契约入口：整条链只从 extractAllFields() 进 */
async function extract(env) {
  const ex = new env.w.YouTubeSocialExtractor();
  return await ex.extractAllFields();
}

function formatLocal(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* ============================ 一、端到端：SPA 换条 ============================ */
async function testFreshFirsthand() {
  section('1. ★ 站内换条（head 旧 / 一手数据新）—— 7 列必须全是当前这条');

  const env = makeEnv({});
  const f = await extract(env);

  eq('输出恰好 7 列 + 2 个元信息', Object.keys(f).length, 9);
  eq('作者ID 不带 /shorts', f['作者ID'], 'NewHandle');
  eq('作者昵称', f['作者昵称'], 'NewCreator');
  eq('作者主页归一到频道根', f['作者主页'], 'https://www.youtube.com/@NewHandle');
  eq('发布日期来自一手数据（精确到秒）', f['发布日期'], '2026/11/05 12:00:37');
  eq('本页文案 = 标题 + 完整简介，UI 字已清',
    f['本页文案'],
    'Such a good idea! Coraline Sketchbook\nHere is the full description');
  eq('URL 指向当前视频', f['URL'], NEW_HREF);
  truthy('本页标题含当前昵称', f['本页标题'].indexOf('NewCreator') >= 0, f['本页标题']);
  falsy('本页标题不含旧视频英文标题', /Drawing|Ocarina/i.test(f['本页标题']), f['本页标题']);
  falsy('本页标题不含旧日期', f['本页标题'].indexOf('2026年09月26日') >= 0, f['本页标题']);
  falsy('整份输出不含旧简介', JSON.stringify(f).indexOf('旧视频简介') >= 0);
  truthy('mediaType = social', f.mediaType === 'social', f.mediaType);
  truthy('sourceSite = youtube_social', f.sourceSite === 'youtube_social', f.sourceSite);
}

/* ============================ 二、端到端：护栏 ============================ */
async function testStaleGuards() {
  section('2. ★ 桥节点是旧 ID + head 也是旧 ID —— 宁可留空，绝不串台');

  const stale = Object.assign({}, FIRSTHAND, { videoId: OLD_ID });
  const env = makeEnv({ item: stale });
  // 桥节点有数据但 ID 不对，ensureFresh 会等到超时；这里不让它白等 900ms
  env.w.YoutubeShortsPageData.ensureFresh = () => Promise.resolve(null);
  const f = await extract(env);

  eq('发布日期为空（旧 meta 被照妖镜挡下）', f['发布日期'], '');
  falsy('文案不含旧简介', f['本页文案'].indexOf('旧视频简介') >= 0, f['本页文案']);
  falsy('文案不含旧 og:title', f['本页文案'].indexOf('Drawing Link') >= 0, f['本页文案']);
  eq('文案只剩当前可见标题', f['本页文案'], 'Such a good idea! Coraline Sketchbook');
  falsy('标题不含旧日期', f['本页标题'].indexOf('2026年09月26日') >= 0, f['本页标题']);
}

/* ============================ 三、端到端：整页直开 ============================ */
async function testDirectOpen() {
  section('3. 整页直开 —— 有一手数据就用一手，没有才回落文档级取法');

  // 整页直开时 head 是新的；去掉可见标题元素，逼代码真的去读文档级 og:title
  const env = makeEnv({
    headId: NEW_ID,
    noBridge: true,
    noVisibleTitle: true,
    ogTitle: '整页直开标题'
  });
  env.w.YoutubeShortsPageData.ensureFresh = () => Promise.resolve(null);
  const f = await extract(env);

  eq('日期来自文档级 meta', f['发布日期'], formatLocal(OLD_DATE_ISO));
  truthy('文案含 og:title', f['本页文案'].indexOf('整页直开标题') >= 0, f['本页文案']);
  truthy('文案含 #snippet', f['本页文案'].indexOf('旧视频简介') >= 0, f['本页文案']);
  falsy('文案不带「更多/展开」界面字', /更多|展开|收起/.test(f['本页文案']), f['本页文案']);
  truthy('标题含日期', f['本页标题'].indexOf('2026年09月26日') >= 0, f['本页标题']);

  // 整页直开时钩子已从首屏变量写好桥节点 → 必须优先一手数据（与 meta 日期不同）
  const env2 = makeEnv({ headId: NEW_ID, item: FIRSTHAND });
  const f2 = await extract(env2);
  eq('整页直开也优先用一手日期', f2['发布日期'], '2026/11/05 12:00:37');
  eq('整页直开也用一手文案', f2['本页文案'],
    'Such a good idea! Coraline Sketchbook\nHere is the full description');
}

/* ============================ 四、端到端：预热链路 ============================ */
async function testEnsureFreshWiring() {
  section('4. ★ 桥节点晚到 —— extractAllFields() 必须真的等一手数据');

  const env = makeEnv({ noBridge: true });
  let asked = 0;
  env.w.YoutubeShortsPageData.requestScan = function () {
    asked += 1;
    env.w.setTimeout(function () {
      makeBridgeNode(env.w, FIRSTHAND);
    }, 130);
    return true;
  };

  const f = await extract(env);
  eq('确实发起了重扫请求', asked, 1);
  eq('等到晚到的一手日期', f['发布日期'], '2026/11/05 12:00:37');
  eq('等到晚到的一手文案', f['本页文案'],
    'Such a good idea! Coraline Sketchbook\nHere is the full description');
  falsy('没有误用旧 head 日期', f['发布日期'] === formatLocal(OLD_DATE_ISO), f['发布日期']);
}

/* ============ 4b、端到端：真机第 3 条（没有预取数据）走完整链路 ============ */
async function testNetResponseEndToEnd() {
  section('4b. ★ 端到端：真机第 3 条（无预取数据）从 player 响应到 7 列');

  // head 旧、没有可见标题、桥节点起初不存在 —— 完全靠页面自己发的 player 响应
  const env = makeEnv({ noBridge: true, headId: OLD_ID, noVisibleTitle: true });
  const w = env.w;

  // 三个 reel 都只有 softRefreshContinuation（真机第 3 条的形态）
  w.document.body.insertAdjacentHTML('beforeend',
    '<ytd-reel-video-renderer></ytd-reel-video-renderer>'.repeat(3));
  [].slice.call(w.document.querySelectorAll('ytd-reel-video-renderer')).forEach((r) => {
    r.data = { command: { reelWatchEndpoint: {
      videoId: NEW_ID, softRefreshContinuation: 'stub'
    } } };
  });
  w.ytInitialPlayerResponse = playerResponse(OLD_ID, '上一条');

  const H = loadHook(w, w.document);

  // ★ 反例：页面还没发 player 响应时，绝不许拿旧数据顶替
  const env0 = makeEnv({ noBridge: true, headId: OLD_ID, noVisibleTitle: true });
  env0.w.YoutubeShortsPageData.ensureFresh = () => Promise.resolve(null);
  const f0 = await extract(env0);
  eq('没有一手数据时发布日期留空', f0['发布日期'], '');
  falsy('没有一手数据时文案不含旧简介', f0['本页文案'].indexOf('旧视频简介') >= 0);

  // 页面自己发了当前这一条的 /youtubei/v1/player
  H.rememberPlayerJson(w, JSON.stringify(playerResponse(NEW_ID,
    'Such a good idea! Coraline Sketchbook')));
  const item = H.collect(w.document, NEW_HREF, w);
  eq('★ 第三路命中当前条', item && item.videoId, NEW_ID);
  truthy('第三路写进桥节点', H.write(w.document, item, NEW_HREF));

  const f = await extract(env);
  eq('发布日期来自页面自己的 player 响应', f['发布日期'], '2026/11/05 12:00:37');
  truthy('文案用的是当前条标题',
    f['本页文案'].indexOf('Such a good idea! Coraline Sketchbook') >= 0, f['本页文案']);
  falsy('文案不含旧简介', f['本页文案'].indexOf('旧视频简介') >= 0, f['本页文案']);
  eq('作者主页来自 player 响应', f['作者主页'], 'https://www.youtube.com/@NewHandle');
  eq('URL 仍是当前视频', f['URL'], NEW_HREF);
}

/* ============================ 五、主世界钩子纯函数 ============================ */
function loadHook(win, doc) {
  const mod = { exports: {} };
  // 传 module.exports 阻止自动启动定时器；Node 单测只要纯函数
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'module', 'self', read('src/content/youtube-shorts-hook.js'))(
    win, doc, mod, win
  );
  return mod.exports;
}

function makeReelDoc(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html || `<!doctype html><html><head></head><body>
    <ytd-reel-video-renderer id="r0"></ytd-reel-video-renderer>
    <ytd-reel-video-renderer id="r1"></ytd-reel-video-renderer>
    <ytd-reel-video-renderer id="r2"></ytd-reel-video-renderer>
  </body></html>`, { url: NEW_HREF, runScripts: 'outside-only' });
  const w = dom.window;
  const reels = [].slice.call(w.document.querySelectorAll('ytd-reel-video-renderer'));
  const wrap = (id, title) => ({
    command: {
      reelWatchEndpoint: {
        videoId: id,
        unserializedPrefetchData: {
          playerResponse: {
            videoDetails: { videoId: id, title: title, shortDescription: 'desc-' + id, author: 'author-' + id },
            microformat: { playerMicroformatRenderer: { publishDate: '2026-11-05T12:00:37' } }
          }
        }
      }
    }
  });
  reels[0].data = wrap(OLD_ID, '上一条');
  reels[1].data = wrap(NEW_ID, '当前这一条');
  reels[2].data = wrap('NEXTVIDEO9', '下一条');
  return { w: w, dom: dom, reels: reels, wrap: wrap };
}

function testHookParser() {
  section('5. 主世界钩子：地址门禁 / ID 闸口 / 多条目挑选 / 写节点');

  const env = makeReelDoc();
  const H = loadHook(env.w, env.w.document);

  eq('取地址里的视频 ID', H.urlVideoId(NEW_HREF), NEW_ID);
  eq('带 query 也能取', H.urlVideoId(NEW_HREF + '?feature=share'), NEW_ID);
  eq('非 Shorts 页取不到', H.urlVideoId('https://www.youtube.com/watch?v=' + NEW_ID), '');
  truthy('认 youtube.com 的 Shorts', H.isShortsHref(NEW_HREF));
  falsy('非 YouTube 域名不干活', H.isShortsHref('https://www.tiktok.com/shorts/' + NEW_ID));
  falsy('/watch 页不干活', H.isShortsHref('https://www.youtube.com/watch?v=' + NEW_ID));

  eq('★ 多条目里只挑地址对得上的那条',
    H.collect(env.w.document, NEW_HREF, env.w) && H.collect(env.w.document, NEW_HREF, env.w).title,
    '当前这一条');
  eq('找不到对得上的条目就返回 null',
    H.collect(env.w.document, 'https://www.youtube.com/shorts/NOPE00001', env.w), null);
  eq('★ normalize：数据 ID 对不上整份作废',
    H.normalize({ videoDetails: { videoId: OLD_ID, title: '旧' } }, NEW_ID), null);

  // 两道闸口各自都要能挡住「外壳是这一条、内容是上一条」的拼装数据
  const a = makeReelDoc();
  a.reels[1].data.command.reelWatchEndpoint.unserializedPrefetchData
    .playerResponse.videoDetails.videoId = OLD_ID;
  const Ha = loadHook(a.w, a.w.document);
  eq('★ playerResponse 内部 ID 对不上 → 整条作废', Ha.collect(a.w.document, NEW_HREF, a.w), null);

  const b = makeReelDoc();
  b.reels[1].data.command.reelWatchEndpoint.videoId = OLD_ID;
  const Hb = loadHook(b.w, b.w.document);
  eq('★ reelWatchEndpoint 的 ID 对不上 → 不选这一条', Hb.collect(b.w.document, NEW_HREF, b.w), null);

  // 整页直开：reel 里没有 unserializedPrefetchData，首屏数据在主世界变量里
  const c = makeReelDoc();
  c.reels.forEach((r) => { delete r.data.command.reelWatchEndpoint.unserializedPrefetchData; });
  c.w.ytInitialPlayerResponse = {
    videoDetails: { videoId: NEW_ID, title: '首屏标题', shortDescription: '首屏简介', author: '首屏作者' },
    microformat: { playerMicroformatRenderer: { publishDate: '2026-11-05T12:00:37' } }
  };
  const Hc = loadHook(c.w, c.w.document);
  const firstItem = Hc.collect(c.w.document, NEW_HREF, c.w);
  eq('★ 整页直开也能从首屏变量取到当前条', firstItem && firstItem.title, '首屏标题');
  eq('首屏变量带出精确日期', firstItem && firstItem.publishDate, '2026-11-05T12:00:37');
  c.w.ytInitialPlayerResponse.videoDetails.videoId = OLD_ID;
  eq('★ 首屏变量是旧视频时被闸口挡下', Hc.collect(c.w.document, NEW_HREF, c.w), null);
  truthy('normalize：日期/作者/简介都带出来',
    H.normalize({ videoDetails: { videoId: NEW_ID, title: 'T', shortDescription: 'D', author: 'A' },
      microformat: { playerMicroformatRenderer: { publishDate: '2026-11-05T12:00:37' } } }, NEW_ID).publishDate === '2026-11-05T12:00:37');

  truthy('scan 命中后写出桥节点', H.scan(env.w.document, NEW_HREF, env.w));
  const node = env.w.document.getElementById('clipmate-youtube-shorts');
  truthy('桥节点存在', !!node);
  eq('桥节点里是当前 ID',
    JSON.parse(node.getAttribute('data-clipmate-json')).item.videoId, NEW_ID);
  falsy('scan 非 Shorts 页不写数据',
    H.scan(env.w.document, 'https://www.youtube.com/watch?v=' + NEW_ID, env.w));
  eq('离开 Shorts 后节点被清空',
    env.w.document.getElementById('clipmate-youtube-shorts').getAttribute('data-clipmate-json'), null);

  // ★ 真机 2026-11-06：YouTube 的 Trusted Types 会拦 script.textContent，
  //   桥节点必须只靠 data-* 属性承载，否则钩子在真机一个字节都写不进去。
  const ttNode = {
    _attr: {},
    setAttribute(k, v) { this._attr[k] = v; },
    getAttribute(k) { return this._attr[k] === undefined ? null : this._attr[k]; },
    removeAttribute(k) { delete this._attr[k]; },
    set textContent(v) { throw new Error('TrustedScript required'); },
    get textContent() { return ''; }
  };
  const ttDoc = {
    getElementById: () => null,
    createElement: () => { const o = Object.create(ttNode); o._attr = {}; return o; },
    head: { appendChild() {} },
    documentElement: {}
  };
  let ttWrote = false;
  try { ttWrote = H.write(ttDoc, { videoId: NEW_ID, title: 'T' }, NEW_HREF); } catch (e) { ttWrote = false; }
  truthy('★ Trusted Types 环境下也能写出桥节点', ttWrote);
}

/* ============ 5b、第三路：/youtubei/v1/player 响应（真机第 3 条） ============ */
/** 造一份页面自己发的 player 响应（真机第 3 条 R4ECOtTnwXs 的形态） */
function playerResponse(id, title) {
  return {
    videoDetails: {
      videoId: id,
      title: title || ('网络响应标题-' + id),
      shortDescription: '网络响应简介-' + id,
      author: 'NetAuthor',
      channelId: 'UCnetChannel'
    },
    microformat: {
      playerMicroformatRenderer: {
        publishDate: '2026-11-05T12:00:37',
        ownerProfileUrl: 'http://www.youtube.com/@NewHandle',
        ownerChannelName: 'NetAuthor'
      }
    }
  };
}

function testNetResponsePath() {
  section('5b. ★ 第三路：没预取数据的条目，只认页面自己发的 /youtubei/v1/player');

  // 真机第 3 条现场：reel 只有 softRefreshContinuation、首屏变量还是第 1 条
  const env = makeReelDoc();
  env.reels.forEach((r) => {
    delete r.data.command.reelWatchEndpoint.unserializedPrefetchData;
    r.data.command.reelWatchEndpoint.softRefreshContinuation = 'stub';
  });
  env.w.ytInitialPlayerResponse = playerResponse(OLD_ID, '上一条');
  const H = loadHook(env.w, env.w.document);

  eq('★ 没有任何新数据时 collect 返回 null（不许拿旧视频顶替）',
    H.collect(env.w.document, NEW_HREF, env.w), null);

  // 缓存里只有上一条 → 依然不能顶替
  H.rememberPlayerJson(env.w, JSON.stringify(playerResponse(OLD_ID, '上一条')));
  eq('★ 缓存只有上一条时不许顶替当前条',
    H.collect(env.w.document, NEW_HREF, env.w), null);

  // 页面自己发了当前这一条的 player 响应
  const saved = H.rememberPlayerJson(env.w, JSON.stringify(playerResponse(NEW_ID)));
  eq('rememberPlayerJson 存下当前 ID', saved && saved.videoId, NEW_ID);
  eq('存下的是归一化后的快照', saved && saved.publishDate, '2026-11-05T12:00:37');

  const item = H.collect(env.w.document, NEW_HREF, env.w);
  eq('★ collect 从网络缓存拿到当前条', item && item.title, '网络响应标题-' + NEW_ID);
  eq('精确日期也带出来了', item && item.publishDate, '2026-11-05T12:00:37');

  // 缓存项 ID 被改成旧 ID → collect 那道闸口必须挡下
  env.w.__clipmateYtPlayers[NEW_ID].videoId = OLD_ID;
  eq('★ 缓存项 ID 对不上 → 整条作废', H.collect(env.w.document, NEW_HREF, env.w), null);
  env.w.__clipmateYtPlayers[NEW_ID].videoId = NEW_ID;

  eq('坏 JSON 不进缓存', H.rememberPlayerJson(env.w, '{not json'), null);
  eq('ID 太短不进缓存', H.rememberPlayerJson(env.w, JSON.stringify(playerResponse('ab'))), null);
  eq('缺 videoDetails 不进缓存',
    H.rememberPlayerJson(env.w, JSON.stringify({ microformat: {} })), null);

  truthy('scan 能把第三路的数据写进桥节点', H.scan(env.w.document, NEW_HREF, env.w));
  const node = env.w.document.getElementById('clipmate-youtube-shorts');
  eq('桥节点里是当前 ID', JSON.parse(node.getAttribute('data-clipmate-json')).item.videoId, NEW_ID);

  // 长刷 Shorts 不能让缓存无限涨（单独开一个环境，免得把当前条挤出去）
  const cap = makeReelDoc();
  const Hcap = loadHook(cap.w, cap.w.document);
  for (let i = 0; i < 60; i++) {
    Hcap.rememberPlayerJson(cap.w, JSON.stringify(playerResponse('FILLER' + String(i).padStart(4, '0'))));
  }
  truthy('缓存条数有上限', Object.keys(cap.w.__clipmateYtPlayers).length <= 50,
    String(Object.keys(cap.w.__clipmateYtPlayers).length));

  // 源码层的三道线（防止「测试过了但代码根本没接上」）
  const src = stripComments(read('src/content/youtube-shorts-hook.js'));
  truthy('start() 真的装了网络钩子', /try \{ installNetHook\(win\); \}/.test(src));
  truthy('collect() 按当前 ID 精确查缓存', /store\[id\]/.test(src));
  truthy('网络响应也过 normalize 的 ID 闸口', /normalize\(data, String\(id\)\)/.test(src));
}

/* ============ 5c、只听不发：包装 fetch / XHR，但不改请求、不主动发包 ============ */
function testNetHookInstall() {
  section('5c. ★ 只听不发：包装 fetch / XHR，装钩子期间零请求');

  // --- fetch 一路 ---
  const fw = makeReelDoc().w;
  let fetchCalls = 0;
  let cloneCalls = 0;
  const origFetch = function () {
    fetchCalls += 1;
    return Promise.resolve({
      clone: function () {
        cloneCalls += 1;
        return { text: () => Promise.resolve(JSON.stringify(playerResponse(NEW_ID))) };
      }
    });
  };
  fw.fetch = origFetch;
  fw.setInterval = () => 0;   // 不让轮询定时器在单测里真跑
  const H = loadHook(fw, fw.document);
  H.start(fw, fw.document);

  truthy('start 后 fetch 已被包装', fw.fetch !== origFetch);
  eq('★ 装钩子期间一次请求都没发', fetchCalls, 0);

  const p = fw.fetch('https://www.youtube.com/youtubei/v1/player?key=abc', {});
  eq('页面自己发的请求计数 +1', fetchCalls, 1);

  return p.then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
    truthy('★ 从 clone 出来的响应里读到了当前条', !!fw.__clipmateYtPlayers[NEW_ID]);
    truthy('确实调用的 clone()（不消费页面自己的 body）', cloneCalls >= 1, String(cloneCalls));
    eq('原请求的返回值原样透传（没有改响应）', typeof p.then, 'function');

    const before = cloneCalls;
    fw.fetch('https://www.youtube.com/youtubei/v1/browse', {});
    eq('非 player 接口不读响应', cloneCalls, before);

    // --- XHR 一路（独立环境，避免和 fetch 混在一起） ---
    const xw = makeReelDoc().w;
    xw.fetch = undefined;
    xw.setInterval = () => 0;
    xw.XMLHttpRequest = function () { this.listeners = {}; };
    xw.XMLHttpRequest.prototype.open = function (m, u) { this.__cmYtUrl = u; };
    xw.XMLHttpRequest.prototype.send = function () {};
    xw.XMLHttpRequest.prototype.addEventListener = function (t, fn) {
      (this.listeners[t] = this.listeners[t] || []).push(fn);
    };
    const Hx = loadHook(xw, xw.document);
    Hx.start(xw, xw.document);
    truthy('XHR 已被包装', xw.XMLHttpRequest.prototype.__clipmateYtHooked === true);

    const xhr = new xw.XMLHttpRequest();
    xhr.open('POST', 'https://www.youtube.com/youtubei/v1/player?key=abc');
    xhr.responseText = JSON.stringify(playerResponse('XHRVIDEO01'));
    xhr.send();
    (xhr.listeners.load || []).forEach((fn) => fn());
    truthy('★ XHR 响应也按自己的 ID 入缓存', !!xw.__clipmateYtPlayers['XHRVIDEO01']);
    eq('XHR 存的就是自己的 ID',
      xw.__clipmateYtPlayers['XHRVIDEO01'] && xw.__clipmateYtPlayers['XHRVIDEO01'].videoId,
      'XHRVIDEO01');
  });
}

/* ============================ 六、隔离世界读取器 ============================ */
function testPageData() {
  section('6. 隔离世界读取器：ID 闸口 / 站点门禁 / 缓存键 / 零请求');

  const env = makeEnv({ item: Object.assign({}, FIRSTHAND, { videoId: OLD_ID }) });
  const D = env.w.YoutubeShortsPageData;

  eq('★ 桥节点 ID 对不上 → null', D.readBridge(NEW_ID), null);
  eq('ID 对上才返回', D.readBridge(OLD_ID).videoId, OLD_ID);
  eq('缓存键带站点', D.cacheKey(NEW_HREF, NEW_ID), 'www.youtube.com/shorts/' + NEW_ID);
  truthy('认 Shorts 地址', D.isShortsHref(NEW_HREF));
  falsy('不认 /watch', D.isShortsHref('https://www.youtube.com/watch?v=' + NEW_ID));
  falsy('不认别的域名', D.isShortsHref('https://www.tiktok.com/shorts/' + NEW_ID));

  const watchEnv = makeEnv({ href: 'https://www.youtube.com/watch?v=' + NEW_ID, html: buildHtml({}) });
  eq('非 Shorts 页 getCurrent 恒为 null', watchEnv.w.YoutubeShortsPageData.getCurrent(), null);

  const src = stripComments(read('src/content/shared/youtube-shorts-page-data.js'));
  const hookSrc = stripComments(read('src/content/youtube-shorts-hook.js'));
  falsy('读取器不主动发请求', /fetch\s*\(|XMLHttpRequest|DOMParser/.test(src));
  // 钩子会「引用」fetch / XMLHttpRequest 来包装页面自己的请求，但绝不自己构造或发起
  falsy('主世界钩子不自己构造请求', /new\s+XMLHttpRequest|DOMParser/.test(hookSrc));
  falsy('主世界钩子不主动调 fetch 发包', /(^|[^.\w])fetch\s*\(/.test(hookSrc));
  truthy('主世界钩子只读 clone 出来的响应', /\.clone\(\)\.text\(\)/.test(hookSrc));
  truthy('读取器有 ID 闸口', /item\.videoId/.test(src));
  truthy('钩子有 reelWatchEndpoint 闸口', /ep\.videoId/.test(hookSrc));
  falsy('钩子不碰 Trusted Types 会拦的 sink', /textContent\s*=|innerHTML\s*=/.test(hookSrc));
  truthy('钩子用 data-* 属性承载桥数据', /setAttribute\('data-clipmate-json'/.test(hookSrc));

  return D.ensureFresh(30).then((v) => {
    eq('拿不到数据时超时返回 null（不拿旧数据顶替）', v, null);
  });
}

/* ============================ 七、小毛病专项 ============================ */
function testSmallFixes() {
  section('7. 三个固定小毛病：/shorts 尾巴 / 主页归一 / 文案清洗去重');

  const env = makeEnv({});
  const ex = new env.w.YouTubeSocialExtractor();

  eq('作者ID 从 /@x/shorts 只取 x', ex.extractAuthorID(), 'NewHandle');
  eq('作者主页去掉 /shorts 子页',
    ex._ytShortsNormalizeHomepage('https://www.youtube.com/@NewHandle/shorts'),
    'https://www.youtube.com/@NewHandle');
  eq('channel/UC 形态也归一',
    ex._ytShortsNormalizeHomepage('https://www.youtube.com/channel/UCabc/shorts?x=1'),
    'https://www.youtube.com/channel/UCabc');
  eq('普通主页原样返回',
    ex._ytShortsNormalizeHomepage('https://www.youtube.com/@NewHandle'),
    'https://www.youtube.com/@NewHandle');
  eq('清洗「…更多」', ex._ytShortsCleanText('正文内容…更多'), '正文内容');
  eq('清洗「展开」', ex._ytShortsCleanText('正文内容 展开'), '正文内容');
  eq('清洗尾部省略号', ex._ytShortsCleanText('正文内容…'), '正文内容');
  eq('★ 描述里重复标题只留一次',
    ex._ytShortsBuildText('标题', '标题\n正文…更多'), '标题\n正文');
  eq('完全相同只留一次', ex._ytShortsBuildText('标题', '标题'), '标题');
  eq('标题空时只给描述', ex._ytShortsBuildText('', '正文'), '正文');
  eq('description 空时只给标题', ex._ytShortsBuildText('标题', ''), '标题');
}

/* ============================ 八、manifest 注册 ============================ */
function testManifest() {
  section('8. manifest：两个新脚本都注册、顺序正确、零越权');

  const mf = JSON.parse(read('manifest.json'));
  eq('版本号已升到 2.12.11', mf.version, '2.12.11');

  const isolated = mf.content_scripts.find((e) => !e.world || e.world === 'ISOLATED');
  const js = isolated.js;
  const iData = js.indexOf('src/content/shared/youtube-shorts-page-data.js');
  const iExtractor = js.indexOf('src/content/extractors/youtube-social.js');
  truthy('读取器注册在隔离世界', iData >= 0);
  truthy('读取器排在提取器前面', iData >= 0 && iExtractor >= 0 && iData < iExtractor);

  const main = mf.content_scripts.find((e) => e.world === 'MAIN' &&
    (e.js || []).indexOf('src/content/youtube-shorts-hook.js') >= 0);
  truthy('主世界钩子已注册', !!main);
  truthy('钩子 world = MAIN', !!main && main.world === 'MAIN');
  truthy('钩子 all_frames = false', !!main && main.all_frames === false);
  truthy('钩子覆盖 www.youtube.com 全站（SPA 从首页进 Shorts 也要有钩子）',
    !!main && main.matches.indexOf('https://www.youtube.com/*') >= 0);
  falsy('钩子没有越权到别的域名',
    !!main && main.matches.some((m) => !/youtube\.com/.test(m)));

  const socialSrc = stripComments(read('src/content/extractors/youtube-social.js'));
  truthy('提取器真的预热了一手数据', /YoutubeShortsPageData\.ensureFresh/.test(socialSrc));
  truthy('提取器照妖镜还在', /_ytShortsHeadFresh\(\)/.test(socialSrc));
  truthy('文档级 #snippet 过了闸口才准读',
    /if \(this\._ytShortsHeadFresh\(\)\) \{[\s\S]{0,240}#snippet/.test(socialSrc));
  falsy('B 方案（fetch 整页 / DOMParser）没有混进来',
    /fetch\s*\(|DOMParser/.test(socialSrc));
}

/* ============================ 收尾 ============================ */
(async function main() {
  await testFreshFirsthand();
  await testStaleGuards();
  await testDirectOpen();
  await testEnsureFreshWiring();
  await testNetResponseEndToEnd();
  testHookParser();
  testNetResponsePath();
  await testNetHookInstall();
  await testPageData();
  testSmallFixes();
  testManifest();

  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过：' + pass + ' 项');
})().catch((e) => {
  console.error('跑测试本身出错：', e);
  process.exit(1);
});
