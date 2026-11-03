/**
 * 微博个人主页提取器（v2.7.26）—— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = **页头粉丝链接里的 uid**；昵称 = **页头**那个 `_name_`（不是列表里的作者名）
 *   C. 账号名 = 地址栏的自定义域名（`/u/<数字>` 入口留空）
 *   D. 网址 = `https://weibo.com/u/<uid>`（官方形态，从任何入口进来都同一串）
 *   E. 简介 = 统计行（粉丝 + 微博数）+ 个性签名 + 认证说明 + 概况（访问量/生日/注册时间/公司）+ 外链
 *   F. 数字**照页面原样**（`1.58亿` 不许换算成精确值）
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   1. **`$CONFIG` 里是登录者自己**，源码里不许出现 —— 这是本项目第五次踩这个坑
 *      （小红书 `userInfo`、快手 `/rest/v/profile/get`、IG `PolarisViewer`、快手 v2.7.10）。
 *      真机实测：`weibo.com/u/2803301701`（人民日报）页面上 `$CONFIG.uid` = 1647019414
 *      （登录者本人）、`$CONFIG.user.followers_count` = 188（登录者自己的粉丝数）。
 *   2. 页面主人 uid **只能**从 `a[href*="/u/page/follow/"]` 取。微博的作用是把这条链接
 *      当成「看这个人的粉丝」，指向的必然是页面主人；微博列表里的作者链接可能是转发的人。
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge）
 *   `weibo.com/u/2803301701` 人民日报：1.58亿粉丝 / 3096关注 / 40.05亿转评赞 /
 *     访问量 28万+ / 全部微博（154798）/ 简介「《人民日报》法人微博」/
 *     desc_text「《人民日报》法人微博」、description「人民日报法人微博。参与、沟通、记录时代。」/
 *     生日 1948-06-15 双子座 / 注册 2012-07-22 02:28:35 / 公司 人民日报社 /
 *     外链 [{title:'人民网', url:'http://t.cn/hoXD3'}]
 *   `weibo.com/renminribao` 屁屁卓：841粉丝 / 6865 条 / 简介「微醺  天涯何必梦醒」/
 *     desc_text 为空、description 才有值 / 生日 1985-06-24 巨蟹座 / 无外链
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function truthy(name, cond, detail) { if (cond) ok(name); else bad(name, detail); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}
function section(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

/** 剥掉注释再断言源码（注释里写着「不许出现 xxx」，不剥就会被自己命中） */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ 真机样本 ============================ */

const UID = '2803301701';
const OTHER_UID = '1256479540';
const BASE_URL = 'https://weibo.com/u/' + UID;

/** 页面主人详情（接口原样） */
function detailData(o) {
  const opt = o || {};
  return {
    ok: 1,
    data: {
      desc_text: opt.descText === undefined ? '《人民日报》法人微博' : opt.descText,
      description: opt.desc === undefined
        ? '人民日报法人微博。参与、沟通、记录时代。' : opt.desc,
      birthday: opt.birthday === undefined ? '1948-06-15 双子座' : opt.birthday,
      created_at: opt.createdAt === undefined ? '2012-07-22 02:28:35' : opt.createdAt,
      company: opt.company === undefined ? '人民日报社' : opt.company,
      career: { company: opt.company === undefined ? '人民日报社' : opt.company },
      cnt_desc: opt.cntDesc === undefined ? '访问量 28万+' : opt.cntDesc,
      links: opt.links === undefined ? [{ title: '人民网', url: 'http://t.cn/hoXD3' }] : opt.links
    }
  };
}

/**
 * 页面 HTML —— 结构照真机（2026-10-31 `weibo.com/u/2803301701` 实拍）
 *
 * ⚠️ 两处刻意保留的真机细节：
 *   ① 微博列表里还有一条作者名（`_name_ygi5b_120`，另一个 CSS module 哈希段）。
 *      全页 `[class*="_name_"]` 会命中它 —— 昵称必须取页头那个。
 *   ② 简介元素是 `_descText_`，**只在页头出现**，是定位页头的最好锚点之一。
 */
