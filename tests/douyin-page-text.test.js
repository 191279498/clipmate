/**
 * 抖音「本页文案」SEO 尾巴清洗（v2.5.85）
 *
 * 背景：抖音 `/video/<id>` 详情页的 `meta[name="description"]` 是「真文案 + 自动拼的 SEO 尾巴」，
 * 而 `DouyinSocialExtractor.extractPageText()` 恰恰**只**读这一段（其他取法在早期版本已禁用）。
 * 于是详情页的「本页文案」会带出：
 *
 *   "<文案> - <作者昵称>于<8位日期>发布在抖音，已经收获了<N>[万亿]个喜欢，来抖音，记录美好生活！"
 *
 * 判断依据：「已经收获了…」用的是**作者的累计获赞**——2026-10-28 真机 4 条样本里，
 * 同一作者（佳片说）三条的获赞数完全相同（7988.6万），显系抖音自动拼接。
 *
 * 删法（用户确认：两刀法）：
 *   第 1 刀删尾句「，已经收获了…，来抖音，记录美好生活！」
 *   第 2 刀删作者段「 - 某作者于YYYYMMDD发布在抖音」
 *
 * 本文件钉住两组契约：
 *   A. 该删的删干净（4 条真机原样 + 若干变体）
 *   B. **不该删的一个字都不能少**（只从尾部裁、只认固定话术、没命中就原样）
 *
 * 反向验证（必须变红）：
 *   ① 删掉第 1 刀 → 尾句残留
 *   ② 删掉第 2 刀 → 作者段残留
 *   ③ 把两条正则的 `\s*$` 去掉 → 中间出现的同样文字会被误删（本文件第六节会红）
 *   ④ 把第 2 刀的 `.{1,80}?` 改回 v2.5.85 的 `[^-]{1,40}` → 昵称含连字符的 5 条全红（第八节）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m', yellow: '\x1b[33m'
};
let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function eqNoDetail(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)} / 实得 ${JSON.stringify(got)}`);
}
function contains(name, haystack, needle) {
  if (String(haystack).includes(needle)) return ok(name);
  bad(name, `应含 ${JSON.stringify(needle)}，实得 ${JSON.stringify(haystack)}`);
}
function notContains(name, haystack, needle) {
  if (!String(haystack).includes(needle)) return ok(name);
  bad(name, `不该含 ${JSON.stringify(needle)}，实得 ${JSON.stringify(haystack)}`);
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

/* -------------------------------------------------------------------------- */
/* 加载被测提取器（照 social-date-precision 的沙箱做法）                        */
/* -------------------------------------------------------------------------- */
function loadExtractor() {
  // 用最小的 window 桩：processPageText 是纯字符串函数，不碰 DOM
  const win = {
    BaseExtractor: class BaseExtractor { constructor() { this.siteName = ''; } },
    SocialDomUtils: { readMeta: () => '' },
    SocialFieldsBuilder: { build: async () => ({}) },
    SocialTitleProcessor: { generatePageTitle: () => '' },
    ClipMateLog: { debug() {}, warn() {}, info() {}, error() {} }
  };
  win.window = win;
  const prelude = 'var BaseExtractor = window.BaseExtractor, SocialDomUtils = window.SocialDomUtils, ' +
    'SocialFieldsBuilder = window.SocialFieldsBuilder, SocialTitleProcessor = window.SocialTitleProcessor, ' +
    'ClipMateLog = window.ClipMateLog;\n';
  const src = read('src/content/extractors/douyin-social.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'console', prelude + src)(win, {}, console);
  const Cls = win.DouyinSocialExtractor;
  if (!Cls) throw new Error('未定义 DouyinSocialExtractor');
  return new Cls();
}

/* -------------------------------------------------------------------------- */
/* 真机样本（2026-10-28 采集，4 条，形态完全一致）                              */
/* -------------------------------------------------------------------------- */
const REAL = [
  {
    id: '7700149338836369270',
    raw: '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈 - 小蜜蜂于20261024发布在抖音，已经收获了2.5万个喜欢，来抖音，记录美好生活！',
    want: '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈'
  },
  {
    id: '7696458346936716571',
    raw: '《亲爱的杀手》 底层微光里，两个残缺的人，替彼此活成一个明天。#佳片说  #了不起的精讲团 #影视万字精讲  #影视经典补完计划 - 佳片说于20261014发布在抖音，已经收获了7988.6万个喜欢，来抖音，记录美好生活！',
    want: '《亲爱的杀手》 底层微光里，两个残缺的人，替彼此活成一个明天。#佳片说 #了不起的精讲团 #影视万字精讲 #影视经典补完计划'
  },
  {
    id: '7686112625494707490',
    raw: '《出入平安》 孙大圣终是成了佛#佳片说   #影娱漫谈编辑部#长长长假电影时间 #影娱热点团 #我的假期观影报告 - 佳片说于20260916发布在抖音，已经收获了7988.6万个喜欢，来抖音，记录美好生活！',
    want: '《出入平安》 孙大圣终是成了佛#佳片说 #影娱漫谈编辑部#长长长假电影时间 #影娱热点团 #我的假期观影报告'
  },
  {
    id: '7699056194668793142',
    raw: '《冬天里》 人间入冬，再无春风，养儿防老，原来只是一场美梦#佳片说 #了不起的精讲团 #影视万字精讲 #影视经典补完计划 - 佳片说于20261021发布在抖音，已经收获了7988.6万个喜欢，来抖音，记录美好生活！',
    want: '《冬天里》 人间入冬，再无春风，养儿防老，原来只是一场美梦#佳片说 #了不起的精讲团 #影视万字精讲 #影视经典补完计划'
  }
];

function main() {
  const ex = loadExtractor();
  const P = (t) => ex.processPageText(t);

  console.log(`${C.cyan}抖音「本页文案」SEO 尾巴清洗（v2.5.85）${C.reset}`);

  /* ============================ 一、真机原样 ============================ */
  section('一、4 条真机原样：尾巴必须删干净');
  for (const s of REAL) {
    const got = P(s.raw);
    eq(`[${s.id}] 只剩纯文案`, got, s.want);
    notContains(`[${s.id}] 不含「发布在抖音」`, got, '发布在抖音');
    notContains(`[${s.id}] 不含「记录美好生活」`, got, '记录美好生活');
    notContains(`[${s.id}] 不含「已经收获了」`, got, '已经收获了');
  }

  /* ====================== 二、没有尾巴时一个字不动 ====================== */
  section('二、本来就没有尾巴（推荐流 / 弹窗场景）：必须原样返回');
  const clean = [
    '#日常软妹风ootd #红色系舞蹈穿搭 #篮球啦啦队舞蹈',
    '他只是想装个B而已 #搞笑',
    '这是一条很普通的文案，没有任何后缀',
    '文案里带个连字符 - 但不是尾巴',
    '把「来抖音，记录美好生活」放在开头测试一下'
  ];
  for (const t of clean) {
    eq(`原样：${t.slice(0, 18)}…`, P(t), t);
  }

  /* ======================= 三、第 1 刀的形态变体 ======================= */
  section('三、尾句形态变体：只要命中固定话术就该删');
  eq('无「万」字的获赞数（1000个喜欢）',
    P('文案内容 - 张三于20260101发布在抖音，已经收获了1000个喜欢，来抖音，记录美好生活！'),
    '文案内容');
  eq('「亿」级获赞数',
    P('文案内容 - 张三于20260101发布在抖音，已经收获了1.2亿个喜欢，来抖音，记录美好生活！'),
    '文案内容');
  eq('感叹号换成半角 !',
    P('文案内容 - 张三于20260101发布在抖音，已经收获了88万个喜欢，来抖音，记录美好生活!'),
    '文案内容');
  eq('句尾带空格',
    P('文案内容 - 张三于20260101发布在抖音，已经收获了88万个喜欢，来抖音，记录美好生活！   '),
    '文案内容');

  /* ==================== 四、只有尾句、没有作者段 ==================== */
  section('四、只有尾句没有作者段：只删尾句，别动文案');
  eq('只有「已经收获了…来抖音…」',
    P('纯文案内容，已经收获了2.5万个喜欢，来抖音，记录美好生活！'),
    '纯文案内容');

  /* ==================== 五、只有作者段、没有尾句 ==================== */
  section('五、只有作者段没有尾句：第 2 刀独立也能裁干净（两刀互不依赖）');
  // 两刀各自锚定结尾、各自命中各自的话术，不要求同时命中。
  // 好处：抖音哪天改了尾句话术，作者段那条规则照样能把尾巴削掉。
  // 坏处不存在：若尾句在而作者段不在末尾，第 2 刀天然不命中，不会留半截。
  eq('只有作者段 → 裁掉作者段',
    P('纯文案内容 - 张三于20260101发布在抖音'),
    '纯文案内容');

  /* ============ 六、中间出现同样文字：绝对不许删（只从尾部裁） ============ */
  section('六、文字出现在中间（不是尾部）：一个字都不能删');
  const mid1 = '他说「来抖音，记录美好生活」这句话挺洗脑的 #日常';
  eq('中间出现「来抖音，记录美好生活」', P(mid1), mid1);

  const mid2 = '这段文案提到了某人于20260101发布在抖音的事情，但不是尾巴 #话题';
  eq('中间出现「于…发布在抖音」', P(mid2), mid2);

  const mid3 = '前面一段 - 中间一段 - 后面还有内容';
  eq('中间多个「 - 」但不含抖音话术', P(mid3), mid3);

  // ⚠️ 这条才是真正检验「只从尾部裁」的用例：
  // 文案**中间**完整出现了那句抖音话术（含 ` - ` 与「已经收获了…记录美好生活！」），后面还跟着真内容。
  // 有 `\s*$` 锚 → 一个字都不动；去掉锚 → 中间那一大段会被削掉。
  // （上面两条 mid1 / mid2 只验证了「缺前置词就不命中」，区分不出锚点的作用，2026-10-28 反向验证抓到。）
  const mid4 = '开头是真文案 - 张三于20260101发布在抖音，已经收获了1万个喜欢，来抖音，记录美好生活！后面还有真内容 #话题';
  eq('中间完整出现整句话术 + 后面还有内容 → 一个字都不动', P(mid4), mid4);

  /* ====================== 七、边界：空值、空白、截断 ====================== */
  section('七、边界条件');
  eq('null', P(null), '');
  eq('空串', P(''), '');
  eq('纯空白', P('   \n\t  '), '');
  eq('undefined', P(undefined), '');

  const long = '很长的文案'.repeat(60); // 300 字
  const cut = P(long);
  eq('超 200 字被截断加省略号', cut.endsWith('...'), true);
  eq('截断长度 = 200 + 3', cut.length, 203);

  // 带尾巴 + 超长：先删尾巴再截断，尾巴不该占掉 200 字名额
  const longWithTail = '很长的文案'.repeat(60) + ' - 张三于20260101发布在抖音，已经收获了1万个喜欢，来抖音，记录美好生活！';
  const cut2 = P(longWithTail);
  notContains('超长 + 尾巴：尾巴先被删掉', cut2, '记录美好生活');
  eq('超长 + 尾巴：截断仍是 203', cut2.length, 203);

  /* ============ 八、作者昵称含连字符：v2.5.90 起必须裁干净 ============ */
  section('八、作者昵称含连字符 / 空格 / 点号：v2.5.90 起必须裁干净');
  // 历史：v2.5.85 的第 2 刀写的是 `\s+-[^-]{1,40}?于\d{8}发布在抖音`，
  // `[^-]` 要求昵称里没有连字符 —— 真机「米雷-RayDog」一带 `-` 整条正则就失效，
  // 浮窗里留下 ` - 米雷-RayDog于20261002发布在抖音` 这种半截尾巴（v2.5.90 报告里的 bug B）。
  // 现在 `[^-]{1,40}` 换成 `.{1,80}?`（只从尾部锚定、非贪婪），下面 5 条必须全绿。
  const dashCases = [
    ['昵称含 1 个连字符', '文案内容 - 米雷-RayDog于20261002发布在抖音，已经收获了1234.5万个喜欢，来抖音，记录美好生活！', '文案内容'],
    ['昵称含 2 个连字符', '文案内容 - Ray-Dog-Studio于20261002发布在抖音，已经收获了1万个喜欢，来抖音，记录美好生活！', '文案内容'],
    ['昵称含连字符 + 只有作者段', '文案内容 - 米雷-RayDog于20261002发布在抖音', '文案内容'],
    ['昵称含空格与点号', '文案内容 - Mr. Wang 老王于20261002发布在抖音', '文案内容'],
    ['超长昵称（>40 字）', '文案内容 - ' + '很长昵称'.repeat(12) + '于20261002发布在抖音', '文案内容']
  ];
  for (const [name, raw, want] of dashCases) {
    eq(name, P(raw), want);
  }

  // 放宽正则后仍必须守住「只从尾部裁」：中间完整出现含连字符的作者段 + 后面还有真内容 → 一个字不动
  const midDash = '开头是真文案 - 米雷-RayDog于20261002发布在抖音，已经收获了1万个喜欢，来抖音，记录美好生活！后面还有真内容 #话题';
  eq('中间出现含连字符的整句话术 + 后面还有内容 → 一个字都不动', P(midDash), midDash);

  /* ============================== 汇总 ============================== */
  console.log('');
  if (fail === 0) {
    console.log(`${C.green}通过 ${pass} 项，失败 0 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}通过 ${pass} 项，失败 ${fail} 项${C.reset}`);
    process.exit(1);
  }
}

main();
