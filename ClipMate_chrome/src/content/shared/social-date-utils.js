/**
 * 社交媒体日期文本处理工具
 *
 * 由来
 * ----
 * 微博与微博移动版各自有一份 completeYearFormat / removeSeconds：
 *   - removeSeconds：两份逻辑完全一致（仅注释与空行不同）
 *   - completeYearFormat：微博版支持 '-' 和 '/' 两种分隔符，
 *     移动版只支持 '-'。这是历史差异，不是 bug，必须原样保留。
 *
 * 因此这里提供合并版，并用 allowSlash 开关严格区分两站行为：
 *   SocialDateUtils.completeYearFormat(text)                        // 微博：- 和 / 都支持
 *   SocialDateUtils.completeYearFormat(text, { allowSlash: false }) // 移动版：只支持 -
 *
 * 输出格式：v2.5.48 起统一为 '/'（与全项目「发布日期」一致）。
 * 解析入口仍同时接受 '-' 和 '/'，只是出口统一，不影响识别。
 */
(function (global) {
  'use strict';

  /**
   * 补全两位数年份（如 "25-11-12 10:10" → "2025-11-12 10:10"）
   * @param {string} dateText
   * @param {Object} [options]
   * @param {boolean} [options.allowSlash=true] - 是否额外支持 '/' 分隔符
   * @returns {string} 处理后的文本，未命中规则时原样返回
   */
  function completeYearFormat(dateText, options) {
    if (!dateText) return dateText;

    const allowSlash = !options || options.allowSlash !== false;

    // 匹配格式："25-11-12 10:10"（两位数年份-月-日 时:分）
    const twoDigitYearPattern = /^(\d{2})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/;
    const match = dateText.match(twoDigitYearPattern);

    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hour = match[4];
      const minute = match[5];
      // 补全为四位数年份（假设是20xx年），保持原有的日期时间格式，只替换年份部分
      // v2.5.48：输出统一用 '/'，与全项目「发布日期」格式对齐
      return '20' + year + '/' + month.padStart(2, '0') + '/' + day.padStart(2, '0') + ' ' + hour.padStart(2, '0') + ':' + minute;
    }

    if (!allowSlash) return dateText;

    // 匹配格式："25/11/12 10:10"（两位数年份/月/日 时:分）
    const altPattern = /^(\d{2})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;
    const altMatch = dateText.match(altPattern);

    if (altMatch) {
      const year = altMatch[1];
      const month = altMatch[2];
      const day = altMatch[3];
      const hour = altMatch[4];
      const minute = altMatch[5];
      return '20' + year + '/' + month.padStart(2, '0') + '/' + day.padStart(2, '0') + ' ' + hour.padStart(2, '0') + ':' + minute;
    }

    return dateText;
  }

  /**
   * 去掉日期文本末尾的秒数（保留到分钟）
   * @param {string} dateText
   * @returns {string} 处理后的文本，未命中规则时原样返回
   */
  function removeSeconds(dateText) {
    if (!dateText) return dateText;

    // 支持 "2025/11/12 10:10:00" / "2025-11-12 10:10:00" / "2025年11月12日 10:10:00"
    const withSecondsPattern = /^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})[日\s]*(\d{1,2}):(\d{2}):(\d{2})$/;
    const match = dateText.match(withSecondsPattern);

    if (match) {
      const year = match[1];
      const month = match[2];
      const day = match[3];
      const hour = match[4];
      const minute = match[5];
      // 使用原始的分隔符格式，去除秒数，只保留到分钟
      // v2.5.48：输出统一用 '/'，不再跟随原文本的短横
      const separator = '/';
      return year + separator + month.padStart(2, '0') + separator + day.padStart(2, '0') + ' ' + hour.padStart(2, '0') + ':' + minute;
    }

    // 兜底：直接去掉末尾的 :秒数
    if (/(\d{1,2}):(\d{2}):(\d{2})$/.test(dateText)) {
      return dateText.replace(/:(\d{2})$/, '');
    }

    return dateText;
  }

  const api = {
    completeYearFormat,
    removeSeconds
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SocialDateUtils = api;
  }
})(typeof window !== 'undefined' ? window : null);
