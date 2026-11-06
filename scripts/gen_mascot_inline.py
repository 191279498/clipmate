#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 icons/mascot/*.svg 生成 src/content/shared/mascot-inline.js

为什么要生成而不是手抄：
  同一张 SVG 既要在页面里显示（背景图），又不能以 chrome-extension:// 的形式
  出现在页面 DOM 里（浏览器会在控制台留 "Unsafe attempt to load URL ..." 噪音，
  而且部分站点的 CSP img-src 会直接拦掉）。做法是把它内联成 data URL。
  一旦手抄，改图忘了改内联表就是「单测全绿、真机还是旧图」。

【只内联页面里用得到的图】
  popup / options 是扩展自己的页面，同源加载 chrome-extension:// 完全没问题，
  也永远不会报那条错 —— 那些图（face-blank / hero-peek 等）不内联，省体积。
  这里只收 content 目录真正引用到的图，并由 `--check` 保证「漏收」会被发现。

用法：
  python scripts/gen_mascot_inline.py          # 生成
  python scripts/gen_mascot_inline.py --check  # 只校验（产物是否最新 / 有无漏收）
"""
from __future__ import print_function

import io
import os
import re
import sys

try:
    from urllib.parse import quote
except ImportError:  # Python 2 兜底（本机是 3，写全是为了脚本能到处跑）
    from urllib import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, 'ClipMate_chrome', 'icons', 'mascot')
CONTENT_DIR = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content')
OUT_JS = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'shared', 'mascot-inline.js')

# 顺序固定（输出稳定，成品哈希不抖）
ICONS = ['hero-doc', 'hero-done', 'hero-cry', 'hero-archive', 'face-busy', 'face-idle']

# URL 里保留原样的字符：结构字符留着能省 30~40% 体积，
# 会被编码的是 <>"'# 空格 和所有中文/非 ASCII。
SAFE = '-_.~/:;,='

HEADER = '''/**
 * 采媒灵 · 页面内吉祥物图标（内联 data URL）
 * ============================================================================
 * 【这个文件是生成物】由 scripts/gen_mascot_inline.py 从 icons/mascot/*.svg 生成，
 *   **不要手改**。改图 → 改 icons/mascot/*.svg → 重跑脚本。
 *   测试会校验本文件与源 SVG 一致，手改会直接变红。
 *
 * 【为什么不用 chrome.runtime.getURL】
 *   按钮和浮窗是注入到**别人页面**里的，图标以 background-image 挂在页面 DOM 上。
 *   页面引用 chrome-extension:// 属于跨源请求：浏览器先记一条
 *     "Unsafe attempt to load URL ... Domains, protocols and ports must match."
 *   再按 web_accessible_resources 放行。图最终能显示，但 edge://extensions 的
 *   错误页会长期挂一条红字（v2.12.6 用户实际看到的就这条）；个别站点还会
 *   用自己的 CSP img-src 把它掐掉。
 *   data URL 是文档自己的内联数据，既不跨源也不受 img-src 限制 —— 干净。
 *
 * 【体积】6 张图 minify 后约 %(kb).0f KB（源码正文，未压缩）。
 *   只收 content 目录真正用到的 6 张；popup/options 同源用图不在其中。
 *
 * 【键名 = 文件名去掉 .svg】与 icons/mascot/ 一一对应，取用统一走
 *   src/content/shared/mascot-url.js 的 ClipMateMascot.url()。
 */
'''


def minify_svg(text):
    """保守压缩：只删「一定不影响渲染」的东西，不碰任何属性与数字。"""
    t = text
    t = re.sub(r'<!--.*?-->', '', t, flags=re.S)          # 注释
    t = re.sub(r'<\?xml.*?\?>', '', t, flags=re.S)         # XML 声明
    t = re.sub(r'<!DOCTYPE.*?>', '', t, flags=re.S)        # DOCTYPE
    t = re.sub(r'<metadata.*?</metadata>', '', t, flags=re.S)  # 导出工具塞的元数据
    t = re.sub(r'>\s+<', '><', t)                          # 标签间空白
    t = re.sub(r'\s{2,}', ' ', t)                          # 连续空白
    t = re.sub(r'\s+/>', '/>', t)                          # 自闭合标签前的空格
    t = re.sub(r'\s+>', '>', t)
    return t.strip()


def data_url(svg_text):
    return 'data:image/svg+xml,' + quote(svg_text, safe=SAFE)


def referenced_names():
    """扫 content 目录，找出真正被引用的图标名（防「加了新图忘了收」）。"""
    names = set()
    pat_literal = re.compile(r'icons/mascot/([a-z0-9-]+)\.svg')
    # 只认独立的 mascotUrl('hero-done')；
    # 必须排除 button-manager 的 _mascotUrl('busy') —— 那里传的是**状态**不是文件名。
    pat_call = re.compile(r"(?<![_A-Za-z])mascotUrl\(\s*'([a-z0-9-]+)'")
    pat_map = re.compile(r"'([a-z0-9-]+\.svg)'")
    for dirpath, _dirs, files in os.walk(CONTENT_DIR):
        for fn in files:
            if not fn.endswith('.js'):
                continue
            # 解析器自己和生成物正文里本来就会写到图标路径，不算「引用」
            if fn in ('mascot-url.js', 'mascot-inline.js'):
                continue
            path = os.path.join(dirpath, fn)
            try:
                src = io.open(path, encoding='utf-8').read()
            except Exception:
                continue
            for m in pat_literal.finditer(src):
                names.add(m.group(1))
            for m in pat_call.finditer(src):
                names.add(m.group(1))
            # _MASCOT_BY_STATE 这类表里写的是裸文件名（'hero-doc.svg'），
            # 只在同一行出现 mascot/ 或 MASCOT 时才采信，避免误捞别的 svg。
            for line in src.splitlines():
                if 'MASCOT' not in line and 'mascot' not in line:
                    continue
                for m in pat_map.finditer(line):
                    names.add(m.group(1)[:-4])
    return names


def build():
    parts = []
    total = 0
    for name in ICONS:
        path = os.path.join(SRC_DIR, name + '.svg')
        if not os.path.exists(path):
            raise SystemExit('缺图标文件：' + path)
        raw = io.open(path, encoding='utf-8').read()
        mini = minify_svg(raw)
        url = data_url(mini)
        total += len(mini.encode('utf-8'))
        parts.append("    '%s': '%s'" % (name, url))

    header = HEADER % {'kb': total / 1024.0}
    body = '\n'.join([
        '(function (root) {',
        "  'use strict';",
        '',
        '  var TABLE = {',
        ',\n'.join(parts),
        '  };',
        '',
        '  function has(name) {',
        '    return Object.prototype.hasOwnProperty.call(TABLE, name);',
        '  }',
        '',
        '  function get(name) {',
        "    return has(name) ? TABLE[name] : '';",
        '  }',
        '',
        '  function names() {',
        '    return Object.keys(TABLE);',
        '  }',
        '',
        '  var api = { TABLE: TABLE, has: has, get: get, names: names };',
        "  if (typeof module !== 'undefined' && module.exports) module.exports = api;",
        '  if (root) root.ClipMateMascotInline = api;',
        "})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));",
        '',
    ])
    return header + body


def main():
    check = '--check' in sys.argv
    refs = referenced_names()
    missing = sorted(refs - set(ICONS))
    if missing:
        print('[漏收] content 目录引用了这些图，但 ICONS 里没有：' + ', '.join(missing))
        print('       → 加进 scripts/gen_mascot_inline.py 的 ICONS 再重跑。')
        return 2

    out = build()
    old = ''
    if os.path.exists(OUT_JS):
        old = io.open(OUT_JS, encoding='utf-8').read()

    if check:
        if old != out:
            print('[不一致] mascot-inline.js 不是最新，请重跑 python scripts/gen_mascot_inline.py')
            return 1
        print('[一致] 内联表最新，%d 张，正文 %.0f KB' % (len(ICONS),
              sum(len(minify_svg(io.open(os.path.join(SRC_DIR, n + '.svg'), encoding='utf-8').read()).encode('utf-8'))
                  for n in ICONS) / 1024.0))
        return 0

    io.open(OUT_JS, 'w', encoding='utf-8', newline='\n').write(out)
    print('[已生成] %s（%d 张，文件 %.0f KB）' % (
        os.path.relpath(OUT_JS, ROOT), len(ICONS), os.path.getsize(OUT_JS) / 1024.0))
    return 0


if __name__ == '__main__':
    sys.exit(main())
