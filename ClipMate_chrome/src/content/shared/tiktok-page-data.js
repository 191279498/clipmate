/**
 * TikTok 一手数据读取（隔离世界侧）
 *
 * 两路来源，按可信度排序：
 *   1. 主世界桥节点 `#clipmate-tiktok-fiber`（由 `tiktok-fiber-hook.js` 写）
 *      —— 切到下一条之后**只有这路有当前作品的数据**（首屏那块不更新，已实证）。
 *   2. 首屏数据块 `script#__UNIVERSAL_DATA_FOR_REHYDRATION__`
 *      —— 直接打开作品页时最全最快（解析 23 万字符实测 2ms），隔离世界自己就能读；
 *      **但只在它的作品 ID 与当前地址一致时才可用**，否则就是切条前的旧数据，必须弃用。
 *
 * 一条铁律：**ID 对不上就是别人的数据，宁可返回 null 让提取器回落 DOM，也不许张冠李戴。**
 * 这条是本项目 v2.5.48（缓存键丢了参数导致串台）之后定下的规矩。
 *
 * v2.5.96：新增「主页」通道（`/@someone`）。
 *   主页没有作品，首屏块里放的是 `webapp.user-detail`（昵称 / 账号名 / 简介 / 粉丝数）；
 *   主页的「发布日期」页面上根本没有，由 `tiktok-net-hook.js` 截页面自己的作品列表请求补上
 *   （那条路真机实测拿到了带秒的 createTime，详见该文件头）。
 *   主页数据的闸口同样是「对不上号就不用」：数据块里的 uniqueId 必须等于地址里的 @账号名。
 *
 * 用法：
 *   - 提取器在 extractAllFields 开头 `await TiktokPageData.ensureFresh()` 预热一次
 *     （主页走 `ensureProfileFresh()`），之后各字段同步调 `getCurrent()` / `getProfile()`
 */
