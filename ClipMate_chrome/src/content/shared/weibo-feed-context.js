/**
 * 微博「页面上每一条博文」的统一取值上下文（v2.7.39）
 *
 * 由来
 * ----
 * 微博有三套完全不同的页面结构，之前每一套都各写一份选择器，结果谁都记不全：
 *
 *   · weibo.com（首页 / 用户主页 / 收藏 / 话题…）→ 一条博文 = 一个 <article>
 *       时间链接在 header 里，href = weibo.com/<uid>/<mid>，
 *       **title 属性就是绝对时间**（"2026-10-31 20:24"），显示文本只是"15小时前"。
 *   · s.weibo.com（搜索页）→ **没有 article**，一条博文 = 一个 .card-wrap
 *       时间链接是 .from a，href 同样带 uid+mid，但**没有 title 属性**，
 *       文本可能是"10-28 10:51"（缺年份）或"2分钟前 转赞人数超过100"（带尾巴）。
 *       末尾还有「相关用户」「相关兴趣主页」卡片，它们**没有 .from**，靠这个排除。
 *   · m.weibo.cn（手机版）→ 一条博文 = 一个 .card9，内部被拆成 3 个 .card-wrap，
 *       且 **DOM 里没有博文编号**（只有转发原博的 /status/ 和视频 fid）。
 *       编号/精确时间/全文只存在于 Vue 实例 `.card9.__vue__.item` 上，
 *       而那是主世界的东西，隔离世界读不到 → 靠 `weibo-mobile-bridge.js`（MAIN）
 *       把数据写成 `.card9[data-cm-wb]`，这里只读属性。
 *
 * 因此这里把「怎么找到一条博文」「怎么从这条博文上取 5 个值」收成**唯一实现**，
 * 按钮组件（weibo-feed-buttons.js）与两个提取器（桌面 / 手机）都走这里，
 * 避免三套选择器在四个地方各漂一份。
 */
