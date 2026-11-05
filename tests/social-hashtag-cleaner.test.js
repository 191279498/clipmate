/**
 * 社交文案的话题清理（v2.6.1）
 *
 * 用户要求（2026-10-29）
 * --------------------
 * 「本页文案提取到的文本中，如果有包含话题类的标签例如 #ABC 这类，都需要去掉 # 号，
 *   需变为 ABC 这样。」追问后拍板两件事：
 *   · `#` **和** `[话题]` 标记一起去掉（只去 # 会剩下 `万万没想到[话题]`，等于没洗干净）；
 *   · **所有社交站**都改，不只小红书。
 *
 * 为什么不能只写一行 `replace(/#/g,'')`
 * ------------------------------------
 * 两种真实形态（都是实测原文，不是推测）：
 *   小红书：`…#万万没想到[话题]# #沙发[话题]##少爷[话题]#`   ← API 自带 [话题]，紧邻时没空格
 *   抖音等：`…#送TA上精选 #抖音精选`                        ← 裸 `#` 加名字
 * 只删 `#` → `万万没想到[话题] 沙发[话题]少爷[话题]`，`[话题]` 还在，且紧邻话题会粘连。
 * 顺序也不能反：先啃「带 [话题] 的整块」（能顺带补空格），再删剩下的裸 `#`。
 *
 * 本文件钉住的契约
 * ----------------
 *   A. 小红书形态：`#名称[话题]#` 整块清成名字，紧邻话题之间补空格不粘连
 *   B. 抖音/快手/TikTok 形态：裸 `#名称` 只删井号，名字与相邻文字一字不动
 *   C. 不误伤：非话题的 `@提及`、行尾孤立 `#`、换行、单空格一律原样
 *   D. 幂等 + 类型安全：洗两遍结果一样；非字符串原样返回、不抛错
 *   E. stripFields：只动「本页文案」「本页标题」「人物简介」，别的字段与字段集一字不动
 *   F. 结构：调用点在 processData 之后、写缓存之前，且有「社交 + 人物」门禁与「脚本没加载」守卫
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const CLEANER_PATH = path.join(ROOT, 'src/content/utils/social-hashtag-cleaner.js');
const MAIN_PATH = path.join(ROOT, 'src/content/content-main.js');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const TITLE_PATH = path.join(ROOT, 'src/content/shared/social-title-processor.js');

const Cleaner = require(CLEANER_PATH);
// 标题处理器在浏览器里靠全局变量找 cleaner，这里手动挂到 global 上，模拟真实加载环境。
global.SocialHashtagCleaner = Cleaner;
const { SocialTitleProcessor } = require(TITLE_PATH);
const TITLE_SRC = fs.readFileSync(TITLE_PATH, 'utf8');
const MAIN_SRC = fs.readFileSync(MAIN_PATH, 'utf8');
const MANIFEST_RAW = fs.readFileSync(MANIFEST_PATH, 'utf8');
const MANIFEST = JSON.parse(MANIFEST_RAW);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function truthy(name, got) { if (got) return ok(name); else bad(name, `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got) { if (!got) return ok(name); else bad(name, `期望假值，实得 ${JSON.stringify(got)}`); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/* ==================== 真实原文样本（实测，不是编的） ==================== */

// 小红书一手 desc 原文（2026-10-29 无头真机 dump）
const XHS_RAW = '终于理解电视剧里的少爷为什么老睡沙发了#万万没想到[话题]# #沙发[话题]##少爷[话题]#';
const XHS_WANT = '终于理解电视剧里的少爷为什么老睡沙发了 万万没想到 沙发 少爷';

// 抖音精选图文文案（tests/golden 基线原文）
const DY_NOTE_RAW = '6月16日-6月30日，「送TA上精选」把选择权交给你，快来为你支持的创作者投票吧！#送TA上精选 #抖音精选';
const DY_NOTE_WANT = '6月16日-6月30日，「送TA上精选」把选择权交给你，快来为你支持的创作者投票吧！送TA上精选 抖音精选';

