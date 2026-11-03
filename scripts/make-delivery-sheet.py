# -*- coding: utf-8 -*-
"""
合成 v2.9.2 交付图（一张长图，从上到下讲清吉祥物换到了哪些位置）。

为什么用脚本而不是手拼：这轮改了 19 个文件、23 个形态，图里每一块都要
跟真正的截图对上；手拼一次就得重拼一次，改一个尺寸全废。

素材全部来自 _shots/（由 scripts/shoot-previews.py 用真代码截出来）与
ClipMate_chrome/icons/ 里的真图标，脚本只做裁剪、缩放、排版，不重绘任何界面。

用法：
    python scripts/shoot-previews.py        # 先有截图
    python scripts/make-delivery-sheet.py   # 再合成
"""

import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '_shots')
ICONS = os.path.join(ROOT, 'ClipMate_chrome', 'icons')
OUT = os.path.join(ROOT, 'v2.9.2_吉祥物全面替换_交付图_20261103.png')

W = 1400                     # 画布宽
PAD = 64                     # 左右留白
CW = W - PAD * 2             # 内容宽 1272

INK = (17, 24, 32)
INK2 = (54, 62, 72)
GRAY = (122, 130, 138)
BLUE = (5, 107, 244)
HAIR = (225, 220, 209)
BAND = (241, 239, 232)

FONT_DIR = r'C:\Windows\Fonts'
f_reg = os.path.join(FONT_DIR, 'msyh.ttc')
f_bold = os.path.join(FONT_DIR, 'msyhbd.ttc')


def font(size, bold=False):
    return ImageFont.truetype(f_bold if bold else f_reg, size)


def trim(im, bg=(255, 255, 255), tol=6):
    """裁掉四周纯色留白（截图里到处都是，留着会把版面撑散）"""
    im = im.convert('RGB')
    px = im.load()
    w, h = im.size
    left, top, right, bot = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if abs(c[0] - bg[0]) > tol or abs(c[1] - bg[1]) > tol or abs(c[2] - bg[2]) > tol:
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bot: bot = y
    if right <= left:
        return im
    return im.crop((left, top, right + 1, bot + 1))


def box(im, cx0, cy0, cx1, cy1, bg=(255, 255, 255)):
    """在截图里按坐标取一块，再自动裁掉空白"""
    return trim(im.crop((cx0, cy0, cx1, cy1)), bg)


def scale(im, s):
    return im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)


def scale_w(im, w):
    return scale(im, w / im.width)


class Sheet:
    def __init__(self):
        self.img = Image.new('RGB', (W, 7000), 'white')
        self.d = ImageDraw.Draw(self.img)
        self.y = 0
        self.num = 0

    def text(self, x, y, s, f, fill=INK):
        self.d.text((x, y), s, font=f, fill=fill)

    def gap(self, h):
        self.y += h

    def title(self, s, sub=None):
        self.y += 54
        self.text(PAD, self.y, s, font(38, True), INK)
        self.y += 58
        if sub:
            self.text(PAD, self.y, sub, font(20), GRAY)
            self.y += 34
        self.y += 20
        self.d.rectangle((PAD, self.y, PAD + 74, self.y + 5), fill=BLUE)
        self.y += 32

    def section(self, title, caption=None):
        self.num += 1
        self.y += 14
        self.d.line((PAD, self.y, W - PAD, self.y), fill=HAIR, width=1)
        self.y += 28
        self.text(PAD, self.y + 4, '%02d' % self.num, font(19, True), BLUE)
        self.text(PAD + 46, self.y, title, font(25, True), INK2)
        self.y += 44
        if caption:
            self.text(PAD + 46, self.y, caption, font(17), GRAY)
            self.y += 30
        self.y += 6

    def note(self, s, dy=10):
        """图下的一行小字说明"""
        self.text(PAD, self.y + dy, s, font(16), GRAY)
        self.y += dy + 26

    def put(self, im, x=None, dy=0):
        x = PAD if x is None else x
        self.y += dy
        self.img.paste(im, (int(x), int(self.y)))
        self.y += im.height

    def put_row(self, items, gap=34, align='top'):
        """items: [(图, 说明文字 or None)]"""
        x = PAD
        hmax = max(i.height for i, _ in items)
        for im, cap in items:
            yy = self.y if align == 'top' else self.y + (hmax - im.height)
            self.img.paste(im, (int(x), int(yy)))
            if cap:
                tw = self.d.textlength(cap, font=font(16))
                self.text(x + (im.width - tw) / 2, self.y + hmax + 12, cap, font(16), GRAY)
            x += im.width + gap
        self.y += hmax + (40 if any(c for _, c in items) else 0)


