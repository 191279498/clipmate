/**
 * TikTok 一手数据链路（v2.5.94）
 *
 * 四个被测对象：
 *   ① 主世界扫描器 `src/content/tiktok-fiber-hook.js` —— 地址取 ID / 命中规则 / 归一化 / 环状不死循环
 *   ② 隔离世界读取器 `src/content/shared/tiktok-page-data.js` —— ID 闸口 / 两路优先级 / 补位等待
 *   ③ 作品页提取器 `src/content/extractors/tiktok-social.js` —— 一手优先、拿不到回落 DOM
 *   ④ 换条跟随 `src/content/ui/tiktok-spa-handler.js` —— 换条才动、缓存键跟着换、浮窗就地刷新
 *
 * 最要紧的一条：**ID 对不上就是别人的数据**。
 * 切到下一条之后，首屏那块 `__UNIVERSAL_DATA_FOR_REHYDRATION__` 不会更新（2026-10-29 真机实证），
 * 如果这道闸口漏了，浮窗会把上一条的文案/日期贴到当前这条上 —— 比取不到更糟。
 * 所以第三节、第四节里带 ★ 的用例是本次的重点。
 *
 * 反向验证（必须变红）：
 *   ① 把 `readRehydration` 里的 ID 闸口删掉 → 第三节第 3 条（切条后旧数据）红
 *   ② 把 `readBridge` 里的 urlId 校验删掉 → 第四节第 2 条红
 *   ③ 把 `getCurrent` 的优先级改成 rehydration 优先 → 第五节第 1 条红（切条后变回老数据）
 *   ④ 把提取器 `extractPublishDate` 的一手分支删掉 → 第八节第 5 条红（日期又空了）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m', yellow: '\x1b[33m'
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

const WORK_A = '7699845904471231765';   // 首屏那条（切走前的）
const WORK_B = '7696920492015504661';   // 切过去的那条
const TS_B = 1792078958;                // 真机实测：2026/10/15 23:42:38（本地时区）

/* -------------------------------------------------------------------------- */
/* 沙箱：主世界扫描器（只取纯函数；顺手把定时器钉死成空转，免得 Node 不退）      */
/* -------------------------------------------------------------------------- */
function loadHookParser() {
  const src = read('src/content/tiktok-fiber-hook.js');
  const win = { addEventListener() {} };
  win.self = win;
  win.window = win;
  win.location = { href: 'https://www.tiktok.com/@kariina_choi/video/' + WORK_A };
  const doc = {
    getElementById: () => null,
    createElement: () => ({}),
    head: null,
    documentElement: null,
    querySelectorAll: () => []
  };
  const si = global.setInterval;
  const st = global.setTimeout;
  global.setInterval = function () { return 0; };
  global.setTimeout = function () { return 0; };
  try {
    // MutationObserver 传 undefined → 脚本里 typeof 判断为 'undefined'，自动跳过
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'self', 'location', 'MutationObserver', src)(
      win, doc, win, win.location, undefined
    );
  } finally {
    global.setInterval = si;
    global.setTimeout = st;
  }
  return win.ClipMateTiktokFiberParser;
}