function pageHtml(o) {
  const opt = o || {};
  const fans = opt.fans === undefined ? '1.58亿' : opt.fans;
  const posts = opt.posts === undefined ? '154798' : opt.posts;
  const name = opt.name === undefined ? '人民日报' : opt.name;
  const visits = opt.visits === undefined ? '访问量 28万+' : opt.visits;
  const descText = opt.descTextDom === undefined ? '《人民日报》法人微博' : opt.descTextDom;
  const anchorUid = opt.anchorUid === undefined ? UID : opt.anchorUid;

  const fansBlock = fans == null ? '' :
    `<a class="_none_ _alink_ _pointer_" href="/u/page/follow/${anchorUid}?relate=fans">
       <span class="_h5_"><span>${fans}</span>粉丝 </span></a>`;
  const followBlock = opt.follow === false ? '' :
    `<a class="_none_ _alink_ _pointer_" href="/u/page/follow/${anchorUid}?relate=">
       <span class="_h5_"><span>3096</span>关注 </span></a>`;
  const postsBlock = posts == null ? '' : `<div class="_tab_">全部微博（${posts}）</div>`;
  const visitsBlock = visits == null ? '' : `<div class="_visits_1yc79_452">${visits}</div>`;
  const descBlock = descText == null ? '' : `<div class="_descText_1yc79_322">${descText}</div>`;

  return `<!doctype html><html><head><title>${name}的个人主页</title></head><body>
  <div class="woo-box-flex _box1_1yc79_55">
    <div class="_avatar2_1yc79_58"><img src="a.jpg"></div>
    <div class="woo-box-item-flex">
      <div class="_h3_1yc79_78"><div class="_name_1yc79_291">${name}</div></div>
      <div class="_h4_1yc79_82">${fansBlock}${followBlock}</div>
      ${descBlock}
    </div>
  </div>
  ${visitsBlock}
  ${postsBlock}
  <div class="woo-box-flex _item_ygi5b_1"><div class="_cut_ygi5b_97 _name_ygi5b_120">某个转发的人</div></div>
  <script>window.$CONFIG = {"uid":1647019414,"user":{"id":1647019414,"screen_name":"汲汲而生V","followers_count":188}};</script>
  </body></html>`;
}

