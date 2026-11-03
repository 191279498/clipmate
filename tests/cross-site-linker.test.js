/**
 * 跨站补网址 · 纯函数单测（v2.5.72）
 *
 * 为什么单独做一份：三个站「搜出来的第一条到底是不是这一条」这件事，
 * 快照测不到（要联网）、真机又只能看到最终写进去的值看不到取舍过程。
 * 所以把解析逻辑全部写成纯函数，用 2026-10-26 抓的真实响应当输入钉住。
 *
 * 存档：
 *   tests/fixtures/json/douban-suggest-*.json   豆瓣搜索建议（tt 号 / 片名 / ISBN / 查无）
 *   tests/fixtures/json/bgm-search-*.json       番组计划 v0 搜索（教父 / 兄弟连）
 *   tests/fixtures/html/tmdb-search-*.html      TMDB 搜索结果页（教父 / 兄弟连）
 *
 * 跑法（项目根目录）：
 *   node tests/cross-site-linker.test.js
 *   node tests/cross-site-linker.test.js --verbose
 */

'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'ClipMate_chrome', 'src', 'shared', 'cross-site-linker.js');
const Linker = require(TARGET);

const readJson = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'json', name), 'utf8');
const readHtml = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'html', name), 'utf8');

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

function ok(label, cond) {
  eq(label, !!cond, true);
}

/* ============================================================
 * 一、查询计划：从已提取的数据里凑「搜什么」
 * ==========================================================*/
console.log('一、查询计划');

// IMDb 页（兄弟连）：原作名是空的，原名写在「名字」里
const imdbPlan = Linker.buildPlan({
  '名字': 'Band of Brothers',
  '原作名': '',
  '上映日期': '2001/09/09',
  'IMDB': 'https://www.imdb.com/title/tt0185906/',
  '影视类型': '剧集'
}, 'https://www.imdb.com/title/tt0185906/');
eq('IMDb 页·第 1 搜索词', imdbPlan.keyword, 'Band of Brothers');
eq('IMDb 页·IMDb 编号', imdbPlan.imdbId, 'tt0185906');
eq('IMDb 页·年份', imdbPlan.year, 2001);
eq('IMDb 页·按剧集找', imdbPlan.isTv, true);

// 豆瓣页（肖申克）：「名字」是「中文名 原名」拼起来的，原作名更干净
const doubanPlan = Linker.buildPlan({
  '名字': '肖申克的救赎 The Shawshank Redemption',
  '原作名': 'The Shawshank Redemption',
  '上映日期': '1994/09/10',
  'IMDB': 'https://www.imdb.com/title/tt0111161/',
  '影视类型': '电影'
}, 'https://movie.douban.com/subject/1292052/');
eq('豆瓣页·第 1 搜索词取原作名', doubanPlan.keyword, 'The Shawshank Redemption');
eq('豆瓣页·第 2 搜索词是名字', doubanPlan.keyword2, '肖申克的救赎 The Shawshank Redemption');
eq('豆瓣页·按电影找', doubanPlan.isTv, false);

// 页面 URL 里带 tt 号（IMDB 字段为空时也要认出来）
const urlPlan = Linker.buildPlan({ '名字': 'The Godfather', '上映日期': '1972/03/15' }, 'https://www.imdb.com/title/tt0068646/');
eq('从当前页 URL 取 IMDb 编号', urlPlan.imdbId, 'tt0068646');

// 年份容错：各种写法都要能取出 4 位
eq('年份·YYYY/MM/DD', Linker.buildPlan({ '上映日期': '1972/03/15' }, '').year, 1972);
eq('年份·YYYY-MM-DD', Linker.buildPlan({ '上映日期': '1972-03-15' }, '').year, 1972);
eq('年份·只有年', Linker.buildPlan({ '上映日期': '1972' }, '').year, 1972);
eq('年份·空值', Linker.buildPlan({ '上映日期': '' }, '').year, null);
eq('年份·没有字段', Linker.buildPlan({}, '').year, null);

/* ============================================================
 * 二、已有值一律跳过（用户最在意的一条）
 * ==========================================================*/
console.log('\n二、已有值绝不覆盖');

const pend1 = Linker.pendingTargets({ '豆瓣链接': 'https://movie.douban.com/subject/1/', 'IMDB': 'x', 'Bangumi': '', 'TMDB': '' });
eq('豆瓣已有 → 不在待补列表', pend1.some((t) => t.kind === 'douban'), false);
eq('IMDB 已有 → 不在待补列表', pend1.some((t) => t.kind === 'imdb'), false);
eq('Bangumi 为空 → 在待补列表', pend1.some((t) => t.kind === 'bgm'), true);
eq('TMDB 为空 → 在待补列表', pend1.some((t) => t.kind === 'tmdb'), true);

const pend2 = Linker.pendingTargets({ '豆瓣链接': 'a', 'IMDB': 'b', 'Bangumi': 'c', 'TMDB': 'd' });
eq('四格都有值 → 待补为空', pend2.length, 0);

const pend3 = Linker.pendingTargets({ '豆瓣链接': '   ', 'IMDB': null, 'Bangumi': null, 'TMDB': undefined });
eq('空白也只算空', pend3.length, 4);

/* ---- v2.5.73 新增：本页自己那一格要跳过 ---- */
const pendImdbPage = Linker.pendingTargets({ 'IMDB': 'https://www.imdb.com/title/tt0185906/' }, 'https://www.imdb.com/title/tt0185906/');
eq('在 IMDb 页 → IMDB 格不在待补（本页跳过）', pendImdbPage.some((t) => t.kind === 'imdb'), false);
eq('在 IMDb 页 → 另外三格都在待补', pendImdbPage.length, 3);

const pendDoubanPage = Linker.pendingTargets({ '豆瓣链接': '' }, 'https://movie.douban.com/subject/1292052/');
eq('在豆瓣页 → 豆瓣格不在待补（不把当前网址抄进自己格子）', pendDoubanPage.some((t) => t.kind === 'douban'), false);
eq('在豆瓣页 → 待补 3 格', pendDoubanPage.length, 3);

eq('在番组页 → 番组格不在待补',
  Linker.pendingTargets({}, 'https://bgm.tv/subject/64965').some((t) => t.kind === 'bgm'), false);
eq('在 TMDB 页 → TMDB 格不在待补',
  Linker.pendingTargets({}, 'https://www.themoviedb.org/movie/238-the-godfather').some((t) => t.kind === 'tmdb'), false);
eq('不认识的站 → 四格全在待补', Linker.pendingTargets({}, 'https://example.com/x').length, 4);

/* ============================================================
 * 三、请求组装
 * ==========================================================*/
console.log('\n三、请求组装');

const r1 = Linker.buildRequests(imdbPlan, 1, ['douban', 'bgm', 'tmdb']);
eq('第一轮发 3 个请求', r1.length, 3);

const doubanReq = r1.find((r) => r.kind === 'douban');
eq('豆瓣第一轮用 IMDb 编号（最准）', doubanReq.url, 'https://www.douban.com/j/search_suggest?q=tt0185906');
eq('豆瓣用 GET', doubanReq.method, 'GET');

const bgmReq = r1.find((r) => r.kind === 'bgm');
eq('番组计划用 POST', bgmReq.method, 'POST');
eq('番组计划端点', bgmReq.url, 'https://api.bgm.tv/v0/search/subjects?limit=10');
const bgmBody = JSON.parse(bgmReq.body);
eq('番组计划搜索词', bgmBody.keyword, 'Band of Brothers');
eq('番组计划只要动画+真人影视', JSON.stringify(bgmBody.filter.type), '[2,6]');

const tmdbReq = r1.find((r) => r.kind === 'tmdb');
// v2.5.73：有 IMDb 编号时不再拿片名去搜，直接走 TMDB 的精确跳转端点。
// 实测（SW 内）：对得上就 302 到条目页，编号不存在就原地不动。
ok('有编号 → 走 TMDB 精确跳转（不再是片名搜索）',
  tmdbReq.url.indexOf('https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=tt0185906') === 0);
