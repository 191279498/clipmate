/**
 * 人物档案字段统一装配器（v2.7.11）
 *
 * 设计目标（与 social-fields-builder.js 同一套思路）
 * -----------------------------------------------
 * 1. 字段外壳（列名、列数、列序）只在 media-types.js 的 PERSON_FIELD_LISTS 里定义，
 *    各站提取器一行都不写字段对象。
 * 2. 取值仍由各站提取器自己实现（DOM / 数据块各不相同），方法名按下面的候选表统一。
 * 3. 两类记录形态各一套列：
 *      celebrity（影人 / 作者档案）12 列：姓名、别名、性别、出生日期、逝世日期、国家、简介、
 *                                          豆瓣、IMDb、TMDB、Bangumi、网址
 *      account  （社交账号）       6 列：平台、昵称、账号ID、账号名、网址、简介
 * 4. 标准化统一在这里做，各站不要各写一份：
 *      · 日期补齐（只补 -01，见 person-date.js）
 *      · 国家抽取（从出生地，见 country-extract.js）
 *      · 别名去重 + 英文逗号连接
 *      · 性别中文化（Male / Female → 男 / 女）
 *      · 影人简介 = 职业 + 补充 + 正文 的三段合并
 *      · 网址规范化（去掉 ?from_tab_name= 这类临时参数）
 *
 * 用法
 * ----
 *   // 影人 / 作者档案
 *   async extractAllFields() {
 *     return await PersonFieldsBuilder.build(this, { kind: 'celebrity' });
 *   }
 *   // 社交账号
 *   async extractAllFields() {
 *     return await PersonFieldsBuilder.build(this, { kind: 'account' });
 *   }
 *
 * 单字段取值失败只置空该字段，不会让整份数据丢失；兜底恒为完整列。
 */
