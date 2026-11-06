# -*- coding: utf-8 -*-
"""
v2.12.7 吉祥物内联（干掉 chrome-extension:// 跨源告警）的变异测试

做法：把源码故意改坏一处 → 跑 tests/mascot-inline.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言（本项目铁律）。

跑法（项目根目录）：
    python _mutate-mascot-inline.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content')
INLINE = os.path.join(BASE, 'shared', 'mascot-inline.js')
RESOLVER = os.path.join(BASE, 'shared', 'mascot-url.js')
BTN = os.path.join(BASE, 'ui', 'button-manager.js')
FLOAT = os.path.join(BASE, 'ui', 'floating-window.js')
DOUBAN = os.path.join(BASE, 'ui', 'douban-list-buttons.js')
IG = os.path.join(BASE, 'ui', 'instagram-feed-buttons.js')
WEIBO = os.path.join(BASE, 'ui', 'weibo-feed-buttons.js')
XF = os.path.join(BASE, 'ui', 'x-feed-buttons.js')
MANIFEST = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')
TEST = os.path.join(ROOT, 'tests', 'mascot-inline.test.js')

INLINE_BLOCK = (
    "    try {\n"
    "      if (typeof ClipMateMascot !== 'undefined' && ClipMateMascot &&\n"
    "          typeof ClipMateMascot.url === 'function') {\n"
    "        const inline = ClipMateMascot.url(rel);\n"
    "        if (inline) return inline;\n"
    "      }\n"
    "    } catch (e) { /* 解析器不可用就走下面的老路 */ }\n"
)

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    (
        'M1', '主按钮不再走内联（页面里又出现 chrome-extension://，用户看到的就是这条）',
        BTN, INLINE_BLOCK, "    // 变异：内联优先整块搬走\n",
    ),
    (
        'M2', '主按钮删掉 getURL 兜底（解析器缺席时头像位直接空掉）',
        BTN,
        "    try {\n"
        "      if (typeof chrome !== 'undefined' && chrome.runtime &&\n"
        "          typeof chrome.runtime.getURL === 'function') {\n"
        "        return chrome.runtime.getURL(rel);\n"
        "      }\n"
        "    } catch (e) { /* 测试环境没有 runtime */ }\n"
        "    return '';",
        "    return '';",
    ),
    (
        'M3', '解析器删掉 getURL 兜底（新加了图没重跑生成脚本 → 直接白图）',
        RESOLVER,
        "    return runtimeUrl(name);",
        "    return '';",
    ),
    (
        'M4', '解析器只认裸名字，不认 icons/mascot/x.svg 路径（主按钮传的正是路径）',
        RESOLVER,
        "    var m = /([A-Za-z0-9_-]+)\\.svg$/i.exec(s);\n"
        "    if (m) return m[1];\n",
        "    // 变异：路径形态不识别\n",
    ),
    (
        'M5', '生成物键名被改坏（hero-archive 那张实际上取不到了）',
        INLINE,
        "'hero-archive': 'data:image/svg+xml,",
        "'hero-archiveX': 'data:image/svg+xml,",
    ),
    (
        'M6', '内联分支只剩注释（注释里提到方法名不该被算作实现）',
        BTN,
        "        const inline = ClipMateMascot.url(rel);\n"
        "        if (inline) return inline;\n",
        "        // const inline = ClipMateMascot.url(rel);\n"
        "        // if (inline) return inline;\n",
    ),
    (
        'M7', 'manifest 不再注册解析器（真机上 ClipMateMascot 直接不存在）',
        MANIFEST,
        '        "src/content/shared/mascot-url.js",\n',
        '',
    ),
    (
        'M8', '微博列表按钮不走解析器（那条链路悄悄回退成 chrome-extension://）',
        WEIBO,
        "        var inline = ClipMateMascot.url(rel);\n"
        "        if (inline) return inline;",
        "        var inline = '';\n"
        "        if (inline) return inline;",
    ),
]


def run_tests():
    env = dict(os.environ)
    env['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    p = subprocess.run(
        ['node', TEST], cwd=ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return p.returncode, p.stdout.decode('utf-8', 'replace')


def eol_variants(text):
    """同一个片段在 LF / CRLF 两种行尾下都试一遍（本项目两种文件混着有）。"""
    return [text, text.replace('\n', '\r\n')]


def main():
    files = {INLINE, RESOLVER, BTN, FLOAT, DOUBAN, IG, WEIBO, XF, MANIFEST}
    originals = {}
    texts = {}
    for f in files:
        raw = open(f, 'rb').read()
        originals[f] = raw
        texts[f] = raw.decode('utf-8')

    code, out = run_tests()
    print('基线：', '绿' if code == 0 else '红')
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
            code, out = run_tests()
            print('%s %s → %s' % (mid, desc, '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('✗') or line.strip().startswith('- '):
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
    return 0 if not survived and same_all else 1


if __name__ == '__main__':
    raise SystemExit(main())
