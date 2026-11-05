/**
 * B站个人空间提取器（v2.7.28）—— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = 空间 mid（地址栏数字）；账号名 = 昵称（用户 2026-10-31 拍板）
 *   C. **页面原样铁律**：统计用 DOM 的 `1887.7万`，绝不用 title 属性里的精确值 `18,877,239`
 *   D. 简介只有两段：统计行 + 个人签名（认证/性别/会员一律不进）
 *   E. 网址从任何 tab 子页进来都归一成 `https://space.bilibili.com/<mid>`
 *   F. **公告不是签名**：`.pure-text` 有两个，必须限定在 `.sign` 里取
 *   G. **零请求**：不允许出现 fetch / XHR / `__INITIAL_STATE__`
 *
 * 取样来源：2026-10-31 真机（接管用户 Edge，space.bilibili.com/946974 影视飓风，未登录态）
 *   昵称 影视飓风 / 签名「无限进步！｜商务合作请联系邮箱：bd@ysjf.com（邮件中麻烦备注公司、
 *   咨询内容）｜店铺名：影视飓风」/ 关注 687 / 粉丝 1887.7万（title 里是 18,877,239）/
 *   认证「bilibili个人认证：2025百大UP主、2023年度最高人气奖UP主、课堂优质讲师」/
 *   公告「影视飓风视频团队致力于用最佳的视频质量…」（在 .ann-section__content 里）
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

/* ============================ 真机样本 ============================ */

const MID = '946974';
const NAME = '影视飓风';
const SIGN = '无限进步！｜商务合作请联系邮箱：bd@ysjf.com（邮件中麻烦备注公司、咨询内容）｜店铺名：影视飓风';
const FANS_TEXT = '1887.7万';
const FANS_EXACT = '18,877,239'; // title 属性里的精确值——碰它就是违规
const FOLLOW_TEXT = '687';
const ANN = '影视飓风视频团队致力于用最佳的视频质量来与观众分享最为前沿、有趣的科技产品体验。';

/**
 * 造一份 B站空间页（结构照抄真机 DOM 层级）。
 * opt:
 *   followers / following  传 null 就删掉那一整块 item
 *   noStats                整个 nav-statistics 不渲染
 *   noSign                 签名块不渲染
 *   signTextIsEmpty        innerText 为空、只有 title（测 title 兜底）
 *   withAnn                是否带公告块（默认带，用来验证它不会串进签名）
 */
function pageHtml(o) {
  const opt = o || {};
  const numTitle = (v) => (opt.numTitle === false ? '' : ` title="${v}"`);
  const stats = opt.noStats ? '' : `
    <div class="nav-bar space-navbar"><div class="nav-bar__main"><div class="nav-bar__main-right">
      <div class="nav-statistics">
        ${opt.following === null ? '' : `<div class="nav-statistics__item jumpable"${numTitle(FOLLOW_TEXT)}>
          <span class="nav-statistics__item-text">关注数</span>
          <span class="nav-statistics__item-num"${numTitle(FOLLOW_TEXT)}>${FOLLOW_TEXT}</span>
        </div>`}
        ${opt.followers === null ? '' : `<div class="nav-statistics__item jumpable"${numTitle(FANS_EXACT)}>
          <span class="nav-statistics__item-text">粉丝数</span>
          <span class="nav-statistics__item-num"${numTitle(FANS_EXACT)}>${FANS_TEXT}</span>
        </div>`}
      </div>
    </div></div></div>`;

  const sign = opt.noSign ? '' : `
      <div class="upinfo-detail__bottom">
        <div class="sign header-sign"><div class="pure-text" title="${SIGN}">${opt.signTextIsEmpty ? '' : SIGN}</div></div>
      </div>`;

  return `<!doctype html><html><head>
  <title>${NAME}的个人空间-${NAME}个人主页-哔哩哔哩视频</title>
  <meta name="description" content="哔哩哔哩${NAME}的个人空间，提供${NAME}分享的视频、音频、文章、动态、收藏等内容，关注${NAME}账号，第一时间了解UP主动态。${SIGN}">
  </head><body>
  <div class="upinfo header-upinfo"><div class="upinfo__main"><div class="upinfo-detail">
    <div class="upinfo-detail__top">
      <div class="nickname">${opt.name === null ? '' : (opt.name || NAME)}</div>
      <div class="fans-medal"><div class="bili-fans-medal">飓风18</div></div>
      <div class="gender"><i class="vui_icon sic-BDC-male_line"></i></div>
    </div>${sign}
  </div></div></div>
  ${stats}
  ${opt.withAnn === false ? '' : `<div class="ann-section__content"><div class="pure-text">${ANN}</div></div>`}
  <div class="auth-section"><div class="auth-info auth-show--1">
    <div class="auth-title">bilibili个人认证：2025百大UP主、2023年度最高人气奖UP主、课堂优质讲师</div>
  </div></div>
  </body></html>`;
}

