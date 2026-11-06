/**
 * X（推特）「页面上的推文」逐帖提取按钮（v2.7.45）
 *
 * 需求（用户 2026-11-01 拍板，与微博同一套口径）
 * ---------------------------------------------
 * 「为推特 X 的每一条推文增加小按钮，跟微博类似。」
 * 三条拍板：① 长推文接受列表页截断（不展开页面）② 详情页主贴不挂按钮（回复挂）
 * ③ 引用帖只取博主自己写的那段，他一个字没写 → 文案空 → 标题写「X推文」。
 *
 * 这里**不写任何选择器**，容器与取值一律问 `XFeedContext`，
 * 保证按钮和提取器看到的是同一份数据（微博 v2.7.39 的教训：
 * 选择器在四处各写一份，改一处漏一处）。
 *
 * 什么时候不挂
 * ------------
 * · 读不出唯一编号的容器（推荐位、骨架屏）→ 不挂，宁可少一颗也别挂错
 * · **详情页的主贴**（`mid` 等于地址栏那条）→ 不挂。它已经被全局悬浮按钮覆盖，
 *   挂上来只是重复；它下面的回复照挂（用户拍板 A 案）
 * · 整个页面只读出 1 条推文（= 单条详情视图）→ 全摘掉，那是全局按钮的活
 *
 * 按钮放哪儿（2026-11-01 真机实测，不是猜的）
 * ----------------------------------------
 * 「⋯」`[data-testid="caret"]` 右边距恒为 16px、尺寸 19×20，
 * 但**顶部有三档**：普通列表 12、详情页主贴 18、转推多一行「XX 已转帖」→ 28。
 * 微博搜索页那次就是写死 top 压住了正文（实测压 3px），这次直接逐卡算：
 * 竖向居中对齐到这一张卡自己的「⋯」上，算不出来才用 CSS 里的固定值兜底。
 *
 * 横向也不能写死（v2.7.44 真机复验发现）：「⋯」左边还有一颗 **「Grok 操作」按钮**
 * （约 20×20，紧贴「⋯」），固定 right 41 会把小按钮整个压在它上面 —— 用户想点
 * Grok AI 就点不到了。
 *
 * v2.7.45 真机复验又发现 **v2.7.44 的避让根本没生效**：那版靠
 * `caret.closest('div[role="group"]')` 找操作行，可 X 的操作行**压根没有 role=group**
 * （真机实测：往上七层全是 `div.css-g5y9jx`），于是永远回落固定 right 41，
 * 按钮仍旧整个盖住「Grok 操作」（实测按钮 701-727 vs Grok 706-726）。
 * 教训：**别猜 X 的 DOM 结构，用几何**。
 * 现在扫整张卡里的可点控件，按**几何**挑出「与「⋯」同一行、在它左边、且紧邻
 * （间隙 ≤ 30px）」的最靠右那个（真机实测就是「Grok 操作」，间隙 8px），
 * 把小按钮放到它左边再留 6px 间隙；没有紧邻控件才用固定 right 41 兜底。
 */