/** 造一个带 mock fetch 的页面 */
function makePage(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html || pageHtml(), {
    url: opt.url || BASE_URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.__fetchCalls = [];

  const mock = opt.fetch || (() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(detailData(opt.detail))
  }));

  w.fetch = (u, init) => {
    w.__fetchCalls.push(String(u));
    try {
      return Promise.resolve(mock(String(u), init));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  w.eval(fs.readFileSync(P('src/content/extractors/base-extractor.js'), 'utf8'));
  w.eval(fs.readFileSync(P('src/content/extractors/weibo-profile.js'), 'utf8'));
  // 装配入口用的（v2.7.29 补测：没有 PersonFieldsBuilder 就测不出 extractAllFields 是否在）
  w.eval(fs.readFileSync(P('src/content/shared/person-fields-builder.js'), 'utf8'));
  return w;
}

/** 跑一遍 6 个字段 */
async function extract(w) {
  const ex = new w.WeiboProfileExtractor();
  return {
    '平台': await Promise.resolve(ex.extractPlatform ? ex.extractPlatform() : ex.platformName),
    '昵称': await ex.extractName(),
    '账号ID': await ex.extractAccountId(),
    '账号名': await ex.extractAccountName(),
    '网址': await ex.extractUrl(),
    '简介': await ex.extractBio()
  };
}

const HAS_JSDOM = (() => { try { require.resolve('jsdom'); return true; } catch (e) { return false; } })();

(async () => {
if (!HAS_JSDOM) {
  console.log('缺少 jsdom，无法运行（需要 NODE_PATH 指向 node_modules）');
  process.exit(1);
}

/* ==================== 1. 六列与字段口径 ==================== */
section('1. 六列与字段口径（人民日报）');

{
  const w = makePage();
  const r = await extract(w);
  eq('输出恰好 6 列', Object.keys(r), ['平台', '昵称', '账号ID', '账号名', '网址', '简介']);
  eq('平台 = 微博', r['平台'], '微博');
  eq('昵称取页头那个（不是列表里的「某个转发的人」）', r['昵称'], '人民日报');
  eq('账号ID = 页头粉丝链接里的 uid', r['账号ID'], UID);
  eq('`/u/<数字>` 入口 → 账号名为空', r['账号名'], '');
  eq('网址 = https://weibo.com/u/<uid>', r['网址'], 'https://weibo.com/u/' + UID);
}

/* ==================== 2. 简介排版 ==================== */
section('2. 简介：统计行 / 签名 / 认证说明 / 概况 / 外链');

{
  const w = makePage();
  const r = await extract(w);
  const lines = String(r['简介'] || '').split('\n');
  eq('统计行只要粉丝 + 微博数（不要关注/转评赞）', lines[0], '粉丝：1.58亿 · 微博：154798');
  eq('第 2 行是个性签名（description）', lines[1], '人民日报法人微博。参与、沟通、记录时代。');
  eq('第 3 行是认证说明（desc_text）', lines[2], '《人民日报》法人微博');
  eq('第 4 行访问量（剥掉「访问量」前缀）', lines[3], '访问量：28万+');
  eq('第 5 行生日（照接口原样，带星座）', lines[4], '生日：1948-06-15 双子座');
  eq('第 6 行注册时间', lines[5], '注册时间：2012-07-22 02:28:35');
  eq('第 7 行公司', lines[6], '公司：人民日报社');
  eq('第 8 行外链（t.cn 短链带标题）', lines[7], '人民网：http://t.cn/hoXD3');
  eq('不能有第 9 行', lines.length, 8);
  eq('粉丝数照页面原样（1.58亿，不换算）', /1\.58亿/.test(lines[0]), true);
}

/* ==================== 3. 个人号：只有一个签名、没有外链 ==================== */
section('3. 个人号（屁屁卓）：desc_text 为空、无外链');

{
  const w = makePage({
    html: pageHtml({
      name: '屁屁卓', fans: '841', posts: '6865', visits: '访问量 1.2万+',
      descTextDom: '微醺  天涯何必梦醒', anchorUid: OTHER_UID
    }),
    url: 'https://weibo.com/u/' + OTHER_UID,
    detail: {
      descText: '', desc: '微醺  天涯何必梦醒', links: [],
      birthday: '1985-06-24 巨蟹座', createdAt: '2010-03-04 00:14:13', company: ''
    }
  });
  const r = await extract(w);
  const lines = String(r['简介'] || '').split('\n');
  eq('账号ID 是页面主人（不是登录者 1647019414）', r['账号ID'], OTHER_UID);
  eq('统计行', lines[0], '粉丝：841 · 微博：6865');
  eq('desc_text 为空时正文只有一行签名', lines[1], '微醺 天涯何必梦醒');
  eq('没有公司那一行', /^公司：/m.test(String(r['简介'] || '')), false);
  eq('没有外链残留', /t\.cn/.test(String(r['简介'] || '')), false);
}

/* ==================== 4. 正文两个都有：重复要去重 ==================== */
section('4. 签名与认证说明相同 / 不同时的处理');

{
  // 两者完全相同 → 只留一行
  const w = makePage({
    detail: { descText: '一样的简介', desc: '一样的简介', links: [] }
  });
  const r = await extract(w);
  const hits = String(r['简介'] || '').split('\n').filter((l) => l === '一样的简介');
  eq('签名与认证说明相同时只留一行', hits.length, 1);
}

{
  // 只有 desc_text（认证号没填个性签名）
  const w = makePage({ detail: { descText: '《某某报》法人微博', desc: '', links: [] } });
  const r = await extract(w);
  truthy('只有认证说明时也放进去',
    String(r['简介'] || '').indexOf('《某某报》法人微博') > -1, r['简介']);
}

/* ==================== 5. 账号名：自定义域名 ==================== */
section('5. 账号名：自定义域名入口');

{
  const w = makePage({
    url: 'https://weibo.com/renminribao',
    html: pageHtml()
  });
  const r = await extract(w);
  eq('自定义域名入口 → 账号名 = 域名', r['账号名'], 'renminribao');
  eq('网址仍按 uid 拼（不用域名）', r['网址'], 'https://weibo.com/u/' + UID);
}

{
  // 一级功能路由不许当成用户名
  const cases = ['hot', 'tv', 'login', 'search', 'detail', 'ajax', 'u', 'n', 'profile'];
  const w = makePage({ url: 'https://weibo.com/hot', html: pageHtml() });
  const ex = new w.WeiboProfileExtractor();
  const bad = cases.filter((c) => {
    w.history.replaceState({}, '', 'https://weibo.com/' + c);
    return ex._urlCustomDomain() !== '';
  });
  eq('功能路由（hot/tv/login/search/detail/ajax/u/n/profile）都不当账号名', bad, []);
}

/* ==================== 6. 接口：只请求一次、失败降级 ==================== */
section('6. 详情接口：一次请求 / 失败降级');

{
  const w = makePage();
  const r = await extract(w);
  eq('只请求一次详情接口', w.__fetchCalls.length, 1);
  eq('请求的地址用页面主人 uid（不是登录者）',
    w.__fetchCalls[0], '/ajax/profile/detail?uid=' + UID);
  truthy('拿到链接后简介里有外链', String(r['简介'] || '').indexOf('hoXD3') > -1);
}

{
  // 接口失败 → 统计行/签名/访问量还在，概况与外链为空，不许抛错
  const w = makePage({
    fetch: () => Promise.reject(new Error('network down'))
  });
  const r = await extract(w);
  eq('接口失败不影响账号ID', r['账号ID'], UID);
  const lines = String(r['简介'] || '').split('\n');
  eq('接口失败时第 1 行仍是统计行', lines[0], '粉丝：1.58亿 · 微博：154798');
  eq('接口失败时正文退回页面显示的 descText', lines[1], '《人民日报》法人微博');
  eq('接口失败时不留「生日：」半截', /生日/.test(String(r['简介'] || '')), false);
  eq('接口失败时不留「外链」半截', /t\.cn/.test(String(r['简介'] || '')), false);
  truthy('接口失败时访问量仍从 DOM 拿到',
    lines.indexOf('访问量：28万+') > -1, lines);
}

{
  // 接口返回 ok:0 → 当失败处理
  const w = makePage({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: 0 }) }) });
  const r = await extract(w);
  eq('接口 ok:0 → 概况行全空', /生日/.test(String(r['简介'] || '')), false);
}

