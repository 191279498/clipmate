// 通用字段映射引擎
class UniversalFieldMapper {
  constructor(mediaType) {
    this.mediaType = mediaType;
    this.mappings = this.loadMappingsForMediaType(mediaType);
    this.fieldTemplates = this.loadFieldTemplates();
    this.logger = this._createLogger();
  }
  
  // 创建日志记录器
  _createLogger() {
    const logPrefix = '[UniversalFieldMapper]';
    
    // 格式化时间戳
    const getTimestamp = () => {
      const now = new Date();
      return now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');
    };
    
    return {
      // 信息日志 - 始终显示
      info: (message, context = {}) => {
      },
      
      // 警告日志 - 始终显示
      warn: (message, context = {}) => {
        console.warn(`${logPrefix} [${getTimestamp()}] WARN: ${message}`, context);
      },
      
      // 错误日志 - 始终显示并包含堆栈
      error: (message, error = null, context = {}) => {
        const fullContext = { ...context };
        if (error) {
          fullContext.errorMessage = error.message;
          fullContext.errorStack = error.stack;
        }
        console.error(`${logPrefix} [${getTimestamp()}] ERROR: ${message}`, fullContext);
      },
      
      // 调试日志 - 显示详细信息
      debug: (message, context = {}) => {
      },
      
      // 专用于别名字段的调试日志
      debugAlias: (message, context = {}) => {
      }
    };
  }

