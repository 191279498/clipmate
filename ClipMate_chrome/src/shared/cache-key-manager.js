/**
 * CacheKeyManager - 统一缓存键管理器
 *
 * 标准化缓存键格式：clipmate:{mediaType}:{site}:{scope}:{id}
 * 支持旧键格式的双向读取迁移（Phase 1）。
 *
 * 使用方式：
 *   CacheKeyManager.createKey('social', 'instagram_social', 'page', 'p/abc123')
 *   // → 'clipmate:social:instagram_social:page:p/abc123'
 *
 *   CacheKeyManager.parseKey('clipmate:social:instagram_social:page:p/abc123')
 *   // → { mediaType: 'social', site: 'instagram_social', scope: 'page', id: 'p/abc123' }
 *
 *   CacheKeyManager.legacyKey('social', 'instagram_social', 'page', 'p/abc123')
 *   // → 'www.instagram.com/p/abc123'（旧 generateCacheKey 格式）
 */
(function(global) {
  'use strict';

  const PREFIX = 'clipmate';
  const SEP = ':';

  // siteName → hostname 映射表（用于旧键格式兼容）
  const SITE_HOSTNAME = {
    // 社交
    instagram_social:  'www.instagram.com',
    douyin_social:     'www.douyin.com',
    xiaohongshu_social:'www.xiaohongshu.com',
    weibo_social:      'weibo.com',
    weibo_mobile_social:'m.weibo.cn',
    x_social:          'x.com',
    tiktok_social:     'www.tiktok.com',
    youtube_social:    'www.youtube.com',
    bilibili_social:   'www.bilibili.com',
    kuaishou_social:   'www.kuaishou.com',
    // 书籍
    douban_book:       'book.douban.com',
    qidian:            'www.qidian.com',
    fanqie:            'fanqienovel.com',
    '17k':             'www.17k.com',
    goodreads:         'www.goodreads.com',
    bgm_book:          'bgm.tv',
    // 影视
    douban_movie:      'movie.douban.com',
    imdb:              'www.imdb.com',
    bgm_movie:         'bgm.tv',
    // v2.11.0：红果短剧（siteName 见 HongguoMovieExtractor.siteName）
    hongguo:           'hongguoduanju.com',
    // 游戏
    douban_game:       'www.douban.com',
    steam:             'store.steampowered.com',
    metacritic:        'www.metacritic.com',
    xiaoheihe:         'www.xiaoheihe.cn',
    mobygames:         'www.mobygames.com',
    bgm_game:          'bgm.tv',
  };

  // v2.7.11：新增 person（人物档案，含影人/作者档案与社交账号两种形态）。
  // 不在这个白名单里 createKey() 会 warn 并可能把键算错，所以必须同步加。
  const MEDIA_TYPES = ['book', 'movie', 'tv', 'game', 'social', 'person'];
  const SCOPES = ['page', 'author', 'rating'];

  /**
   * 作者主页 URL 归一化规则
   *
   * 背景：作者主页 URL 直接作为作者级缓存键。抖音等站点的作者链接常常带
   * ?from_tab_name=... / &vid=... 之类的查询参数，同一个作者的不同作品会算
   * 出不同的键 → 缓存永远 miss → 每次提取都重新打开作者主页。
   * 这里把 URL 收敛成 "https://host/固定路径/{唯一ID}" 形式，只保留能唯一
   * 标识作者的部分，查询参数和 hash 一律丢弃。
   */
  const AUTHOR_URL_RULES = {
    douyin_social: {
      match: /(?:^|\/\/)(?:www\.)?douyin\.com\/user\/([^\/?#]+)/i,
      build: function(id) { return 'https://www.douyin.com/user/' + id; }
    },
    xiaohongshu_social: {
      match: /(?:^|\/\/)(?:www\.)?xiaohongshu\.com\/user\/profile\/([^\/?#]+)/i,
      build: function(id) { return 'https://www.xiaohongshu.com/user/profile/' + id; }
    },
    kuaishou_social: {
      match: /(?:^|\/\/)(?:www\.)?kuaishou\.com\/profile\/([^\/?#]+)/i,
      build: function(id) { return 'https://www.kuaishou.com/profile/' + id; }
    }
  };

  var M = {};

  /**
   * 归一化缓存 id（目前只对 author 作用域的作者主页 URL 生效）
   *
   * 命中规则时返回规范化 URL；未命中规则（其它站点、非 URL 形式、page 作用域）
   * 原样返回，保证不影响既有行为。
   *
   * @param {string} mediaType
   * @param {string} site
   * @param {string} scope
   * @param {string} id
   * @returns {string} 归一化后的 id
   */
  M.normalizeId = function(mediaType, site, scope, id) {
    if (id === undefined || id === null) return id;
    if (scope !== 'author') return String(id);

    var rule = AUTHOR_URL_RULES[site];
    if (!rule) return String(id);

    var raw = String(id);
    var m = raw.match(rule.match);
    if (!m || !m[1]) return raw;

    return rule.build(m[1]);
  };

  /**
   * 生成标准缓存键
   * @param {string} mediaType - book/movie/tv/game/social
   * @param {string} site - siteName（如 instagram_social）
   * @param {string} scope - page/author/rating
   * @param {string} id - 唯一标识符（URL路径或ID）
   * @returns {string} 标准缓存键
   */
  M.createKey = function(mediaType, site, scope, id) {
    if (!mediaType || !site || !scope || id === undefined || id === null) {
      console.warn('[CacheKeyManager] createKey 参数不足:', { mediaType, site, scope, id });
      return null;
    }
    if (MEDIA_TYPES.indexOf(mediaType) === -1) {
      console.warn('[CacheKeyManager] 未知 mediaType:', mediaType);
    }
    if (SCOPES.indexOf(scope) === -1) {
      console.warn('[CacheKeyManager] 未知 scope:', scope);
    }
    return [PREFIX, mediaType, site, scope, String(M.normalizeId(mediaType, site, scope, id))].join(SEP);
  };

  /**
   * 生成标准缓存键（不做归一化，仅供读取历史键时使用）
   * @returns {string|null}
   */
  M.rawKey = function(mediaType, site, scope, id) {
    if (!mediaType || !site || !scope || id === undefined || id === null) return null;
    return [PREFIX, mediaType, site, scope, String(id)].join(SEP);
  };

  /**
   * 解析标准缓存键为结构体
   * @param {string} key - 标准缓存键
   * @returns {Object|null} { mediaType, site, scope, id } 或 null
   */
  M.parseKey = function(key) {
    if (!key || typeof key !== 'string') return null;
    var parts = key.split(SEP);
    if (parts.length < 5 || parts[0] !== PREFIX) return null;
    return {
      namespace:  parts[0],
      mediaType:  parts[1],
      site:       parts[2],
      scope:      parts[3],
      id:         parts.slice(4).join(SEP) // id 内部可能含有冒号
    };
  };

  /**
   * 验证标准缓存键格式
   * @param {string} key - 缓存键
   * @returns {boolean} 是否合法
   */
  M.validateKey = function(key) {
    var p = M.parseKey(key);
    if (!p) return false;
    return MEDIA_TYPES.indexOf(p.mediaType) !== -1 &&
           SCOPES.indexOf(p.scope) !== -1;
  };

  /**
   * 检测是否为旧格式键
   * @param {string} key
   * @returns {boolean}
   */
  M.isLegacyKey = function(key) {
    if (!key || typeof key !== 'string') return false;
    // 新格式以 clipmate: 开头
    return key.indexOf(PREFIX + SEP) !== 0;
  };

  /**
   * 生成旧格式缓存键（兼容 Phase 1 双读用）
   * @returns {string|null}
   */
  M.rawLegacyKey = function(mediaType, site, scope, id) {
    if (!mediaType || !site || !scope || id === undefined || id === null) return null;

    if (scope === 'page') {
      // page 类型的旧格式: hostname + path 或 unifiedKey
      var hostname = SITE_HOSTNAME[site];
      if (hostname) {
        // 提取除了协议和查询参数外的干净路径
        var cleanId = String(id).replace(/^https?:\/\//, '').replace(/^[^\/]+/, '');
        return hostname + cleanId;
      }
      // 无映射的 site 直接返回 id
      return String(id);
    }

    if (scope === 'author') {
      // author 类型的旧格式: site_prefix_authorId
      if (site === 'douyin_social') return 'douyin_authorId_' + id;
      if (site === 'xiaohongshu_social') return 'xiaohongshu_author_id_' + id;
      return site + '_author_' + id;
    }

    if (scope === 'rating') {
      return site + '_rating_' + id;
    }

    return String(id);
  };

  /**
   * 生成旧格式缓存键（对外接口，id 会先归一化）
   * @param {string} mediaType
   * @param {string} site
   * @param {string} scope
   * @param {string} id
   * @returns {string|null}
   */
  M.legacyKey = function(mediaType, site, scope, id) {
    if (id === undefined || id === null) return null;
    return M.rawLegacyKey(mediaType, site, scope, M.normalizeId(mediaType, site, scope, id));
  };

  /**
   * 构造读取候选键列表（按优先级）
   *
   * 顺序：归一化后的新键 → 归一化后的旧键 → 原始新键 → 原始旧键。
   * 后两个用于兼容历史数据（例如带 ?from_tab_name= 的抖音作者链接），
   * 命中后会由 readWithFallback 升迁到归一化键。
   *
   * @returns {Array<{key: string, canonical: boolean}>}
   */
  M.buildReadCandidates = function(mediaType, site, scope, id) {
    var normalized = M.normalizeId(mediaType, site, scope, id);
    var list = [];
    var seen = {};

    function push(key, canonical) {
      if (!key || seen[key]) return;
      seen[key] = true;
      list.push({ key: key, canonical: canonical });
    }

    push(M.rawKey(mediaType, site, scope, normalized), true);
    push(M.rawLegacyKey(mediaType, site, scope, normalized), true);

    if (String(normalized) !== String(id)) {
      push(M.rawKey(mediaType, site, scope, id), false);
      push(M.rawLegacyKey(mediaType, site, scope, id), false);
    }

    return list;
  };

  /**
   * 尝试读取缓存
   *
   * 先读归一化后的标准键与旧键；若 id 本身带参数（历史数据），再退一步读
   * 未归一化的键；任一非首选键命中后，升迁到归一化标准键。
   *
   * @param {Object} cacheManager - CacheManager 实例
   * @param {string} mediaType
   * @param {string} site
   * @param {string} scope
   * @param {string} id
   * @param {Object} [options] - 传给 cacheManager.get 的选项
   * @returns {Promise<any>} 缓存值或 null
   */
  M.readWithFallback = async function(cacheManager, mediaType, site, scope, id, options) {
    var candidates = M.buildReadCandidates(mediaType, site, scope, id);
    if (!candidates.length) return null;

    for (var i = 0; i < candidates.length; i++) {
      var key = candidates[i].key;
      var result = await cacheManager.get(key, options);
      if (result === null || result === undefined) continue;

      // 非首选键命中 → 升迁到归一化标准键，下次直接命中第一位
      if (i > 0) {
        var canonicalKey = candidates[0].key;
        try {
          await cacheManager.set(canonicalKey, result, options);
        } catch (e) {
          console.warn('[CacheKeyManager] 缓存升迁失败:', e);
        }
      }
      return result;
    }

    return null;
  };

  /**
   * 写入缓存，同时写入新旧格式（Phase 2 迁移用）
   * @param {Object} cacheManager - CacheManager 实例
   * @param {string} mediaType
   * @param {string} site
   * @param {string} scope
   * @param {string} id
   * @param {*} value
   * @param {Object} [options] - 传给 cacheManager.set 的选项
   * @returns {Promise<void>}
   */
  M.writeWithLegacy = async function(cacheManager, mediaType, site, scope, id, value, options) {
    var newKey = M.createKey(mediaType, site, scope, id);
    if (!newKey) return;

    // 总是写入新格式
    await cacheManager.set(newKey, value, options);

    // 同时写入旧格式（兼容 Phase 1 期间的旧代码读路径）
    var oldKey = M.legacyKey(mediaType, site, scope, id);
    if (oldKey) {
      await cacheManager.set(oldKey, value, options);
    }
  };

  global.CacheKeyManager = M;

})(window);
