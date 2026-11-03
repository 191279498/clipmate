/**
 * 空文案兜底站名（v2.5.98）
 *
 * 用户定的规矩（2026-10-29）：社交类站点抓不到「本页文案」时，不再留空，
 * 改填「站名 + 形态」——
 *   TikTok 视频页 → `TikTok视频`，TikTok 图文页 → `TikTok图文`，
 *   小红书 → `小红书笔记`，微博 → `微博博文`，X → `X推文`，
 *   B站 ─ /read/ → `哔哩哔哩专栏`，Instagram → `Instagram帖子`。
 *
 * 三条边界（同样来自用户）：
 *   · **只做社交类「本页文案」**，书 / 影 / 游的「简介」一个字不动；
 *   · 首页（`unknown` 等不在词表里的站点）**不硬凑**，保持空；
 *   · 主页不单独一档，落回视频档。
 *
 * 本文件钉住的契约
 * ----------------
 *   A. 词表：10 个站 × 两个档，逐条断言**具体字符串**（不是「非空」）
 *   B. 装配器：文案为空 → 兜底；文案有值 → 一个字都不许改
 *   C. 空值口径：`''` / `'   '` / `null` / `undefined` 都算空
 *   D. 降级：词表没加载 / 站点不认识 / 形态取值抛错 → 保持空或走默认档，**不能崩**
 *   E. 形态取值支持同步与 Promise 两种写法
 *
 * 反向验证（必须变红，见文件末尾清单）
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const NAMES_PATH = path.join(ROOT, 'src/content/shared/social-site-names.js');
const BUILDER_PATH = path.join(ROOT, 'src/content/shared/social-fields-builder.js');
const TITLE_PATH = path.join(ROOT, 'src/content/shared/social-title-processor.js');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m' };
let pass = 0;
let fail = 0;

// v2.7.0：`ok()` 原来只吃一个参数，第二参数（条件）被**静默丢弃** ——
// 这个文件里所有 `ok('xxx', 条件)` 都是假断言，永远不会红（写来看着像测了）。
// 现在按调用形态区分：只传 1 个参数 = 无条件通过（纯告知），传 2 个 = 真断言。
function ok(name, cond) {
  if (arguments.length > 1 && !cond) return bad(name, '条件为假');
  pass++;
  console.log(`  ${C.green}✓${C.reset} ${name}`);
}
function bad(name, detail) { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }

const SocialSiteNames = require(NAMES_PATH);
const { SocialTitleProcessor } = require(TITLE_PATH);

/**
 * 在模拟的浏览器环境里加载装配器
 *
 * `social-fields-builder.js` 是个 IIFE，参数是 `window`（node 下为 null）。
 * 想在单测里验证兜底，必须给它一个「像浏览器」的 window：
 * `SocialSiteNames` 挂在那里，`location.href` 也在那里。
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.withNames=true] - 是否挂词表（false 用来测降级）
 * @param {string} [opts.href='https://www.tiktok.com/'] - 假装当前地址
 * @returns {Object} 装配器 API（build 等）
 */
function loadBuilder(opts) {
  const o = opts || {};
  const win = {
    location: { href: o.href || 'https://www.tiktok.com/' }
  };
  if (o.withNames !== false) win.SocialSiteNames = SocialSiteNames;
  // v2.7.38：浏览器里标题处理器和装配器是同一批注入的，一定同时在。
  // 装配器要问它「这段文案按标题规则洗完还剩不剩字」，测试环境必须一致，
  // 否则 `isTextBlankAfterTitleFilter()` 会走降级分支（永远 false），新断言全部假绿。
  if (o.withTitleProcessor !== false) win.SocialTitleProcessor = SocialTitleProcessor;

  const sandbox = { window: win, console: console };
  sandbox.module = { exports: {} };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BUILDER_PATH, 'utf8'), ctx, { filename: BUILDER_PATH });
  return sandbox.module.exports;
}

