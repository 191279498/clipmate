/**
 * 微博社交媒体信息提取器
 * 提取微博帖子的基本信息，包括标题、作者、发布日期等
 */

class WeiboSocialExtractor extends BaseExtractor {
  /**
   * 构造函数
   */
  constructor() {
    super();
    this.siteName = 'weibo_social';
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
   *        为什么必须走这个参数而不是在 overrides 里直接算标题：
   *        装配器的「空文案 → 站名占位词」兜底（v2.7.38）是靠**替换本方法的第一个参数**
   *        来重写标题的（`rebuildTitleWith()`）；标题要是在外面用闭包算好，那层包装就够不着，
   *        纯转发帖的标题会一直留空或写「无文案」——IG 在 v2.7.37 就是这么错的。
   * @param {Object} [context] - 保留（与 IG 签名一致），微博逐帖不靠它取数
   * @param {Object} [meta] - 逐帖提取时由调用方给出 `{ nick, date, uid }`，
   *        因为列表页没有「当前这一条」的上下文可读
   * @returns {Promise<string>} 本页标题
   */
  async extractTitle(pageText, context, meta) {
    try {
      const m = meta || {};
      // 逐帖路径：昵称/日期/作者ID 由调用方传入（列表页上 this.extractXxx() 取的是第一条）
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
      console.error('[WeiboSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }
  

  


  /**
   * 判断文本是否为纯数字ID（不应作为作者昵称返回）
   * @param {string} text - 待检查文本
   * @returns {boolean} 是否为纯数字ID
   */
  isNumericId(text) {
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    // 空文本视为无效
    if (trimmed.length === 0) return true;
    // 仅当文本为纯数字、且与已提取的作者UID完全一致时，才判定为ID。
    // 这样既拦截了“通用选择器误命中数字UID”的原始bug，
    // 又不会误伤“纯数字但不同于UID”的真实昵称（如昵称就叫12345）。
    const authorId = this.extractAuthorId();
    if (authorId && /^\d+$/.test(trimmed) && trimmed === authorId) return true;
    return false;
  }

  /**
   * 提取作者昵称
   * 优先从稳定 DOM 属性（usercard / aria-label / href）中提取，
   * 不依赖 CSS Module hash 类名（weibo-pro-next 每次构建会改变类名 hash）
   * @returns {string} 作者昵称
   */
  extractAuthorName() {
    try {
      const authorId = this.extractAuthorId();

      // 策略1（主路径）：从 usercard 或 /u/{id} 链接中提取昵称
      if (authorId) {
        const name = this._extractNameFromAuthorLinks(authorId);
        if (name) {
          return name;
        }
      }

      // 策略2：从页面标题栏中提取昵称（"李冰若liberty" 在标题栏 div 中）
      const barName = this._extractNameFromTitleBar();
      if (barName) {
        return barName;
      }

      // 策略3：通用选择器（向后兼容旧版 weibo UI）
      const genericSelectors = [
        '[class*="user"] [class*="name"]',
        '.username',
        '.name',
        '[data-testid="author-name"]',
        '.author-name',
        '.user-name',
        '.creator-name',
        '.user-nickname',
        '.nickname'
      ];

      for (const selector of genericSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          if (text && !this.isNumericId(text) && text.length <= 30) {
            return text;
          }
        }
      }

      // 策略4：旧版微博选择器（向后兼容）
      const oldSelectors = [
        '.WB_info .W_f14 a.W_f14',
        '.WB_info a.name',
        '.WB_info .name',
        '.userinfo_name'
      ];

      for (const selector of oldSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const text = element.textContent.trim();
          if (text && !this.isNumericId(text) && text.length <= 30) {
            return text;
          }
        }
      }

      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取作者昵称失败:', error);
      return '';
    }
  }

  /**
   * 从作者主页链接中提取昵称
   * 利用 usercard / aria-label / span[title] 等稳定属性
   * @param {string} authorId - 作者数字ID
   * @returns {string} 昵称或空字符串
   */
  _extractNameFromAuthorLinks(authorId) {
    // 收集所有指向该作者主页的链接元素
    const linkSelectors = [
      `a[usercard="${authorId}"]`,              // 最稳定：usercard 属性
      `a[href*="/u/${authorId}"]`,               // 标准 /u/{id} 格式
      `a[href*="weibo.com/u/${authorId}"]`,      // 完整域名格式
      `a[href*="weibo.com/${authorId}"]`          // 无 /u/ 格式
    ];

    const seen = new Set();

    for (const selector of linkSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (seen.has(el)) continue;
        seen.add(el);

        // 1) 优先取 aria-label（最干净，不包含额外元素文本）
        const ariaLabel = el.getAttribute('aria-label');
        if (ariaLabel && this._isPlausibleName(ariaLabel)) {
          return ariaLabel.trim();
        }

        // 2) 取 <span title="昵称"> 的 title 属性
        const titleSpan = el.querySelector('span[title]');
        if (titleSpan) {
          const title = titleSpan.getAttribute('title');
          if (title && this._isPlausibleName(title)) {
            return title.trim();
          }
          // 3) 取 <span> 的 textContent
          const text = titleSpan.textContent.trim();
          if (text && this._isPlausibleName(text)) {
            return text;
          }
        }

        // 4) 取元素自己的 textContent（过滤过长或含 UI 词的）
        const text = el.textContent.trim();
        if (text && this._isPlausibleName(text)) {
          return text;
        }
      }
    }

    return '';
  }

  /**
   * 从页面标题栏提取昵称
   * weibo-pro-next 的标题栏用 div 直接展示昵称
   * @returns {string} 昵称或空字符串
   */
  _extractNameFromTitleBar() {
    // 标题栏中通常有 <h2> 或包含昵称的 div
    // 类名带 hash 不可靠，改用结构邻近位置和文本特征判断
    const candidates = document.querySelectorAll('h2, [class*="mid"], [class*="cut"]');
    for (const el of candidates) {
      const text = el.textContent.trim();
      if (text && this._isPlausibleName(text)) {
        return text;
      }
    }
    return '';
  }

  /**
   * 判断文本是否为看起来像真实昵称的字符串
   * @param {string} text - 待检查文本
   * @returns {boolean} 是否看起来像昵称
   */
  _isPlausibleName(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.length > 30) return false;    // 昵称通常 <= 30 字
    if (this.isNumericId(trimmed)) return false; // 纯数字 UID 跳过
    // 必须至少包含一个汉字或字母（避免纯符号/空白）
    if (!/[\u4e00-\u9fa5a-zA-Z]/.test(trimmed)) return false;
    return true;
  }

