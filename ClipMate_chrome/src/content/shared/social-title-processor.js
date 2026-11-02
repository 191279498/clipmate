/**
 * 社交媒体标题处理器
 * 统一处理所有社交媒体平台的标题生成、字符过滤和转换规则
 * 基于抖音的标题生成策略，为所有社交媒体平台提供一致的标题处理体验
 */

/**
 * 特殊字符转换工具
 * 将各种特殊格式的字母转换为标准ASCII字符
 * 例如将 𝙏𝙐𝙇𝙄𝙋.& 转换为 TULIP.&
 */
class SpecialCharConverter {
  // 特殊字符区块定义
  static specialCharBlocks = [
    // 数学加粗字母
    {
      range: [0x1D400, 0x1D433], // 数学加粗大写字母
      type: 'math-bold',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D400 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D434, 0x1D467], // 数学加粗小写字母
      type: 'math-bold',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D434 + 0x0061); // a-z
      }
    },
    // 数学斜体字母
    {
      range: [0x1D49C, 0x1D4CF], // 数学斜体大写字母
      type: 'math-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D49C + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D4D0, 0x1D503], // 数学斜体小写字母
      type: 'math-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D4D0 + 0x0061); // a-z
      }
    },
    // 数学手写体字母
    {
      range: [0x1D4D0, 0x1D503], // 部分手写体字母与斜体重叠
      type: 'math-script',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D4D0 + 0x0061); // a-z
      }
    },
    // 数学加粗斜体字母
    {
      range: [0x1D538, 0x1D56B], // 数学加粗斜体大写字母
      type: 'math-bold-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D538 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D56C, 0x1D59F], // 数学加粗斜体小写字母
      type: 'math-bold-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D56C + 0x0061); // a-z
      }
    },
    // Sans-serif 加粗字母
    {
      range: [0x1D5A0, 0x1D5D3], // Sans-serif 加粗大写字母
      type: 'sans-serif-bold',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D5A0 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D5D4, 0x1D607], // Sans-serif 加粗小写字母
      type: 'sans-serif-bold',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D5D4 + 0x0061); // a-z
      }
    },
    // Sans-serif 加粗斜体字母 (修复"𝙆𝙞𝙩𝙩𝙖𝙧𝙩"这类字符转换问题) - 优先级更高
    {
      range: [0x1D646, 0x1D655], // Sans-serif 加粗斜体大写字母 (A-J)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        // 正确的大写字母映射：使用偏移量0x1D5FB
        return String.fromCharCode(charCode - 0x1D5FB);
      }
    },
    {
      range: [0x1D656, 0x1D665], // Sans-serif 加粗斜体小写字母 (a-j)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        // 正确的小写字母映射：使用偏移量0x1D5F5
        return String.fromCharCode(charCode - 0x1D5F5);
      }
    },
    {
      range: [0x1D666, 0x1D685], // Sans-serif 加粗斜体小写字母 (k-z)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        // 正确的小写字母映射：使用偏移量0x1D5F5
        return String.fromCharCode(charCode - 0x1D5F5);
      }
    },
    {
      range: [0x1D668, 0x1D69B], // Sans-serif 加粗斜体大写字母 (扩展范围)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D668 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D66E, 0x1D69F], // Sans-serif 加粗斜体小写字母 (扩展范围1)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D66E + 0x0061); // a-z
      }
    },
    {
      range: [0x1D69C, 0x1D6CF], // Sans-serif 加粗斜体小写字母 (扩展范围2)
      type: 'sans-serif-bold-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D69C + 0x0061); // a-z
      }
    },
    // Sans-serif 斜体字母
    {
      range: [0x1D608, 0x1D63B], // Sans-serif 斜体大写字母
      type: 'sans-serif-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D608 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D63C, 0x1D66F], // Sans-serif 斜体小写字母
      type: 'sans-serif-italic',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D63C + 0x0061); // a-z
      }
    },
    // 带点字母
    {
      range: [0x1D680, 0x1D6B3], // 带点大写字母
      type: 'dot-above',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D680 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D6B4, 0x1D6E7], // 带点小写字母
      type: 'dot-above',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D6B4 + 0x0061); // a-z
      }
    },
    // 全宽ASCII字符
    {
      range: [0xFF21, 0xFF3A], // 全宽大写字母
      type: 'full-width',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0xFF21 + 0x0041); // A-Z
      }
    },
    {
      range: [0xFF41, 0xFF5A], // 全宽小写字母
      type: 'full-width',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0xFF41 + 0x0061); // a-z
      }
    },
    // 数学单空格字母
    {
      range: [0x1D6E8, 0x1D71B], // 数学单空格大写字母
      type: 'math-monospace',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D6E8 + 0x0041); // A-Z
      }
    },
    {
      range: [0x1D71C, 0x1D74F], // 数学单空格小写字母
      type: 'math-monospace',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x1D71C + 0x0061); // a-z
      }
    },
    // 上标数字（重点修复：⁴⁰⁷ → 407）
    {
      range: [0x2070, 0x2079], // 上标数字 ⁰¹²³⁴⁵⁶⁷⁸⁹
      type: 'superscript-numbers',
      getNormalChar(charCode) {
        return String.fromCharCode(charCode - 0x2070 + 0x0030); // 0-9
      }
    }
  ];

  // 自定义映射表，用于特殊情况
  static customMappings = {
    // 可以添加特殊字符的自定义映射
    'ℳ': 'M', // 特殊的M字符
    '℃': 'C', // 摄氏度符号转为C
    '℉': 'F', // 华氏度符号转为F
    '°': '',  // 度符号去除
    '–': '-', // 长破折号转短破折号
    '—': '-', // 更长的破折号转短破折号
    '’': "'", // 智能引号转普通引号
    '”': '"', // 智能双引号转普通双引号
    '“': '"', // 智能双引号转普通双引号
    '…': '...', // 省略号转三个点
    // 上标数字转换（⁴⁰⁷ → 407）
    '⁰': '0', // 上标零
    '¹': '1', // 上标一
    '²': '2', // 上标二
    '³': '3', // 上标三
    '⁴': '4', // 上标四
    '⁵': '5', // 上标五
    '⁶': '6', // 上标六
    '⁷': '7', // 上标七
    '⁸': '8', // 上标八
    '⁹': '9', // 上标九
  };

  /**
   * 处理UTF-16代理对
   * @param {string} str 输入字符串
   * @param {number} index 索引位置
   * @returns {number|null} 代理对对应的Unicode码点
   */
  static getCodePoint(str, index) {
    if (index < str.length) {
      const high = str.charCodeAt(index);
      // 检查是否为高代理项
      if (0xD800 <= high && high <= 0xDBFF && index + 1 < str.length) {
        const low = str.charCodeAt(index + 1);
        // 检查是否为低代理项
        if (0xDC00 <= low && low <= 0xDFFF) {
          // 计算完整的Unicode码点
          return (high - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
        }
      }
      return high;
    }
    return null;
  }

  /**
   * 移除Unicode组合字符
   * @param {string} str 输入字符串
   * @returns {string} 移除组合字符后的字符串
   */
  static removeCombiningCharacters(str) {
    // 使用正则表达式移除组合字符（Mark、Nonspacing类别）
    return str.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * 将特殊字符转换为标准ASCII字符
   * @param {string} text 包含特殊字符的文本
   * @returns {string} 转换后的标准文本
   */
  static convertToNormal(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }

    let result = '';
    let i = 0;
    const length = text.length;
    let prevCharIsLetter = false; // 上一个字符是否为字母
    let currentCharIsLetter = false; // 当前字符是否为字母
    let skipSpace = false; // 是否跳过当前空格

    while (i < length) {
      const codePoint = this.getCodePoint(text, i);
      const char = String.fromCodePoint(codePoint);
      
      // 重置当前字符状态
      currentCharIsLetter = false;
      
      // 1. 首先检查自定义映射
      if (this.customMappings[char]) {
        result += this.customMappings[char];
        i += codePoint > 0xFFFF ? 2 : 1;
        continue;
      }

      // 2. 检查特殊字符区块
      let foundInBlock = false;
      for (const block of this.specialCharBlocks) {
        if (codePoint >= block.range[0] && codePoint <= block.range[1]) {
          // 直接使用区块定义的getNormalChar方法转换，不再额外处理大小写
          // 区块定义中的getNormalChar方法已经处理了正确的大小写转换
          let normalChar = block.getNormalChar(codePoint);
          result += normalChar;
          foundInBlock = true;
          currentCharIsLetter = true;
          break;
        }
      }

      if (foundInBlock) {
        prevCharIsLetter = currentCharIsLetter;
        i += codePoint > 0xFFFF ? 2 : 1;
        continue;
      }

      // 3. 尝试移除组合字符
      const baseChar = this.removeCombiningCharacters(char);
      if (baseChar !== char) {
        result += baseChar;
        // 检查处理后的字符是否为字母
        currentCharIsLetter = /[a-zA-Z]/.test(baseChar);
      } else {
        // 4. 处理空格 - 增强版：智能识别字母间空格
        if (char === ' ' || /\s/.test(char)) {
          // 检查前一个字符是否为字母
          const isPrevCharLetter = prevCharIsLetter;
          
          // 检查下一个字符是否为字母或特殊格式字母
          let isNextCharLetter = false;
          let j = i + 1;
          
          // 跳过所有连续的空格
          while (j < length && (text[j] === ' ' || /\s/.test(text[j]))) {
            j++;
          }
          
          // 检查下一个非空格字符是否为字母或特殊格式字母
          if (j < length) {
            const nextCodePoint = this.getCodePoint(text, j);
            const nextChar = String.fromCodePoint(nextCodePoint);
            
            // 检查是否为普通ASCII字母
            if (/[a-zA-Z]/.test(nextChar)) {
              isNextCharLetter = true;
            } else {
              // 检查是否为特殊格式字母
              for (const block of this.specialCharBlocks) {
                if (nextCodePoint >= block.range[0] && nextCodePoint <= block.range[1]) {
                  isNextCharLetter = true;
                  break;
                }
              }
            }
          }
          
          // 如果前一个字符和下一个字符都是字母，跳过这个空格
          if (isPrevCharLetter && isNextCharLetter) {
            skipSpace = true;
            i += 1;
            continue;
          }
          
          // 其他情况按普通空格处理
          result += ' ';
        } else {
          // 保留普通字符
          result += char;
          currentCharIsLetter = /[a-zA-Z]/.test(char);
        }
      }

      prevCharIsLetter = currentCharIsLetter && !skipSpace;
      skipSpace = false;
      i += codePoint > 0xFFFF ? 2 : 1;
    }

    // 5. 处理空格：合并多余空格并移除首尾空格
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }
}

