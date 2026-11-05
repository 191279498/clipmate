# -*- coding: utf-8 -*-
"""生成「影视类标签统一转化库」调研统计表（HTML / CSV / MD）。
只产出调研文件，不改动扩展源码。数据来自公开官方词表 + 本仓库实测存档。
"""
import csv
import html
import os
import re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_HTML = os.path.join(ROOT, '影视类标签统一转化库_统计表_20261105.html')
OUT_CSV = os.path.join(ROOT, '影视类标签统一转化库_映射数据_20261105.csv')
OUT_MD = os.path.join(ROOT, '影视类标签统一转化库_讨论稿_20261105.md')

STANDARDS = '剧情,爱情,奇幻,动作,生活,喜剧,情色,惊悚,恐怖,动画,冒险,历史,悬疑,科幻,武侠,古装,犯罪,西部,战争,纪录,短篇,灾难,传记,音乐,猎奇,运动,同性,戏曲,成人,歌舞,儿童,政治,社会,黑暗,生存,末世,玄幻,修仙,综艺,短剧,推理,校园,职业,AI剧'.split(',')

SOURCES = [
    ('S1', 'IMDb 官方 Genres 帮助页（28 个官方 genre 及定义，页面标注 Updated 12-March-2026）', 'https://help.imdb.com/article/contribution/titles/genres/GZDRMS6R742JRGAG'),
    ('S2', 'IMDb Interests / 子类型浏览页（官方，200+ 子类型）', 'https://www.imdb.com/fr-ca/feature/genre/'),
    ('S3', 'IMDb 中文界面 genre 浏览页（子类型中文译名样本）', 'https://www.imdb.com/genre/Sci-Fi'),
    ('S4', 'TMDB 官方 Genre API 返回示例（电影 19 / 剧集 16）', 'https://apis.io/apis/tmdb/tmdb-genre-api'),
    ('S5', 'TMDB 官方社区 Full list of genres（电影/剧集词表说明）', 'https://www.themoviedb.org/talk/5d03ca4fc3a36806f6205bd5'),
    ('S6', '豆瓣电影分类排行榜 28 类整理（含 typerank 类型 ID 对照）', 'https://blog.csdn.net/silencewx1005/article/details/135631721'),
    ('S7', '豆瓣电影分类排行榜 28 类（第三方站点说明）', 'https://www.sdmi88.cn/sites/25239.html'),
    ('S8', '豆瓣官方 /j/search_tags?type=tv 接口返回（综艺/纪录片等筛选标签）', 'https://movie.douban.com/j/search_tags?type=tv&source=index'),
    ('S9', '豆瓣「选剧集」页面类型样本', 'https://movie.douban.com/tv/'),
    ('S10', 'Bangumi 标签说明（官方 blog）', 'https://bangumi.tv/blog/286461'),
    ('S11', 'Bangumi 三分类标签列表（官方 blog：世界背景/作品主题/情绪氛围）', 'https://bgm.tv/blog/324482'),
    ('S12', 'Bangumi 站内标签同义词合并规则（官方 blog，2024）', 'https://bgm.tv/blog/333452'),
    ('S13', 'Bangumi 条目公共标签功能公告（2024 起公共标签由维基人维护）', 'https://bgm.tv/group/topic/406595'),
    ('S14', '红果短剧官方分类页（题材标签）', 'https://novelquickapp.com/category'),
    ('S15', '红果短剧官方作品/演员页（题材标签样本）', 'https://novelquickapp.com/actor/shijia829501'),
    ('S16', '红果短剧题材大类整理（第三方，2026-10-11）', 'https://www.huaweijia123.com/baike/14142.html'),
    ('S17', '本仓库实测存档：tests/golden/*.json、tests/fixtures/html/*.html、源码 site-config.js', '本仓库 tests/golden/、tests/fixtures/html/、ClipMate_chrome/src/'),
]
SRC_MAP = {s[0]: s for s in SOURCES}

# 纳入本次统计的原始词表（官方全集 + 有代表性的子类型/题材词 + 本地实测落库词）
SITE_WORDS = {
    '豆瓣电影': '''剧情 喜剧 动作 爱情 科幻 动画 悬疑 惊悚 恐怖 纪录片 短片 情色 音乐 歌舞 家庭 儿童 传记 历史 战争 犯罪 西部 奇幻 冒险 灾难 武侠 古装 运动 黑色电影
        综艺 真人秀 脱口秀 日本动画 国产剧 美剧 日剧 韩剧 热门 同性 舞台艺术 戏曲片'''.split(),
    'IMDb': '''Action Adult Adventure Animation Biography Comedy Crime Documentary Drama Family Fantasy Film-Noir Game-Show History Horror Musical Music Mystery News Reality-TV Romance Sci-Fi Short Sport Talk-Show Thriller War Western
        Wuxia Martial-Arts Kung-Fu Samurai Disaster Superhero Erotic-Thriller Steamy-Romance Dark-Comedy Dark-Fantasy Dystopian-Sci-Fi Survival-Thriller Survival-Competition Zombie-Horror Slasher-Horror Body-Horror Folk-Horror Political-Drama Political-Documentary Workplace-Drama Medical-Drama Legal-Drama Costume-Drama Period-Drama Coming-of-Age Teen-Drama Biopic Short-Film Adult-Animation Anime Mecha Isekai Slice-of-Life True-Crime Mockumentary Docudrama Sitcom Stand-Up-Comedy Satire Parody Romantic-Comedy Psychological-Thriller Spy Conspiracy-Thriller Korean-Drama Soap-Opera Telenovela Sword-and-Sorcery Fairy-Tale Fantasy-Epic Quiz-Show Talent-Competition Reality-TV Talk-Show Post-Apocalyptic Artificial-Intelligence Cyberpunk Time-Travel'''.split(),
    'TMDB': '''Action Adventure Animation Comedy Crime Documentary Drama Family Fantasy History Horror Music Mystery Romance Science-Fiction TV-Movie Thriller War Western
        Action-and-Adventure Kids News Reality Sci-Fi-and-Fantasy Soap Talk War-and-Politics 剧情 犯罪'''.split(),
    'Bangumi': '''剧情 悬疑 推理 校园 音乐 运动 历史 冒险 奇幻 科幻 爱情 黑暗 猎奇 恐怖 战争 日常 搞笑 治愈 热血 励志 青春 致郁 催泪 复仇 文艺 中二 电波 扭曲 卖肉 狗粮 萌 后宫 百合 耽美 BL 男同 腐 基情 女性向 子供向 幼女向 魔法少女 变身 战斗 打斗 格斗 动作 枪战 超能力 异能 超自然系 幻想 魔幻 魔法 异世界 转生 穿越 平行世界 宇宙 太空 赛博朋克 机战 机甲 萝卜 高达 反战 体育 体育番 棒球 运动番 竞技 卡牌 歌番 乐队 偶像 恋爱 纯爱 狗粮 党争 甜 胃疼 轻百合 轻百 肉番 杀必死 福利 血腥 重口味 重口 废土 架空世界 种田 职场 社会见闻 短篇 OVA 泡面番 剧场版 季番 漫改 轻改 原创 现世 架空 龙傲天'''.split(),
    '红果短剧': '''爱情 都市 家庭 成长 古装 剧情 喜剧 悬疑 玄幻 奇幻 脑洞 逆袭 年代 宫廷 战神归来 女性成长 都市爱情 古风爱情 都市日常 都市脑洞 悬疑推理 悬疑灵异 悬疑情感 奇幻爱情 奇幻脑洞 玄幻仙侠 都市玄幻 古风权谋 宫斗宅斗 家庭伦理 历史古代 法律正义 仙侠爱情 现言甜宠 轻喜剧 无敌神医 都市情感 古风言情 甜宠 闪婚 先婚后爱 破镜重圆 暗恋成真 日久生情 打脸虐渣 逆袭翻身 重生逆袭 马甲 总裁 女强 大女主 萌宝 系统 穿越 重生 穿书 异能 玄学 修真 升级流 求生 末世 丧尸 无限流 规则怪谈 动作打斗 刑侦破案 反转 朝堂权谋 家族 家族振兴 扮猪吃虎 世家 现代 乡村 种田 校园 职场 民国 谍战 家国情怀 AI剧 漫剧 真人剧 修仙 系统修仙 异界 架空 古代'''.split(),
}

