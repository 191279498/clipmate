/**
 * 简介截断：人物档案不许被 500 字砍掉（v2.7.15）
 *
 * 事故现场（2026-10-30 真机，抖音作者主页）：
 *   简介 = 「粉丝：1643 · 获赞：2.9万 · IP属地：吉林」+ 签名，共 575 字
 *   `data-processors.processCommonFields` 一刀切到 500 字 →
 *   后半句「都是自己剪的视频 …（不处谢谢）」没了，
 *   而且切点正好落在 `[@樱崽.悸筱心肝](https://…MS4wLjABAAAA_bnol66rpOjMDbRgQNObz2M_26gE` 的 URL 中间，
 *   渲染层的链接正则匹配不到闭合 `)`，浮窗里直接露出半截 Markdown。
 *   用户看到的就是「还是没有提取完整」。
 *
 * 这个文件钉四件事：
 *   A. `truncateRichText` 不会把 Markdown 链接切一半（切点落 URL 内 → 整条不要）
 *   B. 人物档案（6 列 / 12 列）的简介**不按 500 截**
 *   C. 非人物类型维持 500 —— 不许因为这次修改把影视/书籍的简介惯性放长
 *   D. 社交账号（6 列）**不限字数**，只留 5 万字防炸上限；影人仍 5000（v2.7.33 用户定）
 *
 * 取样：`tests/fixtures/douyin/ssr-user-home-1.txt`（真机 SSR 块）+ 2026-10-30 真机浮窗原文。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function truthy(name, cond, detail) { if (cond) ok(name); else bad(name, detail); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}
function section(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

/** 按 manifest 顺序把三个模块装进一个空页面（media-types 必须最先，它提供字段清单） */
function makeEnv() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://www.douyin.com/user/x',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  for (const rel of [
    'src/shared/config/media-types.js',
    'src/content/utils/data-formatters.js',
    'src/content/utils/data-processors.js'
  ]) {
    w.eval(fs.readFileSync(P(rel), 'utf8'));
  }
  return w;
}

/** 最小可用的 this（processCommonFields 只用到 truncateText / formatRating） */
function makeHost(w) {
  return {
    truncateText: w.DataFormatters.truncateText,
    formatRating: (v) => v
  };
}

/* 真机 SSR 块：desc 115 字，拼出来的 Markdown 547 字 */
const SSR = require(P('src/content/extractors/douyin-profile-ssr.js'));
const SSR_BLOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'douyin', 'ssr-user-home-1.txt'), 'utf8');
const SEC = 'MS4wLjABAAAATeeWHaXZ7dWwyDuDEOZAXpKT2EWH2pdixzq9cU3cBkZstCaNaPwYy724UjSZPxMZ';
const user = SSR.readProfile({ querySelectorAll: () => [{ textContent: SSR_BLOCK }] }, SEC);
const SIGNATURE_MD = SSR.buildRichText(user.desc, user.descExtra);
const STATS = '粉丝：1643 · 获赞：2.9万 · IP属地：吉林';
/** 真机浮窗里被砍到的位置，末尾就是这一串（后面本来还有 75 字） */
const CUT_MARK = 'MS4wLjABAAAA_bnol66rpOjMDbRgQNObz2M_26gE';

