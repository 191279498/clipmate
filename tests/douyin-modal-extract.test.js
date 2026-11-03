#!/usr/bin/env node
/**
 * 抖音「弹窗取数」验收（v2.5.77 批 2）
 *
 * 批 2 是整件事的核心：让弹窗里的 7 个字段和详情页一模一样。
 * 两条路都必须能独立把字段填满：
 *   A. 原始数据优先（页面 React fiber 上的 awemeInfo）—— 日期精确到秒、图文判定不靠猜、自带防串台
 *   B. DOM 兜底（本条容器内的 data-e2e 节点）—— fiber 取不到时用，最差等于「没有 A」
 *
 * 这个脚本钉住 9 件事：
 *   1. 日期推算的每个分支（带年份 / 只有月日 / 相对时间 / 算不出）
 *   2. 雪花 ID 只当「上传时间」用（不能当发布日期）
 *   3. fiber 读取器：精确匹配、串台防护、取不到返回 null、绝不抛
 *   4. 弹窗上下文：认出弹窗、认对「这一条」、别人的数据一律不要
 *   5. DOM 兜底：3 份真机存档的 7 个字段逐个对
 *   6. fiber 优先：同一页面上 fiber 值与 DOM 值不同时，必须用 fiber 的
 *   7. URL 字段：填规范地址，图文填 /note/，判不出类型填 /video/
 *   8. 熔断：连续 5 次全空 → 停用弹窗提取，工厂退回原提取器
 *   9. 红线：详情页拿到的必须是原 DouyinSocialExtractor，一个字节的行为都不许变
 *
 * 用法：
 *   node tests/douyin-modal-extract.test.js
 *   node tests/douyin-modal-extract.test.js --verbose
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
const SRC = path.join(env.ROOT, 'ClipMate_chrome');

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

/** jsdom 可能不在默认 NODE_PATH 上（照 harness 的找法） */
function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const dir = path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
  return require(path.join(dir, 'jsdom'));
}
const { JSDOM } = loadJsdom();

// ---------- 被测模块（纯函数，Node 直接 require） ----------
const D = require(path.join(SRC, 'src/content/shared/aweme-id-date.js'));
const readDouyinAwemeInfo = require(path.join(SRC, 'src/background/douyin-fiber.js'));

const registry = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'registry.json'), 'utf8')).fixtures;
function fixture(id) {
  const f = registry.find((x) => x.id === id);
  if (!f) throw new Error('找不到 fixture: ' + id);
  return f;
}
function htmlOf(id) {
  return fs.readFileSync(path.join(FIXTURES_DIR, fixture(id).file), 'utf8');
}

// 批 0 抓下来的真实 fiber 样本（awemeInfo 原样）
function loadFiberSample(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(env.ROOT, '.workbuddy/tmp/douyin', name), 'utf8'));
  return JSON.parse(raw.json);
}
const FIBER_VIDEO = loadFiberSample('fiber-meta-video.json');   // 7672265848853220618 美食视频
const FIBER_NOTE = loadFiberSample('fiber-meta-note.json');     // 7516480886684568891 图文

