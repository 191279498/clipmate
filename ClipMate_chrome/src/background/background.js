// 后台服务脚本

// 浏览器 API 兼容层：Firefox 优先用 browser.*（原生 Promise），Chrome 回退到 chrome.*
var WBR = (typeof browser !== "undefined" && browser && browser.runtime) ? browser : chrome;

// v2.5.77：抖音弹窗「原始数据」读取器（纯函数，跑在页面环境用）。
// 用 importScripts 引入而不是内联进本文件，是为了让同一个函数能被 Node 单测直接 require。
// 拿不到就一直没定义 —— 下面的消息分支会 typeof 检查后直接返回 null，不影响其他功能。
try {
  if (typeof importScripts === 'function') {
    importScripts('douyin-fiber.js');
  }
} catch (e) {
  console.warn('[ClipMate] douyin-fiber.js 加载失败，抖音弹窗将走 DOM 取法:', e && e.message);
}

// v2.5.83：快手推荐流「作品档案」读取器（纯函数，跑在页面环境用）。
// 同样用 importScripts 引入，好处同上：Node 单测能直接 require 同一个函数。
try {
  if (typeof importScripts === 'function') {
    importScripts('kuaishou-state.js');
  }
} catch (e) {
  console.warn('[ClipMate] kuaishou-state.js 加载失败，快手推荐流将走封面地址取法:', e && e.message);
}

class BackgroundService {
  constructor() {
    // 防止多次实例化
    if (BackgroundService.instance) {
      return BackgroundService.instance;
    }
    BackgroundService.instance = this;
    this.init();
  }
  
  static instance = null;