ROWS = []
def R(site, raw, target, grade, reason, src, level='官方类型'):
    ROWS.append(dict(site=site, raw=raw, level=level, target=target,
                     grade=grade, reason=reason, src=src))

# ---------------- 豆瓣电影 / 剧集 ----------------
S = '豆瓣电影'
R(S, '纪录片', '纪录', 'A', '同一类型，「片」是后缀；你库里写「纪录」，站点写「纪录片」', 'S6', '电影类型')
R(S, '短片', '短篇', 'B', '一般指片长 <45 分钟的短片；你库里是「短篇」，语义接近但用词习惯不同，需确认是否笔误', 'S6', '电影类型')
R(S, '家庭', '生活', 'C', '家庭/家庭伦理更像「生活」，也有人会归到「儿童」；两个标准标签都可能，需你定', 'S6', '电影类型')
R(S, '黑色电影', '黑暗', 'C', 'Film-Noir 是特定犯罪片流派，不等于「黑暗」题材；并入会丢掉流派信息', 'S7', '电影类型')
R(S, '真人秀', '综艺', 'B', '真人秀是综艺的一个门类', 'S8', '剧集类型样本')
R(S, '脱口秀', '综艺', 'B', '脱口秀/访谈节目属综艺', 'S8', '剧集类型样本')
R(S, '日本动画', '动画', 'B', '带地域限定的动画，可并入「动画」但会丢失「日本」信息', 'S8', '剧集筛选标签')
R(S, '戏曲片', '戏曲', 'A', '戏曲片/舞台艺术片即戏曲类', 'S7', '通用类型词')

# ---------------- IMDb 官方 28 类 ----------------
S = 'IMDb'
imdb_official = [
    ('Action','动作','A','官方定义：大量动作/特技场面'),
    ('Adult','成人','A','官方定义专指硬核成人内容，比「情色」更重，归「成人」更准'),
    ('Adventure','冒险','A','官方定义：探险/追寻目标的连续冒险经历'),
    ('Animation','动画','A','官方定义：超过 75% 时长为动画'),
    ('Biography','传记','A','官方定义：以真人一生为主线'),
    ('Comedy','喜剧','A','官方定义：几乎全片喜剧情境'),
    ('Crime','犯罪','A','官方定义：以犯罪行为为主线'),
    ('Documentary','纪录','A','官方定义：真实人物/事件的非虚构影像'),
    ('Drama','剧情','A','官方定义：严肃叙事、冲突与情感'),
    ('Family','儿童','C','官方定义是「合家欢/适合低龄观众」，你库里「儿童」和「生活」都沾边，需定一个'),
    ('Fantasy','奇幻','A','官方定义：魔法/神话/超自然叙事'),
    ('Film-Noir','黑暗','C','1940-50 年代黑色电影流派；也可归「犯罪」，不宜直接当「黑暗」'),
    ('Game-Show','综艺','B','竞赛/益智节目，属综艺'),
    ('History','历史','A','官方定义：真实历史事件与人物'),
    ('Horror','恐怖','A','官方定义：令人恐惧/厌恶的叙事'),
    ('Musical','歌舞','A','官方定义：角色以歌舞推进叙事'),
    ('Music','音乐','A','官方定义：音乐相关内容但非歌舞片'),
    ('Mystery','悬疑','B','官方定义偏「解谜/探寻真相」；你库里同时有「悬疑」「推理」，是否双写需定'),
    ('News','社会','C','新闻时事节目；归「社会」或「综艺」都说得通，且它更像节目形态'),
    ('Reality-TV','综艺','B','真人秀/实景节目'),
    ('Romance','爱情','A','官方定义：以情感依恋为主线'),
    ('Sci-Fi','科幻','A','官方定义：基于推测性科学/太空/环境变化'),
    ('Short','短篇','B','官方定义是片长 <45 分钟（剧集 <22 分钟），与「短篇」用词不同'),
    ('Sport','运动','A','官方定义：以体育项目/赛事为核心'),
    ('Talk-Show','综艺','B','访谈/脱口秀节目'),
    ('Thriller','惊悚','A','官方定义：紧张/悬念叙事'),
    ('War','战争','A','官方定义：真实战争相关'),
    ('Western','西部','A','官方定义：美国西部拓荒题材'),
]
for raw, tgt, g, why in imdb_official:
    R(S, raw, tgt, g, why, 'S1', '官方 genre')

