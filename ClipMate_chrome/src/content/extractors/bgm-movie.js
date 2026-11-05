// 番组计划(bgm.tv)影视提取器
  // 版本: 1.2.1
  // 更新历史:
  // - 1.2.1: 三次元电影页的「上映日」纳入上映日期（原来只认放送开始/上映年度/首播/开始）
  // - 1.2.0: 添加别名提取功能，从书籍/游戏模块移植getBgmAliases方法，支持Set去重和三级提取策略
  // - 1.1.0: 调整字段提取逻辑，采用"基础提取逻辑共用+媒体类型差异化处理"混合策略
  //          统一使用"片名"和"上映日期"字段，无论媒体类型都尝试提取所有相关字段
// - 1.0.0: 初始版本，实现番组计划影视提取功能
// 注意：在浏览器插件环境中，所有类都通过全局作用域访问

class BgmMovieExtractor extends window.BaseExtractor {
  constructor() {
    super();
    this.siteName = 'bgm_movie';
    
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
    
    // 初始化媒体类型检测器
    this.mediaTypeDetector = new window.MediaTypeDetector();
    
    // 初始化默认字段映射器 - 实际类型将在extract方法中动态确定
    this.fieldMapper = null;
  }
  
  // 创建日志记录器
  _createLogger() {
    const logPrefix = '[BgmMovieExtractor]';
    
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
  
  // 检查是否可在当前页面提取
  async canExtract() {
    try {
      const url = window.location.href;
      // 检查是否是番组计划的影视页面（包括剧集和电影）
      const isBgmSubject = /^https:\/\/(bgm\.tv|bangumi\.tv|chii\.in)\/subject\/\d+$/.test(url);
      if (!isBgmSubject) return false;
      
      const headerSubjectType = document.querySelector('#headerSubject h1 small');
      if (headerSubjectType) {
        const typeText = headerSubjectType.textContent;
        // 检查是否为影视类型（剧集或电影）
        return typeText.includes('动画') || typeText.includes('剧场版') || 
               typeText.includes('TV') || typeText.includes('电影');
      }
      
      // 备用检测：通过页面内容判断
      const infobox = document.querySelector('#infobox');
      if (infobox) {
        const infoboxText = infobox.textContent;
        // 影视页面通常包含导演、编剧等字段
        return infoboxText.includes('导演') || infoboxText.includes('编剧') || 
               infoboxText.includes('音乐') || infoboxText.includes('人物设定');
      }
      
      return false;
    } catch (error) {
      console.error('页面检测失败', error);
      return false;
    }
  }

  // 主提取方法
  async extract() {
    try {
      // 检查当前页面是否为番组计划影视页面
      if (!this.canExtract()) {
        this.logger.warn('当前页面不是番组计划影视页面');
        return {};
      }
      
      // 检测具体的媒体类型（movie或tv）
      const mediaType = this.mediaTypeDetector.detect(window.location.href, document);
      this.logger.info(`检测到媒体类型: ${mediaType}`);
      
      // 根据检测到的媒体类型初始化相应的字段映射器
      if (!this.fieldMapper || this.fieldMapper.mediaType !== mediaType) {
        this.fieldMapper = new window.UniversalFieldMapper(mediaType);
        this.logger.info(`初始化${mediaType === 'movie' ? '电影' : '剧集'}字段映射器`);
      }
      
      // 使用BaseExtractor的extractAllFields方法提取所有字段
      const allFields = await this.extractAllFields();
      
      // 添加URL字段
      allFields.url = window.location.href;
      
      // 添加媒体类型标识字段
      allFields['影视类型'] = mediaType === 'movie' ? '电影' : '剧集';
      
      this.logger.info(`番组计划${mediaType === 'movie' ? '电影' : '剧集'}页面数据提取完成`);
      return allFields;
    } catch (error) {
      this.logger.error('提取数据失败:', error);
      return {};
    }
  }

  // 提取特定字段
  async extractSpecificFields() {
    const fields = {};
    
    try {
      // 检测媒体类型（仍然保留，但不严格控制提取逻辑）
      const mediaType = this.mediaTypeDetector.detect(window.location.href, document);
      this.logger.info(`检测到媒体类型: ${mediaType}`);
      
      // 1. 影视名（中文名）- 统一使用"片名"字段
      fields['片名'] = await this.extractMovieName();
      
      // 2. 原作名
      fields['原作名'] = await this.extractOriginalTitle();
      
      // 3. 别名
      fields['别名'] = await this.getBgmAliases();
      
      // 4. 导演
      fields['导演'] = await this.extractDirectors();
      
      // 5. 编剧/脚本
      fields['编剧'] = await this.extractScreenwriters();
      
      // 6. 主演/声优
      fields['主演'] = await this.extractActors();
      
      // 7. 上映/首播日期 - 统一使用"上映日期"字段
      fields['上映日期'] = await this.extractReleaseDate();
      
      // 8. 国家信息 - 从标签中提取国家信息，多国合作时用英文逗号分隔
      fields['国家'] = await this.extractCountries();
      
      // 9. 集数 - 无论媒体类型如何，都尝试提取
      const episodes = await this.extractEpisodes();
      if (episodes) {
        fields['集数'] = episodes;
      }
      
      // 10. 单集片长 - 无论媒体类型如何，都尝试提取
      const episodeRuntime = await this.extractEpisodeRuntime();
      if (episodeRuntime) {
        fields['单集片长'] = episodeRuntime;
      }
      
      // 11. 电影片长 - 无论媒体类型如何，都尝试提取
      const movieRuntime = await this.extractMovieRuntime();
      if (movieRuntime) {
        fields['片长'] = movieRuntime;
      }
      
      // 12. 简介
      fields['简介'] = this.extractDescription();
      
      // 13. 豆瓣链接
      fields['豆瓣链接'] = await this.extractDoubanLink();
      
      // 14. IMDB信息
      const imdbInfo = await this.extractIMDbInfo();
      Object.assign(fields, imdbInfo);
      
      // 15. Bangumi链接 - 设置为当前页面链接
      fields['Bangumi'] = window.location.href;
      
      // 16. 标签（v2.12.0：站内标签区的 UGC 词 → 44 个标准标签；没并进去的原词进其他信息）
      fields['标签'] = await this.extractStandardTags();

      // 17. 其他信息（合并剩余字段，包含官方网站）
      fields['其他信息'] = await this.extractOtherInfo();
      
      // 18. 媒体类型标识 - 保留以便参考
      fields['影视类型'] = mediaType === 'movie' ? '电影' : '剧集';
      
    } catch (error) {
      this.logger.error('提取特定字段失败:', error);
    }
    
    return fields;
  }
  
  // 提取别名
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
      
      this.logger.info('提取到别名:', result || '无别名');
      return result;
    } catch (error) {
      this.logger.error('提取番组计划影视别名失败:', error);
      return '';
    }
  }

  // 提取影视中文名
  async extractMovieName() {
    try {
      // 方法1：从信息框中查找中文名
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && tipElement.textContent.includes('中文名')) {
            const movieName = item.textContent.replace(tipElement.textContent, '').trim();
            if (movieName) {
              this.logger.info('提取到影视中文名:', movieName);
              return movieName;
            }
          }
        }
      }
      
      // 方法2：从页面标题提取
      const pageTitle = document.title || '';
      const titleParts = pageTitle.split('|')[0].trim();
      if (titleParts) {
        this.logger.info('从页面标题提取影视名:', titleParts);
        return titleParts;
      }
      
      this.logger.warn('未找到影视中文名');
      return '';
    } catch (error) {
      this.logger.error('提取影视中文名失败:', error);
      return '';
    }
  }

  // 提取原作名
  async extractOriginalTitle() {
    try {
      // 从h1标签提取原作名
      const h1Element = document.querySelector('#headerSubject h1 a');
      if (h1Element) {
        const originalTitle = h1Element.textContent.trim();
        this.logger.info('从h1标签提取原作名:', originalTitle);
        return originalTitle;
      }
      
      // 备用方法：从页面标题提取
      const pageTitle = document.title || '';
      const titleParts = pageTitle.split('|')[0].trim();
      if (titleParts) {
        this.logger.info('从页面标题提取原作名:', titleParts);
        return titleParts;
      }
      
      this.logger.warn('未找到原作名');
      return '';
    } catch (error) {
      this.logger.error('提取原作名失败:', error);
      return '';
    }
  }

  // 提取导演
  async extractDirectors() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && tipElement.textContent.includes('导演')) {
            // 先尝试提取链接形式的导演
            const directors = [];
            const links = item.querySelectorAll('a.l');
            
            if (links.length > 0) {
              links.forEach(link => {
                if (link.textContent.trim()) {
                  directors.push(link.textContent.trim());
                }
              });
            } else {
              // 如果没有链接，则提取整个文本内容（去掉标签）
              const directorText = item.textContent.replace(tipElement.textContent, '').trim();
              if (directorText) {
                // 按分隔符分割（如斜杠、顿号等）
                const parts = directorText.split(/[,，、/]/);
                parts.forEach(part => {
                  const trimmedPart = part.trim();
                  if (trimmedPart) {
                    directors.push(trimmedPart);
                  }
                });
              }
            }
            
            if (directors.length > 0) {
              const directorsStr = directors.join('、');
              this.logger.info('提取到导演:', directorsStr);
              return directorsStr;
            }
          }
        }
      }
      
      this.logger.warn('未找到导演信息');
      return '';
    } catch (error) {
      this.logger.error('提取导演失败:', error);
      return '';
    }
  }

  // 提取编剧
  async extractScreenwriters() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          // 同时检查"脚本"和"编剧"字段
          if (tipElement && (tipElement.textContent.includes('脚本') || tipElement.textContent.includes('编剧'))) {
            // 先尝试提取链接形式的编剧
            const screenwriters = [];
            const links = item.querySelectorAll('a.l');
            
            if (links.length > 0) {
              links.forEach(link => {
                if (link.textContent.trim()) {
                  screenwriters.push(link.textContent.trim());
                }
              });
            } else {
              // 如果没有链接，则提取整个文本内容（去掉标签）
              const writerText = item.textContent.replace(tipElement.textContent, '').trim();
              if (writerText) {
                // 按分隔符分割（如斜杠、顿号等）
                const parts = writerText.split(/[,，、/]/);
                parts.forEach(part => {
                  const trimmedPart = part.trim();
                  if (trimmedPart) {
                    screenwriters.push(trimmedPart);
                  }
                });
              }
            }
            
            if (screenwriters.length > 0) {
              const screenwritersStr = screenwriters.join('、');
              this.logger.info('提取到编剧:', screenwritersStr);
              return screenwritersStr;
            }
          }
        }
      }
      
      this.logger.warn('未找到编剧信息');
      return '';
    } catch (error) {
      this.logger.error('提取编剧失败:', error);
      return '';
    }
  }

  // 提取主演/声优
  async extractActors() {
    try {
      // 方法1：从角色介绍区域提取带有CV标记的声优信息
      const characterList = document.querySelector('#browserItemList');
      if (characterList) {
        const actors = [];
        
        // 查找所有包含CV标记的元素
        const cvElements = characterList.querySelectorAll('.badge_actor');
        cvElements.forEach(container => {
          // 检查是否包含CV标记
          const cvLabel = container.querySelector('.tip_i');
          if (cvLabel && cvLabel.textContent === 'CV') {
            // 提取声优名称 - 修复选择器，实际HTML中链接没有l类名
            const actorLinks = container.querySelectorAll('a');
            actorLinks.forEach(link => {
              if (link.textContent.trim()) {
                actors.push(link.textContent.trim());
              }
            });
          }
        });
        
        // 使用Set去重，确保不会有重复的演员信息
        const uniqueActors = [...new Set(actors)];
        
        if (uniqueActors.length > 0) {
          const actorsStr = uniqueActors.join('、');
          this.logger.info('从角色介绍提取到CV声优:', actorsStr);
          return actorsStr;
        }
      }
      
      // 方法2：从信息框查找声优或主演信息（作为备选方案）
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && (tipElement.textContent.includes('声优') || tipElement.textContent.includes('主演') || tipElement.textContent.includes('演出'))) {
            const actors = [];
            const links = item.querySelectorAll('a');
            links.forEach(link => {
              if (link.textContent.trim()) {
                actors.push(link.textContent.trim());
              }
            });
            
            // 如果没有链接，则尝试提取文本内容
            if (actors.length === 0) {
              const textContent = item.textContent.replace(tipElement.textContent, '').trim();
              if (textContent) {
                // 按分隔符分割
                const parts = textContent.split(/[,，、/]/);
                parts.forEach(part => {
                  const trimmedPart = part.trim();
                  if (trimmedPart) {
                    actors.push(trimmedPart);
                  }
                });
              }
            }
            
            if (actors.length > 0) {
              const uniqueActors = [...new Set(actors)];
              const actorsStr = uniqueActors.join('、');
              this.logger.info('从信息框提取到声优/主演:', actorsStr);
              return actorsStr;
            }
          }
        }
      }
      
      // 对于某些页面（如非日本动画），可能没有明确的声优/主演信息，减少警告输出
      this.logger.debug('未找到声优/主演信息');
      return '';
    } catch (error) {
      this.logger.error('提取声优/主演失败:', error);
      return '';
    }
  }

  // 提取类型
  async extractGenres() {
    try {
      // 从标签区域提取类型信息
      // v2.12.0：改用 this._root() 而不是全局 document —— 与豆瓣收藏列表页
      // 那种「换一份文档当提取源」的用法保持同一套约定，也方便离线单测喂存档。
      const tagSection = this._root().querySelector('.subject_tag_section');
      if (tagSection) {
        const genres = [];
        const tagLinks = tagSection.querySelectorAll('a.l.meta');
        tagLinks.forEach(link => {
          // v2.12.0：**不能直接读 textContent**。Bangumi 的标签链接长这样：
          //   <a class="l meta"><span>犯罪</span> <small class="grey">107</small></a>
          //   textContent 拿到的是「犯罪 107」，后面那个是用户投票计数。
          //   旧代码（从未被调用过）一直有此问题：带数字的词一个都查不到表，
          //   全被当成未命中丢进「其他信息」，标签列恒空。
          const nameEl = link.querySelector('span');
          const text = (nameEl ? nameEl.textContent : link.textContent) || '';
          const t = text.trim();
          if (t) {
            genres.push(t);
          }
        });
        
        if (genres.length > 0) {
          const genresStr = genres.join('、');
          this.logger.info('提取到类型:', genresStr);
          return genresStr;
        }
      }
      
      this.logger.warn('未找到类型信息');
      return '';
    } catch (error) {
      this.logger.error('提取类型失败:', error);
      return '';
    }
  }

  /**
   * v2.12.0：「标签」列 —— 站内标签区的词过统一转化库。
   *
   * 【为什么这个方法以前一直是死的】
   * `extractGenres()` 从 v2.5.x 就写好了，但**全项目零调用、也没有按字段名反射调度**
   * 的机制，所以 Bangumi 的「标签」列永远是空的。这是 v2.12.0 补上的最大一个洞。
   *
   * 【为什么是「标签区」而不是「类型」】
   * Bangumi 条目页没有豆瓣那种官方类型字段，`.subject_tag_section` 里是**用户投票
   * 打的标签**（校园 / 治愈 / OVA / 原创 / TV…）。它天然是 UGC 词，正是 D11
   * 「查不到就进其他信息」要兜的那一类。
   */
  async extractStandardTags() {
    const raw = await this.extractGenres();
    if (!raw) return '';
    return this._standardTags('Bangumi', raw, raw);
  }

  /** D10 / D11：没并进「标签」的原词，留给「其他信息」展示，一个都不丢 */
  async _leftoverTagWords() {
    const raw = await this.extractGenres();
    if (!raw) return '';
    return this._leftoverTags('Bangumi', raw);
  }

  // 提取国家信息 - 直接使用BaseExtractor中的共享方法
  
  // 提取首播日期
  async extractReleaseDate() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement) {
            const tipText = tipElement.textContent;
            // 查找包含首播日期相关文本的元素
            // v2.5.71：补「上映日」——番组计划的三次元电影页（如 /subject/64965 教父）
            // 信息框写的是「上映日: 1972-03-15」，不含「开始/首播/上映年度」任何字样，
            // 原来这个字段整格恒为空。动画剧集仍走「放送开始」，动画电影走「上映年度」。
            if (tipText.includes('放送开始') || tipText.includes('上映年度') || tipText.includes('上映日') ||
                tipText.includes('首播') || tipText.includes('开始')) {
              const releaseDate = item.textContent.replace(tipElement.textContent, '').trim();
              if (releaseDate && releaseDate !== '放送开始' && releaseDate !== '上映年度' && releaseDate !== '上映日') {
                this.logger.info('提取到首播日期:', releaseDate);
                return releaseDate;
              }
            }
          }
        }
      }
      
      this.logger.warn('未找到首播日期');
      return '';
    } catch (error) {
      this.logger.error('提取首播日期失败:', error);
      return '';
    }
  }

  // 提取剧集集数
  async extractEpisodes() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && (tipElement.textContent.includes('话数') || tipElement.textContent.includes('集数'))) {
            const episodes = item.textContent.replace(tipElement.textContent, '').trim();
            if (episodes) {
              this.logger.info('提取到剧集集数:', episodes);
              return episodes;
            }
          }
        }
      }
      
      this.logger.warn('未找到集数信息');
      return '';
    } catch (error) {
      this.logger.error('提取集数失败:', error);
      return '';
    }
  }
  
  // 提取单集片长
  async extractEpisodeRuntime() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && (tipElement.textContent.includes('片长') || 
              tipElement.textContent.includes('时长') || 
              tipElement.textContent.includes('单集片长'))) {
            // 尝试提取单集片长信息
            const runtimeText = item.textContent.replace(tipElement.textContent, '').trim();
            if (runtimeText) {
              this.logger.info('提取到单集片长:', runtimeText);
              return runtimeText;
            }
          }
        }
      }
      
      this.logger.debug('未找到单集片长信息');
      return '';
    } catch (error) {
      this.logger.error('提取单集片长失败:', error);
      return '';
    }
  }
  
  // 提取电影片长
  async extractMovieRuntime() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && (tipElement.textContent.includes('片长') || 
              tipElement.textContent.includes('时长') || 
              tipElement.textContent.includes('runtime'))) {
            const runtime = item.textContent.replace(tipElement.textContent, '').trim();
            if (runtime) {
              this.logger.info('提取到电影片长:', runtime);
              return runtime;
            }
          }
        }
      }
      
      this.logger.debug('未找到电影片长信息');
      return '';
    } catch (error) {
      this.logger.error('提取电影片长失败:', error);
      return '';
    }
  }

  // 提取简介
  extractDescription() {
    try {
      const summaryElement = document.querySelector('#subject_summary');
      if (summaryElement) {
        const description = summaryElement.textContent.trim();
        this.logger.info('提取到简介:', description);
        return description;
      }
      
      this.logger.warn('未找到简介');
      return '';
    } catch (error) {
      this.logger.error('提取简介失败:', error);
      return '';
    }
  }

  // 提取官方网站
  async extractOfficialWebsite() {
    try {
      const infoBox = document.querySelector('ul#infobox');
      if (infoBox) {
        const listItems = infoBox.querySelectorAll('li:not(.sub_container)');
        for (const item of listItems) {
          const tipElement = item.querySelector('.tip');
          if (tipElement && tipElement.textContent.includes('官方网站')) {
            const linkElement = item.querySelector('a');
            if (linkElement && linkElement.href) {
              this.logger.info('提取到官方网站:', linkElement.href);
              return linkElement.href;
            }
          }
        }
      }
      
      this.logger.debug('未找到官方网站');
      return '';
    } catch (error) {
      this.logger.error('提取官方网站失败:', error);
      return '';
    }
  }

  // 提取IMDb信息
  extractIMDbInfo() {
    try {
      
      // 方法1: 直接从信息框中查找IMDb信息
      try {
        // 查找可能包含IMDb信息的元素
        const infoElements = document.querySelectorAll('.subjectinfo, .info, #infobox, .infobox');
        
        for (const element of infoElements) {
          const text = element.textContent;
          // 修复：匹配IMDb或imdb_id字段，要求tt后面至少有7位数字
          const imdbMatch = text.match(/(?:IMDb|imdb_id)[：:]?\s*(tt\d{7,})/i);
          
          if (imdbMatch && imdbMatch[1]) {
            const imdbId = imdbMatch[1];
            
            // 简化返回，只保留IMDB字段
            return {
              'IMDB': `https://www.imdb.com/title/${imdbId}/`
            };
          }
        }
      } catch (infoError) {
        console.warn('[BgmMovieExtractor] 从信息框提取IMDb信息时发生错误:', infoError);
      }
      
      // 方法2: 查找页面中的IMDb链接元素
      try {
        const imdbLinks = Array.from(document.querySelectorAll('a[href*="imdb.com/title/"]'));
        
        for (const link of imdbLinks) {
          const href = link.getAttribute('href');
          // 修复：要求tt后面至少有7位数字，避免匹配无效ID如"tt7"
          const imdbMatch = href.match(/imdb\.com\/title\/(tt\d{7,})/i);
          if (imdbMatch && imdbMatch[1]) {
            const imdbId = imdbMatch[1];
            
            // 简化返回，只保留IMDB字段
            return {
              'IMDB': `https://www.imdb.com/title/${imdbId}/`
            };
          }
        }
      } catch (linkError) {
        console.warn('[BgmMovieExtractor] 从链接元素提取IMDb信息时发生错误:', linkError);
      }
      
      // 注意：这里**故意不再有**「把整页文字拼起来全局搜 tt\d{7,}」这条兜底。
      // 原因（v2.5.70 实测）：
      //   1) 零收益——真实页面（教父 tt0068646、权力的游戏 tt0944947）用方法1 就能拿到，
      //      方法3 抓到的与之完全相同；没有 IMDb 的页面（EVA、千与千寻）它也抓不到。
      //   2) 纯风险——它扫的是整页文字，内联脚本、埋点 ID、评论里引用的一串
      //      tt+7位数字都会被当成 IMDb 编号，指向一部完全无关的片子。
      //   3) 曾造成事故——测试脚手架把扩展源码当 <script> 注入页面，它搜到了
      //      douban-movie.js 注释里举例用的 tt1234567，把假编号写进了基线。
      // 番组计划的信息框写法是 `imdb_id: tt0068646`（小写+下划线），方法1 的正则已覆盖。

    } catch (error) {
      console.error('[BgmMovieExtractor] 提取IMDb信息过程中发生严重错误:', error);
    }
    
    // 返回空对象表示未找到IMDb信息
    return {};
  }
  
  // 提取豆瓣链接
  async extractDoubanLink() {
    try {
      // 番组计划页面通常不直接提供豆瓣链接，可以尝试从分享区域查找
      const shareButtons = document.querySelectorAll('.share_douban');
      if (shareButtons.length > 0) {
        // 尝试从分享按钮的onclick事件中提取豆瓣链接
        for (const button of shareButtons) {
          const onclickAttr = button.getAttribute('onclick');
          if (onclickAttr && onclickAttr.includes('douban')) {
            this.logger.info('提取到豆瓣链接:', onclickAttr);
            return onclickAttr;
          }
        }
      }
      
      this.logger.debug('未找到豆瓣链接');
      return '';
    } catch (error) {
      this.logger.error('提取豆瓣链接失败:', error);
      return '';
    }
  }

  // 提取其他信息
  // 提取其他信息（与书籍和游戏模块保持一致的处理规范）
  async extractOtherInfo() {
    try {
      
      // 定义需要包含在其他信息中的字段白名单及其对应的显示名称
      const fieldWhitelist = {
        '脚本': '编剧',
        '编剧': '编剧',
        '原作': '原作',
        '人物设定': '人物设定',
        '作画监督': '作画监督',
        '音乐': '音乐',
        '动画制作': '动画制作',
        '制作公司': '动画制作',
        '出品公司': '出品公司',
        '发行公司': '发行公司',
        '制片国家/地区': '制片国家/地区',
        '语言': '语言',
        '集数': '集数',
        '单集片长': '单集片长',
        'IMDb': 'IMDb',
        '发售日': '发售日',
        '开始': '开始',
        '结束': '结束',
        '版权信息': '版权信息',
        '备注': '备注',
        '官方网站': '官方网站'  // 添加官方网站到白名单
      };
      
      // 已处理的主要字段，不在其他信息中重复显示
      // v2.5.71：加「上映日」，与「放送开始/上映年度/首播」同样只进「上映日期」，不再漏到其他信息
      const processedFields = [
        '中文名', '原作名', '导演', '主演', '放送开始', '上映年度', '上映日', 
        '首播', '片长', '豆瓣链接', '编剧', '脚本'
      ];
      
      // 存储提取到的信息，键为字段名，值为显示文本
      const fieldValues = new Map();
      const infoBox = document.querySelector('ul#infobox');
      
      if (infoBox) {
        // 按DOM顺序提取字段，确保显示顺序正确
        const items = infoBox.querySelectorAll('li:not(.sub_container)');
        
        items.forEach(item => {
          const tipEl = item.querySelector('span.tip');
          if (tipEl) {
            // 获取字段名（去掉冒号和空格）
            let fieldName = tipEl.textContent.trim().replace(/[:：]\s*$/, '');
            
            // 跳过已处理的主要字段
            if (processedFields.includes(fieldName)) {
              return;
            }
            
            // 获取字段内容，排除tip元素
            const content = item.textContent.replace(tipEl.textContent, '').trim();
            
            if (content) {
              // 检查是否在白名单中
              for (const [key, displayName] of Object.entries(fieldWhitelist)) {
                if (fieldName === key || fieldWhitelist[fieldName] === displayName) {
                  // 清理内容：移除多余空格和换行
                  const cleanedContent = content.replace(/\s+/g, ' ').trim();
                  
                  // 避免重复添加相同字段
                  if (!fieldValues.has(displayName)) {
                    fieldValues.set(displayName, cleanedContent);
                  }
                  break;
                }
              }
            }
          }
        });
      }
      
      // 按照常见的影视信息顺序构建最终的其他信息数组
      const orderedFields = [
        '原作', '编剧', '人物设定', '作画监督', '音乐', 
        '动画制作', '出品公司', '发行公司', '制片国家/地区', 
        '语言', '集数', '单集片长', '官方网站', 'IMDb', '发售日', 
        '开始', '结束', '版权信息', '备注'
      ];
      const otherInfo = [];
      
      // 需要限制人名数量的字段列表
      const personNameFields = ['作画监督', '音乐', '人物设定', '动画制作'];
      
      // 按照预定顺序添加字段，并对特定字段限制人名数量
      orderedFields.forEach(field => {
        if (fieldValues.has(field)) {
          let fieldValue = fieldValues.get(field);
          
          // 只对特定的"其他信息"子字段应用人名数量限制
          if (personNameFields.includes(field)) {
            // 尝试分割人名（支持逗号和顿号分隔）
            const names = fieldValue.split(/[,，、]/).map(name => name.trim()).filter(name => name);
            
            // 如果人名数量超过5个，只显示前5个并添加"等"字
            if (names.length > 5) {
              fieldValue = names.slice(0, 5).join('、') + ' 等';
            }
          }
          
          // 使用中文冒号分隔字段名和值，与书籍和游戏模块保持一致
          otherInfo.push(`${field}：${fieldValue}`);
        }
      });
      
      // v2.12.0：站内标签里没能并进「标签」列的词（D10 已知不并 + D11 未命中），
      // 原样留在其他信息里。Bangumi 的标签是用户投票产生的，每天都有新词。
      const leftoverTags = await this._leftoverTagWords();
      if (leftoverTags) {
        otherInfo.push(`站内标签：${leftoverTags}`);
      }

      // 使用中文逗号连接各字段，与书籍和游戏模块保持一致
      const result = otherInfo.join('，').trim();
      
      // 添加详细日志记录
      if (otherInfo.length > 0) {
        otherInfo.forEach((item, index) => {
        });
      }
      
      return result;
    } catch (error) {
      console.error('[BgmMovieExtractor] 提取其他信息失败:', error);
      return '';
    }
  }
}

// 将提取器注册到全局作用域，确保能被提取器工厂找到
if (window) {
  // 确保提取器映射对象存在
  if (!window.extractorMap) {
    window.extractorMap = {};
  }
  
  // 注册番组计划影视提取器
  window.extractorMap['bgm_movie'] = BgmMovieExtractor;
  
  // 为了兼容bgm.tv域名的识别
  if (!window.domainExtractorMap) {
    window.domainExtractorMap = {};
  }
  window.domainExtractorMap['bgm.tv'] = BgmMovieExtractor;
  
  // 导出提取器到全局作用域
  window.BgmMovieExtractor = BgmMovieExtractor;
  
}