/**
 * YouTube Shorts「一手数据」读取器 —— 内容脚本（隔离世界）侧
 *
 * 数据由 `src/content/youtube-shorts-hook.js`（world: MAIN）写进：
 *   <div id="clipmate-youtube-shorts" hidden data-clipmate-json='{v,href,item}'>
 * 主世界碰不到 chrome.*，隔离世界看不到页面变量，**DOM 是两边唯一都能读的地方**。
 * ⚠️ 不用 script 节点：YouTube 的 Trusted Types 会拦 script.textContent（真机实测）。
 *
 * 三条规矩（与 `tiktok-page-data.js` / `douyin-net-cache.js` 完全一致）
 * ------------------------------------------------------------------
 * 1. **ID 对不上就是别人的数据**：桥节点里的 `item.videoId` 必须等于地址里的 ID，
 *    否则一律返回 null，调用方回落 DOM 取法，宁可留空也不许串台。
 *    2026-11-06 真机实证：Shorts 站内换条后 head 里的 identifier / datePublished /
 *    og:title 全是上一条，扩展原来读的正是这些过期数据。
 * 2. **只认精确命中**：按 `<host>/shorts/<videoId>` 缓存，绝不拿「最近一条」顶替
 *    （豆瓣列表页编号撞车的教训，缓存键必须带站点）。
 * 3. **不主动发请求**：桥节点里的数据是页面自己加载好的；本文件最多改一个 ask 属性
 *    请主世界重扫，不 fetch、不碰任何接口。
 *
 * 用法：`extractAllFields()` 开头 `await YoutubeShortsPageData.ensureFresh()` 预热一次，
 * 之后各字段同步调 `getCurrent()`；拿不到就回落原有 DOM 取法。
 */
(function (global) {
  'use strict';

  var NODE_ID = 'clipmate-youtube-shorts';
  var ASK_ATTR = 'data-clipmate-yt-ask';
  var DEFAULT_TIMEOUT_MS = 900;
  var POLL_STEP_MS = 120;

  var cache = Object.create(null);      // "<host>/shorts/<id>" → 快照
  var inflight = Object.create(null);
  var askSeq = 0;

  /** 站点门禁：只认 YouTube 的 Shorts 页，其他站点/页面一律不干活 */
  function isShortsHref(href) {
    try {
      var raw = String(href === undefined || href === null ? '' : href);
      return /^https?:\/\/(?:www\.|m\.)?youtube\.com\/shorts\/[A-Za-z0-9_-]{6,20}/i.test(raw);
    } catch (e) { return false; }
  }

  function urlVideoId(href) {
    try {
      var raw = String(href === undefined || href === null ? '' : href);
      var m = raw.match(/\/shorts\/([A-Za-z0-9_-]{6,20})(?:[/?#]|$)/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /** 当前地址（单测用桩对象也能读） */
  function currentHref() {
    try {
      if (global && global.location && global.location.href) return global.location.href;
    } catch (e) { /* 走空串 */ }
    return '';
  }

  /** 缓存键必须带站点，别让别的站/别的页的同名 ID 撞进来 */
  function cacheKey(href, videoId) {
    var host = '';
    try {
      var m = String(href || '').match(/^https?:\/\/([^/]+)\//i);
      host = m ? m[1] : '';
    } catch (e) { host = ''; }
    return host + '/shorts/' + videoId;
  }

  /** 读桥节点；节点坏掉 / ID 对不上 → null（绝不返回上一条的数据） */
  function readBridge(videoId) {
    try {
      if (!videoId || !global || !global.document) return null;
      var node = global.document.getElementById(NODE_ID);
      if (!node || typeof node.getAttribute !== 'function') return null;
      var text = node.getAttribute('data-clipmate-json');
      if (!text || text.length < 10) return null;
      var data = JSON.parse(text);
      var item = data && data.item;
      if (!item || typeof item !== 'object') return null;
      if (String(item.videoId || '') !== String(videoId)) return null;
      return item;
    } catch (e) { return null; }
  }

  /** 同步取当前条的一手数据（预热过直接走缓存）；拿不到返回 null */
  function getCurrent() {
    var href = currentHref();
    if (!isShortsHref(href)) return null;
    var id = urlVideoId(href);
    if (!id) return null;
    var key = cacheKey(href, id);
    if (cache[key]) return cache[key];
    var item = readBridge(id);
    if (item) cache[key] = item;
    return item || null;
  }

  /** 请主世界重扫一次（只改一个属性，不发请求、不碰页面数据） */
  function requestScan() {
    try {
      if (!global || !global.document || !global.document.documentElement) return false;
      var root = global.document.documentElement;
      if (typeof root.setAttribute !== 'function') return false;
      askSeq += 1;
      root.setAttribute(ASK_ATTR, String(Date.now()) + '-' + askSeq);
      return true;
    } catch (e) { return false; }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      try { global.setTimeout(resolve, ms); } catch (e) { setTimeout(resolve, ms); }
    });
  }

  /**
   * 预热：确保「当前这一条」的一手数据已经就绪。
   * 先同步读一次；没有就请主世界重扫，再按 120ms 步长轮询，默认上限 900ms。
   * 超时返回 null —— 调用方回落 DOM 取法，绝不用过期数据顶替。
   */
  function ensureFresh(timeoutMs) {
    var href = currentHref();
    if (!isShortsHref(href)) return Promise.resolve(null);
    var id = urlVideoId(href);
    if (!id) return Promise.resolve(null);
    var key = cacheKey(href, id);
    if (cache[key]) return Promise.resolve(cache[key]);
    if (inflight[key]) return inflight[key];

    var ready = readBridge(id);
    if (ready) {
      cache[key] = ready;
      return Promise.resolve(ready);
    }

    // 走 api 上的引用，单测可以拦截「有没有真的请主世界重扫」这一步
    api.requestScan();
    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var deadline = Date.now() + ms;

    var p = (function loop() {
      return sleep(POLL_STEP_MS).then(function () {
        var item = readBridge(id);
        if (item) { cache[key] = item; return item; }
        if (Date.now() >= deadline) return null;
        return loop();
      });
    })();

    inflight[key] = p.then(function (v) {
      delete inflight[key];
      return v;
    }, function () {
      delete inflight[key];
      return null;
    });
    return inflight[key];
  }

  function invalidate(videoId) {
    if (!videoId) return;
    Object.keys(cache).forEach(function (k) {
      if (k.slice(-String(videoId).length) === String(videoId)) delete cache[k];
    });
  }

  function clear() {
    cache = Object.create(null);
    inflight = Object.create(null);
  }

  var api = {
    NODE_ID: NODE_ID,
    ASK_ATTR: ASK_ATTR,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    isShortsHref: isShortsHref,
    urlVideoId: urlVideoId,
    cacheKey: cacheKey,
    readBridge: readBridge,
    getCurrent: getCurrent,
    requestScan: requestScan,
    ensureFresh: ensureFresh,
    invalidate: invalidate,
    clear: clear
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.YoutubeShortsPageData = api;
})(typeof window !== 'undefined' ? window : null);
