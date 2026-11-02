class BilibiliSocialExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'bilibili_social';
    this.mediaType = 'social';
    this.isSocialPlatform = true;
  }

  /**
   * 从页面 JSON-LD 结构化数据中提取视频信息
   * B 站主站页面在 <script type="application/ld+json"> 中嵌入了完整的视频元数据
   * 这是最稳定可靠的数据来源（不受 DOM 结构调整影响），同时包含作者ID、日期、名称等
   */
  _readVideoJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const json = JSON.parse(script.textContent);
        if (!json) continue;

        // 直接作为 VideoObject
        if (json['@type'] === 'VideoObject') return json;

        // 作为 WebPage，找 @graph 中的 VideoObject
        if (json['@type'] === 'WebPage' && Array.isArray(json['@graph'])) {
          const video = json['@graph'].find(x => x['@type'] === 'VideoObject');
          if (video) return video;
        }

        // 作为 WebPage，找 mainEntity
        if (json['@type'] === 'WebPage' && json.mainEntity && json.mainEntity['@type'] === 'VideoObject') {
          return json.mainEntity;
        }
      }
    } catch (e) {
      console.warn('[BilibiliSocialExtractor] JSON-LD 解析失败:', e.message);
    }
    return null;
  }

  /**
   * 将 ISO 日期字符串转为本地时间格式 "YYYY/MM/DD HH:mm:ss"
   */
  _formatISODate(isoStr) {
    try {
      const date = new Date(isoStr);
      if (isNaN(date.getTime())) return null;
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      const h = String(date.getHours()).padStart(2, '0');
      const min = String(date.getMinutes()).padStart(2, '0');
      const s = String(date.getSeconds()).padStart(2, '0');
      return `${y}/${m}/${d} ${h}:${min}:${s}`;
    } catch (e) {
      return null;
    }
  }

  extractAuthorName() {
    // 策略1：从 JSON-LD 获取（最可靠，有结构化数据就不会错）
    const ld = this._readVideoJsonLd();
    if (ld && ld.author && ld.author.name) {
      return ld.author.name.trim();
    }

    // 策略2：从 meta name="author" 获取
    try {
      const metaAuthor = SocialDomUtils.readMeta('meta[name="author"]');
      if (metaAuthor) {
        return metaAuthor.trim();
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略3：从 DOM 选择器获取（旧方案兜底）
    try {
      const selectors = [
        '.up-name',
        '.up-info__name',
        '.author-name',
        '.user-name',
        '[data-name]',
        '.up-name-text'
      ];

      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  extractAuthorId() {
    // 策略1：从 JSON-LD 获取（最可靠）
    const ld = this._readVideoJsonLd();
    if (ld && ld.author) {
      // 从 @id 提取：https://space.bilibili.com/697812672#person → 697812672
      if (ld.author['@id']) {
        const match = ld.author['@id'].match(/(\d+)/);
        if (match) return match[1];
      }
      // 从 url 提取：https://space.bilibili.com/697812672 → 697812672
      if (ld.author.url) {
        const match = ld.author.url.match(/space\.bilibili\.com\/(\d+)/);
        if (match) return match[1];
      }
    }

    // 策略2：从 .up-name 链接的 href 中提取（旧方案，改用正确的正则）
    try {
      // 直接查 up-info 区域的链接（主视频作者的链接在页面主体中）
      const upCategories = [
        '.up-name',
        '.up-info a[href*="space.bilibili.com/"]',
        '#up-info a[href*="space.bilibili.com/"]',
        '.up-detail-top a[href*="space.bilibili.com/"]'
      ];
      for (const selector of upCategories) {
        const el = document.querySelector(selector);
        if (el && el.href) {
          const match = el.href.match(/space\.bilibili\.com\/(\d+)/);
          if (match) return match[1];
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略3：从 .up-info 容器内找所有 bilibili 空间链接，取第一个纯数字 ID
    try {
      const upInfo = document.querySelector('.up-info');
      if (upInfo) {
        const links = upInfo.querySelectorAll('a[href*="space.bilibili.com/"]');
        for (const link of links) {
          if (link.href) {
            const match = link.href.match(/space\.bilibili\.com\/(\d+)/);
            if (match) return match[1];
          }
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  extractAuthorHomepage() {
    // 策略1：从 JSON-LD 获取
    const ld = this._readVideoJsonLd();
    if (ld && ld.author && ld.author.url) {
      return ld.author.url;
    }

    // 策略2：从 .up-name 链接获取
    try {
      const upCategories = [
        '.up-name',
        '.up-info a[href*="space.bilibili.com/"]',
        '#up-info a[href*="space.bilibili.com/"]'
      ];
      for (const selector of upCategories) {
        const el = document.querySelector(selector);
        if (el && el.href) return el.href;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略3：从 .up-info 容器内查找
    try {
      const upInfo = document.querySelector('.up-info');
      if (upInfo) {
        const link = upInfo.querySelector('a[href*="space.bilibili.com/"]');
        if (link && link.href) return link.href;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  extractPublishDate() {
    // 策略1：从 JSON-LD 获取日期并转为本地时间（最可靠）
    const ld = this._readVideoJsonLd();
    if (ld) {
      const dateStr = ld.datePublished || ld.uploadDate;
      if (dateStr) {
        const formatted = this._formatISODate(dateStr);
        if (formatted) return formatted;
      }
    }

    // 策略2：从 meta property="video:release_date" 获取
    try {
      const meta = SocialDomUtils.readMeta('meta[property="video:release_date"]');
      if (meta) {
        const formatted = this._formatISODate(meta);
        if (formatted) return formatted;
        return meta.replace(/-/g, '/');
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略3：从 meta[itemprop="uploadDate"] 获取
    try {
      const meta = SocialDomUtils.readMeta('meta[itemprop="uploadDate"]');
      if (meta) {
        const formatted = this._formatISODate(meta);
        if (formatted) return formatted;
        return meta.replace(/-/g, '/');
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 注意：不使用 document.querySelector('#pubdate')
    // 因为页面中同一 id 出现 30+ 次（相关视频卡片），取到的不是主视频日期
    return '';
  }

  /**
   * 提取本页文案（视频标题，不是简介说明）
   * 用户要求：B 站的「本页文案」应填充视频标题，而非下面的简介文字
   */
  extractPageText() {
    // 策略1：从 JSON-LD name 字段获取（纯标题，无后缀）
    const ld = this._readVideoJsonLd();
    if (ld && ld.name) {
      return ld.name.trim();
    }

    // 策略2：从 og:title 获取（带 "_哔哩哔哩_bilibili" 后缀，需要清理）
    try {
      const ogTitle = SocialDomUtils.readMeta('meta[property="og:title"]');
      if (ogTitle) {
        let title = ogTitle.trim();
        // 去掉尾部 " - 哔哩哔哩_bilibili" 或 " _哔哩哔哩_bilibili" 等后缀
        title = title.replace(/[_-]\s*哔哩哔哩[-_]bilibili\s*$/i, '').trim();
        if (title) return title;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略3：从 <title> 标签获取（带后缀，需要清理）
    try {
      const title = document.title;
      if (title) {
        let cleanTitle = title.trim();
        cleanTitle = cleanTitle.replace(/[_-]\s*哔哩哔哩[-_]bilibili\s*$/i, '').trim();
        if (cleanTitle) return cleanTitle;
        return title;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 策略4：从 DOM 中的视频标题元素获取
    try {
      const h1Title = document.querySelector('.video-title, h1.video-title, .video-info-title');
      if (h1Title && h1Title.textContent.trim()) {
        return h1Title.textContent.trim();
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  extractUrl() {
    try {
      return window.location.href;
    } catch (error) {
      console.error('[BilibiliSocialExtractor] 提取URL失败:', error);
      return '';
    }
  }

  async extractTitle() {
    try {
      const authorName = this.extractAuthorName();
      const authorId = this.extractAuthorId();
      const pageText = this.extractPageText();
      const publishDate = this.extractPublishDate();

      return SocialTitleProcessor.generatePageTitle(authorName, pageText, publishDate, {
        platform: 'bilibili'
      }, authorId);
    } catch (error) {
      console.error('[BilibiliSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }

  async extractAllFields() {
    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }
}

window.BilibiliSocialExtractor = BilibiliSocialExtractor;
