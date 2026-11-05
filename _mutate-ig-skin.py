# -*- coding: utf-8 -*-
"""
Instagram 站内跳转皮肤跟随的变异测试（v2.12.5）

做法：把源码故意改坏一处 → 跑 tests/page-shape.test.js 与 tests/ig-skin-follow.test.js
→ 至少要有一个变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-ig-skin.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
PAGE_SHAPE = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'utils', 'page-shape.js')
CONTENT_MAIN = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'content-main.js')
IG_MIXIN = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'ig-spa-handler.js')

TESTS = [
    os.path.join(ROOT, 'tests', 'page-shape.test.js'),
    os.path.join(ROOT, 'tests', 'ig-skin-follow.test.js'),
]

IG_HOST_LINE = "    'space.bilibili.com',\n    'instagram.com'\n"

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '把 IG 从地址监听白名单里删掉（就是 v2.12.2 那个原始状态：皮肤永远停在主页算好的那个）',
        PAGE_SHAPE,
        IG_HOST_LINE,
        "    'space.bilibili.com'\n",
    ),
    (
        'M2',
        '给 IG 补一条空规则（会算出 feed → 把 IG 自己的按钮藏掉，抢它的显隐主人）',
        PAGE_SHAPE,
        "  var RULES = {\n",
        "  var RULES = {\n    'instagram.com': { detail: [], allow: [] },\n",
    ),
    (
        'M3',
        'unknown 形态也去 setVisible(true)（把 IG 在列表页藏好的按钮翻出来）',
        CONTENT_MAIN,
        "      } else if (shape !== 'unknown') {\n        bm.setVisible(true);",
        "      } else if (true) {\n        bm.setVisible(true);",
    ),
    (
        'M4',
        '皮肤只在 person 时换、其余保持原样（= 用户报的那个 bug：帖子页仍顶着「整理档案」）',
        CONTENT_MAIN,
        "bm.setSkin(shape === 'person' ? 'arch' : 'default');",
        "bm.setSkin(shape === 'person' ? 'arch' : (bm._skin || 'default'));",
    ),
    (
        'M5',
        'IG 混入里另起一套换肤（两套各算各的，迟早漂移）',
        IG_MIXIN,
        "    _syncInstagramEntryVisibility() {\n",
        "    _syncInstagramEntryVisibility() {\n"
        "    if (this.buttonManager && typeof this.buttonManager.setSkin === 'function') {\n"
        "      this.buttonManager.setSkin('default');\n"
        "    }\n",
    ),
]


def run_tests():
    env = dict(os.environ)
    env['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    for t in TESTS:
        p = subprocess.run(
            ['node', t],
            cwd=ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        if p.returncode != 0:
            return p.returncode, p.stdout.decode('utf-8', 'replace'), os.path.basename(t)
    return 0, '', ''


def eol_variants(text):
    """同一个片段在 LF / CRLF 两种行尾下都试一遍（本项目两种文件混着有）。"""
    return [text, text.replace('\n', '\r\n')]


def main():
    originals = {}
    texts = {}
    for f in {PAGE_SHAPE, CONTENT_MAIN, IG_MIXIN}:
        raw = open(f, 'rb').read()
        originals[f] = raw
        texts[f] = raw.decode('utf-8')

    code, out, which = run_tests()
    print('基线：', '绿' if code == 0 else '红（' + which + '）')
    if code != 0:
        print(out[-2000:])
        print('基线不是绿的，变异测试无意义，直接退出。')
        return 1

    survived = []
    try:
        for mid, desc, target, old, new in MUTATIONS:
            text = texts[target]
            hit = None
            for old_v, new_v in zip(eol_variants(old), eol_variants(new)):
                if text.count(old_v) == 1:
                    hit = (old_v, new_v)
                    break
            if not hit:
                print('✗ %s 原文定位失败（LF/CRLF 各试一次都没恰好命中 1 次）：%s' % (mid, desc))
                survived.append(mid + '(定位失败)')
                continue
            old_v, new_v = hit

            io.open(target, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v))
            code, out, which = run_tests()
            print('%s %s → %s' % (mid, desc, '变红 ✓ (' + which + ')' if code != 0 else '仍然全绿 ✗（这条断言是假的）'))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('✗') or line.strip().startswith('·'):
                        print('     失败点:', line.strip()[:150])
                        break
            io.open(target, 'w', encoding='utf-8', newline='').write(text)
    finally:
        same_all = True
        for f, raw in originals.items():
            with open(f, 'wb') as fh:
                fh.write(raw)
            if open(f, 'rb').read() != raw:
                same_all = False
        print('\n还原逐字节一致：', same_all)
        print('存活变异：', survived if survived else '无（全部变红）')
    return 0 if not survived else 1


if __name__ == '__main__':
    raise SystemExit(main())
