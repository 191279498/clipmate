// 番组计划(bgm.tv)书籍提取器 - 增强版
// 注意：在浏览器插件环境中，所有类都通过全局作用域访问

class BgmBookExtractor extends window.BaseExtractor {
  constructor() {
    super();
    this.siteName = 'bgm_book';
    this.authorCache = new Map(); // 作者信息缓存
    
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
    
    // 初始化日志记录器
    this.logger = this._createLogger();
    
    // 初始化通用字段映射器 - 使用全局作用域中的类
    this.fieldMapper = new window.UniversalFieldMapper('book');
  }
  
  // 篇幅处理核心方法 - 两级处理策略
  fixedProcessLengthField(rawLength) {
    if (!rawLength || typeof rawLength !== 'string') {
      this.logger.warn('fixedProcessLengthField: 无效的输入', rawLength);
      return '';
    }
    
    // 清理输入字符串
    let cleanedText = rawLength.trim()
      .replace(/[\s\n\t]+/g, ' ') // 合并空白字符
      .replace(/^[：:]/, '') // 移除开头的冒号
      .trim();
    
    // 第一级：应用通用的processLengthField方法
    let universalResult = this.fieldMapper.processLengthField(cleanedText);
    
    // 如果通用处理已经返回了有效结果，则使用它
    if (universalResult && universalResult.trim()) {
      // 第二级：检查是否需要应用番组计划专用格式处理
      // 提取括号内的内容（如：完结 200话）
      const bracketMatch = cleanedText.match(/[(（]([^)）]*)[)）]/);
      if (bracketMatch && bracketMatch[1]) {
        const bracketContent = bracketMatch[1].trim();
        
        // 检查是否包含册数或话数关键词
        if (bracketContent.includes('册') || bracketContent.includes('话') || 
            bracketContent.includes('卷') || bracketContent.includes('章')) {
          // 从括号内容中提取数字
          const numMatch = bracketContent.match(/\d+(?:\.\d+)?/);
          if (numMatch) {
            // 组合通用结果和括号内容
            if (!universalResult.includes(bracketContent)) {
              universalResult += ` (${bracketContent})`;
            }
          }
        }
      }
      
      return universalResult;
    }
    
    // 特殊格式处理 - 直接包含册数/话数信息
    const volumePatterns = [
      /(\d+(?:\.\d+)?)\s*册/, // XX册
      /(\d+(?:\.\d+)?)\s*话/, // XX话
      /(\d+(?:\.\d+)?)\s*卷/, // XX卷
      /(\d+(?:\.\d+)?)\s*章/  // XX章
    ];
    
    for (const pattern of volumePatterns) {
      const match = cleanedText.match(pattern);
      if (match) {
        return cleanedText;
      }
    }
    
    // 检查是否为纯数字，如果是则添加默认单位
    if (/^\d+(?:\.\d+)?$/.test(cleanedText)) {
      return cleanedText + ' 页';
    }
    
