/**
 * YouTube Shorts「一手数据」桥 —— 跑在页面环境（world: 'MAIN'），document_idle 常驻
 *
 * 为什么要有它（2026-11-06 真机实证，接管用户已登录 Edge）
 * ------------------------------------------------------
 * Shorts 里点「下一个视频」后，地址变成新 ID、屏幕上也是新视频，但：
 *   · `meta[itemprop=identifier]` / `datePublished` / `og:title` /
 *     `window.ytInitialPlayerResponse.videoDetails.videoId` **全部仍是上一条**；
 *   · 只有当前 `ytd-reel-video-renderer` 自己的内存数据换成了新条目。
 * 真机路径（2026-11-06 实测，三个入口的数据不在同一处，和 TikTok「首屏块 + 主世界桥」同构；
 * 编号即 collect() 里的尝试顺序）：
 *   ① 站内点「下一个视频」划过来：首屏那个变量仍是旧视频，新条目只在
 *      `reel.data.command.reelWatchEndpoint.unserializedPrefetchData.playerResponse` 里。
 *   ② **有些条目没有预取数据**（真机第 3 条 `R4ECOtTnwXs`：`reelWatchEndpoint` 只有
 *      `softRefreshContinuation`，没有 `unserializedPrefetchData`），但页面自己会发
 *      `/youtubei/v1/player` 请求，新条目的 playerResponse 就在那个响应里。
 *      → 与 `instagram-net-hook.js` / `douyin-net-hook.js` 同一套「只听不发」：
 *      包装 fetch/XHR 读 `clone()` 出来的响应，按 videoId 精确索引，绝不发起请求。
 *   ③ 整页直开 `/shorts/<id>`：首屏数据在主世界 `window.ytInitialPlayerResponse`
 *      （`videoDetails` + `microformat.playerMicroformatRenderer.publishDate`）；
 *      此时 reel 的 `reelWatchEndpoint` **没有** `unserializedPrefetchData`。
 *      放最后是因为换条后这个变量是旧视频，只能靠 normalize 的 ID 闸口挡下。
 * 三路都必须过 `videoId === 地址 ID` 的闸口，绝不允许旧数据顶替。
 * 页面自己会发 `/youtubei/v1/reel/reel_item_watch` + `/youtubei/v1/player`，
 * 所以**不需要插件再发任何请求**：与 TikTok fiber hook / 抖音 net hook / IG net hook 同一套路。
 *
 * 隔离世界（content script）读不到页面主世界的 JS 对象（项目里踩过 4 次），
 * 因此由本脚本把「当前这一条」抄进 DOM 桥节点 `div#clipmate-youtube-shorts` 的
 * `data-clipmate-json` 属性，再由 `shared/youtube-shorts-page-data.js` 按 videoId 精确读走。
 *
 * ⚠️ 为什么不是 `<script type="application/json">`：YouTube 启用了 Trusted Types CSP，
 * 给 script 元素赋 `textContent` 会抛 `This document requires 'TrustedScript' assignment`
 * （2026-11-06 真机实测）。抖音/TikTok/IG 用 script 节点没问题，YouTube 不行。
 * 普通元素的 `data-*` 属性不受该策略限制，且同样能被隔离世界读到。
 *
 * 五条硬规矩（照 TikTok fiber hook 抄）
 * -----------------------------------
 * 1. **只读不改**：不写页面变量、不改元素、不发包；任何一步出错都吞掉，最差等于没装。
 * 2. **不猜**：只在 `youtube.com` 的 `/shorts/<id>` 页工作；写进桥节点的数据
 *    `videoId` 必须与地址里的 ID 一致，对不上宁可不写（绝不把上一条贴到这一条）。
 * 3. **一个节点**：覆盖写，不做历史堆积；离开 Shorts 页立刻清空，防残留。
 * 4. **触发**：地址变化 / 隔离世界改 ask 属性 / 上次没扫到（数据晚到）三者任一即重扫，
 *    400ms 一次，单次只读几个元素，开销可忽略。
 * 5. **站点专属**：文件名与全局名都带 `YoutubeShorts`，不与其他 hook 抢名字。
 */
