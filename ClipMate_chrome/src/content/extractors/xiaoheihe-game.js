/**
 * 小黑盒（xiaoheihe.cn）游戏提取器
 *
 * ===== 页面结构要点（2026-10-25 实测，Chromium 156 非无头 + CDP 直读 DOM）=====
 *
 * 1. 详情页形态：/app/topic/game/pc/<appid>
 *    ⚠️ 只有 pc 有真实数据。ps5 / switch / xbox/<同一 appid> 都是**空壳页**：
 *       能正常打开、HTTP 200、甚至还有用户评论，但没有游戏名/评分/菜单。
 *    → manifest 的 matches 只写 /pc/，其余平台天然不注入。
 *
 * 2. ⚠️ 无效 appid（如 999999999）**不 404**，照样渲染完整页面骨架
 *    （「暂无评分 0人想评」+ 评论区），bodyLen 也有几百字。
 *    → 唯一可靠判据是 `.game-name .name` 文本是否为空（`.game-name` 容器本身永远存在！）。
 *      名称为空时直接返回全空字段，绝不用页面其他文字凑数。
 *
 * 3. 页面是 Vue SPA，**没有 JSON-LD、没有 __NEXT_DATA__/__NUXT__**，数据全在渲染后的 DOM 里。
 *    另外 document.title 恒为「小黑盒 - 玩家高能聚集地」，不随路由变化，不能当标题来源。
 *
 * 4. 子页 /app/topic/game/pc/<id>/intro 会**前端重定向**到 /app/bbs/home（不是 404）。
 *    → 用 manifest 的 exclude_matches 在注入前挡掉（Chrome 的 matches 通配符无法只匹配一层路径）。
 *
 * 5. appid 与 Steam appid 一致（1245620 艾尔登法环 / 2358720 黑神话 / 1091500 赛博朋克，
 *    3/3 吻合）。但**不拼 Steam 链接**（2026-10-25 用户裁决）：
 *    小黑盒也有非 Steam 游戏，盲拼会给出 404 链接。
 *
 * 6. 页面没有游戏级官网链接，实测 `a[href]` 里搜不到 steam/store/official。
 *
 * ===== 实测选择器 =====
 *   游戏名        .game-name .name
 *   英文名        .game-name .name-en（可能重复中文前缀，如「鬼谷八荒 Tale of Immortal」）
 *   评分          .score-wrapper .score .num        → 10 分制，无需换算
 *   评价数        .score-wrapper .comment span      → 「6.3万人评价」
 *   简介          a.about-game 的 textContent       → 全文（页面用 CSS -webkit-line-clamp:4 视觉截断，文本不丢）
 *   菜单          .menu-item p，2 个 span：第 1 个是「开发商：」，第 2 个带 data-clipboard-text（值最稳）
 *   标签          .tags p.tag（排除 .tag.plat 平台图标行、.tag.common 语言/人数行）
 *   奖项          .game-awards .award-item，取 .award-type + .award-detail
 */

/**
 * 营销标签黑名单：小黑盒会在类型标签前面塞一个运营标记。
 * 实测到「心愿单热门」（艾尔登法环/鬼谷八荒/黑神话：悟空）与「近期热销」（赛博朋克2077），
 * 都固定排在第一位；但也有的游戏一个都没有（摩托英豪4 直接以「竞速」开头），
 * 所以不能按位置砍，只能按词表过滤。
 * 用「包含」匹配，宁可多滤也不能漏（漏了只是多一个词，误滤会丢掉真类型）。
 */
const XHH_MARKETING_TAGS = [
  '心愿单', '热销', '热卖', '畅销', '新品', '新游', '上架', '特惠', '促销',
  '折扣', '限时', '限免', '免费', '史低', '热门', '推荐', '排行', '预购',
  '抢先', '独家', '首发', '即将'
];

class XiaoheiheGameExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'xiaoheihe';
    this.mediaType = 'game';
    this.isSocialPlatform = false;
  }

  /**
   * 只认 /app/topic/game/pc/<appid> 一层。
   * 当前注册链路走 ExtractorFactory 的 URL 正则，本方法暂未被调用，
   * 保留是为了与其它提取器保持一致的接口形态。
   */
  // ====== 通用小工具 ======

  /** 元素文本，压掉多余空白 */
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

  /** 「2022年02月25日」/「2022-02-25」/「2022/2/25」→ 2022/02/25 */
  _formatReleaseDate(value) {
    const s = this._clean(value);
    if (!s) return '';
    const m = s.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*[月\-\/.]\s*(\d{1,2})/);
    if (!m) {
      // 只有年月的情况也要能留个可读结果
      const ym = s.match(/(\d{4})\s*[年\-\/.]\s*(\d{1,2})\s*月?/);
      return ym ? `${ym[1]}/${ym[2].padStart(2, '0')}` : '';
    }
    return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  }

  /**
   * 菜单里按标签取值。
   * 实测结构：<p><span>开发商：</span><span data-clipboard-text="鬼谷工作室">鬼谷工作室</span></p>
   * 优先用 data-clipboard-text（纯值，不含前缀、不含额外空白），没有就退到文本并剥前缀。
   */
  _menuValue(label) {
    const items = document.querySelectorAll('.menu-item');
    for (let i = 0; i < items.length; i++) {
      const p = items[i].querySelector('p');
      if (!p) continue;

      const spans = p.querySelectorAll('span');
      if (spans.length < 2) continue;

      const key = this._text(spans[0]).replace(/[:：]\s*$/, '').trim();
      if (key !== label) continue;

      const fromAttr = String(spans[1].getAttribute('data-clipboard-text') || '').trim();
      if (fromAttr) return this._clean(fromAttr);

      const fallback = this._text(spans[1]);
      if (fallback) return this._clean(fallback);
    }
    return '';
  }

  // ====== 字段提取 ======

  extractGameName() {
    return this._text(document.querySelector('.game-name .name'));
  }

  /**
   * 原作名 = 英文名。
   * ⚠️ name-en 有时会把中文名也带上（鬼谷八荒 → 「鬼谷八荒 Tale of Immortal」），
   * 必须以中文名为前缀剥掉；剥完为空就留空（不拿中文名充当原作名）。
   */
  extractOriginalName() {
    const cn = this.extractGameName();
    let en = this._text(document.querySelector('.game-name .name-en'));
    if (!en) return '';

    if (cn && en.indexOf(cn) === 0) {
      en = en.slice(cn.length).trim();
    } else if (cn) {
      // 前缀可能带空格/冒号变体，再宽松剥一次
      const loose = new RegExp('^\\s*' + cn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:：]?\\s*');
      en = en.replace(loose, '').trim();
    }

    if (!en || en === cn) return '';
    return en;
  }

  extractReleaseDate() {
    return this._formatReleaseDate(this._menuValue('发布时间'));
  }

  /** 地址里就是 pc，站内只有 pc 页有真实数据 */
  extractPlatforms() {
    return 'PC';
  }

  /** 小黑盒评分本来就是 10 分制，与豆瓣/Steam 同量纲，不需要换算 */
  extractRating() {
    const raw = this._text(document.querySelector('.score-wrapper .score .num'));
    if (!raw) return '';
    const m = raw.match(/\d+(?:\.\d+)?/);
    if (!m) return '';
    const num = parseFloat(m[0]);
    if (!isFinite(num) || num < 0 || num > 10) return '';
    return String(num);
  }

  extractRatingCount() {
    return this._text(document.querySelector('.score-wrapper .comment span'));
  }

  /**
   * 简介：a.about-game 的 textContent 就是全文。
   * 页面虽然只显示 4 行（-webkit-line-clamp），但文本完整在 DOM 里，不用点「全部」。
   */
  extractDescription() {
    const el = document.querySelector('.about-game');
    if (!el) return '';
    return String(el.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /**
   * 类型标签。
   * 排除两类：.tag.plat（平台图标行，只有 SVG 没有文字）、.tag.common（中文/单人/联网等语言人数属性）。
   * 再按营销词表过滤掉「心愿单热门」「近期热销」这类运营标记。
   */
  extractTags() {
    const nodes = document.querySelectorAll('.tags p.tag');
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i];
      if (/\bplat\b/.test(String(el.className || ''))) continue;

      const name = this._text(el);
      if (!name) continue;

      let isMarketing = false;
      for (let j = 0; j < XHH_MARKETING_TAGS.length; j++) {
        if (name.indexOf(XHH_MARKETING_TAGS[j]) !== -1) { isMarketing = true; break; }
      }
      if (isMarketing) continue;

      if (out.indexOf(name) === -1) out.push(name);
    }
    return out;
  }

  /** 奖项：.award-item 里 .award-type + .award-detail，按出现顺序 */
  extractAwards() {
    const items = document.querySelectorAll('.game-awards .award-item');
    const out = [];
    for (let i = 0; i < items.length; i++) {
      const type = this._text(items[i].querySelector('.award-type'));
      const detail = this._text(items[i].querySelector('.award-detail'));
      const line = [type, detail].filter(Boolean).join(' ');
      if (line && out.indexOf(line) === -1) out.push(line);
    }
    return out;
  }

  extractUrl() {
    try {
      const u = new URL(window.location.href);
      u.search = '';
      u.hash = '';
      return u.origin + u.pathname;
    } catch (e) {
      return String(window.location.href || '').split('?')[0].split('#')[0];
    }
  }

  /**
   * 其他信息：开发商：…，发行商：…，系列：…，标签：…，评价数：…，奖项：…
   * 奖项最多取前 6 个（2026-10-25 用户裁决）—— 艾尔登法环有 12 个，全放会撑爆单元格。
   */
  extractOtherInfo() {
    const parts = [];

    const developer = this._menuValue('开发商');
    if (developer) parts.push('开发商：' + developer);

    const publisher = this._menuValue('发行商');
    if (publisher) parts.push('发行商：' + publisher);

    const series = this._menuValue('系列');
    if (series) parts.push('系列：' + series);

    const tags = this.extractTags();
    if (tags.length) parts.push('标签：' + tags.join('、'));

    const count = this.extractRatingCount();
    if (count) parts.push('评价数：' + count);

    const awards = this.extractAwards();
    if (awards.length) parts.push('奖项：' + awards.slice(0, 6).join('、'));

    return parts.join('，');
  }

  // ====== 聚合 ======

  /** 名称为空 = 无效 appid 的空壳页，整表留空，绝不拿页面上的其他文字凑 */
  _emptyResult() {
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
      'URL': this.extractUrl(),
      '别名': '',
      '其他信息': ''
    };
  }

  async extractAllFields() {
    try {
      const name = this.extractGameName();
      if (!name) {
        console.warn('[XiaoheiheGameExtractor] 页面上没有游戏名，判定为空壳页（无效 appid 或非 pc 平台）');
        return this._emptyResult();
      }

      return {
        '游戏名': name,
        '发行日期': this.extractReleaseDate(),
        '原作名': this.extractOriginalName(),
        '平台': this.extractPlatforms(),
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
      console.error('[XiaoheiheGameExtractor] 提取所有字段失败:', error);
      return this._emptyResult();
    }
  }
}

// 导出到全局作用域（class 声明不会自动挂载到 window，必须显式导出）
window.XiaoheiheGameExtractor = XiaoheiheGameExtractor;
window.extractorMap = window.extractorMap || {};
window.extractorMap['xiaoheihe'] = XiaoheiheGameExtractor;
