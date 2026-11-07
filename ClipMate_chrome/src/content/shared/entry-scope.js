/**
 * 社交站「入口场景」通用层（v2.12.9）
 *
 * 一句话：同一个按钮在社交站有两种身份 —— 作者档案页的「整理档案」(profile)
 * 和作品/弹层的「提取」(work)。以前这两种身份共用一份按钮位置、一份浮窗横竖、
 * 一份「用户拖过」标记，于是在档案页调一下，弹层跟着变；在弹层调一下，回主页又串回去。
 *
 * 这一层只做三件事：
 *   ① 认站点：只认「社交」分组 9 站，其它分组一律返回「未启用」，调用方保持原行为；
 *   ② 认入口：换肤（arch/default）为主信号，本次提取的字段模板（person/social）为兜底校准，
 *      **绝不按网址判**（快手弹层地址不变、抖音会抹 modal_id，网址判不准）；
 *   ③ 分桶：位置 / 横竖 / 用户拖过标记都按「站点 + 入口」分开存，且**长期落盘**。
 *
 * 「当前是哪种入口」本身**不落盘**：它是页面事实，刷新后由页面重新判定。
 * 要是把它也记住，明天打开一个作品页会顶着「整理档案」的脸。
 *
 * 存储说明：按钮位置原本就在 localStorage（按域名），浮窗横竖原本在扩展存储
 * `clipmate_ui_prefs`。本层**完全不碰** `clipmate_ui_prefs`，另起一个独立键
 * `clipmate_entry_prefs`（localStorage，同步读写，关浏览器仍在）。老键
 * `clipmate-button-position-<host>` 只做一次性只读兜底迁移，不删不覆盖。
 */
