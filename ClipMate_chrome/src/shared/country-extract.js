/**
 * 从「出生地」里抽出国家（v2.7.11，人物档案专用）
 *
 * 背景
 * ----
 * 人物档案里只有一列「国家」，但四个站给的都是**出生地**：
 *   豆瓣影人 `美国纽约州`、IMDb `New York City, New York, USA`、
 *   TMDB `New York City, New York, United States`、Bangumi `東京都`。
 * 所以要一个「地名 → 国家」的抽取器。
 *
 * 已有的 `country-names.js` 只做**整串精确匹配**（`美国` → 美国），
 * 拿到 `美国纽约州` 就查不到了，因此单独写这一层。
 *
 * 三条匹配规则（顺序即优先级）
 * ---------------------------
 *   ① 整串精确      `美国`              → 美国
 *   ② 分段精确      `纽约，美国`         → 美国（按 , ，、/ ; ； | 与两个以上空格切段）
 *                   `中国,香港`          → 中国香港（命中「中国」时让位给更具体的地区段，见 v2.7.12 注释）
 *   ③ 分段 / 整串前缀（最长优先）
 *                  `美国纽约州`         → 美国
 *                  `New York, NY, USA` → 美国（第三段精确命中）
 *
 * **绝不做「任意位置包含」，只做「开头」与「整段」。**
 * 这是这类抽取最典型的假阳性来源：`新墨西哥州` 整串包含「墨西哥」，
 * 用包含匹配会把美国新墨西哥州判成墨西哥。前缀 / 分段天然挡住这种错。
 *
 * 抽不出就返回空串 —— 用户 2026-10-30 明确要求「没有就留空」，
 * 不许把 `好莱坞` 这种城市名塞进「国家」列。
 *
 * 依赖：`country-names.js`（浏览器里是 window.CountryNames，Node 里走 require）
 */
(function (global) {
  'use strict';

  /** 与 country-names.js 的 _normCountryKey 保持同款：去点、合并空格、小写、去末尾标点 */
  function norm(raw) {
    return String(raw === null || raw === undefined ? '' : raw)
      .replace(/[\u3000\s]+/g, ' ')
      .trim()
      .replace(/\./g, '')
      .replace(/[，、;；:：]+$/, '')
      .toLowerCase();
  }

  /** 取国家表：浏览器用全局，Node 用 require */
  function getTable() {
    try {
      if (global && global.CountryNames && Array.isArray(global.CountryNames.COUNTRY_TABLE)) {
        return global.CountryNames.COUNTRY_TABLE;
      }
    } catch (e) { /* 落到下面的 require */ }
    try {
      if (typeof require === 'function') {
        var mod = require('./country-names.js');
        if (mod && Array.isArray(mod.COUNTRY_TABLE)) return mod.COUNTRY_TABLE;
      }
    } catch (e) { /* 表不可用就返回空，调用方拿到空串 */ }
    return null;
  }

  /**
   * 构建查找索引（只建一次）
   * @returns {{map: Object, keys: Array<{k:string,zh:string}>}|null}
   */
  var _index = null;
  function buildIndex() {
    if (_index) return _index;
    var table = getTable();
    if (!table) return null;

    var map = Object.create(null);
    var keys = [];
    for (var i = 0; i < table.length; i++) {
      var row = table[i];
      if (!Array.isArray(row) || !row.length) continue;
      var zh = String(row[0] || '').trim();
      if (!zh) continue;
      for (var j = 0; j < row.length; j++) {
        var k = norm(row[j]);
        // 单字符键（"中" / "美"）太容易误命中，一律不要
        if (!k || k.length < 2) continue;
        if (!map[k]) {
          map[k] = zh;
          keys.push({ k: k, zh: zh });
        }
      }
    }
    // 最长优先：`美属萨摩亚` 必须先于 `美国` 命中
    keys.sort(function (a, b) { return b.k.length - a.k.length; });

    _index = { map: map, keys: keys };
    return _index;
  }

  /**
   * text 是否以 key 开头（英文要求右侧是词边界，防止 `us` 吃掉 `usarmy`）
   * @param {string} text - 已归一化的文本
   * @param {string} key - 已归一化的国家键
   */
  function startsWithKey(text, key) {
    if (text.length < key.length) return false;
    if (text.slice(0, key.length) !== key) return false;
    var next = text.charAt(key.length);
    if (/[a-z]/.test(key) && /[a-z]/.test(next)) return false;
    return true;
  }

  /** 切成地名段：逗号类分隔符 + 两个以上空格 */
  function splitSegments(raw) {
    return String(raw)
      .split(/[,，、/;；|]+|\s{2,}/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
  }

  /**
   * 从出生地抽国家
   *
   * @param {*} birthPlace - 页面上的出生地原文
   * @returns {string} 规范化中文国名（如 `中国香港`）；抽不出返回空串
   */
  function extractCountry(birthPlace) {
    var raw = String(birthPlace === null || birthPlace === undefined ? '' : birthPlace)
      .replace(/\u00a0/g, ' ')
      .trim();
    if (!raw) return '';

    var idx = buildIndex();
    if (!idx) return '';

    // ① 整串精确
    var whole = norm(raw);
    if (idx.map[whole]) return idx.map[whole];

    // ② 分段精确
    //
    // v2.7.12：命中「中国」时**不要立刻收工**，先看后面几段有没有更具体的地区。
    // 豆瓣影人的出生地写成 `中国,香港` / `中国,福建,厦门`（大到小），
    // 第一段恒为「中国」，直接返回就把香港影人记成「中国」，与「香港 → 中国香港」
    // 那条规则自相矛盾（同一个演员换个入口就变成另一个国家）。
    // 只对「中国」这一个值让位，其它国家保持"第一个命中即定案"，不引入新的误判。
    var segs = splitSegments(raw);
    var i;
    var chinaHit = '';
    for (i = 0; i < segs.length; i++) {
      var s = norm(segs[i]);
      var hitZh = idx.map[s];
      if (!hitZh) continue;
      if (hitZh === '中国') {
        if (!chinaHit) chinaHit = hitZh;
        continue;
      }
      return hitZh;
    }
    if (chinaHit) return chinaHit;

    // ③ 前缀（最长优先）：先逐段试，再试整串
    //    逐段在前是因为 `New York City, New York, United States` 只有最后一段能命中
    for (i = 0; i < segs.length; i++) {
      var seg = norm(segs[i]);
      for (var j = 0; j < idx.keys.length; j++) {
        if (startsWithKey(seg, idx.keys[j].k)) return idx.keys[j].zh;
      }
    }
    for (i = 0; i < idx.keys.length; i++) {
      if (startsWithKey(whole, idx.keys[i].k)) return idx.keys[i].zh;
    }

    // ④ 抽不出 → 留空（不拿城市名凑数）
    return '';
  }

  /** 单测用：清掉索引缓存 */
  function _reset() {
    _index = null;
  }

  var api = { extractCountry: extractCountry, _reset: _reset };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.CountryExtract = api;
  }
})(typeof window !== 'undefined' ? window : null);
