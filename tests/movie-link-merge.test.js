/**
 * 影视类链接字段合并（v2.11.2）—— 契约测试
 *
 * 用户 2026-11-04 拍板的规则，逐条钉在这里：
 *   1. 影视类不再单独显示 IMDB / TMDB / Bangumi 三行，全部并进「URL」一格；
 *   2. 「豆瓣链接」保留独立一列，**不**并进 URL；
 *   3. 进 URL 的每一段都必须带「站名：」前缀（包括本页地址，站名取站点清单里的中文名）；
 *   4. 哪一项没值就不出现（不许冒出「TMDB：」这种空壳段）；
 *   5. 段与段用中文逗号连接，顺序固定：本页 → IMDB → TMDB → Bangumi；
 *   6. 地址可点；折叠阈值单独放宽到 200 字（不跟其它字段的 120 走）；
 *   7. 数据层不动：IMDB / TMDB / Bangumi 三个键留在 this.data 里，跨站补链照旧可用。
 *
 * 为什么要有这份测试：合并逻辑横跨「字段清单 → 数据准备 → 渲染」三层，
 * 任一层漏改都会出现「清单对了但页面还是两行豆瓣链接」这种假绿。
 * 所以这里既真跑 _mergeLinksIntoUrl / buildFieldContent，也对三处调用点做结构断言。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');

const MEDIA_TYPES_PATH = path.join(ROOT, 'src/shared/config/media-types.js');
const SITE_CONFIG_PATH = path.join(ROOT, 'src/shared/site-config.js');
const DATA_PROCESSOR_PATH = path.join(ROOT, 'src/content/ui/modal-data-processor.js');
const TABLE_RENDERER_PATH = path.join(ROOT, 'src/content/ui/modal-table-renderer.js');
const EDIT_MODE_PATH = path.join(ROOT, 'src/content/ui/modal-edit-mode.js');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m'
};
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) {
  pass++;
  if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`);
}
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function truthy(name, cond, detail) {
  if (cond) ok(name); else bad(name, detail);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}
function section(title) {
  console.log(`\n${C.bold}${title}${C.reset}`);
}
function src(p) { return fs.readFileSync(p, 'utf8'); }

/**
 * 在 jsdom 里把真的 modal-data-processor 跑起来，造一个最小的 ModalManager 替身。
 * 只用真实方法（_mergeLinksIntoUrl / _stripLinkLabel / _siteLabel），不替换被测逻辑。
 */
function makeDataMixin(hostname) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://' + (hostname || 'example.com') + '/detail?x=1'
  });
  dom.window.ClipMateSites = null;
  dom.window.eval(fs.readFileSync(SITE_CONFIG_PATH, 'utf8'));
  dom.window.eval(fs.readFileSync(DATA_PROCESSOR_PATH, 'utf8'));
  return { dom, mixin: dom.window.ModalDataMixin };
}

/** 造一个能动 data / fieldOrder 的最小实例 */
function makeCtx(mixin, mediaType, data, fieldOrder) {
  const ctx = Object.create(mixin);
  ctx.data = Object.assign({}, data);
  ctx.fieldOrder = (fieldOrder || Object.keys(data)).slice();
  ctx.getMediaType = () => mediaType;
  return ctx;
}

