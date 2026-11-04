/**
 * 豆瓣收藏列表页 → 条目详情页抓取（v2.11.4）
 *
 * 【解决什么】
 *   豆瓣「想看 / 在看 / 看过」列表页上，用户只想看某一条的完整字段，
 *   不想点进详情页、再点提取、再退回来。这里负责「把详情页拿回来」，
 *   按钮组件只关心「要哪一条、结果交给谁」。
 *
 * 【为什么是 fetch，不是隐藏 iframe】
 *   2026-11-04 真机实测（movie.douban.com/subject/10441174）：
 *     · fetch + DOMParser：状态 200、约 1.0 秒、95KB，评分 / 简介 / 演员 / #info 全在，无验证码
 *     · 隐藏 iframe        ：同样成功，但要 3.5 秒（要走完整渲染），慢 3 倍多，
 *                            还会在页面上留一块 1200×900 的渲染负担
 *   所以选 fetch。
 *
 * 【三条硬约束（不是可选项）】
 *   ① 同一时刻只允许一个请求在飞。连点、手快滚屏点，后来的直接拒绝，
 *      由按钮自己显示「上一个还没完」。豆瓣对连续详情页请求非常敏感。
 *   ② 熔断：一旦回 403 / 418 / 验证码页 / 被踢到登录页，立刻置 blocked，
 *      之后**不再发任何请求**，直到页面刷新或用户手动重试。**绝不自动重试** ——
 *      这条是用户 2026-11-03 定的风控铁律：遇到验证码立刻停手。
 *   ③ 结果按 subject 编号缓存（页面内存级）。同一条点第二次直接返回，
 *      不重复打豆瓣；缓存随页面刷新自然失效，不落盘、不进 chrome.storage。
 */
