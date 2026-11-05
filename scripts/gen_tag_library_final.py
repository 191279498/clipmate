# -*- coding: utf-8 -*-
"""影视类标签统一转化库 —— 定稿版生成器（2026-11-05）。

数据源不重复维护：直接执行 gen_tag_mapping_report.py 的「数据段」（统计段之前），
拿到已核对过的 ROWS / STANDARDS / SOURCES / SITE_WORDS，再叠加用户 11 条拍板。

产出（均不改动扩展源码）：
  1. 影视类标签转化库_ruleset_v1.0.json   机器可读规则集（将来扩展直接读）
  2. 影视类标签转化库_定稿规则_20261105.csv  人工核对用（Excel 可开）
  3. 影视类标签转化库_定稿版_20261105.html   可筛选定稿表（主交付）
  4. 影视类标签转化库_定稿说明_20261105.md   定稿说明 + 改动方案
"""
import csv
import html
import json
import os
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'scripts', 'gen_tag_mapping_report.py')

# ---- 复用调研脚本的数据段（统计段之前的全部内容）----
_src = open(BASE, encoding='utf-8').read()
_head = _src.split('# ---------------- 统计 ----------------')[0]
_ns = {'__file__': BASE, '__name__': 'tag_mapping_base'}
exec(compile(_head, BASE, 'exec'), _ns)

ROWS = _ns['ROWS']
SOURCES = _ns['SOURCES']
SITE_WORDS = _ns['SITE_WORDS']
SRC_MAP = {s[0]: s for s in SOURCES}
SITES = ['豆瓣电影', 'IMDb', 'TMDB', 'Bangumi', '红果短剧']

# 标准词：用户 2026-11-05 拍板「短篇」是「短片」的笔误
STANDARDS = [('短片' if t == '短篇' else t) for t in _ns['STANDARDS']]
for r in ROWS:
    r['target'] = r['target'].replace('短篇', '短片')

# ================= 用户 11 条拍板 =================
DECISIONS = [
    ('D1', '「短篇」是不是「短片」？',
     '「短篇」是「短片」',
     '标准词改名：短篇 → 短片。豆瓣/IMDb 的短片、Short、Short-Film 变成字面直通；'
     'TMDB 的 TV-Movie（电视电影）是播出形态，改落「其他信息」；Bangumi「短篇」随后按 D15 也并入短片，'
     '同行的 OVA/泡面番/剧场版/季番 仍只进其他信息。'),
    ('D2', '「纪录」要不要收「纪录片」？',
     '「纪录」要收「纪录片」',
     '标准词保持「纪录」，纪录片 → 纪录，全站通用。'),
    ('D3', '「家庭 / Family / 都市日常」往哪并？',
     '「家庭 / Family / 都市日常」并入「生活」',
     '豆瓣、IMDb、TMDB、红果的 Family/家庭系列一律 → 生活；「儿童」只由 Kids/子供向/幼女向 触发。'),
    ('D4', '「黑色电影 / Film-Noir」要不要并进「黑暗」？',
     '「黑色电影 / Film-Noir」要并进「黑暗」',
     '豆瓣「黑色电影」、IMDb Film-Noir → 黑暗；Dark-Comedy / Dark-Fantasy 拆双写（喜剧+黑暗 / 奇幻+黑暗）。'),
    ('D5', '「悬疑」和「推理」要不要双写？',
     '「悬疑」和「推理」要双写',
     '红果「悬疑推理」→ 悬疑+推理；「刑侦破案」→ 犯罪+推理；Mystery 单写悬疑。'),
    ('D6', '「同性」收不收「百合 / 轻百合」？',
     '「同性」收「百合 / 轻百合」',
     'Bangumi 百合/轻百合/轻百 → 同性，与 BL/耽美 同组。'),
    ('D7', '「综艺」的边界到哪？',
     '真人秀/脱口秀/益智/访谈/Reality/Talk/News 都能塞进去，News 也要，Gameshow 也要',
     '综艺边界最大化：真人秀、脱口秀、访谈（Talk-Show/Talk）、益智竞赛（Game-Show/Quiz-Show）、'
     '才艺赛（Talent-Competition）、生存竞赛、Reality-TV/Reality、News 全部 → 综艺。'),
    ('D8', '「AI剧」是形态还是题材？',
     '「AI剧」是题材',
     'AI剧 进「标签」列（不再只留在「其他信息 → 子分类」）；红果判到 AI剧 子分类时，'
     '「标签」与「其他信息」都要有，且标签里按题材词处理。'),
    ('D9', '「短剧 / 真人剧」要不要作为标签？',
     '「短剧」包含了「短剧 / 真人剧」，红果整站每部剧都固定带这个标签',
     '红果全站固定注入「短剧」，不依赖页面是否出现该词；「真人剧」是它的同义词。漫剧按 D16 另加「AI剧」。'),
    ('D10', 'D 类词（爽点套路、情绪氛围）怎么处理？',
     'D 类词直接在「其他信息」里展示，不用并入「标签」',
     '爽点套路（战神归来/打脸虐渣/马甲）、情绪氛围（热血/治愈/致郁/催泪）、'
     '设定轴（重生/穿越/系统/架空）、形态（OVA/剧场版/TV-Movie/真人剧）一律只在「其他信息」原样展示。'),
    ('D11', '未命中词兜底规则',
     'UGC 标签（尤其 Bangumi、红果）会不断冒新词，查不到就在「其他信息」里展示，不用并入「标签」',
     '查不到 → 原词写进「其他信息」，绝不丢弃、绝不静默替换；「标签」只放库内标准词。'),
    # ---- 第二轮追加调整（用户逐条点名，标号对应他给的表格行号）----
    ('D12', '#41 IMDb Superhero 归哪？',
     '并入「奇幻」——超级英雄本来就是现代的奇幻异能',
     'Superhero → 奇幻，不并「动作」：动作只是表现形式，奇幻是题材本体。'),
    ('D13', '#54 #125 青春成长题材归哪？',
     'Coming-of-Age / Teen-Drama / 青春 → 校园（青春成长多数是校园）',
     'IMDb 两个子类型与 Bangumi「青春」统一归「校园」；少数非校园的成长片会被轻微误伤，按你的判断接受。'),
    ('D14', '#103 Bangumi 擦边福利词归哪？',
     '肉番 / 卖肉 / 肉 / 肉片 / 露点 / 杀必死 / 福利 → 成人',
     '归「成人」不归「情色」：擦边福利不等于情色片，但确实属成人向。'),
    ('D15', '#126 Bangumi「短篇」归哪？',
     '短篇就是短片 → 短片',
     '只把「短篇」并入「短片」；同一行的 OVA / 泡面番 / 剧场版 / 季番 是播出形态，仍只进其他信息。'),
    ('D16', '#153 红果「漫剧」归哪？',
     '漫剧 → AI剧 + 短剧（载体是 AI 做的动画，形态是短剧）',
     '不再并「动画」：按你的口径算 AI剧，形态固定带「短剧」。'),
    ('D17', '「社会」标签怎么办？',
     '保留标签，接受它可能一直空着（指反映社会问题、讽刺现实的作品）',
     '不删、不硬塞词源。目前 5 站没有任何词指向它，标记为「保留待用」。'),
]
DEC = {d[0]: d for d in DECISIONS}

