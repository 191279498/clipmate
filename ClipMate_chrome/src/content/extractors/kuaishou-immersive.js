/**
 * 快手「推荐流」提取器 —— KuaishouSocialExtractor 的子类
 *
 * ⚠️ 铁律：`kuaishou-social.js`（详情页那个）的**提取逻辑不动**。
 * 本文件只负责「推荐流 `/new-reco` 整屏竖滑」这一种新场景，
 * 父类原有的详情页行为完全不受影响。
 * 工厂里只有一道岔路口：**在推荐流里且认出了当前这一条**才走本类，其余情况原样走父类。
 *
 * 为什么是子类而不是新体系
 * ------------------------
 * 7 个字段的取法（作者ID 抓主页、标题用 SocialTitleProcessor、字段外壳用 SocialFieldsBuilder）
 * 与详情页完全一样，只是**数据的位置**换了（从整页换成当前那一条 slide 之内）。
 * 继承下来只覆盖 6 个取值方法，其余全部复用。
 *
 * 本类覆盖的 5 个字段（其余继承父类）
 * ------------------------------------
 *   作者昵称  slide 内 `a.name`（`@黑蛇` → `黑蛇`，与详情页输出一致）
 *   作者主页  slide 内 `a.name` 的 href（完整 profile 地址）
 *   发布日期  封面图地址里的 `/upic/YYYY/MM/DD/`（与详情页走的是同一条规则，天然一致）
 *   本页文案  slide 内 `.caption` 的文字（含 #话题，与详情页 `.video-info-title` 同源）
 *   URL       `https://www.kuaishou.com/short-video/<作品ID>`
 *   作者ID / 本页标题 → 继承父类（主页地址已换成当前条作者的）
 *
 * 三种「取不到」的处理
 * --------------------
 *   日期 / 文案 / 昵称：**宁可空**。父类这三条会整页 `querySelector`，
 *   在推荐流页面上会抓到侧栏/别人卡片的数据，串到当前这条上。
 *   主页：拿不到就空（不回落父类，父类取的 `a[href*="/profile/"]` 第一个可能是别人）。
 *
 * 熔断：连续 5 次「认出了作品ID，但文案 / 昵称 / 日期 全空」→ 本次会话停用推荐流提取，
 * 工厂岔路口看到标志就退回父类，等于回到「这个页面上没有这个功能」。
 */
class KuaishouImmersiveExtractor extends KuaishouSocialExtractor {
  constructor() {
    super();
    // siteName 必须与父类一致：字段映射 / 清单对账都按它认站点
    this.siteName = 'kuaishou_social';
    this._ctxResolved = false;
    this._ctx = null;
    // v2.5.83 页面作品档案（异步补齐，没拿到就是 null）
    this._stateResolved = false;
    this._state = null;
    this._warned = {};
  }

  // ===== 内部工具 =====

  _log(level, msg) {
    try {
      if (typeof ClipMateLog !== 'undefined' && ClipMateLog[level]) {
        ClipMateLog[level]('[KuaishouImmersiveExtractor] ' + msg);
        return;
      }
      if (typeof console !== 'undefined' && console[level]) console[level]('[KuaishouImmersiveExtractor] ' + msg);
    } catch (e) { /* 日志失败不许影响提取 */ }
  }

  _warnOnce(key, msg) {
    if (this._warned[key]) return;
    this._warned[key] = 1;
    this._log('warn', msg);
  }

  /**
   * 当前这一条的上下文（一次提取内固定）。
   * 固定住是必须的：切条时 slide 会变，边取边变会让 7 个字段来自两条作品。
   */
  _getContext() {
    if (this._ctxResolved) return this._ctx;
    this._ctxResolved = true;
    try {
      if (typeof KuaishouImmersiveContext !== 'undefined' && KuaishouImmersiveContext
        && typeof KuaishouImmersiveContext.immersiveContext === 'function') {
        this._ctx = KuaishouImmersiveContext.immersiveContext() || null;
      }
    } catch (e) {
      this._ctx = null;
    }
    return this._ctx;
  }

  /**
   * v2.5.83：把「页面自带的作品档案」问回来（异步，一次搬一整批）
   *
   * 这份档案是站点自己渲染用的原始数据（发布时间精确到毫秒、作者ID、文案都在里头），
   * 比从封面图片地址里抠字硬得多。但它是**补位不是替代**：
   *   - 老办法（封面地址 / DOM）有值 → 继续用老办法，输出一个字都不变
   *   - 老办法取空了 → 用档案补上，不至于留空
   * 这样既有抗改版的后备，又不会破坏「同一作品在任何入口同一字符串」。
   *
   * 注：必须在 `extractAllFields()` 里 await 一次，因为下面的字段方法为了和父类
   * 保持同步签名不能是 async（详见「签名铁律」注释）。
   */
  async _primeState() {
    if (this._stateResolved) return;
    this._stateResolved = true;
    const ctx = this._getContext();
    const id = ctx && ctx.id;
    if (!id) return;
    try {
      if (typeof KuaishouStateClient !== 'undefined' && KuaishouStateClient
        && typeof KuaishouStateClient.getMeta === 'function') {
        this._state = await KuaishouStateClient.getMeta(id);
      }
    } catch (e) {
      this._state = null; // 拿不到当没有，字段方法自动回落老办法
    }
  }

  /** 档案里这一条的值（没有就空串；改取值只需改这一处） */
  _fromState(key) {
    return (this._state && this._state[key]) ? String(this._state[key]) : '';
  }

