/**
 * 采媒灵 · 影视类标签统一转化库（归一器）· v1.0
 * ============================================================================
 * 【这个文件是生成物】由 scripts/gen_tag_normalizer_js.py 从
 *   影视类标签转化库_ruleset_v1.0.json 生成，**不要手改**。
 *   改规则 → 改那份 JSON 的生成器（scripts/gen_tag_library_final.py）→ 重跑本脚本。
 *
 * 【它解决什么】
 *   5 个影视站的「类型 / 题材」写法互不相同：豆瓣写「纪录片」、IMDb 写 Documentary、
 *   TMDB 写「剧情 / 犯罪」、Bangumi 是用户打的一堆散标签、红果是「都市脑洞、战神归来」。
 *   全站统一到用户自定的 44 个标准标签，未命中的原词退回「其他信息」，一个都不丢。
 *
 * 【查表语义 —— 最关键的一条】
 *   TAG_LOOKUP[站点][原词] = ['标签', ...]   → 写进「标签」列
 *   TAG_LOOKUP[站点][原词] = []              → **已知该词，但只进「其他信息」**
 *   键不存在                                  → 真未命中 → 走兜底，原词进「其他信息」
 *   前两者绝不能混：`[]` 是「查过了、故意不并」，undefined 是「没见过」。
 *   若把 `[]` 当未命中处理，D10 那批爽点/氛围词会反复被误判成新词。
 *
 * 【字面直通必须先落进表里】
 *   豆瓣 28 类里有 26 个与标准词同名（剧情/喜剧/动作…）。它们「本来不需要映射」，
 *   但代码查表会判成未命中 → 全掉进兜底 → 豆瓣标签全废。所以生成器已把标准词显式
 *   写进 lookup，并在生成时断言（见 gen_tag_library_final.py 的 _self_conflict 检查）。
 *
 * 【未命中兜底（D11）】
 *   UGC 标签（Bangumi 的用户标签、红果的运营题材）会不断冒新词。查不到的**不猜、
 *   不丢弃、不静默替换**，原样返回在 others 里，由调用方写进「其他信息」。
 *
 * 版本：v1.0（2026-11-05，对应 17 条拍板 D01–D17）
 */

