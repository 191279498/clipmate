/**
 * Instagram 首页信息流「逐帖提取按钮」（v2.7.35，只在隔离环境里跑）
 *
 * 为什么需要它
 * ------------
 * IG 首页 `/` 是无限流：往下滚动一直出新帖子。想存某一条，老做法只有「点开帖子 →
 * 等弹层 → 点全局按钮」三步，而且点开这一下本身就把用户带离了信息流。
 *
 * 用户 2026-11-01 拍板：**在每条帖子右上角挂一个小按钮，只有点它才提取那一条**。
 * 所以本文件只做一件事：把按钮挂上去、把「用户点了哪一条」告诉调用方；
 * 取数逻辑一律不在这里（见 `instagram-social.js` 的 `_buildFeedPostRecord`）。
 *
 * 三条硬规矩
 * ----------
 * ① **只挂不点**。绝不去点「… 更多」、不点开帖子、不触发任何页面交互 ——
 *    按钮只读 DOM 和桥节点里已经有数据，页面状态零改变。
 * ② **只认首页**。`/` 之外（探索页、作者主页网格、Reels 沉浸流）一律不挂，
 *    那些页面的入口由原有逻辑负责；本文件认不出首页就把自己摘干净。
 * ③ **不做「当前这一条」**。首页没有「正在看哪一条」的概念，按钮必须挂在具体
 *    帖子节点上，提取时把**那个 article 节点**交给提取器当作用域 ——
 *    否则会像 v2.7.4 之前那样提到页脚文字。
 *
 * 挂载位置的坑
 * ------------
 * IG 的 `<article>` 由 React 管理，**内部子树随时被整体替换**（点赞数变化、评论懒加载、
 * 滚出屏幕回收）。所以：
 *   · 按钮挂在 article 上，判断依据是「article 里还有没有我这颗按钮」，
 *     **不能**只看 article 上的标记属性（属性会留着、按钮已经没了）；
 *   · 自己被 React 摘掉后会随下一次 mutation 补挂回来；
 *   · article 的 `position` 原本是 `static` 时才改成 `relative`，
 *     改过的记在 `data-clipmate-ig-pos` 上，撤的时候按标记还原。
 *
 * 位置：帖子头部右侧、`⋯` 更多菜单**左边**（不压住「⋯」，也不挡点赞评论）。
 *
 * 依赖：`window.InstagramEntryContext`（判定是不是首页）。取不到就自己内联判一遍。
 */
