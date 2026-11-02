/**
 * 快手「关闭自动连播」的开关桥（隔离世界，随主内容脚本加载）
 *
 * 主世界脚本（`kuaishou-no-autoplay.js`，world: "MAIN"）**拿不到 `chrome.storage`**，
 * 所以开关必须由隔离世界读出来、写到两边都能看见的地方 —— DOM。
 * 本脚本就是那个「翻译」：
 *
 *   `kuaishouNoAutoplayEnabled`（storage，缺省开）
 *     → `<html data-clipmate-ks-noautoplay="on|off">`
 *
 * 主世界每次事件发生时现读这个属性，所以：
 *   - 读不到属性 → 按「开」处理（缺省开的语义）；
 *   - 用户在设置页改完 → 下一次 `ended` 就按新值走，不用刷新页面。
 *
 * 只在 `www.kuaishou.com` 上做事（第一行门禁），其他站点连一个属性都不会多。
 */
(function (global) {
  'use strict';

  try {
    if (location.hostname !== 'www.kuaishou.com') return;
  } catch (e) {
    return;
  }

  var ATTR = 'data-clipmate-ks-noautoplay';
  var KEY = 'kuaishouNoAutoplayEnabled';

  /** 浏览器 API（正常情况下 WBR 已经由 shared/browser-api.js 挂好） */
  function api() {
    try {
      if (typeof WBR !== 'undefined' && WBR) return WBR;
      if (typeof chrome !== 'undefined' && chrome && chrome.storage) return chrome;
    } catch (e) { /* 忽略 */ }
    return null;
  }

  /** 写开关：`true` = 生效（关掉快手的自动连播） */
  function apply(enabled) {
    try {
      var el = document.documentElement;
      if (!el) return;
      el.setAttribute(ATTR, enabled ? 'on' : 'off');
    } catch (e) { /* 写不上就保持主世界「缺省开」的判断 */ }
  }

  // 先按「开」写上，等存储读回来再改（避免主世界在读到之前按「开」处理时属性缺失）
  apply(true);

  var wbr = api();
  if (!wbr || !wbr.storage || !wbr.storage.local) return;

  try {
    var ret = wbr.storage.local.get([KEY]);
    if (ret && typeof ret.then === 'function') {
      ret.then(function (res) {
        apply(!(res && res[KEY] === false));
      }).catch(function () { /* 读失败保持「开」 */ });
    } else if (typeof wbr.storage.local.get === 'function') {
      // 老式回调形态（Chrome 早期 / 某些兼容层）
      wbr.storage.local.get([KEY], function (res) {
        apply(!(res && res[KEY] === false));
      });
    }
  } catch (e) { /* 读失败保持「开」 */ }

  // 设置页改完立刻生效（不用刷新快手页面）
  try {
    if (wbr.storage.onChanged && wbr.storage.onChanged.addListener) {
      wbr.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== 'local') return;
        if (!changes || !changes[KEY]) return;
        apply(!(changes[KEY].newValue === false));
      });
    }
  } catch (e) { /* 监听挂不上只是要刷新页面才生效 */ }
})(typeof window !== 'undefined' ? window : null);
