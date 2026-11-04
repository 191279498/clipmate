#!/usr/bin/env node
/**
 * 快手作者ID提速验收（v2.7.10）
 *
 * 要钉住的事：**详情页首次提取不再「白花一次主页访问 + 死等 10 秒」。**
 *
 * 改前（真机实测约 25 秒）是纯串行：
 *   fetch 作者主页 HTML（**没有超时，可能一直挂着**）
 *   → parseKwaiIdFromHtml（主页是 SPA 空壳，几乎必然落空）
 *   → 才开始 iframe 渲染
 *   → 固定 400ms 轮询，最长死等 10000ms
 *   → 拿不到才回落到内部 userId
 *
 * 改后：
 *   1. HTML 快枪与 iframe 渲染**同时开跑**，谁先给出通过校验的快手号就用谁。
 *   2. HTML 只给 3 秒（fetchTimeout + AbortController），拿不到就放弃，不许拖。
 *   3. iframe 轮询 400ms → 100ms，另加 MutationObserver（数据一插进 DOM 就扫），
 *      超时 10000ms → 5000ms，到点必须删掉 iframe。
 *
 * 本脚本六节：
 *   一、fetchTimeout：到点必须 abort，且不传时行为与老版一致
 *   二、并行：两路必须「同时起跑」，总耗时为 max 而非 sum
 *   三、race 语义：先到的非法值不许抢先，两路皆空才返回空
 *   四、串行默认：不传 parallelRenderer 时行为与老版完全一致
 *   五、iframe 渲染器：100ms 轮询 + observer 抢跑 + 占位符跳过 + 超时清理
 *   六、接线与结构：快手真的传了这两个参数，注释不许骗人
 *
 * 用法：
 *   node tests/kuaishou-author-id-speed.test.js
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules \
 *     node tests/kuaishou-author-id-speed.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM = null;
try {
  // jsdom 在本机是全局依赖，需要 NODE_PATH 指过去（见 tests/README.md）
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  JSDOM = null;
}

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const FETCHER_PATH = path.join(ROOT, 'src/content/shared/author-id-fetcher.js');
const EXTRACTOR_PATH = path.join(ROOT, 'src/content/extractors/kuaishou-social.js');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  cyan: '\u001b[36m', gray: '\u001b[90m'
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
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual, detail) {
  if (actual) ok(name, detail);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual, detail) {
  if (!actual) ok(name, detail);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// author-id-fetcher 是 IIFE，模块加载时就把 `window` 抓成自己的 global。
// Node 里没有 window → 传进去的是 null → 读缓存那行 `global.cacheManager` 直接崩。
// 浏览器里 global 恒为 window 所以从没暴露过；这里按浏览器形态补上。
if (typeof global.window === 'undefined') global.window = globalThis;

const Fetcher = require(FETCHER_PATH);
const EXTRACTOR_SRC = fs.readFileSync(EXTRACTOR_PATH, 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

/** 保存/恢复 global.fetch，测试之间互不污染 */
const realFetch = global.fetch;
function useFetch(impl) {
  global.fetch = impl;
}
function restoreFetch() {
  if (realFetch) global.fetch = realFetch;
  else delete global.fetch;
}

/* ======================== 一、fetchTimeout ======================== */

