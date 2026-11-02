/**
 * 17K小说网（17k.com）书籍提取器
 *
 * 数据策略（全部从详情页 DOM / meta 取，不读页面 JS 变量）：
 * - 书名 / 作者：主来源是 og:title（形如《书名》作者著-17K小说网）。
 *   注意 document.title 是「书名_作者_书名最新章节_在线阅读-17K小说网」，
 *   **里面没有《》**，所以不能像豆瓣那样从 document.title 抠书名。
 *   详情页正文里也没有作者链接（实测作者名只出现在 title / meta），
 *   因此作者同样以 og:title 为主，meta description 兜底。
 * - 简介：读 #bookInfo p.intro，按 <br> 切行。
 *   **不能读 og:description**：它把换行编码成字面 "&lt;br&gt;"，
 *   浏览器解码后就是字符串 "<br>"，会直接混进正文（Chrome 版的老问题）。
 * - 发布日期：后台抓章节列表页（/list/<id>.html），取全页最早的一条「更新日期」，
 *   也就是第一章的发布时间。
 * - 状态 / 类别 / 标签：在详情页「作品信息」页签里（style="display:none" 但仍在 DOM）。
 */
class Book17kExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = '17k';
    this.mediaType = 'book';
    this.isSocialPlatform = false;
    this._chapterHtml = null;
  }

  // ====== 格式化 / 通用工具 ======

  /**
   * 格式化字数：19280962 → "1928.1万字"
   */
  _formatWordCount(num) {
    if (!num) return '';
    const n = parseInt(num, 10);
    if (!n) return '';
    if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万字';
    return n + '字';
  }

  /**
   * 将 "2022-03-24" 转为 "2022/03/24"（只认完整年月日，缺一不可）
   */
  _formatDate(dateStr) {
    if (!dateStr) return '';
    const m = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return '';
    return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  }

  /**
   * 取元素文本，把 <br> 当换行，逐行 trim 后丢掉空行。
   * 简介必须走这里：textContent 遇 <br> 不出换行，整段会粘成一坨。
   */
  _textWithBreaks(el) {
    if (!el) return '';
    try {
      const clone = el.cloneNode(true);
      const brs = clone.querySelectorAll('br');
      for (let i = 0; i < brs.length; i++) {
        const br = brs[i];
        if (br.parentNode) {
          br.parentNode.replaceChild(document.createTextNode('\n'), br);
        }
      }
      return String(clone.textContent || '')
        .split('\n')
        .map((line) => line.replace(/[\s\u3000]+/g, ' ').trim())
        .filter((line) => line.length > 0)
        .join('\n');
    } catch (e) {
      return '';
    }
  }

  /**
   * 把任意文本按换行整理成简介格式（用于 meta 兜底，里面的换行是字面 &lt;br&gt;）
   */
  _normalizeIntroText(text) {
    return String(text || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .split('\n')
      .map((line) => line.replace(/[\s\u3000]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }

  _getMeta(selector) {
    try {
      const meta = document.querySelector(selector);
      return meta && meta.content ? String(meta.content).trim() : '';
    } catch (e) {
      return '';
    }
  }

  /** 在 #bookInfo 的表格行里按 <th> 文案找右边的 <td> */
  _getInfoCellByLabel(labelText) {
    try {
      const scope = document.querySelector('#bookInfo') || document;
      const rows = scope.querySelectorAll('tr');
      for (let i = 0; i < rows.length; i++) {
        const th = rows[i].querySelector('th');
        if (th && th.textContent.replace(/\s+/g, '').indexOf(labelText) !== -1) {
          return rows[i].querySelector('td');
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return null;
  }

  // ====== 各字段提取 ======

  /**
   * 书名：og:title 的《》内 → h1 链接 → document.title 第一段
   */
  extractBookName() {
    try {
      const og = this._getMeta('meta[property="og:title"]');
      const ogMatch = og.match(/《(.+?)》/);
      if (ogMatch && ogMatch[1].trim()) return ogMatch[1].trim();

      const h1a = document.querySelector('.Info h1 a') || document.querySelector('h1 a');
      if (h1a && h1a.textContent.trim()) return h1a.textContent.trim();

      const titleMatch = document.title.match(/《(.+?)》/);
      if (titleMatch && titleMatch[1].trim()) return titleMatch[1].trim();

      // 最兜底：document.title 是「书名_作者_…」，取第一段
      const firstSegment = String(document.title || '').split('_')[0].trim();
      return firstSegment || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 作者：og:title 的《》与「著」之间 → meta description「由作家X所著」→ title 第二段
   */
  extractAuthor() {
    try {
      const og = this._getMeta('meta[property="og:title"]');
      const ogMatch = og.match(/》(.+?)著/);
      if (ogMatch && ogMatch[1].trim()) return ogMatch[1].trim();

      const desc = this._getMeta('meta[name="description"]');
      const descMatch = desc.match(/由作家(.+?)所著/);
      if (descMatch && descMatch[1].trim()) return descMatch[1].trim();

      const parts = String(document.title || '').split('_');
      if (parts.length > 1 && parts[1].trim()) return parts[1].trim();

      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：#bookInfo p.intro（按 <br> 切行）→ og:description（清掉字面 <br>）
   */
  extractDescription() {
    try {
      const intro = document.querySelector('#bookInfo p.intro') || document.querySelector('p.intro');
      const fromDom = this._textWithBreaks(intro);
      if (fromDom) return fromDom;

      const og = this._getMeta('meta[property="og:description"]');
      return this._normalizeIntroText(og);
    } catch (e) {
      return '';
    }
  }

  /**
   * 篇幅：.BookData em.red（「已写 N 字」）→ 全页 em.red
   */
  extractWordCount() {
    try {
      const em =
        document.querySelector('.BookData em.red') ||
        document.querySelector('#bookInfo').parentNode.querySelector('em.red') ||
        document.querySelector('em.red');
      if (em) {
        const num = em.textContent.replace(/[,\s]/g, '').trim();
        if (/^\d+$/.test(num)) return this._formatWordCount(num);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 状态：页面出现「此书已完成」→ 完本，否则连载中
   * （沿用 Chrome 版判定，实测样本 100% 正确）
   */
  extractStatus() {
    try {
      const bodyText = document.body ? (document.body.textContent || '') : '';
      if (bodyText.indexOf('此书已完成') !== -1) return '完本';
      return '连载中';
    } catch (e) {
      return '';
    }
  }

  /**
   * 类别：「作品类别：」右边单元格里的链接文本（DOM 优先，正则兜底）
   */
  extractCategory() {
    try {
      const cell = this._getInfoCellByLabel('作品类别');
      if (cell) {
        const a = cell.querySelector('a');
        const text = (a ? a.textContent : cell.textContent).trim();
        if (text) return text;
      }

      // 兜底：老版本靠整页 HTML 正则，页面结构大变时还能用
      // v2.5.71：范围从「整页 documentElement」收到「书籍信息区」。
      // 整页文字含有内联脚本、推荐位、评论区，`作品类别：` 后面紧跟的东西未必是类别；
      // 而这段兜底的本意只是「th/td 结构变形时还认得出」，不需要也不该看全页。
      const scope = document.querySelector('#bookInfo') || document.querySelector('.Info');
      const html = scope ? (scope.textContent || '') : '';
      if (html) {
        const m = html.match(/作品类别[：:]\s*([^\n]{1,20})/);
        if (m && m[1].trim()) return m[1].trim();
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 标签：#bookInfo 里 tr.label 的 <span> 列表，用「、」连接
   */
  extractTags() {
    try {
      const tags = [];
      const spans = document.querySelectorAll('#bookInfo tr.label td span');
      for (let i = 0; i < spans.length; i++) {
        const tag = spans[i].textContent.trim();
        if (tag) tags.push(tag);
      }
      return tags.join('、');
    } catch (e) {
      return '';
    }
  }

  /**
   * 其他信息：状态 + 类别 + 标签
   */
  extractOtherInfo() {
    const parts = [];
    const status = this.extractStatus();
    const category = this.extractCategory();
    const tags = this.extractTags();

    if (status) parts.push(`状态：${status}`);
    if (category) parts.push(`类别：${category}`);
    if (tags) parts.push(`标签：${tags}`);

    return parts.join('，');
  }

  /**
   * URL：去掉 query 和 hash
   */
  extractUrl() {
    try {
      const url = new URL(window.location.href);
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch (e) {
      return window.location.href;
    }
  }

  /**
   * 章节目录页 URL：/book/1018082.html → /list/1018082.html
   */
  _getChapterListUrl() {
    try {
      const bookIdMatch = window.location.pathname.match(/\/book\/(\d+)\.html/);
      if (bookIdMatch) return `https://www.17k.com/list/${bookIdMatch[1]}.html`;
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 后台抓章节列表页并缓存（一次提取只抓一次）
   */
  async _fetchChapterListHtml() {
    if (this._chapterHtml !== null) return this._chapterHtml;

    this._chapterHtml = '';
    const listUrl = this._getChapterListUrl();
    if (!listUrl) {
      console.warn('[Book17kExtractor] 无法获取章节目录页URL');
      return this._chapterHtml;
    }

    try {
      const result = await WBR.runtime.sendMessage({
        action: 'fetchChapterPage',
        url: listUrl
      });
      if (result && result.html) this._chapterHtml = result.html;
      else console.warn('[Book17kExtractor] 后台返回空结果');
    } catch (e) {
      console.warn('[Book17kExtractor] 获取章节列表失败:', e && e.message);
    }
    return this._chapterHtml;
  }

  /**
   * 发布日期：章节列表页里最早的一条「更新日期」
   *
   * 第一章的日期就是这本书的发布日期。不能靠「第一章」三个字去定位 ——
   * 实操中同一站点的章节标题写法并不统一（`第1章 说好的完美开局…`），
   * 靠字面量会时灵时不灵。目录页按时间升序排列，直接取全页最早的日期最稳，
   * 目录即使倒序排列结果也不变。只接受完整的 YYYY-MM-DD，
   * 半截日期（`2015-10`）一律跳过，避免拼出假日期。
   */
  async extractPublishDate() {
    const html = await this._fetchChapterListHtml();
    if (!html) return '';

    try {
      const all = [];
      const re = /更新日期[：:]\s*(\d{4}-\d{2}-\d{2})/g;
      let m = re.exec(html);
      while (m) {
        all.push(m[1]);
        m = re.exec(html);
      }
      if (all.length > 0) {
        all.sort();
        return this._formatDate(all[0]);
      }

      console.warn('[Book17kExtractor] 章节列表页未找到日期字段');
      return '';
    } catch (e) {
      console.warn('[Book17kExtractor] 解析发布日期失败:', e && e.message);
      return '';
    }
  }

  // ====== 聚合 ======

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
      console.error('[Book17kExtractor] 提取所有字段失败:', error);
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
        'URL': '',
        'ISBN': '',
        '篇幅': '',
        '其他信息': ''
      };
    }
  }
}

// 导出到全局作用域（class 声明不会自动挂载到 window，必须显式导出）
window.Book17kExtractor = Book17kExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['17k'] = Book17kExtractor;
window.domainExtractorMap = window.domainExtractorMap || {};
window.domainExtractorMap['www.17k.com'] = Book17kExtractor;
