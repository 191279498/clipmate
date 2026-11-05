# -*- coding: utf-8 -*-
"""
豆瓣收藏列表逐条按钮 · 变异测试（v2.11.4）

做法：把源码故意改坏一处 → 跑 tests/douban-list.test.js → 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言。

为什么这轮特别需要变异测试：
  这版动了 `base-extractor` 的读 DOM 入口（影响 20 多个站点），
  又新增了「页面形态 → 自动收起」这条隐式链路。
  两类改动都**不会报错**、只会静默失效，普通单测最容易漏。

跑法（项目根目录）：
    python _mutate-douban-list.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, 'ClipMate_chrome', 'src')
TEST = os.path.join(ROOT, 'tests', 'douban-list.test.js')

PS = os.path.join(SRC, 'content', 'utils', 'page-shape.js')
CM = os.path.join(SRC, 'content', 'content-main.js')
BE = os.path.join(SRC, 'content', 'extractors', 'base-extractor.js')
DM = os.path.join(SRC, 'content', 'extractors', 'douban-movie.js')
LF = os.path.join(SRC, 'content', 'ui', 'douban-list-fetch.js')
LB = os.path.join(SRC, 'content', 'ui', 'douban-list-buttons.js')
LH = os.path.join(SRC, 'content', 'ui', 'douban-list-handler.js')
DB = os.path.join(SRC, 'content', 'extractors', 'douban-book.js')
DG = os.path.join(SRC, 'content', 'extractors', 'douban-game.js')
MF = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')
SC = os.path.join(SRC, 'shared', 'settings-schema.js')

# (编号, 说明, 目标文件, 原文, 改成)
MUTATIONS = [
    (
        'M1',
        'page-shape 不判列表页（豆瓣收藏三页不算 feed → 大按钮不藏、浮窗不自动关）',
        PS,
        "    if (doubanListKind(host, path)) return 'feed';",
        "    if (false) return 'feed';",
    ),
    (
        'M2',
        '白名单写成「整站都算列表」（详情页 / 影评页的大按钮全被藏掉）',
        PS,
        "    'movie.douban.com': [\n      /^\\/people\\/[^/]+\\/(wish|do|collect)\\/?$/i\n    ],",
        "    'movie.douban.com': [\n      /.*/\n    ],",
    ),
    (
        'M3',
        '形态判了但不用（feed 不参与自动收起，滚动永不关窗）',
        CM,
        "    const feedShape = this._pageShape === 'feed';",
        "    const feedShape = false;",
    ),
    (
        'M4',
        '页面形态硬压用户设置（用户手动关掉自动收起也照关）',
        CM,
        "    const autoDismissOn = e.autoDismissExplicit\n      ? (e.autoDismiss !== false)\n      : (e.autoDismiss === true || feedShape);",
        "    const autoDismissOn = feedShape || e.autoDismiss === true;",
    ),
    (
        'M5',
        '换源没传给提取器（抓了详情页却还读列表页）',
        CM,
        "      if (altSourceOn) extractor.setSource(altDoc, altUrl);",
        "      if (false) extractor.setSource(altDoc, altUrl);",
    ),
    (
        'M6',
        '换源用完不还原（工厂复用的实例会一直读错文档）',
        CM,
        "          if (altSourceOn) extractor.setSource(null);",
        "          if (false) extractor.setSource(null);",
    ),
    (
        'M7',
        'base 的 _root() 忽略 this.doc（换源彻底失效，且 20 多个站看不出变化）',
        BE,
        "    return this.doc || document;",
        "    return document;",
    ),
    (
        'M8',
        '影视 setSource 只认 url 不认 doc（文档没换，只有链接变了）',
        DM,
        "    this.doc = doc || document;",
        "    this.doc = document;",
    ),
    (
        'M9',
        '抓取层不查缓存（同一条点两次就打两次豆瓣）',
        LF,
        "      var cachedDoc = this.cached(key);",
        "      var cachedDoc = null;",
    ),
    (
        'M10',
        '去掉单请求闸门（连点会并发打好几个详情页，风控暴露面翻倍）',
        LF,
        "      if (this._busy) return { ok: false, id: id, key: key, reason: '上一个还在抓，稍等一下' };",
        "      if (false) return { ok: false, id: id, key: key, reason: '上一个还在抓，稍等一下' };",
    ),
    (
        'M11',
        '只写横向坐标、纵向不定位（按钮全挤在条目顶边）',
        LB,
        "      btn.style.left = t.left + 'px';\n      btn.style.top = t.top + 'px';",
        "      btn.style.left = t.left + 'px';",
    ),
    (
        'M12',
        '去掉点击闸门（手快连点会同时飞多个请求）',
        LB,
        "      if (this._busy) {",
        "      if (false) {",
    ),
    (
        'M13',
        '收藏页判定放宽成「哪一页都挂」（详情页 / 用户主页也冒按钮）',
        LB,
        "      kind: 'movie', host: 'movie.douban.com', path: COLLECT_PATH,",
        "      kind: 'movie', host: 'movie.douban.com', path: /.*/,",
    ),
    (
        'M14',
        '缓存键不按条目编号算（列表页几十条地址相同 → 点哪条都弹第一条）',
        LH,
        "      this.activeShortcode = res.key || id;",
        "      this.activeShortcode = prevShortcode;",
    ),
    (
        'M15',
        '不判「这份文档像不像剧集」（电视剧会被当成电影处理）',
        LH,
        "    return docLooksTv(doc) ? 'tv' : 'movie';",
        "    return 'movie';",
    ),
    # ---------------- v2.11.5 新增 ----------------
    (
        'M16',
        '★ 初始化又绑回媒体类型（v2.11.4 那个血案：收藏页 mediaType 非空 → 一颗按钮都不挂）',
        CM,
        "      if (listKind) {",
        "      if (listKind && !this.detectMediaType()) {",
    ),
    (
        'M17',
        '白名单出口恒返回 null（三站列表页全部认不出来）',
        PS,
        "    if (!matchAny(LIST_PAGES[host], String(pathname || '/'))) return null;",
        "    if (true) return null;",
    ),
    (
        'M18',
        '按钮规格表漏了游戏（游戏列表一颗按钮都不挂）',
        LB,
        "      kind: 'game', host: 'www.douban.com', path: GAMES_PATH,",
        "      kind: 'game', host: 'never.invalid', path: GAMES_PATH,",
    ),
    (
        'M19',
        '读书提取器换源不换文档（读到列表页，整表全空）',
        DB,
        "    this.doc = doc || document;",
        "    this.doc = document;",
    ),
    (
        'M20',
        '游戏提取器换源不换文档（读到列表页，整表全空）',
        DG,
        "    this.doc = doc || document;",
        "    this.doc = document;",
    ),
    (
        'M21',
        '缓存键不带站点（读书与影视同号会互相串）',
        LF,
        "      return (p.host || pageHost()) + '/p/' + p.id;",
        "      return '/p/' + p.id;",
    ),
    (
        'M22',
        '读书条目被当成影视提取（字段全错）',
        LH,
        "    if (kind === 'book') return 'book';",
        "    if (kind === 'book') return 'movie';",
    ),
    (
        'M23',
        '详情页也开滚动关窗（用户拍板：详情页不要开）',
        CM,
        "    const feedShape = this._pageShape === 'feed';",
        "    const feedShape = true;",
    ),
    (
        'M24',
        'manifest 漏了读书 people 路径（读书页根本不注入脚本）',
        MF,
        '        "https://book.douban.com/people/*",\n',
        '',
    ),
    (
        'M25',
        '不建字段映射器（v2.11.5 真机那条血案：点按钮报 null，浮窗一个都不出）',
        LH,
        '        this.fieldMapper = await this.initFieldMapper(forcedType);',
        '        /* 故意删掉：列表页 mapper 永远是 null */',
    ),
    (
        'M26',
        'mapper 建固定类型（点读书条目会弹出电影表）',
        LH,
        '        this.fieldMapper = await this.initFieldMapper(forcedType);',
        "        this.fieldMapper = await this.initFieldMapper('movie');",
    ),
    (
        'M27',
        'forceMediaType 没跟着本条类型走（提取器选错）',
        LH,
        '          forceMediaType: forcedType,',
        "          forceMediaType: 'movie',",
    ),
    # ---------------- v2.11.7：小按钮落点 A / B / C ----------------
    (
        'M28',
        '按钮又塞回标题里（标题长短不同 → 每条位置都不一样，用户报的那个问题）',
        LB,
        '      item.appendChild(btn);\n      this._place(btn, item, spec);',
        '      pair.title.appendChild(btn);\n      this._place(btn, item);',
    ),
    (
        'M29',
        '定位方式退回 static（按钮回到文档流里 → 撑高行高、位置跟文字跑）',
        LB,
        "      + 'position:absolute;z-index:2;'",
        "      + 'position:static;z-index:2;'",
    ),
    (
        'M30',
        'A 落点算错（没内缩，按钮压到封面最边上）',
        LB,
        '          left = cx + cw - BTN_SIZE - EDGE_INSET;',
        '          left = cx + cw - BTN_SIZE;',
    ),
    (
        'M31',
        '列表视图按钮紧贴日期（没有间距，视觉上压住日期）',
        LB,
        '  var RAIL_GAP = 8;        // 无封面时：按钮右缘距日期左缘',
        '  var RAIL_GAP = 0;        // 故意：紧贴日期',
    ),
    (
        'M32',
        'C 的纵向不用统一基准线（改成跟随条目高度居中 → 长标题行会低一截）',
        LB,
        '          left = iw - BTN_SIZE - RIGHT_INSET;\n          top = baseY - BTN_SIZE - EDGE_INSET;',
        '          left = iw - BTN_SIZE - RIGHT_INSET;\n          top = (ih - BTN_SIZE) / 2;',
    ),
    (
        'M44',
        'B 不按最矮那行收口（游戏页 159/180 两种行高 → 每行 y 不一样）',
        LB,
        '        if (anchor.h > 0 && bY + BTN_SIZE > anchor.h) bY = Math.max(0, anchor.h - BTN_SIZE);',
        '        if (false) bY = Math.max(0, anchor.h - BTN_SIZE);',
    ),
    (
        'M43',
        '纵向基准线退回「封面框底」（框会被行高拉伸 → 每行 y 都不一样，用户报的那个乱）',
        LB,
        '          if (imr.height >= MIN_COVER && imr.height >= pr.height * 0.5) {',
        '          if (false) {',
    ),
    (
        'M33',
        '列表视图不退回「日期左侧」（按钮跑去条目右缘，压住日期）',
        LB,
        "      var date = item.querySelector('.date');",
        '      var date = null;',
    ),
    (
        'M34',
        '换落点不重排（设置页改了不生效，得刷新页面）',
        LB,
        "      this.sync();\n      log('落点改为 ' + next);",
        "      if (false) this.sync();\n      log('落点改为 ' + next);",
    ),
    (
        'M35',
        '脏值不归一化（配置里写了 M 就真按 M 走，按钮坐标全乱）',
        LB,
        '    return LAYOUTS.indexOf(m) === -1 ? DEFAULT_LAYOUT : m;',
        '    return m || DEFAULT_LAYOUT;',
    ),
    (
        'M36',
        '小写不认（设置里存成 b/c 就失效，等同回到 A）',
        LB,
        "    var m = String(mode == null ? '' : mode).toUpperCase();",
        "    var m = String(mode == null ? '' : mode);",
    ),
    (
        'M37',
        'stop 时不还原条目 position（给豆瓣留下永久布局改动）',
        LB,
        '      this._restoreHosts();',
        '      if (false) this._restoreHosts();',
    ),
    (
        'M38',
        '把已经是定位祖先的条目强行改成 relative（覆盖豆瓣自己的布局）',
        LB,
        "        if (pos && pos !== 'static') return;   // 本身已经是定位祖先，别动",
        '        if (false) return;',
    ),
    (
        'M39',
        '设置项默认值改成 B（用户没设过就默认压在封面下方）',
        SC,
        "      default: 'A',",
        "      default: 'B',",
    ),
    (
        'M40',
        'content-main 不读落点设置（永远按 A 走，设置页变成摆设）',
        CM,
        '        const layoutRaw = config.settings && config.settings.doubanListBtnLayout;',
        "        const layoutRaw = 'A';",
    ),
    (
        'M41',
        '列表页不读配置（features 恒空、落点恒 A）',
        CM,
        "        await this.refreshConfig();\n\n        this._pageShape = 'feed';",
        "        await Promise.resolve();\n\n        this._pageShape = 'feed';",
    ),
    (
        'M42',
        '初始化按钮时不传落点（设置页选 B/C 也一直按 A 画）',
        LH,
        '        layout: this.doubanListBtnLayout,',
        "        layout: 'A',",
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
                print('✗ %s 原文定位失败（LF/CRLF 各试一次都没恰好命中 1 次）：%s' % (mid, old[:60]))
                survived.append(mid + '(定位失败)')
                continue
            old_v, new_v = hit

            io.open(target, 'w', encoding='utf-8', newline='').write(text.replace(old_v, new_v))
            code, out = run_test()
            status = '变红 ✓' if code != 0 else '仍然全绿 ✗（这条断言是假的）'
            print('%s %s → %s' % (mid, desc, status))
            if code == 0:
                survived.append(mid)
                print(out[-1000:])
            else:
                for line in out.splitlines():
                    if line.strip().startswith('✗ '):
                        print('     失败点:', line.strip())
                        break
            # 每个变异跑完立刻还原，避免污染后面的变异
            io.open(target, 'w', encoding='utf-8', newline='').write(text)
    finally:
        # 无论中间出什么事，都要把源码还原成原样
        for target, raw in originals.items():
            io.open(target, 'wb').write(raw)

    print('\n' + '=' * 56)
    if survived:
        print('❌ 有 %d 条变异没被抓住：%s' % (len(survived), ', '.join(survived)))
        return 1
    print('✅ 全部 %d 条变异都变红了（断言不是假绿的）' % len(MUTATIONS))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
