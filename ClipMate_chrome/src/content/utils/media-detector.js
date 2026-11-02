// 媒体类型检测器
class MediaTypeDetector {
  constructor() {
    this.siteConfigs = null;
    this.loadConfigs();
  }

  async loadConfigs() {
    // 动态加载配置文件
    try {
      const response = await WBR.runtime.sendMessage({
        action: 'getMediaConfigs'
      });
      this.siteConfigs = response.configs;
    } catch (error) {
      console.error('Failed to load media configs:', error);
      // 使用默认配置
      this.siteConfigs = this.getDefaultConfigs();
    }
  }

  getDefaultConfigs() {
    return {
      'book.douban.com': {
        type: 'book',
        patterns: ['/subject/']
      },
      'movie.douban.com': {
        type: 'movie',
        patterns: ['/subject/']
      },
      'www.douban.com': {
        // v2.7.12：www.douban.com 现在挂两种东西 —— 游戏页与**影人/作者人物页**。
        // 影人页地址是 /personage/<数字>/（旧的 movie.douban.com/celebrity/<id>/
        // 已 301 跳到这里）。person 规则必须排在 game 之前？不必 —— 两套 pattern
        // 没有交集，但按「更具体在前」的习惯写，避免将来加宽 pattern 时踩顺序坑。
        rules: [
          { type: 'person', patterns: ['/personage/'] },
          { type: 'game', patterns: ['/game/'] }
        ]
      },
      'game.douban.com': {
        type: 'game',
        patterns: ['/subject/']
      },
      'bgm.tv': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'bangumi.tv': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'chii.in': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'www.qidian.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'qidian.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'store.steampowered.com': {
        type: 'game',
        patterns: ['/app/']
      },
      'www.imdb.com': {
        type: 'movie',
        patterns: ['/title/']
      },
      'www.themoviedb.org': {
        type: 'movie',
        patterns: ['/movie/', '/tv/']
      },
      'fanqienovel.com': {
        type: 'book',
        patterns: ['/page/']
      },
      'www.17k.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'www.goodreads.com': {
        type: 'book',
        patterns: ['/book/show/']
      },
      'www.metacritic.com': {
        type: 'game',
        patterns: ['/game/']
      },
      'www.xiaoheihe.cn': {
        type: 'game',
        patterns: ['/app/topic/game/pc/']
      },
      'www.mobygames.com': {
        type: 'game',
        patterns: ['/game/']
      },
      'www.douyin.com': {
        // v2.7.11：抖音改多规则 —— `/user/<sec_uid>` 是作者个人主页（人物档案），
        // 但同一个路径**带 `?modal_id=` 时是作品弹窗**（在主页上点开一条视频就是它），
        // 所以 person 那条必须排除 modal_id；排除后落到下面 social 那条，
        // 又因为 pathname 是 /user/ 而不是 /video/，social 也不命中 → 整体返回 null
        // → 交给 content-main 的 `_douyinModalOverrideType()` 补认（v2.5.77 起的既有行为，
        //   刻意保留：弹窗态在 init 阶段不出按钮，接管之后才出）。
        rules: [
          { type: 'person', patterns: ['/user/'], excludeQuery: ['modal_id'] },
          { type: 'social', patterns: ['/video/', '/note/'] }
        ],
        // 与 background.getMediaConfigs 保持一致：路径不对就放弃，不按正文猜类型
        noContentFallback: true
      },
      'v.douyin.com': {
        type: 'social',
        patterns: ['/']
      },
      'www.kuaishou.com': {
        // v2.7.17：拆成多规则 —— `/profile/<userId>` 是**个人主页**（人物档案 / account），
        // `/short-video/<id>` 与 `/video/<id>` 才是作品页（社交）。
        //
        // ⚠️ 与抖音/小红书不同：快手主页上点开一条作品是**盖一层播放弹层、地址不变**
        //    （仍是 `/profile/<id>`），没法用地址区分。那种态归**作品**（social），
        //    由 KuaishouSpaMixin 在接管后经 `_kuaishouOverrideType()` 补认 ——
        //    用户 2026-10-31 拍板「跟抖音一样：弹层优先提作品」。
        //    这份配置与 background.getMediaConfigs() 必须逐字对齐。
        rules: [
          { type: 'person', patterns: ['/profile/'] },
          { type: 'social', patterns: ['/short-video/', '/video/'] }
        ]
        // ⚠️ 这里**刻意不写** noContentFallback：
        //    快手这份配置原本就没有它（不匹配时退回按正文猜类型），
        //    加上会让 `/new-reco` 等页面从「猜」变成「直接放弃」，属于行为变更，
        //    与本次需求无关，不做。（抖音/小红书那份本来就有，照旧保留。）
      },
      'www.instagram.com': {
        // v2.7.20：拆成多规则 —— 单段路径 `/<username>/` 是**个人主页**（人物档案 / account），
        // 其余（`/p|reel|reels|tv/<code>/`、`/stories/…`）是作品页（社交）。
        //
        // 主页没有固定路径前缀，"includes" 表达不了，所以这条用 `regex`（_ruleMatches 支持）。
        // 负向先行排除 IG 的一级功能路由：不加的话 `/explore/` 会被当成"某个叫 explore 的人的主页"。
        // 这段正则与 extractor-factory 的 urlPatterns 必须**同一口径**（那边测整条 URL，这边测 pathname）。
        // 这份配置与 background.getMediaConfigs() 必须逐字对齐。
        rules: [
          {
            type: 'person',
            regex: '^/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)/?(?:[?#]|$))[A-Za-z0-9_.]+/?(?:[?#]|$)'
          },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'www.xiaohongshu.com': {
        // v2.7.16：拆成多规则 —— `/user/profile/<userId>` 是**个人主页**（人物档案 / account），
        // `/explore/<笔记ID>` 与 `/discovery/item/<笔记ID>` 才是作品页（社交）。
        // 两者路径前缀完全不重叠，不需要 excludeQuery。
        // 这份配置与 background.getMediaConfigs() 必须逐字对齐。
        rules: [
          { type: 'person', patterns: ['/user/profile/'] },
          { type: 'social', patterns: ['/discovery/item/', '/explore/'] }
        ]
      },
      // v2.7.26：微博拆多规则 —— `/u/<数字uid>` 与 `/<自定义域名>` 是**个人主页**
      // （人物档案 / account），`/u/<uid>/<mid>`（单条微博）、`/detail/…` 等仍是作品页。
      // 顺序不能反：person 那条与 social 的 `patterns: ['/']` 完全重叠，social 在前会把主页
      // 一起吃成社交（抖音 /user/、IG 单段、TikTok /@、YouTube /@ 同一个坑）。
      // 自定义域名那条用负向断言排掉一级功能路由（`/hot`、`/tv`、`/login`…），
      // 否则这些页面会被当成人物档案。
      // 这份配置与 background.getMediaConfigs() 必须逐字对齐。
      'www.weibo.com': {
        rules: [
          { type: 'person', regex: '^/u/\\d{5,20}/?$' },
          { type: 'person', regex: '^/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:/|$))[A-Za-z][A-Za-z0-9_-]{1,29}/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'weibo.com': {
        rules: [
          { type: 'person', regex: '^/u/\\d{5,20}/?$' },
          { type: 'person', regex: '^/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:/|$))[A-Za-z][A-Za-z0-9_-]{1,29}/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      // v2.7.40：微博搜索页是独立域名（`s.weibo.com`）。原先这份配置里没有它，
      // 于是搜索页虽然挂上了逐帖按钮，点下去却按「整页通用提取」跑 —— 浮窗 6 列全空。
      // 搜索页只有一种形态（整页都是博文），所以单条 social 就够，不需要 person 规则。
      // 这份配置与 background.getMediaConfigs() 必须逐字对齐。
      's.weibo.com': {
        type: 'social',
        patterns: ['/']
      },
      'm.weibo.cn': {
        type: 'social',
        patterns: ['/']
      },
      // v2.7.27：X 拆多规则 —— 个人主页 `/<handle>`（单段）与 `/<handle>/about` → 人物档案；
      // 其余（`/<handle>/status/<id>` 单条推文、`/home`、`/search`、`/i/*` 等功能页）→ 社交。
      // 顺序不能反：person 那条正则是 social 的 `patterns: ['/']` 的子集，
      // social 在前会把主页一起吃成社交（微博 /u/、抖音 /user/ 同一个坑）。
      // handle 只含字母数字下划线（不含点/横线），负向断言排掉一级功能路由
      // （`/home`、`/explore`、`/i/…`…），否则这些页面会被当成人物档案。
      // 这份配置与 background.getMediaConfigs() 必须逐字对齐。
      'x.com': {
        rules: [
          { type: 'person', regex: '^/(?!home(?:/|$)|explore(?:/|$)|search(?:/|$)|i(?:/|$)|settings(?:/|$)|notifications(?:/|$)|messages(?:/|$)|compose(?:/|$)|intent(?:/|$)|personalize(?:/|$)|privacy(?:/|$)|tos(?:/|$)|login(?:/|$)|signup(?:/|$)|logout(?:/|$)|session(?:/|$)|account(?:/|$)|share(?:/|$)|hashtag(?:/|$)|trends(?:/|$)|dev(?:/|$)|jobs(?:/|$)|help(?:/|$)|welcome(?:/|$)|verify(?:/|$)|flow(?:/|$)|articles(?:/|$)|events(?:/|$)|browse(?:/|$))[A-Za-z0-9_]{1,15}/?$' },
          { type: 'person', regex: '^/[A-Za-z0-9_]{1,15}/about/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'www.x.com': {
        rules: [
          { type: 'person', regex: '^/(?!home(?:/|$)|explore(?:/|$)|search(?:/|$)|i(?:/|$)|settings(?:/|$)|notifications(?:/|$)|messages(?:/|$)|compose(?:/|$)|intent(?:/|$)|personalize(?:/|$)|privacy(?:/|$)|tos(?:/|$)|login(?:/|$)|signup(?:/|$)|logout(?:/|$)|session(?:/|$)|account(?:/|$)|share(?:/|$)|hashtag(?:/|$)|trends(?:/|$)|dev(?:/|$)|jobs(?:/|$)|help(?:/|$)|welcome(?:/|$)|verify(?:/|$)|flow(?:/|$)|articles(?:/|$)|events(?:/|$)|browse(?:/|$))[A-Za-z0-9_]{1,15}/?$' },
          { type: 'person', regex: '^/[A-Za-z0-9_]{1,15}/about/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      // v2.7.22：TikTok 拆多规则 —— 个人主页 `/@<handle>`（单段）→ 人物档案；
      // 其余（`/@user/video/<id>`、`/@user/photo/<id>`、推荐流）→ 社交。
      // 顺序不能反：person 那条正则是 social 的 `patterns: ['/@']` 的子集，
      // social 在前会把主页一起吃成社交（跟抖音 /user/、IG 单段路径同一个坑）。
      'www.tiktok.com': {
        rules: [
          { type: 'person', regex: '^/@[A-Za-z0-9_.]{2,40}/?$' },
          { type: 'social', patterns: ['/video/', '/@'] }
        ]
      },
      'tiktok.com': {
        rules: [
          { type: 'person', regex: '^/@[A-Za-z0-9_.]{2,40}/?$' },
          { type: 'social', patterns: ['/video/', '/@'] }
        ]
      },
      // v2.7.23：YouTube 拆多规则 —— 频道页 `/@<handle>`、`/channel/UC<24位>`
      // （含频道子页 /videos、/shorts、/about…）是**个人主页**（人物档案 / account）；
      // `/watch`、`/shorts/<id>` 仍是作品页（社交）。
      // 顺序不能反：person 那条是 social `/@`、`/channel/` 的子集，
      // social 在前会把主页一起吃成社交（抖音 /user/、IG 单段、TikTok /@ 同一个坑）。
      //
      // 三条限定：
      //   ① `@` 后只允许 YouTube handle 的合法字符（字母数字 . _ -），且**只能一段**；
      //   ② `/channel/` 后必须是 `UC` 开头的 24 位内部 ID —— 旧式自定义名
      //      `/channel/someone` 不认（那种地址现在是 404）；
      //   ③ 结尾只允许 `/` 或查询串/锚点，所以 `/watch?v=`、`/shorts/abc` 不会误判。
      // 这一条与 extractor-factory 的 URL 规则、url-normalizer 的主页分支保持同口径。
      'www.youtube.com': {
        rules: [
          { type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?/?$' },
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] }
        ]
      },
      'youtube.com': {
        rules: [
          { type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?/?$' },
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] }
        ]
      },
      'www.bilibili.com': {
        type: 'social',
        patterns: ['/video/', '/bangumi/play/']
      },
      'bilibili.com': {
        type: 'social',
        patterns: ['/video/', '/bangumi/play/']
      },
      'space.bilibili.com': {
        rules: [
          { type: 'person', regex: '^/\\d{1,15}(?:/(?:dynamic|upload|lists|pugv|series|channels|favlist|following|fans|article|audio|album|comic|bangumi|cheese|video))?/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      }
    };
  }

  /**
   * 把站点配置归一成规则数组（v2.7.11）
   *
   * 兼容两种写法：
   *   · 老写法 `{ type, patterns }`      → 一条规则
   *   · 新写法 `{ rules: [{type, patterns, excludeQuery}] }` → 多条，按顺序取第一条命中的
   *
   * 为什么要多规则：`/user/<sec_uid>`（作者主页，人物档案）和
   * `/user/<sec_uid>?modal_id=`（作品弹窗，社交）**同域名同路径**，
   * 一个 hostname 只能映一个类型的旧结构表达不了。
   */
  _rulesOf(siteConfig) {
    if (!siteConfig) return [];
    if (Array.isArray(siteConfig.rules) && siteConfig.rules.length) {
      return siteConfig.rules;
    }
    return [{
      type: siteConfig.type,
      patterns: siteConfig.patterns
    }];
  }

  /**
   * 单条规则是否命中：patterns 全过 + excludeQuery 全不过
   * @param {Object} rule
   * @param {string} pathname
   * @param {string} search - 含前导 `?` 的查询串
   */
  _ruleMatches(rule, pathname, search) {
    if (!rule) return false;

    // v2.7.20：正则形态（`patterns` 的 includes 表达不了「单段路径」这种判据，
    // Instagram 主页 `/<username>/` 就是这种情况）。失败一律当不匹配，不抛。
    if (rule.regex) {
      let ok = false;
      try {
        ok = new RegExp(rule.regex).test(String(pathname || ''));
      } catch (e) {
        ok = false;
      }
      if (!ok) return false;
    }

    if (Array.isArray(rule.patterns) && rule.patterns.length) {
      const hit = rule.patterns.some(pattern =>
        pathname.includes(String(pattern).replace(/\*/g, ''))
      );
      if (!hit) return false;
    }

    // 排除参数：地址里带 `?modal_id=` 或 `&modal_id=` 就算这条规则不成立
    if (Array.isArray(rule.excludeQuery) && rule.excludeQuery.length) {
      const q = String(search || '');
      for (const key of rule.excludeQuery) {
        if (!key) continue;
        if (new RegExp('[?&]' + String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=').test(q)) {
          return false;
        }
      }
    }

    return true;
  }

  detect(url, document) {
    const hostname = new URL(url).hostname;
    const pathname = new URL(url).pathname;
    const search = new URL(url).search;
    
    const siteConfig = this.siteConfigs?.[hostname];
    if (!siteConfig) {
      return this.detectByContent(document);
    }

    const rules = this._rulesOf(siteConfig);

    for (const rule of rules) {
      if (!this._ruleMatches(rule, pathname, search)) continue;

      // 人物档案的判定完全由地址决定（豆瓣 /personage/、抖音 /user/ 无 modal_id），
      // 这里必须**直接定案**，不能往下走正文猜测：
      // 影人页正文里全是「演员 / 导演 / 作者 / 作品」这些词，detectByContent 会把它
      // 判成 movie 或 book（www.douban.com 恰好在 needsContentVerification 名单里）。
      if (rule.type === 'person') return 'person';

      // 如果配置为自动检测，或者需要进一步确认
      if (rule.type === 'auto' || this.needsContentVerification(hostname)) {
        const contentType = this.detectByContent(document);
        return contentType || rule.type;
      }
      return rule.type;
    }

    // 一条规则都不命中
    // 站点明确声明「路径不对就别猜」时直接放弃（v2.5.77：抖音弹窗入口页面
    // 会加载脚本，但不该出按钮；退回按正文猜类型会猜出 social/movie 并冒出按钮）
    if (siteConfig.noContentFallback) return null;
    return this.detectByContent(document);
  }

  detectByContent(document) {
    // 通过页面内容检测媒体类型
    const title = document.title.toLowerCase();
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    const metaTags = document.querySelectorAll('meta');
    
    // 书籍特征检测
    const bookIndicators = [
      '书籍', '图书', 'book', 'novel', '小说', '作者', '出版社', 'isbn', 
      '页数', 'chapter', '章节'
    ];
    
    // 影视特征检测
    const movieIndicators = [
      '电影', 'movie', 'film', 'cinema', '导演', '演员', '主演', 
      '片长', 'runtime', '上映', 'release',
      // 增加电视剧相关指标
      '电视剧', '剧集', 'series', 'season', '季', '集数'
    ];
    
    // 游戏特征检测
    const gameIndicators = [
      '游戏', 'game', 'gaming', 'steam', '开发商', '发行商', 
      'platform', '系统需求'
    ];
    
    // 社交媒体特征检测
    const socialIndicators = [
      '发布', '动态', '点赞', '评论', '分享', '关注', '粉丝',
      'post', 'tweet', 'share', 'like', 'follow', 'follower'
    ];

    const scores = {
      book: this.calculateScore(title + ' ' + bodyText, bookIndicators),
      movie: this.calculateScore(title + ' ' + bodyText, movieIndicators),
      game: this.calculateScore(title + ' ' + bodyText, gameIndicators),
      social: this.calculateScore(title + ' ' + bodyText, socialIndicators)
    };

    // 检查特定网站的媒体类型标识
    const siteSpecificType = this.checkSiteSpecificIndicators(document);
    if (siteSpecificType) {
      return siteSpecificType;
    }

    // 返回得分最高的类型
    let maxScore = 0;
    let detectedType = 'unknown';
    
    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        detectedType = type;
      }
    }
    
    // 如果最高得分太低，返回未知类型
    if (maxScore < 2) {
      return 'unknown';
    }
    
    return detectedType;
  }

  calculateScore(text, indicators) {
    return indicators.reduce((score, indicator) => {
      const regex = new RegExp(indicator, 'gi');
      const matches = text.match(regex);
      return score + (matches ? matches.length : 0);
    }, 0);
  }

  checkSiteSpecificIndicators(document) {
    // 检查特定网站的媒体类型标识
    const hostname = window.location.hostname;
    const pathname = window.location.pathname;
    
    if (hostname === 'bgm.tv' || hostname === 'bangumi.tv' || hostname === 'chii.in') {
      // 优先检查页面头部标题旁边的类型标识（番组计划特有的识别方式）
      const headerSubjectType = document.querySelector('#headerSubject h1 small');
      if (headerSubjectType) {
        const typeText = headerSubjectType.textContent.toLowerCase().trim();
        if (typeText === '游戏' || typeText === 'game') {
          return 'game';
        }
        if (typeText === '书籍' || typeText === 'book') {
          return 'book';
        }
        // 区分影视类型：电影和剧集
        if (typeText.includes('电影') || typeText.includes('剧场版') || typeText.includes('movie')) {
          return 'movie';
        } else if (typeText.includes('TV') || typeText.includes('动画') || typeText.includes('tv series') || 
                  typeText.includes('series') || typeText.includes('剧') || typeText.includes('番剧')) {
          return 'tv';
        }
      }
      
      // 番组计划有明确的类型标识
      const typeElement = document.querySelector('.type, .subject_type, [class*="type"]');
      if (typeElement) {
        const typeText = typeElement.textContent.toLowerCase();
        if (typeText.includes('书籍') || typeText.includes('book')) return 'book';
        if (typeText.includes('电影') || typeText.includes('movie') || typeText.includes('剧场版')) return 'movie';
        if (typeText.includes('动画') || typeText.includes('anime') || typeText.includes('TV') || 
            typeText.includes('series') || typeText.includes('剧') || typeText.includes('番剧')) return 'tv';
        if (typeText.includes('游戏') || typeText.includes('game')) return 'game';
      }
      
      // 检查URL路径
      if (pathname.includes('/subject/')) {
        // 通过页面内容进一步判断
        const infobox = document.querySelector('#infobox, .infobox, [class*="infobox"]');
        if (infobox) {
          const infoboxText = infobox.textContent.toLowerCase();
          // 游戏特有字段
          if (infoboxText.includes('平台') || infoboxText.includes('开发商') || 
              infoboxText.includes('发行商') || infoboxText.includes('游戏引擎')) {
            return 'game';
          }
          // 书籍特有字段
          if (infoboxText.includes('作者') || infoboxText.includes('出版社')) {
            return 'book';
          }
          // 影视特有字段 - 进一步区分电影和剧集
          if (infoboxText.includes('导演')) {
            // 如果包含集数或单集片长特征，判断为剧集
            if (infoboxText.includes('集数') || infoboxText.includes('话数') || 
                infoboxText.includes('单集片长') || infoboxText.includes('放送星期') || 
                infoboxText.includes('season') || infoboxText.includes('season')) {
              return 'tv';
            } else if (infoboxText.includes('片长') || infoboxText.includes('剧场版')) {
              return 'movie';
            } else {
              // 默认情况，需要进一步判断
              const h1Text = document.querySelector('#headerSubject h1')?.textContent?.toLowerCase() || '';
              if (h1Text.includes('剧场版') || h1Text.includes('movie')) {
                return 'movie';
              } else {
                return 'tv';
              }
            }
          }
        }
      }
    } else if (hostname === 'movie.douban.com') {
      // 豆瓣电影页面的特殊处理
      const infoElement = document.querySelector('#info');
      if (infoElement) {
        const infoText = infoElement.textContent.toLowerCase();
        // 检查是否包含电视剧特征
        if (infoText.includes('集数') || infoText.includes('季数') || 
            infoText.includes('season') || infoText.includes('季') ||
            (infoText.includes('共') && infoText.includes('集'))) {
          // 返回新的'tv'类型
          return 'tv';
        }
      }
    } else if (hostname === 'game.douban.com' || (hostname === 'www.douban.com' && pathname.includes('/game/'))) {
      // 豆瓣游戏页面的特殊处理（包括game.douban.com和www.douban.com/game/路径）
      return 'game';
    } else if (hostname === 'www.kuaishou.com') {
      // 快手页面的特殊处理
      if (pathname.includes('/short-video/') || pathname.includes('/video/')) {
        return 'social';
      }
    } else if (hostname === 'www.xiaohongshu.com') {
      // 小红书页面的特殊处理
      if (pathname.includes('/discovery/item/') || pathname.includes('/explore/')) {
        return 'social';
      }
    } else if (hostname === 'www.instagram.com') {
      // Instagram页面的特殊处理
      if (pathname.includes('/p/')) {
        return 'social';
      }
    } else if (hostname === 'www.weibo.com' || hostname === 'weibo.com' || hostname === 's.weibo.com') {
      // 微博页面的特殊处理（v2.7.40 补搜索页 s.weibo.com）
      if (window.location.href.includes('weibo.com')) {
        return 'social';
      }
    } else if (hostname === 'm.weibo.cn') {
      // 微博移动版页面的特殊处理
      if (window.location.href.includes('m.weibo.cn')) {
        return 'social';
      }
    } else if (hostname === 'x.com' || hostname === 'www.x.com') {
      // 推特页面的特殊处理
      if (window.location.href.includes('x.com')) {
        return 'social';
      }
    } else if (hostname === 'www.tiktok.com' || hostname === 'tiktok.com') {
      // TikTok页面的特殊处理
      if (pathname.includes('/video/') || pathname.includes('/@')) {
        return 'social';
      }
    } else if (hostname === 'www.youtube.com' || hostname === 'youtube.com') {
      // YouTube页面的特殊处理
      if (pathname.includes('/watch') || pathname.includes('/channel/') || pathname.includes('/@')) {
        return 'social';
      }
    } else if (hostname === 'www.bilibili.com' || hostname === 'bilibili.com') {
      // B站页面的特殊处理
      if (pathname.includes('/video/') || pathname.includes('/bangumi/play/')) {
        return 'social';
      }
    }

    return null;
  }

  needsContentVerification(hostname) {
    // 某些网站需要内容验证
    const verificationNeeded = ['bgm.tv', 'bangumi.tv', 'chii.in', 'www.douban.com', 'movie.douban.com', 'game.douban.com', 'www.weibo.com', 'weibo.com', 'm.weibo.cn'];
    return verificationNeeded.includes(hostname);
  }
}

// 导出检测器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaTypeDetector;
} else {
  window.MediaTypeDetector = MediaTypeDetector;
}