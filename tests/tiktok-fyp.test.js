/**
 * TikTok 推荐流（For You / Following / Friends）—— v2.5.97
 *
 * 被测对象：
 *   ① `src/content/tiktok-fiber-hook.js`        —— 推荐流地址识别 / 当前条判定 / 归一化（含图文标记）
 *   ② `src/content/shared/tiktok-page-data.js`  —— 推荐流桥节点读取（scope 闸口 / 过期闸口）/ 预热分叉
 *   ③ `src/content/extractors/tiktok-social.js` —— 五个字段在推荐流上的纪律 + 作品地址拼接
 *   ④ `src/content/ui/tiktok-spa-handler.js`    —— 换条判定（地址不变靠当前条 ID）/ 按钮贴位
 *
 * 真机实测背景（2026-10-29，`https://www.tiktok.com/`）：
 *   · 首屏数据块里**没有作品数据**（只有 app-context / i18n / seo.abtest / updated-items / a-b 六个键）；
 *   · `updated-items` 只有开头 3 条，往后滚动**完全不更新**；
 *   · 滚动换条地址一个字都不变；fiber 里当前条数据与界面文字 100ms 采样 60 次零错位；
 *   · 推荐流 item 的 `author` 是**字符串**（= TikTok 号），昵称/authorId/authorSecId 平铺；
 *   · 改前实测输出：作者ID=2172085889（侧栏推荐用户）、昵称空、日期空、URL=tiktok.com；
 *   · 面板结构：`[data-e2e="cinema-creator-identity"]` 三个直接子 div = 头像 / 昵称 / 关注按钮，
 *     关注按钮里**有真实 button 元素**，昵称那个带语义类名 `DivCreatorUsername`。
 *
 * 反向验证（必须变红）：
 *   ① `normalize()` 里去掉 `authorIsString` 兜底           → 第三节第 1、2 条红
 *   ② `readFypBridge` 去掉 `scope !== 'fyp'` 闸口           → 第四节第 1 条红
 *   ③ `readFypBridge` 去掉过期判断                          → 第四节第 3 条红
 *   ④ `extractAuthorID` 推荐流分支去掉（回落到扫全页链接）     → 第七节第 1 条红
 *   ⑤ `extractPageText` 推荐流分支去掉（回落 meta）           → 第七节第 5 条红
 *   ⑥ `extractUrl` 固定 video（不看 isPhoto）                → 第六节第 2 条红
 *   ⑦ `_tkRouteKeyFromHref` 不认推荐流                       → 第八节第 3 条红
 *   ⑧ `_checkTikTokFyp` 首次不「只记录」直接当换条            → 第九节第 1 条红
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m'
};
let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) {
  fail++;
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function truthy(name, got) { if (got) return ok(name); else bad(name, `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got) { if (!got) return ok(name); else bad(name, `期望假值，实得 ${JSON.stringify(got)}`); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/* 真机实测样本：第一条推荐（`Pawcket Club 🐾` 那条之前的那条，字段值都是屏幕上核对过的） */
const FYP_HREF = 'https://www.tiktok.com/';
const ITEM_ID = '7694219677190343957';
const UNIQUE_ID = 'setakooo';
const NICKNAME = 'せたこ / Setako';
const AUTHOR_ID = '6791018981295424514';
const AUTHOR_SEC = 'MS4wLjABAAAA-VHAKi4b';
const CT = 1791450127;
const DESC = 'Love Sydney 🤍 #シドニー #Sydney';