async function section1() {
  section('一、fetchTimeout：到点必须 abort，不传时行为不变');

  // 1) 请求僵住时，3 秒（这里用 120ms 代）必须放弃，而不是一直挂着
  let aborted = false;
  let sawSignal = false;
  useFetch((url, opts) => new Promise((resolve, reject) => {
    sawSignal = !!(opts && opts.signal);
    if (opts && opts.signal) {
      opts.signal.addEventListener('abort', () => {
        aborted = true;
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }
    // 永不 resolve —— 模拟网关限流把连接挂住
  }));

  const t0 = Date.now();
  const html = await Fetcher.fetchHomepage({ homepage: 'https://www.kuaishou.com/profile/x', fetchTimeout: 120 });
  const cost = Date.now() - t0;

  eq('[超时] 超时后返回空串，不抛错', html, '');
  truthy('[超时] 确实带上了 AbortSignal', sawSignal);
  truthy('[超时] 到点真的 abort 了（不是等它自己结束）', aborted);
  truthy('[超时] 120ms 的时限内就返回了（没有挂死）', cost < 600, cost + 'ms');

  // 2) 不传 fetchTimeout：不许加 signal，老行为必须一模一样
  let signalWhenAbsent = 'n/a';
  useFetch(async (url, opts) => {
    signalWhenAbsent = opts && opts.signal;
    return { ok: true, status: 200, text: async () => '<html>ok</html>' };
  });
  const plain = await Fetcher.fetchHomepage({ homepage: 'https://www.kuaishou.com/profile/x' });
  eq('[超时] 不传 fetchTimeout 时正常返回 HTML', plain, '<html>ok</html>');
  eq('[超时] 不传 fetchTimeout 时绝不加 signal（抖音/小红书不受影响）', signalWhenAbsent, undefined);

  // 3) 超时不影响正常响应（有 signal 也能正常读完）
  useFetch(async (url, opts) => {
    const body = 'x'.repeat(200);
    return { ok: true, status: 200, text: async () => body };
  });
  const body = await Fetcher.fetchHomepage({ homepage: 'https://www.kuaishou.com/profile/x', fetchTimeout: 3000 });
  eq('[超时] 有超时设置时正常响应照样读全', body.length, 200);

  restoreFetch();
}

/* ======================== 二、并行 ======================== */

async function section2() {
  section('二、并行：两路必须同时起跑，总耗时是 max 不是 sum');

  const timeline = [];
  const base = Date.now();

  useFetch(async () => {
    timeline.push({ at: Date.now() - base, who: 'fetch-start' });
    await sleep(90);
    // HTML 里没有快手号（SPA 空壳），老流程就是卡在这里白等
    return { ok: true, status: 200, text: async () => '<html><body></body></html>' };
  });

  const t0 = Date.now();
  const id = await Fetcher.extract({
    site: 'kuaishou_social',
    homepage: 'https://www.kuaishou.com/profile/3x87w8rbwxepda6',
    parse: () => '',
    renderer: async () => {
      timeline.push({ at: Date.now() - base, who: 'renderer-start' });
      await sleep(160);
      return 'fanfan123';
    },
    parallelRenderer: true,
    fetchTimeout: 3000,
    validate: (v) => !!v && !/^(.)\1{2,}$/.test(v)
  });
  const cost = Date.now() - t0;

  eq('[并行] HTML 落空时由 iframe 给出结果', id, 'fanfan123');

  const fetchStart = timeline.find((x) => x.who === 'fetch-start');
  const renderStart = timeline.find((x) => x.who === 'renderer-start');
  truthy('[并行] 两路都起跑了', fetchStart && renderStart);
  if (fetchStart && renderStart) {
    const gap = Math.abs(renderStart.at - fetchStart.at);
    truthy('[并行] 两路起跑间隔 < 40ms（串行时会等于 fetch 的 90ms）', gap < 40, gap + 'ms');
  }

  // 串行成本 = 90(fetch) + 160(iframe) = 250ms；并行 = 160ms
  truthy('[并行] 总耗时落在 max 一档（< 230ms），不是 sum', cost < 230, cost + 'ms');

  // HTML 先命中时，绝不能等 iframe 跑完
  useFetch(async () => ({ ok: true, status: 200, text: async () => '<html>"kwaiId":"fast_one"</html>' }));
  const t1 = Date.now();
  const fast = await Fetcher.extract({
    site: 'kuaishou_social',
    homepage: 'https://www.kuaishou.com/profile/x',
    parse: (html) => (/kwaiId":"([^"]+)"/.exec(html) || [])[1] || '',
    renderer: async () => { await sleep(300); return 'slow_one'; },
    parallelRenderer: true,
    fetchTimeout: 3000,
    validate: (v) => !!v
  });
  const fastCost = Date.now() - t1;
  eq('[并行] HTML 先命中就用 HTML 的值', fast, 'fast_one');
  truthy('[并行] HTML 先命中时不等 iframe（< 200ms，while iframe 要 300ms）', fastCost < 200, fastCost + 'ms');

  restoreFetch();
}

/* ======================== 三、race 语义 ======================== */

async function section3() {
  section('三、race 语义：非法值不抢先，两路皆空才返回空');

  // 1) HTML 给出占位符 → validate 拒 → 必须继续等 iframe
  useFetch(async () => ({ ok: true, status: 200, text: async () => '<html>"kwaiId":"SSSSSSSSS"</html>' }));
  const withPlaceholder = await Fetcher.raceIdSources({
    homepage: 'https://www.kuaishou.com/profile/x',
    parse: (html) => (/kwaiId":"([^"]+)"/.exec(html) || [])[1] || '',
    renderer: async () => { await sleep(60); return 'real_kwai_id'; },
    validate: (v) => !!v && !/^(.)\1{2,}$/.test(v)
  });
  eq('[race] HTML 先到的占位符被拒后，改用 iframe 的真值', withPlaceholder, 'real_kwai_id');

  // 2) 两路都只能给占位符 → 返回空（绝不是把 SSSSSSSSS 当快手号）
  useFetch(async () => ({ ok: true, status: 200, text: async () => '<html>"kwaiId":"SSSSSSSSS"</html>' }));
  const allPlaceholder = await Fetcher.raceIdSources({
    homepage: 'https://www.kuaishou.com/profile/x',
    parse: (html) => (/kwaiId":"([^"]+)"/.exec(html) || [])[1] || '',
    renderer: async () => 'SSSSSSSSS',
    validate: (v) => !!v && !/^(.)\1{2,}$/.test(v)
  });
  eq('[race] 两路都是占位符时返回空串', allPlaceholder, '');

  // 3) 两路皆空 → 空串（不抛错、不挂死）
  useFetch(async () => ({ ok: false, status: 403, text: async () => '' }));
  const t0 = Date.now();
  const none = await Fetcher.raceIdSources({
    homepage: 'https://www.kuaishou.com/profile/x',
    parse: () => '',
    renderer: async () => '',
    validate: (v) => !!v
  });
  eq('[race] 两路皆空返回空串', none, '');
  truthy('[race] 两路皆空也会及时返回（不挂死）', Date.now() - t0 < 800);

  // 4) 一路抛错不许拖垮另一路
  useFetch(async () => { throw new Error('network down'); });
  const survivor = await Fetcher.raceIdSources({
    homepage: 'https://www.kuaishou.com/profile/x',
    parse: () => '',
    renderer: async () => 'only_one_left',
    validate: (v) => !!v
  });
  eq('[race] HTML 抛错时 iframe 仍能给出结果', survivor, 'only_one_left');

  restoreFetch();
}

/* ======================== 四、串行默认不变 ======================== */

async function section4() {
  section('四、串行默认：不传 parallelRenderer 时与老版完全一致（抖音/小红书）');

  const order = [];
  useFetch(async () => {
    order.push('fetch');
    return { ok: true, status: 200, text: async () => '<html>无快手号</html>' };
  });

  const id = await Fetcher.extract({
    site: 'douyin_social',
    homepage: 'https://www.douyin.com/user/abc',
    patterns: [/"unique_id":"([^"]+)"/],
    renderer: async () => { order.push('renderer'); return 'fallback_id'; },
    validate: (v) => !!v
  });

  eq('[串行] 结果与老版一致', id, 'fallback_id');
  eq('[串行] fetch → parse 落空 → 才调 renderer（顺序不变）', order.join('>'), 'fetch>renderer');

  // 不传 renderer 时不会凭空多跑一路
  order.length = 0;
  const noRenderer = await Fetcher.extract({
    site: 'xiaohongshu_social',
    homepage: 'https://www.xiaohongshu.com/user/profile/abc',
    patterns: [/"redId":"([^"]+)"/],
    validate: (v) => !!v
  });
  eq('[串行] 没 renderer 时返回空串', noRenderer, '');
  eq('[串行] 没 renderer 时只发一次请求', order.length, 1);

  restoreFetch();
}

/* ======================== 五、iframe 渲染器 ======================== */

/**
 * 造一个能真跑的 KuaishouSocialExtractor 实例
 *
 * 关键：把 `HTMLIFrameElement.prototype.contentDocument` 换成我们自己的真文档
 * （jsdom 里 iframe 不会真联网加载），这样就能手动「投喂」正文，
 * 并且 MutationObserver 也能真的挂上去、真的被触发。
 */
function makeExtractorDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.kuaishou.com/short-video/3xabc123',
    runScripts: 'outside-only'
  });
  const win = dom.window;

  win.BaseExtractor = class BaseExtractor {};
  win.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };

  const fakeDoc = win.document.implementation.createHTMLDocument('kuaishou-profile');
  const state = { text: '' };
  Object.defineProperty(fakeDoc.body, 'innerText', {
    configurable: true,
    get() { return state.text; }
  });

  Object.defineProperty(win.HTMLIFrameElement.prototype, 'contentDocument', {
    configurable: true,
    get() { return fakeDoc; }
  });

  // 包一层 MutationObserver，把「到底有没有挂上 / 有没有断开」变成可断言的事实。
  // 靠时间窗猜「observer 是不是生效了」是不可靠的（tick 对齐有几毫秒抖动，
  // 实测同一份代码改坏一次红一次绿），必须直接数调用次数。
  const moStats = { constructed: 0, observed: 0, disconnected: 0 };
  const RealMO = win.MutationObserver;
  win.MutationObserver = class ClipMateTestMO extends RealMO {
    constructor(cb) {
      super(cb);
      moStats.constructed += 1;
    }
    observe(target, options) {
      moStats.observed += 1;
      return super.observe(target, options);
    }
    disconnect() {
      moStats.disconnected += 1;
      return super.disconnect();
    }
  };

  win.eval(EXTRACTOR_SRC);

  const Extractor = win.KuaishouSocialExtractor;
  const instance = new Extractor();

  return {
    win,
    doc: win.document,
    fakeDoc,
    instance,
    moStats,
    /** 只改文本，不碰 DOM —— 只有轮询能发现 */
    setTextSilently(value) {
      state.text = value;
    },
    /** 模拟 hydration：改文本 + 真往 DOM 插一个节点 —— observer 能立刻知道 */
    hydrate(value) {
      state.text = value;
      fakeDoc.body.appendChild(fakeDoc.createTextNode('.'));
    }
  };
}

async function section5() {
  section('五、iframe 渲染器：100ms 轮询 + observer 抢跑 + 占位符跳过 + 超时清理');

  if (!JSDOM) {
    bad('[iframe] jsdom 未安装，本节无法运行');
    bad('[iframe] 请用 NODE_PATH 指向全局 node_modules 后重跑');
    return;
  }

  // 1) 数据在 150ms 出现（只在文本里，DOM 没动）→ 必须靠轮询发现
  {
    const env = makeExtractorDom();
    const t0 = Date.now();
    const p = env.instance._renderKwaiIdViaIframe('https://www.kuaishou.com/profile/3x87w8rbwxepda6');
    await sleep(150);
    env.setTextSilently('快手号：fanfan123');
    const id = await p;
    const cost = Date.now() - t0;

    eq('[iframe] 文本里出现快手号能读到', id, 'fanfan123');
    truthy('[iframe] 150ms 出现的数据在 285ms 内拿到（400ms 轮询会拖到 400ms 之后）',
      cost < 285, cost + 'ms');
    eq('[iframe] 命中后 iframe 必须被删掉', env.doc.querySelector('iframe'), null);
    // observer 只能在拿到 body 之后挂上；挂上了也必须断开，否则 iframe 删了还被引用
    truthy('[iframe] 真的挂了 MutationObserver', env.moStats.observed >= 1,
      `constructed=${env.moStats.constructed} observed=${env.moStats.observed}`);
    truthy('[iframe] 收工时必须 disconnect（不许悬空引用）', env.moStats.disconnected >= 1,
      `disconnected=${env.moStats.disconnected}`);
  }

  // 2) observer 抢跑：挂上之后插节点，必须快于下一个轮询周期
  {
    const env = makeExtractorDom();
    const t0 = Date.now();
    const p = env.instance._renderKwaiIdViaIframe('https://www.kuaishou.com/profile/3x87w8rbwxepda6');

    await sleep(130);          // 第一个 tick(100ms) 已经挂好 observer
    const atHydrate = Date.now() - t0;
    env.hydrate('快手号：fast_hydrate');
    const id = await p;
    const cost = Date.now() - t0;

    eq('[iframe] observer 路径也能读到快手号', id, 'fast_hydrate');
    truthy('[iframe] 插节点后不等下一个 100ms 周期（< 90ms）',
      cost - atHydrate < 90, (cost - atHydrate) + 'ms');
  }

  // 3) 占位符不许当结果：先给 SSSSSSSSS，再换真值
  {
    const env = makeExtractorDom();
    const p = env.instance._renderKwaiIdViaIframe('https://www.kuaishou.com/profile/3x87w8rbwxepda6');
    await sleep(120);
    env.hydrate('快手号：SSSSSSSSS');
    await sleep(150);
    env.hydrate('快手号：real_after_placeholder');
    const id = await p;
    eq('[iframe] 占位符被跳过，等到了 hydration 后的真值', id, 'real_after_placeholder');
  }

  // 4) 一直什么都没有 → 5 秒超时返回空，并且 iframe 必须清掉（不许残留）
  {
    const env = makeExtractorDom();
    const t0 = Date.now();
    const id = await env.instance._renderKwaiIdViaIframe('https://www.kuaishou.com/profile/3x87w8rbwxepda6');
    const cost = Date.now() - t0;

    eq('[iframe] 始终读不到时返回空串', id, '');
    truthy('[iframe] 超时从 10 秒砍到 5 秒（实测 4.6~6.5 秒之间返回）',
      cost >= 4600 && cost <= 6500, cost + 'ms');
    eq('[iframe] 超时后 iframe 被删掉，不留残余', env.doc.querySelector('iframe'), null);
  }
}

/* ======================== 六、接线与结构 ======================== */

function section6() {
  section('六、接线与结构：快手真的传了参数，注释不许骗人');

  // 方法体内必须同时出现这两个开关，缺一个就退回老流程
  const m = /async _fetchAuthorKwaiId\(homepage\)\s*\{([\s\S]*?)\n  \}/.exec(EXTRACTOR_SRC);
  truthy('[接线] 找到 _fetchAuthorKwaiId 方法体', !!m);
  const body = m ? m[1] : '';

  truthy('[接线] 传了 parallelRenderer: true', /parallelRenderer:\s*true/.test(body));
  truthy('[接线] 传了 fetchTimeout: 3000', /fetchTimeout:\s*3000/.test(body));
  truthy('[接线] 并行与 HTML 超时在 validate 之前（参数顺序不靠猜）',
    body.indexOf('parallelRenderer') < body.indexOf('validate:'));

  // 渲染器常数：这三个是提速的本体，改回老值立刻红
  truthy('[结构] 轮询间隔是 100ms（老值 400ms）', /const INTERVAL = 100;/.test(EXTRACTOR_SRC));
  truthy('[结构] 超时是 5000ms（老值 10000ms）', /const TIMEOUT = 5000;/.test(EXTRACTOR_SRC));
  truthy('[结构] 用上了 MutationObserver', /new MutationObserver\(/.test(EXTRACTOR_SRC));
  truthy('[结构] observer 在 cleanup 里被 disconnect（否则重连会叠加）',
    /const stopObserver = \(\) => \{[\s\S]{0,200}?observer\.disconnect\(\)/.test(EXTRACTOR_SRC));

  // 渲染器里绝不能再出现「等 10 秒」的旧常量
  falsy('[结构] 旧的 10000ms 超时不许残留', /TIMEOUT = 10000/.test(EXTRACTOR_SRC));

  // AuthorIdFetcher 的导出（测试与后续扩展都靠它）
  ['resolveFromHtml', 'resolveByRenderer', 'raceIdSources'].forEach((name) => {
    eq('[导出] AuthorIdFetcher.' + name, typeof Fetcher[name], 'function');
    truthy('[导出] ' + name + ' 在 api 对象里', new RegExp('^\\s*' + name + ',?$', 'm').test(
      fs.readFileSync(FETCHER_PATH, 'utf8')));
  });

  // manifest 版本
  eq('[版本] manifest 版本已升到 2.11.5', MANIFEST.version, '2.11.5');
}

/* ======================== 主流程 ======================== */

(async function main() {
  console.log('快手作者ID提速验收（v2.7.10）\n');

  // 看门狗：任何一条路径挂死（比如超时没生效、Promise 永不 resolve），
  // 都必须表现为「红」而不是「卡住」—— 卡住的测试等于没有测试。
  // 正常一轮约 6 秒（其中 5 秒是超时用例本身），15 秒足够宽。
  const watchdog = setTimeout(() => {
    console.log(`\n${C.red}❌ 测试超时：15 秒未跑完 —— 有路径挂死了（多半是超时没生效）${C.reset}`);
    process.exit(1);
  }, 15000);
  // 注意：绝不能 unref() —— 挂死时事件队列空了，进程会「静默正常退出」，
  // 那又变成假绿。这个 timer 必须保活，到点自己 exit(1)。

  await section1();
  await section2();
  await section3();
  await section4();
  await section5();
  section6();

  clearTimeout(watchdog);

  console.log('\n' + '─'.repeat(60));
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}❌${C.reset} ${f.name}` + (f.detail ? `  ${C.gray}${f.detail}${C.reset}` : '')));
  process.exit(1);
})();
