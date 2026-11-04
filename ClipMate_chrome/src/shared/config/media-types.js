// 媒体类型定义和通用字段模板

const MEDIA_TYPES = {
  BOOK: 'book',
  MEDIA: 'media', // 新增：影视父类型
  MOVIE: 'movie', // 电影子类型
  TV: 'tv',       // 电视剧子类型
  GAME: 'game',
  SOCIAL: 'social', // 社交媒体类型
  // v2.7.11：人物档案 —— 与影视 / 书籍 / 游戏 / 社交平级的第五个大类。
  //
  // 为什么是「一个 mediaType + 两种记录形态」而不是两个 mediaType：
  //   · 对外（缓存键 / 设置页 / UI 偏好 / 导出）只需要认一个 person，多一个类型键就要多改一圈；
  //   · 影人档案与社交账号描述的根本不是同一种东西（自然人和账号），字段表必须分开，
  //     这点由下面的 PERSON_KINDS 表达，不需要类型层面再分家。
  PERSON: 'person'
};

// 人物档案的两种记录形态。决定了用哪一套字段表（见 PERSON_FIELD_LISTS）。
const PERSON_KINDS = {
  CELEBRITY: 'celebrity', // 影视 / 文学创作者档案（豆瓣影人、IMDb name、TMDB person、Bangumi person、豆瓣作者）
  ACCOUNT: 'account'      // 社交平台上的一个账号（作者个人主页）
};

// 媒体类型层次结构定义
const MEDIA_TYPE_HIERARCHY = {
  [MEDIA_TYPES.MOVIE]: MEDIA_TYPES.MEDIA, // 电影属于影视
  [MEDIA_TYPES.TV]: MEDIA_TYPES.MEDIA     // 电视剧属于影视
};

// ============================================================
// 字段清单 —— 全项目唯一权威来源
// ------------------------------------------------------------
// 这份有序数组同时决定三件事：
//   1. 该媒体类型有哪些字段（映射骨架 / 字段白名单）
//   2. 这些字段在弹窗里的展示顺序
//   3. field-mapper 的字段骨架
// 历史上这里有 5 份互相矛盾的副本（本文件的两套、field-mapper 的骨架、
// modal-manager 的硬编码、modal-data-processor 的三份默认顺序），
// 结果是「定价」这类模板外字段只能被透传到最后一列。现在统一由这里派生。
// ============================================================
const MEDIA_FIELD_LISTS = {
  // 影视类（父类型；电影 / 电视剧继承同一份清单）
  [MEDIA_TYPES.MEDIA]: [
    // v2.5.37：「国家」上移到第 3 位（「影视类型」之后），与书籍类同位置。
    // 游戏类的「国家」在第 7 位（简介之后），那是游戏类自己的排法，未动。
    '名字', '影视类型', '国家', '上映日期', '简介', '网络评分', '原作名',
    // v2.11.2：IMDB / TMDB / Bangumi 三列撤销，改为在「URL」一格内以
    // 「站名：地址」的形式合并展示（用户 2026-11-04 拍板）。
    //   · 数据层仍保留 IMDB / TMDB / Bangumi 三个键 —— 跨站补链、缓存、导出都靠它们；
    //   · 合并只发生在渲染前（modal-data-processor 的 _mergeLinksIntoUrl），键本身不删不并；
    //   · 「豆瓣链接」保留独立一列，不并进 URL（豆瓣条目地址与普通外链语义不同）。
    // 历史坑：这两处曾把 movie/tv 的 URL 列**改名叫「豆瓣链接」**，与上面真正的
    // 豆瓣链接列撞名，红果这类把本页地址写进 URL 的站就会出现两行「豆瓣链接」。
    '豆瓣链接', 'URL', '导演', '编剧', '主演',
    // v2.5.67：新增「标签」（豆瓣影视的类型标签，从「其他信息」里拆出来，半角逗号连接）。
    // 注意与第 2 位的「影视类型」区分：那个写的是「电影 / 剧集」，是媒体类型标记。
    '片长', '集数', '单集片长', '别名', '标签', '其他信息',
    '我的进度', '标记时间', '开始时间', '结束时间'
  ],
  // 书籍类（豆瓣书籍 / 番组书籍 / 起点中文网 / 番茄小说）
  [MEDIA_TYPES.BOOK]: [
    '书名', '作者', '国家', '原作名', '发布日期', '简介',
    '网络评分', '豆瓣链接', 'URL', 'ISBN', '篇幅', '别名', '其他信息',
    '我的进度', '标记时间', '开始时间', '结束时间'
  ],
  // 游戏类（豆瓣游戏 / 番组游戏 / Steam）
  [MEDIA_TYPES.GAME]: [
    '游戏名', '发行日期', '原作名', '平台', '网络评分',
    '简介', '国家', 'Steam', '豆瓣链接', '官方网站', 'URL',
    '别名', '其他信息', '我的进度', '标记时间', '开始时间', '结束时间'
  ],
  // 社交媒体类（7 字段标准，10 个站点共用）
  [MEDIA_TYPES.SOCIAL]: [
    '本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'
  ],
  // 人物档案（父类型；实际渲染一律按 PERSON_KINDS 取子表，见 getPersonFieldList）
  //
  // 这里放的是两张子表的**并集**，用途只有一个：`getFullFieldTemplate('person')` 的兜底骨架
  // ≠ 渲染列。真正决定列的是 personality 分支里的 `getPersonFieldList(kind)`，
  // 它会把并集裁成该形态自己的那几个键（modal-data-processor 的 person 分支负责裁剪）。
  //
  // 为什么要并集兜底：field-mapper 的骨架预置是全站共享的一份，拿不到 kind 时不能把数据弄丢。
  [MEDIA_TYPES.PERSON]: [
    // —— celebrity（影人 / 作者档案）12 列 ——
    '姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
    '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址',
    // —— account（社交账号）在 12 列之外多出来的 4 列 ——
    '平台', '昵称', '账号ID', '账号名'
  ]
};

