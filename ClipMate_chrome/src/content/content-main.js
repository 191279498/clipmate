// 主内容脚本 - 添加调试版本标识
// 注意：所有依赖已在manifest.json中作为单独的脚本加载
// 这里不再需要import语句

// 初始化全局缓存管理器
if (typeof CacheManager !== 'undefined' && !window.cacheManager) {
  window.cacheManager = new CacheManager();
}

// 安全日志记录函数：统一走日志闸门（默认静默；localStorage.clipmateDebug=1 时可见）
function safeLog(message) {
  try {
    if (typeof ClipMateLog !== 'undefined') {
      ClipMateLog.info('[ClipMate] ' + message);
      return;
    }
    // 闸门未就绪时的兜底，保证任何情况下都不会抛错中断提取
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      ClipMateLog.debug('[ClipMate] ' + message);
    }
  } catch (e) {
    // 静默处理日志错误
  }
}

/**
 * v2.8.2：把设置页传来的简介上限收敛成一个可用的数。
 * 缺值 / 脏值 → 用 fallback（= 搬进设置页之前的硬编码值）；
 * 0 或负数 → 不限制（设置页那一栏的提示语就是这么向用户承诺的）。
 */
function numOr(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  var n = parseInt(raw, 10);
  if (isNaN(n)) return fallback;
  return n <= 0 ? Number.MAX_SAFE_INTEGER : n;
}

// 脚本加载确认（默认静默，开闸门后才可见）
safeLog('==========================================');
safeLog('==========================================');

class MediaExtractor {
  constructor() {
    this.detector = null;
    this.buttonManager = null;
    this.modalManager = null;
    this.fieldMapper = null;
    this.titleProcessor = null;
    this.extractorFactory = null;
    this.isInitialized = false;
    this.currentExtractor = null; // 当前使用的提取器实例，供其他组件访问
    
    // 初始化特殊字符转换器
    this.specialCharConverter = typeof window.SpecialCharConverter !== 'undefined' ? window.SpecialCharConverter : null;
    
    // 缓存相关属性
    this.cache = new Map(); // 使用Map存储提取结果缓存
    // v2.5.48：补上查询参数后同一域名会有更多条目，加个上限防止无限增长
    this.cacheMaxSize = 50;
    this.cacheKey = null; // 当前页面的缓存键
    this.cacheEnabled = true; // 默认启用缓存

    // Instagram SPA Modal 实时捕获相关状态（单例内存态，不随 SPA 导航重建）
    this.activeContext = null;   // 当前打开的 Modal root（div[role="dialog"]），无 Modal 时为 null
    this.activeShortcode = null; // 当前 Modal 内帖子的 shortcode
    this.autoExtract = false;    // 是否自动提取（来自 popup 的 autoExtract 配置）
    this.autoExtractDelay = 0;   // 自动提取前等待秒数（来自 popup，v2.5.45 接线）
    this.autoCopy = false;       // 提取成功后是否自动复制（来自 popup，v2.5.45 接线）
    this.autoCopyFormat = 'markdown'; // 自动复制用哪种格式 notion|markdown|plaintext（v2.5.66）
    this.features = {};          // v2.8.0：本站点专属功能开关（逐条按钮等），见 feature-flags.js
    this.doubanListBtnLayout = 'A'; // v2.11.7：豆瓣收藏列表小按钮落点（A/B/C），见 settings-schema.js
    this._autoExtractTimer = null;
    this.modalWatcher = null;    // InstagramModalWatcher 实例
  }

