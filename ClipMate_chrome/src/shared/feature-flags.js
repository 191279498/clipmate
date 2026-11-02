// 站点专属功能开关（v2.8.0）
//
// 【要解决什么】
//   抖音、快手那几个试验开关原来是**独立存储键**（douyinModalEnabled 等），
//   在设置页里被摆在站点表之外单独一排。用户排查「抖音怎么不出按钮」时，
//   要在页面顶部和抖音那一行之间来回找；每加一个试验功能，顶部就多一条，
//   站点一多必然失控。
//
// 【现在怎么存】
//   统一收进 config.features = { douyinModal: true, ... }，
//   设置页把它显示在对应站点的卡片里（见 options.js）。
//
// 【旧键怎么办 —— 关键】
//   抖音/快手的内容脚本（douyin-spa-handler.js、kuaishou-spa-handler.js、
//   kuaishou-no-autoplay-flag.js）读的仍是旧键名。为了让它们不改一行代码就继续工作，
//   写入时**双写**：config.features 与旧键同时落盘（见 options.js 的 saveFeature）。
//   读取时**双读**：优先 config.features，没有才看旧键。这样：
//     · 老用户已有的旧键设置 → 照样生效，不会因为升级被重置；
//     · 新设置页改开关 → config 与旧键一起变，新旧代码都读得到。
//   等哪天旧代码都改成读 features 了，再把旧键写回去掉（不建议删旧键，留着更安全）。
(function (global) {
  'use strict';

  /**
   * 一条 = 一个站点专属功能。
   *
   * sites   ：这个开关影响哪些主机名（设置页按它把开关挂到对应站点卡片里）
   * legacyKey：旧版独立存储键；有就双读双写，没有就是全新开关
   * appliesTo：'buttons' = 控制「出不出按钮」；'behavior' = 改站点自身行为（如自动连播）
   */
  var FEATURES = [
    {
      key: 'douyinModal',
      sites: ['www.douyin.com', 'v.douyin.com'],
      label: '弹窗提取',
      hint: '精选 / 搜索 / 用户主页点开视频时，按钮贴在弹窗右上角；关掉后这些页面不出按钮（视频详情页不受影响）',
      legacyKey: 'douyinModalEnabled',
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'douyinImmersive',
      sites: ['www.douyin.com'],
      label: '推荐 / 关注 / 朋友页提取',
      hint: '这三页是整屏播放，按 ↓ 或滚轮切下一条时按钮跟着走；关掉后这三页不出按钮（弹窗与视频详情页不受影响）',
      legacyKey: 'douyinImmersiveEnabled',
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'kuaishouImmersive',
      sites: ['www.kuaishou.com'],
      label: '推荐页提取',
      hint: '推荐页 /new-reco 整屏播放时出按钮；关掉后推荐页不出按钮（详情页不受影响）',
      legacyKey: 'kuaishouImmersiveEnabled',
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'kuaishouPopup',
      sites: ['www.kuaishou.com'],
      label: '搜索页弹层提取',
      hint: '搜索页点开卡片盖上播放窗时出按钮；关掉后搜索页不出按钮（详情页不受影响）',
      legacyKey: 'kuaishouPopupEnabled',
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'kuaishouNoAutoplay',
      sites: ['www.kuaishou.com'],
      label: '关闭自动连播',
      hint: '打开后作品播完停在最后一帧，弹层不会自己切下一条；只改「播完怎么办」，不影响出不出按钮',
      legacyKey: 'kuaishouNoAutoplayEnabled',
      defaultEnabled: true,
      appliesTo: 'behavior'
    },
    {
      key: 'xFeedButtons',
      sites: ['x.com', 'www.x.com'],
      label: '时间线逐条按钮',
      hint: '信息流每条推文挂一颗小按钮；详情页主贴不挂（回复照挂），单条详情视图全摘',
      legacyKey: null,
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'weiboFeedButtons',
      sites: ['weibo.com', 'www.weibo.com', 's.weibo.com', 'm.weibo.cn'],
      label: '信息流逐条按钮',
      hint: '首页 / 搜索页每条微博挂一颗小按钮；页面只有一条博文（详情页）时全摘',
      legacyKey: null,
      defaultEnabled: true,
      appliesTo: 'buttons'
    },
    {
      key: 'igFeedButtons',
      sites: ['www.instagram.com', 'instagram.com'],
      label: '首页逐帖按钮',
      hint: '首页每条帖子挂一颗小按钮；探索页与作品页不挂（那些由全局按钮负责）',
      legacyKey: null,
      defaultEnabled: true,
      appliesTo: 'buttons'
    }
  ];

  function byKey(key) {
    for (var i = 0; i < FEATURES.length; i++) {
      if (FEATURES[i].key === key) return FEATURES[i];
    }
    return null;
  }

  /** 设置页用：某个站点域名（主域名）下挂哪些功能 */
  function forDomain(domain) {
    var d = String(domain || '').toLowerCase();
    var out = [];
    for (var i = 0; i < FEATURES.length; i++) {
      var sites = FEATURES[i].sites;
      for (var j = 0; j < sites.length; j++) {
        if (sites[j].toLowerCase() === d) { out.push(FEATURES[i]); break; }
      }
    }
    return out;
  }

  /** 内容脚本用：当前主机名适用的功能 */
  function forHost(hostname) {
    var h = String(hostname || '').toLowerCase();
    var out = [];
    for (var i = 0; i < FEATURES.length; i++) {
      var sites = FEATURES[i].sites;
      for (var j = 0; j < sites.length; j++) {
        if (sites[j].toLowerCase() === h) { out.push(FEATURES[i]); break; }
      }
    }
    return out;
  }

  /** 所有旧键名（内容脚本一次读取时用） */
  function legacyKeys() {
    var out = [];
    for (var i = 0; i < FEATURES.length; i++) {
      if (FEATURES[i].legacyKey) out.push(FEATURES[i].legacyKey);
    }
    return out;
  }

  /**
   * 算出一个功能的真实开关状态。
   * @param {string} key
   * @param {Object} stored  storage.local.get() 的原始结果（含 config 与旧键）
   * @returns {boolean}
   *
   * 优先级：config.features[key] 是布尔 → 用它；否则看旧键 === false → 关；否则默认开。
   * 注意「缺省 = 开」：没设过、存储读失败，都按开处理，保证升级后原有行为不变。
   */
  function isEnabled(key, stored) {
    var f = byKey(key);
    if (!f) return true;

    var s = stored || {};
    var cfg = s.config || {};
    var feats = (cfg && typeof cfg.features === 'object' && cfg.features) ? cfg.features : null;

    if (feats && Object.prototype.hasOwnProperty.call(feats, key)) {
      return feats[key] !== false;
    }
    if (f.legacyKey && Object.prototype.hasOwnProperty.call(s, f.legacyKey)) {
      return s[f.legacyKey] !== false;
    }
    return f.defaultEnabled !== false;
  }

  /** 一次算完当前页所有功能 → { key: boolean } */
  function resolveAll(hostname, stored) {
    var list = forHost(hostname);
    var out = {};
    for (var i = 0; i < list.length; i++) {
      out[list[i].key] = isEnabled(list[i].key, stored);
    }
    return out;
  }

  var api = {
    FEATURES: FEATURES,
    byKey: byKey,
    forDomain: forDomain,
    forHost: forHost,
    legacyKeys: legacyKeys,
    isEnabled: isEnabled,
    resolveAll: resolveAll
  };

  global.ClipMateFeatures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
