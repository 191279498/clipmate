/**
 * Media type data processors
 * Extracted from content-main.js MediaExtractor class
 */

(function(global) {
  'use strict';

  const P = {};

  P.processBookData = async function(data) {
    // 处理书名
    if (data['书名']) {
      const titleResult = await this.titleProcessor.processBookTitle(
        data['书名'],
        data['原作名']
      );

      data['书名'] = titleResult.title;
    }

    // 处理作者信息
    if (data['作者']) {
      data['作者'] = this.processAuthorNames(data['作者']);
    }

    // 处理日期格式
    if (data['发布日期']) {
      data['发布日期'] = this.formatDate(data['发布日期']);
    }

    // 处理ISBN格式
    if (data['ISBN']) {
      data['ISBN'] = this.formatISBN(data['ISBN']);
    }

    // 统一处理豆瓣链接字段
    this.ensureDoubanLink(data);
  }

  // 提取最早的上映日期

  P.processMovieData = async function(data) {

    try {
      // 处理电影名
      if (data['名字']) {
        data['名字'] = this.cleanMovieTitle(data['名字']);
      }

      // 处理制作人员 - 只在字段未验证通过时才进行处理
      if (data['导演']) {
        // 检查是否已经通过豆瓣验证（包含完整演职员信息）
        const hasVerifiedDirector = data['导演'].includes(' ') || data['导演'].includes('　') ||
                                   (data['导演'].length > 0 && data['导演'].length < 10);
        if (!hasVerifiedDirector) {
          data['导演'] = this.processCrewNames(data['导演']);
        } else {
        }
      }
      if (data['编剧']) {
        // 检查是否已经通过豆瓣验证（包含完整演职员信息）
        const hasVerifiedWriter = data['编剧'].includes(' ') || data['编剧'].includes('　') ||
                                 (data['编剧'].length > 0 && data['编剧'].length < 10);
        if (!hasVerifiedWriter) {
          data['编剧'] = this.processCrewNames(data['编剧']);
        } else {
        }
      }
      if (data['主演']) {
        // 检查是否已经通过豆瓣验证（包含完整演职员信息）
        const hasVerifiedActor = data['主演'].includes(' ') || data['主演'].includes('　') ||
                                (data['主演'].length > 0 && data['主演'].length < 10);
        if (!hasVerifiedActor) {
          data['主演'] = this.processCrewNames(data['主演']);
        } else {
        }
      }

      // 处理上映日期 - 先提取最早日期，再格式化
      if (data['上映日期']) {
        const originalDate = data['上映日期'];

        // 确保传入字符串类型
        const dateToProcess = originalDate.toString().trim();

        const earliestDate = this.extractEarliestReleaseDate(dateToProcess);


        const formattedDate = this.formatDate(earliestDate);

        data['上映日期'] = formattedDate;
      }

      // 处理片长格式
      if (data['片长']) {
        data['片长'] = this.formatRuntime(data['片长']);
      }

      // 设置影视类型为电影
      if (!data['影视类型']) {
        data['影视类型'] = '电影';
      }

      // 统一处理豆瓣链接字段
      this.ensureDoubanLink(data);

    } catch (error) {
      console.error('处理电影数据时出错:', error);
      // 即使出错也要确保基本字段存在，避免后续处理崩溃
    }
  }


  P.processGameData = async function(data) {
    // 处理游戏名
    if (data['游戏名']) {
      data['游戏名'] = this.cleanGameTitle(data['游戏名']);
    }

    // 如果有旧的'名字'字段，转换为'游戏名'
    if (data['名字'] && !data['游戏名']) {
      data['游戏名'] = this.cleanGameTitle(data['名字']);
      delete data['名字'];
    }

    // 处理发行日期
    if (data['发行日期']) {
      data['发行日期'] = this.formatDate(data['发行日期']);
    }

    // 处理平台信息
    if (data['平台']) {
      data['平台'] = this.formatPlatforms(data['平台']);
    }

    // 确保'Steam'字段使用正确的名称
    if (data['steam'] && !data['Steam']) {
      data['Steam'] = data['steam'];
      delete data['steam'];
    }

    // 统一处理豆瓣链接字段
    this.ensureDoubanLink(data);
  }

  // 处理电视剧数据

  P.processTvData = async function(data) {

    try {
      // 使用专门的电视剧处理逻辑，不再复用电影处理逻辑以避免字段冲突

      // 处理名字字段
      if (data['名字']) {
        data['名字'] = this.cleanMovieTitle(data['名字']);
      }

      // 处理上映日期 - 先提取最早日期，再格式化
      if (data['上映日期']) {
        const earliestDate = this.extractEarliestReleaseDate(data['上映日期']);
        data['上映日期'] = this.formatDate(earliestDate);
      }

      // 处理评分
      if (data['网络评分']) {
        data['网络评分'] = this.formatRating(data['网络评分']);
      }

      // 处理导演字段
      if (data['导演']) {
        data['导演'] = this.processCrewNames(data['导演']);
      }

      // 处理编剧字段
      if (data['编剧']) {
        data['编剧'] = this.processCrewNames(data['编剧']);
      }

      // 处理主演字段
      if (data['主演']) {
        data['主演'] = this.processCrewNames(data['主演']);
      }

      // 电视剧特定处理：保留片长字段，正常处理单集片长
      if ('单集片长' in data && data['单集片长']) {
        // 格式化单集片长
        data['单集片长'] = this.formatRuntime(data['单集片长']);
        // 保留片长字段，不再删除
        if ('片长' in data) {
          data['片长'] = this.formatRuntime(data['片长']);
        }
      } else if ('片长' in data && data['片长']) {
        // 如果没有单集片长但有片长，将片长值移到单集片长字段，同时保留片长字段
        data['单集片长'] = this.formatRuntime(data['片长']);
        data['片长'] = this.formatRuntime(data['片长']);
      } else {
        // 如果两个字段都不存在，确保它们都有空值而不是被删除
        if (!('片长' in data)) {
          data['片长'] = '';
        }
        if (!('单集片长' in data)) {
          data['单集片长'] = '';
        }
      }

      // 确保集数字段存在
      if (!('集数' in data) || !data['集数']) {
        data['集数'] = '';
      } else {
        // 清理集数字段，去除多余字符
        if (typeof data['集数'] === 'string') {
          data['集数'] = data['集数'].replace(/[^\d-]/g, '').trim();
        }
      }

      // 设置影视类型为剧集
      if (!data['影视类型']) {
        data['影视类型'] = '剧集';
      }


      // 统一处理豆瓣链接字段
      this.ensureDoubanLink(data);

    } catch (error) {
      console.error('处理电视剧数据时出错:', error);
      // 即使出错也要确保基本字段存在，避免后续处理崩溃
      if (!data['单集片长'] && data['片长']) {
        data['单集片长'] = data['片长'];
      }
      if (!data['集数']) {
        data['集数'] = '';
      }
    }
  }


  /**
   * 这条数据是不是「人物档案」记录（影人 12 列 / 社交账号 6 列）
   *
   * 为什么按数据内容判断、不按 mediaType 传参：`processCommonFields` 有两个调用点，
   * 其中「弹窗前清理」（content-main.handleExtract）那处作用域里**没有** mediaType。
   * 用键集合判断两个调用点都成立，以后再加调用点也不用改签名。
   *
   * 判据：所有键都落在人物字段表里。人物列名只认 media-types.js 的单一权威源
   * （影人 ∪ 账号两套并集）。影视/书籍/游戏/社交的键远超这十几列，整条落进来不可能的 ——
   * 判错的结果只会是「退回旧行为」，不会把别的类型当人物处理。
   */
  /**
   * 装配器（PersonFieldsBuilder.build）会往人物记录上挂三个**元字段**：
   * `mediaType` / `personKind` / `sourceSite`。它们不是任何一列，但 cleanFields
   * 只过滤空值、不过滤键，所以会一路跟着数据走到 processCommonFields。
   *
   * 判「键集合是否全落在人物列里」时必须先跳过它们 —— 否则每条人物记录都带着
   * 人物列里不存在的 mediaType，一律被判成「非人物」，简介被 truncateText 砍在 500 字。
   * v2.7.34 真机修：抖音主页简介正好 500 + 「...」，就是这个漏键造成的（v2.7.15 起一直如此）。
   */
  var META_KEYS = { mediaType: true, personKind: true, sourceSite: true };

  /**
   * v2.8.2：读「简介上限」这一项。
   * 值由 content-main 的 refreshConfig 挂在 MediaExtractor.prototype.descLimits 上，
   * 各站点提取器实例经原型链拿到同一份。没配 / 脏值 → fallback 就是搬进设置页之前的
   * 硬编码值（50000 / 5000 / 500），保证默认配置下输出与 v2.8.1 逐字节一致。
   * 0 或负数 = 不限制（设置页的提示语承诺过），这里换成一个足够大的上限。
   */
  function descLimit(owner, key, fallback) {
    var box = owner && owner.descLimits;
    if (!box) return fallback;
    var v = parseInt(box[key], 10);
    if (isNaN(v)) return fallback;
    return v <= 0 ? Number.MAX_SAFE_INTEGER : v;
  }

  /** 只取「列」的键（跳过装配器元字段） */
  function columnKeys(data) {
    var allKeys = Object.keys(data);
    var out = [];
    for (var i = 0; i < allKeys.length; i++) {
      if (META_KEYS[allKeys[i]] === true) continue;
      out.push(allKeys[i]);
    }
    return out;
  }

  function isPersonRecord(data) {
    if (!data || typeof data !== 'object') return false;

    var cfg = global && global.mediaTypesConfig;
    if (!cfg || typeof cfg.getPersonFieldList !== 'function' || !cfg.PERSON_KINDS) return false;

    var allow = {};
    var lists = [
      cfg.getPersonFieldList(cfg.PERSON_KINDS.CELEBRITY),
      cfg.getPersonFieldList(cfg.PERSON_KINDS.ACCOUNT)
    ];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i] || [];
      for (var j = 0; j < list.length; j++) allow[list[j]] = true;
    }

    var keys = columnKeys(data);
    if (!keys.length) return false;
    for (var k = 0; k < keys.length; k++) {
      if (!allow[keys[k]]) return false;
    }
    return true;
  }

  /**
   * 这条数据是不是「社交账号」档案（account 6 列）
   *
   * 为什么也要按键集合判断、不传 mediaType：理由同上（弹窗前清理那个调用点拿不到 mediaType）。
   * 判据：所有键都落在账号清单里。影人 12 列里的 姓名 / 别名 / 性别 / 出生日期 … 账号表里没有，
   * 只要出现一个就落在「影人」那侧 —— 所以这里判错的方向只会是「账号被当成影人」，
   * 也就是退回 5000 字的老行为，不会把影人当成账号去无限放长。
   */
  function isAccountRecord(data) {
    if (!data || typeof data !== 'object') return false;

    var cfg = global && global.mediaTypesConfig;
    if (!cfg || typeof cfg.getPersonFieldList !== 'function' || !cfg.PERSON_KINDS) return false;

    var list = cfg.getPersonFieldList(cfg.PERSON_KINDS.ACCOUNT) || [];
    if (!list.length) return false;

    var allow = {};
    for (var i = 0; i < list.length; i++) allow[list[i]] = true;

    var keys = columnKeys(data);
    if (!keys.length) return false;
    for (var k = 0; k < keys.length; k++) {
      if (!allow[keys[k]]) return false;
    }
    return true;
  }

  P.processCommonFields = function(data) {
    // 处理评分格式
    if (data['网络评分']) {
      data['网络评分'] = this.formatRating(data['网络评分']);
    }

    // 处理简介长度
    if (data['简介']) {
      // 人物档案的「简介」是**主字段**，不是附注：抖音作者签名真机实测 575 字
      // （三项统计 + 4 个 @ 链接）。按 500 字硬切会砍掉后半句，而且切在 URL 中间，
      // 浮窗里露出半截 Markdown，看着就是「提取不完整」（v2.7.15 修）。
      // 其他类型维持 500 —— 影视 / 书籍的简介是附注，不该占版面。
      var richTruncate = global.DataFormatters && global.DataFormatters.truncateRichText;
      if (isPersonRecord(data) && typeof richTruncate === 'function') {
        // 社交账号（account 6 列）的「简介」v2.7.33 起解除字数限制（用户 2026-11-01 定）：
        // 50000 只是防炸上限 —— 万一哪天页面改版把整页正文当简介抓进来，不至于把浮窗和导出撑爆；
        // 正常签名几千字永远碰不到这个数，体感就是「不限制」。
        // 影人（celebrity 12 列）维持 5000：豆瓣影人简介动辄几千字，仍按版面考虑（同一次拍板）。
        // v2.8.2：这三个数改为设置页「内容」组里的可配项，默认值与上面这段完全一致。
        data['简介'] = richTruncate(data['简介'], isAccountRecord(data)
          ? descLimit(this, 'social', 50000)
          : descLimit(this, 'person', 5000));
      } else {
        // v2.8.2：其他类型（影视 / 书籍 / 游戏）的附注简介上限，同样可配
        data['简介'] = this.truncateText(data['简介'], descLimit(this, 'other', 500));
      }
    }

    // 处理"其他信息"字段 - 简化版格式化
    if (data['其他信息']) {
      // 详细日志记录

      // 简单的格式化处理
      let otherInfo = data['其他信息'];

      // 如果是对象类型，转换为字符串
      if (typeof otherInfo === 'object' && otherInfo !== null) {
        const parts = [];
        for (const [key, value] of Object.entries(otherInfo)) {
          if (value && value.toString().trim() !== '') {
            parts.push(`${key}：${value.toString().trim()}`);
          }
        }
        otherInfo = parts.join('，');
      }

      // 标准化分隔符
      otherInfo = otherInfo.toString().replace(/[,，]/g, '，').replace(/\s+/g, ' ').trim();

      // 移除多余的分隔符
      otherInfo = otherInfo.replace(/，+/g, '，');

      // 更新数据
      data['其他信息'] = otherInfo;

      // 日志输出
      if (otherInfo.length > 100 && otherInfo.includes('，')) {
        const parts = otherInfo.split('，');
        parts.forEach((part, index) => {
        });
      } else {
      }
    }
  }

  /**
   * 统一处理「豆瓣」→「豆瓣链接」字段迁移 + URL 有效性校验
   * 被 processBookData / processMovieData / processGameData / processTvData 复用
   */

  P.ensureDoubanLink = function(data) {
    // 步骤 1：旧的'豆瓣'字段 → '豆瓣链接'
    if (data['豆瓣']) {
      if (!data['豆瓣链接'] || data['豆瓣链接'].trim() === '' || !this.isDoubanUrl(data['豆瓣链接'])) {
        data['豆瓣链接'] = data['豆瓣'];
      }
      delete data['豆瓣'];
    }

    // 步骤 2：确保豆瓣链接字段只包含豆瓣域名的链接
    if (!data['豆瓣链接'] || data['豆瓣链接'].trim() === '' || !this.isDoubanUrl(data['豆瓣链接'])) {
      if (this.isDoubanUrl(window.location.href)) {
        data['豆瓣链接'] = window.location.href;
      } else {
        data['豆瓣链接'] = '';
      }
    }
  }


  P.processSocialData = function(data) {

    // 清理标题中的特殊字符和表情符号
    if (data['本页标题']) {
      data['本页标题'] = this.cleanSocialTitle(data['本页标题']);
    }

    // 格式化作者昵称，移除特殊字符
    if (data['作者昵称']) {
      data['作者昵称'] = this.cleanAuthorName(data['作者昵称']);
    }

    // 标准化日期格式（支持多种社交媒体日期格式）
    // v2.5.78：删掉原来那张「哪个站显示到分/到秒」的写死表。
    // 精度改由**源数据自己**决定：源到秒就显示秒、到分就显示分、只有日就只显示日，
    // 绝不补 00:00 —— 否则弹窗页只有日期时会凭空长出假时间。
    if (data['发布日期']) {
      data['发布日期'] = this.formatSocialDate(data['发布日期']);
    }

    // 🔧 修复：确保URL字段始终有值，即使原始数据为空
    if (!data['URL'] || data['URL'].trim() === '') {
      data['URL'] = window.location.href;
    } else {
      // 验证和清理URL，确保完整性
      data['URL'] = this.validateSocialUrl(data['URL']);
    }

    // 设置媒体类型标识
    data['影视类型'] = '社交媒体';

    // 添加平台标识（从sourceSite获取）
    if (data['sourceSite']) {
      data['平台'] = this.getPlatformName(data['sourceSite']);
    }

    return data;
  }

  /**
   * 清理社交媒体标题
   * 移除表情符号、话题标签和@提及，支持各种语言文字
   */

  global.DataProcessors = P;
})(window);
