/**
 * 红果短剧（hongguoduanju.com）剧集提取器单测 · v2.11.0
 *
 * 为什么单独做一份：
 *   快照（tests/snapshot.js）只看字段值有没有漂移，测不到「三类剧怎么辨别」这条规则；
 *   而这恰好是本次改动最容易错的地方（上一次只看 5 部样本就把 AI 剧认成真人剧）。
 *   所以这里用 4 份**真实页面存档**把三种子类型各钉一遍，再从 extractAllFields() 进，
 *   保证「零件对但没装成整机」这种情况也会变红。
 *
 * 存档来源：2026-11-04 接管已登录 Edge 抓的真实详情页（原样保存，未改写）
 *   hongguo-7701935931787316286.html  真人剧《十八岁太奶奶驾到，重整家族荣耀第五部》
 *   hongguo-7701226234214108185.html  漫剧《聚宝仙盆之杂灵根才是真BOSS第十五季》
 *   hongguo-7671966197985856536.html  AI剧《持械入宋：第一季》
 *   hongguo-7700477891418524696.html  无榜单老剧《公路求生榜一说他要走到公路尽头第二季》
 *
 * 跑法（项目根目录）：
 *   node tests/hongguo-movie.test.js
 *   node tests/hongguo-movie.test.js --verbose
 *
 * 判定：全部通过退出码 0，有任何失败退出码 1。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'ClipMate_chrome');
const FIXTURES = path.join(__dirname, 'fixtures', 'html');

const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${JSON.stringify(got)}`);
  } else {
    fails.push({ label, got, want });
    console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
  }
}

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label}`);
  } else {
    fails.push({ label, got: detail, want: '(真)' });
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      实际 ${JSON.stringify(detail)}`}`);
  }
}

/* ============================================================
 * 准备：在 jsdom 里按 manifest 顺序注入「基类 + 红果提取器」
 * ==========================================================*/
const BASE_SRC = fs.readFileSync(path.join(EXT, 'src', 'content', 'extractors', 'base-extractor.js'), 'utf8');
const HONGGUO_SRC = fs.readFileSync(path.join(EXT, 'src', 'content', 'extractors', 'hongguo-movie.js'), 'utf8');

/** 打开一份存档，返回 { window, Ext, ext } */
function loadPage(file, seriesId) {
  const html = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
  const url = `https://hongguoduanju.com/detail?series_id=${seriesId}`;
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;

  // 日志替身（提取器里 ClipMateLog.debug 只在异常分支调用，但缺了会 ReferenceError）
  window.eval('window.ClipMateLog = { debug: function () {} };');
  window.eval(BASE_SRC);
  window.eval(HONGGUO_SRC);

  if (!window.HongguoMovieExtractor) throw new Error('提取器没挂到 window 上，注入顺序有问题');
  if (!window.BaseExtractor) throw new Error('基类没挂到 window 上');
  return { window, Ext: window.HongguoMovieExtractor };
}

/** 用假数据替换 _ROUTER_DATA，专测辨别逻辑（不碰存档里的真数据） */
function withData(page, seriesDetail, socialInfo) {
  const ext = new page.Ext();
  ext._routerCache = {
    href: page.window.location.href,
    data: { loaderData: { detail_page: { seriesDetail: seriesDetail || {}, seriesSocialInfo: socialInfo || {} } } }
  };
  return ext;
}

const REAL = { file: 'hongguo-7701935931787316286.html', id: '7701935931787316286' };
const COMIC = { file: 'hongguo-7701226234214108185.html', id: '7701226234214108185' };
const AI = { file: 'hongguo-7671966197985856536.html', id: '7671966197985856536' };
const NORANK = { file: 'hongguo-7700477891418524696.html', id: '7700477891418524696' };

