#!/usr/bin/env node
/**
 * 抖音「注入范围」验收（v2.5.77 批 1 → v2.5.78 整站匹配）
 *
 * 三件事，逐件钉住：
 *   ① manifest 的抖音 matches 从 9 条收成 **2 条整站**（`www.douyin.com/*` + `v.douyin.com/*`）
 *   ② 首页 / 推荐 / 关注 / 朋友 / 精选 / 搜索 / 用户主页 / 详情页**全部**要能注入
 *      （v2.5.78 实测：从 `https://www.douyin.com/` 进来，抖音客户端跳到 `/jingxuan`，
 *       但文档是在 `/` 创建的，Chrome 不会二次注入 → 全程没有按钮，F5 才恢复；
 *       窄路径清单正是那次「怎么点都没按钮」的根因）
 *   ③ 新入口页面加载了脚本，但**没点开视频时不许出按钮** —— 靠 media-detector 的
 *      `noContentFallback` 标记：抖音路径不匹配就返回 null，不退回「按正文猜类型」
 *
 * ⚠️ 批 3 更新了这条契约：点开弹层之后**必须**出按钮（按钮浮在弹窗右上角），
 * 那条链路见 `tests/douyin-modal-handler.test.js`。本节只保留「没弹窗 = 什么都不出」。
 *
 * 为什么要 ③：detect() 原本在「站点在表里、但路径不匹配」时会退到 detectByContent()。
 * 抖音信息流页面上满是「#话题 / 点赞 / 评论」，猜出来就是 social，
 * 于是按钮会冒在精选页上，点开还是错的。批 -1 已经吃过一次这个亏
 * （/user/…?modal_id= 被判成 movie、字段从 11 项变 32 项）。
 *
 * 用法：
 *   node tests/douyin-inject-scope.test.js
 *   node tests/douyin-inject-scope.test.js --verbose
 *
 * 只读产品源码与存档，不写任何东西。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('./lib/env');
const H = require('./lib/harness');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const VERBOSE = process.argv.includes('--verbose');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, `${JSON.stringify(actual)}`);
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual) {
  if (actual) ok(name);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual) {
  if (!actual) ok(name);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}

function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

/** 抖音应当加载内容脚本的 matcher（v2.5.78 起整站匹配，只剩 2 条） */
const EXPECTED_DOUYIN_MATCHES = [
  'https://www.douyin.com/*',
  'https://v.douyin.com/*'
];

/**
 * 必须能加载的页面。
 *
 * v2.5.78 之前这里是「不匹配」清单 —— 因为只列了 9 条窄路径，首页/关注/朋友
 * 压根没有代码。实测从 `https://www.douyin.com/` 进来，抖音客户端跳到
 * `/jingxuan`，但文档是在 `/` 创建的，Chrome 不会再注入 → 全程没有按钮（F5 才好）。
 * 所以现在必须**全部匹配**，这一组的意义反转成了「这些页面一定要有代码」。
 */
const MUST_MATCH_PAGES = [
  'https://www.douyin.com/',
  'https://www.douyin.com/?recommend=1',
  'https://www.douyin.com/jingxuan?modal_id=7516480886684568891',
  'https://www.douyin.com/follow',
  'https://www.douyin.com/friend',
  'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F',
  'https://www.douyin.com/user/MS4wLjABAAAA',
  'https://www.douyin.com/video/7411950642865917225',
  'https://www.douyin.com/note/7516480886684568891',
  'https://www.douyin.com/collection/123',
  'https://www.douyin.com/hashtag/456',
  'https://v.douyin.com/4OMFTSdHrxA/'
];

/** 整站匹配的已知代价：这些无关页面也会注入脚本（只是什么都不做） */
const HARMLESS_EXTRA_PAGES = [
  'https://www.douyin.com/live',
  'https://www.douyin.com/download',
  'https://www.douyin.com/message'
];

/**
 * 把 chrome match pattern 转成等价正则（只处理本项目用到的形态：`*` 通配、`/*` 前缀）
 *
 * v2.5.78 修正：原来先把整串转义、再做三次 replace，结果 `/*` 被替换成 `/.*` 之后
 * 又被「`*` → `.*`」那一遍吃了一口，变成 `/..*`（要求斜杠后至少有 1 个字符），
 * 于是 `https://www.douyin.com/` 这种「整站根部」永远匹配不上。现在逐字符转换，一次到位。
 */
function patternToRegExp(pattern) {
  let body = '';
  for (const ch of pattern) {
    if (ch === '*') {
      body += '.*';
    } else {
      body += ch.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  return new RegExp('^' + body + '$');
}

function matchAny(url, patterns) {
  return patterns.some((p) => patternToRegExp(p).test(url));
}

function loadFixtures() {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'registry.json'), 'utf8'));
  return raw.fixtures || [];
}

function readFixture(fixture) {
  return fs.readFileSync(path.join(FIXTURES_DIR, fixture.file), 'utf8');
}

/** jsdom 可能不在默认 NODE_PATH 上（照 harness 的找法） */
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
const { JSDOM } = loadJsdom();

