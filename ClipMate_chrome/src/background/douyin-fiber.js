/**
 * 抖音弹窗「原始数据」读取器 —— 跑在**页面环境**（world: 'MAIN'）里的一次性函数
 *
 * 背景
 * ----
 * 抖音前端把每条作品的原始数据挂在 React 节点上：
 *   DOM 节点.__reactFiber$xxx → 往上爬 → memoizedProps.awemeInfo
 * 扩展默认的「隔离环境」看不到页面 JS 挂上去的对象属性（Chrome 安全设计），
 * 所以由后台在需要时用 chrome.scripting.executeScript({world:'MAIN'}) 注入本函数，
 * 取完返回一个普通 JSON 对象，跨环境结构化克隆回来。**不常驻、不轮询、不 hook 网络。**
 *
 * 三条硬规则（对应 v2.5.77 方案 4.2 / 五）
 * -------------------------------------------
 * 1. **绝不猜**：拿着地址栏的 modal_id 去找 awemeId 完全相等的那一条；
 *    找不到就返回 null，让调用方回落 DOM 取法。宁可空，不可错。
 * 2. **只认这一条**：弹窗页里同时挂着多条作品的 fiber（背景信息流、预加载的下一条），
 *    所以先按 `class="video_<awemeId>"` 锁定「这一条」的容器，再在容器内爬。
 * 3. **绝不抛**：整个函数包在 try/catch 里，任何异常都返回 null。
 *
 * 本文件同时被三处使用：
 *   - background.js 通过 importScripts 加载（拿函数引用去注入）
 *   - Node 单测直接 require（用真样本验证解析逻辑）
 *   - 真机探针可以 readFile 后 evaluate 原样跑（无需改写）
 */
function readDouyinAwemeInfo(modalId) {
  try {
    var doc = document;
    if (!doc || !doc.querySelectorAll) return null;

    var targetId = modalId === null || modalId === undefined ? '' : String(modalId).trim();
    // 不像作品 ID 就当没给（避免拿半截字符串去误匹配）
    if (!/^\d{6,25}$/.test(targetId)) targetId = '';

    // ---------- 第一步：锁定「这一条」的容器 ----------
    // 判据优先级：class 里带 video_<id> 且**里面确实有内容**的 feed-video / feed-active-video
    //   > 内含 video-info[data-e2e-aweme-id=<id>] 的节点
    //   > modal-video-container
    //   > document.body（最后兜底，靠后面的 awemeId 对账保证不出错）
    //
    // ⚠️ 实测坑（批 2）：搜索页里同一个 `video_<id>` 会出现在侧栏推荐卡片上（空壳，没有内容），
    //   所以「有内容」的候选要排到前面，空的排后面 —— 否则会拿到空壳、白丢一次机会。
    var scopes = [];
    var i;
    var j;

    if (targetId) {
      var feeds = doc.querySelectorAll('[data-e2e="feed-video"], [data-e2e="feed-active-video"]');
      for (i = 0; i < feeds.length; i++) {
        var cls = feeds[i].className;
        if (typeof cls !== 'string' || (' ' + cls + ' ').indexOf(' video_' + targetId + ' ') < 0) continue;
        var hasContent = (feeds[i].querySelector && (feeds[i].querySelector('[data-e2e="video-info"]') ||
          feeds[i].querySelector('[data-e2e="video-desc"]')));
        if (hasContent) scopes.unshift(feeds[i]);
        else scopes.push(feeds[i]);
      }

      var infos = doc.querySelectorAll('[data-e2e="video-info"]');
      for (j = 0; j < infos.length; j++) {
        if (infos[j].getAttribute('data-e2e-aweme-id') !== targetId) continue;
        var up = infos[j].closest
          ? infos[j].closest('[data-e2e="feed-video"], [data-e2e="feed-active-video"], [data-e2e="feed-item"]')
          : null;
        if (up) scopes.push(up);
        scopes.push(infos[j]);
        break;
      }
    }

    var container = doc.querySelector('[data-e2e="modal-video-container"]');
    if (container) scopes.push(container);
    scopes.push(doc.body);

    // ---------- 第二步：爬 fiber ----------
    // React 把 fiber 挂在节点的 __reactFiber$<随机串> 上（enumerable，Object.keys 可见）。
    // 从节点往上沿 return 指针爬最多 40 层，找 memoizedProps.awemeInfo。
    function climbFiber(el) {
      var key = null;
      try {
        var keys = Object.keys(el);
        for (var k = 0; k < keys.length; k++) {
          if (keys[k].indexOf('__reactFiber$') === 0) { key = keys[k]; break; }
        }
      } catch (e) {
        return null;
      }
      if (!key) return null;

      var f = el[key];
      var depth = 0;
      while (f && depth < 40) {
        try {
          var p = f.memoizedProps;
          if (p && p.awemeInfo && typeof p.awemeInfo === 'object') return p.awemeInfo;
        } catch (e) {
          return null;
        }
        f = f.return;
        depth++;
      }
      return null;
    }

    function idOf(a) {
      if (!a || a.awemeId === null || a.awemeId === undefined) return '';
      return String(a.awemeId);
    }

    var seen = {};
    var loose = [];   // 所有候选（按 awemeId 去重）
    var exact = null; // 与 targetId 精确命中的那一条

    function visit(el) {
      var a = climbFiber(el);
      if (!a) return false;
      var id = idOf(a);
      if (!id || seen[id]) return false;
      seen[id] = 1;
      loose.push(a);
      if (targetId && id === targetId) {
        exact = a;
        return true;
      }
      return false;
    }

    for (var s = 0; s < scopes.length; s++) {
      if (!scopes[s]) continue;
      if (visit(scopes[s])) break;
      var all = scopes[s].querySelectorAll('*');
      var hitHere = false;
      for (var n = 0; n < all.length; n++) {
        if (visit(all[n])) { hitHere = true; break; }
      }
      if (hitHere) break;
    }

    // ---------- 第三步：选哪一条 ----------
    var picked = exact;
    if (!picked && !targetId && loose.length === 1) picked = loose[0];
    // 有 targetId 但没精确命中 → 返回 null（绝不拿「最像的那条」顶替）
    if (!picked) return null;

    // ---------- 第四步：归一成可跨环境克隆的纯数据 ----------
    var author = picked.authorInfo && typeof picked.authorInfo === 'object' ? picked.authorInfo : {};
    return {
      awemeId: idOf(picked),
      awemeType: Number(picked.awemeType) || 0,
      mediaType: Number(picked.mediaType) || 0,
      createTime: Number(picked.createTime) || 0,
      desc: typeof picked.desc === 'string' ? picked.desc : '',
      itemTitle: typeof picked.itemTitle === 'string' ? picked.itemTitle : '',
      nickname: typeof author.nickname === 'string' ? author.nickname : '',
      secUid: author.secUid === null || author.secUid === undefined ? '' : String(author.secUid)
    };
  } catch (e) {
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = readDouyinAwemeInfo;
}
if (typeof self !== 'undefined') {
  self.readDouyinAwemeInfo = readDouyinAwemeInfo;
}
