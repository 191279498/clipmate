/**
 * 快手「弹层（页内播放）接管中」吗？
 *
 * 由 KuaishouSpaMixin 写（`_activateKuaishouComponents` 置 true、`_deactivateKuaishouImmersive`
 * 置 false），两边都在同一个隔离世界，共用同一个 window。
 *
 * 只在这里读、不在这里判断别的：`isOpen()` 之类的页面判定在 mixin 里，
 * 本文件拿不到 MediaExtractor 实例，只能读它留下的标记。
 *
 * @returns {boolean}
 */
function ksImmersiveActive() {
  try {
    return !!(typeof window !== 'undefined' && window.__clipmateKsImmersiveActive);
  } catch (e) {
    return false;
  }
}

// 提取器工厂类
// 注意：所有提取器类都通过manifest.json作为单独的脚本加载到全局作用域
class ExtractorFactory {
  constructor() {
    this.extractors = {};
    this.registerDefaultExtractors();
  }

  // ===== 提取器注册配置（声明式） =====
  // 映射全局类名 → hostname + mediaType 注册规则
  static EXTRACTOR_CONFIG = [
    { className: 'DoubanBookExtractor', entries: [{ hostname: 'book.douban.com', types: ['book'] }] },
    { className: 'DoubanMovieExtractor', entries: [{ hostname: 'movie.douban.com', types: ['movie', 'tv'] }] },
    { className: 'SteamExtractor', entries: [{ hostname: 'store.steampowered.com', types: ['game'] }] },
    // v2.5.48：原先只注册了 bgm.tv，而同一站点的另外两个域名（bangumi.tv / chii.in）
    // 在游戏、影视上都注册了，唯独书籍漏了 → 这两个域名打开书籍页 100% 提示「未找到」。
    // 三个域名指向同一套页面结构，共用同一个提取器。
    { className: 'BgmBookExtractor', entries: [
      { hostname: 'bgm.tv', types: ['book'] },
      { hostname: 'bangumi.tv', types: ['book'] },
      { hostname: 'chii.in', types: ['book'] }
    ]},
    { className: 'BgmGameExtractor', entries: [
      { hostname: 'bgm.tv', types: ['game'] },
      { hostname: 'bangumi.tv', types: ['game'] },
      { hostname: 'chii.in', types: ['game'] }
    ]},
    { className: 'BgmMovieExtractor', entries: [
      { hostname: 'bgm.tv', types: ['movie', 'tv'] },
      { hostname: 'bangumi.tv', types: ['movie', 'tv'] },
      { hostname: 'chii.in', types: ['movie', 'tv'] }
    ]},
    { className: 'DoubanGameExtractor', entries: [
      { hostname: 'game.douban.com', types: ['game'] },
      { hostname: 'www.douban.com', types: ['game'] }
    ]},
    // v2.7.12：豆瓣影人 / 作者人物页（人物档案 / celebrity 12 列）。
    // 与上面那条共用 www.douban.com，注册表是 hostname → { mediaType → 类 }，
    // 两层键，互不覆盖；具体走哪个由 URL（/personage/ vs /game/）决定。
    { className: 'DoubanCelebrityExtractor', entries: [
      { hostname: 'www.douban.com', types: ['person'] }
    ], log: '豆瓣影人提取器注册成功' },
    { className: 'QidianBookExtractor', entries: [
      { hostname: 'www.qidian.com', types: ['book'] },
      { hostname: 'qidian.com', types: ['book'] }
    ]},
    { className: 'DouyinSocialExtractor', entries: [
      { hostname: 'www.douyin.com', types: ['social'] },
      { hostname: 'v.douyin.com', types: ['social'] }
    ]},
    // v2.7.11：抖音作者个人主页（人物档案 / account 6 列）。
    // 同一域名的两种类型靠 URL 路径区分（`/user/<sec_uid>` 且无 modal_id），
    // 判定在 media-detector 的多规则里，本表只负责"哪个类型用哪个类"。
    { className: 'DouyinProfileExtractor', entries: [
      { hostname: 'www.douyin.com', types: ['person'] }
    ], log: '抖音作者主页提取器注册成功' },
    { className: 'KuaishouSocialExtractor', entries: [{ hostname: 'www.kuaishou.com', types: ['social'] }] },
    // v2.7.17：快手个人主页（人物档案 / account 6 列）。
    // 与上面那条共用 www.kuaishou.com，靠 URL 路径区分（`/profile/<userId>`）；
    // 判定在 media-detector 的多规则里，本表只负责"哪个类型用哪个类"。
    { className: 'KuaishouProfileExtractor', entries: [
      { hostname: 'www.kuaishou.com', types: ['person'] }
    ], log: '快手个人主页提取器注册成功' },
    { className: 'XiaohongshuSocialExtractor', entries: [{ hostname: 'www.xiaohongshu.com', types: ['social'] }] },
    // v2.7.16：小红书个人主页（人物档案 / account 6 列）。
    // 与上面那条共用 www.xiaohongshu.com，靠 URL 路径区分（`/user/profile/<userId>`）；
    // 判定在 media-detector 的多规则里，本表只负责"哪个类型用哪个类"。
    { className: 'XiaohongshuProfileExtractor', entries: [
      { hostname: 'www.xiaohongshu.com', types: ['person'] }
    ], log: '小红书个人主页提取器注册成功' },
    { className: 'InstagramSocialExtractor', entries: [
      // v2.5.64：删掉裸域 instagram.com —— 它既没有 manifest matches 也没有授权，
      // 永远不会注入（裸域访问会 301 跳 www），留着只会让清单对账报「死注册」。
      { hostname: 'www.instagram.com', types: ['social'] }
    ]},
    // v2.7.20：Instagram 个人主页（人物档案 / account 6 列）。
    // 与上面那条共用 www.instagram.com，靠 URL 路径区分（单段 `/<username>/`）；
    // 判定在下面的 urlPatterns 里，本表只负责"哪个类型用哪个类"。
    { className: 'InstagramProfileExtractor', entries: [
      { hostname: 'www.instagram.com', types: ['person'] }
    ], log: 'Instagram 个人主页提取器注册成功' },
    { className: 'WeiboSocialExtractor', entries: [
      { hostname: 'www.weibo.com', types: ['social'] },
      { hostname: 'weibo.com', types: ['social'] },
      // v2.7.40：搜索页独立域名。漏了这条的后果是搜索页落回工厂兜底，
      // 点逐帖按钮时根本拿不到微博提取器（浮窗 6 列全空）。
      { hostname: 's.weibo.com', types: ['social'] }
    ], log: '微博社交媒体提取器注册成功' },
    // v2.7.26：微博个人主页（人物档案 / account 6 列）。
    // 与上面那条共用域名，靠 URL 路径区分（`/u/<数字uid>`、`/<自定义域名>`）；
    // 判定在 media-detector 的多规则与下面的 urlPatterns 里，本表只负责"哪个类型用哪个类"。
    { className: 'WeiboProfileExtractor', entries: [
      { hostname: 'www.weibo.com', types: ['person'] },
      { hostname: 'weibo.com', types: ['person'] }
    ], log: '微博个人主页提取器注册成功' },
    { className: 'WeiboMobileSocialExtractor', entries: [
      { hostname: 'm.weibo.cn', types: ['social'] }
    ], log: '微博移动版社交媒体提取器注册成功' },
    { className: 'XSocialExtractor', entries: [
      { hostname: 'www.x.com', types: ['social'] },
      { hostname: 'x.com', types: ['social'] }
    ], log: '推特社交媒体提取器注册成功' },
    // v2.7.27：X 个人主页（人物档案 / account 6 列）。
    // 与上面那条共用域名，靠 URL 路径区分（`/<handle>`、`/<handle>/about`）；
    // 判定在 media-detector 的多规则与下面的 urlPatterns 里，本表只负责"哪个类型用哪个类"。
    { className: 'XProfileExtractor', entries: [
      { hostname: 'www.x.com', types: ['person'] },
      { hostname: 'x.com', types: ['person'] }
    ], log: 'X个人主页提取器注册成功' },
    { className: 'YouTubeSocialExtractor', entries: [
      { hostname: 'www.youtube.com', types: ['social'] },
      { hostname: 'youtube.com', types: ['social'] }
    ], log: 'YouTube社交媒体提取器注册成功' },
    // v2.7.23：YouTube 频道页（人物档案 / account 6 列）。
    // 与上面那条共用域名，靠 URL 路径区分（`/@<handle>`、`/channel/UC…`）；
    // 判定在 media-detector 的多规则与下面的 urlPatterns 里，本表只负责"哪个类型用哪个类"。
    { className: 'YoutubeProfileExtractor', entries: [
      { hostname: 'www.youtube.com', types: ['person'] },
      { hostname: 'youtube.com', types: ['person'] }
    ], log: 'YouTube频道页（人物档案）提取器注册成功' },
    { className: 'TikTokSocialExtractor', entries: [
      { hostname: 'www.tiktok.com', types: ['social'] },
      { hostname: 'tiktok.com', types: ['social'] }
    ], log: 'TikTok社交媒体提取器注册成功' },
    // v2.7.22：TikTok 个人主页（人物档案 / account 6 列）。
    // 与上面那条共用域名，靠 URL 路径区分（`/@<handle>` 单段）；
    // 判定在 media-detector 的多规则与下面的 urlPatterns 里，本表只负责"哪个类型用哪个类"。
    { className: 'TikTokProfileExtractor', entries: [
      { hostname: 'www.tiktok.com', types: ['person'] },
      { hostname: 'tiktok.com', types: ['person'] }
    ], log: 'TikTok 个人主页提取器注册成功' },
    { className: 'BilibiliSocialExtractor', entries: [
      { hostname: 'www.bilibili.com', types: ['social'] },
      { hostname: 'bilibili.com', types: ['social'] }
    ], log: 'B站社交媒体提取器注册成功' },
    // v2.7.28：B站个人空间（人物档案 / account 6 列）。
    // 独立域名 space.bilibili.com —— 原先压根没注入扩展，v2.7.28 才新增；
    // 与上面的作品页 www.bilibili.com 完全不搭界，不存在 person/social 顺序问题。
    { className: 'BilibiliProfileExtractor', entries: [
      { hostname: 'space.bilibili.com', types: ['person'] }
    ], log: 'B站个人空间提取器注册成功' },
    { className: 'ImdbExtractor', entries: [
      { hostname: 'www.imdb.com', types: ['movie', 'tv'] }
    ], log: 'IMDb影视提取器注册成功' },
    { className: 'TmdbExtractor', entries: [
      { hostname: 'www.themoviedb.org', types: ['movie', 'tv'] }
    ], log: 'TMDB影视提取器注册成功' },
    { className: 'FanqieBookExtractor', entries: [
      { hostname: 'fanqienovel.com', types: ['book'] }
    ], log: '番茄小说提取器注册成功' },
    { className: 'Book17kExtractor', entries: [
      { hostname: 'www.17k.com', types: ['book'] }
    ], log: '17K小说网提取器注册成功' },
    { className: 'GoodreadsBookExtractor', entries: [
      { hostname: 'www.goodreads.com', types: ['book'] }
    ], log: 'Goodreads 提取器注册成功' },
    // Metacritic 游戏（只认详情页 /game/<游戏名>/，子页由 manifest 的 exclude_matches 挡掉）
    { className: 'MetacriticGameExtractor', entries: [
      { hostname: 'www.metacritic.com', types: ['game'] }
    ], log: 'Metacritic 游戏提取器注册成功' },
    // 小黑盒游戏（只认 /app/topic/game/pc/<appid>；ps5|switch|xbox 都是空壳页，子页 /intro 会重定向）
    { className: 'XiaoheiheGameExtractor', entries: [
      { hostname: 'www.xiaoheihe.cn', types: ['game'] }
    ], log: '小黑盒游戏提取器注册成功' },
    // MobyGames 游戏（只认详情页 /game/<数字ID>/<slug>/，17 种子页由 manifest 的 exclude_matches 挡掉）
    { className: 'MobygamesGameExtractor', entries: [
      { hostname: 'www.mobygames.com', types: ['game'] }
    ], log: 'MobyGames 游戏提取器注册成功' },
    // 红果短剧（v2.11.0）：全站都是**影视 / 剧集**，所以注册成 tv 而不是 movie ——
    // 「影视类型」字段据此写「剧集」（见各影视提取器的 mediaType === 'movie' ? '电影' : '剧集'）。
    // 三个域名共用同一套数据：不带 www 的 hongguoduanju.com、带 www 的、以及
    // 实测会跳到主域的 www.novelquickapp.com。
    { className: 'HongguoMovieExtractor', entries: [
      { hostname: 'hongguoduanju.com', types: ['tv'] },
      { hostname: 'www.hongguoduanju.com', types: ['tv'] },
      { hostname: 'www.novelquickapp.com', types: ['tv'] }
    ], log: '红果短剧提取器注册成功' }
  ];

