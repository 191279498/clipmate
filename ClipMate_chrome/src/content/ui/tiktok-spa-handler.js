/**
 * TikTok 作品页「换条跟随」（TikTokSpaMixin）
 *
 * 负责一件事：**在作品页里切到下一条之后，让提取结果跟着变**。
 *
 * 背景（2026-10-29 真机勘察）：
 *   · TikTok 作品页 `/@user/video/<id>` 切条时地址会变（可以按 ↓，也可以点右侧列表）；
 *   · 但页面里那块首屏数据（`__UNIVERSAL_DATA_FOR_REHYDRATION__`）**不更新**，
 *     切条也不发任何作品接口 → 新数据只存在于页面内部状态里，要靠主世界扫描抄出来
 *     （`tiktok-fiber-hook.js`，且新数据不是立刻就绪，需要 0/250/700/1500ms 补位）。
 *   · 因此这里要做三件事：更新缓存键、催主世界重扫、浮窗开着就就地刷新。
 *
 * 三条结构保证（照抖音 DouyinSpaMixin 的规矩）：
 *   - 域名门禁：不是 tiktok.com 就直接返回，其他 30 多个站点连一个定时器都不会多。
 *   - 只认「作品页 / 个人主页」这两类地址（v2.5.96 起主页也算），别的页面什么都不做。
 *   - 拿不到新数据也不破坏现状：刷新失败最多重试 3 次，之后保持原样。
 *
 * 为什么用「轮询比地址」而不是包 history.pushState：
 *   隔离世界收不到页面自己的 pushState（快手 v2.5.86 踩过），只能比地址 + 听 popstate。
 */
