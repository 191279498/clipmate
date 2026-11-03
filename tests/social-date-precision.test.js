#!/usr/bin/env node
/**
 * 「发布日期如实显示」+ 两个抖音老 bug 的验收（v2.5.78）
 *
 * 这一版修了三件事，全部在这里钉住：
 *
 *   ① **精度由源数据决定，不再补零**
 *      源到秒 → `2025/06/16 17:44:49`；到分 → `2024/09/08 01:14`；只有日 → `2026/10/19`
 *      标题尾部跟着走：`-2025年06月16日174449` / `-2024年09月08日0114` / `-2026年10月19日`
 *      以前按站点写死格式（抖音 `HH:mm`），源里没有时分就补 `00:00`、标题补 `0000`，
 *      弹窗页因此长期显示假时间。
 *
 *   ② **图文详情页的日期抓到别人**
 *      `douyin-social.js` 的 `:contains("发布时间")` 回退用 `querySelectorAll('*').find()`
 *      取第一个命中 —— 第一个永远是 `<html>`，等于把整页 1MB 文本喂给日期格式化，
 *      于是捞到「相关推荐」里别人的日期。现在改为「取含该文字、且文本最短的叶子元素」。
 *
 *   ③ **弹窗页字段从 7 个变 15 个**
 *      `modal-persistence.js` 的 `getMediaType()` 只按网址猜类型，而弹窗页地址是
 *      `/jingxuan?modal_id=…`，一个都匹配不上 `/video/` → 被判成 general → 7 字段过滤失效。
 *      现在先听数据自己的话（社交数据必带 `mediaType:'social'`）。
 *
 * 用法：
 *   node tests/social-date-precision.test.js
 *   node tests/social-date-precision.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
let fail = 0;
const failures = [];

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m'
};

function ok(name, extra) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${extra ? ' ' + C.gray + extra + C.reset : ''}`);
}
function bad(name, detail) {
  fail++;
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? ' — ' + detail : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name);
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual, detail) {
  if (actual) ok(name);
  else bad(name, detail || '期望真值');
}
function falsy(name, actual, detail) {
  if (!actual) ok(name);
  else bad(name, detail || `期望假值/空，实际 ${JSON.stringify(actual)}`);
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/* ---------------- 在假 window 里加载纯函数模块 ---------------- */

function makeWindow(href) {
  const loc = new URL(href || 'https://www.douyin.com/jingxuan?modal_id=7516480886684568891');
  return {
    location: { href: loc.href, hostname: loc.hostname, origin: loc.origin, pathname: loc.pathname, search: loc.search },
    document: null,
    console
  };
}

function loadInto(win, rel) {
  const code = read(rel);
  new Function('window', 'document', 'location', 'console', code)(win, win.document, win.location, console);
  return win;
}

/* ---------------- jsdom（`:contains` 那一节要用真 DOM） ---------------- */

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const dirs = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of dirs) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom（见 tests/README.md）');
}

