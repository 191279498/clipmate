// 导入媒体类型配置和工具函数
let mediaConfig = null;
try {
  if (typeof module !== 'undefined' && module.exports) {
    mediaConfig = require('../../shared/config/media-types');
  } else if (typeof window !== 'undefined' && window.mediaTypesConfig) {
    mediaConfig = window.mediaTypesConfig;
  }
} catch (error) {
  console.warn('无法导入媒体类型配置:', error);
  // 使用默认配置作为后备
  mediaConfig = {
    getParentMediaType: (type) => (type === 'movie' || type === 'tv') ? 'media' : null,
    isMediaTypeSubtype: (mediaType, parentType) => {
      const hierarchy = { 'movie': 'media', 'tv': 'media' };
      let currentType = mediaType;
      while (currentType) {
        if (hierarchy[currentType] === parentType) return true;
        currentType = hierarchy[currentType];
      }
      return false;
    },
    getDisplayOrder: () => {
      // 展示顺序的唯一来源是 media-types.js 的 MEDIA_FIELD_LISTS / MEDIA_DISPLAY_ORDER。
      // 这里不再维护本地副本（历史副本影视漏了「国家」、社交漏了「作者ID」，
      // 一旦本文件走到兜底分支就会把字段挤到最后）。
      // 共享配置不可用时返回空数组，由 ModalDataProcessor 读取同一份配置补齐。
      return [];
    }
  };
}

// 导入悬浮窗组件 - 使用不同的变量名避免重复声明
let FloatingWindowClass = null;

// 立即执行函数，确保在浏览器环境中正确导入
(function() {
  // 首先尝试从全局变量获取
  if (typeof window !== 'undefined' && window.MediaFloatingWindow) {
    FloatingWindowClass = window.MediaFloatingWindow;
    return;
  }
  
  // 如果全局变量不存在，等待DOM加载完成后再尝试
  if (typeof window !== 'undefined') {
    const checkFloatingWindow = () => {
      if (window.MediaFloatingWindow) {
        FloatingWindowClass = window.MediaFloatingWindow;
      } else {
        console.warn('悬浮窗组件尚未加载，将在后续尝试获取');
      }
    };
    
    // DOM加载完成后检查
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', checkFloatingWindow);
    } else {
      checkFloatingWindow();
    }
    
    // 设置一个定时器，定期检查悬浮窗组件是否已加载
    const intervalId = setInterval(() => {
      if (window.MediaFloatingWindow && !FloatingWindowClass) {
        FloatingWindowClass = window.MediaFloatingWindow;
        clearInterval(intervalId);
      }
    }, 100);
    
    // 10秒后清除定时器，避免无限检查
    setTimeout(() => {
      clearInterval(intervalId);
      if (!FloatingWindowClass) {
        console.warn('悬浮窗组件加载超时');
      }
    }, 10000);
  }
})();

// 模态窗口管理器
class ModalManager {
  constructor() {
    ClipMateLog.debug('===== ModalManager初始化 =====');
    this.floatingWindow = null;
    this.isOpen = false;
    this.isClosing = false; // 添加关闭状态标志
    this.data = null;
    this.fieldOrder = [];
    this.isEditMode = false;
    this.originalData = null;
    this.originalFieldOrder = null;
    this.originalOnClose = null; // 保存原始的onClose回调
    // 添加展示模式状态，默认为纵向模式
    this.displayMode = 'vertical'; // 'horizontal' 或 'vertical'
    // 添加字段映射配置
    this.fieldMappings = {};
  }

  // 检查文本是否为URL格式
  
  // 检查媒体类型是否是另一个类型的子类型
  
  /**
   * 数据预处理：字段过滤、排序、映射、编辑态备份。
   * open() 与 updateInPlace() 共用，避免就地刷新时重复实现。
   */

  /**
   * 就地更新已打开的面板内容（不重建窗口），用于 Instagram Modal 切换帖子时实时跟随。
   * 复用 _prepareData 预处理数据，再调用既有 updateTable 就地重渲染，保留窗口位置与编辑态。
   */






