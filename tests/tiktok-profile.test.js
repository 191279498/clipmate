/**
 * TikTok 个人主页（v2.5.96）
 *
 * 被测对象：
 *   ① `src/content/tiktok-net-hook.js`          —— 作品列表响应 → 「最新作品时间」（只认首批）
 *   ② `src/content/shared/tiktok-page-data.js`  —— 主页地址识别 / user-detail 闸口 / 两半拼装 / 等补位
 *   ③ `src/content/extractors/tiktok-social.js` —— 主页五个字段的取值与兜底
 *   ④ `src/content/shared/url-normalizer.js`    —— 主页地址规范化
 *   ⑤ `src/content/ui/tiktok-spa-handler.js`    —— 作品页 ↔ 主页 的换页判定
 *
 * 真机实测背景（2026-10-29，`/@kariina_choi`）：
 *   · 主页首屏数据块里有 `webapp.user-detail`（昵称/账号名/简介/粉丝数），`itemList` 是**空数组**；
 *   · 主页页面上一个日期都不显示；作品发布时间只能靠截 `/api/post/item_list/` 的响应拿到；
 *   · 改前实测输出：作者ID=2172085889（侧栏推荐用户的数字 ID）、本页文案=平台 SEO 话术。
 *
 * 反向验证（必须变红）：
 *   ① 删掉 `readProfileRehydration` 里的 `user.uniqueId !== handle` 闸口 → 第 3 节第 2 条红
 *   ② 删掉 `readNet` 里的 `rec.firstPage` 判断 → 第 3 节第 5 条红
 *   ③ 主页文案分支改成回落 meta → 第 4 节第 6 条红
 *   ④ 删掉主页分支（`_tkIsProfile`）→ 第 4 节第 1 条红（作者ID 又变成 URL 里抓来的）
 *   ⑤ `tiktok` 规范化里删掉主页分支 → 第 5 节第 2 条红
 *   ⑥ `_tkRouteKeyFromHref` 不认主页 → 第 6 节第 2 条红
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', yellow: '\x1b[33m'
};
let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function truthy(name, got) { if (got) return ok(name); else bad(name, `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got) { if (!got) return ok(name); else bad(name, `期望假值，实得 ${JSON.stringify(got)}`); }
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }

const HANDLE = 'kariina_choi';
const PROFILE_HREF = 'https://www.tiktok.com/@' + HANDLE;
const USER_ID = '7592161536783123477';
const CT_NEWEST = 1792595143;   // 真机实测：最新一条作品的发布时间（秒）
const CT_OLDER = 1792078958;    // 真机实测：更早一条
const THEIR_CT = 1790000000;    // 别人的作品

/** 与源码完全一致的时间格式，避免测试里写死时区 */
function fmt(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ①：主世界接收器（只取纯函数，定时器钉死成空转）                          */
/* -------------------------------------------------------------------------- */
function loadNetHook() {
  const src = read('src/content/tiktok-net-hook.js');
  const win = {};
  win.window = win;
  const appended = [];
  const nodes = {};
  const doc = {
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ type: '', id: '', textContent: '' }),
    head: {
      appendChild(el) { nodes[el.id] = el; appended.push(el); }
    },
    documentElement: null
  };
  const st = global.setTimeout;
  global.setTimeout = function () { return 0; };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', src)(win, doc);
  } finally {
    global.setTimeout = st;
  }
  return { api: win.ClipMateTiktokNetParser, nodes, appended };
}

/** 造一份 item_list 响应正文 */
function makeItemList(items) {
  return JSON.stringify({
    itemList: items.map((it) => ({
      id: it.id,
      createTime: it.ct,
      desc: it.desc || '',
      author: { uniqueId: it.handle, id: it.uid || USER_ID, nickname: 'Kariina' }
    })),
    cursor: '1791740519693',
    hasMore: true
  });
}

const URL_FIRST = 'https://www.tiktok.com/api/post/item_list/?WebIdLastTime=1&count=16&cursor=0&secUid=MS4wLjABAAAA_x';
const URL_PAGE2 = 'https://www.tiktok.com/api/post/item_list/?WebIdLastTime=1&count=16&cursor=1791740519693&secUid=MS4wLjABAAAA_x';

