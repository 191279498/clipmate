/**
 * 作者ID统一抓取器
 *
 * 由来
 * ----
 * 抖音 / 小红书 / 快手 三站的作者ID抓取骨架完全一致：
 *
 *   并发去重 → 查实例缓存 → 查全局缓存（CacheKeyManager）
 *   → fetch 作者主页 → 解析（各站正则不同）
 *   → 校验 → 写实例缓存 + 写全局缓存（persistent）
 *
 * 差异只在：缓存键前缀、正则列表、校验规则、请求头、
 * 快手多一步「隐藏 iframe 渲染」、快手失败要回退页面内内部ID。
 *
 * 因此这里只统一「骨架」，各站把自己的差异作为参数传进来。
 * 站点特有的解析逻辑（快手的 parseKwaiIdFromHtml 等）仍留在各提取器内。
 *
 * 用法
 * ----
 *   // 1) 并发去重
 *   return AuthorIdFetcher.dedupe(this._authorIdInflight, homeKey, () => this._extractAuthorIdImpl());
 *
 *   // 2) 完整流程
 *   const id = await AuthorIdFetcher.extract({
 *     site: 'douyin_social',
 *     homepage: authorHomepage,
 *     instanceCacheKey: 'douyin_authorId_' + authorHomepage,
 *     getCache: (k) => this.getCache(k),
 *     setCache: (k, v) => this.setCache(k, v),
 *     patterns: [{ pattern: /抖音号：([0-9a-zA-Z._]+)/g }],
 *     validate: (id) => /^[0-9a-zA-Z._]+$/.test(id) && id.length <= 30,
 *     log: { info, error }
 *   });
 */
