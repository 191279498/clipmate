/**
 * TikTok 主页「最新作品发布时间」接收器（主世界，document_start）
 *
 * 为什么需要它
 * ------------
 * 个人主页（`/@someone`）页面上**没有任何日期**：既没有作品发布时间，也没有账号创建时间。
 * 用户 2026-10-29 要求「发布日期」这一栏不能空着，要用一切可行手段拿到真时间。
 *
 * 三条技术路都试过了，只有第三条成立（真机实测记录）：
 *   1. 首屏数据块 `webapp.user-detail.userInfo.itemList` —— 实测是空数组，主页首屏不带作品；
 *   2. 作品 ID（雪花）反推 —— 项目里 `aweme-id-date.js` 早就验过：反推的是**上传时间**，
 *      与发布时间差一天；对 TikTok 实测差 30021 秒，不靠谱。只能到「日」，不能用；
 *   3. 页面自己会向服务器要作品列表（`/api/post/item_list/`），
 *      返回的每条都带 `author.uniqueId` + `createTime`（秒，精确）→ **这条路能用**。
 *
 * 于是这里在页面最早期给 `fetch` / `XMLHttpRequest` 各挂一只耳朵，只截这一个接口，
 * 把结果按账号名（uniqueId）聚合后写进 DOM 桥节点，给隔离世界读。
 *
 * 两条纪律
 * --------
 * 1. **只认首批**（请求 URL 里 `cursor=0`）。列表按时间倒序，首批才含最新作品；
 *    只截到第二页时算出来的「最新」其实是第二页里最新的那条，会让日期偏旧 —— 宁缺勿错。
 * 2. **只写不猜**。解析失败、字段缺失、账号对不上，一律不写；读不到就让「发布日期」空着。
 *
 * 注入时机必须是 document_start：首屏那次请求在页面 hydrate 之后马上发出，
 * document_idle 再挂就来不及（现有 fiber hook 是 idle，实测挂上时请求早已发完）。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__clipmateTiktokNetHooked) return;   // 防重复注入
  window.__clipmateTiktokNetHooked = true;

  var NODE_ID = 'clipmate-tiktok-net';
  var API_MARK = '/api/post/item_list/';
  var MAX_USERS = 8;         // 只留最近的 8 个账号，避免长时间浏览后无限增长
  var FLUSH_RETRY_MS = 60;   // document_start 时 <head> 可能还没建好，等它一下
  var FLUSH_MAX_RETRY = 60;  // 最多等 ~3.6 秒

  /** users[handle] = { latestCreateTime, latestItemId, firstPage, count } */
  var state = { v: 1, ts: 0, users: {} };
  var order = [];            // 最近写入的账号名，用于淘汰
  var flushTimer = null;
  var flushRetry = 0;

  // ==========================================================================
  // 一、写桥节点
  // ==========================================================================

  function writeNode() {
    try {
      var root = document.head || document.documentElement;
      if (!root) return false;
      var holder = document.getElementById(NODE_ID);
      if (!holder) {
        holder = document.createElement('script');
        holder.type = 'application/json';
        holder.id = NODE_ID;
        root.appendChild(holder);
      }
      state.ts = Date.now();
      holder.textContent = JSON.stringify(state);
      return true;
    } catch (e) {
      return false;
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    try {
      flushTimer = setTimeout(function () {
        flushTimer = null;
        if (writeNode()) { flushRetry = 0; return; }
        if (flushRetry++ >= FLUSH_MAX_RETRY) return;   // 放弃，不打扰页面
        scheduleFlush();
      }, flushRetry === 0 ? 0 : FLUSH_RETRY_MS);
    } catch (e) { /* 忽略 */ }
  }

  // ==========================================================================
  // 二、解析响应
  // ==========================================================================

  /** 请求 URL 里的 cursor；不是数字就返回 -1（视为分页请求，不采用） */
  function cursorOf(url) {
    var m = /[?&]cursor=(-?\d+)/.exec(String(url || ''));
    if (!m) return -1;
    var n = Number(m[1]);
    return isFinite(n) ? n : -1;
  }

  function trim() {
    while (order.length > MAX_USERS) {
      var old = order.shift();
      if (old) delete state.users[old];
    }
  }

  /**
   * 吃一份 item_list 响应
   * @param {string} text 响应正文
   * @param {string} reqUrl 请求地址（用来判断是不是首批）
   * @returns {boolean} 有没有吃进新数据（单测用；正常调用忽略返回值）
   */
  function consume(text, reqUrl) {
    if (!text || text.length < 20) return false;
    var data;
    try { data = JSON.parse(text); } catch (e) { return false; }
    var list = data && (data.itemList || data.item_list);
    if (!list || !list.length) return false;

    var firstPage = cursorOf(reqUrl) === 0;
    var changed = false;

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it) continue;
      var au = it.author || {};
      var handle = String(au.uniqueId || '');
      var ct = Number(it.createTime) || 0;
      if (!handle || !ct) continue;

      var rec = state.users[handle];
      if (!rec) {
        rec = state.users[handle] = {
          latestCreateTime: 0, latestItemId: '', firstPage: false, count: 0
        };
        order.push(handle);
      }
      rec.count += 1;
      if (firstPage) rec.firstPage = true;
      // 只有首批的数据才拿去当「最新作品时间」，见文件头纪律 1
      if (firstPage && ct > rec.latestCreateTime) {
        rec.latestCreateTime = ct;
        rec.latestItemId = String(it.id || '');
      }
      changed = true;
    }

    if (changed) { trim(); scheduleFlush(); }
    return changed;
  }

  function isTarget(url) {
    return String(url || '').indexOf(API_MARK) >= 0;
  }

  // ==========================================================================
  // 三、挂耳朵
  // ==========================================================================

  // 3.1 fetch（实测 TikTok 走的是这条）
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var url = '';
        try {
          url = typeof input === 'string' ? input : ((input && input.url) || '');
        } catch (e) { url = ''; }

        var p = origFetch.apply(this, arguments);
        try {
          if (isTarget(url)) {
            p.then(function (res) {
              try {
                if (!res || !res.ok) return;
                res.clone().text().then(function (t) {
                  try { consume(t, url); } catch (e2) { /* 忽略 */ }
                }, function () { /* 忽略 */ });
              } catch (e3) { /* 忽略 */ }
            }, function () { /* 忽略 */ });
          }
        } catch (e4) { /* 忽略 */ }
        return p;
      };
    }
  } catch (e) { /* 包不上就算了，读不到就别显示 */ }

  // 3.2 XMLHttpRequest（保险：TikTok 某些版本会走 XHR）
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__clipmateUrl = url; } catch (e) { /* 忽略 */ }
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      try {
        if (isTarget(self.__clipmateUrl)) {
          this.addEventListener('load', function () {
            try { consume(self.responseText, self.__clipmateUrl); } catch (e) { /* 忽略 */ }
          });
        }
      } catch (e) { /* 忽略 */ }
      return origSend.apply(this, arguments);
    };
  } catch (e) { /* 同上 */ }

  // ==========================================================================
  // 四、给单测留的门（页面里不会用到）
  // ==========================================================================

  try {
    window.ClipMateTiktokNetParser = {
      cursorOf: cursorOf,
      ingest: function (text, reqUrl) { return consume(text, reqUrl); },
      snapshot: function () { return state; },
      reset: function () {
        state = { v: 1, ts: 0, users: {} };
        order = [];
        flushRetry = 0;
      },
      write: writeNode
    };
  } catch (e) { /* 忽略 */ }
})();
