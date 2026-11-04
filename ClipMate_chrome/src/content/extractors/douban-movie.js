// 豆瓣电影提取器
class DoubanMovieExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douban_movie';

    // v2.11.4：提取源。默认就是当前页面 —— 行为与改造前一致。
    // 豆瓣收藏列表页的小按钮会调 setSource(解析后的文档, 详情页地址)，
    // 让这一整套选择器去读「另一个页面的 HTML」，不再维护第二份。
    this.doc = document;
    this.pageUrl = window.location.href;

    // 人员字段配置 - 已完全移除所有人员相关配置
  }

  /**
   * v2.11.4：切换提取源。
   * @param {Document|null} doc 目标文档（DOMParser 解析出来的也算）；传 null 恢复当前页
   * @param {string} [url] 该文档的真实地址（用于 /tv/ 判定与「豆瓣链接」字段）
   * @returns {this}
   */
  setSource(doc, url) {
    this.doc = doc || document;
    this.pageUrl = url || window.location.href;
    return this;
  }

  // 提取评分
  // 只认页面上「豆瓣评分」那一格。豆瓣页面可能被第三方脚本（例如油猴上的多站评分脚本）
  // 注入额外的评分块（客观评分 / IMDb评分 / RGraph评分 / 好友评分 等），
  // 原先靠 .rating 容器取第一个数字会抓到别的站的分，所以这里锁定豆瓣官方微数据
  // property="v:average"（就是页面上显示的那个豆瓣评分），再退到「豆瓣评分」标签那一格。
  // 注意：只覆写本类，不动 BaseExtractor，其它站点完全不受影响。
  extractRating() {
    const pick = (el) => {
      if (!el) return '';
      return this.parseRating((el.textContent || '').trim());
    };

    // 1) 官方微数据：<strong class="ll rating_num" property="v:average">9.7</strong>
    let rating =
      pick(this.doc.querySelector('#interest_sectl [property="v:average"]')) ||
      pick(this.doc.querySelector('[property="v:average"]'));
    if (rating) return rating;

    // 2) 兜底：评分区里标注为「豆瓣评分」的那一格
    const wraps = this.doc.querySelectorAll('#interest_sectl .rating_wrap');
    for (const wrap of wraps) {
      const label = wrap.querySelector('.rating_logo');
      if (label && /豆瓣评分/.test(label.textContent || '')) {
        rating = pick(wrap.querySelector('.rating_num'));
        if (rating) return rating;
      }
    }

    // 3) 再兜底：评分区里只有一个评分时取它（防止豆瓣改掉微数据标签）
    const nums = this.doc.querySelectorAll('#interest_sectl strong.rating_num');
    if (nums.length === 1) {
      rating = pick(nums[0]);
      if (rating) return rating;
    }

    // 没有评分（未上映 / 评价人数不足）就留空，不猜其它数字
    return '';
  }
  
  // 提取JSON-LD结构化数据
  extractJsonLdData() {
    try {
      const scriptTags = this.doc.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scriptTags) {
        try {
          const data = JSON.parse(script.textContent);
          // 确保是电影数据
          if (data['@type'] && data['@type'].includes('Movie')) {
            return data;
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    } catch (error) {
      console.error('提取JSON-LD数据失败:', error);
    }
    return null;
  }
  
  // 检查名字是否包含中英文两种语言
  hasBothLanguages(name) {
    if (!name || typeof name !== 'string') return false;
    const hasChinese = /[\u4e00-\u9fa5]/.test(name);
    const hasEnglish = /[a-zA-Z]/.test(name);
    return hasChinese && hasEnglish;
  }
  
  // 直接返回原始名字，不进行任何处理
  getPersonName(person) {
    if (!person) return '';
    
    if (typeof person === 'string') {
      return this.cleanText(person);
    } else if (typeof person === 'object') {
      // 收集所有可能的名字属性
      const names = [];
      
      // 支持更丰富的Person对象属性
      if (person.name) {
        names.push(this.cleanText(person.name));
      }
      if (person['@value'] && person['@value'] !== person.name) {
        names.push(this.cleanText(person['@value']));
      }
      if (person.alternateName && person.alternateName !== person.name && person.alternateName !== person['@value']) {
        // 如果alternateName与name不同，可能是英文或其他语言的名字
        names.push(this.cleanText(person.alternateName));
      }
      
      // 如果有多个名字，组合它们
      if (names.length > 0) {
        // 直接返回组合后的原始名字，不进行任何处理
        return names.join(' ');
      }
    }
    return '';
  }
  
  // 直接返回原始名字，不进行任何处理
  getPersonNameByMode(name, mode = 'auto') {
    if (!name || typeof name !== 'string') return '';
    
    // 直接返回原始名字，不进行任何处理
    return name.trim();
  }

  // 提取IMDb信息
  extractIMDbInfo() {
    try {
      
      // 方法1: 直接从#info元素中提取文本匹配
      const infoElement = this.doc.querySelector('#info');
      if (infoElement) {
        const infoText = infoElement.textContent;
        
        // 多种可能的IMDb格式匹配模式
        const imdbPatterns = [
          /IMDb[：:]?\s*(tt\d{7,})/,      // 标准格式: IMDb: tt1234567
          /imdb[：:]?\s*(tt\d{7,})/i,     // 忽略大小写
          /(tt\d{7,})/,                  // 直接匹配IMDb ID格式
          /IMDb\s*链接[：:]?\s*(tt\d{7,})/  // 可能包含"链接"字样
        ];
        
        for (const pattern of imdbPatterns) {
          const imdbMatch = infoText.match(pattern);
          if (imdbMatch && imdbMatch[1]) {
            const imdbId = imdbMatch[1];
            
            // 简化返回，只保留IMDB字段
            return {
              'IMDB': `https://www.imdb.com/title/${imdbId}/`
            };
          }
        }
        
      } else {
      }
      
      // 方法2: 查找页面中的IMDb链接元素
      try {
        const imdbLinks = Array.from(this.doc.querySelectorAll('a[href*="imdb.com/title/"]'));
        
        for (const link of imdbLinks) {
          const href = link.getAttribute('href');
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
        console.warn('[DoubanMovieExtractor] 从链接元素提取IMDb信息时发生错误:', linkError);
      }
      
      // 注意：这里**故意不再有**「把整页文字拼起来全局搜 tt\d{7,}」这条兜底（v2.5.71 删除）。
      // 原因与 v2.5.70 删掉番组计划那处完全相同：
      //   1) 零收益——豆瓣的 IMDb 编号就写在 #info 里（`IMDb: tt0111161`），
      //      方法1 的 `/(tt\d{7,})/` 已经能拿到；实测样本 tt0111161 来自方法1，与方法3 结果一致。
      //   2) 纯风险——整页文字包含内联脚本、埋点 ID、评论里引用的编号，
      //      抓到就会指向一部完全无关的片子。

    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取IMDb信息过程中发生严重错误:', error);
    }
    
    // 返回空对象表示未找到IMDb信息
    return {};
  }

  // 判断是否为电视剧
  isTvSeries() {
    // 通过URL判断
    if (this.pageUrl.includes('/tv/')) {
      return true;
    }
    
    // 通过页面特征判断
    const infoElement = this.doc.querySelector('#info');
    if (infoElement) {
      const infoText = infoElement.textContent;
      // 检查是否包含集数信息（提高识别率）
      if (infoText.includes('集数') || infoText.includes('季数') || (infoText.includes('共') && infoText.includes('集'))) {
        return true;
      }
      // 检查类型是否包含电视剧相关词汇
      const typeElements = this.doc.querySelectorAll('[property="v:genre"]');
      const genres = Array.from(typeElements).map(el => el.textContent.toLowerCase());
      if (genres.some(genre => genre.includes('电视剧') || genre.includes('剧集') || genre.includes('动画剧'))) {
        return true;
      }
      // 从标题判断（包含"季"或"季数"）
      const titleElement = this.doc.querySelector('h1 span[property="v:itemreviewed"]') || 
                          this.doc.querySelector('h1 span');
      if (titleElement) {
        const titleText = titleElement.textContent.toLowerCase();
        if (titleText.includes('season') || titleText.includes('季')) {
          return true;
        }
      }
    }
    
    return false;
  }

  // 提取编剧信息
  extractWriters() {
    
    const writers = [];
    let jsonLdExtractionSuccess = false;
    
    try {
      // 主提取策略：从页面中查找并解析JSON-LD脚本
      const scriptTags = this.doc.querySelectorAll('script[type="application/ld+json"]');
      
      for (const script of scriptTags) {
        try {
          // 获取原始文本内容
          let scriptContent = script.textContent.trim();
          
          // 尝试解析JSON数据
          const data = JSON.parse(scriptContent);
          
          // 检查是否包含author数组或对象（根据示例，编剧信息在author字段中）
          if (data && data.author) {
            
            // 处理author数组
            if (Array.isArray(data.author)) {
              // 遍历author数组提取编剧信息
              data.author.forEach(author => {
                if (author.name) {
                  // 提取原始名字，不做任何处理
                  const name = author.name;
                  if (name && typeof name === 'string' && name.trim().length > 0) {
                    writers.push(name.trim());
                  }
                }
              });
            } else if (typeof data.author === 'object' && data.author.name) {
              // 处理单个author对象
              const name = data.author.name;
              if (name && typeof name === 'string' && name.trim().length > 0) {
                writers.push(name.trim());
              }
            }
            
            // 如果找到编剧信息，标记主策略成功并跳出循环
            if (writers.length > 0) {
              jsonLdExtractionSuccess = true;
              break;
            }
          }
        } catch (e) {
          // 忽略单个脚本解析错误，继续尝试其他脚本
          // 尝试备选方案：直接从原始文本中提取编剧信息
          try {
            const scriptContent = script.textContent;
            
            // 尝试匹配author数组
            const authorArrayRegex = /"author":\s*\[([\s\S]*?)\]/;
            const authorArrayMatch = scriptContent.match(authorArrayRegex);
            
            if (authorArrayMatch) {
              // 在author数组中提取name字段
              const authorArrayContent = authorArrayMatch[1];
              const authorNameRegex = /"name":\s*"([^"]+)"/g;
              let match;
              
              while ((match = authorNameRegex.exec(authorArrayContent)) !== null) {
                if (match[1] && match[1].trim().length > 0) {
                  writers.push(match[1].trim());
                }
              }
              
              if (writers.length > 0) {
                jsonLdExtractionSuccess = true;
                break;
              }
            }
          } catch (altError) {
            // 忽略备选方案的错误
          }
        }
      }
      
      // 二级提取策略：当JSON-LD数据提取失败时，从HTML标签中提取
      if (!jsonLdExtractionSuccess) {
        
        try {
          // 方法1：从编剧标签结构中提取（根据示例页面结构）
          const plElements = this.doc.querySelectorAll('.pl');
          const writerLabels = Array.from(plElements).filter(el => 
            el.textContent.includes('编剧') || el.textContent.includes('编剧:')
          );
          
          writerLabels.forEach(label => {
            // 查找包含编剧和attrs的父级容器
            let currentElement = label;
            let attrsContainer = null;
            
            // 方法1：尝试查找同级的attrs容器
            while (currentElement.nextSibling) {
              currentElement = currentElement.nextSibling;
              if (currentElement.nodeType === Node.ELEMENT_NODE) {
                if (currentElement.classList.contains('attrs')) {
                  attrsContainer = currentElement;
                  break;
                }
              }
            }
            
            // 方法2：如果同级没有找到，尝试查找父级中的attrs容器
            if (!attrsContainer) {
              const parentSpan = label.closest('span');
              if (parentSpan) {
                attrsContainer = parentSpan.querySelector('.attrs');
              }
            }
            
            // 提取编剧名字
            if (attrsContainer) {
              const writerLinks = attrsContainer.querySelectorAll('a');
              writerLinks.forEach(link => {
                const name = link.textContent.trim();
                if (name && name.length > 0) {
                  writers.push(name);
                }
              });
            }
          });
          
          // 方法2：如果方法1失败，尝试更通用的选择器
          if (writers.length === 0) {
            const infoElement = this.doc.querySelector('#info');
            if (infoElement) {
              // 查找包含编剧的行
              const writerRows = infoElement.innerHTML.match(/<span[^>]*class=["']?pl["']?[^>]*>编剧[：:]?<\/span>[\s\S]*?<br\/>/i);
              if (writerRows && writerRows[0]) {
                // 从匹配的行中提取a标签文本
                const tempDiv = this.doc.createElement('div');
                tempDiv.innerHTML = writerRows[0];
                const aTags = tempDiv.querySelectorAll('a');
                aTags.forEach(tag => {
                  const name = tag.textContent.trim();
                  if (name && name.length > 0) {
                    writers.push(name);
                  }
                });
              }
            }
          }
          
          // 方法3：如果前两种方法都失败，尝试从页面中查找编剧相关链接
          if (writers.length === 0) {
            // 查找所有包含编剧文本的链接
            const allLinks = this.doc.querySelectorAll('a[href*="subject_search"]');
            allLinks.forEach(link => {
              const parentSpan = link.closest('span');
              if (parentSpan && parentSpan.textContent.includes('编剧')) {
                const name = link.textContent.trim();
                if (name && name.length > 0) {
                  writers.push(name);
                }
              }
            });
          }
          
          if (writers.length > 0) {
          } else {
          }
        } catch (secondaryError) {
          console.error('[DoubanMovieExtractor] 二级提取策略执行失败:', secondaryError);
        }
      }
      
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取编剧信息时发生严重错误:', error);
    }
    
    return writers;
  }
  
  // 提取导演信息
  extractDirectors() {
    
    const directors = [];
    let jsonLdExtractionSuccess = false;
    
    try {
      // 主提取策略：从页面中查找并解析JSON-LD脚本
      const scriptTags = this.doc.querySelectorAll('script[type="application/ld+json"]');
      
      for (const script of scriptTags) {
        try {
          // 获取原始文本内容
          let scriptContent = script.textContent.trim();
          
          // 尝试解析JSON数据
          const data = JSON.parse(scriptContent);
          
          // 检查是否包含director数组或对象
          if (data && data.director) {
            
            // 处理director数组
            if (Array.isArray(data.director)) {
              // 遍历director数组提取导演信息
              data.director.forEach(director => {
                if (director.name) {
                  // 提取原始名字，不做任何处理
                  const name = director.name;
                  if (name && typeof name === 'string' && name.trim().length > 0) {
                    directors.push(name.trim());
                  }
                }
              });
            } else if (typeof data.director === 'object' && data.director.name) {
              // 处理单个director对象
              const name = data.director.name;
              if (name && typeof name === 'string' && name.trim().length > 0) {
                directors.push(name.trim());
              }
            }
            
            // 如果找到导演信息，标记主策略成功并跳出循环
            if (directors.length > 0) {
              jsonLdExtractionSuccess = true;
              break;
            }
          }
        } catch (e) {
          // 忽略单个脚本解析错误，继续尝试其他脚本
          // 尝试备选方案：直接从原始文本中提取导演信息
          try {
            const scriptContent = script.textContent;
            
            // 尝试匹配director数组
            const directorArrayRegex = /"director":\s*\[([\s\S]*?)\]/;
            const directorArrayMatch = scriptContent.match(directorArrayRegex);
            
            if (directorArrayMatch) {
              // 在director数组中提取name字段
              const directorArrayContent = directorArrayMatch[1];
              const directorNameRegex = /"name":\s*"([^"]+)"/g;
              let match;
              
              while ((match = directorNameRegex.exec(directorArrayContent)) !== null) {
                if (match[1] && match[1].trim().length > 0) {
                  directors.push(match[1].trim());
                }
              }
              
              if (directors.length > 0) {
                jsonLdExtractionSuccess = true;
                break;
              }
            }
          } catch (altError) {
            // 忽略备选方案的错误
          }
        }
      }
      
      // 二级提取策略：当JSON-LD数据提取失败时，从HTML标签中提取
      if (!jsonLdExtractionSuccess) {
        
        try {
          // 方法1：从rel="v:directedBy"属性的a标签中提取
          const directedByLinks = this.doc.querySelectorAll('a[rel="v:directedBy"]');
          if (directedByLinks.length > 0) {
            directedByLinks.forEach(link => {
              const name = link.textContent.trim();
              if (name && name.length > 0) {
                directors.push(name);
              }
            });
          } 
          
          // 方法2：如果方法1失败，从包含导演标签的结构中提取
          if (directors.length === 0) {
            // v2.5.48：原来是 `.pl:contains(导演)`。:contains() 是 jQuery 的伪类，
            // 原生 querySelectorAll 不认，这一行会直接抛 SyntaxError，
            // 被外层 catch 吞掉 → 方法2 和方法3 从来都没执行过。
            // 改为遍历 .pl，用文本匹配找「导演」这个标签。
            let directorLabel = null;
            this.doc.querySelectorAll('#info .pl').forEach(function (pl) {
              if (directorLabel) return;
              const labelText = (pl.textContent || '').trim().replace(/[：:]+$/, '');
              if (labelText === '导演') directorLabel = pl;
            });

            if (directorLabel) {
              // 豆瓣 #info 结构：<span class="pl">导演</span> <a>…</a> / <a>…</a> <br>
              // 顺着兄弟节点往后收集链接，遇到 <br> 就停，避免把下一行（主演等）也吃进来。
              let cursor = directorLabel.nextElementSibling;
              while (cursor && cursor.tagName !== 'BR') {
                cursor.querySelectorAll('a').forEach(function (link) {
                  const name = (link.textContent || '').trim();
                  if (name && name.length > 0) directors.push(name);
                });
                cursor = cursor.nextElementSibling;
              }
            }
          }
          
          // 方法3：如果前两种方法都失败，尝试更通用的选择器
          if (directors.length === 0) {
            const infoElement = this.doc.querySelector('#info');
            if (infoElement) {
              // 查找包含导演的行
              const directorRows = infoElement.innerHTML.match(/<span[^>]*class=["']?pl["']?[^>]*>导演[：:]?<\/span>[\s\S]*?<br\/>/i);
              if (directorRows && directorRows[0]) {
                // 从匹配的行中提取a标签文本
                const tempDiv = this.doc.createElement('div');
                tempDiv.innerHTML = directorRows[0];
                const aTags = tempDiv.querySelectorAll('a');
                aTags.forEach(tag => {
                  const name = tag.textContent.trim();
                  if (name && name.length > 0) {
                    directors.push(name);
                  }
                });
              }
            }
          }
          
          if (directors.length > 0) {
          } else {
          }
        } catch (secondaryError) {
          console.error('[DoubanMovieExtractor] 二级提取策略执行失败:', secondaryError);
        }
      }
      
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取导演信息时发生严重错误:', error);
    }
    
    return directors;
  }

  async extractSpecificFields() {
    const fields = {};
    
    try {
      // 判断媒体类型
      const isTv = this.isTvSeries();
      
      // 电影名
      fields['片名'] = this.extractMovieTitle();
      
      // 别名
      fields['别名'] = this.extractAliases();
      
      // v2.5.67：标签（原「其他信息」里的「类型」，拆成独立字段，半角逗号连接）
      fields['标签'] = this.extractTags();
      
      // 国家/地区信息
      fields['国家'] = this.extractCountry();
      
      // 影视类型（根据媒体类型自动添加"电影"或"剧集"）
      fields['影视类型'] = this.extractMediaType();
      
      // 上映日期
      fields['上映日期'] = this.extractReleaseDate();
      
      // 根据媒体类型进行不同的时长映射
      const runtime = this.extractRuntime();
      if (isTv && runtime) {
        // 电视剧将时长映射到单集片长
        fields['单集片长'] = runtime;
      } else if (runtime) {
        // 电影保持原有的片长映射
        fields['片长'] = runtime;
      }
      
      // 集数（电视剧）
      const episodes = this.extractEpisodes();
      if (episodes) {
        fields['集数'] = episodes;
      }
      
      // 原作名
      fields['原作名'] = this.extractOriginalTitle();
      
      // 提取IMDb信息
      const imdbInfo = this.extractIMDbInfo();
      Object.assign(fields, imdbInfo);
      
      // 提取导演信息
      fields['导演'] = this.extractDirectors();
      
      // 提取编剧信息
      fields['编剧'] = this.extractWriters();
      
      // 提取主演信息
      fields['主演'] = this.extractActors();
      
      // 在豆瓣影视页面中，由于已有"豆瓣链接"字段，不再设置URL字段
      // fields['URL'] = window.location.href;
      // 设置豆瓣链接字段，去除查询参数
      const baseUrl = this.pageUrl.split('?')[0];
      fields['豆瓣链接'] = baseUrl;
      
      fields['其他信息'] = this.extractOtherInfo();
      fields['我的进度'] = this.extractMyProgress();
      // v2.11.4：把提取源传进去 —— 收藏列表页换源时读的是详情页那份文档，
      // 不传就只能读到列表页（那里没有 #interest_sect_level，进度时间会整段丢）
      BaseExtractor.assignProgressTimeFields(fields, { root: this.doc });
      
      return fields;
    } catch (error) {
      console.error('豆瓣电影提取失败:', error);
      return fields;
    }
  }
  
  /**
   * 提取"我的进度"字段
   * 豆瓣电影/电视剧使用 #interest_sect_level 容器
   * @returns {string} "想看"|"在看"|"看过"|""
   */
  extractMyProgress() {
    try {
      const container = this.doc.querySelector('#interest_sect_level');
      if (!container) return '';
      const text = container.textContent;
      if (text.includes('想看') || text.includes('想读')) return '想看';
      if (text.includes('在看') || text.includes('在读')) return '在看';
      if (text.includes('看过') || text.includes('读过')) return '看过';
      return '';
    } catch (e) {
      return '';
    }
  }
  
  /**
   * v2.5.67：提取「标签」字段 —— 豆瓣 #info 里的「类型: 剧情 / 犯罪」。
   * 历史上这一项是拼进「其他信息」的（形如「类型：剧情、犯罪」），
   * 现按用户要求独立成字段，分隔符固定为**半角逗号**：`剧情,犯罪`。
   *
   * 数据源只认官方微数据 span[property="v:genre"]；豆瓣改版时退到
   * 「类型」标签后面那串 span，保证不空。
   * @returns {string} "剧情,犯罪" / ''
   */
  extractTags() {
    try {
      const infoElement = this.doc.querySelector('#info');
      if (!infoElement) return '';

      let names = [];

      // 1) 官方微数据：<span property="v:genre">剧情</span> / <span property="v:genre">犯罪</span>
      infoElement.querySelectorAll('span[property="v:genre"]').forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t) names.push(t);
      });

      // 2) 兜底：找文本为「类型」的 .pl，顺着兄弟节点收集（遇到 <br> 停）
      if (!names.length) {
        let label = null;
        infoElement.querySelectorAll('.pl').forEach((pl) => {
          if (label) return;
          const t = (pl.textContent || '').trim().replace(/[：:]+$/, '').trim();
          if (t === '类型') label = pl;
        });

        if (label) {
          let cursor = label.nextSibling;
          while (cursor) {
            if (cursor.nodeType === 1) {
              if (cursor.tagName === 'BR') break;
              if (cursor.tagName === 'SPAN') {
                const t = (cursor.textContent || '').trim();
                if (t) names.push(t);
              }
            } else if (cursor.nodeType === 3) {
              // 文本节点里可能是「 / 」分隔符，按斜杠切开当多个标签
              const raw = (cursor.textContent || '').trim();
              if (raw && raw !== '/') {
                raw.split('/').forEach((s) => {
                  const t = s.trim();
                  if (t) names.push(t);
                });
              }
            }
            cursor = cursor.nextSibling;
          }
        }
      }

      // 去空、去重（顺序保留）
      const seen = new Set();
      const finalNames = [];
      names.forEach((n) => {
        const t = String(n).trim();
        if (t && !seen.has(t)) {
          seen.add(t);
          finalNames.push(t);
        }
      });

      return finalNames.join(',');
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取标签时发生错误:', error);
      return '';
    }
  }

  // 提取其他信息字段
  extractOtherInfo() {
    try {
      
      const infoElement = this.doc.querySelector('#info');
      if (!infoElement) {
        ClipMateLog.debug('[DoubanMovieExtractor] 未找到#info元素，无法提取其他信息');
        return '';
      }
      
      // 需要提取的其他信息标签
      // v2.5.67：「类型」已独立成「标签」字段，不再进其他信息（否则两处重复）。
      const otherInfoLabels = [
        '语言', 
        '上映日期',
        '首播日期', 
        '季数', 
        '集数', 
        '单集片长',
        '官方网站'
      ];
      
      // 已经在主要字段中提取的标签
      const excludedLabels = [
        '片名', '别名', '国家', '导演', '编剧', '主演', 
        '上映日期', '片长', '单集片长', '集数', '原作名', 
        'IMDb', 'IMDB链接', 'URL', '豆瓣链接', '又名'
      ];
      
      const otherInfoParts = [];
      
      // 通过.pl元素查找标签和对应的值
      const labelElements = infoElement.querySelectorAll('.pl');
      
      for (const element of labelElements) {
        const labelText = element.textContent.trim();
        // 移除冒号
        const cleanLabel = labelText.replace(/[：:]$/, '').trim();
        
        // 只处理在otherInfoLabels中且不在excludedLabels中的标签
        if (otherInfoLabels.includes(cleanLabel) && !excludedLabels.includes(cleanLabel)) {
          let value = '';
          
          if (cleanLabel === '官方网站') {
            // 官方网站特殊处理，获取a标签的href属性
            const aElement = element.nextElementSibling;
            if (aElement && aElement.tagName === 'A') {
              value = aElement.getAttribute('href') || aElement.textContent.trim();
            }
          } else {
            // 获取下一个文本节点
            let nextNode = element.nextSibling;
            
            // 收集所有文本节点内容，直到下一个.pl元素或结束
            while (nextNode && nextNode.nodeType !== 1) { // 1 = Element node
              if (nextNode.nodeType === 3) { // 3 = Text node
                value += nextNode.textContent;
              }
              nextNode = nextNode.nextSibling;
            }
          }
          
          value = value.trim();
          if (value) {
            // 为官方网站字段特殊处理，避免URL中的斜杠被替换
            if (cleanLabel !== '官方网站') {
              // 其他字段将'/'分隔符替换为中文顿号
              value = value.replace(/\s*\/\s*/g, '、');
            }
            otherInfoParts.push(`${cleanLabel}：${value}`);
          }
        }
      }
      
      // 格式化拼接后的其他信息
      const formattedOtherInfo = otherInfoParts.join('，');
      
      return formattedOtherInfo;
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取其他信息时发生错误:', error);
      return '';
    }
  }

  // 提取制片国家/地区信息
  extractCountry() {
    try {
      const infoElement = this.doc.querySelector('#info');
      if (!infoElement) {
        ClipMateLog.debug('[DoubanMovieExtractor] 未找到#info元素，无法提取国家信息');
        return '';
      }
      
      // 查找包含'制片国家/地区:'的span元素
      const countryLabelElements = infoElement.querySelectorAll('.pl');
      for (const element of countryLabelElements) {
        if (element.textContent.trim() === '制片国家/地区:') {
          // 获取下一个文本节点
          let nextNode = element.nextSibling;
          if (nextNode && nextNode.nodeType === Node.TEXT_NODE) {
            let countryText = nextNode.textContent.trim();
            
            // 将'/'分隔的多国家替换为','分隔
            countryText = countryText.replace(/\//g, ', ');
            
            // 使用共享的地区名称标准化方法，确保与其他媒体类型保持一致的显示格式
            const result = BaseExtractor.standardizeRegionNames(countryText);
            return result;
          }
        }
      }
      
      // 备选方案：直接从文本中匹配
      // v2.5.48：原来拿 textContent 匹配 /制片国家\/地区[：:]([^\n]+)/，
      // textContent 没有换行符，会一直吞到 #info 结尾，把语言、上映日期也算进国家。
      const releaseCountryLine = this._getInfoLineText(/制片国家\/地区/);
      const countryMatch = releaseCountryLine.match(/制片国家\/地区[：:]\s*(.+)/);
      if (countryMatch && countryMatch[1]) {
        let countryText = countryMatch[1].trim();
        countryText = countryText.replace(/\//g, ', ');
        
        // 使用共享的地区名称标准化方法，确保与其他媒体类型保持一致的显示格式
        const result = BaseExtractor.standardizeRegionNames(countryText);
        return result;
      }
      
      return '';
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取国家信息时发生错误:', error);
      return '';
    }
  }

  extractMovieTitle() {
    const selectors = [
      'h1 span[property="v:itemreviewed"]',
      'h1 span',
      '#content h1',
      '.article h1 span'
    ];
    
    for (const selector of selectors) {
      const title = this.extractText(selector);
      if (title) {
        return this.cleanMovieTitle(title);
      }
    }
    
    return '';
  }

  cleanMovieTitle(title) {
    if (!title) return '';
    
    // 移除年份信息
    title = title.replace(/\s*\(\d{4}\)\s*$/, '');
    title = title.replace(/\s*\d{4}\s*$/, '');
    
    return title.trim();
  }

  // 所有人员相关方法已完全移除（导演、编剧、主演等字段不再提取）

  /**
   * 从 #info 里按「行」取标签所在那一行的纯文本
   *
   * v2.5.48：textContent 里 <br> 不产生 \n，所以所有 /标签[:：]([^\n]+)/
   * 形式的正则会一路吞到 #info 结尾，把后面几行（片长、类型、语言…）全算进来。
   * 统一改成先按 <br> 切行，再在命中那一行里取值。
   *
   * @param {RegExp} labelPattern - 识别行的正则，不要带 g 标志
   * @returns {string} 该行纯文本（含标签本身），没找到返回 ''
   */
  _getInfoLineText(labelPattern) {
    const infoElement = this.doc.querySelector('#info');
    if (!infoElement) return '';
    const lines = (infoElement.innerHTML || '').split(/<br\s*\/?>/i);
    for (let i = 0; i < lines.length; i++) {
      if (labelPattern.test(lines[i])) {
        // 用正则去标签而不是塞进临时 div 的 innerHTML —— 避免多一条
        // UNSAFE_VAR_ASSIGNMENT 的 lint 警告（基线要保持 11 条）
        let text = lines[i].replace(/<[^>]*>/g, '');
        text = text
          .replace(/&nbsp;/g, ' ')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&');
        return text.trim();
      }
    }
    return '';
  }

  extractReleaseDate() {
    // 收集所有找到的日期
    const allDates = [];
    
    // 1. 从DOM元素中提取所有可能的日期元素
    const dateElements = this.doc.querySelectorAll('[property="v:initialReleaseDate"], .year, #info span[property="v:initialReleaseDate"]');
    if (dateElements.length > 0) {
      dateElements.forEach(element => {
        const dateText = element.textContent.trim();
        if (dateText) {
          allDates.push(dateText);
        }
      });
    }
    
    // 2. 从info文本中提取日期
    const infoElement = this.doc.querySelector('#info');
    if (infoElement) {
      const infoText = infoElement.textContent;

      // v2.5.48：原来用 /上映日期?[:：]?\s*([^\n]+)/ 在 textContent 上匹配。
      // 但 textContent 里 <br> 不产生 \n，所以 [^\n]+ 会一路吃到 #info 结尾，
      // 把「片长 / 类型 / 制片国家 / 语言 / 又名」全算进上映日期。
      // 改为走 _getInfoLineText，只取含「上映日期」的那一行。
      const releaseLineText = this._getInfoLineText(/上映日期|首播/);

      if (releaseLineText) {
        // 去掉「上映日期:」前缀，只留日期部分
        const cleanedLine = releaseLineText.replace(/^[\s\S]*?(上映日期|首播)[:：]?\s*/, '').trim();
        if (cleanedLine) allDates.push(cleanedLine);
      } else {
        // 尝试匹配单个日期格式
        const datePatterns = [
          /\(\d{4}\)/g,
          /\d{4}-\d{1,2}-\d{1,2}(?:\([^)]*\))?/g,
          /\d{4}年\d{1,2}月\d{1,2}日/g
        ];
        
        datePatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(infoText)) !== null) {
            allDates.push(match[0]);
          }
        });
      }
    }
    
    // 如果收集到多个日期，将它们合并为一个字符串
    if (allDates.length > 0) {
      // 去重并返回所有日期的组合字符串
      const uniqueDates = [...new Set(allDates)];
      return uniqueDates.join(', ');
    }
    
    return '';
  }

  formatMovieDate(dateStr) {
    if (!dateStr) return '';
    
    // 清理日期字符串
    dateStr = dateStr.replace(/[（）()]/g, '');
    dateStr = dateStr.replace(/[年月]/g, '-').replace(/[日]/g, '');
    dateStr = dateStr.trim();
    
    // 尝试使用正则表达式直接解析完整日期
    const datePattern = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    const match = dateStr.match(datePattern);
    if (match) {
      const [, year, month, day] = match;
      return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
    }
    
    // 处理年月格式
    const yearMonthPattern = /^(\d{4})[-/](\d{1,2})/;
    const ymMatch = dateStr.match(yearMonthPattern);
    if (ymMatch) {
      const [, year, month] = ymMatch;
      return `${year}/${month.padStart(2, '0')}/01`;
    }
    
    // 只提取年份
    const yearMatch = dateStr.match(/(\d{4})/);
    if (yearMatch) {
      return `${yearMatch[1]}/01/01`;
    }
    
    return dateStr;
  }

  extractRuntime() {
    const selectors = [
      '[property="v:runtime"]',
      '.runtime',
      '#info [property="v:runtime"]'
    ];
    
    for (const selector of selectors) {
      const runtime = this.extractText(selector);
      if (runtime) {
        return this.formatRuntime(runtime);
      }
    }
    
    // 从info文本中提取
    // v2.5.48：同上，原来用 textContent + ([^\n]+) 会吞掉后面所有行。
    const runtimeLine = this._getInfoLineText(/片长/);
    if (runtimeLine) {
      const runtimeMatch = runtimeLine.match(/片长[:：]?\s*(.+)/);
      if (runtimeMatch) {
        return this.formatRuntime(runtimeMatch[1]);
      }
    }
    
    return '';
  }

  formatRuntime(runtime) {
    if (!runtime) return '';
    
    // 提取分钟数
    const minuteMatch = runtime.match(/(\d+)\s*分钟?/);
    if (minuteMatch) {
      return minuteMatch[1] + '分钟';
    }
    
    // 提取小时和分钟
    const timeMatch = runtime.match(/(\d+)\s*小时?\s*(\d*)\s*分钟?/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1]) || 0;
      const minutes = parseInt(timeMatch[2]) || 0;
      const totalMinutes = hours * 60 + minutes;
      return totalMinutes + '分钟';
    }
    
    return runtime.trim();
  }

  extractEpisodes() {
    // 主要针对电视剧
    const infoElement = this.doc.querySelector('#info');
    if (infoElement) {
      const infoText = infoElement.textContent;
      
      const episodeMatch = infoText.match(/集数[:：]?\s*(\d+)/);
      if (episodeMatch) {
        return episodeMatch[1];
      }
      
      // 其他格式
      const seasonMatch = infoText.match(/季数[:：]?\s*(\d+)/);
      if (seasonMatch) {
        return seasonMatch[1] + '季';
      }
    }
    
    return '';
  }

  extractOriginalTitle() {
    
    // 增强的标题验证函数 - 允许纯中文标题
    const isValidOriginalTitle = (text) => {
      if (!text || text.length < 2 || text.length > 100) return false;
      // 不是纯数字或特殊字符
      if (/^[\d\s.,!?'"\-]+$/.test(text)) return false;
      return true;
    };
    
    // 从#mainpic img的alt属性提取原作名
    try {
      const mainPicImg = this.doc.querySelector('#mainpic img');
      if (mainPicImg && mainPicImg.alt) {
        const originalTitle = mainPicImg.alt.trim();
        if (isValidOriginalTitle(originalTitle)) {
          return originalTitle;
        }
      }
    } catch (error) {
      console.error('[DoubanMovieExtractor] 从#mainpic img提取原作名失败:', error);
    }
    
    return '';
  }

  // 提取别名
  extractAliases() {
    
    // 查找包含别名信息的元素
    const plElements = this.doc.querySelectorAll('#info span.pl, #info .pl');
    let aliases = '';
    
    
    for (const element of plElements) {
      if (element.textContent.includes('又名')) {
        
        let nextNode = element.nextSibling;
        let content = '';
        
        // 收集后续所有文本节点和元素节点的文本
        while (nextNode && nextNode.nodeName !== 'BR' && nextNode.nodeName !== 'SPAN') {
          if (nextNode.nodeType === Node.TEXT_NODE) {
            content += nextNode.textContent;
          } else if (nextNode.nodeType === Node.ELEMENT_NODE) {
            content += nextNode.textContent;
          }
          nextNode = nextNode.nextSibling;
        }
        
        content = this.cleanText(content);
        
        if (content) {
          // 分割多个别名
          const aliasArray = content.split(/[,，、/]/).map(alias => alias.trim());
          
          aliases = aliasArray.join(', ');
          return aliases;
        }
      }
    }
    
    // 尝试从info文本中直接提取
    // v2.5.48：同上，原来用 textContent + ([^\n]+)，会把 #info 后面几行全当成别名。
    const aliasLine = this._getInfoLineText(/又名/);
    if (aliasLine) {
      const aliasMatch = aliasLine.match(/又名[:：]?\s*(.+)/);
      if (aliasMatch) {
        aliases = this.cleanText(aliasMatch[1]);
        
        const aliasArray = aliases.split(/[,，、/]/).map(alias => alias.trim());
        
        aliases = aliasArray.join(', ');
      } else {
      }
    } else {
    }
    
    return aliases;
  }

  // 提取主演信息
  extractActors() {
    
    const actors = [];
    let jsonLdExtractionSuccess = false;
    
    try {
      // 主提取策略：从页面中查找并解析JSON-LD脚本
      const scriptTags = this.doc.querySelectorAll('script[type="application/ld+json"]');
      
      for (const script of scriptTags) {
        try {
          // 获取原始文本内容
          let scriptContent = script.textContent;
          
          // 预处理文本内容，移除可能导致JSON解析错误的格式问题
          scriptContent = scriptContent.trim();
          
          // 尝试解析JSON数据
          const data = JSON.parse(scriptContent);
          
          // 检查是否包含actor数组
          if (data && data.actor && Array.isArray(data.actor)) {
            
            // 遍历actor数组提取演员信息
            data.actor.forEach(actor => {
              if (actor.name) {
                // 提取原始名字，不做任何处理
                const name = actor.name;
                if (name && typeof name === 'string' && name.trim().length > 0) {
                  actors.push(name.trim());
                }
              }
            });
            
            // 如果找到演员信息，标记主策略成功并跳出循环
            if (actors.length > 0) {
              jsonLdExtractionSuccess = true;
              break;
            }
          }
        } catch (e) {
          // 忽略单个脚本解析错误，继续尝试其他脚本
          // 尝试备选方案：直接从原始文本中提取演员信息
          try {
            const scriptContent = script.textContent;
            // 先尝试获取电影标题，用于后续过滤
            let movieTitle = '';
            const titleMatch = scriptContent.match(/"name":\s*"([^"]+)"[^}]*"@type":\s*"(Movie|TVSeries|VideoObject)"/);
            if (titleMatch && titleMatch[1]) {
              movieTitle = titleMatch[1].toLowerCase();
            }
            
            // 改进的正则表达式，尝试在actor数组上下文中匹配name字段
            const actorArrayRegex = /"actor":\s*\[([\s\S]*?)\]/;
            const actorArrayMatch = scriptContent.match(actorArrayRegex);
            
            if (actorArrayMatch) {
              // 在actor数组中提取name字段
              const actorArrayContent = actorArrayMatch[1];
              const actorNameRegex = /"name":\s*"([^"]+)"/g;
              let match;
              const tempActors = [];
              
              while ((match = actorNameRegex.exec(actorArrayContent)) !== null) {
                if (match[1] && match[1].trim().length > 0) {
                  tempActors.push(match[1].trim());
                }
              }
              
              // 增强过滤逻辑，排除电影标题和非演员信息
              const validActors = tempActors.filter(name => {
                // 基础过滤
                const basicFilter = name.length > 1 && 
                                   !name.includes('http') && 
                                   !name.includes('/');
                
                // 过滤掉电影标题或其变体
                const isMovieTitle = movieTitle && 
                                     name.toLowerCase().includes(movieTitle) && 
                                     name.length > movieTitle.length * 0.8; // 相似度阈值
                
                // 不再过滤重复文本，因为有些演员名字在JSON-LD中会重复出现
                // 只保留基础过滤和电影标题过滤
                return basicFilter && !isMovieTitle;
              });
              
              if (validActors.length > 0) {
                actors.push(...validActors);
                jsonLdExtractionSuccess = true;
                break;
              }
            }
            
            // 备用方案：如果找不到actor数组，使用更安全的通用正则
            const saferRegex = /"actor":\s*\{[^}]*"name":\s*"([^"]+)"[^}]*\}|"name":\s*"([^"]+)"[^}]*"@type":\s*"Person"/g;
            const tempActors = [];
            let match;
            
            while ((match = saferRegex.exec(scriptContent)) !== null) {
              const actorName = match[1] || match[2];
              if (actorName && actorName.trim().length > 0) {
                // 排除电影标题
                if (!movieTitle || !actorName.toLowerCase().includes(movieTitle)) {
                  tempActors.push(actorName.trim());
                }
              }
            }
            
            // 对备用方案提取的结果进行过滤
            if (tempActors.length > 0) {
              actors.push(...tempActors);
              jsonLdExtractionSuccess = true;
              break;
            }
          } catch (regexError) {
            ClipMateLog.debug('[DoubanMovieExtractor] 正则表达式提取失败:', regexError.message);
          }
        }
      }
      
      // 二级提取策略：仅当JSON-LD数据提取失败时执行
      if (!jsonLdExtractionSuccess && actors.length === 0) {
        
        try {
          // 从页面HTML中提取主演信息，查找带有rel="v:starring"属性的a标签
          const actorLinks = this.doc.querySelectorAll('a[rel="v:starring"]');
          
          if (actorLinks && actorLinks.length > 0) {
            
            // 遍历所有演员链接提取名字
            actorLinks.forEach(link => {
              const actorName = link.textContent.trim();
              if (actorName && actorName.length > 0) {
                actors.push(actorName);
              }
            });
          }
        } catch (htmlError) {
          console.error('[DoubanMovieExtractor] 从HTML标签提取演员信息失败:', htmlError);
        }
      }
      
      
      if (actors.length > 0) {
        // 直接返回所有演员名字的逗号分隔字符串
        const result = actors.join(', ');
        return result;
      }
      
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取主演信息失败:', error);
    }
    
    return '';
  }

  // 提取描述信息
  extractDescription() {
    try {
      
      // 豆瓣电影页面的简介通常位于特定元素中
      const introSelectors = [
        '#link-report .all',  // 展开的简介
        '#link-report > span', // 默认显示的简介
        '.related-info .indent p', // 有时候简介在这个位置
        '.intro', // 通用简介类名
        '[property="v:summary"]' // 可能使用的属性
      ];
      
      for (const selector of introSelectors) {
        const element = this.doc.querySelector(selector);
        if (element) {
          const text = element.textContent.trim();
          // 只返回有意义的简介内容，避免提取默认描述
          if (text && text.length > 20) {
            return text;
          }
        }
      }
      
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取简介信息时发生错误:', error);
    }
    
    // 找不到有效简介时返回空字符串，避免使用默认的meta description
    return '';
  }

  // v2.5.38：原 extractMetaFields() 只产出 og:title / og:release_date 两个键，
  // 而映射用的是「包含匹配」，这两个键分别会被认成「名字」和「上映日期」：
  //   · og:title      —— 与提取器认真抓的「名字」重复（页面实测两者恰好相同，靠未映射透传兜住）
  //   · og:release_date —— 豆瓣页面根本不存在这个 meta，一旦哪天加上就会覆盖 1994/09/10 这种正确格式
  // 属无收益的脏键，已整段删除，行为回落到 BaseExtractor.extractMetaFields() 的 return {}。

  // 提取影视类型（根据媒体类型判断是电影还是剧集）
  extractMediaType() {
    try {
      // 判断是否为电视剧
      const isTv = this.isTvSeries();
      
      if (isTv) {
        return '剧集';
      } else {
        return '电影';
      }
    } catch (error) {
      console.error('[DoubanMovieExtractor] 提取影视类型失败:', error);
      return '';
    }
  }
}

// 导出豆瓣电影提取器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DoubanMovieExtractor;
} else {
  window.DoubanMovieExtractor = DoubanMovieExtractor;
}