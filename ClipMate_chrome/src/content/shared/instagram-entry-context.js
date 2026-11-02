/**
 * Instagram「这一页现在有没有可提取的作品」判定器（v2.7.4，只在隔离环境里跑）
 *
 * 为什么需要它
 * ------------
 * Instagram 注入整站（`https://www.instagram.com/*`），但**绝大多数页面根本没有作品可提**：
 * 作者主页 `/<user>/`、用户 reels 列表 `/<user>/reels/`、探索页 `/explore/`、首页 feed `/`
 * 都是「一堆封面 + 页脚」。v2.7.4 之前这些页面照样出按钮，实测点下去会提取到
 * **页脚文字**（真机：`/vladaneslava/reels/` 上「本页文案 = Meta 旗下其他产品」、
 * 作者 ID 还是上一条的残留）——等于给用户一份错数据。
 *
 * 抖音 / 快手早就有同一套东西（`douyin-modal-context.js` 的 `IMMERSIVE_PATHS`、
 * `kuaishou-immersive-context.js` 的 `IMMERSIVE_PATHS` + `POPUP_PATH_PREFIXES`），
 * Instagram 一直缺这一块 —— 这就是「全站动态适配」缺的核心那块。
 *
 * 真机实测的形态（2026-10-30，用户已登录 Edge）
 * ---------------------------------------------
 *   作者主页       `/ya_thinkabout/`              列表页，无作品
 *   点开帖子后     `/p/DPodeoFEq8n/?img_index=1`  弹层态，**换地址不换文档**
 *   关掉弹层后     `/ya_thinkabout/`              回到列表页（地址会退回去）
 *   Reels 沉浸流   `/reels/DeMBuPhh28s/`           作品页（进 `/reels/` 会自动跳到一条）
 *   用户 reels 列表 `/vladaneslava/reels/`         列表页，无作品
 *
 * 两条硬规则
 * ----------
 * ① **弹层说了算**：`div[role="dialog"]` 存在 → 一律算作品页，不管地址栏写什么。
 *    （弹层刚打开那一瞬地址可能还没变，只看地址会漏掉按钮。）
 * ② **只有白名单里的作品地址才出按钮**，其余一律不出。
 *    （反过来写「黑名单」会漏掉没见过的形态，把作品页误藏 = 功能直接废掉；
 *     白名单漏掉只会让某个新形态暂时没按钮，不至于给出错数据。）
 *
 * 站点门禁
 * --------
 * 本文件挂 `global.InstagramEntryContext`，会经 `Object.assign(MediaExtractor.prototype, …)`
 * **共享给所有站点的提取器**。所以每个对外的函数第一行都必须校验 hostname，
 * 否则抖音/快手/小红书调用时会拿到 Instagram 的答案。
 *
 * 依赖：无（只用标准 DOM API / URL）
 */
