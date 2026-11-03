// 弹出窗口脚本（v2.8.4 极简版）
//
// 三条硬规则，改之前先读：
//   1. 改完立即保存，没有「保存」按钮；成功只在底部闪一下「已保存」，失败才报错。
//   2. popup 只干一件事 —— 改「当前这个站」。全局默认在设置页「通用」，这里一个字都不提，
//      也没有「跟随全局 / 单独设置」的选择：碰哪个开关，就把本站按当前生效值存一份下来。
//   3. 想退回全局，只有底部那行「恢复默认」（仅在本站被改过时出现），点一下删掉本站规则，
//      自然回落到原来的继承关系。
//
// 站点级配置的解析规则（后缀匹配 + 最长优先）在 src/shared/site-config.js，
// 这里只负责读写和显示。

// 浏览器 API 兼容层：Firefox 优先用 browser.*（原生 Promise），Chrome 回退到 chrome.*
var WBR = (typeof browser !== "undefined" && browser && browser.runtime) ? browser : chrome;

// v2.5.66：「自动复制」三种格式的显示名。值与 site-config.js 的 AUTO_COPY_FORMATS 一一对应，
// 合法性校验统一走 ClipMateSites.normalizeCopyFormat()，这里只负责显示。
var COPY_FORMAT_LABELS = { notion: 'Notion', markdown: 'Markdown', plaintext: '纯文本' };

// 本站规则里允许出现的五个键（判断「改过几项」用）
var SITE_KEYS = ['autoExtract', 'autoExtractDelay', 'autoCopy', 'autoCopyFormat', 'showButton'];

class PopupManager {
  constructor() {
    this.currentTab = null;
    this.config = null;

    this.hostname = '';
    this.parentDomain = '';
    this.site = null;

    this.savedTimer = null;
    this.ready = false;
    this.init();
  }

  async init() {
    try {
      this.showVersion();
      await this.getCurrentTab();
      await this.loadData();
      this.initSiteCard();
      this.applyThemeFromConfig();
      this.bindEvents();
      this.ready = true;

      // 同步缓存配置到内容脚本（失败无妨，页面刷新后自然生效）
      this.syncToTab();

      document.body.style.visibility = 'visible';
    } catch (error) {
      console.error('初始化失败:', error);
      document.body.style.visibility = 'visible';
      this.showError('初始化失败，请刷新页面重试');
    }
  }

  showVersion() {
    const el = document.getElementById('popVersion');
    if (!el) return;
    try {
      const manifest = WBR.runtime.getManifest();
      el.textContent = `v${manifest.version}`;
    } catch (e) {
      el.textContent = '';
    }
  }

  async getCurrentTab() {
    const tabs = await WBR.tabs.query({ active: true, currentWindow: true });
    this.currentTab = tabs[0] || null;
  }

  async loadData() {
    // background 同时返回裸字段和 config 键（v2.5.45 修的契约），这里优先用 config
    const res = await WBR.runtime.sendMessage({ action: 'getConfig' });
    this.config = (res && res.config) ? res.config : (res || {});
    if (!this.config.siteOverrides || typeof this.config.siteOverrides !== 'object') {
      this.config.siteOverrides = {};
    }
    if (!this.config.settings || typeof this.config.settings !== 'object') {
      this.config.settings = { enableCache: true };
    }
  }

  // ============ 本站 ============

  /**
   * 当前标签的「网站域名」——只认 http/https。
   * 为什么不能直接看 hostname：`chrome://extensions/` 的 hostname 是 `extensions`，
   * `chrome-extension://abc/...` 的是 `abc`，它们都会被当成「一个没收录的网站」，
   * 深链就会拼出 `focus=extensions` 这种指向不存在站点的地址。
   */
  webHost() {
    try {
      const raw = (this.currentTab && this.currentTab.url) || '';
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
      return u.hostname || '';
    } catch (e) {
      return '';
    }
  }

