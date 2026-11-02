// 起点中文网书籍提取器
class QidianBookExtractor extends window.BaseExtractor {
  constructor() {
    super();
    this.siteName = '起点中文网';
    this.debugMode = true;
  }

  // 获取元标签内容的辅助方法
  getMetaContent(property) {
    const meta = document.querySelector(`meta[property="${property}"]`);
    return meta ? meta.content.trim() : '';
  }

  /**
   * 提取起点书籍的特定字段
   */
  async extractSpecificFields() {
    try {
      // 优先从meta标签提取书名
      let title = this.getMetaContent('og:novel:book_name');
      if (!title && this.getQidianTitle) {
        // 备选方案：使用原有方法
        title = this.getQidianTitle();
      }
      
      // 优先从meta标签提取作者
      let author = this.getMetaContent('og:novel:author');
      if (!author && this.getQidianAuthor) {
        // 备选方案：使用原有方法
        author = this.getQidianAuthor();
      }
      
      // 提取国家/地区（起点中文网书籍默认为中国）
      const country = '中国';
      
      // 优先从meta标签提取简介
      let description = this.getMetaContent('og:description');
      if (!description && this.getQidianIntro) {
        // 备选方案：使用原有方法
        description = this.getQidianIntro();
      }
      
      // 提取URL
      const url = this.formatUrl ? this.formatUrl(window.location.href) : window.location.href;
      
      // 提取篇幅（字数）
      let wordCount = '';
      if (this.getQidianWordCount) {
        wordCount = this.getQidianWordCount();
      } else {
        const wordCountElement = document.querySelector('.count em:first-child');
        wordCount = wordCountElement?.textContent?.trim() || '';
        if (wordCount && !wordCount.includes('字')) {
          if (!wordCount.includes('万')) {
            wordCount += '字';
          }
        }
      }
      
      // 提取评分（起点中文网可能没有直接评分）
      let rating = this.getMetaContent('og:novel:score');
      if (!rating && this.getQidianRating) {
        rating = this.getQidianRating();
      }
      
      // 删除了评分人数、类型/分类和状态字段的提取逻辑
      
      // 保持原有字段结构以便兼容
      const fields = {};
      fields['书名'] = title;
      fields['作者'] = author;
      fields['原作名'] = ''; // 起点没有原作名字段
      fields['发布日期'] = this.getQidianPublishDate ? this.getQidianPublishDate() : '';
      fields['简介'] = description;
      fields['网络评分'] = rating;
      fields['URL'] = url;
      fields['豆瓣链接'] = ''; // 起点没有豆瓣链接
      fields['ISBN'] = ''; // 起点没有ISBN字段
      fields['篇幅'] = wordCount;
      fields['别名'] = ''; // 起点通常没有别名
      fields['其他信息'] = this.getQidianOtherInfo ? this.getQidianOtherInfo() : '';
      
      // 添加新字段
      fields['国家/地区'] = country;
      
      // 已移除元数据字段以简化输出
      
      return fields;
    } catch (error) {
      console.error('提取起点中文网书籍信息时出错:', error);
      return {
        '书名': '',
        '作者': '',
        '国家/地区': '中国',
        '原作名': '',
        '发布日期': '',
        '简介': '',
        '网络评分': '',
        'URL': window.location.href,
        '豆瓣链接': '',
        'ISBN': '',
        '篇幅': '',
        '别名': '',
        '其他信息': ''
      };
    }
  }

  /**
   * 提取起点书名
   */
  getQidianTitle() {
    try {
      // 尝试从多个位置获取书名
      const selectors = [
        '#bookName',
        'h1',
        '[property="og:novel:book_name"]'
      ];
      
      for (const selector of selectors) {
        const title = this.extractText(selector);
        if (title && title.length > 0) {
          this.log(`提取到书名: ${title}`);
          return title;
        }
      }
      
      // 从meta标签获取
      const metaTitle = document.querySelector('[property="og:title"]');
      if (metaTitle) {
        const title = metaTitle.getAttribute('content');
        this.log(`从meta标签提取到书名: ${title}`);
        return title;
      }
      
      return '';
    } catch (error) {
      console.error('提取起点书名失败:', error);
      return '';
    }
  }

