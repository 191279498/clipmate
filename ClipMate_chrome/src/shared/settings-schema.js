// 设置项定义 —— 唯一事实来源（v2.8.0）
//
// 【为什么要有这个文件】
//   重做设置页之前，同一批设置在两个地方各写了一遍：
//     · popup.js   自己写 LABELS / FORMAT_OPTIONS / 主题三选一
//     · options.js 自己写 LABELS / FORMAT_OPTIONS
//   结果两边漂移了：popup 的本站设置有「延迟滑块」，设置页的站点行没有；
//   以后再加一项还得记得改两处，漏一处就是新的漂移。
//
//   现在所有「有哪些设置项、叫什么、默认值多少、依赖谁」都在这里，
//   options 页按这份定义渲染，popup（三期精简时）也按同一份渲染。
//
// 【加新设置项的规矩】
//   1. 只在 ITEMS 里加一条，不要在页面里手写控件；
//   2. `path` 是这个值在 config 里的位置，嵌套就写数组（如 ['settings','enableCache']）；
//   3. 只有**真的生效**的项才允许写进来 —— 放了开关却没人读，等于骗用户；
//   4. siteOverridable: true 的项才会出现在站点卡片里（站点覆盖目前只支持 5 项）。
(function (global) {
  'use strict';

  // ---------- 从 config 里按 path 取值 ----------
  function getPath(obj, path) {
    var cur = obj;
    for (var i = 0; i < path.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[path[i]];
    }
    return cur;
  }

  /** 把 config 写成 { 'settings.enableCache': false } 这种扁平形式，便于逐项比较 */
  function flatten(config) {
    var out = {};
    for (var i = 0; i < ITEMS.length; i++) {
      var it = ITEMS[i];
      out[it.path.join('.')] = read(config, it);
    }
    return out;
  }

  /** 读一个设置项的真实值（缺字段 / 脏值都回退 default） */
  function read(config, item) {
    var raw = getPath(config, item.path);
    if (item.type === 'switch') {
      if (raw === undefined || raw === null) return item.default;
      return !!raw;
    }
    if (item.type === 'range') {
      var n = parseInt(raw, 10);
      if (isNaN(n)) return item.default;
      return Math.max(item.min, Math.min(item.max, n));
    }
    if (item.type === 'number') {
      var n2 = parseInt(raw, 10);
      if (isNaN(n2)) return item.default;
      var lo = (item.min === undefined) ? 0 : item.min;
      var hi = (item.max === undefined) ? Number.MAX_SAFE_INTEGER : item.max;
      return Math.max(lo, Math.min(hi, n2));
    }
    if (item.type === 'select') {
      for (var i = 0; i < item.options.length; i++) {
        if (item.options[i].value === raw) return raw;
      }
      return item.default;
    }
    return (raw === undefined || raw === null) ? item.default : raw;
  }

  /**
   * 生成「只改这一项」的配置补丁（可直接交给 background 的 saveConfig）。
   * 嵌套项（settings.xxx）会带上同级兄弟值，避免浅合并时把兄弟键吃掉。
   */
  function buildPatch(config, key, value) {
    var item = byKey(key);
    if (!item) return null;

    // 从叶子往上逐层包，每一层都把「同层兄弟键」原样带上 ——
    // 后台 saveConfig 是浅合并，少带一个兄弟键就等于把它删了。
    // 支持任意深度（settings.enableCache 两层、settings.descLimits.social 三层）。
    var cur = value;
    for (var i = item.path.length - 1; i >= 0; i--) {
      var layer = {};
      if (i > 0) {
        var parent = getPath(config, item.path.slice(0, i));
        if (parent && typeof parent === 'object') {
          for (var k in parent) {
            if (Object.prototype.hasOwnProperty.call(parent, k)) layer[k] = parent[k];
          }
        }
      }
      layer[item.path[i]] = cur;
      cur = layer;
    }
    return cur;
  }

  // ---------- 设置项清单 ----------
  // group 顺序即通用页里的分组顺序
  var ITEMS = [
    {
      key: 'autoExtract',
      group: 'extract',
      label: '打开页面时自动提取',
      hint: '每个页面只跑一次，不监听页面变化',
      type: 'switch',
      path: ['autoExtract'],
      default: false,
      siteOverridable: true
    },
    {
      key: 'autoExtractDelay',
      group: 'extract',
      label: '等待页面加载',
      hint: '页面越慢，等待越久',
      type: 'range',
      path: ['autoExtractDelay'],
      default: 3,
      min: 0,
      max: 20,
      step: 1,
      unit: '秒',
      siteOverridable: true,
      dependsOn: {
        key: 'autoExtract',
        offHint: '自动提取关着，这一项现在不生效'
      }
    },
    {
      key: 'autoCopy',
      group: 'copy',
      label: '提取后自动复制',
      hint: '复制到剪贴板，内容与手动复制一致',
      type: 'switch',
      path: ['autoCopy'],
      default: false,
      siteOverridable: true
    },
    {
      key: 'autoCopyFormat',
      group: 'copy',
      label: '复制格式',
      hint: '自动复制用哪种格式；手动复制的三个按钮不受影响',
      type: 'select',
      path: ['autoCopyFormat'],
      default: 'markdown',
      options: [
        { value: 'notion', label: 'Notion' },
        { value: 'markdown', label: 'Markdown' },
        { value: 'plaintext', label: '纯文本' }
      ],
      siteOverridable: true,
      dependsOn: {
        key: 'autoCopy',
        offHint: '自动复制关着，这一项先存着，开了才生效'
      }
    },
    {
      key: 'showButton',
      group: 'ui',
      label: '显示悬浮提取按钮',
      hint: '在页面上显示那颗悬浮按钮。关掉后可以从这里或 popup 重新打开',
      type: 'switch',
      path: ['showButton'],
      default: true,
      siteOverridable: true
    },
    {
      key: 'theme',
      group: 'ui',
      label: '界面主题',
      hint: '只影响这个设置页和扩展弹窗；页面上的浮窗暂不跟随（下一版做）',
      type: 'select',
      path: ['theme'],
      default: 'system',
      options: [
        { value: 'system', label: '跟随系统' },
        { value: 'light', label: '浅色' },
        { value: 'dark', label: '深色' }
      ]
    },
    {
      key: 'enableCache',
      group: 'perf',
      label: '启用缓存',
      hint: '缓存提取结果；关掉后每次点按钮都重新读页面',
      type: 'switch',
      path: ['settings', 'enableCache'],
      default: true,
      siteOverridable: false
    },
    // 简介长度（v2.8.2）：把原来写死在 data-processors.js 的三个数搬成设置项。
    // 默认值与搬之前一模一样 —— 19 个样本快照必须零差异，否则就是改错了。
    {
      key: 'descSocial',
      group: 'content',
      label: '社交账号简介',
      hint: '最多保留多少字。填 0 表示不限制（抖音、微博等主页签名）',
      type: 'number',
      path: ['settings', 'descLimits', 'social'],
      default: 50000,
      min: 0,
      max: 200000,
      unit: '字'
    },
    {
      key: 'descPerson',
      group: 'content',
      label: '影人简介',
      hint: '豆瓣影人这类长简介的上限，默认 5000 字',
      type: 'number',
      path: ['settings', 'descLimits', 'person'],
      default: 5000,
      min: 0,
      max: 200000,
      unit: '字'
    },
    {
      key: 'descOther',
      group: 'content',
      label: '其他简介',
      hint: '影视、书籍、游戏条目的简介是附注，默认只留 500 字',
      type: 'number',
      path: ['settings', 'descLimits', 'other'],
      default: 500,
      min: 0,
      max: 200000,
      unit: '字'
    }
  ];

  var GROUPS = [
    { id: 'extract', title: '提取', desc: '打开网页时要不要自动干活' },
    { id: 'copy', title: '复制', desc: '提取完自动复制成什么样子' },
    { id: 'content', title: '内容', desc: '提取结果保留多少' },
    { id: 'ui', title: '界面', desc: '页面上看得见的东西' },
    { id: 'perf', title: '性能', desc: '缓存与重复读取' }
  ];

  function byKey(key) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].key === key) return ITEMS[i];
    }
    return null;
  }

  /** 站点卡片里能单独设的项（顺序即卡片里的显示顺序） */
  function siteItems() {
    var out = [];
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].siteOverridable) out.push(ITEMS[i]);
    }
    return out;
  }

  var api = {
    ITEMS: ITEMS,
    GROUPS: GROUPS,
    byKey: byKey,
    read: read,
    getPath: getPath,
    flatten: flatten,
    buildPatch: buildPatch,
    siteItems: siteItems
  };

  global.ClipMateSettings = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
