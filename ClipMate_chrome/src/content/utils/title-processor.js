// 书名智能处理系统
class TitleProcessor {
  constructor() {
    this.conversionCache = new Map();
  }

  async processBookTitle(originalTitle, originalName = '') {
    if (!originalTitle) return { title: '' };

    const cacheKey = `${originalTitle}|${originalName}`;
    if (this.conversionCache.has(cacheKey)) {
      return this.conversionCache.get(cacheKey);
    }

    try {
      let processedTitle = originalTitle.trim();

      // 步骤1: 清理标题
      processedTitle = this.cleanTitle(processedTitle);

      // 步骤2: 处理卷数和部数信息
      const volumeResult = this.processVolumeInfo(processedTitle);
      processedTitle = volumeResult.title;

      // 步骤3: 标准化格式
      processedTitle = this.standardizeFormat(processedTitle);

      const result = {
        title: processedTitle
      };

      this.conversionCache.set(cacheKey, result);
      return result;

    } catch (error) {
      console.error('处理书名失败:', error);
      return {
        title: originalTitle
      };
    }
  }

  cleanTitle(title) {
    if (!title) return '';

    // 移除多余的空白字符
    title = title.replace(/\s+/g, ' ').trim();

    // 移除特殊符号前后的空格
    title = title.replace(/\s*([：:;；,，！!？?])\s*/g, '$1');

    // 移除不必要的标点符号
    title = title.replace(/[\u200b\u200c\u200d\ufeff]/g, '');

    // 处理书名中的括号
    title = this.processBrackets(title);

    return title;
  }

  processBrackets(title) {
    // 保留有用的括号内容，移除广告性质的
    const usefulPatterns = [
      /[（(](?:第[一二三四五六七八九十]+卷|[Vv]ol\.?\d+|[Bb]ook\s*\d+)[）)]/,
      /[（(](?:[上下]册|[全共]\d+册)[）)]/,
      /[（(](?:[修订增订校注译白话图文]版?)[）)]/,
      /[（(](?:[精装平装珍藏纪念]版?)[）)]/
    ];

    // 移除广告性质的括号内容
    const adPatterns = [
      /[（(](?:热销|畅销|推荐|新品|特价|优惠|限时)[^）)]*[）)]/,
      /[（(](?:送|赠|包邮|免邮)[^）)]*[）)]/,
      /[（(](?:\d+折|满\d+减\d+)[^）)]*[）)]/
    ];

    let result = title;

    // 先移除广告内容
    adPatterns.forEach(pattern => {
      result = result.replace(pattern, '');
    });

    // 清理多余的空格
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  // 繁简转换相关方法已移除



  processVolumeInfo(title) {
    let processedTitle = title;

    // 提取卷数信息
    const volumePatterns = [
      /[（(](?:第)?\s*(\d+)\s*[卷卷册册][）)]/,
      /[（(][Vv]ol\.?\s*(\d+)[）)]/,
      /[（(][Bb]ook\s*(\d+)[）)]/,
      /\s+(?:第)?\s*(\d+)\s*[卷卷册册]$/,
      /\s+[Vv]ol\.?\s*(\d+)$/
    ];

    for (const pattern of volumePatterns) {
      const match = processedTitle.match(pattern);
      if (match) {
        processedTitle = processedTitle.replace(pattern, '').trim();
        break;
      }
    }

    // 提取部数信息
    const partPatterns = [
      /[（(](?:第)?\s*([一二三四五六七八九十])\s*部[）)]/,
      /[（(][Pp]art\s*([一二三四五六七八九十\d]+)[）)]/,
      /\s+(?:第)?\s*([一二三四五六七八九十])\s*部$/
    ];

    for (const pattern of partPatterns) {
      const match = processedTitle.match(pattern);
      if (match) {
        processedTitle = processedTitle.replace(pattern, '').trim();
        break;
      }
    }

    return {
      title: processedTitle
    };
  }

  standardizeFormat(title) {
    if (!title) return '';

    // 统一标点符号
    title = title.replace(/[：:]/g, '：');
    title = title.replace(/[;；]/g, '；');
    title = title.replace(/[,，]/g, '，');
    title = title.replace(/[（(]/g, '（');
    title = title.replace(/[）)]/g, '）');

    // 移除多余的空格
    title = title.replace(/\s+/g, ' ').trim();

    // 确保书名格式一致
    title = this.ensureProperFormatting(title);

    return title;
  }

  ensureProperFormatting(title) {
    // 确保主标题和副标题之间的格式
    const colonIndex = title.indexOf('：');
    if (colonIndex > 0) {
      const mainTitle = title.substring(0, colonIndex).trim();
      const subTitle = title.substring(colonIndex + 1).trim();
      return `${mainTitle}：${subTitle}`;
    }

    return title;
  }

  // 处理系列作品
  processSeriesTitle(title, seriesInfo) {
    if (!seriesInfo) return title;

    // 检查是否是系列作品
    const seriesPatterns = [
      /^(.*?)系列[:：]/,
      /^(.*?)三部曲[:：]/,
      /^(.*?)丛书[:：]/
    ];

    for (const pattern of seriesPatterns) {
      const match = title.match(pattern);
      if (match) {
        const seriesName = match[1];
        const bookTitle = title.substring(match[0].length).trim();
        
        return {
          series: seriesName,
          title: bookTitle,
          fullTitle: title
        };
      }
    }

    return { title };
  }

  // 生成标准书名格式
  generateStandardTitle(author, title, subtitle = '', volume = '') {
    let standardTitle = '';
    
    if (author) {
      standardTitle += `${author}《`;
    } else {
      standardTitle += '《';
    }
    
    standardTitle += title;
    
    if (subtitle) {
      standardTitle += `：${subtitle}`;
    }
    
    standardTitle += '》';
    
    if (volume) {
      standardTitle += `（${volume}）`;
    }
    
    return standardTitle;
  }

  // 清理缓存
  clearCache() {
    this.conversionCache.clear();
  }

  // 获取缓存大小
  getCacheSize() {
    return this.conversionCache.size;
  }
}

// 导出书名处理器
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TitleProcessor;
} else {
  window.TitleProcessor = TitleProcessor;
}