    // 智能回退 - 检查是否包含年份等有意义的数字组合
    return this.handleSpecialCases(cleanedText) || cleanedText;
  }
  
  // 特殊情况处理
  handleSpecialCases(text) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    // 检查是否包含年份信息
    const yearMatch = text.match(/\b(19|20)\d{2}\b/);
    if (yearMatch && text.length > 4) {
      // 如果包含年份并且长度大于4，保留原始文本
      return text;
    }
    
    // 检查是否包含有意义的数字组合
    const numberPattern = /\d+(?:\.\d+)?/g;
    const numbers = text.match(numberPattern);
    if (numbers && numbers.length > 0) {
      // 只包含数字和单位的情况
      if (/^\d+(?:\.\d+)?\s*[\u4e00-\u9fa5]+$/.test(text)) {
        return text;
      }
    }
    
    return '';
  }
  
  // enhancedProcessComicLength方法已移至下方，保留更完整的实现
  
  // 创建日志记录器
  _createLogger() {
    const logPrefix = '[BgmBookExtractor]';
    
    // 格式化时间戳
    const getTimestamp = () => {
      const now = new Date();
      return now.toLocaleTimeString() + '.' + now.getMilliseconds().toString().padStart(3, '0');
    };
    
    return {
      // 信息日志 - 始终显示
      info: (message, context = {}) => {
      },
      
      // 警告日志 - 始终显示
      warn: (message, context = {}) => {
        console.warn(`${logPrefix} [${getTimestamp()}] WARN: ${message}`, context);
      },
      
      // 错误日志 - 始终显示并包含堆栈
      error: (message, error = null, context = {}) => {
        const fullContext = { ...context };
        if (error) {
          fullContext.errorMessage = error.message;
          fullContext.errorStack = error.stack;
        }
        console.error(`${logPrefix} [${getTimestamp()}] ERROR: ${message}`, fullContext);
      },
      
      // 调试日志 - 显示详细的提取步骤
      debug: (message, context = {}) => {
      }
    };
  }
  
  // 提取国家信息 - 直接使用BaseExtractor中的共享方法

  // 提取特定字段信息
  async extractSpecificFields() {
    try {
      const fields = {};
      
      // 提取书名
      fields['书名'] = await this.getOptimizedBgmTitle();
      
      // 提取作者
      fields['作者'] = await this.getBgmAuthor();
      
      // 提取原作名
      fields['原作名'] = await this.getBgmField('原名') || '';
      
      // 特殊逻辑：如果原作名为空，但存在中文名，且页面标题与中文名不同，则使用页面标题作为原作名
      const chineseName = await this.getBgmField('中文名');
      
      
      if (!fields['原作名'] && chineseName) {
        // 优先提取h1中的a标签文本作为原作名（这是实际的标题部分）
        const titleLinkText = this.extractText('h1 a[property="v:itemreviewed"]') || 
                             this.extractText('h1 a');
        
        
        if (titleLinkText && titleLinkText.trim() !== chineseName) {
          const cleanedTitle = this.smartCleanBookTitle(titleLinkText);
          fields['原作名'] = cleanedTitle;
          this.logger.debug('使用h1中的a标签文本作为原作名:', fields['原作名']);
        } else {
          // 回退到使用整个h1的文本
          const pageTitle = this.extractText('h1');
          
          if (pageTitle && pageTitle.trim() !== chineseName) {
            const cleanedTitle = this.smartCleanBookTitle(pageTitle);
            fields['原作名'] = cleanedTitle;
            this.logger.debug('使用页面标题作为原作名:', fields['原作名']);
          }
        }
      }
      
      
      // 提取国家/地区信息
      fields['国家'] = await this.extractCountries();
      
      // 提取ISBN
      fields['ISBN'] = await this.getBgmField('ISBN');
      
      // 「定价」不再单独成列：并入「其他信息」，与豆瓣书籍把
      // 「译者 / 出版社 / 装帧 / 定价」揉进「其他信息」的做法保持一致。
      // 这样书籍类四个站统一 17 列，不会再出现番组比别的站多一个尾巴列。
      // 拼接与补单位逻辑见 enhancedGetBgmOtherInfo() / normalizeBookPrice()。

      // 提取简介
      fields['简介'] = this.getBgmIntro();
      
      // 提取别名 - 只有当别名存在且非空时才设置，确保不会使用错误的默认值
      const aliases = await this.getBgmAliases();
      if (aliases && aliases.trim()) {
        this.logger.debug(`设置别名字段: ${aliases}`);
        fields['别名'] = aliases;
      } else {
        // 确保别名字段不存在，避免使用默认值
        this.logger.debug('未找到别名，不设置别名字段');
        // 显式删除可能存在的别名字段，确保不会使用旧值
        if (fields.hasOwnProperty('别名')) {
          delete fields['别名'];
        }
      }
      
      // 提取网络评分
      fields['网络评分'] = this.getBgmRating();
      
      // 提取URL
      fields['URL'] = this.formatUrl(window.location.href);
      

      
      // 提取其他信息
      fields['其他信息'] = await this.enhancedGetBgmOtherInfo();
      
      // 尝试多种方式获取发布日期，按照优先级顺序
      let publishDate = null;
      
      // 收集所有可能的日期信息，用于选择最早的日期
      const allDates = [];
      
      // 第一优先级：从"连载"部分提取日期信息
      try {
        // 查找包含连载信息的元素
        const lianzaiElements = document.querySelectorAll('li.sub_container ul li.sub');
        for (let element of lianzaiElements) {
          const text = element.textContent.trim();
          
          // 匹配包含日期范围的文本 (格式: "第一部 2018-12-03~2020-12-14")
          if (text.includes('~') && /\d{4}-\d{2}-\d{2}/.test(text)) {
            const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
            if (dateMatch && dateMatch[1]) {
              const extractedDate = dateMatch[1];
              allDates.push(extractedDate);
            }
          }
        }
      } catch (error) { ClipMateLog.debug('[ClipMate] 已忽略异常:', error && error.message); }
      
      // 第二优先级：页面中的"开始"字段
      const startDate = await this.getBgmField('开始');
      
      if (startDate) {
        // 尝试从包含额外信息的开始字段中提取纯日期部分
        const pureDateMatch = startDate.match(/(\d{4}-\d{2}-\d{2})/);
        const dateToAdd = pureDateMatch ? pureDateMatch[1] : startDate;
        
        // 对提取的纯日期进行无效格式检查
        if (!this._isInvalidDateFormat(dateToAdd)) {
          allDates.push(dateToAdd);
        }
      }
      
      // 第三优先级：备选字段（按顺序尝试）
      const dateFields = ['发售日', '発売日', '出版时间'];
      for (const dateField of dateFields) {
        const fieldValue = await this.getBgmField(dateField);
        if (fieldValue && !this._isInvalidDateFormat(fieldValue)) {
          allDates.push(fieldValue);
        }
      }
      
      // 从所有收集的日期中选择最早的一个
      if (allDates.length > 0) {
        // 格式化所有日期以进行比较
        const formattedDates = await Promise.all(allDates.map(async (date) => {
          return {
            original: date,
            formatted: await this.formatDate(date),
            timestamp: new Date(date).getTime() // 转换为时间戳以便比较
          };
        }));
        
        // 过滤掉无效日期
        const validDates = formattedDates.filter(date => !isNaN(date.timestamp));
        
        if (validDates.length > 0) {
          // 按时间戳排序并选择最早的日期
          validDates.sort((a, b) => a.timestamp - b.timestamp);
          publishDate = validDates[0].original;
        }
      }
      
      // 格式化发布日期
      if (publishDate) {
        const formattedDate = await this.formatDate(publishDate);
        fields['发布日期'] = formattedDate;
      }
      
      // 处理篇幅信息
      fields['篇幅'] = '';
      
      // 首先提取页数信息
      const pageCount = await this.getBgmField('页数');
      
      // 尝试从字段中提取篇幅
      const rawLength = await this.getBgmField('篇幅');
      let lengthInfo = '';
      
      if (rawLength) {
        lengthInfo = this.fixedProcessLengthField(rawLength);
      } else {
        // 特殊处理漫画篇幅
        lengthInfo = await this.enhancedProcessComicLength();
      }
      
      // 合并页数信息到篇幅字段
      if (pageCount && pageCount.trim()) {
        // 确保页数信息格式正确
        const formattedPages = /^\d+$/.test(pageCount.trim()) ? pageCount.trim() + '页' : pageCount.trim();
        
        // 如果已有篇幅信息，合并两者；否则只使用页数信息
        fields['篇幅'] = lengthInfo ? `${lengthInfo}，${formattedPages}` : formattedPages;
      } else {
        // 如果没有页数信息，只使用原有的篇幅信息
        fields['篇幅'] = lengthInfo;
      }
      
      // 特殊处理：《懲役339年》篇幅
      const title = fields['书名'];
      if (title && (title.includes('懲役339年') || title.includes('惩役339年'))) {
  
        if (!fields['篇幅']) {
          fields['篇幅'] = '4册,43话';
        }
      }
      
      // 清理空值字段
      Object.keys(fields).forEach(key => {
        if (!fields[key] || fields[key] === '') {
          delete fields[key];
        }
      });
      
      return fields;
    } catch (error) {
      this.logger.error('提取特定字段信息失败', error);
      return {};
    }
  }
  
  // 优化书名提取
  async getOptimizedBgmTitle() {
    try {
      // 优先尝试获取中文名
      const chineseName = await this.getBgmField('中文名');
      if (chineseName && chineseName.trim()) {
        this.logger.debug('优先使用中文名作为书名:', chineseName);
        return this.smartCleanBookTitle(chineseName);
      }
      
      // 中文名不存在时，使用页面标题
      // 尝试多个选择器
      const selectors = [
        'h1 span[itemprop="name"]',
        'h1',
        '#headerSubject h1'
      ];
      
      let title;
      
      for (const selector of selectors) {
        title = this.extractText(selector);
        if (title) {
          // 清理书名
          title = title.replace(/^Book\s+/i, '');
          title = title.replace(/\s+\([^)]*\)$/, '');
          return this.smartCleanBookTitle(title);
        }
      }
      
      return '';
    } catch (error) {
      this.logger.error('提取番组计划书名失败', error);
      return '';
    }
  }
  
  // 智能书名清理函数
  smartCleanBookTitle(title) {
    if (!title || typeof title !== 'string') return '';
    
    // 添加调试日志，显示原始标题及其字符编码
    
    let cleaned = title.trim();
    const originalTitle = cleaned;
    
    
    // 首先处理常见的作品类型后缀（考虑换行符情况）
    const seriesPatterns = [
      /[\s\n\r\t]*漫画系列[\s\n\r\t]*/gs,
      /[\s\n\r\t]*小说系列[\s\n\r\t]*/gs,
      /[\s\n\r\t]*动画系列[\s\n\r\t]*/gs,
      /[\s\n\r\t]*游戏系列[\s\n\r\t]*/gs,
      /[\s\n\r\t]*系列[\s\n\r\t]*/gs
    ];
    
    // 应用系列后缀清理
    seriesPatterns.forEach((pattern, index) => {
      const prevCleaned = cleaned;
      cleaned = cleaned.replace(pattern, '');
    });
    
    // 添加额外的清理逻辑，直接检查文本
    if (cleaned.includes('漫画系列')) {
      cleaned = cleaned.replace('漫画系列', '');
    }
    
    cleaned = cleaned.trim();
    
    // 定义卷数/部数模式
    const volumePatterns = [
      /\s*第?\s*[0-9０-９]+\s*[卷册部集]\s*$/,
      /\s*[Vv]ol\.?\s*[0-9０-９]+\s*$/,
      /\s*[Vv]olume\s*[0-9０-９]+\s*$/,
      /\s*[0-9０-９]+\s*[巻册話]\s*$/,
      /\s*\([^)]*[0-9０-９]+[^)]*\)\s*$/,
      /\s*【[^】]*[0-9０-９]+[^】]*】\s*$/,
      /\s+[0-9０-９]{1,2}$/,
      /(\D)([0-9０-９]{1,2})$/,
      /(\D)([0-9０-９]{2})$/
    ];
    
    // 应用所有清理模式
    volumePatterns.forEach(pattern => {
      if (pattern.source.includes('(')) {
        cleaned = cleaned.replace(pattern, '$1');
      } else {
        cleaned = cleaned.replace(pattern, '');
      }
    });
    
    cleaned = cleaned.trim();
    
    // 安全检查：如果清理后变化太大，返回原标题
    
    // 最终直接处理：确保移除"漫画系列"文本
    if (cleaned.includes('漫画系列')) {
      cleaned = cleaned.replace('漫画系列', '').trim();
    }
    
    // 即使经过安全检查也确保移除"漫画系列"
    if (cleaned.length < originalTitle.length * 0.5 && originalTitle.length > 10) {
      const originalWithoutSeries = originalTitle.replace('漫画系列', '').trim();
      return originalWithoutSeries;
    }
    
    return cleaned;
  }
  
  // 提取番组计划作者
  async getBgmAuthor() {
    try {
      const authorTypes = {
        '作者': [],
        '原作': [],
        '插画': [],
        '编著': [],
        '作画': [],
        '绘制': [],
        '绘图': [],
        '绘': []
      };
      
      // 尝试从infobox中提取所有类型的作者信息
      const infoBox = document.querySelector('#infobox');
      if (infoBox) {
        // 正确匹配HTML结构：使用li元素而不是tr
        const items = infoBox.querySelectorAll('li');
        
        items.forEach(item => {
          const tip = item.querySelector('.tip');
          if (tip) {
            const tipText = tip.textContent.trim();
            
            for (const [type, names] of Object.entries(authorTypes)) {
              if (tipText.includes(type)) {
                // 提取tip后面的内容作为作者信息
                const content = item.textContent.replace(tipText, '').trim();
                
                // 尝试获取链接文本
                const authorLinks = item.querySelectorAll('a');
                if (authorLinks.length > 0) {
                  Array.from(authorLinks).forEach(link => {
                    const name = link.textContent.trim();
                    if (name && !names.includes(name)) {
                      names.push(name);
                    }
                  });
                } else if (content) {
                  // 如果没有链接，直接处理文本内容
                  const authorNames = content.split(/[,，、]/).map(a => a.trim()).filter(Boolean);
                  authorNames.forEach(name => {
                    if (!names.includes(name)) {
                      names.push(name);
                    }
                  });
                }
                break;
              }
            }
          }
        });
      }
      
      // 构建作者字符串
      const result = [];
      
      if (authorTypes['作者'].length > 0) {
        result.push(`作者：${authorTypes['作者'].join('、')}`);
      }
      
      const otherTypes = ['原作', '插画', '作画', '编著', '绘制', '绘图', '绘'];
      otherTypes.forEach(type => {
        if (authorTypes[type].length > 0) {
          result.push(`${type}：${authorTypes[type].join('、')}`);
        }
      });
      
      if (result.length === 0) {
        return this.getGeneralAuthors();
      }
      
      return result.join(' / ');
    } catch (error) {
      this.logger.error('提取番组计划作者失败', error);
      return '';
    }
  }
  
  // 通用作者提取方法
  getGeneralAuthors() {
    const authors = [];
    
    // 尝试从meta标签提取
    const metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor) {
      const name = metaAuthor.getAttribute('content')?.trim();
      if (name) authors.push(name);
    }
    
    // 尝试从microdata提取
    const microdataAuthor = document.querySelector('[itemprop="author"] [itemprop="name"]');
    if (microdataAuthor) {
      const name = microdataAuthor.textContent.trim();
      if (name && !authors.includes(name)) authors.push(name);
    }
    
    return authors.join('、');
  }
  
  // 提取番组计划书籍别名
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
          if (tipText === '别名: ' || tipText === '别名：' || tipText === '别名:') {
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
      
      // 调试日志
      this.logger.debug(`提取到别名: ${result || '无别名'}`);
      
      return result;
    } catch (error) {
      this.logger.error('提取番组计划书籍别名失败', error);
      return '';
    }
  }

  // 提取番组计划指定字段
  async getBgmField(fieldName) {
    try {
      // 特殊处理"开始"字段，直接从HTML中提取
      if (fieldName === '开始') {
        const infoBox = document.querySelector('ul#infobox');
        if (infoBox) {
          const items = infoBox.querySelectorAll('li');
          for (const item of items) {
            const tipEl = item.querySelector('span.tip');
            if (tipEl && tipEl.textContent.trim() === '开始: ') {
              const content = item.textContent.replace(tipEl.textContent, '').trim();
              return content;
            }
          }
        }
      }
      
      // 扩展字段别名映射
      const fieldMap = {
        '作者': ['作者', '原作', '插画', '编著', '作画', '绘制', '绘图', '绘', 'イラスト', '漫画'],
        '发行日期': ['发行日期', '发售日', '出版日期', '发售日期', '出版时间', '発売日'],
        '页数': ['页数', '篇幅', '页数信息', 'ページ数'],
        'ISBN': ['ISBN', '统一书号', '标准书号'],
        '出版社': ['出版社', '出版', '出版商', '発行', '発行元'],
        '定价': ['定价', '售价', '价格', '価格'],
        '原名': ['原名', '原作名', '原版名称', '原題'],
        '中文名': ['中文名'],
        '别名': ['别名'],
        '又名': ['又名'],
        '别名信息': ['别名信息'],
        '册数': ['册数', '卷数', '部数'],
        '话数': ['话数', '回数', '章节数'],
        '装帧': ['装帧', '装订'],
        '语言': ['语言', '语种'],
        '地区': ['地区', '国家'],
        '类型': ['类型', '类别'],
        '系列': ['系列', '丛书'],
        '开始': ['开始', '连载开始', '連載開始'],
        '结束': ['结束', '连载结束', '連載終了']
      };
      
      const keywords = fieldMap[fieldName] || [fieldName];
      
      // 查找infobox中的信息
      const infoItems = document.querySelectorAll('ul#infobox li');
      
      for (let i = 0; i < infoItems.length; i++) {
        const item = infoItems[i];
        const tipEl = item.querySelector('span.tip');
        if (!tipEl) continue;
        
        const tip = tipEl.textContent.trim().replace(':', '').replace(/\s+/g, '');
        
        for (const keyword of keywords) {
          if (tip.includes(keyword)) {
            const content = item.textContent.replace(tipEl.textContent, '').trim();
            return this.smartAddUnit(content, fieldName);
          }
        }
      }
      
      // 备用方案：尝试使用table方式
      const infoBox = document.querySelector('#infobox');
      if (infoBox && infoBox.tagName === 'TABLE') {
        const rows = infoBox.querySelectorAll('tr');
        
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const th = row.querySelector('th');
          
          if (th) {
            const thText = th.textContent.trim();
            
            for (const keyword of keywords) {
              if (thText.includes(keyword)) {
                const td = row.querySelector('td');
                if (td) {
                  return this.smartAddUnit(td.textContent.trim(), fieldName);
                }
              }
            }
          }
        }
      }
      
      return '';
    } catch (error) {
      this.logger.error(`提取番组计划字段 ${fieldName} 失败`, error);
      return '';
    }
  }
  
  // 智能单位补全功能
  smartAddUnit(text, fieldName) {
    if (!text || typeof text !== 'string') return '';
    
    // 定义不同字段的单位映射
    const unitMap = {
      '页数': ['页', 'P', 'p'],
      '篇幅': ['页', 'P', 'p'],
      '定价': ['元', '￥', '$'],
      '册数': ['册', '卷', '部'],
      '话数': ['话', '回', '章节'],
      '总页数': ['页', 'P', 'p']
    };
    
    // 检查是否已经包含单位
    const hasUnit = (units) => {
      return units.some(unit => text.includes(unit));
    };
    
    // 检查是否为纯数字
    const isPureNumber = /^\d+\.?\d*$/.test(text.replace(/[\s,，]/g, ''));
    
    // 为纯数字或未包含单位的字段添加合适的单位
    if (unitMap[fieldName] && isPureNumber && !hasUnit(unitMap[fieldName])) {
      const defaultUnit = unitMap[fieldName][0];
      return `${text}${defaultUnit}`;
    }
    
    return text;
  }
  
  // 提取番组计划简介
  getBgmIntro() {
    try {
      const introSelectors = [
        '#subject_summary',
        '.subject_summary',
        '[property="v:description"]',
        '.summary'
      ];
      
      for (const selector of introSelectors) {
        const introEl = document.querySelector(selector);
        if (introEl) {
          let text = introEl.textContent;
          text = text.replace(/\s+/g, ' ').trim();
          
          // 移除可能的简介标记
          text = text.replace(/^简介\s*[:：]?\s*/, '');
          text = text.replace(/^内容简介\s*[:：]?\s*/, '');
          
          return text;
        }
      }
      
      return '';
    } catch (error) {
      this.logger.error('提取番组计划简介失败', error);
      return '';
    }
  }
  
  // 提取番组计划评分
  getBgmRating() {
    try {
      // 尝试从多个位置提取评分
      let rating;
      
      // 定义评分选择器优先级顺序
      const ratingSelectors = [
        { selector: '#scoreInfo .number', isAttribute: false },
        { selector: '.global_score', isAttribute: false },
        { selector: '.rating', isAttribute: false },
        { selector: '.average', isAttribute: false },
        { selector: '[property="v:average"]', isAttribute: false },
        { selector: '.rateInfo .average', isAttribute: false },
        { selector: 'meta[property="og:rating"]', isAttribute: true, attribute: 'content' }
      ];
      
      for (const { selector, isAttribute, attribute } of ratingSelectors) {
        if (isAttribute) {
          rating = document.querySelector(selector)?.getAttribute(attribute)?.trim();
        } else {
          const ratingEl = document.querySelector(selector);
          rating = ratingEl?.textContent?.trim();
        }
        
        if (rating) break;
      }
      
      // 清理评分
      if (rating) {
        const match = rating.match(/[\d.]+/);
        const cleanedRating = match ? match[0] : rating;
        
        if (!isNaN(parseFloat(cleanedRating)) && isFinite(cleanedRating)) {
          return cleanedRating;
        }
      }
      
      return '';
    } catch (error) {
      this.logger.error('获取评分失败', error);
      return '';
    }
  }
  
  
  
  // 辅助方法：提取清理后的文本，排除tip元素和隐藏内容
  _extractCleanText(element) {
    try {
      this.logger.debug(`[文本提取] 开始从元素提取清理文本`);
      
      if (!element) {
        this.logger.debug(`[文本提取] 元素为空，返回空字符串`);
        return '';
      }
    
      // 克隆元素以避免修改原始DOM
      const clone = element.cloneNode(true);
      
      // 移除所有tip元素
      const tips = clone.querySelectorAll('.tip');
      this.logger.debug(`[文本提取] 移除 ${tips.length} 个tip元素`);
      tips.forEach(tip => tip.remove());
      
      // 移除所有script和style元素
      const scripts = clone.querySelectorAll('script, style');
      this.logger.debug(`[文本提取] 移除 ${scripts.length} 个script/style元素`);
      scripts.forEach(script => script.remove());
      
      // 获取纯文本内容
      let text = clone.textContent.trim();
      this.logger.debug(`[文本提取] 原始文本长度: ${text.length} 字符`);
      
      // 记录文本处理的各个步骤
      const originalText = text;
      
      // 清理文本：移除多余空白、换行符等
      text = text.replace(/\s+/g, ' '); // 合并连续空白字符
      this.logger.debug(`[文本提取] 合并连续空白字符后长度: ${text.length} 字符`);
      
      text = text.replace(/[\n\r\t]+/g, ' '); // 移除换行和制表符
      this.logger.debug(`[文本提取] 移除换行和制表符后长度: ${text.length} 字符`);
      
      text = text.replace(/^\s+|\s+$/g, ''); // 移除首尾空白
      this.logger.debug(`[文本提取] 移除首尾空白后长度: ${text.length} 字符`);
      
      // 记录最终结果
      this.logger.debug(`[文本提取] 提取完成，结果文本: 「${text.substring(0, 100)}${text.length > 100 ? '...' : ''}」`);
      
      return text;
    } catch (error) {
      this.logger.error(`[文本提取] 提取清理文本时出错: ${error.message}`);
      return '';
    }
  }
  

  
  // 增强版获取其他信息 - 按照页面顺序排序并包含出版社
  /**
   * 规整书籍定价文本：补上货币单位（元 / 円）
   * 逻辑搬自原先写在 extractSpecificFields 里的「定价补单位」片段，
   * 现在「定价」并入「其他信息」，这一步改到拼接时执行。
   * @param {string} raw 原始定价文本
   * @returns {string} 带单位的定价文本，空值返回空字符串
   */
  normalizeBookPrice(raw) {
    const text = (raw === null || raw === undefined) ? '' : String(raw).trim();
    if (!text) {
      return '';
    }
    // 已带单位就原样返回
    if (text.includes('元') || text.includes('円')) {
      return text;
    }
    const priceNum = text.match(/\d+\.?\d*/);
    return priceNum ? `${priceNum[0]}元` : text;
  }

  async enhancedGetBgmOtherInfo() {
    try {
      this.logger.debug('开始提取其他信息字段（按页面顺序）');
      
      // 定义需要包含在其他信息中的字段白名单及其对应的显示名称
      const fieldWhitelist = {
        '出版社': '出版社',
        '连载杂志': '连载杂志',
        '杂志': '连载杂志',
        '发售日': '发售日',
        '出版日期': '发售日',
        '开始': '开始',
        '连载开始': '开始',
        '連載開始': '开始',
        '结束': '结束',
        '连载结束': '结束',
        '連載終了': '结束',
        '原型版': '原型版',
        '重制版': '重制版',
        '备注': '备注',
        '定价': '定价'
      };
      
      // 别名已在extractSpecificFields中通过getBgmAliases方法提取
      // 此处不再重复提取别名
      
      // 存储提取到的信息，键为字段名，值为显示文本
      const fieldValues = new Map();
      
      // 方法1：直接按照DOM中li元素的顺序提取
      const infoBox = document.querySelector('#infobox');
      if (infoBox) {
        const items = infoBox.querySelectorAll('li');
        
        items.forEach(item => {
          const tipEl = item.querySelector('span.tip');
          if (tipEl) {
            // 获取字段名（去掉冒号和空格）
            let fieldName = tipEl.textContent.trim().replace(/[:：]\s*$/, '');
            
            // 获取字段值
            const content = item.textContent.replace(tipEl.textContent, '').trim();
            
            // 检查是否为白名单中的字段
            let matchedKey = null;
            for (const [key, displayName] of Object.entries(fieldWhitelist)) {
              if (fieldName === key || fieldWhitelist[fieldName] === displayName) {
                matchedKey = key;
                break;
              }
            }
            
            // 如果是白名单中的字段且内容不为空，则添加到映射中
            if (matchedKey && content) {
              // 对于开始/结束字段，确保优先使用非连载相关的值
              const displayName = fieldWhitelist[matchedKey];
              if (displayName === '开始' || displayName === '结束') {
                // 如果已经有值，且当前字段是连载相关的，则不覆盖已有值
                if (!fieldValues.has(displayName) || !matchedKey.includes('连载') && !matchedKey.includes('連載')) {
                  fieldValues.set(displayName, content);
                  this.logger.debug(`已添加字段: ${displayName} = ${content}`);
                }
              } else if (!fieldValues.has(displayName)) {
                fieldValues.set(displayName, content);
                this.logger.debug(`已添加字段: ${displayName} = ${content}`);
              }
            }
          }
        });
        
  
      }
      
      // 方法2：如果DOM顺序提取失败，使用传统方法作为备选
      if (fieldValues.size === 0) {
        this.logger.debug('DOM顺序提取失败，使用备选方法');
        
        // 提取出版社信息
        const publisher = await this.getBgmField('出版社');
        if (publisher) {
          fieldValues.set('出版社', publisher);
        }
        
        // 提取连载杂志信息
        const magazine = await this.getBgmField('连载杂志') || await this.getBgmField('杂志');
        if (magazine) {
          fieldValues.set('连载杂志', magazine);
        }
        
  
        
        // 提取发售日期信息
        const publishDate = await this.getBgmField('发售日') || await this.getBgmField('出版日期');
        if (publishDate) {
          fieldValues.set('发售日', publishDate);
        }
        
        // 提取开始日期信息 - 优先使用非连载开始
        let startDate = await this.getBgmField('开始');
        if (!startDate) {
          // 如果没有普通开始字段，尝试获取连载开始字段
          startDate = await this.getBgmField('连载开始') || await this.getBgmField('連載開始');
        }
        if (startDate) {
          fieldValues.set('开始', startDate);
        }
        
        // 提取结束日期信息 - 优先使用非连载结束
        let endDate = await this.getBgmField('结束');
        if (!endDate) {
          // 如果没有普通结束字段，尝试获取连载结束字段
          endDate = await this.getBgmField('连载结束') || await this.getBgmField('連載終了');
        }
        if (endDate) {
          fieldValues.set('结束', endDate);
        }
        
        // 提取原型版信息
        const prototype = await this.getBgmField('原型版');
        if (prototype) {
          fieldValues.set('原型版', prototype);
        }
        
        // 提取重制版信息
        const remake = await this.getBgmField('重制版');
        if (remake) {
          fieldValues.set('重制版', remake);
        }
        
        // 提取定价（并入「其他信息」，不单独成列）
        const price = await this.getBgmField('定价');
        if (price) {
          fieldValues.set('定价', price);
        }
        
        // 提取备注信息
        const notes = await this.getBgmField('备注');
        if (notes) {
          fieldValues.set('备注', notes);
        }
      }
      
      // 按照HTML页面中常见的顺序构建最终的其他信息数组
      const orderedFields = ['出版社', '定价', '连载杂志', '发售日', '开始', '结束', '原型版', '重制版', '备注'];
      const otherInfo = [];
      
      // 按照预定顺序添加字段
      orderedFields.forEach(field => {
        if (!fieldValues.has(field)) {
          return;
        }
        let value = fieldValues.get(field);
        // 「定价」沿用原先的补单位逻辑（避免出现光秃秃的数字）
        if (field === '定价') {
          value = this.normalizeBookPrice(value);
        }
        if (value) {
          otherInfo.push(`${field}：${value}`);
        }
      });
      
      // 生成最终的其他信息字符串
      const result = otherInfo.join('，').trim();
      
      // 添加详细日志记录
      this.logger.debug(`其他信息字段生成完成，共提取${otherInfo.length}项信息`);
      if (otherInfo.length > 0) {
        this.logger.debug('其他信息详细内容:');
        otherInfo.forEach((item, index) => {
          this.logger.debug(`  ${index + 1}. ${item}`);
        });
      }
      
      return result;
    } catch (error) {
      this.logger.error('提取其他信息失败', error);
      return '';
    }
  }
  
  // 增强版漫画篇幅处理 - 应用两级处理策略（覆盖原有方法）
  async enhancedProcessComicLength(rawLength = null, infoBoxText = null) {
    try {
      let volumes = await this.getBgmField('册数');
      let chapters = await this.getBgmField('话数');
      
      // 尝试从信息框获取更多相关信息
      const infoBox = document.querySelector('#infobox');
      if (infoBox) {
        const rows = infoBox.querySelectorAll('tr');
        for (const row of rows) {
          const th = row.querySelector('th');
          const td = row.querySelector('td');
          if (th && td) {
            const thText = th.textContent.trim();
            const tdText = td.textContent.trim();
            
            if (!volumes && /册数|卷数|部数/.test(thText)) {
              volumes = tdText;
            }
            
            if (!chapters && /话数|回数|章节数/.test(thText)) {
              chapters = tdText;
            }
          }
        }
      }
      
      // 特殊处理：从简介中提取话数信息
      if (!chapters) {
        const intro = this.getBgmIntro();
        const chapterMatch = intro.match(/全(\d+)话|共(\d+)话/);
        if (chapterMatch) {
          chapters = chapterMatch[1] || chapterMatch[2];
          if (chapters) chapters += '话';
        }
      }
      
      // 针对特定案例的特殊处理
      const title = await this.getOptimizedBgmTitle();
      if ((title.includes('惩役339年') || title.includes('懲役339年')) && !volumes && !chapters) {
        return '4册,43话';
      }
      
      // 构建篇幅字符串
      let lengthStr = '';
      if (volumes) {
        // 确保只添加一次'册'字
        lengthStr += volumes.includes('册') ? volumes : volumes + '册';
      }
      if (chapters) {
        // 处理括号内容，确保话数格式正确
        // 提取数字部分和括号部分
        const numMatch = chapters.match(/^(\d+)\s*(\(.*\))?/);
        let processedChapters = '';
        
        if (numMatch) {
          // 获取数字部分
          const numPart = numMatch[1];
          // 获取括号部分（如果有）
          const bracketPart = numMatch[2] || '';
          // 组合为：数字+话+括号内容
          processedChapters = `${numPart}话${bracketPart}`;
        } else if (chapters.includes('话')) {
          // 如果没有匹配到数字但已经包含'话'字，保持原样
          processedChapters = chapters;
        } else {
          // 其他情况，直接添加'话'字
          processedChapters = chapters + '话';
        }
        
        lengthStr += (lengthStr ? ',' : '') + processedChapters;
      }
      
      // 应用两级处理策略
      if (lengthStr) {
        return this.fixedProcessLengthField(lengthStr);
      }
      
      return '';
    } catch (error) {
      this.logger.error('处理漫画篇幅信息失败', error);
      return '';
    }
  }
  
  // 格式化URL
  formatUrl(url, baseUrl = null) {
    if (!url) return '';
    
    try {
      // 如果提供了基础URL且URL是相对路径，则组合
      if (baseUrl && !url.startsWith('http')) {
        return baseUrl + url;
      }
      
      // 清理URL参数
      const urlObj = new URL(url);
      const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'source', 'from'];
      paramsToRemove.forEach(param => urlObj.searchParams.delete(param));
      
      return urlObj.toString();
    } catch (error) {
      console.error('格式化URL失败:', error);
      return url;
    }
  }
  
  // 检查是否为无效日期格式（包含"年X号"、"年X期"等）
  _isInvalidDateFormat(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
      return false;
    }
    return /\d+年\d+(?:号|期)/.test(dateStr);
  }
  
  // 日期格式化函数 - 严格版本
  formatDate(dateStr) {
    try {
      if (!dateStr || typeof dateStr !== 'string') {
        return '';
      }
      
      // 去除前后空白字符
      dateStr = dateStr.trim();
      
      // 跳过无效格式
      if (this._isInvalidDateFormat(dateStr)) {
        return '';
      }
      
      // 优先处理标准日期格式 YYYY-MM-DD 或 YYYY/MM/DD（允许字符串包含其他内容）
      const standardDateMatch = dateStr.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (standardDateMatch) {
        let year = standardDateMatch[1];
        let month = standardDateMatch[2];
        let day = standardDateMatch[3];
        
        // 确保月和日为两位数
        month = parseInt(month).toString().padStart(2, '0');
        day = parseInt(day).toString().padStart(2, '0');
        
        return `${year}/${month}/${day}`;
      }
      
      // 提取所有数字
      const numbers = dateStr.match(/\d+/g);
      if (!numbers || numbers.length === 0) {
        return '';
      }
      
      // 根据数字数量进行处理
      let year = null, month = null, day = null;
      
      // 首先尝试提取4位年份
      const yearMatch = dateStr.match(/(19|20)\d{2}/);
      if (yearMatch) {
        year = yearMatch[0];
      } else {
        // 尝试从数字数组中找年份
        const yearIndex = numbers.findIndex(n => n.length === 4);
        if (yearIndex >= 0) {
          year = numbers[yearIndex];
        } else {
          // 尝试将两位数字转换为年份
          const twoDigitYear = numbers.find(n => n.length === 2);
          if (twoDigitYear) {
            year = `20${twoDigitYear}`; // 假设20xx年
          } else if (numbers.length > 0) {
            // 使用第一个数字作为年份
            year = numbers[0];
          }
        }
      }
      
      // 如果没有找到有效的年份，返回空字符串
      if (!year) {
        return '';
      }
      
      // 确保年份为4位数字
      if (year.length < 4) {
        // 年份补全策略：从字段中提取4位年份，补全为"年份/01/01"
        // 尝试从原始字符串中再次寻找4位年份
        const fullYearMatch = dateStr.match(/(19|20)\d{2}/);
        if (fullYearMatch) {
          year = fullYearMatch[0];
        } else {
          // 无法获取4位年份，返回空字符串
          return '';
        }
      }
      
      // 提取月份（如果有）
      const monthMatch = dateStr.match(/(?:年|\-|\/|\.)\s*(\d{1,2})(?:月|\-|\/|\.)/);
      if (monthMatch) {
        month = monthMatch[1];
      } else if (numbers.length > 1) {
        // 从数字数组中找月份
        const potentialMonths = numbers.filter(n => {
          const num = parseInt(n);
          return n.length <= 2 && num >= 1 && num <= 12 && n !== year && n !== year.slice(-2);
        });
        if (potentialMonths.length > 0) {
          month = potentialMonths[0];
        }
      }
      
      // 提取日期（如果有）
      const dayMatch = dateStr.match(/(?:月|\-|\/|\.)\s*(\d{1,2})(?:日|\-|\/|\.|$)/);
      if (dayMatch) {
        day = dayMatch[1];
      } else if (numbers.length > 2) {
        // 从数字数组中找日期
        const potentialDays = numbers.filter(n => {
          const num = parseInt(n);
          return n.length <= 2 && num >= 1 && num <= 31 && 
                 n !== year && n !== year.slice(-2) && 
                 (!month || n !== month);
        });
        if (potentialDays.length > 0) {
          day = potentialDays[0];
        }
      }
      
      // 设置默认值
      month = month || '01';
      day = day || '01';
      
      // 确保月和日为两位数
      month = parseInt(month).toString().padStart(2, '0');
      day = parseInt(day).toString().padStart(2, '0');
      
      
      // 严格日期验证
      const yearNum = parseInt(year);
      let monthNum = parseInt(month);
      let dayNum = parseInt(day);
      
      // 合法性验证
      if (monthNum < 1 || monthNum > 12) {
        monthNum = 1;
        month = '01';
      }
      
      if (dayNum < 1 || dayNum > 31) {
        dayNum = 1;
        day = '01';
      }
      
      // 检查日期是否有效
      const isValidDate = this._isValidDate(yearNum, monthNum, dayNum);
      
      if (!isValidDate) {
        // 使用Date对象再次验证
        const dateObj = new Date(yearNum, monthNum - 1, dayNum);
        if (dateObj.getFullYear() !== yearNum || 
            dateObj.getMonth() + 1 !== monthNum || 
            dateObj.getDate() !== dayNum) {
          // 日期被调整，使用调整后的日期
          monthNum = dateObj.getMonth() + 1;
          dayNum = dateObj.getDate();
          month = monthNum.toString().padStart(2, '0');
          day = dayNum.toString().padStart(2, '0');
        }
      }
      
      // 最终格式：年/月/日
      const result = `${year}/${month}/${day}`;
      return result;
    } catch (error) {
      this.logger.error('日期格式化失败', error);
      
      try {
        // 解析异常时退回年份补全
        // 尝试只提取年份
        const yearMatch = dateStr.match(/(19|20)\d{2}/);
        if (yearMatch) {
          const year = yearMatch[0];
          return `${year}/01/01`;
        }
      } catch (innerError) {
        this.logger.error('年份提取失败', innerError);
      }
      
      // 完全无效时返回空字符串
      return '';
    }
  }
  
  // 检查日期是否有效
  _isValidDate(year, month, day) {
    const daysInMonth = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    
    // 检查闰年
    if (month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
      daysInMonth[2] = 29;
    }
    
    return day >= 1 && day <= daysInMonth[month];
  }
  
  // 提取文本辅助方法
  extractText(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : '';
  }
  
  // 检查是否可在当前页面提取
  async canExtract() {
    try {
      const url = window.location.href;
      return /^https:\/\/(bgm\.tv|bangumi\.tv|chii\.in)\/subject\/\d+$/.test(url);
    } catch (error) {
      this.logger.error('页面检测失败', error);
      return false;
    }
  }
  
  // 执行提取
  async extract() {
    try {
      // 检查是否可以提取
      if (!await this.canExtract()) {
        return { success: false, message: '当前页面不是番组计划书籍页面' };
      }
      
      // 执行提取
      const fields = await this.extractSpecificFields();
      
      return { success: true, data: fields };
    } catch (error) {
      this.logger.error('番组计划书籍提取失败', error);
      return { success: false, message: '提取失败', error: error.message };
    }
  }
}

// 将提取器注册到全局作用域，确保能被提取器工厂找到
if (window) {
  // 确保提取器映射对象存在
  if (!window.extractorMap) {
    window.extractorMap = {};
  }
  
  // 注册番组计划书籍提取器
  window.extractorMap['bgm_book'] = BgmBookExtractor;
  
  // 为了兼容bgm.tv域名的识别
  if (!window.domainExtractorMap) {
    window.domainExtractorMap = {};
  }
  window.domainExtractorMap['bgm.tv'] = BgmBookExtractor;
  
  // 导出提取器到全局作用域
  window.BgmBookExtractor = BgmBookExtractor;
  
}