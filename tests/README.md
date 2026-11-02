# tests/ —— 采媒灵的「安全网」

这个目录服务于一条铁律：

> **不可以影响扩展的提取功能。即打开网页、点击提取按钮、提取信息的功能和策略，不可以被影响。**

以前要证明「没影响」，只能人肉打开网页点一遍。现在有四层机器护栏，改完代码跑一条命令就知道有没有踩到线。

> ⛔ **2026-10-29 23:40 用户硬性拍板：无头真机测试全部取消，改用 BrowserSkill 接管用户正在用的 Edge 做真机测试。**
> 原因：扩展 + `--headless=new` + 一次性临时 profile + 同一 IP = 风控评分最高的组合（快手实测 `result:2 操作太快了`、小红书 `300012 IP存在风险`）；无头 UA 还要伪装、临时 profile 没有设备信誉 = 新设备，等于「换人」。
> **受影响的脚本（自启动无头浏览器 + 临时 profile）：** `verify-live.js`、`button-gesture-live.js`、`buttons-live.js`、`cross-site-live.js`、`book-fill-live.js`、`capture.js`、`douyin-modal-live.js`、`douyin-immersive-live.js`、`douyin-detail-dump.js`、`douyin-fiber-sw-check.js`、`xiaohongshu-live.js`、`kuaishou-live.js` —— **一律停用，不再运行**（文件保留留档，改造成 BrowserSkill 版需先提案）。这些脚本里与「无头 / UA / 端口 / profile」相关的章节都是历史留档。
> **真机统一入口**：BrowserSkill 接管用户已登录 Edge（真实指纹 + 登录态 + 已建立信誉），见下面「BrowserSkill 的定位」。单测 / `snapshot.js` / `preflight.js` / `check-registry.js` 不受影响，照常跑。

**这个目录不参与扩展运行**：`tests/` 在 `ClipMate_chrome/` 外面，不会被加载、不会被打包、不会进成品文件夹（preflight 会盯着这一点）。

---

## 一、常用命令

在项目根目录执行（`C:/Users/19127/WorkBuddy/采媒灵火狐插件`）：

⚠️ 下表所有 `*-live.js` / `capture.js`（自启动无头浏览器）**均已停用，仅留档**；真机请用 BrowserSkill 接管已登录 Edge（见「BrowserSkill 的定位」）。离线单测 / `snapshot.js` / `preflight.js` / `check-registry.js` 照常跑。