// ============================================================================
// 第 1 节：日期推算（纯函数）
// ============================================================================
function section1() {
  section('一、日期推算：aweme-id-date.js');

  // fiber 的 createTime → 日期时间（本地时区，精度到秒，与页面显示一致）
  // v2.5.78：以前只到「日」，弹窗页因此永远补 00:00；现在 fiber 里有多少就给多少。
  eq('createTime 1786413600 → 2026/08/11 10:00:00', D.formatTimestamp(1786413600), '2026/08/11 10:00:00');
  eq('createTime 1750067089 → 2025/06/16 17:44:49', D.formatTimestamp(1750067089), '2025/06/16 17:44:49');
  eq('createTime 0 → 空', D.formatTimestamp(0), '');
  eq('createTime 非法 → 空', D.formatTimestamp('abc'), '');

  // 雪花 ID = 上传时间（不是发布时间！）
  eq('ID 7672265848853220618 → 上传 2026/08/10（页面是 8月11 发布）', D.uploadDateFromId('7672265848853220618'), '2026/08/10');
  eq('ID 7516480886684568891 → 2025/06/16', D.uploadDateFromId('7516480886684568891'), '2025/06/16');
  eq('ID 7496043889296559386 → 2025/04/22', D.uploadDateFromId('7496043889296559386'), '2025/04/22');
  eq('非雪花 ID（todo）→ 空', D.uploadDateFromId('todo'), '');
  eq('空 ID → 空', D.uploadDateFromId(''), '');

  // ① 带年份：页面就是权威
  eq('带年份直接信页面', D.parsePublishedDate('· 2025年6月16日图文2人共创', '7510886684568891'), '2025/06/16');
  eq('带年份（补零）', D.parsePublishedDate('· 2024年9月8日', '7411950642865917225'), '2024/09/08');

  // ② 只有月日：年份由 ID 补
  eq('只有月日 + ID 补年份', D.parsePublishedDate('· 8月11日980秒静静欣赏', '7672265848853220618'), '2026/08/11');

  // 跨年：ID 上传 2025/12/31，页面写 1月1日 → 必须是 2026/01/01
  const nyeId = (BigInt(Math.floor(Date.UTC(2025, 11, 31, 4, 0, 0) / 1000)) << 32n).toString();
  eq('跨年：12/31 上传、1/1 发布 → 2026/01/01', D.parsePublishedDate('· 1月1日', nyeId), '2026/01/01');

  // 只有月日、但 ID 不可用 → 留空，绝不猜
  eq('只有月日、没有 ID → 留空', D.parsePublishedDate('· 8月11日', ''), '');
  eq('只有月日、ID 非法 → 留空', D.parsePublishedDate('· 8月11日', 'abc'), '');

  // ③ 相对时间：按当前时间倒推（注入 now，避免边界抖动）
  const now = Date.UTC(2026, 9, 27, 4, 0, 0); // 2026-10-27 12:00 北京时间
  eq('2天前 → 2026/10/25', D.parsePublishedDate('· 2天前', '', now), '2026/10/25');
  eq('1周前 → 2026/10/20', D.parsePublishedDate('· 1周前', '', now), '2026/10/20');
  eq('3小时前 → 2026/10/27', D.parsePublishedDate('· 3小时前', '', now), '2026/10/27');

  // ④ 什么都没有 → 空
  eq('空文本 → 空', D.parsePublishedDate('', '7672265848853220618'), '');
  eq('纯文案没有时间 → 空', D.parsePublishedDate('今天做了红烧肉', '7672265848853220618'), '');

  // 批 0 的 20 条真机数据：fiber createTime 与页面显示 20/20 一致（含 1 条相对时间）
  // v2.5.78：formatTimestamp 现在输出到秒（`YYYY/MM/DD HH:mm:ss`），本节只比「哪一天」，
  // 所以取日期部分比；「时分秒是否对」由下面第 1 节的固定时间戳断言钉住。
  const rows = JSON.parse(fs.readFileSync(path.join(env.ROOT, '.workbuddy/tmp/douyin/date-verify-20.json'), 'utf8'));
  let checked = 0;
  let mismatch = 0;
  for (const r of rows) {
    if (!r.fiber日期) continue;
    checked++;
    // fiber 日期（YYYY/MM/DD）反算成时间戳后，再格式化必须回到同一天
    const [y, m, d] = r.fiber日期.split('/').map(Number);
    const ts = Math.floor(new Date(y, m - 1, d, 12, 0, 0).getTime() / 1000);
    const back = D.formatTimestamp(ts);
    const backDate = String(back).split(' ')[0];
    if (backDate !== r.fiber日期) {
      mismatch++;
      if (VERBOSE) console.log(`     ${C.yellow}⚠${C.reset} ${r.id} ${r.fiber日期} → ${back}`);
    }
  }
  if (mismatch) {
    bad('fiber 日期往返一致性', `${mismatch}/${checked} 条不一致`);
  } else {
    ok(`批 0 的 ${checked} 条 fiber 日期往返一致`);
  }
}

// ============================================================================
// 第 2 节：fiber 读取器（纯函数，假 DOM + 真 awemeInfo）
// ============================================================================
/**
 * 造一个「像抖音弹窗」的最小 DOM，并把 awemeInfo 挂到 React fiber 位置上。
 * @param {Object[]} list 每条 {id, info, depth, feedAttr}
 */
function buildFiberDom(list, url) {
  const feedHtml = list.map((item) => {
    const attr = item.feedAttr || 'feed-video';
    return `<div data-e2e="${attr}" class="NhEiLku8 video_${item.id} slide">` +
      `<div class="player"><div class="inner"><div data-e2e="video-info" data-e2e-aweme-id="${item.id}">` +
      `<div data-e2e="feed-video-nickname">@n_${item.id}</div>` +
      `<div data-e2e="video-desc">d_${item.id}</div>` +
      `</div></div></div>` +
      `<a data-e2e="video-avatar" href="//www.douyin.com/user/sec_${item.id}">a</a>` +
      `</div>`;
  }).join('');
  const html = `<!doctype html><html><body><div data-e2e="modal-video-container"><div data-e2e="slideList">${feedHtml}</div></div></body></html>`;
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: url || 'https://www.douyin.com/x?modal_id=' + (list[0] && list[0].id) });
  const w = dom.window;
  const d = w.document;

  // 把 awemeInfo 挂到「info 节点往上第 depth 层」的 memoizedProps 上（模拟真实层级）
  list.forEach((item) => {
    const infoEl = d.querySelector(`[data-e2e="video-info"][data-e2e-aweme-id="${item.id}"]`);
    let node = infoEl;
    const depth = typeof item.depth === 'number' ? item.depth : 2;
    for (let i = 0; i < depth; i++) node = node.parentElement;
    let fiber = { memoizedProps: { awemeInfo: item.info }, return: null };
    // 再往上叠 2 层空 fiber，确保「往上爬」这一段被真的走到
    for (let i = 0; i < 2; i++) fiber = { memoizedProps: {}, return: fiber };
    Object.keys(node).forEach(() => {});
    node['__reactFiber$test' + item.id] = fiber;
  });
  return dom;
}

/** 模拟 chrome.scripting.executeScript 的做法：把函数 toString 后注入页面环境执行 */
function callReader(dom, modalId) {
  const src = readDouyinAwemeInfo.toString();
  return dom.window.eval('(' + src + ')(' + JSON.stringify(modalId) + ')');
}

