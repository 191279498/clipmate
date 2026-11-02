/**
 * 统一提示组件（v2.5.44）
 *
 * 【为什么要有这个文件】
 *   v2.5.43 及以前，「复制成功 / 复制失败 / 已进入编辑模式」这些提示由两份几乎复制粘贴的代码各自实现：
 *     - src/content/ui/modal-copy-export.js 里的 ModalManager.showMessage()
 *     - src/content/ui/button-manager.js 里的 ButtonManager.showMessage()
 *   两份都是往 document.body 追加一条 12px、白底细字、内边距 4×8px 的小条，3 秒后 setTimeout 删掉。
 *   结果是：贴在网页右上角（根本不在浮窗里）、比正文还小、3 秒就没了 → 基本没人能看见。
 *
 * 【现在怎么做】
 *   1. 外观统一：40px 高横幅 / 14px 字号 / 左侧 4px 色条 / 18px 圆形图标 / 右侧 × 手动关闭；
 *   2. 位置优先塞进浮窗 Shadow DOM（标题栏正下方，横跨整个浮窗宽度），
 *      浮窗不存在时（例如「提取失败」，那会儿还没浮窗）才退回页面顶部居中的同规格卡片；
 *   3. 取消一切定时器：不自动消失，只能点 × 关掉，或者下一条提示把它替换掉。
 *
 * 【两种形态 variant】
 *   'window' → 浮窗内横幅：贴边、无圆角、无阴影，样式写在 floating-window-styles.js
 *   'page'   → 页面层卡片：居中、圆角、浅阴影，样式写在 content-styles.css
 *   两处只共用类名和 DOM 结构，外观各自定义，互不影响（浮窗在 Shadow DOM 里，页面样式打不进去）。
 */
