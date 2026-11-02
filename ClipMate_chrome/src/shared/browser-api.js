/**
 * 浏览器 API 兼容层（Firefox 版新增）
 *
 * 背景：
 *   Chrome 只提供 chrome.* 命名空间，异步方法返回 Promise；
 *   Firefox 同时提供 browser.*（原生 Promise）和 chrome.*（回调为主，Promise 行为无文档保证）。
 *
 * 做法：
 *   优先使用 browser.*，不存在时回退到 chrome.*。
 *   两者 API 形状一致，因此代码其余部分只需把 chrome.xxx 写成 WBR.xxx。
 *
 * 注意：本文件必须在其他内容脚本之前加载（已在 manifest 的 content_scripts.js 首位声明）。
 */
var WBR = (typeof browser !== "undefined" && browser && browser.runtime) ? browser : chrome;