(function (global) {
  'use strict';

  var KIND = { CELEBRITY: 'celebrity', ACCOUNT: 'account' };

  /**
   * 影人档案里「自带本页链接」的四列。
   * 这四列任一有值 → 「网址」留空，不重复存（用户 2026-10-30 定）。
   */
  var SITE_LINK_FIELDS = ['豆瓣', 'IMDb', 'TMDB', 'Bangumi'];

  /**
   * 内置兜底列（mediaTypesConfig 不可用时才用），键序必须与 media-types.js 一致
   */
  var FALLBACK_FIELDS = {
    celebrity: ['姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
      '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址'],
    account: ['平台', '昵称', '账号ID', '账号名', '网址', '简介']
  };

  /**
   * 列 → 取值方法候选名
   * 数组顺序 = 优先级，找到第一个存在的方法就用它（各站命名不统一时按需补候选）
   */
  var FIELD_METHODS = {
    celebrity: {
      '姓名': ['extractName'],
      '别名': ['extractAliases', 'extractAlias'],
      '性别': ['extractGender'],
      '出生日期': ['extractBirthDate'],
      '逝世日期': ['extractDeathDate'],
      // 注意：这一列方法返回的是**出生地原文**，国家由后处理抽取（见 build 末尾）
      '国家': ['extractBirthPlace', 'extractBirthplace'],
      '简介': [], // 特殊组装，不走通用取值
      '豆瓣': ['extractDoubanUrl'],
      'IMDb': ['extractImdbUrl'],
      'TMDB': ['extractTmdbUrl'],
      'Bangumi': ['extractBgmUrl', 'extractBangumiUrl'],
      '网址': ['extractUrl']
    },
    account: {
      '平台': ['extractPlatform'],
      '昵称': ['extractNickname', 'extractName'],
      '账号ID': ['extractAccountId', 'extractAuthorId'],
      '账号名': ['extractAccountName', 'extractUsername'],
      '网址': ['extractUrl'],
      '简介': ['extractBio', 'extractDescription']
    }
  };

  /** 中英文性别 → 男 / 女；认不出原样返回 */
  function normalizeGender(value) {
    var s = String(value === null || value === undefined ? '' : value).trim();
    if (!s) return '';
    if (/^(male|m|man)$/i.test(s)) return '男';
    if (/^(female|f|woman)$/i.test(s)) return '女';
    if (s.indexOf('男') > -1) return '男';
    if (s.indexOf('女') > -1) return '女';
    return s;
  }

  /**
   * 别名归一：支持数组 / 逗号分隔字符串 / 顿号分隔
   * 去空、去重（保持首次出现顺序），最后用**英文逗号 + 空格**连接
   *
   * 用户 2026-10-30 明确：别名字段只允许用 `, ` 分隔
   * （与现有豆瓣 / IMDb 的「别名」「主演」「地区」字段完全一致）。
   */
  function normalizeAliases(value) {
    if (value === null || value === undefined) return '';
    var list = [];
    if (Array.isArray(value)) {
      list = value;
    } else {
      list = String(value).split(/[,，、;；|]+/);
    }
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = String(list[i] === null || list[i] === undefined ? '' : list[i])
        .replace(/[\u3000\s]+/g, ' ')
        .trim();
      if (!s) continue;
      if (out.indexOf(s) === -1) out.push(s);
    }
    return out.join(', ');
  }

  /** 多值文本归一（职业、平台等）：同样是英文逗号 + 空格 */
  function joinValues(value) {
    return normalizeAliases(value);
  }

  /** 取列清单：优先配置，其次内置兜底 */
  function getFieldList(kind) {
    try {
      var cfg = global && global.mediaTypesConfig;
      if (cfg && typeof cfg.getPersonFieldList === 'function') {
        var list = cfg.getPersonFieldList(kind);
        if (Array.isArray(list) && list.length) return list;
      }
    } catch (e) { /* 落到兜底 */ }
    return (FALLBACK_FIELDS[kind] || FALLBACK_FIELDS.celebrity).slice();
  }

  /** URL 规范化（有就用，没有原样返回，保证单测环境不报错） */
  function normalizeUrl(url) {
    var s = String(url === null || url === undefined ? '' : url).trim();
    if (!s) return '';
    try {
      if (global && global.UrlNormalizer && typeof global.UrlNormalizer.normalize === 'function') {
        return global.UrlNormalizer.normalize(s);
      }
    } catch (e) { /* 规范化失败不影响输出 */ }
    return s;
  }

  /**
   * 取依赖模块：浏览器里读全局，Node 单测里走 require
   * （内容脚本是 classic 脚本，没有模块系统，所以两条路都要留着）
   */
  function pick(globalName, requirePath) {
    try {
      if (global && global[globalName]) return global[globalName];
    } catch (e) { /* 落到 require */ }
    try {
      if (typeof require === 'function') return require(requirePath);
    } catch (e) { /* 都拿不到就返回 null，调用方跳过标准化 */ }
    return null;
  }

  function getCurrentUrl() {
    try {
      return (global && global.location && global.location.href) || '';
    } catch (e) {
      return '';
    }
  }

  function toText(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return joinValues(value);
    if (typeof value === 'object') return '';
    return String(value).trim();
  }

  async function resolveOverride(value) {
    var v = typeof value === 'function' ? value() : value;
    return await v;
  }

  /** 按候选方法名取一个值 */
  async function callFirst(extractor, names) {
    var list = names || [];
    for (var i = 0; i < list.length; i++) {
      var fn = extractor && extractor[list[i]];
      if (typeof fn === 'function') {
        try {
          return await fn.call(extractor);
        } catch (e) {
          return '';
        }
      }
    }
    return '';
  }

  /**
   * 影人简介 = 职业 + 补充 + 正文
   *
   * 用户 2026-10-30 定的顺序：**正文在后**，职业与补充在前。
   *
   * 输出形如：
   *   职业：演员, 导演
   *   补充：星座 水瓶座；身高 178cm
   *
   *   <简介正文>
   *
   * 空段整行跳过 —— 没有简介的人这一格就是空，不会留「职业：」这种半截行。
   */
  async function assembleCelebrityBio(extractor, overrides) {
    var profession = '';
    var extras = '';
    var bio = '';

    if (overrides && Object.prototype.hasOwnProperty.call(overrides, '职业')) {
      profession = await resolveOverride(overrides['职业']);
    } else {
      profession = await callFirst(extractor, ['extractProfession', 'extractOccupations']);
    }
    profession = joinValues(profession);

    if (overrides && Object.prototype.hasOwnProperty.call(overrides, '补充')) {
      extras = await resolveOverride(overrides['补充']);
    } else {
      extras = await callFirst(extractor, ['extractExtras', 'extractAdditionalInfo']);
    }

    if (overrides && Object.prototype.hasOwnProperty.call(overrides, '简介')) {
      bio = await resolveOverride(overrides['简介']);
    } else {
      bio = await callFirst(extractor, ['extractBio', 'extractDescription', 'extractSummary']);
    }
    bio = toText(bio);

    // 补充信息：既接受对象 {星座:'水瓶座'}，也接受已排好序的字符串
    var extrasText = '';
    if (extras && typeof extras === 'object' && !Array.isArray(extras)) {
      var pairs = [];
      for (var k in extras) {
        if (!Object.prototype.hasOwnProperty.call(extras, k)) continue;
        var v = toText(extras[k]);
        if (!v) continue;
        pairs.push(k + ' ' + v);
      }
      extrasText = pairs.join('；');
    } else {
      extrasText = toText(extras);
    }

    var head = [];
    if (profession) head.push('职业：' + profession);
    if (extrasText) head.push('补充：' + extrasText);
    var headText = head.join('\n');

    if (headText && bio) return headText + '\n\n' + bio;
    return headText || bio;
  }

  /**
   * 按模板装配整份人物档案
   *
   * @param {Object} extractor - 提取器实例
   * @param {Object} [options]
   * @param {string} [options.kind] - celebrity | account，缺省 celebrity
   * @param {Object} [options.overrides] - 指定列的取值覆盖（值 / 函数 / Promise）
   * @param {string} [options.sourceSite] - 缺省取 extractor.siteName
   * @returns {Promise<Object>} 完整字段对象
   */
  async function build(extractor, options) {
    var opts = options || {};
    var kind = (opts.kind === KIND.ACCOUNT) ? KIND.ACCOUNT : KIND.CELEBRITY;
    var overrides = opts.overrides || {};
    var fields = getFieldList(kind);
    var methods = FIELD_METHODS[kind] || {};
    var record = {};

    for (var i = 0; i < fields.length; i++) {
      var key = fields[i];

      // 影人「简介」是三段合并，单独处理
      if (kind === KIND.CELEBRITY && key === '简介') {
        try {
          record[key] = await assembleCelebrityBio(extractor, overrides);
        } catch (e) {
          record[key] = '';
        }
        continue;
      }

      try {
        if (Object.prototype.hasOwnProperty.call(overrides, key)) {
          record[key] = toText(await resolveOverride(overrides[key]));
        } else {
          record[key] = toText(await callFirst(extractor, methods[key]));
        }
      } catch (e) {
        record[key] = '';
        console.error('[PersonFieldsBuilder] 字段「' + key + '」提取失败，已置空:', e);
      }
    }

    // ---- 统一标准化 ----

    if (kind === KIND.CELEBRITY) {
      // 日期补齐：只补 -01，只对人物档案（见 person-date.js 头部的三条纪律）
      var pd = pick('PersonDate', './person-date.js');
      if (pd && typeof pd.fillPersonDate === 'function') {
        record['出生日期'] = pd.fillPersonDate(record['出生日期']);
        record['逝世日期'] = pd.fillPersonDate(record['逝世日期']);
      }
      // 别名：外文名排第一（提取器负责顺序），这里只做去重与连接
      record['别名'] = normalizeAliases(record['别名']);
      record['性别'] = normalizeGender(record['性别']);
      // 国家：本列取到的是出生地原文，这里抽国家；抽不出留空
      var ce = pick('CountryExtract', '../../shared/country-extract.js');
      if (ce && typeof ce.extractCountry === 'function') {
        record['国家'] = ce.extractCountry(record['国家']);
      } else {
        record['国家'] = '';
      }
    } else {
      // 账号 ID：必须与作品页「作者ID」同串，这里只做空白清理，绝不改写
      record['账号ID'] = String(record['账号ID'] || '').replace(/[\u3000\s]+/g, '').trim();
      record['账号名'] = String(record['账号名'] || '').trim();
      // 平台：提取器没实现 extractPlatform 时退回它自报的 platformName
      if (!record['平台'] && extractor && extractor.platformName) {
        record['平台'] = String(extractor.platformName).trim();
      }
    }

    // 网址：空则兜底当前页地址，再统一规范化
    //
    // 例外（用户 2026-10-30 定）：影人档案的「豆瓣 / IMDb / TMDB / Bangumi」四列
    // 任一有值，说明本页链接已经落在专属列里了，「网址」**一律清空** —— 不重复存。
    // 刻意写成"强制清空"而不是"不兜底"：将来某个新站忘了把 extractUrl 改成返回空，
    // 这条总规则也能兜住，不会漏出一条重复数据。
    // 只对 celebrity 生效 —— 账号形态（抖音主页）没有这四列，网址必须留。
    if (Object.prototype.hasOwnProperty.call(record, '网址')) {
      var siteLinked = kind === KIND.CELEBRITY && SITE_LINK_FIELDS.some(function (k) {
        return !!record[k];
      });
      if (siteLinked) {
        record['网址'] = '';
      } else {
        if (!record['网址']) record['网址'] = getCurrentUrl();
        record['网址'] = record['网址'] ? normalizeUrl(record['网址']) : '';
      }
    }

    record.mediaType = 'person';
    record.personKind = kind;
    record.sourceSite = opts.sourceSite || (extractor && extractor.siteName) || 'unknown';

    return record;
  }

  var api = {
    KIND: KIND,
    FALLBACK_FIELDS: FALLBACK_FIELDS,
    FIELD_METHODS: FIELD_METHODS,
    getFieldList: getFieldList,
    normalizeAliases: normalizeAliases,
    normalizeGender: normalizeGender,
    build: build
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.PersonFieldsBuilder = api;
  }
})(typeof window !== 'undefined' ? window : null);
