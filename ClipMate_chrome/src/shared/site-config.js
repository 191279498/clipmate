// 站点清单 + 站点级配置解析（v2.5.46）
//
// 这个文件是「设置页里那些站点」的唯一来源：
//   - popup 的「本站设置」用它判断当前是哪个站
//   - options 设置页用它生成站点列表（分组 + 搜索）
//   - 内容脚本用它把「全局默认 + 本站覆盖」算成当前页真正生效的四个开关
//
// 加新网站时要改两处：这里补一条，manifest.json 的 content_scripts.matches 补一行。
// （不自动从 matches 派生，因为 matches 只有 URL 模式，拿不到中文站名和分组。）
(function (global) {
  'use strict';

  // group 顺序即设置页里的分组顺序，改这里就改了界面顺序
  var GROUP_ORDER = ['影视', '书籍', '游戏', '社交'];

  // 一行 = 一个站。domain 是主域名（设置页里这一行存规则用的键），
  // domains 是这个站的其他域名（镜像站、移动版、子站），共用同一条设置。
  // 这样设置页不会因为站点有多个域名而重复长出一堆行。
  var CATALOG = [
    // ---- 影视 ----
    { name: '豆瓣电影', domain: 'movie.douban.com', group: '影视' },
    { name: 'TMDB', domain: 'www.themoviedb.org', group: '影视' },
    { name: 'IMDb', domain: 'www.imdb.com', group: '影视' },
    // Bangumi 的三个域名指向同一套条目数据
    { name: 'Bangumi', domain: 'bgm.tv', domains: ['bangumi.tv', 'chii.in'], group: '影视' },
    // v2.11.0：红果短剧。全站只有「剧集」一种形态，三个域名指向同一套数据
    // （不带 www 的主域、带 www 的、以及实测会跳主域的 novelquickapp）。
    // 三条域名合成一行，设置页不会重复长出三个「红果短剧」。
    { name: '红果短剧', domain: 'hongguoduanju.com', domains: ['www.hongguoduanju.com', 'www.novelquickapp.com'], group: '影视' },

    // ---- 书籍 ----
    { name: '豆瓣读书', domain: 'book.douban.com', group: '书籍' },
    { name: '起点中文网', domain: 'www.qidian.com', domains: ['qidian.com'], group: '书籍' },
    { name: '番茄小说', domain: 'fanqienovel.com', group: '书籍' },
    { name: '17K小说网', domain: 'www.17k.com', group: '书籍' },
    { name: 'Goodreads', domain: 'www.goodreads.com', group: '书籍' },

    // ---- 游戏 ----
    // 豆瓣游戏有两个入口：www.douban.com/game/ 和 game.douban.com/subject/
    { name: '豆瓣游戏', domain: 'www.douban.com', domains: ['game.douban.com'], group: '游戏' },
    { name: 'Steam', domain: 'store.steampowered.com', group: '游戏' },
    { name: 'Metacritic', domain: 'www.metacritic.com', group: '游戏' },
    { name: '小黑盒', domain: 'www.xiaoheihe.cn', group: '游戏' },
    { name: 'MobyGames', domain: 'www.mobygames.com', group: '游戏' },

    // ---- 社交 ----
    // B站的视频页和番剧页共用 www.bilibili.com，配置按域名走，所以合成一行。
    { name: 'B站', domain: 'www.bilibili.com', domains: ['bilibili.com'], group: '社交' },
    { name: '抖音', domain: 'www.douyin.com', domains: ['v.douyin.com'], group: '社交' },
    { name: '快手', domain: 'www.kuaishou.com', group: '社交' },
    { name: '小红书', domain: 'www.xiaohongshu.com', group: '社交' },
    // v2.10.0：补上搜索页 s.weibo.com。findSite 是**精确匹配**，
    // 只登记 www.weibo.com / m.weibo.cn 时，搜索页查不到「自己是微博」，
    // 于是被当成陌生站 → 浮窗自动收起按「非社交站」判成关（用户 2026-11-04 报：
    // 搜索页滚动不关窗、首页关）。补上后与首页完全一致。
    { name: '微博', domain: 'weibo.com', domains: ['www.weibo.com', 'm.weibo.cn', 's.weibo.com'], group: '社交' },
    { name: 'X', domain: 'x.com', domains: ['www.x.com'], group: '社交' },
    { name: 'Instagram', domain: 'www.instagram.com', group: '社交' },
    { name: 'YouTube', domain: 'www.youtube.com', domains: ['youtube.com'], group: '社交' },
    { name: 'TikTok', domain: 'www.tiktok.com', domains: ['tiktok.com'], group: '社交' }
  ];

  /** 一个站的全部域名（主域名在前） */
  function domainsOf(site) {
    if (!site) return [];
    var out = [site.domain];
    var extra = site.domains || [];
    for (var i = 0; i < extra.length; i++) {
      if (extra[i] && out.indexOf(extra[i]) === -1) out.push(extra[i]);
    }
    return out;
  }

  // 二级公共后缀，避免把 foo.com.cn 的「主域名」算成 com.cn
  var PUBLIC_SUFFIX2 = {
    'com.cn': 1, 'net.cn': 1, 'org.cn': 1, 'gov.cn': 1, 'edu.cn': 1,
    'co.uk': 1, 'org.uk': 1, 'ac.uk': 1,
    'co.jp': 1, 'ne.jp': 1, 'or.jp': 1,
    'com.hk': 1, 'com.tw': 1, 'com.au': 1, 'co.kr': 1
  };

  /**
   * 取「主域名」：www.douban.com → douban.com，m.weibo.cn → weibo.cn
   * 只用于给 popup 提供「对整个 xxx 生效」的默认值，不参与匹配。
   */
  function parentDomain(hostname) {
    if (!hostname) return '';
    var parts = String(hostname).toLowerCase().split('.');
    if (parts.length <= 2) return parts.join('.');
    var last2 = parts.slice(-2).join('.');
    if (PUBLIC_SUFFIX2[last2]) {
      return parts.slice(-3).join('.');
    }
    return last2;
  }

  /** 当前主机名在不在站点清单里（主域名或别名，精确匹配）。找不到返回 null（例如用户访问了没收录的站）。 */
  function findSite(hostname) {
    if (!hostname) return null;
    var h = String(hostname).toLowerCase();
    var i;
    for (i = 0; i < CATALOG.length; i++) {
      if (CATALOG[i].domain.toLowerCase() === h) return CATALOG[i];
    }
    for (i = 0; i < CATALOG.length; i++) {
      var alias = CATALOG[i].domains || [];
      for (var j = 0; j < alias.length; j++) {
        if (String(alias[j]).toLowerCase() === h) return CATALOG[i];
      }
    }
    return null;
  }

  /**
   * 「自动复制」可用的格式（v2.5.66）。
   *
   * 值必须与 modal-copy-export.js 里三个方法的对应关系一致：
   *   notion    → copyData()              HTML 表格 + TSV 双格式（Excel / Notion）
   *   markdown  → copyDataAsMarkdown()    Markdown 表格
   *   plaintext → copyDataAsPlainText()   一行一条「字段：值」，无表格
   *
   * 这个常量是唯一权威：popup / options / content-main 都从这里取，
   * 不要在别处再手写一遍字符串数组。
   */
  var AUTO_COPY_FORMATS = ['notion', 'markdown', 'plaintext'];
  var AUTO_COPY_FORMAT_DEFAULT = 'markdown';

  /** 把任意输入收敛成合法格式值；认不出来的一律回退默认值 */
  function normalizeCopyFormat(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return (AUTO_COPY_FORMATS.indexOf(s) !== -1) ? s : AUTO_COPY_FORMAT_DEFAULT;
  }

  /**
   * 浮窗自动收起的默认值（v2.9.6）。
   *
   * 用户 2026-11-03 拍板：**社交站默认开**（看完一条要看下一条，浮窗杵在正中挡画面），
   * **其余站默认关**（详情页看完就走了，用不上自动收）。
   *
   * 为什么按类型实时算、不写进配置文件：
   *   写进去就要给 23 个站各落一条，用户没碰过的站也会被"固定"下来；
   *   将来站点分类调整（比如某个站从「其他」挪进「社交」），写死的值跟不上。
   *   算出来的只用于「没设过」的站 —— 用户在 popup / 设置页碰过的站，走 siteOverrides。
   */
  function autoDismissDefault(hostname) {
    var site = findSite(hostname);
    return !!(site && site.group === '社交');
  }

  /** 全局默认值（config 里缺字段时的兜底，必须和 background 的 defaultConfig 保持一致） */
  function globalDefaults(config) {
    var c = config || {};
    return {
      autoExtract: !!c.autoExtract,
      autoExtractDelay: Math.max(0, parseInt(c.autoExtractDelay, 10) || 0),
      autoCopy: !!c.autoCopy,
      // v2.5.66：自动复制用哪种格式。缺字段 / 脏值都回退 markdown（用户 2026-10-25 裁决）
      autoCopyFormat: normalizeCopyFormat(c.autoCopyFormat),
      showButton: c.showButton !== false,
      // v2.9.6：这里给的是「非社交站」的保守值；真正按站点类型算在 resolve() 里
      autoDismiss: false,
      // v2.11.4：这个值是不是「用户自己设过」的。没设过时，feed 形态（豆瓣收藏列表页）
      // 会自行开启自动收起 —— 用户显式关掉的站绝不覆盖。
      autoDismissExplicit: false
    };
  }

  /**
   * 找出命中的覆盖规则域名。后缀匹配 + 最长优先：
   *   配了 douban.com → book.douban.com / movie.douban.com / www.douban.com 全命中
   *   同时配了 movie.douban.com → 电影页用 movie.douban.com 那条
   * 没有命中返回 null。
   */
  function matchRule(config, hostname) {
    var ov = (config && config.siteOverrides) || {};
    var h = String(hostname || '').toLowerCase();
    if (!h) return null;

    var best = null;
    var bestLen = -1;
    for (var key in ov) {
      if (!Object.prototype.hasOwnProperty.call(ov, key)) continue;
      var k = String(key).toLowerCase();
      if (!k) continue;
      var hit = (h === k) || (h.length > k.length + 1 && h.slice(-(k.length + 1)) === '.' + k);
      if (hit && k.length > bestLen) {
        best = key;
        bestLen = k.length;
      }
    }
    return best;
  }

  /**
   * 找出命中本站的覆盖规则（后缀匹配 + 最长优先 + 别名域名回退）。
   *
   * v2.12.11：把原先写在 resolve() 里的 5 行抽出来，让「空白字段」用**同一套**
   * 继承规则，避免两处各写一遍将来漂移。返回 { rule, obj }；obj 为 null 表示
   * 没命中，或命中了但那条规则是 null / 非对象（「显式跟随通用」）。
   */
  function findSiteOverride(config, hostname) {
    var rule = matchRule(config, hostname);
    if (!rule) {
      var site = findSite(hostname);
      if (site && site.domain.toLowerCase() !== String(hostname || '').toLowerCase()) {
        rule = matchRule(config, site.domain);
      }
    }
    if (!rule) return { rule: null, obj: null };
    var o = ((config && config.siteOverrides) || {})[rule];
    return { rule: rule, obj: (o && typeof o === 'object') ? o : null };
  }

  // ---------- 空白字段策略（v2.12.11） ----------
  //
  // 四档语义（用户 2026-11-07 拍板，全局 + 单站点都要，默认不隐藏）：
  //   off     不隐藏：浮窗显示全量、复制导出全量（升级后行为零变化）
  //   display 只隐藏显示：浮窗少空行/空列，复制导出仍全量
  //   all     显示 + 复制导出一起少列
  //   custom  两个独立小开关自由组合（hideEmptyDisplay / hideEmptyCopy）
  //
  // 这里只负责「配置 → 两个布尔」，不碰 this.data、不碰 fieldOrder：
  // 过滤只发生在渲染 / 复制那一层，字段清单与提取数据一个字节都不改，
  // 免得踩「跨站补链按三键判空」「字段顺序」的老坑。
  var HIDE_EMPTY_MODES = ['off', 'display', 'all', 'custom'];
  var HIDE_EMPTY_DEFAULT = 'off';
  var HIDE_EMPTY_KEYS = ['hideEmptyMode', 'hideEmptyDisplay', 'hideEmptyCopy'];

  function normalizeHideEmptyMode(v) {
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return HIDE_EMPTY_MODES.indexOf(s) !== -1 ? s : HIDE_EMPTY_DEFAULT;
  }

  /** 一个字段值算不算「空」：null / undefined / 纯空白 / 数组全空 都算 */
  function isBlankValue(v) {
    if (v === null || v === undefined) return true;
    if (Array.isArray(v)) return v.every(isBlankValue);
    return String(v).trim() === '';
  }

  /** 按「要不要隐藏」过滤字段清单；keepAll 时不隐藏（编辑模式 / 搜索时用） */
  function visibleFields(fields, data, hideEmpty) {
    var list = fields || [];
    if (!hideEmpty) return list;
    var d = data || {};
    return list.filter(function (f) { return !isBlankValue(d[f]); });
  }

  /** 三个配置键 → { mode, display, copy }；非 custom 档位忽略两个小开关的值 */
  function hideEmptyFrom(o) {
    var x = o || {};
    var mode = normalizeHideEmptyMode(x.hideEmptyMode);
    if (mode === 'off') return { mode: 'off', display: false, copy: false };
    if (mode === 'display') return { mode: 'display', display: true, copy: false };
    if (mode === 'all') return { mode: 'all', display: true, copy: true };
    return { mode: 'custom', display: !!x.hideEmptyDisplay, copy: !!x.hideEmptyCopy };
  }

  /** 当前页生效的空白字段策略：全局打底，站点覆盖逐键盖上去（没设的键继续跟随全局） */
  function resolveHideEmpty(config, hostname) {
    var c = config || {};
    var g = c.settings || {};
    var found = findSiteOverride(c, hostname);
    var o = found.obj || {};
    var hasOwn = Object.prototype.hasOwnProperty;
    return hideEmptyFrom({
      hideEmptyMode: hasOwn.call(o, 'hideEmptyMode') ? o.hideEmptyMode : g.hideEmptyMode,
      hideEmptyDisplay: hasOwn.call(o, 'hideEmptyDisplay') ? o.hideEmptyDisplay : g.hideEmptyDisplay,
      hideEmptyCopy: hasOwn.call(o, 'hideEmptyCopy') ? o.hideEmptyCopy : g.hideEmptyCopy
    });
  }

  // 内容脚本这一侧的当前策略（进程内状态，不落盘）。
  // content-main.refreshConfig() 负责 set；渲染 / 复制只读 get，不各自再解析一遍配置。
  var currentHideEmpty = { mode: 'off', display: false, copy: false };
  function setHideEmptyPolicy(p) {
    var n = p || {};
    currentHideEmpty = hideEmptyFrom({
      hideEmptyMode: n.mode,
      hideEmptyDisplay: n.display,
      hideEmptyCopy: n.copy
    });
    return currentHideEmpty;
  }
  function hideEmptyPolicy() { return currentHideEmpty; }

  /**
   * 站点规则的写盘快照（options / popup / 批量操作共用）。
   *
   * 「基础五项」照旧无条件带上（popup-slim 的契约断言钉着），
   * 「可跟随键」（复制格式 + 三个空白字段键）只在**本站自己那条规则里已经有**时才带上 ——
   * 否则改一个别的开关就会把全局值悄悄固化到本站，以后改全局再也影响不到它。
   */
  function siteSnapshot(config, hostname, eff) {
    var e = eff || resolve(config, hostname);
    var s = {
      autoExtract: e.autoExtract,
      autoExtractDelay: e.autoExtractDelay,
      autoCopy: e.autoCopy,
      showButton: e.showButton,
      autoDismiss: e.autoDismiss
    };
    var ov = (config && config.siteOverrides) || {};
    var own = Object.prototype.hasOwnProperty.call(ov, hostname) ? ov[hostname] : null;
    if (own && typeof own === 'object') {
      ['autoCopyFormat'].concat(HIDE_EMPTY_KEYS).forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(own, k)) s[k] = own[k];
      });
    }
    return s;
  }

  /**
   * 算出当前页真正生效的四个开关。
   * @returns {{autoExtract:boolean, autoExtractDelay:number, autoCopy:boolean, showButton:boolean, autoDismiss:boolean, rule:string|null}}
   */
  function resolve(config, hostname) {
    var eff = globalDefaults(config);
    eff.rule = null;

    // v2.9.6：浮窗自动收起 —— 默认值按站点类型算（社交开、其余关），全程不落盘。
    eff.autoDismiss = autoDismissDefault(hostname);
    // 老配置迁移：v2.9.4 那版只有一个全局开关，用户明确关过（false）就是「全都别自动收」。
    // 明确打开过（true）不携带信息（那本来就是当时的默认），交给上面的类型判断。
    if (config && config.settings && config.settings.autoDismiss === false) {
      eff.autoDismiss = false;
      eff.autoDismissExplicit = true;
    }

    // v2.12.11：覆盖查找抽成 findSiteOverride()，与「空白字段」共用同一套
    // 后缀匹配 + 最长优先 + 别名域名回退，避免两处逻辑将来漂移。
    // null / 非对象都当作「显式跟随全局」（设置页「恢复跟随通用」写出来的）。
    var found = findSiteOverride(config, hostname);
    var o = found.obj;
    if (!o) return eff;

    if (Object.prototype.hasOwnProperty.call(o, 'autoExtract')) {
      eff.autoExtract = !!o.autoExtract;
    }
    if (Object.prototype.hasOwnProperty.call(o, 'autoExtractDelay')) {
      eff.autoExtractDelay = Math.max(0, parseInt(o.autoExtractDelay, 10) || 0);
    }
    if (Object.prototype.hasOwnProperty.call(o, 'autoCopy')) {
      eff.autoCopy = !!o.autoCopy;
    }
    // v2.5.66：站点级格式。覆盖里没这个键 → 沿用全局（逐字段合并，不会被打回默认值）
    if (Object.prototype.hasOwnProperty.call(o, 'autoCopyFormat')) {
      eff.autoCopyFormat = normalizeCopyFormat(o.autoCopyFormat);
    }
    if (Object.prototype.hasOwnProperty.call(o, 'showButton')) {
      eff.showButton = !!o.showButton;
    }
    // v2.9.6：站点级自动收起。本站设过就完全以它为准（包括设成 false 压掉社交站的默认开）
    if (Object.prototype.hasOwnProperty.call(o, 'autoDismiss')) {
      eff.autoDismiss = !!o.autoDismiss;
      eff.autoDismissExplicit = true;
    }
    eff.rule = found.rule;
    return eff;
  }

  var api = {
    CATALOG: CATALOG,
    GROUP_ORDER: GROUP_ORDER,
    domainsOf: domainsOf,
    parentDomain: parentDomain,
    findSite: findSite,
    globalDefaults: globalDefaults,
    matchRule: matchRule,
    findSiteOverride: findSiteOverride,
    resolve: resolve,
    // v2.9.6：浮窗自动收起的默认值（社交开 / 其余关）
    autoDismissDefault: autoDismissDefault,
    // v2.5.66：自动复制格式
    AUTO_COPY_FORMATS: AUTO_COPY_FORMATS,
    AUTO_COPY_FORMAT_DEFAULT: AUTO_COPY_FORMAT_DEFAULT,
    normalizeCopyFormat: normalizeCopyFormat,
    // v2.12.11：空白字段四档
    HIDE_EMPTY_MODES: HIDE_EMPTY_MODES,
    HIDE_EMPTY_DEFAULT: HIDE_EMPTY_DEFAULT,
    HIDE_EMPTY_KEYS: HIDE_EMPTY_KEYS,
    normalizeHideEmptyMode: normalizeHideEmptyMode,
    isBlankValue: isBlankValue,
    visibleFields: visibleFields,
    resolveHideEmpty: resolveHideEmpty,
    setHideEmptyPolicy: setHideEmptyPolicy,
    hideEmptyPolicy: hideEmptyPolicy,
    siteSnapshot: siteSnapshot
  };

  global.ClipMateSites = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