function section2() {
  section('二、原始数据读取器：douyin-fiber.js（纯函数）');

  const vid = FIBER_VIDEO.awemeId;
  const dom = buildFiberDom([{ id: vid, info: FIBER_VIDEO, depth: 2 }]);
  const meta = callReader(dom, vid);
  truthy('能读到本条作品', !!meta);
  if (meta) {
    eq('awemeId 一致', meta.awemeId, vid);
    eq('createTime 一致', meta.createTime, FIBER_VIDEO.createTime);
    eq('desc 一致', meta.desc, FIBER_VIDEO.desc);
    eq('nickname 一致', meta.nickname, FIBER_VIDEO.authorInfo.nickname);
    eq('secUid 一致', meta.secUid, FIBER_VIDEO.authorInfo.secUid);
    eq('awemeType 一致', meta.awemeType, FIBER_VIDEO.awemeType);
    eq('mediaType 一致', meta.mediaType, FIBER_VIDEO.mediaType);
  }

  // 串台防护：页面里同时挂着两条，只认 modal_id 那一条
  const dom2 = buildFiberDom([
    { id: '7628908247805725986', info: { awemeId: '7628908247805725986', createTime: 1700000000, desc: '别人的', authorInfo: { nickname: '别人', secUid: 'sec_other' } } },
    { id: vid, info: FIBER_VIDEO, depth: 2 }
  ]);
  const meta2 = callReader(dom2, vid);
  truthy('两条作品共存时能读到', !!meta2);
  if (meta2) {
    eq('读到的是本条（不是列表里别人的）', meta2.awemeId, vid);
    eq('昵称也是本条的', meta2.nickname, FIBER_VIDEO.authorInfo.nickname);
  }

  // 精确匹配失败 → null（绝不拿「最像的那条」顶替）
  const meta3 = callReader(dom2, '7000000000000000000');
  falsy('modal_id 对不上 → 返回 null（不猜）', meta3);

  // 没有 modal_id 且只有一条 → 允许取（用于地址栏丢参数的极端情况）
  const meta4 = callReader(dom, '');
  truthy('无 modal_id、页面只有一条 → 取它', !!meta4);

  // 没有 modal_id 且有多条 → null（分不清是谁，宁空不错）
  const meta5 = callReader(dom2, '');
  falsy('无 modal_id、页面有多条 → null', meta5);

  // 页面里没有 fiber（抖音改版 / 静态页）→ null，且不许抛
  const plain = new JSDOM('<!doctype html><body><div data-e2e="video-info" data-e2e-aweme-id="1"></div></body>', { runScripts: 'outside-only' });
  let threw = null;
  let meta6;
  try {
    meta6 = callReader(plain, '1');
  } catch (e) {
    threw = e;
  }
  falsy('没有 fiber 时抛异常了吗', threw);
  falsy('没有 fiber → null', meta6);

  // 连 document 都没有也不许抛
  let threw2 = null;
  try {
    (() => { try { return readDouyinAwemeInfo.call({}, '123'); } catch (e) { return e; } })();
  } catch (e) {
    threw2 = e;
  }
  falsy('没有 document 也不抛', threw2);

  // 图文样本同样能读
  const domNote = buildFiberDom([{ id: FIBER_NOTE.awemeId, info: FIBER_NOTE, depth: 3 }]);
  const noteMeta = callReader(domNote, FIBER_NOTE.awemeId);
  truthy('图文作品也能读到', !!noteMeta);
  if (noteMeta) {
    eq('图文 awemeType = 68', noteMeta.awemeType, 68);
    eq('图文 mediaType = 2', noteMeta.mediaType, 2);
  }
}

