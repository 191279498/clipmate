# -*- coding: utf-8 -*-
"""
生成采媒灵的应用图标（16/32/48/128）。

v2.9.2 起素材换成矢量：icons/mascot/*.svg（用户 2026-11-03 给的吉祥物大合集拆出的 23 个形态）。
背景：品牌蓝对角线渐变 #3D8BFF → #1668E6，圆角 23.4%（30/128）。

用法：
    python scripts/make-icons.py            # 生成到 ClipMate_chrome/icons/ 与 设计系统/assets/
    python scripts/make-icons.py --preview  # 额外输出对照图到 .workbuddy/tmp/icontry/

为什么不是每档尺寸各渲染一次 SVG：
    SVG 在 16px 直接渲染会把细描边糊掉。统一先渲染到 512 画布，再 LANCZOS 缩到目标尺寸
    （超采样），小尺寸的描边才干净。渲染靠本机 Edge 无头模式，PIL 只负责合成。

四条要点，都是踩出来的：
1. 16/32 用「头部特写」而不是全身像：16px 下举着的那张纸会糊成一坨灰斑，
   换成头部特写后脸和眼睛放大近一倍才认得出来（这就是用户选的「混合」方案）。
2. 成品最后要再套一次圆角遮罩——否则放大比例时吉祥物会从圆角外戳出来。
3. SVG 文件自带 3% 内边距（拆分素材时加的），所以 FRAC 要除以 0.94 才能得到
   设计上的「主体占画布多少」。别直接拿目标百分比当 frac。
4. Edge 无头截图默认白底，必须 --default-background-color=00000000，否则角落是白块。
"""

import base64
import io
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASCOT_DIR = os.path.join(ROOT, 'ClipMate_chrome', 'icons', 'mascot')
OUT_ICONS = os.path.join(ROOT, 'ClipMate_chrome', 'icons')
OUT_ASSETS = os.path.join(ROOT, '设计系统', 'assets')
OUT_PREVIEW = os.path.join(ROOT, '.workbuddy', 'tmp', 'icontry')

EDGE_CANDIDATES = (
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
)

S = 512                       # 排版画布（超采样基准）
RADIUS = 120                  # 圆角：30/128 ≈ 23.4%
BG_TOP = '#3D8BFF'
BG_BOTTOM = '#1668E6'

SVG_PAD = 0.94                # 拆分素材时给每个 SVG 加的 3% 内边距 → 主体占 94%

# size -> (形态名, 主体占画布宽度比例)
# 小尺寸（工具栏 16/32、扩展页 48 偶尔也按 32 渲染）用头部特写，大尺寸用全身像
PLAN = {
    16: ('face-idle', 0.98),
    32: ('face-idle', 0.98),
    48: ('hero-doc', 0.94),
    128: ('hero-doc', 0.94),
}
SIZES = (16, 32, 48, 128)


def find_edge():
    for p in EDGE_CANDIDATES:
        if os.path.isfile(p):
            return p
    raise SystemExit('找不到 Edge / Chrome，无法渲染 SVG')


def hex2rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def gradient(c1, c2, size=S, angle=(0.35, 0.65)):
    """小图算对角线渐变再放大——纯 Python，不依赖 numpy。"""
    n = 96
    a, b = hex2rgb(c1), hex2rgb(c2)
    small = Image.new('RGB', (n, n))
    px = small.load()
    ax, ay = angle
    total = ax + ay
    for y in range(n):
        for x in range(n):
            t = max(0.0, min(1.0, (x / (n - 1) * ax + y / (n - 1) * ay) / total))
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC).convert('RGBA')


