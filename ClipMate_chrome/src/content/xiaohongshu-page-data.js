/**
 * 小红书页面数据桥（v2.6.0，跑在页面主世界 MAIN）
 *
 * 为什么需要它：content script 跑在**隔离世界**，读不到页面 JS 挂在 window 上的
 * `__INITIAL_STATE__`（这是 Chromium 的隔离机制，不是站点做的）。而小红书笔记的
 * 标题 / 正文 / 发布时间 / IP 属地都在那份内存数据里，DOM 反而被日期和属地污染
 * （实测 `.note-content` 的 textContent 是 `标题 + 正文 + 3小时前 内蒙古`）。
 *
 * 做法跟 TikTok 的 `tiktok-fiber-hook.js` 完全一致：
 *   主世界读数据 → 写进 `<script id="clipmate-xhs-note" type="application/json">` 的 textContent
 *   → 隔离世界读这个节点的文本。DOM 是两边都能碰的地方。
 *
 * 两条保命规矩（TikTok 那边踩出来的）：
 *   1. **必须带 urlId**：小红书弹层切条时，`noteDetailMap` 是累积的，旧笔记不会删。
 *      隔离世界只认 `urlId === 当前地址里的笔记ID` 的那份，否则就会用上一条的数据。
 *   2. **数据没就绪也要发一条 `note:null`**：告诉隔离世界「这条还没到」，
 *      比什么都不发安全 —— 什么都不发的话，隔离世界会一直拿着上一条。
 *
 * v2.7.16：桥上多挂一个**个人主页**节点 `clipmate-xhs-profile`（人物档案用）。
 * ⚠️ 只准读 `user.userPageData`（页面主人的档案），**绝不能读 `user.userInfo`** ——
 *    实测 2026-10-30：`userInfo` 是**当前登录者自己**（昵称「小衫.vava」、简介「还没有简介」），
 *    跟页面上显示的作者（王弈可）完全是两个人。拿它填档案 = 把用户隐私写进别人记录，
 *    这是快手 `/rest/v/profile/get` 那个坑的同款。桥里连一行都不碰 `userInfo`。
 */
