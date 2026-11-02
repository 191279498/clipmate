/**
 * URL 规范化（v2.5.91）
 *
 * 解决什么问题
 * ------------
 * 社媒站点里有一半的提取器没有 `extractUrl()`，`SocialFieldsBuilder.build()` 的兜底
 * 就直接把 `location.href` 写进 URL 字段。而地址栏是「用户怎么进来的」的产物：
 *
 *   - 快手详情页真机必带 `?authorId=…&streamSource=…`
 *   - 小红书笔记带 `?xsec_token=…`，这个参数**会过期**，过期后链接直接 404
 *   - Instagram 带 `?igsh=…`、TikTok 带 `?is_from_webapp=1`、B站带 `?spm_id_from=…`
 *
 * 结果就是：同一个作品，从推荐流点进去和从搜索点进去，URL 字段不一样；
 * 存下来的地址过几天还打不开。这违反「同一作品任何入口必须同一字符串」。
 *
 * 做法
 * ----
 * 按域名分派，每条规则只做一件事：**把地址还原成作品自己的地址**。
 *
 *   - 认出站点了：返回规范地址（绝对地址、去掉临时参数）
 *   - 认不出站点 / 地址不合法 / 规则匹配不上：**原样返回**
 *
 * 最后一条是关键：宁可不改，也不能把一个能打开的地址改坏。
 *
 * 三条硬约束（单测里有对应用例）
 * ----------------------------
 *   1. **幂等**：normalize(normalize(x)) === normalize(x)
 *   2. **保留必要参数**：YouTube 的 `?v=`、B站的 `?p=` 一个都不许删
 *   3. **认不出原样返回**：任意未知域名、非法字符串，输入什么输出什么
 */
