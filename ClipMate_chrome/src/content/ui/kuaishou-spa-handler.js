/**
 * 快手「页内播放态」界面接线（KuaishouSpaMixin）
 *
 * 负责两种态的四件事，全部只在 www.kuaishou.com 上生效：
 *   ① **推荐流** `/new-reco`（v2.5.82）
 *   ② **页内播放弹层** `/search/*`（v2.5.88）、`/profile/*`（v2.7.0）：点开卡片盖上
 *      `.player-pop`，地址不变、文档不换，v2.5.86 的「站内跳转」只认地址变化，接不住这一态。
 *      两处结构完全同构，共用一套解析（见 kuaishou-immersive-context.js）。
 *
 * 四件事：
 *   1. 这两种页面本来都不是详情页，`init` 里识别不出媒体类型 → 页面加载时没有按钮。
 *      本模块在 init 末尾挂一个监听，等认出「正在播的那一条」再接管。
 *   2. 认出来 → 按钮出现，贴在它的右上角（内缩 16px），跟着它走。
 *   3. 换了另一条（滑 ↓ / 滚轮 / 点「下一条」/ 弹层自动连播）→ 按钮不动，
 *      浮窗若开着就**就地刷新**。
 *   4. 离开播放态（点进详情页 / 关掉弹层 / 切到别的页）→ 按钮撤掉，已打开的浮窗一起关。
 *      **例外**：如果地址已经变成详情页（弹层里点「查看详情」），按钮交给
 *      KuaishouRouteMixin，本模块不撤 —— 否则两边打架会闪。
 *
 * 两个开关（v2.5.89 起拆开，缺省都开）：
 *   - `kuaishouImmersiveEnabled` → 推荐流 `/new-reco`
 *   - `kuaishouPopupEnabled`     → 页内播放弹层 `/search/*`、`/profile/*`
 * 两个都关 → 连监听都不挂，行为完全等于 v2.5.81。
 *
 * 三条结构保证：
 *   - 域名门禁：`location.hostname !== 'www.kuaishou.com'` 时每个方法立刻返回，
 *     其他 30 多个站点连一个监听都不会多。
 *   - 详情页 / 网格页不受影响：那些页面走正常 init 全流程，**根本不会进本模块**
 *     （本模块只在「类型识别为空」那条分支被调用，且内部还有页面白名单）。
 *   - 认不出来就不出按钮：宁空不错，最差等于「这个页面上没有这个功能」。
 *
 * 依赖：KuaishouImmersiveContext（状态识别 + watch）、KuaishouImmersiveExtractor（熔断标志）、
 *       ButtonManager（已有）、ModalManager（已有）、KuaishouRouteMixin（搜索页转详情时用）。
 */