ok('精确跳转只要最终地址，不要正文（省 150KB）', tmdbReq.urlOnly === true);

const moviePlan = Linker.buildPlan({ '原作名': 'The Godfather', '上映日期': '1972/03/15', '影视类型': '电影' }, '');
const tmdbMovieReq = Linker.buildRequests(moviePlan, 1, ['tmdb'])[0];
ok('没有编号时退回片名搜：电影+年份走 /search/movie?year= 收窄',
  tmdbMovieReq.url.indexOf('search/movie?query=The%20Godfather&year=1972') !== -1);

// 第二轮：豆瓣不再用 tt 号，改用中文名；TMDB 精确跳转只问一次
const r2 = Linker.buildRequests(doubanPlan, 2, ['douban', 'tmdb']);
eq('第二轮豆瓣改用中文名（比英文原名更准）', r2.find((r) => r.kind === 'douban').url,
  'https://www.douban.com/j/search_suggest?q=' + encodeURIComponent('肖申克的救赎'));
eq('第二轮不再重复问 TMDB 精确跳转（映射表是确定的，答案不会变）',
  r2.filter((r) => r.kind === 'tmdb').length, 0);

// IMDB 那一格永远不发请求（本地拼）
eq('IMDB 格不发任何请求', Linker.buildRequests(imdbPlan, 1, ['imdb']).length, 0);

// 没有搜索词也没编号 → 不发请求
eq('啥都没有 → 0 个请求', Linker.buildRequests(Linker.buildPlan({}, ''), 1, ['douban', 'bgm', 'tmdb']).length, 0);

/* ============================================================
 * 四、豆瓣：只认 movie.douban.com
 * ==========================================================*/
console.log('\n四、豆瓣解析');

eq('tt 号查询 → 教父',
  Linker.parseDoubanSuggest(readJson('douban-suggest-tt0068646.json')),
  'https://movie.douban.com/subject/1291841/');

eq('片名查询 → 教父（第一条就是，不取教父2）',
  Linker.parseDoubanSuggest(readJson('douban-suggest-title.json')),
  'https://movie.douban.com/subject/1291841/');

// ISBN 查出来的是书（book.douban.com）→ 影视字段里绝不能写这个
eq('ISBN 查出书 → 丢掉，返回空',
  Linker.parseDoubanSuggest(readJson('douban-suggest-isbn.json')), null);

eq('查无此条 → 空', Linker.parseDoubanSuggest(readJson('douban-suggest-empty.json')), null);
eq('不是 JSON → 空', Linker.parseDoubanSuggest('<html>403</html>'), null);
eq('空字符串 → 空', Linker.parseDoubanSuggest(''), null);

/* ============================================================
 * 五、番组计划：名字必须对得上，年份只用来挑
 * ==========================================================*/
console.log('\n五、番组计划解析');

const bgmGodfather = readJson('bgm-search-godfather.json');
const bgmBob = readJson('bgm-search-bob.json');

eq('教父（英文名 1972）→ 64965，不是教父2/3',
  Linker.parseBgmSearch(bgmGodfather, { keyword: 'The Godfather', year: 1972 }),
  'https://bgm.tv/subject/64965');

eq('教父（中文名 1972）→ 64965（靠 name_cn 对上）',
  Linker.parseBgmSearch(bgmGodfather, { keyword: '教父', year: 1972 }),
  'https://bgm.tv/subject/64965');

eq('搜「教父2」→ 96295（完全相等就该给续集）',
  Linker.parseBgmSearch(bgmGodfather, { keyword: 'The Godfather Part II', year: 1974 }),
  'https://bgm.tv/subject/96295');

eq('年份对不上、但名字完全相等 → 仍然给 64965',
  Linker.parseBgmSearch(bgmGodfather, { keyword: 'The Godfather', year: 1901 }),
  'https://bgm.tv/subject/64965');

eq('兄弟连 2001 → 47364（列表第 2 条是无关动画）',
  Linker.parseBgmSearch(bgmBob, { keyword: 'Band of Brothers', year: 2001 }),
  'https://bgm.tv/subject/47364');

eq('没有年份也不影响名字完全相等 → 47364',
  Linker.parseBgmSearch(bgmBob, { keyword: 'Band of Brothers' }),
  'https://bgm.tv/subject/47364');

// 真机反例（2026-10-26）：豆瓣《肖申克》页去番组计划搜英文名，番组计划没收录这部片，
// 却回了 1000 条按词袋乱命中的结果。原来会照着取第一条，写进《黑客帝国动画版》。
eq('番组计划没收录 → 留空，不许写第一条（肖申克反例）',
  Linker.parseBgmSearch(bgmGodfather, { keyword: 'The Shawshank Redemption', year: 1994 }),
  null);

eq('只有包含关系、年份又对不上 → 留空',
  Linker.parseBgmSearch(bgmGodfather, { keyword: 'The Godfather Part', year: 1999 }),
  null);

eq('只有年份、没有搜索词 → 留空（不猜）',
  Linker.parseBgmSearch(bgmGodfather, { year: 1972 }),
  null);

eq('搜不到（空列表） → 空', Linker.parseBgmSearch('{"total":0,"data":[]}', { keyword: '教父', year: 1972 }), null);
eq('不是 JSON → 空', Linker.parseBgmSearch('<html>503</html>', { keyword: '教父', year: 1972 }), null);

/* ============================================================
 * 六、TMDB：先按结果容器切，再按名字挑
 * ==========================================================*/
console.log('\n六、TMDB 解析');

// 存档是**程序 fetch 拿到的原始 HTML**（服务端渲染，后台实际收到的就是这个），
// 不是浏览器跑完脚本后的 outerHTML —— 两者不一样，用后者测等于自欺欺人。
const tmdbGodfather = readHtml('tmdb-search-movie-godfather.html');
const tmdbBob = readHtml('tmdb-search-tv-bob.html');

eq('教父（电影 1972，英文名）',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: false, year: 1972, keyword: 'The Godfather' }),
  'https://www.themoviedb.org/movie/238-the-godfather');

eq('教父（电影，中文名也能对上卡片标题）',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: false, year: 1972, keyword: '教父' }),
  'https://www.themoviedb.org/movie/238-the-godfather');

eq('兄弟连（剧集 2001）',
  Linker.parseTmdbSearch(tmdbBob, { isTv: true, year: 2001, keyword: 'Band of Brothers' }),
  'https://www.themoviedb.org/tv/4613-band-of-brothers');

eq('年份对不上但名字完全相等 → 仍取 238',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: false, year: 1901, keyword: 'The Godfather' }),
  'https://www.themoviedb.org/movie/238-the-godfather');

// 同一页里 #tv_results 有一堆同名电视剧，找电影时绝不能串过去
ok('按电影找时不会串到电视剧容器',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: false, year: 1972, keyword: 'The Godfather' }).indexOf('/tv/') === -1);

// 反过来找剧集时，也不该拿 #movie_results 里的电影
ok('按剧集找时拿的是 /tv/ 下的条目',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: true, year: 1972, keyword: 'The Godfather' }).indexOf('https://www.themoviedb.org/tv/') === 0);

eq('名字对不上 → 留空，不许写第一条（跟番组计划同一条纪律）',
  Linker.parseTmdbSearch(tmdbGodfather, { isTv: false, year: 1994, keyword: 'The Shawshank Redemption' }),
  null);

// 导航链接 /movie/now-playing、/movie/top-rated 后面没有数字，不能被当成条目
eq('导航链接不会被误认成条目',
  Linker.parseTmdbSearch('<a href="/movie/now-playing">x</a><a href="/movie/top-rated">y</a>', { isTv: false }), null);