/* -------------------------------------------------------------------------- */
/* 沙箱：隔离世界读取器（桥节点 / 首屏数据块 都由这里给）                        */
/* -------------------------------------------------------------------------- */
function loadPageData(o) {
  const opt = o || {};
  const src = read('src/content/shared/tiktok-page-data.js');
  const win = { window: null };
  win.window = win;
  win.location = { href: opt.href || ('https://www.tiktok.com/@kariina_choi/video/' + WORK_B) };

  const stats = { bridgeReads: 0, rehydrationReads: 0, attrSeq: [] };
  const doc = {
    getElementById: (id) => {
      if (id === 'clipmate-tiktok-fiber') {
        stats.bridgeReads++;
        // 模拟「补位等待」：前 N 次还没有，之后才有
        if (opt.bridgeDelay && stats.bridgeReads < opt.bridgeDelay) return null;
        const b = opt.bridge;
        if (!b) return null;
        return { textContent: JSON.stringify(b) };
      }
      if (id === '__UNIVERSAL_DATA_FOR_REHYDRATION__') {
        stats.rehydrationReads++;
        const r = opt.rehydration;
        if (!r) return null;
        return { textContent: typeof r === 'string' ? r : JSON.stringify(r) };
      }
      return null;
    },
    documentElement: {
      getAttribute: () => opt._attr,
      setAttribute: (k, v) => { opt._attr = v; stats.attrSeq.push(v); }
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'module', src)(win, doc, win.location, undefined);
  win.TiktokPageData._stats = stats;
  return win.TiktokPageData;
}

/** 造一份首屏数据块（webapp.video-detail 键名带点，是实测结构） */
function makeRehydration(id, extra) {
  return {
    __DEFAULT_SCOPE__: {
      'webapp.video-detail': {
        itemInfo: {
          itemStruct: Object.assign({
            id: id,
            desc: 'first screen desc',
            createTime: 1791000000,
            author: { id: '7592161536783123477', uniqueId: 'kariina_choi', nickname: 'Kariina', secUid: 'MS4wLjABAAAA_test' }
          }, extra || {})
        }
      }
    }
  };
}

/** 造一份主世界桥节点内容 */
function makeBridge(urlId, id, extra) {
  return {
    v: 1, urlId: urlId, id: id, ts: Date.now(),
    data: Object.assign({
      id: id, desc: 'switched desc', createTime: TS_B,
      nickname: 'Kariina', uniqueId: 'kariina_choi', secUid: 'MS4wLjABAAAA_test', authorId: '7592161536783123477'
    }, extra || {})
  };
}

/* -------------------------------------------------------------------------- */
/* 沙箱：提取器                                                                 */
/* -------------------------------------------------------------------------- */
function loadExtractor(o) {
  const opt = o || {};
  const src = read('src/content/extractors/tiktok-social.js');
  const win = {
    BaseExtractor: class BaseExtractor { constructor() { this.siteName = ''; } },
    SocialDomUtils: { readMeta: () => opt.meta || '' },
    SocialFieldsBuilder: { build: async () => ({ built: true }) },
    SocialTitleProcessor: { generatePageTitle: () => '' },
    ClipMateLog: { debug() {}, info() {}, warn() {}, error() {} },
    TiktokPageData: opt.pageData || null
  };
  win.window = win;
  win.location = {
    href: opt.href || ('https://www.tiktok.com/@url_guess/video/' + WORK_B)
  };
  const doc = {
    querySelector: (sel) => {
      if (opt.domDesc && String(sel).indexOf('video-desc') >= 0) return { textContent: opt.domDesc };
      if (opt.ldJson && String(sel).indexOf('ld+json') >= 0) return { textContent: JSON.stringify(opt.ldJson) };
      if (opt.creatorInfo && String(sel).indexOf('DivCreatorInfoContainer') >= 0) {
        return { querySelectorAll: () => opt.creatorInfo.map((t) => ({ textContent: t })) };
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (opt.authorLinks && String(sel).indexOf('/@') >= 0) {
        return opt.authorLinks.map((h) => ({ getAttribute: () => h }));
      }
      return [];
    }
  };
  // extends BaseExtractor 走的是词法作用域，拿不到 window，只能前置声明成局部变量
  // （与 douyin-net-cache.test.js 同一个写法）
  const prelude =
    'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
    'ClipMateLog = window.ClipMateLog, TiktokPageData = window.TiktokPageData;\n';

  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', 'location', 'module', prelude + src)(
    win, doc, console, win.location, undefined
  );
  const ex = new win.TikTokSocialExtractor();
  ex._tkItemCached = opt.item || null;
  return ex;
}

/* -------------------------------------------------------------------------- */
/* 沙箱：换条跟随                                                               */
/* -------------------------------------------------------------------------- */
function loadSpa(o) {
  const opt = o || {};
  const src = read('src/content/ui/tiktok-spa-handler.js');
  const win = { window: null, addEventListener() {} };
  win.window = win;
  win.location = { hostname: opt.hostname || 'www.tiktok.com', href: opt.href };
  win.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };
  win.TiktokPageData = opt.pageData || null;
  // eslint-disable-next-line no-new-func
  new Function('window', 'location', 'setInterval', 'clearInterval', 'TiktokPageData', src)(
    win, win.location, () => 42, () => {}, opt.pageData || null
  );
  const host = {
    modalManager: opt.modalManager || { isOpen: false, updateInPlace: async () => { host._updated = true; } },
    generateCacheKey: (href) => 'k:' + href,
    extractFromCurrentPage: async () => opt.extracted || null,
    _updated: false
  };
  Object.assign(host, win.TikTokSpaMixin);
  host.location = win.location;   // 测试用例要靠它改地址
  return host;
}

