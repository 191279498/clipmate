// 统一日志闸门（v2.5.64 起）
//
// 目的：把散落在各处的调试日志收进一个开关，控制台默认干净，
//       排查问题时一句话就能全开。
//
// 用法：
//   在页面控制台执行  localStorage.setItem('clipmateDebug', '1')  然后刷新 → 全部日志可见
//   关闭                     localStorage.removeItem('clipmateDebug')
//   代码里：ClipMateLog.debug(...) / .info(...) / .log(...) / .warn(...) / .error(...)
//
// 分级约定（不可改）：
//   debug / info / log  → 默认静默，只有开了开关才输出
//   warn / error        → 永远输出（这是排查问题的唯一线索，任何情况都不许静音）
//
// 安全约定：
//   1) 本文件必须排在 manifest 的 content_scripts.js 第一位，其他脚本依赖 ClipMateLog 存在；
//   2) 内部全部 try/catch，日志本身出任何问题都不许影响提取。

(function () {
  'use strict';

  var DEBUG_KEY = 'clipmateDebug';

  function debugEnabled() {
    try {
      return window.localStorage.getItem(DEBUG_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function emit(level, args) {
    try {
      var c = typeof console !== 'undefined' ? console : null;
      if (!c) return;
      var fn = typeof c[level] === 'function' ? c[level] : c.log;
      if (typeof fn !== 'function') return;
      fn.apply(c, args);
    } catch (e) {
      // 静默：日志出错绝不影响提取
    }
  }

  function make(level, alwaysOn) {
    return function () {
      if (!alwaysOn && !debugEnabled()) return;
      emit(level, Array.prototype.slice.call(arguments));
    };
  }

  var ClipMateLog = {
    debug: make('debug', false),
    info: make('info', false),
    log: make('log', false),
    warn: make('warn', true),
    error: make('error', true),
    isDebug: debugEnabled,
    setDebug: function (on) {
      try {
        if (on) window.localStorage.setItem(DEBUG_KEY, '1');
        else window.localStorage.removeItem(DEBUG_KEY);
      } catch (e) {
        // 静默
      }
    }
  };

  try {
    window.ClipMateLog = ClipMateLog;
  } catch (e) {
    // 静默
  }
})();