eq('空页面 → 空', Linker.parseTmdbSearch('', { isTv: false }), null);

/* ============================================================
 * 七、统一入口
 * ==========================================================*/
console.log('\n七、统一入口 parseResult');

const plan119 = { keyword: 'The Godfather', keyword2: '教父', year: 1972, isTv: false };
eq('douban 走豆瓣解析', Linker.parseResult('douban', readJson('douban-suggest-tt0068646.json'), plan119),
  'https://movie.douban.com/subject/1291841/');
eq('bgm 走番组解析（带名字+年份）', Linker.parseResult('bgm', bgmGodfather, plan119), 'https://bgm.tv/subject/64965');
eq('tmdb 走 TMDB 解析（带名字+类型年份）', Linker.parseResult('tmdb', tmdbGodfather, plan119),
  'https://www.themoviedb.org/movie/238-the-godfather');
eq('未知站点 → 空', Linker.parseResult('steam', '{}', plan119), null);

/* ============================================================
 * 八、v2.5.73：站点识别 + 中文名抽取
 * ==========================================================*/
console.log('\n八、站点识别与中文名');

eq('imdb.com → imdb', Linker.siteOf('https://www.imdb.com/title/tt0185906/'), 'imdb');
eq('movie.douban.com → douban', Linker.siteOf('https://movie.douban.com/subject/1292052/'), 'douban');
eq('bgm.tv → bgm', Linker.siteOf('https://bgm.tv/subject/64965'), 'bgm');
eq('themoviedb.org → tmdb', Linker.siteOf('https://www.themoviedb.org/movie/238-the-godfather'), 'tmdb');
eq('别的站 → null', Linker.siteOf('https://store.steampowered.com/app/1/'), null);
eq('空地址 → null', Linker.siteOf(''), null);
// 别被「名字里含 imdb」的别人家域名骗了
eq('notimdb.com 不算 IMDb', Linker.siteOf('https://notimdb.com/x'), null);

// 豆瓣页的「名字」是中英混排 → 只取中文段（实测提取器就是这么拼的）
eq('中英混排 → 只取中文段', Linker.pickCnName('肖申克的救赎 The Shawshank Redemption'), '肖申克的救赎');
eq('纯中文 → 原样', Linker.pickCnName('教父'), '教父');
eq('纯日文连标点原样（拉丁字母都没出现，不动它）', Linker.pickCnName('君の名は。'), '君の名は。');
eq('纯英文 → 空（调用方退回英文原名）', Linker.pickCnName('The Godfather'), '');
eq('空 → 空', Linker.pickCnName(''), '');

/* ============================================================
 * 九、v2.5.73：TMDB 精确跳转（有编号时走这条，代替片名搜索）
 * ==========================================================*/
console.log('\n九、TMDB 精确跳转');

eq('电影落地地址 → 原样给回网址',
  Linker.parseRedirect('https://www.themoviedb.org/movie/238-the-godfather'),
  'https://www.themoviedb.org/movie/238-the-godfather');
eq('剧集落地地址',
  Linker.parseRedirect('https://www.themoviedb.org/tv/1396-breaking-bad'),
  'https://www.themoviedb.org/tv/1396-breaking-bad');
eq('落地地址带查询串也能切干净',
  Linker.parseRedirect('https://www.themoviedb.org/movie/278-the-shawshank-redemption?language=zh-CN'),
  'https://www.themoviedb.org/movie/278-the-shawshank-redemption');
// 实测：编号不存在时 TMDB 原地不动，最终地址还停在 /redirect 上
eq('编号不存在（原地不动）→ 留空',
  Linker.parseRedirect('https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=tt0000000'), null);
eq('空地址 → 留空', Linker.parseRedirect(''), null);
eq('落到人物页 → 留空（不是要的条目）',
  Linker.parseRedirect('https://www.themoviedb.org/person/3084'), null);

// parseResult 按「有没有编号」自动选路
const planWithTt = { imdbId: 'tt0068646', keyword: 'The Godfather', year: 1972, isTv: false };
eq('有编号 → 只看落地地址，不看正文',
  Linker.parseResult('tmdb', '', planWithTt, 'https://www.themoviedb.org/movie/238-the-godfather'),
  'https://www.themoviedb.org/movie/238-the-godfather');
eq('有编号但落地不动 → 空',
  Linker.parseResult('tmdb', '', planWithTt, 'https://www.themoviedb.org/redirect?external_source=imdb_id'), null);
eq('没编号 → 才去解析搜索页 HTML',
  Linker.parseResult('tmdb', tmdbGodfather, plan119, 'https://www.themoviedb.org/search?query=The%20Godfather'),
  'https://www.themoviedb.org/movie/238-the-godfather');

/* ============================================================
 * 十、v2.5.73：IMDB 这一格本地拼（豆瓣页 / 番组页自带编号）
 * ==========================================================*/
console.log('\n十、IMDB 本地拼');

eq('有 tt 编号 → 直接拼 IMDb 网址',
  Linker.imdbUrlOf({ imdbId: 'tt0068646' }), 'https://www.imdb.com/title/tt0068646/');
eq('没有编号 → 空（TMDB 页就是这种，要等 v2.5.74 的反查）',
  Linker.imdbUrlOf({ imdbId: null }), null);
eq('parseResult 的 imdb 分支根本不看响应',
  Linker.parseResult('imdb', '', { imdbId: 'tt0111161' }), 'https://www.imdb.com/title/tt0111161/');

// 目标字段一共四格
eq('目标字段 4 格', Linker.TARGETS.length, 4);
eq('四格字段名', Linker.TARGETS.map((t) => t.key).join(','), '豆瓣链接,IMDB,TMDB,Bangumi');

/* ============================================================
 * 十一、调用链加固（2026-10-26 真机事故复盘）
 *
 * 事故：modal-cross-site.js 把 pendingTargets() 返回的**对象数组**
 * 直接传给 buildRequests，而 buildRequests 里是 `kind === 'douban'` 比字符串，
 * 恒不相等 → 一个请求都不构造 → 上层 requests.length=0 直接 break
 * → 界面全显示「搜索不到」，没有任何报错。96 条单测全过，因为单测喂的是字符串数组。
 *
 * 所以这里补两类断言：① 对象入参也必须能用；② 拿真实调用链的产物端到端喂一遍。
 * ==========================================================*/
console.log('\n十一、调用链加固（对象入参 / 端到端）');

const objPlan = Linker.buildPlan(
  { '原作名': 'The Godfather', '上映日期': '1972/03/15', '影视类型': '电影' }, '');

eq('对象入参 {kind:"douban"} 也能构造出请求',
  Linker.buildRequests(objPlan, 1, [{ kind: 'douban', key: '豆瓣链接', label: '豆瓣' }]).length, 1);
eq('对象入参 {kind:"bgm"} 也能构造出请求',
  Linker.buildRequests(objPlan, 1, [{ kind: 'bgm' }])[0].kind, 'bgm');
eq('对象入参里混着 imdb 会被跳过（本地拼，不发请求）',
  Linker.buildRequests(objPlan, 1, [{ kind: 'imdb' }, { kind: 'bgm' }]).length, 1);
eq('空数组 → 没有请求', Linker.buildRequests(objPlan, 1, []).length, 0);

// 端到端：完全照 modal-cross-site.js 的用法走一遍
const e2eData = {
  '名字': '教父', '原作名': 'The Godfather', '上映日期': '1972/03/24', '影视类型': '电影',
  'IMDB': '', 'TMDB': 'https://www.themoviedb.org/movie/238-the-godfather',
  'Bangumi': '', '豆瓣链接': ''
};
const e2eUrl = 'https://www.themoviedb.org/movie/238-the-godfather';
const e2ePending = Linker.pendingTargets(e2eData, e2eUrl);
const e2eRequests = Linker.buildRequests(Linker.buildPlan(e2eData, e2eUrl), 1, e2ePending);
ok('端到端：TMDB 页 pendingTargets 的结果喂给 buildRequests 必须有请求（不能是 0）',
  e2eRequests.length >= 1, `实际 ${e2eRequests.length} 个`);
