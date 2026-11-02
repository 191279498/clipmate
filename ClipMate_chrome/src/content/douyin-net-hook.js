/**
 * 抖音「一手数据」网络捕获器 —— 跑在页面环境（world: 'MAIN'），document_start 常驻
 *
 * 为什么要有它
 * ------------
 * 抖音前端所有接口响应里都带作者抖音号（`author.unique_id` / `author.short_id`），
 * 但页面渲染用的 React fiber 里**没有**这两个字段（2026-10-28 真机验证：
 * fiber 的 authorInfo 只有 uid / secUid / nickname）。所以详情页想拿抖音号，
 * 历史上只能「打开作者主页再正则抓」——慢（18~22 秒）且容易被风控。
 *
 * 真机实测（同一台已登录 Edge，2026-10-28）：
 *   · `/video/<id>` 直达 → 首屏数据是服务端直出，**不发任何带抖音号的请求**；
 *   · 精选 / 推荐流 / 沉浸流 → 每批 `/aweme/v2/web/module/feed/`（约 1.3MB，10 条作品，
 *     每条都带 `author.unique_id` 与 `author.short_id`）；
 *   · 弹窗 / 切条 → `/aweme/v1/web/aweme/detail/`（单条）或 `/aweme/v1/web/multi/aweme/detail/`（批量）。
 * 结论：**只能事前拦截**。事后拿 URL 重放会被签名校验挡回 HTML（已实证），所以必须常驻。
 *
 * 五条硬规则
 * ----------
 * 1. **只读不改**：包住 `open/send` 与 `fetch` 只为了「顺便看一眼响应」，原始调用与返回值一律原样透传。
 *    任何一步出错都吞掉 —— 最差结果等于没装这个脚本。
 * 2. **不猜**：作品 ID 不是 6~25 位纯数字就丢弃；字段名 snake_case / camelCase 都认。
 * 3. **不抢主线程**：1.3MB 的 JSON 解析放到 `setTimeout(0)` 之后，不占请求回调。
 * 4. **限量**：只留最近 60 条，先进先出。
 * 5. **跨世界只走 DOM**：主世界碰不到 `chrome.*`，隔离世界看不到页面变量。
 *    这里把结果写进 `<script type="application/json" id="clipmate-douyin-net">`，
 *    隔离世界的 `DouyinNetCache` 读同一个节点。写盘节流 200ms，最多 60 条。
 *
 * 本文件同时被三处使用：
 *   - manifest content_scripts（world: MAIN，document_start）常驻注入
 *   - Node 单测用 vm 加载，验证 URL 判定 / 字段兼容 / 上限淘汰
 *   - 真机探针可直接把 `ClipMateDouyinNetParser` 拿去跑
 */