/* ========================================================================== */
async function main() {

  /* ============================== 一、主世界纯函数 ============================== */
  section('一、主世界扫描器：地址取 ID 与命中规则');
  const P = loadHookParser();
  truthy('解析器导出来了', !!P);
  eq('作品页地址取 ID', P.urlItemId('https://www.tiktok.com/@kariina_choi/video/' + WORK_B), WORK_B);
  eq('带查询参数也能取', P.urlItemId('https://www.tiktok.com/@a/video/' + WORK_B + '?is_copy_url=1'), WORK_B);
  eq('推荐页没有作品 ID', P.urlItemId('https://www.tiktok.com/foryou'), '');
  eq('ID 太短不认', P.urlItemId('https://www.tiktok.com/@a/video/123'), '');
  eq('空值不炸', P.urlItemId(undefined), '');

  // v2.5.95：图集页是 /photo/<id>。改之前这里算出空 ID → checkUrl 直接 return，
  // 图集页一手数据完全拿不到（只能回落 DOM）。真机实测 URL：
  //   https://www.tiktok.com/@kariina_choi/photo/7701436809875639572?image_index=2
  eq('★ 图集页地址取 ID', P.urlItemId('https://www.tiktok.com/@kariina_choi/photo/' + WORK_B), WORK_B);
  eq('★ 图集页带 image_index 也能取', P.urlItemId('https://www.tiktok.com/@a/photo/' + WORK_B + '?image_index=3'), WORK_B);
  eq('图集页 ID 太短不认', P.urlItemId('https://www.tiktok.com/@a/photo/123'), '');

  truthy('ID 对得上 + 有 video → 命中', P.isItemStruct({ id: WORK_B, video: { duration: 9 } }, WORK_B));
  truthy('ID 对得上 + 图集 → 命中', P.isItemStruct({ id: WORK_B, imagePost: { images: [] } }, WORK_B));
  truthy('ID 对得上 + 有作者 → 命中', P.isItemStruct({ id: WORK_B, author: { id: '1' } }, WORK_B));
  falsy('ID 对不上 → 不命中（别人的数据）', P.isItemStruct({ id: WORK_A, video: {} }, WORK_B));
  falsy('只有 id 的空壳不算', P.isItemStruct({ id: WORK_B }, WORK_B));
  falsy('非对象不算', P.isItemStruct(null, WORK_B));

  const wrapped = { memoizedState: { itemInfo: { itemStruct: { id: WORK_B, author: {}, stats: {} } } } };
  eq('三层嵌套里能挖出来', P.findItem(wrapped, WORK_B, 0) && P.findItem(wrapped, WORK_B, 0).id, WORK_B);
  eq('找不到就返回 null', P.findItem({ a: { b: { id: WORK_A, video: {} } } }, WORK_B, 0), null);

  const cyc = { id: WORK_A, video: {} };
  cyc.self = cyc;               // 环状：不能死循环
  const t0 = Date.now();
  const cycRes = P.findItem(cyc, WORK_B, Date.now() + 200);
  const cost = Date.now() - t0;
  eq('环状结构不死循环', cycRes, null);
  truthy(`环状搜索耗时可控（${cost}ms）`, cost < 500);

  const nItem = P.normalizeItem({
    id: WORK_B, desc: 'hello', createTime: TS_B,
    author: { id: '7592161536783123477', uniqueId: 'kariina_choi', nickname: 'Kariina', secUid: 'MS4w_test' },
    video: { duration: 12 }
  });
  eq('归一化：作品 ID', nItem.id, WORK_B);
  eq('归一化：文案', nItem.desc, 'hello');
  eq('归一化：时间戳', nItem.createTime, TS_B);
  eq('归一化：账号名', nItem.uniqueId, 'kariina_choi');
  eq('归一化：昵称', nItem.nickname, 'Kariina');
  eq('归一化：时长', nItem.duration, 12);
  eq('归一化：ID 非法 → null', P.normalizeItem({ id: 'abc' }), null);
  eq('归一化：缺作者不炸', P.normalizeItem({ id: WORK_B }).nickname, '');

  // v2.5.95 图集页形态：author 是**字符串**（本身就是 TikTok 号），
  // 作者信息平铺在 item 上。真机实证：只认对象形态时这四项全空。
  const pItem = P.normalizeItem({
    id: WORK_B, createTime: TS_B,
    author: 'kariina_choi',
    nickname: 'Kariina', authorId: '7592161536783123477', authorSecId: 'MS4w_photo',
    contents: [{ desc: '图集文案' }]
  });
  eq('★ 图集形态：账号名（author 字符串本身就是号）', pItem.uniqueId, 'kariina_choi');
  eq('★ 图集形态：昵称', pItem.nickname, 'Kariina');
  eq('★ 图集形态：SecUID', pItem.secUid, 'MS4w_photo');
  eq('★ 图集形态：作者 UID', pItem.authorId, '7592161536783123477');
  eq('★ 图集形态：文案从 contents[0] 兜底', pItem.desc, '图集文案');
  eq('★ 图集形态：作者 UID 不串成作品 ID', pItem.authorId !== WORK_B, true);

  // 图集形态也可能自带顶层 desc，不能被 contents 覆盖
  const pItem2 = P.normalizeItem({ id: WORK_B, desc: '顶层文案', contents: [{ desc: '不该用这个' }] });
  eq('图集形态：顶层 desc 优先', pItem2.desc, '顶层文案');

  /* ============================== 二、隔离世界纯函数 ============================== */
  section('二、隔离世界读取器：纯函数');
  const D = loadPageData({});
  eq('地址取 ID', D.urlItemId('https://www.tiktok.com/@a/video/' + WORK_B), WORK_B);
  eq('★ 图集页地址取 ID', D.urlItemId('https://www.tiktok.com/@a/photo/' + WORK_B), WORK_B);
  eq('★ 图集翻第几张图不影响取 ID', D.urlItemId('https://www.tiktok.com/@a/photo/' + WORK_B + '?image_index=7'), WORK_B);
  eq('秒级时间戳 → 日期字符串', D.formatTimestamp(TS_B), '2026/10/15 23:42:38');
  eq('0 → 空串（不许编 1970）', D.formatTimestamp(0), '');
  eq('负数 → 空串', D.formatTimestamp(-5), '');
  eq('非法 → 空串', D.formatTimestamp('abc'), '');
  const nn = D.normalize({ id: WORK_B, desc: 'x', createTime: TS_B, author: { uniqueId: 'u', nickname: 'n' } });
  eq('归一化：账号名', nn.uniqueId, 'u');
  eq('归一化：ID 非法 → null', D.normalize({ id: 'zz' }), null);

  /* ============================== 三、首屏数据块的 ID 闸口 ============================== */
  section('三、首屏数据块：只有对得上号才敢用（★ 切条后不误用旧数据）');
  {
    const d = loadPageData({ rehydration: makeRehydration(WORK_B) });
    const item = d.readRehydration(WORK_B);
    truthy('ID 一致 → 采信', !!item);
    eq('来源标记', item && item.source, 'rehydration');
    eq('时间戳带过来', item && item.createTime, 1791000000);
  }
  {
    // ★ 切条后：首屏那块还是老的那条，地址已经是新的
    const d = loadPageData({ rehydration: makeRehydration(WORK_A) });
    eq('★ ID 不一致 → 一律弃用', d.readRehydration(WORK_B), null);
  }
  {
    const d = loadPageData({});
    eq('没有这块数据 → null', d.readRehydration(WORK_B), null);
  }
  {
    const d = loadPageData({ rehydration: '{坏 JSON' });
    eq('JSON 坏了不炸 → null', d.readRehydration(WORK_B), null);
  }
  {
    const d = loadPageData({ rehydration: { __DEFAULT_SCOPE__: { 'webapp.other': {} } } });
    eq('不是作品页结构 → null', d.readRehydration(WORK_B), null);
  }

  /* ============================== 四、主世界桥节点 ============================== */
  section('四、主世界桥节点：对不上号就当没看见');
  {
    const d = loadPageData({ bridge: makeBridge(WORK_B, WORK_B) });
    const item = d.readBridge(WORK_B);
    truthy('urlId 一致 → 采信', !!item);
    eq('来源标记', item && item.source, 'fiber');
    eq('切条后的时间戳', item && item.createTime, TS_B);

    // v2.5.94 真机实证：桥节点是**扁平**结构（作者字段直接摊在 item 上，没有 author 嵌套）。
    // 早期实现只在 item.author.* 里找，结果昵称/号/SecUID/UID 全空 —— 这里钉死。
    eq('★ 扁平结构也能取到昵称', item && item.nickname, 'Kariina');
    eq('★ 扁平结构也能取到 TikTok 号', item && item.uniqueId, 'kariina_choi');
    eq('★ 扁平结构也能取到 SecUID', item && item.secUid, 'MS4wLjABAAAA_test');
    eq('★ 扁平结构也能取到作者 UID', item && item.authorId, '7592161536783123477');
    eq('★ 作者 UID 绝不能串成作品 ID', item && item.authorId, '7592161536783123477');
    eq('desc 照常', item && item.desc, 'switched desc');
  }
  {
    // 嵌套结构（首屏 itemStruct 的形态）必须照旧能用
    const nested = {
      v: 1, urlId: WORK_B, id: WORK_B, ts: Date.now(),
      data: {
        id: WORK_B, desc: 'nested desc', createTime: TS_B,
        author: { id: '7592161536783123477', uniqueId: 'nested_user', nickname: 'Nested', secUid: 'MS4w_nested' }
      }
    };
    const d = loadPageData({ bridge: nested });
    const item = d.readBridge(WORK_B);
    eq('★ 嵌套结构取昵称', item && item.nickname, 'Nested');
    eq('★ 嵌套结构取 TikTok 号', item && item.uniqueId, 'nested_user');
    eq('★ 嵌套结构取 SecUID', item && item.secUid, 'MS4w_nested');
    eq('★ 嵌套结构取作者 UID', item && item.authorId, '7592161536783123477');
  }
  {
    const d = loadPageData({ bridge: makeBridge(WORK_A, WORK_A) });
    eq('★ 桥上还是上一条 → 弃用', d.readBridge(WORK_B), null);
  }
  {
    const d = loadPageData({ bridge: makeBridge(WORK_B, WORK_A) });
    eq('urlId 与 data.id 自相矛盾 → 弃用', d.readBridge(WORK_B), null);
  }
  {
    const d = loadPageData({});
    eq('桥还没建 → null', d.readBridge(WORK_B), null);
  }

  /* ============================== 五、两路优先级 ============================== */
  section('五、综合取数：切条后以主世界为准');
  {
    // 首屏是旧的、桥是新的 —— 必须取新的
    const d = loadPageData({ rehydration: makeRehydration(WORK_A), bridge: makeBridge(WORK_B, WORK_B) });
    const item = d.getCurrent();
    eq('★ 取主世界那条', item && item.id, WORK_B);
    eq('来源标记', item && item.source, 'fiber');
  }
  {
    // 两条路都指向同一条（刚打开作品页、主世界也扫完了）→ 以主世界为准。
    // 这条是「优先级」真正的判据：光靠 ID 闸口区分不出先后，
    // 因为首屏那块在切条后根本不更新，主世界扫出来的才是当前这条。
    const d = loadPageData({ rehydration: makeRehydration(WORK_B), bridge: makeBridge(WORK_B, WORK_B) });
    eq('★ 两路都对得上 → 仍以主世界为准', d.getCurrent().source, 'fiber');
  }
  {
    // 桥没有（主世界没扫到）→ 首屏对得上号也能用
    const d = loadPageData({ rehydration: makeRehydration(WORK_B) });
    const item = d.getCurrent();
    eq('桥没有时退回首屏', item && item.source, 'rehydration');
  }
  {
    // 两路都是旧的 —— 宁可返回 null
    const d = loadPageData({ rehydration: makeRehydration(WORK_A), bridge: makeBridge(WORK_A, WORK_A) });
    eq('★ 两路都对不上 → null（不串台）', d.getCurrent(), null);
  }

  /* ============================== 六、补位等待 ============================== */
  section('六、补位等待：切换后新数据不是立刻就绪');
  {
    // 前 3 次读桥都是空的，之后才有 —— 应该等到
    const d = loadPageData({ bridgeDelay: 3, bridge: makeBridge(WORK_B, WORK_B), rehydration: makeRehydration(WORK_A) });
    const item = await d.ensureFresh(2000);
    eq('★ 等到了当前这条', item && item.id, WORK_B);
    eq('来源是主世界', item && item.source, 'fiber');
    truthy(`确实轮询了多次（${d._stats.bridgeReads} 次）`, d._stats.bridgeReads >= 3);
  }
  {
    // 主世界一直扫不到 → 超时后退回首屏（仍然要过 ID 闸口）
    const d = loadPageData({ rehydration: makeRehydration(WORK_B) });
    const item = await d.ensureFresh(200);
    eq('扫不到 → 退回首屏', item && item.source, 'rehydration');
  }
  {
    // 主世界扫不到，首屏还是旧的 → 不能拿旧数据充数
    const d = loadPageData({ rehydration: makeRehydration(WORK_A) });
    const item = await d.ensureFresh(200);
    eq('★ 扫不到且首屏是旧的 → null', item, null);
  }
  {
    // 已经拿到过就立刻返回，不再等
    const d = loadPageData({ bridge: makeBridge(WORK_B, WORK_B) });
    const first = await d.ensureFresh(2000);
    const readsBefore = d._stats.bridgeReads;
    const second = await d.ensureFresh(2000);
    eq('第二次直接走缓存', d._stats.bridgeReads, readsBefore);
    eq('两次结果一致', JSON.stringify(first), JSON.stringify(second));
  }

  /* ============================== 七、催主世界重扫 ============================== */
  section('七、催扫：在 <html> 上打标记');
  {
    const d = loadPageData({});
    d.requestScan();
    d.requestScan();
    eq('标记递增（主世界靠变化触发）', JSON.stringify(d._stats.attrSeq), JSON.stringify(['1', '2']));
  }

  /* ============================== 八、提取器：一手优先 ============================== */
  section('八、提取器：一手数据优先，取不到回落屏幕文字');
  {
    const ex = loadExtractor({ item: { id: WORK_B, desc: 'switched desc', createTime: TS_B, uniqueId: 'kariina_choi', nickname: 'Kariina' } });
    eq('账号名取一手的', ex.extractAuthorID(), 'kariina_choi');
    eq('昵称取一手的', ex.extractAuthorName(), 'Kariina');
    eq('文案取一手的', ex.extractPageText(), 'switched desc');
    eq('日期取一手的（精确到秒）', ex.extractPublishDate(), '2026/10/15 23:42:38');
    eq('主页用账号名拼', ex.extractAuthorHomepage(), 'https://www.tiktok.com/@kariina_choi');
  }
  {
    // 一手没有账号名 → 回落到原来的「从网址猜」
    const ex = loadExtractor({ item: { id: WORK_B, nickname: 'Kariina' }, authorLinks: ['/@url_guess/video/1'] });
    eq('一手没账号名 → 回落网址', ex.extractAuthorID(), 'url_guess');
  }
  {
    // 一手没有文案 → **返回空**，交给 SocialFieldsBuilder 兜底填「TikTok视频」。
    // v2.5.99 起不再回落屏幕文字：屏幕上那段可能是自动字幕/翻译，meta 更是平台 SEO 话术
    // （实测文案被污染的两次事故都出在这一档）。真机实证 2026-10-29：
    // /@168cherry_jp/video/7698980327007505684 一手 desc 为空 → 文案栏 = TikTok视频。
    // v2.5.100 校正：这条断言原来写的是「回落 DOM」，属于 v2.5.99 漏改的过期断言（生产代码没动）。
    const ex = loadExtractor({ item: { id: WORK_B }, domDesc: '屏幕上的文案' });
    eq('一手没文案 → 返回空（不拿屏幕文字充数，交给兜底站名）', ex.extractPageText(), '');
  }
  {
    // 一手没有时间 → 回落原来的日期解析（页面上写「2022-9-1」那种）
    const ex = loadExtractor({ item: { id: WORK_B }, creatorInfo: ['昵称 · 2022-9-1'] });
    eq('一手没时间 → 回落旧解析', ex.extractPublishDate(), '2022/09/01');
  }
  {
    // 完全没有一手数据（脚本没加载 / 不是作品页）：行为与 v2.5.93 完全一致
    const ex = loadExtractor({ domDesc: '屏幕文案', creatorInfo: ['昵称 · 4-15'], authorLinks: ['/@url_guess/video/1'] });
    eq('没有一手模块也不炸：文案', ex.extractPageText(), '屏幕文案');
    eq('没有一手模块也不炸：账号名', ex.extractAuthorID(), 'url_guess');
    const y = new Date().getFullYear();
    eq('没有一手模块也不炸：日期', ex.extractPublishDate(), y + '/04/15');
  }

  /* ============================== 九、提取前的预热 ============================== */
  section('九、extractAllFields 会先预热一手数据');
  {
    let calls = 0;
    const pageData = { ensureFresh: async () => { calls++; return { id: WORK_B }; } };
    const ex = loadExtractor({ pageData });
    const out = await ex.extractAllFields();
    eq('预热被调用了一次', calls, 1);
    truthy('字段照常产出', out && out.built === true);
  }
  {
    const ex = loadExtractor({});
    const out = await ex.extractAllFields();
    truthy('没有一手模块也能跑完', out && out.built === true);
  }

  /* ============================== 十、换条跟随 ============================== */
  section('十、换条跟随：只在真的换了一条时才动');
  {
    // stub 要跟真实模块一个口径：/video/ 和 /photo/ 都认
    const pageData = { urlItemId: (h) => (String(h).match(/\/(?:video|photo)\/(\d{6,25})/) || [])[1] || '', requestScan: () => { calls++; }, invalidate: () => { inv.push(1); } };
    let calls = 0; const inv = [];
    const host = loadSpa({
      href: 'https://www.tiktok.com/@a/video/' + WORK_A,
      pageData,
      modalManager: {
        isOpen: true,
        close: () => { closed++; host._closed = true; },
        updateInPlace: async () => { host._updated = true; }
      },
      extracted: { 本页文案: 'new one' }
    });
    let closed = 0;
    host._tkLastHref = 'https://www.tiktok.com/@a/video/' + WORK_A;
    host.cacheKey = 'old-key';
    host._checkTikTokRoute();     // 地址没变
    eq('地址没变 → 缓存键不动', host.cacheKey, 'old-key');
    eq('地址没变 → 不催扫', calls, 0);
    eq('地址没变 → 不关窗', closed, 0);

    host.location.href = 'https://www.tiktok.com/@a/video/' + WORK_B;
    host._checkTikTokRoute();     // 换了一条
    truthy('换条后缓存键重算', host.cacheKey !== 'old-key');
    eq('换条后催主世界重扫', calls, 1);
    eq('换条后丢掉上一条的缓存', inv.length, 1);
    await new Promise((r) => setTimeout(r, 20));
    // v2.5.95 用户拍板：换条就关浮窗（原来是把浮窗就地刷成新的那条）
    eq('★ 换条 + 浮窗开着 → 关掉', closed, 1);
    truthy('★ 关了就不再就地刷新', host._updated !== true);
  }
  {
    const pageData = { urlItemId: (h) => (String(h).match(/\/(?:video|photo)\/(\d{6,25})/) || [])[1] || '', requestScan: () => {}, invalidate: () => {} };
    let closed = 0;
    const host = loadSpa({
      href: 'https://www.tiktok.com/@a/video/' + WORK_A,
      pageData,
      modalManager: {
        isOpen: false,
        close: () => { closed++; },
        updateInPlace: async () => { host._updated = true; }
      }
    });
    host._tkLastHref = 'https://www.tiktok.com/@a/video/' + WORK_A;
    host.location.href = 'https://www.tiktok.com/@a/video/' + WORK_B;
    host._checkTikTokRoute();
    await new Promise((r) => setTimeout(r, 20));
    eq('浮窗没开 → 不用关', closed, 0);
    falsy('浮窗没开 → 不刷新', host._updated === true);
  }
  {
    // v2.5.95 图集页：翻第几张图只改 ?image_index=，作品 ID 不变 → 不算换条
    const pageData = { urlItemId: (h) => (String(h).match(/\/(?:video|photo)\/(\d{6,25})/) || [])[1] || '', requestScan: () => { calls++; }, invalidate: () => {} };
    let calls = 0; let closed = 0;
    const host = loadSpa({
      href: 'https://www.tiktok.com/@a/photo/' + WORK_A + '?image_index=1',
      pageData,
      modalManager: { isOpen: true, close: () => { closed++; } }
    });
    host._tkLastHref = 'https://www.tiktok.com/@a/photo/' + WORK_A + '?image_index=1';
    host.cacheKey = 'old-key';
    host.location.href = 'https://www.tiktok.com/@a/photo/' + WORK_A + '?image_index=5';
    host._checkTikTokRoute();
    eq('★ 图集翻图 → 缓存键不动', host.cacheKey, 'old-key');
    eq('★ 图集翻图 → 不催扫', calls, 0);
    eq('★ 图集翻图 → 不关窗', closed, 0);
  }
  {
    // 图集页换到另一条图集作品：path 里的 ID 变了 → 算换条
    const pageData = { urlItemId: (h) => (String(h).match(/\/(?:video|photo)\/(\d{6,25})/) || [])[1] || '', requestScan: () => { calls++; }, invalidate: () => {} };
    let calls = 0; let closed = 0;
    const host = loadSpa({
      href: 'https://www.tiktok.com/@a/photo/' + WORK_A,
      pageData,
      modalManager: { isOpen: true, close: () => { closed++; } }
    });
    host._tkLastHref = 'https://www.tiktok.com/@a/photo/' + WORK_A;
    host.location.href = 'https://www.tiktok.com/@a/photo/' + WORK_B;
    host._checkTikTokRoute();
    eq('★ 图集换条 → 催主世界重扫', calls, 1);
    eq('★ 图集换条 → 关掉浮窗', closed, 1);
  }
  {
    const host = loadSpa({ hostname: 'www.douyin.com', href: 'https://www.douyin.com/video/123' });
    falsy('非 TikTok 域名 → 不启动', host._startTikTokSpa());
    falsy('也没有定时器', !!host._tkTimer);
  }
  {
    const host = loadSpa({ href: 'https://www.tiktok.com/@a/video/' + WORK_A });
    truthy('TikTok 域名 → 启动', host._startTikTokSpa());
    truthy('定时器挂上了', !!host._tkTimer);
  }

  /* ============================== 汇总 ============================== */
  console.log('');
  if (fail === 0) {
    console.log(`${C.green}通过 ${pass} 项，失败 0 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}通过 ${pass} 项，失败 ${fail} 项${C.reset}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${C.red}测试自身出错：${C.reset}`, e);
  process.exit(1);
});