# ================= 定稿处理方式 =================
HANDLING = {
    'L1': ('并入标签', '原词映射为标准标签，写入「标签」列；原词同时留在「其他信息」可追溯'),
    'L2': ('拆双写', '一个复合原词拆成 2 个标准标签同时写入；原词留在「其他信息」'),
    'L3': ('固定注入', '不依赖页面是否出现该词，按站点规则每条都写入'),
    'L4': ('其他信息', '只写「其他信息」，不进「标签」（爽点/情绪/设定/形态）'),
    'L5': ('未命中兜底', '库里查不到 → 原词进「其他信息」，不进「标签」'),
}

# ================= 拍板改写表 =================
# (站点 or None, 原始词精确串, 新 target, 新处理方式, 决策编号, 备注)
APPLY = [
    # D1 短篇 → 短片
    ('豆瓣电影', '短片', '短片', 'L1', 'D1', '标准词已改为「短片」，本行变为字面直通'),
    ('IMDb', 'Short', '短片', 'L1', 'D1', '官方定义：片长 <45 分钟（剧集 <22 分钟）'),
    ('IMDb', 'Short-Film', '短片', 'L1', 'D1', '短片'),
    ('TMDB', 'TV-Movie', '（保留原词）', 'L4', 'D1+D10', '电视电影是播出形态，不是短片'),
    ('Bangumi', '短篇 / OVA / 泡面番 / 剧场版 / 季番', '短片', 'L1', 'D15', '「短篇」＝短片（追加拍板）；同行 OVA/泡面番/剧场版/季番 是播出形态，仍只进其他信息'),
    # D3 家庭 / Family / 都市日常 → 生活
    ('豆瓣电影', '家庭', '生活', 'L1', 'D3', ''),
    ('IMDb', 'Family', '生活', 'L1', 'D3', ''),
    ('TMDB', 'Family', '生活', 'L1', 'D3', ''),
    ('红果短剧', '家庭 / 家庭伦理 / 家族 / 家族振兴 / 婚姻生活 / 婆媳', '生活', 'L1', 'D3', ''),
    # D4 黑色电影 → 黑暗
    ('豆瓣电影', '黑色电影', '黑暗', 'L1', 'D4', ''),
    ('IMDb', 'Film-Noir', '黑暗', 'L1', 'D4', ''),
    ('IMDb', 'Dark-Comedy / Dark-Fantasy', '喜剧 + 黑暗', 'L2', 'D4+D5', '复合词拆双写'),
    # D5 悬疑 / 推理 双写
    ('红果短剧', '悬疑推理 / 悬疑情感 / 悬疑灵异 / 刑侦破案 / 反转', '悬疑 + 推理', 'L2', 'D5',
     '悬疑推理 → 悬疑+推理；刑侦破案 → 犯罪+推理；其余只取悬疑'),
    # D6 同性收百合
    ('Bangumi', '百合 / 轻百合 / 轻百', '同性', 'L1', 'D6', ''),
    ('IMDb', 'Mystery', '悬疑', 'L1', 'D5', 'Mystery 官方定义偏「解谜」，落悬疑；只有红果「悬疑推理」这类一词两义才双写'),
    ('TMDB', 'Mystery', '悬疑', 'L1', 'D5', '同上，单写悬疑'),
    # D7 综艺边界最大化
    ('豆瓣电影', '真人秀', '综艺', 'L1', 'D7', ''),
    ('豆瓣电影', '脱口秀', '综艺', 'L1', 'D7', ''),
    ('IMDb', 'Game-Show', '综艺', 'L1', 'D7', '益智竞赛 = Game Show'),
    ('IMDb', 'News', '综艺', 'L1', 'D7', '新闻时事节目，按拍板归综艺（不再归社会）'),
    ('IMDb', 'Reality-TV', '综艺', 'L1', 'D7', ''),
    ('IMDb', 'Talk-Show', '综艺', 'L1', 'D7', ''),
    ('IMDb', 'Quiz-Show / Talent-Competition / Reality-TV / Talk-Show', '综艺', 'L1', 'D7', ''),
    ('IMDb', 'Survival-Competition', '综艺', 'L1', 'D7', '生存竞赛是节目形态，归综艺不归生存'),
    ('TMDB', 'News', '综艺', 'L1', 'D7', ''),
    ('TMDB', 'Reality', '综艺', 'L1', 'D7', ''),
    ('TMDB', 'Talk', '综艺', 'L1', 'D7', ''),
    # D8 AI剧 是题材
    ('红果短剧', 'AI剧', 'AI剧', 'L1', 'D8', '题材词进「标签」；「其他信息 → 子分类」同时保留'),
    # D9 短剧固定注入
    ('红果短剧', '真人剧 / 短剧', '短剧', 'L3', 'D9', '真人剧是短剧的同义词；此外全站每条都固定注入'),
    ('红果短剧', '漫剧', 'AI剧 + 短剧', 'L2', 'D16', '动态漫画短剧：载体是 AI 生成的动画 → AI剧，形态是短剧'),
    # D10 其他信息（原 C 里没拍板的，一律保留原词）
    ('IMDb', 'Samurai', '（保留原词）', 'L4', 'D10', '武士片，并入武侠会抹掉国别'),
    ('IMDb', 'Superhero', '奇幻', 'L1', 'D12', '超级英雄是现代奇幻异能，按追加拍板并入奇幻（不并动作）'),
    ('IMDb', 'Steamy-Romance', '（保留原词）', 'L4', 'D10', '「热辣爱情」偏尺度，不等于情色片'),
    ('IMDb', 'Coming-of-Age / Teen-Drama', '校园', 'L1', 'D13', '青春成长多数是校园（追加拍板）'),
    ('IMDb', 'Mockumentary', '（保留原词）', 'L4', 'D10', '伪纪录片 ≠ 纪录片'),
    ('TMDB', 'Soap', '（保留原词）', 'L4', 'D10', '肥皂剧是剧种，不是题材'),
    ('Bangumi', '肉番 / 卖肉 / 肉 / 肉片 / 露点 / 杀必死 / 福利', '成人', 'L1', 'D14', '擦边福利归「成人」不归「情色」（追加拍板）'),
    ('Bangumi', '竞技 / 卡牌', '（保留原词）', 'L4', 'D10', '棋牌/综艺竞技 ≠ 体育运动'),
    ('Bangumi', '偶像', '（保留原词）', 'L4', 'D10', '偶像题材是独立主题，不并入音乐'),
    ('Bangumi', '青春', '校园', 'L1', 'D13', '青春成长多数是校园（追加拍板）'),
    ('Bangumi', '致郁', '（保留原词）', 'L4', 'D10', '纯情绪词，按 D10 只进其他信息'),
    ('红果短剧', '奇幻脑洞 / 奇幻异能 / 脑洞 / 系统 / 异能 / 玄学', '奇幻', 'L2', 'D10',
     '只有「奇幻」部分并入标签；脑洞/系统/异能/玄学 原词留在其他信息'),
    ('红果短剧', '成长 / 女性成长 / 大女主 / 女强 / 职场励志', '（保留原词）', 'L4', 'D10', '人物线/爽点，不是题材'),
    ('红果短剧', '萌宝 / 福宝', '（保留原词）', 'L4', 'D10', '角色设定，不等于儿童向'),
    ('红果短剧', '脑洞 / 诡秘 / 灵异', '（保留原词）', 'L4', 'D10', '设定/氛围词'),
    ('红果短剧', '重生 / 穿越 / 穿书 / 异界 / 架空 / 古代', '（保留原词）', 'L4', 'D10',
     '情节设定与时空背景，按 D10 只进其他信息（不并奇幻）'),
    # 合并行：一行里塞了好几个词，每个词落点不同，靠下面的 WORD_OVERRIDES 逐词定
    ('红果短剧', '都市 / 都市日常 / 都市脑洞 / 都市玄幻', '生活 + 奇幻 + 玄幻', 'L2', 'D3',
     '都市/都市日常 → 生活；都市脑洞 → 生活+奇幻；都市玄幻 → 生活+玄幻（逐词见 lookup）'),
    ('TMDB', 'Animation / Comedy / Crime / Documentary / Drama / Family / Mystery / Western',
     '动画 + 喜剧 + 犯罪 + 纪录 + 剧情 + 生活 + 悬疑 + 西部', 'L1', 'D3',
     '剧集与电影共用的 8 个 genre，逐个直通（Family 按 D3 归生活）'),
]