| 命令 | 什么时候用 | 干什么 |
|---|---|---|
| `node tests/preflight.js` | **每批收尾、出成品之前** | 语法 + manifest + 清单对账 + 快照回归 + 与成品比对，一条命令出结论 |
| `node tests/snapshot.js` | 想知道「我刚改的东西有没有动到提取结果」 | 用 19 份真实页面存档跑真提取代码，和基线逐字段比对 |
| `node tests/check-registry.js` | 加完新站点，或怀疑某个站「按钮不出现」 | 把 6 处站点清单互相对账 |
| `node tests/settings-page.test.js` | **动设置页、`settings-schema.js`、`feature-flags.js`、字段页/数据页之后** | 122 项：默认值/脏值回退/越界收敛、嵌套补丁不吞兄弟键（含**三层** `settings.descLimits.social`）、新位置优先 + 旧键回退 + 缺省开、页面渲染（通用 10 项 / 23 站 / 抖音卡 2 个专属开关 / 5 类字段）、写盘形状（站点快照只改一项、功能开关**双写**、字段顺序只换自己那类、简介长度只换一档）、撤销、搜索与深链、导入校验与摘要、清缓存只发 `clearCacheOnly`、三档重置各清各的、主题切换即时换色 |
| `node tests/popup-slim.test.js` | **动 popup 之后** | 41 项：全局 7 项与「恢复默认」**真的不在** popup 里了（防止又长回来）、本站 5 项一项不少、本站快照不含格式键、点「完整设置 →」带 `#sites?focus=<域名>`、**浏览器内部页不把 `extensions` 当网站**、主题仍读 `config.theme` 且 `default` 按跟随系统 |
| `node tests/desc-limits.test.js` | **动简介截断、`descLimits`、提取器的 `processCommonFields` 之后** | 22 项：无配置时输出与搬家前**逐字节一致**（50000/5000/500）、改哪档就只影响哪档、**0 = 不限制**（不许截成 `…`）、脏值回退、负数当不限制、同函数里的评分逻辑没被带坏 |
| `node tests/data-page-background.test.js` | **动 `background.js` 的缓存清理 / 重置 / `initStorage` 之后** | 26 项，真的 `require` 后台代码跑内存假存储：缓存键按**前缀**扫（分片 `media_extractor_pcache:` + 旧单键 + `cache`）、**清缓存不许碰 config**、广播给所有标签清内存、重置功能开关连旧独立键一起删、脏参数不炸、初始化不再写死键 `extractedData` |
| `node tests/live-bsk/v280-content-verify.js` | **动过 manifest 的 content_scripts 清单（加/删脚本）、或换装之后**（真机档） | 打开一个豆瓣电影页，确认悬浮按钮照常出现、按钮有尺寸没被隐藏、**控制台没有本扩展的未捕获错误**（新脚本一旦报错，全站会集体不挂按钮）；站点自己的报错单独计数、不算失败。一次导航，不点按钮、不碰接口 |
| `node tests/live-bsk/settings-page-verify.js` | ⛔ **在扩展页上跑不了（2026-11-02 实测）** —— 仅留档 | Chrome 禁止跨扩展访问 `chrome-extension://` 页面，BrowserSkill 是另一个扩展，`evaluate / snapshot / click / press / screenshot / console` 一律回 `Cannot access a chrome-extension:// URL of different extension` 或 `restricted_tab_url`。脚本能在 Agent 窗口自动开/关设置页标签（标签标题能读到 `设置 · 采媒灵`，证明页面存在且能解析），但**读不了 DOM、点不了、截不了图**。设置页的功能只能人工过一遍：见下面「v2.8.0 设置页人工核查清单」 |
| `node tests/verify-live.js` | **动过 manifest / background / 按钮 / 浮窗之后** | 真浏览器里加载扩展，走一遍「按钮可点 → 真实鼠标点击 → 出表格」 |
| `node tests/button-manager.test.js` | **动过 button-manager.js / 按钮样式之后** | 离线 38 项：4px 抖动阈值、拖动后无盲区、拖动不读布局、提取中重复点击 |
| `node tests/button-gesture-live.js` | **动过按钮拖动/点击手感之后** | 真机 10 项：拖动只写 transform、松手落位、拖完不误触、抖动 2px 仍能开浮窗 |
| `node tests/tiktok-page-data.test.js` | **动过 TikTok 一手数据链路之后** | 离线 82 项：ID 闸口（切条后不误用旧数据）、两路优先级、补位等待、换条跟随 |
| `node tests/capture.js` | 要给某个站补样本，而 curl 抓不到（反爬/403/Cloudflare） | 用真浏览器打开页面并把 HTML 存进 `tests/fixtures/html/` |
| `node tests/douyin-guard-drill.js` | **动抖音弹窗相关代码之后** | 把新模块人为打死，断言详情页仍与基线逐字相同 |
| `node tests/douyin-inject-scope.test.js` | **动抖音的 matches / 媒体类型识别之后** | 断言注入范围恰好 9 条；**没点开视频时一个按钮都不出**，弹层开了才接管 |
| `node tests/douyin-modal-extract.test.js` | **动抖音弹窗取数之后**（fiber 读取器 / 日期推算 / 弹窗上下文 / 弹窗提取器） | 119 项：日期每个分支、fiber 优先、防串台、DOM 兜底、URL 规范地址、熔断、详情页红线 |
| `node tests/douyin-modal-handler.test.js` | **动抖音弹窗按钮/跟随/开关之后**（douyin-spa-handler / content-main 的接管分支） | 141 项：贴弹窗定位、关弹窗连浮窗一起关、切条就地刷新、开关关掉、熔断、域名门禁、详情页红线 |
| `node tests/douyin-fiber-sw-check.js` | **动 background 的注入链路、或动内容脚本清单之后** | 真机：加载扩展 → 连 SW → 断言 importScripts / world:MAIN 注入 / **69 个脚本真的注入了抖音页、按钮该出就出** |
| `node tests/douyin-modal-live.js` | **出成品之前**（批 4 起） | 真机四类页面各走一遍「开→点→切→关」，全用真实鼠标键盘；第一次要 `--login` 扫码 |
| `node tests/social-date-precision.test.js` | **动日期格式、标题拼接、`formatSocialDate` / `formatPublishTime` / `formatTimestamp` / `mergePrecision` 之后** | 85 项：源到哪一档就显示到哪一档（不补零）、标题尾跟着变、fiber 时间戳带秒、详情页与弹窗页日期统一、浮窗类型判断先看数据、图文页不许捞别人的日期 |
| `node tests/douyin-detail-dump.js` | **改动前后要逐字对比字段时**（不是断言工具） | 真机把 6 个页面的 7 个字段**原样 dump 成 JSON**，两次结果直接 diff；`CLIPMATE_EXT` 指定加载哪个目录 |
| `node tests/xiaohongshu-route.test.js` | **动小红书跟随、`_syncXhsRouteVisibility`、`_xhsShouldSuppressModal`、manifest 的小红书 matches 之后** | 143 项：路由判定（含「用户主页里也是 24 位 hex」陷阱）、进出笔记按钮显隐、不越权（不抢 `showButton=false`）、浮窗随按钮一起关、提取途中离开不弹窗、**站点门禁（豆瓣/B站/抖音/TikTok 一律放行）**、启动门禁、接线 |
| `node tests/social-hashtag-cleaner.test.js` | **动文案清洗、标题生成、或话题显示之后** | 62 项：小红书 `#名称[话题]#` 与抖音裸 `#话题` 两种形态、紧邻话题不粘连、`@提及` 与行尾 `#` 不误伤、幂等、非字符串安全、只清「本页文案/本页标题」两个字段、**标题必须先洗文案再截前 20 字**（否则 `#vlog[话题]#` 会留下「话题」二字）、接线与加载顺序 |
| `node tests/xiaohongshu-fields.test.js` | **动小红书文案拼接 / 桥读取 / 发布时间之后** | 106 项：标题+正文拼接去重、桥脚本形态、`readBridgeNote` 串台闸口、秒/毫秒兼容与合理性校验、昵称与主页优先级 |
| `node tests/kuaishou-profile-popup.test.js` | **动快手播放弹层白名单 / 作品 ID 提取 / 日期兜底之后** | 62 项：`/profile/*` 放行与前缀边界、主页弹层 5 字段、**ID 强证据优先**（封面的 base64 时间戳碎片不许冒充作品 ID）、视频地址兜 ID（`_b` 后缀要剥）、封面没日期时用视频的 `/upic/`、作用域隔离、watch 进出弹层、接线与开关 |
| `node tests/instagram-feed-post.test.js` | **动 IG 首页逐帖按钮（`instagram-feed-buttons.js`）、`ig-spa-handler` 的页面变化/刷新、`isFeedPage`、`instagram-inline-data` 的编号规整、或 `extractAllFields` 的 `feedPost` 分支之后** | 104 项：只认首页（探索页/作品页/主页/`/reels/` 一律不挂）、编号必须整条作品地址（`/liked_by/`、`/c/<id>/`、`/reels/audio/` 全挡）、挂载幂等、React 摘掉要补挂、离开首页连改过的 `position` 一起还原、弹层里的帖子不挂、点击不冒泡也不打开帖子、连点只跑一次、**接口说「没文案」时不许回头读 DOM**（v2.7.8 串台事故）、没有接口数据时走 DOM 兜底并剥「… 更多」、首页浮窗不许被页面变化关掉、manifest 顺序与接线、**首页「页面自己在变」不许重新提取/不许刷新浮窗（v2.7.36 事故）**、整页作用域的刷新一律被拒、非首页（详情页）照旧刷新、43 位编号的推广帖也能挂按钮并查到接口数据、**标题里的昵称必须是昵称而不是用户名**（v2.7.37，与详情页共用同一个期望常量）|
| `node tests/live-bsk/ig-feed-verify-v2736.js` | **动 IG 首页浮窗/逐帖按钮之后（真机那一档）** | 13 项：每条可提取的帖子都得有按钮（含 43 位编号的推广帖）、**抓第一眼**（~120ms）比对这条帖子的作者与正文、只滚动等 5 秒后浮窗一个字都不许变、再点另一条必须换成那一条。用法：`node tests/live-bsk/ig-feed-verify-v2736.js --session=<id> --tab=<tab-id>` |
| `node tests/live-bsk/ig-feed-verify-fields.js` | **动 IG 首页字段（昵称/文案/日期/网址/标题）之后（真机那一档，逐条全字段）** | 逐条点开浮窗，把 7 列跟「页面事实 + 接口/数据块」逐项对账：作者ID、**作者昵称 = full_name**、文案前缀、**发布日期按本地时区**（`<time datetime>` 是 UTC，用 UTC 前 10 位会凭空差一天）、URL 取 `<a href>`（社交类渲染成「点击访问」）、**标题里用的是昵称不是账号名**；每条约 1.5 秒后再读一次确认没被替换。用法：`--session=<id> --tab=<id> [--max=6]` |
| `node tests/mutate-v2737.js` | **动 IG 标题口径（`extractTitle` / `_buildFeedPostRecord` 的作者名来源）之后** | 3 条变异必须全红：详情页标题用回用户名、首页逐帖标题用回用户名、首页昵称退化成用户名 |
| `node tests/live-bsk/ig-feed-facts-check.js` | 怀疑「文案/作者/昵称张冠李戴」时（只读，不点按钮） | 把当前屏每条帖子的**页面事实**与**接口数据**并排：编号、第一个单段链接（作者）、正文前缀、接口全文是否以页面正文开头、接口里的 `full_name`。一眼看出是数据串台还是显示串台。 |
| `node tests/live-bsk/ig-feed-verify-v2735.js` | **动 IG 首页逐帖按钮之后（真机那一档）** | 12 项：把真源码送进用户已登录 Edge 的 IG 首页 → 每条帖子都挂上按钮、量出与 IG「⋯」不重叠、**真实鼠标点一次**确认回调拿到的是这一条且没打开帖子、截图留档、收尾不留残渣。用法：`node tests/live-bsk/ig-feed-verify-v2735.js --session=<id> --tab=<tab-id>` |
| `node tests/live-bsk/ig-feed-survey.js` | 需要重新勘察 IG 首页结构时（只读） | 零导航 dump：`main article` 数量、每条帖子的链接/`<time>`/正文容器、桥节点 `#clipmate-instagram-net` 里有没有这批帖子。**改首页逻辑前先跑它，别猜 DOM。** |
| `node tests/kuaishou-no-autoplay.test.js` | **动快手「关闭自动连播」或那个开关之后** | 40 项：真跑一遍 jsdom 验「页面自己的 `ended` 回调被挡住 / 开关关掉后放行」、幂等、`loop` 兜底、开关桥（storage → `<html data-clipmate-ks-noautoplay>`，含变更监听与站点门禁）、manifest 必须是 `MAIN` + `document_start` |
| `node tests/kuaishou-author-id-speed.test.js` | **动作者ID抓取（`author-id-fetcher.js`）或快手的 iframe 渲染之后** | 49 项：`fetchTimeout` 到点必须 abort（不传时绝不加 signal，抖音/小红书不受影响）、**两路并行**（起跑间隔 <40ms、总耗时是 max 不是 sum）、race 语义（占位符抢先被拒、两路皆空才返回空、一路抛错不拖垮另一路）、串行默认行为与老版逐项一致、iframe 渲染器（100ms 轮询、MutationObserver 真的挂上并断开、占位符跳过、5 秒超时后删掉 iframe）、接线与结构 |
| `node tests/kuaishou-live.js` | ⛔ **已停用（2026-10-29）** | 自启动无头真机，会触发风控，改用 BrowserSkill 接管 Edge。内容留档：详情页验「主世界脚本注进去了、开关属性写上了、真实派的 `ended` 被拦住」；作者主页验「点开作品出弹层 → 按钮跟着出现」 |
| `node tests/xiaohongshu-live.js` | ⛔ **已停用（2026-10-29）** | 自启动无头真机 33 项，会触发风控（`300012 IP存在风险`），改用 BrowserSkill 接管 Edge。内容留档：探索页按钮藏着 + 桥 urlId 为空 → 点卡片进弹层（**地址变了但没整页重载**）按钮变可见、桥数据对得上 → 点按钮出浮窗、文案无脏词 → 后退回列表按钮与浮窗一起消失；会主动换卡片挑「文案里真带话题」的样本，`CLIPMATE_EXT=<目录>` 可指定成品 |

补充参数：

```bash
node tests/preflight.js --fast        # 只改了文档/注释时，跳过快照
node tests/snapshot.js --verbose      # 打印每个样本提取到的全部字段
node tests/snapshot.js --only=17k     # 只跑 id 含 17k 的样本
node tests/snapshot.js --update       # 确认新结果是「对的」之后，把当前结果写成新基线

node tests/verify-live.js --shot      # 顺便存截图到 .workbuddy/tmp/verify-*.png
node tests/verify-live.js --only=steam
CLIPMATE_EXT=<目录> node tests/verify-live.js   # 验别的成品目录（新旧对照实验）

node tests/capture.js --list          # 只列抓取清单，不启动浏览器
node tests/capture.js --only=tmdb     # 只抓 id 含 tmdb 的目标
node tests/capture.js --headful       # 有头窗口（Cloudflare 拦无头时用）

node tests/douyin-modal-extract.test.js --verbose   # 逐条打印断言
node tests/douyin-fiber-sw-check.js --modal=<作品ID>  # 指定要读的作品
node tests/douyin-fiber-sw-check.js --no-page         # 只查 SW，不开抖音页面

node tests/douyin-modal-live.js --login   # 开专用窗口扫码（登录态存 .workbuddy/tmp/douyin-live-profile）
node tests/douyin-modal-live.js --only=jingxuan   # 只跑某个入口
node tests/douyin-modal-live.js --headful --shot  # 有头 + 截图
CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.78_chrome node tests/douyin-modal-live.js   # 验成品包

# 改动前后逐字对比（dump 不改任何东西，只把字段原样吐出来）
CLIPMATE_EXT=backups/<改前目录> node tests/douyin-detail-dump.js --out=.workbuddy/tmp/before.json
node tests/douyin-detail-dump.js --out=.workbuddy/tmp/after.json
node tests/douyin-detail-dump.js --urls="<url1>,<url2>"   # 只跑指定页面
node tests/douyin-detail-dump.js --headful                # 开窗口看一眼

# 沉浸流（推荐/关注/朋友）——单测 95 项，不联网
node tests/douyin-immersive.test.js
# 沉浸流真机：默认只跑推荐页（不需要登录）；--all 连关注/朋友一起（要登录态）
node tests/douyin-immersive-live.js --headful
CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.80_chrome node tests/douyin-immersive-live.js --headful
```

