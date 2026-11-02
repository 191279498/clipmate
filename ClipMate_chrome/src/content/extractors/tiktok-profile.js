/**
 * TikTok 个人主页提取器（v2.7.22）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（tiktok-social.js）的关系
 * --------------------------------
 * **完全独立**。作品页认的是 `/@user/video/<id>`、`/@user/photo/<id>` 和推荐流；
 * 主页是 `/@user`（**单段**，后面不带 /video/ 或 /photo/），两边靠地址分流
 * （见 media-detector 的多规则、extractor-factory 的 URL 规则表）。
 * 主页上点作品 → TikTok 是**真跳转**到作品页（地址变成 /@user/video/<id>），
 * 不像快手/IG 那样盖弹层，所以不需要任何"弹层接管"逻辑。
 *
 * 真机勘察（2026-10-31，接管用户已登录 Edge，`https://www.tiktok.com/@tiktok`，
 * 零点击、只读 DOM 与页面自带数据块）
 * ------------------------------------------------------------------
 * 数据来源两档：
 *
 *   ① **页面自带数据块** `script#__UNIVERSAL_DATA_FOR_REHYDRATION__`
 *      → `__DEFAULT_SCOPE__['webapp.user-detail'].userInfo`
 *      `user`  : id / uniqueId / nickname / signature / secUid / bioLink / verified
 *      `stats` : followerCount / followingCount / heartCount / videoCount
 *      隔离世界能直接读，不用桥、不用钩接口 —— 这是本项目最省事的一个站。
 *      读取与闸口统一在 `tiktok-page-data.js`（v2.5.96 就建好了主页通道）。
 *
 *   ② **DOM**，锚点全是 `data-e2e` 测试属性（不是构建哈希，稳定）：
 *      `h1[data-e2e="user-title"]`        昵称
 *      `[data-e2e="user-subtitle"]`       账号名（**不带 @ 前缀**，实测就是 `tiktok`）
 *      `[data-e2e="user-bio"]`            签名（页内路由回主页时这是唯一来源）
 *      `strong[data-e2e="followers-count"]` 粉丝（innerText `96.5M`，`title="粉丝"`）
 *      `strong[data-e2e="likes-count"]`     获赞（innerText `466.2M`，`title="赞"`）
 *      `a[data-e2e="user-link"]`          外链（**href 是跳转壳**，见下）
 *
 * ⚠️ 红线一：**数字照页面原样**（用户 2026-10-31 拍板，与抖音/小红书/快手/IG 同口径）。
 *   页面写 `96.5M` 就存 `96.5M`。数据块里的精确值（96500000）只在 DOM 读不到时兜底，
 *   且原样存整数、不自己换算缩写 —— 那是假精确。
 *
 * ⚠️ 红线二：**绝不存外链的跳转壳**。
 *   页面 `a[data-e2e="user-link"]` 的 href 是
 *   `https://www.tiktok.com/link/v2?aid=1988&lang=zh-Hans&scene=bio_url&target=tiktok.com%2Fdiscovermore`
 *   —— 真实地址在 `target=` 参数里（URL 编码）。跟 IG 的 `l.instagram.com/?u=` 同一个套路。
 *   存壳地址等于存了一条打不开的本站链接。
 *
 * ⚠️ 红线三：**数据块里的必须是页面主人**。
 *   页面数据块本身的闸口在 `tiktok-page-data.js`（`uniqueId` 必须等于地址里的 @账号名，
 *   大小写不敏感）。本类不自己解析数据块，一律走那个入口，绝不另开一条路。
 *   实测 TikTok 这份 `webapp.user-detail` 就是页面主人（不像小红书 `userInfo`、
 *   快手 `/rest/v/profile/get`、IG `PolarisViewer` 那样放的是登录者自己）——
 *   但闸口照旧钉死，不靠"这个站应该不会错"。
 *
 * 纪律：只读，**不点「更多」**、不主动打 `/api/` 接口、不批量导航。
 */

class TikTokProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'tiktok_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = 'TikTok';
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

  /** 地址栏里的主页账号名（`/@kariina_choi` → `kariina_choi`）；不是主页返回空串 */
  _urlHandle() {
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.urlProfileHandle === 'function') {
        const h = TiktokPageData.urlProfileHandle();
        if (h) return h;
      }
    } catch (e) { /* 落到下面的本地实现 */ }
    try {
      const m = String(window.location.href).match(
        /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,40})\/?(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 页面数据块里的主页快照（拿不到返回 null）
   *
   * **不预热**：`ensureProfileFresh()` 等的是「最新作品时间」（给作品页日期用的），
   * 人物档案一个日期都不要，白等 1.2 秒没意义。数据块在 hydrate 时就在文档里，
   * 同步读即可。
   */
  _profile() {
    if (this._profileCache !== undefined) return this._profileCache;
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.getProfile === 'function') {
        this._profileCache = TiktokPageData.getProfile() || null;
      } else {
        this._profileCache = null;
      }
    } catch (e) {
      this._profileCache = null;
    }
    return this._profileCache;
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

  /** 真实的账号名：数据块的原始写法优先（账号名大小写敏感，TikTok 允许并存） */
  _realHandle() {
    const p = this._profile();
    if (p && p.uniqueId) return String(p.uniqueId);
    return this._urlHandle();
  }

  /* ======================= 6 列取值 ======================= */

  /** 昵称：数据块 `nickname` → DOM `h1[data-e2e="user-title"]` */
  async extractNickname() {
    try {
      const p = this._profile();
      if (p && p.nickname) return String(p.nickname).replace(/\s+/g, ' ').trim();
      return this._domText('[data-e2e="user-title"]').replace(/\s+/g, ' ').trim();
    } catch (e) {
      console.error('[TikTokProfileExtractor] 提取昵称失败:', e);
      return '';
    }
  }

  /**
   * 账号ID：**`secUid`**（形如 `MS4wLjABAAAA…`）
   *
   * 用户 2026-10-31 拍板，与抖音档案的「账号ID」（sec_uid）完全对称：
   * 都是平台内部稳定 ID，@账号名改名字它也不变。
   *
   * **只有数据块给，拿不到就留空** —— 绝不拿 @账号名顶替，
   * 否则这一列在两个来源之间会变成两种东西（IG/快手同一条规矩）。
   */
  async extractAccountId() {
    try {
      const p = this._profile();
      return (p && p.secUid) ? String(p.secUid) : '';
    } catch (e) {
      console.error('[TikTokProfileExtractor] 提取账号ID失败:', e);
      return '';
    }
  }

  /**
   * 账号名：`uniqueId`（如 `tiktok`，页面显示不带 @）
   *
   * 必须与作品页的「作者ID」是同一个字符串（`tiktok-social.js` 头注释：
   * 作者ID = 账号名 uniqueId），两份数据才 join 得上。
   */
  async extractAccountName() {
    try {
      const p = this._profile();
      if (p && p.uniqueId) return String(p.uniqueId);
      // DOM 兜底：实测 `[data-e2e="user-subtitle"]` 的文本不带 @，剥一次防对方改版
      return this._domText('[data-e2e="user-subtitle"]').replace(/^@+/, '').trim();
    } catch (e) {
      console.error('[TikTokProfileExtractor] 提取账号名失败:', e);
      return '';
    }
  }

  /**
   * 网址：按账号名重拼的干净主页地址
   *
   * 地址栏常带 `?lang=zh-Hans`、`?is_from_webapp=1` 这类来源/语言标记，
   * 存进档案没有意义。与抖音 `/user/<sec_uid>`、快手 `/profile/<id>` 一个口径。
   */
  async extractUrl() {
    try {
      const handle = this._realHandle();
      if (!handle) return '';
      return 'https://www.tiktok.com/@' + handle;
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名 + 外链**，合并成一格
   *
   * 用户 2026-10-31 定（与 IG 同口径）：
   *   · 第一行：`粉丝：96.5M · 获赞：466.2M`（**不带关注**；TikTok 主页没有 IP 属地）
   *   · 第二行起：完整签名（换行保留）
   *   · 最后：外链（原始地址，不是 `tiktok.com/link/v2?…` 跳转壳）
   */
  async extractBio() {
    try {
      const p = this._profile();
      const stats = this._statsLine(p);
      const sign = this._signature(p);
      const link = this._bioLink();
      return [stats, sign, link].filter(Boolean).join('\n');
    } catch (e) {
      console.error('[TikTokProfileExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /* ======================= 简介的三个零件 ======================= */

  /**
   * 统计行：粉丝 / 获赞
   *
   * 数字**照页面原样**（`96.5M` 不反解），所以优先读 DOM 的 `data-e2e` 锚点；
   * DOM 读不到才用数据块的精确值（原样存整数，不做缩写换算）。
   */
  _statsLine(profile) {
    const fans = this._statFromDom('followers-count') ||
                 this._exact(profile && profile.followerCount);
    const likes = this._statFromDom('likes-count') ||
                  this._exact(profile && profile.heartCount);

    const parts = [];
    if (fans) parts.push('粉丝：' + fans);
    if (likes) parts.push('获赞：' + likes);
    return parts.join(' · ');
  }

  /**
   * 数据块的精确值 → 字符串（0 / 非数字返回空，宁可缺项也不写 `0`）
   *
   * **不做缩写换算**：接口给 96500000 就存 96500000。
   * 页面上的 `96.5M` 是页面自己缩的，我们不替它缩。
   */
  _exact(v) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) return '';
    return String(Math.round(n));
  }

  /**
   * 从 DOM 读一项统计的数字部分（取不到返回空串）
   *
   * 结构实测（`/@tiktok`，2026-10-31）：
   *   `<strong data-e2e="followers-count" title="粉丝">96.5M</strong>`
   *   父容器 innerText 是 `96.5M\n粉丝` —— 数字在 strong 自己的文字里，标签在 title 属性上。
   *
   * 所以取法就是「读 strong 的文本」+「用 title 兜一层剥标签」，
   * 不需要 IG 那套「逐行配对/按标签 span 找邻居」的花活。
   * 但仍要做**格式校验**：只认「数字 + 可选单位」，别的（比如整个容器文本混进来）一律当没取到。
   *
   * @param {string} e2e data-e2e 值，如 `followers-count`
   */
  _statFromDom(e2e) {
    let el = null;
    try {
      el = document.querySelector('[data-e2e="' + e2e + '"]');
    } catch (e) {
      return '';
    }
    if (!el) return '';

    const raw = this._domText('[data-e2e="' + e2e + '"]');
    if (!raw || raw.length > 24) return '';

    // 万一改版把标签文字也塞进同一元素里（`96.5M粉丝`），按 title 剥掉
    let text = raw;
    let label = '';
    try { label = String(el.getAttribute('title') || '').trim(); } catch (e) { label = ''; }
    if (label && text !== label) {
      text = text.split(label).join('').trim();
    }

    // 只认「数字 + 可选单位（K/M/B/万/亿）」，其余一律不认（宁可走精确值兜底）
    if (!/^[\d.,]+\s*[KMB万亿]{0,2}$/i.test(text)) return '';
    return text.replace(/\s+/g, '');
  }

  /**
   * 签名
   *
   * ① 数据块 `signature`（**全文**，换行保留）——整页打开主页时走这条；
   * ② DOM `[data-e2e="user-bio"]`（页内路由从作品页回主页时数据块还是作品那份，
   *    只剩 DOM 可用）。
   *
   * ⚠️ **一手拿到了、签名空 = 真的没写简介，绝不回落 DOM**。
   *   这条是 v2.5.99 真机踩出来的（`/@168cherry_jp`）：签名空时
   *   `[data-e2e="user-bio"]` 显示的是平台占位话「尚无个人简介。」，
   *   一回落到 DOM 就永远不为空，兜底逻辑再也不会触发，档案里就多出一句平台话术。
   *   与 `tiktok-social.js` 的 `extractPageText()` 保持同一粒度：有数据就别看页面。
   */
  _signature(profile) {
    if (profile) return this._norm(profile.signature || '');
    return this._norm(this._stripPlaceholderBio(
      this._stripMoreTail(this._domText('[data-e2e="user-bio"]'))
    ));
  }

  /** 去掉展开提示尾巴（中文「... 更多」、英文「… more」） */
  _stripMoreTail(s) {
    return String(s || '').replace(/\s*(?:\.{2,}|…)\s*(?:更多|more)\s*$/i, '').trim();
  }

  /**
   * 去掉平台占位话（只有回落 DOM 时才需要，见 `_signature`）
   *
   * 实测中文界面是「尚无个人简介。」；英文界面有「No bio yet.」这类。
   * 宁可简介整格空着，也不把平台话术当用户签名存下来。
   */
  _stripPlaceholderBio(s) {
    const t = String(s || '').trim();
    if (!t) return '';
    // 结尾标点两种都有：中文全角「。」（实测 `尚无个人简介。`）和英文半角「.」
    if (/^(?:尚无个人简介|暂无个人简介|暂无简介|还没有简介|这个人很懒[^。]*|No bio yet|Add a bio)[.。]?$/i.test(t)) {
      return '';
    }
    return t;
  }

  /**
   * 外链（签名下方那个 bio link）
   *
   * ⚠️ 页面的 href 是**跳转壳**：
   *   `https://www.tiktok.com/link/v2?aid=1988&lang=zh-Hans&scene=bio_url&target=tiktok.com%2Fdiscovermore`
   * 真实地址藏在 `target=` 里（URL 编码，**可能本身就不带协议** —— 实测 `tiktok.com/discovermore`）。
   * 所以三步：解 target → 补协议；href 本身就是外链就直接用；都不行再看显示文本。
   *
   * 解不出来就返回空 —— **绝不把壳地址存进档案**。
   */
  _bioLink() {
    let el = null;
    try {
      el = document.querySelector('[data-e2e="user-link"]');
    } catch (e) {
      return '';
    }
    if (!el) return '';

    let href = '';
    try { href = String(el.getAttribute('href') || ''); } catch (e) { href = ''; }

    // ① 跳转壳：解 target=
    const m = href.match(/[?&]target=([^&#]+)/);
    if (m && m[1]) {
      let real = '';
      try { real = decodeURIComponent(m[1]); } catch (e) { real = ''; }
      if (real) return this._withScheme(real);
    }

    // ② 本身就是外链（排除壳路径与站内地址）
    if (/^https?:\/\//i.test(href) &&
        href.indexOf('tiktok.com/link/') === -1 &&
        !/^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@/i.test(href)) {
      return href;
    }

    // ③ 显示文本像域名（`tiktok.com/discovermore`）
    //    只认「至少一个点 + 可选路径」，不要求 TLD 一定两级 —— `mysite.cn/blog` 这种
    //    第一版写成 `(?:\.[a-z0-9-]+)+` 再追加一个 `\.` 就永远匹配不上（少了强制的一段）。
    const txt = this._domText('[data-e2e="user-link"]');
    if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(txt)) {
      return this._withScheme(txt);
    }
    return '';
  }

  /** 补协议（`tiktok.com/discovermore` → `https://tiktok.com/discovermore`） */
  _withScheme(s) {
    const t = String(s || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    return 'https://' + t.replace(/^\/+/, '');
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[TikTokProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
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
  window.TikTokProfileExtractor = TikTokProfileExtractor;
}
