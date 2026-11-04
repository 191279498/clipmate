# -*- coding: utf-8 -*-
"""
红果提取器变异测试（v2.11.0）

做法：把源码故意改坏一处 → 跑 tests/hongguo-movie.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-hongguo.py
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'extractors', 'hongguo-movie.js')
TEST = os.path.join(ROOT, 'tests', 'hongguo-movie.test.js')

# (编号, 说明, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '数据层判据写窄（AI剧榜第1名 才算 AI剧）',
        "if (label.indexOf('AI剧') >= 0) return 'AI剧';",
        "if (label.indexOf('AI剧榜第1') >= 0) return 'AI剧';",
    ),
    (
        'M2',
        '去掉「演员表 → 真人剧」这条兜底',
        "if (this._celebrities().length > 0) return '真人剧';",
        "if (false) return '真人剧';",
    ),
    (
        'M3',
        '其他信息改用顿号分隔（与既有影视站格式不一致）',
        "return parts.join('，');",
        "return parts.join('、');",
    ),
    (
        'M4',
        '大数字不再保留一位小数（667.4万 → 667万）',
        "if (n >= 10000) return `${Math.round(n / 1000) / 10}万`;",
        "if (n >= 10000) return `${Math.floor(n / 10000)}万`;",
    ),
    (
        'M5',
        '国家不写死（v2.11.1 新增，红果数据层没有地区字段 → 这一格会空）',
        "fields['国家'] = '中国';",
        "fields['国家'] = '';",
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


def main():
    original = open(TARGET, 'rb').read()
    original_text = original.decode('utf-8')

    # 先确认基线是绿的，否则变异结论没有意义
    code, out = run_test()
    print('基线：', '绿' if code == 0 else '红')
    if code != 0:
        print(out)
        print('基线不是绿的，变异测试无意义，直接退出。')
        return 1

    survived = []
    try:
        for mid, desc, old, new in MUTATIONS:
            if original_text.count(old) != 1:
                print('✗ %s 原文出现 %d 次（必须恰好 1 次）：%s' % (mid, original_text.count(old), old))
                survived.append(mid + '(定位失败)')
                continue

            io.open(TARGET, 'w', encoding='utf-8', newline='').write(original_text.replace(old, new))
            code, out = run_test()
            status = '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'
            print('%s %s → %s' % (mid, desc, status))
            if code == 0:
                survived.append(mid)
                print(out[-1500:])
            else:
                # 打印第一行失败原因，方便确认红在了「预期的那条」上
                for line in out.splitlines():
                    if line.strip().startswith('✗ '):
                        print('     失败点:', line.strip())
                        break
    finally:
        # 逐字节还原
        with open(TARGET, 'wb') as f:
            f.write(original)
        restored = open(TARGET, 'rb').read()
        if restored != original:
            print('!! 还原失败，源码与原始字节不一致，请立刻手工恢复 !!')
            return 2
        print('源码已逐字节还原（%d 字节）' % len(restored))

    code, _ = run_test()
    print('还原后复跑：', '全绿 ✓' if code == 0 else '异常红 ✗')

    if survived:
        print('\n有 %d 处变异没被抓住：%s' % (len(survived), ', '.join(survived)))
        return 1
    print('\n%d/%d 全部变红，断言有效。' % (len(MUTATIONS), len(MUTATIONS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