**`--update` 是唯一的危险按钮**：它把「现在的结果」当成「正确答案」。只有在**你亲眼确认过新值是对的**时候才用，否则护栏就被你自己拆了。

---

## 一·五、设置页人工核查清单（扩展页无法自动化）

设置页跑在 `chrome-extension://` 上，**BrowserSkill 进不去**（Chrome 硬性禁止跨扩展访问，报 `Cannot access a chrome-extension:// URL of different extension`）。所以设置页这一档只能人眼看一遍，每步都有明确预期：

**v2.8.0 骨架（通用 / 网站）**

1. **打开设置页**：`edge://extensions` → 采媒灵 → 「扩展选项」。预期：左侧五个页签（通用 / 网站 / 字段 / 数据 / 关于），左上角版本号 `v2.8.x`。
2. **拨一个通用开关**：拨一下「显示悬浮按钮」。预期：底部立刻弹出「已保存 · 撤销」，5 秒内点「撤销」能拨回去；不点撤销，去任意网页刷新一次，按钮按新设置显隐。
3. **展开一个站点**：进「网站」页签 → 展开「抖音」。预期：除 4 个常规开关外还有 **2 个抖音专属**；快手卡 **3 个**；X/微博/Instagram 各 1 个「信息流逐帖按钮」。
4. **搜索 + 深链**：按 `/`，输入 `douyin`。预期：光标跳进搜索框、列表只剩匹配站。

**v2.8.1 新增（字段 / 数据）**

5. **字段页**：进「字段」页签。预期：5 个折叠块（影视 / 书籍 / 游戏 / 社交媒体 / 人物档案），社交媒体是 7 行。点某行的 `↓` 图标，那一行会往下挪一格，头部出现「已调整」徽标；点「恢复默认」徽标消失。刷新页面，顺序还在。
6. **数据页 · 缓存**：进「数据」页签。预期：显示「N 条 · X KB」。点「清除缓存」→ 数字变「没有缓存」，**再去「网站」页签看，站的设置全都还在**（这条最要紧：老版「恢复默认」会连设置一起清）。
7. **数据页 · 导出/导入**：点「导出为文件」→ 应下载一个 `clipmate-settings-*.json`。再点「选择文件…」选回它 → 应弹出「将导入：…」的确认框，确认后底部提示「设置已导入」。
8. **数据页 · 三档重置**：三行各一个红字按钮，各点一次都只清自己那一块（网站设置 / 功能开关 / 字段顺序），互相不牵连。

**v2.8.2 新增（popup 精简 / 深链 / 简介长度）**

9. **popup 只剩本站**：随便打开一个抖音视频页，点扩展图标。预期：一张极简卡片，标题是「抖音」、下面一行域名，右上角一个齿轮图标。**没有**全局那一块（自动提取 / 延迟 / 复制 / 按钮 / 缓存 / 主题），**没有**「恢复默认」按钮。
10. **popup 深链**：接上一步，点右上角齿轮。预期：新标签打开设置页，**「网站」页签下抖音那张卡已经自动展开**（`#sites?focus=www.douyin.com` 生效），不用自己去列表里找。
11. **简介长度真的生效**：设置页「通用」→「内容」组有三个数字框（50000 / 5000 / 500，单位「字」）。把「其他简介」改成 `0` → 去任意豆瓣电影条目页刷新提取一次 → 简介应**完整显示、结尾没有 `…`**（默认 500 字时是被截断的）。改完记得改回 500。
12. **默认值没变**：上面第 11 步改回 500 之后，再提取一次豆瓣电影 / 微博 / 抖音，内容应与 v2.8.1 一模一样 —— 简介长度只换了「读数的地方」，默认值一个数都没动。

**v2.8.3 新增（豆瓣书籍简介取完整正文）**

13. **书籍简介是完整正文，不是折叠摘要**：打开任意豆瓣读书条目页（如 `book.douban.com/subject/1084336/`，《小王子》）→ 点提取。预期：「简介」是**完整正文**（多段，能读到 B612 那句），**不出现「(展开全部)」**、**不出现 CSS 源码**（`text-indent`）。**这一步不用改任何设置**，默认就应该是完整正文。
14. **改 0 拿全文**：把「其他简介」改成 `0` → 同一本书刷新页面再提取 → 简介是整段全文、**结尾没有 `…`**。再把上限改回 `500` 提取一次，简介应是 500 字 + `...`（上限在起作用，属正常）。

> 第 13~14 步修的是 v2.8.2 之前就存在的两个老问题：① 书籍简介一直取 `.short` 折叠摘要；② 页面 `og:description`（豆瓣服务端截断的 103 字摘要）按「后写赢」把简介整段盖掉。所以 v2.8.2 的第 11 步「改 0 就该完整」在**书籍页**上看不出变化 —— 和上限设置无关。

**v2.8.4 新增（popup 极简改版）**

15. **没有「跟随全局 / 单独设置」了**：打开任意已支持站点（如抖音视频页）→ 点扩展图标。预期：从左到右是「开关行」，**不再有**顶部那个二选一分段控件，**不再有**「当前生效 / 来源：全局」那块虚线框，**不再有**每项下面的灰色说明文字，底部默认**一片空白**。
16. **改了就直接生效，不再让你先做选择**：不点任何按钮，直接把「显示提取按钮」关掉。预期：底部立刻出现「本站已单独设置 · 恢复默认」，页面上的悬浮按钮消失。点「恢复默认」→ 按钮回来、底部那行消失、开关自己拨回开。
17. **子项跟着父开关收放**：把「自动提取」关掉 → 下面「等待加载」那行**消失**；打开 → 出现。同理「自动复制」关掉时「复制格式」消失。把复制格式选成 `Notion`，再把「自动复制」关掉又打开 → 仍显示 `Notion`（选择没丢）。
18. **作用范围那一行已经砍掉**：popup 里**没有**「同时对 xxx 生效」的勾选框。要整站一起改，去设置页「网站」。
19. **继承会说清楚**：先到设置页给 `douban.com` 设一个「显示提取按钮=关」→ 回到 `book.douban.com` 的任意条目页点扩展图标。预期：开关显示为关（继承值），底部写「沿用 douban.com 的设置」；此时随手拨任意一个开关，写的是 `book.douban.com` 自己那条，`douban.com` 那条**不受影响**。

任意一步不对，把现象告我，我修。这几处是 jsdom 测不到的：真实 CSS 布局、真实 `chrome.storage` 落盘、真实 `chrome.runtime.sendMessage` 通不通、真实文件下载、真实剪贴板。

---

## 二、每个脚本分别在测什么

### 1. `snapshot.js` —— 提取结果快照回归

做法不是「抄一份提取逻辑来对比」，而是**把扩展的真代码在 jsdom 里跑起来**：

```
真实页面存档 → jsdom → 按 manifest 顺序注入全部内容脚本
   → content-main 自己完成初始化 → 走"点按钮"那条真实链路
   → 提取器 → 通用字段映射 → 数据处理 → 得到最终表格数据
```

所以它测到的包括这些**真实后处理行为**：

- 简介截断 500 字 + `...`
- 「其他信息」里的半角逗号 → 全角
- 人名按 `[,，、/]` 切分
- 评分的官方结构取值
- 各站自己的清洗/补映射规则

基线存在 `tests/golden/<样本id>.json`。**字段值有任何变化 → 退出码 1，并列出旧值 → 新值**。

### 2. `check-registry.js` —— 站点清单对账

采媒灵加一个站要动 6~8 处清单，漏一处就是「打开页面提示未找到」（v2.5.48 的 bgm.tv 书籍漏注册就是这么来的）。这个脚本把五方对完：

| 比的是什么 | 抓什么事故 |
|---|---|
| manifest `js` 列的文件 vs 磁盘 | 文件名写错、文件被删 |
| `src/content/extractors/*.js` vs manifest | **提取器写好了但忘了加载（等于没写）** |
| `EXTRACTOR_CONFIG` vs `matches` | 注册了却不会注入 |
| `EXTRACTOR_CONFIG` vs `host_permissions` | 授权了却不注入（白授权） |
| `EXTRACTOR_CONFIG` vs `site-config CATALOG` | 设置页里看不到这个站 |
| `background.getMediaConfigs()` vs 注册表 | 类型识别退化到「按正文关键词猜」 |
| 31 个详情页样本 vs 路由 | 详情页点不出按钮、命中错提取器 |
| 11 个负样本（子页/列表页）| 子页也冒出按钮，点了提取出杂数据 |

负样本里如果出现的问题**已经登记在 `tests/known-issues.json`**，只报警告不报错（避免一上来就红，把真回归淹掉）。**修好后记得把条目删掉**，让护栏重新生效。

### 3. `preflight.js` —— 发布前自检

五步串起来，最后给一句「可以出成品 / N 项不通过」。其中第 5 步会拿源码和最新成品文件夹逐文件比对哈希：

- 文件完全一致 → 说明这批还没出成品
- 版本号没变但文件变了 → 提醒你**按规矩该更版本 + 出新成品文件夹了**
- 会顺带检查 `ClipMate_chrome/` 里没有混进 `tests/` 或 `node_modules/`

