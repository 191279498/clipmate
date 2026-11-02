/**
 * ModalManager 数据处理模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  global.ModalDataMixin = {

    /**
     * 获取社交媒体字段模板的键与顺序
     * 单一来源：src/shared/config/media-types.js 的 SOCIAL_FIELDS（内容脚本里通过 window.mediaTypesConfig 暴露）。
     * 配置不可用时回退到与模板完全一致的本地副本，保证任何情况下都不会出现字段缺失或顺序分歧。
     * @returns {string[]} 字段名数组
     */
    getSocialFieldKeys() {
      const FALLBACK_SOCIAL_FIELD_KEYS = ['本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'];

      try {
        const config = (typeof window !== 'undefined' && window.mediaTypesConfig) ? window.mediaTypesConfig : null;
        if (config && config.SOCIAL_FIELDS) {
          const keys = Object.keys(config.SOCIAL_FIELDS);
          if (keys.length > 0) {
            return keys;
          }
        }
      } catch (error) {
        console.warn('[ModalDataMixin] 读取社交媒体字段模板失败，使用本地副本:', error);
      }

      return FALLBACK_SOCIAL_FIELD_KEYS.slice();
    },

    /**
     * 获取人物档案某一形态的字段键与顺序（v2.7.11）
     *
     * 人物档案有两种记录形态，列数完全不同（影人 12 列 / 账号 6 列），
     * 所以这里必须带 kind。单一来源仍是 media-types.js 的 PERSON_FIELD_LISTS。
     *
     * @param {string} [kind] - celebrity | account，认不出时按 celebrity 兜底
     * @returns {string[]} 字段名数组
     */
    getPersonFieldKeys(kind) {
      const FALLBACK = {
        celebrity: ['姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
          '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址'],
        account: ['平台', '昵称', '账号ID', '账号名', '网址', '简介']
      };

      try {
        const config = (typeof window !== 'undefined' && window.mediaTypesConfig) ? window.mediaTypesConfig : null;
        if (config && typeof config.getPersonFieldList === 'function') {
          const keys = config.getPersonFieldList(kind);
          if (Array.isArray(keys) && keys.length > 0) return keys;
        }
      } catch (error) {
        console.warn('[ModalDataMixin] 读取人物档案字段模板失败，使用本地副本:', error);
      }

      return (FALLBACK[kind] || FALLBACK.celebrity).slice();
    },

    isMediaTypeSubtype(mediaType, parentType) {
    if (mediaConfig && mediaConfig.isMediaTypeSubtype) {
      return mediaConfig.isMediaTypeSubtype(mediaType, parentType);
    }

    // 备用实现
    const MEDIA_TYPE_HIERARCHY = {
      'movie': 'media',
      'tv': 'media'
    };

    let currentType = mediaType;
    while (currentType) {
      const parent = MEDIA_TYPE_HIERARCHY[currentType];
      if (parent === parentType) {
        return true;
      }
      currentType = parent;
    }
    return false;
    },

    /**
     * 计算当前数据的指纹，用于「数据没变就不重建表格」的判断（第二层防线）。
     * 只取真正影响渲染的东西：字段顺序 + 各字段的值，避免无关属性变化。
     * 计算失败返回空串，调用方一律视为「不确定」，宁可重建也不误判。
     */
    _computeDataFingerprint() {
    try {
      const data = this.data || {};
      const order = (Array.isArray(this.fieldOrder) && this.fieldOrder.length)
        ? this.fieldOrder
        : Object.keys(data);
      const S1 = '\u0001', S2 = '\u0002';
      let s = order.length + S2;
      for (const key of order) {
        const v = data[key];
        s += key + S1 + (v == null ? '' : String(v)) + S2;
      }
      return s;
    } catch (e) {
      return '';
    }
    },

    async _prepareData(data) {
    // 设置数据
    this.data = data;
    this.fieldOrder = Object.keys(data);

    // 获取媒体类型
    const mediaType = this.getMediaType();

    // 社交媒体类型特殊处理：只显示指定的7个字段并保持顺序
    if (mediaType === 'social') {
      const requiredFields = this.getSocialFieldKeys();

      const filteredData = {};
      requiredFields.forEach(field => {
        filteredData[field] = this.data[field] || '';
      });

      this.data = filteredData;
      this.fieldOrder = requiredFields;
    }

    // 人物档案（v2.7.11）：两套骨架按 personKind 选，**不隐藏空值列**（用户 2026-10-30 明确要求）。
    // 为什么必须裁剪：field-mapper 预置的是 person 的并集骨架（16 列），
    // 不裁的话账号记录会平白多出 10 个空的影人列。
    let personKind = '';
    if (mediaType === 'person') {
      // kind 优先听数据自己的；数据已经被裁过一次（就地重渲染）时 personKind 键不在了，
      // 这时按**裁完还剩什么列**反推：账号表有「账号ID/账号名」，影人表没有。
      // 不这么兜的话，第二次渲染会把账号记录按 12 列骨架渲染，冒出 6 个空行。
      personKind = (this.data && this.data.personKind) || '';
      if (!personKind && this.data && ('账号ID' in this.data || '账号名' in this.data)) {
        personKind = 'account';
      }
      const requiredFields = this.getPersonFieldKeys(personKind);

      const filteredData = {};
      requiredFields.forEach(field => {
        filteredData[field] = this.data[field] || '';
      });

      this.data = filteredData;
      this.fieldOrder = requiredFields;
    }

    this.fieldMappings = {};

    let displayOrder = [];
    if (mediaConfig && mediaConfig.getDisplayOrder) {
      // person 必须带 kind：不带会返回 16 列并集，账号记录就会冒出空列
      displayOrder = mediaConfig.getDisplayOrder(mediaType, personKind);
    }

    if (displayOrder.length > 0) {
      const newFieldOrder = [...displayOrder];
      const remainingFields = [...this.fieldOrder].filter(field => !displayOrder.includes(field));
      newFieldOrder.push(...remainingFields);
      this.fieldOrder = newFieldOrder;
    } else {
      // 展示顺序的唯一来源是 media-types.js 的 MEDIA_FIELD_LISTS。
      // 这里曾有三份硬编码默认顺序（book / media / game），与配置长期不同步，
      // 现已删除：拿不到展示顺序时保持数据原有键序，不再猜测。
      console.warn(`[ModalDataMixin] 未取到 ${mediaType} 的展示顺序，保持数据原有键序`);
    }

    const fieldsToExclude = ['keywords'];
    this.fieldOrder = this.fieldOrder.filter(field => !fieldsToExclude.includes(field));


    await this.applyFieldMappings();

    await this.applyFieldOrder();

    // 统一处理进度/时间字段：注入空值到数据 + 强制排到末尾
    // 社交媒体 / 人物档案不显示这些字段
    // （v2.7.11：人物档案不加这条的话，6 列会变 10 列 / 12 列变 16 列，凭空多 4 个空行）
    if (mediaType !== 'social' && mediaType !== 'person') {
      const progressFields = ['我的进度', '标记时间', '开始时间', '结束时间'];
      // 数据中不存在则注入空值
      for (const field of progressFields) {
        if (!(field in this.data)) {
          this.data[field] = '';
        }
      }
      // 强制排到末尾（即使 applyFieldOrder 乱序也重新固定）
      this.fieldOrder = this.fieldOrder.filter(f => !progressFields.includes(f));
      this.fieldOrder.push(...progressFields);
    }

    this.isEditMode = false;
    this.originalData = JSON.parse(JSON.stringify(this.data));
    this.originalFieldOrder = [...this.fieldOrder];
    },

  };
})(window);


if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalDataMixin);
}