class SocialTitleProcessor {
  constructor() {
    this.name = 'SocialTitleProcessor';
  }

  /**
   * 按 generatePageTitle 收尾的同一套规则过滤文本（v2.7.38，全项目唯一实现）
   *
   * 三步，顺序不能变：
   *   ① 删 emoji
   *   ② 压掉所有空白
   *   ③ 只留汉字 / 英文字母 / 数字 / 短横线 / 下划线，其余（标点、符号、日文假名、
   *      韩文、西里尔、泰文、阿拉伯文……）全删
   *
   * v2.7.42（用户 2026-11-01 拍板「下划线要保留，选 A」）：把 `_` 加进白名单。
   * 起因是微博超话帖：昵称列显示 `Gufei_GF`，标题里却被洗成 `GufeiGF` ——
   * 同一条记录两处对不上。下划线是账号名里最常见的合法字符（世界各地都是），
   * 不像标点那样属于「噪音」，所以和短横线同等对待。
   *
   * ⚠️ 这是「标题干净」的总闸，`generatePageTitle` 收尾、`wouldBeFilteredOut`
   * （昵称会不会被洗光）、`isBlankAfterTitleFilter`（文案会不会被洗光）三处都调它。
   * **不要再往任何地方复制这段正则**。
   *
   * @param {string} text
   * @returns {string} 过滤后的文本（可能为空串）
   */
  static filterTitleText(text) {
    let s = String(text == null ? '' : text);
    // 每次新建正则：带 g 标志的正则对象有 lastIndex 状态，复用容易出诡异结果
    s = s.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E0}-\u{1F1FF}]/gu, '');
    s = s.replace(/\s+/g, '');
    s = s.replace(/[^\u4e00-\u9fff0-9a-zA-Z_-]/g, '');
    return s;
  }

  /**
   * 这段文案按标题的过滤规则洗完之后，还剩下可读的字吗（v2.7.38）
   *
   * 用途只有一个：装配器据此判断「文案虽然不空，但拼进标题会被洗得一个字都不剩」，
   * 好让站名占位词顶上（用户 2026-11-01 拍板：纯 emoji / 纯标点 / 纯日韩俄泰文
   * 的文案，标题要用「Instagram帖子」这类站名，不能只剩「昵称-日期」）。
   *
   * 边界（用户已认可）：
   *   · 纯英文 / 法文 / 德文这类**拉丁字母**文案 → 保留，**不算**被洗光，标题正常；
   *   · 纯日文 / 韩文 / 俄文 / 泰文 / 阿拉伯文 → 白名单里没有，会被洗光 → 走站名。
   *
   * @param {string} text
   * @returns {boolean} true = 洗完之后一个字都不剩
   */
  static isBlankAfterTitleFilter(text) {
    return SocialTitleProcessor.filterTitleText(text) === '';
  }

  /**
   * 静态方法：生成社交媒体页面标题
   * @param {string} authorName - 作者昵称
   * @param {string} pageText - 页面文案内容
   * @param {string} publishDate - 发布时间
   * @param {Object} options - 处理选项
   * @returns {string} 生成的标题
   */
  static generatePageTitle(authorName, pageText, publishDate, options = {}, authorId = '') {
    const processor = new SocialTitleProcessor();
    return processor.generatePageTitle(authorName, pageText, publishDate, options, authorId);
  }

  /**
   * 生成社交媒体页面标题
   * @param {string} authorName - 作者昵称
   * @param {string} pageText - 页面文案内容
   * @param {string} publishDate - 发布时间
   * @param {Object} options - 处理选项
   * @param {string} authorId - 作者ID（用于当作者昵称为纯emoji时替补）
   * @returns {string} 生成的标题
   */
  generatePageTitle(authorName, pageText, publishDate, options = {}, authorId = '') {
    const {
      platform = 'default',
      enableSpecialCharConversion = true,
      maxTextLength = 20,
      dateFormat = 'YYYY年MM月DD日HHmmss'
    } = options;

    try {
      // 处理作者昵称
      const processedAuthor = this.processAuthorName(authorName, {
        platform,
        enableSpecialCharConversion
      }, authorId);

      // 处理文案内容
      //
      // v2.6.1：先把话题井号洗干净，再截「前 20 字」。
      // 原因：标题最后那条 `replace(/[^\u4e00-\u9fff0-9a-zA-Z_-]/g, '')` 会**保留汉字**，
      // 所以小红书的 `#vlog[话题]#` 会变成 `vlog话题` —— 井号和方括号没了，「话题」二字却留着，
      // 而这两个字根本不是作者写的。先洗文案，标题自然干净，截取的前 20 字也才是用户真正写的内容。
      let sourceText = pageText;
      if (typeof SocialHashtagCleaner !== 'undefined') {
        try {
          sourceText = SocialHashtagCleaner.strip(pageText);
        } catch (e) {
          sourceText = pageText;   // 洗失败就用原文，别让标题功能整个废掉
        }
      }

      const processedText = this.processPageText(sourceText, {
        authorName: processedAuthor,
        platform,
        maxLength: maxTextLength,
        enableSpecialCharConversion
      });

      // 格式化发布时间
      const formattedTime = this.formatPublishTime(publishDate, {
        format: dateFormat,
        platform
      });

      // 组合标题
      let combinedTitle = this.combineTitleParts(processedAuthor, processedText, formattedTime, {
        platform
      });

      // 步骤6：最终处理
    // 6.1 智能去重：移除文案中与作者昵称重复的字符
    if (processedAuthor && processedAuthor !== '未获取到作者' && combinedTitle.includes(processedAuthor)) {
      // 找到作者名的起始位置，只移除重复的部分
      const authorIndex = combinedTitle.indexOf(processedAuthor);
      if (authorIndex === 0) {
        // 如果作者名在开头，检查下一个出现的位置
        const nextIndex = combinedTitle.indexOf(processedAuthor, authorIndex + processedAuthor.length);
        if (nextIndex > 0) {
          // 移除从nextIndex开始的作者名
          combinedTitle = combinedTitle.slice(0, nextIndex) + combinedTitle.slice(nextIndex + processedAuthor.length);
        }
      }
    }

    // 6.2 特殊字符转换：将特殊格式字符转换为标准ASCII字符
    combinedTitle = SpecialCharConverter.convertToNormal(combinedTitle);

    // 6.3 过滤emoji、多余空白、各种标点符号
    //
    // v2.7.38：抽成 `filterTitleText()`。因为这**同一套规则**现在还多了一个用途 ——
    // 判断「文案虽然不空，但洗完之后一个字都不剩」（纯 emoji / 纯标点 / 纯日韩俄泰文），
    // 那种情况要让站名占位词顶上标题（用户 2026-11-01 拍板）。
    // 规则只能有一份：两处各写一份，以后改一处漏一处，标题和判定就会打架。
    combinedTitle = SocialTitleProcessor.filterTitleText(combinedTitle);

      return combinedTitle;

    } catch (error) {
      console.error(`[${this.name}] 生成标题失败:`, error);
      return this.generateFallbackTitle(authorName, pageText, publishDate);
    }
  }

  /**
   * 检测作者昵称是否会被后续过滤规则过滤掉
   * @param {string} authorName - 作者昵称
   * @param {Object} options - 处理选项
   * @returns {boolean} 是否会被过滤掉
   */
  wouldBeFilteredOut(authorName, options = {}) {
    const { enableSpecialCharConversion = true } = options;
    
    // 模拟标题生成中的过滤过程
    let testAuthor = String(authorName == null ? '' : authorName).trim();
    
    // 应用特殊字符转换
    if (enableSpecialCharConversion) {
      testAuthor = SpecialCharConverter.convertToNormal(testAuthor);
    }
    
    // v2.7.38：删 emoji / 压空白 / 白名单过滤这三步统一交给 filterTitleText，
    // 不再在这里复制第二份正则 —— 标题过滤规则全项目只许有一份实现。
    return SocialTitleProcessor.filterTitleText(testAuthor) === '';
  }

  /**
   * 处理作者昵称
   * @param {string} authorName - 原始作者昵称
   * @param {Object} options - 处理选项
   * @param {string} authorId - 作者ID（用于当作者昵称为纯emoji时替补）
   * @returns {string} 处理后的作者昵称
   */
  processAuthorName(authorName, options = {}, authorId = '') {
    if (!authorName || authorName === '') {
      return authorId ? authorId : '未获取到作者';
    }

    // 检测作者昵称是否会被后续过滤规则过滤掉
    const authorNameTrimmed = authorName.trim();
    if (this.wouldBeFilteredOut(authorNameTrimmed, options) && authorId) {
      // 如果会被过滤且有作者ID，则使用作者ID替代
      return authorId;
    }

    // 保持原始状态，仅去除前后空格
    return authorNameTrimmed;
  }

  /**
   * 处理页面文案
   * @param {string} pageText - 原始文案内容
   * @param {Object} options - 处理选项
   * @returns {string} 处理后的文案
   */
  processPageText(pageText, options = {}) {
    // 检查是否为空，为空则返回"无文案"
    if (!pageText || pageText === '') {
      return '无文案';
    }

    // 不为空则截取最多20个字符，忽略options中的设置
    let processedText = pageText.trim();
    // 移除文案中的"-"符号，避免与发布时间前的"-"符号重复
    processedText = processedText.replace(/-/g, '');
    return processedText.length > 20 ? processedText.slice(0, 20) : processedText;
  }

  /**
   * 通用的文本清理规则
   * @param {string} text - 要清理的文本
   * @param {string} platform - 平台名称
   * @returns {string} 清理后的文本
   */
  applyCommonTextCleaning(text, platform = 'default') {
    let cleanedText = text;

    // 保留发布信息（如"于20250406发布在抖音"），不移除
    // 只移除纯数字的发布信息，保留带汉字的发布信息
    cleanedText = cleanedText.replace(/于\d{8}发布(?!在)/g, '');

    // 移除#标签
    cleanedText = cleanedText.replace(/#[^#\s]+/g, '');

    // 移除@提及
    cleanedText = cleanedText.replace(/@[^\s@]+/g, '');

    // 移除emoji表情
    cleanedText = cleanedText.replace(/[\p{Emoji}]/gu, '');

    // 标准化空白字符
    cleanedText = cleanedText.replace(/\s+/g, '').trim();

    return cleanedText;
  }

  /**
   * 增强的字符过滤规则（合并抖音等平台规则）
   * @param {string} text - 要过滤的文本
   * @param {string} platform - 平台名称
   * @param {Object} options - 过滤选项
   * @returns {string} 过滤后的文本
   */
  applyEnhancedCharacterFiltering(text, platform = 'default', options = {}) {
    const { 
      removePlatformMarks = true,
      removeUrls = true,
      maxLength = null,
      preserveNewlines = false 
    } = options;

    let filteredText = text;

    // 1. 平台特定的标记移除
    if (removePlatformMarks) {
      // 抖音特定标记（只移除营销性质的标记，保留"发布在抖音"）
      if (platform === 'douyin') {
        filteredText = filteredText.replace(/抖音-记录美好生活/g, '');
        filteredText = filteredText.replace(/douyin\.com/g, '');
        filteredText = filteredText.replace(/记录美好生活/g, ''); // 只移除营销标记
      }
      
      // 通用社交媒体标记
      filteredText = filteredText.replace(/分享生活/g, '');
    }

    // 2. URL移除
    if (removeUrls) {
      filteredText = filteredText.replace(/https?:\/\/[^\s]+/g, '');
      filteredText = filteredText.replace(/www\.[^\s]+/g, '');
    }

    // 3. 标准化空白字符
    if (preserveNewlines) {
      // 保留换行符，只压缩其他空白字符
      filteredText = filteredText.replace(/[ \t\r]+/g, ' ');
      filteredText = filteredText.replace(/\n\s*/g, '\n');
    } else {
      // 完全标准化空白字符
      filteredText = filteredText.replace(/\s+/g, ' ');
    }

    // 4. 长度截取
    if (maxLength && filteredText.length > maxLength) {
      filteredText = filteredText.substring(0, maxLength) + '...';
    }

    return filteredText.trim();
  }

  /**
   * 判断源日期文字里「时间精度到哪一档」
   *
   * v2.5.78 起，标题尾部的日期精度**由源数据自己决定**，不再按平台写死：
   * 以前抖音视频固定 `HHmm`、图文固定 `HHmmss`，源里没有时分秒时就补 `0000`，
   * 于是弹窗页的标题尾巴长出 `-2026年10月19日0000` 这种假时间。
   *
   * @param {string} text 源日期文字
   * @returns {string} `'HHmmss'`（到秒）/ `'HHmm'`（到分）/ `''`（只有日）
   */
  detectTimePrecision(text) {
    const src = String(text || '');
    if (!src) return '';

    // ISO 8601（含 T 和 Z）：天生到秒
    if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(src)) return 'HHmmss';

    // 年月日之后紧跟的 时分[秒]
    const withTime = src.match(
      /(\d{4})\s*[-\/.年]\s*\d{1,2}\s*[-\/.月]\s*\d{1,2}\s*日?\s*[T\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/
    );
    if (withTime) return withTime[4] !== undefined ? 'HHmmss' : 'HHmm';

    // 只有年月日
    if (/(\d{4})\s*[-\/.年]\s*\d{1,2}\s*[-\/.月]\s*\d{1,2}/.test(src)) return '';

    return '';
  }

  /**
   * 格式化发布时间
   * @param {string} publishDate - 原始发布时间
   * @param {Object} options - 历史参数（platform / format），保留兼容，**不再决定精度**
   * @returns {string} 格式化后的时间
   */
  formatPublishTime(publishDate, options = {}) {
    if (!publishDate || typeof publishDate !== 'string') {
      return '未获取到';
    }

    // 移除可能的前缀
    let pureTime = publishDate.replace(/^发布时间[：:]\s*/, '').trim();
    if (!pureTime) {
      return '未获取到';
    }

    try {
      // v2.5.78：精度照抄源 —— 到秒 `HHmmss`、到分 `HHmm`、只有日 `''`
      // 下面原有的「补 00」分支因为有 timeFormat 在场会自然跳过：
      // timeFormat 里没有 'ss' 就不会补秒，是空串就直接只输出日期。
      const timeFormat = this.detectTimePrecision(pureTime);

      // 尝试多种日期格式解析
      const datePatterns = [
        // ISO 8601格式（Twitter等平台使用）
        /(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.\d+)?Z/,
        
        // 带完整时间的格式（时:分:秒）
        /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/,
        /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/,
        /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/,
        /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/,
        
        // 带时间的格式（时:分）
        /(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{1,2})/,
        /(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2})/,
        /(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})/,
        /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{1,2})/,
        
        // 标准日期格式
        /(\d{4})-(\d{1,2})-(\d{1,2})/,
        /(\d{4})\.(\d{1,2})\.(\d{1,2})/,
        /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
        /(\d{4})年(\d{1,2})月(\d{1,2})日/
      ];

      for (const pattern of datePatterns) {
        const match = pureTime.match(pattern);
        if (match) {
          const year = parseInt(match[1], 10);
          const month = parseInt(match[2], 10);
          const day = parseInt(match[3], 10);

          // 日期有效性验证
          if (!this.isValidDate(year, month, day)) {
            continue;
          }

          // 根据格式要求返回结果
          const formattedDate = `${year}年${month.toString().padStart(2, '0')}月${day.toString().padStart(2, '0')}日`;

          // 如果平台不需要显示时间，直接返回日期
          if (timeFormat === '') {
            return formattedDate;
          }

          // 检查是否有时间部分
          if (match.length > 6 && match[4] && match[5] && match[6]) {
            let hour = parseInt(match[4], 10);
            const minute = parseInt(match[5], 10);
            const second = parseInt(match[6], 10);

            // 时区处理：只有真正的ISO 8601格式（包含T和Z）才需要转换为北京时间（UTC+8）
            // 使用正则表达式严格匹配ISO 8601格式，避免误判
            if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/.test(pureTime)) {
              hour += 8;
              // 处理跨天的情况
              if (hour >= 24) {
                hour -= 24;
                // 这里简化处理，不考虑跨月和跨年的情况，实际应用中可能需要更复杂的日期计算
              }
            }

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
              // 根据平台配置格式化时间
              let formattedTime = '';
              if (timeFormat.includes('HH')) {
                formattedTime += hour.toString().padStart(2, '0');
              }
              if (timeFormat.includes('mm')) {
                formattedTime += minute.toString().padStart(2, '0');
              }
              if (timeFormat.includes('ss')) {
                formattedTime += second.toString().padStart(2, '0');
              }
              return formattedDate + formattedTime;
            }
          } else if (match.length > 4 && match[4] && match[5]) {
            let hour = parseInt(match[4], 10);
            const minute = parseInt(match[5], 10);

            // 时区处理：只有真正的ISO 8601格式（包含T和Z）才需要转换为北京时间（UTC+8）
            // 使用正则表达式严格匹配ISO 8601格式，避免误判
            if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/.test(pureTime)) {
              hour += 8;
              // 处理跨天的情况
              if (hour >= 24) {
                hour -= 24;
              }
            }

            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
              // 根据平台配置格式化时间
              let formattedTime = '';
              if (timeFormat.includes('HH')) {
                formattedTime += hour.toString().padStart(2, '0');
              }
              if (timeFormat.includes('mm')) {
                formattedTime += minute.toString().padStart(2, '0');
              }
              if (timeFormat.includes('ss')) {
                formattedTime += '00'; // 没有秒数据时补00
              }
              return formattedDate + formattedTime;
            }
          } else {
            // 没有时间部分，根据平台配置决定是否添加时间
            if (timeFormat === '') {
              // 对于配置了不显示时间的平台，直接返回日期
              return formattedDate;
            } else {
              // 没有时间数据时，补全00
              let formattedTime = '';
              if (timeFormat.includes('HH')) {
                formattedTime += '00';
              }
              if (timeFormat.includes('mm')) {
                formattedTime += '00';
              }
              if (timeFormat.includes('ss')) {
                formattedTime += '00';
              }
              return formattedDate + formattedTime;
            }
          }
        }
      }

      // 如果无法解析，返回原文本
      return pureTime;
    } catch (error) {
      console.error(`[${this.name}] 格式化发布时间失败:`, error);
      return '未获取到';
    }
  }

  /**
   * 组合标题部分
   * @param {string} authorName - 作者昵称
   * @param {string} pageText - 页面文案
   * @param {string} publishTime - 发布时间
   * @param {Object} options - 组合选项
   * @returns {string} 组合后的标题
   */
  combineTitleParts(authorName, pageText, publishTime, options = {}) {
    const { platform = 'default' } = options;
    const titleParts = [];

    // 添加作者名（包括"未获取到作者"）
    if (authorName && authorName !== '') {
      titleParts.push(authorName);
    }

    // 添加文案内容
    if (pageText !== '未获取到' && pageText !== '') {
      titleParts.push(pageText);
    } else if (pageText === '未获取到') {
      titleParts.push('未获取到文案');
    }

    // 添加分隔符和时间
    if (publishTime !== '未获取到' && publishTime !== '未获取到时间') {
      titleParts.push('-');
      titleParts.push(publishTime);
    }

    return titleParts.join('');
  }

  /**
   * 生成备用标题（当主流程失败时）
   * @param {string} authorName - 作者昵称
   * @param {string} pageText - 页面文案
   * @param {string} publishDate - 发布时间
   * @returns {string} 备用标题
   */
  generateFallbackTitle(authorName, pageText, publishDate) {
    const parts = [];
    
    if (authorName && authorName !== '未获取到作者') {
      parts.push(authorName);
    }
    
    if (pageText && pageText !== '未获取到') {
      const cleanText = pageText.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 10);
      parts.push(cleanText || '无内容');
    }
    
    if (publishDate && publishDate !== '未获取到') {
      parts.push(publishDate.slice(0, 10));
    }
    
    return parts.join('-') || '社交媒体内容';
  }

  /**
   * 验证日期有效性
   * @param {number} year - 年份
   * @param {number} month - 月份
   * @param {number} day - 日期
   * @returns {boolean} 是否有效
   */
  isValidDate(year, month, day) {
    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    
    // 闰年判断
    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    if (isLeapYear) {
      daysInMonth[1] = 29;
    }

    return day <= daysInMonth[month - 1];
  }

  /**
   * 获取平台特定的处理配置
   * @param {string} platform - 平台名称
   * @returns {Object} 平台配置
   */
  getPlatformConfig(platform) {
    const configs = {
      douyin: {
        enableSpecialCharConversion: false,  // 抖音保持原始字符
        maxTextLength: 10,
        dateFormat: 'YYYY年MM月DD日HHmmss'
      },
      kuaishou: {
        enableSpecialCharConversion: true,
        maxTextLength: 10,
        dateFormat: 'YYYY年MM月DD日HHmmss'
      },
      xiaohongshu: {
        enableSpecialCharConversion: true,
        maxTextLength: 10,
        dateFormat: 'YYYY年MM月DD日HHmmss'
      },
      default: {
        enableSpecialCharConversion: true,
        maxTextLength: 10,
        dateFormat: 'YYYY年MM月DD日HHmmss'
      }
    };

    return configs[platform] || configs.default;
  }
}

// 导出处理器实例
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SocialTitleProcessor,
    SpecialCharConverter
  };
} else {
  window.SocialTitleProcessor = SocialTitleProcessor;
  window.SpecialCharConverter = SpecialCharConverter;
}