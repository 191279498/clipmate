/**
 * Instagram 社交媒体信息提取器
 * 提取Instagram帖子的基本信息，包括标题、作者、发布日期等
 * 支持普通帖子页面和Reels短视频页面
 */

class InstagramSocialExtractor extends BaseExtractor {
  /**
   * 构造函数
   */
  constructor() {
    super();
    this.name = 'Instagram';
    this.domain = 'instagram.com';
    this.mediaType = 'social';
    this.siteName = 'instagram_social';  // 用于字段映射与日期格式配置（与 field-mapper / content-main 的 instagram_social 键一致）
    this._activeContext = null;  // Modal 作用域：extractAllFields 调用期间设为 dialog 根节点，供 _q/_qa 使用
  }

  /**
   * 检测当前页面是否为Instagram页面
   * @returns {boolean} 是否为Instagram页面
   */
  isValidPage() {
    const url = window.location.href;
    const hostname = new URL(url).hostname;
    // 匹配任何instagram.com域名的页面
    return hostname.includes('instagram.com');
  }

  /**
   * 作用域化查询：优先在 Modal 根节点（_activeContext）内查询，否则回退 document。
   * 这样在博主主页 SPA Modal 下不会误读到主页 <head> 的 og:* 元数据。
   */
  _q(sel) {
    // meta 标签只在 <head> 里，永远不在 dialog 里——Modal 场景下也必须用 document 查询
    if (sel.startsWith('meta[')) return document.querySelector(sel);
    return (this._activeContext || document).querySelector(sel);
  }
  /**
   * 读取 meta 的 content（统一走 SocialDomUtils，取不到返回 ''）
   * 与 this._meta('meta[...]') 的查询范围完全一致：恒为 document。
   * @param {string} sel - meta 选择器
   * @returns {string}
   */
  _meta(sel) {
    return SocialDomUtils.readMeta(sel);
  }
  _qa(sel) {
    if (sel.startsWith('meta[')) return document.querySelectorAll(sel);
    return (this._activeContext || document).querySelectorAll(sel);
  }

