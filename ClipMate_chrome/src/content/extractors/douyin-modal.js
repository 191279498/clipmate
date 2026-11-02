/**
 * 抖音「弹窗播放」提取器 —— DouyinSocialExtractor 的子类
 *
 * ⚠️ 铁律：`douyin-social.js`（详情页那个，379 行）**一个字节都不改**。
 * 本文件只负责「弹窗态」这一种新场景，父类原有的详情页行为完全不受影响。
 * 工厂里只有一道岔路口：**在弹窗里**才走本类，其余情况原样走父类。
 *
 * 弹窗态 7 个字段的取法（v2.5.77 方案第四节 / 4.2）
 * ---------------------------------------------------
 *   作者昵称   fiber.authorInfo.nickname  → DOM `feed-video-nickname`  → 父类
 *   作者主页   fiber.authorInfo.secUid    → DOM `a[video-avatar]` href → 父类
 *   发布日期   fiber.createTime           → `video-info` 文字里的时间 → **留空（不猜）**
 *   本页文案   fiber.desc                 → DOM `video-desc`        → **留空（不用 meta）**
 *   URL        规范地址 `https://www.douyin.com/(video|note)/<id>`
 *   作者ID     父类原逻辑（后台抓作者主页抠抖音号），只是主页地址换成本条作者的
 *   本页标题   父类原逻辑（SocialTitleProcessor），输入换成上面几个新值
 *
 * 三种「取不到」的处理不一样，这是故意的：
 *   - 日期 / 文案：**宁可空**。父类那两条会整页搜（`time`、`.date`、`*:contains("发布时间")`），
 *     在弹窗页上会抓到别人视频的时间，甚至页面配置里的「高考倒计时 2023-06-07」（批 1 实测）。
 *   - 昵称 / 主页：可以回落父类，因为父类读的是 JSON-LD / 作者链接，弹窗页上仍然指向本页作者。
 *
 * 熔断（方案 1.1 ②）：连续 5 次「弹窗在、但文案/昵称/日期全空」→ 停用本次会话的弹窗提取，
 * 工厂岔路口看到标志就退回父类，等于回到「今天的表现」。
 */
class DouyinModalExtractor extends DouyinSocialExtractor {
  constructor() {
    super();
    // siteName 必须与父类一致：字段映射 / 清单对账都按它认站点
    this.siteName = 'douyin_social';
    this._ctxResolved = false;
    this._ctx = null;
    this._metaPromise = null;
    this._warned = {};
  }

  // ===== 内部工具 =====

  _log(level, msg) {
    try {
      if (typeof ClipMateLog !== 'undefined' && ClipMateLog[level]) {
        ClipMateLog[level]('[DouyinModalExtractor] ' + msg);
        return;
      }
      if (typeof console !== 'undefined' && console[level]) console[level]('[DouyinModalExtractor] ' + msg);
    } catch (e) { /* 日志失败不许影响提取 */ }
  }

  _warnOnce(key, msg) {
    if (this._warned[key]) return;
    this._warned[key] = 1;
    this._log('warn', msg);
  }

  /** 当前弹窗上下文（一次提取内固定，避免边取边变导致字段来自两条作品） */
  _getContext() {
    if (this._ctxResolved) return this._ctx;
    this._ctxResolved = true;
    try {
      if (typeof DouyinModalContext !== 'undefined' && DouyinModalContext && typeof DouyinModalContext.resolve === 'function') {
        this._ctx = DouyinModalContext.resolve() || null;
      }
    } catch (e) {
      this._ctx = null;
    }
    return this._ctx;
  }

  /** 原始数据（fiber）。同一实例只问一次，失败返回 null */
  _getMeta() {
    if (this._metaPromise) return this._metaPromise;
    this._metaPromise = (async () => {
      try {
        const ctx = this._getContext();
        const id = ctx && ctx.id ? ctx.id : '';
        if (!id) return null;
        if (typeof DouyinFiberClient === 'undefined' || !DouyinFiberClient || typeof DouyinFiberClient.getMeta !== 'function') {
          this._warnOnce('nocli', '原始数据客户端未加载，走 DOM 取法');
          return null;
        }
        const meta = await DouyinFiberClient.getMeta(id);
        if (!meta) this._warnOnce('nofiber', '这一条取不到原始数据（modal_id=' + id + '），走 DOM 取法');
        return meta || null;
      } catch (e) {
        return null;
      }
    })();
    return this._metaPromise;
  }