/* ========================================================================== */
/* 一、发布日期精度                                                            */
/* ========================================================================== */
function section1() {
  section('一、发布日期：源到哪一档就显示到哪一档（不补零）');

  const win = loadInto(makeWindow(), 'src/content/utils/data-formatters.js');
  const F = win.DataFormatters;
  truthy('DataFormatters 已加载', !!(F && F.formatSocialDate));

  // ① 到秒
  eq('到秒（斜杠）', F.formatSocialDate('2025/06/16 17:44:49'), '2025/06/16 17:44:49');
  eq('到秒（短横）', F.formatSocialDate('2025-06-16 17:44:49'), '2025/06/16 17:44:49');
  eq('到秒（点）', F.formatSocialDate('2025.06.16 17:44:49'), '2025/06/16 17:44:49');
  eq('到秒（中文）', F.formatSocialDate('2025年6月16日 17:44:49'), '2025/06/16 17:44:49');

  // ② 到分
  eq('到分（短横）', F.formatSocialDate('2024-09-08 01:14'), '2024/09/08 01:14');
  eq('到分（斜杠）', F.formatSocialDate('2024/09/08 01:14'), '2024/09/08 01:14');

  // ③ 只有日
  eq('只有日（短横）', F.formatSocialDate('2026-10-19'), '2026/10/19');
  eq('只有日（斜杠）', F.formatSocialDate('2026/10/19'), '2026/10/19');
  eq('只有日（中文）', F.formatSocialDate('2026年10月19日'), '2026/10/19');
  eq('只有日（中文带空格）', F.formatSocialDate('2026 年 10 月 19 日'), '2026/10/19');

  // ④ 绝不补时间：只有日的一律不含冒号
  const dateOnlyInputs = ['2026-10-19', '2026/10/19', '2026.10.19', '2026年10月19日'];
  let leaked = 0;
  dateOnlyInputs.forEach((s) => { if (F.formatSocialDate(s).includes(':')) leaked++; });
  eq('只有日时绝不冒出 00:00', leaked, 0);

  // ⑤ 绝不补秒：到分的结果只应该有 1 个冒号
  eq('到分时不补 :00 秒', F.formatSocialDate('2024-09-08 01:14').split(':').length - 1, 1);

  // ⑥ 相对时间：到分的档位给时分，到日的档位只给日
  const now = new Date();
  const ymd = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  const threeDaysAgo = ymd(new Date(now.getTime() - 3 * 86400000));
  eq('3天前 → 只到日', F.formatSocialDate('3天前'), threeDaysAgo);
  eq('2周前 → 只到日', F.formatSocialDate('2周前'), ymd(new Date(now.getTime() - 14 * 86400000)));
  truthy('3天前不带时间', !F.formatSocialDate('3天前').includes(':'));
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600000);
  eq('2小时前 → 到分', F.formatSocialDate('2小时前'), `${ymd(twoHoursAgo)} ${String(twoHoursAgo.getHours()).padStart(2, '0')}:${String(twoHoursAgo.getMinutes()).padStart(2, '0')}`);
  truthy('2小时前不带秒', F.formatSocialDate('2小时前').split(':').length - 1 === 1);
  truthy('刚刚 → 到分（不含秒）', F.formatSocialDate('刚刚').split(':').length - 1 === 1);

  // ⑦ ISO 8601 带 Z：转本地时间，精度到秒
  eq('ISO Z → 本地到秒', F.formatSocialDate('2025-06-16T09:44:49Z'), '2025/06/16 17:44:49');

  // ⑧ 空值
  eq('空字符串 → 空', F.formatSocialDate(''), '');
  eq('null → 空', F.formatSocialDate(null), '');

  // ⑨ 同一份数据的三种精度互不串味
  eq('同一时刻三种精度：到秒', F.formatSocialDate('2025/06/16 17:44:49'), '2025/06/16 17:44:49');
  eq('同一时刻三种精度：到分', F.formatSocialDate('2025/06/16 17:44'), '2025/06/16 17:44');
  eq('同一时刻三种精度：只有日', F.formatSocialDate('2025/06/16'), '2025/06/16');
}

