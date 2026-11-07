// 设置页脚本（v2.8.0）
//
// 这一版把「按网站设置」升级成完整设置页，三块：
//   通用 —— 全局默认，直接在这儿改（以前只能回 popup 改）
//   网站 —— 23 个站，折叠卡片；站点专属功能（抖音弹窗、快手推荐流、X/微博/IG 逐帖按钮）
//           就近挂在对应站的卡片里，不再单独占一排
//   关于 —— 版本与支持站点
//
// 三条硬规则：
//   1. 改完立即存，没有保存按钮；存完 5 秒内可撤销（比 toast 更防误点）。
//   2. 控件定义只在 src/shared/settings-schema.js 一处，这里不手写第二份，
//      避免再出现「popup 有延迟、设置页没有」这种漂移。
//   3. 站点级写入一律「先取生效值做快照，再只改一项」——命中上层域名规则时，
//      另外几项不会被悄悄打回全局。

var WBR = (typeof browser !== "undefined" && browser && browser.runtime) ? browser : chrome;

var SITES = null;      // window.ClipMateSites
var SCHEMA = null;     // window.ClipMateSettings
var FLAGS = null;      // window.ClipMateFeatures
var MEDIA = null;      // window.mediaTypesConfig（字段清单的唯一真源）

var UNDO_MS = 5000;

// ============ 小工具 ============

function el(tag, cls, text) {
  var node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj == null ? {} : obj));
  } catch (e) {
    return {};
  }
}

/** 顶层浅合并；settings 这一层做深合并（后台也是这么合的，保持一致） */
function mergeLocal(config, patch) {
  var next = Object.assign({}, config || {}, patch || {});
  if (patch && patch.settings && typeof patch.settings === 'object') {
    next.settings = Object.assign({}, (config && config.settings) || {}, patch.settings);
  }
  return next;
}

// ============ 页面 ============

class SettingsPage {
  constructor() {
    this.config = {};
    this.legacy = {};        // 旧独立存储键（抖音/快手那几个），只读兼容用
    this.query = '';
    this.filter = 'all';
    this.openSites = {};     // domain -> true，保存重渲染后保持展开
    this.undo = null;        // { patch, prevConfig }
    this.timer = null;
    this.cacheStats = null;  // { entries, bytes }，数据页显示用
    this.init();
  }

  async init() {
    SITES = window.ClipMateSites || null;
    SCHEMA = window.ClipMateSettings || null;
    FLAGS = window.ClipMateFeatures || null;
    MEDIA = window.mediaTypesConfig || null;

    this.showVersion();
    await this.load();
    this.applyTheme();
    this.bindShell();
    this.renderGeneral();
    this.renderSites();
    this.renderFields();
    this.renderData();
    this.renderAbout();
    this.route();
  }

  showVersion() {
    var v = '';
    try {
      v = 'v' + WBR.runtime.getManifest().version;
    } catch (e) { v = ''; }
    var a = document.getElementById('brandVersion');
    if (a) a.textContent = v;
    var b = document.getElementById('aboutVersion');
    if (b) b.textContent = v || '—';
  }

  async load() {
    try {
      var res = await WBR.runtime.sendMessage({ action: 'getConfig' });
      this.config = (res && res.config) ? res.config : (res || {});
    } catch (e) {
      this.config = {};
      this.toast('读取配置失败：' + ((e && e.message) || '未知错误'), true);
    }
    if (!this.config.siteOverrides || typeof this.config.siteOverrides !== 'object') {
      this.config.siteOverrides = {};
    }
    if (!this.config.features || typeof this.config.features !== 'object') {
      this.config.features = {};
    }
    // 字段顺序：只认「按媒体类型存的对象」这一种形态。
    // 更早的版本存的是整份数组（没有类型维度），早就不写了；留着它反而会让字段页写盘时
    // 把数组摊成 {0:…,1:…}，所以这里统一收敛成对象。
    if (!this.config.fieldOrder || typeof this.config.fieldOrder !== 'object' ||
        Array.isArray(this.config.fieldOrder)) {
      this.config.fieldOrder = {};
    }

    // 旧键：抖音/快手那几个开关原来存成独立键，这里读一次用于「双读」判断
    if (FLAGS && typeof WBR.storage.local.get === 'function') {
      try {
        var keys = FLAGS.legacyKeys();
        this.legacy = keys.length ? ((await WBR.storage.local.get(keys)) || {}) : {};
      } catch (e) {
        this.legacy = {};
      }
    }
  }

