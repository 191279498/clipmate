/**
 * X（推特）SPA 相关逻辑（v2.7.43）
 *
 * 目前只有一件事：把「页面上每一条推文的小按钮」接进主流程。
 * 与 `ig-spa-handler.js`、`weibo-spa-handler.js` 同一个模式 —— 判定（哪一条、按钮落点、
 * 详情页主贴要不要挂）全部在 `XFeedButtons` + `XFeedContext` 内部，
 * mixin 只负责把「用户点了哪一条」转成一次提取。
 *
 * 站点门禁：`content-main.js` 只在 X 域名调用 `_initXFeedButtons()`；
 * 方法内部再判一次（共享原型铁律：mixin 每个站都会调到）。
 */
(function () {
  'use strict';

  function safeLog(message) {
    try {
      if (window.ClipMateLog && typeof window.ClipMateLog.debug === 'function') {
        window.ClipMateLog.debug(message);
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  const XSpaMixin = {
    /**
     * 挂上逐帖按钮。幂等：重复调用直接返回。
     */
    _initXFeedButtons() {
      const host = (typeof location !== 'undefined' && location.hostname) || '';
      if (!/(^|\.)x\.com$/i.test(host)) return;

      if (this.xFeedButtons) return;
      if (typeof window.XFeedButtons === 'undefined' || typeof window.XFeedContext === 'undefined') {
        safeLog('⚠️ [MediaExtractor] XFeedButtons / XFeedContext 未加载，逐帖按钮不挂');
        return;
      }

      this.xFeedButtons = new window.XFeedButtons({
        onExtract: (target) => this._onXPostExtract(target)
      });
      this.xFeedButtons.start();
    },

    /**
     * 用户点了某一条推文的小按钮 → 只提这一条。
     *
     * 三条纪律（与 IG / 微博逐帖提取一致）
     * --------------------------------
     * ① 作用域锁死在那一个容器上：列表页还有几十条，作用域跑丢就会拿到邻居的文案。
     * ② 提完还原上下文：列表页没有「当前这一条」的概念，留着会污染后续全局流程。
     * ③ 返回值必须是布尔：按钮靠它决定闪绿还是闪红。
     *
     * @param {{container: Element, post: Object}} target
     * @returns {Promise<boolean>}
     */
    async _onXPostExtract(target) {
      const container = target && target.container;
      const post = target && target.post;
      if (!container || !post || !post.mid) return false;

      const prevContext = this.activeContext;
      const prevShortcode = this.activeShortcode;

      // 缓存键按推文编号算，同一条点两次命中缓存，不同推文互不污染
      this.activeContext = container;
      this.activeShortcode = post.mid;
      try {
        // `forceMediaType: 'social'` 不能省（微博 v2.7.40 的教训）：
        // X 的个人主页 `/<处理名>` 整页类型是 person，按地址匹配会选到人物档案提取器，
        // 它不认识 `feedPost`，点推文按钮只会弹出 6 列空表。
        return await this.handleExtract({
          feedPost: { container: container, post: post },
          forceMediaType: 'social',
          // v2.10.0：浮窗贴在用户点的那颗小按钮下方（信息流页没有大按钮可贴）
          anchorEl: (target && target.anchor) || null
        });
      } catch (e) {
        safeLog('[MediaExtractor] X 逐帖提取失败: ' + (e && e.message));
        return false;
      } finally {
        this.activeContext = prevContext;
        this.activeShortcode = prevShortcode;
      }
    }
  };

  if (window) window.XSpaMixin = XSpaMixin;
})();