/* ========================================================================== */
/* 二、标题尾部精度                                                            */
/* ========================================================================== */
function section2() {
  section('二、本页标题尾部：跟着发布日期一起变');

  const win = loadInto(makeWindow(), 'src/content/shared/social-title-processor.js');
  const T = win.SocialTitleProcessor;
  truthy('SocialTitleProcessor 已加载', !!T);
  const p = new T();

  eq('到秒 → HHmmss', p.formatPublishTime('2025/06/16 17:44:49', { platform: 'douyin-video' }), '2025年06月16日174449');
  eq('到分 → HHmm', p.formatPublishTime('2024/09/08 01:14', { platform: 'douyin-video' }), '2024年09月08日0114');
  eq('只有日 → 不补', p.formatPublishTime('2026-10-19', { platform: 'douyin-video' }), '2026年10月19日');
  eq('「发布时间：」前缀要剥掉', p.formatPublishTime('发布时间：2025-06-16 17:44:49'), '2025年06月16日174449');

  // 以前的反面教材：`-2026年08月11日0000`
  falsy('只有日时不再出现 0000', /0000$/.test(p.formatPublishTime('2026-08-11', { platform: 'douyin-video' })));
  falsy('到分时不再补成 0000', /0000$/.test(p.formatPublishTime('2024-09-08 01:14', { platform: 'douyin-video' })));

  // 完整标题：三种精度
  const mk = (d) => T.generatePageTitle('作者', '文案内容', d, {
    platform: 'douyin-video', enableSpecialCharConversion: false, maxTextLength: 10
  });
  eq('标题（到秒）', mk('2025/06/16 17:44:49'), '作者文案内容-2025年06月16日174449');
  eq('标题（到分）', mk('2024-09-08 01:14'), '作者文案内容-2024年09月08日0114');
  eq('标题（只有日）', mk('2026-10-19'), '作者文案内容-2026年10月19日');

  // 精度探测器本身
  eq('detectTimePrecision(到秒)', p.detectTimePrecision('2025-06-16 17:44:49'), 'HHmmss');
  eq('detectTimePrecision(到分)', p.detectTimePrecision('2025-06-16 17:44'), 'HHmm');
  eq('detectTimePrecision(只有日)', p.detectTimePrecision('2025-06-16'), '');
  eq('detectTimePrecision(中文到秒)', p.detectTimePrecision('2025年6月16日 17:44:49'), 'HHmmss');
  eq('detectTimePrecision(ISO)', p.detectTimePrecision('2025-06-16T17:44:49Z'), 'HHmmss');
}

/* ========================================================================== */
/* 三、fiber 时间戳：到秒                                                      */
/* ========================================================================== */
function section3() {
  section('三、抖音 fiber 的 createTime：带秒输出（弹窗页才有真时分秒）');

  const win = loadInto(makeWindow(), 'src/content/shared/aweme-id-date.js');
  const D = win.DouyinAwemeDate;

  eq('1750067089 → 2025/06/16 17:44:49', D.formatTimestamp(1750067089), '2025/06/16 17:44:49');
  eq('1786413600 → 2026/08/11 10:00:00', D.formatTimestamp(1786413600), '2026/08/11 10:00:00');
  eq('1600000000 → 2020/09/13 20:26:40', D.formatTimestamp(1600000000), '2020/09/13 20:26:40');
  eq('0 → 空', D.formatTimestamp(0), '');
  eq('非法 → 空', D.formatTimestamp('abc'), '');

  // 同一作品：弹窗页（fiber）与详情页（页面文字）必须一字不差
  const detail = '2025-06-16 17:44:49';
  const fromFiber = D.formatTimestamp(1750067089);
  const fmt = loadInto(makeWindow(), 'src/content/utils/data-formatters.js').DataFormatters.formatSocialDate;
  eq('同作品弹窗页与详情页日期一致', fmt(fromFiber), fmt(detail));
}

