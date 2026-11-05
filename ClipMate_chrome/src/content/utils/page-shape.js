/**
 * 页面形态判定（v2.10.0）
 *
 * 只回答一件事：**当前这个地址，是不是「单独一条内容」的详情页？**
 * 用来决定页面上那个大提取按钮该不该出现。
 *
 * 为什么不复用 media-detector 的规则
 * ----------------------------------
 * media-detector 判的是「提取成什么类型」（person / social / game …），
 * 它的社交站规则是 `patterns: ['/']` —— 首页、热门、搜索页、单条详情**全都算 social**，
 * 根本分不出「信息流」和「一条内容」。这里补的正是这一层。
 *
 * 覆盖范围（用户 2026-11-04 拍板：只做「有逐条小按钮」的站，其余站不动）
 * ----------------------------------------------------------------------
 * · 微博（weibo.com / m.weibo.cn）：首页 / 热门 / 搜索等列表页藏大按钮，
 *   单条博文详情页显示；搜索页 s.weibo.com 整页都是内容流，永远藏。
 * · X（x.com）：首页 / 探索 / 搜索 / 通知等藏，单条推文页显示。
 * · Instagram：**刻意不在这里管** —— v2.7.4 起它已有自己的入口显隐
 *   （`_syncInstagramEntryVisibility` + 弹层跟随），再管一遍会跟弹层打架。
 * · 抖音 / 快手 / 小红书 / B站 / YouTube：**没有逐条小按钮**，藏了就没有入口，
 *   所以一个都不碰 —— 没配规则 = 照旧显示，行为与 v2.9.9 完全一致。
 *
 * 两条兜底原则
 * ------------
 * ① 没登记的站点 → `unknown` → 不藏（宁可多一个按钮，也不能让用户没入口）。
 * ② 人物档案页（作者主页 / 影人页）→ 永远显示，它提的是整页档案，不是某条内容。
 */
