/**
 * 快手「站内跳转」接管（KuaishouRouteMixin）
 *
 * 解决的缺口（2026-10-28 真机对照实验）：
 *   快手和抖音不一样 —— 抖音在列表页点开作品是**弹层**（地址挂 ?modal_id=，文档不换），
 *   快手是**换地址不换文档**（SPA 路由），文档加载只发生一次。
 *   而 content-main 的 init() 只在文档加载时跑一遍，之后地址怎么变都没人管：
 *
 *     打开 /samecity 网格页 → 点开一条作品（地址变成 /short-video/xxx，文档没换）
 *       → 详情内容明明在（videoInfoTitle 1 个），按钮数却是 0
 *     同一地址按 F5 整页刷新（新文档）
 *       → 按钮 1 个
 *
 *   同一个地址「点进去没按钮、刷新一下有按钮」，原因就是「站内跳转没人接管」。
 *
 * 只做三件事，全部只在 www.kuaishou.com 上生效：
 *   1. 地址从「非详情」变成详情（`/short-video/`、`/video/`、`/photo/`）
 *      → 等详情内容真的渲染出来，再重跑一次「组件就绪 + 出按钮」。
 *   2. 地址从详情变回网格 / 流 → 撤按钮，已打开的浮窗一起关。
 *   3. 详情页之间换作品（站内点相关推荐）→ 按钮不动，只换缓存键；浮窗关掉
 *      （宁可让用户再点一次，也不把上一条的内容留在屏幕上）。
 *
 * 三条结构保证：
 *   - 域名门禁：`location.hostname !== 'www.kuaishou.com'` 时每个方法立刻返回，
 *     其他 30 多个站点连一个定时器都不会多。
 *   - 推荐流不抢：`/new-reco` 由 KuaishouSpaMixin 负责，本模块在那种页面上直接不挂。
 *   - 认不出就不出按钮：等详情内容最多 8 秒，等不到就这一次不接管（宁空不错）；
 *     连续 3 次等不到 → 本次会话熔断，不再重入。
 *
 * 为什么用「400ms 比对地址」而不是包 pushState：
 *   内容脚本跑在隔离世界，改 `history.pushState` 只影响自己那一份包装对象，
 *   页面自己的调用照样走原生实现 —— 包了也收不到。所以只能比对 + popstate。
 *   一次比对只是一个字符串比较，代价可以忽略。
 *
 * 依赖：ButtonManager（已有）、ModalManager（已有）、ExtractorFactory 派生的
 *       KuaishouSocialExtractor（已有）。不依赖 KuaishouSpaMixin 的任何私有状态。
 */
