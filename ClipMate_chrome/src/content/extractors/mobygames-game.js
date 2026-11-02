/**
 * MobyGames（mobygames.com）游戏提取器
 *
 * ===== 页面结构要点（2026-10-25 实测，Chromium 156 非无头 + CDP 直读 DOM）=====
 *
 * 1. 只认一层详情页 /game/<数字ID>/<slug>/。
 *    子页（credits / covers / screenshots / reviews / releases / trivia / specs /
 *    patches / promo / stores / forum / contribute / media / adblurbs / cover /
 *    compare-credits / user-review 共 17 种）与游戏浏览列表 /game/ 都**没有**
 *    详情页的 dl.metadata 面板，靠 manifest 的 exclude_matches 在脚本注入前挡掉。
 *    （Chrome 的 matches 通配符会跨 "/"，无法只匹配一层路径，只能反向排除子页。）
 *
 * 2. 页面非 SPA，有完整的 JSON-LD @type=VideoGame：
 *    name / datePublished / gamePlatform / genre / alternateName / image / url。
 *    ⚠️ JSON-LD **没有** description、没有 aggregateRating、没有 contentRating
 *    → 简介只能读 DOM 的 #description-text，评分只能读页面。
 *
 * 3. ⚠️ JSON-LD 的 publisher 数组**不可信**：
 *    Elden Ring 返回 [FromSoftware, Inc., Bandai Namco Entertainment Inc.]，
 *    第一个 FromSoftware 其实是开发商。Half-Life 返回 [Sierra On-Line, Valve]。
 *    → 开发商 / 发行商一律从 dl.metadata 的 Developers / Publishers 行取。
 *
 * 4. ⚠️ datePublished 精度不统一：
 *    Half-Life 只有 "1998-11"（年月），BG3 是 "2020-10-06"，Elden Ring 是 "2022-02-25"。
 *    2026-10-25 用户裁决：缺的部分补 01（1998/11 → 1998/11/01）。
 *
 * 5. 评分口径（2026-10-25 用户裁决）：
 *    Moby Score 本身就是 10 分制（Half-Life 8.8 / BG3 9.0），直接写「网络评分」，
 *    原值另写进「其他信息」。另外页面还有 Critics（百分制）与 Players（5 星制）。
 *
 * 6. 官方站（dl.metadata 的 "Official Site" 行）经常指向 archive.org 的存档页
 *    （Half-Life 就是 web.archive.org 快照）。2026-10-25 用户裁决：照原样取，不筛。
 *
 * 7. 别名两处来源：JSON-LD 的 alternateName（全，含 "HL" "BG3" 这类缩写和
 *    日/韩/繁中/简中写法）+ 页面 "Spellings" 区块（只有本地化写法）。
 *    用户裁决全取 → 两处合并去重。
 *
 * 8. Steam 链接在页面 "Buy Now" 区块，形如 store.steampowered.com/app/<id>/，
 *    老游戏（Half-Life 155 / BG3 150689 / Elden Ring 174989 实测都有）也可能没有。
 */

/**
 * MobyGames 的 genre 是它自有的分类词（"Role-playing (RPG)" / "Action"…），
 * 与 Metacritic 的英文词不完全重合，所以这里单独建一张表。
 * 查不到的保留英文原文，不硬翻。
 */
const MOBY_GENRE_CN = {
  'action': '动作',
  'adventure': '冒险',
  'role-playing (rpg)': '角色扮演',
  'role-playing': '角色扮演',
  'rpg': '角色扮演',
  'strategy': '策略',
  'simulation': '模拟',
  'sports': '体育',
  'racing': '竞速',
  'racing / driving': '竞速',
  'driving': '竞速',
  'puzzle': '解谜',
  'educational': '教育',
  'compilation': '合集',
  'card & board game': '卡牌桌游',
  'board game': '桌面游戏',
  'card game': '卡牌',
  'music': '音乐',
  'rhythm': '音乐节奏',
  'fighting': '格斗',
  'shooter': '射击',
  'platformer': '平台跳跃',
  'miscellaneous': '其他',
  'special edition': '特别版'
};