# ================= 逐词落点（合并行的例外，key = (站点, 词)）=================
# 为什么需要：一行 raw 里常有多个词，落点并不相同，例如「都市脑洞」是生活+奇幻，
# 而「都市」只有生活；「悬疑推理」是悬疑+推理，而「悬疑情感」只有悬疑。
# 代码侧真正查表用的是这些逐词结果（见 ruleset 的 lookup 字段）。
WORD_OVERRIDES = {
    ('红果短剧', '都市'): ['生活'], ('红果短剧', '都市日常'): ['生活'],
    ('红果短剧', '都市脑洞'): ['生活', '奇幻'], ('红果短剧', '都市玄幻'): ['生活', '玄幻'],
    ('红果短剧', '悬疑推理'): ['悬疑', '推理'], ('红果短剧', '悬疑情感'): ['悬疑'],
    ('红果短剧', '悬疑灵异'): ['悬疑'], ('红果短剧', '刑侦破案'): ['犯罪', '推理'],
    ('红果短剧', '反转'): ['悬疑'],
    ('红果短剧', '奇幻脑洞'): ['奇幻'], ('红果短剧', '奇幻异能'): ['奇幻'],
    ('红果短剧', '脑洞'): [], ('红果短剧', '系统'): [], ('红果短剧', '异能'): [],
    ('红果短剧', '玄学'): [], ('红果短剧', '诡秘'): [], ('红果短剧', '灵异'): [],
    ('红果短剧', '家庭'): ['生活'], ('红果短剧', '家庭伦理'): ['生活'],
    ('红果短剧', '家族'): ['生活'], ('红果短剧', '家族振兴'): ['生活'],
    ('红果短剧', '婚姻生活'): ['生活'], ('红果短剧', '婆媳'): ['生活'],
    ('红果短剧', '成长'): [], ('红果短剧', '女性成长'): [], ('红果短剧', '大女主'): [],
    ('红果短剧', '女强'): [], ('红果短剧', '职场励志'): [],
    ('红果短剧', '萌宝'): [], ('红果短剧', '福宝'): [],
    ('红果短剧', '漫剧'): ['AI剧', '短剧'], ('红果短剧', '真人剧'): ['短剧'],
    ('红果短剧', '短剧'): ['短剧'],
    ('红果短剧', '玄幻仙侠'): ['玄幻', '修仙'], ('红果短剧', '修真'): ['修仙'],
    ('红果短剧', '仙尊'): ['修仙'], ('红果短剧', '系统修仙'): ['修仙'],
    ('红果短剧', '修仙'): ['修仙'],
    ('红果短剧', '求生'): ['生存'], ('红果短剧', '末世'): ['末世'], ('红果短剧', '丧尸'): ['末世'],
    ('红果短剧', '囤货'): [], ('红果短剧', '无限流'): [], ('红果短剧', '规则怪谈'): ['悬疑'],
    ('红果短剧', '古风权谋'): ['古装'], ('红果短剧', '宫斗宅斗'): ['古装'],
    ('红果短剧', '朝堂权谋'): ['古装'], ('红果短剧', '历史古代'): ['古装'],
    ('红果短剧', '古言甜宠'): ['古装'],
    ('红果短剧', '年代'): ['生活'], ('红果短剧', '乡村'): ['生活'], ('红果短剧', '种田'): ['生活'],
    ('IMDb', 'Dark-Comedy'): ['喜剧', '黑暗'], ('IMDb', 'Dark-Fantasy'): ['奇幻', '黑暗'],
    ('IMDb', 'Korean-Drama'): [], ('IMDb', 'Soap-Opera'): [], ('IMDb', 'Telenovela'): [],
    ('Bangumi', '现世'): [], ('Bangumi', '架空'): [], ('Bangumi', '未来'): [],
    ('Bangumi', '近代'): [], ('Bangumi', '古代'): [], ('Bangumi', '都市'): [],
    ('Bangumi', '废土'): [], ('Bangumi', '校园'): ['校园'],  # 「校园」本身是标准词，不能被背景轴吞掉
    ('Bangumi', '短篇'): ['短片'], ('Bangumi', 'OVA'): [], ('Bangumi', '泡面番'): [],
    ('Bangumi', '剧场版'): [], ('Bangumi', '季番'): [],
    ('TMDB', 'Animation'): ['动画'], ('TMDB', 'Comedy'): ['喜剧'], ('TMDB', 'Crime'): ['犯罪'],
    ('TMDB', 'Documentary'): ['纪录'], ('TMDB', 'Drama'): ['剧情'], ('TMDB', 'Family'): ['生活'],
    ('TMDB', 'Mystery'): ['悬疑'], ('TMDB', 'Western'): ['西部'],
}