/* ========================================================================== */
/* 四、getMediaType：先听数据                                                  */
/* ========================================================================== */
function section4() {
  section('四、浮窗类型判断：数据说自己是社交，就别再按网址猜');

  function getType(data, href) {
    const win = makeWindow(href);
    loadInto(win, 'src/content/ui/modal-persistence.js');
    const mixin = win.ModalPersistenceMixin;
    return mixin.getMediaType.call({ data });
  }

  // 弹窗页地址（老代码在这里一律翻车）
  const modalUrls = [
    'https://www.douyin.com/jingxuan?modal_id=7516480886684568891',
    'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?modal_id=7672265848853220618',
    'https://www.douyin.com/user/MS4wLjABAAAA?modal_id=7496043889296559386',
    'https://www.douyin.com/hashtag/123?modal_id=7516480886684568891',
    'https://www.douyin.com/collection/456?modal_id=7516480886684568891'
  ];
  const socialData = { mediaType: 'social', '影视类型': '社交媒体', '本页标题': 'x' };
  modalUrls.forEach((u) => {
    eq(`弹窗页认成 social：${new URL(u).pathname}`, getType(socialData, u), 'social');
  });

  // 详情页照旧
  eq('详情页 /video/ 仍是 social', getType({}, 'https://www.douyin.com/video/7411950642865917225'), 'social');
  eq('详情页 /note/ 仍是 social', getType({}, 'https://www.douyin.com/note/7516480886684568891'), 'social');

  // 没有数据时不许乱认社交
  eq('信息流首页（没数据）→ general', getType({}, 'https://www.douyin.com/jingxuan?modal_id=1'), 'general');

  // 其他类型不受影响（数据里写明是电影，就走影视）
  eq('电影数据仍是 movie', getType({ '影视类型': '电影', '导演': 'x' }, 'https://movie.douban.com/subject/1292052/'), 'movie');

  // 7 字段模板没被改动
  const mediaTypes = require(path.join(SRC, 'src/shared/config/media-types.js'));
  const keys = Object.keys(mediaTypes.SOCIAL_FIELDS || {});
  eq('社交媒体字段仍是 7 个', keys.length, 7);
  eq('7 字段名单没变', keys.join(','), '本页标题,作者ID,作者昵称,作者主页,发布日期,本页文案,URL');
}

/* ========================================================================== */
/* 五、`:contains` 回退取最小叶子                                               */
/* ========================================================================== */
async function section5() {
  section('五、图文页日期：不许再从整页文本里捞别人的日期');

  const { JSDOM } = loadJsdom();

  // 页面顺序刻意做成「别人的日期在前、真的发布时间在后」——
  // 老代码取 querySelectorAll('*') 的第一个命中（= <html>），必然抓前一行的 2026/10/23。
  const html = `<!doctype html><html><head><title>t</title></head><body>
    <div class="rec"><span>相关推荐 2026年10月23日 23:59:59</span></div>
    <div class="rec2"><span>另一个 2026年10月24日 11:22:33</span></div>
    <div class="info"><span>发布时间：2025-06-16 17:44:49</span></div>
  </body></html>`;

  const dom = new JSDOM(html, { url: 'https://www.douyin.com/note/7516480886684568891' });
  const win = dom.window;

  // 只加载要测的那个提取器，其他依赖给最小桩
  win.BaseExtractor = class BaseExtractor { constructor() { this.siteName = ''; } };
  win.SocialDomUtils = { readMeta: () => '' };
  win.SocialFieldsBuilder = { build: async () => ({}) };
  win.SocialTitleProcessor = { generatePageTitle: () => '' };

  // 提取器里直接用裸名引用 BaseExtractor / SocialDomUtils 等（浏览器里它们是全局变量），
  // 在 Function 沙箱里得先把它们从 window 上接出来，否则 class extends 会报未定义。
  const prelude = 'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor;\n';
  new Function('window', 'document', 'console', prelude + read('src/content/extractors/douyin-social.js'))(
    win, win.document, console
  );

  const ex = new win.DouyinSocialExtractor();
  const got = await ex.extractPublishDate();

  eq('拿到的是页面正文那一行', got, '2025-06-16 17:44:49');
  falsy('不是「相关推荐」里别人的日期', String(got).includes('2026'), String(got));
  falsy('也不是 23:59:59 这种假时间', String(got).includes('23:59'), String(got));

  win.close();
}