  // 合并规则的辅助方法：深度合并两个对象，保留源对象中的数组
  mergeRules(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        // 如果目标对象中没有该键，直接添加
        if (!result.hasOwnProperty(key)) {
          result[key] = source[key];
        } else {
          // 如果两者都是对象，递归合并
          if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key]) &&
              typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
            result[key] = this.mergeRules(result[key], source[key]);
          }
          // 如果源是数组，合并数组但去重
          else if (Array.isArray(source[key])) {
            if (Array.isArray(result[key])) {
              // 合并数组并去重
              result[key] = [...new Set([...result[key], ...source[key]])];
            } else {
              // 如果目标不是数组，替换为源数组
              result[key] = [...source[key]];
            }
          }
          // 其他情况，源值覆盖目标值
          else {
            result[key] = source[key];
          }
        }
      }
    }
    
    return result;
  }

  loadMappingsForMediaType(mediaType) {
    // 1. 媒体类型规则层：特定于媒体类型的规则（包含原通用规则层的所有字段）
    const mediaTypeRules = {
      book: {
        '书名': ['书名', 'title', '作品名', 'bookName', 'novelName'],
        '作者': ['作者', 'author', '创作者', 'authorName', 'writer'],
        '国家': ['国家', 'country', '作者国家'],
        '原作名': ['原作名', '原名', 'original_title'],
        '发布日期': ['出版日期', '发布日期', 'publish_date', '出版年', '创建时间', 'publishTime', 'lastUpdateTime'],
        '豆瓣链接': ['豆瓣链接', 'douban_url'],
        'ISBN': ['ISBN', 'isbn'],
        '篇幅': ['页数', 'pages', '篇幅', '总页数', '话数', '册数'],
        '别名': ['别名', 'nickname', 'alias', '其他名称'],
        '简介': ['简介', 'description', 'summary'],
        '网络评分': ['评分', 'rating', 'score'],
        'URL': ['URL', 'url', '链接'],
        '其他信息': ['其他信息', '备注', 'note']
      },
      movie: {
        '名字': ['片名', '电影名', 'title', 'name', 'Title'],
        '国家': ['国家', '制片国家/地区', 'country', 'countries', '产地'],
        '上映日期': ['上映日期', '首映日期', 'release_date', 'pubdate', 'Release Date', 'date'],
        '片长': ['片长', '时长', 'runtime', 'Runtime'],
        '单集片长': ['单集片长', 'episode_runtime'],
        '集数': ['集数', 'episodes', '总集数', 'Episodes'],
        '原作名': ['原作名', '原名', 'original_title', 'Original Title'],
        'IMDB': ['IMDB'],
        'TMDB': ['TMDB链接', 'tmdb_url'],
        'Bangumi': ['Bangumi链接', 'bgm_url'],
        '导演': ['导演', 'director', 'Director'],
        '编剧': ['编剧', 'writer', 'screenwriter', 'Writer'],
        '主演': ['演员', '演员阵容', '主演', 'cast', 'starring', 'Stars', 'actors'],
        '别名': ['别名', 'nickname', 'alias', '其他名称'],
        '标签': ['标签'],
        '简介': ['简介', 'description', 'summary'],
        '网络评分': ['评分', 'rating', 'score'],
        'URL': ['URL', 'url', '链接'],
        '其他信息': ['其他信息', '备注', 'note']
      },
      tv: {
        '名字': ['片名', '电视剧名', 'title', 'name', 'Title'],
        '国家': ['国家', '制片国家/地区', 'country', 'countries', '产地'],
        '上映日期': ['上映日期', '首播日期', '播出日期', 'release_date', 'pubdate', 'Release Date', 'date'],
        '单集片长': ['单集片长', '单集时长', '每集片长', 'episode_runtime', 'runtime'],
        '集数': ['集数', '总集数', 'episodes', 'Episodes', '话数'],
        '原作名': ['原作名', '原名', 'original_title', 'Original Title'],
        'IMDB': ['IMDB'],
        'TMDB': ['TMDB链接', 'tmdb_url'],
        'Bangumi': ['Bangumi链接', 'bgm_url'],
        '导演': ['导演', 'director', 'Director'],
        '编剧': ['编剧', 'writer', 'screenwriter', 'Writer'],
        '主演': ['演员', '演员阵容', '主演', 'cast', 'starring', 'Stars', 'actors'],
        '别名': ['别名', 'nickname', 'alias', '其他名称'],
        '标签': ['标签'],
        '简介': ['简介', 'description', 'summary'],
        '网络评分': ['评分', 'rating', 'score'],
        'URL': ['URL', 'url', '链接'],
        '其他信息': ['其他信息', '备注', 'note']
      },
      game: {
        // 键名必须与字段清单一致：清单里叫「游戏名」，历史写的是「名字」，
        // 导致 title / 游戏名 全都写进「名字」，只能靠 processGameData 事后改名兜底。
        '游戏名': ['游戏名', 'name', 'title'],
        '平台': ['平台', 'platforms', 'platform'],
        '原作名': ['原作名', '原名', 'original_title'],
        '发行日期': ['发行日期', 'release_date', 'date', '发售日'],
        '豆瓣链接': ['豆瓣链接', 'douban_url'],
        'Steam': ['Steam链接', 'steam_url'],
        '官方网站': ['官方网站', 'official_website', 'website', '官网'],
        '简介': ['简介', 'description', 'about', 'summary', '介绍'],
        '别名': ['别名', 'nickname', 'alias', '其他名称'],
        '网络评分': ['评分', 'rating', 'score'],
        'URL': ['URL', 'url', '链接'],
        '其他信息': ['其他信息', '备注', 'note']
      },
      social: {
        '本页标题': ['本页标题', 'title', 'page_title'],
        '作者ID': ['作者ID', 'author_id', 'user_id', 'creator_id'],
        '作者昵称': ['作者昵称', 'author', 'creator', 'username', 'nickname'],
        '作者主页': ['作者主页', 'author_homepage', 'author_url', 'profile_url'],
        '发布日期': ['发布日期', 'publish_date', 'post_date', 'create_time'],
        'URL': ['URL', 'url', '链接'],
        '别名': ['别名', 'nickname', 'alias', '其他名称'],
        '简介': ['简介', 'description', 'summary'],
        '网络评分': ['评分', 'rating', 'score'],
        '其他信息': ['其他信息', '备注', 'note']
      }
    };

    // 3. 网站特定规则层：特定于网站的详细规则
    const siteSpecificRules = {
      book: {
        douban_book: {
          '书名': ['书名', 'title', '作品名'],
          '别名': ['别名', 'nickname', 'alias', '别名/昵称'],
          '作者': ['作者', 'author', '创作者'],
          '原作名': ['原作名', '原名', 'original_title'],
          '发布日期': ['出版日期', '发布日期', 'publish_date', '出版年'],
          '简介': ['内容简介', 'summary', 'description'],
          '网络评分': ['评分', 'rating', 'score'],
          '豆瓣链接': ['豆瓣链接', 'douban_url'],
          'ISBN': ['ISBN', 'isbn'],
          '篇幅': ['页数', 'pages', '篇幅', '总页数']
        },
        bgm_book: {
          '书名': ['书名', '中文名', 'name', 'name_cn'],
          '别名': ['别名', '其他名称', 'nickname', 'alias', 'alt_titles'],
          '作者': ['作者', 'author'],
          '原作名': ['原名', '原作名', 'name', 'original_name'],
          '出版社': ['出版社', 'publisher'],
          '发布日期': ['发售日', '发布日期', '出版日期', 'date'],
          'ISBN': ['ISBN', 'isbn'],
          '定价': ['定价', 'price'],
          '简介': ['介绍', '简介', 'summary'],
          '网络评分': ['评分', '网络评分', 'rating'],
          'URL': ['URL', 'url', '链接'],
          '篇幅': ['篇幅', '页数', '话数', '册数'],
          '其他信息': ['其他信息', '备注', 'note']
        },
        qidian: {
          '书名': ['书名', 'bookName', 'novelName'],
          '别名': ['别名', 'nickname', 'alias', '曾用名'],
          '作者': ['作者', 'authorName', 'writer'],
          '发布日期': ['创建时间', 'publishTime', 'lastUpdateTime'],
          '简介': ['简介', 'bookIntro', 'description'],
          '网络评分': ['评分', 'rating', 'score']
        },
        fanqie: {
          '书名': ['书名', 'bookName', '书名/作品名'],
          '作者': ['作者', 'author', 'authorName'],
          '国家': ['国家'],
          '发布日期': ['发布日期', 'publishDate', 'datePublished', 'dateModified'],
          '简介': ['简介', 'abstract', 'description'],
          'URL': ['URL', 'url'],
          '篇幅': ['篇幅', 'wordNumber', '字数'],
          '其他信息': ['其他信息']
        }
      },
      movie: {
        douban_movie: {
          '名字': ['片名', '电影名', 'title', 'name'],
          '别名': ['别名', 'nickname', 'alias', '其他名称'],
          '标签': ['标签'],
          '国家': ['国家', '制片国家/地区'],
          '上映日期': ['上映日期', '首映日期', 'release_date', 'pubdate'],
          '简介': ['简介', '剧情概括', '剧情梗概', '剧情介绍', 'summary'],
          '片长': ['片长', '时长', 'runtime'],
          '单集片长': ['单集片长', 'episode_runtime'],
          '集数': ['集数', 'episodes', '总集数'],
          '网络评分': ['评分', 'rating', 'score'],
          '原作名': ['原作名', '原名', 'original_title'],
          'IMDB': ['IMDB'],
          '豆瓣链接': ['豆瓣链接', 'douban_url'],
          '导演': ['导演', 'director'],
          '编剧': ['编剧', 'writer', 'screenwriter'],
          '主演': ['演员', '演员阵容', '主演', 'cast', 'starring']
        },

        bgm_movie: {
          '名字': ['片名', '影视中文名', 'title', '中文名', 'name_cn', 'name'],
          '别名': ['别名', '其他名称', 'nickname', 'alias'],
          'Bangumi': ['Bangumi链接', 'bgm_url'],
          '上映日期': ['上映日期', '首播日期', '放送开始', 'air_date', 'date'],
          '简介': ['简介', '介绍', 'summary'],
          '集数': ['集数', '话数', 'episodes'],
          '网络评分': ['评分', 'rating', 'score'],
          '原作名': ['原作名', '原名', 'original_title'],
          '导演': ['导演', 'director'],
          '编剧': ['编剧', 'writer', 'screenwriter'],
          '主演': ['主演', '演员', '声优', 'cast', 'actors'],
          '类型': ['类型', 'genres'],
          '单集片长': ['单集片长', '每集片长', 'episode_runtime'],
          '片长': ['片长', '时长', 'runtime'],
          '官方网站': ['官方网站'],
          '豆瓣链接': ['豆瓣链接'],
          'URL': ['URL']
        },
        imdb: {
          '名字': ['Title', 'name', 'title'],
          '别名': ['Also Known As', 'Also known as', 'nicknames', 'aliases'],
          'IMDB': ['IMDB'],
          '上映日期': ['Release Date', 'release_date', 'date'],
          '简介': ['Plot', 'plot', 'summary', 'description'],
          '片长': ['Runtime', 'runtime'],
          '网络评分': ['Rating', 'rating', 'score'],
          '导演': ['Director', 'director'],
          '编剧': ['Writer', 'writer'],
          '主演': ['Stars', 'cast', 'actors']
        },
        tmdb: {
          '名字': ['Title', 'name', 'title'],
          '别名': ['Also Known As', 'nicknames', 'aliases'],
          'TMDB': ['TMDB链接', 'tmdb_url'],
          '上映日期': ['Release Date', 'release_date'],
          '简介': ['Overview', 'overview', 'plot', 'summary'],
          '片长': ['Runtime', 'runtime'],
          '集数': ['Episodes', 'episodes'],
          '网络评分': ['Rating', 'rating'],
          '原作名': ['Original Title', 'original_title']
        }
      },
      tv: {
        douban_movie: {
          '名字': ['片名', '电视剧名', 'title', 'name'],
          '别名': ['别名', 'nickname', 'alias', '其他名称'],
          '标签': ['标签'],
          '国家': ['国家', '制片国家/地区'],
          '上映日期': ['上映日期', '首播日期', 'release_date', 'pubdate'],
          '简介': ['简介', '剧情概括', '剧情梗概', '剧情介绍', 'summary'],
          '豆瓣链接': ['豆瓣链接', 'douban_url'],
          '单集片长': ['单集片长', '单集时长', '每集片长', 'episode_runtime'],
          '集数': ['集数', '总集数', 'episodes'],
          '网络评分': ['评分', 'rating', 'score'],
          '原作名': ['原作名', '原名', 'original_title'],
          'IMDB': ['IMDB'],
          '导演': ['导演', 'director'],
          '编剧': ['编剧', 'writer', 'screenwriter'],
          '主演': ['演员', '演员阵容', '主演', 'cast', 'starring']
        },

        bgm_movie: {
          '名字': ['中文名', 'name_cn', 'name', '片名'],
          '别名': ['别名', '其他名称', 'nickname', 'alias'],
          'Bangumi': ['Bangumi链接', 'bgm_url', 'url'],
          '上映日期': ['放送开始', 'air_date', 'date', '上映日期'],
          '简介': ['介绍', 'summary', '简介'],
          '集数': ['话数', 'episodes'],
          '网络评分': ['评分', 'rating'],
          '导演': ['导演'],
          '编剧': ['编剧'],
          '主演': ['主演', 'cast', 'starring'],
          '单集片长': ['单集片长', '片长'],
          '国家': ['国家', '地区']
        },
        tmdb: {
          '名字': ['Title', 'name', 'title'],
          '别名': ['Also Known As', 'nicknames', 'aliases'],
          'TMDB': ['TMDB链接', 'tmdb_url'],
          '上映日期': ['Release Date', 'release_date'],
          '简介': ['Overview', 'overview', 'plot', 'summary'],
          '单集片长': ['Runtime', 'runtime'],
          '集数': ['Episodes', 'episodes'],
          '网络评分': ['Rating', 'rating'],
          '原作名': ['Original Title', 'original_title']
        }
      },
      game: {
        steam: {
          '名字': ['游戏名', 'name', 'title'],
          '别名': ['别名', 'nickname', 'alias', '其他名称'],
          'steam': ['Steam链接', 'steam_url'],
          '发行日期': ['发行日期', 'release_date', 'date'],
          '简介': ['简介', 'description', 'about', 'summary'],
          '网络评分': ['评分', 'rating', 'user_score']
        },
        douban_game: {
          '游戏名': ['游戏名', '标题', 'name', 'title'],
          '游戏类型': ['游戏类型', '类型', 'genres'],
          '平台': ['平台', 'platforms'],
          '开发商': ['开发商', 'developer'],
          '发行商': ['发行商', 'publisher'],
          '发行日期': ['发行日期', 'releaseDate', '发售日', 'release_date'],
          '豆瓣链接': ['url', 'URL', '豆瓣链接', '链接', 'douban_url'],
          '别名': ['别名', 'nickname', 'alias', '其他名称'],
          '简介': ['简介', 'description', 'summary'],
          '网络评分': ['评分', 'rating']
        },
        bgm_game: {
          '名字': ['中文名', 'name_cn', 'name'],
          '别名': ['别名', '其他名称', 'nickname', 'alias'],
          'Bangumi': ['Bangumi链接', 'bgm_url'],
          '发行日期': ['发售日', 'date'],
          '简介': ['介绍', 'summary'],
          '网络评分': ['评分', 'rating']
        },
        // Metacritic 提取器输出的就是通用字段名，这里显式登记一份对照，
        // 目的是让映射走「站点精确命中」这条路，不去碰 mediaType 层的回退逻辑
        // （game 这一层没有 __default__，回退会把站点名当字段名去比，容易串位）。
        metacritic: {
          '游戏名': ['游戏名', 'name', 'title'],
          '发行日期': ['发行日期', 'release_date', 'datePublished'],
          '原作名': ['原作名', 'originalTitle'],
          '平台': ['平台', 'platforms', 'gamePlatform'],
          '网络评分': ['网络评分', '评分', 'rating', 'ratingValue', 'metascore'],
          '简介': ['简介', 'description', 'summary'],
          '国家': ['国家', 'country'],
          'Steam': ['Steam', 'Steam链接', 'steam_url'],
          '豆瓣链接': ['豆瓣链接', 'douban_url'],
          '官方网站': ['官方网站', 'website', 'official_site'],
          'URL': ['URL', 'url'],
          '别名': ['别名', 'nickname', 'alias'],
          '其他信息': ['其他信息', 'otherInfo', 'other_info']
        },
        // MobyGames 提取器同样直接输出通用字段名，理由同上（game 层没有 __default__）
        mobygames: {
          '游戏名': ['游戏名', 'name', 'title'],
          '发行日期': ['发行日期', 'release_date', 'datePublished'],
          '原作名': ['原作名', 'originalTitle'],
          '平台': ['平台', 'platforms', 'gamePlatform'],
          '网络评分': ['网络评分', '评分', 'rating', 'mobyScore'],
          '简介': ['简介', 'description', 'summary'],
          '国家': ['国家', 'country'],
          'Steam': ['Steam', 'Steam链接', 'steam_url'],
          '豆瓣链接': ['豆瓣链接', 'douban_url'],
          '官方网站': ['官方网站', 'website', 'official_site'],
          'URL': ['URL', 'url'],
          '别名': ['别名', 'nickname', 'alias', 'alternateName'],
          '其他信息': ['其他信息', 'otherInfo', 'other_info']
        }
      },
      social: {
        // 社交平台通用映射模板：所有平台共享的别名
        // 各平台只需在其自身配置中补充私有别名，合并时自动去重
        __default__: {
          '本页标题': ['标题', 'title', 'page_title', '作品标题', '内容标题'],
          '作者昵称': ['作者', '作者昵称', 'creator', 'author', 'username', 'nickname', 'user_name', '博主', '用户昵称', 'author_name'],
          '作者主页': ['作者主页', '作者链接', 'profile_url', 'user_url', 'author_homepage', '用户主页', 'author_url', '主页链接'],
          '发布日期': ['发布日期', '发布时间', 'post_date', 'create_time', 'publish_date'],
          'URL': ['URL', 'url', '链接', '作品链接']
        },
        douyin_social: {
          '本页标题': ['视频标题', 'aweme_title', 'video_title'],
          '作者昵称': ['up主'],
          '发布日期': ['upload_time'],
          'URL': ['视频链接', 'share_url', 'video_url']
        },
        kuaishou_social: {
          '本页标题': ['视频标题', 'photo_title', 'video_title'],
          '作者昵称': ['up主'],
          '发布日期': ['upload_time'],
          'URL': ['视频链接', 'photo_url', 'video_url']
        },
        xiaohongshu_social: {
          '本页标题': ['视频标题', 'note_title'],
          'URL': ['视频链接', 'note_url']
        },
        bilibili_social: {
          '本页标题': ['视频标题', 'video_title'],
          'URL': ['视频链接', 'video_url']
        },
        weibo_social: {
          'URL': ['微博链接', 'share_url']
        },
        instagram_social: {
          'URL': ['帖子链接', 'post_url']
        },
        x_social: {
          '本页标题': ['推文标题'],
          'URL': ['推文链接', 'tweet_url']
        }
      },

    };

    // 获取当前媒体类型的规则
    const currentMediaTypeRules = mediaTypeRules[mediaType] || {};
    const currentSiteRules = siteSpecificRules[mediaType] || {};
    
    // 合并规则：创建最终的映射配置
    const mergedMappings = {};
    
    // 提取 __default__ 通用模板（用于社交平台继承）
    const defaultTemplate = currentSiteRules.__default__ || {};
    
    // 遍历每个站点，合并规则（跳过 __default__ 本身，它不是真实站点）
    for (const site in currentSiteRules) {
      if (currentSiteRules.hasOwnProperty(site) && site !== '__default__') {
        // 先合并媒体类型通用规则
        let combinedRules = this.mergeRules({}, currentMediaTypeRules);
        
        // 再合并 __default__ 通用模板（如果存在，主要为社交平台设计）
        if (Object.keys(defaultTemplate).length > 0) {
          combinedRules = this.mergeRules(combinedRules, defaultTemplate);
        }
        
        // 最后合并站点特定规则（优先级最高）
        mergedMappings[site] = this.mergeRules(combinedRules, currentSiteRules[site]);
      }
    }

    // 添加媒体类型默认映射（当找不到站点特定映射时使用）
    if (mediaTypeRules[mediaType]) {
      // 直接使用媒体类型规则作为默认映射
      mergedMappings[mediaType] = { ...mediaTypeRules[mediaType] };
    }

    return mergedMappings || {};
  }

  loadFieldTemplates() {
    // 字段骨架的唯一来源：src/shared/config/media-types.js 的 MEDIA_FIELD_LISTS
    //（内容脚本里通过 window.mediaTypesConfig 暴露，manifest 保证本文件在其后加载）。
    //
    // 历史问题：这里原先自带一份 4 类型副本（书籍 13 键、游戏 12 键、影视 19 键…），
    // 与展示顺序不同步 —— 骨架里没有的字段只能被「原样透传」挂到最后一列，
    // 番组书籍的「定价」就是这么跑到第 18 列的。现在改为直接引用唯一清单。
    const mediaType = this.mediaType;
    const config = (typeof window !== 'undefined' && window.mediaTypesConfig) ? window.mediaTypesConfig : null;

    if (config && typeof config.getFullFieldTemplate === 'function') {
      const template = config.getFullFieldTemplate(mediaType);
      if (template && Object.keys(template).length > 0) {
        return { [mediaType]: { ...template } };
      }
    }

    // 极端兜底：配置未加载时不猜字段，交给「未映射字段原样透传」保证不丢数据
    console.warn('[UniversalFieldMapper] 字段清单未加载，本次跳过骨架预置，字段将原样透传');
    return { [mediaType]: {} };
  }

  // 智能处理篇幅字段，添加适当的单位
  processLengthField(value) {
    // 如果值不是字符串，直接返回
    if (typeof value !== 'string') {
      return value;
    }
    
    let processedValue = value.trim();
    
    // 检查是否已经包含常用单位
    const hasCommonUnit = /[册话页]/i.test(processedValue);
    if (hasCommonUnit) {
      return processedValue;
    }
    
    // 检查是否是纯数字，如果是则添加单位
    if (/^\d+$/.test(processedValue)) {
      return processedValue + '页';
    }
    
    // 处理带括号的复杂格式
    // 先检查是否是带括号的数字格式
    if (/^\d+\s*\(.+\)$/.test(processedValue)) {
      // 在每个数字后面添加"页"单位
      processedValue = processedValue.replace(/(\d+)/g, '$1页');
      return processedValue;
    }
    
    // 检查是否只包含数字、括号、空格、+和有限的中文字符，但特别排除"第X部"这样的格式
    if (/^[\d\s\(\)+全卷]+$/.test(processedValue) || 
        (/^[\d\s\(\)+全第部卷]+$/.test(processedValue) && !/^第\d+部/.test(processedValue))) {
      // 在每个数字后面添加"页"单位
      processedValue = processedValue.replace(/(\d+)/g, '$1页');
      return processedValue;
    }
    
    // 对于其他情况，返回原始值
    return processedValue;
  }

  mapToUniversalFields(rawData, sourceSite) {
    const universalData = { ...this.fieldTemplates[this.mediaType] };
    
    // 记录已映射的原始字段，用于后续删除
    const mappedOriginalFields = new Set();
    
    // 遍历所有提取到的字段
    for (const [fieldName, fieldValue] of Object.entries(rawData)) {
      if (!fieldValue || fieldValue.toString().trim() === '') {
        continue;
      }

      const universalField = this.findUniversalField(fieldName, sourceSite);
      
      if (universalField && universalData.hasOwnProperty(universalField)) {
        // v2.8.3：`og:` 这类页面 meta 键只是**兜底来源**，不许覆盖提取器已经给出的真值。
        //
        // 事故现场（豆瓣书籍页，2026-11-02 用户实测）：
        //   rawData 里既有提取器从 DOM 抠出来的完整简介，也有 `<meta property="og:description">`。
        //   豆瓣的 og:description 是服务端截断过的摘要（实测 103 字，末尾自带「...」），
        //   而「包含匹配」会把 og:description 认成「简介」，加上它在 rawData 里排最后，
        //   按「后写赢」把完整简介整段盖掉 —— 用户看到的就是「简介不完整、结尾有 …」。
        //
        // 规则：目标字段已经有非空值 → og:* 直接跳过；目标为空时照常兜底。
        // 只针对 og: 前缀（其他真实来源键的优先级不变），所以不影响既有的覆盖行为。
        if (/^og:/i.test(fieldName) && String(universalData[universalField] || '').trim() !== '') {
          // 标成「已处理」——否则下面那段「未映射字段透传」会把 og:title / og:description
          // 原样塞进结果，凭空多出两列脏键（v2.8.3 实测）。
          mappedOriginalFields.add(fieldName);
          continue;
        }

        // 映射到通用字段
        let mappedValue = fieldValue;

        // 对不同类型的特定字段应用智能处理
        // 书籍类型："篇幅"字段应用智能补全单位功能
        if (this.mediaType === 'book' && universalField === '篇幅') {
          mappedValue = this.processLengthField(fieldValue);
        }
        
        // 电视剧类型：特殊处理单集片长字段，确保正确格式化
        if (this.mediaType === 'tv' && universalField === '单集片长') {
          // 确保单集片长值不为空
          if (typeof mappedValue === 'string' && mappedValue.trim() === '') {
            this.logger.debug('电视剧单集片长字段为空，尝试从其他来源获取');
            // 如果没有单集片长，尝试从片长字段获取
            if (rawData['片长'] && rawData['片长'].toString().trim() !== '') {
              mappedValue = rawData['片长'];
              this.logger.debug('从片长字段获取单集片长值:', mappedValue);
            }
          }
        }
        
        // 为别名字段添加专门的调试日志
        if (universalField === '别名') {
          // 记录别名字段的写入操作
          this.logger.debugAlias('向"别名"字段写入数据', {
            sourceSite: sourceSite,
            originalFieldName: fieldName,
            originalValue: fieldValue,
            mediaType: this.mediaType,
            triggerCondition: `字段名匹配: ${fieldName} -> ${universalField}`
          });
          
          // 检查是否会覆盖已有值
          if (universalData[universalField] && universalData[universalField].toString().trim() !== '') {
            this.logger.debugAlias('覆盖已存在的"别名"字段值', {
              existingValue: universalData[universalField],
              newValue: mappedValue,
              sourceSite: sourceSite
            });
          }
        }
        
        // 为作者昵称字段添加专门的调试日志
        if (universalField === '作者昵称') {
          // 记录作者昵称字段的写入操作
          this.logger.debug('向"作者昵称"字段写入数据', {
            sourceSite: sourceSite,
            originalFieldName: fieldName,
            originalValue: fieldValue,
            mediaType: this.mediaType,
            triggerCondition: `字段名匹配: ${fieldName} -> ${universalField}`
          });
          
          // 检查是否会覆盖已有值
          if (universalData[universalField] && universalData[universalField].toString().trim() !== '') {
            this.logger.debug('覆盖已存在的"作者昵称"字段值', {
              existingValue: universalData[universalField],
              newValue: mappedValue,
              sourceSite: sourceSite
            });
          }
        }
        
        universalData[universalField] = mappedValue;
        // 记录已映射的原始字段
        mappedOriginalFields.add(fieldName);
      }
    }
    
    // 关键修复：直接传递原始数据中的"其他信息"字段
    if (rawData['其他信息'] && rawData['其他信息'].toString().trim() !== '') {
      this.logger.debug('发现原始数据中的"其他信息"字段，直接使用其值');
      universalData['其他信息'] = rawData['其他信息'];
      mappedOriginalFields.add('其他信息');
    }
    
    // 重要修复：删除已映射的原始字段，避免重复
    // 只保留未映射的原始字段
    for (const [fieldName, fieldValue] of Object.entries(rawData)) {
      if (!mappedOriginalFields.has(fieldName) && fieldValue && fieldValue.toString().trim() !== '') {
        universalData[fieldName] = fieldValue;
      }
    }
    
    // 修复豆瓣链接重复问题：统一处理链接字段
    this.fixDuplicateLinks(universalData, sourceSite);

    return universalData;
  }

  /**
   * v2.5.56：「单集片长」与「片长」互相包含（'单集片长'.includes('片长') 为 true），
   * 模糊匹配会把单集时长搬到「片长」去，导致剧集页「单集片长」永远是空的。
   * 规则：含「单集」的字段只允许与同样含「单集」的通用字段互相匹配（精确匹配不受影响）。
   */
  isSingleEpisodeMismatch(fieldName, universalField) {
    const srcIsSingle = String(fieldName).indexOf('单集') > -1;
    const dstIsSingle = String(universalField).indexOf('单集') > -1;
    return srcIsSingle !== dstIsSingle;
  }

  findUniversalField(fieldName, sourceSite) {
    const siteMappings = this.mappings[sourceSite];
    if (!siteMappings) {
      this.logger.debug('未找到站点映射配置', { sourceSite, mediaType: this.mediaType });
      
      // 尝试使用媒体类型默认映射
      const mediaTypeMappings = this.mappings[this.mediaType];
      if (mediaTypeMappings) {
        this.logger.debug('使用媒体类型默认映射', { mediaType: this.mediaType });
        
        // 查找映射关系
        for (const [universalField, sourceFields] of Object.entries(mediaTypeMappings)) {
          // 对别名字段和特殊字段（TMDB、IMDB、作者主页等）使用更严格的匹配规则
          if (universalField === '别名' || universalField === 'TMDB' || universalField === 'IMDB' || universalField === 'Bangumi' || universalField === 'Steam' || universalField === '作者主页') {
            const matchFound = sourceFields.some(sourceField => {
              const isExactMatch = sourceField.toLowerCase() === fieldName.toLowerCase();
              return isExactMatch;
            });
            
            if (matchFound) {
              return universalField;
            }
          } else {
            // 对于普通字段，使用原来的匹配规则
            const matchFound = sourceFields.some(sourceField => {
              // v2.5.56：阻止「单集片长」被模糊匹配到「片长」（反之亦然）
              if (this.isSingleEpisodeMismatch(fieldName, universalField)) return false;
              const isExactMatch = sourceField.toLowerCase() === fieldName.toLowerCase();
              const isFieldIncludesSource = fieldName.toLowerCase().includes(sourceField.toLowerCase());
              const isSourceIncludesField = sourceField.toLowerCase().includes(fieldName.toLowerCase());
              
              return isExactMatch || isFieldIncludesSource || isSourceIncludesField;
            });
            
            if (matchFound) {
              return universalField;
            }
          }
        }
      }
      
      return null;
    }

    // 查找映射关系
    for (const [universalField, sourceFields] of Object.entries(siteMappings)) {
      // 对别名字段和特殊字段（TMDB、IMDB、作者主页等）使用更严格的匹配规则
      if (universalField === '别名' || universalField === 'TMDB' || universalField === 'IMDB' || universalField === 'Bangumi' || universalField === 'Steam' || universalField === '作者主页') {
        const matchFound = sourceFields.some(sourceField => {
          const isExactMatch = sourceField.toLowerCase() === fieldName.toLowerCase();
          // 对于这些特殊字段，仅使用精确匹配，避免误匹配
          
          const matchDetails = {
            sourceField,
            fieldName,
            isExactMatch,
            sourceSite
          };
          
          if (isExactMatch) {
            if (universalField === '别名') {
              this.logger.debugAlias('别名字段匹配成功 (精确匹配)', matchDetails);
            } else {
              this.logger.debug(`${universalField}字段匹配成功 (精确匹配)`, matchDetails);
            }
          } else {
            if (universalField === '别名') {
              this.logger.debugAlias(`${universalField}字段匹配失败 (仅接受精确匹配)`, matchDetails);
            } else {
              this.logger.debug(`${universalField}字段匹配失败 (仅接受精确匹配)`, matchDetails);
            }
          }
          
          return isExactMatch;
        });
        
        if (matchFound) {
          if (universalField === '别名') {
            this.logger.debugAlias('确定别名字段映射关系', {
              sourceFieldName: fieldName,
              universalField: universalField,
              sourceSite: sourceSite,
              matchingKeywords: sourceFields
            });
          } else {
            this.logger.debug(`确定${universalField}字段映射关系`, {
              sourceFieldName: fieldName,
              universalField: universalField,
              sourceSite: sourceSite,
              matchingKeywords: sourceFields
            });
          }
          return universalField;
        }
      } else {
        // 特殊处理：避免"作者主页"被错误映射到"作者昵称"
        if (universalField === '作者昵称' && fieldName.includes('主页')) {
          this.logger.debug('阻止作者主页映射到作者昵称', {
            fieldName: fieldName,
            sourceSite: sourceSite,
            reason: '字段名包含"主页"，不应映射到作者昵称'
          });
          return null;
        }
        
        // 对于非别名字段，使用原来的匹配规则
        const matchFound = sourceFields.some(sourceField => {
          // v2.5.56：阻止「单集片长」被模糊匹配到「片长」（反之亦然）
          if (this.isSingleEpisodeMismatch(fieldName, universalField)) return false;
          const isExactMatch = sourceField.toLowerCase() === fieldName.toLowerCase();
          const isFieldIncludesSource = fieldName.toLowerCase().includes(sourceField.toLowerCase());
          const isSourceIncludesField = sourceField.toLowerCase().includes(fieldName.toLowerCase());
          
          // 为作者昵称字段添加详细的匹配调试日志
          if (universalField === '作者昵称') {
            this.logger.debug('作者昵称字段匹配检查', {
              sourceField: sourceField,
              fieldName: fieldName,
              isExactMatch: isExactMatch,
              isFieldIncludesSource: isFieldIncludesSource,
              isSourceIncludesField: isSourceIncludesField,
              sourceSite: sourceSite
            });
          }
          
          return isExactMatch || isFieldIncludesSource || isSourceIncludesField;
        });
        
        if (matchFound) {
          // 为作者昵称字段添加匹配成功日志
          if (universalField === '作者昵称') {
            this.logger.debug('作者昵称字段匹配成功', {
              fieldName: fieldName,
              sourceSite: sourceSite,
              matchingKeywords: sourceFields
            });
          }
          return universalField;
        }
      }
    }

    return null;
  }

  // 保留但简化的filterOtherInfoFields方法，用于兼容性
  filterOtherInfoFields(unmappedFields, universalData) {
    // 简化实现：直接返回未映射字段，不进行复杂过滤
    const filtered = {};
    
    for (const [fieldName, value] of Object.entries(unmappedFields || {})) {
      if (value && value.toString().trim() !== '') {
        filtered[fieldName] = value;
      }
    }
    
    return filtered;
  }
  


  // 简化的formatOtherInfo方法，仅用于格式化已知的"其他信息"字段
  formatOtherInfo(otherInfo) {
    // 如果输入是字符串，直接返回
    if (typeof otherInfo === 'string') {
      return otherInfo.trim();
    }
    
    // 如果是对象形式，进行简单格式化
    if (typeof otherInfo === 'object' && otherInfo !== null) {
      const parts = [];
      
      for (const [fieldName, value] of Object.entries(otherInfo)) {
        if (value && value.toString().trim() !== '') {
          let formattedValue = value.toString().trim();
          
          // 特殊处理译者字段
          if (fieldName.includes('译者') || fieldName.includes('翻译')) {
            formattedValue = formattedValue.replace(/^:+/, '');
            formattedValue = formattedValue.replace(/\s*\/\s*/g, '、');
            formattedValue = formattedValue.replace(/\s*等\s*$/, '');
          }
          
          parts.push(`${fieldName}：${formattedValue}`);
        }
      }
      
      return parts.join(', ');
    }
    
    return '';
  }

  // 修复链接字段重复问题
  fixDuplicateLinks(universalData, sourceSite) {
    ClipMateLog.debug('===== 开始修复链接字段重复问题 =====');
    
    // 记录所有链接字段
    const linkFields = ['URL', '豆瓣链接', 'douban_url', 'url', '链接'];
    const existingLinks = {};
    
    // 收集所有存在的链接字段
    for (const field of linkFields) {
      if (universalData[field] && universalData[field].toString().trim() !== '') {
        existingLinks[field] = universalData[field];
      }
    }
    
    // 根据媒体类型和来源站点确定主链接字段
    let primaryLinkField = 'URL';
    
    if (this.mediaType === 'book') {
      if (sourceSite === 'douban_book') {
        primaryLinkField = '豆瓣链接';
      } else if (sourceSite === 'bgm_book') {
        primaryLinkField = 'URL';
      }
    } else if (this.mediaType === 'movie' || this.mediaType === 'tv') {
      if (sourceSite === 'douban_movie') {
        primaryLinkField = '豆瓣链接';
      } else if (sourceSite === 'imdb') {
        primaryLinkField = 'IMDB';
      } else if (sourceSite === 'tmdb') {
        primaryLinkField = 'TMDB';
      } else if (sourceSite === 'bgm_movie') {
        primaryLinkField = 'Bangumi';
      }
    } else if (this.mediaType === 'game') {
      if (sourceSite === 'steam') {
        primaryLinkField = 'Steam';
      } else if (sourceSite === 'douban_game') {
        primaryLinkField = '豆瓣链接';
      }
    } else if (this.mediaType === 'social') {
      // 社交媒体平台特定的主链接字段处理
      const socialPlatformMainLink = {
        'douban_social': '豆瓣链接',
        'bilibili_social': 'URL',
        'kuaishou_social': 'URL',
        'xiaohongshu_social': 'URL',
        'weibo_social': 'URL',
        'instagram_social': 'URL',
        'x_social': 'URL'
      };
      
      if (sourceSite && socialPlatformMainLink[sourceSite]) {
        primaryLinkField = socialPlatformMainLink[sourceSite];
      }
    }
    
    
    // 如果主链接字段没有值，尝试从其他链接字段获取值
    if (!universalData[primaryLinkField] || universalData[primaryLinkField].toString().trim() === '') {
      for (const [field, value] of Object.entries(existingLinks)) {
        if (field !== primaryLinkField && value && value.toString().trim() !== '') {
          universalData[primaryLinkField] = value;
          break;
        }
      }
    }
    
    // 特别处理社交媒体类型：确保URL字段始终有值
    if (this.mediaType === 'social' && !universalData['URL'] && primaryLinkField !== 'URL' && universalData[primaryLinkField]) {
      universalData['URL'] = universalData[primaryLinkField];
    }
    
    // 清理重复的链接字段，只保留主链接字段
    for (const field of linkFields) {
      if (field !== primaryLinkField && universalData[field]) {
        delete universalData[field];
      }
    }
    
  }

  // 字段重命名功能
  renameField(data, oldName, newName) {
    if (data.hasOwnProperty(oldName)) {
      data[newName] = data[oldName];
      delete data[oldName];
    }
    return data;
  }

  // 字段排序功能
  sortFields(data, fieldOrder) {
    const sortedData = {};
    
    // 按指定顺序添加字段
    for (const fieldName of fieldOrder) {
      if (data.hasOwnProperty(fieldName)) {
        sortedData[fieldName] = data[fieldName];
      }
    }
    
    // 添加剩余的字段
    for (const [fieldName, value] of Object.entries(data)) {
      if (!sortedData.hasOwnProperty(fieldName)) {
        sortedData[fieldName] = value;
      }
    }
    
    return sortedData;
  }
  
  // 清理字段数据，支持表头模式
  cleanFields(fields, forTableHeader = false) {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(fields)) {
      // 表头模式：保留所有字段，包括空值字段
      if (forTableHeader) {
        cleaned[key] = typeof value === 'string' ? value.trim() : value;
      }
      // 内容模式：过滤空值字段
      else if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = typeof value === 'string' ? value.trim() : value;
      }
    }
    
    return cleaned;
  }
}

// 导出映射器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = UniversalFieldMapper;
} else {
  window.UniversalFieldMapper = UniversalFieldMapper;
}