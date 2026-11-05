/**
 * 抖音「弹窗播放」+「沉浸流」界面接线（DouyinSpaMixin）
 *
 * 负责四件事，全部只在 www.douyin.com 上生效：
 *   1. 抖音的精选 / 搜索 / 用户主页 / 推荐 / 关注 / 朋友等页面**加载时本来没有按钮**
 *      （那些页面不是详情页），本模块在 init 末尾挂一个监听，等出现「正在播放的那一条」再接管。
 *   2. 认出来 → 按钮出现，贴在它的右上角（内缩 16px），跟着它走。
 *   3. 没了（关弹窗 / 切到不归本模块管的页面）→ 按钮撤掉，**已经打开的浮窗一起关**
 *      （用户 2026-10-27 定的第 4 条）。
 *   4. 换了另一条（弹窗里切条 / 沉浸流按 ↓ 滚轮切条）→ 按钮不动，浮窗若开着就**就地刷新**。
 *
 * v2.5.80 批 8 新增「沉浸流」这一种态（推荐 / 关注 / 朋友三页，整屏播一条、地址栏不变）。
 * 两种态**各有独立开关**，互不牵连：
 *   - 弹窗      `douyinModalEnabled`       （v2.5.77）
 *   - 沉浸流    `douyinImmersiveEnabled`   （v2.5.80）
 * 两条都关 → 连监听都不挂，行为完全等于 v2.5.76。
 *
 * 三条结构保证：
 *   - 域名门禁：`location.hostname !== 'www.douyin.com'` 时每个方法都立刻返回，
 *     其他 30 多个站点连一个监听都不会多。
 *   - 详情页不受影响：/video /note 走的是正常的 init 全流程，**根本不会进本模块**
 *     （本模块只在「类型识别为空」那条分支被调用）。
 *   - 认不出来就不出按钮：宁空不错，最差等于「这个页面上没有这个功能」。
 *
 * 依赖：DouyinModalContext（状态识别 + watch）、DouyinModalExtractor（熔断标志）、
 *       ButtonManager（已有）、ModalManager（已有）。
 */
