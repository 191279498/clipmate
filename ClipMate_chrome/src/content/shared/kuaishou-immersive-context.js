/**
 * 快手「正在播哪一条」状态识别器（只在内容脚本的隔离环境里跑，不注入页面）
 *
 * 覆盖两种「页内播放态」（v2.5.88 起）
 * ----------------------------------
 * ① **推荐流** `/new-reco`：竖向整屏 swiper，一次只播一条，滑 ↓ / 滚轮切下一条时
 *    **地址栏一动不动**。所以「现在正在播的是哪一条」不能看地址，只能看
 *    `.swiper-slide-active`（真机实测恰好 1 个，`.swiper-slide` 共 20 个）。
 *
 * ② **搜索页 / 作者主页弹层** `/search/*`、`/profile/*`：点开卡片是**在页面上盖一层
 *    `.player-pop`**，地址不变、文档不换（真机 `performance.getEntriesByType('navigation')`
 *    恒为 1）。v2.5.86 的「站内跳转接管」只认地址变化，完全接不住这一态 → 按钮 0 个。
 *    （搜索页 v2.5.88 接入；作者主页 v2.7.0 接入，两者结构完全同构。）
 *
 *    两种态的内部结构**几乎同构**（v2.5.88 真机逐项核对）：
 *      `.swiper-slide-active` → `a.name`（含 profile 链接）→ `.caption` → `img.background`
 *    所以不需要第二套解析器，只要**换个搜索根**就行。
 *
 *    ⚠️ 两者唯一的致命差别：**搜索列表页自己也可能有 swiper**。所以弹层态的作用域
 *    必须限定在 `.player-pop` **之内**，绝不能拿全页的 `.swiper-slide-active`。
 *    真机实测：弹层关着时 `.player-pop` / `.swiper` / `.swiper-slide-active` **都是 0 个**
 *    （不是常驻空壳），所以「`.player-pop` 存在 = 弹层真的开着」这个判定是干净的。
 *
 * 与抖音最大的结构差异（v2.5.82 真机勘察结论）
 * ------------------------------------------------
 *   - 快手的**网格页**（发现 / 关注 / 同城）点开作品是整页跳 `/short-video/<id>`
 *     （换地址不换文档，由 `kuaishou-route-watcher.js` 接管），**不出弹层**；
 *     只有**搜索页**是盖弹层。两条链路互不重叠。
 *
 * 数据从哪来（这条最关键，决定「同一作品任何入口同一字符串」）
 * ------------------------------------------------------------
 * 快手把作品 ID 和发布日期**直接写在封面图地址里**：
 *   `https://p23.a.yximgs.com/upic/2026/10/15/19/BMj...jpg?clientCacheKey=3xs9ezatr424bpa.jpg&...`
 *     ├─ `/upic/2026/10/15/`            → 发布日期（详情页也走这一条，见下方说明）
 *     └─ `clientCacheKey=3xs9ezatr424bpa` → 作品 ID（真机与 INIT_STATE 里的 photo.id 逐字比对过）
 *
 * 于是**不需要**发任何请求、**不需要**碰 `window.INIT_STATE`（它键名做了字符偏移，
 * 且详情页没有这份数据 —— 用了会出现「流里到秒、详情页到日」的不一致）。
 *
 * 详情页的日期为什么也是这一天：`KuaishouSocialExtractor.extractPublishDate()`
 * 的 7 个 DOM 选择器在详情页全部落空，实际走的是「从图片/视频地址抠 `/upic/YYYY/MM/DD/`」，
 * 真机实测输出 `2026/10/15`。流里用同一套规则，两边天然一致。
 *
 * 依赖：无（只用标准 DOM API / URL）
 */