# ================= 应用改写 =================
for r in ROWS:
    r['orig_grade'] = r['grade']
    r['orig_target'] = r['target']
    if r['grade'] in ('A', 'B'):
        r['handling'] = 'L1'
    elif r['grade'] == 'D':
        r['handling'] = 'L4'
    else:  # C：未拍板的一律按 D10 精神保留原词
        r['handling'] = 'L4'
    r['decision'] = ''
    r['note'] = ''

_apply_hit = set()
for site, raw, tgt, fin, dec, note in APPLY:
    for i, r in enumerate(ROWS):
        if r['site'] != site or r['raw'] != raw:
            continue
        r['target'] = tgt
        r['handling'] = fin
        r['decision'] = dec
        r['note'] = note
        r['orig_grade'] = r['orig_grade']  # 保留原等级做追溯
        _apply_hit.add(i)

# 未拍板原 C 的行补一句说明
for r in ROWS:
    if r['orig_grade'] == 'C' and not r['decision']:
        r['decision'] = 'D10'
        r['note'] = '原「需拍板」项，本轮未单独拍板 → 按 D10「不确定就不并」保留原词'

# 已拍板但没写备注的：让拍板原话顶掉旧调研理由，
# 否则表里会留着「需你定」「是否双写需定」这类已经过期的措辞，自相矛盾。
for r in ROWS:
    if r['decision'] and not r['note']:
        ids = [x for x in r['decision'].split('+') if x in DEC]
        r['note'] = '按 ' + r['decision'] + ' 拍板：' + '；'.join(DEC[i][2] for i in ids)

# 自检：所有 C 必须已有归属
_leftover = [r['raw'] for r in ROWS if r['orig_grade'] == 'C' and r['handling'] == 'C']
assert not _leftover, f'仍有未归处的 C 级：{_leftover}'

# ================= 统计 =================
def tags_of(r):
    """从 target 里解析出命中的标准标签列表。"""
    out = []
    for t in r['target'].replace('（见同站电影条目）', '').split('+'):
        t = t.strip().strip('（）')
        for sep in ('、', '/'):
            t = t.strip(sep).strip()
        if t in STANDARDS and t not in out:
            out.append(t)
    return out

keep_rows = [r for r in ROWS if r['handling'] in ('L1', 'L2', 'L3')]
drop_rows = [r for r in ROWS if r['handling'] in ('L4', 'L5')]
h_count = Counter(r['handling'] for r in ROWS)

hits = defaultdict(list)
for r in keep_rows:
    for t in tags_of(r):
        hits[t].append(r)

exact_by_site = {}
for site, words in SITE_WORDS.items():
    exact_by_site[site] = [w for w in dict.fromkeys(words) if w in STANDARDS]
exact_sites_by_tag = {t: [s for s, ws in exact_by_site.items() if t in ws] for t in STANDARDS}

# 用户于 D17 确认「保留、接受长期空着」的标签：不算缺陷，单独标状态
RESERVED = {'社会'}

# 每个标签的定稿状态
STATUS = {}
for t in STANDARDS:
    rs = hits.get(t, [])
    c = Counter(r['handling'] for r in rs)
    if t in RESERVED:
        STATUS[t] = ('keep', '保留待用')
    elif c['L1'] + c['L2'] + c['L3'] > 0:
        STATUS[t] = ('ok', '规则已就位')
    elif exact_sites_by_tag[t]:
        STATUS[t] = ('exact', '仅字面一致')
    else:
        STATUS[t] = ('none', '无词源')
n_ok = sum(1 for t in STANDARDS if STATUS[t][0] == 'ok')
n_exact_only = sum(1 for t in STANDARDS if STATUS[t][0] == 'exact')
n_keep = sum(1 for t in STANDARDS if STATUS[t][0] == 'keep')
reserved_tags = [t for t in STANDARDS if STATUS[t][0] == 'keep']
n_none = sum(1 for t in STANDARDS if STATUS[t][0] == 'none')
islands = [t for t in STANDARDS if STATUS[t][0] == 'none']
n_words = sum(len(dict.fromkeys(v)) for v in SITE_WORDS.values())

