/**
 * 微博移动版社交媒体信息提取器
 * 提取微博移动版页面的基本信息，与电脑版结构完全不同
 */

class WeiboMobileSocialExtractor extends BaseExtractor {
  /**
   * 构造函数
   */
  constructor() {
    super();
    this.siteName = 'weibo_mobile_social';
    this.mediaType = 'social'; // 标记为社交媒体类型
    this.isSocialPlatform = true; // 标记为社交媒体平台，启用统一规则
  }

  /**
   * 判断是否适用于当前页面
   * @returns {boolean} 是否适用于当前页面
   */
  /**
   * 提取本页标题 - 使用共享标题处理器
   *
   * @param {string} [pageText] - 文案。**逐帖提取（v2.7.39）时会传**，不传则自己去页面取。
   *        必须走参数：装配器「空文案 → 站名占位词」的兜底是靠替换本方法第一个参数
   *        来重写标题的，标题若在外面用闭包算，兜底就够不着（IG v2.7.37 的错法）。
   * @param {Object} [context] - 保留（与 IG 签名一致）
   * @param {Object} [meta] - 逐帖提取时由调用方给出 `{ nick, date, uid }`
   * @returns {Promise<string>} 本页标题
   */
  async extractTitle(pageText, context, meta) {
    try {
      const m = meta || {};
      const hasMeta = !!meta;
      const authorName = hasMeta ? (m.nick || m.uid || '') : this.extractAuthorName();
      const authorId = hasMeta ? (m.uid || '') : this.extractAuthorId();
      const text = (pageText !== undefined && pageText !== null)
        ? pageText
        : this.extractPageText();
      const publishDate = hasMeta ? (m.date || '') : this.extractPublishDate();

      // 使用共享标题处理器生成组合标题，传递platform参数
      return SocialTitleProcessor.generatePageTitle(authorName, text, publishDate, {
        platform: 'weibo'
      }, authorId);
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }

  /**
   * 提取作者昵称 - 根据示例页面结构，从m-text-box中的h3标签提取
   * @returns {string} 作者昵称
   */
  extractAuthorName() {
    try {
      // 主要策略：从m-text-box中的h3标签提取（根据示例代码段1）
      const mainSelectors = [
        '.m-text-box h3.m-text-cut',  // 主要选择器，匹配示例中的结构
        '.m-text-box h3',  // 备选选择器，m-text-box中的h3标签
        'h3.m-text-cut',  // 通用m-text-cut类
      ];

      // 尝试主要选择器
      for (const selector of mainSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          if (text && text.length > 0 && text.length < 50) {
            return text;
          }
        }
      }

      // 备选策略：从JavaScript配置中提取（根据示例代码段2）
      const scriptElements = document.querySelectorAll('script');
      for (const script of scriptElements) {
        const scriptText = script.textContent;
        if (scriptText.includes('screen_name')) {
          const match = scriptText.match(/"screen_name":\s*"([^"]+)"/);
          if (match && match[1]) {
            return match[1];
          }
        }
      }

      return '';
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取作者昵称失败:', error);
      return '';
    }
  }

  /**
   * 提取作者主页 - 基于已提取的作者ID生成标准网址格式
   * @returns {string} 作者主页URL
   */
  extractAuthorHomepage() {
    try {
      // 获取作者ID
      const authorId = this.extractAuthorId();

      // 如果成功提取到作者ID，生成标准格式的作者主页网址
      if (authorId && authorId.length > 0) {
        const homepageUrl = `https://weibo.com/u/${authorId}`;
        return homepageUrl;
      }

      return '';
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取作者主页失败:', error);
      return '';
    }
  }

  /**
   * 提取发布日期
   * @returns {string} 发布日期
   */
  extractPublishDate() {
    try {
      // 从JavaScript配置中提取发布日期
      const scriptElements = document.querySelectorAll('script');

      for (const script of scriptElements) {
        const scriptText = script.textContent;
        if (scriptText.includes('"status":') && scriptText.includes('"created_at":')) {
          // 匹配status.created_at字段，格式如："created_at": "Sat Sep 06 21:04:23 +0800 2025"
          const createdAtMatch = scriptText.match(/"created_at":\s*"([^"]+)"/);
          if (createdAtMatch && createdAtMatch[1]) {
            const createdAt = createdAtMatch[1];

            // 解析日期格式 "Sat Sep 06 21:04:23 +0800 2025"
            const date = new Date(createdAt);
            if (!isNaN(date.getTime())) {
              // 格式化为 "2025/09/06 21:04"
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hour = String(date.getHours()).padStart(2, '0');
              const minute = String(date.getMinutes()).padStart(2, '0');

              const formattedDate = `${year}/${month}/${day} ${hour}:${minute}`;
              return formattedDate;
            }
          }
        }
      }

      return '';
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取发布日期失败:', error);
      return '';
    }
  }

  /**
   * 提取本页文案
   * @returns {string} 本页文案
   */
  extractPageText() {
    try {
      // 移动版微博文案选择器
      const mobileSelectors = [
        '.weibo-text',  // 微博文本
        '.weibo-main .text',  // 微博主体文本
        '.weibo-content .text',  // 微博内容文本
        '.text-content',  // 文本内容
        '.weibo-item .text',  // 微博条目文本
        '.weibo-article .text',  // 微博文章文本
        '.status-text',  // 状态文本
        '.post-text',  // 发布文本
        '[class*="weibo"] [class*="text"]',  // 微博相关的文本
        '.content .text',  // 内容文本
      ];

      // 尝试主要的选择器
      for (const selector of mobileSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          let text = element.textContent.trim();
          if (text && text.length > 0) {
            // 清理文本，移除多余的空白字符
            text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();

            // 限制文本长度，避免过长
            if (text.length > 500) {
              text = text.substring(0, 500) + '...';
            }

            return text;
          }
        }
      }

      // 备选方案：从段落中提取
      const paragraphs = document.querySelectorAll('.weibo-text p, .weibo-main p, .text p');
      if (paragraphs.length > 0) {
        let text = '';
        for (const p of paragraphs) {
          const pText = p.textContent.trim();
          if (pText) {
            text += pText + '\n';
          }
        }

        if (text) {
          text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
          if (text.length > 500) {
            text = text.substring(0, 500) + '...';
          }
          return text;
        }
      }

      return '';
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取本页文案失败:', error);
      return '';
    }
  }

  /**
   * 提取URL
   * @returns {string} 页面URL
   */
  extractUrl() {
    try {
      const url = window.location.href;
      return url;
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取URL失败:', error);
      return '';
    }
  }

  /**
   * 提取作者ID - 基于示例页面代码中的配置信息提取
   * @returns {string} 作者ID
   */
  extractAuthorId() {
    try {
      const scriptElements = document.querySelectorAll('script');

      // 方法1：优先从status.user配置中提取真正的作者ID（根据示例代码段1中的status.user.id）
      for (const script of scriptElements) {
        const scriptText = script.textContent;
        if (scriptText.includes('"status":') && scriptText.includes('"user":') && scriptText.includes('"id":')) {
          // 匹配status.user.id结构
          const statusUserMatch = scriptText.match(/"status":\s*{[^}]*"user":\s*{[^}]*"id":\s*(\d+)/);
          if (statusUserMatch && statusUserMatch[1]) {
            return statusUserMatch[1];
          }

          // 备选匹配：直接匹配user.id
          const userMatch = scriptText.match(/"user":\s*{[^}]*"id":\s*(\d+)/);
          if (userMatch && userMatch[1]) {
            return userMatch[1];
          }
        }
      }

      // 方法2：从用户链接中提取（根据示例代码段2）
      const profileLinks = document.querySelectorAll('a[href*="/profile/"]');
      for (const link of profileLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const match = href.match(/\/profile\/(\d+)/);
          if (match && match[1]) {
            return match[1];
          }
        }
      }

      return '';
    } catch (error) {
      console.error('[WeiboMobileSocialExtractor] 提取作者ID失败:', error);
      return '';
    }
  }

  /**
   * 提取所有字段 - 异步方法，严格遵循社交媒体7字段白名单标准
   * @returns {Promise<object>} 所有提取的字段
   */
  async extractAllFields(opts) {
    const feed = opts && opts.feedPost;
    if (feed && feed.post && feed.post.mid) {
      return await this._buildFeedRecord(feed.post);
    }
    // v2.7.39：列表页上点全局按钮时，整页取值方法会拼出「第一条的正文 + 列表页地址」，
    // 一半对一半错。这里改走「第一条博文」的自洽记录；详情页（读不出 2 条）不受影响。
    const firstPost = this._firstPostOnListPage();
    if (firstPost) return await this._buildFeedRecord(firstPost);
    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }

  /**
   * 列表页上的第一条博文（读不出 2 条以上时返回 null）。
   * @returns {Object|null}
   */
  _firstPostOnListPage() {
    try {
      const ctx = (typeof window !== 'undefined') ? window.WeiboFeedContext : null;
      if (!ctx || typeof ctx.firstPostOnListPage !== 'function') return null;
      return ctx.firstPostOnListPage();
    } catch (e) {
      return null;
    }
  }

  /**
   * 按「用户点的那一条博文」组装 6 列（v2.7.39，手机版）
   *
   * 手机版列表页里，一条博文被拆成 3 个 `.card-wrap`（头/正文/媒体），
   * 且**博文编号根本不在 DOM 里** —— 编号、精确时间、全文只有 Vue 实例上有，
   * 由主世界脚本 `weibo-mobile-bridge.js` 写到 `.card9[data-cm-wb]`，
   * `WeiboFeedContext.readPost()` 读属性拿到的就是这一条的真实数据。
   *
   * 转发帖口径与桌面版一致（用户 2026-11-01 拍板 A 案）：只取博主自己写的那段。
   *
   * @param {Object} post - `WeiboFeedContext.readPost()` 的结果
   * @returns {Promise<object>}
   */
  async _buildFeedRecord(post) {
    const uid = post.uid || '';
    const nick = post.nick || '';
    const text = post.text || '';
    const date = post.date || '';
    const url = post.url || '';

    return await SocialFieldsBuilder.build(this, {
      overrides: {
        '作者ID': uid,
        '作者昵称': nick,
        '作者主页': uid ? ('https://weibo.com/u/' + uid) : '',
        '发布日期': date,
        '本页文案': text,
        '本页标题': () => {
          try {
            // 必须走 `this.extractTitle(...)` 并把文案当第一个参数：
            // 「空文案 → 站名」兜底靠替换这个方法的第一参数重写标题。
            return this.extractTitle(text, null, { nick: nick, date: date, uid: uid });
          } catch (e) {
            return '';
          }
        },
        'URL': url
      }
    });
  }

  /**
   * 提取特定字段 - 同步方法，返回空对象以符合白名单模式
   * @returns {object} 空对象
   */
  extractSpecificFields() {
    return {}; // 返回空对象，使用白名单模式
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.WeiboMobileSocialExtractor = WeiboMobileSocialExtractor;
