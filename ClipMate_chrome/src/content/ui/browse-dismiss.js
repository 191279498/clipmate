/**
 * 浮窗自动收起（v2.9.4 / v2.9.6 重写）
 *
 * 【解决什么】
 *   浮窗是「看一眼结果」的东西。看完要往下翻或者切下一条作品时，它还杵在
 *   画面正中挡着，每次都得手动点关闭。本模块在浮窗打开期间监听三类「浏览动作」，
 *   命中就替用户把浮窗收起来 —— **只关浮窗，按钮保留**（沿用 v2.5.95 定下的规矩）。
 *
 * 【三类信号】v2.9.6 起全站统一，不再有站点豁免名单
 *   1. 滚动：任意滚动容器累计位移 ≥ SCROLL_THRESHOLD(200px)
 *   2. 地址：location.pathname 变化（不含 query / hash）
 *   3. 作品 ID：站内自带的换条监听（抖音 / 快手，`watch(cb)` → `{id, opened, mode}`）
 *
 * 【为什么 v2.9.4 的豁免名单被废掉】
 *   v2.9.4 让 5 个站「自己管地址信号」，理由是它们换条时会就地刷新浮窗、不该被压平成关窗。
 *   用户 2026-11-03 明确要求：社交站换下一条就是要关窗（否则挡住画面），
 *   而且抖音的沉浸流地址一个字都不变 —— 豁免名单等于让最需要关窗的站永远不关。
 *   现在改为：**一律关窗**，由各站 handler 判断开关后决定「关窗」还是「就地刷新」，
 *   判定权归各站，但默认行为由这里统一。
 *
 * 【为什么地址用轮询而不是包 history.pushState】
 *   隔离世界包 pushState 收不到页面自己的调用（v2.5.86 快手踩过这个坑，
 *   tiktok-fiber-hook 那套桥有记录）。现有各站换条判定也都是 250ms 轮询，
 *   这里保持一致。popstate 隔离世界能收到，一并监听做免费加速。
 *
 * 【四个必须防住的误关】（都有测试守着，拆掉就红）
 *   ① 浮窗自己的滚动不算。modal-table-renderer.js 每次刷新表格都会写
 *      contentElement.scrollTop 来还原滚动位置 —— 那是真实的 scroll 事件，
 *      判断不严就会「点个刷新窗自己没了」。
 *   ② 翻图不算换作品。小红书 / 抖音切图只改 ?image_index=，pathname 一个字不变；
 *      只比 pathname 天然免疫（v2.5.95 已有单测锁住「翻图不关窗」）。
 *   ③ 刚打开的 350ms 内不算。开窗瞬间页面可能还在惯性滚动 / 站点在补 replaceState。
 *   ④ 作品 ID 首次识别不算换条。抖音弹层打开后信息区是异步补上的，
 *      ID 从空变成有值会让签名变化，那是「认出来了」，不是「换了一条」。
 *
 * 【首滚不再被吞（v2.9.6）】
 *   v2.9.4 对没见过的滚动容器只记基线不累加，导致弹层里第一次滚评论区（尤其
 *   一滚就是几百像素）被整段吞掉，用户要滚第二次才关窗。现在在 wheel 一开始
 *   就给整条祖先链补基线（wheel 一定早于它引发的 scroll），首滚立刻生效。
 *
 * 【编辑模式整体豁免】
 *   编辑模式下用户正在浮窗里改字段名、拖排序，稍微滚一下就关是添乱。
 *   这里实时读 host.isEditMode（不是 arm 时快照），所以中途进编辑也能立刻生效。
 *
 * 【开关由谁来定（v2.9.6）】
 *   本站生效值由 site-config.resolve() 算出（社交站默认开、其余默认关，
 *   站点级可覆盖），content-main 读配置后调 setEnabled()。
 *   各站 handler 换条时先问 shouldCloseOnSwitch()：
 *      true  → 关窗（本模块之后不再介入）
 *      false → 保持原有的「就地刷新」行为，一个字都不变。
 */