  initSiteCard() {
    const Sites = window.ClipMateSites;
    if (!Sites) {
      console.error('[ClipMate] site-config.js 未加载');
      return;
    }

    const host = this.webHost();
    this.hostname = host;

    const nameEl = document.getElementById('siteName');
    const hostEl = document.getElementById('siteHost');

    if (!host) {
      nameEl.textContent = '本站设置';
      nameEl.classList.add('is-plain');
      this._showEmpty(
        '这里没有可提取的内容',
        '采媒灵只在普通网页上工作，浏览器自己的页面读不到。'
      );
      return;
    }

    hostEl.textContent = host;
    this.parentDomain = Sites.parentDomain(host);
    this.site = Sites.findSite(host);

    if (this.site) {
      nameEl.textContent = this.site.name;
    } else {
      // 没收录的站：用域名当标题，摆空状态而不是一排点不动的开关
      nameEl.textContent = this.parentDomain || host;
      // 标题写的已经是域名了，第二行再写一遍只是重复
      hostEl.textContent = '';
      this._showEmpty(
        '这个页面还没有可提取的内容',
        '打开条目详情页，采媒灵会自动认出它属于哪一类。'
      );
      return;
    }

    this.render();
  }

  /**
   * 空状态（v2.9.1）：没东西可提取时，不摆一排灰掉的开关。
   * 只留「一句话 + 一个出口」——标题栏仍写着当前站，读的人知道自己在哪、能去哪。
   */
  _showEmpty(title, desc) {
    const box = document.getElementById('popEmpty');
    const titleEl = document.getElementById('popEmptyTitle');
    const descEl = document.getElementById('popEmptyDesc');
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;
    if (box) box.hidden = false;
    // 设置行与底部状态一起收起：留着只会让人以为「能改，只是没显示」
    document.getElementById('siteRows').hidden = true;
    document.getElementById('footState').hidden = true;
    const note = document.getElementById('siteNote');
    if (note) note.hidden = true;
  }

  /** 本站自己写下的那条规则（没有 / null 都当没有） */
  ownRule() {
    if (!this.hostname) return null;
    const ov = this.config.siteOverrides || {};
    if (!Object.prototype.hasOwnProperty.call(ov, this.hostname)) return null;
    const r = ov[this.hostname];
    return (r && typeof r === 'object') ? r : null;
  }

  render() {
    const Sites = window.ClipMateSites;
    if (!Sites || !this.hostname) return;

    const eff = Sites.resolve(this.config, this.hostname);

    // 控件直接显示「此刻真正生效的值」，不区分它来自全局还是本站
    safeSetChecked('siteAutoExtract', eff.autoExtract);
    safeSetChecked('siteAutoCopy', eff.autoCopy);
    safeSetChecked('siteShowButton', eff.showButton);
    safeSetValue('siteAutoExtractDelay', eff.autoExtractDelay);
    safeSetText('siteDelayValue', eff.autoExtractDelay);

    const fmtSel = document.getElementById('siteAutoCopyFormat');
    if (fmtSel) fmtSel.value = Sites.normalizeCopyFormat(eff.autoCopyFormat);

    // 子项跟着父开关走：关掉就没必要占地方
    document.getElementById('rowDelay').hidden = !eff.autoExtract;
    document.getElementById('rowFormat').hidden = !eff.autoCopy;

    // 按钮被藏起来时给一句话，免得下次不知道怎么调出来
    const hint = document.getElementById('rowBtnHint');
    if (hint) hint.hidden = !!eff.showButton;

    this.renderFoot(eff);
  }

  /**
   * 底部一行：只说「这个站和你上次看到的不一样」这件事。
   *   本站自己被改过 → 「本站已单独设置 N 项 · 恢复默认」
   *   继承的是上层域名（douban.com 之于 book.douban.com） → 「沿用 douban.com 的设置」
   *   完全跟全局 → 什么都不显示（空着比写「跟随全局」干净）
   */
  renderFoot(eff) {
    const stateEl = document.getElementById('footState');
    const textEl = document.getElementById('footText');
    const restoreEl = document.getElementById('restoreGlobal');

    const own = this.ownRule();
    const count = own
      ? SITE_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(own, k)).length
      : 0;

    if (count > 0) {
      textEl.textContent = '本站已单独设置 ·';
      restoreEl.hidden = false;
      stateEl.hidden = false;
      return;
    }

    const rule = eff && eff.rule ? String(eff.rule) : '';
    if (rule && rule.toLowerCase() !== this.hostname.toLowerCase()) {
      textEl.textContent = '沿用 ' + rule + ' 的设置';
      restoreEl.hidden = true;
      stateEl.hidden = false;
      return;
    }