// ============================================================
// 人物档案：两套字段表（v2.7.11）
// ------------------------------------------------------------
// 影人档案 12 列 / 社交账号 6 列。「简介」与「网址」两个键双方都有，语义一致，共用。
//
// 为什么必须分开：影人页没有「平台」，社交主页没有「职业 / 出生地」。
// 合成一张表的结果是——影人记录的「平台」填成「豆瓣」（荒唐），
// 账号记录的 6 个影人列全空（难看）。
// ============================================================
const PERSON_FIELD_LISTS = {
  // 影人 / 作者档案：姓名、别名（外文名排第一）、性别、生卒、国家、简介、四站外链、本页网址
  [PERSON_KINDS.CELEBRITY]: [
    '姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
    '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址'
  ],
  // 社交账号：平台、昵称、账号ID（= 作品页作者ID）、账号名（对外可见 ID）、网址、简介
  [PERSON_KINDS.ACCOUNT]: [
    '平台', '昵称', '账号ID', '账号名', '网址', '简介'
  ]
};

// ============================================================
// 只进骨架、不进展示清单的字段（v2.11.3）
// ------------------------------------------------------------
// v2.11.2 把 IMDB / TMDB / Bangumi 三列从影视清单里撤掉了（并进 URL 一格展示），
// 但**骨架里必须继续留着这三个空键**：
//   · 浮窗「补齐网址」按钮的显示判据是 `'TMDB' in this.data || 'Bangumi' in this.data`；
//   · 跨站补链按这几个键判空、写入，缺键虽不崩，但与缓存里的老记录结构不一致。
// 真机实测（v2.11.2，豆瓣电影页）：三键从骨架消失 → 按钮直接不出现 → 补全功能静默失效。
// 所以展示清单（22 列）与骨架（25 键）在这里**有意分离**，改任何一边都要两边对一遍。
// ============================================================
const SKELETON_ONLY_KEYS = {
  [MEDIA_TYPES.MEDIA]: ['IMDB', 'TMDB', 'Bangumi'],
  [MEDIA_TYPES.MOVIE]: ['IMDB', 'TMDB', 'Bangumi'],
  [MEDIA_TYPES.TV]: ['IMDB', 'TMDB', 'Bangumi']
};

/**
 * 由字段清单生成模板对象：键序与清单完全一致，值统一为空字符串。
 * @param {Array<string>} fieldList 字段清单
 * @returns {Object} 字段模板
 */
function buildFieldTemplate(fieldList) {
  const template = {};
  if (Array.isArray(fieldList)) {
    for (const field of fieldList) {
      template[field] = '';
    }
  }
  return template;
}

// 书籍类通用字段模板
const BOOK_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.BOOK]);

// 影视类通用字段模板（父类型）
const MEDIA_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.MEDIA]);

// 电影类通用字段模板（子类型；片长/集数/单集片长都在影视清单里，无需再单独追加）
const MOVIE_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.MEDIA]);

// 电视剧类通用字段模板（同上）
const TV_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.MEDIA]);

// 游戏类通用字段模板
const GAME_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.GAME]);

// 社交媒体类通用字段模板 - 严格按照社交媒体字段模板配置（7字段标准）
const SOCIAL_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.SOCIAL]);

