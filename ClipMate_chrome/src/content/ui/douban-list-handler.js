/**
 * 豆瓣收藏列表页 → 逐条提取的接线（v2.11.4）
 *
 * 只做三件事：
 *   ① 挂按钮组件（域名 + 路径门禁）
 *   ② 点按钮时「抓详情页 → 切换提取源 → 走统一提取流程 → 弹浮窗」
 *   ③ 把失败原因交给按钮，让它红脸 + 悬停能看到为什么
 *
 * 站点门禁：content-main 只在 movie.douban.com 调 `_initDoubanListButtons()`，
 * 方法内部再判一次 —— 共享原型的铁律：mixin 的每个方法在所有站点都会被调到。
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

  function notice(text, type) {
    try {
      if (window.ClipMateNotice && typeof window.ClipMateNotice.show === 'function') {
        window.ClipMateNotice.show(text, type || 'warn');
      }
    } catch (e) { /* 提示条失败不影响提取 */ }
  }

  /**
   * 这份详情页文档看起来是不是剧集？
   *
   * 为什么要单独判：`media-detector` 的 `movie.douban.com` 分支读的是**全局 document**，
   * 而现在手上是刚抓回来、还没进页面的另一份文档，它读不到。
   * 判据与 `media-detector.js` 里 `/subject/` 那条特判**同源**（#info 里的集数 / 季数），
   * 单测 `douban-list.test.js` 锁住了两边一致，防止将来只改一边。
   */
  function docLooksTv(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return false;
    var info = doc.querySelector('#info');
    if (!info) return false;
    var t = String(info.textContent || '').toLowerCase();
    return t.indexOf('集数') > -1 || t.indexOf('季数') > -1 ||
      t.indexOf('season') > -1 || t.indexOf('季') > -1 ||
      (t.indexOf('共') > -1 && t.indexOf('集') > -1);
  }

  /** 列表条目属于哪一类 → 用哪个提取器（影视还要再分电影 / 剧集） */
  function forcedTypeOf(kind, doc) {
    if (kind === 'book') return 'book';
    if (kind === 'game') return 'game';
    return docLooksTv(doc) ? 'tv' : 'movie';
  }

  const DoubanListMixin = {
    /**
     * 挂上逐条按钮。幂等：重复调用直接返回。
     * @param {string} [kind] 由 content-main 的页面白名单判定结果，仅用于日志。
     */
    _initDoubanListButtons(kind) {
      const host = String((typeof location !== 'undefined' && location.hostname) || '').toLowerCase();
      // 共享原型的铁律：mixin 的每个方法在所有站点都会被调到，第一行必须自带门禁。
      // 路径级的门禁在按钮组件的 start() 里再判一次（那边有各站的选择器表）。
      if (!/^(?:movie\.douban\.com|book\.douban\.com|www\.douban\.com)$/i.test(host)) return;

      if (this.doubanListButtons) return;
      if (typeof window.DoubanListButtons === 'undefined' ||
          typeof window.DoubanListFetch === 'undefined') {
        safeLog('⚠️ [MediaExtractor] DoubanListButtons / DoubanListFetch 未加载，逐条按钮不挂');
        return;
      }

      safeLog('[MediaExtractor] 豆瓣列表逐条按钮启动：' + (kind || host));
      this.doubanListButtons = new window.DoubanListButtons({
        // v2.11.7：落点由设置页决定（A 封面右下角 / B 封面下方 / C 条目最右），
        // 默认 A；组件内部还会再归一化一次（脏值回 A）。
        layout: this.doubanListBtnLayout,
        onExtract: (target) => this._onDoubanListItemExtract(target)
      });
      this.doubanListButtons.start();
    },

    /**
     * 用户点了列表里某一条的小按钮。
     *
     * @param {{subjectUrl:string, subjectId:string, anchor:Element}} target
     * @returns {Promise<boolean>} true 闪绿、false 闪红（按钮靠它决定）
     */
    async _onDoubanListItemExtract(target) {
      const url = target && target.subjectUrl;
      const id = target && target.subjectId;
      const kind = (target && target.kind) || 'movie';
      const anchor = (target && target.anchor) || null;
      if (!url || !id) return false;

      const fetcher = window.DoubanListFetch;
      if (!fetcher) return false;

      // ① 已经熔断：一声不响地再发请求是最糟的选择，直接说清楚
      if (fetcher.isBlocked()) {
        const why = fetcher.blockedReason();
        if (this.doubanListButtons) this.doubanListButtons.setFailReason(why + '，刷新页面后再试');
        notice(why + '，已暂停抓取（刷新页面可重试）', 'error');
        return false;
      }

      // ② 抓详情页（内部有内存缓存 + 单请求闸门 + 熔断）
      const res = await fetcher.load(url);
      if (!res || !res.ok) {
        const why = (res && res.reason) || '抓取失败';
        if (this.doubanListButtons) this.doubanListButtons.setFailReason(why);
        if (fetcher.isBlocked()) notice(why + '，已暂停抓取（刷新页面可重试）', 'error');
        return false;
      }

      // ③ 交给统一提取流程，只把「读哪份文档」换掉。
      //    activeShortcode 用带站点的缓存键：读书 / 影视的 subject 编号都是纯数字，
      //    不带上域名就是「在读书页点到影视那条缓存」；列表页几十条地址还完全相同，
      //    不改就是「点谁都弹第一条」。
      // ③.5 字段映射器必须按「这一条」的类型建，不能省。
      //   列表页在 init() 里走独立通道、提前 return，没经过正常的
      //   `this.fieldMapper = await this.initFieldMapper(mediaType)`，所以它是 null。
      //   更要命的是同一张列表里可能混着电影 / 剧集 / 书 / 游戏：
      //   建一个固定类型的 mapper，点读书条目就会弹出电影表。
      //   类型没变就复用，变了才重建（每次 new 一下很快，但没必要）。
      //   v2.11.5 真机验收漏了这步，点按钮直接报
      //   "Cannot read properties of null (reading 'mapToUniversalFields')"。
      const forcedType = forcedTypeOf(kind, res.doc);
      if (typeof this.initFieldMapper === 'function' &&
          (!this.fieldMapper || this.fieldMapper.mediaType !== forcedType)) {
        this.fieldMapper = await this.initFieldMapper(forcedType);
      }

      const prevShortcode = this.activeShortcode;
      this.activeShortcode = res.key || id;
      try {
        return await this.handleExtract({
          doc: res.doc,
          pageUrl: res.url,
          forceMediaType: forcedType,
          // 浮窗贴在刚点的那颗小按钮下方（列表页没有大按钮可贴）
          anchorEl: anchor
        });
      } catch (e) {
        safeLog('[MediaExtractor] 豆瓣列表逐条提取失败: ' + (e && e.message));
        if (this.doubanListButtons) this.doubanListButtons.setFailReason('提取失败');
        return false;
      } finally {
        this.activeShortcode = prevShortcode;
      }
    },

    /** 给单测用的纯函数出口（不改页面状态） */
    _doubanDocLooksTv(doc) {
      return docLooksTv(doc);
    },

    /** 给单测用的纯函数出口：三类条目各自该用哪个提取器 */
    _doubanForcedType(kind, doc) {
      return forcedTypeOf(kind, doc);
    }
  };

  if (window) window.DoubanListMixin = DoubanListMixin;
})();