def rounded_mask(size=S, radius=RADIUS):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def render_svg(name, width_fraction, tmpdir, edge):
    """把 SVG 渲染成 512×512 透明 PNG（主体宽度 = width_fraction × 画布）。"""
    src = os.path.join(MASCOT_DIR, name + '.svg')
    if not os.path.isfile(src):
        raise SystemExit('缺素材: ' + src)
    uri = 'data:image/svg+xml;base64,' + base64.b64encode(open(src, 'rb').read()).decode()

    # SVG 自带 SVG_PAD 内边距 → 想得到目标占比，图片本身要放到 target/SVG_PAD
    frac = width_fraction / SVG_PAD
    html = (
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
        'html,body{margin:0;background:transparent}'
        '#b{width:%dpx;height:%dpx;display:flex;align-items:center;justify-content:center}'
        '#b img{width:%.3f%%;height:%.3f%%;object-fit:contain;display:block}'
        '</style></head><body><div id="b"><img src="%s"></div></body></html>'
    ) % (S, S, frac * 100, frac * 100, uri)

    hp = os.path.join(tmpdir, name + '.html')
    with io.open(hp, 'w', encoding='utf-8') as f:
        f.write(html)
    out = os.path.join(tmpdir, name + '.png')
    subprocess.run(
        [edge, '--headless', '--disable-gpu', '--hide-scrollbars', '--disk-cache-size=1',
         '--default-background-color=00000000', '--virtual-time-budget=4000',
         '--force-device-scale-factor=1', '--window-size=%d,%d' % (S, S),
         '--screenshot=' + out, 'file:///' + hp.replace('\\', '/')],
        check=True, timeout=180, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    im = Image.open(out).convert('RGBA')
    if im.size != (S, S):
        raise SystemExit('渲染尺寸不对: %s' % (im.size,))
    return im


def compose(art):
    """蓝底 + 圆角 + 居中叠吉祥物 + 再套一次圆角遮罩。"""
    base = gradient(BG_TOP, BG_BOTTOM, S)
    base.putalpha(rounded_mask())

    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(base, (0, 0))
    canvas.alpha_composite(art, (0, 0))

    alpha = canvas.split()[-1]
    canvas.putalpha(Image.composite(alpha, Image.new('L', (S, S), 0), rounded_mask()))
    return canvas


def main():
    preview = '--preview' in sys.argv
    edge = find_edge()

    cache = {}
    with tempfile.TemporaryDirectory() as tmpdir:
        rendered = {}
        for sz in SIZES:
            name, frac = PLAN[sz]
            key = (name, frac)
            if key not in cache:
                cache[key] = render_svg(name, frac, tmpdir, edge)
            rendered[sz] = compose(cache[key]).resize((sz, sz), Image.LANCZOS)

    for sz in SIZES:
        img = rendered[sz]
        for dst in (OUT_ICONS, OUT_ASSETS):
            if not os.path.isdir(dst):
                os.makedirs(dst, exist_ok=True)
            p = os.path.join(dst, 'icon%d.png' % sz)
            img.save(p, optimize=True)
            print('写入 %-44s %6d 字节' % (os.path.relpath(p, ROOT), os.path.getsize(p)))

    if preview:
        if not os.path.isdir(OUT_PREVIEW):
            os.makedirs(OUT_PREVIEW, exist_ok=True)
        for sz in SIZES:
            rendered[sz].save(os.path.join(OUT_PREVIEW, 'final_%d.png' % sz))
        # 工具栏模拟：浅灰底 + 四个真尺寸并排（32 是高分屏工具栏，48/128 在扩展页与商店）
        bar = Image.new('RGB', (300, 100), (243, 243, 243))
        x = 24
        for sz in SIZES:
            im = rendered[sz]
            bar.paste(im, (x, 50 - sz // 2), im)
            x += sz + 24
        bar.save(os.path.join(OUT_PREVIEW, 'final_toolbar.png'))
        bar.resize((900, 300), Image.NEAREST).save(os.path.join(OUT_PREVIEW, 'final_toolbar_zoom.png'))
        # 1:1 真实尺寸并排（判断 16px 能不能认出来的唯一办法）
        real = Image.new('RGB', (200, 60), (243, 243, 243))
        x = 16
        for sz in SIZES:
            real.paste(rendered[sz], (x, 30 - sz // 2), rendered[sz])
            x += sz + 16
        real.resize((800, 240), Image.NEAREST).save(os.path.join(OUT_PREVIEW, 'final_1to1_zoom.png'))
        print('预览图：.workbuddy/tmp/icontry/')


if __name__ == '__main__':
    main()