### 4. `capture.js` —— 浏览器抓存档

curl 抓不到豆瓣电影（反爬页）、TMDB（403）、Metacritic / 小黑盒 / MobyGames（Cloudflare），所以这些站的样本只能用真浏览器拿。

它只做三件事：**打开页面 → 等到页面真就绪 → 把 `outerHTML` 存成文件**。不加载扩展、不点按钮，所以不会碰到任何提取逻辑。

```bash
node tests/capture.js --list                 # 先看清单
node tests/capture.js                        # 全抓
node tests/capture.js --only=douban-movie    # 只抓一个
node tests/capture.js --only=xxx --headful   # 被 Cloudflare 拦时换有头窗口
```

三道防「抓到假页面」的闸门，任一不过就**不落盘**：

| 闸门 | 挡的是什么 |
|---|---|
| `minLen` | 抓到的是几百字节的「拒绝访问」/ 挑战页 |
| `mustInclude` | 页面结构变了（比如 JSON-LD 没了），抓下来也是废样本 |
| `expectPath` | 详情页 404 被 302 回首页 —— 字节数很大、看着成功，其实内容全错 |

抓成功会直接打印可粘进 `registry.json` 的 JSON 条目。

### 5. `verify-live.js` —— 真机走一遍

jsdom 证明不了三件事，只能靠它：

1. **manifest 改了能不能加载**（比如加了新脚本文件）
2. **页面上按钮还在不在**（改了站点清单 / 类型表之后）
3. **真实鼠标点击能不能走通**（jsdom 里没有真实事件链，`disabled` 也只挡真人点击）

它做的是：启动 Chrome → 加载扩展 → 打开页面 → 等按钮变成「可点」→ 检查按钮没被遮挡 → 派发真实鼠标事件 → 等浮窗表格出来 → 数非空字段。

**Chrome 156 的坑（必读）**：`--load-extension` 命令行开关已被彻底移除（137 起逐步废弃）。继续用它扩展不会加载，现象是「三个站全都没按钮」，很容易被误判成代码坏了。现在唯一可行方式是 CDP 的 `Extensions.loadUnpacked`，启动时必须带 `--enable-unsafe-extension-debugging`。脚本已经改成这条路，别再改回去。

为什么必须先确认「按钮没被遮挡」：按钮如果在页面某个遮罩下面，`Input.dispatchMouseEvent` 打的是遮罩，会得到「点了没反应」的假象。

**headless 的 UA 坑（v2.5.69 补）**：`--headless=new` 的默认 User-Agent 里带 `HeadlessChrome`，Goodreads 这类站点看到就只回一个 3KB 的白页（标题为空、正文为空），表现是「表格出来了但 17 行只有 URL 一格有值」，极像提取器坏了。脚本现在启动后就通过 `Network.setUserAgentOverride` 换成与真实版本一致的正规 UA，已写死在 `launch()` 里，别删。

**外网站点要代理**：Goodreads / IMDb / TMDB 走本机代理，用 `CLIPMATE_PROXY=127.0.0.1:7897`。这类站点默认不在常规 3 站里（标了 `extra`），要单独跑：

```bash
CLIPMATE_PROXY=127.0.0.1:7897 node tests/verify-live.js --only=goodreads
```

`--dump` 会打印页面标题 / 正文长度 / 正文前 300 字，排查「页面到底有没有加载出来」时先用它，别靠猜。

### 6. `country-names.test.js` —— 国家名称转换器（纯函数）

`node tests/country-names.test.js`（需要 `jsdom` 的话加 `NODE_PATH`，纯函数版本不需要）

86 条断言：203 行表结构自检、禁止中文单字别名、历史国家不许并进现代国家、多值分隔符、13 个快照样本的现值回归。

**为什么必须单独有它**：TMDB 的国家跟着页面语言走，英文页给 `United States of America`；快照抓的是中文页，这个洞**快照永远测不出来**，只能靠纯函数单测钉住。

### 7. `goodreads-author.test.js` —— Goodreads 作者出生地（纯函数）

Goodreads 的「国家」是顺着作者链接去作者页读 `Born` 出生地，**jsdom 不联网，快照里这一格永远是空**，所以只能靠它：

```bash
NODE_PATH=.../node/workspace/node_modules node tests/goodreads-author.test.js
```

20 条断言，核心是 3 份**真实作者页存档**（Isaacson / Austen / Tolkien，2026-10-26 抓的原始 HTML）+ Georgia 歧义、只写到州、没有 Born 栏等边界。

### 8. `cross-site-linker.test.js` —— 跨站补网址的「挑哪一条」（纯函数）

```bash
node tests/cross-site-linker.test.js
```

59 条断言，七节：查询计划 / **已有值绝不覆盖** / 请求组装 / 豆瓣解析 / 番组计划解析 / TMDB 解析 / 统一入口。

存档在 `tests/fixtures/json/`（豆瓣搜索建议 4 份 + 番组计划 2 份）和 `tests/fixtures/html/`（TMDB 搜索结果 2 份）。

**TMDB 的存档必须是「在页面里 `fetch()` 拿到的原始 SSR HTML」**，不能用 `Page.navigate` 之后读 `outerHTML`——后者是 DOM 执行完的，链接带 `?language=zh-CN`、剧集段落被 JS 重排，用它测等于自欺欺人。

**核心断言是「宁可留空，不许写错」**：番组计划对没收录的作品不返回空，而是回一堆按单词乱命中的结果（搜「The Shawshank Redemption」→ 1000 条，首条是《黑客帝国动画版》）。所以有两条断言专门钉住「名字对不上就返回 null」。

### 9. `copy-no-notice.test.js` —— 提示文字不许进剪贴板

```bash
NODE_PATH=.../node/workspace/node_modules node tests/copy-no-notice.test.js
```

17 条断言。用 jsdom 搭一个跟真浮窗同构的 DOM（表格 + 标题栏下方的提示条），把 `modal-copy-export.js` 的三种复制真跑一遍，拦下真正写进剪贴板的字节，断言里面没有「搜索不到 / 已留空 / 已补上」。

**注意**：`new Function(...)` 必须把 `ClipboardItem` 和 `Blob` 一起当参数传进去。少传一个，`copyData()` 就走「降级 → 失败」分支，测出来的东西跟真机不是一回事。

### 10. `cross-site-live.js` —— 跨站补网址真机验证

```bash
CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js
CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js --only=tmdb --dump
CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js --site=tmdb   # 只跑 TMDB《教父》，反复压稳定性用
CLIPMATE_EXT=<成品目录> CLIPMATE_PROXY=... node tests/cross-site-live.js   # 直接验成品
```

**站别**：`imdb` / `douban` / `bgm` / `tmdb`（电影《教父》）/ `tmdb2`（《教父2》，同名系列最容易猜错）/ `tmdb-tv`（《兄弟连》剧集）。
`--only=` 是**模糊包含**（`tmdb` 会把 tmdb、tmdb2、tmdb-tv 全带上），`--site=` 是**精确匹配**。

**TMDB 三个用例用 `mustEqual` 而不是 `mustFill`**：光校验「是不是一条 IMDb 网址」挡不住「猜了条同名的相近条目」，
必须钉死具体编号（238 只能是 `tt0068646`，240 只能是 `tt0071562`，4613 只能是 `tt0185906`）。

**断言失败时会自动打印 `window.__CLIPMATE_IMDB_DEBUG__`**（扩展留在页面上的现场：搜了哪些词、候选有哪些、每条验证落到哪、命中谁）。
「候选里没有对的」和「请求被抖掉了」两种情况立刻能分开。

**IMDb 页经常被 WAF 按代理节点 IP 拒绝**（正文只有 18 字的 Access Denied 壳）→ 这是环境问题，**直接跳过这条用例**，
报告里写「IMDb 站未自动验证，请手动开页确认」，不要反复换节点、也不要为让测试变绿去改断言。

18 条断言（早期两场景版）：IMDb《教父》（三格都该补上、`IMDB` 格不许动、再点一次不许变）、豆瓣《肖申克》（`豆瓣链接` 不许动、`Bangumi` **必须留空**因为番组计划没收录它）。

**这个功能命令行验不了**：请求全在扩展 Service Worker 里发（内容脚本跨域被 CORS 拦），而且 TMDB 用 `curl` 拿是恒定 403 Cloudflare 挑战、真浏览器里却正常 200。

**IMDb 页开约 15 秒会自己重新导航一次**，跟本扩展无关（对照实验：打开浮窗后什么都不点，15 秒后浮窗同样消失）。脚本的对策是点完 150ms 快轮询，检测到浮窗消失就整轮重试。

**`--dump` 会打印提取瞬间的页面事实**（title / og:title / JSON-LD 条数 / body 文字长度）和全部 24 个字段。页面事实全空 = 页面没真加载出来（见下节第 1 条），别急着怀疑提取器。

### 11. `buttons-live.js` —— 浮窗按钮布局真机验证（v2.5.74）

```bash
node tests/buttons-live.js                 # 量尺寸 + 截 3 张图
node tests/buttons-live.js --no-shot       # 只量，不截图
CLIPMATE_EXT=<成品目录> node tests/buttons-live.js
```

29 条断言，全部走**豆瓣电影页**（国内可直连，**不需要代理**）。验的是「按钮摊开 + 自动折行」这件纯界面的事：

