/**
 * 抖音作品 ID（雪花 ID）→ 日期，以及「弹窗里那行时间是哪种形态」的解析
 *
 * 只做一件事：把**已经拿到的时间文字**翻译成 `YYYY/MM/DD`。
 * 它不知道页面长什么样，也不碰 DOM —— 纯函数，好测。
 *
 * 背景（v2.5.77 批 -1 / 批 0 实测）
 * ---------------------------------
 * - 雪花 ID 里藏的是**上传时间**（`BigInt(id) >> 32n` 是秒），
 *   抖音页面显示的是**发布时间**，隔天发布/定时发布会差一天
 *   （实测 7672265848853220618：ID 反推 2026-08-10，页面写 8月11日）。
 * - 所以：**fiber 的 createTime 才是主路径**；ID 只在「页面只有月日、又没有 fiber」时用来补年份。
 * - 弹窗里那行时间有三种形态：`2025年6月16日` / `8月11日` / `2天前`。
 *
 * 三条纪律
 * --------
 * 1. 带年份的直接信页面；
 * 2. 只有月日的，年份从 ID 补（在 ID年−1 / ID年 / ID年+1 里挑离 ID 日期最近的那个，
 *    解决「12/31 上传、1/1 发布」跨年）；ID 不可用就**留空**，绝不拿「比今天大就算去年」去猜；
 * 3. 相对时间按当前时间倒推（这类都是近期发布，误差不超过 1 天；有 fiber 时轮不到这一档）。
 */
