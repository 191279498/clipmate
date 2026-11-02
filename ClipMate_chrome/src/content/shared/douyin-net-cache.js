/**
 * 抖音「一手数据」缓存读取器 —— 内容脚本（隔离世界）侧
 *
 * 数据由 `src/content/douyin-net-hook.js` 在页面主世界拦截接口响应后写入：
 *   <script type="application/json" id="clipmate-douyin-net">{ v:1, items:{...} }</script>
 * 主世界碰不到 chrome.*，隔离世界看不到页面变量，**DOM 是两边唯一都能读的地方**。
 *
 * 三条规矩
 * -------
 * 1. **读不到就当没有**：节点不存在、JSON 坏了、ID 对不上 → 一律 null，调用方回落老取法。
 * 2. **只认精确命中**：拿作品 ID 精确查，绝不拿「最近一条」顶替（否则切条时会串台）。
 * 3. **抖音号优先 unique_id**：为空才退 short_id；两者都空返回空串（绝不编）。
 *    `short_id` 在「未设置抖音号」的用户身上可能是 `0`，也算没有。
 */
(function (global) {
  'use strict';

  var NODE_ID = 'clipmate-douyin-net';
  var ID_RE = /^[0-9a-zA-Z._]{1,30}$/;

  function readPayload() {
    try {
      var el = document.getElementById(NODE_ID);
      if (!el) return null;
      var text = el.textContent;
      if (!text || text.length < 10) return null;
      var data = JSON.parse(text);
      if (!data || typeof data !== 'object') return null;
      if (!data.items || typeof data.items !== 'object') return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  function get(awemeId) {
    var id = awemeId === null || awemeId === undefined ? '' : String(awemeId).trim();
    if (!/^\d{6,25}$/.test(id)) return null;
    var data = readPayload();
    if (!data) return null;
    var rec = data.items[id];
    return rec && typeof rec === 'object' ? rec : null;
  }

  /** 这条作品的一手文案（完整原文，未削未截）；没有则空串 */
  function descOf(awemeId) {
    var rec = get(awemeId);
    return rec && typeof rec.desc === 'string' ? rec.desc : '';
  }

  /** 这条作品的一手昵称；没有则空串 */
  function nicknameOf(awemeId) {
    var rec = get(awemeId);
    return rec && typeof rec.nickname === 'string' ? rec.nickname : '';
  }

  /**
   * 记录里的「抖音号」：unique_id 优先，空则 short_id，都无效则空串。
   * 返回值已按项目既有规则校验（字母数字点下划线、长度 ≤ 30）。
   */
  function authorIdOf(rec) {
    if (!rec || typeof rec !== 'object') return '';
    var candidates = [rec.uniqueId, rec.shortId];
    for (var i = 0; i < candidates.length; i++) {
      var v = candidates[i] === null || candidates[i] === undefined ? '' : String(candidates[i]).trim();
      if (!v || v === '0') continue;
      if (ID_RE.test(v)) return v;
    }
    return '';
  }

  /** 某作品的抖音号（一步到位）；没有则空串 */
  function authorIdFor(awemeId) {
    return authorIdOf(get(awemeId));
  }

  var mod = {
    NODE_ID: NODE_ID,
    get: get,
    descOf: descOf,
    nicknameOf: nicknameOf,
    authorIdOf: authorIdOf,
    authorIdFor: authorIdFor,
    _readPayload: readPayload
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (global) global.DouyinNetCache = mod;
})(typeof window !== 'undefined' ? window : null);