# ---------------- IMDb 子类型（Interests）----------------
imdb_sub = [
    ('Wuxia','武侠','A','IMDb 官方子类型就叫 Wuxia','S2','子类型'),
    ('Martial-Arts / Kung-Fu','武侠','B','功夫/武术片常与武侠混用，但严格说不等于武侠','S2','子类型'),
    ('Samurai','武侠','C','日本武士片；并入「武侠」会抹掉国别，建议保留或归「历史」','S2','子类型'),
    ('Disaster','灾难','A','灾难片','S2','子类型'),
    ('Superhero','（保留原词）','D','超级英雄片在你 44 库里没有对应标签，硬塞「动作」会失真','S2','子类型'),
    ('Erotic-Thriller','情色','A','情色惊悚，归「情色」','S2','子类型'),
    ('Steamy-Romance','情色','C','「热辣爱情」偏尺度，不等于情色片','S2','子类型'),
    ('Dark-Comedy / Dark-Fantasy','喜剧 + 黑暗','C','复合词，是否同时写两个标准标签需你定','S2','子类型'),
    ('Dystopian-Sci-Fi','末世','B','反乌托邦科幻与末世高度重合；也可只归「科幻」','S2','子类型'),
    ('Post-Apocalyptic','末世','A','后末日题材','S3','子类型'),
    ('Survival-Thriller','生存','B','生存惊悚','S2','子类型'),
    ('Survival-Competition','综艺','C','生存竞赛是综艺节目形态，不是「生存」题材，容易误伤','S2','子类型'),
    ('Zombie-Horror / Slasher-Horror / Folk-Horror','恐怖','A','恐怖片子类','S2','子类型'),
    ('Body-Horror','猎奇','B','肉体恐怖也可归「猎奇」，但官方归在 Horror 下','S2','子类型'),
    ('Political-Drama / Political-Documentary','政治','A','政治剧情片/政治纪录片','S2','子类型'),
    ('Workplace-Drama / Medical-Drama / Legal-Drama','职业','B','行业剧（职场/医疗/律政）','S2','子类型'),
    ('Costume-Drama / Period-Drama','古装','B','时代剧/古装剧','S2','子类型'),
    ('Coming-of-Age / Teen-Drama','校园','C','青春成长题材不等于校园，建议保留原词','S2','子类型'),
    ('Biopic','传记','A','传记片','S2','子类型'),
    ('Short-Film','短篇','B','短片','S2','子类型'),
    ('Adult-Animation','成人 + 动画','B','成人动画，两个维度都命中','S2','子类型'),
    ('Anime / Mecha','动画 / 科幻','B','Anime 归动画；机甲（Mecha）归科幻','S2','子类型'),
    ('Isekai','奇幻','B','异世界转生','S2','子类型'),
    ('Slice-of-Life','生活','A','日常/生活片段','S2','子类型'),
    ('True-Crime','犯罪','A','真实犯罪','S2','子类型'),
    ('Mockumentary','纪录','C','伪纪录片不是真纪录片，建议保留原词','S2','子类型'),
    ('Docudrama','纪录 + 剧情','B','文献剧情片','S2','子类型'),
    ('Sitcom / Stand-Up-Comedy / Satire / Parody','喜剧','A','情景喜剧/单口/讽刺/恶搞','S2','子类型'),
    ('Romantic-Comedy','爱情 + 喜剧','B','爱情喜剧，两个维度','S2','子类型'),
    ('Psychological-Thriller / Spy / Conspiracy-Thriller','惊悚','A','心理/间谍/阴谋惊悚','S2','子类型'),
    ('Quiz-Show / Talent-Competition / Reality-TV / Talk-Show','综艺','B','益智/才艺/真人秀/访谈节目','S2','子类型'),
    ('Sword-and-Sorcery / Fairy-Tale / Fantasy-Epic','奇幻','A','剑与魔法/童话/奇幻史诗','S2','子类型'),
    ('Artificial-Intelligence / Cyberpunk / Time-Travel','科幻','B','人工智能/赛博朋克/时空旅行；注意 AI 题材 ≠ 你的「AI剧」形态标签','S2','子类型'),
    ('Korean-Drama / Soap-Opera / Telenovela','（保留原词）','D','剧种或地区形态，不是题材','S2','子类型'),
]
for raw, tgt, g, why, src, lv in imdb_sub:
    R(S, raw, tgt, g, why, src, lv)

# ---------------- TMDB ----------------
S = 'TMDB'
tmdb_movie = [
    ('Action','动作','A','电影官方 genre #28'),('Adventure','冒险','A','#12'),
    ('Animation','动画','A','#16'),('Comedy','喜剧','A','#35'),('Crime','犯罪','A','#80'),
    ('Documentary','纪录','A','#99'),('Drama','剧情','A','#18'),
    ('Family','儿童','C','官方注释「适合儿童与全家」，与「儿童/生活」都可能，需定','#10751'),
    ('Fantasy','奇幻','A','#14'),('History','历史','A','#36'),('Horror','恐怖','A','#27'),
    ('Music','音乐','A','#10402'),
    ('Mystery','悬疑','B','官方词；是否同时写「推理」需定','#9648'),
    ('Romance','爱情','A','#10749'),('Science-Fiction','科幻','A','#878'),
    ('TV-Movie','短篇','C','电视电影是播出形态，不是短片；建议保留原词','#10770'),
    ('Thriller','惊悚','A','#53'),('War','战争','A','#10752'),('Western','西部','A','#37'),
]
for item in tmdb_movie:
    raw, tgt, g, why = item[:4]
    if len(item) > 4:
        why += '（genre id ' + item[4] + '）'
    R(S, raw, tgt, g, why, 'S4', '电影官方 genre')
tmdb_tv = [
    ('Action & Adventure','动作 + 冒险','B','官方复合词，必须拆成两个标准标签','#10759'),
    ('Kids','儿童','A','#10762'),
    ('News','社会','C','新闻节目归「社会」还是「综艺」需定','#10763'),
    ('Reality','综艺','B','#10764'),
    ('Sci-Fi & Fantasy','科幻 + 奇幻','B','官方复合词，拆两个','#10765'),
    ('Soap','生活','C','肥皂剧/家庭长剧，归「生活」仍会丢信息','#10766'),
    ('Talk','综艺','B','#10767'),
    ('War & Politics','战争 + 政治','B','官方复合词，拆两个','#10768'),
    ('Animation / Comedy / Crime / Documentary / Drama / Family / Mystery / Western','（见同站电影条目）','A','剧集与电影共用的 8 个 genre，映射同上','#16 等'),
]
for item in tmdb_tv:
    raw, tgt, g, why = item[:4]
    if len(item) > 4:
        why += '（genre id ' + item[4] + '）'
    R(S, raw, tgt, g, why, 'S4', '剧集官方 genre')

