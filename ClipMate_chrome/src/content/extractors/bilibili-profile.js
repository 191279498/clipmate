/**
 * B站（哔哩哔哩）个人空间提取器（v2.7.28）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（bilibili-social.js）的关系
 * ------------------------------------
 * **完全独立**。作品页认的是 `www.bilibili.com/video/<BV|av>` 与 `/bangumi/play/`；
 * 空间页认的是 `space.bilibili.com/<数字mid>`（**另一个域名**，原先根本没注入扩展，
 * v2.7.28 才新增）。两边靠域名 + 路径分流，不存在「同一地址两种判法」。
 *
 * 为什么这一版最简单：**零请求**
 * ------------------------------------
 * 真机勘察（2026-10-31，接管用户 Edge，`space.bilibili.com/946974` 影视飓风）结论：
 *   · 页面**没有任何数据接口**（network 里只有图片与埋点），UP 主信息全部由服务端
 *     直出到 HTML 里 → **不许 fetch、不许钩 XHR**，纯读 DOM 就是唯一正确解；
 *     也拿不到「外链 / 邮箱 / 注册时间」——页面上本来就不显示，不去编。
 *   · `__INITIAL_STATE__` 在新版空间页已下线（`typeof` 是 undefined），**别指望它**；
 *     而它是页面主世界全局，扩展隔离世界本来就读不到。
 *
 * 「页面原样」铁律（本项目踩过 5 次的坑，这次同样存在）
 * ------------------------------------------------------
 * 统计数字的 DOM 文本是 `1887.7万`，但同一元素的 `title` 属性里躺着精确值
 * `18,877,239`。**必须取 innerText，不能取 title**，否则数字格式跟页面不一致。
 *
 * 重名陷阱
 * --------
 * `.pure-text` 全页有 2 个：第 1 个是个人签名（`div.sign.header-sign` 里），
 * 第 2 个是 UP 主公告（`div.ann-section__content` 里）。必须限定在 `.sign` 里取，
 * 否则会把「公告」当成「签名」存进去。
 */

class BilibiliProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'bilibili_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个；
    // 与 social-site-names.js 里 bilibili_social 的站名保持一致）
    this.platformName = '哔哩哔哩';
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

  /**
   * 地址栏里的空间 mid（`space.bilibili.com/<digits>`，可带 `/dynamic` 等子页后缀）。
   * B站没有 @handle，**mid 就是账号 ID**。
   */
  _urlMid() {
    try {
      const p = String(window.location.pathname || '');
      const m = p.match(/^\/(\d{1,15})(?:\/|$)/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /* ======================= 六个字段 ======================= */

  /** 平台列（PersonFieldsBuilder 优先调方法，读不到才看 platformName） */
  async extractPlatform() {
    return '哔哩哔哩';
  }

  /** 昵称：`div.nickname`（全页唯一，实测 count=1） */
  async extractName() {
    try {
      // 限定在 `.upinfo` 头部区域内取；光用 `.nickname` 虽然现在唯一，
      // 但将来页面加了猜你喜欢的 UP 主卡片就会撞车（微博 `_name_` 踩过同款坑）
      const t = this._textOf('.upinfo .nickname') || this._textOf('.nickname');
      return t.replace(/\s*认证\s*$/, '').trim();
    } catch (err) {
      console.error('[BilibiliProfileExtractor] 提取昵称失败:', err);
      return '';
    }
  }

  /** 账号ID：地址栏的 mid。拿不到就留空，**绝不拿昵称或域名顶替** */
  async extractAccountId() {
    try {
      return this._urlMid();
    } catch (err) {
      console.error('[BilibiliProfileExtractor] 提取账号ID失败:', err);
      return '';
    }
  }

  /** 账号名：B站没有独立于昵称的 handle，用户 2026-10-31 拍板填昵称 */
  async extractAccountName() {
    try {
      return await this.extractName();
    } catch (err) {
      console.error('[BilibiliProfileExtractor] 提取账号名失败:', err);
      return '';
    }
  }

  /** 网址：`https://space.bilibili.com/<mid>`（官方形态，从任何子页进来都同一串） */
  async extractUrl() {
    try {
      const mid = this._urlMid();
      return mid ? 'https://space.bilibili.com/' + mid : '';
    } catch (err) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 个人签名**
   *
   * 用户 2026-10-31 定（B站这版只要这两段，认证/性别/会员都不进）：
   *   第一行：`粉丝：1887.7万 · 关注：687`（页面原样，不换算成精确值）
   *   正文：`.sign.header-sign .pure-text` 的签名（空则退它的 title 属性）
   */
  async extractBio() {
    try {
      const lines = [];
      const stats = this._statsLine();
      if (stats) lines.push(stats);
      const sign = this._signature();
      if (sign) lines.push(sign);
      return lines.join('\n');
    } catch (err) {
      console.error('[BilibiliProfileExtractor] 提取简介失败:', err);
      return '';
    }
  }

  /* ======================= 简介的零件 ======================= */

  /** 统计行：`粉丝：1887.7万 · 关注：687`（只有两个数都拿不到时才整体不出现） */
  _statsLine() {
    const parts = [];
    const fans = this._statByLabel('粉丝');
    if (fans) parts.push('粉丝：' + fans);
    const follow = this._statByLabel('关注');
    if (follow) parts.push('关注：' + follow);
    return parts.join(' · ');
  }

  /**
   * 页头统计：按**标签文本**配对取数字（页面原样）。
   * `.nav-statistics__item` 结构固定：
   *   `<span class="nav-statistics__item-text">粉丝数</span><span class="nav-statistics__item-num">1887.7万</span>`
   * 按位置取也行（第 1 项关注、第 2 项粉丝），但按文本配对更抗布局调整。
   *
   * ⚠️ 绝不读 `.nav-statistics__item-num` 的 title 属性——那里是精确值 18,877,239，
   *    跟页面显示的 `1887.7万` 不是一回事。
   */
  _statByLabel(keyword) {
    try {
      const items = document.querySelectorAll('.nav-statistics__item');
      for (let i = 0; i < items.length; i++) {
        const label = this._text(items[i].querySelector('.nav-statistics__item-text'));
        if (label.indexOf(keyword) === -1) continue;
        return this._text(items[i].querySelector('.nav-statistics__item-num'));
      }
    } catch (e) { /* 没有就算了 */ }
    return '';
  }

  /** 个人签名：限定在 `.sign` 里（另一个 `.pure-text` 是公告，不能串） */
  _signature() {
    try {
      const el = document.querySelector('.upinfo .sign .pure-text') ||
                 document.querySelector('.sign.header-sign .pure-text');
      if (!el) return '';
      const t = this._text(el);
      if (t) return t;
      // innerText 被 CSS 截成空时退回 title（服务端把全文也放进了 title）
      return this._norm(el.getAttribute('title'));
    } catch (e) {
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
      console.error('[BilibiliProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'account' });
  }

  async extractSpecificFields() {
    return {};
  }
}

window.BilibiliProfileExtractor = BilibiliProfileExtractor;
