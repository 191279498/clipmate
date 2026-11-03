/**
 * 悬浮窗类 - 实现可调整大小和自由拖动的悬浮窗
 * 替代原有的模态窗口，提供更灵活的用户界面
 */
class MediaFloatingWindow {
  constructor(options = {}) {
    // 基本配置
    this.id = options.id || 'floating-window-' + Date.now();
    this.title = options.title || '悬浮窗';
    this.width = options.width || 600;
    this.height = options.height || 400;
    this.minWidth = options.minWidth || 300;
    this.minHeight = options.minHeight || 200;
    this.x = options.x || 100;
    this.y = options.y || 100;
    // v2.5.45（B8）：原来写死 10000，比不少站点自己的弹层/顶部导航还低，
    // 浮窗会被页面盖住且点不出来。基准抬到与提取按钮同一量级。
    this.zIndex = options.zIndex || MediaFloatingWindow.BASE_Z_INDEX;
    
    // 回调函数
    this.onClose = options.onClose || null;
    this.onResize = options.onResize || null;
    this.onMove = options.onMove || null;
    
    // 状态
    this.isShown = false;
    this.isDragging = false;
    this.isResizing = false;
    this.isCollapsed = false; // 跟踪悬浮窗折叠状态
    this.isMaximized = false; // 新增：跟踪悬浮窗最大化状态

    // v2.5.47（B3）：最小化成胶囊。
    // 折叠只压高度、宽度仍是整条，挡住正文；最小化把整个窗口缩成 132×36。
    this.isMinimized = false;
    this.preMinimizeState = null;   // 'expanded' | 'collapsed' —— 恢复时回到这个状态
    this.preMinimizeBounds = null;  // 最小化前的几何与样式，恢复用
    this.searchElement = null;      // 搜索条（v2.5.47 / B4），由 ModalSearchMixin 挂进来
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.resizeStartWidth = 0;
    this.resizeStartHeight = 0;
    this.resizeStartX = 0;
    this.resizeStartY = 0;
    this.resizeHandle = null;
    this.noticeElement = null; // 标题栏下方的提示横幅（v2.5.44），默认不存在
    this.originalHeight = this.height; // 保存原始高度，用于折叠/展开时恢复
    this.restoreBounds = null; // 新增：保存原始位置和大小，用于从最大化状态恢复
    
    // 创建悬浮窗元素
    this.createElements();

    // v2.5.45（B8）：点哪儿都把浮窗提到最前。
    // 用捕获阶段，点在输入框/按钮上也不影响它们自己的事件。
    this.windowElement.addEventListener('pointerdown', () => this.bringToFront(), true);
    this.windowElement.addEventListener('focusin', () => this.bringToFront(), true);

  }
  
