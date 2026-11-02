/**
 * Goodreads（goodreads.com）书籍提取器
 *
 * 数据策略：全部从详情页 DOM 取（页面是服务端直出，不用等 JS），
 * 少数页面上没有的字段（ISBN / 语言）从内嵌的规范化数据补。
 *
 * 页面结构要点（2026-10 实测，2024 改版后的新版页面）：
 * - 每个关键字段都有固定的 data-testid 标记，不用靠 class 名猜，比豆瓣稳。
 * - 作者区里除了作者还会有「编者 / 插图 / 序言」等贡献者，
 *   它们带 span[data-testid="role"]。**只有不带 role 的才是作者**，
 *   否则霍比特人那种书会把插画师也算成作者。
 * - 简介区里段落用 <br /> 分隔，textContent 遇 <br> 不出换行，
 *   整段会粘成一坨 → 必须把 <br> 换成 \n 再取。
 * - 页面里有个 og:url 声称是「规范网址」，但它会指向**另一个版本**的 book id
 *   （实测打开 /book/show/3 时它给的是 42844155 英国版），所以 URL 一律取地址栏。
 * - 首屏不显示出版社，出版社只在页面内嵌的 Next.js 数据里；
 *   那段是内部结构，改版容易失效，所以只当补充项，取不到不影响其它字段。
 *
 * v2.5.69 新增「国家」：书籍页没有国家，只能顺着作者链接去作者页读「Born」出生地。
 * - 作者页出生地是 `div.dataTitle`="Born" **后面紧跟的纯文本**（`in 城市, 州, 国家`），
 *   没有 itemprop 之类的标记，只能按兄弟节点顺序取，遇到第一个非文本节点（birthDate 的
 *   `<div class="dataItem">`）立刻停，否则会把生日年份拼进国名里。
 * - 用户 2026-10-26 裁决：**只取第一位作者**、只取出生地**最后一段**、**州名不反查国家**、
 *   查不到就留空（冷门/未认领作者的页面本来就可能没有 Born 栏）。
 * - 快照测不到这一格（jsdom 不联网），靠 `tests/goodreads-author.test.js` 用存档单测。
 */
class GoodreadsBookExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'goodreads';
    this.mediaType = 'book';
    this.isSocialPlatform = false;
    this._staticDetails = undefined;
    // v2.5.69：作者出生地国家缓存（同一次页面里只抓一次作者页）
    this._authorCountryCache = null;
  }

  /**
   * 只认书籍详情页 /book/show/<id>。
   * 必须排除 /book/show/<id>/editions（版本列表页，页面上没有单个版本的完整信息）
   * 和作者页 /author/show/<id>，所以按 pathname 整段判定，不做子串包含。
   */
  // ====== 通用工具 ======

  /** 取元素文本，压掉多余空白 */
  _text(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * 取元素文本，把 <br> 当换行，逐行 trim 后丢掉空行。
   * 简介必须走这里：textContent 遇 <br> 不产生换行，整段会粘成一坨。
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

  /** 解 HTML 实体（script 内的 JSON 是 raw text，实体不会被浏览器解码） */
  _decodeEntities(str) {
    return String(str || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
  }

  _getMeta(selector) {
    try {
      const meta = document.querySelector(selector);
      return meta && meta.content ? String(meta.content).trim() : '';
    } catch (e) {
      return '';
    }
  }

  /** 读页面内嵌的 schema.org 书籍数据（标准格式，改版影响小） */
  _getJsonLd() {
    try {
      const nodes = document.querySelectorAll('script[type="application/ld+json"]');
      for (let i = 0; i < nodes.length; i++) {
        const raw = nodes[i].textContent;
        if (!raw) continue;
        const data = JSON.parse(raw);
        const type = data && data['@type'];
        if (type === 'Book' || type === 'book') return data;
      }
    } catch (e) {
      ClipMateLog.debug('[ClipMate] 解析 JSON-LD 失败:', e && e.message);
    }
    return null;
  }

  /**
   * 读页面内嵌的 Next.js 数据，拿主书籍的 details（含出版社 / ISBN）。
   * 结构一旦变了就返回 null，绝不影响其它字段。
   */
  _getStaticDetails() {
    if (this._staticDetails !== undefined) return this._staticDetails;
    this._staticDetails = null;

    const book = this._getNextMainBook();
    if (book && book.details && typeof book.details === 'object') {
      this._staticDetails = book.details;
    }
    return this._staticDetails;
  }

  /**
   * 英文日期写成 "June 26, 1997"，转成 "1997/06/26"。
   * 只有年月时给 "1997/06"，只有年份时给 "1997" —— 缺哪级就不补，
   * 绝不拿 01 去凑一个假日期。
   */
  _parseEnDate(text) {
    const MONTHS = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const str = String(text || '');

    // 月 日, 年
    const full = str.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (full) {
      const mm = MONTHS[full[1].toLowerCase()];
      if (mm) return `${full[3]}/${mm}/${full[2].padStart(2, '0')}`;
    }

    // 月 年
    const monthYear = str.match(/([A-Za-z]+)\s+(\d{4})/);
    if (monthYear) {
      const mm = MONTHS[monthYear[1].toLowerCase()];
      if (mm) return `${monthYear[2]}/${mm}`;
    }

    // 只有年份
    const yearOnly = str.match(/\b(1\d{3}|20\d{2})\b/);
    if (yearOnly) return yearOnly[1];

    return '';
  }

  // ====== 各字段提取 ======

  /**
   * 书名：页面大标题 → 规范化数据 → og:title（会带「(系列, #1)」，先削掉）
   */
  extractBookName() {
    try {
      const h1 = document.querySelector('h1[data-testid="bookTitle"]');
      const fromDom = this._text(h1);
      if (fromDom) return fromDom;

      const ld = this._getJsonLd();
      if (ld && ld.name) {
        const cleaned = this._decodeEntities(ld.name).replace(/\s*\([^()]*#\d+\)\s*$/, '').trim();
        if (cleaned) return cleaned;
      }

      const og = this._getMeta('meta[property="og:title"]');
      if (og) {
        const cleaned = this._decodeEntities(og).replace(/\s*\([^()]*#\d+\)\s*$/, '').trim();
        if (cleaned) return cleaned;
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 作者：作者区里**不带 role** 的贡献者 → 规范化数据里的 author
   * 带 role 的是编者/插图/序言等，语义不同，不能算作者。
   */
  extractAuthor() {
    try {
      const names = [];
      let links = document.querySelectorAll(
        '.BookPageMetadataSection__contributor a.ContributorLink'
      );
      if (!links || links.length === 0) {
        links = document.querySelectorAll('h3[aria-label="List of contributors"] a.ContributorLink');
      }

      for (let i = 0; i < links.length; i++) {
        const a = links[i];
        if (a.querySelector('[data-testid="role"]')) continue;
        const nameEl = a.querySelector('.ContributorLink__name') || a;
        const name = this._text(nameEl);
        if (name && names.indexOf(name) === -1) names.push(name);
      }

      if (names.length > 0) return names.join(', ');

      const ld = this._getJsonLd();
      if (ld && ld.author) {
        const arr = Array.isArray(ld.author) ? ld.author : [ld.author];
        const fallback = [];
        for (let i = 0; i < arr.length; i++) {
          const n = arr[i] && arr[i].name ? this._decodeEntities(arr[i].name) : '';
          if (n && fallback.indexOf(n) === -1) fallback.push(n);
        }
        if (fallback.length > 0) return fallback.join(', ');
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  // ====== v2.5.69 新增：国家（作者出生地） ======

  /**
   * 作者页出生地末段里**不能当真**的写法。
   * Georgia 既是美国的一个州，也是国家格鲁吉亚 —— `in Atlanta, Georgia` 会被读成格鲁吉亚，
   * 与其显示错的，不如留空（和 v2.5.48 豆瓣读书删掉 '巴'/'阿'/'瑞' 单字键同一个道理）。
   */
  static get BIRTH_AMBIGUOUS() {
    return ['georgia'];
  }

  /**
   * 从**作者页**的 Document 里读「出生地 → 国家」。
   * 纯函数（只吃 Document、不联网、不碰 this），方便用真实存档做单测。
   *
   * 页面结构（2026-10 实测）：
   *   <div class="dataTitle">Born</div>
   *   in New Orleans, Louisiana, The United States        ← 裸文本节点
   *   <div class="dataItem" itemprop='birthDate'>…</div>  ← 到这里就停
   *
   * @param {Document} doc 作者页文档
   * @returns {string} 中文国名；认不出返回空串
   */
  static parseBirthCountryFromDoc(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return '';

    try {
      // 1) 找 dataTitle 文本为 Born 的那个
      const titles = doc.querySelectorAll('div.dataTitle');
      let bornEl = null;
      for (let i = 0; i < titles.length; i++) {
        if ((titles[i].textContent || '').trim().toLowerCase() === 'born') {
          bornEl = titles[i];
          break;
        }
      }
      if (!bornEl) return '';

      // 2) 只收「紧跟着的文本节点 / 链接」，遇到第一个别的元素就停
      //    （birthDate 的 div、<br class="clear"/>、下一个 dataTitle 都算别的）
      const parts = [];
      let node = bornEl.nextSibling;
      while (node) {
        if (node.nodeType === 3) {
          parts.push(node.nodeValue || '');
        } else if (node.nodeType === 1 && String(node.tagName || '').toUpperCase() === 'A') {
          parts.push(node.textContent || '');
        } else {
          break;
        }
        node = node.nextSibling;
      }

      let raw = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (!raw) return '';
      // 页面写的是「in 城市, 州, 国家」，去掉开头的 in
      raw = raw.replace(/^in\s+/i, '').trim();
      if (!raw) return '';

      // 3) 取最后一段当国家；只写到州/省的（in Boston, Massachusetts）最后一段不是国家 → 空
      const segs = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (segs.length === 0) return '';
      const last = segs[segs.length - 1];
      if (GoodreadsBookExtractor.BIRTH_AMBIGUOUS.indexOf(last.toLowerCase()) !== -1) return '';

      if (typeof window !== 'undefined' && window.CountryNames
          && typeof window.CountryNames.countryDisplayName === 'function') {
        return window.CountryNames.countryDisplayName(last) || '';
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 书籍页里「第一位真作者」的链接元素。
   * 判定与 extractAuthor 一致：带 role 的是编者/插画/序言，不算作者。
   * 多条时只取第一条（用户 2026-10-26 裁决：只认主作者，抓多个作者页太慢）。
   */
  _findPrimaryAuthorLink() {
    let links = document.querySelectorAll(
      '.BookPageMetadataSection__contributor a.ContributorLink'
    );
    if (!links || links.length === 0) {
      links = document.querySelectorAll('h3[aria-label="List of contributors"] a.ContributorLink');
    }
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      if (a.querySelector('[data-testid="role"]')) continue;
      const href = a.getAttribute('href') || '';
      if (href.indexOf('/author/show/') !== -1) return a;
    }
    return null;
  }

  /**
   * 抓一个同源子页并解析成 Document；任何失败都返回 null（调用方自行降级）
   * 写法与 imdb.js 的 _fetchSubPageDoc 保持一致：超时 + 不重试 + 失败不抛。
   */
  async _fetchSubPageDoc(url, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const res = await fetch(url, {
        credentials: 'same-origin',
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!res || !res.ok) return null;
      const html = await res.text();
      if (!html) return null;
      return new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (typeof ClipMateLog !== 'undefined' && ClipMateLog.debug) {
        ClipMateLog.debug('[GoodreadsBookExtractor] 作者页抓取失败:', url, e && e.message);
      }
      return null;
    }
  }

  /**
   * 国家：作者页出生地的国家。抓不到 / 没有 Born 栏 / 只写到州 → 空。
   * 同一次页面只抓一次（作者链接相同就复用结果）。
   */
  async extractAuthorCountry() {
    try {
      const link = this._findPrimaryAuthorLink();
      if (!link) return '';
      const href = link.getAttribute('href') || '';
      if (!href) return '';

      const url = new URL(href, window.location.origin).href;
      if (this._authorCountryCache && this._authorCountryCache.url === url) {
        return this._authorCountryCache.country;
      }

      const doc = await this._fetchSubPageDoc(url, 8000);
      const country = doc ? GoodreadsBookExtractor.parseBirthCountryFromDoc(doc) : '';
      this._authorCountryCache = { url: url, country: country };
      return country;
    } catch (e) {
      if (typeof ClipMateLog !== 'undefined' && ClipMateLog.debug) {
        ClipMateLog.debug('[GoodreadsBookExtractor] 国家提取失败:', e && e.message);
      }
      return '';
    }
  }

  /**
   * 发布日期：页面上写的是「First published June 26, 1997」，
   * 也就是这本书**首次出版**的时间（不是当前这个版本的印刷时间），
   * 跟豆瓣「出版日期」、IMDb「上映日期」取最早的思路一致。
   */
  extractPublishDate() {
    try {
      const pubInfo = document.querySelector('[data-testid="publicationInfo"]');
      const text = this._text(pubInfo);
      if (text) {
        const date = this._parseEnDate(text);
        if (date) return date;
        console.warn('[GoodreadsBookExtractor] 出版信息无法解析日期:', text);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /** 页数装帧原文，例如「309 pages, Hardcover」 */
  _getPagesFormatText() {
    try {
      return this._text(document.querySelector('[data-testid="pagesFormat"]'));
    } catch (e) {
      return '';
    }
  }

  /** 篇幅：从「309 pages, Hardcover」里取页数 → 「309页」 */
  extractPages() {
    try {
      const raw = this._getPagesFormatText();
      if (!raw) return '';
      const m = raw.match(/([\d,]+)\s*pages?\b/i);
      if (!m) return '';
      const num = m[1].replace(/,/g, '');
      if (!/^\d+$/.test(num)) return '';
      return `${num}页`;
    } catch (e) {
      return '';
    }
  }

  /** 装帧：同上那串里逗号后面那部分 → Hardcover / Paperback / Kindle Edition */
  extractFormat() {
    try {
      const raw = this._getPagesFormatText();
      if (!raw) return '';
      const parts = raw.split(',');
      if (parts.length < 2) return '';
      return parts.slice(1).join(',').trim();
    } catch (e) {
      return '';
    }
  }

  /**
   * 网络评分：.RatingStatistics__rating（4.47，两位小数）
   * 不用 [class*="rating"] 这类模糊选择器 —— 页面里评分星星也带 rating 字样。
   */
  extractRating() {
    try {
      const el = document.querySelector('.RatingStatistics__rating');
      const text = this._text(el);
      if (!text) return '';
      const m = text.match(/\d+(?:\.\d+)?/);
      if (!m) return '';
      const num = parseFloat(m[0]);
      if (!isFinite(num) || num <= 0) return '';
      return m[0];
    } catch (e) {
      return '';
    }
  }

  /**
   * 简介：简介区的正文容器，按 <br> 断段
   * 兜底顺序：正文容器 → 简介区整体 → 内嵌数据的纯文本版
   */
  extractDescription() {
    try {
      const box = document.querySelector('[data-testid="description"]');
      if (box) {
        const body = box.querySelector('[data-testid="contentContainer"]');
        const fromBody = this._textWithBreaks(body || box);
        if (fromBody) return fromBody;
      }

      // 兜底：内嵌数据里有一份去掉标签的纯文本简介
      const book = this._getNextMainBook();
      if (book) {
        const stripped = book['description({"stripped":true})'];
        if (stripped) {
          return String(stripped)
            .split(/\r?\n/)
            .map((line) => line.replace(/[\s\u3000]+/g, ' ').trim())
            .filter((line) => line.length > 0)
            .join('\n');
        }
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  /** 取内嵌数据里的主书籍对象（供简介兜底用） */
  _getNextMainBook() {
    try {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el || !el.textContent) return null;
      const data = JSON.parse(el.textContent);
      const state = data && data.props && data.props.pageProps && data.props.pageProps.apolloState;
      if (!state || typeof state !== 'object') return null;
      for (const key in state) {
        if (!Object.prototype.hasOwnProperty.call(state, key)) continue;
        const item = state[key];
        if (!item || typeof item !== 'object') continue;
        if (item.__typename !== 'Book') continue;
        if (!item.details || typeof item.details !== 'object') continue;
        return item;
      }
    } catch (e) {
      ClipMateLog.debug('[ClipMate] 读取内嵌书籍数据失败:', e && e.message);
    }
    return null;
  }

  /**
   * ISBN：规范化数据（13 位国际标准号）→ 内嵌数据 isbn13 → isbn
   * 首屏页面上不显示 ISBN（要点「Book details & editions」才看得到），
   * Kindle / 电子书很多本身就没有 ISBN，取不到就留空。
   */
  extractIsbn() {
    try {
      const ld = this._getJsonLd();
      if (ld && ld.isbn) {
        const isbn = String(ld.isbn).replace(/[^0-9Xx]/g, '');
        if (isbn) return isbn;
      }

      const details = this._getStaticDetails();
      if (details) {
        if (details.isbn13) return String(details.isbn13);
        if (details.isbn) return String(details.isbn);
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  /** 出版社：页面上没有，只能从内嵌数据取（拿不到就空着） */
  extractPublisher() {
    try {
      const details = this._getStaticDetails();
      if (!details) return '';
      return details.publisher ? String(details.publisher).trim() : '';
    } catch (e) {
      return '';
    }
  }

  /** 语言：规范化数据的 inLanguage */
  extractLanguage() {
    try {
      const ld = this._getJsonLd();
      if (ld && ld.inLanguage) return String(ld.inLanguage).trim();
      return '';
    } catch (e) {
      return '';
    }
  }

  /** 系列：标题上方的系列链接，例如「Harry Potter #1」 */
  extractSeries() {
    try {
      const a = document.querySelector('h3 a[href*="/series/"]');
      return this._text(a);
    } catch (e) {
      return '';
    }
  }

  /** 标签：标签区里的每个标签按钮，去掉末尾的「...more」按钮 */
  extractTags() {
    try {
      const box = document.querySelector('[data-testid="genresList"]');
      if (!box) return '';
      const links = box.querySelectorAll('a.Button--tag');
      const tags = [];
      for (let i = 0; i < links.length; i++) {
        const tag = this._text(links[i]);
        if (!tag) continue;
        if (tag === '...more' || tag === '…more' || tag === 'Show more') continue;
        if (tags.indexOf(tag) === -1) tags.push(tag);
      }
      return tags.join('、');
    } catch (e) {
      return '';
    }
  }

  /** 评价人数：去掉末尾的「ratings」字样，只留数字 */
  extractRatingsCount() {
    try {
      const text = this._text(document.querySelector('[data-testid="ratingsCount"]'));
      if (!text) return '';
      const m = text.match(/[\d,]+/);
      return m ? m[0] : '';
    } catch (e) {
      return '';
    }
  }

  /** 评论数：去掉末尾的「reviews」字样 */
  extractReviewsCount() {
    try {
      const text = this._text(document.querySelector('[data-testid="reviewsCount"]'));
      if (!text) return '';
      const m = text.match(/[\d,]+/);
      return m ? m[0] : '';
    } catch (e) {
      return '';
    }
  }

  /** URL：取地址栏，去掉查询参数和锚点（页面自称的「规范网址」会指向别的版本，不用） */
  extractUrl() {
    try {
      const url = new URL(window.location.href);
      return `${url.protocol}//${url.hostname}${url.pathname}`;
    } catch (e) {
      return window.location.href;
    }
  }

  /**
   * 其他信息：系列 + 出版社 + 装帧 + 语言 + 评价人数 + 评论数 + 标签
   */
  extractOtherInfo() {
    const parts = [];

    const series = this.extractSeries();
    const publisher = this.extractPublisher();
    const format = this.extractFormat();
    const language = this.extractLanguage();
    const ratingsCount = this.extractRatingsCount();
    const reviewsCount = this.extractReviewsCount();
    const tags = this.extractTags();

    if (series) parts.push(`系列：${series}`);
    if (publisher) parts.push(`出版社：${publisher}`);
    if (format) parts.push(`装帧：${format}`);
    if (language) parts.push(`语言：${language}`);
    if (ratingsCount) parts.push(`评价人数：${ratingsCount}`);
    if (reviewsCount) parts.push(`评论数：${reviewsCount}`);
    if (tags) parts.push(`标签：${tags}`);

    return parts.join('，');
  }

  // ====== 聚合 ======

  async extractAllFields() {
    try {
      return {
        '书名': this.extractBookName(),
        '别名': '',
        '作者': this.extractAuthor(),
        '国家': await this.extractAuthorCountry(),
        '原作名': '',
        '发布日期': this.extractPublishDate(),
        '简介': this.extractDescription(),
        '网络评分': this.extractRating(),
        '豆瓣链接': '',
        'URL': this.extractUrl(),
        'ISBN': this.extractIsbn(),
        '篇幅': this.extractPages(),
        '其他信息': this.extractOtherInfo()
      };
    } catch (error) {
      console.error('[GoodreadsBookExtractor] 提取所有字段失败:', error);
      return {
        '书名': '',
        '别名': '',
        '作者': '',
        '国家': '',
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
window.GoodreadsBookExtractor = GoodreadsBookExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['goodreads'] = GoodreadsBookExtractor;
window.domainExtractorMap = window.domainExtractorMap || {};
window.domainExtractorMap['www.goodreads.com'] = GoodreadsBookExtractor;