/* ========================================================================== */
/* 六、详情页与弹窗页日期统一（v2.5.79）                                        */
/* ========================================================================== */
function section6() {
  section('六、日期精度对齐：详情页（到分）与弹窗页（到秒）显示同一个字符串');

  const win = loadInto(makeWindow(), 'src/content/shared/aweme-id-date.js');
  const D = win.DouyinAwemeDate;

  // splitDateTime：三档拆得开
  const sp = D.splitDateTime('2025-04-22 16:00');
  eq('拆：日期', sp && sp.date, '2025/04/22');
  eq('拆：时分', sp && sp.hm, '16:00');
  eq('拆：秒（没有就是空）', sp && sp.second, '');
  eq('拆：带秒', D.splitDateTime('2025/04/22 16:00:29').second, '29');
  eq('拆：只有日 → 时分空', D.splitDateTime('2025年4月22日').hm, '');
  eq('拆：相对时间 → null', D.splitDateTime('3天前'), null);
  eq('拆：空 → null', D.splitDateTime(''), null);

  const M = D.mergePrecision;

  // 主场景：详情页到分 + fiber 到秒 → 用 fiber（多出来的只有秒这一档）
  eq('到分 + 到秒 → 到秒', M('2025-04-22 16:00', '2025/04/22 16:00:29'), '2025/04/22 16:00:29');
  eq('只有日 + 到秒 → 到秒', M('2025/04/22', '2025/04/22 16:00:29'), '2025/04/22 16:00:29');

  // fiber 没有 / 页面没有
  eq('fiber 空 → 保持页面', M('2025-04-22 16:00', ''), '2025-04-22 16:00');
  eq('页面空 → 用 fiber', M('', '2025/04/22 16:00:29'), '2025/04/22 16:00:29');
  eq('都空 → 空', M('', ''), '');
  eq('fiber 也只到分 → 保持页面', M('2025-04-22 16:00', '2025/04/22 16:00'), '2025-04-22 16:00');

  // 宁空不错：对不上就信页面
  eq('时分不一致 → 保持页面', M('2025-04-22 16:01', '2025/04/22 16:00:29'), '2025-04-22 16:01');
  eq('日期不一致 → 保持页面', M('2025-04-23 16:00', '2025/04/22 16:00:29'), '2025-04-23 16:00');
  eq('页面是相对时间 → 保持页面', M('3天前', '2025/04/22 16:00:29'), '3天前');

  // 页面已经到秒 → 页面优先（比 fiber 更细就别动）
  eq('页面已有秒 → 保持页面', M('2025/06/16 17:44:49', '2025/06/16 17:44:49'), '2025/06/16 17:44:49');
  eq('页面已有秒且与 fiber 差 1 秒 → 保持页面', M('2025/06/16 17:44:49', '2025/06/16 17:44:50'), '2025/06/16 17:44:49');

  // 同一作品：两条路算出来必须一字不差
  const fiber = D.formatTimestamp(1745308829);            // 2025/04/22 16:00:29
  eq('同作品两路结果一致', M('2025-04-22 16:00', fiber), fiber);
  eq('同作品两路结果一致（格式化后）',
    loadInto(makeWindow(), 'src/content/utils/data-formatters.js').DataFormatters.formatSocialDate(M('2025-04-22 16:00', fiber)),
    loadInto(makeWindow(), 'src/content/utils/data-formatters.js').DataFormatters.formatSocialDate(fiber));
}