  /**
   * 创建悬浮窗DOM元素
   *
   * 【v2.5.41 起的样式隔离方案】
   * 只往页面里挂一个宿主 div（.media-floating-window），标题栏 / 内容区 / 手柄全部封在 Shadow DOM 里。
   * 这样页面自己的 CSS 无法命中浮窗内部任何元素，各站点的字体、字号、字重、行高、边框不会再互相打架；
   * 反过来我们的样式也不会漏到页面上去污染人家。
   *
   * 宿主元素留在页面（light DOM），字体类属性用内联样式 + content-styles.css 的 !important 双重钉死，
   * 因为继承属性会穿透 Shadow 边界，宿主被页面改掉的话内部 inherit 的字体也会跟着变。
   */
  createElements() {
    // 创建宿主容器
    this.windowElement = document.createElement('div');
    this.windowElement.className = 'media-floating-window';
    this.windowElement.id = this.id;
    this.windowElement.style.cssText = `
      position: fixed;
      top: ${this.y}px;
      left: ${this.x}px;
      width: ${this.width}px;
      height: ${this.height}px;
      min-width: ${this.minWidth}px;
      min-height: ${this.minHeight}px;
      z-index: ${this.zIndex};
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.3;
      color: #000;
      letter-spacing: normal;
      text-align: left;
      user-select: text;
    `;

    // ===== Shadow DOM 隔离 =====
    // 老浏览器（不支持 attachShadow）直接回落到普通 DOM，功能不受影响，只是没有隔离效果。
    if (typeof this.windowElement.attachShadow === 'function') {
      try {
        this.shadowRoot = this.windowElement.attachShadow({ mode: 'open' });
      } catch (e) {
        console.warn('[ClipMate] Shadow DOM 创建失败，回落到普通 DOM:', e.message);
        this.shadowRoot = this.windowElement;
      }
    } else {
      this.shadowRoot = this.windowElement;
    }

    // 样式表同步注入，打开时不会出现“无样式裸 DOM”的闪烁
    const styleElement = document.createElement('style');
    styleElement.setAttribute('data-clipmate-style', 'floating-window');
    styleElement.textContent = (typeof window.FLOATING_WINDOW_CSS === 'string') ? window.FLOATING_WINDOW_CSS : '';
    if (!styleElement.textContent) {
      console.warn('[ClipMate] 浮窗样式表未加载（floating-window-styles.js 未执行），界面将退回浏览器默认样式');
    }
    this.shadowRoot.appendChild(styleElement);

    // 以下子元素不再写内联样式，统一由上面的样式表控制（改一处即全站生效）
    // 创建标题栏
    this.headerElement = document.createElement('div');
    this.headerElement.className = 'floating-window-header';

    /* v2.5.93：标题文字不再显示。
       原来「媒体信息预览」六个字固定占 120px（.floating-window-title 的 min-width），
       把右边一排工具栏硬生生挤成两行。它只是说明性文字，没有任何功能，
       删掉后腾出的 120px 全部让给按钮。
       元素仍然创建并挂在 DOM 里、只是 display:none —— 因为 setTitle() 每次重新
       提取都会往里写 textContent，把元素整个删掉会在那儿抛错。 */
    this.titleElement = document.createElement('div');
    this.titleElement.className = 'floating-window-title';
    this.titleElement.textContent = this.title;
    this.titleElement.style.display = 'none';

    // 关闭按钮
    this.closeButton = document.createElement('div');
    this.closeButton.className = 'floating-window-close';
    this.closeButton.innerHTML = '×';

    // 悬停变色走内联样式（内联优先级高于样式表，所以能正常生效）
    this.closeButton.addEventListener('mouseenter', () => {
      this.closeButton.style.background = '#e0e0e0';
      this.closeButton.style.color = '#333';
    });

    this.closeButton.addEventListener('mouseleave', () => {
      this.closeButton.style.background = '#f0f0f0';
      this.closeButton.style.color = '#666';
    });

    // 创建标题栏按钮容器
    this.titleBarButtons = document.createElement('div');
    this.titleBarButtons.className = 'floating-window-title-buttons';

    // 组装标题栏
    this.headerElement.appendChild(this.titleElement);
    this.headerElement.appendChild(this.titleBarButtons);
    this.headerElement.appendChild(this.closeButton);

    // 创建内容区域
    this.contentElement = document.createElement('div');
    this.contentElement.className = 'floating-window-content';

    // 创建折叠/展开手柄
    this.collapseHandle = document.createElement('div');
    this.collapseHandle.className = 'floating-window-collapse-handle';
    this.collapseHandle.innerHTML = '▼'; // 初始显示向下箭头（表示可以折叠）

    // 创建调整大小的手柄
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'floating-window-resize-handle';

    // v2.5.47（B3）：最小化胶囊。
    // 用 class 状态控制显隐（.is-minimized 挂在宿主上），不在这里写 display，
    // 免得和「显示/隐藏浮窗」用的内联 display 打架。
    this.capsuleElement = document.createElement('div');
    this.capsuleElement.className = 'floating-window-capsule';
    this.capsuleElement.title = '点击展开（可拖动）';

    this.capsuleIcon = document.createElement('span');
    this.capsuleIcon.className = 'floating-window-capsule-icon';
    this.capsuleIcon.textContent = '▣';

    this.capsuleName = document.createElement('span');
    this.capsuleName.className = 'floating-window-capsule-name';
    this.capsuleName.textContent = '采媒灵';

    this.capsuleDivider = document.createElement('span');
    this.capsuleDivider.className = 'floating-window-capsule-divider';

    this.capsuleCount = document.createElement('span');
    this.capsuleCount.className = 'floating-window-capsule-count';
    this.capsuleCount.textContent = '';

    this.capsuleBadge = document.createElement('span');
    this.capsuleBadge.className = 'floating-window-capsule-badge';

    this.capsuleElement.appendChild(this.capsuleIcon);
    this.capsuleElement.appendChild(this.capsuleName);
    this.capsuleElement.appendChild(this.capsuleDivider);
    this.capsuleElement.appendChild(this.capsuleCount);
    this.capsuleElement.appendChild(this.capsuleBadge);

    // 组装悬浮窗（全部挂到 Shadow DOM 里）
    this.shadowRoot.appendChild(this.headerElement);
    this.shadowRoot.appendChild(this.contentElement);
    this.shadowRoot.appendChild(this.collapseHandle); // 添加折叠手柄
    this.shadowRoot.appendChild(this.resizeHandle);
    this.shadowRoot.appendChild(this.capsuleElement);

    // 添加事件监听
    this.addEventListeners();

  }
  
