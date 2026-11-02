/**
 * 在 jsdom 里跑扩展的真代码，拿真提取结果。
 *
 * 走的是和浏览器里一模一样的链路：
 *   content-main.js 自动初始化 → 点按钮对应的 handleExtract/extractFromCurrentPage
 *   → 提取器 → 通用字段映射 → 数据处理
 *
 * 唯一的不同：不联网（fetch 一律失败）、chrome.* 是桩。
 * 因此「二次请求才能拿到的字段」（IMDb 上映日期、17K 发布日期）在快照里恒为空，
 * 这部分由 tests/smoke-checklist.md 的人工冒烟负责，不靠离线快照。
 */
'use strict';

const path = require('path');
const os = require('os');
const env = require('./env');

/**
 * jsdom 装在托管 node 的 workspace 里，不一定在 NODE_PATH 上。
 * 这里自己找一遍，免得每次都要手动 export NODE_PATH。
 */
function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error(
    '找不到 jsdom。请把 NODE_PATH 指向含 jsdom 的 node_modules，或设置环境变量 CLIPMATE_NODE_PATH（见 tests/README.md）'
  );
}

const { JSDOM, VirtualConsole } = loadJsdom();
const INIT_TIMEOUT_MS = 15000;
const POLL_MS = 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 把一段代码当经典脚本插进页面（这样全局 let/class 能跨文件互相看见，和浏览器一致） */
function injectScript(window, code, label) {
  const doc = window.document;
  const el = doc.createElement('script');
  el.setAttribute('data-clipmate-test', label);
  el.textContent = code;
  doc.documentElement.appendChild(el);
  // 执行完立刻把 <script> 摘掉。
  // 必须摘：代码已经跑完（class/let 都在全局作用域里，摘掉不影响后续调用），
  // 但源码文本留在 DOM 里会变成 documentElement.textContent 的一部分，
  // 于是「整页文字里全局搜某个模式」的提取器会搜到扩展自己的注释/字面量。
  // 真实事故：bgm-movie 的方法3 整页搜 /tt\d{7,}/，搜到了 douban-movie 注释里
  // 举例用的 tt1234567，把它当成真 IMDb 编号写进了基线。
  if (el.parentNode) el.parentNode.removeChild(el);
}

/**
 * 打开一个 fixture 页面，并把扩展的全部内容脚本按 manifest 顺序注入。
 *
 * 四个可选参数只给「兜底演练 / 弹窗取数」用，默认不传 = 行为与以前完全一致：
 *   scriptFilter(rel) -> boolean  返回 false 的脚本不注入（模拟「新模块根本没加载」）
 *   beforeMainScript             在 content-main.js 之前跑一段代码（模拟「模块从一开始就是坏的」）
 *   afterScripts                 全部脚本注入完后再跑一段代码（模拟「新模块被禁用/熔断」）
 *   chromePatch(chrome, window)  在注入脚本前改 chrome.* 桩（模拟后台返回抖音原始数据）
 * @returns {Promise<{dom, window, bridge, loadErrors: string[]}>}
 */