(function () {
  'use strict';

  var NODE_ID = 'clipmate-youtube-shorts';
  var ASK_ATTR = 'data-clipmate-yt-ask';
  var HOOK_FLAG = '__CLIPMATE_YT_SHORTS_HOOKED__';
  var POLL_MS = 400;
  var MAX_REELS = 12;
  var MAX_PLAYERS = 50;   // 网络响应缓存最多留多少个 videoId，长刷 Shorts 不会无限涨

  /** 站点门禁：只认 YouTube，其他域名一个元素都不碰 */
  function isYoutubeHref(href) {
    try {
      return /^https?:\/\/(?:www\.|m\.)?youtube\.com\//i.test(String(href || ''));
    } catch (e) { return false; }
  }

  /** `/shorts/<id>` 里的视频 ID；不是 Shorts 页返回空串 */
  function isShortsHref(href) {
    return isYoutubeHref(href) && /\/shorts\/[A-Za-z0-9_-]{6,20}/.test(String(href || ''));
  }

  function urlVideoId(href) {
    try {
      var m = String(href || '').match(/\/shorts\/([A-Za-z0-9_-]{6,20})(?:[/?#]|$)/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * playerResponse → 精简快照。
   * ⚠️ ID 闸口：数据里的 videoId 必须等于地址里的 ID，否则整份作废。
   */
  function normalize(pr, videoId) {
    if (!pr || typeof pr !== 'object' || !videoId) return null;
    var vd = pr.videoDetails || {};
    if (String(vd.videoId || '') !== String(videoId)) return null;
    var mf = ((pr.microformat || {}).playerMicroformatRenderer) || {};
    return {
      videoId: String(vd.videoId),
      title: typeof vd.title === 'string' ? vd.title : '',
      description: typeof vd.shortDescription === 'string' ? vd.shortDescription : '',
      author: String(vd.author || mf.ownerChannelName || ''),
      channelId: String(vd.channelId || ''),
      ownerProfileUrl: String(mf.ownerProfileUrl || ''),
      publishDate: String(mf.publishDate || mf.uploadDate || '')
    };
  }

  /**
   * 扫当前页所有 reel，只认「reelWatchEndpoint.videoId === 地址 ID」的那一个。
   * 切条后 DOM 里可能同时留着上一条/当前条/预加载的下一条，靠这道闸口挑出当前条。
   */
  function collect(doc, href, win) {
    var id = urlVideoId(href);
    if (!id || !isShortsHref(href) || !doc || typeof doc.querySelectorAll !== 'function') return null;

    // 路径 ①：站内换条后的新数据，只在当前 reel 的预取 playerResponse 里
    var reels;
    try { reels = doc.querySelectorAll('ytd-reel-video-renderer'); } catch (e) { return null; }
    var n = Math.min(reels.length, MAX_REELS);

    for (var i = 0; i < n; i++) {
      try {
        var d = reels[i] && reels[i].data;
        var ep = d && d.command && d.command.reelWatchEndpoint;
        if (!ep || String(ep.videoId || '') !== id) continue;
        var pre = ep.unserializedPrefetchData;
        var pr = pre && pre.playerResponse;
        var item = normalize(pr, id);
        if (item) return item;
      } catch (e) { /* 单个条目坏了不影响其他条目 */ }
    }

    // 路径 ②：页面自己发的 /youtubei/v1/player 响应（真机第 3 条没有预取数据，全靠它）
    // ⚠️ 按 videoId 精确取，绝不拿「最近一条」顶替 —— 刷 Shorts 时缓存里必然有上一条。
    try {
      var store = win && win.__clipmateYtPlayers;
      var netItem = store && store[id];
      if (netItem && String(netItem.videoId || '') === id) return netItem;
    } catch (e) { /* 缓存坏了继续走下一路 */ }

    // 路径 ③：整页直开时首屏数据在主世界变量里（隔离世界读不到，只能由本脚本抄）
    // ⚠️ 放最后：换条后这个变量是旧视频，靠 normalize 的 ID 闸口挡下；
    //    「有值才返回」，否则会短路掉后面可能的晚到数据。
    try {
      var first = win && win.ytInitialPlayerResponse;
      var firstItem = normalize(first, id);
      if (firstItem) return firstItem;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /**
   * 把一份 `/youtubei/v1/player` 响应按 videoId 存进主世界缓存。
   * ⚠️ 只认响应里的 videoId，绝不按「最近一条」顶替（v2.5.48 串台教训）。
   */
  function rememberPlayerJson(win, text) {
    try {
      if (!win || !text || text.length < 50) return null;
      var data = JSON.parse(text);
      var id = data && data.videoDetails && data.videoDetails.videoId;
      if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(String(id))) return null;
      var item = normalize(data, String(id));
      if (!item) return null;
      var store = win.__clipmateYtPlayers || (win.__clipmateYtPlayers = Object.create(null));
      var order = win.__clipmateYtPlayerOrder || (win.__clipmateYtPlayerOrder = []);
      if (!store[id]) order.push(id);
      store[id] = item;
      while (order.length > MAX_PLAYERS) { delete store[order.shift()]; }
      return item;
    } catch (e) { return null; }
  }

  /** 只听不发：包装 fetch / XHR，读 clone 出来的那一份响应 */
  function installNetHook(win) {
    if (!win || win.__clipmateYtShortsNetHooked) return;
    win.__clipmateYtShortsNetHooked = true;

    function isPlayerUrl(u) {
      return /\/youtubei\/v1\/player(\?|$)/.test(String(u || ''));
    }

    if (typeof win.fetch === 'function') {
      var origFetch = win.fetch;
      win.fetch = function (input, init) {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        var pr = origFetch.apply(this, arguments);
        if (isPlayerUrl(u)) {
          try {
            pr.then(function (res) {
              try {
                res.clone().text().then(function (t) {
                  rememberPlayerJson(win, t);
                }).catch(function () {});
              } catch (e) { /* 读不到就算了 */ }
            }).catch(function () {});
          } catch (e) { /* 只读监听，绝不影响原请求 */ }
        }
        return pr;
      };
    }

    var X = win.XMLHttpRequest;
    if (X && X.prototype && !X.prototype.__clipmateYtHooked) {
      var origOpen = X.prototype.open;
      var origSend = X.prototype.send;
      X.prototype.open = function (method, url) {
        try { this.__cmYtUrl = String(url || ''); } catch (e) { /* 忽略 */ }
        return origOpen.apply(this, arguments);
      };
      X.prototype.send = function () {
        try {
          if (isPlayerUrl(this.__cmYtUrl)) {
            var self = this;
            this.addEventListener('load', function () {
              try { rememberPlayerJson(win, self.responseText); } catch (e) { /* 忽略 */ }
            });
          }
        } catch (e) { /* 忽略 */ }
        return origSend.apply(this, arguments);
      };
      X.prototype.__clipmateYtHooked = true;
    }
  }

  function write(doc, item, href) {
    if (!doc || !item) return false;
    var node = doc.getElementById(NODE_ID);
    if (!node) {
      node = doc.createElement('div');
      node.id = NODE_ID;
      node.setAttribute('hidden', '');
      var parent = doc.head || doc.documentElement;
      if (!parent || typeof parent.appendChild !== 'function') return false;
      parent.appendChild(node);
    }
    // 只用 setAttribute：script.textContent 会被 YouTube 的 Trusted Types 拦下
    node.setAttribute('data-clipmate-json',
      JSON.stringify({ v: 1, href: String(href || ''), item: item }));
    return true;
  }

  /** 离开 Shorts 页就清空，防止旧数据在别的页面被误读 */
  function clear(doc) {
    try {
      if (!doc) return;
      var node = doc.getElementById(NODE_ID);
      if (node && typeof node.removeAttribute === 'function') {
        node.removeAttribute('data-clipmate-json');
      }
    } catch (e) { /* 只读脚本，清不掉就算了 */ }
  }

  /** 一次扫描：命中就写，没命中不动旧节点；不是 Shorts 页则清空 */
  function scan(doc, href, win) {
    if (!isShortsHref(href)) { clear(doc); return false; }
    var item = collect(doc, href, win);
    if (!item) return false;
    return write(doc, item, href);
  }

  /**
   * 常驻：地址变 / ask 变 / 上次没扫到 → 重扫。
   * 用 win.setInterval 而不是裸 setInterval，方便 Node 单测把定时器钉死成空转。
   */
  function start(win, doc) {
    if (!win || !doc) return;
    // 网络钩子要尽早装，且不受下面 HOOK_FLAG 的短路影响：
    // 整页直开的首屏请求可能已经发完（有 ytInitialPlayerResponse 兜底），
    // 但站内换条时的 /youtubei/v1/player 一定在用户点击之后，装晚了就漏。
    try { installNetHook(win); } catch (e) { /* 装不上不影响另外两路 */ }
    if (win[HOOK_FLAG]) return;
    win[HOOK_FLAG] = true;

    var lastHref = '';
    var lastAsk = '';
    var lastOk = false;

    function tick() {
      try {
        var href = win.location && win.location.href ? win.location.href : '';
        var ask = (doc.documentElement && doc.documentElement.getAttribute)
          ? (doc.documentElement.getAttribute(ASK_ATTR) || '') : '';
        var changed = (href !== lastHref) || (ask !== lastAsk);
        if (changed) { lastHref = href; lastAsk = ask; }
        if (changed || !lastOk) lastOk = scan(doc, href, win);
      } catch (e) { /* 最差等于没装这个脚本 */ }
    }

    tick();
    if (typeof win.setInterval === 'function') win.setInterval(tick, POLL_MS);
    if (doc.addEventListener) {
      try { doc.addEventListener('yt-navigate-finish', tick); } catch (e) { /* 事件不支持就算了 */ }
    }
  }

  var api = {
    NODE_ID: NODE_ID,
    ASK_ATTR: ASK_ATTR,
    HOOK_FLAG: HOOK_FLAG,
    POLL_MS: POLL_MS,
    isYoutubeHref: isYoutubeHref,
    isShortsHref: isShortsHref,
    urlVideoId: urlVideoId,
    normalize: normalize,
    collect: collect,
    rememberPlayerJson: rememberPlayerJson,
    installNetHook: installNetHook,
    write: write,
    clear: clear,
    scan: scan,
    start: start
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.ClipMateYoutubeShortsParser = api;

  // 浏览器里自动启动；Node 单测传了 module.exports，不会启动定时器。
  var inNode = (typeof module !== 'undefined' && module.exports);
  if (!inNode && typeof window !== 'undefined' && typeof document !== 'undefined') {
    start(window, document);
  }
})();