- 9 个按钮都在标题栏、`⋯` 已消失、没有残留菜单 DOM
- 没有一个按钮溢出浮窗右边界、标题保底 ≥120px、内容区还在（≥100px）
- 600px 默认宽 → 记录占几行；`host.style.width` 改到 780px → **必须收成 1 行**
- 编辑模式按钮集合 = 横向/重置顺序/取消/确认/—，不许出现复制类和补齐网址
- 点「复制纯文本」按钮 → 原地必须变「已复制 ✓」

**为什么必须真机**：jsdom 没有渲染引擎，`getBoundingClientRect()` 恒为 0，「放不放得下」根本量不出来。折行结果取决于真实字号和内边距。

截图落在项目根：`v2.5.74_按钮布局_600px.png` / `_780px.png` / `_编辑模式.png`。

**改按钮或动标题栏 CSS 之后必跑这个**。判「行数」用的是「每行第一个按钮的 top 值去重」，不是容器高度阈值 —— 高度受行高/padding 影响，20px 和 30px 的差别不好定死。

---

### 12. `book-fill-live.js` —— 豆瓣书籍「URL」补齐真机验证（v2.5.76）

```bash
CLIPMATE_PROXY=127.0.0.1:7897 node tests/book-fill-live.js
CLIPMATE_PROXY=127.0.0.1:7897 node tests/book-fill-live.js --only=santi
CLIPMATE_EXT=<成品目录> CLIPMATE_PROXY=... node tests/book-fill-live.js
```

51 条断言，跑 **8 本真实豆瓣书籍**（三体 / 小王子 / 灌篮高手全31卷 / 灌篮高手31 / 鬼灭之刃1 / 进击的巨人01 / 名侦探柯南1 / 海贼王港版），每本之间停 1.5 秒。

用 `expectUrl` **钉死具体网址**，不是只查格式 —— 这条链最怕的不是「没补上」，而是「补了个同名的别的书」。

验的四个用户规则：**Goodreads 优先**（三体/小王子/鬼灭/进击/柯南必须写 Goodreads）、**两个都命中要带「番组也有」**（三体专验这句）、**番组只认主条目**（灌篮高手必须是 `bgm.tv/subject/36752`，不是某一卷）、**两站都没有就留空**（海贼王港版）。另外每本都断言「豆瓣链接」原样未动。

#### ⚠️ 这个脚本必须带 `--user-agent` 启动参数（写在代码里了，别删）

headless Chrome 里 **Service Worker 的 UA 带 `HeadlessChrome/156`**，Goodreads 的 WAF 直接回 **403**（带随机长度 HTML 注释的拦截页），导致「Goodreads 优先」永远落空、只退到番组 —— 看上去像功能坏了。

实测：加 `Accept` / `credentials` 全都没用，**只有 UA 是变量**；换成普通 Chrome UA 后同一个 URL 立刻 `200 → /book/show/9574008`。而命令行 `curl` 一直是 301，所以这次是**反过来的**「命令行通、headless 真机不通」。

用启动参数而不是 CDP 覆盖 SW 目标：MV3 的 SW 会休眠重启，重启后覆盖就丢了。**这是测试环境的坑，产品代码不用改** —— 真人用有头 Chrome，UA 里没有 Headless。

---

### 13. `douyin-guard-drill.js` —— 抖音「兜底演练」（v2.5.77）

```bash
node tests/douyin-guard-drill.js
node tests/douyin-guard-drill.js --verbose
```

回答一个具体问题：**新加的抖音弹窗提取功能，无论怎么坏，会不会拖累现有详情页。**

四个场景 × 每个抖音样本：

| 场景 | 做法 | 合格线 |
|---|---|---|
| S0 原样 | 不动 | 与 golden 逐字相同 |
| S1 新模块未加载 | 按文件名把弹窗相关脚本剔出注入清单 | 详情页与 golden 逐字相同 |
| S2 新模块被禁用 | 把 `isOpen()` 打成恒 `false`、`watch()` 打空 | 详情页与 golden 逐字相同；弹窗页**干净退回批 1**（不接管、无按钮、0 字段） |
| S3 新模块抛异常 | 把 `isOpen()`、`watch()` 都打成抛错 | 详情页与 golden 逐字相同（工厂吞错退回原类）；弹窗页同样退回批 1 |

实现靠 `harness.openPage()` 的三个可选参数 `scriptFilter` / `beforeMainScript` / `afterScripts`（默认不传 = 原行为）。打桩失败会**报「跳过」而不是「通过」**，避免假绿。

> 为什么要 `beforeMainScript` 这一档：content-main 的 `init()` 在脚本注入时就跑起来了，等全部脚本注入完再打补丁，抖音弹窗页早就接管完了 —— 补丁等于没打（批 3 实测踩过）。
>
> 还有一条更隐蔽的：只改 `DouyinModalContext.isOpen` 骗不过弹窗监听 —— `watch()` 内部用的是**闭包里的 isOpen**，不是 API 对象上的属性，所以必须连 `watch` 一起打。

**新模块还没接入时**：只跑 S0，其余标「跳过（新模块尚未接入）」，这是预期状态，不是失败。

> 假绿自检：故意把 `douyin-social.js` 剔出注入清单 → 11 个字段全丢 + 抛「未找到提取器」。跑不动这个差异，说明尺子坏了。

**弹窗样本的判法（v2.5.77 批 3 起）**：抖音的弹窗入口页面（精选/搜索/用户主页）在**弹层打开时**必须接管 —— S0 要求「按钮恰好 1 个且贴着锚点、字段与基线逐字相同」；S1/S2/S3 把新模块打死，要求「**干净退回批 1**：不接管、无按钮、0 字段」。任何一半不达标都算失败，不允许假绿。

> 批 1 那会儿这里标的是 `noEntry`（「不出按钮」就是正确行为）；批 3 做完弹窗接管后，这个标记已经从 `registry.json` 里删掉，判据换成上面这套。

---

### 14. `douyin-inject-scope.test.js` —— 抖音注入范围（v2.5.77 批 1 立、批 3 升级判据）

```bash
node tests/douyin-inject-scope.test.js
node tests/douyin-inject-scope.test.js --verbose
```

钉住三件事，47 项断言：

| 组 | 测什么 |
|---|---|
| 一、manifest 范围 | 抖音 matcher **恰好 9 条**（多一条少一条都红）；首页/消息/直播/下载/关注**不在**清单里；其他站 matcher 数量不变（41→47，新增 6 条全是抖音） |
| 二、检测器 | 用 **background 的真实配置**（不是测试桩）：`/video/`、`/note/`、`v.douyin.com` → `social`；7 个新入口 → **`null`**；豆瓣/B 站类型不变 |
| 三、端到端 | 3 个弹窗入口存档（弹层开着）→ **按钮恰好 1 个 + 实例已接管**；把弹层节点摘掉模拟「信息流页没点开视频」→ **0 按钮、未接管、但监听已挂好**；详情页 → 初始化成功、按钮恰好 1 个 |

**为什么必须有第二组**：`MediaTypeDetector.detect()` 原本在「站点在表里但路径不匹配」时会退到 `detectByContent()` 按正文猜类型。抖音信息流页面上满是「#话题/点赞/评论」，猜出来必然是 `social`；`/user/?modal_id=` 还能猜成 `movie`（字段从 11 项变 32 项）。所以抖音配置加了 `noContentFallback: true`：**路径不对就返回 null，绝不猜**。这个开关目前只有抖音声明，其他站点不受影响。

**第三组在批 3 升级过一次判据**：批 1 时这 3 个入口断言的是「**不出按钮**」（那时弹窗接管还没做，出了就是错）；批 3 做完接管后，契约反过来 —— 弹层开着必须出 1 个按钮并接管。为了还能测「真的没弹窗时什么都不出」，测试里加了两样东西：

- `loadJsdom()`：照 `harness` 的找法去托管 node 的 `workspace/node_modules` 捞 jsdom
- `stripModalNodes(html, url)`：把 `[data-e2e="modal-video-container"]`、`video-info`、`video-desc` 从存档里删掉，**DOM 手术**出一份「信息流页」

> 为什么非要做手术：3 份弹窗存档全是**弹层打开时**抓的，DOM 里永远有弹层节点。不摘掉的话，页面看起来永远是「开着弹窗」，这条断言等于没测。

---

### 15. `douyin-modal-handler.test.js` —— 弹窗按钮的浮动与跟随（v2.5.77 批 3）

```bash
node tests/douyin-modal-handler.test.js
node tests/douyin-modal-handler.test.js --verbose
```

**这一批最核心的一把尺子**：抖音精选 / 搜索 / 用户主页点开视频后，按钮要浮在弹窗右上角、关弹窗要连带关浮窗、切下一条要就地刷新。三件事都是「看得见的行为」，没有机器尺子就只能靠人眼，改一次代码就得点一遍。141 项断言分十节：

