/**
 * 测试环境底座（只读，不修改扩展源码）
 *
 * 目的：把 ClipMate_chrome 的「真代码」在 jsdom 里跑起来，拿到和浏览器里一致的提取结果。
 * 之所以不自己重写一份提取逻辑：那样测的就是测试代码，不是扩展本身。
 *
 * 三条原则：
 *   1. 只读源码 —— 本目录任何文件都不会被写回 ClipMate_chrome/
 *   2. 不打补丁 —— 脚本按 manifest.json 的真实顺序注入，一行不改
 *   3. 只桩外部依赖 —— chrome.* / fetch 是浏览器/网络边界，必须桩掉才能离线跑
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// tests/lib/env.js → 上两级是项目根
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');

const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

/** 内容脚本清单（真实加载顺序） */
function contentScripts() {
  return manifest.content_scripts[0].js.slice();
}

function readSrc(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/** 静音 console：被测代码日志很多，测试输出要干净 */
function silentConsole() {
  const noop = () => {};
  return { log: noop, info: noop, warn: noop, error: noop, debug: noop, trace: noop };
}

/** 离线 fetch：所有网络请求立刻失败。这样"联网才能拿到的字段"在快照里恒为空，可复现 */
function offlineFetch() {
  return Promise.reject(new Error('[offline-fixture] 测试环境不联网'));
}

/**
 * 从 background.js 里取出它那份「站点 → 类型 → 路径模式」表。
 * 做法是在 vm 里跑真文件（不是抄一份），避免测试表和线上表各走各的。
 */
async function loadBackgroundMediaConfigs() {
  const chromeStub = {
    runtime: {
      id: 'clipmate-snapshot',
      onInstalled: { addListener() {} },
      onMessage: { addListener() {} },
      sendMessage: () => Promise.resolve({})
    },
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} }
    },
    tabs: { query: async () => [], sendMessage: async () => {}, create() {}, onUpdated: { addListener() {} } }
  };

  const ctx = vm.createContext({
    chrome: chromeStub,
    console: silentConsole(),
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams, Promise, fetch: offlineFetch,
    TextDecoder, TextEncoder
  });

  try {
    vm.runInContext(readSrc('src/shared/browser-api.js'), ctx, { filename: 'browser-api.js' });
    // 尾部追加一句只为把顶层的 `const backgroundService` 拎出来（不写回源文件）
    vm.runInContext(
      readSrc('src/background/background.js') + '\n;globalThis.__bgHolder = backgroundService;',
      ctx,
      { filename: 'background.js' }
    );
    return await ctx.__bgHolder.getMediaConfigs();
  } catch (err) {
    // 拿不到就返回空表，并在快照里标注（不冒充成功）
    return { __error: err && err.message };
  }
}

/**
 * 给 jsdom 用的 chrome.* 桩。
 * 只需覆盖内容脚本真正会调的那几个：runtime.sendMessage / storage.local / getManifest。
 */
function makeChromeStub(mediaConfigs, config) {
  const store = { config: config || {} };

  const readKeys = (keys) => {
    if (keys === undefined || keys === null) return { ...store };
    if (typeof keys === 'string') {
      return Object.prototype.hasOwnProperty.call(store, keys) ? { [keys]: store[keys] } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
      });
      return out;
    }
    if (typeof keys === 'object') {
      const out = {};
      Object.keys(keys).forEach((k) => {
        out[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : keys[k];
      });
      return out;
    }
    return {};
  };

  return {
    runtime: {
      id: 'clipmate-snapshot',
      getManifest: () => manifest,
      getURL: (p) => 'chrome-extension://clipmate-snapshot/' + String(p || '').replace(/^\/+/, ''),
      openOptionsPage() {},
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      sendMessage: (msg) => {
        const action = msg && msg.action;
        if (action === 'getMediaConfigs') {
          return Promise.resolve({ configs: mediaConfigs });
        }
        if (action === 'getConfig') {
          const cfg = store.config || {};
          return Promise.resolve({ ...cfg, config: cfg });
        }
        return Promise.resolve({ success: true });
      }
    },
    storage: {
      local: {
        get: async (keys) => readKeys(keys),
        set: async (obj) => { Object.assign(store, obj); },
        remove: async (keys) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
        }
      }
    },
    tabs: {
      query: async () => [],
      sendMessage: async () => ({}),
      create() {},
      onUpdated: { addListener() {} }
    }
  };
}

module.exports = {
  ROOT,
  SRC,
  manifest,
  contentScripts,
  readSrc,
  silentConsole,
  offlineFetch,
  loadBackgroundMediaConfigs,
  makeChromeStub
};
