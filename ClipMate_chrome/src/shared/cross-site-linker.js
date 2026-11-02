/**
 * 跨站补网址 —— 查询计划 + 响应解析（纯函数，不联网）
 *
 * v2.5.72 新增；v2.5.73 扩成「影视四站互跳」。
 *
 * 要解决的问题：在影视页提取完，豆瓣链接 / IMDB / TMDB / Bangumi 四格里有空的，
 * 得自己一个个去搜。这个模块负责回答「拿什么词去搜」和「搜出来的东西里哪一条才是」。
 * 真正发请求的是 background（内容脚本跨域会被 CORS 拦），它只负责按这里的 URL 把原件拿回来。
 *
 * 四个站的脾气完全不同（2026-10-26 实测）：
 *   豆瓣    —— 认得 IMDb 编号，`j/search_suggest?q=tt0068646` 直接给条目；
 *              按片名也行，但结果里会混进「书 / 音乐」，必须按域名筛，只认 movie.douban.com。
 *   番组计划 —— **不认 IMDb 编号**（v0 接口 filter.type 只吃 2/6，接口按关键字搜），
 *              必须用**原名**搜：搜「教父」返回 0 条，搜「The Godfather」第一条就是 64965。
 *              v0 接口要 POST 一个 JSON，且必须带一个像样的 UA。
 *   TMDB    —— 有个**免 key 的精确跳转端点** `/redirect?external_source=imdb_id&external_id=tt…`：
 *              对得上就跳，找不到就原地不动（实测 tt0000000 不跳）。有编号时一律走它。
 *              按片名搜也认（`search?query=`），但那是「没编号时」的退路。
 *   IMDB    —— 反过来（TMDB 页补 IMDB 格）TMDB 网页上**故意不给**编号
 *              （官方 STAFF 2024-06-11：IMDb 是最大竞争对手，不在主页面链接他们），
 *              得用 IMDb 自己的 Suggest 接口先猜候选，再拿候选回 TMDB /redirect
 *              验一遍（落地条目要和当前页同号才认），见 v2.5.75「TMDB → IMDB 反查」。
 *
 * v2.5.73 新增「本页跳过」：从豆瓣页不会再补「豆瓣链接」这一格，避免把当前网址
 * 抄进自己的格子（四站互跳之后，每站都有 3 个可补目标，其中 1 个必须是它自己）。
 *
 * 解析全部写成纯函数，入参是「接口原样的字符串 / 最终落地地址」，所以能用存档在 Node 里单测。
 */
