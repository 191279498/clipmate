/**
 * ModalManager 持久化模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  global.ModalPersistenceMixin = {

    async resetFieldOrder() {
    try {
      // 获取当前配置
      const response = await WBR.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.config) {
        const config = response.config;

        // 确保fieldOrder是对象类型
        if (!config.fieldOrder || typeof config.fieldOrder !== 'object') {
          config.fieldOrder = {};
        }

        // 获取媒体类型
        const mediaType = this.getMediaType() || 'general';

        // 清除特定媒体类型的字段顺序
        if (config.fieldOrder[mediaType]) {
          delete config.fieldOrder[mediaType];

          // 发送保存配置的消息
          await WBR.runtime.sendMessage({
            action: 'saveConfig',
            config: { fieldOrder: config.fieldOrder }
          });

          this.showMessage(`已清除${mediaType}类型的保存排序`);
        } else {
          this.showMessage(`没有找到${mediaType}类型的保存排序`, 'info');
        }
      }
    } catch (error) {
      console.error('重置字段顺序失败:', error);
      this.showMessage('重置字段顺序失败', 'error');
    }
    },

    async saveFieldMapping(oldFieldName, newFieldName) {
    try {
      // 获取当前配置
      const response = await WBR.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.config) {
        const config = response.config;

        // 初始化字段映射配置
        if (!config.fieldMappings) {
          config.fieldMappings = {};
        }

        const mappings = config.fieldMappings;

        // 1. 检查是否有映射指向旧字段名，如果有，需要更新这些映射
        for (const key in mappings) {
          if (mappings[key] === oldFieldName) {
            mappings[key] = newFieldName; // 更新间接映射
          }
        }

        // 2. 保存新的字段映射
        mappings[oldFieldName] = newFieldName;

        // 发送保存配置的消息
        await WBR.runtime.sendMessage({
          action: 'saveConfig',
          config: { fieldMappings: mappings }
        });
      }
    } catch (error) {
      console.error('保存字段映射失败:', error);
    }
    },

    async loadFieldMappings() {
    try {
      const response = await WBR.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.config && response.config.fieldMappings) {
        return response.config.fieldMappings;
      }
    } catch (error) {
      // 扩展上下文失效（reload 后 content script 仍在）是扩展生命周期正常现象，
      // 不影响功能——loadFieldMappings 默认返回 {} 即可优雅降级
      if (error.message && error.message.includes('Extension context invalidated')) {
      } else {
        console.error('加载字段映射失败:', error);
      }
    }
    return {};
    },

    getFinalFieldName(fieldName, mappings) {
    let currentName = fieldName;
    // 最多处理10层嵌套，避免无限循环
    let iterations = 0;

    while (mappings[currentName] && iterations < 10) {
      currentName = mappings[currentName];
      iterations++;
    }

    return currentName;
    },

    async applyFieldMappings() {
    // 获取媒体类型
    const mediaType = this.getMediaType();

    // 统一处理所有媒体类型的字段映射
    const mappings = await this.loadFieldMappings();
    if (Object.keys(mappings).length === 0) return;

    // 创建应用映射后的新数据对象
    const newData = {};
    const seenKeys = new Set();

    for (const key in this.data) {
      const finalKey = this.getFinalFieldName(key, mappings);

      // 确保不会覆盖已存在的字段
      if (!seenKeys.has(finalKey)) {
        newData[finalKey] = this.data[key];
        seenKeys.add(finalKey);
      }
    }

    // 更新字段顺序数组，确保使用最终映射的字段名
    const newFieldOrder = this.fieldOrder
      .map(field => this.getFinalFieldName(field, mappings))
      .filter((field, index, self) => self.indexOf(field) === index); // 去重

    // 更新数据和字段顺序
    this.data = newData;
    this.fieldOrder = newFieldOrder;
    },

    async saveFieldOrder() {
    try {
      // 获取当前配置
      const response = await WBR.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.config) {
        const config = response.config;

        // 确保fieldOrder是对象类型
        if (!config.fieldOrder || typeof config.fieldOrder !== 'object') {
          config.fieldOrder = {};
        }

        // 获取媒体类型，默认使用'general'类型
        const mediaType = this.getMediaType() || 'general';

        // 按媒体类型保存字段顺序
        config.fieldOrder[mediaType] = [...this.fieldOrder];

        // 发送保存配置的消息
        await WBR.runtime.sendMessage({
          action: 'saveConfig',
          config: { fieldOrder: config.fieldOrder }
        });
      }
    } catch (error) {
      console.error('保存字段顺序失败:', error);
    }
    },

    getMediaType() {
    try {
      // v2.5.78：先听数据自己的话。
      // 以前只按网址猜类型，而弹窗页的地址是 /jingxuan?modal_id=…、/search/x?modal_id=…、
      // /user/xxx?modal_id=… —— 一个都匹配不上 /video/，于是被当成 general，
      // 7 字段过滤失效，浮窗里冒出 15 行（影视类的「我的进度/标记时间」也混进来）。
      // 数据层早就算出类型了（社交数据必带 mediaType:'social'），有它就照它办。
      const data = this.data || {};
      if (data.mediaType === 'social' || data['影视类型'] === '社交媒体') {
        return 'social';
      }

      // 人物档案（v2.7.12）：数据层已经算出来了（PersonFieldsBuilder.build 必带 mediaType:'person'）。
      // **必须排在 URL 判断之前** —— 影人页 / 抖音作者主页在下面那张 URL 表里一条都不匹配，
      // 会一路落到「按数据推断」再落到 general，浮窗就按 general 渲染：
      // person 的 12 列并集骨架 + 4 个进度字段 = 20 行，用户看到的是半屏空行。
      if (data.mediaType === 'person') {
        return 'person';
      }

      // 从页面URL判断媒体类型
      const url = window.location.href.toLowerCase();
      // 社交媒体类型 - 抖音
      if (url.includes('douyin.com/video/') || url.includes('v.douyin.com/') || url.includes('douyin.com/note/')) {
        return 'social';
      }
      // 社交媒体类型 - 快手
      if (url.includes('kuaishou.com/short-video/') || url.includes('kuaishou.com/video/')) {
        return 'social';
      }
      // 社交媒体类型 - 小红书
      if (url.includes('xiaohongshu.com/discovery/item/') || url.includes('xiaohongshu.com/explore/')) {
        return 'social';
      }
      // 社交媒体类型社交媒体类型 - Instagram
      if (url.includes('www.instagram.com/')) {
        return 'social';
      }
      // 人物档案 - 微博个人主页 `/u/<数字uid>`、`/<自定义域名>`（v2.7.26）。
      // **必须排在下面那条 `weibo.com/` -> social 之前**：主页地址同样含 `weibo.com/`，
      // 顺序反了主页永远判成社交（浮窗按 7 列渲染，6 列档案全乱）。
      // 判据与 media-detector / extractor-factory 同一口径：`/u/<uid>/<mid>` 单条微博
      // 不匹配这里，继续走下面的 social。
      if (url.includes('weibo.com/')) {
        const wbPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        if (/^\/u\/\d{5,20}\/?$/.test(wbPath)) {
          return 'person';
        }
        if (/^\/(?!(?:u|n|p|tv|ajax|api|detail|hot|search|login|signup|reg|newlogin|verify|setting|settings|message|at|my|help|about|ttarticle|fav|like|comment|comments|repost|friend|profile|index|home)(?:\/|$))[A-Za-z][A-Za-z0-9_-]{1,29}\/?$/.test(wbPath)) {
          return 'person';
        }
      }
      // 社交媒体类型 - 微博
      if (url.includes('www.weibo.com/') || url.includes('weibo.com/')) {
        return 'social';
      }
      // 社交媒体类型 - 微博移动版
      if (url.includes('m.weibo.cn/')) {
        return 'social';
      }
      // 社交媒体类型 - 推特(X)
      // 人物档案 - X 个人主页 `/<handle>` 与 `/<handle>/about`（v2.7.27）。
      // **必须排在下面那条 `x.com/` -> social 之前**：主页地址同样含 `x.com/`，
      // 顺序反了主页永远判成社交（浮窗按 7 列渲染，6 列档案全乱）。
      // 判据与 media-detector / extractor-factory 同一口径：`/<handle>/status/<id>`
      // 单条推文与 `/home` 等功能路由不匹配这里，继续走下面的 social。
      if (url.includes('x.com/') || url.includes('www.x.com/')) {
        const xPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        if (/^\/[A-Za-z0-9_]{1,15}\/?(?:\/about)?$/.test(xPath)) {
          const xReserved = /^(?:home|explore|search|i|settings|notifications|messages|compose|intent|personalize|privacy|tos|login|signup|logout|session|account|share|hashtag|trends|dev|jobs|help|welcome|verify|flow|articles|events|browse)$/;
          const first = xPath.replace(/^\//, '').split('/')[0];
          if (first && !xReserved.test(first.toLowerCase())) {
            return 'person';
          }
        }
      }
      if (url.includes('x.com/') || url.includes('www.x.com/')) {
        return 'social';
      }
      // 人物档案 - TikTok 个人主页 `/@<handle>`（v2.7.22）。
      // **必须排在下面那条 `tiktok.com/` -> social 之前**：主页地址同样含 `tiktok.com/`，
      // 顺序反了主页永远判成社交（浮窗按 7 列渲染，6 列档案全乱）。
      // 判据与 media-detector / extractor-factory 同一口径：`@` 后**只有一段账号名**，
      // `/@user/video/<id>`、`/@user/photo/<id>` 仍是作品页（继续走下面的 social）。
      if (url.includes('tiktok.com/@')) {
        const tkPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        if (/^\/@[A-Za-z0-9_.]{2,40}\/?$/.test(tkPath)) {
          return 'person';
        }
      }
      // 社交媒体类型 - TikTok
      if (url.includes('tiktok.com/') || url.includes('www.tiktok.com/')) {
        return 'social';
      }
      // 人物档案 - YouTube 频道页 `/@<handle>`、`/channel/UC…`（v2.7.23）。
      // **必须排在下面那条 `youtube.com/` -> social 之前**：频道页地址同样含
      // `youtube.com/`，顺序反了主页永远判成社交（浮窗按 7 列渲染，6 列档案全乱）。
      // 判据与 media-detector / extractor-factory 同一口径（含频道子页 /videos、/about 等），
      // `/watch`、`/shorts/<id>` 不匹配这里，继续走下面的 social。
      if (url.includes('youtube.com/')) {
        const ytPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        const YT_SUB = '(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search)';
        if (new RegExp('^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/' + YT_SUB + ')?/?$').test(ytPath)) {
          return 'person';
        }
      }
      // 社交媒体类型 - YouTube
      if (url.includes('youtube.com/') || url.includes('www.youtube.com/')) {
        return 'social';
      }
      // 社交媒体类型 - B站
      // 人物档案 - B站个人空间 space.bilibili.com/<mid>（v2.7.28，含空间自己的 tab 子页）。
      // **必须排在下面那条 B站 social 之前**：space 是新域名，地址里没有 /video/，
      // 但 URL 兜底只看字符串，这里显式放行 person 再落到 social，避免 6 列档案被按 7 列渲染。
      if (url.includes('space.bilibili.com/')) {
        const biliPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        if (/^\/\d{1,15}(?:\/(?:dynamic|upload|lists|pugv|series|channels|favlist|following|fans|article|audio|album|comic|bangumi|cheese|video))?\/?$/.test(biliPath)) {
          return 'person';
        }
      }
      if (url.includes('bilibili.com/video/') || url.includes('www.bilibili.com/video/') ||
          url.includes('bilibili.com/bangumi/play/') || url.includes('www.bilibili.com/bangumi/play/')) {
        return 'social';
      }
      // 人物档案类型检测（v2.7.12）
      // 这里是 URL 兜底：数据被 _prepareData 裁成 12/6 列后 mediaType 就不在 data 里了，
      // 就地重渲染（modal-manager 那套）再取类型时只剩 URL 可看。
      // 豆瓣影人页：`www.douban.com/personage/<数字>/`（旧 movie.douban.com/celebrity/ 已 301）
      if (url.includes('www.douban.com/personage/')) {
        return 'person';
      }
      // 抖音作者主页：`/user/<sec_uid>`。**作品弹窗不算**（弹窗地址是 /user/xxx?modal_id=…，
      // 那是作品记录，仍是 social，由上面那条 social 规则或数据自己声明）
      if (url.includes('douyin.com/user/') && !url.includes('modal_id=')) {
        return 'person';
      }
      // 小红书个人主页：`/user/profile/<userId>`（v2.7.16）。
      // 与作品页 `/explore/<笔记ID>` 路径前缀不重叠，不需要排除 query，
      // 但要**排在「按数据推断」之前**，否则会落到 general 渲染出半屏空行。
      if (url.includes('xiaohongshu.com/user/profile/')) {
        return 'person';
      }
      // 快手个人主页：`/profile/<userId>`（v2.7.17）。
      // 与作品页 `/short-video/<id>` 前缀不重叠。
      // ⚠️ 主页上点开作品弹层时地址不变（还是 /profile/<id>），那种情况本函数会判成 person，
      //    但那一条记录是**作品数据**（12/6 列之外），由数据自带的 mediaType 先判，
      //    走不到这个 URL 兜底 —— 两者不冲突。
      if (url.includes('kuaishou.com/profile/')) {
        return 'person';
      }
      // Instagram 个人主页：单段路径 `/<username>/`（v2.7.20）。
      // **必须排在下面那条 `www.instagram.com/` -> social 之前**，否则主页永远判成社交（浮窗按 7 列渲染，6 列档案全乱）。
      // 判据与 entry-context / extractor-factory 同一口径：单段 + 排除 IG 一级功能路由；
      // `/p/<code>/`、`/<user>/reels/`、`/stories/...` 这些多段路径不是主页，继续走 social。
      if (url.includes('instagram.com/')) {
        const igPath = (() => { try { return new URL(window.location.href).pathname; } catch (e) { return ''; } })();
        if (/^\/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)\/?$)[A-Za-z0-9_.]+\/?$/.test(igPath)) {
          return 'person';
        }
      }


      // 书籍类型检测
      // 注意：bgm.tv / bangumi.tv / chii.in 的所有条目共用 /subject/<id>，URL 里没有 book/game
      // 字样，靠 URL 分不出来，所以这三站不在这里判断，交给下面「按数据推断」。
      // （旧写法 `url.includes('bgm.tv/subject/') && url.includes('book')` 因 && 优先级
      //   恒不成立，属于死条件，已删除。）
      if (url.includes('book.douban.com') || url.includes('www.qidian.com') || url.includes('fanqienovel.com') || url.includes('www.17k.com') || url.includes('www.goodreads.com')) {
        return 'book';
      }
      // 影视类型检测
      // v2.11.0：红果短剧全站固定是「剧集」，不走下面「有集数才判 tv」的推断 ——
      // 它的字段表本来就是 tv 那份，推断只会让话题多绕一圈。
      if (url.includes('hongguoduanju.com') || url.includes('novelquickapp.com')) {
        return 'tv';
      }
      if (url.includes('movie.douban.com') || url.includes('www.imdb.com') || url.includes('www.themoviedb.org')) {
        // 对于电影网站，进一步判断是否为电视剧
        if (this.data && (this.data['集数'] || this.data['单集片长'])) {
          // 如果数据中包含集数或单集片长，判断为电视剧
          return 'tv';
        }
        return 'movie';
      }
      // 游戏类型检测（豆瓣游戏有两个入口：www.douban.com/game/ 和 game.douban.com/subject/，
      // 后者之前没列进来，只能指望下面按数据推断兜；这里补上域名，判断更直接。）
      if (url.includes('store.steampowered.com') || url.includes('www.douban.com/game/') || url.includes('game.douban.com') || url.includes('www.metacritic.com/game/') || url.includes('www.xiaoheihe.cn/app/topic/game/') || url.includes('www.mobygames.com/game/')) {
        return 'game';
      }
      // 如果无法判断，尝试从数据内容推断
      if (this.data) {
        const dataKeys = Object.keys(this.data).map(key => key.toLowerCase());
        if (dataKeys.includes('isbn') || dataKeys.includes('作者') || dataKeys.includes('书名')) {
          return 'book';
        } else if (dataKeys.includes('导演') || dataKeys.includes('演员')) {
          // 进一步判断是否为电视剧
          if (dataKeys.includes('集数') || dataKeys.includes('单集片长') || this.data['影视类型'] === '电视剧') {
            return 'tv';
          }
          return 'movie';
        } else if (dataKeys.includes('开发商') || dataKeys.includes('发行商') || dataKeys.includes('游戏名')) {
          // 「游戏名」是番组计划(游戏)/豆瓣游戏 的字段名，用来兜住 URL 分不出类型的条目页
          return 'game';
        }
      }
    } catch (error) {
      console.error('获取媒体类型失败:', error);
    }
    return 'general';
    },

    async applyFieldOrder() {
    try {
      // 获取媒体类型
      const mediaType = this.getMediaType();

      // 统一处理所有媒体类型的字段顺序
      const response = await WBR.runtime.sendMessage({ action: 'getConfig' });
      if (response && response.config && response.config.fieldOrder) {
        const configFieldOrder = response.config.fieldOrder;
        const mappings = await this.loadFieldMappings();

        // 获取媒体类型，默认使用'general'类型
        const finalMediaType = mediaType || 'general';

        // 尝试获取特定媒体类型的排序，如果没有则尝试获取通用排序
        let savedOrder = null;
        if (typeof configFieldOrder === 'object' && configFieldOrder !== null && !Array.isArray(configFieldOrder)) {
          // 新的对象格式，按媒体类型存储
          savedOrder = configFieldOrder[finalMediaType] || configFieldOrder['general'] || null;
        } else if (Array.isArray(configFieldOrder)) {
          // 兼容旧的数组格式
          savedOrder = configFieldOrder;
        }

        // 如果有保存的排序，则应用它
        if (Array.isArray(savedOrder)) {

          // 创建新的字段顺序
          const newFieldOrder = [];
          const remainingFields = [...this.fieldOrder];

          // 为保存的字段顺序中的每个字段，找到其最终映射的名称
          const mappedSavedOrder = savedOrder.map(field => this.getFinalFieldName(field, mappings));

          // 优先使用保存的顺序中的字段（考虑映射后的名称）
          mappedSavedOrder.forEach(field => {
            const index = remainingFields.indexOf(field);
            if (index !== -1) {
              newFieldOrder.push(field);
              remainingFields.splice(index, 1);
            }
          });

          // 添加剩余的字段
          newFieldOrder.push(...remainingFields);

          // 更新字段顺序
          this.fieldOrder = newFieldOrder;
        } else {
        }
      }
    } catch (error) {
      if (error.message && error.message.includes('Extension context invalidated')) {
      } else {
        console.error('应用字段顺序失败:', error);
      }
    }
    },

  };
})(window);

// ModalManager 已定义后应用 Mixin
if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalPersistenceMixin);
}