# ================= 逐词查表（代码侧真正要用的东西）=================
# ruleset.rules 保留「一行原词」的可读形态；lookup 才是 map[site][词] = 标签数组。
# 值为空数组 = 该词已知但只进「其他信息」；键不存在 = 彻底未命中（走兜底）。
lookup = {}
_conflicts = []
for r in ROWS:
    if '实测样本' in r['raw']:
        continue
    base = tags_of(r) if r['handling'] in ('L1', 'L2', 'L3') else []
    for w in [x.strip() for x in r['raw'].split(' / ') if x.strip()]:
        tags = WORD_OVERRIDES.get((r['site'], w), base)
        bucket = lookup.setdefault(r['site'], {})
        if w in bucket and bucket[w] != tags:
            _conflicts.append((r['site'], w, bucket[w], tags))
        bucket[w] = tags

# 字面直通：站点词表里本来就等于标准词的（豆瓣 28 类绝大多数属于这种），
# 必须显式进 lookup，否则代码查表会判成「未命中」→ 掉进兜底 → 豆瓣标签全废。
for _site, _words in SITE_WORDS.items():
    for _w in _words:
        if _w in STANDARDS:
            lookup.setdefault(_site, {}).setdefault(_w, [_w])

# 自检：标准词本身不允许被判成「只进其他信息」
_self_conflict = [(s, w) for s, v in lookup.items() for w, x in v.items() if not x and w in STANDARDS]
assert not _self_conflict, f'标准词被误判成只进其他信息：{_self_conflict}'

n_lookup = sum(len(v) for v in lookup.values())

OUT_JSON = os.path.join(ROOT, '影视类标签转化库_ruleset_v1.0.json')
OUT_CSV = os.path.join(ROOT, '影视类标签转化库_定稿规则_20261105.csv')
OUT_HTML = os.path.join(ROOT, '影视类标签转化库_定稿版_20261105.html')
OUT_MD = os.path.join(ROOT, '影视类标签转化库_定稿说明_20261105.md')

# ================= JSON 规则集 =================
ruleset = {
    'version': '1.0',
    'date': '2026-11-05',
    'note': '影视类标签统一转化库，字段口径见 handlings；扩展侧消费 rules + inject + fallback。',
    'standards': STANDARDS,
    'handlings': {k: {'name': v[0], 'desc': v[1]} for k, v in HANDLING.items()},
    'decisions': [{'id': d[0], 'question': d[1], 'answer': d[2], 'rule': d[3]} for d in DECISIONS],
    'rules': [
        {
            'site': r['site'],
            'raw': r['raw'],
            'tags': tags_of(r),
            'handling': r['handling'],
            'decision': r['decision'],
            'note': r['note'] or r['reason'],
            'source': r['src'],
        }
        for r in ROWS
    ],
    'lookup': lookup,
    'lookup_note': '代码侧查这张表：map[站点][原始词] = 标准标签数组。空数组＝该词已知、但只进「其他信息」；'
                   '键不存在＝未命中，走 fallback 原样写其他信息。',
    'inject': [
        {'site': '红果短剧', 'tag': '短剧', 'scope': '全站每条', 'decision': 'D9',
         'note': '「短剧」是红果的固定形态标签，不依赖页面是否出现该词'}
    ],
    'sites': {
        '豆瓣电影': {'target_field': '标签（独立列）', 'sep': ',', 'source': 'v:genre / #info 类型'},
        'IMDb': {'target_field': '标签（当前为空，类型在「其他信息 → 类型：」）', 'sep': ',',
                 'source': 'JSON-LD genre（英文，需映射）'},
        'TMDB': {'target_field': '标签（当前为空，类型在「其他信息 → 类型：」）', 'sep': ',',
                 'source': 'JSON-LD genre（zh-CN 下已是中文）'},
        'Bangumi': {'target_field': '标签（当前为空）', 'sep': ',',
                    'source': '.subject_tag_section 的 a.l.meta'},
        '红果短剧': {'target_field': '标签（独立列）', 'sep': ',', 'source': 'series.tags'},
    },
    'fallback': '查不到映射的原始词：原样写入「其他信息」，不进「标签」，不丢弃',
}
with open(OUT_JSON, 'w', encoding='utf-8') as f:
    json.dump(ruleset, f, ensure_ascii=False, indent=2)

# ================= CSV =================
with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['序号', '站点', '原始词（原文）', '词表层级', '定稿写入标签', '定稿处理',
                '决策编号', '备注', '原调研等级', '原建议', '来源编号'])
    for i, r in enumerate(ROWS, 1):
        w.writerow([i, r['site'], r['raw'], r['level'],
                    '、'.join(tags_of(r)) or '—',
                    f"{r['handling']} {HANDLING[r['handling']][0]}",
                    r['decision'], r['note'] or r['reason'],
                    r['orig_grade'], r['orig_target'], r['src']])

# ================= HTML =================
def esc(x):
    return html.escape(str(x), quote=True)

HCOLOR = {'L1': '#2E7D5B', 'L2': '#2C6FA8', 'L3': '#8A4FB8', 'L4': '#C9791F', 'L5': '#8A8075'}
SCOLOR = {'ok': '#2E7D5B', 'exact': '#2C6FA8', 'none': '#B23B3B', 'keep': '#8A4F14'}
SLABEL = {'ok': '规则已就位', 'exact': '仅字面一致', 'none': '无词源', 'keep': '保留待用'}

dec_html = ''.join(
    f'<div class="dec"><div class="dh"><span class="did">{esc(d[0])}</span>'
    f'<b>{esc(d[1])}</b></div>'
    f'<div class="da">{esc(d[2])}</div>'
    f'<div class="dr">{esc(d[3])}</div></div>'
    for d in DECISIONS)

