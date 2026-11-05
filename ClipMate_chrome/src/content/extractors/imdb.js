/**
 * IMDb.com 影视页面提取器
 *
 * 策略：优先从 JSON-LD（@type: Movie / TVSeries）获取结构化数据，
 * 再通过 DOM 选择器兜底。
 *
 * 三份 IMDB 页面（电影×2、剧集×1）验证通过：
 * - 电影 / 剧集均有完整的 JSON-LD 结构化数据
 * - 差异点（director / duration / @type）已在提取器中区别处理
 *
 * v2.5.55 补齐（国家 / 原作名 / 集数 / 单集片长 / 别名 / 主演 10 人 / 简介转义）：
 * - 新增字段只在「电影页 + 剧集页」（JSON-LD @type 为 Movie 或 TVSeries）生效，
 *   其它 IMDb 页面（含单集页 @type=TVEpisode）一律返回空字符串，与改动前逐字符一致。
 * - 数据源优先级：L1 结构化数据 → L2 页面内嵌数据 __NEXT_DATA__ → L3 页面元素。
 */

// v2.5.68：原本这里有一张 68 行的 IMDB_COUNTRY_TABLE（[代码, 英文全称, 中文名]），
// 已并入 src/shared/country-names.js 的统一国家总表（约 200 个国家/地区、600 余种写法）。
// 代码翻译走 CountryNames.standardizeCountryCode()，英文全称翻译走 CountryNames.countryDisplayName()。

class ImdbExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'imdb';
    this.mediaType = 'movie';
    this.isSocialPlatform = false;
    // v2.5.55：页面内嵌数据 / 别名结果各缓存一次（按 URL 区分，站内跳转后自动失效）
    this._pageDataCache = null;
    this._aliasCache = null;
    // v2.5.57：releaseinfo 子页（别名 + 全部上映日期）与「第一集导演」各预取一次，
    // 供 extractAliases / extractReleaseDate / extractDirector 共用，不重复发请求。
    this._releaseInfoCache = null;
    this._seriesDirectorCache = null;
  }


  /**
   * 读取页面 JSON-LD 结构化数据
   * IMDb 页面 <script type="application/ld+json"> 中直接包含 Movie 或 TVSeries 对象
   */
  _readJsonLd() {
    // v2.5.48：原来整个 for 循环包在一个 try 里，页面上只要有一块 JSON-LD 畸形，
    // JSON.parse 就抛错，直接跳到 return null → 23 个字段全部拿空。
    // 现在改为「逐块容错」：坏一块就跳过，继续找下一块，别让一块脏数据毁掉整页。
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        if (!json) continue;
        if (json['@type'] === 'Movie' || json['@type'] === 'TVSeries') {
          return json;
        }
      } catch (e) {
        console.warn('[ImdbExtractor] 单块 JSON-LD 解析失败，已跳过:', e.message);
      }
    }
    return null;
  }

  /**
   * 将 ISO 8601 日期格式化为 "YYYY/MM/DD"
   */
  _formatDate(isoStr) {
    try {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr.replace(/-/g, '/');
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${day}`;
    } catch (e) {
      return isoStr || '';
    }
  }

  /**
   * 格式化 IMDb 时长字段
   * "PT2H25M" → "2h 25m"
   * "PT1H45M" → "1h 45m"
   * "PT45M"   → "45m"
   */
  _formatDuration(isoDuration) {
    if (!isoDuration) return '';
    const hMatch = isoDuration.match(/(\d+)H/);
    const mMatch = isoDuration.match(/(\d+)M/);
    const hours = hMatch ? parseInt(hMatch[1]) : 0;
    const minutes = mMatch ? parseInt(mMatch[1]) : 0;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return '';
  }

  /**
   * 拼接数组中的 name 字段
   */
  _joinNames(arr, limit = 10) {
    if (!Array.isArray(arr) || arr.length === 0) return '';
    return arr.slice(0, limit).map(item => item.name).filter(Boolean).join(', ');
  }

  // ========== v2.5.55 新增：辅助方法 ==========

  /**
   * 读取页面内嵌数据 __NEXT_DATA__ 的 pageProps（IMDb 服务端直出，约 880KB）
   * 按 URL 缓存，同一页面只解析一次；站内跳转后 URL 变化会自动重新解析。
   * 取不到（结构变化 / 被降级渲染）时返回 null，调用方各自走 L3 兜底。
   */
  _readPageData() {
    const href = window.location.href;
    if (this._pageDataCache && this._pageDataCache.href === href) {
      return this._pageDataCache.data;
    }
    let data = null;
    try {
      const el = document.getElementById('__NEXT_DATA__');
      const text = el && el.textContent ? el.textContent.trim() : '';
      if (text) {
        const json = JSON.parse(text);
        data = (json && json.props && json.props.pageProps) || null;
      }
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 页面内嵌数据解析失败:', e && e.message);
    }
    this._pageDataCache = { href, data };
    return data;
  }

  /**
   * 是否为「电影页 / 剧集页」（JSON-LD @type 为 Movie 或 TVSeries）
   * 单集页的 @type 是 TVEpisode，不在 _readJsonLd 的白名单里 → 返回 false，
   * 从而保证单集页的所有输出与改动前逐字符一致。
   */
  _isMovieOrSeriesPage() {
    return !!this._readJsonLd();
  }

  /** 是否为「整体剧集页」（只认 TVSeries；迷你剧的 @type 同样是 TVSeries） */
  _isSeriesPage() {
    const ld = this._readJsonLd();
    return !!(ld && ld['@type'] === 'TVSeries');
  }

  /**
   * 还原 HTML 实体：family&apos;s → family's
   * 不用 innerHTML（避免扩展审核告警），走正则表 + 数字实体。
   */
  _decodeEntities(str) {
    if (!str) return '';
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#34': '"' };
    return String(str)
      .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, key) => {
        if (named[key] !== undefined) return named[key];
        if (key.charAt(0) === '#') {
          const isHex = key.charAt(1) === 'x' || key.charAt(1) === 'X';
          const code = parseInt(isHex ? key.slice(2) : key.slice(1), isHex ? 16 : 10);
          if (!isNaN(code) && code > 0) {
            try {
              return String.fromCodePoint(code);
            } catch (e) {
              return whole;
            }
          }
        }
        return whole;
      });
  }

  /** 国家代码 / 英文全称 → 中文；认不出就原样返回（表在 src/shared/country-names.js） */
  _countryLocal(value) {
    const key = String(value || '').trim();
    if (!key) return '';
    try {
      if (typeof window !== 'undefined' && window.CountryNames
          && typeof window.CountryNames.countryDisplayName === 'function') {
        return window.CountryNames.countryDisplayName(key, { keepUnknown: true });
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return key;
  }

  /** 标题归一化（比较是否为同一个名字） */
  _normTitle(str) {
    return String(str || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // ========== v2.5.57 新增：上映日期校验 + 第一集导演 ==========

  /** 从任意日期字符串里取 4 位年份（"2026-08-28" / "1994-10-14T00:00:00Z" → "2026"/"1994"） */
  _yearOf(value) {
    const m = String(value || '').match(/(\d{4})/);
    return m ? m[1] : '';
  }

  /**
   * 英文日期 → "YYYY/MM/DD"
   * "September 9, 2001" → "2001/09/09"
   * 取不到完整「月 日, 年」时返回空（不接受只有年份/只有月份的半截日期）。
   */
  _formatEnglishDate(text) {
    const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const m = String(text || '').match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return '';
    const idx = MONTHS.indexOf(m[1].toLowerCase());
    if (idx < 0) return '';
    return `${m[3]}/${String(idx + 1).padStart(2, '0')}/${String(m[2]).padStart(2, '0')}`;
  }

  /**
   * 作品「原始发行年份」（不受访问地本地化影响）
   * 来源：内嵌数据 aboveTheFoldData.releaseYear.year
   * 取不到返回空 → 调用方不做年份校验，保持原行为。
   */
  _originalReleaseYear() {
    try {
      const data = this._readPageData();
      const y = data && data.aboveTheFoldData
        && data.aboveTheFoldData.releaseYear
        && data.aboveTheFoldData.releaseYear.year;
      if (typeof y === 'number' && y > 0) return String(y);
      if (typeof y === 'string' && /^\d{4}$/.test(y.trim())) return y.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  /**
   * releaseinfo 子页里最早的一条上映日期（"YYYY/MM/DD"）
   * 只在年份对不上时才会被调用；子页没抓到 / 没解析出完整日期时返回空。
   */
  _earliestReleaseDate() {
    const cache = this._releaseInfoCache;
    if (!cache || cache.href !== window.location.href) return '';
    const rows = Array.isArray(cache.dates) ? cache.dates : [];
    let best = '';
    rows.forEach((row) => {
      const key = row && row.sortKey;
      if (!key || !/^\d{8}$/.test(key)) return;
      if (!best || key < best) best = key;
    });
    if (!best) return '';
    return `${best.slice(0, 4)}/${best.slice(4, 6)}/${best.slice(6, 8)}`;
  }

  // ========== v2.5.57 新增：子页抓取（别名 / 上映日期 / 第一集导演共用） ==========

  /** 从指定 Document 里读 __NEXT_DATA__ 的 pageProps */
  _nextDataFromDoc(doc) {
    try {
      const el = doc && doc.getElementById('__NEXT_DATA__');
      const text = el && el.textContent ? el.textContent.trim() : '';
      if (!text) return null;
      const json = JSON.parse(text);
      return (json && json.props && json.props.pageProps) || null;
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 子页内嵌数据解析失败:', e && e.message);
      return null;
    }
  }

  /** 从指定 Document 里读第一条 Movie / TVSeries / TVEpisode 的 JSON-LD */
  _jsonLdFromDoc(doc) {
    if (!doc) return null;
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      try {
        const json = JSON.parse(script.textContent);
        if (!json) continue;
        const type = json['@type'];
        if (type === 'Movie' || type === 'TVSeries' || type === 'TVEpisode') return json;
      } catch (e) {
        ClipMateLog.debug('[ImdbExtractor] 子页单块 JSON-LD 解析失败，已跳过:', e && e.message);
      }
    }
    return null;
  }

  /**
   * 抓一个同源子页并解析成 Document；任何失败都返回 null（调用方自行降级）
   * @param {string} url 同源相对路径
   * @param {number} timeoutMs 超时上限
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
      ClipMateLog.debug('[ImdbExtractor] 子页抓取失败:', url, e && e.message);
      return null;
    }
  }

  /** 当前页面的 tt 编号（非 title 页返回空） */
  _titleId() {
    const match = window.location.pathname.match(/\/title\/(tt\d+)/);
    return match ? match[1] : '';
  }

  /**
   * 预取 releaseinfo 子页：别名列表 + 全部上映日期
   * 按 URL 缓存，一页只抓一次。失败也写缓存，避免同一页反复重试拖慢提取。
   */
  async _prefetchReleaseInfo() {
    if (!this._isMovieOrSeriesPage()) return;
    const href = window.location.href;
    if (this._releaseInfoCache && this._releaseInfoCache.href === href) return;
    const parsed = await this._fetchReleaseInfoPage();
    this._releaseInfoCache = { href, akas: parsed.akas, dates: parsed.dates };
  }

  /**
   * 抓 /title/<id>/releaseinfo/ 并解析
   * @returns {Promise<{akas: Array<{title: string, country: string}>, dates: Array<{sortKey: string, display: string, country: string}>}>}
   */
  async _fetchReleaseInfoPage() {
    const ttId = this._titleId();
    if (!ttId) return { akas: [], dates: [] };

    // v2.5.56：实测 IMDb 子页解析要 5–8 秒，原来 4 秒必被 abort → 别名永远退回主页那 1–3 条。
    // 12 秒是上限，网络正常时 1–3 秒就返回，不会每次都等满。
    const doc = await this._fetchSubPageDoc(`/title/${ttId}/releaseinfo/`, 12000);
    if (!doc) return { akas: [], dates: [] };

    // 实测（2026-10 存档）：子页内嵌数据只预置前 5 条（akas.total 才是 57），
    // 而服务端 HTML 里渲染了 12 条列表项。所以两路都收、合并去重，
    // 取页面实际给出的最大量（剩下的要走 IMDb 内部 GraphQL 分页，不值得为它冒风险）。
    const akas = [];
    const seenKey = new Set();
    const addRow = (title, country) => {
      const text = String(title || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      const key = text + '|' + String(country || '').trim();
      if (seenKey.has(key)) return;
      seenKey.add(key);
      akas.push({ title: text, country });
    };

    // ① 内嵌数据：props.pageProps.contentData.data.title.akas
    try {
      const pp = this._nextDataFromDoc(doc);
      const akasData = pp && pp.contentData && pp.contentData.data
        && pp.contentData.data.title && pp.contentData.data.title.akas;
      const edges = akasData && akasData.edges;
      if (Array.isArray(edges)) {
        edges.forEach((edge) => {
          const node = edge && edge.node;
          const title = node && node.displayableProperty
            && node.displayableProperty.value
            && node.displayableProperty.value.plainText;
          const country = node && node.country && (node.country.id || node.country.text);
          addRow(title, country);
        });
      }
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 别名内嵌数据解析失败，改用页面元素:', e && e.message);
    }

    // ② 页面元素：[data-testid="sub-section-akas"] 下的列表项（服务端渲染 12 条）
    try {
      const box = doc.querySelector('[data-testid="sub-section-akas"]');
      if (box) {
        Array.from(box.querySelectorAll('li[data-testid="list-item"]')).forEach((li) => {
          const label = li.querySelector('.ipc-metadata-list-item__label');
          const value = li.querySelector('.ipc-metadata-list-item__list-content-item');
          const countryText = label ? label.textContent.replace(/\s+/g, ' ').trim() : '';
          const title = value ? value.textContent.replace(/\s+/g, ' ').trim() : '';
          if (!title) return;
          // "(original title)" 那一行就是原名，pushOne 里也会被过滤，这里直接跳过
          if (/original title/i.test(countryText)) return;
          addRow(title, countryText);
        });
      }
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 别名页面元素解析失败:', e && e.message);
    }

    // ③ 上映日期：[data-testid="sub-section-releases"] 下的列表项
    //    实测结构（2026-10 存档）：每条 li 的 label 是国家、content 是 "September 9, 2001"
    //    只收「月 日, 年」完整的条目（半截日期会让“最早”算错），供年份校验用。
    const dates = [];
    try {
      const box = doc.querySelector('[data-testid="sub-section-releases"]');
      if (box) {
        Array.from(box.querySelectorAll('li[data-testid="list-item"]')).forEach((li) => {
          const label = li.querySelector('.ipc-metadata-list-item__label');
          const content = li.querySelector('.ipc-metadata-list-item__list-content');
          const countryText = label ? label.textContent.replace(/\s+/g, ' ').trim() : '';
          const raw = content ? content.textContent.replace(/\s+/g, ' ').trim() : '';
          const display = this._formatEnglishDate(raw);
          if (!display) return;
          dates.push({
            sortKey: display.replace(/\//g, ''),
            display,
            country: countryText
          });
        });
      }
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 上映日期解析失败:', e && e.message);
    }

    return { akas, dates };
  }

  /**
   * 预取「第一集导演」
   * 剧集页的 JSON-LD 实测没有 director（只有 creator），整页也不列导演；
   * 真实数据在每一集的页面里 → 先找 S01E01，再读那一集 JSON-LD 的 director。
   * 电影页 JSON-LD 自带 director → 直接跳过，零开销；
   * 单集页 / 非影视主页面 → _isSeriesPage() 为 false，同样跳过（保持原有输出）。
   */
  async _prefetchSeriesDirector() {
    if (!this._isSeriesPage()) return;
    const href = window.location.href;
    if (this._seriesDirectorCache && this._seriesDirectorCache.href === href) return;
    const ld = this._readJsonLd();
    // 极少数剧集页自带 director，有就直接用，不必多发两个请求
    if (ld && Array.isArray(ld.director) && ld.director.length > 0) {
      this._seriesDirectorCache = { href, value: this._joinNames(ld.director) };
      return;
    }
    let value = '';
    try {
      value = await this._fetchFirstEpisodeDirector();
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 第一集导演获取失败:', e && e.message);
    }
    this._seriesDirectorCache = { href, value };
  }

  /**
   * 抓第一季第一集的导演
   * ① /title/<id>/episodes/?season=1 → 内嵌数据 section.episodes.items 里找 season=1 & episode=1
   * ② 抓那一集页面 → JSON-LD 的 director
   * 必须显式带 ?season=1：分集页默认显示最新一季，多季剧集不带参数会拿到最后一季第 1 集。
   */
  async _fetchFirstEpisodeDirector() {
    const ttId = this._titleId();
    if (!ttId) return '';

    const doc = await this._fetchSubPageDoc(`/title/${ttId}/episodes/?season=1`, 12000);
    if (!doc) return '';

    // ① 内嵌数据里按 season/episode 精确匹配，不依赖列表顺序
    let firstEpId = '';
    try {
      const pp = this._nextDataFromDoc(doc);
      const items = pp && pp.contentData && pp.contentData.section
        && pp.contentData.section.episodes && pp.contentData.section.episodes.items;
      if (Array.isArray(items)) {
        const hit = items.find(
          it => it && String(it.season) === '1' && String(it.episode) === '1' && it.id
        );
        if (hit) firstEpId = String(hit.id);
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // ② 内嵌数据没命中时，退回页面链接（每次分集都是一个 /title/xxx/?ref_=ttep_ep_N）
    if (!firstEpId) {
      try {
        const a = doc.querySelector('a[href*="ref_=ttep_ep_1"]');
        const href = a ? a.getAttribute('href') : '';
        const m = String(href).match(/\/title\/(tt\d+)/);
        if (m) firstEpId = m[1];
      } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    }

    if (!firstEpId) return '';

    const epDoc = await this._fetchSubPageDoc(`/title/${firstEpId}/`, 12000);
    if (!epDoc) return '';
    const ld = this._jsonLdFromDoc(epDoc);
    if (ld && Array.isArray(ld.director) && ld.director.length > 0) {
      return this._joinNames(ld.director);
    }
    return '';
  }

  // ========== 各字段提取方法 ==========

  extractName() {
    // 策略1：JSON-LD name
    const ld = this._readJsonLd();
    if (ld && ld.name) return ld.name.trim();
    // 策略2：og:title（去掉尾部 " (年份) ⭐ X.X | 类型"）
    try {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) {
        return og.content.replace(/\s*\(\d{4}.*$/, '').trim();
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    // 策略3：pageTitle data-testid
    try {
      const el = document.querySelector('[data-testid="hero__pageTitle"]');
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractMediaType() {
    const ld = this._readJsonLd();
    if (ld) {
      return ld['@type'] === 'TVSeries' ? '剧集' : '电影';
    }
    // 从页面 URL 和标题推断
    try {
      const title = document.title || '';
      if (title.includes('TV Series') || title.includes('TV Mini Series')) return '剧集';
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '电影';
  }

  extractReleaseDate() {
    const ld = this._readJsonLd();
    if (ld && ld.datePublished) {
      // v2.5.57：IMDb 会按访问地返回「本地上映日期」。实测肖申克的救赎（1994）在中文网络下
      // datePublished 是 "2026-08-28"（页面上写着 August 28, 2026 (China)），直接转格式就会
      // 显示成 2026/08/28。这里拿「作品原始发行年份」做校验：
      //   年份一致 → 原样输出（绝大多数页面走这条，行为与改动前逐字符一致）
      //   年份不一致 → 改用 releaseinfo 子页里最早的一条（子页本来就要抓，不额外发请求）
      //   子页取不到 / 取到的仍对不上 → 只输出原始年份，绝不显示错的完整日期
      const dateYear = this._yearOf(ld.datePublished);
      const originYear = this._originalReleaseYear();
      if (dateYear && originYear && dateYear !== originYear) {
        const earliest = this._earliestReleaseDate();
        if (earliest && earliest.slice(0, 4) === originYear) return earliest;
        return originYear;
      }
      return this._formatDate(ld.datePublished);
    }
    // 兜底：从 og:description 中提取年份
    try {
      const og = document.querySelector('meta[property="og:description"]');
      if (og && og.content) {
        const yMatch = og.content.match(/(\d{4})/);
        if (yMatch) return yMatch[1];
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractDescription() {
    const ld = this._readJsonLd();
    // v2.5.55：结构化数据里的简介带 HTML 实体（如 family&apos;s），先还原再返回。
    // 电影页原文通常无实体，输出不变；剧集页此前会显示成 family&apos;s future。
    if (ld && ld.description) return this._decodeEntities(ld.description.trim());
    // 兜底：从 meta[name="description"] 获取（DOM 属性已是解码后的文本）
    try {
      const meta = document.querySelector('meta[name="description"]');
      if (meta && meta.content) return meta.content.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractDuration() {
    // v2.5.56：剧集页 JSON-LD 里的 duration 是「平均单集时长」，语义属于「单集片长」。
    // 这里留空，避免两个格子显示同一个数字（v2.5.55 实测：片长 48m、单集片长却为空）。
    // 单集时长的取值见 extractEpisodeRuntime()。电影页行为不变。
    if (this._isSeriesPage()) return '';
    const ld = this._readJsonLd();
    if (ld && ld.duration) {
      return this._formatDuration(ld.duration);
    }
    return '';
  }

  extractRating() {
    const ld = this._readJsonLd();
    if (ld && ld.aggregateRating && ld.aggregateRating.ratingValue) {
      return String(ld.aggregateRating.ratingValue);
    }
    // 兜底：从 data-testid 获取评分 DOM 文本
    try {
      const el = document.querySelector('[data-testid="hero-rating-bar__aggregate-rating__score"], [data-testid="hero-rating-bar__popularity__score"]');
      if (el && el.textContent.trim()) return el.textContent.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractUrl() {
    // 统一返回完整 IMDB URL
    const ld = this._readJsonLd();
    if (ld && ld.url) return ld.url;
    return window.location.href;
  }

  extractDirector() {
    const ld = this._readJsonLd();
    if (ld && Array.isArray(ld.director) && ld.director.length > 0) {
      return this._joinNames(ld.director);
    }
    // v2.5.57：剧集页的 JSON-LD 实测没有 director（只有 creator），整页也不列导演 →
    // 用预取到的「第一集导演」。缓存没准备好就留空，不拿 creator 硬凑（语义不同）。
    // 电影页在上面就已经 return，单集页 _isSeriesPage() 为 false，两者输出都零变化。
    if (this._isSeriesPage()) {
      const cache = this._seriesDirectorCache;
      if (cache && cache.href === window.location.href) return cache.value || '';
    }
    return '';
  }

  extractWriter() {
    const ld = this._readJsonLd();
    if (ld && Array.isArray(ld.creator) && ld.creator.length > 0) {
      // 只取 Person 类型的创作者（跳过 Organization 公司）
      const persons = ld.creator.filter(c => c['@type'] === 'Person');
      return this._joinNames(persons);
    }
    return '';
  }

  extractCast() {
    const ld = this._readJsonLd();
    const fallback = () => {
      if (ld && Array.isArray(ld.actor) && ld.actor.length > 0) {
        return this._joinNames(ld.actor, 10);
      }
      return '';
    };

    // 单集页等非影视主页面：保持改动前的取法（结构化数据 3 人 / 空），一个字符都不动
    if (!this._isMovieOrSeriesPage()) return fallback();

    // v2.5.55：优先取页面 Top Cast 卡片前 10 位（结构化数据只给 3 人）
    try {
      const nodes = document.querySelectorAll('[data-testid="title-cast-item__actor"]');
      const names = Array.from(nodes)
        .map(a => a.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (names.length > 0) return names.slice(0, 10).join(', ');
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return fallback();
  }

  /**
   * 综合其他信息：类型 + 分级
   */
  extractOtherInfo() {
    const parts = [];
    const ld = this._readJsonLd();

    // v2.12.0：genre 偶尔是裸字符串（单类型条目），一并当数组处理 ——
    // 否则「类型：」这段原词会整段消失，标签列也就没有输入了。
    if (ld && ld.genre) {
      const genres = Array.isArray(ld.genre) ? ld.genre : [ld.genre];
      if (genres.filter(Boolean).length > 0) {
        parts.push(`类型：${genres.filter(Boolean).join('、')}`);
      }
    }
    if (ld && ld.contentRating) {
      parts.push(`分级：${ld.contentRating}`);
    }

    return parts.join('，');
  }

  /**
   * v2.12.0：「标签」列 —— JSON-LD 的 genre 过统一转化库。
   *
   * 为什么单独成列而不是把「类型：」搬过来：
   *   IMDb 的 genre 是**英文**（Action / Drama / History），直接写进标签列与
   *   豆瓣、红果的中文标签不可比。归一器负责中英映射（Action→动作、Film-Noir→黑暗）。
   *
   * 为什么「其他信息 → 类型：」保留原词不删：
   *   英文原文是可追溯的依据。归一器只改「标签」列，不改写原文 —— 映射有争议时，
   *   总要能回到站点原本写了什么。
   */
  extractTags() {
    const ld = this._readJsonLd();
    const genre = ld && ld.genre;
    if (!genre) return '';
    const words = Array.isArray(genre) ? genre : [genre];
    return this._standardTags('IMDb', words, Array.isArray(genre) ? genre.join(',') : String(genre));
  }

  // ========== v2.5.55 新增字段 ==========

  /**
   * 国家 / 制片地区
   * L2 内嵌数据只有两字母代码（US/GB/CA）→ 查表转中文 → 查不到再走 L3 英文全称
   */
  extractCountry() {
    if (!this._isMovieOrSeriesPage()) return '';

    // L2：内嵌数据只有两字母代码，查到就转中文
    const mapped = [];
    try {
      const data = this._readPageData();
      const list = data && data.aboveTheFoldData
        && data.aboveTheFoldData.countriesOfOrigin
        && data.aboveTheFoldData.countriesOfOrigin.countries;
      if (Array.isArray(list)) {
        list.forEach((item) => {
          const code = item && item.id;
          if (!code) return;
          // 代码查不到时返回空串 → 跳过，不把 "AZ" 这种原始码丢给用户
          const zh = (typeof window !== 'undefined' && window.CountryNames
            && typeof window.CountryNames.standardizeCountryCode === 'function')
            ? window.CountryNames.standardizeCountryCode(code)
            : '';
          if (zh) mapped.push(zh);
        });
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    if (mapped.length > 0) return mapped.join(', ');

    // L3：详情区 Origin 一行（英文全称）。注意容器文案是「Country of originUnited States」，
    // 必须优先取 <a> 的文字，没有 <a> 时把标签前缀去掉，否则会把标签一起当国名。
    try {
      const el = document.querySelector('[data-testid="title-details-origin"]');
      if (el) {
        const anchor = el.querySelector('a');
        const raw = (anchor ? anchor.textContent : el.textContent.replace(/country of origin/i, ''))
          .replace(/\s+/g, ' ').trim();
        if (raw) {
          const parts = raw.split(/[,，]\s*/).map(part => this._countryLocal(part));
          return ImdbExtractor.standardizeRegionNames(parts.join(', '));
        }
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // 代码没收录、页面也没有可读国名时宁可留空，不把 "AZ" 这种原始代码丢给用户
    return '';
  }

  /**
   * 原作名：与「名字」相同则留空（同名的“原作名”没有信息量）
   */
  extractOriginalTitle() {
    if (!this._isMovieOrSeriesPage()) return '';

    let original = '';
    try {
      const data = this._readPageData();
      original = (data && data.aboveTheFoldData
        && data.aboveTheFoldData.originalTitleText
        && data.aboveTheFoldData.originalTitleText.text) || '';
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    original = String(original).replace(/\s+/g, ' ').trim();
    if (!original) return '';

    const name = this.extractName();
    if (name && this._normTitle(original) === this._normTitle(name)) return '';
    return original;
  }

  /**
   * 集数（仅整体剧集页；迷你剧同样有值）
   * L2 mainColumnData.episodes.totalEpisodes.total 是唯一可靠来源
   * （页面 DOM 里那个“集数”是加载后由脚本填的，服务器 HTML 里是空的，不能兜底）
   */
  extractEpisodes() {
    if (!this._isSeriesPage()) return '';

    try {
      const data = this._readPageData();
      const total = data && data.mainColumnData
        && data.mainColumnData.episodes
        && data.mainColumnData.episodes.totalEpisodes
        && data.mainColumnData.episodes.totalEpisodes.total;
      if (typeof total === 'number' && total > 0) return String(total);
      if (typeof total === 'string' && /^\d+$/.test(total.trim())) return total.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  /**
   * 单集片长（仅整体剧集页）
   * 直接用页面显示的文本（48m / 1h / 50m），不自己换算，避免和 IMDb 口径不一致。
   * 注意：剧集页的「片长」是真实空缺，必须留空，时长只能进这个格子。
   */
  extractEpisodeRuntime() {
    if (!this._isSeriesPage()) return '';

    try {
      const data = this._readPageData();
      const plain = data && data.aboveTheFoldData
        && data.aboveTheFoldData.runtime
        && data.aboveTheFoldData.runtime.displayableProperty
        && data.aboveTheFoldData.runtime.displayableProperty.value
        && data.aboveTheFoldData.runtime.displayableProperty.value.plainText;
      if (plain && String(plain).trim()) return String(plain).trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    // v2.5.56：剧集页的 aboveTheFoldData.runtime 实测为空（剧集没有单一 runtime 对象），
    // 真实数据在 JSON-LD 的 duration 里（如 PT48M）→ 用它兜底。走 _formatDuration 保持和电影页同一口径。
    try {
      const ld = this._readJsonLd();
      if (ld && ld.duration) {
        const text = this._formatDuration(ld.duration);
        if (text) return text;
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }

    return '';
  }

  /**
   * 别名
   * ① 抓同源子页 /title/<id>/releaseinfo/ 的 __NEXT_DATA__（全量，实测 57 条）
   * ② 子页 DOM 的「Also known as」列表（页面只渲染前 12 条）
   * ③ 主页内嵌数据的 1 条
   * 任意一步失败都不会影响其它字段；全失败则留空。
   * 与「名字」完全相同的条目不收（那不是别名），上限 20 条。
   */
  async extractAliases() {
    if (!this._isMovieOrSeriesPage()) return '';

    const href = window.location.href;
    if (this._aliasCache && this._aliasCache.href === href) return this._aliasCache.value;

    const name = this.extractName();
    const seen = new Set();
    const picked = [];
    const pushOne = (title, country) => {
      const text = String(title || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      // 与原名相同的不算别名
      if (name && this._normTitle(text) === this._normTitle(name)) return;
      const local = this._countryLocal(country);
      const label = local ? `${text}（${local}）` : text;
      if (seen.has(label)) return;
      seen.add(label);
      picked.push(label);
    };

    // ① + ②
    try {
      // v2.5.57：子页结果由 _prefetchReleaseInfo() 统一预取并缓存（与上映日期共用同一次请求）；
      // 单独调用本方法时缓存可能还不存在，这里补抓一次。
      await this._prefetchReleaseInfo();
      const cache = this._releaseInfoCache;
      const rows = (cache && cache.href === href && Array.isArray(cache.akas)) ? cache.akas : [];
      rows.forEach(row => pushOne(row.title, row.country));
    } catch (e) {
      ClipMateLog.debug('[ImdbExtractor] 别名子页解析失败，改用主页数据:', e && e.message);
    }

    // ③ 主页兜底
    if (picked.length === 0) {
      try {
        const data = this._readPageData();
        const edges = data && data.mainColumnData
          && data.mainColumnData.akas
          && data.mainColumnData.akas.edges;
        if (Array.isArray(edges)) {
          edges.forEach((edge) => {
            const node = edge && edge.node;
            if (node && node.text) pushOne(node.text, '');
          });
        }
      } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    }

    const value = picked.slice(0, 20).join(', ');
    this._aliasCache = { href, value };
    return value;
  }

  // ========== 聚合方法 ==========

  async extractAllFields() {
    try {
      // v2.5.57：先把两个子页请求并行发出去，供「上映日期 / 导演 / 别名」共用。
      // 两者互不依赖、并行等待，最坏等待时间 ≈ 较慢的那一个（不是两个相加）。
      // 电影页：JSON-LD 自带 director/datePublished → 两个预取几乎零开销（导演那条会直接短路）。
      // 单集页 / 非影视页：两个预取方法首行就返回，行为与改动前完全一致。
      await Promise.all([
        this._prefetchReleaseInfo(),
        this._prefetchSeriesDirector()
      ]);

      const fields = {
        '名字': this.extractName(),
        '影视类型': this.extractMediaType(),
        '上映日期': this.extractReleaseDate(),
        '简介': this.extractDescription(),
        '片长': this.extractDuration(),
        '网络评分': this.extractRating(),
        'IMDB': this.extractUrl(),
        '导演': this.extractDirector(),
        '编剧': this.extractWriter(),
        '主演': this.extractCast(),
        '其他信息': this.extractOtherInfo(),
        // v2.5.55 新增（非电影页/剧集页一律返回空字符串）
        '国家': this.extractCountry(),
        '原作名': this.extractOriginalTitle(),
        '集数': this.extractEpisodes(),
        '单集片长': this.extractEpisodeRuntime(),
        '别名': await this.extractAliases(),
        // v2.12.0：类型 → 标准标签（英文 genre 经统一转化库转中文标准词）
        '标签': this.extractTags()
      };
      return fields;
    } catch (error) {
      console.error('[ImdbExtractor] 提取所有字段失败:', error);
      return {};
    }
  }
}

window.ImdbExtractor = ImdbExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['imdb'] = ImdbExtractor;
window.domainExtractorMap = window.domainExtractorMap || {};
window.domainExtractorMap['www.imdb.com'] = ImdbExtractor;
