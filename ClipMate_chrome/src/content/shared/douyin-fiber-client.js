/**
 * 抖音原始数据（fiber）客户端 —— 内容脚本侧，10 行逻辑 + 一层去重
 *
 * 它只做一件事：把「读一下这一条作品的原始数据」这个请求转给后台，
 * 后台再用 chrome.scripting.executeScript({world:'MAIN'}) 注入读函数。
 * 拿不到（超时 / 后台报错 / 页面没有 fiber）一律返回 null，
 * 调用方据此回落 DOM 取法 —— **最差结果等于没有这个功能**。
 *
 * 为什么要有去重：
 *   一次提取要问 6 个字段，如果每个字段都发一次消息，就会注入 6 次脚本。
 *   这里按作品 ID 做「在途合并」，同一时刻只发一次；成功的记缓存，失败的**不缓存**（下次还能重试）。
 *
 * 超时为什么是 1000ms（方案里写的是 300ms）：
 *   后台 Service Worker 在 MV3 下会被浏览器休眠，冷启动唤醒经常要几百毫秒。
 *   300ms 会把「其实能拿到」的情况误判成失败，白做一批。1000ms 只在真取不到时才等满，
 *   取到了通常几十毫秒就回来。见 v2.5.77 批 2 报告。
 */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 1000;
  var CACHE_LIMIT = 24;

  var cache = Object.create(null);    // 作品ID → meta（只存成功结果）
  var inflight = Object.create(null); // 作品ID → Promise（在途合并）

  function api() {
    try {
      if (typeof WBR !== 'undefined' && WBR && WBR.runtime && typeof WBR.runtime.sendMessage === 'function') return WBR;
      if (typeof chrome !== 'undefined' && chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') return chrome;
    } catch (e) { /* 继续往下 */ }
    return null;
  }

  function trimCache() {
    var keys = Object.keys(cache);
    if (keys.length <= CACHE_LIMIT) return;
    keys.slice(0, keys.length - CACHE_LIMIT).forEach(function (k) { delete cache[k]; });
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve(null);
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      }, function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  function request(modalId, timeoutMs) {
    var bridge = api();
    if (!bridge) return Promise.resolve(null);
    var p;
    try {
      p = bridge.runtime.sendMessage({ action: 'douyinFiberMeta', modalId: modalId });
    } catch (e) {
      return Promise.resolve(null);
    }
    return withTimeout(p, timeoutMs).then(function (res) {
      if (!res || !res.ok || !res.meta) return null;
      var m = res.meta;
      // 只认「对得上号」的结果：返回的 awemeId 必须与本条一致（防空值/串台）
      if (modalId && m.awemeId && String(m.awemeId) !== String(modalId)) return null;
      return m;
    });
  }

  /**
   * 取这一条作品的原始数据
   * @param {string} modalId 作品 ID
   * @param {number} [timeoutMs]
   * @returns {Promise<Object|null>} 形如 {awemeId, awemeType, mediaType, createTime, desc, itemTitle, nickname, secUid}
   */
  function getMeta(modalId, timeoutMs) {
    var key = modalId === null || modalId === undefined ? '' : String(modalId);
    if (!key) return Promise.resolve(null);
    if (cache[key]) return Promise.resolve(cache[key]);
    if (inflight[key]) return inflight[key];

    var ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var p = request(key, ms).then(function (meta) {
      delete inflight[key];
      if (meta) {
        cache[key] = meta;
        trimCache();
      }
      return meta;
    }, function () {
      delete inflight[key];
      return null;
    });

    inflight[key] = p;
    return p;
  }

  /** 清空缓存（切换视频后不必清；这里只给测试和「强制重取」用） */
  function clear() {
    cache = Object.create(null);
    inflight = Object.create(null);
  }

  var mod = {
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    getMeta: getMeta,
    clear: clear
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (global) global.DouyinFiberClient = mod;
})(typeof window !== 'undefined' ? window : null);
