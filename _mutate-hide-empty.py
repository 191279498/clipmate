# -*- coding: utf-8 -*-
"""
v2.12.11「空白字段四档」—— 变异测试

做法：把源码故意改坏一处 → 跑两套专项测试 → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言（本项目铁律）。

跑法（项目根目录）：
    python _mutate-hide-empty.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src')
SHARED = os.path.join(SRC, 'shared')
UI = os.path.join(SRC, 'content', 'ui')

SITECFG = os.path.join(SHARED, 'site-config.js')
SCHEMA = os.path.join(SHARED, 'settings-schema.js')
BACKGROUND = os.path.join(SRC, 'background', 'background.js')
OPTIONS = os.path.join(SRC, 'options', 'options.js')
MAIN = os.path.join(SRC, 'content', 'content-main.js')
TABLE = os.path.join(UI, 'modal-table-renderer.js')
COPY = os.path.join(UI, 'modal-copy-export.js')

TESTS = [
    os.path.join(ROOT, 'tests', 'hide-empty-fields.test.js'),
    os.path.join(ROOT, 'tests', 'settings-page.test.js'),
    os.path.join(ROOT, 'tests', 'browse-dismiss-site.test.js'),
]

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    ('M1', '★ B 档忘了隐藏复制', SITECFG,
     "    if (mode === 'all') return { mode: 'all', display: true, copy: true };",
     "    if (mode === 'all') return { mode: 'all', display: true, copy: false };"),
    ('M2', '★ A 档忘了隐藏显示', SITECFG,
     "    if (mode === 'display') return { mode: 'display', display: true, copy: false };",
     "    if (mode === 'display') return { mode: 'display', display: false, copy: false };"),
    ('M3', '★ 档位归一化恒返回 off', SITECFG,
     "    return HIDE_EMPTY_MODES.indexOf(s) !== -1 ? s : HIDE_EMPTY_DEFAULT;",
     "    return HIDE_EMPTY_DEFAULT;"),
    ('M4', '★ 覆盖查找丢掉别名域名回退', SITECFG,
     "    if (!rule) {\n      var site = findSite(hostname);\n"
     "      if (site && site.domain.toLowerCase() !== String(hostname || '').toLowerCase()) {\n"
     "        rule = matchRule(config, site.domain);\n      }\n    }",
     "    if (!rule) { /* 变异：不做别名回退 */ }"),
    ('M5', '★ 站点快照丢掉本站已设的档位', SITECFG,
     "    if (own && typeof own === 'object') {",
     "    if (false) {"),
    ('M6', '★ visibleFields 不过滤', SITECFG,
     "    return list.filter(function (f) { return !isBlankValue(d[f]); });",
     "    return list;"),
    ('M7', '★ createTable 忘了接 _visibleFields', TABLE,
     "    const fieldsToRender = this._visibleFields(this.fieldOrder, 'display');",
     "    const fieldsToRender = this.fieldOrder;"),
    ('M8', '★ 编辑模式不强制全量', TABLE,
     "      if (this.isEditMode) return true;",
     "      // 变异：编辑模式不强制全量"),
    ('M9', '★ 搜索条打开不强制全量', TABLE,
     "      return !!this._searchOpen;",
     "      return false;"),
    ('M10', '★ 复制 Notion 忘了接 _visibleFields', COPY,
     "      // v2.12.11：默认全量（含空字段，顺序不变）；B / 自定义档才按「复制隐藏」过滤。\n"
     "      // 只单独加载本 mixin 的测试替身没有 _visibleFields（真整机由 modal-table-renderer 挂上），\n"
     "      // 这种情况退回 this.fieldOrder，绝不能让复制功能整个抛错。\n"
     "      const fieldsToCopy = (typeof this._visibleFields === 'function')\n"
     "        ? this._visibleFields(this.fieldOrder, 'copy') : this.fieldOrder;",
     "      const fieldsToCopy = this.fieldOrder;"),
    ('M11', '★ 复制 Markdown 忘了接 _visibleFields', COPY,
     "      // v2.12.11：同 copyData，按「复制隐藏」档位过滤（A 档仍是全量）；\n"
     "      // 兜底原因同上，单独加载本 mixin 时不许抛错。\n"
     "      const fieldsToCopy = (typeof this._visibleFields === 'function')\n"
     "        ? this._visibleFields(this.fieldOrder, 'copy') : this.fieldOrder;",
     "      const fieldsToCopy = this.fieldOrder;"),
    ('M12', '★ 内容脚本不把策略写进共享模块', MAIN,
     "          resolver.setHideEmptyPolicy(he);",
     "          // 变异：不写共享状态"),
    ('M13', '★ 内容脚本不写自动重载探针属性', MAIN,
     "            rootEl.setAttribute('data-clipmate-hide-empty', he.mode);",
     "            // 变异：不写探针"),
    ('M14', '★ 默认值偷偷变成 all', BACKGROUND,
     "            hideEmptyMode: 'off',",
     "            hideEmptyMode: 'all',"),
    ('M15', '★ 自定义开关的依赖条件写错', SCHEMA,
     "      dependsOn: {\n        key: 'hideEmptyMode',\n        equals: 'custom',\n"
     "        offHint: '上面选「自定义」后，这一项才会生效'\n      }\n    },\n    {\n      key: 'hideEmptyCopy',",
     "      dependsOn: {\n        key: 'hideEmptyMode',\n        equals: 'off',\n"
     "        offHint: '上面选「自定义」后，这一项才会生效'\n      }\n    },\n    {\n      key: 'hideEmptyCopy',"),
    ('M16', '★ 依赖判断不支持 equals', OPTIONS,
     "    if (Object.prototype.hasOwnProperty.call(dep, 'equals')) return value !== dep.equals;",
     "    if (false) return value !== dep.equals;"),
    ('M17', '★ 站点卡片又退回只读旧 6 键的 eff', OPTIONS,
     "  buildSite(site) {\n    var st = this.stateOf(site);\n    var eff = this.effectiveForSite(site);",
     "  buildSite(site) {\n    var st = this.stateOf(site);\n    var eff = SITES.resolve(this.config, site.domain);"),
    ('M18', '★ 站点「跟随通用」不删键', OPTIONS,
     "      if (!value) delete snapshot[key];",
     "      if (false) delete snapshot[key];"),
    ('M19', '★ 统一快照丢掉 autoDismiss（老事故复发）', SITECFG,
     "      autoDismiss: e.autoDismiss\n",
     "      // 变异：快照不带 autoDismiss\n"),
]


def run_tests():
    env = dict(os.environ)
    env['NODE_PATH'] = 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    chunks = []
    for t in TESTS:
        p = subprocess.run(
            ['node', t], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        out = p.stdout.decode('utf-8', 'replace')
        chunks.append(out)
        if p.returncode != 0:
            return p.returncode, '\n'.join(chunks)
    return 0, '\n'.join(chunks)


def eol_variants(text):
    return [text, text.replace('\n', '\r\n')]


def main():
    files = {SITECFG, SCHEMA, BACKGROUND, OPTIONS, MAIN, TABLE, COPY}
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
            io.open(target, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v, 1))
            code, out = run_tests()
            print('%s %s → %s' % (mid, desc, '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('❌') or line.strip().startswith('· '):
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
        print('\n还原：', '逐字节一致 ✓' if same_all else '✗ 有文件没还原，请立刻检查！')

    print('\n' + '=' * 60)
    if survived:
        print('❌ 有 %d 处变异没被抓住：%s' % (len(survived), ', '.join(survived)))
        return 1
    print('✅ %d 处变异全部被抓住，源码已逐字节还原' % len(MUTATIONS))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
