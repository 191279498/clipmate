# -*- coding: utf-8 -*-
"""
v2.12.8 快手主页弹层「关→开」换肤修复的变异测试

做法：把源码故意改坏一处 → 跑 tests/kuaishou-popup-reopen.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言（本项目铁律）。

跑法（项目根目录）：
    python _mutate-kuaishou-reopen.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SPA = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'kuaishou-spa-handler.js')
BTN = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'button-manager.js')
MANIFEST = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')
TEST = os.path.join(ROOT, 'tests', 'kuaishou-popup-reopen.test.js')

RESTORE_MAPPER_BLOCK = (
    "        if (this._ksMapperType !== 'person') {\n"
    "          this.fieldMapper = await this.initFieldMapper('person');\n"
    "          this._ksMapperType = 'person';\n"
    "        }\n"
)
ACTIVATE_BRANCH = (
    "      if (!this._ksActivated) {\n"
    "        await this._activateKuaishouComponents();\n"
    "      } else {\n"
)

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    (
        'M1', '★ 删掉撤离时的 _ksActivated 归零（就是用户报的那个 bug 本身）',
        SPA, "      this._ksActivated = false;\n", "      // 变异：不归零\n",
    ),
    (
        'M2', '把归零改成反向赋值（第二次打开仍被当成「已激活」）',
        SPA, "      this._ksActivated = false;", "      this._ksActivated = true;",
    ),
    (
        'M3', 'wasActive 提前失效（等价改写「归零排在其之前」的后果）→ 关弹层不还原主页态',
        SPA, "      var wasActive = !!(this._ksWorkId || this._ksActivated);",
        "      var wasActive = false;",
    ),
    (
        'M4', '★ 一键激活里不再每次换 default 皮肤（混脸）',
        SPA, "      this._ksApplySkin('default');\n", "      // 变异：不换肤\n",
    ),
    (
        'M5', '★ 一键激活只看 fieldMapper 有没有，不看是不是 social（7 列空表根因）',
        SPA, "      if (!this.fieldMapper || this._ksMapperType !== 'social') {",
        "      if (!this.fieldMapper) {",
    ),
    (
        'M6', '关弹层不再把模板换回 person',
        SPA, RESTORE_MAPPER_BLOCK, "        // 变异：不还原 person 模板\n",
    ),
    (
        'M7', '关弹层不再换回 arch 皮肤',
        SPA, "        this._ksApplySkin('arch');\n", "        // 变异：不换回档案皮\n",
    ),
    (
        'M8', '一键激活不再写全局标记（extractor-factory 会选错提取器）',
        SPA, "      try { window.__clipmateKsImmersiveActive = true; } catch (e) { /* 忽略 */ }",
        "      try { /* 变异 */ } catch (e) { /* 忽略 */ }",
    ),
    (
        'M9', '撤离时不清全局标记',
        SPA, "      try { window.__clipmateKsImmersiveActive = false; } catch (e) { /* 忽略 */ }",
        "      try { /* 变异 */ } catch (e) { /* 忽略 */ }",
    ),
    (
        'M10', '一键激活末尾不再把 _ksActivated 置 true',
        SPA, "      this._ksActivated = true;\n", "      // 变异：不标记激活\n",
    ),
    (
        'M11', '★ opened 分支恒走 else（模拟「已经激活过」的旧行为）',
        SPA, ACTIVATE_BRANCH,
        "      if (false) {\n"
        "        await this._activateKuaishouComponents();\n"
        "      } else {\n",
    ),
    (
        'M12', '删掉 _bindKuaishouAnchor 的重复绑定闸口（重跑激活会叠加监听）',
        SPA, "      if (this._ksAnchorBound) return;\n", "      // 变异：没有闸口\n",
    ),
    (
        'M13', '删掉 setSkin 的幂等 return（重跑激活会反复重排 DOM）',
        BTN, "    if (this._skin === next) return;\n", "    // 变异：不幂等\n",
    ),
    (
        'M14', '版本回退到 2.12.7（每版必改版本号）',
        MANIFEST, '"version": "2.12.8",', '"version": "2.12.7",',
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
    files = {SPA, BTN, MANIFEST}
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
                    if line.strip().startswith('❌') or line.strip().startswith('- '):
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
