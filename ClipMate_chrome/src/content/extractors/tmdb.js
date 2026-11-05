/**
 * TMDB (www.themoviedb.org) 影视页面提取器
 *
 * 策略：优先读页面自带的结构化数据 JSON-LD（@type: Movie / TVSeries），
 * 再通过 DOM 兜底（crew / cast / facts 列表）。
 *
 * 实机验证（Zen，中文界面）：
 * - 电影 https://www.themoviedb.org/movie/278  → 肖申克的救赎
 * - 剧集 https://www.themoviedb.org/tv/1396    → 绝命毒师
 *
 * JSON-LD 可用字段：
 *   Movie     : name / description / url / aggregateRating.ratingValue(10分制)
 *               countryOfOrigin[].name / duration(PT2H22M) / genre[] / releasedEvent[0].startDate
 *   TVSeries  : name / description / url / aggregateRating / countryOfOrigin[]
 *               numberOfEpisodes / startDate / endDate / genre[]
 *   ※ 剧集没有 duration，也没有 releasedEvent，所以「片长」留空、「上映日期」取 startDate
 */

/**
 * 「完整演职员表」解析结果缓存（10 分钟）
 * 键：`/movie/278|<语言>`；值：{ ts, data }
 * 目的：反复开关浮窗时不重复请求 TMDB（每次提取要下载 0.5～1MB）
 */
const TMDB_CAST_TTL = 10 * 60 * 1000;
const TMDB_CAST_CACHE = new Map();

