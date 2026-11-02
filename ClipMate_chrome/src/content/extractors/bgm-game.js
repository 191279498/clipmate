// 番组计划(bgm.tv)游戏提取器
// 注意：在浏览器插件环境中，所有类都通过全局作用域访问

// 移除直接引用，改为在方法内部使用window.PlatformUtils，避免加载顺序问题

class BgmGameExtractor extends window.BaseExtractor {
  constructor() {
    super();
    this.siteName = 'bgm_game';
    
    // 提取器配置
    this.config = {
      // 是否在控制台打印调试信息
      debugMode: true,
      // 是否记录详细的提取过程日志
      logExtractionSteps: true,
      // 提取超时时间（毫秒）
      extractionTimeout: 5000,
      // 重试次数
      retryCount: 2
    };
    
    // 提取结果缓存
    this.extractionCache = null;
  }

  // 检查是否可在当前页面提取
  async canExtract() {
    try {
      const url = window.location.href;
      // 检查是否是番组计划的游戏页面
      return /^https:\/\/(bgm\.tv|bangumi\.tv|chii\.in)\/subject\/\d+$/.test(url) &&
             document.querySelector('#headerSubject h1 small')?.textContent === '游戏';
    } catch (error) {
      console.error('页面检测失败', error);
      return false;
    }
  }

  // 执行提取
  async extract() {
    try {
      // 检查是否可以提取
      if (!await this.canExtract()) {
        return { success: false, message: '当前页面不是番组计划游戏页面' };
      }
      
      // 执行提取
      const fields = await this.extractSpecificFields();
      
      return { success: true, data: fields };
    } catch (error) {
      console.error('番组计划游戏提取失败', error);
      return { success: false, message: '提取失败', error: error.message };
    }
  }

  // 提取特定字段
  async extractSpecificFields() {
    const fields = {};
    
    try {
      // 1. 游戏名（中文名）
      fields['游戏名'] = await this.extractGameName();
      
      // 2. 发行日期
      fields['发行日期'] = await this.extractPublishDate();
      
      // 3. 原作名（从页面标题提取，参考书籍类处理方式）
      fields['原作名'] = await this.extractOriginalTitle();
      
      // 4. 平台
      fields['平台'] = await this.extractPlatforms();
      
      // 5. 网络评分
      fields['网络评分'] = this.extractRating();
      
      // 6. 简介
      fields['简介'] = this.extractDescription();
      
      // 7. 国家/地区
      fields['国家'] = await this.extractCountries();
      
      // 8. Steam信息
      fields['Steam'] = await this.extractSteamInfo();
      
      // 9. 豆瓣链接
      fields['豆瓣链接'] = await this.extractDoubanLink();
      
      // 10. 官方网站
      fields['官方网站'] = await this.extractOfficialWebsite();
      
      // 11. URL
      fields['URL'] = window.location.href;
      
      // 12. 别名（参考书籍类处理方式）
      fields['别名'] = await this.getBgmAliases();
      
      // 13. 其他信息（合并剩余字段，参考书籍类处理方式）
      fields['其他信息'] = await this.enhancedGetBgmOtherInfo();
      
    } catch (error) {
      console.error('提取特定字段失败:', error);
    }
    
    return fields;
  }