# ---------------- Bangumi ----------------
S = 'Bangumi'
bgm_rows = [
    ('搞笑 / 喜剧 / 欢乐 / 吐槽 / 玩梗 / 恶搞 / 无厘头 / 爆笑 / 讽刺 / 沙雕','喜剧','A','站内同义词合并规则已把这一组统一为「搞笑」；你的标准词是「喜剧」','S12'),
    ('恋爱 / 纯爱 / 狗粮 / 党争 / 甜 / 胃疼 / 恋爱喜剧','爱情','A','站内合并规则：爱情 = 爱情 + 恋爱 + 恋爱喜剧 + 纯爱 + 甜 + 狗粮 + 胃疼 + 党争','S12'),
    ('耽美 / 耽美系 / 男同 / BL / BL动画 / 腐 / 腐向 / 搅基 / 基 / 基情','同性','A','站内合并规则，BL/耽美即同性题材','S12'),
    ('百合 / 轻百合 / 轻百','同性','C','百合是女性同性题材，是否算进「同性」需你定；也可保留原词','S12'),
    ('肉番 / 卖肉 / 肉 / 肉片 / 露点 / 杀必死 / 福利','情色','C','擦边福利 ≠ 情色片，也可能归「成人」，需定','S12'),
    ('战斗 / 打斗 / 打鬥 / 格斗 / 动作 / 枪战','动作','A','站内合并规则：战斗 = 战斗 + 打斗 + 格斗 + 动作 + 枪战','S12'),
    ('超能力 / 超自然系 / 异能','奇幻','B','站内归「超能力」，更接近奇幻设定','S12'),
    ('幻想 / 魔幻 / 魔法 / 奇幻','奇幻','A','站内合并规则：奇幻 = 奇幻 + 幻想 + 魔幻 + 魔法','S12'),
    ('异世界 / 转生 / 穿越 / 平行世界','奇幻','B','站内合并规则归「异世界」，是设定不是题材，并入奇幻需点头','S12'),
    ('宇宙 / 太空 / 太空歌剧 / 赛博朋克','科幻','A','站内合并规则：科幻 = 科幻 + 宇宙 + 太空 + 太空歌剧 + 赛博朋克','S12'),
    ('机战 / 机甲 / 萝卜 / GUNDAM / 高达','科幻','B','站内合并规则归「机战」，通常属科幻','S12'),
    ('战争 / 反战','战争','A','站内合并规则','S12'),
    ('推理系','推理','A','站内合并规则：推理 = 推理 + 推理系','S12'),
    ('猎奇 / 血腥 / 重口味 / 重口','猎奇','A','站内合并规则','S12'),
    ('致郁','黑暗','B','情绪氛围标签，与「黑暗」接近但你库里没有「致郁」','S11'),
    ('废土','末世','A','三分类「世界背景」：处于毁灭边缘的世界背景','S11'),
    ('架空世界','奇幻','B','三分类「世界背景」：完全虚构世界','S11'),
    ('种田','生活','B','三分类「作品主题」：隐居田野/经营发展，偏生活流','S11'),
    ('日常 / 日常系 / 治愈 / 治愈系 / 温情 / 温馨 / 感动','生活','B','站内「日常」是独立大类，你库里最接近「生活」；「治愈」是日常子类','S11'),
    ('职场 / 社会见闻','职业','B','三分类「作品主题」：职场交际、社会见闻','S11'),
    ('竞技 / 卡牌','运动','C','棋牌/综艺竞技不等于体育运动，也可能归「综艺」，需定','S11'),
    ('体育 / 体育番 / 棒球 / 运动番','运动','A','站内合并规则：运动 = 运动 + 体育 + 体育番 + 棒球 + 运动番','S12'),
    ('歌番 / 乐队','音乐','A','站内合并规则：音乐 = 音乐 + 歌番 + 乐队','S12'),
    ('偶像','音乐','C','偶像题材常与音乐绑定，但是独立主题，建议保留原词','S12'),
    ('魔法少女 / 变身','奇幻','B','三分类「内容」里的主题标签','S10'),
    ('子供向 / 子供 / 幼女向','儿童','A','站内合并规则，即低龄向','S12'),
    ('青春','校园','C','青春成长不等于校园，建议保留原词','S11'),
    ('短篇 / OVA / 泡面番 / 剧场版 / 季番','短篇','C','这些是篇幅/播出形态，不是题材；「短篇」字面虽同但语义不同','S10'),
    ('原创 / 漫改 / 轻改 / GAL改 / 游戏改','（保留原词）','D','作品来源分类，不是题材','S10'),
    ('热血 / 燃 / 励志 / 成长 / 催泪 / 复仇 / 文艺 / 中二 / 电波 / 扭曲 / 萌系 / 后宫 / 女性向 / 龙傲天','（保留原词）','D','情绪氛围或受众标签，44 库里没有对应项，硬并会严重失真','S11'),
    ('现世 / 架空 / 未来 / 近代 / 古代 / 都市 / 校园 / 废土','（保留原词或按背景单独建轴）','D','「世界背景」轴与题材轴不同，不建议压进 44 库','S11'),
]
for raw, tgt, g, why, src in bgm_rows:
    R(S, raw, tgt, g, why, src, '站内标签词')

# ---------------- 红果短剧 ----------------
S = '红果短剧'
hg_rows = [
    ('都市爱情 / 古风爱情 / 奇幻爱情 / 仙侠爱情 / 年代爱情 / 现言甜宠 / 都市情感 / 古风言情 / 古装爱情','爱情','A','「爱情」的复合题材词，页面 tags 里是细分题材','S14','题材标签'),
    ('甜宠 / 先婚后爱 / 日久生情 / 暗恋成真 / 破镜重圆 / 闪婚 / 追妻 / 虐恋 / 契约婚姻','爱情','B','言情套路词，通常随爱情题材出现；并入会丢掉套路信息','S15','题材标签'),
    ('轻喜剧','喜剧','A','喜剧子类','S14','题材标签'),
    ('悬疑推理 / 悬疑情感 / 悬疑灵异 / 刑侦破案 / 反转','悬疑 + 推理','B','悬疑/推理两条线都有，是否双写需定','S14','题材标签'),
    ('玄幻仙侠 / 修真 / 仙尊 / 系统修仙 / 修仙','玄幻 + 修仙','A','修仙/修真是「修仙」，玄幻仙侠是「玄幻」','S16','题材标签'),
    ('奇幻脑洞 / 奇幻异能 / 脑洞 / 系统 / 异能 / 玄学','奇幻','C','「设定」不等于题材；脑洞/系统是短剧特有设定词，建议保留','S14','题材标签'),
    ('古风权谋 / 宫斗宅斗 / 朝堂权谋 / 历史古代 / 古言甜宠','古装','A','古装/古代背景题材','S15','题材标签'),
    ('战神归来 / 强者回归 / 隐藏大佬 / 马甲 / 扮猪吃虎 / 打脸虐渣 / 逆袭翻身 / 重生逆袭 / 虐渣','（保留原词）','D','爽点套路，44 库无对应；这是红果最核心的一批词，硬并会让标签失去意义','S15','题材标签'),
    ('重生 / 穿越 / 穿书 / 异界 / 架空 / 古代','（保留原词）','D','情节设定/时空背景，不是题材；「穿越」若要并可考虑奇幻，但需你定','S14','题材标签'),
    ('求生 / 末世 / 丧尸 / 囤货 / 无限流 / 规则怪谈','生存 + 末世','A','求生→生存，末世/丧尸→末世；规则怪谈偏悬疑','S16','题材标签'),
    ('动作打斗','动作','A','动作题材','S15','题材标签'),
    ('家庭 / 家庭伦理 / 家族 / 家族振兴 / 婚姻生活 / 婆媳','生活','B','家庭伦理/家族题材与「生活」最近','S14','题材标签'),
    ('都市 / 都市日常 / 都市脑洞 / 都市玄幻','生活','C','都市是现代生活背景，也可能是纯背景标签；归「生活」需你定','S14','题材标签'),
    ('年代 / 乡村 / 种田','生活','B','年代/乡村/种田流偏生活流','S16','题材标签'),
    ('成长 / 女性成长 / 大女主 / 女强 / 职场励志','职业','C','女性成长/职场励志与「职业」沾边，但更像人物线，建议保留','S15','题材标签'),
    ('校园 / 青春 / 学渣逆袭','校园','A','校园题材','S16','题材标签'),
    ('职场','职业','A','职场题材','S14','题材标签'),
    ('法律正义 / 刑侦破案','犯罪','B','律政/刑侦题材','S15','题材标签'),
    ('民国 / 谍战 / 家国情怀','历史','B','民国/谍战属近现代历史背景','S16','题材标签'),
    ('AI / 平行世界 / 外星 / 末世','科幻','B','科幻/末世题材；注意 AI 题材 ≠ 形态标签「AI剧」','S16','题材标签'),
    ('萌宝 / 福宝','儿童','C','萌宝是角色设定，不等于儿童向','S16','题材标签'),
    ('脑洞 / 诡秘 / 灵异','猎奇','C','猎奇/诡秘氛围接近，但红果多归悬疑或奇幻','S15','题材标签'),
    ('AI剧','AI剧','A','红果「子分类」判据词，字面一致；但它现在写在「其他信息」而非「标签」列','S17','形态标签'),
    ('漫剧','动画','C','漫剧是动画化短剧形态，是否归「动画」需定','S17','形态标签'),
    ('真人剧 / 短剧','短剧','C','整站都是短剧，作为标签会 100% 命中、没有区分度；建议只作形态字段','S17','形态标签'),
    ('脑洞,穿越,古代,乡村（实测样本1）','（保留原词）','D','本地 golden 实测：hongguo-7671966197985856536 的标签列原样就是这 4 个词','S17','实测落库'),
    ('脑洞,重生,求生,升级流,异界（实测样本2）','生存','B','含「求生」；其余 4 词无对应，需保留原词','S17','实测落库'),
    ('玄幻,异界（实测样本3）','玄幻','A','含「玄幻」字面一致；「异界」需保留','S17','实测落库'),
    ('家族,家族振兴,穿越,扮猪吃虎,女强,总裁,世家,现代（实测样本4）','生活','B','「家族/家族振兴」可归生活；其余 6 词是设定/爽点，需保留','S17','实测落库'),
]
for raw, tgt, g, why, src, lv in hg_rows:
    R(S, raw, tgt, g, why, src, lv)

