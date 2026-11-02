/**
 * 快手「强制关闭自动连播」（主世界注入，document_start）
 *
 * 为什么需要它
 * ------------
 * 快手和其他社交站不一样：**作品播完会自己往下走**，不需要任何操作。
 * 真机实测（v2.7.0 勘察，接管已登录 Edge）：
 *   - 弹层 `.player-pop`（搜索页 / 作者主页）：20 秒内自己切了 2 条；
 *   - 详情页 `/short-video/<id>`：不是切下一条，而是**播完从头再播**
 *     （连续采样 `11.8s → 3.4s`，地址与标题一直没变）。
 *
 * 这不只是「看得烦」的问题：勘察时弹层里的封面 / 视频 / 日期在一瞬间指向不同作品，
 * 会把「这一条到底是哪一条」判错。关掉连播，勘察与提取才稳。
 *
 * 为什么必须放主世界（world: "MAIN"）
 * ----------------------------------
 * 内容脚本默认跑在**隔离世界**。在隔离世界里 `stopImmediatePropagation()` 只能挡住
 * 隔离世界自己的监听器，**挡不住页面自己的**（两个世界的事件监听表是分开的）。
 * 所以这条脚本必须是 `world: "MAIN"` + `run_at: "document_start"`（抢在快手注册监听之前）。
 *
 * 手段（两道）
 * -----------
 * ① 主手段：在 `document` 的**捕获阶段**拦 `ended`。
 *    捕获是 window → document → … → video，在 document 拦住并 `stopImmediatePropagation()`，
 *    快手挂在 video / 容器上的「播完了，下一条」回调就永远收不到这个事件。
 *    真机实测：拦之前 20 秒切 2 条 / 播完重播，拦之后停在最后、`paused: true`、文案不变。
 * ② 兜底：每 2 秒把 `video.loop` 强制成 `false`。
 *    万一哪天快手改用 `loop` 属性实现重播，那种情况下 `ended` 根本不会触发，① 兜不住。
 *
 * 开关
 * ----
 * 用户可以在设置页关掉这个功能（`kuaishouNoAutoplayEnabled`，缺省开）。
 * 主世界拿不到 `chrome.storage`，所以开关由隔离世界的
 * `kuaishou-no-autoplay-flag.js` 读存储后写进 `<html data-clipmate-ks-noautoplay="on|off">`，
 * 本脚本每次事件发生时**现读**这个属性（不缓存，改完设置立刻生效）。
 * 属性还没写上的那一瞬间按「开」处理（缺省开的语义），实测无影响：
 * 视频播完至少是页面加载几秒后的事。
 *
 * 三条结构保证
 * -----------
 *   - 站点门禁第一行：不是 `www.kuaishou.com` 直接 return，其他 30 多个站点一个监听都不多。
 *   - 幂等：`window.__clipmateKsNoAutoplay` 标记，重复注入不会叠监听。
 *   - 全程 try/catch：出错绝不影响页面本身（最差等于没装）。
 *
 * 副作用（已与用户确认，两处都关）
 * ------------------------------
 *   - 弹层里不再自动播下一条，要连看得手动滑；
 *   - 详情页播完停在最后一帧；
 *   - 手动点「下一条」「连播」这些按钮照旧可用（那是用户主动的）。
 */
(function () {
  'use strict';

  // 站点门禁：第一行，别动
  try {
    if (location.hostname !== 'www.kuaishou.com') return;
  } catch (e) {
    return;
  }

  // 幂等：同一文档重复注入只装一次
  if (window.__clipmateKsNoAutoplay) return;
  window.__clipmateKsNoAutoplay = true;

  /** 隔离世界写的开关属性（`off` = 用户关掉了本功能；没写 = 开） */
  var FLAG_ATTR = 'data-clipmate-ks-noautoplay';
  /** 兜底巡检间隔（`video.loop` 那条） */
  var INTERVAL_MS = 2000;

  /** 本功能现在是否生效（现读 DOM 属性，不缓存 —— 用户改设置后立刻生效） */
  function enabled() {
    try {
      var el = document.documentElement;
      if (!el) return true;
      return el.getAttribute(FLAG_ATTR) !== 'off';
    } catch (e) {
      return true;   // 读不到就按开处理：宁可多拦一次，也别让功能静默失效
    }
  }

  /** 拦住「播完了」这个信号 —— 快手拿不到它就不会往下走 */
  function onEnded(evt) {
    if (!enabled()) return;
    try {
      evt.stopImmediatePropagation();
      // 计数只给自动化验收 / 排查用，不参与任何逻辑
      window.__clipmateKsNoAutoplayBlocked = (window.__clipmateKsNoAutoplayBlocked || 0) + 1;
    } catch (e) { /* 拦不住也不许抛错 */ }
  }

  try {
    document.addEventListener('ended', onEnded, true);
  } catch (e) { /* 装不上就只剩兜底那一道 */ }

  /** 兜底：把 `loop` 关掉（`loop` 开着时 `ended` 根本不触发，① 收不到） */
  function unpinLoop() {
    if (!enabled()) return;
    try {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        if (vs[i] && vs[i].loop) vs[i].loop = false;
      }
    } catch (e) { /* 忽略 */ }
  }

  try {
    setInterval(unpinLoop, INTERVAL_MS);
  } catch (e) { /* 忽略 */ }
})();