eq('端到端：要补的正好是豆瓣 + 番组计划',
  e2eRequests.map((r) => r.kind).sort().join(','), 'bgm,douban');
ok('端到端：TMDB 自己那一格不出现在请求里',
  e2eRequests.every((r) => r.kind !== 'tmdb'));

// 反向：如果 pendingTargets 返回空（三格都有值），就不该有任何请求
const fullData = { '豆瓣链接': 'a', 'IMDB': 'b', 'TMDB': 'c', 'Bangumi': 'd' };
eq('三格都有值时 → 零请求',
  Linker.buildRequests(Linker.buildPlan(fullData, ''), 1, Linker.pendingTargets(fullData, '')).length, 0);

/* ============================================================
 * 十二、TMDB → IMDB 反查（v2.5.75 批 2）
 *
 * 这一节为什么写得细：这条链是「猜候选 + 回来验证」两步，
 * 任何一步的入参形状错了（把对象当字符串、tt 号顺序错位）
 * 都会静默退化成「搜索不到」，界面不报错 —— 上次真机 28/36 全灭
 * 就是这么来的。所以除了算法本身，末尾还有按真实调用链**形状**
 * 走一遍的端到端断言。
 *
 * 存档来源：tests/fixtures/json/imdb-suggest-*.json 是 2026-10-26
 * 从 v3.sg.media-imdb.com 抓的原始响应，不是手工编的。
 * ==========================================================*/

/* ---- 12.1 当前页是 TMDB 哪一条 ---- */
eq('tmdbPageOf：电影条目页',
  JSON.stringify(Linker.tmdbPageOf('https://www.themoviedb.org/movie/238-the-godfather')),
  JSON.stringify({ kind: 'movie', id: '238' }));
eq('tmdbPageOf：剧集条目页（后面还有季/集也认）',
  JSON.stringify(Linker.tmdbPageOf('https://www.themoviedb.org/tv/4613-band-of-brothers/season/1')),
  JSON.stringify({ kind: 'tv', id: '4613' }));
eq('tmdbPageOf：带 ?language=zh-CN 也认',
  JSON.stringify(Linker.tmdbPageOf('https://www.themoviedb.org/movie/238-the-godfather?language=zh-CN')),
  JSON.stringify({ kind: 'movie', id: '238' }));
eq('tmdbPageOf：人物页不认（没有号可验）',
  Linker.tmdbPageOf('https://www.themoviedb.org/person/3084-al-pacino'), null);
eq('tmdbPageOf：列表页不认（/movie 后面没数字）',
  Linker.tmdbPageOf('https://www.themoviedb.org/movie'), null);
eq('tmdbPageOf：别的站不认',
  Linker.tmdbPageOf('https://movie.douban.com/subject/1292052/'), null);
eq('tmdbPageOf：空值不认', Linker.tmdbPageOf(''), null);
eq('tmdbPageOf：域名字符串里带 themoviedb 但主机不是它，不认',
  Linker.tmdbPageOf('https://evil.com/themoviedb.org/movie/238'), null);

/* ---- 12.2 建议接口地址 ---- */
eq('imdbSuggestUrl：中文要编码',
  Linker.imdbSuggestUrl('教父'),
  'https://v3.sg.media-imdb.com/suggestion/x/%E6%95%99%E7%88%B6.json');
eq('imdbSuggestUrl：空格编码成 %20',
  Linker.imdbSuggestUrl('The Godfather'),
  'https://v3.sg.media-imdb.com/suggestion/x/The%20Godfather.json');
eq('imdbSuggestUrl：空词返回 null', Linker.imdbSuggestUrl('   '), null);

/* ---- 12.3 解析建议响应 ---- */
const sugGodCn = Linker.parseImdbSuggest(readJson('imdb-suggest-godfather-cn.json'));
ok('parseImdbSuggest：中文名搜「教父」解析出 8 条候选',
  Array.isArray(sugGodCn) && sugGodCn.length === 8, `实际 ${sugGodCn && sugGodCn.length}`);
eq('parseImdbSuggest：第一条就是《教父》', sugGodCn[0].id, 'tt0068646');
eq('parseImdbSuggest：年份转成数字', sugGodCn[0].year, 1972);
eq('parseImdbSuggest：类型 qid 保留', sugGodCn[0].qid, 'movie');
eq('parseImdbSuggest：标题保留', sugGodCn[0].name, 'The Godfather');

const sugGodEn = Linker.parseImdbSuggest(readJson('imdb-suggest-godfather-en.json'));
ok('parseImdbSuggest：英文搜索的存档里确实混着人物（nm0113768）',
  /nm0113768/.test(readJson('imdb-suggest-godfather-en.json')));
ok('parseImdbSuggest：nm 开头的人物一律丢掉',
  sugGodEn.every((c) => /^tt\d{7,}$/.test(c.id)));
eq('parseImdbSuggest：坏 JSON 返回 null', Linker.parseImdbSuggest('not json'), null);
eq('parseImdbSuggest：空数组返回 null', Linker.parseImdbSuggest('{"d":[]}'), null);
eq('parseImdbSuggest：没有 d 字段返回 null', Linker.parseImdbSuggest('{}'), null);
eq('parseImdbSuggest：只有人物时返回 null（全被过滤）',
  Linker.parseImdbSuggest('{"d":[{"id":"nm0000206","l":"Keanu Reeves"}]}'), null);
eq('parseImdbSuggest：有 y 用 y', Linker.parseImdbSuggest('{"d":[{"id":"tt0000001","l":"X","y":1999,"tl":"1999"}]}')[0].year, 1999);
eq('parseImdbSuggest：没有 y 时从 tl 取年份',
  Linker.parseImdbSuggest('{"d":[{"id":"tt0000002","l":"X","tl":"1987 TV Series"}]}')[0].year, 1987);

/* ---- 12.4 候选排序（只决定先问谁，不决定留谁） ---- */
const godRankPlan = { keyword: 'The Godfather', cnKeyword: '教父', year: 1972, isTv: false };
const godRanked = Linker.rankImdbCandidates(sugGodCn, godRankPlan, 4);
eq('排序：电影《教父》排第一', godRanked[0], 'tt0068646');
eq('排序：最多留 4 个', godRanked.length, 4);
ok('排序：《教父2》比《The Outsiders》靠前（名字+类型对得上）',
  godRanked.indexOf('tt0071562') !== -1 &&
  (godRanked.indexOf('tt0086066') === -1 || godRanked.indexOf('tt0071562') < godRanked.indexOf('tt0086066')));

const bobPlan2 = { keyword: 'Band of Brothers', cnKeyword: '兄弟连', year: 2001, isTv: true };
const bobCands2 = Linker.parseImdbSuggest(readJson('imdb-suggest-bob-cn.json'));
eq('排序：剧集身份下《兄弟连》排第一',
  Linker.rankImdbCandidates(bobCands2, bobPlan2, 4)[0], 'tt0185906');

// 关键红线：名字对不上一律不许丢。中文名搜出来的 l 全是英文标题，
// nameScore 必然 0 分，这时候过滤掉就等于把正确答案扔了。
eq('排序：名字完全对不上也不许丢（中文搜出来的标题是英文）',
  Linker.rankImdbCandidates([{ id: 'tt9999999', name: '', year: null, qid: 'movie' }], godRankPlan, 4).length, 1);
eq('排序：同一个 tt 重复出现只留一个',
  Linker.rankImdbCandidates([sugGodCn[0], sugGodCn[0]], godRankPlan, 4).length, 1);
eq('排序：空候选返回空数组', Linker.rankImdbCandidates([], godRankPlan, 4).length, 0);
eq('排序：不传 limit 时全给',
  Linker.rankImdbCandidates(sugGodCn, godRankPlan).length, 8);

