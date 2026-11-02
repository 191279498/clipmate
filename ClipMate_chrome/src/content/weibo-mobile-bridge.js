/**
 * 手机版微博数据桥（v2.7.39，MAIN world）
 *
 * 为什么要它
 * ----------
 * m.weibo.cn 的博文编号（mid）**根本不在 DOM 里**：一条 `.card9` 里只有
 * 转发原博的 `/status/<mid>` 和视频 fid，主博自己的编号、精确发布时间、全文
 * 全都只存在于 Vue 实例 `.card9.__vue__.item` 上：
 *
 *   item.id / item.mid      → 博文编号
 *   item.created_at         → "Sun Nov 01 11:12:45 +0800 2026"（精确到秒）
 *   item.text               → 全文（isLongText 时也是全文，不用点「展开」）
 *   item.user.id/screen_name→ 作者 UID / 昵称
 *   item.item_category      → 'status' 才是博文
 *
 * 但 `__vue__` 是页面主世界的 JS 对象，隔离世界的 content script **读不到**
 * （同 `window.__APOLLO_STATE__` 那个老坑）。而 DOM 属性是两个世界共享的，
 * 所以这里把 item 摘出来、序列化后写在 `.card9` 的 `data-cm-wb` 上，
 * 隔离世界（weibo-feed-context.js）只读属性即可。
 *
 * 纪律
 * ----
 * · **只写这一个属性**，不改页面任何其它东西，不发请求、不钩 XHR。
 * · 监听只认 childList（不认 attributes），所以自己写属性不会把自己再触发一遍。
 * · Vue 实例拿不到（微博将来换 Vue 3 / 换框架）→ 什么都不写 → 隔离世界认不出
 *   编号 → 按钮不挂。宁可没有按钮，也不挂一颗点了会提错的按钮。
 */
(function () {
  'use strict';

  var ATTR = 'data-cm-wb';
  var SCAN_DELAY = 120;
  var MAX_TEXT = 5000;         // 属性值别撑爆，超长文案截断（微博正文极少超 5000 字）
  var timer = null;

  /** 从卡片（或它的近几层祖先）上找 Vue 组件实例 */
  function pickItem(el) {
    var node = el;
    var depth = 0;
    while (node && depth < 4) {
      var vm = node.__vue__;
      if (vm && vm.item && vm.item.id) return vm.item;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  /**
   * `item.text` 是**带标签的 HTML**（`【<a href="https://m.weibo.cn/search?...">#话题#</a>】正文`），
   * 不是纯文本。不剥的话文案列存成 `【ahrefhttpsm…`，标题也跟着变成
   * `什么值得买ahrefhttpsm-2026年11月01日1203`（v2.7.39 真机实证，三条里两条中招）。
   *
   * `<br>` 先换成空格再取 textContent —— textContent 会把它当零宽丢掉，
   * 前后两段会粘成一个词。
   *
   * @param {string} html
   * @returns {string}
   */
  function htmlToText(html) {
    var s = String(html == null ? '' : html);
    if (!s) return '';
    if (s.indexOf('<') === -1) return s;
    try {
      var box = document.createElement('div');
      box.innerHTML = s.replace(/<br\s*\/?>/gi, ' ');
      return box.textContent || '';
    } catch (e) {
      // 解析失败就退回「剥标签」这条最粗的路，至少不把 HTML 存进去
      return s.replace(/<[^>]*>/g, ' ');
    }
  }

  /** 把一条卡片的 item 写成属性；写成功返回 true */
  function writeCard(el) {
    var item = pickItem(el);
    if (!item) return false;

    // item_category 非 status = 推荐位 / 广告 / 话题卡，不是博文
    if (item.item_category && item.item_category !== 'status') return false;

    var user = item.user || {};
    var payload = {
      id: String(item.id),
      mid: String(item.mid || item.id),
      uid: user.id ? String(user.id) : '',
      nick: user.screen_name || '',
      createdAt: item.created_at || '',
      text: htmlToText(item.text).slice(0, MAX_TEXT)
    };

    var json;
    try {
      json = JSON.stringify(payload);
    } catch (e) {
      return false;
    }
    // 值没变就别写（避免无意义的重排与 observer 噪声）
    if (el.getAttribute(ATTR) !== json) {
      try {
        el.setAttribute(ATTR, json);
      } catch (e) {
        return false;
      }
    }
    return true;
  }

  /** 扫一遍页面上所有卡片 */
  function scan() {
    timer = null;
    var cards;
    try {
      cards = document.querySelectorAll('.card9');
    } catch (e) {
      return;
    }
    for (var i = 0; i < cards.length; i++) {
      try {
        writeCard(cards[i]);
      } catch (e) { /* 单条失败不影响其他条 */ }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(scan, SCAN_DELAY);
  }

  function start() {
    scan();
    try {
      var observer = new MutationObserver(schedule);
      // 只认 childList：滚动加载新卡片要补，自己写属性不该触发
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* 没 observer 就只扫首屏，按钮少几颗但不影响正确性 */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
