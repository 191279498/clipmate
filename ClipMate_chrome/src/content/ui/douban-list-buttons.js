/**
 * 豆瓣收藏列表页逐条小按钮（v2.11.4 影视 / v2.11.5 扩到读书 + 游戏）
 *
 * 【解决什么】
 *   收藏列表页上每条只显示标题、评分、日期，想看完整字段必须点进详情页。
 *   这里在每条标题后面挂一颗小按钮，点一下就把这一条的详情页抓回来、
 *   用同一个浮窗展示 —— 不用离开列表。
 *
 * 【按钮挂在哪（真机量的，不是猜的）】
 *   三站四种 DOM 结构，唯一可靠的共同点是「**标题标签里的第一个详情链接**」：
 *     · 影视 grid / list：`.item` 里 `.title > a[href*="/subject/"]`
 *     · 读书 grid：`li.subject-item` 里 `.info h2 > a[href*="/subject/"]`
 *       （`.pic > a` 是封面图，父元素不是标题，必须跳过）
 *     · 读书 list：`li.item` 里 `.title > a[href*="/subject/"]`
 *     · 游戏：`div.common-item` 里 `.title > a[href*="/game/"]`
 *   所以按钮**一律追加到那个标题标签内部末尾**，不依赖站点专属 class。
 *
 *   2026-11-04 真机实测（影视两种视图各测一次）：
 *     24px 按钮 + `vertical-align:middle` + 上下负 5px margin
 *     → title 高度、item 高度**一个像素都不变**（网格 164→164，列表 28→28），
 *       按钮落在标题文字右侧 6px，不换行、不撑高、不挤掉豆瓣自己的“修改 删除”。
 *     不加负 margin 会各撑高 5px（28px 按钮）/ 1px（22px 按钮），所以这 5px 不能省。
 *
 * 【三态】
 *   idle（吉祥物待命脸）→ busy（半透明，请求中）→ ok（笑脸，1.5 秒）/ fail（呆脸+红底，
 *   鼠标悬停能看到失败原因）。全局同一时刻只允许一个请求在飞，连点直接忽略。
 */