| 节 | 测什么 | 关键断言 |
|---|---|---|
| 一 | 3 个弹窗入口接管 + 贴弹窗右上角 | 按钮恰好 1 个；`data-clipmate-anchor="douyin-modal"`；左边缘 = 弹窗右边缘 − 按钮宽 − 16 |
| 二 | 点按钮 → 浮窗打开，7 个字段对 | 与写死的真值表 `DOUYIN_MODALS` 逐字比对（本页标题/作者ID/作者昵称/作者主页/发布日期/本页文案/URL） |
| 三 | 关弹窗 → 按钮撤 + **已开的浮窗一起关** | 关弹窗后按钮 0 个、浮窗 `isOpen` 为假；**走的是现有 `modalManager.close()`，不是另写的强制关** |
| 四 | 弹窗里切下一条 → 按钮不动 + 浮窗就地刷新 | 按钮 DOM 节点引用不变（没被重建）；浮窗内容换成新作品；4 次重试 × 400ms 兜住「切条瞬间 DOM 还没换完」 |
| 五 | 选项页开关关掉 → 完全等于批 1 | `douyinModalEnabled=false` 时不出按钮、不接管、不挂锚点 |
| 六 | 熔断后不接管 | `DouyinModalExtractor.isDisabled()` 为真时连按钮都不出 |
| 七 | 域名门禁：非抖音页面一个监听都不多挂 | 豆瓣样本上 `_douyinWatch` 为空、无按钮、无锚点 |
| 八 | 锚点夹取 + 用户拖动后不抢位置 | 弹窗比视口还大 / 位置为负时夹到 16px；用户拖过按钮后切条**不被拽回原位** |
| 九 | 红线：抖音详情页行为不变 | `/video/` 页照旧出 1 个按钮、**不带**锚点标记、无弹窗监听；走真实链路仍是原 `DouyinSocialExtractor` + `social`；3 份详情页快照另行由 `snapshot.js` 逐字比对 |
| 十 | 认不出是哪一条 → 不出按钮 | 真机发现的规则：弹层开着但 `getWorkId()` 为空（还没渲染完 / 未登录）时，宁空不错 |

三条要知道的写法坑：

1. **jsdom 没有布局**：`offsetWidth` 恒 0、`getBoundingClientRect()` 全 0。所以测试里用 `inst._douyinAnchorElement = () => ({ getBoundingClientRect: () => ({...}) })` **伪造几何**，产品代码那边则用兜底宽度 120px + 视口计算。
2. **第八节要伪造几何、第九节要真页面**，两者不能混在一个实例上测，否则互相污染。
3. **第十节必须连 `isInitialized` 一起清**：页面加载时已经接管过一次，只清 `_douyinActivated` / `_douyinModalId` 会让断言假绿（实测踩过）。

> 这一节的断言不是凭空写的：`DOUYIN_MODALS` 的真值表来自 `tests/fixtures/json/` 里 3 份弹窗存档的真实内容，改产品代码改到「字段对不上」会立刻红。

---

### 16. `douyin-modal-live.js` —— 四类页面真机走一遍（v2.5.77 批 4）

```bash
node tests/douyin-modal-live.js --login      # 第一次必须先跑这个（会开窗口让你扫码）
node tests/douyin-modal-live.js              # 跑全部 4 个入口
node tests/douyin-modal-live.js --only=jingxuan   # 只跑 id 含这个关键字的入口
node tests/douyin-modal-live.js --shot       # 顺便把每一步截图存到 .workbuddy/tmp/live-*.png
node tests/douyin-modal-live.js --headful    # 有头跑（能看见它真的在点）
CLIPMATE_EXT=<目录> node tests/douyin-modal-live.js   # 验指定目录（比如成品包）
```

**为什么单测之外还要这个**：`douyin-modal-handler.test.js` 用 jsdom 造页面，它能证明「逻辑对不对」，但证明不了「真机上按钮有没有被页面自己的元素盖住」「真鼠标点下去浮窗是不是真弹出来」「按方向键切条时按钮会不会被重建」。这一条脚本全部用**真实鼠标/键盘事件**（`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`），不调产品函数，四类页面各走一遍「开 → 点 → 切 → 关」。

| 入口 | 页面 | 验什么 | 断言数 |
|---|---|---|---|
| `jingxuan-note` | `/jingxuan?modal_id=…` | 按钮贴弹窗右上角（像素级偏差 ≤ 8）、点开出浮窗 7 字段对、**方向键切下一条 → 按钮同一 DOM 节点 + 浮窗就地刷新**、关弹窗按钮撤 + 浮窗一起关 | 28 |
| `search-video` | `/search/<kw>?modal_id=…` | 同上；**未登录时抖音搜索页整页空白，整格标 ⏭ 跳过**（不算通过） | — |
| `user-video` | `/user/<id>?modal_id=…` | 同上；这个入口方向键不换条（抖音自身行为）→ 该条按设计跳过 | 23 |
| `detail-video` | `/video/<id>` | **红线对照**：按钮照出、**不带**弹窗锚点、点开浮窗、点 X 关掉后按钮还在 | 13 |

跑完一行总结：`全部通过：64 项（另有 4 项按设计跳过）`。

四个必须知道的坑（都是真机踩出来的）：

1. **抖音弹窗没有可点的关闭按钮**：全屏固定层，Escape 不响应，点四角黑区也不关。真人唯一的退出方式是**浏览器后退**，所以脚本用 `history.back()`，并额外断言「退回去之后地址还在 douyin.com」——否则退回 `about:blank` 时按钮消失只是因为页面没了，那是假绿。
2. **登录判据别看页面文字**：抖音首页把「扫码登录」面板一直挂在 DOM 里，`innerText` 判据永远为真（踩过）。现在读 CDP 的 `Network.getCookies`，看有没有 `sessionid` / `sid_tt` 这类登录票据。
3. **登录态放专用 profile**：`.workbuddy/tmp/douyin-live-profile`，跟你日常浏览器完全隔离，扫码一次就存住，以后不用再扫。**这个目录里有你的抖音登录态，别拷给别人、别提交仓库。**
4. **URL 别写死 `/video/` 还是 `/note/`**：未登录时图文会退化成 `/video/`（「图文」两个字藏在登录框后面拿不到）。这不是字段错，用正则同时接受两种。

> 验的是**源码目录**（`Extensions.loadUnpacked` 直接加载 `ClipMate_chrome/`），所以跑的是当前代码不是旧成品；要验成品包就加 `CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.78_chrome`。批 4 出包后就是这么复查的：同一套断言在成品目录上 28 项全过。

**v2.5.78 加了一道「换条」自检**：抖音有时候不按地址栏的 `modal_id` 打开，直接播它自己推荐的另一条。这时浮窗里是**别的视频**的数据，拿样本真值去比必然红——但那是抖音的行为，不是扩展的 bug。现在脚本先比对「浮窗 URL 里的作品 ID」与样本 ID：

- 一致 → 正常比对
- 不一致 → 打印 `⏭ 抖音这次没按 modal_id 打开，播的是 xxx（样本 yyy）`，把**内容类断言**（字段值、URL、切条）转成跳过，**几何/点击/开关**这些与「是哪一条」无关的照常判

第一次跑全套时就撞上了这个（5 项红），对照实验证明改前版本同样环境下 64 项全过、改后单独复跑也 64 项全过 —— 是抖音换条。没有这道自检，以后每次验收都可能随机假红。

---

### 17. `social-date-precision.test.js` —— 日期「提取到多少就显示多少」+ 详情页与弹窗页统一（v2.5.78 / v2.5.79）

```bash
node tests/social-date-precision.test.js
node tests/social-date-precision.test.js --verbose
```

纯函数 + jsdom 测试，85 项，七节：

| 节 | 钉住什么 |
|---|---|
| 一 | `formatSocialDate`：源到「日」就只输出日（**不许补 `00:00`**）；到分输出到分；到秒输出到秒；相对时间按设计档位 |
| 二 | 标题尾跟着发布日期一起变（`-2025年06月16日174449` / `-2024年09月08日0114` / `-2026年10月19日`） |
| 三 | `formatTimestamp`（抖音 fiber 的 `createTime`）：输出到秒，不再砍成只剩日期 |
| 四 | `getMediaType`：数据里 `mediaType: 'social'` 就认社交，**不再只按网址猜**（弹窗页 `/jingxuan?modal_id=`、`/search/x?modal_id=`、`/user/x?modal_id=` 全归位） |
| 五 | 抖音图文页的 `:contains("发布时间")` 回退：不许再从 `<html>` 整页文本里捞别人的日期 |
| 六 | `mergePrecision`（v2.5.79）：**详情页（页面文字到分）+ fiber（到秒）= 同一个字符串**；日期/时分对不上就保持页面文字；页面已有秒就别动 |
| 七 | 端到端（jsdom）：视频详情页真的会去补秒；fiber 拿不到时保持老表现；fiber 串到别的作品时保持页面文字；页面本来就到秒时**不发那次请求** |

**为什么要有第五节**：老写法 `document.querySelectorAll('*').find(el => el.textContent.includes(...))` 按文档顺序取第一个命中，第一个永远是 `<html>`，等于把 1MB 整页文本喂给日期格式化。存档 HTML 里整页第一处中文日期恰好是对的，所以快照一直绿 —— 典型的假绿。现在改成「取包含该文字、且文本带日期的最短元素」。

**第六、七节对应的产品改动（v2.5.79）**：`douyin-social.js` 的 `extractPublishDate` 拆成两步 —— 页面文字（原逻辑一行未改）+ 补秒。视频详情页那行只写 `发布时间：2025-04-22 16:00`，而弹窗页读 fiber 是 `16:00:29`，同一条作品两处显示不一样。现在页面只要没到秒，就去问一次 fiber，**核实日期与时分一致**后才用它的秒。用户 2026-10-27 拍板「统一」。见 `v2.5.79_日期统一_交付报告.md`。

---

