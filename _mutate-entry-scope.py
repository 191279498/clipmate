# -*- coding: utf-8 -*-
"""
v2.12.9 社交 9 站「入口场景」通用层 —— 变异测试

做法：把源码故意改坏一处 → 跑 tests/entry-scope.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言（本项目铁律）。

跑法（项目根目录）：
    python _mutate-entry-scope.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content')
SCOPE = os.path.join(SRC, 'shared', 'entry-scope.js')
BTN = os.path.join(SRC, 'ui', 'button-manager.js')
MODALWIN = os.path.join(SRC, 'ui', 'modal-window.js')
MODALTBL = os.path.join(SRC, 'ui', 'modal-table-renderer.js')
MAIN = os.path.join(SRC, 'content-main.js')
MANIFEST = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')
KSSPA = os.path.join(SRC, 'ui', 'kuaishou-spa-handler.js')
DYSPA = os.path.join(SRC, 'ui', 'douyin-spa-handler.js')
TTSPA = os.path.join(SRC, 'ui', 'tiktok-spa-handler.js')
TEST = os.path.join(ROOT, 'tests', 'entry-scope.test.js')
TEST_KS = os.path.join(ROOT, 'tests', 'kuaishou-popup-reopen.test.js')
TESTS = [TEST, TEST_KS]

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    ('M1', '★ 白名单漏掉 TikTok', SCOPE,
     "    { key: 'youtube', hosts: ['youtube.com'] },\n    { key: 'tiktok', hosts: ['tiktok.com'] }\n",
     "    { key: 'youtube', hosts: ['youtube.com'] }\n"),
    ('M2', '★ enabled 恒 true（其它分组被卷进来）', SCOPE,
     "  function enabled(host) { return siteKeyOf(host) !== ''; }",
     "  function enabled(host) { return true; }"),
    ('M3', '★ 换肤映射反过来（档案判成作品）', SCOPE,
     "  function scopeFromSkin(skin) { return skin === 'arch' ? 'profile' : 'work'; }",
     "  function scopeFromSkin(skin) { return skin === 'arch' ? 'work' : 'profile'; }"),
    ('M4', '★ 默认方向反过来（档案纵向 / 弹层横向）', SCOPE,
     "  function defaultLayout(scope) { return scope === 'profile' ? 'horizontal' : 'vertical'; }",
     "  function defaultLayout(scope) { return scope === 'profile' ? 'vertical' : 'horizontal'; }"),
    ('M5', '★ bucket 不分入口（两个入口共用一个抽屉）', SCOPE,
     "    return site + '@' + (SCOPES.indexOf(scope) !== -1 ? scope : effectiveScope());",
     "    return site + '@profile';"),
    ('M6', '★ 新键冒用老键 clipmate_ui_prefs', SCOPE,
     "  var PREF_KEY = 'clipmate_entry_prefs';",
     "  var PREF_KEY = 'clipmate_ui_prefs';"),
    ('M7', '★ 方向不落盘（关浏览器就忘）', SCOPE,
     "    lsSet(PREF_KEY, JSON.stringify(prefs));",
     "    // 变异：不落盘"),
    ('M8', '★ 读方向忽略入口（恒读 work 桶）', SCOPE,
     "      var entry = prefs[bucket(scope)];",
     "      var entry = prefs[bucket('work')];"),
    ('M9', '★ 拖过标记不落盘', SCOPE,
     "    lsSet(USERMOVED_PREFIX + bucket(scope), value ? '1' : '0');",
     "    // 变异：不落盘"),
    ('M10', '★ 老位置不迁移（升级后按钮跳位）', SCOPE,
     "    var legacy = lsGet(LEGACY_PREFIX + hostOf());",
     "    var legacy = null;"),
    ('M11', '★ 位置键不分入口（退回按域名单键）', SCOPE,
     "    return LEGACY_PREFIX + siteKeyOf(host) + '@' + (SCOPES.indexOf(scope) !== -1 ? scope : effectiveScope());",
     "    return LEGACY_PREFIX + host;"),
    ('M12', '★ 字段模板校准被摘掉', SCOPE,
     "  function confirm(mapperType) {\n"
     "    if (mapperType === 'person') return set('profile');\n"
     "    if (mapperType === 'social') return set('work');\n"
     "    return null;\n"
     "  }",
     "  function confirm(mapperType) { return null; }"),
    ('M13', '★ setSkin 不接 onSkin（换肤不再切入口）', BTN,
     "    const tr = (typeof ClipMateEntryScope !== 'undefined' && ClipMateEntryScope.onSkin)\n"
     "      ? ClipMateEntryScope.onSkin(next) : null;\n"
     "    if (tr && tr.changed) this._restoreEntryScopePosition();",
     "    const tr = null;"),
    ('M14', '★ setSkin 幂等 return 被删（同皮肤也重排 DOM）', BTN,
     "    if (this._skin === next) return;\n",
     "    // 变异：不幂等\n"),
    ('M15', '★ 切入口不恢复按钮位置', BTN,
     "    if (tr && tr.changed) this._restoreEntryScopePosition();",
     "    // 变异：不恢复位置"),
    ('M16', '★ loadSavedPosition 退回老键', BTN,
     "  loadSavedPosition() {\n"
     "    const key = (typeof ClipMateEntryScope !== 'undefined' && ClipMateEntryScope.positionKey)\n"
     "      ? ClipMateEntryScope.positionKey()\n"
     "      : `clipmate-button-position-${window.location.hostname}`;",
     "  loadSavedPosition() {\n"
     "    const key = `clipmate-button-position-${window.location.hostname}`;"),
    ('M17', '★ 不恢复拖过标记（切桶后沿用上一个入口）', BTN,
     "        this.userMoved = (moved === null) ? false : moved;",
     "        // 变异：不恢复拖过标记"),
    ('M18', '★ open 不走进口分支（仍按媒体类型读老 pref）', MODALWIN,
     "      } catch (e) { entryEnabled = false; }\n      if (entryEnabled) {",
     "      } catch (e) { entryEnabled = false; }\n      if (false) {"),
    ('M19', '★ open 不显式给默认方向（沿用实例旧值＝串台根因）', MODALWIN,
     "        this.displayMode = (saved === 'horizontal' || saved === 'vertical')\n"
     "          ? saved : ClipMateEntryScope.defaultLayout(scope);",
     "        if (saved === 'horizontal' || saved === 'vertical') this.displayMode = saved;"),
    ('M20', '★ 手动切方向改回写老键（两个入口又串了）', MODALTBL,
     "      ClipMateEntryScope.writeLayout(ClipMateEntryScope.effectiveScope(), this.displayMode);",
     "      this._saveUiPref('person', { layout: this.displayMode });"),
    ('M21', '★ handleExtract 不在开窗前校准入口', MAIN,
     "          const tr = ClipMateEntryScope.confirm(mapperType);",
     "          const tr = null;"),
    ('M22', '★ manifest 没注入 entry-scope.js', MANIFEST,
     '        "src/content/shared/entry-scope.js",\n', ''),
    ('M23', '★ 版本没升（回退 2.12.8）', MANIFEST,
     '  "version": "2.12.10",', '  "version": "2.12.8",'),
    ('M24', '★ 快手回主页不清锚点标记（真机 K5/K6 残留）', KSSPA,
     "            this.buttonManager.button.removeAttribute('data-clipmate-anchor');",
     "            // 变异：不清锚点标记"),
    ('M25', '★ 抖音漏掉锚点清理（9 站通用性静态断言必须红）', DYSPA,
     "        bm.button.removeAttribute('data-clipmate-anchor');",
     "        // 变异：不清锚点标记"),
    ('M26', '★ TikTok 漏掉锚点清理（9 站通用性静态断言必须红）', TTSPA,
     "          btn.removeAttribute('data-clipmate-anchor');",
     "          // 变异：不清锚点标记"),
]


def run_tests():
    """两套专项都必须是绿的；任一变红即判定该变异被抓住。"""
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
    files = {SCOPE, BTN, MODALWIN, MODALTBL, MAIN, MANIFEST, KSSPA, DYSPA, TTSPA}
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