  /**
   * 事件接线（v2.5.45 重写）
   *
   * 历史问题：这个方法写了 120 行，但整个项目一次都没被调用过；
   * 而且它绑定按钮时查的是「内容区」，而按钮从 v2.5.41 起已全部搬进标题栏
   * （由 createFloatingWindowActions 创建时就自带 addEventListener）。
   * 所以原实现即使被调起来，也只会去绑一堆根本不存在的元素。
   *
   * 现在只做两件真正缺失的事：
   *   1) ESC 关闭浮窗（原先注册在这段死代码里；close() 却在移除一个从未存在的监听）
   *   2) 编辑模式下双击表头改名（每次渲染后重绑，因为 updateTable 会重建 DOM）
   */
  attachEvents() {
    this._bindEscClose();
    this._bindHeaderRename();
    // v2.5.47（B4）：「/」唤起表格内搜索
    if (typeof this._bindSearchShortcut === 'function') this._bindSearchShortcut();
  }

  /** ESC 关闭浮窗。只注册一个监听，重复调用先移除旧的。 */
  _bindEscClose() {
    if (this.escKeyHandler) {
      document.removeEventListener('keydown', this.escKeyHandler);
      this.escKeyHandler = null;
    }
    this.escKeyHandler = (e) => {
      if (e.key !== 'Escape' || !this.isOpen) return;
      // v2.5.47：搜索条开着时，Esc 只收搜索条，不关窗（跟输入框里的 Esc 行为一致）
      if (this._searchOpen) {
        this.closeSearch();
        return;
      }
      // 正在编辑表头/单元格时不关窗，先让用户处理输入框
      // （v2.12.1：编辑模式增加了单元格改值，.field-editor 必须一起挡 —— 否则
      //   在格子里按 Esc 想撤销，整个浮窗先被关掉了。）
      try {
        const content = this.floatingWindow ? this.floatingWindow.getContentElement() : null;
        if (content && content.querySelector('.header-editor, .field-editor')) return;
      } catch (err) { /* 忽略：拿不到内容区就按正常关闭处理 */ }
      this.close();
    };
    document.addEventListener('keydown', this.escKeyHandler);
  }

  /** 编辑模式下给表头绑双击改名；非编辑模式不绑，避免误改。 */
  _bindHeaderRename() {
    if (!this.isEditMode || !this.floatingWindow) return;
    const contentElement = this.floatingWindow.getContentElement();
    if (!contentElement) return;
    contentElement.querySelectorAll('.sortable-header').forEach((header) => {
      if (header.__clipmateRenameBound) return;
      header.__clipmateRenameBound = true;
      header.addEventListener('dblclick', (e) => {
        e.preventDefault();
        const el = e.currentTarget || e.target;
        if (el && typeof this.startHeaderEditing === 'function') this.startHeaderEditing(el);
      });
    });
  }



  
  // 切换显示模式方法
  
