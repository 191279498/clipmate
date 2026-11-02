/**
 * Instagram「页面自带数据」读取（隔离世界侧）
 *
 * 两路来源，按可信度排序：
 *   1. 主世界桥节点 `#clipmate-instagram-net`（由 `instagram-net-hook.js` 写）
 *      —— 页面自己向服务器要数据时截下来的，带**精确到秒**的 `taken_at` 与**完整文案**。
 *      沉浸流首屏一批（实测 12 条），滑到批次末尾再来一批，覆盖整个浏览过程。
 *   2. `<script>` 数据块 —— ⚠️ v2.7.7 更正：真机复测发现它**只预取首屏 1~2 条，切条不更新**
 *      （v2.7.5 文件头里「切条时会跟着更新」那句是错的，连切 3 条脚本里始终只有首屏那两条编号）。
 *      所以数据块只作兜底：直接打开 `/reels/<code>/` 这类单条页面时它最快最全。
 *
 * 为什么需要它
 * ------------
 * Reels 沉浸流（`/reels/<code>/`）页面上，**Instagram 根本没有把日期写进可见内容**：
 * 真机实测（2026-10-30，用户已登录 Edge，连切 3 条）结果一致 ——
 *   · `<time>` 元素 0 个
 *   · 没有「3天前 / 2026年10月5日」这类时间文本（span/div 全扫，0 命中）
 *   · og:* / twitter:* / name=description meta 全空（SPA 只换 DOM，不换 <head>）
 * 于是插件原有的三个日期来源（og:description 里的英文日期、<time>、meta）
 * 全部落空 → 「发布日期」恒空 → 标题缺日期尾巴、浮窗就地刷新还被判无效。
 *
 * 本文件只做「读」：**不发起任何请求、不碰任何接口**，桥节点里的数据是页面自己要来的。
 *
 * 用法
 * ----
 *   InstagramInlineData.findTakenAt('DfEmtZgTeu_')        → 1793263488（秒）
 *   InstagramInlineData.findTakenAt('/reels/DfEmtZgTeu_/') → 同上（传地址也认）
 *   取不到返回 null（调用方应继续走原有回退策略）。
 *
 * v2.7.20 追加（个人主页）
 * ----------------------
 *   InstagramInlineData.findProfile('/cartierawards/')
 *     → { username, pk, fullName, bio, externalUrl, followerCount, followingCount,
 *         mediaCount, isPrivate, isVerified }
 *
 *   主页的完整简介只有这里拿得到（DOM 是服务端截断的、meta 在 SPA 跳转后不更新）。
 *   数据由 `instagram-net-hook.js` 从 `POST /api/graphql` 响应里截下来，**按用户名索引** ——
 *   读取时按地址栏的用户名取，物理上不会张冠李戴。
 *
 * 站点门禁
 * --------
 * 本文件挂 `global.InstagramInlineData`，会随 content script 在**所有站点**加载。
 * 对外函数第一行必须校验 hostname，否则抖音/快手/小红书调用时会去扫别人的 script。
 *
 * 依赖：无（只用标准 DOM API / 正则）
 */
