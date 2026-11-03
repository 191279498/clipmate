/**
 * 微博「页面上的博文」逐帖提取按钮（v2.7.39）
 *
 * 需求（用户 2026-11-01 拍板）
 * ---------------------------
 * 「微博全站只要出现在页面上的博文，像 IG 首页一样加上小按钮，
 *   这样就不用单独点开博文详情页提取了。」
 * 且明确要求覆盖：weibo.com 站内 + 搜索页 s.weibo.com + 手机版 m.weibo.cn。
 *
 * 三套页面结构完全不同（详见 weibo-feed-context.js 的注释）：
 *   weibo.com   → article
 *   s.weibo.com → .card-wrap（末尾还有「相关用户」等非博文卡片，靠有无 .from 排除）
 *   m.weibo.cn  → .card9（编号靠主世界桥写在 data-cm-wb 上）
 * 所以这里**不写任何选择器**，容器与取值一律问 WeiboFeedContext，
 * 保证按钮和提取器看到的是同一份数据。
 *
 * 什么时候不挂
 * ------------
 * · 读不出唯一编号的容器（推荐位、广告、"相关用户"卡片）→ 不挂，宁可少一颗也别挂错
 * · 整个页面只读出 1 条（= 博文详情页）→ 全摘掉，那是全局按钮的活，挂上来只会重复
 * · 弹层里的（weibo.com 点开图片/长文会盖一层 dialog）→ 不挂
 */