# ---------------- 统计 ----------------
grade_names = {'A': '直接并入（同义/中英对译）', 'B': '建议并入（近义/上下位）',
               'C': '需你拍板（跨类/易误伤）', 'D': '不并入（保留原词）'}
grade_count = Counter(r['grade'] for r in ROWS)
site_count = Counter(r['site'] for r in ROWS)
exact_by_site = {}
for site, words in SITE_WORDS.items():
    exact_by_site[site] = [w for w in dict.fromkeys(words) if w in STANDARDS]
exact_all = sorted(set(w for v in exact_by_site.values() for w in v), key=STANDARDS.index)

# 每个标准标签的异形命中（复合目标按 + / 、 拆开）
hits = defaultdict(list)
for r in ROWS:
    if r['grade'] == 'D':
        continue
    for t in re.split(r'[+/、]', r['target'].replace('（见同站电影条目）', '')):
        t = t.strip().strip('（）')
        if t in STANDARDS:
            hits[t].append(r)

exact_sites_by_tag = {t: [s for s, ws in exact_by_site.items() if t in ws] for t in STANDARDS}
# 站点从来不用的标准词（库里有、五站词表里没有这个字面）
exact_missing = [t for t in STANDARDS if not exact_sites_by_tag[t]]
# 没有任何 A/B 级可并词、只能靠 C 级拍板才触发的标签
only_pending = [t for t in STANDARDS
                if hits.get(t) and not any(x['grade'] in ('A', 'B') for x in hits[t])]
# 孤岛：站点不用这个词，且没有任何异形词指向它
islands = [t for t in STANDARDS if not hits.get(t) and not exact_sites_by_tag[t]]

# ---------------- CSV ----------------
with open(OUT_CSV, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['序号', '站点', '原始词（原文）', '词表层级', '建议并入（你的标准标签）', '关系等级', '判定理由', '来源编号', '来源说明', '来源链接'])
    for i, r in enumerate(ROWS, 1):
        s = SRC_MAP[r['src']]
        w.writerow([i, r['site'], r['raw'], r['level'], r['target'], grade_names[r['grade']],
                    r['reason'], r['src'], s[1], s[2]])

# ---------------- HTML ----------------
def esc(x):
    return html.escape(str(x), quote=True)

def badge(g):
    return f'<span class="pill g{g}">{esc(g)} {esc(grade_names[g].split("（")[0])}</span>'

src_links = {s[0]: s[2] for s in SOURCES}
row_html = []
for i, r in enumerate(ROWS, 1):
    link = src_links[r['src']]
    srccell = (f'<a href="{esc(link)}" target="_blank" rel="noopener">{esc(r["src"])}</a>'
               if link.startswith('http') else f'<span class="muted">{esc(r["src"])}（本地）</span>')
    text = ' '.join([r['site'], r['raw'], r['target'], r['reason'], r['level']])
    row_html.append(
        f'<tr data-site="{esc(r["site"])}" data-grade="{esc(r["grade"])}" data-text="{esc(text.lower())}">'
        f'<td class="num">{i}</td><td><span class="site s{list(SITE_WORDS).index(r["site"])}">{esc(r["site"])}</span></td>'
        f'<td class="raw">{esc(r["raw"])}</td><td class="muted">{esc(r["level"])}</td>'
        f'<td class="target">{esc(r["target"])}</td><td>{badge(r["grade"])}</td>'
        f'<td class="why">{esc(r["reason"])}</td><td>{srccell}</td></tr>')

cover_html = []
for i, t in enumerate(STANDARDS, 1):
    rs = hits.get(t, [])
    c = Counter(x['grade'] for x in rs)
    sites = sorted(set(x['site'] for x in rs))
    reps = '、'.join(x['raw'][:26] for x in rs[:3]) if rs else '—'
    exact_sites = exact_sites_by_tag[t]
    if c['A'] + c['B'] > 0:
        status = '<span class="st ok">可并入</span>'
    elif c['C'] > 0:
        status = '<span class="st ask">仅待定</span>'
    elif exact_sites:
        status = '<span class="st none">仅字面一致</span>'
    else:
        status = '<span class="st none">孤岛</span>'
    cover_html.append(
        f'<tr><td class="num">{i}</td><td class="target">{esc(t)}</td>'
        f'<td class="muted">{esc("、".join(exact_sites) or "—")}</td>'
        f'<td>{c["A"]}</td><td>{c["B"]}</td><td>{c["C"]}</td>'
        f'<td class="muted">{esc("、".join(sites) or "—")}</td>'
        f'<td class="why">{esc(reps)}</td><td>{status}</td></tr>')

exact_html = []
for s in ['豆瓣电影', 'IMDb', 'TMDB', 'Bangumi', '红果短剧']:
    ws = exact_by_site[s]
    exact_html.append(f'<tr><td class="target">{esc(s)}</td><td>{len(dict.fromkeys(SITE_WORDS[s]))}</td>'
                      f'<td>{len(ws)}</td><td class="why">{esc("、".join(ws) or "（英文词表，无字面一致项）")}</td></tr>')

sources_html = ''.join(
    f'<li><b>{esc(k)}</b> · {esc(desc)} · '
    + (f'<a href="{esc(url)}" target="_blank" rel="noopener">{esc(url)}</a>' if url.startswith('http') else f'<span class="muted">{esc(url)}</span>')
    + '</li>' for k, desc, url in SOURCES)