(function (global) {
  'use strict';

  // 与 src/shared/site-config.js 的「社交」分组一一对应。
  // 用后缀匹配，让 www. / m. / space. / s. 这些子域都归一到同一个站点键。
  var SITES = [
    { key: 'bilibili', hosts: ['bilibili.com'] },
    { key: 'douyin', hosts: ['douyin.com'] },
    { key: 'kuaishou', hosts: ['kuaishou.com'] },
    { key: 'xiaohongshu', hosts: ['xiaohongshu.com'] },
    { key: 'weibo', hosts: ['weibo.com', 'weibo.cn'] },
    { key: 'x', hosts: ['x.com'] },
    { key: 'instagram', hosts: ['instagram.com'] },
    { key: 'youtube', hosts: ['youtube.com'] },
    { key: 'tiktok', hosts: ['tiktok.com'] }
  ];

  var SCOPES = ['profile', 'work'];
  var PREF_KEY = 'clipmate_entry_prefs';
  var LEGACY_PREFIX = 'clipmate-button-position-';
  var MIGRATED_PREFIX = 'clipmate-entry-migrated-';
  var USERMOVED_PREFIX = 'clipmate-button-usermoved-';

  // 当前入口（运行时事实，不落盘）。'' = 页面刚加载、还没判定。
  var _scope = '';

  // localStorage 在个别测试环境里不可用 → 降级到内存，功能不炸。
  var mem = Object.create(null);
  function lsGet(key) {
    try { return global.localStorage.getItem(key); }
    catch (e) { return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : null; }
  }
  function lsSet(key, value) {
    try { global.localStorage.setItem(key, value); }
    catch (e) { mem[key] = value; }
  }

  function hostOf() {
    try { return String((global.location && global.location.hostname) || '').toLowerCase(); }
    catch (e) { return ''; }
  }

  /** 站点键；非社交站返回 ''。传参只为单测方便，线上走 location。 */
  function siteKeyOf(host) {
    var h = String(host || hostOf()).toLowerCase();
    if (!h) return '';
    for (var i = 0; i < SITES.length; i++) {
      for (var j = 0; j < SITES[i].hosts.length; j++) {
        var s = SITES[i].hosts[j];
        if (h === s || h.slice(-(s.length + 1)) === '.' + s) return SITES[i].key;
      }
    }
    return '';
  }

  function enabled(host) { return siteKeyOf(host) !== ''; }

  /** 分桶名：'<站点>@<入口>'，非社交站返回 ''。 */
  function bucket(scope) {
    var site = siteKeyOf();
    if (!site) return '';
    return site + '@' + (SCOPES.indexOf(scope) !== -1 ? scope : effectiveScope());
  }

  /** 老位置只迁移一次：两个抽屉都拿到同一份旧值，之后各走各的，互不干扰。 */
  function migrateLegacy() {
    var site = siteKeyOf();
    if (!site) return false;
    var marker = MIGRATED_PREFIX + site;
    if (lsGet(marker)) return false;
    lsSet(marker, '1');
    var legacy = lsGet(LEGACY_PREFIX + hostOf());
    if (legacy == null) return false;
    for (var i = 0; i < SCOPES.length; i++) {
      var key = LEGACY_PREFIX + site + '@' + SCOPES[i];
      if (lsGet(key) == null) lsSet(key, legacy);
    }
    return true;
  }

  /** 按钮位置键。非社交站 = 老键，一个字节都不改。 */
  function positionKey(scope) {
    var host = hostOf();
    if (!enabled(host)) return LEGACY_PREFIX + host;
    migrateLegacy();
    return LEGACY_PREFIX + siteKeyOf(host) + '@' + (SCOPES.indexOf(scope) !== -1 ? scope : effectiveScope());
  }

  function readUserMoved(scope) {
    if (!enabled()) return null;                 // null = 别动调用方的旧值
    var v = lsGet(USERMOVED_PREFIX + bucket(scope));
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  }

  function writeUserMoved(scope, value) {
    if (!enabled() || SCOPES.indexOf(scope) === -1) return false;
    lsSet(USERMOVED_PREFIX + bucket(scope), value ? '1' : '0');
    return true;
  }

  function readLayout(scope) {
    if (!enabled()) return '';
    var raw = lsGet(PREF_KEY);
    if (!raw) return '';
    try {
      var prefs = JSON.parse(raw) || {};
      var entry = prefs[bucket(scope)];
      return (entry && (entry.layout === 'horizontal' || entry.layout === 'vertical')) ? entry.layout : '';
    } catch (e) { return ''; }
  }

  function writeLayout(scope, layout) {
    if (!enabled() || SCOPES.indexOf(scope) === -1) return false;
    if (layout !== 'horizontal' && layout !== 'vertical') return false;
    var prefs = {};
    try { prefs = JSON.parse(lsGet(PREF_KEY) || '{}') || {}; }
    catch (e) { prefs = {}; }
    prefs[bucket(scope)] = { layout: layout };
    lsSet(PREF_KEY, JSON.stringify(prefs));
    return true;
  }

  /** 档案列少 → 横向一屏看全；作品列多 → 纵向。用户手动切过的值优先。 */
  function defaultLayout(scope) { return scope === 'profile' ? 'horizontal' : 'vertical'; }

  function current() { return _scope; }
  function effectiveScope() { return _scope || 'work'; }

  /**
   * 切换入口。返回 {from,to,changed} 供调用方把按钮位置/皮肤显式恢复过去；
   * 非社交站一律返回 null —— 调用方走原路径，零回归。
   */
  function set(scope) {
    if (!enabled() || SCOPES.indexOf(scope) === -1) return null;
    var from = _scope;
    _scope = scope;
    return { from: from, to: scope, changed: from !== scope };
  }

  /** 主信号：换肤。arch = 档案，default = 作品。 */
  function scopeFromSkin(skin) { return skin === 'arch' ? 'profile' : 'work'; }
  function onSkin(skin) { return set(scopeFromSkin(skin)); }

  /** 兜底校准：本次提取实际用的字段模板（UniversalFieldMapper.mediaType）。 */
  function confirm(mapperType) {
    if (mapperType === 'person') return set('profile');
    if (mapperType === 'social') return set('work');
    return null;
  }

  /** 只给单测重置运行时状态用；落盘数据一律不动。 */
  function resetRuntime() { _scope = ''; }

  global.ClipMateEntryScope = {
    SITES: SITES,
    SCOPES: SCOPES,
    PREF_KEY: PREF_KEY,
    siteKeyOf: siteKeyOf,
    enabled: enabled,
    bucket: bucket,
    positionKey: positionKey,
    migrateLegacy: migrateLegacy,
    readUserMoved: readUserMoved,
    writeUserMoved: writeUserMoved,
    readLayout: readLayout,
    writeLayout: writeLayout,
    defaultLayout: defaultLayout,
    current: current,
    effectiveScope: effectiveScope,
    set: set,
    scopeFromSkin: scopeFromSkin,
    onSkin: onSkin,
    confirm: confirm,
    resetRuntime: resetRuntime
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = global.ClipMateEntryScope;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