  // 注册默认的提取器
  registerDefaultExtractors() {
    for (const config of ExtractorFactory.EXTRACTOR_CONFIG) {
      const ExtractorClass = window[config.className];
      if (!ExtractorClass) continue;

      for (const entry of config.entries) {
        for (const type of entry.types) {
          this.registerExtractor(entry.hostname, type, ExtractorClass);
        }
      }

    }
  }

  // 注册提取器
  registerExtractor(hostname, mediaType, extractorClass) {
    if (!this.extractors[hostname]) {
      this.extractors[hostname] = {};
    }
    this.extractors[hostname][mediaType] = extractorClass;
  }

  // 获取提取器
  getExtractor(hostname, mediaType) {
    // 精确匹配
    const siteExtractors = this.extractors[hostname];
    if (siteExtractors && siteExtractors[mediaType]) {
      // v2.5.77 抖音「弹窗播放」岔路口：只有「现在确实在弹窗里」才改用子类，
      // 其余情况（详情页、短链、非弹窗的任何页面）原样返回父类实例，行为与以前逐字一致。
      const modalClass = this._pickDouyinModalClass(hostname, mediaType);
      if (modalClass) return new modalClass();
      // v2.5.82 快手推荐流岔路口：只有「当前确实在 /new-reco 且认出了正在播的那一条」才改用它
      const ksClass = this._pickKuaishouImmersiveClass(hostname, mediaType);
      if (ksClass) return new ksClass();
      return new siteExtractors[mediaType]();
    }
    
    return null;
  }