/* ==================== 7. 防串台：$CONFIG 是登录者 ==================== */
section('7. 防串台：`$CONFIG` 是登录者，碰不得');

{
  const w = makePage();
  const r = await extract(w);
  eq('页面里 $CONFIG.uid 是登录者 1647019414，但账号ID 必须是页面主人',
    r['账号ID'] === '1647019414', false);
  eq('账号ID 就是页面主人', r['账号ID'], UID);

  // 页面主人与登录者不同时，粉丝数也不能串（$CONFIG.user.followers_count = 188）
  eq('粉丝数用页面的 1.58亿，不是 $CONFIG 里的 188',
    /188/.test(String(r['简介'] || '')), false);
}

{
  // 页头粉丝链接指向别人（页内跳转没切完）→ 以页面渲染的为准，且请求也用这个 uid
  const w = makePage({ html: pageHtml({ anchorUid: OTHER_UID }) });
  const r = await extract(w);
  eq('账号ID 跟页头链接走（页面渲染的是谁就是谁）', r['账号ID'], OTHER_UID);
  eq('请求的 uid 也跟着走', w.__fetchCalls[0], '/ajax/profile/detail?uid=' + OTHER_UID);
}

/* ==================== 8. 缺数据时不许瞎填 ==================== */
section('8. 缺数据：留空，不许瞎填');