(function (global) {
  'use strict';

  /**
   * 作品编号（实测形如 `DPodeoFEq8n`，11 位）。
   *
   * 上限 64 位（v2.7.36 从 30 位放宽）：推广帖的作品地址是「编号 + ad 追踪串」，
   * 真机实测 43 位（`DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0`）。卡在 30 位时
   * 这种帖子的地址不被认成作品页 → 首页不挂按钮、弹层也判不出作品。
   *
   * ⚠️ 只用于作品地址；用户名另有 30 位的规则（`isProfilePath` 里，IG 硬限制）。
   */
  var CODE = '[A-Za-z0-9_-]{5,64}';

  /**
   * 作品地址白名单。**注意顺序**：带作者名的那条要写在前面，
   * 否则 `/<user>/p/<code>/` 会被单段规则误判成「用户主页」。
   */
  var WORK_PATH_RES = [
    // /<user>/p/<code>/、/<user>/reel/<code>/（主页网格里卡片链接就是这个形态）
    new RegExp('^/[A-Za-z0-9_.]+/(?:p|reel|reels|tv)/' + CODE + '(?:/|$)'),
    // /p/<code>/、/reel/<code>/、/reels/<code>/、/tv/<code>/（弹层打开后地址就是这个形态）
    new RegExp('^/(?:p|reel|reels|tv)/' + CODE + '(?:/|$)'),
    // /stories/<user>/<id>/、/stories/highlights/<id>/
    /^\/stories\//
  ];

  /**
   * 功能目录段：地址里出现这些（除第一段外）就不是作品地址。
   * 真机弹层里见过 `a[href="/reels/audio/<id>/"]`：`audio` 正好 5 位，
   * 会被下面的短码规则当成作品 ID 吞掉，必须先在这里挡掉。
   *
   * ⚠️ **不要把 p / reel / reels / tv 放进这张表**：它们是作品类型段，
   * 而且在 `/<user>/p/<code>/` 里出现在**第二段**——放进来会把主页网格卡片形态误判成非作品。
   */
  var RESERVED_SEGMENTS = {
    audio: 1, explore: 1, locations: 1, tags: 1,
    accounts: 1, direct: 1, settings: 1, about: 1
  };

  function hostname() {
    try {
      return (global.location && global.location.hostname) || '';
    } catch (e) {
      return '';
    }
  }

  /** 站点门禁：只认 Instagram，别的站一律 false */
  function isInstagram() {
    return /(^|\.)instagram\.com$/i.test(hostname());
  }

  function pathOf(href) {
    try {
      var u = new URL(href, 'https://www.instagram.com');
      return u.pathname || '/';
    } catch (e) {
      var m = /^https?:\/\/[^/]+(\/[^?#]*)/.exec(String(href || ''));
      if (m) return m[1] || '/';
      return String(href || '').split('?')[0] || '/';
    }
  }

  /** 弹层开着吗（真机实测：关着时 `div[role="dialog"]` 是 0 个，不是常驻空壳） */
  function hasOpenDialog(doc) {
    try {
      var d = doc || (global.document);
      return !!(d && d.querySelector && d.querySelector('div[role="dialog"]'));
    } catch (e) {
      return false;
    }
  }

  /**
   * 地址是不是「作品地址」
   * @param {string} href
   * @returns {boolean}
   */
  function isWorkPath(href) {
    var path = pathOf(href);
    var seg = path.replace(/^\//, '').split('/').filter(Boolean);

    // ① Stories 先单独判：/stories/highlights/<id>/ 里的 `highlights` 是它的固定段，
    //    不能拿下面的保留字表去卡它。
    if (/^\/stories\//.test(path)) return true;

    // ② 保留字：从第二段起出现功能目录段 → 不是作品
    for (var i = 1; i < seg.length; i++) {
      if (RESERVED_SEGMENTS[seg[i]]) return false;
    }
    // ③ 第一段本身就是功能目录（/explore/、/accounts/、/direct/ …）→ 不是作品
    if (seg.length && RESERVED_SEGMENTS[seg[0]]) return false;

    // ④ 作品地址白名单
    for (var j = 0; j < WORK_PATH_RES.length; j++) {
      if (WORK_PATH_RES[j].test(path)) return true;
    }
    return false;
  }

  /**
   * 地址是不是「个人主页」`/<username>/`（v2.7.20）
   *
   * 判据：**只有一段路径**，且这一段不是功能目录、不是作品编号段。
   *   `/cartierawards/`        → 是
   *   `/cartierawards/reels/`  → 不是（两段，那是用户的 reels 列表）
   *   `/explore/`、`/p/<code>/`、`/stories/...` → 不是
   *
   * 为什么单独判而不复用 isWorkPath 的取反：`/<user>/reels/`、`/explore/`
   * 这些**既不是作品也不是主页**，取反会把它们一起算成主页，点按钮就会去提
   * 一堆封面和页脚。三种形态必须分开说清楚。
   *
   * @param {string} [href]
   * @returns {boolean}
   */
  function isProfilePath(href) {
    var path = pathOf(href);
    var seg = path.replace(/^\//, '').split('/').filter(Boolean);
    if (seg.length !== 1) return false;
    if (RESERVED_SEGMENTS[seg[0]]) return false;
    // `/p`、`/reel`、`/reels`、`/tv` 这些类型段本身（后面没跟编号）也不是主页
    if (/^(?:p|reel|reels|tv)$/i.test(seg[0])) return false;
    return /^[A-Za-z0-9_.]{1,30}$/.test(seg[0]);
  }

  /** 当前页是不是个人主页（站点门禁 + 地址判定） */
  function isProfilePage(href) {
    if (!isInstagram()) return false;
    return isProfilePath(href || ((global.location && global.location.href) || ''));
  }

  /**
   * 地址是不是「首页信息流」`/`（v2.7.35）
   *
   * 就一条：路径只有斜杠。IG 首页可能带查询串（`/?__coig_…`），`pathname` 仍是 `/`。
   *
   * 为什么单独留一个判据：首页是**唯一**支持「每条帖子挂小按钮」的入口
   * （用户 2026-11-01 拍板，先只做首页）。别处继续走「点开帖子再提」。
   *
   * @param {string} [href]
   * @returns {boolean}
   */
  function isFeedPath(href) {
    return /^\/+$/.test(pathOf(href || ((global.location && global.location.href) || '')));
  }

  /** 当前页是不是 IG 首页（站点门禁 + 地址判定） */
  function isFeedPage(href) {
    if (!isInstagram()) return false;
    return isFeedPath(href);
  }

  /**
   * 这一页现在有没有可提取的作品
   *
   * 弹层开着 → 永远是 true（规则①）；否则看地址白名单。
   *
   * @param {string} [href] - 默认当前地址
   * @param {Document} [doc] - 默认当前文档
   * @returns {boolean}
   */
  function hasExtractableWork(href, doc) {
    if (!isInstagram()) return false;   // 站点门禁（共享原型，每个站都会调到）
    if (hasOpenDialog(doc)) return true;
    return isWorkPath(href || ((global.location && global.location.href) || ''));
  }

  /**
   * 这一页现在有没有「能提的东西」（作品 **或** 个人主页，v2.7.20）
   *
   * 按钮显隐应该看这个，不是 hasExtractableWork —— 主页没有单条作品，
   * 但有整份人物档案可提，按作品判会把主页的按钮藏掉（v2.7.4 就是这样，
   * 那时候还没有人物档案，藏掉是对的；现在必须放出来）。
   */
  function hasExtractableContent(href, doc) {
    if (!isInstagram()) return false;
    if (hasExtractableWork(href, doc)) return true;
    return isProfilePage(href);
  }

  /**
   * 是不是「列表页」：IG 页面 && 现在既没有作品、也不是个人主页。
   *
   * 列表页的正确处理不是「摘按钮」，而是**挂上弹层跟随 + 等用户点开作品**
   * （跟小红书 v2.6.0 那套一样：摘了按钮就再也造不回来）。
   *
   * ⚠️ v2.7.20：判据从 `hasExtractableWork` 换成 `hasExtractableContent` ——
   *    个人主页不是列表页（它有整份档案可提）。
   *
   * @param {string} [href]
   * @param {Document} [doc]
   * @returns {boolean}
   */
  function isListEntry(href, doc) {
    if (!isInstagram()) return false;
    return !hasExtractableContent(href, doc);
  }

  global.InstagramEntryContext = {
    isInstagram: isInstagram,
    isWorkPath: isWorkPath,
    isProfilePath: isProfilePath,
    isProfilePage: isProfilePage,
    isFeedPath: isFeedPath,
    isFeedPage: isFeedPage,
    hasExtractableWork: hasExtractableWork,
    hasExtractableContent: hasExtractableContent,
    isListEntry: isListEntry,
    hasOpenDialog: hasOpenDialog,
    WORK_PATH_RES: WORK_PATH_RES
  };
})(typeof window !== 'undefined' ? window : this);