  // 创建悬浮窗按钮区域的方法
  createFloatingWindowActions() {
    // 确保floatingWindow对象存在
    if (!this.floatingWindow) {
      console.error('悬浮窗对象不存在，无法创建按钮容器');
      return;
    }
    
    // 获取标题栏按钮容器（现在使用标题栏而不是内容区域）
    const titleBarButtonsContainer = this.floatingWindow.getTitleBarButtonsContainer();
    if (!titleBarButtonsContainer) {
      console.error('无法获取标题栏按钮容器');
      return;
    }
    
    // 清空现有的标题栏按钮
    titleBarButtonsContainer.innerHTML = '';

    // 按钮区马上要重建，旧菜单还挂着的话锚点就失效了
    this._hideTitleMenu();

    // 根据编辑模式创建不同的按钮
    const buttons = [];

    /* ---------- v2.5.73（批3·方案乙）：⋯ 菜单取消，功能全部摊在标题栏 ----------
       原来 600px 浮窗放不下 9 个按钮，就把「复制纯文本 / 重置排序 / 补齐网址」
       收进了 ⋯ 菜单。用户反馈「藏得太深」，所以现在让按钮区自己折行
       （样式见 floating-window-styles.js 的 .floating-window-title-buttons），
       放不下就掉到第二行，菜单整个不要了。
       放大镜和最小化仍是 26px 图标按钮（省地方），其余都是文字按钮，
       两个复制按钮按用户要求保持原样、不合并。
       菜单方法 _showTitleMenu/_hideTitleMenu 留着 —— modal-window.js 隐藏浮窗时
       还会调 _hideTitleMenu 做清理，删了会报错。 */

    const makeIconButton = (id, glyph, tip) => {
      const b = document.createElement('button');
      b.id = id;
      b.textContent = glyph;
      b.title = tip;
      b.className = 'floating-window-title-button is-icon';
      b.style.cssText = 'background:transparent;color:#6b7278;border:none;border-radius:4px;cursor:pointer;transition:all 0.2s;';
      return b;
    };

    /* 文字按钮（v2.8.5 加 tone 档位）
       原来所有按钮一律 #e0e0e0 底、#333 字，九个按钮长得一模一样，
       用户扫过去找不到落点。现在分三档，靠底色和字色拉开层级：
         primary 实心蓝   —— 全窗只留一个，给最高频的「复制 Markdown」
         accent  浅蓝底   —— 复制组和补齐网址，同一档，视觉上连成一排
         ghost   无底色   —— 编辑 / 重置排序等低频项，退到背景里 */
    /* primary（实心蓝）不放进这张表：全窗只有「复制 Markdown」一个主按钮，
       它需要自己的字重和点击逻辑，单独建（见下方 copyMarkdownBtn）。
       放进表里会变成一个没人用的档位，下次谁改这里会以为改得动主按钮。 */
    const TONE = {
      accent: 'background:#EEF4FF;color:#0448A6;',
      ghost: 'background:transparent;color:#6b7278;'
    };

    const makeTextButton = (id, text, tip, onClick, tone = 'accent') => {
      const b = document.createElement('button');
      b.id = id;
      b.type = 'button';
      b.textContent = text;
      if (tip) b.title = tip;
      b.className = 'floating-window-title-button';
      b.style.cssText = 'padding:4px 8px;font-size:12px;' + (TONE[tone] || TONE.accent) +
        'border:none;border-radius:4px;cursor:pointer;transition:all 0.2s;';
      b.addEventListener('click', onClick);
      return b;
    };

    /* 细线分隔：把高频区和低频区分开。
       必须是真元素 —— 按钮区是 flex-wrap，伪元素折行时会挂在最后那个按钮的尾巴上。 */
    const makeTitleDivider = () => {
      const d = document.createElement('span');
      d.className = 'floating-window-title-divider';
      d.setAttribute('aria-hidden', 'true');
      return d;
    };

    // 最小化（B3）—— 编辑模式下也留着：编辑到一半想腾地方看网页同样需要
    const makeMinimizeBtn = () => {
      const b = makeIconButton('minimizeWindow', '—', '最小化成胶囊');
      b.addEventListener('click', () => {
        if (this.floatingWindow && typeof this.floatingWindow.minimize === 'function') {
          this.floatingWindow.minimize();
        }
      });
      return b;
    };

    // 表格内搜索（B4）—— 只在非编辑模式给：编辑模式下单元格点击是拖拽排序，
    // 搜索结果又把行藏起来，容易把拖拽目标弄丢
    const makeSearchBtn = () => {
      const b = makeIconButton('searchToggle', '🔍', '搜索字段名或内容（/）');
      b.addEventListener('click', () => {
        if (typeof this.toggleSearch === 'function') this.toggleSearch();
      });
      return b;
    };

    /* 以下三个原本都塞在 ⋯ 菜单里（v2.5.65 / v2.5.72），v2.5.73 全部提到标题栏 */

    // 复制纯文本
    const makePlainTextBtn = () => makeTextButton(
      'copyPlainText', '复制纯文本', '复制为「字段：值」的纯文本',
      async () => {
        const ok = await this.copyDataAsPlainText();
        this._flashCopyButton('copyPlainText', ok, '复制纯文本');
      },
      'accent'
    );

    // 重置排序：清掉「这个媒体类型」保存的字段顺序，回到默认（会弹提示说明）
    const makeResetOrderBtn = () => makeTextButton(
      'resetFieldOrderBtn', '重置排序', '把这个媒体类型保存的字段顺序恢复成默认',
      () => this.resetFieldOrder(),
      'ghost'
    );

    // 补齐网址：影视页 + 豆瓣书籍页才给。
    //   · 影视页：字段清单里有 TMDB / Bangumi，四站互跳
    //   · 豆瓣书籍页（v2.5.76）：URL 这一格是空的，补它是 Goodreads / 番组计划
    // 其他类不给 —— 游戏、社交的字段清单里没有可补的格子，塞进去只是多两个空行。
    const makeCrossSiteBtn = (isBook) => makeTextButton(
      'crossSiteFill', '补齐网址',
      isBook
        ? '到 Goodreads（按 ISBN 精确查）和番组计划找这本书的网址（已有值不覆盖）'
        : '到豆瓣 / IMDb / 番组计划 / TMDB 找这一条的网址（已有值不覆盖）',
      () => this.fillCrossSiteLinks(),
      'accent'
    );

    // 所有图标按钮统一的悬停效果（和文字按钮一样用 opacity，不改底色）
    const bindIconHover = (btn) => {
      btn.addEventListener('mouseenter', function () { this.style.opacity = '0.8'; });
      btn.addEventListener('mouseleave', function () { this.style.opacity = '1'; });
      return btn;
    };
    
    // 确保displayMode有值
    if (!this.displayMode) {
      this.displayMode = 'vertical';
    }
    
    // 无论是否在编辑模式，都添加显示模式切换按钮
    const toggleDisplayModeBtn = document.createElement('button');
    toggleDisplayModeBtn.id = 'toggleDisplayMode';
    toggleDisplayModeBtn.textContent = this.displayMode === 'horizontal' ? '纵向' : '横向';
    toggleDisplayModeBtn.className = 'floating-window-title-button';
    toggleDisplayModeBtn.style.cssText = `
      padding: 4px 8px;
      font-size: 12px;
      background: transparent;
      color: #6b7278;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    `;
    
    // 使用箭头函数确保this上下文正确
    const self = this; // 保存当前this引用
    toggleDisplayModeBtn.onclick = function() {
      // 直接调用toggleDisplayMode方法
      self.toggleDisplayMode();
      // 立即更新按钮文本，提供即时反馈
      this.textContent = self.displayMode === 'horizontal' ? '纵向' : '横向';
    };
    
    // 添加悬停效果
    /* v2.8.5：原来悬停把底色改成 #d0d0d0，是九个按钮里唯一一个「悬停变色块」的，
       改成和其它按钮一样的透明度反馈，避免它又跳出层级。 */
    toggleDisplayModeBtn.addEventListener('mouseenter', function() {
      this.style.opacity = '0.65';
    });

    toggleDisplayModeBtn.addEventListener('mouseleave', function() {
      this.style.opacity = '1';
    });
    
    /* v2.8.5：横向/纵向切换从「永远第一个」改成跟着低频组走。
       它排第一的时候，用户打开浮窗第一眼看到的是「横向」，
       而真正天天点的复制按钮被挤到中段。 */
    
    if (this.isEditMode) {
      // 编辑模式下的按钮
      const resetOrderBtn = document.createElement('button');
      resetOrderBtn.id = 'resetOrder';
      resetOrderBtn.textContent = '重置顺序';
      resetOrderBtn.className = 'floating-window-title-button';
      resetOrderBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: #e0e0e0;
        color: #333;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      resetOrderBtn.addEventListener('click', () => this.resetOrder());
      
      const cancelBtn = document.createElement('button');
      cancelBtn.id = 'cancelEdit';
      cancelBtn.textContent = '取消';
      cancelBtn.className = 'floating-window-title-button';
      cancelBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: #ff9800;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      cancelBtn.addEventListener('click', () => this.cancelEdit());
      
      const confirmBtn = document.createElement('button');
      confirmBtn.id = 'confirmEdit';
      confirmBtn.textContent = '确认';
      confirmBtn.className = 'floating-window-title-button';
      confirmBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: #4caf50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      confirmBtn.addEventListener('click', () => this.confirmEdit());
      
      buttons.push(toggleDisplayModeBtn, resetOrderBtn, cancelBtn, confirmBtn, bindIconHover(makeMinimizeBtn()));
    } else {
      // 非编辑模式下的按钮
      const enterEditModeBtn = document.createElement('button');
      enterEditModeBtn.id = 'enterEditMode';
      enterEditModeBtn.textContent = '编辑';
      enterEditModeBtn.className = 'floating-window-title-button';
      /* v2.8.5：「编辑」从实心蓝降到 ghost —— 主色全窗只留给最高频的复制 Markdown。
         编辑本身不改变数据内容，只是换个查看方式，配不上主按钮的颜色。 */
      enterEditModeBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: transparent;
        color: #6b7278;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      enterEditModeBtn.addEventListener('click', () => this.enterEditMode());
      
      const copyDataBtn = document.createElement('button');
      copyDataBtn.id = 'copyData';
      copyDataBtn.textContent = '复制Notion';
      copyDataBtn.title = '复制为Notion兼容格式（HTML和TSV双格式）';
      copyDataBtn.className = 'floating-window-title-button';
      copyDataBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: #EEF4FF;
        color: #0448a6;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      // v2.5.47（B7）：复制成功后按钮自己变「已复制 ✓」，眼睛不用离开鼠标
      copyDataBtn.addEventListener('click', async () => {
        const ok = await this.copyData();
        this._flashCopyButton('copyData', ok, '复制Notion');
      });
      
      const copyMarkdownBtn = document.createElement('button');
      copyMarkdownBtn.id = 'copyMarkdown';
      copyMarkdownBtn.textContent = '复制Markdown';
      copyMarkdownBtn.title = '复制为Markdown表格格式';
      copyMarkdownBtn.className = 'floating-window-title-button';
      /* v2.8.5：最高频动作，全窗唯一的实心蓝主按钮。
         高频按钮必须长得跟其它按钮不一样，否则「排序」只解决了一半问题 ——
         位置对了，眼睛还是要一个个读文字。 */
      copyMarkdownBtn.style.cssText = `
        padding: 4px 8px;
        font-size: 12px;
        background: #056bf4;
        color: #ffffff;
        font-weight: 600;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
      `;
      // v2.5.47（B7）：同上
      copyMarkdownBtn.addEventListener('click', async () => {
        const ok = await this.copyDataAsMarkdown();
        this._flashCopyButton('copyMarkdown', ok, '复制Markdown');
      });
      
      // v2.5.73（批3）：⋯ 菜单取消，全部按钮摊在标题栏，放不下自动折行。
      // 排序逻辑：常用的（编辑 / 三种复制）在前，补齐网址紧随（影视页 / 豆瓣书籍页才有），
      // 然后是图标（🔍 / —），低频且会改配置的「重置排序」夹在最后两个之间。
      const isMediaPage = !!(this.data && ('TMDB' in this.data || 'Bangumi' in this.data));
      // v2.5.76：豆瓣书籍页 —— URL 格是空的（其他书籍站都填了自己那一页），
      // 再加一道地址判断，免得哪本书恰好 URL 为空也在别的站上冒出这个按钮。
      const isBookUrlPage = !!(this.data && ('URL' in this.data) && !this.data['URL'] &&
        typeof window !== 'undefined' && window.CrossSiteLinker &&
        window.CrossSiteLinker.isDoubanBookPage(window.location.href));
      const canCrossSite = (isMediaPage || isBookUrlPage) &&
        typeof this.fillCrossSiteLinks === 'function';

      /* v2.8.5：按实际使用频率重排。
         用户给的频次：复制 Markdown > 复制 Notion > 复制纯文本，豆瓣书籍页常点补齐网址，
         其余几乎不用。所以分三档：
           第一档 三种复制  —— 连成一排，Markdown 实心蓝当主按钮（最高频）
           第二档 补齐网址  —— 只在有那一格的页面出现，紧跟复制组
           第三档 编辑 / 搜索 / 横向 / 重置排序 / 最小化 —— 细线之后，无底色，退到背景里
         一条铁律：这条细线是真元素，不是伪元素 —— 按钮区是 flex-wrap 的，
         伪元素折行时会挂在最后一个按钮尾巴上，分隔线会跑到行中间去。 */
      buttons.push(
        copyMarkdownBtn,
        copyDataBtn,
        makePlainTextBtn(),
        ...(canCrossSite ? [makeCrossSiteBtn(isBookUrlPage)] : []),
        makeTitleDivider(),
        enterEditModeBtn,
        bindIconHover(makeSearchBtn()),
        toggleDisplayModeBtn,
        makeResetOrderBtn(),
        bindIconHover(makeMinimizeBtn())
      );
    }
    
    // 添加悬停效果
    buttons.forEach(btn => {
      if (btn.id !== 'toggleDisplayMode') { // 避免重复添加
        btn.addEventListener('mouseenter', function() {
          this.style.opacity = '0.8';
        });
        
        btn.addEventListener('mouseleave', function() {
          this.style.opacity = '1';
        });
      }
    });
    
    // 添加所有按钮到标题栏按钮容器
    try {
      buttons.forEach(btn => titleBarButtonsContainer.appendChild(btn));
    } catch (error) {
      console.error('无法添加按钮到标题栏:', error);
    }
    
    // 移除内容区域底部的按钮容器（如果存在）
    const contentElement = this.floatingWindow.getContentElement();
    if (contentElement) {
      const oldActions = contentElement.querySelector('.floating-window-actions');
      if (oldActions && oldActions.parentNode) {
        oldActions.parentNode.removeChild(oldActions);
      }
    }
  }

