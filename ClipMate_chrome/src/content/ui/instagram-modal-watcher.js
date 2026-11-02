/**
 * Instagram Modal 监听器（自包含，零外部依赖，兼容 classic content script）
 *
 * 解决的问题：Instagram 在博主主页 / feed / Reels 等页面点击帖子时，
 * 不会整页跳转，而是在当前页用 SPA 方式打开 Post/Reels/Story Modal。
 * 本监听器实时感知「Modal 打开 / 当前帖子变化 / Modal 关闭」，
 * 并对外抛出三个回调，供 MediaExtractor 做作用域化提取。
 *
 * 关键点（对应需求「URL 可能变也可能不变」）：
 *  - 主信号：div[role="dialog"] 出现 / 消失（MutationObserver）
 *  - 二级信号：history.pushState / replaceState / popstate（URL 变化）
 *  - 关键信号：Modal 内 <article> 内容变化（即使 URL 不变，换帖也触发）
 *    → 只要 Modal 内帖子内容变了，就抛出 onActivePostChange，天然覆盖「URL 不变」的情况。
 *
 * 本类不依赖 PageSwitchDetector（它在运行时是未接线的死代码），
 * 设计为可被未来其他社交平台子类继承（onModalOpen / onActivePostChange / onModalClose）。
 */
