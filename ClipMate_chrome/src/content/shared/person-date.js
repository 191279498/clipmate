/**
 * 人物档案日期补齐（v2.7.11）
 *
 * 为什么单独一个文件
 * -----------------
 * 全扩展的铁律是「源到哪档显示到哪档，绝不补 00:00 / 0000」（补出来的日期是假的）。
 * 人物档案是**唯一的例外**，用户 2026-10-30 明确拍板：豆瓣影人常常只给「1955年4月」，
 * 这种半截日期在 Notion / Excel 里没法排序和筛选，必须补成一个合法日期。
 *
 * 三条纪律（写在代码里，改之前先想清楚）
 * ------------------------------------
 * ① **只补 `-01`，不补 `-00`**：`1955-04-01` 是合法日期，`1955-04-00` 会让 Excel
 *    把整列识别成文本，后面的排序全废。
 * ② **只给 person 用**：书籍「发布日期」、影视「上映日期」、社交「发布日期」一个都不许调这里。
 * ③ **补齐发生在写缓存之前**：缓存里存的必须是补齐后的终值，否则同一对象换个入口
 *    拿到的日期格式会不一样（违反「同一对象任何入口同一字符串」）。
 *
 * 不合格的输入一律**原样返回**，不猜、不置空：
 *   · `1955年2月30日`（不存在的日期）→ 原样返回，人能一眼看出源数据有问题；
 *   · `不详` / `未知` / 空 → 返回空串，不补成 `0000-01-01`。
 *
 * 纯函数，无依赖，可在 Node 下直接 require 做单测。
 */
(function (global) {
  'use strict';

  /** 年月日：1955年4月25日 / 1955-04-25 / 1955.04.25 / 1955/4/25 */
  var RE_FULL = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/;
  /** 年月：1955年4月 / 1955-04 / 1955.04 */
  var RE_YM = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*月?$/;
  /** 只有年：1955年 / 1955 */
  var RE_Y = /^(\d{4})\s*年?$/;

  /** 明确「没有日期」的写法，不参与补齐 */
  var UNKNOWN_RE = /^(不详|未知|无|N\/?A|unknown|—+|-+|\?+)$/i;

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 这一天在日历上真的存在吗（防 2 月 30 日这类脏数据） */
  function isRealDate(y, m, d) {
    if (!(y >= 1000 && y <= 9999)) return false;
    if (!(m >= 1 && m <= 12)) return false;
    if (!(d >= 1 && d <= 31)) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  /**
   * 把一个人物日期字符串补齐成 `YYYY-MM-DD`
   *
   * @param {*} raw - 页面上的原始日期文本
   * @returns {string} 补齐后的日期；无法识别 / 明确不详时返回 ''
   */
  function fillPersonDate(raw) {
    if (raw === null || raw === undefined) return '';

    var s = String(raw).replace(/\u00a0/g, ' ').trim();
    if (!s) return '';
    if (UNKNOWN_RE.test(s)) return '';

    // ① 年月日齐全：原样（只补零，不改值）
    var m = RE_FULL.exec(s);
    if (m) {
      var y1 = parseInt(m[1], 10);
      var mo1 = parseInt(m[2], 10);
      var d1 = parseInt(m[3], 10);
      if (isRealDate(y1, mo1, d1)) {
        return y1 + '-' + pad2(mo1) + '-' + pad2(d1);
      }
      // 日期不合法（2 月 30 日这种）→ 原样返回，让人看见源数据有问题
      return s;
    }

    // ② 只有年月：补当月 1 日
    m = RE_YM.exec(s);
    if (m) {
      var y2 = parseInt(m[1], 10);
      var mo2 = parseInt(m[2], 10);
      if (isRealDate(y2, mo2, 1)) {
        return y2 + '-' + pad2(mo2) + '-01';
      }
      return s;
    }

    // ③ 只有年：补 1 月 1 日
    m = RE_Y.exec(s);
    if (m) {
      var y3 = parseInt(m[1], 10);
      if (isRealDate(y3, 1, 1)) {
        return y3 + '-01-01';
      }
      return s;
    }

    // ④ 认不出来：原样返回，不猜
    return s;
  }

  var api = { fillPersonDate: fillPersonDate };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.PersonDate = api;
  }
})(typeof window !== 'undefined' ? window : null);