/** 是否含中日韩文字（用来区分「中文名」和「英文名」） */
const TMDB_CJK = /[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

class TmdbExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'tmdb';
    this.mediaType = 'movie';
    this.isSocialPlatform = false;
  }

  // ========== 基础读取 ==========

  /**
   * 读取 TMDB 的 JSON-LD。
   * 页面的 script 内容被包在 `/* <![CDATA[ *\/ ... /* ]]> *\/` 里，需要先剥掉。
   * 页面同时有 WebSite / SearchAction 等其它 ld+json 块，只取 Movie / TVSeries。
   */
  _readJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        let raw = (script.textContent || '').trim();
        if (!raw) continue;
        raw = raw
          .replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, '')
          .replace(/\/\*\s*\]\]>\s*\*\/$/, '')
          .trim();
        let json = null;
        try {
          json = JSON.parse(raw);
        } catch (e) {
          continue;
        }
        if (json && (json['@type'] === 'Movie' || json['@type'] === 'TVSeries')) {
          return json;
        }
      }
    } catch (e) {
      console.warn('[TmdbExtractor] JSON-LD 解析失败:', e.message);
    }
    return null;
  }

  /** 当前是否为剧集页面 */
  _isTv() {
    try {
      if (/^\/tv\//.test(window.location.pathname)) return true;
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    const ld = this._readJsonLd();
    return !!(ld && ld['@type'] === 'TVSeries');
  }

  /**
   * 读取「基础信息」区的键值对（.facts p）
   * 形如：原名 The Shawshank Redemption / 状态 已上映 / 默认语言 英语 / 预算 $25,000,000
   */
  _readFacts() {
    const map = {};
    try {
      const ps = document.querySelectorAll('.facts p');
      for (const p of ps) {
        const labelEl = p.querySelector('bdi, strong, b');
        let label = labelEl ? labelEl.textContent.replace(/\s+/g, ' ').trim() : '';
        let text = (p.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (!label) {
          const idx = text.indexOf(' ');
          if (idx > 0) {
            label = text.slice(0, idx);
            text = text.slice(idx + 1).trim();
          }
        } else if (text.startsWith(label)) {
          text = text.slice(label.length).trim();
        }
        if (label && text) map[label] = text;
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 读取 facts 失败:', e.message);
    }
    return map;
  }

  /**
   * 读取页头演职员区（.header_info）
   * DOM 结构是「p(人名，含 a)」与「p.character(角色)」交替出现：
   *   <p><a>弗兰克·德拉邦特</a></p><p class="character">Director, Screenplay</p>
   *   <p><a>斯蒂芬·金</a></p><p class="character">Novel</p>
   */
  _readCrew() {
    const result = { director: [], writer: [], novel: [] };
    try {
      const ps = document.querySelectorAll('.header_info p');
      const pairs = [];
      let pendingName = '';
      for (const p of ps) {
        if (p.classList && p.classList.contains('character')) {
          const role = (p.textContent || '').replace(/\s+/g, ' ').trim();
          if (pendingName && role) {
            pairs.push([pendingName, role]);
            pendingName = '';
          }
        } else {
          const a = p.querySelector('a');
          const name = a ? (a.textContent || '').replace(/\s+/g, ' ').trim() : '';
          pendingName = name;
        }
      }

      for (const [name, role] of pairs) {
        const r = role.toLowerCase();
        // 摄影/制片/音乐等岗位不算导演
        const isCrewNoise = /photography|producer|music|sound|editing|art|costume/i.test(r);
        if (!isCrewNoise && /director|导演/.test(r)) {
          if (!result.director.includes(name)) result.director.push(name);
        }
        if (/screenplay|writer|story|creator|原创作者|编剧/.test(r)) {
          if (!result.writer.includes(name)) result.writer.push(name);
        }
        if (/novel|原著|based on/.test(r)) {
          if (!result.novel.includes(name)) result.novel.push(name);
        }
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 读取演职员失败:', e.message);
    }
    return result;
  }

  // ========== 完整演职员表（中英双语）==========
  //
  // 取数思路（已实机验证）：
  //   1. 影片的「完整演职员表」页 = 影片地址 + /cast，按 11 个部门分组；
  //   2. 同一页面加 ?language=en-US 可拿到同一批人的**官方英文名**；
  //   3. 人名链接固定是 /person/{personId}-{slug}，personId 跨语言稳定，
  //      实测中英文前 40 人对齐 40/40、前 20 顺序完全一致，用它配对最可靠；
  //   4. 中文界面下没有中文译名的人会直接显示英文（如 Brian Libby），
  //      这类人只输出英文，符合「只有英文就只提取英文」的要求。

  /** 影片根路径：/movie/278-the-shawshank-redemption/cast → /movie/278 */
  _basePath() {
    try {
      const m = String(window.location.pathname).match(/^\/(movie|tv)\/\d+/);
      return m ? m[0] : '';
    } catch (e) {
      return '';
    }
  }

  /** 当前 URL 自带的语言参数（TMDB 支持 ?language=zh-CN） */
  _langParam() {
    try {
      const m = String(window.location.search).match(/[?&]language=([\w-]+)/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  /** 是否正停在「完整演职员表」页面（此时当前 DOM 就是中文数据，省一次请求） */
  _isCastPage() {
    try {
      return /\/cast\/?$/.test(String(window.location.pathname));
    } catch (e) {
      return false;
    }
  }

  /** 页面人名看起来是否是中文（用来判断要不要再请求一次英文版） */
  _pageLooksChinese() {
    try {
      const names = [...document.querySelectorAll('ol.people.scroller p a')]
        .slice(0, 5)
        .map((a) => (a.textContent || '').trim())
        .filter(Boolean);
      if (!names.length) return true;
      return names.some((n) => TMDB_CJK.test(n));
    } catch (e) {
      return true;
    }
  }

  /**
   * 请求完整演职员表并解析
   * @param {string} base 形如 /movie/278
   * @param {string} lang 语言参数，空字符串表示跟随页面当前语言
   */
  async _fetchCastDoc(base, lang) {
    const url = base + '/cast' + (lang ? `?language=${lang}` : '');
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
    try {
      const resp = await fetch(url, {
        credentials: 'include',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!resp || !resp.ok) {
        console.warn('[TmdbExtractor] 演职员表请求失败:', resp && resp.status);
        return null;
      }
      const html = await resp.text();
      if (!html) return null;
      return new DOMParser().parseFromString(html, 'text/html');
    } catch (e) {
      console.warn('[TmdbExtractor] 演职员表请求异常:', e.message);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * 从演职员表文档里取出「演员列表」和「按部门分组的职员」
   * @returns {{actors: Array, crew: Object}}
   */
  _parseCastDoc(doc) {
    const readOne = (li) => {
      const a = li.querySelector('.info p a') || li.querySelector('p a');
      if (!a) return null;
      const href = a.getAttribute('href') || '';
      const idMatch = href.match(/\/person\/(\d+)/);
      const slugMatch = href.match(/\/person\/\d+-([^/?#]+)/);
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (!name) return null;
      const roleEl = li.querySelector('p.episode_count_crew') || li.querySelector('p.character');
      const roleRaw = roleEl ? (roleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const epMatch = roleRaw.match(/共\s*(\d+)\s*集/);
      return {
        id: idMatch ? idMatch[1] : '',
        slug: slugMatch ? slugMatch[1] : '',
        name,
        roleRaw,
        // 比较前先去掉「(共 N 集)」
        role: roleRaw.replace(/[（(]\s*共\s*\d+\s*集\s*[）)]/g, '').trim(),
        episodes: epMatch ? parseInt(epMatch[1], 10) : 0
      };
    };

    const result = { actors: [], crew: {} };
    try {
      // 演员区：唯一一个没有 crew 类的 ol.people.credits
      const actorOl = doc.querySelector('ol.people.credits:not(.crew)');
      if (actorOl) {
        result.actors = [...actorOl.querySelectorAll('li')].map(readOne).filter(Boolean);
      }
      // 职员区：每个部门一个 div.crew_wrapper（h4 标题 + ol 列表）
      // 注意不能全局取 h4：中文页的 cookie 弹窗里也有 h4
      for (const wrapper of doc.querySelectorAll('div.crew_wrapper')) {
        const h = wrapper.querySelector('h4');
        const ol = wrapper.querySelector('ol');
        const label = h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : '';
        if (!label || !ol) continue;
        result.crew[label] = [...ol.querySelectorAll('li')].map(readOne).filter(Boolean);
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 解析演职员表失败:', e.message);
    }
    return result;
  }

  /** 职位是否真的是「导演」（排除副导演/场记/剧本统筹等） */
  _isDirectorRole(role) {
    const r = String(role || '').toLowerCase();
    if (!r) return false;
    if (/assistant|second|third|unit|script|supervisor|coordinator|casting|producer/.test(r)) return false;
    return /^(series\s+)?director$/.test(r) || r === '导演';
  }

  /** 职位是否算「编剧」（含原著作者 Novel，与豆瓣口径一致） */
  _isWriterRole(role) {
    const r = String(role || '').toLowerCase();
    if (!r) return false;
    if (/coordinator|supervisor|assistant/.test(r)) return false;
    return /writer|screenplay|screenstory|teleplay|novel|story|creator|author|编剧|原著/.test(r);
  }

  /** 剧集按「共 N 集」从多到少排（电影所有人集数为 0，保持原顺序） */
  _sortByEpisodes(list) {
    const hasEpisodes = list.some((p) => p.episodes > 0);
    if (!hasEpisodes) return list.slice();
    return list.slice().sort((a, b) => b.episodes - a.episodes);
  }

  /** 链接 slug 兜底转英文名：tim-robbins → Tim Robbins（仅在英文版请求失败时用） */
  _slugToName(slug) {
    if (!slug) return '';
    return String(slug)
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  /**
   * 拼成「中文名 英文名」，多人用 `, ` 隔开，最多 limit 人
   * 注意：中英文之间必须用空格，不能用斜杠 —— processCrewNames() 会按 /[,，、/]/ 切人名，
   *      用斜杠会把一个人拆成两个人（剧集 processTvData 会无条件调用它）。
   */
  _joinPeople(list, enMap, limit) {
    const out = [];
    const max = limit || 20;
    for (const p of list) {
      const cn = (p.name || '').trim();
      if (!cn) continue;
      let en = enMap && p.id ? enMap.get(p.id) || '' : '';
      // 英文版没取到、且中文名确实是中文时才用 slug 兜底
      if (!en && p.slug && TMDB_CJK.test(cn)) en = this._slugToName(p.slug);
      let label;
      if (!en) label = cn;
      else if (!TMDB_CJK.test(cn)) label = cn; // 界面是英文，显示名本身就是英文
      else if (cn.toLowerCase() === en.toLowerCase()) label = en;
      else label = cn + ' ' + en;
      if (label && !out.includes(label)) out.push(label);
      if (out.length >= max) break;
    }
    return out.join(', ');
  }

  /** 右下角轻提示（只在真要发请求时出现，结束立即移除） */
  _showHint(text) {
    try {
      this._hideHint();
      const el = document.createElement('div');
      el.id = 'clipmate-tmdb-cast-hint';
      el.textContent = text;
      el.style.cssText =
        'position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:10px 16px;border-radius:8px;' +
        'background:rgba(24,26,32,0.92);color:#fff;font:13px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;' +
        'box-shadow:0 6px 20px rgba(0,0,0,0.28);pointer-events:none;';
      document.body.appendChild(el);
      this._hintEl = el;
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
  }

  _hideHint() {
    try {
      if (this._hintEl && this._hintEl.parentNode) this._hintEl.parentNode.removeChild(this._hintEl);
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    this._hintEl = null;
  }

  /** 取演职员数据（实例内共享一个 Promise，模块级缓存 10 分钟） */
  _loadCastData() {
    if (!this._castDataPromise) {
      this._castDataPromise = this._buildCastData();
    }
    return this._castDataPromise;
  }

  async _buildCastData() {
    const base = this._basePath();
    if (!base) return null;
    const lang = this._langParam();
    const key = base + '|' + (lang || 'default');

    const cached = TMDB_CAST_CACHE.get(key);
    if (cached && Date.now() - cached.ts < TMDB_CAST_TTL) return cached.data;

    const needBoth = this._pageLooksChinese();
    this._showHint(needBoth ? '正在读取 TMDB 完整演职员表（中英双语）…' : '正在读取 TMDB 完整演职员表…');
    try {
      const zhTask = this._isCastPage()
        ? Promise.resolve(this._parseCastDoc(document))
        : this._fetchCastDoc(base, lang).then((doc) => (doc ? this._parseCastDoc(doc) : null));
      const tasks = [zhTask];
      if (needBoth) {
        tasks.push(this._fetchCastDoc(base, 'en-US').then((doc) => (doc ? this._parseCastDoc(doc) : null)));
      }

      const [zh, en] = await Promise.all(tasks);
      if (!zh) return null;

      // 英文名索引：personId → 英文名
      const enMap = new Map();
      if (en) {
        en.actors.forEach((p) => {
          if (p.id) enMap.set(p.id, p.name);
        });
        Object.keys(en.crew).forEach((label) => {
          en.crew[label].forEach((p) => {
            if (p.id && !enMap.has(p.id)) enMap.set(p.id, p.name);
          });
        });
      }

      const data = { actors: zh.actors, crew: zh.crew, enMap };
      TMDB_CAST_CACHE.set(key, { ts: Date.now(), data });
      if (TMDB_CAST_CACHE.size > 6) {
        const oldest = [...TMDB_CAST_CACHE.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
        if (oldest) TMDB_CAST_CACHE.delete(oldest[0]);
      }
      return data;
    } catch (e) {
      console.warn('[TmdbExtractor] 读取完整演职员表失败:', e.message);
      return null;
    } finally {
      this._hideHint();
    }
  }

  /** 主页演员卡片（旧逻辑，作为最后回落） */
  _readScrollerCast() {
    const names = [];
    const push = (raw) => {
      const t = (raw || '').replace(/\s+/g, ' ').trim();
      if (t && !names.includes(t)) names.push(t);
    };
    try {
      const cards = document.querySelectorAll('ol.people.scroller > li.card');
      for (const li of cards) {
        if (li.classList && li.classList.contains('filler')) continue;
        const nameLink = li.querySelector('p a');
        if (nameLink) {
          push(nameLink.textContent);
        } else {
          const img = li.querySelector('img[alt]');
          if (img) push(img.getAttribute('alt'));
        }
        if (names.length >= 20) break;
      }
      if (names.length === 0) {
        const imgs = document.querySelectorAll('ol.people.scroller img[alt]');
        for (const img of imgs) {
          push(img.getAttribute('alt'));
          if (names.length >= 20) break;
        }
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 读取主页主演失败:', e.message);
    }
    return names.join(', ');
  }

  // ========== 格式化小工具 ==========

  /** "1994-09-23" / "2008-01-20T00:00:00Z" → "1994/09/23" */
  _formatDate(value) {
    if (!value) return '';
    const m = String(value).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
    }
    const y = String(value).match(/(\d{4})/);
    return y ? y[1] : '';
  }

  /** "PT2H22M" → "142分钟"（与豆瓣「142分钟」写法一致） */
  _formatDuration(isoDuration) {
    if (!isoDuration) return '';
    const h = String(isoDuration).match(/(\d+)H/);
    const m = String(isoDuration).match(/(\d+)M/);
    const total = (h ? parseInt(h[1], 10) : 0) * 60 + (m ? parseInt(m[1], 10) : 0);
    return total > 0 ? `${total}分钟` : '';
  }

  /** 评分保留一位小数：8.733 → "8.7"，9 → "9.0" */
  _formatScore(value) {
    const num = parseFloat(value);
    if (isNaN(num)) return '';
    if (num <= 0 || num > 10) return '';
    return num.toFixed(1);
  }

  /**
   * 金额写法：$25,000,000 → "2500万美元"
   * 原因：通用的「其他信息」清理会把半角逗号统一成中文逗号（data-processors.processCommonFields），
   * 原样带入 "$25,000,000" 会显示成 "$25，000，000"，所以在这里先转成中文习惯的「万美元」。
   */
  _formatMoney(raw) {
    const s = String(raw || '').trim();
    const m = s.match(/^\$\s*([\d,]+)$/);
    if (!m) return s;
    const num = parseInt(m[1].replace(/,/g, ''), 10);
    if (!num || num < 10000) return s;
    return `${Math.round(num / 10000)}万美元`;
  }

  // ========== 各字段提取 ==========

  extractName() {
    const ld = this._readJsonLd();
    if (ld && ld.name) return ld.name.trim();
    // 兜底：h2 形如「肖申克的救赎 (1994)」，去掉尾部年份
    try {
      const h2 = document.querySelector('h2');
      if (h2) {
        const t = (h2.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return t.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    try {
      const og = document.querySelector('meta[property="og:title"]');
      if (og && og.content) return og.content.trim();
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractMediaType() {
    return this._isTv() ? '剧集' : '电影';
  }

  extractCountry() {
    const ld = this._readJsonLd();
    if (ld && Array.isArray(ld.countryOfOrigin) && ld.countryOfOrigin.length > 0) {
      const names = ld.countryOfOrigin
        .map(c => (typeof c === 'string' ? c : c && c.name))
        .filter(Boolean)
        .map(s => String(s).trim());
      if (names.length > 0) return BaseExtractor.standardizeRegionNames(names);
    }
    return '';
  }

  extractReleaseDate() {
    const ld = this._readJsonLd();
    if (ld) {
      // 电影：releasedEvent[0].startDate（首个上映事件，通常是最早的）
      if (Array.isArray(ld.releasedEvent) && ld.releasedEvent.length > 0) {
        for (const ev of ld.releasedEvent) {
          if (ev && ev.startDate) return this._formatDate(ev.startDate);
        }
      }
      // 剧集：startDate（首播日期）
      if (ld.startDate) return this._formatDate(ld.startDate);
    }
    // 兜底：页面标签只有年份，如 "(1994)"
    try {
      const tag = document.querySelector('.tag.release_date');
      if (tag) {
        const y = (tag.textContent || '').match(/(\d{4})/);
        if (y) return y[1];
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractDescription() {
    const ld = this._readJsonLd();
    if (ld && ld.description) return this.cleanText(ld.description);
    try {
      const el = document.querySelector('.overview');
      if (el) return this.cleanText(el.textContent || '');
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractRating() {
    const ld = this._readJsonLd();
    if (ld && ld.aggregateRating && ld.aggregateRating.ratingValue !== undefined) {
      const s = this._formatScore(ld.aggregateRating.ratingValue);
      if (s) return s;
    }
    // 兜底：图表上的百分比（87 → 8.7）
    try {
      const chart = document.querySelector('.user_score_chart');
      if (chart) {
        const percent = chart.getAttribute('data-percent');
        if (percent) return this._formatScore(parseFloat(percent) / 10);
      }
    } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
    return '';
  }

  extractOriginalTitle() {
    const facts = this._readFacts();
    return facts['原名'] || facts['原始片名'] || '';
  }

  extractUrl() {
    const ld = this._readJsonLd();
    if (ld && ld.url) return String(ld.url).split('?')[0];
    try {
      return String(window.location.href).split('?')[0].split('#')[0];
    } catch (e) {
      return '';
    }
  }

  /**
   * 导演：取「完整演职员表」里的「导演」部门
   * 该部门混着副导演、场记、剧本统筹，必须按职位精确筛，只留真正的 Director。
   * 剧集按集数从多到少排（页面默认按人名排，直接取前 20 会漏掉核心导演）。
   * 最多 20 人；取不到时回落到页头演职员区。
   */
  async extractDirector() {
    try {
      const data = await this._loadCastData();
      if (data) {
        const list = data.crew['导演'] || data.crew['Directing'] || [];
        const picked = this._sortByEpisodes(list.filter((p) => this._isDirectorRole(p.role)));
        if (picked.length > 0) return this._joinPeople(picked, data.enMap, 20);
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 导演提取失败:', e.message);
    }
    const crew = this._readCrew();
    return crew.director.join(', ');
  }

  /**
   * 编剧：取「编剧」部门全部（含原著作者 Novel，与豆瓣口径一致），
   * 排除协调/场记类岗位；剧集按集数降序；最多 20 人。
   */
  async extractWriter() {
    try {
      const data = await this._loadCastData();
      if (data) {
        const list = data.crew['编剧'] || data.crew['Writing'] || [];
        const picked = this._sortByEpisodes(list.filter((p) => this._isWriterRole(p.role)));
        if (picked.length > 0) return this._joinPeople(picked, data.enMap, 20);
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 编剧提取失败:', e.message);
    }
    const crew = this._readCrew();
    return crew.writer.join(', ');
  }

  /**
   * 主演：取「完整演职员表」演员区前 20 人（本身按集数降序，主要演员在前）
   * 取不到时回落到主页的演员卡片（旧逻辑，主页只有 9 张卡）。
   */
  async extractCast() {
    try {
      const data = await this._loadCastData();
      if (data && data.actors.length > 0) {
        return this._joinPeople(data.actors, data.enMap, 20);
      }
    } catch (e) {
      console.warn('[TmdbExtractor] 主演提取失败:', e.message);
    }
    return this._readScrollerCast();
  }

  extractRuntime() {
    // 只有电影有 duration；剧集的时长按集计算的字段 TMDB 页面不提供
    if (this._isTv()) return '';
    const ld = this._readJsonLd();
    if (ld && ld.duration) return this._formatDuration(ld.duration);
    return '';
  }

  extractEpisodes() {
    if (!this._isTv()) return '';
    const ld = this._readJsonLd();
    if (ld && ld.numberOfEpisodes) return String(ld.numberOfEpisodes);
    return '';
  }

  /** 其他信息：类型 / 状态 / 默认语言 / 预算 / 票房 / 播出平台 / 原著 */
  extractOtherInfo() {
    const parts = [];
    const ld = this._readJsonLd();

    // v2.12.0：genre 偶尔是裸字符串，一并当数组处理（理由同 IMDb）
    if (ld && ld.genre) {
      const genres = Array.isArray(ld.genre) ? ld.genre : [ld.genre];
      if (genres.filter(Boolean).length > 0) {
        parts.push(`类型：${genres.filter(Boolean).join('、')}`);
      }
    }

    const facts = this._readFacts();
    // 「原名/原始片名」已单独成列，「类型（剧本类）」与上面的题材类型易混，均跳过
    for (const key of ['状态', '默认语言', '播出平台']) {
      const value = facts[key];
      if (value) parts.push(`${key}：${value}`);
    }
    if (facts['预算']) parts.push(`预算：${this._formatMoney(facts['预算'])}`);
    if (facts['票房']) parts.push(`票房：${this._formatMoney(facts['票房'])}`);

    const crew = this._readCrew();
    if (crew.novel.length > 0) {
      parts.push(`原著：${crew.novel.join(', ')}`);
    }

    return parts.join('，');
  }

  /**
   * v2.12.0：「标签」列 —— JSON-LD 的 genre 过统一转化库。
   *
   * TMDB 中文界面下 genre 已经是中文（剧情 / 犯罪），过一遍库是为了对齐口径：
   * 「纪录片」→「纪录」、复合词「Action & Adventure」拆成 动作+冒险、
   * 以及中文界面下仍然可能出现的英文词。
   *
   * 「其他信息 → 类型：」保留原词 —— 归一器只改「标签」列，不改写原文。
   */
  extractTags() {
    const ld = this._readJsonLd();
    const genre = ld && ld.genre;
    if (!genre) return '';
    const words = Array.isArray(genre) ? genre : [genre];
    return this._standardTags('TMDB', words, Array.isArray(genre) ? genre.join(',') : String(genre));
  }

  // ========== 聚合 ==========

  async extractAllFields() {
    try {
      // 导演/编剧/主演共用同一次「完整演职员表」请求（内部共享 Promise + 10 分钟缓存）
      const [director, writer, cast] = await Promise.all([
        this.extractDirector(),
        this.extractWriter(),
        this.extractCast()
      ]);
      return {
        '名字': this.extractName(),
        '影视类型': this.extractMediaType(),
        '国家': this.extractCountry(),
        '上映日期': this.extractReleaseDate(),
        '简介': this.extractDescription(),
        '网络评分': this.extractRating(),
        '原作名': this.extractOriginalTitle(),
        'TMDB': this.extractUrl(),
        '导演': director,
        '编剧': writer,
        '主演': cast,
        '片长': this.extractRuntime(),
        '集数': this.extractEpisodes(),
        '其他信息': this.extractOtherInfo(),
        // v2.12.0：类型 → 标准标签
        '标签': this.extractTags()
      };
    } catch (error) {
      console.error('[TmdbExtractor] 提取所有字段失败:', error);
      return {};
    }
  }
}

window.TmdbExtractor = TmdbExtractor;
