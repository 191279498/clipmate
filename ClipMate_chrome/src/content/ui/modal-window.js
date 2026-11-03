/**
 * ModalManager 窗口编排模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  global.ModalWindowMixin = {

    async updateInPlace(data) {
    if (!this.floatingWindow) {
      // 兜底：面板未开则按原逻辑开新面板
      return this.open(data);
    }
    await this._prepareData(data);
    // 第二层防线：数据指纹。与上次渲染完全一致就直接返回、不碰 DOM，
    // 这样即使将来又出现别的自动刷新来源，浮窗也不会闪、更不会打断用户选字。
    const fp = (typeof this._computeDataFingerprint === 'function')
      ? this._computeDataFingerprint()
      : '';
    if (fp && fp === this._lastRenderFingerprint) {
      return;
    }
    this.updateTable();
    },

    async open(data) {
    const startTime = performance.now();
    ClipMateLog.debug('===== 开始打开悬浮窗 =====');
    ClipMateLog.debug(`准备展示的数据字段数: ${Object.keys(data).length}`);

    try {
      // 等待悬浮窗组件加载
      if (!FloatingWindowClass) {
        await new Promise(resolve => {
          const checkInterval = setInterval(() => {
            if (FloatingWindowClass) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 50);

          // 设置超时，防止无限等待
          setTimeout(() => {
            clearInterval(checkInterval);
            console.warn('悬浮窗组件加载超时，使用默认模态窗口');
            resolve();
          }, 2000);
        });
      }

      // 数据预处理（字段过滤/排序/映射/编辑态备份），open 与 updateInPlace 共用
      await this._prepareData(data);

      // v2.5.45：读取界面偏好（按媒体类型记住的尺寸/布局）
      await this.loadUiPrefs();
      // 恢复上次的显示方向（横向/纵向）
      const savedLayout = this._getUiPref(this.getMediaType()).layout;
      if (savedLayout === 'horizontal' || savedLayout === 'vertical') {
        this.displayMode = savedLayout;
      } else if (this.getMediaType() === 'person') {
        // v2.7.11：人物档案默认横向。
        // 人物档案列少且字段短（影人 12 列 / 账号 6 列），横向一屏能看全；
        // 一旦用户手动切过，上面的 savedLayout 优先，不再被这条覆盖。
        this.displayMode = 'horizontal';
      }

      // 创建悬浮窗
      this.createFloatingWindow();

      // 设置状态
      this.isOpen = true;
      // v2.9.4：挂上「滚动 / 换作品就收起」的监听。放在 isOpen=true 之后 ——
      // 监听器的豁免判断要读 host.isOpen；放在前面会被当成「没开着」。
      if (typeof ClipMateBrowseDismiss !== 'undefined' && ClipMateBrowseDismiss.arm) {
        ClipMateBrowseDismiss.arm(this);
      }
      // v2.5.45：接线 ESC 关闭 + 编辑模式表头双击改名。
      // （attachEvents 原先全项目 0 调用，是纯死代码；ESC 和改名的监听都埋在里面）
      this.attachEvents();
      // v2.5.45：窗口大小变化时把浮窗收回可视区
      this._bindWindowResize();

      ClipMateLog.debug(`悬浮窗打开完成，总耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      ClipMateLog.debug('===== 悬浮窗打开完成 =====');
    } catch (error) {
      console.error('打开悬浮窗失败:', error, {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
      throw error;
    }
    },

    close() {
    // 防止重复调用
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;
    const startTime = performance.now();
    ClipMateLog.debug('===== 开始关闭悬浮窗 =====');

    // v2.9.4：先摘掉自动收起监听（关窗路径有好几条：ESC / 按钮 / 自动收起 / 站点换条），
    // 统一在 here 收口，避免漏摘导致「窗关了监听还在跑」。
    if (typeof ClipMateBrowseDismiss !== 'undefined' && ClipMateBrowseDismiss.disarm) {
      ClipMateBrowseDismiss.disarm();
    }

    try {
      // 移除ESC键事件监听
      if (this.escKeyHandler) {
        document.removeEventListener('keydown', this.escKeyHandler);
        this.escKeyHandler = null;
      }

      // v2.5.45：移除窗口 resize 监听
      this._unbindWindowResize();

      // v2.9.8：开窗后的锚定校准定时器跟着关（窗口没了就别再锚了）
      if (this._anchorTimer) {
        clearTimeout(this._anchorTimer);
        this._anchorTimer = null;
        this._anchorStep = null;
      }

      // v2.5.47：搜索条 / 快捷键 / 标题栏菜单跟着浮窗一起清掉，避免下次开窗残留
      if (typeof this._destroySearchBar === 'function') this._destroySearchBar();
      if (typeof this._unbindSearchShortcut === 'function') this._unbindSearchShortcut();
      if (typeof this._hideTitleMenu === 'function') this._hideTitleMenu();

      // 关闭悬浮窗
      if (this.floatingWindow) {
        // 先移除onClose回调，防止循环调用
        const originalOnClose = this.floatingWindow.onClose;
        this.floatingWindow.onClose = null;

        // 关闭悬浮窗
        this.floatingWindow.close();
        this.floatingWindow = null;

        // 恢复原始回调（如果需要重新创建悬浮窗）
        if (originalOnClose) {
          this.originalOnClose = originalOnClose;
        }
      }

      // 重置状态
      this.isOpen = false;
      this.isClosing = false;

      ClipMateLog.debug(`悬浮窗关闭完成，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      ClipMateLog.debug('===== 悬浮窗关闭完成 =====');
    } catch (error) {
      this.isClosing = false;
      console.error('关闭悬浮窗失败:', error);
    }
    },

    /**
     * 计算浮窗位置（v2.5.45）
     * 直接定位到我们自己的提取按钮下方：右边缘对齐、顶部留 8px；
     * 按钮被隐藏或不存在时退到右上角；最后统一做四边边界收拢。
     */
    _computeFloatingPosition(width, height) {
      const gap = 8;
      // v2.8.6：按钮左端的吉祥物头像比按钮高，向下溢出约 10px。
      // 贴按钮下沿的间距必须大于这个溢出量，否则浮窗会盖住它的下巴。
      const BTN_GAP = 12;
      let x = Math.max(gap, window.innerWidth - width - 20);
      let y = 72; // 按钮默认 top:20 + 高约 44 + 间距

      try {
        const btn = document.querySelector('.media-extractor-button');
        if (btn && getComputedStyle(btn).display !== 'none') {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            x = r.right - width;   // 右边缘对齐按钮右边缘
            y = r.bottom + BTN_GAP;    // 贴在按钮正下方（让开溢出的头像）
          }
        }
      } catch (e) { /* 拿不到按钮就用兜底位置 */ }

      // 边界收拢：左右各留 gap；顶部保证至少 120px 可见，不会整个跑到屏幕外
      x = Math.max(gap, Math.min(x, window.innerWidth - width - gap));
      const maxY = Math.max(gap, window.innerHeight - 120);
      y = Math.max(gap, Math.min(y, maxY));
      return { x: Math.round(x), y: Math.round(y) };
    },

    /* ================= v2.9.7：尺寸约束 + 按钮浮窗联动 ================= */

    /**
     * 全局尺寸约束（设置页 → content-main 调进来）。
     * width: 浮窗固定宽度（320–1200）；maxHeight: 高度自适应的上限（300–2000）。
     * 改动对「下一次打开」生效；窗口开着时不强行改当前尺寸。
     */
    setUiConstraints(cons) {
      this._uiConstraints = Object.assign({}, this._uiConstraints || {}, cons || {});
      const fw = this.floatingWindow;
      if (fw && typeof fw.autoFitHeight === 'function') {
        fw._heightCap = this._maxHeightPx();
        this._autoFitHeight();
      }
    },

    /** 高度上限：设置的 maxHeight 与屏幕可用高度取小（保证浮窗不出屏） */
    _maxHeightPx() {
      const cons = this._uiConstraints || {};
      const raw = Math.max(300, Math.min(parseInt(cons.maxHeight, 10) || 800, 2000));
      return Math.min(raw, Math.max(240, window.innerHeight - 16));
    },

    /** 渲染后按内容收紧高度（minimized/collapsed/maximized 状态不动） */
    _autoFitHeight() {
      const fw = this.floatingWindow;
      if (!fw || !this.isOpen) return;
      if (typeof fw.autoFitHeight === 'function') fw.autoFitHeight(this._maxHeightPx());
      // v2.9.7 真机修复：高度贴合内容后（内容多时顶到上限 800），底部可能超出视口
      //（豆瓣实测 y=165 + 800 = 965 > 877）。这里把整窗收回屏内，保证「不移出浏览器窗口」。
      const gap = 8;
      const maxY = Math.max(gap, window.innerHeight - fw.height - gap);
      const maxX = Math.max(gap, window.innerWidth - fw.width - gap);
      if (fw.y > maxY || fw.x > maxX) {
        fw.y = Math.min(fw.y, maxY);
        fw.x = Math.min(fw.x, maxX);
        if (typeof fw.updatePosition === 'function') fw.updatePosition();
        this._syncPair();
      }
    },

    /**
     * 接线按钮（content-main 在创建 buttonManager 后调一次）。
     * 拖按钮 → onDragMove 报绝对目标位置 → 浮窗跟；浮窗拖动反过来走 onMove。
     */
    attachButton(buttonManager) {
      this._buttonHandle = buttonManager || null;
      if (buttonManager && typeof buttonManager === 'object') {
        const self = this;
        buttonManager.onDragMove = function (left, top) { self._onBtnDragged(left, top); };
      }
    },

    _buttonEl() {
      if (this._buttonHandle && this._buttonHandle.button) return this._buttonHandle.button;
      return document.querySelector('.media-extractor-button');
    },

    /** 记下两侧当前位置，作为后续增量的基准（开窗后、各处搬动后都要调） */
    _syncPair() {
      const fw = this.floatingWindow;
      const el = this._buttonEl();
      if (!fw || !el) { this._pairFwPos = null; this._pairBtnPos = null; return; }
      this._pairFwPos = { x: fw.x, y: fw.y };
      this._pairBtnPos = { x: el.offsetLeft, y: el.offsetTop };
    },

    /**
     * 浮窗动了（拖标题栏 / 拖胶囊）→ 按钮走同样距离；
     * 按钮被视口边界挡住的部分，浮窗也收回来（保持整对刚体）。
     */
    _onFwMoved(pos) {
      const fw = this.floatingWindow;
      const el = this._buttonEl();
      if (!fw || !el || !pos) { this._syncPair(); return; }
      const prevFw = this._pairFwPos;
      const prevBtn = this._pairBtnPos;
      if (!prevFw || !prevBtn) { this._syncPair(); return; }

      const dx = pos.x - prevFw.x;
      const dy = pos.y - prevFw.y;
      if (!dx && !dy) return;

      const nbx = Math.max(0, Math.min(prevBtn.x + dx, window.innerWidth - el.offsetWidth));
      const nby = Math.max(0, Math.min(prevBtn.y + dy, window.innerHeight - el.offsetHeight));
      const fdx = nbx - prevBtn.x;
      const fdy = nby - prevBtn.y;

      if (fdx !== dx || fdy !== dy) {
        // 按钮到边了 → 浮窗跟着停，整对不许拆开
        fw.x = prevFw.x + fdx;
        fw.y = prevFw.y + fdy;
        if (typeof fw.updatePosition === 'function') fw.updatePosition();
      }

      el.style.left = nbx + 'px';
      el.style.top = nby + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      // 按钮本体被外部搬动了，同步它的内部基准（不落盘，收尾统一落）
      if (this._buttonHandle && typeof this._buttonHandle.applyExternalPosition === 'function') {
        this._buttonHandle.applyExternalPosition(nbx, nby);
      }
      this._buttonPosDirty = true;
      this._pairFwPos = { x: fw.x, y: fw.y };
      this._pairBtnPos = { x: nbx, y: nby };
    },

    /**
     * 按钮动了（拖按钮）→ 浮窗走同样距离；
     * 浮窗被视口边界挡住的部分，按钮也收回来。
     * （按钮自己的视口钳制照旧生效，这里的 extra 钳制来自浮窗。）
     */
    _onBtnDragged(left, top) {
      const fw = this.floatingWindow;
      if (!fw || !this.isOpen) return;
      const prevFw = this._pairFwPos;
      const prevBtn = this._pairBtnPos;
      if (!prevFw || !prevBtn) { this._syncPair(); return; }

      const dx = left - prevBtn.x;
      const dy = top - prevBtn.y;
      if (!dx && !dy) return;

      const gap = 8;
      const nfx = Math.max(gap, Math.min(prevFw.x + dx, window.innerWidth - fw.width - gap));
      // 高度超出视口时只保顶部（底部允许溢出；上限设置基本挡住了这种情形）
      const fyMax = Math.max(gap, window.innerHeight - fw.height - gap);
      const nfy = Math.max(gap, Math.min(prevFw.y + dy, fyMax));
      const bdx = nfx - prevFw.x;
      const bdy = nfy - prevFw.y;

      if (bdx !== dx || bdy !== dy) {
        // 浮窗到边了 → 按钮也跟着停（把按钮的目标位置往回收）
        const el = this._buttonEl();
        if (el && this._buttonHandle && typeof this._buttonHandle.applyExternalPosition === 'function') {
          const nbx = prevBtn.x + bdx;
          const nby = prevBtn.y + bdy;
          this._buttonHandle.applyExternalPosition(nbx, nby);
          el.style.left = nbx + 'px';
          el.style.top = nby + 'px';
        }
      }

      fw.x = nfx;
      fw.y = nfy;
      if (typeof fw.updatePosition === 'function') fw.updatePosition();
      this._pairFwPos = { x: fw.x, y: fw.y };
      this._pairBtnPos = { x: prevBtn.x + bdx, y: prevBtn.y + bdy };
      this._buttonPosDirty = true;
    },

    /** 联动拖动收尾：按钮最终位置落盘（一次） */
    _commitButtonPos() {
      if (!this._buttonPosDirty) return;
      this._buttonPosDirty = false;
      const el = this._buttonEl();
      const h = this._buttonHandle;
      if (el && h && typeof h.commitExternalPosition === 'function') {
        h.commitExternalPosition(el.offsetLeft, el.offsetTop);
      }
    },

    /**
     * v2.9.8：开窗后的锚定校准。
     * 开窗恰发生在提取收尾的瞬间，按钮还处于 busy 态「提取中」——文字比稳态
     * 宽出一个字（豆瓣实测 139 → 156），_computeFloatingPosition 按瞬态 rect
     * 锚定，浮窗就稳定偏几十 px（真机 17px）。这里等按钮尺寸连续两拍不变
     * （= 回到稳态）后，把浮窗重新锚到按钮正下方一次：只动浮窗、不动按钮。
     * 用户已拖动过（_buttonPosDirty）或窗口已关 / 已收起则放弃。
     * _anchorStep 独立成实例方法是为了测试可以同步驱动，不必真等 setTimeout。
     */
    _scheduleAnchorCalibration() {
      if (this._anchorTimer) clearTimeout(this._anchorTimer);
      this._anchorLast = { w: -1, h: -1 };
      this._anchorStable = 0;
      this._anchorTries = 0;
      this._anchorStep = () => {
        this._anchorTimer = null;
        const fw = this.floatingWindow;
        if (!fw || !this.isOpen || this._buttonPosDirty) return;
        if (fw.isMinimized || fw.isCollapsed || fw.isMaximized) return;
        const el = this._buttonEl();
        if (!el) return;
        let w = 0, h = 0;
        try { const r = el.getBoundingClientRect(); w = r.width; h = r.height; } catch (e) { return; }
        if (w === this._anchorLast.w && h === this._anchorLast.h) this._anchorStable++;
        else { this._anchorStable = 0; this._anchorLast = { w, h }; }
        if (this._anchorStable < 2) {
          if (++this._anchorTries > 20) return; // 约 4s 仍不稳就放弃，绝不无限循环
          this._anchorTimer = setTimeout(this._anchorStep, 200);
          return;
        }
        const pos = this._computeFloatingPosition(fw.width, 0);
        if (pos.x !== fw.x || pos.y !== fw.y) {
          fw.x = pos.x;
          fw.y = pos.y;
          if (typeof fw.updatePosition === 'function') fw.updatePosition();
        }
        this._syncPair();
      };
      this._anchorTimer = setTimeout(this._anchorStep, 200);
    },

    /* ============== v2.9.7 联动结束 ============== */

    /** 读取某媒体类型记住的界面偏好（尺寸/布局） */
    _getUiPref(mediaType) {
      const prefs = this.uiPrefs || {};
      return prefs[mediaType] || {};
    },

    /**
     * 把当前字段数同步到最小化胶囊（v2.5.47 / B3）
     * 每次渲染后调用：最小化着的时候数据若变了，胶囊上的数字也要跟着变。
     */
    _syncCapsuleCount() {
      const fw = this.floatingWindow;
      if (!fw || typeof fw.setCapsuleCount !== 'function') return;
      const count = Array.isArray(this.fieldOrder) ? this.fieldOrder.length : 0;
      fw.setCapsuleCount(count);
    },

    /** 写入界面偏好：内存立即生效，落盘异步且失败不影响使用 */
    _saveUiPref(mediaType, patch) {
      if (!this.uiPrefs) this.uiPrefs = {};
      this.uiPrefs[mediaType] = Object.assign({}, this.uiPrefs[mediaType] || {}, patch);
      try {
        if (typeof WBR !== 'undefined' && WBR.storage && WBR.storage.local) {
          Promise.resolve(WBR.storage.local.set({ clipmate_ui_prefs: this.uiPrefs })).catch(() => {});
        }
      } catch (e) { /* 存储不可用时只在本次会话内生效 */ }
    },

    /** 从 storage 读取界面偏好（open 时调用一次） */
    async loadUiPrefs() {
      try {
        if (typeof WBR !== 'undefined' && WBR.storage && WBR.storage.local) {
          const r = await WBR.storage.local.get('clipmate_ui_prefs');
          this.uiPrefs = (r && r.clipmate_ui_prefs) || {};
        }
      } catch (e) {
        this.uiPrefs = {};
      }
    },

    /**
     * 窗口大小变化时把浮窗收回可视区（v2.5.45）
     * 项目原先没有任何 resize 监听，换个显示器或缩小窗口后浮窗会停在屏幕外找不回来。
     * v2.9.7：整对回位 —— 浮窗被推回来多少，按钮也跟着走多少（联动不许拆）。
     */
    _bindWindowResize() {
      if (this._resizeHandler) return;
      this._resizeHandler = () => {
        const fw = this.floatingWindow;
        if (!fw || !this.isOpen) return;
        const gap = 8;
        const x = Math.max(gap, Math.min(fw.x, window.innerWidth - fw.width - gap));
        const y = Math.max(gap, Math.min(fw.y, window.innerHeight - 120));
        const dx = x - fw.x;
        const dy = y - fw.y;
        if (dx || dy) {
          fw.x = x;
          fw.y = y;
          if (typeof fw.updatePosition === 'function') fw.updatePosition();
          // 按钮跟着走同样的距离，并被自身视口边界夹住
          const el = this._buttonEl();
          if (el) {
            const nbx = Math.max(0, Math.min(el.offsetLeft + dx, window.innerWidth - el.offsetWidth));
            const nby = Math.max(0, Math.min(el.offsetTop + dy, window.innerHeight - el.offsetHeight));
            if (this._buttonHandle && typeof this._buttonHandle.applyExternalPosition === 'function') {
              this._buttonHandle.applyExternalPosition(nbx, nby);
            } else {
              el.style.left = nbx + 'px';
              el.style.top = nby + 'px';
            }
            this._buttonPosDirty = true;
            this._commitButtonPos();
          }
          this._syncPair();
        }
        // 屏幕变小后按内容重新收一遍高度
        if (typeof fw.autoFitHeight === 'function') {
          fw._heightCap = this._maxHeightPx();
          this._autoFitHeight();
        }
      };
      window.addEventListener('resize', this._resizeHandler);
    },

    _unbindWindowResize() {
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
    },

    createFloatingWindow() {
    const startTime = performance.now();
    ClipMateLog.debug('===== 开始创建悬浮窗 =====');

    try {
      // v2.5.45（B9）：已经有开着的浮窗时不再「先关掉再重建」。
      // 旧流程每次提取都销毁整个窗口（含 Shadow 根、事件、滚动位置、折叠状态），
      // 再新建一个 —— 界面上会闪一下，滚动位置也会回到顶部。
      // 现在复用同一扇窗：只换标题和内容。
      const liveWindow = this.floatingWindow;
      if (liveWindow && this.isOpen && liveWindow.isShown) {
        // v2.5.47：在胶囊状态点提取按钮 = 用户要看数据，先恢复成窗口再刷新
        if (liveWindow.isMinimized && typeof liveWindow.restoreFromMinimize === 'function') {
          liveWindow.restoreFromMinimize();
        }
        if (typeof liveWindow.setTitle === 'function') {
          liveWindow.setTitle('媒体信息预览' + (this.isEditMode ? ' - 编辑模式' : ''));
        }
        // v2.5.93：标题不再显示，编辑态改用标题栏底色表达，复用窗口时也要同步
        if (typeof liveWindow.setEditModeVisual === 'function') {
          liveWindow.setEditModeVisual(!!this.isEditMode);
        }
        this.updateTable(true);
        // 恢复上次的位置（updateTable 不动位置，这里只是保持显式）
        if (typeof liveWindow.updatePosition === 'function') liveWindow.updatePosition();
        ClipMateLog.debug(`悬浮窗内容刷新完成，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
        return;
      }

      // 先关闭现有的悬浮窗（如果存在）
      this.close();

      // 创建悬浮窗

      // v2.5.45 定位与尺寸；v2.9.7 改版：
      //  - 位置：始终贴在「提取信息」按钮正下方（右边缘对齐）——每次打开都回到按钮下，
      //    不再沿用上一次拖到的地方（拖动与按钮联动，按钮位置才是记忆载体）。
      //  - 宽度：全局设置 floatingWindowWidth（320–1200，默认 320），不再按媒体类型记忆。
      //  - 高度：渲染完按内容自适应（_autoFitHeight），上限 = floatingWindowMaxHeight 与屏幕取小。
      const mediaTypeForUi = (typeof this.getMediaType === 'function') ? this.getMediaType() : 'default';
      const edge = 8;
      const maxW = Math.max(320, window.innerWidth - edge * 2);
      const cons = this._uiConstraints || {};
      const widthRaw = Math.max(320, Math.min(parseInt(cons.width, 10) || 320, 1200));
      const windowWidth = Math.min(widthRaw, maxW);
      const maxH = this._maxHeightPx();
      const pos = this._computeFloatingPosition(windowWidth, maxH);
      const xPos = pos.x;
      const yPos = pos.y;

      this.floatingWindow = new FloatingWindowClass({
        id: 'media-info-floating-window',
        title: '媒体信息预览' + (this.isEditMode ? ' - 编辑模式' : ''),
        width: windowWidth,
        height: maxH,
        minWidth: 320,
        minHeight: 300,
        x: xPos,
        y: yPos,
        onClose: () => {
          this.close();
        },
        onResize: () => {
          // v2.9.7：尺寸不再记忆（宽度来自设置、高度自适应），这里无需落盘
        },
        onMove: (position) => {
          // v2.9.7：浮窗拖动 → 按钮跟着走（联动核心）
          this._onFwMoved(position);
        },
        onDragEnd: () => {
          // v2.9.7：拖完把按钮新位置一次性落盘
          this._commitButtonPos();
        }
      });
      this.floatingWindow._heightCap = maxH;

      // 如果有保存的原始回调，恢复它
      if (this.originalOnClose) {
        this.floatingWindow.onClose = this.originalOnClose;
      }

      // 设置悬浮窗内容
      const content = this.createTable();
      this.floatingWindow.setContent(content);
      // v2.5.45：首渲染路径（createTable → setContent）也必须绑定单元格交互。
      // 原来只在 updateTable 里绑，于是「打开页面后第一次提取」拿到的浮窗
      // 既点不动「展开」也点不亮复制提示，要等下一次重建才生效。
      if (typeof this._bindTableCellActions === 'function') {
        this._bindTableCellActions(this.floatingWindow.getContentElement());
      }

      // 创建操作按钮
      this.createFloatingWindowActions();

      // 显示悬浮窗
      this.floatingWindow.show();

      // v2.9.7：高度贴合内容 + 记录联动基准（按钮与浮窗从此一起动）
      this._autoFitHeight();
      this._syncPair();
      // v2.9.8：按钮此刻还在 busy 态（文字「提取中」比稳态宽一个字），
      // 上面的锚定是按瞬态 rect 算的 —— 等按钮回稳态后再校准一次。
      this._scheduleAnchorCalibration();

      // v2.5.47（B3）：把字段数写到胶囊上，最小化后也知道「数据在不在、几条」
      this._syncCapsuleCount();

      // 记录本次渲染的数据指纹，供 updateInPlace 判断「数据没变就不重建」
      this._lastRenderFingerprint = (typeof this._computeDataFingerprint === 'function')
        ? this._computeDataFingerprint()
        : '';

      // 初始化拖拽排序（仅编辑模式）
      if (this.isEditMode) {
        this.initDragAndDrop();
      }

      /* v2.5.93：编辑中重新提取会复用窗口，此时标题栏底色要跟着 isEditMode 走。
         平时这里是 false，等于把底色重置成浅灰，不会残留上一次的橙色。 */
      if (typeof this.floatingWindow.setEditModeVisual === 'function') {
        this.floatingWindow.setEditModeVisual(!!this.isEditMode);
      }

      ClipMateLog.debug(`悬浮窗创建完成，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      ClipMateLog.debug('===== 悬浮窗创建完成 =====');
    } catch (error) {
      console.error('创建悬浮窗失败:', error, {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
      throw error;
    }
    },

  };
})(window);

if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalWindowMixin);
}