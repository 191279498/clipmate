// 推特(X)社交媒体信息提取器
class XSocialExtractor extends BaseExtractor {
  constructor() {
    super();
    this.platform = 'x';
    this.mediaType = 'social';
    this.isSocialPlatform = true;
    this.supportedDomains = ['x.com', 'www.x.com'];
    this.siteName = 'x_social';  // 添加sourceSite标识用于日期格式配置
  }


  // 提取所有字段 - 统一接口方法
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.feedPost] - 逐帖按钮传进来（v2.7.43）：
   *        `{ container, post }`，`post` 是 `XFeedContext.readPost()` 的结果
   *        （已含 handle / mid / nick / date / text / url）。
   *        传了就走「这一条」的字段，不传则维持原来的整页提取，行为逐字不变。
   * @returns {Promise<object>} 所有提取的字段
   */
  async extractAllFields(opts) {
    const feed = opts && opts.feedPost;
    if (feed && feed.post && feed.post.mid) {
      return await this._buildFeedRecord(feed.post);
    }
    // v2.7.43：列表页上点全局按钮时，整页取值方法全是 `querySelectorAll(...)[0]`，
    // 会拼出「第一条推文的正文 + 列表页自己的地址」，一半对一半错，URL 根本点不开。
    // 这里改走「第一条推文」的自洽记录；详情页（读不出 2 条）不受影响，零回归。
    const firstPost = this._firstPostOnListPage();
    if (firstPost) return await this._buildFeedRecord(firstPost);

    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }

  /**
   * 列表页上的第一条推文（读不出 2 条以上时返回 null）。
   * @returns {Object|null}
   */
  _firstPostOnListPage() {
    try {
      const ctx = (typeof window !== 'undefined') ? window.XFeedContext : null;
      if (!ctx || typeof ctx.firstPostOnListPage !== 'function') return null;
      return ctx.firstPostOnListPage();
    } catch (e) {
      return null;
    }
  }

  /**
   * 按「用户点的那一条推文」组装 6 列（v2.7.43）
   *
   * 为什么不复用本类的整页取值方法：它们全是 `document.querySelectorAll(...)[0]`
   * —— 在列表页上取到的是**第一条推文 + 列表页自己的地址**，跟用户点的那条毫无关系。
   * 所以这里所有值都由 `XFeedContext` 从「那一个容器」上读出来，再走同一条装配链
   * （字段外壳、空文案兜底、标题生成规则完全一致，只是数据源换成了这一条）。
   *
   * 引用帖口径（用户 2026-11-01 拍板 A 案，与微博一致）：**只取博主自己写的那段**。
   * 他一个字没写 → 文案为空 → 装配器按站名填「X推文」并同步改写标题，
   * 绝不拿被引用那条的正文冒充。
   *
   * @param {Object} post - `XFeedContext.readPost()` 的结果
   * @returns {Promise<object>}
   */
  async _buildFeedRecord(post) {
    const handle = post.handle || '';
    const nick = post.nick || '';
    const text = post.text || '';
    const date = post.date || '';
    const url = post.url || '';

    return await SocialFieldsBuilder.build(this, {
      overrides: {
        '作者ID': handle,
        '作者昵称': nick,
        '作者主页': handle ? ('https://x.com/' + handle) : '',
        '发布日期': date,
        '本页文案': text,
        '本页标题': () => {
          try {
            // 必须走 `this.extractTitle(...)` 并把文案当**第一个参数**：
            // 装配器的「空文案 → 站名」兜底就是靠替换这个方法的第一参数来重写标题的，
            // 直接在这里用闭包算标题，兜底就够不着（空文案推文会写成空的）。
            return this.extractTitle(text, null, { nick: nick, date: date, uid: handle });
          } catch (e) {
            return '';
          }
        },
        'URL': url
      }
    });
  }

  /**
   * 提取本页标题 - 使用共享标题处理器
   *
   * @param {string} [pageText] - 文案。**逐帖提取（v2.7.43）时会传**，不传则自己去页面取。
   *        为什么必须走这个参数而不是在 overrides 里直接算标题：
   *        装配器的「空文案 → 站名占位词」兜底（v2.7.38）是靠**替换本方法的第一个参数**
   *        来重写标题的（`rebuildTitleWith()`）；标题要是在外面用闭包算好，那层包装就够不着，
   *        空文案推文的标题会一直留空或写「无文案」——IG 在 v2.7.37 就是这么错的。
   * @param {Object} [context] - 保留（与 IG 签名一致），X 逐帖不靠它取数
   * @param {Object} [meta] - 逐帖提取时由调用方给出 `{ nick, date, uid }`，
   *        因为列表页没有「当前这一条」的上下文可读
   * @returns {string} 本页标题
   */
  extractTitle(pageText, context, meta) {

    try {
      const m = meta || {};
      const hasMeta = !!meta;
      // 提取三个核心字段（逐帖路径：昵称/日期/处理名由调用方传入，
      // 列表页上 this.extractXxx() 取的是第一条推文）
      const authorName = hasMeta ? (m.nick || m.uid || '') : this.extractAuthorName();
      const authorId = hasMeta ? (m.uid || '') : this.extractAuthorID(); // 注意方法名是extractAuthorID，不是extractAuthorId
      const publishDate = hasMeta ? (m.date || '') : this.extractPublishDate();
      const content = (pageText !== undefined && pageText !== null)
        ? pageText
        : this.extractContent();


      // 使用共享标题处理器生成组合标题，传递platform参数
      const generatedTitle = SocialTitleProcessor.generatePageTitle(authorName, content, publishDate, {
        platform: 'twitter'
      }, authorId);

      return generatedTitle;
    } catch (error) {
      console.error('[XSocialExtractor] 生成标题失败:', error);
      return '';
    }
  }


  // 提取作者ID
  extractAuthorID() {

    // 策略1: 从推文发布者的头像容器中提取
    // 先找到推文发布者的头像区域，避免提取到登录用户的信息
    const tweetAvatarArea = document.querySelector('[data-testid="Tweet-User-Avatar"]');
    if (tweetAvatarArea) {
      const avatarContainer = tweetAvatarArea.querySelector('[data-testid*="UserAvatar-Container-"]');
      if (avatarContainer) {
        const testId = avatarContainer.getAttribute('data-testid');
        if (testId && testId.includes('UserAvatar-Container-')) {
          const authorId = testId.replace('UserAvatar-Container-', '');
          if (authorId && authorId.length > 0) {
            return authorId;
          }
        }
      }
    }

    // 策略2: 从推文发布者的用户名区域中提取
    const userNameArea = document.querySelector('[data-testid="User-Name"]');
    if (userNameArea) {
      // 在该区域内查找用户链接
      const userLink = userNameArea.querySelector('a[href^="/"]');
      if (userLink) {
        const href = userLink.getAttribute('href');
        // v2.5.48：getAttribute('href') 拿到的是 "/elonmusk"，带前导斜杠。
        // 原来用 ^[a-zA-Z0-9_]+$ 匹配，带斜杠必然不成立 → 这条策略从来没生效过。
        // 现在允许可选前导斜杠，取 ID 时统一去掉。
        if (href && /^\/?[a-zA-Z0-9_]+$/.test(href)) {
          const authorId = href.replace(/^\//, '');
          if (authorId && authorId.length > 0 && !authorId.includes('/') && authorId !== 'home') {
            return authorId;
          }
        }
      }

      // 在该区域内查找@用户名格式
      const atUserName = userNameArea.querySelector('span');
      if (atUserName) {
        const textContent = atUserName.textContent || '';
        const atMatch = textContent.match(/@([a-zA-Z0-9_]+)/);
        if (atMatch && atMatch[1]) {
          return atMatch[1];
        }
      }
    }

    // 策略3: 从页面中的主要用户链接中提取（备用方案）
    // 如果前面的策略都失败，尝试从页面中主要的用户链接中提取
    const mainUserLinks = document.querySelectorAll('a[href^="/"]');
    for (const link of mainUserLinks) {
      const href = link.getAttribute('href');
      // 排除常见的非用户链接
      // v2.5.48：同上，得允许前导斜杠，否则这条兜底永远不命中
      if (href && /^\/?[a-zA-Z0-9_]+$/.test(href)) {
        const authorId = href.replace(/^\//, '');
        // 排除系统路径和过短的ID
        if (authorId && authorId.length >= 3 && !['home', 'explore', 'notifications', 'messages'].includes(authorId)) {
          return authorId;
        }
      }
    }

    return '';
  }

  // 提取作者昵称
  extractAuthorName() {
    // 策略1: 查找用户名元素
    const usernameElements = [
      '.css-1jxf684 .css-4rbku5',
      'article header .css-1jxf684 .css-4rbku5',
      '[data-testid="User-Name"] a span'
    ];

    for (const selector of usernameElements) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    // 策略2: 从meta标签获取
    const ogDescription = SocialDomUtils.readMeta('meta[property="og:description"]');
    if (ogDescription) {
      const match = ogDescription.match(/^(.*?) on X/);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return '';
  }

  // 提取作者主页
  extractAuthorHomepage() {
    // 策略1: 查找作者链接
    const authorLinkElements = [
      '.css-1jxf684 a[href^="/"].css-4rbku5',
      'article header [data-testid="User-Name"] a[href^="/"]',
      '[data-testid="User-Name"] a[href^="/"]'
    ];

    for (const selector of authorLinkElements) {
      const element = document.querySelector(selector);
      if (element && element.href) {
        return element.href;
      }
    }

    // 策略2: 从用户名构建
    const usernameElements = [
      '.css-901oao.css-16my406.r-poiln3.r-bcqeeo.r-qvutc0',
      'article header .css-901oao.css-16my406.r-poiln3.r-bcqeeo.r-qvutc0',
      '[data-testid="User-Name"] span.css-901oao.css-16my406.r-poiln3.r-bcqeeo.r-qvutc0'
    ];

    for (const selector of usernameElements) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.startsWith('@')) {
        const username = element.textContent.trim();
        return `https://x.com${username}`;
      }
    }

    return '';
  }

  // 提取发布日期
  extractPublishDate() {
    // 策略1: 优先查找推文区域内的特定时间元素
    const tweetTimeSelectors = [
      // 推文时间戳专用选择器
      'article a[href*="/status/"] time',
      '[data-testid="tweet-timestamp"] time',
      '[data-testid="tweet"] a[href*="/status/"] time',
      'article [role="group"] + div a[href*="/status/"] time',
      // 更具体的推文时间元素
      'article > div > div > div > div > div > div > div > div > a[href*="/status/"] time',
      // 推文头部区域的时间
      'article header + div a[href*="/status/"] time'
    ];

    for (const selector of tweetTimeSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        const datetime = element.getAttribute('datetime');
        if (datetime && this.isValidDateString(datetime)) {
          // 验证这个时间是否合理（不是未来的时间，不是太早的时间）
          const date = new Date(datetime);
          const now = new Date();
          const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

          if (date <= now && date >= oneYearAgo) {
            return datetime;
          } else {
          }
        }
      }
    }

    // 策略2: 查找所有状态链接中的时间元素，优先选择更具体的
    const statusLinks = document.querySelectorAll('a[href*="/status/"]');
    const validTimes = [];

    for (const link of statusLinks) {
      const timeElement = link.querySelector('time');
      if (timeElement) {
        const datetime = timeElement.getAttribute('datetime');
        if (datetime && this.isValidDateString(datetime)) {
          // 检查这个链接是否在推文相关的上下文中
          const article = link.closest('article');
          const tweetContainer = link.closest('[data-testid="tweet"], article');

          if (article || tweetContainer) {
            validTimes.push({
              datetime: datetime,
              element: timeElement,
              context: article ? 'article' : 'tweet'
            });
          }
        }
      }
    }

    // 如果有多个时间，优先选择article上下文中的
    if (validTimes.length > 0) {
      const articleTime = validTimes.find(t => t.context === 'article');
      const selectedTime = articleTime || validTimes[0];

      return selectedTime.datetime;
    }

    // 策略3: 查找通用时间元素（作为后备方案）
    const generalTimeSelectors = [
      'article time',
      '[data-testid="tweet"] time',
      'time[datetime*="2025"], time[datetime*="2024"], time[datetime*="2023"]'
    ];

    for (const selector of generalTimeSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const datetime = element.getAttribute('datetime');
        if (datetime && this.isValidDateString(datetime)) {
          // 验证时间合理性
          const date = new Date(datetime);
          const now = new Date();
          const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());

          if (date <= now && date >= oneYearAgo) {
            return datetime;
          }
        }
      }
    }

    return '';
  }

  // 验证日期字符串是否有效
  isValidDateString(dateString) {
    if (!dateString) return false;

    // 检查是否为ISO格式
    const isoPattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3}Z)?)?$/;
    if (isoPattern.test(dateString)) {
      return true;
    }

    // 检查是否为常见日期格式
    const commonPatterns = [
      /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/,         // MM/DD/YYYY
      /^\d{2}\s+[A-Za-z]+\s+\d{4}$/,   // DD Mon YYYY
      /^\d{4}年\d{2}月\d{2}日$/,        // YYYY年MM月DD日
      /^下午\d{1,2}:\d{2}·\d{4}年\d{2}月\d{2}日$/  // 下午HH:MM·YYYY年MM月DD日
    ];

    return commonPatterns.some(pattern => pattern.test(dateString));
  }

  // 提取本页文案
  extractContent() {
    // 策略1: 查找推文内容元素
    const contentElements = [
      '[data-testid="tweetText"]',
      'article [data-testid="tweetText"]',
      '.css-901oao.r-18jsvk2.r-37j5jr.r-a023e6.r-16dba41.r-rjixqe.r-bcqeeo.r-bnwqim.r-qvutc0',
      '.css-901oao.css-16my406.r-poiln3.r-bcqeeo.r-qvutc0'
    ];

    for (const selector of contentElements) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    // 策略2: 从meta标签获取
    const ogDescription = SocialDomUtils.readMeta('meta[property="og:description"]');
    if (ogDescription) {
      // 移除用户名部分
      const content = ogDescription.replace(/^(.*?) on X: /, '');
      return content.trim();
    }

    return '';
  }

  // 格式化日期
  formatDate(dateString) {
    try {
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        // 返回YYYY-MM-DD格式
        return date.toISOString().split('T')[0];
      }
    } catch (error) {
      console.error('[XSocialExtractor] 日期格式化失败:', error);
    }
    return dateString;
  }


}

// 全局注册 - 供提取器工厂按类名获取（window[className]）
if (typeof window !== 'undefined') {
  window.XSocialExtractor = XSocialExtractor;
}
