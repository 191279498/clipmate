/**
 * 微博个人主页提取器（v2.7.26）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（weibo-social.js / weibo-mobile-social.js）的关系
 * ----------------------------------------------------------
 * **完全独立**。作品页认的是 `/u/<uid>/<mid>`（单条微博）；主页认的是
 * `/u/<数字uid>` 与 `/<自定义域名>`。两边靠地址分流（见 media-detector 的多规则、
 * extractor-factory 的 URL 规则表，person 必须排在通配 social 之前）。
 *
 * 真机勘察（2026-10-31，接管用户已登录 Edge，`weibo.com/u/2803301701` 人民日报 与
 * `weibo.com/renminribao`，只读页面与 DOM，外加一次 `/ajax/profile/detail`）
 * ----------------------------------------------------------------------
 *   ① **页面 DOM**（唯一权威的「页面原样」数字来源）
 *        粉丝        `a[href*="?relate=fans"]` 内的 `<span><span>1.58亿</span>粉丝</span>`
 *        微博数      全页文本 `全部微博（154798）`
 *        访问量      `[class*="_visits_"]` → `访问量 28万+`
 *        昵称        `[class*="_name_"]`（**必须限定在页头里**，微博列表里也有同名类）
 *        简介显示值  `[class*="_descText_"]`
 *
 *   ② **页面自己发的详情接口** `/ajax/profile/detail?uid=<页面主人uid>`（JSON）
 *        `description`   个性签名（普通人只有它，例：`微醺  天涯何必梦醒`）
 *        `desc_text`     认证说明（认证号才有，例：`《人民日报》法人微博`）
 *        `birthday`      `1948-06-15 双子座`
 *        `created_at`    `2012-07-22 02:28:35`
 *        `company` / `career.company`  `人民日报社`
 *        `links`         `[{title:'人民网', url:'http://t.cn/hoXD3'}]` ← **页面上完全没有**
 *        `cnt_desc`      `访问量 28万+`
 *     用户 2026-10-31 拍板：**允许自动请求这一次**（与 YouTube about 同路子）。
 *
 * ⚠️ 红线一：**`$CONFIG` 里是登录者自己，绝对不能碰**（本项目第五次踩这个坑：
 *   小红书 `userInfo`、快手 `/rest/v/profile/get`、IG `PolarisViewer`、
 *   快手 v2.7.10、YouTube 之前的几次）。
 *   真机实测 `weibo.com/u/2803301701`（人民日报）页面上：
 *     `$CONFIG.uid`  = 1647019414  ← **登录者本人**
 *     `$CONFIG.user.followers_count` = 188 ← 登录者自己的粉丝数
 *   拿它填「账号ID / 简介」就是把用户隐私写进别人的记录。源码里**不许出现 `$CONFIG`**。
 *
 * ⚠️ 红线二：**页面主人的 uid 只有一条可靠来路** —— 页头的粉丝/关注按钮：
 *     `a[href="/u/page/follow/2803301701?relate=fans"]`
 *   这条链接是页面自己渲染的「点进去看这个人的粉丝」，指向的必然是**页面主人**。
 *   `/u/数字` 与 `/自定义域名` 两种地址形态下都存在，所以两种入口都能拿到 uid。
 *   **绝不从 `$CONFIG`、绝不从微博列表里的作者链接取**（那可能是转发的别人）。
 *
 * ⚠️ 红线三：**数字照页面原样**（与抖音/小红书/快手/IG/TikTok/YouTube 同口径）。
 *   页面写 `1.58亿` 就存 `1.58亿`，接口里的精确值（如果有）不许拿来换算。
 *
 * ⚠️ 红线四：**昵称与简介必须来自页头**。微博列表里每条微博都带作者名，
 *   全页 `[class*="_name_"]` 会命中多个；`[class*="_descText_"]` 反而只在页头。
 *   所以昵称以「页头容器」为准，页头容器用粉丝链接往上找。
 *
 * 纪律：只在**用户点提取时**请求一次详情接口，不批量导航、不轮询、不点「关注」。
 */

class WeiboProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'weibo_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = '微博';
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

  /** 取元素文本（jsdom 没有 innerText，两条都试） */
  _text(el) {
    if (!el) return '';
    try {
      const t = (typeof el.innerText === 'string' && el.innerText) ? el.innerText : el.textContent;
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

  /* ======================= 地址解析 ======================= */

  /** 微博的一级功能路由段（不是用户名）。 */
  _reserved() {
    return {
      u: 1, n: 1, p: 1, tv: 1, ajax: 1, api: 1, detail: 1, hot: 1, search: 1,
      login: 1, signup: 1, reg: 1, newlogin: 1, verify: 1, setting: 1, settings: 1,
      message: 1, at: 1, my: 1, help: 1, about: 1, ttarticle: 1, fav: 1, like: 1,
      comment: 1, comments: 1, repost: 1, friend: 1, profile: 1, index: 1, home: 1,
      w: 1, d: 1, s: 1, i: 1, e: 1, a: 1, b: 1, c: 1, m: 1
    };
  }

  /** 地址栏里的数字 uid（`/u/<数字>`）；不是这种地址返回空串 */
  _urlUid() {
    try {
      const m = String(window.location.pathname || '').match(/^\/u\/(\d{5,20})\/?$/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 地址栏里的自定义域名（`/<域名>` 单段）；不是这种地址返回空串
   *
   * 微博允许用户把自己的主页设成 `weibo.com/renminribao` 这种。用户 2026-10-31 拍板：
   * **「账号名」列有就填、没有就留空** —— 从 `/u/1234567890` 进来时地址栏没有域名，留空。
   * 真机实测：自定义域名**可能与页面渲染出来的人不一致**（`/renminribao` 打开是别人），
   * 所以这里只做「地址栏照抄」，不拿它去猜身份。
   */
  _urlCustomDomain() {
    try {
      const m = String(window.location.pathname || '').match(/^\/([A-Za-z][A-Za-z0-9_-]{1,29})\/?$/);
      if (!m) return '';
      if (this._reserved()[m[1].toLowerCase()]) return '';
      return m[1];
    } catch (e) {
      return '';
    }
  }

  /* ======================= 页面主人 uid ======================= */

  /**
   * 页头粉丝链接里的 uid（**唯一可靠来路**，见红线二）
   *
   * 优先 `?relate=fans` 那条（页头「粉丝」按钮）；没有就退到任意 `/u/page/follow/`。
   */
  _pageUid() {
    try {
      const a = document.querySelector('a[href*="?relate=fans"]') ||
                document.querySelector('a[href*="/u/page/follow/"]');
      if (!a) return '';
      const m = String(a.getAttribute('href') || '').match(/\/u\/page\/follow\/(\d{5,20})/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 等页头渲染出来（微博主页是前端渲染，实测首屏要几秒）
   *
   * 最多等 ~1.2 秒。等不到就返回空 —— 绝不拿地址栏的数字硬顶
   * （地址栏可能是上一个用户的，页内跳转时尤其危险）。
   */
  async _waitForUid() {
    for (let i = 0; i < 4; i++) {
      const uid = this._pageUid();
      if (uid) return uid;
      if (i === 3) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    return '';
  }

  /* ======================= 六个字段 ======================= */

  /** 昵称：页头 `_name_`（必须限定在页头，列表里也有同名类） */
  async extractName() {
    try {
      const nameEl = this._headerNameEl();
      const t = this._text(nameEl);
      if (t) return t;
      // 页头还没渲染出来 → 等一下子再试
      await this._waitForUid();
      return this._text(this._headerNameEl()) || this._textOf('[class*="_name_"]');
    } catch (err) {
      console.error('[WeiboProfileExtractor] 提取昵称失败:', err);
      return '';
    }
  }

  /** 页头里的昵称元素：从粉丝链接往上找到一个同时含 `_name_` 的祖先 */
  _headerNameEl() {
    try {
      const anchor = document.querySelector('a[href*="?relate=fans"]') ||
                     document.querySelector('a[href*="/u/page/follow/"]');
      if (!anchor) return null;
      let p = anchor.parentElement;
      for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
        const cand = p.querySelector('[class*="_name_"]');
        if (cand) return cand;
      }
    } catch (e) { /* 没有就算了 */ }
    return null;
  }

  /** 账号ID：页头粉丝链接里的 uid */
  async extractAccountId() {
    try {
      const fromPage = await this._waitForUid();
      if (fromPage) return fromPage;
      // 页头实在渲染不出来（比如被站点降级成纯文本页）→ 退回地址栏的 `/u/<数字>`。
      // `/自定义域名` 形态拿不到 uid，**那就留空**，绝不拿域名顶替。
      return this._urlUid();
    } catch (err) {
      console.error('[WeiboProfileExtractor] 提取账号ID失败:', err);
      return '';
    }
  }

  /** 账号名：地址栏的自定义域名（用户 2026-10-31 拍板；`/u/<数字>` 入口留空） */
  async extractAccountName() {
    try {
      return this._urlCustomDomain();
    } catch (err) {
      console.error('[WeiboProfileExtractor] 提取账号名失败:', err);
      return '';
    }
  }

  /** 网址：`https://weibo.com/u/<uid>`（官方形态，从任何入口进来都同一串） */
  async extractUrl() {
    try {
      const uid = await this.extractAccountId();
      if (uid) return 'https://weibo.com/u/' + uid;
      const domain = this._urlCustomDomain();
      if (domain) return 'https://weibo.com/' + domain;
      return '';
    } catch (err) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 个性签名 + 认证说明 + 概况行 + 外链**
   *
   * 用户 2026-10-31 定（与前面六站同口径）：
   *   · 第一行：`粉丝：1.58亿 · 微博：154798`（只要这两个，不要关注/转评赞）
   *   · 正文：个性签名（`description`）在前、认证说明（`desc_text`）在后，**两个都要**；
   *     相同就去重（普通人只有一个）
   *   · 概况：`访问量：28万+` / `生日：1948-06-15 双子座` / `注册时间：2012-07-22 02:28:35` /
   *     `公司：人民日报社`
   *   · 最后：外链，每条一行，写成 `标题：URL`
   *     （微博的外链是 `t.cn` 短链，没有标题根本看不出是什么，所以标题一起存）
   *
   * 实例（人民日报）：粉丝：1.58亿 · 微博：154798 / 人民日报法人微博。参与、沟通、记录时代。 /
   *   《人民日报》法人微博 / 访问量：28万+ / 生日：1948-06-15 双子座 /
   *   注册时间：2012-07-22 02:28:35 / 公司：人民日报社 / 人民网：http://t.cn/hoXD3
   * 实例（屁屁卓，无认证无外链）：粉丝：841 · 微博：6865 / 微醺 天涯何必梦醒 /
   *   访问量：… / 生日：1985-06-24 巨蟹座 / 注册时间：2010-03-04 00:14:13
   */
  async extractBio() {
    try {
      const detail = await this._detail();
      const blocks = [];

      const stats = this._statsLine();
      if (stats) blocks.push(stats);

      const body = this._signature(detail);
      if (body) blocks.push(body);

      const info = this._infoLines(detail);
      if (info) blocks.push(info);

      const links = this._linkLines(detail);
      if (links.length) blocks.push(links.join('\n'));

      return this._norm(blocks.join('\n'));
    } catch (err) {
      console.error('[WeiboProfileExtractor] 提取简介失败:', err);
      return '';
    }
  }

  /* ======================= 简介的四个零件 ======================= */

  /**
   * 统计行：粉丝 + 微博数（用户 2026-10-31 拍板只要这两个）
   *
   * 都是**页面原样**字符串：`1.58亿`、`154798`。
   */
  _statsLine() {
    const parts = [];
    const fans = this._fansCount();
    if (fans) parts.push('粉丝：' + fans);
    const posts = this._postCount();
    if (posts) parts.push('微博：' + posts);
    return parts.join(' · ');
  }

  /**
   * 粉丝数：`a[href*="?relate=fans"]` 里最内层 span 的文本（`1.58亿`）。
   * ⚠️ 只认 `?relate=fans` 这条，**绝不兜底到任意 `/u/page/follow/`**：
   *   页头「关注」按钮的 href 同样含 `/u/page/follow/<uid>`（`?relate=` 或
   *   `?relate=follow`），兜底命中它会把**关注数**（3096）当成粉丝数。
   *   账号ID 可以用通配兜底（两个按钮都指向页面主人），数字不行。
   */
  _fansCount() {
    try {
      const a = document.querySelector('a[href*="?relate=fans"]');
      if (!a) return '';
      const inner = a.querySelector('span span') || a.querySelector('span');
      const t = this._text(inner) || this._text(a);
      // 兜底把「粉丝」尾巴剥掉（只有一层 span 时会出现 `1.58亿粉丝`）
      return t.replace(/\s*粉丝\s*$/, '').trim();
    } catch (e) {
      return '';
    }
  }

  /** 微博数：全页找 `全部微博（154798）` 里的数字（全角/半角括号都认） */
  _postCount() {
    try {
      const nodes = document.querySelectorAll('*');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (el.children && el.children.length) continue;
        const t = String(el.textContent || '').trim();
        const m = t.match(/^全部微博\s*[（(]\s*([\d,]+)\s*[）)]$/);
        if (m) return m[1].replace(/,/g, '');
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /**
   * 简介正文：个性签名在前、认证说明在后，相同则只留一份
   *
   * 两者的区别（真机实测）：
   *   · 普通人 `desc_text` 为空，页面显示的就是 `description`
   *   · 认证号 `desc_text` 是认证说明（页面显示它），`description` 是个性签名（页面不显示）
   * 用户 2026-10-31 拍板**两个都要**，否则认证号会丢掉自己的签名。
   */
  _signature(detail) {
    const sig = this._norm(detail && detail.description ? detail.description : '');
    const desc = this._norm(detail && detail.desc_text ? detail.desc_text : '');
    const out = [];
    if (sig) out.push(sig);
    if (desc && desc !== sig) out.push(desc);
    // 接口没拿到（网络失败/未登录）→ 退回页面显示的那一句
    if (!out.length) {
      const dom = this._textOf('[class*="_descText_"]');
      if (dom) out.push(dom);
    }
    return out.join('\n');
  }

  /** 概况行：访问量 / 生日 / 注册时间 / 公司（用户 2026-10-31 拍板全要） */
  _infoLines(detail) {
    const lines = [];

    // 访问量优先读 DOM（页面原样 `28万+`）；接口的 `cnt_desc` 是同一串但带前缀
    let visits = this._textOf('[class*="_visits_"]');
    visits = String(visits || '').replace(/^\s*访问量\s*[:：]?\s*/, '').trim();
    if (!visits && detail && detail.cnt_desc) {
      visits = String(detail.cnt_desc).replace(/^\s*访问量\s*[:：]?\s*/, '').trim();
    }
    if (visits) lines.push('访问量：' + visits);

    const birthday = this._norm(detail && detail.birthday ? detail.birthday : '');
    if (birthday) lines.push('生日：' + birthday);

    const joined = this._norm(detail && detail.created_at ? detail.created_at : '');
    if (joined) lines.push('注册时间：' + joined);

    const company = this._norm(
      (detail && detail.company) ||
      (detail && detail.career && detail.career.company) || ''
    );
    if (company) lines.push('公司：' + company);

    return lines.join('\n');
  }

  /**
   * 外链：`links[]` 每条一行，`标题：URL`
   *
   * 微博的外链在**页面上一个字都不显示**（真机实测：`hoXD3` 与「人民网」都不在 HTML 里），
   * 只有这个接口带回来。所以这里没有 DOM 兜底 —— 接口没成功就是空。
   */
  _linkLines(detail) {
    const arr = detail && Array.isArray(detail.links) ? detail.links : [];
    const out = [];
    arr.forEach((it) => {
      if (!it) return;
      const url = this._norm(it.url || '');
      if (!url) return;
      const title = this._norm(it.title || '');
      const line = title && title !== url ? (title + '：' + url) : url;
      if (out.indexOf(line) === -1) out.push(line);
    });
    return out;
  }

  /* ======================= 详情接口 ======================= */

  /**
   * 请求一次 `/ajax/profile/detail?uid=<页面主人uid>`（用户 2026-10-31 拍板允许）
   *
   * 缓存的是 **Promise**：`extractAccountId` 与 `extractBio` 都会用到它，
   * 装配器万一改成并行调用，缓存结果会让第二个调用拿到 null 而重复请求。
   *
   * 超时**分两段**（v2.7.25 学到的教训）：等响应头 5 秒、读正文再 5 秒。
   * 失败一律静默降级（只影响外链/生日/注册时间/公司四项），但要在 console 留痕。
   */
  async _detail() {
    if (this._detailPromise) return this._detailPromise;
    this._detailPromise = (async () => {
      let uid = '';
      try {
        uid = await this.extractAccountId();
      } catch (e) {
        uid = '';
      }
      if (!uid) return null;

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
          arm(5000);
        }
        const resp = await fetch('/ajax/profile/detail?uid=' + encodeURIComponent(uid), {
          credentials: 'include',
          signal: ctrl ? ctrl.signal : undefined
        });
        if (!resp || !resp.ok) {
          console.warn('[ClipMate] 微博主页详情接口 HTTP ' + (resp ? resp.status : '无响应') + '，已降级');
          return null;
        }
        arm(5000);
        const json = await resp.json();
        if (!json || json.ok !== 1 || !json.data) {
          console.warn('[ClipMate] 微博主页详情接口返回异常，已降级');
          return null;
        }
        console.info('[ClipMate] 微博主页详情已读取：uid=' + uid);
        return json.data;
      } catch (e) {
        console.warn('[ClipMate] 微博主页详情读取失败（已降级）：' + (e && (e.name || e.message)));
        return null;
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    return this._detailPromise;
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的 extractXxx 方法。
   *
   * ⚠️ v2.7.29 补：这个方法是**唯一入口**，没有它浮窗会渲染出 6 个空行
   *    （person 路由判定成功 → 按 account 模板出 6 列，但拿不到任何值）。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[WeiboProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'account' });
  }

  async extractSpecificFields() {
    return {};
  }
}


window.WeiboProfileExtractor = WeiboProfileExtractor;
