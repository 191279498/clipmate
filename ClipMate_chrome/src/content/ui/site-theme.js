/**
 * 站点明暗判定（v2.9.3）
 *
 * 【为什么需要】
 *   浮窗和提取按钮是注入到别人页面里的浮层。以前只有浅色（米纸色），
 *   放到深色站点上就是一块刺眼的白板，夜里尤其明显。
 *
 * 【为什么判站点、不判系统】
 *   用户抱怨的场景恰恰是「站点深色、系统还开着浅色」——看的是页面，不是操作系统。
 *   所以先读页面自己的背景色，读不到（背景是图片/渐变/透明）才退回系统设置。
 *
 * 【为什么判一次就够，而不是每次开浮窗都算】
 *   getComputedStyle 会触发布局计算，浮窗可能一秒开好几次。这里缓存结果，
 *   只在「系统主题变了」或「页面 html/body 的 class、style 变了」时重算。
 *   后者是为了站点自己切深色模式时能跟上（很多站是给 <html> 加个 class）。
 *
 * 【为什么不给用户开关】
 *   多一个开关就多一个要想「我现在该选哪个」的地方。自动判断错了的概率很低，
 *   真错了（站点背景是深色大图却没设背景色）退回系统设置也能接受。
 */
class SiteTheme {
  /** 低于这个相对亮度就算深色。0.4 大致对应 #A0A0A0 —— 再浅就不该用浅字了。 */
  static get DARK_LUMA() { return 0.4; }

  /** 属性变化的重算节流间隔：站点切主题常连改好几个属性，等它改完再算。 */
  static get DEBOUNCE_MS() { return 300; }

  constructor() {
    this._dark = null;
    this._listeners = new Set();
    this._observer = null;
    this._media = null;
    this._mediaHandler = null;
    this._timer = null;
    this._started = false;
  }

  /** 单例：content script 里只有一份判定结果，浮窗和按钮共享。 */
  static get shared() {
    if (!SiteTheme._shared) SiteTheme._shared = new SiteTheme();
    return SiteTheme._shared;
  }

  /**
   * 当前站点是不是深色。结果会缓存，直到 refresh() 或监听发现变化。
   * @returns {boolean}
   */
  isDark() {
    if (this._dark === null) this._dark = this._compute();
    return this._dark;
  }

  /** 给元素挂上/摘掉 .clipmate-dark。传 null/undefined 时静默跳过。 */
  apply(el) {
    if (!el || !el.classList) return el;
    el.classList.toggle('clipmate-dark', this.isDark());
    return el;
  }

  /**
   * 挂上之后就一直跟着变：先按当前结果设一次，之后站点/系统换主题时自动更新。
   * 元素从页面里被移除后监听自动注销（否则每次重建浮窗都留一个僵尸回调）。
   * @returns {() => void} 取消跟随
   */
  attach(el) {
    if (!el || !el.classList) return () => {};
    this.apply(el);
    let off = null;
    const handler = () => {
      if (typeof el.isConnected === 'boolean' && !el.isConnected) {
        if (off) off();
        return;
      }
      this.apply(el);
    };
    off = this.onChange(handler);
    return () => { if (off) off(); };
  }

  /** 注册变化回调，返回取消函数。 */
  onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** 丢掉缓存并立刻重算，然后把结果告诉所有挂着的元素。 */
  refresh() {
    const next = this._compute();
    this._dark = next;
    // 不管颜色变没变都要通知一遍。
    // 不只是「换色」需要通知：元素被移出页面（浮窗关掉）时，也要靠这次遍历把监听注销掉，
    // 否则那个回调会一直躺在集合里，开一次浮窗留一个。
    // 成本上限是监听器个数（实测个位数），而 refresh 本身已被 MutationObserver 节流。
    // 遍历前复制一份：回调里可能顺手注销自己，直接遍历会被打乱。
    for (const fn of Array.from(this._listeners)) {
      try { fn(next); } catch (e) { /* 一个监听器出错不该拖垮别的 */ }
    }
    return next;
  }