(function() {
  'use strict';

  if (window.__clipmateXhsBridge) return;
  window.__clipmateXhsBridge = true;

  var NODE_ID = 'clipmate-xhs-note';
  var PROFILE_NODE_ID = 'clipmate-xhs-profile';
  var POLL_MS = 250;

  /** 地址里的笔记 ID（列表页 / 搜索页 / 主页都取不到 → 返回 ''） */
  function noteIdFromUrl() {
    try {
      var m = String(location.href).match(
        /xiaohongshu\.com\/(?:explore|discovery\/item)\/([0-9a-f]{24})(?:[?#]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /** 地址里的作者 userId（个人主页 `/user/profile/<24位>`；别处取不到 → 返回 ''） */
  function profileIdFromUrl() {
    try {
      var m = String(location.href).match(
        /xiaohongshu\.com\/user\/profile\/([0-9a-fA-F]{24})(?:[?#\/]|$)/i
      );
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }

  /**
   * 拆 Vue 的响应式包装。
   * 小红书线上 `__INITIAL_STATE__` 有时是普通对象，有时某一层是 ref
   * （原始值在 `_rawValue` / `_value` 里）。不拆的话 `map[id]` 直接是 undefined，
   * 表现是「桥一直在发 note:null，提取永远回落 DOM」。
   */
  function unwrap(v) {
    if (!v || typeof v !== 'object') return v;
    if (v._rawValue && typeof v._rawValue === 'object') return v._rawValue;
    if (v._value && typeof v._value === 'object') return v._value;
    return v;
  }

  /**
   * 从页面内存里取某条笔记。取不到返回 null。
   * 只挑我们真正要用的字段，别把整份几百 KB 的对象塞进 DOM。
   */
  function readNote(id) {
    try {
      var s = window.__INITIAL_STATE__;
      if (!s || !s.note) return null;
      var noteBox = unwrap(s.note);
      var map = unwrap(noteBox.noteDetailMap);
      if (!map) return null;
      var entry = unwrap(map[id]);
      if (!entry) return null;
      var n = unwrap(entry.note) || entry;
      if (!n || typeof n !== 'object') return null;
      var u = unwrap(n.user) || {};
      return {
        // noteId 正常都有；万一哪天没了就用 map 的键（键本身就是笔记 ID）
        noteId: n.noteId ? String(n.noteId) : String(id),
        title: typeof n.title === 'string' ? n.title : '',
        desc: typeof n.desc === 'string' ? n.desc : '',
        time: typeof n.time === 'number' ? n.time : 0,
        lastUpdateTime: typeof n.lastUpdateTime === 'number' ? n.lastUpdateTime : 0,
        ipLocation: typeof n.ipLocation === 'string' ? n.ipLocation : '',
        type: typeof n.type === 'string' ? n.type : '',
        // 实测是嵌套的 `note.user.{userId,nickname}`；
        // 但为防哪天改成平铺，两种形态都认（TikTok 那边因为只认一种，作者字段整片空白过）
        userId: u.userId ? String(u.userId) : (n.userId ? String(n.userId) : ''),
        nickname: typeof u.nickname === 'string' ? u.nickname
          : (typeof n.nickname === 'string' ? n.nickname : '')
      };
    } catch (e) { return null; }
  }

  /**
   * 读**页面主人**的档案（只有个人主页 `/user/profile/<id>` 上才有）。取不到返回 null。
   *
   * 只挑要用的字段，别把整份几百 KB 的对象塞进 DOM。
   *
   * ⚠️ 数据源只认 `user.userPageData`：
   *   · `userPageData.basicInfo` = **页面主人**（王弈可 / 小红书号 631287077）
   *   · `user.userInfo`          = **当前登录者自己**（小衫.vava / 54960000…）
   * 后者一旦被取到，用户的昵称和简介就会被记到别人的档案里，是一级事故。
   * 所以这里从头到尾不出现 `userInfo` 这几个字母。
   */
  function readProfile() {
    try {
      var s = window.__INITIAL_STATE__;
      if (!s || !s.user) return null;
      var userBox = unwrap(s.user);
      var up = unwrap(userBox.userPageData);
      if (!up || typeof up !== 'object') return null;
      var basic = unwrap(up.basicInfo) || {};
      if (!basic.nickname && !basic.desc && !basic.redId) return null;

      // tags 实测是数组（0..n），也可能被 Vue 包一层；两种都认
      var tagsBox = unwrap(up.tags) || [];
      var tags = [];
      Object.keys(tagsBox).forEach(function (k) {
        var t = unwrap(tagsBox[k]);
        if (t && typeof t.name === 'string' && t.name) tags.push(t.name);
      });

      return {
        nickname: typeof basic.nickname === 'string' ? basic.nickname : '',
        redId: typeof basic.redId === 'string' ? basic.redId : '',
        // 完整简介：页面 `.user-desc` 在长简介时会显示不全，这份是站点给的全文
        desc: typeof basic.desc === 'string' ? basic.desc : '',
        ipLocation: typeof basic.ipLocation === 'string' ? basic.ipLocation : '',
        tags: tags
      };
    } catch (e) { return null; }
  }

  function publishTo(nodeId, payload) {
    try {
      var node = document.getElementById(nodeId);
      if (!node) {
        node = document.createElement('script');
        node.id = nodeId;
        node.type = 'application/json';
        // 挂 head 不一定成功（文档还没 head），兜底挂 documentElement
        (document.head || document.documentElement).appendChild(node);
      }
      var text = JSON.stringify(payload);
      // 内容没变就别碰 DOM，避免无意义的 mutation 触发页面的观察器
      if (node.textContent !== text) node.textContent = text;
    } catch (e) { /* 忽略 */ }
  }

  function publish(payload) { publishTo(NODE_ID, payload); }
  function publishProfile(payload) { publishTo(PROFILE_NODE_ID, payload); }

  /** 笔记桥：主页 / 列表页也要发一条 `note:null`，别让隔离世界拿着上一条 */
  function publishNoteTick() {
    try {
      var id = noteIdFromUrl();
      if (!id) {
        // 列表页 / 搜索页 / 主页：明确告诉隔离世界「当前没有笔记」
        publish({ urlId: '', note: null });
        return;
      }
      publish({ urlId: id, note: readNote(id) });
    } catch (e) { /* 忽略 */ }
  }

  /**
   * 主页桥：两条规矩跟笔记桥一致 ——
   *   带 `urlUserId`（换人时隔离世界能认出「这份不是当前这个人的」），
   *   数据没就绪也要发 `profile:null`（什么都不发 = 隔离世界一直拿着上一个人的）。
   */
  function publishProfileTick() {
    try {
      var uid = profileIdFromUrl();
      if (!uid) {
        // 不在个人主页 → 明确告诉隔离世界「当前没有档案」
        publishProfile({ urlUserId: '', profile: null });
        return;
      }
      publishProfile({ urlUserId: uid, profile: readProfile() });
    } catch (e) { /* 忽略 */ }
  }

  function tick() {
    publishNoteTick();
    publishProfileTick();
  }

  // 轮询而不是监听：noteDetailMap 是 Vue 的响应式对象，
  // 换条时属性是原地改的，没有可靠的 DOM 事件可以挂。250ms 一次，成本可忽略。
  setInterval(tick, POLL_MS);
  tick();
})();
