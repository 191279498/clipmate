/**
 * 快手发布时间 —— 精确到秒（v2.5.84）
 *
 * 真机发现：快手封面图/视频地址的最后一段文件名，藏着精确到秒的发布时间。
 *
 *   https://p2.a.yximgs.com/upic/2026/10/03/19/BMjAyNjEwMDMxOTU4NDNfNDA5NDQ2MTQyNl8..._B50798....jpg
 *                                              ↑ 一个字母「B」+ Base64("<14位时间>_<用户号>_<作品号>_..")
 *
 * 解码后开头是 `20261003195843_4094461426_...`，前 14 位即 2026-10-03 19:58:43。
 *
 * 为什么可以放心用：同一条作品，`<DIV poster>`、`<VIDEO src>`、背景图三处挂着
 * 完全一致的这个文件名；**详情页与推荐流逐字相同**（真机对照过 `3xqcmsz5d55jhz2`），
 * 所以两个入口显示出来的字符串必然一致 —— 满足「同一作品任何入口同一字符串」。
 *
 * 三条保命规矩（改这个文件前必须读）：
 *   1. **只认含 `/upic/` 的地址。** 头像地址（`/uhead/`）的文件名是同一套形状，
 *      解出来是**头像的上传时间**，跟作品毫无关系（真机见过 2026/10/05 而作品是 10/03）。
 *   2. **交叉校验年月日**：解出来的年月日必须和路径里的 `/upic/YYYY/MM/DD/` 一致，
 *      对不上说明猜错了，宁可回落到「到日」也不吐可疑时间。
 *   3. **取不到就回落**：返回老样子 `2026/10/03`，绝不返回空、绝不编造 `00:00:00`。
 */
(function (global) {
  'use strict';

  var UPIC_DATE = /\/upic\/(\d{4})\/(\d{2})\/(\d{2})\//;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Base64 解码（标准 / URL-safe 都吃），失败一律返回空串 */
  function b64decode(raw) {
    var s = String(raw || '');
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return '';
    var body = s;
    while (body.length % 4) body += '=';
    var std = body.replace(/-/g, '+').replace(/_/g, '/');
    try {
      if (typeof atob === 'function') return atob(std);
      if (typeof Buffer !== 'undefined') return Buffer.from(std, 'base64').toString('binary');
    } catch (e) { /* 解码失败当没解 */ }
    return '';
  }

  /** 解码结果是不是「开头 14 位像一个合法时间」 */
  function parseStamp(dec) {
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[_|]|$)/.exec(String(dec || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], s = +m[6];
    if (y < 2000 || y > 2100) return null;
    if (mo < 1 || mo > 12) return null;
    if (d < 1 || d > 31) return null;
    if (h > 23 || mi > 59 || s > 59) return null;
    return { y: y, mo: mo, d: d, h: h, mi: mi, s: s };
  }

  /** 老办法：只要年月日（`/upic/2026/10/03/` → `2026/10/03`） */
  function dateOnlyFromSrc(src) {
    var m = UPIC_DATE.exec(String(src || ''));
    return m ? (m[1] + '/' + m[2] + '/' + m[3]) : '';
  }

  /**
   * 主入口：从封面/视频地址取发布时间
   * @param {string} src 图片或视频的地址
   * @returns {string} `2026/10/03 19:58:43`（能解出来）｜ `2026/10/03`（解不出来，回落）｜ `''`（不是封面地址）
   */
  function publishDateTimeFromSrc(src) {
    var s = String(src || '');
    var dayOnly = dateOnlyFromSrc(s);
    if (!dayOnly) return '';

    // 取文件路径最后一段的文件名（去掉 query / hash / 扩展名 / `_<哈希>` 尾巴）
    var path = s.split('?')[0].split('#')[0];
    var segs = path.split('/');
    var name = String(segs[segs.length - 1] || '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
    if (name.length < 16) return dayOnly;
    name = name.split('_')[0];

    // `B` 前缀是快手加的版本标记；两种都试，谁解得出来算谁
    var candidates = [name, name.slice(1)];
    for (var i = 0; i < candidates.length; i++) {
      var st = parseStamp(b64decode(candidates[i]));
      if (!st) continue;
      if ((st.y + '/' + pad2(st.mo) + '/' + pad2(st.d)) !== dayOnly) return dayOnly;
      return dayOnly + ' ' + pad2(st.h) + ':' + pad2(st.mi) + ':' + pad2(st.s);
    }
    return dayOnly;
  }

  var api = {
    publishDateTimeFromSrc: publishDateTimeFromSrc,
    dateOnlyFromSrc: dateOnlyFromSrc,
    b64decode: b64decode
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.KuaishouCoverTime = api;
})(typeof window !== 'undefined' ? window : null);
