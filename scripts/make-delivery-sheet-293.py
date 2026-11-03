# -*- coding: utf-8 -*-
"""
合成 v2.9.3 交付图（配色收口：设置页换纸色 + 深色站点自动适配）。

素材全部来自 _shots/（真代码截出来的），脚本只做裁剪、缩放、排版。
排版工具直接复用 make-delivery-sheet.py 里的 Sheet，样式与上一版一致。

用法：
    python scripts/shoot-previews.py               # 先有截图
    python scripts/make-delivery-sheet-293.py      # 再合成
"""

import importlib
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
base = importlib.import_module('make-delivery-sheet')

ROOT = base.ROOT
SHOTS = base.SHOTS
OUT = os.path.join(ROOT, 'v2.9.3_纸色收口与深色适配_交付图_20261103.png')

W, PAD, CW = base.W, base.PAD, base.CW
INK, INK2, GRAY, BLUE, HAIR, BAND = base.INK, base.INK2, base.GRAY, base.BLUE, base.HAIR, base.BAND
font = base.font
scale_w = base.scale_w


def shot(name):
    return Image.open(os.path.join(SHOTS, name + '.png')).convert('RGB')


def crop(im, y0, y1, x0=0, x1=None):
    return im.crop((x0, y0, x1 or im.width, y1))


def note_wrapped(s, text, width=None, dy=14):
    """图下说明：按实际字宽折行。中英混排不能按字数估，直接用 textlength 量。

    行距必须大于字号（16px 字配 27px 行距），否则相邻两次说明会叠在一起 ——
    第一版就是在「先加 dy 再只推进 26」上踩了这个坑，两行字糊成一团。
    """
    width = width or CW
    f = font(16)
    s.y += dy
    lines, cur = [], ''
    for ch in text:
        if s.d.textlength(cur + ch, font=f) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    for ln in lines:
        s.text(PAD, s.y, ln, f, GRAY)
        s.y += 27

def main():
    s = base.Sheet()

    s.title('采媒灵 v2.9.3 · 配色收口：米纸色铺满全局 + 深色站点自动适配',
            '设置页从紫灰换成纸色 · 浮窗 / 按钮 / 提示条在深色站点上自动换暖黑')

    # ---------- 01 设置页浅色 ----------
    s.section('设置页：紫灰 → 米纸色',
              '最后一个还在用紫色的界面也收进来了。改动只在变量表那一处，586 行规则一行没动。')

    opt_light = scale_w(crop(shot('opt_general'), 0, 1600), CW)
    s.put(opt_light)
    note_wrapped(s, '底色 #F7F6F2 · 侧栏 #F1EFE8 · 发丝线 #E1DCD1 · 正文 #111820 · 强调色从紫 #6b4ef2 换成品牌蓝 #056BF4', dy=14)
    note_wrapped(s, '强调色换蓝是为了和弹窗、浮窗、扩展图标统一：改之前设置页是整套界面里唯一还发紫的地方。', dy=0)
    s.gap(12)

    # ---------- 02 设置页深色 ----------
    s.section('设置页：深色',
              '跟随扩展「外观」里的三档（深色 / 浅色 / 跟随系统），三套变量共用同一组语义名。')

    opt_dark = scale_w(crop(shot('opt_dark'), 0, 1600), CW)
    s.put(opt_dark)
    note_wrapped(s, '暖黑：底 #191817 · 面 #222120 · 线 #33302A · 字 #EDE9E0 · 蓝 #8FB6FF', dy=14)
    note_wrapped(s, '顺手修了个老 bug：手动选「浅色」时只覆盖了前 16 个变量，--danger / --shadow 没跟着回来，'
           '系统开着深色的话「删除」这类字在浅底上仍是粉色。现在三套变量个数一致，有断言守着。', dy=0)
    s.gap(12)

    # ---------- 03 深色站点上的按钮 ----------
    s.section('深色站点 · 提取按钮四态',
              '常驻的「待命」沉下去，瞬态的「成功 / 失败」保持亮 —— 两者的视觉权重本来就该不同。')

    btn = crop(shot('btn_dark'), 0, 1170, 0, 1620)
    s.put(scale_w(btn, int(CW * 0.92)))
    note_wrapped(s, '待命 / 提取中：暖黑面 + 浅蓝字 + 浅蓝边，在黑色页面上不再是一块亮板；', dy=14)
    note_wrapped(s, '成功 / 失败：底色保持亮绿亮红（就一两秒，亮一点才看得见），文字换近黑字，不再用会糊掉的白字。', dy=0)
    s.gap(12)

    # ---------- 04 深色站点上的浮窗 ----------
    s.section('深色站点 · 浮窗自动换暖黑',
              '不跟系统走，跟站点底色走 —— 用户看的是页面，不是操作系统的设置。')

    fw = shot('fw_light')
    # 预览页上半是浅色带、下半是深色带（脚本扫描出来的边界，别改成估算）
    fw_dark = crop(fw, 1058, 2117, 0, 1260)
    s.put(scale_w(fw_dark, CW))
    note_wrapped(s, '表格线、正文、标题栏、搜索框、按钮全部跟着换：它们原先都写死色值，这轮统一收进 --cm-* 变量。', dy=14)
    note_wrapped(s, '判断方式：读页面 body / html 的背景色算相对亮度，低于 0.4 判深色；读不到色（背景图、渐变）'
           '才退回系统设置。站点自己切深色也能跟上（监听 html/body 的 class、style 变化）。', dy=0)
    s.gap(12)

    # ---------- 05 浅色对照 ----------
    s.section('浅色站点（对照）：逐像素没变',
              '所有颜色都写成 var(--cm-x, 原值)，变量不生效时自动退回原色，所以浅色下和改动前完全一样。')

    fw_light = crop(fw, 0, 1057, 0, 1260)
    s.put(scale_w(fw_light, CW))
    note_wrapped(s, '这一组是回归护栏：改配色最怕「改 A 处、B 处跟着变」，深色开关加完之后浅色必须一动不动。', dy=14)
    s.gap(12)

    # ---------- 06 没变的与剩下的 ----------
    s.section('这轮没碰的 / 还剩什么', None)
    for line in [
        '· 设置页只换了配色，交互、布局、文案一处没动。',
        '· 深色不是新增开关：站点是深色就自动深色，少一个「我该选哪个」的决策点。',
        '· 成功 / 失败态仍然是亮色块，只是文字颜色跟着底翻 —— 这是刻意的，不是漏改。',
        '· 还剩：12 个吉祥物形态备用（hero-love / hero-think / hero-cheer 等，改一行名字就能用上）。',
        '· 还剩：四态表情仍搁置（你上轮说「以后有时间再改」，代码里的口子还留着）。',
    ]:
        s.text(PAD, s.y, line, font(19), INK2)
        s.y += 36
    s.gap(20)

    out = s.img.crop((0, 0, W, s.y + PAD))
    out.save(OUT)
    print('已生成', os.path.relpath(OUT, ROOT), out.size)


if __name__ == '__main__':
    main()
