/**
 * TikTok「一手数据」扫描器 —— 跑在页面环境（world: 'MAIN'），document_idle 常驻
 *
 * 为什么要有它
 * ------------
 * 2026-10-29 真机勘察（已登录 Edge，@kariina_choi 作品页）：
 *   · 首屏作品页：`script#__UNIVERSAL_DATA_FOR_REHYDRATION__` 里有完整一手数据
 *     （`__DEFAULT_SCOPE__['webapp.video-detail'].itemInfo.itemStruct`），隔离世界直接可读。
 *   · **但切换到下一条后，那块数据一字不变**（长度 234699 都不变），里面搜不到新作品的 ID；
 *     切条时 TikTok 也不发任何作品详情接口（网络记录只有埋点 / 通知 / 直播心跳 6 类）。
 *   · 新数据只存在于页面内部的 React 状态里，而 React 内部状态是挂在 JS 对象上的属性，
 *     隔离世界（content script）**读不到** —— 跟抖音 fiber 同一个道理（v2.5.77 已实证）。
 *     → 必须有个脚本跑在页面环境里，把数据抄出来。
 *
 * 抄出来之后怎么给隔离世界：写进 `<script type="application/json" id="clipmate-tiktok-fiber">`。
 * 与抖音 `douyin-net-hook.js` 完全同一个套路（主世界碰不到 chrome.*，隔离世界看不到页面变量，
 * 两边只能借 DOM 说话）。隔离世界由 `shared/tiktok-page-data.js` 读同一个节点。
 *
 * 技术来源：用户提供的油猴脚本（58 万字符）里的 `collectLocalReactItems`：
 * 它从**三个锚点**（视频元素 / 按钮 / 容器）扫描 React 内部状态，切换后照样拿得到新作品。
 * 2026-10-29 真机演练已复现：脚本「详情」显示的作品 ID 与发布时间，
 * 与本脚本扫出来的**一字不差**（7696920492015504661 / 2026-10-15 23:42:38，耗时 4ms）。
 *
 * 五条硬规则
 * ----------
 * 1. **只读不改**：只顺着 React 内部状态往外「看」，不写页面变量、不改任何元素、不发包。
 *    任何一步出错都吞掉 —— 最差结果等于没装这个脚本。
 * 2. **不猜**：作品 ID 不是 6~25 位纯数字就丢弃；扫描结果**必须 ID 对得上**才算数，
 *    对不上宁可什么都不写（绝不把上一条的数据当成当前这条）。
 * 3. **不抢主线程**：单次扫描硬上限 200ms（每 20 个对象查一次表），超了立刻收手。
 * 4. **有序**：切换是并发的，用递增序号 `seq` 作废旧序列，避免「先发后到」覆盖新结果
 *    （快手 v2.5.89 的 `_ksRefreshSeq` 同款教训）。
 * 5. **限量**：结果节点只有一个（覆盖写），不做历史堆积。
 *
 * 本文件同时被三处使用：
 *   - manifest content_scripts（world: MAIN，document_idle）常驻注入
 *   - Node 单测用 vm 加载，验证 URL 判定 / 命中规则 / 归一化 / 上限淘汰
 *   - 真机探针可直接把 `ClipMateTiktokFiberParser` 拿去跑
 */
