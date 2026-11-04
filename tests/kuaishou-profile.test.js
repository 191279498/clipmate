/**
 * 快手个人主页提取器（v2.7.17）—— 契约测试
 *
 * 钉住六件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介），不多不少
 *   B. 账号ID 只从地址栏取（`/profile/<id>`），**绝不拿快手号顶替**
 *   C. 网址是**干净地址**，不带 `?source=SEARCH` 这类来源标记
 *   D. 简介 = 统计行（粉丝/获赞）+ 完整签名；**完整签名从 `title` 属性取**（页面只渲染 3 行）
 *   E. 连续空格压成一个、换行保留（用户 2026-10-31 拍板）
 *   F. 快手主页**没有 IP 属地**，统计行只有两项，且**不许**留下「IP属地：」半截
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   快手 `INIT_STATE` 里 `/rest/v/profile/get` 那一份是**当前登录者自己**
 *   （实测 `userId = 1226566812`、`userDefineId = 1226566812`），不是页面主人。
 *   谁往主页链路里引入它，就会把用户自己的账号写进别人档案。
 *   第 6 节用源码断言把这条钉死。
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge）
 *   /profile/3xb7355iu5cb6r4?source=SEARCH（东莞安然无恙）
 *   DOM：h1.user .name / span.uid / div.text-count .text[title] / div.count
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

const USER_ID = '3xb7355iu5cb6r4';
const BASE_URL = 'https://www.kuaishou.com/profile/' + USER_ID;

/** 建一个 jsdom 页面，并按 manifest 顺序塞进内容脚本 */
function makePage({ url, html }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/shared/country-names.js',
    'src/shared/country-extract.js',
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-date.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/kuaishou-profile.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));
  return w;
}

/**
 * 真机结构的最小复刻（2026-10-31 东莞安然无恙主页）
 *
 * 两处必须照真机对齐，否则测不出真 bug：
 *   1. `div.text` 的 **textContent 只有前两行**（页面渲染不全），`title` 才是全文 ——
 *      这是「签名要完整」这条需求的全部意义所在。
 *   2. `.count` 里每个外层 span 是「文本节点 + 内层 span」，靠**名字**配对，
 *      不是靠"第几个"。
 */
const HTML_FULL = `<!DOCTYPE html><html><body>
  <div class="profile-top">
    <div class="inner">
      <div class="top">
        <div class="header"><div class="Avatar"><div class="image"><img src="x.jpg" alt="头像"></div></div></div>
        <div class="user-info">
          <h1 class="user"><span class="name">东莞安然无恙</span></h1>
          <div class="info"><span class="uid"> 快手号：5405486592 <svg class="copy-svg" width="14" height="14"><path d="M0 0H14V14H0V0Z"/></svg></span><span class="gender">性别：</span></div>
        </div>
      </div>
      <div class="bottom">
        <div class="bottom-inner">
          <div class="text-count">
            <div class="text _qu-ellipsis-multi" title="每日更新热门短剧，品质保证，         让你一次看过瘾！感谢官方
谢谢粉丝关注
第三行只有 title 里有" style="--qu-ellipsis-line-clamp: 3;">每日更新热门短剧，品质保证，         让你一次看过瘾！感谢官方
谢谢粉丝关注</div>
            <div class="count"><span class=""> 关注 <span class="">30</span></span><span class=""> 粉丝 <span class="">6619</span></span><span class="stat-item"> 获赞 <span class="">3.2万</span></span></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

/** 作品页形态：地址不是 /profile/ —— 主页提取器必须全部留空，不能拿作品ID顶替 */
const HTML_WORK = `<!DOCTYPE html><html><body>
  <div class="user-info"><h1 class="user"><span class="name">东莞安然无恙</span></h1></div>
  <div class="uid"> 快手号：5405486592 </div>