{
  // 页头没渲染出来、也没有粉丝链接 → 账号ID 退回地址栏的 /u/<数字>
  const w = makePage({ html: pageHtml({ anchorUid: '' }) });
  const r = await extract(w);
  eq('页头缺失时账号ID 退回地址栏', r['账号ID'], UID);
}

{
  // 自定义域名入口 + 页头没渲染 → 拿不到 uid 就留空，绝不拿域名顶替
  const w = makePage({ url: 'https://weibo.com/renminribao', html: pageHtml({ anchorUid: '' }) });
  const r = await extract(w);
  eq('自定义域名拿不到 uid → 账号ID 留空（不拿域名顶替）', r['账号ID'], '');
  eq('网址退回自定义域名形态', r['网址'], 'https://weibo.com/renminribao');
}

{
  // 微博数缺失 → 统计行只剩粉丝
  const w = makePage({ html: pageHtml({ posts: null }) });
  const r = await extract(w);
  eq('微博数缺失时统计行只有粉丝', String(r['简介'] || '').split('\n')[0], '粉丝：1.58亿');
}

{
  // 粉丝数缺失 → 统计行只剩微博
  const w = makePage({ html: pageHtml({ fans: null }) });
  const r = await extract(w);
  eq('粉丝数缺失时统计行只有微博', String(r['简介'] || '').split('\n')[0], '微博：154798');
}

/* ==================== 9. 源码纪律 ==================== */
section('9. 源码纪律');

{
  const src = stripComments(fs.readFileSync(P('src/content/extractors/weibo-profile.js'), 'utf8'));
  eq('绝不许碰 $CONFIG（那里是登录者自己）', /\$CONFIG/.test(src), false);
  eq('绝不许读 $CONFIG.user', /CONFIG\s*\.\s*user/.test(src), false);
  truthy('账号ID 只从页头粉丝链接取', /u\/page\/follow/.test(src));
  truthy('有分两段超时（等头 5000 / 读体 5000）',
    /arm\(5000\)/.test(src) && (src.match(/arm\(5000\)/g) || []).length >= 2);
  truthy('失败要 console.warn 留痕', /console\.warn/.test(src));
  eq('不许打 m.weibo.cn 的接口', /m\.weibo\.cn/.test(src), false);
}

/* ==================== 10. 四条路由配置同口径 ==================== */
section('10. 路由：person 必须排在通配 social 之前');

{
  const det = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
  const bg = fs.readFileSync(P('src/background/background.js'), 'utf8');
  const fac = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');

  // media-detector 两份配置逐字一致
  const grab = (s) => {
    const i = s.indexOf("'www.weibo.com': {");
    const j = s.indexOf("'m.weibo.cn': {", i);
    return i > -1 && j > i ? s.slice(i, j) : '';
  };
  const detSeg = grab(det);
  const bgSeg = grab(bg);
  truthy('两份配置都找得到微博块', detSeg.length > 100 && bgSeg.length > 100,
    { det: detSeg.length, bg: bgSeg.length });
  truthy('person 正则逐字一致',
    detSeg.indexOf("^/u/\\\\d{5,20}/?$") > -1 && bgSeg.indexOf("^/u/\\\\d{5,20}/?$") > -1);

  const detU = detSeg.indexOf("type: 'person', regex: '^/u/");
  const detS = detSeg.indexOf("type: 'social', patterns: ['/']");
  truthy('media-detector：person 在 social 之前', detU > -1 && detS > -1 && detU < detS,
    { detU, detS });
  const bgU = bgSeg.indexOf("type: 'person', regex: '^/u/");
  const bgS = bgSeg.indexOf("type: 'social', patterns: ['/']");
  truthy('background：person 在 social 之前', bgU > -1 && bgS > -1 && bgU < bgS, { bgU, bgS });

  // 工厂：person 的 urlPattern 必须排在通配 `weibo.com/` 之前
  const facP = fac.indexOf("hostname: 'www.weibo.com', mediaType: 'person'");
  const facS = fac.indexOf("hostname: 'www.weibo.com', mediaType: 'social'");
  truthy('工厂：person 规则在 social 之前', facP > -1 && facS > -1 && facP < facS,
    { facP, facS });
  truthy('工厂注册了 WeiboProfileExtractor', /className: 'WeiboProfileExtractor'/.test(fac));
  truthy('工厂注册了 person 类型', /WeiboProfileExtractor[\s\S]{0,200}types: \['person'\]/.test(fac));

  // 弹窗持久化：person 兜底必须排在 `weibo.com/` → social 之前
  const persist = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
  const pP = persist.indexOf("if (url.includes('weibo.com/')) {");
  const pS = persist.indexOf('// 社交媒体类型 - 微博');
  truthy('弹窗持久化里 `weibo.com/` 被覆盖检查', persist.indexOf('if (url.includes(\'weibo.com/\')) {') > -1);
  truthy('弹窗持久化：person 兜底排在 social 之前', pP > -1 && pS > -1 && pP < pS,
    { pP, pS });

  // manifest 注册了脚本
  const mf = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  const files = mf.content_scripts.reduce((a, c) => a.concat(c.js || []), []);
  truthy('manifest 注册了 weibo-profile.js',
    files.indexOf('src/content/extractors/weibo-profile.js') > -1);
  eq('weibo-profile.js 只注册一次',
    files.filter((f) => f === 'src/content/extractors/weibo-profile.js').length, 1);
}