/** 造一个带页面的环境（fetch 桩一律 reject：本提取器绝不许发请求） */
function makePage(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html || pageHtml(opt), {
    url: opt.url || 'https://space.bilibili.com/' + MID,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.__fetchCalls = [];
  w.fetch = (u) => { w.__fetchCalls.push(String(u)); return Promise.reject(new Error('no-fetch-allowed')); };

  w.eval(fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8'));
  w.eval(fs.readFileSync(P('src/content/extractors/base-extractor.js'), 'utf8'));
  w.eval(fs.readFileSync(P('src/content/extractors/bilibili-profile.js'), 'utf8'));
  // 装配入口用的（v2.7.29 补测）
  w.eval(fs.readFileSync(P('src/content/shared/person-fields-builder.js'), 'utf8'));
  return w;
}

/** 跑一遍 6 个字段 */
async function extract(w) {
  const ex = new w.BilibiliProfileExtractor();
  return {
    '平台': await ex.extractPlatform(),
    '昵称': await ex.extractName(),
    '账号ID': await ex.extractAccountId(),
    '账号名': await ex.extractAccountName(),
    '网址': await ex.extractUrl(),
    '简介': await ex.extractBio()
  };
}

/* ============================ 断言 ============================ */

(async () => {

  /* ==================== 1. 六列与字段口径 ==================== */
  section('1. 六列与字段口径（影视飓风）');
  {
    const r = await extract(makePage());
    eq('平台', r['平台'], '哔哩哔哩');
    eq('昵称', r['昵称'], NAME);
    eq('账号ID = 空间 mid', r['账号ID'], MID);
    eq('账号名 = 昵称（用户拍板）', r['账号名'], NAME);
    eq('网址 = 官方形态', r['网址'], 'https://space.bilibili.com/' + MID);

    const lines = String(r['简介'] || '').split('\n');
    eq('简介行数（统计行 + 签名）', lines.length, 2);
    eq('统计行粉丝在前', lines[0], '粉丝：' + FANS_TEXT + ' · 关注：' + FOLLOW_TEXT);
    eq('签名全文', lines[1], SIGN);
  }

  /* ==================== 2. 页面原样铁律：精确值不许露出来 ==================== */
  section('2. 页面原样：不碰 title 里的精确值');
  {
    const w = makePage();
    const r = await extract(w);
    truthy('精确粉丝值 18,877,239 不出现', String(r['简介']).indexOf(FANS_EXACT) === -1, r['简介']);
    truthy('用的是页面写法 1887.7万', String(r['简介']).indexOf(FANS_TEXT) > -1, r['简介']);
  }

  /* ==================== 3. 公告不是签名 ==================== */
  section('3. `.pure-text` 有两个：公告不许串进签名');
  {
    const r = await extract(makePage());
    truthy('简介里没有公告内容', String(r['简介']).indexOf('致力于用最佳的视频质量') === -1, r['简介']);
    truthy('简介里也没有认证内容', String(r['简介']).indexOf('百大UP主') === -1, r['简介']);
    truthy('简介里没有性别/会员', String(r['简介']).indexOf('性别') === -1, r['简介']);
  }

  /* ==================== 4. tab 子页入口 ==================== */
  section('4. 空间 tab 子页入口');
  {
    for (const sub of ['dynamic', 'upload', 'lists', 'pugv', 'video']) {
      const r = await extract(makePage({ url: 'https://space.bilibili.com/' + MID + '/' + sub }));
      eq('/' + sub + ' 子页账号ID 不受影响', r['账号ID'], MID);
      eq('/' + sub + ' 子页网址归一到主页', r['网址'], 'https://space.bilibili.com/' + MID);
    }
    const withQuery = await extract(makePage({ url: 'https://space.bilibili.com/' + MID + '/video?tid=0' }));
    eq('带查询串也归一', withQuery['网址'], 'https://space.bilibili.com/' + MID);
  }

  /* ==================== 5. 拿不到就留空，不许瞎编 ==================== */
  section('5. 缺失容忍');
  {
    const noPid = await extract(makePage({ url: 'https://space.bilibili.com/' }));
    eq('根路径没有 mid → 账号ID 留空', noPid['账号ID'], '');
    eq('根路径没有 mid → 网址留空', noPid['网址'], '');

    const noStats = await extract(makePage({ noStats: true }));
    eq('统计全无 → 简介只剩签名', noStats['简介'], SIGN);

    const noSign = await extract(makePage({ noSign: true }));
    eq('签名全无 → 简介只剩统计行', noSign['简介'], '粉丝：' + FANS_TEXT + ' · 关注：' + FOLLOW_TEXT);

    const onlyFans = await extract(makePage({ following: null }));
    eq('只有粉丝 → 统计行只一段', onlyFans['简介'].split('\n')[0], '粉丝：' + FANS_TEXT);

    const onlyFollow = await extract(makePage({ followers: null }));
    eq('只有关注 → 统计行只一段', onlyFollow['简介'].split('\n')[0], '关注：' + FOLLOW_TEXT);

    const empty = await extract(makePage({ noStats: true, noSign: true }));
    eq('统计与签名都没有 → 简介空串', empty['简介'], '');

    const noName = await extract(makePage({ name: null }));
    eq('昵称取不到 → 留空不瞎编', noName['昵称'], '');
    eq('昵称取不到 → 账号名同为空', noName['账号名'], '');
  }

  /* ==================== 6. 签名 title 兜底 ==================== */
  section('6. 签名 innerText 为空时退 title');
  {
    const r = await extract(makePage({ signTextIsEmpty: true }));
    eq('title 兜底拿到全文', r['简介'].split('\n')[1], SIGN);
  }

  /* ==================== 7. 零请求 ==================== */
  section('7. 零请求：不许 fetch、不许碰 __INITIAL_STATE__');
  {
    const w = makePage();
    await extract(w);
    eq('一次 fetch 都没发', w.__fetchCalls.length, 0);
    const src = fs.readFileSync(P('src/content/extractors/bilibili-profile.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    truthy('源码里没有 fetch', !/\bfetch\s*\(/.test(code));
    truthy('源码里没有 XMLHttpRequest', !/XMLHttpRequest/.test(code));
    truthy('源码里没有 __INITIAL_STATE__', code.indexOf('__INITIAL_STATE__') === -1);
    truthy('源码里没有 pi（也不能去读别的主世界全局）', !/window\.__pinia|__pinia/.test(code));
  }

  /* ==================== 8. 路由 ==================== */
  section('8. 路由：space 域名 person 规则');
  {
    const det = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
    const bg = fs.readFileSync(P('src/background/background.js'), 'utf8');
    const fac = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
    const per = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');

    const grab = (s) => {
      const i = s.indexOf("'space.bilibili.com': {");
      const j = s.indexOf(']', i);
      return i > -1 && j > i ? s.slice(i, j) : '';
    };
    const detSeg = grab(det);
    const bgSeg = grab(bg);
    truthy('两份配置都找得到 space.bilibili.com 块', detSeg.length > 80 && bgSeg.length > 80,
      { det: detSeg.length, bg: bgSeg.length });
    eq('两份配置逐字一致', detSeg, bgSeg);
    truthy('规则里 person 在前、social 兜底在后',
      detSeg.indexOf("type: 'person'") > -1 &&
      detSeg.indexOf("type: 'social'") > detSeg.indexOf("type: 'person'"), detSeg);
    truthy('正则认 mid + 子页', detSeg.indexOf('\\d{1,15}') > -1 && detSeg.indexOf('dynamic') > -1);

    truthy('工厂注册了 BilibiliProfileExtractor', /className: 'BilibiliProfileExtractor'/.test(fac));
    truthy('工厂 URL 规则有 space person',
      fac.indexOf("hostname: 'space.bilibili.com', mediaType: 'person'") > -1);
    const facBiliSocial = fac.indexOf("{ pattern: /www\\.bilibili\\.com\\/video\\//");
    const facSpace = fac.indexOf("hostname: 'space.bilibili.com', mediaType: 'person'");
    truthy('工厂 space 规则排在 www.bilibili.com social 之前', facSpace > -1 && facBiliSocial > facSpace,
      { facSpace, facBiliSocial });

    truthy('弹窗持久化有 space person 兜底',
      per.indexOf("url.includes('space.bilibili.com/')") > -1 &&
      per.indexOf("return 'person'") > -1);
    const perSpace = per.indexOf("url.includes('space.bilibili.com/')");
    const perSocial = per.indexOf("url.includes('bilibili.com/video/')");
    truthy('弹窗兜底排在 B站 social 之前', perSpace > -1 && perSocial > perSpace,
      { perSpace, perSocial });

    const mf = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
    truthy('manifest 已注册 bilibili-profile.js',
      (mf.content_scripts || []).some((c) => (c.js || []).indexOf('src/content/extractors/bilibili-profile.js') > -1));
    truthy('manifest 注入了 space.bilibili.com',
      mf.host_permissions.indexOf('https://space.bilibili.com/*') > -1 &&
      mf.content_scripts[0].matches.indexOf('https://space.bilibili.com/*') > -1);
    truthy('manifest 版本已升到 2.12.0', mf.version === '2.12.1', mf.version);
  }

  /* ==================== 9. URL 归一化 ==================== */
  section('9. URL 归一化');
  {
    const w = makePage();
    const N = w.UrlNormalizer;
    eq('主页不动', N.normalize('https://space.bilibili.com/' + MID), 'https://space.bilibili.com/' + MID);
    eq('动态子页 → 主页', N.normalize('https://space.bilibili.com/' + MID + '/dynamic'), 'https://space.bilibili.com/' + MID);
    eq('投稿子页 → 主页', N.normalize('https://space.bilibili.com/' + MID + '/upload'), 'https://space.bilibili.com/' + MID);
    eq('带查询串归到主页', N.normalize('https://space.bilibili.com/' + MID + '/video?tid=0'), 'https://space.bilibili.com/' + MID);
    eq('作品页不受影响', N.normalize('https://www.bilibili.com/video/BV1xx411c7XX'),
      'https://www.bilibili.com/video/BV1xx411c7XX');
    eq('认不出的地址原样返回', N.normalize('https://space.bilibili.com/'), 'https://space.bilibili.com/');
  }

  /* ==================== Z. 装配入口（v2.7.29 补：真机踩过的空浮窗） ==================== */
  section('Z. 装配入口 extractAllFields（缺了就是 6 个空行）');
  {
    const w = makePage();
    const ex = new w.BilibiliProfileExtractor();
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

  /* ==================== 结果 ==================== */
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过：' + pass + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
