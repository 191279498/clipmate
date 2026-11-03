# -*- coding: utf-8 -*-
"""变异验证：把 v2.9.5 抖音切条修复的三个关键点分别改坏，确认测试会红。

铁律：改坏 → 测试变红 → 逐字节还原。任何一项没红，说明那条断言是摆设。
"""
import io
import subprocess
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
CTX = os.path.join(ROOT, 'ClipMate_chrome/src/content/shared/douyin-modal-context.js')
HANDLER = os.path.join(ROOT, 'ClipMate_chrome/src/content/ui/douyin-spa-handler.js')
TEST = 'tests/douyin-switch-reuse.test.js'

MUTATIONS = [
    (
        CTX,
        'm1 去掉 attributes 监听（只盯 childList）',
        "        attributes: true,\n        attributeFilter: ['class', 'data-e2e', 'data-e2e-aweme-id']\n",
        "        attributes: false\n",
    ),
    (
        CTX,
        'm2 resolve 丢掉 class 兜底（只认 info）',
        "      var feedId = activeIdInScope(d, scope);\n      if (feedId) id = feedId;",
        "      var feedId = '';\n      if (feedId) id = feedId;",
    ),
    (
        HANDLER,
        'm3 就地刷新不再按 ID 对账',
        "          if (this._isDouyinDataValid(data) && this._douyinDataMatchesTarget(data, targetId)) {",
        "          if (this._isDouyinDataValid(data)) {",
    ),
]


def run_test():
    env = dict(os.environ)
    env['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    p = subprocess.run(['node', TEST], cwd=ROOT, capture_output=True, text=True, env=env)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def main():
    results = []
    for path, name, old, new in MUTATIONS:
        src = io.open(path, encoding='utf-8').read()
        if old not in src:
            results.append((name, 'SKIP', '找不到要替换的片段'))
            continue
        io.open(path, 'w', encoding='utf-8', newline='').write(src.replace(old, new, 1))
        try:
            code, out = run_test()
        finally:
            io.open(path, 'w', encoding='utf-8', newline='').write(src)
        # 还原后校验逐字节一致
        back = io.open(path, encoding='utf-8').read()
        restored = (back == src)
        status = 'RED' if code != 0 else 'GREEN(未抓到!)'
        tail = [l for l in out.splitlines() if l.strip().startswith('-') or '失败' in l][:3]
        results.append((name, status, ('还原一致' if restored else '还原失败!') + ' | ' + ' / '.join(tail)))

    print('\n===== 变异结果 =====')
    bad = 0
    for name, status, detail in results:
        print(f'{status:14s} {name}\n               {detail}')
        if status != 'RED':
            bad += 1
    print(f'\n{len(results) - bad}/{len(results)} 变红')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