(function (global) {
  'use strict';

  var SEL = {
    /** 沉浸流里「正在播的那一条」（真机实测恰好 1 个） */
    active: '.swiper-slide-active',
    slide: '.swiper-slide',
    /** 作者昵称 + 主页链接都在这个 a 上：`<a class="name" href="https://www.kuaishou.com/profile/3x...">@黑蛇</a>` */
    name: 'a.name',
    /** 文案（含 #话题 标签），详情页对应的是 `.video-info-title` */
    caption: '.caption',
    tag: 'a.tag',
    /** 封面图：作品 ID 与日期都从它的地址里取 */
    cover: 'img.background',
    /** v2.5.88 搜索页弹层的根（关着时页面上没有这个节点） */
    popRoot: '.player-pop'
  };

  /** 作品 ID 形态：15~20 位的字母数字（如 `3xs9ezatr424bpa`） */
  var ID_RE = /^[0-9a-zA-Z_-]{8,40}$/;

  /**
   * 沉浸流页面白名单（pathname 精确匹配）
   *
   * 只认真机验证过的 `/new-reco`，**宁可少认不要错认**：
   * 认错了会在网格页 / 主页 / 详情页上凭空冒出第二个按钮。
   * 以下页面故意**不认**：
   *   - `/?isHome=1`（发现）、`/myFollow`（关注）→ 都是网格，点开是整页跳详情页
   *   - `/profile/*` → 作者主页
   *   - `/short-video/*`、`/video/*` → 详情页，走原有提取
   */
  var IMMERSIVE_PATHS = { '/new-reco': 1 };

  /**
   * 会出现「页内播放弹层」的路径前缀（v2.5.88 建，v2.7.0 扩到作者主页）
   *
   * 真机核对过：这几处点开作品都是**页内盖一层 `.player-pop`**，地址与文档都不变，
   * 只能靠本模块接（route-watcher 只认地址变化，接不住）：
   *   - `/search/*`  搜索页（v2.5.88）
   *   - `/profile/*` 作者主页（v2.7.0 真机补验：地址一直是 `/profile/<id>?source=SEARCH`
   *                  不动、`window.__cmMark` 存活、`navigation` 条目恒为 1 → 确证页内弹层；
   *                  弹层结构与搜索页**完全同构**：`.player-pop` → `.swiper-slide-active`
   *                  → `a.name` + `.caption`）
   *
   * 仍然**不认**的列表页（真机点开是整页跳 `/short-video/<id>`，走 route-watcher）：
   *   `/?isHome=1`（发现）、`/myFollow`（关注）、`/samecity`（同城）
   *
   * 认宽了不会误出按钮：`immersiveContext()` 还要求 `.player-pop` 真的存在、
   * 且里面认得出作品 ID。这里只是决定「要不要挂监听」。
   */
  var POPUP_PATH_PREFIXES = ['/search', '/profile'];

  /** 现在这个地址是不是可能出现播放弹层的页面 */
  function isPopupPage(url) {
    try {
      var href = url || (global.location && global.location.href) || '';
      var u = new URL(href, 'https://www.kuaishou.com/');
      if (u.hostname !== 'www.kuaishou.com') return false;
      var p = u.pathname || '';
      for (var i = 0; i < POPUP_PATH_PREFIXES.length; i++) {
        var pre = POPUP_PATH_PREFIXES[i];
        // 前缀必须落在完整路径段上：`/searchxxx` 不算 `/search`
        if (p === pre || p.indexOf(pre + '/') === 0) return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function safeQuery(root, selector) {
    try {
      return root && root.querySelector ? root.querySelector(selector) : null;
    } catch (e) {
      return null;
    }
  }

  function safeQueryAll(root, selector) {
    try {
      return root && root.querySelectorAll ? root.querySelectorAll(selector) : [];
    } catch (e) {
      return [];
    }
  }

  function textOf(el) {
    if (!el) return '';
    var t = el.textContent || '';
    return String(t).replace(/\s+/g, ' ').trim();
  }

  /**
   * 这个节点**真的有版面**吗？
   *
   * 快手 swiper 里非当前条也可能带着 class 但高度为 0（预加载的下一条），
   * 真机实测「有版面」的永远恰好 1 个，所以按版面过滤是最干净的判据。
   *
   * 注意：jsdom 里 `getBoundingClientRect()` 恒为 0×0，调用方必须
   * 「一个都没有版面时退回全部候选」，否则单测会瞎。
   */
  function hasGeometry(el) {
    try {
      var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!(r && r.width > 0 && r.height > 0);
    } catch (e) {
      return false;
    }
  }

  /** 整页到底有没有版面（区分「jsdom/还没起来」与「真机上全是残影」） */
  function hasPageLayout(d) {
    try {
      var b = (d || global.document).body;
      if (!b) return false;
      return !!(b.scrollHeight > 0 || b.scrollWidth > 0);
    } catch (e) {
      return false;
    }
  }

  /** 现在这个地址是不是沉浸流页？ */
  function isImmersivePage(url) {
    try {
      var href = url || (global.location && global.location.href) || '';
      var u = new URL(href, 'https://www.kuaishou.com/');
      if (u.hostname !== 'www.kuaishou.com') return false;
      return IMMERSIVE_PATHS[u.pathname] === 1;
    } catch (e) {
      return false;
    }
  }

  /**
   * 去掉封面图地址的「变体后缀」：`3xdj86q2ifn7hds_ccc` → `3xdj86q2ifn7hds`
   *
   * 为什么必须做（v2.5.82 真机抓到）：`clientCacheKey` 的值不一定等同于作品 ID，
   * 它可能是 `<作品ID>_<封面变体>.jpg`（实测见过 `_ccc`，而同页 `INIT_STATE` 里
   * 对应那条 photo.id 是没有后缀的 `3xdj86q2ifn7hds`）。
   * 不剥离的话 URL 字段会拼成打不开的地址 `.../short-video/3xdj86q2ifn7hds_ccc`。
   *
   * 快手作品 ID 由纯字母数字组成（真机逐条比对过十几条，都是 15 位 `[0-9a-z]`），
   * 不含下划线，所以取第一个 `_` 之前那一段就是真 ID。
   */
  function trimVariantSuffix(raw) {
    var s = String(raw || '').replace(/\.jpg$/i, '').split('_')[0];
    return /^[0-9a-zA-Z]{8,25}$/.test(s) ? s : '';
  }

  /** 从封面图地址里抠作品 ID（`clientCacheKey=<id>.jpg`，老版本是 `Key=<id>.jpg`） */
  function idFromCoverSrc(src, strongOnly) {
    var s = String(src || '');
    var m = /[?&](?:clientCacheKey|Key)=([0-9a-zA-Z_-]{8,40})\.jpg/.exec(s);
    if (m) {
      var id = trimVariantSuffix(m[1]);
      if (id) return id;
    }
    // 兜底：地址里任意 `<id>.jpg`（快手封面地址的固定形态）
    //
    // ⚠️ 这一档是**弱证据**（v2.7.0 补注）：快手大量封面文件名是 base64 编码的
    // 发布时间（`BMjAyNjAzMTUxODE2NTdf...jpg`），按 `_` 切第一段有可能落在
    // 8~25 位区间、被误当成作品 ID。所以 `idFromSlide()` 只在**没有更强证据**时才用它，
    // 而 `strongOnly = true` 就只认 `clientCacheKey` / `Key` 那一档。
    if (strongOnly) return '';
    // 文件名本身就是 base64 编码的发布时间（`BMjAyNjA4MTgxODI3MDJf_ccc_...jpg`）时，
    // 按 `_` 切出来的第一段是**时间碎片**，不是作品 ID —— 宁可返回空也不拼假地址。
    // 判据：cover-time 能把这个文件名解到「秒」（返回值带空格）就说明它是时间戳，
    // 解不出来的（如 `3xs9ezatr424bpa.jpg` 这种真 ID 文件名）照旧认。
    try {
      if (typeof KuaishouCoverTime !== 'undefined' && KuaishouCoverTime
        && typeof KuaishouCoverTime.publishDateTimeFromSrc === 'function') {
        var stamp = KuaishouCoverTime.publishDateTimeFromSrc(s);
        if (stamp && stamp.indexOf(' ') > -1) return '';
      }
    } catch (e) { /* 工具没加载到就照旧走通用兜底 */ }
    m = /[/=]([0-9a-zA-Z_-]{8,40})\.jpg(?:[?&]|$)/.exec(s);
    return m ? trimVariantSuffix(m[1]) : '';
  }

  /**
   * 从播放地址（mp4）里抠作品 ID —— **作者主页弹层的必需兜底**（v2.7.0）
   *
   * 真机实测：主页弹层的封面地址**有时带 `clientCacheKey` 有时不带**（不带时是
   * `...jpg?tag=1-...`），但同一个 slide 里 `<video>` 的地址**一定带**：
   *   `...mp4?tag=...&clientCacheKey=3xe456wj9c4ei86_b.mp4`
   * `_b` 是清晰度变体后缀，`trimVariantSuffix()` 会剥掉。
   * 同一时刻核对过：封面 ID / 视频 ID / 日期三者完全一致。
   */
  function idFromVideoSrc(src, strongOnly) {
    var s = String(src || '');
    var m = /[?&](?:clientCacheKey|Key)=([0-9a-zA-Z_-]{8,40})\.mp4/.exec(s);
    if (m) {
      var id = trimVariantSuffix(m[1]);
      if (id) return id;
    }
    // mp4 文件名本身就是 `<作品ID>_<清晰度>.mp4`，切第一段基本就是真 ID，
    // 但仍归到「弱证据」：优先让位给带 `clientCacheKey` 的那一档。
    if (strongOnly) return '';
    m = /[/=]([0-9a-zA-Z_-]{8,40})\.mp4(?:[?&]|$)/.exec(s);
    return m ? trimVariantSuffix(m[1]) : '';
  }

  /**
   * 从地址里抠发布时间
   *
   * v2.5.84：封面文件名里藏着精确到秒的时间（`KuaishouCoverTime`），
   * 解不出来就自动回落到原来的 `/upic/2026/10/15/` → `2026/10/15`。
   */
  function dateFromSrc(src) {
    try {
      if (typeof KuaishouCoverTime !== 'undefined' && KuaishouCoverTime
        && typeof KuaishouCoverTime.publishDateTimeFromSrc === 'function') {
        var precise = KuaishouCoverTime.publishDateTimeFromSrc(src);
        if (precise) return precise;
      }
    } catch (e) { /* 工具没加载到就走下面的老办法，不影响提取 */ }
    var m = /\/upic\/(\d{4})\/(\d{2})\/(\d{2})\//.exec(String(src || ''));
    return m ? (m[1] + '/' + m[2] + '/' + m[3]) : '';
  }

  /** 一条 slide 里第一个带 `/upic/YYYY/MM/DD/` 的媒体地址对应的日期 */
  function dateFromSlide(slide) {
    var media = safeQueryAll(slide, 'img, video');
    for (var i = 0; i < media.length; i++) {
      var el = media[i];
      var urls = [
        el.getAttribute && el.getAttribute('src'),
        el.getAttribute && el.getAttribute('poster'),
        el.getAttribute && el.getAttribute('style'),
        el.src,
        el.poster
      ];
      for (var j = 0; j < urls.length; j++) {
        var d = dateFromSrc(urls[j]);
        if (d) return d;
      }
    }
    return '';
  }

  /** 一条 slide 里所有 video 的地址（getAttribute 优先，jsdom 也有 currentSrc/src） */
  function videoSrcsOf(slide) {
    var out = [];
    var videos = safeQueryAll(slide, 'video');
    for (var k = 0; k < videos.length; k++) {
      var v = videos[k];
      out.push(v.getAttribute && v.getAttribute('src'));
      out.push(v.currentSrc);
      out.push(v.src);
    }
    return out;
  }

  /**
   * 作品 ID：**强证据 → 强证据 → 弱证据 → 弱证据** → slide 内的作品链接
   *
   * v2.7.0 重排顺序的原因（作者主页弹层逼出来的）：
   *   主页弹层的封面**有时带 `clientCacheKey`、有时不带**。不带的时候封面文件名是
   *   base64 编码的发布时间（`BMjAyNjAzMTUxODE2NTdf...jpg`），走「通用 `.jpg` 兜底」
   *   有可能切出一段 8~25 位字符串**冒充作品 ID** —— 那会拼出打不开的地址，比空更糟。
   *   而同一个 slide 里的 `<video>` 地址**一定带** `clientCacheKey`（实测
   *   `...mp4?tag=...&clientCacheKey=3xe456wj9c4ei86_b.mp4`），是可信的强证据。
   *   所以顺序改成：封面强 → 视频强 → 封面弱 → 视频弱 → 链接。
   *   两边都权威时会先命中封面，**与 v2.5.82 的结果完全一致**（真机逐条比对过）。
   */
  function idFromSlide(slide) {
    var cover = safeQuery(slide, SEL.cover) || safeQuery(slide, 'img');
    var coverSrc = cover
      ? ((cover.getAttribute && cover.getAttribute('src')) || cover.src || '')
      : '';

    // ① 封面里的 clientCacheKey（最权威）
    var coverStrong = idFromCoverSrc(coverSrc, true);
    if (coverStrong) return coverStrong;

    // ② 播放地址里的 clientCacheKey（主页弹层唯一可靠的来源）
    var vurls = videoSrcsOf(slide);
    var i;
    for (i = 0; i < vurls.length; i++) {
      var videoStrong = idFromVideoSrc(vurls[i], true);
      if (videoStrong) return videoStrong;
    }

    // ③ 封面的通用 `.jpg` 兜底（弱证据，只在没有强证据时才用）
    var coverWeak = idFromCoverSrc(coverSrc);
    if (coverWeak) return coverWeak;

    // ④ 播放地址的通用 `.mp4` 兜底（`<id>_<清晰度>.mp4`，基本可信）
    for (i = 0; i < vurls.length; i++) {
      var videoWeak = idFromVideoSrc(vurls[i]);
      if (videoWeak) return videoWeak;
    }

    var a = safeQuery(slide, 'a[href*="/short-video/"]');
    if (a) {
      var href = String(a.getAttribute('href') || '');
      var m = /\/short-video\/([0-9a-zA-Z_-]{8,40})/.exec(href);
      if (m && ID_RE.test(m[1])) return m[1];
    }
    return '';
  }

  /** 昵称：`@黑蛇` → `黑蛇`（详情页那套输出不带 @，两边必须一致） */
  function cleanNickname(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().replace(/^@+/, '').trim();
  }

  /** 作者主页：`a.name` 的 href，协议相对/站内路径都补成完整地址 */
  function homepageFromSlide(slide) {
    var a = safeQuery(slide, SEL.name);
    var href = a ? String(a.getAttribute('href') || '') : '';
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('//') === 0) return 'https:' + href;
    return 'https://www.kuaishou.com' + (href.charAt(0) === '/' ? href : '/' + href);
  }

  /**
   * 文案：`.caption` 的文字（含 #话题；与详情页 `.video-info-title` 同源）
   *
   * 为什么不用 textContent 直接拼：话题标签是 `<a class="tag">`，紧挨着文案，
   * `textContent` 会把「不为过」和「#菊花台」粘成「不为过#菊花台」，
   * 而详情页里是「不为过 #菊花台」（有空格）—— 同一作品两个入口就不同了。
   * 这里逐个子节点拼，元素节点两侧补空格，再压掉多余空白。
   */
  function captionFromSlide(slide) {
    var el = safeQuery(slide, SEL.caption);
    if (!el) return '';
    var parts = [];
    var nodes = el.childNodes || [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) {
        parts.push(n.nodeValue || '');
      } else if (n.nodeType === 1) {
        parts.push(' ' + (n.textContent || '') + ' ');
      }
    }
    var t = parts.join('').replace(/\s+/g, ' ').trim();
    if (!t) t = textOf(el);
    // 尾部「展开 / 收起」是按钮文字，不是文案本身
    return t.replace(/\s*(?:展开|收起)\s*$/, '').trim();
  }

  /**
   * 把一条 `.swiper-slide-active` 解析成「当前这一条」。
   * 认不出（没有作品 ID）就返回 null（**宁空不错**）。
   *
   * @param {Element} slide 当前这一条
   * @param {string} [mode] `immersive`（推荐流）｜`popup`（页内播放弹层：搜索页 / 作者主页）
   */
  function slideContext(slide, mode) {
    if (!slide) return null;
    var id = idFromSlide(slide);
    if (!id) return null;
    return {
      id: id,
      scope: slide,
      mode: mode || 'immersive',
      nickname: cleanNickname(textOf(safeQuery(slide, SEL.name))),
      homepage: homepageFromSlide(slide),
      caption: captionFromSlide(slide),
      date: dateFromSlide(slide)
    };
  }

  /** 页内播放弹层的根节点（搜索页 / 作者主页；关着时返回 null —— 真机确认没有常驻空壳） */
  function popupRoot(doc) {
    var d = doc || global.document;
    if (!d) return null;
    return safeQuery(d, SEL.popRoot) || null;
  }

  /**
   * 在一个作用域里挑出「唯一那条当前播放的」。
   *
   * 推荐流传 `root = document`（全页），弹层传 `root = .player-pop`。
   * 逻辑与 v2.5.82 完全一致，只是把「在哪找」参数化了。
   */
  function pickFromRoot(root, d, mode) {
    var acts = safeQueryAll(root, SEL.active);
    if (!acts.length) return null;

    // 先只留「有版面」的节点：预加载的下一条也是 slide，但高度为 0
    var visible = [];
    for (var k = 0; k < acts.length; k++) {
      if (hasGeometry(acts[k])) visible.push(acts[k]);
    }
    // 一个都没有版面（jsdom / 刚渲染还没布局）→ 退回全部候选
    // 例外：整页明明有版面、候选却全 0×0 —— 那是切换瞬间的残影，按「认不出」处理，
    // 不拿看不见的节点当锚点（按钮会贴到屏幕外）。
    var pool = visible.length ? visible : (hasPageLayout(d) ? [] : acts);

    var picked = null;
    for (var i = 0; i < pool.length; i++) {
      var cand = slideContext(pool[i], mode);
      if (!cand) continue;
      // 同时有两条都像「当前」→ 认不出，宁可不出按钮也不猜
      if (picked) return null;
      picked = cand;
    }
    return picked;
  }

  /**
   * 页内播放态的上下文。认不出来 / 不在播放态，一律返回 null。
   *
   * 顺序很重要（v2.5.88）：**先弹层，后推荐流**。
   * 弹层（搜索页 / 作者主页）一旦被认出来就直接返回；弹层开着但这一瞬间认不出（刚打开还没渲染 /
   * 切条那一帧）也要**立刻返回 null**，绝不能往下走推荐流那套全页查询 ——
   * 搜索列表页自己的 slide 会被当成「当前播放的」认错。
   */
  function immersiveContext(doc) {
    var d = doc || global.document;
    if (!d) return null;

    // ① 页内播放弹层态（搜索页 / 作者主页）
    var pop = popupRoot(d);
    if (pop) {
      var pc = pickFromRoot(pop, d, 'popup');
      if (pc) return pc;
      return null;
    }

    // ② 推荐流态
    if (!isImmersivePage()) return null;
    return pickFromRoot(d, d, 'immersive');
  }

  /** 这个页面「可能会有页内播放态」（决定要不要挂监听，不决定出不出按钮） */
  function shouldWatch(url) {
    return isImmersivePage(url) || isPopupPage(url);
  }

  /** 现在是不是在推荐流里播（认出了当前这一条） */
  function isOpen(doc) {
    return !!immersiveContext(doc);
  }

  /** 当前作品 ID（认不出返回空串） */
  function getWorkId(doc) {
    var ctx = immersiveContext(doc);
    return ctx ? ctx.id : '';
  }

  /** 当前这一条的根节点（所有字段查询都该在它内部进行） */
  function getRoot(doc) {
    var ctx = immersiveContext(doc);
    return ctx ? ctx.scope : null;
  }

  /**
   * 订阅「切到下一条 / 离开推荐流」
   *
   * 快手切条**只改 class**（`.swiper-slide-active` 从 A 挪到 B），不会重建节点，
   * 所以 MutationObserver 必须同时监听 `attributes`（attributeFilter: class）——
   * 只盯 childList 会一次都收不到（这是与抖音最大的实现差异）。
   *
   * 签名四种值，与抖音同构：
   *   `immersive|<作品ID>`  推荐流里认出了当前这一条
   *   `popup|<作品ID>`      页内播放弹层（搜索页 / 作者主页）里认出了当前这一条
   *   `pending`             **还在播放态里，但这一瞬间认不出**（不回调，保持现状）
   *   `closed`              **确实不在播放态里了**（撤按钮 + 关浮窗）
   *
   * 弹层能接住，靠的是下面这个 observer 已经监听了 `childList + subtree`：
   * `.player-pop` 被插入 / 移除都是 childList 变化，不需要额外挂监听。
   *
   * @param {Function} cb 收到 {id, opened, mode}
   * @param {{debounceMs?:number, pendingMs?:number}} [options]
   * @returns {Function} 停止监听
   */
  function watch(cb, options) {
    var opts = options || {};
    var debounceMs = opts.debounceMs || 320;
    var d = global.document;
    if (!d) return function () {};

    var lastSig = null;
    var timer = null;
    var pendingTimer = null;
    var stopped = false;
    var pendingMs = typeof opts.pendingMs === 'number' ? opts.pendingMs : 3500;

    /**
     * 四种值：
     *   `immersive|<作品ID>` 推荐流里认出了当前这一条
     *   `popup|<作品ID>`     页内播放弹层（搜索页 / 作者主页）里认出了当前这一条
     *   `pending`            **还在播放态里，但这一瞬间认不出**（不回调，保持现状）
     *   `closed`             **确实不在播放态了**（撤按钮 + 关浮窗）
     */
    function signature() {
      var ctx = immersiveContext(d);
      // 认出来：带上是哪种态，下游靠它决定按钮锚点标记 / 日志口径
      if (ctx) return ctx.mode + '|' + ctx.id;
      // 这一瞬间认不出，分两种情况：
      //   `.player-pop` 还在 → 弹层开着，只是这一帧没认出来（刚打开 / 切条那一帧）
      //   还在 `/new-reco`   → 推荐流页同理
      // 两种都当作「保持现状」，免得按钮闪一下又回来；关弹层时 `.player-pop` 会整个
      // 从 DOM 里移除（真机确认不是常驻空壳），所以「关掉」永远走 closed 立刻撤。
      if (popupRoot(d)) return 'pending';
      if (isImmersivePage()) return 'pending';
      return 'closed';
    }

    function notifyClosed() {
      if (lastSig === 'closed') return;
      lastSig = 'closed';
      try {
        cb({ id: '', opened: false, mode: '' });
      } catch (e) { /* 回调异常不许打断监听 */ }
    }

    /** `popup|3xabc` → { mode:'popup', id:'3xabc' }；`closed` → { mode:'', id:'' } */
    function splitSig(sig) {
      var bar = String(sig || '').indexOf('|');
      if (bar < 0) return { mode: '', id: '' };
      return { mode: sig.slice(0, bar), id: sig.slice(bar + 1) };
    }

    function emit() {
      timer = null;
      if (stopped) return;
      var sig = signature();

      if (sig === 'pending') {
        // 这一瞬间认不出：什么都不做，按钮与浮窗保持现状。
        // 只挂兜底计时器，防止「内容真没了但地址栏还在 /new-reco」时按钮僵住。
        if (!pendingTimer) {
          pendingTimer = setTimeout(function () {
            pendingTimer = null;
            if (stopped) return;
            if (signature() === 'pending') notifyClosed();
            else schedule();
          }, pendingMs);
        }
        return;
      }

      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }

      if (sig === lastSig) return;
      lastSig = sig;
      var closed = sig === 'closed';
      var parsed = closed ? { mode: '', id: '' } : splitSig(sig);
      try {
        cb({ id: parsed.id, opened: !closed, mode: parsed.mode });
      } catch (e) { /* 回调异常不许打断监听 */ }
    }

    function schedule() {
      if (stopped || timer) return;
      timer = setTimeout(emit, debounceMs);
    }

    var observer = null;
    if (typeof global.MutationObserver === 'function') {
      observer = new global.MutationObserver(schedule);
      // attributes 必须开：快手切条只挪 class，不重建节点
      try {
        observer.observe(d.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['class', 'style', 'src']
        });
      } catch (e) {
        observer.observe(d.body, { childList: true, subtree: true });
      }
    }

    // swiper 切条是动画（~300ms），class 立刻变但布局稍后到位 → 动画结束后再补算一次
    var settleTimer = null;
    function scheduleSettle() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        settleTimer = null;
        schedule();
      }, 420);
    }
    global.addEventListener('transitionend', scheduleSettle, true);

    var origPush = global.history && global.history.pushState;
    var origReplace = global.history && global.history.replaceState;
    if (origPush && origReplace) {
      global.history.pushState = function () {
        var r = origPush.apply(this, arguments);
        schedule();
        return r;
      };
      global.history.replaceState = function () {
        var r = origReplace.apply(this, arguments);
        schedule();
        return r;
      };
    }
    global.addEventListener('popstate', schedule);

    // 初始状态先算一次
    lastSig = signature();
    if (lastSig !== 'pending') {
      var initOpen = lastSig !== 'closed';
      var initParsed = initOpen ? splitSig(lastSig) : { mode: '', id: '' };
      cb({ id: initParsed.id, opened: initOpen, mode: initParsed.mode });
    }

    return function stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
      if (observer) observer.disconnect();
      if (origPush) global.history.pushState = origPush;
      if (origReplace) global.history.replaceState = origReplace;
      global.removeEventListener('popstate', schedule);
      global.removeEventListener('transitionend', scheduleSettle, true);
    };
  }

  var api = {
    SEL: SEL,
    IMMERSIVE_PATHS: IMMERSIVE_PATHS,
    POPUP_PATH_PREFIXES: POPUP_PATH_PREFIXES,
    isImmersivePage: isImmersivePage,
    isPopupPage: isPopupPage,
    shouldWatch: shouldWatch,
    popupRoot: popupRoot,
    hasGeometry: hasGeometry,
    hasPageLayout: hasPageLayout,
    idFromCoverSrc: idFromCoverSrc,
    idFromVideoSrc: idFromVideoSrc,
    dateFromSrc: dateFromSrc,
    cleanNickname: cleanNickname,
    slideContext: slideContext,
    immersiveContext: immersiveContext,
    isOpen: isOpen,
    getWorkId: getWorkId,
    getRoot: getRoot,
    textOf: textOf,
    watch: watch
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KuaishouImmersiveContext = api;
})(typeof window !== 'undefined' ? window : null);