(function () {
  'use strict';

  /** 规则集版本（与 影视类标签转化库_ruleset_v1.0.json 的 version 一致） */
  var RULESET_VERSION = "1.0";

  /** 44 个标准标签（顺序即用户私人库原序，别重排） */
  var STANDARDS = ["剧情", "爱情", "奇幻", "动作", "生活", "喜剧", "情色", "惊悚", "恐怖", "动画", "冒险", "历史", "悬疑", "科幻", "武侠", "古装", "犯罪", "西部", "战争", "纪录", "短片", "灾难", "传记", "音乐", "猎奇", "运动", "同性", "戏曲", "成人", "歌舞", "儿童", "政治", "社会", "黑暗", "生存", "末世", "玄幻", "修仙", "综艺", "短剧", "推理", "校园", "职业", "AI剧"];

  /**
   * 逐词映射表。键 = 站点名（site-config.js 的 name），值 = 原词 → 标准标签数组。
   * 数组为空 = 已知但只进「其他信息」；键缺失 = 真未命中。
   */
  var LOOKUP = {
    "豆瓣电影": {
      "纪录片": ["纪录"],
      "短片": ["短片"],
      "家庭": ["生活"],
      "黑色电影": ["黑暗"],
      "真人秀": ["综艺"],
      "脱口秀": ["综艺"],
      "日本动画": ["动画"],
      "戏曲片": ["戏曲"],
      "剧情": ["剧情"],
      "喜剧": ["喜剧"],
      "动作": ["动作"],
      "爱情": ["爱情"],
      "科幻": ["科幻"],
      "动画": ["动画"],
      "悬疑": ["悬疑"],
      "惊悚": ["惊悚"],
      "恐怖": ["恐怖"],
      "情色": ["情色"],
      "音乐": ["音乐"],
      "歌舞": ["歌舞"],
      "儿童": ["儿童"],
      "传记": ["传记"],
      "历史": ["历史"],
      "战争": ["战争"],
      "犯罪": ["犯罪"],
      "西部": ["西部"],
      "奇幻": ["奇幻"],
      "冒险": ["冒险"],
      "灾难": ["灾难"],
      "武侠": ["武侠"],
      "古装": ["古装"],
      "运动": ["运动"],
      "综艺": ["综艺"],
      "同性": ["同性"],
    },
    "IMDb": {
      "Action": ["动作"],
      "Adult": ["成人"],
      "Adventure": ["冒险"],
      "Animation": ["动画"],
      "Biography": ["传记"],
      "Comedy": ["喜剧"],
      "Crime": ["犯罪"],
      "Documentary": ["纪录"],
      "Drama": ["剧情"],
      "Family": ["生活"],
      "Fantasy": ["奇幻"],
      "Film-Noir": ["黑暗"],
      "Game-Show": ["综艺"],
      "History": ["历史"],
      "Horror": ["恐怖"],
      "Musical": ["歌舞"],
      "Music": ["音乐"],
      "Mystery": ["悬疑"],
      "News": ["综艺"],
      "Reality-TV": ["综艺"],
      "Romance": ["爱情"],
      "Sci-Fi": ["科幻"],
      "Short": ["短片"],
      "Sport": ["运动"],
      "Talk-Show": ["综艺"],
      "Thriller": ["惊悚"],
      "War": ["战争"],
      "Western": ["西部"],
      "Wuxia": ["武侠"],
      "Martial-Arts": ["武侠"],
      "Kung-Fu": ["武侠"],
      "Samurai": [],
      "Disaster": ["灾难"],
      "Superhero": ["奇幻"],
      "Erotic-Thriller": ["情色"],
      "Steamy-Romance": [],
      "Dark-Comedy": ["喜剧", "黑暗"],
      "Dark-Fantasy": ["奇幻", "黑暗"],
      "Dystopian-Sci-Fi": ["末世"],
      "Post-Apocalyptic": ["末世"],
      "Survival-Thriller": ["生存"],
      "Survival-Competition": ["综艺"],
      "Zombie-Horror": ["恐怖"],
      "Slasher-Horror": ["恐怖"],
      "Folk-Horror": ["恐怖"],
      "Body-Horror": ["猎奇"],
      "Political-Drama": ["政治"],
      "Political-Documentary": ["政治"],
      "Workplace-Drama": ["职业"],
      "Medical-Drama": ["职业"],
      "Legal-Drama": ["职业"],
      "Costume-Drama": ["古装"],
      "Period-Drama": ["古装"],
      "Coming-of-Age": ["校园"],
      "Teen-Drama": ["校园"],
      "Biopic": ["传记"],
      "Short-Film": ["短片"],
      "Adult-Animation": ["成人", "动画"],
      "Anime": [],
      "Mecha": [],
      "Isekai": ["奇幻"],
      "Slice-of-Life": ["生活"],
      "True-Crime": ["犯罪"],
      "Mockumentary": [],
      "Docudrama": ["纪录", "剧情"],
      "Sitcom": ["喜剧"],
      "Stand-Up-Comedy": ["喜剧"],
      "Satire": ["喜剧"],
      "Parody": ["喜剧"],
      "Romantic-Comedy": ["爱情", "喜剧"],
      "Psychological-Thriller": ["惊悚"],
      "Spy": ["惊悚"],
      "Conspiracy-Thriller": ["惊悚"],
      "Quiz-Show": ["综艺"],
      "Talent-Competition": ["综艺"],
      "Sword-and-Sorcery": ["奇幻"],
      "Fairy-Tale": ["奇幻"],
      "Fantasy-Epic": ["奇幻"],
      "Artificial-Intelligence": ["科幻"],
      "Cyberpunk": ["科幻"],
      "Time-Travel": ["科幻"],
      "Korean-Drama": [],
      "Soap-Opera": [],
      "Telenovela": [],
    },
    "TMDB": {
      "Action": ["动作"],
      "Adventure": ["冒险"],
      "Animation": ["动画"],
      "Comedy": ["喜剧"],
      "Crime": ["犯罪"],
      "Documentary": ["纪录"],
      "Drama": ["剧情"],
      "Family": ["生活"],
      "Fantasy": ["奇幻"],
      "History": ["历史"],
      "Horror": ["恐怖"],
      "Music": ["音乐"],
      "Mystery": ["悬疑"],
      "Romance": ["爱情"],
      "Science-Fiction": ["科幻"],
      "TV-Movie": [],
      "Thriller": ["惊悚"],
      "War": ["战争"],
      "Western": ["西部"],
      "Action & Adventure": ["动作", "冒险"],
      "Kids": ["儿童"],
      "News": ["综艺"],
      "Reality": ["综艺"],
      "Sci-Fi & Fantasy": ["科幻", "奇幻"],
      "Soap": [],
      "Talk": ["综艺"],
      "War & Politics": ["战争", "政治"],
      "剧情": ["剧情"],
      "犯罪": ["犯罪"],
    },
    "Bangumi": {
      "搞笑": ["喜剧"],
      "喜剧": ["喜剧"],
      "欢乐": ["喜剧"],
      "吐槽": ["喜剧"],
      "玩梗": ["喜剧"],
      "恶搞": ["喜剧"],
      "无厘头": ["喜剧"],
      "爆笑": ["喜剧"],
      "讽刺": ["喜剧"],
      "沙雕": ["喜剧"],
      "恋爱": ["爱情"],
      "纯爱": ["爱情"],
      "狗粮": ["爱情"],
      "党争": ["爱情"],
      "甜": ["爱情"],
      "胃疼": ["爱情"],
      "恋爱喜剧": ["爱情"],
      "耽美": ["同性"],
      "耽美系": ["同性"],
      "男同": ["同性"],
      "BL": ["同性"],
      "BL动画": ["同性"],
      "腐": ["同性"],
      "腐向": ["同性"],
      "搅基": ["同性"],
      "基": ["同性"],
      "基情": ["同性"],
      "百合": ["同性"],
      "轻百合": ["同性"],
      "轻百": ["同性"],
      "肉番": ["成人"],
      "卖肉": ["成人"],
      "肉": ["成人"],
      "肉片": ["成人"],
      "露点": ["成人"],
      "杀必死": ["成人"],
      "福利": ["成人"],
      "战斗": ["动作"],
      "打斗": ["动作"],
      "打鬥": ["动作"],
      "格斗": ["动作"],
      "动作": ["动作"],
      "枪战": ["动作"],
      "超能力": ["奇幻"],
      "超自然系": ["奇幻"],
      "异能": ["奇幻"],
      "幻想": ["奇幻"],
      "魔幻": ["奇幻"],
      "魔法": ["奇幻"],
      "奇幻": ["奇幻"],
      "异世界": ["奇幻"],
      "转生": ["奇幻"],
      "穿越": ["奇幻"],
      "平行世界": ["奇幻"],
      "宇宙": ["科幻"],
      "太空": ["科幻"],
      "太空歌剧": ["科幻"],
      "赛博朋克": ["科幻"],
      "机战": ["科幻"],
      "机甲": ["科幻"],
      "萝卜": ["科幻"],
      "GUNDAM": ["科幻"],
      "高达": ["科幻"],
      "战争": ["战争"],
      "反战": ["战争"],
      "推理系": ["推理"],
      "猎奇": ["猎奇"],
      "血腥": ["猎奇"],
      "重口味": ["猎奇"],
      "重口": ["猎奇"],
      "致郁": [],
      "废土": [],
      "架空世界": ["奇幻"],
      "种田": ["生活"],
      "日常": ["生活"],
      "日常系": ["生活"],
      "治愈": ["生活"],
      "治愈系": ["生活"],
      "温情": ["生活"],
      "温馨": ["生活"],
      "感动": ["生活"],
      "职场": ["职业"],
      "社会见闻": ["职业"],
      "竞技": [],
      "卡牌": [],
      "体育": ["运动"],
      "体育番": ["运动"],
      "棒球": ["运动"],
      "运动番": ["运动"],
      "歌番": ["音乐"],
      "乐队": ["音乐"],
      "偶像": [],
      "魔法少女": ["奇幻"],
      "变身": ["奇幻"],
      "子供向": ["儿童"],
      "子供": ["儿童"],
      "幼女向": ["儿童"],
      "青春": ["校园"],
      "短篇": ["短片"],
      "OVA": [],
      "泡面番": [],
      "剧场版": [],
      "季番": [],
      "原创": [],
      "漫改": [],
      "轻改": [],
      "GAL改": [],
      "游戏改": [],
      "热血": [],
      "燃": [],
      "励志": [],
      "成长": [],
      "催泪": [],
      "复仇": [],
      "文艺": [],
      "中二": [],
      "电波": [],
      "扭曲": [],
      "萌系": [],
      "后宫": [],
      "女性向": [],
      "龙傲天": [],
      "现世": [],
      "架空": [],
      "未来": [],
      "近代": [],
      "古代": [],
      "都市": [],
      "校园": ["校园"],
      "剧情": ["剧情"],
      "悬疑": ["悬疑"],
      "推理": ["推理"],
      "音乐": ["音乐"],
      "运动": ["运动"],
      "历史": ["历史"],
      "冒险": ["冒险"],
      "科幻": ["科幻"],
      "爱情": ["爱情"],
      "黑暗": ["黑暗"],
      "恐怖": ["恐怖"],
    },
    "红果短剧": {
      "都市爱情": ["爱情"],
      "古风爱情": ["爱情"],
      "奇幻爱情": ["爱情"],
      "仙侠爱情": ["爱情"],
      "年代爱情": ["爱情"],
      "现言甜宠": ["爱情"],
      "都市情感": ["爱情"],
      "古风言情": ["爱情"],
      "古装爱情": ["爱情"],
      "甜宠": ["爱情"],
      "先婚后爱": ["爱情"],
      "日久生情": ["爱情"],
      "暗恋成真": ["爱情"],
      "破镜重圆": ["爱情"],
      "闪婚": ["爱情"],
      "追妻": ["爱情"],
      "虐恋": ["爱情"],
      "契约婚姻": ["爱情"],
      "轻喜剧": ["喜剧"],
      "悬疑推理": ["悬疑", "推理"],
      "悬疑情感": ["悬疑"],
      "悬疑灵异": ["悬疑"],
      "刑侦破案": ["犯罪", "推理"],
      "反转": ["悬疑"],
      "玄幻仙侠": ["玄幻", "修仙"],
      "修真": ["修仙"],
      "仙尊": ["修仙"],
      "系统修仙": ["修仙"],
      "修仙": ["修仙"],
      "奇幻脑洞": ["奇幻"],
      "奇幻异能": ["奇幻"],
      "脑洞": [],
      "系统": [],
      "异能": [],
      "玄学": [],
      "古风权谋": ["古装"],
      "宫斗宅斗": ["古装"],
      "朝堂权谋": ["古装"],
      "历史古代": ["古装"],
      "古言甜宠": ["古装"],
      "战神归来": [],
      "强者回归": [],
      "隐藏大佬": [],
      "马甲": [],
      "扮猪吃虎": [],
      "打脸虐渣": [],
      "逆袭翻身": [],
      "重生逆袭": [],
      "虐渣": [],
      "重生": [],
      "穿越": [],
      "穿书": [],
      "异界": [],
      "架空": [],
      "古代": [],
      "求生": ["生存"],
      "末世": ["末世"],
      "丧尸": ["末世"],
      "囤货": [],
      "无限流": [],
      "规则怪谈": ["悬疑"],
      "动作打斗": ["动作"],
      "家庭": ["生活"],
      "家庭伦理": ["生活"],
      "家族": ["生活"],
      "家族振兴": ["生活"],
      "婚姻生活": ["生活"],
      "婆媳": ["生活"],
      "都市": ["生活"],
      "都市日常": ["生活"],
      "都市脑洞": ["生活", "奇幻"],
      "都市玄幻": ["生活", "玄幻"],
      "年代": ["生活"],
      "乡村": ["生活"],
      "种田": ["生活"],
      "成长": [],
      "女性成长": [],
      "大女主": [],
      "女强": [],
      "职场励志": [],
      "校园": ["校园"],
      "青春": ["校园"],
      "学渣逆袭": ["校园"],
      "职场": ["职业"],
      "法律正义": ["犯罪"],
      "民国": ["历史"],
      "谍战": ["历史"],
      "家国情怀": ["历史"],
      "AI": ["科幻"],
      "平行世界": ["科幻"],
      "外星": ["科幻"],
      "萌宝": [],
      "福宝": [],
      "诡秘": [],
      "灵异": [],
      "AI剧": ["AI剧"],
      "漫剧": ["AI剧", "短剧"],
      "真人剧": ["短剧"],
      "短剧": ["短剧"],
      "爱情": ["爱情"],
      "古装": ["古装"],
      "剧情": ["剧情"],
      "喜剧": ["喜剧"],
      "悬疑": ["悬疑"],
      "玄幻": ["玄幻"],
      "奇幻": ["奇幻"],
    }
  };

  /**
   * 固定注入（D9）：红果整站每条都带「短剧」，不依赖页面是否出现该词。
   * 这是站点事实，不是页面数据 —— 所以不能靠查表，必须硬注入。
   */
  var INJECT = {"红果短剧": ["短剧"]};

  /** 站点别名 → 规范站点名（调用方传域名 / 短名也能查） */
  var SITE_ALIASES = {
    'douban': '豆瓣电影',
    'douban-movie': '豆瓣电影',
    'movie.douban.com': '豆瓣电影',
    '豆瓣': '豆瓣电影',
    'imdb': 'IMDb',
    'www.imdb.com': 'IMDb',
    'tmdb': 'TMDB',
    'www.themoviedb.org': 'TMDB',
    'themoviedb': 'TMDB',
    'bgm': 'Bangumi',
    'bgm.tv': 'Bangumi',
    'bangumi.tv': 'Bangumi',
    'chii.in': 'Bangumi',
    'hongguo': '红果短剧',
    'hongguoduanju.com': '红果短剧',
    'www.hongguoduanju.com': '红果短剧',
    'novelquickapp': '红果短剧',
    'www.novelquickapp.com': '红果短剧'
  };

  /**
   * 词的归一键：小写、去掉所有空白/连字符/下划线/间隔号/斜杠。
   * 目的：让 'Sci-Fi' / 'Sci Fi' / 'SciFi'、'Film-Noir' / 'Film Noir'、
   * 'TV-Movie' / 'TV Movie' 都能命中同一条规则。
   * 中文不受影响（中文里本来就没有这些分隔符）。
   */
  function keyOf(word) {
    return String(word == null ? '' : word)
      .toLowerCase()
      .replace(/[\s\-_\u00b7\u30fb\u2022\/\\]+/g, '')
      .trim();
  }

  /** 拆词：支持数组，或「、，,/|｜」连接的字符串 */
  function splitWords(input) {
    if (input == null) return [];
    if (Array.isArray(input)) {
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var piece = input[i];
        if (piece == null) continue;
        // 数组元素自身也可能带分隔符（IMDb 的 "Drama, Action" 这种写法）
        if (typeof piece === 'string' && /[、，,\/|｜]/.test(piece)) {
          out = out.concat(splitWords(piece));
        } else {
          var t = String(piece).trim();
          if (t) out.push(t);
        }
      }
      return out;
    }
    return String(input)
      .split(/[、，,\/|｜]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
  }

  /** 站点名规范化 */
  function siteKeyOf(site) {
    var s = String(site == null ? '' : site).trim();
    if (!s) return '';
    if (LOOKUP[s]) return s;
    var low = s.toLowerCase();
    if (SITE_ALIASES[low]) return SITE_ALIASES[low];
    if (SITE_ALIASES[s]) return SITE_ALIASES[s];
    return s;
  }

  /**
   * 每站一份「归一键 → 标签数组」的索引，模块加载时建一次。
   * 只建索引不查原表，是为了让分隔符/大小写差异不用在调用点处理。
   * 冲突检测：同一站两个不同的原词归一到同一个键、且映射不同 → 记录在 CONFLICTS，
   * 由单测断言为空（否则谁覆盖谁全看遍历顺序，属于静默错）。
   */
  var INDEX = {};
  var CONFLICTS = [];
  Object.keys(LOOKUP).forEach(function (site) {
    var map = LOOKUP[site];
    var idx = {};
    Object.keys(map).forEach(function (word) {
      var k = keyOf(word);
      if (!k) return;
      if (Object.prototype.hasOwnProperty.call(idx, k)) {
        var prev = idx[k];
        var next = map[word];
        if (JSON.stringify(prev.tags) !== JSON.stringify(next)) {
          CONFLICTS.push({ site: site, key: k, keptBy: prev.word, conflictWith: word });
        }
        return;
      }
      idx[k] = { word: word, tags: map[word] };
    });
    INDEX[site] = idx;
  });

  /**
   * 标准词恒直通索引（keyOf(标准词) → 标准词）。
   *
   * 【为什么必须有这一层】
   * Bangumi 的标签是用户投票打的、红果的是运营题材，两边的词永远补不完 ——
   * 规则集里只收了那批「有明确近义关系」的词。于是会出现这种荒唐情况：
   * Bangumi 页面上明明白白写着「犯罪」（正好就是 44 个标准词之一），
   * 但查表查不到 → 判成未命中 → 掉进「其他信息」，标签列空着。
   * 实测：bgm-64965《教父》就是这样，标签列本来该是「犯罪」。
   *
   * 所以只要站点写的就是标准词本身，一律算命中。站点差异不会因此被抹掉：
   * 44 个标准词里没有任何一个在某个站被故意设成「只进其他信息」（生成时有断言拦）。
   */
  var STANDARD_BY_KEY = {};
  STANDARDS.forEach(function (t) {
    STANDARD_BY_KEY[keyOf(t)] = t;
  });

  /**
   * 归一主函数。
   *
   * @param {string} site  站点名（'豆瓣电影' / 'IMDb' / 'TMDB' / 'Bangumi' / '红果短剧'，也吃别名）
   * @param {string|string[]} input 原始词，字符串或数组，带「、，,/」分隔都行
   * @returns {{site: string, tags: string[], others: string[], unknown: string[]}}
   *   tags    写进「标签」列的**标准词**（已去重保序）
   *   others  写进「其他信息」的原词（已知不并 + 真未命中，去重保序）
   *   unknown others 里属于「真未命中」的那部分（调试 / 日志用）
   */
  function normalize(site, input) {
    var s = siteKeyOf(site);
    var words = splitWords(input);
    var idx = INDEX[s] || null;

    var tags = [];
    var others = [];
    var unknown = [];
    var seenTag = {};
    var seenOther = {};

    function pushTag(t) {
      if (!t || seenTag[t]) return;
      seenTag[t] = 1;
      tags.push(t);
    }
    function pushOther(w) {
      if (!w || seenOther[w]) return;
      seenOther[w] = 1;
      others.push(w);
    }

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var hit = idx ? idx[keyOf(w)] : null;
      if (!hit) {
        // 标准词恒直通（见 STANDARD_BY_KEY 的说明）：
        // 站点写的就是 44 个标准词之一，没道理判它未命中。
        var std = STANDARD_BY_KEY[keyOf(w)];
        if (std) hit = { word: w, tags: [std] };
      }
      if (hit) {
        if (hit.tags.length) {
          for (var j = 0; j < hit.tags.length; j++) pushTag(hit.tags[j]);
        } else {
          // 已知词、故意不并（D10）—— 原词照旧展示，但不算「未命中」
          pushOther(w);
        }
      } else {
        // 真未命中（D11 兜底）：不猜、不丢
        pushOther(w);
        unknown.push(w);
      }
    }

    // 站点固定注入（D9）
    var inj = INJECT[s] || [];
    for (var k = 0; k < inj.length; k++) pushTag(inj[k]);

    return { site: s, tags: tags, others: others, unknown: unknown };
  }

  /** 拼成「标签」列要的字符串（半角逗号，与豆瓣/红果历史格式一致） */
  function joinTags(site, input) {
    return normalize(site, input).tags.join(',');
  }

  /** 只要「其他信息」那部分原词，半角逗号连接 */
  function joinOthers(site, input) {
    return normalize(site, input).others.join(',');
  }

  var api = {
    RULESET_VERSION: RULESET_VERSION,
    STANDARDS: STANDARDS,
    LOOKUP: LOOKUP,
    INJECT: INJECT,
    SITE_ALIASES: SITE_ALIASES,
    CONFLICTS: CONFLICTS,
    keyOf: keyOf,
    splitWords: splitWords,
    siteKeyOf: siteKeyOf,
    isStandard: function (w) { return !!STANDARD_BY_KEY[keyOf(w)]; },
    normalize: normalize,
    joinTags: joinTags,
    joinOthers: joinOthers
  };

  if (typeof window !== 'undefined') {
    window.ClipMateTags = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