(function (global) {
  'use strict';

  /** 按钮贴弹窗右上角的内缩距离（px） */
  var ANCHOR_INSET = 16;
  /** 按钮兜底宽度（真机 offsetWidth 正常，jsdom 为 0 时用它算位置） */
  var FALLBACK_BUTTON_WIDTH = 120;
  /** 按钮 CSS 里钉死的高度 48px（content-styles.css .media-extractor-button） */
  var BUTTON_HEIGHT = 48;

  global.DouyinSpaMixin = {

    // ===================== 一、入口：init 里的「类型为空」分支 =====================

    /**
     * 抖音的「非详情页」在 init 里必然识别不出类型。
     * 这里挂上监听、把灰按钮先摘掉，然后返回 true 让 init 别走「清理并退出」那条路。
     *
     * @returns {Promise<boolean>} true = 已交给本模块接管（init 直接 return）
     */
    async _startDouyinModalWatcher() {
      if (this._douyinWatch) return true;
      if (!this._isDouyinModalHost()) return false;

      var ctx = (typeof DouyinModalContext !== 'undefined') ? DouyinModalContext : null;
      if (!ctx || typeof ctx.watch !== 'function') return false;

      // 两个开关独立：只要有一个开着就得挂监听（另一个由 _onDouyinModalState 单独把关）
      var modalOn = await this._readDouyinModalEnabled();
      var immersiveOn = await this._readDouyinImmersiveEnabled();
      if (!modalOn && !immersiveOn) return false;

      this._douyinModalOn = modalOn;
      this._douyinImmersiveOn = immersiveOn;
      this._douyinEnabled = true;
      // 还没认出「正在播的那一条」之前，页面上不许有按钮（灰的也不行）
      this._hideExtractButton();

      var self = this;
      this._douyinWatch = ctx.watch(function (evt) {
        // watch 的回调是同步调用的，内部是 async，必须自己兜住异常，
        // 否则一个字段出错会把 MutationObserver 的回调链打断。
        Promise.resolve(self._onDouyinModalState(evt)).catch(function (e) {
          self._douyinLog('warn', '播放状态处理失败：' + (e && e.message));
        });
      }, { debounceMs: 320 });

      this._douyinLog('info', '播放监听已启动（弹窗=' + (modalOn ? '开' : '关')
        + '，沉浸流=' + (immersiveOn ? '开' : '关') + '）');
      return true;
    },

    /** 只在 www.douyin.com 生效；v.douyin.com 是短链跳转页，没有弹层，排除 */
    _isDouyinModalHost() {
      try {
        return location.hostname === 'www.douyin.com';
      } catch (e) {
        return false;
      }
    },

    /**
     * v2.12.2：作者主页上的「只换装」监听。
     *
     * 为什么需要它：抖音个人主页 `/user/<sec_uid>`（地址里没有 modal_id）会被识别成 person，
     * 走的是正常 init 全流程；而上面那个弹窗监听只在「类型识别为空」的分支里挂，
     * 主页永远进不去 —— 于是主页上点开一条作品时，没有任何人通知按钮换装。
     * 真机实证（2026-11-05）：按钮仍是金黄边的「整理档案」，点下去提的却是这一条作品。
     *
     * 为什么**不复用** _startDouyinModalWatcher 那条通道：
     * 它管的是「摘按钮 / 贴位 / 按作品缓存 / 熔断」，其中 `_deactivateDouyinModal()`
     * 关弹层时会把按钮摘掉；而主页关掉弹层后按钮必须回来（还得是档案装）。
     * 复用必然踩这个坑，所以这里只做一件事：按「弹层开没开」换皮肤，
     * **一个字节都不碰显隐、位置、缓存、提取类型**。
     *
     * 判据用弹层本身在不在（DouyinModalContext.watch），不看地址栏 ——
     * 实测抖音几秒后会把 `?modal_id=` 抹掉，看地址会在弹层还开着时误判成「主页」。
     *
     * @returns {boolean} true = 已挂上（或本来就在跑）
     */
    _startDouyinPersonSkinWatcher() {
      if (this._douyinPersonSkinWatch) return true;
      if (!this._isDouyinModalHost()) return false;
      // 完整弹窗接管已在跑（类型为空那条分支）→ 那边已经是唯一主人，不重复挂
      if (this._douyinWatch) return false;
      // 只在档案页挂；其他形态的换装由 _applyPageShape 负责
      if (this._pageShape !== 'person') return false;

      var ctx = (typeof DouyinModalContext !== 'undefined') ? DouyinModalContext : null;
      if (!ctx || typeof ctx.watch !== 'function') return false;

      var self = this;
      this._douyinPersonSkinWatch = ctx.watch(function (evt) {
        // watch 的回调是同步的，内部任何异常都必须自己兜住
        try {
          var bm = self.buttonManager;
          if (!bm || typeof bm.setSkin !== 'function') return;
          // 弹层开着 = 正在看某一条作品 → 普通蓝「提取」；关掉 = 回到整页档案 → 档案装
          bm.setSkin(evt && evt.opened ? 'default' : 'arch');
        } catch (e) { /* 换肤失败不影响提取 */ }
      }, { debounceMs: 320 });

      this._douyinLog('info', '主页换装监听已启动（弹层开→普通蓝，关→档案装）');
      return true;
    },

    /** 读「抖音弹窗提取（试验）」开关，缺省 = 开 */
    async _readDouyinModalEnabled() {
      try {
        if (typeof WBR !== 'undefined' && WBR.storage && WBR.storage.local) {
          var res = await WBR.storage.local.get('douyinModalEnabled');
          return !(res && res.douyinModalEnabled === false);
        }
      } catch (e) { /* 读不到就按默认开 */ }
      return true;
    },

    /** 读「抖音推荐/关注/朋友页提取（试验）」开关，缺省 = 开 */
    async _readDouyinImmersiveEnabled() {
      try {
        if (typeof WBR !== 'undefined' && WBR.storage && WBR.storage.local) {
          var res = await WBR.storage.local.get('douyinImmersiveEnabled');
          return !(res && res.douyinImmersiveEnabled === false);
        }
      } catch (e) { /* 读不到就按默认开 */ }
      return true;
    },

    /** 这一种态对应的开关是不是开着（mode: 'modal' | 'immersive'） */
    _douyinModeEnabled(mode) {
      if (mode === 'immersive') return this._douyinImmersiveOn !== false;
      if (mode === 'modal') return this._douyinModalOn !== false;
      return false;
    },

    _douyinLog(level, msg) {
      try {
        if (typeof ClipMateLog !== 'undefined' && ClipMateLog[level]) {
          ClipMateLog[level]('[DouyinModal] ' + msg);
          return;
        }
        if (typeof safeLog === 'function') {
          safeLog('[DouyinModal] ' + msg);
        }
      } catch (e) { /* 日志失败不许影响主流程 */ }
    },

    // ===================== 二、弹窗状态变化 =====================

    /**
     * @param {{id:string, opened:boolean, mode?:string}} evt 由 DouyinModalContext.watch 抛出
     *   mode = 'modal'（弹窗）| 'immersive'（推荐/关注/朋友整屏播放）。
     *   老调用方不传 mode 时按 'modal' 处理（v2.5.77 只有这一种态）。
     */
    async _onDouyinModalState(evt) {
      if (!this._douyinEnabled) return;
      var opened = !!(evt && evt.opened);
      var mode = opened ? String((evt && evt.mode) || 'modal') : '';
      var prevMode = this._douyinMode || '';

      if (!opened) {
        this._douyinMode = '';
        this._deactivateDouyinModal();
        return;
      }

      // 这一种态被对应的开关关掉了 → 不接管。
      // 如果是从「开着的那种态」切过来的，必须把按钮撤掉，不能把它留在这一页。
      if (!this._douyinModeEnabled(mode)) {
        if (prevMode && prevMode !== mode) {
          this._douyinMode = '';
          this._deactivateDouyinModal();
        }
        return;
      }

      this._douyinMode = mode;

      // 熔断过（连续 5 次取不到内容）→ 不接管，等于回到「页面上没有按钮」。
      // 熔断按模式分开算：沉浸流取不到不该把弹窗一起停掉。
      if (this._isDouyinModalBreakerTripped(mode)) {
        this._hideExtractButton();
        return;
      }

      // 认不出是哪一条（还没渲染完 / 结构变了 / 未登录时信息区为空 / 切条瞬间）：
      // 一律不接管、不出按钮 —— 宁空不错。
      // 已接管时遇到瞬时空 ID（真机实测切条会短暂 acts=0）只保持现状，不闪一下再回来。
      var id = String((evt && evt.id) || '');
      if (!id) {
        if (!this._douyinActivated) this._hideExtractButton();
        return;
      }

      var prevId = this._douyinModalId || '';
      this._douyinModalId = id;

      // 是不是「换了页面」（推荐 / 关注 / 朋友 之间切标签）？
      // 用户 2026-10-27 定：**跨页切标签 → 把浮窗关掉**（不保留上一条的内容），
      // 但按钮必须留住并贴到新页的当前条；同一页里按 ↓ 切条才就地刷新。
      // 判据用 pathname：`/?recommend=1` 是 `/`、关注 `/follow`、朋友 `/friend`。
      // 只对沉浸流生效 —— 弹窗态（精选 / 搜索 / 主页）里换作品一律就地刷新，
      // 不受 pathname 影响（那些页面里 pathname 本来就不变）。
      var pageKey = '';
      try { pageKey = location.pathname; } catch (e) { pageKey = ''; }
      var prevPageKey = this._douyinPageKey || '';
      this._douyinPageKey = pageKey;
      var pageChanged = !!(prevPageKey && pageKey && prevPageKey !== pageKey && mode === 'immersive');
      if (pageChanged) {
        // 换页了，用户在上一条上拖过的位置没有意义，新页重新贴位
        this._douyinUserMoved = false;
      }

      // 缓存键按作品维度：同一条重复点 = 命中缓存，换一条 = 一定是新键。
      // 不能指望地址栏的 modal_id —— 实测抖音几秒后会把 `?modal_id=` 抹掉。
      this.activeShortcode = id || null;
      try {
        this.cacheKey = this.generateCacheKey(window.location.href, id || undefined);
      } catch (e) { /* 地址解析失败就沿用旧键，不影响提取 */ }

      if (!this._douyinActivated) {
        await this._activateDouyinComponents();
      } else {
        // 被撤下过再接管时（切到精选又切回来 / 关掉弹窗再点开另一条），
        // resize / scroll / ResizeObserver 监听已经被 _unbindDouyinAnchor 摘掉了，
        // 这里必须补挂回来，否则按钮只在接管那一刻算一次位置，之后不再跟随。
        this._bindDouyinAnchor();
        this._showExtractButton();
      }
      this._anchorDouyinButton();
      this._anchorDouyinRetry();

      var switched = !!(prevId && id && prevId !== id && this._douyinActivated);
      if (this.modalManager && this.modalManager.isOpen) {
        if (pageChanged) {
          // 跨页切标签：按用户拍板直接关掉浮窗（按钮留在新页继续可用）
          this._closeDouyinPanelOnly();
        } else if (switched) {
          // v2.9.6：同一页里换了一条（弹窗里切条 / 沉浸流按 ↓）。
          // 用户开着「换作品时收起浮窗」→ 关窗，**不再就地刷新** —— 沉浸流是整屏播放，
          // 浮窗就地刷新等于一直糊在画面正中挡着下一条（真机实测还会盖住右侧箭头和头像）。
          // 关掉这一项的老用户（含 type=其他站）仍是原来的就地刷新，行为一个字都不变。
          if (typeof ClipMateBrowseDismiss !== 'undefined' &&
              typeof ClipMateBrowseDismiss.shouldCloseOnSwitch === 'function' &&
              ClipMateBrowseDismiss.shouldCloseOnSwitch()) {
            this._closeDouyinPanelOnly('换了下一条，浮窗已关闭（按钮保留）');
          } else {
            this._refreshDouyinPanel();
          }
        }
      } else if (this.autoExtract) {
        // 与 Instagram 一致：自动开面板受 autoExtract 控制
        Promise.resolve(this.handleExtract()).catch(function (e) {
          this._douyinLog && this._douyinLog('warn', '自动提取失败：' + (e && e.message));
        }.bind(this));
      }
    },

    /** 第一次认出「正在播的那一条」时才把剩下的组件装好（列表页因此不会白初始化一堆东西） */
    async _activateDouyinComponents() {
      if (this._douyinActivated) return;
      if (!this.fieldMapper) {
        this.fieldMapper = await this.initFieldMapper('social');
      }
      this.initUI(); // 接上「点按钮」的动作，同时把灰按钮放开
      await this.refreshConfig(); // 读 showButton / autoExtract
      this._showExtractButton();
      this._bindDouyinAnchor();
      this._douyinActivated = true;
      this.isInitialized = true;
      this._douyinLog('info', '接管完成（mediaType=social，模式='
        + (this._douyinMode || 'modal') + '）');
    },

    /**
     * 只关浮窗，**不动按钮**。
     *
     * 用在「跨页切标签」：用户 2026-10-27 拍板「切标签不保留上一条的浮窗」，
     * 但按钮必须留在新页继续可用（这是 v2.5.81 的主修目标）。
     * 直接调现有 close()，不另写强制关 —— 避免留下半关状态。
     */
    _closeDouyinPanelOnly(logMsg) {
      try {
        if (this.modalManager && this.modalManager.isOpen) {
          this.modalManager.close();
          this._douyinLog('info', logMsg || '切到另一个标签页，浮窗已关闭（按钮保留）');
        }
      } catch (e) {
        this._douyinLog('warn', '关闭浮窗失败：' + (e && e.message));
      }
    },

    /** 这一条没了（关弹窗 / 切到不归本模块管的页面）：撤按钮 + 把已开的浮窗一起关（用户定的第 4 条） */
    _deactivateDouyinModal() {
      var wasActive = !!(this._douyinModalId || this._douyinActivated);
      this._douyinModalId = '';
      this._douyinUserMoved = false;
      this.activeShortcode = null;
      try {
        this.cacheKey = this.generateCacheKey(window.location.href);
      } catch (e) { /* 忽略 */ }

      this._closeDouyinPanelOnly();

      this._hideExtractButton();
      this._unbindDouyinAnchor();
      if (wasActive) this._douyinLog('info', '播放结束，按钮与浮窗一并撤下');
    },

    /**
     * 熔断标志在提取器类上（静态），拿不到就当没熔断。
     * @param {string} [mode] 'modal' | 'immersive'；不传 = 任一模式熔断都算
     */
    _isDouyinModalBreakerTripped(mode) {
      try {
        var Cls = (typeof window !== 'undefined') ? window.DouyinModalExtractor : null;
        return !!(Cls && typeof Cls.isDisabled === 'function' && Cls.isDisabled(mode));
      } catch (e) {
        return false;
      }
    },

    // ===================== 三、按钮显隐 =====================

    /** 把按钮插回页面（ButtonManager 构造时插过一次，弹窗没开时被摘掉了） */
    _showExtractButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try {
        bm.show();
      } catch (e) { /* 插不回去也不许打断流程 */ }
      this._anchorDouyinButton();
    },

    /** 摘掉按钮元素（保留引用，弹窗再开时直接 show 回来；不销毁，避免重建状态） */
    _hideExtractButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try {
        if (bm.button.parentNode) bm.button.parentNode.removeChild(bm.button);
        bm.button.removeAttribute('data-clipmate-anchor');
      } catch (e) { /* 忽略 */ }
    },

    // ===================== 四、贴住弹窗右上角 =====================

    /**
     * 按钮的锚点：
     *   弹窗态 → `modal-video-container`（那层浮层）
     *   沉浸流 → **只能**用「正在播的那一条」（`feed-active-video`）
     *
     * ⚠️ 沉浸流页不要去碰 `modal-video-container`：这个节点在抖音页面上**常驻**，
     * 平时是空的、几何为 0。真机实测踩过：按「先找弹层」的顺序，拿着一个 0 尺寸的空壳
     * 当锚点，`rect.width/height` 为 0 于是退回视口计算，按钮飘到顶边（top=20，
     * 正确位置是 72）。所以两种态各走各的锚点，不互相兜底。
     */
    _douyinAnchorElement() {
      if (this._douyinMode !== 'immersive') {
        try {
          var el = document.querySelector('[data-e2e="modal-video-container"]');
          if (el) return el;
        } catch (e) { /* 继续 */ }
      }
      try {
        var ctx = (typeof DouyinModalContext !== 'undefined') ? DouyinModalContext : null;
        if (ctx && typeof ctx.getRoot === 'function') return ctx.getRoot(document) || null;
      } catch (e) { /* 继续 */ }
      return null;
    },

    /**
     * 把按钮贴到弹窗右上角（内缩 16px），并夹在视口内。
     * 用户手动拖过（_douyinUserMoved）就不再抢位置 —— 他要放哪儿就放哪儿，
     * 直到弹窗关掉为止（关弹窗会把这个标志清掉）。
     */
    _anchorDouyinButton() {
      var bm = this.buttonManager;
      var btn = bm && bm.button;
      if (!btn || !this._douyinModalId) return;
      if (this._douyinUserMoved) return;

      var rect = null;
      try {
        var el = this._douyinAnchorElement();
        rect = el ? el.getBoundingClientRect() : null;
      } catch (e) {
        rect = null;
      }

      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var bw = btn.offsetWidth || FALLBACK_BUTTON_WIDTH;

      // 锚点右边缘 / 上边缘；宽度高度为 0 视为「没有几何」，退回视口
      var rightEdge = (rect && rect.width > 0) ? rect.right : vw;
      var topEdge = (rect && rect.height > 0) ? rect.top : 0;

      var left = Math.round(rightEdge - bw - ANCHOR_INSET);
      var top = Math.round(topEdge + ANCHOR_INSET);

      // 夹进视口（留 16px 边距），保证任何缩放下按钮都点得到
      var maxLeft = Math.max(ANCHOR_INSET, vw - bw - ANCHOR_INSET);
      var maxTop = Math.max(ANCHOR_INSET, vh - BUTTON_HEIGHT - ANCHOR_INSET);
      left = Math.max(ANCHOR_INSET, Math.min(left, maxLeft));
      top = Math.max(ANCHOR_INSET, Math.min(top, maxTop));

      btn.style.left = left + 'px';
      btn.style.top = top + 'px';
      btn.style.right = 'auto';
      btn.style.bottom = 'auto';
      // 标记区分两种态，真机脚本/单测靠它确认「贴的是哪一种」
      btn.setAttribute('data-clipmate-anchor', this._douyinMode === 'immersive' ? 'douyin-immersive' : 'douyin-modal');

      // 沉浸流切条后「这一条」的节点会换人，ResizeObserver 要跟着换观察目标，
      // 否则只在 resize / scroll 时才重算，播放器高度变化时按钮会飘。
      this._retargetDouyinResizeObserver();
    },

    /** 把 ResizeObserver 换到当前锚点上（同一个元素就不动，避免反复 observe/unobserve） */
    _retargetDouyinResizeObserver() {
      var ro = this._douyinResizeObserver;
      if (!ro || typeof ro.observe !== 'function') return;
      var el = null;
      try { el = this._douyinAnchorElement(); } catch (e) { el = null; }
      if (!el || el === this._douyinObservedEl) return;
      try {
        if (this._douyinObservedEl && typeof ro.unobserve === 'function') ro.unobserve(this._douyinObservedEl);
        ro.observe(el);
        this._douyinObservedEl = el;
      } catch (e) { /* 换不了就靠 resize / 切条事件兜住 */ }
    },

    /**
     * 接管后延时再贴几次。
     *
     * 为什么需要：接管那一刻抖音的播放器还在布局（真机实测 `feed-active-video`
     * 的 rect 会从 0/小值 涨到真正的 1280×809），只贴一次会停在过时的位置
     * （按钮 top=20，正确是 72）。这里在 250/700/1500ms 各补一次，
     * 期间用户拖过（_douyinUserMoved）或换了作品就停手。
     */
    _anchorDouyinRetry() {
      this._clearDouyinAnchorRetry();
      var self = this;
      var idAtSchedule = this._douyinModalId;
      this._douyinAnchorTimers = [250, 700, 1500].map(function (ms) {
        return setTimeout(function () {
          if (!self._douyinModalId || self._douyinModalId !== idAtSchedule) return;
          if (self._douyinUserMoved) return;
          self._anchorDouyinButton();
        }, ms);
      });
    },

    _clearDouyinAnchorRetry() {
      if (!this._douyinAnchorTimers) return;
      this._douyinAnchorTimers.forEach(function (t) { try { clearTimeout(t); } catch (e) { /* 忽略 */ } });
      this._douyinAnchorTimers = null;
    },

    /** 弹层尺寸变化 / 窗口缩放 / 页面滚动时重新贴位（rAF 节流，避免刷爆） */
    _scheduleDouyinAnchor() {
      if (this._douyinAnchorRaf) return;
      var self = this;
      var raf = window.requestAnimationFrame;
      if (typeof raf === 'function') {
        this._douyinAnchorRaf = raf.call(window, function () {
          self._douyinAnchorRaf = null;
          self._anchorDouyinButton();
        });
      } else {
        this._douyinAnchorRaf = setTimeout(function () {
          self._douyinAnchorRaf = null;
          self._anchorDouyinButton();
        }, 80);
      }
    },

    _bindDouyinAnchor() {
      if (this._douyinAnchorBound) return;
      this._douyinAnchorBound = true;
      var self = this;
      this._douyinAnchorHandler = function () { self._scheduleDouyinAnchor(); };
      try {
        window.addEventListener('resize', this._douyinAnchorHandler, { passive: true });
        // capture: true —— 抖音弹层内部的滚动容器不会冒泡到 window
        window.addEventListener('scroll', this._douyinAnchorHandler, { passive: true, capture: true });
      } catch (e) { /* 老内核不支持 options 对象时降级 */ }

      try {
        if (typeof window.ResizeObserver === 'function') {
          this._douyinResizeObserver = new window.ResizeObserver(this._douyinAnchorHandler);
          var el = this._douyinAnchorElement();
          if (el) {
            this._douyinResizeObserver.observe(el);
            this._douyinObservedEl = el;
          }
        }
      } catch (e) { /* jsdom / 老浏览器没有 ResizeObserver，靠 resize + 切条事件兜住 */ }

      // 用户拖动过按钮 → 放弃自动贴位（button-manager 保存位置时回调过来）
      if (this.buttonManager) {
        this.buttonManager.onPositionSaved = function () { self._douyinUserMoved = true; };
      }
    },

    _unbindDouyinAnchor() {
      this._clearDouyinAnchorRetry();
      if (this._douyinAnchorHandler) {
        try {
          window.removeEventListener('resize', this._douyinAnchorHandler);
          window.removeEventListener('scroll', this._douyinAnchorHandler, { capture: true });
        } catch (e) { /* 忽略 */ }
      }
      this._douyinAnchorHandler = null;
      if (this._douyinResizeObserver) {
        try { this._douyinResizeObserver.disconnect(); } catch (e) { /* 忽略 */ }
        this._douyinResizeObserver = null;
      }
      this._douyinObservedEl = null;
      if (this._douyinAnchorRaf) {
        try {
          if (typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(this._douyinAnchorRaf);
          else clearTimeout(this._douyinAnchorRaf);
        } catch (e) { /* 忽略 */ }
        this._douyinAnchorRaf = null;
      }
      this._douyinAnchorBound = false;
      if (this.buttonManager) this.buttonManager.onPositionSaved = null;
    },

    // ===================== 五、切下一条：浮窗就地刷新 =====================

    /**
     * 与 Instagram 的 _refreshOpenPanel 同构：重试最多 4 次（每次 400ms），
     * 因为抖音切条后信息区是异步渲染的，第一次往往还是上一条的空壳。
     * 判据用本模块自己的（文案 / 昵称 / 日期 / URL 至少一项有值），
     * 不能复用 IG 那份（里面有 IG 专属的个人资料文案正则）。
     */
    async _refreshDouyinPanel() {
      if (!this.modalManager || !this.modalManager.isOpen) return;
      var targetId = String(this._douyinModalId || '');
      for (var attempt = 0; attempt < 4; attempt++) {
        try {
          var data = await this.extractFromCurrentPage();
          // v2.9.5：光判「字段非空」不够 —— 切条瞬间 DOM 还是上一条，取回来的数据
          // 完全合法，于是第一次尝试就 updateInPlace(上一条) 并 return，
          // 用户看到的就是「浮窗永远停在第一条」。必须按作品 ID 对账。
          if (this._isDouyinDataValid(data) && this._douyinDataMatchesTarget(data, targetId)) {
            await this.modalManager.updateInPlace(data);
            this._douyinLog('info', '浮窗已就地刷新成新的一条');
            return;
          }
        } catch (e) {
          this._douyinLog('warn', '就地刷新失败：' + (e && e.message));
        }
        if (attempt < 3) await new Promise(function (r) { setTimeout(r, 400); });
      }
    },

    /**
     * 这份数据是不是「当前这一条」的？
     *
     * 判据用数据里的 URL（`/video/<id>` 或 `/note/<id>`）与上层记着的作品 ID 比对。
     * targetId 为空时一律放行 —— 认不出目标就不该拦，宁可沿用旧行为。
     */
    _douyinDataMatchesTarget(data, targetId) {
      if (!targetId) return true;
      var url = String((data && data.URL) || '');
      var m = /\/(?:video|note|slides)\/(\d{6,25})/.exec(url);
      if (!m) return true;   // URL 形态不认识 → 不拦（避免把正常数据挡掉）
      return m[1] === targetId;
    },

    /** 弹窗态「这份数据算不算取到了」：URL 有值且三要素至少一项非空 */
    _isDouyinDataValid(data) {
      if (!data || typeof data !== 'object') return false;
      var get = function (k) { return String(data[k] == null ? '' : data[k]).trim(); };
      if (!get('URL')) return false;
      return !!(get('本页文案') || get('作者昵称') || get('发布日期'));
    },

    // ===================== 六、类型补认 =====================

    /**
     * 播放态把媒体类型补认成 social（弹窗态与沉浸流态都走这里）。
     *
     * 为什么必须「接管之后」才生效（`_douyinActivated` 那道判断）：
     * init 阶段如果这里就返回 social，走的就是普通全流程 —— 按钮在 initComponents 里
     * 直接插进页面，**监听根本不会挂上**，于是切下一条不刷新、关弹窗按钮不撤。
     * 所以 init 阶段故意返回 null（让 init 走「挂监听」那条分支），
     * 真正需要类型的是接管之后的 extractFromCurrentPage()。
     */
    _douyinModalOverrideType() {
      try {
        if (!this._douyinActivated) return null;
        if (!this._isDouyinModalHost()) return null;
        if (!this._douyinModalId) return null;
        if (!this._douyinModeEnabled(this._douyinMode || 'modal')) return null;
        var ctx = (typeof DouyinModalContext !== 'undefined') ? DouyinModalContext : null;
        if (!ctx || typeof ctx.isOpen !== 'function') return null;
        if (!ctx.isOpen(document)) return null;
        return 'social';
      } catch (e) {
        return null;
      }
    },

    /** 退出前把监听摘干净（目前只有测试与「关掉开关」会走到） */
    _stopDouyinModalWatcher() {
      try {
        if (typeof this._douyinWatch === 'function') this._douyinWatch();
      } catch (e) { /* 忽略 */ }
      this._douyinWatch = null;
      this._douyinEnabled = false;
      this._douyinMode = '';
      this._douyinObservedEl = null;
      this._hideExtractButton();
      this._unbindDouyinAnchor();
    }
  };
})(typeof window !== 'undefined' ? window : null);
