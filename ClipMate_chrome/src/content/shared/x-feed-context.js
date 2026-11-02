/**
 * X（推特）「页面上每一条推文」的统一取值上下文（v2.7.43）
 *
 * 由来
 * ----
 * 微博那一版（`weibo-feed-context.js`）踩过的坑，这里一条不落：
 *
 *   · 列表页用 `document.querySelectorAll(...)[0]` 取整页值 → 拼出
 *     「第一条推文的正文 + 列表页自己的地址」，URL 根本点不开。
 *   · 按钮位置写死 → 页面里卡片高度不齐时压住正文（微博搜索页实测压过 3px）。
 *   · 标题在 overrides 里用闭包算 → v2.7.38 的「空文案→站名」兜底够不着。
 *
 * X 自己的结构（2026-11-01 真机实测，x.com/home、个人主页、搜索页、详情页四类都量过）：
 *
 *   · 一条推文 = 一个 `<article data-testid="tweet">`；
 *     通知卡是 `<article data-testid="notification">` → 天然分开，通知页读不到推文编号。
 *   · **时间是链接也是编号来源**：`[data-testid="User-Name"]` 里的第三个 `<a>`
 *     就是 `/处理名/status/1234567890`，`title` 文本只是「8小时」「10月30日」，
 *     真正的时刻在它内部 `<time datetime="2026-10-31T13:40:03.000Z">`。
 *   · **详情页主贴的 User-Name 里没有那个链接**（时间在正文下方），
 *     只能在整条里找第一个「纯 status」链接 —— 主贴永远排在最前，不会拿错。
 *   · `/analytics`、`/quotes`、`/likes`、`/photo/1` 这些变体一律带尾巴，
 *     用 `^/处理名/status/纯数字$` 一刀切掉。
 *   · **表情符号是 `<img alt="🔥">`，`textContent` 读不到** → 必须按 alt 拼回，
 *     否则「美得太过分了 🥰」会洗成「美得太过分了」。这是 X 独有的坑。
 *   · 引用帖：外层正文是第 1 个 `[data-testid="tweetText"]`，
 *     被引用那条是第 2 个、且**在 `div[role="link"]` 里面** → 靠这个判归属。
 *     外层一个字没写时，唯一那个 tweetText 也在 role=link 里 → 文案判空（用户拍板 A 案）。
 *   · 「⋯」是 `[data-testid="caret"]`，右边距恒为 16、尺寸 19×20，
 *     但**顶部有 12 / 18 / 28 三种**（普通列表 12、详情页主贴 18、转推多一行「XX 已转帖」→ 28）
 *     → 按钮必须逐卡按自己的「⋯」算位置，写死必压字。
 *   · `<article>` 的 computed position 本来就是 `relative`（微博得手动设），
 *     但样式还是按「static 才改」处理，别人家页面配置变了也不至于挂坏。
 *
 * 因此这里把「怎么找到一条推文」「怎么从这条推文上取 6 个值」收成**唯一实现**，
 * 按钮组件（x-feed-buttons.js）与提取器（x-social.js）都走这里，
 * 避免两套选择器在两处各漂一份。
 */
