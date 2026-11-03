# -*- coding: utf-8 -*-
"""
生成采媒灵的应用图标（16/32/48/128）。

唯一素材：icons/mascot/mascot.png（用户手绘的吉祥物母版，480×409 透明底）
背景：品牌蓝对角线渐变 #3D8BFF → #1668E6，圆角 23.4%（30/128）

用法：
    python scripts/make-icons.py            # 生成到 ClipMate_chrome/icons/ 与 设计系统/assets/
    python scripts/make-icons.py --preview  # 额外输出对照图到 .workbuddy/tmp/icontry/

三条要点，都是踩出来的：
1. 先在 512 画布上排版再 LANCZOS 缩小（超采样），小尺寸才不出锯齿。
2. 成品最后要再套一次圆角遮罩——否则放大比例时吉祥物会从圆角外戳出来。
3. 16/32 用「头部方裁」而不是完整构图：16px 下那张纸会糊成一坨灰斑，
   裁到头部后脸和眼睛放大近一倍才认得出来（128/48 保持完整构图）。
"""

import os
import sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'icons', 'mascot', 'mascot.png')
OUT_ICONS = os.path.join(ROOT, 'ClipMate_chrome', 'icons')
OUT_ASSETS = os.path.join(ROOT, '设计系统', 'assets')
OUT_PREVIEW = os.path.join(ROOT, '.workbuddy', 'tmp', 'icontry')

S = 512                       # 排版画布（超采样基准）
RADIUS = 120                  # 圆角：30/128 ≈ 23.4%
BG_TOP = '#3D8BFF'
BG_BOTTOM = '#1668E6'

# 母版不透明区域 bbox = (19, 19, 461, 390)；头部方裁取左边这块正方形
CROP_HEAD = (19, 19, 400, 400)

# size -> (裁切框, 吉祥物宽度占比)
# 小尺寸裁到头、比例放大，保住脸和眼睛；大尺寸给完整构图（头 + 纸）
PLAN = {
    16: (CROP_HEAD, 0.98),
    32: (CROP_HEAD, 0.98),
    48: (None, 0.94),
    128: (None, 0.94),
}
SIZES = (16, 32, 48, 128)


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


def master(crop=None, width_fraction=0.94):
    """在 512 画布上排出母版大图（之后统一缩到目标尺寸）。"""
    mascot = Image.open(SRC).convert('RGBA')
    if crop:
        mascot = mascot.crop(crop)
    mw, mh = mascot.size
    scale = (S * width_fraction) / mw
    nw, nh = max(1, int(round(mw * scale))), max(1, int(round(mh * scale)))

    base = gradient(BG_TOP, BG_BOTTOM, S)
    base.putalpha(rounded_mask())

    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    canvas.alpha_composite(base, (0, 0))
    canvas.alpha_composite(mascot.resize((nw, nh), Image.LANCZOS),
                           ((S - nw) // 2, (S - nh) // 2))

    # 关键：整张成品再套一次圆角遮罩，防止放大后吉祥物从圆角外戳出来
    alpha = canvas.split()[-1]
    canvas.putalpha(Image.composite(alpha, Image.new('L', (S, S), 0), rounded_mask()))
    return canvas


def main():
    preview = '--preview' in sys.argv
    if preview:
        os.makedirs(OUT_PREVIEW, exist_ok=True)

    rendered = {}
    for sz in SIZES:
        crop, frac = PLAN[sz]
        rendered[sz] = master(crop, frac).resize((sz, sz), Image.LANCZOS)

    for sz in SIZES:
        img = rendered[sz]
        for dst in (OUT_ICONS, OUT_ASSETS):
            if not os.path.isdir(dst):
                os.makedirs(dst, exist_ok=True)
            p = os.path.join(dst, f'icon{sz}.png')
            img.save(p, optimize=True)
            print('写入 %-44s %6d 字节' % (os.path.relpath(p, ROOT), os.path.getsize(p)))
        if preview:
            img.save(os.path.join(OUT_PREVIEW, f'final_{sz}.png'))

    if preview:
        # 工具栏模拟：浅灰底 + 四个真尺寸并排（32 是高分屏工具栏，48/128 在扩展页与商店）
        bar = Image.new('RGB', (300, 100), (243, 243, 243))
        x = 24
        for sz in SIZES:
            im = rendered[sz]
            bar.paste(im, (x, 50 - sz // 2), im)
            x += sz + 24
        bar.save(os.path.join(OUT_PREVIEW, 'final_toolbar.png'))
        bar.resize((900, 300), Image.NEAREST).save(os.path.join(OUT_PREVIEW, 'final_toolbar_zoom.png'))
        master(None, 0.94).save(os.path.join(OUT_PREVIEW, 'final_512_full.png'))
        master(CROP_HEAD, 0.98).save(os.path.join(OUT_PREVIEW, 'final_512_head.png'))
        print('预览图：.workbuddy/tmp/icontry/')


if __name__ == '__main__':
    main()