/** 造一个最小提取器：只有取值方法，别的都不管 */
function makeExtractor(props) {
  return Object.assign({
    siteName: 'tiktok_social',
    extractTitle: () => '标题',
    extractAuthorId: () => 'someone',
    extractAuthorName: () => '某人',
    extractAuthorHomepage: () => 'https://www.tiktok.com/@someone',
    extractPublishDate: () => '2026/10/29 12:00:00',
    extractPageText: () => '真实文案',
    extractUrl: () => 'https://www.tiktok.com/@someone/video/1'
  }, props || {});
}

async function main() {
  /* ============================ 一、词表 ============================ */
  section('一、词表：10 个站 × 视频/图文两档，逐条断言具体字符串');

  const cases = [
    ['tiktok_social', 'TikTok视频', 'TikTok图文'],
    ['douyin_social', '抖音视频', '抖音图文'],
    ['kuaishou_social', '快手视频', '快手图文'],
    ['xiaohongshu_social', '小红书笔记', '小红书笔记'],
    ['weibo_social', '微博博文', '微博博文'],
    ['weibo_mobile_social', '微博博文', '微博博文'],
    ['x_social', 'X推文', 'X推文'],
    ['bilibili_social', '哔哩哔哩视频', '哔哩哔哩专栏'],
    ['youtube_social', 'YouTube视频', 'YouTube视频'],
    ['instagram_social', 'Instagram帖子', 'Instagram帖子']
  ];

  for (const [site, videoLabel, altLabel] of cases) {
    eq(`${site} 视频档`, SocialSiteNames.labelFor(site, 'video'), videoLabel);
    eq(`${site} 图文/非视频档`, SocialSiteNames.labelFor(site, 'photo'), altLabel);
  }

  eq('形态为空串 → 视频档（拿不准就用默认档）',
    SocialSiteNames.labelFor('tiktok_social', ''), 'TikTok视频');
  eq('形态为 undefined → 视频档',
    SocialSiteNames.labelFor('douyin_social', undefined), '抖音视频');
  eq('形态是没见过的词 → 视频档（不认就不猜）',
    SocialSiteNames.labelFor('douyin_social', 'audio'), '抖音视频');

  eq('不认识的站点 → 空串（不硬凑）',
    SocialSiteNames.labelFor('unknown', 'video'), '');
  eq('老站（豆瓣）→ 空串（社交兜底不碰书影游）',
    SocialSiteNames.labelFor('douban_movie', 'video'), '');
  eq('站点为空 → 空串', SocialSiteNames.labelFor('', 'video'), '');
  eq('站点为 null → 空串', SocialSiteNames.labelFor(null, 'video'), '');

  eq('get() 取到完整词条',
    JSON.stringify(SocialSiteNames.get('instagram_social')),
    JSON.stringify({ name: 'Instagram', video: '帖子', alt: '帖子' }));
  eq('get() 不认识的站点返回 null', SocialSiteNames.get('nope'), null);

  /* ==================== 二、装配器：空 → 兜底 ==================== */
  section('二、装配器：文案为空 → 填「站名+形态」');

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: () => 'video'
    }));
    eq('TikTok 视频、文案空 → TikTok视频', rec['本页文案'], 'TikTok视频');
    eq('其他字段不受影响（标题）', rec['本页标题'], '标题');
    eq('其他字段不受影响（作者ID）', rec['作者ID'], 'someone');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: () => 'photo'
    }));
    eq('TikTok 图文、文案空 → TikTok图文', rec['本页文案'], 'TikTok图文');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'douyin_social',
      extractPageText: () => '',
      getContentShape: () => 'photo'
    }));
    eq('抖音图文、文案空 → 抖音图文', rec['本页文案'], '抖音图文');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'xiaohongshu_social',
      extractPageText: () => ''
      // 小红书不实现 getContentShape → 走默认档
    }));
    eq('小红书没有形态方法 → 小红书笔记（默认档就是笔记）', rec['本页文案'], '小红书笔记');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'weibo_mobile_social',
      extractPageText: () => ''
    }));
    eq('微博手机版 → 微博博文', rec['本页文案'], '微博博文');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'x_social',
      extractPageText: () => '',
      getContentShape: () => ''
    }));
    eq('X 形态为空 → X推文', rec['本页文案'], 'X推文');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'bilibili_social',
      extractPageText: () => '',
      getContentShape: () => 'photo'
    }));
    eq('B站专栏 → 哔哩哔哩专栏', rec['本页文案'], '哔哩哔哩专栏');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'youtube_social',
      extractPageText: () => '',
      getContentShape: () => 'video'
    }));
    eq('YouTube → YouTube视频', rec['本页文案'], 'YouTube视频');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => '',
      getContentShape: () => 'photo'
    }));
    eq('Instagram 图文 → Instagram帖子（不叫图文）', rec['本页文案'], 'Instagram帖子');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'kuaishou_social',
      extractPageText: () => '',
      getContentShape: () => 'video'
    }));
    eq('快手 → 快手视频', rec['本页文案'], '快手视频');
  }

  /* ==================== 三、有值的一个字都不改 ==================== */
  section('三、文案有值 → 一个字都不许改');

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '今天去打球了 #vlog',
      getContentShape: () => 'video'
    }));
    eq('普通文案原样保留', rec['本页文案'], '今天去打球了 #vlog');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '  前后都有空格  ',
      getContentShape: () => 'video'
    }));
    eq('有值时首尾空格也原样保留（不做 trim，改变既有输出）',
      rec['本页文案'], '  前后都有空格  ');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '这条文案尾巴带展开',
      getContentShape: () => 'video'
    }));
    eq('脏文案（带「展开」）也原样保留 —— 兜底不是清洗器',
      rec['本页文案'], '这条文案尾巴带展开');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '🎬',
      getContentShape: () => 'video'
    }));
    eq('只有一个 emoji 也算有值', rec['本页文案'], '🎬');
  }

  /* ==================== 四、空值口径：四种形态都算空 ==================== */
  section('四、空值口径：空串 / 全空白 / null / undefined 都算空');

  const blanks = [
    ['空串', ''],
    ['三个空格', '   '],
    ['换行+制表符', '\n\t '],
    ['全角空格', '\u3000'],
    ['null', null],
    ['undefined', undefined]
  ];
  for (const [label, value] of blanks) {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => value,
      getContentShape: () => 'video'
    }));
    eq(`${label} → 兜底成 TikTok视频`, rec['本页文案'], 'TikTok视频');
  }

  /* ==================== 五、降级与容错 ==================== */
  section('五、降级与容错：不认识的站不硬凑，形态取错不崩');

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'unknown',
      extractPageText: () => ''
    }));
    eq('站点 unknown → 保持空（不写「unknown视频」这种脏值）', rec['本页文案'], '');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'douban_movie',
      extractPublishDate: () => '1994/09/10',
      extractPageText: () => ''
    }));
    eq('非社交站（豆瓣电影）→ 保持空', rec['本页文案'], '');
  }

  {
    const B = loadBuilder({ withNames: false });
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => ''
    }));
    eq('词表没加载 → 保持空（降级不能崩、也不能瞎填）', rec['本页文案'], '');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: () => { throw new Error('boom'); }
    }));
    eq('形态方法抛错 → 走默认视频档', rec['本页文案'], 'TikTok视频');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: () => ({ shape: 'photo' })   // 返回了怪东西
    }));
    eq('形态方法返回非字符串 → 走默认视频档', rec['本页文案'], 'TikTok视频');
  }

  /* ==================== 六、形态支持 Promise ==================== */
  section('六、形态方法支持返回 Promise（异步提取器也能用）');

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: async () => 'photo'
    }));
    eq('async getContentShape → 认得出图文', rec['本页文案'], 'TikTok图文');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      getContentShape: async () => { throw new Error('async boom'); }
    }));
    eq('async 形态方法抛错 → 默认视频档', rec['本页文案'], 'TikTok视频');
  }

  /* ==================== 七、提取器侧：形态方法的实现 ==================== */
  section('七、真实提取器确实挂了 getContentShape（防止以后被删掉）');

  const tiktokSrc = fs.readFileSync(path.join(ROOT, 'src/content/extractors/tiktok-social.js'), 'utf8');
  const douyinSrc = fs.readFileSync(path.join(ROOT, 'src/content/extractors/douyin-social.js'), 'utf8');

  ok('TikTok 提取器有 getContentShape', /getContentShape\s*\(/.test(tiktokSrc));
  ok('抖音提取器有 getContentShape', /getContentShape\s*\(/.test(douyinSrc));
  ok('TikTok 认一手数据 isPhoto', /getContentShape[\s\S]{0,400}isPhoto/.test(tiktokSrc));
  ok('TikTok 认地址 /photo/', /getContentShape[\s\S]{0,400}\\\/photo\\\//.test(tiktokSrc));
  // v2.7.3：抖音的图文判定从 getContentShape 里抽成了 `_isNoteWork()`，
  // URL 字段（输 /note/ 还是 /video/）和形态字段（填「抖音图文」还是「抖音视频」）
  // 共用这一处 —— 以前各判各的，弹窗态地址是 `/user/…?modal_id=` 没有 /note/，
  // 于是出现过「URL 输 /note/…、文案却填抖音视频」的自相矛盾（2026-10-30 真机实测）。
  ok('抖音形态判定认地址 /note/', /_isNoteWork[\s\S]{0,1800}\\\/note\\\//.test(douyinSrc));
  ok('抖音形态判定认一手数据 awemeType 68', /_isNoteWork[\s\S]{0,1800}awemeType[\s\S]{0,80}68/.test(douyinSrc));
  ok('抖音 getContentShape 走 _isNoteWork（与 URL 同源）',
    /getContentShape\s*\(\s*\)\s*\{[\s\S]{0,200}_isNoteWork/.test(douyinSrc));
  const douyinModalSrc = fs.readFileSync(path.join(ROOT, 'src/content/extractors/douyin-modal.js'), 'utf8');
  ok('弹窗 extractUrl 也走 _isNoteWork（URL 与形态同源）',
    /extractUrl[\s\S]{0,1800}_isNoteWork/.test(douyinModalSrc));
  // 共享原型：这个方法每个站都会挂上，必须自带站点门禁
  ok('_isNoteWork 自带抖音站点门禁', /_isNoteWork[\s\S]{0,600}douyin\.com/.test(douyinSrc));

  // 主页不单独一档：TikTok 主页返回空串（落默认视频档），不能返回 'profile'
  ok('TikTok 主页不单开一档（返回空串而非 profile）',
    /if\s*\(this\._tkIsProfile\(\)\)\s*return\s*''/.test(tiktokSrc));

  /* ==================== 八、清单：manifest 注册了新文件 ==================== */
  section('八、清单：新文件必须进 manifest（否则浏览器里根本加载不到）');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const jsList = (manifest.content_scripts || []).reduce((acc, cs) => acc.concat(cs.js || []), []);
  ok('manifest 注册了 social-site-names.js',
    jsList.indexOf('src/content/shared/social-site-names.js') > -1);
  ok('social-site-names.js 排在 social-fields-builder.js 之前（先有词表再装配）',
    jsList.indexOf('src/content/shared/social-site-names.js') <
    jsList.indexOf('src/content/shared/social-fields-builder.js'));
  // 版本号在本项目里由 kuaishou-route / 小红书 / 快手主页 三处测试把关，这里不重复钉死。

  /* ==================== 九、兜底标记：不许污染数据，但熔断要看得见 ==================== */
  section('九、兜底标记：数据里看不见，熔断逻辑看得见');

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'douyin_social',
      extractPageText: () => '',
      getContentShape: () => 'video'
    }));
    eq('兜底时打了标记', rec[B.TEXT_FALLBACK_FLAG], true);
    eq('JSON.stringify 里看不见标记',
      JSON.stringify(rec).indexOf('__textFallback'), -1);
    eq('Object.keys 里看不见标记',
      Object.keys(rec).indexOf('__textFallback'), -1);
    eq('展开运算符拿不到标记',
      Object.assign({}, rec)['__textFallback'], undefined);
    eq('标记不改变字段数量（7 个模板字段 + mediaType / sourceSite）', Object.keys(rec).length, 9);
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'douyin_social',
      extractPageText: () => '真文案'
    }));
    eq('没兜底就不打标记', rec[B.TEXT_FALLBACK_FLAG], undefined);
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'unknown',
      extractPageText: () => ''
    }));
    eq('兜不出来（站点不认识）也不打标记', rec[B.TEXT_FALLBACK_FLAG], undefined);
  }

  // 熔断逻辑必须把「兜底文案」当成「没内容」：源码层面钉住这两处
  const modalSrc = fs.readFileSync(path.join(ROOT, 'src/content/extractors/douyin-modal.js'), 'utf8');
  const ksImmersiveSrc = fs.readFileSync(path.join(ROOT, 'src/content/extractors/kuaishou-immersive.js'), 'utf8');
  ok('抖音弹窗熔断认兜底标记',
    /TEXT_FALLBACK_FLAG[\s\S]{0,300}data\[fallbackFlag\]\s*===\s*true/.test(modalSrc));
  ok('快手沉浸流熔断认兜底标记',
    /TEXT_FALLBACK_FLAG[\s\S]{0,300}data\[fallbackFlag\]\s*===\s*true/.test(ksImmersiveSrc));

  /* ==================== 十、标题同步（v2.7.2 改成一步到位） ==================== */
  section('十、无文案时标题直接用兜底词生成（不再「先写占位词再替换」）');

  // 背景：标题处理器在文案为空时会写「无文案」占位词，于是出现过
  //   「本页文案=TikTok视频 / 本页标题=某人无文案-2026年10月21日125551」这种一半新一半旧。
  // v2.5.100 用一次正则把占位词换掉 —— 要按「无文案 + 紧跟 - 」去猜哪三个字是占位词，
  // 昵称里真带这三个字就会被改掉（「我的无文案」→「我的抖音视频」）。
  // v2.7.2 起：让提取器拿兜底词当文案**重新生成一次标题**，站别选项一个不少，也没有误伤。
  //
  // 真机标题形态（黄金样本 douyin-video-7411… 实测）：
  //   `昵称 + 文案前N字 + '-' + 日期`，段间**没有空格** —— 测试数据必须用这个形态，
  //   用 `a - b - c` 那种带空格的假数据会掩盖真实行为（本轮踩过一次）。
  const T_DATE = '2026年10月29日120000';
  const NICK = '某人';

  /**
   * 假的「标题生成」：模仿真机的拼法（文案为空 → 「无文案」占位），
   * 这样断言才测得到「重新生成」这一步，而不是拿硬编码字符串骗自己。
   */
  function titleFrom(nick, date) {
    return (t) => nick + (t ? t : '无文案') + '-' + date;
  }

  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'video'
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('文案兜底 → 标题用同一个兜底词重新生成',
      rec['本页标题'], NICK + 'TikTok视频-' + T_DATE);
    eq('标题里不再出现「无文案」', rec['本页标题'].indexOf('无文案'), -1);
    eq('标题与文案用的是同一个字符串（不会一边视频一边图文）',
      rec['本页标题'].indexOf(rec['本页文案']), NICK.length);
  }

  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      extractAuthorName: () => '某人',
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'photo'
    });
    ex.extractTitle = async () => titleFrom('某人', T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('图文档：标题用的是「TikTok图文」', rec['本页标题'], '某人TikTok图文-' + T_DATE);
  }

  {
    // v2.7.2 的关键回归：昵称里就带「无文案」三个字。
    // 旧正则会把它当成占位词换掉（「我的无文案」→「我的抖音视频」），把作者名改坏。
    const BAD_NICK = '我的无文案';
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'douyin_social',
      extractPageText: () => '',
      extractAuthorName: () => BAD_NICK,
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'video'
    });
    ex.extractTitle = async () => titleFrom(BAD_NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('昵称里带「无文案」→ 作者名一个字都不许改',
      rec['本页标题'].indexOf(BAD_NICK), 0);
    eq('昵称带「无文案」时标题仍是「昵称+兜底词-日期」',
      rec['本页标题'], BAD_NICK + '抖音视频-' + T_DATE);
  }

  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '真文案',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'video'
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('没触发兜底时标题一个字都不动', rec['本页标题'], NICK + '真文案-' + T_DATE);
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'unknown',
      extractPageText: () => '',
      extractTitle: () => NICK + '无文案-' + T_DATE
    }));
    eq('兜不出来（站点不认识）→ 标题保持原样，不编一个站名',
      rec['本页标题'], NICK + '无文案-' + T_DATE);
  }

  {
    // 标题不是我们生成的（有的站直接给 document.title），没有占位词就别动
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      extractTitle: () => '站方原样标题 - 抖音',
      getContentShape: () => 'video'
    }));
    eq('标题里没有占位词 → 不重生成，站方标题原样保留',
      rec['本页标题'], '站方原样标题 - 抖音');
    eq('文案照常兜底', rec['本页文案'], 'TikTok视频');
  }

  {
    const B = loadBuilder();
    const rec = await B.build(makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      extractTitle: () => undefined,     // 标题取不到
      getContentShape: () => 'video'
    }));
    eq('标题取不到也不崩（文案照常兜底）', rec['本页文案'], 'TikTok视频');
    eq('标题取不到 → 保持空', rec['本页标题'], '');
  }

  {
    // 重生成是临时打补丁：必须复原，不能把「取文案」的方法改成永久返回兜底词
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'tiktok_social',
      extractPageText: () => '',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'video'
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    await B.build(ex);
    eq('重生成后「取文案」方法还在（没被删掉）', typeof ex.extractPageText, 'function');
    eq('重生成后取到的还是原文案（不是永久返回兜底词）', await ex.extractPageText(), '');
  }

  // 源码层面钉住：不再有「替换占位词」的正则，改成调用重生成
  const builderSrc = fs.readFileSync(BUILDER_PATH, 'utf8');
  ok('源码里已经没有「替换无文案占位词」的正则',
    builderSrc.indexOf("replace(/无文案") === -1);
  // v2.7.38：原来这里是「if (fallbackText) 之后 900 字符内出现 rebuildTitleWith」的窗口断言，
  // 中间一加注释就被挤出窗口 → 变成假红。改成按**调用点**锚：
  // 用 `await rebuildTitleWith(`（定义那行是 `async function rebuildTitleWith(`，不会误命中），
  // 再要求它出现在「被洗光的判定」之后，保证重生成仍然长在兜底分支里。
  {
    const idxBlankCheck = builderSrc.indexOf('textBlankForTitle');
    const idxRebuildCall = builderSrc.indexOf('await rebuildTitleWith(');
    ok('兜底分支里改成调用 rebuildTitleWith（一步到位）',
      idxBlankCheck > -1 && idxRebuildCall > idxBlankCheck);
  }

  /* ==================== 十一、文案被标题过滤器洗光 → 站名顶上（v2.7.38） ==================== */
  section('十一、文案不空但被洗光（纯 emoji / 纯标点 / 纯日韩俄泰文）→ 标题用站名');

  // 用户 2026-11-01 拍板的两条：
  //   ① 无文案时标题要写「一支花Instagram帖子-2026年10月31日」，不是「一支花无文案-…」；
  //   ② 文案是纯 emoji / 纯标点 / 纯外文时，标题不能只剩「昵称-日期」，要让站名顶上；
  //      但「本页文案」列**保留原文** —— 那是作者真写的内容，抹掉就丢了。
  // 边界（用户已认可）：拉丁字母在白名单里，所以纯英文/法文/德文**不算**洗光，标题正常。

  // ---- 11.1 过滤规则本身：谁会被洗光，谁不会 ----
  eq('emoji 洗光', SocialTitleProcessor.filterTitleText('🎃🎃🎃'), '');
  eq('标点洗光', SocialTitleProcessor.filterTitleText('！！！？？…'), '');
  eq('日文假名洗光', SocialTitleProcessor.filterTitleText('こんにちは'), '');
  eq('韩文洗光', SocialTitleProcessor.filterTitleText('안녕하세요'), '');
  eq('俄文西里尔洗光', SocialTitleProcessor.filterTitleText('Привет'), '');
  eq('泰文洗光', SocialTitleProcessor.filterTitleText('สวัสดี'), '');
  ok('纯 emoji 判定为「洗光」', SocialTitleProcessor.isBlankAfterTitleFilter('🎃🎃🎃'));
  ok('纯标点判定为「洗光」', SocialTitleProcessor.isBlankAfterTitleFilter('。。。'));
  ok('纯日文判定为「洗光」', SocialTitleProcessor.isBlankAfterTitleFilter('ありがとう'));
  ok('空串算洗光', SocialTitleProcessor.isBlankAfterTitleFilter(''));
  ok('null 算洗光', SocialTitleProcessor.isBlankAfterTitleFilter(null));

  eq('英文原样保留（只压空格）', SocialTitleProcessor.filterTitleText('Hello World'), 'HelloWorld');
  ok('纯英文**不**算洗光（标题正常显示文字）',
    SocialTitleProcessor.isBlankAfterTitleFilter('Hello World') === false);
  ok('法文不算洗光',
    SocialTitleProcessor.isBlankAfterTitleFilter('Bonjour le monde') === false);
  eq('汉字+数字+短横线保留', SocialTitleProcessor.filterTitleText('中文-abc123'), '中文-abc123');
  eq('中英混排只删符号', SocialTitleProcessor.filterTitleText('今天 run 5km！'), '今天run5km');

  // ---- 11.2 装配器：洗光 → 标题用站名，文案列保留原文 ----
  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => '🎃🎃🎃',
      getContentShape: () => 'photo'
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('纯 emoji：本页文案保留原文（不许抹掉）', rec['本页文案'], '🎃🎃🎃');
    eq('纯 emoji：标题用 Instagram帖子 顶上',
      rec['本页标题'], NICK + 'Instagram帖子-' + T_DATE);
  }

  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'xiaohongshu_social',
      extractPageText: () => '。。。',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('纯标点：文案保留原文', rec['本页文案'], '。。。');
    eq('纯标点：标题用 小红书笔记 顶上',
      rec['本页标题'], NICK + '小红书笔记-' + T_DATE);
  }

  {
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'youtube_social',
      extractPageText: () => 'ありがとうございます',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('纯日文：文案保留原文', rec['本页文案'], 'ありがとうございます');
    eq('纯日文：标题用 YouTube视频 顶上',
      rec['本页标题'], NICK + 'YouTube视频-' + T_DATE);
  }

  {
    // 反向：纯英文不该被当成「洗光」，标题里不许塞站名
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => 'Hello World',
      extractAuthorName: () => NICK,
      extractPublishDate: () => T_DATE,
      getContentShape: () => 'photo'
    });
    ex.extractTitle = async () => titleFrom(NICK, T_DATE)(await ex.extractPageText());
    const rec = await B.build(ex);
    eq('纯英文：文案原样', rec['本页文案'], 'Hello World');
    eq('纯英文：标题不塞站名', rec['本页标题'], NICK + 'Hello World-' + T_DATE);
  }

  {
    // 端到端：用**真实**标题处理器 + 真实过滤，确认判定与真实输出对得上
    const B = loadBuilder();
    const ex = makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => '🎃🎃🎃',
      extractAuthorName: () => NICK,
      getContentShape: () => 'photo'
    });
    ex.extractTitle = () => SocialTitleProcessor.generatePageTitle(
      NICK, ex.extractPageText(), T_DATE, { platform: 'instagram' }, 'someone');
    const rec = await B.build(ex);
    eq('真实处理器：文案保留 emoji', rec['本页文案'], '🎃🎃🎃');
    ok('真实处理器：标题含「Instagram帖子」',
      String(rec['本页标题']).indexOf('Instagram帖子') > -1);
    eq('真实处理器：标题不再是「昵称-日期」那种空一截的形态',
      String(rec['本页标题']).indexOf(NICK + '-'), -1);
  }

  // ---- 11.3 IG 那种「外面把文案算好塞进标题」的写法：v2.7.38 的根因回归 ----
  //
  // Instagram 的 `extractTitle(pageText, context, meta)` 吃参数，文案由外面算好传进来。
  // 装配器原来只替换「取文案方法」，对它**完全无效** —— 真机标题一直是
  // 「一支花无文案-2026年10月31日」。v2.7.38 加了「包一层 extractTitle，把第一参数
  // 换成兜底词」，下面这条咬住它：去掉那 6 行包装，这里立刻变红。
  {
    const B = loadBuilder();
    const IG_NICK = '一支花';
    const IG_DATE = '2026年10月31日';
    const ex = makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => '',
      extractAuthorName: () => ''
    });
    // 完全照 IG 的写法：文案外面传、标题外面传、作者/日期全靠 meta
    ex.extractTitle = (pageText, ctx, meta) => {
      const nick = (meta && meta.authorName) || '未获取到作者';
      const t = (pageText === undefined || pageText === null) ? '' : pageText;
      return nick + (t || '无文案') + '-' + IG_DATE;
    };
    const rec = await B.build(ex, {
      overrides: {
        '本页标题': () => ex.extractTitle('', null, {
          authorName: IG_NICK, authorId: 'lossuxx', publishDate: IG_DATE
        }),
        '作者ID': 'lossuxx',
        '作者昵称': IG_NICK,
        '发布日期': IG_DATE,
        '本页文案': ''
      }
    });
    eq('IG 空文案：文案列填站名', rec['本页文案'], 'Instagram帖子');
    eq('IG 空文案：标题改成「昵称+站名+日期」',
      rec['本页标题'], IG_NICK + 'Instagram帖子-' + IG_DATE);
    eq('IG 空文案：标题里没有「无文案」',
      String(rec['本页标题']).indexOf('无文案'), -1);
  }

  {
    // 同一套机制服务「洗光」的那一档：IG 首页帖文案是 emoji 时也一样
    const B = loadBuilder();
    const IG_DATE = '2026年10月31日';
    const ex = makeExtractor({
      siteName: 'instagram_social',
      extractPageText: () => '',
      extractAuthorName: () => '',
      getContentShape: () => 'photo'
    });
    ex.extractTitle = (pageText, ctx, meta) => {
      const nick = (meta && meta.authorName) || '未获取到作者';
      const t = (pageText === undefined || pageText === null) ? '' : pageText;
      return nick + (t || '无文案') + '-' + IG_DATE;
    };
    const rec = await B.build(ex, {
      overrides: {
        '本页标题': () => ex.extractTitle('🎬🎬', null, {
          authorName: '小明', authorId: 'xm', publishDate: IG_DATE
        }),
        '作者ID': 'xm',
        '作者昵称': '小明',
        '发布日期': IG_DATE,
        '本页文案': '🎬🎬'
      }
    });
    eq('IG 纯 emoji：文案保留原文', rec['本页文案'], '🎬🎬');
    eq('IG 纯 emoji：标题用站名顶上', rec['本页标题'], '小明Instagram帖子-' + IG_DATE);
  }

  // ---- 11.4 规则只许有一份实现 ----
  {
    const src = fs.readFileSync(BUILDER_PATH, 'utf8');
    eq('装配器里没有复制标题过滤的 emoji 正则（规则只在 processor 里）',
      src.indexOf('\\u{1F600}'), -1);
    const proc = fs.readFileSync(TITLE_PATH, 'utf8');
    ok('processor 里 filterTitleText 被 generatePageTitle 调用（收尾走同一份）',
      /combinedTitle = SocialTitleProcessor\.filterTitleText\(combinedTitle\)/.test(proc));
    ok('wouldBeFilteredOut 也走 filterTitleText（不再自带一份正则）',
      /return SocialTitleProcessor\.filterTitleText\(testAuthor\) === '';/.test(proc));
  }

  /* ============================ 总结 ============================ */
  console.log(`\n${fail === 0 ? C.green : C.red}== 通过 ${pass} 项，失败 ${fail} 项 ==${C.reset}`);
  if (fail !== 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
