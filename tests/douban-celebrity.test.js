/**
 * 豆瓣影人提取器（v2.7.12）—— 契约测试
 *
 * 用**真机存档的真实页面**跑（tests/fixtures/html/douban-personage-*.html，
 * 2026-10-30 用 BrowserSkill 接管用户已登录 Edge 抓下来的原样 HTML），
 * 不是手搓的假页面 —— 手搓页面永远测不出「豆瓣把简介截断了」「标签叫去世日期」
 * 这类只有真站才有的坑。
 *
 * 钉住这些事：
 *   A. 输出恰好 12 列，列名列序与方案一致
 *   B. 姓名 = h1 整串（中文名 + 外文名），外文名不再重复进别名（v2.7.13 改口径）
 *   C. 别名里不带 `(昵称)` `(本名)` 这类豆瓣标注，且只用 `, ` 分隔
 *   D. 已故者：`去世日期` 这个标签要认（不是「逝世日期」）
 *   E. 出生地 `中国,香港` → 国家 `中国香港`（不能被第一段「中国」吃掉）
 *   F. 简介：职业在前、正文在后；正文优先 og:description（比可见文本长）
 *   H. 地址映射：/personage/ 走 person，且不会被正文猜测判成 movie/book
 *   F2. 四站专属列有值 → 「网址」留空不重复（装配器总规则）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);
const FIX = path.join(__dirname, 'fixtures', 'html');

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

/** 按 manifest 的顺序把内容脚本塞进 jsdom（顺序错了真实环境也会崩） */
function makePage({ url, html }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/shared/config/media-types.js',
    'src/shared/country-names.js',
    'src/shared/country-extract.js',
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-date.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/douban-celebrity.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));
  return w;
}