  init() {
    // 监听安装事件
    WBR.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    // 监听消息
    WBR.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // 保持消息通道开放
    });

    // 监听标签页更新
    WBR.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // 初始化存储
    this.initStorage();
  }

  async handleInstall(details) {

    // 只在 config 不存在时才设置默认值（防止刷新时覆盖用户已保存的设置）
    try {
      const result = await WBR.storage.local.get(['config']);
      if (!result || !result.config) {
        const defaultConfig = {
          autoExtract: false,
          autoExtractDelay: 3, // v2.5.46：全站点自动提取需要等页面渲染，默认给 3 秒
          autoCopy: false,
          autoCopyFormat: 'markdown', // v2.5.66：自动复制用哪种格式 notion | markdown | plaintext
          showButton: true,
          // v2.5.46：站点级覆盖 { "douban.com": { autoCopy: true } }
          siteOverrides: {},
          theme: 'system',
          fieldOrder: {},
          fieldMappings: {}, // v2.8.2：字段改名（浮窗里存的那份，以前这里写的是没人读的 customMappings）
          settings: {
            enableCache: true,
            // v2.9.6：浮窗自动收起。默认值按站点类型实时算（社交开/其余关，见 site-config.js），
            // 这个键不再写默认值含义；只有老配置里显式 false 会被当作「全部关闭」迁移。
            autoDismiss: true,
            // v2.9.7：浮窗尺寸（全局项，设置页可改；这里是默认值）
            floatingWindowWidth: 320,
            floatingWindowMaxHeight: 800,
            // v2.8.2：简介长度上限（社交 / 影人 / 其他），值与搬进设置页之前完全一致
            descLimits: { social: 50000, person: 5000, other: 500 }
          }
        };
        await WBR.storage.local.set({ config: defaultConfig });
      } else {
      }
    } catch (error) {
      console.warn('安装初始化配置失败:', error && error.message ? error.message : error);
    }

    // 安装时不打开欢迎页面，因为welcome.html文件不存在
    // 注释掉以下代码以避免弹出错误页面
    // if (details.reason === 'install') {
    //   WBR.tabs.create({
    //     url: WBR.runtime.getURL('welcome.html')
    //   });
    // }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'getMediaConfigs':
          const configs = await this.getMediaConfigs();
          sendResponse({ configs });
          break;

        case 'saveConfig':
          // v2.8.0：第二个参数 extras 用来「配置 + 旧独立键」一次性落盘。
          // 抖音/快手那几个开关原来存成独立键（douyinModalEnabled 等），内容脚本还在读旧键名，
          // 设置页改开关时必须两处一起写，否则新旧代码会看到不一样的值。
          await this.saveConfig(message.config, message.extras);
          sendResponse({ success: true });
          break;

        case 'getConfig':
          const config = await this.getConfig();
          // v2.5.45 修复：同一条消息存在两种读取习惯 ——
          //   popup.js 读裸字段（response.autoExtract），
          //   modal-persistence.js 读 response.config（6 处）。
          // 原实现只返回裸 config，导致内容端恒拿到 undefined，
          // 「保存排序 / 保存改名 / 读取排序 / 重置排序」全部静默失效却仍提示已保存。
          // 这里同时提供两种读法：裸字段展开 + config 键指向同一对象。
          sendResponse({ ...config, config });
          break;

        case 'clearCache':
          await this.clearCache();
          sendResponse({ success: true });
          break;

        // v2.8.1：设置页「数据」里用的三个。
        // 与上面的 clearCache 分开：clearCache 会把 config 一起删（恢复出厂），
        // 这里三个都只碰自己那一块，绝不碰其他设置。
        case 'getCacheStats':
          sendResponse({ stats: await this.getCacheStats() });
          break;

        case 'clearCacheOnly':
          sendResponse({ success: true, result: await this.clearCacheOnly() });
          break;

        case 'resetFeatures':
          sendResponse({ success: true, result: await this.resetFeatures(message.legacyKeys) });
          break;

        case 'fetchAuthorPage':
          // 处理作者页面获取请求
          // 兼容两种参数格式：message.url和message.authorUrl
          const authorUrl = message.authorUrl || message.url;
          const fullName = await this.fetchAuthorPage(authorUrl);
          // 返回统一的格式，同时支持两种方式获取结果
          sendResponse({
            success: !!fullName,
            fullName: fullName || null,
            authorName: fullName || null  // 添加authorName字段以兼容修改后的content脚本
          });
          break;

        case 'fetchChapterPage':
          // v2.5.48：原实现是裸 fetch，没有超时。目标服务器一旦不响应，
          // 这个 Promise 会一直挂着 → 内容端 await 不返回 → 界面永久转圈，
          // 用户只能刷新页面。这里加 15 秒硬超时，超时后按失败返回。
          var chapterController = new AbortController();
          var chapterTimeoutId = setTimeout(function () {
            chapterController.abort();
          }, 15000);
          try {
            const chapterResponse = await fetch(message.url, {
              method: 'GET',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'zh-CN,zh;q=0.9'
              },
              signal: chapterController.signal
            });
            const chapterHtml = await chapterResponse.text();
            sendResponse({ html: chapterHtml });
          } catch (fetchError) {
            const isTimeout = fetchError && fetchError.name === 'AbortError';
            console.warn('抓取章节页面失败:', isTimeout ? '请求超时（15 秒）' : fetchError.message);
            sendResponse({
              html: '',
              error: isTimeout ? '请求超时（15 秒未响应）' : fetchError.message
            });
          } finally {
            clearTimeout(chapterTimeoutId);
          }
          break;

        case 'crossSiteLookup':
          // v2.5.72 跨站补网址：内容脚本直接 fetch 这三个域名会被 CORS 拦
          // （实测从 IMDb 页面 fetch themoviedb.org 报 "Failed to fetch"），
          // 所以统一由后台按 host_permissions 取原件，解析交给内容端的 cross-site-linker.js。
          const crossResults = await this.fetchCrossSite(message.requests);
          sendResponse({ results: crossResults });
          break;

        case 'douyinFiberMeta':
          // v2.5.77 抖音弹窗：读这一条作品的原始数据（React fiber 上的 awemeInfo）。
          // 需求时才注入、只跑一次、结果立刻返回，不常驻。失败一律 null，绝不抛。
          const fiberMeta = await this.readDouyinFiberMeta(
            sender && sender.tab ? sender.tab.id : null,
            message.modalId
          );
          sendResponse({ ok: !!fiberMeta, meta: fiberMeta || null });
          break;

        case 'kuaishouStateFeeds':
          // v2.5.83 快手推荐流：读页面自带的那一整批「作品档案」（含发布时间到秒、作者 ID）。
          // 一次搬一整批（约 19 条）回来缓存，切到下一条就不用再注入。失败一律 null。
          const ksFeeds = await this.loadKuaishouStateFeeds(
            sender && sender.tab ? sender.tab.id : null
          );
          sendResponse({ ok: !!ksFeeds, feeds: ksFeeds || null });
          break;

        default:
          console.warn('未知的消息类型:', message.action);
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('处理消息失败:', error);
      sendResponse({ error: error.message });
    }
  }

  /**
   * v2.5.77：读抖音弹窗这一条作品的原始数据（React fiber 上的 awemeInfo）
   *
   * 做法：用 chrome.scripting.executeScript 把 douyin-fiber.js 里的纯函数
   * 注入到**页面环境**（world:'MAIN'）跑一次。隔离环境读不到页面 JS 挂在 DOM 上的对象属性，
   * 所以必须在页面环境里跑。
   *
   * 三条约定：
   *   - 只在内容脚本问的时候注入，不常驻、不加监听、不轮询、不 hook 网络
   *   - 任何失败（权限、标签页关了、注入被拦、页面没有 fiber）都返回 null，不抛
   *   - 不改 content_scripts，manifest 的脚本清单一个不动（scripting 权限本来就有）
   *
   * @param {number|null} tabId
   * @param {string} modalId 作品 ID
   * @returns {Promise<Object|null>}
   */
  async readDouyinFiberMeta(tabId, modalId) {
    try {
      if (typeof tabId !== 'number') return null;
      if (typeof readDouyinAwemeInfo !== 'function') return null;

      const scripting = (WBR && WBR.scripting) || (typeof chrome !== 'undefined' ? chrome.scripting : null);
      if (!scripting || typeof scripting.executeScript !== 'function') return null;

      const target = String(modalId == null ? '' : modalId);
      const results = await scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: readDouyinAwemeInfo,
        args: [target]
      });

      const first = Array.isArray(results) ? results[0] : null;
      const meta = first && first.result ? first.result : null;
      if (!meta || typeof meta !== 'object') return null;
      return meta;
    } catch (error) {
      console.warn('[ClipMate] 读取抖音原始数据失败，将走 DOM 取法:', error && error.message);
      return null;
    }
  }

  /**
   * v2.5.83：快手推荐流 —— 读页面自带的那整批「作品档案」
   *
   * 同样是用 chrome.scripting.executeScript 把 kuaishou-state.js 里的纯函数
   * 注入到**页面环境**（world:'MAIN'）跑一次。**一次搬一整批**（约 19 条）回来。
   *
   * 四条约定（与抖音那条完全一致）：
   *   - 只在内容脚本问的时候注入；这一批拿到了内容端会缓存，短期不会重复问
   *   - 不常驻、不加监听、不轮询、不 hook 网络、不主动发请求
   *   - 任何失败（权限、标签页关了、注入被拦、页面没有这份数据）都返回 null，不抛
   *   - 不改 content_scripts 的加载顺序依赖（scripting 权限本来就有）
   *
   * @param {number|null} tabId
   * @returns {Promise<{count:number, items:Object}|null>}
   */
  async loadKuaishouStateFeeds(tabId) {
    try {
      if (typeof tabId !== 'number') return null;
      if (typeof readKuaishouStateFeeds !== 'function') return null;

      const scripting = (WBR && WBR.scripting) || (typeof chrome !== 'undefined' ? chrome.scripting : null);
      if (!scripting || typeof scripting.executeScript !== 'function') return null;

      const results = await scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: readKuaishouStateFeeds
      });

      const first = Array.isArray(results) ? results[0] : null;
      const feeds = first && first.result ? first.result : null;
      if (!feeds || typeof feeds !== 'object' || !feeds.items) return null;
      return feeds;
    } catch (error) {
      console.warn('[ClipMate] 读取快手作品档案失败，将走封面地址取法:', error && error.message);
      return null;
    }
  }

  /**
   * v2.5.72 跨站补网址：按内容端给的 URL 取回原件（不做解析，解析在 cross-site-linker.js）
   *
   * 为什么要放后台：内容脚本直接 fetch 这三个域名会被 CORS 拦。
   * 为什么要白名单：这个口子只应给「查条目」用，不能变成任意代理。
   *
   * v2.5.73：多回一个 `url`（跟随重定向后的最终地址）。
   * TMDB 的 /redirect 端点靠「最后落在哪个地址」来判断有没有这条，
   * 拿不到最终地址就没法用这个精确入口。
   * 另外支持 `urlOnly`：只想要最终地址时不要正文，省掉一次 150KB 的电影页下载。
   *
   * @param {Array<{kind:string, method:string, url:string, body?:string, urlOnly?:boolean}>} requests
   * @returns {Promise<Object>} { [kind]: { ok, status?, url?, text?, error? } }
   */
  async fetchCrossSite(requests) {
    // v2.5.76：加 www.goodreads.com —— 书籍 URL 补齐走 `/book/isbn/<ISBN>` 直达，
    // 靠「落地地址有没有变成 /book/show/<id>」判断有没有这一版。
    const ALLOW_HOSTS = ['www.douban.com', 'api.bgm.tv', 'www.themoviedb.org', 'v3.sg.media-imdb.com', 'www.goodreads.com'];
    const MAX_REQUESTS = 6;
    const TIMEOUT_MS = 10000;

    const list = Array.isArray(requests) ? requests.slice(0, MAX_REQUESTS) : [];

    const fetchOne = async (req) => {
      try {
        const u = new URL(req.url);
        if (u.protocol !== 'https:' || ALLOW_HOSTS.indexOf(u.hostname) === -1) {
          return { ok: false, error: '不允许的地址: ' + u.hostname };
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const init = { method: req.method === 'POST' ? 'POST' : 'GET', signal: controller.signal };
          if (init.method === 'POST') {
            init.headers = { 'Content-Type': 'application/json' };
            init.body = req.body || '';
          }
          const res = await fetch(req.url, init);
          // res.url 是跟随重定向之后的最终地址；没跳过就是原地址本身
          if (req.urlOnly) {
            return { ok: res.ok, status: res.status, url: res.url };
          }
          const text = await res.text();
          return { ok: res.ok, status: res.status, url: res.url, text: text };
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        const isTimeout = e && e.name === 'AbortError';
        return { ok: false, error: isTimeout ? '超时（10 秒未响应）' : (e && e.message) };
      }
    };

    const results = {};
    await Promise.all(list.map(async (req) => {
      results[req.kind] = await fetchOne(req);
    }));
    return results;
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    // 检查是否是支持的网站
    if (changeInfo.status === 'complete' && tab.url) {
      const supportedSites = [
        'book.douban.com',
        'movie.douban.com',
        'www.douban.com',
        'bgm.tv',
        'www.qidian.com',
        'store.steampowered.com',
        'www.imdb.com',
        'www.themoviedb.org'
      ];

      const url = new URL(tab.url);
      const isSupported = supportedSites.some(site => url.hostname.includes(site));

      if (isSupported) {
        // 可以在这里执行页面特定的操作
      }
    }
  }

  async initStorage() {
    // 初始化存储结构
    //
    // v2.8.1：这里原来还会写一个 `extractedData: []`（「提取历史」）。
    // 查遍全项目：从来没有一处往它里面写过东西，读它的 4 个处理器也早就没人调，
    // 是个纯死键 —— 留着只会让人以为「有历史记录」。删掉这次初始化，
    // 老用户机器上那份空数组由 clearCache 顺手清掉即可。
    const result = await WBR.storage.local.get(['config']);

    if (!result.config) {
      const defaultConfig = {
        autoExtract: false,
        autoExtractDelay: 3, // v2.5.46：全站点自动提取需要等页面渲染，默认给 3 秒
        autoCopy: false,
        autoCopyFormat: 'markdown', // v2.5.66：自动复制用哪种格式 notion | markdown | plaintext
        showButton: true,
        // v2.5.46：站点级覆盖（key = 域名后缀，最长优先）
        siteOverrides: {},
        theme: 'system',
        fieldOrder: {}, // 按媒体类型存储的字段顺序对象
        fieldMappings: {}, // v2.8.2：字段改名
        settings: {
          enableCache: true,
          // v2.9.6：浮窗自动收起。默认值按站点类型实时算（社交开/其余关，见 site-config.js），
          // 这个键不再写默认值含义；只有老配置里显式 false 会被当作「全部关闭」迁移。
          autoDismiss: true,
          // v2.9.7：浮窗尺寸（全局项，设置页可改；这里是默认值）
          floatingWindowWidth: 320,
          floatingWindowMaxHeight: 800,
          // v2.8.2：简介长度上限（社交 / 影人 / 其他）
          descLimits: { social: 50000, person: 5000, other: 500 }
        }
      };
      
      await WBR.storage.local.set({ config: defaultConfig });
    }
  }

  async getMediaConfigs() {
    return {
      'book.douban.com': {
        type: 'book',
        patterns: ['/subject/']
      },
      'movie.douban.com': {
        type: 'movie',
        patterns: ['/subject/']
      },
      'www.douban.com': {
        // v2.7.12：影人/作者人物页 /personage/<数字>/ 与游戏页 /game/ 共用这个域名
        rules: [
          { type: 'person', patterns: ['/personage/'] },
          { type: 'game', patterns: ['/game/'] }
        ]
      },
      'game.douban.com': {
        type: 'game',
        patterns: ['/subject/']
      },
      'bgm.tv': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'bangumi.tv': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'chii.in': {
        type: 'auto',
        patterns: ['/subject/']
      },
      'www.qidian.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'qidian.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'store.steampowered.com': {
        type: 'game',
        patterns: ['/app/']
      },
      'www.imdb.com': {
        type: 'movie',
        patterns: ['/title/']
      },
      'www.themoviedb.org': {
        type: 'movie',
        patterns: ['/movie/', '/tv/']
      },
      'fanqienovel.com': {
        type: 'book',
        patterns: ['/page/']
      },
      'www.17k.com': {
        type: 'book',
        patterns: ['/book/']
      },
      'www.goodreads.com': {
        type: 'book',
        patterns: ['/book/show/']
      },
      'www.metacritic.com': {
        type: 'game',
        patterns: ['/game/']
      },
      'www.xiaoheihe.cn': {
        type: 'game',
        patterns: ['/app/topic/game/pc/']
      },
      'www.mobygames.com': {
        type: 'game',
        patterns: ['/game/']
      },
      // 红果短剧（v2.11.0）：详见 media-detector.getDefaultConfigs() 的同名条目，
      // 两份必须逐字对齐，否则会出现「按钮出来了但提取器找不到」或反之。
      'hongguoduanju.com': {
        type: 'tv',
        patterns: ['/detail'],
        noContentFallback: true
      },
      'www.hongguoduanju.com': {
        type: 'tv',
        patterns: ['/detail'],
        noContentFallback: true
      },
      'www.novelquickapp.com': {
        type: 'tv',
        patterns: ['/detail'],
        noContentFallback: true
      },
      // ===== 社交平台（v2.5.64 补齐：此前这些站不在表里，
      // 媒体类型只能靠「按正文关键词猜」，猜错会提取出别类的字段）=====
      'www.douyin.com': {
        // v2.7.11：改多规则 —— `/user/<sec_uid>` 是作者个人主页（人物档案 / account），
        // 但同路径带 `?modal_id=` 时是作品弹窗（社交）。person 那条排除 modal_id，
        // 排除后 social 那条也因 pathname 是 /user/ 而不命中 → 整体 null →
        // 交给 content-main 的 `_douyinModalOverrideType()` 补认（v2.5.77 起的既有行为）。
        // 这份配置与 media-detector.getDefaultConfigs() 必须逐字对齐，两份不一致会出现
        // 「按钮出来了但提取器找不到」或反之。
        rules: [
          { type: 'person', patterns: ['/user/'], excludeQuery: ['modal_id'] },
          { type: 'social', patterns: ['/video/', '/note/'] }
        ],
        // v2.5.77 批 1：抖音的弹窗入口（/jingxuan、/search、/user、/hashtag、
        // /collection、/discover）从本版起也会加载内容脚本，但这些路径本身
        // 「没有可提取的详情页」。不加这道标记时，detect() 会退回「按正文关键词
        // 猜类型」，在信息流页面上猜出 social/movie → 冒出按钮 → 点开还是错的。
        // 所以：路径不匹配 = 这里没东西可提，直接放弃，不要猜。
        // 只影响抖音一个域名，其他站不认这个字段。
        noContentFallback: true
      },
      'v.douyin.com': {
        type: 'social',
        patterns: ['/']
      },
      'www.kuaishou.com': {
        // v2.7.17：与 media-detector 同步拆成多规则 —— `/profile/<id>` 是个人主页（人物档案），
        // `/short-video/<id>`、`/video/<id>` 是作品页（社交）。
        // 主页上点开作品弹层（地址不变）归作品，由 KuaishouSpaMixin 补认。
        rules: [
          { type: 'person', patterns: ['/profile/'] },
          { type: 'social', patterns: ['/short-video/', '/video/'] }
        ],
        // v2.5.82：推荐流 `/new-reco` 不是详情页，**不能**按正文猜类型。
        // 不匹配 patterns 就干脆不认（与抖音 /follow 那批同一条纪律）；
        // 真正的接管由内容脚本里的 KuaishouSpaMixin 负责。
        noContentFallback: true
      },
      'www.instagram.com': {
        // v2.7.20：与 media-detector 同步拆成多规则 —— 单段路径 `/<username>/` 是个人主页
        // （人物档案 / account），其余（`/p|reel|reels|tv/<code>/`、`/stories/…`）是作品页（社交）。
        // 主页没有固定前缀，用 `regex` 表达（_ruleMatches 支持 regex 字段）。
        // 这份配置与 media-detector.getDefaultConfigs() 必须逐字对齐。
        rules: [
          {
            type: 'person',
            regex: '^/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)/?(?:[?#]|$))[A-Za-z0-9_.]+/?(?:[?#]|$)'
          },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'www.xiaohongshu.com': {
        // v2.7.16：拆成多规则 —— `/user/profile/<userId>` 是**个人主页**（人物档案 / account），
        // `/explore/<笔记ID>` 与 `/discovery/item/<笔记ID>` 才是作品页（社交）。
        // 两者路径前缀完全不重叠，不需要 excludeQuery。
        // 这份配置与 media-detector.getDefaultConfigs() 必须逐字对齐。
        rules: [
          { type: 'person', patterns: ['/user/profile/'] },
          { type: 'social', patterns: ['/discovery/item/', '/explore/'] }
        ]
      },
      // v2.7.26：微博拆多规则（与 media-detector.js 那份逐字一致）
      'www.weibo.com': {
        rules: [
          { type: 'person', regex: '^/u/\\d{5,20}/?$' },
          { type: 'person', regex: '^/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:/|$))[A-Za-z][A-Za-z0-9_-]{1,29}/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'weibo.com': {
        rules: [
          { type: 'person', regex: '^/u/\\d{5,20}/?$' },
          { type: 'person', regex: '^/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:/|$))[A-Za-z][A-Za-z0-9_-]{1,29}/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      // v2.7.40：微博搜索页独立域名。原先三处配置（本文件 / media-detector.js /
      // extractor-factory.js）都没有它，后果是搜索页「能挂按钮、点了却按整页通用提取」——
      // 真实表现是浮窗 6 列全空、URL 变成搜索页自己的地址。搜索页只有一种形态：全是博文，故单条 social。
      's.weibo.com': {
        type: 'social',
        patterns: ['/']
      },
      'm.weibo.cn': {
        type: 'social',
        patterns: ['/']
      },
      'x.com': {
        rules: [
          { type: 'person', regex: '^/(?!home(?:/|$)|explore(?:/|$)|search(?:/|$)|i(?:/|$)|settings(?:/|$)|notifications(?:/|$)|messages(?:/|$)|compose(?:/|$)|intent(?:/|$)|personalize(?:/|$)|privacy(?:/|$)|tos(?:/|$)|login(?:/|$)|signup(?:/|$)|logout(?:/|$)|session(?:/|$)|account(?:/|$)|share(?:/|$)|hashtag(?:/|$)|trends(?:/|$)|dev(?:/|$)|jobs(?:/|$)|help(?:/|$)|welcome(?:/|$)|verify(?:/|$)|flow(?:/|$)|articles(?:/|$)|events(?:/|$)|browse(?:/|$))[A-Za-z0-9_]{1,15}/?$' },
          { type: 'person', regex: '^/[A-Za-z0-9_]{1,15}/about/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      'www.x.com': {
        rules: [
          { type: 'person', regex: '^/(?!home(?:/|$)|explore(?:/|$)|search(?:/|$)|i(?:/|$)|settings(?:/|$)|notifications(?:/|$)|messages(?:/|$)|compose(?:/|$)|intent(?:/|$)|personalize(?:/|$)|privacy(?:/|$)|tos(?:/|$)|login(?:/|$)|signup(?:/|$)|logout(?:/|$)|session(?:/|$)|account(?:/|$)|share(?:/|$)|hashtag(?:/|$)|trends(?:/|$)|dev(?:/|$)|jobs(?:/|$)|help(?:/|$)|welcome(?:/|$)|verify(?:/|$)|flow(?:/|$)|articles(?:/|$)|events(?:/|$)|browse(?:/|$))[A-Za-z0-9_]{1,15}/?$' },
          { type: 'person', regex: '^/[A-Za-z0-9_]{1,15}/about/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      },
      // v2.7.22：TikTok 拆多规则 —— 个人主页 `/@<handle>`（单段）→ 人物档案；
      // 其余（`/@user/video/<id>`、`/@user/photo/<id>`、推荐流）→ 社交。
      // 与 content/utils/media-detector.js 那份逐字一致（两份必须同步，否则
      // 内容脚本与后台对同一个地址判出两种类型）。
      'www.tiktok.com': {
        rules: [
          { type: 'person', regex: '^/@[A-Za-z0-9_.]{2,40}/?$' },
          { type: 'social', patterns: ['/video/', '/@'] }
        ]
      },
      'tiktok.com': {
        rules: [
          { type: 'person', regex: '^/@[A-Za-z0-9_.]{2,40}/?$' },
          { type: 'social', patterns: ['/video/', '/@'] }
        ]
      },
      // v2.7.23：YouTube 拆多规则（与 media-detector 那份逐字一致）——
      // 频道页 `/@<handle>`、`/channel/UC<24位>`（含子页）→ 人物档案；
      // `/watch`、`/shorts/<id>` → 社交。person 必须排在 social 之前。
      'www.youtube.com': {
        rules: [
          { type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?/?$' },
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] }
        ]
      },
      'youtube.com': {
        rules: [
          { type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?/?$' },
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] }
        ]
      },
      'www.bilibili.com': {
        type: 'social',
        patterns: ['/video/', '/bangumi/play/']
      },
      'bilibili.com': {
        type: 'social',
        patterns: ['/video/', '/bangumi/play/']
      },
      'space.bilibili.com': {
        rules: [
          { type: 'person', regex: '^/\\d{1,15}(?:/(?:dynamic|upload|lists|pugv|series|channels|favlist|following|fans|article|audio|album|comic|bangumi|cheese|video))?/?$' },
          { type: 'social', patterns: ['/'] }
        ]
      }
    };
  }

  async saveConfig(newConfig, extras) {
    const result = await WBR.storage.local.get(['config']);
    const currentConfig = result.config || {};

    // settings 这一层做深合并：原来整体替换会把同层的其他键（缓存有效期等）吃掉。
    // v2.8.0 起设置页只改 settings.enableCache 一项，必须保留兄弟键。
    const updatedConfig = {
      ...currentConfig,
      ...newConfig
    };
    if (newConfig && newConfig.settings && typeof newConfig.settings === 'object') {
      updatedConfig.settings = {
        ...(currentConfig.settings || {}),
        ...newConfig.settings
      };
    }

    // config 与 extras（旧独立键）一次 set 落盘，避免出现「一半新一半旧」的中间态
    const payload = { config: updatedConfig };
    if (extras && typeof extras === 'object') {
      for (const k of Object.keys(extras)) {
        if (extras[k] === undefined) continue;
        payload[k] = extras[k];
      }
    }
    await WBR.storage.local.set(payload);

    // 如果配置中包含缓存设置，通知所有活跃标签页更新缓存配置
    if (updatedConfig.settings && 'enableCache' in updatedConfig.settings) {
      const tabs = await WBR.tabs.query({active: true, currentWindow: true});
      tabs.forEach(tab => {
        if (tab.id) {
          WBR.tabs.sendMessage(tab.id, {
            action: 'updateCacheConfig',
            enabled: updatedConfig.settings.enableCache
          }).catch(err => {
          });
        }
      });
    }
  }

  async getConfig() {
    const result = await WBR.storage.local.get(['config']);
    return result.config || {};
  }

  async clearCache() {
    // v2.5.45 修复：原实现只删 ['cache', 'extractedData']，
    // 但键名 'cache' 在整个项目里从未被写入过（真缓存是 CacheManager 的
    // media_extractor_persistent_cache），config 也完全没动，
    // 所以「重置」按钮实际什么都没重置。
    //
    // ⚠️ 这个函数会**连 config 一起删**（等于把全部设置恢复出厂）。
    //    它现在只服务 popup 的「恢复默认」；设置页「数据」里的「清缓存」走
    //    clearCacheOnly()（v2.8.1），两者语义必须分清，别混用。
    await WBR.storage.local.remove([
      'cache',
      'extractedData',
      'media_extractor_persistent_cache',
      'config'
    ]);

    // 重新初始化（initStorage 在 config 缺失时会写入默认配置）
    await this.initStorage();
  }

  // ============ 缓存：真实键名与「只清缓存」（v2.8.1） ============
  //
  // 勘误：真缓存**不是**单个 `media_extractor_persistent_cache` 键。
  // CacheManager 从 v2.5.50 起改成「一项一个键」，键名 = `media_extractor_pcache:<fullKey>`；
  // 单键那份只是升级前的旧布局，早就不写了。
  // 所以「清缓存」必须按前缀扫 —— 只删那一个键等于什么都没清掉（老 clearCache 就踩了这个坑）。
  static CACHE_PREFIX = 'media_extractor_pcache:';
  static CACHE_LEGACY = 'media_extractor_persistent_cache';

  /** 扫出所有缓存键（新分片 + 旧单键 + 更早的 'cache'） */
  async _cacheKeys() {
    const all = await WBR.storage.local.get(null);
    return Object.keys(all || {}).filter((k) =>
      k.indexOf(BackgroundService.CACHE_PREFIX) === 0 ||
      k === BackgroundService.CACHE_LEGACY ||
      k === 'cache'
    );
  }

  async _bytesOf(keys) {
    if (!keys.length) return 0;
    try {
      if (typeof WBR.storage.local.getBytesInUse === 'function') {
        return await WBR.storage.local.getBytesInUse(keys);
      }
    } catch (e) { /* 拿不到就不显示大小，不影响清理 */ }
    return 0;
  }

  /** 缓存占用（设置页「数据」页显示用） */
  async getCacheStats() {
    const keys = await this._cacheKeys();
    return { entries: keys.length, bytes: await this._bytesOf(keys) };
  }

  /**
   * 只清缓存：设置、站点覆盖、功能开关、字段顺序一个都不碰。
   * 光删存储不够 —— 内容端内存里还握着同一份，当前页面照样命中旧结果，
   * 所以顺手让所有标签把内存缓存也清了（内容端监听 'clearCache' 就是这么做的）。
   */
  async clearCacheOnly() {
    const keys = await this._cacheKeys();
    const bytes = await this._bytesOf(keys);
    if (keys.length) await WBR.storage.local.remove(keys);

    try {
      const tabs = await WBR.tabs.query({});
      (tabs || []).forEach((tab) => {
        if (!tab || !tab.id) return;
        try {
          Promise.resolve(WBR.tabs.sendMessage(tab.id, { action: 'clearCache' })).catch(() => {});
        } catch (e) { /* 没注入内容脚本的标签会抛，忽略 */ }
      });
    } catch (e) { /* 拿不到标签列表不影响清理结果 */ }

    return { removed: keys.length, bytes };
  }

  /**
   * 重置站点专属功能开关：config.features 清空 + 旧独立键删掉。
   * 删（而不是写 true）才能让以后改默认值时跟着走；删掉即「缺省 = 开」。
   */
  async resetFeatures(legacyKeys) {
    const result = await WBR.storage.local.get(['config']);
    const config = result.config || {};
    config.features = {};
    await WBR.storage.local.set({ config });

    const keys = (Array.isArray(legacyKeys) ? legacyKeys : [])
      .filter((k) => typeof k === 'string' && k);
    if (keys.length) await WBR.storage.local.remove(keys);
    return { removedKeys: keys.length };
  }

  
  // 从作者主页获取完整作者名称
  async fetchAuthorPage(authorUrl, retryCount = 0) {
    // 添加URL参数验证，确保URL有效
    if (!authorUrl || typeof authorUrl !== 'string' || authorUrl.trim() === '') {
      console.warn('无效的作者URL，跳过请求');
      return null;
    }
    
    try {
      
      // 添加超时控制的fetch函数，优化错误处理
      const fetchWithTimeout = (url, options, timeout = 12000) => {
        return Promise.race([
          fetch(url, options)
            .then(response => {
              // 只检查响应是否成功，不抛出HTTP错误，避免过多的错误日志
              return response;
            }),
          new Promise((_, reject) => 
            setTimeout(() => {
              const timeoutError = new Error('请求超时');
              timeoutError.name = 'TimeoutError';
              reject(timeoutError);
            }, timeout)
          )
        ]);
      };
      
      // 优化请求配置，增强请求成功率
      // 根据重试次数动态调整超时时间，给予更充足的时间
      const adjustedTimeout = Math.min(15000 + retryCount * 3000, 30000);
      
      // 优化请求头，模拟真实浏览器行为，减少被拦截的可能性
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      };
      
      // 仅在豆瓣域名时添加豆瓣相关的Referer
      if (authorUrl.includes('douban.com')) {
        headers['Referer'] = 'https://book.douban.com/';
      }
      
      // 优化请求配置，减少跨域问题
      const response = await fetchWithTimeout(authorUrl, {
        method: 'GET',
        headers: headers,
        cache: 'no-cache',
        mode: 'cors',
        redirect: 'follow'
      }, adjustedTimeout);
      
      // 检查响应状态码，针对不同状态码采取不同策略
      if (response.ok) { // 200-299状态码
        try {
          // 获取页面HTML内容
          const htmlContent = await response.text();
          
          // 直接从HTML文本中提取title标签内容 - 这是油猴脚本使用的方法
          const titleMatch = htmlContent.match(/<title>([^(]+?)\s*(?:\(\s*豆瓣\s*\))?<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            const titleName = titleMatch[1].trim();
            return titleName; // 优先使用title标签内容
          }
          
          // 如果title标签提取失败，使用常规方法
          const fullName = this.extractAuthorFullName(htmlContent, authorUrl);
          
          if (fullName) {
            return fullName;
          } else {
            return null;
          }
        } catch (parseError) {
          console.warn(`解析HTML内容时出错: ${parseError.message}`);
          return null;
        }
      } else {
        // 服务器返回错误状态码
        const status = response.status;
        
        // 记录HTTP状态码，便于调试
        console.warn(`HTTP状态码: ${status}, URL: ${authorUrl}`);
        
        // 对服务器错误和特定客户端错误进行有限次数的重试
        // 500-599: 服务器错误，429: 请求过多，408: 请求超时
        const retryableStatus = status >= 500 || status === 429 || status === 408;
        
        if (retryableStatus && retryCount < 2) { // 最多重试2次
          // 使用更智能的指数退避策略，增加更多随机因素
          const baseDelay = (retryCount + 1) * 1000;
          const randomFactor = 500 + Math.random() * 1000; // 500-1500ms的随机延迟
          const delay = baseDelay + randomFactor;
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.fetchAuthorPage(authorUrl, retryCount + 1); // 重试，增加重试计数
        }
        
        return null; // 不再抛出错误，而是返回null
      }
    } catch (error) {
      // 更全面的错误类型处理
      let errorType = '未知错误';
      
      // 针对不同类型的错误进行分类
      if (error.name === 'TypeError') {
        if (error.message === 'Failed to fetch') {
          errorType = '网络请求失败';
        } else {
          errorType = '类型错误';
        }
      } else if (error.name === 'TimeoutError' || error.message === '请求超时') {
        errorType = '请求超时';
      } else if (error.name === 'AbortError') {
        errorType = '请求被中止';
      }
      
      // 只记录警告而不是错误，避免控制台过多的红色错误信息
      console.warn(`获取作者页面时遇到[${errorType}]: ${error.message} (URL: ${authorUrl})`);
      
      // 网络错误时进行有限次数的重试，但对特定错误类型进行智能判断
      const shouldRetry = retryCount < 2 && (
        error.message === 'Failed to fetch' || 
        error.name === 'TimeoutError' || 
        error.message === '请求超时'
      );
      
      if (shouldRetry) {
        // 更智能的重试策略
        const baseDelay = Math.pow(2, retryCount) * 1000; // 指数退避：1s, 2s, 4s...
        const randomJitter = Math.random() * 1000; // 添加随机抖动避免请求风暴
        const delay = baseDelay + randomJitter;
        
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchAuthorPage(authorUrl, retryCount + 1);
      }
      
      // 达到最大重试次数或非网络错误，返回null但提供更多信息
      
      // 优雅降级：尝试从URL本身提取可能的作者信息作为最后手段
      try {
        const urlObj = new URL(authorUrl);
        const pathParts = urlObj.pathname.split('/').filter(part => part);
        // 尝试从URL路径中提取可能的作者标识或名称
        if (pathParts.length > 0) {
          const potentialId = pathParts[pathParts.length - 1];
          if (potentialId && !potentialId.match(/^\d+$/)) { // 如果不是纯数字ID，可能是用户名
            // 返回清理后的标识作为最后的备选方案
            return potentialId.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_\-]/g, '');
          }
        }
      } catch (e) {
        // URL解析失败不影响主流程
      }
      
      return null;
    }
  }
  
  // 从HTML内容中提取作者完整名称
  extractAuthorFullName(htmlContent, authorUrl) {
    try {
      
      // 创建一个临时DOM解析器
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      
      
      // 注意：title标签的提取已在 fetchAuthorPage() 中优先处理并提前返回
      // 这里不再重复检查，直接进入 DOM 解析提取逻辑
      
      // 1. 从h1标签提取
      const h1El = doc.querySelector('h1');
      if (h1El) {
        const h1Text = h1El.textContent.trim();
        // 清理h1文本，移除"- 豆瓣"等后缀
        const cleanText = h1Text.replace(/\s*-\s*豆瓣\s*$/, '').trim();
        if (cleanText) {
          return cleanText;
        }
      }
      
      // 2. 增强personage页面特殊处理
      if (authorUrl.includes('/personage/')) {
        
        // 查找可能包含作者名的特定区域
        const infoBlocks = doc.querySelectorAll('.intro, .subject-intro, #content .article');
        for (const block of infoBlocks) {
          const blockText = block.textContent;
          
          // 尝试分别提取中文和英文名称，然后组合
          const chineseNames = blockText.match(/[\u4e00-\u9fa5]{2,}\s*[·.]?\s*[\u4e00-\u9fa5]+/g) || [];
          const englishNames = blockText.match(/[A-Z][a-z]+(\s+[A-Z][a-z]+){1,}/g) || [];
          
          if (chineseNames.length > 0 && englishNames.length > 0) {
            // 选择最可能的中英文组合
            const fullName = `${chineseNames[0].trim()} ${englishNames[0].trim()}`;
            return fullName;
          } else if (chineseNames.length > 0) {
            // 如果只有中文名称，也返回
            return chineseNames[0].trim();
          }
        }
        
        // 尝试从h1.subject-name元素提取
        const subjectNameEl = doc.querySelector('h1.subject-name');
        if (subjectNameEl) {
          const subjectName = subjectNameEl.textContent.trim();
          if (subjectName) {
            return subjectName;
          }
        }
      }
      
      // 3. 从JSON-LD数据提取
      const jsonLdScript = doc.querySelector('script[type="application/ld+json"]');
      if (jsonLdScript) {
        try {
          const jsonData = JSON.parse(jsonLdScript.textContent);
          if (jsonData.name) {
            return jsonData.name;
          }
        } catch (e) { console.debug('[ClipMate] 已忽略异常:', e && e.message); }
      }
      
      // 4. 从页面标题提取（作为备用）
      const titleEl = doc.querySelector('title');
      if (titleEl) {
        const title = titleEl.textContent.trim();
        
        // 解析标题，提取作者名称部分
        if (title.includes('-')) {
          const authorPart = title.split('-')[0].trim();
          if (authorPart) {
            return authorPart;
          }
        }
      }
      
      // 5. 从author-header或person-info元素提取
      const authorHeaderEl = doc.querySelector('.author-header, .person-info');
      if (authorHeaderEl) {
        const headerText = authorHeaderEl.textContent.trim();
        // 查找包含作者信息的文本块
        const textBlocks = headerText.split(/[\n\r]+/);
        for (const block of textBlocks) {
          const trimmedBlock = block.trim();
          if (trimmedBlock && trimmedBlock.length < 100) {
            return trimmedBlock;
          }
        }
      }
      
      // 6. 从meta标签提取
      const ogTitleMeta = doc.querySelector('meta[property="og:title"]');
      if (ogTitleMeta) {
        const ogTitle = ogTitleMeta.getAttribute('content');
        if (ogTitle) {
          return ogTitle;
        }
      }
      
      // 7. 从页面中查找包含作者信息的特定元素
      const potentialNameElements = doc.querySelectorAll('h1, .title, .name, .author-name');
      for (const el of potentialNameElements) {
        const text = el.textContent.trim();
        // 过滤掉过长或明显不是作者名称的文本
        if (text && text.length < 50 && !text.includes('评价') && !text.includes('评论')) {
          return text;
        }
      }
      
      // 8. 特殊处理personage类型页面
      if (authorUrl.includes('/personage/')) {
        // 查找可能包含作者详情的区域
        const infoBlocks = doc.querySelectorAll('.info, .detail, .bd, .db');
        for (const block of infoBlocks) {
          const blockText = block.textContent;
          // 使用更宽松的模式查找可能的作者名称组合
          const namePattern = /[\u4e00-\u9fa5]{2,}[\s\n]+[a-zA-Z\s]+|[\u4e00-\u9fa5]{2,}/;
          const match = blockText.match(namePattern);
          if (match) {
            const potentialName = match[0].trim();
            return potentialName;
          }
        }
      }
      
      // 9. 使用通用正则表达式匹配
      const generalPattern = /[\u4e00-\u9fa5]{2,}(?:\s+[A-Z][a-zA-Z\s\.\-]+)?/;
      const match = htmlContent.match(generalPattern);
      if (match) {
        const cleanName = match[0].trim();
        return cleanName;
      }
      
      return null;
    } catch (error) {
      console.error(`提取作者名称时出错: ${error.message}`);
      return null;
    }
  }
}

// 初始化后台服务（确保只执行一次）
const backgroundService = new BackgroundService();

// 导出服务
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BackgroundService;
}