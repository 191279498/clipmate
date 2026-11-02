/**
 * Metacritic（metacritic.com）游戏提取器
 *
 * ===== 页面结构要点（2026-10-25 实测，Chromium 156 非无头 + CDP 直读 DOM）=====
 *
 * 1. 只认一层详情页 /game/<游戏名>/。
 *    子页 /critic-reviews/ /user-reviews/ /details/ 以及游戏列表页 /game/
 *    **都没有**详情页的 hero 区、也没有 JSON-LD，靠 manifest 的 exclude_matches
 *    在脚本注入之前就挡掉（Chrome 的 matches 通配符无法只匹配一层路径，只能这样排）。
 *
 * 2. 页面框架是 Nuxt（内联 ["ShallowReactive",...] payload），没有 __NEXT_DATA__。
 *    但每页都有一段完整的 JSON-LD @type=VideoGame，
 *    name / datePublished / description / genre / gamePlatform / contentRating 一次全给。
 *
 * 3. ⚠️ JSON-LD 的 publisher 数组**不可信**：
 *    Elden Ring 返回 [Bandai Namco Games, From Software]（把开发商 From Software 混进来了），
 *    GTA VI 返回 3 个公司（Rockstar / 2K / Take-Two）而页面 Developer 只有 Rockstar。
 *    → 开发商、发行商一律从页面文字取，不用 publisher。
 *
 * 4. ⚠️ 未发售游戏（如 GTA VI）JSON-LD 里**根本没有 aggregateRating**，
 *    页面分数位显示 tbd。→ 评分必须判空，绝不能把 tbd 当成分数写进去。
 *
 * 5. Metascore 是 100 分制，站内其它游戏站（豆瓣/BGM/Steam）都是 10 分制。
 *    2026-10-25 用户裁决：统一折算成 10 分制写「网络评分」，原始分数另写进「其他信息」。
 *
 * 6. 平台切换是 ?platform=xxx 指向 critic-reviews / user-reviews，**没有独立平台页**
 *    （/game/<slug>/platform/pc/ 实测 404），所以不必处理平台子页。
 */
/**
 * Metacritic 的游戏类型是它自有的英文词（Western RPG / Metroidvania / Open-World Action…），
 * 现有影视用的 GENRE_MAP 覆盖不到，所以这里单独建一张游戏类型对照表。
 * 查不到的保留英文原文，不硬翻（硬翻容易造出「欧美角色扮演游戏」这种冗余说法）。
 * 键统一小写，查表时先原样后小写。
 */
const METACRITIC_GENRE_CN = {
  'action': '动作',
  'adventure': '冒险',
  'action adventure': '动作冒险',
  'action rpg': '动作角色扮演',
  'western rpg': '欧美角色扮演',
  'jrpg': '日式角色扮演',
  'rpg': '角色扮演',
  'role-playing': '角色扮演',
  'role-playing game': '角色扮演',
  'tactical rpg': '战术角色扮演',
  'strategy': '策略',
  'turn-based strategy': '回合制策略',
  'real-time strategy': '即时战略',
  'wargame': '战棋',
  'simulation': '模拟',
  'sim': '模拟',
  'puzzle': '解谜',
  'sports': '体育',
  'racing': '竞速',
  'driving': '驾驶竞速',
  'shooter': '射击',
  'first-person shooter': '第一人称射击',
  'third-person shooter': '第三人称射击',
  'fighting': '格斗',
  'platformer': '平台跳跃',
  'music': '音乐',
  'rhythm': '音乐节奏',
  'party': '派对',
  'educational': '教育',
  'metroidvania': '银河城',
  'roguelike': '肉鸽',
  'roguelite': '轻肉鸽',
  'survival horror': '生存恐怖',
  'open-world action': '开放世界动作',
  'open world': '开放世界',
  'sandbox': '沙盒',
  'stealth': '潜行',
  'horror': '恐怖',
  'visual novel': '视觉小说',
  'arcade': '街机',
  'board game': '桌面游戏',
  'card game': '卡牌',
  'flight': '飞行',
  'miscellaneous': '其他',
  'action adventure rpg': '动作冒险角色扮演',
  'beat-em-up': '清版格斗'
};

class MetacriticGameExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'metacritic';
    this.mediaType = 'game';
    this.isSocialPlatform = false;
  }

  /**
   * 只认 /game/<游戏名>/ 一层。
   * 排除 /game/（列表页）与 /game/<slug>/critic-reviews|user-reviews|details/。
   * 注意：当前注册链路走 ExtractorFactory 的 URL 正则，本方法暂未被调用，
   * 保留它是为了与 17K / Goodreads 等提取器保持一致的接口形态。
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
      console.warn('[Metacritic] 读取 JSON-LD 失败:', e && e.message);
    }
    return null;
  }

  /** YYYY-MM-DD / ISO 时间 → YYYY/MM/DD */
  _formatISODate(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}/${m[2]}/${m[3]}` : '';
  }

  /** "Aug 3, 2023" / "AUG 3, 2023" → 2023/08/03 */
  _formatHumanDate(value) {
    const s = this._clean(value);
    if (!s) return '';
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
    };
    const m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
    if (!m) return '';
    const month = months[m[1].slice(0, 3).toLowerCase()];
    if (!month) return '';
    return `${m[3]}/${month}/${m[2].padStart(2, '0')}`;
  }

  // ====== 字段提取 ======

  extractGameName() {
    const ld = this._readJsonLd();
    if (ld && ld.name) return this._clean(ld.name);

    const h1 = document.querySelector('h1');
    const h1Text = this._text(h1);
    if (h1Text) return h1Text;

    // og:title 形如 "Baldur's Gate 3 Reviews - Metacritic"
    const og = document.querySelector('meta[property="og:title"]');
    if (og) {
      const raw = String(og.getAttribute('content') || '');
      const name = raw.replace(/\s+Reviews?\s*[-–—]\s*Metacritic\s*$/i, '').trim();
      if (name) return name;
    }
    return '';
  }

  extractReleaseDate() {
    const ld = this._readJsonLd();
    const fromLd = ld ? this._formatISODate(ld.datePublished) : '';
    if (fromLd) return fromLd;
    // 兜底：hero 区的 "Released On: Aug 3, 2023"
    return this._formatHumanDate(this._text(document.querySelector('.hero-release-date__value')));
  }

  extractPlatforms() {
    const ld = this._readJsonLd();
    let list = ld ? ld.gamePlatform : null;
    if (!list) return [];
    if (!Array.isArray(list)) list = [list];

    const cleaned = [];
    for (let i = 0; i < list.length; i++) {
      const name = this._clean(list[i]);
      if (name && cleaned.indexOf(name) === -1) cleaned.push(name);
    }
    if (!cleaned.length) return [];

    // 复用共享的平台标准化（PlayStation 5 → PS5、Xbox Series X → XSX…）
    try {
      if (window.PlatformUtils && typeof window.PlatformUtils.standardizePlatforms === 'function') {
        return window.PlatformUtils.standardizePlatforms(cleaned);
      }
    } catch (e) {
      console.warn('[Metacritic] 平台标准化失败，使用原始名称:', e && e.message);
    }
    return cleaned;
  }

  /** Metascore 原始值（100 分制）；取不到返回 null，绝不返回 tbd 之类的字面量 */
  _readMetascore() {
    const ld = this._readJsonLd();
    const ar = ld ? ld.aggregateRating : null;
    if (!ar || ar.ratingValue === null || ar.ratingValue === undefined) return null;

    const raw = parseFloat(String(ar.ratingValue));
    if (!isFinite(raw)) return null;

    const best = parseFloat(String(ar.bestRating));
    const scale = isFinite(best) && best > 0 ? best : 100;
    return { value: raw, scale: scale };
  }

  /** 网络评分：折算成 10 分制（用户 2026-10-25 裁决） */
  extractRating() {
    const meta = this._readMetascore();
    if (!meta) return '';
    const ten = (meta.value / meta.scale) * 10;
    return (Math.round(ten * 10) / 10).toFixed(1);
  }

  /**
   * 用户评分（10 分制）：页面上 Metascore 是圆角方形徽章，用户评分是圆形徽章。
   * 未出分时两处都可能是 tbd，所以只接受纯数字。
   */
  extractUserScore() {
    const boxes = document.querySelectorAll('div.size-16');
    for (let i = 0; i < boxes.length; i++) {
      const cls = String(boxes[i].className || '');
      if (cls.indexOf('rounded-full') === -1) continue;
      const text = this._text(boxes[i]);
      if (/^\d+(\.\d+)?$/.test(text)) return text;
    }
    return '';
  }

  extractDescription() {
    const ld = this._readJsonLd();
    if (ld && ld.description) {
      return String(ld.description)
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    const og = document.querySelector('meta[property="og:description"], meta[name="description"]');
    if (og) return this._clean(og.getAttribute('content'));
    return '';
  }

  /**
   * 开发商：实测结构
   *   <p class="m-0 text-sm leading-7">
   *     <span class="mr-1 ...">Developer:</span>
   *     <a href="/company/...">From Software</a>
   *   </p>
   */
  extractDeveloper() {
    const spans = document.querySelectorAll('span');
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i];
      if (span.children.length !== 0) continue;
      if (!/^Developer\s*:?$/i.test(this._text(span))) continue;

      const box = span.parentElement;
      if (!box) continue;

      const links = box.querySelectorAll('a');
      const names = [];
      for (let j = 0; j < links.length; j++) {
        const t = this._text(links[j]);
        if (t && names.indexOf(t) === -1) names.push(t);
      }
      if (names.length) return names.join(', ');

      const raw = this._text(box).replace(/^Developer\s*:?\s*/i, '').trim();
      if (raw) return raw;
    }
    return '';
  }

  /**
   * 发行商：实测结构
   *   <div class="c-product-details__section c-product-details__section--grouped">
   *     <span class="c-product-details__section__label">Publisher:</span>
   *     <ul class="c-product-details__section__list">
   *       <li><a class="c-product-detail-link">Bandai Namco Games</a></li>
   *     </ul>
   *   </div>
   * 可能有多个，按出现顺序用 ", " 拼接。
   */
  extractPublisher() {
    const labels = document.querySelectorAll('.c-product-details__section__label');
    for (let i = 0; i < labels.length; i++) {
      if (!/^Publisher\s*:?$/i.test(this._text(labels[i]))) continue;

      const box = labels[i].parentElement;
      if (!box) continue;

      const links = box.querySelectorAll('a');
      const names = [];
      for (let j = 0; j < links.length; j++) {
        const t = this._text(links[j]);
        if (t && names.indexOf(t) === -1) names.push(t);
      }
      if (names.length) return names.join(', ');

      const raw = this._text(box).replace(/^Publisher\s*:?\s*/i, '').trim();
      if (raw) return raw;
    }
    return '';
  }

  /** 分级：JSON-LD contentRating（"M"），兜底页面正文的 "Rated M" */
  extractContentRating() {
    const ld = this._readJsonLd();
    if (ld && ld.contentRating) {
      const t = this._clean(ld.contentRating).replace(/^(Rated|ESRB)\s*:?\s*/i, '');
      if (t) return t;
    }
    const bodyText = document.body ? String(document.body.innerText || '') : '';
    const m = bodyText.match(/Rated\s+([A-Za-z0-9+\-]{1,6})/);
    return m ? m[1] : '';
  }

  /** 游戏类型：JSON-LD genre（字符串或数组）→ 中文；查不到保留原文 */
  extractGenreText() {
    const ld = this._readJsonLd();
    let raw = ld ? ld.genre : null;
    if (!raw) {
      // 兜底：页面上的类型按钮文字（实测 class 为 global-link-button__label）
      const el = document.querySelector('.global-link-button__label');
      if (el) raw = this._text(el);
    }
    if (!raw) return '';

    const items = Array.isArray(raw) ? raw : String(raw).split(/[,，/]/);
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const name = this._clean(items[i]);
      if (!name) continue;
      const cn = METACRITIC_GENRE_CN[name] || METACRITIC_GENRE_CN[name.toLowerCase()] || name;
      if (out.indexOf(cn) === -1) out.push(cn);
    }
    return out.join('、');
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
      return String(window.location.href || '').split('?')[0];
    }
  }

  /** 其他信息：类型：…，分级：…，开发商：…，发行商：…，Metascore：…，用户评分：… */
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

    const meta = this._readMetascore();
    if (meta) {
      const rawText = Number.isInteger(meta.value) ? String(meta.value) : String(meta.value);
      parts.push('Metascore：' + rawText);
    }

    const userScore = this.extractUserScore();
    if (userScore) parts.push('用户评分：' + userScore);

    return parts.join('，');
  }

  // ====== 聚合 ======

  async extractAllFields() {
    try {
      return {
        '游戏名': this.extractGameName(),
        '发行日期': this.extractReleaseDate(),
        '原作名': '',
        '平台': this.extractPlatforms().join(', '),
        '网络评分': this.extractRating(),
        '简介': this.extractDescription(),
        '国家': '',
        'Steam': '',
        '豆瓣链接': '',
        '官方网站': '',
        'URL': this.extractUrl(),
        '别名': '',
        '其他信息': this.extractOtherInfo()
      };
    } catch (error) {
      console.error('[MetacriticGameExtractor] 提取所有字段失败:', error);
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
window.MetacriticGameExtractor = MetacriticGameExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['metacritic'] = MetacriticGameExtractor;