  async init() {
    const startTime = performance.now();
    safeLog('🔍 ===== 媒体提取器初始化开始 =====');

    // v2.9.3：先开站点明暗监听，再建按钮/浮窗 —— 反过来的话第一屏元素会先按浅色画一次，
    // 判定回来后再变深，出现一闪。判定本身是同步的，开监听只是为后续变化做准备。
    if (typeof SiteTheme !== 'undefined' && SiteTheme.shared) {
      try { SiteTheme.shared.start(); } catch (e) { /* 判定不可用时一律按浅色 */ }
    }

    // v2.8.0：任何入口改了设置都即时生效 —— 不再依赖 popup 发消息给「当前标签」。
    // 以前在设置页改站点设置，其他已打开的标签要刷新才生效，和「改完立即生效」的文案对不上。
    this._bindConfigWatcher();
    
    try {
      
      // 重新检查并初始化特殊字符转换器
      if (typeof window.SpecialCharConverter !== 'undefined' && !this.specialCharConverter) {
        this.specialCharConverter = window.SpecialCharConverter;
      }
      
      // 设置当前页面的缓存键
      this.cacheKey = this.generateCacheKey(window.location.href);
      
      // 初始化各个组件
      await this.initComponents();

      // v2.11.5：豆瓣收藏列表页（影视 / 读书 / 游戏）走独立通道。
      //
      // 为什么必须放在 detectMediaType() **之前**、而且不能塞进 `if (!mediaType)`：
      // 收藏页地址不命中 media-detector 的 /subject/ 规则，会落到「按正文猜类型」兜底，
      // 返回字符串 'unknown' 或 'movie'（**都是真值**）。v2.11.4 把挂按钮放在那个分支里，
      // 结果分支一次都没进过，整套逐条按钮从未生效（真机按钮数 = 0）。
      // 现在只认地址白名单，不问媒体类型；同时提前 return，跳过详情页那套
      // 字段映射 / 自动提取（否则进列表页会自动弹一个空浮窗）。
      const listKind = (typeof PageShape !== 'undefined' && PageShape.doubanListKind)
        ? PageShape.doubanListKind(location.hostname, location.pathname) : null;
      if (listKind) {
        // v2.11.7：这条分支在正常流程的 refreshConfig 之前就 return 了，
        // 所以**必须自己读一次配置** —— 否则 `features` 永远是空的、
        // 「逐条按钮」开关和小按钮落点（A/B/C）永远按默认值走，设置页改了不生效。
        await this.refreshConfig();

        this._pageShape = 'feed';
        try {
          // 只藏不摘：摘掉后 _applyPageShape 会因 !bm.button 提前 return，
          // 而且这一页本来就不该有全局大按钮。
          if (this.buttonManager && typeof this.buttonManager.setVisible === 'function') {
            this.buttonManager.setVisible(false);
          }
        } catch (e) { /* 藏按钮失败不影响逐条按钮 */ }

        this._applyAutoDismiss(null);   // 列表页按 feed 形态开「滚动自动关浮窗」
        if (this._featureOn('doubanListButtons') && typeof this._initDoubanListButtons === 'function') {
          try {
            this._initDoubanListButtons(listKind);
          } catch (e) {
            ClipMateLog.debug('[豆瓣列表] 逐条按钮挂载失败: ' + (e && e.message));
          }
        }
        this.isInitialized = true;
        return;
      }

      // 检测媒体类型
      const mediaType = this.detectMediaType();
      if (!mediaType) {
        // 添加更详细的诊断信息
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;
        // 避免对象直接输出，防止触发反调试
        //
        // v2.5.77 批 3：抖音的精选 / 搜索 / 用户主页这些「弹窗播放入口」在打开视频前
        // 本来就没有可提取的内容，所以这里必然为空；但弹层一开就得出按钮。
        // 因此先把监听挂上、把灰按钮摘掉，等弹层出现再由 DouyinSpaMixin 接管。
        // 只有抖音域名、且「抖音弹窗提取」开关没关时才会接管（其他站一律 false）。
        if (typeof this._startDouyinModalWatcher === 'function') {
          try {
            if (await this._startDouyinModalWatcher()) return;
          } catch (e) {
            // 接管失败就当没有这回事，继续走下面原来的清理逻辑（不影响任何站点）
          }
        }
        //
        // v2.5.82：快手推荐流 `/new-reco` 同样是「不是详情页」，加载时本来没有按钮。
        // 内部还有 pathname 白名单（只认 /new-reco）与域名门禁，其他页面一律 false。
        if (typeof this._startKuaishouImmersiveWatcher === 'function') {
          try {
            if (await this._startKuaishouImmersiveWatcher()) return;
          } catch (e) {
            // 同上：接管失败就继续走原来的清理逻辑
          }
        }
        //
        // v2.5.86：快手「站内跳转」接管。
        // 快手在网格页（发现 / 关注 / 同城 / 搜索结果 / 作者主页）点开作品是**换地址不换文档**，
        // 而 init() 只在文档加载时跑一遍 —— 结果是「点进去没按钮、同样地址按 F5 就有按钮」。
        // 这里挂一个只看地址的轻监听：地址变成详情页且内容渲染出来 → 重跑一次「出按钮」。
        // 内部有域名门禁（只认 www.kuaishou.com）与推荐流互斥，其他站点一律 false。
        if (typeof this._startKuaishouRouteWatcher === 'function') {
          try {
            if (this._startKuaishouRouteWatcher()) return;
          } catch (e) {
            // 接管失败就当没有这回事，继续走下面原来的清理逻辑
          }
        }
        //
        // v2.6.0：小红书列表页（/explore、/search_result、/user/profile/<id>）也会走到这里。
        // 它跟抖音/快手不一样 —— 点开笔记是**页内弹层**，不换文档，而且「当前地址没有笔记 ID」
        // 并不代表「这一页永远没有内容」。所以这里挂上站内跟随就**直接结束**，并且不能走
        // 下面那段「摘按钮」：那段会把 buttonManager.button 置空，之后就再也造不回来了
        // （从列表点开笔记时按钮永远不出现，这正是 v2.5.101 搜索页那条路的毛病）。
        // 域名门禁在 mixin 内部（只认 xiaohongshu.com），其他站点返回 false，继续走原来的清理。
        if (typeof this._startXhsSpa === 'function') {
          try {
            if (this._startXhsSpa()) {
              // 这条分支在 initFieldMapper() / initUI() **之前**就 return，
              // 收尾必须在这里补上：不补的话按钮虽然会被跟随逻辑显示出来，但它是
              // 构造时的置灰态（disabled + pending）、也没接点击回调，点下去毫无反应。
              // 只补「能提取」必需的三件事，**不**调度自动提取（列表页本来就没有可提的东西）。
              this.fieldMapper = await this.initFieldMapper('social');
              this.initUI();
              await this.refreshConfig();
              this.isInitialized = true;
              ClipMateLog.debug('[小红书] 列表页：跟随已挂上，初始化收尾已补齐');
              return;
            }
          } catch (e) {
            // 接管失败就继续走下面原来的清理逻辑（按钮会被摘掉，功能降级但不留死按钮）
            ClipMateLog.warn('[小红书] 列表页接管失败，回落原清理逻辑: ' + (e && e.message));
          }
        }
        //
        // v2.5.77 批 1：ButtonManager 是在 initComponents() 里 new 出来的，构造函数
        // 就把按钮插进 body 了（置灰 + pending），而这一步发生在 detectMediaType()
        // 之前。页面没有可提取内容时不能把这个灰按钮留在页面上——否则抖音的
        // 精选/搜索/用户主页这些「只加载脚本、不出按钮」的入口会多出一个永远点不动的按钮。
        // 只摘按钮，不动其他组件（没有全局监听挂在它身上，不拖拽就不会有 document 级监听）。
        try {
          if (this.buttonManager && this.buttonManager.button) {
            this.buttonManager.button.remove();
            this.buttonManager.button = null;
          }
        } catch (e) {
          // 清理失败不许影响初始化流程
        }

        return;
      }

      //
      // v2.7.17：快手个人主页（person）上还能点开一条作品 —— 那是**盖一层播放弹层、
      // 地址不变**（仍是 `/profile/<id>`），所以 init 走的是正常流程，
      // 上面那段 `if (!mediaType)` 根本没进，弹层监听也就没人挂。
      // 这里补挂一次（域名门禁与页面白名单都在 mixin 内部，其他站点返回 false）。
      //
      // **不 return、不摘按钮**：主页本来就该出按钮（提人物档案）；
      // 弹层一开由 `_kuaishouOverrideType()` 把 mediaType 切成 social（弹层优先提作品，
      // 用户 2026-10-31 拍板，与抖音 `?modal_id=` 那套同口径）；
      // 弹层关掉再切回 person。
      if (mediaType === 'person' && /^www\.kuaishou\.com$/i.test(location.hostname)) {
        if (typeof this._startKuaishouImmersiveWatcher === 'function') {
          try {
            await this._startKuaishouImmersiveWatcher({ keepButton: true, profilePerson: true });
          } catch (e) {
            // 挂不上只是「主页上开弹层提不到作品」，主页本身照常能用，不阻断初始化
          }
        }
      }

      // 初始化字段映射器
      this.fieldMapper = await this.initFieldMapper(mediaType);
      
      // 初始化UI
      this.initUI();
      
      // 启动 Instagram SPA Modal 监听器（实时捕获主页/feed 打开的 Post/Reels/Story Modal）
      // ⚠️ 仅限 Instagram：该监听器内部是 IG 专属逻辑（/p|reel|tv|stories/ 短码正则、
      //    IG 个人主页统计文案校验、容器只认 div[role="dialog"]），装到其他站点无法识别
      //    "换了一条内容"，只会因页面任意 DOM 变化误触发整表重建，打断用户选中复制。
      //    将来要支持抖音/快手/小红书的同类跟随，应在 InstagramModalWatcher 上抽通用基类 +
      //    每平台一份配置（hosts / 容器选择器 / 内容 ID 来源），而不是在这里放开全站。
      // v2.8.0：把「读配置」提前到信息流按钮之前 —— 下面几处逐帖按钮要先知道自己的开关状态。
      // refreshConfig 里还会按 showButton 同步一次按钮显隐；提前只影响「更早拿到配置」，
      // IG 的入口显隐同步（_syncInstagramEntryVisibility）仍在后面，顺序不变。
      await this.refreshConfig();

      if (/(^|\.)instagram\.com$/i.test(location.hostname)) {
        this._initModalWatcher();
        // v2.7.35：IG 首页信息流「每条帖子一个小按钮」（用户 2026-11-01 拍板）。
        // 只认首页 `/`，别处 start() 内部自己判定后直接返回，等于什么都没做。
        // 放在 Modal 监听之后：弹层里的帖子继续由上面那套负责，两者互不干涉
        // （本组件扫描时会把处在 `div[role="dialog"]` 里的 article 跳过）。
        if (this._featureOn('igFeedButtons') && typeof this._initInstagramFeedButtons === 'function') {
          try {
            this._initInstagramFeedButtons();
          } catch (e) {
            ClipMateLog.debug('[Instagram] 首页逐帖按钮挂载失败（不影响其他功能）: ' + (e && e.message));
          }
        }
      }
      // v2.7.39：微博「页面上每一条博文一颗小按钮」（用户 2026-11-01 拍板）。
      // 覆盖三套页面：weibo.com（article）/ s.weibo.com 搜索页（.card-wrap）/
      // m.weibo.cn 手机版（.card9，编号靠主世界桥 weibo-mobile-bridge.js 写在属性上）。
      // 「哪套页面、哪一条、按钮放哪儿」全在组件内部判定；页面只读出 1 条博文（详情页）时
      // 会自动全摘 —— 那是全局按钮的活，挂上来只会重复。
      if (/(^|\.)weibo\.com$/i.test(location.hostname) || location.hostname === 'm.weibo.cn') {
        if (this._featureOn('weiboFeedButtons') && typeof this._initWeiboFeedButtons === 'function') {
          try {
            this._initWeiboFeedButtons();
          } catch (e) {
            ClipMateLog.debug('[微博] 逐帖按钮挂载失败（不影响其他功能）: ' + (e && e.message));
          }
        }
      }
      // v2.7.43：X（推特）「页面上每一条推文一颗小按钮」（用户 2026-11-01 拍板）。
      // 覆盖首页 / 个人主页 / 搜索页 / 详情页的回复列表；详情页**主贴不挂**
      // （它已经有全局按钮了），单条详情视图（只读出 1 条）会全摘。
      // 长推文在列表页按页面截断的原文取（用户选 A：不主动展开页面）。
      if (/(^|\.)x\.com$/i.test(location.hostname)) {
        if (this._featureOn('xFeedButtons') && typeof this._initXFeedButtons === 'function') {
          try {
            this._initXFeedButtons();
          } catch (e) {
            ClipMateLog.debug('[X] 逐帖按钮挂载失败（不影响其他功能）: ' + (e && e.message));
          }
        }
      }
      // 配置已在上面（信息流按钮之前）读过一次，这里不再重复读：
      // 重复读只会白跑一次 storage，还会把 features 覆盖成同一份值。

      // v2.7.4：按入口同步一次按钮显隐 —— Instagram 的列表页（作者主页 `/<user>/`、
      // 用户 reels 列表 `/<user>/reels/`、探索页 `/explore/`、首页 feed `/`）没有单条作品可提，
      // 真机实测点下去会把**页脚文字**当成文案提出来（`/vladaneslava/reels/` → 「Meta 旗下其他产品」）。
      // 这些页面要走正常 init（IG 的 urlPattern 匹配任意路径，列表页的 mediaType 也是 social，
      // 所以**不会**进上面那段 `if (!mediaType)` —— 抖音/小红书的列表页才会进），
      // 因此这里只做一件事：把按钮**藏起来**（绝不是摘掉 —— 摘了 button 就再也造不回来，
      // 小红书 v2.5.101 踩过）。弹层跟随已由上面的 _initModalWatcher() 挂上，
      // 点开帖子时 _onModalPost → _syncInstagramEntryVisibility 会把它再显示出来。
      // 必须放在 refreshConfig **之后**：refreshConfig 里会按配置 setVisible 一次，放前面会被它盖掉。
      // 域名门禁在 InstagramEntryContext 内部（只认 instagram.com），其他站点不做任何事。
      if (typeof this._syncInstagramEntryVisibility === 'function') {
        try {
          this._syncInstagramEntryVisibility();
        } catch (e) {
          ClipMateLog.debug('[Instagram] 入口显隐同步失败（不影响提取）: ' + (e && e.message));
        }
      }

      // v2.10.0：按页面形态决定大按钮显隐 + 档案皮肤，并把地址监听挂上。
      // 放在 IG 入口显隐之后：IG 那套是它自己的机制（弹层跟随），这里对 IG 不做任何事
      // （page-shape 的规则表里没有 instagram），两边不会互相覆盖。
      // 放在自动提取之前：按钮的最终形态（藏在哪、什么皮肤）要在任何提取动作之前就位，
      // 否则自动提取那一瞬间浮窗锚的还是旧状态。
      this._applyPageShape();
      this._startPageShapeWatcher();

      // v2.5.45：按配置延迟自动提取一次（全站点可用，只跑一次，不监听 DOM）
      this._scheduleAutoExtract();

      this.isInitialized = true;
      // v2.5.86：详情页正常出按钮之后，也要把「站内跳转」监听挂上 ——
      // 否则从详情页点回网格页时按钮不会撤、浮窗也不会关。
      // 域名门禁在 mixin 内部（只认 www.kuaishou.com），其他站点这一个调用直接返回 false。
      if (typeof this._startKuaishouRouteWatcher === 'function') {
        try { this._startKuaishouRouteWatcher(); } catch (e) { /* 挂不上不影响任何提取 */ }
      }
      // v2.5.94：TikTok 作品页「换条跟随」。作品页本来就有按钮（走的是正常 init 全流程），
      // 这里只补一件事：切到下一条之后，缓存键与一手数据要跟着换（首屏那块数据不更新，
      // 必须靠主世界重扫）。域名门禁在 mixin 内部（只认 tiktok.com），其他站点直接返回 false。
      if (typeof this._startTikTokSpa === 'function') {
        try { this._startTikTokSpa(); } catch (e) { /* 挂不上不影响任何提取 */ }
      }
      // v2.6.0：小红书「进出笔记跟随」。小红书笔记永远是弹层，点开/关闭只换地址不换文档，
      // 搜索页/主页点开笔记也走这条路 —— 不盯地址就会出现「有按钮但不是这页的东西」或「压根没按钮」。
      // 域名门禁在 mixin 内部（只认 xiaohongshu.com），其他站点这一个调用直接返回 false。
      if (typeof this._startXhsSpa === 'function') {
        try { this._startXhsSpa(); } catch (e) { /* 挂不上不影响任何提取 */ }
      }
      // v2.12.2：抖音作者主页的「只换装」监听。
      //
      // 主页 `/user/<sec_uid>` 会被识别成 person → 走正常 init，**不会**进
      // `if (!mediaType)` 那条分支，所以完整弹窗监听（_startDouyinModalWatcher）
      // 在主页上永远不挂。结果是：主页上点开一条作品，按钮仍顶着「整理档案」的
      // 金黄边皮肤，点下去提的却是这一条 —— 用户 2026-11-05 报的「样式切换有问题」。
      // 这里补一个只管皮肤的轻监听：弹层开→普通蓝，关→档案装。
      // 门禁全在 mixin 内部（只认 www.douyin.com + 当前形态 person），其他站直接返回 false。
      if (typeof this._startDouyinPersonSkinWatcher === 'function') {
        try { this._startDouyinPersonSkinWatcher(); } catch (e) { /* 挂不上不影响任何提取 */ }
      }
      ClipMateLog.debug(`初始化耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      ClipMateLog.debug('===== 媒体提取器初始化完成 =====');
      
    } catch (error) {
      console.error('媒体提取器初始化失败:', error, {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
    }
  }

  async initComponents() {
    const startTime = performance.now();
    
    try {
      // 初始化媒体类型检测器
      this.detector = new MediaTypeDetector();
      
      // 初始化UI管理器
      this.buttonManager = new ButtonManager();
      
      // 等待ModalManager加载完成
      await new Promise(resolve => {
        let checkCount = 0;
        const maxChecks = 100; // 最多检查100次，5秒
        
        const checkInterval = setInterval(() => {
          checkCount++;
          
          if (window.ModalManager) {
            clearInterval(checkInterval);
            resolve();
          } else if (checkCount >= maxChecks) {
            clearInterval(checkInterval);
            console.warn(`   ModalManager加载超时 (尝试${checkCount}次)，使用默认实现`);
            // 创建基本的ModalManager备用实现
            if (!window.ModalManager) {
              window.ModalManager = class BasicModalManager {
                async open(data) {
                  // 兜底实现：弹窗组件没加载出来时不打断页面（原先用 alert 会卡住整个页面），
                  // 改为统一提示 + 控制台留全量数据，用户随时可查。
                  try {
                    if (typeof ClipMateLog !== 'undefined') {
                      ClipMateLog.error('[ClipMate] 提取完成，但弹窗组件未加载，数据如下：', data);
                    } else if (typeof console !== 'undefined' && console.error) {
                      console.error('[ClipMate] 提取完成，但弹窗组件未加载，数据如下：', data);
                    }
                    if (window.ClipMateNotice && typeof window.ClipMateNotice.show === 'function') {
                      window.ClipMateNotice.show('信息已提取，但弹窗组件未加载，请按 F12 在控制台查看数据', 'error');
                    }
                  } catch (e) {
                    // 静默：兜底路径本身不许再抛错
                  }
                }
              };
            }
            resolve();
          }
        }, 50);
      });
      
      this.modalManager = new ModalManager();

      // v2.9.7：浮窗与按钮联动 —— 把按钮的拖动事件接给浮窗管理器
      if (this.buttonManager && typeof this.modalManager.attachButton === 'function') {
        this.modalManager.attachButton(this.buttonManager);
      }

      // 初始化书名处理器
      this.titleProcessor = new TitleProcessor();
      
      // 初始化提取器工厂
      this.extractorFactory = new ExtractorFactory();
      
      ClipMateLog.debug(`组件初始化耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('组件初始化失败', error, {
        errorType: error.constructor.name,
        errorMessage: error.message
      });
      throw error;
    }
  }

  detectMediaType() {
    const startTime = performance.now();
    
    try {
      // 检查detector是否初始化
      if (!this.detector) {
        return null;
      }
      
      const url = window.location.href;
      
      // 临时检查：如果是起点中文网，直接返回book类型以测试
      const hostname = window.location.hostname;
      if (hostname.includes('qidian.com') && window.location.pathname.includes('/book/')) {
        // 为了测试，直接返回book类型
        return 'book';
      }
      
      const mediaType = this.detector.detect(url, document);
      safeLog('⏱️ [MediaExtractor] 媒体类型检测耗时: ' + (performance.now() - startTime).toFixed(2) + 'ms');
      
      // 额外日志：检查是否是起点页面但没有返回book类型
      if (hostname.includes('qidian.com') && mediaType !== 'book') {
        // 尝试直接创建提取器测试
        if (window.ExtractorFactory) {
          try {
            const factory = new window.ExtractorFactory();
            const extractor = factory.getExtractor('www.qidian.com', 'book');
          } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
        }
      }
      
      // v2.5.77 批 3：抖音弹窗态补认 social。
      // 精选/搜索/用户主页的路径不在 media-detector 的 patterns 里（那边按设计返回 null，
      // 免得页面一加载就冒出按钮），但弹层里确实有作品可提。
      // 这道补认**只在弹窗接管之后**生效（_douyinModalOverrideType 内部有 _douyinActivated 判断），
      // init 阶段故意返回 null，好让 init 走「挂监听」那条分支。其他站点返回 null，无影响。
      if (!mediaType && typeof this._douyinModalOverrideType === 'function') {
        const modalType = this._douyinModalOverrideType();
        if (modalType) return modalType;
      }

      // v2.5.82：快手推荐流补认 social（同样只在接管之后生效，init 阶段故意返回 null）
      //
      // v2.7.17：`mediaType === 'person'` 时也允许 —— 快手个人主页上点开一条作品是
      // **盖一层播放弹层、地址不变**（仍是 `/profile/<id>`），URL 规则只能判出 person。
      // 弹层打开时这里把类型切成 social（弹层优先提作品，用户 2026-10-31 拍板）；
      // 弹层关掉后 ctx.isOpen() 变 false，这里返回 null，自然落回 person。
      // 前提是 init 里给主页也挂上了弹层监听（见 init 中 `mediaType === 'person'` 那段）。
      if ((!mediaType || mediaType === 'person') && typeof this._kuaishouOverrideType === 'function') {
        const ksType = this._kuaishouOverrideType();
        if (ksType) return ksType;
      }

      return mediaType;
    } catch (error) {
      // 安全地记录错误，避免直接输出错误对象
      return null;
    }
  }
  
  // 初始化通用字段映射器
  async initFieldMapper(mediaType) {
    const startTime = performance.now();
    
    try {
      // 创建通用字段映射器
      const fieldMapper = new UniversalFieldMapper(mediaType);
      
      // 过滤关键词功能已移除，不再需要获取配置
      
      ClipMateLog.debug(`字段映射器初始化耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      return fieldMapper;
    } catch (error) {
      console.error('字段映射器初始化失败', error, {
        mediaType: mediaType,
        errorType: error.constructor.name,
        errorMessage: error.message
      });
      throw error;
    }
  }
  



  initUI() {
    const startTime = performance.now();
    
    try {
      // 设置按钮点击事件
      this.buttonManager.setClickHandler(() => this.handleExtract());
      
      ClipMateLog.debug(`UI初始化耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('UI初始化失败', error, {
        errorType: error.constructor.name,
        errorMessage: error.message
      });
    }
  }

  /**
   * 启动 Instagram Modal 监听器（仅 IG 页面生效，实时捕获 Modal 内帖子）
   * 监听三事件：onModalOpen / onActivePostChange / onModalClose
   */

  /**
   * Modal 打开或内部帖子变化时的统一处理：
   * 更新作用域上下文与缓存键，并按 autoExtract 自动提取（实时感知换帖）
   */

  /**
   * Modal 内帖子切换时，重新提取并就地更新已打开的面板（不重建窗口）
   * 带重试机制：异步加载的 Reel 正文（XHR 后填充）可能在首次提取时还没就位，
   * 隔 500ms 重试，最多 4 次（总等待 ~1.5s），让 React 把异步内容填进 DOM 再读。
   */

  /**
   * 判断提取的数据是否有效。
   * 要求「本页文案」和「发布日期」均非空且非个人资料统计文本（位粉丝/篇帖子 等），
   * 防止异步正文未渲染到 DOM 时把页面骨架数据误当作成功提取。
   */

  /**
   * Modal 关闭：清空作用域，缓存键还原为当前页
   */

  /**
   * 非 Modal 页面间的 SPA 切换（Reels、Stories Highlights 等整页导航）。
   * URL 变了但无 dialog → 直接以当前页 document 为新作用域，就地刷新已打开的面板。
   * 带 debounce：避免快速切换时频繁触发；也等 IG 完成 DOM/og:description 更新。
   */


  /**
   * 从当前 URL 提取帖子 shortcode（覆盖 /p/、/reel(s)、/tv、/stories/）
   */

  /**
   * 从 WBR.storage.local 读取配置，算出「当前这个站」真正生效的四个开关。
   *
   * v2.5.46：加了站点级覆盖。优先级 = 本站规则 > 上层域名规则 > 全局默认，
   * 具体规则在 src/shared/site-config.js 的 resolve()（后缀匹配 + 最长优先）。
   * 所以这里不能再直接读 config.autoCopy，必须过一遍 resolve。
   */
  async refreshConfig() {
    try {
      if (typeof chrome !== 'undefined' && WBR.storage && WBR.storage.local) {
        // v2.8.0：一次把 config 与几个旧独立键（douyinModalEnabled 等）读全，
        // 后者是站点专属功能收编前的存储位置，见 src/shared/feature-flags.js 的说明。
        const flags = window.ClipMateFeatures;
        const legacy = (flags && typeof flags.legacyKeys === 'function') ? flags.legacyKeys() : [];
        const result = await WBR.storage.local.get(['config'].concat(legacy));
        const config = (result && result.config) || {};
        const lim = (config.settings && config.settings.descLimits) || {};

        const resolver = (typeof window !== 'undefined') ? window.ClipMateSites : null;
        const eff = (resolver && typeof resolver.resolve === 'function')
          ? resolver.resolve(config, location.hostname)
          : config; // 兜底：site-config.js 没加载时退回旧的全局行为

        this.autoExtract = !!eff.autoExtract;
        this.autoExtractDelay = Math.max(0, parseInt(eff.autoExtractDelay, 10) || 0);
        this.autoCopy = !!eff.autoCopy;
        // v2.5.66：自动复制的格式。resolver 缺失 / 值非法都回退 markdown
        this.autoCopyFormat = (resolver && typeof resolver.normalizeCopyFormat === 'function')
          ? resolver.normalizeCopyFormat(eff.autoCopyFormat)
          : 'markdown';

        // v2.12.11：空白字段四档。解析走 site-config（全局打底 + 站点覆盖），
        // 结果挂进共享模块，渲染 / 复制只读这一份，不各自再解析配置。
        // 页面根元素上另写两个属性：既是真机探针（旧代码根本没有这两个属性，
        // 自动重载后出现即证明新代码真的被页面读到），也是排查时的可见状态。
        const he = (resolver && typeof resolver.resolveHideEmpty === 'function')
          ? resolver.resolveHideEmpty(config, location.hostname)
          : { mode: 'off', display: false, copy: false };
        this.hideEmptyPolicy = he;
        if (resolver && typeof resolver.setHideEmptyPolicy === 'function') {
          resolver.setHideEmptyPolicy(he);
        }
        try {
          const rootEl = document.documentElement;
          if (rootEl) {
            rootEl.setAttribute('data-clipmate-hide-empty', he.mode);
            rootEl.setAttribute('data-clipmate-hide-empty-combo',
              (he.display ? '1' : '0') + (he.copy ? '1' : '0'));
          }
        } catch (e) { /* 页面根元素不可写时不许影响提取 */ }

        // 浮窗正开着且不在编辑模式 → 就地重绘，设置页改完立刻看到效果。
        // 编辑模式跳过：重建 DOM 会把正在输入的那格冲掉。
        if (this.modalManager && this.modalManager.isOpen && !this.modalManager.isEditMode &&
            typeof this.modalManager.updateTable === 'function') {
          try { this.modalManager.updateTable(true); } catch (e) { /* 重绘失败不影响提取 */ }
        }

        // v2.8.0：本站点专属功能的开关（默认全开；没设过时按开处理，行为与升级前一致）
        this.features = (flags && typeof flags.resolveAll === 'function')
          ? flags.resolveAll(location.hostname, result || {})
          : {};

        // v2.11.7：豆瓣收藏列表「逐条小按钮」的落点（A 封面右下角 / B 封面下方 / C 条目最右）。
        // 全局项，不走站点覆盖；脏值一律回 A —— 读不到配置绝不能把按钮弄没。
        // 已经挂好的按钮当场换位（设置页改完立刻生效，不用刷新页面）。
        const layoutRaw = config.settings && config.settings.doubanListBtnLayout;
        this.doubanListBtnLayout = (typeof window.DoubanListButtons !== 'undefined' &&
          window.DoubanListButtons && typeof window.DoubanListButtons.normalizeLayout === 'function')
          ? window.DoubanListButtons.normalizeLayout(layoutRaw)
          : (layoutRaw === 'B' || layoutRaw === 'C' ? layoutRaw : 'A');
        if (this.doubanListButtons && typeof this.doubanListButtons.setLayout === 'function') {
          try {
            this.doubanListButtons.setLayout(this.doubanListBtnLayout);
          } catch (e) { /* 换落点失败不影响提取 */ }
        }

        // v2.8.0：缓存开关一并从 config 读，只在「与当前状态不同」时才应用
        //（setCacheEnabled(false) 会清本地缓存，重复调用没必要）
        const cacheOn = !(config.settings && config.settings.enableCache === false);
        if (cacheOn !== this.cacheEnabled) this.setCacheEnabled(cacheOn);

        // 按钮显隐：默认显示（沿用原行为），只有明确设为 false 才隐藏
        // v2.10.0：这里只**记下**配置意愿，真正的显隐交给 _applyPageShape 决定 ——
        // 页面形态（信息流页要藏）与用户设置（showButton 关掉）必须一起算，
        // 否则两边各写一次，后跑的那一个会把另一个覆盖掉。
        this._showButtonByConfig = eff.showButton !== false;
        this._applyPageShape();

        // v2.9.4：浮窗自动收起开关。v2.9.6 起按**站点**生效：
        // 社交站默认开、其余站默认关，站点级可覆盖 —— 一律走 eff（resolve 已经算好），
        // 不再直接读 config.settings.autoDismiss（那个只剩「老配置全关」的迁移用途）。
        // v2.11.4：判定抽到 `_applyAutoDismiss`，豆瓣收藏列表页走不到这里也能复用同一份。
        this._applyAutoDismiss(eff);

        // v2.9.7：浮窗尺寸约束（全局项，不走站点覆盖，直接读 config.settings）。
        // 宽度 = 每次弹出浮窗的固定宽度；maxHeight = 高度自适应的上限。
        // 读不到 / 脏值回落默认（与 background defaultConfig、settings-schema 一致）。
        if (this.modalManager && typeof this.modalManager.setUiConstraints === 'function') {
          this.modalManager.setUiConstraints({
            width: numOr(config.settings && config.settings.floatingWindowWidth, 320),
            maxHeight: numOr(config.settings && config.settings.floatingWindowMaxHeight, 800)
          });
        }

        // v2.8.2：简介长度上限（社交 / 影人 / 其他）。
        // 挂在原型上而不是实例上 —— 提取器是由 ExtractorFactory 按站点造出来的，
        // 每个站一个实例，逐实例去设会漏；而 processCommonFields 是共享 mixin，
        // `this` 就是那些站点实例，走原型链取到的就是这一份。
        // 读不到 / 脏值一律回落到搬进设置页之前的硬编码值，保证升级前后输出逐字节一致。
        MediaExtractor.prototype.descLimits = {
          social: numOr(lim.social, 50000),
          person: numOr(lim.person, 5000),
          other: numOr(lim.other, 500)
        };

      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
  }

  /* ================= v2.10.0：页面形态（大按钮该不该出现） ================= */

  /**
   * 按「页面形态」决定大提取按钮的显隐与皮肤。
   *
   * 四种形态（判定表在 `utils/page-shape.js`，用户 2026-11-04 拍板只做三站）：
   *   person  —— 作者主页 / 影人页：显示，换「档案皮肤」（深蓝底 + 金黄边 + 整理档案 + 新图标）
   *   detail  —— 单条内容详情页：显示，普通皮肤
   *   feed    —— 首页 / 热门 / 搜索等信息流：藏起来。**只是隐藏，不销毁** ——
   *              销毁了按钮位置就丢了，用户退回详情页还得重新摆一次
   *   unknown —— 没配规则的站点（抖音/快手/B站/YouTube/小红书…）：照旧显示，什么都不变
   *
   * 幂等，可以随时重复调用（init、地址变化、存储变化都会走到这里）。
   * @returns {'person'|'detail'|'feed'|'unknown'}
   */
  _applyPageShape() {
    const bm = this.buttonManager;

    let shape = 'unknown';
    try {
      if (typeof PageShape !== 'undefined' && PageShape && typeof PageShape.shapeOf === 'function') {
        shape = PageShape.shapeOf({
          hostname: location.hostname,
          pathname: location.pathname,
          mediaType: this.detectMediaType()
        });
      }
    } catch (e) { shape = 'unknown'; }

    // v2.11.4：形态先记下来，**再**判断有没有大按钮。
    // 豆瓣收藏列表页本来就没有大按钮（/people/* 不匹配任何提取器），
    // 但它的形态照样得算 —— 「浮窗滚动自动关」就是按 feed 形态开的。
    // 以前这里 `!bm.button` 直接 return 'unknown'，会让 feed 永远判不出来。
    this._pageShape = shape;

    if (!bm || !bm.button) return shape;

    // 皮肤：只有档案页换；离开档案页必须能褪回普通蓝，
    // 否则用户从作者主页点进一条博文后，会看到一个「整理档案」按钮去提单条内容。
    try {
      if (typeof bm.setSkin === 'function') bm.setSkin(shape === 'person' ? 'arch' : 'default');
    } catch (e) { /* 换肤失败不影响提取 */ }

    // 显隐，三种情况分开处理 —— 这里最容易踩「谁也不管/谁都管」的坑：
    //   · 用户自己在设置里关了按钮 → 任何站都藏（用户设置最高）
    //   · 信息流页（feed）→ 藏
    //   · 详情页 / 档案页 → 显示
    //   · unknown（没配规则的站）→ **一个字节都不碰**。
    //     这些站的显隐另有主人：IG 有 `_syncInstagramEntryVisibility`（列表页藏、
    //     弹层开时显示），抖音 / 快手有弹层接管。这里要是顺手 setVisible(true)，
    //     就把它们刚藏好的按钮又翻出来了 —— 实测会让 IG 列表页重新冒出大按钮。
    try {
      if (this._showButtonByConfig === false) {
        bm.setVisible(false);
      } else if (shape === 'feed') {
        bm.setVisible(false);
      } else if (shape !== 'unknown') {
        bm.setVisible(true);
      }
    } catch (e) { /* 显隐失败不影响提取 */ }

    return shape;
  }

  /**
   * 算并应用「浮窗自动收起」的生效值（v2.11.4）。
   *
   * 抽成独立方法的原因：有两条路会走到它，而且互相走不到对方那里 ——
   *   ① `refreshConfig()`：正常页面（有 mediaType）；
   *   ② 豆瓣收藏列表页：在 `if (!mediaType)` 分支里，那里在 refreshConfig 之前就 return 了。
   * 两处各写一遍判定迟早会漂移，所以只留这一份。
   *
   * 判定顺序（用户意愿 > 页面形态 > 站点组默认）：
   *   · 用户显式设过（站点覆盖 / 老配置全局关）→ 完全听它，形态不得覆盖
   *   · 否则：社交站默认开 ∪ feed 形态开
   *
   * @param {Object|null} eff `site-config.resolve()` 的结果；传 null 表示「配置还没读过」，
   *        此时只有 feed 形态能开启，不会凭空给任意站点打开。
   */
  _applyAutoDismiss(eff) {
    if (typeof ClipMateBrowseDismiss === 'undefined' || !ClipMateBrowseDismiss.setEnabled) return;
    const e = eff || {};
    const feedShape = this._pageShape === 'feed';

    const autoDismissOn = e.autoDismissExplicit
      ? (e.autoDismiss !== false)
      : (e.autoDismiss === true || feedShape);

    // feed 形态放宽开窗宽限期：浮窗是「抓完详情页才弹」的，350ms 盖不住惯性滚动。
    // 只放宽时间，位移阈值仍是 200px —— 与微博首页完全一致。
    if (typeof ClipMateBrowseDismiss.setGlide === 'function') {
      ClipMateBrowseDismiss.setGlide(feedShape ? ClipMateBrowseDismiss.GLIDE_MS_FEED : 350);
    }
    ClipMateBrowseDismiss.setEnabled(autoDismissOn);
  }

  /**
   * 盯地址变化（只在本次纳入的几站启用，其他站点一个定时器都不多）。
   *
   * 为什么必须盯：微博 / X / IG 点开一条内容都是**站内跳转、不刷新文档**，
   * 而 init() 只在文档加载时跑一次。不盯的话，从首页点进详情页后按钮永远不出现，
   * 反过来从详情页退回首页按钮也不会撤。
   *
   * 三重保险（任一失效还有下一个兜着）：
   *   ① 包一层 history.pushState / replaceState —— 站内跳转走它
   *   ② popstate —— 浏览器前进 / 后退
   *   ③ 250ms 轮询最后 URL —— 个别站点自己改写 history，包装会被绕过
   */
  _startPageShapeWatcher() {
    if (this._pageShapeWatcher) return;
    if (typeof PageShape === 'undefined' || !PageShape || typeof PageShape.watches !== 'function') return;
    if (!PageShape.watches(location.hostname)) return;

    const onUrlChange = () => {
      try {
        if (location.href === this._lastShapeHref) return;
        this._lastShapeHref = location.href;
        this._applyPageShape();
      } catch (e) { /* 地址读不到就算了，下一拍再来 */ }
    };
    this._lastShapeHref = location.href;

    try {
      const wrap = (name) => {
        const orig = history[name];
        if (typeof orig !== 'function' || orig.__cmShapeWrapped) return;
        const wrapped = function () {
          const ret = orig.apply(this, arguments);
          try { onUrlChange(); } catch (e) { /* 忽略 */ }
          return ret;
        };
        wrapped.__cmShapeWrapped = true;
        history[name] = wrapped;
      };
      wrap('pushState');
      wrap('replaceState');
    } catch (e) { /* 包装失败靠下面两路兜底 */ }

    try { window.addEventListener('popstate', onUrlChange); } catch (e) { /* 忽略 */ }

    const timer = setInterval(onUrlChange, 250);
    this._pageShapeWatcher = { timer: timer, onUrlChange: onUrlChange };
  }

  /** v2.8.0：某个站点专属功能是否开着（读不到就当开着，绝不因配置缺失砍掉功能） */
  _featureOn(key) {
    if (!this.features || !Object.prototype.hasOwnProperty.call(this.features, key)) return true;
    return this.features[key] !== false;
  }

  /**
   * v2.8.0：监听存储变化，让设置改完立刻生效。
   *
   * 为什么需要：以前只有 popup 保存后会 sendMessage 通知**当前活动标签**，
   * 在设置页改站点设置时，其他已打开的标签根本收不到，得刷新才生效。
   * 现在改成监听 storage.onChanged —— 不管从哪个入口改、有几个标签开着，全都能收到。
   *
   * 只关心两类变化：config（本站生效值）与几个旧独立键（douyinModalEnabled 等）。
   * 自己写存储不会触发（storage.onChanged 只在别的上下文写入时通知本上下文，
   * 同源的 saveConfig 由 background 发出，内容脚本这边照常收到）。
   */
  _bindConfigWatcher() {
    if (this._configWatcherBound) return;
    this._configWatcherBound = true;
    try {
      if (!WBR.storage || !WBR.storage.onChanged || !WBR.storage.onChanged.addListener) return;
      WBR.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes) return;
        const keys = Object.keys(changes);
        const hit = keys.indexOf('config') !== -1 ||
          keys.some((k) => /Enabled$/.test(k));
        if (!hit) return;
        Promise.resolve(this._onConfigChanged()).catch((e) => {
          ClipMateLog.debug('[ClipMate] 配置变更后刷新失败（不影响提取）: ' + (e && e.message));
        });
      });
    } catch (e) {
      // 监听不上就退回老行为：popup 那边仍会发 updateCacheConfig
    }
  }

  async _onConfigChanged() {
    await this.refreshConfig();
    this._applyFeatureState();
  }

  /**
   * 把「站点专属功能」的开关落到已挂好的组件上。
   * 三个逐帖按钮组件都有幂等的 start()（内部自己判 _observer）与 stop()，
   * 所以关掉就 stop、打开就 start，不用重建页面。
   */
  _applyFeatureState() {
    const pairs = [
      ['igFeedButtons', this.feedButtons],
      ['weiboFeedButtons', this.weiboFeedButtons],
      ['xFeedButtons', this.xFeedButtons]
    ];
    pairs.forEach(([key, inst]) => {
      if (!inst) return;
      try {
        if (this._featureOn(key)) {
          if (typeof inst.start === 'function') inst.start();
          if (typeof inst.sync === 'function') inst.sync();
        } else if (typeof inst.stop === 'function') {
          inst.stop();
        }
      } catch (e) {
        ClipMateLog.debug('[ClipMate] 功能开关切换失败（' + key + '）: ' + (e && e.message));
      }
    });
  }

  /**
   * 打开页面后按配置的延迟自动提取一次（v2.5.45 从「仅 Instagram」放开到全站点）。
   *
   * 关键设计：只跑一次、不监听 DOM 变化。
   * 因此它不会像旧版 IG 专属监听那样，在页面任意变动时触发整表重建、打断用户选中文字。
   * 「切换内容时自动跟随」仍是 Instagram 专属能力，不在这个方法里。
   */
  _scheduleAutoExtract() {
    if (!this.autoExtract) return;
    if (this._autoExtractTimer) {
      clearTimeout(this._autoExtractTimer);
      this._autoExtractTimer = null;
    }
    const delayMs = Math.max(0, this.autoExtractDelay || 0) * 1000;
    this._autoExtractTimer = setTimeout(() => {
      this._autoExtractTimer = null;
      if (!this.autoExtract) return;
      // 浮窗已经开着就不重复提取，避免把用户正在看的内容刷掉
      if (this.modalManager && this.modalManager.isOpen) return;
      // v2.9.2：带 auto 标记 —— 自动提取不弹「正在读取页面」的提示条，
      // 用户没点任何东西，页面一打开就冒条子会像报错。
      Promise.resolve(this.handleExtract({ auto: true })).catch((e) => safeLog('[自动提取] 失败: ' + e.message));
    }, delayMs);
  }

  /**
   * v2.6.0：当前页还接不接受弹窗？返回 true 表示**别弹**。
   *
   * 各站点的 mixin 各提供一个**带站点前缀**的实现（`_tiktokShouldSuppressModal` /
   * `_xhsShouldSuppressModal`），这里统一问一圈，任何一个说「别弹」就不弹。
   *
   * 为什么不让 mixin 直接叫 `_shouldSuppressModal`：所有 mixin 都 Object.assign 到
   * 同一个 `MediaExtractor.prototype` 上，同名会**互相覆盖** —— 后 assign 的把前一个顶掉，
   * 表现是「某个站点的路由判定突然失效」且不报错，极难查。v2.5.101 加 TikTok 那份时
   * 就踩过「共享原型」的坑，这次直接按前缀隔离。
   *
   * 每个实现内部都自带域名门禁（不是自己的域名返回 false），所以全问一遍没有副作用。
   */
  _shouldSuppressModal() {
    const checks = ['_tiktokShouldSuppressModal', '_xhsShouldSuppressModal'];
    for (const name of checks) {
      try {
        if (typeof this[name] === 'function' && this[name]()) return true;
      } catch (e) { /* 单个站点判定抛错不影响其他站点 */ }
    }
    return false;
  }

  /**
   * 执行一次提取并弹窗。
   *
   * @param {Object} [opts] - 可选。目前只有一个键：
   *        `feedPost: true` 表示「IG 首页逐帖提取」（v2.7.35）——
   *        `context` / `shortcode` 由调用方（`ig-spa-handler`）先写好再调进来，
   *        这里只负责把标记透传给提取器，让它走首页专用的取值分支。
   * @returns {Promise<boolean>} 真的弹出了浮窗返回 true；被跳过/失败返回 false。
   *          （v2.7.35 起返回结果，供逐帖按钮判断该闪绿还是闪红。旧调用方都没用到返回值。）
   */
  async handleExtract(opts = {}) {
    const startTime = performance.now();
    ClipMateLog.debug('===== 开始提取数据 =====');

    // v2.10.0：逐帖小按钮点了哪一颗 → 浮窗就贴哪一颗下方。
    // 信息流页（微博首页 / 热门 / 搜索、X 首页）按新规则不出大按钮，
    // 浮窗没有大按钮可贴；不告诉它「用户点的是这一条」，窗就会弹到屏幕右上角，
    // 离刚点的内容很远。只在显式传了锚点时才设，详情页走原有逻辑（贴大按钮）。
    // 两种键名都收：逐帖按钮那层传的是 `anchor`，各站 spa-handler 传的是 `anchorEl`。
    // （v2.10.0 真机验收发现只认后者时锚点永远为空 —— 浮窗退回右上角，白做一版）
    const anchorElForWindow = (opts && (opts.anchorEl || opts.anchor)) || null;
    if (anchorElForWindow && this.modalManager &&
        typeof this.modalManager.setAnchorElement === 'function') {
      try {
        this.modalManager.setAnchorElement(anchorElForWindow);
      } catch (e) { /* 锚不上就退回默认位置，不影响提取 */ }
    }

    // v2.5.99：每次提取前重算缓存键。
    // 原来只在 init 里算一次，之后再不更新。页面内跳转（SPA 从一个作品切到另一个、
    // 或者 TikTok 推荐流滚轮换条）时地址变了、键却没变，第二次点提取会直接命中
    // 上一次的结果 —— 浮窗里显示的仍是上一条的作者。实测：换到 `_.janisz_` 之后
    // 连点三次，三次都返回到最早那条 `ClausMagic`。
    this.cacheKey = this.generateCacheKey(window.location.href, this.activeShortcode) + this._contentSalt();

    if (!this.isInitialized) {
      console.error('提取器未初始化，无法执行提取操作');
      this.buttonManager.showError('提取器未初始化');
      return false;
    }

    try {
      // 显示加载状态（v2.9.2：自动提取只改按钮，不弹陪伴提示条）
      this.buttonManager.setLoading(true, { quiet: !!(opts && opts.auto) });

      // 检查缓存中是否有可用的提取结果
      let extractedData;
      if (this.cacheEnabled && this.cache.has(this.cacheKey)) {
        extractedData = this.cache.get(this.cacheKey);
        // v2.5.48：命中后移到队尾，实现真正的 LRU（Map 按插入顺序迭代）
        this.cache.delete(this.cacheKey);
        this.cache.set(this.cacheKey, extractedData);
        ClipMateLog.debug('从缓存中获取提取结果，数据字段数:', Object.keys(extractedData).length);
      } else {
        // 执行提取流程
        // v2.7.35：第二个参数只在「IG 首页逐帖提取」时非空，透传给提取器；
        // 其他调用方不传，行为与之前逐字相同。
        extractedData = await this.extractFromCurrentPage(this.activeContext, opts);
        ClipMateLog.debug('提取成功，数据字段数:', Object.keys(extractedData).length);
      }
      
      // 清理提取的数据 - 内容模式（过滤空值）
      const cleanedData = this.fieldMapper.cleanFields(extractedData, false);
      
      // 调用processCommonFields处理通用字段
      this.processCommonFields(cleanedData);
      
      // 为表头准备完整字段数据 - 表头模式（保留所有字段）
      const fullFieldsData = this.fieldMapper.cleanFields(extractedData, true);
      
      // 合并完整字段名和处理后的数据，确保所有表头字段都包含在内
      const combinedData = { ...fullFieldsData, ...cleanedData };
      
      // v2.5.101：弹窗前再确认一次「这一页现在还接不接受弹窗」。
      // 提取是异步的，等待期间用户可能已经离开（TikTok 探索页点开作品 → 点提取 → 关掉作品回列表）。
      // 不问一句直接 open()，列表页上会凭空冒出一个浮窗，看着像卡住了。
      // 约定：平台 mixin 提供 `_shouldSuppressModal()`，返回 true 表示别弹；
      // 没实现的站点这里 typeof 判断直接跳过，对别的网站零影响。
      let suppressModal = false;
      try {
        if (typeof this._shouldSuppressModal === 'function') {
          suppressModal = !!this._shouldSuppressModal();
        }
      } catch (e) {
        suppressModal = false;   // 判定抛错就当可以弹，别把数据吞了
      }
      if (suppressModal) {
        ClipMateLog.debug('页面已不是可提取页，本次结果不弹窗');
        this.buttonManager.setLoading(false);
        return false;
      }

      // v2.12.9：用「本次提取实际用的字段模板」校准入口（person 6 列 / social 7 列）。
      // 换肤是主信号，这里兜底：快手弹层地址不变、抖音会抹 modal_id，网址判不准；
      // 而 fieldMapper.mediaType 是这次真正拿去建表的那份模板。
      // 万一校准结果与换肤不一致，以字段模板为准，并把按钮位置一起换到目标抽屉。
      try {
        if (typeof ClipMateEntryScope !== 'undefined' && ClipMateEntryScope.confirm) {
          const mapperType = this.fieldMapper && this.fieldMapper.mediaType;
          const tr = ClipMateEntryScope.confirm(mapperType);
          if (tr && tr.changed && this.buttonManager &&
              typeof this.buttonManager._restoreEntryScopePosition === 'function') {
            this.buttonManager._restoreEntryScopePosition();
          }
        }
      } catch (e) { /* 校准失败不许吞掉本次提取 */ }

      // 显示结果
      await this.modalManager.open(combinedData);

      // v2.5.45：按配置自动复制（默认关闭）。只影响"复制"这个动作，不改变提取内容。
      // v2.5.66：按 autoCopyFormat 分派到三种现成实现之一，不在这里新写复制逻辑。
      if (this.autoCopy && this.modalManager) {
        const fmt = this.autoCopyFormat;
        const method = (fmt === 'plaintext') ? 'copyDataAsPlainText'
          : (fmt === 'notion' ? 'copyData' : 'copyDataAsMarkdown');
        if (typeof this.modalManager[method] === 'function') {
          try {
            await this.modalManager[method]();
          } catch (copyError) { ClipMateLog.debug('[ClipMate] 已忽略异常:', copyError && copyError.message); }
        }
      }

      // 完成状态
      this.buttonManager.setLoading(false);
      ClipMateLog.debug(`提取操作总耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      ClipMateLog.debug('===== 提取数据完成 =====');
      return true;
      
    } catch (error) {
      console.error('提取过程失败:', error, {
        errorType: error.constructor.name,
        errorMessage: error.message,
        errorStack: error.stack
      });
      this.buttonManager.setError();
      const report = this._buildFailureReport(error);
      this.buttonManager.showError(report.message, report.options);
      return false;
    }
  }

  /**
   * 组装提取失败的技术报告（v2.5.45 / B6）
   *
   * 用户明确要求「失败提示要技术细节」：只说「提取失败，请刷新页面重试」
   * 等于什么都没说——既不知道错在哪一步，也没法反馈。
   * 这里给出：错误类型 + 原始消息（一句话），以及一份可直接复制的详情
   * （含页面、时间、堆栈前 6 行）。
   */
  _buildFailureReport(error) {
    const name = (error && error.name) ? String(error.name) : 'Error';
    const rawMessage = (error && error.message) ? String(error.message) : String(error || '未知错误');
    // 一句话：错误原文直接摆出来，不再替换成无信息量的套话
    const message = '提取失败：' + rawMessage;

    let page = '';
    try {
      page = location.hostname + location.pathname + location.search;
    } catch (e) { page = '(无法读取当前地址)'; }

    let when = '';
    try {
      when = new Date().toLocaleString('zh-CN', { hour12: false });
    } catch (e) { when = new Date().toISOString(); }

    const stackLines = (error && error.stack)
      ? String(error.stack).split('\n').slice(0, 6).join('\n')
      : '(无堆栈信息)';

    const detail = [
      name + ': ' + rawMessage,
      '页面: ' + page,
      '时间: ' + when,
      '版本: ' + this._getExtensionVersion(),
      '--- 堆栈 ---',
      stackLines
    ].join('\n');

    const copyText = [
      '【采媒灵 提取失败报告】',
      '类型: ' + name,
      '消息: ' + rawMessage,
      '页面: ' + page,
      '时间: ' + when,
      '版本: ' + this._getExtensionVersion(),
      '堆栈:',
      (error && error.stack) ? String(error.stack) : '(无堆栈信息)'
    ].join('\n');

    return { message, options: { detail, copyText } };
  }

  /** 取扩展版本号，供失败报告标注（取不到就写未知，不影响主流程） */
  _getExtensionVersion() {
    try {
      if (typeof WBR !== 'undefined' && WBR.runtime && typeof WBR.runtime.getManifest === 'function') {
        return String(WBR.runtime.getManifest().version || '(未知)');
      }
    } catch (e) { /* 忽略 */ }
    return '(未知)';
  }

  /**
   * 从当前页面提取字段。
   *
   * @param {Element|Document} [context] - 提取作用域（默认 `activeContext`）
   * @param {Object} [extraOpts] - 追加传给 `extractAllFields()` 的选项。
   *        目前只有 IG 首页逐帖提取会传 `{ feedPost: true }`（v2.7.35），
   *        其他调用方不传 —— 不传时构造出的对象与以前逐字相同。
   */
  async extractFromCurrentPage(context = this.activeContext, extraOpts) {
    const startTime = performance.now();
    
    try {
      // 1. 检测媒体类型
      //
      // v2.7.40：`extraOpts.forceMediaType` 用来在**同一页面上换个身份提取**。
      // 唯一的使用者是微博逐帖按钮：微博作者主页 `weibo.com/u/<uid>` 的页面类型是
      // person（人物档案），但页面上那些博文照样要能逐条提取 —— 不强制指定的话，
      // 下面的 URL 匹配会按地址选到人物提取器，点博文按钮弹出来的是空表。
      // 不传这个字段的所有调用方，行为与以前逐字相同。
      const forcedMediaType = (extraOpts && extraOpts.forceMediaType) || '';
      const mediaType = forcedMediaType || this.detectMediaType();
      
      // 2. 获取合适的提取器
      const hostname = window.location.hostname;
      
      let extractor = null;

      // 强制类型优先：直接用「域名 + 指定类型」查表，跳过地址匹配
      if (forcedMediaType) {
        extractor = this.extractorFactory.getExtractor(hostname, forcedMediaType);
      }

      // 首先尝试通过URL模式匹配获取提取器（支持路径级别的区分）
      if (!extractor) {
        extractor = this.extractorFactory.getExtractorByUrl(window.location.href);
      }
      
      // 如果URL模式匹配失败，再使用传统的hostname匹配
      if (!extractor) {
        extractor = this.extractorFactory.getExtractor(hostname, mediaType);
      }
      
      if (!extractor) {
        const errorMsg = `未找到适用于 ${hostname} 的提取器`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }
      
      // 保存当前使用的提取器实例，供modal-manager等组件访问
      this.currentExtractor = extractor;

      // v2.11.4：指定提取源。
      // 唯一的用户是豆瓣收藏列表页：把条目详情页 HTML 抓回来、用 DOMParser 解析成
      // 另一份文档，让同一个提取器去读那一份（不再维护第二套选择器）。
      // 不传 doc 的调用方（其余全部）走当前页面，行为与改造前逐字相同。
      // 用完必须还原：提取器实例会被工厂复用，不还原的话用户之后在详情页点大按钮
      // 会读到列表页那份文档，得到一条「空白记录」。
      const altDoc = (extraOpts && extraOpts.doc) || null;
      const altUrl = (extraOpts && extraOpts.pageUrl) || '';
      const altSourceOn = !!(altDoc && typeof extractor.setSource === 'function');
      if (altSourceOn) extractor.setSource(altDoc, altUrl);
      

      // 3. 提取原始数据
      const rawDataStartTime = performance.now();
      const rawData = await (async () => {
        try {
          return await extractor.extractAllFields(Object.assign({
            context,
            shortcode: this.activeShortcode
          }, extraOpts || {}));
        } finally {
          // 无论成功失败都要还原提取源，否则下一次提取会读错文档
          if (altSourceOn) extractor.setSource(null);
        }
      })();
      ClipMateLog.debug(`原始数据提取完成，耗时: ${(performance.now() - rawDataStartTime).toFixed(2)}ms`);
      
      // 4. 映射到通用字段
      const universalData = this.fieldMapper.mapToUniversalFields(rawData, extractor.siteName);
      ClipMateLog.debug(`通用字段映射完成，映射字段数: ${Object.keys(universalData).length}`);
      
      // 5. 应用智能处理
      const processedData = await this.processData(universalData, mediaType);

      // 6. v2.6.1：社交文案去掉话题井号（`#ABC` → `ABC`，小红书自带 `[话题]` 标记一起去）
      //
      // 为什么放在这个位置（processData 之后、写缓存之前）：
      //   · 提取器只管把页面原文捞出来，各站自己洗容易漏；出口只有这一个，在这儿洗一次全站齐平。
      //   · 放在缓存之前，缓存里存的就是洗干净的结果，命中缓存时不会又端出带 # 的旧文案。
      //   · 清理本身幂等（`SocialHashtagCleaner` 洗两遍结果一样），重复走也不怕。
      // 抛错一律吞掉保留原文案：文案脏一点能用，整张表报错就全废了。
      //
      // v2.7.15：人物档案的「简介」也并进来 —— 用户 2026-10-30 拍板「签名里的 #话题 不豁免」，
      // 抖音作者签名里的话题标签走同一套规则（`stripFields` 只认 `简介` 这个键，
      // 社交站没有该列，所以社交作品页行为不变）。
      if ((mediaType === 'social' || mediaType === 'person') && typeof SocialHashtagCleaner !== 'undefined') {
        try {
          SocialHashtagCleaner.stripFields(processedData);
        } catch (e) {
          ClipMateLog.warn('[文案清理] 话题井号清理失败，保留原文案: ' + (e && e.message));
        }
      }
      
      ClipMateLog.debug(`页面数据提取总耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      
      // 保存提取结果到缓存
      if (this.cacheEnabled) {
        this.cache.set(this.cacheKey, processedData);
        // v2.5.48：超过上限就淘汰最久没被命中的一条
        while (this.cache.size > this.cacheMaxSize) {
          var oldestKey = this.cache.keys().next().value;
          this.cache.delete(oldestKey);
        }
      }
      
      return processedData;
    } catch (error) {
      console.error('页面数据提取失败:', error, {
        errorType: error.constructor.name,
        errorMessage: error.message
      });
      throw error;
    }
  }
  
  /**
   * 缓存键的「内容盐」（v2.5.99）
   *
   * 缓存键默认按地址算。地址不变、内容却换了，就会命中上一次的结果。
   * TikTok 推荐流是典型：滚轮换条时地址一直是 `https://www.tiktok.com/`，
   * 于是点第二次提取会把上一条的数据原样端出来（v2.5.97 起实测复现）。
   *
   * 这类入口必须把「当前这一条」的作品 ID 并进键里。ID 从主世界写在
   * `<script id="clipmate-tiktok-fiber">` 的桥节点上读（隔离世界可以直接读 DOM）。
   *
   * 注意：读的是桥节点的 `urlId`，不是 `data.id` —— 主世界只保证 `urlId`
   * 是「当前屏上这一条」，换条时它第一个更新。
   *
   * 认不出就返回空串：宁可不加盐，也不要因为读不到而误伤正常缓存。
   * @returns {string} 例如 `#fyp-7681609972911705374`
   */
  _contentSalt() {
    try {
      if (typeof window === 'undefined' || !window.location) return '';
      if (!/(^|\.)tiktok\.com$/i.test(window.location.hostname)) return '';
      // 只认推荐流的三条根地址（与 `tiktok-page-data.js` 的 isFypUrl 保持一致）。
      // 作品页 /@user/video/<id>、图集页 /@user/photo/<id>、主页 /@user 的地址
      // 本身就是内容标识，不需要额外加盐。
      if (!/^\/(?:foryou|following|friends)?\/?$/.test(window.location.pathname)) return '';
      const node = document.getElementById('clipmate-tiktok-fiber');
      if (!node || !node.textContent) return '';
      const data = JSON.parse(node.textContent);
      if (!data || data.scope !== 'fyp' || !data.urlId) return '';
      return '#fyp-' + String(data.urlId);
    } catch (error) {
      return '';
    }
  }

  // 生成缓存键
  generateCacheKey(url, shortcode) {
    const urlObj = new URL(url);
    // Modal 内帖子：按 shortcode 维度，避免污染主页缓存键（即使 URL 未变化也能区分不同帖子）
    if (shortcode) return `${urlObj.hostname}/p/${shortcode}`;

    // v2.5.48：原实现只取 hostname + pathname，把查询参数丢了。
    // 后果：YouTube 的 /watch?v=xxx、B站的 /video/BVxxx?p=2、X 的 ?s=20 等
    // 内容全靠查询参数区分，换一条内容仍命中上一条的缓存，表格里还是旧数据。
    // 这里把有意义的参数纳入键，同时剔除纯跟踪/分享参数，
    // 免得同一条内容因为广告参数被拆成好几份缓存。
    var NOISE_KEYS = /^(utm_|fbclid$|gclid$|msclkid$|spm$|scm$|vd_source$|share_source$|share_medium$|share_plat$|share_tag$|timestamp$|unique_k$|from_spmid$|from_source$|from$|referrer$|ref$|source$)/i;
    var pairs = [];
    urlObj.searchParams.forEach(function (value, key) {
      if (NOISE_KEYS.test(key)) return;
      pairs.push(key + '=' + value);
    });
    // 参数顺序不应影响缓存命中
    pairs.sort();

    // 路径末尾多余的斜杠也归一，避免 /watch 与 /watch/ 算两条
    var path = urlObj.pathname.replace(/\/+$/, '') || '/';
    var query = pairs.length ? '?' + pairs.join('&') : '';
    return urlObj.hostname + path + query;
  }
  
  // 清除缓存
  clearCache() {
    this.cache.clear();
  }
  
  // 设置缓存启用状态
  setCacheEnabled(enabled) {
    this.cacheEnabled = enabled;
    
    // 如果禁用缓存，清除现有缓存
    if (!enabled) {
      this.clearCache();
    }
  }

  async processData(data, mediaType) {
    const startTime = performance.now();
    
    try {
      const processed = { ...data };
      
      // 根据媒体类型进行特定处理
      switch (mediaType) {
        case 'book':
          await this.processBookData(processed);
          break;
        case 'movie':
          await this.processMovieData(processed);
          break;
        case 'tv':
          await this.processTvData(processed);
          break;
        case 'game':
          await this.processGameData(processed);
          break;
        case 'social':
          await this.processSocialData(processed);
          break;
        default:
      }
      
      // 通用数据处理
      this.processCommonFields(processed);
      
      ClipMateLog.debug(`数据处理完成，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      
      return processed;
    } catch (error) {
      console.error(`数据处理失败(mediaType=${mediaType}):`, error, {
        errorType: error.constructor.name,
        errorMessage: error.message
      });
      throw error;
    }
  }

  async processBookData(data) {
    return DataProcessors.processBookData.call(this, data);
  }

  // 提取最早的上映日期
  extractEarliestReleaseDate(dateStr) {
    return DataFormatters.extractEarliestReleaseDate(dateStr);
  }

  async processMovieData(data) {
    return DataProcessors.processMovieData.call(this, data);
  }

  async processGameData(data) {
    return DataProcessors.processGameData.call(this, data);
  }

  // 处理电视剧数据
  async processTvData(data) {
    return DataProcessors.processTvData.call(this, data);
  }

  processCommonFields(data) {
    DataProcessors.processCommonFields.call(this, data);
  }

  /**
   * 统一处理「豆瓣」→「豆瓣链接」字段迁移 + URL 有效性校验
   * 被 processBookData / processMovieData / processGameData / processTvData 复用
   */
  ensureDoubanLink(data) {
    DataProcessors.ensureDoubanLink.call(this, data);
  }

  processAuthorNames(authors) {
    return DataFormatters.processAuthorNames(authors);
  }

  processCrewNames(crew) {
    return DataFormatters.processCrewNames(crew);
  }

  cleanPersonName(name) {
    if (!name) return '';
    
    return name
      .replace(/\s+/g, ' ')
      .replace(/[（(].*[）)]/g, '') // 移除括号内容
      .replace(/^(导演|编剧|主演|演员|作者)[:：]?\s*/g, '') // 移除角色前缀
      .trim();
  }

  cleanMovieTitle(title) {
    if (!title) return '';
    
    return title
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\d{4}\)\s*$/, '') // 移除年份
      .trim();
  }

  cleanGameTitle(title) {
    if (!title) return '';
    
    return title
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*Steam$/i, '') // 移除Steam后缀
      .trim();
  }

  formatDate(dateStr, includeTime = false) {
    if (!dateStr) return '';
    
    // 确保是字符串类型
    const dateString = dateStr.toString().trim();
    
    // 处理中文日期格式：2023 年 8 月 3 日
    const chineseDatePattern = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/;
    const chineseDateMatch = dateString.match(chineseDatePattern);
    
    if (chineseDateMatch) {
      const [, year, month, day] = chineseDateMatch;
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      
      // 验证月份和日期的有效性
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        // 如果需要包含时间，提取时间部分（如果存在）
        if (includeTime) {
          const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
          const timeMatch = dateString.match(timePattern);
          if (timeMatch) {
            const hours = timeMatch[1].padStart(2, '0');
            const minutes = timeMatch[2];
            const seconds = timeMatch[3] ? timeMatch[3].padStart(2, '0') : '00';
            return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')} ${hours}:${minutes}:${seconds}`;
          }
        }
        // 只返回日期部分
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 移除中文日期字符
    let processedDateStr = dateString.replace(/[年月]/g, '-').replace(/[日]/g, '');
    
    // 处理数字转中文的情况（简化处理，主要针对年份）
    const chineseNumbers = {'零': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'};
    for (const [chinese, number] of Object.entries(chineseNumbers)) {
      processedDateStr = processedDateStr.replace(new RegExp(chinese, 'g'), number);
    }
    
    // 尝试使用 Date 对象解析日期
    const dateObj = new Date(processedDateStr);
    if (!isNaN(dateObj.getTime())) {
      const year = dateObj.getFullYear();
      const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
      const day = dateObj.getDate().toString().padStart(2, '0');
      
      if (includeTime) {
        const hours = dateObj.getHours().toString().padStart(2, '0');
        const minutes = dateObj.getMinutes().toString().padStart(2, '0');
        const seconds = dateObj.getSeconds().toString().padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
      }
      // 只返回日期部分
      return `${year}/${month}/${day}`;
    }
    
    // 尝试匹配 YYYY-MM-DD HH:MM 或 YYYY/MM/DD HH:MM 格式（包含时间）
    const fullDateTimePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    const fullDateTimeMatch = processedDateStr.match(fullDateTimePattern);
    
    if (fullDateTimeMatch) {
      const [, year, month, day, hours, minutes, seconds] = fullDateTimeMatch;
      // 验证月份和日期的有效性
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        if (includeTime) {
          const formattedSeconds = seconds ? seconds.padStart(2, '0') : '00';
          return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes}:${formattedSeconds}`;
        }
        // 只返回日期部分
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 尝试匹配 YYYY-MM-DD 或 YYYY/MM/DD 格式（仅日期）
    const fullDatePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    const fullMatch = processedDateStr.match(fullDatePattern);
    
    if (fullMatch) {
      const [, year, month, day] = fullMatch;
      // 验证月份和日期的有效性
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 尝试匹配 YYYY-MM 或 YYYY/MM 格式
    const yearMonthPattern = /(\d{4})[-/](\d{1,2})/;
    const ymMatch = processedDateStr.match(yearMonthPattern);
    
    if (ymMatch) {
      const [, year, month] = ymMatch;
      const monthNum = parseInt(month);
      if (monthNum >= 1 && monthNum <= 12) {
        return `${year}/${month.toString().padStart(2, '0')}/01`;
      }
    }
    
    // 尝试匹配单独的年份
    const yearPattern = /(\d{4})/;
    const yearMatch = processedDateStr.match(yearPattern);
    
    if (yearMatch) {
      return `${yearMatch[1]}/01/01`;
    }
    
    return dateString;
  }

  formatRuntime(runtime) {
    if (!runtime) return '';
    
    // 提取分钟数
    const minuteMatch = runtime.match(/(\d+)\s*分钟?/);
    if (minuteMatch) {
      return minuteMatch[1] + '分钟';
    }
    
    return runtime.trim();
  }

  formatRating(rating) {
    if (!rating) return '';
    
    const ratingNum = parseFloat(rating);
    if (isNaN(ratingNum)) return rating;
    
    // 标准化评分格式
    if (ratingNum > 10) {
      return (ratingNum / 10).toFixed(1);
    }
    
    return ratingNum.toFixed(1);
  }

  /**
   * 处理社交媒体数据
   * 清理和标准化社交媒体平台的字段数据
   */
  processSocialData(data) {
    DataProcessors.processSocialData.call(this, data);
  }

  /**
   * 清理社交媒体标题
   * 移除表情符号、话题标签和@提及，支持各种语言文字
   */
  cleanSocialTitle(title) {
    return DataFormatters.cleanSocialTitle(title);
  }

  /**
   * 清理作者昵称
   * 社交媒体类作者昵称字段保持原始状态，不进行任何过滤处理
   */
  cleanAuthorName(authorName) {
    if (!authorName) return '';
    
    // 社交媒体类作者昵称保持原始状态，不进行任何过滤
    return authorName;
  }

  /**
   * 格式化社交媒体日期
   * 支持相对时间格式（如"刚刚"、"1小时前"）和绝对时间格式
   * 根据网站特定的dateFormat配置进行格式化
   * @param {string} dateStr - 日期字符串
   * @param {string} dateFormat - 日期格式配置（如YYYY/MM/DD, YYYY/MM/DD HH:mm等）
   * @returns {string} 格式化后的日期
   */
  formatSocialDate(dateStr, dateFormat = null) {
    return DataFormatters.formatSocialDate(dateStr, dateFormat);
  }

  /**
   * 验证和清理社交媒体URL
   * 确保URL完整，处理相对路径
   */
  validateSocialUrl(url) {
    return DataFormatters.validateSocialUrl(url);
  }

  /**
   * 获取平台名称
   * 根据sourceSite返回用户友好的平台名称
   */
  getPlatformName(sourceSite) {
    return DataFormatters.getPlatformName(sourceSite);
  }

  formatPlatforms(platforms) {
    return DataFormatters.formatPlatforms(platforms);
  }

  formatISBN(isbn) {
    return DataFormatters.formatISBN(isbn);
  }

  formatUrl(url) {
    return DataFormatters.formatUrl(url);
  }

  truncateText(text, maxLength) {
    return DataFormatters.truncateText(text, maxLength);
  }
  
  /**
   * 检查URL是否包含豆瓣域名
   * @param {string} url - 要检查的URL
   * @returns {boolean} - 如果URL包含豆瓣域名则返回true，否则返回false
   */
  isDoubanUrl(url) {
    return DataFormatters.isDoubanUrl(url);
  }
}


Object.assign(MediaExtractor.prototype, IgSpaMixin);

// v2.7.39：微博「页面上每条博文一颗小按钮」（weibo.com / s.weibo.com / m.weibo.cn）。
// 只提供 _initWeiboFeedButtons / _onWeiboPostExtract 两个方法，名字与 IG、抖音、快手互不重叠。
if (typeof WeiboSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, WeiboSpaMixin);
}

// v2.7.43：X（推特）「页面上每条推文一颗小按钮」（x.com）。
// 只提供 _initXFeedButtons / _onXPostExtract 两个方法，与 IG / 微博 / 抖音 / 快手互不重叠。
if (typeof XSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, XSpaMixin);
}

// v2.11.4：豆瓣「想看 / 在看 / 看过」列表页逐条小按钮（movie.douban.com/people/*）。
// 只提供 _initDoubanListButtons / _onDoubanListItemExtract / _doubanDocLooksTv 三个方法，
// 与 IG / 微博 / X / 抖音 / 快手的方法名互不重叠。
if (typeof DoubanListMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, DoubanListMixin);
}

// v2.5.77 批 3：抖音弹窗接管（只在 www.douyin.com、且识别不出类型时才会被调用）。
// 脚本没加载时跳过——不影响详情页，也不影响其他任何站点。
if (typeof DouyinSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, DouyinSpaMixin);
}

// v2.5.82：快手推荐流接管（只在 www.kuaishou.com 的 /new-reco、且识别不出类型时才会被调用）。
// 与抖音的 mixin 各自独立命名（_ks* / _douyin*），互不覆盖。
if (typeof KuaishouSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, KuaishouSpaMixin);
}

// v2.5.86：快手「站内跳转」接管（只认 www.kuaishou.com，其他站点一个监听都不多）。
// 与上面两个 mixin 的方法前缀互不重叠（_ksRoute* / _ks* / _douyin*）。
if (typeof KuaishouRouteMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, KuaishouRouteMixin);
}

// v2.5.94：TikTok 换条跟随（只认 tiktok.com，其他站点一个定时器都不多）。
// 方法前缀 _tk* / _refreshTikTokPanel，与上面三个 mixin 互不重叠。
if (typeof TikTokSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, TikTokSpaMixin);
}

// v2.6.0：小红书进出笔记跟随（只认 xiaohongshu.com，其他站点一个定时器都不多）。
// 方法前缀 _xhs* / _startXhsSpa / _closeXhsPanelOnly / _xhsShouldSuppressModal，
// 与上面四个 mixin 互不重叠。注意**不要**在这里塞一个叫 `_shouldSuppressModal` 的方法，
// 那会把 TikTok 那份覆盖掉（同名同原型），弹窗拦截要统一走 content-main 的汇总函数。
if (typeof XiaohongshuSpaMixin !== 'undefined') {
  Object.assign(MediaExtractor.prototype, XiaohongshuSpaMixin);
}

// 注意：ExtractorFactory 类已移至单独的 extractor-factory.js 文件中，在此不再重复定义

// 初始化应用
let mediaExtractorInstance = null;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    mediaExtractorInstance = new MediaExtractor();
    mediaExtractorInstance.init();
  });
} else {
  mediaExtractorInstance = new MediaExtractor();
  mediaExtractorInstance.init();
}

// 注：原「监听 document.body 变化即清除缓存」的逻辑已移除。
// 在 Instagram SPA 下该 observer 会高频触发、持续清空缓存且无效；
// 现由 InstagramModalWatcher 精确感知 Modal 打开/切换，并按帖子 shortcode 维度缓存（见 generateCacheKey）。

// 添加消息监听器，处理来自popup的提取请求和配置更新
WBR.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 检查是否是提取请求
  if (message.action === 'extract') {
    // 确保提取器实例已初始化
    if (!mediaExtractorInstance || !mediaExtractorInstance.isInitialized) {
      sendResponse({
        success: false,
        error: '媒体提取器未初始化，请刷新页面后重试'
      });
      return true;
    }
    
    // 执行提取并返回结果
    mediaExtractorInstance.extractFromCurrentPage()
      .then(data => {
        // 提取成功，将结果发送回popup
        sendResponse({
          success: true,
          data: data
        });
      })
      .catch(error => {
        // 提取失败，发送错误信息
        console.error('提取过程出错:', error);
        sendResponse({
          success: false,
          error: error.message || '提取失败'
        });
      });
      
    // 返回true以保持消息通道开放，等待异步操作完成
    return true;
  }
  
  // 处理缓存配置更新消息
  else if (message.action === 'updateCacheConfig') {
    if (mediaExtractorInstance) {
      const { enabled } = message;
      mediaExtractorInstance.setCacheEnabled(enabled);
      // 同时刷新 autoExtract 等配置（popup 保存设置时会发送此消息）
      mediaExtractorInstance.refreshConfig();
      sendResponse({
        success: true,
        message: `缓存状态已更新为${enabled ? '启用' : '禁用'}`
      });
    } else {
      sendResponse({
        success: false,
        error: '媒体提取器未初始化'
      });
    }
    return true;
  }
  
  // 处理清除缓存消息
  else if (message.action === 'clearCache') {
    if (mediaExtractorInstance) {
      mediaExtractorInstance.clearCache();
      sendResponse({
        success: true,
        message: '缓存已清除'
      });
    } else {
      sendResponse({
        success: false,
        error: '媒体提取器未初始化'
      });
    }
    return true;
  }
  
  // 处理其他类型的消息
  return false;
});

// 导出主类
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MediaExtractor;
}