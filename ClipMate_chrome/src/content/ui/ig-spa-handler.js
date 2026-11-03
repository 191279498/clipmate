(function(global) {
  'use strict';

  global.IgSpaMixin = {

    _initModalWatcher() {
    if (typeof window.InstagramModalWatcher === 'undefined') {
      safeLog('⚠️ [MediaExtractor] InstagramModalWatcher 未加载，跳过 Modal 监听');
      return;
    }
    this.modalWatcher = new window.InstagramModalWatcher({
      onModalOpen: (root, shortcode) => this._onModalPost(root, shortcode),
      onActivePostChange: (root, shortcode) => this._onModalPost(root, shortcode),
      onModalClose: () => this._onModalClose(),
      onPageChange: () => this._onPageChange()
    });
    this.modalWatcher.start();
    safeLog('✅ [MediaExtractor] InstagramModalWatcher 已启动');
    },

    /**
     * 首页信息流「逐帖按钮」挂载（v2.7.35）
     *
     * 用户 2026-11-01 拍板：首页 `/` 是无限流，想存某一条不该先点开详情页，
     * 所以在每条帖子右上角挂一枚小按钮，点它才提取那一条。
     *
     * 一切判定（是不是首页、哪一条、按钮位置）都在 `InstagramFeedButtons` 内部，
     * mixin 只负责把「用户点了哪一条」转成一次提取。没加载到组件就安静跳过。
     */
    _initInstagramFeedButtons() {
    if (this.feedButtons) return;
    if (typeof window.InstagramFeedButtons === 'undefined') {
      safeLog('⚠️ [MediaExtractor] InstagramFeedButtons 未加载，首页逐帖按钮不挂');
      return;
    }
    this.feedButtons = new window.InstagramFeedButtons({
      onExtract: (target) => this._onFeedPostExtract(target)
    });
    this.feedButtons.start();
    },

    /**
     * 用户点了首页某一条帖子的小按钮 → 只提这一条。
     *
     * 三条纪律
     * --------
     * ① 作用域锁死在那一个 `<article>` 上：首页还有几十条别的帖子，
     *    作用域跑丢就会拿到邻居的文案（v2.7.4 之前就是这样提到页脚文字的）。
     * ② 提完**还原**上下文：首页没有「当前这一条」的概念，
     *    留着会让后续的全局流程（弹层打开、页面切换）误以为还在这一条上。
     * ③ 返回值必须是布尔：`InstagramFeedButtons` 靠它决定按钮闪绿还是闪红。
     *
     * @param {{article: Element, shortcode: string}} target
     * @returns {Promise<boolean>}
     */
    async _onFeedPostExtract(target) {
    const article = target && target.article;
    const code = target && target.shortcode;
    if (!article || !code) return false;

    const prevContext = this.activeContext;
    const prevShortcode = this.activeShortcode;

    // 缓存键按作品编号算（generateCacheKey 见到 shortcode 就用 `<host>/p/<code>`），
    // 所以同一条点两次会命中缓存，不同帖子互不污染。
    this.activeContext = article;
    this.activeShortcode = code;
    try {
      return await this.handleExtract({ feedPost: true });
    } catch (e) {
      safeLog('[MediaExtractor] 首页逐帖提取失败: ' + (e && e.message));
      return false;
    } finally {
      this.activeContext = prevContext;
      this.activeShortcode = prevShortcode;
    }
    },

    /** 当前是不是 IG 首页（判据只有一份，在 `InstagramEntryContext`） */
    _isIgFeedPage() {
    const ctx = (typeof window !== 'undefined') ? window.InstagramEntryContext : null;
    if (!ctx || typeof ctx.isFeedPage !== 'function') return false;
    try {
      return !!ctx.isFeedPage();
    } catch (e) {
      return false;
    }
    },

    /**
     * 按「这一页现在有没有可提取的作品」同步按钮显隐（v2.7.4）
     *
     * 为什么需要：Instagram 注入整站，但作者主页 `/<user>/`、用户 reels 列表
     * `/<user>/reels/`、探索页 `/explore/` 这些**没有单条作品**。v2.7.4 之前这些页面
     * 照样出按钮，真机实测点下去会把**页脚文字**当成文案提出来
     * （`/vladaneslava/reels/` → 本页文案 = 「Meta 旗下其他产品」，作者ID 还是上一条残留）。
     *
     * 与小红书 `_syncXhsRouteVisibility` 同一套写法，同样遵守两条纪律：
     *   · 判定失败 → 当「有作品」处理（宁可多出一个按钮，也别把作品页误藏）；
     *   · 关浮窗写在按钮判断**外面**（浮窗不会跟着按钮走，必须显式关）。
     */
    _syncInstagramEntryVisibility() {
    var ctx = (typeof window !== 'undefined') ? window.InstagramEntryContext : null;
    // 站点门禁：这份 mixin 挂在共享原型上，别的站也会调到，不是 Instagram 就直接返回
    if (!ctx || !ctx.isInstagram()) return;
    var ok = true;
    try {
      // v2.7.20：判据从「有没有作品」换成「有没有内容」——
      // 个人主页 `/<username>/` 没有单条作品，但有整份人物档案可提。
      // 继续用 hasExtractableWork 会把主页的按钮藏掉。
      ok = !!ctx.hasExtractableContent();
    } catch (e) {
      ok = true;   // 判定失败就当可提取
    }

    // 1) 列表页：按钮藏起来，浮窗一起关掉
    if (!ok) {
      var bm0 = this.buttonManager;
      if (bm0 && bm0.button && bm0.isVisible !== false) {
        bm0.setVisible(false);
        this._igEntryHidden = true;
        safeLog('[MediaExtractor] Instagram 列表页：没有单条作品，先把按钮藏起来');
      }
      // v2.7.35：**首页例外** —— 首页永远没有「当前这一条」（ok 恒为 false），
      // 但逐帖按钮提取出来的浮窗是用户亲手点的结果，必须留在屏幕上。
      // 不例外的话，首页随便滚动一下引发的页面变化就会把浮窗关掉，
      // 用户看到的是「点了按钮，浮窗闪一下就没了」。
      if (this._isIgFeedPage()) {
        if (this.feedButtons) this.feedButtons.sync();
        return;
      }
      this._closeIgPanelOnly('Instagram 列表页：没有单条作品，浮窗一起关掉');
      if (this.feedButtons) this.feedButtons.sync();
      return;
    }

    // 2) 回到作品页（弹层打开 / 跳到 /p/<code>/）：只恢复**自己藏起来**的那次，
    //    配置里关掉按钮的用户不擅自给他打开
    var bm = this.buttonManager;
    if (bm && bm.button && this._igEntryHidden) {
      bm.setVisible(true);
      this._igEntryHidden = false;
    }
    // 离开首页时把逐帖按钮撤干净（sync 内部自己判首页，不是首页就摘）
    if (this.feedButtons) this.feedButtons.sync();
    },

    /**
     * 只关浮窗，**不动按钮**（照小红书 `_closeXhsPanelOnly` 同款写法）
     * @param {string} [logMsg]
     */
    _closeIgPanelOnly(logMsg) {
    try {
      if (this.modalManager && this.modalManager.isOpen) {
        this.modalManager.close();
        safeLog('[MediaExtractor] ' + (logMsg || 'Instagram 内容变了，浮窗已关闭（按钮保留）'));
      }
    } catch (e) {
      safeLog('[MediaExtractor] 关闭浮窗失败：' + (e && e.message));
    }
    },

    _onModalPost(root, shortcode) {
    // 弹层开了 → 这一页有作品了，按钮该露出来（v2.7.4）
    this._syncInstagramEntryVisibility();
    this.activeContext = root;
    this.activeShortcode = shortcode;
    this.cacheKey = this.generateCacheKey(window.location.href, shortcode);
    // 面板已开 → 就地刷新（与全局 autoExtract 无关，实现“点一次后自动跟随切换”）
    // 仅“自动开新面板”受全局 autoExtract 控制
    if (this.modalManager && this.modalManager.isOpen) {
      // v2.9.6：开着「换作品时收起浮窗」→ 关窗（用户滑到下一条时不该被上一条的结果挡着）。
      // watcher 已按 shortcode 去重，这里不会被同一条帖子重复触发。
      if (typeof ClipMateBrowseDismiss !== 'undefined' &&
          typeof ClipMateBrowseDismiss.shouldCloseOnSwitch === 'function' &&
          ClipMateBrowseDismiss.shouldCloseOnSwitch()) {
        this._closeIgPanelOnly('换了下一条，浮窗已关闭（按钮保留）');
      } else {
        this._refreshOpenPanel();
      }
    } else if (this.autoExtract) {
      this.handleExtract();
    }
    },

    async _refreshOpenPanel() {
    // v2.7.36：「整页范围」在首页上永远要不得。
    //
    // 真机事故（2026-11-01，用户报「点完是对的，过几秒自己变了」）：首页信息流上，
    // IG 自己每秒都在改 DOM（视频播放、点赞数、懒加载、滚动），`InstagramModalWatcher`
    // 把任何 body 变化都当成 SPA 换页 → 这里被调起来刷新浮窗。但首页没有「当前这一条」，
    // 作用域只能是 `document` —— 整页范围提出来的是**别人**的作者（文档里第一个用户名）、
    // **别处**的文案（信息流里某段长文本，实测是广告的广告语）、第一条的时间，
    // 然后 `updateInPlace` 把用户刚看到的正确结果盖掉。
    //
    // 这条闸守的是「谁调用都一样」：只要作用域是整页、又在首页，一律不刷新。
    // 弹层（`activeContext` 是 dialog 根节点）与详情页不受影响。
    if (this._isIgFeedPage() && (!this.activeContext || this.activeContext === document)) {
      safeLog('[MediaExtractor] 首页没有「当前这一条」，拒绝按整页范围刷新浮窗');
      return;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const data = await this.extractFromCurrentPage(this.activeContext);
        // 判断数据有效性：至少 3 个非空字段才算有效（空结果继续重试）
        if (data && this._isExtractedDataValid(data)) {
          await this.modalManager.updateInPlace(data);
          return;
        }
      } catch (e) {
        safeLog('[MediaExtractor] 就地刷新失败: ' + e.message);
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 500));
    }
    },

    /**
     * 这份结果算不算「有效」——有效才拿去就地刷新浮窗，否则重试。
     *
     * v2.7.5：删掉了「发布日期必须非空」这条门槛。
     * 原因（真机复现 2026-10-30）：Reels 沉浸流上日期恒空（详见 instagram-inline-data.js 头注释），
     * 于是切到下一条时 4 次重试**全部**被这里判无效 → 浮窗一动不动停在旧内容上，
     * 用户看到的就是「站内跳转浮窗不更新」。日期只是七个字段之一，缺它不该让整份结果作废；
     * 以后哪怕某个页面真取不到日期，浮窗也要照常换新，那一格留空即可。
     * （正文这条门槛保留：否则会把主页页脚文字「Meta 旗下其他产品」刷进浮窗。）
     */
    _isExtractedDataValid(data) {
    if (!data || typeof data !== 'object') return false;
    const caption = (data['本页文案'] || '').trim();
    // 正文必须存在且不是个人资料统计（"X 位粉丝 已关注 Y 人 · Z 篇帖子 · 查看 ..."）
    if (!caption || /位粉丝|已关注|篇帖子|查看.+的 Instagram/.test(caption)) return false;
    return true;
    },

    _onModalClose() {
    // 弹层关了 → 退回列表页，按钮与浮窗一起撤（v2.7.4）
    this._syncInstagramEntryVisibility();
    this.activeContext = null;
    this.activeShortcode = null;
    this.cacheKey = this.generateCacheKey(window.location.href);
    },

    _onPageChange() {
    if (this._pageChangeTimer) {
      clearTimeout(this._pageChangeTimer);
    }
    this._pageChangeTimer = setTimeout(() => this._doPageChange(), 500);
    },

    _doPageChange() {
    this._pageChangeTimer = null;
    // 站内跳转（点进 /p/<code>/，或退回 /<user>/）先同步一次按钮显隐（v2.7.4）。
    // 放在最前面：跳到列表页时按钮和浮窗必须立刻撤，不能等后面的提取逻辑。
    this._syncInstagramEntryVisibility();

    // v2.7.36：**首页到此为止**。
    //
    // 首页的「页面变化」几乎全是 IG 自己在动（视频、点赞数、懒加载、滚动出新帖），
    // 一条都不代表用户换了作品。继续往下走会做两件错事：
    //   ① 把 `activeContext` 重置成 `document` 并按整页范围刷新浮窗 ——
    //      真机实测：用户点第 4 条拿到的是「首条的作者 + 广告的文案 + 第一条的日期」，
    //      而且因为与点击自己的提取抢着写，表现为「先对、几秒后被替换」；
    //   ② 开了「自动提取」的用户会在首页无端弹出一份整页范围的垃圾数据。
    //
    // 首页浮窗只认用户亲手点的那颗小按钮（`_onFeedPostExtract`），别的一律不动。
    if (this._isIgFeedPage()) {
      safeLog('[MediaExtractor] Instagram 首页：页面自己在变，浮窗与按钮都不动');
      return;
    }

    this.activeContext = document;
    this.activeShortcode = this._extractShortcodeFromUrl();
    const newKey = this.generateCacheKey(window.location.href, this.activeShortcode);
    // 页面真的换了没有？body 抖动（评论滚动、点赞数变化、懒加载）也会走到这里，
    // 若内容身份没变就不该重建面板——重建会销毁用户选中的文字节点，导致无法复制。
    const sameTarget = newKey === this.cacheKey;
    this.cacheKey = newKey;
    // 面板已开 → 就地刷新
    if (this.modalManager && this.modalManager.isOpen) {
      if (sameTarget) return;
      this._refreshOpenPanel();
    } else if (this.autoExtract) {
      this.handleExtract();
    }
    },

    _extractShortcodeFromUrl() {
    const m = location.pathname.match(/\/(?:p|reels?|tv|stories\/[^\/?#]+\/)\/?([^/?#]+)/);
    return m ? m[1] : null;
    },

  };
})(window);