rows_html = []
for i, r in enumerate(ROWS, 1):
    hc = HCOLOR[r['handling']]
    hn = HANDLING[r['handling']][0]
    tags = '、'.join(tags_of(r)) or '—'
    text = ' '.join([r['site'], r['raw'], r['target'], r['note'] or r['reason'], r['decision']]).lower()
    rows_html.append(
        f'<tr data-site="{esc(r["site"])}" data-h="{r["handling"]}" data-dec="{esc(r["decision"])}" '
        f'data-text="{esc(text)}">'
        f'<td class="num">{i}</td>'
        f'<td><span class="site">{esc(r["site"])}</span></td>'
        f'<td class="raw">{esc(r["raw"])}</td>'
        f'<td class="tag">{esc(tags)}</td>'
        f'<td><span class="pill" style="color:{hc};border-color:{hc};background:{hc}14">{r["handling"]} {esc(hn)}</span></td>'
        f'<td class="dec-id">{esc(r["decision"]) or "—"}</td>'
        f'<td class="why">{esc(r["note"] or r["reason"])}</td></tr>')

cover_html = []
for i, t in enumerate(STANDARDS, 1):
    rs = hits.get(t, [])
    st, sl = STATUS[t]
    sites = sorted(set(r['site'] for r in rs))
    reps = '、'.join(dict.fromkeys(r['raw'][:22] for r in rs))[:90] if rs else '—'
    decs = sorted(set(d for r in rs for d in r['decision'].split('+')))
    cover_html.append(
        f'<tr><td class="num">{i}</td><td class="tag">{esc(t)}</td>'
        f'<td><span class="st" style="color:{SCOLOR[st]}">{esc(sl)}</span></td>'
        f'<td>{len(rs)}</td>'
        f'<td class="muted">{esc("、".join(sites) or "—")}</td>'
        f'<td class="why">{esc(reps)}</td>'
        f'<td class="dec-id">{esc("、".join(decs) or "—")}</td></tr>')

site_table = ''.join(
    f'<tr><td class="tag">{esc(s)}</td>'
    f'<td class="muted">{esc(ruleset["sites"][s]["source"])}</td>'
    f'<td>{esc(ruleset["sites"][s]["target_field"])}</td>'
    f'<td>{sum(1 for r in ROWS if r["site"] == s and r["handling"] in ("L1", "L2", "L3"))}</td>'
    f'<td>{sum(1 for r in ROWS if r["site"] == s and r["handling"] == "L4")}</td></tr>'
    for s in SITES)