function fixtureHtml(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

const URL_ZHOU = 'https://www.douban.com/personage/27253787/';
const URL_NG = 'https://www.douban.com/personage/27222494/';

async function extract(url, html) {
  const w = makePage({ url, html });
  const ex = new w.DoubanCelebrityExtractor();
  return await ex.extractAllFields();
}

/* 一个「只有骨架」的最小页面，用于验证边界，不替代真页面 */
const HTML_BARE = `<!DOCTYPE html><html><head><title>某某(豆瓣)</title></head><body>
  <section class="subject-target">
    <h1 class="subject-name">某某</h1>
    <div class="right">
      <ul class="subject-property">
        <li><span class="label">性别: </span><span class="value">女</span></li>
        <li><span class="label">出生日期: </span><span class="value">1955年4月</span></li>
        <li><span class="label">出生地: </span><span class="value">好莱坞</span></li>
        <li><span class="label">IMDb编号: </span><span class="value">tt1234567</span></li>
      </ul>
    </div>
  </section>
</body></html>`;

(async function main() {
  section('A. 字段外壳（12 列，列序与方案一致）');
  {
    const r = await extract(URL_ZHOU, fixtureHtml('douban-personage-27253787.html'));
    const keys = Object.keys(r).filter((k) => !['mediaType', 'personKind', 'sourceSite'].includes(k));
    eq('恰好 12 列', keys.length, 12);
    eq('列名列序', keys, ['姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
      '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址']);
    eq('mediaType = person', r.mediaType, 'person');
    eq('personKind = celebrity', r.personKind, 'celebrity');
    eq('sourceSite = douban_celebrity', r.sourceSite, 'douban_celebrity');
    // 用户明确：人物档案默认不隐藏空值列 —— 空列必须存在且为空串，不能缺键
    truthy('空列仍是空串（TMDB）', r['TMDB'] === '', JSON.stringify(r['TMDB']));
    truthy('空列仍是空串（Bangumi）', r['Bangumi'] === '', JSON.stringify(r['Bangumi']));
  }

  section('B. 姓名 / 别名（周星驰页）');
  {
    const r = await extract(URL_ZHOU, fixtureHtml('douban-personage-27253787.html'));
    // v2.7.13 用户拍板：h1 整串进「姓名」，外文名不再拆到别名
    eq('姓名 = h1 全串（中文名 + 外文名）', r['姓名'], '周星驰 Stephen Chow');
    const aliases = r['别名'].split(', ');
    truthy('别名里不再重复 h1 的外文名', aliases.indexOf('Stephen Chow') === -1, r['别名']);
    eq('别名第一位是「更多中文名」的 星爷', aliases[0], '星爷');
    truthy('别名含「更多外文名」的 Sing-Chi Chow', aliases.includes('Sing-Chi Chow'), r['别名']);
    truthy('别名不含 (昵称) 标注', r['别名'].indexOf('昵称') === -1, r['别名']);
    truthy('别名不含 (本名) 标注', r['别名'].indexOf('本名') === -1, r['别名']);
    truthy('别名不用顿号', r['别名'].indexOf('、') === -1, r['别名']);
    truthy('别名不用中文逗号', r['别名'].indexOf('，') === -1, r['别名']);
    // 去重：h1 的中文名不能再出现在别名里
    truthy('别名不重复姓名', aliases.indexOf('周星驰') === -1, r['别名']);
  }

  section('C. 性别 / 出生日期 / 国家');
  {
    const r = await extract(URL_ZHOU, fixtureHtml('douban-personage-27253787.html'));
    eq('性别中文化', r['性别'], '男');
    eq('出生日期补成 YYYY-MM-DD', r['出生日期'], '1962-06-22');
    eq('在世者逝世日期为空', r['逝世日期'], '');
    eq('出生地 中国,香港 → 国家 中国香港', r['国家'], '中国香港');
  }

  section('D. 已故者：`去世日期` 这个标签要认（吴孟达页）');
  {
    const r = await extract(URL_NG, fixtureHtml('douban-personage-27222494.html'));
    eq('姓名 = 截图里红圈整行「吴孟达 Man Tat Ng」', r['姓名'], '吴孟达 Man Tat Ng');
    eq('逝世日期（豆瓣标签是「去世日期」）', r['逝世日期'], '2021-02-27');
    eq('出生日期', r['出生日期'], '1952-01-02');
    eq('出生地 中国,福建,厦门 → 国家 中国', r['国家'], '中国');
    eq('性别', r['性别'], '男');
  }

  section('E. 简介：职业在前、正文在后、正文优先 og:description');
  {
    const r = await extract(URL_NG, fixtureHtml('douban-personage-27222494.html'));
    const bio = r['简介'];
    truthy('简介非空', !!bio, bio);
    truthy('以「职业：」开头', bio.indexOf('职业：') === 0, bio.slice(0, 40));
    truthy('职业含 演员', bio.indexOf('演员') > -1, bio.slice(0, 60));
    truthy('正文在头段之后（有空行分隔）', bio.indexOf('\n\n') > -1, JSON.stringify(bio.slice(0, 80)));
    // 吴孟达可见简介被豆瓣截断在「凭着演」，og:description 更长 → 必须用长的那份
    truthy('正文长度 > 页面可见文本（用了 og:description）', bio.length > 400, String(bio.length));
    truthy('正文尾部不是截断的「凭着演」', bio.slice(-3) !== '凭着演', bio.slice(-30));
  }

  section('F. 四站外链与本页网址');
  {
    const r = await extract(URL_ZHOU, fixtureHtml('douban-personage-27253787.html'));
    eq('豆瓣 = 本页规范地址', r['豆瓣'], URL_ZHOU);
    eq('IMDb 由 nm 编号拼全', r['IMDb'], 'https://www.imdb.com/name/nm0159507/');
    eq('TMDB 留空（豆瓣影人页没有）', r['TMDB'], '');
    eq('Bangumi 留空（同上）', r['Bangumi'], '');
    // v2.7.13：豆瓣列已经有本页链接，「网址」不再重复存（用户 2026-10-30 定）
    eq('网址留空（豆瓣列已存本页地址）', r['网址'], '');
  }

  section('F2. 「网址」何时留空：四站专属列有值就不重复（装配器总规则）');
  {
    // 直接喂一个假提取器，只为验装配器这条规则本身，与豆瓣站无关
    const mk = (fields) => ({
      siteName: 'fake', platformName: '假站',
      extractName: async () => '', extractAliases: async () => '',
      extractGender: async () => '', extractBirthDate: async () => '',
      extractDeathDate: async () => '', extractBirthPlace: async () => '',
      extractBio: async () => '', extractDoubanUrl: async () => fields['豆瓣'] || '',
      extractImdbUrl: async () => fields['IMDb'] || '',
      extractTmdbUrl: async () => fields['TMDB'] || '',
      extractBgmUrl: async () => fields['Bangumi'] || '',
      extractUrl: async () => fields['网址'] || ''
    });
    const build = async (fields) => {
      const w = makePage({ url: URL_ZHOU, html: '<html><body></body></html>' });
      return await w.PersonFieldsBuilder.build(mk(fields), { kind: 'celebrity' });
    };
    // IMDb 页：只有 IMDb 列有值 → 网址也留空
    eq('IMDb 页（只有 IMDb 列）→ 网址留空', (await build({ IMDb: 'https://www.imdb.com/name/nm1/' }))['网址'], '');
    // TMDB 页：只有 TMDB 列有值 → 网址留空
    eq('TMDB 页（只有 TMDB 列）→ 网址留空', (await build({ TMDB: 'https://www.themoviedb.org/person/1' }))['网址'], '');
    // Bangumi 页：只有 Bangumi 列有值 → 网址留空
    eq('Bangumi 页（只有 Bangumi 列）→ 网址留空', (await build({ Bangumi: 'https://bgm.tv/person/1' }))['网址'], '');
    // 四列全空（未来某个既非四家、又没外链的站）→ 网址照旧兜底本页
    eq('四列全空 → 网址兜底本页', (await build({}))['网址'], URL_ZHOU);
    // 四列有值时连"提取器自己返回的网址"也清空 —— 强制清空才能兜住「新站忘了改」的漏
    eq('四列有值 → 即使提取器返回了网址也清空', (await build({ 豆瓣: URL_ZHOU, 网址: 'https://example.com/a' }))['网址'], '');
  }

  section('G. 边界（最小骨架页面）');
  {
    const r = await extract('https://www.douban.com/personage/999999/', HTML_BARE);
    eq('纯中文 h1 → 姓名照原样', r['姓名'], '某某');
    eq('只有日期没有外文名 → 别名只剩页面上的名字', r['别名'], '');
    eq('只有年月的日期补齐到当月 1 日', r['出生日期'], '1955-04-01');
    eq('抽不出国家的出生地 → 留空', r['国家'], '');
    eq('IMDb 编号不是 nm 形态 → 留空', r['IMDb'], '');
    eq('没有简介 → 空串，不写占位词', r['简介'], '');
  }

  section('H. 地址映射（三处副本 + 正文猜测闸门）');
  {
    // ① background.getMediaConfigs() 里 www.douban.com 必须是多规则、person 在前
    const bg = fs.readFileSync(P('src/background/background.js'), 'utf8');
    const bgBlock = bg.slice(bg.indexOf("'www.douban.com': {"), bg.indexOf("'www.douban.com': {") + 400);
    truthy('background: www.douban.com 用 rules 数组', bgBlock.indexOf('rules: [') > -1, bgBlock.slice(0, 120));
    truthy('background: 有 person + /personage/', /type: 'person',\s*patterns: \['\/personage\/'\]/.test(bgBlock), bgBlock.slice(0, 200));
    truthy('background: 仍保留 game 规则', /type: 'game',\s*patterns: \['\/game\/'\]/.test(bgBlock), bgBlock.slice(0, 200));

    // ② media-detector.getDefaultConfigs() 必须与 background 同步
    const md = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
    const mdBlock = md.slice(md.indexOf("'www.douban.com': {"), md.indexOf("'www.douban.com': {") + 600);
    truthy('detector: 有 person + /personage/', /type: 'person',\s*patterns: \['\/personage\/'\]/.test(mdBlock), mdBlock.slice(0, 200));

    // ③ 工厂的 URL 规则
    const ef = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
    truthy('factory: URL 规则认 /personage/', /\/www\\\.douban\\\.com\\\/personage\\\/\/,\s*hostname: 'www\.douban\.com', mediaType: 'person'/.test(ef),
      ef.slice(ef.indexOf('personage') - 120, ef.indexOf('personage') + 80));
    truthy('factory: 注册表把 person 绑到 DoubanCelebrityExtractor',
      /className: 'DoubanCelebrityExtractor'[\s\S]{0,160}hostname: 'www\.douban\.com', types: \['person'\]/.test(ef));

    // ④ person 必须在正文猜测**之前**定案（www.douban.com 在 needsContentVerification 名单里，
    //    否则影人页正文里的「演员 / 导演 / 作者」会把它判成 movie / book）
    const gateIdx = md.indexOf("if (rule.type === 'person') return 'person';");
    const verifyIdx = md.indexOf('if (rule.type === \'auto\' || this.needsContentVerification(hostname))');
    truthy('person 短路存在', gateIdx > -1);
    truthy('person 短路在正文确认之前', gateIdx > -1 && gateIdx < verifyIdx, `person@${gateIdx} verify@${verifyIdx}`);

    // ⑤ 真跑一次 detector：影人页必须返回 person，而不是 movie
    //
    // detector 里有用 `window.location` 读地址的站内二次判断，Node 下没有 window，
    // 这里按当前被测地址造一个最小替身（与 person-type.test.js 同一套做法）。
    const w = makePage({ url: URL_ZHOU, html: fixtureHtml('douban-personage-27253787.html') });
    const Detector = require(P('src/content/utils/media-detector.js'));
    const d = new Detector();
    d.siteConfigs = d.getDefaultConfigs();

    const withLocation = (url, fn) => {
      const u = new URL(url);
      global.window = { location: { hostname: u.hostname, pathname: u.pathname, search: u.search, href: u.href } };
      const out = fn();
      delete global.window;
      return out;
    };

    eq('detector 真跑：/personage/ → person（不被正文判成 movie）',
      withLocation(URL_ZHOU, () => d.detect(URL_ZHOU, w.document)), 'person');
    eq('detector 真跑：/game/ 仍走 game',
      withLocation('https://www.douban.com/game/12345/', () => d.detect('https://www.douban.com/game/12345/', w.document)), 'game');
  }

  section('I. 国家抽取：`中国,香港` 不能被第一段吃掉（防假绿）');
  {
    const CE = require(P('src/shared/country-extract.js'));
    CE._reset();
    eq('中国,香港', CE.extractCountry('中国,香港'), '中国香港');
    eq('中国,台湾', CE.extractCountry('中国,台湾'), '中国台湾');
    eq('中国,福建,厦门（没有更具体的地区段）', CE.extractCountry('中国,福建,厦门'), '中国');
    eq('中国大陆（整串精确）', CE.extractCountry('中国大陆'), '中国');
    eq('美国,纽约（另一个国家不受影响）', CE.extractCountry('美国,纽约'), '美国');
    eq('新墨西哥州，美国（老用例不能被打回）', CE.extractCountry('新墨西哥州，美国'), '美国');
    eq('New York, NY, USA', CE.extractCountry('New York, NY, USA'), '美国');
  }

  console.log('\n' + '='.repeat(60));
  console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
  if (fail) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  console.log('='.repeat(60));
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试崩了:', e);
  process.exit(1);
});