(function (global) {
  'use strict';

  var BTN_CLASS = 'clipmate-weibo-feed-btn';
  var POST_ATTR = 'data-cm-post';        // 容器上记「当前挂的是哪条」
  var POS_ATTR = 'data-cm-pos';          // 记「position 是被我改过的」
  var STYLE_ID = 'clipmate-weibo-feed-style';
  var SCAN_DELAY = 220;                  // 微博滚动加载很密，比 IG 稍长一点
  var MIN_POSTS = 2;                     // 少于这个数就是详情页，不挂
  var BTN_SIZE = 28;                     // v2.8.8：26 → 28，给头像留出 20px 的头

  /**
   * v2.8.8：按钮里换成吉祥物，不再画文档线稿（与 X / IG 同一套）。
   * 图用 background-image 而不是 <img>：站点对 img 的全局样式会把它改烂。
   */
  var MASCOT_REL = 'icons/mascot/mascot.png';
  var MASCOT_W = 30;
  var MASCOT_H = 25.6;                   // 母版 480×409，按比例

  function mascotUrl() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime &&
          typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(MASCOT_REL);
      }
    } catch (e) { /* 测试环境没有 runtime */ }
    return '';
  }

  /**
   * 各套页面的落点（实测几何，不是猜的）
   *
   * weibo.com   ：卡片 642×553，「⋯」在 right 19 / top 13（21×24）。
   *               放「⋯」正下方：header 里最靠右的元素右边缘在 right 50，
   *               按钮占 right 17~43 → 与任何元素都不重叠。
   * s.weibo.com ：卡片顶部**不一定**有 34px 高的「热门」条 —— 有的话「⋯」落在 top 46，
   *               没有就落在 top 12，同一页里两种混着出现（2026-11-01 真机实测：
   *               搜 `Gufei_GF` 时前两条有、后四条没有）。所以搜索页**不**用固定 top，
   *               改为逐卡按自己的「⋯」竖向居中（`_anchorTop()`）；固定值只作兜底。
   *               横向固定 right 45 —— 「⋯」方框在 right 21~39，落 45 正好在它左边留 6px。
   * m.weibo.cn  ：卡片满宽，header 里昵称那行（H3）右端没有别的控件；
   *               放 right 20 / top 22 压在昵称行右端空白处。
   */
  var LAYOUT = {
    desktop: { top: 44, right: 17 },
    search: { top: 50, right: 45 },
    mobile: { top: 22, right: 20 }
  };

  function log() {
    try {
      if (global.ClipMateLog && global.ClipMateLog.debug) {
        global.ClipMateLog.debug.apply(global.ClipMateLog, arguments);
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var site = (global.WeiboFeedContext && global.WeiboFeedContext.getSite()) || 'desktop';
    var pos = LAYOUT[site] || LAYOUT.desktop;
    var url = mascotUrl();
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ''
      + '.' + BTN_CLASS + '{'
      + 'position:absolute;top:' + pos.top + 'px;right:' + pos.right + 'px;'
      + 'width:' + BTN_SIZE + 'px;height:' + BTN_SIZE + 'px;padding:0;margin:0;border:none;border-radius:9px;'
      + 'display:block;cursor:pointer;z-index:9;'
      // v2.8.8：不垫底盘，吉祥物直接站在页面上
      + 'background-color:transparent;'
      + 'background-image:' + (url ? 'url("' + url + '")' : 'none') + ';'
      + 'background-repeat:no-repeat;background-position:center;'
      + 'background-size:' + MASCOT_W + 'px ' + MASCOT_H + 'px;'
      + 'transition:background-color .15s ease,transform .12s ease,opacity .15s ease;}'
      + '.' + BTN_CLASS + ':hover{background-color:rgba(255,130,0,.14);transform:scale(1.08);}'
      + '.' + BTN_CLASS + ':active{transform:scale(.95);}'
      + '.' + BTN_CLASS + '[data-state="busy"]{opacity:.45;cursor:default;}'
      + '.' + BTN_CLASS + '[data-state="ok"]{background-color:rgba(52,168,83,.20);}'
      + '.' + BTN_CLASS + '[data-state="fail"]{background-color:rgba(217,48,37,.18);}';
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  class WeiboFeedButtons {
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
      if (!global.WeiboFeedContext) {
        log('[WeiboFeedButtons] 没有 WeiboFeedContext，不启动');
        return;
      }
      if (!global.WeiboFeedContext.getSite()) {
        log('[WeiboFeedButtons] 不是微博页面，不启动');
        return;
      }
      ensureStyle();
      this._watch();
      this.sync();
      log('[WeiboFeedButtons] 已启动（' + global.WeiboFeedContext.getSite() + '）');
    }

    stop() {
      this._unwatch();
      this._removeAll();
      removeStyle();
      log('[WeiboFeedButtons] 已停止');
    }

    /**
     * 同步一次。幂等，可以被任意频率调用。
     * 页面变了、滚动加载、外部主动喊一次都走这里。
     */
    sync() {
      if (!this.enabled) return;
      var ctx = global.WeiboFeedContext;
      if (!ctx) return;
      if (!ctx.getSite()) {
        if (this._buttons.length) this._removeAll();
        return;
      }

      var containers = ctx.findContainers() || [];
      var items = [];
      for (var i = 0; i < containers.length; i++) {
        var el = containers[i];
        if (this._inDialog(el)) continue;
        var post = null;
        try {
          post = ctx.readPost(el);
        } catch (e) {
          post = null;
        }
        if (!post || !post.mid) continue;      // 认不出编号 → 不挂
        items.push({ el: el, post: post });
      }

      // 只读出 1 条 = 博文详情页 / 单条视图 → 那是全局按钮的活
      if (items.length < MIN_POSTS) {
        if (this._buttons.length) {
          this._removeAll();
          log('[WeiboFeedButtons] 博文不足 ' + MIN_POSTS + ' 条，不挂逐帖按钮');
        }
        return;
      }

      ensureStyle();
      var alive = [];
      for (var k = 0; k < items.length; k++) {
        alive.push(items[k].el);
        this._syncOne(items[k].el, items[k].post);
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
     * 删除一律不忽略 —— React 重渲染会把按钮摘掉（真机常态），必须让扫描补回来。
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

    /** 单条：该挂的挂、该更新的更新、编号变了的换一遍 */
    _syncOne(container, post) {
      var existing = this._ownButtonOf(container);
      if (existing) {
        // 按钮还在：只更新编号（React 复用节点换帖时会变）
        if (existing.getAttribute('data-mid') !== post.mid) {
          existing.setAttribute('data-mid', post.mid);
          container.setAttribute(POST_ATTR, post.mid);
        }
        // 头部控件是后挂的：每轮重摆一次，摆到位就立刻返回
        this._place(existing, container);
        return;
      }
      this._attach(container, post);
    }

    /**
     * 搜索页的竖向落点：按这一张卡片**自己的**「⋯」算，别的站返回 null（用 CSS 固定值）
     *
     * 为什么要逐卡算：搜索页卡片高度不齐，带「热门」条的「⋯」在 top 55，不带的在 top 21，
     * 差 34px。写死 top 50 会在后者身上压到正文第一行 —— 真机实测压住了一条
     * `@某人` 链接的下沿 3px（`QivYUligt` 那条）。
     *
     * @param {HTMLElement} container 卡片容器
     * @returns {number|null} 相对卡片顶部的 px；算不出来返回 null
     */
    _anchorTop(container) {
      var site = (global.WeiboFeedContext && global.WeiboFeedContext.getSite()) || 'desktop';
      if (site !== 'search') return null;
      try {
        // `.menu` 就是那颗「⋯」的外层（真机：right 21 / 18×15，两世界都读得到）
        var menu = container.querySelector('.menu');
        if (!menu) return null;
        var mr = menu.getBoundingClientRect();
        var cr = container.getBoundingClientRect();
        if (!mr.height) return null;
        // 28px 的按钮竖向居中对齐到「⋯」上
        return Math.round(mr.top - cr.top + (mr.height - BTN_SIZE) / 2);
      } catch (e) {
        return null;
      }
    }

    _attach(container, post) {
      try {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.setAttribute('data-mid', post.mid);
        btn.setAttribute('data-state', 'idle');
        btn.title = '提取这条';
        btn.setAttribute('aria-label', '提取这条');
        // v2.8.8：不再塞 SVG，形象由 CSS 的 background-image 承载

        // 定位锚点：只有原本是 static 才改，改过的留标记好还原
        try {
          var cs = global.getComputedStyle ? global.getComputedStyle(container) : null;
          if (cs && cs.position === 'static') {
            container.setAttribute(POS_ATTR, container.style.position || '');
            container.style.position = 'relative';
          }
        } catch (e) { /* 定位改不了只是位置偏，不阻断 */ }

        container.setAttribute(POST_ATTR, post.mid);

        var self = this;
        btn.addEventListener('click', function (ev) {
          // 微博卡片整体是可点区域（点正文进详情页），必须拦住
          ev.preventDefault();
          ev.stopPropagation();
          self._onClick(ev, btn, container);
        });
        // 按住也截住：微博在卡片上挂了长按/拖动
        btn.addEventListener('pointerdown', function (ev) {
          ev.stopPropagation();
        });
        btn.addEventListener('mousedown', function (ev) {
          ev.stopPropagation();
        });

        container.appendChild(btn);
        this._buttons.push(btn);

        // 摆位：优先按卡片**自己**右上角那颗「⌄ / ⋯」量（桌面页、搜索页都能用）；
        // 量不到才退回「搜索页算 top + CSS 固定值」这条老路。
        if (!this._place(btn, container)) {
          var anchTop = this._anchorTop(container);
          if (anchTop != null) btn.style.top = anchTop + 'px';
        }
      } catch (e) {
        log('[WeiboFeedButtons] 挂按钮失败: ' + (e && e.message));
      }
    }

    /**
     * 按卡片右上角的「⌄ / ⋯」摆位：按钮站在它左边 6px、垂直居中对齐。
     *
     * 为什么不能写死 right：真机实测（2026-11-02）微博首页卡片右上角那颗「⌄」
     * 占 x=842~866，而 LAYOUT.desktop 的 `right:17` 让按钮右边缘落在 865 ——
     * 按钮整颗压在箭头上，看起来像从箭头下面掉出来的一块。
     *
     * @param {HTMLElement} btn  我们的按钮
     * @param {HTMLElement} container 卡片容器
     * @returns {boolean} 量到了并摆好 → true
     */
    _place(btn, container) {
      try {
        var cr = container.getBoundingClientRect();
        if (!cr || !cr.width) return false;

        // `.woo-pop-wrap` 是「⌄」外层（类名带哈希，只认前缀）；`.menu` 是搜索页的「⋯」
        var anchor = container.querySelector('.woo-pop-wrap')
          || container.querySelector('.woo-pop-ctrl')
          || container.querySelector('.menu');
        if (!anchor) return false;

        var ar = anchor.getBoundingClientRect();
        if (!ar.width || ar.top - cr.top > 70) return false;   // 只认头部那颗

        var right = Math.round(cr.right - ar.left + 6);
        var top = Math.round(ar.top - cr.top + (ar.height - BTN_SIZE) / 2);

        if (btn.getAttribute('data-pos') !== right + '/' + top) {
          btn.setAttribute('data-pos', right + '/' + top);
          btn.style.right = right + 'px';
          btn.style.top = top + 'px';
        }
        return true;
      } catch (e) {
        return false;
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
          parent.removeAttribute(POST_ATTR);
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
      var ctx = global.WeiboFeedContext;
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
        .then(function () { return self.onExtract({ container: container, post: post }); })
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

    _inDialog(el) {
      try {
        return !!(el.closest && el.closest('div[role="dialog"]'));
      } catch (e) {
        return false;
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeiboFeedButtons;
  }
  if (global) {
    global.WeiboFeedButtons = WeiboFeedButtons;
  }
})(typeof window !== 'undefined' ? window : null);
