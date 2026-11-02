/**
 * 快手个人主页提取器（v2.7.17）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（kuaishou-social.js / kuaishou-immersive.js）的关系
 * ------------------------------------------------------------
 * **完全独立**。作品页那套认的是 `/short-video/<id>`、`/video/<id>` 和页内播放弹层；
 * 主页是 `/profile/<id>`，两边靠地址分流（见 media-detector 与 kuaishou-spa-handler）。
 *
 * ⚠️ 主页上点开作品弹层时**归作品**（social），由 KuaishouSpaMixin 接管 ——
 *    用户 2026-10-31 拍板「跟抖音一样：弹层优先提作品」。
 *    弹层不换地址（`/profile/<id>` 不变），所以只能靠 `.player-pop` 是否打开来判，
 *    那是 KuaishouImmersiveContext 的活，本类不掺和。
 *
 * 真机勘察（2026-10-31，接管已登录 Edge，`/profile/3xb7355iu5cb6r4` 取样）
 * ------------------------------------------------------------------
 * DOM（快手这里的类名是**语义化的**，跟小红书一样好办）：
 *   h1.user > span.name        昵称（东莞安然无恙）
 *   div.user-info > div.info   快手号 / 性别
 *     └ span.uid               ` 快手号：5405486592 `（后面还挂了个"复制" svg，没有文本）
 *   div.text-count
 *     ├ div.text._qu-ellipsis-multi  简介，**`title` 属性是全文**（页面只显示 3 行）
 *     └ div.count              三项统计：<span> 关注 <span>30</span></span>…
 *
 * 一手数据 `window.INIT_STATE`（**主世界**才有，隔离世界读不到）里有
 * `…profile/user-object…userProfile.profile.user_text` = 完整简介，
 * 但 **DOM 的 title 属性已经是同一份全文**，所以本类根本不需要桥 ——
 * 少一个主世界依赖，少一处风控面。
 *
 * ⚠️ 一级红线：**绝不读 `INIT_STATE` 里 `/rest/v/profile/get` 那一份** ——
 *    实测 `userId = 1226566812`、`userDefineId = 1226566812`，那是**当前登录者自己**，
 *    不是页面主人（3xb7355iu5cb6r4 / 5405486592）。跟小红书 `user.userInfo`、
 *    快手 `/rest/v/profile/get` 是同一个坑的第三次出现。
 *
 * ⚠️ 快手主页**没有 IP 属地**（DOM 和 INIT_STATE 里都搜不到），
 *    所以统计行只有「粉丝 / 获赞」两项 —— 不是我们取漏了，是页面上就没有。
 *
 * 纪律：只读 DOM，不主动打接口、不点任何按钮；遇到验证码 / 滑块由外层守卫停手。
 */

class KuaishouProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'kuaishou_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = '快手';
  }

  /* ======================= 取文本的通用小工具 ======================= */

  /**
   * 取元素文本：压掉行内多余空白（连续空格/制表压成一个），**保留换行**
   *
   * 为什么不能直接 `innerText`：jsdom（离线单测环境）不实现 innerText，返回 undefined。
   * 快手的换行是**裸 `\n` 文本节点**，textContent 已经带着它们，
   * 所以这里只要按行压空白就行 —— 测试和真机走同一条代码路径。
   *
   * 用户 2026-10-31 拍板：连续空格压成一个（那串空格是页面排版用的，不是用户手打的）。
   */
  _text(el) {
    if (!el) return '';
    try {
      return String(el.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\r\u3000]+/g, ' ')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
    } catch (e) {
      return '';
    }
  }

  /** 取第一个命中选择器的元素的文本 */
  _textOf(selector) {
    try {
      const el = document.querySelector(selector);
      return el ? this._text(el) : '';
    } catch (e) {
      return '';
    }
  }

  /** 剥「快手号：」这类前缀（跟抖音/小红书 stripPrefix 同口径） */
  _stripPrefix(text, prefix) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return '';
    const i = s.indexOf(prefix);
    if (i < 0) return '';
    return s.slice(i + prefix.length).replace(/^[\s：:]+/, '').trim();
  }

  /* ======================= 地址判定 ======================= */

  /**
   * 地址栏里的作者 ID（`/profile/<id>`）
   *
   * 不是主页地址一律返回 ''（作品页 `/short-video/xxx` 落到这里会拿到空，
   * 各字段就都留空 —— 宁空不错，绝不能拿作品 ID 当作者 ID）。
   */
  _urlUserId() {
    try {
      const m = String(location.pathname || '')
        .match(/^\/profile\/([A-Za-z0-9_-]+)\/?$/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /* ======================= 6 列取值 ======================= */

  /**
   * 昵称：`h1.user .name`
   *
   * 页面上从来不截断，DOM 就是所见；不做任何兜底（桥那份要等轮询，还多一个依赖）。
   */
  async extractNickname() {
    try {
      return this._textOf('h1.user .name') || this._textOf('.user-info .name');
    } catch (e) {
      console.error('[KuaishouProfileExtractor] 提取昵称失败:', e);
      return '';
    }
  }

  /**
   * 账号ID：地址栏 `/profile/<id>`（如 `3xb7355iu5cb6r4`）
   *
   * **必须与作品页的「作者ID」是同一个字符串**，否则两份数据 join 不上。
   * 所以只从地址栏取，绝不拿快手号（5405486592）顶替 —— 那是另一套编号。
   */
  async extractAccountId() {
    try {
      return this._urlUserId();
    } catch (e) {
      console.error('[KuaishouProfileExtractor] 提取账号ID失败:', e);
      return '';
    }
  }

  /**
   * 账号名：页面上「快手号：xxx」那一段（`span.uid`）
   *
   * 直接读 `.uid` 自己的文本（它只含这一句话），不像抖音那样要在整块文本里正则捞。
   * 注意 `.uid` 里还挂着一个"复制"图标 svg —— 那里面没有文本节点，不会污染。
   */
  async extractAccountName() {
    try {
      return this._stripPrefix(this._textOf('.uid'), '快手号');
    } catch (e) {
      console.error('[KuaishouProfileExtractor] 提取账号名失败:', e);
      return '';
    }
  }

  /**
   * 网址：按作者 ID 重拼的干净主页地址
   *
   * 地址栏上常带 `?source=SEARCH`（从搜索结果点进来的）、`?fid=…` 之类的来源标记，
   * 存进档案没有意义，一律丢掉，只留 `/profile/<id>`。
   * 跟抖音 `/user/<sec_uid>`、小红书 `/user/profile/<id>` 一个口径。
   */
  async extractUrl() {
    try {
      const id = this._urlUserId();
      if (!id) return '';
      return 'https://www.kuaishou.com/profile/' + id;
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名**，合并成一格
   *
   * 用户 2026-10-31 定（与抖音/小红书同口径）：
   *   · 第一行：粉丝 / 获赞，格式 `粉丝：6619 · 获赞：3.2万`
   *   · 第二行起：完整签名（页面只显示 3 行，全文在 `title` 属性里）
   *
   * 数字**照页面原样**（`3.2万` 不反解成 32000）—— 用户 2026-10-30 在抖音那边
   * 已拍板「获赞照原样存」，反解出来的精确值是假精确。
   * （顺带一提：这页的 INIT_STATE 里**根本没有**粉丝数/获赞数，只能读 DOM。）
   */
  async extractBio() {
    try {
      const stats = this._statsLine();
      const sign = this._signature();
      return [stats, sign].filter(Boolean).join('\n');
    } catch (e) {
      console.error('[KuaishouProfileExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /**
   * 统计行：粉丝 / 获赞
   *
   * 两项**取不到就不出现**，不会留下「粉丝：」这种半截（照抖音 formatStats 的规矩）。
   * 快手主页没有 IP 属地，所以这一行比抖音/小红书少一项 —— 不是取漏了。
   */
  _statsLine() {
    const nums = this._countPairs();

    const parts = [];
    if (nums.fans) parts.push('粉丝：' + nums.fans);
    if (nums.likes) parts.push('获赞：' + nums.likes);
    return parts.join(' · ');
  }

  /**
   * `.count` 里三项统计的**页面原样**数字
   *
   * 结构是三个外层 `<span>`，每个里面是「名称」文本节点 + 一个内层 `<span>` 装数字：
   *   `<span> 关注 <span>30</span></span>`
   *   `<span> 粉丝 <span>6619</span></span>`
   *   `<span class="stat-item"> 获赞 <span>3.2万</span></span>`
   * 按**名字**配对（不靠"第几个"），只取「粉丝」和「获赞」
   * （用户 2026-10-30 在小红书已拍板：跟抖音一样不带「关注」）。
   */
  _countPairs() {
    const out = { fans: '', likes: '' };
    try {
      const box = document.querySelector('.count');
      if (!box) return out;
      const items = box.children || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.tagName !== 'SPAN') continue;
        let name = '';
        let value = '';
        const kids = item.childNodes || [];
        for (let j = 0; j < kids.length; j++) {
          const n = kids[j];
          // 3 = 文本节点（名称），1 = 元素节点（内层 span 装数字）
          if (n.nodeType === 3 && !name) name = String(n.textContent || '').trim();
          else if (n.nodeType === 1 && !value) value = String(n.textContent || '').trim();
        }
        if (!name || !value) continue;
        if (name.indexOf('粉丝') > -1) out.fans = value;
        else if (name.indexOf('获赞') > -1) out.likes = value;
      }
    } catch (e) {
      /* 统计取不到就留空，不影响签名 */
    }
    return out;
  }

  /**
   * 签名：`div.text` 的 **`title` 属性优先**（那是全文，页面只渲染 3 行）
   *
   * 为什么不做「点『展开』再读」：点是一次真实行为（埋点 / 可能触发请求），
   * 在风控语境下没有收益；而 title 属性里本来就是完整原文。
   * title 不存在（短简介时组件可能不渲染它）就退回 textContent。
   */
  _signature() {
    try {
      const el = document.querySelector('.text-count .text') ||
        document.querySelector('div.text._qu-ellipsis-multi');
      if (!el) return '';
      const title = String(el.getAttribute && el.getAttribute('title') || '').trim();
      if (title) return this._squeeze(title);
      return this._text(el);
    } catch (e) {
      return '';
    }
  }

  /**
   * 压空格：连续空格/制表压成一个，换行**保留**（用户 2026-10-31 拍板）
   *
   * 快手简介里有一长串空格（页面为了对齐首行），不处理的话导出到 Excel / Notion
   * 会带着一坨空白。只压空格和制表，绝不动 `\n`。
   */
  _squeeze(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t\r\u3000]+/g, ' ')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
      .join('\n');
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[KuaishouProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
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
  window.KuaishouProfileExtractor = KuaishouProfileExtractor;
}