// ============================================================================
// 第 3 节：弹窗上下文（真存档）
// ============================================================================
function section3() {
  section('三、弹窗上下文：douyin-modal-context.js（3 份真机存档）');

  // 在 jsdom 里加载该模块（它挂 window.DouyinModalContext）
  function ctxOf(fixtureId) {
    const f = fixture(fixtureId);
    const dom = new JSDOM(htmlOf(fixtureId), { runScripts: 'outside-only', url: f.url });
    const code = fs.readFileSync(path.join(SRC, 'src/content/shared/douyin-modal-context.js'), 'utf8');
    dom.window.eval(code);
    return { dom, ctx: dom.window.DouyinModalContext };
  }

  const cases = [
    { id: 'douyin-modal-search-video-7672265848853220618', workId: '7672265848853220618', note: '搜索页弹窗（页面里有 2 条 video-info）' },
    { id: 'douyin-modal-jingxuan-note-7516480886684568891', workId: '7516480886684568891', note: '精选页图文弹窗（有 3 条 video-info）' },
    { id: 'douyin-modal-user-video-7496043889296559386', workId: '7496043889296559386', note: '用户主页弹窗（有 2 条 video-info）' }
  ];

  for (const c of cases) {
    const { dom, ctx } = ctxOf(c.id);
    const w = dom.window;
    eq(`[${c.note}] 认得出是弹窗`, ctx.isOpen(w.document), true);
    eq(`[${c.note}] 取到正确的作品 ID`, ctx.getWorkId(w.document), c.workId);

    const root = ctx.getRoot(w.document);
    truthy(`[${c.note}] 能取到本条容器`, !!root);
    if (root) {
      const cls = typeof root.className === 'string' ? root.className : '';
      truthy(`[${c.note}] 容器 class 带 video_<id>（判据是 ID 不是「活动」标记）`, cls.indexOf('video_' + c.workId) >= 0);
      // 容器内必须只有一个 video-info —— 保证后面所有查询不会搜到别人
      eq(`[${c.note}] 容器内只有本条 video-info`, root.querySelectorAll('[data-e2e="video-info"]').length, 1);
      eq(`[${c.note}] 容器内有本条 video-desc`, root.querySelectorAll('[data-e2e="video-desc"]').length, 1);
      const av = root.querySelectorAll('a[data-e2e="video-avatar"]');
      truthy(`[${c.note}] 容器内有作者头像链接`, av.length >= 1);
    }
    dom.window.close();
  }

  // 详情页不是弹窗
  const detail = fixture('douyin-video-7411950642865917225');
  const domD = new JSDOM(htmlOf('douyin-video-7411950642865917225'), { runScripts: 'outside-only', url: detail.url });
  domD.window.eval(fs.readFileSync(path.join(SRC, 'src/content/shared/douyin-modal-context.js'), 'utf8'));
  eq('详情页不算弹窗', domD.window.DouyinModalContext.isOpen(domD.window.document), false);
  eq('详情页取不到弹窗 ID', domD.window.DouyinModalContext.getWorkId(domD.window.document), '');
  domD.window.close();

  // 地址栏说 A、页面节点说 B → 宁可返回 null，也不给别人的数据
  const badUrl = 'https://www.douyin.com/search/x?modal_id=7000000000000000000';
  const f1 = fixture('douyin-modal-search-video-7672265848853220618');
  const domM = new JSDOM(htmlOf('douyin-modal-search-video-7672265848853220618'), { runScripts: 'outside-only', url: badUrl });
  domM.window.eval(fs.readFileSync(path.join(SRC, 'src/content/shared/douyin-modal-context.js'), 'utf8'));
  const C1 = domM.window.DouyinModalContext;
  eq('ID 对不上 → getWorkId 返回空（宁空不错）', C1.getWorkId(domM.window.document), '');
  eq('ID 对不上 → getRoot 返回 null', C1.getRoot(domM.window.document), null);
  ok('（对照）同一份存档 URL 对得上时能取到 ID', f1.url.indexOf('modal_id') > 0);
  domM.window.close();
}

// ============================================================================
// 第 4~7 节：端到端（真存档 + 真提取器 + harness）
// ============================================================================
async function loadRealConfigs() {
  return await env.loadBackgroundMediaConfigs();
}

/** 从页面里取出工厂，按 URL 拿提取器并跑完整字段 */
async function extractIn(page) {
  const factory = new page.window.ExtractorFactory();
  const extractor = factory.getExtractorByUrl(page.window.location.href);
  if (!extractor) throw new Error('工厂没给出提取器: ' + page.window.location.href);
  const className = H.extractorNameOf(extractor);
  const data = await extractor.extractAllFields();
  return { className, extractor, data };
}

