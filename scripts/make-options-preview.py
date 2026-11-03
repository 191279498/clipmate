# -*- coding: utf-8 -*-
"""
把真实的 options.html 变成可以截图/预览的普通网页（生成 tests/_options-preview.html）。

为什么需要：chrome-extension:// 页面无法用无头浏览器访问（Chrome 硬拒跨扩展访问），
但设置页这轮加了吉祥物（品牌位齿轮头、关于页挥手像、搜不到站举放大镜），
必须先在本地把真页面渲染出来看效果。

做法只有两步，页面本身一个字都不改：
1. 插一个 <base href>，让 options.css / ../shared/*.js / ../../icons/*.svg
   这些相对路径照样指到源码目录；
2. 在页头塞一个假的 chrome（只有 runtime.sendMessage / getManifest / storage.local），
   否则 options.js 一上来就报「读取配置失败」，页面是空的。

用法：
    python scripts/make-options-preview.py
    # 然后 http 起服务截图：tests/_options-preview.html#about
"""

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'options', 'options.html')
OUT = os.path.join(ROOT, 'tests', '_options-preview.html')
MANIFEST = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')

STUB = """<base href="../ClipMate_chrome/src/options/">
<script>
/* 假的 chrome：只够 options.js 跑起来，不连任何真实存储 */
(function () {
  var VERSION = '%(ver)s';
  var ANSWERS = {
    getConfig: { config: {} },
    getCacheStats: { count: 0, bytes: 0 },
    saveConfig: { ok: true },
    clearCacheOnly: { removed: 0, bytes: 0 },
    resetFeatures: { ok: true }
  };
  window.chrome = window.chrome || {};
  window.chrome.runtime = {
    id: 'preview',
    lastError: null,
    getManifest: function () { return { version: VERSION, manifest_version: 3 }; },
    getURL: function (p) { return '../ClipMate_chrome/' + String(p || ''); },
    sendMessage: function (msg) {
      var action = (msg && msg.action) || '';
      // 设置页的 config 不是从 storage 读的，而是问后台要 getConfig。
      // 桩里必须回一份，否则 config 为空、主题永远落到「跟随系统」，
      // 也就没法用 ?theme=dark 截深色版（这一处踩过一次）。
      if (action === 'getConfig') {
        var t = new URLSearchParams(location.search).get('theme');
        return Promise.resolve({ config: t ? { theme: t } : {} });
      }
      return Promise.resolve(ANSWERS[action] || {});
    }
  };
  window.chrome.storage = {
    local: {
      // ?theme=dark 让预览页按深色渲染（options.js 读 config.theme 后自己设 data-theme）
      get: function () {
        var t = new URLSearchParams(location.search).get('theme');
        return Promise.resolve(t ? { theme: t } : {});
      },
      set: function () { return Promise.resolve(); }
    },
    onChanged: { addListener: function () {} }
  };
})();
</script>
"""

# 演示用的收尾脚本：?q=xxx 让「网站」页进入「搜不到」空状态（截图用，不影响真页面）
TAIL = """<script>
(function () {
  var q = new URLSearchParams(location.search).get('q');
  if (!q) return;
  // 等 options.js 把站点列表画完再填搜索框
  function fill() {
    var box = document.getElementById('siteSearch');
    if (!box) return setTimeout(fill, 60);
    box.value = q;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }
  setTimeout(fill, 260);
})();
</script>
"""


def main():
    with open(SRC, 'r', encoding='utf-8') as f:
        html = f.read()
    with open(MANIFEST, 'r', encoding='utf-8') as f:
        ver = json.load(f)['version']

    assert '<base ' not in html, '源码里已经有人加过 base 了？'
    html = html.replace('<head>', '<head>\n' + (STUB % {'ver': ver}), 1)
    html = html.replace('</body>', TAIL + '</body>', 1)

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('已生成', os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