(function (global) {
  'use strict';

  var NODE_ID = 'clipmate-tiktok-fiber';
  var NET_NODE_ID = 'clipmate-tiktok-net';   // v2.5.96 主页「最新作品时间」桥节点
  var ASK_ATTR = 'data-clipmate-tk-ask';
  var REHYDRATION_ID = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
  var DEFAULT_TIMEOUT_MS = 900;
  var PROFILE_TIMEOUT_MS = 1200;   // 主页等首屏作品列表请求的上限（实测 1 秒内必回）
  // 推荐流桥节点的「新鲜度」上限：主世界 250ms 写一次，正常情况下最多 250ms 前写的；
  // 标签挂后台时那边会停手，桥上的时间戳就会变老 —— 超过这个岁数一律不信（宁可空着）。
  var FYP_STALE_MS = 4000;

  var cache = Object.create(null);   // urlId → 快照（只存成功的）
  var inflight = Object.create(null); // urlId → Promise
  var profileCache = Object.create(null);   // handle → 主页快照
  var profileInflight = Object.create(null);

  // ==========================================================================
  // 一、纯函数
  // ==========================================================================

  /**
   * `/@user/video/123456` → `123456`
   *
   * v2.5.95：**图集页是 `/photo/<id>`**（不是 `/video/`），两种路径都要认。
   * 实测图集页 `/@kariina_choi/photo/7701436809875639572?image_index=2`。
   * 只取路径里的作品 ID，`?image_index=` 翻第几张图**不算换作品**（见 spa handler）。
   */
  function urlItemId(href) {
    try {
      var raw = href;
      if (raw === undefined || raw === null) {
        raw = (typeof location !== 'undefined' && location.href) ? location.href : '';
      }
      var m = String(raw).match(/\/(?:video|photo)\/(\d{6,25})/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * 个人主页地址 → 账号名（`/@kariina_choi` → `kariina_choi`）；不是主页返回空串
   *
   * v2.5.96 新增。只认「`/@名字` 后面直接结束或跟查询串/锚点」这一种：
   *   `/@someone`            → someone   主页
   *   `/@someone?lang=ru-RU` → someone   主页（带语言参数）
   *   `/@someone/video/123`  → ''        作品页，走 urlItemId 那条
   *   `/@someone/photo/123`  → ''        图集页，同上
   * 账号名大小写敏感，原样返回（TikTok 允许 `Kariina` 与 `kariina` 并存）。
   */
  function urlProfileHandle(href) {
    try {
      var raw = href;
      if (raw === undefined || raw === null) {
        raw = (typeof location !== 'undefined' && location.href) ? location.href : '';
      }
      var m = String(raw).match(
        /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,40})\/?(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /** 是否个人主页 */
  function isProfileUrl(href) {
    return !!urlProfileHandle(href);
  }

  /**
   * 是否「推荐流」页面（`/`、`/foryou`、`/following`、`/friends`）
   *
   * v2.5.97 新增。推荐流跟作品页/主页的根本差别：**地址里没有任何作品 ID，切条也不改地址**。
   * 所以它既走不了 `urlItemId`（恒为空），也走不了「比地址」那套换条判定，
   * 只能靠主世界盯「当前正在播哪一条」并把结果写进桥节点。
   */
  function isFypUrl(href) {
    try {
      var raw = href;
      if (raw === undefined || raw === null) {
        raw = (typeof location !== 'undefined' && location.href) ? location.href : '';
      }
      var m = String(raw).match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com(\/[^?#]*)?(?:[?#]|$)/i);
      if (!m) return false;
      var path = m[1] || '/';
      return /^\/(?:foryou|following|friends)?\/?$/i.test(path);
    } catch (e) { return false; }
  }

  /** 秒级时间戳 → `YYYY/MM/DD HH:MM:SS`（与抖音详情页同一格式，跨站保持一致） */
  function formatTimestamp(seconds) {
    var ts = Number(seconds);
    if (!ts || !isFinite(ts) || ts <= 0) return '';
    var d = new Date(ts * 1000);
    var y = d.getFullYear();
    if (!isFinite(y) || y < 2000 || y > 2100) return '';
    function p2(n) { return n < 10 ? '0' + n : String(n); }
    return y + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) +
      ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  /**
   * 把 itemStruct 压成统一结构；ID 不合法返回 null
   *
   * v2.5.94 真机实证：两种形态都要认，否则作者字段会全空——
   *   - 首屏数据块的 `itemStruct`：作者**嵌套**在 `itemStruct.author.*`
   *   - 主世界桥节点：作者字段**扁平**摊在 item 上（nickname/uniqueId/secUid/authorId）
   * 桥节点只有扁平一种，而首屏只有嵌套一种，漏掉扁平就只剩日期和文案能取到。
   *
   * 注意 `authorId` 绝不能回落到 `struct.id` —— 那是作品 ID，张冠李戴比取不到更糟。
   */
  function normalize(struct) {
    if (!struct || typeof struct !== 'object') return null;
    var id = String(struct.id === undefined || struct.id === null ? '' : struct.id);
    if (!/^\d{6,25}$/.test(id)) return null;
    var au = struct.author || struct.authorInfo || struct.author_info || {};

    // v2.5.97 真机实证：作者信息有**三种**形态，前两种以前就认了，第三种是这次补的——
    //   · 作品页：`author` 是**对象**（`.nickname` / `.uniqueId` / `.id`）
    //   · 图集页：`author` 是**字符串**（本身就是 TikTok 号），作者信息平铺在 item 上
    //   · 推荐流：跟图集页同形（字符串 + 平铺），但**地址里没有 @账号名可以兜底**
    // 所以字符串这一种必须在这里认下来；以前图集页能拿到号纯属侥幸（靠网址里的 @名字），
    // 推荐流一试就现原形：账号名整列为空。
    var authorIsString = (typeof struct.author === 'string') ? struct.author : '';

    /** 先找嵌套的，再找扁平的；空值跳过 */
    function pick(keys) {
      var i, v;
      if (au && typeof au === 'object') {
        for (i = 0; i < keys.length; i++) {
          v = au[keys[i]];
          if (v !== undefined && v !== null && v !== '') return v;
        }
      }
      for (i = 0; i < keys.length; i++) {
        v = struct[keys[i]];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return '';
    }

    return {
      id: id,
      desc: typeof struct.desc === 'string' ? struct.desc : '',
      createTime: Number(struct.createTime !== undefined ? struct.createTime : struct.create_time) || 0,
      nickname: typeof pick(['nickname']) === 'string' ? pick(['nickname']) : '',
      uniqueId: String(pick(['uniqueId', 'unique_id']) || authorIsString || ''),
      secUid: String(pick(['secUid', 'sec_uid', 'authorSecId', 'author_sec_id']) || ''),
      // 只认 authorId / 嵌套的 au.id / au.uid；绝不回落 struct.id（作品 ID）
      authorId: String(au.authorId || au.id || au.uid || struct.authorId || ''),
      // v2.5.97：图文帖标记（推荐流拼作品网址要用）。
      // 桥节点送来的已经压成 `isPhoto`，首屏数据块的原始结构里是 `imagePost` 那一组键，两种都认。
      isPhoto: struct.isPhoto === true ||
        !!(struct.imagePost || struct.image_post || struct.imagePostInfo ||
          struct.image_post_info || struct.photoMode || struct.photo_mode)
    };
  }

  // ==========================================================================
  // 二、两路读取
  // ==========================================================================

  /** 读主世界桥节点；对不上号 / 解析失败一律 null */
  function readBridge(urlId) {
    try {
      if (typeof document === 'undefined') return null;
      var node = document.getElementById(NODE_ID);
      if (!node || !node.textContent) return null;
      var parsed = JSON.parse(node.textContent);
      if (!parsed || !parsed.data) return null;
      // 桥上记的是它扫的时候的地址；地址已经变了就说明这份是上一条的
      if (urlId && parsed.urlId && String(parsed.urlId) !== String(urlId)) return null;
      var item = normalize(parsed.data);
      if (!item) return null;
      if (urlId && String(item.id) !== String(urlId)) return null;
      item.source = 'fiber';
      return item;
    } catch (e) { return null; }
  }

  /** 读首屏数据块；ID 与当前地址不一致 → 判定为「切条前的旧数据」，弃用 */
  function readRehydration(urlId) {
    try {
      if (typeof document === 'undefined') return null;
      var node = document.getElementById(REHYDRATION_ID);
      if (!node || !node.textContent) return null;
      var data = JSON.parse(node.textContent);
      var scope = (data && data.__DEFAULT_SCOPE__) ? data.__DEFAULT_SCOPE__ : data;
      if (!scope) return null;
      var vd = scope['webapp.video-detail'];
      if (!vd || !vd.itemInfo) return null;
      var item = normalize(vd.itemInfo.itemStruct);
      if (!item) return null;
      if (urlId && String(item.id) !== String(urlId)) return null;   // ← 关键闸口
      item.source = 'rehydration';
      return item;
    } catch (e) { return null; }
  }

  /** 同步取当前可用的一手数据（不等待） */
  function getCurrent() {
    var urlId = urlItemId();
    if (!urlId) {
      // v2.5.97：推荐流地址里没有作品 ID，但桥节点上有当前这一条
      if (isFypUrl()) return readFypBridge();
      return null;
    }
    if (cache[urlId]) return cache[urlId];
    var item = readBridge(urlId) || readRehydration(urlId);
    if (item) cache[urlId] = item;
    return item;
  }

  // ==========================================================================
  // 二·A、推荐流（v2.5.97）
  // ==========================================================================

  /**
   * 读推荐流桥节点（由主世界 `tiktok-fiber-hook.js` 每 250ms 盯当前条写进来的）
   *
   * 三个闸口，缺一不可：
   *   1. `scope === 'fyp'` —— 不是推荐流写的那份不要（作品页/图集页的桥同一个节点）
   *   2. `data.id` 合法 —— 结构不对直接丢
   *   3. **桥上的时间戳不能太老**（`FYP_STALE_MS`）—— 标签页挂后台久了、视频被暂停在
   *      上一条，主世界可能长时间没再写；这时候宁可返回 null 让提取器回落 DOM，
   *      也不要把几分钟前那条的数据当成现在这条。
   */
  function readFypBridge() {
    try {
      if (typeof document === 'undefined') return null;
      var node = document.getElementById(NODE_ID);
      if (!node || !node.textContent) return null;
      var parsed = JSON.parse(node.textContent);
      if (!parsed || !parsed.data) return null;
      if (parsed.scope !== 'fyp') return null;
      var item = normalize(parsed.data);
      if (!item) return null;
      var ts = Number(parsed.ts) || 0;
      if (ts && (Date.now() - ts) > FYP_STALE_MS) return null;
      item.source = 'fiber-fyp';
      return item;
    } catch (e) { return null; }
  }

  /**
   * 推荐流预热：等桥节点上出现「这一条」的数据
   *
   * 不缓存（推荐流每条都变，缓存反而会串）。打开页面就点提取时，主世界可能还没跑完第一轮，
   * 所以最多等 `DEFAULT_TIMEOUT_MS`；等不到就返回 null，各字段回落 DOM 取法。
   */
  function ensureFypFresh(timeoutMs) {
    var immediate = readFypBridge();
    if (immediate) return Promise.resolve(immediate);

    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var deadline = Date.now() + ms;

    var p = (function loop() {
      requestScan();   // 催主世界立刻推一轮（推荐流下地址不变，只能靠这个）
      return sleep(120).then(function () {
        var item = readFypBridge();
        if (item) return item;
        if (Date.now() >= deadline) return readFypBridge();
        return loop();
      });
    })();

    return p.then(function (v) { return v; }, function () { return readFypBridge(); });
  }

  // ==========================================================================
  // 二·B、主页（v2.5.96）
  // ==========================================================================

  /**
   * 把首屏数据块里的 `userInfo` 压成统一结构
   *
   * 字段来源实测（2026-10-29，`/@kariina_choi`）：
   *   userInfo.user  → id / uniqueId / nickname / signature / secUid / createTime / verified
   *   userInfo.stats → followerCount / followingCount / heartCount / videoCount
   * 注意 `userInfo.itemList` 实测是空数组：主页首屏**不带作品**，
   * 所以作品的发布时间只能靠 `tiktok-net-hook.js` 截请求，见 `readNet`。
   */
  function normalizeUser(userInfo) {
    if (!userInfo || typeof userInfo !== 'object') return null;
    var u = userInfo.user;
    if (!u || typeof u !== 'object') return null;
    var handle = String(u.uniqueId || '');
    if (!handle) return null;   // 连账号名都没有，一律不认
    var st = userInfo.stats || {};
    var num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };

    return {
      id: String(u.id || ''),
      uniqueId: handle,
      nickname: typeof u.nickname === 'string' ? u.nickname : '',
      signature: typeof u.signature === 'string' ? u.signature : '',
      secUid: String(u.secUid || ''),
      createTime: num(u.createTime),
      verified: !!u.verified,
      privateAccount: !!u.privateAccount,
      followerCount: num(st.followerCount),
      followingCount: num(st.followingCount),
      heartCount: num(st.heartCount || st.heart),
      videoCount: num(st.videoCount)
    };
  }

  /**
   * 读首屏数据块里的主页信息；账号名与地址不一致 → 判定为别人的数据，弃用
   *
   * 比较用**大小写不敏感**：TikTok 的账号名不区分大小写（`/@Kariina_Choi` 与
   * `@kariina_choi` 是同一个人），用户手打大写地址时不能因此把正确数据丢掉。
   * 但对外输出的账号名一律用数据块里的原始写法（那才是账号真正的样子）。
   */
  function readProfileRehydration(handle) {
    try {
      if (typeof document === 'undefined') return null;
      var node = document.getElementById(REHYDRATION_ID);
      if (!node || !node.textContent) return null;
      var data = JSON.parse(node.textContent);
      var scope = (data && data.__DEFAULT_SCOPE__) ? data.__DEFAULT_SCOPE__ : data;
      if (!scope) return null;
      var ud = scope['webapp.user-detail'];
      if (!ud || !ud.userInfo) return null;
      var user = normalizeUser(ud.userInfo);
      if (!user) return null;
      if (handle && user.uniqueId.toLowerCase() !== String(handle).toLowerCase()) return null;
      return user;
    } catch (e) { return null; }
  }

  /** 读「最新作品时间」桥节点（由主世界 `tiktok-net-hook.js` 写） */
  function readNet(handle) {
    try {
      if (typeof document === 'undefined' || !handle) return null;
      var node = document.getElementById(NET_NODE_ID);
      if (!node || !node.textContent) return null;
      var parsed = JSON.parse(node.textContent);
      var rec = parsed && parsed.users ? parsed.users[handle] : null;
      if (!rec) return null;
      var ct = Number(rec.latestCreateTime) || 0;
      if (!ct || !rec.firstPage) return null;   // 不是首批 → 不是最新作品，宁缺勿错
      return { latestCreateTime: ct, latestItemId: String(rec.latestItemId || '') };
    } catch (e) { return null; }
  }

  /**
   * 拼一份主页快照
   *
   * 两半可以只来一半：
   *   · 整页打开主页 → 用户信息来自首屏数据块，最新作品时间来自请求截获（后者晚到几百毫秒）；
   *   · 从作品页点作者名回主页（页内路由，不换文档）→ 首屏块还是作品的数据，
   *     用户信息这边读不到，由提取器回落 DOM（`[data-e2e="user-title"/"user-subtitle"/"user-bio"]`）。
   * @param {string} handle
   * @returns {Object|null} 两边都没有 → null
   */
  function buildProfile(handle) {
    var user = readProfileRehydration(handle);
    var net = readNet(handle);
    if (!user && !net) return null;

    var out = user ? {
      id: user.id, uniqueId: user.uniqueId, nickname: user.nickname,
      signature: user.signature, secUid: user.secUid, createTime: user.createTime,
      verified: user.verified, privateAccount: user.privateAccount,
      followerCount: user.followerCount, followingCount: user.followingCount,
      heartCount: user.heartCount, videoCount: user.videoCount
    } : {
      id: '', uniqueId: handle, nickname: '', signature: '', secUid: '',
      createTime: 0, verified: false, privateAccount: false,
      followerCount: 0, followingCount: 0, heartCount: 0, videoCount: 0
    };

    out.handle = handle;
    out.latestCreateTime = net ? net.latestCreateTime : 0;
    out.latestItemId = net ? net.latestItemId : '';
    out.source = user ? (net ? 'rehydration+net' : 'rehydration') : 'net';
    return out;
  }

  /** 同步取当前主页快照（不等待）；没拿到新数据时返回上一次的 */
  function getProfile() {
    var handle = urlProfileHandle();
    if (!handle) return null;
    var cached = profileCache[handle];
    if (cached && cached.latestCreateTime) return cached;
    var fresh = buildProfile(handle);
    if (fresh) {
      profileCache[handle] = fresh;
      return fresh;
    }
    return cached || null;
  }

  /**
   * 预热主页数据：等「最新作品时间」到位
   *
   * 为什么要等：页面自己的作品列表请求在 hydrate 之后才发，点击提取时可能刚到或还没到。
   * 上限 1.2 秒（实测首屏请求 1 秒内必回）；等不到就返回已有的一半，日期栏空着，绝不编。
   * 账号一条作品都没有（videoCount 为 0）时不等，直接返回。
   */
  function ensureProfileFresh(timeoutMs) {
    var handle = urlProfileHandle();
    if (!handle) return Promise.resolve(null);
    if (profileInflight[handle]) return profileInflight[handle];

    var immediate = buildProfile(handle);
    if (immediate) profileCache[handle] = immediate;
    if (immediate && immediate.latestCreateTime) return Promise.resolve(immediate);
    // 明确没有作品（有用户信息且 videoCount 为 0）→ 不会再有请求，别白等
    if (immediate && immediate.source === 'rehydration' && immediate.videoCount === 0) {
      return Promise.resolve(immediate);
    }

    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : PROFILE_TIMEOUT_MS;
    var deadline = Date.now() + ms;

    var p = (function loop() {
      return sleep(120).then(function () {
        var snap = buildProfile(handle);
        if (snap) profileCache[handle] = snap;
        if (snap && snap.latestCreateTime) return snap;
        if (Date.now() >= deadline) return snap || profileCache[handle] || null;
        return loop();
      });
    })();

    profileInflight[handle] = p.then(function (v) {
      delete profileInflight[handle];
      return v;
    }, function () {
      delete profileInflight[handle];
      return profileCache[handle] || null;
    });
    return profileInflight[handle];
  }

  /** 主页缓存作废（换账号时用） */
  function invalidateProfile(handle) {
    if (handle) delete profileCache[handle];
  }

  /** 请主世界立刻重扫一次（在 <html> 上打个属性，那边用 MutationObserver 接着） */  function requestScan() {
    try {
      if (typeof document === 'undefined' || !document.documentElement) return;
      var el = document.documentElement;
      var seqNo = (Number(el.getAttribute(ASK_ATTR)) || 0) + 1;
      el.setAttribute(ASK_ATTR, String(seqNo));
    } catch (e) { /* 忽略 */ }
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      try { setTimeout(resolve, ms); } catch (e) { resolve(); }
    });
  }

  /**
   * 预热：确保当前这条的一手数据已经就绪
   * @param {number} [timeoutMs]
   * @returns {Promise<Object|null>} 拿到返回数据，拿不到返回 null（调用方据此回落 DOM）
   */
  function ensureFresh(timeoutMs) {
    var urlId = urlItemId();
    if (!urlId) {
      // v2.5.97：推荐流没有作品 ID，等的是「桥节点上出现当前这一条」
      if (isFypUrl()) return ensureFypFresh(timeoutMs);
      return Promise.resolve(null);
    }
    if (cache[urlId]) return Promise.resolve(cache[urlId]);
    if (getCurrent()) return Promise.resolve(cache[urlId]);
    if (inflight[urlId]) return inflight[urlId];

    var ms = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : DEFAULT_TIMEOUT_MS;
    var deadline = Date.now() + ms;

    var p = (function loop() {
      requestScan();
      return sleep(120).then(function () {
        var item = readBridge(urlId);
        if (item) { cache[urlId] = item; return item; }
        if (Date.now() >= deadline) {
          // 主世界扫不到（页面没有 React 状态 / 被限流）：退回首屏那块，仍要过 ID 闸口
          var fallback = readRehydration(urlId);
          if (fallback) cache[urlId] = fallback;
          return fallback;
        }
        return loop();
      });
    })();

    inflight[urlId] = p.then(function (v) {
      delete inflight[urlId];
      return v;
    }, function () {
      delete inflight[urlId];
      return null;
    });
    return inflight[urlId];
  }

  /** 切条后清掉旧缓存（供 spa handler 调用；不清也能用，因为有 ID 闸口） */
  function invalidate(urlId) {
    if (urlId) delete cache[urlId];
  }

  function clear() {
    cache = Object.create(null);
    inflight = Object.create(null);
    profileCache = Object.create(null);
    profileInflight = Object.create(null);
  }

  var api = {
    NODE_ID: NODE_ID,
    NET_NODE_ID: NET_NODE_ID,
    ASK_ATTR: ASK_ATTR,
    REHYDRATION_ID: REHYDRATION_ID,
    DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
    PROFILE_TIMEOUT_MS: PROFILE_TIMEOUT_MS,
    FYP_STALE_MS: FYP_STALE_MS,
    urlItemId: urlItemId,
    urlProfileHandle: urlProfileHandle,
    isProfileUrl: isProfileUrl,
    isFypUrl: isFypUrl,
    formatTimestamp: formatTimestamp,
    normalize: normalize,
    normalizeUser: normalizeUser,
    readBridge: readBridge,
    readRehydration: readRehydration,
    readFypBridge: readFypBridge,
    readNet: readNet,
    readProfileRehydration: readProfileRehydration,
    buildProfile: buildProfile,
    getProfile: getProfile,
    ensureProfileFresh: ensureProfileFresh,
    invalidateProfile: invalidateProfile,
    getCurrent: getCurrent,
    requestScan: requestScan,
    ensureFresh: ensureFresh,
    ensureFypFresh: ensureFypFresh,
    invalidate: invalidate,
    clear: clear
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.TiktokPageData = api;
})(typeof window !== 'undefined' ? window : null);