(function (global) {
  'use strict';

  /**
   * 安全解析地址
   * @param {string} href
   * @returns {URL|null}
   */
  function parse(href) {
    if (!href || typeof href !== 'string') return null;
    try {
      const u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u;
    } catch (e) {
      return null;
    }
  }

  /** 去掉末尾斜杠再比较，避免 `/p/abc` 与 `/p/abc/` 被当成两种形态 */
  function trimTrailingSlash(path) {
    return String(path || '').replace(/\/+$/, '');
  }

  /* ============================ 抖音 ============================ */

  /**
   * 抖音
   *
   * 规范形态只有两种：
   *   - 视频 `https://www.douyin.com/video/<id>`
   *   - 图文 `https://www.douyin.com/note/<id>`
   *
   * 这里只处理能从上文确定的形态：
   *   - 路径已经是 `/video/<id>` 或 `/note/<id>` → 原样规范化（去掉 query）
   *   - 弹窗/搜索/主页带 `modal_id=<id>` → 类型未知，按 `/video/<id>`（与弹窗提取器默认一致，
   *     且实测 `/video/<id>` 会自动 302 到 `/note/<id>`）
   *
   * 图文要正确输出 `/note/`，靠的是 `douyin-modal.js` 里的图文判定（它有 RENDER_DATA / fiber），
   * 不是这里 —— 只看地址无法区分图文和视频。
   */
  function douyin(u) {
    const p = trimTrailingSlash(u.pathname);
    let m = p.match(/^\/(video|note)\/(\d{6,25})$/);
    if (m) return 'https://www.douyin.com/' + m[1] + '/' + m[2];

    const modal = u.searchParams.get('modal_id');
    if (modal && /^\d{6,25}$/.test(modal)) {
      return 'https://www.douyin.com/video/' + modal;
    }

    // v2.7.11：作者个人主页 `/user/<sec_uid>`（人物档案用）。
    // **必须放在 modal_id 判断之后** —— `/user/<sec_uid>?modal_id=<作品ID>` 是
    // 「在主页上点开的作品弹窗」，那是作品，不是主页；放前面会把作品地址写成主页。
    // 主页地址常挂 `?from_tab_name=main` 这类定位参数，一律丢掉。
    const home = p.match(/^\/user\/([A-Za-z0-9_-]{10,200})$/);
    if (home) return 'https://www.douyin.com/user/' + home[1];

    return '';
  }

  /* ============================ 快手 ============================ */

  /**
   * 快手
   *
   * 真机详情地址必带 `?authorId=…&streamSource=…`（2026-10-28 记录），
   * `authorId` 是作者的内部 userId，跟这条作品无关，必须去掉。
   *
   * 三种路径形态都归一成 `/short-video/<id>`：
   *   `/short-video/<id>`、`/photo/<id>`、`/fw/photo/<id>`
   */
  function kuaishou(u) {
    const p = trimTrailingSlash(u.pathname);
    const m = p.match(/^\/(?:fw\/)?(?:short-video|photo)\/([A-Za-z0-9_-]{6,40})$/);
    if (m) return 'https://www.kuaishou.com/short-video/' + m[1];
    // v2.7.17：个人主页 `/profile/<userId>`。
    // 不加这条时主页地址会落到 `return ''` —— 而规范化在规则返回空串时是**原样返回 href**，
    // 于是 `?source=SEARCH` 这类来源标记会一起被存进档案（表面看不出问题，小红书 v2.7.16
    // 踩过同一个坑）。主页地址一律丢掉查询串。
    const h = p.match(/^\/profile\/([A-Za-z0-9_-]{6,64})$/);
    if (h) return 'https://www.kuaishou.com/profile/' + h[1];
    return '';
  }

  /* =========================== 小红书 =========================== */

  /**
   * 小红书
   *
   * 笔记 id 是 24 位十六进制。地址栏带 `xsec_token` / `xsec_source` 等参数。
   *
   * **`xsec_token` 必须保留** —— 2026-10-28 真机对照实测（同一篇笔记 6ae09c8d0000000024006334）：
   *   - 不带 token：`https://www.xiaohongshu.com/explore/<id>` → **跳 /404**
   *     「当前笔记暂时无法浏览，请打开小红书App扫码查看」
   *   - 带 token  ：正常渲染，正文 1815~1835 字
   *
   * 所以这里只去掉 `xsec_source`（来源标记，与笔记身份无关），token 原样带回来。
   * token 本身会过期（2026-10-22 记录），但那是小红书的机制，去掉只会让链接**立刻**失效。
   *
   * `/discovery/item/<id>` 是老形态，统一成 `/explore/<id>`。
   */
  function xiaohongshu(u) {
    const p = trimTrailingSlash(u.pathname);

    // 个人主页 `/user/profile/<24位>`（v2.7.16 人物档案）：
    // 返回**干净地址**，不带 xsec_token。跟抖音 `/user/<sec_uid>` 一个口径：
    // token 是临时令牌（隔一会儿就过期），存进档案没有意义，只留能唯一指人的 userId。
    // 必须排在笔记那条**之前**：不排会掉进下面的正则，主页地址被规范成空字符串。
    const home = p.match(/^\/user\/profile\/([0-9a-fA-F]{16,32})$/i);
    if (home) return 'https://www.xiaohongshu.com/user/profile/' + home[1];

    const m = p.match(/^\/(?:explore|discovery\/item)\/([0-9a-f]{16,32})$/i);
    if (!m) return '';

    const base = 'https://www.xiaohongshu.com/explore/' + m[1];

    // 从原始 query 里取**未解码**的 token：token 里可能出现 `+` `/` `=`，
    // 用 searchParams.get 会把 `+` 解成空格，拼回去就废了。
    const tokenMatch = /[?&]xsec_token=([^&#]*)/.exec(u.search || '');
    const token = tokenMatch ? tokenMatch[1] : '';
    return token ? base + '?xsec_token=' + token : base;
  }

  /* ============================ 微博 ============================ */

  /**
   * 微博
   *
   *   - 移动版 `m.weibo.cn/detail/<id>` 与 `/status/<id>` → `https://m.weibo.cn/detail/<id>`
   *   - 主站 `weibo.com/<uid>/<mid>` → 原样（去掉 `?refer_flag=…` 这类参数）
   *   - 个人页 `weibo.com/u/<uid>` → 原样
   */
  function weibo(u) {
    const host = u.hostname;
    const p = trimTrailingSlash(u.pathname);

    if (host === 'm.weibo.cn') {
      const m = p.match(/^\/(?:detail|status)\/([A-Za-z0-9]+)$/);
      if (m) return 'https://m.weibo.cn/detail/' + m[1];
      return '';
    }

    const detail = p.match(/^\/(\d{5,20})\/([A-Za-z0-9]{5,24})$/);
    if (detail) return 'https://weibo.com/' + detail[1] + '/' + detail[2];

    const user = p.match(/^\/u\/(\d{3,20})$/);
    if (user) return 'https://weibo.com/u/' + user[1];

    // v2.7.26：个人主页的另一种形态 `weibo.com/<自定义域名>`（如 `weibo.com/renminribao`）。
    // 一级功能路由（`/hot`、`/tv`、`/login`…）不认，返回空串交给通用清理。
    // 这里只做「去掉来源参数、保留域名」，**不拿它猜 uid** —— 真正的网址由提取器用
    // 页头粉丝链接里的 uid 拼成 `/u/<uid>`，域名只进「账号名」列。
    const WB_RESERVED = /^(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)$/;
    const domain = p.match(/^\/([A-Za-z][A-Za-z0-9_-]{1,29})$/);
    if (domain && !WB_RESERVED.test(domain[1].toLowerCase())) {
      return 'https://weibo.com/' + domain[1];
    }

    return '';
  }

  /* ============================ B站 ============================ */

  /**
   * B站
   *
   * `?p=<分P>` 是内容的一部分（同一 BV 号的不同分P），**必须保留**；
   * `spm_id_from` / `vd_source` / `share_source` 这类来源标记一律去掉。
   *
   * BV 号大小写敏感，原样保留。
   */
  function bilibili(u) {
    const p = trimTrailingSlash(u.pathname);
    const m = p.match(/^\/video\/(BV[A-Za-z0-9]{8,12}|av\d{5,20})$/);
    if (!m) return '';
    const base = 'https://www.bilibili.com/video/' + m[1];
    const page = u.searchParams.get('p');
    if (page && /^\d{1,4}$/.test(page) && page !== '1') return base + '?p=' + page;
    return base;
  }

  /* =========================== YouTube =========================== */

  /**
   * YouTube
   *
   * `v=<id>` 是作品身份，**必须保留**；`list` / `index` / `t` / `si` / `pp` 全去掉。
   * `youtu.be/<id>` 短链展开成标准 watch 地址。
   *
   * v2.7.23：补**频道页**（`/@handle`、`/channel/UC…`）。
   * 原来只认作品页，主页地址会整串原样写进 URL 字段（带 `?si=`、`?sub_confirmation=1`
   * 这类来源参数，同一个人从不同入口进来就是两个字符串）。
   * 频道子页（`/videos`、`/about`…）统一归到频道主页 —— 它们本来就是同一个人的档案。
   */
  function youtube(u) {
    const host = u.hostname;

    if (host === 'youtu.be') {
      const id = trimTrailingSlash(u.pathname).replace(/^\//, '').split('/')[0];
      if (/^[A-Za-z0-9_-]{6,20}$/.test(id)) return 'https://www.youtube.com/watch?v=' + id;
      return '';
    }

    const p = trimTrailingSlash(u.pathname);

    if (p === '/watch') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{6,20}$/.test(v)) return 'https://www.youtube.com/watch?v=' + v;
      return '';
    }

    const shorts = p.match(/^\/shorts\/([A-Za-z0-9_-]{6,20})$/);
    if (shorts) return 'https://www.youtube.com/shorts/' + shorts[1];

    // 频道页（v2.7.23）。
    // 子页清单与 media-detector / extractor-factory 的 person 正则同一口径，
    // 三处必须一起改：少一处，子页的网址就会和主页存成两个字符串。
    const YT_SUB = '(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search)';

    const channel = p.match(new RegExp('^\\/channel\\/(UC[A-Za-z0-9_-]{10,40})(?:\\/' + YT_SUB + ')?$'));
    if (channel) return 'https://www.youtube.com/channel/' + channel[1];

    // `@handle` 大小写敏感（`@MediaStorm` 与 `@mediastorm` 会被 YouTube 视作同一个，
    // 但页面显示的是小写那份）—— 这里**原样保留**，不擅自改名，
    // 免得把用户地址栏的东西偷偷改写；真正要统一大小写的地方是提取器。
    const handle = p.match(new RegExp('^\\/@([A-Za-z0-9._-]{2,40})(?:\\/' + YT_SUB + ')?$'));
    if (handle) return 'https://www.youtube.com/@' + handle[1];

    return '';
  }

  /* ============================ TikTok ============================ */

  /**
   * TikTok
   *
   * `?is_from_webapp=1&sender_device=pc` 是来源标记，去掉。
   * 用户名大小写敏感，原样保留。
   *
   * v2.5.96：补**个人主页**（`/@someone`）。原来只认作品页，
   * 主页地址带着 `?lang=ru-RU` 这类语言/来源参数会原样写进 URL 字段，
   * 同一个人从不同入口进来就是两个字符串。
   */
  function tiktok(u) {
    const p = trimTrailingSlash(u.pathname);
    const m = p.match(/^\/@([A-Za-z0-9_.]{2,40})\/(video|photo)\/(\d{6,25})$/);
    if (m) return 'https://www.tiktok.com/@' + m[1] + '/' + m[2] + '/' + m[3];
    const profile = p.match(/^\/@([A-Za-z0-9_.]{2,40})$/);
    if (profile) return 'https://www.tiktok.com/@' + profile[1];
    return '';
  }

  /* =========================== Instagram =========================== */

  /** Instagram 的一级功能路由段（不是用户名）。与 instagram-inline-data 那份保持同口径。 */
  const IG_RESERVED = {
    p: 1, reel: 1, reels: 1, tv: 1, stories: 1, highlights: 1, explore: 1,
    accounts: 1, direct: 1, settings: 1, about: 1, legal: 1, api: 1,
    developer: 1, emails: 1, session: 1, challenge: 1, web: 1, directory: 1,
    oauth: 1, privacy: 1, terms: 1, press: 1, blog: 1, jobs: 1, help: 1,
    your_activity: 1, nametag: 1, lite: 1, download: 1, emoji: 1, ads: 1
  };

  /**
   * Instagram
   *
   * `?igsh=…` / `?img_index=…` 去掉；`/reels/` 统一成 `/reel/`（官方规范路径）。
   * 结尾补一个 `/`，与官方地址一致。
   *
   * v2.7.20：补上个人主页 `/<username>`（人物档案用，单段路径）。
   * 不加这条的话，主页地址会被下面各条全落空 → 原样返回带 `?hl=zh-cn` 的地址，
   * 档案里存的网址就带着语言标记（跟抖音 `?modal_id=`、快手 `?source=` 同款问题）。
   */
  function instagram(u) {
    const p = trimTrailingSlash(u.pathname);

    const post = p.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,20})$/);
    if (post) {
      const kind = post[1] === 'reels' ? 'reel' : post[1];
      return 'https://www.instagram.com/' + kind + '/' + post[2] + '/';
    }

    const story = p.match(/^\/stories\/([A-Za-z0-9_.]{2,40})\/(\d{5,25})$/);
    if (story) return 'https://www.instagram.com/stories/' + story[1] + '/' + story[2];

    // 个人主页：单段 `/<username>`。必须排除 IG 的一级功能路由 ——
    // `/explore`、`/settings` 这些也是单段，不排除就会被规范成"某个人的主页"。
    const profile = p.match(/^\/([A-Za-z0-9_.]{1,30})$/);
    if (profile && !IG_RESERVED[profile[1]]) {
      return 'https://www.instagram.com/' + profile[1] + '/';
    }

    return '';
  }

  /**
   * X（Twitter）
   *
   *   - 主页 `/<handle>`（单段）→ `https://x.com/<handle>`（v2.7.27）
   *   - about 子页 `/<handle>/about` → `https://x.com/<handle>`
   *   - 单条推文 `/<handle>/status/<id>` 等不认（返回空串走通用清理）
   *
   * handle 只含字母数字下划线（X 的规矩），一级功能路由（`/home`、`/search`、
   * `/i/…`）不认成 handle —— 与 media-detector 的负向断言同口径。
   */
  const X_RESERVED = /^(?:home|explore|search|i|settings|notifications|messages|compose|intent|personalize|privacy|tos|login|signup|logout|session|account|share|hashtag|trends|dev|jobs|help|welcome|verify|flow|articles|events|browse)$/;

  function x(u) {
    const p = trimTrailingSlash(u.pathname);

    const about = p.match(/^\/([A-Za-z0-9_]{1,15})\/about$/);
    if (about && !X_RESERVED.test(about[1].toLowerCase())) {
      return 'https://x.com/' + about[1];
    }

    const profile = p.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (profile && !X_RESERVED.test(profile[1].toLowerCase())) {
      return 'https://x.com/' + profile[1];
    }

    return '';
  }


  /* ============================ 分派表 ============================ */

  /**
   * 域名 → 规则
   * 值写成数组，因为同一个站可能有多个域名（www / m / 短链）
   */
  const ROUTES = [
    { hosts: ['www.douyin.com', 'douyin.com', 'v.douyin.com'], fn: douyin },
    { hosts: ['www.kuaishou.com', 'kuaishou.com', 'v.kuaishou.com'], fn: kuaishou },
    { hosts: ['www.xiaohongshu.com', 'xiaohongshu.com'], fn: xiaohongshu },
    { hosts: ['weibo.com', 'www.weibo.com', 'm.weibo.cn'], fn: weibo },
    { hosts: ['www.bilibili.com', 'bilibili.com', 'm.bilibili.com'], fn: bilibili },
    { hosts: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'], fn: youtube },
    { hosts: ['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'], fn: tiktok },
    { hosts: ['www.instagram.com', 'instagram.com'], fn: instagram },
    { hosts: ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'], fn: x },
    { hosts: ['space.bilibili.com'], fn: bilibiliSpace }
  ];

  /**
   * B站个人空间（v2.7.28）
   *
   * `space.bilibili.com/<mid>` 及它自己的 tab 子页 → 归一成主页 `https://space.bilibili.com/<mid>`。
   * 与作品页 `www.bilibili.com/video/...` 是**两个域名**，互不相干。
   * 从 `/dynamic`、`/upload` 等子页提取出来的记录，网址必须统一指向主页，
   * 否则同一位 UP 主在不同 tab 下会存出两条记录。
   */
  function bilibiliSpace(u) {
    const p = trimTrailingSlash(u.pathname);
    const m = p.match(/^\/(\d{1,15})(?:\/(?:dynamic|upload|lists|pugv|series|channels|favlist|following|fans|article|audio|album|comic|bangumi|cheese|video))?$/);
    return m ? 'https://space.bilibili.com/' + m[1] : '';
  }

  /**
   * 规范化入口
   *
   * @param {string} href 地址（一般是 location.href 或提取器给出的地址）
   * @returns {string} 规范地址；认不出/不合法/规则未命中时**原样返回 href**
   */
  function normalize(href) {
    const u = parse(href);
    if (!u) return href || '';

    const host = u.hostname.toLowerCase();
    for (const route of ROUTES) {
      if (route.hosts.indexOf(host) < 0) continue;
      let result = '';
      try {
        result = route.fn(u) || '';
      } catch (e) {
        result = ''; // 规则内部异常也不能把原地址吃掉
      }
      return result || href;
    }

    return href; // 认不出的站：宁可不改
  }

  const api = {
    normalize,
    // 下面只给单测用：验证每条规则单独拿出来也守得住约束
    _routes: ROUTES,
    _parse: parse,
    _rules: {
      douyin, kuaishou, xiaohongshu, weibo, bilibili, bilibiliSpace, youtube, tiktok, instagram, x
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.UrlNormalizer = api;
  }
})(typeof window !== 'undefined' ? window : null);