  // ===== 7 个字段 =====
  //
  // ⚠️ 签名铁律：必须和父类 `KuaishouSocialExtractor` **一模一样**（同步的就同步）。
  // 踩过的坑：作者主页在父类里是**同步**方法，`extractAuthorInternalId()` 内部按字符串
  // 用它（`homepage.match(...)`）。一旦子类写成 async，那里拿到的是 Promise，
  // `.match` 抛异常被 catch 吞掉 → 作者ID 的兜底失效 → 字段变空。
  // 所以下面凡是父类同步的，这里一律同步（内部 `_getContext()` 本身就是同步的）。

  // 作者昵称（父类同步；老办法有值就用老办法，档案只在拿不到时补位）
  extractAuthorName() {
    try {
      const ctx = this._getContext();
      if (!ctx) return super.extractAuthorName();
      return ctx.nickname || this._fromState('nickname') || '';
    } catch (e) {
      this._log('warn', '提取作者昵称失败：' + (e && e.message));
      return '';
    }
  }

  // 作者主页（父类同步；档案在 `a.name` 缺失时补位）
  extractAuthorHomepage() {
    try {
      const ctx = this._getContext();
      if (!ctx) return super.extractAuthorHomepage();
      return ctx.homepage || this._fromState('homepage') || '';
    } catch (e) {
      this._log('warn', '提取作者主页失败：' + (e && e.message));
      return '';
    }
  }

  // 发布日期（本地取，不发请求；父类同步）
  extractPublishDate() {
    try {
      const ctx = this._getContext();
      if (!ctx) return super.extractPublishDate();
      if (ctx.date) return ctx.date;
      const fromState = this._fromState('date');
      if (fromState) return fromState;
      // 认出了是哪一条，但封面地址里没有 /upic/ 日期、且档案也没查到 → 留空。
      // 绝不回落父类整页搜：会抓到侧栏别人作品的日期。
      this._warnOnce('nodate', '这一条既没从封面地址读到日期、也不在页面档案里，发布日期留空');
      return '';
    } catch (e) {
      this._log('warn', '提取发布日期失败：' + (e && e.message));
      return '';
    }
  }

  // 本页文案（父类同步）
  extractDescription() {
    try {
      const ctx = this._getContext();
      if (!ctx) return super.extractDescription();
      return ctx.caption || this._fromState('caption') || '';
    } catch (e) {
      this._log('warn', '提取本页文案失败：' + (e && e.message));
      return '';
    }
  }

  // URL：填「这条作品该有的地址」，不填推荐流地址栏（内部无异步，同步即可）
  extractUrl() {
    try {
      const ctx = this._getContext();
      const id = (ctx && ctx.id) || '';
      if (!id) return '';
      return 'https://www.kuaishou.com/short-video/' + id;
    } catch (e) {
      this._log('warn', '生成 URL 失败：' + (e && e.message));
      return '';
    }
  }

  // ===== 熔断 + 装配 =====

  /**
   * 计「连续取不到内容」。
   * 判据用「文案 / 昵称 / 日期 三项全空」而不是「7 项全空」：
   * URL 只要有 ID 就一定非空，而作者ID 要走网络，网络不通不该算提取坏了。
   */
  async extractAllFields() {
    // v2.5.83：先把页面自带的作品档案问回来（一次注入搬一整批，拿到就用于补位）。
    // 放在最前面是为了让下面那些**同步**的字段方法能用上它；失败自动当没看到。
    try {
      await this._primeState();
    } catch (e) { /* 档案拿不到不影响提取，字段方法会自动回落到封面地址取法 */ }
    const data = await super.extractAllFields();

    try {
      const ctx = this._getContext();
      if (ctx) {
        // v2.5.98：文案可能是装配器兜底填的「快手视频」——那不是内容，不能算「取到了」。
        // 标记是不可枚举的 `__textFallback`（见 social-fields-builder.js）。
        const fallbackFlag = (typeof SocialFieldsBuilder !== 'undefined' && SocialFieldsBuilder &&
          SocialFieldsBuilder.TEXT_FALLBACK_FLAG) || '__textFallback';
        const textEmpty = !String(data['本页文案'] || '').trim() || data[fallbackFlag] === true;
        const empty = textEmpty
          && !String(data['作者昵称'] || '').trim()
          && !String(data['发布日期'] || '').trim();
        if (empty) {
          KuaishouImmersiveExtractor._emptyStreak += 1;
          if (KuaishouImmersiveExtractor._emptyStreak >= KuaishouImmersiveExtractor.EMPTY_LIMIT) {
            KuaishouImmersiveExtractor.disabled = true;
            this._log('error', '连续 ' + KuaishouImmersiveExtractor._emptyStreak
              + ' 次取不到内容，本次会话已停用推荐流提取（详情页不受影响）');
          } else {
            this._log('warn', '本次内容为空（第 ' + KuaishouImmersiveExtractor._emptyStreak + ' 次），页面可能还没渲染完');
          }
        } else {
          KuaishouImmersiveExtractor._emptyStreak = 0;
        }
      }
    } catch (e) { /* 熔断计数不许打断提取 */ }

    return data;
  }

  /** 是否已熔断（工厂岔路口会读它） */
  static isDisabled() {
    return KuaishouImmersiveExtractor.disabled === true;
  }

  /** 测试用：重置熔断状态 */
  static resetBreaker() {
    KuaishouImmersiveExtractor.disabled = false;
    KuaishouImmersiveExtractor._emptyStreak = 0;
  }
}

KuaishouImmersiveExtractor.EMPTY_LIMIT = 5;
KuaishouImmersiveExtractor._emptyStreak = 0;
KuaishouImmersiveExtractor.disabled = false;

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.KuaishouImmersiveExtractor = KuaishouImmersiveExtractor;
