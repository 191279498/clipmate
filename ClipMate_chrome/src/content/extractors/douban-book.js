/**
 * 单字国家码（豆瓣作者名后的 [英] / [日] 那种）查本文件的 countryMap 没命中时的兜底。
 * v2.5.68：兜底改用 src/shared/country-names.js 的统一国家总表。
 * countryMap 里的单字键**故意不并进总表**——单字有歧义（'新' 既是新加坡也是新西兰），
 * 放进去会误伤其它站点；所以这里保持「本地表优先、总表兜底、都查不到原样返回」。
 */
function _resolveDoubanBookCountryFallback(code) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return '';
  try {
    if (typeof window !== 'undefined' && window.CountryNames
        && typeof window.CountryNames.countryDisplayName === 'function') {
      return window.CountryNames.countryDisplayName(raw, { keepUnknown: true });
    }
  } catch (e) { /* 转换器异常时退回原值，不影响提取 */ }
  return raw;
}

// 豆瓣书籍提取器（基于油猴脚本重构）
class DoubanBookExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douban_book';
    this.authorCache = new Map(); // 豆瓣作者信息缓存
  }

  async extractSpecificFields() {
    const fields = {};
    
    try {
      // 使用油猴脚本中的提取方法
      fields['书名'] = await this.getDoubanTitle();
      fields['别名'] = await this.getDoubanField('又名');
      fields['作者'] = await this.getDoubanAuthor();
      fields['原作名'] = await this.getDoubanField('原作名');
      fields['国家'] = await this.getDoubanAuthorCountry();
      fields['发布日期'] = this.formatDate(await this.getDoubanField('出版年'));
      fields['简介'] = this.getDoubanIntro();
      fields['网络评分'] = this.getDoubanRating();
      fields['豆瓣链接'] = this.formatUrl(window.location.href);
      fields['URL'] = '';
      fields['ISBN'] = await this.getDoubanField('ISBN');
      fields['篇幅'] = await this.getDoubanField('页数');
    
      fields['其他信息'] = await this.getDoubanOtherInfo();
      fields['我的进度'] = this.extractMyProgress();
      BaseExtractor.assignProgressTimeFields(fields);
      
      return fields;
    } catch (error) {
      console.error('豆瓣书籍提取失败:', error);
      return fields;
    }
  }
  
  /**
   * 提取"我的进度"字段
   * 豆瓣书籍使用 #interest_sect_level 容器
   * @returns {string} "想看"|"在看"|"看过"|""
   */
  extractMyProgress() {
    try {
      const container = document.querySelector('#interest_sect_level');
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
  
  // 提取作者国家信息
  async getDoubanAuthorCountry() {
    try {
      
      // 国家代码映射表 - 完善版本
      // v2.5.48：删掉三个有歧义的单字键 —— '巴'（巴基斯坦/巴西）、
      // '阿'（阿尔及利亚/阿根廷）、'瑞'（瑞士/瑞典）。单字无法区分，
      // 靠对象键覆盖只会得到「后写的那个」，等于瞎猜。
      // 现在这类页面走完整国家名匹配；宁可不显示，也不显示错的国家。
      const countryMap = {
        // 亚洲国家
        '中': '中国',
        '日': '日本',
        '韩': '韩国',
        '印': '印度',
        '孟': '孟加拉国',
        '缅': '缅甸',
        '泰': '泰国',
        '越': '越南',
        '老': '老挝',
        '柬': '柬埔寨',
        '菲': '菲律宾',
        '印尼': '印度尼西亚',
        '新': '新加坡',
        '马': '马来西亚',
        '蒙': '蒙古',
        '朝': '朝鲜',
        '伊': '伊朗',
        '以': '以色列',
        '沙': '沙特阿拉伯',
        '埃': '埃及',
        '尼': '尼日利亚',
        '南': '南非',
        '土': '土耳其',
        '哈': '哈萨克斯坦',
        '乌': '乌兹别克斯坦',
        '吉': '吉尔吉斯斯坦',
        '塔': '塔吉克斯坦',
        '土库': '土库曼斯坦',
        
        // 欧洲国家
        '英': '英国',
        '美': '美国',
        '德': '德国',
        '法': '法国',
        '俄': '俄罗斯',
        '意': '意大利',
        '西': '西班牙',
        '葡': '葡萄牙',
        '荷': '荷兰',
        '比': '比利时',
        '卢': '卢森堡',
        '奥': '奥地利',
        '希': '希腊',
        '捷': '捷克',
        '匈': '匈牙利',
        '波': '波兰',
        '芬': '芬兰',
        '丹': '丹麦',
        '挪': '挪威',
        '冰': '冰岛',
        '爱': '爱尔兰',
        
        // 美洲国家
        '加': '加拿大',
        '澳': '澳大利亚',
        '墨': '墨西哥',
        '智': '智利',
        '秘': '秘鲁',
        '委': '委内瑞拉',
        '古': '古巴',
        '哥': '哥伦比亚',
        '厄': '厄瓜多尔',
        '玻': '玻利维亚',
        
        // 扩展支持的国家和地区
        '澳大': '澳大利亚',
        '新西兰': '新西兰',
        '白俄': '白俄罗斯',
        '乌克兰': '乌克兰',
        '斯洛伐克': '斯洛伐克',
        '斯洛文尼亚': '斯洛文尼亚',
        '克罗地亚': '克罗地亚',
        '塞尔维亚': '塞尔维亚',
        '保加利亚': '保加利亚',
        '罗马尼亚': '罗马尼亚',
        '阿尔巴尼亚': '阿尔巴尼亚',
        '北马': '北马其顿',
        '爱沙尼亚': '爱沙尼亚',
        '拉脱维亚': '拉脱维亚',
        '立陶宛': '立陶宛',
        '摩尔多瓦': '摩尔多瓦',
        '列支敦士登': '列支敦士登',
        '马耳他': '马耳他',
        '塞浦路斯': '塞浦路斯',
        '摩纳哥': '摩纳哥',
        '安道尔': '安道尔',
        '圣马力诺': '圣马力诺',
        '梵蒂冈': '梵蒂冈',
        '直布罗陀': '直布罗陀',
        '马恩岛': '马恩岛',
        '根西': '根西岛',
        '泽西': '泽西岛',
        '法罗': '法罗群岛',
        '格陵兰': '格陵兰',
        '冰岛': '冰岛',
        '科西嘉': '科西嘉岛',
        '撒丁': '撒丁岛',
        '西西里': '西西里岛',
        '克里特': '克里特岛',
        '塞舌尔': '塞舌尔',
        '毛里求斯': '毛里求斯',
        '留尼汪': '留尼汪',
        '马达加斯加': '马达加斯加',
        '肯尼亚': '肯尼亚',
        '坦桑尼亚': '坦桑尼亚',
        '乌干达': '乌干达',
        '卢旺达': '卢旺达',
        '布隆迪': '布隆迪',
        '刚果': '刚果(金)',
        '刚果(布)': '刚果(布)',
        '喀麦隆': '喀麦隆',
        '加蓬': '加蓬',
        '赤道几内亚': '赤道几内亚',
        '圣多美': '圣多美和普林西比',
        '乍得': '乍得',
        '中非': '中非共和国',
        '尼日利亚': '尼日利亚',
        '贝宁': '贝宁',
        '多哥': '多哥',
        '加纳': '加纳',
        '科特迪瓦': '科特迪瓦',
        '利比里亚': '利比里亚',
        '塞拉利昂': '塞拉利昂',
        '几内亚': '几内亚',
        '几内亚比绍': '几内亚比绍',
        '佛得角': '佛得角',
        '冈比亚': '冈比亚',
        '马里': '马里',
        '布基纳法索': '布基纳法索',
        '尼日尔': '尼日尔',
        '阿尔及利亚': '阿尔及利亚',
        '突尼斯': '突尼斯',
        '利比亚': '利比亚',
        '摩洛哥': '摩洛哥',
        '西撒哈拉': '西撒哈拉',
        '毛里塔尼亚': '毛里塔尼亚',
        '塞内加尔': '塞内加尔',
        '苏丹': '苏丹',
        '南苏丹': '南苏丹',
        '埃塞俄比亚': '埃塞俄比亚',
        '厄立特里亚': '厄立特里亚',
        '吉布提': '吉布提',
        '索马里': '索马里',
        '赞比亚': '赞比亚',
        '津巴布韦': '津巴布韦',
        '马拉维': '马拉维',
        '莫桑比克': '莫桑比克',
        '博茨瓦纳': '博茨瓦纳',
        '纳米比亚': '纳米比亚',
        '南非': '南非',
        '莱索托': '莱索托',
        '斯威士兰': '斯威士兰',
        '加那利': '加那利群岛',
        '亚速尔': '亚速尔群岛',
        '马德拉': '马德拉群岛',
        '格陵兰': '格陵兰',
        '百慕大': '百慕大',
        '古巴': '古巴',
        '牙买加': '牙买加',
        '海地': '海地',
        '多米尼加': '多米尼加共和国',
        '波多黎各': '波多黎各',
        '美属维尔京': '美属维尔京群岛',
        '英属维尔京': '英属维尔京群岛',
        '安圭拉': '安圭拉',
        '圣基茨': '圣基茨和尼维斯',
        '安提瓜': '安提瓜和巴布达',
        '蒙特塞拉特': '蒙特塞拉特',
        '瓜德罗普': '瓜德罗普',
        '多米尼克': '多米尼克',
        '马提尼克': '马提尼克',
        '圣卢西亚': '圣卢西亚',
        '圣文森特': '圣文森特和格林纳丁斯',
        '巴巴多斯': '巴巴多斯',
        '格林纳达': '格林纳达',
        '特立尼达': '特立尼达和多巴哥',
        '荷属安的列斯': '荷属安的列斯',
        '阿鲁巴': '阿鲁巴',
        '库拉索': '库拉索',
        '圣马丁': '圣马丁',
        '圣巴泰勒米': '圣巴泰勒米',
        '法属圭亚那': '法属圭亚那',
        '苏里南': '苏里南',
        '圭亚那': '圭亚那',
        '委内瑞拉': '委内瑞拉',
        '哥伦比亚': '哥伦比亚',
        '厄瓜多尔': '厄瓜多尔',
        '秘鲁': '秘鲁',
        '玻利维亚': '玻利维亚',
        '巴西': '巴西',
        '巴拉圭': '巴拉圭',
        '阿根廷': '阿根廷',
        '智利': '智利',
        '乌拉圭': '乌拉圭',
        '福克兰': '福克兰群岛',
        '南乔治亚': '南乔治亚和南桑威奇群岛',
        '墨西哥': '墨西哥',
        '危地马拉': '危地马拉',
        '伯利兹': '伯利兹',
        '萨尔瓦多': '萨尔瓦多',
        '洪都拉斯': '洪都拉斯',
        '尼加拉瓜': '尼加拉瓜',
        '哥斯达黎加': '哥斯达黎加',
        '巴拿马': '巴拿马',
        '美国': '美国',
        '加拿大': '加拿大',
        '墨西哥': '墨西哥',
        '格陵兰': '格陵兰',
        '圣皮埃尔': '圣皮埃尔和密克隆',
        '澳大利亚': '澳大利亚',
        '新西兰': '新西兰',
        '巴布亚新几内亚': '巴布亚新几内亚',
        '所罗门群岛': '所罗门群岛',
        '瓦努阿图': '瓦努阿图',
        '新喀里多尼亚': '新喀里多尼亚',
        '斐济': '斐济',
        '萨摩亚': '萨摩亚',
        '美属萨摩亚': '美属萨摩亚',
        '汤加': '汤加',
        '纽埃': '纽埃',
        '库克群岛': '库克群岛',
        '图瓦卢': '图瓦卢',
        '基里巴斯': '基里巴斯',
        '瑙鲁': '瑙鲁',
        '密克罗尼西亚': '密克罗尼西亚联邦',
        '马绍尔群岛': '马绍尔群岛',
        '帕劳': '帕劳',
        '关岛': '关岛',
        '北马里亚纳': '北马里亚纳群岛',
        '马绍尔': '马绍尔群岛',
        '瑙鲁': '瑙鲁',
        '基里巴斯': '基里巴斯',
        '图瓦卢': '图瓦卢',
        '斐济': '斐济',
        '萨摩亚': '萨摩亚',
        '汤加': '汤加',
        '纽埃': '纽埃',
        '库克群岛': '库克群岛',
        '托克劳': '托克劳',
        '瓦利斯': '瓦利斯和富图纳',
        '法属波利尼西亚': '法属波利尼西亚',
        '皮特凯恩': '皮特凯恩群岛',
        '复活节岛': '复活节岛',
        '夏威夷': '夏威夷',
        '关岛': '关岛',
        '北马里亚纳': '北马里亚纳群岛',
        '密克罗尼西亚': '密克罗尼西亚联邦',
        '马绍尔': '马绍尔群岛',
        '帕劳': '帕劳',
        '瑙鲁': '瑙鲁',
        '基里巴斯': '基里巴斯',
        '图瓦卢': '图瓦卢',
        '斐济': '斐济',
        '萨摩亚': '萨摩亚',
        '美属萨摩亚': '美属萨摩亚',
        '汤加': '汤加',
        '纽埃': '纽埃',
        '库克群岛': '库克群岛',
        '托克劳': '托克劳',
        '瓦利斯': '瓦利斯和富图纳',
        '法属波利尼西亚': '法属波利尼西亚',
        '皮特凯恩': '皮特凯恩群岛'
      };
      
      const countries = new Set();
      let hasCountryCode = false;
      let hasNoCountryCode = false;
      
      // 策略1: 从#info部分直接提取作者字段中的国家代码（最高优先级，因为控制台显示这里有[英]标记）
      const infoElement = document.querySelector('#info');
      if (infoElement) {
        const infoText = infoElement.textContent;
        
        // 查找作者字段及其后面的内容
        const authorFieldMatch = infoText.match(/作者[:：]\s*([\s\S]*?)(?:\n|$|\w+[:：])/);
        if (authorFieldMatch && authorFieldMatch[1]) {
          const authorContent = authorFieldMatch[1].trim();
          
          // 提取所有方括号内的国家代码
          const countryMatches = authorContent.match(/\[(.*?)\]/g);
          if (countryMatches) {
            countryMatches.forEach(match => {
              const code = match.substring(1, match.length - 1).trim();
              if (code) {
                hasCountryCode = true;
                // 智能处理可能的代码冲突
                let fullCountry;
                
                // 处理常见冲突代码
                if (code === '巴') {
                  // 根据上下文判断'巴'是巴基斯坦还是巴西
                  // 如果作者名称有明显的穆斯林或南亚特征，倾向于巴基斯坦
                  // 否则倾向于巴西
                  const authorContext = authorContent.toLowerCase();
                  if (authorContext.includes('伊斯兰') || 
                      authorContext.includes('pakistan') || 
                      authorContext.includes('乌尔都') ||
                      authorContext.includes('pak')) {
                    fullCountry = '巴基斯坦';
                  } else {
                    fullCountry = '巴西';
                  }
                } else if (code === '阿') {
                  // 处理'阿'是阿根廷还是阿尔及利亚的冲突
                  const authorContext = authorContent.toLowerCase();
                  if (authorContext.includes('拉丁') || 
                      authorContext.includes('argentina') || 
                      authorContext.includes('spanish')) {
                    fullCountry = '阿根廷';
                  } else {
                    fullCountry = '阿尔及利亚';
                  }
                } else if (code === '土') {
                  // 处理'土'是土耳其还是土库曼斯坦的冲突
                  const authorContext = authorContent.toLowerCase();
                  if (authorContext.includes('土库曼') || 
                      authorContext.includes('turkmenistan')) {
                    fullCountry = '土库曼斯坦';
                  } else {
                    fullCountry = '土耳其';
                  }
                } else if (code === '瑞') {
                  // 处理'瑞'是瑞典还是瑞士的冲突
                  const authorContext = authorContent.toLowerCase();
                  if (authorContext.includes('swiss') || 
                      authorContext.includes('zurich') || 
                      authorContext.includes('geneva')) {
                    fullCountry = '瑞士';
                  } else {
                    fullCountry = '瑞典';
                  }
                } else {
                  // 一般情况直接查表
                  fullCountry = countryMap[code] || _resolveDoubanBookCountryFallback(code);
                }
                
                countries.add(fullCountry);
              }
            });
            // 如果找到了国家代码，说明至少有一个作者有国家代码
            hasNoCountryCode = countryMatches.length < (authorContent.match(/[、，]/g)?.length || 0) + 1;
          } else {
            hasNoCountryCode = true;
          }
        } else {
          hasNoCountryCode = true;
        }
      }
      
      // 策略2: 从作者链接元素提取国家代码
      if (!hasCountryCode) {
        const authorLinks = document.querySelectorAll('#info a[href^="/author/"]');
        
        authorLinks.forEach(link => {
          const linkText = link.textContent.trim();
          
          const countryMatch = linkText.match(/\[(.*?)\]/);
          if (countryMatch && countryMatch[1]) {
            hasCountryCode = true;
            const code = countryMatch[1].trim();
            
            // 智能处理可能的代码冲突
            let fullCountry;
            if (code === '巴') {
              const authorContext = linkText.toLowerCase();
              if (authorContext.includes('伊斯兰') || 
                  authorContext.includes('pakistan') || 
                  authorContext.includes('乌尔都') ||
                  authorContext.includes('pak')) {
                fullCountry = '巴基斯坦';
              } else {
                fullCountry = '巴西';
              }
            } else if (code === '阿') {
              const authorContext = linkText.toLowerCase();
              if (authorContext.includes('拉丁') || 
                  authorContext.includes('argentina') || 
                  authorContext.includes('spanish')) {
                fullCountry = '阿根廷';
              } else {
                fullCountry = '阿尔及利亚';
              }
            } else if (code === '土') {
              const authorContext = linkText.toLowerCase();
              if (authorContext.includes('土库曼') || 
                  authorContext.includes('turkmenistan')) {
                fullCountry = '土库曼斯坦';
              } else {
                fullCountry = '土耳其';
              }
            } else if (code === '瑞') {
              const authorContext = linkText.toLowerCase();
              if (authorContext.includes('swiss') || 
                  authorContext.includes('zurich') || 
                  authorContext.includes('geneva')) {
                fullCountry = '瑞士';
              } else {
                fullCountry = '瑞典';
              }
            } else {
              fullCountry = countryMap[code] || _resolveDoubanBookCountryFallback(code);
            }
            
            countries.add(fullCountry);
          } else {
            hasNoCountryCode = true;
          }
        });
      }
      
      // 策略3: 从创作者版块提取
      if (!hasCountryCode) {
        const creatorSection = document.querySelector('#authors, #author-intro, .subject-cast, .intro-section.creator, .authors-section');
        if (creatorSection) {
          const authorElements = creatorSection.querySelectorAll('.author, .author-item, .subject-cast-item');
          
          authorElements.forEach(el => {
            // 检查是否是作者角色
            const roleEl = el.querySelector('.role, .label');
            const role = roleEl ? roleEl.textContent.trim() : '';
            if (role === '作者' || role === 'Author' || role === 'author' || role === '著' || role === '主编' || !role) {
              const text = el.textContent || '';
              
              const countryMatch = text.match(/\[(.*?)\]/);
              if (countryMatch && countryMatch[1]) {
                hasCountryCode = true;
                const code = countryMatch[1].trim();
                
                // 智能处理可能的代码冲突
                let fullCountry;
                if (code === '巴') {
                  const authorContext = text.toLowerCase();
                  if (authorContext.includes('伊斯兰') || 
                      authorContext.includes('pakistan') || 
                      authorContext.includes('乌尔都') ||
                      authorContext.includes('pak')) {
                    fullCountry = '巴基斯坦';
                  } else {
                    fullCountry = '巴西';
                  }
                } else if (code === '阿') {
                  const authorContext = text.toLowerCase();
                  if (authorContext.includes('拉丁') || 
                      authorContext.includes('argentina') || 
                      authorContext.includes('spanish')) {
                    fullCountry = '阿根廷';
                  } else {
                    fullCountry = '阿尔及利亚';
                  }
                } else if (code === '土') {
                  const authorContext = text.toLowerCase();
                  if (authorContext.includes('土库曼') || 
                      authorContext.includes('turkmenistan')) {
                    fullCountry = '土库曼斯坦';
                  } else {
                    fullCountry = '土耳其';
                  }
                } else if (code === '瑞') {
                  const authorContext = text.toLowerCase();
                  if (authorContext.includes('swiss') || 
                      authorContext.includes('zurich') || 
                      authorContext.includes('geneva')) {
                    fullCountry = '瑞士';
                  } else {
                    fullCountry = '瑞典';
                  }
                } else {
                  fullCountry = countryMap[code] || _resolveDoubanBookCountryFallback(code);
                }
                
                countries.add(fullCountry);
              } else {
                hasNoCountryCode = true;
              }
            }
          });
        }
      }
      
      // 按照规则处理结果
      const countryArray = Array.from(countries);
      let result = '';
      
      if (hasCountryCode) {
        if (!hasNoCountryCode) {
          // 所有作者都有国家代码
          result = countryArray.join(',');
        } else {
          // 部分作者有国家代码
          result = countryArray.join(',');
        }
      } else {
        // 所有作者都没有国家代码
        result = '';
      }
      
      // 应用共享的地区名称标准化处理，确保与其他媒体类型保持一致的显示格式
      if (result) {
        const originalResult = result;
        result = BaseExtractor.standardizeRegionNames(result);
        
      }
      
      return result;
    } catch (error) {
      console.error('提取作者国家信息失败:', error);
      return '';
    }
  }

  // 智能书名清理函数
  smartCleanBookTitle(title) {
    if (!title || typeof title !== 'string') return '';
    
    let cleaned = title.trim();
    const originalTitle = cleaned;
    
    // 定义卷数/部数模式（只针对数字标识）
    const volumePatterns = [
      // 明确的数字卷数标识（带单位）
      /\s*第?\s*[0-9０-９]+\s*[卷册部集]\s*$/,
      /\s*[Vv]ol\.?\s*[0-9０-９]+\s*$/,
      /\s*[Vv]olume\s*[0-9０-９]+\s*$/,
      /\s*[0-9０-９]+\s*[巻册話]\s*$/,
      
      // 常见的数字系列标识符
      /\s*\([^)]*[0-9０-９]+[^)]*\)\s*$/,
      /\s*【[^】]*[0-9０-９]+[^】]*】\s*$/,
      
      // 末尾的孤立数字（有空格分隔，且数字较小）
      /\s+[0-9０-９]{1,2}$/,
      
      // 紧跟在文字后的数字（无空格）
      /(\D)([0-9０-９]{1,2})$/,
      
      // 末尾的两位数字（如01、02）
      /(\D)([0-9０-９]{2})$/
    ];
    
    // 应用所有清理模式
    volumePatterns.forEach(pattern => {
      // 对于捕获组模式，只替换数字部分
      if (pattern.source.includes('(')) {
        cleaned = cleaned.replace(pattern, '$1');
      } else {
        cleaned = cleaned.replace(pattern, '');
      }
    });
    
    cleaned = cleaned.trim();
    
    // 特殊情况处理
    cleaned = this.handleSpecialCases(cleaned);
    
    // 安全检查：如果清理后变化太大，返回原标题
    if (cleaned.length < originalTitle.length * 0.5 && originalTitle.length > 10) {
      return originalTitle.trim();
    }
    
    return cleaned;
  }
  
  // 特殊情况处理函数
  handleSpecialCases(title) {
    // 保留有意义的数字组合
    const meaningfulNumbers = [
      // 年份范围
      /\d{4}[-–]\d{4}/,
      // 多卷数合并表示
      /\d{1,2}\+\d{1,2}/,
      // 年份
      /\b\d{4}\b/,
      // 特殊形式如 "第X季"
      /第\s*[0-9一二三四五六七八九十百千]+\s*季/
    ];
    
    return title;
  }

  // 提取豆瓣书名
  async getDoubanTitle() {
    try {
      // 尝试多个选择器
      const selectors = [
        'h1 span[property="v:itemreviewed"]',
        'h1',
        '#wrapper h1 span',
        '.article h1 span'
      ];
      
      for (const selector of selectors) {
        const title = this.extractText(selector);
        if (title) {
          return this.smartCleanBookTitle(title);
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取豆瓣书名失败:', error);
      return '';
    }
  }

  // 获取豆瓣作者信息 - 增强版
  async getDoubanAuthor() {
    try {
      const allAuthors = [];
      
      // 1. 优先从创作者版块提取（带角色区分，新版豆瓣页面）- 最高优先级
      // 更新选择器以匹配实际HTML结构，特别添加#authors选择器
      const creatorSection = document.querySelector('#authors, #author-intro, .subject-cast, .intro-section.creator, .authors-section');
      
      if (creatorSection) {
        // 尝试多个选择器组合以支持不同页面结构，特别添加.authors-list .author
        const authorElements = creatorSection.querySelectorAll(
          '.authors-list .author, .author-item, .subject-cast-item, .author, [rel="v:author"]'
        );
        
        if (authorElements.length > 0) {
          
          const authorsPromises = Array.from(authorElements).map(async (el) => {
            try {
              // 提取角色信息
              let role = '';
              const roleEl = el.querySelector('.role, .label');
              if (roleEl) {
                role = roleEl.textContent.trim();
              }
              
              // 提取作者链接和名称 - 优化选择器
              // 首先尝试从头像链接获取
              const avatarLink = el.querySelector('a img.avatar') ? el.querySelector('a') : null;
              // 然后尝试从名称链接获取
              const nameLink = el.querySelector('a.name') || el.querySelector('.info a');
              
              // 优先使用头像链接或名称链接
              const linkEl = avatarLink || nameLink || el.querySelector('a') || el;
              const href = linkEl.getAttribute('href') || '';
              
              // 提取名称
              const nameEl = el.querySelector('.info .name') || el.querySelector('a.name') || el.querySelector('.name') || linkEl;
              let authorName = nameEl.textContent.trim();
              
              // 过滤掉不是作者角色的条目（如果有角色信息）
              const authorRoles = ['作者', 'Author', 'author', '著', '主编'];
              if (role && !authorRoles.some(authorRole => role.includes(authorRole))) {
                return null;
              }
              
              // 构建完整作者URL
              const authorUrl = href ? this.formatUrl(href) : '';
              
              // 获取更完整的作者信息
              const fullAuthorInfo = await this.getDoubanAuthorFullName(authorUrl, authorName);
              return fullAuthorInfo;
            } catch (err) {
              console.warn(`处理作者元素时出错: ${err.message}`);
              return null;
            }
          });
          
          const creatorsAuthors = (await Promise.all(authorsPromises)).filter(Boolean);
          if (creatorsAuthors.length > 0) {
            // 作为最高优先级，成功提取后直接返回，不再执行其他策略
            const finalResult = creatorsAuthors.join('、');
            return finalResult;
          } else {
          }
        }
      }
      
      // 2. 如果创作者版块未成功提取，尝试从作者链接获取
      // 支持多种链接格式：/author/ 和 /search/
      if (allAuthors.length === 0) {
        // 使用更通用的选择器，支持多种链接格式
        const infoElement = document.querySelector('#info');
        if (infoElement) {
          // 先获取所有链接
          const allLinks = Array.from(infoElement.querySelectorAll('a'));
          
          // 查找作者字段附近的链接
          const infoText = infoElement.textContent;
          const authorFieldIndex = infoText.indexOf('作者:') !== -1 ? infoText.indexOf('作者:') : infoText.indexOf('作者：');
          
          // 过滤出可能包含作者信息的链接，优先考虑作者字段附近的
          let authorLinks = [];
          if (authorFieldIndex !== -1) {
            // 获取作者字段附近的DOM节点
            const allTextNodes = this.getTextNodesIn(infoElement);
            let foundAuthorField = false;
            
            for (const node of allTextNodes) {
              if (!foundAuthorField && (node.textContent.includes('作者:') || node.textContent.includes('作者：'))) {
                foundAuthorField = true;
              } else if (foundAuthorField && node.textContent.trim()) {
                // 找到作者字段后的文本内容，提取附近的链接
                const parent = node.parentNode;
                if (parent && parent.tagName === 'A') {
                  authorLinks.push(parent);
                }
                // 检查兄弟节点中的链接
                let next = parent.nextSibling;
                while (next && authorLinks.length < 3) { // 限制最多获取3个链接
                  if (next.nodeType === 1 && next.tagName === 'A') {
                    authorLinks.push(next);
                  }
                  next = next.nextSibling;
                }
                break;
              }
            }
          }
          
          // 如果没有找到作者字段附近的链接，使用旧的过滤方法但增加上下文检查
          if (authorLinks.length === 0) {
            authorLinks = allLinks.filter(link => {
              const href = link.getAttribute('href') || '';
              // 只保留author路径的链接，search路径的链接需要额外检查
              if (href.includes('/author/')) return true;
              if (href.includes('/search/')) {
                // 检查链接的上下文是否与作者相关
                let parent = link.parentNode;
                while (parent && parent !== infoElement) {
                  const parentText = parent.textContent || '';
                  if (parentText.includes('作者') && !parentText.includes('译者')) {
                    return true;
                  }
                  parent = parent.parentNode;
                }
                return false;
              }
              return false;
            });
          }
          
          if (authorLinks.length > 0) {
            
            // 确保获取唯一的作者链接
            const uniqueAuthorLinks = new Map();
            authorLinks.forEach(link => {
              const href = link.getAttribute('href') || '';
              if (href) {
                uniqueAuthorLinks.set(href, link);
              }
            });
            
            // 准备译者信息，用于过滤
            let translatorNames = [];
            // 尝试从译者字段提取译者名称
            const translatorMatch = infoText.match(/译者[:：]\s*([^\n]+)/);
            if (translatorMatch) {
              translatorNames = translatorMatch[1].split(/[,，、]/).map(t => t.trim()).filter(Boolean);
            }
            
            const authorsPromises = Array.from(uniqueAuthorLinks.values()).map(async link => {
              try {
                const href = link.getAttribute('href') || '';
                const fallbackName = link.textContent.trim();
                
                // 过滤掉非作者链接（如出版社链接等）
                if (!fallbackName || fallbackName.length < 2) {
                  return null;
                }
                
                // 检查是否是译者
                const isTranslator = translatorNames.some(tName => 
                  fallbackName.includes(tName) || tName.includes(fallbackName)
                );
                
                if (isTranslator) {
                  return null;
                }
                
                const authorUrl = href ? this.formatUrl(href) : '';
                
                // 检查作者链接是否包含额外信息
                let authorName = fallbackName;
                
                // 检查链接的title属性
                const titleAttr = link.getAttribute('title');
                if (titleAttr && titleAttr !== fallbackName) {
                  authorName = titleAttr.trim();
                }
                
                // 使用作者信息处理方法
                const processedName = await this.getDoubanAuthorFullName(authorUrl, authorName);
                return processedName;
              } catch (err) {
                console.warn(`处理作者链接时出错: ${err.message}`);
                return null;
              }
            });
            
            const linksAuthors = (await Promise.all(authorsPromises)).filter(Boolean);
            if (linksAuthors.length > 0) {
              allAuthors.push(...linksAuthors);
            }
          }
        }
      }
      
      // 3. 兼容旧版页面：从字段列表提取（降级方案）
      if (allAuthors.length === 0) {
        const infoItems = document.querySelectorAll('#info');
        
        if (infoItems.length > 0) {
          const infoText = infoItems[0].textContent;
          const authorMatch = infoText.match(/作者[:：]\s*([^\n]+)/);
          if (authorMatch) {
            let authorStr = authorMatch[1].trim();
            // 移除括号内容
            authorStr = authorStr.replace(/[[\(（].*?[\]）)]/g, '');
            // 分割多个作者
            const parsedAuthors = authorStr.split(/[,，、]/).map(a => a.trim()).filter(Boolean);
            allAuthors.push(...parsedAuthors);
            
            // 尝试为每个作者获取更完整的信息
            const enhancedAuthors = [];
            for (const authorName of parsedAuthors) {
              // 替换jQuery特有选择器，使用标准DOM API
              
              // 获取所有可能的作者链接
              const allInfoLinks = Array.from(infoItems[0].querySelectorAll('a'));
              // 使用文本内容匹配，而不是jQuery的:contains
              const matchingLink = allInfoLinks.find(link => {
                const text = link.textContent.trim();
                // 允许部分匹配，提高兼容性
                return text.includes(authorName) || authorName.includes(text);
              });
              
              if (matchingLink) {
                const href = matchingLink.getAttribute('href') || '';
                const authorUrl = href ? this.formatUrl(href) : '';
                const enhancedName = await this.getDoubanAuthorFullName(authorUrl, authorName);
                enhancedAuthors.push(enhancedName);
              } else {
                enhancedAuthors.push(authorName);
              }
            }
            
            // 如果成功增强了作者信息，使用增强后的版本
            if (enhancedAuthors.length > 0) {
              allAuthors.length = 0;
              allAuthors.push(...enhancedAuthors);
            }
          }
        }
      }
      
      // 4. 从meta标签和JSON-LD数据提取作者信息
      if (allAuthors.length === 0) {
        
        // 从meta标签提取
        const metaAuthor = document.querySelector('meta[property="book:author"]');
        if (metaAuthor) {
          const authorName = metaAuthor.getAttribute('content') || '';
          if (authorName) {
            allAuthors.push(authorName);
          }
        }
        
        // 尝试从JSON-LD数据提取
        try {
          const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
          if (jsonLdScript) {
            const jsonData = JSON.parse(jsonLdScript.textContent);
            if (jsonData && jsonData.author) {
              let authors = [];
              if (Array.isArray(jsonData.author)) {
                authors = jsonData.author.map(author => 
                  typeof author === 'string' ? author : (author.name || '')
                );
              } else if (typeof jsonData.author === 'object') {
                authors = [jsonData.author.name || ''];
              } else if (typeof jsonData.author === 'string') {
                authors = [jsonData.author];
              }
              
              authors = authors.filter(Boolean);
              if (authors.length > 0) {
                allAuthors.push(...authors);
              }
            }
          }
        } catch (jsonError) {
          console.warn(`解析JSON-LD数据出错: ${jsonError.message}`);
        }
      }
      
      // 5. 最后尝试从其他可能的位置提取
      if (allAuthors.length === 0) {
        
        // 查找页面中可能的作者信息
        const possibleAuthorElements = document.querySelectorAll('.author-item, .subject-cast a, #info .attrs');
        for (const el of possibleAuthorElements) {
          let authorName = '';
          
          if (el.tagName === 'META') {
            authorName = el.getAttribute('content') || '';
          } else {
            authorName = el.textContent.trim();
            // 简单过滤，避免添加过长的文本
            if (authorName.length > 100) continue;
          }
          
          if (authorName && !allAuthors.includes(authorName)) {
            allAuthors.push(authorName);
          }
        }
      }
      
      // 去重并最终处理
      const uniqueAuthors = [...new Set(allAuthors)].filter(Boolean);
      
      // 新增：处理作者信息，过滤国别信息和译者信息
      const processedAuthors = [];
      for (let author of uniqueAuthors) {
        // 1. 过滤国别信息：移除形如[法]、[英]等方括号中的内容
        author = author.replace(/\[.*?\]/g, '').trim();
        
        // 2. 处理可能包含译者的情况
        // 分割可能包含多个角色的条目
        const parts = author.split(/[,，]/);
        
        // 识别译者关键词
        const translatorKeywords = ['译', '译者', '翻译'];
        
        // 过滤掉译者条目，只保留作者条目
        const authorOnlyParts = parts.filter(part => {
          const trimmedPart = part.trim();
          // 检查是否包含译者关键词
          const isTranslator = translatorKeywords.some(keyword => 
            trimmedPart.toLowerCase().includes(keyword)
          );
          return !isTranslator && trimmedPart.length > 0;
        });
        
        // 如果有过滤后的作者部分，添加到结果中
        if (authorOnlyParts.length > 0) {
          processedAuthors.push(...authorOnlyParts);
        } else if (parts.length === 1) {
          // 如果没有明显的译者关键词，且只有一个部分，保留原始内容
          processedAuthors.push(parts[0].trim());
        }
      }
      
      // 再次去重
      const finalAuthors = [...new Set(processedAuthors)].filter(Boolean);
      
      if (finalAuthors.length > 0) {
        // 使用中文顿号分隔多个作者
        return finalAuthors.join('、');
      } else {
        return '';
      }
    } catch (error) {
      console.error('提取豆瓣作者失败:', error);
      return '';
    }
  }
  
  // 获取元素内的所有文本节点
  getTextNodesIn(el) {
    const textNodes = [];
    function getTextNodes(node) {
      if (node.nodeType === 3) { // TEXT_NODE
        textNodes.push(node);
      } else if (node.nodeType === 1) { // ELEMENT_NODE
        for (let i = 0; i < node.childNodes.length; i++) {
          getTextNodes(node.childNodes[i]);
        }
      }
    }
    getTextNodes(el);
    return textNodes;
  }

  // 从作者主页获取完整作者名称（带缓存）
  async getDoubanAuthorFullName(authorUrl, fallbackName) {
    // 检查缓存
    if (this.authorCache.has(authorUrl)) {
      ClipMateLog.debug(`从缓存获取作者名称: ${this.authorCache.get(authorUrl)}`);
      return this.authorCache.get(authorUrl);
    }
    
    try {
      
      // 确保作者URL格式正确
      let processedAuthorUrl = authorUrl;
      // 特别处理/personage/路径，确保使用正确的域名
      if (authorUrl.includes('/personage/') && !authorUrl.startsWith('https://www.douban.com')) {
        processedAuthorUrl = authorUrl.replace(/^https?:\/\/[^/]+/, 'https://www.douban.com');
      }
      
      // 立即创建一个清理过的回退名称，确保有基本结果可用
      const cleanFallbackName = fallbackName.replace(/\[.*?\]/g, '').trim();
      
      // 1. 首先尝试通过扩展API在后台访问作者主页获取完整信息
      // 这是获取"中文+字母"格式的关键步骤
      let fullName = null;
      try {
        
        // 使用Promise包装消息发送，并添加超时处理
        fullName = await this.sendMessageWithTimeout({
          action: 'fetchAuthorPage',
          authorUrl: processedAuthorUrl  // 注意：与修改后的background.js保持一致，使用authorUrl参数名
        }, 15000); // 15秒超时
        
        // 检查是否成功获取到包含中英文的完整名称
        if (fullName && /[\u4e00-\u9fa5]/.test(fullName) && /[a-zA-Z]/.test(fullName)) {
        } else {
          fullName = null;
        }
      } catch (apiError) {
        console.warn(`扩展API调用出错: ${apiError.message}`);
        // 不再在这里抛出错误，而是继续执行降级策略
      }
      
      // 2. 增强降级策略：优先处理personage类型
      if (!fullName && processedAuthorUrl.includes('/personage/')) {
        
        // 查找当前页面中对应的作者链接元素
        let authorElement = null;
        const allLinks = document.querySelectorAll('a[href*="/author/"], a[href*="/personage/"]');
        for (const link of allLinks) {
          const href = link.getAttribute('href');
          if (href && (processedAuthorUrl.includes(href) || href.includes(processedAuthorUrl))) {
            authorElement = link;
            break;
          }
        }
        
        if (authorElement) {
          // 尝试从祖父元素获取更完整的上下文
          const grandParent = authorElement.parentElement?.parentElement;
          if (grandParent) {
            const grandParentText = grandParent.textContent.trim();
            // 使用更智能的正则表达式查找中英文组合
            const namePattern = /[\u4e00-\u9fa5]+[\s\n]+[A-Z][a-zA-Z\s]+/;
            const match = grandParentText.match(namePattern);
            if (match) {
              fullName = match[0].trim();
            }
          }
          
          // 尝试从相邻元素提取英文名称
          const adjacentEnglish = this.extractAdjacentEnglishName(authorElement);
          if (adjacentEnglish) {
            const chineseName = fallbackName || authorElement.textContent.trim();
            fullName = `${chineseName} ${adjacentEnglish}`;
          }
        }
      }
      
      // 3. 增强的降级策略：检查更多上下文信息
      if (!fullName) {
        
        // 尝试从页面中查找更多可能的作者信息来源
        // 3.1 检查#info部分的作者相关元素
        const infoSection = document.getElementById('info');
        if (infoSection) {
          const authorTags = infoSection.querySelectorAll('a[href*="/author/"], a[href*="/personage/"]');
          for (const tag of authorTags) {
            // 检查是否是当前作者的链接
            if (tag.getAttribute('href')?.includes(processedAuthorUrl.split('/').pop())) {
              const englishName = this.extractAdjacentEnglishName(tag);
              if (englishName) {
                fullName = `${cleanFallbackName} ${englishName}`;
                break;
              }
            }
          }
        }
      }
      
      // 继续现有的降级逻辑
      if (!fullName) {
        
        // 查找页面中可能包含作者名称的其他元素
        const nameElements = document.querySelectorAll('a[href*="/author/"] span, a[href*="/personage/"] span');
        for (const element of nameElements) {
          let text = element.textContent.trim();
          // 过滤国别信息
          text = text.replace(/\[.*?\]/g, '').trim();
          
          if (text && /[\u4e00-\u9fa5]/.test(text)) {
            // 尝试从该元素周围获取英文名称
            const englishName = this.extractAdjacentEnglishName(element);
            if (englishName) {
              fullName = `${text} ${englishName}`;
              break;
            }
          }
        }
      }
      
      // 确保至少有一个基本的作者名称作为最终降级
      if (!fullName) {
        fullName = cleanFallbackName;
      } else {
        // 过滤已获取的完整名称中的国别信息
        fullName = fullName.replace(/\[.*?\]/g, '').trim();
      }
      
      // 智能提取英文名称的逻辑
      if (!/[a-zA-Z]/.test(fullName)) {
        const englishName = this.extractAdjacentEnglishName(document.querySelector(`a[href*="${processedAuthorUrl.split('/').pop()}"]`));
        if (englishName) {
          fullName = `${fullName} ${englishName}`;
        }
      }
      
      // 缓存结果
      this.authorCache.set(authorUrl, fullName);
      
      return fullName;
    } catch (error) {
      console.error(`获取作者完整名称失败: ${error.message}`);
      // 出错时也缓存，避免重复请求
      const safeFallback = fallbackName ? fallbackName.replace(/\[.*?\]/g, '').trim() : '';
      this.authorCache.set(authorUrl, safeFallback);
      return safeFallback;
    }
  }
  
  // 带超时的消息发送辅助函数
  sendMessageWithTimeout(message, timeoutMs = 30000) { // 增加默认超时时间
    // 参数验证
    if (!message || typeof message !== 'object') {
      console.warn('sendMessageWithTimeout: 无效的消息参数');
      return Promise.resolve(null);
    }
    
    return new Promise((resolve) => { // 修改为始终resolve而非reject，确保降级流程正常工作
      // 设置超时定时器
      const timeoutId = setTimeout(() => {
        const action = message.action || '未知操作';
        console.warn(`消息发送超时: ${action}`);
        resolve(null); // 超时也返回null而不是reject，让上层逻辑处理
      }, timeoutMs);
      
      try {
        // 检查浏览器环境是否支持扩展API（优先使用 browser.* 的原生 Promise）
        if (typeof WBR !== 'undefined' && WBR && WBR.runtime) {
          // 向后台脚本发送消息：统一改为 Promise 形式，Chrome MV3 与 Firefox 行为一致
          WBR.runtime.sendMessage(message)
            .then((response) => {
              clearTimeout(timeoutId);

              if (!response) {
                console.warn(`未收到响应: ${message.action || '未知操作'}`);
                resolve(null);
                return;
              }

              // 优先检查多种可能的作者名称字段
              const authorName = response.fullName ||
                                 response.authorName ||
                                 response.name ||
                                 response.author;

              if (authorName && typeof authorName === 'string' && authorName.trim()) {
                const trimmedName = authorName.trim();
                resolve(trimmedName);
              } else {
                // 更友好的日志输出，避免混淆用户
                const responseStatus = response.success !== undefined ? `(状态: ${response.success ? '成功' : '失败'})` : '';
                ClipMateLog.info(`尝试从后台获取作者信息${responseStatus}，将使用本地降级策略获取作者名称`);
                resolve(null);
              }
            })
            .catch((error) => {
              clearTimeout(timeoutId);
              const action = message.action || '未知操作';
              // 使用warn而不是error，避免控制台过多的红色错误信息
              console.warn(`消息发送遇到问题[${action}]: ${error && error.message ? error.message : error}`);
              resolve(null); // 出错时返回null，让上层逻辑降级处理
            });
        } else {
          clearTimeout(timeoutId);
          console.warn('浏览器环境不支持扩展API');
          resolve(null);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        console.warn(`消息处理过程中发生异常: ${error.message}`);
        resolve(null);
      }
    });
  }

  // 提取豆瓣字段 - 增强版，支持多种选择器和提取策略
  async getDoubanField(fieldName) {
    try {
      // 为别名（又名）字段添加特殊调试标记
      const isAliasField = fieldName === '又名';
      const logPrefix = isAliasField ? '[DoubanBookExtractor] [ALIAS_DEBUG]' : '';
      
      if (isAliasField) {
      } else {
      }
      
      // 特殊处理作者字段 - 直接调用getDoubanAuthor，该方法已经确保创作者版块最高优先级
      if (fieldName === 'author' || fieldName === '作者' || fieldName === '创作者') {
        const authorResult = await this.getDoubanAuthor();
        if (authorResult) {
          return authorResult;
        } else {
        }
      }
      
      const fieldAliases = {
        '副标题': ['副标题'],
        '原作名': ['原作名'],
        '出版年': ['出版年', '出版日期'],
        '页数': ['页数'],
        'ISBN': ['ISBN', '统一书号'],
        '又名': ['又名'],
        '出版社': ['出版社'],
        '定价': ['定价'],
        '译者': ['译者'],
        '出品方': ['出品方'],
        '丛书': ['丛书']
      };
      
      const aliases = fieldAliases[fieldName] || [fieldName];
      
      // 策略1: 尝试使用传统的选择器 #info span.pl, #info .pl
      const infoItems = document.querySelectorAll('#info span.pl, #info .pl');
      const strategy = '策略1';
      
      
      for (const item of infoItems) {
        const text = item.textContent.trim();
        for (const alias of aliases) {
          
          if (text.includes(alias)) {
            let nextNode = item.nextSibling;
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
            
            content = content.trim().replace(/[\n\r]/g, '');
            if (content) {
              if (isAliasField) {
              } else {
              }
              return content;
            }
          }
        }
      }
      
      // 策略2: 尝试使用新的选择器结构（适应豆瓣页面更新）
      const newInfoItems = document.querySelectorAll('.subject clearfix #info .pl');
      const strategy2 = '策略2';
      
      
      for (const item of newInfoItems) {
        const text = item.textContent.trim();
        for (const alias of aliases) {
          
          if (text.includes(alias)) {
            // 获取兄弟节点中的文本
            let value = '';
            const siblings = Array.from(item.parentNode.childNodes).filter(node => 
              node.nodeType === Node.TEXT_NODE && node.textContent.trim()
            );
            
            
            if (siblings.length > 0) {
              value = siblings.map(node => node.textContent.trim()).join(' ');
            }
            
            // 尝试获取后面的链接元素
            const linkEl = item.nextElementSibling;
            if (linkEl && linkEl.tagName === 'A') {
              value += (value ? ' ' : '') + linkEl.textContent.trim();
            }
            
            value = value.trim().replace(/[\n\r]/g, '');
            if (value) {
              if (isAliasField) {
              } else {
              }
              return value;
            }
          }
        }
      }
      
      // 策略3: 使用更宽松的正则表达式查找
      const infoElement = document.querySelector('#info');
      const strategy3 = '策略3';
      
      if (infoElement) {
        
        for (const alias of aliases) {
          // 更宽松的正则表达式，考虑各种可能的格式
          const patterns = [
            // 原始模式
            new RegExp(alias + '[：:]?\s*([^\n]+)'),
            // 考虑冒号前后可能有空格
            new RegExp(alias + '\s*[：:]\s*([^\n]+)'),
            // 考虑可能用英文冒号
            new RegExp(alias + '\s*:\s*([^\n]+)'),
            // 考虑可能有多余字符
            new RegExp(alias + '[^\n]*?[：:]\s*([^\n]+)')
          ];
          
          
          for (const pattern of patterns) {
            const match = infoElement.textContent.match(pattern);
            
            if (match && match[1]) {
              const content = match[1].trim().replace(/[\n\r]/g, '');
              if (isAliasField) {
              } else {
              }
              return content;
            }
          }
        }
      }
      
      // 策略4: 尝试直接查找包含字段名的行
      const infoText = document.querySelector('#info')?.textContent || '';
      const lines = infoText.split(/[\n\r]+/);
      const strategy4 = '策略4';
      
      
      for (const line of lines) {
        const trimmedLine = line.trim();
        for (const alias of aliases) {
          
          if (trimmedLine.includes(alias)) {
            // 提取冒号后面的内容
            const colonIndex = trimmedLine.indexOf('：');
            const colonIndex2 = trimmedLine.indexOf(':');
            const finalColonIndex = colonIndex > -1 ? colonIndex : colonIndex2;
            
            
            if (finalColonIndex > -1) {
              const value = trimmedLine.substring(finalColonIndex + 1).trim();
              if (value) {
                if (isAliasField) {
                } else {
                }
                return value;
              }
            }
          }
        }
      }
      
      // 策略5: 针对特定字段使用特定选择器
      const strategy5 = '策略5';
      
      if (fieldName === '出版社') {
        const publisherEl = document.querySelector('#info a[href*="/publishers/"]');
        if (publisherEl) {
          return publisherEl.textContent.trim();
        }
      } else if (fieldName === '定价') {
        // 尝试直接匹配价格模式
        const priceMatch = infoText.match(/定价[：:]?\s*(\d+(?:\.\d+)?\s*元?)/);
        if (priceMatch && priceMatch[1]) {
          return priceMatch[1];
        }
      } else if (fieldName === 'ISBN') {
        // 尝试直接匹配ISBN模式
        const isbnMatch = infoText.match(/ISBN[：:]?\s*([\d-]+)/);
        if (isbnMatch && isbnMatch[1]) {
          return isbnMatch[1];
        }
      }
      
      // 尝试从JSON-LD提取字段
      const jsonLdValue = this.extractFromJsonLd(fieldName);
      if (jsonLdValue) {
        if (isAliasField) {
        } else {
        }
        return jsonLdValue;
      }
      
      if (isAliasField) {
      } else {
        ClipMateLog.debug(`无法提取字段 ${fieldName}`);
      }
      return '';
    } catch (error) {
      if (fieldName === '又名') {
        console.error('[DoubanBookExtractor] [ALIAS_DEBUG] 提取别名（又名）字段失败:', error, { errorStack: error.stack });
      } else {
        console.error(`提取豆瓣字段 ${fieldName} 失败:`, error);
      }
      return '';
    }
  }

  // 提取豆瓣简介 - 只从"内容简介"字段提取
  getDoubanIntro() {
    try {
      // v2.8.3：先取「展开版」。
      // 豆瓣把同一段简介在 DOM 里放了两份：
      //   <span class="short">       页面上默认显示、被折叠的摘要，末尾自带「...」，
      //                              后面还挂一个「(展开全部)」链接；
      //   <span class="all hidden">  完整正文（隐藏，点「展开全部」才显示）。
      // 老实现从 #link-report 往下找**第一个** .intro，命中的必然是那份短摘要 ——
      // 用户看到的就是「简介不完整、结尾有 …」。这跟设置页的字数上限无关：
      // 摘要本身只有几百字，永远到不了 500 的上限，所以把上限改成 0 也不会变长。
      const fullEl = document.querySelector('#link-report .all .intro')
        || document.querySelector('#link-report .all');
      const fullText = this.readIntroText(fullEl);
      if (fullText) return fullText;

      // 退路：没有 .all 结构的老页面 → 按「内容简介」标题找它的下一个兄弟节点。
      // 查找包含"内容简介"的标题元素
      const contentIntroTitle = Array.from(document.querySelectorAll('#link-report h2, .related_info h2')).find(
        titleEl => titleEl.textContent.includes('内容简介')
      );
      
      if (contentIntroTitle) {
        // 获取内容简介标题的下一个兄弟元素，通常是包含简介内容的div
        let introEl = contentIntroTitle.nextElementSibling;
        
        // 查找包含.intro类的元素
        while (introEl && !introEl.classList.contains('intro')) {
          introEl = introEl.querySelector('.intro') || introEl.nextElementSibling;
        }
        
        if (introEl && introEl.classList.contains('intro')) {
          return this.readIntroText(introEl);
        }
      }
      
      return '';
    } catch (error) {
      console.error('提取豆瓣简介失败:', error);
      return '';
    }
  }

  /**
   * 把简介容器读成纯文本（v2.8.3）
   *
   * 为什么要单独抽一层：
   *   ① 豆瓣的 .all 里塞了一个 `<style>.intro p{text-indent:2em;…}</style>`，
   *      直接 textContent 会把这段 CSS 当成简介正文抄进去；
   *   ② 短摘要末尾总有 `<a class="a_show_full">(展开全部)</a>`，
   *      按段落拼文本时会多出一段「(展开全部)」。
   * 两样都清掉，只剩正文。段落之间仍用换行连接（与原实现一致）。
   */
  readIntroText(el) {
    if (!el) return '';
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('style, script, .a_show_full').forEach((n) => n.remove());
      const paragraphs = Array.from(clone.querySelectorAll('p'))
        .map((p) => p.textContent.trim())
        .filter((t) => t && !/^[（(]?\s*展开全部\s*[)）]?$/.test(t));
      if (paragraphs.length > 0) return paragraphs.join('\n');
      return clone.textContent.trim();
    } catch (error) {
      return el.textContent ? el.textContent.trim() : '';
    }
  }

  // 提取豆瓣评分（v2.5.53）
  // 与 douban-movie.js 的 extractRating() 同一套取法，改动时两处要同步。
  // 只认页面「豆瓣评分」那一格。书籍页可能被第三方脚本（例如油猴上的多站评分脚本）
  // 注入额外评分块（客观评分 / IMDb评分 / 好友评分 等），
  // 原先「取容器里第一个数字」会抓到别的分，所以这里锁定豆瓣官方微数据
  // property="v:average"（就是页面上显示的那个豆瓣评分），再退到「豆瓣评分」标签那一格。
  getDoubanRating() {
    try {
      const pick = (el) => {
        if (!el) return '';
        return this.parseRating((el.textContent || '').trim());
      };

      // 1) 官方微数据：<strong class="ll rating_num" property="v:average">9.1</strong>
      let rating =
        pick(document.querySelector('#interest_sectl [property="v:average"]')) ||
        pick(document.querySelector('[property="v:average"]'));
      if (rating) return rating;

      // 2) 兜底：评分区里标注为「豆瓣评分」的那一格
      const wraps = document.querySelectorAll('#interest_sectl .rating_wrap');
      for (const wrap of wraps) {
        const label = wrap.querySelector('.rating_logo');
        if (label && /豆瓣评分/.test(label.textContent || '')) {
          rating = pick(wrap.querySelector('.rating_num'));
          if (rating) return rating;
        }
      }

      // 3) 再兜底：评分区里只有一个评分时取它（防止豆瓣改掉微数据标签）
      //    但「好友评分」那格要排除——书籍页的好友评分就在 #interest_sectl 里面，
      //    它不是你自己的豆瓣评分，拿它顶上会误导。
      const nums = document.querySelectorAll('#interest_sectl strong.rating_num');
      if (nums.length === 1) {
        const wrap = nums[0].closest('.rating_wrap');
        const label = wrap ? wrap.querySelector('.rating_logo') : null;
        const labelText = label ? (label.textContent || '') : '';
        if (!/好友评分|友邻评分/.test(labelText)) {
          rating = pick(nums[0]);
          if (rating) return rating;
        }
      }

      // 没有评分（评价人数不足 / 未评分）就留空，不猜其它数字
      return '';
    } catch (error) {
      console.error('提取豆瓣评分失败:', error);
      return '';
    }
  }

  // 格式化URL
  formatUrl(url, baseUrl = 'https://book.douban.com') {
    try {
      // 检查是否为null或undefined
      if (!url) {
        console.warn('formatUrl 接收到空URL:', url);
        return '';
      }
      
      // 去除首尾空白
      url = String(url).trim();
      
      // 检查是否为空字符串
      if (!url) {
        console.warn('formatUrl 接收到空字符串URL');
        return '';
      }
      
      
      // 验证URL格式并处理
      if (url.startsWith('http')) {
        // 对于完整URL，尝试创建URL对象
        try {
          const urlObj = new URL(url);
          // 只保留origin和pathname，移除所有查询参数和锚点
          const result = urlObj.origin + urlObj.pathname;
          return result;
        } catch (e) {
          console.warn('无法解析完整URL，返回清理后的值:', url);
          // 只保留问号或井号前的部分
          let result = url;
          if (url.includes('?')) {
            result = url.split('?')[0];
          } else if (url.includes('#')) {
            result = url.split('#')[0];
          }
          return result;
        }
      }
      // 如果提供了基础URL且URL是相对路径，则组合
      else if (baseUrl && !url.startsWith('http')) {
        // 确保基础URL和相对路径的连接正确
        const combinedUrl = (baseUrl.endsWith('/') ? baseUrl : baseUrl + '/') + 
                           (url.startsWith('/') ? url.slice(1) : url);
        
        // 尝试解析组合后的URL
        try {
          const urlObj = new URL(combinedUrl);
          // 只保留origin和pathname，移除所有查询参数和锚点
          const result = urlObj.origin + urlObj.pathname;
          return result;
        } catch (e) {
          console.warn('无法解析组合URL，返回组合结果:', combinedUrl);
          // 只保留问号或井号前的部分
          let result = combinedUrl;
          if (combinedUrl.includes('?')) {
            result = combinedUrl.split('?')[0];
          } else if (combinedUrl.includes('#')) {
            result = combinedUrl.split('#')[0];
          }
          return result;
        }
      }
      
      // 对于其他情况，尝试添加协议前缀后解析
      try {
        // 尝试将URL作为相对路径处理
        if (url.startsWith('/')) {
          const absoluteUrl = 'https://book.douban.com' + url;
          const urlObj = new URL(absoluteUrl);
          // 只保留origin和pathname，移除所有查询参数和锚点
          const result = urlObj.origin + urlObj.pathname;
          return result;
        }
        
        // 如果无法解析，只保留问号或井号前的部分
        let result = url;
        if (url.includes('?')) {
          result = url.split('?')[0];
        } else if (url.includes('#')) {
          result = url.split('#')[0];
        }
        return result;
      } catch (e) {
        console.warn('无法解析URL，返回清理后的值:', url);
        // 只保留问号或井号前的部分
        let result = url;
        if (url.includes('?')) {
          result = url.split('?')[0];
        } else if (url.includes('#')) {
          result = url.split('#')[0];
        }
        return result;
      }
    } catch (error) {
      console.error('格式化URL失败:', error);
      // 失败时尝试手动构建绝对URL
      if (url.startsWith('/author/')) {
        const result = 'https://book.douban.com' + url;
        return result;
      } else if (url.startsWith('/personage/')) {
        const result = 'https://www.douban.com' + url;
        return result;
      }
      // 对于其他以/开头的相对路径，也尝试添加基础URL
      else if (url.startsWith('/')) {
        const result = 'https://book.douban.com' + url;
        return result;
      }
      // 只保留问号或井号前的部分
      let result = url;
      if (url.includes('?')) {
        result = url.split('?')[0];
      } else if (url.includes('#')) {
        result = url.split('#')[0];
      }
      return result;
    }
  }

  // 获取其他信息 - 增强版，支持按DOM顺序提取
  async getDoubanOtherInfo() {
    try {
      const parts = [];
      
      // 首先尝试按DOM顺序提取
      const infoElement = document.querySelector('#info');
      if (infoElement) {
        
        // 定义需要排除的主字段
        const mainFields = ['书名', '作者', '原作名', '出版年', '页数', 'ISBN'];
        
        // 定义要提取的其他信息字段及其顺序（用于字段识别）
        const otherInfoFields = ['副标题', '译者', '出版社', '出品方', '丛书', '定价', '装帧'];
        
        // 收集所有可能的字段元素
        const fieldElements = Array.from(infoElement.querySelectorAll('.pl, span.pl'));
        
        // 用于记录已处理的字段，避免重复添加
        const processedFields = new Set();
        
        // 按DOM顺序处理每个字段元素
        for (const element of fieldElements) {
          const fieldText = element.textContent.trim();
          let fieldName = '';
          
          // 确定字段名
          for (const f of otherInfoFields) {
            if (fieldText.includes(f)) {
              fieldName = f;
              break;
            }
          }
          
          // 跳过主字段和已处理的字段，只处理其他信息字段
          if (fieldName && !processedFields.has(fieldName) && !mainFields.some(mf => fieldText.includes(mf))) {
            processedFields.add(fieldName);
            
            // 特殊处理译者字段，因为它有特殊的提取策略
            if (fieldName === '译者') {
              let translator = '';
              
              // 策略A: 优先从创作者版块提取译者信息（新版豆瓣页面）
              let translators = [];
              // 尝试多个可能的选择器组合
              const authorElementsSelectors = [
                '#authors .authors-list .author',
                '.subject-wrap #authors .author',
                '#content #authors .author',
                '.subject-content #authors .author'
              ];
              
              let foundTranslators = false;
              for (const selector of authorElementsSelectors) {
                const authorElements = document.querySelectorAll(selector);
                if (authorElements.length > 0) {
                  for (const el of authorElements) {
                    const roleEl = el.querySelector('.role');
                    const role = roleEl ? roleEl.textContent.trim() : '';
                    
                    // 提取角色为译者的作者，支持多种可能的角色名称
                    const translatorRoles = ['译者', '翻译', 'Translator', 'translator'];
                    if (translatorRoles.some(transRole => role.includes(transRole))) {
                      const nameEl = el.querySelector('.name, a.name');
                      if (nameEl) {
                        const translatorName = nameEl.innerText.trim();
                        translators.push(translatorName);
                        foundTranslators = true;
                      }
                    }
                  }
                  if (foundTranslators) break;
                }
              }
              
              // 策略B: 如果策略A失败，使用getDoubanField作为保底方案
              if (translators.length === 0) {
                translator = await this.getDoubanField('译者');
                if (translator) {
                  // 格式化译者字段：移除多余冒号，替换斜杠为顿号
                  translator = translator.replace(/^:+/, '');
                  translator = translator.replace(/\s*\/\s*/g, '、');
                  translator = translator.replace(/\s*[,，]\s*/g, '、');
                  // 处理"等"字情况
                }
              } else {
                // 使用从创作者版块提取的译者列表
                translator = translators.join('、');
              }
              
              if (translator) {
                parts.push(`译者：${translator}`);
              }
            } 
            // 特殊处理出版社字段
            else if (fieldName === '出版社') {
              let publisher = await this.getDoubanField('出版社');
              if (!publisher) {
                // 尝试直接从链接中提取
                const publisherLink = document.querySelector('#info a[href*="publishers"]');
                if (publisherLink) {
                  publisher = publisherLink.textContent.trim();
                }
              }
              if (publisher) {
                parts.push(`出版社：${publisher}`);
              }
            }
            // 特殊处理丛书字段
            else if (fieldName === '丛书') {
              let series = await this.getDoubanField('丛书');
              if (!series) {
                // 尝试从特定链接提取
                const seriesLink = document.querySelector('#info a[href*="series"]');
                if (seriesLink) {
                  series = seriesLink.textContent.trim();
                }
              }
              if (series) {
                parts.push(`丛书：${series}`);
              }
            }
            // 对于其他字段，使用getDoubanField方法
            else {
              const fieldValue = await this.getDoubanField(fieldName);
              if (fieldValue) {
                parts.push(`${fieldName}：${fieldValue}`);
              }
            }
          }
        }
      }
      
      // 如果DOM顺序提取失败或未提取到信息，回退到原有的固定顺序逻辑
      if (parts.length === 0) {
        
        // 1. 提取副标题信息（使用增强版getDoubanField）
        const subtitle = await this.getDoubanField('副标题');
        if (subtitle) {
          parts.push(`副标题：${subtitle}`);
        }
        
        // 2. 多层次译者信息提取策略
        let translator = '';
        
        // 策略A: 优先从创作者版块提取译者信息（新版豆瓣页面）
        let translators = [];
        // 尝试多个可能的选择器组合
        const authorElementsSelectors = [
          '#authors .authors-list .author',
          '.subject-wrap #authors .author',
          '#content #authors .author',
          '.subject-content #authors .author'
        ];
        
        let foundTranslators = false;
        for (const selector of authorElementsSelectors) {
          const authorElements = document.querySelectorAll(selector);
          if (authorElements.length > 0) {
            for (const el of authorElements) {
              const roleEl = el.querySelector('.role');
              const role = roleEl ? roleEl.textContent.trim() : '';
              
              // 提取角色为译者的作者，支持多种可能的角色名称
              const translatorRoles = ['译者', '翻译', 'Translator', 'translator'];
              if (translatorRoles.some(transRole => role.includes(transRole))) {
                const nameEl = el.querySelector('.name, a.name');
                if (nameEl) {
                  const translatorName = nameEl.innerText.trim();
                  translators.push(translatorName);
                  foundTranslators = true;
                }
              }
            }
            if (foundTranslators) break;
          }
        }
        
        // 策略B: 如果策略A失败，使用getDoubanField作为保底方案
        if (translators.length === 0) {
          translator = await this.getDoubanField('译者');
          if (translator) {
            // 格式化译者字段：移除多余冒号，替换斜杠为顿号
            translator = translator.replace(/^:+/, '');
            translator = translator.replace(/\s*\/\s*/g, '、');
            translator = translator.replace(/\s*[,，]\s*/g, '、');
            // 处理"等"字情况
          }
        } else {
          // 使用从创作者版块提取的译者列表
          translator = translators.join('、');
        }
        
        if (translator) {
          parts.push(`译者：${translator}`);
        }
        
        // 3. 出版社信息提取（增加额外策略）
        let publisher = await this.getDoubanField('出版社');
        if (!publisher) {
          // 尝试直接从链接中提取
          const publisherLink = document.querySelector('#info a[href*="publishers"]');
          if (publisherLink) {
            publisher = publisherLink.textContent.trim();
          }
        }
        if (publisher) {
          parts.push(`出版社：${publisher}`);
        }
        
        // 4. 出品方信息提取
        const producer = await this.getDoubanField('出品方');
        if (producer) {
          parts.push(`出品方：${producer}`);
        }
        
        // 5. 丛书信息提取（增加额外策略）
        let series = await this.getDoubanField('丛书');
        if (!series) {
          // 尝试从特定链接提取
          const seriesLink = document.querySelector('#info a[href*="series"]');
          if (seriesLink) {
            series = seriesLink.textContent.trim();
          }
        }
        if (series) {
          parts.push(`丛书：${series}`);
        }
        
        // 6. 定价信息提取
        let price = await this.getDoubanField('定价');
        if (price) {
          parts.push(`定价：${price}`);
        }
        
        // 7. 增加额外有价值的字段
        const binding = await this.getDoubanField('装帧');
        if (binding) {
          parts.push(`装帧：${binding}`);
        }
      }
      
      // 8. 检查是否有提取到任何信息
      const result = parts.join(', ');
      
      // 如果仍然没有提取到任何信息，尝试从整个info区域提取所有文本并整理
      if (!result) {
        const infoElement = document.querySelector('#info');
        if (infoElement) {
          const infoText = infoElement.textContent.trim();
          const lines = infoText.split(/[\n\r]+/).map(line => line.trim()).filter(line => line);
          
          // 收集所有看起来像字段的行
          const potentialFields = [];
          for (const line of lines) {
            // 寻找包含冒号的行作为潜在字段
            if (line.includes('：') || line.includes(':')) {
              // 提取字段名和值
              const colonIndex = line.indexOf('：') > -1 ? line.indexOf('：') : line.indexOf(':');
              const fieldName = line.substring(0, colonIndex).trim();
              const fieldValue = line.substring(colonIndex + 1).trim();
              
              // 只添加有值的字段，并且不是已经映射过的主字段
              const mainFields = ['书名', '作者', '原作名', '出版年', '页数', 'ISBN'];
              if (fieldValue && !mainFields.some(f => fieldName.includes(f))) {
                potentialFields.push(`${fieldName}：${fieldValue}`);
              }
            }
          }
          
          if (potentialFields.length > 0) {
            const fallbackResult = potentialFields.join(', ');
            return fallbackResult;
          }
        }
      }
      
      return result;
    } catch (error) {
      console.error('提取其他信息失败:', error);
      return '';
    }
  }

  // 格式化日期
  formatDate(dateStr) {
    if (!dateStr) return '';
    
    // 移除中文日期字符
    dateStr = dateStr.toString().replace(/[年月]/g, '-').replace(/[日]/g, '');
    
    // 处理数字转中文的情况（简化处理，主要针对年份）
    const chineseNumbers = {'零': '0', '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'};
    let cleanedDateStr = dateStr;
    for (const [chinese, number] of Object.entries(chineseNumbers)) {
      cleanedDateStr = cleanedDateStr.replace(new RegExp(chinese, 'g'), number);
    }
    
    // 尝试使用正则表达式直接解析日期部分，避免时区问题
    const datePattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    const match = cleanedDateStr.match(datePattern);
    if (match) {
      const [, year, month, day] = match;
      return `${year}/${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
    }
    
    // 处理年月格式
    const yearMonthPattern = /(\d{4})[-/](\d{1,2})/;
    const ymMatch = cleanedDateStr.match(yearMonthPattern);
    if (ymMatch) {
      const [, year, month] = ymMatch;
      return `${year}/${month.padStart(2, '0')}/01`;
    }
    
    // 只提取年份
    const yearMatch = cleanedDateStr.match(/(\d{4})/);
    if (yearMatch) {
      return `${yearMatch[1]}/01/01`;
    }
    
    return dateStr.trim();
  }

  // 智能提取相邻元素中的英文名称
  extractAdjacentEnglishName(element) {
    if (!element) return null;
    
    // 尝试从相邻文本节点提取
    const parent = element.parentNode;
    if (parent) {
      const children = Array.from(parent.childNodes);
      const elementIndex = children.indexOf(element);
      
      // 检查前后相邻的文本节点
      for (let i = Math.max(0, elementIndex - 1); i <= Math.min(children.length - 1, elementIndex + 1); i++) {
        if (children[i].nodeType === Node.TEXT_NODE) {
          const text = children[i].textContent.trim();
          // 匹配可能的英文名称（至少两个单词，首字母大写）
          const englishNameMatch = text.match(/[A-Z][a-z]+(\s+[A-Z][a-z]+){1,}/);
          if (englishNameMatch) {
            return englishNameMatch[0];
          }
        }
      }
      
      // 检查相邻的元素节点
      const adjacentElements = [
        parent.previousElementSibling,
        parent.nextElementSibling,
        ...Array.from(parent.children).filter(el => el !== element)
      ];
      
      for (const adjEl of adjacentElements) {
        if (adjEl) {
          const text = adjEl.textContent.trim();
          // 匹配可能的英文名称
          const englishNameMatch = text.match(/^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,}$/);
          if (englishNameMatch) {
            return englishNameMatch[0];
          }
        }
      }
    }
    
    return null;
  }


  
  // 从JSON-LD结构化数据提取字段
  extractFromJsonLd(fieldName) {
    try {
      
      const jsonLdScript = document.querySelector('script[type="application/ld+json"]');
      if (!jsonLdScript) {
        return '';
      }
      
      let jsonData;
      try {
        jsonData = JSON.parse(jsonLdScript.textContent);
      } catch (parseError) {
        console.warn(`解析JSON-LD数据失败: ${parseError.message}`);
        return '';
      }
      
      if (!jsonData) return '';
      
      // 处理字段映射
      const fieldMap = {
        'author': 'author',
        '作者': 'author',
        '创作者': 'author',
        '书名': 'name',
        'name': 'name',
        'title': 'name',
        'description': 'description',
        '简介': 'description',
        '内容简介': 'description',
        '出版社': 'publisher',
        'publisher': 'publisher',
        '出版年': 'datePublished',
        '发布日期': 'datePublished',
        'datePublished': 'datePublished',
        'ISBN': 'isbn',
        'isbn': 'isbn',
        '页数': 'numberOfPages',
        'numberOfPages': 'numberOfPages',
        '定价': 'offers.price',
        'price': 'offers.price'
      };
      
      const jsonField = fieldMap[fieldName] || fieldName;
      
      // 处理嵌套字段路径
      if (jsonField.includes('.')) {
        const [parent, child] = jsonField.split('.');
        if (jsonData[parent] && typeof jsonData[parent] === 'object') {
          let jsonValue = jsonData[parent][child];
          if (jsonValue) {
            return jsonValue.toString();
          }
        }
      } else if (jsonData[jsonField]) {
        let jsonValue = jsonData[jsonField];
        
        // 特殊处理作者字段（可能是数组）
        if (Array.isArray(jsonValue)) {
          // 作者数组的特殊处理
          if (fieldName.toLowerCase().includes('author') || ['作者', '创作者'].includes(fieldName)) {
            jsonValue = jsonValue.map(author => {
              if (typeof author === 'string') return author;
              if (author && typeof author === 'object') return author.name || '';
              return '';
            }).filter(Boolean).join('、');
          } else {
            // 其他数组的处理
            jsonValue = jsonValue.join('、');
          }
        } else if (typeof jsonValue === 'object' && jsonValue.name) {
          // 嵌套对象的处理
          jsonValue = jsonValue.name;
        }
        
        if (jsonValue) {
          return jsonValue.toString().trim();
        }
      }
      
      return '';
    } catch (error) {
      console.error(`从JSON-LD提取字段 ${fieldName} 出错:`, error);
      return '';
    }
  }

  // 覆盖基类的extractDescription方法，避免从默认选择器中提取内容
  extractDescription() {
    return '';
  }

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

// 导出豆瓣书籍提取器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DoubanBookExtractor;
} else {
  window.DoubanBookExtractor = DoubanBookExtractor;
}