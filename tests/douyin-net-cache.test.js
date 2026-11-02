/**
 * 抖音「一手数据」链路（v2.5.90）
 *
 * 三个被测对象：
 *   ① 页面主世界捕获器 `src/content/douyin-net-hook.js`  —— URL 判定 / 三段响应结构归一 / 空值不覆盖
 *   ② 隔离世界读取器 `src/content/shared/douyin-net-cache.js` —— 精确命中 / 不串台 / 抖音号优先级
 *   ③ 详情页提取器 `src/content/extractors/douyin-social.js` —— 一手优先、拿不到回落 meta
 *
 * 为什么要这么细：这条链路一旦「看起来能用」但实际串台，浮窗会把别人的文案/抖音号贴到当前作品上，
 * 比拿不到更糟。所以把「不猜」「不串台」「空值不覆盖」都钉成用例。
 *
 * 反向验证（必须变红）：
 *   ① 把 `_authorIdFromNet()` 从 `_extractAuthorIdImpl` 里删掉 → 第七节第一条红（又回去抓主页）
 *   ② 把 `mergeRecord` 的空值保护改成直接覆盖 → 第九节「空 desc 不覆盖」红
 *   ③ 把 `DouyinNetCache.get` 的精确匹配改成「取最近一条」→ 第八节「不串台」红
 *   ④ 把 `_pageTextFromSource` 的 net 分支删掉只留 fiber → 第四节仍绿（fiber 兜底），
 *      但把 fiber 也删掉 → 第四节红（退回 118 字腰斩）
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
function truthy(name, got) {
  if (got) return ok(name);
  bad(name, `期望真值，实得 ${JSON.stringify(got)}`);
}
function falsy(name, got) {
  if (!got) return ok(name);
  bad(name, `期望假值，实得 ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }

/* -------------------------------------------------------------------------- */
/* 沙箱：加载捕获器（只需要拿到 ClipMateDouyinNetParser 那批纯函数）            */
/* -------------------------------------------------------------------------- */
function loadHookParser() {
  const src = read('src/content/douyin-net-hook.js');
  const win = {};
  win.self = win;
  win.window = win;
  const doc = {
    getElementById: () => null,
    createElement: () => ({}),
    head: null,
    documentElement: null
  };
  // 注意：IIFE 内部引用自由变量 XMLHttpRequest，Node 里不存在 → 被文件内的 try/catch 吞掉，符合预期
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'self', src)(win, doc, win);
  return win.ClipMateDouyinNetParser;
}

/* -------------------------------------------------------------------------- */
/* 沙箱：加载隔离世界读取器                                                     */
/* -------------------------------------------------------------------------- */
function loadCache(payload) {
  const src = read('src/content/shared/douyin-net-cache.js');
  const win = {};
  win.window = win;
  const doc = {
    getElementById: (id) => {
      if (id !== 'clipmate-douyin-net') return null;
      if (payload === null || payload === undefined) return null;
      return { textContent: typeof payload === 'string' ? payload : JSON.stringify(payload) };
    }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'module', src)(win, doc, undefined);
  return win.DouyinNetCache;
}

/* -------------------------------------------------------------------------- */
/* 沙箱：加载详情页提取器                                                       */
/* -------------------------------------------------------------------------- */
const WORK_ID = '7691912483476360482';
const PAGE_URL = 'https://www.douyin.com/video/' + WORK_ID;

