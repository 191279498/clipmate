/**
 * 快手「作品档案」快客户端 —— 内容脚本侧（隔离环境），与抖音 douyin-fiber-client.js 同构
 *
 * 它只做一件事：把「读一下快手页面上自带的作品档案」这个请求转给后台，
 * 后台再用 chrome.scripting.executeScript({world:'MAIN'}) 注入读函数。
 * 拿不到（超时 / 后台报错 / 页面没有这份数据）一律返回 null，
 * 调用方据此回落到老的封面地址取法 —— **最差结果等于没有这个功能**。
 *
 * 两个效率和抖音那边的经验完全一致：
 *   - **按批缓存**：一次注入会把页面当前那批（约 19 条）整批搬回来，
 *     所以切到下一条基本不必再注入，直接命中缓存。
 *   - **在途合并**：同一时刻多个字段都来问，只发一次消息。
 *   - 失败**不缓存**，下次还能重试。
 *
 * 超时为什么是 1000ms：MV3 的后台会被浏览器休眠，冷启动唤醒常常要几百毫秒。
 * 给太短会把「其实拿得到」误判成失败。取到了通常几十毫秒就回来。
 */
(function (global) {
  'use strict';

  var DEFAULT_TIMEOUT_MS = 1000;
  var CACHE_LIMIT = 120; // 作品档案条目上限（约 6 批）

  var cache = Object.create(null);    // 作品ID → meta（只存成功结果）
  var inflight = null;               // Promise 或 null（整批只发一次）

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

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /**
   * 毫秒时间戳 → `YYYY/MM/DD`（本地时区）
   *
   * 与详情页那条规则的关系：详情页现在是从封面地址里读 `/upic/YYYY/MM/DD/`。
   * 真机逐条比对过，两者绝大多数时候是同一天；万一不同，上层会以「封面为准」——
   * 因为详情页只能算出封面那一天，这样两个入口才不会分叉。
   */
  function dateFromTimestamp(ms) {
    if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return '';
    var d = new Date(ms);
    var y = d.getFullYear();
    if (!isFinite(y)) return '';
    return y + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
  }

  /** 文案清洗：与 `kuaishou-immersive-context.js` 的 DOM 取法保持一致（去掉尾部「展开/收起」） */
  function cleanCaption(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().replace(/\s*(?:展开|收起)\s*$/, '').trim();
  }

  /** 昵称清洗：与 DOM 取法一致（去掉开头的 @） */
  function cleanNickname(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().replace(/^@+/, '').trim();
  }

  function toMeta(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var meta = {
      date: dateFromTimestamp(raw.t),
      caption: cleanCaption(raw.c),
      nickname: cleanNickname(raw.n),
      authorId: String(raw.a || '').trim(),
      homepage: String(raw.a || '').trim() ? ('https://www.kuaishou.com/profile/' + String(raw.a).trim()) : ''
    };
    // 至少得有一个能用，否则算没读到
    if (!meta.date && !meta.caption && !meta.nickname && !meta.authorId) return null;
    return meta;
  }

  /** 把后台搬回来的一整批塞进缓存 */
  function absorb(feeds) {
    if (!feeds || typeof feeds !== 'object' || !feeds.items) return 0;
    var items = feeds.items;
    var n = 0;
    Object.keys(items).forEach(function (id) {
      var meta = toMeta(items[id]);
      if (meta) { cache[id] = meta; n++; }
    });
    if (n) trimCache();
    return n;
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

  function request() {
    var bridge = api();
    if (!bridge) return Promise.resolve(null);
    var p;
    try {
      p = bridge.runtime.sendMessage({ action: 'kuaishouStateFeeds' });
    } catch (e) {
      return Promise.resolve(null);
    }
    return Promise.resolve(p).then(function (res) {
      if (!res || !res.ok || !res.feeds) return null;
      return res.feeds;
    }, function () {
      return null;
    });
  }

  /**
   * 取一条作品的档案
   * @param {string} workId 作品 ID
   * @param {number} [timeoutMs]
   * @returns {Promise<{date:string, caption:string, nickname:string, authorId:string, homepage:string}|null>}
   */
  function getMeta(workId, timeoutMs) {
    var id = String(workId || '');
    if (!id) return Promise.resolve(null);
    if (cache[id]) return Promise.resolve(cache[id]);

    if (!inflight) {
      inflight = withTimeout(request(), typeof timeoutMs === 'number' ? timeoutMs : DEFAULT_TIMEOUT_MS)
        .then(function (feeds) {
          var n = absorb(feeds);
          inflight = null;
          return n > 0;
        }, function () {
          inflight = null;
          return false;
        });
    }

    return inflight.then(function () {
      return cache[id] || null;
    });
  }

  /** 不看后台、只看缓存（同步），供字段方法在异步补齐后使用 */
  function peek(workId) {
    return cache[String(workId || '')] || null;
  }

  var client = {
    getMeta: getMeta,
    peek: peek,
    dateFromTimestamp: dateFromTimestamp,
    cleanCaption: cleanCaption,
    cleanNickname: cleanNickname,
    /** 测试用：清空缓存 */
    resetCache: function () {
      cache = Object.create(null);
      inflight = null;
    },
    /** 测试用：直接塞一批原始数据（模拟后台返回） */
    absorbForTest: absorb
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = client;
  }
  if (global) global.KuaishouStateClient = client;
})(typeof window !== 'undefined' ? window : null);