(function (global) {
  'use strict';

  /** 扫描结果缓存：切条后数据块会变，未命中时会重新扫一次 */
  var cache = null;

  /**
   * 按作品编号缓存「这一条的媒体信息」：{ takenAt, username, fullName }。
   * 沉浸流里同一份数据会被反复问（作者ID、昵称、URL、日期各问一次），
   * 不缓存就会把 1.7MB 的 JSON 反复 parse 好几遍。
   */
  var mediaCache = {};

  function doc() {
    return (global && global.document) || null;
  }

  function hostname() {
    try {
      return (global.location && global.location.hostname) || '';
    } catch (e) {
      return '';
    }
  }

  /** 站点门禁：只认 Instagram，别的站一律返回 null */
  function isInstagram() {
    return /(^|\.)instagram\.com$/i.test(hostname());
  }

  var CODE = '[A-Za-z0-9_-]{5,30}';

  /**
   * 作品编号的长度上限（v2.7.36 从 30 放宽到 64）
   *
   * 正常帖子是 11 位，但**推广帖**（作者自己加热的帖子）的作品地址是
   * `「编号_ad 追踪串」`，真机实测 43 位（`DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0`）。
   * 卡在 30 位会让这种帖子：① 首页不挂小按钮（`instagram-feed-buttons.js` 同款上限）；
   * ② 就算提了也查不到它的接口数据（本文件的编号规整直接返回 null）。
   *
   * 用户名仍然用 30 位（IG 硬限制），别拿这个常量去放宽用户名。
   */
  var WORK_CODE = '[A-Za-z0-9_-]{5,64}';

  /** 主世界桥节点 id（`instagram-net-hook.js` 写，见文件头「桥节点」） */
  var NET_NODE_ID = 'clipmate-instagram-net';

  /**
   * 把入参统一成作品编号：
   *   传编号 → 原样；传地址/路径 → 抽出编号；其它 → null
   */
  var RESERVED = { audio: 1, explore: 1, highlights: 1, locations: 1, tags: 1, accounts: 1, direct: 1 };

  function isReserved(word) {
    return !!(word && RESERVED[word]);
  }

  function normalizeCode(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (!s) return null;

    // ① IG 作品地址：/p/<code>/、/reel/<code>/、/reels/<code>/、/tv/<code>/、
    //    /<user>/reel/<code>/（主页网格卡片形态）
    //    ⚠️ 必须**先**按类型段定位：否则 `/reels/Abc12345/` 会被通用规则
    //    先撞上 `reels` 这一段（它也是 5~30 位的合法字符），拿回错编号。
    var m1 = s.match(new RegExp('(?:p|reel|reels|tv)/(' + WORK_CODE + ')'));
    if (m1 && m1[1] && !isReserved(m1[1])) return m1[1];

    // ② 本身就是纯编号
    var pure = s.match(new RegExp('^' + WORK_CODE + '$'));
    if (pure && !isReserved(pure[0])) return pure[0];

    // ③ 其他路径形态（如 /stories/<user>/<id>/）→ 取最后一段
    var seg = s.replace(/^\w+:\/\//, '').split(/[?#]/)[0].replace(/\/+$/, '').split('/').filter(Boolean);
    var last = seg.length ? seg[seg.length - 1] : '';
    if (last && !isReserved(last) && new RegExp('^' + WORK_CODE + '$').test(last)) return last;

    return null;
  }

  /**
   * 扫一遍页面里所有 <script>，收集 (时间戳 → 附近的作品编号)。
   *
   * 每个 taken_at 只在其前后 1500 字符窗口内找 code，并记录 code 与 taken_at 的
   * **字符距离**；查表时取距离最近的那条命中 —— 避免把邻居条目的编号串到本条上。
   *
   * @returns {Array<{ts:number, codes:Array<{code:string, off:number}>}>}
   */
  function scan() {
    var pairs = [];
    var d = doc();
    if (!d || !d.querySelectorAll) return pairs;
    var scripts = d.querySelectorAll('script');
    var tsRe = /"taken_at(?:_timestamp)?":(\d{6,13})/g;

    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent || '';
      if (!t || t.indexOf('taken_at') === -1) continue;   // 先做一次廉价过滤
      tsRe.lastIndex = 0;
      var m;
      while ((m = tsRe.exec(t))) {
        var start = Math.max(0, m.index - 1500);
        var end = Math.min(t.length, m.index + 1500);
        var ctx = t.slice(start, end);
        var codes = [];
        var codeRe = new RegExp('"code":"(' + WORK_CODE + ')"', 'g');
        var cm;
        while ((cm = codeRe.exec(ctx))) {
          var off = Math.abs((start + cm.index) - m.index);
          var exist = null;
          for (var k = 0; k < codes.length; k++) {
            if (codes[k].code === cm[1]) { exist = codes[k]; break; }
          }
          if (exist) {
            if (off < exist.off) exist.off = off;
          } else {
            codes.push({ code: cm[1], off: off });
          }
        }
        if (codes.length) {
          pairs.push({ ts: parseInt(m[1], 10), codes: codes });
        }
      }
    }
    return pairs;
  }

  /**
   * 在一个已解析的对象里深搜 `code === 目标编号` 的媒体节点。
   *
   * 真机结构（2026-10-30 实测）：
   *   data.xdt_api__v1__clips__home__connection_v2.edges[].node.media = {
   *     __typename:"XDTMediaDict", code:"DfFNyYARW0g", id:"…_22434677899",
   *     taken_at:1792818136, user:{ pk, username:"aliiiu_u", full_name:"…" }, …
   *   }
   * 所以拿到 media 节点就能一次取出：发布时间 + 作者用户名 + 作者昵称。
   *
   * 深度上限 20 万节点：真机 1.7MB 的数据块约几万节点，留足余量又能防意外死循环。
   */
  function deepFindMedia(root, code) {
    var stack = [root];
    var visited = 0;
    while (stack.length && visited < 200000) {
      var o = stack.pop();
      visited++;
      if (!o || typeof o !== 'object') continue;
      if (o.code === code) {
        var u = o.user || o.owner || null;
        var cap = '';
        var capKnown = false;
        try {
          var c = o.caption;
          if (c && c.edges && c.edges[0] && c.edges[0].node && typeof c.edges[0].node.text === 'string') {
            cap = c.edges[0].node.text;
            capKnown = true;
          } else if (c && typeof c.text === 'string') {
            cap = c.text;
            capKnown = true;
          } else if (Object.prototype.hasOwnProperty.call(o, 'caption') && (c === null || c === undefined)) {
            capKnown = true;                      // 数据块明确写了「没有文案」
          }
        } catch (e) { cap = ''; capKnown = false; }
        return {
          takenAt: (typeof o.taken_at === 'number') ? o.taken_at : null,
          username: (u && typeof u.username === 'string') ? u.username : '',
          fullName: (u && typeof u.full_name === 'string') ? u.full_name : '',
          caption: typeof cap === 'string' ? cap : '',
          captionKnown: capKnown
        };
      }
      for (var k in o) {
        if (o[k] && typeof o[k] === 'object') stack.push(o[k]);
      }
    }
    return null;
  }

  /**
   * 按作品编号取「这一条的媒体信息」。
   *
   * 两路来源，按可信度排序：
   *   1. **主世界桥节点** `#clipmate-instagram-net`（由 `instagram-net-hook.js` 写）
   *      —— 页面自己向服务器要数据时截下来的，带精确到秒的 `taken_at` 和**完整文案**。
   *      沉浸流首屏一批 12 条，滑到批次末尾会再来一批，覆盖整个浏览过程。
   *   2. `<script>` 数据块 —— 只预取首屏 1~2 条（真机实测），切条不更新，仅作兜底。
   *
   * 为什么必须按编号精确匹配：沉浸流里 meta（og:url / twitter:title）**永远是首屏那一条**的，
   * 切条后不更新 —— 用它取作者/URL/日期就会一直停在第一条上（v2.7.5 真机实测的 bug）。
   *
   * @param {string} codeOrHref - 作品编号或地址
   * @returns {{takenAt:number|null, username:string, fullName:string, caption:string}|null}
   */
  function findMedia(codeOrHref) {
    if (!isInstagram()) return null;     // 站点门禁
    var code = normalizeCode(codeOrHref);
    if (!code) return null;

    // 桥节点每次现读一次（主世界会持续更新），命中直接用
    var net = findInNet(code);
    if (net) {
      mediaCache[code] = net;
      return net;
    }

    if (Object.prototype.hasOwnProperty.call(mediaCache, code) && mediaCache[code]) {
      return mediaCache[code];
    }

    var d = doc();
    if (!d || !d.querySelectorAll) return null;
    var scripts = d.querySelectorAll('script');
    var needle = '"code":"' + code + '"';
    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent || '';
      if (t.indexOf(needle) === -1) continue;       // 廉价过滤：只有含这一条的脚本才 parse
      var json;
      try {
        json = JSON.parse(t);                        // IG 的 ScheduledServerJS 包裹本身是合法 JSON
      } catch (e) {
        continue;                                    // 不是纯 JSON（真机上极少）→ 交给正则兜底
      }
      var found = deepFindMedia(json, code);
      if (found) {
        mediaCache[code] = found;
        return found;
      }
    }
    return null;
  }

  /**
   * 从主世界桥节点里按编号取一条。
   *
   * 节点格式（`instagram-net-hook.js` 写）：
   *   {"v":1,"ts":…,"media":{"<code>":[takenAt, username, fullName, caption]}}
   * 用数组而不是对象，纯粹为了省体积（沉浸流一屏 12 条，翻几屏就上百条）。
   *
   * 读失败一律返回 null：桥节点可能还没建（页面刚开）、可能被页面清掉、
   * 也可能是别的站残留的垃圾 —— 全都不许影响正常回退。
   */
  function findInNet(code) {
    var row = readNetRows()[code];
    if (!row || !row.length) return null;
    var ts = row[0];
    return {
      takenAt: (typeof ts === 'number' && isFinite(ts) && ts > 0) ? ts : null,
      username: typeof row[1] === 'string' ? row[1] : '',
      fullName: typeof row[2] === 'string' ? row[2] : '',
      caption: typeof row[3] === 'string' ? row[3] : '',
      // 「这条到底有没有文案」是否已知：只有钩子明确回答过才算（v2.7.8）。
      // 老格式（长度 4）没有这一位 → 一律当成「不知道」，不臆断。
      captionKnown: row.length > 4 ? !!row[4] : false
    };
  }

  /** 读桥节点里的 media 表；读不到返回空对象（每次都现读，主世界会持续更新） */
  function readNetRows() {
    var payload = readNetPayload();
    var m = payload && payload.media;
    return (m && typeof m === 'object') ? m : {};
  }

  /** 读整份桥节点（media + profiles）；读不到返回 null */
  function readNetPayload() {
    try {
      var d = doc();
      if (!d || !d.getElementById) return null;
      var node = d.getElementById(NET_NODE_ID);
      if (!node) return null;
      var raw = node.textContent || '';
      if (!raw || raw.length < 12) return null;
      var json = JSON.parse(raw);
      return (json && typeof json === 'object') ? json : null;
    } catch (e) {
      return null;
    }
  }

  // ==========================================================================
  // 个人主页资料（v2.7.20）
  // ==========================================================================

  /**
   * IG 的一级路由段：这些不是用户名。地址 `/explore/`、`/p/<code>/` 之类
   * 绝不能当主页处理（否则探索页会被判成某个叫 explore 的人的主页）。
   */
  var NON_USER_SEGMENTS = {
    p: 1, reel: 1, reels: 1, tv: 1, stories: 1, highlights: 1, explore: 1,
    accounts: 1, direct: 1, settings: 1, about: 1, legal: 1, api: 1,
    developer: 1, emails: 1, session: 1, challenge: 1, web: 1, directory: 1,
    oauth: 1, privacy: 1, terms: 1, press: 1, blog: 1, jobs: 1, help: 1,
    your_activity: 1, nametag: 1, lite: 1, download: 1, emoji: 1, ads: 1
  };

  /**
   * 把入参统一成主页用户名：
   *   传用户名 → 原样；传 `/‹username›/` 或整条地址 → 抽出用户名；其余 → null
   */
  function normalizeUsername(input) {
    if (!input) return null;
    var s = String(input).trim();
    if (!s) return null;

    // 纯用户名
    if (new RegExp('^' + CODE + '$').test(s) && !NON_USER_SEGMENTS[s]) return s;

    // 地址 / 路径：取**第一段**（主页永远是 /‹username›/）
    var path = s.replace(/^\w+:\/\//, '').split(/[?#]/)[0];
    var seg = path.split('/').filter(Boolean);
    // 去掉主机名那一段
    if (seg.length && /\./.test(seg[0]) && seg[0].indexOf('.com') > -1) seg.shift();
    var first = seg.length ? seg[0] : '';
    if (!first) return null;
    if (NON_USER_SEGMENTS[first]) return null;
    if (!new RegExp('^' + CODE + '$').test(first)) return null;
    return first;
  }

  /** 当前地址看起来是不是个人主页 `/<username>/` */
  function isProfileLocation() {
    try {
      var p = (global.location && global.location.pathname) || '/';
      var seg = p.split('/').filter(Boolean);
      if (seg.length !== 1) return false;         // 多段路径一律不是主页
      return !NON_USER_SEGMENTS[seg[0]] && new RegExp('^' + CODE + '$').test(seg[0]);
    } catch (e) {
      return false;
    }
  }

  /**
   * 按用户名取主页资料（主世界钩子从 `/api/graphql` 响应里收下来的）。
   *
   * 返回对象的键是**短名**（钩子里为了省体积这么写的），这里翻译成长名，
   * 调用方不用记两套：
   *   { username, pk, fullName, bio, externalUrl, followerCount, followingCount,
   *     mediaCount, isPrivate, isVerified }
   *
   * 取不到返回 null —— 调用方必须自己决定怎么兜底（DOM / meta），
   * **不许**在这里猜一个空对象出来，那会让上层误以为「接口说这个号没有简介」。
   */
  function findProfile(usernameOrHref) {
    if (!isInstagram()) return null;      // 站点门禁
    var name = normalizeUsername(usernameOrHref);
    if (!name) return null;

    var payload = readNetPayload();
    var map = payload && payload.profiles;
    if (!map || typeof map !== 'object') return null;
    var row = map[name];
    if (!row || typeof row !== 'object') return null;

    return {
      username: name,
      pk: typeof row.pk === 'string' ? row.pk : '',
      fullName: typeof row.fn === 'string' ? row.fn : '',
      bio: typeof row.bio === 'string' ? row.bio : '',
      externalUrl: typeof row.ext === 'string' ? row.ext : '',
      followerCount: typeof row.fc === 'number' ? row.fc : null,
      followingCount: typeof row.gc === 'number' ? row.gc : null,
      mediaCount: typeof row.mc === 'number' ? row.mc : null,
      isPrivate: !!row.pv,
      isVerified: !!row.vf
    };
  }

  function lookup(pairs, code) {
    if (!pairs || !code) return null;
    var best = null;
    for (var i = 0; i < pairs.length; i++) {
      var codes = pairs[i].codes;
      for (var j = 0; j < codes.length; j++) {
        if (codes[j].code === code && (!best || codes[j].off < best.off)) {
          best = { ts: pairs[i].ts, off: codes[j].off };
        }
      }
    }
    return best;
  }

  /**
   * 按作品编号取发布时间（Unix 秒）。
   * 缓存里没命中就重扫一次（切条后数据块会新增/替换），仍没有返回 null。
   *
   * @param {string} codeOrHref - 作品编号，或 /p/<code>/、/reels/<code>/ 之类的地址
   * @returns {number|null} Unix 秒时间戳；取不到返回 null
   */
  function findTakenAt(codeOrHref) {
    if (!isInstagram()) return null;     // 站点门禁（所有站点都会加载这份文件）
    var code = normalizeCode(codeOrHref);
    if (!code) return null;

    // 先走「精确解析」这条主路（顺带把作者也缓存下来，别的字段直接复用）
    var media = findMedia(code);
    if (media && media.takenAt) return media.takenAt;

    // 兜底：正则扫描（数据块不是纯 JSON 时，JSON.parse 那条路会跳过）
    if (!cache) cache = scan();
    var hit = lookup(cache, code);
    if (!hit) {                          // 切条后数据块变了 → 重扫一次再找
      cache = scan();
      hit = lookup(cache, code);
    }
    return hit ? hit.ts : null;
  }

  /** 清掉缓存（页面切换 / 需要强制重扫时用） */
  function resetCache() { cache = null; mediaCache = {}; }

  /** 当前地址里的作品编号（用于 /reels/<code>/ 这类地址） */
  function shortcodeFromLocation() {
    try {
      var p = (global.location && global.location.pathname) || '';
      var m = p.match(new RegExp('(?:p|reel|reels|tv)/(' + WORK_CODE + ')'));
      // /reels/audio/<id>/ 不是作品地址，别把 audio 当编号
      return (m && m[1] && !isReserved(m[1])) ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  global.InstagramInlineData = {
    findTakenAt: findTakenAt,
    findMedia: findMedia,
    findProfile: findProfile,
    normalizeUsername: normalizeUsername,
    isProfileLocation: isProfileLocation,
    resetCache: resetCache,
    shortcodeFromLocation: shortcodeFromLocation,
    normalizeCode: normalizeCode,
    isInstagram: isInstagram,
    netNodeId: NET_NODE_ID,
    _scan: scan,          // 供单测直接验扫描结果
    _netRows: readNetRows, // 供单测直接验桥节点读取
    _netPayload: readNetPayload
  };
})(typeof window !== 'undefined' ? window : this);