(function () {
  'use strict';

  var HOOK_FLAG = '__CLIPMATE_DY_NET_HOOKED__';
  var NODE_ID = 'clipmate-douyin-net';
  var MAX_ITEMS = 60;
  var FLUSH_DELAY = 200;

  // ==========================================================================
  // 一、纯函数区（无副作用，单测直接打）
  // ==========================================================================

  /**
   * 这个 URL 要不要看？
   *   /aweme/v1/web/aweme/detail/        → 单条详情（弹窗、切条）
   *   /aweme/v1/web/multi/aweme/detail/  → 批量详情
   *   /aweme/v2/web/module/feed/         → 推荐流 / 精选 / 沉浸流，每批 10 条
   */
  function isTargetUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.indexOf('/aweme/') < 0) return false;
    return url.indexOf('/aweme/detail') >= 0 ||
      url.indexOf('/multi/aweme/detail') >= 0 ||
      url.indexOf('/module/feed') >= 0;
  }

  /** 按顺序取第一个存在且非 null 的键（兼容 snake_case / camelCase） */
  function pick(obj, names) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (var i = 0; i < names.length; i++) {
      var v = obj[names[i]];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  /** 从任意响应体里捞出所有作品对象（三个接口的结构各不相同，全部兜住） */
  function collectAwemes(payload) {
    var out = [];
    if (!payload || typeof payload !== 'object') return out;
    var lists = ['aweme_list', 'aweme_details', 'aweme_detail', 'awemeList'];
    for (var i = 0; i < lists.length; i++) {
      var v = payload[lists[i]];
      if (Array.isArray(v)) {
        for (var k = 0; k < v.length; k++) if (v[k] && typeof v[k] === 'object') out.push(v[k]);
      } else if (v && typeof v === 'object') {
        out.push(v);
      }
    }
    return out;
  }

  /** 把一个作品对象压成我们要的那几个字段；ID 不合法就返回 null */
  function normalizeAweme(a) {
    if (!a || typeof a !== 'object') return null;
    var id = pick(a, ['awemeId', 'aweme_id']);
    id = id === undefined ? '' : String(id);
    if (!/^\d{6,25}$/.test(id)) return null;

    var au = a.author || a.authorInfo || a.author_info || {};
    var unique = pick(au, ['unique_id', 'uniqueId']);
    var shortId = pick(au, ['short_id', 'shortId']);
    var desc = pick(a, ['desc', 'itemTitle', 'item_title']);

    return {
      awemeId: id,
      desc: typeof desc === 'string' ? desc : '',
      createTime: Number(pick(a, ['createTime', 'create_time'])) || 0,
      nickname: typeof au.nickname === 'string' ? au.nickname : '',
      uniqueId: unique === undefined ? '' : String(unique),
      shortId: shortId === undefined ? '' : String(shortId),
      secUid: String(pick(au, ['secUid', 'sec_uid']) || ''),
      uid: String(pick(au, ['uid', 'user_id']) || '')
    };
  }

  /**
   * 合并新旧两版记录
   *
   * 为什么要合并：同一个作品会在多个接口里出现（module/feed、multi detail、单条 detail），
   * 而它们给的数据完整度不一样 —— 有的接口 desc 是空串、有的 createTime 是 0。
   * 直接覆盖会把先前的完整数据冲成空，所以**新值为空就保留旧值**。
   *
   * @returns {Object|null} 有变化返回合并后的记录；完全没变化返回 null（调用方据此跳过写盘）
   */
  function mergeRecord(old, rec) {
    if (!old) return rec;
    var merged = {
      awemeId: rec.awemeId,
      desc: rec.desc || old.desc,
      createTime: rec.createTime || old.createTime,
      nickname: rec.nickname || old.nickname,
      uniqueId: rec.uniqueId || old.uniqueId,
      shortId: rec.shortId || old.shortId,
      secUid: rec.secUid || old.secUid,
      uid: rec.uid || old.uid
    };
    var changed = false;
    for (var k in merged) {
      if (merged[k] !== old[k]) { changed = true; break; }
    }
    return changed ? merged : null;
  }

  var Parser = {
    isTargetUrl: isTargetUrl,
    collectAwemes: collectAwemes,
    normalizeAweme: normalizeAweme,
    mergeRecord: mergeRecord,
    NODE_ID: NODE_ID,
    MAX_ITEMS: MAX_ITEMS
  };

  try { self.ClipMateDouyinNetParser = Parser; } catch (e) { /* 忽略 */ }

  // 下面这些只在真浏览器里跑（Node 单测把 window 伪造成没有 XHR 的对象即可跳过）
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try { if (window[HOOK_FLAG]) return; window[HOOK_FLAG] = 1; } catch (e) { return; }

  // ==========================================================================
  // 二、缓存与 DOM 镜像
  // ==========================================================================

  var items = Object.create(null); // awemeId → 记录
  var order = [];                  // 进入顺序（用于淘汰）
  var flushTimer = null;

  function flush() {
    flushTimer = null;
    try {
      var holder = document.getElementById(NODE_ID);
      if (!holder) {
        var root = document.head || document.documentElement;
        // document_start 太早：连 <html> 都还没建出来 → 过一会儿再写
        if (!root) { scheduleFlush(); return; }
        holder = document.createElement('script');
        holder.type = 'application/json';
        holder.id = NODE_ID;
        root.appendChild(holder);
      }
      holder.textContent = JSON.stringify({ v: 1, items: items });
    } catch (e) { /* 静默：写不进去就等于没有缓存 */ }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    try { flushTimer = setTimeout(flush, FLUSH_DELAY); } catch (e) { flushTimer = null; }
  }

  /** 收下一批作品；有变化才写盘 */
  function ingest(text) {
    if (!text || typeof text !== 'string' || text.length < 30) return;
    var payload;
    try { payload = JSON.parse(text); } catch (e) { return; }
    var list = collectAwemes(payload);
    if (!list.length) return;

    var changed = false;
    for (var i = 0; i < list.length; i++) {
      var rec = normalizeAweme(list[i]);
      if (!rec) continue;
      var old = items[rec.awemeId];
      var merged = mergeRecord(old, rec);
      if (!merged) continue;           // 一模一样，什么都不用做
      if (!old) order.push(rec.awemeId);
      items[rec.awemeId] = merged;
      changed = true;
    }

    if (!changed) return;

    while (order.length > MAX_ITEMS) {
      var drop = order.shift();
      delete items[drop];
    }
    scheduleFlush();
  }

  /** 大响应体别在请求回调里解析 */
  function ingestLater(text) {
    try { setTimeout(function () { ingest(text); }, 0); } catch (e) { /* 忽略 */ }
  }

  // ==========================================================================
  // 三、钩子：XHR（抖音主用）+ fetch（兜底）
  // ==========================================================================

  try {
    var XP = XMLHttpRequest.prototype;
    var origOpen = XP.open;
    var origSend = XP.send;

    XP.open = function (method, url) {
      try { this.__clipmateDyUrl = typeof url === 'string' ? url : (url ? String(url) : ''); } catch (e) { /* 忽略 */ }
      return origOpen.apply(this, arguments);
    };

    XP.send = function () {
      try {
        var xhr = this;
        if (isTargetUrl(xhr.__clipmateDyUrl)) {
          xhr.addEventListener('load', function () {
            try {
              if (xhr.readyState !== 4) return;
              // responseType 不是文本时读 responseText 会抛，直接放过
              if (xhr.responseType && xhr.responseType !== 'text') return;
              ingestLater(xhr.responseText);
            } catch (e) { /* 忽略 */ }
          });
        }
      } catch (e) { /* 忽略 */ }
      return origSend.apply(this, arguments);
    };
  } catch (e) { /* 包不上就算了 */ }

  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var p = origFetch.apply(this, arguments);
        try {
          var url = typeof input === 'string' ? input : (input && input.url) || '';
          if (isTargetUrl(url)) {
            p.then(function (resp) {
              try {
                if (!resp || typeof resp.clone !== 'function') return;
                resp.clone().text().then(ingestLater, function () { /* 忽略 */ });
              } catch (e) { /* 忽略 */ }
            }, function () { /* 忽略 */ });
          }
        } catch (e) { /* 忽略 */ }
        return p;
      };
    }
  } catch (e) { /* 包不上就算了 */ }
})();