(function () {
  'use strict';

  var HOOK_FLAG = '__CLIPMATE_TK_FIBER_HOOKED__';
  var NODE_ID = 'clipmate-tiktok-fiber';
  var ASK_ATTR = 'data-clipmate-tk-ask';

  var MAX_UP = 120;        // 一条 fiber 链最多往上爬多少层
  var MAX_HOOKS = 60;      // 每条 hook 链最多走多少个
  var MAX_NODES = 300;     // 单次对象搜索最多看多少个对象
  var MAX_DEPTH = 4;       // 对象搜索最深几层
  var MAX_COST_MS = 200;   // 单次扫描总耗时上限（ms）
  var POLL_MS = 700;       // 地址轮询间隔（ms）
  var RETRY_STEPS = [0, 250, 700, 1500]; // 切换后新数据不是立刻就绪，补位重试

  // v2.5.97 推荐流（For You / Following / Friends）
  // 换条时地址一个字都不变（永远是 tiktok.com），没法靠地址触发 → 只能看「当前播放的是哪一条」。
  // 实测单次读取 0.06ms，250ms 一次的开销可以忽略。
  var FYP_POLL_MS = 250;
  var FYP_MAX_UP = 30;     // 从播放器容器往上最多爬多少层（实测第 22~23 层的 props.item 就是当前条）

  /**
   * 扫描锚点（照油猴 `collectLocalReactItems` 的三锚点思路，多给了几个备选）。
   * 只看前 3 个匹配元素：作品页上同结构的元素可能有一堆，全扫太贵。
   */
  var ANCHOR_SELECTORS = [
    '[data-e2e="video-desc"]',
    '[data-e2e="video-player"]',
    '[data-e2e="browse-video"]',
    'video',
    '[id^="xgwrapper"]',
    '[data-e2e="video-container"]',
    // v2.5.95 图集页（`/photo/<id>`）没有 video 元素，页面上只有一堆 img。
    // 实测：第 2 个 img 向上爬 15 层、走 props 就能命中当前那条（耗时 4ms）。
    // 放最后当兜底 —— 视频页上面几个就能命中，轮不到它，不会白花时间。
    'img'
  ];
  var MAX_ANCHOR_ELEMENTS = 3;
  // 图集页一屏能有 50+ 张图，命中位置不固定（实测在第 2 张，但不敢赌）→ 单独放宽。
  // 有 MAX_COST_MS 总耗时上限兜着，多试几张不会拖慢页面。
  var MAX_IMG_ANCHOR_ELEMENTS = 6;

  // ==========================================================================
  // 一、纯函数区（无副作用，单测直接打）
  // ==========================================================================

  /**
   * 从地址里取作品 ID：`/@user/video/123456` → `123456`
   *
   * v2.5.95：**图集页是 `/photo/<id>`**，两种都要认。
   * 改之前图集页算出空 ID → `checkUrl` 直接 return，一手数据全靠 DOM 兜底。
   */
  function urlItemId(href) {
    try {
      var m = String(href === undefined || href === null ? '' : href)
        .match(/\/(?:video|photo)\/(\d{6,25})/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * 这是不是「我们要的那条作品数据」？
   * 照油猴的判定：有 ID **且** 与当前作品 ID 一致 **且** 带 video / 图集 / 作者 /
   * 文案 / 音乐 / 统计中的任意一个（只带 id 的空壳不算）。
   */
  function isItemStruct(v, id) {
    if (!v || typeof v !== 'object') return false;
    if (v.id === undefined || v.id === null) return false;
    if (!id || String(v.id) !== String(id)) return false;
    return !!(v.video || v.imagePost || v.author || v.desc || v.music || v.stats);
  }

  /**
   * 这是不是「推荐流」页面？（`/`、`/foryou`、`/following`、`/friends`）
   *
   * v2.5.97 新增。推荐流的特点是**地址里没有任何作品 ID**，切条也不改地址，
   * 所以它跟作品页/主页是两套完全不同的触发方式：
   *   · 作品页/图集页：地址变 → 换 ID → 重扫
   *   · 推荐流：地址永不变 → 只能盯「当前正在播的那一条」
   *
   * 只认这几条路径，其余（`/@user`、`/video/`、`/search`、`/live`…）一律不算。
   */
  function isFypUrl(href) {
    try {
      var raw = String(href === undefined || href === null ? '' : href);
      var m = raw.match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com(\/[^?#]*)?(?:[?#]|$)/i);
      if (!m) return false;
      var path = m[1] || '/';
      if (!/^\/(?:foryou|following|friends)?\/?$/i.test(path)) return false;
      return true;
    } catch (e) { return false; }
  }

  /**
   * 推荐流里判定「这条是不是一份合格的作品数据」。
   *
   * 跟 `isItemStruct` 的区别：那边要求 ID 等于地址里的 ID（有唯一答案），
   * 这边没有已知 ID，只能用「长得像不像」来认，所以条件更严：
   *   作品 ID 必须是 6~25 位纯数字，**且** 必须有发布时间（时间是我们最想要的字段之一），
   *   且至少带作者 / 文案 / 视频 里的一个 —— 只带 id 的空壳不要。
   * 宁可返回 null（这屏不出数据），也不许把邻近预加载的那条当成当前条。
   */
  function isFypItem(v) {
    if (!v || typeof v !== 'object') return false;
    var id = (v.id === undefined || v.id === null) ? '' : String(v.id);
    if (!/^\d{6,25}$/.test(id)) return false;
    var ct = (v.createTime !== undefined) ? v.createTime : v.create_time;
    if (ct === undefined || ct === null || ct === '') return false;
    if (!Number(ct)) return false;
    return !!(v.author || v.desc || v.video || v.imagePost || v.image_post || v.stats);
  }

  /**
   * 从一个对象出发做广度优先搜索，找 ID 对得上的那条作品数据。
   * @param {*} root 起点（通常是 hook 对象 / props）
   * @param {string} id 目标作品 ID
   * @param {number} [deadline] Date.now() 形式的截止时间；超了就放弃
   */
  function findItem(root, id, deadline) {
    if (!root || typeof root !== 'object' || !id) return null;
    if (typeof deadline !== 'number') deadline = 0;
    var queue = [{ v: root, d: 0 }];
    var seen = [];
    var n = 0;
    while (queue.length) {
      var cur = queue.shift();
      var v = cur.v;
      if (!v || typeof v !== 'object') continue;
      if (seen.indexOf(v) >= 0) continue;
      seen.push(v);
      n++;
      if (isItemStruct(v, id)) return v;
      // 每 20 个对象查一次表：死循环 / 超大数据时及时收手
      if (deadline && (n % 20 === 0) && Date.now() > deadline) return null;
      if (cur.d >= MAX_DEPTH || n >= MAX_NODES) continue;
      var keys;
      try { keys = Object.keys(v); } catch (e) { continue; }
      for (var i = 0; i < keys.length; i++) {
        var ch;
        try { ch = v[keys[i]]; } catch (e2) { continue; }
        if (ch && typeof ch === 'object') queue.push({ v: ch, d: cur.d + 1 });
      }
    }
    return null;
  }

  /** 把一手数据压成我们要的那几个字段；ID 不合法返回 null */
  /**
   * 归一化成统一结构。
   *
   * v2.5.95 真机实证：作者信息有**两种形态**，只认一种就会全空——
   *   · 视频页：`author` 是**对象**（`author.nickname` / `.uniqueId` / `.secUid` / `.id`）
   *   · 图集页：`author` 是**字符串**（本身就是 TikTok 号），作者信息平铺在 item 上：
   *     `nickname` / `authorId` / `authorSecId`
   * 之前只认对象，图集页扫到了正确数据却只拿到 ID、时间、文案，作者四项全空。
   */
  function normalizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    var id = String(it.id === undefined || it.id === null ? '' : it.id);
    if (!/^\d{6,25}$/.test(id)) return null;

    var au = (it.author && typeof it.author === 'object')
      ? it.author
      : (it.authorInfo || it.author_info || {});
    var authorIsString = (typeof it.author === 'string') ? it.author : '';

    // 文案：视频页在 item.desc；图集页可能只在 contents[0].desc
    var desc = '';
    if (typeof it.desc === 'string') desc = it.desc;
    else if (it.contents && it.contents[0] && typeof it.contents[0].desc === 'string') {
      desc = it.contents[0].desc;
    }

    return {
      id: id,
      desc: desc,
      createTime: Number(it.createTime !== undefined ? it.createTime : it.create_time) || 0,
      nickname: typeof au.nickname === 'string' ? au.nickname
        : (typeof it.nickname === 'string' ? it.nickname : ''),
      uniqueId: String((au.uniqueId !== undefined && au.uniqueId !== null ? au.uniqueId : (au.unique_id || ''))
        || authorIsString || ''),
      secUid: String(au.secUid || au.sec_uid || it.authorSecId || it.author_sec_id || ''),
      // 只认 au.id / au.uid / 图集的 it.authorId；绝不回落 it.id（那是作品 ID）
      authorId: String(au.id || au.uid || it.authorId || ''),
      duration: (it.video && it.video.duration != null) ? Number(it.video.duration) : 0,
      // v2.5.97：图文帖标记。推荐流没有作品网址，URL 要我们自己拼，
      // 视频是 `/video/<id>`、图文是 `/photo/<id>`，拼错就打不开。
      // 键名照油猴脚本的多形态判定（`getImagePostPayload`），少认一个就会把图文拼成视频。
      isPhoto: !!(it.imagePost || it.image_post || it.imagePostInfo ||
        it.image_post_info || it.imagePostV2 || it.image_post_v2 ||
        it.photoMode || it.photo_mode)
    };
  }

  var Parser = {
    NODE_ID: NODE_ID,
    ASK_ATTR: ASK_ATTR,
    RETRY_STEPS: RETRY_STEPS,
    FYP_POLL_MS: FYP_POLL_MS,
    urlItemId: urlItemId,
    isFypUrl: isFypUrl,
    isFypItem: isFypItem,
    isItemStruct: isItemStruct,
    findItem: findItem,
    normalizeItem: normalizeItem
  };

  try {
    var g = typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : null);
    if (g) g.ClipMateTiktokFiberParser = Parser;
  } catch (e) { /* 忽略 */ }

  // 下面这些只在真浏览器里跑（Node 单测到这儿就停）
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  try { if (window[HOOK_FLAG]) return; window[HOOK_FLAG] = 1; } catch (e2) { return; }

  // ==========================================================================
  // 二、React 内部状态扫描
  // ==========================================================================

  function now() {
    try { return Date.now(); } catch (e) { return 0; }
  }

  /** 拿元素上的 fiber / container 节点（属性名带随机后缀，只能靠前缀找） */
  function fiberFrom(el) {
    if (!el) return null;
    try {
      var keys = Object.keys(el);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (k.indexOf('__reactFiber$') === 0) return el[k] || null;
        if (k.indexOf('__reactContainer$') === 0) {
          var c = el[k];
          return (c && c.current) ? c.current : null;
        }
      }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 从一条 fiber 链里找目标作品：往上爬 + 每层走 hook 链 + 顺手看 props */
  function scanFiberChain(el, id, deadline) {
    var node = fiberFrom(el);
    if (!node) return null;
    var step = 0;
    var seen = [];
    while (node && step < MAX_UP) {
      step++;
      if (seen.indexOf(node) >= 0) break;
      seen.push(node);

      // 1) hook 链（实测切换后的新数据就藏在这里）
      var hook = node.memoizedState;
      var hi = 0;
      while (hook && hi < MAX_HOOKS) {
        hi++;
        if (hook && typeof hook === 'object') {
          var hit = findItem(hook, id, deadline);
          if (hit) return hit;
          var inner = hook.memoizedState;
          if (inner && typeof inner === 'object' && inner !== hook) {
            var hit2 = findItem(inner, id, deadline);
            if (hit2) return hit2;
          }
        }
        hook = (hook && hook.next) ? hook.next : null;
        if (now() > deadline) return null;
      }

      // 2) props（有的版本把 itemStruct 直接挂在 props 上）
      var propsList = [node.memoizedProps, node.pendingProps];
      for (var p = 0; p < propsList.length; p++) {
        var props = propsList[p];
        if (props && typeof props === 'object') {
          var hit3 = findItem(props, id, deadline);
          if (hit3) return hit3;
        }
      }

      node = node.return;
      if (now() > deadline) return null;
    }
    return null;
  }

  /** 一次完整扫描：逐个锚点试，命中即停 */
  function scan(id) {
    if (!id) return null;
    var deadline = now() + MAX_COST_MS;
    for (var i = 0; i < ANCHOR_SELECTORS.length; i++) {
      var els = null;
      try { els = document.querySelectorAll(ANCHOR_SELECTORS[i]); } catch (e) { continue; }
      if (!els || !els.length) continue;
      var limit = Math.min(els.length,
        ANCHOR_SELECTORS[i] === 'img' ? MAX_IMG_ANCHOR_ELEMENTS : MAX_ANCHOR_ELEMENTS);
      for (var j = 0; j < limit; j++) {
        var hit = scanFiberChain(els[j], id, deadline);
        if (hit) return hit;
        if (now() > deadline) return null;
      }
    }
    return null;
  }

  // ==========================================================================
  // 二·B、推荐流扫描（v2.5.97）
  // ==========================================================================

  /**
   * 当前正在播的那个 video 元素；拿不到返回 null。
   *
   * 为什么必须精确定位：推荐流 DOM 里**同时存在 2 个 video**（当前这条 + 下一条的预加载），
   * 抓错一个就会把下一条的作者当成这条的（张冠李戴比取不到更糟）。
   * 判定用「竖向中心离视口顶部最近、且至少一半在视口内」——实测当前条 top=8、
   * 下一条 top=869（视口高 877），两者区分度很大。
   */
  function pickFypVideo() {
    var vids = null;
    try { vids = document.querySelectorAll('video'); } catch (e) { return null; }
    if (!vids || !vids.length) return null;
    var vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      var r = null;
      try { r = v.getBoundingClientRect(); } catch (e2) { continue; }
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (r.bottom <= 0 || r.top >= vh) continue;              // 完全在视口外
      var half = r.height * 0.5;
      if (r.top > half || r.top < -half) continue;             // 不到一半在视口顶部 → 不是当前这条
      var dist = Math.abs(r.top);
      if (dist < bestDist) { bestDist = dist; best = v; }
    }
    return best;
  }

  /** 从元素本身开始向上找第一个带 React 内部节点属性的祖先（video 自身没有） */
  function fiberFromNearest(el) {
    var p = el;
    var hop = 0;
    while (p && hop < 8) {
      var f = fiberFrom(p);
      if (f) return f;
      p = p.parentElement;
      hop++;
    }
    return null;
  }

  /**
   * 扫当前播放条的 itemStruct。
   *
   * 实现照真机实测的最快路径：从播放器容器向上爬，每层先看 `memoizedProps.item`
   * （实测第 22~23 层命中），再看 `memoizedProps.value.item`；两者都没有才做深搜。
   * **不做多锚点兜底** —— 推荐流里 anchor / img 那些锚点可能落在下一条上，宁缺勿串。
   */
  function scanFypItem() {
    var v = pickFypVideo();
    if (!v) return null;
    var node = fiberFromNearest(v);
    if (!node) return null;
    var deadline = now() + MAX_COST_MS;
    var step = 0;
    var seen = [];
    while (node && step < FYP_MAX_UP) {
      step++;
      if (seen.indexOf(node) >= 0) break;
      seen.push(node);
      var props = node.memoizedProps;
      if (props && typeof props === 'object') {
        var cand = props.item;
        if (isFypItem(cand)) return cand;
        if (props.value && props.value.item && isFypItem(props.value.item)) return props.value.item;
      }
      node = node.return;
      if (now() > deadline) return null;
    }
    return null;
  }

  /** 桥节点上写的是不是「推荐流 + 这一条」；用来避免同一屏反复重写 DOM */
  function bridgeMatchesFyp(id) {
    try {
      var n = document.getElementById(NODE_ID);
      if (!n || !n.textContent) return false;
      var t = n.textContent;
      return t.indexOf('"scope":"fyp"') >= 0 && t.indexOf('"urlId":"' + id + '"') >= 0;
    } catch (e) { return false; }
  }

  var fypLastId = '';

  /** 推荐流一轮：读当前条 → 跟上次不同才写桥（同一屏不重复写） */
  function fypTick(force) {
    try {
      if (!isFypUrl(location.href)) return;   // 已经跳去作品页/主页，交给原来那套
      var hit = scanFypItem();
      if (!hit) return;
      var item = normalizeItem(hit);
      if (!item) return;
      if (!force && item.id === fypLastId && bridgeMatchesFyp(item.id)) return;
      publish(item.id, item, 'fyp');
      fypLastId = item.id;
    } catch (e) { /* 忽略 */ }
  }

  /** 隔离世界要「立刻就要」时的入口（推荐流下地址不变，ask 属性也得能推一轮） */
  function fypKick() {
    fypTick(true);
    // 换条瞬间新数据可能还没就绪，补一拍（实测 250ms 内必到）
    try { setTimeout(function () { fypTick(false); }, 200); } catch (e) { /* 忽略 */ }
  }


  // ==========================================================================
  // 三、结果落地（写进 DOM，给隔离世界读）
  // ==========================================================================

  /**
   * @param {string} id 作品 ID
   * @param {Object} item 归一化后的数据
   * @param {string} [scope] `'item'`（作品页/图集页，默认）或 `'fyp'`（推荐流）
   *
   * 隔离世界靠 scope 区分：推荐流那一份**不能**被当成作品页数据用
   * （那边校验 urlId 对得上，这边没有 urlId 可比，只能看标记）。
   */
  function publish(id, item, scope) {
    try {
      var holder = document.getElementById(NODE_ID);
      if (!holder) {
        var root = document.head || document.documentElement;
        if (!root) return;
        holder = document.createElement('script');
        holder.type = 'application/json';
        holder.id = NODE_ID;
        root.appendChild(holder);
      }
      holder.textContent = JSON.stringify({
        v: 1, scope: scope || 'item', urlId: id, id: item.id, ts: now(), data: item
      });
    } catch (e) { /* 静默：写不进去就等于没有一手数据 */ }
  }

  // ==========================================================================
  // 四、调度：地址变了就重扫，且并发有序
  // ==========================================================================

  var seq = 0;          // 并发序号：新序列一开，旧序列的结果全部作废
  var lastUrlId = '';

  /**
   * 扫一轮并按补位节奏重试。
   * 为什么要重试：油猴脚本「详情」第一次打开的也是上一条的数据、关掉重开才对
   * （2026-10-29 真机演练实证）→ 切换后新数据不是立刻就绪，得等几拍。
   */
  function runSequence(id) {
    var mine = ++seq;
    for (var i = 0; i < RETRY_STEPS.length; i++) {
      (function (delay) {
        setTimeout(function () {
          try {
            if (mine !== seq) return;                       // 已经有更新的序列
            if (urlItemId(location.href) !== id) return;    // 地址又变了
            var hit = scan(id);
            if (!hit) return;
            var item = normalizeItem(hit);
            if (!item || item.id !== id) return;            // 对不上号的一律不写
            publish(id, item);
          } catch (e) { /* 忽略 */ }
        }, delay);
      })(RETRY_STEPS[i]);
    }
  }

  function checkUrl(force) {
    try {
      var cur = urlItemId(location.href);
      if (!cur) return;
      if (!force && cur === lastUrlId) return;
      lastUrlId = cur;
      runSequence(cur);
    } catch (e) { /* 忽略 */ }
  }

  // 1) 首屏：idle 注入时 DOM 已就绪，但 React 状态可能还没填满
  try { setTimeout(function () { checkUrl(true); }, 300); } catch (e) { /* 忽略 */ }
  try { setTimeout(function () { checkUrl(true); }, 1200); } catch (e) { /* 忽略 */ }

  // 2) 地址轮询：作品页切条地址会变（/@user/video/<id>），这是主要触发方式
  try { setInterval(function () { checkUrl(false); }, POLL_MS); } catch (e) { /* 忽略 */ }

  // 3) v2.5.97 推荐流常驻观察：地址永不变，只能盯「当前在播哪一条」
  //    实测单次 0.06ms，250ms 一次；同一条数据不重复写 DOM。
  try { setTimeout(function () { fypTick(false); }, 600); } catch (e) { /* 忽略 */ }
  try {
    setInterval(function () {
      try {
        if (!document.hidden) fypTick(false);   // 标签在后台时不扫，省电
      } catch (e) { /* 忽略 */ }
    }, FYP_POLL_MS);
  } catch (e) { /* 忽略 */ }

  // 4) 前进后退
  try {
    window.addEventListener('popstate', function () { checkUrl(true); fypKick(); });
  } catch (e) { /* 忽略 */ }

  // 5) 隔离世界「我现在就要」：它在 <html> 上打一个属性，这里收到就立刻重扫
  //    （不能包 pushState —— 隔离世界收不到，这是快手 v2.5.86 已经踩过的坑）
  try {
    var rootEl = document.documentElement;
    if (rootEl && typeof MutationObserver === 'function') {
      var mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          if (records[i].attributeName === ASK_ATTR) {
            checkUrl(true);   // 作品页/图集页：地址没变也要重扫
            fypKick();        // 推荐流：地址不变，靠这一下推一轮
            return;
          }
        }
      });
      mo.observe(rootEl, { attributes: true, attributeFilter: [ASK_ATTR] });
    }
  } catch (e) { /* 忽略 */ }
})();