  /** 主题：设置页跟着 config.theme 走；没设过就跟随系统 */
  applyTheme() {
    var t = this.config && this.config.theme;
    var root = document.documentElement;
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else if (t === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  /** 当前生效的某个设置项（全局口径） */
  readGlobal(key) {
    var item = SCHEMA.byKey(key);
    return item ? SCHEMA.read(this.config, item) : undefined;
  }

  /** 某个功能开关当前值（含旧键回退） */
  readFeature(key) {
    if (!FLAGS) return true;
    var stored = Object.assign({}, this.legacy, { config: this.config });
    return FLAGS.isEnabled(key, stored);
  }

  // ============ 外壳：页签 / 搜索快捷键 ============

  bindShell() {
    var nav = document.getElementById('nav');
    if (nav) {
      nav.addEventListener('click', (e) => {
        var a = e.target.closest ? e.target.closest('.nav-item') : null;
        if (!a) return;
        e.preventDefault();
        this.go(a.dataset.tab);
      });
    }

    window.addEventListener('hashchange', () => this.route());

    document.addEventListener('keydown', (e) => {
      var tag = (e.target && e.target.tagName) || '';
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        this.go('sites');
        var box = document.getElementById('siteSearch');
        if (box) box.focus();
      }
    });

    var undoBtn = document.getElementById('undoBtn');
    if (undoBtn) undoBtn.addEventListener('click', () => this.doUndo());
  }

  go(tab) {
    if (location.hash !== '#' + tab) {
      location.hash = tab;
      return; // hashchange 会再进来一次
    }
    this.route();
  }

  /** 解析 #sites?focus=douban.com 这种深链 */
  route() {
    var raw = String(location.hash || '').replace(/^#/, '');
    var parts = raw.split('?');
    var tab = parts[0] || 'general';
    if (['general', 'sites', 'fields', 'data', 'about'].indexOf(tab) === -1) tab = 'general';

    document.querySelectorAll('.tab').forEach((sec) => {
      sec.hidden = (sec.id !== 'tab-' + tab);
    });
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.setAttribute('aria-current', String(a.dataset.tab === tab));
    });

    var focus = '';
    if (parts[1]) {
      var m = /(?:^|&)focus=([^&]+)/.exec(parts[1]);
      if (m) focus = decodeURIComponent(m[1]);
    }
    if (tab === 'sites' && focus) {
      this.openSites[focus] = true;
      this.renderSites();
      var row = document.querySelector('.site[data-domain="' + focus.replace(/"/g, '') + '"]');
      if (row && row.scrollIntoView) {
        row.scrollIntoView({ block: 'center' });
        var head = row.querySelector('.site-head');
        if (head) head.focus();
      }
    }
  }

  // ============ 通用页 ============

  renderGeneral() {
    var host = document.getElementById('generalGroups');
    if (!host || !SCHEMA) return;
    host.textContent = '';

    SCHEMA.GROUPS.forEach((group) => {
      // v2.9.6：siteOnly 的项只在站点卡片里出现（自动收起的默认值按站点类型算，
      // 摆在通用页会变成一个「看着像全局、实际打不过类型默认」的开关）
      var items = SCHEMA.ITEMS.filter((it) => it.group === group.id && !it.siteOnly);
      if (!items.length) return;

      var wrap = el('div', 'group');
      var head = el('div', 'group-head');
      head.appendChild(el('span', 'group-title', group.title));
      if (group.desc) head.appendChild(el('span', 'group-desc', group.desc));
      wrap.appendChild(head);

      items.forEach((item) => wrap.appendChild(this.buildGlobalRow(item)));
      host.appendChild(wrap);
    });
  }

  buildGlobalRow(item) {
    var row = el('div', 'row');
    row.dataset.key = item.key;

    var main = el('div', 'row-main');
    main.appendChild(el('div', 'row-label', item.label));
    var hint = el('div', 'row-hint', item.hint || '');
    main.appendChild(hint);
    row.appendChild(main);

    var ctrl = el('div', 'row-ctrl');
    var value = this.readGlobal(item.key);

    if (item.type === 'switch') {
      ctrl.appendChild(this.buildSwitch(value, (next) => {
        this.saveGlobal(item, next);
      }, item.label));
    } else if (item.type === 'range') {
      var wrap = el('div', 'slider-wrap');
      var input = document.createElement('input');
      input.type = 'range';
      input.min = item.min;
      input.max = item.max;
      input.step = item.step || 1;
      input.value = value;
      input.setAttribute('aria-label', item.label);
      var val = el('span', 'slider-val', value + (item.unit || ''));
      input.addEventListener('input', () => { val.textContent = input.value + (item.unit || ''); });
      input.addEventListener('change', () => {
        this.saveGlobal(item, parseInt(input.value, 10) || 0);
      });
      wrap.appendChild(input);
      wrap.appendChild(val);
      ctrl.appendChild(wrap);
      row._rangeInput = input;
    } else if (item.type === 'select') {
      var sel = document.createElement('select');
      sel.className = 'pick';
      sel.setAttribute('aria-label', item.label);
      item.options.forEach((o) => {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        sel.appendChild(op);
      });
      sel.value = value;
      sel.addEventListener('change', () => this.saveGlobal(item, sel.value));
      ctrl.appendChild(sel);
      row._select = sel;
    } else if (item.type === 'number') {
      var num = document.createElement('input');
      num.type = 'number';
      num.className = 'num';
      num.min = item.min;
      num.max = item.max;
      num.step = 1;
      num.value = value;
      num.setAttribute('aria-label', item.label);
      // 只在失焦/回车时存：边打字边存会把「1」「12」「1200」都写一遍
      num.addEventListener('change', () => {
        var v = parseInt(num.value, 10);
        if (isNaN(v)) { num.value = this.readGlobal(item.key); return; }
        v = Math.max(item.min || 0, Math.min(item.max, v));
        num.value = v;
        this.saveGlobal(item, v);
      });
      var unit = el('span', 'num-unit', item.unit || '');
      ctrl.appendChild(num);
      if (item.unit) ctrl.appendChild(unit);
      row._numberInput = num;
    }

    row.appendChild(ctrl);
    this.applyDependency(row, item, hint);
    return row;
  }

  /**
   * 依赖项算「不生效」吗（v2.12.11 通用化）。
   * 老规矩：依赖值为真才生效；新规矩：写了 equals 时，依赖值必须**等于那个档位**。
   * 现有两项（延迟 / 复制格式）没写 equals，行为一个字节不变。
   */
  dependencyOff(dep, value) {
    if (!dep) return false;
    if (Object.prototype.hasOwnProperty.call(dep, 'equals')) return value !== dep.equals;
    return !value;
  }

  /** 依赖项不满足时置灰 + 换一句「为什么不生效」 */
  applyDependency(row, item, hintEl) {
    if (!item.dependsOn) return;
    var dep = this.readGlobal(item.dependsOn.key);
    var off = this.dependencyOff(item.dependsOn, dep);
    row.classList.toggle('is-off', off);
    if (hintEl) hintEl.textContent = off ? (item.dependsOn.offHint || item.hint || '') : (item.hint || '');

    var input = row._rangeInput || row._select || row._numberInput || null;
    if (input) input.disabled = off;
    // v2.12.11：「自定义」档的两个小开关本身就是 switch，非 custom 时也要禁用
    var sw = row.querySelector('.sw');
    if (sw) sw.disabled = off;
  }

  buildSwitch(checked, onChange, label) {
    var sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'sw';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(!!checked));
    if (label) sw.setAttribute('aria-label', label);
    sw.addEventListener('click', () => {
      var next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      onChange(next);
    });
    return sw;
  }

  async saveGlobal(item, value) {
    var patch = SCHEMA.buildPatch(this.config, item.key, value);
    var tip = item.label + '：' + this.describe(item, value);
    await this.save(patch, tip);
  }

  describe(item, value) {
    if (item.type === 'switch') return value ? '已开启' : '已关闭';
    if (item.type === 'range') return '已改为 ' + value + (item.unit || '');
    if (item.type === 'select') {
      var hit = item.options.filter((o) => o.value === value)[0];
      return '已改为 ' + (hit ? hit.label : value);
    }
    if (item.type === 'number') {
      return value === 0 ? '已改为不限制' : ('已改为 ' + value + (item.unit || ''));
    }
    return '已保存';
  }

  // ============ 网站页 ============