(function (global) {
  'use strict';

  var MIN_YEAR = 2016;   // 抖音上线年份，早于此的必然是算错了
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  function formatYmd(year, month, day) {
    if (!year || !month || !day) return '';
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return year + '/' + pad2(month) + '/' + pad2(day);
  }

  /**
   * 秒级时间戳 → `YYYY/MM/DD HH:mm:ss`（本地时区）
   * v2.5.78：以前只到「日」，弹窗页因此永远补 `00:00`；fiber 里本来就有秒，不再砍掉。
   * @param {number} seconds
   * @returns {string} 不合理时返回空串
   */
  function formatTimestamp(seconds) {
    var ts = Number(seconds);
    if (!ts || !isFinite(ts) || ts <= 0) return '';
    var d = new Date(ts * 1000);
    var year = d.getFullYear();
    if (!isValidYear(year)) return '';
    return formatYmd(year, d.getMonth() + 1, d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function isValidYear(year) {
    var nowYear = new Date().getFullYear();
    return year >= MIN_YEAR && year <= nowYear + 1;
  }

  /**
   * 雪花 ID → 上传日期（本地时区）
   * @param {string|number} id
   * @returns {string} `YYYY/MM/DD`；不是雪花格式/年份不合理时返回空串
   */
  function uploadDateFromId(id) {
    try {
      var raw = id === null || id === undefined ? '' : String(id).trim();
      if (!/^\d{6,25}$/.test(raw)) return '';
      var seconds = Number(BigInt(raw) >> 32n);   // 必须 BigInt：19 位超过安全整数
      if (!seconds || !isFinite(seconds)) return '';
      var d = new Date(seconds * 1000);
      var year = d.getFullYear();
      if (!isValidYear(year)) return '';
      return formatYmd(year, d.getMonth() + 1, d.getDate());
    } catch (e) {
      return '';
    }
  }

  /** `YYYY/MM/DD` → 当天 0 点的毫秒数（用于比较天数差） */
  function dayNumber(ymd) {
    var m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(ymd || '');
    if (!m) return NaN;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
  }

  /**
   * 只有「月日」时，用作品 ID 补年份。
   * 在 ID年−1 / ID年 / ID年+1 三个候选里挑与 ID 日期天数差最小的那个。
   */
  function yearFromId(month, day, id) {
    var idDate = uploadDateFromId(id);
    if (!idDate) return 0;
    var idYear = Number(idDate.slice(0, 4));
    var idDayNum = dayNumber(idDate);
    var best = 0;
    var bestDiff = Infinity;
    for (var y = idYear - 1; y <= idYear + 1; y++) {
      var cand = formatYmd(y, month, day);
      if (!cand) continue;
      var diff = Math.abs(dayNumber(cand) - idDayNum);
      if (diff < bestDiff) { bestDiff = diff; best = y; }
    }
    return best;
  }

  var DATE_WITH_YEAR = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  var DATE_MONTH_DAY = /(\d{1,2})\s*月\s*(\d{1,2})\s*日/;
  var RELATIVE = /(\d+)\s*(秒|分钟|小时|天|周|个月|年)\s*前/;

  /**
   * 解析「弹窗里那一行时间文字」→ `YYYY/MM/DD`
   *
   * @param {string} text 形如 `· 8月11日980秒…`、`· 2025年6月16日图文…`、`· 3天前…`
   * @param {string} [id] 作品 ID（只在「只有月日」时用来补年份）
   * @param {number} [nowMs] 当前时间（单测注入用，默认 Date.now()）
   * @returns {string} 解析不出就返回空串（绝不猜）
   */
  function parsePublishedDate(text, id, nowMs) {
    var src = typeof text === 'string' ? text.replace(/\s+/g, ' ') : '';
    if (!src) return '';

    // ① 带年份：页面就是权威
    var m = DATE_WITH_YEAR.exec(src);
    if (m) {
      var ymd = formatYmd(Number(m[1]), Number(m[2]), Number(m[3]));
      if (ymd) return ymd;
    }

    // ② 只有月日：年份由作品 ID 补
    var md = DATE_MONTH_DAY.exec(src);
    if (md) {
      var month = Number(md[1]);
      var day = Number(md[2]);
      var year = yearFromId(month, day, id);
      if (!year) return '';           // ID 不可用 → 留空，不猜
      return formatYmd(year, month, day);
    }

    // ③ 相对时间：按当前时间倒推
    var rel = RELATIVE.exec(src);
    if (rel) {
      var n = Number(rel[1]);
      var unit = rel[2];
      if (!n || !isFinite(n)) return '';
      var base = typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : Date.now();
      var d = new Date(base);
      if (unit === '秒' || unit === '分钟' || unit === '小时') {
        var minusMs = unit === '秒' ? n * 1000 : (unit === '分钟' ? n * 60000 : n * 3600000);
        d = new Date(base - minusMs);
      } else if (unit === '天') {
        d = new Date(base - n * 86400000);
      } else if (unit === '周') {
        d = new Date(base - n * 7 * 86400000);
      } else if (unit === '个月') {
        d = new Date(base);
        d.setMonth(d.getMonth() - n);
      } else if (unit === '年') {
        d = new Date(base);
        d.setFullYear(d.getFullYear() - n);
      } else {
        return '';
      }
      var ry = d.getFullYear();
      if (!isValidYear(ry)) return '';
      return formatYmd(ry, d.getMonth() + 1, d.getDate());
    }

    return '';
  }

  /**
   * 把一段「日期文字」拆成三档：日期 / 时分 / 秒
   *
   * @param {string} text 形如 `2025-04-22 16:00`、`2025/04/22 16:00:29`、`2025年4月22日`
   * @returns {{date:string, hm:string, second:string}|null} 拆不出日期时返回 null
   */
  function splitDateTime(text) {
    var src = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
    if (!src) return null;
    var m = /(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/.exec(src);
    if (!m) return null;
    var date = formatYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!date) return null;
    var t = /(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(src);
    return {
      date: date,
      hm: t ? pad2(Number(t[1])) + ':' + pad2(Number(t[2])) : '',
      second: t && t[3] !== undefined ? pad2(Number(t[3])) : ''
    };
  }

  /**
   * 日期精度对齐（v2.5.79）—— 同一个作品，详情页和弹窗页要显示成同一个字符串
   *
   * 背景：详情页那行文字只到「分」（`发布时间：2025-04-22 16:00`），
   * 而弹窗页读的是 fiber 的 `createTime`（到秒，`16:00:29`）。
   * 用户 2026-10-27 拍板：**统一**，两边都以「到秒」为准。
   *
   * 规则（宁空不错，页面永远是权威）：
   *   - fiber 没有 → 用页面文字（老表现）
   *   - 页面没有 → 用 fiber（以前是直接留空）
   *   - 日期对不上 → 用页面文字（fiber 串台时不改错日期）
   *   - 时分对不上 → 用页面文字（同理）
   *   - 页面已有秒 → 用页面文字（页面比 fiber 更细就听页面）
   *   - 其余情况 → 用 fiber（比页面多出的只有「秒」这一档）
   *
   * @param {string} pageText 页面文字解析出来的日期
   * @param {string} fiberText fiber createTime 格式化出来的日期
   * @returns {string} 合并后的日期（两者都空时返回空串）
   */
  function mergePrecision(pageText, fiberText) {
    var page = typeof pageText === 'string' ? pageText.trim() : '';
    var fiber = typeof fiberText === 'string' ? fiberText.trim() : '';
    if (!fiber) return page;
    if (!page) return fiber;

    var p = splitDateTime(page);
    var f = splitDateTime(fiber);
    if (!p || !f) return page;            // 有一边解析不出日期（相对时间等）→ 信页面
    if (p.date !== f.date) return page;   // 日期不同 → 信页面
    if (p.hm && f.hm && p.hm !== f.hm) return page; // 时分不同 → 信页面
    if (!f.second) return page;           // fiber 也没秒 → 页面优先
    if (p.second) return page;            // 页面已有秒 → 原样用页面
    return fiber;
  }

  var api = {
    MIN_YEAR: MIN_YEAR,
    formatTimestamp: formatTimestamp,
    uploadDateFromId: uploadDateFromId,
    parsePublishedDate: parsePublishedDate,
    yearFromId: yearFromId,
    splitDateTime: splitDateTime,
    mergePrecision: mergePrecision
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global) global.DouyinAwemeDate = api;
})(typeof window !== 'undefined' ? window : null);
