/**
 * 数据格式化工具函数
 *
 * 从 content-main.js MediaExtractor 类中抽离的纯函数集合。
 * 所有函数无 this 依赖、无 class 状态依赖，输入→输出确定。
 *
 * 每个函数签名与原始 MediaExtractor 方法完全一致。
 */

(function(global) {
  'use strict';

  const F = {};

  // ============ 日期格式化 ============

  /**
   * 格式化日期
   * @param {string} dateStr - 日期字符串
   * @param {boolean} includeTime - 是否包含时间
   * @returns {string} 格式化后的日期
   */
  F.formatDate = function(dateStr, includeTime = false) {
    if (!dateStr) return '';
    
    // 确保是字符串类型
    const dateString = dateStr.toString().trim();
    
    // 处理中文日期格式：2023 年 8 月 3 日
    const chineseDatePattern = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/;
    const chineseDateMatch = dateString.match(chineseDatePattern);
    
    if (chineseDateMatch) {
      const [, year, month, day] = chineseDateMatch;
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      
      // 验证月份和日期的有效性
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        // 如果需要包含时间，提取时间部分（如果存在）
        if (includeTime) {
          const timePattern = /(\d{1,2}):(\d{2})(?::(\d{2}))?/;
          const timeMatch = dateString.match(timePattern);
          if (timeMatch) {
            const hours = timeMatch[1].padStart(2, '0');
            const minutes = timeMatch[2];
            const seconds = timeMatch[3] ? timeMatch[3].padStart(2, '0') : '00';
            return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')} ${hours}:${minutes}:${seconds}`;
          }
        }
        // 只返回日期部分
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 移除中文日期字符
    let processedDateStr = dateString.replace(/[年月]/g, '-').replace(/[日]/g, '');
    
    // 处理数字转中文的情况（简化处理，主要针对年份）
    const chineseNumbers = {'零': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'};
    for (const [chinese, number] of Object.entries(chineseNumbers)) {
      processedDateStr = processedDateStr.replace(new RegExp(chinese, 'g'), number);
    }
    
    // 尝试使用 Date 对象解析日期
    const dateObj = new Date(processedDateStr);
    if (!isNaN(dateObj.getTime())) {
      const year = dateObj.getFullYear();
      const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
      const day = dateObj.getDate().toString().padStart(2, '0');
      
      if (includeTime) {
        const hours = dateObj.getHours().toString().padStart(2, '0');
        const minutes = dateObj.getMinutes().toString().padStart(2, '0');
        const seconds = dateObj.getSeconds().toString().padStart(2, '0');
        return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
      }
      // 只返回日期部分
      return `${year}/${month}/${day}`;
    }
    
    // 尝试匹配 YYYY-MM-DD HH:MM 或 YYYY/MM/DD HH:MM 格式（包含时间）
    const fullDateTimePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/;
    const fullDateTimeMatch = processedDateStr.match(fullDateTimePattern);
    
    if (fullDateTimeMatch) {
      const [, year, month, day, hours, minutes, seconds] = fullDateTimeMatch;
      // 验证月份和日期的有效性
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        if (includeTime) {
          const formattedSeconds = seconds ? seconds.padStart(2, '0') : '00';
          return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')} ${hours.padStart(2, '0')}:${minutes}:${formattedSeconds}`;
        }
        // 只返回日期部分
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 尝试匹配 YYYY-MM-DD 或 YYYY/MM/DD 格式（仅日期）
    const fullDatePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    const fullMatch = processedDateStr.match(fullDatePattern);
    
    if (fullMatch) {
      const [, year, month, day] = fullMatch;
      // 验证月份和日期的有效性
      const monthNum = parseInt(month);
      const dayNum = parseInt(day);
      if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
        return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
      }
    }
    
    // 尝试匹配 YYYY-MM 或 YYYY/MM 格式
    const yearMonthPattern = /(\d{4})[-/](\d{1,2})/;
    const ymMatch = processedDateStr.match(yearMonthPattern);
    
    if (ymMatch) {
      const [, year, month] = ymMatch;
      const monthNum = parseInt(month);
      if (monthNum >= 1 && monthNum <= 12) {
        return `${year}/${month.toString().padStart(2, '0')}/01`;
      }
    }
    
    // 尝试匹配单独的年份
    const yearPattern = /(\d{4})/;
    const yearMatch = processedDateStr.match(yearPattern);
    
    if (yearMatch) {
      return `${yearMatch[1]}/01/01`;
    }
    
    return dateString;
  };

  // ============ 数值格式化 ============

  /**
   * 格式化时长
   */
  F.formatRuntime = function(runtime) {
    if (!runtime) return '';
    
    const minuteMatch = runtime.match(/(\d+)\s*分钟?/);
    if (minuteMatch) {
      return minuteMatch[1] + '分钟';
    }
    
    return runtime.trim();
  };

  /**
   * 标准化评分格式
   */
  F.formatRating = function(rating) {
    if (!rating) return '';
    
    const ratingNum = parseFloat(rating);
    if (isNaN(ratingNum)) return rating;
    
    if (ratingNum > 10) {
      return (ratingNum / 10).toFixed(1);
    }
    
    return ratingNum.toFixed(1);
  };

  // ============ 名称清理 ============

  F.cleanPersonName = function(name) {
    if (!name) return '';
    
    return name
      .replace(/\s+/g, ' ')
      .replace(/[（(].*[）)]/g, '')
      .replace(/^(导演|编剧|主演|演员|作者)[:：]?\s*/g, '')
      .trim();
  };

  F.cleanMovieTitle = function(title) {
    if (!title) return '';
    
    return title
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .trim();
  };

  F.cleanGameTitle = function(title) {
    if (!title) return '';
    
    return title
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*Steam$/i, '')
      .trim();
  };

  F.cleanSocialTitle = function(title) {
    if (!title) return '';
    
    return title
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
      .replace(/[#＃][\p{L}\p{N}_]+/gu, '')
      .replace(/[@＠][\p{L}\p{N}_]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // ============ 日期格式化（社交媒体） ============

  /**
   * 格式化社交媒体日期
   *
   * v2.5.78 起的规则：**精度由源数据自己决定，不再按站点补零**
   *   源是「年月日时分秒」→ `YYYY/MM/DD HH:mm:ss`
   *   源是「年月日时分」  → `YYYY/MM/DD HH:mm`
   *   源只有「年月日」     → `YYYY/MM/DD`
   *   相对时间（刚刚/秒前/分钟前/小时前）→ 推算到「分」
   *   相对时间（天前/昨天/前天/周前）   → 推算到「日」
   *
   * 以前的做法是按站点写死格式（抖音 `HH:mm`、TikTok 只到日……），
   * 源里没有时分秒时一律补 `00:00`，于是弹窗页凭空长出假时间。
   * 现在反过来：**源里有多少就给多少，没有的部分不写**。
   *
   * @param {string} dateStr 源日期文字
   * @param {string|null} dateFormat 历史参数，保留兼容；**不再用来决定精度**
   */
  F.formatSocialDate = function(dateStr, dateFormat = null) {
    if (!dateStr) return '';

    const dateString = dateStr.toString().trim();
    const pad = (v) => String(v).padStart(2, '0');
    const ymdOf = (y, m, d) => `${y}/${pad(m)}/${pad(d)}`;
    const hmsOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const hmOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    // ── ① ISO 8601（带 Z）：按 UTC 解析后转本地，精度天然到秒 ──
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(dateString)) {
      const d = new Date(dateString);
      if (!isNaN(d.getTime())) {
        return `${ymdOf(d.getFullYear(), d.getMonth() + 1, d.getDate())} ${hmsOf(d)}`;
      }
    }

    // ── ② 绝对时间：年月日 [时分[:秒]]，精度照抄源 ──
    const abs = dateString.match(
      /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[\sT]+(\d{1,2}):(\d{1,2})(?::(\d{2}))?)?$/
    );
    if (abs) {
      const base = ymdOf(abs[1], abs[2], abs[3]);
      if (abs[4] !== undefined && abs[4] !== '') {
        const hhmm = `${pad(abs[4])}:${pad(abs[5])}`;
        return (abs[6] !== undefined && abs[6] !== '') ? `${base} ${hhmm}:${pad(abs[6])}` : `${base} ${hhmm}`;
      }
      return base;
    }

    // ── ③ 相对时间：推算出来的时刻只给「分」或「日」，绝不编造秒 ──
    const relativeTimePatterns = [
      { pattern: /^(刚刚|现在|即时)$/, offset: () => 0, toMinute: true },
      { pattern: /^(\d+)\s*秒前$/, offset: (m) => parseInt(m[1], 10) / 60, toMinute: true },
      { pattern: /^(\d+)\s*(?:分钟|分)前$/, offset: (m) => parseInt(m[1], 10), toMinute: true },
      { pattern: /^(\d+)\s*(?:小时|时)前$/, offset: (m) => parseInt(m[1], 10) * 60, toMinute: true },
      { pattern: /^(\d+)\s*(?:天|日)前$/, offset: (m) => parseInt(m[1], 10) * 24 * 60, toMinute: false },
      { pattern: /^(昨天|昨日)$/, offset: () => 24 * 60, toMinute: false },
      { pattern: /^(前天|前日)$/, offset: () => 48 * 60, toMinute: false },
      { pattern: /^(\d+)\s*(?:周|星期)前$/, offset: (m) => parseInt(m[1], 10) * 7 * 24 * 60, toMinute: false }
    ];

    for (const item of relativeTimePatterns) {
      const rel = dateString.match(item.pattern);
      if (!rel) continue;
      const minutes = item.offset(rel);
      if (!isFinite(minutes)) break;
      const d = new Date(Date.now() - minutes * 60 * 1000);
      if (isNaN(d.getTime())) break;
      const dayPart = ymdOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return item.toMinute ? `${dayPart} ${hmOf(d)}` : dayPart;
    }

    // ── ④ 兜底：从杂文字里捞「日期 + 时间」，仍然照抄精度 ──
    const looseDate = dateString.match(/(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/);
    if (looseDate) {
      const base = ymdOf(looseDate[1], looseDate[2], looseDate[3]);
      const looseTime = dateString.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (looseTime) {
        const hhmm = `${pad(looseTime[1])}:${pad(looseTime[2])}`;
        return looseTime[3] !== undefined ? `${base} ${hhmm}:${pad(looseTime[3])}` : `${base} ${hhmm}`;
      }
      return base;
    }

    // ── ⑤ 实在认不出：交给 formatDate，不猜精度 ──
    return F.formatDate(dateString, false);
  };

  // ============ URL 工具 ============

  F.validateSocialUrl = function(url) {
    if (!url) return '';
    
    const urlString = url.toString().trim();
    
    if (!urlString.startsWith('http://') && !urlString.startsWith('https://')) {
      if (urlString.startsWith('/')) {
        return window.location.origin + urlString;
      }
      return 'https://' + urlString;
    }
    
    return urlString;
  };

  F.formatUrl = function(url) {
    if (!url) return '';
    
    if (typeof url === 'string') {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'https://' + url;
      }
      return url;
    }
    
    return '';
  };

  F.isDoubanUrl = function(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    const doubanDomainRegex = /douban\.com|doubanio\.com|doubanfm\.com/;
    return doubanDomainRegex.test(url);
  };

  // ============ 其他工具 ============

  F.getPlatformName = function(sourceSite) {
    const platformMap = {
      'douyin_social': '抖音',
      'kuaishou_social': '快手',
      'xiaohongshu_social': '小红书',
      'bilibili_social': '哔哩哔哩',
      'weibo_social': '微博',
      'tiktok_social': 'TikTok',
      'youtube_social': 'YouTube',
      'instagram_social': 'Instagram'
    };
    
    return platformMap[sourceSite] || sourceSite || '未知平台';
  };

  F.formatPlatforms = function(platforms) {
    if (!platforms) return '';
    
    const platformList = platforms.split(/[,，、/]/)
      .map(platform => platform.trim())
      .filter(platform => platform);
    
    return [...new Set(platformList)].join(', ');
  };

  F.formatISBN = function(isbn) {
    if (!isbn) return '';
    
    return isbn.replace(/[^\dX-]/g, '');
  };

  F.truncateText = function(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    
    return text.substring(0, maxLength) + '...';
  };

  /**
   * 截断长文本，但**绝不把 Markdown 链接切一半**（v2.7.15）
   *
   * 为什么需要它：人物档案的「简介」里带 `[@某人](https://www.douyin.com/user/MS4w…/…)`
   * 这种链接，一条 URL 就 76 个字符。按字符数硬切极容易落在 URL 中间，
   * 渲染层匹配不到闭合的 `)` → 浮窗里直接露出半截
   * `[@樱崽.悸筱心肝](https://www.douyin.com/user/MS4wLjABAAAA_bnol66rpOjMDbRgQNObz2M_26gE`
   * 原文，用户看到的效果就是「没提取完整」，而且这条链接也点不动了。
   *
   * 做法：切点若落在 `](` 之后、`)` 之前，就退回到 `[` 之前再补省略号。
   * 宁可少留几个字，也不留半截链接。
   */
  F.truncateRichText = function(text, maxLength) {
    if (typeof text !== 'string' || !text) return text;
    if (!(maxLength > 0) || text.length <= maxLength) return text;

    var cut = text.slice(0, maxLength);
    var open = cut.lastIndexOf('](');
    // `](` 之后找不到 `)` = 正好切在 URL 里 → 整条链接不要
    if (open > -1 && cut.indexOf(')', open) === -1) {
      cut = cut.slice(0, open);
    }
    return cut + '...';
  };

  // ============ 数据名称处理 ============

  F.processAuthorNames = function(authors) {
    if (!authors) return '';
    
    return authors.split(/[,，、/]/)
      .map(author => F.cleanPersonName(author))
      .filter(author => author && author.length > 1)
      .join(', ');
  };

  F.processCrewNames = function(crew) {
    if (!crew) return '';
    
    let crewString = crew;
    if (Array.isArray(crew)) {
      crewString = crew.join(', ');
    } else if (typeof crew !== 'string') {
      crewString = String(crew);
    }
    
    return crewString.split(/[,，、/]/)
      .map(person => F.cleanPersonName(person))
      .filter(person => person && person.length > 1)
      .join(', ');
  };

  // ============ 日期提取 ============

  /**
   * 提取最早的上映日期
   */
  F.extractEarliestReleaseDate = function(dateStr) {
    if (!dateStr) return '';
    
    const dateString = dateStr.toString().trim();
    
    // 直接从原始字符串中提取所有可能的日期格式
    const datePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g;
    const dateInfos = [];
    let match;
    
    datePattern.lastIndex = 0;
    
    while ((match = datePattern.exec(dateString)) !== null) {
      const year = parseInt(match[1]);
      const month = parseInt(match[2]);
      const day = parseInt(match[3]);
      
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const dateValue = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        dateInfos.push({ year, month, day, dateValue });
      }
    }
    
    // 添加中文日期格式支持
    if (dateInfos.length === 0) {
      const chineseDatePattern = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
      chineseDatePattern.lastIndex = 0;
      
      while ((match = chineseDatePattern.exec(dateString)) !== null) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        const day = parseInt(match[3]);
        
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const dateValue = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          dateInfos.push({ year, month, day, dateValue });
        }
      }
    }
    
    // 特殊处理豆瓣日期格式
    if (dateInfos.length === 0) {
      const doubanDatePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})\([^)]*\)/g;
      doubanDatePattern.lastIndex = 0;
      
      while ((match = doubanDatePattern.exec(dateString)) !== null) {
        const year = parseInt(match[1]);
        const month = parseInt(match[2]);
        const day = parseInt(match[3]);
        
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const dateValue = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          dateInfos.push({ year, month, day, dateValue });
        }
      }
    }
    
    // 如果没有提取到完整日期，尝试提取年份
    if (dateInfos.length === 0) {
      const yearPattern = /(\d{4})/g;
      yearPattern.lastIndex = 0;
      const years = new Set();
      
      while ((match = yearPattern.exec(dateString)) !== null) {
        years.add(parseInt(match[1]));
      }
      
      years.forEach(year => {
        const dateValue = `${year}-01-01`;
        dateInfos.push({ year, month: 1, day: 1, dateValue });
      });
    }
    
    
    if (dateInfos.length === 0) {
      return dateString;
    }
    
    dateInfos.sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      if (a.month !== b.month) return a.month - b.month;
      return a.day - b.day;
    });
    
    
    return dateInfos[0].dateValue;
  };

  // 注册到全局
  global.DataFormatters = F;

})(window);