/**
 * 把「弹层」从存档里摘掉，模拟「信息流页、用户还没点开任何视频」。
 *
 * 为什么需要：三份弹窗存档都是在弹层打开的状态下抓的（DOM 里有
 * modal-video-container / video-info / video-desc）。不做这一步，
 * 「没弹窗时什么都不出」这条就永远测不了 —— 页面看起来永远像开着弹窗。
 */
function stripModalNodes(html, url) {
  const dom = new JSDOM(html, { url });
  const d = dom.window.document;
  ['modal-video-container', 'video-info', 'video-desc'].forEach((sel) => {
    d.querySelectorAll(`[data-e2e="${sel}"]`).forEach((el) => el.remove());
  });
  return '<!doctype html>' + d.documentElement.outerHTML;
}

/* ============================ 一、manifest 范围 ============================ */

function testManifestScope() {
  section('一、manifest 注入范围（整站匹配）');
  const matches = env.manifest.content_scripts[0].matches;

  const douyin = matches.filter((m) => m.includes('douyin'));
  eq('抖音 matcher 数量 = 2', douyin.length, 2);

  for (const m of EXPECTED_DOUYIN_MATCHES) {
    truthy(`包含 ${m}`, douyin.includes(m));
  }

  const extra = douyin.filter((m) => !EXPECTED_DOUYIN_MATCHES.includes(m));
  eq('没有多出来的抖音 matcher', extra.length, 0);
  if (extra.length) console.log('    多出来的：', extra);

  for (const url of MUST_MATCH_PAGES) {
    truthy(`能注入 ${url}`, matchAny(url, douyin));
  }

  for (const url of HARMLESS_EXTRA_PAGES) {
    truthy(`也会注入（无害）${url}`, matchAny(url, douyin));
  }

  // 其他站点一条都没被动过（非抖音 36 条 + 抖音 2 条 = 38）
  // v2.5.82：快手从两条窄路径（/short-video/*、/video/*）合并成一条整站
  // `https://www.kuaishou.com/*` → 总数从 40 变 39、非抖音从 38 变 37。
  // v2.6.0：小红书同理，三条（/discovery/item/*、/explore/、/explore/*）合并成
  // `https://www.xiaohongshu.com/*`（搜索页与用户主页也要注入）→ 39 变 37、37 变 35。
  // v2.7.12：新增豆瓣影人页 `https://www.douban.com/personage/*`（人物档案 / celebrity）
  // → 37 变 38、35 变 36。
  // v2.7.28：新增 B站个人空间 `https://space.bilibili.com/*`（人物档案 / person，
  // 与作品页的 www.bilibili.com 是两个域名，必须单独注入）→ 38 变 39、36 变 37。
  // v2.7.39：新增微博搜索页 `https://s.weibo.com/*`（逐帖小按钮，用户 2026-11-01 拍板
  // 「搜索页也要覆盖」；它与 weibo.com 是两个域名，不单独注入就一颗按钮都没有）
  // → 39 变 40、37 变 38。
  // v2.11.0：新增红果短剧三个域名（hongguoduanju.com / www.hongguoduanju.com /
  // www.novelquickapp.com，都是 /detail* 详情页）→ 40 变 43、38 变 41。
  // v2.11.4：新增豆瓣收藏三态 `https://movie.douban.com/people/*`
  // （想看 / 在看 / 看过，逐条小按钮）→ 43 变 44、41 变 42。
  eq('matches 总数 = 44', matches.length, 44);
  eq('非抖音 matcher 数量 = 42', matches.filter((m) => !m.includes('douyin')).length, 42);
}

/* ==================== 二、检测器：新入口一律「放弃」 ==================== */

async function testDetector({ realConfigs }) {
  section('二、媒体类型检测（用 background 的真实配置）');

  const fixture = loadFixtures().find((f) => f.id === 'douyin-video-7411950642865917225');
  const page = await H.openPage({
    url: fixture.url,
    html: readFixture(fixture),
    mediaConfigs: realConfigs
  });

  const Detector = page.window.MediaTypeDetector;
  truthy('MediaTypeDetector 已加载', !!Detector);

  const det = new Detector();
  det.siteConfigs = realConfigs;

  const douyinCfg = realConfigs['www.douyin.com'];
  truthy('www.douyin.com 在配置表里', !!douyinCfg);
  eq('www.douyin.com 声明了 noContentFallback', douyinCfg && douyinCfg.noContentFallback, true);

  // 该出的出
  eq('/video/ 详情页 → social',
    det.detect('https://www.douyin.com/video/7411950642865917225', page.window.document), 'social');
  eq('/note/ 详情页 → social',
    det.detect('https://www.douyin.com/note/7516480886684568891', page.window.document), 'social');
  eq('短链域 → social',
    det.detect('https://v.douyin.com/4OMFTSdHrxA/', page.window.document), 'social');

  // 不该出的（批 1 新加载的 6 条入口）—— 必须 null
  const silentUrls = [
    'https://www.douyin.com/jingxuan?modal_id=7672265848853220618',
    'https://www.douyin.com/jingxuan/knowledge?modal_id=7672265848853220618',
    'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?modal_id=7672265848853220618',
    'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY?modal_id=7496043889296559386',
    'https://www.douyin.com/hashtag/1234567890',
    'https://www.douyin.com/collection/7370000000000000000',
    'https://www.douyin.com/discover?modal_id=7672265848853220618'
  ];
  for (const u of silentUrls) {
    eq(`${new URL(u).pathname}${new URL(u).search ? '?…' : ''} → null`, det.detect(u, page.window.document), null);
  }

  // 其他站一个字都没变（回归：证明 noContentFallback 没波及别人)
  eq('豆瓣书籍页 → book',
    det.detect('https://book.douban.com/subject/1084336/', page.window.document), 'book');
  eq('豆瓣影视页 → movie',
    det.detect('https://movie.douban.com/subject/1292052/', page.window.document), 'movie');
  eq('B 站视频页 → social',
    det.detect('https://www.bilibili.com/video/BV1xx411c7mD', page.window.document), 'social');

  page.dom.window.close();
}

