/**
 * 抖音作者个人主页提取器（v2.7.14）
 *
 * 归属：人物档案大类 → 社交账号形态（personKind = 'account'），6 列：
 *   平台、昵称、账号ID、账号名、网址、简介
 *
 * 与作品页（douyin-social.js）的关系
 * ---------------------------------
 * **完全独立**。作品页那套 `extractAuthorName()` 走 JSON-LD 面包屑 / meta description
 * 的「XX发布了视频」，作者主页上这些一个都不成立，直接复用只会拿到空值或错值。
 * 唯一必须保持一致的只有昵称清洗规则 `_cleanNickname()` —— 同一个作者在作品页和
 * 人物档案里必须显示成同一个字符串。
 *
 * 真机勘察（2026-10-30，用户已登录 Edge，`/user/self` 取样）
 * --------------------------------------------------------
 *   [data-e2e="user-detail"]        整个资料区容器（稳定锚点，e2e 属性是测试属性）
 *   h1                             昵称（内部是 span）
 *   SPAN.enTGrzPh                  文本 `抖音号：61339369848`（**类名是构建哈希，绝不能依赖**）
 *   [data-e2e="user-info"]          资料区（含 `抖音号：` 与 `IP属地：` 两个文本行）
 *   [data-e2e="user-info-fans"]     粉丝数 → 并入「简介」
 *   [data-e2e="user-info-like"]     获赞数 → 并入「简介」
 *
 * 所以取值的锚点只用两种：`data-e2e` 属性，和**文本形态**（`抖音号：` / `IP属地：` 前缀）。
 * 类名一律不碰 —— 它们每次构建都会变。
 *
 * 签名的完整正文不在 DOM 里（页面只渲染前几十字 + 「更多」），
 * 从内联 `<script>` 的 SSR 数据读，见 `douyin-profile-ssr.js`。
 *
 * 纪律：只读 DOM，不主动打 `/rest/` 接口；遇到验证码 / 滑块 / result:2 由外层守卫负责停手。
 */

class DouyinProfileExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douyin_profile';
    // 「平台」列的取值（PersonFieldsBuilder 在没实现 extractPlatform 时读这个）
    this.platformName = '抖音';
  }

  /** 资料区容器；认不出来返回 null（调用方一律当成"取不到"） */
  _profileBox() {
    try {
      return document.querySelector('[data-e2e="user-detail"]');
    } catch (e) {
      return null;
    }
  }

  /**
   * 取文本，压掉多余空白，**并保留块级元素之间的换行**
   *
   * 为什么不直接用 `el.innerText`：jsdom（离线单测环境）不实现 innerText，
   * 结果会是 undefined；退到 textContent 又会把整块文本连成一片，
   * 「抖音号之后第一行是签名」这类按行解析的逻辑在测试里就永远跑不通。
   * 这里统一走一次 DOM 树遍历，**测试和真机走同一条代码路径**，行为可预测。
   */
  _text(el) {
    if (!el) return '';
    try {
      const BLOCK = /^(DIV|P|LI|UL|OL|H1|H2|H3|H4|H5|H6|SECTION|ARTICLE|HEADER|FOOTER|TR|TBODY|TABLE|BR)$/;
      const out = [];
      const walk = (node) => {
        if (!node) return;
        if (node.nodeType === 3) { // 文本节点
          out.push(node.nodeValue || '');
          return;
        }
        if (node.nodeType !== 1) return;
        const isBlock = BLOCK.test(node.tagName || '');
        if (isBlock) out.push('\n');
        const kids = node.childNodes || [];
        for (let i = 0; i < kids.length; i++) walk(kids[i]);
        if (isBlock) out.push('\n');
      };
      walk(el);

      return out.join('')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');
    } catch (e) {
      return '';
    }
  }

  /**
   * 昵称清洗 —— **必须与 `douyin-social.js` 的 `_cleanNickname` 逐字同款**
   *
   * 两边规则一旦漂移，同一个作者在作品记录里叫「东东来了」、在人物档案里叫
   * 「东东来了企业认证」，等于自己造了两份对不上的数据。
   * 改这里必须同步改 douyin-social.js（那边有对拍用例）。
   */
  _cleanNickname(raw) {
    let name = typeof raw === 'string' ? raw : (raw ? String(raw) : '');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return '';
    name = name.replace(/^@+/, '').trim();
    name = name.replace(/(认证徽章|企业认证|官方认证|个人认证|机构认证|蓝V认证)$/u, '').trim();
    return name;
  }

  /* ======================= 6 列取值 ======================= */

  /** 昵称：h1（主页唯一的大标题） */
  async extractNickname() {
    try {
      const box = this._profileBox();
      const h1 = (box && box.querySelector('h1')) || document.querySelector('h1');
      return this._cleanNickname(this._text(h1));
    } catch (e) {
      console.error('[DouyinProfileExtractor] 提取昵称失败:', e);
      return '';
    }
  }

  /**
   * 账号ID：地址栏 `/user/<sec_uid>`
   *
   * **必须与作品页的「作者ID」是同一个字符串**（抖音就是 sec_uid），
   * 否则两份数据 join 不上。所以这里只从地址栏取，绝不拿抖音号顶替。
   *
   * `/user/self` 是「我的主页」占位路径，不是固定 ID —— 留空，不猜。
   */
  async extractAccountId() {
    try {
      const m = String(location.pathname || '').match(/^\/user\/([A-Za-z0-9_-]{10,200})\/?$/);
      if (!m) return '';
      if (m[1] === 'self') return '';
      return m[1];
    } catch (e) {
      console.error('[DouyinProfileExtractor] 提取账号ID失败:', e);
      return '';
    }
  }

  /**
   * 账号名：页面上「抖音号：xxx」那一段
   *
   * 不用类名（那是构建哈希），只在资料区文本里认 `抖音号：` 前缀。
   * 账号没设抖音号时抖音会显示一串系统数字，用户 2026-10-30 拍板「照原样存」，这里原样返回。
   *
   * 坑（v2.7.15 真机踩到）：`抖音号：77560001305` 和 `IP属地：吉林` 在页面上是两个相邻的
   * 行内元素、中间没有块级换行，压成文本后连成 `抖音号：77560001305IP属地：吉林`。
   * 原来的 `[A-Za-z0-9_\-.]+` 是贪婪匹配，会把 `IP属地` 的 `IP` 一起吃进去，
   * 账号名变成 `77560001305IP`。改成**惰性 + 前瞻**：一碰到空白 / `IP属地` / 行尾就停。
   */
  async extractAccountName() {
    try {
      const box = this._profileBox();
      const text = this._text(box) || this._text(document.body);
      const m = /抖音号[：:]\s*([A-Za-z0-9_.\-]{1,64}?)(?=\s|IP属地|关注|粉丝|获赞|$)/.exec(text);
      return m ? m[1] : '';
    } catch (e) {
      console.error('[DouyinProfileExtractor] 提取账号名失败:', e);
      return '';
    }
  }

  /**
   * 简介（签名）+ 三项统计，**合并成一格**
   *
   * 用户 2026-10-30 定：粉丝数、获赞数、IP属地 不单开列，全部并进「简介」，
   * **排在签名前面**，格式是 `粉丝：1640 · 获赞：2.9万 · IP属地：吉林`，然后换行接签名。
   *
   * 签名分两条路：
   * ① SSR 预渲染数据（`douyin-profile-ssr.js`）—— **完整的**，并且带 @ 链接；
   * ② DOM 文本兜底 —— 会被站点截断在几十字，末尾带 `...`，**没有链接**。
   * 只要 SSR 命中就用它，SSR 对不上（切用户、数据缺失）才退回 DOM。
   *
   * 为什么不做「点『更多』再读」：点击是一次真实行为（埋点 / 可能触发接口），
   * 在风控语境下没有收益，而且点开的只是渲染态，SSR 才是数据源。
   */
  async extractBio() {
    try {
      const stats = this._statsLine();
      const sign = this._signature();
      return [stats, sign].filter(Boolean).join('\n');
    } catch (e) {
      console.error('[DouyinProfileExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /** SSR 解析模块（manifest 里保证先于本文件加载） */
  _ssr() {
    try {
      return typeof window !== 'undefined' && window.DouyinProfileSSR ? window.DouyinProfileSSR : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 三项统计：粉丝 / 获赞 / IP属地
   *
   * 锚点只用 `data-e2e`（粉丝、获赞有）；IP属地没有 e2e，退回**文本前缀**
   * `IP属地：`（它所在元素的类名是构建哈希，碰不得）。取不到就不出现这一项，
   * 不会留下「IP属地：」这种半截。
   */
  _statsLine() {
    const ssr = this._ssr();
    if (!ssr) return '';

    const pickText = (sel) => {
      try {
        const el = document.querySelector(sel);
        return el ? String(el.textContent || '') : '';
      } catch (e) {
        return '';
      }
    };

    const fans = ssr.stripPrefix(pickText('[data-e2e="user-info-fans"]'), '粉丝');
    const likes = ssr.stripPrefix(pickText('[data-e2e="user-info-like"]'), '获赞');

    let ip = '';
    try {
      const box = document.querySelector('[data-e2e="user-info"]') || this._profileBox();
      if (box) {
        const els = box.querySelectorAll('*');
        for (let i = 0; i < els.length; i++) {
          if (els[i].children && els[i].children.length) continue;
          const t = String(els[i].textContent || '').trim();
          if (/^IP属地/.test(t)) { ip = ssr.stripPrefix(t, 'IP属地'); break; }
        }
      }
    } catch (e) {
      ip = '';
    }

    return ssr.formatStats({ fans: fans, likes: likes, ip: ip });
  }

  /** 签名：SSR 完整版优先（带 @ 链接），否则退回 DOM 可见文本 */
  _signature() {
    const ssr = this._ssr();
    if (ssr) {
      try {
        // 地址栏的 sec_uid 是闸口：SSR 里那个 user 必须与之一致，否则宁可不用
        const secUid = this._urlSecUid();
        const user = ssr.readProfile(document, secUid);
        if (user) {
          // 命中 SSR 就**定案**（v2.7.34）：`desc` 为空 = 这个主页确实没写签名（known 空），
          // 不能再退回 DOM 去猜 —— 真机（2026-11-01）就是这么把「IP属地：广东 / UID：…」
          // 当成签名抓进「简介」的。只有 SSR 整个没命中（结构变了 / 精简页），才允许 DOM 兜底。
          return ssr.buildRichText(user.desc, user.descExtra) || '';
        }
      } catch (e) {
        console.error('[DouyinProfileExtractor] SSR 签名解析失败，退回 DOM:', e);
      }
    }
    return this._signatureFromDom();
  }

  /** 地址栏里的 sec_uid（`/user/self` 是占位路径，返回空） */
  _urlSecUid() {
    try {
      const m = String(location.pathname || '').match(/^\/user\/([A-Za-z0-9_-]{10,200})\/?$/);
      if (!m || m[1] === 'self') return '';
      return m[1];
    } catch (e) {
      return '';
    }
  }

  /**
   * 签名兜底：从资料区文本里，`抖音号：xxx` 之后、遇到固定区块词之前的若干行。
   *
   * 注意这条路径拿到的是**站点截断后的**签名（末尾常带 `...`），
   * 且没有 @ 链接 —— 所以它只是兜底，正常情况都走 SSR。
   */
  _signatureFromDom() {
    const box = this._profileBox();
    const raw = this._text(box);
    if (!raw) return '';

    const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    const idx = lines.findIndex((l) => /抖音号[：:]/.test(l));
    if (idx < 0) return '';

    // 这些词一出现就说明签名区结束了（资料区后面紧跟统计数字与作品区）
    const STOP = /^(关注|粉丝|获赞|作品|私密作品|合集|短剧|推荐|喜欢|收藏|观看历史|稍后再看|我的预约|批量管理|搜索你发布的作品|日期筛选|群聊|我公开展示的群聊|展开|更多)/;

    // 资料区里跟在「抖音号」后面的是**账号元数据**，不是签名（v2.7.34）。
    // 真机形态：`抖音号：xxx / IP属地：广东 / 18岁 / 天津·滨海新区 / UID：xxx`。
    // 不跳过它们，没有签名的主页就会把「IP属地」「UID」当签名抓进简介。
    // 「UID / 分享主页 / 私信 / 下载」之后是操作按钮和作品区，签名不可能在这些后面 → 硬停。
    // 为什么必须要这条：`[data-e2e="user-detail"]` 这个容器**把作品区也包进来了**
    // （真机实测：容器文本一路到「作品34 / 推荐 / 喜欢 / 置顶…」），
    // 只靠 META 跳过的话，没有签名的主页会把「分享主页 / 私信已关注 / 下载」当成签名。
    const HARD_STOP = /^(UID|分享主页|分享|私信|发消息|已关注|互相关注|下载|电脑客户端|举报)/;
    const META = /^(IP属地|UID|抖音号|性别|年龄|地区|学校|认证|企业|MCN|粉丝群|个人资料|编辑资料|设置|举报)/;
    const META_AGE = /^\d{1,3}\s*岁$/;
    // 地区行长得像 `天津·滨海新区`。**只在它紧跟在年龄/IP属地之后**才当元数据跳过 ——
    // 单凭「含 ·」判断会把签名里的 `摄影·旅行` 这种也吃掉，那种误伤比多一行更糟。
    const META_REGION = /^[\u4e00-\u9fa5]{2,10}·[\u4e00-\u9fa5]{2,15}$/;

    const out = [];
    let prevWasMeta = false;
    for (let i = idx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (STOP.test(line)) break;
      if (HARD_STOP.test(line)) break;
      // 元数据行直接跳过（不能 break：真机上签名可能排在这批元数据**之后**）
      if (META.test(line) || META_AGE.test(line)) { prevWasMeta = true; continue; }
      if (prevWasMeta && META_REGION.test(line)) continue;
      prevWasMeta = false;
      // 纯数字是统计数，不属于签名
      if (/^[\d.,万Ww+]+$/.test(line)) continue;
      out.push(line);
      if (out.length >= 5) break; // 兜底最多认 5 行，多了必然是别的内容
    }
    // 字数上限统一交给 data-processors 管，这里不再自己砍 500（v2.7.34）
    return out.join('\n');
  }

  /** 网址：本页地址（装配器会走 UrlNormalizer 去掉 ?from_tab_name= 这类参数） */
  async extractUrl() {
    try {
      return String(location.href || '');
    } catch (e) {
      return '';
    }
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 6 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[DouyinProfileExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'account' });
  }

  async extractSpecificFields() {
    return {};
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.DouyinProfileExtractor = DouyinProfileExtractor;