(function (global) {
  'use strict';

  /** 地址轮询间隔（ms）。只做字符串比较，不需要更密 */
  var POLL_MS = 400;
  /** 详情页路径白名单：只认这三种（与 media-detector / manifest 的 matches 对齐） */
  var DETAIL_RE = /^\/(?:short-video|video|photo)\/[A-Za-z0-9_-]{6,40}\/?$/;
  /** 个人主页路径：`/profile/<userId>`（v2.7.19，与 media-detector 的 person 规则同形） */
  var PROFILE_RE = /^\/profile\/[A-Za-z0-9_-]{6,64}\/?$/;
  /** 从路径里抠作品 ID（详情页之间的换作品判定） */
  var WORK_ID_RE = /\/(?:short-video|video|photo)\/([A-Za-z0-9_-]{6,40})/;
  /** 等「详情内容真的渲染出来」的上限 */
  var READY_TIMEOUT_MS = 8000;
  /** 等内容的轮询间隔 */
  var READY_POLL_MS = 250;
  /** 连续几次等不到就熔断（本次会话不再重入） */
  var BREAKER_MAX = 3;

  global.KuaishouRouteMixin = {

    // ===================== 一、入口 =====================

    /**
     * 挂上地址监听。
     *
     * 两个调用点（content-main.js）：
     *   - init 的「类型识别为空」分支：返回 true 表示「已接管，别走清理并退出那条路」；
     *   - init 成功（详情页）之后：返回 true 表示「监听已挂，用来感知离开」。
     *
     * @returns {boolean} true = 本模块已接管（调用方可以 return）
     */
    _startKuaishouRouteWatcher() {
      if (!this._ksRouteIsHost()) return false;
      if (this._ksRouteTimer) return true; // 已经挂过了

      // 推荐流有自己的接管（KuaishouSpaMixin），这里不掺和
      try {
        var ctx = (typeof KuaishouImmersiveContext !== 'undefined') ? KuaishouImmersiveContext : null;
        if (ctx && typeof ctx.isImmersivePage === 'function' && ctx.isImmersivePage()) return false;
      } catch (e) { /* 拿不到上下文就按「不是推荐流」处理 */ }

      // 网格页 / 搜索页：先把构造时插进去的灰按钮摘掉，回到「这个页面没有这个功能」。
      // 已经在详情页（init 成功分支的调用点）就不摘——那个按钮是要用的。
      //
      // v2.7.19：**个人主页也不摘**。主页的按钮是正常 init 流程建的（提 6 列人物档案），
      // 摘掉它等于把主页功能整个废掉（真机：刷新主页没按钮）。
      if (!this._ksRouteIsDetail(location.pathname) && !this._ksRouteIsProfile(location.pathname)) {
        this._ksRouteHideButton();
      }

      this._ksRouteLast = this._ksRoutePath();
      this._ksRouteFailStreak = 0;
      this._ksRouteDisabled = false;
      this._ksRouteActive = false;

      var self = this;
      this._ksRouteHandler = function () { self._ksRouteCheck(); };

      try {
        window.addEventListener('popstate', this._ksRouteHandler);
        window.addEventListener('hashchange', this._ksRouteHandler);
      } catch (e) { /* 老内核不支持也不影响：轮询照样兜住 */ }

      this._ksRouteTimer = setInterval(this._ksRouteHandler, POLL_MS);

      this._ksRouteLog('info', '站内跳转监听已启动（只比地址，不碰 DOM）');
      return true;
    },

    /** 摘干净（测试用；也供将来「关掉这个功能」时调用） */
    _stopKuaishouRouteWatcher() {
      if (this._ksRouteTimer) {
        try { clearInterval(this._ksRouteTimer); } catch (e) { /* 忽略 */ }
        this._ksRouteTimer = null;
      }
      if (this._ksRouteHandler) {
        try {
          window.removeEventListener('popstate', this._ksRouteHandler);
          window.removeEventListener('hashchange', this._ksRouteHandler);
        } catch (e) { /* 忽略 */ }
        this._ksRouteHandler = null;
      }
      this._ksRouteActive = false;
    },

    _ksRouteIsHost() {
      try {
        return location.hostname === 'www.kuaishou.com';
      } catch (e) {
        return false;
      }
    },

    _ksRouteLog(level, msg) {
      try {
        if (typeof ClipMateLog !== 'undefined' && ClipMateLog[level]) {
          ClipMateLog[level]('[KuaishouRoute] ' + msg);
          return;
        }
        if (typeof safeLog === 'function') safeLog('[KuaishouRoute] ' + msg);
      } catch (e) { /* 日志失败不许影响主流程 */ }
    },

    // ===================== 二、地址比对 =====================

    _ksRoutePath() {
      try {
        return location.pathname + location.search;
      } catch (e) {
        return '';
      }
    },

    /**
     * 是不是详情页（只认三种路径，宁少不多）。
     *
     * 入参允许传「路径」也允许传「路径+查询串」：内部先砍掉 `?` / `#` 再测。
     * 2026-10-28 真机踩过：_ksRouteCheck 里判断「上一拍是不是详情页」时传的是
     * `_ksRoutePath()`（含 `?authorId=…&streamSource=…`），而这里的正则带着 `$`，
     * 于是永远判成「不是详情页」→ 离开详情页时按钮不撤、浮窗不关。
     * 单测当时全绿，因为用例里的详情地址恰好不带查询串。
     */
    _ksRouteIsDetail(p) {
      var s = (p == null) ? '' : String(p);
      var cut = s.search(/[?#]/);
      if (cut >= 0) s = s.slice(0, cut);
      return DETAIL_RE.test(s);
    },

    /**
     * 是不是「个人主页」（v2.7.19）
     *
     * `/profile/<userId>` 在**正常 init 流程**里会被 media-detector 判成 person，
     * 按钮是 initUI() 建的、用来提 6 列人物档案。但它在路由监听眼里跟「发现 / 关注 /
     * 搜索结果」这些网格页没区别——都不是详情页——于是启动时那句
     * `_ksRouteHideButton()` 会把刚建好的按钮**连根拔掉**。
     *
     * 真机症状（2026-10-31 验收发现）：刷新快手主页一个按钮都没有，
     * 非得先点开一条作品弹层（弹层接管会再造一个按钮）才冒出来。
     * 所以这里把主页单独认出来：**主页不许摘按钮**。
     */
    _ksRouteIsProfile(p) {
      var s = (p == null) ? '' : String(p);
      var cut = s.search(/[?#]/);
      if (cut >= 0) s = s.slice(0, cut);
      return PROFILE_RE.test(s);
    },

    /** 从路径里抠作品 ID（抠不到返回空串） */
    _ksRouteWorkId(p) {
      var m = WORK_ID_RE.exec(String(p == null ? '' : p));
      return m ? m[1] : '';
    },

    /** 轮询 / popstate 统一入口：只有地址真的变了才往下走 */
    _ksRouteCheck() {
      var cur = this._ksRoutePath();
      if (cur === this._ksRouteLast) return;

      var prev = this._ksRouteLast;
      this._ksRouteLast = cur;

      if (this._ksRouteDisabled) return;

      // 注意两个入参都是「路径 + 查询串」：详情页在真机上一定带 ?authorId=…，
      // 所以必须靠 _ksRouteIsDetail 内部剥查询串，不能直接喂给正则。
      var wasDetail = this._ksRouteIsDetail(prev);
      var isDetail = this._ksRouteIsDetail(cur);

      if (wasDetail && isDetail) {
        this._ksRouteOnWorkChanged(prev, cur);
        return;
      }
      if (isDetail) {
        this._ksRouteEnter();
        return;
      }
      if (wasDetail) this._ksRouteLeave();
      // 非详情 → 非详情（网格换栏目）：什么都不用做
    },

    // ===================== 三、进详情页 =====================

    async _ksRouteEnter() {
      if (this._ksRouteEntering) return;
      this._ksRouteEntering = true;
      try {
        // 从推荐流直接点进详情：先把推荐流那套撤掉，免得两套都认为自己在接管
        if (this._ksActivated && typeof this._deactivateKuaishouImmersive === 'function') {
          try { this._deactivateKuaishouImmersive(); } catch (e) { /* 忽略 */ }
        }

        var ready = await this._ksRouteWaitReady();
        if (!ready) {
          // 页面可能已经又走了（用户手快），这种情况不算失败
          if (!this._ksRouteIsDetail(location.pathname)) return;

          this._ksRouteFailStreak = (this._ksRouteFailStreak || 0) + 1;
          this._ksRouteLog('warn', '详情内容 8 秒内没出现（第 ' + this._ksRouteFailStreak + ' 次）');
          if (this._ksRouteFailStreak >= BREAKER_MAX) {
            this._ksRouteDisabled = true;
            this._ksRouteLog('warn', '连续 ' + BREAKER_MAX + ' 次失败，本次会话不再接管');
          }
          return;
        }

        this._ksRouteFailStreak = 0;
        await this._ksRouteActivate();
      } catch (e) {
        this._ksRouteLog('warn', '进入详情页接管失败：' + (e && e.message));
      } finally {
        this._ksRouteEntering = false;
      }
    },

    /**
     * 等「详情内容真的渲染出来」。
     *
     * 判据要宽松但必须命中真内容：SPA 跳转后骨架屏还在时，detectMediaType() 已经
     * 按路径返回 social 了（它只看 URL），这时候出按钮，用户点下去会提取到空字段。
     *
     * 2026-10-28 真机量化（同城页点开一条，每 200ms 采一次）：
     *   465ms → video 1 个，但页面文字只有 44 字（空壳）
     *   601ms → 页面文字 462 字（真正到位）
     * 所以「有 video」不够，必须同时有正文，否则会在空壳那 136ms 里出按钮。
     */
    _ksRouteDetailReady() {
      try {
        var d = document;
        if (!d || !d.body) return false;
        var text = (d.body.innerText != null) ? d.body.innerText : (d.body.textContent || '');
        var len = text.length;
        if (d.querySelector('video') && len > 150) return true;
        if (d.querySelector('[class*="videoInfoTitle"], [class*="video-info"], [class*="VideoInfo"]') && len > 60) return true;
        // 兜底：连 video 都没取到时，至少要能看到详情区那几行字
        return len > 400 && /发布时间|点赞|评论/.test(text);
      } catch (e) {
        return false;
      }
    },

    /** 轮询等到内容出现；中途离开详情页立刻放弃 */
    _ksRouteWaitReady() {
      var self = this;
      return new Promise(function (resolve) {
        var started = Date.now();
        (function tick() {
          if (!self._ksRouteIsDetail(location.pathname)) return resolve(false);
          if (self._ksRouteDetailReady()) return resolve(true);
          if (Date.now() - started >= READY_TIMEOUT_MS) return resolve(false);
          setTimeout(tick, READY_POLL_MS);
        })();
      });
    },

    /** 组件就绪 + 出按钮（复用已有实例，能复用就不重建） */
    async _ksRouteActivate() {
      // v2.7.19：类型要**跟着走**，不能只看「有没有映射器」。
      // 从个人主页站内跳到详情页时 fieldMapper 已经存在（person 的 6 列），
      // 老实现 `if (!this.fieldMapper)` 会直接复用它 —— 于是作品页按 6 列人物档案去提。
      // `_ksMapperType` 与 KuaishouSpaMixin 共用同一个标记，两边不会各说各话。
      if (!this.fieldMapper || this._ksMapperType !== 'social') {
        this.fieldMapper = await this.initFieldMapper('social');
        this._ksMapperType = 'social';
      }

      // 按钮可能已经在 init 失败分支里被摘掉（button 置 null 了），那就重建一个
      if (!this.buttonManager || !this.buttonManager.button) {
        try {
          this.buttonManager = new ButtonManager();
        } catch (e) {
          this._ksRouteLog('warn', 'ButtonManager 不可用：' + (e && e.message));
          return;
        }
      }
      this._ksRouteEnsureSingleButton();

      this.initUI();                 // setClickHandler → 按钮从置灰变可点
      await this.refreshConfig();    // 尊重「显示提取按钮」开关
      this._ksRouteShowButton();

      this.isInitialized = true;
      this._ksRouteActive = true;
      this.activeShortcode = null;
      try { this.cacheKey = this.generateCacheKey(window.location.href); } catch (e) { /* 地址解析失败就沿用旧键 */ }

      this._ksRouteLog('info', '站内跳转接管完成（mediaType=social，入口=detail）');
    },

    /** 页面上只允许有 1 个提取按钮（验收口径） */
    _ksRouteEnsureSingleButton() {
      try {
        var all = document.querySelectorAll('.media-extractor-button');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (this.buttonManager && el === this.buttonManager.button) continue;
          if (el.parentNode) el.parentNode.removeChild(el);
        }
      } catch (e) { /* 忽略 */ }
    },

    _ksRouteShowButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try { bm.show(); } catch (e) { /* 插不回去也不许打断流程 */ }
    },

    _ksRouteHideButton() {
      var bm = this.buttonManager;
      if (!bm || !bm.button) return;
      try {
        if (bm.button.parentNode) bm.button.parentNode.removeChild(bm.button);
        bm.button.removeAttribute('data-clipmate-anchor');
      } catch (e) { /* 忽略 */ }
    },

    // ===================== 四、离开详情页 =====================

    _ksRouteLeave() {
      this._ksRouteActive = false;
      this.isInitialized = false;
      this.activeShortcode = null;

      try {
        if (this.modalManager && this.modalManager.isOpen) this.modalManager.close();
      } catch (e) {
        this._ksRouteLog('warn', '关闭浮窗失败：' + (e && e.message));
      }

      // v2.7.19：退回去的是**个人主页**就不能摘按钮 —— 那页本来就有 6 列人物档案可提。
      // 而且只留按钮还不够：模板此刻还是 social 的 7 列，点下去会出作品字段。
      // 这里复用弹层关闭那条路的回切，保证「关弹层回主页」和「从详情页退回主页」行为一致。
      if (this._ksRouteIsProfile(location.pathname)) {
        this._ksRouteRestoreProfilePerson();
        try { this.cacheKey = this.generateCacheKey(window.location.href); } catch (e) { /* 忽略 */ }
        this._ksRouteLog('info', '回到个人主页，按钮保留并切回人物档案模板');
        return;
      }

      this._ksRouteHideButton();
      try { this.cacheKey = this.generateCacheKey(window.location.href); } catch (e) { /* 忽略 */ }
      this._ksRouteLog('info', '离开详情页，按钮与浮窗一并撤下');
    },

    /**
     * 退到个人主页时把模板切回 6 列人物档案（v2.7.19）
     *
     * `_restoreKuaishouProfilePerson()` 在 KuaishouSpaMixin 里（弹层关掉走的就是它）。
     * 路由这条路上它是**可选**的（只有挂了 spa mixin 才有），拿不到就至少把按钮保住。
     */
    _ksRouteRestoreProfilePerson() {
      var self = this;
      var done = function () {
        self.isInitialized = true;
        self._ksRouteShowButton();
      };
      try {
        if (typeof this._restoreKuaishouProfilePerson === 'function') {
          Promise.resolve(this._restoreKuaishouProfilePerson())
            .then(done)
            .catch(function (e) {
              self._ksRouteLog('warn', '回到个人主页失败：' + (e && e.message));
            });
          return;
        }
      } catch (e) {
        this._ksRouteLog('warn', '回到个人主页失败：' + (e && e.message));
      }
      done();
    },

    // ===================== 五、详情页之间换作品 =====================

    /**
     * 站内从一条作品点到另一条（相关推荐）。
     * 同一个作品 ID 只是参数变了（快手会自己 replaceState 加 streamSource 之类）→ 什么都不做，
     * 否则会把用户正在看的浮窗莫名其妙关掉。
     */
    _ksRouteOnWorkChanged(prev, cur) {
      var prevId = this._ksRouteWorkId(prev);
      var curId = this._ksRouteWorkId(cur);
      if (prevId && curId && prevId === curId) {
        try { this.cacheKey = this.generateCacheKey(window.location.href); } catch (e) { /* 忽略 */ }
        return;
      }
      // 真的换了另一条：浮窗关掉（不把上一条的内容留在屏幕上），按钮保留
      try {
        if (this.modalManager && this.modalManager.isOpen) this.modalManager.close();
      } catch (e) { /* 忽略 */ }
      try { this.cacheKey = this.generateCacheKey(window.location.href); } catch (e) { /* 忽略 */ }
      this._ksRouteLog('info', '详情页换了一条作品，浮窗已关闭');
    }
  };
})(typeof window !== 'undefined' ? window : null);
