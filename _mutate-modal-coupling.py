# 变异验证（v2.9.7 联动）：把关键判断改坏，确认测试会红，然后逐字节还原。
# 用法: python _mutate-modal-coupling.py
import io, os, subprocess, hashlib

ROOT = os.path.dirname(os.path.abspath(__file__))
ENV = dict(os.environ)
ENV['NODE_PATH'] = r'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'

FILES = {
    'modal': os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'modal-window.js'),
    'fw': os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'floating-window.js'),
    'btn': os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'button-manager.js'),
}

# (名字, 目标文件, 旧串, 新串, 期望失败的断言文案, replace_all)
MUTATIONS = [
    (
        '① 拆掉浮窗侧刚体回收（按钮到边浮窗不停）',
        'modal',
        'if (fdx !== dx || fdy !== dy) {',
        'if (false) {',
        '按钮到 0 后不再负|浮窗只跟到按钮停下为止（刚体）',
        False,
    ),
    (
        '② 拆掉按钮侧浮窗钳制（拖按钮浮窗冲出视口）',
        'modal',
        "const nfx = Math.max(gap, Math.min(prevFw.x + dx, window.innerWidth - fw.width - gap));",
        'const nfx = prevFw.x + dx;',
        '浮窗停在视口右缘内',
        False,
    ),
    (
        '③ 拆掉高度自适应上限（内容多高浮窗多高）',
        'fw',
        'this.height = Math.max(this.minHeight, Math.min(needed + headerH + 12, cap));',
        'this.height = needed + headerH + 12;',
        '内容 1500、上限 600 → 高度 600',
        False,
    ),
    (
        '④ 拆掉拖完落盘回调（按钮新位置不记忆）',
        'fw',
        "if (wasDragging && typeof this.onDragEnd === 'function') this.onDragEnd();",
        'if (false && typeof this.onDragEnd === "function") this.onDragEnd();',
        '拖完落盘 1 次',
        False,
    ),
    (
        '⑤ 拆掉窗口缩小的整对回位',
        'modal',
        'const dx = x - fw.x;\n        const dy = y - fw.y;\n        if (dx || dy) {',
        'const dx = x - fw.x;\n        const dy = y - fw.y;\n        if (false) {',
        '按钮被同一距离推回',
        False,
    ),
    (
        '⑥ 拆掉冻结起点（联动钳制下位移复利放大，真机豆瓣炸点）',
        'btn',
        'const o = this._dragOrigin || this._basePos;',
        'const o = this._basePos;',
        'D2 指针总共',
        False,
    ),
    (
        '⑦ 拆掉 autoFit 后的整窗收回（底部出屏不管）',
        'modal',
        'fw.y = Math.min(fw.y, maxY);',
        '/* mutated */',
        '底部出屏',
        False,
    ),
]

ORIGINALS = {}
HASHES = {}
TEXTS = {}
for key, path in FILES.items():
    with io.open(path, 'rb') as f:
        ORIGINALS[key] = f.read()
    HASHES[key] = hashlib.sha256(ORIGINALS[key]).hexdigest()
    TEXTS[key] = ORIGINALS[key].decode('utf-8').replace('\r\n', '\n')

results = []
try:
    for name, fkey, old, new, expect, replace_all in MUTATIONS:
        count = TEXTS[fkey].count(old)
        if count == 0:
            results.append((name, 'SKIP', '没找到目标代码（源码已变，请同步更新本脚本）'))
            continue
        mutated = TEXTS[fkey].replace(old, new) if replace_all else TEXTS[fkey].replace(old, new, 1)
        with io.open(FILES[fkey], 'wb') as f:
            f.write(mutated.encode('utf-8'))

        proc = subprocess.run(
            ['node', os.path.join(ROOT, 'tests', 'modal-coupling.test.js')],
            cwd=ROOT, env=ENV, capture_output=True, text=True, encoding='utf-8', errors='replace'
        )
        out = (proc.stdout or '') + (proc.stderr or '')
        turned_red = proc.returncode != 0
        hit_expected = any(e in out for e in expect.split('|'))
        status = 'PASS' if (turned_red and hit_expected) else ('FAIL(没红)' if not turned_red else 'FAIL(红错了地方)')
        detail = 'exit=%d' % proc.returncode
        results.append((name, status, detail))

        with io.open(FILES[fkey], 'wb') as f:
            f.write(ORIGINALS[fkey])
finally:
    for key, path in FILES.items():
        with io.open(path, 'wb') as f:
            f.write(ORIGINALS[key])

restored_ok = True
for key, path in FILES.items():
    with io.open(path, 'rb') as f:
        if hashlib.sha256(f.read()).hexdigest() != HASHES[key]:
            restored_ok = False

print('')
ok_count = 0
for name, status, detail in results:
    mark = '✓' if status == 'PASS' else '✗'
    if status == 'PASS':
        ok_count += 1
    print('%s %s  (%s)' % (mark, name, detail))
print('')
print('变异命中 %d / %d' % (ok_count, len(MUTATIONS)))
print('还原校验：%s' % ('逐字节一致 ✓' if restored_ok else '不一致 ✗✗✗'))
