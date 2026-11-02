/**
 * TikTok 社交媒体信息提取器
 * 提取TikTok视频的基本信息，包括标题、作者、发布日期等
 *
 * v2.5.94：改为「一手数据优先，屏幕文字兜底」。
 *   一手数据 = TikTok 自己塞在页面里的那份作品数据（作者、文案、精确到秒的发布时间），
 *   由 `shared/tiktok-page-data.js` 统一提供（首屏走数据块，切条后走主世界扫描）。
 *   原来全靠扒屏幕文字：日期只认「2022-9-1」「4-15」两种写法，页面上写「5 天前」时
 *   直接取不到；账号名是从网址猜的；切到下一条后内容不跟着变。
 *   现在的取数顺序：一手数据 → 原来的 DOM / meta 取法（一条不动，只是退居兜底）。
 *
 * v2.5.96：支持**个人主页**（`/@someone`）。
 *   主页没有「作品文案 / 作品发布时间」，页面上也一个日期都不显示，字段映射因此另走一路：
 *     作者ID = 账号名（uniqueId）    作者昵称 = 主页昵称    作者主页 = https://www.tiktok.com/@账号名
 *     本页文案 = 主页简介（signature） 发布日期 = **该账号最新一条作品的发布时间**
 *   其中「发布日期」是页面上根本没有的数据，由 `tiktok-net-hook.js` 截页面自己的
 *   作品列表请求拿到（真机实测带秒）；截不到就留空，绝不拿账号创建时间或作品 ID 反推去凑。
 */

class TikTokSocialExtractor extends BaseExtractor {
  /**
   * 构造函数
   */
  constructor() {
    super();
    this.name = 'TikTok';
    this.domain = 'tiktok.com';
    this.mediaType = 'social';
    this.siteName = 'tiktok_social';
  }