/* ---- 12.5 验证判定：同号才算数 ---- */
const page238 = { kind: 'movie', id: '238' };
ok('imdbVerified：同号命中（tt0068646 → movie/238）',
  Linker.imdbVerified('tt0068646', 'https://www.themoviedb.org/movie/238-the-godfather', page238));
ok('imdbVerified：错候选会被拦下（tt0086066 → movie/227）',
  !Linker.imdbVerified('tt0086066', 'https://www.themoviedb.org/movie/227-the-outsiders', page238));
ok('imdbVerified：类型不同不算（电影页却落在 tv）',
  !Linker.imdbVerified('tt0068646', 'https://www.themoviedb.org/tv/238-x', page238));
ok('imdbVerified：号码不存在时 TMDB 原地不动 → 不算',
  !Linker.imdbVerified('tt0000000', 'https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=tt0000000', page238));
ok('imdbVerified：落地地址带语言参数也认',
  Linker.imdbVerified('tt0068646', 'https://www.themoviedb.org/movie/238-the-godfather?language=zh-CN', page238));
ok('imdbVerified：编号前缀相同但不同号不算（2380 ≠ 238）',
  !Linker.imdbVerified('tt0068646', 'https://www.themoviedb.org/movie/2380-other', page238));
ok('imdbVerified：没有当前页身份时一律不算',
  !Linker.imdbVerified('tt0068646', 'https://www.themoviedb.org/movie/238-x', null));
ok('imdbVerified：空 tt 不算',
  !Linker.imdbVerified('', 'https://www.themoviedb.org/movie/238-x', page238));
const page4613 = { kind: 'tv', id: '4613' };
ok('imdbVerified：剧集同号命中（tt0185906 → tv/4613）',
  Linker.imdbVerified('tt0185906', 'https://www.themoviedb.org/tv/4613-band-of-brothers', page4613));
ok('imdbVerified：剧集的号拿去验电影页不算',
  !Linker.imdbVerified('tt0185906', 'https://www.themoviedb.org/tv/4613-band-of-brothers', page238));

/* ---- 12.6 从一批验证结果里挑命中 ---- */
eq('pickVerifiedImdb：跳过错的、取命中的',
  Linker.pickVerifiedImdb(page238, [
    { id: 'tt0086066', finalUrl: 'https://www.themoviedb.org/movie/227-the-outsiders' },
    { id: 'tt0068646', finalUrl: 'https://www.themoviedb.org/movie/238-the-godfather' }
  ]), 'https://www.imdb.com/title/tt0068646/');
eq('pickVerifiedImdb：一条都对不上就返回 null（宁可留空）',
  Linker.pickVerifiedImdb(page238, [
    { id: 'tt0086066', finalUrl: 'https://www.themoviedb.org/movie/227-the-outsiders' }
  ]), null);
eq('pickVerifiedImdb：空数组返回 null', Linker.pickVerifiedImdb(page238, []), null);
eq('pickVerifiedImdb：没有当前页身份返回 null',
  Linker.pickVerifiedImdb(null, [{ id: 'tt0068646', finalUrl: 'https://www.themoviedb.org/movie/238-x' }]), null);
eq('pickVerifiedImdb：返回的网址以斜杠收尾',
  Linker.pickVerifiedImdb(page4613, [{ id: 'tt0185906', finalUrl: 'https://www.themoviedb.org/tv/4613-band-of-brothers' }]),
  'https://www.imdb.com/title/tt0185906/');

/* ---- 12.7 请求构造 ---- */
const sugReqs2 = Linker.imdbSuggestRequests(['教父', 'The Godfather']);
eq('建议请求：两个词两条', sugReqs2.length, 2);
eq('建议请求：kind 依次是 imdbs0/imdbs1', sugReqs2.map((r) => r.kind).join(','), 'imdbs0,imdbs1');
ok('建议请求：都打到 v3.sg.media-imdb.com（权限清单里必须有这个域）',
  sugReqs2.every((r) => r.url.indexOf('https://v3.sg.media-imdb.com/suggestion/x/') === 0));
eq('建议请求：空词不构造', Linker.imdbSuggestRequests(['', '  ']).length, 0);
eq('建议请求：没传词返回空数组', Linker.imdbSuggestRequests().length, 0);

const verReqs2 = Linker.imdbVerifyRequests(['tt0068646', 'tt0086066', 'tt0111161', 'tt0185906', 'tt15398776']);
eq('验证请求：最多 4 个（再多的候选也不问）', verReqs2.length, 4);
ok('验证请求：只要落地地址（urlOnly，不下载 150KB 页面）',
  verReqs2.every((r) => r.urlOnly === true));
ok('验证请求：都走 TMDB 的 imdb_id 映射端点',
  verReqs2.every((r) => r.url.indexOf('themoviedb.org/redirect?external_source=imdb_id&external_id=') !== -1));
eq('验证请求：kind 依次是 imdbv0..3',
  verReqs2.map((r) => r.kind).join(','), 'imdbv0,imdbv1,imdbv2,imdbv3');
eq('验证请求：第一个带的是第一个 tt 号',
  verReqs2[0].url.indexOf('tt0068646') !== -1, true);

/* ---- 12.8 端到端：按真实调用链的形状走一遍 ---- */
// 模拟 TMDB《教父》页：IMDB 格空着，其余三格已填
const revData = {
  '名字': '教父', '原作名': 'The Godfather', '上映日期': '1972-03-14',
  '影视类型': '电影', 'TMDB': 'https://www.themoviedb.org/movie/238-the-godfather',
  '豆瓣链接': 'https://movie.douban.com/subject/1291841/', 'Bangumi': '', 'IMDB': ''
};
const revUrl = 'https://www.themoviedb.org/movie/238-the-godfather';
const revPlan = Linker.buildPlan(revData, revUrl);
const revPending = Linker.pendingTargets(revData, revUrl);

ok('端到端：TMDB 页的待补清单里有 IMDB（v2.5.75 新能力）',
  revPending.some((t) => t.kind === 'imdb'));
ok('端到端：TMDB 自己那一格不在待补里',
  revPending.every((t) => t.kind !== 'tmdb'));
ok('端到端：IMDB 不会被 buildRequests 变成请求（它走专用反查链）',
  Linker.buildRequests(revPlan, 1, revPending).every((r) => r.kind !== 'imdb'));

// 编排层挑词：中文名优先、再英文原名，去重后最多两个
const revWords = [revPlan.cnKeyword, revPlan.keyword, revPlan.keyword2]
  .filter((w, i, a) => w && a.indexOf(w) === i).slice(0, 2);
eq('端到端：搜索词是「中文名 + 原名」', revWords.join('|'), '教父|The Godfather');

// 后台回来的两条建议响应（真机存档）
let revCands = [];
[readJson('imdb-suggest-godfather-cn.json'), readJson('imdb-suggest-godfather-en.json')].forEach((t) => {
  const list = Linker.parseImdbSuggest(t);
  if (list) revCands = revCands.concat(list);
});
const revIds = Linker.rankImdbCandidates(revCands, {
  isTv: false, year: revPlan.year, cnKeyword: revPlan.cnKeyword, keyword: revPlan.keyword
}, 4);
eq('端到端：排第一的候选就是 tt0068646', revIds[0], 'tt0068646');
eq('端到端：验证请求按同样的顺序生成',
  Linker.imdbVerifyRequests(revIds).map((r) => r.kind).join(','), 'imdbv0,imdbv1,imdbv2,imdbv3');

