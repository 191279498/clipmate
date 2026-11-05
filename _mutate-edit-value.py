# -*- coding: utf-8 -*-
"""
浮窗两处调整的变异测试（v2.12.1）

做法：把源码故意改坏一处 → 跑 tests/modal-edit-value.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-edit-value.py
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src')
TEST = os.path.join(ROOT, 'tests', 'modal-edit-value.test.js')

STYLES = os.path.join(SRC, 'content', 'ui', 'floating-window-styles.js')
PAGE_CSS = os.path.join(SRC, 'content', 'content-styles.css')
TR = os.path.join(SRC, 'content', 'ui', 'modal-table-renderer.js')
ED = os.path.join(SRC, 'content', 'ui', 'modal-edit-mode.js')
DP = os.path.join(SRC, 'content', 'ui', 'modal-data-processor.js')
MG = os.path.join(SRC, 'content', 'ui', 'modal-manager.js')

# (编号, 说明, 目标文件, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '表头列宽退回写死 120px（浮窗里又出现一大片空白）',
        STYLES,
        "  width: 1%;\n  white-space: nowrap;\n  text-align: right;",
        "  width: 120px;\n  white-space: nowrap;\n  text-align: right;",
    ),
    (
        'M2',
        '页面降级样式没跟上（不分 Shadow 的站点仍是 120px）',
        PAGE_CSS,
        "  width: 1%;\n  white-space: nowrap;\n  text-align: right;",
        "  width: 120px;\n  white-space: nowrap;\n  text-align: right;",
    ),
    (
        'M3',
        '去掉 nowrap（1% 被折行顶回去，宽度改了个寂寞）',
        STYLES,
        "  width: 1%;\n  white-space: nowrap;\n  text-align: right;",
        "  width: 1%;\n  text-align: right;",
    ),
    (
        'M4',
        '编辑模式双击不再进值编辑（只剩表头能改）',
        TR,
        "      if (this.isEditMode) {\n"
        "        e.preventDefault();\n"
        "        if (typeof this.startFieldValueEditing === 'function') {\n"
        "          this.startFieldValueEditing(cell);\n"
        "        }\n"
        "        return;\n"
        "      }",
        "      if (this.isEditMode) return;",
    ),
    (
        'M5',
        '非编辑模式双击也去改值（把双击复制抢了）',
        TR,
        "      if (this.isEditMode) {\n"
        "        e.preventDefault();",
        "      if (true) {\n"
        "        e.preventDefault();",
    ),
    (
        'M6',
        '编辑模式表格不挂 is-editing（格子看不出能双击改）',
        TR,
        '<table class="data-table vertical-table${this.isEditMode ? \' is-editing\' : \'\'}" id="dataTable">',
        '<table class="data-table vertical-table" id="dataTable">',
    ),
    (
        'M7',
        '保存只改 DOM 不改 data（复制出去还是旧值）',
        ED,
        "        this.data[fieldName] = nextValue;",
        "        // 变异：不写回数据",
    ),
    (
        'M8',
        'Enter 不保存（只能靠点别处）',
        ED,
        "        if (e.key === 'Enter' && !e.shiftKey) {",
        "        if (e.key === 'Enter' && !e.shiftKey && false) {",
    ),
    (
        'M9',
        '手改 URL 不置保护标记（一重渲染就被自动合并盖回去）',
        ED,
        "          this._urlManuallyEdited = true;",
        "          this._urlManuallyEdited = false;",
    ),
    (
        'M10',
        '合并逻辑不认保护标记（手改值被跨站补链覆盖）',
        DP,
        "      if (this._urlManuallyEdited) return;",
        "      if (false) return;",
    ),
    (
        'M11',
        'ESC 关窗只挡表头输入框（在格子里按 Esc 把窗关了）',
        MG,
        "content.querySelector('.header-editor, .field-editor')",
        "content.querySelector('.header-editor')",
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