/* ========================================================================== */
/* 七、视频详情页真的会去补秒（jsdom 端到端）                                    */
/* ========================================================================== */
async function section7() {
  section('七、视频详情页：页面只到分时，补上 fiber 的秒（拿不到就保持原样）');

  const { JSDOM } = loadJsdom();

  // 真机实测（BrowserSkill, 2026-10-27）：/video/7496043889296559386 页面写
  // `发布时间：2025-04-22 16:00`，fiber createTime=1745308829 → 16:00:29
  const html = `<!doctype html><html><head><title>t</title></head><body>
    <div class="meta"><span data-e2e="detail-video-publish-time">发布时间：2025-04-22 16:00</span></div>
  </body></html>`;

  async function run(fiberMeta, href) {
    const dom = new JSDOM(html, { url: href || 'https://www.douyin.com/video/749604388929656' });
    const win = dom.window;
    win.BaseExtractor = class BaseExtractor { constructor() { this.siteName = ''; } };
    win.SocialDomUtils = { readMeta: () => '' };
    win.SocialFieldsBuilder = { build: async () => ({}) };
    win.SocialTitleProcessor = { generatePageTitle: () => '' };
    loadInto(win, 'src/content/shared/aweme-id-date.js');
    win.DouyinFiberClient = {
      getMeta: async () => fiberMeta,
      _calls: 0
    };

    const prelude = 'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
      'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
      'DouyinAwemeDate = window.DouyinAwemeDate, DouyinFiberClient = window.DouyinFiberClient, ' +
      'DouyinModalContext = window.DouyinModalContext;\n';
    new Function('window', 'document', 'console', 'location', prelude + read('src/content/extractors/douyin-social.js'))(
      win, win.document, console, win.location
    );

    const ex = new win.DouyinSocialExtractor();
    const got = await ex.extractPublishDate();
    win.close();
    return got;
  }

  // ① 详情页 ID + fiber 有秒 → 输出到秒（与弹窗页同一个字符串）
  eq('详情页：16:00 → 16:00:29',
    await run({ awemeId: '7496043889296559386', createTime: 1745308829 },
      'https://www.douyin.com/video/7496043889296559386'),
    '2025/04/22 16:00:29');

  // ② fiber 拿不到 → 保持老表现（只有到分），不许编造秒
  eq('详情页：fiber 拿不到 → 仍是 16:00',
    await run(null, 'https://www.douyin.com/video/7496043889296559386'),
    '2025-04-22 16:00');

  // ③ fiber 串到的另一条（日期不同）→ 保持页面文字
  eq('详情页：fiber 是别的作品 → 保持页面文字',
    await run({ awemeId: '7411950642865917225', createTime: 1725729287 },
      'https://www.douyin.com/video/7496043889296559386'),
    '2025-04-22 16:00');

  // ④ 页面已有秒（图文详情页形态）→ 原样返回，且不浪费一次 fiber 请求
  const dom = new JSDOM(`<!doctype html><html><head><title>t</title></head><body>
      <div class="info"><span>发布时间：2025-06-16 17:44:49</span></div>
    </body></html>`, { url: 'https://www.douyin.com/note/7516480886684568891' });
  const win = dom.window;
  win.BaseExtractor = class BaseExtractor { constructor() { this.siteName = ''; } };
  win.SocialDomUtils = { readMeta: () => '' };
  win.SocialFieldsBuilder = { build: async () => ({}) };
  win.SocialTitleProcessor = { generatePageTitle: () => '' };
  loadInto(win, 'src/content/shared/aweme-id-date.js');
  let asked = 0;
  win.DouyinFiberClient = { getMeta: async () => { asked++; return null; } };
  const prelude = 'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
    'DouyinAwemeDate = window.DouyinAwemeDate, DouyinFiberClient = window.DouyinFiberClient, ' +
    'DouyinModalContext = window.DouyinModalContext;\n';
  new Function('window', 'document', 'console', 'location', prelude + read('src/content/extractors/douyin-social.js'))(
    win, win.document, console, win.location
  );
  const gotNote = await new win.DouyinSocialExtractor().extractPublishDate();
  eq('图文详情页：本来就到秒 → 原样', gotNote, '2025-06-16 17:44:49');
  eq('已经有秒就不再问 fiber（省一次请求）', asked, 0);
  win.close();
}

/* ========================================================================== */

(async () => {
  console.log(`${C.cyan}「日期如实显示」+ 抖音两处老 bug 验收（v2.5.78）${C.reset}`);
  console.log(`${C.gray}源码目录：${SRC}${C.reset}`);

  section1();
  section2();
  section3();
  section4();
  await section5();
  section6();
  await section7();

  console.log('');
  if (fail === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}通过 ${pass} 项，失败 ${fail} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f.name} — ${f.detail || ''}`));
  process.exit(1);
})();