(function (global) {
  'use strict';

  var GLIDE_MS = 350;          // 开窗后的宽限期
  var SCROLL_THRESHOLD = 200;  // 累计位移阈值（px）
  var POLL_MS = 250;           // 地址轮询间隔，与各站换条判定一致

  /**
   * 站内自带的「换条」监听（都是 `watch(cb, options)` → cb 收到 `{id, opened, mode}`）。
   *
   * 为什么不用站点域名写死：这几个 context 在**所有站点**的内容脚本里都加载了，
   * 只是只有对应站点会真的回调。按「对象在不在、有没有 watch」探测即可，
   * 将来某站加了自己的 watch，只要把全局名加进这个数组就接上了。
   */
  var SIGNAL_PROVIDERS = [
    'DouyinModalContext',
    'KuaishouImmersiveContext'
  ];

  /**
   * 已经声明「地址信号由站点自己管」的域名。
   * v2.9.6 起默认**空**（全站都由本模块判地址）；保留这个口子是为了将来某个站
   * 真需要一个更细的判定时，一行 declarePathOwner('xxx.com') 就能让开。
   */
  var pathOwned = [];

  /** hostname 是否命中「自己管地址信号」的站点（后缀匹配，子域名也算） */
  function hostOwnsPath(hostname) {
    var h = String(hostname || '').toLowerCase();
    for (var i = 0; i < pathOwned.length; i++) {
      var d = pathOwned[i];
      if (h === d || h.slice(-(d.length + 1)) === '.' + d) return true;
    }
    return false;
  }

  var log = function () {
    try {
      if (typeof ClipMateLog !== 'undefined' && ClipMateLog.debug) {
        ClipMateLog.debug.apply(ClipMateLog, ['[BrowseDismiss]'].concat([].slice.call(arguments)));
      }
    } catch (e) { /* 日志失败不影响行为 */ }
  };

  var BrowseDismiss = {
    _host: null,        // ModalManager 实例
    _enabled: true,     // 本站生效值（社交站开、其余站关；由 content-main 设置）
    _armed: false,
    _armedAt: 0,
    _pathCheck: true,   // 本次 arm 是否负责地址信号
    _startPath: '',
    _lastWorkId: '',    // 站点 watch 上一次报的作品 ID（基线）
    _acc: 0,            // 累计位移
    _offsets: null,     // WeakMap: 滚动容器 -> {top,left}
    _pollTimer: null,
    _onScroll: null,
    _onWheel: null,
    _onPopState: null,
    _unsubs: null,      // 站点 watch 的退订函数

    /** 设置开关。关掉立刻摘监听；重新打开时若浮窗还开着则重新挂上。 */
    setEnabled: function (on) {
      var next = (on !== false);
      if (next === this._enabled) return;
      this._enabled = next;

      if (!next) {
        var host = this._host;
        this._disarm();
        this._host = host; // 记住 host，重新开启时才能恢复
      } else if (this._host && this._host.isOpen) {
        this.arm(this._host);
      }
    },

    isEnabled: function () { return this._enabled; },

    /**
     * 换作品时该不该关窗（各站 handler 用）。
     *
     * true  → handler 关掉浮窗，**不要**就地刷新（用户开着「切下一条收浮窗」）
     * false → handler 沿用原来的就地刷新，一个字都不变
     */
    shouldCloseOnSwitch: function () { return this._enabled === true; },

    /**
     * 声明「这个站的地址信号由站点自己管」—— 之后本模块不再按 pathname 关窗。
     * v2.9.6 起默认名单为空，保留给将来某站想接管时用，一行即可，不用改本文件。
     */
    declarePathOwner: function (domain) {
      var d = String(domain || '').toLowerCase().replace(/^\./, '').trim();
      if (!d) return;
      if (pathOwned.indexOf(d) === -1) pathOwned.push(d);
      // 已经在跑的话立刻停掉轮询
      if (this._armed && this._pathCheck && hostOwnsPath(global.location.hostname)) {
        this._pathCheck = false;
        if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      }
    },

    /** 当前站点的地址信号是否由本模块负责（测试 / 调试用） */
    pathSignalEnabled: function () {
      return !hostOwnsPath(global.location.hostname);
    },

    /** 浮窗打开后调用 */
    arm: function (host) {
      if (!host) return;
      this._disarm();
      this._host = host;

      if (!this._enabled) return;

      this._armed = true;
      this._armedAt = Date.now();
      this._acc = 0;
      this._offsets = (typeof WeakMap === 'function') ? new WeakMap() : null;
      this._startPath = this._currentPath();
      this._lastWorkId = this._currentWorkId();

      // 给「整页滚动」先记一条基线：否则第一次滚轮事件会被当成「首次见到这个容器、
      // 只记位置不累加」，白白吞掉一格位移。弹层内部容器由 wheel 补基线（见 _primeChain）。
      if (this._offsets) {
        this._offsets.set(global.document, this._readOffset(global.document));
      }

      var self = this;

      this._onScroll = function (e) { self._handleScroll(e); };
      // 捕获阶段才能收到子容器的 scroll（scroll 不冒泡）
      global.document.addEventListener('scroll', this._onScroll, { capture: true, passive: true });

      // v2.9.6：wheel 早于它引发的 scroll，用它给整条祖先链补基线 → 首滚不再被吞
      this._onWheel = function (e) {
        if (!self._armed) return;
        if (self._isInsideWindow(e)) return;
        self._primeChain(e && e.target);
      };
      global.document.addEventListener('wheel', this._onWheel, { capture: true, passive: true });

      // 地址信号：站点自己管的时候，连轮询都不启（省掉每 250ms 一次的无用比较）
      this._pathCheck = !hostOwnsPath(global.location.hostname);
      if (this._pathCheck) {
        this._onPopState = function () { self._checkPath(); };
        global.addEventListener('popstate', this._onPopState);
        // 目的地址轮询：隔离世界拿不到页面自己的 pushState / replaceState
        this._pollTimer = setInterval(function () { self._checkPath(); }, POLL_MS);
      }

      // 作品 ID 信号：抖音沉浸流 / 快手推荐流地址不变、页面不滚，只能靠这个
      this._subscribeSignals();

      log('armed, path=', this._startPath, 'pathCheck=', this._pathCheck,
        'workId=', this._lastWorkId, 'enabled=', this._enabled);
    },

    /** 浮窗关闭后调用（幂等） */
    disarm: function () {
      this._disarm();
      this._host = null;
    },

    /** 内部：只拆监听，不清 host */
    _disarm: function () {
      if (this._onScroll) {
        global.document.removeEventListener('scroll', this._onScroll, true);
        this._onScroll = null;
      }
      if (this._onWheel) {
        global.document.removeEventListener('wheel', this._onWheel, true);
        this._onWheel = null;
      }
      if (this._onPopState) {
        global.removeEventListener('popstate', this._onPopState);
        this._onPopState = null;
      }
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
      if (this._unsubs) {
        for (var i = 0; i < this._unsubs.length; i++) {
          try { this._unsubs[i](); } catch (e) { /* 退订失败不影响行为 */ }
        }
        this._unsubs = null;
      }
      this._armed = false;
      this._pathCheck = false;
      this._acc = 0;
      this._offsets = null;
      this._lastWorkId = '';
    },

    _currentPath: function () {
      try { return String(global.location.pathname || ''); } catch (e) { return ''; }
    },

    /** 当前正在播的作品 ID（拿不到就空串；空串时首个信号只当基线） */
    _currentWorkId: function () {
      for (var i = 0; i < SIGNAL_PROVIDERS.length; i++) {
        var api = global[SIGNAL_PROVIDERS[i]];
        if (!api || typeof api.getWorkId !== 'function') continue;
        try {
          var id = api.getWorkId();
          if (id) return String(id);
        } catch (e) { /* 这个站读失败就看下一个 */ }
      }
      return '';
    },

    /** 订阅站点自带的换条监听（有几个订几个；都没有就静默跳过） */
    _subscribeSignals: function () {
      var self = this;
      this._unsubs = [];

      SIGNAL_PROVIDERS.forEach(function (name) {
        var api = global[name];
        if (!api || typeof api.watch !== 'function') return;
        try {
          var un = api.watch(function (evt) { self._handleSignal(evt); }, { debounceMs: 250 });
          if (typeof un === 'function') self._unsubs.push(un);
        } catch (e) {
          log('watch 订阅失败:', name, e && e.message);
        }
      });
    },

    /**
     * 站点报了一次播放状态。只有「确实是另一条作品」才关窗。
     *   opened=false（离开播放态）→ 不管：那种情况浮窗本来就会被站点自己关掉
     *   id 为空（认不出）        → 见下：稳定停在非作品内容上就关窗
     *   基线还空（本次开窗后第一次认出）→ 只记基线，不关
     */
    _handleSignal: function (evt) {
      if (!this._armed || !this._enabled) return;
      if (Date.now() - this._armedAt < GLIDE_MS) return;
      if (this._host && this._host.isEditMode) return;
      if (!evt || evt.opened === false) return;

      var id = String(evt.id || '');
      if (!id) {
        // v2.9.6 真机发现（2026-11-03）：抖音从视频切到直播时事件是 {id:'', opened:true}，
        // 浮窗会挂着旧作品的数据挡在直播上。抖音/快手的 context 都有 v2.5.81 的
        // pending 保护——「切视频的 0.9s 空窗」根本不会发空 ID 事件（那瞬间不回调），
        // 所以这里稳定收到的空 ID 只可能是「停在直播这类非作品上」→ 关窗不留旧数据。
        if (this._host && this._host.isOpen) this._dismiss('nonwork', evt.mode || '');
        return;
      }

      if (!this._lastWorkId) { this._lastWorkId = id; return; }
      if (id === this._lastWorkId) return;

      this._lastWorkId = id;
      this._dismiss('work', id);
    },

    /** 拿浮窗宿主元素（Shadow DOM 的 host） */
    _windowElement: function () {
      var fw = this._host && this._host.floatingWindow;
      return (fw && fw.windowElement) ? fw.windowElement : null;
    },

    /**
     * 事件是否发生在浮窗内部。
     * Shadow DOM 内的 scroll 到 document 时 target 会被 retarget 成 host，
     * 所以先比 target === host 快判，再用 composedPath 兜住非边界情况。
     */
    _isInsideWindow: function (e) {
      var el = this._windowElement();
      if (!el) return false;

      var t = e && e.target;
      if (t && t === el) return true;

      if (e && typeof e.composedPath === 'function') {
        var path = e.composedPath();
        if (path && path.length) return path.indexOf(el) !== -1;
      }

      return !!(t && el.contains && el.contains(t));
    },

    /** 滚动源归一：window / document / html / body 都算「整页」，其余当独立容器 */
    _normalizeTarget: function (target) {
      if (!target) return global.document;
      if (target === global.document || target === global.window ||
        target === global.document.documentElement || target === global.document.body) {
        return global.document;
      }
      return target;
    },

    /** 读某个滚动容器当前的位置 */
    _readOffset: function (target) {
      if (this._normalizeTarget(target) === global.document) {
        return { top: global.scrollY || 0, left: global.scrollX || 0 };
      }
      return { top: target.scrollTop || 0, left: target.scrollLeft || 0 };
    },

    /** 这个节点有没有可能滚（没可能就别往 WeakMap 里塞） */
    _isScrollable: function (el) {
      if (!el) return false;
      if (this._normalizeTarget(el) === global.document) return true;
      if (el.nodeType !== 1) return false;
      try {
        return (el.scrollHeight > el.clientHeight + 1) || (el.scrollWidth > el.clientWidth + 1);
      } catch (e) {
        return false;
      }
    },

    /**
     * 给「事件目标 → 祖先链」整条补滚动基线（v2.9.6，修首滚被吞）。
     *
     * wheel 一定早于它引发的 scroll。用户一滚，我们先把这一串容器此刻的位置记下来，
     * 紧接着的 scroll 就有基线可减，不用等下一次滚轮才计入位移。
     * 只补「还没有记录」的容器，且只补看起来真能滚的，不会把页面滚过留下的旧位置算进来。
     */
    _primeChain: function (target) {
      if (!this._offsets || !target) return;

      var node = target;
      var depth = 0;
      while (node && depth < 12) {
        if (this._isScrollable(node) && !this._offsets.has(node)) {
          this._offsets.set(node, this._readOffset(node));
        }
        node = node.parentNode || null;
        depth++;
      }
      if (!this._offsets.has(global.document)) {
        this._offsets.set(global.document, this._readOffset(global.document));
      }
    },

    _handleScroll: function (e) {
      if (!this._armed || !this._enabled) return;
      if (Date.now() - this._armedAt < GLIDE_MS) return;
      // 编辑模式豁免：实时读，中途进编辑立刻生效
      if (this._host && this._host.isEditMode) return;
      // ① 浮窗自己的滚动不算
      if (this._isInsideWindow(e)) return;

      var target = e ? e.target : global.document;
      var key = this._normalizeTarget(target);
      var now = this._readOffset(key);

      var prev = this._offsets ? this._offsets.get(key) : null;
      if (this._offsets) this._offsets.set(key, now);

      // 没见过这个容器（且没被 wheel 补过基线）：只记位置，不把「打开时已有的位置」算成位移
      if (!prev) return;

      this._acc += Math.abs(now.top - prev.top) + Math.abs(now.left - prev.left);
      if (this._acc >= SCROLL_THRESHOLD) {
        this._dismiss('scroll', this._acc);
      }
    },

    _checkPath: function () {
      if (!this._armed || !this._enabled) return;
      if (!this._pathCheck) return; // 站点自己管地址信号，本模块不插手
      if (Date.now() - this._armedAt < GLIDE_MS) return;
      // 编辑模式豁免 —— 与滚动判定保持一致，否则「编辑时滚不动但一点下一条就没了」
      if (this._host && this._host.isEditMode) return;

      var path = this._currentPath();
      if (path && path !== this._startPath) {
        this._startPath = path; // 先更新，避免 close 期间重复触发
        this._dismiss('path', path);
      }
    },

    /** 收起浮窗：只关窗，不动按钮 */
    _dismiss: function (reason, detail) {
      var host = this._host;
      if (!host) return;
      this._disarm();
      log('dismiss by', reason, detail);

      try {
        if (host.isOpen && typeof host.close === 'function') host.close();
      } catch (err) {
        log('close failed', err && err.message);
      }
    }
  };

  global.ClipMateBrowseDismiss = BrowseDismiss;
})(window);
