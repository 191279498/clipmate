# -*- coding: utf-8 -*-
"""
抖音「站内跳转进作者主页按钮消失」修复的变异测试（v2.12.3）

做法：把源码故意改坏一处 → 跑 tests/douyin-route-person.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

跑法（项目根目录）：
    python _mutate-douyin-route.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
DYN = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'douyin-spa-handler.js')
TEST = os.path.join(ROOT, 'tests', 'douyin-route-person.test.js')

# (编号, 说明, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        '信息流分支不挂路由监听（就是用户报的那个 bug：进主页按钮永久消失）',
        "      // 必须另有一个只看 pathname 的监听把按钮送回来（详见方法注释）。\n"
        "      this._startDouyinRouteWatcher();\n",
        "      // 必须另有一个只看 pathname 的监听把按钮送回来（详见方法注释）。\n",
    ),
    (
        'M2',
        '主页换装分支不挂路由监听（从主页退回信息流时按钮不撤）',
        "      this._douyinPersonPage = true;\n"
        "      this._startDouyinRouteWatcher();\n",
        "      this._douyinPersonPage = true;\n",
    ),
    (
        'M3',
        '关弹层不看「人在不在主页」，一律撤按钮（真机时序下按钮又没了）',
        "        if (this._douyinRouteKind() === 'person') {\n"
        "          await this._restoreDouyinPersonPage();\n"
        "          return;\n"
        "        }\n"
        "        this._deactivateDouyinModal();\n",
        "        this._deactivateDouyinModal();\n",
    ),
    (
        'M4',
        '从主页点开作品时不重建 social 模板（沿用人物 6 列 → 整列全空）',
        "      if (!this.fieldMapper || this._douyinMapperType !== 'social') {\n"
        "        this.fieldMapper = await this.initFieldMapper('social');\n"
        "        this._douyinMapperType = 'social';\n"
        "      }\n",
        "      if (!this.fieldMapper) {\n"
        "        this.fieldMapper = await this.initFieldMapper('social');\n"
        "      }\n",
    ),
    (
        'M5',
        '接管作品时不换普通蓝（档案装去提单条作品 = 混脸）',
        "      try {\n"
        "        if (this.buttonManager && typeof this.buttonManager.setSkin === 'function') {\n"
        "          this.buttonManager.setSkin('default');\n"
        "        }\n"
        "      } catch (e) { /* 换肤失败不影响提取 */ }\n"
        "      this._showExtractButton();\n",
        "      this._showExtractButton();\n",
    ),
    (
        'M6',
        '回到主页不换档案装（按钮顶着普通蓝整理人物档案）',
        "        if (bm && typeof bm.setSkin === 'function') bm.setSkin('arch');  // 兜底（幂等）",
        "        if (bm && typeof bm.setSkin === 'function') bm.setSkin('default');  // 兜底（幂等）",
    ),
    (
        'M7',
        '恢复主页时不接点击动作（按钮回来了，点了没反应）',
        "          if (typeof this.initUI === 'function') this.initUI(); // 信息流分支过来时点击动作还没接上",
        "          // 变异：不接点击动作",
    ),
    (
        'M8',
        '恢复主页时只 setVisible 不 show（按钮对象在、DOM 里没有 → 页面上看不见）',
        "          if (bm && typeof bm.show === 'function') bm.show();   // ① 插回页面",
        "          // 变异：不插回页面",
    ),
    (
        'M9',
        '恢复主页时不清贴弹层的内联坐标（按钮停在上一条作品的右上角）',
        "          this._resetDouyinButtonPosition();                   // ③ 回到站点默认 / 用户拖动过的位置",
        "          // 变异：不清内联坐标",
    ),
    (
        'M10',
        '主页带 ?modal_id= 也当成档案页（弹层还开着就换回档案装）',
        "          if (/[?&]modal_id=/.test(String(location.search || ''))) return 'detail';",
        "          if (false) return 'detail';",
    ),
    (
        'M11',
        '退回信息流不撤按钮（留一个点了提空的死按钮）',
        "      if (this._douyinPersonPage === true) this._leaveDouyinPersonPage();",
        "      // 变异：退回信息流不撤按钮",
    ),
    (
        'M12',
        '离开主页不褪回普通蓝（下一个作品弹层还顶着档案装）',
        "        if (bm && typeof bm.setSkin === 'function') bm.setSkin('default');\n"
        "      } catch (e) { /* 换肤失败不影响提取 */ }\n"
        "      this._douyinLog('info', '离开作者主页，按钮撤下（等作品出现再接管）');",
        "      } catch (e) { /* 换肤失败不影响提取 */ }\n"
        "      this._douyinLog('info', '离开作者主页，按钮撤下（等作品出现再接管）');",
    ),
    (
        'M13',
        '路由监听去掉域名门禁（其他 30 多个站每页面多一个 250ms 定时器）',
        "      if (this._douyinRouteTimer) return true;\n"
        "      if (!this._isDouyinModalHost()) return false;\n",
        "      if (this._douyinRouteTimer) return true;\n",
    ),
    (
        'M14',
        '路由监听不防重复（每调一次叠一个定时器）',
        "    _startDouyinRouteWatcher() {\n"
        "      if (this._douyinRouteTimer) return true;\n",
        "    _startDouyinRouteWatcher() {\n",
    ),
    (
        'M15',
        '退出时不摘路由监听（开关关掉后还在跑）',
        "      this._douyinWatch = null;\n"
        "      this._stopDouyinRouteWatcher();\n",
        "      this._douyinWatch = null;\n",
    ),
    (
        'M16',
        '恢复主页时不清「接管中」标记（类型补认可能把主页当成一条作品）',
        "      this._douyinActivated = false;   // 让 `_douyinModalOverrideType()` 返回 null，类型落回 URL 规则 → person",
        "      // 变异：不清接管标记",
    ),
    (
        'M17',
        '作品详情页被当成信息流（/video/<id> 上的按钮会被这次改动撤掉）',
        "      if (/\\/(video|note|slides)\\//.test(path)) return 'detail';",
        "      // 变异：详情页按 feed 处理",
    ),
    (
        'M18',
        '接管作品时不落「档案页」标记（一来一回状态错位）',
        "      // 这一页此刻代表「某一条作品」，不再是整页档案\n"
        "      this._douyinPersonPage = false;\n",
        "      // 这一页此刻代表「某一条作品」，不再是整页档案\n",
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
    raw = open(DYN, 'rb').read()
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

            io.open(DYN, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v))
            code, out = run_test()
            print('%s %s → %s' % (mid, desc, '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'))
            if code == 0:
                survived.append(mid)
                print(out[-1200:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('· '):
                        print('     失败点:', line.strip())
                        break
            io.open(DYN, 'w', encoding='utf-8', newline='').write(text)
    finally:
        with open(DYN, 'wb') as f:
            f.write(raw)
        # 逐字节核对还原结果
        same = open(DYN, 'rb').read() == raw
        print('\n还原逐字节一致：', same)
        print('存活变异：', survived if survived else '无（全部变红）')
    return 0 if not survived else 1


if __name__ == '__main__':
    raise SystemExit(main())