  renderSites() {
    var host = document.getElementById('siteList');
    if (!host || !SITES) {
      if (host) host.textContent = '站点清单加载失败，请重新打开本页。';
      return;
    }

    var q = this.query.toLowerCase();
    var catalog = SITES.CATALOG.filter((s) => {
      var byName = s.name.toLowerCase().indexOf(q) !== -1;
      var byDomain = SITES.domainsOf(s).some((d) => d.toLowerCase().indexOf(q) !== -1);
      if (q && !byName && !byDomain) return false;

      if (this.filter === 'custom') return this.stateOf(s).hasOwn;
      if (this.filter === 'off') return !SITES.resolve(this.config, s.domain).showButton;
      return true;
    });

    host.textContent = '';
    if (!catalog.length) {
      // v2.9.2：空结果时让吉祥物举着放大镜找一下，比一行灰字更像「我找过了，没有」
      var box = el('div', 'empty');
      var art = el('img', 'empty-art');
      art.src = '../../icons/mascot/hero-search.svg';
      art.alt = '';
      art.draggable = false;
      box.appendChild(art);
      box.appendChild(el('div', null, '没有匹配的站点'));
      host.appendChild(box);
      this.renderCount(0);
      return;
    }

    var self = this;
    SITES.GROUP_ORDER.forEach((group) => {
      var items = catalog.filter((s) => s.group === group);
      if (!items.length) return;

      host.appendChild(el('div', 'site-group-title', group));
      items.forEach((site) => host.appendChild(self.buildSite(site)));
    });

    this.renderCount(catalog.length);
  }

  renderCount(n) {
    var elCount = document.getElementById('siteCount');
    if (!elCount) return;
    var custom = SITES.CATALOG.filter((s) => this.stateOf(s).hasOwn).length;
    var parts = [];
    parts.push('显示 ' + n + ' 个');
    parts.push(custom ? '已单独设置 ' + custom + ' 个' : '全部跟随通用');
    elCount.textContent = parts.join(' · ');
  }

  stateOf(site) {
    var ov = this.config.siteOverrides || {};
    var raw = Object.prototype.hasOwnProperty.call(ov, site.domain) ? ov[site.domain] : undefined;
    var hasOwn = !!raw && typeof raw === 'object';

    var rule = SITES.matchRule(this.config, site.domain);
    var inheritFrom = null;
    if (!hasOwn && rule && rule.toLowerCase() !== site.domain.toLowerCase()) {
      var rv = ov[rule];
      if (rv && typeof rv === 'object') inheritFrom = rule;
    }

    var aliasOwn = SITES.domainsOf(site).filter((d) => {
      if (d.toLowerCase() === site.domain.toLowerCase()) return false;
      var v = ov[d];
      return !!v && typeof v === 'object';
    });

    return { hasOwn: hasOwn, inheritFrom: inheritFrom, rule: rule, aliasOwn: aliasOwn };
  }

  /**
   * 站点卡片 / 站点写入共用的「生效值」（v2.12.11）。
   * resolve() 原本只算 6 个基础开关，站点下拉却按 eff[item.key] 取值 ——
   * 不把空白字段三键并进来，新档位会永远显示成「跟随通用」，两个自定义小开关也恒置灰。
   * 不改 resolve() 本身的返回形状，免得动到别处已有的契约断言。
   */
  effectiveForSite(site) {
    var eff = SITES.resolve(this.config, site.domain);
    var he = SITES.resolveHideEmpty(this.config, site.domain);
    eff.hideEmptyMode = he.mode;
    eff.hideEmptyDisplay = he.display;
    eff.hideEmptyCopy = he.copy;
    return eff;
  }

