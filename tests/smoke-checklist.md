# 人工冒烟清单（真机点按钮）

> 离线快照（`snapshot.js`）管「DOM 到字段」这一段的回归；**这份清单管它管不到的**：
> 按钮有没有出现、点了有没有反应、要联网/要登录才拿到的字段对不对。

**什么时候跑**：每批出成品、装上新版扩展之后。整表大约 20 分钟。

---

## 〇、装扩展（顺序不能错）

1. 打开 `chrome://extensions`
2. 找到「采媒灵」→ **先点「删除」**（不删会出现两个相叠的按钮，是两份同名扩展在打架）
3. 右上角打开「开发者模式」→「加载已解压的扩展程序」→ 选 `发行包/ClipMate_采媒灵_v<版本>_chrome`
4. 刷新目标页面（扩展只对新加载的页面注入）

## 一、每个站的四步

| 步 | 做什么 | 通过标准 |
|---|---|---|
| 1 | 打开详情页 | 页面正常渲染完（不是验证页/登录墙） |
| 2 | 看右上角 | 出现「提取」按钮，且**不是灰色不可点**（前 1~2 秒灰是正常的，它在等初始化） |
| 3 | 点按钮 | 浮窗出现，表格有数据 |
| 4 | 看下表的「必须有值」列 | 这几格不能空、不能串到别格 |

> **判「按钮没出现」先分清三种情况**：① 站点不支持（本就不该有按钮）；② URL 是子页/列表页（`exclude_matches` 挡掉了，属正常）；③ 真事故。第 ③ 种才登记，并且直接跑 `node tests/check-registry.js` 看清单有没有漏。

## 二、按类型的「必须有值」

| 类型 | 必须有值（空=不合格） | 允许空 |
|---|---|---|
| 书籍 | 书名、作者、简介、URL | ISBN（网文站常无）、发布日期（网文站要抓目录页）、国家、网络评分、别名 |
| 影视 | 名字、上映日期、简介 | 导演/编剧（视站）、片长或集数（二者其一）、单集片长、别名 |
| 游戏 | 游戏名、平台、简介、发行日期 | 开发商/发行商（写进「其他信息」）、网络评分（未发售）、官方网站 |
| 社交 | 本页标题、作者昵称、发布日期、本页文案、URL | 作者ID、作者主页（部分站拿不到） |

> **「其他信息」里半角逗号会变成全角**、**简介超过 500 字会被截断加 `...`**、**标题里的半角逗号变全角** —— 这三条是全站既有行为，看到别当 bug。

---

## 三、站点逐条打勾

### 影视（4 站 / 6 个样本）

- [ ] 豆瓣电影 `https://movie.douban.com/subject/1292052/` —— 名字、上映日期、导演、主演、评分
- [ ] TMDB 电影 `https://www.themoviedb.org/movie/278` —— 名字、上映日期、片长
- [ ] TMDB 剧集 `https://www.themoviedb.org/tv/1396` —— 影视类型应为「剧集」、集数有值
- [ ] IMDb 电影 `https://www.imdb.com/title/tt0111161/` —— 上映日期、导演
- [ ] IMDb 剧集主页 `https://www.imdb.com/title/tt0185906/` —— 集数 10、单集片长、**导演可能为空**（剧集页取第一集，最多慢 2 秒）
- [ ] Bangumi `https://bgm.tv/subject/265` —— 类型自动识别（影视/书籍/游戏），别串类

### 书籍（5 站 / 5 个样本）

- [ ] 豆瓣读书 `https://book.douban.com/subject/1084336/` —— 书名、作者、ISBN、评分、发布日期
- [ ] 起点 `https://www.qidian.com/book/1034144/` —— 书名、作者、简介
- [ ] 番茄小说 `https://fanqienovel.com/page/7143038691944901670` —— 书名、作者
- [ ] 17K `https://www.17k.com/book/3374019.html` —— 书名、作者、简介、**发布日期（要联网抓目录页，离线快照为空，这里必须有值）**
- [ ] Goodreads `https://www.goodreads.com/book/show/5907.The_Hobbit` —— 作者（要排除 Editor/Illustrator）、发布日期取 First published、**URL 必须是当前页**（不能是别的版本）

### 游戏（5 站 / 5 个样本）

- [ ] 豆瓣游戏 `https://www.douban.com/game/26417112/` —— 游戏名、平台、发行日期
- [ ] Steam `https://store.steampowered.com/app/570/Dota_2/` —— 游戏名、平台、发行日期；**18+ 游戏会跳 `/agecheck/`，没有按钮属正常**
- [ ] Metacritic `https://www.metacritic.com/game/elden-ring/` —— 网络评分（Metascore÷10）、开发商/发行商分开；**未发售游戏评分应为空，不能写 tbd**
- [ ] 小黑盒 `https://www.xiaoheihe.cn/app/topic/game/pc/<appid>` —— 游戏名、平台固定 PC、标签不乱入
- [ ] MobyGames `https://www.mobygames.com/game/<id>/<slug>/` —— **需代理 + 非无头**；假 ID 页 h1 为空应判「非详情页」不出按钮

### 社交（9 站 / 10 个样本）

- [ ] 抖音 `https://www.douyin.com/video/...`
- [ ] 抖音短链 `https://v.douyin.com/...`（应自动跳到详情页并出按钮）
- [ ] 快手 `https://www.kuaishou.com/short-video/...`
- [ ] 小红书 `https://www.xiaohongshu.com/explore/...`（**连非无头都可能提示「IP存在风险」，只能用真浏览器**）
- [ ] Instagram `https://www.instagram.com/p/...`（含主页点开 Post 的 Modal 跟随）
- [ ] 微博 `https://weibo.com/<uid>/<mid>`
- [ ] 微博移动版 `https://m.weibo.cn/detail/<id>`（**这条靠兜底识别类型，是已知脆弱点**）
- [ ] X `https://x.com/<user>/status/<id>`
- [ ] YouTube `https://www.youtube.com/watch?v=...`（**按钮出现 ≠ 能提取，页面水合中，多等 2~3 秒再点**）
- [ ] TikTok `https://www.tiktok.com/@user/video/...`
- [ ] B站视频 `https://www.bilibili.com/video/BV...`
- [ ] B站番剧 `https://www.bilibili.com/bangumi/play/ep...`

---

## 四、已知特殊情况（看到别当新 bug）

| 现象 | 说明 |
|---|---|
| IMDb 剧集页提取慢约 2 秒 | 要去抓第一集导演，已知行为 |
| MobyGames 打不开 / 出验证页 | Cloudflare。需 `--proxy-server=127.0.0.1:7897` + 非无头 |
| 小黑盒站内跳转后按钮不出现 | SPA 未刷新，已知遗留（批次 4 处理） |
| Steam 18+ 页无按钮 | URL 跳到 `/agecheck/`，不匹配 |
| Goodreads `/book/show/xxx/editions` 也有按钮 | 已知问题，点了会提取出列表页杂数据（`tests/known-issues.json` 已登记） |
| 提取成功后按钮灰 3 秒 | 防连点，属正常 |
| 第一次点没反应、刷新后正常 | 页面初始化未完成，属正常（等按钮不灰再点） |

---

## 五、记录

| 日期 | 版本 | 站点 | URL | 现象 | 判定（事故/已知/正常） |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
