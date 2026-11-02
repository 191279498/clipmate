/**
 * 小红书「站内跳转跟随」（v2.6.0）
 *
 * 真机勘察结论（2026-10-29，接管已登录 Edge 实测）：
 *   1. 小红书笔记详情**永远是弹层**（`.note-detail-mask`），不是整页。
 *      点开/关闭都只改地址、不换文档 —— 所以 content script 只在首次加载的那个页面注入过，
 *      之后全靠这里盯地址。
 *   2. 从**搜索页** `/search_result` 或**用户主页** `/user/profile/<id>` 点开一条笔记时，
 *      地址会变成 `/explore/<24位ID>?xsec_token=…&xsec_source=pc_search|pc_user`。
 *      v2.5.101 及以前，这两个页面根本不在注入范围里 → 点开笔记也不会出现按钮。
 *   3. 反面：`/explore` 首页列表反而有按钮（注入命中），但列表页没有「当前笔记」，
 *      点下去报「未找到适用于 www.xiaohongshu.com 的提取器」。
 *   4. 弹层里**不能切下一条**（滚轮/方向键/滚到底只加载评论，0 个下一条链接），
 *      所以这里不需要 TikTok 那种「换条跟随」，只需要「进出笔记」两种状态。
 *
 * 本模块负责三件事：
 *   · 地址一变就按新路由同步**按钮显隐**（列表页藏、笔记页显示）
 *   · 从笔记退回列表时**连浮窗一起关**（v2.5.101 的教训：按钮和浮窗是两套组件）
 *   · 提取途中离开时，结果回来**不在列表页弹窗**（`_xhsShouldSuppressModal`）
 *
 * 纪律（跟 TikTok 那份完全一致）：
 *   · 只认 www.xiaohongshu.com / xiaohongshu.com，别的域名一个定时器都不多挂；
 *   · 只在**当前可见**时藏（不抢配置里 `showButton=false` 的方向盘）；
 *   · 只恢复**自己藏起来的**（`_xhsRouteHidden`），配置关掉的不擅自打开；
 *   · 判定抛错一律当「可提取」，宁可多一个按钮，也别误藏。
 */