/* -------------------------------------------------------------------------- */
/* 沙箱 ②：隔离世界读取器                                                       */
/* -------------------------------------------------------------------------- */
function loadPageData(o) {
  const opt = o || {};
  const src = read('src/content/shared/tiktok-page-data.js');
  const win = {};
  win.window = win;
  win.location = { href: opt.href || PROFILE_HREF };

  const stats = { netReads: 0, profileReads: 0 };
  const doc = {
    getElementById: (id) => {
      if (id === 'clipmate-tiktok-fiber') {
        const b = opt.bridge;
        return b ? { textContent: JSON.stringify(b) } : null;
      }
      if (id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
        const r = opt.rehydration;
        return r ? { textContent: JSON.stringify(r) } : null;
      }
      if (id === 'clipmate-tiktok-net') {
        stats.netReads++;
        // netDelay：前 N 次读不到，模拟「首屏作品列表请求还没回来」
        if (opt.netDelay && stats.netReads < opt.netDelay) return null;
        const n = opt.net;
        return n ? { textContent: JSON.stringify(n) } : null;
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

/** 主页首屏数据块（`webapp.user-detail`，键名带点是实测结构） */
function makeUserDetail(handle, extra) {
  const user = Object.assign({
    id: USER_ID,
    uniqueId: handle,
    nickname: 'kariina_choi',
    signature: 'тгк корина даргинка 05',
    secUid: 'MS4wLjABAAAA_test',
    createTime: 1767687887,
    verified: false
  }, (extra && extra.user) || {});
  return {
    __DEFAULT_SCOPE__: {
      'webapp.user-detail': {
        userInfo: {
          user: user,
          stats: Object.assign({
            followerCount: 3978, followingCount: 108, heartCount: 245800, videoCount: 136
          }, (extra && extra.stats) || {})
        }
      }
    }
  };
}

/** 「最新作品时间」桥节点内容 */
function makeNet(handle, ct, firstPage) {
  const users = {};
  // firstPage === false 时**故意也塞上时间**：模拟「上游某天漏了 firstPage 过滤」的脏数据，
  // 用来验证读取侧那道 `rec.firstPage` 检查不是摆设（只靠上游保证是不够的）。
  users[handle] = {
    latestCreateTime: ct,
    latestItemId: firstPage === false ? '' : '7701427018554019092',
    firstPage: firstPage !== false,
    count: 16
  };
  return { v: 1, ts: Date.now(), users: users };
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ③：提取器                                                               */
/* -------------------------------------------------------------------------- */
function loadExtractor(o) {
  const opt = o || {};
  const src = read('src/content/extractors/tiktok-social.js');
  const win = {
    BaseExtractor: class BaseExtractor { constructor() { this.siteName = ''; } },
    SocialDomUtils: { readMeta: (sel) => (opt.meta && String(sel).indexOf('description') >= 0 ? opt.meta : '') },
    SocialFieldsBuilder: { build: async () => ({ built: true }) },
    SocialTitleProcessor: { generatePageTitle: () => '' },
    ClipMateLog: { debug() {}, info() {}, warn() {}, error() {} },
    TiktokPageData: opt.pageData || null
  };
  win.window = win;
  win.location = { href: opt.href || PROFILE_HREF };

  const dom = opt.dom || {};
  const doc = {
    querySelector: (sel) => {
      const key = String(sel);
      if (dom[key] !== undefined) return { textContent: dom[key] };
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
  if (opt.profile !== undefined) ex._tkProfileCached = opt.profile;
  return ex;
}

/* -------------------------------------------------------------------------- */
/* 沙箱 ④：地址规范化 / ⑤ 换页判定                                              */
/* -------------------------------------------------------------------------- */
function loadNormalizer() {
  const src = read('src/content/shared/url-normalizer.js');
  const win = {};
  win.window = win;
  // eslint-disable-next-line no-new-func
  new Function('window', 'module', src)(win, undefined);
  return win.UrlNormalizer;
}

function loadSpa(o) {
  const opt = o || {};
  const src = read('src/content/ui/tiktok-spa-handler.js');
  const win = { addEventListener() {} };
  win.window = win;
  win.location = { hostname: 'www.tiktok.com', href: opt.href || PROFILE_HREF };
  const pageData = opt.pageData || loadPageData({ href: opt.href || PROFILE_HREF });
  win.TiktokPageData = pageData;
  // eslint-disable-next-line no-new-func
  new Function('window', 'location', 'setInterval', 'clearInterval', 'TiktokPageData', src)(
    win, win.location, () => 0, () => {}, pageData
  );
  return win.TikTokSpaMixin;
}

/* ========================================================================== */
/* 一、主页地址识别                                                             */
/* ========================================================================== */
section('一、主页地址识别（urlProfileHandle / isProfileUrl）');
{
  const pd = loadPageData({});
  const cases = [
    ['https://www.tiktok.com/@' + HANDLE, HANDLE, '裸主页'],
    ['https://www.tiktok.com/@' + HANDLE + '/', HANDLE, '带尾斜杠'],
    ['https://www.tiktok.com/@' + HANDLE + '?lang=ru-RU', HANDLE, '带语言参数'],
    ['https://www.tiktok.com/@' + HANDLE + '?is_from_webapp=1&sender_device=pc', HANDLE, '带来源参数'],
    ['https://tiktok.com/@' + HANDLE, HANDLE, '无 www'],
    ['https://www.tiktok.com/@user.name_1', 'user.name_1', '账号名含点和下划线'],
    ['https://www.tiktok.com/@' + HANDLE + '/video/7699137487112883477', '', '作品页不算主页'],
    ['https://www.tiktok.com/@' + HANDLE + '/photo/7701436809875639572?image_index=2', '', '图集页不算主页'],
    ['https://www.tiktok.com/foryou', '', '推荐流不算主页'],
    ['https://www.tiktok.com/@a', '', '账号名太短不认'],
    ['https://www.instagram.com/' + HANDLE, '', '别的站不算']
  ];
  cases.forEach(([href, want, label]) => eq(label, pd.urlProfileHandle(href), want));
  eq('isProfileUrl 主页为真', pd.isProfileUrl(PROFILE_HREF), true);
  eq('isProfileUrl 作品页为假', pd.isProfileUrl(PROFILE_HREF + '/video/123456789'), false);
}

/* ========================================================================== */
/* 二、作品列表响应 → 最新作品时间                                              */
/* ========================================================================== */
section('二、接收器：只认首批（cursor=0），取其中最大 createTime');
{
  const { api } = loadNetHook();

  eq('cursor=0 识别为首批', api.cursorOf(URL_FIRST), 0);

  api.reset();
  const first = makeItemList([
    { id: '7701427018554019092', ct: CT_NEWEST, handle: HANDLE },
    { id: '7699137487112883477', ct: CT_OLDER, handle: HANDLE }
  ]);
  truthy('首批响应被吃进', api.ingest(first, URL_FIRST));
  let snap = api.snapshot();
  eq('首批：最新时间取最大', snap.users[HANDLE].latestCreateTime, CT_NEWEST);
  eq('首批：记下作品 ID', snap.users[HANDLE].latestItemId, '7701427018554019092');
  eq('首批：标记 firstPage', snap.users[HANDLE].firstPage, true);

  // 只有第二页：绝不能当「最新作品」
  api.reset();
  truthy('第二页响应被吃进（但不用来当最新）',
    api.ingest(makeItemList([{ id: '7690000000000000001', ct: CT_OLDER, handle: HANDLE }]), URL_PAGE2));
  snap = api.snapshot();
  eq('第二页：不填最新时间', snap.users[HANDLE].latestCreateTime, 0);
  eq('第二页：firstPage 为假', snap.users[HANDLE].firstPage, false);

  // 第二页先到、首批后到：以首批为准
  api.reset();
  api.ingest(makeItemList([{ id: '7690000000000000001', ct: CT_OLDER, handle: HANDLE }]), URL_PAGE2);
  api.ingest(first, URL_FIRST);
  snap = api.snapshot();
  eq('乱序到达：仍取首批的最大值', snap.users[HANDLE].latestCreateTime, CT_NEWEST);

  // 多个账号互不串台
  api.reset();
  api.ingest(makeItemList([
    { id: '7701427018554019092', ct: CT_NEWEST, handle: HANDLE },
    { id: '7600000000000000002', ct: THEIR_CT, handle: 'someone_else', uid: '111' }
  ]), URL_FIRST);
  snap = api.snapshot();
  eq('两个账号分别记账（本账号）', snap.users[HANDLE].latestCreateTime, CT_NEWEST);
  eq('两个账号分别记账（别人）', snap.users.someone_else.latestCreateTime, THEIR_CT);

  // 脏数据不写
  api.reset();
  falsy('坏 JSON 不抛错也不写', api.ingest('{not json', URL_FIRST));
  falsy('没有 author.uniqueId 不写', api.ingest(JSON.stringify({
    itemList: [{ id: '7701427018554019092', createTime: CT_NEWEST, author: {} }]
  }), URL_FIRST));
  falsy('没有 createTime 不写', api.ingest(JSON.stringify({
    itemList: [{ id: '7701427018554019092', author: { uniqueId: HANDLE } }]
  }), URL_FIRST));
  falsy('空列表不写', api.ingest(JSON.stringify({ itemList: [] }), URL_FIRST));
  eq('脏数据之后仍是空的', Object.keys(api.snapshot().users).length, 0);
}

/* ========================================================================== */
/* 三、主页数据读取与闸口                                                       */
/* ========================================================================== */
section('三、主页数据：user-detail 闸口 / 两半拼装 / 等补位');
{
  // 3.1 正常读到
  const pd1 = loadPageData({
    rehydration: makeUserDetail(HANDLE),
    net: makeNet(HANDLE, CT_NEWEST)
  });
  const p1 = pd1.getProfile();
  truthy('读到主页快照', p1);
  eq('账号名', p1.uniqueId, HANDLE);
  eq('昵称', p1.nickname, 'kariina_choi');
  eq('简介', p1.signature, 'тгк корина даргинка 05');
  eq('内部 ID', p1.id, USER_ID);
  eq('粉丝数', p1.followerCount, 3978);
  eq('作品数', p1.videoCount, 136);
  eq('最新作品时间', p1.latestCreateTime, CT_NEWEST);
  eq('来源标记', p1.source, 'rehydration+net');

  // 3.2 ★闸口：数据块里是别人的账号 → 弃用
  const pd2 = loadPageData({
    rehydration: makeUserDetail('someone_else'),
    href: PROFILE_HREF
  });
  eq('★数据块账号名与地址不一致 → 不用', pd2.getProfile(), null);

  // 3.2b 大小写不同但确实是同一个人 → 仍要用（账号名不区分大小写），输出用数据块里的写法
  const pd2b = loadPageData({
    rehydration: makeUserDetail(HANDLE),
    href: 'https://www.tiktok.com/@Kariina_Choi'
  });
  const p2b = pd2b.getProfile();
  truthy('大小写不同仍认（同一个人）', p2b);
  eq('大小写不同：账号名用数据块里的写法', p2b && p2b.uniqueId, HANDLE);

  // 3.3 首屏块是作品页的（没有 user-detail）→ 读不到用户信息
  const workDetail = {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': { itemInfo: { itemStruct: { id: '7701427018554019092', desc: 'x', createTime: CT_NEWEST } } }
    }
  };
  const pd3 = loadPageData({ rehydration: workDetail, href: PROFILE_HREF });
  eq('首屏块是作品页数据 → 用户信息为空', pd3.getProfile(), null);

  // 3.4 只有 net（从作品页页内路由回主页时就是这种）
  const pd4 = loadPageData({ net: makeNet(HANDLE, CT_NEWEST), href: PROFILE_HREF });
  const p4 = pd4.getProfile();
  truthy('只有 net 也能出快照', p4);
  eq('只有 net 时账号名用地址里的', p4.uniqueId, HANDLE);
  eq('只有 net 时昵称为空（交给 DOM 兜底）', p4.nickname, '');
  eq('只有 net 时仍有最新时间', p4.latestCreateTime, CT_NEWEST);
  eq('只有 net 时来源标记', p4.source, 'net');

  // 3.5 ★非首批不算数（哪怕脏数据里带着时间）
  const pd5 = loadPageData({
    rehydration: makeUserDetail(HANDLE),
    net: makeNet(HANDLE, CT_NEWEST, false),
    href: PROFILE_HREF
  });
  eq('★非首批的 net 不提供日期', pd5.getProfile().latestCreateTime, 0);

  // 3.6 账号名对不上当前主页的 net 记录 → 也不给
  const pd6 = loadPageData({
    rehydration: makeUserDetail(HANDLE),
    net: makeNet('someone_else', CT_NEWEST),
    href: PROFILE_HREF
  });
  eq('别人的 net 记录不给日期', pd6.getProfile().latestCreateTime, 0);
}

/* ========================================================================== */
/* 四、等补位：首屏作品列表请求晚到时也要拿到                                    */
/* ========================================================================== */
section('四、等补位（ensureProfileFresh）');
{
  // 4.1 net 延迟 3 拍才出现
  const pd = loadPageData({
    rehydration: makeUserDetail(HANDLE),
    net: makeNet(HANDLE, CT_NEWEST),
    netDelay: 3,
    href: PROFILE_HREF
  });
  return pd.ensureProfileFresh(1200).then((snap) => {
    truthy('晚到的 net 也能等到', snap && snap.latestCreateTime === CT_NEWEST);

    // 4.2 一条作品都没有的账号：不等，立刻返回
    const pd0 = loadPageData({
      rehydration: makeUserDetail(HANDLE, { stats: { videoCount: 0 } }),
      href: PROFILE_HREF
    });
    const t0 = Date.now();
    return pd0.ensureProfileFresh(1200).then((s0) => {
      const cost = Date.now() - t0;
      eq('零作品账号拿得到用户信息', s0 && s0.uniqueId, HANDLE);
      eq('零作品账号没有日期', s0 && s0.latestCreateTime, 0);
      truthy('零作品账号不空等（<300ms）', cost < 300, '实际 ' + cost + 'ms');

      // 4.3 什么都没有（作品页地址）→ 直接 null，不卡住
      const pdWork = loadPageData({ href: PROFILE_HREF + '/video/7701427018554019092' });
      const t1 = Date.now();
      return pdWork.ensureProfileFresh(1200).then((s1) => {
        eq('非主页地址直接 null', s1, null);
        truthy('非主页地址不等待（<100ms）', Date.now() - t1 < 100);
        runExtractorTests();
      });
    });
  });
}

/* ========================================================================== */
/* 五、提取器：主页五个字段                                                     */
/* ========================================================================== */
function runExtractorTests() {
  section('五、提取器：主页字段取值');

  const profile = {
    id: USER_ID, uniqueId: HANDLE, nickname: 'kariina_choi',
    signature: 'тгк корина даргинка 05', secUid: 'MS4wLjABAAAA_test',
    createTime: 1767687887, verified: false, privateAccount: false,
    followerCount: 3978, followingCount: 108, heartCount: 245800, videoCount: 136,
    handle: HANDLE, latestCreateTime: CT_NEWEST, latestItemId: '7701427018554019092',
    source: 'rehydration+net'
  };

  const ex = loadExtractor({ profile: profile, href: PROFILE_HREF });
  eq('作者ID = 账号名（不是侧栏推荐用户的数字 ID）', ex.extractAuthorID(), HANDLE);
  eq('作者昵称 = 主页昵称', ex.extractAuthorName(), 'kariina_choi');
  eq('作者主页 = 规范主页地址', ex.extractAuthorHomepage(), 'https://www.tiktok.com/@' + HANDLE);
  eq('本页文案 = 主页简介', ex.extractPageText(), 'тгк корина даргинка 05');
  eq('发布日期 = 最新作品时间', ex.extractPublishDate(), fmt(CT_NEWEST));

  // 5.2 ★简介为空时不许回落 meta（主页的 og:description 是平台 SEO 话术）
  const exMeta = loadExtractor({
    profile: Object.assign({}, profile, { signature: '', latestCreateTime: 0 }),
    href: PROFILE_HREF,
    meta: 'TikTok 上的 kariina_choi (@kariina_choi) |245.8K 个赞。3978 个粉丝。тгк корина даргинка 05.',
    dom: { '[data-e2e="user-bio"]': '' }
  });
  eq('★简介为空 → 文案为空，不吃 SEO 描述', exMeta.extractPageText(), '');
  eq('★没有最新作品时间 → 日期为空，不拿账号创建时间凑', exMeta.extractPublishDate(), '');

  // 5.3 一手数据完全没有 → DOM 兜底
  const exDom = loadExtractor({
    profile: null,
    href: 'https://www.tiktok.com/@' + HANDLE + '?lang=ru-RU',
    dom: {
      '[data-e2e="user-title"]': 'kariina_choi',
      '[data-e2e="user-subtitle"]': HANDLE,
      '[data-e2e="user-bio"]': 'тгк корина даргинка 05'
    }
  });
  eq('兜底：作者ID 取地址里的账号名', exDom.extractAuthorID(), HANDLE);
  eq('兜底：作者昵称取 user-title', exDom.extractAuthorName(), 'kariina_choi');
  eq('兜底：文案取 user-bio', exDom.extractPageText(), 'тгк корина даргинка 05');
  eq('兜底：作者主页用账号名拼', exDom.extractAuthorHomepage(), 'https://www.tiktok.com/@' + HANDLE);
  eq('兜底：日期仍为空', exDom.extractPublishDate(), '');

  // 5.4 主页昵称是纯 emoji 之类（user-title 取到空）时不能变成空标题原料
  const exEmpty = loadExtractor({ profile: null, href: PROFILE_HREF, dom: {} });
  eq('兜底全空：作者昵称为空', exEmpty.extractAuthorName(), '');
  eq('兜底全空：文案为空', exEmpty.extractPageText(), '');

  // 5.5 回归：作品页行为不能被主页分支改坏
  const exWork = loadExtractor({
    profile: null,
    href: 'https://www.tiktok.com/@someone/video/7701427018554019092',
    dom: {}
  });
  exWork._tkIsProfile = () => false;
  exWork._tkItemCached = {
    id: '7701427018554019092', desc: '作品文案', createTime: CT_OLDER,
    nickname: '某人', uniqueId: 'someone', secUid: 'sec', authorId: '111'
  };
  eq('回归：作品页作者ID', exWork.extractAuthorID(), 'someone');
  eq('回归：作品页昵称', exWork.extractAuthorName(), '某人');
  eq('回归：作品页文案', exWork.extractPageText(), '作品文案');
  eq('回归：作品页日期', exWork.extractPublishDate(), fmt(CT_OLDER));
  eq('回归：作品页作者主页', exWork.extractAuthorHomepage(), 'https://www.tiktok.com/@someone');

  runUrlTests();
}

/* ========================================================================== */
/* 六、地址规范化                                                               */
/* ========================================================================== */
function runUrlTests() {
  section('六、地址规范化（tiktok）');
  const n = loadNormalizer();
  eq('裸主页', n.normalize('https://www.tiktok.com/@' + HANDLE), PROFILE_HREF);
  eq('主页带语言参数 → 去掉', n.normalize('https://www.tiktok.com/@' + HANDLE + '?lang=ru-RU'), PROFILE_HREF);
  eq('主页带来源参数 → 去掉',
    n.normalize('https://www.tiktok.com/@' + HANDLE + '?is_from_webapp=1&sender_device=pc'), PROFILE_HREF);
  eq('主页尾斜杠 → 去掉', n.normalize('https://www.tiktok.com/@' + HANDLE + '/'), PROFILE_HREF);
  eq('作品页规则不变',
    n.normalize('https://www.tiktok.com/@' + HANDLE + '/video/7701427018554019092?is_from_webapp=1'),
    'https://www.tiktok.com/@' + HANDLE + '/video/7701427018554019092');
  eq('图集页规则不变',
    n.normalize('https://www.tiktok.com/@' + HANDLE + '/photo/7701436809875639572?image_index=2'),
    'https://www.tiktok.com/@' + HANDLE + '/photo/7701436809875639572');

  runSpaTests();
}

/* ========================================================================== */
/* 七、换页判定                                                                 */
/* ========================================================================== */
function runSpaTests() {
  section('七、换页判定：作品页 ↔ 主页');
  const m = loadSpa({});
  eq('作品页 → item:<id>', m._tkRouteKeyFromHref(PROFILE_HREF + '/video/7701427018554019092'),
    'item:7701427018554019092');
  eq('图集页 → item:<id>', m._tkRouteKeyFromHref(PROFILE_HREF + '/photo/7701436809875639572?image_index=2'),
    'item:7701436809875639572');
  eq('主页 → profile:<账号名>', m._tkRouteKeyFromHref(PROFILE_HREF), 'profile:' + HANDLE);
  eq('主页带参数 → profile:<账号名>', m._tkRouteKeyFromHref(PROFILE_HREF + '?lang=ru-RU'), 'profile:' + HANDLE);
  eq('主页尾斜杠 → profile:<账号名>', m._tkRouteKeyFromHref(PROFILE_HREF + '/'), 'profile:' + HANDLE);
  // v2.5.97 起推荐流也算「一页」（`fyp`）。原来这里断言是空串，导致
  // 「作品页 → 退回推荐流」时 curKey 为空、`_checkTikTokRoute` 直接 return，
  // 浮窗带着上一条作品的数据赖在屏幕上。空串只留给真正的不可提取页。
  eq('推荐流 → fyp（v2.5.97 改）', m._tkRouteKeyFromHref('https://www.tiktok.com/foryou'), 'fyp');
  eq('搜索页仍不可提取', m._tkRouteKeyFromHref('https://www.tiktok.com/search?q=cat'), '');
  eq('两个主页不同账号 → 不同键',
    m._tkRouteKeyFromHref('https://www.tiktok.com/@a_user') !== m._tkRouteKeyFromHref(PROFILE_HREF),
    true);

  // 作品页 → 主页：必须判为「换了一页」（否则浮窗带着上一条作品的数据留在屏幕上）
  const m2 = loadSpa({ href: PROFILE_HREF });
  let closed = 0;
  m2.modalManager = { isOpen: true, close() { closed++; } };
  m2._tkLastHref = PROFILE_HREF + '/video/7701427018554019092';
  m2._checkTikTokRoute();
  eq('★作品页点作者名回主页 → 浮窗关闭', closed, 1);

  // 同一个主页刷新查询参数：不算换页
  const m3 = loadSpa({ href: PROFILE_HREF + '?lang=ru-RU' });
  let closed3 = 0;
  m3.modalManager = { isOpen: true, close() { closed3++; } };
  m3._tkLastHref = PROFILE_HREF;
  m3._checkTikTokRoute();
  eq('主页加语言参数不算换页', closed3, 0);

  // 图集翻图：不算换页
  const m4 = loadSpa({ href: PROFILE_HREF + '/photo/7701436809875639572?image_index=3' });
  let closed4 = 0;
  m4.modalManager = { isOpen: true, close() { closed4++; } };
  m4._tkLastHref = PROFILE_HREF + '/photo/7701436809875639572?image_index=1';
  m4._checkTikTokRoute();
  eq('图集翻图不算换页', closed4, 0);

  finish();
}

/* ========================================================================== */
function finish() {
  console.log('');
  const total = pass + fail;
  if (fail === 0) {
    console.log(`${C.green}全部通过：${pass}/${total}${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}失败 ${fail} 项，通过 ${pass}/${total}${C.reset}`);
    process.exit(1);
  }
}