(function (global) {
  'use strict';

  /** 按钮贴当前条右上角的内缩距离（px） */
  var ANCHOR_INSET = 16;
  /** 按钮兜底宽度（真机 offsetWidth 正常，jsdom 为 0 时用它算位置） */
  var FALLBACK_BUTTON_WIDTH = 120;
  /** 按钮 CSS 里钉死的高度 48px（content-styles.css .media-extractor-button） */
  var BUTTON_HEIGHT = 48;

  global.KuaishouSpaMixin = {

    // ===================== 一、入口：init 里的「类型为空」分支 =====================

    /**
     * 快手推荐流在 init 里必然识别不出类型。
     * 这里挂上监听、把灰按钮先摘掉，然后返回 true 让 init 别走「清理并退出」那条路。
     *
     * @returns {Promise<boolean>} true = 已交给本模块接管（init 直接 return）
     */
    async _startKuaishouImmersiveWatcher(opts) {
      var keepButton = !!(opts && opts.keepButton);
      if (this._ksWatch) return true;
      if (!this._isKuaishouHost()) return false;

      var ctx = (typeof KuaishouImmersiveContext !== 'undefined') ? KuaishouImmersiveContext : null;
      if (!ctx || typeof ctx.watch !== 'function') return false;
      // 可能出现「页内播放态」的页面才挂监听（v2.5.88 起含搜索页弹层）。
      // 用的是「页面可能播放」而不是「现在正在播放」——搜索页加载时弹层还没开，
      // 但监听必须先挂上，否则弹层打开那一刻没人接。
      // 真出不出按钮由 ctx.isOpen() 决定（要求弹层真的存在且认得出作品ID）。
      var allowed = (typeof ctx.shouldWatch === 'function')
        ? ctx.shouldWatch()
        : ctx.isImmersivePage();
      if (!allowed) return false;

      var switches = await this._readKuaishouSwitches();
      // v2.5.89：两个开关拆开了（推荐流 / 搜索页弹层各一个）。
      // 两个都关 = 行为完全等于 v2.5.81（连监听都不挂）。
      if (!switches.immersive && !switches.popup) return false;

      this._ksImmersiveOn = switches.immersive;
      this._ksPopupOn = switches.popup;
      this._ksEnabled = true;
      // v2.7.17：从**个人主页**（mediaType=person）进来时按钮已经按正常流程显示出来了，
      // 这里**绝不能**把它藏掉 —— 藏了主页就提不到人物档案。
      // 只有原来那条「类型识别为空」的路子才需要先摘按钮（那种页面本来就没按钮）。
      this._ksProfilePerson = !!(opts && opts.profilePerson);
      if (!keepButton) {
        // 还没认出「正在播的那一条」之前，页面上不许有按钮（灰的也不行）
        this._hideKuaishouButton();
      }

      var self = this;
      this._ksWatch = ctx.watch(function (evt) {
        Promise.resolve(self._onKuaishouImmersiveState(evt)).catch(function (e) {
          self._ksLog('warn', '播放状态处理失败：' + (e && e.message));
        });
      }, { debounceMs: 320 });

      this._ksLog('info', '页内播放态监听已启动（模式白名单：/new-reco 与 /search/*、/profile/*）');

      // v2.5.88：搜索页还要**额外**挂一个地址监听。
      // 原因：搜索页弹层里有「查看详情」入口（`.openPhotoSide`），点下去地址会变成
      // `/short-video/<id>`。init 已经在上面 return 了，不会再走到 route 那一段，
      // 不补挂的话详情页会没有按钮（等于把 v2.5.86 修好的缺口在搜索页重演一遍）。
      // `/new-reco` 上这一句会被 route 自己的「推荐流不抢」门禁挡掉，等于没调。
      if (typeof this._startKuaishouRouteWatcher === 'function') {
        try { this._startKuaishouRouteWatcher(); } catch (e) { /* 挂不上只是少一条兜底 */ }
      }

      return true;
    },

    _isKuaishouHost() {
      try {
        return location.hostname === 'www.kuaishou.com';
      } catch (e) {
        return false;
      }
    },

    /**
     * 读「页内播放态」的两个开关（v2.5.89 拆分）：
     *   - `kuaishouImmersiveEnabled` → 推荐流 `/new-reco`
     *   - `kuaishouPopupEnabled`     → 页内播放弹层 `/search/*`、`/profile/*`
     * 缺省都是**开**（没存过 = 开，与拆分前行为一致）。
     * 读失败也按开处理：宁可多接一层，也不要因为存储抖动把功能关掉。
     *
     * @returns {Promise<{immersive:boolean, popup:boolean}>}
     */
    async _readKuaishouSwitches() {
      var out = { immersive: true, popup: true };
      try {
        if (typeof WBR !== 'undefined' && WBR.storage && WBR.storage.local) {
          var res = await WBR.storage.local.get([
            'kuaishouImmersiveEnabled',
            'kuaishouPopupEnabled'
          ]);
          if (res) {
            if (res.kuaishouImmersiveEnabled === false) out.immersive = false;
            if (res.kuaishouPopupEnabled === false) out.popup = false;
          }
        }
      } catch (e) { /* 读不到就按默认开 */ }
      return out;
    },

    /** 读「快手推荐流提取（试验）」开关，缺省 = 开 */
    async _readKuaishouImmersiveEnabled() {
      var s = await this._readKuaishouSwitches();
      return s.immersive;
    },

    /** 读「快手搜索页弹层提取」开关，缺省 = 开 */
    async _readKuaishouPopupEnabled() {
      var s = await this._readKuaishouSwitches();
      return s.popup;
    },

    /** 这一种态是否被允许（`popup` / `immersive`） */
    _ksModeEnabled(mode) {
      if (mode === 'popup') return this._ksPopupOn !== false;
      return this._ksImmersiveOn !== false;
    },

    _ksLog(level, msg) {
      try {
        if (typeof ClipMateLog !== 'undefined' && ClipMateLog[level]) {
          ClipMateLog[level]('[KuaishouImmersive] ' + msg);
          return;
        }
        if (typeof safeLog === 'function') {
          safeLog('[KuaishouImmersive] ' + msg);
        }
      } catch (e) { /* 日志失败不许影响主流程 */ }
    },

    // ===================== 二、状态变化 =====================

    /**
     * @param {{id:string, opened:boolean, mode?:string}} evt 由 KuaishouImmersiveContext.watch 抛出
     */
    async _onKuaishouImmersiveState(evt) {
      if (!this._ksEnabled) return;
      var opened = !!(evt && evt.opened);

      if (!opened) {
        this._deactivateKuaishouImmersive();
        return;
      }

      // v2.5.89：按「是哪一种态」再过一道开关门禁（推荐流 / 搜索页弹层各一个开关）。
      // 关掉的那一种：不出按钮；如果之前已经接管过，顺手撤干净（含浮窗）。
      var incomingMode = (evt && evt.mode === 'popup') ? 'popup' : 'immersive';
      if (!this._ksModeEnabled(incomingMode)) {
        if (this._ksActivated || this._ksWorkId) this._deactivateKuaishouImmersive();
        this._hideKuaishouButton();
        return;
      }

      // 熔断过（连续 5 次取不到内容）→ 不接管，等于回到「页面上没有按钮」
      if (this._isKuaishouBreakerTripped()) {
        this._hideKuaishouButton();
        return;
      }

      var id = String((evt && evt.id) || '');
      // 认不出是哪一条（还没渲染完 / 结构变了 / 切条瞬间）：一律不接管、不出按钮。
      // 已接管时遇到瞬时空 ID 只保持现状，不闪一下再回来。
      if (!id) {
        if (!this._ksActivated) this._hideKuaishouButton();
        return;
      }

      var prevId = this._ksWorkId || '';
      this._ksWorkId = id;
      // v2.5.88：记下这次是哪一种态（`immersive` 推荐流 / `popup` 搜索页弹层），
      // 只用于按钮锚点标记与日志口径，字段取法两种态完全一样。
      this._ksMode = incomingMode;

      // 缓存键按作品维度：同一条重复通知 = 命中缓存，换一条 = 一定是新键
      this.activeShortcode = id || null;
      try {
        this.cacheKey = this.generateCacheKey(window.location.href, id || undefined);
      } catch (e) { /* 地址解析失败就沿用旧键，不影响提取 */ }

      if (!this._ksActivated) {
        await this._activateKuaishouComponents();
      } else {
        // 被撤下过再接管时，resize / scroll / ResizeObserver 已经被摘掉，这里必须补挂
        this._bindKuaishouAnchor();
        this._showKuaishouButton();
      }
      this._anchorKuaishouButton();
      this._anchorKuaishouRetry();

      var switched = !!(prevId && id && prevId !== id && this._ksActivated);
      if (this.modalManager && this.modalManager.isOpen) {
        if (switched) {
          // v2.9.6：开着「换作品时收起浮窗」→ 关窗，不再就地刷新（推荐页是整屏播放，
          // 刷新等于一直挡着下一屏）。关掉这一项仍是原来的就地刷新，行为不变。
          if (typeof ClipMateBrowseDismiss !== 'undefined' &&
              typeof ClipMateBrowseDismiss.shouldCloseOnSwitch === 'function' &&
              ClipMateBrowseDismiss.shouldCloseOnSwitch()) {
            try {
              this.modalManager.close();
              this._ksLog('info', '换了下一条，浮窗已关闭（按钮保留）');
            } catch (e) {
              this._ksLog('warn', '关闭浮窗失败：' + (e && e.message));
            }
          } else {
            this._refreshKuaishouPanel();
          }
        }
      } else if (this.autoExtract) {
        Promise.resolve(this.handleExtract()).catch(function (e) {
          this._ksLog && this._ksLog('warn', '自动提取失败：' + (e && e.message));
        }.bind(this));
      }
    },

    /** 第一次认出「正在播的那一条」时才把剩下的组件装好 */
    async _activateKuaishouComponents() {
      if (this._ksActivated) return;
      // v2.7.17：从个人主页（person）切过来时，`this.fieldMapper` **已经有值**了 ——
      // 但那是人物的 6 列模板，拿它去映射作品数据会全空（作品字段一个都不在 6 列里）。
      // 所以这里不能只看「有没有」，必须看「是不是 social 的」，不是就重建。
      if (!this.fieldMapper || this._ksMapperType !== 'social') {
        this.fieldMapper = await this.initFieldMapper('social');
        this._ksMapperType = 'social';
      }
      this.initUI();
      await this.refreshConfig();
      this._showKuaishouButton();
      this._bindKuaishouAnchor();
      this._ksActivated = true;
      this.isInitialized = true;
      // v2.7.18：把「弹层接管中」写到隔离世界的 window 上，给 extractor-factory 读。
      // 为什么必须有个全局标记：快手在主页上点开作品**不改地址**，选提取器只能看 URL，
      // 于是 `/profile/<id>` 那条 person 规则照样命中 —— 而表格模板已经是 social 的 7 列，
      // 人物提取器填进去就只剩作者昵称，其余全空（v2.7.17 真机就是这个症状）。
      // 抖音没这个问题：它弹层地址带 `?modal_id=`，excludeQuery 就能排除。
      try { window.__clipmateKsImmersiveActive = true; } catch (e) { /* 忽略 */ }
      this._ksLog('info', '接管完成（mediaType=social，模式=' + (this._ksMode || 'immersive') + '）');
    },

    /** 这一条没了（离开推荐流 / 弹层被关掉）：撤按钮 + 把已开的浮窗一起关 */
    _deactivateKuaishouImmersive() {
      // 接管结束 → 清标记（extractor-factory 要据此把 person 提取器放回来）
      try { window.__clipmateKsImmersiveActive = false; } catch (e) { /* 忽略 */ }
      var wasActive = !!(this._ksWorkId || this._ksActivated);
      var wasMode = this._ksMode;
      var wasUserMoved = !!this._ksUserMoved;
      this._ksWorkId = '';
      this._ksMode = '';
      this._ksUserMoved = false;
      this.activeShortcode = null;
      try {
        this.cacheKey = this.generateCacheKey(window.location.href);
      } catch (e) { /* 忽略 */ }

      // v2.5.88：如果地址**已经变成详情页**（搜索页弹层里点了「查看详情」），
      // 按钮与浮窗的归属就交给 KuaishouRouteMixin 了 —— 这里只解绑锚点、关浮窗，
      // **绝不撤按钮**。否则 route 刚出按钮、这边又摘掉，谁后跑谁说了算，按钮会闪没了。
      var handover = false;
      try {
        handover = (typeof this._ksRouteIsDetail === 'function')
          && this._ksRouteIsDetail(location.pathname);
      } catch (e) { handover = false; }

      try {
        if (this.modalManager && this.modalManager.isOpen) this.modalManager.close();
      } catch (e) {
        this._ksLog('warn', '关闭浮窗失败：' + (e && e.message));
      }

      if (handover) {
        this._unbindKuaishouAnchor();
        // 播放态给按钮写过内联 left/top（贴当前条右上角），详情页该用 CSS 默认的
        // top:20 / right:20 —— 不还原的话按钮会钉在弹层那一刻的坐标上，滚动不跟随。
        // 用户手动拖过就保留（那是他自己选的位置）。
        if (!wasUserMoved) this._ksResetButtonPosition();
        if (wasActive) this._ksLog('info', '播放态已交给详情页接管，按钮不撤、位置还原为默认');
        return;
      }

      // v2.7.18：从**个人主页**进来时，弹层关掉要**切回人物档案**，而不是把按钮撤掉
      // （用户 2026-10-31 拍板：关掉弹层回到人物档案）。
      //
      // ⚠ 这里**不能**加 `wasActive` 条件（v2.7.17 就是这么写的，结果是主页按钮一闪就没）：
      // 监听挂上后会先来一次 `opened=false`（页面此刻确实没开弹层），那次 wasActive=false，
      // 于是掉到最后那句 `_hideKuaishouButton()` —— 主页按钮是正常流程 initUI() 建的，
      // 被这一步摘掉后主页就再也没有按钮了（必须等到点开作品弹层才出现）。
      // 主页态的按钮归正常流程管，本模块**任何时候都不许摘它**。
      if (this._ksProfilePerson) {
        this._unbindKuaishouAnchor();
        // 只有「之前确实接管过弹层」才需要把 6 列模板换回来；
        // init 阶段那次 opened=false 什么都不用做（映射器本来就是 person 的）。
        if (wasActive) this._restoreKuaishouProfilePerson();
        return;
      }

      this._hideKuaishouButton();
      this._unbindKuaishouAnchor();
      if (wasActive) {
        this._ksLog('info', '离开' + (wasMode === 'popup' ? '播放弹层' : '推荐流') + '，按钮与浮窗一并撤下');
      }
    },

    /**
     * 弹层关掉后切回「个人主页 / 人物档案」（v2.7.17）
     *
     * 只做两件必要的事：把 fieldMapper 换回 6 列模板、把按钮显示回来。
     * **mediaType 不用存** —— `handleExtract` 每次都重新 `detectMediaType()`，
     * 弹层关了以后 `ctx.isOpen()` 为 false，`_kuaishouOverrideType()` 自然返回 null，
     * URL 规则重新判出 person。
     */
    async _restoreKuaishouProfilePerson() {
      try {
        if (this._ksMapperType !== 'person') {
          this.fieldMapper = await this.initFieldMapper('person');
          this._ksMapperType = 'person';
        }
        await this.refreshConfig();
        this._showKuaishouButton();
        this._ksLog('info', '回到个人主页（mediaType=person）');
      } catch (e) {
        this._ksLog('warn', '回到个人主页失败：' + (e && e.message));
      }
    },

    _isKuaishouBreakerTripped() {
      try {
        var Cls = (typeof window !== 'undefined') ? window.KuaishouImmersiveExtractor : null;
        return !!(Cls && typeof Cls.isDisabled === 'function' && Cls.isDisabled());
      } catch (e) {
        return false;
      }
    },

    // ===================== 三、按钮显隐 =====================

    /** 把按钮插回页面（ButtonManager 构造时插过一次，没接管时被摘掉了） */
    _showKuaishouButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try {
        bm.show();
      } catch (e) { /* 插不回去也不许打断流程 */ }
      this._anchorKuaishouButton();
    },

    /** 摘掉按钮元素（保留引用，再接管时直接 show 回来；不销毁，避免重建状态） */
    _hideKuaishouButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try {
        if (bm.button.parentNode) bm.button.parentNode.removeChild(bm.button);
        bm.button.removeAttribute('data-clipmate-anchor');
      } catch (e) { /* 忽略 */ }
    },

    /**
     * 把按钮还原成「没被播放态贴过位」的样子：
     * 清掉内联坐标（让 CSS 的 top:20 / right:20 生效）与锚点标记。
     * 交棒给详情页时用（v2.5.88）。
     */
    _ksResetButtonPosition() {
      var bm = this.buttonManager;
      var btn = bm && bm.button;
      if (!btn) return;
      try {
        btn.removeAttribute('data-clipmate-anchor');
        btn.style.left = '';
        btn.style.top = '';
        btn.style.right = '';
        btn.style.bottom = '';
      } catch (e) { /* 忽略 */ }
    },

    // ===================== 四、贴住当前条右上角 =====================

    /** 锚点 = 进度条那一层（它和视频画面同尺寸，位置最稳）→ 退到当前 slide */
    _kuaishouAnchorElement() {
      try {
        var ctx = (typeof KuaishouImmersiveContext !== 'undefined') ? KuaishouImmersiveContext : null;
        if (!ctx || typeof ctx.getRoot !== 'function') return null;
        var root = ctx.getRoot(document);
        if (!root) return null;
        // 优先用播放器容器：按钮要跟着「画面」走，而不是整条 slide（slide 含底部留白）
        var player = root.querySelector('.video-container') || root.querySelector('.VideoPlayer');
        return player || root;
      } catch (e) {
        return null;
      }
    },

    /** 把按钮贴到当前条右上角（内缩 16px），并夹在视口内 */
    _anchorKuaishouButton() {
      var bm = this.buttonManager;
      var btn = bm && bm.button;
      if (!btn || !this._ksWorkId) return;
      if (this._ksUserMoved) return;

      var rect = null;
      try {
        var el = this._kuaishouAnchorElement();
        rect = el ? el.getBoundingClientRect() : null;
      } catch (e) {
        rect = null;
      }

      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var bw = btn.offsetWidth || FALLBACK_BUTTON_WIDTH;

      // 锚点宽度高度为 0 视为「没有几何」，退回视口（宁可贴视口，也不贴到看不见的节点上）
      var rightEdge = (rect && rect.width > 0) ? rect.right : vw;
      var topEdge = (rect && rect.height > 0) ? rect.top : 0;

      var left = Math.round(rightEdge - bw - ANCHOR_INSET);
      var top = Math.round(topEdge + ANCHOR_INSET);

      var maxLeft = Math.max(ANCHOR_INSET, vw - bw - ANCHOR_INSET);
      var maxTop = Math.max(ANCHOR_INSET, vh - BUTTON_HEIGHT - ANCHOR_INSET);
      left = Math.max(ANCHOR_INSET, Math.min(left, maxLeft));
      top = Math.max(ANCHOR_INSET, Math.min(top, maxTop));

      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
      // 标记供真机脚本/单测确认贴的是哪一种态
      btn.setAttribute('data-clipmate-anchor', 'kuaishou-' + (this._ksMode === 'popup' ? 'popup' : 'immersive'));

      this._retargetKuaishouResizeObserver();
    },

    /** 把 ResizeObserver 换到当前锚点上（同一个元素就不动） */
    _retargetKuaishouResizeObserver() {
      var ro = this._ksResizeObserver;
      if (!ro || typeof ro.observe !== 'function') return;
      var el = null;
      try { el = this._kuaishouAnchorElement(); } catch (e) { el = null; }
      if (!el || el === this._ksObservedEl) return;
      try {
        if (this._ksObservedEl && typeof ro.unobserve === 'function') ro.unobserve(this._ksObservedEl);
        ro.observe(el);
        this._ksObservedEl = el;
      } catch (e) { /* 换不了就靠 resize / 切条事件兜住 */ }
    },

    /** 接管后延时再贴几次（播放器布局异步，只贴一次会停在过时位置） */
    _anchorKuaishouRetry() {
      this._clearKuaishouAnchorRetry();
      var self = this;
      var idAtSchedule = this._ksWorkId;
      this._ksAnchorTimers = [250, 700, 1500].map(function (ms) {
        return setTimeout(function () {
          if (!self._ksWorkId || self._ksWorkId !== idAtSchedule) return;
          if (self._ksUserMoved) return;
          self._anchorKuaishouButton();
        }, ms);
      });
    },

    _clearKuaishouAnchorRetry() {
      if (!this._ksAnchorTimers) return;
      this._ksAnchorTimers.forEach(function (t) { try { clearTimeout(t); } catch (e) { /* 忽略 */ } });
      this._ksAnchorTimers = null;
    },

    /** 尺寸变化 / 滚动时重新贴位（rAF 节流） */
    _scheduleKuaishouAnchor() {
      if (this._ksAnchorRaf) return;
      var self = this;
      var raf = window.requestAnimationFrame;
      if (typeof raf === 'function') {
        this._ksAnchorRaf = raf.call(window, function () {
          self._ksAnchorRaf = null;
          self._anchorKuaishouButton();
        });
      } else {
        this._ksAnchorRaf = setTimeout(function () {
          self._ksAnchorRaf = null;
          self._anchorKuaishouButton();
        }, 80);
      }
    },

    _bindKuaishouAnchor() {
      if (this._ksAnchorBound) return;
      this._ksAnchorBound = true;
      var self = this;
      this._ksAnchorHandler = function () { self._scheduleKuaishouAnchor(); };
      try {
        window.addEventListener('resize', this._ksAnchorHandler, { passive: true });
        window.addEventListener('scroll', this._ksAnchorHandler, { passive: true, capture: true });
      } catch (e) { /* 老内核不支持 options 对象时降级 */ }

      try {
        if (typeof window.ResizeObserver === 'function') {
          this._ksResizeObserver = new window.ResizeObserver(this._ksAnchorHandler);
          var el = this._kuaishouAnchorElement();
          if (el) {
            this._ksResizeObserver.observe(el);
            this._ksObservedEl = el;
          }
        }
      } catch (e) { /* jsdom / 老浏览器没有 ResizeObserver，靠 resize + 切条事件兜住 */ }

      if (this.buttonManager) {
        this.buttonManager.onPositionSaved = function () { self._ksUserMoved = true; };
      }
    },

    _unbindKuaishouAnchor() {
      this._clearKuaishouAnchorRetry();
      if (this._ksAnchorHandler) {
        try {
          window.removeEventListener('resize', this._ksAnchorHandler);
          window.removeEventListener('scroll', this._ksAnchorHandler, { capture: true });
        } catch (e) { /* 忽略 */ }
      }
      this._ksAnchorHandler = null;
      if (this._ksResizeObserver) {
        try { this._ksResizeObserver.disconnect(); } catch (e) { /* 忽略 */ }
        this._ksResizeObserver = null;
      }
      this._ksObservedEl = null;
      if (this._ksAnchorRaf) {
        try {
          if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this._ksAnchorRaf);
          else clearTimeout(this._ksAnchorRaf);
        } catch (e) { /* 忽略 */ }
        this._ksAnchorRaf = null;
      }
      this._ksAnchorBound = false;
      if (this.buttonManager) this.buttonManager.onPositionSaved = null;
    },

    // ===================== 五、切下一条：浮窗就地刷新 =====================

    /**
     * 重试最多 4 次（每次 400ms）：切条后信息区是异步渲染的，第一次往往还是上一条。
     * 判据：URL 有值且「文案 / 昵称 / 日期」至少一项非空。
     *
     * v2.5.89 并发序号（真机踩到的坑，必须留着）
     * ----------------------------------------
     * 每切一条就起一次刷新，而一次提取要联网抓作者主页（真机 8~20 秒）。
     * 搜索页弹层是**自动连播**的，几秒换一条 → 好几轮刷新同时在跑，
     * **先出发的那一轮往往后结束**，不带序号就会把新条的结果盖回旧条：
     * 真机实测当前播 `3xfjr5h4hfrbz66`，浮窗先是它（对），2 秒后又自己退回了
     * 上一条 `3xw663xa8762kim`（错）。
     *
     * 所以每次进来先领一个号，凡是 await 之后都要对一次号：
     *   - 号不是最新的 → 说明后面已经有更新的刷新在跑，本次结果**直接丢弃**（不写浮窗）
     *   - 号还是最新的 → 正常写
     * 序号只在内存里，页面刷新即重置，不需要清理。
     */
    async _refreshKuaishouPanel() {
      if (!this.modalManager || !this.modalManager.isOpen) return;

      this._ksRefreshSeq = (this._ksRefreshSeq || 0) + 1;
      var seq = this._ksRefreshSeq;
      var isStale = function (self) { return self._ksRefreshSeq !== seq; };

      for (var attempt = 0; attempt < 4; attempt++) {
        try {
          var data = await this.extractFromCurrentPage();
          if (isStale(this)) return; // 有更新的一轮在跑，本次作废
          if (this._isKuaishouDataValid(data)) {
            await this.modalManager.updateInPlace(data);
            if (isStale(this)) return;
            this._ksLog('info', '浮窗已就地刷新成新的一条');
            return;
          }
        } catch (e) {
          this._ksLog('warn', '就地刷新失败：' + (e && e.message));
        }
        if (attempt < 3) await new Promise(function (r) { setTimeout(r, 400); });
        if (isStale(this)) return;
      }
    },

    _isKuaishouDataValid(data) {
      if (!data || typeof data !== 'object') return false;
      var get = function (k) { return String(data[k] == null ? '' : data[k]).trim(); };
      if (!get('URL')) return false;
      return !!(get('本页文案') || get('作者昵称') || get('发布日期'));
    },

    // ===================== 六、类型补认 =====================

    /**
     * 推荐流把媒体类型补认成 social。
     *
     * 必须「接管之后」才生效（`_ksActivated` 那道判断）：
     * init 阶段如果这里就返回 social，走的就是普通全流程 —— 按钮在 initComponents 里
     * 直接插进页面，**监听根本不会挂上**，于是切条不刷新、离开不撤按钮。
     */
    _kuaishouOverrideType() {
      try {
        if (!this._ksActivated) return null;
        if (!this._isKuaishouHost()) return null;
        if (!this._ksWorkId) return null;
        var ctx = (typeof KuaishouImmersiveContext !== 'undefined') ? KuaishouImmersiveContext : null;
        if (!ctx || typeof ctx.isOpen !== 'function') return null;
        if (!ctx.isOpen(document)) return null;
        return 'social';
      } catch (e) {
        return null;
      }
    },

    /** 退出前把监听摘干净（测试用） */
    _stopKuaishouImmersiveWatcher() {
      try {
        if (typeof this._ksWatch === 'function') this._ksWatch();
      } catch (e) { /* 忽略 */ }
      this._ksWatch = null;
      this._ksEnabled = false;
      this._ksObservedEl = null;
      this._hideKuaishouButton();
      this._unbindKuaishouAnchor();
    }
  };
})(typeof window !== 'undefined' ? window : null);
