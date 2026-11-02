/**
 * 抖音「正在播放哪一条」状态识别器（只在内容脚本的隔离环境里跑，不注入页面）
 *
 * 两种场景共用本模块（v2.5.80 起）：
 *   A. **弹窗播放**：在精选 / 搜索 / 用户主页 / 话题 等页面点开作品时，**地址不跳转**，
 *      只在当前页弹出一个播放浮层，地址栏挂上 `?modal_id=<作品ID>`。
 *   B. **沉浸流**：推荐 `/?recommend=1`、关注 `/follow`、朋友 `/friend` 三页是「整屏只播一条」，
 *      地址栏一直不变（点↓/滚轮切下一条也不变），当前这一条靠
 *      `<div data-e2e="feed-active-video" class="... video_<作品ID> ...">` 认。
 *
 * 本模块回答三个问题：**现在有没有可提的内容？是哪一条？数据在哪个节点里？**
 *
 * 为什么要单独一个模块（而不是各处 querySelector）
 * ------------------------------------------------
 * 实测（v2.5.77 批 -1 / 批 0）弹窗页里同时挂着**多条**作品的 DOM：
 *   - `/search` 弹窗存档：2 个 `[data-e2e="video-info"]`、2 个 `feed-active-video`
 *   - `/user` 弹窗、点击作者头像后：一次挂着 19 份作品数据
 *   - `/jingxuan` 图文弹窗：`feed-active-video` 指向的是**背景信息流里的另一条**
 * 所以 `document.querySelector('[data-e2e="video-info"]')` 拿到的很可能是**别人的数据**。
 *
 * 唯一可靠的判据是「这一条的容器 class 里带 `video_<awemeId>`」，
 * 也就是 `<div data-e2e="feed-video" class="... video_7672265848853220618 slide">`。
 * 本模块把它和地址栏 `modal_id` 对账后返回，**对不上就返回 null，绝不拿别人的数据凑字段**。
 *
 * 依赖：无（只用标准 DOM API / URL）
 */