/* ==================== 11. URL 归一化 ==================== */
section('11. URL 归一化');

{
  const w = makePage();
  const ex = new w.WeiboProfileExtractor();
  // url-normalizer 是独立文件，这里用 jsdom 跑它
  const norm = new JSDOM('<!doctype html><html><body></body></html>',
    { url: 'https://weibo.com/', runScripts: 'outside-only' }).window;
  norm.eval(fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8'));

  const fn = norm.ClipMateUrlNormalizer || norm.UrlNormalizer || norm.urlNormalizer;
  if (!fn || typeof fn.normalize !== 'function') {
    truthy('url-normalizer 暴露 normalize 入口', false,
      Object.keys(norm).filter((k) => /normal|Url/i.test(k)).join(','));
  } else {
    eq('主页 /u/<数字> 归一',
      fn.normalize('https://weibo.com/u/2803301701?is_all=1'),
      'https://weibo.com/u/2803301701');
    eq('自定义域名归一（去来源参数）',
      fn.normalize('https://weibo.com/renminribao?from=page'),
      'https://weibo.com/renminribao');
    eq('单条微博仍归一',
      fn.normalize('https://weibo.com/2803301701/RCabcdefg'),
      'https://weibo.com/2803301701/RCabcdefg');
  }
}

/* ==================== Z. 装配入口（v2.7.29 补：真机踩过的空浮窗） ==================== */
section('Z. 装配入口 extractAllFields（缺了就是 6 个空行）');
{
  const w = makePage();
  const ex = new w.WeiboProfileExtractor();
  truthy('有 extractAllFields 方法', typeof ex.extractAllFields === 'function',
    '没有入口方法 → 主流程调用会失败，浮窗渲染 6 个空行');
  if (typeof ex.extractAllFields === 'function') {
    const all = await ex.extractAllFields();
    const keys = Object.keys(all || {}).filter((k) => k !== 'mediaType' && k !== 'personKind' && k !== 'sourceSite');
    eq('装配后恰好 6 列（顺序固定）', keys, ['平台', '昵称', '账号ID', '账号名', '网址', '简介']);
    eq('元字段标记为 person / account', [all && all.mediaType, all && all.personKind], ['person', 'account']);
    const direct = await extract(makePage());
    const six = {};
    keys.forEach((k) => { six[k] = all[k]; });
    eq('装配值与六个分字段逐一一致', six, direct);
    truthy('装配后没有空列（平台/昵称/账号ID/网址都非空）',
      !!(all && all['平台'] && all['昵称'] && all['账号ID'] && all['网址']), all);
  }
}

/* ==================== 收尾 ==================== */
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail) {
  console.log('失败项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('全部通过：' + pass + ' 项');
})();