// 后台回来的验证结果：只列真机实测过的两条（238 命中 / 227 落空），
// 其余当成「没回来」丢掉 —— 这正是真实场景里常见的样子。
const realLanding = {
  tt0068646: 'https://www.themoviedb.org/movie/238-the-godfather',
  tt0086066: 'https://www.themoviedb.org/movie/227-the-outsiders'
};
const revChecked = revIds.map((id) => ({ id, finalUrl: realLanding[id] })).filter((c) => c.finalUrl);
// 再补一条「验证回来了、但落在别的条目」的（真机实测 tt0086066 → movie/227），
// 用来钉死「错的候选会被跳过」这件事。
revChecked.push({ id: 'tt0086066', finalUrl: 'https://www.themoviedb.org/movie/227-the-outsiders' });
eq('端到端：验证回来 2 条（一条命中、一条落空）', revChecked.length, 2);
eq('端到端：最终写出 IMDb 网址',
  Linker.pickVerifiedImdb(Linker.tmdbPageOf(revUrl), revChecked),
  'https://www.imdb.com/title/tt0068646/');
eq('端到端：候选全对不上时留空，绝不写「最像的那条」',
  Linker.pickVerifiedImdb(Linker.tmdbPageOf(revUrl), [
    { id: 'tt0086066', finalUrl: 'https://www.themoviedb.org/movie/227-the-outsiders' }
  ]), null);

// 剧集侧：TMDB tv/4613《兄弟连》
const tvData = {
  '名字': '兄弟连', '原作名': 'Band of Brothers', '上映日期': '2001-09-09',
  '影视类型': '剧集', 'TMDB': 'https://www.themoviedb.org/tv/4613-band-of-brothers'
};
const tvUrl = tvData['TMDB'];
const tvPlan = Linker.buildPlan(tvData, tvUrl);
eq('端到端(剧集)：身份判定看地址而不是字段', Linker.tmdbPageOf(tvUrl).kind, 'tv');
const tvInds = Linker.rankImdbCandidates(
  Linker.parseImdbSuggest(readJson('imdb-suggest-bob-cn.json')),
  { isTv: true, year: tvPlan.year, cnKeyword: tvPlan.cnKeyword, keyword: tvPlan.keyword }, 4);
eq('端到端(剧集)：候选是 tt0185906', tvInds[0], 'tt0185906');
eq('端到端(剧集)：验证命中写出 IMDb 网址',
  Linker.pickVerifiedImdb(Linker.tmdbPageOf(tvUrl), [
    { id: 'tt0185906', finalUrl: 'https://www.themoviedb.org/tv/4613-band-of-brothers' }
  ]), 'https://www.imdb.com/title/tt0185906/');

/* ---- 12.9 分批验证（v2.5.76）----
 * 为什么分批：4 个候选一次并发问完时，真机上约 6 次会撞 1 次限流。
 * 先问最有把握的那一个，命中就收工（常见情况只花 1 条请求）。 */
const r4 = Linker.imdbVerifyRounds(['tt0068646', 'tt0071562', 'tt0086066', 'tt0099674']);
eq('分批：4 个号分 2 批', r4.length, 2);
eq('分批：第一批只有最有把握的那一个', r4[0].join(','), 'tt0068646');
eq('分批：第二批是剩下的 3 个', r4[1].join(','), 'tt0071562,tt0086066,tt0099674');
eq('分批：展平后顺序不变（顺序就是优先级，不能打乱）',
  r4[0].concat(r4[1]).join(','), 'tt0068646,tt0071562,tt0086066,tt0099674');
eq('分批：只有 1 个号时只发 1 批', Linker.imdbVerifyRounds(['tt0068646']).length, 1);
eq('分批：空数组返回空', Linker.imdbVerifyRounds([]).length, 0);
eq('分批：不传参数返回空', Linker.imdbVerifyRounds().length, 0);
eq('分批：5 个号只取前 4 个（后台单次上限 6，留余量）',
  Linker.imdbVerifyRounds(['a','b','c','d','e'])[1].length, 3);
eq('分批：空字符串会被滤掉', Linker.imdbVerifyRounds(['', 'tt1'])[0].join(','), 'tt1');
ok('分批：吐出来的是字符串，不是对象（v2.5.74 静默事故的形状）',
  r4.every((b) => b.every((x) => typeof x === 'string')));
// 每批的请求 kind 必须从 imdbv0 重新编号，否则后台回来的键对不上
const r4req0 = Linker.imdbVerifyRequests(r4[0]);
const r4req1 = Linker.imdbVerifyRequests(r4[1]);
eq('分批：第一批请求 kind 是 imdbv0', r4req0[0].kind, 'imdbv0');
eq('分批：第二批请求 kind 也从 imdbv0 开始', r4req1[0].kind, 'imdbv0');
eq('分批：第二批 3 条请求编号连续', r4req1.map((r) => r.kind).join(','), 'imdbv0,imdbv1,imdbv2');
ok('分批：第二批请求的 tt 号与批次一致',
  r4req1[2].url.indexOf('tt0099674') !== -1);
// 端到端：分批输入直接来自真实排序链的输出
eq('分批(端到端)：rankImdbCandidates 的输出展平后与直接验证的顺序一致',
  Linker.imdbVerifyRounds(revIds)[0]
    .concat(Linker.imdbVerifyRounds(revIds)[1] || [])
    .join(','), revIds.join(','));

/* ============================================================
 * 十三、书籍「URL」补齐（v2.5.76）
 *
 * 这一节按用户 2026-10-26 拍板的四条规则写：
 *   1. Goodreads 优先   2. 两个都命中要带「番组也有」
 *   3. 番组只认主条目   4. 不做繁简转换
 * 存档来源：tests/fixtures/json/bgm-book-*.json 是 2026-10-26
 * 真机 Service Worker 里抓的番组原始响应，不是手工编的。
 * ==========================================================*/

/* ---- 13.1 当前页是不是豆瓣书籍页 ---- */
ok('isDoubanBookPage：书籍条目页', Linker.isDoubanBookPage('https://book.douban.com/subject/5906052/'));
ok('isDoubanBookPage：带查询参数也认', Linker.isDoubanBookPage('https://book.douban.com/subject/5906052/?from=tag'));
eq('isDoubanBookPage：电影页不算', Linker.isDoubanBookPage('https://movie.douban.com/subject/1292052/'), false);
eq('isDoubanBookPage：豆瓣首页不算', Linker.isDoubanBookPage('https://www.douban.com/book/'), false);
eq('isDoubanBookPage：空值不算', Linker.isDoubanBookPage(''), false);
eq('isDoubanBookPage：冒充域名不算', Linker.isDoubanBookPage('https://evil.com/book.douban.com/subject/1/'), false);

/* ---- 13.2 拆卷号（这是「只认主条目」的地基）---- */
const volCases = [
  ['鬼滅の刃 (1)', '鬼滅の刃', 1],
  ['鬼滅の刃（1）', '鬼滅の刃', 1],
  ['進撃の巨人 01', '進撃の巨人', 1],
  ['名侦探柯南1', '名侦探柯南', 1],
  ['灌篮高手31', '灌篮高手', 31],
  ['鬼滅の刃 第3巻', '鬼滅の刃', 3],
  ['ONE PIECE vol.5', 'ONE PIECE', 5],
  ['灌篮高手（全31卷）', '灌篮高手', null],
  ['三体', '三体', null],
  ['三体Ⅱ：黑暗森林', '三体Ⅱ：黑暗森林', null],
  ['2046', '2046', null],
  ['SLAM DUNK 完全版', 'SLAM DUNK 完全版', null],
  ['Le Petit Prince', 'Le Petit Prince', null],
  ['', '', null]
];
volCases.forEach((c) => {
  const r = Linker.splitVol(c[0]);
  eq('splitVol(' + JSON.stringify(c[0]) + ')：主体', r.base, c[1]);
  eq('splitVol(' + JSON.stringify(c[0]) + ')：卷号', r.vol, c[2]);
});
// 「完全版 / 新装再編版」必须当成独立作品名，不能被削成「灌篮高手」——
// 削了就分不清主条目和完全版了，会把完全版当原作写进去。
ok('splitVol：「完全版」不是卷号，名字要原样留着',
  Linker.splitVol('SLAM DUNK 完全版').base === 'SLAM DUNK 完全版');