// 抖音用户视频文案（含 @ 提及，必须原样保留）
const DY_AT_RAW = '精选开放麦第三期上线啦！一起看五位“航海家”@Olga姐姐 @李娃娃 @造梦小懿 @米雪食记 @米雷-RayDog 如何寻找人生“新大陆”！#抖音精选 #精选开放麦';

/* ==================== A. 小红书形态 ==================== */
section('A. 小红书形态（`#名称[话题]#`）');

eq('整条文案洗成干净的句子', Cleaner.strip(XHS_RAW), XHS_WANT);
falsy('结果里不再有井号', Cleaner.strip(XHS_RAW).indexOf('#') > -1);
falsy('结果里不再有 [话题] 标记', Cleaner.strip(XHS_RAW).indexOf('[话题]') > -1);
eq('紧邻话题（中间没空格）不粘连',
  Cleaner.strip('#沙发[话题]##少爷[话题]#'), '沙发 少爷');
eq('开头就是话题也不留前导空格',
  Cleaner.strip('#万万没想到[话题]# 后面是正文'), '万万没想到 后面是正文');
eq('句尾就是话题也不留尾随空格',
  Cleaner.strip('正文在这里 #尾巴[话题]#'), '正文在这里 尾巴');
eq('空话题（#[话题]#）清成空串',
  Cleaner.strip('#[话题]#'), '');
eq('话题名里的英文/数字/下划线/emoji 都保留',
  Cleaner.strip('#OOTD_2026[话题]# #穿搭分享[话题]# #🔥[话题]#'), 'OOTD_2026 穿搭分享 🔥');
eq('多行文案每行各自清，换行不丢',
  Cleaner.strip('第一段 #话题A[话题]#\n第二段 #话题B[话题]#'),
  '第一段 话题A\n第二段 话题B');

/* ==================== B. 抖音 / 快手 / TikTok 形态 ==================== */
section('B. 裸 `#` 形态（抖音 / 快手 / TikTok）');

eq('抖音图文文案', Cleaner.strip(DY_NOTE_RAW), DY_NOTE_WANT);
eq('中文标点后紧跟话题也不留空格',
  Cleaner.strip('投票吧！#抖音精选'), '投票吧！抖音精选');
eq('话题在句首', Cleaner.strip('#好剧推荐 真的好看'), '好剧推荐 真的好看');
eq('多个话题连续', Cleaner.strip('文案 #甲 #乙 #丙'), '文案 甲 乙 丙');
eq('话题后面紧跟正文（无空格）也不粘连拆错',
  Cleaner.strip('文案 #甲 后面还有字'), '文案 甲 后面还有字');

const dyAt = Cleaner.strip(DY_AT_RAW);
falsy('@ 提及原样保留（不许被当成话题）', dyAt.indexOf('@Olga姐姐') < 0);
falsy('@ 提及原样保留（第二条）', dyAt.indexOf('@米雷-RayDog') < 0);
falsy('结果里不再有井号', dyAt.indexOf('#') > -1);
eq('只删两处井号，其余一字不动',
  dyAt,
  DY_AT_RAW.replace('#抖音精选', '抖音精选').replace('#精选开放麦', '精选开放麦'));

/* ==================== C. 不误伤 ==================== */
section('C. 不误伤');

// 注意：全角「＃」不是话题符号（小红书/抖音都用半角），不在清理范围内
eq('没有半角井号的文案一个字符都不变（全角＃不算话题）',
  Cleaner.strip('普通文案，没有任何话题。＃不是井号是全角'), '普通文案，没有任何话题。＃不是井号是全角');
eq('行尾孤立的井号当标点留着（后面没有任何字符）',
  Cleaner.strip('文案结尾 #'), '文案结尾 #');