### 18. `douyin-detail-dump.js` —— 改动前后逐字对比字段（v2.5.78）

这不是断言工具，是**取证工具**：它只把真机上读到的字段原样吐成 JSON，判对错是你的活（或者另写脚本 diff）。

```bash
# 改前：加载备份目录
CLIPMATE_EXT=backups/ClipMate_v2.5.77_批5日期规则前_20261027_0934 \
  node tests/douyin-detail-dump.js --out=.workbuddy/tmp/before.json

# 改后：加载源码目录
node tests/douyin-detail-dump.js --out=.workbuddy/tmp/after.json
```

内置 6 个页面（3 个视频详情页 + 1 个图文详情页 + 2 个弹窗页）。真机真鼠标点按钮、真读浮窗里的表格。

**⚠️ 两条必看（v2.5.79 踩到的坑）**

1. **同一时刻只能有一个 dump 浏览器**。上一轮进程没退干净时，新一轮会连上**旧浏览器**（端口 `9333` 被复用）→ 旧浏览器里已经装着另一版本的扩展 → 页面上**两个提取按钮**，脚本读第一个，于是「改前」跑出「改后」的结果。
   - **判据**：输出里每个页面的「按钮: N 个」必须是 **1**。出现 2 就是混装，这一份数据作废。
   - **做法**：改前/改后分别用不同 `CLIPMATE_PORT`（如 9341 / 9342）+ 全新 `--profile` 目录，跑完等进程退出再跑下一轮。
2. **标题里的作者名会偶发漂移**（`作者昵称` 字段是对的，只有标题前缀变了）。这是抖音详情页首屏渲染时序造成的，同一版本连跑两次也会变，**与改动无关**；对比时不要拿它当回归证据。

**已知限制**：未登录时抖音详情页经常整页不给内容（`本页标题` 显示「未获取到作者无文案」、其余全空），那种页面 dump 出来是空的 —— 不是 dump 坏了，是页面不给。要拿真数据得先 `--login` 扫码。

---

### 18.5 `douyin-immersive.test.js` —— 沉浸流（推荐/关注/朋友）识别与接线（v2.5.80）

```bash
NODE_PATH=<含 jsdom 的 node_modules> node tests/douyin-immersive.test.js
node tests/douyin-immersive.test.js --verbose
```

95 项，七节：

| 节 | 钉住什么 |
|---|---|
| 一 | URL 判定：只认 `/`、`/follow`、`/friend`；`/jingxuan`、`/search`、`/user`、`/video`、`/note`、短链域名、相似域名一律不认 |
| 二 | 认「当前这一条」：关注页整页 2 个 `video-info` 要取正在播的那个；class 与 info 的 ID 对不上（切条中间态）返空；空壳返空；两条都像当前→返空；没有 `feed-active-video`→返空 |
| 三 | **弹窗永远优先**：地址栏有 `modal_id`、或弹层真的立起来了（容器里已有文案）→ 交回弹窗逻辑；只有空壳弹层不算 |
| 四 | `playbackMode` / `isOpen` / `resolve` 三者互相自洽 |
| 五 | `watch`：切条能感知（ID 变）、切到 `/jingxuan` 变 `closed`、切回来重新认出、内容抖动不重复回调 |
| 六 | 端到端（真实 `content-main`）：出 1 个按钮 + 锚点 `douyin-immersive` + 7 个业务字段 + 锚点取本条容器（**不许取常驻空弹层**） |
| 七 | 两个开关互不牵连：沉浸流关掉→沉浸流页不出按钮，但弹窗页照样接管 |

**第六节会从 `background.js` 真源码里读抖音的媒体配置**，断言 `noContentFallback: true` 还在。这条是这三页能工作的前提：少了它，`/follow` 会被「按正文关键词猜类型」猜成 social → 走正常全流程 → **监听压根挂不上** → 又退回「没按钮」。

### 18.6 `douyin-immersive-live.js` —— 沉浸流真机走一遍（v2.5.80）

```bash
node tests/douyin-immersive-live.js                 # 只跑推荐页（不需要登录）
node tests/douyin-immersive-live.js --all           # 推荐 + 关注 + 朋友（后两个要登录）
node tests/douyin-immersive-live.js --login         # 扫码一次（与 douyin-modal-live 共用 profile）
node tests/douyin-immersive-live.js --headful       # 有头跑
CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.80_chrome node tests/douyin-immersive-live.js
```

验六件事：按钮自己冒出来且贴在本条右上角 / 点得到（没被页面元素盖住）/ 浮窗 7 行且是**正在播的那一条** / 按 ↓ 切条浮窗就地刷新 / 切到精选页按钮撤掉 / **同一条作品在沉浸流与详情页读到的日期·文案·作者逐字相同** + 弹窗功能回归。

**三个坑（都踩过，别重复踩）**

1. **按钮一出现就立刻读几何是读不准的**：内联样式已写成 `top:72px`，但布局未应用，`getBoundingClientRect()` 还返回旧值（读到 20px），拿这个坐标去点会点空，看起来像「点按钮不出浮窗」。产品侧有 250/700/1500ms 三次补位，脚本等 1.2 秒后再断言/点击。
2. **社交类「URL」字段渲染成链接，文字是「点击访问」，真地址在 `href` 上**。探针必须读 `href`，否则会误判成「URL 字段错了」。
3. **切条（↓/滚轮）在隔离窗口里可能送不进播放器**，三种方式都试过（CDP 真事件 / 页面内合成 KeyboardEvent / 滚轮）。这一格会标 ⏭ **跳过，不算通过**；要真验这一步，用 BrowserSkill 在你自己登录的浏览器里跑。

---

### 18.7 `button-manager.test.js` + `button-gesture-live.js` —— 按钮手感（v2.5.92）

```bash
node tests/button-manager.test.js              # 离线 38 项，jsdom，不联网
node tests/button-manager.test.js --verbose
node tests/button-gesture-live.js              # 真机 10 项，真实鼠标事件（豆瓣读书页）
node tests/button-gesture-live.js --headful    # 想亲眼看一遍拖动
CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.92_chrome node tests/button-gesture-live.js
```

为什么单独有一对：按钮的「点一次没反应、要点好几次」和「拖动发黏」都不是提取逻辑，快照和 verify-live 的「点一下能出表格」都测不出来。两份脚本一个钉逻辑、一个钉真实事件链。

离线那份钉四件事：手抖（<4px）不许吞点击 / 真拖动（≥4px）必须吞掉随之而来的 click / 拖动结束后**没有 100ms 盲区** / 拖动过程中**不读 `offsetWidth`·`offsetTop`**、位移只写 `transform` 且一帧一次。

真机那份钉：拖动中 `style.transform` 有值而 `style.left` 为空（证明没走重排）→ 松手后 `transform` 清空、`left/top` 落位、位移与鼠标一致 → 拖完**不弹浮窗** → **拖完立刻点、且故意偏 2px 仍然弹浮窗** → ESC 关窗 → 朴素单击也弹浮窗。

⚠️ 真机会**改按钮位置**（拖动 150/120px 并写进 `localStorage`）。想复原就手动拖回去，或删掉 `clipmate-button-position-*` 这个键。

---

### 18.8 `tiktok-page-data.test.js` —— TikTok 一手数据链路（v2.5.94）

```bash
node tests/tiktok-page-data.test.js            # 离线 82 项，纯 Node（不需要 jsdom / NODE_PATH）
```

四个被测对象：主世界扫描器 `tiktok-fiber-hook.js`、隔离世界读取器 `shared/tiktok-page-data.js`、
作品页提取器 `extractors/tiktok-social.js`、换条跟随 `ui/tiktok-spa-handler.js`。

**最要紧的一条：ID 对不上就是别人的数据。** 切到下一条之后 TikTok 首屏那块
`__UNIVERSAL_DATA_FOR_REHYDRATION__` **不会更新**（2026-10-29 真机实证，23 万字符一字未变），
所以两路数据都有一道「与当前地址 ID 比对」的闸口。带 ★ 的用例就是钉这道闸口的，
闸口一漏，浮窗会把上一条的文案/日期贴到当前这条上 —— 比取不到更糟。

反向验证（改完必须变红，否则说明用例没在管）：

| 改坏哪里 | 应该红几条 |
|---|---|
| 拆掉 `readRehydration` 的 ID 闸口 | 6 条（含 ★ 切条后误用旧数据） |
| `getCurrent` 把两路优先级颠倒 | 1 条（★ 两路都对得上时仍应以主世界为准） |
| 拆掉提取器的「一手日期」分支 | 1 条（日期又变回空） |

沙箱注意（跟 `douyin-net-cache.test.js` 同款）：

- `extends BaseExtractor` 走的是**词法作用域**，拿不到 `window`，必须在源码前拼一段
  `var BaseExtractor = window.BaseExtractor, ...` 的 prelude，否则报 `BaseExtractor is not defined`。
- 加载 `tiktok-fiber-hook.js` 前要把 `global.setInterval / setTimeout` 临时钉死成空转，
  否则它挂的轮询定时器会让 Node 进程不退出。
- mixin 里用到的 `TiktokPageData`、`location` 都要作为 `new Function` 的参数显式传进去，
  不然 `typeof TiktokPageData` 是 `'undefined'`，那条路径被静默跳过，测试会假绿。

---

### 19. 页面自带 SDK 的噪声（`xgplayer sdk load timeout`）

