// 基础提取器类
class BaseExtractor {
  constructor() {
    this.cache = new Map();
    this.maxCacheSize = 100;
    // 默认站点名称，子类应该覆盖此属性
    this.siteName = 'unknown';
  }

  /**
   * 地区名称标准化 - 静态共享方法
   * 用于统一不同地区名称的显示格式，确保所有媒体类型和国家地区信息在前端展示时保持一致
   *
   * v2.5.68：映射表已迁到 src/shared/country-names.js（全扩展唯一一份，约 200 个国家/地区、
   * 600 余种写法）。本方法只做转发，**签名与输出格式不变**（多个地区用「, 」连接、去重），
   * 因此 10 个调用方一行都不用改。
   *
   * @param {string|string[]} countryText - 单个地区名称或多个地区名称数组
   * @returns {string} 标准化后的地区名称字符串，多个地区用英文逗号加空格分隔
   */
  static standardizeRegionNames(countryText) {
    // 主路径：交给共享转换器
    try {
      if (typeof window !== 'undefined' && window.CountryNames
          && typeof window.CountryNames.standardizeRegionNames === 'function') {
        return window.CountryNames.standardizeRegionNames(countryText);
      }
    } catch (error) {
      console.error('地区名称标准化转发失败，改用内置兜底:', error);
    }

    // 兜底：万一 country-names.js 没加载，至少保住最常用的几条，别让字段整列变空
    const legacyMap = {
      '中国大陆': '中国',
      '中国内地': '中国',
      '香港': '中国香港',
      '澳门': '中国澳门',
      '台湾': '中国台湾',
      'USA': '美国',
      'United States': '美国',
      'UK': '英国',
      'United Kingdom': '英国'
    };
    try {
      if (Array.isArray(countryText)) {
        return countryText
          .map(country => String(country || '').trim())
          .map(country => legacyMap[country] || country)
          .filter(Boolean)
          .join(', ');
      }
      if (typeof countryText === 'string') {
        return countryText.split(/[,，]/)
          .map(country => country.trim())
          .map(country => legacyMap[country] || country)
          .filter(Boolean)
          .join(', ');
      }
      return '';
    } catch (error) {
      console.error('地区名称标准化处理失败:', error);
      return typeof countryText === 'string' ? countryText : '';
    }
  }

  // 提取所有字段
  async extractAllFields() {
    const fields = {};
    
    try {
      // 基础信息
      fields.title = this.extractTitle();
      // 🔧 修复：设置url字段为当前页面URL，确保基础字段完整性
      fields.url = this.pageUrl || window.location.href;
      fields.rating = this.extractRating();
      fields.description = this.extractDescription();
      
      // 特定字段
      const specificFields = await this.extractSpecificFields();
      Object.assign(fields, specificFields);
      
      // 元数据
      const metaFields = this.extractMetaFields();
      Object.assign(fields, metaFields);
      
      // 清理空值
      return this.cleanFields(fields);
    } catch (error) {
      console.error('提取字段失败:', error);
      return fields;
    }
  }

  // 提取标题
  /**
   * 读 DOM 的根（v2.11.4）。
   *
   * 默认就是当前页 document —— **20 多个站点的行为一个字都不变**：它们都没有 `this.doc`
   * 这个属性，`this.doc || document` 恒等于 document，与改造前逐字节等价。
   *
   * 唯一会变的是豆瓣影视：收藏列表页把条目详情页抓回来、用 DOMParser 解析成另一份文档，
   * 由 `DoubanMovieExtractor.setSource()` 把 `this.doc` 指过去，整套选择器原样复用。
   *
   * 为什么不在豆瓣子类里 override 每个方法：豆瓣用了基类的 extractText / extractAttribute /
   * extractDescription 等一堆 helper，逐个 override 会漏；改这一处，所有 helper 自动跟随。
   *
   * 注意 `waitForElement` 里那三处 document **故意不改**：它等的是「当前页面上某个元素出现」，
   * 换源跟它没关系。
   */
  _root() {
    return this.doc || document;
  }