  buildSite(site) {
    var st = this.stateOf(site);
    var eff = this.effectiveForSite(site);
    var isOpen = !!this.openSites[site.domain];

    var wrap = el('div', 'site' + (st.hasOwn ? ' is-own' : (st.inheritFrom ? ' is-inherit' : '')) + (isOpen ? ' is-open' : ''));
    wrap.dataset.domain = site.domain;

    // ---- 摘要行（点击展开） ----
    var head = el('div', 'site-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', String(isOpen));

    var caret = el('span', 'caret', '›');
    head.appendChild(caret);

    var nameBox = el('div');
    var nameLine = el('span', 'site-name', site.name);
    nameBox.appendChild(nameLine);

    if (st.hasOwn) {
      nameBox.appendChild(document.createTextNode(' '));
      nameBox.appendChild(el('span', 'badge own', '已自定义'));
    } else if (st.inheritFrom) {
      nameBox.appendChild(document.createTextNode(' '));
      var b = el('span', 'badge inherit', '随 ' + st.inheritFrom);
      b.title = '这个站没有自己的规则，跟着 ' + st.inheritFrom + ' 那条走。改任意开关就会为它单建一条。';
      nameBox.appendChild(b);
    }
    if (st.aliasOwn && st.aliasOwn.length) {
      nameBox.appendChild(document.createTextNode(' '));
      var ba = el('span', 'badge alias', st.aliasOwn.join('/') + ' 单独设置');
      ba.title = '这些域名上单独存了设置，改这一行不会覆盖它们。';
      nameBox.appendChild(ba);
    }
    head.appendChild(nameBox);

    var domainEl = el('span', 'site-domain', SITES.domainsOf(site).join(' / '));
    head.appendChild(domainEl);

    var bits = ['提取 ' + (eff.autoExtract ? '开' : '关')];
    if (eff.autoExtract) bits.push('等 ' + eff.autoExtractDelay + '秒');
    bits.push('按钮 ' + (eff.showButton ? '显示' : '隐藏'));
    head.appendChild(el('span', 'site-summary', bits.join(' · ')));

    var toggle = () => {
      this.openSites[site.domain] = !this.openSites[site.domain];
      wrap.classList.toggle('is-open', !!this.openSites[site.domain]);
      head.setAttribute('aria-expanded', String(!!this.openSites[site.domain]));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    wrap.appendChild(head);

    // ---- 展开区 ----
    var body = el('div', 'site-body');

    SCHEMA.siteItems().forEach((item) => {
      body.appendChild(this.buildSiteRow(site, item, eff));
    });

    // 站点专属功能（抖音弹窗、快手推荐流、逐帖按钮…）
    var feats = FLAGS ? FLAGS.forDomain(site.domain) : [];
    if (feats.length) {
      var block = el('div', 'feature-block');
      block.appendChild(el('div', 'feature-title', '这个站专属'));
      feats.forEach((f) => {
        var row = el('div', 'row');
        var main = el('div', 'row-main');
        main.appendChild(el('div', 'row-label', f.label));
        main.appendChild(el('div', 'row-hint', f.hint || ''));
        row.appendChild(main);
        var ctrl = el('div', 'row-ctrl');
        ctrl.appendChild(this.buildSwitch(this.readFeature(f.key), (next) => {
          this.saveFeature(site, f, next);
        }, site.name + ' ' + f.label));
        row.appendChild(ctrl);
        block.appendChild(row);
      });
      body.appendChild(block);
    }

    // ---- 底部操作 ----
    var actions = el('div', 'site-actions');
    var canReset = st.hasOwn || !!st.inheritFrom;
    var resetBtn = el('button', 'link-btn', '恢复跟随通用');
    resetBtn.type = 'button';
    resetBtn.disabled = !canReset;
    if (!canReset) resetBtn.title = '本来就在跟随通用';
    resetBtn.addEventListener('click', () => this.resetSite(site));
    actions.appendChild(resetBtn);

    if (st.aliasOwn && st.aliasOwn.length) {
      actions.appendChild(el('span', 'site-note', '另有 ' + st.aliasOwn.join('/') + ' 上的单独设置，改这一行不影响它们'));
    }
    body.appendChild(actions);

    wrap.appendChild(body);
    return wrap;
  }

  buildSiteRow(site, item, eff) {
    var row = el('div', 'row');
    row.dataset.key = item.key;
    var main = el('div', 'row-main');
    main.appendChild(el('div', 'row-label', item.label));

    var hint = el('div', 'row-hint', item.hint || '');
    main.appendChild(hint);
    row.appendChild(main);

    var ctrl = el('div', 'row-ctrl');
    var rawOv = (this.config.siteOverrides || {})[site.domain];
    // v2.12.11：按「这一项自己的键」判断，不再写死 autoCopyFormat。
    // 站点层每个下拉都有「跟随通用」，本站规则里没这个键就显示「跟随通用」。
    var hasOwnSelect = !!(rawOv && typeof rawOv === 'object' &&
      Object.prototype.hasOwnProperty.call(rawOv, item.key));

    if (item.type === 'switch') {
      ctrl.appendChild(this.buildSwitch(eff[item.key], (next) => {
        this.writeSite(site, item.key, next);
      }, site.name + ' ' + item.label));
    } else if (item.type === 'range') {
      var wrap = el('div', 'slider-wrap');
      var input = document.createElement('input');
      input.type = 'range';
      input.min = item.min;
      input.max = item.max;
      input.step = item.step || 1;
      input.value = eff[item.key];
      input.setAttribute('aria-label', site.name + ' ' + item.label);
      var val = el('span', 'slider-val', input.value + (item.unit || ''));
      input.addEventListener('input', () => { val.textContent = input.value + (item.unit || ''); });
      input.addEventListener('change', () => {
        this.writeSite(site, item.key, parseInt(input.value, 10) || 0);
      });
      wrap.appendChild(input);
      wrap.appendChild(val);
      ctrl.appendChild(wrap);
      row._rangeInput = input;
    } else if (item.type === 'select') {
      var sel = document.createElement('select');
      sel.className = 'pick';
      sel.setAttribute('aria-label', site.name + ' ' + item.label);
      // 站点层多一个「跟随通用」
      var opFollow = document.createElement('option');
      opFollow.value = '';
      opFollow.textContent = '跟随通用';
      sel.appendChild(opFollow);
      item.options.forEach((o) => {
        var op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label;
        sel.appendChild(op);
      });
      sel.value = hasOwnSelect ? eff[item.key] : '';
      sel.addEventListener('change', () => this.writeSite(site, item.key, sel.value));
      ctrl.appendChild(sel);
      row._select = sel;
    }

    row.appendChild(ctrl);
    this.applySiteDependency(row, item, hint, eff);
    return row;
  }

  applySiteDependency(row, item, hintEl, eff) {
    if (!item.dependsOn) return;
    var off = this.dependencyOff(item.dependsOn, eff[item.dependsOn.key]);
    row.classList.toggle('is-off', off);
    if (hintEl) hintEl.textContent = off ? (item.dependsOn.offHint || item.hint || '') : (item.hint || '');
    var input = row._rangeInput || row._select || null;
    if (input) input.disabled = off;
    var sw = row.querySelector('.sw');
    if (sw) sw.disabled = off;
  }

  // ============ 写入：站点 ============

  async writeSite(site, key, value) {
    var eff = this.effectiveForSite(site);
    // v2.12.11：快照统一走 site-config.siteSnapshot() —— 基础五项照旧，
    // 「可跟随键」只在**本站自己那条规则里已经有**时才带上，
    // 否则改一个别的开关就会把全局档位悄悄固化到本站（popup 也是同一份函数）。
    var snapshot = SITES.siteSnapshot(this.config, site.domain, eff);
    var item = SCHEMA.byKey(key);

    if (item && item.type === 'select') {
      // 站点层每个下拉都有「跟随通用」：选它就把这个键删掉，继续跟着上层 / 全局变。
      // 老键 autoCopyFormat 走同一条路，行为与以前一致。
      if (!value) delete snapshot[key];
      else snapshot[key] = (key === 'autoCopyFormat') ? SITES.normalizeCopyFormat(value) : value;
    } else {
      snapshot[key] = value;
    }

    var ov = Object.assign({}, this.config.siteOverrides || {});
    ov[site.domain] = snapshot;

    var label = item ? item.label : key;
    var tip = site.name + '：' + label + ' ' + this.describeValue(item, value, key);
    await this.save({ siteOverrides: ov }, tip);
  }

  describeValue(item, value, key) {
    // v2.12.11：对所有站点层下拉生效，不再只认 autoCopyFormat
    if (item && item.type === 'select') {
      if (!value) return '跟随通用';
      var hit = (item.options || []).filter((o) => o.value === value)[0];
      return '已改为 ' + (hit ? hit.label : value);
    }
    if (item && item.type === 'range') return '已改为 ' + value + (item.unit || '');
    return value ? '已开启' : '已关闭';
  }

  async saveFeature(site, feature, enabled) {
    var patch = { features: Object.assign({}, this.config.features || {}) };
    patch.features[feature.key] = !!enabled;

    // 双写旧键：抖音/快手的内容脚本还在读旧键名，不双写它们就读不到新值
    var extras = {};
    if (feature.legacyKey) extras[feature.legacyKey] = !!enabled;

    var tip = site.name + '：' + feature.label + (enabled ? ' 已开启' : ' 已关闭');
    await this.save(patch, tip, extras);
  }

  async resetSite(site) {
    var ov = Object.assign({}, this.config.siteOverrides || {});
    var raw = Object.prototype.hasOwnProperty.call(ov, site.domain) ? ov[site.domain] : undefined;

    if (raw && typeof raw === 'object') {
      delete ov[site.domain];
    } else {
      // 跟着上层域名规则走：不能删上层（兄弟站还在用），给本站写 null 显式切断
      ov[site.domain] = null;
    }
    await this.save({ siteOverrides: ov }, site.name + ' 已恢复跟随通用');
  }

  // ============ 工具条：搜索 / 筛选 / 批量 ============

  bindToolbar() {
    var search = document.getElementById('siteSearch');
    if (search) {
      search.addEventListener('input', () => {
        this.query = search.value.trim();
        this.renderSites();
      });
    }

    var filter = document.getElementById('siteFilter');
    if (filter) {
      filter.addEventListener('change', () => {
        this.filter = filter.value;
        this.renderSites();
      });
    }

    var bulk = document.getElementById('siteBulk');
    if (bulk) {
      bulk.addEventListener('change', () => {
        var v = bulk.value;
        bulk.value = '';
        if (v) this.bulkApply(v);
      });
    }
  }

  async bulkApply(which) {
    if (!SITES) return;
    var ov = Object.assign({}, this.config.siteOverrides || {});

    if (which === 'follow') {
      if (!confirm('把 23 个站全部恢复成「跟随通用」？\n\n各站的单独设置会被清掉，通用设置不受影响。')) return;
      await this.save({ siteOverrides: {} }, '全部恢复跟随通用');
      return;
    }

    // v2.9.6：批量开关「收起浮窗」。社交站本来就默认开，这里主要是给
    // 「全部关掉」「把非社交站也全开」这种一次性调整用的。
    var dismissWhich = (which === 'dismiss-on' || which === 'dismiss-off');
    if (dismissWhich) {
      var dismissOn = which === 'dismiss-on';
      if (!confirm((dismissOn ? '所有站：换作品时都收起浮窗' : '所有站：都不自动收起浮窗')
        + '？\n\n会给 23 个站各写一条单独设置，覆盖它们原来的开关。')) return;

      SITES.CATALOG.forEach((site) => {
        var effD = SITES.resolve(this.config, site.domain);
        // v2.12.11：统一快照（基础五项 + 本站已有的「可跟随键」），
        // 批量改「自动收起」不会顺手把空白字段的档位固化下来
        var snapD = SITES.siteSnapshot(this.config, site.domain, effD);
        snapD.autoDismiss = dismissOn;
        ov[site.domain] = snapD;
      });

      await this.save({ siteOverrides: ov }, dismissOn ? '所有站：换作品时收起浮窗' : '所有站：不自动收起浮窗');
      return;
    }

    var target = which === 'button-on';
    if (!confirm((target ? '所有站都显示提取按钮' : '所有站都隐藏提取按钮') + '？\n\n会给 23 个站各写一条单独设置，覆盖它们原来的按钮开关。')) return;

    SITES.CATALOG.forEach((site) => {
      var eff = SITES.resolve(this.config, site.domain);
      // v2.12.11：同上，统一快照
      var snapshot = SITES.siteSnapshot(this.config, site.domain, eff);
      snapshot.showButton = target;
      ov[site.domain] = snapshot;
    });

    await this.save({ siteOverrides: ov }, target ? '所有站：按钮已显示' : '所有站：按钮已隐藏');
  }

  // ============ 关于页 ============

  renderAbout() {
    var host = document.getElementById('aboutSites');
    if (!host || !SITES) return;
    var n = document.getElementById('aboutSiteCount');
    if (n) n.textContent = SITES.CATALOG.length + ' 个';

    host.textContent = '';
    SITES.GROUP_ORDER.forEach((group) => {
      var items = SITES.CATALOG.filter((s) => s.group === group);
      if (!items.length) return;
      var box = el('div');
      box.appendChild(el('div', 'about-group-title', group));
      var line = el('div', 'about-site-line');
      items.forEach((s, i) => {
        if (i) line.appendChild(document.createTextNode('　'));
        line.appendChild(el('b', null, s.name));
        line.appendChild(document.createTextNode('  ' + SITES.domainsOf(s).join(' / ')));
      });
      box.appendChild(line);
      host.appendChild(box);
    });
  }

  // ============ 字段页（v2.8.1） ============
  //
  // 排序存 config.fieldOrder[媒体类型]，读它的是浮窗（modal-persistence.applyFieldOrder）。
  // 这里只负责「把已有顺序画出来 + 改它」，不碰渲染逻辑。
  //
  // 字段清单不在本文件里抄第二份 —— 那是 media-types.js 的 MEDIA_FIELD_LISTS，
  // 抄一份就迟早和提取器对不上（历史上抄出过 5 份矛盾的副本）。

  /** 字段页的分区。key 必须和 config.fieldOrder 里的键一致 */
  fieldSections() {
    if (!MEDIA || !MEDIA.MEDIA_FIELD_LISTS) return [];
    var lists = MEDIA.MEDIA_FIELD_LISTS;
    var meta = [
      ['media', '影视', '电影 / 电视剧共用一套'],
      ['book', '书籍', '豆瓣书籍 / 番组书籍 / 起点 / 番茄'],
      ['game', '游戏', '豆瓣游戏 / 番组游戏 / Steam'],
      ['social', '社交媒体', '抖音 / 快手 / 小红书 / Instagram / X / 微博'],
      ['person', '人物档案', '影人与社交账号共用一套顺序，各自只显示自己那几列']
    ];
    var out = [];
    meta.forEach((row) => {
      var list = lists[row[0]];
      if (Array.isArray(list) && list.length) {
        out.push({ key: row[0], title: row[1], desc: row[2], list: list });
      }
    });
    return out;
  }

  /**
   * 当前生效顺序 = 存过的顺序（只留还存在的字段）+ 其余字段按默认顺序补在后面。
   * 口径与浮窗的 applyFieldOrder 一致：失效的旧字段丢掉、新字段排末尾 ——
   * 否则保存一次就会把以后新增的字段永久挤到不存在的位置。
   */
  orderedFields(section) {
    var saved = (this.config.fieldOrder || {})[section.key];
    var out = [];
    if (Array.isArray(saved)) {
      saved.forEach((f) => {
        if (section.list.indexOf(f) !== -1 && out.indexOf(f) === -1) out.push(f);
      });
    }
    section.list.forEach((f) => { if (out.indexOf(f) === -1) out.push(f); });
    return out;
  }

  isFieldOrderCustom(key) {
    return Array.isArray((this.config.fieldOrder || {})[key]);
  }

  renderFields() {
    var host = document.getElementById('fieldGroups');
    if (!host) return;
    host.textContent = '';

    var sections = this.fieldSections();
    if (!sections.length) {
      host.appendChild(el('div', 'empty', '字段清单加载失败，请重新打开本页。'));
      return;
    }

    sections.forEach((section) => {
      var order = this.orderedFields(section);
      var custom = this.isFieldOrderCustom(section.key);

      var group = el('div', 'field-group');
      group.dataset.fieldKey = section.key;

      var head = el('div', 'field-head');
      head.appendChild(el('span', 'field-title', section.title));
      head.appendChild(el('span', 'field-desc', section.desc));
      head.appendChild(el('span', 'field-count', order.length + ' 个'));

      var actions = el('div', 'field-actions');
      if (custom) actions.appendChild(el('span', 'badge own', '已调整'));
      var reset = el('button', 'link-btn', '恢复默认');
      reset.type = 'button';
      reset.disabled = !custom;
      if (!custom) reset.title = '本来就是默认顺序';
      reset.addEventListener('click', () => this.resetFieldOrder(section));
      actions.appendChild(reset);
      head.appendChild(actions);
      group.appendChild(head);

      var body = el('div', 'field-body');
      order.forEach((name, i) => body.appendChild(this.buildFieldRow(section, name, i, order.length)));
      group.appendChild(body);
      host.appendChild(group);
    });
  }

  buildFieldRow(section, name, index, total) {
    var row = el('div', 'field-row');
    row.dataset.field = name;
    row.draggable = true;

    row.appendChild(el('span', 'field-idx', String(index + 1)));
    row.appendChild(el('span', 'field-name', name));

    var ctrl = el('div', 'field-ctrl');

    var up = el('button', 'move-btn', '↑');
    up.type = 'button';
    up.setAttribute('aria-label', '把「' + name + '」上移');
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveField(section, index, index - 1));
    ctrl.appendChild(up);

    var down = el('button', 'move-btn', '↓');
    down.type = 'button';
    down.setAttribute('aria-label', '把「' + name + '」下移');
    down.disabled = index === total - 1;
    down.addEventListener('click', () => this.moveField(section, index, index + 1));
    ctrl.appendChild(down);

    row.appendChild(ctrl);

    // 拖拽：与浮窗里的表头拖拽同一套手感（拖动中半透明，落点画在上/下边）
    row.addEventListener('dragstart', (e) => {
      row.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.setData('text/plain', name);
        e.dataTransfer.effectAllowed = 'move';
      }
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('is-dragging');
      this.clearFieldDropMarks();
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (row.classList.contains('is-dragging')) return;
      var rect = row.getBoundingClientRect();
      var after = (e.clientY - rect.top) > rect.height / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      var after = row.classList.contains('drop-after');
      this.clearFieldDropMarks();
      var dragged = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (dragged && dragged !== name) this.dropField(section, dragged, name, after);
    });