/* ---- 13.3 归一化 ---- */
eq('normBookKey：全角转半角 + 去空格 + 转小写',
  Linker.normBookKey('ＳＬＡＭ　ＤＵＮＫ'), 'slamdunk');
eq('normBookKey：去标点冒号', Linker.normBookKey('三体：黑暗森林'), '三体黑暗森林');
eq('normBookKey：英文大小写不敏感', Linker.normBookKey('Le Petit Prince'), 'lepetitprince');
eq('normBookKey：空值', Linker.normBookKey(null), '');

/* ---- 13.4 组装书籍计划 ---- */
const santiData = { '书名': '三体', '原作名': '', 'ISBN': '9787536692930', '别名': '', '作者': '刘慈欣' };
const santiPlan = Linker.buildBookPlan(santiData);
eq('计划(三体)：搜索词只有书名', santiPlan.words.join('|'), '三体');
eq('计划(三体)：比对键', santiPlan.keys.join('|'), '三体');
eq('计划(三体)：ISBN 洗干净', santiPlan.isbn, '9787536692930');
eq('计划(三体)：没有卷号', santiPlan.vol, null);

// 日文原作名优先：用户 2026-10-26「日文书/日文别名在番组命中率很高」
const kikiPlan = Linker.buildBookPlan({
  '书名': '鬼滅之刃 1', '原作名': '鬼滅の刃 1', 'ISBN': '978-986-486-783-7', '别名': '', '作者': '吾峠呼世晴'
});
eq('计划(鬼灭)：原作名排第一（去卷号）', kikiPlan.words[0], '鬼滅の刃');
eq('计划(鬼灭)：中文书名第二', kikiPlan.words[1], '鬼滅之刃');
eq('计划(鬼灭)：ISBN 带横线也洗干净', kikiPlan.isbn, '9789864867837');
eq('计划(鬼灭)：卷号记下来了（只进调试，不参与挑选）', kikiPlan.vol, 1);

// 别名里的假名排在书名前面：没有原作名时它是唯一能撞上日文原名的东西
const aliasPlan = Linker.buildBookPlan({
  '书名': '某本台版书', '原作名': '', 'ISBN': '', '别名': 'ほげほげ, 某本台版书'
});
eq('计划(别名)：含假名的别名排在书名前', aliasPlan.words.join('|'), 'ほげほげ|某本台版书');
ok('计划(别名)：别名的本体也进比对键', aliasPlan.keys.indexOf('某本台版书') !== -1);

eq('计划：搜索词最多 2 个', Linker.buildBookPlan({
  '书名': '甲', '原作名': '乙', '别名': '丙丁, 戊己'
}).words.length, 2);
eq('计划：全空时不炸', Linker.buildBookPlan(null).words.length, 0);

/* ---- 13.5 Goodreads ISBN 直达 ---- */
eq('goodreadsIsbnUrl：13 位', Linker.goodreadsIsbnUrl('9787020042494'),
  'https://www.goodreads.com/book/isbn/9787020042494');
eq('goodreadsIsbnUrl：带横线也认', Linker.goodreadsIsbnUrl('978-7-02-004249-4'),
  'https://www.goodreads.com/book/isbn/9787020042494');
eq('goodreadsIsbnUrl：10 位也认', Linker.goodreadsIsbnUrl('0156012195'),
  'https://www.goodreads.com/book/isbn/0156012195');
eq('goodreadsIsbnUrl：位数不对 → null', Linker.goodreadsIsbnUrl('12345'), null);
eq('goodreadsIsbnUrl：空值 → null', Linker.goodreadsIsbnUrl(''), null);
eq('cleanIsbn：末位 X 保留', Linker.cleanIsbn('080442957x'), '080442957X');

// 判据就是「落地地址变成 /book/show/<id>」——不是 200 就算命中
eq('parseGoodreadsIsbn：带 slug 也归一成纯编号',
  Linker.parseGoodreadsIsbn('https://www.goodreads.com/book/show/33550329-the-little-prince'),
  'https://www.goodreads.com/book/show/33550329');
eq('parseGoodreadsIsbn：带查询参数去掉',
  Linker.parseGoodreadsIsbn('https://www.goodreads.com/book/show/9574008?from_search=true'),
  'https://www.goodreads.com/book/show/9574008');
eq('parseGoodreadsIsbn：没跳转（停在 /book/isbn/）→ null',
  Linker.parseGoodreadsIsbn('https://www.goodreads.com/book/isbn/9787806649343'), null);
eq('parseGoodreadsIsbn：空值 → null', Linker.parseGoodreadsIsbn(''), null);
ok('goodreadsIsbnRequest：只要落地地址，不下载整页',
  Linker.goodreadsIsbnRequest('9787020042494').urlOnly === true);

/* ---- 13.6 番组书籍搜索解析 ---- */
const kikiCands = Linker.parseBgmBookSearch(readJson('bgm-book-kiki.json'));
ok('parseBgmBookSearch：鬼滅の刃 解析出候选', Array.isArray(kikiCands) && kikiCands.length === 20);
const kikiMain = kikiCands.find((x) => x.id === '168891');
eq('parseBgmBookSearch：主条目没有卷号', kikiMain.vol, null);
eq('parseBgmBookSearch：主条目中文名', kikiMain.cn, '鬼灭之刃');
eq('parseBgmBookSearch：分卷条目识别出卷号',
  kikiCands.find((x) => x.id === '184225').vol, 1);
eq('parseBgmBookSearch：分卷条目主体', kikiCands.find((x) => x.id === '184225').nameKey, '鬼滅の刃');

const santiCands = Linker.parseBgmBookSearch(readJson('bgm-book-santi.json'));
eq('parseBgmBookSearch：santi 第 1 条 id', santiCands[0].id, '9585');
eq('parseBgmBookSearch：santi 第 1 条 ISBN（从 infobox 取）', santiCands[0].isbn, '9787536692930');
eq('parseBgmBookSearch：坏 JSON → null', Linker.parseBgmBookSearch('not json'), null);
eq('parseBgmBookSearch：空数组 → null', Linker.parseBgmBookSearch('{"data":[]}'), null);

/* ---- 13.7 挑主条目（用户规则 3 的落点）---- */
const sanHit = Linker.pickBgmBookMain(santiCands, santiPlan);
eq('pick(三体)：命中主条目 9585', sanHit && sanHit.url, 'https://bgm.tv/subject/9585');
eq('pick(三体)：带出条目名（调试用）', sanHit && sanHit.name, '三体');

// ⚠️ 这条是本批最重要的红线断言（用户规则 3）：
// 候选里全是分卷时，必须一个都不收。这里用合成数据，因为它要钉的是「规则」本身，
// 不能依赖某份存档里恰好有没有主条目。
const volOnlyCands = Linker.parseBgmBookSearch(JSON.stringify({ data: [
  { id: 101, name: '鬼滅の刃 (1)', name_cn: '', infobox: [] },
  { id: 102, name: '鬼滅の刃 (2)', name_cn: '', infobox: [] },
  { id: 103, name: '鬼滅の刃 第3巻', name_cn: '', infobox: [] }
]}));
ok('pick：前提成立 —— 这三条都被判成分卷', volOnlyCands.every((x) => x.vol !== null));
eq('pick：候选全是分卷 → 不写（只认主条目）',
  Linker.pickBgmBookMain(volOnlyCands, kikiPlan), null);