  /**
   * 复制按钮原地反馈（v2.5.47 / B7）
   *
   * 按钮每次刷新表格都会被 createFloatingWindowActions 重建（innerHTML=''），
   * 所以这里按 id 现查，不能存按钮引用 —— 存了就是指向一个已经被清掉的孤儿节点。
   */
  _flashCopyButton(btnId, ok, idleText) {
    try {
      const fw = this.floatingWindow;
      if (!fw || typeof fw.getShadowRoot !== 'function') return;
      const btn = fw.getShadowRoot().querySelector('#' + btnId);
      if (!btn) return;

      if (!this._copyFlashTimers) this._copyFlashTimers = {};
      if (this._copyFlashTimers[btnId]) clearTimeout(this._copyFlashTimers[btnId]);

      // 原底色 / 原字色只在第一次记；内联 background 设为 '' 不会还原 cssText 里的值，所以要存下来。
      // v2.8.5 补字色：复制 Markdown 现在是白字蓝底，如果只记底色、还原时硬写 #333，
      // 复制一次之后它就变成蓝底深灰字，看起来像被禁用。
      if (!btn.dataset.idleBackground) {
        btn.dataset.idleBackground = btn.style.background || 'rgb(224, 224, 224)';
      }
      if (!btn.dataset.idleColor) {
        btn.dataset.idleColor = btn.style.color || 'rgb(51, 51, 51)';
      }
      if (!btn.dataset.idleWeight) {
        btn.dataset.idleWeight = btn.style.fontWeight || '';
      }
      const idleBg = btn.dataset.idleBackground;
      const idleColor = btn.dataset.idleColor;
      const idleWeight = btn.dataset.idleWeight;

      btn.textContent = ok ? '已复制 ✓' : '复制失败';
      btn.style.background = ok ? '#EAF7F0' : '#FDECEC';
      btn.style.color = ok ? '#0B5A2E' : '#B42318';
      btn.style.fontWeight = '600';

      this._copyFlashTimers[btnId] = setTimeout(() => {
        btn.textContent = idleText;
        btn.style.background = idleBg;
        btn.style.color = idleColor;
        btn.style.fontWeight = idleWeight;
        delete this._copyFlashTimers[btnId];
      }, ok ? 2000 : 1500);
    } catch (e) {
      console.warn('[ClipMate] 复制按钮反馈失败:', e && e.message);
    }
  }

