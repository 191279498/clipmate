// Steam游戏提取器

// 移除直接引用，改为在方法内部使用window.PlatformUtils，避免加载顺序问题
class SteamExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'steam';
  }
  
  // 提取Steam评价等级和好评率
  extractSteamReviewInfo() {
    try {
      // 查找评价等级元素
      const reviewSummaryElement = document.querySelector('.game_review_summary, .review_summary');
      if (reviewSummaryElement) {
        // 评价等级文本
        const reviewLevel = reviewSummaryElement.textContent.trim();
        
        // 查找好评率
        let positivePercentage = 0;
        const percentageElements = document.querySelectorAll('.nonresponsive_hidden, .user_reviews_summary_row');
        for (const element of percentageElements) {
          const text = element.textContent;
          const percentageMatch = text.match(/(\d+)%/);
          if (percentageMatch) {
            positivePercentage = parseInt(percentageMatch[1]);
            break;
          }
        }
        
        // 如果没找到百分比，尝试从隐藏数据中获取
        if (!positivePercentage) {
          const numPositiveReviews = parseInt(document.querySelector('[data-itemprop="reviewCount"]')?.getAttribute('data-count') || 
                                            document.querySelector('[id*="review_summary_num_positive_reviews"]')?.value || '0');
          const numReviews = parseInt(document.querySelector('[id*="review_summary_num_reviews"]')?.value || '0');
          
          if (numReviews > 0) {
            positivePercentage = Math.round((numPositiveReviews / numReviews) * 100);
          }
        }
        
        return {
          reviewLevel,
          positivePercentage
        };
      }
    } catch (error) {
      console.error('提取Steam评价信息失败:', error);
    }
    
    return {
      reviewLevel: '',
      positivePercentage: 0
    };
  }
  
  // 将Steam评价等级转换为10分制评分
  convertReviewLevelToScore(reviewLevel, positivePercentage) {
    // 根据Steam评价等级和好评率计算10分制评分
    let score = 0;
    
    // 首先根据文字评价等级确定基础区间
    const levelMap = {
      '好评如潮': { min: 9.5, max: 10 },
      '特别好评': { min: 8, max: 9.5 },
      '多半好评': { min: 7, max: 8 },
      '褒贬不一': { min: 4, max: 7 },
      '多半差评': { min: 2, max: 4 },
      '差评如潮': { min: 0, max: 2 }
    };
    
    // 如果能识别评价等级
    if (reviewLevel && levelMap[reviewLevel]) {
      const range = levelMap[reviewLevel];
      // 根据好评率在区间内线性映射
      if (positivePercentage > 0) {
        // 根据不同等级的百分比范围进行映射
        let percentageBase = 0;
        let percentageTop = 100;
        
        switch (reviewLevel) {
          case '好评如潮':
            percentageBase = 95;
            break;
          case '特别好评':
            percentageBase = 80;
            percentageTop = 95;
            break;
          case '多半好评':
            percentageBase = 70;
            percentageTop = 80;
            break;
          case '褒贬不一':
            percentageBase = 40;
            percentageTop = 70;
            break;
          case '多半差评':
            percentageBase = 20;
            percentageTop = 40;
            break;
          case '差评如潮':
            percentageTop = 20;
            break;
        }
        
        // 计算在等级内的相对位置
        const relativePosition = (positivePercentage - percentageBase) / (percentageTop - percentageBase);
        score = range.min + (relativePosition * (range.max - range.min));
      } else {
        // 如果没有好评率，使用区间中间值
        score = (range.min + range.max) / 2;
      }
    } else if (positivePercentage > 0) {
      // 如果只有好评率，直接映射到0-10分
      score = positivePercentage / 10;
    }
    
    // 保留一位小数
    return parseFloat(score.toFixed(1));
  }

  // 提取官方网站URL
  extractOfficialWebsite() {
    try {
      // 查找包含"访问网站"文本的链接
      const websiteLinks = document.querySelectorAll('.linkbar');
      for (const link of websiteLinks) {
        const text = link.textContent || '';
        if (text.includes('访问网站') && link.hasAttribute('href')) {
          const href = link.getAttribute('href');
          
          // 检查是否是Steam链接过滤器
          if (href.startsWith('https://steamcommunity.com/linkfilter/?u=')) {
            // 提取并解码真实URL
            const encodedUrl = href.split('https://steamcommunity.com/linkfilter/?u=')[1];
            if (encodedUrl) {
              // 解码URL
              const decodedUrl = decodeURIComponent(encodedUrl);
              return decodedUrl;
            }
          } else {
            // 如果不是链接过滤器，直接返回
            return href;
          }
        }
      }
    } catch (error) {
      console.error('提取官方网站失败:', error);
    }
    return '';
  }

  async extractSpecificFields() {
    const fields = {};
    
    try {
      // 游戏名
      fields['游戏名'] = this.extractGameTitle();
      
      // 别名
      fields['别名'] = this.extractAliases();
      
      // 国家/地区信息
      fields['国家'] = '';
      
      // 发行日期
      fields['发行日期'] = this.extractReleaseDate();
      
      // 开发商和发行商信息（放入其他信息中）
      const publishers = this.extractPublishers();
      if (publishers['开发商'] || publishers['发行商']) {
        let otherInfo = [];
        if (publishers['开发商']) otherInfo.push(`开发商：${publishers['开发商']}`);
        if (publishers['发行商']) otherInfo.push(`发行商：${publishers['发行商']}`);
        fields['其他信息'] = otherInfo.join('，');
      }
      
      // 平台信息
      fields['平台'] = this.extractPlatforms();
      
      // 标签信息（放入其他信息中）
      const tags = this.extractTags();
      if (tags) {
        const tagText = `标签：${tags}`;
        fields['其他信息'] = fields['其他信息'] ? `${fields['其他信息']}，${tagText}` : tagText;
      }
      
      // 提取Steam评价信息并转换为10分制评分
      const reviewInfo = this.extractSteamReviewInfo();
      if (reviewInfo.reviewLevel || reviewInfo.positivePercentage > 0) {
        const score = this.convertReviewLevelToScore(reviewInfo.reviewLevel, reviewInfo.positivePercentage);
        fields['网络评分'] = score;
        
        // 将评价等级和好评率添加到其他信息中
        const reviewText = `Steam评价：${reviewInfo.reviewLevel || ''}${reviewInfo.positivePercentage > 0 ? ` (${reviewInfo.positivePercentage}%)` : ''}`;
        fields['其他信息'] = fields['其他信息'] ? `${fields['其他信息']}，${reviewText}` : reviewText;
      }
      
      // Steam链接
      fields['Steam'] = window.location.href;
      
      // 价格信息（放入其他信息中）
      const price = this.extractPrice();
      if (price) {
        const priceText = `价格：${price}`;
        fields['其他信息'] = fields['其他信息'] ? `${fields['其他信息']}，${priceText}` : priceText;
      }
      
      // 官方网站
      fields['官方网站'] = this.extractOfficialWebsite();
      
      // URL
      fields['URL'] = window.location.href;
      
      return fields;
    } catch (error) {
      console.error('Steam游戏提取失败:', error);
      return fields;
    }
  }

  extractGameTitle() {
    const selectors = [
      '.apphub_AppName',
      '#appHubAppName',
      'h1.pageheader',
      '.page_title_area h1'
    ];
    
    for (const selector of selectors) {
      const title = this.extractText(selector);
      if (title) {
        return this.cleanGameTitle(title);
      }
    }
    
    // 从页面标题中提取
    const pageTitle = document.title;
    const titleMatch = pageTitle.match(/^(.+?)\s*on\s*Steam$/);
    if (titleMatch) {
      return titleMatch[1].trim();
    }
    
    return pageTitle.replace(' on Steam', '').trim();
  }

  cleanGameTitle(title) {
    if (!title) return '';
    
    // 移除常见后缀
    title = title.replace(/\s*-\s*Steam$/i, '');
    title = title.replace(/\s*\|\s*Steam$/i, '');
    
    return title.trim();
  }

  extractReleaseDate() {
    const selectors = [
      '.date',
      '.release_date .date',
      '#game_highlights .release_date .date',
      '.glance_ctn_responsive_left .release_date .date'
    ];
    
    for (const selector of selectors) {
      const date = this.extractText(selector);
      if (date && date.toLowerCase() !== 'coming soon') {
        return this.formatSteamDate(date);
      }
    }
    
    // 从页面文本中查找
    const pageText = document.body.textContent;
    const datePatterns = [
      /Release Date:\s*([^\n]+)/i,
      /Released:\s*([^\n]+)/i,
      /(\w+\s+\d{1,2},\s+\d{4})/,
      /(\d{1,2}\s+\w+\s+\d{4})/
    ];
    
    for (const pattern of datePatterns) {
      const match = pageText.match(pattern);
      if (match) {
        return this.formatSteamDate(match[1]);
      }
    }
    
    return '';
  }

  formatSteamDate(dateStr) {
    if (!dateStr) return '';
    
    // 清理日期字符串
    dateStr = dateStr.trim();
    
    // 处理 "Coming Soon" 等情况
    if (dateStr.toLowerCase().includes('coming') || 
        dateStr.toLowerCase().includes('soon') ||
        dateStr.toLowerCase().includes('tbd')) {
      return dateStr;
    }
    
    // 尝试解析日期
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    } catch (e) {
      // 忽略解析错误
    }
    
    return dateStr;
  }

  extractPublishers() {
    const fields = {};
    
    try {
      // 开发商
      const developerSelectors = [
        '#developers_list a',
        '.dev_row a',
        '.details_block .dev_row a'
      ];
      
      for (const selector of developerSelectors) {
        const developer = this.extractText(selector);
        if (developer) {
          fields['开发商'] = developer;
          break;
        }
      }
      
      // 发行商
      // 先尝试使用位置选择器
      let publisher = this.extractText('.details_block .dev_row:nth-child(2) a');
      
      // 如果没找到，手动查找包含Publisher文本的行
      if (!publisher || publisher === fields['开发商']) {
        const devRows = document.querySelectorAll('.dev_row');
        for (const row of devRows) {
          if (row.textContent.includes('Publisher')) {
            const links = row.querySelectorAll('a');
            if (links.length > 0) {
              publisher = this.cleanText(links[0].textContent);
              break;
            }
          }
        }
      }
      
      // 最后尝试使用备用选择器
      if (!publisher || publisher === fields['开发商']) {
        publisher = this.extractText('.glance_ctn_responsive_left .dev_row:nth-child(2)');
      }
      
      // 设置发行商字段
      if (publisher && publisher !== fields['开发商']) {
        fields['发行商'] = publisher;
      }
      
    } catch (error) {
      console.error('提取发行商信息失败:', error);
    }
    
    return fields;
  }

  // 使用共享的平台工具类处理平台名称标准化

  extractPlatforms() {
    const platforms = [];
    
    try {
      // 检查平台图标
      const platformElements = document.querySelectorAll(
        '.game_area_purchase_platform span, .platform_img, [class*="platform"]'
      );
      
      platformElements.forEach(element => {
        const className = element.className;
        const title = element.getAttribute('title') || element.textContent;
        
        if (className.includes('win') || title.toLowerCase().includes('windows')) {
          platforms.push('Windows');
        } else if (className.includes('mac') || title.toLowerCase().includes('mac')) {
          platforms.push('macOS');
        } else if (className.includes('linux') || title.toLowerCase().includes('linux')) {
          platforms.push('Linux');
        }
      });
      
      // 如果没有找到平台信息，检查页面文本
      if (platforms.length === 0) {
        const pageText = document.body.textContent.toLowerCase();
        
        if (pageText.includes('windows')) platforms.push('Windows');
        if (pageText.includes('mac') || pageText.includes('macos')) platforms.push('macOS');
        if (pageText.includes('linux')) platforms.push('Linux');
        if (pageText.includes('steam deck')) platforms.push('Steam Deck');
      }
      
      // 去重
      const uniquePlatforms = [...new Set(platforms)];
      
      // 使用全局的PlatformUtils进行标准化处理，添加严格的错误处理
      try {
        if (window.PlatformUtils && typeof window.PlatformUtils.standardizePlatforms === 'function') {
          const finalPlatforms = window.PlatformUtils.standardizePlatforms(uniquePlatforms);
          return finalPlatforms.join(', ');
        }
      } catch (platformError) {
        console.error('[SteamExtractor] 平台标准化处理出错:', platformError);
      }
      
      // 如果PlatformUtils不可用或出错，返回原始去重后的平台列表
      console.warn('[SteamExtractor] PlatformUtils不可用或出错，返回原始平台列表');
      return uniquePlatforms.join(', ');
      
    } catch (error) {
      console.error('提取平台信息失败:', error);
      return [...new Set(platforms)].join(', ');
    }
  }

  extractTags() {
    const tags = [];
    
    try {
      // 查找标签元素
      const tagSelectors = [
        '.app_tag',
        '.popular_tags .app_tag',
        '#game_highlights .app_tag',
        '.glance_tags_ctn .app_tag'
      ];
      
      tagSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(element => {
          const tag = this.cleanText(element.textContent);
          if (tag && !tags.includes(tag)) {
            tags.push(tag);
          }
        });
      });
      
      // 限制标签数量
      return tags.slice(0, 10).join('、');
      
    } catch (error) {
      console.error('提取标签失败:', error);
      return '';
    }
  }

  extractPrice() {
    const selectors = [
      '.game_purchase_price',
      '.discount_original_price',
      '.discount_final_price',
      '.price'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const price = this.cleanText(element.textContent);
        if (price && price !== 'Free' && !price.toLowerCase().includes('free')) {
          return price;
        }
      }
    }
    
    // 检查免费游戏
    const freeElements = document.querySelectorAll('[class*="free"]');
    for (const element of freeElements) {
      const text = element.textContent.toLowerCase();
      if (text.includes('free') || text.includes('免费')) {
        return 'Free';
      }
    }
    
    return '';
  }

  // 移除元数据字段提取
  extractMetaFields() {
    // 返回空对象，不再提取用户标签和系统需求
    return {};
  }

  extractAppId() {
    // 从URL中提取app ID
    const urlMatch = window.location.href.match(/\/app\/(\d+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    
    // 从页面元素中提取
    const appIdElements = document.querySelectorAll('[data-appid]');
    for (const element of appIdElements) {
      const appId = element.getAttribute('data-appid');
      if (appId) {
        return appId;
      }
    }
    
    return '';
  }

  extractUserTags() {
    const tags = [];
    
    try {
      const tagElements = document.querySelectorAll(
        '.user_tags_voting .app_tag_control popular_tags .app_tag'
      );
      
      tagElements.forEach(element => {
        const tag = this.cleanText(element.textContent);
        if (tag) {
          tags.push(tag);
        }
      });
      
      return tags.slice(0, 5).join(', ');
      
    } catch (error) {
      return '';
    }
  }

  extractSystemRequirements() {
    try {
      const reqElements = document.querySelectorAll('.game_area_sys_req_leftCol, .game_area_sys_req_rightCol');
      const requirements = [];
      
      reqElements.forEach(element => {
        const title = element.querySelector('h2, .title');
        const content = element.querySelector('.sysreq_contents');
        
        if (title && content) {
          const titleText = this.cleanText(title.textContent);
          const contentText = this.cleanText(content.textContent);
          requirements.push(`${titleText}: ${contentText.substring(0, 100)}...`);
        }
      });
      
      return requirements.join('; ');
      
    } catch (error) {
      return '';
    }
  }
  
  // 提取游戏别名
  extractAliases() {
    const aliases = [];
    const mainTitle = this.extractGameTitle();
    
    
    try {
      // 方法1: 检查不同语言的标题
      const languageTitleElements = document.querySelectorAll('.apphub_AppName, .pageheader, .page_title_area h1');
      
      languageTitleElements.forEach((element, index) => {
        if (element) {
          const title = this.cleanText(element.textContent);
          
          if (title && title !== mainTitle && title.trim().length > 0) {
            aliases.push(title);
          }
        }
      });
      
      
      // 方法2: 检查页面描述中的其他名称
      const descriptionElements = document.querySelectorAll('.game_description_snippet, .game_description, .about_game');
      
      descriptionElements.forEach((element, index) => {
        if (element) {
          const text = element.textContent;
          
          // 查找可能的别名模式
          const aliasPatterns = [
            /also known as\s*["'《》「」](.+?)["'《》「」]/i,
            /别名\s*[:：]?\s*["'《》「」](.+?)["'《》「」]/,
            /又名\s*[:：]?\s*["'《》「」](.+?)["'《》「」]/,
            /原题\s*[:：]?\s*["'《》「」](.+?)["'《》「」]/
          ];
          
          aliasPatterns.forEach((pattern, patternIndex) => {
            const match = text.match(pattern);
            
            if (match && match[1] && match[1] !== mainTitle) {
              const alias = match[1].trim();
              aliases.push(alias);
            }
          });
        }
      });
      
      
      // 方法3: 检查元数据
      const metaTags = document.querySelectorAll('meta[property*="title"], meta[name*="title"]');
      
      metaTags.forEach((tag, index) => {
        const property = tag.getAttribute('property');
        const name = tag.getAttribute('name');
        const content = tag.getAttribute('content');
        
        
        if (content && content !== mainTitle && content !== document.title) {
          // 清理内容，移除" on Steam"等后缀
          const cleanContent = content.replace(/\s*on\s*Steam$/i, '').replace(/\s*\|\s*Steam$/i, '').trim();
          
          
          if (cleanContent && cleanContent !== mainTitle && cleanContent.length > 0) {
            aliases.push(cleanContent);
          }
        }
      });
      
      
      // 去重并限制数量
      const uniqueAliases = [...new Set(aliases)];
      const finalAliases = uniqueAliases.slice(0, 5);
      const result = finalAliases.join(', ');
      
      
      return result;
      
    } catch (error) {
      console.error('[SteamExtractor] [ALIAS_DEBUG] 提取游戏别名失败:', error, { errorStack: error.stack });
      return '';
    }
  }
}

// 导出Steam提取器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SteamExtractor;
} else {
  window.SteamExtractor = SteamExtractor;
}