// 人物档案：并集模板（兜底用，实际渲染按 kind 取下面两张）
const PERSON_FIELDS = buildFieldTemplate(MEDIA_FIELD_LISTS[MEDIA_TYPES.PERSON]);

// 人物档案：影人 / 作者 12 列模板
const PERSON_CELEBRITY_FIELDS = buildFieldTemplate(PERSON_FIELD_LISTS[PERSON_KINDS.CELEBRITY]);

// 人物档案：社交账号 6 列模板
const PERSON_ACCOUNT_FIELDS = buildFieldTemplate(PERSON_FIELD_LISTS[PERSON_KINDS.ACCOUNT]);

/**
 * 取人物档案某一形态的字段清单（唯一入口，勿在别处再写一份）
 *
 * kind 认不出来时（老数据 / 提取器忘了带）退回 celebrity —— 影人字段里包含
 * 「姓名 / 简介 / 网址」，比账号那套更能兜住内容，不会把数据整列丢掉。
 *
 * @param {string} [kind] - PERSON_KINDS.CELEBRITY | PERSON_KINDS.ACCOUNT
 * @returns {string[]} 字段名数组（已复制）
 */
function getPersonFieldList(kind) {
  const list = PERSON_FIELD_LISTS[kind] || PERSON_FIELD_LISTS[PERSON_KINDS.CELEBRITY];
  return list.slice();
}

/**
 * 人物档案某一形态的字段模板
 * @param {string} [kind]
 * @returns {Object}
 */
function getPersonFieldTemplate(kind) {
  return buildFieldTemplate(getPersonFieldList(kind));
}

/**
 * 获取媒体类型的父类型
 * @param {string} mediaType - 媒体类型
 * @returns {string|null} - 父类型，如果没有父类型则返回null
 */
function getParentMediaType(mediaType) {
  return MEDIA_TYPE_HIERARCHY[mediaType] || null;
}

/**
 * 检查媒体类型是否是另一个类型的子类型
 * @param {string} mediaType - 要检查的媒体类型
 * @param {string} parentType - 父类型
 * @returns {boolean} - 如果是子类型返回true
 */
function isMediaTypeSubtype(mediaType, parentType) {
  let currentType = mediaType;
  while (currentType) {
    const parent = getParentMediaType(currentType);
    if (parent === parentType) {
      return true;
    }
    currentType = parent;
  }
  return false;
}

/**
 * 获取完整的字段模板，包括父类型的字段
 * @param {string} mediaType - 媒体类型
 * @param {string} [personKind] - 仅 person 有意义：celebrity / account
 * @returns {Object} - 合并后的字段模板
 */
function getFullFieldTemplate(mediaType, personKind) {
  const templates = [];
  
  // 收集从父类型到子类型的所有字段模板
  let currentType = mediaType;
  while (currentType) {
    let template;
    switch (currentType) {
      case MEDIA_TYPES.BOOK:
        template = BOOK_FIELDS;
        break;
      case MEDIA_TYPES.MEDIA:
        template = MEDIA_FIELDS;
        break;
      case MEDIA_TYPES.MOVIE:
        template = MOVIE_FIELDS;
        break;
      case MEDIA_TYPES.TV:
        template = TV_FIELDS;
        break;
      case MEDIA_TYPES.GAME:
        template = GAME_FIELDS;
        break;
      case MEDIA_TYPES.SOCIAL:
        template = SOCIAL_FIELDS;
        break;
      case MEDIA_TYPES.PERSON:
        // 带上 kind 才返回该形态自己的列；不带就退回并集（骨架兜底，不丢字段）
        template = personKind
          ? getPersonFieldTemplate(personKind)
          : PERSON_FIELDS;
        break;
      default:
        template = {};
    }
    
    templates.unshift(template); // 将父类型模板放在前面
    currentType = getParentMediaType(currentType);
  }
  
  // 合并所有模板
  const merged = Object.assign({}, ...templates);

  // 补上「只进骨架、不进展示清单」的键：影视类的 IMDB / TMDB / Bangumi。
  // 它们不出现在 getDisplayOrder() 里，但 data 里必须有 —— 补链与按钮判据都靠它。
  const skeletonOnly = SKELETON_ONLY_KEYS[mediaType];
  if (Array.isArray(skeletonOnly)) {
    skeletonOnly.forEach((key) => {
      if (!(key in merged)) merged[key] = '';
    });
  }

  return merged;
}

// 根据媒体类型获取对应的字段模板（保持向后兼容）
function getFieldTemplate(mediaType, personKind) {
  // 使用新的getFullFieldTemplate来获取包括父类型字段的完整模板
  return { ...getFullFieldTemplate(mediaType, personKind) };
}