  /**
   * 抖音「弹窗 / 沉浸流」专用提取器选择（v2.5.77 立，v2.5.80 扩展到沉浸流）
   *
   * 五道条件缺一不可，任何一道不满足都返回 null（= 用父类，今天的行为）：
   *   1. 站点是 www.douyin.com 且类型 social
   *   2. 子类脚本已加载（脚本没加载/被删掉时自动退回父类）
   *   3. 本次会话这一种模式没有被熔断（弹窗 / 沉浸流各算各的）
   *   4. 当前页面确实认出了「正在播的那一条」（DouyinModalContext.isOpen）
   *   5. 判定本身不抛错（try/catch 兜住，抛了就退回父类）
   *
   * @returns {Function|null} 提取器类
   */
  _pickDouyinModalClass(hostname, mediaType) {
    try {
      if (hostname !== 'www.douyin.com' || mediaType !== 'social') return null;
      if (typeof window === 'undefined') return null;
      const ModalClass = window.DouyinModalExtractor;
      if (!ModalClass || typeof ModalClass !== 'function') return null;
      const ctx = window.DouyinModalContext;
      if (!ctx || typeof ctx.isOpen !== 'function') return null;
      if (!ctx.isOpen()) return null;
      // 认得是哪一种态，才能只查那一种态的熔断（互不牵连）
      const mode = (typeof ctx.playbackMode === 'function' && ctx.playbackMode()) || 'modal';
      if (typeof ModalClass.isDisabled === 'function' && ModalClass.isDisabled(mode)) return null;
      return ModalClass;
    } catch (e) {
      return null;
    }
  }