function fmt(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 造一条推荐流 itemStruct（真机形态：author 是字符串，作者信息平铺）
 */
function makeFypItem(extra) {
  const base = {
    id: ITEM_ID,
    desc: DESC,
    createTime: String(CT),
    author: UNIQUE_ID,
    nickname: NICKNAME,
    authorId: AUTHOR_ID,
    authorSecId: AUTHOR_SEC,
    video: { duration: 5 },
    stats: { diggCount: 20500 }
  };
  return Object.assign(base, extra || {});
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ①：主世界扫描器纯函数（定时器钉死成空转）                               */
/* -------------------------------------------------------------------------- */
function loadFiberHook() {
  const src = read('src/content/tiktok-fiber-hook.js');
  const win = {};
  win.window = win;
  const st = global.setTimeout;
  const si = global.setInterval;
  global.setTimeout = function () { return 0; };
  global.setInterval = function () { return 0; };
  try {
    // 脚本里 `var g = typeof self !== 'undefined' ? self : global` 把接口挂到 self 上，
    // 沙箱里得显式给一个 self（浏览器里它就是 window）。
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'self', src)(win, undefined, win);
  } finally {
    global.setTimeout = st;
    global.setInterval = si;
  }
  return win.ClipMateTiktokFiberParser;
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ②：隔离世界数据模块                                                     */
/* -------------------------------------------------------------------------- */
function loadPageData(o) {
  const opt = o || {};
  const src = read('src/content/shared/tiktok-page-data.js');
  const win = {};
  win.window = win;
  win.location = { href: opt.href || FYP_HREF };

  const stats = { fypReads: 0 };
  const doc = {
    getElementById: (id) => {
      if (id === 'clipmate-tiktok-fiber') {
        stats.fypReads++;
        if (opt.bridgeDelay && stats.fypReads < opt.bridgeDelay) return null;
        const b = opt.bridge;
        return b ? { textContent: JSON.stringify(b) } : null;
      }
      if (id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
        const r = opt.rehydration;
        return r ? { textContent: JSON.stringify(r) } : null;
      }
      return null;
    },
    documentElement: {
      getAttribute: () => opt._attr,
      setAttribute: (k, v) => { opt._attr = v; }
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'module', src)(win, doc, win.location, undefined);
  win.TiktokPageData._stats = stats;
  return win.TiktokPageData;
}

/** 造桥节点内容；`scope` 默认 fyp */
function makeBridge(data, o) {
  const opt = o || {};
  return {
    v: 1,
    scope: opt.scope || 'fyp',
    urlId: data.id,
    id: data.id,
    ts: opt.ts === undefined ? Date.now() : opt.ts,
    data: data
  };
}

/** 桥节点上存的是「主世界已经压过一遍」的结构（字段名是归一化之后的） */
function makeBridgeData(extra) {
  return Object.assign({
    id: ITEM_ID,
    desc: DESC,
    createTime: CT,
    nickname: NICKNAME,
    uniqueId: UNIQUE_ID,
    secUid: AUTHOR_SEC,
    authorId: AUTHOR_ID,
    duration: 5,
    isPhoto: false
  }, extra || {});
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ③：提取器（DOM 可精细伪造）                                            */
/* -------------------------------------------------------------------------- */
function loadExtractor(o) {
  const opt = o || {};
  const src = read('src/content/extractors/tiktok-social.js');
  const win = {
    BaseExtractor: class BaseExtractor { constructor() { this.siteName = ''; } },
    SocialDomUtils: {
      readMeta: (sel) => (opt.meta && String(sel).indexOf('description') >= 0 ? opt.meta : '')
    },
    SocialFieldsBuilder: { build: async () => ({ built: true }) },
    SocialTitleProcessor: { generatePageTitle: () => '' },
    ClipMateLog: { debug() {}, info() {}, warn() {}, error() {} },
    TiktokPageData: opt.pageData === undefined ? null : opt.pageData
  };
  win.window = win;
  win.location = { href: opt.href || FYP_HREF };

  const bySelector = opt.bySelector || {};
  const doc = {
    querySelector: (sel) => {
      const s = String(sel);
      if (bySelector[s] !== undefined) return bySelector[s];
      return null;
    },
    querySelectorAll: () => []
  };
  const prelude =
    'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
    'ClipMateLog = window.ClipMateLog, TiktokPageData = window.TiktokPageData;\n';
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', 'location', 'module', prelude + src)(
    win, doc, console, win.location, undefined
  );
  const ex = new win.TikTokSocialExtractor();
  if (opt.item !== undefined) ex._tkItemCached = opt.item;
  return ex;
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ④：换条跟随 / 贴位                                                      */
/* -------------------------------------------------------------------------- */
function loadSpa(o) {
  const opt = o || {};
  const src = read('src/content/ui/tiktok-spa-handler.js');
  const win = { addEventListener() {}, innerWidth: opt.vw || 1440, innerHeight: opt.vh || 900 };
  win.window = win;
  win.location = { hostname: 'www.tiktok.com', href: opt.href || FYP_HREF };
  const pageData = opt.pageData || loadPageData({ href: opt.href || FYP_HREF });
  win.TiktokPageData = pageData;

  const bridgeNode = opt.bridge
    ? { textContent: JSON.stringify(opt.bridge) }
    : null;
  const elements = opt.elements || {};
  const doc = {
    getElementById: (id) => (id === 'clipmate-tiktok-fiber' ? bridgeNode : null),
    querySelector: (sel) => (elements[String(sel)] !== undefined ? elements[String(sel)] : null),
    documentElement: { clientWidth: opt.vw || 1440, clientHeight: opt.vh || 900 }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'setInterval', 'clearInterval', 'TiktokPageData', src)(
    win, doc, win.location, () => 0, () => {}, pageData
  );
  return win.TikTokSpaMixin;
}

/** 假按钮 */
function makeButton(w, h) {
  return {
    style: {},
    offsetWidth: w || 96,
    offsetHeight: h || 40,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
}

/* ========================================================================== */
section('一、推荐流地址识别（主世界 + 隔离世界两份实现必须一致）');
{
  const parser = loadFiberHook();
  const pd = loadPageData({});
  const yes = [
    'https://www.tiktok.com/',
    'https://www.tiktok.com',
    'https://tiktok.com/',
    'https://m.tiktok.com/',
    'https://www.tiktok.com/foryou',
    'https://www.tiktok.com/foryou?lang=en',
    'https://www.tiktok.com/following',
    'https://www.tiktok.com/friends',
    'https://www.tiktok.com/?is_from_webapp=1&sender_device=pc'
  ];
  const no = [
    'https://www.tiktok.com/@kariina_choi',
    'https://www.tiktok.com/@kariina_choi/video/7699137487112883477',
    'https://www.tiktok.com/@kariina_choi/photo/7701436809875639572',
    'https://www.tiktok.com/search?q=cat',
    'https://www.tiktok.com/live',
    'https://www.tiktok.com/foryou/extra',
    'https://www.tiktok.com/explore',
    'https://www.tiktok.com/upload'
  ];
  yes.forEach((u) => {
    eq(`主世界认推荐流：${u.replace('https://', '')}`, parser.isFypUrl(u), true);
    eq(`隔离世界认推荐流：${u.replace('https://', '')}`, pd.isFypUrl(u), true);
  });
  no.forEach((u) => {
    eq(`不是推荐流：${u.replace('https://www.tiktok.com', '') || '/'}`, parser.isFypUrl(u), false);
    eq(`隔离世界也排除：${u.replace('https://www.tiktok.com', '') || '/'}`, pd.isFypUrl(u), false);
  });
  // 地址判别不能互相打架
  eq('作品页仍认得出作品 ID', pd.urlItemId('https://www.tiktok.com/@a/video/7699137487112883477'), '7699137487112883477');
  eq('推荐流没有作品 ID', pd.urlItemId(FYP_HREF), '');
  eq('推荐流不算主页', pd.isProfileUrl(FYP_HREF), false);
}

/* ========================================================================== */
section('二、当前条数据判定与归一化（主世界）');
{
  const parser = loadFiberHook();

  truthy('合格样本通过', parser.isFypItem(makeFypItem()));
  falsy('没有发布时间 → 不要', parser.isFypItem(makeFypItem({ createTime: undefined })));
  falsy('发布时间是 0 → 不要', parser.isFypItem(makeFypItem({ createTime: 0 })));
  falsy('ID 不是纯数字 → 不要', parser.isFypItem(makeFypItem({ id: 'abc' })));
  falsy('ID 太短 → 不要', parser.isFypItem(makeFypItem({ id: '123' })));
  falsy('空对象 → 不要', parser.isFypItem({}));
  falsy('null → 不要', parser.isFypItem(null));
  falsy(
    '只带 id 的空壳 → 不要（防止把邻近预加载的空对象当当前条）',
    parser.isFypItem({ id: ITEM_ID, createTime: String(CT) })
  );

  const item = parser.normalizeItem(makeFypItem());
  eq('归一化：作品 ID', item.id, ITEM_ID);
  eq('归一化：文案', item.desc, DESC);
  eq('归一化：发布时间（字符串→数字）', item.createTime, CT);
  eq('归一化：TikTok 号（author 是字符串）', item.uniqueId, UNIQUE_ID);
  eq('归一化：昵称（平铺字段）', item.nickname, NICKNAME);
  eq('归一化：数字作者 ID（平铺字段）', item.authorId, AUTHOR_ID);
  eq('归一化：secUid（authorSecId）', item.secUid, AUTHOR_SEC);
  eq('归一化：作者ID 绝不回落作品 ID', item.authorId === ITEM_ID, false);

  eq('视频帖 isPhoto=false', item.isPhoto, false);
  eq('图文帖 isPhoto=true（imagePost）', parser.normalizeItem(makeFypItem({ imagePost: { images: [] } })).isPhoto, true);
  eq('图文帖 isPhoto=true（photoMode）', parser.normalizeItem(makeFypItem({ photoMode: 1 })).isPhoto, true);
  eq('图文帖 isPhoto=true（image_post_info）', parser.normalizeItem(makeFypItem({ image_post_info: {} })).isPhoto, true);

  // 作品页那套（author 是对象）不能因为这次改动而退化
  const objItem = parser.normalizeItem({
    id: '7699137487112883477',
    desc: 'x',
    createTime: 1792595143,
    author: { id: '7592161536783123477', uniqueId: 'kariina_choi', nickname: 'kariina', secUid: 'MS4w' }
  });
  eq('作品页形态：TikTok 号仍取 author.uniqueId', objItem.uniqueId, 'kariina_choi');
  eq('作品页形态：昵称仍取 author.nickname', objItem.nickname, 'kariina');
  eq('作品页形态：作者ID 仍取 author.id', objItem.authorId, '7592161536783123477');
}

/* ========================================================================== */
section('三、作者字段归一化（隔离世界，author 字符串这一种以前是漏的）');
{
  const pd = loadPageData({});

  // 推荐流 / 图集页形态：author 是字符串 + 平铺
  const flat = pd.normalize(makeFypItem());
  eq('★推荐流形态：TikTok 号取 author 字符串', flat.uniqueId, UNIQUE_ID);
  eq('★推荐流形态：昵称取平铺 nickname', flat.nickname, NICKNAME);
  eq('推荐流形态：数字作者 ID 取平铺 authorId', flat.authorId, AUTHOR_ID);
  eq('推荐流形态：secUid 取 authorSecId', flat.secUid, AUTHOR_SEC);
  eq('推荐流形态：文案', flat.desc, DESC);
  eq('推荐流形态：发布时间', flat.createTime, CT);

  // 作品页形态（author 是对象）不能被改坏
  const nested = pd.normalize({
    id: '7699137487112883477',
    desc: 'y',
    createTime: 1792595143,
    author: { id: '7592161536783123477', uniqueId: 'kariina_choi', nickname: 'kariina', secUid: 'MS4w' }
  });
  eq('作品页形态：TikTok 号', nested.uniqueId, 'kariina_choi');
  eq('作品页形态：昵称', nested.nickname, 'kariina');
  eq('作品页形态：数字 ID', nested.authorId, '7592161536783123477');

  // 桥节点送来的已经是归一化结构 → isPhoto 要透传
  eq('isPhoto 透传（桥节点形态）', pd.normalize(makeBridgeData({ isPhoto: true })).isPhoto, true);
  eq('isPhoto 默认为 false', pd.normalize(makeBridgeData()).isPhoto, false);
  eq('isPhoto 也认原始 imagePost（首屏数据块形态）', pd.normalize(makeFypItem({ imagePost: {} })).isPhoto, true);

  // ID 不合法一律不要
  eq('作品 ID 不合法 → null', pd.normalize({ id: 'x', desc: 'z' }), null);
}

/* ========================================================================== */
section('四、推荐流桥节点读取（三条闸口）');
{
  const pd1 = loadPageData({ bridge: makeBridge(makeBridgeData()) });
  const got = pd1.readFypBridge();
  truthy('scope=fyp + 合法数据 → 读得到', !!got);
  eq('读到的是这一条', got.id, ITEM_ID);
  eq('来源标记为 fiber-fyp', got.source, 'fiber-fyp');
  eq('字段完整：昵称', got.nickname, NICKNAME);
  eq('字段完整：TikTok 号', got.uniqueId, UNIQUE_ID);
  eq('字段完整：发布时间', got.createTime, CT);

  // 闸口 1：scope
  const pd2 = loadPageData({ bridge: makeBridge(makeBridgeData(), { scope: 'item' }) });
  eq('★作品页写的桥（scope=item）不认', pd2.readFypBridge(), null);

  // v2.5.96 及更早版本写的桥**没有 scope 字段**。升级后如果页面还没刷新，
  // 读到的是旧脚本留下的桥 —— 这种必须不认，否则会把作品页的数据当成推荐流的。
  const legacy = makeBridge(makeBridgeData());
  delete legacy.scope;
  const pd3 = loadPageData({ bridge: legacy });
  eq('★旧版本写的桥（没有 scope 字段）→ 不认', pd3.readFypBridge(), null);

  // 闸口 3：过期
  const pd4 = loadPageData({ bridge: makeBridge(makeBridgeData(), { ts: Date.now() - 60000 }) });
  eq('★一分钟前写的桥视为过期（宁可空着也不给旧数据）', pd4.readFypBridge(), null);

  const pd5 = loadPageData({ bridge: makeBridge(makeBridgeData(), { ts: Date.now() - 1000 }) });
  truthy('一秒前写的桥仍然可用', !!pd5.readFypBridge());

  // 结构不对
  const pd6 = loadPageData({ bridge: { v: 1, scope: 'fyp', urlId: '', data: null } });
  eq('没有 data → null', pd6.readFypBridge(), null);

  const pd7 = loadPageData({ bridge: null });
  eq('没有桥节点 → null', pd7.readFypBridge(), null);
}

/* ========================================================================== */
section('五、取当前数据的分叉（推荐流 / 作品页 / 其他页）');
{
  const pdFyp = loadPageData({ bridge: makeBridge(makeBridgeData()) });
  truthy('推荐流：getCurrent 走桥', !!pdFyp.getCurrent());
  eq('推荐流：拿到正确作品', pdFyp.getCurrent().id, ITEM_ID);

  const pdItemScope = loadPageData({
    href: 'https://www.tiktok.com/@kariina_choi/video/7699137487112883477',
    bridge: makeBridge(makeBridgeData())
  });
  eq(
    '★作品页不会拿推荐流的桥当自己的数据（地址 ID 对不上）',
    pdItemScope.getCurrent(),
    null
  );

  const pdOther = loadPageData({ href: 'https://www.tiktok.com/search?q=cat' });
  eq('搜索页：没有一手数据', pdOther.getCurrent(), null);

  // ensureFresh 分叉：桥晚两拍才出现
  return (async () => {
    const pdWait = loadPageData({ bridge: makeBridge(makeBridgeData()), bridgeDelay: 2 });
    const v = await pdWait.ensureFresh(900);
    truthy('推荐流预热：桥晚到也能等到', !!v);
    eq('预热拿到的就是这一条', v && v.id, ITEM_ID);

    const pdFast = loadPageData({ bridge: makeBridge(makeBridgeData()) });
    const v2 = await pdFast.ensureFresh(900);
    eq('桥已就绪 → 立刻返回，不空等', v2 && v2.id, ITEM_ID);

    const pdNone = loadPageData({ bridge: null });
    const v3 = await pdNone.ensureFresh(200);
    eq('一直等不到 → 返回 null（调用方回落 DOM）', v3, null);

    const pdSearch = loadPageData({ href: 'https://www.tiktok.com/search?q=cat' });
    const v4 = await pdSearch.ensureFresh(200);
    eq('非可提取页不等待', v4, null);

    main();
  })();
}

function main() {
  /* ======================================================================== */
  section('六、作品地址拼接（推荐流唯一必须自己拼的字段）');
  {
    const exVideo = loadExtractor({ item: makeBridgeData() });
    eq(
      '视频帖 → /video/',
      exVideo.extractUrl(),
      `https://www.tiktok.com/@${UNIQUE_ID}/video/${ITEM_ID}`
    );

    const exPhoto = loadExtractor({ item: makeBridgeData({ isPhoto: true }) });
    eq(
      '★图文帖 → /photo/（拼成 /video/ 打不开）',
      exPhoto.extractUrl(),
      `https://www.tiktok.com/@${UNIQUE_ID}/photo/${ITEM_ID}`
    );

    const exNoItem = loadExtractor({ item: null });
    eq('拿不到一手数据 → 空串（交给统一兜底）', exNoItem.extractUrl(), '');

    const exItemPage = loadExtractor({
      href: `https://www.tiktok.com/@${UNIQUE_ID}/video/${ITEM_ID}`,
      item: makeBridgeData()
    });
    eq('作品页不自己拼（行为一个字不变）', exItemPage.extractUrl(), '');

    // 拼出来的地址必须能被统一规范化认下来，不能越规范越乱
    const norm = (() => {
      const src = read('src/content/shared/url-normalizer.js');
      const win = {};
      win.window = win;
      // eslint-disable-next-line no-new-func
      new Function('window', 'module', src)(win, undefined);
      return win.UrlNormalizer;
    })();
    const built = `https://www.tiktok.com/@${UNIQUE_ID}/video/${ITEM_ID}`;
    eq('拼出来的地址规范化后不变', norm.normalize(built), built);
    const builtPhoto = `https://www.tiktok.com/@${UNIQUE_ID}/photo/${ITEM_ID}`;
    eq('图文地址规范化后不变', norm.normalize(builtPhoto), builtPhoto);
  }

  /* ======================================================================== */
  section('七、推荐流字段纪律（不许串到侧栏 / 不许回落 SEO 话术）');
  {
    // 侧栏推荐用户：改前就是被它坑的（实测抓到 /@2172085889）
    // 必须用**真数组**（NodeList 的行为）：用普通对象的话 for...of 会抛异常被 catch 吞掉，
    // 测试就变成「永远通过」的假绿 —— 这条已经踩过一次。
    const sidebarLinks = [{ getAttribute: () => '/@2172085889' }];
    const docWithSidebar = (o) => Object.assign({
      querySelector: () => null,
      querySelectorAll: (sel) => (String(sel).indexOf('a[href*="/@"]') >= 0 ? sidebarLinks : [])
    }, o || {});

    // ① 作者ID：一手数据拿不到时不许扫全页链接
    {
      const src = read('src/content/extractors/tiktok-social.js');
      const win = {
        BaseExtractor: class { constructor() { this.siteName = ''; } },
        SocialDomUtils: { readMeta: () => '' },
        SocialFieldsBuilder: { build: async () => ({}) },
        SocialTitleProcessor: { generatePageTitle: () => '' },
        ClipMateLog: { debug() {}, info() {}, warn() {}, error() {} },
        TiktokPageData: null
      };
      win.window = win;
      win.location = { href: FYP_HREF };
      const prelude =
        'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
        'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
        'ClipMateLog = window.ClipMateLog, TiktokPageData = window.TiktokPageData;\n';
      // eslint-disable-next-line no-new-func
      new Function('window', 'document', 'console', 'location', 'module', prelude + src)(
        win, docWithSidebar(), console, win.location, undefined
      );
      const ex = new win.TikTokSocialExtractor();
      ex._tkItemCached = null;
      eq('★推荐流：一手数据没有时，作者ID 空着也不抓侧栏用户', ex.extractAuthorID(), '');
      eq('★推荐流：作者主页同理，不拼侧栏用户的主页', ex.extractAuthorHomepage(), '');
    }

    // ② 昵称：一手空 → 屏幕上创作者身份区兜底
    {
      const userBox = { textContent: NICKNAME };
      const box = {
        children: [
          { getAttribute: () => 'cinema-creator-avatar', textContent: '', querySelector: () => null },
          { getAttribute: () => null, textContent: NICKNAME, querySelector: () => null },
          { getAttribute: () => null, textContent: '关注', querySelector: () => ({}) }
        ]
      };
      const bySelector = {
        '[data-e2e="cinema-creator-identity"] [class*="DivCreatorUsername"]': userBox,
        '[data-e2e="cinema-creator-identity"]': box
      };
      const ex = loadExtractor({ item: null, bySelector });
      eq('★推荐流昵称：一手空则取 DivCreatorUsername', ex.extractAuthorName(), NICKNAME);

      // 没有语义类名时，靠「带 button 的是关注按钮」排除
      const ex2 = loadExtractor({
        item: null,
        bySelector: { '[data-e2e="cinema-creator-identity"]': box }
      });
      eq('推荐流昵称：跳过关注按钮（不靠中文字面）', ex2.extractAuthorName(), NICKNAME);

      // 一手有就用一手，不看屏幕
      const ex3 = loadExtractor({ item: makeBridgeData(), bySelector });
      eq('一手数据优先于屏幕', ex3.extractAuthorName(), NICKNAME);
    }

    // ③ 作者主页：只认昵称容器里的链接
    {
      const a = { getAttribute: () => '/@' + UNIQUE_ID };
      const handleSel = '[data-e2e="cinema-creator-identity"] a[href^="/@"], ' +
        '[data-e2e="cinema-creator-identity"] a[href*="tiktok.com/@"]';
      const bySelector = {};
      bySelector[handleSel] = a;
      const ex = loadExtractor({ item: null, bySelector });
      eq(
        '推荐流作者主页：用昵称容器里的链接',
        ex.extractAuthorHomepage(),
        `https://www.tiktok.com/@${UNIQUE_ID}`
      );
    }

    // ④ 日期 / 文案：一手数据优先
    {
      const ex = loadExtractor({ item: makeBridgeData() });
      eq('发布日期 = 一手 createTime（到秒）', ex.extractPublishDate(), fmt(CT));
      eq('本页文案 = 一手 desc', ex.extractPageText(), DESC);
    }

    // ⑤ 文案：一手空就空着，不回落 meta（推荐流的 meta 是开屏那一下的）
    {
      const ex = loadExtractor({
        item: makeBridgeData({ desc: '' }),
        meta: 'TikTok - Make Your Day'
      });
      eq('★推荐流文案空 → 空着，不拿 SEO 话术凑', ex.extractPageText(), '');
    }
  }

  /* ======================================================================== */
  section('八、换条判定（推荐流算一页）');
  {
    const mixin = loadSpa({});
    eq('★推荐流地址 = 一页', mixin._tkRouteKeyFromHref(FYP_HREF), 'fyp');
    eq('/foryou 也算', mixin._tkRouteKeyFromHref('https://www.tiktok.com/foryou'), 'fyp');
    eq('作品页仍是 item:<id>', mixin._tkRouteKeyFromHref(`https://www.tiktok.com/@a/video/${ITEM_ID}`), 'item:' + ITEM_ID);
    eq('主页仍是 profile:<名字>', mixin._tkRouteKeyFromHref('https://www.tiktok.com/@kariina_choi'), 'profile:kariina_choi');
    eq('搜索页仍不可提取', mixin._tkRouteKeyFromHref('https://www.tiktok.com/search?q=cat'), '');

    // 作品页 → 推荐流：必须算换页（否则浮窗带着上一条作品的数据赖着不走）
    eq(
      '★从作品页退回推荐流算换页',
      mixin._tkRouteKeyFromHref(FYP_HREF) !== mixin._tkRouteKeyFromHref(`https://www.tiktok.com/@a/video/${ITEM_ID}`),
      true
    );
  }

  /* ======================================================================== */
  section('九、推荐流换条 → 关浮窗（地址不变，靠当前条 ID 变）');
  {
    // 首次：只记录，不关窗
    {
      let closed = 0;
      const mixin = loadSpa({ bridge: makeBridge(makeBridgeData()) });
      mixin.modalManager = { isOpen: true, close() { closed++; } };
      mixin.buttonManager = { button: null };
      mixin._checkTikTokFyp();
      eq('★第一次看到当前条：只记下来，不关窗', closed, 0);
      eq('记下了这一条', mixin._tkFypLastId, ITEM_ID);
    }

    // 同一条：再查一次也不关
    {
      let closed = 0;
      const mixin = loadSpa({ bridge: makeBridge(makeBridgeData()) });
      mixin.modalManager = { isOpen: true, close() { closed++; } };
      mixin.buttonManager = { button: null };
      mixin._tkFypLastId = ITEM_ID;
      mixin._checkTikTokFyp();
      eq('同一条重复检查：不关窗', closed, 0);
    }

    // 换了条：关窗
    {
      let closed = 0;
      const nextData = makeBridgeData({ id: '7701798362772704533' });
      const mixin = loadSpa({ bridge: makeBridge(nextData) });
      mixin.modalManager = { isOpen: true, close() { closed++; } };
      mixin.buttonManager = { button: null };
      mixin._tkFypLastId = ITEM_ID;
      mixin._checkTikTokFyp();
      eq('★换条 → 浮窗关闭（按钮保留）', closed, 1);
      eq('记下新的一条', mixin._tkFypLastId, '7701798362772704533');
    }

    // 浮窗本来就没开：不该硬关
    {
      const mixin = loadSpa({ bridge: makeBridge(makeBridgeData({ id: '7701798362772704533' })) });
      mixin.modalManager = { isOpen: false, close() { throw new Error('不该调用 close'); } };
      mixin.buttonManager = { button: null };
      mixin._tkFypLastId = ITEM_ID;
      let threw = false;
      try { mixin._checkTikTokFyp(); } catch (e) { threw = true; }
      eq('浮窗没开时不调用 close', threw, false);
    }

    // 桥是作品页写的（scope=item）：推荐流这边一律不动
    {
      let closed = 0;
      const mixin = loadSpa({ bridge: makeBridge(makeBridgeData(), { scope: 'item' }) });
      mixin.modalManager = { isOpen: true, close() { closed++; } };
      mixin.buttonManager = { button: null };
      mixin._tkFypLastId = ITEM_ID;
      mixin._checkTikTokFyp();
      eq('★桥不是推荐流的（scope=item）→ 不当作换条', closed, 0);
    }

    // 离开推荐流：把记录清掉，回来第一拍不会误判
    {
      const mixin = loadSpa({ href: 'https://www.tiktok.com/@a/video/' + ITEM_ID });
      mixin.modalManager = { isOpen: true, close() {} };
      mixin.buttonManager = { button: null };
      mixin._tkFypLastId = ITEM_ID;
      mixin._checkTikTokFyp();
      eq('非推荐流页面清空记录', mixin._tkFypLastId, '');
    }
  }

  /* ======================================================================== */
  section('十、按钮贴位（贴播放器右上角，不再挡顶部导航条）');
  {
    const playerRect = { left: 72, top: 0, right: 937, width: 865, height: 877 };
    const player = { getBoundingClientRect: () => playerRect };
    const elements = {
      '[data-e2e="anchoring-player-column"]': player,
      '[class*="DivColumnListContainer"]': player
    };

    {
      const mixin = loadSpa({ elements, vw: 1440, vh: 900 });
      const btn = makeButton(96, 40);
      mixin.buttonManager = { button: btn, userMoved: false };
      mixin._anchorTikTokButton();
      eq('贴在播放器右侧内缩 16px', btn.style.left, (937 - 96 - 16) + 'px');
      eq('不贴视口顶部（原来 top:0 会挡导航条）', btn.style.top, '16px');
      eq('打上推荐流贴位标记', btn.attrs['data-clipmate-anchor'], 'tiktok-fyp');
    }

    // 用户拖过 → 不抢位置
    {
      const mixin = loadSpa({ elements, vw: 1440, vh: 900 });
      const btn = makeButton(96, 40);
      btn.style.left = '100px';
      btn.style.top = '300px';
      mixin.buttonManager = { button: btn, userMoved: true };
      mixin._anchorTikTokButton();
      eq('★用户亲手拖过 → 不抢位置（left 不动）', btn.style.left, '100px');
      eq('★用户亲手拖过 → 不抢位置（top 不动）', btn.style.top, '300px');
      eq('也不打标记', btn.attrs['data-clipmate-anchor'], undefined);
    }

    // 没有锚点（页面结构变了）：退回视口右侧，也绝不 top:0
    {
      const mixin = loadSpa({ elements: {}, vw: 1440, vh: 900 });
      const btn = makeButton(96, 40);
      mixin.buttonManager = { button: btn, userMoved: false };
      mixin._anchorTikTokButton();
      eq('没锚点时退回视口右侧', btn.style.left, (1440 - 96 - 16) + 'px');
      eq('没锚点时 top 也不是 0', btn.style.top, '16px');
    }

    // 窄窗口夹取
    {
      const mixin = loadSpa({ elements, vw: 400, vh: 500 });
      const btn = makeButton(96, 40);
      mixin.buttonManager = { button: btn, userMoved: false };
      mixin._anchorTikTokButton();
      eq('窄窗口：左边夹在视口内', btn.style.left, (400 - 96 - 16) + 'px');
    }

    // 非推荐流页面：一个像素都不动
    {
      const mixin = loadSpa({ href: 'https://www.tiktok.com/@a/video/' + ITEM_ID, elements });
      const btn = makeButton(96, 40);
      btn.style.left = '600px';
      btn.style.top = '0px';
      mixin.buttonManager = { button: btn, userMoved: false };
      mixin._anchorTikTokButton();
      eq('作品页不动按钮（保持用户自己存的位置）', btn.style.left, '600px');
      eq('作品页不动按钮（top 也不动）', btn.style.top, '0px');
    }
  }

  /* ======================================================================== */
  console.log(
    `\n${fail === 0 ? C.green : C.red}共 ${pass + fail} 项：通过 ${pass}，失败 ${fail}${C.reset}`
  );
  if (fail > 0) process.exitCode = 1;
}