def main():
    s = Sheet()

    s.title('采媒灵 v2.9.2 · 吉祥物全面替换（23 个矢量形态）',
            '应用图标 = 混合 · 主按钮 = 全身像 · 三处新位置全上')

    # ---------- 01 应用图标 ----------
    s.section('应用图标 —— 混合方案（16/32 头部特写，48/128 全身像）')
    sizes = (16, 32, 48, 128)
    icons = [Image.open(os.path.join(ICONS, 'icon%d.png' % n)).convert('RGBA') for n in sizes]
    band_h = 216
    s.d.rounded_rectangle((PAD, s.y, W - PAD, s.y + band_h), 12, fill=BAND)
    slot = (CW - 40) / len(sizes)
    for i, (n, im) in enumerate(zip(sizes, icons)):
        cx = PAD + 20 + slot * i + slot / 2
        top = s.y + (band_h - 34 - im.height) / 2 + 6
        s.img.paste(im, (int(cx - im.width / 2), int(top)), im)
        lab = '%d px' % n
        tw = s.d.textlength(lab, font=font(16))
        s.text(cx - tw / 2, s.y + band_h - 34, lab, font(16), GRAY)
    s.y += band_h
    s.note('四档都是真文件（icons/icon{16,32,48,128}.png），按原大摆在这儿；'
           '小尺寸靠脸，大尺寸才有地方放全身。', dy=14)
    s.gap(18)

    # 16px 放大看
    z = Image.open(os.path.join(ICONS, 'icon16.png')).convert('RGBA')
    z = z.resize((z.width * 5, z.height * 5), Image.NEAREST)
    ztop = s.y
    s.img.paste(z, (PAD + 6, ztop), z)
    tx = PAD + z.width + 52
    s.text(tx, ztop + 8, '16px 放大 5 倍（像素原样放大，没做任何修饰）', font(18, True), INK2)
    s.text(tx, ztop + 44, '工具栏上只剩这么点地方，所以 16/32 换成头部特写：', font(17), GRAY)
    s.text(tx, ztop + 74, '脸和眼睛差不多大了一倍，才不会糊成一团白。', font(17), GRAY)
    s.y = ztop + z.height + 30

    # ---------- 02 提取按钮 ----------
    s.section('提取按钮 —— 四态全身像（待命举纸 / 提取中 / 完成抱绿勾 / 失败哭）',
              '按钮是注入到网页里的那颗胶囊；头像是真代码渲染出来的，不是画上去的示意图')
    btn = Image.open(os.path.join(SHOTS, 'btn_light.png'))
    real_row = box(btn, 0, 80, btn.width, 230)
    s.put(scale(real_row, 0.5))
    s.note('真尺寸：按钮高 48px，头像是 80px 的球，故意探出按钮上下沿 9px 左右', dy=12)
    s.gap(26)

    zoom = box(btn, 0, 366, 1600, 1230)
    s.put(scale_w(zoom, min(CW, zoom.width)))
    s.note('细节：上面这张按 2.2 倍渲染后缩到画布宽，看头像画得准不准', dy=12)
    s.gap(26)

    # ---------- 03 逐帖小按钮 ----------
    s.section('逐帖小按钮 28px —— 社交列表每条右下角一个（X / 微博 / Instagram）')
    bandimg = box(btn, 0, 1540, btn.width, 1770, bg=BAND)
    s.put(scale(bandimg, 0.5))
    s.note('真尺寸：列表里每条内容旁边一颗，不抢正文', dy=12)
    s.gap(24)

    # 连预览页自带的说明一起裁进来：那几行文字也占着格子的宽度，
    # 单独切掉会出现「按钮间距忽大忽小」的假象（v2.9.2 第一版就这样）
    mini = box(btn, 0, 1895, 1400, 2230)
    s.put(scale(mini, 0.66))
    s.gap(26)

    # ---------- 04 读取提示条 ----------
    s.section('读取提示条 —— 提取超过 700ms 才出来，右上角，不吃点击',
              '没有做全屏遮罩：多数页面 100~300ms 就抓完了，遮罩只会闪一下')
    hint = box(btn, 0, 1320, 1100, 1470)
    s.put(scale(hint, 1.4))
    s.note('上图为实际大小的 1.4 倍（真宽 190px）；自动提取（开页就抓）不弹这条，免得每次开页都闪一下', dy=12)
    s.gap(26)

    # ---------- 05 弹窗 ----------
    s.section('弹窗 popup —— 五种状态都换上了吉祥物',
              '头部那只 = 当前这个站；没收录的站 = 探头看；浏览器内部页 = 一脸懵')
    pw = 322

    def pop(name):
        return scale_w(trim(Image.open(os.path.join(SHOTS, name + '.png'))), pw)

    s.put_row([(pop('normal_light'), '正常 · 浅色'),
               (pop('empty_light'), '没收录的站 · 浅色'),
               (pop('chrome_light'), '浏览器内部页')], gap=46)
    s.gap(26)
    s.put_row([(pop('normal_dark'), '正常 · 深色'),
               (pop('empty_dark'), '没收录的站 · 深色')], gap=46)
    s.gap(20)

    # ---------- 06 设置页 ----------
    s.section('设置页 —— 品牌位加齿轮头，关于页加挥手像，搜不到站举放大镜',
              '注意：设置页整体还是原来的紫灰配色，这轮只加吉祥物、没动配色（等你另行决定）')
    oa = Image.open(os.path.join(SHOTS, 'opt_about.png'))
    oe = Image.open(os.path.join(SHOTS, 'opt_empty.png'))
    s.put(scale_w(box(oa, 0, 40, oa.width, 1330), CW))
    s.note('关于页：左上品牌位换成齿轮头（调设置的地方，它也在拧旋钮），右上角加挥手像', dy=12)
    s.gap(26)
    s.put(scale_w(box(oe, 0, 40, oe.width, 760), CW))
    s.note('网站页搜不到：不写一句干巴巴的「无结果」，让它举着放大镜出来说', dy=12)
    s.gap(20)

    # 品牌位放大
    brand = box(oa, 18, 40, 420, 140)
    bs = brand.resize((int(brand.width * 1.6), int(brand.height * 1.6)), Image.LANCZOS)
    y0 = s.y
    s.img.paste(bs, (PAD, y0))
    s.text(PAD + bs.width + 48, y0 + 14, '品牌位那只头（齿轮形态）', font(18, True), INK2)
    s.text(PAD + bs.width + 48, y0 + 50, '26px，只放得下脑袋，所以用 face-gear 而不是全身像。', font(17), GRAY)
    s.y = y0 + bs.height + 26

    # ---------- 07 浮窗 ----------
    s.section('浮窗标题栏 —— 最左边加了一只头（宽窗 / 窄窗 / 改动前对照）',
              '加头像后标题栏改左对齐、关闭按钮靠右顶住，复制/导出/搜索的位置跟以前一模一样')
    fw = trim(Image.open(os.path.join(SHOTS, 'fw.png')))
    s.put(scale_w(fw, CW * 0.8))
    s.note('三段的按钮位置逐像素对齐 —— 加头像没有把按钮挤动', dy=12)

    # ---------- 收尾 ----------
    s.gap(30)
    s.d.line((PAD, s.y, W - PAD, s.y), fill=HAIR)
    s.y += 22
    s.text(PAD, s.y, '素材：icons/mascot/ 下 23 个 SVG（全身 15 + 头部 8），旧的 mascot.png 已删，'
                     '备份在 backups/v292-吉祥物全面替换-20261103-1108/', font(16), GRAY)
    s.y += 28

    out = s.img.crop((0, 0, W, s.y + 36))
    out.save(OUT)
    print('已生成', os.path.relpath(OUT, ROOT), out.size)


if __name__ == '__main__':
    main()