pending = [
    ('「短篇」是不是「短片」？', '各站通用说法是「短片 / Short / Short-Film / OVA」，你库里写「短篇」。若是你本意如此，转化库要把「短片」并进「短篇」；如果是笔误，建议直接改标准标签。'),
    ('「纪录」要不要收「纪录片」？', '这是零风险的一条，建议直接收，但先确认标准词是否想改成「纪录片」。'),
    ('「家庭 / Family / 都市日常」往哪并？', '候选是「生活」或「儿童」，两条都能讲通，定一个才不会一会儿这样一会儿那样。'),
    ('「黑色电影 / Film-Noir」要不要并进「黑暗」？', '它是一个具体流派，并进「黑暗」会把 1940s 黑色电影和黑暗题材混成一团。我倾向「保留原词」。'),
    ('「悬疑」和「推理」要不要双写？', 'IMDb Mystery、TMDB Mystery、豆瓣「悬疑」在不同站含义不同；红果「悬疑推理」一个词同时含两条线。'),
    ('「同性」收不收「百合 / 轻百合」？', 'BL/耽美并入零争议；百合是否算「同性」需要你定。'),
    ('「综艺」的边界到哪？', '真人秀/脱口秀/益智/访谈/Reality/Talk/News 都能往里塞，但 News 也像「社会」，Gameshow 也像竞赛。'),
    ('「AI剧」是形态还是题材？', '红果现在把它放在「其他信息 → 子分类」，而「人工智能题材」电影完全不是一回事；建议 AI剧只作形态字段，不参与题材合并。'),
    ('「短剧 / 真人剧」要不要作为标签？', '红果整站都是短剧，写了等于每部剧都带这个标签，没有区分度。建议只保留在形态字段。'),
    ('D 类词（爽点套路、情绪氛围）怎么处理？', '「战神归来 / 打脸虐渣 / 治愈 / 热血」这类词硬并会失真。建议「原词照留」，或给它们单开一组「扩展标签」。'),
    ('未命中词兜底规则', 'UGC 标签（尤其 Bangumi、红果）会不断冒新词，库必须有「查不到就原样显示」的兜底，不能静默丢词。'),
]
pending_html = ''.join(f'<div class="q"><b>{esc(q)}</b><p>{esc(a)}</p></div>' for q, a in pending)

stat_total_words = sum(len(dict.fromkeys(v)) for v in SITE_WORDS.values())
n_exact = len(exact_all)
n_island = len(islands)
n_missing = len(exact_missing)
n_only_pending = len(only_pending)
n_ok = sum(1 for t in STANDARDS if hits.get(t) and any(x['grade'] in ('A', 'B') for x in hits[t]))
missing_text = '、'.join(exact_missing)
island_text = '、'.join(islands) or '（无）'
pending_text = '、'.join(only_pending) or '（无）'