    stateEl.hidden = true;
  }

  /**
   * 写入本站规则。
   * 以「当前生效值」为底做快照，再只改一项 —— 这样改一个开关不会让另外几项
   * 悄悄回落到全局（尤其在继承着上层域名规则的时候）。
   */
  async writeSiteRule(patchKey, patchValue) {
    const Sites = window.ClipMateSites;
    if (!Sites || !this.hostname) return;

    const eff = Sites.resolve(this.config, this.hostname);
    const snapshot = {
      autoExtract: eff.autoExtract,
      autoExtractDelay: eff.autoExtractDelay,
      autoCopy: eff.autoCopy,
      showButton: eff.showButton
    };

    // 格式键特殊：本站原本没这条 → 不写，继续保持「跟全局一起变」
    const own = this.ownRule();
    if (own && Object.prototype.hasOwnProperty.call(own, 'autoCopyFormat')) {
      snapshot.autoCopyFormat = own.autoCopyFormat;
    }

    if (patchKey === 'autoCopyFormat') {
      // 关键：拿「本站没有这条规则时会继承到的格式」作比较。
      // 与它一致 → 不写这条键（等于继续跟着变）；不一致 → 写下去（真正改成这个格式）。
      // 这样下拉框里不需要一个叫「跟随全局」的选项，行为却还在；
      // 也不能拿全局值来比 —— 继承的可能是 douban.com 那种上层域名规则，值未必等于全局。
      const ovWithout = Object.assign({}, this.config.siteOverrides || {});
      delete ovWithout[this.hostname];
      const inherited = Sites.resolve(
        Object.assign({}, this.config, { siteOverrides: ovWithout }),
        this.hostname
      );
      const inheritedFmt = Sites.normalizeCopyFormat(inherited.autoCopyFormat);
      if (patchValue && patchValue !== inheritedFmt) snapshot.autoCopyFormat = patchValue;
      else delete snapshot.autoCopyFormat;
    } else if (patchKey) {
      snapshot[patchKey] = patchValue;
    }

    const ov = Object.assign({}, this.config.siteOverrides || {});
    ov[this.hostname] = snapshot;

    this.config.siteOverrides = ov;
    await this.saveConfig({ siteOverrides: ov }, '已保存');
    this.render();
  }

  /** 「恢复默认」：删掉本站这条规则，回到原来的继承关系 */
  async restoreGlobal() {
    if (!this.hostname) return;
    const ov = Object.assign({}, this.config.siteOverrides || {});
    if (!Object.prototype.hasOwnProperty.call(ov, this.hostname)) return;

    delete ov[this.hostname];
    this.config.siteOverrides = ov;
    await this.saveConfig({ siteOverrides: ov }, '已恢复默认');
    this.render();
  }

  // ============ 外观 ============

  /** 主题只影响 popup 自己的配色（浮窗主题单独做） */
  applyThemeFromConfig() {
    this.applyTheme((this.config && this.config.theme) || 'system');
  }

  applyTheme(theme) {
    const body = document.body;
    body.classList.remove('theme-light', 'theme-dark');

    if (theme === 'dark') {
      body.classList.add('theme-dark');
    } else if (theme !== 'light') {
      // v2.8.2：'system' 以及任何未知值（含老配置里那个 'default'）一律按跟随系统处理，
      // 免得设置页显示「跟随系统」、popup 却还是浅色，两处说法对不上。
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    }
    // 'light' = 不加任何 class（默认浅色）
  }

  // ============ 事件 ============

  bindEvents() {
    const bindSwitch = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', () => this.writeSiteRule(key, el.checked));
    };

    bindSwitch('siteAutoExtract', 'autoExtract');
    bindSwitch('siteAutoCopy', 'autoCopy');
    bindSwitch('siteShowButton', 'showButton');

    // 延迟滑块：拖动时只更新数字，松手才落盘
    const delay = document.getElementById('siteAutoExtractDelay');
    if (delay) {
      delay.addEventListener('input', () => {
        safeSetText('siteDelayValue', delay.value);
      });
      delay.addEventListener('change', () => {
        this.writeSiteRule('autoExtractDelay', parseInt(delay.value, 10) || 0);
      });
    }

    const fmtSel = document.getElementById('siteAutoCopyFormat');
    if (fmtSel) {
      fmtSel.addEventListener('change', () => {
        this.writeSiteRule('autoCopyFormat', fmtSel.value || '');
      });
    }

    const restore = document.getElementById('restoreGlobal');
    if (restore) {
      restore.addEventListener('click', () => this.restoreGlobal());
    }

    const openBtn = document.getElementById('openOptions');
    if (openBtn) {
      openBtn.addEventListener('click', () => this.openOptionsPage());
    }

    const sitesBtn = document.getElementById('openSites');
    if (sitesBtn) {
      sitesBtn.addEventListener('click', () => this.openSitesPage());
    }
  }

  /** 空状态里的出口：直接落到设置页的「支持站点」分区 */
  openSitesPage() {
    const base = WBR.runtime.getURL('src/options/options.html');
    try {
      WBR.tabs.create({ url: base + '#sites' });
      window.close();
    } catch (e) {
      this.showError('打不开设置页：' + (e && e.message ? e.message : '未知错误'));
    }
  }

  /** 打开设置页；能定位到本站就定位到本站 */
  openOptionsPage() {
    const base = WBR.runtime.getURL('src/options/options.html');
    const host = this.webHost();
    const url = host
      ? base + '#sites?focus=' + encodeURIComponent(host)
      : base;
    try {
      WBR.tabs.create({ url });
      window.close();
    } catch (e) {
      this.showError('打不开设置页：' + (e && e.message ? e.message : '未知错误'));
    }
  }

  // ============ 保存 ============

  async saveConfig(patch, tip) {
    try {
      await WBR.runtime.sendMessage({ action: 'saveConfig', config: patch });
    } catch (error) {
      console.error('保存设置失败:', error);
      this.showError('保存失败：' + (error && error.message ? error.message : '未知错误'));
      return false;
    }

    // 本地状态同步，避免界面和存储不一致
    this.config = Object.assign({}, this.config, patch);
    if (patch.settings) {
      this.config.settings = Object.assign({}, this.config.settings, patch.settings);
    }

    this.flashSaved(tip || '已保存');
    this.syncToTab();
    return true;
  }

  /** 让当前页立刻用上新配置（showButton 的显隐、autoCopy 等） */
  async syncToTab() {
    if (!this.currentTab || !this.currentTab.id) return;
    try {
      await WBR.tabs.sendMessage(this.currentTab.id, {
        action: 'updateCacheConfig',
        enabled: this.config.settings ? this.config.settings.enableCache !== false : true
      });
    } catch (notifyError) {
      // 当前页面没有内容脚本（chrome:// 等），属正常情况
    }
  }

  flashSaved(text) {
    const el = document.getElementById('savedTip');
    if (!el) return;
    el.textContent = text || '已保存';
    el.classList.add('on');
    if (this.savedTimer) clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => {
      el.classList.remove('on');
    }, 1600);
  }

  showError(message) {
    this.showMessage(message, 'error');
  }

  showMessage(message, type = 'info') {
    const existing = document.querySelectorAll('.message');
    existing.forEach((msg) => msg.remove());

    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;

    messageEl.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      right: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 12px;
      color: white;
      z-index: 1000;
      opacity: 0;
      transition: opacity 0.3s ease;
      word-wrap: break-word;
      ${type === 'error' ? 'background: #b91c1c;' : 'background: #4c1d95;'}
    `;

    document.body.appendChild(messageEl);

    requestAnimationFrame(() => {
      messageEl.style.opacity = '1';
    });

    setTimeout(() => {
      messageEl.style.opacity = '0';
      setTimeout(() => {
        if (messageEl.parentNode) messageEl.parentNode.removeChild(messageEl);
      }, 300);
    }, type === 'error' ? 5000 : 2600);
  }
}

// ====== 安全 DOM 操作辅助函数（元素不存在时静默处理） ======

function safeSetChecked(id, value) {
  const el = document.getElementById(id);
  if (el) el.checked = !!value;
}

function safeSetValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function safeSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// 初始化弹出窗口
const popupManager = new PopupManager();