  /**
   * 提取起点作者
   */
  getQidianAuthor() {
    try {
      // 尝试从多个位置获取作者
      const selectors = [
        '.author',
        '[property="og:novel:author"]'
      ];
      
      for (const selector of selectors) {
        let author = this.extractText(selector);
        // 清理作者文本，移除"作者:"前缀
        author = author.replace(/^作者:?\s*/i, '').trim();
        if (author && author.length > 0) {
          this.log(`提取到作者: ${author}`);
          return author;
        }
      }
      
      // 从meta标签获取
      const metaAuthor = document.querySelector('[property="og:novel:author"]');
      if (metaAuthor) {
        const author = metaAuthor.getAttribute('content');
        this.log(`从meta标签提取到作者: ${author}`);
        return author;
      }
      
      return '';
    } catch (error) {
      console.error('提取起点作者失败:', error);
      return '';
    }
  }

  /**
   * 提取起点发布日期
   * 优化为从真正的正文第一章首发时间中提取，如果找不到则留空
   */
  getQidianPublishDate() {
    try {
      // 获取所有章节链接
      const allChapters = document.querySelectorAll('.chapter-item .chapter-name');
      let earliestDate = null;
      let prologueDate = null; // 序章日期
      let firstChapterDate = null; // 第一章日期
      
      // 遍历所有章节，收集关键信息
      for (let i = 0; i < allChapters.length; i++) {
        const chapterLink = allChapters[i];
        const chapterText = chapterLink.textContent.trim();
        const titleAttr = chapterLink.getAttribute('title');
        
        if (titleAttr) {
          const publishDateMatch = titleAttr.match(/首发时间：(\d{4}-\d{2}-\d{2})/);
          if (publishDateMatch) {
            const date = publishDateMatch[1];
            
            // 更新最早日期
            if (!earliestDate || date < earliestDate) {
              earliestDate = date;
            }
            
            // 检查是否为序章
            if (chapterText.includes('序章') || chapterText.includes('序：') || 
                chapterText.match(/^序章/) || chapterText.match(/^序\s*$/)) {
              prologueDate = date;
              this.log(`发现序章，首发时间: ${date} (章节: ${chapterText})`);
            }
            
            // 检查是否为第一章
            if (chapterText.includes('第一章') || 
                chapterText.includes('第1章') ||
                chapterText.match(/^第一章/) ||
                chapterText.match(/^第1章/) ||
                chapterText.match(/^第一章：/) ||
                chapterText.match(/^第1章：/)) {
              // 只有在还没有设置firstChapterDate时才设置
              if (!firstChapterDate) {
                firstChapterDate = date;
                this.log(`发现第一章，首发时间: ${date} (章节: ${chapterText})`);
              }
            }
          }
        }
      }
      
      // 优先级顺序：
      // 1. 如果有序章，优先使用序章日期
      if (prologueDate) {
        this.log(`优先使用序章发布日期: ${prologueDate}`);
        return prologueDate;
      }
      
      // 2. 使用第一章日期
      if (firstChapterDate) {
        this.log(`使用第一章发布日期: ${firstChapterDate}`);
        return firstChapterDate;
      }
      
      // 3. 尝试从第一个章节(data-rid="1")提取（避免公告等非正文）
      const firstChapterLink = document.querySelector('.chapter-item[data-rid="1"] .chapter-name');
      if (firstChapterLink) {
        const titleAttr = firstChapterLink.getAttribute('title');
        const chapterText = firstChapterLink.textContent.trim();
        
        // 检查是否为非正文章节（如公告、说明等，但不排除序章）
        const isNonMainChapter = chapterText.includes('公告') || 
                               chapterText.includes('说明') || 
                               chapterText.includes('上架') || 
                               chapterText.includes('新书') ||
                               chapterText.includes('游戏') ||
                               (!chapterText.includes('章') && !chapterText.includes('序'));
        
        if (titleAttr && !isNonMainChapter) {
          const publishDateMatch = titleAttr.match(/首发时间：(\d{4}-\d{2}-\d{2})/);
          if (publishDateMatch) {
            const publishDate = publishDateMatch[1];
            this.log(`从第一个章节提取到发布日期: ${publishDate} (章节: ${chapterText})`);
            return publishDate;
          }
        }
      }
      
      // 4. 寻找内容章节（排除公告等辅助章节，但保留序章和正文）
      for (let i = 0; i < allChapters.length; i++) {
        const chapterLink = allChapters[i];
        const chapterText = chapterLink.textContent.trim();
        const titleAttr = chapterLink.getAttribute('title');
        
        // 排除明显的非正文章节（保留序章和含"章"的章节）
        const isNonMainChapter = chapterText.includes('公告') || 
                               chapterText.includes('说明') || 
                               chapterText.includes('上架') ||
                               chapterText.includes('新书') ||
                               chapterText.includes('游戏') ||
                               (!chapterText.includes('章') && !chapterText.includes('序章') && 
                                !chapterText.includes('序：') && !chapterText.match(/^序\s*$/));
        
        if (!isNonMainChapter && titleAttr) {
          const publishDateMatch = titleAttr.match(/首发时间：(\d{4}-\d{2}-\d{2})/);
          if (publishDateMatch) {
            const publishDate = publishDateMatch[1];
            this.log(`从内容章节提取到发布日期: ${publishDate} (章节: ${chapterText})`);
            return publishDate;
          }
        }
      }
      
      // 5. 如果找到最早日期，返回最早日期
      if (earliestDate) {
        this.log(`使用所有章节中的最早发布日期: ${earliestDate}`);
        return earliestDate;
      }
      
      // 6. 如果以上方法都失败，返回空字符串
      this.log('未找到有效的章节信息，发布日期留空');
      return '';
    } catch (error) {
      console.error('提取起点发布日期失败:', error);
      return '';
    }
  }

