/**
 * Instagram 沉浸流「精确发布时间 / 完整文案」接收器（主世界，document_start）
 *
 * 为什么需要它
 * ------------
 * `/reels/` 沉浸流上，Instagram **既不在页面上写日期，也不在切条时更新任何数据块**。
 * 真机实测（2026-10-30，用户已登录 Edge，真实滚动切条）：
 *   · `<time>` 元素 0 个，没有任何「3天前 / 2026年10月5日」文本，og:* / name=description 全无；
 *   · 页面自带的数据块（`<script type="application/json">`）**只预取首屏 1~2 条**，
 *     切条不更新 —— `v2.7.5/2.7.6` 文件头里「切条会跟着更新」那句是错的，实测反证；
 *   · React 运行时里每条 media 只有 `{code, pk, user{username}}`（Relay 片段），**没有 taken_at**。
 * 结论：想拿精确时间，只有一条路 —— 页面自己向服务器要数据时，**听**那一次响应。
 *
 * 页面的确会要：沉浸流首屏一次就拉一批（实测 12 条），滑到批次末尾再拉下一批。
 * 响应正文里每条 media 都带 `{code, taken_at, user{username, full_name}, caption{…text}}`
 * —— 时间精确到秒，文案是**没被「… 更多」折叠的全文**。
 *
 * 三条纪律（与 `tiktok-net-hook.js` 同一套）
 * ------------------------------------------
 * 1. **只听不发**。绝不发起请求、不改请求、不改响应，只 `clone()` 出来读一份。
 * 2. **只写不猜**。解析失败 / 字段缺失 / 时间不像话（不在 2001~2100 年）一律不写；
 *    读不到就让字段空着，绝不用「编号反解」之类会差几分钟的凑数法。
 * 3. **按作品编号索引**。同一份响应里有几十条 media，必须按 `code` 分开存；
 *    否则沉浸流切条时会互相串台（本项目 v2.5.48 踩过）。
 *
 * 注入时机必须是 document_start：首屏那批数据在 hydrate 之后立刻发出，
 * document_idle 再挂就全错过了。
 *
 * 桥节点
 * ------
 * 主世界写 `<script type="application/json" id="clipmate-instagram-net">` 到 <head>，
 * 隔离世界（`instagram-inline-data.js`）直接读它的 textContent。两边只通过 DOM 通信。
 *
 * v2.7.20 追加：**个人主页资料**（`profiles`）
 * ------------------------------------------
 * 主页 `/‹username›/` 的六列档案需要「完整简介 / 内部 ID / 外链」，而这三样
 * 在隔离世界都拿不到：
 *   · DOM 的简介是**服务端截断**的（真机 `uni_mitsubishi_pencil`：只剩 113 字 + 「... 更多」，
 *     点开才出全文），插件不能替你点按钮；
 *   · `<meta name="description">` 只在**首次加载**时是对的 —— 真机实测从
 *     `uni_mitsubishi_pencil` SPA 跳到 `zengsong9` 再跳到 `cartierawards`，
 *     DOM 早换人，meta 一直停在最开始那个号上。照抄 meta 就是把别人的简介记到当前账号上。
 *
 * 真机实测（2026-10-31，接管已登录 Edge）：主页切换时页面会发
 * **XHR** `POST /api/graphql`（注意：**不是 fetch**，只包 fetch 会一条也收不到），
 * 响应 `{"data":{"user":{…68 个字段…}}}`：
 *   pk / username / full_name / biography（全文）/ external_url /
 *   follower_count / following_count / media_count / bio_links / category /
 *   is_private / is_verified
 *
 * ⚠️ 一级红线：页面数据块里的 `PolarisViewer` 是**登录者自己**
 *   （真机：`Shan San0421` / `id: 1396136356`），**不是页面主人**。
 *   这是本项目第四次踩同一个坑（抖音、小红书 `user.userInfo`、快手 `/rest/v/profile/get`）。
 *   本文件只认网络响应里的 `data.user`，并按 `username` 建索引 —— 读取时按当前地址的
 *   用户名取，物理上不可能串台；全程不碰 `PolarisViewer`、不碰任何 `<script>` 数据块。
 */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.__clipmateInstagramNetHooked) return;   // 防重复注入
  window.__clipmateInstagramNetHooked = true;

  var NODE_ID = 'clipmate-instagram-net';
  var MAX_ITEMS = 300;        // 只留最近 300 条作品，避免长时间浏览后节点无限变大
  var MAX_PROFILES = 80;      // 只留最近 80 个主页（连续点 Unicorn 也不会无限涨）
  var MAX_CAPTION = 2400;     // 文案上限（IG 正文硬上限 2200 字符，留余量；v2.7.36 从 1200 提高——
                              // 原来 1200 会把长文案静默砍掉半截，而且照旧标成「已知全文」，
                              // 用户看到的就是「文案缺一截」）
  var MAX_BIO = 5000;         // 简介上限（IG 硬上限 150 字符，这里纯属防御）
  var MAX_WALK = 200000;      // 单份响应的遍历节点上限（真机最大一份约 27 万字符）
  var FLUSH_RETRY_MS = 60;
  var FLUSH_MAX_RETRY = 60;

  /** media[code] = [takenAt(秒), username, fullName, caption, captionKnown(0/1)] */
  var media = Object.create(null);
  var order = [];

  /** profiles[username] = profileRow()，见 ingestProfile */
  var profiles = Object.create(null);
  var profileOrder = [];
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
      holder.textContent = JSON.stringify({
        v: 2,
        ts: Date.now(),
        media: media,
        profiles: profiles
      });
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

  function plausibleTs(n) {
    // 2001-09-09 ~ 2100-01-01：明显不是发布时间的数字一律丢弃
    return typeof n === 'number' && isFinite(n) && n > 1000000000 && n < 4102444800;
  }

  /**
   * 按上限切文案，**绝不切坏 emoji**。
   *
   * 直接 `slice(0, max)` 有可能正好切在代理对（surrogate pair）中间：
   * 高位的半个字符会变成乱码「」，用户看到的就是文案尾巴上一个怪符号。
   * IG 文案里 emoji 极多（真机样本里就有 🤷🏻‍♀️），所以必须先退一位再切。
   *
   * @param {string} t
   * @param {number} max
   * @returns {string}
   */
  function clipText(t, max) {
    if (typeof t !== 'string' || t.length <= max) return t;
    var cut = max;
    var code = t.charCodeAt(cut - 1);
    if (code >= 0xD800 && code <= 0xDBFF) cut--;    // 切点前一位是高位代理 → 退一格
    return t.slice(0, cut);
  }

  /**
   * 取这一条的文案，并回答**「这条到底有没有文案」这件事我们知不知道**。
   *
   * 为什么要分三种情况（v2.7.8 真机踩到的坑）：
   *   · `caption: null`            → 接口明确说「这条没文案」→ { text:'', known:true }
   *     **这个结论必须能传下去**，否则读取侧会继续往下走旧兜底（og / 标签容器 / 全文档扫描），
   *     而那些来源全是上一条或首屏第一条的残留 —— 实测把上一条的文案记到了这条作品上。
   *   · 有 caption 但取不到正文     → 只是这份 fragment 没带全 → { text:'', known:false }，不敢断言
   *   · 根本没有 caption 这个键     → 同上，不猜
   */
  function captionInfo(node) {
    try {
      if (!Object.prototype.hasOwnProperty.call(node, 'caption')) return { text: '', known: false };
      var c = node.caption;
      if (c === null || c === undefined) return { text: '', known: true };   // 接口明确：没文案
      var t = null;
      if (c.edges && c.edges[0] && c.edges[0].node && typeof c.edges[0].node.text === 'string') {
        t = c.edges[0].node.text;
      } else if (typeof c.text === 'string') {
        t = c.text;
      }
      if (t === null) return { text: '', known: false };                     // 查了但没正文 → 不断言
      t = t.replace(/\s+$/, '');
      return { text: clipText(t, MAX_CAPTION), known: true };
    } catch (e) { return { text: '', known: false }; }
  }

  function userOf(node) {
    var u = node.user || node.owner || null;
    return {
      username: (u && typeof u.username === 'string') ? u.username : '',
      fullName: (u && typeof u.full_name === 'string') ? u.full_name : ''
    };
  }

  /**
   * 把一份响应正文里所有 `{code, taken_at}` 媒体节点收下来。
   * @param {string} text 响应正文
   * @returns {number} 新写入/更新的条数（单测用）
   */
  function ingest(text) {
    if (!text || text.length < 50) return 0;
    if (text.indexOf('"taken_at"') === -1) return 0;   // 廉价过滤：绝大多数响应在这里就退出

    var data;
    try { data = JSON.parse(text); } catch (e) { return 0; }

    var stack = [data];
    var visited = 0;
    var written = 0;

    while (stack.length && visited < MAX_WALK) {
      var node = stack.pop();
      visited++;
      if (!node || typeof node !== 'object') continue;

      if (typeof node.code === 'string' && node.code && plausibleTs(node.taken_at)) {
        var code = node.code;
        var u = userOf(node);
        var cap = captionInfo(node);
        var row = [node.taken_at, u.username, u.fullName, cap.text, cap.known ? 1 : 0];
        // 同一作品可能出现多份响应：后到的 fragment **没带 caption** 时，
        // 不许用它把先前已经拿到的「有文案 / 明确没文案」冲成「不知道」。
        var prev = media[code];
        if (prev && prev[4] && !cap.known) { row[3] = prev[3]; row[4] = 1; }
        if (!media[code]) order.push(code);
        media[code] = row;
        written++;
      }

      // 逆序压栈 → 出栈时才是响应里的原始顺序（决定 trim 先淘汰谁）
      var keys = Object.keys(node);
      for (var i = keys.length - 1; i >= 0; i--) {
        var v = node[keys[i]];
        if (v && typeof v === 'object') stack.push(v);
      }
    }

    if (written) { trim(); scheduleFlush(); }
    return written;
  }

  function trim() {
    while (order.length > MAX_ITEMS) {
      var old = order.shift();
      if (old) delete media[old];
    }
  }

  // ==========================================================================
  // 二·B、解析主页资料（v2.7.20）
  // ==========================================================================

  function numOrNull(n) {
    return (typeof n === 'number' && isFinite(n) && n >= 0) ? n : null;
  }

  /**
   * 把一个 `data.user` 规整成主页资料；不像主页就返回 null。
   *
   * 闸口只用一条：**必须自带 `biography` 这个键**（哪怕是空字符串）。
   * 理由：主页查询一定带它；帖子查询里的作者对象只有 username / full_name 那几个字段，
   * 拿它当主页资料会把「粉丝数=null、简介=空」写进档案。
   *
   * `pk` 优先字符串（IG 有时给字符串有时给数字，实测 cartierawards 是 `"582782014"`）。
   */
  function profileRow(u) {
    if (!u || typeof u !== 'object') return null;
    var username = (typeof u.username === 'string') ? u.username : '';
    if (!username) return null;
    if (!Object.prototype.hasOwnProperty.call(u, 'biography')) return null;

    var bio = (typeof u.biography === 'string') ? u.biography : '';
    if (bio.length > MAX_BIO) bio = bio.slice(0, MAX_BIO);

    var pk = '';
    if (typeof u.pk === 'string') pk = u.pk;
    else if (typeof u.pk === 'number' && isFinite(u.pk)) pk = String(u.pk);
    else if (typeof u.id === 'string') pk = u.id;

    return {
      u: username,
      pk: pk,
      fn: (typeof u.full_name === 'string') ? u.full_name : '',
      bio: bio,
      ext: (typeof u.external_url === 'string') ? u.external_url : '',
      fc: numOrNull(u.follower_count),
      gc: numOrNull(u.following_count),
      mc: numOrNull(u.media_count),
      pv: u.is_private ? 1 : 0,
      vf: u.is_verified ? 1 : 0
    };
  }

  function trimProfiles() {
    while (profileOrder.length > MAX_PROFILES) {
      var old = profileOrder.shift();
      if (old) delete profiles[old];
    }
  }

  /**
   * 从一份响应正文里取主页资料，按 **username 建索引**。
   *
   * 按用户名索引是这套设计的关键：读取侧按地址栏的用户名取，
   * 就算同一份响应里混了几个号（推荐位、共同关注…），也绝不会张冠李戴。
   *
   * ⚠️ 只认 `data.user`。`data.viewer` / `PolarisViewer` 是**登录者自己**，
   *    一旦认错就是把用户自己的隐私写进别人的档案（快手那次的一级事故同款）。
   *
   * @param {string} text 响应正文
   * @returns {number} 写入条数（单测用）
   */
  function ingestProfile(text) {
    if (!text || text.length < 50) return 0;
    if (text.indexOf('"biography"') === -1) return 0;   // 廉价过滤：非主页响应在这里退出

    var data;
    try { data = JSON.parse(text); } catch (e) { return 0; }

    var d = data && data.data;
    if (!d || typeof d !== 'object') return 0;

    var u = d.user;
    // 旧结构见过一层包裹 `data.user.user`；只在「外层没 biography」时往里探一层
    if (u && typeof u === 'object' && !Object.prototype.hasOwnProperty.call(u, 'biography')
        && u.user && typeof u.user === 'object') {
      u = u.user;
    }

    var row = profileRow(u);
    if (!row) return 0;

    if (!profiles[row.u]) profileOrder.push(row.u);
    profiles[row.u] = row;
    trimProfiles();
    scheduleFlush();
    return 1;
  }

  // ==========================================================================
  // 三、挂耳朵
  // ==========================================================================

  // IG 的接口五花八门（/graphql/query、/api/graphql、预取…），不做 URL 白名单 ——
  // 统一用「正文里有没有 taken_at / biography」在 ingest / ingestProfile 第一行挡掉，
  // 绝大多数响应在那里就退出了。
  //
  // ⚠️ 两条通道**必须都挂**（v2.7.20 真机实测）：
  //    作品/沉浸流走 fetch；**主页切换走 XHR `POST /api/graphql`**。
  //    只包 fetch 时主页资料一条也收不到（探针实测 hits=0），看着像"IG 不提供数据"，
  //    其实是听错了频道。

  // 3.1 fetch（真机实测 IG 走这条）
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        var p = origFetch.apply(this, arguments);
        try {
          p.then(function (res) {
            try {
              if (!res || !res.ok) return;
              res.clone().text().then(function (t) {
                try { ingest(t); ingestProfile(t); } catch (e2) { /* 忽略 */ }
              }, function () { /* 忽略 */ });
            } catch (e3) { /* 忽略 */ }
          }, function () { /* 忽略 */ });
        } catch (e4) { /* 忽略 */ }
        return p;
      };
    }
  } catch (e) { /* 包不上就算了，读不到就别显示 */ }

  // 3.2 XMLHttpRequest（保险：IG 某些页面会走 XHR）
  try {
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      try { this.__clipmateIgUrl = url; } catch (e) { /* 忽略 */ }
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      try {
        this.addEventListener('load', function () {
          try {
            var t = self.responseType && self.responseType !== 'text' ? '' : self.responseText;
            if (t) { ingest(t); ingestProfile(t); }
          } catch (e) { /* 忽略 */ }
        });
      } catch (e) { /* 忽略 */ }
      return origSend.apply(this, arguments);
    };
  } catch (e) { /* 同上 */ }

  // ==========================================================================
  // 四、给单测留的门（页面里不会用到）
  // ==========================================================================

  try {
    window.ClipMateInstagramNetParser = {
      nodeId: NODE_ID,
      ingest: ingest,
      ingestProfile: ingestProfile,
      snapshot: function () { return { v: 2, ts: Date.now(), media: media, profiles: profiles }; },
      reset: function () {
        media = Object.create(null);
        order = [];
        profiles = Object.create(null);
        profileOrder = [];
        flushRetry = 0;
      },
      write: writeNode
    };
  } catch (e) { /* 忽略 */ }
})();
