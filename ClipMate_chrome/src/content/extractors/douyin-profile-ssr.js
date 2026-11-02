/**
 * 抖音主页「完整签名」解析（v2.7.14）
 *
 * 为什么不能用页面文本
 * -------------------
 * 抖音作者主页的签名在页面上是**截断显示**的：长签名只渲染前几十个字，末尾补 `...`
 * 再加一个「更多」按钮。真机实测（2026-10-30）：
 *
 *   闺蜜@𝓯𝓻𝓮ᴺʸཨོོཾ安眠曲.(蜜鞠)  不会找别的闺...更多
 *
 * 后半句「不会找别的闺蜜 / 徒弟：@四叶草. / 永远的神：@鞠婧祎 …」全都读不到。
 *
 * **不去点那个「更多」**：点击是一次真实行为（埋点、可能触发接口），在风控语境下多做一次
 * 没收益的动作就是给自己加风险分。而且点开也未必是全量 —— 它是渲染态。
 *
 * 数据在哪
 * --------
 * 抖音是 React Server Components（`__pace_f`）渲染，首次加载把用户数据整段塞在内联
 * `<script>` 里，形如：
 *
 *   self.__pace_f.push([1,"8:[\"$\",\"$La\",null,{\"user\":{\"user\":{\"uid\":\"…\",
 *     \"secUid\":\"…\",\"nickname\":\"恨海情天.\",\"desc\":\"<完整签名>\",
 *     \"descExtra\":[{\"start\":2,\"end\":22,\"type\":0,\"secUid\":\"…\",\"userId\":\"…\"}]}}}"])
 *
 * - `desc` 是**完整**签名，带 `\n`。
 * - `descExtra` 是富文本分段表：每一项给出 `[start, end)` 区间与它指向的目标。
 *   `secUid` 就是 @ 那个人的主页 ID → 拼 `https://www.douyin.com/user/<secUid>`。
 *   这就是「签名里本来有超链接、提取后也要保持超链接」的正解：不用猜昵称、不用去 DOM 里
 *   找 `<a>`（DOM 只有可见那一段的锚点）。
 *
 * 三个坑（都踩过）
 * ---------------
 * ① `descExtra` **不是按 start 排好序的**（真机样本顺序是 35、60、69、2）→ 必须自己排序。
 * ② 一个大 script 里可能有**多个** `push(...)` 分片，只取第一个会漏 → 全局遍历。
 * ③ 页面里同时存在作品（aweme）的 desc/descExtra，直接用「有 desc 就算」会拿错人 →
 *    必须校验 `user.secUid === 地址栏 /user/<secUid>`。对不上就整段丢弃（宁可退回截断的
 *    DOM 文本，也不能把别人的签名记到这个人头上）。
 *
 * 全部是纯函数，Node 里可直接 require 做单测。
 */
