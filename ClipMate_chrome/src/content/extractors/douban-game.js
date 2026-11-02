// 豆瓣游戏提取器
class DoubanGameExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douban_game';
    ClipMateLog.debug('===== DoubanGameExtractor 初始化 =====');
  }

  // 提取JSON-LD结构化数据
  extractJsonLdData() {
    try {
      const scriptTags = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scriptTags) {
        try {
          const data = JSON.parse(script.textContent);
          // 查找包含游戏相关信息的JSON-LD数据
          if (data['@type'] && (data['@type'].includes('VideoGame') || data['@type'].includes('Game'))) {
            return data;
          }
        } catch (e) {
          // 忽略解析错误
          console.warn('[DoubanGameExtractor] JSON-LD解析错误:', e.message);
        }
      }
    } catch (error) {
      console.error('[DoubanGameExtractor] 提取JSON-LD数据失败:', error);
    }
    return null;
  }

  // 提取游戏名称
  extractTitle() {
    
    // 方法1: 直接从h1标签提取
    const h1Title = this.extractText('h1');
    if (h1Title) {
      return h1Title;
    }
    
    // 方法2: 从JSON-LD数据提取
    const jsonLdData = this.extractJsonLdData();
    if (jsonLdData && jsonLdData.name) {
      const ldTitle = this.cleanText(jsonLdData.name);
      return ldTitle;
    }
    
    // 方法3: 从meta标签提取
    const metaTitle = this.extractAttribute('meta[property="og:title"]', 'content');
    if (metaTitle) {
      return metaTitle;
    }
    
    return super.extractTitle();
  }

  // 提取评分
  extractRating() {
    
    // 方法1: 从评分区域提取
    const ratingElement = document.querySelector('.rating_num');
    if (ratingElement) {
      const ratingText = ratingElement.textContent.trim();
      const rating = this.parseRating(ratingText);
      if (rating) {
        return rating;
      }
    }
    
    // 方法2: 从JSON-LD数据提取
    const jsonLdData = this.extractJsonLdData();
    if (jsonLdData && jsonLdData.aggregateRating && jsonLdData.aggregateRating.ratingValue) {
      const rating = this.parseRating(jsonLdData.aggregateRating.ratingValue.toString());
      if (rating) {
        return rating;
      }
    }
    
    return super.extractRating();
  }

  // 提取简介
  extractDescription() {
    
    // 方法1: 优先从豆瓣游戏特有的简介区域提取 (.mod.item-desc p)
    const descElement = document.querySelector('.mod.item-desc p');
    if (descElement) {
      const descText = this.cleanText(descElement.textContent);
      if (descText && descText.length > 30) {
        return descText;
      }
    }
    
    // 方法2: 从meta标签提取
    const metaDesc = this.extractAttribute('meta[property="og:description"]', 'content');
    if (metaDesc && metaDesc.length > 20) {
      return metaDesc;
    }
    
    // 方法3: 尝试查找其他简介区域
    const descSelectors = [
      '#link-report p',
      '.intro',
      '.summary',
      '.description',
      '.detail',
      '[class*="intro"]',
      '[class*="summary"]',
      '[class*="description"]'
    ];
    
    for (const selector of descSelectors) {
      const descText = this.extractText(selector);
      if (descText && descText.length > 30) {
        return descText;
      }
    }
    
    return super.extractDescription();
  }

  // 提取游戏类型
  extractGameType() {
    const typeElements = document.querySelectorAll('.thing-attr a[href^="/game/explore?genres="]');
    if (typeElements && typeElements.length > 0) {
      const types = Array.from(typeElements)
        .map(el => this.cleanText(el.textContent))
        .filter(type => type !== '游戏'); // 过滤掉通用的"游戏"类型
      
      if (types.length > 0) {
        const gameTypes = types.join(' / ');
        return gameTypes;
      }
    }
    return '';
  }

  // 提取游戏原作名
  extractOriginalTitle() {
    
    // 增强的标题验证函数
    const isValidOriginalTitle = (text) => {
      if (!text || text.length < 2 || text.length > 100) return false;
      // 包含非中文字符
      if (!/[^\u4e00-\u9fa5]/.test(text)) return false;
      // 必须含真实字母（拉丁 / 日文假名 / 韩文）。
      // 否则「视频，攻略，评测，图片」这种中文标点串会被当成"非中文"而误判成原作名。
      if (!/[A-Za-z\u3040-\u30ff\uac00-\ud7af]/.test(text)) return false;
      // 不是纯数字或特殊字符
      if (/^[\d\s.,!?'"\-]+$/.test(text)) return false;
      return true;
    };

    // 平台 / 设备名不算原作名：豆瓣游戏页的 meta keywords 里常混着
    // iPhone、iPad、Android 这类平台词（例如《潜伏之赤途》的关键词是
    // 「潜伏之赤途, 潜伏之赤途, 赤途, iPhone, iPad, Android, …」），
    // 旧逻辑按 includes 判断，排除表里又没有 iPhone / iPad，于是原作名会被写成「iPhone」。
    const PLATFORM_KEYWORDS = [
      'PC', 'Windows', 'Mac', 'Linux', 'Steam',
      'PS', 'PS2', 'PS3', 'PS4', 'PS5', 'PSP', 'PSV', 'PS Vita',
      'Xbox', 'Xbox One', 'Xbox Series', 'Nintendo', 'Switch', 'Wii', 'WiiU', '3DS', 'N3DS',
      'iOS', 'iPhone', 'iPad', 'iPadOS', 'Android', '安卓',
      '浏览器', '手机', '移动端'
    ];
    const normalizeName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const platformList = PLATFORM_KEYWORDS.map(normalizeName);

    // 整体就是平台名，或整串全部由平台名拼成（如 "iPhone, iPad"）时判定为平台名。
    // 注意不能退回 includes：否则 "PC Building Simulator" 这类真原作名会被误杀。
    const isPlatformName = (text) => {
      const raw = normalizeName(text);
      if (!raw) return false;
      if (platformList.includes(raw)) return true;
      const tokens = raw.split(/[\s,，、/|+]+/).filter(Boolean);
      return tokens.length > 1 && tokens.every(tok => platformList.includes(tok));
    };
    
    // 1. 从h1标题中提取原作名（中文名称 外国名称格式）
    try {
      const h1Element = document.querySelector('h1');
      if (h1Element) {
        const h1Text = this.cleanText(h1Element.textContent);
        // 尝试分离中英文标题
        const titleParts = h1Text.split(' ');
        if (titleParts.length > 1) {
          // 找到第一个非中文部分作为潜在的原作名
          let potentialOriginalTitle = '';
          let hasNonChinese = false;
          
          for (let i = 1; i < titleParts.length; i++) {
            const part = titleParts[i].trim();
            if (part && !/^[\u4e00-\u9fa5]+$/.test(part)) {
              if (potentialOriginalTitle) potentialOriginalTitle += ' ';
              potentialOriginalTitle += part;
              hasNonChinese = true;
            }
          }
          
          if (hasNonChinese && isValidOriginalTitle(potentialOriginalTitle) && !isPlatformName(potentialOriginalTitle)) {
            return potentialOriginalTitle;
          }
        }
      }
    } catch (error) {
      console.error('[DoubanGameExtractor] 从h1标题提取原作名失败:', error);
    }
    
    // 2. 从meta keywords中提取原作名
    try {
      const metaKeywords = document.querySelector('meta[name="keywords"]');
      if (metaKeywords && metaKeywords.getAttribute('content')) {
        const keywords = metaKeywords.getAttribute('content').split(',');
        for (let i = 1; i < keywords.length; i++) {
          const potentialOriginalTitle = keywords[i].trim();
          // 检查是否为非中文名称，且不是平台名称
          if (isValidOriginalTitle(potentialOriginalTitle) && !isPlatformName(potentialOriginalTitle)) {
            return potentialOriginalTitle;
          }
        }
      }
    } catch (error) {
      console.error('[DoubanGameExtractor] 从meta keywords提取原作名失败:', error);
    }
    
    // 3. 从页面标题中提取原作名
    try {
      const pageTitle = document.title;
      if (pageTitle) {
        // 尝试匹配多种标题格式
        const titlePatterns = [
          /([^\s(]+)\s+([^\s(]+)\s*\(豆瓣\)/, // 中文 外文 (豆瓣)
          /([^\s(]+)\s+(.+)\s*\(豆瓣\)/,     // 中文 多个词的外文 (豆瓣)
        ];
        
        for (const pattern of titlePatterns) {
          const titleMatch = pageTitle.match(pattern);
          if (titleMatch && titleMatch.length > 2) {
            const potentialTitle = titleMatch[2].trim();
            if (isValidOriginalTitle(potentialTitle) && !isPlatformName(potentialTitle)) {
              return potentialTitle;
            }
          }
        }
      }
    } catch (error) {
      console.error('[DoubanGameExtractor] 从页面标题提取原作名失败:', error);
    }
    
    // 4. 尝试从JSON-LD数据中提取（如果存在）
    try {
      const jsonLdData = this.extractJsonLdData();
      if (jsonLdData) {
        // 检查name字段
        if (jsonLdData.name) {
          const nameText = this.cleanText(jsonLdData.name);
          // 尝试分离中英文标题
          const nameParts = nameText.split(' ');
          if (nameParts.length > 1) {
            let potentialOriginalTitle = '';
            let hasNonChinese = false;
            
            for (let i = 1; i < nameParts.length; i++) {
              const part = nameParts[i].trim();
              if (part && !/^[\u4e00-\u9fa5]+$/.test(part)) {
                if (potentialOriginalTitle) potentialOriginalTitle += ' ';
                potentialOriginalTitle += part;
                hasNonChinese = true;
              }
            }
            
            if (hasNonChinese && isValidOriginalTitle(potentialOriginalTitle) && !isPlatformName(potentialOriginalTitle)) {
              return potentialOriginalTitle;
            }
          }
        }
        
        // 检查alternateName字段
        if (jsonLdData.alternateName) {
          const alternateName = this.cleanText(jsonLdData.alternateName);
          if (isValidOriginalTitle(alternateName) && !isPlatformName(alternateName)) {
            return alternateName;
          }
        }
      }
    } catch (error) {
      console.error('[DoubanGameExtractor] 从JSON-LD提取原作名失败:', error);
    }
    
    return '';
  }

  // 提取游戏别名
  extractAlias() {
    
    try {
      // 方法1: 从.thing-attr中的别名标签提取
      const dtElements = document.querySelectorAll('.thing-attr dt');
      
      for (let i = 0; i < dtElements.length; i++) {
        const dt = dtElements[i];
        const dtText = dt.textContent.trim();
        
        // 查找包含"别名"文本的dt元素
        if (dtText === '别名:' || dtText.indexOf('别名') !== -1) {
          
          const dd = dt.nextElementSibling;
          if (dd && dd.tagName === 'DD') {
            
            // 提取dd元素的纯文本内容
            const aliasText = this.cleanText(dd.textContent);
            
            if (aliasText) {
              // 处理可能的多个别名（用分隔符分割）
              const aliases = aliasText.split(/[,，、/]/)
                .map(alias => alias.trim())
                .filter(alias => alias !== '');
              
              if (aliases.length > 0) {
                const formattedAliases = aliases.join(', ');
                return formattedAliases;
              }
            }
          } else {
          }
        }
      }
      
      // 方法2: 备用方案 - 从整个.thing-attr区域搜索别名信息
      const thingAttrElement = document.querySelector('.thing-attr');
      if (thingAttrElement) {
        const thingAttrText = thingAttrElement.textContent;
        
        // 使用正则表达式匹配别名模式
        const aliasMatch = thingAttrText.match(/别名[:：]\s*([^\n]+)/);
        if (aliasMatch) {
          const aliasText = this.cleanText(aliasMatch[1]);
          
          if (aliasText) {
            const aliases = aliasText.split(/[,，、/]/)
              .map(alias => alias.trim())
              .filter(alias => alias !== '');
            
            if (aliases.length > 0) {
              const formattedAliases = aliases.join(', ');
              return formattedAliases;
            }
          }
        } else {
        }
      }
      
    } catch (error) {
      console.error('[DoubanGameExtractor] [ALIAS_DEBUG] 提取别名时发生错误:', error);
    }
    
    return '';
  }

  // 提取平台信息
  extractPlatforms() {
    
    try {
      // 方法1: 优先从.thing-attr中的平台标签提取
      const dtElements = document.querySelectorAll('.thing-attr dt');
      for (let i = 0; i < dtElements.length; i++) {
        const dt = dtElements[i];
        const dtText = dt.textContent.trim();
        
        // 查找包含"平台"文本的dt元素
        if (dtText === '平台:' || dtText.indexOf('平台') !== -1) {
          const dd = dt.nextElementSibling;
          if (dd && dd.tagName === 'DD') {
            // 提取dd元素中的所有平台a标签
            const platformLinks = dd.querySelectorAll('a');
            if (platformLinks && platformLinks.length > 0) {
              const platforms = Array.from(platformLinks)
                .map(el => this.cleanText(el.textContent))
                .filter(p => p !== '');
              
              if (platforms.length > 0) {
                // 使用逗号作为分隔符合并平台信息
                const formattedPlatforms = platforms.join(',');
                return formattedPlatforms;
              }
            }
            
            // 如果没有a标签，则提取dd元素的纯文本内容
            const ddText = this.cleanText(dd.textContent);
            if (ddText) {
              // 使用正则表达式处理多种分隔符
              const platforms = ddText.split(/[,，、/\\s]+/)
                .map(p => p.trim())
                .filter(p => p !== '');
              
              if (platforms.length > 0) {
                const formattedPlatforms = platforms.join(',');
                return formattedPlatforms;
              }
            }
          }
          break;
        }
      }
      
      // 方法2: 从链接中提取平台信息
      const platformElements = document.querySelectorAll('.thing-attr a[href^="/game/explore?platforms="]');
      if (platformElements && platformElements.length > 0) {
        const platforms = Array.from(platformElements)
          .map(el => this.cleanText(el.textContent))
          .filter(p => p !== '');
        
        if (platforms.length > 0) {
          const formattedPlatforms = platforms.join(',');
          return formattedPlatforms;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[DoubanGameExtractor] 提取平台信息时出错:', error.message || error);
      return '';
    }
  }

  // 提取开发商信息
  extractDeveloper() {
    const devText = this.extractAttributeValueByLabel('开发商');
    return devText;
  }

  // 提取发行商信息
  extractPublisher() {
    const pubText = this.extractAttributeValueByLabel('发行商');
    return pubText;
  }

  // 提取发行日期
  extractReleaseDate() {
    
    // 方法1: 优先提取"发行日期"标签对应的值（处理带冒号和不带冒号的情况）
    let dateText = this.extractAttributeValueByLabel('发行日期');
    
    // 方法2: 如果没有找到发行日期，尝试提取"预计上市时间"
    if (!dateText) {
      dateText = this.extractAttributeValueByLabel('预计上市时间');
    }
    
    // 方法3: 增强的备用方法 - 更精确地查找日期元素
    if (!dateText) {
      
      // 1. 先尝试找到.thing-attr容器内的所有dt-dd对
      const attrContainer = document.querySelector('.thing-attr');
      if (attrContainer) {
        // 优先查找明确标记为"发行日期"的元素
        const releaseDateDts = attrContainer.querySelectorAll('dt');
        for (const dt of releaseDateDts) {
          const dtText = dt.textContent.trim();
          if (dtText.includes('发行日期')) {
            const dd = dt.nextElementSibling;
            if (dd && dd.tagName === 'DD') {
              const ddText = this.cleanText(dd.textContent);
              // 检查是否包含有效的日期格式
              if (ddText && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(ddText)) {
                dateText = ddText;
                return dateText; // 立即返回，确保优先级
              }
            }
          }
        }
        
        // 如果没有找到明确的"发行日期"标签，继续查找其他日期相关标签
        const allDts = attrContainer.querySelectorAll('dt');
        for (let i = 0; i < allDts.length; i++) {
          const dt = allDts[i];
          const dtText = dt.textContent.trim();
          
          // 检查是否包含日期相关关键词
          if (dtText.includes('上市') || dtText.includes('发售')) {
            const dd = dt.nextElementSibling;
            if (dd && dd.tagName === 'DD') {
              const ddText = this.cleanText(dd.textContent);
              // 检查内容是否包含日期格式
              if (ddText && /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(ddText)) {
                dateText = ddText;
                break;
              }
            }
          }
        }
      }
      
      // 2. 如果上述方法仍然失败，尝试更宽泛的搜索
      if (!dateText) {
        
        // 查找特定的游戏信息区域
        const gameInfoSections = document.querySelectorAll('.subject-info, .game-info, .info');
        for (const section of gameInfoSections) {
          const textContent = section.textContent;
          
          // 优先匹配"发行日期"
          const releaseDateMatch = textContent.match(/发行日期[^\n]*?(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
          if (releaseDateMatch && releaseDateMatch[1]) {
            dateText = releaseDateMatch[1];
            return dateText; // 立即返回，确保优先级
          }
          
          // 如果没有找到发行日期，再尝试匹配其他日期
          const dateMatch = textContent.match(/(?:上市时间|发售日期)[^\n]*?(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i);
          if (dateMatch && dateMatch[1]) {
            dateText = dateMatch[1];
            break;
          }
        }
      }
    }
    
    return dateText;
  }

  // 根据标签文本提取对应的值（增强版本，支持带冒号和部分匹配）
  extractAttributeValueByLabel(labelText) {
    const labelElements = document.querySelectorAll('.thing-attr dt');
    for (const labelEl of labelElements) {
      const elementText = labelEl.textContent.trim();
      // 支持完全匹配或标签文本包含搜索的文本
      if (elementText === labelText || elementText === labelText + ':' || elementText.includes(labelText)) {
        const valueEl = labelEl.nextElementSibling;
        if (valueEl && valueEl.tagName === 'DD') {
          return this.cleanText(valueEl.textContent);
        }
      }
    }
    return '';
  }

  // 提取特定字段
  async extractSpecificFields() {
    const fields = {};
    
    // 游戏基本信息
    fields['游戏名'] = this.extractTitle();
    fields['平台'] = this.extractPlatforms();
    fields['发行日期'] = this.extractReleaseDate();
    fields['豆瓣链接'] = window.location.href;
    fields['URL'] = ''; // URL字段留空
    
    // 提取原作名信息
    const originalTitle = this.extractOriginalTitle();
    if (originalTitle) {
      fields['原作名'] = originalTitle;
    }
    
    // 提取别名信息
    const alias = this.extractAlias();
    if (alias) {
      fields['别名'] = alias;
    }
    
    // 将游戏类型、开发商和发行商合并到其他信息字段
    const gameType = this.extractGameType();
    const developer = this.extractDeveloper();
    const publisher = this.extractPublisher();
    
    // 构建其他信息字符串
    const otherInfoParts = [];
    if (gameType) otherInfoParts.push(`游戏类型：${gameType}`);
    if (developer) otherInfoParts.push(`开发商：${developer}`);
    if (publisher) otherInfoParts.push(`发行商：${publisher}`);
    
    // 如果有其他信息，则添加到字段中
    if (otherInfoParts.length > 0) {
      fields['其他信息'] = otherInfoParts.join('，');
    }
    fields['我的进度'] = this.extractMyProgress();
    BaseExtractor.assignProgressTimeFields(fields, {
      containerSelector: '.collection-section',
      progressMap: { '想玩': '标记时间', '在玩': '开始时间', '玩过': '结束时间' }
    });
    
    // 清理空值字段
    const cleanedFields = this.cleanFields(fields);
    ClipMateLog.debug('[DoubanGameExtractor] 特定字段提取完成，共提取字段数:', Object.keys(cleanedFields).length);
    return cleanedFields;
  }

  /**
   * 提取"我的进度"字段
   * 豆瓣游戏使用 .collection-section > .collection-collected > .collection-result 容器
   * @returns {string} "想玩"|"在玩"|"玩过"|""
   */
  extractMyProgress() {
    try {
      const resultEl = document.querySelector('.collection-result');
      if (!resultEl) return '';
      const text = resultEl.textContent;
      if (text.includes('想玩')) return '想玩';
      if (text.includes('在玩')) return '在玩';
      if (text.includes('玩过')) return '玩过';
      return '';
    } catch (e) {
      return '';
    }
  }

  // 提取元数据字段
  extractMetaFields() {
    const metaFields = {};
    
    // 不添加站点信息和提取时间
    
    return metaFields;
  }

  // 提取所有字段（重写父类方法以添加日志）
  async extractAllFields() {
    ClipMateLog.debug('===== DoubanGameExtractor 开始提取所有字段 =====');
    try {
      const allFields = await super.extractAllFields();
      
      
      return allFields;
    } catch (error) {
      console.error('[DoubanGameExtractor] 提取字段失败:', error);
      throw error;
    } finally {
      ClipMateLog.debug('===== DoubanGameExtractor 提取过程结束 =====');
    }
  }
}

// 导出提取器类
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = DoubanGameExtractor;
} else if (typeof window !== 'undefined') {
  window.DoubanGameExtractor = DoubanGameExtractor;
}