抖音弹窗存档里带着页面自己的播放器 SDK（xgplayer），它在 jsdom 里**必然**加载超时，以未处理的 Promise 拒绝形式抛到 node 进程，会让整个跑批直接退出（实测崩在 `douyin-modal-search` 那条）。

`snapshot.js` 与 `douyin-guard-drill.js` 各有一段白名单处理器，只吞 `xgplayer` / `sdk load timeout` / `Script error` 三种关键词，其他未处理拒绝照旧报错退出。**这是测试环境的坑，产品代码不用改。**

---

## 三、跑不起来的常见原因

| 现象 | 原因 | 处理 |
|---|---|---|
| `找不到 jsdom` | jsdom 装在托管 node 的 workspace 里，不在默认模块路径上 | 脚本会自动去 `~/.workbuddy/binaries/node/workspace/node_modules` 找；还找不到就设 `CLIPMATE_NODE_PATH` 指向含 jsdom 的 `node_modules` |
| `node: command not found` | 没在 PATH 里 | 用绝对路径：`C:/Users/19127/.workbuddy/binaries/node/versions/22.22.2-6/node.exe tests/preflight.js` |
| 快照大面积报错 | 页面存档被截断/不是真 HTML | 重新抓一份存档（见下节） |
| 某个样本一直 `mode=fallback` | 该页在 jsdom 里没走完初始化 | 说明这条不是「点按钮」的真实链路，去 `tests/golden/<id>.json` 里看 `mode` 字段，必要时重抓存档 |
| 真机脚本拿到的字段几乎全空（只有 URL 一类有值） | `Page.navigate` 之后 `readyState` 会**立刻**返回 `complete`——导航刚发出时当前文档还是空白页，它本来就是 complete，于是提取跑在空文档上 | 别改提取器。判据要三个一起看：`readyState==='complete'` + `location.href` 已是目标地址 + `body.innerText.length > 500`（`cross-site-live.js` 的 `waitReady()` 就是这么写的） |

---

## 四、怎么加一个新样本（让护栏覆盖更多站）

**优先用 `capture.js`**，别手工复制 outerHTML（手工存下来的页面常常缺 doctype、缺懒加载内容）：

1. 在 `tests/capture-targets.json` 的 `targets` 里加一条：
   ```json
   {
     "id": "metacritic-game-hades",
     "site": "Metacritic",
     "url": "https://www.metacritic.com/game/hades/",
     "mediaType": "game",
     "extractor": "MetacriticGameExtractor",
     "note": "Hades 游戏页",
     "proxy": false,
     "minLen": 30000,
     "mustInclude": ["metacritic"],
     "expectPath": "/game/hades",
     "ready": "document.documentElement.outerHTML.length > 30000"
   }
   ```
   - `minLen` / `mustInclude`：用来识别「抓到的是反爬页 / 挑战页」
   - `expectPath`：**最重要的一条**。详情页 404 时很多站会 302 回首页，抓到的就是首页（字节数很大、看着像成功，其实内容全错）。最终 URL 不包含这个片段就判失败、不落盘
   - `proxy`：需要走 `127.0.0.1:7897` 的站（TMDB / IMDb / Goodreads / YouTube / MobyGames）填 `true`
2. 跑 `node tests/capture.js`，它会打印一坨可直接粘进 `registry.json` 的 JSON
3. 粘进 `tests/fixtures/registry.json` 的 `fixtures`，**URL 必须是这一页的真实 URL**（提取器靠它判断站点和类型）
4. 跑 `node tests/snapshot.js --update`，然后**打开 `tests/golden/<id>.json` 用眼睛过一遍**，确认不是一片空值

> 存档里带着当时的真实数据，所以这些样本会「过期」——站点改版后抓不到东西了，就该重抓。建议每次新增站点时顺手补一份。

### 需要登录态的站（抖音，v2.5.77 起）

抖音的搜索页、用户主页**不登录不出内容**，`capture.js` 的临时 profile 抓不到。这两类样本改用 BrowserSkill 扩展在**已登录的真实浏览器**里抓：

```bash
bsk session start --json                       # 拿 session id
bsk navigate "<页面地址>" --session <id>
bsk snapshot --session <id>                    # 找可点元素
bsk click @eN --session <id>                   # 真实点击（点开弹窗）
bsk get-html --session <id> --max-bytes 6000000 --out tests/fixtures/html/<名字>.html
node .workbuddy/tmp/clean-fixture.js tests/fixtures/html/<名字>.html
```

三条硬规矩：

1. **`--max-bytes` 必须给大**，默认 512KB 会静默截断（`truncated=true`），存档缺尾巴
2. **抓完必须洗**：真机上会有 `browser-skill-overlay`（工具注入）和 `button.media-extractor-button`（采媒灵自己注入的按钮）。不洗 = 拿「扩展对自己的 DOM 做了什么」当页面样本
3. **改动页面前设的探针属性（如 `data-probe`）要在导出前摘掉**

样本出处记在这里，方便以后区分哪份是登录态抓的：**抖音 5 份均为 2026-10-27 用已登录 Edge（BrowserSkill 0.3.3 / edge 156）抓取**；弹窗样本 3 份中 2 份为真实点击打开（搜索页、用户主页），1 份为 `/jingxuan?modal_id=` 直接打开（图文）。

### BrowserSkill 的定位（v2.5.77 起定，2026-10-29 收紧为唯一入口）

**以后凡是「真机验证」，一律用 BrowserSkill 接管用户正在用的 Edge** —— 自启动无头浏览器（`--headless=new` + 临时 profile + `--load-extension`）**2026-10-29 起全面取消，没有「干净未登录环境」这个例外**。理由：那套组合是风控评分最高的形态（扩展 + 无头 + 一次性临时 profile + 同一 IP；快手 `result:2 操作太快了`、小红书 `300012 IP存在风险`），用户 23:40 明确要求「避免所有网站的风控」。

**接管姿势（实测）**：`bsk tab borrow <用户标签>` 会要求浏览器里点确认，无人值守借不到 → 用 Agent Window 自带的标签页（同一个 Edge profile，**cookie/登录态共享**）；`bsk daemon start --foreground` 在沙箱里才能起；用完 `bsk session stop`。读接口响应体用 `bsk debug start` + `bsk debug requests --url x` + `bsk debug request <run>:n<id> --part response`。

| 能用 | 说明 |
|---|---|
| 登录态页面 | 直接借用户已登录的 Edge，不用扫码、不用复制 cookie |
| 真实点击 / 滚动 / 输入 | 比 Playwright 更像人；Playwright 被 `z-index:10001` 遮罩挡住的地方它能点 |
| 读 DOM / 跑 JS / 截图 | `evaluate`、`snapshot`、`screenshot` |
| 抓页面存档 | `get-html`（注意 `--max-bytes`） |

| 不能 / 不该 | 原因 |
|---|---|
| 替代 `snapshot.js` 存档单测 | 单测快、可重复、能 diff；bsk 一次往返几秒，属于「最后一关」 |
| 读剪贴板 | `navigator.clipboard.readText()` 会弹权限框，别碰（短链就是被这条堵住的） |
| 长时间占着用户的窗口 | 会借用户当前标签页、会出声（视频自动播放）。跑完 `bsk session stop <id>` |
| 替代 Chrome 上的验收 | 只连 Edge。最终人工终验仍在用户已登录的 Edge 里做（同内核，成品通用） |

启动姿势：`BSK_AUTO_START=0 bsk daemon start --foreground`（后台任务）→ `bsk status --json` 看到 `browser_name: edge` 才能用 → 用完 `bsk session stop`。

## 五、怎么加一个新站的 URL（让对账覆盖它）

在 `tests/url-samples.json` 里补两行：

- `samples`：一个该站**真实详情页** URL + 期望命中的提取器类名
- `negatives`：一个该站**不该出按钮**的 URL（子页/列表页/首页），写清原因

---

## 六、已知边界（别指望它全包）

| 边界 | 说明 |
|---|---|
| **不联网** | `fetch` 一律失败。所以「要第二次请求才拿到」的字段在快照里恒为空：**IMDb 上映日期不走网络（JSON-LD 里就有，已覆盖）**、**17K 发布日期要抓目录页（离线为空）**。这类字段由 `smoke-checklist.md` 的人工冒烟兜底 |
| **覆盖 10 个站 / 19 个样本** | 豆瓣读书、豆瓣电影、17K、Goodreads、IMDb、TMDB、Steam、Bangumi、Metacritic、**抖音（v2.5.77 起，含 3 份弹窗态）**。**还没样本**：豆瓣游戏（要有效 `/game/<id>/`，失效 ID 会跳首页）、小黑盒、MobyGames、其余八个社交站（要登录态） |
| **jsdom 没有 `innerText`** | 扩展的「按正文关键词猜媒体类型」读 `document.body.innerText`，jsdom 只有 `textContent`。`harness.js` 里补了一层 `innerText → textContent` 的兜底；**不补的话豆瓣电影会被判成 `unknown` 类型**，字段清单跟着错（v2.5.64 前就是这样，快照里那条 `预期 movie，实际 unknown` 的提示就是它） |
| **不透传页面自身的 JS** | jsdom 不执行外链脚本。对「内容全靠前端渲染」的站（抖音、小红书）即使存档也不准，只能靠真机 |
| **不测界面** | 按钮位置、浮窗样式、双击复制这些不在这里，仍是人工/截图验证 |

补齐剩余站点的样本，是批次 2 里的活儿（要先写一个浏览器抓存档的小工具）。