/* ============ 三、端到端：有弹窗就出按钮，没弹窗就什么都不出 ============ */

async function testEntryButtons({ realConfigs }) {
  section('三、端到端（弹窗开 → 出按钮；没弹窗 → 什么都不出）');

  // 批 3 之后：这 3 个入口在「弹层已打开」的状态下必须接管并出按钮。
  // （批 1 当时断言的是「不出按钮」，因为那时还没做弹窗接管；批 3 已把这条契约升级。）
  const targets = [
    { id: 'douyin-modal-jingxuan-note-7516480886684568891', label: '精选页弹窗' },
    { id: 'douyin-modal-search-video-7672265848853220618', label: '搜索页弹窗' },
    { id: 'douyin-modal-user-video-7496043889296559386', label: '用户主页弹窗' }
  ];

  for (const t of targets) {
    const fixture = loadFixtures().find((f) => f.id === t.id);
    if (!fixture) { bad(`${t.label}：存档缺失`, t.id); continue; }

    const page = await H.openPage({
      url: fixture.url,
      html: readFixture(fixture),
      mediaConfigs: realConfigs
    });
    const inst = await H.waitForInit(page, 6000);

    eq(`${t.label}：弹窗态出现 1 个按钮`,
      page.window.document.querySelectorAll('.media-extractor-button').length, 1);
    truthy(`${t.label}：实例已接管`,
      !!(inst && inst.isInitialized));

    page.dom.window.close();
  }

  // 真正「没点开视频」的信息流页：把弹层节点摘掉、地址不带 modal_id
  // （存档都是弹窗打开时抓的，所以这里在测试侧做一次 DOM 手术来模拟信息流页）
  const feedFixture = loadFixtures().find((f) => f.id === 'douyin-modal-jingxuan-note-7516480886684568891');
  const feedUrl = 'https://www.douyin.com/jingxuan';
  const feedPage = await H.openPage({
    url: feedUrl,
    html: stripModalNodes(readFixture(feedFixture), feedUrl),
    mediaConfigs: realConfigs
  });
  const feedInst = await H.waitForInit(feedPage, 1800);
  eq('无弹窗的信息流页：一个按钮都没有',
    feedPage.window.document.querySelectorAll('.media-extractor-button').length, 0);
  falsy('无弹窗的信息流页：未接管', !!(feedInst && feedInst.isInitialized));
  eq('无弹窗的信息流页：监听已挂好（等用户点开视频）',
    typeof (feedInst && feedInst._douyinWatch), 'function');
  eq('无弹窗的信息流页：类型检测为空（按设计）',
    feedInst && feedInst.detectMediaType(), null);
  feedPage.dom.window.close();

  // 回归：详情页必须照旧出按钮
  const videoFixture = loadFixtures().find((f) => f.id === 'douyin-video-7411950642865917225');
  const page = await H.openPage({
    url: videoFixture.url,
    html: readFixture(videoFixture),
    mediaConfigs: realConfigs
  });
  const inst = await H.waitForInit(page);
  truthy('详情页：实例已初始化', !!(inst && inst.isInitialized));
  eq('详情页：按钮出现且只有一个',
    page.window.document.querySelectorAll('.media-extractor-button').length, 1);
  page.dom.window.close();
}

/* ================================ 主流程 ================================ */

(async () => {
  console.log(`${C.cyan}抖音注入范围验收（v2.5.77 批 1）${C.reset}`);
  console.log(`${C.gray}源码目录：${env.ROOT}${C.reset}`);

  const realConfigs = await env.loadBackgroundMediaConfigs();
  if (realConfigs && realConfigs.__error) {
    console.log(`${C.red}拿不到 background 的媒体配置：${realConfigs.__error}${C.reset}`);
    process.exit(2);
  }

  testManifestScope();
  await testDetector({ realConfigs });
  await testEntryButtons({ realConfigs });

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
    failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name} — ${f.detail || ''}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error(`${C.red}脚本自身异常：${C.reset}`, err);
  process.exit(3);
});