  /**
   * 提取作者主页
   * @returns {string} 作者主页URL
   */
  extractAuthorHomepage() {
    try {
      // 首先获取作者ID
      const authorId = this.extractAuthorId();
      
      // 如果成功提取到作者ID，生成标准格式的作者主页URL
      if (authorId && authorId.length > 0) {
        const homepageUrl = `https://weibo.com/u/${authorId}`;
        return homepageUrl;
      }
      
      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取作者主页失败:', error);
      return '';
    }
  }

  /**
   * 提取发布日期
   * @returns {string} 发布日期
   */
  extractPublishDate() {
    try {
      // 新版微博选择器
      const newSelectors = [
        '.photo-time',
        '.feed-time',
        '.post-time-text',
        '.time-info',
        '.time',
        '[data-testid="publish-time"]',
        '[class*="time"]',
        '[datetime]',
        '.timeago'
      ];
      
      // 旧版微博选择器
      const oldSelectors = [
        '.WB_from a',
        '.WB_from',
        '.time',
        '.WB_time'
      ];
      
      // 尝试所有选择器
      const allSelectors = [...newSelectors, ...oldSelectors];
      
      for (const selector of allSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          let text = element.textContent.trim();
          if (text && text.length > 0) {
            // 添加两位数年份补全功能（- 与 / 两种分隔符都支持，与原有行为一致）
            text = SocialDateUtils.completeYearFormat(text);
            // 去除秒数，只保留到分钟
            text = SocialDateUtils.removeSeconds(text);
            return text;
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取发布日期失败:', error);
      return '';
    }
  }
  
  /**
   * 提取本页文案
   * @returns {string} 本页文案
   */
  extractPageText() {
    try {
      // 根据HTML示例，微博文案内容在.detail_wbtext_4CRf9类中
      const mainTextSelectors = [
        '.detail_wbtext_4CRf9',  // 主要文案内容
        '.wbpro-feed-ogText .detail_wbtext_4CRf9',  // 嵌套结构中的文案
        '[class*="wbtext"]',  // 包含wbtext的类名
        '.detail_text_1U10O .detail_wbtext_4CRf9',  // 详细文本中的文案
      ];
      
      // 尝试主要的选择器
      for (const selector of mainTextSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          let text = element.textContent.trim();
          if (text && text.length > 0) {
            // 清理文本，移除多余的空白字符
            text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
            
            // 同时提取发布时间和设备信息（从header部分）
            const headerInfo = this.extractHeaderInfo();
            if (headerInfo) {
              text += '\n' + headerInfo;
            }
            
            return text;
          }
        }
      }
      
      // 备选选择器（兼容不同版本）
      const backupSelectors = [
        '.WB_text',
        '#WB_Text', 
        '.WB_text W_f14',
        '.content',
        '.text-content',
        '.post-text',
        '.feed-content',
        '.note-content',
        '.article-content',
        '.weibo-content',
        '[class*="content"]'
      ];
      
      // 如果主要选择器没找到，尝试备选选择器
      for (const selector of backupSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          let text = element.textContent.trim();
          if (text && text.length > 0) {
            // 清理文本
            text = text.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
            return text;
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取本页文案失败:', error);
      return '';
    }
  }
  
  /**
   * 提取header信息（发布时间、地点、设备）
   * @returns {string} header信息
   */
  extractHeaderInfo() {
    try {
      const headerSelectors = [
        '.head-info_time_6sFQg',  // 时间
        '.head-info_ip_3ywCW',    // 发布地点
        '.head-info_source_2zcEX' // 设备来源
      ];
      
      const infoParts = [];
      
      // 提取各个信息部分
      headerSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          const text = element.textContent.trim();
          if (text && text.length > 0) {
            infoParts.push(text);
          }
        });
      });
      
      // 如果找到了信息，组合成字符串
      if (infoParts.length > 0) {
        return infoParts.join(' ');
      }
      
      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取header信息失败:', error);
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
      console.error('[WeiboSocialExtractor] 提取URL失败:', error);
      return '';
    }
  }

  /**
   * 提取作者ID - 从页面链接或属性中提取
   * @returns {string} 作者ID
   */
  extractAuthorId() {
    try {
      // 使用简单缓存避免重复查询DOM
      if (this._cachedAuthorId !== undefined) {
        return this._cachedAuthorId;
      }

      // 1) 从 usercard 属性的<a>链接中提取（最稳定，CSS hash 不变）
      const usercardLinks = document.querySelectorAll(`a[usercard]`);
      for (const link of usercardLinks) {
        const usercard = link.getAttribute('usercard');
        if (usercard && /^\d+$/.test(usercard)) {
          this._cachedAuthorId = usercard;
          return usercard;
        }
      }

      // 2) 从 header 区域的 /u/{id} 链接中提取
      const headerProfileLinks = document.querySelectorAll('header a[href*="/u/"]');
      for (const link of headerProfileLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const idMatch = href.match(/\/u\/(\d+)/);
          if (idMatch && idMatch[1]) {
            this._cachedAuthorId = idMatch[1];
            return idMatch[1];
          }
        }
      }

      // 3) 从任意 /u/{id} 链接中提取
      const profileLinks = document.querySelectorAll('a[href*="/u/"]');
      for (const link of profileLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const idMatch = href.match(/\/u\/(\d+)/);
          if (idMatch && idMatch[1]) {
            this._cachedAuthorId = idMatch[1];
            return idMatch[1];
          }
        }
      }

      // 4) 从 URL 路径中提取
      const urlPathMatch = window.location.pathname.match(/\/u\/(\d+)/);
      if (urlPathMatch && urlPathMatch[1]) {
        const authorId = urlPathMatch[1];
        this._cachedAuthorId = authorId;
        return authorId;
      }

      // 5) 从 usercard 属性的任意元素中提取（兜底）
      const usercardElements = document.querySelectorAll('[usercard]');
      for (const element of usercardElements) {
        const usercard = element.getAttribute('usercard');
        if (usercard && /^\d+$/.test(usercard)) {
          this._cachedAuthorId = usercard;
          return usercard;
        }
      }

      this._cachedAuthorId = '';
      return '';
    } catch (error) {
      console.error('[WeiboSocialExtractor] 提取作者ID失败:', error);
      this._cachedAuthorId = '';
      return '';
    }
  }

  /**
   * 提取所有字段 - 异步方法，严格遵循社交媒体6字段白名单标准
   *
   * @param {Object} [opts]
   * @param {Object} [opts.feedPost] - 逐帖按钮传进来（v2.7.39）：
   *        `{ container, post }`，`post` 是 `WeiboFeedContext.readPost()` 的结果
   *        （已含 uid / mid / nick / date / text / url）。
   *        传了就走「这一条」的字段，不传则维持原来的整页提取，行为逐字不变。
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
   * 按「用户点的那一条博文」组装 6 列（v2.7.39）
   *
   * 为什么不复用本类的整页取值方法：它们全是 `document.querySelectorAll(...)[0]`
   * —— 在列表页上取到的是**第一条博文 + 列表页自己的地址**，跟用户点的那条毫无关系。
   * 所以这里所有值都由 `WeiboFeedContext` 从「那一个容器」上读出来，再走同一条装配链
   * （字段外壳、空文案兜底、标题生成规则完全一致，只是数据源换成了这一条）。
   *
   * 转发帖口径（用户 2026-11-01 拍板 A 案）：**只取博主自己写的那段**。
   * 纯转发（博主没写字）→ 文案为空 → 装配器按站名填「微博博文」并同步改写标题。
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
            // 必须走 `this.extractTitle(...)` 并把文案当**第一个参数**：
            // 装配器的「空文案 → 站名」兜底就是靠替换这个方法的第一参数来重写标题的，
            // 直接在这里用闭包算标题，兜底就够不着（纯转发帖会写成空的）。
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
window.WeiboSocialExtractor = WeiboSocialExtractor;