(function (global) {
  'use strict';

  /** 三站共用的请求头（各站可覆盖） */
  const DEFAULT_FETCH_OPTIONS = {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': (typeof navigator !== 'undefined' && navigator.userAgent) || ''
    }
  };

  function noop() {}

  /**
   * 是否为正则对象
   * 不用 instanceof：内容脚本、iframe、不同 realm 之间 RegExp 构造器不是同一个，
   * instanceof 会误判为 false。这里用 Object.prototype.toString 判断，跨 realm 稳定。
   * @param {*} value
   * @returns {boolean}
   */
  function isRegExp(value) {
    return Object.prototype.toString.call(value) === '[object RegExp]';
  }

  /**
   * 是否为 Map（同样避免 instanceof 的跨 realm 问题）
   * @param {*} value
   * @returns {boolean}
   */
  function isMapLike(value) {
    return !!value
      && typeof value.get === 'function'
      && typeof value.set === 'function'
      && typeof value.delete === 'function';
  }

  /**
   * 归一化日志对象，缺省静默，避免调用方必须传
   * @param {Object} [log]
   * @returns {{info: Function, error: Function}}
   */
  function normalizeLog(log) {
    const src = log || {};
    return {
      info: typeof src.info === 'function' ? src.info : noop,
      error: typeof src.error === 'function' ? src.error : noop
    };
  }

  /**
   * 并发去重：同一个 key 的并发调用共享同一个 Promise，结束后自动清理
   * @param {Map} store - 存放进行中请求的 Map（通常是 this._authorIdInflight）
   * @param {string} key - 去重键（一般用作者主页）
   * @param {Function} factory - 真正执行的函数，返回 Promise
   * @param {Object} [log]
   * @returns {Promise<*>}
   */
  function dedupe(store, key, factory, log) {
    const logger = normalizeLog(log);
    const map = isMapLike(store) ? store : new Map();

    const existing = map.get(key);
    if (existing) {
      logger.info('复用进行中的作者ID请求，跳过重复抓取: ' + key);
      return existing;
    }

    const promise = Promise.resolve()
      .then(factory)
      .finally(() => {
        map.delete(key);
      });

    map.set(key, promise);
    return promise;
  }

  /**
   * 按顺序用正则列表解析作者ID，命中第一个符合校验的结果即返回
   * 每条正则在执行前重置 lastIndex，避免带 g 标志的正则在多次调用间残留状态
   * @param {string} html
   * @param {Array} patterns - 元素可以是正则，也可以是 { pattern, validate }
   * @returns {string}
   */
  function matchPatterns(html, patterns) {
    if (!html || !patterns) return '';

    for (const item of patterns) {
      const isPatternObject = !isRegExp(item) && item && item.pattern;
      const pattern = isPatternObject ? item.pattern : item;
      if (!pattern) continue;

      // 带 g / y 标志的正则必须重置，否则第二次调用会从上次位置继续
      if (pattern.global || pattern.sticky) pattern.lastIndex = 0;

      const match = pattern.exec(html);
      if (!match || !match[1]) continue;

      const value = match[1];
      const validate = isPatternObject ? item.validate : null;
      if (typeof validate === 'function' && !validate(value)) continue;

      return value;
    }

    return '';
  }

  /**
   * 读取缓存：先实例缓存，再全局缓存
   * @param {Object} opts
   * @returns {Promise<string>} 命中的作者ID，未命中返回 ''
   */
  async function readCache(opts) {
    const logger = normalizeLog(opts.log);

    // 1) 实例缓存（向后兼容，仅抖音历史上有）
    if (opts.instanceCacheKey && typeof opts.getCache === 'function') {
      try {
        const cached = opts.getCache(opts.instanceCacheKey);
        if (cached) {
          logger.info('实例缓存命中，作者ID: ' + cached);
          return cached;
        }
      } catch (error) {
        logger.error('读取实例缓存失败', error);
      }
    }

    // 2) 全局缓存管理器（跨页面持久缓存）
    if (global.cacheManager && global.CacheKeyManager) {
      try {
        const cached = await global.CacheKeyManager.readWithFallback(
          global.cacheManager, 'social', opts.site, 'author', opts.homepage
        );
        if (cached) {
          logger.info('全局缓存命中，作者ID: ' + cached);
          return cached;
        }
        logger.info('缓存未命中，需要抓取作者主页');
      } catch (error) {
        logger.error('读取全局缓存失败', error);
      }
    }

    return '';
  }

  /**
   * 写缓存：实例缓存 + 全局持久缓存
   * @param {Object} opts
   * @param {string} id
   */
  async function writeCache(opts, id) {
    const logger = normalizeLog(opts.log);

    if (opts.instanceCacheKey && typeof opts.setCache === 'function') {
      try {
        opts.setCache(opts.instanceCacheKey, id);
      } catch (error) {
        logger.error('写入实例缓存失败', error);
      }
    }

    if (global.cacheManager && global.CacheKeyManager) {
      try {
        await global.CacheKeyManager.writeWithLegacy(
          global.cacheManager, 'social', opts.site, 'author', opts.homepage, id,
          { persistent: true }
        );
        logger.info('作者ID已写入全局缓存: ' + id);
      } catch (error) {
        logger.error('写入全局缓存失败', error);
      }
    }
  }

  /**
   * 抓取作者主页 HTML
   * @param {Object} opts
   * @returns {Promise<string>} HTML，失败返回 ''
   */
  async function fetchHomepage(opts) {
    const logger = normalizeLog(opts.log);
    const baseOptions = opts.fetchOptions || DEFAULT_FETCH_OPTIONS;

    // v2.7.1：可选超时。
    // 老写法直接 fetch 不带任何时限 —— 一旦请求僵住（网关限流、连接半开），
    // 整个提取流程会一直挂着，用户看到的就是「点了按钮没反应」。
    // 只有调用方显式传 fetchTimeout 才启用，其它站行为保持原样。
    const timeoutMs = Number(opts.fetchTimeout) || 0;
    const canAbort = timeoutMs > 0
      && typeof AbortController !== 'undefined'
      && !baseOptions.signal;

    let timer = null;
    let controller = null;
    let fetchOptions = baseOptions;

    if (canAbort) {
      controller = new AbortController();
      fetchOptions = Object.assign({}, baseOptions, { signal: controller.signal });
      timer = setTimeout(function () {
        try { controller.abort(); } catch (error) { /* 忽略 */ }
      }, timeoutMs);
    }

    try {
      logger.info('获取作者主页: ' + opts.homepage);
      const response = await fetch(opts.homepage, fetchOptions);

      if (response && response.ok) {
        const html = await response.text();
        return typeof html === 'string' ? html : '';
      }

      logger.info('获取作者主页失败，状态码: ' + (response ? response.status : '无响应'));
      return '';
    } catch (error) {
      // 网络异常不抛出：与三站原有行为一致，交由后续解析与兜底处理
      if (error && error.name === 'AbortError') {
        logger.info('获取作者主页超时（' + timeoutMs + 'ms），放弃 HTML 路线');
      } else {
        logger.info('获取作者主页异常: ' + error);
      }
      return '';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * HTML 路线：抓主页 → 解析，不含渲染兜底
   * @param {Object} opts
   * @returns {Promise<string>} 未校验的候选值，失败为空串
   */
  async function resolveFromHtml(opts) {
    const logger = normalizeLog(opts.log);
    const html = await fetchHomepage(opts);
    if (!html) return '';

    if (typeof opts.parse === 'function') {
      try {
        return (await opts.parse(html, opts.homepage)) || '';
      } catch (error) {
        logger.error('解析作者主页失败', error);
        return '';
      }
    }
    if (opts.patterns) return matchPatterns(html, opts.patterns) || '';
    return '';
  }

  /**
   * 渲染路线：交给站点自己的 renderer（快手是隐藏 iframe）
   * @param {Object} opts
   * @returns {Promise<string>} 未校验的候选值，失败为空串
   */
  async function resolveByRenderer(opts) {
    const logger = normalizeLog(opts.log);
    try {
      return (await opts.renderer(opts.homepage)) || '';
    } catch (error) {
      logger.error('渲染读取作者ID失败', error);
      return '';
    }
  }

  /**
   * 两条路线同时开跑，**谁先交出一个通过校验的结果就用谁**
   *
   * v2.7.1 起因（快手）：串行是「HTML 抓完 → 解析（SPA 空壳必然失败）→ 再开 iframe 渲染
   * → 死等 10 秒」。等于白花一次主页访问，还要多等一整个渲染周期。
   * 并行之后，HTML 若侥幸命中（几百毫秒）立刻收工；HTML 落空也不拖累 iframe ——
   * iframe 从第一毫秒就在跑，用户感知的等待只剩 iframe 真正需要的渲染时间。
   *
   * v2.7.10 补充 `rendererDelay`（快手传 800ms）：
   * 实测 HTML 这条路已经能 401ms 拿到快手号（字段名修正为 `userDefineId`），
   * 那种情况下再开 iframe 等于**白发一次主页请求** —— 快手对主页请求最敏感，
   * 请求数从 2 降到 1 是实打实的降风控。所以：
   *   - 延时到点前 HTML 就赢了 → iframe **从不启动**，只剩 1 次请求；
   *   - 延时到点 HTML 还没回来 → iframe 照常并行开跑（抖了也不至于退回 5 秒）；
   *   - HTML 明确落空（含解析失败/校验不过）→ **不再等延时**，立刻开 iframe。
   * 不传 `rendererDelay`（抖音/小红书等）时 delay=0，行为与 v2.7.1 逐项一致。
   *
   * 注意：这里**不取消**已经开跑的那一路（fetch 与 iframe 都无法安全中断），
   * 它自己会跑完并清理（iframe 到点自删）。落后一路的结果一律丢弃。
   *
   * @param {Object} opts
   * @returns {Promise<string>} 通过校验的作者ID，都失败返回空串
   */
  function raceIdSources(opts) {
    const logger = normalizeLog(opts.log);

    return new Promise((resolve) => {
      let settled = false;
      let htmlDone = false;
      let rendererStarted = false;
      let rendererDone = false;
      let timer = null;

      const cancelTimer = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      // 两路都落空才收工。
      // `htmlDone` 这道门必须有：iframe 有可能**先失败**（同步返回空 / 立刻抛错），
      // 那时 HTML 还在飞，少了这道门就会提前 resolve('')，把迟到的真值丢掉。
      const finishIfDone = () => {
        if (settled) return;
        if (htmlDone && rendererStarted && rendererDone) {
          settled = true;
          resolve('');
        }
      };

      /** @returns {boolean} true = 已拿到合法值并定案 */
      const settle = (raw, from) => {
        if (settled) return true;

        let value = raw || '';
        if (value && typeof opts.validate === 'function' && !opts.validate(value)) {
          logger.info('[' + from + '] 结果未通过格式校验，已丢弃: ' + value);
          value = '';
        }

        if (value) {
          settled = true;
          cancelTimer();
          logger.info('作者ID命中来源: ' + from);
          resolve(value);
          return true;
        }
        return false;
      };

      const startRenderer = () => {
        if (rendererStarted || settled) return;
        rendererStarted = true;
        // 迟到的失败也不能把已定案的结果改掉
        resolveByRenderer(opts).then(
          (value) => { settle(value, 'iframe'); rendererDone = true; finishIfDone(); },
          () => { rendererDone = true; finishIfDone(); }
        );
      };

      resolveFromHtml(opts).then(
        (value) => {
          htmlDone = true;
          if (settle(value, 'html')) return;
          // HTML 落空（没解析到 / 没通过校验）：不用再等延时，立刻开渲染兜底
          cancelTimer();
          startRenderer();
          // iframe 若早已跑完（delay=0 且它先失败），这时才能定案
          finishIfDone();
        },
        () => {
          htmlDone = true;
          cancelTimer();
          startRenderer();
          finishIfDone();
        }
      );

      const delay = Math.max(0, Number(opts.rendererDelay) || 0);
      if (delay > 0) {
        // v2.7.10：延时期间 HTML 赢了就 cancelTimer()，iframe 永不启动
        timer = setTimeout(() => { timer = null; startRenderer(); }, delay);
      } else {
        startRenderer();
      }
    });
  }

  /**
   * 完整流程：缓存 → fetch → 解析 → 渲染兜底 → 校验 → 写缓存 → 失败兜底
   * @param {Object} options
   * @param {string} options.site - 站点标识（CacheKeyManager 用）
   * @param {string} options.homepage - 作者主页
   * @param {Function} [options.parse] - (html, homepage) => id，自定义解析（快手）
   * @param {Array} [options.patterns] - 正则列表（抖音 / 小红书）
   * @param {Function} [options.validate] - 结果校验
   * @param {Function} [options.renderer] - 解析失败时的渲染兜底（快手 iframe）
   * @param {boolean} [options.parallelRenderer] - HTML 与渲染并行（快手专线）
   * @param {number} [options.rendererDelay] - 并行时渲染延后多少毫秒启动；期间 HTML 命中则渲染永不启动（v2.7.10 快手 800ms）
   * @param {Function} [options.onMiss] - 全部失败时的兜底（快手回退内部ID）
   * @param {Function} [options.onNoHomepage] - 没有主页时的处理
   * @param {string} [options.instanceCacheKey]
   * @param {Function} [options.getCache]
   * @param {Function} [options.setCache]
   * @param {Object} [options.fetchOptions]
   * @param {Object} [options.log]
   * @returns {Promise<string>} 作者ID，取不到返回 ''（或 onMiss 的结果）
   */
  async function extract(options) {
    const opts = options || {};
    const logger = normalizeLog(opts.log);

    if (!opts.homepage) {
      logger.info('未获取到作者主页，无法抓取作者ID');
      if (typeof opts.onNoHomepage === 'function') return await opts.onNoHomepage();
      return '';
    }

    // 1) 缓存
    const cached = await readCache(opts);
    if (cached) return cached;

    // 2) 抓取 + 解析
    let id = '';

    if (opts.parallelRenderer && typeof opts.renderer === 'function') {
      // v2.7.1 快手专线：HTML 快枪与 iframe 渲染同时开跑，谁先给出合法结果就用谁
      logger.info('HTML 与 iframe 渲染并行抓取作者ID');
      id = await raceIdSources(opts);
    } else {
      id = await resolveFromHtml(opts);

      // 3) 渲染兜底（快手：快手号由前端渲染，静态 HTML 里没有）
      if (!id && typeof opts.renderer === 'function') {
        logger.info('静态内容中没有作者ID，改用渲染方式读取');
        id = await resolveByRenderer(opts);
      }
    }

    // 4) 校验
    if (id && typeof opts.validate === 'function' && !opts.validate(id)) {
      logger.info('提取结果未通过格式校验，已丢弃: ' + id);
      id = '';
    }

    // 5) 写缓存
    if (id) {
      await writeCache(opts, id);
      return id;
    }

    // 6) 兜底
    logger.info('未能提取到作者ID');
    if (typeof opts.onMiss === 'function') return await opts.onMiss();
    return '';
  }

  const api = {
    DEFAULT_FETCH_OPTIONS,
    dedupe,
    matchPatterns,
    readCache,
    writeCache,
    fetchHomepage,
    resolveFromHtml,
    resolveByRenderer,
    raceIdSources,
    extract
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.AuthorIdFetcher = api;
  }
})(typeof window !== 'undefined' ? window : null);
