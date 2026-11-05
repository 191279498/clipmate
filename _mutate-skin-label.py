# -*- coding: utf-8 -*-
"""
按钮文案跟皮肤走的变异测试（v2.12.2）

做法：把源码故意改坏一处 → 跑 tests/skin-label-sync.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-skin-label.py
"""
import io
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src')
TEST = os.path.join(ROOT, 'tests', 'skin-label-sync.test.js')

BTN = os.path.join(SRC, 'content', 'ui', 'button-manager.js')
DYN = os.path.join(SRC, 'content', 'ui', 'douyin-spa-handler.js')
MAIN = os.path.join(SRC, 'content', 'content-main.js')
KS_SPA = os.path.join(SRC, 'content', 'ui', 'kuaishou-spa-handler.js')
KS_ROUTE = os.path.join(SRC, 'content', 'ui', 'kuaishou-route-watcher.js')
SHAPE = os.path.join(SRC, 'content', 'utils', 'page-shape.js')

# (编号, 说明, 目标文件, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '待命文案不看皮肤（回到原 bug：档案页 3 秒后变「提取」）',
        BTN,
        "  get _idleLabel() {\n    return this._skin === 'arch' ? this.LABEL_ARCH : this.LABEL_IDLE;\n  }",
        "  get _idleLabel() {\n    return this.LABEL_IDLE;\n  }",
    ),
    (
        'M2',
        '档案页 title 退回普通版',
        BTN,
        "      ? '点击整理作者档案，拖动可移动按钮位置'",
        "      ? '点击提取页面媒体信息，拖动可移动按钮位置'",
    ),
    (
        'M3',
        '换肤时不改文案（图标金边换了、字还是「提取」）',
        BTN,
        "        if (cur === this.LABEL_IDLE || cur === this.LABEL_ARCH) last.textContent = this._idleLabel;",
        "        // 变异：换肤不改文案",
    ),
    (
        'M4',
        '成功 3 秒回流写死 LABEL_IDLE（就是用户真机截图那个 bug）',
        BTN,
        "      this._renderButton('normal', this._idleLabel);\n      // v2.5.60：还没就绪的按钮不能借这个定时器放开",
        "      this._renderButton('normal', this.LABEL_IDLE);\n      // v2.5.60：还没就绪的按钮不能借这个定时器放开",
    ),
    (
        'M5',
        '成功态「点击再次…」不跟皮肤',
        BTN,
        "      ? '点击再次整理，拖动可移动按钮位置'",
        "      ? '点击再次提取，拖动可移动按钮位置'",
    ),
    (
        'M6',
        'setClickHandler 退回写死普通 title（换肤早于 initUI 时 title 错）',
        BTN,
        "      this.button.title = this._idleTitle;",
        "      this.button.title = '点击提取页面媒体信息，拖动可移动按钮位置';",
    ),
    (
        'M7',
        '抖音主页：弹层开/关换装方向反了',
        DYN,
        "          bm.setSkin(evt && evt.opened ? 'default' : 'arch');",
        "          bm.setSkin(evt && evt.opened ? 'arch' : 'default');",
    ),
    (
        'M8',
        '抖音主页：去掉「只在档案页挂」的门禁（其他形态也开始换装）',
        DYN,
        "      if (this._pageShape !== 'person') return false;",
        "      if (false) return false;",
    ),
    (
        'M9',
        '抖音主页：去掉与完整弹窗接管的互斥（两边抢同一个按钮）',
        DYN,
        "      if (this._douyinWatch) return false;",
        "      if (false) return false;",
    ),
    (
        'M10',
        'content-main 忘了调用（方法写了但没人挂，等于没做）',
        MAIN,
        "        try { this._startDouyinPersonSkinWatcher(); } catch (e) { /* 挂不上不影响任何提取 */ }",
        "        // 变异：忘了调用",
    ),
    (
        'M11',
        '地址监听少了 YouTube（频道页进视频页不换装）',
        SHAPE,
        "    'youtube.com', 'm.youtube.com',\n",
        "",
    ),
    (
        'M12',
        '快手弹层接管不换装（提单条作品却顶着「整理档案」）',
        KS_SPA,
        "      this._ksApplySkin('default');\n      this._bindKuaishouAnchor();",
        "      this._bindKuaishouAnchor();",
    ),
    (
        'M13',
        '快手回到主页不换回档案装',
        KS_SPA,
        "        this._ksApplySkin('arch');\n        this._ksLog('info', '回到个人主页（mediaType=person）');",
        "        this._ksLog('info', '回到个人主页（mediaType=person）');",
    ),
    (
        'M14',
        '快手站内进详情页不换装',
        KS_ROUTE,
        "      if (typeof this._ksApplySkin === 'function') this._ksApplySkin('default');",
        "      // 变异：不换装",
    ),
    (
        'M15',
        '网格页走进主页不再恢复按钮（主页上一个按钮都没有）',
        KS_ROUTE,
        "      if (!wasProfile && isProfile) {\n        this._ksRouteRestoreProfilePerson();",
        "      if (false) {\n        this._ksRouteRestoreProfilePerson();",
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
                print('✗ %s 原文定位失败（LF/CRLF 各试一次都没恰好命中 1 次）：%s' % (mid, desc))
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
                    if line.strip().startswith('- '):
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