(function (global) {
  'use strict';

  /** 去掉 www. 前缀：weibo.com 与 www.weibo.com 共用一份规则 */
  function normalizeHost(host) {
    return String(host || '').toLowerCase().replace(/^www\./, '');
  }

  /**
   * 站点规则。
   *   detail —— 单条内容详情页（显示大按钮）
   *   allow  —— 不是详情页、但「整页本身有可提取内容」的路径（显示大按钮）。
   *             典型：手机版微博的作者主页 `/profile/<uid>` —— media-detector 那边
   *             手机版没有 person 规则，会判成 social，不在这里放行就会被误藏。
   * 命中哪一个都算「该显示」，未命中 = 信息流 = 藏。
   */
  var RULES = {
    // 微博主站：/<uid>/<mid>（单条微博）、/detail/<mid>
    // 作者主页 /u/<uid>、/<自定义域名> 不写在这里 —— 它们由 mediaType=person 单独放行
    'weibo.com': {
      detail: [
        /^\/\d{5,}\/[A-Za-z0-9]{4,16}\/?$/,
        /^\/detail\/[A-Za-z0-9]{4,16}\/?$/
      ],
      allow: []
    },
    // 手机版微博：/detail/<mid>、/status/<mid>；主页 /profile/<uid>、/u/<uid> 放行
    'm.weibo.cn': {
      detail: [
        /^\/detail\/[A-Za-z0-9]{4,16}\/?$/,
        /^\/status\/[A-Za-z0-9]{4,16}\/?$/
      ],
      allow: [
        /^\/profile\//,
        /^\/u\//
      ]
    },
    // X：/<handle>/status/<数字>、/i/status/<数字>
    // 个人主页 /<handle>、/<handle>/about 由 mediaType=person 放行
    'x.com': {
      detail: [
        /^\/[A-Za-z0-9_]{1,15}\/status\/\d+/,
        /^\/i\/status\/\d+/
      ],
      allow: []
    }
  };

  /** 整页都是内容流、永远没有「单条详情」形态的站点 → 永远藏 */
  var ALWAYS_FEED_HOSTS = ['s.weibo.com'];

  /**
   * 「这片路径只可能是列表」白名单（v2.11.4）。
   *
   * 与 RULES 的语义**正好相反**，所以必须单独一张表：
   *   RULES      —— 配了规则，没命中就**算信息流**。适用于整站几乎都是内容流的站（微博 / X）。
   *   LIST_PAGES —— 只认这几条路径，没命中就**保持原样（unknown，不藏）**。
   *                 适用于「列表只是站内一小块」的站（豆瓣），
   *                 否则 /review/ /celebrity/ /trailer/ 这些页面会被误判成信息流、大按钮直接消失。
   *
   * 命中即 `feed`：藏大按钮（改挂逐条小按钮）、并且按 feed 开「滚动自动关浮窗」。
   */
  var LIST_PAGES = {
    // 影视收藏三态（v2.11.4）：想看 / 在看 / 看过。
    // 网格与列表两种视图是同一地址（只差 ?mode=），pathname 完全一致，一条规则覆盖。
    'movie.douban.com': [
      /^\/people\/[^/]+\/(wish|do|collect)\/?$/i
    ],
    // 读书收藏三态（v2.11.5）：想读 / 在读 / 读过。地址词与影视同名，靠域名区分。
    'book.douban.com': [
      /^\/people\/[^/]+\/(wish|do|collect)\/?$/i
    ],
    // 游戏收藏三态（v2.11.5）：想玩 / 在玩 / 玩过。
    // 三者是同一个路径 `/people/<id>/games`，靠 ?action=wish|do|collect 区分，
    // 所以只看 pathname 就够，不用碰 query。host 已被 normalizeHost 去掉 www.
    'douban.com': [
      /^\/people\/[^/]+\/games\/?$/i
    ]
  };

  /** 命中列表页时告诉调用方这是哪一类（决定用哪个提取器）；没命中返回 null */
  var LIST_KINDS = {
    'movie.douban.com': 'movie',
    'book.douban.com': 'book',
    'douban.com': 'game'
  };

  /**
   * v2.11.5：给 content-main 的初始化用。
   *
   * 为什么必须有这个出口：v2.11.4 把「挂小按钮」放在 `if (!mediaType)` 分支里，
   * 前提是收藏页会被判成「没有媒体类型」—— 实测是错的：路径不命中 /subject/ 后
   * media-detector 会落到按正文兜底，返回字符串 'unknown'（真值）或 'movie'，
   * 那个分支一次都没进过，整套功能从未生效。
   * 现在初始化不再问媒体类型，直接用这张白名单认页面。
   */
  function doubanListKind(hostname, pathname) {
    var host = normalizeHost(hostname);
    if (!matchAny(LIST_PAGES[host], String(pathname || '/'))) return null;
    return LIST_KINDS[host] || null;
  }

  /**
   * 需要盯着地址变化的站点（站内跳转不刷新文档，不盯就会「进了详情页还没按钮」）。
   *
   * v2.12.2 扩到「所有有个人档案页的社交站」：皮肤与显隐只有 `_applyPageShape()`
   * 一个出口，而它原来只在 init / 读配置 / 这里的地址监听三处跑。快手 / 小红书 /
   * YouTube / TikTok 都是「换地址不换文档」的 SPA —— 从主页点开一条作品时没人重算，
   * 按钮就一直顶着档案例皮的「整理档案」，点下去提的却是单条作品。
   * 这些站点的非档案页在 shapeOf 里一律是 unknown（没有 RULES 规则），
   * 所以重算只会换皮肤，不会碰任何站点自己的显隐逻辑。
   *
   * **刻意排除两个站**：
   *   · www.douyin.com —— 抖音会把 `?modal_id=` 抹掉，地址监听会在弹层还开着时
   *     误判成「回到主页」把皮肤换回档案装。它由 `_startDouyinPersonSkinWatcher()`
   *     按「弹层本身在不在」判断。
   *   · www.instagram.com —— 有自己的入口显隐（_syncInstagramEntryVisibility），
   *     再管一遍会跟弹层打架。
   */
  var WATCHED_HOSTS = [
    'weibo.com', 'm.weibo.cn', 'x.com', 's.weibo.com',
    'kuaishou.com',
    'xiaohongshu.com',
    'youtube.com', 'm.youtube.com',
    'tiktok.com',
    'space.bilibili.com'
  ];

  function matchAny(list, path) {
    if (!list || !list.length) return false;
    for (var i = 0; i < list.length; i++) {
      try {
        if (list[i].test(path)) return true;
      } catch (e) { /* 单条规则写错不影响其他规则 */ }
    }
    return false;
  }

  /**
   * @param {{hostname?: string, pathname?: string, mediaType?: string}} ctx
   * @returns {'person'|'detail'|'feed'|'unknown'} person=档案页 detail=有单条内容/放行页 feed=信息流 unknown=没配规则
   */
  function shapeOf(ctx) {
    var host = normalizeHost(ctx && ctx.hostname);
    var path = String((ctx && ctx.pathname) || '/');

    // ① 人物档案页（作者主页 / 影人页）：永远算「有内容」
    if (ctx && ctx.mediaType === 'person') return 'person';

    // ② 整页内容流
    if (ALWAYS_FEED_HOSTS.indexOf(host) !== -1) return 'feed';

    // ②.5 只认白名单的列表页（豆瓣影视 / 读书 / 游戏收藏页）—— 没命中继续往下走，绝不改名
    if (doubanListKind(host, path)) return 'feed';

    // ③ 没配规则的站点：不知道，保持原样
    var rules = RULES[host];
    if (!rules) return 'unknown';

    // ④ 详情页 / 放行路径
    if (matchAny(rules.detail, path) || matchAny(rules.allow, path)) return 'detail';

    // ⑤ 配了规则但没命中 → 信息流
    return 'feed';
  }

  function shouldHideMainButton(ctx) {
    return shapeOf(ctx) === 'feed';
  }

  /** 这个站需不需要盯着地址变化（只有本次纳入的几站，其他站一个定时器都不多） */
  function watches(hostname) {
    return WATCHED_HOSTS.indexOf(normalizeHost(hostname)) !== -1 ||
      WATCHED_HOSTS.indexOf(String(hostname || '').toLowerCase()) !== -1;
  }

  var PageShape = {
    normalizeHost: normalizeHost,
    shapeOf: shapeOf,
    shouldHideMainButton: shouldHideMainButton,
    watches: watches,
    doubanListKind: doubanListKind,
    RULES: RULES,
    LIST_PAGES: LIST_PAGES,
    LIST_KINDS: LIST_KINDS,
    ALWAYS_FEED_HOSTS: ALWAYS_FEED_HOSTS
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PageShape;
  if (global) global.PageShape = PageShape;
})(typeof window !== 'undefined' ? window : null);
