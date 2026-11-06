/**
 * 采媒灵 · 页面内吉祥物地址解析（唯一实现）
 * ============================================================================
 * 【为什么要有这一层】
 *   全项目原来有 6 处各自实现「扩展内图片地址」：button-manager、floating-window、
 *   douban-list-buttons、instagram-feed-buttons、weibo-feed-buttons、x-feed-buttons。
 *   它们都直接 chrome.runtime.getURL('icons/mascot/hero-doc.svg')，而这些图片是挂在
 *   **别人页面 DOM** 上的 → 页面引用 chrome-extension:// 属于跨源请求，浏览器
 *   会打一条 "Unsafe attempt to load URL ... Domains, protocols and ports must match."
 *   图最终能显示，但 edge://extensions 错误页长期挂红字，个别站点还会被自己的
 *   CSP img-src 拦掉。
 *
 *   现在统一从这里取：优先返回 mascot-inline.js 里的 data URL（文档内联数据，
 *   不跨源、不受 img-src 限制、不产生任何请求），只有内联表里没有时才回落到
 *   老路 chrome.runtime.getURL —— 留这条兜底是为了「生成物坏了也不至于白屏」。
 *
 * 【入参两种写法都认】
 *   ClipMateMascot.url('hero-doc')                      // 名字
 *   ClipMateMascot.url('icons/mascot/hero-doc.svg')     // 相对路径
 *   空值 → face-idle（历史行为：小按钮默认用「探头看」那张）
 *   认不出来的串 → ''（调用方本来就把空串当「没有图标」处理）
 *
 * 【调用方不要自己判空再拼 URL】—— 取不到就返回 ''，由调用方走线稿降级。
 */
(function (root) {
  'use strict';

  var PREFIX = 'icons/mascot/';
  var DEFAULT_NAME = 'face-idle';
  var NAME_RE = /^[A-Za-z0-9_-]+$/;

  /** 内联表可能比本文件晚加载，所以每次现取，不做加载期快照。 */
  function tableOf() {
    try {
      var inline = root && root.ClipMateMascotInline;
      return (inline && inline.TABLE) || null;
    } catch (e) { return null; }
  }

  /**
   * 'icons/mascot/hero-doc.svg' / 'hero-doc' / '' → 'hero-doc'
   * 认不出来返回 ''。
   */
  function nameOf(rel) {
    var s = (rel === null || rel === undefined) ? '' : String(rel);
    s = s.replace(/^\s+|\s+$/g, '');
    if (!s) return DEFAULT_NAME;
    var m = /([A-Za-z0-9_-]+)\.svg$/i.exec(s);
    if (m) return m[1];
    if (NAME_RE.test(s)) return s;
    return '';
  }

  /** 老路：扩展内资源地址。没有扩展运行时（单测 / 资源缺失）返回 ''。 */
  function runtimeUrl(rel) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime &&
          typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(PREFIX + rel + '.svg');
      }
    } catch (e) { /* 测试环境没有 runtime */ }
    return '';
  }

  /** 取某形态的地址；取不到返回 ''。 */
  function url(rel) {
    var name = nameOf(rel);
    if (!name) return '';
    var table = tableOf();
    if (table && Object.prototype.hasOwnProperty.call(table, name) && table[name]) {
      return table[name];
    }
    // 兜底：内联表缺这张（新加了图但没重跑生成脚本）→ 老路，图仍然能显示，
    // 只是那一张会在控制台留一条跨源噪音。
    return runtimeUrl(name);
  }

  /** 这张图有没有内联（测试与排查用；调用方不需要它）。 */
  function isInline(name) {
    var table = tableOf();
    var n = nameOf(name);
    return !!(table && n && Object.prototype.hasOwnProperty.call(table, n) && table[n]);
  }

  var api = { url: url, nameOf: nameOf, isInline: isInline, DEFAULT_NAME: DEFAULT_NAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ClipMateMascot = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
