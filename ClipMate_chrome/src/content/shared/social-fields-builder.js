/**
 * 社交媒体字段统一装配器
 *
 * 设计目标
 * --------
 * 1. 字段外壳（字段名称、字段数量、字段顺序）只在一处定义：SOCIAL_FIELDS
 *    （src/shared/config/media-types.js）。所有社交媒体提取器不再各自手写字段对象。
 * 2. 字段取值（每个网站怎么从自己的 DOM / 接口里取到值）仍然由各提取器独立实现，
 *    新增站点时只需要提供取值方法，字段模板自动套用。
 * 3. 统一行为：
 *    - 所有取值方法一律 await（同步方法返回值也安全），避免忘记 await 时写入 Promise 对象；
 *    - 单个字段取值失败只置空该字段，不会让整个对象丢失；
 *    - 兜底对象恒为完整字段模板（不会出现 return {} 导致字段全缺）；
 *    - 固定附带 mediaType / sourceSite。
 *
 * 用法
 * ----
 *   const fields = await SocialFieldsBuilder.build(this);
 *   // 需要覆盖个别字段时（例如 Instagram 带 context 取值、小红书有预计算值）：
 *   const fields = await SocialFieldsBuilder.build(this, {
 *     overrides: { 'URL': finalUrl, '本页文案': contentText }
 *   });
 */