  // ==================== 影视类标签统一转化库（v2.12.0） ====================
  //
  // 5 个影视站的「类型 / 题材」写法互不相同：豆瓣「纪录片」、IMDb `Documentary`、
  // TMDB「剧情 / 犯罪」、Bangumi 一堆用户散标签、红果「都市脑洞、战神归来」。
  // 统一到用户自定的 44 个标准标签，未命中的原词退回「其他信息」，一个都不丢。
  //
  // 数据源：`src/shared/tag-normalizer.js`（由 `影视类标签转化库_ruleset_v1.0.json` 生成）。
  // 放在基类里是因为五个站都要用，各站只负责「把原始词捞出来」。

  /**
   * 拿归一器。取不到返回 null —— 调用方必须原样输出原词，
   * **绝不能因为库没加载就把标签清空**（那等于静默丢数据）。
   */
  _tagLib() {
    if (typeof window !== 'undefined' && window.ClipMateTags) return window.ClipMateTags;
    if (typeof ClipMateTags !== 'undefined') return ClipMateTags;
    return null;
  }

  /**
   * 原始词 → 「标签」列要的字符串（标准词、半角逗号）。
   * @param {string} site 站点名，必须是归一器认的五个之一（豆瓣电影/IMDb/TMDB/Bangumi/红果短剧）
   * @param {string|string[]} words 站点原词
   * @param {string} [fallback] 归一器不可用时的返回值（默认原样拼回）
   */
  _standardTags(site, words, fallback) {
    const Tags = this._tagLib();
    if (!Tags) {
      if (typeof fallback === 'string') return fallback;
      if (Array.isArray(words)) return words.filter(Boolean).join(',');
      return words == null ? '' : String(words);
    }
    return Tags.normalize(site, words).tags.join(',');
  }

  /**
   * 归一后剩下的原词（D10「已知但只进其他信息」+ D11「真未命中」），
   * 用顿号连接，供各站拼进「其他信息」。
   */
  _leftoverTags(site, words) {
    const Tags = this._tagLib();
    if (!Tags) return '';
    return Tags.normalize(site, words).others.join('、');
  }

  extractTitle() {
    const selectors = [
      'h1',
      'title',
      '[property="og:title"]',
      '[name="title"]'
    ];
    
    for (const selector of selectors) {
      const element = this._root().querySelector(selector);
      if (element) {
        const text = element.textContent || element.getAttribute('content') || '';
        if (text.trim()) {
          return text.trim();
        }
      }
    }
    
    return this._root().title;
  }

  // 提取评分
  extractRating() {
    const selectors = [
      '.rating',
      '.score',
      '[class*="rating"]',
      '[class*="score"]',
      '[property="og:rating"]'
    ];
    
    for (const selector of selectors) {
      const elements = this._root().querySelectorAll(selector);
      for (const element of elements) {
        const text = element.textContent || element.getAttribute('content') || '';
        const rating = this.parseRating(text);
        if (rating) {
          return rating;
        }
      }
    }
    
    return '';
  }

  // 解析评分
  parseRating(text) {
    if (!text) return '';
    
    // 匹配数字评分（支持小数）
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (match) {
      const rating = parseFloat(match[1]);
      // 过滤不合理的评分
      if (rating >= 0 && rating <= 10) {
        return rating.toString();
      }
    }
    
    return '';
  }

  // 提取描述
  extractDescription() {
    const selectors = [
      '[property="og:description"]',
      '[name="description"]',
      '.description',
      '.summary',
      '[class*="description"]',
      '[class*="summary"]'
    ];
    
    for (const selector of selectors) {
      const element = this._root().querySelector(selector);
      if (element) {
        const text = element.textContent || element.getAttribute('content') || '';
        if (text.trim() && text.length > 10) {
          return text.trim();
        }
      }
    }
    
    return '';
  }

  // 提取元数据字段（子类实现）
  extractMetaFields() {
    return {};
  }

  // 提取特定字段（子类实现）
  async extractSpecificFields() {
    return {};
  }

