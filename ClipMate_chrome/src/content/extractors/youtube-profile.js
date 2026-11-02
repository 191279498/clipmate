/**
 * YouTube 频道页 / 个人主页提取器（v2.7.23）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（youtube-social.js）的关系
 * --------------------------------
 * **完全独立**。作品页认的是 `/watch?v=` 与 `/shorts/<id>`；主页认的是
 * `/@handle`（可带频道子页：/videos、/shorts、/about…）与 `/channel/UC…`
 * （同样可带子页）。两边靠地址分流（见 media-detector 的多规则、
 * extractor-factory 的 URL 规则表，person 必须排在通配 social 之前）。
 *
 * 真机勘察（2026-10-31，接管用户已登录 Edge，`/@YouTube` 与 `/@MediaStorm`，
 * 零点击、零接口调用，只读页面自带数据与 DOM）
 * ------------------------------------------------------------------
 * 数据来源三档，**都不需要主动发请求**：
 *
 *   ① `<script type="application/ld+json">`（schema.org，实测只有 870 字节）
 *      `@type: "ProfilePage"` → `mainEntity`：
 *        `name`           昵称
 *        `alternateName`  账号名（带 @，实测 `@mediastorm`）
 *        `url`            `https://www.youtube.com/channel/UC…`（账号ID 就在里面）
 *        `description`    **简介全文**（实测与 channelMetadataRenderer 逐字相同）
 *        `sameAs`         外链数组（官网 / 社交平台，5 条那种）
 *        `interactionStatistic[0].userInteractionCount`  订阅数**精确值**（不用，见红线一）
 *      隔离世界读得到（它在 DOM 里，不是 window 全局），所以不用桥、不用钩接口。
 *
 *   ② inline `<script>` 里的 `ytInitialData`（**1.3MB**，只截 header 段用）
 *      `header.pageHeaderRenderer` 内的 `text.content`：
 *        `2410位订阅者` / `4660万位订阅者`、`235 个视频` / `1685 个视频`
 *      —— 这是「页面原样」数字的唯一权威来源。
 *      ⚠️ `window.ytInitialData` 在隔离世界是 **undefined**（老坑），
 *         只能读 script 元素的 textContent。
 *
 *   ③ **DOM**（`yt-page-header-view-model`，2026 新版频道页头）：
 *        `h1` 昵称、`@handle`、两串统计、简介全文（带「…更多」尾巴）
 *      页内跳转后 ①② 都不更新，只有它可用。
 *
 * ⚠️ 红线一：**数字照页面原样**（用户 2026-10-31 拍板，与抖音/小红书/快手/IG/TikTok 同口径）。
 *   页面写 `4660万位订阅者` 就存 `4660万`，绝不换成 JSON-LD 里的 `46600000`。
 *
 * ⚠️ 红线二：**`microformat` 那份简介是截断的，绝不能用**。
 *   真机实测 `/@MediaStorm`：`channelMetadataRenderer.description` 与 JSON-LD
 *   `mainEntity.description` 都是 560 字全文，而 `microformat.microformatDataRenderer
 *   .description` 只有 **160 字**。照那份存长简介会被砍掉 400 字。
 *
 * ⚠️ 红线三：**数据块里的必须是页面主人**（本项目栽过四次的坑：小红书 `userInfo`、
 *   快手 `/rest/v/profile/get`、IG `PolarisViewer`、快手 v2.7.10）。
 *   YouTube 这里加两道闸：
 *     · 地址是 `/channel/UC…` → JSON-LD 的 UC 必须与地址栏一致；
 *     · 地址是 `/@handle`    → JSON-LD 的 `alternateName` 必须与地址栏一致
 *       （**大小写不敏感**：真机实测地址 `@MediaStorm`、页面 `@mediastorm`，
 *        硬比会把正常页面全判死）；
 *     · 地址认不出这两种形态 → 一律不放行，退回 DOM。
 *   页内跳转（视频页点频道名进来）时 JSON-LD 还是上一页那份，校验必然失败 →
 *   自动降级 DOM，不会串台。代价是那种情况下账号ID 可能拿不到 —— **拿不到就留空**，
 *   绝不拿 @账号名顶替（IG / 快手 / TikTok 同一条规矩）。
 *
 * 纪律：只读。不点「更多」、不点「和另外 N 个链接」（外链已在 JSON-LD 里）、
 * 不主动打 `/youtubei/` 接口、不批量导航。
 */

class YoutubeProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'youtube_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = 'YouTube';
  }

  /* ======================= 通用小工具 ======================= */

  /** 压空白但保留换行 */
  _norm(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\u3000]+/g, ' ')
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .join('\n');
  }

  /** 取某个元素的文本（jsdom 没有 innerText，两条都试） */
  _domText(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) return '';
      const t = (typeof el.innerText === 'string' && el.innerText) ? el.innerText : el.textContent;
      return String(t == null ? '' : t).trim();
    } catch (e) {
      return '';
    }
  }

  /** 从任意字符串里抠 UC 频道ID（`https://…/channel/UCxxx` → `UCxxx`） */
  _ucFrom(s) {
    const m = String(s || '').match(/\/channel\/(UC[A-Za-z0-9_-]{10,40})/);
    return m ? m[1] : '';
  }

  /* ======================= 地址解析 ======================= */

  /** 地址栏里的频道ID（`/channel/UC…`，含子页）；不是这种地址返回空串 */
  _urlChannelId() {
    try {
      const m = String(window.location.href).match(
        /^https?:\/\/(?:www\.|m\.)?youtube\.com\/channel\/(UC[A-Za-z0-9_-]{10,40})(?:\/[^?#]*)?(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /** 地址栏里的 @账号名（`/@handle`，含子页）；不是这种地址返回空串 */
  _urlHandle() {
    try {
      const m = String(window.location.href).match(
        /^https?:\/\/(?:www\.|m\.)?youtube\.com\/@([A-Za-z0-9._-]{2,40})(?:\/[^?#]*)?(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /* ======================= 数据源 ①：JSON-LD ======================= */

  /**
   * 取通过校验的 schema.org 频道主体（拿不到 / 校验不过返回 null）
   *
   * 为什么必须校验：页面里可能有多份 ld+json（作品页是 `VideoObject`），
   * 而且页内跳转后这份**不会更新**。校验不过就当没有。
   */
  _ldEntity() {
    if (this._ldCache !== undefined) return this._ldCache;
    this._ldCache = null;

    let nodes = [];
    try {
      nodes = Array.prototype.slice.call(
        document.querySelectorAll('script[type="application/ld+json"]')
      );
    } catch (e) {
      nodes = [];
    }

    for (const el of nodes) {
      let obj = null;
      try {
        obj = JSON.parse(el.textContent || '');
      } catch (e) {
        continue; // 坏 JSON 跳过，不抛
      }
      const entity = this._pickProfileEntity(obj);
      if (!entity) continue;
      if (!this._ldMatchesLocation(entity)) continue;
      this._ldCache = entity;
      return this._ldCache;
    }
    return this._ldCache;
  }

  /**
   * 从任意 JSON 结构里找出「频道主页」主体
   *
   * 只认 `@type: ProfilePage` + `mainEntity`（Person / Organization / 缺省），
   * 且主体 url 必须是 `/channel/UC…` —— 作品页的 `VideoObject` 因此被排除。
   */
  _pickProfileEntity(node) {
    const walk = (o) => {
      if (!o || typeof o !== 'object') return null;
      if (Array.isArray(o)) {
        for (const x of o) {
          const r = walk(x);
          if (r) return r;
        }
        return null;
      }
      const type = o['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (types.indexOf('ProfilePage') > -1 && o.mainEntity) {
        const me = Array.isArray(o.mainEntity) ? o.mainEntity[0] : o.mainEntity;
        if (me && typeof me === 'object') {
          const meType = Array.isArray(me['@type']) ? me['@type'][0] : me['@type'];
          const typeOk = !meType || meType === 'Person' || meType === 'Organization';
          const uc = this._ucFrom(me.url || o.url || '');
          if (typeOk && uc) return me;
        }
      }
      // 兜一层：`@graph` 之类的包裹
      if (o['@graph']) {
        const r = walk(o['@graph']);
        if (r) return r;
      }
      return null;
    };
    return walk(node);
  }

  /** JSON-LD 主体与本页地址是否同一个频道（校验不过一律弃用） */
  _ldMatchesLocation(entity) {
    if (!entity) return false;

    const urlId = this._urlChannelId();
    if (urlId) {
      const ldId = this._ucFrom(entity.url);
      return !!ldId && ldId.toLowerCase() === urlId.toLowerCase();
    }

    const urlHandle = this._urlHandle();
    if (urlHandle) {
      const alt = String(entity.alternateName || '').replace(/^@+/, '').trim();
      if (!alt) return false;
      // 大小写不敏感：真机实测地址 `@MediaStorm`、页面 `@mediastorm`
      return alt.toLowerCase() === urlHandle.toLowerCase();
    }

    // 地址不是这两种主页形态（`/c/`、`/user/` 或别的）→ 不放行，退回 DOM
    return false;
  }

  /* ======================= 数据源 ②：ytInitialData（只截 header） ======================= */

  /**
   * 页面 inline `<script>` 里的 `ytInitialData` 原文
   *
   * ⚠️ 隔离世界读不到 `window.ytInitialData`（那是主世界的东西），
   *   但 script **元素**的 textContent 读得到 —— 这也是抖音 `#RENDER_DATA` 的老办法。
   *   1.3MB 全量 JSON.parse 没必要，只要 header 那一段。
   *
   * ⚠️ v2.7.24 修正（真机 2026-10-31 实证）：页面有 **3 个**脚本含 `ytInitialData` 字样，
   *   老实现「含字样 + len>100 就取第一个」恒取到第一个 3.2KB 的播放器特性开关脚本
   *   （`YOUTUBE_PREMIUM_LOGO===window.ytInitialData?.topbar`），它**不含**
   *   `"pageHeaderRenderer"` → `_headerSegment()` 永远返回 '' → 数据源② 是条死路径，
   *   统计全程靠 DOM 兜底（结果碰巧对，但冗余失效、注释与实际不符）。
   *   现在只认**含 `"pageHeaderRenderer"` 的那一份**，其余按长度兜底且要求 >1KB。
   */
  _ytInitialText() {
    if (this._ytTextCache !== undefined) return this._ytTextCache;
    this._ytTextCache = '';
    try {
      const scripts = Array.prototype.slice.call(document.querySelectorAll('script:not([src])'));
      let fallback = '';
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.indexOf('ytInitialData') === -1) continue;
        // 真正带频道页头的那一份
        if (t.indexOf('"pageHeaderRenderer"') > -1) {
          this._ytTextCache = t;
          return this._ytTextCache;
        }
        if (!fallback && t.length > 1000) fallback = t;
      }
      this._ytTextCache = fallback;
    } catch (e) {
      this._ytTextCache = '';
    }
    return this._ytTextCache;
  }

  /**
   * 从 ytInitialData 原文里截出 header 段（约 30KB）
   *
   * 实测 `pageHeaderRenderer` 序列化后约 18KB，往后截 30KB 足够覆盖
   * 标题、@handle、订阅数、视频数。
   */
  _headerSegment() {
    const t = this._ytInitialText();
    if (!t) return '';
    const i = t.indexOf('"pageHeaderRenderer"');
    if (i === -1) return '';
    return t.slice(i, i + 30000);
  }

  /**
   * 数据块里的统计（**页面原样字符串**），拿不到返回 null
   *
   * 必须校验：header 段里找得到 `@handle` 才算数 —— 页内跳转后这段还是
   * 上一页的频道，不校就会把别人的订阅数记到这个人头上。
   *
   * @param {string} handle 本页账号名（可能来自 JSON-LD 或 DOM）
   */
  _headerStats(handle) {
    if (this._headerStatsCache !== undefined) {
      // 缓存按 handle 分档：handle 变了就重算
      if (this._headerStatsHandle === handle) return this._headerStatsCache;
    }
    this._headerStatsHandle = handle;
    this._headerStatsCache = null;

    const seg = this._headerSegment();
    if (!seg) return null;

    const h = String(handle || '').replace(/^@+/, '').trim();
    if (!h) return null;

    // header 段里出现 `@本页账号名` 才认
    const esc = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let hasOwnHandle = false;
    try {
      hasOwnHandle = new RegExp('@' + esc + '(?![A-Za-z0-9._-])', 'i').test(seg);
    } catch (e) {
      hasOwnHandle = seg.toLowerCase().indexOf('@' + h.toLowerCase()) > -1;
    }
    if (!hasOwnHandle) return null;

    this._headerStatsCache = {
      subscribers: this._pickStat(seg, '位订阅者|subscribers?'),
      videos: this._pickStat(seg, '个视频|videos?')
    };
    return this._headerStatsCache;
  }

  /** 在文本里找「数字 + 标签」，只返回数字部分（页面原样，不换算） */
  _pickStat(text, labelPattern) {
    const re = new RegExp(
      '([\\d.,]+\\s*[万亿KMB]?)\\s*(?:' + labelPattern + ')',
      'i'
    );
    const m = String(text || '').match(re);
    if (!m || !m[1]) return '';
    return m[1].replace(/\s+/g, '');
  }

  /* ======================= 数据源 ④：about 页（v2.7.24 新增） ======================= */

  /**
   * about 页的 `aboutChannelViewModel`（拿不到返回 null）
   *
   * ⚠️ **为什么必须单独去 about 页取**：真机实测（2026-10-31，`@taishengding`）
   *   主页 `/@handle` 的 `ytInitialData` 里**根本没有** about 数据 —— 不是藏起来，是没下发。
   *   国家 / 加入日期 / 总观看次数 / 外链全在 `/about` 页的 `aboutChannelViewModel` 里。
   *   点「…更多」按钮无效（那是 disabled 的覆盖层），该频道也没有「简介」tab，
   *   唯一可靠且不改变页面的路子是 **fetch 一次 about 页 HTML**（同源 GET，等价于
   *   用户自己点开 about 页，但不动他的标签、不留历史、不触发渲染）。
   *
   * 两条来源：
   *   ① 当前就停在 about 页 → 直接读当前页脚本，零请求；
   *   ② 否则 fetch `/<@handle 或 /channel/UC…>/about`，从返回 HTML 里抠 JSON 对象。
   *
   * 防串台：`channelId` 必须与当前页同一个频道，对不上整份弃用（返回 null）。
   */
  async _aboutData() {
    // 缓存的是 **Promise** 而不是结果：`extractAccountId` 与 `extractBio` 都会用到它，
    // 万一将来装配器改成并行调用，缓存结果会让第二个调用拿到 null 而重复 fetch。
    if (this._aboutPromise) return this._aboutPromise;
    this._aboutPromise = (async () => {
      // ⚠️ 脚本里拿到数据但校验不过，必须**继续走 fetch**（v2.7.25 修正）：
      // 早先的写法是「有对象就置 null 结束了」，一份脏脚本数据能把 fetch 这条路整个堵死。
      const fromScripts = this._aboutFromScripts();
      if (fromScripts && this._aboutMatchesLocation(fromScripts)) {
        console.info('[ClipMate] YouTube about：当前页脚本已有数据，零请求');
        return fromScripts;
      }
      const fetched = await this._aboutFromFetch();
      if (fetched && this._aboutMatchesLocation(fetched)) return fetched;
      if (fetched) console.warn('[ClipMate] YouTube about：取到的频道与当前页不一致，已丢弃');
      return null;
    })();
    return this._aboutPromise;
  }

  /** 当前页脚本里有没有 about 数据（用户本来就停在 about 页时走这条，零请求） */
  _aboutFromScripts() {
    try {
      const scripts = Array.prototype.slice.call(document.querySelectorAll('script:not([src])'));
      for (const s of scripts) {
        const obj = this._aboutParseFromText(s.textContent || '');
        if (obj) return obj;
      }
    } catch (e) { /* 没有就算了 */ }
    return null;
  }

  /**
   * 从任意文本里抠出 `"aboutChannelViewModel":{…}` 并解析
   *
   * ⚠️ 必须用 `":{` 这个精确形态定位：页面里另有一处
   *   `"aboutChannelViewModel","menuPopupRenderer",…`（service 名清单），
   *   按 `aboutChannelViewModel` 裸串找会命中那片假数据。
   */
  _aboutParseFromText(text) {
    const t = String(text || '');
    const KEY = '"aboutChannelViewModel":{';
    const i = t.indexOf(KEY);
    if (i === -1) return null;
    const braceIdx = t.indexOf('{', i);
    if (braceIdx === -1) return null;
    const json = this._extractJsonObject(t, braceIdx);
    if (!json) return null;
    try {
      const obj = JSON.parse(json);
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 从 `braceIdx` 处的 `{` 开始，按括号配平截出一个完整 JSON 对象字面量
   *
   * 必须自己配平而不是找下一个 `"}`：里面嵌套了 links / commandRuns /
   * styleRuns 好几层，还有 URL 里的 `%3D`、`\u0026` 之类，正则切不准。
   * 顺带处理字符串里的 `\\` 转义 —— 否则 URL 里的 `\"` 会把 inStr 状态搞乱。
   */
  _extractJsonObject(text, braceIdx) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = braceIdx; i < text.length; i++) {
      const c = text[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(braceIdx, i + 1);
      }
    }
    return '';
  }

  /** 要 fetch 的 about 地址（相对路径；拿不到可用地址返回空串） */
  _aboutUrl() {
    const uc = this._urlChannelId();
    if (uc) return '/channel/' + uc + '/about';

    const handle = this._urlHandle();
    if (handle) return '/@' + handle + '/about';

    // 地址认不出（`/c/`、`/user/` 之类）→ 用 JSON-LD 里的身份拼
    const e = this._ldEntity();
    if (e) {
      const id = this._ucFrom(e.url);
      if (id) return '/channel/' + id + '/about';
      const alt = String(e.alternateName || '').replace(/^@+/, '').trim();
      if (alt) return '/@' + alt + '/about';
    }
    return '';
  }

  /**
   * fetch 一次 about 页 HTML（异常一律静默降级成 null）
   *
   * ⚠️ 超时必须**分两段**（v2.7.25 修正，真机 2026-10-31 实证）：
   *   整段共用一个 3 秒定时器时，头部响应只要 1.07 秒、但正文是 **2.5MB**，
   *   `resp.text()` 要读到 2.80 秒才结束 —— 离 3 秒只剩 0.2 秒，扩展里再加
   *   一点调度抖动就被 abort，结果「国家/加入日期/总观看」整份缺失且不报错。
   *   所以：等响应头给 5 秒（服务器慢/被挂住的上界），拿到头之后再给读正文
   *   6 秒（2.5MB 体量的上界）。正常路径总耗时仍是 2.8 秒左右。
   */
  async _aboutFromFetch() {
    const target = this._aboutUrl();
    if (!target) return null;

    let ctrl = null;
    let timer = null;
    const arm = (ms) => {
      if (!ctrl) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { /* 忽略 */ } }, ms);
    };
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        arm(5000); // 阶段一：等响应头
      }
      const resp = await fetch(target, {
        credentials: 'include',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!resp || !resp.ok) {
        console.warn('[ClipMate] YouTube about 页 HTTP ' + (resp ? resp.status : '无响应') + '，已降级');
        return null;
      }
      arm(6000); // 阶段二：读正文（about 页整份 HTML 约 2.5MB）
      const html = await resp.text();
      console.info('[ClipMate] YouTube about 页已读取：' + html.length + ' 字节');
      return this._aboutParseFromText(html);
    } catch (e) {
      // 超时 / 被拦 / 断网都不影响主流程，但要在 console 留痕，否则「字段为什么空」查不出来
      console.warn('[ClipMate] YouTube about 页读取失败（已降级）：' + (e && (e.name || e.message)));
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * about 数据是不是本页这个频道（防串台）
   *
   * 证据按**硬度**排，能比 UC 就绝不用 handle（handle 可改名、大小写还会变）：
   *   ① 地址栏是 `/channel/UC…` → 比 `channelId`
   *   ② JSON-LD 有 UC（整页打开时一定有）→ 比 `channelId`
   *      ⚠️ 这条最要紧：`/@handle` 入口没有 ①，如果不比 UC 就只剩 handle，
   *      而 `canonicalChannelUrl` 里的 handle 是 about 数据**自己带来的**，
   *      拿它跟地址栏比等于自己证明自己 —— 换个频道的 about 也能混过闸口。
   *   ③ 只有 handle 可用（about 页的 JSON-LD 是 VideoObject，拿不到 UC）→ 比 handle，
   *      大小写不敏感（真机实测地址 `@MediaStorm`、`@mediastorm` 页面）。
   */
  _aboutMatchesLocation(obj) {
    if (!obj || !obj.channelId) return false;
    const aboutId = String(obj.channelId).toLowerCase();

    const urlId = this._urlChannelId();
    if (urlId) return aboutId === urlId.toLowerCase();

    const e = this._ldEntity();
    const ldUc = e ? this._ucFrom(e.url) : '';
    if (ldUc) return aboutId === ldUc.toLowerCase();

    const urlHandle = this._urlHandle();
    if (!urlHandle) return false;
    const h = urlHandle.toLowerCase();

    const m = String(obj.canonicalChannelUrl || '').match(/@([A-Za-z0-9._-]{2,40})/);
    if (m) return m[1].toLowerCase() === h;

    if (e) {
      const alt = String(e.alternateName || '').replace(/^@+/, '').trim();
      if (alt) return alt.toLowerCase() === h;
    }
    return false;
  }

  /**
   * about 里的三条概况行（用户 2026-10-31 拍板：国家 + 加入日期 + 总观看全要）
   *
   * 值照页面原样：`日本`、`2022年5月21日`、`5,398,090`。
   * 标签自己定（跟「订阅者：」同一个路子），所以把页面的 `注册` / `次观看` 尾巴剥掉。
   */
  _aboutInfoLines(about) {
    if (!about) return '';
    const lines = [];

    const country = this._textOf(about.country);
    if (country) lines.push('国家：' + country);

    const joined = this._stripJoinedLabel(this._textOf(about.joinedDateText));
    if (joined) lines.push('加入日期：' + joined);

    const views = this._pickStat(this._textOf(about.viewCountText), '次观看|views?');
    if (views) lines.push('总观看：' + views);

    const mail = this._emailFromDom();
    if (mail) lines.push('邮箱：' + mail);

    return lines.join('\n');
  }

  /**
   * 从任意「文本字段」里取值
   *
   * YouTube 这几种形态都出现过：
   *   · 裸字符串            `"country": "日本"`
   *   · `{content: "…"}`    `"joinedDateText": {"content": "2022年5月21日注册"}`
   *   · `{runs:[{text}]}`   老式富文本
   */
  _textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'object') {
      if (typeof v.content === 'string') return v.content.trim();
      if (Array.isArray(v.runs)) {
        return v.runs.map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('').trim();
      }
    }
    return '';
  }

  /** `2022年5月21日注册` → `2022年5月21日`；`Joined Aug 29, 2006` → `Aug 29, 2006` */
  _stripJoinedLabel(s) {
    return String(s || '')
      .replace(/^\s*(?:加入日期|已加入|Joined)\s*[:：]?\s*/i, '')
      .replace(/\s*(?:注册|加入)\s*$/, '')
      .trim();
  }

  /**
   * 邮箱：**只在用户自己点开过「查看电子邮件地址」时才拿得到**
   *
   * 明文只在 `POST /youtubei/v1/channel/reveal_business_email` 的响应里
   * （用户点那个按钮时浏览器发的就是它）。用户 2026-10-31 拍板：**不为它打接口**。
   * 所以这里只读 DOM —— 行展开过就有，没展开过就是空，绝不自己发请求。
   *
   * 防误抓：只在 about 的「更多信息」区块内、且该行带 `mail` 图标、且是合法邮箱形态。
   */
  _emailFromDom() {
    try {
      const box = document.querySelector('ytd-about-channel-renderer #additional-info-container');
      if (!box) return '';
      const rows = Array.prototype.slice.call(box.querySelectorAll('.description-item'));
      for (const row of rows) {
        if (!row.querySelector('yt-icon[icon="mail"]')) continue;
        const t = String(row.textContent || '');
        const m = t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (m) return m[0];
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /* ======================= 数据源 ③：DOM ======================= */

  /** 频道页头容器（新版 `yt-page-header-view-model`，兜底旧的 `#page-header`） */
  _headerEl() {
    try {
      return document.querySelector('yt-page-header-view-model') ||
             document.querySelector('#page-header') ||
             null;
    } catch (e) {
      return null;
    }
  }

  /** 频道页头的文本（读不到返回空串） */
  _headerText() {
    const el = this._headerEl();
    if (!el) return '';
    try {
      const t = (typeof el.innerText === 'string' && el.innerText) ? el.innerText : el.textContent;
      return String(t == null ? '' : t);
    } catch (e) {
      return '';
    }
  }

  /** DOM 里的 @账号名（页头文本里第一个 `@xxx`） */
  _domHandle() {
    const t = this._headerText();
    const m = t.match(/@([A-Za-z0-9._-]{2,40})/);
    return m ? m[1] : '';
  }

  /* ======================= 6 列取值 ======================= */

  /** 昵称：JSON-LD `mainEntity.name` → DOM `h1` */
  async extractNickname() {
    try {
      const e = this._ldEntity();
      if (e && e.name) return String(e.name).replace(/\s+/g, ' ').trim();
      const h1 = this._headerEl() ? this._headerEl().querySelector('h1') : null;
      const t = h1 ? String(h1.textContent || '').trim() : '';
      return t.replace(/\s+/g, ' ');
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取昵称失败:', err);
      return '';
    }
  }

  /**
   * 账号ID：`UC…`（频道内部稳定 ID，ID 改名不变）
   *
   * 只有两个来源：JSON-LD `mainEntity.url` → 地址栏 `/channel/UC…`。
   *
   * ⚠️ **刻意不读 `link[rel=canonical]`**：它在页内跳转（频道 A 点推荐进频道 B）
   *   同样是旧的，会给出**上一个频道**的 UC —— 这是本项目最怕的串台。
   *   地址栏是页内跳转唯一可靠的真值来源；`/@handle` 形态从地址栏拿不到 UC，
   *   **那就留空**，绝不拿 @账号名顶替、也绝不从旧 canonical 猜。
   */
  async extractAccountId() {
    try {
      const e = this._ldEntity();
      if (e) {
        const uc = this._ucFrom(e.url);
        if (uc) return uc;
      }
      // v2.7.24：`/@handle/about` 这种地址栏里没有 UC，但 about 数据的 channelId 有
      const about = await this._aboutData();
      if (about && about.channelId) return String(about.channelId);
      return this._urlChannelId();
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取账号ID失败:', err);
      return '';
    }
  }

  /**
   * 账号名：JSON-LD `alternateName` 去 @ → DOM 页头里的 `@xxx` → 地址栏
   *
   * 必须与作品页的「作者ID」是同一个字符串（`youtube-social.js` 取的是
   * `a[href*="/@"]` 里 @ 后面那段，**保留原大小写**），两份数据才 join 得上。
   * 真机实测页头显示 `@mediastorm`（小写）、`@YouTube`（原样），照抄页面即可。
   */
  async extractAccountName() {
    try {
      const e = this._ldEntity();
      if (e && e.alternateName) {
        return String(e.alternateName).replace(/^@+/, '').trim();
      }
      const dom = this._domHandle();
      if (dom) return dom;
      return this._urlHandle();
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取账号名失败:', err);
      return '';
    }
  }

  /**
   * 网址：`https://www.youtube.com/channel/UC…`（用户 2026-10-31 拍板的官方形态）
   *
   * 页面的 canonical 就是这一串，从任何入口（`/@handle`、`/@handle/videos`、
   * `/channel/UC…`）进来都是同一个人同一个字符串。
   * 拿不到 UC（页内跳转降级）时回落 `https://www.youtube.com/@账号名` ——
   * 绝不自己编一个 UC。
   */
  async extractUrl() {
    try {
      const uc = await this.extractAccountId();
      if (uc) return 'https://www.youtube.com/channel/' + uc;
      const handle = await this.extractAccountName();
      if (handle) return 'https://www.youtube.com/@' + handle;
      return '';
    } catch (err) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名全文 + 概况行（国家/加入日期/总观看/邮箱）+ 外链（一行一条）**
   *
   * 用户 2026-10-31 定（与 IG / TikTok 同口径，v2.7.24 补齐 about 数据）：
   *   · 第一行：`订阅者：2410 · 视频：235`（YouTube 自己的叫法，无获赞总数）
   *   · 第二行起：完整签名（换行保留）
   *   · 概况：`国家：日本` / `加入日期：2022年5月21日` / `总观看：5,398,090`
   *   · 最后：外链，每条一行（YouTube 把外链从简介正文里抽出来了，正文里没有）
   *
   * 情况：`@taishengding`（无外链）
   *   订阅者：4.76万 · 视频：229
   *   大刀阔斧说音乐
   *   国家：日本
   *   加入日期：2022年5月21日
   *   总观看：5,398,090
   * 情况：`@mediastorm`（5 条外链）
   *   订阅者：2410 · 视频：235
   *   MediaStorm is committed to …（560 字全文）
   *   国家：美国
   *   加入日期：2006年8月29日
   *   总观看：260,221
   *   http://mediastorm.com
   *   https://www.facebook.com/mediastorm.org
   *   …
   */
  async extractBio() {
    try {
      // about 数据是异步的（可能要 fetch 一次），先取到再拼
      const about = await this._aboutData();
      const head = [this._statsLine(about), this._signature(about), this._aboutInfoLines(about)]
        .filter(Boolean)
        .join('\n');
      const links = this._externalLinks(about);
      return [head, links.join('\n')].filter(Boolean).join('\n');
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取简介失败:', err);
      return '';
    }
  }

  /* ======================= 简介的三个零件 ======================= */

  /**
   * 统计行：订阅者 / 视频数
   *
   * 数字**照页面原样**：优先页面数据块 header（`4660万位订阅者`），
   * 校验不过（页内跳转）或读不到才读 DOM 页头，最后才用 about 页的同款字符串。
   * 三处都是页面自己渲染的字符串，绝不用 JSON-LD 里的精确值换算。
   *
   * @param {object|null} about about 页数据（可为 null）
   */
  _statsLine(about) {
    const handle = this._domHandle() || this._urlHandle() ||
                   (this._ldEntity() && this._ldEntity().alternateName
                     ? String(this._ldEntity().alternateName).replace(/^@+/, '') : '');

    const block = this._headerStats(handle);
    const domText = this._headerText();

    const subs = (block && block.subscribers) ||
                 this._pickStat(domText, '位订阅者|subscribers?') ||
                 this._pickStat(this._textOf(about && about.subscriberCountText), '位订阅者|subscribers?');
    const vids = (block && block.videos) ||
                 this._pickStat(domText, '个视频|videos?') ||
                 this._pickStat(this._textOf(about && about.videoCountText), '个视频|videos?');

    const parts = [];
    if (subs) parts.push('订阅者：' + subs);
    if (vids) parts.push('视频：' + vids);
    return parts.join(' · ');
  }

  /**
   * 签名（简介正文全文）
   *
   * ① about 页 `description`（**全文**，实测 `@mediastorm` 560 字）—— 最稳，有就用；
   * ② JSON-LD `mainEntity.description`（也是全文，整页打开时的等价来源）；
   * ③ DOM 页头里的简介块（页内跳转后只剩它），剪掉「…更多」尾巴；
   * ④ 都没有就空着。
   *
   * ⚠️ **绝不读 `microformat.microformatDataRenderer.description`** ——
   *   真机实测它只有 160 字（截断），长简介会被砍掉一大截。
   *
   * ⚠️ 一手拿到但为空 = 真的没写简介，不回落 DOM 占位话（TikTok v2.5.99 的教训）。
   *
   * @param {object|null} about about 页数据（可为 null）
   */
  _signature(about) {
    // ① about 页（拿到了就定案：空串表示这号真的没写简介）
    if (about) return this._norm(this._textOf(about.description));

    // ② JSON-LD
    const e = this._ldEntity();
    if (e) return this._norm(e.description || '');

    // ③ DOM
    const el = this._descEl();
    if (!el) return '';
    let t = '';
    try {
      t = (typeof el.innerText === 'string' && el.innerText) ? el.innerText : el.textContent;
    } catch (err) {
      t = '';
    }
    return this._norm(this._stripMoreTail(t));
  }

  /** DOM 里的简介块（只在新版页头里找，避免抓到推荐区的文字） */
  _descEl() {
    const h = this._headerEl();
    if (!h) return null;
    const sels = [
      '[class*="ytPageHeaderViewModelDescr"]',
      'yt-description-preview-view-model',
      '#description'
    ];
    for (const s of sels) {
      try {
        const el = h.querySelector(s);
        if (el) return el;
      } catch (e) { /* 下一个 */ }
    }
    return null;
  }

  /** 去掉展开提示尾巴（中文「…更多」、英文「… more」） */
  _stripMoreTail(s) {
    return String(s || '').replace(/\s*(?:\.{2,}|…)\s*(?:更多|more)\s*$/i, '').trim();
  }

  /**
   * 外链：**一行一条**
   *
   * 三个来源，按「干净程度」排：
   *   ① JSON-LD `sameAs` —— 已是完整可点地址，最省事
   *   ② about 页 `links[]`（v2.7.24 新增）—— 有外链的频道一定在这里，
   *      `channelExternalLinkViewModel.link.commandRuns[].onTap.innertubeCommand
   *      .urlEndpoint.url` 是跳转壳（`/redirect?…&q=<真地址>`），交给 `_cleanLink` 解；
   *      解不出来才退回显示文本（`link.content`，形如 `mediastorm.com`，补 https）
   *   ③ DOM `yt-channel-external-link-view-model` —— 需要用户点开「和另外 N 个链接」
   *      才渲染，所以往往为空
   *
   * 实测 `/@YouTube` 的 sameAs 第一条是
   * `https://youtube.com/user/youtube?sub_confirmation=1` —— 那是「订阅」按钮的
   * 跳转地址，不是频道外链，必须排除（带 `sub_confirmation` 的一律不要）。
   *
   * @param {object|null} about about 页数据（可为 null）
   */
  _externalLinks(about) {
    const out = [];
    const push = (u) => {
      const s = this._cleanLink(u);
      if (s && out.indexOf(s) === -1) out.push(s);
    };

    // ① JSON-LD sameAs
    const e = this._ldEntity();
    if (e && Array.isArray(e.sameAs)) e.sameAs.forEach(push);
    if (out.length) return out;

    // ② about 页 links
    if (about && Array.isArray(about.links)) {
      about.links.forEach((it) => {
        const vm = it && it.channelExternalLinkViewModel;
        if (!vm) return;
        const target = this._linkTargetOfVm(vm);
        if (target) push(target);
        else push(this._textOf(vm.link && vm.link.content));
      });
    }
    if (out.length) return out;

    // ③ DOM 兜底（需要用户点开「和另外 N 个链接」才渲染，所以往往为空）
    try {
      const nodes = document.querySelectorAll(
        'yt-channel-external-link-view-model a[href], ytChannelExternalLinkViewModelHost a[href]'
      );
      Array.prototype.slice.call(nodes).forEach((a) => push(a.getAttribute('href')));
    } catch (err) { /* 没有就算了 */ }
    return out;
  }

  /**
   * 从 about 的 `channelExternalLinkViewModel` 里取**真实目标地址**
   *
   * 结构（真机实测 `@mediastorm`）：
   *   link.commandRuns[0].onTap.innertubeCommand.urlEndpoint.url
   *     = `https://www.youtube.com/redirect?event=channel_description&…&q=http%3A%2F%2Fmediastorm.com`
   * 取到壳地址后由 `_cleanLink` 解出 `q=`。
   */
  _linkTargetOfVm(vm) {
    try {
      const runs = (vm && vm.link && vm.link.commandRuns) || [];
      for (const r of runs) {
        const cmd = r && r.onTap && r.onTap.innertubeCommand;
        const url = cmd && cmd.urlEndpoint && cmd.urlEndpoint.url;
        if (url) return String(url);
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /**
   * 洗一条外链：解跳转壳 → 去订阅按钮 → 去站内地址
   * 解不出来返回空串（宁可少一条，不存打不开的壳）
   */
  _cleanLink(raw) {
    let u = String(raw || '').trim();
    if (!u) return '';

    // ① YouTube 跳转壳：`/redirect?…&q=<真地址>`
    const m = u.match(/[?&]q=([^&#]+)/);
    if (m && m[1] && u.indexOf('/redirect') > -1) {
      try {
        u = decodeURIComponent(m[1]);
      } catch (e) { /* 保持原样，下面会被挡掉 */ }
    }

    if (!/^https?:\/\//i.test(u)) {
      // 有的频道写的是裸域名，补个协议
      if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(u)) {
        u = 'https://' + u;
      } else {
        return '';
      }
    }

    // ② 订阅按钮（`sub_confirmation=1`）不是外链
    if (/[?&]sub_confirmation=/i.test(u)) return '';
    if (/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/user\//i.test(u)) return '';

    // ③ 站内地址不算外链
    if (/^https?:\/\/(?:www\.|m\.)?youtube\.com(?:\/|$)/i.test(u)) return '';
    if (/^https?:\/\/youtu\.be(?:\/|$)/i.test(u)) return '';

    return u;
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[YoutubeProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'account' });
  }

  async extractSpecificFields() {
    return {};
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
if (typeof window !== 'undefined') {
  window.YoutubeProfileExtractor = YoutubeProfileExtractor;
}
