/**
 * 番茄小说网（fanqienovel.com）书籍提取器
 *
 * 数据策略：
 * - 大多数字段从详情页的 window.__INITIAL_STATE__.page 中提取
 * - 发布日期需要后台抓取第一章页面，从 JSON-LD 的 dateModified 字段获取
 */
class FanqieBookExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'fanqie';
    this.mediaType = 'book';
    this.isSocialPlatform = false;
    this._pageData = null;    // 缓存 __INITIAL_STATE__.page
    this._firstChapterUrl = null; // 第一章 URL
  }

  /**
   * 从页面读取 __INITIAL_STATE__ 数据
   */
  _getPageData() {
    if (this._pageData) return this._pageData;
    try {
      const script = document.querySelector('script');
      // 遍历寻找包含 __INITIAL_STATE__ 的 script 标签
      const allScripts = document.querySelectorAll('script');
      for (const s of allScripts) {
        if (s.textContent && s.textContent.includes('__INITIAL_STATE__')) {
          const match = s.textContent.match(/window\.__INITIAL_STATE__=({.*?});/s);
          if (match) {
            const state = JSON.parse(match[1]);
            this._pageData = state.page || {};
            return this._pageData;
          }
        }
      }
    } catch (e) {
      console.warn('[FanqieBookExtractor] 解析 __INITIAL_STATE__ 失败:', e.message);
    }
    return {};
  }

  /**
   * 获取第一章的 URL（从章节列表中取第一个）
   */
  _getFirstChapterUrl() {
    if (this._firstChapterUrl) return this._firstChapterUrl;
    const page = this._getPageData();
    
    // chapterListWithVolume 格式：[[{章}, {章}...], [{章}...]]
    // 外层数组每个元素是一个卷（volumes），内层数组是章节列表
    if (page.chapterListWithVolume && page.chapterListWithVolume.length > 0) {
      for (const volume of page.chapterListWithVolume) {
        if (Array.isArray(volume) && volume.length > 0) {
          const firstId = volume[0].itemId;
          if (firstId) {
            this._firstChapterUrl = `https://fanqienovel.com/reader/${firstId}`;
            return this._firstChapterUrl;
          }
        }
      }
    }
    // 兜底：chapterList（直接列表）
    if (page.chapterList && Array.isArray(page.chapterList) && page.chapterList.length > 0) {
      const firstId = page.chapterList[0].itemId;
      if (firstId) {
        this._firstChapterUrl = `https://fanqienovel.com/reader/${firstId}`;
        return this._firstChapterUrl;
      }
    }
    console.warn('[FanqieBookExtractor] 无法获取第一章URL');
    return null;
  }

  /**
   * 格式化数字：1023115 → "102.3万"
   */
  _formatReadCount(num) {
    if (!num) return '';
    const n = parseInt(num);
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  }

  /**
   * 格式化字数：1023115 → "102.3万字"
   */
  _formatWordCount(num) {
    if (!num) return '';
    const n = parseInt(num);
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万字';
    return n + '字';
  }

  /**
   * 将 ISO 日期转为 YYYY/MM/DD
   */
  _formatISODate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${day}`;
    } catch (e) {
      return '';
    }
  }

  // ====== 各字段提取方法 ======

  extractBookName() {
    const page = this._getPageData();
    if (page.bookName) return page.bookName.trim();
    // 兜底：从 h1 获取
    try {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractAuthor() {
    const page = this._getPageData();
    if (page.authorName) return page.authorName.trim();
    if (page.author) return page.author.trim();
    // 兜底：从 JSON-LD 获取
    try {
      const ldScript = document.querySelector('script[type="application/ld+json"]');
      if (ldScript) {
        const ld = JSON.parse(ldScript.textContent);
        if (ld.author && ld.author[0] && ld.author[0].name) {
          return ld.author[0].name.trim();
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractWordCount() {
    const page = this._getPageData();
    if (page.wordNumber) {
      return this._formatWordCount(page.wordNumber);
    }
    // 兜底：从 DOM 获取
    try {
      const el = document.querySelector('.info-count-word .detail');
      if (el) {
        const unit = document.querySelector('.info-count-word .text');
        const text = el.textContent.trim();
        const unitText = unit ? unit.textContent.trim() : '字';
        return text + unitText;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractDescription() {
    const page = this._getPageData();
    if (page.abstract) return page.abstract.trim();
    // 兜底：从 meta description 获取
    try {
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.content) return meta.content.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractOtherInfo() {
    const parts = [];
    const page = this._getPageData();

    // 状态
    parts.push(page.creationStatus === 2 ? '已完结' : '连载中');

    // 分类
    if (page.categoryV2) {
      try {
        const cats = typeof page.categoryV2 === 'string' ? JSON.parse(page.categoryV2) : page.categoryV2;
        const mainCat = cats.find(c => c.Dim === 10) || cats[0];
        if (mainCat && mainCat.Name) {
          parts.push(`分类：${mainCat.Name}`);
        }
      } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    }

    // 章节数
    if (page.chapterTotal) {
      parts.push(`${page.chapterTotal}章`);
    }

    // 阅读量
    if (page.readCount) {
      parts.push(`阅读：${this._formatReadCount(page.readCount)}`);
    }

    return parts.join('，');
  }

  extractUrl() {
    try {
      const url = new URL(window.location.href);
      // 只保留 protocol + host + pathname，去掉 query 参数
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch (e) {
      return window.location.href;
    }
  }

  /**
   * 异步获取发布日期：后台抓取第一章页面，提取 JSON-LD 中的 dateModified
   */
  async extractPublishDate() {
    const chapterUrl = this._getFirstChapterUrl();
    if (!chapterUrl) {
      console.warn('[FanqieBookExtractor] 无第一章URL，无法获取发布日期');
      return '';
    }

    try {
      const result = await WBR.runtime.sendMessage({
        action: 'fetchChapterPage',
        url: chapterUrl
      });

      if (!result || !result.html) {
        console.warn('[FanqieBookExtractor] 后台返回空结果');
        return '';
      }


      // 从 HTML 中提取 dateModified
      const dateMatch = result.html.match(/"dateModified"\s*:\s*"([^"]+)"/);
      if (dateMatch && dateMatch[1]) {
        const date = this._formatISODate(dateMatch[1]);
        return date;
      }

      // 兜底：提取 Baidu schema 中的 upDate
      const upMatch = result.html.match(/"upDate"\s*:\s*"([^"]+)"/);
      if (upMatch && upMatch[1]) {
        const date = this._formatISODate(upMatch[1]);
        return date;
      }

      console.warn('[FanqieBookExtractor] HTML中未找到日期字段');
      return '';
    } catch (e) {
      console.warn('[FanqieBookExtractor] 获取发布日期失败:', e.message);
      return '';
    }
  }

  // ====== 聚合方法 ======

  async extractAllFields() {
    try {
      const fields = {
        '书名': this.extractBookName(),
        '别名': '',
        '作者': this.extractAuthor(),
        '国家': '中国',
        '原作名': '',
        '发布日期': await this.extractPublishDate(),
        '简介': this.extractDescription(),
        '网络评分': '',
        '豆瓣链接': '',
        'URL': this.extractUrl(),
        'ISBN': '',
        '篇幅': this.extractWordCount(),
        '其他信息': this.extractOtherInfo()
      };
      return fields;
    } catch (error) {
      console.error('[FanqieBookExtractor] 提取所有字段失败:', error);
      return {
        '书名': '',
        '别名': '',
        '作者': '',
        '国家': '中国',
        '原作名': '',
        '发布日期': '',
        '简介': '',
        '网络评分': '',
        '豆瓣链接': '',
        'URL': window.location.href,
        'ISBN': '',
        '篇幅': '',
        '其他信息': ''
      };
    }
  }
}

window.FanqieBookExtractor = FanqieBookExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['fanqie'] = FanqieBookExtractor;
window.domainExtractorMap = window.domainExtractorMap || {};
window.domainExtractorMap['fanqienovel.com'] = FanqieBookExtractor;