  // 清理字段数据
  cleanFields(fields, forTableHeader = false) {
    const cleaned = {};
    
    for (const [key, value] of Object.entries(fields)) {
      // 表头模式：保留所有字段，包括空值字段
      if (forTableHeader) {
        // 即使值为空，也要保留字段名，以便在表格中显示所有表头
        cleaned[key] = typeof value === 'string' ? value.trim() : value;
      } 
      // 内容模式：过滤空值字段
      else if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = typeof value === 'string' ? value.trim() : value;
      }
    }
    
    return cleaned;
  }

  // 缓存数据
  setCache(key, value) {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  // 获取缓存
  getCache(key) {
    return this.cache.get(key);
  }

  // 清理字符串
  cleanText(text) {
    if (!text) return '';
    // 基础清理：替换多个连续空格为单个空格，并移除换行符
    // 注意：详细的字符过滤现在由 social-title-processor.js 处理
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\n\r]+/g, ' ')
      .trim();
  }

  // 提取文本内容
  extractText(selector, clean = true) {
    const element = this._root().querySelector(selector);
    if (!element) return '';
    
    const text = element.textContent || element.innerText || '';
    return clean ? this.cleanText(text) : text.trim();
  }

  // 提取属性值
  extractAttribute(selector, attribute) {
    const element = this._root().querySelector(selector);
    if (!element) return '';
    
    return element.getAttribute(attribute) || '';
  }

  // 等待元素加载
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  // 提取国家信息 - 共享方法，供所有子类使用
  async extractCountries() {
    try {
      // 从标签区域提取国家信息
      const tagSection = this._root().querySelector('.subject_tag_section');
      if (tagSection) {
        // 定义常见国家名称列表，包含更多可能的国家名称
        const countryKeywords = [
          "中国大陆", "中国台湾", "中国香港", "中国澳门", "中国", "香港", "台湾", "澳门",
          "日本", "韩国", "美国", "加拿大", "英国", "法国", "德国", "意大利", 
          "西班牙", "俄罗斯", "乌克兰", "白俄罗斯", "波兰", "捷克", "斯洛伐克",
          "匈牙利", "罗马尼亚", "保加利亚", "希腊", "土耳其", "埃及", "摩洛哥",
          "尼日利亚", "南非", "澳大利亚", "新西兰", "印度", "巴基斯坦", "孟加拉国",
          "泰国", "越南", "马来西亚", "新加坡", "菲律宾", "印度尼西亚",
          "巴西", "阿根廷", "智利", "墨西哥", "瑞士", "瑞典", "丹麦",
          "挪威", "芬兰", "冰岛", "比利时", "荷兰", "卢森堡", "奥地利", "葡萄牙",
          "爱尔兰"
        ];
        
        const countries = [];
        // 同时检查.l和.l.meta类的标签
        const tagLinks = tagSection.querySelectorAll('a.l, a.l.meta');
        
        // 新增：漫画类型标签识别 - 优先根据漫画类型确定国家
        for (const link of tagLinks) {
          // 获取<span>标签内的文本，排除计数信息
          const spanElement = link.querySelector('span');
          const tagText = spanElement ? spanElement.textContent.trim() : link.textContent.trim().replace(/\s+\d+$/, '');
          
          // 检查漫画类型标签并映射到对应国家
          if (tagText === "日本漫画" || tagText === "日漫") {
            if (!countries.includes("日本")) {
              countries.push("日本");
            }
          } else if (tagText === "美漫" || tagText === "美国漫画") {
            if (!countries.includes("美国")) {
              countries.push("美国");
            }
          } else if (tagText === "法漫" || tagText === "法国漫画") {
            if (!countries.includes("法国")) {
              countries.push("法国");
            }
          }
        }
        
        for (const link of tagLinks) {
          // 获取<span>标签内的文本，排除计数信息
          const spanElement = link.querySelector('span');
          const tagText = spanElement ? spanElement.textContent.trim() : link.textContent.trim().replace(/\s+\d+$/, '');
          // 检查标签是否包含国家名称（处理"国家名 数字"格式）
          for (const country of countryKeywords) {
            if (tagText && tagText.includes(country) && !countries.includes(country)) {
              // 避免否定形式的误匹配，如"非日本动画电影"
              if (tagText.startsWith("非") && tagText.includes(country)) {
                continue; // 跳过否定形式的标签
              }
              // 更严格的匹配逻辑：确保国家名称前后不是中文字符或数字
              const countryRegex = new RegExp(`[^\u4e00-\u9fa50-9]${country}[^\u4e00-\u9fa50-9]|^${country}[^\u4e00-\u9fa50-9]|[^\u4e00-\u9fa50-9]${country}$|^${country}$`, 'u');
              if (!countryRegex.test(tagText)) {
                continue;
              }
              
              // 处理中国大陆/中国台湾/中国香港/中国澳门的情况，避免重复
              if (country === "中国" && (countries.includes("中国大陆") || countries.includes("中国台湾") || 
                  countries.includes("中国香港") || countries.includes("中国澳门"))) {
                continue;
              }
              if ((country === "香港" || country === "台湾" || country === "澳门") && 
                  (countries.includes("中国香港") || countries.includes("中国台湾") || countries.includes("中国澳门"))) {
                continue;
              }
              countries.push(country);
              break; // 避免一个标签匹配多个国家
            }
          }
        }
        
        if (countries.length > 0) {
          // 使用共享的地区名称标准化方法，确保所有媒体类型保持一致的显示格式
          const originalCountriesStr = countries.join(', ');
          const countriesStr = BaseExtractor.standardizeRegionNames(countries);
          
          if (originalCountriesStr !== countriesStr) {
            if (this.logger && typeof this.logger.info === 'function') {
              this.logger.info('地区名称标准化:', originalCountriesStr, '→', countriesStr);
            }
          } else {
            if (this.logger && typeof this.logger.info === 'function') {
              this.logger.info('提取到国家信息:', countriesStr);
            }
          }
          return countriesStr;
        }
      }
      
      if (this.logger && typeof this.logger.warn === 'function') {
        this.logger.warn('未找到国家信息，国家字段将留空');
      }
      return '';
    } catch (error) {
      if (this.logger && typeof this.logger.error === 'function') {
        this.logger.error('提取国家信息失败:', error);
      }
      return '';
    }
  }
  
  /**
   * 提取"我的进度"字段
   * 默认实现：非豆瓣网站返回空字符串
   * 豆瓣各提取器（书/影/游）覆盖此方法
   * @returns {string} 空字符串 | "想看"/"在看"/"看过" | "想玩"/"在玩"/"玩过"
   */
  extractMyProgress() {
    return '';
  }

  /**
   * 从豆瓣页面容器中提取日期，并按进度状态分配到时间字段
   * 被 douban-book / douban-movie / douban-game 共享
   * @param {Object} fields - 字段对象（会被修改），需已有 '我的进度' 字段
   * @param {Object} [options] - 可选配置
   * @param {Object} [options.progressMap] - 进度值→时间字段名映射，默认为书影用
   * @param {string} [options.containerSelector] - 日期容器 CSS 选择器，默认为 '#interest_sect_level'
   * @param {Document} [options.root] - 从哪份文档读（v2.11.4）。
   *        不传就读当前页 —— 书 / 游戏两个调用方没传，行为与以前完全一致。
   *        豆瓣影视收藏列表页换源时传 `this.doc`（是**静态方法**，拿不到实例的 _root()）。
   */
  static assignProgressTimeFields(fields, options = {}) {
    const {
      progressMap = { '想看': '标记时间', '在看': '开始时间', '看过': '结束时间' },
      containerSelector = '#interest_sect_level',
      root = null
    } = options;

    const container = (root || document).querySelector(containerSelector);
    if (!container) return;

    let rawDate = '';
    const dateEl = container.querySelector('.collection_date');
    if (dateEl) {
      rawDate = dateEl.textContent.trim();
    } else {
      const grayEls = container.querySelectorAll('.color_gray');
      for (const el of grayEls) {
        const text = el.textContent.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          rawDate = text;
          break;
        }
      }
    }

    const formattedDate = rawDate ? rawDate.replace(/-/g, '/') : '';
    const progress = fields['我的进度'];
    if (progress && progressMap[progress]) {
      fields[progressMap[progress]] = formattedDate;
    }
  }
}

// 导出基础提取器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BaseExtractor;
} else {
  window.BaseExtractor = BaseExtractor;
}