# -*- coding: utf-8 -*-
"""
抖音作者主页「简介」混进操作按钮文字的变异测试（v2.12.4）

做法：把源码故意改坏一处 → 跑 tests/douyin-profile.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-douyin-bio.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'extractors', 'douyin-profile.js')
TEST = os.path.join(ROOT, 'tests', 'douyin-profile.test.js')

GUARD = "|加入.{0,10}群聊"
GUARD_OLD = "|(已)?加入.{0,10}群聊"

# (编号, 说明, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '干脆不挡群聊按钮（就是用户报的那条：简介多一行「加入TA的群聊」）',
        GUARD_OLD,
        "",
    ),
    (
        'M2',
        '只挡「加入TA的群聊」字面量（换个账号显示「加入他的群聊」就漏）',
        GUARD_OLD,
        "|加入TA的群聊",
    ),
    (
        'M3',
        '漏掉「已加入群聊」这种状态按钮',
        GUARD_OLD,
        GUARD,
    ),
    (
        'M4',
        '正则收得过宽（`.*群聊` 行首锚定 → 签名里提群聊的句子被误杀）',
        GUARD_OLD,
        "|.*群聊",
    ),
    (
        'M5',
        '改成跳过而非硬停（按钮之后的按钮/元数据继续被当签名）',
        "      if (HARD_STOP.test(line)) break;",
        "      if (HARD_STOP.test(line)) continue;",
    ),
    (
        'M6',
        '整条 HARD_STOP 删掉（分享主页 / UID / 群聊全部混进简介）',
        "      if (HARD_STOP.test(line)) break;\n",
        "",
    ),
    (
        'M7',
        '护栏收得太窄（只容忍 1 个字符，「加入TA的群聊」就漏了）',
        GUARD_OLD,
        "|(已)?加入.{0,1}群聊",
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
    raw = open(SRC, 'rb').read()
    text = raw.decode('utf-8')

    code, out = run_test()
    print('基线：', '绿' if code == 0 else '红')
    if code != 0:
        print(out)
        print('基线不是绿的，变异测试无意义，直接退出。')
        return 1

    survived = []
    try:
        for mid, desc, old, new in MUTATIONS:
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

            io.open(SRC, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v))
            code, out = run_test()
            print('%s %s → %s' % (mid, desc, '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('✗'):
                        print('     失败点:', line.strip())
                        break
            io.open(SRC, 'w', encoding='utf-8', newline='').write(text)
    finally:
        with open(SRC, 'wb') as f:
            f.write(raw)
        same = open(SRC, 'rb').read() == raw
        print('\n还原逐字节一致：', same)
        print('存活变异：', survived if survived else '无（全部变红）')
    return 0 if not survived else 1


if __name__ == '__main__':
    raise SystemExit(main())
