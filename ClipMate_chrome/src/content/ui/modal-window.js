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

    try {
      // 移除ESC键事件监听
      if (this.escKeyHandler) {
        document.removeEventListener('keydown', this.escKeyHandler);
        this.escKeyHandler = null;
      }

      // v2.5.45：移除窗口 resize 监听
      this._unbindWindowResize();

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
      let x = Math.max(gap, window.innerWidth - width - 20);
      let y = 72; // 按钮默认 top:20 + 高约 44 + 间距

      try {
        const btn = document.querySelector('.media-extractor-button');
        if (btn && getComputedStyle(btn).display !== 'none') {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            x = r.right - width;   // 右边缘对齐按钮右边缘
            y = r.bottom + gap;    // 贴在按钮正下方
          }
        }
      } catch (e) { /* 拿不到按钮就用兜底位置 */ }

      // 边界收拢：左右各留 gap；顶部保证至少 120px 可见，不会整个跑到屏幕外
      x = Math.max(gap, Math.min(x, window.innerWidth - width - gap));
      const maxY = Math.max(gap, window.innerHeight - 120);
      y = Math.max(gap, Math.min(y, maxY));
      return { x: Math.round(x), y: Math.round(y) };
    },

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
     * 只做边界收拢，不强制回到按钮下方——尊重用户自己拖的位置。
     */
    _bindWindowResize() {
      if (this._resizeHandler) return;
      this._resizeHandler = () => {
        const fw = this.floatingWindow;
        if (!fw || !this.isOpen) return;
        const gap = 8;
        const x = Math.max(gap, Math.min(fw.x, window.innerWidth - fw.width - gap));
        const y = Math.max(gap, Math.min(fw.y, window.innerHeight - 120));
        if (x !== fw.x || y !== fw.y) {
          fw.x = x;
          fw.y = y;
          if (typeof fw.updatePosition === 'function') fw.updatePosition();
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

      // v2.5.45 定位与尺寸：
      //  - 位置：始终贴在「提取信息」按钮正下方（右边缘对齐）。按钮是我们自己的元素
      //    （class 固定），不再靠"猜含提取信息字样的 button"或"找蓝色按钮"——
      //    后者要对页面上每个按钮强制同步计算样式，大页面上会明显卡一下。
      //  - 尺寸：按媒体类型记住上次调好的宽高（位置固定、尺寸可记）。
      const mediaTypeForUi = (typeof this.getMediaType === 'function') ? this.getMediaType() : 'default';
      const uiPref = this._getUiPref(mediaTypeForUi);
      const edge = 8;
      const maxW = Math.max(320, window.innerWidth - edge * 2);
      const maxH = Math.max(240, window.innerHeight - edge * 2);
      const windowWidth = Math.min(Math.max(uiPref.width || 600, 400), maxW);
      const windowHeight = Math.min(Math.max(uiPref.height || 500, 300), maxH);
      const pos = this._computeFloatingPosition(windowWidth, windowHeight);
      const xPos = pos.x;
      const yPos = pos.y;

      this.floatingWindow = new FloatingWindowClass({
        id: 'media-info-floating-window',
        title: '媒体信息预览' + (this.isEditMode ? ' - 编辑模式' : ''),
        width: windowWidth,
        height: windowHeight,
        minWidth: 400,
        minHeight: 300,
        x: xPos,
        y: yPos,
        onClose: () => {
          this.close();
        },
        onResize: (size) => {
          // 折叠/最大化时的高度不代表用户意图，不写进记忆
          if (this.floatingWindow && (this.floatingWindow.isCollapsed || this.floatingWindow.isMaximized)) return;
          if (size && size.width && size.height) {
            this._saveUiPref(mediaTypeForUi, {
              width: Math.round(size.width),
              height: Math.round(size.height)
            });
          }
        },
        onMove: (position) => {
        }
      });

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