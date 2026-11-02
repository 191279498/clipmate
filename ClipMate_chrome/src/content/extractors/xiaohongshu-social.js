/**
 * 小红书社交媒体内容提取器
 * 用于从小红书页面提取作者信息、内容和发布时间的浏览器扩展提取器
 * @class
 * @extends BaseExtractor
 */

/**
 * 定义所有可用的CSS选择器和配置常量
 */
const XIAOHONGSHU_SELECTORS = {
  AUTHOR_NAME: [
    '.username',              // 实际页面中的用户名span元素
    '.name',                  // 实际页面中的name类链接元素
    '.author-name',
    '.user-name',
    '.creator-name',
    '[data-testid="author-name"]',
    '.note-author .name',
    '.user-info .name',
    'a[href*="/user/profile/"] .username'  // 用户主页链接内的username
  ],
  AUTHOR_HOMEPAGE: [
    'a[href*="/user/profile/"]',
    '.author-avatar a',
    '.user-avatar a',
    '.creator-avatar a'
  ],

};

/**
 * 日志配置
 */
const LOG_CONFIG = {
  enableDebug: false, // 生产环境关闭调试日志
  prefix: '[XiaohongshuSocialExtractor]'
};

/**
 * 小红书社交媒体内容提取器类
 * @class
 * @extends BaseExtractor
 */
class XiaohongshuSocialExtractor extends BaseExtractor {
  /**
   * 构造函数
   */
  constructor() {
    super();
    this.siteName = 'xiaohongshu_social';
    this.observer = null;
  }

  /**
   * 调试日志方法
   * @param {string} message - 日志消息
   * @param {*} data - 附加数据
   */
  debugLog(message, data = null) {
    if (LOG_CONFIG.enableDebug) {
      const fullMessage = `${LOG_CONFIG.prefix} ${message}`;
      if (data !== null) {
      } else {
      }
    }
  }


  /**
   * 错误日志方法
   * @param {string} message - 错误消息
   * @param {Error} error - 错误对象
   */
  errorLog(message, error = null) {
    const fullMessage = `${LOG_CONFIG.prefix} ${message}`;
    if (error) {
      console.error(fullMessage, error);
    } else {
      console.error(fullMessage);
    }
  }

  /**
   * 判断是否适用于当前页面
   * @returns {boolean} 是否适用于当前页面
   */
  /**
   * 提取笔记标题 - 使用共享标题处理器
   * @returns {Promise<string>} 生成的标题
   */
  async extractTitle() {
    try {
      // 获取所需的数据
      const authorName = this.extractAuthorName();
      const authorId = await this.extractAuthorId(); // 提取作者ID
      const pageText = this.extractPageText();
      const publishDate = this.extractPublishDate();

      // 使用共享标题处理器生成标题，传递platform参数和authorId参数
      return SocialTitleProcessor.generatePageTitle(authorName, pageText, publishDate, {
        platform: 'xiaohongshu'
      }, authorId);
    } catch (error) {
      this.errorLog('提取标题失败', error);
      return '';
    }
  }


  /**
   * 提取作者昵称
   * @returns {string} 作者昵称
   */
  extractAuthorName() {
    // v2.6.0：一手数据优先（笔记内存里有 user.nickname，不怕页面改版）
    const bridged = this.readBridgeNote();
    if (bridged && bridged.nickname) return bridged.nickname;

    // 尝试从配置的选择器中提取
    const authorName = this.findElementBySelectors(XIAOHONGSHU_SELECTORS.AUTHOR_NAME);
    if (authorName) {
      return authorName;
    }

    // 备选方案：尝试从链接文本获取
    const authorLinks = document.querySelectorAll('a[href*="/user/profile/"]');
    for (const link of authorLinks) {
      const text = link.textContent?.trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  /**
   * 通过多个选择器查找元素
   * @param {string[]} selectors - CSS选择器数组
   * @returns {string|null} 找到的文本内容或null
   */
  findElementBySelectors(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent?.trim()) {
        return element.textContent.trim();
      }

      // 处理嵌套元素的情况：如果选择器找不到直接文本，尝试查找子元素
      const nestedText = this.extractNestedText(selector);
      if (nestedText) {
        return nestedText;
      }
    }
    return null;
  }

  /**
   * 从嵌套元素中提取文本（处理复杂的选择器）
   * @param {string} selector - CSS选择器
   * @returns {string|null} 提取的文本内容或null
   */
  extractNestedText(selector) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        // 优先从子元素中提取文本
        const childSpan = element.querySelector('.username, span[class*="name"]');
        if (childSpan && childSpan.textContent?.trim()) {
          const text = childSpan.textContent.trim();
          if (text && text !== '我') { // 过滤掉错误的"我"字
            this.debugLog(`从嵌套元素 ${selector} -> .username 提取到作者昵称: ${text}`);
            return text;
          }
        }

        // 如果没有子span元素，尝试从链接文本获取
        if (element.tagName === 'A' && element.href?.includes('/user/profile/')) {
          const linkText = element.textContent?.trim();
          if (linkText && linkText !== '我') { // 过滤掉错误的"我"字
            this.debugLog(`从用户主页链接 ${selector} 提取到作者昵称: ${linkText}`);
            return linkText;
          }
        }

