/**
 * 社交媒体 DOM 取值小工具
 *
 * 设计目标
 * --------
 * 各站点提取器里同一类「读 meta → 取 content」的写法重复出现几十次，
 * 每次都要写 querySelector + 判空 + getAttribute('content') 三步。
 * 这里收敛成一个函数，只做同一件事，不改变任何取值优先级：
 *
 *   document.querySelector('meta[property="og:title"]')
 *     && el.getAttribute('content')
 *   ↓
 *   SocialDomUtils.readMeta('meta[property="og:title"]')
 *
 * 约定：取不到一律返回空字符串 ''（调用方用 if (x) 判断，与原来的 falsy 判断等价）。
 *
 * 用法
 * ----
 *   const title = SocialDomUtils.readMeta('meta[property="og:title"]');
 *   const title = SocialDomUtils.readMeta('og:title');        // 简写：先 property 后 name
 *   const el = SocialDomUtils.firstMatch(['#a', '#b']);        // 按顺序取第一个命中的元素
 *   const url = SocialDomUtils.absoluteUrl(href, 'https://www.youtube.com');
 */
(function (global) {
  'use strict';

  /**
   * 把简写或完整选择器统一成可用的选择器列表
   * - 含 '[' 视为完整选择器，原样返回
   * - 含 ':' 视为简写（如 og:title），按 property → name 顺序尝试
   * - 其余按 name 处理
   * @param {string} selectorOrName
   * @returns {string[]}
   */
  function toSelectors(selectorOrName) {
    if (!selectorOrName || typeof selectorOrName !== 'string') return [];

    const text = selectorOrName.trim();
    if (!text) return [];

    if (text.indexOf('[') !== -1) {
      return [text];
    }

    if (text.indexOf(':') !== -1) {
      return ['meta[property="' + text + '"]', 'meta[name="' + text + '"]'];
    }

    return ['meta[name="' + text + '"]', 'meta[property="' + text + '"]'];
  }

  /**
   * 读取 meta 标签的 content
   * @param {string} selectorOrName - 完整选择器，或 'og:title' / 'description' 这类简写
   * @returns {string} content 内容（原样返回，不 trim），取不到返回 ''
   */
  function readMeta(selectorOrName) {
    try {
      for (const selector of toSelectors(selectorOrName)) {
        const el = document.querySelector(selector);
        if (!el) continue;
        // 同时兼容 getAttribute 与 content 属性，保持与各站原有写法一致
        const value = typeof el.getAttribute === 'function'
          ? el.getAttribute('content')
          : el.content;
        if (value) return value;
      }
    } catch (error) { ClipMateLog.debug('[ClipMate] 已忽略异常:', error && error.message); }
    return '';
  }

  /**
   * 按顺序尝试多个选择器，返回第一个命中的元素
   * @param {string[]|string} selectors
   * @param {Element|Document} [root=document]
   * @returns {Element|null}
   */
  function firstMatch(selectors, root) {
    const scope = root || document;
    const list = Array.isArray(selectors) ? selectors : [selectors];

    for (const selector of list) {
      if (!selector) continue;
      try {
        const el = scope.querySelector(selector);
        if (el) return el;
      } catch (error) { ClipMateLog.debug('[ClipMate] 已忽略异常:', error && error.message); }
    }
    return null;
  }

  /**
   * 把可能相对的链接补成绝对地址
   * @param {string} href
   * @param {string} base - 例如 'https://www.youtube.com'
   * @returns {string} 绝对地址，href 为空时返回 ''
   */
  function absoluteUrl(href, base) {
    if (!href) return '';
    if (/^https?:\/\//i.test(href)) return href;
    return (base || '') + href;
  }

  const api = {
    readMeta,
    firstMatch,
    absoluteUrl
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SocialDomUtils = api;
  }
})(typeof window !== 'undefined' ? window : null);