(function (global) {
  'use strict';

  /** 手机版桥写在本属性上的 JSON（见 weibo-mobile-bridge.js） */
  var MOBILE_ATTR = 'data-cm-wb';

  /** 永久链接：weibo.com/<uid>/<mid>，允许协议相对（//weibo.com/…）与尾部 query */
  var PERMALINK_RE = /^(?:https?:)?\/\/weibo\.com\/(\d+)\/([A-Za-z0-9]+)/;

  /** 桌面版头像链接里的作者 UID：/u/<uid> */
  var UID_HREF_RE = /\/u\/(\d+)/;

  var ZERO_WIDTH_RE = /[\u200b\u200c\u200d\ufeff]/g;

  /**
   * 正文尾部的「展开」标记
   *
   * 实测两种形态：
   *   · weibo.com 长文：`…情况最好的是 ​​​ ...展开`
   *   · s.weibo.com 长文：`… #反 ​ 展开c`（末尾那个 c 是图标字体的字符）
   * 只吃「正文最后那个展开」，中间出现的「展开」不动。
   */
  var EXPAND_TAIL_RE = /(?:\s|\.{2,}|…)*展开(?:全文)?\s*c?\s*$/i;

  // ---------------------------------------------------------------- 小工具

  function textOf(el) {
    if (!el) return '';
    var raw = el.textContent || '';
    return raw.replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
  }

  function hrefOf(el) {
    if (!el || typeof el.getAttribute !== 'function') return '';
    return (el.getAttribute('href') || '').trim();
  }

  function stripExpandTail(value) {
    if (!value) return '';
    var out = String(value).replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
    out = out.replace(EXPAND_TAIL_RE, '').trim();
    return out;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function permalink(uid, mid) {
    if (!uid || !mid) return '';
    return 'https://weibo.com/' + uid + '/' + mid;
  }

  // ---------------------------------------------------------------- 日期

  /**
   * 把微博各处见到的日期文本归一成 `YYYY/MM/DD HH:mm`（能到哪档给到哪档）。
   *
   * 认得的形态：
   *   `2026-10-31 20:24`      桌面版时间链接的 title（绝对，最省事）
   *   `10-28 10:51`           桌面版显示文本（缺年份）
   *   `10月31日 22:18`        搜索页老帖（缺年份）
   *   `今天05:11` / `昨天05:11` / `前天05:11`
   *   `2分钟前 转赞人数超过100` / `15小时前` / `刚刚`
   *   `Sun Nov 01 11:12:45 +0800 2026`   手机版 Vue 的 created_at（C 语言式）
   *
   * 相对时间交给 `DataFormatters.formatSocialDate()`（它已经处理「N分钟前/刚刚/昨天」，
   * 且遵守「源到哪档给到哪档、不补 00:00」的口径），这里不复制第二份。
   *
   * @param {string} raw
   * @returns {string} 归一后的日期；认不出时返回清洗过的原文（宁可原样，也不编造）
   */
  function normalizeDate(raw) {
    var s = String(raw || '').replace(ZERO_WIDTH_RE, '').replace(/\s+/g, ' ').trim();
    if (!s) return '';

    // 剥掉搜索页混进时间文本里的噪音：`转赞人数超过100` / `来自 iPhone客户端`
    s = s.replace(/转赞人数超过\s*[\d.]+\s*万?/g, ' ')
      .replace(/来自\s*\S+$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) return '';

    // ① 手机版 C 语言式：Sun Nov 01 11:12:45 +0800 2026
    var cStyle = /^[A-Z][a-z]{2}\s+([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):\d{2}\s+[+-]\d{4}\s+(\d{4})$/.exec(s);
    if (cStyle) {
      var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      var monthIndex = MONTHS.indexOf(cStyle[1]);
      if (monthIndex > -1) {
        return cStyle[5] + '/' + pad2(monthIndex + 1) + '/' + pad2(cStyle[2])
          + ' ' + pad2(cStyle[3]) + ':' + cStyle[4];
      }
    }

    // ② 绝对时间（带四位年份），精度照抄源
    var abs = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{2}))?$/.exec(s);
    if (abs) {
      var absDay = abs[1] + '/' + pad2(abs[2]) + '/' + pad2(abs[3]);
      return (abs[4] === undefined || abs[4] === '') ? absDay : absDay + ' ' + pad2(abs[4]) + ':' + abs[5];
    }

    // ③ 缺年份的月日：`10-28 10:51` / `10月28日 10:51` → 按「不晚于现在」推年份
    var noYear = /^(\d{1,2})[-\/月](\d{1,2})日?(?:[\s]+(\d{1,2}):(\d{2}))?$/.exec(s);
    if (noYear) {
      var mm = parseInt(noYear[1], 10);
      var dd = parseInt(noYear[2], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
        var now = new Date();
        var year = now.getFullYear();
        var guess = new Date(year, mm - 1, dd, noYear[3] ? parseInt(noYear[3], 10) : 0,
          noYear[4] ? parseInt(noYear[4], 10) : 0, 0, 0);
        // 微博不会显示未来的时间：推出来比现在还晚，只能是去年的
        if (guess.getTime() > now.getTime() + 86400000) year -= 1;
        var dayPart = year + '/' + pad2(mm) + '/' + pad2(dd);
        return noYear[3] === undefined ? dayPart : dayPart + ' ' + pad2(noYear[3]) + ':' + noYear[4];
      }
    }

    // ④ 今天 / 昨天 / 前天 + 时刻（formatSocialDate 只认裸「昨天」，不认「昨天05:11」）
    var named = /^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})$/.exec(s);
    if (named) {
      var offsetDays = named[1] === '今天' ? 0 : (named[1] === '昨天' ? 1 : 2);
      var d = new Date();
      d.setDate(d.getDate() - offsetDays);
      return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate())
        + ' ' + pad2(named[2]) + ':' + named[3];
    }

    // ⑤ 相对时间与兜底交给既有的日期格式化器（N分钟前 / 刚刚 / 15小时前 …）
    var F = global.DataFormatters;
    if (F && typeof F.formatSocialDate === 'function') {
      try {
        var formatted = F.formatSocialDate(s);
        if (formatted) return formatted;
      } catch (e) { /* 落到下面的原文兜底 */ }
    }

    return s;
  }

  // ---------------------------------------------------------------- 站点

  /**
   * 当前是哪一套页面。
   * @returns {'desktop'|'search'|'mobile'|''}
   */
  function getSite() {
    var host = (global.location && global.location.hostname) || '';
    if (host === 'm.weibo.cn') return 'mobile';
    if (host === 's.weibo.com') return 'search';
    if (/(^|\.)weibo\.com$/.test(host)) return 'desktop';
    return '';
  }

  // ---------------------------------------------------------------- 各套页面取值

  /** weibo.com：一条博文 = 一个 article */
  function readDesktop(article) {
    if (!article || article.tagName !== 'ARTICLE') return null;
    var header = article.querySelector('header');
    if (!header) return null;

    // 时间链接 = header 里唯一那条指向 weibo.com/<uid>/<mid> 的链接
    var links = header.querySelectorAll('a[href]');
    var link = null;
    var match = null;
    for (var i = 0; i < links.length; i++) {
      var m = PERMALINK_RE.exec(hrefOf(links[i]));
      if (m) { link = links[i]; match = m; break; }
    }
    if (!link) return null;

    // 昵称在头像链接的 aria-label 上（原创帖、纯转发帖都有）
    var nick = '';
    var avatar = header.querySelector('a[aria-label]');
    if (avatar) nick = (avatar.getAttribute('aria-label') || '').trim();
    // 退一步：头像链接 href 是 /u/<uid>，但那只给 UID 不给昵称，所以没有就用空串

    // v2.7.40：**超话帖**（发到「××超话」里）的 header 首元素是超话入口，
    // 指向 `/p/1008…` 而不是用户主页，因此没有 aria-label —— 昵称读出来是空，
    // 标题只好拿数字 UID 顶上（v2.7.39 真机实证：`7771047739美依礼芽超话…`，
    // 用户看到的是头像名变成一串数字）。
    // 这类帖子的作者昵称在「来自 @昵称」那一行（`<a href="/u/<uid>">`），
    // **并且那个 uid 与本条博文的 uid 相同**；只有 uid 对上才认，
    // 避免把转发来源（别人的 uid）当成作者。
    if (!nick) {
      var owners = header.querySelectorAll('a[href]');
      for (var k = 0; k < owners.length; k++) {
        var own = /\/u\/(\d+)(?:[?#]|$)/.exec(hrefOf(owners[k]));
        if (!own || own[1] !== match[1]) continue;
        nick = (owners[k].textContent || '').trim().replace(/^@/, '').trim();
        if (nick) break;
      }
    }

    // 「本页文案」只取博主自己写的那段（用户 2026-11-01 拍板 A 案）
    //   `_ogText_` 是原创正文区；纯转发帖（博主没写字）这里也会在，只是内容为空，
    //   转发出来的原博在 `.retweet` 里 —— 绝不拿它顶包。
    var textEl = article.querySelector('[class*="_ogText_"]');

    return {
      site: 'desktop',
      uid: match[1],
      mid: match[2],
      url: permalink(match[1], match[2]),
      nick: nick,
      date: normalizeDate(link.getAttribute('title') || textOf(link)),
      text: stripExpandTail(textOf(textEl)),
      hasOgText: !!textEl
    };
  }

  /** s.weibo.com：一条博文 = 一个 .card-wrap，且必须有 .from a */
  function readSearch(card) {
    if (!card || !card.querySelector) return null;
    var from = card.querySelector('.from a');
    if (!from) return null;                     // 「相关用户」「相关兴趣主页」等卡片
    var match = PERMALINK_RE.exec(hrefOf(from));
    if (!match) return null;

    // 长文展开后正文在 .txt-all；短帖只有 .txt
    var textEl = card.querySelector('.txt-all') || card.querySelector('.txt');

    return {
      site: 'search',
      uid: match[1],
      mid: match[2],
      url: permalink(match[1], match[2]),
      nick: textOf(card.querySelector('.name')),
      date: normalizeDate(textOf(from)),
      text: stripExpandTail(textOf(textEl)),
      hasOgText: !!textEl
    };
  }

  /** m.weibo.cn：一条博文 = 一个 .card9，数据来自主世界桥写在属性上的 JSON */
  function readMobile(card) {
    if (!card || typeof card.getAttribute !== 'function') return null;
    var raw = card.getAttribute(MOBILE_ATTR);
    if (!raw) return null;                      // 桥还没跑到（或这条不是博文）→ 不猜
    var data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return null;
    }
    if (!data || !data.id) return null;

    var mid = String(data.id);
    var uid = data.uid ? String(data.uid) : '';
    return {
      site: 'mobile',
      uid: uid,
      mid: mid,
      url: uid ? permalink(uid, mid) : ('https://m.weibo.cn/detail/' + mid),
      nick: String(data.nick || '').trim(),
      date: normalizeDate(data.createdAt || ''),
      text: stripExpandTail(data.text || ''),
      hasOgText: !!data.text
    };
  }

  // ---------------------------------------------------------------- 对外

  /**
   * 页面上所有「看起来是一条博文」的容器（**不保证都能取到 uid/mid**，
   * 调用方要用 `readPost()` 再判一次；取不到就跳过并摘掉按钮）。
   * @returns {Element[]}
   */
  function findContainers() {
    var site = getSite();
    var list = [];
    var i;
    if (site === 'desktop') {
      list = document.querySelectorAll('article');
    } else if (site === 'search') {
      list = document.querySelectorAll('.card-wrap');
    } else if (site === 'mobile') {
      list = document.querySelectorAll('.card9');
    } else {
      return [];
    }

    var out = [];
    for (i = 0; i < list.length; i++) {
      var el = list[i];
      // 排除嵌套（一个 .card9 里不会再套一条 .card9，但万一有，只认最外层）
      var outer = site === 'mobile' ? el.parentElement
        : (site === 'search' ? el.parentElement : null);
      if (outer && outer.closest) {
        var tag = site === 'mobile' ? '.card9' : (site === 'search' ? '.card-wrap' : null);
        if (tag && outer.closest(tag)) continue;
      }
      out.push(el);
    }
    return out;
  }

  /**
   * 读一条博文的 5 个值。
   * @param {Element} el - findContainers() 给的容器
   * @returns {{site:string,uid:string,mid:string,url:string,nick:string,date:string,text:string}|null}
   *          取不到唯一编号就返回 null（认不出绝不猜）
   */
  function readPost(el) {
    var site = getSite();
    if (site === 'desktop') return readDesktop(el);
    if (site === 'search') return readSearch(el);
    if (site === 'mobile') return readMobile(el);
    return null;
  }

  /**
   * 列表页上的「第一条博文」，**只在这个页面确实能读出 2 条以上时才返回**。
   *
   * 用途：用户在列表页点全局悬浮按钮时，两个提取器的整页取值方法（`querySelectorAll()[0]`）
   * 会拼出「第一条博文的正文 + 列表页自己的地址」——一半对一半错，URL 根本点不开。
   * 有了这个，列表页的全局按钮就退化成「提第一条」，字段自洽。
   *
   * 详情页（只读得出 1 条）返回 null，让调用方维持原来的整页取值，零回归。
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
    MOBILE_ATTR: MOBILE_ATTR,
    getSite: getSite,
    findContainers: findContainers,
    readPost: readPost,
    firstPostOnListPage: firstPostOnListPage,
    normalizeDate: normalizeDate,
    stripExpandTail: stripExpandTail,
    permalink: permalink
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.WeiboFeedContext = api;
  }
})(typeof window !== 'undefined' ? window : null);