/**
 * 平台名的本地补充（不改共享的 platform-utils.js，避免影响其它站）。
 * 共享表里只有 'Xbox Series X/S'，没有裸 'Xbox Series'；
 * 也没有 MobyGames 惯用的 'Macintosh'（共享表用 macOS / Mac）。
 */
const MOBY_PLATFORM_FIX = {
  'xbox series': 'Xbox Series X/S',
  'macintosh': 'macOS'
};

class MobygamesGameExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'mobygames';
    this.mediaType = 'game';
    this.isSocialPlatform = false;
  }

  /**
   * 只认 /game/<数字ID>/<slug>/ 一层。
   * 排除 /game/（列表页）与 17 种子页。
   * 注意：当前注册链路走 ExtractorFactory 的 URL 正则，本方法暂未被调用，
   * 保留它是为了与 17K / Goodreads / Metacritic 等提取器保持一致的接口形态。
   */
  // ====== 通用小工具 ======

  /** 取元素文本，压掉多余空白 */
  _text(el) {
    if (!el) return '';
    return String(el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** 字符串压空白 */
  _clean(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 读页面上的 JSON-LD，只认 @type 为 VideoGame 的那段 */
  _readJsonLd() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (let i = 0; i < scripts.length; i++) {
        let json = null;
        try {
          json = JSON.parse(scripts[i].textContent || '');
        } catch (e) {
          continue;
        }
        const list = Array.isArray(json) ? json : [json];
        for (let j = 0; j < list.length; j++) {
          const item = list[j];
          if (!item) continue;
          if (item['@type'] === 'VideoGame') return item;
          if (Array.isArray(item['@graph'])) {
            const found = item['@graph'].find((x) => x && x['@type'] === 'VideoGame');
            if (found) return found;
          }
        }
      }
    } catch (e) {
      console.warn('[MobyGames] 读取 JSON-LD 失败:', e && e.message);
    }
    return null;
  }

  /**
   * 在页面的 dl.metadata 面板里按 dt 文本找对应的 dd 元素。
   * 实测结构：
   *   <dl class="metadata">
   *     <dt>Developers</dt><dd><ul><li><a>Valve L.L.C.</a></li></ul></dd>
   *     <dt>Official Site</dt><dd><a href="...">Visit</a></dd>
   *   </dl>
   */
  _findMetaDd(label) {
    const target = String(label || '').toLowerCase();
    const dls = document.querySelectorAll('dl.metadata');
    for (let i = 0; i < dls.length; i++) {
      const dts = dls[i].querySelectorAll('dt');
      for (let j = 0; j < dts.length; j++) {
        // dt 文本可能带 " +" 展开标记（如 "Series +"）
        const name = this._clean(dts[j].textContent).replace(/\s*\+\s*$/, '').toLowerCase();
        if (name !== target) continue;

        let el = dts[j].nextElementSibling;
        while (el && el.tagName !== 'DD') el = el.nextElementSibling;
        return el || null;
      }
    }
    return null;
  }

  /** 取某个 dt 行的纯文本（dd 不存在返回 ''） */
  _metaValue(label) {
    return this._clean(this._text(this._findMetaDd(label)));
  }

  /** 取某个 dt 行里所有 <a> 的文本（去重保序） */
  _metaLinkTexts(label) {
    const dd = this._findMetaDd(label);
    if (!dd) return [];
    const out = [];
    const links = dd.querySelectorAll('a');
    for (let i = 0; i < links.length; i++) {
      const t = this._clean(links[i].textContent);
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }

  // ====== 字段提取 ======

  /**
   * 判断当前是不是真的游戏详情页。
   * ⚠️ 不存在的 ID（如 /game/999999999/fake-game/）**返回 200**，不是 404：
   *    标题是 "Game not found - MobyGames"，h1 为空，没有 JSON-LD。
   *    所以「有 h1 或有 VideoGame JSON-LD」才算详情页，否则一律返回空字段，
   *    避免把 "Game not found" 当成游戏名写进表格。
   */
  _isGameDetailPage() {
    const ld = this._readJsonLd();
    if (ld && this._clean(ld.name)) return true;
    return !!this._clean(this._text(document.querySelector('h1')));
  }

  extractGameName() {
    const ld = this._readJsonLd();
    if (ld && ld.name) {
      const n = this._clean(ld.name);
      if (n) return n;
    }

    const h1 = this._clean(this._text(document.querySelector('h1')));
    if (h1) return h1;

    // og:title 形如 "Half-Life (1998) - MobyGames"
    const og = document.querySelector('meta[property="og:title"]');
    if (og) {
      const raw = String(og.getAttribute('content') || '');
      const name = raw
        .replace(/\s*-\s*MobyGames\s*$/i, '')
        .replace(/\s*\(\d{4}\)\s*$/, '')
        .trim();
      // 不存在的游戏页标题是 "Game not found"，不能当游戏名
      if (name && !/^game not found$/i.test(name)) return name;
    }
    return '';
  }

  /**
   * 发行日期：JSON-LD datePublished 为主（精度不定），
   * 缺的部分按用户裁决补 01；取不到再解析 dl 的 "Released" 行。
   */
  extractReleaseDate() {
    const ld = this._readJsonLd();
    const fromLd = this._formatLooseDate(ld ? ld.datePublished : '');
    if (fromLd) return fromLd;

    // 兜底：dl "Released" 行，形如 "November 1998 on Windows" / "August 3, 2023 on Windows"
    return this._formatHumanDate(this._metaValue('Released'));
  }

  /**
   * 把 "2022-02-25" / "1998-11" / "1998" 统一成 YYYY/MM/DD。
   * 年月缺失的日、只有年的月日，一律补 01（用户 2026-10-25 裁决）。
   */
  _formatLooseDate(value) {
    const s = this._clean(value);
    if (!s) return '';
    const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!m) return '';
    const year = m[1];
    const month = m[2] ? m[2].padStart(2, '0') : '01';
    const day = m[3] ? m[3].padStart(2, '0') : '01';
    return `${year}/${month}/${day}`;
  }

  /** "August 3, 2023 on Windows" / "November 1998 on Windows" / "1998 on Windows" → 日期 */
  _formatHumanDate(value) {
    const s = this._clean(value);
    if (!s) return '';
    const months = {
      january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
      jan: '01', feb: '02', mar: '03', apr: '04', jun: '06', jul: '07', aug: '08',
      sep: '09', sept: '09', oct: '10', nov: '11', dec: '12'
    };

    // 月 日, 年
    let m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (m) {
      const month = months[m[1].toLowerCase()];
      if (month) return `${m[3]}/${month}/${m[2].padStart(2, '0')}`;
    }
    // 月 年
    m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{4})/);
    if (m) {
      const month = months[m[1].toLowerCase()];
      if (month) return `${m[2]}/${month}/01`;
    }
    // 只有年
    m = s.match(/(\d{4})/);
    if (m) return `${m[1]}/01/01`;
    return '';
  }

  extractPlatforms() {
    const ld = this._readJsonLd();
    let list = ld ? ld.gamePlatform : null;
    if (!list) return [];
    if (!Array.isArray(list)) list = [list];

    const cleaned = [];
    for (let i = 0; i < list.length; i++) {
      let name = this._clean(list[i]);
      if (!name) continue;
      // 本地补充几处共享表没覆盖的写法（不动共享模块）
      const fixed = MOBY_PLATFORM_FIX[name.toLowerCase()];
      if (fixed) name = fixed;
      if (cleaned.indexOf(name) === -1) cleaned.push(name);
    }
    if (!cleaned.length) return [];

    // 复用共享的平台标准化（PlayStation 5 → PS5、Windows → PC…）
    try {
      if (window.PlatformUtils && typeof window.PlatformUtils.standardizePlatforms === 'function') {
        return window.PlatformUtils.standardizePlatforms(cleaned);
      }
    } catch (e) {
      console.warn('[MobyGames] 平台标准化失败，使用原始名称:', e && e.message);
    }
    return cleaned;
  }

  /**
   * 网络评分：Moby Score 本身就是 10 分制，直接用，保留一位小数。
   * 取 div.mobyscore（实测最稳）；取不到再解析 dl 的 "Moby Score" 行（"8.8 #147 of 29.2K"）。
   */
  extractRating() {
    const el = document.querySelector('.mobyscore');
    const direct = this._clean(this._text(el));
    if (/^\d+(\.\d+)?$/.test(direct)) {
      return (Math.round(parseFloat(direct) * 10) / 10).toFixed(1);
    }

    const fromMeta = this._metaValue('Moby Score').match(/^(\d+(?:\.\d+)?)/);
    if (fromMeta) return (Math.round(parseFloat(fromMeta[1]) * 10) / 10).toFixed(1);
    return '';
  }

  /**
   * 简介：读 #description-text 里的 <p> 逐段拼接（段落之间空一行）。
   * ⚠️ 不能直接用 textContent —— 遇到 <br> 不会出换行（豆瓣/YouTube 都踩过）。
   * 页面上的 line-clamp 只是 CSS 视觉截断，取到的仍是全文。
   */
  extractDescription() {
    const box = document.getElementById('description-text');
    if (box) {
      const ps = box.querySelectorAll('p');
      if (ps.length) {
        const parts = [];
        for (let i = 0; i < ps.length; i++) {
          const t = this._clean(ps[i].textContent);
          if (t) parts.push(t);
        }
        if (parts.length) return parts.join('\n\n');
      }
      const raw = String(box.textContent || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (raw) return raw;
    }

    const og = document.querySelector('meta[property="og:description"], meta[name="description"]');
    if (og) return this._clean(og.getAttribute('content'));
    return '';
  }

  /** 开发商：dl "Developers" 行的全部公司（一般 1 个，可能多个） */
  extractDeveloper() {
    const names = this._metaLinkTexts('Developers');
    if (names.length) return names.join(', ');
    return this._metaValue('Developers');
  }

  /**
   * 发行商：dl "Publishers" 行。
   * 2026-10-25 用户裁决：只取第一个（MobyGames 会把各地区代理全列出来，最长见 6 个）。
   */
  extractPublisher() {
    const names = this._metaLinkTexts('Publishers');
    if (names.length) return names[0];
    const raw = this._metaValue('Publishers');
    if (!raw) return '';
    return this._clean(raw.split(/[,，]/)[0]);
  }

  /** 分级：优先 ESRB（北美），其次 PEGI（欧），再找任何 "xxx Rating" 行 */
  extractContentRating() {
    const esrb = this._metaValue('ESRB Rating');
    if (esrb) return 'ESRB ' + esrb;

    const pegi = this._metaValue('PEGI Rating');
    if (pegi) return 'PEGI ' + pegi;

    // 兜底：遍历所有 dt，找以 Rating 结尾的
    const dts = document.querySelectorAll('dl.metadata dt');
    for (let i = 0; i < dts.length; i++) {
      const name = this._clean(dts[i].textContent);
      if (!/Rating$/i.test(name)) continue;
      let el = dts[i].nextElementSibling;
      while (el && el.tagName !== 'DD') el = el.nextElementSibling;
      const value = this._clean(this._text(el));
      if (value) return name.replace(/\s*Rating$/i, '') + ' ' + value;
    }
    return '';
  }

  /** 游戏类型：JSON-LD genre → 中文；查不到保留原文 */
  extractGenreText() {
    const ld = this._readJsonLd();
    let raw = ld ? ld.genre : null;
    if (!raw) raw = this._metaValue('Genre');
    if (!raw) return '';

    const items = Array.isArray(raw) ? raw : [raw];
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const name = this._clean(items[i]);
      if (!name) continue;
      const cn = MOBY_GENRE_CN[name] || MOBY_GENRE_CN[name.toLowerCase()] || name;
      if (out.indexOf(cn) === -1) out.push(cn);
    }
    return out.join('、');
  }

  /**
   * 别名：JSON-LD alternateName（全）+ 页面 "Spellings" 区块，合并去重。
   * 两处都不含游戏本名（实测），但仍防御性剔除。
   */
  extractAliases() {
    const out = [];
    const push = (name) => {
      const n = this._clean(name);
      if (!n) return;
      if (out.indexOf(n) !== -1) return;
      out.push(n);
    };

    const ld = this._readJsonLd();
    if (ld && ld.alternateName) {
      const list = Array.isArray(ld.alternateName) ? ld.alternateName : [ld.alternateName];
      for (let i = 0; i < list.length; i++) push(list[i]);
    }

    // 页面 "Spellings" 区块：<ul><li>半条命 - <em>Simplified Chinese spelling</em></li></ul>
    const h2s = document.querySelectorAll('h2');
    for (let i = 0; i < h2s.length; i++) {
      if (!/^Spellings$/i.test(this._clean(h2s[i].textContent))) continue;
      const ul = h2s[i].nextElementSibling;
      if (!ul) continue;
      const lis = ul.querySelectorAll('li');
      for (let j = 0; j < lis.length; j++) {
        const li = lis[j];
        const em = li.querySelector('em');
        if (em) {
          // 只取 <em> 之前的文字节点（"半条命"），丢掉语言说明
          let name = '';
          for (let k = 0; k < li.childNodes.length; k++) {
            const node = li.childNodes[k];
            if (node.nodeType === 3) name += node.nodeValue;
          }
          name = this._clean(name).replace(/\s*[-–—]\s*$/, '');
          if (name) { push(name); continue; }
        }
        push(this._clean(li.textContent).replace(/\s*-\s*[A-Za-z ]+spelling\s*$/i, ''));
      }
    }

    // 剔除与本名相同的项
    const self = this.extractGameName();
    const filtered = out.filter((n) => n !== self);
    return filtered.join(', ');
  }

  /** 官方站：dl "Official Site" 行的第一个链接（常指向 archive.org，用户要求照原样取） */
  extractOfficialSite() {
    const dd = this._findMetaDd('Official Site');
    if (!dd) return '';
    const a = dd.querySelector('a[href]');
    if (!a) return this._clean(this._text(dd));
    let href = String(a.getAttribute('href') || '').trim();
    if (!href) return '';
    // 相对链接补全
    if (href.charAt(0) === '/') {
      try {
        href = new URL(href, window.location.origin).href;
      } catch (e) {
        // 保持原样
      }
    }
    return href;
  }

  /** Steam：页面 "Buy Now" 区块里的 store.steampowered.com/app/<id>/ 链接 */
  extractSteamUrl() {
    const links = document.querySelectorAll('a[href*="steampowered.com/app/"]');
    for (let i = 0; i < links.length; i++) {
      const raw = String(links[i].getAttribute('href') || '');
      const m = raw.match(/https?:\/\/store\.steampowered\.com\/app\/\d+\/?/);
      if (m) return m[0];
    }
    return '';
  }

  /** 用户评分：Reviews 区块 "Average score: 4.3 out of 5 (based on 653 ratings…)" */
  extractPlayerScore() {
    const h2s = document.querySelectorAll('h2');
    for (let i = 0; i < h2s.length; i++) {
      if (!/^Reviews$/i.test(this._clean(h2s[i].textContent))) continue;
      const box = h2s[i].nextElementSibling;
      if (!box) continue;
      const ps = box.querySelectorAll('p');
      for (let j = 0; j < ps.length; j++) {
        const t = this._clean(ps[j].textContent);
        const m = t.match(/Average score:\s*([\d.]+)\s*out of\s*5\s*\(based on\s*([\d,]+)/i);
        if (m) return `${m[1]}/5（${m[2]} 人）`;
      }
    }
    return '';
  }

  /** 媒体评分：dl "Critics" 行的 dd，形如 "94% (78)" */
  extractCriticScore() {
    const raw = this._metaValue('Critics');
    if (!raw) return '';
    const m = raw.match(/(\d+%)\s*\(([\d,]+)\)/);
    if (m) return `${m[1]}（${m[2]}）`;
    return this._clean(raw);
  }

  extractUrl() {
    try {
      const u = new URL(window.location.href);
      u.search = '';
      u.hash = '';
      let pathname = u.pathname;
      if (pathname.charAt(pathname.length - 1) !== '/') pathname += '/';
      return u.origin + pathname;
    } catch (e) {
      return String(window.location.href || '').split(/[?#]/)[0];
    }
  }

  /**
   * 其他信息：类型、分级、开发商、发行商、Critics、玩家评分
   * ⚠️ 不再写 "MobyScore：x" —— Moby Score 就是「网络评分」那一格的原值，
   *    两边数字完全相同（8.8 / 8.8），重复一遍纯属噪音。
   *    （Metacritic 那边要写 Metascore 是因为 96 与折算后的 9.6 不是同一个数。）
   */
  extractOtherInfo() {
    const parts = [];

    const genre = this.extractGenreText();
    if (genre) parts.push('类型：' + genre);

    const rated = this.extractContentRating();
    if (rated) parts.push('分级：' + rated);

    const developer = this.extractDeveloper();
    if (developer) parts.push('开发商：' + developer);

    const publisher = this.extractPublisher();
    if (publisher) parts.push('发行商：' + publisher);

    const critics = this.extractCriticScore();
    if (critics) parts.push('Critics：' + critics);

    const player = this.extractPlayerScore();
    if (player) parts.push('玩家评分：' + player);

    return parts.join('，');
  }

  // ====== 聚合 ======

  async extractAllFields() {
    // 不存在的游戏页（HTTP 200 + "Game not found"）一律返回空，不猜
    if (!this._isGameDetailPage()) {
      return {
        '游戏名': '',
        '发行日期': '',
        '原作名': '',
        '平台': '',
        '网络评分': '',
        '简介': '',
        '国家': '',
        'Steam': '',
        '豆瓣链接': '',
        '官方网站': '',
        'URL': '',
        '别名': '',
        '其他信息': ''
      };
    }

    try {
      return {
        '游戏名': this.extractGameName(),
        '发行日期': this.extractReleaseDate(),
        '原作名': '',
        '平台': this.extractPlatforms().join(', '),
        '网络评分': this.extractRating(),
        '简介': this.extractDescription(),
        '国家': '',
        'Steam': this.extractSteamUrl(),
        '豆瓣链接': '',
        '官方网站': this.extractOfficialSite(),
        'URL': this.extractUrl(),
        '别名': this.extractAliases(),
        '其他信息': this.extractOtherInfo()
      };
    } catch (error) {
      console.error('[MobygamesGameExtractor] 提取所有字段失败:', error);
      return {
        '游戏名': '',
        '发行日期': '',
        '原作名': '',
        '平台': '',
        '网络评分': '',
        '简介': '',
        '国家': '',
        'Steam': '',
        '豆瓣链接': '',
        '官方网站': '',
        'URL': '',
        '别名': '',
        '其他信息': ''
      };
    }
  }
}

// 导出到全局作用域（class 声明不会自动挂载到 window，必须显式导出）
window.MobygamesGameExtractor = MobygamesGameExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['mobygames'] = MobygamesGameExtractor;