(function (global) {
  'use strict';

  // 协议可省：列表页里偶尔出现 `//movie.douban.com/subject/xxx` 这种写法。
  // v2.11.5：三类详情页 —— 影视/读书走 /subject/<id>，游戏走 /game/<id>。
  var SUBJECT_RE = /^(?:https?:)?\/\/([^/]+)\/(subject|game)\/(\d+)/i;
  var RELATIVE_RE = /^\/(subject|game)\/(\d+)/i;
  var FETCH_TIMEOUT = 15000;   // 单次请求上限，超时按「失败」处理，不重试

  /** 把条目地址拆成 {host, seg, id}；带域名和纯相对路径都认 */
  function parseSubject(url) {
    var raw = String(url || '');
    var m = SUBJECT_RE.exec(raw);
    if (m) return { host: m[1].toLowerCase(), seg: m[2].toLowerCase(), id: m[3] };
    m = RELATIVE_RE.exec(raw);
    if (m) return { host: '', seg: m[1].toLowerCase(), id: m[2] };
    return null;
  }

  function pageHost() {
    try { return String(location.hostname || '').toLowerCase(); }
    catch (e) { return 'movie.douban.com'; }
  }

  // 豆瓣风控页的特征。命中任意一条就熔断，不再发请求。
  // 都是真机上见过的形态：验证码跳转域、异常提示文案、登录页重定向。
  var BLOCK_PATTERNS = [
    { re: /sec\.douban\.com/i, label: '验证码' },
    { re: /accounts\.douban\.com\/passport\/login/i, label: '要登录' },
    { re: /检测到有异常请求/i, label: '异常请求' },
    { re: /请输入验证码/i, label: '验证码' },
    { re: /captcha/i, label: '验证码' },
    { re: /禁止访问/i, label: '禁止访问' }
  ];

  function log() {
    try {
      if (global.ClipMateLog && global.ClipMateLog.debug) {
        global.ClipMateLog.debug.apply(global.ClipMateLog, ['[DoubanListFetch]'].concat([].slice.call(arguments)));
      }
    } catch (e) { /* 日志失败不影响功能 */ }
  }

  var DoubanListFetch = {
    _busy: false,
    _blocked: '',
    _cache: null,
    // 缓存几份解析好的文档。用户是「偶尔点几条」，8 份够覆盖「点错了再点一次」
    // 「来回对比两条」这些场景；再多就是白占内存（一份详情页 DOM 约 1MB）。
    _cacheLimit: 8,

    /** 从条目地址里取 subject 编号；不是条目页返回空串 */
    subjectIdOf: function (url) {
      var p = parseSubject(url);
      return p ? p.id : '';
    },

    /**
     * v2.11.5：缓存键必须带站点。
     * 读书 / 影视的 subject 编号都是纯数字，同一编号在两站可能各指一样东西；
     * 只按数字缓存会「在读书页点到影视的缓存」。列表页几十条地址又完全相同，
     * 所以这个键同时承担了 tab 缓存（activeShortcode）的去重职责。
     */
    cacheKeyOf: function (url) {
      var p = parseSubject(url);
      if (!p) return '';
      return (p.host || pageHost()) + '/p/' + p.id;
    },

    /** 归一化成可请求的条目地址（按原站点拼回，去掉查询串与尾部斜杠） */
    normalize: function (url) {
      var p = parseSubject(url);
      if (!p) return '';
      var host = p.host || pageHost();
      return 'https://' + host + '/' + p.seg + '/' + p.id + '/';
    },

    isBusy: function () { return this._busy === true; },
    isBlocked: function () { return this._blocked !== ''; },
    blockedReason: function () { return this._blocked; },

    /** 用户手动重试（或换了页面）：解除熔断 */
    clearBlock: function () {
      if (this._blocked) log('解除熔断：', this._blocked);
      this._blocked = '';
    },

    /** 命中内存缓存就直接给（不再请求豆瓣） */
    cached: function (id) {
      if (!id || !this._cache) return null;
      return this._cache.get(id) || null;
    },

    remember: function (id, data) {
      if (!id || !data) return;
      if (!this._cache) this._cache = new Map();
      this._cache.set(id, data);
      // 简单的 FIFO 上限，防止长列表刷几百条把内存撑起来
      while (this._cache.size > this._cacheLimit) {
        var first = this._cache.keys().next();
        if (first.done) break;
        this._cache.delete(first.value);
      }
    },

    /** 只看缓存，不发请求（按钮判断要不要闪「已缓存」用） */
    sizeOf: function () { return this._cache ? this._cache.size : 0; },

    /**
     * 抓一个条目详情页，返回解析好的 Document。
     *
     * @param {string} url 条目地址（任何带 /subject/<id> 的形态都行）
     * @returns {Promise<{ok:boolean, doc?:Document, url?:string, id?:string, reason?:string}>}
     *          失败时 reason 是**给人看的中文原因**，按钮直接显示，不再二次翻译。
     */
    async load(url) {
      var id = this.subjectIdOf(url);
      if (!id) return { ok: false, reason: '这个条目没有可访问的详情页' };
      var key = this.cacheKeyOf(url);
      if (this._blocked) return { ok: false, id: id, key: key, reason: this._blocked };

      // 命中内存缓存就直接给，不再打豆瓣（用户明确要求「同一部点第二次不该再请求」）
      var cachedDoc = this.cached(key);
      if (cachedDoc) {
        log('缓存命中', key);
        return { ok: true, doc: cachedDoc, url: this.normalize(url), id: id, key: key, cached: true };
      }

      if (this._busy) return { ok: false, id: id, key: key, reason: '上一个还在抓，稍等一下' };

      var target = this.normalize(url);
      this._busy = true;
      var timer = null;
      var ctrl = null;
      try {
        var init = { credentials: 'include', headers: { Accept: 'text/html' } };
        if (typeof AbortController === 'function') {
          ctrl = new AbortController();
          init.signal = ctrl.signal;
        }

        var timeout = new Promise(function (_, reject) {
          timer = setTimeout(function () {
            if (ctrl) { try { ctrl.abort(); } catch (e) { /* 已中止 */ } }
            reject(new Error('timeout'));
          }, FETCH_TIMEOUT);
        });

        var resp = await Promise.race([fetch(target, init), timeout]);
        var html = await resp.text();

        // ① HTTP 层：403 / 418 是豆瓣最常用的两种「你别来了」
        if (resp.status === 403 || resp.status === 418) {
          this._block('豆瓣拒绝了请求（HTTP ' + resp.status + '）');
          return { ok: false, id: id, reason: this._blocked };
        }
        if (!resp.ok) {
          return { ok: false, id: id, reason: '豆瓣返回 HTTP ' + resp.status };
        }

        // ② 内容层：200 也可能是验证码页 / 登录页
        var hit = this._blockHit(html);
        if (hit) {
          this._block('豆瓣要验证了（' + hit + '）');
          return { ok: false, id: id, reason: this._blocked };
        }

        // ③ 解析。DOMParser 出来的文档没有 location / URL，
        //    所以提取器那边统一走 setSource(doc, url) 把地址喂进去。
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var title = (doc.title || '').trim();

        // ④ 条目下架 / 页面结构变了：主标题和主要信息区都读不到，就别把空表端给用户。
        //    三类详情页的信息区不同：影视/读书是 #info，游戏页是 #content 里的评分与属性。
        if (!doc.querySelector('h1') && !doc.querySelector('#info') && !doc.querySelector('#content')) {
          return {
            ok: false, id: id,
            reason: title ? ('这个条目打不开（' + title.slice(0, 12) + '）') : '这个条目打不开'
          };
        }

        log('抓到', target, 'html', html.length, 'bytes');
        // 只缓存「确认可用」的文档：失败/风控页一律不进缓存，否则下次点会拿到坏数据
        this.remember(key, doc);
        return { ok: true, doc: doc, url: target, id: id, key: key };
      } catch (e) {
        var msg = (e && e.message) || '';
        if (msg === 'timeout') return { ok: false, id: id, reason: '等了 ' + (FETCH_TIMEOUT / 1000) + ' 秒没返回' };
        return { ok: false, id: id, reason: '网络请求失败' };
      } finally {
        if (timer) clearTimeout(timer);
        this._busy = false;
      }
    },

    /** 命中风控特征就返回特征名（用于提示），否则返回空串 */
    _blockHit: function (html) {
      var text = String(html || '');
      for (var i = 0; i < BLOCK_PATTERNS.length; i++) {
        if (BLOCK_PATTERNS[i].re.test(text)) return BLOCK_PATTERNS[i].label;
      }
      // 内容短得离谱 = 不是正常的详情页（正常页 90KB 上下）
      if (text.length < 2000) return '页面内容为空';
      return '';
    },

    _block: function (reason) {
      this._blocked = reason;
      log('熔断：', reason, '（之后不再发请求，直到页面刷新或手动重试）');
    }
  };

  if (global) global.DoubanListFetch = DoubanListFetch;
  if (typeof module !== 'undefined' && module.exports) module.exports = DoubanListFetch;
})(typeof window !== 'undefined' ? window : null);