(function (global) {
  'use strict';

  var BTN_CLASS = 'clipmate-douban-item-btn';
  var STYLE_ID = 'clipmate-douban-item-style';
  var MARK_ATTR = 'data-cm-subject';   // 按钮上记：属于哪个条目，变了就重挂
  var SCAN_DELAY = 200;                // DOM 变化后的合并扫描间隔
  var BTN_SIZE = 24;
  var MASCOT_W = 26.5;                 // 素材自带 6% 内边距，图比框大一圈才撑满
  var MASCOT_H = 23.5;                 // face-idle 宽高比 1.129

  /** 收藏列表白名单（与 page-shape 的 LIST_PAGES 同一份判定，两处都写是故意的：
   *  那边决定“藏大按钮 + 滚动自动关”，这边决定“挂不挂小按钮”，
   *  两个方向各自独立，任何一边改坏都能被单测单独抓住。 */
  var COLLECT_PATH = /^\/people\/[^/]+\/(wish|do|collect)\/?$/i;
  var GAMES_PATH = /^\/people\/[^/]+\/games\/?$/i;

  /**
   * 三站 × 四种 DOM 结构。itemSel 只用来圈条目，真正的落点由「标题标签里的详情链接」决定。
   * 读书 grid 与 list 是两套完全不同的 HTML，所以 itemSel 写两个选择器一次覆盖。
   */
  var LIST_SPECS = [
    {
      kind: 'movie', host: 'movie.douban.com', path: COLLECT_PATH,
      itemSel: '.item', linkSel: 'a[href*="/subject/"]'
    },
    {
      kind: 'book', host: 'book.douban.com', path: COLLECT_PATH,
      itemSel: 'li.subject-item, li.item', linkSel: 'a[href*="/subject/"]'
    },
    {
      kind: 'game', host: 'www.douban.com', path: GAMES_PATH,
      itemSel: 'div.common-item', linkSel: 'a[href*="/game/"]'
    }
  ];

  /**
   * 在一个条目里找「标题标签」，返回 {title, url}。
   * 判据：某个详情链接的**直接父元素**是 h2 / h3 / 类名带 title。
   * 这样封面图链接（.pic）、购买链接（.buy-info）、评论区链接都进不来。
   */
  function titleOf(item, linkSel) {
    var links = item.querySelectorAll(linkSel);
    for (var i = 0; i < links.length; i++) {
      var p = links[i].parentElement;
      if (!p) continue;
      var tag = String(p.tagName || '').toUpperCase();
      var cls = String(p.className || '');
      if (tag === 'H2' || tag === 'H3' || /title/i.test(cls)) {
        var href = links[i].getAttribute('href') || '';
        if (href) return { title: p, url: href };
      }
    }
    return null;
  }

  function log() {
    try {
      if (global.ClipMateLog && global.ClipMateLog.debug) {
        global.ClipMateLog.debug.apply(global.ClipMateLog, ['[DoubanListButtons]'].concat([].slice.call(arguments)));
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  function mascotUrl(name) {
    var rel = 'icons/mascot/' + (name || 'face-idle') + '.svg';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime &&
          typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(rel);
      }
    } catch (e) { /* 单测环境没有 runtime */ }
    return '';
  }

  function faceRule(state, name) {
    var u = mascotUrl(name);
    return u ? '.' + BTN_CLASS + '[data-state="' + state + '"]{background-image:url("' + u + '");}' : '';
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var url = mascotUrl();
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ''
      + '.' + BTN_CLASS + '{'
      // 关键：inline-block + 负上下 margin —— 用来抵消行高被 24px 撑开的那几像素
      + 'display:inline-block;vertical-align:middle;'
      + 'width:' + BTN_SIZE + 'px;height:' + BTN_SIZE + 'px;'
      + 'margin:-5px 0 -5px 6px;padding:0;border:none;border-radius:7px;'
      + 'cursor:pointer;background-color:transparent;'
      + 'background-image:' + (url ? 'url("' + url + '")' : 'none') + ';'
      + 'background-repeat:no-repeat;background-position:center;'
      + 'background-size:' + MASCOT_W + 'px ' + MASCOT_H + 'px;'
      + 'opacity:.82;transition:background-color .15s ease,opacity .15s ease,transform .12s ease;}'
      + '.' + BTN_CLASS + ':hover{opacity:1;background-color:rgba(5,107,244,.12);transform:scale(1.08);}'
      + '.' + BTN_CLASS + ':active{transform:scale(.94);}'
      + '.' + BTN_CLASS + '[data-state="busy"]{opacity:.4;cursor:default;}'
      + '.' + BTN_CLASS + '[data-state="ok"]{background-color:rgba(52,168,83,.22);opacity:1;}'
      + '.' + BTN_CLASS + '[data-state="fail"]{background-color:rgba(217,48,37,.18);opacity:1;}'
      + faceRule('ok', 'face-happy') + faceRule('fail', 'face-blank');
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyle() {
    var el = document.getElementById(STYLE_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  class DoubanListButtons {
    /**
     * @param {Object} options
     * @param {Function} options.onExtract - `({subjectUrl, subjectId, anchor}) => Promise<boolean>`
     *        true 闪绿、false 闪红。
     */
    constructor(options) {
      var opts = options || {};
      this.onExtract = typeof opts.onExtract === 'function' ? opts.onExtract : null;
      this.enabled = true;
      this._observer = null;
      this._timer = null;
      this._busy = false;
      this._buttons = [];
    }

    // ---------------------------------------------------------------- 生命周期

    start() {
      if (!this.enabled) return;
      if (!this._isCollectPage()) {
        log('不是收藏三态页，不启动');
        return;
      }
      ensureStyle();
      this._watch();
      this.sync();
      log('已启动');
    }

    stop() {
      this._unwatch();
      this._removeAll();
      removeStyle();
    }

    /** 当前是不是受支持的收藏列表页；是的话返回对应规格，否则 null */
    _spec() {
      var host = '';
      var path = '';
      try {
        host = String(location.hostname || '').toLowerCase();
        path = String(location.pathname || '');
      } catch (e) { return null; }
      for (var i = 0; i < LIST_SPECS.length; i++) {
        var s = LIST_SPECS[i];
        if (host === s.host && s.path.test(path)) return s;
      }
      return null;
    }

    _isCollectPage() {
      return !!this._spec();
    }

    // ---------------------------------------------------------------- 扫描

    /**
     * 同步一次。幂等，可以任意频率调用。
     */
    sync() {
      if (!this.enabled) return;
      if (!this._isCollectPage()) {
        if (this._buttons.length) this._removeAll();
        return;
      }

      var spec = this._spec();
      if (!spec) {
        if (this._buttons.length) this._removeAll();
        return;
      }

      var items = document.querySelectorAll(spec.itemSel);
      if (!items || !items.length) {
        if (this._buttons.length) this._removeAll();
        return;
      }

      ensureStyle();
      var alive = [];
      for (var i = 0; i < items.length; i++) {
        var btn = this._syncOne(items[i], spec);
        if (btn) alive.push(btn);
      }
      this._dropStale(alive);
    }

    /**
     * 给一个条目挂按钮（已有就复用）。
     * @returns {Element|null} 实际挂在页面上的按钮
     */
    _syncOne(item, spec) {
      if (!item || !item.querySelectorAll || !spec) return null;

      // 标题标签 = 「含详情链接，且自己是 .title / h2 / h3」的那个元素。
      // 只认父元素，封面图链接（.pic > a）、购买链接（.buy-info > a）都进不来。
      var pair = titleOf(item, spec.linkSel);
      if (!pair) return null;
      var title = pair.title;
      var url = pair.url;
      var id = (global.DoubanListFetch && global.DoubanListFetch.subjectIdOf)
        ? global.DoubanListFetch.subjectIdOf(url)
        : (/\/(\d+)\//.exec(url) || [])[1];
      if (!id) return null;

      // 已经挂过且还是同一条 → 复用
      var existing = title.querySelector('.' + BTN_CLASS);
      if (existing) {
        if (existing.getAttribute(MARK_ATTR) === id) {
          this._bind(existing, url, id);
          return existing;
        }
        // 换条目了（列表重排 / 翻页后 DOM 复用）→ 摘掉重挂
        if (existing.parentNode) existing.parentNode.removeChild(existing);
      }

      var btn = this._makeButton(url, id);
      title.appendChild(btn);
      return btn;
    }

    _makeButton(url, id) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = BTN_CLASS;
      btn.setAttribute(MARK_ATTR, id);
      btn.setAttribute('data-state', 'idle');
      btn.setAttribute('aria-label', '提取这一条');
      btn.title = '提取这一条（不用点进详情页）';
      this._bind(btn, url, id);
      return btn;
    }

    /** 绑定点击（地址变了只更新属性，监听器从属性上读，避免闭包吃到旧条目） */
    _bind(btn, url, id) {
      btn.__cmUrl = url;
      if (btn.__cmBound) return;
      btn.__cmBound = true;
      var self = this;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();   // 别让豆瓣把这次点击当成「打开条目」
        self._handleClick(btn, btn.__cmUrl, btn.getAttribute(MARK_ATTR));
      });
    }

    // ---------------------------------------------------------------- 点击

    async _handleClick(btn, url, id) {
      if (!this.onExtract) return;
      if (this._busy) {
        // 全局只有一个在飞：后点的直接忽略，按钮保持原状
        log('已有请求在飞，忽略这次点击');
        return;
      }

      this._busy = true;
      this._setState(btn, 'busy');
      try {
        var spec = this._spec();
        var ok = await this.onExtract({
          subjectUrl: url,
          subjectId: id,
          kind: spec ? spec.kind : 'movie',
          anchor: btn
        });
        this._setState(btn, ok ? 'ok' : 'fail');
        if (ok) {
          this._resetLater(btn, 1500);
        } else {
          // 失败保留红脸久一点，让用户看得见；鼠标移上去有原因
          this._resetLater(btn, 4000);
        }
      } catch (e) {
        log('提取失败：', e && e.message);
        this._setState(btn, 'fail');
        this._resetLater(btn, 4000);
      } finally {
        this._busy = false;
      }
    }

    _setState(btn, state) {
      if (!btn || !btn.setAttribute) return;
      btn.setAttribute('data-state', state);
      if (state === 'fail') {
        var reason = this._lastReason || '提取失败';
        btn.title = reason;
      } else if (state === 'idle') {
        btn.title = '提取这一条（不用点进详情页）';
      }
    }

    /** 由外部（mixin）在失败时写入原因，按钮悬停可见 */
    setFailReason(reason) {
      this._lastReason = String(reason || '');
    }

    _resetLater(btn, ms) {
      var self = this;
      setTimeout(function () {
        // 期间用户又点了（变成 busy）就别覆盖
        if (btn.getAttribute('data-state') === 'busy') return;
        self._setState(btn, 'idle');
      }, ms);
    }

    // ---------------------------------------------------------------- 监听

    _watch() {
      if (this._observer || typeof MutationObserver === 'undefined') return;
      var self = this;
      try {
        this._observer = new MutationObserver(function (records) {
          if (self._isOwnMutation(records)) return;
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

    /** 自己挂按钮造成的 mutation 不算页面变化，否则会「挂 → 扫 → 再挂」空转 */
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

    // ---------------------------------------------------------------- 清理

    _removeAll() {
      for (var i = 0; i < this._buttons.length; i++) {
        var b = this._buttons[i];
        if (b && b.parentNode) b.parentNode.removeChild(b);
      }
      this._buttons = [];
      // 兜底：万一有漏网的（跨次扫描留下的）
      var stray = document.querySelectorAll('.' + BTN_CLASS);
      for (var k = 0; k < stray.length; k++) {
        if (stray[k].parentNode) stray[k].parentNode.removeChild(stray[k]);
      }
    }

    /** 页面里已经不存在的按钮，从台账里划掉 */
    _dropStale(alive) {
      var keep = [];
      var aliveSet = (typeof Set === 'function') ? new Set(alive) : null;
      for (var i = 0; i < this._buttons.length; i++) {
        var b = this._buttons[i];
        if (!b || !b.parentNode) continue;
        if (!document.documentElement.contains(b)) continue;
        if (aliveSet && !aliveSet.has(b)) {
          // 还在页面上但这次没被认领 → 说明它所在条目已经不是收藏条目了，摘掉
          b.parentNode.removeChild(b);
          continue;
        }
        keep.push(b);
      }
      this._buttons = keep;
      if (alive) {
        for (var k = 0; k < alive.length; k++) {
          if (this._buttons.indexOf(alive[k]) === -1) this._buttons.push(alive[k]);
        }
      }
    }
  }

  DoubanListButtons.LIST_SPECS = LIST_SPECS;
  DoubanListButtons.COLLECT_PATH = COLLECT_PATH;
  DoubanListButtons.GAMES_PATH = GAMES_PATH;

  if (global) global.DoubanListButtons = DoubanListButtons;
  if (typeof module !== 'undefined' && module.exports) module.exports = DoubanListButtons;
})(typeof window !== 'undefined' ? window : null);