// 真机存档的两份「鬼滅の刃」搜索：带卷号搜 / 去卷号搜，主条目都能拿到。
// 带卷号那份里主条目排在第 12 位 —— 说明「多取 20 条」这个 limit 是必要的。
const kikiVolSearch = Linker.parseBgmBookSearch(readJson('bgm-book-kiki1.json'));
ok('pick：带卷号搜（鬼滅の刃 1）的存档里也混着主条目，且被挑出来',
  Linker.pickBgmBookMain(kikiVolSearch, kikiPlan).url === 'https://bgm.tv/subject/168891');
eq('pick：去卷号搜（鬼滅の刃）同样命中主条目',
  Linker.pickBgmBookMain(kikiCands, kikiPlan).url, 'https://bgm.tv/subject/168891');

// 原名对得上 > 只有中文名对得上
const tierCands = Linker.parseBgmBookSearch(JSON.stringify({ data: [
  { id: 1, name: '三体漫画 : 第一部', name_cn: '三体', infobox: [] },
  { id: 2, name: '三体', name_cn: '', infobox: [] }
]}));
eq('pick：原名对得上的赢过只有中文名对得上的',
  Linker.pickBgmBookMain(tierCands, santiPlan).url, 'https://bgm.tv/subject/2');

// ISBN 一致额外加分（番组主条目常常没有 ISBN，所以只当加分不当门槛）
const isbnCands = Linker.parseBgmBookSearch(JSON.stringify({ data: [
  { id: 20, name: '小王子', name_cn: '', infobox: [] },
  { id: 21, name: '小王子', name_cn: '', infobox: [{ key: 'ISBN', value: '9787020042494' }] }
]}));
eq('pick：同分时 ISBN 命中的赢',
  Linker.pickBgmBookMain(isbnCands, Linker.buildBookPlan({
    '书名': '小王子', 'ISBN': '9787020042494'
  })).url, 'https://bgm.tv/subject/21');

// 完全版/新装版是独立作品，名字必须完全相等才收
const kanzenCands = Linker.parseBgmBookSearch(JSON.stringify({ data: [
  { id: 30, name: 'SLAM DUNK 完全版', name_cn: '灌篮高手 完全版', infobox: [] }
]}));
eq('pick：名字差一个字（完全版）就不收',
  Linker.pickBgmBookMain(kanzenCands, Linker.buildBookPlan({ '书名': '灌篮高手（全31卷）' })), null);
eq('pick：但用户自己就要完全版时能对上',
  Linker.pickBgmBookMain(kanzenCands, Linker.buildBookPlan({ '书名': '灌篮高手 完全版' })).url,
  'https://bgm.tv/subject/30');

eq('pick：没有比对键 → null', Linker.pickBgmBookMain(santiCands, { keys: [] }), null);
eq('pick：候选为空 → null', Linker.pickBgmBookMain([], santiPlan), null);
eq('pick：不传候选 → null', Linker.pickBgmBookMain(null, santiPlan), null);

/* ---- 13.8 定胜负（用户规则 1）---- */
eq('pickBookUrl：两个都有 → 用 Goodreads', Linker.pickBookUrl('https://www.goodreads.com/book/show/1', 'https://bgm.tv/subject/2').url,
  'https://www.goodreads.com/book/show/1');
eq('pickBookUrl：两个都有 → 标记番组也有', Linker.pickBookUrl('https://www.goodreads.com/book/show/1', 'https://bgm.tv/subject/2').alsoBgm, true);
eq('pickBookUrl：只有番组 → 用番组', Linker.pickBookUrl(null, 'https://bgm.tv/subject/2').source, 'bgm');
eq('pickBookUrl：只有番组 → 不标「番组也有」', Linker.pickBookUrl(null, 'https://bgm.tv/subject/2').alsoBgm, false);
eq('pickBookUrl：都没有 → null', Linker.pickBookUrl(null, null), null);
eq('pickBookUrl：空字符串也当没有', Linker.pickBookUrl('', ''), null);

/* ---- 13.9 请求组装 ---- */
const kikiReqs = Linker.bookRequests(kikiPlan);
eq('请求：ISBN + 两个词 = 3 条', kikiReqs.length, 3);
eq('请求：顺序是 grisbn → bgmb0 → bgmb1',
  kikiReqs.map((r) => r.kind).join(','), 'grisbn,bgmb0,bgmb1');
ok('请求：Goodreads 走 ISBN 直达且只要落地地址',
  kikiReqs[0].url.indexOf('goodreads.com/book/isbn/9789864867837') !== -1 && kikiReqs[0].urlOnly === true);
ok('请求：番组书籍的 type 必须是 [1]（影视是 [2,6]，不能混）',
  kikiReqs.slice(1).every((r) => JSON.parse(r.body).filter.type.join(',') === '1'));
ok('请求：番组搜索词是去掉卷号的主体',
  JSON.parse(kikiReqs[1].body).keyword === '鬼滅の刃');
eq('请求：没 ISBN 就只发番组', Linker.bookRequests(Linker.buildBookPlan({ '书名': '三体' })).map((r) => r.kind).join(','), 'bgmb0');
eq('请求：没书名就只发 Goodreads',
  Linker.bookRequests({ isbn: '9787020042494', words: [] }).map((r) => r.kind).join(','), 'grisbn');
eq('请求：什么都没有 → 空', Linker.bookRequests({ isbn: '', words: [] }).length, 0);

/* ---- 13.10 端到端：按真实调用链的形状走一遍 ---- */
// 模拟豆瓣《三体》页：URL 为空，其余字段是提取器真实会填的
const bkE2eData = {
  '书名': '三体', '作者': '刘慈欣', '原作名': '', '别名': '',
  'ISBN': '9787536692930', '豆瓣链接': 'https://book.douban.com/subject/2567698/', 'URL': ''
};
const bkE2ePlan = Linker.buildBookPlan(bkE2eData);
const bkE2eReqs = Linker.bookRequests(bkE2ePlan);
ok('端到端：URL 为空、有豆瓣链接 → 正是该补的状态',
  bkE2eData['URL'] === '' && !!bkE2eData['豆瓣链接']);
eq('端到端：发出的请求是 1 条 Goodreads + 1 条番组',
  bkE2eReqs.map((r) => r.kind).join(','), 'grisbn,bgmb0');

// 后台回来的两条响应（Goodreads 真机落地地址 + 番组真机存档）
const bkGrUrl = 'https://www.goodreads.com/book/show/9574008';
const bkBgmHit = Linker.pickBgmBookMain(Linker.parseBgmBookSearch(readJson('bgm-book-santi.json')), bkE2ePlan);
const bkPicked = Linker.pickBookUrl(Linker.parseGoodreadsIsbn(bkGrUrl), bkBgmHit && bkBgmHit.url);
eq('端到端：最终写进 URL 的是 Goodreads', bkPicked.url, 'https://www.goodreads.com/book/show/9574008');
eq('端到端：提示里要带「番组也有」（用户规则 2）', bkPicked.alsoBgm, true);

// Goodreads 没这一版时，番组兜底
const bkFallback = Linker.pickBookUrl(Linker.parseGoodreadsIsbn('https://www.goodreads.com/book/isbn/9787536692930'), bkBgmHit.url);
eq('端到端：Goodreads 落空 → 用番组主条目', bkFallback.url, 'https://bgm.tv/subject/9585');
eq('端到端：这一格的来源是番组', bkFallback.source, 'bgm');

// 两站都没有 → 留空（宁空不错）
eq('端到端：两站都没有 → 不写任何东西',
  Linker.pickBookUrl(null, null), null);

/* ============================================================
 * 汇总
 * ==========================================================*/
console.log('\n' + '='.repeat(52));
if (fails.length === 0) {
  console.log(`✅ 全部通过：${pass} 条断言`);
  process.exit(0);
} else {
  console.log(`❌ 失败 ${fails.length} 条（共 ${pass + fails.length} 条）`);
  fails.forEach((f) => console.log(`   · ${f.label}：得到 ${JSON.stringify(f.got)}，期望 ${JSON.stringify(f.want)}`));
  process.exit(1);
}