  // 提取游戏中文名（参考书籍类处理方式）
  async extractGameName() {
    try {
      // 方法1：使用替代选择器从信息框中查找中文名
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && tipElement.textContent.includes('中文名')) {
            const gameName = item.textContent.replace(tipElement.textContent, '').trim();
            if (gameName) {
              return gameName;
            }
          }
        }
      }
      
      // 方法2：使用备用方法从标题区域提取
      const titleElement = document.querySelector('#headerSubject h1');
      if (titleElement) {
        // 首先尝试从标题中的small标签外提取
        const titleText = titleElement.textContent.replace(/游戏/g, '').trim();
        return titleText;
      }
      
      // 方法3：从页面标题提取
      const pageTitle = document.title || '';
      const titleParts = pageTitle.split('|')[0].trim().replace(/游戏/g, '');
      if (titleParts) {
        return titleParts;
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取游戏中文名失败:', error);
      return '';
    }
  }

  // 提取发行日期（参考书籍类处理方式）
  async extractPublishDate() {
    try {
      // 方法1：使用替代选择器从信息框中查找发行日期
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement) {
            const tipText = tipElement.textContent;
            // 查找包含发行日期相关文本的元素
            if (tipText.includes('发行日期') || tipText.includes('发售日')) {
              const publishDate = item.textContent.replace(tipElement.textContent, '').trim();
              if (publishDate && publishDate !== '发售日') {
                return publishDate;
              }
            }
          }
        }
      }
      
      // 方法2：查找包含日期格式的标签元素
      const datePattern = /\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日|\d{4}\.\d{1,2}\.\d{1,2}/;
      const tags = infoBox ? infoBox.querySelectorAll('li span:not(.tip)') : [];
      for (const tag of tags) {
        const tagText = tag.textContent.trim();
        if (datePattern.test(tagText)) {
          return tagText;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取发行日期失败:', error);
      return '';
    }
  }

  // 提取原作名（从页面标题提取，参考书籍类处理方式）
  async extractOriginalTitle() {
    try {
      // 方法1：从h1标签提取游戏英文名（原作名）
      const h1Element = document.querySelector('#headerSubject h1 a');
      if (h1Element) {
        const originalTitle = h1Element.textContent.trim();
        return originalTitle;
      }
      
      // 方法2：从页面标题提取
      const titleText = document.title || '';
      const titleParts = titleText.split('|')[0].trim();
      if (titleParts) {
        return titleParts;
      }
      
      // 方法3：尝试从原名字段提取
      // v2.5.48：原来是 'li:has(.tip:contains(原名)):not(.sub_container)'。
      // :contains() 是 jQuery 伪类，原生 querySelector 会抛 SyntaxError，
      // 整条方法3 从来没执行过。改为遍历 #infobox 的 li，按 .tip 文本判断。
      let originalNameElement = null;
      const infoLis = document.querySelectorAll('#infobox li');
      for (let li = 0; li < infoLis.length; li++) {
        const candidate = infoLis[li];
        if (candidate.classList.contains('sub_container')) continue;
        const candidateTip = candidate.querySelector('.tip');
        if (candidateTip && (candidateTip.textContent || '').indexOf('原名') >= 0) {
          originalNameElement = candidate;
          break;
        }
      }
      if (originalNameElement) {
        const tipElement = originalNameElement.querySelector('.tip');
        if (tipElement) {
          const originalTitle = originalNameElement.textContent.replace(tipElement.textContent, '').trim();
          if (originalTitle) {
            return originalTitle;
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取原作名失败:', error);
      return '';
    }
  }

  // 使用共享的平台工具类处理平台名称标准化
  
  // 提取平台信息（参考书籍类处理方式）
  async extractPlatforms() {
    try {
      const platforms = [];
      
      // 方法1：提取主要平台标签
      const platformTags = document.querySelectorAll('.tag.group_tag[attr-info-group="平台"]:not(.more)');
      platformTags.forEach(tag => {
        const platform = tag.textContent.trim();
        if (platform) {
          platforms.push(platform);
        }
      });
      
      // 方法2：从平台字段提取
      if (platforms.length === 0) {
        // 查找包含"平台"提示的li元素（不使用:has()选择器以提高兼容性）
        const liElements = document.querySelectorAll('li:not(.sub_container)');
        for (const li of liElements) {
          const tipElement = li.querySelector('.tip');
          if (tipElement && tipElement.textContent.includes('平台')) {
            const platformText = li.textContent.replace(tipElement.textContent, '').trim();
            if (platformText) {
              // 按逗号或顿号分割平台信息
              const platformList = platformText.split(/[,，、]/);
              platformList.forEach(platform => {
                const trimmedPlatform = platform.trim();
                if (trimmedPlatform) {
                  platforms.push(trimmedPlatform);
                }
              });
            }
            break;
          }
        }
      }
      
      // 方法3：从sub_container中的sub_grid提取平台标签
      if (platforms.length === 0) {
        const subContainers = document.querySelectorAll('li.sub_container');
        for (const container of subContainers) {
          const subSection = container.querySelector('li.sub_section .tip');
          if (subSection && subSection.textContent.includes('平台')) {
            const platformTags = container.querySelectorAll('li.sub_grid .tag');
            platformTags.forEach(tag => {
              const platform = tag.textContent.trim();
              if (platform) {
                platforms.push(platform);
              }
            });
            break;
          }
        }
      }
      
      // 使用全局的PlatformUtils进行标准化处理，添加更严格的错误处理
      let finalPlatforms = platforms;
      try {
        if (window.PlatformUtils && typeof window.PlatformUtils.standardizePlatforms === 'function') {
          finalPlatforms = window.PlatformUtils.standardizePlatforms(platforms);
        }
      } catch (platformError) {
        console.error('[BgmGameExtractor] 平台标准化处理出错:', platformError);
      }
      
      const result = finalPlatforms.join(', ');
      
      return result;
    } catch (error) {
      console.error('[BgmGameExtractor] 提取平台信息失败:', error);
      return '';
    }
  }

  // 提取网络评分
  extractRating() {
    const ratingElement = document.querySelector('.global_score .number');
    if (ratingElement) {
      const score = ratingElement.textContent.trim();
      const votesElement = document.querySelector('.chart_desc small');
      if (votesElement) {
        const votes = votesElement.textContent.trim();
        return `${score} (${votes})`;
      }
      return score;
    }
    return '';
  }

  // 提取游戏简介
  extractDescription() {
    const summaryElement = document.querySelector('#subject_summary');
    if (summaryElement) {
      return summaryElement.textContent.trim().replace(/\s+/g, ' ');
    }
    return '';
  }

  // 提取国家信息 - 直接使用BaseExtractor中的共享方法

  // 提取Steam相关信息（参考书籍类处理方式）
  async extractSteamInfo() {
    try {
      // 方法1：查找Steam链接
      const steamLink = document.querySelector('.tag.thumbTipSmall[href*="steam"]');
      if (steamLink) {
        const steamUrl = steamLink.getAttribute('href') || '';
        return steamUrl;
      }
      
      // 方法2：从链接字段查找Steam相关信息（使用兼容的DOM遍历方式）
      const subLiElements = document.querySelectorAll('li.sub');
      for (const subLi of subLiElements) {
        const tipElement = subLi.querySelector('.tip');
        if (tipElement && tipElement.textContent.includes('链接')) {
          const linkElements = subLi.querySelectorAll('a');
          for (const link of linkElements) {
            const href = link.getAttribute('href') || '';
            if (href.includes('steam')) {
              return href;
            }
          }
          break; // 找到包含链接的字段后就可以退出循环
        }
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取Steam信息失败:', error);
      return '';
    }
  }

  // 提取豆瓣链接（参考书籍类处理方式）
  async extractDoubanLink() {
    try {
      // 方法1：查找豆瓣链接
      const doubanLink = document.querySelector('.tag.thumbTipSmall[href*="douban"]');
      if (doubanLink) {
        const doubanUrl = doubanLink.getAttribute('href') || '';
        return doubanUrl;
      }
      
      // 方法2：从链接字段查找豆瓣相关信息 - 使用更兼容的DOM遍历方式
      const subItems = document.querySelectorAll('li.sub');
      for (const item of subItems) {
        const tipElement = item.querySelector('.tip');
        if (tipElement && tipElement.textContent.includes('链接')) {
          const links = item.querySelectorAll('a');
          for (const link of links) {
            const href = link.getAttribute('href') || '';
            if (href.includes('douban')) {
              return href;
            }
          }
        }
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取豆瓣链接失败:', error);
      return '';
    }
  }

  // 提取官方网站（参考书籍类处理方式）
  async extractOfficialWebsite() {
    try {
      // 方法1：使用替代选择器从信息框中查找官方网站
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        // 查找所有包含a标签的列表项
        const listItems = infoBox.querySelectorAll('li');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          const linkElement = item.querySelector('a');
          
          // 如果有提示文本且包含官方网站相关内容
          if (tipElement && tipElement.textContent.includes('官方网站') && linkElement) {
            const officialUrl = linkElement.getAttribute('href') || '';
            if (officialUrl) {
              return officialUrl;
            }
          }
          
          // 查找可能是官网的链接
          if (linkElement) {
            const href = linkElement.getAttribute('href') || '';
            const linkText = linkElement.textContent.trim();
            
            // 扩展匹配条件，增加常见官网标识
            if (linkText.includes('官网') || 
                linkText.includes('官方网站') || 
                href.includes('official') ||
                href.includes('website') ||
                linkText === 'Official Site' ||
                linkText === 'Official Website') {
              return href;
            }
          }
        }
      }
      
      // 方法2：查找所有可能的官网链接
      const allLinks = document.querySelectorAll('a');
      for (const link of allLinks) {
        const href = link.getAttribute('href') || '';
        const linkText = link.textContent.trim();
        
        // 检查是否符合常见官网链接模式
        if ((href.includes('http') || href.includes('https')) && 
            (linkText.includes('官网') || 
             linkText.includes('官方') || 
             linkText.includes('Official') ||
             href.includes('baldursgate3.game'))) {
          return href;
        }
      }
      
      return '';
    } catch (error) {
      console.error('[BgmGameExtractor] 提取官方网站失败:', error);
      return '';
    }
  }

  // 提取别名（参考书籍类处理方式）
  async getBgmAliases() {
    try {
      const aliases = new Set(); // 使用Set自动去重
      const infoBox = document.querySelector('ul#infobox');
      
      if (infoBox) {
        // 查找所有包含别名信息的元素
        const aliasElements = infoBox.querySelectorAll('li:has(span.tip)');
        
        aliasElements.forEach(item => {
          const tipEl = item.querySelector('span.tip');
          const tipText = tipEl?.textContent?.trim() || '';
          
          // 严格匹配别名字段，支持多种格式
          if (tipText === '别名: ' || tipText === '别名：' || tipText === '别名:' || tipText === '别名') {
            // 提取别名内容，排除tip元素
            const content = item.textContent.replace(tipEl.textContent, '').trim();
            
            if (content) {
              // 处理嵌套结构：如果item包含子ul，检查子项
              const subUl = item.querySelector('ul');
              if (subUl) {
                // 从子ul中提取别名
                const subItems = subUl.querySelectorAll('li');
                subItems.forEach(subItem => {
                  // 查找子项中的tip元素（可能隐藏）
                  const subTipEl = subItem.querySelector('span.tip');
                  if (subTipEl) {
                    const subContent = subItem.textContent.replace(subTipEl.textContent, '').trim();
                    if (subContent) {
                      aliases.add(subContent);
                    }
                  } else {
                    // 如果没有tip元素，直接使用内容
                    const subContent = subItem.textContent.trim();
                    if (subContent) {
                      aliases.add(subContent);
                    }
                  }
                });
              } else {
                // 按顿号拆分并添加到集合中
                const parts = content.split(/[,，、]/);
                parts.forEach(part => {
                  const trimmedPart = part.trim();
                  if (trimmedPart) {
                    aliases.add(trimmedPart);
                  }
                });
              }
            }
          }
        });
      }
      
      // 转换为数组并用顿号合并
      const result = Array.from(aliases).join('、');
      
      return result;
    } catch (error) {
      console.error('[BgmGameExtractor] 提取番组计划游戏别名失败:', error);
      return '';
    }
  }

  // 提取其他信息（与书籍模块保持一致的处理规范）
  async enhancedGetBgmOtherInfo() {
    try {
      
      // 定义需要包含在其他信息中的字段白名单及其对应的显示名称
      // 移除了'链接'字段，不再包含在其他信息中
      const fieldWhitelist = {
        '开发': '开发',
        '发行': '发行',
        '原作': '原作',
        '导演': '导演',
        '游戏类型': '游戏类型',
        '游戏引擎': '游戏引擎',
        '游玩人数': '游玩人数',
        '售价': '售价',
        '剧本': '剧本',
        '制作人': '制作人',
        '音乐': '音乐'
      };
      
      // 存储提取到的信息，键为字段名，值为显示文本
      const fieldValues = new Map();
      const infoBox = document.querySelector('ul#infobox');
      
      if (infoBox) {
        // 按DOM顺序提取字段，确保显示顺序正确
        const items = infoBox.querySelectorAll('li');
        
        items.forEach(item => {
          const tipEl = item.querySelector('span.tip');
          if (tipEl) {
            // 获取字段名（去掉冒号和空格）
            const tipText = tipEl.textContent.trim();
            
            // 检查是否在白名单中
            for (const [field, displayName] of Object.entries(fieldWhitelist)) {
              if (tipText.includes(field) || tipText === `${field}: ` || tipText === `${field}：`) {
                // 提取字段内容，排除tip元素
                const content = item.textContent.replace(tipEl.textContent, '').trim();
                
                if (content) {
                  // 清理内容：移除多余空格和换行
                  const cleanedContent = content.replace(/\s+/g, ' ').trim();
                  
                  // 避免重复添加相同字段
                  if (!fieldValues.has(field)) {
                    fieldValues.set(field, cleanedContent);
                  }
                }
                break;
              }
            }
          }
        });
      }
      
      // 按照常见的游戏信息顺序构建最终的其他信息数组
      // 移除了'链接'字段
      const orderedFields = ['开发', '发行', '原作', '导演', '游戏类型', '游戏引擎', '游玩人数', '售价', '剧本', '制作人', '音乐'];
      const otherInfo = [];
      
      // 按照预定顺序添加字段
      orderedFields.forEach(field => {
        if (fieldValues.has(field)) {
          // 使用中文冒号分隔字段名和值，与书籍模块保持一致
          otherInfo.push(`${field}：${fieldValues.get(field)}`);
        }
      });
      
      // 使用中文逗号连接各字段，与书籍模块保持一致
      const result = otherInfo.join('，').trim();
      
      // 添加详细日志记录
      if (otherInfo.length > 0) {
        otherInfo.forEach((item, index) => {
        });
      }
      
      return result;
    } catch (error) {
      console.error('[BgmGameExtractor] 提取番组计划游戏其他信息失败:', error);
      return '';
    }
  }

  // 辅助方法：提取文本内容
  extractText(selector, clean = true) {
    const element = document.querySelector(selector);
    if (!element) return '';
    
    const text = element.textContent || element.innerText || '';
    return clean ? this.cleanText(text) : text.trim();
  }

  // 辅助方法：清理文本
  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/\s+/g, ' ')
      .replace(/[\n\r]+/g, ' ')
      .trim();
  }
}

// 将提取器注册到全局作用域，确保能被提取器工厂找到
if (window) {
  // 确保提取器映射对象存在
  if (!window.extractorMap) {
    window.extractorMap = {};
  }
  
  // 注册番组计划游戏提取器
  window.extractorMap['bgm_game'] = BgmGameExtractor;
  
  // 为了兼容多个域名的识别
  if (!window.domainExtractorMap) {
    window.domainExtractorMap = {};
  }
  window.domainExtractorMap['bgm.tv'] = BgmGameExtractor;
  window.domainExtractorMap['bangumi.tv'] = BgmGameExtractor;
  window.domainExtractorMap['chii.in'] = BgmGameExtractor;
  
  // 导出提取器到全局作用域
  window.BgmGameExtractor = BgmGameExtractor;
  
}