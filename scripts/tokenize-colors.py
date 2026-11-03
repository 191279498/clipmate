"""把 content-styles.css / floating-window-styles.js 里的硬编码色换成 --cm-* 变量。

fallback 一律写原色值，所以替换后浅色观感与替换前逐像素一致；
深色靠给根元素加 .clipmate-dark 类切换同一组变量。

用法：
  python scripts/tokenize-colors.py            # 干跑，只报告会改哪些行
  python scripts/tokenize-colors.py --write    # 真正写入
"""

import re
import sys

# 色值 -> (变量名, 规范写法)
# 同一个变量名下可以有多个写法（如 #0a4fcb / #0458cc / #0448a6 都是「深蓝」），
# fallback 取各自原值，这样替换后颜色一个像素都不变。
MAP = {
    '#111820': ('ink', '#111820'),
    '#6B7278': ('ink2', '#6B7278'),
    '#9aa0a6': ('ink3', '#9aa0a6'),
    '#F7F6F2': ('bg', '#F7F6F2'),
    '#FFFFFF': ('white', '#FFFFFF'),
    '#F1EFE8': ('surface', '#F1EFE8'),
    '#E8E4D9': ('hover', '#E8E4D9'),
    '#E1DCD1': ('line', '#E1DCD1'),
    '#D9D3C5': ('line-mid', '#D9D3C5'),
    '#D5CFC1': ('line-soft', '#D5CFC1'),
    '#C9C3B5': ('line-faint', '#C9C3B5'),
    '#CBC5B7': ('line-strong', '#CBC5B7'),
    '#056BF4': ('blue', '#056BF4'),
    '#0a4fcb': ('blue-deep', '#0a4fcb'),
    '#0458cc': ('blue-deep', '#0458cc'),
    '#0448A6': ('blue-deep', '#0448A6'),
    '#EEF4FF': ('blue-soft', '#EEF4FF'),
    '#EAF7F0': ('ok-soft', '#EAF7F0'),
    '#0E7A3E': ('ok', '#0E7A3E'),
    '#0B5A2E': ('ok-deep', '#0B5A2E'),
    '#12a150': ('ok-bright', '#12a150'),
    '#FDECEC': ('err-soft', '#FDECEC'),
    '#B42318': ('err', '#B42318'),
    '#8C1D16': ('err-deep', '#8C1D16'),
    '#E0453C': ('err-bright', '#E0453C'),
    '#e5484d': ('err-bright2', '#e5484d'),
    '#c23038': ('err-deep2', '#c23038'),
    '#FDF3D6': ('warn-soft', '#FDF3D6'),
    '#FBF3CE': ('warn-soft2', '#FBF3CE'),
    '#E8C46A': ('warn-line', '#E8C46A'),
    '#0e7a3e': ('ok', '#0e7a3e'),
}

# 半透明色：整串精确匹配（含空格写法差异用宽松正则）
RGBA_MAP = {
    r'rgba\(\s*17\s*,\s*24\s*,\s*32\s*,\s*0?\.16\s*\)': ('ink-a16', 'rgba(17, 24, 32, 0.16)'),
    r'rgba\(\s*17\s*,\s*24\s*,\s*32\s*,\s*0?\.04\s*\)': ('ink-a04', 'rgba(17, 24, 32, 0.04)'),
    r'rgba\(\s*17\s*,\s*24\s*,\s*32\s*,\s*0?\.35\s*\)': ('ink-a35', 'rgba(17, 24, 32, 0.35)'),
    r'rgba\(\s*5\s*,\s*107\s*,\s*244\s*,\s*0?\.16\s*\)': ('blue-a16', 'rgba(5, 107, 244, 0.16)'),
    r'rgba\(\s*5\s*,\s*107\s*,\s*244\s*,\s*0?\.4\s*\)': ('blue-a40', 'rgba(5, 107, 244, 0.4)'),
    r'rgba\(\s*5\s*,\s*107\s*,\s*244\s*,\s*0?\.45\s*\)': ('blue-a45', 'rgba(5, 107, 244, 0.45)'),
    r'rgba\(\s*5\s*,\s*107\s*,\s*244\s*,\s*0?\.55\s*\)': ('blue-a55', 'rgba(5, 107, 244, 0.55)'),
    r'rgba\(\s*66\s*,\s*133\s*,\s*244\s*,\s*0?\.4\s*\)': ('blue-a40', 'rgba(66, 133, 244, 0.4)'),
    r'rgba\(\s*229\s*,\s*72\s*,\s*77\s*,\s*0?\.4\s*\)': ('err-a40', 'rgba(229, 72, 77, 0.4)'),
    r'rgba\(\s*229\s*,\s*72\s*,\s*77\s*,\s*0?\.55\s*\)': ('err-a55', 'rgba(229, 72, 77, 0.55)'),
    r'rgba\(\s*18\s*,\s*161\s*,\s*80\s*,\s*0?\.4\s*\)': ('ok-a40', 'rgba(18, 161, 80, 0.4)'),
    r'rgba\(\s*18\s*,\s*161\s*,\s*80\s*,\s*0?\.55\s*\)': ('ok-a55', 'rgba(18, 161, 80, 0.55)'),
    r'rgba\(\s*15\s*,\s*23\s*,\s*42\s*,\s*0?\.18\s*\)': ('shadow-a18', 'rgba(15, 23, 42, 0.18)'),
    r'rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.3\s*\)': ('shadow-a30', 'rgba(0, 0, 0, 0.3)'),
    r'rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.5\s*\)': ('shadow-a50', 'rgba(0, 0, 0, 0.5)'),
    r'rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0?\.12\s*\)': ('shadow-a12', 'rgba(0, 0, 0, 0.12)'),
}

FILES = [
    'ClipMate_chrome/src/content/content-styles.css',
    'ClipMate_chrome/src/content/ui/floating-window-styles.js',
]

write = '--write' in sys.argv
total = 0

for path in FILES:
    src = open(path, encoding='utf-8').read()
    lines = src.split('\n')
    out = []
    hits = []

    for no, line in enumerate(lines, 1):
        stripped = line.lstrip()
        # 注释行整行跳过：注释里的色值是给人看的说明，换成 var() 反而更难读
        if stripped.startswith('*') or stripped.startswith('/*') or stripped.startswith('//'):
            out.append(line)
            continue

        new = line
        for hexval, (name, canon) in MAP.items():
            pat = re.compile(re.escape(hexval), re.IGNORECASE if hexval.lower() != hexval else 0)
            if not pat.search(new):
                continue
            # #fff 不能在 #ffffff 中间命中：用词边界
            def repl(m, name=name, canon=canon):
                return 'var(--cm-%s, %s)' % (name, canon)
            new2 = pat.sub(repl, new)
            if new2 != new:
                hits.append((no, hexval, name))
                new = new2

        for pat_str, (name, canon) in RGBA_MAP.items():
            pat = re.compile(pat_str, re.IGNORECASE)
            if not pat.search(new):
                continue
            new2 = pat.sub('var(--cm-%s, %s)' % (name, canon), new)
            if new2 != new:
                hits.append((no, 'rgba->' + name, name))
                new = new2

        out.append(new)

    print('=' * 60)
    print(path, '  命中', len(hits), '处')
    for no, what, name in hits[:80]:
        print('  L%-4d %-22s -> --cm-%s' % (no, what, name))
    if len(hits) > 80:
        print('  ... 还有', len(hits) - 80, '处')
    total += len(hits)

    if write:
        open(path, 'w', encoding='utf-8').write('\n'.join(out))

print('=' * 60)
print('合计', total, '处', '（已写入）' if write else '（干跑，未写入）')