# 「保留待用」（用户确认留着）与「真无词源」分开说，前者不是缺陷
_island_note = ''
if n_none:
    _island_note = ('<br><b>另有 ' + str(n_none) + ' 个真无词源：</b>' + esc('、'.join(islands))
                    + ' —— 5 个站的官方词表里从来不这么写，也没有异形词能并进来，只能手工打或等站点出现对应词。')

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>影视类标签统一转化库 · 定稿版 v1.0 · 2026-11-05</title>
<style>
:root{{--paper:#FAF7F2;--card:#fff;--ink:#2B2620;--muted:#8A8075;--line:#E8E0D5;--brand:#E8752C;--soft:#FFF1E4}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--paper);color:var(--ink);font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}
.wrap{{max-width:1240px;margin:0 auto;padding:32px 24px 80px}}
header{{border-bottom:3px solid var(--brand);padding-bottom:20px;margin-bottom:8px}}
h1{{font-size:26px;margin:0 0 8px}}h2{{font-size:18px;margin:40px 0 14px;padding-left:11px;border-left:4px solid var(--brand)}}
.sub{{color:var(--muted);font-size:13px}}
.badge{{display:inline-block;background:var(--brand);color:#fff;border-radius:999px;padding:2px 10px;font-size:12px;margin-left:8px;vertical-align:3px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:22px 0}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}}
.card .n{{font-size:26px;font-weight:700;color:var(--brand);line-height:1.2}}
.card .l{{font-size:12px;color:var(--muted);margin-top:2px}}
.decs{{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:12px}}
.dec{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}}
.dh{{font-size:13.5px;margin-bottom:6px}}.did{{display:inline-block;background:var(--soft);color:var(--brand);
font-weight:700;border-radius:6px;padding:1px 7px;margin-right:7px;font-size:12px}}
.da{{color:#2E7D5B;font-size:13px;margin-bottom:5px}}
.da:before{{content:"✓ ";font-weight:700}}
.dr{{color:var(--muted);font-size:12.5px;border-top:1px dashed var(--line);padding-top:5px}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13px}}
th{{background:#F4EEE4;text-align:left;padding:9px 10px;font-weight:600;font-size:12.5px;white-space:nowrap}}
td{{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}}
tr:hover td{{background:#FFFAF3}}
.num{{color:var(--muted);width:42px;text-align:right;font-variant-numeric:tabular-nums}}
.raw{{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;max-width:250px}}
.tag{{font-weight:600;color:#8A4F14}}
.pill{{display:inline-block;border:1px solid;border-radius:999px;padding:0 8px;font-size:11.5px;white-space:nowrap}}
.dec-id{{color:var(--muted);font-family:ui-monospace,Consolas,monospace;font-size:12px;white-space:nowrap}}
.why{{color:#6B6157;font-size:12.5px}}
.muted{{color:var(--muted)}}
.site{{display:inline-block;background:#F1EAE0;border-radius:6px;padding:0 7px;font-size:12px;white-space:nowrap}}
.st{{font-weight:600;font-size:12.5px;white-space:nowrap}}
.filters{{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:16px 0 10px}}
.filters button{{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 13px;cursor:pointer;font-size:12.5px;color:var(--ink)}}
.filters button.on{{background:var(--brand);color:#fff;border-color:var(--brand)}}
.filters input{{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13px;min-width:210px;outline:none}}
.note{{background:var(--soft);border-left:4px solid var(--brand);border-radius:0 8px 8px 0;padding:12px 16px;margin:14px 0;font-size:13px}}
.note b{{color:#8A4F14}}
ol li{{margin:6px 0}}
code{{background:#F1EAE0;border-radius:4px;padding:1px 5px;font-size:12.5px;font-family:ui-monospace,Consolas,monospace}}
</style></head><body><div class="wrap">
<header>
<h1>影视类标签统一转化库 · 定稿版<span class="badge">v1.0</span></h1>
<p class="sub">2026-11-05 · 依据你 17 条拍板定稿 · {len(STANDARDS)} 个标准标签 / {len(ROWS)} 条规则 / 纳入 {n_words} 个站点原始词 · 本文件未改动任何扩展源码</p>
</header>

<div class="cards">
<div class="card"><div class="n">{len(STANDARDS)}</div><div class="l">标准标签（短篇→短片）</div></div>
<div class="card"><div class="n">{len(keep_rows)}</div><div class="l">会写进「标签」的规则</div></div>
<div class="card"><div class="n">{len(drop_rows)}</div><div class="l">只进「其他信息」的规则</div></div>
<div class="card"><div class="n">{n_ok}</div><div class="l">规则已就位的标签</div></div>
<div class="card"><div class="n">{n_keep + n_none}</div><div class="l">保留待用（无词源）</div></div>
<div class="card"><div class="n">1</div><div class="l">固定注入（红果·短剧）</div></div>
</div>

<h2>一、你拍的 17 条，落成了什么规则</h2>
<div class="decs">{dec_html}</div>

<h2>二、五个站各自的落点（改代码前必须对齐）</h2>
<table><thead><tr><th>站点</th><th>类型原始来源</th><th>「标签」列现状</th><th>定稿后进标签</th><th>只进其他信息</th></tr></thead>
<tbody>{site_table}</tbody></table>
<div class="note"><b>要紧的一句：</b>现在只有<b>豆瓣</b>和<b>红果</b>真的往「标签」列写值。IMDb、TMDB 的类型塞在「其他信息 → 类型：」里，Bangumi 的标签提取方法写了但<b>全项目没有任何调用点</b>。
所以这份规则要生效，得先让这 3 个站把值落到「标签」列 —— 否则规则写得再全，{len(drop_rows) + len(keep_rows)} 条里也有一大半没人读。</div>

<h2>三、{len(STANDARDS)} 个标准标签覆盖状态</h2>
<table><thead><tr><th>#</th><th>标准标签</th><th>状态</th><th>规则数</th><th>哪些站在用</th><th>代表原词</th><th>决策</th></tr></thead>
<tbody>{''.join(cover_html)}</tbody></table>
<div class="note"><b>「保留待用」{n_keep} 个：</b>{esc('、'.join(reserved_tags) or '（无）')} —— 按 D17 保留，接受它长期空着（指反映社会问题、讽刺现实的作品）。影视站确实很少这么表述，所以<b>不硬塞词源</b>，等真有站点这么标了再补。{_island_note}</div>

<h2>四、全量规则（{len(ROWS)} 条）</h2>
<div class="filters">
<button class="on" data-f="site" data-v="*">全部站点</button>
{''.join(f'<button data-f="site" data-v="{esc(s)}">{esc(s)}</button>' for s in SITES)}
<button data-f="h" data-v="*">全部处理</button>
{''.join(f'<button data-f="h" data-v="{k}">{k} {esc(v[0])}</button>' for k, v in HANDLING.items() if k != "L5")}
<input id="q" placeholder="搜原词 / 标签 / 理由…">
<span class="muted" id="cnt"></span>
</div>
<table><thead><tr><th>#</th><th>站点</th><th>原始词</th><th>写进标签</th><th>定稿处理</th><th>决策</th><th>理由</th></tr></thead>
<tbody id="body">{''.join(rows_html)}</tbody></table>

<h2>五、兜底（你第 10、11 条的规矩）</h2>
<div class="note">
<b>1. 「标签」只放标准词。</b>任何站点词只要没在库内映射上，一律不进「标签」。<br>
<b>2. 原词不许丢。</b>没进「标签」的词，原样写进「其他信息」，用「、」连接，保留站点原本的写法。<br>
<b>3. 站点换了新词怎么办。</b>UGC 站点（Bangumi、红果）天天冒新词，<b>不报错、不猜、不静默替换</b>：查不到就当未命中走第 2 条，等月度复盘再把高频新词补进库。<br>
<b>4. 红果「短剧」是固定注入。</b>不管页面 tags 里有没有这个词，每条都写 —— 这是你第 9 条的原话。
</div>

<h2>六、下一步改代码要动的地方（等你批）</h2>
<table><thead><tr><th>#</th><th>改哪里</th><th>改什么</th><th>为什么必须改</th></tr></thead><tbody>
<tr><td class="num">1</td><td><code>src/shared/tag-normalizer.js</code>（新建）</td><td>装 <code>ruleset_v1.0.json</code> 的规则；导出 <code>normalize(site, rawWords)</code> → <code>{{tags, others}}</code></td><td>唯一实现，5 个站共用一份，不各写一套</td></tr>
<tr><td class="num">2</td><td><code>extractors/bgm-movie.js</code></td><td>把 <code>extractGenres()</code> 接上：补 <code>fields['标签']</code>，并把里面的全局 <code>document</code> 换成 <code>this.doc</code></td><td>现在这个方法<b>没人调用</b>，「标签」列永远是空</td></tr>
<tr><td class="num">3</td><td><code>extractors/imdb.js</code> / <code>tmdb.js</code></td><td>JSON-LD genre 过一遍归一器后写入 <code>fields['标签']</code>；「其他信息」里的「类型：」保留原词</td><td>IMDb 是英文（Action/Drama），不映射进不了中文标签库</td></tr>
<tr><td class="num">4</td><td><code>extractors/douban-movie.js</code> / <code>hongguo-movie.js</code></td><td>已有「标签」过归一器；红果加固定注入「短剧」；红果 AI剧 子分类同时写标签</td><td>第 8、9 条拍板</td></tr>
<tr><td class="num">5</td><td>四类字段映射</td><td>无改动（「标签」字段已存在于影视/剧集字段表）</td><td>—</td></tr>
</tbody></table>
<div class="note"><b>版本号建议：v2.12.0</b>（新增能力，非修 bug）。按项目规矩：先备份 → 改 → 单测 → 真机逐站验 → 出成品 → 推送。</div>

<p class="sub" style="margin-top:36px">数据来源：{esc('；'.join(f"{s[0]} {s[1]}" for s in SOURCES[:6]))} 等，完整清单见调研表。规则可复现：<code>python scripts/gen_tag_library_final.py</code></p>
</div>
<script>
var st={{f:'site',v:'*'}}, hf={{f:'h',v:'*'}}, q='';
function apply(){{
  var rows=document.querySelectorAll('#body tr'), n=0;
  rows.forEach(function(tr){{
    var okS = st.v==='*' || tr.dataset.site===st.v;
    var okH = hf.v==='*' || tr.dataset.h===hf.v;
    var okQ = !q || (tr.dataset.text||'').indexOf(q)>=0;
    var show = okS&&okH&&okQ;
    tr.style.display = show?'':'none';
    if(show) n++;
  }});
  document.getElementById('cnt').textContent = n+' / '+rows.length+' 条';
}}
document.querySelectorAll('.filters button').forEach(function(b){{
  b.addEventListener('click',function(){{
    var f=b.dataset.f, v=b.dataset.v;
    if(f==='site'){{ st={{f:'site',v:v}}; }} else {{ hf={{f:'h',v:v}}; }}
    document.querySelectorAll('.filters button[data-f="'+f+'"]').forEach(function(x){{ x.classList.remove('on'); }});
    b.classList.add('on');
    apply();
  }});
}});
document.getElementById('q').addEventListener('input',function(e){{
  q=e.target.value.trim().toLowerCase(); apply();
}});
apply();
</script>
</body></html>'''
with open(OUT_HTML, 'w', encoding='utf-8') as f:
    f.write(HTML)

# ================= Markdown 定稿说明 =================
md = []
md.append('# 影视类标签统一转化库 · 定稿说明 v1.0\n')
md.append('> 2026-11-05 依据你 17 条拍板定稿。本轮**没有改动任何扩展源码**，只产出规则库与改动方案。\n')
md.append(f'标准标签 **{len(STANDARDS)}** 个（「短篇」已改「短片」）｜规则 **{len(ROWS)}** 条｜纳入站点原始词 **{n_words}** 个\n')
md.append('\n## 一、11 条拍板 → 落地\n')
md.append('| 编号 | 问题 | 你的拍板 | 落成什么规则 |\n|---|---|---|---|')
for d in DECISIONS:
    md.append(f'| {d[0]} | {d[1]} | {d[2]} | {d[3]} |')
md.append('\n## 二、五站落点\n')
md.append('| 站点 | 类型来源 | 「标签」列现状 | 定稿后进标签 | 只进其他信息 |\n|---|---|---|---|---|')
for s in SITES:
    md.append(f'| {s} | {ruleset["sites"][s]["source"]} | {ruleset["sites"][s]["target_field"]} | '
              f'{sum(1 for r in ROWS if r["site"] == s and r["handling"] in ("L1", "L2", "L3"))} | '
              f'{sum(1 for r in ROWS if r["site"] == s and r["handling"] == "L4")} |')
md.append('\n**关键事实**：现在只有豆瓣、红果真的往「标签」写值；IMDb/TMDB 在「其他信息 → 类型：」；'
          'Bangumi 的 `extractGenres()` 全项目零调用。不修落点，规则白做一半。\n')
md.append(f'\n## 三、覆盖状态\n\n- 规则已就位：**{n_ok}** 个\n- 仅字面一致（站点用这个词，但没有异形词需要转换）：**{n_exact_only}** 个\n- 保留待用：**{n_keep}** 个 —— {"、".join(reserved_tags) if reserved_tags else "（无）"}（按 D17 留着、接受长期空着）\n'
          + (f'- 真无词源：**{n_none}** 个 —— {"、".join(islands)}\n' if n_none else ''))
md.append('\n## 四、兜底规矩\n')
md.append('1. 「标签」只放标准词，未命中一律不进。\n')
md.append('2. 未命中的原词原样写进「其他信息」，不丢弃、不静默替换。\n')
md.append('3. UGC 新词走第 2 条，不报错不猜，月度复盘再补库。\n')
md.append('4. 红果「短剧」固定注入，每条都写。\n')
md.append('\n## 五、下一步改代码（等你批）\n')
md.append('| # | 文件 | 改动 | 说明 |\n|---|---|---|---|\n')
md.append('| 1 | `src/shared/tag-normalizer.js`（新建） | 读 ruleset，导出 `normalize(site, rawWords) → {tags, others}` | 唯一实现，5 站共用 |\n')
md.append('| 2 | `extractors/bgm-movie.js` | 接上 `extractGenres()` → `fields[\'标签\']`；`document` → `this.doc` | 现在无人调用 |\n')
md.append('| 3 | `extractors/imdb.js` / `tmdb.js` | genre 归一后写 `fields[\'标签\']`；其他信息保留原词 | IMDb 是英文 |\n')
md.append('| 4 | `extractors/douban-movie.js` / `hongguo-movie.js` | 已有标签过归一器；红果注入「短剧」；AI剧 同时写标签 | 第 8、9 条 |\n')
md.append('\n版本号建议 **v2.12.0**。流程：备份 → 改 → 单测 → 真机逐站验 → 出成品 → 推送。\n')
md.append('\n## 六、文件\n')
md.append(f'- `{os.path.basename(OUT_HTML)}` 主表（可筛选）\n')
md.append(f'- `{os.path.basename(OUT_CSV)}` 定稿规则（Excel 可开）\n')
md.append(f'- `{os.path.basename(OUT_JSON)}` 机器可读规则集（代码直接吃）\n')
md.append('- `scripts/gen_tag_library_final.py` 可复现脚本\n')
with open(OUT_MD, 'w', encoding='utf-8') as f:
    f.write(''.join(md))

# ================= 控制台摘要 =================
print('标准标签:', len(STANDARDS), '| 规则:', len(ROWS), '| 原始词:', n_words)
print('处理分布:', dict(h_count))
print('规则已就位:', n_ok, '| 仅字面一致:', n_exact_only, '| 保留待用:', n_keep, reserved_tags, '| 无词源:', n_none, islands)
print('未被 APPLY 命中数:', len(_apply_hit), '/', len(APPLY))
print('仍为 C 的:', [r['raw'] for r in ROWS if r['handling'] == 'C'])
for p in (OUT_JSON, OUT_CSV, OUT_HTML, OUT_MD):
    print('写出:', os.path.basename(p), os.path.getsize(p), 'bytes')