(function (global) {
  'use strict';

  /** `self.__pace_f.push([1,"<payload>"])` —— payload 是 JS 字符串字面量，含引号 */
  var PACE_SOURCE = '__pace_f\\.push\\(\\[1,("(?:[^"\\\\]|\\\\.)*")\\]\\)';

  /** 用户主页数据块的定位特征（先用 indexOf 粗筛，避免对每个 script 跑正则） */
  var MARKER = 'descExtra';

  function parseJsonLiteral(literal) {
    try {
      return JSON.parse(literal);
    } catch (e) {
      return null;
    }
  }

  /**
   * flight 分片形如 `8:["$","$La",null,{...}]`，前面有 `\d+:` 序号。
   * 序号前缀不是合法 JSON，所以从第一个 `[` 切到最后一個 `]`。
   */
  function parseFlightArray(payload) {
    if (typeof payload !== 'string') return null;
    var i = payload.indexOf('[');
    var j = payload.lastIndexOf(']');
    if (i < 0 || j <= i) return null;
    try {
      return JSON.parse(payload.slice(i, j + 1));
    } catch (e) {
      return null;
    }
  }

  function isProfileUser(node, secUid) {
    if (!node || typeof node !== 'object') return false;
    if (typeof node.desc !== 'string') return false;
    if (!Array.isArray(node.descExtra)) return false;
    // 作品对象也有 desc / descExtra，但没有 nickname；用户对象两者都有
    if (!node.nickname && !node.uid) return false;
    // 有地址栏 secUid 时必须严格相等 —— 这是防「记到别人头上」的唯一闸口
    if (secUid) return node.secUid === secUid;
    return true;
  }

  function findByPredicate(root, predicate) {
    var found = null;
    var seen = typeof Set !== 'undefined' ? new Set() : null;
    var stack = [root];
    while (stack.length) {
      var node = stack.pop();
      if (found) break;
      if (!node || typeof node !== 'object') continue;
      if (seen) {
        if (seen.has(node)) continue;
        seen.add(node);
      }
      if (predicate(node)) { found = node; break; }
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        var v = node[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return found;
  }

  /**
   * 从 document 里读当前作者主页的 SSR 用户对象。
   *
   * @param {Document} doc
   * @param {string} [secUid] 地址栏里的 sec_uid（`/user/self` 时传空）
   * @returns {{desc:string, descExtra:Array, secUid:string, nickname:string}|null}
   */
  function readProfile(doc, secUid) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return null;

    var scripts = doc.querySelectorAll('script:not([src])');
    var best = null;

    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent || '';
      if (text.indexOf(MARKER) === -1) continue;

      var re = new RegExp(PACE_SOURCE, 'g');
      var m;
      while ((m = re.exec(text)) !== null) {
        var payload = parseJsonLiteral(m[1]);
        if (!payload || payload.indexOf(MARKER) === -1) continue;

        var tree = parseFlightArray(payload);
        if (!tree) continue;

        var hit = findByPredicate(tree, function (n) { return isProfileUser(n, secUid); });
        if (!hit) continue;

        // 多个分片都可能命中，取签名最长的那个（有的分片是精简版）
        if (!best || (hit.desc || '').length > (best.desc || '').length) best = hit;
      }
    }

    return best;
  }

  function linkOf(extra, seg) {
    if (!extra) return '';
    var link = extra.link;
    if (typeof link === 'string' && /^https?:\/\//i.test(link)) return link;

    // 只有「@ 开头 + 有 secUid」才当用户主页链接。
    // secUid 存在但片段不以 @ 开头，说明是别的富文本（话题等），不臆造成用户链接。
    if (typeof extra.secUid === 'string' && extra.secUid && seg.charAt(0) === '@') {
      return 'https://www.douyin.com/user/' + extra.secUid;
    }
    return '';
  }

  /**
   * 把 `desc` + `descExtra` 拼成带 Markdown 链接的字符串。
   *
   * 用 Markdown 而不是 HTML 的原因：导出的就是 Markdown 表格，原样即可；
   * 浮窗渲染时再转一次 `<a>`；复制成 TSV / 纯文本时再把链接降级成纯文字。
   * 一份数据，三种输出各取所需。
   */
  function buildRichText(desc, extras) {
    var text = typeof desc === 'string' ? desc : '';
    if (!text) return '';

    var list = [];
    if (Array.isArray(extras)) {
      for (var i = 0; i < extras.length; i++) {
        var e = extras[i];
        if (!e) continue;
        if (typeof e.start !== 'number' || typeof e.end !== 'number') continue;
        if (e.end <= e.start || e.start < 0 || e.end > text.length) continue;
        list.push(e);
      }
    }
    if (!list.length) return text;

    // 真机样本里 descExtra 顺序是乱的（35、60、69、2），必须排序
    list.sort(function (a, b) { return a.start - b.start; });

    var out = '';
    var last = 0;
    for (var j = 0; j < list.length; j++) {
      var item = list[j];
      if (item.start < last) continue; // 区间重叠：不猜，保留原文
      var seg = text.slice(item.start, item.end);
      if (!seg) continue;
      var url = linkOf(item, seg);
      out += text.slice(last, item.start);
      out += url ? '[' + seg + '](' + url + ')' : seg;
      last = item.end;
    }
    out += text.slice(last);
    return out;
  }

  /**
   * `"粉丝1640"` + `"粉丝"` → `"1640"`；`"IP属地：吉林"` + `"IP属地"` → `"吉林"`。
   * 找不到前缀返回空串（宁可空也不猜）。
   */
  function stripPrefix(text, prefix) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return '';
    var i = s.indexOf(prefix);
    if (i < 0) return '';
    return s.slice(i + prefix.length).replace(/^[\s：:]+/, '').trim();
  }

  /** 三项统计按用户 2026-10-30 定的格式：`粉丝：1640 · 获赞：2.9万 · IP属地：吉林` */
  function formatStats(stats) {
    var s = stats || {};
    var parts = [];
    if (s.fans) parts.push('粉丝：' + s.fans);
    if (s.likes) parts.push('获赞：' + s.likes);
    if (s.ip) parts.push('IP属地：' + s.ip);
    return parts.join(' · ');
  }

  var api = {
    readProfile: readProfile,
    buildRichText: buildRichText,
    stripPrefix: stripPrefix,
    formatStats: formatStats,
    linkOf: linkOf
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.DouyinProfileSSR = api;
  }
})(typeof window !== 'undefined' ? window : null);