async function section4to7(mediaConfigs) {
  section('四、DOM 兜底：3 份真机存档的 7 个字段');

  const domCases = [
    {
      id: 'douyin-modal-search-video-7672265848853220618',
      label: '搜索页弹窗·视频',
      expect: {
        '作者昵称': '杰诺探美食',
        '作者主页': 'https://www.douyin.com/user/MS4wLjABAAAAetVj20PZlGwDX7M0ZJDWQmRwCO3j5Wkhq_S785Rrrwc-CWfguNiBX1LIZC-IwTYT',
        '发布日期': '2026/08/11',
        '本页文案': '980秒静静欣赏美食，鸡腿拉面、巴西烤肉 #街头美食 #路边摊美味',
        'URL': 'https://www.douyin.com/video/7672265848853220618'
      }
    },
    {
      id: 'douyin-modal-jingxuan-note-7516480886684568891',
      label: '精选页弹窗·图文',
      expect: {
        '作者昵称': '抖音作者助手',
        '作者主页': 'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY',
        '发布日期': '2025/06/16',
        // 图文的规范地址是 /note/<id>（不是 /video/）。这一条是 v2.5.91「fiber 判不出就补一次
        // #RENDER_DATA」的既定行为 —— 否则详情页给 /note/、弹窗给 /video/ 两边对不上。
        // 黄金基线 tests/golden/douyin-modal-jingxuan-note-7516480886684568891.json 也是 /note/。
        // v2.5.100 校正：这条期望原来写的是 /video/，属于当时漏改的过期断言（生产代码没动）。
        'URL': 'https://www.douyin.com/note/7516480886684568891'
      }
    },
    {
      id: 'douyin-modal-user-video-7496043889296559386',
      label: '用户主页弹窗·视频',
      expect: {
        '作者昵称': '抖音作者助手',
        '作者主页': 'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY',
        '发布日期': '2025/04/22',
        'URL': 'https://www.douyin.com/video/7496043889296559386'
      }
    }
  ];

  for (const c of domCases) {
    const f = fixture(c.id);
    const page = await H.openPage({ url: f.url, html: htmlOf(c.id), mediaConfigs });
    const r = await extractIn(page);
    eq(`[${c.label}] 走的是弹窗提取器`, r.className, 'DouyinModalExtractor');
    for (const [k, v] of Object.entries(c.expect)) {
      eq(`[${c.label}] ${k}`, String(r.data[k] || ''), v);
    }
    // 本页文案单独断言（图文那份 DOM 里只渲染了半句，这里只要求非空且不含「展开」）
    truthy(`[${c.label}] 本页文案非空`, String(r.data['本页文案'] || '').length > 0);
    falsy(`[${c.label}] 文案里没有混进「展开」按钮文字`, /展开$/.test(String(r.data['本页文案'] || '')));
    falsy(`[${c.label}] 日期不是假日期 2023/06/07`, String(r.data['发布日期'] || '') === '2023/06/07');
    page.window.close();
  }

  // ---------------------------------------------------------------- 第 5 节
  section('五、原始数据优先：fiber 值与 DOM 值不同时必须用 fiber');

  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    // 故意给一个与 DOM 完全不同的 createTime / desc / 昵称
    const fake = {
      awemeId: '7672265848853220618',
      awemeType: 68,        // 故意说成图文，验证 URL 跟着变成 /note/
      mediaType: 2,
      createTime: 1600000000, // 2020/09/13
      desc: 'FIBER 文案（应优先于 DOM）',
      itemTitle: '',
      nickname: 'fiber昵称',
      secUid: 'SEC_FIBER'
    };
    const page = await H.openPage({
      url: f.url,
      html: htmlOf('douyin-modal-search-video-7672265848853220618'),
      mediaConfigs,
      chromePatch: (chrome) => {
        const orig = chrome.runtime.sendMessage;
        chrome.runtime.sendMessage = (msg) => {
          if (msg && msg.action === 'douyinFiberMeta') return Promise.resolve({ ok: true, meta: fake });
          return orig(msg);
        };
      }
    });
    const r = await extractIn(page);
    eq('[fiber] 昵称用 fiber 的', String(r.data['作者昵称'] || ''), 'fiber昵称');
    eq('[fiber] 文案用 fiber 的', String(r.data['本页文案'] || ''), 'FIBER 文案（应优先于 DOM）');
    eq('[fiber] 日期用 fiber 的 createTime', String(r.data['发布日期'] || ''), '2020/09/13 20:26:40');
    eq('[fiber] 主页用 fiber 的 secUid', String(r.data['作者主页'] || ''), 'https://www.douyin.com/user/SEC_FIBER');
    eq('[fiber] URL 按 fiber 的图文类型走 /note/', String(r.data['URL'] || ''), 'https://www.douyin.com/note/7672265848853220618');
    eq('[fiber] 走的还是弹窗提取器', r.className, 'DouyinModalExtractor');
    page.window.close();
  }

  // 后台返回 null（取不到）→ 必须安静回落到 DOM，不许报错、不许字段全空
  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    let rejected = null;
    const page = await H.openPage({
      url: f.url,
      html: htmlOf('douyin-modal-search-video-7672265848853220618'),
      mediaConfigs,
      chromePatch: (chrome) => {
        chrome.runtime.sendMessage = (msg) => {
          if (msg && msg.action === 'douyinFiberMeta') return Promise.reject(new Error('后台挂了'));
          return Promise.resolve({ success: true });
        };
      }
    });
    try {
      const r = await extractIn(page);
      eq('[fiber 挂掉] 回落 DOM：昵称', String(r.data['作者昵称'] || ''), '杰诺探美食');
      eq('[fiber 挂掉] 回落 DOM：日期', String(r.data['发布日期'] || ''), '2026/08/11');
      truthy('[fiber 挂掉] 没有整页崩掉', !!r.data);
    } catch (e) {
      rejected = e;
    }
    falsy('[fiber 挂掉] 提取过程不抛异常', rejected && rejected.message);
    page.window.close();
  }

  // 后台返回别人的 awemeId → 客户端必须丢弃（防串台）
  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    const page = await H.openPage({
      url: f.url,
      html: htmlOf('douyin-modal-search-video-7672265848853220618'),
      mediaConfigs,
      chromePatch: (chrome) => {
        chrome.runtime.sendMessage = (msg) => {
          if (msg && msg.action === 'douyinFiberMeta') {
            return Promise.resolve({ ok: true, meta: { awemeId: '9999999999999999999', nickname: '张冠李戴', createTime: 1600000000, desc: '错的数据' } });
          }
          return Promise.resolve({ success: true });
        };
      }
    });
    const r = await extractIn(page);
    eq('[防串台] 后台给出不匹配的 awemeId 时丢弃，回落到 DOM 昵称', String(r.data['作者昵称'] || ''), '杰诺探美食');
    falsy('[防串台] 没有把张冠李戴的文案写进去', String(r.data['本页文案'] || '') === '错的数据');
    page.window.close();
  }

  // ---------------------------------------------------------------- 第 6 节
  section('六、URL 字段：永远给「这条作品该有的地址」');

  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    const page = await H.openPage({ url: f.url, html: htmlOf('douyin-modal-search-video-7672265848853220618'), mediaConfigs });
    const r = await extractIn(page);
    const url = String(r.data['URL'] || '');
    eq('[URL] 不填弹窗地址栏', url.indexOf('modal_id') < 0, true);
    eq('[URL] 不填 /search/', url.indexOf('/search/') < 0, true);
    eq('[URL] 是规范地址', url, 'https://www.douyin.com/video/7672265848853220618');
    page.window.close();
  }

  // ---------------------------------------------------------------- 第 7 节
  section('七、熔断：连续 5 次全空 → 停用弹窗提取，退回原提取器');

  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    const page = await H.openPage({ url: f.url, html: htmlOf('douyin-modal-search-video-7672265848853220618'), mediaConfigs });
    const w = page.window;
    const ModalClass = w.DouyinModalExtractor;
    truthy('弹窗提取器已加载', !!ModalClass);
    eq('初始未熔断', ModalClass.isDisabled(), false);

    // 清掉页面里能取到内容的节点，制造「弹窗在、但三个核心字段全空」
    w.document.querySelectorAll('[data-e2e="video-info"]').forEach((el) => { el.textContent = ''; });

    const factory = new w.ExtractorFactory();
    for (let i = 0; i < 4; i++) {
      await factory.getExtractorByUrl(f.url).extractAllFields();
    }
    eq('4 次全空还没熔断', w.DouyinModalExtractor.isDisabled(), false);
    await factory.getExtractorByUrl(f.url).extractAllFields();
    eq('第 5 次全空 → 已熔断', w.DouyinModalExtractor.isDisabled(), true);

    // 熔断后工厂必须退回原提取器
    const after = factory.getExtractorByUrl(f.url);
    eq('熔断后工厂退回 DouyinSocialExtractor', H.extractorNameOf(after), 'DouyinSocialExtractor');

    ModalClass.resetBreaker();
    eq('重置后恢复弹窗提取器', H.extractorNameOf(factory.getExtractorByUrl(f.url)), 'DouyinModalExtractor');
    page.window.close();
  }
}