(async function main() {

  /* ==================== 1. 字段清单 ==================== */
  section('1. 字段清单（media-types.js）');

  const MT = require(MEDIA_TYPES_PATH);
  const MEDIA = MT.MEDIA_FIELD_LISTS.media;

  eq('影视清单 22 列', MEDIA.length, 22);
  eq('前 8 列不变', MEDIA.slice(0, 8),
    ['名字', '影视类型', '国家', '上映日期', '简介', '网络评分', '原作名', '豆瓣链接']);
  eq('豆瓣链接 后面紧跟 URL（用户 2026-11-04 定的位置）', MEDIA[7] + '/' + MEDIA[8], '豆瓣链接/URL');
  eq('URL 之后紧接着导演（三行原位置被 URL 占掉）', MEDIA[8] + '/' + MEDIA[9], 'URL/导演');
  truthy('IMDB / TMDB / Bangumi 三列已从清单撤销',
    MEDIA.indexOf('IMDB') === -1 && MEDIA.indexOf('TMDB') === -1 && MEDIA.indexOf('Bangumi') === -1,
    MEDIA.join(','));
  eq('首项「名字」、末项「结束时间」', [MEDIA[0], MEDIA[MEDIA.length - 1]], ['名字', '结束时间']);
  // v2.11.3：展示清单 22 列，但骨架必须留着三键 —— 详见下一节。
  eq('tv / movie 骨架 = 22 展示列 + 3 个隐藏键（共 25 键）',
    [Object.keys(MT.getFullFieldTemplate('tv')).length, Object.keys(MT.getFullFieldTemplate('movie')).length],
    [25, 25]);
  eq('getDisplayOrder("tv") 也含 URL 不含三键',
    (() => {
      const order = MT.getDisplayOrder('tv');
      return [order.indexOf('URL') > -1, order.indexOf('IMDB'), order.indexOf('TMDB'), order.indexOf('Bangumi')];
    })(),
    [true, -1, -1, -1]);
  eq('书籍 / 游戏 / 社交列数没被带坏', [
    MT.MEDIA_FIELD_LISTS.book.length,
    MT.MEDIA_FIELD_LISTS.game.length,
    MT.MEDIA_FIELD_LISTS.social.length
  ], [17, 17, 7]);

  /* ==================== 1.5 骨架与展示清单分离（v2.11.3） ==================== */
  section('1.5 骨架键 / 展示列 分离（v2.11.3 真机事故回归）');

  // 事故：v2.11.2 把三列从字段清单删掉后，field-mapper 的骨架也不再预置三个空键，
  // 而「补齐网址」按钮的显示判据是 `'TMDB' in this.data || 'Bangumi' in this.data`
  // → 豆瓣电影页按钮直接消失，补全功能静默失效（真机实测，单测没抓住）。
  {
    const THREE = ['IMDB', 'TMDB', 'Bangumi'];
    ['media', 'movie', 'tv'].forEach((type) => {
      const tpl = MT.getFullFieldTemplate(type);
      truthy(`骨架(${type}) 保留 IMDB / TMDB / Bangumi 三个键`,
        THREE.every((k) => k in tpl), Object.keys(tpl).join(','));
      truthy(`骨架(${type}) 三键的值是空字符串（不是缺省 undefined）`,
        THREE.every((k) => tpl[k] === ''), THREE.map((k) => `${k}=${JSON.stringify(tpl[k])}`).join(','));
    });

    ['movie', 'tv'].forEach((type) => {
      const order = MT.getDisplayOrder(type);
      truthy(`展示顺序(${type}) 仍然不含这三个键（它们只是骨架）`,
        THREE.every((k) => order.indexOf(k) === -1), order.join(','));
      eq(`展示顺序(${type}) 仍是 22 列`, order.length, 22);
    });

    // 判据本身：浮窗按钮按 data 里有没有 TMDB/Bangumi 判断「这是不是影视页」，
    // 这条断言把「谁在用这三个键」钉住，免得以后又被人当成多余的键删掉。
    const managerSrc = src(path.join(ROOT, 'src/content/ui/modal-manager.js'));
    truthy('「补齐网址」按钮仍靠 TMDB / Bangumi 键判断影视页（删键会让它消失）',
      /isMediaPage\s*=\s*!!\([\s\S]{0,120}'TMDB'\s+in\s+this\.data[\s\S]{0,60}'Bangumi'\s+in\s+this\.data/.test(managerSrc),
      '未在 modal-manager.js 中找到 isMediaPage 判据');

    // 端到端：拿一份真实影视存档，走 field-mapper 的骨架预置，再喂给 _prepareData 的等价流程，
    // 确认「三键进了 data、没进展示列」—— 这才是用户看到的最终形态。
    const { mixin } = makeDataMixin('movie.douban.com');
    const tpl = MT.getFullFieldTemplate('movie');
    const ctx = makeCtx(mixin, 'movie',
      Object.assign({}, tpl, { '名字': '肖申克的救赎', 'IMDB': 'https://www.imdb.com/title/tt0111161/' }),
      Object.keys(tpl));
    ctx._mergeLinksIntoUrl();
    truthy('骨架带三键时，三键仍留在 data 里（补链能继续写）',
      THREE.every((k) => k in ctx.data), Object.keys(ctx.data).join(','));
    truthy('骨架带三键时，三键不会变成三行空列',
      THREE.every((k) => ctx.fieldOrder.indexOf(k) === -1), ctx.fieldOrder.join(','));
    eq('骨架带三键时，URL 里只有 IMDB 一段（空值不出空壳段）',
      ctx.data['URL'], 'IMDB：https://www.imdb.com/title/tt0111161/');
  }

  /* ==================== 2. 合并逻辑 ==================== */
  section('2. 合并逻辑（modal-data-processor._mergeLinksIntoUrl）');

  {
    // 红果短剧：本页地址写进 URL，三键全空
    const { mixin } = makeDataMixin('hongguoduanju.com');
    const ctx = makeCtx(mixin, 'tv', {
      '名字': '持械入宋：第一季',
      'URL': 'https://hongguoduanju.com/detail?series_id=7671966197985856536',
      'IMDB': '', 'TMDB': '', 'Bangumi': ''
    }, ['名字', 'URL', 'IMDB', 'TMDB', 'Bangumi']);
    ctx._mergeLinksIntoUrl();

    eq('红果：URL 一格 = 「站点名：本页地址」（带前缀，不再裸奔）',
      ctx.data['URL'], '红果短剧：https://hongguoduanju.com/detail?series_id=7671966197985856536');
    truthy('三键不再单独成列（fieldOrder 里只剩名字、URL）',
      ctx.fieldOrder.indexOf('IMDB') === -1 && ctx.fieldOrder.indexOf('TMDB') === -1
      && ctx.fieldOrder.indexOf('Bangumi') === -1, ctx.fieldOrder.join(','));
    truthy('三键仍留在 data 里（跨站补链按它们判断空不空，删了会反复重补）',
      'IMDB' in ctx.data && 'TMDB' in ctx.data && 'Bangumi' in ctx.data);
  }

  {
    // 豆瓣电影：本页地址那格是空的（豆瓣页不设 URL），只有 IMDB 有值
    const { mixin } = makeDataMixin('movie.douban.com');
    const ctx = makeCtx(mixin, 'movie', {
      '名字': '肖申克的救赎',
      '豆瓣链接': 'https://movie.douban.com/subject/1292052/',
      'URL': '', 'IMDB': 'https://www.imdb.com/title/tt0111161/', 'TMDB': 'https://www.themoviedb.org/movie/278',
      'Bangumi': 'https://bgm.tv/subject/12345'
    }, ['名字', '豆瓣链接', 'URL', 'IMDB', 'TMDB', 'Bangumi']);
    ctx._mergeLinksIntoUrl();

    eq('豆瓣：URL 一格 = IMDB → TMDB → Bangumi（顺序固定、中文逗号）',
      ctx.data['URL'],
      'IMDB：https://www.imdb.com/title/tt0111161/，TMDB：https://www.themoviedb.org/movie/278，Bangumi：https://bgm.tv/subject/12345');
    eq('豆瓣链接那一格不被 URL 合并污染',
      ctx.data['豆瓣链接'], 'https://movie.douban.com/subject/1292052/');
    truthy('URL 里不出现「豆瓣电影：」空段（本页地址为空就不出段）',
      ctx.data['URL'].indexOf('豆瓣电影：') === -1, ctx.data['URL']);
  }

  {
    // 本页地址 + 三键全齐：顺序必须是 本页 → IMDB → TMDB → Bangumi
    const { mixin } = makeDataMixin('www.imdb.com');
    const ctx = makeCtx(mixin, 'movie', {
      'URL': 'https://www.imdb.com/title/tt0111161/',
      'IMDB': 'https://www.imdb.com/title/tt0111161/', // 与本页同址，测去重
      'TMDB': 'https://www.themoviedb.org/movie/278',
      'Bangumi': ''
    }, ['URL', 'IMDB', 'TMDB', 'Bangumi']);
    ctx._mergeLinksIntoUrl();

    truthy('同址去重：本页地址与 IMDB 相同时只保留一段',
      ctx.data['URL'].split('https://www.imdb.com/title/tt0111161/').length === 2, ctx.data['URL']);
    truthy('本页地址在前、外链在后（IMDb 在前、TMDB 在后）',
      ctx.data['URL'].indexOf('IMDb：') === 0
      && ctx.data['URL'].indexOf('TMDB：') > ctx.data['URL'].indexOf('IMDb：'), ctx.data['URL']);
    truthy('空值不出空壳段（Bangumi 为空则整段消失）',
      ctx.data['URL'].indexOf('Bangumi') === -1 && ctx.data['URL'].slice(-1) !== '，', ctx.data['URL']);
  }

  {
    // 幂等：渲染会反复调用，绝不能把「站名：」叠两遍
    const { mixin } = makeDataMixin('hongguoduanju.com');
    const ctx = makeCtx(mixin, 'tv', {
      'URL': 'https://hongguoduanju.com/detail?series_id=1', 'IMDB': '', 'TMDB': '', 'Bangumi': ''
    });
    ctx._mergeLinksIntoUrl();
    const once = ctx.data['URL'];
    ctx._mergeLinksIntoUrl();
    ctx._mergeLinksIntoUrl();
    eq('连跑三次结果完全一致（不叠加前缀）', ctx.data['URL'], once);
    eq('「红果短剧：」只出现一次', once.split('红果短剧：').length - 1, 1);
  }

  {
    // 跨站补链补到 TMDB 之后刷新一次，要能自动并进去
    const { mixin } = makeDataMixin('movie.douban.com');
    const ctx = makeCtx(mixin, 'movie', {
      'URL': '', 'IMDB': 'https://www.imdb.com/title/tt0111161/', 'TMDB': '', 'Bangumi': ''
    });
    ctx._mergeLinksIntoUrl();
    const before = ctx.data['URL'];
    ctx.data['TMDB'] = 'https://www.themoviedb.org/movie/278';   // 补链写入的就是这个键
    ctx._mergeLinksIntoUrl();
    truthy('补链补上 TMDB 后，URL 一格自动多一段',
      ctx.data['URL'] === before + '，TMDB：https://www.themoviedb.org/movie/278', ctx.data['URL']);
    truthy('原有段没有被重排或重复', ctx.data['URL'].split('IMDB：').length - 1 === 1, ctx.data['URL']);
  }

  {
    // 用户手工编辑了 URL 那一格：以新值为准，并重新带上本站前缀
    const { mixin } = makeDataMixin('hongguoduanju.com');
    const ctx = makeCtx(mixin, 'tv', { 'URL': 'https://hongguoduanju.com/detail?series_id=1' });
    ctx._mergeLinksIntoUrl();
    ctx.data['URL'] = 'https://hongguoduanju.com/detail?series_id=999';
    ctx._mergeLinksIntoUrl();
    eq('编辑后按新地址重算（旧地址不残留）',
      ctx.data['URL'], '红果短剧：https://hongguoduanju.com/detail?series_id=999');
  }

  {
    // 本站不在站点清单里：用主机名兜底，不许空着
    const { mixin } = makeDataMixin('unknown-drama.example');
    const ctx = makeCtx(mixin, 'tv', { 'URL': 'https://unknown-drama.example/v/1' });
    ctx._mergeLinksIntoUrl();
    eq('查不到站名时用主机名兜底', ctx.data['URL'], 'unknown-drama.example：https://unknown-drama.example/v/1');
  }

  /* ==================== 3. 不外溢 ==================== */
  section('3. 不外溢（其它大类一个字都不许动）');

  {
    const { mixin } = makeDataMixin('book.douban.com');
    const bookCtx = makeCtx(mixin, 'book', {
      '豆瓣链接': 'https://book.douban.com/subject/1/', 'URL': 'https://book.douban.com/subject/1/'
    }, ['豆瓣链接', 'URL']);
    bookCtx._mergeLinksIntoUrl();
    eq('书籍：URL 不合并、不加前缀', bookCtx.data['URL'], 'https://book.douban.com/subject/1/');
    eq('书籍：fieldOrder 不变', bookCtx.fieldOrder, ['豆瓣链接', 'URL']);

    const socialCtx = makeCtx(mixin, 'social', { 'URL': 'https://weibo.com/1/abc' }, ['URL']);
    socialCtx._mergeLinksIntoUrl();
    eq('社交：URL 原样', socialCtx.data['URL'], 'https://weibo.com/1/abc');

    const personCtx = makeCtx(mixin, 'person', { '姓名': '甲', '网址': 'https://www.douban.com/personage/1/' });
    personCtx._mergeLinksIntoUrl();
    truthy('人物档案：不会被塞 URL 键', !('URL' in personCtx.data), Object.keys(personCtx.data).join(','));
  }

  /* ==================== 4. 渲染 ==================== */
  section('4. 渲染（modal-table-renderer）');

  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(TABLE_RENDERER_PATH, 'utf8'));
    const M = dom.window.ModalTableMixin;
    const cell = (field, value, type) => M.buildFieldContent.call(M, field, value, type);

    const single = cell('URL', '红果短剧：https://hongguoduanju.com/detail?series_id=1', 'tv');
    truthy('影视 URL 段里的地址是可点链接（用户要「能点」）',
      single.indexOf('<a href="https://hongguoduanju.com/detail?series_id=1"') > -1, single);
    truthy('站名前缀照原样显示（灰字，不吞成「点击访问」）',
      single.indexOf('红果短剧：') > -1 && single.indexOf('点击访问') === -1, single);
    truthy('新窗口打开且带 rel=noopener',
      single.indexOf('target="_blank"') > -1 && single.indexOf('noopener') > -1, single);

    const multi = cell('URL',
      'IMDB：https://www.imdb.com/title/tt0111161/，TMDB：https://www.themoviedb.org/movie/278', 'movie');
    eq('多段各渲染成一个链接（2 个 <a>）', (multi.match(/<a /g) || []).length, 2);
    truthy('段间用中文逗号分隔', multi.indexOf('，') > -1, multi);
    truthy('每个前缀都在（IMDB：/ TMDB：）',
      multi.indexOf('IMDB：') > -1 && multi.indexOf('TMDB：') > -1, multi);

    // 折叠阈值：200 字。用 181 字（不折叠）与 211 字（折叠）两条卡住边界，
    // 阈值一旦被改回 120，181 那条立刻变红。
    const shortVal = 'IMDB：https://www.imdb.com/title/tt0111161/，TMDB：https://www.themoviedb.org/movie/278，Bangumi：https://bgm.tv/subject/' + '9'.repeat(60);
    truthy('用例本身的长度落在 (120, 200] 区间（否则卡不住阈值）',
      shortVal.length > 120 && shortVal.length <= 200, '长度 ' + shortVal.length);
    const shortCell = cell('URL', shortVal, 'movie');
    truthy('181 字的四段链接不折叠（放宽到 200 生效）', shortCell.indexOf('is-clampable') === -1, shortCell.slice(0, 60));

    const longVal = 'IMDB：https://www.imdb.com/title/tt0111161/，TMDB：https://www.themoviedb.org/movie/278，Bangumi：https://bgm.tv/subject/' + '9'.repeat(90);
    const longCell = cell('URL', longVal, 'movie');
    truthy('超过 200 字仍会折叠（不撑破浮窗，长度 ' + longVal.length + '）',
      longCell.indexOf('is-clampable') > -1 && longCell.indexOf('展开') > -1, longCell.slice(0, 60));

    const badSeg = cell('URL', '不是链接的脏数据', 'tv');
    truthy('脏数据不渲染成链接（防注入）', badSeg.indexOf('<a ') === -1, badSeg);

    const socialCell = cell('URL', 'https://weibo.com/1/abc', 'social');
    truthy('社交站的 URL 仍是「点击访问」（改动不外溢）', socialCell.indexOf('点击访问') > -1, socialCell);

    const bookCell = cell('URL', 'https://book.douban.com/subject/1/', 'book');
    truthy('书籍的 URL 仍是裸地址超链接（不套合并格）',
      bookCell.indexOf('<a href="https://book.douban.com/subject/1/"') > -1
      && bookCell.indexOf('：</span>') === -1, bookCell);
  }

  /* ==================== 5. 三处调用点 / 旧补丁 ==================== */
  section('5. 接线（改了一半就白改，逐处钉死）');

  const TR_SRC = src(TABLE_RENDERER_PATH);
  const DP_SRC = src(DATA_PROCESSOR_PATH);
  const EM_SRC = src(EDIT_MODE_PATH);

  eq('渲染层：再没有任何「把某列显示成豆瓣链接」的改名（两处旧补丁全删）',
    (TR_SRC.match(/displayName = '豆瓣链接'/g) || []).length, 0);
  eq('渲染层：URL 改名的判断式也没了',
    (TR_SRC.match(/fieldName === 'URL'\)\s*\{\s*displayName/g) || []).length, 0);
  truthy('渲染层：createTable 开头重算合并格（补链后刷新即生效）',
    /createTable\(\)\s*\{[\s\S]{0,400}?_mergeLinksIntoUrl/.test(TR_SRC));
  truthy('渲染层：影视 URL 走合并格专用渲染',
    /mediaType === 'movie' \|\| mediaType === 'tv' \|\| mediaType === 'media'\) && fieldName === 'URL'/.test(TR_SRC));
  truthy('数据层：_prepareData 在字段映射之后、排序之前合并',
    /applyFieldMappings\(\)[\s\S]{0,200}?_mergeLinksIntoUrl\(\)[\s\S]{0,200}?applyFieldOrder\(\)/.test(DP_SRC));
  truthy('数据层：合并只挑三个键，不碰豆瓣链接',
    DP_SRC.indexOf("const LINK_KEYS = ['IMDB', 'TMDB', 'Bangumi']") > -1
    && /LINK_KEYS\.forEach/.test(DP_SRC));
  truthy('编辑模式兜底顺序同步：含 URL、不含三键',
    /mediaDefaultOrder = \[[^\]]*'豆瓣链接', 'URL'/.test(EM_SRC)
    && /mediaDefaultOrder = \[[^\]]*IMDB/.test(EM_SRC) === false);

  /* ==================== 6. 整机：清单 + 合并 串起来 ==================== */
  section('6. 整机（清单顺序 + 合并真的装到一起）');

  {
    const { mixin } = makeDataMixin('hongguoduanju.com');
    const order = MT.getDisplayOrder('tv');
    const ctx = makeCtx(mixin, 'tv', {
      '名字': '持械入宋：第一季',
      'URL': 'https://hongguoduanju.com/detail?series_id=1',
      'IMDB': '', 'TMDB': '', 'Bangumi': '',
      '我的进度': '', '标记时间': '', '开始时间': '', '结束时间': ''
    }, order.concat(['IMDB', 'TMDB', 'Bangumi']));   // 模拟「清单之外的键被追加到末尾」
    ctx._mergeLinksIntoUrl();

    eq('最终列数 = 22（三键没混进来）', ctx.fieldOrder.length, 22);
    eq('URL 紧跟在豆瓣链接后面', ctx.fieldOrder.indexOf('URL') - ctx.fieldOrder.indexOf('豆瓣链接'), 1);
    truthy('URL 一格有值且带站名前缀',
      /^红果短剧：https:\/\//.test(ctx.data['URL']), ctx.data['URL']);
    truthy('列里没有三键', ['IMDB', 'TMDB', 'Bangumi'].every((k) => ctx.fieldOrder.indexOf(k) === -1));
  }

  /* ==================== 7. 真实存档：五个站各跑一遍 ==================== */
  section('7. 真实存档（tests/golden 里的真机数据，不是手搓的）');

  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(TABLE_RENDERER_PATH, 'utf8'));
    const M = dom.window.ModalTableMixin;
    // 模拟 this.escapeHtml（渲染器拿到的 displayValue 已转义过）
    const esc = (t) => {
      const d = dom.window.document.createElement('div');
      d.textContent = String(t);
      return d.innerHTML;
    };

    const CASES = [
      { file: 'hongguo-7671966197985856536.json', host: 'hongguoduanju.com', type: 'tv', expect: '红果短剧：', must: [] },
      { file: 'douban-movie-1292052.json', host: 'movie.douban.com', type: 'movie', expect: 'IMDB：', must: [] },
      { file: 'imdb-tt0185906.json', host: 'www.imdb.com', type: 'movie', expect: 'IMDB：', must: [] },
      { file: 'tmdb-movie-278.json', host: 'www.themoviedb.org', type: 'movie', expect: 'TMDB：', must: [] },
      { file: 'bgm-64965-the-godfather.json', host: 'bgm.tv', type: 'movie', expect: 'IMDB：', must: ['Bangumi：'] }
    ];

    CASES.forEach((c) => {
      const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', c.file), 'utf8'));
      const { mixin } = makeDataMixin(c.host);
      const ctx = Object.create(mixin);
      ctx.data = JSON.parse(JSON.stringify(golden.data));
      ctx.fieldOrder = Object.keys(ctx.data);
      ctx.getMediaType = () => c.type;
      ctx._mergeLinksIntoUrl();

      const merged = ctx.data['URL'];
      truthy(`存档 ${c.file}：URL 一格以「${c.expect}」开头（站名前缀）`,
        typeof merged === 'string' && merged.indexOf(c.expect) === 0, String(merged));
      truthy(`存档 ${c.file}：URL 里没有「：，」这种空壳段`, merged.indexOf('：，') === -1, String(merged));
      c.must.forEach((seg) => {
        truthy(`存档 ${c.file}：URL 里含「${seg}」（该站有值的链接不被吞）`,
          merged.indexOf(seg) > -1, String(merged));
      });

      const cell = M.buildFieldContent.call(M, 'URL', esc(merged), c.type);
      truthy(`存档 ${c.file}：渲染出可点链接`,
        cell.indexOf('<a href="http') > -1 && cell.indexOf('target="_blank"') > -1, cell.slice(0, 90));
      truthy(`存档 ${c.file}：段数 = <a> 数（没有段被吞）`,
        (cell.match(/<a /g) || []).length === merged.split('，').length,
        `段 ${merged.split('，').length} / a ${(cell.match(/<a /g) || []).length}`);
      truthy(`存档 ${c.file}：三键已不在列里`,
        ['IMDB', 'TMDB', 'Bangumi'].every((k) => ctx.fieldOrder.indexOf(k) === -1),
        ctx.fieldOrder.join(','));
    });

    // 豆瓣那一格必须原样，不能被 URL 合并带跑
    const douban = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden', 'douban-movie-1292052.json'), 'utf8'));
    const { mixin } = makeDataMixin('movie.douban.com');
    const ctx = Object.create(mixin);
    ctx.data = JSON.parse(JSON.stringify(douban.data));
    ctx.fieldOrder = Object.keys(ctx.data);
    ctx.getMediaType = () => 'movie';
    ctx._mergeLinksIntoUrl();
    eq('存档 douban-movie：豆瓣链接一格原样保留',
      ctx.data['豆瓣链接'], 'https://movie.douban.com/subject/1292052/');
    truthy('存档 douban-movie：豆瓣链接没有出现在 URL 那段里（两格各管各的）',
      String(ctx.data['URL']).indexOf('movie.douban.com') === -1, String(ctx.data['URL']));
  }

  /* ==================== 汇总 ==================== */
  console.log('\n' + '='.repeat(52));
  if (fail === 0) {
    console.log(`${C.green}== 全部通过 ${pass} 项 ==${C.reset}`);
  } else {
    console.log(`${C.red}== 通过 ${pass} 项，失败 ${fail} 项 ==${C.reset}`);
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    process.exitCode = 1;
  }
})();
