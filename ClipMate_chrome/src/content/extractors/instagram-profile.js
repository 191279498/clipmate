/**
 * Instagram 个人主页提取器（v2.7.20）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（instagram-social.js）的关系
 * ------------------------------------
 * **完全独立**。作品页认的是 `/p|reel|reels|tv/<code>/` 和弹层；主页是 `/<username>/`，
 * 两边靠地址分流（见 media-detector 的多规则与 extractor-factory 的 URL 规则表）。
 * 主页上点开帖子 → 弹层（地址变成 `/p/<code>/`）→ 归作品，由 IgSpaMixin 管。
 *
 * 真机勘察（2026-10-31，接管已登录 Edge，取样 `uni_mitsubishi_pencil` /
 * `cartierawards` / `zengsong9` 三个号，其中两个是 SPA 站内跳转）
 * ------------------------------------------------------------------
 * 数据来源三档，按可信度排：
 *
 *   ① **主世界桥节点**（`InstagramInlineData.findProfile`）
 *      页面自己发的 `POST /api/graphql` 响应，`data.user` 里一次给全：
 *      pk / full_name / biography（全文）/ external_url / follower_count /
 *      following_count / media_count / is_private / is_verified。
 *      —— 简介全文**只有这里拿得到**。
 *
 *   ② `<meta name="description">`（首次加载的 SSR）
 *      形如 `167K 位粉丝、已关注 266 人、 1,317 篇帖子 - Instagram 用户 昵称 (@username)：
 *      “简介全文”`。含全文和换行，但 **SPA 站内跳转后不更新** —— 见下面的红线。
 *
 *   ③ DOM（`header` 里）
 *      昵称、统计数字（`5.5万粉丝` / `1079帖子`）、**截断的**简介。
 *
 * ⚠️ 红线一：**meta 必须校验用户名**。
 *   实测从 `uni_mitsubishi_pencil` 跳到 `zengsong9` 再跳到 `cartierawards`，
 *   DOM 早就换人，`meta[name=description]` 一直停在最开始那个号上。
 *   不做校验就会把别人的简介记到当前账号 —— 这是本项目最不能犯的错。
 *   校验方式：meta 里 `(@username)` 的 username 必须等于地址栏的 username。
 *
 * ⚠️ 红线二：**绝不碰 `PolarisViewer`**。
 *   页面 `<script>` 数据块里的 `PolarisViewer` 是**当前登录者自己**
 *   （实测 `Shan San0421` / `id: 1396136356`），不是页面主人。
 *   抖音、小红书 `user.userInfo`、快手 `/rest/v/profile/get` 都栽在这上面，这是第四次。
 *   本类只读桥节点（按用户名索引）、meta（校验过用户名）、DOM（当前页面的）。
 *
 * ⚠️ 红线三：**数字照页面原样**（用户 2026-10-31 拍板，与抖音/小红书/快手同口径）。
 *   页面写 `5.5万` 就存 `5.5万`，不许反解成 55468 或自己换算缩写 —— 那是假精确。
 *   接口的精确值只在 DOM 读不到时兜底（并原样存数字，不做缩写）。
 *
 * 纪律：只读，**不点「更多」按钮**（那是改页面状态）、不主动打接口、不批量导航。
 */

class InstagramProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'instagram_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = 'Instagram';
  }

  /* ======================= 通用小工具 ======================= */

  /** 压空白但保留换行（jsdom 没有 innerText，统一走 textContent） */
  _norm(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\u3000]+/g, ' ')
      .split('\n')
      .map((x) => x.trim())
      .filter((x) => x !== '')
      .join('\n');
  }

  /** 地址栏里的主页用户名（抠不到返回空串） */
  _urlUsername() {
    try {
      const name = (typeof InstagramInlineData !== 'undefined' && InstagramInlineData.normalizeUsername)
        ? InstagramInlineData.normalizeUsername(window.location.href)
        : '';
      if (name) return name;
    } catch (e) { /* 落到下面的本地实现 */ }
    try {
      const seg = String(location.pathname || '/').split('/').filter(Boolean);
      if (seg.length === 1 && /^[A-Za-z0-9_.]{5,30}$/.test(seg[0])) return seg[0];
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /** 桥节点里的主页资料（拿不到返回 null，调用方自己兜底） */
  _bridge(username) {
    try {
      if (typeof InstagramInlineData === 'undefined') return null;
      if (!InstagramInlineData.findProfile) return null;
      return InstagramInlineData.findProfile(username || this._urlUsername());
    } catch (e) {
      return null;
    }
  }

  /** header 元素（IG 主页的资料区就是它） */
  _header() {
    try {
      return document.querySelector('header');
    } catch (e) {
      return null;
    }
  }

  /** header 里所有「叶子 span」的文本（按文档顺序） */
  _leafSpans() {
    const h = this._header();
    if (!h || !h.querySelectorAll) return [];
    const out = [];
    const spans = h.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.children && el.children.length) continue;   // 只要叶子，避免父级重复命中
      const t = String(el.textContent || '').trim();
      if (t) out.push(t);
    }
    return out;
  }

  /* ======================= 6 列取值 ======================= */

  /**
   * 昵称（`full_name`）
   *
   * 一手：桥节点的 `fullName`（不截断、不掺 DOM 排版）。
   * 兜底：header 里「跟在用户名后面、不像统计标签」的那一段 —— 实测结构就是
   * `span 用户名` → `span 昵称`，中间没有别的文本。
   */
  async extractNickname() {
    try {
      const username = this._urlUsername();
      const bridge = this._bridge(username);
      if (bridge && bridge.fullName) return bridge.fullName;

      // DOM 兜底
      const leaves = this._leafSpans();
      let seenSelf = false;
      for (let i = 0; i < leaves.length; i++) {
        const t = leaves[i];
        if (!seenSelf) {
          if (username && t === username) seenSelf = true;
          continue;
        }
        if (/^(粉丝|帖子|关注|followers?|posts?|following)$/i.test(t)) continue;
        if (/^[\d.,]+\s*[万亿KMB]?$/.test(t)) continue;
        if (t.length > 80) continue;
        return t;
      }
      return '';
    } catch (e) {
      console.error('[InstagramProfileExtractor] 提取昵称失败:', e);
      return '';
    }
  }

  /**
   * 账号ID：**内部数字 ID**（`pk`，如 `582782014`）
   *
   * 用户 2026-10-31 拍板：跟快手一个口径 —— 账号ID 放内部 ID，账号名放给人看的号。
   * 这个值只有接口给，DOM/meta 都没有，拿不到就留空（**绝不**拿 username 顶替，
   * 否则「账号ID」这一列在两个来源之间会变成两种东西）。
   */
  async extractAccountId() {
    try {
      const bridge = this._bridge(this._urlUsername());
      return (bridge && bridge.pk) ? bridge.pk : '';
    } catch (e) {
      console.error('[InstagramProfileExtractor] 提取账号ID失败:', e);
      return '';
    }
  }

  /**
   * 账号名：`username`（地址栏那一段，如 `cartierawards`）
   *
   * 必须与作品页的「作者ID」是同一个字符串，两份数据才 join 得上
   * （作品页 `extractAuthorName` 取的就是用户名）。
   */
  async extractAccountName() {
    try {
      return this._urlUsername();
    } catch (e) {
      console.error('[InstagramProfileExtractor] 提取账号名失败:', e);
      return '';
    }
  }

  /**
   * 网址：按用户名重拼的干净主页地址
   *
   * 地址栏常带 `?hl=zh-cn`、`?igsh=…` 这类来源/语言标记，存进档案没有意义，
   * 一律丢掉，只留 `/<username>/`。跟抖音 `/user/<sec_uid>`、
   * 小红书 `/user/profile/<id>`、快手 `/profile/<id>` 一个口径。
   */
  async extractUrl() {
    try {
      const username = this._urlUsername();
      if (!username) return '';
      return 'https://www.instagram.com/' + username + '/';
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名 + 外链**，合并成一格
   *
   * 用户 2026-10-31 定：
   *   · 第一行：`粉丝：5.5万 · 帖子：1079`（不带「关注」，跟抖音/小红书/快手一致）
   *   · 第二行起：完整签名（换行保留）
   *   · 最后：外链（主页上那个官网链接，原始 URL 不是 `l.instagram.com` 跳转壳）
   *
   * 签名来源按可信度：桥节点（接口全文）→ meta（校验用户名）→ DOM（截断版去尾巴）。
   */
  async extractBio() {
    try {
      const username = this._urlUsername();
      const bridge = this._bridge(username);
      const stats = this._statsLine(bridge);
      const sign = this._signature(username, bridge, bridge ? bridge.fullName : '');
      const link = this._externalUrl(bridge);
      return [stats, sign, link].filter(Boolean).join('\n');
    } catch (e) {
      console.error('[InstagramProfileExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /* ======================= 简介的三个零件 ======================= */

  /**
   * 统计行：粉丝 / 帖子
   *
   * 数字**照页面原样**（`5.5万` 不反解），所以优先读 DOM；
   * DOM 读不到才用接口的精确值（原样存整数，不做缩写换算）。
   *
   * DOM 结构（真机两种都见过，两条路都要走）：
   *   ① `<span>粉丝</span>` + `<span>5.5万</span>` —— 标签自己是一个 span（按标签配对）
   *   ② `<span>5.5万</span>粉丝` —— 标签是**纯文字节点**（v2.7.21 补的逐行配对）
   * 顺序不一定，所以既不假设「数字在前」，也不假设「标签是独立元素」。
   */
  _statsLine(bridge) {
    const fans = this._statFromDom(/(粉丝|followers?)$/i) ||
                 (bridge && typeof bridge.followerCount === 'number' ? String(bridge.followerCount) : '');
    const posts = this._statFromDom(/(帖子|posts?)$/i) ||
                 (bridge && typeof bridge.mediaCount === 'number' ? String(bridge.mediaCount) : '');

    const parts = [];
    if (fans) parts.push('粉丝：' + fans);
    if (posts) parts.push('帖子：' + posts);
    return parts.join(' · ');
  }

  /**
   * 从 DOM 里取某一项统计的数字部分（取不到返回空串）
   * @param {RegExp} labelRe 匹配「标签」本身，如 /粉丝$/
   */
  _statFromDom(labelRe) {
    const h = this._header();
    if (!h || !h.querySelectorAll) return '';
    const spans = h.querySelectorAll('span');

    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.children && el.children.length) continue;
      const label = String(el.textContent || '').trim();
      if (!label || label.length > 12) continue;
      if (!labelRe.test(label)) continue;

      // 用**这一个标签自己的文字**构造配对正则，而不是通用「数字+任意标签」——
      // 后者在「三项统计挤在同一个容器」时会错配（取粉丝却拿到帖子数）。
      // 两种顺序都要认：`1079帖子`（实测 innerText 形态）和 `帖子 1079`（反序/英文界面）。
      const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const num = '([\\d.,]+\\s*[万亿KMB]?)';
      const before = new RegExp(num + '[\\s\\u00a0]*' + esc);
      const after = new RegExp(esc + '[\\s\\u00a0]*' + num, 'i');

      // 标签往上找最多 3 层，取第一个能配对成功的容器
      let p = el.parentElement;
      for (let k = 0; k < 3 && p; k++) {
        const txt = this._norm(p.textContent).replace(/\n/g, ' ');
        const m = txt.match(before) || txt.match(after);
        if (m && m[1]) return m[1].replace(/\s+/g, '');
        p = p.parentElement;
      }
    }

    // ② 真机形态（v2.7.21）：标签是**纯文字节点**，不是独立 span。
    //    实测 cartierawards / cartier 两个号都是 `<span>1661万</span>粉丝` ——
    //    span 里只有数字、没有标签，上面那圈一个都匹配不上，
    //    于是每次都被下面的「接口精确值兜底」接走（页面 `5.5万` 被存成 `55468`）。
    //    所以再按 innerText 逐行认一遍：一行就是「数字 + 标签」，英文界面还可能反过来。
    return this._statFromLines(labelRe);
  }

  /**
   * 按 header 的 innerText 逐行认统计数字（v2.7.21）
   *
   * 为什么用 innerText 而不是 textContent：innerText 会按**渲染后的可见行**返回，
   * 把「数字 span + 标签文字节点」合成一行（`1661万粉丝`）；
   * textContent 不带任何分隔符，三项统计会粘成一串，没法逐行配对。
   *
   * 只认「整行恰好是 数字+标签 / 标签+数字」的行，别的行（签名、分类标签、
   * 「粉丝包括xxx、yyy +12人」这种）一律不碰 —— 宁可返回空走接口兜底，也不乱认。
   *
   * @param {RegExp} labelRe 匹配「标签」本身，如 /粉丝$/
   */
  _statFromLines(labelRe) {
    const h = this._header();
    if (!h) return '';
    const text = (typeof h.innerText === 'string' && h.innerText) ? h.innerText : '';
    if (!text) return '';

    const LABEL_WORDS = /^(粉丝|帖子|关注|followers?|posts?|following)$/i;
    const NUM = '([\\d.,]+\\s*[万亿KMB]?)';
    const numFirst = new RegExp('^' + NUM + '\\s*([^\\d\\s][^\\n]*)$');
    const labelFirst = new RegExp('^([^\\d\\s][^\\n]*?)\\s*' + NUM + '$');

    const lines = text.split(/\n+/);
    for (let i = 0; i < lines.length; i++) {
      const line = this._norm(lines[i]).trim();
      if (!line || line.length > 24) continue;

      let m = line.match(numFirst);
      if (m && LABEL_WORDS.test(m[2].trim()) && labelRe.test(m[2].trim())) {
        return m[1].replace(/\s+/g, '');
      }
      m = line.match(labelFirst);
      if (m && LABEL_WORDS.test(m[1].trim()) && labelRe.test(m[1].trim())) {
        return m[2].replace(/\s+/g, '');
      }
    }
    return '';
  }

  /**
   * 签名全文
   *
   * 三档，按可信度：
   *   ① 桥节点 `bio`（接口全文，换行保留）
   *   ② meta description（**必须校验用户名**，见文件头红线一）
   *   ③ DOM 的 bio span（**服务端截断**，要把尾巴 `... 更多` / `… more` 剪掉，
   *      否则会把省略号当成签名的一部分存进去）
   */
  _signature(username, bridge, nickname) {
    if (bridge && typeof bridge.bio === 'string' && bridge.bio) {
      return this._norm(bridge.bio);
    }
    const fromMeta = this._bioFromMeta(username);
    if (fromMeta) return fromMeta;
    return this._bioFromDom(nickname);
  }

  /**
   * 从 `<meta name="description">` 里取简介全文
   *
   * 格式（中文界面实测）：
   *   `167K 位粉丝、已关注 266 人、 1,317 篇帖子 - Instagram 用户 昵称 (@username)：“简介”`
   * 英文界面类似，只是包裹文字不同。
   *
   * **不靠任何界面语言的关键词**，只用 `(@username)` 当锚：
   *   · 锚之前必须有 `@username` —— 没有就说明这份 meta 不是这个号的（SPA 跳转后的旧值），
   *     直接判不可信；
   *   · 锚之后第一个 `：` 或 `:` 之后的整段就是简介，外层还会包一层引号（`“”` / `""`）。
   *
   * @returns {string} 取不到或校验不过返回空串
   */
  _bioFromMeta(username) {
    if (!username) return '';
    let desc = '';
    try {
      const el = document.querySelector('meta[name="description"]');
      desc = el ? String(el.getAttribute('content') || '') : '';
    } catch (e) {
      return '';
    }
    if (!desc) return '';

    const at = desc.indexOf('(@' + username + ')');
    if (at === -1) return '';                       // 红线一：不是这个号的 meta，一律不用

    let rest = desc.slice(at + ('(@' + username + ')').length);
    // 去掉紧跟的分隔符（中文全角冒号 / 英文冒号）
    rest = rest.replace(/^\s*[：:]\s*/, '');
    // 去掉外层引号（“ ” " " 『 』）
    rest = rest.replace(/^[“"『「]/, '').replace(/[”"』」]$/, '');
    rest = this._norm(rest);
    if (!rest) return '';
    // meta 的长度上限比签名本身宽，超长截断也走 truncateRichText 那套更稳妥，
    // 这里只做防御性上限（IG 简介硬上限 150 字符，5000 足够）。
    return rest.length > 5000 ? rest.slice(0, 5000) : rest;
  }

  /** DOM 里的 bio（截断版）：剪掉「... 更多」尾巴 */
  _bioFromDom(nickname) {
    const h = this._header();
    if (!h || !h.querySelectorAll) return '';
    const skip = String(nickname || '').trim();
    const spans = h.querySelectorAll('span');

    // 第一优先：IG 给正文段落的那个老式语义类（实测 `_ap3a _aaco _aacu _aacx _aad7 _aade`）。
    // 类名虽然是构建产物，但 `_ap3a` 这一支从 2023 年到现在没变过；
    // 命不中就退到下面的长度启发式。
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.children && el.children.length) continue;
      const cls = String(el.className || '');
      if (cls.indexOf('_ap3a') === -1) continue;
      const raw = String(el.textContent || '').trim();
      if (!raw || raw.length < 2) continue;
      if (skip && raw === skip) continue;
      return this._norm(this._stripMoreTail(raw));
    }

    // 第二优先：长度启发式（≥12 字、不是昵称/用户名/统计标签）
    const username = this._urlUsername();
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      if (el.children && el.children.length) continue;
      const raw = String(el.textContent || '').trim();
      if (raw.length < 12) continue;
      if (skip && raw === skip) continue;
      if (username && raw === username) continue;
      if (/^(粉丝|帖子|关注|followers?|posts?|following)$/i.test(raw)) continue;
      if (/^[\d.,]+\s*[万亿KMB]?$/.test(raw)) continue;
      return this._norm(this._stripMoreTail(raw));
    }
    return '';
  }

  /** 去掉 IG 的展开提示尾巴（中文「... 更多」、英文「… more」） */
  _stripMoreTail(s) {
    return String(s || '').replace(/\s*(?:\.{2,}|…)\s*(?:更多|more)\s*$/i, '').trim();
  }

  /**
   * 外链（主页签名下方那个链接）
   *
   * 优先接口的 `external_url`（干净原始地址，如 `http://bit.ly/m/CartierWomensInitiative`）；
   * 接口没有时才读 DOM 的 `a[href*="l.instagram.com"]` —— 那是**跳转壳**，
   * 真实地址藏在 `?u=` 参数里（URL 编码），必须解出来，不能把壳存进档案。
   */
  _externalUrl(bridge) {
    if (bridge && bridge.externalUrl) return bridge.externalUrl;
    try {
      const h = this._header();
      if (!h || !h.querySelectorAll) return '';
      const links = h.querySelectorAll('a[href*="l.instagram.com"]');
      for (let i = 0; i < links.length; i++) {
        const href = String(links[i].getAttribute('href') || '');
        const m = href.match(/[?&]u=([^&]+)/);
        if (!m) continue;
        try {
          const real = decodeURIComponent(m[1]);
          if (/^https?:\/\//i.test(real)) return real;
        } catch (e) { /* 解不出来就跳过，绝不存壳地址 */ }
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[InstagramProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
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
  window.InstagramProfileExtractor = InstagramProfileExtractor;
}