(function (global) {
  'use strict';

  var SEL = {
    feed: '[data-e2e="feed-video"], [data-e2e="feed-active-video"]',
    /** 沉浸流里「正在播的那一条」（真机实测三页都恰好 1 个） */
    active: '[data-e2e="feed-active-video"]',
    item: '[data-e2e="feed-item"]',
    container: '[data-e2e="modal-video-container"]',
    info: '[data-e2e="video-info"]',
    desc: '[data-e2e="video-desc"]',
    nickname: '[data-e2e="feed-video-nickname"]',
    avatar: 'a[data-e2e="video-avatar"]'
  };

  var ID_RE = /^\d{6,25}$/;

  /**
   * 沉浸流页面白名单（pathname 精确匹配）
   *
   * 只认真机实测过的这三个，**宁可少认不要错认**：
   * 认错了会在瀑布流 / 搜索 / 主页上凭空冒出按钮，比不出按钮糟得多。
   * - `/`          → 推荐（导航链接是 `/?recommend=1`，pathname 就是 `/`）
   * - `/follow`    → 关注
   * - `/friend`    → 朋友
   * `/jingxuan`（精选）故意**不**在里面：那是瀑布流，点开视频走弹窗，已由弹窗那套支持。
   */
  var IMMERSIVE_PATHS = { '/': 1, '/follow': 1, '/friend': 1 };


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
   * v2.5.81 起用它把「切走那一页留下的残影」排除掉：抖音切顶部标签时
   * **不销毁**上一个标签的轮播节点，只是把它缩成 0×0（父级 `dySwiperSlide`
   * 不参与布局，`offsetParent` 为 null）。真机实测（2026-10-27）：
   *   切到 /follow 时 → 推荐留下的那条 0×0、关注当前的这条 597×809；
   *   切到 /friend 时 → 关注留下的那条 0×0、朋友当前的这条 805×809。
   * 每页「有版面」的永远恰好 1 个，所以按版面过滤是最干净的判据。
   *
   * 注意：jsdom 里 `getBoundingClientRect()` 恒为 0×0，所以调用方必须
   * 「一个都没有版面时退回全部候选」，否则单测与「刚渲染还没布局」都会瞎。
   */
  function hasGeometry(el) {
    try {
      var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!(r && r.width > 0 && r.height > 0);
    } catch (e) {
      return false;
    }
  }

  /**
   * 整页到底有没有版面？
   *
   * 用来区分「候选全 0×0」的两种成因：
   *   A. jsdom 单测 / 页面还没起来 —— 整页也 0（`body.scrollHeight` 为 0）
   *   B. 真机上换页瞬间只剩上一页的残影 —— 整页明显有版面，只有候选是 0×0
   *
   * jsdom 里 `scrollHeight` 恒为 0，正好当环境判据用，不必引入额外依赖。
   */
  function hasPageLayout(d) {
    try {
      var b = (d || global.document).body;
      if (!b) return false;
      return !!(b.scrollHeight > 0 || b.scrollWidth > 0);
    } catch (e) {
      return false;
    }
  }

  /** 从地址栏取 modal_id（不合法就当没有） */
  function modalIdFromUrl(url) {
    try {
      var href = url || (global.location && global.location.href) || '';
      var u = new URL(href, 'https://www.douyin.com/');
      var v = u.searchParams.get('modal_id');
      return v && ID_RE.test(v) ? v : '';
    } catch (e) {
      return '';
    }
  }

  /** class 里是否带 `video_<id>`（这条判据比 data-e2e 精确得多） */
  function hasVideoClass(el, id) {
    if (!el || !id) return false;
    var cls = el.className;
    if (typeof cls !== 'string') return false;
    return (' ' + cls + ' ').indexOf(' video_' + id + ' ') >= 0;
  }

  /**
   * 按 `class="video_<id>"` 找本条容器
   *
   * ⚠️ 实测坑（批 2）：搜索页里同一个 `video_7672265848853220618` 会出现在**两个**节点上——
   * 一个是侧栏推荐卡片（class 里同样带 `side-card-typography-scope`，里面**没有任何内容**），
   * 另一个才是真正的弹窗条。所以 class 命中后必须再校验「里面确实有这一条的内容」，
   * 否则会拿到一个空壳，7 个字段全空。
   */
  function scopeByClassId(doc, id) {
    if (!id) return null;
    var feeds = safeQueryAll(doc, SEL.feed);
    var fallback = null;
    for (var i = 0; i < feeds.length; i++) {
      if (!hasVideoClass(feeds[i], id)) continue;
      if (safeQuery(feeds[i], SEL.info) || safeQuery(feeds[i], SEL.desc)) return feeds[i];
      if (!fallback) fallback = feeds[i];
    }
    return fallback;
  }

  function scopeByInfoId(doc, id) {
    if (!id) return null;
    var infos = safeQueryAll(doc, SEL.info);
    for (var i = 0; i < infos.length; i++) {
      if (infos[i].getAttribute('data-e2e-aweme-id') === id) {
        var up = infos[i].closest ? infos[i].closest(SEL.feed + ', ' + SEL.item) : null;
        return up || infos[i].parentElement || infos[i];
      }
    }
    return null;
  }

  // ===================== 沉浸流（推荐 / 关注 / 朋友） =====================

  /**
   * 现在这个地址是不是沉浸流页？
   * @param {string} [url] 不传就用 location.href
   */
  function isImmersivePage(url) {
    try {
      var href = url || (global.location && global.location.href) || '';
      var u = new URL(href, 'https://www.douyin.com/');
      if (u.hostname !== 'www.douyin.com') return false;
      return IMMERSIVE_PATHS[u.pathname] === 1;
    } catch (e) {
      return false;
    }
  }

  /** 从 class 里抠作品 ID（`... video_7700492021308901361 sliderVideo ...`） */
  function idFromClass(el) {
    if (!el) return '';
    var cls = el.className;
    if (typeof cls !== 'string') return '';
    var m = /(?:^|\s)video_(\d{6,25})(?:\s|$)/.exec(cls);
    return m && ID_RE.test(m[1]) ? m[1] : '';
  }

  /**
   * 弹层是不是真的「立起来了」。
   *
   * 只有容器元素不算 —— 抖音页面里 `modal-video-container` 常驻但平时是空的，
   * 必须里面已经有文案，才算用户真的点开了一条。
   * 这条判据同时被 isOpen / resolve 使用，保证「弹窗优先」不会误判。
   */
  function hasModalLayer(doc) {
    var d = doc || global.document;
    if (!d) return false;
    var container = safeQuery(d, SEL.container);
    if (!container) return false;
    return !!textOf(safeQuery(container, SEL.desc));
  }

  /**
   * 把一个 `feed-active-video` 解析成「当前这一条」。
   * 不像「正在播的那一条」就返回 null（**宁空不错**）。
   */
  function immersiveScope(act) {
    if (!act) return null;

    var classId = idFromClass(act);

    // 信息区可能不止一个（实测关注页整页 2 个，但「本条容器内」只有 1 个）。
    // 优先取 ID 与 class 对得上的那个；只有一个就用它。
    var infos = safeQueryAll(act, SEL.info);
    var info = null;
    var i;
    if (classId) {
      for (i = 0; i < infos.length; i++) {
        if (String(infos[i].getAttribute('data-e2e-aweme-id') || '') === classId) { info = infos[i]; break; }
      }
    }
    if (!info && infos.length === 1) info = infos[0];
    // 切条中间态常出现「容器在、信息区还没挂上」——这时宁可不出按钮，等下一次通知
    if (!info) return null;

    var infoId = String(info.getAttribute('data-e2e-aweme-id') || '');

    // class 与信息区都有 ID 却对不上 = 页面正在切换（一个已更新、一个还没），
    // 内容与 ID 会来自两条作品，绝不能凑。真机连切 5 条验证过：稳定态永远相等。
    if (classId && infoId && classId !== infoId) return null;

    var id = infoId || classId;
    if (!id) return null;

    // 「有内容」校验：同一个 `video_<id>` 也会挂在侧栏推荐空壳上（弹窗批 2 踩过），
    // 空壳里既没有信息区文字也没有文案，直接排除。
    if (!textOf(info) && !textOf(safeQuery(act, SEL.desc))) return null;

    return { id: id, scope: act, info: info, mode: 'immersive' };
  }

  /**
   * 沉浸流当前这一条的上下文。不是沉浸流页、或认不出来，一律返回 null。
   *
   * 弹窗永远优先：地址栏挂了 `modal_id`、或弹层真的立起来了，就交回弹窗逻辑。
   * （实测在推荐页点开某条视频会走弹窗，这时必须先听弹窗的。）
   */
  function immersiveContext(doc) {
    var d = doc || global.document;
    if (!d) return null;
    if (!isImmersivePage()) return null;
    if (modalIdFromUrl()) return null;
    if (hasModalLayer(d)) return null;

    var acts = safeQueryAll(d, SEL.active);
    if (!acts.length) return null;

    // 先只留「有版面」的节点：切标签时上一页的轮播节点不销毁，只是缩成 0×0，
    // 不过滤就会被当成第二个候选 → 判「认不出」→ 按钮永久消失（v2.5.81 修的就是这个）。
    var visible = [];
    for (var k = 0; k < acts.length; k++) {
      if (hasGeometry(acts[k])) visible.push(acts[k]);
    }
    // 一个都没有版面（jsdom 单测 / 刚渲染还没布局）→ 退回全部候选，行为和以前完全一致
    // 例外：整页明明有版面，只有候选全 0×0 —— 那是换页瞬间只剩上一页残影，
    // 这时不许拿残影当锚点（按钮会贴在一个看不见的 0×0 节点上闪一下），按「认不出」处理。
    var pool = visible.length ? visible : (hasPageLayout(d) ? [] : acts);

    var picked = null;
    for (var i = 0; i < pool.length; i++) {
      var cand = immersiveScope(pool[i]);
      if (!cand) continue;
      // 同时有两条都像「当前」→ 认不出，宁可不出按钮也不猜
      if (picked) return null;
      picked = cand;
    }
    return picked;
  }

  /** 当前是哪种播放态：`'modal'` / `'immersive'` / `''`（都没有） */
  function playbackMode(doc) {
    var d = doc || global.document;
    if (!d) return '';
    if (modalIdFromUrl() || hasModalLayer(d)) return 'modal';
    if (immersiveContext(d)) return 'immersive';
    return '';
  }

  /**
   * 现在是不是在弹窗里？两个信号任一成立就算（一个坏了另一个兜住）：
   *   A. 地址栏有 modal_id
   *   B. 页面里有 modal-video-container，且里面 video-desc 有文字
   * v2.5.80 起再加第三种：**沉浸流页认出了当前这一条**。
   */
  function isOpen(doc) {
    var d = doc || global.document;
    if (!d) return false;
    if (modalIdFromUrl()) return true;
    if (hasModalLayer(d)) return true;
    return !!immersiveContext(d);
  }

  /**
   * 解析当前播放的上下文。
   *
   * @returns {{id: string, scope: Element, info: Element|null}|null}
   *   id    —— 作品 ID（沉浸流取 class / 信息区的 ID；弹窗态地址栏 modal_id 优先）
   *   scope —— 「这一条」的容器（后面所有查询都限定在它内部）
   *   info  —— 带文字的那块（昵称 / 日期 / 文案都在里面）
   * 认不出来时返回 null（**不猜**）。
   */
  function resolve(doc) {
    var d = doc || global.document;
    if (!d) return null;

    var urlId = modalIdFromUrl();

    // 沉浸流：没有 modal_id、弹层也没立起来时，才走这条路 —— **弹窗永远优先**。
    // 注意这里不能回落到下面的弹窗逻辑：沉浸流页里 container 可能是常驻空壳。
    if (!urlId && !hasModalLayer(d)) {
      return immersiveContext(d);
    }

    var scope = scopeByClassId(d, urlId) || scopeByInfoId(d, urlId);
    if (!scope) scope = safeQuery(d, SEL.container);
    if (!scope) return null;

    var info = urlId
      ? safeQuery(scope, SEL.info + '[data-e2e-aweme-id="' + urlId + '"]')
      : null;
    if (!info) info = safeQuery(scope, SEL.info);

    var infoId = info ? String(info.getAttribute('data-e2e-aweme-id') || '') : '';

    // 对账：地址栏说 A，页面节点说 B → 这个 scope 不是当前那一条，绝不能拿它凑字段
    if (urlId && infoId && urlId !== infoId) {
      var alt = scopeByClassId(d, infoId) || scopeByInfoId(d, infoId);
      if (alt && alt !== scope) {
        scope = alt;
        info = safeQuery(scope, SEL.info) || info;
        infoId = String(info.getAttribute('data-e2e-aweme-id') || '');
      }
      if (urlId !== infoId) return null;
    }

    var id = urlId || infoId;
    if (!id) return null;

    return { id: id, scope: scope, info: info, mode: 'modal' };
  }

  /** 当前作品 ID（对不上就返回空串） */
  function getWorkId(doc) {
    var ctx = resolve(doc);
    return ctx ? ctx.id : '';
  }

  /**
   * 当前这一条的根节点（所有字段查询都该在它内部进行）
   * @returns {Element|null}
   */
  function getRoot(doc) {
    var ctx = resolve(doc);
    return ctx ? ctx.scope : null;
  }

  /**
   * 从「弹窗里那行时间文字」的位置抠出时间片段
   * 实测形态：`@杰诺探美食· 8月11日980秒静静欣赏…`、`@抖音作者助手认证徽章· 2025年6月16日图文…`
   * 做法：先把昵称文字从整行里切掉，再从剩下的开头取 `·` 后面那段，避免昵称里的点号干扰。
   *
   * @param {Element|null} info
   * @returns {string} 形如 `· 8月11日980秒…`（解析交给 aweme-id-date.js）
   */
  function extractDateSegment(info) {
    if (!info) return '';
    var whole = textOf(info);
    if (!whole) return '';
    var nick = textOf(safeQuery(info, SEL.nickname));
    if (nick) {
      var idx = whole.indexOf(nick);
      if (idx >= 0) whole = whole.slice(idx + nick.length);
    }
    return whole;
  }

  /** 这个容器里第一个作者头像链接（`//www.douyin.com/user/xxx` 协议相对，原样返回） */
  function extractAvatarHref(scope) {
    var a = safeQuery(scope, SEL.avatar);
    return a ? String(a.getAttribute('href') || '') : '';
  }

  /**
   * 订阅「弹窗开了 / 换了另一条 / 关了」
   *
   * 只做两件事：MutationObserver（DOM 变了）+ history 包装（pushState/replaceState/popstate）。
   * 去重靠「身份签名」，内容抖动（评论滚动、点赞数变化）不会误触发。
   *
   * v2.5.81 起签名多一个 `pending`（认不出但还在播放态）：这种状态**不回调**，
   * 上层因此不会撤按钮、不会关浮窗。真正 `closed` 才回调 `opened:false`。
   *
   * @param {Function} cb 收到 {id, opened, mode}，opened=false 表示确实离开了播放态
   * @param {{debounceMs?:number, pendingMs?:number}} [options]
   *   pendingMs —— 「认不出」最多忍多久，超时按 closed 处理（默认 3500ms）
   * @returns {Function} 停止监听
   */
  function watch(cb, options) {
    var opts = options || {};
    var debounceMs = opts.debounceMs || 300;
    var d = global.document;
    if (!d) return function () {};

    var lastSig = null;
    var timer = null;
    var pendingTimer = null;
    var stopped = false;
    /** 「认不出」最多容忍多久（毫秒）。超时还认不出 → 按真的没了处理 */
    var pendingMs = typeof opts.pendingMs === 'number' ? opts.pendingMs : 3500;

    /**
     * 身份签名 —— 变了才回调。四种值：
     *
     *   `modal|<modal_id>|<节点ID>`   弹窗态（节点 ID 可能还在路上）
     *   `immersive|<作品ID>`          沉浸流且认出了当前这一条
     *   `pending`                     **还在播放态，但这一瞬间认不出**
     *   `closed`                      **确实离开了播放态**（不在沉浸流页、也没有弹层）
     *
     * v2.5.81 为什么要分出 `pending`：
     * 真机实测（2026-10-27）关注页连按 ↓ 切条时，会有约 0.9 秒「有版面的
     * feed-active-video 为 0 个」的空窗（推荐页 / 朋友页没有）。以前这个空窗
     * 会被当成 `closed` → 撤按钮 + **把已打开的浮窗关掉**，用户切条切到一半
     * 浮窗就没了。现在 `pending` 一律不回调，等下一次 DOM 变化再算。
     */
    function signature() {
      // ① 弹窗态优先：地址栏有 modal_id，或弹层真的立起来了（容器里已有文案）
      var urlId = modalIdFromUrl();
      if (urlId || hasModalLayer(d)) {
        var scope = scopeByClassId(d, urlId) || safeQuery(d, SEL.container);
        var info = scope ? safeQuery(scope, SEL.info) : null;
        var infoId = info ? String(info.getAttribute('data-e2e-aweme-id') || '') : '';
        return 'modal|' + urlId + '|' + infoId;
      }
      // ② 沉浸流页：认不出只是「等一下」，不是「没了」
      if (isImmersivePage()) {
        var im = immersiveContext(d);
        return im ? 'immersive|' + im.id : 'pending';
      }
      // ③ 不在播放态
      return 'closed';
    }

    function notifyClosed() {
      if (lastSig === 'closed') return;
      lastSig = 'closed';
      try {
        cb({ id: '', opened: false, mode: '' });
      } catch (e) { /* 回调异常不许打断监听 */ }
    }

    function emit() {
      timer = null;
      if (stopped) return;
      var sig = signature();

      if (sig === 'pending') {
        // 这一瞬间认不出：**什么都不做**，按钮与浮窗保持现状。
        // 只挂一个兜底计时器，防止「内容真的没了但地址栏还停在沉浸流页」时按钮僵住。
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
      try {
        // mode 让上层知道「这一条是弹窗里的还是沉浸流里的」，两个功能各有独立开关
        cb({ id: closed ? '' : getWorkId(d), opened: !closed, mode: closed ? '' : playbackMode(d) });
      } catch (e) { /* 回调异常不许打断监听 */ }
    }

    function schedule() {
      if (stopped || timer) return;
      timer = setTimeout(emit, debounceMs);
    }

    var observer = null;
    if (typeof global.MutationObserver === 'function') {
      observer = new global.MutationObserver(schedule);
      observer.observe(d.body, { childList: true, subtree: true });
    }

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

    // 初始状态先算一次，避免「页面加载完时弹窗已经开着」漏掉。
    // 初始就是 pending（沉浸流页还没渲染完）时**不回调**：从没接管过，
    // 上层本来就不该有按钮，等 DOM 变化自然会认出来。
    lastSig = signature();
    var openNow = isOpen(d);
    if (openNow) {
      cb({ id: getWorkId(d), opened: true, mode: playbackMode(d) });
    } else if (lastSig === 'closed') {
      cb({ id: '', opened: false, mode: '' });
    }

    return function stop() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (observer) observer.disconnect();
      if (origPush) global.history.pushState = origPush;
      if (origReplace) global.history.replaceState = origReplace;
      global.removeEventListener('popstate', schedule);
    };
  }

  var api = {
    SEL: SEL,
    IMMERSIVE_PATHS: IMMERSIVE_PATHS,
    modalIdFromUrl: modalIdFromUrl,
    isImmersivePage: isImmersivePage,
    hasModalLayer: hasModalLayer,
    hasGeometry: hasGeometry,
    hasPageLayout: hasPageLayout,
    immersiveContext: immersiveContext,
    playbackMode: playbackMode,
    isOpen: isOpen,
    resolve: resolve,
    getRoot: getRoot,
    getWorkId: getWorkId,
    extractDateSegment: extractDateSegment,
    extractAvatarHref: extractAvatarHref,
    textOf: textOf,
    watch: watch
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.DouyinModalContext = api;
})(typeof window !== 'undefined' ? window : null);