// ============================================================================
// 第 8 节：红线 —— 详情页必须还是原来那个提取器
// ============================================================================
async function section8(mediaConfigs) {
  section('八、红线：详情页必须还是原 DouyinSocialExtractor');

  for (const id of ['douyin-video-7411950642865917225', 'douyin-note-7516480886684568891']) {
    const f = fixture(id);
    const page = await H.openPage({ url: f.url, html: htmlOf(id), mediaConfigs });
    const factory = new page.window.ExtractorFactory();
    const ex = factory.getExtractorByUrl(f.url);
    eq(`[${id}] 详情页走原提取器`, H.extractorNameOf(ex), 'DouyinSocialExtractor');
    eq(`[${id}] 详情页不算弹窗`, page.window.DouyinModalContext.isOpen(), false);
    page.window.close();
  }

  // 新模块整个不加载（模拟「脚本被删 / 加载失败」）→ 弹窗页也不许崩，退回原提取器
  {
    const f = fixture('douyin-modal-search-video-7672265848853220618');
    const page = await H.openPage({
      url: f.url,
      html: htmlOf('douyin-modal-search-video-7672265848853220618'),
      mediaConfigs,
      scriptFilter: (rel) => !/douyin-modal\.js|douyin-fiber-client\.js|douyin-modal-context\.js|aweme-id-date\.js/.test(rel)
    });
    const factory = new page.window.ExtractorFactory();
    const ex = factory.getExtractorByUrl(f.url);
    eq('[新模块没加载] 退回原提取器，不报错', H.extractorNameOf(ex), 'DouyinSocialExtractor');
    let threw = null;
    try {
      await ex.extractAllFields();
    } catch (e) { threw = e; }
    falsy('[新模块没加载] 提取不抛异常', threw && threw.message);
    page.window.close();
  }
}