(async function main() {

  /* ==================== 0. 样本自检 ==================== */
  section('0. 样本必须先站得住');

  truthy('SSR 解析到签名（115 字）', user && user.desc && user.desc.length > 100, '拿不到 SSR 样本，后面的断言全没意义');
  truthy('拼出的 Markdown 是 500～600 字之间（正好落在旧上限之外、又是真实量级）',
    SIGNATURE_MD.length > 500 && SIGNATURE_MD.length < 600, '实际 ' + SIGNATURE_MD.length);
  const SCENE = STATS + '\n' + SIGNATURE_MD;
  truthy('事故原文总长 > 500（否则复现不了这次截断）', SCENE.length > 500, '实际 ' + SCENE.length);
  truthy('事故原文本身含 4 条 Markdown 链接',
    (SCENE.match(/\]\(https:\/\/www\.douyin\.com\/user\//g) || []).length === 4);
  truthy('末尾那句「（不处谢谢）」在样例里', SCENE.indexOf('（不处谢谢）') > -1);

  /* ==================== 1. truncateRichText：不切坏链接 ==================== */
  section('1. truncateRichText —— 切点绝不落在链接 URL 里');

  const w = makeEnv();
  const F = w.DataFormatters;
  truthy('DataFormatters.truncateRichText 已暴露', typeof F.truncateRichText === 'function');

  eq('不超长 → 原样返回（不加省略号）', F.truncateRichText('短文本', 500), '短文本');
  eq('空值原样返回', F.truncateRichText('', 500), '');
  eq('非字符串原样返回', F.truncateRichText(null, 500), null);

  // 切点落在 URL 中间：按旧规则会得到半截 `[@乙](https://...ab`，新规则必须整条丢掉
  const WITH_LINK = '前缀' + 'x'.repeat(10) + '[@乙](https://example.com/very/long/path/abcdefghij)';
  const CUT_INSIDE_URL = 10 + 2 + 10; // 落在 `https://exa…` 里面
  const outInside = F.truncateRichText(WITH_LINK, CUT_INSIDE_URL);
  truthy('切点在 URL 内 → 输出里没有半截链接',
    outInside.indexOf('](') === -1, JSON.stringify(outInside));
  truthy('切点在 URL 内 → 保留前面的普通文字',
    outInside.indexOf('前缀') === 0, JSON.stringify(outInside));
  truthy('切点在 URL 内 → 仍带省略号', /\.\.\.$/.test(outInside), JSON.stringify(outInside));

  // 切点落在链接**之后**的普通文字里：链接是完整的，照常截断即可
  const AFTER_LINK = '[@乙](https://e.com/a) 后半段文字很长很长很长';
  const outAfter = F.truncateRichText(AFTER_LINK, 25);
  truthy('切点在链接之后 → 链接保持完整', outAfter.indexOf('[@乙](https://e.com/a)') === 0, JSON.stringify(outAfter));

  // 旧实现拿这个场景会产出坏数据，这里钉死它不再出现
  truthy('反例守卫：旧实现会切出半截链接（确认样本真的有杀伤力）',
    WITH_LINK.substring(0, CUT_INSIDE_URL).indexOf('](') > -1 &&
    WITH_LINK.substring(0, CUT_INSIDE_URL).indexOf(')', WITH_LINK.substring(0, CUT_INSIDE_URL).indexOf('](')) === -1);

  /* ==================== 2. 人物档案：575 字简介必须完整 ==================== */
  section('2. 人物档案（6 列）→ 简介不按 500 截');

  const host = makeHost(w);
  const personData = {
    '平台': '抖音',
    '昵称': '恨海情天.',
    '账号ID': SEC,
    '账号名': '77560001305',
    '网址': 'https://www.douyin.com/user/' + SEC,
    '简介': SCENE
  };
  w.DataProcessors.processCommonFields.call(host, personData);

  eq('人物简介一字不丢（长度与原文一致）', personData['简介'].length, SCENE.length);
  truthy('末尾「（不处谢谢）」还在', personData['简介'].indexOf('（不处谢谢）') > -1,
    '尾部=' + JSON.stringify(personData['简介'].slice(-40)));
  truthy('**没有**出现旧版那种半截链接',
    personData['简介'].indexOf(CUT_MARK + '...') === -1, '仍被砍在 ' + CUT_MARK);
  eq('4 条 @ 链接全部完好',
    (personData['简介'].match(/\]\(https:\/\/www\.douyin\.com\/user\//g) || []).length, 4);

  /* ==================== 2b. 端到端：真机 575 字数据进渲染层 ==================== */
  section('2b. 端到端：截断修好后，4 个 @ 必须全部是可点链接');

  {
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(P('src/content/ui/modal-table-renderer.js'), 'utf8'));
    const M = dom.window.ModalTableMixin;
    const cell = M.buildFieldContent.call(M, '简介', personData['简介'], 'person');

    eq('4 条链接全部渲染成 <a>',
      (cell.match(/<a href="https:\/\/www\.douyin\.com\/user\//g) || []).length, 4);
    truthy('**不再**出现半截 Markdown（](http 残留）', cell.indexOf('](http') === -1,
      (cell.match(/.{0,40}\]\(http[^<]{0,40}/) || [''])[0]);
    truthy('第 4 个 @（樱崽）的链接完整——旧版就是被砍在这里',
      cell.indexOf('MS4wLjABAAAA_bnol66rpOjMDbRgQNObz2M_26gEEvVq13rdi7EFLAi9pi3w7hxwBNl2IpQvz_1n') > -1);
    truthy('末尾「（不处谢谢）」渲染出来了', cell.indexOf('（不处谢谢）') > -1);
    truthy('可见文字只有 200 多字 → 不折叠（链接 URL 不计入长度）',
      cell.indexOf('is-clampable') === -1, cell.slice(0, 60));
    truthy('换行仍是 <br>（六行没被压成一坨）',
      (cell.match(/<br>/g) || []).length >= 5, 'br 个数=' + (cell.match(/<br>/g) || []).length);
  }


  /* ==================== 3. 人物影人 12 列同样放行 ==================== */
  section('3. 人物档案（影人 12 列）→ 同样不截 500');

  const celebData = {
    '姓名': '吴孟达 Man Tat Ng',
    '别名': '',
    '性别': '男',
    '出生日期': '1952-01-02',
    '逝世日期': '2021-02-27',
    '国家': '中国香港',
    '简介': '职业：演员\n\n' + '达叔的简介很长。'.repeat(90),
    '豆瓣': 'https://www.douban.com/personage/27222494/',
    'IMDb': '',
    'TMDB': '',
    'Bangumi': '',
    '网址': ''
  };
  w.DataProcessors.processCommonFields.call(host, celebData);
  truthy('影人长简介不按 500 截', celebData['简介'].length > 500,
    '实际 ' + celebData['简介'].length + ' 字');

  // 影人**仍然是 5000** 上限（v2.7.33：只放开社交账号，不许连带放宽）
  const celebLong = Object.assign({}, celebData, { '简介': '达叔的简介很长。'.repeat(2500) });
  truthy('影人样本确实是 2 万字（超过 5000 才测得出上限）', celebLong['简介'].length === 20000,
    '实际 ' + celebLong['简介'].length);
  w.DataProcessors.processCommonFields.call(host, celebLong);
  eq('影人 2 万字 → 仍停在 5000 上限（5000 + 省略号）', celebLong['简介'].length, 5003);
  truthy('影人确实被截了（末尾是省略号）', celebLong['简介'].slice(-3) === '...');

  /* ==================== 3b. 社交账号解除字数限制（v2.7.33） ==================== */
  section('3b. 社交账号（6 列）→ 简介不限字数，只留 5 万字防炸上限');

  const accountOf = (bio) => ({
    '平台': '微博',
    '昵称': '某人',
    '账号ID': '2803301701',
    '账号名': 'rmrb',
    '网址': 'https://weibo.com/u/2803301701',
    '简介': bio
  });

  // ① 2 万字：旧版 5000 上限会砍掉 3/4，新版必须一字不丢
  {
    const bio = '很长的签名。'.repeat(3334).slice(0, 20000);
    truthy('样本 2 万字 > 旧上限 5000（否则这条断言测不出东西）', bio.length > 5000);
    const d = accountOf(bio);
    w.DataProcessors.processCommonFields.call(host, d);
    eq('账号 2 万字简介一字不丢', d['简介'].length, 20000);
    truthy('账号 2 万字简介末尾**没有**省略号', d['简介'].slice(-3) !== '...', JSON.stringify(d['简介'].slice(-10)));
    truthy('账号简介与原文逐字相同', d['简介'] === bio);
  }

  // ② 6 万字 → 停在防炸上限，且是「截断 + 省略号」而不是原样
  {
    const bio = '很长的签名。'.repeat(10000); // 60000
    const d = accountOf(bio);
    w.DataProcessors.processCommonFields.call(host, d);
    eq('账号 6 万字 → 停在 5 万字防炸上限（+省略号）', d['简介'].length, 50003);
    truthy('防炸上限确实生效（末尾省略号）', d['简介'].slice(-3) === '...');
  }

  // ③ 防炸上限这条路也必须走 truncateRichText：切点落 URL 里时整条链接不要，
  //    绝不留「开了头没闭合」的链接（否则渲染层匹配不到 `)`，浮窗里露半截 Markdown）
  //    ⚠ 不能写成「结果里不许出现 `](http`」—— 完整链接本身就长这样，那是假断言。
  {
    const head = '填充文字。'.repeat(1999); // 9995 字
    const link = '[@某人](https://www.douyin.com/user/MS4wLjABAAAA_' + 'X'.repeat(60) + ')';
    const bio = head + link.repeat(Math.ceil(50000 / link.length) + 5);
    truthy('超长样本确实超过防炸上限', bio.length > 50000, '实际 ' + bio.length);
    const d = accountOf(bio);
    w.DataProcessors.processCommonFields.call(host, d);

    const s = d['简介'];
    const opens = [];
    for (let i = s.indexOf(']('); i > -1; i = s.indexOf('](', i + 1)) opens.push(i);
    const unclosed = opens.filter((i) => s.indexOf(')', i) === -1);
    truthy('截断后**没有**「开了头没闭合」的链接', unclosed.length === 0,
      '未闭合 ' + unclosed.length + ' 条，尾部=' + JSON.stringify(s.slice(-40)));
    truthy('截断后仍是截断状态（末尾省略号）', s.slice(-3) === '...', JSON.stringify(s.slice(-10)));
    truthy('切点落链接里时宁可退回链接之前（长度短于上限）', s.length < 50003,
      '实际 ' + s.length);
  }

  /* ==================== 4. 非人物类型维持 500（不许连带放宽） ==================== */
  section('4. 影视 / 书籍 / 游戏 / 社交 → 仍然 500 字上限');

  const movieData = {
    '中文名': '某电影',
    '简介': '很长的剧情简介。'.repeat(80),
    '豆瓣评分': '8.6',
    '上映日期': '2001-05-20'
  };
  w.DataProcessors.processCommonFields.call(host, movieData);
  eq('影视简介仍截到 500 字 + 省略号', movieData['简介'].length, 503);
  truthy('影视简介确实被截了（不是原文）', movieData['简介'].slice(-3) === '...');

  const socialData = {
    '标题': '某条作品',
    '简介': '社交正文。'.repeat(120),
    'URL': 'https://www.douyin.com/video/1'
  };
  w.DataProcessors.processCommonFields.call(host, socialData);
  eq('社交正文仍截到 500 字 + 省略号', socialData['简介'].length, 503);

  /* ==================== 5. 判据本身：不会把别的类型认成人物 ==================== */
  section('5. isPersonRecord 判据（经 processCommonFields 观察行为）');

  // 带任何一个人物清单之外的键，就必须按非人物处理
  const mixed = { ...personData, '中文名': '混进来的影视字段', '简介': '很长的简介。'.repeat(120) };
  w.DataProcessors.processCommonFields.call(host, mixed);
  eq('人物 6 列 + 影视字段 → 按非人物截 500', mixed['简介'].length, 503);

  // 键少但都合法（比如 cleanFields 把空值过滤掉了）仍算人物
  // 注：简介必须**超过 500 字**才验得出来 —— 450 字的话「截」与「不截」长度一样，是假绿
  const partial = { '昵称': '某人', '简介': '签名。'.repeat(200) };
  w.DataProcessors.processCommonFields.call(host, partial);
  truthy('只有部分人物列（空值被过滤）也算人物 → 不截',
    partial['简介'].length === 600, '实际 ' + partial['简介'].length);

  /* ==================== 6. 接线（防「函数写好了但没人调」） ==================== */
  section('6. 接线：processCommonFields 必须真的走新分支');

  const PSRC = fs.readFileSync(P('src/content/utils/data-processors.js'), 'utf8');
  // v2.8.2：三个上限从硬编码搬进了设置页，分流的「形状」不变 ——
  // 仍必须是「账号走 social 档、影人走 person 档」，只是数字现在从 descLimit 取。
  truthy('processCommonFields 里真的把简介交给了 truncateRichText，并按账号/影人分流',
    /richTruncate\(data\['简介'\],\s*isAccountRecord\(data\)\s*\?\s*descLimit\(this, 'social', 50000\)\s*:\s*descLimit\(this, 'person', 5000\)\)/.test(PSRC),
    '找不到调用点');
  truthy('isAccountRecord 真的定义了，且按 account 字段清单判断（不自己重抄列名）',
    /function isAccountRecord\(data\)/.test(PSRC) &&
    /getPersonFieldList\(cfg\.PERSON_KINDS\.ACCOUNT\)/.test(PSRC));
  truthy('人物分支与 isPersonRecord 的判断写在一起（不是各写各的）',
    /isPersonRecord\(data\)\s*&&\s*typeof richTruncate === 'function'/.test(PSRC));
  truthy('旧的 5000 一刀切已删除（不许留个入口给别处再砍）',
    PSRC.indexOf("richTruncate(data['简介'], 5000)") === -1);
  truthy('非人物分支仍走 this.truncateText(…, other 档)',
    /data\['简介'\] = this\.truncateText\(data\['简介'\], descLimit\(this, 'other', 500\)\)/.test(PSRC));
  // 三档的默认值必须原样写在这里 —— 少写一个，升级后那类简介的长度就变了
  truthy('三档默认值仍是 50000 / 5000 / 500',
    PSRC.indexOf("descLimit(this, 'social', 50000)") > -1 &&
    PSRC.indexOf("descLimit(this, 'person', 5000)") > -1 &&
    PSRC.indexOf("descLimit(this, 'other', 500)") > -1);
  truthy('descLimit 自己会把 0 / 负数当「不限制」',
    /return v <= 0 \? Number\.MAX_SAFE_INTEGER : v;/.test(PSRC));
  truthy('两个判定都先跳过装配器元字段（META_KEYS + columnKeys）',
    /var META_KEYS = \{ mediaType: true, personKind: true, sourceSite: true \};/.test(PSRC) &&
    (PSRC.split('var keys = columnKeys(data);').length - 1) === 2,
    '缺 columnKeys 调用 → 带 mediaType 的人物记录会被判成非人物，简介又被打回 500');

  /* ==================== 7. 装配器元字段（v2.7.34 真机事故） ==================== */
  section('7. 记录带着 mediaType / personKind / sourceSite 时，仍必须按人物处理');

  // 真机事故：PersonFieldsBuilder 给每条人物记录挂了三个元字段，cleanFields 不过滤键，
  // 于是「所有键都要落在人物列里」的判定直接 false → 简介走 truncateText(500)。
  const withMeta = (extra) => Object.assign({
    '平台': '抖音',
    '昵称': '某人',
    '账号ID': 'MS4wLjABAAAAmeta',
    '账号名': '123456',
    '网址': 'https://www.douyin.com/user/MS4wLjABAAAAmeta'
  }, extra);

  {
    const rec = withMeta({
      '简介': '填充文字。'.repeat(3000), // 15000 字
      mediaType: 'person', personKind: 'account', sourceSite: 'douyin'
    });
    truthy('样本 1.5 万字（超过 500 才测得出这条分支）', rec['简介'].length === 15000);
    w.DataProcessors.processCommonFields.call(host, rec);
    eq('带齐三个元字段 → 账号简介一字不丢', rec['简介'].length, 15000);
  }

  {
    const rec = withMeta({ '简介': '填充文字。'.repeat(3000), mediaType: 'person' });
    w.DataProcessors.processCommonFields.call(host, rec);
    eq('只带 mediaType 一个元字段也照人物处理', rec['简介'].length, 15000);
  }

  {
    const rec = Object.assign({ '姓名': '某影人', '简介': '填充文字。'.repeat(3000) },
      { mediaType: 'person', personKind: 'celebrity', sourceSite: 'douban' });
    w.DataProcessors.processCommonFields.call(host, rec);
    eq('带元字段的影人：仍停在 5000（元字段不该连带放宽影人）', rec['简介'].length, 5003);
  }

  // 真机原文（2026-11-01 抖音主页 SSR，desc 105 字 + 11 条 @）→ 拼出来 1153 字，
  // 修复前被砍成 503（500 + '...'），这就是用户看到的「提取部分就截断了」。
  {
    const fx = JSON.parse(fs.readFileSync(
      path.join(__dirname, 'fixtures', 'douyin', 'user-home-rich-105.json'), 'utf8'));
    const md = SSR.buildRichText(fx.desc, fx.descExtra);
    const bio = '粉丝：2823 · 获赞：2.4万 · IP属地：天津\n' + md;
    eq('真机样本简介本来就是 1153 字', bio.length, 1153);

    const rec = withMeta({
      '昵称': fx.nickname,
      '账号ID': fx.secUid,
      '简介': bio,
      mediaType: 'person', personKind: 'account', sourceSite: 'douyin'
    });
    w.DataProcessors.processCommonFields.call(host, rec);
    eq('真机样本走完管线仍是 1153 字（修复前 503）', rec['简介'].length, 1153);
    truthy('真机样本没有尾随省略号', rec['简介'].slice(-3) !== '...', rec['简介'].slice(-20));
    eq('11 条 @ 链接一条不少',
      (rec['简介'].match(/\]\(https:\/\/www\.douyin\.com\/user\//g) || []).length, 11);
  }
  truthy('字段清单来自 media-types 的单一来源（不在这里重抄一份列名）',
    PSRC.indexOf('getPersonFieldList') > -1 && PSRC.indexOf("'账号ID'") === -1);

  /* ==================== 总结 ==================== */
  console.log('\n' + '='.repeat(56));
  if (fail === 0) console.log(`== 通过 ${pass} 项，失败 0 项 ==`);
  else {
    console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  console.log('='.repeat(56));
  process.exit(fail === 0 ? 0 : 1);
})();