(function (global) {
  'use strict';

  var PAGE_ROOT_ID = 'clipmate-page-notice';

  // 只认这三种类型，传错一律按 success 处理
  var VALID_TYPES = { success: true, error: true, info: true };

  // 图标规格：18px 圆形底 + 白色符号。
  // 刻意不用 innerHTML 拼 SVG 字符串 —— 全部走 createElementNS 构建，
  // 既避开 web-ext lint 的「Unsafe assignment to innerHTML」警告，也不给外部注入留任何缝隙。
  var ICON_SPEC = {
    success: { fill: '#639922', path: 'M5 9.3l2.6 2.6L13.2 6', dots: [] },
    error: { fill: '#A32D2D', path: 'M6.3 6.3l5.4 5.4M11.7 6.3l-5.4 5.4', dots: [] },
    info: { fill: '#185FA5', path: 'M9 8.2v5.2', dots: [{ cx: 9, cy: 5.6, r: 1.15 }] }
  };

  /**
   * 构建 18px 圆形图标
   * @param {string} type success | error | info
   * @returns {SVGElement}
   */
  function buildIcon(type) {
    var NS = 'http://www.w3.org/2000/svg';
    var spec = ICON_SPEC[type] || ICON_SPEC.info;

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('viewBox', '0 0 18 18');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    var bg = document.createElementNS(NS, 'circle');
    bg.setAttribute('cx', '9');
    bg.setAttribute('cy', '9');
    bg.setAttribute('r', '9');
    bg.setAttribute('fill', spec.fill);
    svg.appendChild(bg);

    (spec.dots || []).forEach(function (dot) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', String(dot.cx));
      c.setAttribute('cy', String(dot.cy));
      c.setAttribute('r', String(dot.r));
      c.setAttribute('fill', '#ffffff');
      svg.appendChild(c);
    });

    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', spec.path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#ffffff');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);

    return svg;
  }

  /**
   * 生成一条提示的 DOM（浮窗和页面层共用同一套结构）
   * @param {string} message 文本
   * @param {string} type    success | error | info
   * @param {string} variant window | page
   * @param {object} [options] { detail, copyText } 技术细节与「复制详情」按钮（v2.5.45）
   * @returns {HTMLElement}
   */
  function buildElement(message, type, variant, options) {
    var t = VALID_TYPES[type] ? type : 'success';
    var v = variant === 'page' ? 'page' : 'window';
    var opts = options || {};
    var detail = (opts.detail === null || opts.detail === undefined) ? '' : String(opts.detail);

    var el = document.createElement('div');
    el.className = 'clipmate-notice clipmate-notice--' + t + ' clipmate-notice--' + v;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');

    var icon = document.createElement('span');
    icon.className = 'clipmate-notice-icon';
    icon.appendChild(buildIcon(t));

    var text = document.createElement('span');
    text.className = 'clipmate-notice-text';
    // 必须用 textContent：提示内容里可能带括号、书名号等字符，绝不能用 innerHTML 拼接
    // v2.5.45：消息本体单独放一个 span，细节块是它的兄弟节点。
    // 否则细节的堆栈会被算进提示正文里（读屏会连堆栈一起念，取文本也混在一起）。
    var messageSpan = document.createElement('span');
    messageSpan.className = 'clipmate-notice-message';
    messageSpan.textContent = (message === null || message === undefined) ? '' : String(message);
    text.appendChild(messageSpan);

    var close = document.createElement('button');
    close.className = 'clipmate-notice-close';
    close.type = 'button';
    close.textContent = '\u00d7';
    close.setAttribute('aria-label', '关闭提示');
    close.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      ClipMateNotice.hide(el);
    });

    el.appendChild(icon);
    el.appendChild(text);
    el.appendChild(close);

    // ===== 技术细节（v2.5.45 / B6）=====
    // 失败提示光说「提取失败，请刷新页面重试」没有任何排查价值，
    // 这里把错误类型、消息、页面、时间、堆栈前几行直接摊开，并提供一键复制。
    // 细节挂在 .clipmate-notice-text **里面**，这样 .clipmate-notice 的直接子节点
    // 仍然是「图标 / 文本 / 关闭」三个，v2.5.44 定下的结构与回归用例都不用改。
    if (detail) {
      el.classList.add('has-detail');

      var detailBox = document.createElement('div');
      detailBox.className = 'clipmate-notice-detail';

      var detailText = document.createElement('div');
      detailText.className = 'clipmate-notice-detail-text';
      detailText.textContent = detail;
      detailBox.appendChild(detailText);

      if (opts.copyText) {
        var copyBtn = document.createElement('button');
        copyBtn.className = 'clipmate-notice-detail-copy';
        copyBtn.type = 'button';
        copyBtn.textContent = '复制详情';
        copyBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          copyText(String(opts.copyText), function (ok) {
            copyBtn.textContent = ok ? '已复制' : '复制失败';
            setTimeout(function () { copyBtn.textContent = '复制详情'; }, 1500);
          });
        });
        detailBox.appendChild(copyBtn);
      }

      text.appendChild(detailBox);
    }

    return el;
  }

  /** 复制文本：优先剪贴板 API，失败退回 textarea + execCommand */
  function copyText(str, done) {
    var finish = function (ok) { if (typeof done === 'function') done(ok); };
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(str).then(function () { finish(true); }, function () { fallback(); });
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    fallback();

    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = str;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        finish(ok !== false);
      } catch (err) {
        finish(false);
      }
    }
  }

  var ClipMateNotice = {
    /** 当前打开的浮窗实例（由 MediaFloatingWindow.show/hide 维护） */
    _activeWindow: null,
    /** 页面层卡片根节点 */
    _pageRoot: null,

    /** 浮窗显示时登记自己，之后的提示都往浮窗里塞 */
    bind: function (win) {
      this._activeWindow = win;
      // 浮窗一出现，页面上的残留卡片就该退场，避免同一句话显示两遍
      this._removePageRoot();
    },

    /** 浮窗隐藏/关闭时注销自己 */
    unbind: function (win) {
      if (this._activeWindow === win) {
        this._activeWindow = null;
      }
    },

    /** 供 floating-window.js 复用同一套 DOM 结构 */
    build: buildElement,

    /**
     * 显示一条提示（对外唯一入口，原来的两处 showMessage 都转到这里）
     * @param {string} message
     * @param {string} [type] success | error | info
     * @param {object} [options] { detail, copyText } 可选技术细节（v2.5.45）
     */
    show: function (message, type, options) {
      var t = VALID_TYPES[type] ? type : 'success';
      var win = this._activeWindow;

      if (win && win.isShown && typeof win.showNotice === 'function') {
        this._removePageRoot();
        win.showNotice(message, t, options);
        return;
      }
      this._showPageCard(message, t, options);
    },

    /**
     * 关闭指定提示；不传参数则两边都清
     * 浮窗内的提示必须交回浮窗自己删，因为折叠状态下浮窗高度要跟着重算
     */
    hide: function (el) {
      if (!el) {
        if (this._activeWindow && typeof this._activeWindow.hideNotice === 'function') {
          this._activeWindow.hideNotice();
        }
        this._removePageRoot();
        return;
      }

      var host = el.__clipmateHost;
      if (host && typeof host.hideNotice === 'function') {
        host.hideNotice();
        return;
      }

      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
      if (this._pageRoot && !this._pageRoot.querySelector('.clipmate-notice')) {
        this._removePageRoot();
      }
    },

    _showPageCard: function (message, type, options) {
      this._removePageRoot();

      var root = document.createElement('div');
      root.id = PAGE_ROOT_ID;
      root.appendChild(buildElement(message, type, 'page', options));

      if (document.body) {
        document.body.appendChild(root);
        this._pageRoot = root;
      }
    },

    _removePageRoot: function () {
      var root = this._pageRoot;
      if (!root) {
        root = document.getElementById(PAGE_ROOT_ID);
      }
      if (root && root.parentNode) {
        root.parentNode.removeChild(root);
      }
      this._pageRoot = null;
    }
  };

  global.ClipMateNotice = ClipMateNotice;
})(window);
