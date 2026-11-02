/**
 * 快手「作品档案」读取器 —— 跑在**页面环境**（world: 'MAIN'）里的一次性函数
 *
 * 背景（v2.5.83 真机勘察结论）
 * ----------------------------
 * 快手推荐流（`/new-reco`）把当前这一批作品的**完整明细**整块挂页面的
 * `window.INIT_STATE` 上（每批 19 条），里面直接就有：
 *   feed.photo  : id、caption（文案）、timestamp（发布时间，毫秒）、coverUrl、viewCount、likeCount
 *   feed.author : id、name、headerUrl        ← 注意 author 在 feed 层，不在 photo 层
 *
 * 扩展默认的「隔离环境」看不到页面 JS 挂上去的对象属性（Chrome 安全设计），
 * 所以由后台在需要时用 chrome.scripting.executeScript({world:'MAIN'}) 注入本函数，
 * 取完返回一个**纯 JSON**，跨环境结构化克隆回来。不常驻、不轮询、不 hook 网络、不发请求。
 *
 * 为什么不用「解开键名」的办法定位
 * --------------------------------
 * 那份对象的键名被做了 ASCII +1 偏移混淆（例如 `/rest/v/feed/hot` 存成了 `0sftu0w0gffe0ipu`）。
 * 靠解码去拼键名，等于把把柄交给了对方的命名；一旦键名规则再变就全废。
 * 所以这里**遍历所有值**，按「形状」认：必须同时满足
 *   - 值是对象
 *   - 有一个数组字段 feeds
 *   - feeds 里每一项同时有 photo 和 author（评论/其它数组进不了这个形状）
 * 实测这种形状的数据在页面上**恰好只有一份**。
 *
 * 三条硬规则（沿用抖音 v2.5.77 那套）
 * ------------------------------------
 *   1. **绝不猜**：只认形状完全吻合的那一组；认不出返回 null，调用方回落老办法。宁空不错。
 *   2. **一次搬一批**：整批（19 条）一次性带回来，切到下一条时不用再注入。
 *   3. **绝不抛**：整个函数包在 try/catch 里，任何异常都返回 null。
 *
 * 返回形态（刻意用短键名，少传点字节）
 *   { count: <条数>, items: { <作品ID>: { t: 毫秒时间戳, c: 文案, n: 作者昵称, a: 作者内部ID } } }
 *
 * 本文件同时被三处使用：
 *   - background.js 通过 importScripts 加载（拿函数引用去注入）
 *   - Node 单测直接 require（用真机样本验证解析逻辑）
 *   - 真机探针可以 readFile 后 evaluate 原样跑
 */
function readKuaishouStateFeeds() {
  try {
    /* eslint-disable no-undef */
    var st = (typeof window !== 'undefined' && window.INIT_STATE) ? window.INIT_STATE : null;
    if (!st || typeof st !== 'object') return null;

    var items = {};
    var keys = Object.keys(st);

    for (var i = 0; i < keys.length; i++) {
      var v;
      try { v = st[keys[i]]; } catch (e) { continue; }
      if (!v || typeof v !== 'object') continue;

      var feeds = v.feeds;
      if (!feeds || !Array.isArray(feeds) || !feeds.length) continue;

      for (var j = 0; j < feeds.length; j++) {
        var f;
        try { f = feeds[j]; } catch (e) { continue; }

        // 形状必须是「一条作品」：photo + author 缺一不可。
        // 少了 author 的往往是评论/其它列表 —— 宁可跳过这一条，也不猜。
        if (!f || !f.photo || !f.author) continue;

        try {
          var pid = String(f.photo.id == null ? '' : f.photo.id);
          if (!pid || items[pid]) continue;

          var ts = f.photo.timestamp;
          items[pid] = {
            t: (typeof ts === 'number' && isFinite(ts)) ? ts : 0,
            c: String(f.photo.caption == null ? '' : f.photo.caption).slice(0, 500),
            n: String(f.author.name == null ? '' : f.author.name).slice(0, 80),
            a: String(f.author.id == null ? '' : f.author.id).slice(0, 64)
          };
        } catch (e) { /* 单条脏数据跳过，不影响这一批里其它作品 */ }
      }
    }

    var count = Object.keys(items).length;
    return count ? { count: count, items: items } : null;
  } catch (e) {
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = readKuaishouStateFeeds;
}
if (typeof self !== 'undefined') {
  self.readKuaishouStateFeeds = readKuaishouStateFeeds;
}