(function (root) {
  'use strict';

  // ---------------- 端点（集中在这里，改站只改这三行） ----------------

  var DOUBAN_SUGGEST = 'https://www.douban.com/j/search_suggest?q=';
  var BGM_SEARCH = 'https://api.bgm.tv/v0/search/subjects?limit=10';
  var TMDB_SEARCH = 'https://www.themoviedb.org/search?query=';
  // v2.5.73：有 IMDb 编号时的精确跳转端点。TMDB 官网页面上不显示编号，
  // 但这个端点是服务端查表：编号存在就 302 到条目页，不存在就原地返回自己。
  var TMDB_REDIRECT = 'https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=';

  /**
   * 四个目标字段。顺序 = 提示里的顺序。
   * v2.5.73：新增 imdb。豆瓣页 / 番组计划页自带 tt 编号的，这一格在本地就能拼出来，
   * 根本不用发请求（见 imdbUrlOf）。
   */
  var TARGETS = [
    { kind: 'douban', key: '豆瓣链接', label: '豆瓣' },
    { kind: 'imdb', key: 'IMDB', label: 'IMDB' },
    { kind: 'tmdb', key: 'TMDB', label: 'TMDB' },
    { kind: 'bgm', key: 'Bangumi', label: '番组计划' }
  ];

  function str(v) {
    return (v === null || v === undefined) ? '' : String(v).trim();
  }

  /** 含中日韩文字吗（豆瓣搜索用中文名命中率远高于英文名） */
  var CJK_RE = /[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

  /**
   * 从「名字」里抽纯中文那一段。
   *
   * 豆瓣电影页的提取器是**中英混排**的（源码里明写「检查名字是否包含中英文两种语言」
   * 「组合它们」），拿到的常常是「肖申克的救赎 The Shawshank Redemption」这种。
   * 整串丢给豆瓣搜索会明显变差，所以只取连续的中文段。
   *
   * 三种情况分清楚，别多此一举：
   *   · 没有中日韩文字      → 返回空串（IMDb 页的「名字」是纯英文，调用方退回英文原名）
   *   · 有中日韩但没拉丁字母 → **原样返回**（本来就是纯中文/日文，连标点都别动）
   *   · 中英混排            → 只取连续的中文段
   *
   * TMDB 中文页的「名字」是 JSON-LD 里的纯中文名（教父），走第二条原样返回。
   */
  function pickCnName(name) {
    var s = str(name);
    if (!s || !CJK_RE.test(s)) return '';
    if (!/[A-Za-z]/.test(s)) return s;
    var m = s.match(/[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af][\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af\s\u3000·・：:，,、!！?？'"“”‘’（）()~～—–-]*[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/);
    return m ? m[0].trim() : '';
  }

  /**
   * 当前页属于哪个站。返回值和 TARGETS 的 kind 一一对应，用来做「本页跳过」。
   * 认不出来（理论上不会）就返回 null，此时四格全当可补。
   */
  function siteOf(pageUrl) {
    var u = str(pageUrl);
    if (!u) return null;
    if (/^https?:\/\/[^/]*\bimdb\.com\//i.test(u)) return 'imdb';
    if (/^https?:\/\/[^/]*\bdouban\.com\//i.test(u)) return 'douban';
    if (/^https?:\/\/[^/]*\bbgm\.tv\//i.test(u)) return 'bgm';
    if (/^https?:\/\/[^/]*\bthemoviedb\.org\//i.test(u)) return 'tmdb';
    return null;
  }

  // ---------------- 查询计划：从已提取的数据里凑出「搜什么」 ----------------

  /**
   * 搜索词候选，按可信度排序：
   *   1. 原作名 —— 原名（The Godfather），番组计划和 TMDB 都靠它
   *   2. 名字   —— IMDb 页只有这个（提取器把原名写在「名字」里）；
   *               豆瓣页的「名字」常常是「中文名 原名」拼起来的，所以排在后面
   */
  function keywordCandidates(data) {
    var out = [];
    var push = function (v) {
      v = str(v);
      if (v && out.indexOf(v) === -1) out.push(v);
    };
    if (data) {
      push(data['原作名']);
      push(data['名字']);
      push(data['游戏名']);
      push(data['书名']);
    }
    return out;
  }

  /** 年份：从「上映日期」（YYYY/MM/DD 或 YYYY-MM-DD 或 YYYY）里取 4 位 */
  function pickYear(data) {
    var raw = str(data && data['上映日期']);
    if (!raw) return null;
    var m = raw.match(/(1[89]\d{2}|20\d{2})/);
    return m ? parseInt(m[1], 10) : null;
  }

  /** IMDb 编号：先看已提取的 IMDB 网址，再看当前页 URL */
  function pickImdbId(data, pageUrl) {
    var sources = [str(data && data['IMDB']), str(pageUrl)];
    for (var i = 0; i < sources.length; i++) {
      var m = sources[i].match(/(tt\d{7,})/);
      if (m) return m[1];
    }
    return null;
  }

  /**
   * 组装查询计划
   * @param {object} data    浮窗里的数据（this.data）
   * @param {string} pageUrl 当前页地址
   */
  function buildPlan(data, pageUrl) {
    var kws = keywordCandidates(data);
    var mediaType = str(data && data['影视类型']);
    // 豆瓣优先用中文名：TMDB 中文页的「名字」就是中文名（教父），
    // 比拿英文原名去豆瓣搜准得多。IMDb 页的「名字」是英文，这里会自然留空。
    var name = str(data && data['名字']);
    return {
      imdbId: pickImdbId(data, pageUrl),
      keyword: kws[0] || '',
      keyword2: kws[1] || '',
      cnKeyword: pickCnName(name),
      year: pickYear(data),
      // 「剧集」就优先找 tv 条目；其余按电影找
      isTv: mediaType === '剧集' || mediaType === '电视剧'
    };
  }

  /**
   * v2.5.73：IMDB 这一格**不发请求**，有 tt 编号就直接拼网址。
   * 豆瓣电影页、番组计划页的信息框里本来就写着 IMDb 编号，提取器已经把整条网址
   * 放进 data['IMDB'] 了，所以这里只在「本格为空但能拿到编号」时才会用到。
   */
  function imdbUrlOf(plan) {
    var tt = plan && plan.imdbId;
    return tt ? 'https://www.imdb.com/title/' + tt + '/' : null;
  }

  // ---------------- TMDB → IMDB 反查（v2.5.75 批 2） ----------------
  //
  // 难在哪：TMDB 网页**故意不给** IMDb 编号（官方 STAFF 2024-06-11：
  // 「IMDb 是我们最大的竞争对手，没有在主页面链接他们的打算」）。
  // 所以只能倒着来：先拿片名去 IMDb 自己那儿猜几个候选，再回 TMDB 问
  // 「这个 tt 号是你们哪一条」——答出来的条目和当前页对得上，才算数。
  //
  // 为什么这样不会写错（这是整个方案的安全阀）：
  //   猜候选那步**允许猜错**，因为最后一步是 TMDB 自己的映射表在做裁决：
  //     tt0068646 → movie/238-the-godfather   当前页 238 → 命中
  //     tt0086066 → movie/227-the-outsiders   当前页 238 → 不命中，丢掉
  //   实测（2026-10-26，真扩展 SW 内）不存在的号连跳转都不发生（404 原地不动）。
  //   所以不存在「猜歪了写个错网址」的可能，只是多花一两个请求。

  var IMDB_SUGGEST = 'https://v3.sg.media-imdb.com/suggestion/x/';
  /** 一次最多验几个候选：反正验证请求很轻（urlOnly，不下载正文），够用就行 */
  var IMDB_VERIFY_LIMIT = 4;

  /**
   * 当前 TMDB 页是哪一条。只认条目页（/movie/238、/tv/4613），
   * 人物页 /person/、列表页 /movie（后面没数字）一律不认。
   * @returns {{kind:'movie'|'tv', id:string}|null}
   */
  function tmdbPageOf(pageUrl) {
    var m = str(pageUrl).match(/^https?:\/\/[^/]*\bthemoviedb\.org\/(movie|tv)\/(\d+)/i);
    if (!m) return null;
    return { kind: m[1].toLowerCase(), id: m[2] };
  }

  /** IMDb 建议接口（免费、免 key、认中英文） */
  function imdbSuggestUrl(word) {
    var w = str(word);
    return w ? IMDB_SUGGEST + enc(w) + '.json' : null;
  }

  /**
   * 解析建议接口。
   *
   * 返回的是 `{d:[{id,l,y,tl,qid,rank,s,i}]}`。实测三条脾气：
   *   · 条目号一定是 tt 开头，人物是 nm 开头 → **只留 tt**（nm 拿去问 TMDB 是白问）
   *   · `qid` 是类型：movie / tvSeries / tvMiniSeries / tvMovie / video…
   *   · `y` 是年份数字，偶尔只有 `tl`（名字末尾的 "(1972)"）→ 兜底从 tl 取
   *   · 中文名也能搜（几乎都有中文别名）：搜「教父」第一条就是 tt0068646，
   *     而且比英文名返回的噪音少得多（教父 1 条对得上，英文那串里混着
   *     Black Caesar、James Brown 这类）。
   */
  function parseImdbSuggest(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var list = data && data.d;
    if (!Array.isArray(list) || !list.length) return null;

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var id = str(it && it.id);
      if (!/^tt\d{7,}$/.test(id)) continue;
      var year = (typeof it.y === 'number') ? it.y : (parseInt(str(it.tl), 10) || null);
      out.push({ id: id, name: str(it.l), year: year, qid: str(it.qid) });
    }
    return out.length ? out : null;
  }

  /**
   * 给候选排个先后（只是「先问谁」，**不是「留谁」**）。
   *
   * 千万别在这里做「名字对不上就丢掉」：中文名搜出来的 `l` 全是英文标题
   * （搜「教父」返回 l="The Godfather"），nameScore 必然 0 分，
   * 一过滤就把正确答案一起丢掉。留不留由 TMDB 的验证结果决定。
   *
   * 计分：名字对得上 10 分档 > 类型对 4 分 > 年份对 3 分，
   * 同分按建议接口给的原始热度顺序（它自己就是按 rank 排的）。
   */
  function rankImdbCandidates(cands, plan, limit) {
    if (!Array.isArray(cands) || !cands.length) return [];
    plan = plan || {};
    var keys = [str(plan.cnKeyword), str(plan.keyword), str(plan.keyword2)]
      .filter(function (k) { return !!k; });
    var isTv = !!plan.isTv;
    var wantYear = plan.year || null;
    var seen = {};

    var scored = [];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (!c || !c.id || seen[c.id]) continue;
      seen[c.id] = 1;
      var typeOk = isTv ? /^tv/i.test(c.qid) : (c.qid === 'movie');
      var yearOk = !!wantYear && c.year === wantYear;
      var nameBest = 0;
      for (var j = 0; j < keys.length; j++) {
        nameBest = Math.max(nameBest, nameScore(c.name, [keys[j]]));
      }
      scored.push({ id: c.id, order: i, score: nameBest * 10 + (typeOk ? 4 : 0) + (yearOk ? 3 : 0) });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.order - b.order;
    });

    var n = (limit && limit > 0) ? limit : scored.length;
    return scored.slice(0, n).map(function (x) { return x.id; });
  }

  /** 搜候选的两条请求（中文名 + 原名一起问，谁快谁有用都行，省一个来回） */
  function imdbSuggestRequests(words) {
    var out = [];
    (words || []).forEach(function (w, i) {
      var url = imdbSuggestUrl(w);
      if (url) out.push({ kind: 'imdbs' + i, method: 'GET', url: url });
    });
    return out;
  }

  /** 验证请求：给一批 tt 号，问 TMDB「这个号是你们哪一条」（只要落地地址） */
  function imdbVerifyRequests(ids) {
    return (ids || []).slice(0, IMDB_VERIFY_LIMIT).map(function (tt, i) {
      return { kind: 'imdbv' + i, method: 'GET', urlOnly: true, url: TMDB_REDIRECT + enc(tt) };
    });
  }

  /**
   * 验证要分几批问（v2.5.76）。
   *
   * 为什么不一次并发问完 4 个：真机实测约 6 次里有 1 次《教父》补不上，
   * 而两个接口单独压测 20/20 全通、整条链只花 4~5 秒（不是慢）——
   * 说明是「6 条请求同时出去」时被限流或单条被抖掉。改成先问最有把握的那一个，
   * 命中立刻收工（常见情况只要 1 条请求），不中再并发送剩下的。
   *
   * 注意入参必须是 **tt 号字符串数组**（rankImdbCandidates 的输出），
   * 别再传候选对象数组 —— v2.5.74 就是这么静默全灭的。
   *
   * @param {string[]} ids 已按可能性排好序的 tt 号
   * @returns {string[][]}  依次要发的批次；顺序拼起来就是原顺序
   */
  function imdbVerifyRounds(ids) {
    var list = (ids || []).filter(function (x) { return !!x; }).slice(0, IMDB_VERIFY_LIMIT);
    if (!list.length) return [];
    var rounds = [list.slice(0, 1)];
    if (list.length > 1) rounds.push(list.slice(1));
    return rounds;
  }

  /**
   * 这个 tt 号是不是当前 TMDB 页那一条。
   * 判据只有一条：落地地址里的类型和编号都得对上。
   * 号不存在时 TMDB 根本不跳转（在原地返回 404），这里自然匹配不到。
   */
  function imdbVerified(tt, finalUrl, tmdbPage) {
    if (!tmdbPage || !tt) return false;
    var m = str(finalUrl).match(/themoviedb\.org\/(movie|tv)\/(\d+)/);
    if (!m) return false;
    return m[1].toLowerCase() === tmdbPage.kind && m[2] === String(tmdbPage.id);
  }

  /**
   * 从一批验证结果里挑出命中的那个。
   * @param {object} tmdbPage  当前页身份
   * @param {Array<{id:string, finalUrl:string}>} checked
   * @returns {string|null} IMDb 网址
   */
  function pickVerifiedImdb(tmdbPage, checked) {
    if (!tmdbPage || !Array.isArray(checked)) return null;
    for (var i = 0; i < checked.length; i++) {
      var c = checked[i];
      if (c && imdbVerified(c.id, c.finalUrl, tmdbPage)) {
        return 'https://www.imdb.com/title/' + c.id + '/';
      }
    }
    return null;
  }

  /**
   * 还缺哪些格（这些才去补）。
   *
   * 两道过滤：
   *   1. 已经有值的**一律跳过**（用户红线：绝不覆盖）
   *   2. 当前页自己那一格跳过（在豆瓣页补「豆瓣链接」等于把当前网址抄一遍）
   */
  function pendingTargets(data, pageUrl) {
    var here = siteOf(pageUrl);
    return TARGETS.filter(function (t) {
      if (str(data && data[t.key])) return false;
      if (here && t.kind === here) return false;
      return true;
    });
  }

  // ---------------- 请求组装 ----------------

  function enc(s) {
    return encodeURIComponent(s);
  }

  function roundKeyword(plan, round) {
    if (round <= 1) return plan.keyword || '';
    return plan.keyword2 || plan.keyword || '';
  }

  /** 豆瓣用的名字：中文名优先（有中文名时，豆瓣命中率和准确度都明显更好） */
  function doubanKeyword(plan) {
    return plan.cnKeyword || plan.keyword || '';
  }

  /**
   * 豆瓣第一轮有 tt 号就用 tt 号（最准），没有就用中文名。
   * 第二轮要「换一个词」：第一轮用 tt 号的，第二轮退到中文名；
   * 第一轮已经用了名字的，第二轮换第二候选（通常是英文原名）。
   */
  function doubanQuery(plan, round) {
    if (round <= 1) return plan.imdbId || doubanKeyword(plan);
    if (plan.imdbId) return doubanKeyword(plan) || plan.keyword2 || '';
    return plan.keyword2 || doubanKeyword(plan) || '';
  }

  /**
   * 第一轮：能精确就精确。
   *   · 豆瓣：有 IMDb 编号就用编号
   *   · TMDB：有 IMDb 编号就走 /redirect 精确跳转（v2.5.73 起），没有才按片名搜
   *   · 番组计划：永远只能按原名搜（它不认编号）
   * 第二轮：只对「服务器有回话但没找到」的站放开条件再试一次。
   *
   * IMDB 这一格不在这里出现——它不发请求，由 imdbUrlOf() 在本地拼。
   */
  function buildRequests(plan, round, kinds) {
    var out = [];
    var kw = roundKeyword(plan, round);
    (kinds || []).forEach(function (raw) {
      // 2026-10-26 加固：入参既可以是 'douban' 这样的字符串，也可以是
      // pendingTargets() 返回的 {kind,key,label} 对象。
      //
      // 起因是一个真 bug：调用方曾把对象数组直接传进来，而这里用 `kind === 'douban'`
      // 比字符串，恒不相等 → **一个请求都不构造** → 上层 requests.length 为 0 直接 break
      // → 全部走「搜索不到」，界面上没有任何报错。这种「静默全失败」最难查，
      // 所以干脆两种入参都吃，宁可多写三行也别让它再无声无息地错一次。
      var kind = (raw && typeof raw === 'object') ? raw.kind : raw;
      if (kind === 'imdb') return;   // 本地拼，无需请求
      if (kind === 'douban') {
        var q = doubanQuery(plan, round);
        if (!q) return;
        out.push({ kind: 'douban', method: 'GET', url: DOUBAN_SUGGEST + enc(q) });
        return;
      }
      if (kind === 'bgm') {
        if (!kw) return;
        out.push({
          kind: 'bgm',
          method: 'POST',
          url: BGM_SEARCH,
          // type 2 = 动画，6 = 三次元（真人影视）。番组计划的影视只有这两类。
          body: JSON.stringify({ keyword: kw, filter: { type: [2, 6] } })
        });
        return;
      }
      if (kind === 'tmdb') {
        // v2.5.73：有 IMDb 编号就走精确跳转。后台只回「最后落在哪个地址」，
        // 不回正文（urlOnly），省掉一次 150KB 的电影页下载。
        // 只跑一轮：TMDB 的映射表是确定的，第二轮再问答案不会变。
        if (plan.imdbId) {
          if (round > 1) return;
          out.push({
            kind: 'tmdb',
            method: 'GET',
            urlOnly: true,
            url: TMDB_REDIRECT + enc(plan.imdbId)
          });
          return;
        }
        if (!kw) return;
        // 电影 + 有年份 → 走 /search/movie?year= 收窄（实测比通用搜索准）
        if (round <= 1 && !plan.isTv && plan.year) {
          out.push({
            kind: 'tmdb',
            method: 'GET',
            url: 'https://www.themoviedb.org/search/movie?query=' + enc(kw) + '&year=' + plan.year + '&language=zh-CN'
          });
        } else {
          // 通用搜索：电影和剧集都认（实测「Band of Brothers」第一条就是 /tv/4613-）
          out.push({
            kind: 'tmdb',
            method: 'GET',
            url: TMDB_SEARCH + enc(kw) + '&language=zh-CN'
          });
        }
      }
    });
    return out;
  }

  // ---------------- 响应解析 ----------------

  /**
   * 名字归一：小写、去掉所有空白和标点，只留「字」。
   * 「The Godfather」「the-godfather」「The  Godfather (1972)」要能互相比。
   */
  function normalizeName(s) {
    return String(s === null || s === undefined ? '' : s)
      .toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[：:·・.,，。、!！?？'"“”‘’\-—–_/\\()（）\[\]【】~～&+*#@%^|<>]/g, '');
  }

  /** 计划里的名字候选（原作用来比对，不区分哪一轮用的什么词） */
  function keywordsOf(plan) {
    return [str(plan && plan.keyword), str(plan && plan.keyword2)]
      .filter(function (k) { return k; });
  }

  /**
   * 给一个候选名字打分：
   *   2 = 归一后完全相等
   *   1 = 互相包含（两边都至少 4 个字符，避免「教父」被「教父2」蹭上）
   *   0 = 对不上
   */
  function nameScore(candidate, keywords) {
    var c = normalizeName(candidate);
    if (c.length < 2) return 0;
    var best = 0;
    for (var i = 0; i < keywords.length; i++) {
      var k = normalizeName(keywords[i]);
      if (k.length < 2) continue;
      if (c === k) return 2;
      if (c.length >= 4 && k.length >= 4 && (c.indexOf(k) !== -1 || k.indexOf(c) !== -1)) {
        best = 1;
      }
    }
    return best;
  }

  /**
   * 豆瓣搜索建议：只认 movie.douban.com/subject/<数字>/
   * 混进来的书（book.douban.com）、音乐（music.douban.com）一律丢掉。
   *
   * v2.5.72：**这里故意不做名字校验**。
   * 豆瓣的搜索结果和我们的搜索词常常不是一个语言——IMDb/番组计划页给的是
   * 「The Godfather」，豆瓣返回的 title 是「教父」，名字比对上必然判成「搜不到」，
   * 而它其实是完全正确的条目。豆瓣自己有 tt 号精确检索和成熟的排序，
   * 取它给的第一条比我们自己猜更可靠。年份只在有多条时用来挑。
   */
  function parseDoubanSuggest(text, plan) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var cards = data && data.cards;
    if (!Array.isArray(cards)) return null;

    var movies = [];
    for (var i = 0; i < cards.length; i++) {
      var url = str(cards[i] && cards[i].url);
      var m = url.match(/^https?:\/\/movie\.douban\.com\/subject\/(\d+)/);
      if (m) movies.push({ id: m[1], year: str(cards[i].year) });
    }
    if (!movies.length) return null;

    var wantYear = plan && plan.year ? String(plan.year) : '';
    var pick = wantYear ? (movies.find(function (x) { return x.year === wantYear; }) || null) : null;
    if (!pick) pick = movies[0];
    return 'https://movie.douban.com/subject/' + pick.id + '/';
  }

  /**
   * 番组计划 v0 搜索。
   *
   * v2.5.72：**必须名字对得上才写**（原来「年份对不上就退回第一条」太宽松）。
   * 反例（真机实测）：豆瓣《肖申克》页去番组计划搜「The Shawshank Redemption」，
   * 番组计划根本没收录这部片，却回了 1000 条按词袋乱命中的结果，
   * 原来会照着取第一条，把《黑客帝国动画版》(subject/496) 写进去。
   * 写一个错网址比留空更糟——留空还能让人看出来要去补，写错就悄悄错了。
   *
   * 判据：
   *   name / name_cn 与搜索词归一后完全相等 → 收（score 2）
   *   只是互相包含 → 仅当年份也对得上才收（score 1）
   *   都对不上 → null
   */
  function parseBgmSearch(text, plan) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var list = data && data.data;
    if (!Array.isArray(list) || !list.length) return null;

    var keys = keywordsOf(plan);
    if (!keys.length) return null;   // 没有可比的词，宁可留空

    var wantYear = plan && plan.year ? String(plan.year) : '';
    var pick = null;
    var bestRank = 0;

    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || !it.id) continue;
      var score = Math.max(nameScore(it.name, keys), nameScore(it.name_cn, keys));
      if (!score) continue;
      var yearOk = !!wantYear && str(it.date).slice(0, 4) === wantYear;
      if (score === 1 && !yearOk) continue;
      var rank = score * 2 + (yearOk ? 1 : 0);
      if (rank > bestRank) { bestRank = rank; pick = it; }
    }
    if (!pick) return null;
    return 'https://bgm.tv/subject/' + pick.id;
  }

  /**
   * TMDB 搜索结果页（服务端渲染的纯 HTML，程序 fetch 拿到就是带结果的，实测 178KB）。
   *
   * 页面把结果分块放在固定 id 的容器里，顺序是：
   *   #movie_results → #tv_results → #collection_results → #keyword_results
   *   → #person_results → #company_results → #network_results → #award_results
   * 每张卡片长这样：
   *   <a data-media-type="movie" href="/movie/238-the-godfather?language=zh-CN">
   *   … <span class="release_date w-full font-light">1972 年 03 月 24 日</span>
   *
   * 为什么必须按容器切：搜「The Godfather」时 #movie_results 里是电影，
   * #tv_results 里还有一堆同名的电视剧（The Godfather 小说改编剧等）。
   * 不切容器就会把电视剧的 id 写进电影的「TMDB」格。
   *
   * 挑选顺序：类型+年份都对 → 该容器内第一条 → 都没有就返回 null（宁空不错）。
   * 注意 /movie/now-playing、/movie/top-rated 这类导航链接后面没有数字，`\d+` 天然挡掉。
   *
   * v2.5.72：把「有没有收录」也管起来。光靠「容器内第一条」同样会写出错误网址
   * （同一个问题在番组计划上是实测出来的）。判据用两样东西，任一对得上就行：
   *   · slug —— 就是英文标题的连字符写法，`238-the-godfather` → "thegodfather"
   *   · 卡片标题 —— <h2> 里两段 span：`<span>教父</span><span> (The Godfather)</span>`
   * 两样都留空才判定「搜不到」。
   */
  var TMDB_SECTIONS = [
    'movie_results', 'tv_results', 'collection_results', 'keyword_results',
    'person_results', 'company_results', 'network_results', 'award_results'
  ];

  function tmdbSection(html, wantId) {
    var start = html.indexOf('id="' + wantId + '"');
    if (start === -1) return null;
    var end = html.length;
    for (var i = 0; i < TMDB_SECTIONS.length; i++) {
      var id = TMDB_SECTIONS[i];
      if (id === wantId) continue;
      var at = html.indexOf('id="' + id + '"', start + 1);
      if (at !== -1 && at < end) end = at;
    }
    return html.slice(start, end);
  }

  /** 从卡片片段里抠出 <h2> 内所有 span 的文字（中文名 + 括号里的原名） */
  function tmdbCardTitles(near) {
    var out = [];
    var h2 = near.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!h2) return out;
    var re = /<span[^>]*>([\s\S]*?)<\/span>/g;
    var m;
    while ((m = re.exec(h2[1])) !== null) {
      var t = m[1].replace(/<[^>]*>/g, '').trim();
      if (t) out.push(t);
    }
    if (!out.length) {
      var plain = h2[1].replace(/<[^>]*>/g, '').trim();
      if (plain) out.push(plain);
    }
    return out;
  }

  function parseTmdbSearch(html, opts) {
    opts = opts || {};
    if (!html || typeof html !== 'string') return null;

    var wantKind = opts.isTv ? 'tv' : 'movie';
    var scope = tmdbSection(html, wantKind + '_results') || html;

    var re = /href="\/(movie|tv)\/(\d+)(?:-([^"?#]*))?/g;
    var items = [];
    var seen = {};
    var m;
    while ((m = re.exec(scope)) !== null) {
      var kind = m[1];
      if (kind !== wantKind) continue; // 容器切过之后基本不会命中，留着兜底
      var id = m[2];
      var key = kind + ':' + id;
      if (seen[key]) continue;
      seen[key] = 1;

      // 年份在紧随其后的 release_date 里（同一张卡片内，窗口取 1200 字符足够）
      var nearText = scope.slice(m.index, m.index + 1200);
      var ym = nearText.match(/release_date[^>]*>\s*(\d{4})/);
      items.push({
        kind: kind,
        id: id,
        slug: str(m[3]).replace(/\/+$/, ''),
        names: tmdbCardTitles(nearText),
        year: ym ? parseInt(ym[1], 10) : null
      });
    }
    if (!items.length) return null;

    var keys = keywordsOf(opts);
    var pick = null;
    var bestRank = 0;

    if (keys.length) {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var score = nameScore(it.slug.replace(/-/g, ' '), keys);
        for (var j = 0; j < it.names.length && score < 2; j++) {
          score = Math.max(score, nameScore(it.names[j], keys));
        }
        if (!score) continue;
        var yearOk = !!opts.year && it.year === opts.year;
        if (score === 1 && !yearOk) continue;
        var rank = score * 2 + (yearOk ? 1 : 0);
        if (rank > bestRank) { bestRank = rank; pick = it; }
      }
      // 有搜索词却一条都对不上 → 认定 TMDB 没收录，留空
      if (!pick) return null;
    } else {
      // 没有可比的名字（极少见），退回「年份对得上 → 第一条」
      if (opts.year) pick = items.find(function (x) { return x.year === opts.year; }) || null;
      if (!pick) pick = items[0];
      if (!pick) return null;
    }

    return 'https://www.themoviedb.org/' + pick.kind + '/' + pick.id + (pick.slug ? '-' + pick.slug : '');
  }

  /**
   * TMDB 精确跳转的结果（v2.5.73）。
   *
   * 入参是**最终落地地址**（background 跟随重定向后拿到的 res.url），不是正文。
   * 判据只有一个：落地地址里必须真的出现 /movie/<数字> 或 /tv/<数字>。
   *
   * 实测（2026-10-26，SW 内）：
   *   tt0068646 → https://www.themoviedb.org/movie/238-the-godfather
   *   tt0000000 → https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=tt0000000
   *                （编号不存在时 TMDB 原地不动，这里自然匹配不到 → null）
   * 所以「有没有这条」由 TMDB 服务端的映射表回答，不用我们拿名字猜。
   */
  function parseRedirect(finalUrl) {
    var u = str(finalUrl);
    var m = u.match(/themoviedb\.org\/(movie|tv)\/(\d+)(?:-([^/?#]*))?/);
    if (!m) return null;
    var slug = str(m[3]).replace(/\/+$/, '');
    return 'https://www.themoviedb.org/' + m[1] + '/' + m[2] + (slug ? '-' + slug : '');
  }

  /**
   * 统一入口：按站点把原文解析成网址
   * @param {string} kind      douban / imdb / tmdb / bgm
   * @param {string} text      响应正文（TMDB 跳转模式没有正文，传空即可）
   * @param {object} plan      buildPlan 的结果
   * @param {string} finalUrl  background 返回的最终地址（只有 TMDB 跳转模式用得上）
   */
  function parseResult(kind, text, plan, finalUrl) {
    plan = plan || {};
    if (kind === 'douban') return parseDoubanSuggest(text, plan);
    if (kind === 'bgm') return parseBgmSearch(text, plan);
    if (kind === 'imdb') return imdbUrlOf(plan);   // 本地拼，不看响应
    if (kind === 'tmdb') {
      // 有编号时走的是跳转模式，答案在落地地址里
      if (plan.imdbId) return parseRedirect(finalUrl);
      return parseTmdbSearch(text, plan);
    }
    return null;
  }

  // ================================================================
  // 书籍「URL」补齐（v2.5.76）
  // ================================================================
  //
  // 场景：豆瓣书籍页的 `URL` 格**故意留空**（douban-book.js 里写死 fields['URL'] = ''），
  // 它代表「这本书在别的站的链接」。番组计划 / 起点 / 番茄 / Goodreads 反过来，
  // 填 URL 而留空「豆瓣链接」—— 所以这条链天然只在豆瓣书籍页跑得起来。
  //
  // 两站分工（用户 2026-10-26 拍板）：
  //   · Goodreads —— 有 ISBN 就打 `/book/isbn/<ISBN>` 直达。ISBN 是全球唯一编号，
  //     落点变成 /book/show/<id> 就说明「登记了这个 ISBN 的那个版本」被找到了，
  //     命中即同版本，不用比书名。**优先写它。**
  //   · 番组计划 —— 按名字搜，但**只接受主条目**（无卷号的作品页）。
  //     用户原话：「番组要的就是主条目，不是主条目的不要」。
  //     分卷条目（`鬼滅の刃 (1)`）一律丢：URL 只有一个格，要放的是这部作品。
  //     实际效果还更好 —— 去掉卷号再搜，主条目正好排第一
  //     （真机实测：鬼滅の刃→168891、進撃の巨人→8491 都是第 1 条；
  //     而带卷号搜「鬼滅の刃 1」返回的 20 条全是分卷）。
  //   · 两站都命中 → Goodreads 的值进 URL，提示条带一句「番组计划也收录了这一部」。
  //
  // 为什么不照抄离线原型的打分制：原型要兼容「豆瓣要第 N 卷 → 认第 N 卷」，
  // 现在规则改成只认主条目，整套卷号加减分都不需要了。名字归一后**完全相等**才收，
  // 比打分更硬，也更难写错。

  var GOODREADS_ISBN = 'https://www.goodreads.com/book/isbn/';
  // 影视搜的是 type [2,6]（动画/三次元），书籍是 type [1]。
  // limit=20：番组排序不按相关度，多取一些才有机会碰到主条目（实测主条目通常在前几条）。
  var BGM_BOOK_SEARCH = 'https://api.bgm.tv/v0/search/subjects?limit=20';
  /** 最多拿几个词去搜（多一个词就多一条请求，实测两个够用） */
  var BOOK_WORD_LIMIT = 2;

  /** 全角转半角（只处理全角 ASCII 区，不碰假名和汉字） */
  function toHalfWidth(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[\uFF01-\uFF5E]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
      });
  }

  /** 去掉括号里的补充说明：「灌篮高手（全31卷）」→「灌篮高手」、「進撃の巨人(1)」→「進撃の巨人」 */
  function stripParens(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, ' ');
  }

  /**
   * 书名比对用的归一：全角转半角、转小写、去掉空白和标点。
   * 刻意**不去括号** —— 括号在上游就由 splitVol / stripParens 处理掉了，
   * 这里再削一道会把 `(前篇)` 这种本来属于书名的部分也削掉。
   */
  function normBookKey(s) {
    return toHalfWidth(s).toLowerCase()
      .replace(/[\s\u3000·・:：,，.。!！?？'"“”‘’\-—_~～\/\\|&＆+＋]/g, '');
  }

  /**
   * 拆出「书名主体」和「卷号」。
   * 卷号只认四种写法，其余一律当名字的一部分（宁可认不出，也不瞎猜）：
   *   · 尾部括注：(1)（1）【1】
   *   · 第N卷 / 第N巻 / 第N集 / vol.1 / volume 1
   *   · 空格 + 数字：`進撃の巨人 01`
   *   · 中日文名后面直接粘数字：`名侦探柯南1`、`灌篮高手31`
   * 注意 `三体Ⅱ`、`2046`、`SLAM DUNK` 都不会被当成卷号。
   */
  function splitVol(raw) {
    var s = str(raw);
    var vol = null;
    var m;
    if ((m = s.match(/[（(【\[]\s*(?:第)?\s*(\d{1,4})\s*(?:卷|巻|集|册)?\s*[）)】\]]\s*$/))) {
      vol = parseInt(m[1], 10);
      s = s.slice(0, m.index);
    } else if ((m = s.match(/(?:第|vol\.?|volume)\s*(\d{1,4})\s*(?:卷|巻|集|册)?\s*$/i))) {
      vol = parseInt(m[1], 10);
      s = s.slice(0, m.index);
    } else if ((m = s.match(/\s(\d{1,4})\s*(?:卷|巻|集|册)?\s*$/))) {
      // 必须有空白，否则会把「三体2」以外的纯数字书名（2046）也当成卷号
      vol = parseInt(m[1], 10);
      s = s.slice(0, m.index);
    } else if ((m = s.match(/^(.*?[\u4e00-\u9fff\u3040-\u30ff])\s*(\d{1,4})$/))) {
      vol = parseInt(m[2], 10);
      s = m[1];
    }
    return { base: stripParens(s).trim(), vol: vol };
  }

  /** 当前页是不是豆瓣书籍条目页（只有这种页面 URL 是空的） */
  function isDoubanBookPage(pageUrl) {
    return /^https?:\/\/book\.douban\.com\/subject\/\d+/i.test(str(pageUrl));
  }

  /** 别名是「甲, 乙, 丙」这种一串，拆成数组；太短的（单字）不要，容易误匹配 */
  function splitAliases(raw) {
    return str(raw).split(/[,，、;；\/|]/)
      .map(function (x) { return str(x); })
      .filter(function (x) { return x.length >= 2; });
  }

  var KANA_RE = /[\u3040-\u30ff]/;

  /** ISBN 只留数字和 X，长度必须是 10 或 13 才算有效 */
  function cleanIsbn(v) {
    var s = str(v).replace(/[^0-9Xx]/g, '').toUpperCase();
    return (s.length === 10 || s.length === 13) ? s : '';
  }

  /**
   * 组装书籍查询计划。
   *
   * keys = 比对用的归一书名（书名主体 / 原作名主体 / 各条别名的本体）。
   *        番组候选必须和其中**某一个完全相等**才收 —— 这是「宁空不错」的落点。
   * words = 搜番组用的词，顺序：原作名 → 含假名的别名 → 书名。
   *        都取**去掉卷号**的主体：搜「鬼滅の刃」才出主条目，搜「鬼滅の刃 1」全是分卷。
   *        用户 2026-10-26：日文书/日文别名的命中率很高，所以假名别名排在书名前面。
   */
  function buildBookPlan(data) {
    var title = str(data && data['书名']);
    var original = str(data && data['原作名']);
    var aliases = splitAliases(data && data['别名']);

    var tv = splitVol(title);
    var ov = splitVol(original);
    var aliasBases = aliases.map(function (a) { return splitVol(a).base; });

    var keys = [];
    var pushKey = function (v) {
      var k = normBookKey(v);
      if (k && k.length >= 2 && keys.indexOf(k) === -1) keys.push(k);
    };
    pushKey(tv.base);
    pushKey(ov.base);
    aliasBases.forEach(pushKey);

    var words = [];
    var pushWord = function (v) {
      var w = str(v);
      if (w && words.indexOf(w) === -1) words.push(w);
    };
    pushWord(ov.base);
    aliasBases.filter(function (a) { return KANA_RE.test(a); })
      .slice(0, 1).forEach(pushWord);
    pushWord(tv.base);

    return {
      title: title,
      titleBase: tv.base,
      original: original,
      originalBase: ov.base,
      // 豆瓣这一条是第几卷（只进调试信息；番组侧不按卷号挑，只认主条目）
      vol: tv.vol != null ? tv.vol : ov.vol,
      isbn: cleanIsbn(data && data['ISBN']),
      author: str(data && data['作者']),
      keys: keys,
      words: words.slice(0, BOOK_WORD_LIMIT)
    };
  }

  // ---------------- Goodreads：ISBN 直达 ----------------

  function goodreadsIsbnUrl(isbn) {
    var c = cleanIsbn(isbn);
    return c ? GOODREADS_ISBN + c : null;
  }

  /** 只要落地地址（urlOnly）：命中会 302 到 /book/show/<id>，没有就停在 /book/isbn/ */
  function goodreadsIsbnRequest(isbn) {
    var url = goodreadsIsbnUrl(isbn);
    return url ? { kind: 'grisbn', method: 'GET', urlOnly: true, url: url } : null;
  }

  /**
   * 判据只有一条：落地地址里出现 /book/show/<数字>。
   * 实测（2026-10-26）：不存在的 ISBN 停在 /book/isbn/…（404），这里自然匹配不到。
   * 返回统一去掉 slug 和查询参数，写成 `https://www.goodreads.com/book/show/<id>` ——
   * 这样同一条书不管落地 slug 是 `33550329` 还是 `33550329-the-little-prince`，值都一致。
   */
  function parseGoodreadsIsbn(finalUrl) {
    var m = str(finalUrl).match(/goodreads\.com\/book\/show\/(\d+)/i);
    if (!m) return null;
    return 'https://www.goodreads.com/book/show/' + m[1];
  }

  // ---------------- 番组计划：书籍主条目 ----------------

  function bgmBookSearchRequests(words) {
    var out = [];
    (words || []).slice(0, BOOK_WORD_LIMIT).forEach(function (w, i) {
      var s = str(w);
      if (!s) return;   // 空词不构造请求；索引仍与 words 对齐，调用方按 i 取结果
      out.push({
        kind: 'bgmb' + i,
        method: 'POST',
        url: BGM_BOOK_SEARCH,
        // type 1 = 书籍。影视那边是 [2,6]，两边不能混用。
        body: JSON.stringify({ keyword: s, filter: { type: [1] } })
      });
    });
    return out;
  }

  /** 从番组的 infobox 里取一项（值是数组时用「 / 」连起来，ISBN / 作者都是这形状） */
  function bgmInfobox(item, re) {
    var box = (item && Array.isArray(item.infobox)) ? item.infobox : [];
    for (var i = 0; i < box.length; i++) {
      if (!re.test(str(box[i] && box[i].key))) continue;
      var v = box[i].value;
      if (Array.isArray(v)) {
        return v.map(function (x) { return str(x && x.v); })
          .filter(function (x) { return !!x; }).join(' / ');
      }
      return str(v);
    }
    return '';
  }

  /**
   * 解析番组书籍搜索结果。
   *
   * 每个候选先拆成「主体 + 卷号」：
   *   · `鬼滅の刃 (1)` → 主体「鬼滅の刃」，卷号 1
   *   · `SLAM DUNK 完全版` → 主体「SLAM DUNK 完全版」，卷号 null
   * 注意「完全版 / 新装再編版」这类**不是卷号**，它们是各自独立的作品条目，
   * 靠名字完全相等来区分（`灌篮高手 完全版` ≠ `灌篮高手`），不要在这里硬拆。
   */
  function parseBgmBookSearch(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return null; }
    var list = data && data.data;
    if (!Array.isArray(list) || !list.length) return null;

    var out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || it.id === undefined || it.id === null) continue;
      var name = str(it.name);
      var cn = str(it.name_cn);
      var nv = splitVol(name);
      var cv = cn ? splitVol(cn) : { base: '', vol: null };
      out.push({
        id: String(it.id),
        name: name,
        cn: cn,
        date: str(it.date),
        // 原名和中文名任一带卷号，就算分卷（实测分卷条目 name 是「鬼滅の刃 (1)」、name_cn 常为空）
        vol: nv.vol != null ? nv.vol : cv.vol,
        nameKey: normBookKey(nv.base),
        cnKey: cv.base ? normBookKey(cv.base) : '',
        isbn: cleanIsbn(bgmInfobox(it, /ISBN/i))
      });
    }
    return out.length ? out : null;
  }

  /**
   * 从候选里挑出**番组主条目**。
   *
   * 用户规则（2026-10-26）：「番组要的就是主条目，不是主条目的不要」。
   * 所以带卷号的一律先丢掉，再比名字。别把这条改成「卷号对得上也算」——
   * URL 只有一个格，放分卷页会让这条记录看起来是第 1 卷，实际用户要的是作品页。
   *
   * 名字分两档，档位高的优先：
   *   tier 2 = **原名**对得上（`進撃の巨人` 对 `進撃の巨人`）—— 最可靠
   *   tier 1 = 只有 **name_cn** 对得上（`SLAM DUNK` 对 `灌篮高手`）
   * 为什么要分档：番组里有些条目 name_cn 被填成了通用名（`三体漫画 : 第一部` 的
   * name_cn 是「三体」），只比中文名会把漫画当成原作。档位让原名对上的一定赢。
   * ISBN 一致再加 3 分（番组主条目常常没有 ISBN，所以只当加分，不当门槛）。
   *
   * @returns {{url:string, id:string, name:string}|null}
   */
  function pickBgmBookMain(items, plan) {
    if (!Array.isArray(items) || !items.length) return null;
    var keys = (plan && plan.keys) || [];
    if (!keys.length) return null;
    var wantIsbn = cleanIsbn(plan && plan.isbn);

    var best = null;
    for (var i = 0; i < items.length; i++) {
      var c = items[i];
      if (!c) continue;
      if (c.vol != null) continue;                     // 只认主条目
      var tier = 0;
      if (c.nameKey && keys.indexOf(c.nameKey) !== -1) tier = 2;
      else if (c.cnKey && keys.indexOf(c.cnKey) !== -1) tier = 1;
      if (!tier) continue;
      var score = tier + (wantIsbn && c.isbn && c.isbn === wantIsbn ? 3 : 0);
      if (!best || score > best.score) best = { score: score, item: c };
    }
    if (!best) return null;
    return {
      url: 'https://bgm.tv/subject/' + best.item.id,
      id: best.item.id,
      name: best.item.name || best.item.cn || ''
    };
  }

  // ---------------- 请求组装（书籍，跟影视那套分开） ----------------

  /**
   * 书籍要发的请求，一次给齐（调用方并发发出去）。
   * 两个站各自独立：Goodreads 只要 1 条、番组 1~2 条，都在后台单次 6 条的上限内。
   */
  function bookRequests(plan) {
    var out = [];
    var g = goodreadsIsbnRequest(plan && plan.isbn);
    if (g) out.push(g);
    return out.concat(bgmBookSearchRequests((plan && plan.words) || []));
  }

  /**
   * 定胜负：**Goodreads 优先**（用户 2026-10-26 拍板）。
   *
   * 理由：Goodreads 那条是 ISBN 换来的，ISBN 是全球唯一编号 → 版本级证据，几乎不会认错；
   * 番组那条是名字匹配来的，作品级。URL 只有一个格，就放错不了的那个。
   * 两个都有时 alsoBgm=true，调用方据此在提示里补一句「番组计划也收录了这一部」。
   *
   * @returns {{url:string, source:'goodreads'|'bgm', alsoBgm:boolean}|null}
   */
  function pickBookUrl(goodreadsUrl, bgmUrl) {
    var g = str(goodreadsUrl);
    var b = str(bgmUrl);
    if (g) return { url: g, source: 'goodreads', alsoBgm: !!b };
    if (b) return { url: b, source: 'bgm', alsoBgm: false };
    return null;
  }

  var api = {
    TARGETS: TARGETS,
    siteOf: siteOf,
    pickCnName: pickCnName,
    buildPlan: buildPlan,
    pendingTargets: pendingTargets,
    imdbUrlOf: imdbUrlOf,
    tmdbPageOf: tmdbPageOf,
    imdbSuggestUrl: imdbSuggestUrl,
    parseImdbSuggest: parseImdbSuggest,
    rankImdbCandidates: rankImdbCandidates,
    imdbSuggestRequests: imdbSuggestRequests,
    imdbVerifyRequests: imdbVerifyRequests,
    imdbVerifyRounds: imdbVerifyRounds,
    imdbVerified: imdbVerified,
    pickVerifiedImdb: pickVerifiedImdb,
    buildRequests: buildRequests,
    normalizeName: normalizeName,
    nameScore: nameScore,
    parseDoubanSuggest: parseDoubanSuggest,
    parseBgmSearch: parseBgmSearch,
    parseTmdbSearch: parseTmdbSearch,
    parseRedirect: parseRedirect,
    parseResult: parseResult,
    // ---- 书籍「URL」补齐（v2.5.76）----
    isDoubanBookPage: isDoubanBookPage,
    splitVol: splitVol,
    normBookKey: normBookKey,
    buildBookPlan: buildBookPlan,
    cleanIsbn: cleanIsbn,
    goodreadsIsbnUrl: goodreadsIsbnUrl,
    goodreadsIsbnRequest: goodreadsIsbnRequest,
    parseGoodreadsIsbn: parseGoodreadsIsbn,
    bgmBookSearchRequests: bgmBookSearchRequests,
    parseBgmBookSearch: parseBgmBookSearch,
    pickBgmBookMain: pickBgmBookMain,
    pickBookUrl: pickBookUrl,
    bookRequests: bookRequests
  };

  if (typeof window !== 'undefined') {
    window.CrossSiteLinker = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