eq('单独一个井号行', Cleaner.strip('#'), '#');
// 有意为之：没有话题就**一个字符都不碰**（不 trim、不压空格）。
// 文案在进入这里之前已经过 extractPageText 的 cleanTextContent（trim + 压空格），
// 这里再动一遍只会引入「同一段文案在两个站显示不一样」的风险。
eq('没有话题时连首尾空白都不碰（够用即可，别多事）', Cleaner.strip('  前后  '), '  前后  ');
eq('含话题时顺带把多余空格压成一个', Cleaner.strip('前  #话题  后'), '前 话题 后');
eq('含话题时首尾空白被去掉', Cleaner.strip('  #话题  '), '话题');
eq('换行原样保留（不做跨行拼接）', Cleaner.strip('一\n二\n三'), '一\n二\n三');
eq('行内空格不被吃掉（正文正常断句）',
  Cleaner.strip('这句话 有空格 都在'), '这句话 有空格 都在');
eq('残留的 [话题] 当分隔符处理', Cleaner.strip('前文[话题]后文'), '前文 后文');

/* ==================== D. 幂等与类型安全 ==================== */
section('D. 幂等与类型安全');

eq('同一条文案洗两遍结果一样（小红书）', Cleaner.strip(Cleaner.strip(XHS_RAW)), XHS_WANT);
eq('同一条文案洗两遍结果一样（抖音）', Cleaner.strip(Cleaner.strip(DY_NOTE_RAW)), DY_NOTE_WANT);
eq('三遍也一样', Cleaner.strip(Cleaner.strip(Cleaner.strip(XHS_RAW))), XHS_WANT);
eq('null 返回空串', Cleaner.strip(null), '');
eq('undefined 返回空串', Cleaner.strip(undefined), '');
eq('空串返回空串', Cleaner.strip(''), '');
eq('数字原样返回（不硬转字符串、不抛错）', Cleaner.strip(123), 123);
truthy('对象不会让函数抛错', (() => { try { Cleaner.strip({ a: 1 }); return true; } catch (e) { return false; } })());

/* ==================== E. stripFields ==================== */
section('E. stripFields：只动文案字段（本页文案 / 本页标题 / 人物简介）');

const data = {
  '本页文案': DY_NOTE_RAW,
  '本页标题': '名字投票吧送TA上精选-2026年06月16日1200',
  '作者ID': '#12345',
  'URL': 'https://www.douyin.com/note/7516480886684568891',
  '作者昵称': '率风影视'
};
const before = Object.keys(data).length;
Cleaner.stripFields(data);
eq('本页文案被清', data['本页文案'], DY_NOTE_WANT);
eq('本页标题被清（标题由文案前 20 字拼成，会带同一个井号）',
  Cleaner.stripFields({ '本页标题': '#话题 后面' })['本页标题'], '话题 后面');
eq('作者ID 里的井号不动（不是文案字段）', data['作者ID'], '#12345');
eq('作者昵称一字不动', data['作者昵称'], '率风影视');
eq('字段数没变（不新增、不删字段）', Object.keys(data).length, before);

const noFields = { 'URL': 'x' };
Cleaner.stripFields(noFields);
falsy('本来就没有文案字段时不凭空造字段', '本页文案' in noFields);
eq('传入 null 不抛错', Cleaner.stripFields(null), null);
eq('传入字符串不抛错', Cleaner.stripFields('abc'), 'abc');

// v2.7.15：人物档案的「简介」并进来。用户 2026-10-30 拍板「签名里的 #话题 不豁免」，
// 抖音作者签名里的话题标签走同一套规则 —— 保留话题名、去掉井号。
const personBio = { '平台': '抖音', '昵称': '某人', '简介': '粉丝：1640 · 获赞：2.9万 · IP属地：吉林\n#日常 vlog 记录 #生活' };
Cleaner.stripFields(personBio);
eq('人物简介里的话题去井号（#话题 不豁免）', personBio['简介'],
  '粉丝：1640 · 获赞：2.9万 · IP属地：吉林\n日常 vlog 记录 生活');