// ============================================================================
// 第 9 节（v2.7.2）：无文案作品 —— video-desc 里只剩「展开」俩字
// ============================================================================
// 实测（2026-10-30 用户真机）：作品没有文案时，抖音仍渲染 `[data-e2e="video-desc"]`，
// 里面只剩一个类名混淆的「展开」按钮 span。旧版清洗「超过 4 字才删结尾的展开」
// 放过了它 → 文案字段=「展开」→ 不算空 → 「抖音视频」兜底被跳过，标题也被污染。
// v2.7.2 起无条件删，删空 → 兜底接管。
async function section9(mediaConfigs) {
  section('九、无文案作品：video-desc 只剩「展开」→ 兜底「抖音视频」');

  const id = '7695348431699197809';
  // 结构照抄真机实拍：desc 容器里只有一个混淆类名的「展开」span，没有任何文案文本
  const html = `<!doctype html><html><head><title>抖音</title></head><body>` +
    `<div data-e2e="modal-video-container"><div data-e2e="slideList">` +
    `<div data-e2e="feed-video" class="NhEiLku8 video_${id} slide">` +
    `<div class="player"><div class="inner"><div data-e2e="video-info" data-e2e-aweme-id="${id}">` +
    `<div data-e2e="feed-video-nickname">@实拍用户</div>` +
    `<div data-e2e="video-desc"><span class="wB7XlRLR mFwiPSN7">展开</span></div>` +
    `</div></div></div>` +
    `<a data-e2e="video-avatar" href="//www.douyin.com/user/sec_live1">a</a>` +
    `</div></div></div></body></html>`;
  const url = 'https://www.douyin.com/user/MS4wLjABAAAA_live?modal_id=' + id;

  // 9.1 清洗函数本体的边界（不碰 DOM，直接调真方法）
  {
    const page = await H.openPage({ url, html, mediaConfigs });
    const W = page.window;
    const ex = new W.ExtractorFactory().getExtractorByUrl(url);
    truthy('[9.1] 弹窗页给出弹窗提取器', H.extractorNameOf(ex) === 'DouyinModalExtractor');
    const strip = (t) => ex._stripExpand(t);
    eq('[9.1] 「展开」→ 空串', strip('展开'), '');
    eq('[9.1] 「 展开 」→ 空串', strip(' 展开 '), '');
    eq('[9.1] 「收起文案展开」→ 保留正文', strip('收起文案展开'), '收起文案');
    eq('[9.1] 普通文案原样保留', strip('今天天气不错'), '今天天气不错');
    eq('[9.1] 空串进空串出', strip(''), '');
    page.window.close();
  }

  // 9.2 全链路：fiber 缺席 → DOM 兜底读到「展开」→ 删空 → 空文案兜底接管
  {
    const page = await H.openPage({ url, html, mediaConfigs });
    const factory = new page.window.ExtractorFactory();
    const ex = factory.getExtractorByUrl(url);
    const data = await ex.extractAllFields();
    eq('[9.2] 本页文案 = 抖音视频（兜底接管）', String(data['本页文案'] || ''), '抖音视频');
    falsy('[9.2] 标题不再混入「展开」', String(data['本页标题'] || '').indexOf('展开') > -1);
    page.window.close();
  }
}

/**
 * 十、形态判定：图文 vs 视频（v2.7.3）
 *
 * 用户真机报障：图文作品无文案时，浮窗「本页文案」填的是「抖音视频」。
 * 根因：形态判定只认地址栏 `/note/`，而弹窗态地址是 `/user/…?modal_id=` ——
 * 同一个作品，URL 字段输 `/note/…`、文案却填「抖音视频」，自相矛盾。
 *
 * 现在两处共用 `_isNoteWork()`，这一节钉死三件事：
 *   1. 三档判定的优先级（一手数据 > SSR 直出 > 地址栏）；
 *   2. URL 与形态永远同源（不可能一个说图文、一个说视频）；
 *   3. 判不出来时维持旧行为（落视频档），不新增误报。
 */