    return row;
  }

  clearFieldDropMarks() {
    document.querySelectorAll('.field-row').forEach((r) => {
      r.classList.remove('drop-before', 'drop-after');
    });
  }

  async moveField(section, from, to) {
    var order = this.orderedFields(section);
    if (to < 0 || to >= order.length || from === to) return;
    var moved = order.splice(from, 1)[0];
    order.splice(to, 0, moved);
    await this.saveFieldOrder(section, order);
  }

  async dropField(section, draggedName, targetName, after) {
    var order = this.orderedFields(section);
    var from = order.indexOf(draggedName);
    if (from < 0) return;
    order.splice(from, 1);
    var target = order.indexOf(targetName);
    if (target < 0) return;
    order.splice(after ? target + 1 : target, 0, draggedName);
    await this.saveFieldOrder(section, order);
  }

  async saveFieldOrder(section, order) {
    // 整份 fieldOrder 写回（后台顶层是整体替换），所以必须带上别的类型的顺序
    var next = Object.assign({}, this.config.fieldOrder || {});
    next[section.key] = order;
    await this.save({ fieldOrder: next }, section.title + ' 字段顺序已保存');
  }

  async resetFieldOrder(section) {
    var next = Object.assign({}, this.config.fieldOrder || {});
    delete next[section.key];
    await this.save({ fieldOrder: next }, section.title + ' 已恢复默认顺序');
  }

  // ============ 数据页（v2.8.1） ============
  //
  // 四件事，各自独立：
  //   缓存 —— 走后台 clearCacheOnly，只删缓存键，不碰 config
  //   导出 —— 只导设置（不含缓存），生成 JSON 让浏览器下载
  //   导入 —— 先解析校验、把要覆盖的东西列出来，用户确认后才写
  //   重置 —— 网站 / 功能开关 / 字段顺序 三档，各删各的

  renderData() {
    this.refreshCacheInfo();
    this.renderResetList();
    this.bindDataActions();
  }

  async refreshCacheInfo() {
    var box = document.getElementById('cacheInfo');
    if (!box) return;
    var stats = null;
    try {
      var res = await WBR.runtime.sendMessage({ action: 'getCacheStats' });
      stats = (res && res.stats) ? res.stats : null;
    } catch (e) { stats = null; }

    if (!stats || typeof stats.entries !== 'number') {
      box.textContent = '读不到缓存信息';
      return;
    }
    this.cacheStats = stats;
    box.textContent = stats.entries
      ? stats.entries + ' 条 · ' + this.formatBytes(stats.bytes)
      : '没有缓存';
  }

  formatBytes(n) {
    var v = Number(n) || 0;
    if (v < 1024) return v + ' B';
    if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB';
    return (v / 1024 / 1024).toFixed(2) + ' MB';
  }

  bindDataActions() {
    var self = this;
    var pair = [
      ['clearCacheBtn', () => self.clearCacheOnly()],
      ['exportBtn', () => self.exportSettings()],
      ['importBtn', () => { var f = document.getElementById('importFile'); if (f) f.click(); }]
    ];
    pair.forEach((p) => {
      var btn = document.getElementById(p[0]);
      if (btn && !btn._cmBound) { btn._cmBound = true; btn.addEventListener('click', p[1]); }
    });

    var file = document.getElementById('importFile');
    if (file && !file._cmBound) {
      file._cmBound = true;
      file.addEventListener('change', () => {
        var f = file.files && file.files[0];
        file.value = '';           // 允许连续选同一个文件
        if (f) this.readImportFile(f);
      });
    }
  }

  renderResetList() {
    var host = document.getElementById('resetList');
    if (!host) return;
    host.textContent = '';

    var card = el('div', 'card');
    this.resetEntries().forEach((entry) => {
      var row = el('div', 'card-row reset-item');
      row.dataset.reset = entry.id;
      row.appendChild(el('span', 'card-label', entry.label));
      row.appendChild(el('span', 'reset-desc', entry.desc));
      var btn = el('button', 'btn danger', entry.action);
      btn.type = 'button';
      btn.addEventListener('click', () => this.resetBlock(entry.id));
      row.appendChild(btn);
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  resetEntries() {
    return [
      { id: 'sites', label: '网站设置', desc: '所有站点的单独设置清掉，回到「跟随通用」', action: '清空' },
      { id: 'features', label: '功能开关', desc: '抖音弹窗、快手推荐流、逐帖按钮等回到默认（全开）', action: '重置' },
      { id: 'fields', label: '字段顺序', desc: '所有类型回到默认顺序', action: '重置' }
    ];
  }

  async resetBlock(id) {
    if (id === 'sites') {
      if (!confirm('清掉所有站点的单独设置？\n\n通用设置不受影响。')) return;
      await this.save({ siteOverrides: {} }, '网站设置已全部重置');
      return;
    }

    if (id === 'fields') {
      if (!confirm('所有类型的字段顺序回到默认？')) return;
      await this.save({ fieldOrder: {} }, '字段顺序已重置');
      return;
    }

    if (id === 'features') {
      if (!confirm('功能开关回到默认（全开）？')) return;
      var keys = FLAGS ? FLAGS.legacyKeys() : [];
      try {
        var res = await WBR.runtime.sendMessage({ action: 'resetFeatures', legacyKeys: keys });
        if (res && res.success === false) throw new Error(res.error || '后台拒绝写入');
      } catch (e) {
        this.toast('重置失败：' + ((e && e.message) || '未知错误'), true);
        return;
      }
      this.config.features = {};
      this.legacy = {};
      this.undo = null;
      this.rerender();
      this.showSaved('功能开关已重置', false);
    }
  }

  async clearCacheOnly() {
    if (!confirm('清除全部提取缓存？\n\n设置、站点规则、字段顺序都不会变。')) return;
    var btn = document.getElementById('clearCacheBtn');
    if (btn) btn.disabled = true;
    try {
      var res = await WBR.runtime.sendMessage({ action: 'clearCacheOnly' });
      if (res && res.success === false) throw new Error(res.error || '后台拒绝写入');
      var r = (res && res.result) || {};
      if (!r.removed) this.toast('本来就没有缓存');
      else {
        this.toast('已清除 ' + r.removed + ' 条缓存' +
          (r.bytes ? '（' + this.formatBytes(r.bytes) + '）' : ''));
      }
    } catch (e) {
      this.toast('清除失败：' + ((e && e.message) || '未知错误'), true);
    } finally {
      if (btn) btn.disabled = false;
      this.refreshCacheInfo();
    }
  }

  /** 导出内容：只放设置，不放缓存（缓存是机器生成的，换个设备就该重算） */
  buildExportPayload() {
    var ver = '';
    try { ver = WBR.runtime.getManifest().version; } catch (e) { ver = ''; }
    return {
      app: 'clipmate',
      kind: 'settings',
      version: ver,
      exportedAt: new Date().toISOString(),
      config: deepClone(this.config)
    };
  }

  async exportSettings() {
    var payload = this.buildExportPayload();
    var name = 'clipmate-settings-' + String(payload.exportedAt).slice(0, 10) + '.json';
    if (this.downloadJson(payload, name)) {
      this.toast('已导出设置文件');
    } else {
      this.toast('导出失败：当前环境不支持下载', true);
    }
  }

  downloadJson(obj, filename) {
    try {
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' ||
          typeof URL.createObjectURL !== 'function') return false;
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ } }, 4000);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 校验导入内容：既认本页导出的文件，也认直接给的裸 config */
  validateImport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, reason: '文件内容不是一个 JSON 对象' };
    }
    var cfg = null;
    if (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) cfg = raw.config;
    else if (raw.siteOverrides || raw.features || raw.fieldOrder ||
             raw.autoExtract !== undefined || raw.showButton !== undefined) cfg = raw;

    if (!cfg) return { ok: false, reason: '没有找到设置内容（不像是本扩展导出的文件）' };

    var known = ['autoExtract', 'autoExtractDelay', 'autoCopy', 'autoCopyFormat', 'showButton',
      'siteOverrides', 'features', 'fieldOrder', 'fieldMappings', 'settings', 'theme'];
    var hits = known.filter((k) => Object.prototype.hasOwnProperty.call(cfg, k));
    if (!hits.length) return { ok: false, reason: '设置里没有任何能识别的项' };

    return { ok: true, config: cfg, hits: hits };
  }

  summarizeImport(cfg) {
    var parts = [];
    var sites = (cfg.siteOverrides && typeof cfg.siteOverrides === 'object')
      ? Object.keys(cfg.siteOverrides).length : 0;
    if (sites) parts.push(sites + ' 个站点设置');

    var feats = (cfg.features && typeof cfg.features === 'object')
      ? Object.keys(cfg.features).length : 0;
    if (feats) parts.push(feats + ' 个功能开关');

    var orders = (cfg.fieldOrder && typeof cfg.fieldOrder === 'object')
      ? Object.keys(cfg.fieldOrder).length : 0;
    if (orders) parts.push(orders + ' 套字段顺序');

    if (SCHEMA) {
      SCHEMA.ITEMS.forEach((it) => {
        if (Object.prototype.hasOwnProperty.call(cfg, it.path[0])) parts.push(it.label);
      });
    }
    return parts.length ? parts.join('、') : '（没有可识别的具体项）';
  }

  readImportFile(file) {
    var box = document.getElementById('importPreview');
    var row = document.getElementById('importPreviewRow');
    var show = (text, bad) => {
      if (!box || !row) return;
      box.textContent = text;
      box.classList.toggle('is-bad', !!bad);
      row.hidden = false;
    };

    var reader = new FileReader();
    reader.onerror = () => show('读取文件失败', true);
    reader.onload = () => {
      var raw = null;
      try { raw = JSON.parse(String(reader.result || '')); } catch (e) { raw = null; }
      if (raw === null) { show('不是有效的 JSON 文件', true); return; }

      var v = this.validateImport(raw);
      if (!v.ok) { show('无法导入：' + v.reason, true); return; }

      var summary = this.summarizeImport(v.config);
      show('将导入：' + summary + '。确认后会覆盖同名设置。', false);

      var go = confirm('导入这份设置？\n\n' + summary +
        '\n\n同名设置会被覆盖，这份文件里没有的设置保持不动。');
      if (!go) { show('已取消导入（内容未改动）', false); return; }
      this.applyImport(v.config, summary);
    };
    reader.readAsText(file);
  }

  async applyImport(cfg, summary) {
    var box = document.getElementById('importPreview');
    try {
      var res = await WBR.runtime.sendMessage({ action: 'saveConfig', config: cfg });
      if (res && res.success === false) throw new Error(res.error || '后台拒绝写入');
    } catch (e) {
      if (box) {
        box.textContent = '导入失败：' + ((e && e.message) || '未知错误');
        box.classList.add('is-bad');
      }
      this.toast('导入失败', true);
      return;
    }

    // 导入的是整份 config，本地状态直接以它为准（不要 merge 出半新半旧）
    this.config = Object.assign({}, this.config, cfg);
    if (!this.config.siteOverrides || typeof this.config.siteOverrides !== 'object') this.config.siteOverrides = {};
    if (!this.config.features || typeof this.config.features !== 'object') this.config.features = {};
    if (!this.config.fieldOrder || typeof this.config.fieldOrder !== 'object') this.config.fieldOrder = {};

    // 旧独立键也要跟上（导入文件里没有它们，按新位置回填一次）
    await this.syncLegacyFromFeatures();

    this.undo = null;
    this.rerender();
    this.refreshCacheInfo();
    if (box) {
      box.textContent = '已导入：' + summary;
      box.classList.remove('is-bad');
    }
    this.showSaved('设置已导入', false);
  }

  /** 把 config.features 逐个回写到旧独立键，保证新老代码看到同一个值 */
  async syncLegacyFromFeatures() {
    if (!FLAGS) return;
    var extras = {};
    FLAGS.FEATURES.forEach((f) => {
      if (f.legacyKey) extras[f.legacyKey] = this.readFeature(f.key);
    });
    if (!Object.keys(extras).length) return;
    try {
      await WBR.runtime.sendMessage({ action: 'saveConfig', config: {}, extras: extras });
      Object.keys(extras).forEach((k) => { this.legacy[k] = extras[k]; });
    } catch (e) { /* 回填失败不影响导入本身 */ }
  }

  // ============ 保存 / 撤销 ============

  /**
   * @param {Object} patch    交给 background 的配置补丁
   * @param {string} tip      提示文案
   * @param {Object} [extras] 需要同时写入的其他顶层存储键（抖音/快手旧键）
   */
  async save(patch, tip, extras) {
    var prev = {};
    Object.keys(patch).forEach((k) => { prev[k] = deepClone(this.config[k]); });
    if (prev.siteOverrides === undefined) prev.siteOverrides = {};
    if (prev.features === undefined) prev.features = {};
    if (prev.settings === undefined) prev.settings = {};

    // 旧键的旧值也要记下来，否则撤销时 config 回退了、旧键还停在改后的值
    var prevExtras = {};
    Object.keys(extras || {}).forEach((k) => { prevExtras[k] = this.legacy[k]; });

    try {
      var msg = { action: 'saveConfig', config: patch };
      if (extras && Object.keys(extras).length) msg.extras = extras;
      var res = await WBR.runtime.sendMessage(msg);
      if (res && res.success === false) throw new Error(res.error || '后台拒绝写入');
    } catch (e) {
      this.toast('保存失败：' + ((e && e.message) || '未知错误'), true);
      return false;
    }

    this.config = mergeLocal(this.config, patch);
    Object.keys(extras || {}).forEach((k) => { this.legacy[k] = extras[k]; });

    this.rerender();
    this.undo = { patch: patch, prev: prev, prevExtras: prevExtras };
    this.showSaved(tip, true);
    return true;
  }

  rerender() {
    this.applyTheme();
    this.renderGeneral();
    this.renderSites();
    this.renderFields();
  }

  async doUndo() {
    if (!this.undo) return;
    var patch = this.undo.prev;
    var prevExtras = this.undo.prevExtras || {};

    // 撤销就是把这些顶层键写回旧值（浅合并足够，都是顶层键）
    var restore = {};
    Object.keys(patch).forEach((k) => {
      var v = patch[k];
      restore[k] = (v === undefined || v === null) ? {} : v;
    });

    // 旧键一起回退：没设过（undefined）就写回「缺省 = 开」的语义
    var extras = {};
    Object.keys(prevExtras).forEach((k) => {
      extras[k] = (prevExtras[k] === undefined) ? true : prevExtras[k];
    });

    this.undo = null;
    try {
      var msg = { action: 'saveConfig', config: restore };
      if (Object.keys(extras).length) msg.extras = extras;
      await WBR.runtime.sendMessage(msg);
    } catch (e) {
      this.toast('撤销失败：' + ((e && e.message) || '未知错误'), true);
      return;
    }
    this.config = mergeLocal(this.config, restore);
    Object.keys(extras).forEach((k) => { this.legacy[k] = extras[k]; });
    this.rerender();
    this.showSaved('已撤销', false);
  }

  showSaved(text, canUndo) {
    var bar = document.getElementById('saveBar');
    var t = document.getElementById('saveText');
    var btn = document.getElementById('undoBtn');
    if (!bar) return;
    bar.classList.remove('error');
    if (t) t.textContent = text || '已保存';
    if (btn) btn.hidden = !canUndo;
    bar.classList.add('on');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      bar.classList.remove('on');
      this.undo = null;
    }, UNDO_MS);
  }

  toast(text, isError) {
    var bar = document.getElementById('saveBar');
    var t = document.getElementById('saveText');
    var btn = document.getElementById('undoBtn');
    if (!bar) return;
    if (t) t.textContent = text;
    if (btn) btn.hidden = true;
    bar.classList.toggle('error', !!isError);
    bar.classList.add('on');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => bar.classList.remove('on'), isError ? 4200 : 1800);
  }
}

// 工具条的事件要在建页时绑一次
var page = new SettingsPage();
page.bindToolbar();
