// 快手社交媒体提取器 - 增强版
class KuaishouSocialExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'kuaishou_social';
  }
  
  // 检查当前页面是否为快手作品详情页
  
  // 提取标题 - 使用共享标题处理器
  async extractTitle() {
    try {
      // 获取所需的数据
      const authorName = await this.extractAuthorName();
      const authorId = await this.extractAuthorId();
      const pageText = await this.extractDescription();
      const publishDate = await this.extractPublishDate();
      
      // 使用共享标题处理器生成标题，传递platform参数
      return SocialTitleProcessor.generatePageTitle(authorName, pageText, publishDate, {
        platform: 'kuaishou'
      }, authorId);
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }
  

  

  
  // 提取作者昵称
  extractAuthorName() {
    try {
      // 根据示例页面代码段分析，作者昵称在 class="profile-user-name-title" 的元素中
      const selectors = [
        '.profile-user-name-title',  // 主要选择器，示例中的位置
        '.user-name',
        '.author-name',
        '.nickname',
        '.username',
        '[class*="user-name"]',
        '[class*="author-name"]',
        '[class*="nickname"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          // 去除前后空格和特殊字符
          let authorName = element.textContent.trim().replace(/^\s+|\s+$/g, '');
          
          return authorName;
        }
      }
      
      // 备用方案：从用户信息区域查找
      const userInfoElements = document.querySelectorAll('[class*="profile-user"], [class*="user-info"]');
      for (const container of userInfoElements) {
        const nameElement = container.querySelector('[class*="name"], [class*="title"]');
        if (nameElement && nameElement.textContent.trim()) {
          let authorName = nameElement.textContent.trim().replace(/^\s+|\s+$/g, '');
          
          return authorName;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取作者昵称失败:', error);
      return '';
    }
  }
  
  // 从当前页面读取作者的内部 userId（原有逻辑，保留作为抓取失败时的回退）
  extractAuthorInternalId() {
    try {
      // 方法1: 直接从作者主页URL中提取ID
      const homepage = this.extractAuthorHomepage();
      if (homepage) {
        const profileMatch = homepage.match(/\/profile\/([a-zA-Z0-9]+)/);
        if (profileMatch && profileMatch[1]) {
          return profileMatch[1];
        }
      }

      // 方法2: 从URL参数中直接提取userId（复用原有逻辑）
      const urlParams = new URLSearchParams(window.location.search);
      const urlUserId = urlParams.get('userId');
      if (urlUserId) {
        return urlUserId;
      }
      
      // 方法3: 从页面脚本中的埋点数据提取（复用原有逻辑）
      const scriptTags = document.querySelectorAll('script');
      
      for (const script of scriptTags) {
        const text = script.textContent;
        
        // 匹配埋点数据中的s_author_id
        const authorIdMatch = text.match(/"s_author_id":"([a-zA-Z0-9]+)"/);
        if (authorIdMatch && authorIdMatch[1]) {
          return authorIdMatch[1];
        }
        
        // 匹配通用的userId字段
        const userIdMatch = text.match(/"userId":"([a-zA-Z0-9]+)"/);
        if (userIdMatch && userIdMatch[1]) {
          return userIdMatch[1];
        }
        
        // 备用模式：查找包含作者ID的其他数据格式
        const generalIdMatch = text.match(/"([a-zA-Z0-9]{12,})"[^}]*"(?:author|user|profile)"/);
        if (generalIdMatch && generalIdMatch[1]) {
          return generalIdMatch[1];
        }
      }
      
      // 方法4: 从页面中的链接元素提取
      const profileLinks = document.querySelectorAll('a[href*="/profile/"]');
      if (profileLinks.length > 0) {
        const href = profileLinks[0].href;
        const profileMatch = href.match(/\/profile\/([a-zA-Z0-9]+)/);
        if (profileMatch && profileMatch[1]) {
          return profileMatch[1];
        }
      }
      
      return '';
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取作者ID失败:', error);
      return '';
    }
  }

  /**
   * 提取作者ID（快手号）
   *
   * 与抖音/小红书采用同一套策略（并发去重、缓存、抓取、写缓存统一由 AuthorIdFetcher 负责）：
   *   1. 用作者主页作为作者级缓存键，命中直接返回（键由 CacheKeyManager 归一化，
   *      同一作者的不同作品共用一条缓存）
   *   2. 未命中才用当前登录态打开作者主页，从主页内容里解析“快手号”
   *   3. 同一作者并发调用只发一次请求
   *
   * 抓取/解析失败时回退到页面内的内部 userId，避免字段变空。
   */
  async extractAuthorId() {
    const homepage = this.extractAuthorHomepage();

    if (!homepage) {
      return this.extractAuthorInternalId();
    }

    if (!this._authorIdInflight) this._authorIdInflight = new Map();
    return AuthorIdFetcher.dedupe(
      this._authorIdInflight,
      homepage,
      () => this._fetchAuthorKwaiId(homepage),
      { info: (msg) => ClipMateLog.debug('[KuaishouSocialExtractor] ' + msg) }
    );
  }

  /**
   * 从作者主页抓取快手号（缓存未命中才发请求；取不到时回退页面内内部ID）
   *
   * v2.7.1 提速（实测详情页首次提取约 25 秒，用户要的是「点完就出」）：
   *   - `parallelRenderer`：HTML 快枪与 iframe 渲染**同时开跑**，谁先给出快手号就用谁。
   *     老流程是串行 —— 当时以为主页是 SPA 空壳、HTML 解析必然落空，等于白花一次
   *     主页访问，之后才开始 iframe，白等一整个渲染周期。
   *   - `fetchTimeout: 3000`：HTML 这一路本来大概率拿不到，不许它无限期拖着。
   *
   * v2.7.10 事实修正：主页 HTML **不是**空壳，服务端直出了 `userDefineId`（快手号），
   * 401ms 就能解析出来。所以 HTML 这一路从「侥幸」变成「主力」，iframe 退成兜底，
   * 并用 `rendererDelay: 800` 让它在 HTML 命中时不启动（少发一次主页请求）。
   *
   * @param {string} homepage
   * @returns {Promise<string>}
   */
  async _fetchAuthorKwaiId(homepage) {
    const kwaiId = await AuthorIdFetcher.extract({
      site: 'kuaishou_social',
      homepage,

      // 快手号由前端渲染，静态 HTML 里通常没有：
      // 先用 parseKwaiIdFromHtml 解析静态内容，解析不到再由 renderer 用隐藏 iframe 渲染
      parse: (html) => this.parseKwaiIdFromHtml(html, homepage),
      renderer: () => this._renderKwaiIdViaIframe(homepage),

      // v2.7.1：两路并行 + HTML 只给 3 秒
      // v2.7.10：HTML 这条路实测 401ms 就能命中（字段修正为 userDefineId），
      //          所以 iframe 延后 800ms 才启动 —— 命中时它压根不开，主页请求 2 次 → 1 次
      parallelRenderer: true,
      fetchTimeout: 3000,
      rendererDelay: 800,

      // v2.5.82：占位符（`SSSSSSSSS`）绝不能当快手号 —— 在写缓存之前就挡掉，
      // 否则一旦写进作者级缓存，这个作者的每条作品都会显示假值。
      validate: (id) => !this._isPlaceholderKwaiId(id),

      log: {
        info: (msg) => ClipMateLog.debug('[KuaishouSocialExtractor][缓存功能] ' + msg),
        error: (msg, err) => console.error('[KuaishouSocialExtractor][缓存功能] ' + msg, err)
      }
    });

    // 历史缓存里可能已经存了污染值（v2.5.81 及以前写进去的 `SSSSSSSSS`），
    // 读缓存这一步不经过 validate，所以这里再挡一次。
    if (kwaiId && this._isPlaceholderKwaiId(kwaiId)) return this.extractAuthorInternalId();
    if (kwaiId) return kwaiId;

    // 兜底：页面内的内部 userId（格式与快手号不同，仅用于避免字段为空）
    const fallback = this.extractAuthorInternalId();
    return fallback;
  }

  /**
   * 用隐藏 iframe 渲染作者主页，从渲染后的页面文字里读“快手号”
   *
   * 快手号不出现在静态 HTML 里（前端请求数据后渲染），所以直接用 fetch 抓
   * HTML 是拿不到的。这里用同源 iframe 让浏览器自己把页面渲染出来，再从
   * 渲染结果的正文里取“快手号：xxx”。读不到就在超时后放弃。
   *
   * v2.7.1 提速三条（原来是固定 400ms 轮询 + 10 秒死等）：
   *   1. 轮询间隔 400ms → 100ms：数据一到，最多晚 100ms 被看见。
   *   2. 再加一个 MutationObserver：页面往 DOM 里插节点/改文本时立刻扫一次，
   *      不必等下一个轮询周期。两者互为兜底，谁先扫到算谁。
   *   3. 超时 10 秒 → 5 秒：真拿不到就回落到内部 userId（字段不会空），
   *      不再让人干等十秒。
   *
   * iframe 的 document 会在导航过程中被整体替换，所以 observer 只能在拿到
   * body 之后挂，而且每拍都要核对 document 有没有换过 —— 换过就重挂。
   *
   * @param {string} homepage
   * @returns {Promise<string>} 快手号，超时/失败返回空串
   */
  _renderKwaiIdViaIframe(homepage) {
    return new Promise((resolve) => {
      const INTERVAL = 100;
      const TIMEOUT = 5000;
      const KWAID_RE = /快手号[：:]\s*([0-9a-zA-Z._-]+)/;

      let done = false;
      let elapsed = 0;
      let timer = null;
      let iframe = null;
      let observer = null;
      let observedDoc = null;

      const stopObserver = () => {
        if (observer) {
          try { observer.disconnect(); } catch (e) { /* 忽略 */ }
          observer = null;
        }
        observedDoc = null;
      };

      const cleanup = () => {
        if (timer) clearInterval(timer);
        stopObserver();
        if (iframe) {
          try { iframe.remove(); } catch (e) { /* 忽略 */ }
        }
      };

      const finish = (value) => {
        if (done) return;
        done = true;
        cleanup();
        resolve(value || '');
      };

      // 扫一次 iframe 正文；命中真值就收工
      const scan = (doc) => {
        if (done || !doc) return;
        let text = '';
        try {
          text = (doc.body && doc.body.innerText) || '';
        } catch (e) {
          return; // 文档还没就绪或不可访问
        }
        const m = text.match(KWAID_RE);
        // v2.5.82：命中占位（`SSSSSSSSS`）时**不要**当成结果结束，
        // 继续等前端 hydration 把真值换进来；等不到就走超时兜底。
        if (m && m[1] && !this._isPlaceholderKwaiId(m[1])) {
          finish(m[1]);
        }
      };

      const ensureObserver = (doc) => {
        if (done || !doc || doc === observedDoc) return;
        if (typeof MutationObserver === 'undefined') return;

        stopObserver();
        observedDoc = doc;
        try {
          observer = new MutationObserver(() => scan(doc));
          observer.observe(doc.documentElement || doc, {
            subtree: true,
            childList: true,
            characterData: true
          });
        } catch (e) {
          observer = null;
        }
      };

      try {
        iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('tabindex', '-1');
        iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;border:0;opacity:0;pointer-events:none;';
        iframe.src = homepage;
        (document.body || document.documentElement).appendChild(iframe);
      } catch (e) {
        finish('');
        return;
      }

      timer = setInterval(() => {
        elapsed += INTERVAL;
        try {
          const doc = iframe && iframe.contentDocument;
          if (doc && doc.body) {
            ensureObserver(doc);
            scan(doc);
            if (done) return;
          }
        } catch (e) {
          // 文档还没就绪或不可访问，继续等
        }

        if (elapsed >= TIMEOUT) {
          finish('');
        }
      }, INTERVAL);
    });
  }

  /**
   * 这个「快手号」是不是服务端的占位符？
   *
   * v2.5.82 实测（2026-10-27，真机）：作者主页在 iframe 里渲染失败/还没来得及
   * hydration 时，页面骨架里是一串**同一字符重复的占位**（抓到的是 `SSSSSSSSS`，
   * 9 个 S）。它既不是快捷键字符也不是字体反爬 —— 就是模板占位。
   *
   * 以前这个占位会一路当成真值返回（还写进作者级缓存），用户看到「作者ID: SSSSSSSSS」。
   * 现在的处理：**只认不是占位的值**，认不出就走原来的兜底（页面内内部 userId）。
   *
   * 判据故意收得很窄（同一字符重复 ≥3）。不要加「全大写」「全是 x」这类规则：
   * 快手号本身允许字母，`XXXX` / `ABC` 都可能是真号，误杀比漏杀糟。
   *
   * @param {string} id
   * @returns {boolean} true = 占位符，不能用
   */
  _isPlaceholderKwaiId(id) {
    const s = String(id || '').trim();
    if (!s) return true;
    // 同一字符重复 ≥3（`SSSSSSSSS`、`xxxx`、`000000`）
    if (/^(.)\1{2,}$/.test(s)) return true;
    return false;
  }

  /**
   * 从作者主页 HTML 中解析快手号
   *
   * v2.7.10（2026-10-30 真机实测，用户已批）：快手号的字段真名是 **`userDefineId`**，
   * 不是 `kwaiId` —— 这就是之前无论怎么找都命中不了的原因。
   *
   * 为什么不用「钩接口」那条路：快手主页是**服务端直出**，HTML 里的
   * `window.INIT_STATE` 按接口路径缓存了响应原文（键名做了一次字符码 -1 的混淆，
   * 解码后是 `rest/v/profile/user-object` / `rest/v/profile/feed-object` /
   * `rest/v/profile/get-object`）。也就是说「钩接口」想拿的那份数据，服务器在渲染
   * HTML 时已经顺手塞进来了 —— 读 HTML 就是读接口响应，一次 GET 401ms 到手，
   * 而 iframe 渲染要等 5 秒。数据长这样：
   *
   *   "profile":{"user_id":"3xw4rt6264tk6m2","user_name":"盖世小美眉*",...},
   *   "userDefineId":"xiaxinjia8888"
   *
   * **陷阱（一级事故）**：同一份数据里还有 `/rest/v/profile/get`，它的
   * `userDefineId` 是**当前登录的人自己**（实测：饭饭爱跳舞 / 1226566812，
   * 连手机号都在里面）。无脑抓第一个 `userDefineId` 就会把用户自己的号写进
   * 别人的作品记录。所以这里**只认用作者内部 ID 锚定出来的值**；锚不住就返回空，
   * 让上层慢回 iframe 渲染 —— 宁可慢，绝不猜。
   */
  parseKwaiIdFromHtml(html, homepage) {
    if (!html) return '';

    const userIdMatch = String(homepage || '').match(/\/profile\/([^\/?#]+)/);
    const userId = userIdMatch ? userIdMatch[1] : '';

    // 1. 锚定作者：内部ID → 同一对象里的 userDefineId（旧字段 kwaiId 一并认）
    if (userId) {
      const anchored = this._parseKwaiIdAnchored(html, userId);
      if (anchored) return anchored;
    }

    // 2. 页面上可见的“快手号：xxx”（服务端偶尔直接渲染成文本）
    const textPatterns = [
      /快手号[：:]\s*([0-9a-zA-Z._-]+)/,
      /快手号\s*<[^>]*>\s*([0-9a-zA-Z._-]+)/
    ];

    // 3. 旧字段全局兜底。
    //    故意**不把裸 `userDefineId` 放进来**：没有锚点就无法区分「作者」和
    //    「登录者自己」，那是上面说的那个一级事故。
    const legacyPatterns = [
      /"kwaiId"\s*:\s*"([^"]+)"/,
      /"kwai_id"\s*:\s*"([^"]+)"/
    ];

    for (const pattern of textPatterns.concat(legacyPatterns)) {
      const m = html.match(pattern);
      if (!m || !m[1]) continue;
      const id = this._normalizeKwaiId(m[1], userId);
      if (id) return id;
    }

    return '';
  }

  /**
   * 用作者内部 ID 锚定，取出这个作者自己的快手号
   *
   * v2.7.10：锚点从 `"id"` 扩到 `"user_id"` / `"userId"` —— 快手 SSR 里用的是
   * `"user_id"`，旧代码只认 `"id"` 且字段名是 `kwaiId`，两个都错，所以永远落空。
   * 窗口 500 → 3000：`userDefineId` 排在 `user_name`/`headurl`/`user_text` 之后，
   * 文案一长就超 500（实测这份 HTML 距离约 250，但长文案作者会溢出）。
   *
   * 护栏：命中的那段里出现第二个 `user_id`/`userId` 就放弃 —— 说明窗口漂到了
   * 别人身上（作品列表里的其他作者），不能认。
   *
   * @param {string} html
   * @param {string} userId
   * @returns {string} 快手号，取不到返回空串
   */
  _parseKwaiIdAnchored(html, userId) {
    const esc = String(userId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // [锚点字段, 窗口大小]：`id` 太泛，窗口收窄，排在最后试
    const ANCHORS = [
      ['user_id', 3000],
      ['userId', 3000],
      ['id', 800]
    ];
    const FIELDS = ['userDefineId', 'kwaiId', 'kwai_id'];

    for (const [anchor, span] of ANCHORS) {
      for (const field of FIELDS) {
        const re = new RegExp(
          '"' + anchor + '"\\s*:\\s*"' + esc + '"[\\s\\S]{0,' + span + '}?"' + field + '"\\s*:\\s*"([^"]+)"'
        );
        const m = html.match(re);
        if (!m || !m[1]) continue;

        // 段内出现第二个用户 ID = 锚点漂移，放弃
        const ids = m[0].match(/"user_?[iI]d"\s*:/g) || [];
        if (ids.length > 1) continue;

        const id = this._normalizeKwaiId(m[1], userId);
        if (id) return id;
      }
    }

    return '';
  }

  /**
   * 快手号取值清洗 + 安全闸
   *
   * v2.7.10 新增两条拒绝：值等于作者内部 ID（`/rest/v/profile/get` 那条把内部ID
   * 当快手号回，认了就等于把内部ID写进字段）、占位符（`SSSSSSSSS`）。
   *
   * @param {string} raw
   * @param {string} userId 作者内部 ID
   * @returns {string} 合格返回，否则空串
   */
  _normalizeKwaiId(raw, userId) {
    const id = String(raw || '').trim();
    if (!id || id === '0' || id.length > 40) return '';
    if (!/^[0-9a-zA-Z._-]+$/.test(id)) return '';
    // v2.5.82：跳过服务端占位（`SSSSSSSSS`）
    if (this._isPlaceholderKwaiId(id)) return '';
    // v2.7.10：值 == 作者内部ID，说明这是内部ID不是快手号
    if (userId && id === userId) return '';
    return id;
  }

  /**
   * 从页面数据（Apollo 缓存）里拿作者内部 ID
   *
   * v2.7.10 实测（2026-10-30 详情页）：快手的 Apollo 缓存键**键名自带实体 ID**：
   *   VisionVideoDetailAuthor:3xw4rt6264tk6m2
   *   VisionVideoDetailPhoto:3xd6z5j72953xm4
   * 这比「DOM 里第一个 /profile/ 链接」可靠得多 —— 详情页上同时有两条：
   *   作者   a.profile-user-name → /profile/<作者>   （在 .profile-user 作者区）
   *   登录者 a.comment-profile   → /profile/<自己>   （评论区那个头像）
   * 取错就会去抓**用户自己的主页**，把用户自己的快手号写进别人的作品记录。
   *
   * 多个不同作者时**不猜**（预取了别的作品，说不准哪个是当前这条），退回老路。
   *
   * @returns {string} 作者内部 ID，拿不到返回空串
   */
  _authorIdFromApollo() {
    try {
      const state = typeof window !== 'undefined' ? window.__APOLLO_STATE__ : null;
      const client = state && state.defaultClient;
      if (!client || typeof client !== 'object') return '';

      const ids = [];
      for (const key of Object.keys(client)) {
        const m = /^VisionVideoDetailAuthor:([0-9a-zA-Z_-]+)$/.exec(key);
        if (m && m[1]) ids.push(m[1]);
      }

      const uniq = Array.from(new Set(ids));
      return uniq.length === 1 ? uniq[0] : '';
    } catch (e) {
      return '';
    }
  }

  // 提取作者主页链接
  extractAuthorHomepage() {
    try {
      // 方法1: 从URL参数中提取userId
      const urlParams = new URLSearchParams(window.location.search);
      const urlUserId = urlParams.get('userId');
      if (urlUserId) {
        const homepageUrl = `https://www.kuaishou.com/profile/${urlUserId}`;
        return homepageUrl;
      }

      // 方法1.5（v2.7.10）：Apollo 缓存键 VisionVideoDetailAuthor:<作者ID>
      // 键名就是作者内部 ID，不用猜 DOM 顺序
      const apolloAuthorId = this._authorIdFromApollo();
      if (apolloAuthorId) {
        return `https://www.kuaishou.com/profile/${apolloAuthorId}`;
      }

      // 方法2: 从页面脚本中的埋点数据提取
      const scriptTags = document.querySelectorAll('script');
      
      for (const script of scriptTags) {
        const text = script.textContent;
        
        // 匹配埋点数据中的s_author_id
        const authorIdMatch = text.match(/"s_author_id":"([a-zA-Z0-9]+)"/);
        if (authorIdMatch && authorIdMatch[1]) {
          const authorId = authorIdMatch[1];
          const homepageUrl = `https://www.kuaishou.com/profile/${authorId}`;
          return homepageUrl;
        }
        
        // 匹配通用的userId字段
        const userIdMatch = text.match(/"userId":"([a-zA-Z0-9]+)"/);
        if (userIdMatch && userIdMatch[1]) {
          const authorId = userIdMatch[1];
          const homepageUrl = `https://www.kuaishou.com/profile/${authorId}`;
          return homepageUrl;
        }
        
        // 备用模式：查找包含作者ID的其他数据格式
        const generalIdMatch = text.match(/"([a-zA-Z0-9]{12,})"[^}]*"(?:author|user|profile)"/);
        if (generalIdMatch && generalIdMatch[1]) {
          const authorId = generalIdMatch[1];
          const homepageUrl = `https://www.kuaishou.com/profile/${authorId}`;
          return homepageUrl;
        }
      }
      
      // 方法3: 从页面中的链接元素提取
      // v2.7.10 护栏：先认作者区（.profile-user），再退回列表但**排除评论区那条**
      // （a.comment-profile 指向「登录者自己」，抓它等于把用户自己的号当成作者）
      const authorAreaLink = document.querySelector('.profile-user a[href*="/profile/"]');
      if (authorAreaLink) {
        const m = authorAreaLink.href.match(/\/profile\/([a-zA-Z0-9_-]+)/);
        if (m && m[1]) return `https://www.kuaishou.com/profile/${m[1]}`;
      }

      const profileLinks = Array.prototype.filter.call(
        document.querySelectorAll('a[href*="/profile/"]'),
        (a) => !a.closest('.comment-profile') && !a.classList.contains('comment-profile')
      );
      if (profileLinks.length > 0) {
        const profileMatch = profileLinks[0].href.match(/\/profile\/([a-zA-Z0-9_-]+)/);
        if (profileMatch && profileMatch[1]) {
          return `https://www.kuaishou.com/profile/${profileMatch[1]}`;
        }
      }

      return '';
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取作者主页失败:', error);
      return '';
    }
  }
  
  // 提取本页文案
  extractDescription() {
    try {
      // 从提供的示例中可以看到文案在class="video-info-title"的元素中
      const selectors = [
        '.video-info-title',
        '.desc',
        '.description',
        '.video-desc',
        '.content-text',
        '.text-content',
        'p[data-text="true"]',
        '[data-v-50ca29a2=""].short-video-info-container-detail p'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          // 提取所有文本内容，包括话题标签
          let text = element.textContent.trim();
          
          // 处理连续的空格，保持单个空格
          text = text.replace(/\s+/g, ' ');
          
          return text;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取本页文案失败:', error);
      return '';
    }
  }
  
  /**
   * v2.5.84：从一个快手封面/视频地址里取发布时间
   *
   * 优先走 `KuaishouCoverTime` —— 封面文件名里藏着精确到秒的发布时间，
   * 拿不到（工具没加载 / 文件名不是那套编码）就退回原来的 `/upic/YYYY/MM/DD/` 到日。
   * 详情页与推荐流因此必然输出相同的字符串。
   *
   * @param {string} url 图片/视频地址，或含这种地址的 style 串
   * @returns {string} `2026/10/03 19:58:43` ｜ `2026/10/03` ｜ `''`
   */
  _dateFromKuaishouUrl(url) {
    try {
      if (typeof KuaishouCoverTime !== 'undefined' && KuaishouCoverTime
        && typeof KuaishouCoverTime.publishDateTimeFromSrc === 'function') {
        const precise = KuaishouCoverTime.publishDateTimeFromSrc(url);
        if (precise) return precise;
      }
    } catch (error) {
      // 工具不可用时退回下面的老办法，不影响提取
    }
    const dateMatch = String(url || '').match(/\/upic\/(\d{4})\/(\d{2})\/(\d{2})\//);
    if (dateMatch) {
      const [, year, month, day] = dateMatch;
      return `${year}/${month}/${day}`;
    }
    return '';
  }

  // 提取发布日期
  extractPublishDate() {
    try {
      // 方法1: 尝试从页面元素中提取
      const selectors = [
        '.video-time',
        '.publish-time',
        '.upload-time',
        '.time',
        'time',
        '.date',
        '[data-text="true"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          return element.textContent.trim();
        }
      }
      
      // 方法2: 尝试从脚本或meta标签获取
      const scriptTags = document.querySelectorAll('script');
      for (const script of scriptTags) {
        const text = script.textContent;
        if (text.includes('createTime') || text.includes('publishTime')) {
          const match = text.match(/["\'](\d{4}-\d{2}-\d{2}[^"\']*)["\']/);
          if (match) {
            return match[1];
          }
        }
      }
      
      // 方法3: 从图片URL中提取日期（根据示例代码分析）
      // 示例URL格式: https://p4.a.yximgs.com/upic/2025/02/24/15/...
      const imageElements = document.querySelectorAll('img, video');
      for (const element of imageElements) {
        const url = element.src || element.poster || element.getAttribute('style') || '';
        const date = this._dateFromKuaishouUrl(url);
        if (date) return date;
      }
      
      // 方法4: 检查style属性中的背景图片URL
      const elementsWithStyle = document.querySelectorAll('[style*="background-image"]');
      for (const element of elementsWithStyle) {
        const date = this._dateFromKuaishouUrl(element.getAttribute('style'));
        if (date) return date;
      }
      
      return '';
    } catch (error) {
      console.error('[KuaishouSocialExtractor] 提取发布日期失败:', error);
      return '';
    }
  }
  
  // 增强版提取方法：提取所有可用字段
  async extractAllFields() {
    // 字段外壳（字段名、数量、顺序）统一由 SocialFieldsBuilder 套用统一模板生成，
    // 取值仍走本类自己的取值方法，提取策略不变。
    return await SocialFieldsBuilder.build(this);
  }
  
  // 重写extractSpecificFields方法，返回空对象
  async extractSpecificFields() {
    return {};
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.KuaishouSocialExtractor = KuaishouSocialExtractor;