(async function main() {
  /* ============================================================
   * A. 真人剧：全字段（契约从 extractAllFields 进）
   * ==========================================================*/
  console.log('A. 真人剧《十八岁太奶奶驾到，重整家族荣耀第五部》');
  {
    const page = loadPage(REAL.file, REAL.id);
    const ext = new page.Ext();
    const d = await ext.extractAllFields();

    eq('名字', d['名字'], '十八岁太奶奶驾到，重整家族荣耀第五部');
    eq('title（基类字段也要对）', d.title, '十八岁太奶奶驾到，重整家族荣耀第五部');
    eq('影视类型', d['影视类型'], '剧集');
    // v2.11.1：国家固定「中国」（红果全站国内短剧，数据层无地区字段）
    eq('国家', d['国家'], '中国');
    eq('上映日期', d['上映日期'], '2026/10/31');
    eq('集数', d['集数'], '102');
    eq('网络评分', d['网络评分'], '9.5');
    eq('标签（数据里 8 个全量）', d['标签'], '家族,家族振兴,穿越,扮猪吃虎,女强,总裁,世家,现代');
    eq('其他信息', d['其他信息'], '子分类：真人剧，热度：9009万，点赞：667.4万，收藏：257.6万，评分人数：19655');
    eq('URL', d.url, `https://hongguoduanju.com/detail?series_id=${REAL.id}`);

    ok('主演非空', typeof d['主演'] === 'string' && d['主演'].length > 0, d['主演']);
    ok('主演第一位是李柯以', String(d['主演']).indexOf('李柯以') === 0, d['主演']);
    eq('主演 18 人（逗号分隔 → 19 段）', String(d['主演']).split(', ').length, 18);
    ok('主演里没有重复姓名', new Set(String(d['主演']).split(', ')).size === 18);

    ok('简介完整（不是截断版）', String(d['简介']).length === 101, String(d['简介'] || '').length);
    ok('简介结尾不是省略号', !/…$/.test(String(d['简介'])), String(d['简介']).slice(-8));
  }

  /* ============================================================
   * B. 漫剧：全字段 + 无演员
   * ==========================================================*/
  console.log('\nB. 漫剧《聚宝仙盆之杂灵根才是真BOSS第十五季》');
  {
    const page = loadPage(COMIC.file, COMIC.id);
    const ext = new page.Ext();
    const d = await ext.extractAllFields();

    eq('名字', d['名字'], '聚宝仙盆之杂灵根才是真BOSS第十五季');
    eq('影视类型', d['影视类型'], '剧集');
    eq('国家（漫剧同样是中国）', d['国家'], '中国');
    eq('上映日期', d['上映日期'], '2026/10/31');
    eq('集数', d['集数'], '300');
    eq('网络评分', d['网络评分'], '9');
    eq('标签', d['标签'], '玄幻,异界');
    eq('其他信息', d['其他信息'], '子分类：漫剧，热度：7333万，点赞：231.5万，收藏：83.5万，评分人数：6134');
    ok('主演（漫剧没有演员表 → 空）', !d['主演'], d['主演']);
  }

  /* ============================================================
   * C. AI 剧：全字段 + 无演员
   * ==========================================================*/
  console.log('\nC. AI剧《持械入宋：第一季》');
  {
    const page = loadPage(AI.file, AI.id);
    const ext = new page.Ext();
    const d = await ext.extractAllFields();

    eq('名字', d['名字'], '持械入宋：第一季');
    eq('影视类型', d['影视类型'], '剧集');
    eq('国家（AI剧同样是中国）', d['国家'], '中国');
    eq('上映日期', d['上映日期'], '2026/08/21');
    eq('集数', d['集数'], '100');
    eq('网络评分', d['网络评分'], '8.7');
    eq('标签', d['标签'], '脑洞,穿越,古代,乡村');
    eq('其他信息', d['其他信息'], '子分类：AI剧，热度：5511万，点赞：479.5万，收藏：378.2万，评分人数：15698');
    ok('主演（AI剧没有演员表 → 空）', !d['主演'], d['主演']);
  }

  /* ============================================================
   * D. 无榜老剧：判不出子类型时留空，其余照写
   * ==========================================================*/
  console.log('\nD. 无榜单老剧《公路求生榜一说他要走到公路尽头第二季》');
  {
    const page = loadPage(NORANK.file, NORANK.id);
    const ext = new page.Ext();
    const d = await ext.extractAllFields();

    eq('名字', d['名字'], '公路求生榜一说他要走到公路尽头第二季');
    // 判不出子分类是「子分类留空」，不是「国家留空」——两件事别混
    eq('国家（判不出子分类也不影响国家）', d['国家'], '中国');
    eq('集数', d['集数'], '172');
    eq('上映日期', d['上映日期'], '2026/10/26');
    ok('主演（无演员表 → 空）', !d['主演'], d['主演']);
    ok('其他信息不含「子分类」', String(d['其他信息']).indexOf('子分类') < 0, d['其他信息']);
    ok('其他信息以「热度：」开头', String(d['其他信息']).indexOf('热度：') === 0, d['其他信息']);
    eq('其他信息其余四项照写', d['其他信息'], '热度：5497万，点赞：261.7万，收藏：123万，评分人数：11131');
    ok('判不出时子分类是空字符串', ext._detectSubCategory() === '', ext._detectSubCategory());
  }

  /* ============================================================
   * E. 辨别规则（纯逻辑，不依赖具体页面数据）
   * ==========================================================*/
  console.log('\nE. 三级判据');
  {
    const page = loadPage(NORANK.file, NORANK.id); // 无榜页做底：DOM 里没有 rank 标签

    const cases = [
      ['热播AI剧榜第9名', '', 'AI剧'],
      ['热播漫剧榜第3名', '', '漫剧'],
      ['热播真人剧榜第12名', '', '真人剧'],
      ['热播短剧榜第1名', '', '真人剧'],
      ['热播短剧榜第1名', '李柯以', '真人剧'],
      ['', '', ''] // 没榜单、没演员 → 留空
    ];
    for (const [label, celebName, want] of cases) {
      const ext = withData(page,
        { celebrities: celebName ? [{ nickname: celebName }] : [] },
        { rank_label: label });
      eq(`rank_label="${label}" / 演员="${celebName}" → ${want || '留空'}`, ext._detectSubCategory(), want);
    }

    // 二级：没榜单但有演员 → 真人剧（真人剧在榜外的情形）
    {
      const ext = withData(page, { celebrities: [{ nickname: '某演员' }] }, {});
      eq('无榜单 + 有演员 → 真人剧', ext._detectSubCategory(), '真人剧');
    }
    // 三级：没榜单没演员的漫剧/AI剧 → 留空（不猜）
    {
      const ext = withData(page, { celebrities: [] }, { rank_label: null });
      eq('无榜单 + 无演员 → 留空', ext._detectSubCategory(), '');
    }
    // 数据层缺 rank_label 时，DOM 标签兜底
    {
      const realPage = loadPage(REAL.file, REAL.id);
      const ext = new realPage.Ext();
      eq('数据层没有 rank_label 时读 DOM 标签（hot-drama）', ext._detectSubCategory(), '真人剧');
    }
    // 假数据里 rank_label 缺失（不是 null，是根本没这个键）
    {
      const ext = withData(page, {}, undefined);
      eq('seriesSocialInfo 整个缺失 → 不抛错、留空', ext._detectSubCategory(), '');
      eq('seriesSocialInfo 缺失时其他信息也只剩空', ext.extractOtherInfo(), '');
    }
    // 「AI剧」必须先于「漫剧」判断：绝不能因为文案里带「剧」字就落到真人剧
    {
      const ext = withData(page, {}, { rank_label: '热播AI剧榜第1名' });
      ok('AI剧优先级高于「剧」字泛匹配', ext._detectSubCategory() === 'AI剧', ext._detectSubCategory());
    }
  }

  /* ============================================================
   * F. 数据源健壮性
   * ==========================================================*/
  console.log('\nF. _ROUTER_DATA 截取');
  {
    const page = loadPage(NORANK.file, NORANK.id);
    const ext = new page.Ext();

    eq('大括号后跟 JS 代码也能截对',
      ext._sliceJsonObject('{"a":{"b":"}"},"c":1};(function(){})();'),
      '{"a":{"b":"}"},"c":1}');
    eq('字符串里的转义引号不破坏配对',
      ext._sliceJsonObject('{"a":"say \\"hi\\" }"}tail'),
      '{"a":"say \\"hi\\" }"}');
    eq('没有对象 → null', ext._sliceJsonObject('no json here'), null);

    // 存档里确实存在 _ROUTER_DATA，且能被解析出 detail_page
    const data = ext._readRouterData();
    ok('存档里读到 _ROUTER_DATA', !!data, data && Object.keys(data));
    ok('loaderData.detail_page 存在',
      !!(data && data.loaderData && data.loaderData.detail_page),
      data && data.loaderData && Object.keys(data.loaderData));
    eq('series_id 正确', String((ext._series() || {}).series_id), NORANK.id);
  }

  /* ============================================================
   * G. 接线：注册齐全（防止「零件对但没装成整机」）
   * ==========================================================*/
  console.log('\nG. 接入配置');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const main = manifest.content_scripts[0];
    const hostPerms = manifest.host_permissions || [];
    const jsList = main.js || [];

    eq('manifest 版本是 2.12.0', manifest.version, '2.12.6');
    for (const domain of ['https://hongguoduanju.com/*', 'https://www.hongguoduanju.com/*', 'https://www.novelquickapp.com/*']) {
      ok(`host_permissions 含 ${domain}`, hostPerms.indexOf(domain) >= 0);
    }
    for (const match of ['https://hongguoduanju.com/detail*', 'https://www.hongguoduanju.com/detail*', 'https://www.novelquickapp.com/detail*']) {
      ok(`matches 含 ${match}`, (main.matches || []).indexOf(match) >= 0);
    }
    ok('匹配的是 /detail*，不是整站 /*', (main.matches || []).filter((m) => /hongguoduanju\.com\/\*$/.test(m)).length === 0);

    const idxScript = jsList.indexOf('src/content/extractors/hongguo-movie.js');
    const idxBase = jsList.indexOf('src/content/extractors/base-extractor.js');
    ok('js 列表里有 hongguo-movie.js', idxScript >= 0);
    ok('hongguo-movie.js 排在 base-extractor.js 之后（继承需要）', idxBase >= 0 && idxScript > idxBase, { idxBase, idxScript });

    const factory = fs.readFileSync(path.join(EXT, 'src', 'content', 'utils', 'extractor-factory.js'), 'utf8');
    ok('factory 注册了 HongguoMovieExtractor', factory.indexOf('HongguoMovieExtractor') >= 0);
    for (const host of ["'hongguoduanju.com'", "'www.hongguoduanju.com'", "'www.novelquickapp.com'"]) {
      ok(`factory 认域名 ${host}`, factory.indexOf(host) >= 0);
    }
    ok('factory 把红果注册成 tv（不是 movie）',
      /HongguoMovieExtractor', entries: \[\s*\{ hostname: 'hongguoduanju\.com', types: \['tv'\]/.test(factory));

    const detector = fs.readFileSync(path.join(EXT, 'src', 'content', 'utils', 'media-detector.js'), 'utf8');
    const background = fs.readFileSync(path.join(EXT, 'src', 'background', 'background.js'), 'utf8');
    for (const host of ['hongguoduanju.com', 'www.hongguoduanju.com', 'www.novelquickapp.com']) {
      ok(`media-detector 有 ${host}`, detector.indexOf(`'${host}':`) >= 0);
      ok(`background.getMediaConfigs 有 ${host}（两份必须对齐）`, background.indexOf(`'${host}':`) >= 0);
    }
    ok('media-detector 用 noContentFallback（路径不对不猜类型）',
      /'hongguoduanju\.com': \{\s*type: 'tv',\s*patterns: \['\/detail'\],\s*noContentFallback: true/.test(detector));
    ok('background 与 media-detector 口径一致（都有 noContentFallback）',
      /'hongguoduanju\.com': \{\s*type: 'tv',\s*patterns: \['\/detail'\],\s*noContentFallback: true/.test(background));

    const siteConfig = fs.readFileSync(path.join(EXT, 'src', 'shared', 'site-config.js'), 'utf8');
    ok('site-config 有「红果短剧」', /name: '红果短剧'/.test(siteConfig));
    ok('site-config 归在「影视」组', /name: '红果短剧'[^\n]*group: '影视'/.test(siteConfig));

    const cacheKey = fs.readFileSync(path.join(EXT, 'src', 'shared', 'cache-key-manager.js'), 'utf8');
    ok('cache-key-manager 有 hongguo', /hongguo:\s*'hongguoduanju\.com'/.test(cacheKey));

    const persistence = fs.readFileSync(path.join(EXT, 'src', 'content', 'ui', 'modal-persistence.js'), 'utf8');
    ok('modal-persistence 认红果为 tv', /url\.includes\('hongguoduanju\.com'\)/.test(persistence));

    // 站点名与缓存键必须对得上（对不上缓存永远 miss）
    const page2 = loadPage(REAL.file, REAL.id);
    eq('siteName = hongguo（与 cache-key 表的键一致）', new page2.Ext().siteName, 'hongguo');
    eq('mediaType = tv', new page2.Ext().mediaType, 'tv');
  }

  /* ============================================================
   * 汇总
   * ==========================================================*/
  console.log('');
  if (fails.length) {
    console.log(`✗ ${pass} 项通过，${fails.length} 项失败`);
    for (const f of fails) console.log(`   - ${f.label}`);
    process.exit(1);
  }
  console.log(`✓ 全部 ${pass} 项通过`);
})().catch((e) => {
  console.error('测试脚本自身出错:', e);
  process.exit(1);
});