(function (global) {
  'use strict';

  /** 一条推文：只认带 data-testid=tweet 的 article（通知卡是 notification，天然排除） */
  var TWEET_SELECTOR = 'article[data-testid="tweet"]';

  /** 昵称/时间那一片 */
  var USER_NAME_SELECTOR = '[data-testid="User-Name"]';

  /** 正文（外层一段；引用块里的那段也在其中） */
  var TEXT_SELECTOR = '[data-testid="tweetText"]';

  /** 「⋯」：按钮的定位锚点 */
  var CARET_SELECTOR = '[data-testid="caret"]';

  /** 引用块：被引用那条的所有内容都在这层里面 */
  var QUOTE_SELECTOR = 'div[role="link"]';

  /**
   * 推文永久链接：`/处理名/status/1234567890`
   *
   * 结尾用 `$` 卡死，顺带把 `/analytics`（分析页）、`/quotes`（引用列表）、
   * `/likes`、`/photo/1` 这些变体全挡在外面 —— 它们都是「这条推文的下级页面」，
   * 拿来做编号不会错，但会拼出用户点不开的地址。
   */
  var STATUS_HREF_RE = /^\/([A-Za-z0-9_]+)\/status\/(\d+)$/;

  /** 地址栏的推文编号（详情页判定用） */
  var LOCATION_STATUS_RE = /\/status\/(\d+)/;

  /** X 的系统路径，不是用户名 */
  var RESERVED = ['home', 'explore', 'notifications', 'messages', 'search', 'settings',
    'i', 'compose', 'login', 'logout', 'signup', 'tos', 'privacy', 'bookmarks',
    'lists', 'communities', 'jobs', 'premium', 'verified', 'account'];

  var ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g;

  /** 正文尾部的「显示更多」标记（列表页长推文被截断时可能出现） */
  var SHOW_MORE_TAIL_RE = /(?:\s|\.{2,}|…)*显示更多\s*$/;

  // ---------------------------------------------------------------- 小工具

  function hrefOf(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    return (el.getAttribute('href') || '').trim();
  }

  /**
   * 取元素的可读文本，**把 `<img alt>` 当作文字拼回去**。
   *
   * X 把表情符号渲染成 `<img alt="🔥">`（不是字符），`textContent` 读不到它们，
   * 于是「美得太过分了 🥰」会被洗成「美得太过分了」。昵称同理（很多昵称带国旗/星星）。
   * `<svg>`（认证徽章、图标）跳过 —— 它没有 alt，走进去只会拿到空字符串。
   *
   * @param {Element} el
   * @returns {string} 压过空白的纯文本
   */
  function textWithAlt(el) {
    if (!el) return '';
    var out = '';
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var child = node.childNodes[i];
        if (child.nodeType === 3) {
          out += child.nodeValue || '';
          continue;
        }
        if (child.nodeType !== 1) continue;
        var tag = String(child.tagName || '').toUpperCase();
        if (tag === 'IMG') {
          out += child.getAttribute('alt') || '';
        } else if (tag === 'SVG') {
          continue;
        } else if (tag === 'BR') {
          out += ' ';
        } else {
          walk(child);
        }
      }
    })(el);
    return out.replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * 这段正文是不是「被引用那条」的？
   *
   * 引用块整块套在 `div[role="link"]` 里（点一下会跳到原推），
   * 外层博主自己写的正文**不在**任何 role=link 容器内。
   * 注意 X 里 role=link 还有别的用法（媒体卡、投票），所以只对 tweetText 用这条判断，
   * 不能拿「article 里有没有 role=link」当引用标记。
   */
  function isQuotedText(el) {
    try {
      return !!(el && el.closest && el.closest(QUOTE_SELECTOR));
    } catch (e) {
      return false;
    }
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function permalink(handle, id) {
    if (!handle || !id) return '';
    return 'https://x.com/' + handle + '/status/' + id;
  }

  function stripShowMore(value) {
    if (!value) return '';
    var out = String(value).replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
    out = out.replace(SHOW_MORE_TAIL_RE, '').trim();
    return out;
  }

  // ---------------------------------------------------------------- 日期

  /**
   * 日期归一（**X 这一档只做透传**，理由见下）
   *
   * X 的时间永远是 `<time datetime="2026-10-31T13:40:03.000Z">`，本身就是 ISO 8601。
   * 整页路径的 `extractPublishDate()` 也是原样返回这串 → 逐帖路径必须给**同一串**，
   * 否则「同一作品任何入口必须是同一字符串」这条铁律当场破掉。
   *
   * 只有 datetime 缺失（少数实验性布局）时才回落到链接上的相对文本
   * （「8小时」「10月30日」），那种交给既有的 `DataFormatters.formatSocialDate()`，
   * 不复制第二份相对时间规则。
   *
   * @param {string} raw - `<time>` 的 datetime，或链接文本
   * @returns {string}
   */
  function normalizeDate(raw) {
    var s = String(raw || '').replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // ISO 8601（带 Z）→ 原样，和整页路径完全一致
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(s)) return s;

    var F = global && global.DataFormatters;
    if (F && typeof F.formatSocialDate === 'function') {
      try {
        var formatted = F.formatSocialDate(s);
        if (formatted) return formatted;
      } catch (e) { /* 落到下面的原文兜底 */ }
    }
    return s;
  }

  /** 把 `/handle/status/123` 拆成 {handle, id}；不是纯 status 链接返回 null */
  function parseStatusHref(href) {
    var m = STATUS_HREF_RE.exec(String(href || '').trim());
    if (!m) return null;
    if (RESERVED.indexOf(m[1].toLowerCase()) > -1) return null;
    return { handle: m[1], id: m[2] };
  }

  // ---------------------------------------------------------------- 站点

  /**
   * 当前是不是 X 页面。
   * @returns {'x'|''}
   */
  function getSite() {
    var host = (global.location && global.location.hostname) || '';
    if (/(^|\.)x\.com$/i.test(host)) return 'x';
    return '';
  }

  /** 地址栏里的推文编号（不在详情页返回空串） */
  function currentStatusId() {
    var path = (global.location && global.location.pathname) || '';
    var m = LOCATION_STATUS_RE.exec(path);
    return m ? m[1] : '';
  }

  // ---------------------------------------------------------------- 取值

  /**
   * 找工作名（处理名）：`[data-testid="User-Name"]` 里**第一个**链接就是它。
   *
   * 不能拿 `[data-testid^="UserAvatar-Container-"]` 顶包：一条推文里可能出现
   * **两个**头像容器（外层 + 被引用，真机实测 `halvenruns` + `hanakoxbt`），
   * 按它取会把引用对象当成作者。
   */
  function readHandle(article, userName) {
    var scope = userName || article;
    if (!scope) return '';
    var links = scope.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      var href = hrefOf(links[i]);
      var m = /^\/([A-Za-z0-9_]+)$/.exec(href);
      if (!m) continue;
      if (RESERVED.indexOf(m[1].toLowerCase()) > -1) continue;
      return m[1];
    }
    return '';
  }

  /**
   * 找编号与时间链接。
   *
   * 两条路，顺序不能换：
   *   ① 先看 `User-Name` 里有没有 `/处理名/status/…`
   *      —— 列表页、搜索页、个人主页都走这条，最稳（那一片只属于外层作者）。
   *   ② 没有就退回「article 里第一个纯 status 链接」
   *      —— 详情页主贴的 User-Name 里没有时间链接（时间显示在正文下方），
   *         而主贴永远是 article 里的第一条，取第一个不会拿到回复或引用。
   *
   * @returns {{link:Element, handle:string, id:string}|null}
   */
  function findStatusLink(article, userName) {
    var scopes = [userName, article];
    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      if (!scope) continue;
      var links = scope.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var parsed = parseStatusHref(hrefOf(links[i]));
        if (parsed) return { link: links[i], handle: parsed.handle, id: parsed.id };
      }
    }
    return null;
  }

  /**
   * 读一条推文的 6 个值。
   *
   * 文案口径（用户 2026-11-01 拍板 A 案，与微博一致）：
   * **只取博主自己写的那段**。引用帖的被引用正文在 role=link 里，一律不碰；
   * 博主一个字没写 → text 为空串（不是 null），交给装配器按站名填「X推文」并改写标题。
   *
   * @param {Element} article
   * @returns {{handle:string,mid:string,url:string,nick:string,date:string,text:string,hasText:boolean}|null}
   *          认不出唯一编号就返回 null（认不出绝不猜）
   */
  function readPost(article) {
    if (!article || article.tagName !== 'ARTICLE') return null;
    if (article.getAttribute('data-testid') !== 'tweet') return null;

    var userName = article.querySelector(USER_NAME_SELECTOR);
    var found = findStatusLink(article, userName);
    if (!found || !found.id) return null;

    // 昵称 = User-Name 里第一个链接的文字（第二个才是 @处理名，第三个是时间）
    var nick = '';
    if (userName) {
      var firstLink = userName.querySelector('a[href]');
      if (firstLink) nick = textWithAlt(firstLink);
    }

    // 正文：第一段「不在引用块里」的 tweetText 才是博主自己写的
    var textEl = null;
    var texts = article.querySelectorAll(TEXT_SELECTOR);
    for (var i = 0; i < texts.length; i++) {
      if (!isQuotedText(texts[i])) { textEl = texts[i]; break; }
    }

    // 时间：编号那条链接里的 <time datetime>；取不到就用链接文本（「8小时」）
    var timeEl = found.link ? found.link.querySelector('time') : null;
    var rawDate = '';
    if (timeEl) rawDate = timeEl.getAttribute('datetime') || '';
    if (!rawDate && found.link) rawDate = textWithAlt(found.link);

    return {
      handle: found.handle,
      mid: found.id,
      url: permalink(found.handle, found.id),
      nick: nick,
      date: normalizeDate(rawDate),
      text: stripShowMore(textEl ? textWithAlt(textEl) : ''),
      hasText: !!textEl
    };
  }

  /**
   * 页面上所有「看起来是一条推文」的容器。
   * 不保证都能读出编号（推荐位、骨架屏）—— 调用方要再用 `readPost()` 判一次。
   * @returns {Element[]}
   */
  function findContainers() {
    if (!getSite()) return [];
    return Array.prototype.slice.call(document.querySelectorAll(TWEET_SELECTOR));
  }

  /**
   * 列表页上的「第一条推文」，**只在这个页面确实能读出 2 条以上时才返回**。
   *
   * 用途：用户在列表页点全局悬浮按钮时，整页取值方法（`querySelectorAll()[0]`）
   * 会拼出「第一条推文的正文 + 列表页自己的地址」—— 一半对一半错。
   * 有了这个，列表页的全局按钮就退化成「提第一条」，字段自洽。
   *
   * 详情页只读出 1 条时返回 null，让调用方维持原来的整页取值，零回归。
   *
   * @returns {Object|null}
   */
  function firstPostOnListPage() {
    var list = findContainers();
    var posts = [];
    for (var i = 0; i < list.length; i++) {
      var post = readPost(list[i]);
      if (post && post.mid) posts.push(post);
    }
    return posts.length >= 2 ? posts[0] : null;
  }

  var api = {
    TWEET_SELECTOR: TWEET_SELECTOR,
    CARET_SELECTOR: CARET_SELECTOR,
    getSite: getSite,
    currentStatusId: currentStatusId,
    findContainers: findContainers,
    readPost: readPost,
    firstPostOnListPage: firstPostOnListPage,
    normalizeDate: normalizeDate,
    parseStatusHref: parseStatusHref,
    textWithAlt: textWithAlt,
    permalink: permalink
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.XFeedContext = api;
  }
})(typeof window !== 'undefined' ? window : null);