  /**
   * 快手「推荐流」专用提取器选择（v2.5.82）
   *
   * 四道条件缺一不可，任何一道不满足都返回 null（= 用父类，今天的行为）：
   *   1. 站点是 www.kuaishou.com 且类型 social
   *   2. 子类脚本已加载（脚本没加载/被删掉时自动退回父类）
   *   3. 本次会话推荐流提取没被熔断
   *   4. 当前页面确实在 `/new-reco` 并认出了「正在播的那一条」
   *
   * 详情页 / 网格页 / 主页：第 4 条不成立（pathname 白名单 + 认得出当前条），
   * 一律走父类 `KuaishouSocialExtractor`，与 v2.5.81 逐字一致。
   *
   * @returns {Function|null} 提取器类
   */
  _pickKuaishouImmersiveClass(hostname, mediaType) {
    try {
      if (hostname !== 'www.kuaishou.com' || mediaType !== 'social') return null;
      if (typeof window === 'undefined') return null;
      const Cls = window.KuaishouImmersiveExtractor;
      if (!Cls || typeof Cls !== 'function') return null;
      const ctx = window.KuaishouImmersiveContext;
      if (!ctx || typeof ctx.isOpen !== 'function') return null;
      if (!ctx.isOpen()) return null;
      if (typeof Cls.isDisabled === 'function' && Cls.isDisabled()) return null;
      return Cls;
    } catch (e) {
      return null;
    }
  }