        // 备用：从所有子元素中查找有效文本
        const allTexts = this.extractAllTextFromElement(element);
        if (allTexts && allTexts !== '我') {
          this.debugLog(`从元素 ${selector} 的子元素中提取到作者昵称: ${allTexts}`);
          return allTexts;
        }
      }
    } catch (error) {
      this.debugLog(`处理选择器 ${selector} 时出错:`, error);
    }
    return null;
  }

  /**
   * 从元素及其所有子元素中提取有效文本
   * @param {Element} element - DOM元素
   * @returns {string|null} 提取的文本或null
   */
  extractAllTextFromElement(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let text = '';
    let node;
    while (node = walker.nextNode()) {
      const textContent = node.textContent?.trim();
      if (textContent && textContent !== '我') {
        text += textContent + ' ';
      }
    }

    return text.trim() || null;
  }

  /**
   * 提取作者主页链接
   * @returns {string} 作者主页链接
   */
  extractAuthorHomepage() {
    this.debugLog('开始提取作者主页链接');

    // v2.6.0：一手数据优先 —— 笔记内存里有 user.userId，直接拼主页，
    // 不用在弹层里翻链接（列表卡片里也有作者链接，DOM 方式容易挑错人）
    const bridged = this.readBridgeNote();
    if (bridged && bridged.userId) {
      const url = `https://www.xiaohongshu.com/user/profile/${bridged.userId}`;
      this.debugLog('从页面数据取到作者主页:', url);
      return url;
    }

    // 策略1: 查找包含作者昵称的链接元素
    const authorName = this.extractAuthorName();
    if (authorName && authorName !== '未获取到作者') {
      // 查找包含作者用户名的链接
      const authorLinks = document.querySelectorAll('a[href*="/user/profile/"]');
      for (const link of authorLinks) {
        const href = link.getAttribute('href');
        const linkText = link.textContent?.trim();

        // 检查链接文本是否包含作者昵称
        if (linkText && linkText.includes(authorName)) {
          this.debugLog('找到匹配作者昵称的链接:', href);
          return this.processHomepageUrl(href);
        }

        // 检查链接内部是否包含用户名span
        const usernameSpan = link.querySelector('.username');
        if (usernameSpan && usernameSpan.textContent?.trim() === authorName) {
          this.debugLog('找到用户名span匹配的链接:', href);
          return this.processHomepageUrl(href);
        }
      }
    }

    // 策略2: 从配置的选择器中提取
    for (const selector of XIAOHONGSHU_SELECTORS.AUTHOR_HOMEPAGE) {
      const element = document.querySelector(selector);
      if (element) {
        const href = element.getAttribute('href');
        this.debugLog('从选择器提取到作者主页:', selector, href);
        return this.processHomepageUrl(href);
      }
    }

    // 策略3: 查找任何包含/user/profile/的链接
    const profileLinks = document.querySelectorAll('a[href*="/user/profile/"]');
    if (profileLinks.length > 0) {
      // 优先选择包含用户名的链接
      for (const link of profileLinks) {
        const href = link.getAttribute('href');
        if (href && href.includes('/user/profile/')) {
          this.debugLog('找到用户资料链接:', href);
          return this.processHomepageUrl(href);
        }
      }
    }

    this.debugLog('未找到作者主页链接');
    return '';
  }

  /**
   * 处理主页URL
   * @param {string|null} href - 原始URL
   * @returns {string} 处理后的URL
   */
  processHomepageUrl(href) {
    if (!href) return '';

    // 如果href是相对路径，转换为完整URL
    if (href.startsWith('/')) {
      // 提取用户ID（去除查询参数）
      const userIdMatch = href.match(/\/user\/profile\/([^?]+)/);
      if (userIdMatch && userIdMatch[1]) {
        return `https://www.xiaohongshu.com/user/profile/${userIdMatch[1]}`;
      }
    }

    // 如果已经是完整URL，直接返回
    return href;
  }

  /**
   * 提取作者ID（小红书号）
   * 从作者主页获取作者的小红书ID；并发去重、缓存读写、失败兜底统一交给 AuthorIdFetcher
   * @returns {Promise<string>} 作者ID
   */
  async extractAuthorId() {
    // 以作者主页为并发去重键：同一作者共享同一个在途请求，不同作者互不影响
    let inflightKey = '__no_homepage__';
    try {
      const homepage = this.extractAuthorHomepage();
      if (homepage) inflightKey = homepage;
    } catch (e) {
      // 取主页失败时退化为单键，不影响主流程
    }

    if (!this._authorIdInflight) this._authorIdInflight = new Map();
    return AuthorIdFetcher.dedupe(
      this._authorIdInflight,
      inflightKey,
      () => this._extractAuthorIdImpl(),
      { info: (msg) => this.debugLog('[小红书提取器] ' + msg) }
    );
  }

  /**
   * 作者ID实际实现：缓存 → 抓主页 → 依次用 4 条规则解析 → 写缓存
   * @returns {Promise<string>}
   */
  async _extractAuthorIdImpl() {
    this.debugLog('开始提取作者ID');

    // 首先获取作者主页URL
    const authorHomepage = this.extractAuthorHomepage();
    if (!authorHomepage) {
      this.debugLog('未获取到作者主页URL，无法提取作者ID');
      return '';
    }

    return await AuthorIdFetcher.extract({
      site: 'xiaohongshu_social',
      homepage: authorHomepage,

      // 实际生效的只有前两条规则。
      // 原实现里策略3（JSON redId）与策略4（通用匹配）挂在 else-if 链上，
      // 而策略2 的条件 `!extractedId` 恒为真，导致这两条分支永远不可达。
      // 为保持提取结果与改造前完全一致，这里只启用真正生效的两条；
      // 原规则以注释保留，将来确认要放宽时再显式启用。
      patterns: [
        /小红书号：([a-zA-Z0-9]+)/,
        /class=["']user-redId["'][^>]*>\s*小红书号：\s*([a-zA-Z0-9]+)\s*</,
        // v2.6.0 兜底：作者主页的 SSR HTML 里一定带着内嵌 JSON，`basicInfo.redId` 就是小红书号。
        // 不依赖「小红书号：」这行可见文字 —— 它在某些页面形态下压根没渲染出来，
        // 那时候前两条规则全落空，作者ID 就只能空着。
        // 限定在 basicInfo 对象内部匹配，避免抓到页面里其他推荐用户的 redId。
        /"basicInfo"\s*:\s*\{[^{}]{0,400}?"redId"\s*:\s*"([a-zA-Z0-9_-]+)"/
        // 原策略3（改造前不可达）：/"redId"\s*:\s*"([a-zA-Z0-9]+)"/
        // 原策略4（改造前不可达）：/(?:小红书号|redId|authorId)["':：]\s*([a-zA-Z0-9]{3,})/i
      ],

      fetchOptions: {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'User-Agent': navigator.userAgent
        },
        credentials: 'include' // 包含cookie以保持登录状态
      },

      log: {
        info: (msg) => this.debugLog(msg),
        error: (msg, err) => this.errorLog(msg, err)
      }
    });
  }

  /**
   * 读主世界写过来的笔记数据（v2.6.0）
   *
   * 桥节点是 `<script id="clipmate-xhs-note" type="application/json">`，
   * 由 `src/content/xiaohongshu-page-data.js`（world: MAIN）每 250ms 更新一次。
   * content script 在隔离世界读不到页面的 `__INITIAL_STATE__`，只能这样拿。
   *
   * **ID 闸口**：小红书弹层切条时 `noteDetailMap` 是累积的，旧笔记不会被删。
   * 只有桥里的 `urlId` 跟**当前地址**里的笔记 ID 一致才认，否则一律当没有 ——
   * 不然切条之后会拿上一条的数据（TikTok 那边就是这么串台的）。
   *
   * @returns {Object|null} 就绪返回笔记对象；没桥 / 不是这条 / 还没加载都返回 null
   */
  readBridgeNote() {
    try {
      const node = document.getElementById('clipmate-xhs-note');
      if (!node || !node.textContent) return null;
      const payload = JSON.parse(node.textContent);
      const curId = this.getCurrentNoteId();
      if (!curId || !payload || payload.urlId !== curId) return null;
      return this.normalizeBridgeNote(payload.note);
    } catch (e) {
      return null;
    }
  }

  /**
   * 把桥上那条笔记归一成**扁平结构**（v2.6.0）
   *
   * 约定上桥发的已经是扁平结构（`note.user.*` 在 MAIN world 里就摊平了）。
   * 但它跨了一个世界边界：桥的脚本和这里不是同一份代码，哪天桥换了形态、
   * 或者被别的实现替换，这边就会静默拿到空昵称、空作者ID，而且**不报错**。
   * 所以两种形态都认一遍（照 TikTok 的教训：归一化必须列全所有实测形态）。
   *
   * @param {Object|null} note - 桥上的 note
   * @returns {Object|null}
   */
  normalizeBridgeNote(note) {
    if (!note || typeof note !== 'object') return null;
    if (note.nickname && note.userId) return note;      // 已经是扁平结构，原样返回
    const u = (note.user && typeof note.user === 'object') ? note.user : {};
    return Object.assign({}, note, {
      userId: note.userId || (u.userId ? String(u.userId) : ''),
      nickname: note.nickname || (typeof u.nickname === 'string' ? u.nickname : '')
    });
  }

  /**
   * 从桥里取格式化后的发布时间（v2.6.0）
   *
   * `note.time` 是毫秒时间戳，直接格式化到秒，**不经过任何推测**。
   * 取不到就返回 ''，交给后面的 DOM 链路兜底（绝不编一个「现在减 3 小时」）。
   *
   * @returns {string} 形如 `2026/10/29 15:15:03`，取不到返回 ''
   */
  extractTimeFromBridge() {
    try {
      const bridged = this.readBridgeNote();
      if (!bridged) return '';
      const raw = Number(bridged.time);
      if (!raw || isNaN(raw) || !isFinite(raw)) return '';
      // 10 位是秒、13 位是毫秒；小红书是毫秒，顺手兼容一下秒
      const ms = raw < 1e12 ? raw * 1000 : raw;
      // 合理性校验：1971 年之前、或比现在晚一天，都当脏数据
      const now = Date.now();
      if (ms < 31536000000 || ms > now + 86400000) return '';
      const formatted = this.formatTime(ms);
      return formatted || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 拼「标题 + 正文」成一段文案（v2.6.0 用户拍板：两段拼一起）
   *
   * 小红书发笔记时「标题」和「正文」是两个独立输入框，页面也是分两块显示的，
   * 所以这里用换行拼，跟页面看到的样子一致。两种情况不重复拼：
   *   · 只有一边有内容 → 直接用那边
   *   · 正文开头已经把标题抄了一遍 → 只留正文（不少用户会把标题再写进正文第一句）
   *
   * @param {string} title
   * @param {string} desc
   * @returns {string}
   */
  composeNoteText(title, desc) {
    const t = String(title || '').trim();
    const d = String(desc || '').trim();
    if (!t && !d) return '';
    if (!t) return d;
    if (!d) return t;
    if (d.indexOf(t) === 0) return d;
    return t + '\n' + d;
  }

  /**
   * 从 DOM 取标题+正文（一手数据拿不到时的兜底，v2.6.0）
   *
   * 为什么不直接用 `.note-content` 的 textContent：实测它长这样 ——
   *   `标题 正文… #三体3小时前 内蒙古`
   * 日期和 IP 属地被一起吞进来了。这里改成「先克隆再按容器剔」：
   * 把底部栏 / 日期 / 点赞 / 评论区整块摘掉，剩下的才是标题+正文。
   * 按容器剔而不是按文字剔 —— class 名会变，容器嵌套结构更稳。
   *
   * @returns {string}
   */
  extractNoteTextFromDom() {
    try {
      const content = document.querySelector('.note-detail-mask .note-content')
        || document.querySelector('.note-content');
      if (!content) return '';
      const clone = content.cloneNode(true);
      clone.querySelectorAll(
        '.bottom-container, .bottom-left, .bottom-right, .date, ' +
        '.interact-container, .comments-container, .comment-list, .comments-el'
      ).forEach((el) => el.remove());
      const text = this.cleanTextContent(clone.textContent || '');
      return text.trim() ? text : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 提取本页文案（不包含标题）
   * @returns {string} 本页文案
   */
  extractPageText() {
    this.debugLog('提取页面文案');

    // 1) 一手数据（v2.6.0）：标题 + 正文，最干净 —— 日期和 IP 属地不会混进来
    const bridged = this.readBridgeNote();
    if (bridged) {
      const composed = this.composeNoteText(bridged.title, bridged.desc);
      if (composed) {
        this.debugLog('从页面数据取到文案（标题+正文）:', composed.substring(0, 80) + '…');
        return composed;
      }
    }

    // 2) DOM 兜底：剔掉底部日期/互动区后的「标题+正文」
    const fromDom = this.extractNoteTextFromDom();
    if (fromDom) {
      this.debugLog('从 DOM 取到文案:', fromDom.substring(0, 80) + '…');
      return fromDom;
    }

    // 3) 原有的宽松选择器链（保底，别把老路全断了）
    const selectors = [
      '.note-content',
      '.note-detail', 
      '.note-content-item',
      '.note-text-content',
      '.content-text',
      '.note_text',
      '.note',
      '[data-note-id]',
      '.detail-content',
      '.note-detail-wrapper',
      '.note-detail-content',
      '.main-content',
      '.detail-desc'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        let text = element.textContent || '';
        text = this.cleanTextContent(text);
        if (text.trim().length > 5) {
          this.debugLog(`从选择器${selector}提取到文案:`, text.substring(0, 100) + '...');
          return text;
        }
      }
    }

    // 额外尝试从meta description获取
    const metaDesc = SocialDomUtils.readMeta('meta[name="description"]');
    if (metaDesc) {
      const text = this.cleanTextContent(metaDesc);
      if (text.trim().length > 5) {
        this.debugLog('从meta description提取到文案:', text);
        return text;
      }
    }

    this.debugLog('未找到有效的文案内容');
    return '';
  }


  /**
   * 清理文本内容
   * @param {string} text - 原始文本
   * @returns {string} 清理后的文本
   */
  cleanTextContent(text) {
    if (!text) return '';

    // 基础清理：替换多个连续空格为单个空格，但保留换行符
    // 注意：详细的字符过滤现在由 social-title-processor.js 处理
    return text.replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim();
  }

  /**
   * 初始化MutationObserver监听机制
   * 优化：增加防抖 + 移除不必要的 characterData
   */
  initObserver() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new MutationObserver(() => {
      // ✅ 优化：防抖，300ms 内密集 DOM 变化只执行一次
      // 小红书页面初始加载时 body 变化极其密集（Vue 渲染），
      // 防抖避免每次 mutation 都触发 extractPublishDate() 的多级 DOM 查询
      if (this._timeUpdateTimer) clearTimeout(this._timeUpdateTimer);
      this._timeUpdateTimer = setTimeout(() => {
        this._timeUpdateTimer = null;
        this.updateTimeDisplay();
      }, 300);
    });

    // ✅ 优化：移除 characterData
    // Vue 实例挂载会触发 childList / subtree 变化（节点插入），
    // 无需监听文本节点。移除后文本渲染/输入不触发不必要的 DOM 查询。
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * 停止观察
   * ✅ 优化：增加防抖定时器清理
   */
  stopObserver() {
    if (this._timeUpdateTimer) {
      clearTimeout(this._timeUpdateTimer);
      this._timeUpdateTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * 更新时间显示
   */
  updateTimeDisplay() {
    // 当DOM变化时重新提取时间，这里主要用于检测是否有新的Vue实例挂载
    const publishDate = this.extractPublishDate();
    if (publishDate) {
      // 成功提取到时间后停止观察器，避免重复提取
      this.stopObserver();
    }
  }

  /**
   * 从Vue实例获取精确时间戳
   * @returns {string} 格式化后的发布时间
   */
  extractVueTime() {
    try {
      this.debugLog('开始从Vue实例提取时间');

      // 1. 尝试从DOM元素获取Vue实例
      const candidates = [
        '.note-content', '.detail-page', '.main-content', '[data-v-scope]',
        '.note-header', '.author-info', '.note-detail', '.app-main', 
        '#app', '[data-testid="note-container"]'
      ].map(selector => document.querySelector(selector)).filter(Boolean);

      this.debugLog(`找到${candidates.length}个候选元素`);

      for (const candidate of candidates) {
        const vueInstance = this.getVueInstance(candidate);
        if (vueInstance) {
          this.debugLog('找到Vue实例');
          // 尝试从note对象中提取时间
          const note = this.extractNoteFromVue(vueInstance);
          if (note) {
            const timeFromNote = this.extractTimeFromObject(note);
            if (timeFromNote) return timeFromNote;
          }

          // 尝试直接从Vue实例中查找时间字段
          const timeFromInstance = this.extractTimeFromObject(vueInstance);
          if (timeFromInstance) return timeFromInstance;
        }
      }

      // 2. 备用方案：从window对象查找Vue实例
      const windowVueKeys = Object.keys(window).filter(key => 
        key.includes('vue') || key.includes('Vue') || key.includes('__VUE__')
      );

      this.debugLog(`找到${windowVueKeys.length}个window Vue相关属性`);

      for (const key of windowVueKeys) {
        const value = window[key];
        if (value && typeof value === 'object') {
          const formatted = this.tryExtractTimeFromObject(value);
          if (formatted) return formatted;
        }
      }

      // 3. 备用方案：从全局数据中获取
      const globalData = this.getGlobalData();
      if (globalData) {
        this.debugLog('找到全局数据对象');
        return this.tryExtractTimeFromObject(globalData);
      }

      this.debugLog('Vue实例时间提取失败');
    } catch (error) {
      this.errorLog('从Vue实例提取时间失败', error);
    }
    return '';
  }

  /**
   * 从Vue实例中提取note对象
   * @param {Object} vueInstance - Vue实例
   * @returns {Object|null} note对象
   */
  extractNoteFromVue(vueInstance) {
    return vueInstance.note || 
           vueInstance._data?.note || 
           vueInstance.$data?.note ||
           vueInstance.data?.note ||
           vueInstance._data?.detail ||
           vueInstance.$data?.detail;
  }

  /**
   * 尝试从对象中提取时间 - 扩展版本
   * @param {Object} obj - 要检查的对象
   * @param {WeakSet} [seen] - v2.5.48：已访问对象集合，防循环引用
   * @param {number} [depth] - v2.5.48：当前深度，防深层嵌套爆栈
   * @returns {string} 格式化后的时间
   */
  tryExtractTimeFromObject(obj, seen, depth) {
    if (!obj || typeof obj !== 'object') {
      return '';
    }

    // v2.5.48：原实现只跳过数组，注释写「避免循环引用」其实没做到。
    // Vue 数据里父子互相引用很常见，一路递归下去会爆栈，整站提取直接失败。
    // 现在用 WeakSet 记录走过的对象，并对深度设上限。
    var currentDepth = depth || 0;
    if (currentDepth > 20) {
      this.debugLog('对象层级超过 20 层，停止递归');
      return '';
    }
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) {
      this.debugLog('检测到循环引用，跳过');
      return '';
    }
    seen.add(obj);

    try {
      this.debugLog('尝试从对象提取时间');
      // 遍历对象的所有属性
      for (const [key, value] of Object.entries(obj)) {
        // 跳过一些不相关的属性
        if (this.isIrrelevantProperty(key)) {
          continue;
        }

        if (typeof value === 'string' || typeof value === 'number') {
          // 尝试直接解析时间
          const formatted = this.formatTime(value);
          if (formatted) {
            this.debugLog(`从属性 ${key} 成功提取时间: ${formatted}`);
            return formatted;
          }
        } else if (typeof value === 'object' && value !== null) {
          // 递归检查对象属性
          if (value instanceof Date) {
            return this.formatTime(value);
          } else if (!Array.isArray(value)) {
            // v2.5.48：带上 seen / depth，真正防住循环引用与深层嵌套
            const formatted = this.tryExtractTimeFromObject(value, seen, currentDepth + 1);
            if (formatted) return formatted;
          }
        }
      }

      // 直接检查对象中是否包含时间相关字段
      const directFields = ['time', 'createTime', 'publishTime', 'createdAt', 'updatedAt', 'date'];
      for (const field of directFields) {
        if (obj[field]) {
          const formatted = this.formatTime(obj[field]);
          if (formatted) return formatted;
        }
      }

    } catch (error) {
      this.errorLog('从对象提取时间失败', error);
    }

    return '';
  }

  /**
   * 提取对象中的时间字段（优化版）
   * @param {Object} obj - 要检查的对象
   * @returns {string|null} 格式化后的时间或null
   */
  extractTimeFromObject(obj, seen, depth) {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    // v2.5.48：与 tryExtractTimeFromObject 同样的问题，补上循环引用与深度防护
    var currentDepth = depth || 0;
    if (currentDepth > 20) return null;
    if (!seen) seen = new WeakSet();
    if (seen.has(obj)) return null;
    seen.add(obj);

    try {
      this.debugLog(`检查对象中的时间字段`);
      // 尝试各种可能的时间字段名
      const timeFields = ['time', 'createTime', 'publishTime', 'createdAt', 'updatedAt', 'date'];
      for (const field of timeFields) {
        if (obj[field]) {
          this.debugLog(`找到时间字段 ${field}:`, obj[field]);
          const formatted = this.formatTime(obj[field]);
          if (formatted) return formatted;
        }
      }

      // 如果直接字段没找到，尝试递归查找
      for (const [key, value] of Object.entries(obj)) {
        if (this.isIrrelevantProperty(key)) {
          continue;
        }

        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          const nestedTime = this.extractTimeFromObject(value, seen, currentDepth + 1);
          if (nestedTime) return nestedTime;
        }
      }

    } catch (error) {
      this.errorLog('提取时间字段失败', error);
    }

    return null;
  }

  /**
   * 检查属性是否不相关
   * @param {string} key - 属性名
   * @returns {boolean} 是否不相关
   */
  isIrrelevantProperty(key) {
    const irrelevantPatterns = ['version', 'id', 'type', 'status', 'name', 'title'];
    return irrelevantPatterns.some(pattern => key.toLowerCase().includes(pattern));
  }

  /**
   * 获取Vue实例
   * @param {Element} element - DOM元素
   * @returns {Object|null} Vue实例
   */
  getVueInstance(element) {
    if (!element) return null;

    try {

      // 1. Vue 2.x 实例通常挂载在__vue__属性上
      if (element.__vue__) {
        return element.__vue__;
      }

      // 2. Vue 3.x 实例可能通过不同的方式访问
      const vueProps = Object.getOwnPropertyNames(element).filter(prop => 
        prop.includes('vue') || prop.includes('__v') || prop.includes('VNode') || 
        prop.startsWith('__') || prop.includes('react')
      );


      for (const prop of vueProps) {
        try {
          const value = element[prop];
          if (value && typeof value === 'object') {
            // 检查是否有Vue实例的特征
            if (value.$data || value._data || value.note || 
                value.$options || value.$el || value.render || 
                value.proxy || value._isVue) {
              return value;
            }
          }
        } catch (e) {
          // 访问某些属性可能会抛出异常，忽略
        }
      }

      // 3. 尝试直接在元素上查找Vue实例的特殊标记
      if (element._vnode || element.__reactInternalInstance || 
          element._reactRootContainer) {
        return element;
      }

      // 4. 递归查找父元素的Vue实例
      if (element.parentElement) {
        return this.getVueInstance(element.parentElement);
      }
    } catch (error) {
      console.error('获取Vue实例失败:', error);
    }

    return null;
  }

  /**
   * 获取全局数据
   * @returns {Object|null} 全局数据对象
   */
  getGlobalData() {
    try {
      // 尝试从全局变量中获取数据
      const globalKeys = Object.keys(window).filter(key => 
        key.includes('__INITIAL_DATA__') || 
        key.includes('__NUXT__') || 
        key.includes('__PRELOADED_STATE__')
      );

      for (const key of globalKeys) {
        const data = window[key];
        if (data && typeof data === 'object') {
          return data;
        }
      }

      // 尝试从script标签中提取JSON数据
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('note') && text.includes('time')) {
          try {
            // 尝试提取JSON格式的数据
            const jsonMatch = text.match(/({[^}]*note[^}]*time[^}]*})/);
            if (jsonMatch && jsonMatch[1]) {
              return JSON.parse(jsonMatch[1]);
            }
          } catch (e) {
            // JSON解析失败，忽略
          }
        }
      }
    } catch (error) {
      console.error('获取全局数据失败:', error);
    }
    return null;
  }

  /**
   * 格式化时间戳为标准格式
   * @param {number|string} timestamp - 时间戳或时间字符串
   * @returns {string} 格式化后的时间，格式：yyyy-MM-dd HH:mm:ss
   */
  formatTime(timestamp) {
    try {
      // 确保时间戳是数字类型
      const ts = Number(timestamp);
      if (isNaN(ts)) {
        this.debugLog('时间戳格式无效:', timestamp);
        return '';
      }

      const date = new Date(ts);

      // 检查日期是否有效
      if (isNaN(date.getTime())) {
        this.debugLog('日期解析失败:', timestamp);
        return '';
      }

      // 格式化为 yyyy/MM/dd HH:mm:ss 格式（v2.5.48：与全项目「发布日期」统一为斜杠）
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');

      const formatted = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
      this.debugLog('格式化时间成功:', formatted);
      return formatted;
    } catch (error) {
      this.errorLog('格式化时间失败', error);
      return '';
    }
  }

  /**
   * 提取发布日期
   *
   * 取值顺序（2.5.29 按实测结果重排，越靠前越可靠；2.6.0 在最前面加了一手数据桥）：
   *   0. 页面数据桥里的 `time`（v2.6.0，毫秒时间戳，任何入口都拿得到）
   *   1. 页面数据里的当前笔记时间（按 noteId 精确匹配，精确到秒）
   *   2. 笔记自己的日期元素 `.note-content .bottom-left .date`
   *   3. meta 标签
   *   4. 已知的窄选择器
   *   5. Vue 实例（小红书线上不暴露，仅兜底）
   *   6. 页面数据脚本里的时间戳
   *
   * 已删除：`[data-time]`、`[class*="time" i]`、整页文本扫描。
   * 这三条会命中覆盖整页的容器元素（实测命中 <div.feeds-page>，995 字文本里含"现在"），
   * 导致把"当前时间"当成发布时间返回。
   *
   * @returns {string} 格式化后的发布日期
   */
  extractPublishDate() {
    try {
      this.debugLog('开始提取发布日期');

      // 0. 桥里的一手时间戳（v2.6.0，毫秒级，最准）
      //
      // 为什么必须放最前：content script 在隔离世界读不到 `window.__INITIAL_STATE__`，
      // 而 SSR 内联脚本只含**首屏那条**笔记。从搜索页 / 用户主页点开另一条笔记时，
      // 上面两条路都拿不到 → 一路落到 `.bottom-left .date` 的「3小时前」，
      // 被 parseRelativeTime 用「现在减 3 小时」算出一个假秒数。
      const bridgedTime = this.extractTimeFromBridge();
      if (bridgedTime) {
        this.debugLog('从页面数据桥获取发布时间:', bridgedTime);
        return bridgedTime;
      }

      // 1. 页面数据（最准）
      const stateTime = this.extractTimeFromNoteState();
      if (stateTime) {
        this.debugLog('成功从页面数据获取发布时间:', stateTime);
        return stateTime;
      }

      // 2. 笔记自己的日期元素
      const dateElementTime = this.extractTimeFromNoteDateElement();
      if (dateElementTime) {
        this.debugLog('成功从笔记日期元素获取发布时间:', dateElementTime);
        return dateElementTime;
      }

      // 3. meta 标签
      const metaTime = this.extractTimeFromMeta();
      if (metaTime) {
        this.debugLog('成功从meta获取发布时间:', metaTime);
        return metaTime;
      }

      // 4. 已知的窄选择器
      const selectorTime = this.extractTimeFromKnownSelectors();
      if (selectorTime) {
        this.debugLog('成功从元素选择器获取发布时间:', selectorTime);
        return selectorTime;
      }

      // 5. Vue 实例（兜底，小红书线上基本取不到）
      const vueTime = this.extractVueTime();
      if (vueTime) {
        // extractVueTime 可能已经返回格式化后的字符串，
        // 再调一次 formatTime 会让 Number('2026-10-22 00:35:41') 变成 NaN，
        // 把已经取到的时间丢成空字符串。这里先判断格式。
        const normalized = /^\d{4}-\d{1,2}-\d{1,2}/.test(String(vueTime))
          ? String(vueTime)
          : this.formatTime(Number(vueTime));
        if (normalized) {
          this.debugLog('成功从Vue实例获取发布时间:', normalized);
          return normalized;
        }
      }

      // 6. 页面数据脚本里的时间戳（最后的兜底）
      const scriptTime = this.extractTimeFromDataScript();
      if (scriptTime) {
        this.debugLog('成功从数据脚本获取发布时间:', scriptTime);
        return scriptTime;
      }

      this.debugLog('所有提取方法均失败');
    } catch (error) {
      this.errorLog('提取发布日期失败:', error);
    }
    return '';
  }

  /**
   * 取当前笔记ID（24 位十六进制）
   * @returns {string}
   */
  getCurrentNoteId() {
    try {
      const path = (typeof location !== 'undefined' && location.pathname) || '';
      const matched = path.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})/i);
      return matched ? matched[1] : '';
    } catch (error) {
      return '';
    }
  }

  /**
   * 清理日期文本：去掉"编辑于"前缀、末尾 IP 属地、多余空白
   * 超过 30 字直接丢弃，防止把整段页面文字当成时间
   * @param {string} raw - 原始文本
   * @returns {string}
   */
  cleanDateText(raw) {
    let text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    text = text.replace(/^(编辑于|发布于|修改于|发表于)\s*/, '');
    // 去掉末尾 IP 属地，如 "2小时前 贵州" → "2小时前"
    text = text.replace(/\s+(中国)?[\u4e00-\u9fa5]{2,6}$/, '').trim();
    if (text.length > 30) return '';
    return text;
  }

  /**
   * 从页面数据里取当前笔记的时间
   * 两个来源：页面全局状态 window.__INITIAL_STATE__（火狐内容脚本需经 wrappedJSObject 才能看到页面变量），
   * 以及 SSR 直出的内联 script 文本（两种浏览器都能读）
   * @returns {string}
   */
  extractTimeFromNoteState() {
    try {
      const noteId = this.getCurrentNoteId();
      if (!noteId) return '';

      // 1. 页面全局状态
      const pageWindow = (typeof window !== 'undefined' && window.wrappedJSObject)
        ? window.wrappedJSObject
        : window;
      const state = pageWindow && pageWindow.__INITIAL_STATE__;
      const timeFromState = this.pickNoteTimeFromState(state, noteId);
      if (timeFromState) return timeFromState;

      // 2. SSR 内联脚本：按 "time":<13位>, "noteId":"<当前笔记ID>" 配对
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (!text.includes(noteId)) continue;

        let matched = new RegExp('"time"\\s*:\\s*(\\d{13})\\s*,\\s*"noteId"\\s*:\\s*"' + noteId + '"').exec(text);
        if (!matched) {
          matched = new RegExp('"noteId"\\s*:\\s*"' + noteId + '"[\\s\\S]{0,400}?"time"\\s*:\\s*(\\d{13})').exec(text);
        }
        if (matched) {
          const formatted = this.formatTime(Number(matched[1]));
          if (formatted) return formatted;
        }
      }
    } catch (error) {
      this.errorLog('从页面数据提取时间失败', error);
    }
    return '';
  }

  /**
   * 从页面状态对象里挑出当前笔记的时间
   * @param {Object} state - 页面状态对象
   * @param {string} noteId - 笔记ID
   * @returns {string}
   */
  pickNoteTimeFromState(state, noteId) {
    try {
      if (!state || typeof state !== 'object') return '';
      const map = state.noteDetailMap || (state.note && state.note.noteDetailMap);
      if (!map || !map[noteId]) return '';
      const item = map[noteId];
      const note = item.note || item;
      const ts = note && (note.time || note.publishTime || note.createTime);
      if (ts === undefined || ts === null || isNaN(Number(ts))) return '';
      return this.formatTime(Number(ts));
    } catch (error) {
      return '';
    }
  }

  /**
   * 从笔记自己的日期元素取时间（排除评论里的 .date）
   * @returns {string}
   */
  extractTimeFromNoteDateElement() {
    try {
      const selectors = [
        '.note-content .bottom-left .date',
        '.note-content .bottom-container .date',
        '.note-scroller .bottom-left .date'
      ];
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (!element) continue;
        // 评论里的日期不是发布时间
        if (element.closest('.comment-item') || element.closest('.comment-list')) continue;
        const text = this.cleanDateText(element.textContent);
        if (!text) continue;
        const parsed = this.parseRelativeTime(text);
        if (parsed) return parsed;
      }
    } catch (error) {
      this.errorLog('从笔记日期元素提取时间失败', error);
    }
    return '';
  }

  /**
   * 从 meta 标签取时间
   * @returns {string}
   */
  extractTimeFromMeta() {
    try {
      const metaTime = SocialDomUtils.readMeta('meta[property="article:published_time"]') ||
                      SocialDomUtils.readMeta('meta[name="datePublished"]') ||
                      SocialDomUtils.readMeta('meta[itemprop="datePublished"]');
      if (!metaTime) return '';
      const content = metaTime;
      if (!content) return '';
      const parsed = new Date(content);
      if (isNaN(parsed.getTime())) return '';
      return this.formatTime(parsed.getTime());
    } catch (error) {
      return '';
    }
  }

  /**
   * 用已知的窄选择器找时间（已剔除会命中整页容器的宽松选择器）
   * @returns {string}
   */
  extractTimeFromKnownSelectors() {
    const timeSelectors = [
      '.publish-time',
      '.note-time',
      '.time-info',
      '[data-testid="publish-time"]',
      '.author-info .time',
      '.user-info .time',
      '.note-header .time',
      '.creator-info .time',
      '.timeago',
      '[datetime]',
      '.note-detail time',
      '.meta-item time',
      '.detail-time time',
      '.note-publish-time time',
      '.social-time time'
    ];

    for (const selector of timeSelectors) {
      try {
        const element = document.querySelector(selector);
        if (!element) continue;

        const text = this.cleanDateText(element.textContent);
        if (text) {
          const parsed = this.parseRelativeTime(text);
          if (parsed) return parsed;
        }

        const dataTime = element.getAttribute('datetime') || element.getAttribute('data-time');
        if (dataTime) {
          const parsedDate = new Date(dataTime);
          if (!isNaN(parsedDate.getTime())) {
            const formatted = this.formatTime(parsedDate.getTime());
            if (formatted) return formatted;
          }
        }
      } catch (error) {
        this.debugLog('选择器解析失败:', selector);
      }
    }
    return '';
  }

  /**
   * 从页面数据脚本里捞时间戳（不区分笔记，最后的兜底）
   * @returns {string}
   */
  extractTimeFromDataScript() {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        // 只认带 noteDetailMap 的 SSR 状态脚本，避免从任意脚本里瞎猜
        if (text.length < 1000 || !text.includes('noteDetailMap')) continue;

        const patterns = [
          /"publishTime"\s*:\s*(\d{13})/,
          /"createTime"\s*:\s*(\d{13})/,
          /"publish_time"\s*:\s*(\d{13})/,
          /"create_time"\s*:\s*(\d{13})/,
          /"time"\s*:\s*(\d{13})/
        ];
        for (const pattern of patterns) {
          const matched = pattern.exec(text);
          if (matched) {
            const formatted = this.formatTime(Number(matched[1]));
            if (formatted) return formatted;
          }
        }
      }
    } catch (error) {
      this.errorLog('从数据脚本提取时间失败', error);
    }
    return '';
  }

  /**
   * 检查文本是否匹配相对时间关键词
   * @param {string} text - 要检查的文本
   * @param {Array<string>} keywords - 关键词数组
   * @returns {boolean} 是否匹配
   */
  matchesRelativeTime(text, keywords) {
    return keywords.some(keyword => text.includes(keyword));
  }


  /**
   * 解析相对时间为绝对时间
   * @param {string} timeText - 相对时间文本
   * @returns {string} 格式化后的绝对时间
   */
  parseRelativeTime(timeText) {
    try {
      this.debugLog('解析相对时间文本:', timeText);

      const now = new Date();
      let targetDate = new Date();
      const trimmedText = String(timeText || '').replace(/\s+/g, ' ').trim();

      // 防御：整页/容器文本里可能含有"现在""刚刚""前天"等字样，
      // 不限制长度就会被误判成发布时间（实测 <div.feeds-page> 就踩过这个坑）。
      // 正常的发布时间文本都在 20 字以内。
      if (!trimmedText || trimmedText.length > 30) {
        this.debugLog('文本为空或过长，不作为时间解析:', trimmedText.slice(0, 40));
        return '';
      }

      // 匹配不同的时间格式
      if (this.matchesRelativeTime(trimmedText, ['刚刚', '现在', '刚刚发布', '刚刚更新'])) {
        // "现在/刚刚"只在短文本上成立，长文本里出现这两个词基本是正文内容
        if (trimmedText.length > 8) {
          this.debugLog('文本含"现在/刚刚"但过长，忽略:', trimmedText.slice(0, 40));
          return '';
        }
        this.debugLog('匹配到"刚刚"格式');
        // 不做调整，使用当前时间
      } else if (trimmedText.includes('分钟前')) {
        this.debugLog('匹配到"分钟前"格式');
        const minutes = parseInt(trimmedText.match(/\d+/)?.[0] || '0');
        targetDate.setMinutes(now.getMinutes() - minutes);
      } else if (trimmedText.includes('小时前')) {
        this.debugLog('匹配到"小时前"格式');
        const hours = parseInt(trimmedText.match(/\d+/)?.[0] || '0');
        targetDate.setHours(now.getHours() - hours);
      } else if (trimmedText.includes('天前')) {
        this.debugLog('匹配到"天前"格式');
        const days = parseInt(trimmedText.match(/\d+/)?.[0] || '0');
        targetDate.setDate(now.getDate() - days);
      } else if (trimmedText.includes('月前')) {
        this.debugLog('匹配到"月前"格式');
        const months = parseInt(trimmedText.match(/\d+/)?.[0] || '0');
        targetDate.setMonth(now.getMonth() - months);
      } else if (trimmedText.includes('年前')) {
        this.debugLog('匹配到"年前"格式');
        const years = parseInt(trimmedText.match(/\d+/)?.[0] || '0');
        targetDate.setFullYear(now.getFullYear() - years);
      } else if (trimmedText.includes('昨天')) {
        this.debugLog('匹配到"昨天"格式');
        targetDate.setDate(now.getDate() - 1);
      } else if (trimmedText.includes('前天')) {
        this.debugLog('匹配到"前天"格式');
        targetDate.setDate(now.getDate() - 2);
      } else if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmedText)) {
        this.debugLog('匹配到标准日期格式');
        // 已经是标准日期格式
        if (trimmedText.includes(' ')) {
          return trimmedText;
        }
        return `${trimmedText} 00:00:00`;
      } else if (/\d{1,2}[-/]\d{1,2}/.test(trimmedText)) {
        this.debugLog('匹配到月日格式');
        // 月日格式，添加当前年份
        const year = now.getFullYear();
        const dateStr = `${year}-${trimmedText}`.replace('/', '-');
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return this.formatTime(parsed.getTime());
        }
      } else if (/^\d{10}$/.test(trimmedText)) {
        this.debugLog('匹配到10位时间戳');
        // 10位时间戳
        const timestamp = parseInt(trimmedText, 10);
        if (!isNaN(timestamp)) {
          return this.formatTime(timestamp * 1000);
        }
      } else if (/^\d{13}$/.test(trimmedText)) {
        this.debugLog('匹配到13位时间戳');
        // 13位时间戳
        const timestamp = parseInt(trimmedText, 10);
        if (!isNaN(timestamp)) {
          return this.formatTime(timestamp);
        }
      } else {
        this.debugLog('尝试直接解析时间字符串');
        // 尝试直接解析
        const parsed = new Date(trimmedText);
        if (!isNaN(parsed.getTime())) {
          return this.formatTime(parsed.getTime());
        }
        return '';
      }

      const formatted = this.formatTime(targetDate.getTime());
      this.debugLog('相对时间解析结果:', formatted);
      return formatted;
    } catch (error) {
      this.errorLog('解析相对时间失败', error);
      return '';
    }
  }

  /**
   * 提取所有字段
   * @returns {Promise<Object>} 包含所有字段的对象
   */
  async extractAllFields() {
    this.debugLog('开始提取所有字段');

    // 初始化监听机制，确保能够捕获动态加载的Vue实例
    this.initObserver();

    // 等待一小段时间让DOM完全加载和Vue实例挂载
    const publishDate = this.extractPublishDate();

    // 如果第一次提取失败，尝试再次提取
    let finalPublishDate = publishDate;
    if (!publishDate) {
      this.debugLog('第一次提取发布日期失败，尝试第二次提取');
      // 尝试直接从网络请求中获取（通过XMLHttpRequest拦截）
      finalPublishDate = this.tryExtractFromNetwork();

      // 如果还是失败，尝试使用document.evaluate进行更深入的DOM查询
      if (!finalPublishDate) {
        this.debugLog('尝试使用XPath查询时间元素');
        finalPublishDate = this.tryExtractWithXPath();
      }
    }

    const url = window.location.href;
    const title = await this.extractTitle();

    // 提取作者主页和作者ID
    const authorHomepage = this.extractAuthorHomepage();
    // 异步提取作者ID（从作者主页获取）
    let authorId = '';
    if (authorHomepage) {
      try {
        authorId = await this.extractAuthorId();
      } catch (error) {
        this.errorLog('提取作者ID时出错', error);
        authorId = ''; // 出错时保持为空
      }
    }

    // 字段外壳由 SocialFieldsBuilder 套用统一模板生成；
    // 发布日期走了多级兜底链路、作者ID 需要先判断作者主页是否存在，这两个字段通过 overrides 传入预计算结果。
    const result = await SocialFieldsBuilder.build(this, {
      overrides: {
        '作者ID': () => authorId, // 使用从作者主页提取的作者ID
        '发布日期': () => finalPublishDate
      }
    });

    this.debugLog('提取完成，发布日期字段值:', result['发布日期']);
    this.debugLog('作者ID字段值:', result['作者ID']);
    return result;
  }

  /**
   * 尝试从网络请求中提取时间信息
   * @returns {string} 格式化后的时间或空字符串
   */
  tryExtractFromNetwork() {
    try {
      this.debugLog('尝试从网络请求提取时间');

      // 尝试从document对象中获取可能的时间信息
      // 搜索所有包含数字的元素，特别是可能包含时间戳的地方
      const allElements = document.querySelectorAll('*');
      const numberPattern = /\d{10,13}/;

      for (let i = 0; i < Math.min(allElements.length, 500); i++) {
        const element = allElements[i];
        const text = element.textContent || '';
        const attributes = Array.from(element.attributes);

        // 检查文本内容
        const textMatch = numberPattern.exec(text);
        if (textMatch) {
          this.debugLog('找到可能的时间戳文本:', textMatch[0]);
          const timestamp = Number(textMatch[0]);
          // 根据长度判断是秒还是毫秒
          const realTimestamp = timestamp.toString().length === 10 ? timestamp * 1000 : timestamp;

          // 验证是否是合理的时间戳（过去50年内）
          const now = Date.now();
          const fiftyYearsAgo = now - (50 * 365 * 24 * 60 * 60 * 1000);

          if (realTimestamp > fiftyYearsAgo && realTimestamp <= now) {
            const formatted = this.formatTime(realTimestamp);
            if (formatted) return formatted;
          }
        }

        // 检查属性值
        for (const attr of attributes) {
          const attrMatch = numberPattern.exec(attr.value);
          if (attrMatch) {
            this.debugLog('找到可能的时间戳属性:', attr.name, '=', attrMatch[0]);
            const timestamp = Number(attrMatch[0]);
            const realTimestamp = timestamp.toString().length === 10 ? timestamp * 1000 : timestamp;

            // 验证时间戳
            const now = Date.now();
            const fiftyYearsAgo = now - (50 * 365 * 24 * 60 * 60 * 1000);

            if (realTimestamp > fiftyYearsAgo && realTimestamp <= now) {
              const formatted = this.formatTime(realTimestamp);
              if (formatted) return formatted;
            }
          }
        }
      }
    } catch (error) {
      this.errorLog('从网络请求提取时间失败', error);
    }
    return '';
  }

  /**
   * 使用XPath尝试提取时间信息
   * @returns {string} 格式化后的时间或空字符串
   */
  tryExtractWithXPath() {
    try {
      this.debugLog('使用XPath查询时间元素');

      // 尝试不同的XPath表达式
      const xpathExpressions = [
        "//*[contains(text(), '前')]",
        "//*[contains(text(), '分钟')]",
        "//*[contains(text(), '小时')]",
        "//*[contains(text(), '天')]",
        "//*[contains(@class, 'time')]",
        "//*[@datetime]",
        "//*[@data-time]",
        "//time",
        "//span[contains(@class, 'time')]",
        "//div[contains(@class, 'time')]",
        "//meta[@property='article:published_time']",
        "//meta[@name='datePublished']"
      ];

      for (const expr of xpathExpressions) {
        this.debugLog('执行XPath:', expr);
        const result = document.evaluate(expr, document, null, XPathResult.ANY_TYPE, null);
        let node = result.iterateNext();

        while (node) {
          this.debugLog('XPath找到节点:', node.tagName);

          // 获取文本内容
          const text = node.textContent?.trim();
          if (text && text.length < 50) { // 限制长度以避免大文本
            this.debugLog('XPath节点文本:', text);
            const parsed = this.parseRelativeTime(text);
            if (parsed) return parsed;
          }

          // 检查datetime属性
          const datetime = node.getAttribute('datetime');
          if (datetime) {
            this.debugLog('XPath节点datetime属性:', datetime);
            try {
              return this.formatTime(new Date(datetime).getTime());
            } catch (e) {
              this.debugLog('解析datetime失败:', e);
            }
          }

          // 检查data-time属性
          const dataTime = node.getAttribute('data-time');
          if (dataTime) {
            this.debugLog('XPath节点data-time属性:', dataTime);
            try {
              return this.formatTime(new Date(dataTime).getTime());
            } catch (e) {
              this.debugLog('解析data-time失败:', e);
            }
          }

          // 检查content属性（用于meta标签）
          const content = node.getAttribute('content');
          if (content) {
            this.debugLog('XPath节点content属性:', content);
            try {
              return this.formatTime(new Date(content).getTime());
            } catch (e) {
              this.debugLog('解析content失败:', e);
            }
          }

          node = result.iterateNext();
        }
      }
    } catch (error) {
      this.errorLog('使用XPath提取时间失败', error);
    }
    return '';
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

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
if (typeof window !== 'undefined') {
  window.XiaohongshuSocialExtractor = XiaohongshuSocialExtractor;
}