// 媒体类型展示顺序配置 —— 直接引用唯一字段清单，不再维护第二份副本
const MEDIA_DISPLAY_ORDER = {
  // 影视类（电影 / 电视剧继承父类型顺序）
  [MEDIA_TYPES.MEDIA]: [...MEDIA_FIELD_LISTS[MEDIA_TYPES.MEDIA]],
  // 书籍类
  [MEDIA_TYPES.BOOK]: [...MEDIA_FIELD_LISTS[MEDIA_TYPES.BOOK]],
  // 游戏类
  [MEDIA_TYPES.GAME]: [...MEDIA_FIELD_LISTS[MEDIA_TYPES.GAME]],
  // 社交媒体类（7 字段标准）
  [MEDIA_TYPES.SOCIAL]: [...MEDIA_FIELD_LISTS[MEDIA_TYPES.SOCIAL]],
  // 人物档案：并集（不带 kind 时的兜底顺序）
  [MEDIA_TYPES.PERSON]: [...MEDIA_FIELD_LISTS[MEDIA_TYPES.PERSON]]
};

/**
 * 获取媒体类型的字段展示顺序，支持子类型继承父类型的顺序
 * @param {string} mediaType - 媒体类型
 * @param {string} [personKind] - 仅 person 有意义：传了就返回该形态自己的列（12 列 / 6 列），
 *                               **不传返回 16 列并集** —— 渲染层必须传，否则账号记录会多出 10 个空列。
 * @returns {Array} - 字段展示顺序数组
 */
function getDisplayOrder(mediaType, personKind) {
  // 人物档案：两套骨架差异极大，必须按 kind 取，不能走下面的通用逻辑
  if (mediaType === MEDIA_TYPES.PERSON) {
    return personKind ? getPersonFieldList(personKind) : [...MEDIA_FIELD_LISTS[MEDIA_TYPES.PERSON]];
  }

  // 直接查找该类型是否有自定义顺序
  if (MEDIA_DISPLAY_ORDER[mediaType]) {
    return [...MEDIA_DISPLAY_ORDER[mediaType]];
  }
  
  // 检查是否是某类型的子类型，如果是则继承父类型的展示顺序
  const parentType = getParentMediaType(mediaType);
  if (parentType && MEDIA_DISPLAY_ORDER[parentType]) {
    return [...MEDIA_DISPLAY_ORDER[parentType]];
  }
  
  // 如果没有找到任何顺序配置，返回空数组
  return [];
}

// 导出配置
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MEDIA_TYPES,
    MEDIA_TYPE_HIERARCHY,
    BOOK_FIELDS,
    MEDIA_FIELDS,
    MOVIE_FIELDS,
    TV_FIELDS,
    GAME_FIELDS,
    SOCIAL_FIELDS,
    PERSON_FIELDS,
    PERSON_CELEBRITY_FIELDS,
    PERSON_ACCOUNT_FIELDS,
    MEDIA_FIELD_LISTS,
    SKELETON_ONLY_KEYS,
    PERSON_KINDS,
    PERSON_FIELD_LISTS,
    buildFieldTemplate,
    MEDIA_DISPLAY_ORDER,
    getFieldTemplate,
    getFullFieldTemplate,
    getParentMediaType,
    isMediaTypeSubtype,
    getDisplayOrder,
    getPersonFieldList,
    getPersonFieldTemplate
  };
}

// 内容脚本环境暴露
// 内容脚本是 classic 脚本，没有 module 环境，原先只能靠各文件自带的兜底副本，
// 导致社交媒体字段模板出现多份定义且互不一致。这里把同一份配置挂到 window，
// 供 modal-manager / modal-data-processor / social-fields-builder 统一引用。
if (typeof window !== 'undefined') {
  window.mediaTypesConfig = {
    MEDIA_TYPES,
    MEDIA_TYPE_HIERARCHY,
    BOOK_FIELDS,
    MEDIA_FIELDS,
    MOVIE_FIELDS,
    TV_FIELDS,
    GAME_FIELDS,
    SOCIAL_FIELDS,
    PERSON_FIELDS,
    PERSON_CELEBRITY_FIELDS,
    PERSON_ACCOUNT_FIELDS,
    MEDIA_FIELD_LISTS,
    SKELETON_ONLY_KEYS,
    PERSON_KINDS,
    PERSON_FIELD_LISTS,
    buildFieldTemplate,
    MEDIA_DISPLAY_ORDER,
    getFieldTemplate,
    getFullFieldTemplate,
    getParentMediaType,
    isMediaTypeSubtype,
    getDisplayOrder,
    getPersonFieldList,
    getPersonFieldTemplate
  };
}