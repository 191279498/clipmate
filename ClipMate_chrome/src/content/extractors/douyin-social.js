

// 抖音社交媒体提取器 - 视频页面专用（继续原有的视频提取逻辑）
class DouyinSocialExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douyin_social';
  }
  
  // 检查当前页面是否为抖音视频或笔记页面
  
  // 提取标题 - 使用共享标题处理器
  async extractTitle() {
    try {
      // 获取所需的数据
      const authorName = await this.extractAuthorName();
      const authorId = await this.extractAuthorId();
      const pageText = await this.extractPageText();
      const publishDate = await this.extractPublishDate();
      
      // 使用共享标题处理器生成标题
      return SocialTitleProcessor.generatePageTitle(authorName, pageText, publishDate, {
        platform: 'douyin-video',  // 抖音视频使用douyin-video平台配置
        enableSpecialCharConversion: false,  // 抖音保持原始字符
        maxTextLength: 10
      }, authorId);
    } catch (error) {
      console.error('[DouyinSocialExtractor] 提取标题失败:', error);
      return '';
    }
  }
  

  
  // 读取页面 JSON-LD 中 BreadcrumbList 的作者条目（position === 2）
  // extractAuthorName 与 extractAuthorHomepage 共用，避免重复解析同一段脚本
  _readAuthorBreadcrumb() {
    try {
      const script = document.querySelector('script[type="application/ld+json"]');
      if (!script) return null;
      const data = JSON.parse(script.textContent);
      return (data.itemListElement || []).find(item => item.position === 2) || null;
    } catch (e) {
      return null;
    }
  }

  // 提取作者昵称 - 优先使用JSON-LD结构化数据（最稳定可靠）
  async extractAuthorName() {
    try {
      // ============================================
      // 策略0（v2.5.90 新增）：一手数据里的昵称 —— 接口响应 / React fiber
      // 为什么排第一：弹窗入口（douyin-modal.js）的昵称就来自 fiber，
      // 详情页若继续用 JSON-LD，两边可能不一致，违反「同一作品同一字符串」。
      // 清洗规则与弹窗完全同款（见 _cleanNickname 注释）。
      // ============================================
      const fromSource = await this._authorNameFromSource();
      if (fromSource) return fromSource;

      // ============================================
      // 策略1: 从JSON-LD BreadcrumbList中提取（首选，最稳定）
      // 数据来源: schema.org标准格式，position=2的项就是作者信息
      // 示例: { position: 2, name: "东东来了", item: "https://www.douyin.com/user/..." }
      // ============================================
      const authorItem = this._readAuthorBreadcrumb();
      if (authorItem && authorItem.name) {
        const authorName = authorItem.name.trim();
        if (authorName) {
          return authorName;
        }
      }
      
      // ============================================
      // 策略2: 从作者主页链接中提取文本（次选，URL模式比类名稳定）
      // 通过a[href*="/user/"]找到作者链接，过滤掉self和导航链接
      // ============================================
      const userLinks = document.querySelectorAll('a[href*="/user/"]');
      for (const link of userLinks) {
        const href = link.href;
        // 过滤掉不是作者的链接
        if (href.includes('/user/self') || href.includes('from_nav=')) {
          continue;
        }
        // 获取链接文本，排除只包含图片的链接和空链接
        const linkText = link.textContent.trim();
        if (linkText && linkText.length > 0 && linkText.length < 50) {
          // 进一步验证：链接中不能包含话题标签#，那可能是视频文案
          if (!linkText.includes('#')) {
            return linkText;
          }
        }
      }
      
      // ============================================
      // 策略3: 从meta description中提取（备用方案）
      // 支持两种格式:
      //   新格式: "东东来了发布了视频：AE入门公开课..."
      //   旧格式: "东东来了于20240101发布在抖音..."
      // ============================================
      const descMeta = SocialDomUtils.readMeta('meta[name="description"]');
      if (descMeta) {
        const descText = descMeta;
        
        // 尝试匹配新格式: "作者名发布了视频：..." 或 "作者名发布了笔记：..."
        const newPatternMatch = descText.match(/^(.+?)发布了(视频|笔记)：/);
        if (newPatternMatch && newPatternMatch[1]) {
          const authorName = newPatternMatch[1].trim();
          if (authorName) {
            return authorName;
          }
        }
        
        // 尝试匹配旧格式: "作者名于YYYYMMDD发布在抖音"
        const oldPatternMatch = descText.match(/^(.+?)于\d{8}发布在抖音/);
        if (oldPatternMatch && oldPatternMatch[1]) {
          const authorName = oldPatternMatch[1].trim();
          if (authorName) {
            return authorName;
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('[DouyinSocialExtractor] 提取作者昵称失败:', error);
      return '';
    }
  }
  
  // 处理作者昵称的辅助方法 - 取消过滤，返回原始信息
  processAuthorName(name) {
    if (!name || name === '') return '';
    // 取消所有过滤，直接返回原始提取的昵称信息
    return name.trim();
  }

  /**
   * 昵称清洗（v2.5.90）
   *
   * ⚠️ 必须与 `src/content/extractors/douyin-modal.js` 的 `_cleanNickname` **逐字同款**：
   * 弹窗走 fiber 昵称、详情页现在也走一手昵称，两边清洗规则一旦漂移，
   * 同一个作者在两个入口就会显示成两个名字（违反「同一作品同一字符串」）。
   * 改这里必须同步改那里，`tests/douyin-net-cache.test.js` 有对拍用例。
   */
  _cleanNickname(raw) {
    let name = typeof raw === 'string' ? raw : (raw ? String(raw) : '');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return '';
    name = name.replace(/^@+/, '').trim();
    name = name.replace(/(认证徽章|企业认证|官方认证|个人认证|机构认证|蓝V认证)$/u, '').trim();
    return name;
  }

  /**
   * 一手原始数据（网络响应 / fiber）—— 同一实例只问一次
   *
   * 三个字段（文案、昵称、日期）都要用到，必须共享同一个 Promise，
   * 否则一次提取会向后台发三次「读 fiber」的请求。
   */
  _fiberMeta() {
    if (this._fiberMetaPromise) return this._fiberMetaPromise;
    this._fiberMetaPromise = (async () => {
      try {
        const id = this._workIdForFiber();
        if (!id) return null;
        if (typeof DouyinFiberClient === 'undefined' || !DouyinFiberClient ||
            typeof DouyinFiberClient.getMeta !== 'function') return null;
        return await DouyinFiberClient.getMeta(id);
      } catch (e) {
        return null;
      }
    })();
    return this._fiberMetaPromise;
  }

  /**
   * 一手昵称：网络缓存（同步，零往返）→ fiber（异步）
   *
   * 网络缓存来自 `douyin-net-hook.js`，在推荐流 / 弹窗 / 从信息流点进详情这些场景能命中；
   * 详情页直达时它一定是空的（抖音不请求），此时靠 fiber —— 两条路都没有才回落 JSON-LD。
   */
  async _authorNameFromSource() {
    const id = this._workIdForFiber();
    if (!id) return '';

    try {
      if (typeof DouyinNetCache !== 'undefined' && DouyinNetCache &&
          typeof DouyinNetCache.nicknameOf === 'function') {
        const fromNet = this._cleanNickname(DouyinNetCache.nicknameOf(id));
        if (fromNet) return fromNet;
      }
    } catch (e) { /* 读不到就往下走 */ }

    try {
      const meta = await this._fiberMeta();
      if (meta && meta.nickname) {
        const fromFiber = this._cleanNickname(meta.nickname);
        if (fromFiber) return fromFiber;
      }
    } catch (e) { /* 读不到就往下走 */ }

    return '';
  }
  
  // 提取作者ID - 异步方法（同一作者并发调用只发一次请求）
  async extractAuthorId() {
    // 以作者主页为并发去重键：同一作者共享同一个在途请求，不同作者互不影响
    let inflightKey = '__no_homepage__';
    try {
      const homepage = await this.extractAuthorHomepage();
      if (homepage) inflightKey = homepage;
    } catch (e) {
      // 取主页失败时退化为单键，不影响主流程
    }

    if (!this._authorIdInflight) this._authorIdInflight = new Map();
    return AuthorIdFetcher.dedupe(
      this._authorIdInflight,
      inflightKey,
      () => this._extractAuthorIdImpl(),
      { info: (msg) => ClipMateLog.debug('[DouyinSocialExtractor] ' + msg) }
    );
  }

  // 提取作者ID 的实际实现：接口一手数据 → 缓存 → 抓主页 → 正则解析 → 校验 → 写缓存
  async _extractAuthorIdImpl() {
    try {
      // 0. v2.5.90 新增：接口响应里的一手抖音号（最快，且不用碰作者主页）
      //    能命中的场景：推荐流 / 精选 / 沉浸流 / 弹窗 / 从信息流点进详情页
      //    命不中的场景：直接粘贴 `/video/<id>` 打开（抖音首屏不发请求，已实测）
      const fromNet = this._authorIdFromNet();
      if (fromNet) return fromNet;

      // 1. 先获取作者主页URL（取不到就无法生成缓存键）
      const authorHomepage = await this.extractAuthorHomepage();
      if (!authorHomepage) {
        return '';
      }

      return await AuthorIdFetcher.extract({
        site: 'douyin_social',
        homepage: authorHomepage,
        // 实例缓存保留（历史兼容），全局持久缓存由 AuthorIdFetcher 统一读写
        instanceCacheKey: `douyin_authorId_${authorHomepage}`,
        getCache: (key) => this.getCache(key),
        setCache: (key, value) => this.setCache(key, value),

        // 增强的正则：支持数字、字母数字组合，以及带点号/下划线的格式（如 dhy.dai.yt_0503）
        patterns: [
          /抖音号：([0-9a-zA-Z._]+)/g,
          /<span[^>]*>抖音号：<!-- -->([0-9a-zA-Z._]+)<\/span>/g,
          /"uniqueId":"([0-9a-zA-Z._]+)"/g,
          /"douyinId":"([0-9a-zA-Z._]+)"/g,
          /userId="([0-9a-zA-Z._]+)"/g,
          /user_id=([0-9a-zA-Z._]+)/g
        ],

        // 允许字母、数字、点号和下划线的组合，长度不超过 30
        validate: (id) => /^[0-9a-zA-Z._]+$/.test(id) && id.length <= 30,

        log: {
          info: (msg) => ClipMateLog.debug('[DouyinSocialExtractor][缓存功能] ' + msg),
          error: (msg, err) => console.error('[DouyinSocialExtractor][缓存功能] ' + msg, err)
        }
      });
    } catch (error) {
      console.error('[DouyinSocialExtractor][缓存功能] 提取作者ID时出错:', error);
      console.error('[DouyinSocialExtractor][缓存功能] 错误时间:', new Date().toLocaleTimeString());
      return '';
    }
  }

  /**
   * 从接口响应缓存里取作者抖音号（v2.5.90）
   *
   * 抖音号语义：`author.unique_id` 非空就用它，为空退 `author.short_id`（用户没设抖音号时的默认号），
   * 两者都无效返回空串 → 交回老路（打开作者主页正则抓）。
   * 校验规则与 AuthorIdFetcher 一致（字母数字点下划线、长度 ≤ 30），绝不放过脏值。
   */
  _authorIdFromNet() {
    try {
      if (typeof DouyinNetCache === 'undefined' || !DouyinNetCache ||
          typeof DouyinNetCache.authorIdFor !== 'function') return '';
      const id = this._workIdForFiber();
      if (!id) return '';
      const value = DouyinNetCache.authorIdFor(id);
      return value && /^[0-9a-zA-Z._]{1,30}$/.test(value) ? value : '';
    } catch (e) {
      return '';
    }
  }

  // 提取作者主页链接 - 异步方法
  async extractAuthorHomepage() {
    try {
      // 1. 优先从schema数据中提取
      const authorItem = this._readAuthorBreadcrumb();
      if (authorItem && authorItem.item) {
        return authorItem.item.trim();
      }
      
      // 2. 增强的DOM选择器提取 - 过滤掉self链接
      const selectors = [
        '[data-e2e="author-avatar"] a',  // 新增油猴脚本使用的选择器
        '[class*="author-avatar"] a',    // 新增油猴脚本使用的选择器
        '[data-e2e="video-user-avatar"] a',
        'a[href*="/user/"]',
        '.author-info a',
        '.user-avatar a'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.href) {
          // 关键修复：过滤掉包含'self'或'from_nav'的链接，这些是用户个人中心链接
          if (!element.href.includes('/user/self') && !element.href.includes('from_nav=')) {
            return element.href;
          }
        }
      }
      
      // 3. 备选方案：查找所有用户链接 - 同样过滤掉self链接
      const userLinks = document.querySelectorAll('a[href*="/user/"]');
      for (const link of userLinks) {
        const href = link.href;
        // 过滤掉包含'self'或'from_nav'的链接
        if (href.includes('/user/') && !href.includes('/user/self') && !href.includes('from_nav=')) {
          return href;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[DouyinSocialExtractor] 提取作者主页失败:', error);
      return '';
    }
  }
  
  // 提取发布日期 - 异步方法 - 增强支持笔记页面
  //
  // v2.5.79：详情页那行文字只到「分」（`发布时间：2025-04-22 16:00`），
  // 而弹窗页读的是 fiber 的 createTime（到秒：`16:00:29`）。同一个作品两边必须显示同一个字符串，
  // 所以这里先用**原逻辑**取页面文字（`_publishDateFromPage`，一行没改），
  // 只在它「没有秒」时才去问原始数据补秒；日期或时分对不上就原样保留页面文字（宁空不错）。
  async extractPublishDate() {
    const fromPage = this._publishDateFromPage();
    if (this._hasSeconds(fromPage)) return fromPage;

    const fromFiber = await this._publishDateFromFiber();
    let merged = '';
    try {
      if (typeof DouyinAwemeDate !== 'undefined' && DouyinAwemeDate &&
          typeof DouyinAwemeDate.mergePrecision === 'function') {
        merged = DouyinAwemeDate.mergePrecision(fromPage, fromFiber) || '';
      }
    } catch (e) {
      merged = '';
    }
    return merged || fromPage || fromFiber || '';
  }

  /** 这段日期文字里是否已经带「秒」 */
  _hasSeconds(text) {
    return /(\d{1,2}):(\d{1,2}):(\d{1,2})/.test(String(text || ''));
  }

  /** 当前作品 ID：详情页从 `/video/<id>`、`/note/<id>` 取；弹窗页从地址栏 `modal_id` 取 */
  _workIdForFiber() {
    try {
      const href = (typeof location !== 'undefined' && location && location.href) || '';
      const m = /\/(?:video|note)\/(\d{6,25})/.exec(href);
      if (m) return m[1];
      if (typeof DouyinModalContext !== 'undefined' && DouyinModalContext &&
          typeof DouyinModalContext.modalIdFromUrl === 'function') {
        return DouyinModalContext.modalIdFromUrl(href) || '';
      }
    } catch (e) { /* 取不到就当没有 */ }
    return '';
  }

  /**
   * 原始数据（fiber）里的发布时间 —— 精确到秒
   *
   * 拿不到（不在作品页 / 页面没有 fiber / 客户端没加载）一律返回空串，绝不猜。
   * 同一实例只问一次：标题和「发布日期」两个字段都会要时间，不要问两遍。
   */
  _publishDateFromFiber() {
    if (this._fiberDatePromise) return this._fiberDatePromise;
    this._fiberDatePromise = (async () => {
      try {
        if (typeof DouyinAwemeDate === 'undefined' || !DouyinAwemeDate ||
            typeof DouyinAwemeDate.formatTimestamp !== 'function') return '';
        // v2.5.90：统一走 _fiberMeta（与文案/昵称共享同一次读取，不再各问一遍后台）
        const meta = await this._fiberMeta();
        if (!meta || !meta.createTime) return '';
        return DouyinAwemeDate.formatTimestamp(meta.createTime) || '';
      } catch (e) {
        return '';
      }
    })();
    return this._fiberDatePromise;
  }

  // 页面文字取法 —— 原 extractPublishDate 的全部逻辑，v2.5.79 一行未改
  _publishDateFromPage() {
    try {
      // 1. 首选增强的DOM选择器提取，添加油猴脚本使用的选择器和笔记页面选择器
      const selectors = [
        '[data-e2e="detail-video-publish-time"]', // 新增油猴脚本使用的选择器
        '[data-e2e="video-publish-time"]',      // 原有选择器
        '.publish-time',                        // 通用发布时间选择器
        '.video-time',
        '.upload-time',
        'time',
        '.date',
        // 新增笔记页面专用选择器
        '*:contains("发布时间")',  // 包含"发布时间"文本的元素
        '.info-item:contains("发布时间")', // 信息项中包含发布时间的
        '[class*="publish"]:contains("发布时间")' // class包含publish且包含发布时间文本的
      ];
      
      for (const selector of selectors) {
        let element = null;
        
        // 处理包含文本的选择器
        if (selector.includes(':contains(')) {
          const textMatch = selector.match(/:contains\("([^"]+)"\)/);
          if (textMatch) {
            const searchText = textMatch[1];
            const baseSelector = selector.replace(/:contains\([^)]+\)/, '');
            const elements = baseSelector === '*' ? document.querySelectorAll('*') : document.querySelectorAll(baseSelector);
            // v2.5.78：以前是「按文档顺序取第一个命中」，第一个永远是 <html>，
            // 于是把整页 1MB 文本喂进日期格式化 —— 抓到「相关推荐」里别人的日期，
            // 图文详情页因此长期显示错日期（快照恰好撞对，属于假绿）。
            // 现在改为「取包含该文字、且文本最短的那个元素」= 最贴近的那一小块。
            const candidates = Array.from(elements).filter((el) => {
              const tag = el.tagName;
              if (tag === 'HTML' || tag === 'BODY' || tag === 'SCRIPT' || tag === 'STYLE') return false;
              const text = el.textContent || '';
              if (!text.includes(searchText)) return false;
              // 必须真的带日期，否则继续找下一个
              return /(\d{4})\s*[-\/.年]\s*\d{1,2}\s*[-\/.月]\s*\d{1,2}/.test(text);
            });
            candidates.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
            element = candidates[0] || null;
          }
        } else {
          element = document.querySelector(selector);
        }
        
        if (element && element.textContent.trim()) {
          const timeText = element.textContent.trim();
          // 移除可能的前缀并格式化
          const formattedTime = this.formatPublishTime(timeText);
          if (formattedTime) return formattedTime;
        }
      }
      
      // 2. 备选：从页面文本中直接匹配发布时间模式
      const pageText = document.body.innerText;
      const timePatterns = [
        /发布时间[:：]\s*(\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}[日\s]\s*\d{1,2}[:：]\d{1,2})/,  // 发布时间：2024年06月02日 11:13
        /发布时间[:：]\s*(\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}[日]?)/,  // 发布时间：2024年06月02日
        /(\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}[日\s]\s*\d{1,2}[:：]\d{1,2}).*发布/,  // 2024年06月02日 11:13 发布
        /(\d{4}[年\-/.]\d{1,2}[月\-/.]\d{1,2}[日]?).*发布/  // 2024年06月02日 发布
      ];
      
      for (const pattern of timePatterns) {
        const match = pageText.match(pattern);
        if (match && match[1]) {
          const formattedTime = this.formatPublishTime(match[1]);
          if (formattedTime) return formattedTime;
        }
      }
      
      // 3. 备选：从meta标签提取
      const descMeta = SocialDomUtils.readMeta('meta[name="description"]');
      if (descMeta) {
        const dateMatch = descMeta.match(/(\d{4})(\d{2})(\d{2})/);
        const timeMatch = descMeta.match(/(\d{2}:\d{2})/);
        if (dateMatch && dateMatch.length >= 4) {
          // v2.5.48：与全项目「发布日期」统一为斜杠格式
          const dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
          const timeStr = timeMatch ? timeMatch[1] : '';
          return timeStr ? `${dateStr} ${timeStr}` : dateStr;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[DouyinSocialExtractor] 提取发布日期失败:', error);
      return '';
    }
  }
  
  // 处理发布时间的辅助方法 - 格式化时间文本
  formatPublishTime(timeText) {
    if (!timeText) return '';
    // 移除可能的前缀"发布时间："
    const pureTime = timeText.replace(/^发布时间：/, '').trim();
    return pureTime;
  }
  
  // 处理文案内容的辅助方法 - 过滤和截取文案
  processPageText(text) {
    if (!text) return '';
    
    // 移除多余的空白字符
    let processedText = text.replace(/\s+/g, ' ').trim();
    
    // ==========================================================================
    // v2.5.85 抖音 `/video/<id>` 详情页的 meta description = 「真文案 + 自动拼的 SEO 尾巴」
    //   实测 4 条不同作品形态完全一致（2026-10-28 真机采样）：
    //     "<文案> - <作者昵称>于<8位日期>发布在抖音，已经收获了<N>[万亿]个喜欢，来抖音，记录美好生活！"
    //   判断依据：「已经收获了…」用的是**作者的累计获赞**（同一作者 4 条完全相同，7988.6万），
    //   显系抖音自动拼接，不是用户文案。
    //
    // 删法（与用户确认：两刀法）：
    //   第 1 刀删尾句「，已经收获了…，来抖音，记录美好生活！」
    //   第 2 刀删作者段「 - 某作者于YYYYMMDD发布在抖音」
    // 三条铁律：
    //   ① **只从尾部裁**（正则都带 `\s*$`），中间出现同样文字一概不动；
    //   ② 两刀**各自独立**：命中就裁、没命中就跳过，不要求同时命中 → 抖音哪天改了尾句话术，
    //      作者段那条照样能把尾巴削掉；
    //   ③ 顺序不能反：先尾句后作者段。尾句在时作者段不在末尾，第 2 刀天然不命中，不会留半截。
    // 已知取舍：若用户自己写的文案恰好以这个句式结尾，会被一并裁掉（概率极低，用户已确认接受）。
    //
    // ⚠️ v2.5.90 修 bug（B 类）：第 2 刀原来写的是 `\s+-[^-]{1,40}?于\d{8}发布在抖音`，
    //    `[^-]` 表示「昵称里不能有连字符」—— 可作者昵称本身带 `-`（实测「米雷-RayDog」），
    //    整条正则立刻失效，浮窗里留下 ` - 米雷-RayDog于20261002发布在抖音` 这种半截尾巴。
    //    现在改成 `\s+-\s*.{1,80}?于\d{8}发布在抖音`（`?` 非贪婪 + 只从尾部锚定）：
    //    昵称里带 `-`、带空格、带点号都照样裁得动；`.` 不匹配换行，而换行早已在上方归一成空格。
    // ==========================================================================
    processedText = processedText
      .replace(/[，,]\s*已经?收获了[\d.]+[万亿]?个?喜欢[，,]?\s*来抖音[，,]记录美好生活[！!]?\s*$/, '')
      .trim();
    processedText = processedText
      .replace(/\s+-\s*.{1,80}?于\d{8}发布在抖音\s*$/, '')
      .trim();
    
    // 移除可能的抖音标记和冗余文本
    processedText = processedText.replace(/抖音-记录美好生活/g, '').trim();
    processedText = processedText.replace(/douyin.com/g, '').trim();
    
    // 如果文案太长，截取前200个字符
    if (processedText.length > 200) {
      processedText = processedText.substring(0, 200) + '...';
    }
    
    return processedText;
  }
  
  // 提取本页文案：一手数据优先 → meta 兜底
  //
  // v2.5.90 之前只读 meta[name="description"]，而抖音详情页的这段 meta 是**截断过的**
  // （实测：真文案 613 字，meta 到 118 字就腰斩，后面还拼着 SEO 尾巴）。
  // 于是浮窗里出现「146 字的残句」，而弹窗入口（读 fiber）显示的是完整 613 字 ——
  // 同一个作品两个入口两副面孔，违反「同一作品同一字符串」。
  // 现在改成：接口响应（网络缓存）→ fiber → meta。前两档都是原始文案，逐字不截断。
  async extractPageText() {
    try {
      // 第 1 档：一手文案（完整原文）
      const fromSource = await this._pageTextFromSource();
      if (fromSource) return fromSource;

      // 第 2 档：meta 描述（可能被截断 + 带 SEO 尾巴，进 processPageText 削一遍）
      const descMeta = SocialDomUtils.readMeta('meta[name="description"]');
      if (descMeta) {
        const text = this.processPageText(descMeta);
        if (text) {
          return text;
        }
      }

      ClipMateLog.debug('[DouyinSocialExtractor] 一手数据与 Meta 描述都取不到文案，返回空值');
      return '';
    } catch (error) {
      console.error('[DouyinSocialExtractor] 提取本页文案失败:', error);
      return '';
    }
  }

  /**
   * 一手文案：网络缓存（同步）→ fiber（异步）
   *
   * 两者都是抖音自己下发的原文，逐字相同（真机 2026-10-28 对拍过：613 字完全一致）。
   * 拿不到返回空串，交给 meta 兜底 —— 最差结果等于回到 v2.5.89 的行为。
   */
  async _pageTextFromSource() {
    const id = this._workIdForFiber();
    if (!id) return '';

    let raw = '';
    try {
      if (typeof DouyinNetCache !== 'undefined' && DouyinNetCache &&
          typeof DouyinNetCache.descOf === 'function') {
        raw = DouyinNetCache.descOf(id) || '';
      }
    } catch (e) { raw = ''; }

    if (!raw) {
      try {
        const meta = await this._fiberMeta();
        if (meta && typeof meta.desc === 'string') raw = meta.desc;
      } catch (e) { /* 读不到就交给 meta 兜底 */ }
    }

    if (!raw) return '';
    return this.processPageText(raw);
  }
  
  /**
   * 这条作品是不是「图文」（v2.7.3）
   *
   * 三档，从上往下取第一条命中的：
   *   1. 一手数据：原始数据里的 `awemeType===68` / `mediaType===2`（最准，弹窗与详情页都有）；
   *   2. SSR 直出：`#RENDER_DATA` 里**这条自己**的数据块（v2.5.91 的老办法，fiber 读不到时兜底）；
   *   3. 地址栏 `/note/<id>`：详情页直达时页面不发请求，前两档都拿不到。
   *
   * 为什么单独抽一个方法：`extractUrl()`（输 `/note/` 还是 `/video/`）和 `getContentShape()`
   * （文案为空时填「抖音图文」还是「抖音视频」）问的是同一件事，以前各判各的 ——
   * 弹窗态地址是 `/user/…?modal_id=`，里面没有 `/note/`，于是出现
   * 「URL 输 /note/…、文案却填抖音视频」这种同一条作品自相矛盾（2026-10-30 真机实测）。
   * 现在两边共用这一处判定，结果不可能对不上。
   *
   * 站点门禁：本方法是抖音专属，被别站调到时一律 false（共享原型，每个站都会挂上）。
   *
   * @returns {Promise<boolean>}
   */
  async _isNoteWork() {
    try {
      const host = (typeof location !== 'undefined' && location && location.hostname) || '';
      if (host.indexOf('douyin.com') === -1) return false;
    } catch (e) {
      return false;
    }

    // ① 一手数据：弹窗态认 modal_id，详情页认地址里的作品 id，两条路都试一遍
    try {
      let meta = null;
      if (typeof this._getMeta === 'function') meta = await this._getMeta();
      if (!meta && typeof this._fiberMeta === 'function') meta = await this._fiberMeta();
      if (meta) {
        if (Number(meta.awemeType) === 68 || Number(meta.mediaType) === 2) return true;
        // 拿到了明确的类型数字且不是图文 → 就是视频，不再看后面的弱证据
        const hasType = meta.awemeType !== undefined && meta.awemeType !== null && meta.awemeType !== '';
        if (hasType && Number(meta.awemeType) !== 68) return false;
        const hasMedia = meta.mediaType !== undefined && meta.mediaType !== null && meta.mediaType !== '';
        if (hasMedia && Number(meta.mediaType) !== 2) return false;
      }
    } catch (e) { /* 读不到就往下走 */ }

    // ② SSR 直出
    try {
      if (typeof this._isNoteFromRenderData === 'function') {
        const id = this._workIdForFiber();
        if (id && this._isNoteFromRenderData(id)) return true;
      }
    } catch (e) { /* 同上 */ }

    // ③ 地址栏
    try {
      const href = (typeof location !== 'undefined' && location && location.href) || '';
      if (/\/note\/\d{6,25}/.test(href)) return true;
    } catch (e) { /* 同上 */ }

    return false;
  }

  /**
   * 当前页是视频还是图文（v2.5.98，v2.7.3 起改用统一判定）
   *
   * 只服务于「本页文案为空时填什么」这一件事：`'photo'` → 「抖音图文」，
   * 其余（含空串）→ 「抖音视频」。
   *
   * v2.7.3 之前只认地址栏 `/note/<id>`，弹窗态地址是 `/user/…?modal_id=` 没有这个标记，
   * 于是图文作品也被填成「抖音视频」（真机实测）。现在走 `_isNoteWork()`，
   * 与 URL 字段用的是同一套判定。
   *
   * @returns {Promise<string>} 'photo' | 'video'
   */
  async getContentShape() {
    try {
      return (await this._isNoteWork()) ? 'photo' : 'video';
    } catch (e) {
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
window.DouyinSocialExtractor = DouyinSocialExtractor;