  /**
   * 打开标题栏「⋯」菜单（v2.5.47）
   * 菜单用 position:fixed + JS 算坐标：宿主是 overflow:hidden，
   * 菜单留在文档流里会被折叠状态（55px 高）直接裁掉看不见。
   */
  _showTitleMenu(anchorBtn, items) {
    this._hideTitleMenu();
    const fw = this.floatingWindow;
    if (!fw || !items || !items.length) return;

    const menu = document.createElement('div');
    menu.className = 'clipmate-title-menu';
    items.forEach((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = item.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this._hideTitleMenu();
        try {
          item.onClick();
        } catch (err) {
          console.warn('[ClipMate] 菜单项执行失败:', err && err.message);
        }
      });
      menu.appendChild(b);
    });

    fw.getShadowRoot().appendChild(menu);

    const r = anchorBtn.getBoundingClientRect();
    menu.style.top = (r.bottom + 4) + 'px';
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';

    this._titleMenu = menu;

    // 点别处关掉。延一拍再挂监听，否则这次点击自己就把菜单关了。
    //
    // v2.5.65 修正：原来只判断 menu.contains(ev.target)，而菜单在浮窗的 Shadow DOM 里，
    // 事件传到 document 时 target 已被「重定向」成宿主元素（.media-floating-window），
    // menu.contains(宿主) 恒为 false → 点菜单项被当成「点了别处」→ 菜单在 mousedown
    // 阶段就被移除 → mouseup 找不到同一个目标 → 浏览器不派发 click → 菜单项永远点不动。
    // 用 composedPath() 能拿到 Shadow DOM 里的真实路径，菜单项在路径里就不再误关。
    this._titleMenuOutside = (ev) => {
      const path = (ev && typeof ev.composedPath === 'function') ? ev.composedPath() : null;
      if (path && path.length) {
        if (path.indexOf(menu) !== -1) return;
      } else if (menu.contains(ev.target)) {
        return;
      }
      this._hideTitleMenu();
    };
    setTimeout(() => {
      if (this._titleMenu === menu) {
        document.addEventListener('mousedown', this._titleMenuOutside, true);
      }
    }, 0);
  }

  /** 关闭「⋯」菜单（v2.5.47） */
  _hideTitleMenu() {
    if (this._titleMenuOutside) {
      document.removeEventListener('mousedown', this._titleMenuOutside, true);
      this._titleMenuOutside = null;
    }
    const menu = this._titleMenu;
    if (menu && menu.parentNode) {
      menu.parentNode.removeChild(menu);
    }
    this._titleMenu = null;
  }
  
  // 确保底部按钮样式正确应用的辅助方法（保留以备不时之需）
  ensureButtonStyles() {
    // 确保floatingWindow存在
    if (!this.floatingWindow) return;
    
    // 获取悬浮窗内容区域
    const contentElement = this.floatingWindow.getContentElement();
    if (!contentElement) return;
    
    // 检查按钮元素是否存在
    const floatingWindowActions = contentElement.querySelector('.floating-window-actions');
    if (!floatingWindowActions) return;
    
    // 获取所有按钮
    const resetOrderBtn = floatingWindowActions.querySelector('#resetOrder');
    const copyDataBtn = floatingWindowActions.querySelector('#copyData');
    const resetSortConfigBtn = floatingWindowActions.querySelector('#resetSortConfig');
    
    // 确保所有按钮都有正确的类名 - 使用极简样式
    if (resetOrderBtn) {
      resetOrderBtn.className = 'btn';
    }
    if (copyDataBtn) {
      copyDataBtn.className = 'btn';
    }
    if (resetSortConfigBtn) {
      resetSortConfigBtn.className = 'btn';
    }
  }


  // 清理数据中的特殊字符

  // 实现双格式复制功能

  // 已移除复制表头和复制HTML功能

  // 复制数据为Markdown表格格式

  // 转义Markdown特殊字符

  
  // 清除保存的字段顺序



  
  // 保存字段映射到本地存储
  
  
  
  
  // 从本地存储加载字段映射
  
  // 获取最终映射的字段名（处理嵌套映射）
  
  // 应用已保存的字段映射到数据
  
  // 保存字段顺序到本地存储
  
  // 获取当前媒体类型
  
  // 应用已保存的字段顺序
}


// 将持久化方法合并到原型（来自 modal-persistence.js Mixin）
// 导出模态窗口管理器到全局作用域，确保content-main.js可以访问
window.ModalManager = ModalManager;

// 兼容CommonJS模块导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModalManager;
}