HTML = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>影视类标签统一转化库 · 近义词统计表 · 2026-11-05</title>
<style>
:root{{--paper:#FAF7F2;--card:#FFFFFF;--ink:#2B2620;--muted:#8A8075;--line:#E8E0D5;--brand:#E8752C;--brand-soft:#FFF1E4;--green:#2E7D5B;--blue:#2C6FA8;--orange:#C9791F;--grey:#8A8075}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--paper);color:var(--ink);font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}
.wrap{{max-width:1280px;margin:0 auto;padding:32px 24px 80px}}
header{{border-bottom:3px solid var(--brand);padding-bottom:20px;margin-bottom:28px}}
h1{{font-size:27px;margin:0 0 8px;letter-spacing:.5px}}h2{{font-size:19px;margin:38px 0 14px;padding-left:11px;border-left:4px solid var(--brand)}}
h3{{font-size:15px;margin:22px 0 10px;color:var(--muted)}}
.sub{{color:var(--muted);font-size:13px}}
.cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:22px 0}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;box-shadow:0 2px 8px rgba(80,60,30,.04)}}
.card .n{{font-size:26px;font-weight:700;color:var(--brand);line-height:1.2}}.card .l{{font-size:12px;color:var(--muted);margin-top:4px}}
.note{{background:var(--brand-soft);border:1px solid #F2D6BC;border-radius:12px;padding:16px 20px;margin:18px 0}}
.note b{{color:#B6541A}}.note ul{{margin:8px 0 0;padding-left:20px}}.note li{{margin:5px 0}}
table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13px}}
th{{background:#F3EDE4;text-align:left;padding:10px 12px;font-weight:600;white-space:nowrap;position:sticky;top:0;z-index:1}}
td{{padding:9px 12px;border-top:1px solid var(--line);vertical-align:top}}tr:hover td{{background:#FFFBF5}}
.num{{color:var(--muted);width:34px;white-space:nowrap}}.raw{{font-weight:600;min-width:170px}}.target{{color:#A34C13;font-weight:600;min-width:120px}}
.why{{color:#5B5249;min-width:200px}}.muted{{color:var(--muted)}}a{{color:var(--blue);text-decoration:none}}a:hover{{text-decoration:underline}}
.pill{{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;border:1px solid}}
.gA{{color:var(--green);background:#E8F5EE;border-color:#BFE3CE}}.gB{{color:var(--blue);background:#EAF2FA;border-color:#C5DDF1}}
.gC{{color:var(--orange);background:#FFF3E3;border-color:#F0D2A8}}.gD{{color:var(--grey);background:#F2F0ED;border-color:#DDD8D2}}
.site{{display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;white-space:nowrap;background:#F0EBE4;color:#5B5249}}
.s0{{background:#E9F3EA;color:#2E6B3E}}.s1{{background:#F2EAD9;color:#8A6221}}.s2{{background:#E6EFF6;color:#245B85}}.s3{{background:#F3E8F3;color:#7A3D7A}}.s4{{background:#FCE9E4;color:#A2452F}}
.st{{font-size:11px;padding:2px 8px;border-radius:6px;white-space:nowrap}}.ok{{background:#E8F5EE;color:var(--green)}}.ask{{background:#FFF3E3;color:var(--orange)}}.none{{background:#F2F0ED;color:var(--grey)}}
.ctrl{{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0}}
select,input[type=search]{{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 11px;font:13px inherit;color:var(--ink)}}
input[type=search]{{min-width:280px}}#shown{{color:var(--muted);font-size:12px;margin-left:auto}}
.scroll{{max-height:620px;overflow:auto;border-radius:10px;border:1px solid var(--line)}}
.scroll table{{border:0;border-radius:0}}.scroll th{{position:sticky;top:0}}
.q{{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:8px;padding:12px 16px;margin:10px 0}}
.q p{{margin:5px 0 0;color:#5B5249;font-size:13px}}
.src{{font-size:12px;line-height:1.9;padding-left:20px}}.src li{{margin:4px 0;word-break:break-all}}
footer{{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}}
</style></head><body><div class="wrap">
<header><h1>影视类标签统一转化库 · 近义词统计表</h1>
<div class="sub">调研日期 2026-11-05 ｜ 范围：扩展影视组 5 个站（豆瓣电影 / IMDb / TMDB / Bangumi / 红果短剧）｜ 对照基准：你的 44 个私人标签</div></header>

<div class="note"><b>先说结论（三句话）：</b>
<ul>
<li><b>值得建，但现在不是第一步。</b>实测发现「标签」这一列只有豆瓣、红果两站有值；IMDb / TMDB 把类型写在「其他信息 → 类型：」里（前者英文、后者中文），Bangumi 的 extractGenres() 只定义了、全项目没有调用点、golden 样本里标签全空。只做词表映射，3 个站根本吃不到。</li>
<li><b>词表本身高度可归并。</b>本次纳入 {stat_total_words} 个原始词条目，其中 {len(ROWS)} 条是「文字不同但意思相近」的异形词：{grade_count['A']} 条可直接并入、{grade_count['B']} 条建议并入、{grade_count['C']} 条需你拍板、{grade_count['D']} 条建议保留原词。</li>
<li><b>别做「全量替换」。</b>红果的爽点词（打脸虐渣/战神归来）、Bangumi 的情绪词（治愈/热血/致郁）在你 44 库里没有位置，硬并会丢信息；建议「能并的并、不能并的原样留」双轨，并保留原值备查。</li>
</ul></div>

<div class="cards">
<div class="card"><div class="n">44</div><div class="l">你的标准标签</div></div>
<div class="card"><div class="n">5</div><div class="l">影视组站点</div></div>
<div class="card"><div class="n">{stat_total_words}</div><div class="l">纳入统计的原始词条目</div></div>
<div class="card"><div class="n">{len(ROWS)}</div><div class="l">异形（不同文字）映射</div></div>
<div class="card"><div class="n">{grade_count['A'] + grade_count['B']}</div><div class="l">可直接 / 建议并入</div></div>
<div class="card"><div class="n">{grade_count['C']}</div><div class="l">需你拍板</div></div>
<div class="card"><div class="n">{n_missing}</div><div class="l">站点从不使用的标准词</div></div>
<div class="card"><div class="n">{n_only_pending}</div><div class="l">仅靠拍板才触发的标签</div></div>
</div>

<h2>一、先看现状：五站的「类型」到底落在哪一格</h2>
<table><thead><tr><th>站点</th><th>扩展实际写入位置</th><th>原始值形态</th><th>分隔符</th><th>实测样本（本仓库 golden / HTML 存档）</th></tr></thead><tbody>
<tr><td class="target">豆瓣电影</td><td>独立的「标签」列</td><td>中文官方类型</td><td>半角逗号</td><td class="why">douban-movie-1292052：<b>剧情,犯罪</b></td></tr>
<tr><td class="target">红果短剧</td><td>独立的「标签」列</td><td>短剧题材词（站点数据全量）</td><td>半角逗号</td><td class="why">hongguo-7700…：<b>脑洞,重生,求生,升级流,异界</b>；子分类（AI剧/漫剧/真人剧）在「其他信息」</td></tr>
<tr><td class="target">IMDb</td><td>「其他信息 → 类型：…」</td><td><b>英文</b> JSON-LD genre</td><td>顿号</td><td class="why">imdb-tt0185906：<b>类型：Action、Drama、History</b>；标签列空</td></tr>
<tr><td class="target">TMDB</td><td>「其他信息 → 类型：…」</td><td>中文 JSON-LD genre（随界面语言）</td><td>顿号</td><td class="why">tmdb-movie-278：<b>类型：剧情、犯罪</b>；标签列空</td></tr>
<tr><td class="target">Bangumi</td><td>「标签」列<b>空</b></td><td>extractGenres() 只有定义、无调用点</td><td>顿号（未生效）</td><td class="why">bgm-265 / bgm-64965：<b>标签 = （空）</b></td></tr>
</tbody></table>
<p class="sub">来源：本仓库 tests/golden/*.json、tests/fixtures/html/*.html、ClipMate_chrome/src/content/extractors/*.js（S17）。这也是「要不要建库」讨论里最该先解决的一层：字段没统一落位，词表统一了也只覆盖 2 个站。</p>

<h2>二、字面一致基线（不用转换的那部分）</h2>
<table><thead><tr><th>站点</th><th>纳入词条目</th><th>与你 44 库字面一致</th><th>一致词清单</th></tr></thead><tbody>{''.join(exact_html)}</tbody></table>
<p class="sub">合计 {n_exact} 个不同的词字面一致（多数来自豆瓣 28 类、Bangumi 题材标签、红果一级题材）。英文站（IMDb/TMDB 英文词表）本身 0 个字面一致，全靠中英映射；TMDB 中文界面实测「剧情 / 犯罪」字面一致。<b>注意「字面一致 ≠ 语义一致」</b>：Bangumi 的「短篇」是篇幅/播出形态，红果的「AI剧」写在「其他信息·子分类」而不是标签列，这两条不能当成已经对齐。</p>
<p class="sub">你库里有 {n_missing} 个词，五站词表里从来不这么写：<b>{missing_text}</b>。它们只能靠下面的异形映射才能被站点触发，这也是转化库最主要的价值所在。</p>

<h2>三、主表：不同文字、意思相近的异形词（可筛选）</h2>
<div class="ctrl">
<select id="fSite"><option value="">全部站点</option>{''.join(f'<option value="{esc(s)}">{esc(s)}</option>' for s in SITE_WORDS)}</select>
<select id="fGrade"><option value="">全部等级</option>{''.join(f'<option value="{g}">{esc(grade_names[g])}</option>' for g in 'ABCD')}</select>
<input type="search" id="q" placeholder="搜原始词 / 标准标签 / 理由，例如：短片、Wuxia、末世">
<span id="shown"></span></div>
<div class="scroll"><table id="main"><thead><tr><th>#</th><th>站点</th><th>原始词（原文）</th><th>词表层级</th><th>建议并入</th><th>等级</th><th>判定理由</th><th>来源</th></tr></thead>
<tbody>{''.join(row_html)}</tbody></table></div>
<p class="sub">等级口径：<b>A 直接并入</b>＝同义、中英对译、简称全称，零争议；<b>B 建议并入</b>＝近义或上下位，语义略有出入但通用；<b>C 需你拍板</b>＝跨类别/复合词/形态词，合并会丢信息；<b>D 不并入</b>＝44 库里没有合适位置，建议原样保留。</p>

<h2>四、覆盖统计：你的 44 个标签，各自能收到多少异形词</h2>
<table><thead><tr><th>#</th><th>标准标签</th><th>字面一致站点</th><th>A</th><th>B</th><th>C</th><th>异形词来自</th><th>代表原始词</th><th>状态</th></tr></thead>
<tbody>{''.join(cover_html)}</tbody></table>
<p class="sub">状态口径：<b>可并入</b>＝有 A/B 级异形词（{n_ok} 个标签）；<b>仅待定</b>＝只有 C 级争议词，得你先拍板（{pending_text}）；<b>孤岛</b>＝站点不用这个词、也没有异形词指向它（{island_text}）。「字面一致站点」为「—」的 {n_missing} 个标签，说明站点根本不用这个说法，全靠映射。</p>

<h2>五、要你拍板的 {len(pending)} 件事</h2>
{pending_html}

<h2>六、我的建议（不改代码的版本）</h2>
<div class="note"><b>建议「建，但分两步走」：</b>
<ul>
<li><b>第 1 步（先修落位，跟词表无关）：</b>让 IMDb / TMDB / Bangumi 的类型也进「标签」列，并与豆瓣/红果统一分隔符；其他信息里的「类型：」是留是删由你定。这一步做完，转化库才能一次覆盖 5 站。</li>
<li><b>第 2 步（再做词表）：</b>一张「站点 + 原始词 → 标准标签」的映射表，站点门禁写在最前面（避免同名跨站误伤）；A 级默认生效、B 级默认生效但可在设置里关、C 级先不动等你拍板、D 级查不到就原样输出。</li>
<li><b>永远保留原值：</b>建议在「其他信息」或隐藏字段里留一份站点原始词，转换是可逆的；以后你改标签库、或者发现误并，能查得回来。</li>
<li><b>词表要能长：</b>Bangumi 是用户标签、红果题材天天上新，长尾词穷举不完，所以「查不到就原样留」必须是硬规则，不能静默丢弃。</li>
<li><b>本次只是调研：</b>没有改动 ClipMate_chrome/ 里任何一行源码，也没动版本号、没出成品。</li>
</ul></div>

<h2>七、资料来源</h2>
<ul class="src">{sources_html}</ul>
<p class="sub">口径说明：IMDb 28 个官方 genre、TMDB 电影 19 + 剧集 16、豆瓣电影 28 类为「官方全集」；IMDb Interests 子类型、Bangumi 站内标签、红果题材词为「有代表性的样本 + 本地实测存档」，不是穷举。第三方整理页只用来补中文题材词，官方词表优先。</p>
<footer>采媒灵 Chrome 版 · 影视标签统一转化库调研 · 生成于 2026-11-05 · 仅调研，未改动扩展源码</footer>
</div>
<script>
(function(){{
  var rows=[].slice.call(document.querySelectorAll('#main tbody tr'));
  var fs=document.getElementById('fSite'),fg=document.getElementById('fGrade'),q=document.getElementById('q'),out=document.getElementById('shown');
  function apply(){{
    var s=fs.value,g=fg.value,t=q.value.trim().toLowerCase(),n=0;
    rows.forEach(function(r){{
      var ok=(!s||r.dataset.site===s)&&(!g||r.dataset.grade===g)&&(!t||r.dataset.text.indexOf(t)>=0);
      r.style.display=ok?'':'none'; if(ok)n++;
    }});
    out.textContent='显示 '+n+' / {len(ROWS)} 条';
  }}
  fs.onchange=apply;fg.onchange=apply;q.oninput=apply;apply();
}})();
</script></body></html>'''

with open(OUT_HTML, 'w', encoding='utf-8') as f:
    f.write(HTML)

# ---------------- Markdown 讨论稿 ----------------
md = [
    '# 影视类标签统一转化库 · 讨论稿（2026-11-05）',
    '',
    '> 只做调研，未改动扩展源码、未动版本号、未出成品。数据文件：同目录 HTML 统计表 + CSV 映射数据。',
    '',
    '## 一句话结论',
    '',
    f'值得建，但先修字段落位。本次纳入 {stat_total_words} 个原始词条目，整理出 {len(ROWS)} 条「文字不同、意思相近」的映射：'
    f'A 直接并入 {grade_count["A"]} 条、B 建议并入 {grade_count["B"]} 条、C 需拍板 {grade_count["C"]} 条、D 保留原词 {grade_count["D"]} 条。',
    '',
    '## 关键现状（本地实测，比网上词表更要紧）',
    '',
    '| 站点 | 类型写在哪 | 原始值 | 实测样本 |',
    '|---|---|---|---|',
    '| 豆瓣电影 | 独立「标签」列 | 中文，半角逗号 | `剧情,犯罪` |',
    '| 红果短剧 | 独立「标签」列 | 题材词，半角逗号 | `脑洞,重生,求生,升级流,异界`；AI剧/漫剧/真人剧在「其他信息·子分类」 |',
    '| IMDb | 「其他信息 → 类型：」 | **英文** | `类型：Action、Drama、History` |',
    '| TMDB | 「其他信息 → 类型：」 | 中文（随界面） | `类型：剧情、犯罪` |',
    '| Bangumi | 「标签」列空 | extractGenres() 只有定义、无调用点 | `标签 = （空）` |',
    '',
    '所以只做词表映射，5 站里只有 2 站吃得到。',
    '',
    '## 分级口径',
    '',
    '- **A 直接并入**：同义、中英对译、简称/全称，零争议。',
    '- **B 建议并入**：近义或上下位，语义略有出入但通用。',
    '- **C 需你拍板**：跨类别、复合词、形态词，合并会丢信息。',
    '- **D 不并入**：44 库里没有合适位置，建议原样保留。',
    '',
    f'44 个标准标签中：{n_ok} 个有 A/B 级可并入词；{n_missing} 个词五站从不这么写（{missing_text}），全靠映射触发；'
    f'{n_only_pending} 个标签只有争议词、需先拍板（{pending_text}）。',
    '',
    '## 要你拍板的事',
    '',
]
for i, (q, a) in enumerate(pending, 1):
    md.append(f'{i}. **{q}** — {a}')
md += [
    '',
    '## 落地建议（等你说做再动代码）',
    '',
    '1. 第一步：IMDb / TMDB / Bangumi 的类型统一进「标签」列，分隔符与豆瓣、红果对齐；',
    '2. 第二步：一张「站点 + 原始词 → 标准标签」映射表，站点门禁放最前，避免跨站同名误伤；',
    '3. A 级默认生效、B 级默认生效但可关、C 级先冻结、D 级原样输出；',
    '4. 保留站点原值（可逆），长尾词查不到就原样留，绝不静默丢词。',
    '',
    '## 资料来源',
    '',
]
for k, desc, url in SOURCES:
    md.append(f'- {k} · {desc} · {url}')
md += ['', '口径：IMDb 28 / TMDB 19+16 / 豆瓣 28 为官方全集；IMDb 子类型、Bangumi 标签、红果题材为代表性样本 + 本地实测存档，非穷举。', '']

with open(OUT_MD, 'w', encoding='utf-8') as f:
    f.write('\n'.join(md))

print('HTML:', OUT_HTML)
print('CSV :', OUT_CSV)
print('MD  :', OUT_MD)
print('原始词条目合计:', stat_total_words, '| 异形映射行:', len(ROWS), '| 等级:', dict(grade_count))
print('分站行数:', dict(site_count))
print('字面一致词数:', n_exact, exact_all)
print('44 库可并入标签:', n_ok, '| 孤岛标签:', n_island,
      [t for t in STANDARDS if not hits.get(t)])
print('仅 C 级待定标签:', [t for t in STANDARDS if hits.get(t) and not any(x['grade'] in ('A','B') for x in hits[t])])
