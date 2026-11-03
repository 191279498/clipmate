# 变异验证：把关键判断改坏，确认测试会红，然后逐字节还原。
# 用法: python _mutate-browse-dismiss.py
import io, os, subprocess, hashlib

ROOT = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'browse-dismiss.js')
ENV = dict(os.environ)
ENV['NODE_PATH'] = r'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'

with io.open(TARGET, 'rb') as f:
    ORIGINAL = f.read()
ORIG_HASH = hashlib.sha256(ORIGINAL).hexdigest()
TEXT = ORIGINAL.decode('utf-8')

MUTATIONS = [
    (
        '① 拆掉「浮窗内滚动不算」判断',
        'if (this._isInsideWindow(e)) return;',
        '/* mutated */',
        '浮窗内滚动 1200px',
        False,
        'tests/browse-dismiss.test.js',
    ),
    (
        '② 地址改比 href（而不是 pathname）',
        'return String(global.location.pathname || \'\');',
        'return String(global.location.href || \'\');',
        '只改 ?image_index=',
        False,
        'tests/browse-dismiss.test.js',
    ),
    (
        '③ 拆掉编辑模式豁免（滚动 + 换地址两处）',
        'if (this._host && this._host.isEditMode) return;',
        '/* mutated */',
        '编辑模式下滚动',
        True,
        'tests/browse-dismiss.test.js',
    ),
    (
        '④ 拆掉打开后 350ms 宽限期（滚动那处）',
        'if (Date.now() - this._armedAt < GLIDE_MS) return;\n      // 编辑模式豁免：实时读，中途进编辑立刻生效',
        '/* mutated */\n      // 编辑模式豁免：实时读，中途进编辑立刻生效',
        '开窗 100ms 内',
        False,
        'tests/browse-dismiss.test.js',
    ),
    # ---- v2.9.6 新增：站点信号与首滚修复（用 site 测试验证）----
    (
        '⑤ 拆掉「同一条作品不关」判断（认出来会被当成换条）',
        'if (id === this._lastWorkId) return;',
        '/* mutated */',
        '同一条作品回调 → 不关',
        False,
        'tests/browse-dismiss-site.test.js',
    ),
    (
        '⑥ 拆掉 wheel 补基线（首滚重新被吞）',
        'self._primeChain(e && e.target);',
        '/* mutated */',
        '弹层里第一滚 300px 就关',
        False,
        'tests/browse-dismiss-site.test.js',
    ),
    (
        '⑦ 拆掉空 ID 分支的 isOpen 门禁（浮窗没开也拆 armed）',
        "if (this._host && this._host.isOpen) this._dismiss('nonwork', evt.mode || '');",
        "this._dismiss('nonwork', evt.mode || '');",
        '空 ID 之后来真换条 → 照常关（armed 没被误拆）',
        False,
        'tests/browse-dismiss-site.test.js',
    ),
]

results = []
try:
    for name, old, new, expect, replace_all, testfile in MUTATIONS:
        count = TEXT.count(old)
        if count == 0:
            results.append((name, 'SKIP', '没找到目标代码（源码已变，请同步更新本脚本）'))
            continue
        if replace_all:
            mutated = TEXT.replace(old, new)
        else:
            mutated = TEXT.replace(old, new, 1)
        with io.open(TARGET, 'wb') as f:
            f.write(mutated.encode('utf-8'))

        proc = subprocess.run(
            ['node', os.path.join(ROOT, testfile)],
            cwd=ROOT, env=ENV, capture_output=True, text=True, encoding='utf-8', errors='replace'
        )
        out = (proc.stdout or '') + (proc.stderr or '')
        turned_red = proc.returncode != 0
        hit_expected = expect in out
        status = 'PASS' if (turned_red and hit_expected) else ('FAIL(没红)' if not turned_red else 'FAIL(红错了地方)')
        detail = 'exit=%d' % proc.returncode
        results.append((name, status, detail))

        # 每一轮都立刻逐字节还原
        with io.open(TARGET, 'wb') as f:
            f.write(ORIGINAL)
finally:
    with io.open(TARGET, 'wb') as f:
        f.write(ORIGINAL)

with io.open(TARGET, 'rb') as f:
    RESTORED = hashlib.sha256(f.read()).hexdigest()

print('')
ok_count = 0
for name, status, detail in results:
    mark = '✓' if status == 'PASS' else '✗'
    if status == 'PASS':
        ok_count += 1
    print('%s %s  (%s)' % (mark, name, detail))
print('')
print('变异命中 %d / %d' % (ok_count, len(MUTATIONS)))
print('还原校验：%s' % ('逐字节一致 ✓' if RESTORED == ORIG_HASH else '不一致 ✗✗✗'))