(function (global) {
  'use strict';

  /** 地址轮询间隔（ms）：跟主世界的 700ms 对齐，切条后一拍内就能反应 */
  var POLL_MS = 700;

  /**
   * 推荐流的换条检查间隔（ms）
   *
   * 推荐流换条**地址一个字都不变**，只能看「主世界抄出来的当前条 ID」变没变。
   * 主世界 250ms 写一次桥节点，这里也用 250ms 跟它对齐 —— 实测从滚动到发现变化 323ms。
   * 单次开销是「读一个 DOM 节点 + 解析 2KB JSON」，可以忽略。
   */
  var FYP_POLL_MS = 250;

  /** 贴位内缩（px），跟抖音沉浸流同一个数 */
  var ANCHOR_INSET = 16;
  var FALLBACK_BUTTON_WIDTH = 96;
  var FALLBACK_BUTTON_HEIGHT = 40;

  global.TikTokSpaMixin = {

    // ===================== 一、入口 =====================

    /**
     * 启动换条跟随。由 content-main 的 init 末尾调用（只在 tiktok.com 上生效）。
     * @returns {boolean} true = 已启动
     */
    _startTikTokSpa() {
      if (this._tkSpaStarted) return true;
      try {
        var host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : '';
        if (host.indexOf('tiktok.com') < 0) return false;
      } catch (e) { return false; }

      this._tkSpaStarted = true;
      // v2.5.100：进页面先按路由定一次按钮显隐（探索页这类列表页不该出按钮）。
      // 后面 300ms 那一拍还会再同步一次，兜住「按钮晚于这里才进 DOM」的情况。
      this._tkRouteHidden = false;
      try { this._syncTikTokRouteVisibility(); } catch (e0) { /* 忽略 */ }
      try { this._tkLastHref = location.href; } catch (e2) { this._tkLastHref = ''; }

      var self = this;
      this._tkTimer = setInterval(function () { self._checkTikTokRoute(); }, POLL_MS);
      try {
        window.addEventListener('popstate', function () { self._checkTikTokRoute(); });
      } catch (e3) { /* 忽略 */ }

      // v2.5.97：推荐流单独一条更快的观察线（换条不换地址，只能盯当前条 ID）
      this._tkFypTimer = setInterval(function () { self._checkTikTokFyp(); }, FYP_POLL_MS);

      // 首次进入推荐流就贴位（不等 250ms 那一拍）
      try {
        var self2 = this;
        setTimeout(function () {
          if (self2._tkIsFypPage()) {
            self2._syncTikTokFypAnchor();
            self2._anchorTikTokButton();
          }
          // v2.5.100：按钮是 initComponents 建的，隔一拍再同步一次显隐，
          // 免得「按钮还没进 DOM 就被判成不可提取 → 没人藏」。幂等，跑两次没事。
          self2._syncTikTokRouteVisibility();
        }, 300);
      } catch (e4) { /* 忽略 */ }

      // 视口变化时重贴（窗口拉伸、旋转、隐藏侧栏都会改播放器几何）
      try {
        window.addEventListener('resize', function () {
          if (self._tkIsFypPage()) self._anchorTikTokButton();
        });
      } catch (e5) { /* 忽略 */ }
      return true;
    },

    /** 停止跟随（页面卸载 / 单测用） */
    _stopTikTokSpa() {
      if (this._tkTimer) {
        try { clearInterval(this._tkTimer); } catch (e) { /* 忽略 */ }
        this._tkTimer = null;
      }
      if (this._tkFypTimer) {
        try { clearInterval(this._tkFypTimer); } catch (e2) { /* 忽略 */ }
        this._tkFypTimer = null;
      }
      this._tkSpaStarted = false;
    },

    // ===================== 二、换条判定 =====================

    _checkTikTokRoute() {
      var href = '';
      try { href = location.href; } catch (e) { return; }
      if (!href || href === this._tkLastHref) return;
      var prevHref = this._tkLastHref;
      this._tkLastHref = href;

      // v2.5.100：地址一变就先按新路由同步按钮显隐。
      // 必须放在下面 `if (!curKey || ...) return` **之前** —— 因为从作品页退回探索页时
      // curKey 是 ''，会被那行直接 return 掉，藏按钮就落空了。
      this._syncTikTokRouteVisibility(href);

      var prevKey = this._tkRouteKeyFromHref(prevHref);
      var curKey = this._tkRouteKeyFromHref(href);
      // 不是可提取页 / 还是同一个东西 → 什么都不做。
      // 注意图集页翻第几张图只改 `?image_index=`，作品 ID 不变 → 走这里直接 return，
      // 既不关窗也不重扫（翻图不算换作品）。
      if (!curKey || curKey === prevKey) return;

      this._tkLog('info', '换了一页（' + (prevKey || '无') + ' → ' + curKey + '）');

      // 1) 缓存键必须跟着换：作品 ID 在路径里，generateCacheKey 本身就能区分，
      //    但显式重算一次更稳（万一以后地址形式变了，这里是唯一入口）。
      try {
        this.cacheKey = this.generateCacheKey(href);
      } catch (e2) { /* 地址解析失败就沿用旧键，不影响提取 */ }

      // 2) 催主世界重扫，并丢掉上一个页面的一手数据缓存
      try {
        if (typeof TiktokPageData !== 'undefined' && TiktokPageData) {
          if (typeof TiktokPageData.invalidate === 'function') {
            if (prevKey.indexOf('item:') === 0) TiktokPageData.invalidate(prevKey.slice(5));
          }
          if (typeof TiktokPageData.invalidateProfile === 'function') {
            if (prevKey.indexOf('profile:') === 0) TiktokPageData.invalidateProfile(prevKey.slice(8));
          }
          if (typeof TiktokPageData.requestScan === 'function') TiktokPageData.requestScan();
        }
      } catch (e3) { /* 忽略 */ }

      // 3) v2.5.95 用户拍板：**换条就关掉浮窗**（按钮保留）。
      //    原来是「就地刷新成新的这条」，但切条后新数据不是立刻就绪，
      //    就地刷新会先闪一下上一条/半截数据，不如干脆关掉——用户再点就是干净的新数据。
      this._closeTikTokPanelOnly();

      // 4) v2.5.97：进出推荐流时同步按钮贴位（推荐流贴播放器右上角，其他页保持原位）
      this._tkFypLastId = '';       // 跨页残留的「上一条」要清掉，否则回来第一拍会误判换条
      this._syncTikTokFypAnchor();
    },

    /**
     * 只关浮窗，**不动按钮**（照抖音 `_closeDouyinPanelOnly` 同一写法）。
     * 直接调现有 close()，不另写强制关 —— 避免留下半关状态。
     *
     * @param {string} [logMsg] 自定义日志文案。不传就是「换了一条作品」那套；
     *                          v2.5.101 列表页关窗时传自己的说法，别把两种场景记成一条。
     */
    _closeTikTokPanelOnly(logMsg) {
      try {
        if (this.modalManager && this.modalManager.isOpen) {
          this.modalManager.close();
          this._tkLog('info', logMsg || '换了一条作品，浮窗已关闭（按钮保留）');
        }
      } catch (e) {
        this._tkLog('warn', '关闭浮窗失败：' + (e && e.message));
      }
    },

    // ===================== 二·B、推荐流换条（v2.5.97） =====================

    /**
     * 推荐流换条检测
     *
     * 为什么不能跟作品页共用一套：推荐流滚到下一条，**地址一个字都不变**
     * （永远是 `https://www.tiktok.com/`），`_checkTikTokRoute` 靠「比地址」永远看不见。
     * 所以这里换成盯「主世界抄出来的当前条 ID」—— 它在桥节点上，250ms 更新一次。
     *
     * 行为跟 v2.5.95 定下的规矩一致：**换条就关浮窗，按钮保留**。
     */
    _checkTikTokFyp() {
      try {
        if (!this._tkIsFypPage()) {
          this._tkFypLastId = '';
          return;
        }
        var node = document.getElementById('clipmate-tiktok-fiber');
        if (!node || !node.textContent) return;
        var parsed = null;
        try { parsed = JSON.parse(node.textContent); } catch (e) { return; }
        if (!parsed || parsed.scope !== 'fyp') return;
        var id = String(parsed.urlId || parsed.id || '');
        if (!id) return;

        if (!this._tkFypLastId) {          // 第一次看到：只记下来，不算「换条」
          this._tkFypLastId = id;
          return;
        }
        if (id === this._tkFypLastId) return;

        var prev = this._tkFypLastId;
        this._tkFypLastId = id;
        this._tkLog('info', '推荐流换了一条（' + prev + ' → ' + id + '）');
        this._closeTikTokPanelOnly();
        this._anchorTikTokButton();
      } catch (e2) { /* 忽略 */ }
    },

    /**
     * 只在推荐流生效的「按钮贴位」。
     *
     * 贴到播放器列（`anchoring-player-column`）的右上角，内缩 16px，跟抖音沉浸流同一个规矩：
     * 贴边而不是贴视口顶部 —— 原来 `top:0` 会盖住 TikTok 的顶部导航条。
     *
     * 两条纪律：
     *   · 用户亲手拖过按钮（`buttonManager.userMoved`）就不再抢，他要放哪儿就放哪儿；
     *   · 只认推荐流，作品页/主页保持用户自己保存的位置（本版不为那两个入口改行为）。
     */
    _anchorTikTokButton() {
      var bm = this.buttonManager;
      var btn = bm && bm.button;
      if (!btn) return;
      if (!this._tkIsFypPage()) return;
      if (bm.userMoved) return;

      var el = null;
      try {
        el = document.querySelector('[data-e2e="anchoring-player-column"]') ||
          document.querySelector('[class*="DivColumnListContainer"]');
      } catch (e) { el = null; }

      var rect = null;
      try { rect = el ? el.getBoundingClientRect() : null; } catch (e2) { rect = null; }

      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var bw = btn.offsetWidth || FALLBACK_BUTTON_WIDTH;
      var bh = btn.offsetHeight || FALLBACK_BUTTON_HEIGHT;

      // 宽度/高度为 0 视为「没有几何」→ 退回视口右侧，至少不会是 top:0 挡导航条
      var rightEdge = (rect && rect.width > 0) ? rect.right : vw;
      var topEdge = (rect && rect.height > 0) ? rect.top : 0;

      var left = Math.round(rightEdge - bw - ANCHOR_INSET);
      var top = Math.round(topEdge + ANCHOR_INSET);

      // 夹进视口，保证任何缩放/窄窗口下按钮都点得到
      var maxLeft = Math.max(ANCHOR_INSET, vw - bw - ANCHOR_INSET);
      var maxTop = Math.max(ANCHOR_INSET, vh - bh - ANCHOR_INSET);
      left = Math.max(ANCHOR_INSET, Math.min(left, maxLeft));
      top = Math.max(ANCHOR_INSET, Math.min(top, maxTop));

      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
      btn.setAttribute('data-clipmate-anchor', 'tiktok-fyp');
    },

    /**
     * 进入 / 离开推荐流时同步一次按钮：进来贴位，离开把贴位标记摘掉
     * （作品页跟主页保持原来的位置逻辑，不受影响）
     */
    _syncTikTokFypAnchor() {
      try {
        var bm = this.buttonManager;
        var btn = bm && bm.button;
        if (!btn) return;
        if (this._tkIsFypPage()) {
          this._anchorTikTokButton();
        } else if (btn.getAttribute('data-clipmate-anchor') === 'tiktok-fyp') {
          btn.removeAttribute('data-clipmate-anchor');
        }
      } catch (e) { /* 忽略 */ }
    },

    /**
     * 地址 → 「当前这一页」的标识
     *
     * v2.5.96：主页也参与换页判定。以前只认作品 ID，于是
     * 「作品页点作者名回主页」这种页内跳转完全看不见（主页没有作品 ID），
     * 浮窗会带着上一条作品的数据留在屏幕上。
     *
     * v2.5.97：推荐流也算一页（`fyp`）。不然「从作品页退回推荐流」时
     * curKey 为空会直接 return，浮窗带着上一条作品的数据赖在屏幕上。
     * 推荐流内部换条**不靠这里**（地址不变），走 `_checkTikTokFyp`。
     *
     * @param {string} href
     * @returns {string} `item:<作品ID>` / `profile:<账号名>` / `fyp` / `''`（不可提取页）
     */
    _tkRouteKeyFromHref(href) {
      var id = this._tkItemIdFromHref(href);
      if (id) return 'item:' + id;
      var handle = '';
      try {
        if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.urlProfileHandle === 'function') {
          handle = TiktokPageData.urlProfileHandle(href);
        }
      } catch (e) { handle = ''; }
      if (!handle) {
        try {
          var m = String(href || '').match(
            /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,40})\/?(?:[?#]|$)/i
          );
          handle = m ? m[1] : '';
        } catch (e2) { handle = ''; }
      }
      if (handle) return 'profile:' + handle;
      // 推荐流：地址里没有 ID / 没有 @账号名，但它是一页可提取内容
      if (this._tkIsFypPage(href)) return 'fyp';
      return '';
    },

    /** 是否推荐流页面（`/`、`/foryou`、`/following`、`/friends`） */
    _tkIsFypPage(href) {
      try {
        if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.isFypUrl === 'function') {
          return TiktokPageData.isFypUrl(href);
        }
      } catch (e) { /* 走本地兜底 */ }
      try {
        var raw = (href === undefined || href === null) ? location.href : href;
        var m = String(raw).match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com(\/[^?#]*)?(?:[?#]|$)/i);
        if (!m) return false;
        return /^\/(?:foryou|following|friends)?\/?$/i.test(m[1] || '/');
      } catch (e2) { return false; }
    },

    /**
     * v2.5.100：按当前路由决定按钮显不显示。
     *
     * 为什么要做：TikTok 有一批**网格列表页** —— 探索 `/explore`、搜索 `/search/*`、
     * 话题 `/tag/*`、直播 `/live/*`、音乐 `/music/*`。这些页面没有「当前作品」，
     * 在那里出按钮，点下去只能从页面里猜一个作者ID、昵称/日期全空、URL 还是列表地址
     * （v2.5.99 真机实测：探索页给出作者ID `ther0bb0s` + 空昵称 + 空日期 + `/explore`）。
     *
     * 判定不另写一套白名单，直接用 `_tkRouteKeyFromHref`：它本来就返回 '' 表示「不可提取页」，
     * 而且作品页 / 主页 / 推荐流的判定跟换条逻辑完全一致，不会两边打架。
     *
     * 两条纪律：
     *   · 只在**当前可见**时藏（不跟配置里 `showButton=false` 抢方向盘）；
     *   · 只恢复**自己藏起来的**（`_tkRouteHidden`），配置关掉的不擅自打开。
     *
     * @param {string} [href] 默认取 location.href
     */
    _syncTikTokRouteVisibility(href) {
      // 1) 先判路由。注意这里**不能**像以前那样「按钮没建出来就直接 return」——
      //    v2.5.101 起浮窗也要按这个判定走，按钮还没进 DOM 时列表页上的浮窗一样得关。
      var ok = false;
      try {
        ok = !!this._tkRouteKeyFromHref(href === undefined ? location.href : href);
      } catch (e) {
        ok = true;   // 判定失败就当可提取，宁可多出一个按钮也别误藏
      }

      // 2) 列表页：按钮藏起来，浮窗也一起关掉（v2.5.101 用户反馈）
      if (!ok) {
        var bm0 = this.buttonManager;
        if (bm0 && bm0.button && bm0.isVisible !== false) {
          bm0.setVisible(false);
          this._tkRouteHidden = true;
          this._tkLog('info', '这个页面没有单条作品（列表页），先把按钮藏起来');
        }
        // 浮窗跟按钮是两个各自独立的组件，按钮藏了浮窗不会自己跟着走，必须显式关。
        // 放在按钮判断**外面**：按钮被配置关掉、或者按钮还没建出来时，列表页上的浮窗照样要关。
        // 不在 `bm.isVisible !== false` 里面，否则「按钮已经藏过一次」那拍就漏掉浮窗了。
        this._closeTikTokPanelOnly('这个页面没有单条作品（列表页），浮窗一起关掉');
        return;
      }

      // 3) 回到可提取页：只恢复**自己藏起来**的那次，配置关掉的按钮不擅自打开
      var bm = this.buttonManager;
      if (bm && bm.button && this._tkRouteHidden) {
        bm.setVisible(true);
        this._tkRouteHidden = false;
      }
    },

    /**
     * v2.5.101：当前页还接不接受弹窗？返回 true 表示**别弹**。
     *
     * 为什么需要：提取是异步的。TikTok 的一手数据要等主世界 fiber 就绪（慢的时候 1～2 秒），
     * 这段时间用户完全可能已经离开 —— 探索页点开作品 → 点提取 → 数据还没回来就关掉作品回列表。
     * 结果回来时不问一句就 open()，列表页上会凭空冒出一个浮窗，现象就是「探索页没有按钮，
     * 却突然弹出浮窗」，跟 v2.5.100 修掉的假数据按钮是同一类问题。
     *
     * 复用 `_tkRouteKeyFromHref`（'' = 不是单条作品即可提取页）：
     * 探索 / 搜索 / 话题 / 音乐 / 直播都拦，作品页 / 图集页 / 主页 / 推荐流一律放行。
     *
     * 判定抛错返回 false —— 宁可多弹一次，也别把用户等来的数据吞掉。
     *
     * **站点门禁必须第一行走**：这份 mixin 由 content-main 里
     * `Object.assign(MediaExtractor.prototype, TikTokSpaMixin)` 挂到**共享原型**上，
     * 而 manifest 里同一条 content_scripts 覆盖了豆瓣 / B站 / 抖音 / 快手 / MobyGames 等全站 ——
     * 也就是说别的网站也会走到这里。不加门禁的话，非 TikTok 地址在 `_tkRouteKeyFromHref`
     * 里一律返回 ''（纯数字 ID 的 /video/ 除外），等于「所有别的网站永远不弹窗」。
     *
     * 注意 `_syncTikTokRouteVisibility` 不用这段门禁：它只在 `_startTikTokSpa` 里跑，
     * 而那个函数开头已经有 hostname 判断。这里是从主流程直接调的，得自己扛。
     *
     * **名字带 `_tiktok` 前缀（v2.6.0 改）**：这份 mixin 是 Object.assign 到共享原型上的，
     * 名字若和别的站点 mixin 撞了就会互相覆盖（小红书那份先写好 `_xhsShouldSuppressModal`，
     * 由 content-main 的 `_shouldSuppressModal()` 统一汇总，两个站点各自说话，谁也不覆盖谁）。
     */
    _tiktokShouldSuppressModal() {
      try {
        var host = (typeof location !== 'undefined' && location.hostname)
          ? String(location.hostname).toLowerCase() : '';
        // 只认 tiktok.com 本身及其子域，`www.tiktok.com.evil.com` 这种不认
        if (!/(^|\.)tiktok\.com$/.test(host)) return false;
        return !this._tkRouteKeyFromHref(location.href);
      } catch (e) {
        return false;
      }
    },

    _tkItemIdFromHref(href) {      try {
        if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.urlItemId === 'function') {
          return TiktokPageData.urlItemId(href);
        }
      } catch (e) { /* 继续走本地兜底 */ }
      try {
        // v2.5.95：图集页是 `/photo/<id>`，跟 `/video/<id>` 一起认
        var m = String(href || '').match(/\/(?:video|photo)\/(\d{6,25})/);
        return m ? m[1] : '';
      } catch (e2) { return ''; }
    },

    // ===================== 三、日志 =====================

    _tkLog(level, msg) {
      try {
        if (typeof ClipMateLog === 'undefined' || !ClipMateLog) return;
        var fn = ClipMateLog[level] || ClipMateLog.info;
        if (typeof fn === 'function') fn.call(ClipMateLog, '[TikTok] ' + msg);
      } catch (e) { /* 忽略 */ }
    }
  };
})(typeof window !== 'undefined' ? window : null);
