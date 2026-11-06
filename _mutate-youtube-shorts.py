# -*- coding: utf-8 -*-
"""
v2.12.6 YouTube Shorts 一手数据链路的变异测试

做法：把源码故意改坏一处 → 跑 tests/youtube-shorts-firsthand.test.js
→ 必须变红 → 逐字节还原。
任何一处「改坏了还全绿」都说明那条断言是假绿的，必须补断言（本项目铁律）。

跑法（项目根目录）：
    python _mutate-youtube-shorts.py
"""
import io
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'youtube-shorts-hook.js')
PAGE_DATA = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'shared', 'youtube-shorts-page-data.js')
SOCIAL = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'extractors', 'youtube-social.js')
MANIFEST = os.path.join(ROOT, 'ClipMate_chrome', 'manifest.json')
TEST = os.path.join(ROOT, 'tests', 'youtube-shorts-firsthand.test.js')

# (编号, 说明, 文件, 原文, 改成)
MUTATIONS = [
    (
        'M1', '删掉 extractAllFields() 的一手数据预热（桥节点晚到时字段全回落）',
        SOCIAL,
        "    if (this._isShortsPage() && typeof YoutubeShortsPageData !== 'undefined' &&\n"
        "        YoutubeShortsPageData && typeof YoutubeShortsPageData.ensureFresh === 'function') {\n"
        "      try {\n"
        "        await YoutubeShortsPageData.ensureFresh();\n"
        "      } catch (e) { /* 预热失败不打断提取，回落原取法 */ }\n"
        "    }\n",
        "    // 变异：预热整块搬走\n",
    ),
    (
        'M2', '删掉读取器的 videoId 闸口（旧桥节点会被当成当前条）',
        PAGE_DATA,
        "      if (String(item.videoId || '') !== String(videoId)) return null;\n",
        "      // 变异：ID 闸口删掉\n",
    ),
    (
        'M3', '删掉发布日期的过期护栏（旧 meta 日期串进新视频）',
        SOCIAL,
        "        if (!this._ytShortsHeadFresh()) return '';\n",
        "        // 变异：过期护栏删掉\n",
    ),
    (
        'M4', '#snippet 不看闸口（旧简介串进文案，就是真机的串数据现场）',
        SOCIAL,
        "        if (this._ytShortsHeadFresh()) {\n"
        "          const snippetElement = document.querySelector('#snippet');",
        "        if (true) {\n"
        "          const snippetElement = document.querySelector('#snippet');",
    ),
    (
        'M5', '作者ID 正则改回老写法（又把 /shorts 吞进来）',
        SOCIAL,
        "        const authorIdMatch = href.match(/\\/([^/?#]*@[^/?#]+)/);",
        "        const authorIdMatch = href.match(/\\/(@.+)/);",
    ),
    (
        'M6', '作者主页不做归一（又存成 /@x/shorts）',
        SOCIAL,
        "            return this._ytShortsNormalizeHomepage(fullUrl);",
        "            return fullUrl;",
    ),
    (
        'M7', '文案不清洗界面字（…更多 / 展开 又混进正文）',
        SOCIAL,
        "    return String(text)\n"
        "      .replace(/[\\s…\\.]{0,4}(?:显示更多|显示全部|显示更少|更多|展开|收起)\\s*$/g, '')\n"
        "      .replace(/(?:…|\\.{2,})[\\s.]*$/g, '')\n"
        "      .replace(/\\s+/g, ' ')\n"
        "      .trim();",
        "    return String(text).trim();",
    ),
    (
        'M8', '文案不去重标题（第一条视频的标题又贴两遍）',
        SOCIAL,
        "    const kept = lines.filter(p =>\n"
        "      p !== t && !(p.length > t.length && p.indexOf(t) === 0 && p.slice(t.length).trim().length <= 2)\n"
        "    );",
        "    const kept = lines;",
    ),
    (
        'M9', '主世界钩子不再按 reelWatchEndpoint.videoId 挑当前条',
        HOOK,
        "        if (!ep || String(ep.videoId || '') !== id) continue;",
        "        if (!ep) continue;",
    ),
    (
        'M10', '主世界钩子 normalize 不再校验 playerResponse 内部 ID',
        HOOK,
        "    if (String(vd.videoId || '') !== String(videoId)) return null;",
        "    // 变异：normalize 闸口删掉",
    ),
    (
        'M11', 'manifest 里把主世界钩子降级成隔离世界（读不到 reel.data）',
        MANIFEST,
        "        \"src/content/youtube-shorts-hook.js\"\n"
        "      ],\n"
        "      \"run_at\": \"document_idle\",\n"
        "      \"world\": \"MAIN\",",
        "        \"src/content/youtube-shorts-hook.js\"\n"
        "      ],\n"
        "      \"run_at\": \"document_idle\",\n"
        "      \"world\": \"ISOLATED\",",
    ),
    (
        'M12', '提取器不用一手文案（回落到残留的 #snippet）',
        SOCIAL,
        "        const item = this._ytShortsData();\n"
        "        if (item) {\n"
        "          const first = this._ytShortsBuildText(item.title, item.description);\n"
        "          if (first) return first;\n"
        "        }\n",
        "        // 变异：一手文案分支删掉\n",
    ),
    (
        'M13', '提取器不用一手日期（发布日期又空了）',
        SOCIAL,
        "        const item = this._ytShortsData();\n"
        "        if (item && item.publishDate) {\n"
        "          const fresh = this._ytFormatDateString(item.publishDate);\n"
        "          if (fresh) return fresh;\n"
        "        }\n",
        "        // 变异：一手日期分支删掉\n",
    ),
    (
        'M14', 'ensureFresh 不请主世界重扫（桥节点晚到就永远等不到）',
        PAGE_DATA,
        "    api.requestScan();",
        "    // 变异：重扫请求删掉",
    ),
    (
        'M16', '桥节点改回 script.textContent（YouTube Trusted Types 会拦，真机写不进去）',
        HOOK,
        "    node.setAttribute('data-clipmate-json',\n"
        "      JSON.stringify({ v: 1, href: String(href || ''), item: item }));",
        "    node.textContent = JSON.stringify({ v: 1, href: String(href || ''), item: item });",
    ),
    (
        'M15', '删掉整页直开的首屏兜底（直开页拿不到一手数据、每次白等 900ms）',
        HOOK,
        "    try {\n"
        "      var first = win && win.ytInitialPlayerResponse;\n"
        "      var firstItem = normalize(first, id);\n"
        "      if (firstItem) return firstItem;\n"
        "    } catch (e) { /* 忽略 */ }\n"
        "    return null;",
        "    return null;",
    ),
    (
        'M17', 'start() 不装网络钩子（第 3 条那种没预取数据的条目永远拿不到）',
        HOOK,
        "    try { installNetHook(win); } catch (e) { /* 装不上不影响另外两路 */ }",
        "    // 变异：网络钩子不装",
    ),
    (
        'M18', '删掉 collect 的第三路（网络响应缓存查都不查）',
        HOOK,
        "    try {\n"
        "      var store = win && win.__clipmateYtPlayers;\n"
        "      var netItem = store && store[id];\n"
        "      if (netItem && String(netItem.videoId || '') === id) return netItem;\n"
        "    } catch (e) { /* 缓存坏了继续走下一路 */ }",
        "    // 变异：第三路整块搬走",
    ),
    (
        'M19', 'collect 不再校验缓存项的 ID（旧视频顶替当前条）',
        HOOK,
        "      if (netItem && String(netItem.videoId || '') === id) return netItem;",
        "      if (netItem) return netItem;",
    ),
    (
        'M20', 'rememberPlayerJson 不校验 ID 格式（脏数据也进缓存）',
        HOOK,
        "      if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(String(id))) return null;",
        "      if (!id) return null;",
    ),
    (
        'M21', '直接读 res.text() 消费页面自己的响应体（不再 clone）',
        HOOK,
        "                res.clone().text().then(function (t) {",
        "                res.text().then(function (t) {",
    ),
    (
        'M22', '网络响应不按 videoId 存（改成「最近一条」顶替）',
        HOOK,
        "      store[id] = item;",
        "      store['__last__'] = item;",
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
    files = {HOOK, PAGE_DATA, SOCIAL, MANIFEST}
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
                    if line.strip().startswith('✗') or line.strip().startswith('- '):
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