(function (global) {
  'use strict';

  var BTN_CLASS = 'clipmate-ig-feed-btn';
  var STYLE_ID = 'clipmate-ig-feed-style';
  /** 挂在 article 上的标记：`data-clipmate-ig-post="<作品编号>"` */
  var POST_ATTR = 'data-clipmate-ig-post';
  /** 改过 article 定位时留的还原标记 */
  var POS_ATTR = 'data-clipmate-ig-pos';
  /** 扫描节流（毫秒）：无限流滚动时 mutation 非常密 */
  var SCAN_DELAY = 250;

  /**
   * 作品永久链接：整条就是作品地址，不是「含 /p/」。
   *
   * 编号上限 64 位（v2.7.36 从 30 位放宽）：正常帖子 11 位，但**推广帖**是
   * 「编号 + ad 追踪串」，真机实测 43 位（`DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0`）。
   * 卡 30 位时这种帖子在首页**一颗按钮都没有**（§真机验收 2026-11-01 实测缺按钮）。
   */
  var PERMALINK_RE = /^\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,64})\/?$/;

  var LOG_PREFIX = '[ClipMate IG feed] ';

  function log(msg) {
    try {
      if (typeof ClipMateLog !== 'undefined' && typeof ClipMateLog.debug === 'function') {
        ClipMateLog.debug(LOG_PREFIX + msg);
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  function hostname() {
    try { return (global.location && global.location.hostname) || ''; } catch (e) { return ''; }
  }

  function pathname() {
    try { return (global.location && global.location.pathname) || '/'; } catch (e) { return '/'; }
  }

  /**
   * 当前是不是 IG 首页。
   *
   * 优先问 `InstagramEntryContext.isFeedPage()`（全项目只维护那一份判据），
   * 没加载到才内联判一遍（同样只认 `www.instagram.com` + 根路径）。
   */
  function isFeedPage() {
    if (!/(^|\.)instagram\.com$/i.test(hostname())) return false;
    try {
      var ctx = global.InstagramEntryContext;
      if (ctx && typeof ctx.isFeedPage === 'function') return !!ctx.isFeedPage();
    } catch (e) { /* 问不到就自己判 */ }
    return /^\/$/.test(pathname());
  }

  /** 从一条帖子里取作品编号；认不出返回空串（认不出就不挂按钮，绝不猜） */
  function shortcodeOf(article) {
    if (!article || !article.querySelectorAll) return '';
    var links = article.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').split('?')[0];
      // ⚠️ **所有排雷都靠这条正则的 `$` 锚**，不要再往上堆「不含 liked_by / 不含 /c/」之类判断：
      //    弹层和评论区里有 `/p/<code>/liked_by/`、`/p/<code>/comments/`、`/c/<id>/`、
      //    `/reels/audio/<id>/` 这些同前缀链接，它们**都是多段**，锚到结尾就全被挡掉。
      //    v2.7.35 最初还额外写了三行白名单判断，实测那三行永远不会命中（正则先一步挡了），
      //    属于死代码，已删；改成删掉正则的 `$` 之后，这三条用例会立刻变红（变异测试盯着）。
      var m = PERMALINK_RE.exec(href);
      if (m && m[1]) return m[1];
    }
    return '';
  }

  // ==========================================================================
  // 一、样式（只在首页注入一次）
  // ==========================================================================

  function ensureStyle() {
    try {
      if (!document.head || document.getElementById(STYLE_ID)) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      var url = mascotUrl();
      // 全部挂在 `.clipmate-ig-feed-btn` 上，类名带前缀，不与页面样式重叠。
      // 尺寸/定位用 !important：IG 有全局 `button { all: unset }` 一类的重置，
      // 不加会被抹平（真机踩过同类）。
      style.textContent = [
        '.' + BTN_CLASS + '{',
        // 兜底定位：真机里「⋯」在帖子右上角，右边留 40px 正好贴在它左边。
        // 但头部常有一颗「关注」按钮夹在中间 —— 实际位置由 _place() 按几何算并
        // 以 !important 行内样式覆盖，这里的 40px 只在还没量到时生效。
        '  position:absolute !important; top:12px !important; right:40px !important;',
        '  width:28px !important; height:28px !important; padding:0 !important; margin:0 !important;',
        '  display:block !important; box-sizing:border-box !important;',
        '  border:none !important; border-radius:9px !important; cursor:pointer !important;',
        // v2.8.8：不垫底盘，吉祥物直接站在帖子上（状态时才亮一块淡色）
        '  background-color:transparent !important;',
        '  background-image:' + (url ? 'url("' + url + '")' : 'none') + ' !important;',
        '  background-repeat:no-repeat !important; background-position:center !important;',
        '  background-size:' + MASCOT_W + 'px ' + MASCOT_H + 'px !important;',
        '  opacity:.72 !important; transition:opacity .15s,background-color .15s,transform .15s !important;',
        '  z-index:5 !important; line-height:0 !important;',
        '}',
        '.' + BTN_CLASS + ':hover{opacity:1 !important; background-color:rgba(0,0,0,.05) !important; transform:scale(1.08) !important;}',
        '[data-clipmate-ig-post]:hover .' + BTN_CLASS + '{opacity:.95 !important;}',
        '.' + BTN_CLASS + '.is-busy{cursor:progress !important; opacity:.35 !important;}',
        '.' + BTN_CLASS + '.is-ok{background-color:rgba(22,163,74,.20) !important; opacity:1 !important;}',
        '.' + BTN_CLASS + '.is-err{background-color:rgba(220,38,38,.18) !important; opacity:1 !important;}',
        // v2.9.2：有结果时换一张脸 —— 待命和进行中都是平静脸，成功笑、失败呆
        faceRule('is-ok', 'face-happy'),
        faceRule('is-err', 'face-blank')
      ].join('\n');
      document.head.appendChild(style);
    } catch (e) { /* 样式失败只是难看，不阻断功能 */ }
  }

  function removeStyle() {
    try {
      var el = document.getElementById(STYLE_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) { /* 忽略 */ }
  }

  // ==========================================================================
  // 二、按钮本体
  // ==========================================================================

  /**
   * v2.8.8：按钮里换成吉祥物，不再画文档线稿（三站同一套）。
   *
   * 用 background-image 而不是 <img>：IG 对 img 有全局重置
   * （`max-width:100%` / `object-fit` / `border-radius`），会把头像改烂。
   * 28px 容器里放 30px 宽的图，左右各裁 1px —— 母版左右各有 19px 透明留白，
   * 裁掉的正是这段空白，画面无损。
   */
  /* v2.9.2：28px 的小按钮只能用「头部特写」，全身像缩到这个尺寸只剩一团白。
     素材自带 6% 内边距（拆图时加的），所以 31px 的框里实际只画出约 29px 的头。 */
  var MASCOT_W = 31;
  var MASCOT_H = 27.5;                   // face-idle 宽高比 1.129

  /** 取某形态的地址；没有扩展运行时（单测/资源缺失）返回空串，走透明降级。
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

  /** 生成「某状态换一张脸」的规则；拿不到资源时返回空串（保留待命那张）。
      IG 这套用 is-xxx 类名而不是 data-state（页面有全局 button 重置，类名更好压制）。 */
  function faceRule(state, name) {
    var u = mascotUrl(name);
    return u ? '.' + BTN_CLASS + '.' + state + '{background-image:url("' + u + '") !important;}' : '';
  }

  class InstagramFeedButtons {
    /**
     * @param {Object} options
     * @param {Function} options.onExtract - `({article, shortcode}) => Promise<boolean>`，
     *        返回 true 表示提取成功（按钮闪绿），false/抛错表示失败（闪红）。
     */
    constructor(options) {
      var opts = options || {};
      this.onExtract = typeof opts.onExtract === 'function' ? opts.onExtract : null;
      this.enabled = true;
      this._observer = null;
      this._scanTimer = null;
      this._busy = false;          // 全局只允许一条同时提取，避免连点出两份浮窗
      this._buttons = [];          // 挂出去的按钮（撤的时候按它逐个摘，不靠 querySelector 猜）
    }

    /** 启动：注入样式 + 挂监听 + 立刻扫一次 */
    start() {
      if (!this.enabled) return;
      if (!isFeedPage()) {
        log('不是 IG 首页，不挂逐帖按钮');
        return;
      }
      ensureStyle();
      this._watch();
      this.sync();
      log('已启动（首页逐帖按钮）');
    }

    /** 停止并把自己留下的东西全部撤掉（换页 / 卸载时调用） */
    stop() {
      this._unwatch();
      this._removeAll();
      removeStyle();
      log('已停止');
    }

    /**
     * 同步一次：不在首页 → 摘干净；在首页 → 补齐缺失的按钮。
     *
     * 幂等，可以被任意频率调用（页面变化、用户滚动、外部主动喊一次都行）。
     */
    sync() {
      if (!this.enabled) return;
      if (!isFeedPage()) {
        if (this._buttons.length) this._removeAll();
        return;
      }
      ensureStyle();
      this._scan();
    }

    // ---------------------------------------------------------------- 监听

    _watch() {
      if (this._observer || typeof MutationObserver === 'undefined') return;
      var self = this;
      try {
        this._observer = new MutationObserver(function (records) {
          if (self._isOwnMutation(records)) return;   // 自己加的按钮不算「页面变了」
          self._scheduleScan();
        });
        this._observer.observe(document.body, { childList: true, subtree: true });
      } catch (e) {
        this._observer = null;
      }
    }

    _unwatch() {
      if (this._scanTimer) { clearTimeout(this._scanTimer); this._scanTimer = null; }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
    }

    /**
     * 这批 mutation 是不是「我自己挂按钮」造成的？
     *
     * **只判新增节点**：这是为了掐掉「挂按钮 → 触发扫描 → 又扫描一遍」的白跑。
     *
     * **删除一律不忽略**：万一 React 重渲染把按钮摘掉了（真机常态），
     * 必须让扫描跑起来把它补回去；自己主动摘按钮时多扫一次是廉价空转，不影响结果。
     */
    _isOwnMutation(records) {
      for (var i = 0; i < records.length; i++) {
        if (!this._allMine(records[i].addedNodes)) return false;
        if (records[i].removedNodes && records[i].removedNodes.length) return false;
      }
      return true;
    }

    /** 一组节点是不是「全是我的按钮」（空集合算“是”，不影响判定） */
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

    _scheduleScan() {
      if (this._scanTimer) return;
      var self = this;
      this._scanTimer = setTimeout(function () {
        self._scanTimer = null;
        self.sync();
      }, SCAN_DELAY);
    }

    // ---------------------------------------------------------------- 扫描

    _scan() {
      var articles;
      try {
        // 只认信息流里的帖子容器。`main` 之外的 article（弹层里那个）不归这里管。
        articles = document.querySelectorAll('main article');
      } catch (e) {
        return;
      }
      for (var i = 0; i < articles.length; i++) {
        var article = articles[i];
        // 弹层里的 article 由 Modal 那一套负责，这里跳过（弹层开着时首页不该出按钮）
        if (this._inDialog(article)) continue;

        var existing = this._ownButtonOf(article);
        var code = shortcodeOf(article);
        if (!code) {
          // 认不出是哪条作品（广告位、推荐卡、骨架屏）→ 不挂，宁可少一颗也别挂错
          if (existing) this._detach(article, existing);
          continue;
        }
        if (existing) {
          // 按钮还在：只更新编号（React 复用节点换帖时会变）
          if (article.getAttribute(POST_ATTR) !== code) {
            article.setAttribute(POST_ATTR, code);
            existing.setAttribute('data-code', code);
          }
          // 关注按钮是后加载的：每轮扫描重摆一次，摆到该在的位置就立刻返回
          this._place(existing, article);
          continue;
        }
        this._attach(article, code);
      }
    }

    _inDialog(el) {
      try {
        return !!(el.closest && el.closest('div[role="dialog"]'));
      } catch (e) {
        return false;
      }
    }

    /** 这条帖子里现在有没有「我自己挂的、且是直系子节点」的按钮 */
    _ownButtonOf(article) {
      try {
        var kids = article.children;
        for (var i = 0; i < kids.length; i++) {
          if (kids[i].classList && kids[i].classList.contains(BTN_CLASS)) return kids[i];
        }
      } catch (e) { /* 忽略 */ }
      return null;
    }

    _attach(article, code) {
      try {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.setAttribute('data-code', code);
        btn.title = '提取这条';
        btn.setAttribute('aria-label', '提取这条');
        // v2.8.8：不再塞 SVG，形象由 CSS 的 background-image 承载

        // 定位锚点：只有原本是 static 才改，改过的留标记好还原
        try {
          var cs = global.getComputedStyle ? global.getComputedStyle(article) : null;
          if (cs && cs.position === 'static') {
            article.setAttribute(POS_ATTR, article.style.position || '');
            article.style.position = 'relative';
          }
        } catch (e) { /* 定位改不了只是位置偏，不阻断 */ }

        article.setAttribute(POST_ATTR, code);

        var self = this;
        btn.addEventListener('click', function (ev) {
          self._onClick(ev, btn);
        });
        // 按住就截住：IG 在帖子区块上挂了 pointerdown（长按/拖动），
        // 不拦的话按我们这颗按钮会把帖子当成被按住的卡片。
        btn.addEventListener('pointerdown', function (ev) {
          ev.stopPropagation();
        });

        article.appendChild(btn);
        this._buttons.push(btn);
        this._place(btn, article);
      } catch (e) {
        log('挂按钮失败：' + (e && e.message));
      }
    }

    /**
     * 把按钮摆到「⋯」左边，并给「关注 / 已关注」这类头部按钮让位。
     *
     * 真机实测（2026-11-02）：帖子头部除了「⋯」还常常有一颗 60px 宽的关注按钮，
     * 两者之间只有 8px。若一律写死 `right:40px`，按钮会整块压在关注按钮上
     * （实测关注 599~659、我们 633~661，重叠 26px）。
     *
     * 所以这里按几何算：右边界 = 「同一行、在⋯左边、离⋯不超过 90px」这批控件里
     * 最靠左的那颗，再往左让 6px。没有关注按钮时结果正好等于 CSS 默认的 40px。
     */
    _place(btn, article) {
      try {
        var ar = article.getBoundingClientRect();
        if (!ar || !ar.width) return;

        // 「⋯」：aria-label 随语言变，中英文都认
        var menus = article.querySelectorAll(
          '[aria-label="更多选项" i], [aria-label="More options" i]'
        );
        var menuRect = null;
        for (var m = 0; m < menus.length; m++) {
          var mr = menus[m].getBoundingClientRect();
          // 只认头部那颗：顶部不超出 article 顶部 90px
          if (mr.width && mr.top - ar.top < 90) { menuRect = mr; break; }
        }
        if (!menuRect) return;   // 找不到就沿用 CSS 的 40px

        var limitLeft = menuRect.left;   // 不能越过的基准
        var cands = article.querySelectorAll('button, [role="button"]');
        for (var i = 0; i < cands.length; i++) {
          var el = cands[i];
          if (el === btn || (el.contains && el.contains(btn))) continue;
          var q = el.getBoundingClientRect();
          if (!q.width || q.width > 200) continue;        // 整块可点区域不算
          if (q.right > menuRect.left + 2) continue;       // 只认「⋯」左边的
          if (menuRect.left - q.left > 90) continue;       // 离太远（头像）不算
          if (q.left < limitLeft) limitLeft = q.left;
        }

        var right = Math.round(ar.right - limitLeft + 6);
        if (btn.getAttribute('data-right') !== String(right)) {
          btn.setAttribute('data-right', String(right));
          // CSS 里那条是 !important，必须同样以 important 写才能覆盖
          btn.style.setProperty('right', right + 'px', 'important');
        }
      } catch (e) { /* 量不到就沿用 CSS 默认位置 */ }
    }

    _detach(article, btn) {
      try {
        if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
        this._buttons = this._buttons.filter(function (b) { return b !== btn; });
        article.removeAttribute(POST_ATTR);
      } catch (e) { /* 忽略 */ }
    }

    _removeAll() {
      for (var i = 0; i < this._buttons.length; i++) {
        var btn = this._buttons[i];
        try {
          var article = btn.parentNode;
          if (article && article.nodeType === 1) {
            article.removeAttribute(POST_ATTR);
            if (article.hasAttribute(POS_ATTR)) {
              article.style.position = article.getAttribute(POS_ATTR) || '';
              article.removeAttribute(POS_ATTR);
            }
          }
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        } catch (e) { /* 单个失败不影响其他 */ }
      }
      this._buttons = [];
    }

    // ---------------------------------------------------------------- 点击

    _setState(btn, state) {
      try {
        btn.classList.remove('is-busy', 'is-ok', 'is-err');
        if (state) btn.classList.add(state);
        // v2.8.8：形象由 CSS 的 background-image 承载，状态只切 class
        //（原来这里换 spinner / 换回 SVGSVG，现在连子节点都不需要）
        btn.title = (state === 'is-ok') ? '已提取'
          : (state === 'is-err' ? '提取失败，可再点一次' : '提取这条');
      } catch (e) { /* 视觉失败不影响提取 */ }
    }

    _onClick(ev, btn) {
      // 关键：这三下都得拦。IG 在整个帖子上挂了「点一下打开帖子」，
      // 不拦就变成「点提取按钮 = 打开帖子详情」。
      try {
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
      } catch (e) { /* 忽略 */ }

      if (!this.onExtract) return;
      if (this._busy) {
        log('上一条还在提取中，忽略这次点击');
        return;
      }

      var article = btn.parentNode;
      var code = btn.getAttribute('data-code') || '';
      if (!article || !article.nodeType || !code) return;

      var self = this;
      this._busy = true;
      this._setState(btn, 'is-busy');

      Promise.resolve()
        .then(function () { return self.onExtract({ article: article, shortcode: code, anchor: btn }); })
        .then(function (ok) {
          self._setState(btn, ok ? 'is-ok' : 'is-err');
          setTimeout(function () { self._setState(btn, null); }, 1800);
        }, function (err) {
          self._setState(btn, 'is-err');
          setTimeout(function () { self._setState(btn, null); }, 1800);
          log('提取失败：' + (err && err.message));
        })
        .then(function () { self._busy = false; });
    }
  }

  global.InstagramFeedButtons = InstagramFeedButtons;
})(typeof window !== 'undefined' ? window : this);