(function (global) {
  'use strict';

  var BTN_CLASS = 'clipmate-x-feed-btn';
  var MID_ATTR = 'data-cm-mid';          // 按钮上记「当前是哪条推文」
  var POS_ATTR = 'data-cm-pos';          // 记「position 是被我改过的」
  var STYLE_ID = 'clipmate-x-feed-style';
  var SCAN_DELAY = 260;                  // X 静止时 3 秒 0 次变更，滚动时一批一批来
  var MIN_POSTS = 2;                     // 少于这个数就是单条详情视图，不挂
  var BTN_SIZE = 28;                     // v2.8.8：26 → 28，给头像留出 20px 的头

  /** 「⋯」方框尺寸（实测 19×20，竖向按 20 算居中） */
  var CARET_H = 20;

  /** 横向避让：与「⋯」的间隙上限（真机「Grok 操作」是 8px），超过就不算「紧邻」 */
  var NEAR_GAP = 30;

  /** 横向避让：跟紧邻控件留的间隙 */
  var SIDE_GAP = 6;

  /**
   * v2.8.8：按钮里换成吉祥物，不再画文档线稿。
   *
   * 为什么是 background-image 而不是 <img>：站点对 img 的全局规则
   * （max-width / object-fit / border-radius / display）会把它改烂；
   * 而 28px 的容器里放 30px 宽的图、让左边 1px 透明边被裁掉，是无损的
   * ——母版左右各有 19px 透明留白，裁的正是这段空白。
   */
  /* v2.9.2：28px 的小按钮只能用「头部特写」，全身像缩到这个尺寸只剩一团白。
     素材自带 6% 内边距（拆图时加的），所以 31px 的框里实际只画出约 29px 的头。 */
  var MASCOT_W = 31;
  var MASCOT_H = 27.5;                   // face-idle 宽高比 1.129

  /** 取某形态的绝对地址；没有扩展运行时（单测/资源缺失）返回空串，走透明降级
      v2.12.7：优先走 ClipMateMascot（内联 data URL），别让页面去请求 chrome-extension://。 */
  function mascotUrl(name) {
    var rel = 'icons/mascot/' + (name || 'face-idle') + '.svg';
    try {
      if (typeof ClipMateMascot !== 'undefined' && ClipMateMascot &&
          typeof ClipMateMascot.url === 'function') {
        var inline = ClipMateMascot.url(rel);
        if (inline) return inline;
      }
    } catch (e) { /* 解析器不可用就走下面的老路 */ }
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime &&
          typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(rel);
      }
    } catch (e) { /* 测试环境没有 runtime */ }
    return '';
  }

  /** 生成「某状态换一张脸」的规则；拿不到资源时返回空串（保留待命那张） */
  function faceRule(state, name) {
    var u = mascotUrl(name);
    return u ? '.' + BTN_CLASS + '[data-state="' + state + '"]{background-image:url("' + u + '");}' : '';
  }

  /**
   * 固定兜底位置：只有当前这张卡找不到「⋯」时才用。
   * right 41 对三档都成立（横向与「⋯」同一条竖线）；
   * top 12 是按最常见的普通列表给的，找到「⋯」就一定会被逐卡值覆盖。
   */
  var LAYOUT = { top: 12 - (BTN_SIZE - CARET_H) / 2, right: 41 };

  function log() {
    try {
      if (global.ClipMateLog && global.ClipMateLog.debug) {
        global.ClipMateLog.debug.apply(global.ClipMateLog, arguments);
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    var url = mascotUrl();
    style.textContent = ''
      + '.' + BTN_CLASS + '{'
      + 'position:absolute;top:' + LAYOUT.top + 'px;right:' + LAYOUT.right + 'px;'
      + 'width:' + BTN_SIZE + 'px;height:' + BTN_SIZE + 'px;padding:0;margin:0;border:none;border-radius:9px;'
      + 'display:block;cursor:pointer;z-index:9;'
      // v2.8.8：不再垫底盘，吉祥物直接站在页面上（拖影只在 hover / 成功 / 失败时亮）
      + 'background-color:transparent;'
      + 'background-image:' + (url ? 'url("' + url + '")' : 'none') + ';'
      + 'background-repeat:no-repeat;background-position:center;'
      + 'background-size:' + MASCOT_W + 'px ' + MASCOT_H + 'px;'
      + 'transition:background-color .15s ease,transform .12s ease,opacity .15s ease;}'
      + '.' + BTN_CLASS + ':hover{background-color:rgba(29,155,240,.14);transform:scale(1.08);}'
      + '.' + BTN_CLASS + ':active{transform:scale(.95);}'
      + '.' + BTN_CLASS + '[data-state="busy"]{opacity:.45;cursor:default;}'
      + '.' + BTN_CLASS + '[data-state="ok"]{background-color:rgba(0,186,124,.20);}'
      + '.' + BTN_CLASS + '[data-state="fail"]{background-color:rgba(244,33,46,.18);}'
      // v2.9.2：有结果时换一张脸 —— 待命和进行中都是平静脸，成功笑、失败呆
      + faceRule('ok', 'face-happy') + faceRule('fail', 'face-blank');
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  class XFeedButtons {
    /**
     * @param {Object} options
     * @param {Function} options.onExtract - `({container, post}) => Promise<boolean>`，
     *        true 闪绿、false/抛错闪红。
     */
    constructor(options) {
      var opts = options || {};
      this.onExtract = typeof opts.onExtract === 'function' ? opts.onExtract : null;
      this.enabled = true;
      this._observer = null;
      this._timer = null;
      this._busy = false;      // 全局只允许一条同时提取，避免连点出两份浮窗
      this._buttons = [];      // 我挂出去的按钮（撤的时候按它逐个摘）
    }

    // ---------------------------------------------------------------- 生命周期

    start() {
      if (!this.enabled) return;
      if (!global.XFeedContext) {
        log('[XFeedButtons] 没有 XFeedContext，不启动');
        return;
      }
      if (!global.XFeedContext.getSite()) {
        log('[XFeedButtons] 不是 X 页面，不启动');
        return;
      }
      ensureStyle();
      this._watch();
      this.sync();
      log('[XFeedButtons] 已启动');
    }

    stop() {
      this._unwatch();
      this._removeAll();
      removeStyle();
      log('[XFeedButtons] 已停止');
    }

    /**
     * 同步一次。幂等，可以被任意频率调用。
     * 页面变了、滚动加载、SPA 换页都走这里。
     */
    sync() {
      if (!this.enabled) return;
      var ctx = global.XFeedContext;
      if (!ctx) return;
      if (!ctx.getSite()) {
        if (this._buttons.length) this._removeAll();
        return;
      }

      var containers = ctx.findContainers() || [];
      var items = [];
      // 详情页的主贴：编号等于地址栏那条，不挂（用户拍板 A 案）
      var activeMid = ctx.currentStatusId();

      for (var i = 0; i < containers.length; i++) {
        var el = containers[i];
        var post = null;
        try {
          post = ctx.readPost(el);
        } catch (e) {
          post = null;
        }
        if (!post || !post.mid) continue;      // 认不出编号 → 不挂
        items.push({ el: el, post: post });
      }

      // 只读出 1 条 = 单条详情视图 → 那是全局按钮的活
      if (items.length < MIN_POSTS) {
        if (this._buttons.length) {
          this._removeAll();
          log('[XFeedButtons] 推文不足 ' + MIN_POSTS + ' 条，不挂逐帖按钮');
        }
        return;
      }

      ensureStyle();
      var alive = [];
      for (var k = 0; k < items.length; k++) {
        var item = items[k];
        alive.push(item.el);
        if (activeMid && item.post.mid === activeMid) {
          // 主贴：要是有历史遗留按钮（从列表页点进来的），摘掉
          var stale = this._ownButtonOf(item.el);
          if (stale) this._detach(stale);
          continue;
        }
        this._syncOne(item.el, item.post);
      }
      this._dropStale(alive);
    }

    // ---------------------------------------------------------------- 监听

    _watch() {
      if (this._observer || typeof MutationObserver === 'undefined') return;
      var self = this;
      try {
        this._observer = new MutationObserver(function (records) {
          if (self._isOwnMutation(records)) return;   // 自己挂按钮不算页面变化
          self._schedule();
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        this._observer = null;
      }
    }

    _unwatch() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
    }

    /**
     * 这批 mutation 是不是「我自己挂按钮」造成的？
     * 只判新增节点：掐掉「挂按钮 → 又扫一遍」的白跑；
     * 删除一律不忽略 —— React 重渲染会把按钮摘掉（X 上更常见），必须让扫描补回来。
     */
    _isOwnMutation(records) {
      for (var i = 0; i < records.length; i++) {
        if (!this._allMine(records[i].addedNodes)) return false;
        if (records[i].removedNodes && records[i].removedNodes.length) return false;
      }
      return true;
    }

    _allMine(nodes) {
      if (!nodes || !nodes.length) return true;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!node || node.nodeType !== 1 || !node.classList || !node.classList.contains(BTN_CLASS)) {
          return false;
        }
      }
      return true;
    }

    _schedule() {
      if (this._timer) return;
      var self = this;
      this._timer = setTimeout(function () {
        self._timer = null;
        self.sync();
      }, SCAN_DELAY);
    }

    // ---------------------------------------------------------------- 挂载

    /** 容器里现在有没有「我挂的、且是直系子节点」的按钮 */
    _ownButtonOf(container) {
      try {
        var kids = container.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].classList && kids[i].classList.contains(BTN_CLASS)) return kids[i];
        }
      } catch (e) { /* 忽略 */ }
      return null;
    }

    /**
     * 竖向落点：按这一张卡片**自己的**「⋯」竖向居中。
     *
     * 为什么不能写死：X 的「⋯」顶部有三档 —— 普通列表 12、详情页主贴 18、
     * 转推多一行「XX 已转帖」→ 28。写死 top 12 的话，转推那条会压到昵称行。
     * 微博搜索页就是栽在这上面（真机压住「@某人」链接 3px），这里直接一劳永逸。
     *
     * @param {HTMLElement} container
     * @returns {number|null} 相对卡片顶部的 px；算不出来返回 null
     */
    _anchorTop(container) {
      var ctx = global.XFeedContext;
      if (!ctx) return null;
      try {
        var caret = container.querySelector(ctx.CARET_SELECTOR);
        if (!caret) return null;
        var cr = caret.getBoundingClientRect();
        var ar = container.getBoundingClientRect();
        if (!cr.height) return null;
        return Math.round(cr.top - ar.top + (cr.height - BTN_SIZE) / 2);
      } catch (e) {
        return null;
      }
    }

    /** 单条：该挂的挂、该更新的更新、编号变了的换一遍，位置每次都重算 */
    _syncOne(container, post) {
      var existing = this._ownButtonOf(container);
      if (existing) {
        // 按钮还在：X 的虚拟列表会**复用 article 节点换内容**（滚动时同一位置换成别的推文），
        // 所以编号和位置都得跟着更新，不能像微博那样只认一次。
        if (existing.getAttribute(MID_ATTR) !== post.mid) {
          existing.setAttribute(MID_ATTR, post.mid);
        }
        this._place(existing, container);
        return;
      }
      this._attach(container, post);
    }

    /**
     * 横向落点：避让「⋯」左边**紧邻**的那个控件。
     *
     * 为什么不能只靠固定 right 41：v2.7.43 真机复验发现，X 的操作行在「⋯」左边
     * **还有一个「Grok 操作」按钮**（约 20×20，紧贴「⋯」），固定 right 41 会把
     * 小按钮整个压在它上面（真机实测两矩形几乎完全重叠）—— 用户想点 Grok AI
     * 就点不到了。
     *
     * 为什么不用 DOM 结构找：v2.7.44 那版靠 `caret.closest('div[role="group"]')`
     * 找操作行，**真机证明 X 的操作行没有 role=group**（往上七层全是普通 div），
     * 于是避让从未生效。**别猜 X 的 DOM 结构，用几何。**
     *
     * 现在的判据（全部来自真机实测）：
     *   ① 与「⋯」**垂直相交**（同一行）
     *   ② **整个在「⋯」左边**
     *   ③ 间隙 **≤ 30px**（真机「Grok 操作」是 8px；日期链接差 252px，不算紧邻，
     *      否则按钮会跑到操作行正中间去）
     * 取满足条件的里**最靠右**那个（= 紧邻的），把小按钮放到它左边再留 6px 间隙。
     * 没有紧邻控件（或者布局读不出来）→ 返回 null，沿用 CSS 里的固定值兜底。
     *
     * @param {HTMLElement} container
     * @returns {number|null} 相对卡片右缘的 px；算不出来返回 null
     */
    _anchorRight(container) {
      var ctx = global.XFeedContext;
      if (!ctx) return null;
      try {
        var caret = container.querySelector(ctx.CARET_SELECTOR);
        if (!caret) return null;
        var cr = caret.getBoundingClientRect();
        var ar = container.getBoundingClientRect();
        if (!ar.width || !cr.height) return null;

        // 扫整张卡（不猜操作行是哪一层）：X 的操作行在真机里是普通 div 套 div
        var ctrls = container.querySelectorAll('button, a[href], [role="button"]');
        var nearest = null;   // 紧邻控件的左缘
        for (var i = 0; i < ctrls.length; i++) {
          var el = ctrls[i];
          if (el === caret) continue;
          if (el.getAttribute && el.getAttribute('data-testid') === 'caret') continue;
          // **必须排除自己挂的按钮**：它也是 <button>，算进去会自我反馈（越算越偏）
          if (el.classList && el.classList.contains(BTN_CLASS)) continue;
          if (el.contains && el.contains(caret)) continue;
          var r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          // ① 同一行：垂直方向必须与「⋯」相交
          if (r.bottom <= cr.top || r.top >= cr.bottom) continue;
          // ② 整个在「⋯」左边
          if (r.right > cr.left + 1) continue;
          // ③ 得是「紧邻」的：间隙太远不算（否则会跑到操作行中间）
          if (cr.left - r.right > NEAR_GAP) continue;
          // 取最靠右（最紧邻）的那个
          if (nearest === null || r.left > nearest) nearest = r.left;
        }
        if (nearest === null) return null;
        return Math.round(ar.right - nearest + SIDE_GAP);   // 右缘贴到它左边，留 6px 间隙
      } catch (e) {
        return null;
      }
    }

    /** 把按钮摆到正确位置（找不到「⋯」就沿用 CSS 里的固定值） */
    _place(btn, container) {
      var top = this._anchorTop(container);
      if (top == null) {
        if (btn.style.top) btn.style.top = '';
      } else if (btn.style.top !== top + 'px') {
        btn.style.top = top + 'px';
      }
      var right = this._anchorRight(container);
      if (right == null) {
        if (btn.style.right) btn.style.right = '';
      } else if (btn.style.right !== right + 'px') {
        btn.style.right = right + 'px';
      }
    }

    _attach(container, post) {
      try {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.setAttribute(MID_ATTR, post.mid);
        btn.setAttribute('data-state', 'idle');
        btn.title = '提取这条';
        btn.setAttribute('aria-label', '提取这条');
        // v2.8.8：不再塞 SVG，形象由 CSS 的 background-image 承载

        // 定位锚点：X 的 article 本来就是 relative，但只在确实 static 时才改，
        // 免得多余写样式，也留个标记好还原
        try {
          var cs = global.getComputedStyle ? global.getComputedStyle(container) : null;
          if (cs && cs.position === 'static') {
            container.setAttribute(POS_ATTR, container.style.position || '');
            container.style.position = 'relative';
          }
        } catch (e) { /* 定位改不了只是位置偏，不阻断 */ }

        var self = this;
        btn.addEventListener('click', function (ev) {
          // X 的推文整块可点（点正文进详情页），必须拦住
          ev.preventDefault();
          ev.stopPropagation();
          self._onClick(ev, btn, container);
        });
        // 按住也截住：X 在卡片上挂了长按菜单、拖拽
        btn.addEventListener('pointerdown', function (ev) {
          ev.stopPropagation();
        });
        btn.addEventListener('mousedown', function (ev) {
          ev.stopPropagation();
        });

        this._place(btn, container);
        container.appendChild(btn);
        this._buttons.push(btn);
      } catch (e) {
        log('[XFeedButtons] 挂按钮失败: ' + (e && e.message));
      }
    }

    // ---------------------------------------------------------------- 摘除

    _dropStale(alive) {
      for (var i = this._buttons.length - 1; i >= 0; i--) {
        var btn = this._buttons[i];
        if (!btn.isConnected) {
          this._buttons.splice(i, 1);
          continue;
        }
        if (alive.indexOf(btn.parentElement) === -1) this._detach(btn);
      }
    }

    _detach(btn) {
      var parent = btn && btn.parentElement;
      try {
        if (parent) {
          // 还回原来的 position（只在确实改过时还原）
          if (parent.hasAttribute(POS_ATTR)) {
            parent.style.position = parent.getAttribute(POS_ATTR) || '';
            parent.removeAttribute(POS_ATTR);
          }
        }
        if (btn.parentNode) btn.parentNode.removeChild(btn);
      } catch (e) { /* 忽略 */ }
      var idx = this._buttons.indexOf(btn);
      if (idx > -1) this._buttons.splice(idx, 1);
    }

    _removeAll() {
      var list = this._buttons.slice();
      for (var i = 0; i < list.length; i++) this._detach(list[i]);
      this._buttons = [];
    }

    // ---------------------------------------------------------------- 点击

    _onClick(ev, btn, container) {
      if (this._busy) return;
      var ctx = global.XFeedContext;
      var post = null;
      try {
        post = ctx ? ctx.readPost(container) : null;
      } catch (e) {
        post = null;
      }
      if (!post || !post.mid) {
        this._flash(btn, 'fail');
        return;
      }
      if (!this.onExtract) return;

      var self = this;
      this._busy = true;
      btn.setAttribute('data-state', 'busy');

      Promise.resolve()
        .then(function () { return self.onExtract({ container: container, post: post, anchor: btn }); })
        .then(function (ok) {
          self._flash(btn, ok ? 'ok' : 'fail');
        })
        .catch(function () {
          self._flash(btn, 'fail');
        })
        .then(function () {
          self._busy = false;
        });
    }

    /** 闪一下颜色再回到常态（busy 期间不覆盖） */
    _flash(btn, state) {
      try {
        btn.setAttribute('data-state', state);
        setTimeout(function () {
          if (btn.getAttribute('data-state') === state) btn.setAttribute('data-state', 'idle');
        }, 900);
      } catch (e) { /* 忽略 */ }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = XFeedButtons;
  }
  if (global) {
    global.XFeedButtons = XFeedButtons;
  }
})(typeof window !== 'undefined' ? window : null);
