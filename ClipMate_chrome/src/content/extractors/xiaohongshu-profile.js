/**
 * 小红书个人主页提取器（v2.7.16）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（xiaohongshu-social.js）的关系
 * -----------------------------------
 * **完全独立**。作品页那套是读笔记桥（`#clipmate-xhs-note`）取笔记标题/正文/时间，
 * 主页上那条桥发的是 `note:null`，一条都取不到。两者只共用同一个主世界脚本。
 *
 * 真机勘察（2026-10-30，接管已登录 Edge，`/user/profile/5b5ec841…` 取样）
 * ------------------------------------------------------------------
 * DOM（小红书这里的类名是**语义化的**，不是构建哈希，比抖音好办）：
 *   .user-name              昵称（王弈可）
 *   .user-redId             `小红书号：631287077`
 *   .user-IP                `IP属地：北京`
 *   .user-desc              简介（**换行是裸 \n 文本节点**，不是块级元素）
 *   .user-interactions      三项统计：<span class=count>9591</span><span class=shows>粉丝</span>
 *   .user-tags              标签区：<div class=tag-item>27岁</div>…
 *
 * 一手数据（主世界桥 `#clipmate-xhs-profile`，见 xiaohongshu-page-data.js）：
 *   basicInfo.desc 是**完整的**，页面 `.user-desc` 在长简介时会显示不全（跟抖音签名同病），
 *   所以签名以桥为准、DOM 兜底。
 *
 * ⚠️ 一级红线：**绝不读 `user.userInfo`** —— 那是当前登录者自己（实测昵称「小衫.vava」），
 *    不是页面主人（王弈可）。桥里已经把这条路封死了，这里也不要再开。
 *
 * 纪律：只读 DOM 和页面自带的内存数据，不主动打接口、不点「展开」按钮；
 * 遇到验证码 / 滑块由外层守卫停手。
 */

class XiaohongshuProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'xiaohongshu_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = '小红书';
  }

  /* ======================= 取文本的通用小工具 ======================= */

  /**
   * 取元素文本：压掉行内多余空白，**保留换行**
   *
   * 为什么不能直接 `innerText`：jsdom（离线单测环境）不实现 innerText，返回 undefined。
   * 小红书的换行是**裸 `\n` 文本节点**（不是块级元素），textContent 已经带着它们，
   * 所以这里只要按行压空白就行 —— 测试和真机走同一条代码路径。
   */
  _text(el) {
    if (!el) return '';
    try {
      return String(el.textContent || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t\r]+/g, ' ')
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

  /** 剥「小红书号：」「IP属地：」这类前缀（跟抖音 stripPrefix 同口径） */
  _stripPrefix(text, prefix) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return '';
    const i = s.indexOf(prefix);
    if (i < 0) return '';
    return s.slice(i + prefix.length).replace(/^[\s：:]+/, '').trim();
  }

  /* ======================= 一手数据（主世界桥） ======================= */

  /**
   * 读主页桥 `#clipmate-xhs-profile`
   *
   * **ID 闸口**：桥里的 `urlUserId` 必须等于**当前地址**里的 userId 才认。
   * 小红书是 SPA，从个人主页点开一条笔记后文档不换、地址变成 `/explore/<笔记ID>`，
   * 这时桥上还留着上一个人的数据 —— 没有闸口就会把 A 的简介记到 B 的档案上。
   *
   * @returns {Object|null} 就绪返回档案对象；没桥 / 不是这个人 / 还没加载都返回 null
   */
  _bridgeProfile() {
    try {
      const node = document.getElementById('clipmate-xhs-profile');
      if (!node || !node.textContent) return null;
      const payload = JSON.parse(node.textContent);
      const curId = this._urlUserId();
      if (!curId || !payload || payload.urlUserId !== curId) return null;
      return payload.profile || null;
    } catch (e) {
      return null;
    }
  }

  /** 地址栏里的作者 userId（`/user/profile/<24位十六进制>`） */
  _urlUserId() {
    try {
      const m = String(location.pathname || '')
        .match(/^\/user\/profile\/([0-9a-fA-F]{24})\/?$/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /* ======================= 6 列取值 ======================= */

  /**
   * 昵称：`.user-name`
   *
   * 桥里的 `basicInfo.nickname` 是同一份值，但它要等 250ms 轮询，
   * 且昵称页面上从来不截断 —— DOM 更快也更贴近所见，桥只作兜底。
   */
  async extractNickname() {
    try {
      const fromDom = this._textOf('.user-name');
      if (fromDom) return fromDom;
      const p = this._bridgeProfile();
      return p && p.nickname ? p.nickname : '';
    } catch (e) {
      console.error('[XiaohongshuProfileExtractor] 提取昵称失败:', e);
      return '';
    }
  }

  /**
   * 账号ID：地址栏 `/user/profile/<24位>`
   *
   * **必须与作品页的「作者ID」是同一个字符串**（小红书就是 userId），
   * 否则两份数据 join 不上。所以只从地址栏取，绝不拿小红书号顶替。
   */
  async extractAccountId() {
    try {
      return this._urlUserId();
    } catch (e) {
      console.error('[XiaohongshuProfileExtractor] 提取账号ID失败:', e);
      return '';
    }
  }

  /**
   * 账号名：页面上「小红书号：xxx」那一段
   *
   * 直接读 `.user-redId` 这个 span 自己的文本（它只含这一句话），
   * 不像抖音那样要在整块文本里正则捞 —— 小红书的类名是语义化的，稳得多。
   */
  async extractAccountName() {
    try {
      const fromDom = this._stripPrefix(this._textOf('.user-redId'), '小红书号');
      if (fromDom) return fromDom;
      const p = this._bridgeProfile();
      return p && p.redId ? p.redId : '';
    } catch (e) {
      console.error('[XiaohongshuProfileExtractor] 提取账号名失败:', e);
      return '';
    }
  }

  /**
   * 网址：规范主页地址，**不带 xsec_token**
   *
   * 地址栏上那串 `?xsec_token=…&xsec_source=…` 是临时访问令牌（隔一会儿就失效，
   * 不带 token 直访会 404），存进档案没有任何意义，所以按 userId 重新拼一份干净的。
   * 跟抖音 `/user/<sec_uid>` 一个口径。
   */
  async extractUrl() {
    try {
      const id = this._urlUserId();
      if (!id) return '';
      return 'https://www.xiaohongshu.com/user/profile/' + id;
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：**统计行 + 签名 + 标签区**，合并成一格
   *
   * 用户 2026-10-30 定（与抖音同口径）：
   *   · 第一行：粉丝 / 获赞 / IP属地，格式 `粉丝：9591 · 获赞：11.3万 · IP属地：北京`
   *   · 第二行起：完整签名（页面显示不全时以桥里的全文为准）
   *   · 末尾：标签区（27岁 / 河北张家口 / 运动博主 / 北京理工大学），空格连接
   *
   * 数字**照页面原样**（`11.3万` 不反解成 113123）—— 用户 2026-10-30 在抖音那边
   * 已拍板「获赞照原样存」，反解出来的精确值是假精确。所以数字走 DOM，
   * 不用桥里 interactions 的精确 count。
   */
  async extractBio() {
    try {
      const stats = this._statsLine();
      const sign = this._signature();
      const tags = this._tagsLine();
      return [stats, sign, tags].filter(Boolean).join('\n');
    } catch (e) {
      console.error('[XiaohongshuProfileExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /**
   * 统计行：粉丝 / 获赞 / IP属地
   *
   * 三项**取不到就不出现**，不会留下「粉丝：」这种半截（照抖音 formatStats 的规矩）。
   * 数字读 `.user-interactions` 里的 `count`/`shows` 配对 —— 那才是页面原样。
   */
  _statsLine() {
    const nums = this._interactionCounts();

    let ip = this._stripPrefix(this._textOf('.user-IP'), 'IP属地');
    if (!ip) {
      const p = this._bridgeProfile();
      if (p && p.ipLocation) ip = p.ipLocation;
    }

    const parts = [];
    if (nums.fans) parts.push('粉丝：' + nums.fans);
    if (nums.likes) parts.push('获赞：' + nums.likes);
    if (ip) parts.push('IP属地：' + ip);
    return parts.join(' · ');
  }

  /**
   * 三项统计的**页面原样**数字
   *
   * `.user-interactions` 的结构是三对 `<span class=count>` + `<span class=shows>`，
   * 按外层 div 逐个配对（不靠"第几个"，靠"名字叫什么"）：
   *   关注 / 粉丝 / 获赞与收藏
   * 只要「粉丝」和「获赞」两项（用户 2026-10-30 拍板：跟抖音一样三项，不带「关注」）。
   */
  _interactionCounts() {
    const out = { fans: '', likes: '' };
    try {
      const box = document.querySelector('.user-interactions');
      if (!box) return out;
      const kids = box.children || [];
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i].querySelector && kids[i].querySelector('.count');
        const s = kids[i].querySelector && kids[i].querySelector('.shows');
        if (!c || !s) continue;
        const name = this._text(s);
        const value = this._text(c);
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
   * 签名：桥里的全文优先（页面长简介会显示不全），DOM 兜底
   *
   * 为什么不做「点『展开』再读」：点是一次真实行为（埋点 / 可能触发请求），
   * 在风控语境下没有收益；而且点开的只是渲染态，桥里那份才是数据源。
   */
  _signature() {
    const p = this._bridgeProfile();
    if (p && p.desc) return p.desc;
    return this._textOf('.user-desc');
  }

  /**
   * 标签区（27岁 / 河北张家口 / 运动博主 / 北京理工大学），空格连接
   *
   * 页面上每个标签是独立的 chip，用空格连最贴近所见。
   */
  _tagsLine() {
    try {
      const box = document.querySelector('.user-tags');
      const names = [];
      if (box) {
        const items = box.querySelectorAll('.tag-item');
        for (let i = 0; i < items.length; i++) {
          const t = this._text(items[i]);
          if (t) names.push(t);
        }
      }
      if (names.length) return names.join(' ');
    } catch (e) {
      /* 落到桥兜底 */
    }
    const p = this._bridgeProfile();
    return (p && p.tags && p.tags.length) ? p.tags.join(' ') : '';
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[XiaohongshuProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
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
  window.XiaohongshuProfileExtractor = XiaohongshuProfileExtractor;
}