  /** 昵称清洗：去掉开头的 @ 和末尾的认证徽章字样 */
  _cleanNickname(raw) {
    let name = typeof raw === 'string' ? raw : (raw ? String(raw) : '');
    name = name.replace(/\s+/g, ' ').trim();
    if (!name) return '';
    name = name.replace(/^@+/, '').trim();
    name = name.replace(/(认证徽章|企业认证|官方认证|个人认证|机构认证|蓝V认证)$/u, '').trim();
    return name;
  }

  /**
   * 这条作品是不是「图文」（v2.5.91）
   *
   * 为什么单独做一个：URL 字段要输 `/note/<id>` 还是 `/video/<id>`，取决于作品类型。
   * fiber 里本来有 `awemeType`，但**不是每次都能读到**（弹层出得晚、跨 world 时机不对），
   * 而页面里还有一份更稳的：`#RENDER_DATA`（SSR 直出，服务端就把类型写死了）。
   *
   * 实测（2026-10-28，样本 douyin-modal-jingxuan-note-7516480886684568891）：
   *   - 图文样本：`#RENDER_DATA` 里 `"awemeId":"7516480886684568891"` 之后紧跟着 `"awemeType":68`
   *   - 两个视频样本：整个 RENDER_DATA 里一个 `awemeType` 都没有
   *
   * 判定只在这个 id 自己的数据块内做（窗口内遇到下一条 awemeId 就截断），
   * 避免把推荐位里另一条图文当成当前作品。
   *
   * @param {string} id 作品 ID
   * @returns {boolean}
   */
  _isNoteFromRenderData(id) {
    if (!id) return false;
    try {
      const el = document.querySelector('#RENDER_DATA');
      if (!el) return false;
      let raw = el.textContent || '';
      if (!raw) return false;
      // 这段内容在服务端是 URI 编码后塞进 <script> 的；解不开就当明文试一次
      try { raw = decodeURIComponent(raw); } catch (e) { /* 保持原文 */ }

      const esc = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const at = raw.search(new RegExp('"aweme_?[Ii]d"\\s*:\\s*"?' + esc + '"?'));
      if (at < 0) return false;

      // 只取这条自己的数据块：下一条 awemeId 之前的部分
      let block = raw.slice(at, at + 1200);
      const next = block.slice(10).search(/"aweme_?[Ii]d"\s*:/);
      if (next >= 0) block = block.slice(0, next + 10);

      if (/"awemeType"\s*:\s*68/.test(block)) return true;
      if (/"mediaType"\s*:\s*2/.test(block)) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  /** 作者主页规范化：补协议、去掉查询串与尾巴 */  _normalizeHomepage(href) {
    let url = typeof href === 'string' ? href.trim() : '';
    if (!url) return '';
    if (url.indexOf('//') === 0) url = 'https:' + url;
    const m = /^(https?:\/\/[^/]*douyin\.com\/user\/[^/?#]+)/i.exec(url);
    return m ? m[1] : url;
  }

  /**
   * 文案清洗：去掉 DOM 里混进来的「展开」按钮文字
   *
   * v2.7.2：去掉旧版「全文超过 4 字才删」的保险。实测无文案作品抖音仍渲染
   * `video-desc` 容器，里面只剩「展开」俩字（类名混淆，DOM 层分不出按钮和文案）；
   * 旧保险放过它 → 文案字段变「展开」→ 不算空 → 「抖音视频」兜底被跳过，
   * 标题也被污染。改成无条件删结尾的「展开」，删完为空就返回空串，
   * 让空文案兜底（站名+形态）正常接管。
   */
  _stripExpand(raw) {
    let t = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!t) return '';
    while (/展开$/.test(t)) t = t.replace(/展开$/, '').trim();
    return t;
  }

  /** 从 DOM 里取本条作品的文案（只在 scope / info 内找，绝不整页找） */
  _domDesc(ctx) {
    if (!ctx) return '';
    const roots = [ctx.info, ctx.scope].filter(Boolean);
    for (const root of roots) {
      try {
        const el = root.querySelector('[data-e2e="video-desc"]');
        const t = this._stripExpand(el ? el.textContent : '');
        if (t) return t;
      } catch (e) { /* 下一个 */ }
    }
    return '';
  }

  _domNickname(ctx) {
    if (!ctx) return '';
    const roots = [ctx.info, ctx.scope].filter(Boolean);
    for (const root of roots) {
      try {
        const el = root.querySelector('[data-e2e="feed-video-nickname"]');
        const t = this._cleanNickname(el ? el.textContent : '');
        if (t) return t;
      } catch (e) { /* 下一个 */ }
    }
    return '';
  }

  _domHomepage(ctx) {
    if (!ctx) return '';
    try {
      if (typeof DouyinModalContext !== 'undefined' && DouyinModalContext && typeof DouyinModalContext.extractAvatarHref === 'function') {
        const href = DouyinModalContext.extractAvatarHref(ctx.scope);
        const normalized = this._normalizeHomepage(href);
        if (normalized) return normalized;
      }
    } catch (e) { /* 退出到父类 */ }
    return '';
  }

  _domPublishDate(ctx) {
    if (!ctx || !ctx.info) return '';
    try {
      if (typeof DouyinAwemeDate === 'undefined' || !DouyinAwemeDate) return '';
      const segment = DouyinModalContext.extractDateSegment(ctx.info);
      return DouyinAwemeDate.parsePublishedDate(segment, ctx.id) || '';
    } catch (e) {
      return '';
    }
  }

  // ===== 7 个字段 =====

  // 作者昵称
  async extractAuthorName() {
    try {
      const meta = await this._getMeta();
      if (meta && meta.nickname) {
        const cleaned = this._cleanNickname(meta.nickname);
        if (cleaned) return cleaned;
      }
      const ctx = this._getContext();
      const domName = this._domNickname(ctx);
      if (domName) return domName;
      // 弹窗都没认出来（不是弹窗场景）→ 完全交回父类
      if (!ctx) return await super.extractAuthorName();
      return '';
    } catch (e) {
      this._log('warn', '提取作者昵称失败：' + (e && e.message));
      return '';
    }
  }

  // 作者主页
  async extractAuthorHomepage() {
    try {
      const meta = await this._getMeta();
      if (meta && meta.secUid) {
        return this._normalizeHomepage('https://www.douyin.com/user/' + meta.secUid);
      }
      const ctx = this._getContext();
      const domHome = this._domHomepage(ctx);
      if (domHome) return domHome;
      if (!ctx) return await super.extractAuthorHomepage();
      return '';
    } catch (e) {
      this._log('warn', '提取作者主页失败：' + (e && e.message));
      return '';
    }
  }

  // 发布日期
  async extractPublishDate() {
    try {
      const meta = await this._getMeta();
      if (meta && meta.createTime) {
        const fromFiber = typeof DouyinAwemeDate !== 'undefined' && DouyinAwemeDate
          ? DouyinAwemeDate.formatTimestamp(meta.createTime)
          : '';
        if (fromFiber) return fromFiber;
      }
      const ctx = this._getContext();
      const fromDom = this._domPublishDate(ctx);
      if (fromDom) return fromDom;
      // 弹窗里拿不到就留空：绝不整页搜日期（会抓到别人的、或页面配置里的假日期）
      if (!ctx) return await super.extractPublishDate();
      return '';
    } catch (e) {
      this._log('warn', '提取发布日期失败：' + (e && e.message));
      return '';
    }
  }

  // 本页文案
  async extractPageText() {
    try {
      const meta = await this._getMeta();
      if (meta && meta.desc) {
        const text = this.processPageText(meta.desc);
        if (text) return text;
      }
      const ctx = this._getContext();
      const domText = this._domDesc(ctx);
      if (domText) {
        const text = this.processPageText(domText);
        if (text) return text;
      }
      // 弹窗里不用 meta 描述：`/user/…?modal_id=` 时它是主页自我介绍，跟这条作品无关
      if (!ctx) return await super.extractPageText();
      return '';
    } catch (e) {
      this._log('warn', '提取本页文案失败：' + (e && e.message));
      return '';
    }
  }

  // URL：填「这条作品该有的地址」，不填弹窗地址栏
  async extractUrl() {
    try {
      const ctx = this._getContext();
      const meta = await this._getMeta();
      const id = (meta && meta.awemeId) || (ctx && ctx.id) || '';
      if (!id) return '';
      // 图文：一手数据 awemeType===68 / mediaType===2；判不出来再问 #RENDER_DATA（v2.5.91）；
      // 还是判不出来就一律 /video/（实测会自动 302 到 /note/）。
      // v2.5.91 的老问题：详情页给 /note/、弹窗给 /video/，同一个作品两个入口两个地址
      // （违反「同一作品任何入口必须同一字符串」），所以补了 SSR 那一档。
      // v2.7.3：与 getContentShape()（文案为空时填「抖音图文」还是「抖音视频」）共用同一处判定
      // `_isNoteWork()`，否则会出现「URL 输 /note/、文案却填抖音视频」的自相矛盾。
      const isNote = (typeof this._isNoteWork === 'function')
        ? await this._isNoteWork()
        : (!!(meta && (Number(meta.awemeType) === 68 || Number(meta.mediaType) === 2))
          || this._isNoteFromRenderData(id));
      return 'https://www.douyin.com/' + (isNote ? 'note' : 'video') + '/' + id;
    } catch (e) {
      this._log('warn', '生成 URL 失败：' + (e && e.message));
      return '';
    }
  }

  // ===== 熔断 + 装配 =====

  /**
   * 弹窗态字段装配：父类的字段外壳（7 项、顺序、mediaType/sourceSite）照用，
   * 取值方法已被上面 6 个覆盖，标题与作者ID 走父类原逻辑。
   *
   * 熔断：连续 5 次「认出了是哪一条、但文案 / 昵称 / 日期 全空」→ 停用**这一种模式**。
   * 判据用这三项而不是「7 项全空」，因为 URL 只要有 ID 就一定非空，
   * 而作者ID 要走网络，网络不通不该算「提取坏了」。
   *
   * v2.5.80 起计数按模式分开（弹窗 / 沉浸流各一套）：
   * 沉浸流取不到不该把弹窗一起停掉 —— 用户要的是「两个功能互不牵连」。
   */
  async extractAllFields() {
    const data = await super.extractAllFields();

    try {
      const ctx = this._getContext();
      if (ctx) {
        const immersive = ctx.mode === 'immersive';
        const streakKey = immersive ? '_emptyStreakImmersive' : '_emptyStreak';
        const flagKey = immersive ? 'disabledImmersive' : 'disabled';
        // v2.5.98：文案可能是装配器兜底填的「抖音视频」——那不是内容，不能算「取到了」。
        // 标记是不可枚举的 `__textFallback`（见 social-fields-builder.js）。
        const fallbackFlag = (typeof SocialFieldsBuilder !== 'undefined' && SocialFieldsBuilder &&
          SocialFieldsBuilder.TEXT_FALLBACK_FLAG) || '__textFallback';
        const textEmpty = !String(data['本页文案'] || '').trim() || data[fallbackFlag] === true;
        const empty = textEmpty
          && !String(data['作者昵称'] || '').trim()
          && !String(data['发布日期'] || '').trim();
        if (empty) {
          DouyinModalExtractor[streakKey] += 1;
          if (DouyinModalExtractor[streakKey] >= DouyinModalExtractor.EMPTY_LIMIT) {
            DouyinModalExtractor[flagKey] = true;
            this._log('error', '连续 ' + DouyinModalExtractor[streakKey] + ' 次取不到内容，本次会话已停用'
              + (immersive ? '沉浸流' : '弹窗') + '提取（其他场景不受影响）');
          } else {
            this._log('warn', '本次内容为空（第 ' + DouyinModalExtractor[streakKey] + ' 次），页面可能还没渲染完');
          }
        } else {
          DouyinModalExtractor[streakKey] = 0;
        }
      }
    } catch (e) { /* 熔断计数不许打断提取 */ }

    return data;
  }

  /**
   * 这种模式是否已熔断（工厂岔路口会读它）
   * @param {string} [mode] 'modal' | 'immersive'；不传 = 任一模式熔断都算
   */
  static isDisabled(mode) {
    if (mode === 'immersive') return DouyinModalExtractor.disabledImmersive === true;
    if (mode === 'modal') return DouyinModalExtractor.disabled === true;
    return DouyinModalExtractor.disabled === true || DouyinModalExtractor.disabledImmersive === true;
  }

  /** 测试用：重置熔断状态 */
  static resetBreaker() {
    DouyinModalExtractor.disabled = false;
    DouyinModalExtractor._emptyStreak = 0;
    DouyinModalExtractor.disabledImmersive = false;
    DouyinModalExtractor._emptyStreakImmersive = 0;
  }
}

DouyinModalExtractor.EMPTY_LIMIT = 5;
DouyinModalExtractor._emptyStreak = 0;
DouyinModalExtractor.disabled = false;
/** v2.5.80：沉浸流单独一套计数与开关，与弹窗互不牵连 */
DouyinModalExtractor._emptyStreakImmersive = 0;
DouyinModalExtractor.disabledImmersive = false;

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.DouyinModalExtractor = DouyinModalExtractor;