eq('统计行与换行原样保留', personBio['简介'].split('\n').length, 2);
eq('人物简介清理幂等（洗两遍一样）',
  Cleaner.stripFields({ '简介': personBio['简介'] })['简介'], personBio['简介']);
eq('没有井号的简介一字不动',
  Cleaner.stripFields({ '简介': '闺蜜 @甲 不会找别的闺蜜\n（不处谢谢）' })['简介'],
  '闺蜜 @甲 不会找别的闺蜜\n（不处谢谢）');
eq('Markdown 链接不被破坏（签名里的 @ 链接还得能点）',
  Cleaner.stripFields({ '简介': '小号：[@樱崽](https://www.douyin.com/user/MS4wABC)' })['简介'],
  '小号：[@樱崽](https://www.douyin.com/user/MS4wABC)');

/* ==================== F. 接线与结构 ==================== */
section('F. 接线（content-main / manifest）');

const iProcess = MAIN_SRC.indexOf('const processedData = await this.processData(universalData, mediaType);');
const iClean = MAIN_SRC.indexOf('SocialHashtagCleaner.stripFields(processedData)');
const iCache = MAIN_SRC.indexOf('this.cache.set(this.cacheKey, processedData)');
truthy('content-main 里调了 SocialHashtagCleaner.stripFields', iClean > -1);
truthy('在 processData 之后（processedData 得先有值）', iProcess > -1 && iClean > iProcess);
truthy('在写缓存之前（缓存里存的必须是洗干净的结果）', iCache > -1 && iClean < iCache);
truthy('对社交站与人物档案生效（v2.7.15 起把 person 并进来，其他类型不碰）',
  /if \(\(mediaType === 'social' \|\| mediaType === 'person'\) && typeof SocialHashtagCleaner !== 'undefined'\)/.test(MAIN_SRC));