(function (global) {
  'use strict';

  const log = (...args) => {
    try {
      if (typeof ClipMateLog !== 'undefined') {
        ClipMateLog.debug('[IGModalWatcher]', ...args);
        return;
      }
      if (typeof global.safeLog === 'function') {
        global.safeLog('[IGModalWatcher] ' + args.map(function (a) { return String(a); }).join(' '));
        return;
      }
      if (typeof console !== 'undefined' && typeof console.debug === 'function') {
        console.debug('[IGModalWatcher]', ...args);
      }
    } catch (e) { /* 静默 */ }
  };

  function debounce(fn, wait) {
    let t = null;
    return function (...a) {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(this, a); }, wait);
    };
  }

  /**
   * 在空闲时执行回调（requestIdleCallback 优先，回退到 setTimeout 800ms）。
   * 比固定 setTimeout 更智能：浏览器空闲时立即执行，繁忙时自然等待。
   */
  function runWhenIdle(cb) {
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(cb, { timeout: 2000 });
      return id;
    }
    return setTimeout(cb, 800);
  }

  class InstagramModalWatcher {
    constructor(options = {}) {
      // 四个对外回调（可被子类 / 调用方覆写）
      this.onModalOpen = typeof options.onModalOpen === 'function' ? options.onModalOpen : () => {};
      this.onActivePostChange = typeof options.onActivePostChange === 'function' ? options.onActivePostChange : () => {};
      this.onModalClose = typeof options.onModalClose === 'function' ? options.onModalClose : () => {};
      // onPageChange：非 Modal 场景下的 SPA 切换（Reels / Stories Highlights 等整页导航；
      // 可能触发 pushState，也可能只改 DOM 不改 URL。两种信号都响应。）
      this.onPageChange = typeof options.onPageChange === 'function' ? options.onPageChange : () => {};

      this.dialogEl = null;        // 当前 div[role="dialog"]
      this.activeShortcode = null; // 当前 Modal 内帖子 shortcode（reelId / storyId / post code）
      this.innerObserver = null;   // 监听 Modal 内 <article> 内容变化
      this.dialogObserver = null;  // 监听 dialog 出现 / 消失
      this._origPush = null;
      this._origReplace = null;

      this._checkDialog = debounce(() => this._scanDialog(), 150);
      this._onInnerChange = debounce(() => this._emitActiveChange(), 300);
      // pageChange 用空闲调度，不固定延迟（requestIdleCallback 或 setTimeout 800ms）
      this._pendingPageChange = false;
    }

    /**
     * 启动监听（只调用一次，通常由 MediaExtractor.init() 调用）
     */
    start() {
      this._initDialogObserver();
      this._initHistoryHijack();
      // 兜底：页面加载时 Modal 已经打开（如直接打开带 Modal 的 URL）
      const existing = document.querySelector('div[role="dialog"]');
      if (existing) this._handleModalOpen(existing);
    }

    _initDialogObserver() {
      this.dialogObserver = new MutationObserver(() => this._checkDialog());
      // 需要 subtree: true，原因：
      // - 普通 Post Modal 通过 React Portal 挂载为 body 的直接子节点
      // - 快拍（Stories）的 dialog 嵌套在 React root 内部（body > div#react-root > section > ...）
      //   不是 body 的直接子节点，无 subtree 则捕获不到 Stories 的打开/切换
      // 性能：回调已做 150ms debounce，实际执行仅一次 querySelector，开销可接受
      this.dialogObserver.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * 扫描 dialog。同时也是一个「通用页面变化检测」：
     *  - dialog 出现 → _handleModalOpen
     *  - dialog 消失 → _handleModalClose
     *  - 无 dialog 但 body 变了 → _schedulePageChange（捕获 Reels/Stories 等纯 DOM SPA 切换）
     */
    _scanDialog() {
      const dlg = document.querySelector('div[role="dialog"]');
      if (dlg && dlg !== this.dialogEl) {
        this._handleModalOpen(dlg);
      } else if (!dlg && this.dialogEl) {
        this._handleModalClose();
      } else if (!dlg && !this.dialogEl) {
        // 无 dialog 的页面发生了 DOM 变化 → 可能是 SPA 切换（Reels/Stories Highlights）
        this._schedulePageChange();
      }
    }

    /**
     * 调度一次页面切换检测（非 Modal SPA 导航，如 Reels 自动播放、Stories 切换）。
     * 防抖 + 空闲调度：即使 body 频繁突变也只在空闲时触发一次。
     */
    _schedulePageChange() {
      if (this._pendingPageChange) return;
      this._pendingPageChange = true;
      runWhenIdle(() => {
        this._pendingPageChange = false;
        this.onPageChange();
      });
    }

    _initHistoryHijack() {
      const self = this;
      this._origPush = history.pushState;
      this._origReplace = history.replaceState;
      // 包一层：先执行 IG 自身逻辑，再触发我们的检查（不破坏 IG 的 SPA）
      // 重要：用 _onInnerChange() 而非 _emitActiveChange()——前者有 300ms 防抖，
      // 给 React 时间完成 DOM 渲染后再提取。直接调用 _emitActiveChange 会
      // 在 pushState 后立即提取，但此时新帖子的内容可能还未渲染完成（Reels 常见）。
      history.pushState = function (...args) {
        self._origPush.apply(this, args);
        if (self.dialogEl) {
          self._onInnerChange();
        } else {
          self.onPageChange();
        }
      };
      history.replaceState = function (...args) {
        self._origReplace.apply(this, args);
        if (self.dialogEl) {
          self._onInnerChange();
        } else {
          self.onPageChange();
        }
      };
      global.addEventListener('popstate', () => {
        if (self.dialogEl) self._onInnerChange();
        else self.onPageChange();
      });
    }

    _handleModalOpen(dlg) {
      this.dialogEl = dlg;
      this._initInnerObserver(dlg);
      const code = this._extractShortcode(dlg);
      this.activeShortcode = code;
      this.onModalOpen(dlg, code);
      // 延迟 350ms 等 React 渲染完成后再提取。
      // ⚠️ 先重置 activeShortcode，否则 _emitActiveChange 会因
      //   code === activeShortcode 去重跳过，二次提取永不执行。
      setTimeout(() => {
        this.activeShortcode = null;
        this._emitActiveChange();
      }, 350);
    }

    _initInnerObserver(dlg) {
      if (this.innerObserver) this.innerObserver.disconnect();
      // 观察「稳定的 dialog 容器」而非内部 <article>：IG 切换帖子时常整体替换 <article>，
      // 若只观察 article，旧节点脱离文档后 observer 会失效，导致换帖不再触发。
      // dialog 容器在换帖时通常保留（仅内部子树变化），故持续有效。
      this.innerObserver = new MutationObserver(() => this._onInnerChange());
      // ✅ 优化：移除 characterData
      // 换帖时 React 整体替换 <article> 节点（childList 变化），无需监听文本节点。
      // 打字评论、数字动画等不再触发不必要的内容检测。
      this.innerObserver.observe(dlg, { childList: true, subtree: true });
    }

    /**
     * 当前 Modal 内帖子内容发生变化（换帖 / 内容渲染完成）→ 对外抛出
     * 无论 URL 是否变化，只要 Modal 内帖子变了就触发，天然满足需求。
     */
    _emitActiveChange() {
      if (!this.dialogEl) return;
      const code = this._extractShortcode(this.dialogEl);
      // 去重：同一条帖子（shortcode 未变）不重复触发，避免高频 mutation 反复重建面板
      if (code && code === this.activeShortcode) return;
      this.activeShortcode = code;
      this.onActivePostChange(this.dialogEl, code);
    }

    /**
     * 从 URL 或 Modal 内链接解析当前帖子的 shortcode。
     * 覆盖 /p/、/reels?/、/tv/、/stories/ 四种 Instagram 帖子形态。
     */
    _extractShortcode(dlg) {
      // 1) 优先从 URL 解析（Instagram 打开 Modal 通常会 pushState）
      const m = location.pathname.match(/\/(?:p|reels?|tv|stories\/[^\/?#]+\/)\/?([^/?#]+)/);
      if (m && m[1]) return m[1];

      // 2) URL 未变化时，从 Modal 内帖子链接解析（IG 偶有不 pushState 的情况）
      const link = dlg.querySelector('a[href*="/p/"], a[href*="/reel"], a[href*="/stories/"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const mm = href.match(/\/(?:p|reels?|tv|stories\/[^\/?#]+\/)\/?([^/?#]+)/);
        if (mm && mm[1]) return mm[1];
      }
      return null;
    }

    _handleModalClose() {
      if (this.innerObserver) { this.innerObserver.disconnect(); this.innerObserver = null; }
      this.dialogEl = null;
      this.activeShortcode = null;
      this.onModalClose();
    }

    destroy() {
      if (this.dialogObserver) this.dialogObserver.disconnect();
      if (this.innerObserver) this.innerObserver.disconnect();
      if (this._origPush) history.pushState = this._origPush;
      if (this._origReplace) history.replaceState = this._origReplace;
    }
  }

  global.InstagramModalWatcher = InstagramModalWatcher;
})(window);