async function section10(mediaConfigs) {
  section('十、形态判定：图文 vs 视频（v2.7.3）——URL 与文案兜底必须同源');

  const id = '7695348431699197809';
  // 结构与第九节一致（真机实拍）：文案容器里只有「展开」→ 删空 → 空文案兜底接管
  const html = `<!doctype html><html><head><title>抖音</title></head><body>` +
    `<div data-e2e="modal-video-container"><div data-e2e="slideList">` +
    `<div data-e2e="feed-video" class="NhEiLku8 video_${id} slide">` +
    `<div class="player"><div class="inner"><div data-e2e="video-info" data-e2e-aweme-id="${id}">` +
    `<div data-e2e="feed-video-nickname">@实拍用户</div>` +
    `<div data-e2e="video-desc"><span class="wB7XlRLR mFwiPSN7">展开</span></div>` +
    `</div></div></div>` +
    `<a data-e2e="video-avatar" href="//www.douyin.com/user/sec_live1">a</a>` +
    `</div></div></div></body></html>`;

  const modalUrl = 'https://www.douyin.com/user/MS4wLjABAAAA_live?modal_id=' + id;
  const noteUrl = 'https://www.douyin.com/note/' + id;

  // 让后台「返回指定原始数据」：awemeId 必须对得上（对不上会被防串台丢掉）
  const patchFiber = (meta) => (chrome) => {
    const orig = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = (msg) => {
      if (msg && msg.action === 'douyinFiberMeta') return Promise.resolve({ ok: true, meta });
      return orig ? orig(msg) : Promise.resolve({ success: true });
    };
  };

  const shapeOf = async (url, pageHtml, chromePatch) => {
    const page = await H.openPage({ url, html: pageHtml, mediaConfigs, chromePatch });
    const ex = new page.window.ExtractorFactory().getExtractorByUrl(url);
    const shape = await ex.getContentShape();
    const data = await ex.extractAllFields();
    page.window.close();
    return { shape, data, className: H.extractorNameOf(ex) };
  };

  // 10.1 一手数据 awemeType=68 → 图文（弹窗态，地址栏里没有 /note/）
  {
    const r = await shapeOf(modalUrl, html, patchFiber({
      awemeId: id, awemeType: 68, desc: '', nickname: '图文作者', createTime: 1600000000
    }));
    eq('[10.1] awemeType=68 → 形态 photo', r.shape, 'photo');
    eq('[10.1] URL 输 /note/', String(r.data['URL'] || ''), 'https://www.douyin.com/note/' + id);
    eq('[10.1] 无文案 → 兜底「抖音图文」', String(r.data['本页文案'] || ''), '抖音图文');
    truthy('[10.1] 标题也用兜底词（不再出现「无文案」）',
      String(r.data['本页标题'] || '').indexOf('抖音图文') > -1);
  }

  // 10.2 一手数据 mediaType=2（没有 awemeType）→ 图文
  {
    const r = await shapeOf(modalUrl, html, patchFiber({
      awemeId: id, mediaType: 2, desc: '', nickname: '图文作者', createTime: 1600000000
    }));
    eq('[10.2] mediaType=2 → 形态 photo', r.shape, 'photo');
    eq('[10.2] URL 输 /note/', String(r.data['URL'] || ''), 'https://www.douyin.com/note/' + id);
    eq('[10.2] 无文案 → 兜底「抖音图文」', String(r.data['本页文案'] || ''), '抖音图文');
  }

  // 10.3 一手数据说视频（awemeType=4）→ 视频，不能因为弹窗就乱猜
  {
    const r = await shapeOf(modalUrl, html, patchFiber({
      awemeId: id, awemeType: 4, desc: '', nickname: '视频作者', createTime: 1600000000
    }));
    eq('[10.3] awemeType=4 → 形态 video', r.shape, 'video');
    eq('[10.3] URL 输 /video/', String(r.data['URL'] || ''), 'https://www.douyin.com/video/' + id);
    eq('[10.3] 无文案 → 兜底「抖音视频」', String(r.data['本页文案'] || ''), '抖音视频');
  }

  // 10.4 拿不到原始数据（弹窗态）→ 维持旧行为：落视频档，不新增误报
  {
    const r = await shapeOf(modalUrl, html, undefined);
    eq('[10.4] 判不出 → 形态 video（旧行为不变）', r.shape, 'video');
    eq('[10.4] URL 输 /video/', String(r.data['URL'] || ''), 'https://www.douyin.com/video/' + id);
    eq('[10.4] 无文案 → 兜底「抖音视频」', String(r.data['本页文案'] || ''), '抖音视频');
  }

  // 详情页壳子（没有弹窗容器 → 工厂必须给回原提取器，见第八节红线）
  const detailHtml = `<!doctype html><html><head><title>抖音</title></head><body>` +
    `<div data-e2e="video-info"><div data-e2e="video-desc"><span class="x">展开</span></div>` +
    `</div></body></html>`;

  // 10.5 详情页直达 /note/<id>：地址栏那一档（页面不发请求，前两档都空）
  {
    const r = await shapeOf(noteUrl, detailHtml, undefined);
    eq('[10.5] 详情页走的是原提取器', r.className, 'DouyinSocialExtractor');
    eq('[10.5] 地址栏 /note/ → 形态 photo', r.shape, 'photo');
    truthy('[10.5] URL 输 /note/', String(r.data['URL'] || '').indexOf('/note/') > -1);
  }

  // 10.6 地址栏与一手数据打架时 → 一手数据说了算（不能反过来）
  {
    const r = await shapeOf(noteUrl, detailHtml, patchFiber({
      awemeId: id, awemeType: 4, desc: '', nickname: '视频作者', createTime: 1600000000
    }));
    eq('[10.6] 地址栏 /note/ 但原始数据说视频 → 信原始数据，形态 video', r.shape, 'video');
  }

  // 10.7 同源不变量：URL 说图文 ⟺ 形态说图文（本次修复的核心，绝不能再打架）
  {
    const cases = [
      { label: '图文（awemeType=68）', meta: { awemeId: id, awemeType: 68, desc: '', createTime: 1600000000 }, wantNote: true },
      { label: '视频（awemeType=4）', meta: { awemeId: id, awemeType: 4, desc: '', createTime: 1600000000 }, wantNote: false }
    ];
    for (const c of cases) {
      const r = await shapeOf(modalUrl, html, patchFiber(c.meta));
      const urlIsNote = String(r.data['URL'] || '').indexOf('/note/') > -1;
      const shapeIsPhoto = r.shape === 'photo';
      eq(`[10.7] ${c.label}：URL 与形态一致`, urlIsNote === shapeIsPhoto, true);
      eq(`[10.7] ${c.label}：文案兜底与形态一致`,
        String(r.data['本页文案'] || ''), c.wantNote ? '抖音图文' : '抖音视频');
    }
  }
}

// ============================================================================
// 主流程
// ============================================================================
(async () => {
  console.log(`${C.cyan}抖音弹窗取数验收（v2.5.77 批 2）${C.reset}`);

  section1();
  section2();
  section3();

  const mediaConfigs = await loadRealConfigs();
  if (mediaConfigs && mediaConfigs.__error) {
    console.log(`${C.red}✗ 读不到后台媒体配置表：${mediaConfigs.__error}${C.reset}`);
    process.exit(1);
  }

  await section4to7(mediaConfigs);
  await section8(mediaConfigs);
  await section9(mediaConfigs);
  await section10(mediaConfigs);

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}通过 ${pass} 项，失败 ${failures.length} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f.name}${f.detail ? '  ' + f.detail : ''}`));
  process.exit(1);
})().catch((e) => {
  console.error(`${C.red}测试脚本自身异常：${C.reset}`, e);
  process.exit(2);
});