(function(global) {
  'use strict';
  if (!global) return;

  /** 轮询间隔：小红书站内跳转不触发 popstate（Vue Router 用 pushState），只能比地址 */
  var POLL_MS = 400;

  global.XiaohongshuSpaMixin = {

    // ===================== 一、入口 =====================

    /**
     * 启动站内跳转跟随。由 content-main 的 init 末尾调用（只在 xiaohongshu.com 上生效）。
     * @returns {boolean} true = 已启动
     */
    _startXhsSpa() {
      if (this._xhsSpaStarted) return true;
      try {
        var host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : '';
        if (host.indexOf('xiaohongshu.com') < 0) return false;
      } catch (e) { return false; }

      this._xhsSpaStarted = true;
      // 进页面先按路由定一次按钮显隐（列表页不该出按钮）。
      this._xhsRouteHidden = false;
      try { this._syncXhsRouteVisibility(); } catch (e0) { /* 忽略 */ }
      try { this._xhsLastHref = location.href; } catch (e2) { this._xhsLastHref = ''; }

      var self = this;
      this._xhsTimer = setInterval(function () { self._checkXhsRoute(); }, POLL_MS);
      try {
        window.addEventListener('popstate', function () { self._checkXhsRoute(); });
      } catch (e3) { /* 忽略 */ }

      // 按钮是 initComponents 建的，隔一拍再同步一次，
      // 免得「按钮还没进 DOM 就被判成不可提取 → 没人藏」。幂等，跑两次没事。
      try {
        var self2 = this;
        setTimeout(function () {
          try { self2._syncXhsRouteVisibility(); } catch (e4) { /* 忽略 */ }
        }, 300);
      } catch (e5) { /* 忽略 */ }

      return true;
    },

    /** 停止跟随（页面卸载 / 单测用） */
    _stopXhsSpa() {
      if (this._xhsTimer) {
        try { clearInterval(this._xhsTimer); } catch (e) { /* 忽略 */ }
        this._xhsTimer = null;
      }
      this._xhsSpaStarted = false;
    },

    // ===================== 二、换页判定 =====================

    _checkXhsRoute() {
      var href = '';
      try { href = location.href; } catch (e) { return; }
      if (!href || href === this._xhsLastHref) return;
      var prevHref = this._xhsLastHref;
      this._xhsLastHref = href;

      // 地址一变就先按新路由同步按钮显隐。
      // 必须放在下面 `if (!curKey || ...) return` **之前** —— 因为从笔记退回列表时
      // curKey 是空串，会被那行直接 return 掉，藏按钮就落空了（v2.5.100 在 TikTok 上踩过）。
      this._syncXhsRouteVisibility(href);

      var prevKey = this._xhsRouteKeyFromHref(prevHref);
      var curKey = this._xhsRouteKeyFromHref(href);
      if (!curKey || curKey === prevKey) return;

      this._xhsLog('info', '换了一个目标（' + (prevKey || '无') + ' → ' + curKey + '）');

      // 缓存键必须跟着换：笔记 ID 在路径里，generateCacheKey 本身能区分，
      // 但显式重算一次更稳（handleExtract 里也会重算，双保险）。
      try {
        this.cacheKey = this.generateCacheKey(href);
      } catch (e2) { /* 地址解析失败就沿用旧键，不影响提取 */ }

      // 换了一个目标就关浮窗（按钮保留）——照 v2.5.95 TikTok 定下的规矩。
      // 不写「就地刷新」：新数据不是立刻就绪，就地刷新会先闪一下上一条。
      this._closeXhsPanelOnly('换了一个目标，浮窗已关闭（按钮保留）');
    },

    /**
     * 路由键：
     *   `note:<24位>`     —— 当前有一条笔记（作品页 / 社交）
     *   `profile:<24位>`  —— 当前在某人主页（人物档案 / account，v2.7.16）
     *   `''`              —— 列表页 / 搜索页，没有可提取的目标
     *
     * v2.7.16 之前只认笔记，主页会被判成「列表页」把按钮藏掉 ——
     * 而主页从 v2.7.16 起支持人物档案提取，按钮**必须**出现。
     *
     * @param {string} [href] 默认取 location.href
     * @returns {string}
     */
    _xhsRouteKeyFromHref(href) {
      var id = this._xhsNoteIdFromHref(href);
      if (id) return 'note:' + id;
      var uid = this._xhsProfileIdFromHref(href);
      if (uid) return 'profile:' + uid;
      return '';
    },

    /**
     * 从地址里取作者 userId（个人主页 `/user/profile/<24位>`）。
     * 笔记页 / 列表页 / 搜索页都取不到 → 返回 ''
     * @param {string} [href] 默认取 location.href
     * @returns {string}
     */
    _xhsProfileIdFromHref(href) {
      try {
        var raw = (href === undefined || href === null) ? location.href : href;
        var m = String(raw).match(
          /^https?:\/\/(?:www\.)?xiaohongshu\.com\/user\/profile\/([0-9a-fA-F]{24})(?:[?#\/]|$)/i
        );
        return m ? m[1] : '';
      } catch (e) { return ''; }
    },

    /**
     * 从地址里取笔记 ID。
     *
     * 实测的地址形态（都带 xsec_token，令牌不能丢，丢了就 404）：
     *   https://www.xiaohongshu.com/explore/69e089a4000000002200066c?xsec_token=…&xsec_source=pc_search
     *   https://www.xiaohongshu.com/discovery/item/<24位ID>（老地址，现在会跳转到 /explore/）
     * 列表页 /explore、搜索页 /search_result、主页 /user/profile/<id> 都取不到 → 返回 ''
     */
    _xhsNoteIdFromHref(href) {
      try {
        var raw = (href === undefined || href === null) ? location.href : href;
        var m = String(raw).match(
          /^https?:\/\/(?:www\.)?xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})(?:[?#]|$)/i
        );
        return m ? m[1] : '';
      } catch (e) { return ''; }
    },

    // ===================== 三、按钮显隐 + 浮窗同关 =====================

    /**
     * 按当前路由决定按钮显不显示。
     *
     * 判定不另写一套白名单，直接用 `_xhsRouteKeyFromHref`：它返回 '' 就代表「这页没有可提取的目标」
     * （笔记页和个人主页都会返回非空），跟换页判定共用一份逻辑，不会两边打架。
     *
     * @param {string} [href] 默认取 location.href
     */
    _syncXhsRouteVisibility(href) {
      // 1) 先判路由。注意**不能**因为「按钮还没建出来」就整条 return ——
      //    浮窗也要按这个判定走，按钮没进 DOM 时列表页上的浮窗一样得关（v2.5.101 的教训）。
      var ok = false;
      try {
        ok = !!this._xhsRouteKeyFromHref(href === undefined ? location.href : href);
      } catch (e) {
        ok = true;   // 判定失败就当可提取，宁可多出一个按钮也别误藏
      }

      // 2) 没有可提取的目标（列表页 / 搜索页 / 探索页）：按钮藏起来，浮窗也一起关掉
      if (!ok) {
        var bm0 = this.buttonManager;
        if (bm0 && bm0.button && bm0.isVisible !== false) {
          bm0.setVisible(false);
          this._xhsRouteHidden = true;
          this._xhsLog('info', '这个页面没有可提取的目标（列表页 / 搜索页），先把按钮藏起来');
        }
        // 浮窗跟按钮是两个各自独立的组件，按钮藏了浮窗不会自己跟着走，必须显式关。
        // 放在按钮判断**外面**：按钮被配置关掉、或者按钮还没建出来时，列表页上的浮窗照样要关。
        this._closeXhsPanelOnly('这个页面没有可提取的目标，浮窗一起关掉');
        return;
      }

      // 3) 回到可提取的页面（笔记页 / 个人主页）：只恢复**自己藏起来**的那次，配置关掉的按钮不擅自打开
      var bm = this.buttonManager;
      if (bm && bm.button && this._xhsRouteHidden) {
        bm.setVisible(true);
        this._xhsRouteHidden = false;
      }
    },

    /**
     * 只关浮窗，**不动按钮**（照抖音 `_closeDouyinPanelOnly` / TikTok `_closeTikTokPanelOnly` 同一写法）。
     * 直接调现有 close()，不另写强制关 —— 避免留下半关状态。
     *
     * @param {string} [logMsg] 自定义日志文案；不传就是「换了一条笔记」那套
     */
    _closeXhsPanelOnly(logMsg) {
      try {
        if (this.modalManager && this.modalManager.isOpen) {
          this.modalManager.close();
          this._xhsLog('info', logMsg || '换了一条笔记，浮窗已关闭（按钮保留）');
        }
      } catch (e) {
        this._xhsLog('warn', '关闭浮窗失败：' + (e && e.message));
      }
    },

    // ===================== 四、弹窗拦截 =====================

    /**
     * 当前页还接不接受弹窗？返回 true 表示**别弹**。
     *
     * 为什么需要：提取是异步的，等待期间用户可能已经关掉笔记退回列表
     * （尤其小红书笔记页要额外抓一次作者主页拿小红书号，慢的时候 1～3 秒）。
     * 结果回来时不问一句就 open()，列表页上会凭空冒出一个浮窗。
     *
     * **名字带 `_xhs` 前缀**：这份 mixin 被 Object.assign 到共享原型上，
     * 而 content-main 里还有一个按站点汇总的 `_shouldSuppressModal()`。
     * 若这里也叫 `_shouldSuppressModal`，会把 TikTok 那份覆盖掉，
     * 两个站点互相打架（v2.5.101 踩过「共享原型」的坑，这次直接按前缀隔离）。
     *
     * 站点门禁必须第一行走：manifest 里同一条 content_scripts 覆盖全站，
     * 别的网站也会调到这里，不加门禁就等于「别的网站永远不弹窗」。
     */
    _xhsShouldSuppressModal() {
      try {
        var host = (typeof location !== 'undefined' && location.hostname)
          ? String(location.hostname).toLowerCase() : '';
        // 只认 xiaohongshu.com 本身及其子域
        if (!/(^|\.)xiaohongshu\.com$/.test(host)) return false;
        return !this._xhsRouteKeyFromHref(location.href);
      } catch (e) {
        return false;   // 判定抛错一律放行，宁可多弹一次也别把数据吞掉
      }
    },

    // ===================== 五、日志 =====================

    _xhsLog(level, msg) {
      try {
        if (typeof ClipMateLog === 'undefined' || !ClipMateLog) return;
        var fn = ClipMateLog[level] || ClipMateLog.info;
        if (typeof fn === 'function') fn.call(ClipMateLog, '[小红书] ' + msg);
      } catch (e) { /* 忽略 */ }
    }
  };
})(typeof window !== 'undefined' ? window : null);
