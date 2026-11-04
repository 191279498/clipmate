/**
 * 红果短剧（hongguoduanju.com）剧集详情页提取器 · v2.11.0
 *
 * 数据源：SSR 注入的 `_ROUTER_DATA`。
 * 页面里它是以 `<script>_ROUTER_DATA = {...}` 开头的内联脚本，**大括号后面还跟着别
 * 的 JS 代码**，所以不能把整段 script 文本丢给 JSON.parse，必须按括号配对截出那一个
 * 对象。JSON-LD 是客户端运行时才注入的（存档里压根没有），不能当稳定数据源。
 *
 * 站点特征（2026-11-04，588 个详情页实测）：
 * - 全站都是「影视 / 剧集」：没有电影，没有单集页，`/detail?series_id=` 就是一部剧
 * - 三种子类型：真人剧 / 漫剧 / AI 剧，辨别方法见 _detectSubCategory()
 * - 详情页的 SSR 数据 14 个字段三类完全一致，**没有剧种字段**；meta / JSON-LD /
 *   页面 class / 播放页数据里也都没有 —— 剧种只藏在两处：榜单标签与演员表
 *
 * 判据覆盖率（随机抽样 300 部，覆盖全部 800 部/类）：
 * - 榜单标签：39.7%（新剧基本都上榜，老剧大多没有）
 * - 演员表：真人剧 100% 有，漫剧 0%、AI 剧 0%，零例外
 * - 两条都判不出（没上榜、没演员的漫剧/AI 剧）：60.3% —— 这类页面红果自己也没标，
 *   一律**留空**，不猜（符合项目「unknown 一个字节都不碰」的规矩）
 */

class HongguoMovieExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'hongguo';
    this.mediaType = 'tv';
    this.isSocialPlatform = false;
    // `_ROUTER_DATA` 按 URL 缓存：同一页面只解析一次，站内跳转后自动失效
    this._routerCache = null;
  }

  /** 只认详情页；首页 / 榜单 / 分类 / 播放页都不出按钮（manifest 也只注入 /detail*） */
  async canExtract() {
    try {
      return /^https:\/\/(?:www\.)?(?:hongguoduanju\.com|novelquickapp\.com)\/detail(?:[/?#]|$)/.test(window.location.href);
    } catch (e) {
      return false;
    }
  }

  // ========== 数据源 ==========

  /**
   * 从一段文本里截出第一个「括号配对完整」的 JSON 对象
   * 字符串里的 `{` `}` `"` 全部跳过，避免把 JSON 里的内容当成结构符号
   */
  _sliceJsonObject(text) {
    const start = String(text || '').indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  /** 读取 `_ROUTER_DATA`（按 URL 缓存一次） */
  _readRouterData() {
    const href = window.location.href;
    if (this._routerCache && this._routerCache.href === href) {
      return this._routerCache.data;
    }
    let data = null;
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        const at = text.indexOf('_ROUTER_DATA');
        if (at < 0) continue;
        const eq = text.indexOf('=', at);
        if (eq < 0) continue;
        const raw = this._sliceJsonObject(text.slice(eq + 1));
        if (!raw) continue;
        try {
          data = JSON.parse(raw);
        } catch (e) {
          // 这一块坏了就找下一块，别让一块脏数据毁掉整页
          continue;
        }
        if (data) break;
      }
    } catch (e) {
      ClipMateLog.debug('[HongguoMovieExtractor] 读取 _ROUTER_DATA 失败:', e && e.message);
    }
    this._routerCache = { href, data };
    return data;
  }

  /** detail_page 节点（剧集主数据 + 社交数据都挂在这里） */
  _detailPage() {
    const data = this._readRouterData();
    const loader = data && data.loaderData;
    return (loader && loader.detail_page) || null;
  }

  /** 剧集主数据：片名 / 集数 / 标签 / 简介 / 演员 / 上线时间 */
  _series() {
    const page = this._detailPage();
    return (page && page.seriesDetail) || null;
  }

  /** 社交数据：评分 / 点赞 / 收藏 / 热度 / 榜单标签 */
  _social() {
    const page = this._detailPage();
    return (page && page.seriesSocialInfo) || null;
  }

  // ========== 子类型辨别 ==========

  /**
   * 页面上那个「X 热播榜 No.N」小标签指向的榜单路径
   * 结构：<a href="/rank/hot-comic-drama" class="pc-hero-tag-xxx pc-hero-rank-tag-xxx">
   * class 名带随机哈希后缀，只能用「包含」匹配
   */
  _rankHref() {
    try {
      const el = document.querySelector('a[class*="pc-hero-rank-tag"]');
      return el ? String(el.getAttribute('href') || '') : '';
    } catch (e) {
      return '';
    }
  }

  /**
   * 辨别真人剧 / 漫剧 / AI 剧（顺序即优先级）
   *
   * 一级 · 榜单标签（最准，纯数据不用碰 DOM）：
   *   `seriesSocialInfo.rank_label` 是纯文本「热播漫剧榜第3名」。
   *   与 DOM 标签链接 10/10 完全一致（2026-11-04 实测）。
   *   `hot-drama`（短剧热播榜）是**三类混排总榜**，为什么算真人剧：
   *   红果的规则是「显示名次最好的那个榜」，漫剧/AI 剧一旦上榜必然同时有分榜、
   *   名次不差于总榜 → 永远显示分榜。把总榜前 60 部全查了一遍，零误判。
   *
   * 二级 · 演员表：`celebrities` 非空 → 真人剧。随机 300 部零例外。
   *
   * 三级 · 都没有 → 留空。这类剧红果页面上确实没写剧种，不猜。
   */
  _detectSubCategory() {
    const social = this._social() || {};
    const label = String(social.rank_label || '').trim();
    if (label) {
      if (label.indexOf('AI剧') >= 0) return 'AI剧';
      if (label.indexOf('漫剧') >= 0) return '漫剧';
      if (label.indexOf('真人剧') >= 0 || label.indexOf('短剧') >= 0) return '真人剧';
    }

    const href = this._rankHref();
    if (href) {
      if (href.indexOf('hot-ai-drama') >= 0) return 'AI剧';
      if (href.indexOf('hot-comic-drama') >= 0) return '漫剧';
      if (href.indexOf('hot-real-drama') >= 0 || href.indexOf('hot-drama') >= 0) return '真人剧';
    }

    if (this._celebrities().length > 0) return '真人剧';
    return '';
  }

  // ========== 字段解析 ==========

  /** 演员数组（data 里原样，可能是 undefined） */
  _celebrities() {
    const series = this._series() || {};
    const list = series.celebrities;
    return Array.isArray(list) ? list : [];
  }

  /** 主演：只有真人剧有；去空、去重、顿号不用，与豆瓣/IMDb一致用「, 」 */
  _joinCelebrities() {
    const names = [];
    const seen = new Set();
    for (const item of this._celebrities()) {
      const name = String((item && item.nickname) || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    return names.join(', ');
  }

  /**
   * 题材标签：数据里有全量（页面只显示前 4 个）
   * 连接符与豆瓣影视的「标签」字段一致：半角逗号、无空格
   */
  _joinTags(tags) {
    if (!Array.isArray(tags)) return '';
    const out = [];
    const seen = new Set();
    for (const tag of tags) {
      const text = String(tag || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
    }
    return out.join(',');
  }

  /** 秒级时间戳 → YYYY/MM/DD（与其余影视站同一格式；源就是日粒度，不补时分） */
  _formatDate(seconds) {
    const n = Number(seconds);
    if (!n || !isFinite(n)) return '';
    const d = new Date(n * 1000);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }

  /**
   * 大数字 → 页面上的显示写法："667.4万" / "1.2亿"
   * 与页面实测一致：6674000 → 667.4万、2576000 → 257.6万、835000 → 83.5万
   */
  _formatCount(value) {
    const n = Number(String(value == null ? '' : value).replace(/[^\d.]/g, ''));
    if (!n || !isFinite(n) || n <= 0) return '';
    if (n >= 100000000) return `${Math.round(n / 10000000) / 10}亿`;
    if (n >= 10000) return `${Math.round(n / 1000) / 10}万`;
    return String(n);
  }

  /**
   * 热度：页面显示的是「9009万热度」这种字符串，直接去掉「热度」二字，
   * 与用户看到的一致（自己换算会得到 9009.6万，反而对不上）。
   */
  _hotText() {
    const hot = (this._social() || {}).hot_score_data || {};
    const text = String(hot.text || '').replace(/热度/g, '').trim();
    if (text) return text;
    return this._formatCount(hot.score);
  }

  /** 评分：漫剧可能为空（不是 0），空就留空 */
  _formatRating(value) {
    if (value === null || value === undefined || value === '') return '';
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return '';
    return String(n);
  }

  /**
   * 其他信息：子分类 + 热度 + 点赞 + 收藏 + 评分人数
   * 格式与豆瓣/TMDB 影视一致：「名：值」多项用中文逗号分隔。
   * 榜单排名只用来判类型，不写进来（用户 2026-11-04 拍板）。
   * 子分类判不出时整项省掉，其余照写。
   */
  extractOtherInfo() {
    const social = this._social() || {};
    const parts = [];

    const sub = this._detectSubCategory();
    if (sub) parts.push(`子分类：${sub}`);

    const hot = this._hotText();
    if (hot) parts.push(`热度：${hot}`);

    const like = this._formatCount(social.series_like_count);
    if (like) parts.push(`点赞：${like}`);

    const favorite = this._formatCount(social.series_favorite_count);
    if (favorite) parts.push(`收藏：${favorite}`);

    const ratingCount = String(social.rating_count == null ? '' : social.rating_count).trim();
    if (/^\d+$/.test(ratingCount) && Number(ratingCount) > 0) {
      parts.push(`评分人数：${ratingCount}`);
    }

    return parts.join('，');
  }

  // ========== 覆盖基类的「按 DOM 猜」三个方法 ==========
  //
  // BaseExtractor 的 extractTitle / extractRating / extractDescription 都是拿 CSS 选择器
  // 去页面里捞（`h1`、`[class*="rating"]`、`og:description`）。红果页面上这几个都能捞到
  // **别的东西**：评分那一格的 class 就叫 `pc-hero-rating-text-xxx`，`og:description` 是
  // 服务端截断的摘要。既然 `_ROUTER_DATA` 里有权威值，就一律以数据层为准，
  // 类名/模板变化也不会把字段串味。

  extractTitle() {
    const series = this._series() || {};
    const name = String(series.series_name || '').trim();
    return name || super.extractTitle();
  }

  extractRating() {
    const social = this._social() || {};
    return this._formatRating(social.rating);
  }

  extractDescription() {
    const series = this._series() || {};
    const intro = String(series.series_intro || '').trim();
    return intro || super.extractDescription();
  }

  // ========== 主流程 ==========

  async extractSpecificFields() {
    const fields = {};
    try {
      const series = this._series() || {};
      const social = this._social() || {};

      fields['名字'] = this.cleanText(series.series_name || '');
      // 红果全站都是剧集，不做「按集数猜电影/剧集」那套
      fields['影视类型'] = '剧集';
      // v2.11.1：红果是字节的国内短剧平台，全站只收国内出品，数据层没有国家/地区字段
      // （14 个字段里没有任何地区信息，页面也不显示），故固定「中国」——与 17K 同做法。
      // 不写的话这一格会一直空着，而它是影视字段表第 3 位，空格很扎眼。
      fields['国家'] = '中国';
      fields['上映日期'] = this._formatDate(series.first_visible_time);
      fields['集数'] = series.episode_cnt ? String(series.episode_cnt) : '';
      fields['主演'] = this._joinCelebrities();
      fields['网络评分'] = this._formatRating(social.rating);
      fields['简介'] = this.cleanText(series.series_intro || '');
      fields['标签'] = this._joinTags(series.tags);
      fields['其他信息'] = this.extractOtherInfo();
    } catch (error) {
      console.error('[HongguoMovieExtractor] 提取字段失败:', error);
    }
    return fields;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = HongguoMovieExtractor;
} else {
  window.HongguoMovieExtractor = HongguoMovieExtractor;
}