  /**
   * 开始监听变化。重复调用无副作用。
   * 监听两件事：系统主题切换、页面根元素属性变化（站点自己切深色）。
   */
  start() {
    if (this._started || typeof window === 'undefined') return this;
    this._started = true;

    // 1) 系统主题
    try {
      if (typeof window.matchMedia === 'function') {
        this._media = window.matchMedia('(prefers-color-scheme: dark)');
        this._mediaHandler = () => this.refresh();
        if (typeof this._media.addEventListener === 'function') {
          this._media.addEventListener('change', this._mediaHandler);
        } else if (typeof this._media.addListener === 'function') {
          this._media.addListener(this._mediaHandler); // Safari 老版本
        }
      }
    } catch (e) { /* matchMedia 不可用就只靠下面的 DOM 变化 */ }

    // 2) 页面根元素属性变化（站点切深色常见做法：给 <html> 加 class）
    try {
      if (typeof MutationObserver === 'function' && document.documentElement) {
        this._observer = new MutationObserver(() => this._scheduleRefresh());
        this._observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme', 'data-color-mode'],
        });
        if (document.body) {
          this._observer.observe(document.body, {
            attributes: true,
            attributeFilter: ['class', 'style'],
          });
        }
      }
    } catch (e) { /* 观察不了就退化成「只在创建时判一次」 */ }

    return this;
  }

  /** 停止监听（测试与卸载时用）。 */
  stop() {
    this._started = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._observer) { try { this._observer.disconnect(); } catch (e) {} this._observer = null; }
    if (this._media && this._mediaHandler) {
      try {
        if (typeof this._media.removeEventListener === 'function') {
          this._media.removeEventListener('change', this._mediaHandler);
        } else if (typeof this._media.removeListener === 'function') {
          this._media.removeListener(this._mediaHandler);
        }
      } catch (e) {}
    }
    this._media = null;
    this._mediaHandler = null;
    return this;
  }

  /** 清掉缓存与监听器（测试用，避免用例之间互相污染）。 */
  reset() {
    this.stop();
    this._dark = null;
    this._listeners.clear();
    return this;
  }

  _scheduleRefresh() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => { this._timer = null; this.refresh(); }, SiteTheme.DEBOUNCE_MS);
  }

  /**
   * 真正的判定逻辑。
   * 依次看 <body> 和 <html> 的背景色，取第一个不透明的；都没有就用系统设置。
   */
  _compute() {
    const rgb = this._readBackgroundRGB();
    if (rgb) return this._luma(rgb) < SiteTheme.DARK_LUMA;
    return this._systemPrefersDark();
  }

  /** 读第一个不透明背景色；读不到返回 null。 */
  _readBackgroundRGB() {
    if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return null;
    const candidates = [];
    try { if (document.body) candidates.push(document.body); } catch (e) {}
    try { if (document.documentElement) candidates.push(document.documentElement); } catch (e) {}

    for (const el of candidates) {
      let bg = '';
      try { bg = getComputedStyle(el).backgroundColor || ''; } catch (e) { continue; }
      const parsed = this._parseColor(bg);
      // alpha 太低的背景色等于没有：下面透出来的才是用户真正看到的
      if (parsed && parsed.a >= 0.5) return parsed;
    }
    return null;
  }

  /** 解析 rgb() / rgba()，返回 {r,g,b,a}；解析不了返回 null。 */
  _parseColor(str) {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i.exec(str);
    if (!m) return null;
    return {
      r: parseFloat(m[1]),
      g: parseFloat(m[2]),
      b: parseFloat(m[3]),
      a: m[4] === undefined ? 1 : parseFloat(m[4]),
    };
  }

  /**
   * WCAG 相对亮度（0=黑, 1=白）。
   * 用线性化而不是简单加权平均：中间调的灰在两种算法下差很多，
   * 而「深灰底配浅字」正是最需要判准的一档。
   */
  _luma({ r, g, b }) {
    const channel = (v) => {
      const c = Math.max(0, Math.min(255, v)) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  /** 系统是否深色。环境不支持时返回 false（老浏览器走浅色，不会变黑屏）。 */
  _systemPrefersDark() {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return !!window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    } catch (e) {}
    return false;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SiteTheme;
} else {
  window.SiteTheme = SiteTheme;
}
