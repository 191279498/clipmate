/**
 * X（Twitter）个人主页提取器（v2.7.27）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（x-social.js）的关系
 * ----------------------------------------------------------
 * **完全独立**。作品页认 `/​<handle>/status/<id>`（单条推文）；主页认
 * `/<handle>` 与 `/<handle>/about`。两边靠地址分流（media-detector 的多规则、
 * extractor-factory 的 URL 规则表，person 必须排在通配 social 之前）。
 *
 * 真机勘察（2026-10-31，接管用户已登录 Edge，`x.com/AI_Jasonyu`，零导航零接口）
 * ----------------------------------------------------------------------
 *   ① **JSON-LD**（`script[type="application/ld+json"]`，`@type: ProfilePage`，约 1.2KB，
 *      服务端直出进 HTML）——**主数据源**，不需要钩请求：
 *        mainEntity.name                昵称（鱼总聊AI）
 *        mainEntity.additionalName      handle（AI_Jasonyu）
 *        mainEntity.description         简介单行原样（emoji/URL 完整）
 *        mainEntity.identifier          **数字 ID**（756319701861601281，永远不变）
 *        mainEntity.homeLocation.name   位置（自由文本，如「商务合作联系👉」）
 *        mainEntity.interactionStatistic  Follows=72072 / Friends=1687 / Tweets=10549（**精确值**）
 *        dateCreated                    2016-07-22T02:47:23.000Z（精确加入日期）
 *        relatedLink[]                  外链（t.co 壳 + 真实域名）
 *   ② **页面 DOM**（data-testid 语义化，页面原样数字的唯一来源）：
 *        UserName            `鱼总聊AI\n@AI_Jasonyu`
 *        UserDescription     简介全文（带换行排版）
 *        UserLocation        `商务合作联系`（与 JSON-LD 差个 emoji，以 DOM 为准）
 *        UserJoinDate        `2016年7月 加入`（只有年月）
 *        UserUrl             `yuzong.ai/bio`（href 是 t.co 壳）
 *        a[href$="/verified_followers"]   `7.2万 关注者`
 *        a[href$="/following"]            `1,687 正在关注`
 *        帖子数              全页文本 `<n> 帖子`（英文界面 `posts`），锚点弱、
 *                           JSON-LD 的 Tweets 兜底
 *
 * 用户 2026-10-31 拍板：
 *   · 账号ID 列 = handle；**数字 ID 进简介**（`数字ID：756319701861601281`）
 *   · 统计行 = 帖子 + 关注者（`帖子：1万 · 关注者：7.2万`，页面原样不换算）
 *   · 简介正文 = DOM 版（带换行排版；JSON-LD 版单行不用）
 *   · 加入日期精确到日（JSON-LD dateCreated → `2016年7月22日`，YouTube 同口径）
 *
 * ⚠️ 防串台铁律（本项目第六次防串台）：JSON-LD 是 SSR 数据块，**必须先校验
 *   mainEntity.url / additionalName 与地址栏 handle 一致（大小写不敏感）才可用**；
 *   不一致整份弃用、绝不瞎编。X 列表页/弹层切换时数据块可能是上一个用户的。
 *
 * ⚠️ 数字照页面原样：页面 `7.2万` 就存 `7.2万`，JSON-LD 的 72072 只兜底
 *   （页面锚点挂了才用），绝不拿精确值换算。
 *
 * 纪律：零导航、零接口请求 —— 全部数据都在当前文档里（JSON-LD + DOM）。
 */

class XProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = 'X';
    this.siteName = 'x_profile';
  }

  /* ======================= 通用小工具 ======================= */

  /** 压空白但保留换行（与 weibo-profile 同一份实现） */
  _norm(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\u3000]+/g, ' ')
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .join('\n');
  }

  /** 取元素文本（jsdom 没有 innerText，两条都试） */
  /**
   * 取元素文本（jsdom 没有 innerText，两条都试）
   *
   * ⚠️ v2.7.30 修（真机踩到）：X 为了把链接里的协议头视觉上折叠掉，会把它塞进一个
   *    `<span style="display:block;position:absolute" aria-hidden="true">http://</span>`。
   *    块级元素会让 `innerText` 插一个换行 → 简介里出现
   *        `付费墙Agent：\nhttp://\npaywallpro.app`
   *    链接被硬生生断成两行（用户看到的「超链接没了」）。
   *    锚的 `textContent` 才是整串 `http://paywallpro.app`，所以**用 textContent 把
   *    innerText 里那段换行版本换回去**。其余换行是作者自己敲的，必须保留。
   */
  _text(el) {
    if (!el) return '';
    try {
      let t = (typeof el.innerText === 'string' && el.innerText) ? el.innerText : el.textContent;
      if (typeof el.querySelectorAll === 'function' && typeof t === 'string') {
        const anchors = el.querySelectorAll('a');
        for (let i = 0; i < anchors.length; i++) {
          const a = anchors[i];
          const raw = a.innerText;
          const flat = String(a.textContent == null ? '' : a.textContent).replace(/[\r\n]+/g, ' ');
          // 只处理「被块级子元素插了换行」的锚；锚内本来就是单行的不动
          if (raw && flat && raw !== flat && t.indexOf(raw) > -1) {
            t = t.split(raw).join(flat);
          }
        }
      }
      return this._norm(t);
    } catch (e) {
      return '';
    }
  }

  /** 取第一个命中元素的文本 */
  _textOf(selector) {
    try {
      return this._text(document.querySelector(selector));
    } catch (e) {
      return '';
    }
  }

  /** X 的一级功能路由段（不是 handle）——与 media-detector 的负向断言同口径 */
  _reserved() {
    return {
      home: 1, explore: 1, search: 1, i: 1, settings: 1, notifications: 1,
      messages: 1, compose: 1, intent: 1, personalize: 1, privacy: 1, tos: 1,
      login: 1, signup: 1, logout: 1, session: 1, account: 1, share: 1,
      hashtag: 1, trends: 1, dev: 1, jobs: 1, help: 1, welcome: 1, verify: 1,
      flow: 1, articles: 1, events: 1, browse: 1
    };
  }

  /**
   * 地址栏里的 handle（`/<handle>` 单段或 `/<handle>/about` 子页）；其余返回空串。
   * `/<handle>/status/<id>`、`/i/flow` 等多段路径不认 —— 那些不是主页。
   */
  _urlHandle() {
    try {
      const p = String(window.location.pathname || '');
      const m = p.match(/^\/([A-Za-z0-9_]{1,15})(?:\/about)?\/?$/);
      if (!m) return '';
      if (this._reserved()[m[1].toLowerCase()]) return '';
      return m[1];
    } catch (e) {
      return '';
    }
  }

  /**
   * JSON-LD 的 ProfilePage 对象（**过防串台校验才返回**，否则 null）
   *
   * X 的 SSR 数据块在 `script[type="application/ld+json"]` 里，`@type` 为
   * ProfilePage。换人/弹层切换时可能残留上一个人的 → 必须比对地址栏。
   */
  _ld() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let i = 0; i < scripts.length; i++) {
        let obj = null;
        try { obj = JSON.parse(scripts[i].textContent || ''); } catch (e) { obj = null; }
        if (!obj || obj['@type'] !== 'ProfilePage') continue;
        const ent = obj.mainEntity;
        if (!ent || ent['@type'] !== 'Person') continue;

        // 防串台：url 的 pathname 第一段（或 additionalName）必须与地址栏一致
        const urlHandle = (() => {
          try {
            if (!ent.url) return '';
            const u = new URL(String(ent.url));
            const m = String(u.pathname || '').match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
            return m ? m[1] : '';
          } catch (e) { return ''; }
        })();
        const extraHandle = String(ent.additionalName || '').replace(/^@+/, '').trim();
        const mine = this._urlHandle().toLowerCase();
        if (!mine) return null; // 地址栏都不是主页形态（理论上路由不会走到这）
        const okByUrl = urlHandle && urlHandle.toLowerCase() === mine;
        const okByName = extraHandle && extraHandle.toLowerCase() === mine;
        if (!okByUrl && !okByName) {
          console.warn('[ClipMate] X 主页 JSON-LD 与地址栏不一致（'
            + (urlHandle || extraHandle || '空') + ' ≠ ' + mine + '），整份弃用');
          return null;
        }
        return { ld: obj, ent: ent };
      }
    } catch (e) { /* 没有就算了 */ }
    return null;
  }

  /** JSON-LD 里的精确计数（Follows=关注者 / Friends=正在关注 / Tweets=帖子） */
  _ldCount(ent, name) {
    try {
      const arr = Array.isArray(ent.interactionStatistic) ? ent.interactionStatistic : [];
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || it.name !== name) continue;
        const n = Number(it.userInteractionCount);
        if (Number.isFinite(n) && n >= 0) return String(n);
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /** 页头统计链接里的数字（页面原样）：`7.2万 关注者` → `7.2万` */
  _statFromDom(suffix) {
    try {
      const links = document.querySelectorAll('a[href$="' + suffix + '"]');
      for (let i = 0; i < links.length; i++) {
        // 用 _text（innerText/textContent 双保险）：jsdom 没有 innerText
        const m = this._text(links[i]).match(/^([\d.,]+\s*[万亿kKmMwW]?)\s/);
        if (m) return m[1].trim();
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /** 帖子数：全页找 `<n> 帖子` / `<n> posts`（页面原样；锚点弱） */
  _postsFromDom() {
    try {
      const spans = document.querySelectorAll('span');
      for (let i = 0; i < spans.length; i++) {
        if (spans[i].children.length) continue;
        const m = this._text(spans[i]).match(/^([\d.,]+\s*[万亿kKmM]?)\s*(?:帖子|posts)$/i);
        if (m) return m[1].trim();
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /**
   * 加入日期：JSON-LD 顶层 `dateCreated`（`2016-07-22T…`）→ `2016年7月22日`
   * （去前导零；YouTube 同口径）。真机形态：dateCreated 在 ProfilePage 顶层，
   * 不在 mainEntity 里。
   */
  _fmtJoinDate(ld) {
    try {
      const s = String(ld && ld.dateCreated || '');
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (m) return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /* ======================= 六个字段 ======================= */

  /** 平台列（PersonFieldsBuilder 优先调方法，读不到才看 platformName） */
  async extractPlatform() {
    return 'X';
  }

  /** 昵称：JSON-LD name → DOM UserName 第一行 */
  async extractName() {
    try {
      const w = this._ld();
      if (w && w.ent.name) return this._norm(w.ent.name);
      const t = this._textOf('[data-testid="UserName"]');
      if (t) {
        // `鱼总聊AI\n@AI_Jasonyu\n·\n7月25日` → 第一行是昵称
        const first = String(t).split('\n').map((x) => x.trim()).filter(Boolean)[0] || '';
        if (first && !first.startsWith('@')) return first;
      }
      return '';
    } catch (err) {
      console.error('[XProfileExtractor] 提取昵称失败:', err);
      return '';
    }
  }

  /** 账号ID：handle（地址栏优先；JSON-LD additionalName 兜底）。用户拍板 handle 做账号ID */
  async extractAccountId() {
    try {
      return this._urlHandle() || (() => {
        const w = this._ld();
        return w ? String(w.ent.additionalName || '').replace(/^@+/, '').trim() : '';
      })();
    } catch (err) {
      console.error('[XProfileExtractor] 提取账号ID失败:', err);
      return '';
    }
  }

  /** 账号名：handle（X 没有独立于 handle 的账号名，与账号ID 同串） */
  async extractAccountName() {
    try {
      return await this.extractAccountId();
    } catch (err) {
      console.error('[XProfileExtractor] 提取账号名失败:', err);
      return '';
    }
  }

  /** 网址：`https://x.com/<handle>`（官方形态重拼，`/about` 子页也归到它） */
  async extractUrl() {
    try {
      const h = await this.extractAccountId();
      return h ? 'https://x.com/' + h : '';
    } catch (err) {
      console.error('[XProfileExtractor] 提取网址失败:', err);
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名（DOM 版）+ 位置 + 数字ID + 加入日期 + 外链**
   *
   * 用户 2026-10-31 拍板：
   *   · 第一行：`帖子：1万 · 关注者：7.2万`（页面原样；JSON-LD 精确值兜底）
   *   · 正文：DOM UserDescription（带换行排版）；JSON-LD description 只兜底
   *   · `位置：商务合作联系`（DOM UserLocation；JSON-LD homeLocation 兜底）
   *   · `数字ID：756319701861601281`（JSON-LD identifier）
   *   · `加入日期：2016年7月22日`（JSON-LD dateCreated；DOM `2016年7月 加入` 兜底）
   *   · 外链一行（UserUrl 显示文本）
   *
   * 实例（鱼总聊AI）：帖子：1万 · 关注者：7.2万 / AI & 出海& Saas… / 位置：商务合作联系 /
   *   数字ID：756319701861601281 / 加入日期：2016年7月22日 / yuzong.ai/bio
   */
  async extractBio() {
    try {
      const w = this._ld();
      const ent = w ? w.ent : null;
      const parts = [];

      // ① 统计行：帖子 + 关注者（页面原样 → JSON-LD 精确值兜底）
      const stat = [];
      const posts = this._postsFromDom() || (ent ? this._ldCount(ent, 'Tweets') : '');
      if (posts) stat.push('帖子：' + posts);
      const followers = this._statFromDom('/verified_followers') ||
        (ent ? this._ldCount(ent, 'Follows') : '');
      if (followers) stat.push('关注者：' + followers);
      if (stat.length) parts.push(stat.join(' · '));

      // ② 签名：DOM UserDescription（排版原样）→ JSON-LD description 兜底
      let bio = this._textOf('[data-testid="UserDescription"]');
      if (!bio && ent && ent.description) bio = this._norm(ent.description);
      if (bio) parts.push(bio);

      // ③ 位置（用户自填自由文本，不一定是地理）
      let loc = this._textOf('[data-testid="UserLocation"]');
      if (!loc && ent && ent.homeLocation && ent.homeLocation.name) {
        loc = this._norm(ent.homeLocation.name);
      }
      if (loc) parts.push('位置：' + loc);

      // ④ 数字 ID（用户拍板：handle 做账号ID，数字ID 进简介）
      if (ent && ent.identifier) parts.push('数字ID：' + String(ent.identifier));

      // ⑤ 加入日期：JSON-LD 精确到日 → DOM `2016年7月 加入` 兜底
      let joined = this._fmtJoinDate(w ? w.ld : null);
      if (!joined) {
        const dom = this._textOf('[data-testid="UserJoinDate"]');
        const m = String(dom || '').match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
        if (m) joined = m[1] + '年' + Number(m[2]) + '月';
      }
      if (joined) parts.push('加入日期：' + joined);

      // ⑥ 外链：UserUrl 显示文本（href 是 t.co 壳，短链没意义）→ relatedLink 兜底
      const urlText = this._textOf('[data-testid="UserUrl"]');
      if (urlText) {
        parts.push(urlText);
      } else if (w && Array.isArray(w.ld.relatedLink)) {
        // relatedLink 在 ProfilePage 顶层（真机形态），不在 mainEntity 里；
        // t.co 是壳短链，跳过，取真实域名
        const real = w.ld.relatedLink.map((x) => String(x)).filter((x) => x.indexOf('t.co/') === -1);
        if (real.length) parts.push(real[0]);
      }

      return this._norm(parts.join('\n'));
    } catch (err) {
      console.error('[XProfileExtractor] 提取简介失败:', err);
      return '';
    }
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的 extractXxx 方法。
   *
   * ⚠️ v2.7.29 补：缺少本方法时浮窗会渲染出 6 个空行（person 路由判定成功，
   *    但没有任何值被装配进去）。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[XProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'account' });
  }

  async extractSpecificFields() {
    return {};
  }
}

window.XProfileExtractor = XProfileExtractor;