function loadExtractor(opts) {
  const o = opts || {};
  const counts = { authorIdExtract: 0 };

  const win = {
    BaseExtractor: class BaseExtractor {
      constructor() { this.siteName = ''; }
      getCache() { return null; }
      setCache() {}
    },
    SocialDomUtils: { readMeta: (sel) => (sel.indexOf('description') >= 0 ? (o.meta || '') : '') },
    SocialFieldsBuilder: { build: async () => ({}) },
    SocialTitleProcessor: { generatePageTitle: () => '' },
    ClipMateLog: { debug() {}, warn() {}, info() {}, error() {} },
    DouyinNetCache: o.net,
    DouyinFiberClient: o.fiber,
    DouyinAwemeDate: o.date,
    DouyinModalContext: undefined,
    AuthorIdFetcher: {
      dedupe: (map, key, fn) => fn(),
      extract: async () => { counts.authorIdExtract++; return 'from_homepage_id'; }
    }
  };
  win.window = win;

  const doc = {
    querySelector: (sel) => {
      if (o.ldJson && sel.indexOf('ld+json') >= 0) {
        return { textContent: JSON.stringify(o.ldJson) };
      }
      return null;
    },
    // 回落老路（抓作者主页）需要页面上有作者链接，否则 _extractAuthorIdImpl 会直接返回空串
    querySelectorAll: (sel) => (String(sel).indexOf('/user/') >= 0
      ? [{ href: 'https://www.douyin.com/user/MS4wLjABAAAA_test' }]
      : []),
    body: { innerText: '' }
  };
  const loc = { href: o.href || PAGE_URL };

  const prelude =
    'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
    'ClipMateLog = window.ClipMateLog, DouyinNetCache = window.DouyinNetCache, ' +
    'DouyinFiberClient = window.DouyinFiberClient, DouyinAwemeDate = window.DouyinAwemeDate, ' +
    'DouyinModalContext = window.DouyinModalContext, AuthorIdFetcher = window.AuthorIdFetcher;\n';

  const src = read('src/content/extractors/douyin-social.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', 'location', prelude + src)(win, doc, console, loc);

  const Cls = win.DouyinSocialExtractor;
  if (!Cls) throw new Error('未定义 DouyinSocialExtractor');
  return { ex: new Cls(), counts };
}

/* -------------------------------------------------------------------------- */
/* 样本                                                                        */
/* -------------------------------------------------------------------------- */

// 真机原样（2026-10-28，v2.5.85 那批）：meta 里「截断文案 + SEO 尾巴」的完整形态
const REAL_META = '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈 - 小蜜蜂于20261024发布在抖音，已经收获了2.5万个喜欢，来抖音，记录美好生活！';
const REAL_META_WANT = '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈';

// 一手原文：真机 613 字那条（米雷 / 米雷-RayDog 作品）的形态，长度取 > 200 即可证明「不腰斩」
const LONG_DESC = '#原创动画 ' + '这是一段很长的原创动画文案，用来证明浮窗不再只拿到一百来字的残句。'.repeat(20) + ' #动画创作';