async function openPage({ url, html, config, mediaConfigs, scriptFilter, afterScripts, beforeMainScript, chromePatch }) {
  const loadErrors = [];
  const vc = new VirtualConsole();
  // 页面自带的 inline 脚本（Next.js / IMDb 之类）在 jsdom 里必然会报错，一律吞掉
  vc.on('jsdomError', (e) => loadErrors.push(String((e && e.message) || e)));

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });

  const window = dom.window;
  window.chrome = env.makeChromeStub(mediaConfigs, config);
  // 有些代码会探测 browser（Firefox），显式声明不存在，保持 Chrome 分支
  window.browser = undefined;

  // 抖音弹窗取数专用：允许用例改写 chrome.* 桩（例如让后台返回一份 fiber 原始数据）
  if (typeof chromePatch === 'function') {
    try {
      chromePatch(window.chrome, window);
    } catch (err) {
      loadErrors.push(`chromePatch 失败: ${err && err.message}`);
    }
  }

  // jsdom 没有 innerText（只有 textContent），而扩展的媒体类型识别
  // （media-detector.detectByContent）读的是 document.body.innerText。
  // 不补的话，凡是要「按正文关键词猜类型」的页面在这里都会得到空文本 →
  // 类型被误判成 unknown → 字段清单跟着错，快照会报假警。
  // 真浏览器的 innerText ≈ textContent 再压掉隐藏元素；这里用 textContent 近似，
  // 只会让关键词命中更多、不会更少，属于「宁可多认」的安全一侧。
  if (!('innerText' in window.HTMLElement.prototype)) {
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() {
        return this.textContent;
      },
      set(v) {
        this.textContent = v;
      }
    });
  }

  for (const rel of env.contentScripts()) {
    if (scriptFilter && !scriptFilter(rel)) continue;
    let code;
    try {
      code = env.readSrc(rel);
    } catch (err) {
      loadErrors.push(`读取失败 ${rel}: ${err.message}`);
      continue;
    }
    // 兜底演练专用：在 content-main.js **之前**打桩。
    // 为什么需要这一档：content-main 的 init() 在脚本注入时就会同步跑起来
    // （此时 DOM 已解析完），等全部脚本注入完再打补丁，抖音弹窗页早就接管完了，
    // 补丁等于没打。要模拟「模块从一开始就是坏的」，必须在 init 之前动手。
    if (beforeMainScript && /content-main\.js$/.test(rel)) {
      try {
        injectScript(window, beforeMainScript, 'drill-before-main');
      } catch (err) {
        loadErrors.push(`预置补丁注入失败: ${err && err.message}`);
      }
    }
    try {
      injectScript(window, code, rel);
    } catch (err) {
      loadErrors.push(`注入失败 ${rel}: ${err && err.message}`);
    }
  }

  // 兜底演练专用：脚本全加载完后再施加一段「把新模块打死」的代码
  if (afterScripts) {
    try {
      injectScript(window, afterScripts, 'drill-after-scripts');
    } catch (err) {
      loadErrors.push(`演练补丁注入失败: ${err && err.message}`);
    }
  }

  // 桥：把全局词法作用域里的东西捞出来（这些名字不挂在 window 上）
  let bridgeOk = false;
  try {
    injectScript(window, `
      window.__bridge = {
        getInstance: () => (typeof mediaExtractorInstance !== 'undefined' ? mediaExtractorInstance : null),
        MediaExtractor: typeof MediaExtractor !== 'undefined' ? MediaExtractor : null,
        ExtractorFactory: typeof ExtractorFactory !== 'undefined' ? ExtractorFactory : null,
        UniversalFieldMapper: typeof UniversalFieldMapper !== 'undefined' ? UniversalFieldMapper : null,
        TitleProcessor: typeof TitleProcessor !== 'undefined' ? TitleProcessor : null,
        MediaTypeDetector: typeof MediaTypeDetector !== 'undefined' ? MediaTypeDetector : null
      };
    `, 'bridge');
    bridgeOk = !!(window.__bridge && window.__bridge.MediaExtractor);
  } catch (err) {
    loadErrors.push(`桥接失败: ${err && err.message}`);
  }

  return { dom, window, bridge: window.__bridge || {}, loadErrors, bridgeOk };
}

/** 等 content-main 自己完成初始化（它会在 DOMContentLoaded 之后异步 init） */
async function waitForInit(page, timeoutMs = INIT_TIMEOUT_MS) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const inst = page.bridge.getInstance ? page.bridge.getInstance() : null;
    if (inst && inst.isInitialized) return inst;
    await sleep(POLL_MS);
  }
  return (page.bridge.getInstance && page.bridge.getInstance()) || null;
}

function extractorNameOf(extractor) {
  if (!extractor) return '';
  try {
    return extractor.constructor && extractor.constructor.name ? extractor.constructor.name : '';
  } catch (e) {
    return '';
  }
}

/**
 * 主路径：用真实初始化好的实例跑「点按钮」那条链路。
 */
async function runRealPath(page, instance) {
  const started = Date.now();
  const data = await instance.extractFromCurrentPage();
  return {
    mode: 'real',
    data,
    mediaTypeUsed: instance.fieldMapper ? instance.fieldMapper.mediaType : null,
    extractor: extractorNameOf(instance.currentExtractor),
    elapsedMs: Date.now() - started
  };
}

/**
 * 兜底路径：初始化没成功（例如页面类型识别失败、UI 组件抛错）时，
 * 用同一个 MediaExtractor 类 + 同样的三个步骤手跑一遍，保证仍能产出可比对的字段。
 * 快照里会标 mode=fallback，代表"这条不是走按钮的真实链路"。
 */
async function runFallbackPath(page, fixture) {
  const B = page.bridge;
  if (!B.MediaExtractor) throw new Error('MediaExtractor 未加载，无法兜底');

  const ctx = new B.MediaExtractor();
  ctx.titleProcessor = new B.TitleProcessor();

  const factory = new B.ExtractorFactory();
  const extractor = factory.getExtractorByUrl(page.window.location.href);
  if (!extractor) throw new Error('getExtractorByUrl 未命中：' + page.window.location.href);

  const raw = await extractor.extractAllFields();
  const mediaType = fixture.mediaType || 'book';
  const mapper = new B.UniversalFieldMapper(mediaType);
  const universal = mapper.mapToUniversalFields(raw, extractor.siteName);
  const data = await ctx.processData(universal, mediaType);

  return {
    mode: 'fallback',
    data,
    mediaTypeUsed: mediaType,
    extractor: extractorNameOf(extractor),
    elapsedMs: 0
  };
}

/** 键排序 + 2 空格缩进：让 diff 只反映"值变了"，不反映"顺序变了" */
function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    Object.keys(v).sort().forEach((k) => { out[k] = walk(v[k]); });
    return out;
  };
  return JSON.stringify(walk(value), null, 2);
}

module.exports = {
  openPage,
  waitForInit,
  runRealPath,
  runFallbackPath,
  extractorNameOf,
  stableStringify,
  sleep
};