  /**
   * 取当前作品的一手数据（预热过就直接给，没预热就同步取一次）
   * @returns {Object|null} {id, desc, createTime, nickname, uniqueId, secUid, authorId, source}
   */
  _tkItem() {
    if (this._tkItemCached) return this._tkItemCached;
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.getCurrent === 'function') {
        this._tkItemCached = TiktokPageData.getCurrent();
      }
    } catch (error) {
      this._tkItemCached = null;
    }
    return this._tkItemCached || null;
  }

  /** 一手数据里的发布时间（秒级时间戳）→ `YYYY/MM/DD HH:MM:SS`；没有就返回空串 */
  _tkDate() {
    const item = this._tkItem();
    if (!item || !item.createTime) return '';
    return this._tkFormat(item.createTime);
  }

  /**
   * 秒级时间戳 → `YYYY/MM/DD HH:MM:SS`（与抖音、以及本模块作品页完全同一格式）
   * @param {number} seconds
   * @returns {string}
   */
  _tkFormat(seconds) {
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.formatTimestamp === 'function') {
        return TiktokPageData.formatTimestamp(seconds);
      }
    } catch (error) { /* 模块异常就走下面的本地兜底 */ }

    // 兜底：模块没加载时也要能把时间戳格式化出来（格式与上面完全一致，
    // 免得同一条作品在不同环境下显示成两个样子）
    try {
      const d = new Date(Number(seconds) * 1000);
      const y = d.getFullYear();
      if (!isFinite(y) || y < 2000 || y > 2100) return '';
      const p = (n) => (n < 10 ? '0' + n : String(n));
      return `${y}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    } catch (error2) {
      return '';
    }
  }

  // ==========================================================================
  // v2.5.96：个人主页通道
  // ==========================================================================

  /** 本页是否个人主页（`/@someone`，不含 `/video/`、`/photo/` 子路径） */
  _tkIsProfile() {
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.isProfileUrl === 'function') {
        return TiktokPageData.isProfileUrl();
      }
    } catch (error) { /* 走本地兜底 */ }
    try {
      return /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[A-Za-z0-9_.]{2,40}\/?(?:[?#]|$)/i.test(window.location.href);
    } catch (e) { return false; }
  }

  /** 主页地址里的账号名；不是主页返回空串 */
  _tkProfileHandle() {
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.urlProfileHandle === 'function') {
        return TiktokPageData.urlProfileHandle();
      }
    } catch (error) { /* 走本地兜底 */ }
    try {
      const m = window.location.href.match(
        /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,40})\/?(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * 主页一手指数据（预热过就直接给，没预热就同步取一次）
   * @returns {Object|null} {uniqueId, nickname, signature, latestCreateTime, latestItemId, ...}
   */
  _tkProfile() {
    if (this._tkProfileCached !== undefined) return this._tkProfileCached;
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.getProfile === 'function') {
        this._tkProfileCached = TiktokPageData.getProfile();
      } else {
        this._tkProfileCached = null;
      }
    } catch (error) {
      this._tkProfileCached = null;
    }
    return this._tkProfileCached || null;
  }

  /** 主页 DOM 兜底：`[data-e2e="user-title"/"user-subtitle"/"user-bio"]` 这类锚点 */
  _tkDomText(selector) {
    try {
      const el = document.querySelector(selector);
      return el && el.textContent ? el.textContent.trim() : '';
    } catch (e) { return ''; }
  }

  // ==========================================================================
  // v2.5.97：推荐流通道（`/`、`/foryou`、`/following`、`/friends`）
  // ==========================================================================

  /**
   * 本页是否推荐流
   *
   * 推荐流跟作品页最大的不同：**地址里没有作品 ID，滚动换条地址一个字都不变**。
   * 所以这里所有「从网址猜」的兜底策略在推荐流上都不可信 —— 页面上第一个
   * `a[href*="/@"]` 往往是右侧推荐位的用户（实测抓到 /@2172085889），不是作者。
   */
  _tkIsFyp() {
    try {
      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.isFypUrl === 'function') {
        return TiktokPageData.isFypUrl();
      }
    } catch (error) { /* 走本地兜底 */ }
    try {
      const m = window.location.href.match(/^https?:\/\/(?:www\.|m\.)?tiktok\.com(\/[^?#]*)?(?:[?#]|$)/i);
      if (!m) return false;
      return /^\/(?:foryou|following|friends)?\/?$/i.test(m[1] || '/');
    } catch (e) { return false; }
  }

  /**
   * 推荐流昵称的屏幕兜底
   *
   * 一手数据里一般有 `nickname`（推荐流是平铺字段）；真拿不到时才看屏幕。
   * 屏幕结构实测（`data-e2e="cinema-creator-identity"` 的三个直接子 div）：
   *   [0] DivCreatorAvatar  头像（e2e=cinema-creator-avatar）
   *   [1] DivCreatorUsername 昵称（里面有个 `a[href="/@账号名"]`）
   *   [2] DivCreatorFollow   关注按钮（**有真实 button 元素**）
   * 判定不靠「关注」两个字（多语言会变），靠「带 button 的是关注按钮」+ 语义类名。
   */
  _tkFypDomName() {
    try {
      // 1) 语义类名（最稳，跟界面语言无关）
      const named = document.querySelector(
        '[data-e2e="cinema-creator-identity"] [class*="DivCreatorUsername"]'
      );
      if (named) {
        const t = (named.textContent || '').trim();
        if (t) return t;
      }
      // 2) 遍历直接子元素：跳过头像、跳过带 button 的关注按钮
      const box = document.querySelector('[data-e2e="cinema-creator-identity"]');
      if (box) {
        const kids = box.children || [];
        for (let i = 0; i < kids.length; i++) {
          const el = kids[i];
          if (!el) continue;
          if (el.getAttribute && el.getAttribute('data-e2e') === 'cinema-creator-avatar') continue;
          if (el.querySelector && el.querySelector('button')) continue;   // 关注按钮
          const t = (el.textContent || '').trim();
          if (t) return t;
        }
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /**
   * 推荐流里「作者主页」的屏幕兜底：只认昵称容器里的那个链接
   *
   * 全页扫 `a[href*="/@"]` 在推荐流上必抓错 —— 页面第一个这种链接是右侧推荐位的用户
   * （实测 `/@2172085889`），跟当前这条的作者毫无关系。所以这里把范围锁死在
   * 播放器下方的创作者身份区里。
   */
  _tkFypDomHandle() {
    try {
      const a = document.querySelector(
        '[data-e2e="cinema-creator-identity"] a[href^="/@"], ' +
        '[data-e2e="cinema-creator-identity"] a[href*="tiktok.com/@"]'
      );
      if (!a) return '';
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/@([A-Za-z0-9_.]{2,40})/);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * 检测当前页面是否为TikTok页面
   * @returns {boolean} 是否为TikTok页面
   */
  isValidPage() {
    const url = window.location.href;
    const hostname = new URL(url).hostname;
    // 匹配任何tiktok.com域名的页面
    return hostname.includes('tiktok.com');
  }

  /**
   * 提取本页标题 - 使用共享标题处理器
   * @returns {string} 本页标题
   */
  extractTitle() {
    try {
      // 获取所需的数据
      const authorName = this.extractAuthorName();
      const authorId = this.extractAuthorID();
      const pageText = this.extractPageText();
      const publishDate = this.extractPublishDate();
      
      // 使用共享标题处理器生成组合标题，传递platform参数和authorId参数
      return SocialTitleProcessor.generatePageTitle(authorName, pageText, publishDate, {
        platform: 'tiktok'
      }, authorId);
    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }

  /**
   * 提取作者ID
   * @returns {string} 作者ID
   */
  extractAuthorID() {
    try {
      // 策略 P（v2.5.96）: 个人主页 —— 账号名就是「作者ID」
      // 主页页面上没有作品，走作品那几条策略会抓到侧栏推荐里别人的数字 ID
      // （实测抓到 /@2172085889，那是推荐用户，不是本页作者）。
      if (this._tkIsProfile()) {
        const pf = this._tkProfile();
        if (pf && pf.uniqueId) return pf.uniqueId;
        const handle = this._tkProfileHandle();          // 地址里就是账号名，最可靠
        if (handle) return handle;
        const sub = this._tkDomText('[data-e2e="user-subtitle"]');
        if (sub) return sub;
        return '';
      }

      // 策略0（v2.5.94）: 一手数据里的账号名（author.uniqueId）
      // 原来是从网址 `/@xxx/` 猜：切条后网址没跟上、或者网址被改短就抓错。
      const tk = this._tkItem();
      if (tk && tk.uniqueId) return tk.uniqueId;

      // v2.5.97 推荐流纪律：地址里没有作品 ID，**页面链接不能碰**。
      // 推荐流右侧有个「推荐用户」侧栏，页面第一个 `a[href*="/@"]` 就是那里的人
      // （实测抓到 /@2172085889），跟当前这条毫无关系。一手数据拿不到就空着。
      if (this._tkIsFyp()) {
        const domHandle = this._tkFypDomHandle();
        return domHandle || '';
      }

      // 策略1: 从URL中提取作者ID
      // v2.5.96：原来这条要求 `@名字` 后面必须跟斜杠，地址是 `/@someone`（不带尾巴）时
      // 直接不匹配 → 掉到策略2 乱抓。现在允许「结尾 / ? #」三种收尾。
      const url = window.location.href;
      const urlMatch = url.match(/\/(@[a-zA-Z0-9_.]{2,40})(?:[\/?#]|$)/);
      if (urlMatch && urlMatch[1]) {
        const authorId = urlMatch[1].replace('@', '');
        return authorId;
      }

      // 策略2: 从作者链接中提取
      const authorLinks = document.querySelectorAll('a[href*="/@"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const hrefMatch = href.match(/\/(@[a-zA-Z0-9_.]+)/);
          if (hrefMatch && hrefMatch[1]) {
            const authorId = hrefMatch[1].replace('@', '');
            return authorId;
          }
        }
      }

      // 策略3: 从meta标签中提取
      const metaAuthor = SocialDomUtils.readMeta('meta[property="og:author"]');
      if (metaAuthor) {
        const content = metaAuthor;
        if (content && content.startsWith('@')) {
          const authorId = content.replace('@', '');
          return authorId;
        }
      }

    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取作者ID失败:', error);
    }
    return '';
  }

  /**
   * 提取作者昵称
   * @returns {string} 作者昵称
   */
  extractAuthorName() {
    try {
      // 策略 P（v2.5.96）: 个人主页 —— 主页昵称
      if (this._tkIsProfile()) {
        const pf = this._tkProfile();
        if (pf && pf.nickname) return pf.nickname;
        const domTitle = this._tkDomText('[data-e2e="user-title"]') ||
          this._tkDomText('h1');
        if (domTitle) return domTitle;
        return '';
      }

      // 策略0（v2.5.94）: 一手数据里的昵称（author.nickname）
      const tk = this._tkItem();
      if (tk && tk.nickname) return tk.nickname;

      // v2.5.97 推荐流：一手数据拿不到昵称 → 屏幕上的创作者身份区兜底。
      // 这一档必须排在「schema.org 面包屑」前面：推荐流那个结构体里放的是**开屏那个视频**
      // 的标题（`xxx (@yyy) | TikTok`），滚了几十条之后它早就不对了。
      if (this._tkIsFyp()) {
        return this._tkFypDomName();
      }

      // 策略1: 从schema.org结构化数据中提取（基于提供的示例）
      const breadcrumbScript = document.querySelector('script[type="application/ld+json"]#BreadcrumbList');
      if (breadcrumbScript) {
        try {
          const jsonData = JSON.parse(breadcrumbScript.textContent);
          if (jsonData && jsonData.itemListElement && Array.isArray(jsonData.itemListElement)) {
            // 查找包含作者信息的项（通常position为2）
            const authorItem = jsonData.itemListElement.find(item => 
              item.position === 2 && 
              item.item && 
              item.item.name && 
              item.item.name.includes('@')
            );
            
            if (authorItem && authorItem.item.name) {
              // 格式如："Photoshoplovers (@changeyouoo) | TikTok"
              const fullName = authorItem.item.name;
              const nameMatch = fullName.match(/^([^()]+)\s*\(/);
              if (nameMatch && nameMatch[1]) {
                const authorName = nameMatch[1].trim();
                return authorName;
              }
            }
          }
        } catch (jsonError) {
          console.error('[TikTokSocialExtractor] 解析schema.org数据失败:', jsonError);
        }
      }

    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取作者昵称失败:', error);
    }
    return '';
  }

  /**
   * 提取作者主页链接
   * @returns {string} 作者主页链接
   */
  extractAuthorHomepage() {
    try {
      // 策略 P（v2.5.96）: 个人主页 —— 本页地址规范化后就是作者主页
      if (this._tkIsProfile()) {
        const pf = this._tkProfile();
        const handle = (pf && pf.uniqueId) || this._tkProfileHandle();
        return handle ? `https://www.tiktok.com/@${handle}` : '';
      }

      // 策略0（v2.5.94）: 一手数据的账号名直接拼主页
      const tk = this._tkItem();
      if (tk && tk.uniqueId) return `https://www.tiktok.com/@${tk.uniqueId}`;

      // v2.5.97 推荐流纪律：只认昵称容器里的作者链接，绝不扫全页（会抓到侧栏推荐用户）
      if (this._tkIsFyp()) {
        const domHandle = this._tkFypDomHandle();
        return domHandle ? `https://www.tiktok.com/@${domHandle}` : '';
      }

      // 策略1: 从作者ID构建主页链接
      const authorId = this.extractAuthorID();
      if (authorId) {
        const authorHomepage = `https://www.tiktok.com/@${authorId}`;
        return authorHomepage;
      }

      // 策略2: 从作者链接中提取
      const authorLinks = document.querySelectorAll('a[href*="/@"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        if (href && href.includes('/@')) {
          // 确保是相对路径或完整的TikTok链接
          if (href.startsWith('http')) {
            return href;
          } else if (href.startsWith('/@')) {
            const fullUrl = `https://www.tiktok.com${href}`;
            return fullUrl;
          }
        }
      }

    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取作者主页失败:', error);
    }
    return '';
  }

  /**
   * 提取本页文案（视频描述）
   * @returns {string} 本页文案
   */
  extractPageText() {
    try {
      // 策略 P（v2.5.96）: 个人主页 —— 本页文案就是主页简介
      // **主页专用纪律**：简介为空就返回空，绝不回落 meta / hashtag 那几档。
      // 主页的 og:description 是「TikTok 上的 X |245.8K 个赞。3978 个粉丝。…」这种
      // 平台 SEO 话术（实测），不是用户写的东西，拿它当文案等于编。
      if (this._tkIsProfile()) {
        const pf = this._tkProfile();
        // v2.5.99：一手数据拿到了，签名空就是「真的没写简介」—— 直接返回空，
        // 交给 SocialFieldsBuilder 兜底填「TikTok视频」。
        // 原来这里会回落 DOM，而 `[data-e2e="user-bio"]` 在一手签名为空时显示的是
        // 平台占位文案「尚无个人简介。」，一填就不为空，兜底永远触发不了。
        // 实测（2026-10-29，/@168cherry_jp）：一手 signature = ''，DOM = 「尚无个人简介。」，
        // 结果文案栏和标题都被这句占位话污染。
        if (pf) return (pf.signature || '').trim();
        // 一手数据完全拿不到才回落 DOM（少见，此时只能信页面上写的）
        const bio = this._tkDomText('[data-e2e="user-bio"]');
        return bio || '';
      }

      // 策略0（v2.5.94）: 一手数据里的 desc
      // 屏幕上那一段可能是自动字幕/翻译，og:description 更是「某某 使用 ♬ 音乐 创作的短视频」，
      // 那不是作品文案。一手数据为空才回落到屏幕文字。
      //
      // v2.5.99：一手拿到了、文案为空 → 就是「真的没写文案」，直接返回空（兜底接手）。
      // 原来会继续往下回落，作品页最后落到 meta，拿到的是平台给搜索引擎看的
      // 「TikTok 上的 xxx (@yyy) 的短视频」—— 既不是文案，又把空位填满，兜底永远不触发。
      // 实测（2026-10-29，/@168cherry_jp/video/7698980327007505684）：一手 desc = ''。
      const tk = this._tkItem();
      if (tk) return (tk.desc || '');

      // v2.5.97 推荐流纪律：一手数据没有文案 → **就空着**，不回落 meta / hashtag。
      // 推荐流的 meta 是「开屏那一下」渲染的，滚过几十条之后它既可能还是第一条的，
      // 也可能是首页的 SEO 话术，拿它当文案等于编。作品页那边保持原样（有独立 meta，可靠）。
      if (this._tkIsFyp()) {
        return '';
      }

      // 策略1: 查找视频描述元素
      const descriptionSelectors = [
        '[data-e2e="video-desc"]',
        '.video-description',
        '[data-e2e="video-description"]',
        '.tiktok-video-description'
      ];

      for (const selector of descriptionSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent) {
          const description = element.textContent.trim();
          if (description && description.length > 0) {
            return description;
          }
        }
      }

      // 策略2: 从meta标签中提取
      const metaDescription = SocialDomUtils.readMeta('meta[property="og:description"]');
      if (metaDescription) {
        const content = metaDescription.trim();
        if (content && content.length > 0) {
          return content;
        }
      }

      // 策略3: 查找包含hashtag的文本元素
      const hashtagElements = document.querySelectorAll('a[href*="/tag/"]');
      if (hashtagElements.length > 0) {
        // 查找包含这些链接的父元素，可能是描述容器
        for (const element of hashtagElements) {
          const parent = element.closest('div, span, p');
          if (parent) {
            const text = parent.textContent?.trim();
            if (text && text.length > 10) { // 确保文本长度合理
              return text;
            }
          }
        }
      }

    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取本页文案失败:', error);
    }
    return '';
  }

  /**
   * 提取发布日期
   * @returns {string} 发布日期
   */
  extractPublishDate() {
    try {
      // 策略 P（v2.5.96）: 个人主页 —— 用**该账号最新一条作品的发布时间**
      //
      // 主页页面上没有任何日期：没有作品发布时间，也没有账号创建时间。
      // 这三条路都试过（详见 `tiktok-net-hook.js` 头部）：首屏数据块的 itemList 是空的、
      // 作品 ID 反推只能到「日」且差一天；能用的只有「截页面自己的作品列表请求」这一条。
      // 截不到就留空 —— 拿账号创建时间冒充「发布日期」属于张冠李戴，宁可空着。
      if (this._tkIsProfile()) {
        const pf = this._tkProfile();
        if (pf && pf.latestCreateTime) return this._tkFormat(pf.latestCreateTime);
        return '';
      }

      // 策略0（v2.5.94）: 一手数据里的 createTime（秒级时间戳）
      // 原来只在屏幕上找「2022-9-1」「4-15」两种写法，页面写「5 天前」时直接取不到，
      // 日期就空着。一手数据里是精确到秒的发布时间。
      const tkDate = this._tkDate();
      if (tkDate) return tkDate;

      // 策略1: 从创作者信息容器中提取日期（基于提供的示例）
      const creatorInfoContainer = document.querySelector('div[class*="DivCreatorInfoContainer"]');
      if (creatorInfoContainer) {
        // 查找包含日期信息的span元素
        const dateSpans = creatorInfoContainer.querySelectorAll('span[class*="TUXText"]');
        for (const span of dateSpans) {
          const textContent = span.textContent?.trim();
          if (textContent && textContent.includes('·')) {
            // 提取日期部分（在"·"符号后面的内容）
            const datePart = textContent.split('·')[1]?.trim();
            if (datePart) {
              
              // 解析并格式化日期
              let formattedDate = '';
              
              // 情况1: 完整日期格式（如：2022-9-1）
              if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(datePart)) {
                const [year, month, day] = datePart.split('-').map(num => parseInt(num));
                formattedDate = `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
              }
              // 情况2: 简化日期格式（如：4-15，默认为当前年份）
              else if (/^\d{1,2}-\d{1,2}$/.test(datePart)) {
                const currentYear = new Date().getFullYear();
                const [month, day] = datePart.split('-').map(num => parseInt(num));
                formattedDate = `${currentYear}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
              }
              
              if (formattedDate) {
                return formattedDate;
              }
            }
          }
        }
      }

    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取发布日期失败:', error);
    }
    return '';
  }

  /**
   * 提取作品地址（URL 字段）
   *
   * 只有推荐流需要自己拼：那里的地址栏永远是 `https://www.tiktok.com/`，
   * 直接输出等于给了个首页，存下来对不上任何作品。
   * 拼法跟用户那份油猴脚本完全一致：`/@账号名/<video|photo>/<作品ID>`，
   * 视频还是图文看 `isPhoto`（图文帖是 `/photo/`，拼成 `/video/` 打不开）。
   *
   * 其他页面一律返回空串 —— 让 SocialFieldsBuilder 照老规矩兜底成当前地址
   * （作品页/图集页本来就是正确地址，主页也是），行为一个字都不变。
   *
   * @returns {string}
   */
  extractUrl() {
    try {
      if (!this._tkIsFyp()) return '';

      const tk = this._tkItem();
      if (!tk || !tk.uniqueId || !tk.id) return '';

      const type = tk.isPhoto ? 'photo' : 'video';
      return `https://www.tiktok.com/@${tk.uniqueId}/${type}/${tk.id}`;
    } catch (error) {
      console.error('[TikTokSocialExtractor] 提取作品地址失败:', error);
      return '';
    }
  }

  /**
   * 当前页是视频还是图文（v2.5.98）
   *
   * 只服务于「本页文案为空时填什么」这一件事：`'photo'` → 「TikTok图文」，
   * 其余（含空串）→ 「TikTok视频」。
   *
   * 三档判定，从上往下取第一条命中的：
   *   1. 一手数据 `isPhoto`（作品页、推荐流都有，最准）；
   *   2. 地址里的 `/photo/<id>`（图集页地址就是它，一手数据拿不到时兜底）；
   *   3. 都没有 → 视频。
   *
   * 主页不单独一档（用户 2026-10-29 明确）：返回空串，落到默认的视频档。
   *
   * @returns {string} 'photo' | 'video' | ''
   */
  getContentShape() {
    try {
      if (this._tkIsProfile()) return '';
      const tk = this._tkItem();
      if (tk && tk.isPhoto) return 'photo';
      if (/\/photo\/\d{6,25}/.test(window.location.href)) return 'photo';
      return 'video';
    } catch (error) {
      return '';
    }
  }

  /**
   * 提取所有字段 - 统一接口方法
   * @returns {Object} 提取的字段对象
   */
  async extractAllFields() {
    // v2.5.96：主页与作品页两头都要预热，但等的不是同一样东西 ——
    //   · 作品页：等主世界扫出这一条的 itemStruct（0/250/700/1500ms 补位），最多 900ms；
    //   · 主页：等页面自己的作品列表请求回来（「最新作品时间」只有那里有），最多 1.2 秒；
    //     等不到不代表失败，各字段会自动回落原来的 DOM 取法，日期栏空着。
    // v2.5.97：推荐流（`/`、`/foryou`）走作品页那条路，等的是「桥节点上出现当前这一条」。
    //
    // 无论哪条路，先把上一次的快照清掉 —— 推荐流换了条之后地址不变、键也不变，
    // 留着旧快照会让这一屏显示上一屏的作者（串台）。
    this._tkItemCached = null;
    this._tkProfileCached = undefined;
    try {
      if (this._tkIsProfile()) {
        if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.ensureProfileFresh === 'function') {
          this._tkProfileCached = await TiktokPageData.ensureProfileFresh();
        } else {
          this._tkProfileCached = null;
        }
      } else if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
        typeof TiktokPageData.ensureFresh === 'function') {
        this._tkItemCached = await TiktokPageData.ensureFresh();
      }
    } catch (error) {
      this._tkItemCached = null;
      this._tkProfileCached = null;
    }

    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }
}

// 导出提取器类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TikTokSocialExtractor;
}

// 全局注册 - 确保工厂类可以访问
if (typeof window !== 'undefined') {
  window.TikTokSocialExtractor = TikTokSocialExtractor;
}