  // 根据当前URL获取合适的提取器
  getExtractorByUrl(url) {    const urlPatterns = [
      { pattern: /book\.douban\.com\/subject\//, hostname: 'book.douban.com', mediaType: 'book' },
      { pattern: /movie\.douban\.com\/subject\//, hostname: 'movie.douban.com', mediaType: 'movie' },
      { pattern: /game\.douban\.com\/subject\//, hostname: 'game.douban.com', mediaType: 'game' },
      { pattern: /www\.douban\.com\/game\//, hostname: 'www.douban.com', mediaType: 'game' },
      // v2.7.12：豆瓣影人 / 作者人物页（人物档案 / celebrity 12 列）。
      // 旧的 movie.douban.com/celebrity/<id>/ 已 301 跳到 www.douban.com/personage/<id>/，
      // 这里只认新地址；旧的不用管，浏览器先跳转再跑内容脚本。
      { pattern: /www\.douban\.com\/personage\//, hostname: 'www.douban.com', mediaType: 'person' },
      { pattern: /store\.steampowered\.com\/app\//, hostname: 'store.steampowered.com', mediaType: 'game' },
      { pattern: /bgm\.tv\/subject\//, hostname: 'bgm.tv', mediaType: 'auto' },
      { pattern: /bangumi\.tv\/subject\//, hostname: 'bangumi.tv', mediaType: 'auto' },
      { pattern: /chii\.in\/subject\//, hostname: 'chii.in', mediaType: 'auto' },
      // 添加起点中文网书籍URL模式
      { pattern: /www\.qidian\.com\/book\//, hostname: 'www.qidian.com', mediaType: 'book' },
      { pattern: /qidian\.com\/book\//, hostname: 'qidian.com', mediaType: 'book' },
      // v2.7.11：抖音作者个人主页（人物档案 / account）。
      // **必须排在下面那条 `/www.douyin.com/` 之前** —— 那条匹配任意抖音路径，
      // 放后面的话 /user/<sec_uid> 会被它先吃掉，主页永远走作品提取器。
      // 带 `?modal_id=` 时是「在主页上点开的作品弹窗」，这条不认（excludeQuery），
      // 落回下面那条 social → 由 getExtractor 里的 _pickDouyinModalClass 接管。
      { pattern: /www\.douyin\.com\/user\//, hostname: 'www.douyin.com', mediaType: 'person', excludeQuery: ['modal_id'] },
      // 添加抖音社交媒体URL模式（支持视频和笔记页面）
      { pattern: /www\.douyin\.com\//, hostname: 'www.douyin.com', mediaType: 'social' },
      { pattern: /v\.douyin\.com\//, hostname: 'v.douyin.com', mediaType: 'social' },
      // v2.7.17：快手个人主页（人物档案 / account）。
      // **必须排在下面两条作品页规则之前**（同理抖音那条）：
      // `/profile/<id>` 与 `/short-video/` 不重叠，但排序显式一点更稳。
      // 注意：主页上点开作品弹层时地址仍是 `/profile/<id>`，这条会先命中 person；
      // 那种态由 KuaishouSpaMixin 在接管后把 mediaType 切成 social（见 _kuaishouOverrideType）。
      { pattern: /www\.kuaishou\.com\/profile\/[A-Za-z0-9_-]{6,64}/, hostname: 'www.kuaishou.com', mediaType: 'person' },
      // 添加快手社交媒体URL模式（一比一复刻抖音配置）
      { pattern: /www\.kuaishou\.com\/short-video\//, hostname: 'www.kuaishou.com', mediaType: 'social' },
      { pattern: /www\.kuaishou\.com\/video\//, hostname: 'www.kuaishou.com', mediaType: 'social' },
      // v2.7.16：小红书个人主页（人物档案 / account）。
      // **必须排在下面那条作品页规则之前** —— 两条都匹配 `www.xiaohongshu.com/`，
      // 顺序反了主页就永远走作品提取器（那条只认 /explore//discovery，其实不会命中主页，
      // 但排序显式一点，将来加规则的人不会踩）。
      { pattern: /www\.xiaohongshu\.com\/user\/profile\/[0-9a-fA-F]{24}/, hostname: 'www.xiaohongshu.com', mediaType: 'person' },
      // 添加小红书社交媒体URL模式
      // v2.6.0：改成「必须带 24 位笔记 ID」。原来写的是 /explore/ 字面量，
      // 顺带把列表页 `/explore` 也放过去了（注入命中但提取器认不出 → 点按钮报错）。
      // 现在列表页明确返回 null，由 xiaohongshu-spa-handler 负责把按钮藏掉。
      { pattern: /www\.xiaohongshu\.com\/(?:explore|discovery\/item)\/[0-9a-f]{24}/i, hostname: 'www.xiaohongshu.com', mediaType: 'social' },
      // v2.7.20：Instagram 个人主页 `/<username>/`（人物档案 / account 6 列）。
      // **必须排在下面那条 `www\.instagram\.com\/` 之前**，否则永远命中 social（那条匹配任意路径）。
      //
      // 三条限定，缺一条都会误伤：
      //   ① 只认**单段路径** —— `/<username>/`，多段的 `/p/<code>/`、`/<user>/reels/`、
      //      `/stories/<user>/<id>/` 都不是主页（后面 `[A-Za-z0-9_.]+\/?(?:[?#]|$)` 自带这个约束）；
      //   ② 负向先行排除 IG 的一级功能路由（`/explore/`、`/p/`、`/settings/` …）——
      //      不加就会把探索页当成"某个叫 explore 的人的主页"；
      //   ③ 允许 `?hl=zh-cn`、`?igsh=…` 这类尾巴（`\/?(?:[?#]|$)`），
      //      否则从分享链接点进来会认不出。
      {
        pattern: /www\.instagram\.com\/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)\/?(?:[?#]|$))[A-Za-z0-9_.]+\/?(?:[?#]|$)/,
        hostname: 'www.instagram.com',
        mediaType: 'person'
      },
      // 添加Instagram社交媒体URL模式 - 支持所有Instagram网址
      { pattern: /www\.instagram\.com\//, hostname: 'www.instagram.com', mediaType: 'social' },
      // 添加微博社交媒体URL模式
      // v2.7.40：搜索页 `s.weibo.com` 必须排在**所有** `weibo.com` 规则之前。
      // 因为它自身也含 `weibo.com/` 这段字符，排后面会被 `weibo.com/u/…` 之类的
      // person 规则先吃掉（搜索页没有主页，但通配规则照样会命中）。
      { pattern: /s\.weibo\.com\//, hostname: 's.weibo.com', mediaType: 'social' },
      // v2.7.26：个人主页（`/u/<数字uid>`、`/<自定义域名>`）→ 人物档案 / account 6 列。
      // **必须排在下面两条 `weibo.com/` 通配 social 之前** —— 那两条匹配任意路径，
      // social 在前会把主页一起吃成社交（抖音 /user/、IG 单段、TikTok /@、YouTube /@ 同一个坑）。
      // 自定义域名那条用负向断言排掉一级功能路由，与 media-detector 的 regex 同一口径。
      { pattern: /www\.weibo\.com\/u\/\d{5,20}\/?(?:[?#]|$)/, hostname: 'www.weibo.com', mediaType: 'person' },
      { pattern: /www\.weibo\.com\/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:[\/?#]|$))[A-Za-z][A-Za-z0-9_-]{1,29}\/?(?:[?#]|$)/, hostname: 'www.weibo.com', mediaType: 'person' },
      { pattern: /weibo\.com\/u\/\d{5,20}\/?(?:[?#]|$)/, hostname: 'weibo.com', mediaType: 'person' },
      { pattern: /weibo\.com\/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:[\/?#]|$))[A-Za-z][A-Za-z0-9_-]{1,29}\/?(?:[?#]|$)/, hostname: 'weibo.com', mediaType: 'person' },
      { pattern: /www\.weibo\.com\//, hostname: 'www.weibo.com', mediaType: 'social' },
      { pattern: /weibo\.com\//, hostname: 'weibo.com', mediaType: 'social' },
      // 微博移动版（v2.5.64 补：此前 m.weibo.cn 没有任何 urlPattern，
      // 只能靠工厂兜底，路由不稳）
      { pattern: /m\.weibo\.cn\//, hostname: 'm.weibo.cn', mediaType: 'social' },
      // 添加推特(X)社交媒体URL模式
      // v2.7.27：X 个人主页（`/<handle>` 单段、`/<handle>/about`）→ 人物档案。
      // **必须排在下面两条 `x.com/` 通配 social 之前** —— 那两条匹配任意路径，
      // 放后面主页永远走作品提取器（微博 /u/、抖音 /user/、IG 单段同一个坑）。
      // 与 media-detector 的 person 正则同口径：单段 handle（字母数字下划线，
      // 负向断言排掉 /home /search /i/… 功能路由）与 /about 子页；
      // `/<handle>/status/<id>` 不匹配这里，照旧走 social。
      { pattern: /www\.x\.com\/(?!home(?:\/|$)|explore(?:\/|$)|search(?:\/|$)|i(?:\/|$)|settings(?:\/|$)|notifications(?:\/|$)|messages(?:\/|$)|compose(?:\/|$)|intent(?:\/|$)|personalize(?:\/|$)|privacy(?:\/|$)|tos(?:\/|$)|login(?:\/|$)|signup(?:\/|$)|logout(?:\/|$)|session(?:\/|$)|account(?:\/|$)|share(?:\/|$)|hashtag(?:\/|$)|trends(?:\/|$)|dev(?:\/|$)|jobs(?:\/|$)|help(?:\/|$)|welcome(?:\/|$)|verify(?:\/|$)|flow(?:\/|$)|articles(?:\/|$)|events(?:\/|$)|browse(?:\/|$))[A-Za-z0-9_]{1,15}\/?(?:[?#]|$)/, hostname: 'www.x.com', mediaType: 'person' },
      { pattern: /x\.com\/(?!home(?:\/|$)|explore(?:\/|$)|search(?:\/|$)|i(?:\/|$)|settings(?:\/|$)|notifications(?:\/|$)|messages(?:\/|$)|compose(?:\/|$)|intent(?:\/|$)|personalize(?:\/|$)|privacy(?:\/|$)|tos(?:\/|$)|login(?:\/|$)|signup(?:\/|$)|logout(?:\/|$)|session(?:\/|$)|account(?:\/|$)|share(?:\/|$)|hashtag(?:\/|$)|trends(?:\/|$)|dev(?:\/|$)|jobs(?:\/|$)|help(?:\/|$)|welcome(?:\/|$)|verify(?:\/|$)|flow(?:\/|$)|articles(?:\/|$)|events(?:\/|$)|browse(?:\/|$))[A-Za-z0-9_]{1,15}\/?(?:[?#]|$)/, hostname: 'x.com', mediaType: 'person' },
      { pattern: /www\.x\.com\/[A-Za-z0-9_]{1,15}\/about\/?(?:[?#]|$)/, hostname: 'www.x.com', mediaType: 'person' },
      { pattern: /x\.com\/[A-Za-z0-9_]{1,15}\/about\/?(?:[?#]|$)/, hostname: 'x.com', mediaType: 'person' },
      { pattern: /www\.x\.com\//, hostname: 'www.x.com', mediaType: 'social' },
      { pattern: /x\.com\//, hostname: 'x.com', mediaType: 'social' },
      // 添加YouTube社交媒体URL模式
      // v2.7.23：频道页（个人主页）→ 人物档案 / account 6 列。
      // **必须排在下面两条 `youtube.com/` 通配 social 之前** —— 那两条匹配任意路径，
      // 放后面主页永远走作品提取器（抖音 /user/、IG 单段、TikTok /@ 同一个坑）。
      // 与 media-detector 的 person 正则同口径：只认 `@handle` 和 `channel/UC…`（含子页），
      // `/watch`、`/shorts/<id>` 不匹配这里，照旧走 social。
      { pattern: /www\.youtube\.com\/(?:@[A-Za-z0-9._-]{2,40}|channel\/UC[A-Za-z0-9_-]{10,40})(?:\/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?\/?(?:[?#]|$)/, hostname: 'www.youtube.com', mediaType: 'person' },
      { pattern: /www\.youtube\.com\//, hostname: 'www.youtube.com', mediaType: 'social' },
      { pattern: /youtube\.com\/(?:@[A-Za-z0-9._-]{2,40}|channel\/UC[A-Za-z0-9_-]{10,40})(?:\/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?\/?(?:[?#]|$)/, hostname: 'youtube.com', mediaType: 'person' },
      { pattern: /youtube\.com\//, hostname: 'youtube.com', mediaType: 'social' },
      // v2.7.22：TikTok 个人主页 `/@<handle>`（**单段**，后面不带 /video/ 或 /photo/）。
      // **必须排在下面两条 `tiktok.com/` 通配 social 之前** —— 那两条匹配任意路径，
      // 放后面主页永远走作品提取器（抖音 /user/、IG 单段路径都是同一个坑）。
      // 三条限定：① `@` 后只能是一段账号名；② 结尾只能是 `/` 或查询串/锚点；
      //          ③ 因此 `/@user/video/123`、`/@user/photo/123` 不会被误认成主页。
      { pattern: /www\.tiktok\.com\/@[A-Za-z0-9_.]{2,40}\/?(?:[?#]|$)/, hostname: 'www.tiktok.com', mediaType: 'person' },
      // 添加TikTok社交媒体URL模式
      { pattern: /www\.tiktok\.com\//, hostname: 'www.tiktok.com', mediaType: 'social' },
      { pattern: /tiktok\.com\/@[A-Za-z0-9_.]{2,40}\/?(?:[?#]|$)/, hostname: 'tiktok.com', mediaType: 'person' },
      { pattern: /tiktok\.com\//, hostname: 'tiktok.com', mediaType: 'social' },
      // 添加B站个人空间URL模式（v2.7.28：`space.bilibili.com/<mid>` 及空间自己的 tab 子页）
      { pattern: /space\.bilibili\.com\/\d{1,15}(?:\/(?:dynamic|upload|lists|pugv|series|channels|favlist|following|fans|article|audio|album|comic|bangumi|cheese|video))?\/?(?:[?#]|$)/, hostname: 'space.bilibili.com', mediaType: 'person' },
      // 添加B站社交媒体URL模式
      { pattern: /www\.bilibili\.com\/video\//, hostname: 'www.bilibili.com', mediaType: 'social' },
      { pattern: /bilibili\.com\/video\//, hostname: 'bilibili.com', mediaType: 'social' },
      { pattern: /www\.bilibili\.com\/bangumi\/play\//, hostname: 'www.bilibili.com', mediaType: 'social' },
      { pattern: /bilibili\.com\/bangumi\/play\//, hostname: 'bilibili.com', mediaType: 'social' },
      // IMDb 电影/剧集 URL 模式
      { pattern: /www\.imdb\.com\/title\//, hostname: 'www.imdb.com', mediaType: 'movie' },
      // TMDB 电影/剧集 URL 模式（剧集必须走 /tv/ 才能拿到 tv 类型）
      { pattern: /www\.themoviedb\.org\/movie\//, hostname: 'www.themoviedb.org', mediaType: 'movie' },
      { pattern: /www\.themoviedb\.org\/tv\//, hostname: 'www.themoviedb.org', mediaType: 'tv' },
      // 番茄小说 URL 模式
      { pattern: /fanqienovel\.com\/page\//, hostname: 'fanqienovel.com', mediaType: 'book' },
      // 17K小说网 URL 模式（详情页 /book/<id>.html）
      { pattern: /www\.17k\.com\/book\//, hostname: 'www.17k.com', mediaType: 'book' },
      // Goodreads URL 模式（书籍详情页 /book/show/<id>，排除 /editions 版本列表页）
      { pattern: /www\.goodreads\.com\/book\/show\/[^/?#]+\/?(?:[?#]|$)/, hostname: 'www.goodreads.com', mediaType: 'book' },
      // Metacritic 游戏 URL 模式（详情页 /game/<游戏名>/ 一层；
      // 排除 /critic-reviews/ /user-reviews/ /details/ 子页与 /game/ 列表页，
      // 与 manifest 的 exclude_matches 双保险）
      { pattern: /www\.metacritic\.com\/game\/[^/?#]+\/?(?:[?#]|$)/, hostname: 'www.metacritic.com', mediaType: 'game' },

      // 小黑盒游戏 URL 模式（/app/topic/game/pc/<数字 appid>，必须恰好一层；
      // 平台只认 pc，其余平台是空壳页；子页由 exclude_matches 与这里的 $ 双保险）
      { pattern: /www\.xiaoheihe\.cn\/app\/topic\/game\/pc\/\d+\/?(?:[?#]|$)/, hostname: 'www.xiaoheihe.cn', mediaType: 'game' },

      // MobyGames 游戏 URL 模式（详情页 /game/<数字ID>/<slug>/，恰好两层；
      // 17 种子页与 /game/ 列表页由 manifest 的 exclude_matches 先挡一层，
      // 这里再用 id+slug 的严格形态兜一层）
      { pattern: /www\.mobygames\.com\/game\/\d+\/[^/?#]+\/?(?:[?#]|$)/, hostname: 'www.mobygames.com', mediaType: 'game' },

      // 红果短剧（v2.11.0）：只认详情页 /detail?series_id=…
      // 首页 / 榜单 / 分类 / 播放页 manifest 都不注入，这里再卡一道路径。
      // 三个域名共用（www.novelquickapp.com 实测会跳主域，用户要求一起认）。
      { pattern: /^https:\/\/hongguoduanju\.com\/detail(?:[?#]|$)/, hostname: 'hongguoduanju.com', mediaType: 'tv' },
      { pattern: /^https:\/\/www\.hongguoduanju\.com\/detail(?:[?#]|$)/, hostname: 'www.hongguoduanju.com', mediaType: 'tv' },
      { pattern: /^https:\/\/www\.novelquickapp\.com\/detail(?:[?#]|$)/, hostname: 'www.novelquickapp.com', mediaType: 'tv' }
    ];

    for (const { pattern, hostname, mediaType, excludeQuery } of urlPatterns) {
      if (pattern.test(url)) {
        // v2.7.11：排除参数（抖音 `/user/<id>?modal_id=` 是作品弹窗，不是作者主页）。
        // 命中排除项就跳过这一条，继续往下试 —— 绝不能直接 return null，
        // 否则弹窗态会丢掉 social 提取器。
        if (Array.isArray(excludeQuery) && excludeQuery.some((key) =>
          new RegExp('[?&]' + String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=').test(url)
        )) {
          continue;
        }

        // v2.7.18：快手主页上点开作品是**盖一层弹层、地址不变**（仍是 `/profile/<id>`），
        // 所以上面那条 person 规则在弹层态下照样命中 —— 而此时 fieldMapper 已被
        // KuaishouSpaMixin 切成 social 的 7 列，人物提取器（6 列）填进去，
        // 只有「作者昵称」能对上，其余作品字段全空（v2.7.17 真机实测就是这个症状）。
        //
        // 抖音不存在这个问题：它的弹层地址会带 `?modal_id=`，用上面的 excludeQuery 排除即可。
        // 快手只能靠「弹层接管中」这个运行时标记（KuaishouSpaMixin 接管成功时写、
        // 撤下时清），命中就跳过这条，落回下面的 social 规则。
        if (mediaType === 'person' && hostname === 'www.kuaishou.com' && ksImmersiveActive()) {
          continue;
        }

        // 对于番组计划站点，需要根据页面内容确定媒体类型
        if (mediaType === 'auto') {
          const detector = new window.MediaTypeDetector();
          const detectedType = detector.detect(url, document);
          return this.getExtractor(hostname, detectedType);
        }
        return this.getExtractor(hostname, mediaType);
      }
    }

    return null;
  }
}

// 导出工厂类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExtractorFactory;
} else {
  window.ExtractorFactory = ExtractorFactory;
}