  /**
   * 添加事件监听器
   */
  addEventListeners() {
    // 标题栏拖动
    this.headerElement.addEventListener('mousedown', (e) => {
      if (e.target === this.closeButton) return;
      
      this.isDragging = true;
      this.dragStartX = e.clientX - this.x;
      this.dragStartY = e.clientY - this.y;
      
      document.addEventListener('mousemove', this.handleMouseMove);
      document.addEventListener('mouseup', this.handleMouseUp);
      
      e.preventDefault();
    });
    
    // 标题栏双击事件 - 最大化/恢复悬浮窗
    this.headerElement.addEventListener('dblclick', (e) => {
      if (e.target === this.closeButton) return;
      this.toggleMaximize();
      e.preventDefault();
    });
    
    // 关闭按钮
    this.closeButton.addEventListener('click', () => {
      this.close();
    });
    
    // 调整大小
    this.resizeHandle.addEventListener('mousedown', (e) => {
      this.isResizing = true;
      this.resizeStartWidth = this.width;
      this.resizeStartHeight = this.height;
      this.resizeStartX = e.clientX;
      this.resizeStartY = e.clientY;
      
      document.addEventListener('mousemove', this.handleMouseMove);
      document.addEventListener('mouseup', this.handleMouseUp);
      
      e.preventDefault();
      e.stopPropagation();
    });
    
    // 防止内容区域选中文本时影响拖动
    this.contentElement.addEventListener('selectstart', (e) => {
      if (this.isDragging) {
        e.preventDefault();
      }
    });
    
    // 折叠/展开手柄点击事件
    this.collapseHandle.addEventListener('click', () => {
      this.toggleCollapse();
    });
    
    // 折叠手柄悬停效果
    this.collapseHandle.addEventListener('mouseenter', () => {
      this.collapseHandle.style.background = '#e0e0e0';
      this.collapseHandle.style.color = '#333';
    });
    
    this.collapseHandle.addEventListener('mouseleave', () => {
      this.collapseHandle.style.background = '#F1EFE8';
      this.collapseHandle.style.color = '#666';
    });
    
    // v2.5.47（B3）：点胶囊恢复；按住胶囊可以拖到别处
    this.capsuleElement.addEventListener('click', (e) => {
      // 拖动结束时浏览器也会补一个 click，用标记挡掉，免得一拖就展开
      if (this._capsuleMoved) {
        this._capsuleMoved = false;
        return;
      }
      e.stopPropagation();
      this.restoreFromMinimize();
    });

    this.capsuleElement.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this._capsuleDragging = true;
      this._capsuleMoved = false;
      this._capsuleStartX = e.clientX;
      this._capsuleStartY = e.clientY;
      this._capsuleOriginX = this.x;
      this._capsuleOriginY = this.y;

      document.addEventListener('mousemove', this.handleCapsuleMove);
      document.addEventListener('mouseup', this.handleCapsuleUp);

      e.preventDefault();
      e.stopPropagation();
    });

  }
  
  /**
   * 处理鼠标移动事件
   */
  handleMouseMove = (e) => {
    if (this.isDragging) {
      // 拖动悬浮窗
      this.x = e.clientX - this.dragStartX;
      this.y = e.clientY - this.dragStartY;
      
      // 确保悬浮窗不会超出视口
      this.x = Math.max(0, Math.min(this.x, window.innerWidth - this.width));
      this.y = Math.max(0, Math.min(this.y, window.innerHeight - this.height));
      
      this.updatePosition();
      
      if (this.onMove) {
        this.onMove({ x: this.x, y: this.y });
      }
    } else if (this.isResizing) {
      // 调整悬浮窗大小
      const deltaX = e.clientX - this.resizeStartX;
      const deltaY = e.clientY - this.resizeStartY;
      
      this.width = Math.max(this.minWidth, this.resizeStartWidth + deltaX);
      this.height = Math.max(this.minHeight, this.resizeStartHeight + deltaY);
      
      this.updateSize();
      
      if (this.onResize) {
        this.onResize({ width: this.width, height: this.height });
      }
    }
  }
  
  /**
   * 处理鼠标释放事件
   */
  handleMouseUp = () => {
    this.isDragging = false;
    this.isResizing = false;
    
    document.removeEventListener('mousemove', this.handleMouseMove);
    document.removeEventListener('mouseup', this.handleMouseUp);
  }

  /** 拖动胶囊（v2.5.47 / B3）：只改位置，尺寸不变 */
  handleCapsuleMove = (e) => {
    if (!this._capsuleDragging) return;

    const dx = e.clientX - this._capsuleStartX;
    const dy = e.clientY - this._capsuleStartY;

    // 移动超过 3px 才算拖动，否则当成点击
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this._capsuleMoved = true;

    const w = this.width;
    const h = this.height;
    this.x = Math.max(0, Math.min(this._capsuleOriginX + dx, window.innerWidth - w));
    this.y = Math.max(0, Math.min(this._capsuleOriginY + dy, window.innerHeight - h));
    this.updatePosition();
  }

  handleCapsuleUp = () => {
    this._capsuleDragging = false;
    document.removeEventListener('mousemove', this.handleCapsuleMove);
    document.removeEventListener('mouseup', this.handleCapsuleUp);
  }

  /**
   * 最小化成胶囊（v2.5.47 / B3）
   *
   * 折叠只压高度（宽度仍是整条 600px，横在页面上挡住正文）；
   * 最小化把整个窗口缩到 CAPSULE_WIDTH × CAPSULE_HEIGHT，贴到右下角。
   * 最小化前的位置、尺寸、内联样式全部记下来，恢复时原样还原。
   */
  minimize() {
    if (!this.isShown || this.isMinimized) return;

    // 记住「最小化之前是什么态」——恢复时回到它，而不是一律铺开
    this.preMinimizeState = this.isCollapsed ? 'collapsed' : 'expanded';
    this.preMinimizeBounds = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      borderRadius: this.windowElement.style.borderRadius,
      boxShadow: this.windowElement.style.boxShadow,
      minWidth: this.windowElement.style.minWidth,
      minHeight: this.windowElement.style.minHeight,
      maxHeight: this.windowElement.style.maxHeight
    };

    // 横幅随窗口一起退场；但「活跃浮窗」的登记要留着——
    // 这样最小化期间来的提示会走 showNotice 的红点分支，而不是跑去做页面大卡片打断你阅读。
    this.hideNotice();

    this.isMinimized = true;
    this.windowElement.classList.add('is-minimized');

    /* 显隐必须用内联 display，不能用样式表 + :host(.is-minimized)：
       折叠/展开会给内容区写内联 display（none / block），内联优先级高于样式表，
       shadow 内又不允许写 !important，所以只有内联压得住。 */
    this._minimizeHiddenEls = [];
    const hide = (el) => {
      if (!el) return;
      this._minimizeHiddenEls.push({ el: el, prev: el.style.display });
      el.style.display = 'none';
    };
    hide(this.headerElement);
    hide(this.contentElement);
    hide(this.collapseHandle);
    hide(this.resizeHandle);
    hide(this.searchElement);
    hide(this.noticeElement);

    this.capsuleElement.style.display = 'flex';

    const w = MediaFloatingWindow.CAPSULE_WIDTH;
    const h = MediaFloatingWindow.CAPSULE_HEIGHT;
    const gap = 20;

    this.width = w;
    this.height = h;
    this.x = Math.max(8, window.innerWidth - w - gap);
    this.y = Math.max(8, window.innerHeight - h - gap);

    this.windowElement.style.width = w + 'px';
    this.windowElement.style.height = h + 'px';
    this.windowElement.style.minWidth = '0';
    this.windowElement.style.minHeight = '0';
    this.windowElement.style.maxHeight = 'none';
    // 兜底：正式环境下 content-styles.css 的 .media-floating-window.is-minimized 带 !important，
    // 属于用户级 !important，会压过这里的内联值。这两行只在没有那张样式表时起作用。
    this.windowElement.style.borderRadius = (h / 2) + 'px';
    this.windowElement.style.boxShadow = '0 4px 14px rgba(15, 23, 42, 0.18)';

    this.updatePosition();

  }

  /**
   * 把最小化时藏起来的元素还原（恢复胶囊 / 重新显示窗口都要走这里）
   *
   * 内容区的 display 要还原成「它原来的值」而不是统一 'block'：
   * 折叠态下它本来就是 none，统一设 block 会把折叠态撑开。
   */
  _restoreMinimizedElements() {
    const list = this._minimizeHiddenEls;
    if (list && list.length) {
      list.forEach((item) => {
        if (item.el) item.el.style.display = item.prev || '';
      });
    }
    this._minimizeHiddenEls = null;
    if (this.capsuleElement) this.capsuleElement.style.display = '';
    this.windowElement.classList.remove('is-minimized');
  }

  /** 从胶囊恢复（v2.5.47 / B3） */
  restoreFromMinimize() {
    if (!this.isMinimized) return;

    const b = this.preMinimizeBounds || {};
    this.isMinimized = false;

    // 先把藏起来的元素还回去（内容区还原成最小化之前的值）
    this._restoreMinimizedElements();

    this.x = (typeof b.x === 'number') ? b.x : this.x;
    this.y = (typeof b.y === 'number') ? b.y : this.y;
    this.width = (typeof b.width === 'number') ? b.width : this.width;
    this.height = (typeof b.height === 'number') ? b.height : this.height;

    this.windowElement.style.borderRadius = b.borderRadius || '8px';
    this.windowElement.style.boxShadow = b.boxShadow || '0 4px 20px rgba(0, 0, 0, 0.3)';
    this.windowElement.style.minWidth = b.minWidth || (this.minWidth + 'px');
    this.windowElement.style.minHeight = b.minHeight || (this.minHeight + 'px');
    this.windowElement.style.maxHeight = b.maxHeight || '';

    this.updatePosition();
    this.updateSize();

    // 最小化前如果处于折叠态，折叠高度要按当前横幅重新算一遍
    if (this.isCollapsed) {
      this._applyCollapsedHeight();
    }

    // 重新登记为活跃浮窗，之后的提示回到横幅
    if (typeof window !== 'undefined' && window.ClipMateNotice && typeof window.ClipMateNotice.bind === 'function') {
      window.ClipMateNotice.bind(this);
    }

    // 之前攒下的红点，展开后就没意义了
    this.clearCapsuleBadge();

    // 恢复后通知一次尺寸变化（折叠/展开也会走这里）
    if (this.onResize) {
      this.onResize({ width: this.width, height: this.height });
    }

  }

  /** 在胶囊 / 完整窗口之间切换 */
  toggleMinimize() {
    if (this.isMinimized) {
      this.restoreFromMinimize();
    } else {
      this.minimize();
    }
  }

  /** 更新胶囊上的字段数（v2.5.47 / B3） */
  setCapsuleCount(count) {
    if (!this.capsuleCount) return;
    const n = Number(count);
    this.capsuleCount.textContent = (isFinite(n) && n > 0) ? (n + ' 字段') : '';
    if (this.capsuleDivider) {
      this.capsuleDivider.style.display = this.capsuleCount.textContent ? '' : 'none';
    }
  }

  /**
   * 最小化状态下收到提示 → 冒红点 + 把提示原文放进悬停提示
   * 不弹横幅：横幅要占高度，一占就不是胶囊了。
   */
  pulseCapsuleBadge(message) {
    if (!this.capsuleBadge) return;
    this.capsuleBadge.classList.add('is-on');
    this.capsuleElement.title = message ? ('点击展开 · ' + message) : '点击展开（有新提示）';
  }

  clearCapsuleBadge() {
    if (!this.capsuleBadge) return;
    this.capsuleBadge.classList.remove('is-on');
    this.capsuleElement.title = '点击展开（可拖动）';
  }

  /**
   * 挂入搜索条（v2.5.47 / B4）
   *
   * 提示横幅的插入锚点要跟着改：横幅必须排在搜索条「上面」，
   * 否则每次弹提示都会跑到搜索条下方，把搜索框挤得跳来跳去。
   */
  attachSearchBar(el) {
    this.searchElement = el || null;
  }

  detachSearchBar() {
    this.searchElement = null;
  }
  
  /**
   * 更新悬浮窗位置
   */
  updatePosition() {
    this.windowElement.style.left = `${this.x}px`;
    this.windowElement.style.top = `${this.y}px`;
  }
  
  /**
   * 更新悬浮窗大小
   */
  updateSize() {
    this.windowElement.style.width = `${this.width}px`;
    this.windowElement.style.height = `${this.height}px`;
  }
  
  /**
   * 设置悬浮窗内容
   */
  setContent(content) {
    if (typeof content === 'string') {
      this.contentElement.innerHTML = content;
    } else if (content instanceof HTMLElement) {
      this.contentElement.innerHTML = '';
      this.contentElement.appendChild(content);
    }
    
  }
  
  /**
   * 设置悬浮窗标题
   */
  setTitle(title) {
    this.title = title;
    this.titleElement.textContent = title;
  }

  /**
   * v2.5.93：编辑模式的视觉提示
   *
   * 标题文字藏起来之后，「 - 编辑模式」这行字也跟着没了，用户会不知道自己在改东西。
   * 改成整条标题栏换底色（浅橙）：零横向占用，扫一眼就能看出来。
   * 顺带说明：原来的文字提示其实也不准 —— 它只在新建/复用窗口那一刻写一次，
   * 进编辑模式时并不会立刻刷新，得等下次提取才变。
   */
  setEditModeVisual(on) {
    if (!this.headerElement) return;
    this.headerElement.classList.toggle('is-edit-mode', !!on);
  }

  /**
   * 显示悬浮窗
   */
  show() {
    if (this.isShown) return;
    
    this.windowElement.style.display = 'flex';
    document.body.appendChild(this.windowElement);
    this.isShown = true;

    // v2.5.47：每次显示都是完整窗口，不继承上一次的最小化状态。
    // 如果上次是最小化着被关掉的，子元素身上还留着 display:none，这里一并还回去。
    this.isMinimized = false;
    this._restoreMinimizedElements();
    this.clearCapsuleBadge();

    // 每次显示都置顶一次（B8），避免被页面上后出现的弹层压住
    this.bringToFront();

    // 登记为「当前活跃浮窗」：之后 ModalManager / ButtonManager 的提示都会塞进这里，
    // 而不是像 v2.5.43 那样丢到网页右上角去（那才是「看不见」的根因）。
    if (typeof window !== 'undefined' && window.ClipMateNotice && typeof window.ClipMateNotice.bind === 'function') {
      window.ClipMateNotice.bind(this);
    }
    
  }
  
  /**
   * 隐藏悬浮窗
   */
  hide() {
    if (!this.isShown) return;

    // 提示横幅随浮窗一起退场，下次打开是干净的
    this.hideNotice();
    if (typeof window !== 'undefined' && window.ClipMateNotice && typeof window.ClipMateNotice.unbind === 'function') {
      window.ClipMateNotice.unbind(this);
    }
    
    this.windowElement.style.display = 'none';
    if (this.windowElement.parentNode) {
      this.windowElement.parentNode.removeChild(this.windowElement);
    }
    this.isShown = false;
    
  }

  /**
   * 在标题栏下方显示一条提示横幅（v2.5.44）
   *
   * 同一时刻只保留一条：新提示直接替换旧的，不会越积越多。
   * 横幅是 Shadow DOM 里的独立一行，内容区（flex:1）自动让出高度，不需要手动重排表格。
   *
   * @param {string} message 提示文字
   * @param {string} type    success | error | info
   * @param {object} [options] { detail, copyText } 可选技术细节（v2.5.45）
   * @returns {HTMLElement|null}
   */
  showNotice(message, type, options) {
    this.hideNotice();

    // v2.5.47（B3）：最小化状态下不插横幅 —— 横幅要占高度，一占就不是胶囊了。
    // 提示改体现在胶囊的红点和悬停原文上，展开时还能看懂刚才发生了什么。
    if (this.isMinimized) {
      this.pulseCapsuleBadge(message);
      return null;
    }

    const noticeApi = (typeof window !== 'undefined') ? window.ClipMateNotice : null;
    if (!noticeApi || typeof noticeApi.build !== 'function') {
      console.warn('[ClipMate] 提示组件未加载，无法显示提示:', message);
      return null;
    }

    const el = noticeApi.build(message, type, 'window', options);
    // 关闭按钮靠这个引用找回浮窗，好在折叠状态下重算高度
    el.__clipmateHost = this;

    // 插在标题栏之后、内容区之前。
    // 有搜索条时插在搜索条「上面」，横幅始终是最靠上的一行（v2.5.47 / B4）。
    const anchor = (this.searchElement && this.searchElement.parentNode === this.shadowRoot)
      ? this.searchElement
      : this.contentElement;
    this.shadowRoot.insertBefore(el, anchor);
    this.noticeElement = el;

    // 折叠状态下横幅会临时把浮窗撑高，好让你看得见提示
    if (this.isCollapsed) {
      this._applyCollapsedHeight();
      if (this.onResize) {
        this.onResize({ width: this.width, height: this.height });
      }
    }

    return el;
  }

  /**
   * 移除当前提示横幅
   */
  hideNotice() {
    const el = this.noticeElement;
    if (!el) return;

    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
    this.noticeElement = null;

    // 折叠状态下把临时撑起来的高度收回去（最小化时不碰，高度是胶囊写死的）
    if (this.isCollapsed && !this.isMinimized) {
      this._applyCollapsedHeight();
      if (this.onResize) {
        this.onResize({ width: this.width, height: this.height });
      }
    }
  }

  /**
   * 折叠状态下重算浮窗高度：标题栏 + 折叠手柄 + 提示横幅
   *
   * 横幅必须算进来，否则会被 overflow:hidden 裁掉——折叠着点复制也是要看得见结果的。
   * 横幅关掉后高度自动收回，浮窗恢复到原来的紧凑高度。
   */
  _applyCollapsedHeight() {
    // 最小化时高度是写死的胶囊尺寸，任何「按内容重算高度」都会把胶囊撑开
    if (this.isMinimized) return;

    const headerHeight = this.headerElement.offsetHeight;
    const handleHeight = this.collapseHandle.offsetHeight;
    // 刚插入时可能还读不到高度，按设计值 40 兜底
    const noticeHeight = this.noticeElement ? (this.noticeElement.offsetHeight || 40) : 0;

    this.height = headerHeight + handleHeight + noticeHeight;

    this.windowElement.style.height = this.height + 'px';
    this.windowElement.style.minHeight = 'auto'; // 临时禁用最小高度限制
    this.windowElement.style.maxHeight = this.height + 'px'; // 设置最大高度限制
    this.windowElement.style.overflow = 'hidden'; // 强制隐藏溢出内容

    // 校正：不同系统缩放、不同站点的字体渲染会让实际内容比预算高出几像素，
    // 一旦超出就会被 overflow:hidden 裁掉一角，所以再量一次真实高度，超了就按真实的来。
    const actual = this.windowElement.scrollHeight;
    if (actual > this.height) {
      this.height = actual;
      this.windowElement.style.height = actual + 'px';
      this.windowElement.style.maxHeight = actual + 'px';
    }
  }
  
  /**
   * 折叠/展开悬浮窗
   */
  toggleCollapse() {
    // 胶囊状态下没有「折叠」这回事，先恢复成窗口再说
    if (this.isMinimized) return;

    if (this.isCollapsed) {
      // 展开悬浮窗
      this.height = this.originalHeight; // 恢复原始高度
      this.contentElement.style.display = 'block'; // 显示内容区域
      this.collapseHandle.innerHTML = '▼'; // 更改箭头为向下
      // 恢复flex布局
      this.windowElement.style.flexDirection = 'column';
      // 展开时恢复内容区域的flex属性
      this.contentElement.style.flex = '1';
      // 确保resizeHandle可见
      this.resizeHandle.style.display = 'block';
      
      // 展开时移除所有限制，确保可以自由调整大小
      this.windowElement.style.minHeight = `${this.minHeight}px`; // 恢复最小高度限制
      this.windowElement.style.maxHeight = ''; // 清除最大高度限制
      this.windowElement.style.height = `${this.height}px`;
      this.windowElement.style.overflow = 'hidden'; // 保持溢出隐藏
    } else {
      // 折叠悬浮窗
      this.originalHeight = this.height; // 保存当前高度（只在这里保存，重算高度时不能再覆盖）

      // 隐藏内容区域
      this.contentElement.style.display = 'none';
      // 移除内容区域的flex属性，避免flex布局影响
      this.contentElement.style.flex = '0';

      // 更改箭头为向上
      this.collapseHandle.innerHTML = '▲';

      // 隐藏resizeHandle
      this.resizeHandle.style.display = 'none';

      // 折叠时设置严格的大小限制：标题栏 + 手柄 + 可能存在的提示横幅
      this._applyCollapsedHeight();
    }
    
    // 更新折叠状态
    this.isCollapsed = !this.isCollapsed;
    
    // 调用调整大小回调（如果存在）
    if (this.onResize) {
      this.onResize({ width: this.width, height: this.height });
    }
    
  }
  
  /**
   * 关闭悬浮窗
   */
  close() {
    this.hide();
    
    if (this.onClose) {
      this.onClose();
    }
    
  }
  
  /**
   * 将悬浮窗置于最前
   *
   * v2.5.45（B8）：全项目此前 0 处调用，等于写了个摆设——浮窗被页面自己的
   * 弹层盖住之后再也点不到。现在 pointerdown / focusin 都会触发。
   */
  bringToFront() {
    if (!this.windowElement) return;
    this.zIndex = MediaFloatingWindow.getNextZIndex();
    this.windowElement.style.zIndex = String(this.zIndex);
  }
  
  /**
   * 获取下一个可用的z-index值
   * 基准取 2147483000（与提取按钮同量级，压得住各站的弹层），
   * 每次置顶 +1；接近上限时回落到基准，避免无限膨胀。
   */
  static getNextZIndex() {
    const base = MediaFloatingWindow.BASE_Z_INDEX;
    if (!MediaFloatingWindow.currentZIndex || MediaFloatingWindow.currentZIndex < base) {
      MediaFloatingWindow.currentZIndex = base;
    }
    if (MediaFloatingWindow.currentZIndex >= base + 500) {
      MediaFloatingWindow.currentZIndex = base;
    }
    return ++MediaFloatingWindow.currentZIndex;
  }
  
  /**
   * 居中显示悬浮窗
   */
  center() {
    this.x = (window.innerWidth - this.width) / 2;
    this.y = (window.innerHeight - this.height) / 2;
    this.updatePosition();
  }
  
  /**
   * 获取悬浮窗位置和大小信息
   */
  getBounds() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height
    };
  }
  
  /**
   * 获取内容元素
   */
  getContentElement() {
    return this.contentElement;
  }

  /**
   * 获取样式隔离的根节点（Shadow DOM；不支持时为宿主元素本身）
   * 调试/自动化测试读取浮窗内部结构时，要从这里查，不能用 document.querySelector。
   */
  getShadowRoot() {
    return this.shadowRoot || this.windowElement;
  }
  
  /**
   * 获取标题栏按钮容器
   */
  getTitleBarButtonsContainer() {
    return this.titleBarButtons;
  }
  
  /**
   * 设置悬浮窗位置和大小
   */
  setBounds(bounds) {
    if (bounds.x !== undefined) this.x = bounds.x;
    if (bounds.y !== undefined) this.y = bounds.y;
    if (bounds.width !== undefined) this.width = Math.max(this.minWidth, bounds.width);
    if (bounds.height !== undefined) {
      this.height = Math.max(this.minHeight, bounds.height);
      // 如果不是折叠状态，同步更新原始高度
      if (!this.isCollapsed) {
        this.originalHeight = this.height;
      }
    }
    
    this.updatePosition();
    this.updateSize();
  }
  
  /**
   * 获取悬浮窗是否处于折叠状态
   */
  getIsCollapsed() {
    return this.isCollapsed;
  }
  
  /**
   * 切换悬浮窗最大化/恢复状态
   */
  toggleMaximize() {
    // 胶囊状态下双击标题栏不该触发最大化（标题栏本来就不可见，这里只是兜底）
    if (this.isMinimized) return;

    if (this.isMaximized) {
      // 恢复原始状态
      if (this.restoreBounds) {
        this.x = this.restoreBounds.x;
        this.y = this.restoreBounds.y;
        this.width = this.restoreBounds.width;
        this.height = this.restoreBounds.height;
        this.restoreBounds = null;
      }
      this.isMaximized = false;
      
      // 恢复窗口样式
      this.windowElement.style.maxWidth = '';
      this.windowElement.style.maxHeight = '';
      if (!this.isCollapsed) {
        this.windowElement.style.minHeight = `${this.minHeight}px`;
        this.windowElement.style.maxHeight = '';
      }
    } else {
      // 最大化状态
      // 保存当前状态以便恢复
      this.restoreBounds = {
        x: this.x,
        y: this.y,
        width: this.width,
        height: this.height
      };
      
      // 获取视口大小，考虑滚动条和少量边距
      const viewportWidth = window.innerWidth - 20;
      const viewportHeight = window.innerHeight - 20;
      
      // 设置为最大化状态
      this.x = 10;
      this.y = 10;
      this.width = viewportWidth;
      this.height = viewportHeight;
      this.isMaximized = true;
      
      // 设置最大化窗口样式
      this.windowElement.style.maxWidth = '100%';
      this.windowElement.style.maxHeight = '100%';
      this.windowElement.style.minHeight = 'auto';
      this.windowElement.style.maxHeight = '100%';
    }
    
    // 更新位置和大小
    this.updatePosition();
    this.updateSize();
    
    // 调用回调函数（如果存在）
    if (this.onResize) {
      this.onResize({ width: this.width, height: this.height });
    }
    
  }
}

// 置顶基准层级：与右上角提取按钮 (2147483647) 同一量级，
// 确保浮窗不会被网站自己的弹层、吸顶导航压住（v2.5.45 / B8）
MediaFloatingWindow.BASE_Z_INDEX = 2147483000;

// 最小化胶囊尺寸（v2.5.47 / B3）：132×36 是「图标 + 采媒灵 + 分隔 + 17 字段」刚好排开的尺寸。
// 再窄就放不下字段数，再宽就开始挡正文了。
MediaFloatingWindow.CAPSULE_WIDTH = 132;
MediaFloatingWindow.CAPSULE_HEIGHT = 36;

// 导出类 - 确保在浏览器扩展环境中正确导出
(function() {
  // 确保类定义存在
  if (typeof MediaFloatingWindow !== 'undefined') {
    // 在浏览器环境中，将类挂载到window对象
    if (typeof window !== 'undefined') {
      window.MediaFloatingWindow = MediaFloatingWindow;
    }
    
    // 在CommonJS环境中导出
    if (typeof module !== 'undefined' && module.exports) {
      module.exports = MediaFloatingWindow;
    }
  } else {
    console.error('MediaFloatingWindow类未定义');
  }
})();