truthy('脚本没加载时不崩（typeof 守卫）', MAIN_SRC.indexOf("typeof SocialHashtagCleaner !== 'undefined'") > -1);
truthy('清理抛错不连累整张表（try/catch + warn）',
  /catch \(e\) \{\s*\n\s*ClipMateLog\.warn\('\[文案清理\]/.test(MAIN_SRC));

const jsList = (MANIFEST.content_scripts || []).reduce((acc, cs) => acc.concat(cs.js || []), []);
const iCleanerJs = jsList.indexOf('src/content/utils/social-hashtag-cleaner.js');
const iMainJs = jsList.indexOf('src/content/content-main.js');
truthy('manifest 加载了 social-hashtag-cleaner.js', iCleanerJs > -1);
truthy('在 content-main.js 之前加载（否则第一屏提取会读不到）',
  iCleanerJs > -1 && iMainJs > -1 && iCleanerJs < iMainJs);
truthy('cleaner 文件本身在磁盘上', fs.existsSync(CLEANER_PATH));

eq('版本号已升到 2.12.0', MANIFEST.version, '2.12.1');

/* ==================== G. 标题也要干净 ==================== */
section('G. 标题生成：先洗文案再截「前 20 字」');

// 标题最后会过一道 `replace(/[^\u4e00-\u9fff0-9a-zA-Z-]/g, '')`，
// 它删掉 `#` `[` `]` 却**保留汉字**，于是 `#vlog[话题]#` 会变成 `vlog话题` ——
// 井号没了、「话题」两字还在，而这两字根本不是作者写的。
// 实测反例（v2.6.1 修之前）：`已婚且当妈了结婚太累了以后不结了vlog话题-2026年09月16日121608`
const titleWithTopic = SocialTitleProcessor.generatePageTitle(
  '已婚且当妈了',
  '#vlog[话题]# #恋爱[话题]# 结婚太累了 以后不结了',
  '2026/09/16 12:16:08'
);
falsy('标题里没有「话题」二字（[话题] 过滤后的残渣）', titleWithTopic.indexOf('话题') > -1);
falsy('标题里没有井号', titleWithTopic.indexOf('#') > -1);
truthy('标题里保留话题本身的词（vlog / 恋爱）',
  titleWithTopic.indexOf('vlog') > -1 && titleWithTopic.indexOf('恋爱') > -1);
truthy('标题仍以昵称开头', titleWithTopic.indexOf('已婚且当妈了') === 0);
truthy('标题仍以「-日期到秒」结尾', /-\d{4}年\d{2}月\d{2}日\d{6}$/.test(titleWithTopic));

const titleNoTopic = SocialTitleProcessor.generatePageTitle(
  '某个作者', '这是一段没有话题的普通文案', '2026/09/16 12:16:08'
);
truthy('没有话题的文案，标题行为不变（不被清洗影响）',
  titleNoTopic.indexOf('某个作者') === 0 && titleNoTopic.indexOf('这是一段没有话题的普通文案') > -1);

truthy('标题处理器在截取前先洗文案', /sourceText = SocialHashtagCleaner\.strip\(pageText\)/.test(TITLE_SRC));
truthy('标题处理器有 typeof 守卫（脚本没加载也不崩）',
  TITLE_SRC.indexOf("typeof SocialHashtagCleaner !== 'undefined'") > -1);
truthy('洗文案抛错时回落原文（不连累标题）',
  /catch \(e\) \{\s*\n\s*sourceText = pageText;/.test(TITLE_SRC));

/* ==================== H. 下划线要保留（v2.7.42） ==================== */
section('H. 下划线属于账号名的合法字符，标题里不许洗掉');

// 用户 2026-11-01 拍板「下划线要保留，选 A」。
// 起因：微博超话帖昵称列是 `Gufei_GF`，标题里被洗成 `GufeiGF`，同一条记录两处对不上。
// 下划线和短横线同等对待 —— 但**不能**变成短横线，也不能顺手把别的符号也留下。
eq('昵称里的下划线原样保留', SocialTitleProcessor.filterTitleText('Gufei_GF'), 'Gufei_GF');
eq('下划线不被换成短横线', SocialTitleProcessor.filterTitleText('a_b'), 'a_b');
eq('首尾下划线也保留', SocialTitleProcessor.filterTitleText('_abc_'), '_abc_');
eq('汉字+下划线混排保留', SocialTitleProcessor.filterTitleText('中文_abc'), '中文_abc');
eq('下划线不会让文案被误判成「洗光」',
  SocialTitleProcessor.isBlankAfterTitleFilter('_'), false);
// 反方向把闸：白名单**没有**放宽成「什么都留」
eq('点号仍然删掉', SocialTitleProcessor.filterTitleText('ab.cd'), 'abcd');
eq('冒号/@/井号仍然删掉', SocialTitleProcessor.filterTitleText('a:b@c#d'), 'abcd');
eq('全角括号仍然删掉', SocialTitleProcessor.filterTitleText('（abc）'), 'abc');

{
  const t = SocialTitleProcessor.generatePageTitle('Gufei_GF', '超话正文内容', '2026/11/01 12:30');
  truthy('标题以带下划线的昵称开头', t.indexOf('Gufei_GF') === 0);
  truthy('标题里的昵称没被洗成 GufeiGF', t.indexOf('GufeiGF-') === -1);
  truthy('标题尾部日期仍在', /-2026年11月01日1230$/.test(t));
}

/* ==================== 总结 ==================== */
console.log('\n' + '='.repeat(52));
if (fail === 0) {
  console.log(`== 通过 ${pass} 项，失败 0 项 ==`);
} else {
  console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
  failures.forEach((f) => console.log('  ✗ ' + f));
}
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