  /**
   * 提取起点书籍简介
   */
  getQidianIntro() {
    try {
      // 尝试从多个位置获取简介
      const selectors = [
        '#book-intro-detail',
        '.intro',
        '.book-desc',
        '[property="og:description"]'
      ];
      
      for (const selector of selectors) {
        const intro = this.extractText(selector);
        if (intro && intro.length > 10) { // 确保简介有一定长度
          this.log(`提取到简介: ${intro.substring(0, 50)}...`);
          return intro;
        }
      }
      
      // 从meta标签获取
      const metaDesc = document.querySelector('[property="og:description"]');
      if (metaDesc) {
        const desc = metaDesc.getAttribute('content');
        if (desc && desc.length > 10) {
          this.log(`从meta标签提取到简介: ${desc.substring(0, 50)}...`);
          return desc;
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取起点简介失败:', error);
      return '';
    }
  }

  /**
   * 提取起点评分
   */
  getQidianRating() {
    try {
      // 起点可能没有直接的评分，但可能有其他统计数据
      // 尝试从meta标签或其他元素获取
      const metaRating = document.querySelector('[property="og:novel:score"]');
      if (metaRating) {
        const rating = metaRating.getAttribute('content');
        this.log(`提取到评分: ${rating}`);
        return rating;
      }
      
      return '';
    } catch (error) {
      console.error('提取起点评分失败:', error);
      return '';
    }
  }

  /**
   * 提取起点字数统计
   */
  getQidianWordCount() {
    try {
      // 查找字数统计
      const countElements = document.querySelectorAll('.count');
      for (const element of countElements) {
        const text = element.textContent;
        const wordCountMatch = text.match(/([\d.]+)\s*万\s*字/);
        if (wordCountMatch) {
          const wordCount = wordCountMatch[1] + '万字';
          this.log(`提取到字数: ${wordCount}`);
          return wordCount;
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取起点字数失败:', error);
      return '';
    }
  }

  /**
   * 提取其他信息
   */
  getQidianOtherInfo() {
    try {
      const infoParts = [];
      
      // 获取分类信息
      const categoryElements = document.querySelectorAll('.book-attribute a');
      if (categoryElements.length > 0) {
        const categories = Array.from(categoryElements)
          .map(el => this.cleanText(el.textContent))
          .join('、');
        if (categories) {
          infoParts.push(`分类：${categories}`);
        }
      }
      
      // 优先从目录部分提取状态信息（完本共XX章）
      const catalogDescElement = document.querySelector('.catalog-header-infos .catalog-header-desc');
      if (catalogDescElement) {
        const catalogDesc = this.cleanText(catalogDescElement.textContent);
        if (catalogDesc.includes('完本')) {
          infoParts.push(`状态：${catalogDesc}`);
        }
      } else {
        // 如果目录部分没有找到，则尝试从book-attribute获取状态信息（连载/完结）
        const statusElements = document.querySelectorAll('.book-attribute span');
        if (statusElements.length > 0) {
          for (const el of statusElements) {
            const status = this.cleanText(el.textContent);
            if (status === '连载' || status === '完结') {
              infoParts.push(`状态：${status}`);
              break;
            }
          }
        }
      }
      
      // 获取总推荐数
      // v2.5.48：这里原来拿 element.textContent（纯文本，不带任何标签）
      // 去匹配一个要求 <em> 标签的正则，条件永远不成立 → 总推荐从来没取到过。
      // 改为在 innerHTML 里匹配，并允许「总推荐」与数字之间夹带标签；
      // 「万」设为可选，不到一万的书页也能取到。
      const countElements = document.querySelectorAll('.count');
      for (const element of countElements) {
        const rawHtml = element.innerHTML || '';
        const recommendMatch = rawHtml.match(/总推荐[\s\S]{0,40}?([\d.]+)\s*(万)?/);
        if (recommendMatch) {
          infoParts.push(`总推荐：${recommendMatch[1]}${recommendMatch[2] || ''}`);
          break;
        }
      }
      
      const otherInfo = infoParts.join('，');
      this.log(`提取到其他信息: ${otherInfo}`);
      return otherInfo;
    } catch (error) {
      console.error('提取起点其他信息失败:', error);
      return '';
    }
  }

  /**
   * 格式化URL
   */
  formatUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname;
    } catch (error) {
      return url;
    }
  }

  /**
   * 日志记录
   */
  log(message) {
  }

  /**
   * 覆盖基类的extractDescription方法，避免重复提取
   */
  extractDescription() {
    return '';
  }

  /**
   * 提取元数据字段
   */
  extractMetaFields() {
    const fields = {};
    
    try {
      // 提取更多元数据
      const metaTags = document.querySelectorAll('meta');
      metaTags.forEach(tag => {
        const property = tag.getAttribute('property');
        const name = tag.getAttribute('name');
        const content = tag.getAttribute('content');
        
        if (content) {
          if (property === 'og:title') {
            fields['og:title'] = content;
          } else if (property === 'og:description') {
            fields['og:description'] = content;
          } else if (name === 'keywords') {
            fields['keywords'] = content;
          }
        }
      });
    } catch (error) {
      console.error('提取元数据失败:', error);
    }
    
    return fields;
  }
}

// 普通日志（统一走日志闸门，默认静默；localStorage.clipmateDebug=1 时可见）
function safeLog(message) {
  try {
    if (typeof ClipMateLog !== 'undefined') {
      ClipMateLog.info('[ClipMate] ' + message);
      return;
    }
    if (typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('[ClipMate] ' + message);
    }
  } catch (e) {
    // 如果日志失败，静默处理，不抛出错误
  }
}

// 初始化安全日志
function initDebugging() {
  safeLog('===== 起点中文网书籍提取器初始化开始 =====');
}

// 初始化调试
initDebugging();

// 将提取器注册到全局作用域，确保能被提取器工厂找到
if (window) {
  
  // 确保提取器映射对象存在
  if (!window.extractorMap) {
    window.extractorMap = {};
  }
  
  // 注册起点书籍提取器
  window.extractorMap['qidian_book'] = QidianBookExtractor;
  
  // 为了兼容域名的识别
  if (!window.domainExtractorMap) {
    window.domainExtractorMap = {};
  }
  window.domainExtractorMap['www.qidian.com'] = QidianBookExtractor;
  window.domainExtractorMap['qidian.com'] = QidianBookExtractor;
  
  // 导出提取器到全局作用域
  window.QidianBookExtractor = QidianBookExtractor;
}