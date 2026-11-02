/**
 * 社交站点显示名与形态词表（v2.5.98）
 *
 * 用途只有一个：**「本页文案」抓不到时填什么**。
 *
 * 用户定的规矩（2026-10-29）：
 *   某条文案是空的，就默认填当前提取器的名称 —— TikTok 视频页面 → `TikTok视频`；
 *   TikTok 图文页 → `TikTok图文`；其他网站同此策略。
 *   书 / 影 / 游的「简介」不在范围内，为空仍为空。
 *
 * 为什么单独一张表
 * ----------------
 * 站点名和「视频 / 图文」的叫法各站不一样（小红书叫笔记、微博叫博文、X 叫推文、
 * Instagram 叫帖子、B站专栏叫专栏），把词放在这里，以后加站点只改这张表，
 * 不碰 `social-fields-builder.js` 的逻辑。
 *
 * 两个词的含义
 * ------------
 *   video —— 视频 / 默认那一档（拿不准形态时也用这个）
 *   alt   —— 「不是视频」那一档：TikTok / 抖音 / 快手是「图文」，B站是「专栏」；
 *            小红书 / 微博 / X / Instagram 两档同词（本来就不分形态）。
 *
 * 不在表里的站点（`unknown`、老站、以后新加的）一律返回空串 —— **不硬凑**，
 * 宁可留空，也不要写一个不认识的站名进去。
 *
 * 主页不是单独一档（用户 2026-10-29 明确）：主页简介为空时跟作品同样处理，
 * 落回 `video` 那一档，例如 `TikTok视频`。
 */
(function (global) {
  'use strict';

  /** 站点 → { 站名, 视频档, 非视频档 } */
  var SITE_TABLE = {
    tiktok_social:        { name: 'TikTok',    video: '视频', alt: '图文' },
    douyin_social:        { name: '抖音',      video: '视频', alt: '图文' },
    kuaishou_social:      { name: '快手',      video: '视频', alt: '图文' },
    xiaohongshu_social:   { name: '小红书',    video: '笔记', alt: '笔记' },
    weibo_social:         { name: '微博',      video: '博文', alt: '博文' },
    weibo_mobile_social:  { name: '微博',      video: '博文', alt: '博文' },
    x_social:             { name: 'X',         video: '推文', alt: '推文' },
    bilibili_social:      { name: '哔哩哔哩',  video: '视频', alt: '专栏' },
    youtube_social:       { name: 'YouTube',   video: '视频', alt: '视频' },
    instagram_social:     { name: 'Instagram', video: '帖子', alt: '帖子' }
  };

  /**
   * 取一个站点的词条
   * @param {string} site - sourceSite，例如 `tiktok_social`
   * @returns {{name:string, video:string, alt:string}|null}
   */
  function get(site) {
    if (!site) return null;
    var entry = SITE_TABLE[String(site)];
    if (!entry) return null;
    return { name: entry.name, video: entry.video, alt: entry.alt };
  }

  /**
   * 拼兜底文案
   *
   * @param {string} site - sourceSite
   * @param {string} [shape] - `'photo'` 表示非视频那一档；其余（含空）走 video 档
   * @returns {string} 例如 `TikTok视频`；不认识站点返回空串
   */
  function labelFor(site, shape) {
    var entry = get(site);
    if (!entry) return '';
    var word = (String(shape || '') === 'photo') ? entry.alt : entry.video;
    if (!word) return '';
    return entry.name + word;
  }

  var api = {
    SITE_TABLE: SITE_TABLE,
    get: get,
    labelFor: labelFor
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.SocialSiteNames = api;
  }
})(typeof window !== 'undefined' ? window : null);
