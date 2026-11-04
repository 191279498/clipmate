# -*- coding: utf-8 -*-
"""
影视类链接合并变异测试（v2.11.2）

做法：把源码故意改坏一处 → 跑 tests/movie-link-merge.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-movie-link.py
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src')
TEST = os.path.join(ROOT, 'tests', 'movie-link-merge.test.js')

MT = os.path.join(SRC, 'shared', 'config', 'media-types.js')
DP = os.path.join(SRC, 'content', 'ui', 'modal-data-processor.js')
TR = os.path.join(SRC, 'content', 'ui', 'modal-table-renderer.js')

# (编号, 说明, 目标文件, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '字段清单没改（三键还在、URL 不在）',
        MT,
        "'豆瓣链接', 'URL', '导演', '编剧', '主演',",
        "'豆瓣链接', 'IMDB', 'TMDB', 'Bangumi', '导演', '编剧', '主演',",
    ),
    (
        'M2',
        'URL 段不带站名前缀（红果又变成裸地址）',
        DP,
        "parts.push(label + '：' + value);",
        "parts.push(value);",
    ),
    (
        'M3',
        '三键不从 fieldOrder 里摘掉（页面上又冒出 IMDB/TMDB/Bangumi 三行）',
        DP,
        "this.fieldOrder = this.fieldOrder.filter((field) => LINK_KEYS.indexOf(field) === -1);",
        "this.fieldOrder = this.fieldOrder.filter(() => true);",
    ),
    (
        'M4',
        '折叠阈值退回 120（三链接一打开就被截）',
        TR,
        "const LIMIT = 200;",
        "const LIMIT = 120;",
    ),
    (
        'M5',
        '准备阶段不再合并（只有清单变了，页面还是原样）',
        DP,
        "    // v2.11.2：影视类把 IMDB / TMDB / Bangumi 并进 URL 一格（须在字段名映射之后、排序之前）\n    this._mergeLinksIntoUrl();",
        "    // 变异：接线断开",
    ),
    (
        'M6',
        '去掉同址去重（本页地址与 IMDB 同址时出现两遍）',
        DP,
        "if (!value || seen[value]) return;",
        "if (!value) return;",
    ),
    (
        'M7',
        '影视 URL 不走合并格渲染（回到纯文本，点不开）',
        TR,
        "&& fieldName === 'URL' && displayValue) {\n        return this._buildMergedLinkCell(displayValue);",
        "&& fieldName === 'URL' && false) {\n        return this._buildMergedLinkCell(displayValue);",
    ),
]


def run_test():
    env = dict(os.environ)
    env['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    p = subprocess.run(
        ['node', TEST],
        cwd=ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    return p.returncode, p.stdout.decode('utf-8', 'replace')


def eol_variants(text):
    """同一个片段在 LF / CRLF 两种行尾下都试一遍（本项目两种文件混着有）。"""
    return [text, text.replace('\n', '\r\n')]


def main():
    originals = {}
    for mid, desc, target, old, new in MUTATIONS:
        if target not in originals:
            originals[target] = open(target, 'rb').read()

    texts = {k: v.decode('utf-8') for k, v in originals.items()}

    code, out = run_test()
    print('基线：', '绿' if code == 0 else '红')
    if code != 0:
        print(out)
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
                print('✗ %s 原文定位失败（LF/CRLF 各试一次都没恰好命中 1 次）：%s' % (mid, old))
                survived.append(mid + '(定位失败)')
                continue
            old_v, new_v = hit

            io.open(target, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v))
            code, out = run_test()
            status = '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'
            print('%s %s → %s' % (mid, desc, status))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('✗ '):
                        print('     失败点:', line.strip())
                        break
            # 每个变异跑完立刻还原，避免污染后面的变异
            io.open(target, 'w', encoding='utf-8', newline='').write(text)
    finally:
        for target, raw in originals.items():
            with open(target, 'wb') as f:
                f.write(raw)
            if open(target, 'rb').read() != raw:
                print('!! 还原失败：%s，请立刻手工恢复 !!' % target)
                return 2
        print('源码已逐字节还原（%d 个文件）' % len(originals))

    code, _ = run_test()
    print('还原后复跑：', '全绿 ✓' if code == 0 else '异常红 ✗')

    if survived:
        print('\n有 %d 处变异没被抓住：%s' % (len(survived), ', '.join(survived)))
        return 1
    print('\n%d/%d 全部变红，断言有效。' % (len(MUTATIONS), len(MUTATIONS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
