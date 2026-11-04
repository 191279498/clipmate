# -*- coding: utf-8 -*-
"""
v2.10.0 变异验证：把关键实现逐条改坏，确认 page-shape.test.js 会变红。

为什么要做：断言写完立刻全绿，很可能是因为「断言根本没在检查那件事」。
只有把它改坏 → 变红 → 逐字节还原，才算真的测到了。

踩过的坑（写在脚本里防复发）：
  · 项目里多数文件是 CRLF，跨行匹配前必须先 normalize，否则 count=0；
  · 还原用**原始字节**回写，不靠反向替换（反替换的字符串一旦写错就还原不回来）；
  · 每条变异单独跑一次测试，避免两条互相掩盖。
"""

import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome')
TESTS = [
    os.path.join(ROOT, 'tests', 'page-shape.test.js'),
    os.path.join(ROOT, 'tests', 'archive-skin.test.js'),
]

ENV = dict(os.environ)
ENV['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'

MUTANTS = [
    (
        '作者主页不再放行（person 直接当信息流藏掉）',
        os.path.join(SRC, 'src/content/utils/page-shape.js'),
        "    if (ctx && ctx.mediaType === 'person') return 'person';",
        "    if (ctx && ctx.mediaType === 'person') return 'feed';",
    ),
    (
        '信息流页不藏大按钮（用户要的 ① 失效）',
        os.path.join(SRC, 'src/content/content-main.js'),
        "} else if (shape === 'feed') {",
        "} else if (shape === 'never-feed') {",
    ),
    (
        '档案皮肤不换图标（只剩配色变）',
        os.path.join(SRC, 'src/content/ui/button-manager.js'),
        "if (this._skin === 'arch' && (!state || state === 'normal')) {",
        "if (false) {",
    ),
    (
        '浮窗不再贴小按钮（退回贴大按钮 / 屏幕角）',
        os.path.join(SRC, 'src/content/ui/modal-window.js'),
        'const byClick = pick(this._anchorEl);',
        'const byClick = null;',
    ),
    (
        '档案底色被改成和普通按钮一样（分不出来）',
        os.path.join(SRC, 'src/content/content-styles.css'),
        '  --cm-arch-btn: #001FB5;',
        '  --cm-arch-btn: #056BF4;',
    ),
    (
        '地址监听不包 pushState（详情页进去按钮不出现）',
        os.path.join(SRC, 'src/content/content-main.js'),
        "      wrap('pushState');",
        "      wrap('popStateNever');",
    ),
    (
        '档案规则加了 button 前缀（会压住 success 的绿）',
        os.path.join(SRC, 'src/content/content-styles.css'),
        '.media-extractor-button.clipmate-arch {',
        'button.media-extractor-button.clipmate-arch {',
    ),
    (
        '换肤不切 class（配色不变，只剩图标和文案）',
        os.path.join(SRC, 'src/content/ui/button-manager.js'),
        "classList.toggle('clipmate-arch', next === 'arch')",
        "classList.toggle('clipmate-arch', false)",
    ),
    (
        '换肤文案判断写反（档案页显示「提取」）',
        os.path.join(SRC, 'src/content/ui/button-manager.js'),
        "if (last.textContent === this.LABEL_IDLE) last.textContent = this.LABEL_ARCH;",
        "if (last.textContent === this.LABEL_IDLE) last.textContent = this.LABEL_IDLE;",
    ),
]


def run_test():
    code, out = 0, ''
    for t in TESTS:
        p = subprocess.run(['node', t], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', env=ENV)
        if p.returncode != 0:
            code = p.returncode
        out += (p.stdout or '') + (p.stderr or '')
    return code, out


def main():
    results = []
    for name, path, old, new in MUTANTS:
        raw = io.open(path, 'rb').read()
        text = raw.decode('utf-8')
        norm = text.replace('\r\n', '\n')
        if norm.count(old) != 1:
            print('!! 匹配失败( %d 处): %s' % (norm.count(old), name))
            results.append((name, 'SKIP', norm.count(old)))
            continue
        mutated = norm.replace(old, new, 1)
        try:
            io.open(path, 'wb').write(mutated.replace('\n', '\r\n').encode('utf-8'))
            code, out = run_test()
            red = (code != 0)
            detail = ''
            if red:
                for line in out.splitlines():
                    if '失败' in line and '项' in line:
                        detail = line.strip()
                        break
            results.append((name, 'RED' if red else 'GREEN', detail))
            print(('  [红] ' if red else '  [绿!] ') + name + ('  ' + detail if detail else ''))
        finally:
            io.open(path, 'wb').write(raw)   # 逐字节还原

    code, out = run_test()
    print('')
    print('还原后测试：' + ('绿 ✓' if code == 0 else '红 ✗'))
    bad = [r for r in results if r[1] != 'RED']
    print('变异 %d 条，变红 %d 条，未变红 %d 条' % (len(results), len(results) - len(bad), len(bad)))
    for b in bad:
        print('  - ' + b[0] + ' → ' + b[1])
    return 0 if (code == 0 and not bad) else 1


if __name__ == '__main__':
    sys.exit(main())
