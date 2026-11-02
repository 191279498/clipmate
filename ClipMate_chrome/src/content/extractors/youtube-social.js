/**
 * YouTube社交媒体信息提取器
 * 遵循统一社交媒体提取器标准实现
 */

class YouTubeSocialExtractor extends BaseExtractor {
  constructor() {
    super();
    // 核心属性配置
    this.platform = 'youtube';
    this.mediaType = 'social';
    this.isSocialPlatform = true;
    this.supportedDomains = ['youtube.com', 'www.youtube.com'];
    this.siteName = 'youtube_social';
  }

  /**
   * 判断是否适用于当前页面
   * @returns {boolean} 是否适用于当前页面
   */
  /**
   * 提取所有字段 - 统一接口方法（核心方法）
   * @returns {Promise<Object>} 提取的字段对象
   */
  async extractAllFields() {
    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }

  /**
   * 是否为 Shorts 页面
   * @returns {boolean}
   */
  _isShortsPage() {
    return window.location.href.includes('/shorts/');
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
      const publishDate = this.extractPublishDate();
      const content = this.extractContent();

      // 使用共享标题处理器生成组合标题
      return SocialTitleProcessor.generatePageTitle(authorName, content, publishDate, {
        platform: 'youtube'
      }, authorId);
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取标题失败:', error);
      return document.title;
    }
  }

  /**
   * 提取作者ID
   * Shorts 与常规页面的差异只是「优先查哪个链接」，取法与解析完全一致，
   * 因此按原有先后顺序排列候选选择器，依次尝试。
   * @returns {string} 作者ID
   */
  extractAuthorID() {
    try {

      const candidates = this._isShortsPage()
        ? [
            // Shorts 优先：频道栏中的 /@ 链接
            '.ytReelChannelBarViewModelChannelName a[href*="/@"]',
            'ytd-channel-name yt-formatted-string a[href*="/@"]'
          ]
        : [
            'ytd-channel-name yt-formatted-string a[href*="/@"]'
          ];

      for (const selector of candidates) {
        const el = document.querySelector(selector);
        if (!el) continue;

        const href = el.getAttribute('href');
        if (!href) continue;

        // 提取@符号后的部分，支持URL编码的中文字符
        const authorIdMatch = href.match(/\/(@.+)/);
        if (!authorIdMatch || !authorIdMatch[1]) continue;

        // 移除@符号
        let authorId = authorIdMatch[1].replace('@', '');

        // URL解码（处理%XX格式的中文字符）
        try {
          authorId = decodeURIComponent(authorId);
          return authorId;
        } catch (decodeError) {
          return authorId;
        }
      }

      ClipMateLog.debug('[YouTubeSocialExtractor] 作者ID提取失败，返回空值');
      return '';
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取作者ID失败:', error);
      return '';
    }
  }

  /**
   * 提取作者昵称
   * 候选选择器按原有先后顺序排列（Shorts 通道栏 → 频道名称 → 作者信息 → 订阅按钮）
   * @returns {string} 作者昵称
   */
  extractAuthorName() {
    try {

      const candidates = [];

      if (this._isShortsPage()) {
        // Shorts 优先：频道栏，需要去掉昵称前的 @
        candidates.push({
          selector: '.ytReelChannelBarViewModelChannelName a[href*="/@"]',
          stripAt: true
        });
      }

      candidates.push(
        // 方法1: 从频道名称元素中提取
        { selector: 'ytd-channel-name yt-formatted-string a, ytd-video-owner-renderer ytd-channel-name a' },
        // 方法2: 从视频标题下方的作者信息中提取
        { selector: '#owner-name a, ytd-video-owner-renderer #channel-name a' },
        // 方法3: 从订阅按钮附近的文本中提取
        { selector: '#subscribe-button yt-formatted-string', stripSubscribe: true }
      );

      for (const candidate of candidates) {
        const el = document.querySelector(candidate.selector);
        if (!el || !el.textContent) continue;

        let name = el.textContent.trim();

        if (candidate.stripAt) {
          // 移除@符号前缀
          name = name.replace('@', '');
        }
        if (candidate.stripSubscribe) {
          name = name.replace('订阅', '').trim();
        }

        return name;
      }

      ClipMateLog.debug('[YouTubeSocialExtractor] 作者昵称提取失败，返回空值');
      return '';
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取作者昵称失败:', error);
      return '';
    }
  }

  /**
   * 提取作者主页
   * 依次尝试：Shorts 头部链接 → 频道链接 → 用作者ID构建 → 页面内其他链接
   * @returns {string} 作者主页
   */
  extractAuthorHomepage() {
    try {

      const isShorts = this._isShortsPage();
      const YOUTUBE_ORIGIN = 'https://www.youtube.com';

      // 1) Shorts 页面专属：头部作者链接
      if (isShorts) {
        const headerLink = document.querySelector('reel-player-header-renderer a[href*="/@"]');
        if (headerLink) {
          const href = headerLink.getAttribute('href');
          if (href) {
            const fullUrl = SocialDomUtils.absoluteUrl(href, YOUTUBE_ORIGIN);
            return fullUrl;
          }
        }
      }

      // 2) 频道链接（两种页面共用）
      //
      //    真机 2026-10-31 实证：新版视频页的频道名链接是 `/@taishengding`，
      //    老代码只找 `a[href*="/channel/"]` → 一条都匹配不到 → 必然走下面第 3 步兜底。
      //    这里两条都认：先 `/channel/UC…`（UC 形态最稳，账号改名它不变），再 `/@handle`。
      const channelLink =
        document.querySelector(
          'ytd-channel-name a[href*="/channel/"], ytd-video-owner-renderer a[href*="/channel/"]'
        ) ||
        document.querySelector(
          'ytd-channel-name a[href*="/@"], ytd-video-owner-renderer a[href*="/@"],' +
          ' ytd-channel-name yt-formatted-string a[href*="/@"]'
        );
      if (channelLink) {
        const href = channelLink.getAttribute('href');
        if (href) {
          const fullUrl = SocialDomUtils.absoluteUrl(href, YOUTUBE_ORIGIN);
          return fullUrl;
        }
      }

      // 3) 用作者ID构建主页 —— **按 ID 形态分流，不按页面类型分流**
      //
      //    v2.7.24 修正（真机 2026-10-31 实证）：新版视频页的频道名链接是 `/@handle`，
      //    上面第 2 步只找 `a[href*="/channel/"]` 会**全部落空**，于是必然落到这里。
      //    而 `extractAuthorID()` 现在给的也是 handle（`taishengding`），
      //    老代码按「非 Shorts 就拼 /channel/」会得到 `/channel/taishengding` —— **404 打不开**。
      //    改成看 ID 本身：`UC…` 才是频道ID，其余都是 @账号名。
      const authorId = this.extractAuthorID();
      if (authorId) {
        const isChannelId = /^UC[A-Za-z0-9_-]{10,40}$/.test(authorId);
        const homepageUrl = isChannelId
          ? `${YOUTUBE_ORIGIN}/channel/${authorId}`
          : `${YOUTUBE_ORIGIN}/@${authorId}`;
        return homepageUrl;
      }

      // 4) 页面中的其他作者链接
      const authorLinks = document.querySelectorAll('a[href*="/c/"], a[href*="/@"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        if (href && !href.includes('/watch') && !href.includes('/results')) {
          const fullUrl = SocialDomUtils.absoluteUrl(href, YOUTUBE_ORIGIN);
          return fullUrl;
        }
      }

      ClipMateLog.debug('[YouTubeSocialExtractor] 作者主页提取失败，返回空值');
      return '';
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取作者主页失败:', error);
      return '';
    }
  }

  /**
   * 读取发布日期的原始字符串
   * Shorts 与常规页面查的是完全相同的三个来源，统一在一处按原顺序查找：
   *   datePublished meta → uploadDate meta → ld+json 的 uploadDate
   * @param {string} tag - 日志前缀（Shorts / 空）
   * @returns {string} 原始日期字符串，取不到返回 ''
   */
  _readPublishDateRaw(tag) {
    const prefix = '[YouTubeSocialExtractor] ' + (tag || '');

    // 策略1: meta[itemprop="datePublished"]
    const datePublished = SocialDomUtils.readMeta('meta[itemprop="datePublished"]');
    if (datePublished) {
      return datePublished;
    }

    // 策略2: meta[itemprop="uploadDate"]
    const uploadDate = SocialDomUtils.readMeta('meta[itemprop="uploadDate"]');
    if (uploadDate) {
      return uploadDate;
    }

    // 策略3: 结构化数据 script[type="application/ld+json"] 的 uploadDate
    const structuredDataScript = document.querySelector('script[type="application/ld+json"]');
    if (structuredDataScript) {
      try {
        const jsonData = JSON.parse(structuredDataScript.textContent);
        if (jsonData && jsonData.uploadDate) {
          return jsonData.uploadDate;
        }
      } catch (jsonError) {
        console.error(prefix + '解析结构化数据失败:', jsonError);
      }
    }

    return '';
  }

  /**
   * 提取发布日期
   * @returns {string} 发布日期
   */
  extractPublishDate() {
    try {

      // Shorts 与常规页面的三个日期来源完全相同，统一调用同一个读取流程；
      // 分支判断保留在 tag 上，只为日志可读，不改变任何取值顺序。
      const tag = this._isShortsPage() ? 'Shorts' : '';
      const dateString = this._readPublishDateRaw(tag);

      // 如果提取到日期字符串，格式化为YYYY/MM/DD HH:mm:ss格式
      if (dateString) {
        try {
          // 解析ISO 8601格式日期（如：2025-06-22T05:57:10-07:00）
          const date = new Date(dateString);
          if (!isNaN(date.getTime())) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');

            const formattedDate = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
            return formattedDate;
          }
        } catch (formatError) {
          console.error('[YouTubeSocialExtractor] 日期格式化失败:', formatError);
        }
      }

      return '';
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取发布日期失败:', error);
      return '';
    }
  }

  /**
   * 提取本页文案
   * @returns {string} 本页文案
   */
  extractContent() {
    try {

      // YouTube Shorts页面专用策略
      if (this._isShortsPage()) {

        const contentParts = [];

        // Shorts策略1~3: 视频标题（专用标题元素 → og:title → meta title，按序取第一个可用的）
        let headText = '';
        const shortsTitleElement = document.querySelector('.ytShortsVideoTitleViewModelShortsVideoTitle span[role="text"]');
        if (shortsTitleElement && shortsTitleElement.textContent) {
          headText = shortsTitleElement.textContent.trim();
        } else {
          headText = SocialDomUtils.readMeta('og:title').trim()
            || SocialDomUtils.readMeta('meta[name="title"]').trim();
        }
        if (headText) {
          contentParts.push(headText);
        }

        // 从#snippet元素中提取内容
        const snippetElement = document.querySelector('#snippet');
        if (snippetElement && snippetElement.textContent) {
          const snippetContent = snippetElement.textContent.trim();
          // 确保不与现有内容重复
          if (!contentParts.includes(snippetContent)) {
            contentParts.push(snippetContent);
          }
        }

        // 合并所有内容部分
        if (contentParts.length > 0) {
          const mergedContent = contentParts.join('\n');
          return mergedContent;
        }
      }

      // 方法1: 从视频描述中提取
      const description = document.querySelector('#description-inline, #description, ytd-video-secondary-info-renderer #content');
      if (description && description.textContent) {
        const content = description.textContent.trim();
        return content;
      }

      // 方法2: 从标题中提取
      const titleElement = document.querySelector('h1.title, h1.style-scope.ytd-video-primary-info-renderer');
      if (titleElement && titleElement.textContent) {
        const title = titleElement.textContent.trim();
        return title;
      }

      // 方法3: 从页面主要内容中提取
      const mainContent = document.querySelector('#content #content-text, .content');
      if (mainContent && mainContent.textContent) {
        const content = mainContent.textContent.trim();
        return content;
      }

      ClipMateLog.debug('[YouTubeSocialExtractor] 本页文案提取失败，返回空值');
      return '';
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取本页文案失败:', error);
      return '';
    }
  }

  /* ==========================================================================
   * 「本页文案」专用取法（v2.5.54）：视频标题 + 视频介绍
   *
   * 下面这些方法只给「本页文案」字段用。字段装配器里「本页文案」的候选方法顺序是
   * extractPageText → extractContent → extractDescription，新增的 extractPageText
   * 会被优先命中；而「本页标题」走的是 extractTitle()，与这里没有交集。
   * extractTitle() / extractContent() 一行未改，因此「本页标题」的值不会变。
   * ========================================================================== */

  /**
   * 提取「本页文案」：视频标题 + 视频介绍
   *
   * 非视频页（首页 / 频道页 / 搜索页 / Shorts）一律回退到原 extractContent()，
   * 保证这些页面的取值与改动前逐字符一致。
   *
   * @returns {Promise<string>} 「标题 + 空行 + 简介」；简介为空时只返回标题
   */
  async extractPageText() {
    try {
      // Shorts 页：保持原取法，不参与本次改动
      if (this._isShortsPage()) return this.extractContent();

      // 只处理普通视频页（/watch）。频道页、首页、搜索页、直播页一律回退原取法，
      // 保证这些页面的取值与改动前逐字符一致。
      if (!this._isWatchPage()) return this.extractContent();

      const metadata = this._querySafe(document, 'ytd-watch-metadata');
      if (!metadata) return this.extractContent();

      const title = this._readVideoTitle(metadata);
      const description = await this._readVideoDescription(metadata);

      if (!description) return title;
      if (!title) return description;
      return title + '\n\n' + description;
    } catch (error) {
      console.error('[YouTubeSocialExtractor] 提取本页文案（标题+简介）失败，回退原取法:', error);
      return this.extractContent();
    }
  }

  /**
   * 是否为普通视频播放页（/watch?v=xxx）
   * 只认 URL 路径：实测频道页里也存在 ytd-watch-metadata，光靠 DOM 判断会误判。
   * @returns {boolean}
   */
  _isWatchPage() {
    try {
      return window.location.pathname === '/watch';
    } catch (error) {
      return false;
    }
  }

  /**
   * 读取视频标题
   * 实测：裸 h1 会命中页面顶部的隐藏图标区并返回空串，因此绝不使用裸 h1 选择器。
   * @param {Element|Document} root
   * @returns {string}
   */
  _readVideoTitle(root) {
    const scope = root || document;
    const candidates = [
      '#title h1 yt-formatted-string',
      '#title h1',
      'h1.title',
      'h1.style-scope.ytd-video-primary-info-renderer'
    ];

    for (const selector of candidates) {
      const el = this._querySafe(scope, selector);
      if (!el) continue;
      const text = this._collapseWhitespace(el.textContent);
      if (text) return text;
    }

    // 最后兜底：og:title
    try {
      if (typeof SocialDomUtils !== 'undefined' && SocialDomUtils.readMeta) {
        return this._collapseWhitespace(SocialDomUtils.readMeta('og:title'));
      }
    } catch (error) {
      ClipMateLog.debug('[YouTubeSocialExtractor] 读取 og:title 失败:', error && error.message);
    }
    return '';
  }

  /**
   * 读取视频介绍（多行文本）
   * 顺序：已展开的直接用（不收起）→ 点「…更多」取全文再收起 → 折叠摘要 → 留空
   *
   * 刻意不做 meta 兜底：实测站内跳转后 meta[name="description"] 仍是上一个视频的内容
   * （同一页面上的「发布日期」就踩了这个坑），拿过期数据比留空更糟。
   *
   * @param {Element|Document} root
   * @returns {Promise<string>}
   */
  async _readVideoDescription(root) {
    const scope = root || document;
    const expander = this._querySafe(scope, '#description-inline-expander')
      || this._querySafe(scope, '#description');
    if (!expander) return '';

    // ① 用户已经手动展开过：直接用，且不动页面状态
    const alreadyOpen = this._readExpandedText(expander);
    if (alreadyOpen) return alreadyOpen;

    // ② 有「…更多」按钮：点开 → 等渲染 → 取全文 → 收起还原
    const expandButton = this._findVisibleButton(expander, '#expand');
    if (expandButton) {
      let clicked = false;
      try {
        expandButton.click();
        clicked = true;
      } catch (error) {
        clicked = false;
      }

      if (clicked) {
        const fullText = await this._waitForExpandedText(expander, 1200);
        const collapseButton = this._findVisibleButton(expander, '#collapse');
        if (collapseButton) {
          try {
            collapseButton.click();
          } catch (error) {
            ClipMateLog.debug('[YouTubeSocialExtractor] 收起描述区失败:', error && error.message);
          }
        }
        if (fullText) return fullText;
      }
    }

    // ③ 没有展开按钮：简介本来就短，取折叠区里显示的那段
    const snippet = this._querySafe(expander, '#snippet-text');
    if (snippet) {
      const snippetText = this._readMultilineText(snippet);
      if (snippetText) return snippetText;
    }

    // ④ 都取不到：留空（绝不拿可能过期的 meta 或标题凑数）
    return '';
  }

  /**
   * 读取已展开区域（#expanded）的文本
   * @param {Element} expander
   * @returns {string}
   */
  _readExpandedText(expander) {
    const el = this._querySafe(expander, '#expanded');
    if (!el) return '';
    return this._readMultilineText(el);
  }

  /**
   * 点击展开后轮询等待 #expanded 出现内容
   * @param {Element} expander
   * @param {number} timeoutMs
   * @returns {Promise<string>} 超时返回空串（调用方会自行降级）
   */
  _waitForExpandedText(expander, timeoutMs) {
    const limit = typeof timeoutMs === 'number' ? timeoutMs : 1200;
    return new Promise((resolve) => {
      const deadline = Date.now() + limit;
      const tick = () => {
        const text = this._readExpandedText(expander);
        if (text) {
          resolve(text);
          return;
        }
        if (Date.now() >= deadline) {
          resolve('');
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  /**
   * 在容器内找第一个可见的按钮（同一容器里可能存在隐藏的同名按钮）
   * @param {Element} root
   * @param {string} selector
   * @returns {Element|null}
   */
  _findVisibleButton(root, selector) {
    if (!root) return null;
    let list = [];
    try {
      list = Array.from(root.querySelectorAll(selector));
    } catch (error) {
      list = [];
    }
    for (const el of list) {
      if (el.offsetWidth || el.offsetHeight) return el;
    }
    return list[0] || null;
  }

  /**
   * 安全查询单元素（选择器非法时返回 null，不抛错）
   * @param {Element|Document} root
   * @param {string} selector
   * @returns {Element|null}
   */
  _querySafe(root, selector) {
    if (!root) return null;
    try {
      return root.querySelector(selector);
    } catch (error) {
      return null;
    }
  }

  /**
   * 读取多行文本
   * 直接读 textContent 时 <br> 不产生换行，长简介会粘成一整行，
   * 因此优先用 innerText（浏览器渲染后带换行），取不到再按 <br> 手工切行。
   * @param {Element} el
   * @returns {string}
   */
  _readMultilineText(el) {
    if (!el) return '';

    let text = '';
    try {
      text = el.innerText || '';
    } catch (error) {
      text = '';
    }

    if (!text || !text.trim()) {
      text = this._textWithBreaks(el);
    }

    return this._normalizeMultiline(text);
  }

  /**
   * 按 <br> 与块级元素手工拼多行文本（innerText 不可用时的退路）
   * @param {Node} node
   * @returns {string}
   */
  _textWithBreaks(node) {
    if (!node) return '';
    const BLOCK_TAGS = ['P', 'DIV', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    let out = '';

    const walk = (n) => {
      if (!n) return;
      if (n.nodeType === 3) {
        out += n.nodeValue || '';
        return;
      }
      if (n.nodeType !== 1) return;

      const tag = String(n.tagName || '').toUpperCase();
      if (tag === 'BR') {
        out += '\n';
        return;
      }

      const isBlock = BLOCK_TAGS.indexOf(tag) !== -1;
      if (isBlock) out += '\n';
      const children = n.childNodes || [];
      for (let i = 0; i < children.length; i++) walk(children[i]);
      if (isBlock) out += '\n';
    };

    walk(node);
    return out;
  }

  /**
   * 多行文本归一：去掉行首行尾空格、连续空行压成一个、保住原有换行
   * @param {string} text
   * @returns {string}
   */
  _normalizeMultiline(text) {
    if (!text) return '';
    return String(text)
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 单行文本归一：所有空白压成一个空格
   * @param {string} text
   * @returns {string}
   */
  _collapseWhitespace(text) {
    if (!text) return '';
    return String(text).replace(/\s+/g, ' ').trim();
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
if (typeof window !== 'undefined') {
  window.YouTubeSocialExtractor = YouTubeSocialExtractor;
}