  /**
   * 获取当前页面类型
   * @returns {string} 页面类型: 'reels' | 'post' | 'profile' | 'stories' | 'other'
   */
  getPageType() {
    const pathname = window.location.pathname;
    // Modal 打开时（博主主页 SPA 原地打开帖子）：以 Modal 内帖子链接为准，覆盖主页 URL 不变的情况
    const dlg = document.querySelector('div[role="dialog"]');
    if (dlg) {
      const link = dlg.querySelector('a[href*="/p/"], a[href*="/reel"], a[href*="/reels/"], a[href*="/stories/"]');
      const href = (link && link.getAttribute && link.getAttribute('href')) || '';
      if (/\/stories\//.test(href) || /\/stories\//.test(pathname)) return 'stories';
      if (/\/reels?\//.test(href) || /\/reels?\//.test(pathname)) return 'reels';
      return 'post';
    }
    // Reels短视频页面：/reels/xxx 或 /reel/xxx
    if (/\/reels?\//.test(pathname)) {
      return 'reels';
    }
    // Stories快拍页面：/stories/username/xxx 或 /stories/highlights/xxx
    if (/\/stories\//.test(pathname)) {
      return 'stories';
    }
    // 普通帖子页面：/p/xxx
    if (/\/p\//.test(pathname)) {
      return 'post';
    }
    // 用户主页：/username/
    if (/^\/[a-zA-Z0-9_.]+\/?$/.test(pathname)) {
      return 'profile';
    }
    return 'other';
  }

  /**
   * 检测是否为Reels页面
   * @returns {boolean} 是否为Reels页面
   */
  isReelsPage() {
    return this.getPageType() === 'reels';
  }

  /**
   * 检测是否为Stories快拍页面
   * Stories页面的URL格式：/stories/{username}/{storyId}/ 或 /stories/highlights/{highlightId}/
   * @returns {boolean} 是否为Stories快拍页面
   */
  isStoriesPage() {
    return this.getPageType() === 'stories';
  }

  /**
   * 检测是否为普通帖子页面
   * 帖子页面的URL格式：/p/{shortcode}/
   * @returns {boolean} 是否为普通帖子页面
   */
  isPostPage() {
    return this.getPageType() === 'post';
  }

  /**
   * 提取本页标题 - 使用共享标题处理器
   *
   * @param {string} [pageText] - 已经算好的文案。不传则实时 `extractPageText(context)` 取。
   * @param {Document|Element} [context] - 取值作用域（详情页弹层时是弹层节点）
   * @param {Object} [meta] - 首页信息流专用（v2.7.38）
   *   `{authorName, authorId, publishDate}`：首页那条帖子的昵称/账号/日期来自页面自己
   *   请求信息流时截下来的数据（桥节点），不是弹层 DOM，只能外部传进来。
   *   **不传就走原来的 DOM 取法，行为与 v2.7.37 完全一致。**
   * @returns {string} 本页标题
   */
  extractTitle(pageText, context = document, meta = null) {
    try {
      // 获取所需的数据
      //
      // v2.7.37：**标题里必须是昵称，不是用户名。**
      // 规则一直是「社交标题 = 昵称 + 文案前 20 字 + 日期」（小红书等站都这么走），
      // 但 IG 这里原来把 `extractAuthorName()`（= 用户名）当昵称传进去了，
      // 于是标题写成 `roxysitora…`、`anonymouzzz…`（用户名还被去掉了特殊字符），
      // 用户在首页一眼看出「作者昵称不对」。`extractAuthorNickname()` 早就有
      // （桥节点按 username 取显示名 → twitter:title → DOM），这里直接用它，取不到才回落用户名。
      //
      // v2.7.38：多一个 `meta` 入口，服务首页信息流（那里没有弹层 DOM 可读）。
      // 走 meta 与走 DOM 必须**逐字同结果** —— 首页小按钮和点开帖子两个入口出同一串标题，
      // 这是项目铁律，真机 `ig-feed-cross-entry.js` 专门盯它。
      const authorName = (meta && meta.authorName) ||
        this.extractAuthorNickname(context) || this.extractAuthorName(context);
      const authorId = (meta && meta.authorId) || this.extractAuthorName(context); // Instagram的用户名就是作者ID
      // 优先复用 extractAllFields 已计算好的文案（contentText），避免重复提取；
      // 未传入时回退到实时提取，保证其他调用方兼容
      const text = (pageText !== undefined && pageText !== null) ? pageText : this.extractPageText(context);
      const publishDate = (meta && meta.publishDate) || this.extractPublishDate(context);
      
      // 使用共享标题处理器生成组合标题，传递platform参数和authorId参数
      return SocialTitleProcessor.generatePageTitle(authorName, text, publishDate, {
        platform: 'instagram'
      }, authorId);
    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }
  

  


  /**
   * 提取作者昵称
   * @returns {string} 作者昵称
   */
  extractAuthorName(context = document) {
    try {
      // ========== Reels页面专用提取策略 ==========
      if (this.isReelsPage()) {
        const reelsAuthor = this.extractAuthorNameFromReels(context);
        if (reelsAuthor) {
          return reelsAuthor;
        }
      }

      // ========== Stories快拍页面专用提取策略 ==========
      // Stories页面DOM结构与普通帖子不同，优先使用专用策略
      if (this.isStoriesPage()) {
        const storiesAuthor = this.extractAuthorNameFromStories(context);
        if (storiesAuthor) {
          return storiesAuthor;
        }
        // Stories专用策略失败后，继续尝试通用策略（部分Stories页面可能复用普通DOM）
      }

      // 策略1: 优先查找特定类名的元素（基于提供的HTML示例）
      // 这是最准确的方式，因为它直接匹配作者用户名的显示元素
      const usernameElement = context.querySelector('span._ap3a._aaco._aacw._aacx._aad7._aade');
      if (usernameElement && usernameElement.textContent) {
        const username = usernameElement.textContent.trim();
        if (username && username.length > 0 && username.length <= 30) {
          return username;
        }
      }

      // 策略2: 查找包含作者信息的特定链接结构（改进版本）
      // 寻找具有特定类名组合的作者链接
      const authorLink = context.querySelector('a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz notranslate._a6hd');
      if (authorLink && authorLink.getAttribute('href')) {
        const href = authorLink.getAttribute('href');
        if (href && href.startsWith('/') && href.length > 1) {
          const username = href.split('/')[1];
          if (username && username.length > 0 && !username.includes('?') && !username.includes('#')) {
            return username;
          }
        }
      }

      // 策略3: 查找包含文本的span元素，匹配用户名格式并确保在正确的结构中
      const allSpans = context.querySelectorAll('span._ap3a._aaco._aacw._aacx._aad7._aade, span.x1lliihq.x1plvlek.xryxfnj.x1n2onr6.xyejjpt');
      for (const span of allSpans) {
        const text = span.textContent?.trim();
        if (text && text.length > 0 && text.length <= 30) {
          // 检查是否为用户名格式
          if (/^[a-zA-Z0-9_.]+$/.test(text) && 
              !text.includes(' ') && 
              span.closest('a')?.getAttribute('href')?.startsWith(`/${text}/`)) {
            return text;
          }
        }
      }

      // 策略4: 从meta标签中提取
      const metaAuthor = this._meta('meta[property="og:title"]');
      if (metaAuthor) {
        const content = metaAuthor;
        if (content) {
          // Instagram的og:title通常格式为 "Username (@username)" 或 "Username"
          const usernameMatch = content.match(/@([a-zA-Z0-9_.]+)/);
          if (usernameMatch && usernameMatch[1]) {
            return usernameMatch[1];
          }
          // 也尝试直接提取用户名部分（如果格式为 "Username"）
          const directUsername = content.replace(/\s*\(@[a-zA-Z0-9_.]+\)/, '').trim();
          if (directUsername && /^[a-zA-Z0-9_.]+$/.test(directUsername)) {
            return directUsername;
          }
        }
      }

      // 策略5: 作为最后手段，查找帖子头部区域的用户链接
      const postHeader = context.querySelector('div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x9f619.xjbqb8w.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.x1q0g3np.xqjyukv.x6s0dn4.x1oa3qoh.x1nhvcw1');
      if (postHeader) {
        const headerLinks = postHeader.querySelectorAll('a[href^="/"]:not([href^="//"])');
        for (const link of headerLinks) {
          const href = link.getAttribute('href');
          if (href && href.startsWith('/') && !href.includes('explore/') && !href.includes('p/') && !href.includes('reel/')) {
            const username = href.split('/')[1];
            if (username && username.length > 0 && /^[a-zA-Z0-9_.]+$/.test(username)) {
              return username;
            }
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取作者昵称时出错:', error);
    }
    return '';
  }

  /**
   * 提取作者主页链接
   * @returns {string} 作者主页链接
   */
  extractAuthorHomepage(context = document) {
    try {
      // ========== Reels页面专用提取策略（多源降级）==========
      // Reels页面没有<a href="/username/">类型的作者链接，必须从meta标签提取
      // 仅在 /reels/xxx 或 /reel/xxx 页面生效，不影响其他Instagram页面
      if (this.isReelsPage()) {
        // 策略0（v2.7.6）：数据块里**当前这一条**的作者 → 直接拼主页。
        // 下面的专用策略读的是 og:url 等 meta，沉浸流里那是首屏那条的作者（切条不更新）。
        const inlineItem = this._reelsInlineItem();
        if (inlineItem && inlineItem.username) {
          return 'https://www.instagram.com/' + inlineItem.username + '/';
        }
        const reelsHomepage = this.extractReelsAuthorHomepage();
        if (reelsHomepage) {
          return reelsHomepage;
        }
        // v2.7.4：Reels 专用策略失败时**不再直接返回空** —— 真机实测 `/reels/<code>/` 上
        // 「作者主页」一直是空（沉浸流里 og:* 不跟着换，专用策略全落空），而作者ID（用户名）
        // 是稳稳拿得到的。Instagram 的主页路径恒等于用户名，拼出来就是正确主页。
        const reelsId = (this.extractAuthorName(context) || '').trim();
        if (reelsId && /^[A-Za-z0-9_.]+$/.test(reelsId)) {
          return 'https://www.instagram.com/' + reelsId + '/';
        }
        // 连作者ID 都没有才返回空
        return '';
      }

      // ========== Stories快拍页面专用提取策略 ==========
      // Stories页面没有标准的作者链接DOM元素，使用专用策略提取
      if (this.isStoriesPage()) {
        const storiesHomepage = this.extractStoriesAuthorHomepage();
        if (storiesHomepage) {
          return storiesHomepage;
        }
        // Stories专用策略失败后，继续尝试通用策略
      }

      // ========== 以下是其他类型页面的通用提取策略 ==========

      // v2.7.4：旧的「策略1：一长串混淆类名选择器」和「策略2：全 context 遍历第一个
      // 像用户主页的链接」在弹层里会**取错人**。真机实测（2026-10-30，作者主页点开帖子）：
      //   那条混淆类名选择器在弹层里命中 **2 个**元素 —— 第一个是**评论区第一个用户**
      //   `/whoistaraaa/`，第二个才是真作者 `/ya_thinkabout/`；`querySelector` 取第一个，
      //   于是「作者ID=ya_thinkabout（对）」而「作者主页=/whoistaraaa/（错）」，两份数据打架。
      //   旧策略2 同理（遍历全弹层，扫到评论区就返回）。
      // 修法：**强证据优先 + 与作者ID 交叉校验**；遍历一律限定在帖子头部内。

      // 策略1（最强证据）：context 内「与作者ID 完全一致」的用户名链接。
      // 作者ID 由 extractAuthorName 给出（实测弹层/详情页/Reels 上都正确），
      // 拿它当筛子，评论区那些 whoistaraaa 会被直接排除掉。
      const authorId = (this.extractAuthorName(context) || '').trim();
      if (authorId && /^[A-Za-z0-9_.]+$/.test(authorId)) {
        const want = '/' + authorId;
        const allLinks = context.querySelectorAll('a[href^="/"]:not([href^="//"])');
        for (const link of allLinks) {
          const raw = (link.getAttribute('href') || '').split('?')[0].replace(/\/+$/, '');
          if (raw === want) {
            return 'https://www.instagram.com/' + authorId + '/';
          }
        }
      }

      // 策略2：帖子头部（header）里第一个用户名链接 —— 弹层/详情页的 header 就是作者区，
      // 限定在 header 内才不会扫到评论区（真机：header 内前两个链接都是 /ya_thinkabout/）。
      const postHeader = context.querySelector('header');
      if (postHeader) {
        const headerLinks = postHeader.querySelectorAll('a[href^="/"]:not([href^="//"])');
        for (const link of headerLinks) {
          const raw = (link.getAttribute('href') || '').split('?')[0];
          if (!/^\/[A-Za-z0-9_.]+\/?$/.test(raw)) continue;
          const name = raw.replace(/\//g, '');
          if (!name) continue;
          // 双保险：排除 IG 自己的目录段（/explore/... 已被上面的正则挡掉）
          if (/^(explore|locations|tags|accounts|direct|settings|stories)$/.test(name)) continue;
          return 'https://www.instagram.com/' + name + '/';
        }
      }

      // 策略3: 如果找到了作者昵称，可以构建作者主页URL
      const authorName = this.extractAuthorName(context);
      if (authorName) {
        const authorHomepage = `https://www.instagram.com/${authorName}/`;
        return authorHomepage;
      }

      // 策略4: 查找特定类名的链接元素（基于提供的HTML示例）
      const userLinkElement = context.querySelector('a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz notranslate._a6hd');
      if (userLinkElement && userLinkElement.getAttribute('href')) {
        const relativePath = userLinkElement.getAttribute('href');
        const authorHomepage = `https://www.instagram.com${relativePath.endsWith('/') ? relativePath : relativePath + '/'}`;
        return authorHomepage;
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取作者主页时出错:', error);
    }
    return '';
  }

  /**
   * 从Reels页面提取作者主页（多源降级策略）
   * 策略1: 从og:url提取（最稳定，Instagram自带的标准数据）
   * 策略2: 从og:description或description提取（备选，从" - username，"模式匹配）
   * 策略3: 从twitter:title提取（备选，从"@username"模式匹配）
   * 仅供Reels页面使用，不影响其他Instagram页面
   * @returns {string} 作者主页URL，失败返回空字符串
   */
  extractReelsAuthorHomepage() {
    try {
      // ============================================
      // 策略1: 从 og:url 提取（最稳定）
      // og:url 格式: https://www.instagram.com/{username}/reel/{reelId}/
      // 提取出: https://www.instagram.com/{username}/
      // ============================================
      const ogUrlElement = this._meta('meta[property="og:url"]');
      if (ogUrlElement) {
        const ogUrl = ogUrlElement.trim();
        // 匹配 https://www.instagram.com/{username}/ 部分
        const match = ogUrl.match(/^(https?:\/\/www\.instagram\.com\/[a-zA-Z0-9_.]+)\//);
        if (match && match[1]) {
          const homepage = match[1] + '/';
          return homepage;
        }
      }

      // ============================================
      // 策略2: 从 og:description 或 description 提取 username 后拼接
      // 典型格式: "11K likes, 78 comments - news.ebc，July 22, 2026 : ..."
      // 匹配模式: " - username，" 或 " - username," （username后跟中文/英文逗号）
      // ============================================
      const descMeta = this._meta('meta[property="og:description"]')
                     || this._meta('meta[name="description"]');
      if (descMeta) {
        const content = descMeta;
        // 匹配 " - username，" 或 " - username," 这种模式
        const match = content.match(/-\s*([a-zA-Z0-9_.]+)\s*[，,]/);
        if (match && match[1]) {
          const username = match[1].trim();
          // 排除已知非用户名的关键词（如 Instagram、Reels 等）
          if (username && !['Instagram', 'instagram', 'Reels', 'reels', 'reel'].includes(username)) {
            const homepage = `https://www.instagram.com/${username}/`;
            return homepage;
          }
        }
      }

      // ============================================
      // 策略3: 从 twitter:title 提取 (@username)
      // 典型格式: "東森新聞 (@news.ebc) • Instagram Reels"
      // 匹配模式: "@username" （@符号后跟字母数字下划线点号）
      // ============================================
      const twitterTitleElement = this._meta('meta[name="twitter:title"]');
      if (twitterTitleElement) {
        const content = twitterTitleElement;
        // 匹配 @username 格式
        const match = content.match(/@([a-zA-Z0-9_.]+)/);
        if (match && match[1]) {
          const username = match[1];
          const homepage = `https://www.instagram.com/${username}/`;
          return homepage;
        }
      }

      return '';
    } catch (error) {
      console.error('[InstagramSocialExtractor] Reels: 提取作者主页时出错:', error);
      return '';
    }
  }

  /**
   * 提取本页文案（帖子正文内容）
   * @returns {string} 本页文案
   */
  /**
   * 清理普通帖子页(/p/)的本页文案
   * Instagram 的 og:description 带有固定包裹前缀：
   *   "345 likes, 6 comments - 作者, 日期 : "正文""
   * 本方法仅剥离该前缀与结尾引号，保留正文内部的换行与标签。
   * 仅对普通帖子页生效；其它页面类型或干净文案原样返回，零误伤。
   * @param {string} text 原始文案
   * @returns {string} 清理后的文案
   */
  cleanPostCaption(text) {
    // Modal 内（_activeContext 为 dialog 根节点）同样需要清洗文案前缀；/p/ 独立页保持原逻辑
    const inModal = this._activeContext && this._activeContext !== document;
    if ((!this.isPostPage() && !inModal) || !text) {
      return text;
    }
    // 仅匹配 Instagram og:description 包裹格式的前缀："N likes, M comments - 作者, 日期 : "
    const prefixMatch = text.match(/^\s*[\d,]+\s*likes?,?\s*[\d,]*\s*comments?\s*-\s*[\s\S]*?:\s*["“]?/i);
    if (!prefixMatch) {
      return text; // 非包裹格式（如 DOM 干净文案）原样返回
    }
    let cleaned = text.slice(prefixMatch[0].length);
    // 去掉包裹引号及引号后可能紧跟的尾随句点/空白（如 "...#uni".）
    cleaned = cleaned.replace(/^["“]\s*/, '').replace(/\s*["“]\.?\s*$/, '');
    return cleaned.trim();
  }

  extractPageText(context = document) {
    try {
      // ========== Reels页面专用提取策略 ==========
      if (this.isReelsPage()) {
        const reelsText = this.extractPageTextFromReels(context);
        if (reelsText) {
          return reelsText;
        }
        // 注意：这里**不需要**再判一次「接口说这条没文案」。
        // 那个结论在 extractPageTextFromReels 的策略0 里已经定案并返回空串了；
        // 在外面再写一遍是死代码（反向验证时拆掉它测试照样是绿的，正说明它没起作用）。
      }

      // ========== Modal 专用策略（博主主页对话框）==========
      // Modal 右侧栏 article 结构：博主正文 + 评论列表(<ul>)
      // 旧策略遍历所有 <span>、挑最长 → 博主短正文("Road trip 🚗")过不了 20 字过滤，
      // 第一个过 20 字的就是评论区某条评论。改用 tree walker 显式排除评论 <ul>。
      if (this._activeContext && this._activeContext !== document) {
        const modalCaption = this.extractCaptionFromModal(context);
        if (modalCaption) {
          return this.cleanPostCaption(modalCaption);
        }
      }

      // 策略1: 基于用户提供的HTML示例查找特定类名的span元素
      // 这个类名组合通常包含帖子的完整文案内容
      const contentSpan = context.querySelector('span.x193iq5w.xeuugli.x13faqbe.x1vvkbs.xt0psk2.x1i0vuye.xvs91rp.xo1l8bm.x5n08af.x10wh9bi.xpm28yp.x8viiok.x1o7cslx.x126k92a');
      if (contentSpan && contentSpan.textContent) {
        // 获取完整文本内容
        let textContent = contentSpan.textContent.trim();
        // 处理HTML中的<br>标签，转换为实际的换行符
        // 注意：textContent不包含HTML标签，所以我们需要特殊处理@和#标签的格式
        
        // 提取所有@提及和#标签，并保留格式
        const links = contentSpan.querySelectorAll('a');
        if (links.length > 0) {
          let processedText = textContent;
          
          // 处理#标签链接
          const hashtagLinks = Array.from(links).filter(link => 
            link.getAttribute('href')?.includes('/explore/tags/')
          );
          
          for (const link of hashtagLinks) {
            const href = link.getAttribute('href');
            if (href) {
              // 从URL中提取标签名
              const tagName = href.split('/tags/')[1]?.split('/')[0];
              if (tagName && !processedText.includes(`#${tagName}`)) {
                // 如果文本中没有包含#标签格式，我们添加它
                // 注意：这是简化处理，实际情况可能需要更复杂的文本替换逻辑
              }
            }
          }
          
          // 处理@提及链接
          const mentionLinks = Array.from(links).filter(link => 
            link.getAttribute('href')?.startsWith('/') && 
            !link.getAttribute('href')?.includes('/explore/tags/')
          );
          
          for (const link of mentionLinks) {
            const href = link.getAttribute('href');
            if (href) {
              // 从URL中提取用户名
              const username = href.split('/')[1]?.split('/')[0];
              if (username && !processedText.includes(`@${username}`)) {
                // 如果文本中没有包含@提及格式，我们添加它
                // 注意：这是简化处理，实际情况可能需要更复杂的文本替换逻辑
              }
            }
          }
          
          return this.cleanPostCaption(processedText);
        }
        
        return this.cleanPostCaption(textContent);
      }

      // 策略2: 查找包含大量文本内容的span元素（备选方案）
      const allSpans = context.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent?.trim();
        // 寻找包含合理长度文本（大于20个字符）且包含#标签或@提及的元素
        if (text && text.length > 20 && 
            (text.includes('#') || text.includes('@') || 
             text.length > 50 || 
             text.split('\n').length > 2)) {
          // 排除个人资料统计文本（"X 位粉丝 已关注 Y 人 · Z 篇帖子 · 查看 ... 的 Instagram"）
          if (/位粉丝|已关注|篇帖子|查看.+的 Instagram/.test(text)) continue;
          // 检查这个span是否位于帖子内容区域
          const isInPostContent = span.closest('div[role="button"]') || 
                                 span.closest('article') ||
                                 span.closest('div.x9f619.xjbqb8w.x78zum5.x168nmei.x13lgxp2.x5pf9jr.xo71vjh.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.xdt5ytf.xqjyukv');
          
          if (isInPostContent) {
            return this.cleanPostCaption(text);
          }
        }
      }

      // 策略3: 从meta标签中提取帖子描述（备选方案）
      const metaDescription = this._meta('meta[property="og:description"]');
      if (metaDescription) {
        const content = metaDescription.trim();
        if (content && content.length > 20) {
          return this.cleanPostCaption(content);
        }
      }

      // 策略4: 查找文章内容区域内的文本（备选方案）
      const articleContent = context.querySelector('article');
      if (articleContent) {
        // 获取文章区域内的所有文本节点
        const textNodes = [];
        const walker = document.createTreeWalker(articleContent, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
          if (node.textContent.trim().length > 0) {
            textNodes.push(node.textContent.trim());
          }
        }
        
        // 合并文本节点，过滤掉过短或可能是用户名的文本
        const mergedText = textNodes
          .filter(text => text.length > 3 && !/^@?[a-zA-Z0-9_.]+$/.test(text))
          .join('\n\n')
          .trim();
        
        if (mergedText && mergedText.length > 20) {
          return this.cleanPostCaption(mergedText);
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取本页文案时出错:', error);
    }
    return '';
  }

  /**
   * 从 Modal（博主主页对话框）精确提取博主正文。
   * Modal 右侧栏的 <article> 结构：博主正文 + 评论列表(<ul>，caption 一定在其之前)。
   * 用 tree walker 收集 article 内、评论 <ul> 之外的所有文本节点（跳过按钮）。
   * @param {Element} modalRoot - Modal 根节点（div[role="dialog"]）
   * @returns {string|null} 博主正文；找不到返回 null（让上游走通用策略）
   */
  extractCaptionFromModal(modalRoot) {
    if (!modalRoot) return null;
    const article = modalRoot.querySelector('article');
    if (!article) return null;

    // 找顶层评论 <ul>（caption 一定在其之前）
    const commentsUl = this._findTopCommentsList(article);

    // 策略 A：找 <h1>（IG 新版 UI 把博主正文放在评论 <ul> 的第一个 <li> 里，
    // 用 <h1> 标签装正文，真正的评论用 <h2>/<h3>。所以直接查 h1，不管它在不在 ul 内。）
    const h1 = article.querySelector('h1');
    if (h1) {
      const text = (h1.textContent || '').trim();
      if (text.length > 0) return text;
    }
    // 策略 A'：其他标题标签
    for (const tag of ['h2', 'h3']) {
      const el = article.querySelector(tag);
      if (el && (!commentsUl || !commentsUl.contains(el))) {
        const text = (el.textContent || '').trim();
        if (text.length > 0) return text;
      }
    }

    // 策略 B：tree walker 收集 article 内文本（更宽松的过滤：只过滤 <button> 真按钮，
    // 不再过滤 role="button"——IG 会把"博主名 + 正文"整段包在 role="button" 里用于跳转帖子页，
    // 那样会把博主正文一并过滤掉。translate/查看翻译等按钮用 <button> 真标签，仍会被过滤）。
    const walker = (typeof document !== 'undefined' && document.createTreeWalker)
      ? document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            // 跳过评论 <ul> 内的所有文本（含回复）
            if (commentsUl && commentsUl.contains(node)) {
              return NodeFilter.FILTER_REJECT;
            }
            // 只跳过真正的 <button> 标签（"查看翻译" 等）
            let p = node.parentElement;
            while (p && p !== article) {
              if (p.tagName === 'BUTTON' || p.tagName === 'UL') {
                return NodeFilter.FILTER_REJECT;
              }
              p = p.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        })
      : null;
    if (!walker) return null;

    const parts = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || '').trim();
      if (!text || text.length < 2) continue;
      // 跳过纯 emoji 文本节点（避免重复计数）
      if (/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]+$/u.test(text)) continue;
      parts.push(text);
    }

    const caption = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return caption || null;
  }

  /**
   * 找顶层评论 <ul>（caption 一定在其之前）。
   * 优先 article 直系子节点中的 <ul>，其次 article 子 div 内的 <ul>，最后回退到第一个 <ul>。
   */
  _findTopCommentsList(article) {
    for (const child of article.children) {
      if (child.tagName === 'UL') return child;
      const innerUl = child.querySelector(':scope > ul');
      if (innerUl) return innerUl;
    }
    return article.querySelector('ul');
  }

  /**
   * 提取发布日期
   * @returns {string} 发布日期
   */
  extractPublishDate(context = document) {
    try {
      // ========== Reels页面专用提取策略 ==========
      if (this.isReelsPage()) {
        const reelsDate = this.extractPublishDateFromReels(context);
        if (reelsDate) {
          return reelsDate;
        }
      }

      // ========== Stories快拍页面专用提取策略 ==========
      if (this.isStoriesPage()) {
        const storiesDate = this.extractPublishDateFromStories(context);
        if (storiesDate) {
          return storiesDate;
        }
        // Stories专用策略失败后，继续尝试通用策略
      }

      // 策略1: 基于用户提供的HTML示例查找特定类名的time标签
      // 从time标签的datetime属性中提取ISO格式的日期
      const timeElement = context.querySelector('time.x1p4m5qa');
      if (timeElement) {
        // 优先从title属性中获取格式化的日期
        if (timeElement.getAttribute('title')) {
          const titleDate = timeElement.getAttribute('title').trim();
          if (titleDate) {
            // 不原样返回：title 内容随账号语言设置变化，统一格式化为 YYYY/MM/DD
            const slashDate = this.formatDateToSlash(titleDate);
            if (slashDate) {
              return slashDate;
            }
          }
        }
        
        // 从datetime属性中提取ISO格式的日期并统一转换为斜杠格式 YYYY/MM/DD
        if (timeElement.getAttribute('datetime')) {
          const datetime = timeElement.getAttribute('datetime');
          try {
            const date = new Date(datetime);
            if (!isNaN(date.getTime())) {
              // 格式化为斜杠日期格式：YYYY/MM/DD
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          } catch (dateError) {
            console.error('[InstagramSocialExtractor] 解析日期时出错:', dateError);
          }
        }
        
        // 从time标签的文本内容中提取
        const textContent = timeElement.textContent?.trim();
        if (textContent && textContent.length > 0) {
          const slashDate = this.formatDateToSlash(textContent);
          if (slashDate) {
            return slashDate;
          }
          // 无法解析为绝对日期（如纯相对时间缩写）则继续后续策略
        }
      }

      // 策略2: 查找所有time标签，寻找可能的发布日期
      const allTimeElements = context.querySelectorAll('time');
      for (const element of allTimeElements) {
        // 检查是否有datetime属性
        if (element.getAttribute('datetime')) {
          const datetime = element.getAttribute('datetime');
          try {
            const date = new Date(datetime);
            if (!isNaN(date.getTime())) {
              // 格式化为斜杠日期格式 YYYY/MM/DD
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          } catch (dateError) {
            console.error('[InstagramSocialExtractor] 解析日期时出错:', dateError);
          }
        }
        
        // 检查是否有title属性（title 内容随语言设置变化，统一格式化为 YYYY/MM/DD）
        if (element.getAttribute('title')) {
          const titleDate = element.getAttribute('title').trim();
          if (titleDate) {
            const slashDate = this.formatDateToSlash(titleDate);
            if (slashDate) {
              return slashDate;
            }
          }
        }
      }

      // 策略3: 查找包含日期格式的span元素（备选方案）
      const allSpans = context.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent?.trim();
        if (text && text.length > 0) {
          // 检查是否包含日期格式
          if (/\d{4}年\d{1,2}月\d{1,2}日/.test(text)) {
            // 检查这个span是否位于发布日期相关区域
            const isInDateArea = span.closest('a[role="link"]') || 
                               span.closest('div._ap3a._aaco._aacu._aacx._aad6._aade') ||
                               span.closest('div.x193iq5w.xeuugli.x13faqbe.x1vvkbs.xt0psk2.x1i0vuye.xvs91rp.xo1l8bm.x5n08af.x10wh9bi.xpm28yp.x8viiok.x1o7cslx.x126k92a');
            
            if (isInDateArea) {
              const slashDate = this.formatDateToSlash(text);
              if (slashDate) {
                return slashDate;
              }
            }
          }
          
          // 检查是否是相对时间格式（例如：1 天前 / 2 周前）
          if (/^\d+\s*[天月年]?\s*前$/.test(text) || 
              /^\d+\s*[小时分钟秒]?\s*前$/.test(text) ||
              /^\d+\s*周?\s*前$/.test(text)) {
            // 检查这个span是否位于发布日期相关区域
            const isInDateArea = span.closest('a[role="link"]') || 
                               span.closest('time');
            
            if (isInDateArea) {
              const slashDate = this.formatDateToSlash(text);
              if (slashDate) {
                return slashDate;
              }
            }
          }
        }
      }

      // 策略4: 从meta标签中提取发布日期（备选方案）
      const metaTags = this._qa('meta[property*="date"], meta[name*="date"]');
      for (const meta of metaTags) {
        const content = meta.getAttribute('content');
        if (content) {
          try {
            const date = new Date(content);
            if (!isNaN(date.getTime())) {
              // 格式化为斜杠日期格式 YYYY/MM/DD
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          } catch (dateError) {
            console.error('[InstagramSocialExtractor] 解析meta标签日期时出错:', dateError);
          }
        }
      }

      // 策略5: 从JavaScript变量或全局对象中提取（备选方案）
      try {
        // Instagram有时会在全局JavaScript对象中存储帖子数据
        // 尝试查找可能包含发布日期的全局变量或JSON数据
        const scripts = this._qa('script');
        for (const script of scripts) {
          const scriptContent = script.textContent || '';
          
          // 查找包含日期时间戳的模式
          const timestampMatches = scriptContent.match(/"taken_at_timestamp":(\d+)/);
          if (timestampMatches && timestampMatches[1]) {
            const timestamp = parseInt(timestampMatches[1], 10);
            if (!isNaN(timestamp)) {
              const date = new Date(timestamp * 1000);
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          }
        }
      } catch (jsError) {
        console.error('[InstagramSocialExtractor] 从JavaScript变量提取日期时出错:', jsError);
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取发布日期时出错:', error);
    }
    return '';
  }

  /**
   * 提取作者昵称
   * 从meta标签的twitter:title中提取，格式为 "作者昵称 (@作者ID)" 或 "@作者ID"
   * @returns {string} 作者昵称
   */
  extractAuthorNickname(context = document) {
    try {
      // 策略0（v2.7.6，仅 Reels）：数据块里当前这一条作者的 full_name。
      // 同 extractAuthorNameFromReels 策略0：沉浸流的 meta 是首屏那条的，切条不更新。
      if (this.isReelsPage()) {
        const inlineItem = this._reelsInlineItem();
        if (inlineItem && inlineItem.fullName) {
          return inlineItem.fullName;
        }
      }

      // 策略0.5（v2.7.21）：桥节点里按**作者 username** 取显示名。
      // 弹层态 head 里的 meta 是「上一次整页加载」留下的（站内跳转/弹层都不更新），
      // twitter:title 常常是空的 —— 于是昵称掉到 extractAuthorName 兜底，显示成 username。
      // 桥节点是按 username 建索引的，物理上不会串台。
      const bridgeNick = this._igBridgeNickname(context);
      if (bridgeNick) {
        return bridgeNick;
      }

      // 策略1: 普通帖子/Reels 页从 twitter:title 提取，格式 "昵称 (@ID) • Instagram" 或 "@ID • Instagram"
      const twitterTitleMeta = this._meta('meta[name="twitter:title"]');
      if (twitterTitleMeta) {
        const content = twitterTitleMeta.trim();

        // 情况1: 格式为 "東森新聞 (@news.ebc) • Instagram Reels"
        const fullMatch = content.match(/^(.+?)\s*\(@([a-zA-Z0-9_.]+)\)\s*•/);
        if (fullMatch && fullMatch[1]) {
          const nickname = fullMatch[1].trim();
          return nickname;
        }

        // 情况2: 格式为 "@news.ebc • Instagram Reels"（只有ID，无昵称）
        const idOnlyMatch = content.match(/^@([a-zA-Z0-9_.]+)\s*•/);
        if (idOnlyMatch && idOnlyMatch[1]) {
          // 备用选择：提取作者ID作为昵称
          const authorId = idOnlyMatch[1];
          return authorId;
        }
      }

      // 策略2: 仅快拍(Stories)页无 twitter:title，回退读 og:title / <title>
      // 展示名嵌在本地化模板句中，例如中文「趁 <名> 的这条快拍还没消失，速来 Instagram 围观！」
      // 作用域限定在快拍页，避免影响帖子/Reels 等其它页面类型
      if (this.isStoriesPage()) {
        const titleCandidates = [];
        const ogTitleMeta = this._meta('meta[property="og:title"]');
        if (ogTitleMeta) {
          titleCandidates.push(ogTitleMeta.trim());
        }
        if (document.title && document.title.trim()) {
          titleCandidates.push(document.title.trim());
        }
        for (const title of titleCandidates) {
          const nickname = this.extractDisplayNameFromStoryTitle(title);
          if (nickname) {
            return nickname;
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取作者昵称时出错:', error);
    }
    return '';
  }

  /**
   * 桥节点里按作者 username 取显示名（v2.7.21）
   *
   * 只认 `findProfile(username).fullName`；该账号还没被钩子收录时，再看这条作品的
   * media 行（钩子给每条作品也存了作者的 full_name）。都取不到就返回空 —— 绝不猜。
   *
   * @param {Document} context
   * @returns {string}
   */
  _igBridgeNickname(context = document) {
    try {
      const src = (typeof window !== 'undefined') ? window.InstagramInlineData : null;
      if (!src) return '';
      const username = this.extractAuthorName(context);
      if (!username) return '';

      if (typeof src.findProfile === 'function') {
        const p = src.findProfile(username);
        if (p && typeof p.fullName === 'string' && p.fullName.trim()) return p.fullName.trim();
      }
      if (typeof src.findMedia === 'function' && typeof src.shortcodeFromLocation === 'function') {
        const code = src.shortcodeFromLocation();
        const m = code ? src.findMedia(code) : null;
        if (m && typeof m.fullName === 'string' && m.fullName.trim()) return m.fullName.trim();
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  /**
   * 从快拍(Stories)页面的标题模板句中解析作者展示名
   * 不同语言模板不同，这里覆盖中英文常见形态（英文为 best-effort，依真实样本可微调）
   * @param {string} title - 页面标题（og:title 或 <title> 内容，浏览器已解码）
   * @returns {string} 作者展示名，失败返回空字符串
   */
  extractDisplayNameFromStoryTitle(title) {
    if (!title) return '';
    try {
      // 中文模板：趁 <名> 的这条快拍还没消失，速来 Instagram 围观！
      const zhMatch = title.match(/趁\s*([\s\S]*?)\s*的这条快拍/);
      if (zhMatch && zhMatch[1] && zhMatch[1].trim()) {
        return zhMatch[1].trim();
      }
      // 英文模板（best-effort）：IG 英文快拍标题通常以名字开头，如 "X's story" / "X's story on Instagram"
      const enMatch = title.match(/^([\s\S]+?)'s\s+(?:story|stories)/i);
      if (enMatch && enMatch[1] && enMatch[1].trim()) {
        return enMatch[1].trim();
      }
      // 英文兜底："X on Instagram: ..."
      const enMatch2 = title.match(/([\s\S]+?)\s+on\s+Instagram/i);
      if (enMatch2 && enMatch2[1] && enMatch2[1].trim() && !/instagram/i.test(enMatch2[1].trim())) {
        return enMatch2[1].trim();
      }
    } catch (e) {
      console.error('[InstagramSocialExtractor] 解析 Stories 标题展示名失败:', e);
    }
    return '';
  }

  // ==================== Reels页面专用提取方法 ====================

  /**
   * 从Reels页面提取作者昵称
   * Reels页面的DOM结构与普通帖子不同，需要专门的处理逻辑
   * @returns {string} 作者昵称
   */
  extractAuthorNameFromReels(context = document) {
    try {
      // 策略0（v2.7.6）：页面自带数据块里**当前这一条**的 user.username。
      //
      // 下面的策略1~3 全都在读 meta，而沉浸流里 meta 永远是首屏那一条的（切条不更新）——
      // 真机实测：地址已到 /reels/Dd2jVDvOhoc/、正文已是 kariina.choi，
      // meta 还写着上一条 → 作者ID 卡死在第一条上。所以 meta 只能当兜底。
      const inlineItem = this._reelsInlineItem();
      if (inlineItem && inlineItem.username) {
        return inlineItem.username;
      }

      // 策略1: 从meta标签的twitter:title中提取
      // 格式: "Francisca Nabinho (@franciscanabinho) • Instagram Reels"
      const twitterTitle = this._meta('meta[property="twitter:title"]');
      if (twitterTitle) {
        const content = twitterTitle;
        // 提取括号中的用户名
        const usernameMatch = content.match(/@([a-zA-Z0-9_.]+)/);
        if (usernameMatch && usernameMatch[1]) {
          return usernameMatch[1];
        }
      }

      // 策略2: 从og:url中提取作者用户名
      // 格式: "https://www.instagram.com/franciscanabinho/reel/DMyBUzrsebP/"
      const ogUrl = this._meta('meta[property="og:url"]');
      if (ogUrl) {
        const url = ogUrl;
        // 从URL中提取用户名
        const urlMatch = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)\/reel/);
        if (urlMatch && urlMatch[1]) {
          return urlMatch[1];
        }
      }

      // 策略3: 从og:title中提取
      // 格式: "Instagram 用户 Francisca Nabinho : \"文案内容\""
      const ogTitle = this._meta('meta[property="og:title"]');
      if (ogTitle) {
        const content = ogTitle;
        // 尝试提取用户名（格式可能是 "Instagram 用户 Username : ..."）
        const userMatch = content.match(/Instagram\s+用户\s+([a-zA-Z0-9_.]+)/i);
        if (userMatch && userMatch[1]) {
          return userMatch[1];
        }
      }

      // 策略4: 从页面DOM中查找作者链接
      // Reels页面的作者链接格式: /username/
      const allLinks = context.querySelectorAll('a[href^="/"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && /^\/[a-zA-Z0-9_.]+\/?$/.test(href)) {
          const username = href.replace(/^\//, '').replace(/\/$/, '');
          // 排除一些特殊路径
          if (!['reels', 'reel', 'p', 'explore', 'accounts', 'direct', 'stories'].includes(username)) {
            // 检查链接是否包含作者相关的类名
            if (link.className.includes('_a6hd') || link.className.includes('notranslate')) {
              return username;
            }
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] Reels: 提取作者昵称时出错:', error);
    }
    return '';
  }

  /**
   * 从Reels页面提取发布日期
   * Reels页面的日期信息通常在meta标签中
   * @returns {string} 发布日期
   */
  extractPublishDateFromReels(context = document) {
    try {
      // ========== 策略0（v2.7.5，Reels 沉浸流的唯一可靠来源）：网页自带数据块 ==========
      // 真机实测（2026-10-30，用户已登录 Edge，连切 3 条）：`/reels/<code>/` 上
      //   · og:* / twitter:* meta 全空（SPA 只换 DOM，不换 <head>）
      //   · <time> 元素 0 个，也没有「3天前 / 2026年10月5日」这类可见时间文本
      // → 下面策略1、策略2 必然双双落空，发布日期恒空。
      // 但页面渲染用的 <script> 数据块里有 `{code, taken_at}`，而且**切条时会跟着更新**，
      // 按当前地址里的作品编号精确匹配就能拿到 —— 纯读页面已有的数据，不发任何请求。
      const inlineTs = this._takenAtFromInlineData();
      if (inlineTs) {
        // taken_at 是 Unix 秒；new Date() 按本机时区换算，与 IG 页面显示一致
        const inlineDate = this.formatDateToSlash(new Date(inlineTs * 1000));
        if (inlineDate) {
          return inlineDate;
        }
      }

      // 策略1: 从description或og:description meta标签中提取
      // 格式: "62 likes, 3 comments - franciscanabinho，July 31, 2025 : \"文案内容\""
      const metaDescription = this._meta('meta[name="description"], meta[property="og:description"]');
      if (metaDescription) {
        const content = metaDescription;
        // 匹配英文日期格式: "July 31, 2025" 或 "Jan 1, 2024"
        const dateMatch = content.match(/([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/);
        if (dateMatch && dateMatch[1]) {
          // 转换为斜杠日期格式 YYYY/MM/DD
          const formattedDate = this.formatEnglishDateToSlash(dateMatch[1]);
          if (formattedDate) {
            return formattedDate;
          }
        }
      }

      // 策略2: 查找页面中的time元素
      const timeElements = context.querySelectorAll('time');
      for (const time of timeElements) {
        const datetime = time.getAttribute('datetime');
        if (datetime) {
          const date = new Date(datetime);
          if (!isNaN(date.getTime())) {
            const formattedDate = this.formatDateToSlash(date);
            return formattedDate;
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] Reels: 提取发布日期时出错:', error);
    }
    return '';
  }

  /**
   * 从网页自带的 <script> 数据块里取当前作品的发布时间（Unix 秒）
   *
   * 只在本机读页面已经渲染出来的数据，不发起任何请求（详见 instagram-inline-data.js 头注释）。
   * 取不到就返回 null，交给调用方继续走原来的回退策略 —— 新来源只加分，不抢失败权。
   *
   * @returns {number|null} Unix 秒时间戳
   */
  _takenAtFromInlineData() {
    const item = this._reelsInlineItem();
    if (item && item.takenAt) return item.takenAt;
    // 兜底：数据块不是合法 JSON（JSON.parse 那条路会跳过）时，走 findTakenAt 里的正则扫描。
    // 两条路都读同一份页面数据，只是找法不同。
    try {
      const src = (typeof window !== 'undefined') ? window.InstagramInlineData : null;
      if (!src || typeof src.findTakenAt !== 'function') return null;
      const code = (typeof src.shortcodeFromLocation === 'function') ? src.shortcodeFromLocation() : null;
      if (!code) return null;
      const ts = src.findTakenAt(code);
      return (typeof ts === 'number' && isFinite(ts) && ts > 0) ? ts : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Reels 沉浸流「当前这一条」的一手数据（v2.7.6）
   *
   * 为什么非要有它：沉浸流里 `og:url` / `og:title` / `twitter:title` 这些 meta
   * **永远是首屏那一条的**，切到下一条不会更新。真机实测（2026-10-30）：
   * 地址已变成 `/reels/Dd2jVDvOhoc/`、页面正文已换成 kariina.choi，
   * 但 meta 还写着上一条 yaoyanhuozongfx —— 于是「作者ID / 作者昵称 / URL」
   * 三格全部停在第一条上，只有用地址算出来的日期跟得上。
   *
   * 所以 Reels 的这几个字段统一改走「地址里的编号 → 页面自带数据块里的 media 节点」
   * （`{code, taken_at, user:{username, full_name}}`），切条时数据块会跟着更新。
   * 取不到时返回 null，各字段自己回退到原来的 meta / DOM 策略。
   *
   * @returns {{code:string, takenAt:number|null, username:string, fullName:string}|null}
   */
  _reelsInlineItem() {
    try {
      const src = (typeof window !== 'undefined') ? window.InstagramInlineData : null;
      if (!src || typeof src.findMedia !== 'function') return null;
      const code = (typeof src.shortcodeFromLocation === 'function') ? src.shortcodeFromLocation() : null;
      if (!code) return null;
      const m = src.findMedia(code);
      if (!m) return null;
      return {
        code,
        takenAt: (typeof m.takenAt === 'number' && isFinite(m.takenAt) && m.takenAt > 0) ? m.takenAt : null,
        username: (m.username || '').trim(),
        fullName: (m.fullName || '').trim(),
        caption: (m.caption || '').trim(),
        // 「这条到底有没有文案」是否已知（v2.7.8）。只有接口/数据块明确回答过才是 true；
        // 为 true 且 caption 为空 = 这条真的没写文案，绝不能再往下抓 DOM/meta（那是上一条的残留）。
        captionKnown: m.captionKnown === true
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Reels 沉浸流：取**当前屏幕上那一条**的文案（v2.7.7）
   *
   * 三条排除规则，全部来自真机实测（2026-10-30，用户已登录 Edge，真实滚动）：
   *   ① 屏幕外跳过 —— 沉浸流把上一条仍留在 DOM 里，按文档顺序取第一个 = 永远取到旧条；
   *   ② 被 `<a>` 包住的跳过 —— 音频行（`/reels/audio/…`）、地点行（`/explore/locations/…`）、
   *      作者名（`/<user>/reels/`）都包在链接里，而**正文行没有任何链接外壳**。
   *      实测音频行与正文行同用 `span.xuxw1ft`，只靠类名分不开；
   *   ③ 切掉「… 更多」折叠尾巴。
   *
   * 优先取「叶子 span」（正文那一行），没有叶子候选时才放宽到任意 span。
   * 多个候选取**最长**的（正文一定比「关注」「查看翻译」这类 UI 文案长）。
   *
   * @returns {string} 取不到返回空串（交给后面的通用兜底策略）
   */
  _reelsCaptionInView() {
    try {
      if (typeof document === 'undefined' || !document.querySelectorAll) return '';
      const spans = document.querySelectorAll('span.xuxw1ft');
      if (!spans || !spans.length) return '';

      const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
      const all = [];

      for (const s of spans) {
        if (s.closest && s.closest('a')) continue;               // 规则②：音频/地点/作者名
        let t = (s.textContent || '').trim();
        if (!t) continue;
        t = t.replace(/(?:…\s*)?更多\s*$/, '').trim();            // 规则③：折叠尾巴
        if (!t || t.length < 2) continue;
        if (/^(查看翻译|查看原文|回复|分享|关注|已关注|更多)$/.test(t)) continue;

        const r = s.getBoundingClientRect ? s.getBoundingClientRect() : null;
        const hasGeom = !!(r && r.width > 0 && r.height > 0);
        // 拿不到几何信息（jsdom 等）时留 null，表示「本条无法判位置」
        const inView = hasGeom ? (r.bottom > 0 && (!vh || r.top < vh)) : null;
        all.push({ t, inView, isLeaf: !(s.children && s.children.length) });
      }
      if (!all.length) return '';

      // 规则①：只要有任何一条能量出位置，就只认屏幕内的（屏幕外的都是滑走的旧条目）；
      // 全都量不出位置时才退化为不按位置过滤，避免在无布局环境里一律取空。
      const measurable = all.some((x) => x.inView !== null);
      const pool = measurable ? all.filter((x) => x.inView) : all;
      if (!pool.length) return '';

      const pick = (arr) => arr.reduce((a, b) => (b.t.length > a.t.length ? b : a), arr[0]);
      const leaves = pool.filter((x) => x.isLeaf);
      return (leaves.length ? pick(leaves) : pick(pool)).t || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 从Reels页面提取文案内容
   * @returns {string} 文案内容
   */
  extractPageTextFromReels(context = document) {
    try {
      // ========== 策略0（v2.7.7，最可靠）：页面自己取回来的**未折叠全文** ==========
      // 沉浸流上文案有三重坑：① 被「… 更多」折叠 ② 音频行/地点行与文案行共用样式类
      // ③ 滑走的旧条目还留在 DOM 上（取第一个必然拿到旧条）。页面自己向服务器要的数据里
      // 带完整文案（`caption.text`），且能用地址里的作品编号精确对上，不受这三坑影响。
      //
      // v2.7.8：命中就是**定案**，包括「这条没有文案」这个结论。
      // 旧写法只在有文案时才 return，于是「接口明确说没文案」会继续往下走策略1~4 ——
      // 而那几条来源全是上一条/首屏第一条的残留（真机实测：siumai_l0v3r 这条没文案，
      // 浮窗却显示了上一条的「Summer and red are a match made in heaven!」）。
      // 返回空串后由装配器按老规矩填「Instagram帖子」，不把别人的文案记到这条作品上。
      const inlineItem = this._reelsInlineItem();
      if (inlineItem && inlineItem.captionKnown) {
        if (inlineItem.caption) return this.cleanPostCaption(inlineItem.caption);
        return '';
      }
      if (inlineItem && inlineItem.caption) {
        return this.cleanPostCaption(inlineItem.caption);
      }

      // 策略1: 从og:description中提取文案
      const ogDescription = this._meta('meta[property="og:description"]');
      if (ogDescription) {
        const content = ogDescription;
        const textMatch = content.match(/:\s*"([^"]+)"/);
        if (textMatch && textMatch[1]) {
          const text = textMatch[1].replace(/\\n/g, '\n').trim();
          if (/^[a-zA-Z0-9]+$/.test(text) && text.length < 50) {
          } else {
            return text;
          }
        }
      }

      // 策略2: 收集页面中所有 hashtag 链接及其**共同父容器**的完整 textContent
      // Reels 正文常为：标题 + 英文/日文段落 + 大量 hashtag 链接。所有这些都在同一容器内。
      // 仅取 hashtag 文本会漏掉 body 段落，因此取 hashtag 父容器的完整 textContent。
      const tagLinks = context.querySelectorAll('a[href*="/explore/tags/"]');
      if (tagLinks.length >= 2) {
        const firstLink = tagLinks[0];
        const container = firstLink.parentElement;
        if (container) {
          // 取容器完整 textContent（包含 body + hashtag + 时间/翻译按钮等）
          const fullText = container.textContent || '';
          if (fullText.trim().length > 15) {
            // 简单压缩连续空白/换行
            const cleaned = fullText.replace(/\s+/g, ' ').trim();
            return cleaned;
          }
        }
      }

      // 策略3: 当前**屏幕上那一条**的文案（v2.7.7 重写）
      // 旧写法 `querySelectorAll('span.x6ikm8r.x10wlt62.xuxw1ft')` 取全文档第一个 —— 沉浸流里
      // 滑走的旧条目仍留在 DOM 上，于是永远命中第一条（真机实测：连切 3 条，文案纹丝不动）。
      // 而且音频行（包在 `<a href="/reels/audio/…">` 里）、地点行（`/explore/locations/…`）
      // 与文案行共用同一个样式类，会被一并抓进来 —— 实测把「Carter Burwell · Bella's Lullaby」
      // 当成了文案。新规则：① 只看屏幕内的 ② 排除被 <a> 包住的 ③ 切掉「… 更多」尾巴。
      const inViewCaption = this._reelsCaptionInView();
      if (inViewCaption) {
        return inViewCaption;
      }

      // 策略4: 通用 DOM 树遍历（兼容 og:description 未更新的 SPA 导航）
      // Reels SPA 切换时 og:* meta 不更新，但正文仍渲染在可见 DOM 中。
      // 排除评论 <ul> 和按钮后，取最长的可见文本作为文案。
      const genericText = this._extractVisibleTextFromPage(context);
      if (genericText) {
        return genericText;
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] Reels: 提取文案时出错:', error);
    }
    return '';
  }

  /**
   * 通用 DOM 可见文本提取。
   * 遍历文档所有文本节点，排除 <ul>（评论列表）和 <button>（真按钮标签），
   * 收集所有有效文本后，取其中**最长的**一条作为文案（正文通常比 UI 文本长）。
   * 兼容 SPA 导航后 og:description 未更新的情况。
   * 注意：不拒绝 role="button" 祖先节点——IG 大量元素（头像、点赞、verified 徽章等）
   * 都带此属性，过严会把正文 DOM 一并排除。
   */
  _extractVisibleTextFromPage(context = document) {
    try {
      // 不排除 <ul>！IG 常把正文放在评论 <ul> 的第一个 <li> 里。
      // 按文档顺序取第一条有效文本（正文总在评论区上方）。
      const walker = document.createTreeWalker(context, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          let p = node.parentElement;
          while (p && p !== context) {
            if (p.tagName === 'BUTTON') return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.textContent || '').trim();
        if (!text || text.length < 8) continue;
        if (/^[\d.,k万]+$/.test(text)) continue;
        if (/^https?:\/\//.test(text)) continue;
        if (/^(查看翻译|查看更多|回复|转发|分享|收藏|赞|评论|已验证|更多|发送|返回|下一步|发布|表情)$/.test(text)) continue;
        if (/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]+$/u.test(text)) continue;
        if (/^[a-zA-Z0-9_.]+$/u.test(text)) continue;
        if (/^[\d小时分钟前:/-]+$/.test(text)) continue;
        // 过滤 Reels 个人资料统计（"X 位粉丝 已关注 Y 人 · Z 篇帖子 · 查看 ... 的 Instagram 照片和视频。"）——
        // 这段文本在文档顺序上排在正文之前，必须排除，否则会误把作者简介当正文。
        if (/位粉丝|已关注|篇帖子|查看.+的 Instagram/.test(text)) continue;
        return text;
      }
      return '';
    } catch (e) { return ''; }
  }

  /**
   * 将英文日期格式转换为斜杠格式 YYYY/MM/DD
   * @param {string} englishDate - 英文日期，如 "July 31, 2025"
   * @returns {string} 斜杠日期，如 "2025/07/31"，无法解析返回 ''
   */
  formatEnglishDateToSlash(englishDate) {
    try {
      const months = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4,
        'May': 5, 'June': 6, 'July': 7, 'August': 8,
        'September': 9, 'October': 10, 'November': 11, 'December': 12,
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4,
        'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9,
        'Oct': 10, 'Nov': 11, 'Dec': 12
      };

      // 解析日期格式: "July 31, 2025" 或 "Jul 31, 2025"
      const match = englishDate.match(/([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
      if (match) {
        const month = months[match[1]];
        const day = parseInt(match[2], 10);
        const year = parseInt(match[3], 10);
        
        if (month && day && year) {
          return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
        }
      }
    } catch (error) {
      console.error('[InstagramSocialExtractor] 日期格式转换失败:', error);
    }
    return '';
  }

  /**
   * 将任意可解析的日期输入统一格式化为斜杠格式 YYYY/MM/DD（与 TikTok 等社交平台对齐）
   * 支持的输入：Date 对象、ISO 字符串、"2026/06/24"、"2026年6月24日"、
   *            "June 24, 2026"、相对时间 "1天前"/"2周前"/"3小时前"/"昨天" 等
   * @param {Date|string} input - 日期对象或日期字符串
   * @returns {string} 形如 "2026/06/24"，无法解析返回 ''
   */
  formatDateToSlash(input) {
    try {
      if (input === null || input === undefined || input === '') return '';

      let date = null;
      if (input instanceof Date) {
        date = input;
      } else {
        const text = String(input).trim();
        if (!text) return '';

        // 相对时间优先折算为绝对日期
        const relativeDate = this.parseRelativeToDate(text);
        if (relativeDate) {
          return this.formatDateToSlash(relativeDate);
        }

        // 中文日期 "2026年6月24日" → "2026-6-24"，其余格式直接交给 Date 解析
        const normalized = text
          .replace(/年/g, '-')
          .replace(/月/g, '-')
          .replace(/日/g, '')
          .trim();
        date = new Date(normalized);
      }

      if (date && !isNaN(date.getTime())) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}/${m}/${d}`;
      }
    } catch (error) {
      console.error('[InstagramSocialExtractor] 日期格式化失败:', error);
    }
    return '';
  }

  /**
   * 将中文/英文相对时间文本解析为绝对 Date（基于当前时间）
   * @param {string} text - 相对时间文本，如 "1天前"、"2周前"、"3小时前"、"昨天"
   * @returns {Date|null} 绝对日期，无法识别返回 null
   */
  parseRelativeToDate(text) {
    try {
      const t = String(text).trim();
      const now = new Date();

      // 关键词相对时间
      if (t === '刚刚' || t === '现在' || t.includes('今天')) return new Date(now);
      if (t === '昨天') { const d = new Date(now); d.setDate(d.getDate() - 1); return d; }
      if (t === '前天') { const d = new Date(now); d.setDate(d.getDate() - 2); return d; }

      // 数值相对时间：X秒/分钟/小时/天/周/个月/月/年前
      const relMatch = t.match(/^(\d+)\s*(秒|分钟|小时|天|周|个月|月|年)\s*前$/);
      if (relMatch) {
        const n = parseInt(relMatch[1], 10);
        const unit = relMatch[2];
        const d = new Date(now);
        switch (unit) {
          case '秒': d.setSeconds(d.getSeconds() - n); break;
          case '分钟': d.setMinutes(d.getMinutes() - n); break;
          case '小时': d.setHours(d.getHours() - n); break;
          case '天': d.setDate(d.getDate() - n); break;
          case '周': d.setDate(d.getDate() - n * 7); break;
          case '个月':
          case '月': d.setMonth(d.getMonth() - n); break;
          case '年': d.setFullYear(d.getFullYear() - n); break;
        }
        return d;
      }
    } catch (error) {
      console.error('[InstagramSocialExtractor] 相对时间解析失败:', error);
    }
    return null;
  }

  // ==================== Stories快拍页面专用提取方法 ====================

  /**
   * 从Stories快拍页面提取作者昵称（即用户名）
   * Stories页面的URL格式：/stories/{username}/{storyId}/ 或 /stories/highlights/{highlightId}/
   * 区别于Reels和普通帖子，Stories页面的DOM结构非常简洁，主要依赖URL和meta标签提取
   * @returns {string} 作者昵称（用户名），失败返回空字符串
   */
  extractAuthorNameFromStories(context = document) {
    try {
      // ============================================
      // 策略1: 从当前页面URL中提取作者用户名（最可靠）
      // Stories URL格式: /stories/{username}/{storyId}/
      // 注意：/stories/highlights/{id}/ 是精选集页面，没有具体用户名
      // ============================================
      const pathname = window.location.pathname;
      // 匹配 /stories/username/ 格式，排除 /stories/highlights/ 精选集
      const urlMatch = pathname.match(/^\/stories\/(?!highlights\/)([a-zA-Z0-9_.]+)\//);
      if (urlMatch && urlMatch[1]) {
        const username = urlMatch[1];
        return username;
      }

      // ============================================
      // 策略2: 从og:url meta标签中提取作者用户名
      // og:url格式: https://www.instagram.com/stories/{username}/{storyId}/
      // ============================================
      const ogUrlElement = this._meta('meta[property="og:url"]');
      if (ogUrlElement) {
        const ogUrl = ogUrlElement.trim();
        // 匹配 og:url 中的 username 部分（排除 highlights）
        const ogUrlMatch = ogUrl.match(/instagram\.com\/stories\/(?!highlights\/)([a-zA-Z0-9_.]+)\//);
        if (ogUrlMatch && ogUrlMatch[1]) {
          const username = ogUrlMatch[1];
          return username;
        }
      }

      // ============================================
      // 策略3: 从og:title或twitter:title meta标签中提取
      // Stories页面的og:title格式通常为: "Username on Instagram: \"文案内容\""
      // 或 twitter:title 格式: "Username (@username) on Instagram"
      // ============================================
      const titleMeta = this._meta('meta[property="og:title"]')
                     || this._meta('meta[name="twitter:title"]');
      if (titleMeta) {
        const content = titleMeta;
        // 尝试匹配 @username 格式
        const atMatch = content.match(/@([a-zA-Z0-9_.]+)/);
        if (atMatch && atMatch[1]) {
          const username = atMatch[1];
          return username;
        }
        // 尝试匹配 "Username on Instagram" 格式
        const onMatch = content.match(/^([a-zA-Z0-9_.]+)\s+on\s+Instagram/i);
        if (onMatch && onMatch[1]) {
          const username = onMatch[1];
          return username;
        }
      }

      // ============================================
      // 策略4: 从页面DOM中查找作者链接（备用方案）
      // Stories页面可能在顶部显示作者链接，格式为 /username/
      // ============================================
      const allLinks = context.querySelectorAll('a[href^="/"]:not([href^="//"])');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        // 匹配 /username/ 格式，排除特殊路径
        if (href && /^\/[a-zA-Z0-9_.]+\/?$/.test(href)) {
          const username = href.replace(/^\//, '').replace(/\/$/, '');
          // 排除已知的系统路径
          if (!['reels', 'reel', 'p', 'explore', 'accounts', 'direct', 'stories', 'highlights'].includes(username)) {
            // 检查链接是否包含作者相关的类名标记
            if (link.className.includes('_a6hd') || link.className.includes('notranslate') ||
                link.getAttribute('role') === 'link') {
              return username;
            }
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] Stories: 提取作者昵称时出错:', error);
    }
    return '';
  }

  /**
   * 从Stories快拍页面提取作者主页链接
   * Stories页面没有标准的作者链接DOM元素，主要通过meta标签和用户名拼接获取
   * @returns {string} 作者主页URL，失败返回空字符串
   */
  extractStoriesAuthorHomepage() {
    try {
      // ============================================
      // 策略1: 从og:url meta标签提取作者主页
      // og:url格式: https://www.instagram.com/stories/{username}/{storyId}/
      // 提取出: https://www.instagram.com/{username}/
      // ============================================
      const ogUrlElement = this._meta('meta[property="og:url"]');
      if (ogUrlElement) {
        const ogUrl = ogUrlElement.trim();
        // 匹配 /stories/{username}/ 部分，排除 highlights
        const match = ogUrl.match(/^(https?:\/\/www\.instagram\.com)\/stories\/(?!highlights\/)([a-zA-Z0-9_.]+)\//);
        if (match && match[1] && match[2]) {
          const homepage = `${match[1]}/${match[2]}/`;
          return homepage;
        }
      }

      // ============================================
      // 策略2: 从当前URL路径中提取作者用户名后拼接主页
      // 适用于 /stories/{username}/{storyId}/ 格式
      // ============================================
      const pathname = window.location.pathname;
      const urlMatch = pathname.match(/^\/stories\/(?!highlights\/)([a-zA-Z0-9_.]+)\//);
      if (urlMatch && urlMatch[1]) {
        const homepage = `https://www.instagram.com/${urlMatch[1]}/`;
        return homepage;
      }

      // ============================================
      // 策略3: 从twitter:title或og:title提取@username后拼接
      // 格式: "Username (@username) on Instagram" 或包含 @username
      // ============================================
      const titleMeta = this._meta('meta[name="twitter:title"]')
                     || this._meta('meta[property="og:title"]');
      if (titleMeta) {
        const content = titleMeta;
        const atMatch = content.match(/@([a-zA-Z0-9_.]+)/);
        if (atMatch && atMatch[1]) {
          const homepage = `https://www.instagram.com/${atMatch[1]}/`;
          return homepage;
        }
      }

      // ============================================
      // 策略4: 调用作者昵称提取方法，使用返回的用户名拼接主页
      // ============================================
      const authorName = this.extractAuthorNameFromStories();
      if (authorName) {
        const homepage = `https://www.instagram.com/${authorName}/`;
        return homepage;
      }

      return '';
    } catch (error) {
      console.error('[InstagramSocialExtractor] Stories: 提取作者主页时出错:', error);
      return '';
    }
  }

  /**
   * 从Stories快拍页面提取发布日期
   * Stories页面的时间信息较少，通常需要从DOM或meta标签中寻找
   * @returns {string} 发布日期（中文格式：YYYY年MM月DD日），失败返回空字符串
   */
  extractPublishDateFromStories(context = document) {
    try {
      // ============================================
      // 策略0（Stories Highlights 专用）：从可见 DOM 读取日期
      // Stories Highlights 页 og:* 在切故事时不会更新，必须从可见 DOM 读取。
      // 标题栏形如 "highlights 2019年10月5日 7:56"，日期通常在用户名后。
      // ============================================
      const visibleDateMatch = this._extractStoriesDateFromVisibleDom(context);
      if (visibleDateMatch) {
        return visibleDateMatch;
      }

      // ============================================
      // 策略1: 查找页面中的time元素（最标准的方式）
      // Stories页面有时会显示发布时间，通常在time标签中
      // ============================================
      const timeElements = context.querySelectorAll('time');
      for (const time of timeElements) {
        // 优先从datetime属性提取ISO格式日期
        const datetime = time.getAttribute('datetime');
        if (datetime) {
          try {
            const date = new Date(datetime);
            if (!isNaN(date.getTime())) {
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          } catch (dateError) {
            console.error('[InstagramSocialExtractor] Stories: 解析time元素日期时出错:', dateError);
          }
        }
        // 从title属性提取（通常包含完整日期）
        const titleAttr = time.getAttribute('title');
        if (titleAttr) {
          const slashDate = this.formatDateToSlash(titleAttr);
          if (slashDate) {
            return slashDate;
          }
        }
      }

      // ============================================
      // 策略2: 从og:description或description meta标签中提取日期
      // Stories页面的description有时包含发布时间，如 "July 31, 2025"
      // ============================================
      const descMeta = this._meta('meta[property="og:description"]')
                     || this._meta('meta[name="description"]');
      if (descMeta) {
        const content = descMeta;
        // 匹配英文日期格式: "July 31, 2025" 或 "Jul 31, 2025"
        const dateMatch = content.match(/([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/);
        if (dateMatch && dateMatch[1]) {
          const formattedDate = this.formatEnglishDateToSlash(dateMatch[1]);
          if (formattedDate) {
            return formattedDate;
          }
        }
      }

      // ============================================
      // 策略3: 查找包含日期格式的span元素
      // Stories页面可能在UI上显示相对时间或绝对时间
      // ============================================
      const allSpans = context.querySelectorAll('span');
      for (const span of allSpans) {
        const text = span.textContent?.trim();
        if (!text || text.length === 0) continue;

        // 检查是否包含中文日期格式
        if (/\d{4}年\d{1,2}月\d{1,2}日/.test(text)) {
          const slashDate = this.formatDateToSlash(text);
          if (slashDate) {
            return slashDate;
          }
        }
        // 检查是否是相对时间格式（例如：1 天前、2 小时前、2 周前）
        if (/^\d+\s*[天月年]?\s*前$/.test(text) || /^\d+\s*[小时分钟秒]?\s*前$/.test(text) || /^\d+\s*周?\s*前$/.test(text)) {
          // 确保这个span在日期相关区域
          const isInDateArea = span.closest('time') || span.closest('a[role="link"]');
          if (isInDateArea) {
            const slashDate = this.formatDateToSlash(text);
            if (slashDate) {
              return slashDate;
            }
          }
        }
      }

      // ============================================
      // 策略4: 从meta标签中提取日期（备用方案）
      // 查找所有包含date关键字的meta标签
      // ============================================
      const metaTags = this._qa('meta[property*="date"], meta[name*="date"]');
      for (const meta of metaTags) {
        const content = meta.getAttribute('content');
        if (content) {
          try {
            const date = new Date(content);
            if (!isNaN(date.getTime())) {
              const formattedDate = this.formatDateToSlash(date);
              return formattedDate;
            }
          } catch (dateError) {
            console.error('[InstagramSocialExtractor] Stories: 解析meta标签日期时出错:', dateError);
          }
        }
      }

    } catch (error) {
      console.error('[InstagramSocialExtractor] Stories: 提取发布日期时出错:', error);
    }
    return '';
  }

  /**
   * 从 Stories Highlights 可见 DOM 读取当前故事的发布日期。
   * Highlights 页 og:* meta 在切故事时不会更新，必须从可见 UI（标题栏 "用户名 日期 时间"）读取。
   * 匹配 "YYYY年M月D日 HH:MM" 或 "YYYY年M月D日"。
   * @returns {string} 形如 "YYYY/MM/DD"，找不到返回 ''
   */
  _extractStoriesDateFromVisibleDom(context = document) {
    try {
      // 1) 找 time 元素的 textContent（标题栏时间）
      const timeEls = context.querySelectorAll('time');
      for (const t of timeEls) {
        const txt = (t.textContent || '').trim();
        const m = txt.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m) return `${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`;
      }
      // 2) 扫所有可见叶子元素，找中文日期格式
      const all = context.querySelectorAll('span, div, p, h1, h2');
      for (const el of all) {
        if (el.children.length > 0) continue;
        const txt = (el.textContent || '').trim();
        // 必须含中文日期，且不能超过 60 字符（避免命中长文本节点）
        const m = txt.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
        if (m && txt.length < 60) {
          return `${m[1]}/${String(m[2]).padStart(2,'0')}/${String(m[3]).padStart(2,'0')}`;
        }
      }
    } catch (e) { /* 静默 */ }
    return '';
  }

  /**
   * 提取Stories快拍页面的规范化URL
   * 优先从og:url meta标签读取标准URL，兜底使用当前页面URL
   * Stories页面URL格式: https://www.instagram.com/stories/{username}/{storyId}/
   * @returns {string} 规范化后的URL，失败返回空字符串
   */
  extractStoriesUrl() {
    try {
      // ============================================
      // 首选方案：从og:url meta标签读取标准URL
      // ============================================
      const ogUrlElement = this._meta('meta[property="og:url"]');
      if (ogUrlElement) {
        const ogUrl = ogUrlElement.trim();
        // 验证URL格式是否符合Stories页面的预期格式
        if (ogUrl && /^https?:\/\/www\.instagram\.com\/stories\/[a-zA-Z0-9_.]+\/[a-zA-Z0-9_-]+\/?$/.test(ogUrl)) {
          return ogUrl;
        }
        // 也支持 highlights 格式: /stories/highlights/{id}/
        if (ogUrl && /^https?:\/\/www\.instagram\.com\/stories\/highlights\/[a-zA-Z0-9_-]+\/?$/.test(ogUrl)) {
          return ogUrl;
        }
      }

      // ============================================
      // 兜底方案：使用当前页面URL
      // ============================================
      const currentUrl = window.location.href;
      return currentUrl;
    } catch (error) {
      console.error('[InstagramSocialExtractor] Stories: 提取URL时出错:', error);
      return window.location.href;
    }
  }

  /**
   * 提取所有字段
   * @returns {Object} 包含所有字段的对象
   */
  async extractAllFields(opts = {}) {
    const url = window.location.href;
    const context = opts.context || document;
    // 记录 Modal 作用域，供 _q/_qa 在后续子方法中使用（/p/ 独立页时 context===document，行为不变）
    this._activeContext = context;

    // ========== 首页信息流「逐帖提取」（v2.7.35）==========
    // 入口：IG 首页每条帖子右上角的小按钮（`instagram-feed-buttons.js`）。
    // 作用域是**那一条 <article>**，形态与弹层/详情页都不一样：
    //   没有 <head>（og:* 全是首页的）、没有弹层的 h1 评论结构、作者链接层级也不一样。
    // 直接走下面的通用策略会捞到信息流别的内容，所以单独装配一份，取数只认
    // 「这条帖子的 DOM」+「桥节点里按作品编号存的接口数据」。
    if (opts.feedPost) {
      return await this._buildFeedPostRecord(context, opts.shortcode);
    }

    // 是否处于 Modal 内（博主主页 SPA 原地打开的帖子）：context 不是整个 document
    const inModal = context !== document;

    // 检测是否为Instagram Stories页面（使用统一的isStoriesPage方法）
    const storiesPage = this.isStoriesPage();

    // 提取本页文案
    // Stories 快拍页面固定显示占位文案「instagram快拍」（用户明确要求）。
    let contentText;
    if (storiesPage) {
      contentText = 'instagram快拍';
    } else {
      contentText = this.extractPageText(context);
    }

    // ========== URL处理逻辑 ==========
    // Modal 内：优先用 Modal 内帖子永久链接或 watcher 解析的 shortcode 拼 URL
    // （主页 <head> 的 og:url 仍是博主主页，不能用于 Modal 帖子）
    // ⚠️ Modal 内含多种链接：音频 (/reels/audio/)、评论 (/p/CODE/c/ID/)、
    //   帖子永久链接 (/p/CODE/)。必须过滤掉音频和评论，只取帖子自身的永久链接。
    let finalUrl;
    if (inModal) {
      const candidates = context.querySelectorAll('a[href*="/p/"], a[href*="/reel"], a[href*="/reels/"], a[href*="/stories/"]');
      let permalink = null;
      for (const a of candidates) {
        const href = a.getAttribute('href') || '';
        // 跳过音频链接 (/reels/audio/...) 和评论硬链接 (/p/CODE/c/ID/)
        if (/\/audio\//.test(href)) continue;
        if (/\/c\/\d+/.test(href)) continue;
        // v2.7.21：必须**整条就是作品永久链接**。
        // 弹层里还有 `/p/<code>/liked_by/`（点赞列表）、`/p/<code>/comments/` 这类同前缀链接，
        // 只判「含 /p/」会抢到它们 —— 真机实测存下来的网址是
        // `…/p/Dej2vAlDN0Q/liked_by/`，点开跳的是点赞列表而不是这条帖子。
        if (!/^\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels|tv)\/[A-Za-z0-9_-]{5,20}\/?$/.test(href)) continue;
        permalink = a;
        break;
      }
      if (permalink) {
        finalUrl = new URL(permalink.getAttribute('href'), window.location.origin).href;
      } else if (opts.shortcode) {
        finalUrl = 'https://www.instagram.com/p/' + opts.shortcode + '/';
      } else {
        finalUrl = url;
      }
    } else {
      finalUrl = url;

      // ========== Reels页面URL自定义处理 ==========
      // 仅在 /reels/xxx 或 /reel/xxx 页面生效，将URL转换为作者主页格式
      // 例如: https://www.instagram.com/reels/DbGS_znlakp/ → https://www.instagram.com/news.ebc/reel/DbGS_znlakp/
      if (this.isReelsPage()) {
        // 获取作者ID（即用户名）
        const authorId = this.extractAuthorName(context);
        // 生成自定义的Reels URL
        const reelsUrl = this.extractReelsUrl(authorId);
        if (reelsUrl) {
          finalUrl = reelsUrl;
        }
      }

      // ========== Stories快拍页面URL规范化处理 ==========
      // 仅在 /stories/xxx 页面生效，优先使用og:url作为标准URL
      // 其他类型页面（/p/xxx帖子、/username/个人主页等）保持原样
      if (storiesPage) {
        const storiesUrl = this.extractStoriesUrl();
        if (storiesUrl) {
          finalUrl = storiesUrl;
        }
      }
    }

    // 字段外壳由 SocialFieldsBuilder 套用统一模板生成；
    // Instagram 的取值都依赖 context 作用域（Modal 场景），因此全部通过 overrides 传入，取值逻辑保持原样。
    return await SocialFieldsBuilder.build(this, {
      overrides: {
        '本页标题': () => this.extractTitle(contentText, context),
        '作者ID': () => this.extractAuthorName(context), // 将作者昵称的提取逻辑转移到作者ID字段
        '作者昵称': () => this.extractAuthorNickname(context) || this.extractAuthorName(context), // 作用域化提取；Modal 内 head 为空时以 DOM 作者名兜底
        '作者主页': () => this.extractAuthorHomepage(context),
        '发布日期': () => this.extractPublishDate(context),
        '本页文案': () => contentText,
        'URL': () => finalUrl // 使用处理后的URL
      }
    });
  }

  /**
   * 首页信息流「逐帖提取」装配（v2.7.35）
   *
   * 触发方式：用户在首页某条帖子右上角点小按钮（`instagram-feed-buttons.js`）。
   * 参数 `article` 就是**那一条** `<article>` 节点，所有取值都限制在它里面 ——
   * 首页还有几十条别的帖子，作用域一旦跑丢就会张冠李戴。
   *
   * 取数来源与优先级
   * ----------------
   *   1. **桥节点** `InstagramInlineData.findMedia(编号)`：页面自己请求信息流时截下来的，
   *      带精确到秒的 `taken_at`、完整文案（没被「… 更多」折叠）、作者用户名与昵称。
   *   2. **这条帖子的 DOM**：桥节点没命中时（刚打开首页、钩子还没收到响应）用它兜底。
   *      注意页面上文案默认被「… 更多」截断，**我们不替用户点开**，就按显示的存。
   *
   * 三条纪律
   * --------
   *   · 认不出作者 / 编号 → 对应字段留空，不拿页面级 meta 凑（那是首页的，不是这条的）；
   *   · 接口明确说「这条没文案」（`captionKnown`）时**不许**再回头读 DOM ——
   *     否则会捞到别的帖子残留（v2.7.8 亲测踩过同类）；
   *   · 日期只认接口时间戳与这条帖子自己的 `<time>`，不按编号反解。
   *
   * @param {Element} article - 这一条帖子的 <article> 节点
   * @param {string} shortcode - 作品编号
   * @returns {Promise<Object>} 七字段（外加 mediaType / sourceSite）
   */
  async _buildFeedPostRecord(article, shortcode) {
    this._activeContext = article;
    const code = String(shortcode || '');
    const inline = this._feedInlineMedia(code);
    const author = (inline && inline.username) || this._feedAuthorFromArticle(article);
    const nickname = (inline && inline.fullName) || author;
    const caption = this._feedCaption(article, inline);
    const date = this._feedDate(article, inline);
    const pageUrl = code ? ('https://www.instagram.com/p/' + code + '/') : window.location.href;

    return await SocialFieldsBuilder.build(this, {
      overrides: {
        // v2.7.38：标题改走统一入口 `extractTitle()`，不再在这里内联拼。
        //
        // 为什么必须绕这一道：装配器在「文案为空 / 文案被标题过滤器洗光」时，
        // 会把兜底词塞进 `extractTitle` 的**第一个参数**再重跑一次，用站名顶上
        // （`一支花Instagram帖子-2026年10月31日`）。内联拼的话这一招够不着 ——
        // 这正是 v2.7.35~v2.7.37 期间标题一直写着「无文案」的根因。
        //
        // 昵称/账号/日期来自桥节点（首页没有弹层 DOM 可读），通过 `meta` 传进去；
        // 传的值与原来内联调用完全相同，所以正常路径的标题**逐字不变**。
        '本页标题': () => this.extractTitle(caption, article, {
          authorName: nickname,
          authorId: author,
          publishDate: date
        }),
        '作者ID': author,
        '作者昵称': nickname,
        '作者主页': author ? ('https://www.instagram.com/' + author + '/') : '',
        '发布日期': date,
        '本页文案': caption,
        'URL': pageUrl
      }
    });
  }

  /**
   * 从桥节点按作品编号取这一条的接口数据。
   * 取不到返回 null（调用方退回 DOM），**绝不猜一个空对象**。
   * @param {string} code
   * @returns {{takenAt:number|null, username:string, fullName:string, caption:string, captionKnown:boolean}|null}
   */
  _feedInlineMedia(code) {
    try {
      if (!code) return null;
      const api = (typeof InstagramInlineData !== 'undefined')
        ? InstagramInlineData
        : (typeof window !== 'undefined' ? window.InstagramInlineData : null);
      if (!api || typeof api.findMedia !== 'function') return null;
      return api.findMedia(code) || null;
    } catch (e) {
      return null;
    }
  }

  /** IG 的一级路由段：这些不是用户名（同 `instagram-inline-data.js` 的保留字表） */
  _feedIsReservedName(name) {
    return /^(?:p|reel|reels|tv|stories|highlights|explore|locations|tags|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads|audio)$/i.test(name);
  }

  /**
   * 从这条帖子里取作者用户名（只认**单段**链接 `/<username>/`）。
   *
   * 为什么只认单段：信息流里还有 `/p/<code>/`（作品自身）、`/explore/tags/…`（话题）、
   * `/explore/locations/…`（地点），它们都是多段，一刀切掉比逐个排雷可靠。
   * 真机上第一条匹配到的单段链接就是头像/用户名的链接，所以按文档顺序取第一个即可。
   *
   * @param {Element} article
   * @returns {string} 取不到返回空串
   */
  _feedAuthorFromArticle(article) {
    try {
      const links = article.querySelectorAll('a[href^="/"]');
      for (const a of links) {
        const href = (a.getAttribute('href') || '').split('?')[0].replace(/\/+$/, '');
        const m = /^\/([A-Za-z0-9_.]{1,30})$/.exec(href);
        if (!m) continue;
        if (this._feedIsReservedName(m[1])) continue;
        return m[1];
      }
    } catch (e) {
      /* 取不到就返回空串，不抛 */
    }
    return '';
  }

  /**
   * 取这一条的文案。
   *
   * 顺序：接口/数据块全文 → 页面（可能被「… 更多」截断）→ 空。
   * `captionKnown === true` 且正文为空 = **接口明确说这条没文案**，此时直接返回空串，
   * 不许再往下读 DOM（页面里那段可能是上一条的残留）。
   *
   * DOM 兜底的优先顺序是**真机挨个验过的**（2026-11-01，首页 7 条帖子全过一遍）：
   *   ① `span._ap3a._aaco._aacu._aacx._aad7._aade` —— IG 的正文容器，7/7 全中；
   *   ② 「更多」锚点向上找容器 —— 只在文案被折叠时存在，能中 3/3；
   *   ③ 最长 `span[dir="auto"]` —— 最后兜底，**真机上会取到评论/点赞行**
   *      （实测 7 条里有 2 条取成了「imean.youknow和其他465位用户赞了」），
   *      所以只在前两条都落空时用，属于「有总比没有强」的档。
   *
   * @param {Element} article
   * @param {Object|null} inline
   * @returns {string}
   */
  _feedCaption(article, inline) {
    if (inline && inline.captionKnown) {
      return String(inline.caption || '').trim();
    }
    try {
      // ① 正文容器（真机 7/7 命中）
      const byClass = article.querySelector('span._ap3a._aaco._aacu._aacx._aad7._aade');
      if (byClass) {
        const t = this._stripMoreTail(byClass.textContent || '');
        if (t) return t;
      }

      // ② 「更多」锚点：向上爬到「明显比『更多』两个字长」的祖先，就是正文容器
      const moreEl = this._feedMoreNode(article);
      if (moreEl) {
        let cur = moreEl;
        const baseLen = (moreEl.textContent || '').trim().length;
        for (let k = 0; k < 6 && cur && cur !== article; k++) {
          if ((cur.textContent || '').trim().length > baseLen + 6) break;
          cur = cur.parentElement;
        }
        if (cur && cur !== article) {
          const t = this._stripMoreTail(cur.textContent || '');
          if (t) return t;
        }
      }

      // ③ 最后兜底：最长的 span[dir="auto"]（排除按钮里的文字）
      let best = '';
      const spans = article.querySelectorAll('span[dir="auto"]');
      for (const span of spans) {
        if (span.closest('button')) continue;
        const t = (span.textContent || '').trim();
        if (t.length > best.length) best = t;
      }
      return this._stripMoreTail(best);
    } catch (e) {
      return '';
    }
  }

  /**
   * 找「更多 / … 更多 / ... more」那个节点（只认**内容全是这几个字**的节点，
   * 避免把正文里恰好出现「更多」二字的地方当成展开按钮）。
   * @param {Element} article
   * @returns {Element|null}
   */
  _feedMoreNode(article) {
    try {
      const nodes = article.querySelectorAll('span, div');
      for (const el of nodes) {
        const t = (el.textContent || '').trim();
        if (!t || t.length > 8) continue;
        if (/^(?:\u2026|\.\.\.)?\s*(?:更多|more)$/i.test(t)) return el;
      }
    } catch (e) {
      /* 找不到就返回 null，交给下一档 */
    }
    return null;
  }

  /**
   * 去掉页面上的「展开提示」尾巴。
   *
   * 信息流里长文案会被截断，紧跟一个「… 更多」/「... more」的按钮文字，
   * 用 `textContent` 读会把它们一并读进来。这里只切尾巴，正文一个字不动。
   * @param {string} text
   * @returns {string}
   */
  _stripMoreTail(text) {
    let t = String(text || '').trim();
    // 末尾可能是「… 更多」「... 更多」「… more」「...more」「更多」
    t = t.replace(/(?:\u2026|\.\.\.)\s*(?:更多|more)\s*$/i, '');
    t = t.replace(/\s+更多\s*$/, '');
    return t.trim();
  }

  /**
   * 取这一条的发布日期（`YYYY/MM/DD`，与全站同一格式）。
   *
   * 优先接口时间戳（精确到秒，格式只显示到日）；其次这条帖子自己的 `<time datetime>`；
   * 最后才用 `<time>` 里的相对文本（`2 天前`）折算。
   * 三步都只在这个 `<article>` 里找 —— 页面级 meta 是首页的，不是这条的。
   *
   * @param {Element} article
   * @param {Object|null} inline
   * @returns {string}
   */
  _feedDate(article, inline) {
    if (inline && inline.takenAt) {
      const s = this.formatDateToSlash(new Date(inline.takenAt * 1000));
      if (s) return s;
    }
    try {
      const timeEl = article.querySelector('time');
      if (timeEl) {
        const dt = timeEl.getAttribute('datetime');
        if (dt) {
          const s = this.formatDateToSlash(new Date(dt));
          if (s) return s;
        }
        const s2 = this.formatDateToSlash((timeEl.textContent || '').trim());
        if (s2) return s2;
      }
    } catch (e) {
      /* 取不到就留空 */
    }
    return '';
  }

  /**
   * 提取Reels页面的自定义URL
   * 优先从 meta property="og:url" 标签直接读取Instagram自带的标准URL
   * 兜底方案：如果og:url不存在，再用拼接方式生成
   * 例如: https://www.instagram.com/reels/DbGS_znlakp/ → https://www.instagram.com/news.ebc/reel/DbGS_znlakp/
   * 仅供Reels页面使用，其他页面不应调用此方法
   * @param {string} authorId - 作者ID（即用户名，如 "news.ebc"），仅在兜底方案中使用
   * @returns {string} 转换后的URL，如果转换失败则返回空字符串
   */
  extractReelsUrl(authorId) {
    try {
      // 策略0（v2.7.6）：用「地址里的编号 + 数据块里的作者」拼标准地址。
      // 为什么必须排在 og:url 前面：沉浸流里 og:url **永远是首屏那一条**，
      // 而且格式完全合规（`/用户名/reel/<编号>/`），下面那条格式校验拦不住它 ——
      // 切条后 URL 就一直是第一条的。
      const inlineItem = this._reelsInlineItem();
      if (inlineItem && inlineItem.username && inlineItem.code) {
        return `https://www.instagram.com/${inlineItem.username}/reel/${inlineItem.code}/`;
      }

      // ============================================
      // 首选方案：直接从 meta property="og:url" 标签读取
      // 这是Instagram页面自带的标准URL，无需自行拼接
      // ============================================
      const ogUrlElement = this._meta('meta[property="og:url"]');
      if (ogUrlElement) {
        const ogUrl = ogUrlElement.trim();

        // 验证URL格式是否符合预期：https://www.instagram.com/{username}/reel/{reelId}/
        // 这个格式与Instagram作者ID提取时使用的格式一致，确保数据来源的可靠性
        if (ogUrl && /^https?:\/\/www\.instagram\.com\/[a-zA-Z0-9_.]+\/reel\/[a-zA-Z0-9_-]+\/?$/.test(ogUrl)) {
          return ogUrl;
        } else {
        }
      }

      // ============================================
      // 兜底方案：如果og:url不存在或格式异常，使用拼接方式
      // ============================================

      // 防御性检查：作者ID必须存在且格式合法
      if (!authorId || typeof authorId !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(authorId)) {
        return '';
      }

      // 从当前URL中提取reel ID
      // 兼容 /reels/xxx（复数）和 /reel/xxx（单数）两种格式
      const currentUrl = window.location.href;
      const match = currentUrl.match(/\/reels?\/([a-zA-Z0-9_-]+)/);
      if (!match || !match[1]) {
        return '';
      }

      const reelId = match[1];
      // 构建新的URL格式：https://www.instagram.com/{authorId}/reel/{reelId}/
      // 注意：这里用单数 reel（Instagram官方标准）
      const newUrl = `https://www.instagram.com/${authorId}/reel/${reelId}/`;
      return newUrl;
    } catch (error) {
      console.error('[InstagramSocialExtractor] 提取Reels URL时出错:', error);
      return '';
    }
  }

  /**
   * 提取特定字段
   * @param {Array<string>} fieldNames - 要提取的字段名称数组
   * @returns {Object} 包含指定字段的对象
   */
  async extractSpecificFields(fieldNames) {
    const allFields = await this.extractAllFields();
    const result = {};
    
    fieldNames.forEach(fieldName => {
      if (allFields.hasOwnProperty(fieldName)) {
        // @ts-ignore - 动态属性访问
        result[fieldName] = allFields[fieldName];
      }
    });
    
    return result;
  }
}

// 注册提取器到全局作用域
if (typeof window !== 'undefined') {
  // @ts-ignore - 添加全局属性
  window.InstagramSocialExtractor = InstagramSocialExtractor;
}