async function main() {
  /* ========================== 一、URL 判定 ========================== */
  section('一、捕获器只看这三类接口，别的一概不碰');
  const P = loadHookParser();
  truthy('单条详情 /aweme/v1/web/aweme/detail/', P.isTargetUrl('https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=1'));
  truthy('批量详情 /aweme/v1/web/multi/aweme/detail/', P.isTargetUrl('/aweme/v1/web/multi/aweme/detail/?aweme_ids=%5B1%5D'));
  truthy('推荐流 /aweme/v2/web/module/feed/', P.isTargetUrl('/aweme/v2/web/module/feed/?module_id=3003101'));
  falsy('评论区不碰', P.isTargetUrl('/aweme/v1/web/comment/list/?aweme_id=1'));
  falsy('弹幕不碰', P.isTargetUrl('/aweme/v1/web/danmaku/get_v2/?group_id=1'));
  falsy('用户设置不碰', P.isTargetUrl('/aweme/v1/web/user/settings/?x=1'));
  falsy('空值不碰', P.isTargetUrl(''));
  falsy('非字符串不碰', P.isTargetUrl(null));

  /* ====================== 二、三段响应结构归一 ====================== */
  section('二、三个接口的响应结构都能捞出作品');
  const one = { aweme_id: '7691912483476360482', desc: 'x', author: { nickname: 'n', unique_id: 'u1' } };
  eq('module/feed → aweme_list', P.collectAwemes({ aweme_list: [one] }).length, 1);
  eq('multi detail → aweme_details', P.collectAwemes({ aweme_details: [one, one] }).length, 2);
  eq('单条 detail → aweme_detail', P.collectAwemes({ aweme_detail: one }).length, 1);
  eq('无关响应 → 空数组', P.collectAwemes({ status_code: 0 }).length, 0);
  eq('null → 空数组', P.collectAwemes(null).length, 0);

  /* ====================== 三、字段兼容与校验 ====================== */
  section('三、字段 snake_case / camelCase 都认，非法 ID 一律丢');
  const snake = P.normalizeAweme({
    aweme_id: '7691912483476360482',
    desc: '文案',
    create_time: 1759450000,
    author: { nickname: '米雷-RayDog', unique_id: 'raydoglei', short_id: '12345', sec_uid: 'MS4wLj', uid: '99' }
  });
  eq('snake: awemeId', snake.awemeId, '7691912483476360482');
  eq('snake: createTime', snake.createTime, 1759450000);
  eq('snake: uniqueId', snake.uniqueId, 'raydoglei');
  eq('snake: shortId', snake.shortId, '12345');
  eq('snake: secUid', snake.secUid, 'MS4wLj');
  eq('snake: uid', snake.uid, '99');

  const camel = P.normalizeAweme({
    awemeId: '7691912483476360483',
    desc: '文案2',
    createTime: 1759450001,
    author: { nickname: '甲', uniqueId: 'jia01', shortId: '777' }
  });
  eq('camel: awemeId', camel.awemeId, '7691912483476360483');
  eq('camel: createTime', camel.createTime, 1759450001);
  eq('camel: uniqueId → uniqueId 同义', camel.uniqueId, 'jia01');

  eq('ID 太短 → 丢弃', P.normalizeAweme({ aweme_id: '123' }), null);
  eq('ID 含字母 → 丢弃', P.normalizeAweme({ aweme_id: 'abc123456' }), null);
  eq('无 ID → 丢弃', P.normalizeAweme({ desc: 'x' }), null);
  eq('null → 丢弃', P.normalizeAweme(null), null);

  const noUnique = P.normalizeAweme({ aweme_id: '7691912483476360484', author: { nickname: '乙', short_id: '888' } });
  eq('缺 unique_id → 空串（不是 undefined）', noUnique.uniqueId, '');
  eq('缺 unique_id 时 shortId 仍在', noUnique.shortId, '888');

  /* ==================== 四、空值不覆盖已有好数据 ==================== */
  section('四、后续接口给空值，不许把已有数据冲掉');
  const oldRec = {
    awemeId: '7691912483476360482', desc: '完整文案', createTime: 1759450000,
    nickname: '米雷-RayDog', uniqueId: 'raydoglei', shortId: '1', secUid: 'MS4wLj', uid: '99'
  };
  const blankRec = {
    awemeId: '7691912483476360482', desc: '', createTime: 0,
    nickname: '', uniqueId: '', shortId: '', secUid: '', uid: ''
  };

  // 全空 → 合并结果与旧值完全相同 → 返回 null，调用方跳过写盘（等于「什么都没变」，数据自然保住）
  eq('后续接口全给空值 → 判定为无变化（不覆盖、不写盘）', P.mergeRecord(oldRec, blankRec), null);

  // 半新半空：新值要采纳，空值要保住旧值
  const partial = P.mergeRecord(oldRec, Object.assign({}, blankRec, { nickname: '新昵称' }));
  eq('新昵称被采纳', partial.nickname, '新昵称');
  eq('空 desc 不被冲掉', partial.desc, '完整文案');
  eq('createTime=0 不被冲掉', partial.createTime, 1759450000);
  eq('空 uniqueId 不被冲掉', partial.uniqueId, 'raydoglei');

  eq('完全没变化 → 返回 null（不写盘）', P.mergeRecord(oldRec, Object.assign({}, oldRec)), null);
  eq('有新值 → 采用新值', P.mergeRecord(oldRec, Object.assign({}, oldRec, { desc: '新文案' })).desc, '新文案');
  eq('首次出现 → 原样返回记录', P.mergeRecord(null, oldRec).desc, '完整文案');

  /* ======================= 五、读取器：精确命中 ======================= */
  section('五、读取器：只认精确命中，绝不串台');
  const payload = {
    v: 1,
    items: {
      '7691912483476360482': { awemeId: '7691912483476360482', desc: '甲的文案', nickname: '甲', uniqueId: 'jia01', shortId: '' },
      '7691912483476360483': { awemeId: '7691912483476360483', desc: '乙的文案', nickname: '乙', uniqueId: '', shortId: '888' }
    }
  };
  const cache = loadCache(payload);
  eq('命中甲的文案', cache.descOf('7691912483476360482'), '甲的文案');
  eq('命中乙的文案', cache.descOf('7691912483476360483'), '乙的文案');
  eq('不存在的 ID → null（不拿最近一条顶替）', cache.get('7691912483476360499'), null);
  eq('不存在的 ID → 文案空串', cache.descOf('7691912483476360499'), '');
  eq('非法 ID → null', cache.get('abc'), null);
  eq('空 ID → null', cache.get(''), null);

  section('五之二、读取器：节点缺失 / JSON 坏了都要安全');
  eq('节点不存在 → null', loadCache(null).get('7691912483476360482'), null);
  eq('JSON 坏了 → null', loadCache('{坏掉的').get('7691912483476360482'), null);
  eq('items 缺失 → null', loadCache({ v: 1 }).get('7691912483476360482'), null);
  eq('节点不存在时 authorIdFor 空串', loadCache(null).authorIdFor('7691912483476360482'), '');

  section('五之三、抖音号：unique_id 优先，空则 short_id，都无效给空串');
  eq('unique_id 有值 → 用它', cache.authorIdFor('7691912483476360482'), 'jia01');
  eq('unique_id 空 → 退 short_id', cache.authorIdFor('7691912483476360483'), '888');
  eq('short_id 是 0 → 视为没有', cache.authorIdOf({ uniqueId: '', shortId: '0' }), '');
  eq('两者都空 → 空串', cache.authorIdOf({ uniqueId: '', shortId: '' }), '');
  eq('含中文的脏值 → 空串', cache.authorIdOf({ uniqueId: '雷子', shortId: '' }), '');
  eq('超 30 字 → 空串', cache.authorIdOf({ uniqueId: 'a'.repeat(31), shortId: '' }), '');
  eq('含点号下划线 → 通过', cache.authorIdOf({ uniqueId: 'dhy.dai_0503', shortId: '' }), 'dhy.dai_0503');
  eq('null → 空串', cache.authorIdOf(null), '');

  /* ===================== 六、提取器：文案一手优先 ===================== */
  section('六、本页文案：一手原文优先（不再腰斩到一百来字）');
  {
    const net = { descOf: (id) => (id === WORK_ID ? LONG_DESC : ''), nicknameOf: () => '', authorIdFor: () => '' };
    const { ex } = loadExtractor({ net, meta: REAL_META });
    const got = await ex.extractPageText();
    eq('长度 = 200 + ...（走截断规则）', got.length, 203);
    eq('前 200 字与一手原文逐字相同', got.slice(0, 200), LONG_DESC.slice(0, 200));
    eq('不含 SEO 尾巴', got.indexOf('发布在抖音') >= 0, false);
    eq('不含「已经收获了」', got.indexOf('已经收获了') >= 0, false);
  }
  {
    const net = { descOf: () => '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈', nicknameOf: () => '', authorIdFor: () => '' };
    const { ex } = loadExtractor({ net, meta: REAL_META });
    eq('一手文案短 → 原样输出，不加省略号', await ex.extractPageText(), '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈');
  }
  {
    // 一手拿不到（详情页直达的常态）→ 回落 meta，且尾巴照样削净
    const { ex } = loadExtractor({ meta: REAL_META });
    eq('无一手数据 → meta 兜底并削净尾巴', await ex.extractPageText(), REAL_META_WANT);
  }
  {
    // fiber 兜底：网络缓存空但 fiber 有 desc
    const fiber = { getMeta: async () => ({ awemeId: WORK_ID, desc: '来自 fiber 的完整文案', nickname: '米雷-RayDog' }) };
    const { ex } = loadExtractor({ fiber, meta: REAL_META });
    eq('net 空 → fiber 兜底', await ex.extractPageText(), '来自 fiber 的完整文案');
  }
  {
    // 一手 desc 是空串 → 不许把 meta 也顶掉
    const fiber = { getMeta: async () => ({ awemeId: WORK_ID, desc: '', nickname: '' }) };
    const { ex } = loadExtractor({ fiber, meta: REAL_META });
    eq('一手 desc 为空 → 仍然回落 meta', await ex.extractPageText(), REAL_META_WANT);
  }

  /* ======================== 七、提取器：昵称 ======================== */
  section('七、作者昵称：一手优先 → JSON-LD → 链接 → meta');
  {
    const net = { descOf: () => '', nicknameOf: () => '@米雷-RayDog认证徽章', authorIdFor: () => '' };
    const ldJson = { '@type': 'BreadcrumbList', itemListElement: [{ position: 2, name: 'JSON-LD 里的名字', item: 'https://www.douyin.com/user/MS4w' }] };
    const { ex } = loadExtractor({ net, ldJson });
    eq('一手昵称优先，并清掉 @ 与认证后缀', await ex.extractAuthorName(), '米雷-RayDog');
  }
  {
    const net = { descOf: () => '', nicknameOf: () => '', authorIdFor: () => '' };
    const fiber = { getMeta: async () => ({ awemeId: WORK_ID, nickname: 'fiber 名字', desc: '' }) };
    const ldJson = { '@type': 'BreadcrumbList', itemListElement: [{ position: 2, name: 'JSON-LD 里的名字' }] };
    const { ex } = loadExtractor({ net, fiber, ldJson });
    eq('一手没有 → fiber 顶上', await ex.extractAuthorName(), 'fiber 名字');
  }
  {
    const ldJson = { '@type': 'BreadcrumbList', itemListElement: [{ position: 2, name: 'JSON-LD 里的名字' }] };
    const { ex } = loadExtractor({ ldJson });
    eq('一手/fiber 都没有 → JSON-LD 兜底', await ex.extractAuthorName(), 'JSON-LD 里的名字');
  }

  section('七之二、昵称清洗规则必须与弹窗逐字同款（源码级对拍）');
  const grabClean = (src) => {
    const m = src.match(/_cleanNickname\(raw\) \{([\s\S]*?)\n  \}/);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  };
  const socialClean = grabClean(read('src/content/extractors/douyin-social.js'));
  const modalClean = grabClean(read('src/content/extractors/douyin-modal.js'));
  truthy('详情页侧存在 _cleanNickname', socialClean);
  truthy('弹窗侧存在 _cleanNickname', modalClean);
  eq('两处函数体逐字相同', socialClean, modalClean);

  /* ====================== 八、提取器：作者抖音号 ====================== */
  section('八、作者抖音号：一手命中就不许再抓主页（省 18~22 秒）');
  {
    const net = { descOf: () => '', nicknameOf: () => '', authorIdFor: () => 'raydoglei' };
    const { ex, counts } = loadExtractor({ net });
    eq('直接拿一手抖音号', await ex.extractAuthorId(), 'raydoglei');
    eq('没有走「打开作者主页」老路', counts.authorIdExtract, 0);
  }
  {
    const net = { descOf: () => '', nicknameOf: () => '', authorIdFor: () => '' };
    const { ex, counts } = loadExtractor({ net });
    eq('一手没有 → 回落老路（仍能拿到值）', await ex.extractAuthorId(), 'from_homepage_id');
    eq('回落时确实调用了 AuthorIdFetcher.extract', counts.authorIdExtract, 1);
  }
  {
    // 一手给的是脏值 → 不采信，仍然回落
    const net = { descOf: () => '', nicknameOf: () => '', authorIdFor: () => '雷子' };
    const { ex, counts } = loadExtractor({ net });
    eq('脏值不采信 → 回落老路', await ex.extractAuthorId(), 'from_homepage_id');
    eq('脏值情况下调用了老路', counts.authorIdExtract, 1);
  }
  {
    // 没有 DouyinNetCache（非抖音页面/脚本没加载）→ 整个功能等于不存在
    const { ex, counts } = loadExtractor({});
    eq('没有缓存模块也不炸，回落老路', await ex.extractAuthorId(), 'from_homepage_id');
    eq('确实走了老路', counts.authorIdExtract, 1);
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
