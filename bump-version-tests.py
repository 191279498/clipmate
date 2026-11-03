# 批量升级测试文件里硬编码的版本号：只改「含『版本』二字」的行，历史注释不动。
# 用法: python bump-version-tests.py 2.9.3 2.9.4
import io, sys, glob, os

old, new = sys.argv[1], sys.argv[2]
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tests')

changed = []
for path in glob.glob(os.path.join(root, '*.js')):
    with io.open(path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    touched = False
    for i, line in enumerate(lines):
        if '版本' in line and old in line:
            lines[i] = line.replace(old, new)
            if lines[i] != line:
                touched = True
                changed.append((os.path.basename(path), i + 1))
    if touched:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.writelines(lines)

print('changed lines: %d' % len(changed))
for name, ln in changed:
    print('  %s:%d' % (name, ln))
