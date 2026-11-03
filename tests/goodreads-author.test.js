/**
 * Goodreads「国家」（作者出生地）解析单测 · v2.5.69
 *
 * 为什么单独做一份：
 *   13 个快照样本跑在 jsdom 里**不联网**，抓不到作者页 → 国家永远是空，
 *   所以快照回归完全测不到这条新逻辑。这里用**真实的作者页存档**直接测解析函数。
 *
 * 存档来源：2026-10-26 用 Chrome UA + 本机代理 7897 抓的真实作者页（原样保存，未改写）
 *   goodreads-author-7111-isaacson.html   → in New Orleans, Louisiana, The United States
 *   goodreads-author-1265-austen.html     → in Steventon Rectory, Hampshire, England
 *   goodreads-author-656983-tolkien.html  → in Bloemfontein, Mangaung, Free State, South Africa
 *
 * 跑法（项目根目录）：
 *   node tests/goodreads-author.test.js
 *   node tests/goodreads-author.test.js --verbose
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

/* ============================================================
 * 准备：在 jsdom 里按 manifest 顺序注入「国家总表 + Goodreads 提取器」
 * ==========================================================*/
function bootstrap() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const { window } = dom;

  // 国家总表（真文件）
  window.eval(fs.readFileSync(path.join(EXT, 'src', 'shared', 'country-names.js'), 'utf8'));

  // BaseExtractor 极简替身：本测试只调静态解析函数，用不到基类逻辑
  // （必须挂到 window 上，否则 class 声明只活在 eval 作用域里，下面的 extends 找不到）
  window.eval('window.BaseExtractor = class BaseExtractor { constructor() { this.cache = new Map(); } };');

  // 被测文件（真文件）
  window.eval(fs.readFileSync(path.join(EXT, 'src', 'content', 'extractors', 'goodreads-book.js'), 'utf8'));

  if (!window.GoodreadsBookExtractor) throw new Error('提取器没挂到 window 上，注入顺序有问题');
  if (!window.CountryNames) throw new Error('国家总表没加载');
  return window;
}

const window = bootstrap();
const parse = window.GoodreadsBookExtractor.parseBirthCountryFromDoc.bind(window.GoodreadsBookExtractor);

function docFromFile(file) {
  const html = fs.readFileSync(path.join(FIXTURES, file), 'utf8');
  return new JSDOM(html).window.document;
}

function docFromHtml(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

/* ============================================================
 * 一、真实存档（这是本测试的核心）
 * ==========================================================*/
console.log('一、真实作者页存档');
eq('Walter Isaacson（Steve Jobs 传）→ 美国',
  parse(docFromFile('goodreads-author-7111-isaacson.html')), '美国');
eq('Jane Austen → 英国',
  parse(docFromFile('goodreads-author-1265-austen.html')), '英国');
eq('J.R.R. Tolkien → 南非',
  parse(docFromFile('goodreads-author-656983-tolkien.html')), '南非');

/* ============================================================
 * 二、生日不能被拼进国名（Isaacson 页有 birthDate 的 div）
 * ==========================================================*/
console.log('二、birthDate 干扰');
const withDate = docFromHtml(`
  <div class="dataTitle">Born</div>
  in New Orleans, Louisiana, The United States
  <div class="dataItem" itemprop='birthDate'>October 20, 1952</div>
  <br class="clear"/>
  <div class="dataTitle">Twitter</div>
`);
eq('出生地后面的生日不参与解析', parse(withDate), '美国');

/* ============================================================
 * 三、各种降级情形（该空就空）
 * ==========================================================*/
console.log('三、该空就空');
eq('没有 Born 栏', parse(docFromHtml(`
  <div class="dataTitle">Genre</div><div class="dataItem">Fantasy</div>
`)), '');
eq('只写到州（Massachusetts）', parse(docFromHtml(`
  <div class="dataTitle">Born</div>
  in Boston, Massachusetts
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`)), '');
eq('只写到州（New Mexico）', parse(docFromHtml(`
  <div class="dataTitle">Born</div>
  in Las Cruces, New Mexico
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`)), '');
eq('Georgia 歧义 → 空', parse(docFromHtml(`
  <div class="dataTitle">Born</div>
  in Atlanta, Georgia
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`)), '');
eq('Born 后面什么都没有', parse(docFromHtml(`
  <div class="dataTitle">Born</div>
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`)), '');
eq('null 文档', parse(null), '');
eq('非文档对象', parse({}), '');

/* ============================================================
 * 四、写法覆盖（总表能认的那些）
 * ==========================================================*/
console.log('四、写法覆盖');
const born = (text) => docFromHtml(`
  <div class="dataTitle">Born</div>
  ${text}
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`);
eq('in England → 英国', parse(born('in London, England')), '英国');
eq('Scotland → 英国', parse(born('in Edinburgh, Scotland')), '英国');
eq('The United States → 美国', parse(born('in Austin, Texas, The United States')), '美国');
eq('US 缩写 → 美国', parse(born('in Seattle, WA, US')), '美国');
eq('英国全称 → 英国', parse(born('in Oxford, United Kingdom')), '英国');
eq('日本 → 日本', parse(born('in Tokyo, Japan')), '日本');
eq('历史国家西德 → 西德', parse(born('in Munich, West Germany')), '西德');
eq('出生地是链接也算', parse(docFromHtml(`
  <div class="dataTitle">Born</div>
  <a href="/places/x">in Dublin, Ireland</a>
  <div class="dataItem" itemprop='birthDate'>January 01, 1900</div>
`)), '爱尔兰');
eq('未知地名 → 空', parse(born('in Atlantis, Nowhere')), '');

/* ============================================================
 * 结果
 * ==========================================================*/
console.log('');
if (fails.length === 0) {
  console.log(`✅ 全部通过：${pass} 条断言（3 份真实作者页存档 + 合成边界用例）`);
  process.exit(0);
} else {
  console.log(`❌ 失败 ${fails.length} 条 / 共 ${pass + fails.length} 条断言`);
  fails.forEach(f => console.log(`   · ${f.label}：得到 ${JSON.stringify(f.got)}，期望 ${JSON.stringify(f.want)}`));
  process.exit(1);
}
