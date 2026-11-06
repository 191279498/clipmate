/**
 * 豆瓣收藏列表页逐条小按钮（v2.11.4 影视 / v2.11.5 扩到读书 + 游戏 / v2.11.7 改定位）
 *
 * 【解决什么】
 *   收藏列表页上每条只显示标题、评分、日期，想看完整字段必须点进详情页。
 *   这里在每条条目上挂一颗小按钮，点一下就把这一条的详情页抓回来、
 *   用同一个浮窗展示 —— 不用离开列表。
 *
 * 【按钮挂在哪（v2.11.7 起：挂在条目上，绝对定位）】
 *   v2.11.4~v2.11.6 是「追加到标题标签内部末尾」，后果是**标题长短不一，
 *   每一条的按钮位置都不一样**，列表看着很乱（用户 2026-11-05 提的）。
 *   现在改成：按钮挂到条目容器（`.item` / `li.subject-item` / `div.common-item`）上，
 *   用绝对定位浮起来，不占文档流 —— 所以行高一个像素都不变，
 *   而**同一种结构的每一条，按钮落在同一个坐标**。
 *
 *   三套落点由设置项 `settings.doubanListBtnLayout` 切换（默认 A）：
 *     A 封面右下角（角标）  —— 相对封面框 `.pic` 的右缘 / 下缘各内缩 4px
 *     B 封面正下方          —— 相对封面框下缘 +4px，水平居中对齐封面（放不下就贴条目内下缘）
 *     C 条目最右侧固定列    —— 相对条目右缘内缩 10px，垂直居中
 *   三种都拿不到封面时（`?mode=list` 列表视图没有封面），一律退回
 *   「日期左侧 8px、垂直居中」这一条铁规则 —— 每行同一个位置，且不压日期。
 *
 *   为什么用「量矩形再写 left/top」而不是纯 CSS：豆瓣三种结构的封面框宽度
 *   分别是 80 / 90 / 102，封面图高度又和封面框不一致（影视框 158、图 114），
 *   写死坐标换个站就错位；`right:4px;bottom:4px` 这类相对定位只对 A 成立，
 *   B 要贴「图片下缘」而不是「框下缘」，只能量出来。
 *
 * 【零撑高是怎么保证的】
 *   按钮 `position:absolute` → 不参与行内排版，标题里不再插入任何元素，
 *   条目的高度、宽度、换行全部保持豆瓣原样。代价是条目必须成为定位祖先，
 *   所以只在条目 `position` 是 `static` 时补一个内联 `relative`，
 *   并在 stop() 时**原样还原**（不留下一丁点对豆瓣布局的改动）。
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

  // ---------- 三套落点的几何常量（单位 px） ----------
  var EDGE_INSET = 4;      // A：按钮距封面框右缘 / 下缘
  var IMG_GAP = 4;         // B：按钮距封面图片下缘
  var RIGHT_INSET = 10;    // C：按钮距条目右缘
  var RAIL_GAP = 8;        // 无封面时：按钮右缘距日期左缘
  var MIN_COVER = 30;      // 小于这个尺寸的封面（隐藏图 / 占位图）不算封面

  var LAYOUTS = ['A', 'B', 'C'];
  var DEFAULT_LAYOUT = 'A';

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

  /** 设置里存的模式归一化：只认 A/B/C，其它（含老配置里的空值、脏值）一律回 A */
  function normalizeLayout(mode) {
    var m = String(mode == null ? '' : mode).toUpperCase();
    return LAYOUTS.indexOf(m) === -1 ? DEFAULT_LAYOUT : m;
  }

  function clamp(n, lo, hi) {
    if (!isFinite(n)) return lo;
    if (n < lo) return lo;
    if (hi < lo) return lo;
    return n > hi ? hi : n;
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
    // v2.12.7：优先走 ClipMateMascot（内联 data URL）。这些图标是塞进**页面 DOM** 的，
    // 用 chrome-extension:// 会被浏览器当跨源请求告警（图照样显示，错误页却挂红字）。
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
      // 关键：绝对定位 —— 不占文档流，所以条目高度一个像素都不会变。
      // （v2.11.6 及以前是 inline-block + 负 margin 塞在标题里，位置跟着标题长短跑）
      + 'position:absolute;z-index:2;'
      + 'width:' + BTN_SIZE + 'px;height:' + BTN_SIZE + 'px;'
      + 'margin:0;padding:0;border:none;border-radius:7px;'
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
     * @param {string} [options.layout] - 'A' | 'B' | 'C'，缺省 A（封面右下角）。
     */
    constructor(options) {
      var opts = options || {};
      this.onExtract = typeof opts.onExtract === 'function' ? opts.onExtract : null;
      this.layout = normalizeLayout(opts.layout);
      this.enabled = true;
      this._observer = null;
      this._timer = null;
      this._busy = false;
      this._buttons = [];
      this._hosts = [];          // 被我们改成 position:relative 的条目，stop 时还原
      this._anchor = null;       // 纵向基准线缓存（见 _anchorLine）
      this._reflowBound = false;
      this._onWinResize = null;
      this._onImgLoad = null;
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
      this._bindReflow();
      this.sync();
      log('已启动，落点模式 ' + this.layout);
    }

    stop() {
      this._unwatch();
      this._unbindReflow();
      this._removeAll();
      removeStyle();
    }

    /**
     * 切换落点（设置页改完立刻生效，不用刷新）。
     * 只改定位、不重挂按钮 —— 按钮节点、点击监听、条目归属全部保留。
     */
    setLayout(mode) {
      var next = normalizeLayout(mode);
      if (next === this.layout) return this.layout;
      this.layout = next;
      for (var i = 0; i < this._buttons.length; i++) {
        if (this._buttons[i]) this._buttons[i].__cmPos = '';
      }
      this.sync();
      log('落点改为 ' + next);
      return this.layout;
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
     * 给一个条目挂按钮（已有就复用、并重新算位置）。
     * @returns {Element|null} 实际挂在页面上的按钮
     */
    _syncOne(item, spec) {
      if (!item || !item.querySelectorAll || !spec) return null;

      // 标题标签 = 「含详情链接，且自己是 .title / h2 / h3」的那个元素。
      // 只认父元素，封面图链接（.pic > a）、购买链接（.buy-info > a）都进不来。
      // v2.11.7 起标题只用来认出「这一条是哪个条目」，按钮不再塞进标题里。
      var pair = titleOf(item, spec.linkSel);
      if (!pair) return null;
      var url = pair.url;
      var id = (global.DoubanListFetch && global.DoubanListFetch.subjectIdOf)
        ? global.DoubanListFetch.subjectIdOf(url)
        : (/\/(\d+)\//.exec(url) || [])[1];
      if (!id) return null;

      // 已经挂过且还是同一条 → 复用（位置每次重算，页面变宽变窄都跟得上）
      var existing = item.querySelector('.' + BTN_CLASS);
      if (existing && existing.getAttribute(MARK_ATTR) === id) {
        // 旧版本可能把它留在标题里，这里统一搬回条目上
        if (existing.parentNode !== item) item.appendChild(existing);
        this._bind(existing, url, id);
        this._prepareHost(item);
        this._place(existing, item, spec);
        return existing;
      }
      // 换条目了（列表重排 / 翻页后 DOM 复用）→ 摘掉重挂
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

      this._prepareHost(item);
      var btn = this._makeButton(url, id);
      item.appendChild(btn);
      this._place(btn, item, spec);
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

    // ---------------------------------------------------------------- 定位

    /**
     * 让条目成为定位祖先。只在 `position:static` 时才加内联 relative，
     * 加过就记账，stop 时原样还原 —— 不给豆瓣留下任何布局改动。
     */
    _prepareHost(item) {
      if (!item || !item.style) return;
      try {
        var cs = global.getComputedStyle ? global.getComputedStyle(item) : null;
        var pos = cs ? String(cs.position || '') : '';
        if (pos && pos !== 'static') return;   // 本身已经是定位祖先，别动
      } catch (e) { /* 量不到就按 static 处理 */ }
      if (item.__cmPrevPos !== undefined) return;
      item.__cmPrevPos = item.style.position || '';
      item.style.position = 'relative';
      this._hosts.push(item);
    }

    _restoreHosts() {
      for (var i = 0; i < this._hosts.length; i++) {
        var h = this._hosts[i];
        if (!h || h.__cmPrevPos === undefined) continue;
        try { h.style.position = h.__cmPrevPos; } catch (e) { /* 元素已移除就算了 */ }
        delete h.__cmPrevPos;
      }
      this._hosts = [];
    }

    /** 条目里的封面框（.pic）；量不到尺寸（隐藏 / 懒加载没完）就当没有 */
    _coverOf(item) {
      var pic = item.querySelector('.pic');
      if (!pic) return null;
      var r = pic.getBoundingClientRect ? pic.getBoundingClientRect() : null;
      if (!r || r.width < MIN_COVER || r.height < MIN_COVER) return null;
      return pic;
    }

    /**
     * 同一结构内统一的「纵向基准线」＝ 封面**图片**下缘距条目顶部的距离。
     *
     * 为什么不能直接用封面框（.pic）的底边：豆瓣网格的 .pic 会被行高**拉伸** ——
     * 真机实测（2026-11-05）同一页里 .pic 高 137 / 158 / 179 / 202，
     * 而里面的海报图高度只有 112~120。跟着框底走 = 跟着标题行数走，
     * 又变成「每条位置都不一样」。海报图本身高度稳定，拿它的中位数当基准线，
     * 同一结构的每一行就落在同一个 y 上。
     *
     * 懒加载中的图（0 高 / 占位小图）会被排掉；窗口宽度变了要重算（图会缩放）。
     */
    _anchorOf(spec) {
      if (!spec || !spec.itemSel) return { y: 0, h: 0 };
      var width = 0;
      try { width = global.innerWidth || 0; } catch (e) { /* 忽略 */ }
      if (this._anchor && this._anchor.w === width && this._anchor.kind === spec.kind) {
        return this._anchor;
      }

      var items = document.querySelectorAll(spec.itemSel);
      var ys = [];
      var minH = 0;
      for (var i = 0; i < items.length && ys.length < 12; i++) {
        var it = items[i];
        var ir = it.getBoundingClientRect ? it.getBoundingClientRect() : null;
        if (!ir || !ir.width) continue;
        var pic = it.querySelector('.pic');
        if (!pic || !pic.getBoundingClientRect) continue;
        var pr = pic.getBoundingClientRect();
        if (pr.width < MIN_COVER || pr.height < MIN_COVER) continue;
        var base = pr.top + pr.height;      // 兜底：图量不到就用框底
        var img = pic.querySelector('img');
        if (img && img.getBoundingClientRect) {
          var imr = img.getBoundingClientRect();
          // 只认「已经加载好、且确实是这张海报」的图：
          // 懒加载中的 0 高、占位小图都会被排掉，免得把基准线拉偏。
          if (imr.height >= MIN_COVER && imr.height >= pr.height * 0.5) {
            base = imr.top + imr.height;
          }
        }
        ys.push(base - ir.top);
        // 最矮的那一行：B 的按钮必须能塞进它，否则逐行夹取会让每行 y 都不一样
        if (!minH || ir.height < minH) minH = Math.round(ir.height);
      }

      var y = 0;
      if (ys.length) {
        ys.sort(function (a, b) { return a - b; });
        y = ys[Math.floor((ys.length - 1) / 2)];   // 中位数，抗个别异常值
      }
      this._anchor = { w: width, kind: spec.kind, y: y, h: minH };
      return this._anchor;
    }

    /**
     * 算出按钮相对条目的 left/top（px）。
     * @param {Element} item
     * @param {Object} spec 结构规格（同一结构共用一条纵向基准线）
     * @returns {{left:number, top:number, mode:string}|null} null = 量不到尺寸，先不定位
     */
    _targetOf(item, spec) {
      if (!item || !item.getBoundingClientRect) return null;
      var ir = item.getBoundingClientRect();
      var iw = ir.width;
      var ih = ir.height;
      if (!iw || !ih) return null;    // 隐藏条目 / 还没排版

      var cover = this._coverOf(item);

      // ① 有封面：A / B / C 三套落点
      if (cover) {
        var cr = cover.getBoundingClientRect();
        var cw = cr.width;
        var ch = cr.height;
        var cx = cr.left - ir.left;
        var cy = cr.top - ir.top;
        // 横向一律跟**封面框**走（框宽固定 80/90/102；图可能比框窄，跟图就会一行一个 x）
        // 纵向一律跟**统一基准线**走（见 _anchorLine），量不到就退回这一条自己的封面框底
        var anchor = this._anchorOf(spec || { kind: 'unknown', itemSel: '' });
        var baseY = anchor.y > 0 ? anchor.y : (cy + ch);
        // B 的纵向一次算死（不按每条自己的高度算），这样每行 y 必然相同
        var bY = baseY + IMG_GAP;
        if (anchor.h > 0 && bY + BTN_SIZE > anchor.h) bY = Math.max(0, anchor.h - BTN_SIZE);
        var left;
        var top;

        if (this.layout === 'B') {
          // B：封面正下方 +4（画在封面图下面那条空白里），放不下就贴条目内下缘。
          // 游戏页封面下方只有 21px，24px 会探出条目，而豆瓣条目是 overflow:hidden，
          // 探出去会被裁掉半颗按钮，所以必须夹回来。
          left = cx + (cw - BTN_SIZE) / 2;
          top = bY;
        } else if (this.layout === 'C') {
          // C：条目最右侧固定列（纵向同样用基准线，保证每行在同一水平线上）
          left = iw - BTN_SIZE - RIGHT_INSET;
          top = baseY - BTN_SIZE - EDGE_INSET;
        } else {
          // A（默认）：封面右下角角标
          left = cx + cw - BTN_SIZE - EDGE_INSET;
          top = baseY - BTN_SIZE - EDGE_INSET;
        }

        return {
          left: Math.round(clamp(left, 0, iw - BTN_SIZE)),
          top: Math.round(clamp(top, 0, ih - BTN_SIZE)),
          mode: 'cover'
        };
      }

      // ② 没有封面（`?mode=list` 列表视图）：日期左侧一列
      //    这是唯一能「每行同一位置、又不压日期」的落点，A/B/C 都一样。
      var date = item.querySelector('.date');
      if (date && date.getBoundingClientRect) {
        var dr = date.getBoundingClientRect();
        var dh = dr.height || 16;
        return {
          left: Math.round(clamp(dr.left - ir.left - BTN_SIZE - RAIL_GAP, 0, iw - BTN_SIZE)),
          top: Math.round(clamp(dr.top - ir.top + (dh - BTN_SIZE) / 2, 0, ih - BTN_SIZE)),
          mode: 'rail'
        };
      }

      // ③ 既没封面也没日期：退回条目右缘内侧，至少不会跑位
      return {
        left: Math.round(clamp(iw - BTN_SIZE - RIGHT_INSET, 0, iw - BTN_SIZE)),
        top: Math.round(clamp((ih - BTN_SIZE) / 2, 0, ih - BTN_SIZE)),
        mode: 'edge'
      };
    }

    /** 把算出来的位置写进样式；位置没变就不碰 DOM（避免无意义的样式重算） */
    _place(btn, item, spec) {
      if (!btn || !btn.style) return;
      var t = this._targetOf(item, spec);
      if (!t) return;
      var key = t.mode + ':' + t.left + ',' + t.top;
      if (btn.__cmPos === key) return;
      btn.__cmPos = key;
      btn.style.left = t.left + 'px';
      btn.style.top = t.top + 'px';
    }

    /** 窗口尺寸变化、封面图加载完 → 位置要重算 */
    _bindReflow() {
      if (this._reflowBound) return;
      this._reflowBound = true;
      var self = this;
      this._onWinResize = function () { self._schedule(); };
      this._onImgLoad = function () { self._schedule(); };
      try { global.addEventListener('resize', this._onWinResize); } catch (e) { /* 忽略 */ }
      // capture 才能收到 img 的 load（load 不冒泡）：封面是懒加载的，图出来高度才定
      try { document.addEventListener('load', this._onImgLoad, true); } catch (e) { /* 忽略 */ }
    }

    _unbindReflow() {
      if (!this._reflowBound) return;
      this._reflowBound = false;
      try { global.removeEventListener('resize', this._onWinResize); } catch (e) { /* 忽略 */ }
      try { document.removeEventListener('load', this._onImgLoad, true); } catch (e) { /* 忽略 */ }
      this._onWinResize = null;
      this._onImgLoad = null;
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
      this._restoreHosts();
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
  DoubanListButtons.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
  DoubanListButtons.LAYOUTS = LAYOUTS;
  DoubanListButtons.normalizeLayout = normalizeLayout;

  if (global) global.DoubanListButtons = DoubanListButtons;
  if (typeof module !== 'undefined' && module.exports) module.exports = DoubanListButtons;
})(typeof window !== 'undefined' ? window : null);