(function (global) {
  'use strict';

  /**
   * 内置兜底字段模板
   * 仅在 mediaTypesConfig 不可用时使用，键名与顺序必须与
   * src/shared/config/media-types.js 中的 SOCIAL_FIELDS 保持一致。
   */
  const FALLBACK_FIELD_KEYS = [
    '本页标题',
    '作者ID',
    '作者昵称',
    '作者主页',
    '发布日期',
    '本页文案',
    'URL'
  ];

  /**
   * 字段 → 取值方法候选名
   * 按数组顺序找到第一个存在于提取器实例上的方法并调用，历史上各站方法名不完全统一
   * （作者ID 有 extractAuthorId / extractAuthorID 两种写法，本页文案有三种写法），
   * 这里集中登记，新增站点只要沿用任意一种命名即可被自动识别。
   */
  const FIELD_METHOD_CANDIDATES = {
    '本页标题': ['extractTitle'],
    '作者ID': ['extractAuthorId', 'extractAuthorID'],
    '作者昵称': ['extractAuthorName'],
    '作者主页': ['extractAuthorHomepage'],
    '发布日期': ['extractPublishDate'],
    '本页文案': ['extractPageText', 'extractContent', 'extractDescription'],
    'URL': ['extractUrl']
  };

  // 字段模板缓存（配置在 content script 加载后即固定）
  let cachedFieldKeys = null;

  /**
   * 读取权威字段模板的键与顺序
   * @returns {string[]} 字段名数组（已复制，调用方可随意修改）
   */
  function getFieldKeys() {
    if (cachedFieldKeys) return cachedFieldKeys.slice();

    let keys = null;
    try {
      const config = global && global.mediaTypesConfig;
      if (config && config.SOCIAL_FIELDS && typeof config.SOCIAL_FIELDS === 'object') {
        keys = Object.keys(config.SOCIAL_FIELDS);
      }
    } catch (error) {
      // 配置不可用时静默回退，不打断提取
      keys = null;
    }

    if (!keys || keys.length === 0) {
      keys = FALLBACK_FIELD_KEYS.slice();
    }

    cachedFieldKeys = keys;
    return keys.slice();
  }

  /**
   * 取当前页面地址（用于 URL 字段兜底）
   * @returns {string}
   */
  function getCurrentUrl() {
    try {
      return (global && global.location && global.location.href) || '';
    } catch (error) {
      return '';
    }
  }

  /**
   * v2.5.91：URL 字段规范化
   *
   * 抖音 / 快手 / 小红书 / 微博 / B站 / YouTube / TikTok / Instagram 的地址栏里
   * 常带来源标记与会过期的 token（快手 `?authorId=`、小红书 `?xsec_token=`、
   * IG `?igsh=`、B站 `?spm_id_from=`）。这些不是作品的一部分，存下来还会失效。
   *
   * 规则集中在 `url-normalizer.js`；这里只做「有就用，没有就原样返回」，
   * 保证在没加载到该脚本的环境里（部分单测直接 require 这个文件）不会报错。
   *
   * @param {string} url
   * @returns {string}
   */
  function normalizeUrl(url) {
    if (!url) return url || '';
    try {
      if (global && global.UrlNormalizer && typeof global.UrlNormalizer.normalize === 'function') {
        return global.UrlNormalizer.normalize(url);
      }
    } catch (error) {
      // 规范化失败不该影响字段输出，原样返回
    }
    return url;
  }

  /**
   * 兜底标记的键名（v2.5.98）
   *
   * 打了这个标记，说明「本页文案」是自己填上去的站名（`TikTok视频` 这类），
   * **不是真的从页面抓到的内容**。
   *
   * 为什么需要它：抖音弹窗和快手沉浸流都有「连续 5 次 文案/昵称/日期 全空 → 熔断」的保护。
   * 兜底一上，文案栏永远非空，熔断就永远不触发 —— 页面明明挂了还在那儿假装成功。
   * 所以标记必须能让熔断逻辑看见，又不许污染数据本身。
   *
   * 用**不可枚举**属性：`JSON.stringify` / `Object.keys` / `for...in` / 展开运算符
   * 全都看不见它，复制出去、存进表格、渲染浮窗都不受影响。
   */
  const TEXT_FALLBACK_FLAG = '__textFallback';

  /**
   * 「本页文案」是否算空（v2.5.98）
   *
   * 三种都算空：`null` / `undefined` / 全是空白字符（有的站点给 `'   '`）。
   * 只有 `0` 这类值不算 —— 虽然现实里不会出现，但别把「有值」误判成空。
   * @param {*} value
   * @returns {boolean}
   */
  function isBlankText(value) {
    if (value === null || value === undefined) return true;
    return String(value).trim() === '';
  }

  /**
   * 这段文案会不会被标题的过滤规则洗得一个字都不剩（v2.7.38）
   *
   * 装配器自己**不实现**任何过滤规则 —— 它只问标题处理器要答案，
   * 规则永远只有 `social-title-processor.js` 里那一份。
   *
   * 降级口径：拿不到处理器（脚本没加载 / 老环境）→ 一律按「不空」处理，
   * 保持 v2.7.37 及以前的既有行为。宁可少兜一次，也不能因为一个美化字段乱改标题。
   *
   * @param {*} text
   * @returns {boolean} true = 洗完一个字都不剩（纯 emoji / 纯标点 / 纯日韩俄泰文）
   */
  function isTextBlankAfterTitleFilter(text) {
    try {
      const P = global && global.SocialTitleProcessor;
      if (P && typeof P.isBlankAfterTitleFilter === 'function') {
        return P.isBlankAfterTitleFilter(text);
      }
    } catch (error) { /* 判定器坏了不能影响主流程 */ }
    return false;
  }

  /**
   * 「本页文案」为空时的兜底值（v2.5.98）
   *
   * 规矩来自用户（2026-10-29）：文案抓不到就填「站名 + 形态」，例如 `TikTok视频`、
   * `TikTok图文`、`小红书笔记`。词表在 `social-site-names.js`，这里只负责两件事：
   *   1. 问提取器要形态（可选方法 `getContentShape()`，可以返回 Promise）；
   *   2. 拿不到形态就交给词表的默认档（video）。
   *
   * 三条纪律：
   *   · 词表没这个站点 → 返回空串，**绝不硬凑**（宁可留空也不写错站名）；
   *   · 提取器没实现 `getContentShape()` → 走默认档，不算错；
   *   · 取形态抛错 → 吞掉走默认档，不能因为一个美化字段把整份数据搞挂。
   *
   * @param {Object} extractor - 提取器实例
   * @param {string} site - sourceSite
   * @returns {Promise<string>} 例如 `TikTok视频`；兜不出返回空串
   */
  async function resolveEmptyTextFallback(extractor, site) {
    const names = (global && global.SocialSiteNames) ? global.SocialSiteNames : null;
    if (!names || typeof names.labelFor !== 'function') return '';

    let shape = '';
    if (extractor && typeof extractor.getContentShape === 'function') {
      try {
        shape = await extractor.getContentShape();
      } catch (error) {
        shape = '';
      }
    }
    if (typeof shape !== 'string') shape = '';
    return names.labelFor(site, shape) || '';
  }

  /**
   * 空值归一：只把 null / undefined 变成空串，其余类型原样返回，避免改变既有输出
   * @param {*} value
   * @returns {*}
   */
  function normalizeValue(value) {
    return value === null || value === undefined ? '' : value;
  }

  /**
   * 解析字段覆盖值，支持函数与 Promise
   * @param {*} overrideValue
   * @returns {Promise<*>}
   */
  async function resolveOverride(overrideValue) {
    const value = typeof overrideValue === 'function' ? overrideValue() : overrideValue;
    return await value;
  }

  /**
   * 按字段取一个值：优先用 overrides，其次按候选方法名找取值方法
   * @param {Object} extractor - 提取器实例
   * @param {string} key - 字段名
   * @param {Object} overrides - 字段覆盖表
   * @returns {Promise<*>}
   */
  async function resolveField(extractor, key, overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, key)) {
      return await resolveOverride(overrides[key]);
    }

    const candidates = FIELD_METHOD_CANDIDATES[key] || [];
    for (const methodName of candidates) {
      if (extractor && typeof extractor[methodName] === 'function') {
        return await extractor[methodName]();
      }
    }

    // 模板新增了字段但还没有约定取法时，保持空串
    return '';
  }

  /**
   * 创建符合模板的空字段对象（字段齐全、顺序固定、附带 mediaType / sourceSite）
   * @param {Object} [extractor] - 提取器实例，用于取 siteName
   * @param {Object} [options]
   * @param {string} [options.mediaType='social'] - 媒体类型
   * @param {string} [options.sourceSite] - 站点标识，缺省取 extractor.siteName
   * @returns {Object}
   */
  function createEmptyRecord(extractor, options) {
    const opts = options || {};
    const record = {};

    for (const key of getFieldKeys()) {
      record[key] = '';
    }

    record.mediaType = opts.mediaType || 'social';
    record.sourceSite = opts.sourceSite || (extractor && extractor.siteName) || 'unknown';

    return record;
  }

  /**
   * 用指定文案重新生成一次「本页标题」（v2.7.2）
   *
   * 为什么不让调用方拼字符串：各站的 `extractTitle()` 带着自己的 platform / 字数 /
   * 日期格式（抖音就是 `maxTextLength: 10`），通用拼法会把这些站别处理全丢掉。
   * 所以这里临时把「本页文案」的取值方法换成兜底词，再让提取器自己生成一次。
   *
   * 用完必须**原值写回**：不能用 `delete` —— 有的提取器把方法挂在实例自有属性上
   * （mixin 直接赋值那种），`delete` 会把方法整个删掉，提取器当场残废（实测踩到）。
   *
   * @param {Object} extractor
   * @param {string} fallbackText - 兜底文案（抖音视频 / TikTok图文 …）
   * @param {Object} overrides
   * @returns {Promise<string>} 生成失败返回空串，由调用方决定要不要动原标题
   */
  async function rebuildTitleWith(extractor, fallbackText, overrides) {
    if (!extractor) return '';
    const methods = FIELD_METHOD_CANDIDATES['本页文案'] || [];
    const patched = [];
    for (const name of methods) {
      if (typeof extractor[name] === 'function') {
        // v2.7.9：**必须返回字符串本身，不能包成 Promise**。
        //
        // 这里替换的是「取文案」的方法，随后立刻重跑一次 extractTitle()。两种站写法不同：
        //   · async 站（抖音/小红书/快手/微博/B站）：`await this.extractPageText()` → 字符串
        //   · 同步站（IG/TikTok/X/YouTube）：`const t = this.extractPageText()` → 直接拿来用
        // 旧写法返回 Promise，同步站拿到 Promise 后 `text.trim()` 抛 TypeError，被各站
        // extractTitle 的 try/catch 吞掉返回空串 → 重建结果为空 → 不覆盖 → 标题保留「无文案」。
        // 返回裸字符串时：await 一个字符串原样返回，同步调用直接就是字符串，两种写法都成立。
        patched.push([name, extractor[name]]);
        extractor[name] = () => fallbackText;
      }
    }

    // v2.7.38：**再包一层 extractTitle，把第一个参数（文案）换成兜底词。**
    //
    // 为什么光替换「取文案方法」不够：Instagram 的标题不是自己去取文案，而是外面把
    // `contentText` / `caption` 算好、通过 overrides 塞进 `extractTitle(pageText, context)`。
    // 上面那套方法替换对它**完全无效**，于是它的空文案标题一直写着「无文案」——
    // 真机 v2.7.37 实测：`一支花无文案-2026年10月31日`，而同一份数据里「本页文案」
    // 早就是「Instagram帖子」了，一半新一半旧。
    //
    // 各站签名核对过（2026-11-01）：除 IG 外，其余 9 站的 `extractTitle()` 都**不吃参数**，
    // 包了也只是塞一个它们会忽略的第一参数，行为一个字不变；IG 则正好吃在这上面。
    let origTitle = null;
    if (typeof extractor.extractTitle === 'function') {
      origTitle = extractor.extractTitle;
      extractor.extractTitle = function () {
        const args = Array.prototype.slice.call(arguments);
        return origTitle.apply(this, [fallbackText].concat(args.slice(1)));
      };
    }

    try {
      return normalizeValue(await resolveField(extractor, '本页标题', overrides));
    } catch (error) {
      return '';
    } finally {
      patched.forEach((pair) => {
        try { extractor[pair[0]] = pair[1]; } catch (e) { /* 复原失败不掩盖主结果 */ }
      });
      if (origTitle) {
        try { extractor.extractTitle = origTitle; } catch (e) { /* 同一套复原纪律 */ }
      }
    }
  }

  /**
   * 按模板装配整份字段对象
   * @param {Object} extractor - 提取器实例
   * @param {Object} [options]
   * @param {Object} [options.overrides] - 指定字段的取值覆盖（值或函数或 Promise）
   * @param {string} [options.mediaType='social']
   * @param {string} [options.sourceSite]
   * @returns {Promise<Object>} 完整字段对象
   */
  async function build(extractor, options) {
    const opts = options || {};
    const overrides = opts.overrides || {};
    const record = createEmptyRecord(extractor, opts);

    for (const key of getFieldKeys()) {
      try {
        record[key] = normalizeValue(await resolveField(extractor, key, overrides));
      } catch (error) {
        record[key] = '';
        console.error('[SocialFieldsBuilder] 字段「' + key + '」提取失败，已置空:', error);
      }
    }

    // URL 为空时兜底为当前页面地址（与各提取器既有行为一致）
    if (!record['URL']) {
      record['URL'] = getCurrentUrl();
    }

    // v2.5.91：URL 统一过一遍规范化（把地址栏里的临时参数去掉，还原成作品自己的地址）。
    // 认不出的站原样返回，所以这里只对「规则表里有的站」生效；幂等，跑两次结果一样。
    record['URL'] = normalizeUrl(record['URL']);

    // v2.5.98：社交类「本页文案」为空 → 填「站名 + 形态」（TikTok视频 / TikTok图文 / 小红书笔记）。
    // 放在最后一步：各提取器自己的取法一个都不改，只在「确实空」时补一个可读的值。
    // 书 / 影 / 游的「简介」不走这里 —— 用户明确只做社交类。
    //
    // v2.7.38：触发条件从「文案为空」扩成**两种**（用户 2026-11-01 拍板）：
    //   ① 文案为空 → 本页文案填站名（老规矩，不变）；
    //   ② 文案不空、但按标题过滤规则洗完之后**一个字都不剩**（纯 emoji / 纯标点 /
    //      纯日韩俄泰文）→ **本页文案保留原文**，只让标题用站名顶上。
    //      原因：`🎃🎃🎃` 是真抓到的内容，抹掉就丢了；但标题拼出来会只剩「昵称-日期」，
    //      中间空一截，那才是用户看到的问题。
    if (Object.prototype.hasOwnProperty.call(record, '本页文案')) {
      const rawText = record['本页文案'];
      const textIsBlank = isBlankText(rawText);
      const textBlankForTitle = !textIsBlank && isTextBlankAfterTitleFilter(rawText);

      if (textIsBlank || textBlankForTitle) {
        const fallbackText = await resolveEmptyTextFallback(extractor, record.sourceSite);
        if (fallbackText) {
          if (textIsBlank) record['本页文案'] = fallbackText;
          // v2.7.2：标题一步到位 —— 用兜底词重新生成标题，不再「先写占位词再替换」。
          //
          // 旧做法（v2.5.100）的背景：标题处理器在文案为空时写「无文案」，于是同一份数据会
          // 出现「本页文案=TikTok视频 / 本页标题=某人无文案-2026年10月21日125551」这样一半新一半旧，
          // 当时用一次正则把占位词换掉。代价是要按「无文案 + 紧跟 - 」去猜哪三个字是占位词，
          // 昵称里真带这三个字就会被改掉（「我的无文案」→「我的抖音视频」），而站名表里没有的站
          // 又会留下孤零零的「无文案」。
          //
          // 现在改成：让提取器拿兜底词当文案重跑一次标题生成（站别选项一个不少）。
          //
          // 重跑条件分两种口径（v2.7.38）：
          //   · 文案为空 → 沿用旧口径，**只有标题里确实带了「无文案」占位词**才重跑。
          //     标题不是我们生成的（有的站直接给 document.title）就别动，免得把人家的标题改坏。
          //   · 文案被洗光 → **一定重跑**。过滤是标题处理器干的，这种标题只可能是它生成的；
          //     而且它现在只剩「昵称-日期」，没有「无文案」三个字可认。
          const titleHasPlaceholder = typeof record['本页标题'] === 'string' &&
            record['本页标题'].indexOf('无文案') > -1;
          if (textIsBlank ? titleHasPlaceholder : true) {
            const rebuilt = await rebuildTitleWith(extractor, fallbackText, overrides);
            if (rebuilt) record['本页标题'] = rebuilt;
          }
          // 打一个看不见的标记：熔断逻辑靠它区分「真抓到」和「兜底填的」。
          // 只有「文案列真被换成站名」才算兜底；文案保留原文的那一档不是。
          if (textIsBlank) {
            try {
              Object.defineProperty(record, TEXT_FALLBACK_FLAG, {
                value: true,
                enumerable: false,
                configurable: true,
                writable: true
              });
            } catch (error) { /* 定义失败不影响数据本身 */ }
          }
        }
      }
    }

    return record;
  }

  const api = {
    FALLBACK_FIELD_KEYS,
    FIELD_METHOD_CANDIDATES,
    TEXT_FALLBACK_FLAG,
    getFieldKeys,
    createEmptyRecord,
    build
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SocialFieldsBuilder = api;
  }
})(typeof window !== 'undefined' ? window : null);