</body></html>`;

(async () => {
  /* ==================== 1. 基本 6 列 ==================== */
  section('1. 输出恰好 6 列（account 形态）');

  // 真机地址本来就带 `?source=SEARCH`（从搜索结果点进来的）
  const w1 = makePage({ url: BASE_URL + '?source=SEARCH', html: HTML_FULL });
  const r1 = await new w1.KuaishouProfileExtractor().extractAllFields();

  // 装配器还会附三个元数据键（mediaType / personKind / sourceSite），
  // 那是给渲染层看的，不算「内容列」—— 只断言内容列恰好这 6 个且顺序一致。
  const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];
  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('平台 = 快手', r1['平台'], '快手');
  eq('昵称（h1.user .name）', r1['昵称'], '东莞安然无恙');

  /* ==================== 2. 账号ID / 账号名 ==================== */
  section('2. 账号ID 与账号名');

  eq('账号ID = 地址栏那段（快手内部ID）', r1['账号ID'], USER_ID);
  truthy('账号ID **不是**快手号（那是另一套编号）', r1['账号ID'] !== '5405486592',
    '账号ID=' + r1['账号ID']);
  eq('账号名 = 快手号（剥掉「快手号：」前缀）', r1['账号名'], '5405486592');

  // 作品页地址：主页提取器必须全空（宁空不错）
  const w2 = makePage({ url: 'https://www.kuaishou.com/short-video/3xaabbccddeeff1', html: HTML_WORK });
  const ex2 = new w2.KuaishouProfileExtractor();
  const r2 = await ex2.extractAllFields();
  eq('作品页地址 → 账号ID 留空（不拿作品ID顶替）', r2['账号ID'], '');
  // 提取器自己**绝不**编一个主页地址（编出来就是指向错误的人）
  eq('作品页地址 → extractUrl() 返回空', await ex2.extractUrl(), '');
  // 装配器会兜底填「当前页地址」，那是全站统一行为；这里只要它没被填成主页地址即可
  truthy('作品页地址 → 网址不会被填成 /profile/',
    r2['网址'].indexOf('/profile/') === -1, r2['网址']);
  eq('作品页地址 → 账号名仍然取得到（DOM 里有 .uid）', r2['账号名'], '5405486592');

  /* ==================== 3. 网址：不带来源标记 ==================== */
  section('3. 网址 = 干净主页地址');

  eq('网址不带 ?source=SEARCH', r1['网址'], BASE_URL);

  // 7a. 提取器自己就必须给干净地址 —— 不能指望下游规范化来擦屁股。
  //     只断言「装配后的结果」会被规范化掩盖（normalize 认不出时是**原样返回** href），
  //     那样即使 extractUrl 退化成 `return location.href` 也照样绿
  //     （小红书 v2.7.16 的变异 M3 就假绿过一次，这里是同一个坑）。
  const wN = makePage({ url: BASE_URL + '?source=SEARCH&fid=abc', html: HTML_FULL });
  const exN = new wN.KuaishouProfileExtractor();
  const rawUrl = await exN.extractUrl();
  eq('extractUrl() 自己就返回干净地址（不依赖下游规范化）', rawUrl, BASE_URL);

  // 7b. 规范化那条分支也得认得主页地址，否则返回 '' → 原样返回带参 href
  const wNorm = makePage({ url: BASE_URL, html: '<!DOCTYPE html><html><body></body></html>' });
  const normalized = wNorm.eval(`(function(){
    var U = (typeof UrlNormalizer !== 'undefined') ? UrlNormalizer : null;
    if (!U && typeof window.UrlNormalizer !== 'undefined') U = window.UrlNormalizer;
    if (!U) return 'NO_MODULE';
    var fn = U.normalize || U.normalizeUrl;
    if (typeof fn !== 'function') return 'NO_FN';
    return fn('https://www.kuaishou.com/profile/${USER_ID}?source=SEARCH');
  })()`);
  eq('url-normalizer 认得快手主页（否则会被原样返回、带上 source 参数）',
    normalized, BASE_URL);

  /* ==================== 4. 简介：统计行 + 完整签名 ==================== */
  section('4. 简介 = 统计行 + 完整签名');

  const bio = r1['简介'];
  const lines = bio.split('\n');
  eq('第一行是统计行', lines[0], '粉丝：6619 · 获赞：3.2万');
  truthy('统计行**不含**「关注」（用户拍板跟抖音一致：不带关注）',
    lines[0].indexOf('关注') === -1, lines[0]);
  truthy('统计行**不含**「IP属地」半截（快手主页没有这一项）',
    lines[0].indexOf('IP属地') === -1, lines[0]);
  truthy('统计行不含裸「粉丝：」（取不到就不出现）',
    lines[0].indexOf('粉丝： ') === -1 && !/粉丝：\s*$/.test(lines[0]), lines[0]);

  truthy('签名取的是 **title 全文**（含第三行，页面 textContent 里没有）',
    bio.indexOf('第三行只有 title 里有') > -1, bio);
  truthy('签名换行保留（不是压成一坨）', lines.length >= 3, '行数=' + lines.length);

  /* ==================== 5. 空格压缩（用户 2026-10-31 拍板） ==================== */
  section('5. 连续空格压成一个，换行保留');

  const signLine = lines[1] || '';
  truthy('签名里的长串排版空格已压成一个', signLine.indexOf('品质保证， 让你一次看过瘾') > -1,
    JSON.stringify(signLine));
  truthy('压完不再有连续两个空格', !/[ \t]{2}/.test(bio), JSON.stringify(bio));
  truthy('换行**没有被**压掉', bio.split('\n').length >= 3, '行数=' + bio.split('\n').length);

  /* ==================== 6. 一级红线：绝不读登录者自己的数据 ==================== */
  section('6. 红线：主页链路不许碰「登录者自己」那份数据');

  const SRC = fs.readFileSync(P('src/content/extractors/kuaishou-profile.js'), 'utf8');
  const stripped = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  truthy('代码里不许出现 INIT_STATE（那是主世界才有的登录态数据）',
    stripped.indexOf('INIT_STATE') === -1, '出现了 INIT_STATE');
  truthy('代码里不许出现 userInfo',
    stripped.indexOf('userInfo') === -1, '出现了 userInfo');
  truthy('代码里不许出现 __APOLLO_STATE__',
    stripped.indexOf('__APOLLO_STATE__') === -1, '出现了 __APOLLO_STATE__');
  // 注释里会提到 `/rest/v/profile/get`（警告用），所以只查代码部分
  truthy('代码里不许出现 profile/get（那是登录者自己的接口）',
    stripped.indexOf('profile/get') === -1, '出现了 profile/get');

  /* ==================== 7. 接线：规则表 / manifest / 渲染兜底 ==================== */
  section('7. 接线：站点规则 / 提取器工厂 / manifest / 渲染兜底');

  const DET = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
  truthy('media-detector 快手用多规则且含 person /profile/',
    /rules:\s*\[\s*\{\s*type:\s*'person',\s*patterns:\s*\['\/profile\/'\]/.test(DET), '找不到 person 规则');

  const BG = fs.readFileSync(P('src/background/background.js'), 'utf8');
  truthy('background 与 media-detector 同步（也有 person /profile/）',
    /rules:\s*\[\s*\{\s*type:\s*'person',\s*patterns:\s*\['\/profile\/'\]/.test(BG), 'background 没同步');

  const FAC = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  truthy('extractor-factory 注册了 KuaishouProfileExtractor',
    /KuaishouProfileExtractor/.test(FAC), '没注册');
  // 源码里是**正则字面量**，文本带反斜杠（`www\.kuaishou\.com\/profile\/…`），
  // 用正则匹配它要连转义一起写，容易写错；直接 indexOf 更直观也更难假绿。
  truthy('工厂有主页 URL 规则（person）',
    FAC.indexOf('www\\.kuaishou\\.com\\/profile\\/[A-Za-z0-9_-]{6,64}') > -1, '找不到主页 URL 规则');
  const iHome = FAC.indexOf('www\\.kuaishou\\.com\\/profile\\/');
  const iWork = FAC.indexOf('www\\.kuaishou\\.com\\/short-video\\/');
  truthy('主页 URL 规则排在作品页规则**之前**', iHome > -1 && iWork > -1 && iHome < iWork,
    `home=${iHome} work=${iWork}`);

  const MANIFEST = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  const js = MANIFEST.content_scripts[0].js;
  truthy('manifest 注入了 kuaishou-profile.js',
    js.indexOf('src/content/extractors/kuaishou-profile.js') > -1, 'manifest 没注入');
  truthy('kuaishou-profile.js 排在 person-fields-builder.js **之后**（要用它装配）',
    js.indexOf('src/content/extractors/kuaishou-profile.js') >
    js.indexOf('src/content/shared/person-fields-builder.js'), '顺序反了');

  const PERSIST = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
  truthy('modal-persistence 有快手主页的 person 兜底（否则重渲染会落到 general）',
    /url\.includes\('kuaishou\.com\/profile\/'\)/.test(PERSIST), '缺兜底');

  /* ==================== 8. 弹层优先提作品（用户 2026-10-31 拍板） ==================== */
  section('8. 主页上点开作品弹层 → 归作品（social）');

  const MAIN = fs.readFileSync(P('src/content/content-main.js'), 'utf8');
  truthy('detectMediaType 允许 person 被快手弹层补认成 social',
    /\(!mediaType \|\| mediaType === 'person'\) && typeof this\._kuaishouOverrideType === 'function'/.test(MAIN),
    '补认没放开到 person');
  truthy('init 里给快手主页（person）也挂上了弹层监听',
    /mediaType === 'person' && \/\^www\\\.kuaishou\\\.com\$/.test(MAIN) ||
    /mediaType === 'person'/.test(MAIN) && /_startKuaishouImmersiveWatcher\(\{ keepButton: true/.test(MAIN),
    '主页没挂监听');

  const SPA = fs.readFileSync(P('src/content/ui/kuaishou-spa-handler.js'), 'utf8');
  truthy('watcher 支持 keepButton（主页进来时不许把按钮藏掉）',
    /keepButton/.test(SPA) && /if \(!keepButton\)/.test(SPA), '没有 keepButton 分支');
  truthy('_activateKuaishouComponents 按 _ksMapperType 重建 social 映射器',
    /if \(!this\.fieldMapper \|\| this\._ksMapperType !== 'social'\)/.test(SPA),
    '没有按类型重建（person 的 6 列模板会套到作品数据上）');
  truthy('弹层关掉后切回 person（_ksProfilePerson + _restoreKuaishouProfilePerson）',
    /if \(this\._ksProfilePerson\) \{/.test(SPA) &&
    /if \(wasActive\) this\._restoreKuaishouProfilePerson\(\);/.test(SPA),
    '关弹层后回不到人物档案');
  // v2.7.18 真机回归：主页进来时监听会先回调一次 opened=false（此刻确实没弹层），
  // 那时 wasActive=false。把 profilePerson 与 wasActive 绑在一起 → 掉到「藏按钮」那条，
  // 正常流程建好的主页按钮被摘掉，主页就永远没按钮（必须点开作品弹层才有）。
  eq('主页态不许藏按钮（profilePerson 不能与 wasActive 绑在一起）',
    /this\._ksProfilePerson && wasActive/.test(SPA), false);

  /* ==================== 8b. 提取器选择：弹层态必须选社交提取器 ==================== */
  section('8b. 弹层打开时不能选人物提取器（快手弹层不改地址）');

  const FAC2 = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  truthy('命中快手 person 规则时，若弹层接管中则跳过（落回 social）',
    /mediaType === 'person' && hostname === 'www\.kuaishou\.com' && ksImmersiveActive\(\)/.test(FAC2),
    '缺跳过逻辑 → 弹层里会用人物提取器填 7 列社交表，作品字段全空');
  truthy('接管标记写在 window.__clipmateKsImmersiveActive（接管置 true、撤下置 false）',
    /window\.__clipmateKsImmersiveActive = true/.test(SPA) &&
    /window\.__clipmateKsImmersiveActive = false/.test(SPA),
    '缺全局标记');
  truthy('标记读取有容错（拿不到 window 时当成「没接管」）',
    /function ksImmersiveActive\(\)/.test(FAC2) && /catch \(e\) \{\s*return false;/.test(FAC2),
    'helper 会抛错');

  /* ==================== 9. 版本号 ==================== */
  section('9. 版本号');
  eq('manifest 版本已升到 2.11.3', MANIFEST.version, '2.11.3');

  /* ==================== 真机形态预览（--dump） ==================== */
  if (process.argv.includes('--dump')) {
    console.log(`\n${C.bold}真机形态复刻（${BASE_URL}?source=SEARCH）${C.reset}`);
    for (const k of Object.keys(r1)) {
      const v = String(r1[k] || '');
      console.log(`  【${k}】${v.replace(/\n/g, '\n         ')}`);
    }
  }

  console.log(`\n${C.bold}结果：${pass} 通过，${fail} 失败${C.reset}`);
  if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('测试崩了:', e); process.exit(1); });
