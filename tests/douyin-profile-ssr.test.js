/**
 * 抖音 SSR 签名解析（v2.7.14）—— 纯函数契约测试
 *
 * 这个模块存在的唯一理由：页面 DOM 里的签名是**截断的**，完整版只在内联 `<script>`
 * 的 React Server Components 预渲染数据里。所以这里钉的是「从哪里读、怎么拼、什么情况下
 * 必须放弃」：
 *
 *   A. 能从真实数据块里读出完整 desc 与 descExtra
 *   B. **secUid 对不上必须返回 null**（防把别人的签名记到这个人头上）
 *   C. descExtra 是无序的，拼装必须按 start 排序
 *   D. 区间重叠 / 越界一律不猜，保留原文
 *   E. 只有「@ 开头 + 有 secUid」才算用户链接（不把话题误造成链接）
 *   F. 三项统计缺哪项就不出现哪项，不留「IP属地：」半截
 *
 * 样本：tests/fixtures/douyin/ssr-user-home-*.txt（2026-10-30 真机原样抓取）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SSR = require(path.resolve(__dirname, '..', 'ClipMate_chrome', 'src', 'content', 'extractors', 'douyin-profile-ssr.js'));

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

const FIX = path.join(__dirname, 'fixtures', 'douyin');
const BIG = fs.readFileSync(path.join(FIX, 'ssr-user-home-0.txt'), 'utf8');   // 265KB：页面其它数据
const USER = fs.readFileSync(path.join(FIX, 'ssr-user-home-1.txt'), 'utf8');  // 6KB：用户数据
const PAGE_URL = fs.readFileSync(path.join(FIX, 'ssr-user-home-url.txt'), 'utf8').trim();
const SEC = (PAGE_URL.match(/\/user\/([A-Za-z0-9_-]+)/) || [])[1];

/** 只要能被 querySelectorAll 返回 textContent 就够 */
const docOf = (blocks) => ({ querySelectorAll: () => blocks.map((t) => ({ textContent: t })) });

console.log('sample secUid =', SEC, '(' + SEC.length + ' 位)');

/* ==================== 1. 真实数据块 ==================== */
section('1. 真实数据块：读出完整签名');

const u = SSR.readProfile(docOf([BIG, USER]), SEC);
truthy('能命中用户对象', !!u);
if (u) {
  eq('昵称', u.nickname, '恨海情天.');
  eq('secUid 与地址栏一致', u.secUid, SEC);
  eq('完整签名长度（页面 DOM 只有 35 字）', u.desc.length, 115);
  truthy('签名含 DOM 里根本没有的后半段', u.desc.indexOf('（不处谢谢）') > -1);
  eq('descExtra 4 条', u.descExtra.length, 4);
}

/* ==================== 2. secUid 闸口 ==================== */
section('2. secUid 闸口：对不上就整段放弃');

eq('传错 secUid → null（绝不猜）', SSR.readProfile(docOf([BIG, USER]), 'MS4wLjABAAAAsomeoneElse'), null);
truthy('传空 secUid（/user/self）→ 仍能命中', !!SSR.readProfile(docOf([USER]), ''));
eq('没有 script → null', SSR.readProfile(docOf([]), SEC), null);
eq('doc 是 null → null', SSR.readProfile(null, SEC), null);
eq('只有页面其它数据（265KB 作品块）→ null（不把作品当人）',
  SSR.readProfile(docOf([BIG]), SEC), null);

/* ==================== 3. 拼 Markdown 链接 ==================== */
section('3. descExtra → Markdown 链接');

const md = SSR.buildRichText(u.desc, u.descExtra);
eq('4 个 @ 全部变成链接',
  (md.match(/\[@[^\]]+\]\(https:\/\/www\.douyin\.com\/user\/MS4wLjABAAAA/g) || []).length, 4);
// 第一个 @ 的原文（含数学粗体等特殊字符，手打容易错，从样本里取）
const firstMention = u.desc.slice(2, 22);
truthy('第一个 @ 是特殊字符昵称（前提）', firstMention.charAt(0) === '@' && firstMention.length === 20, firstMention);
truthy('链接文字原样搬进方括号（一个字都不改）',
  md.indexOf('[' + firstMention + '](') > -1, md.slice(0, 60));
truthy('第一个 @ 指向「蜜鞠」的 secUid',
  md.indexOf('/user/MS4wLjABAAAATEUccmr0JONaIZh6RD373Z1KD2LI4-Vwe_zEUYygxMvgZtY6Fu8WdGyitEXYqRNg)') > -1);
truthy('换行全部保留', md.split('\n').length === u.desc.split('\n').length,
  'md=' + md.split('\n').length + ' desc=' + u.desc.split('\n').length);
truthy('不残留截断标记', md.indexOf('...') === -1);
truthy('不带「更多」按钮文字', md.indexOf('更多') === -1);

// 真机样本的 descExtra 顺序是 35、60、69、2（乱的）—— 拼装必须先排序
const rawOrder = u.descExtra.map((e) => e.start);
truthy('原始 descExtra 的顺序确实是乱的（这条是前提）',
  rawOrder.join(',') !== rawOrder.slice().sort((a, b) => a - b).join(','), rawOrder.join(','));
truthy('拼出来的结果是按位置正序的',
  md.indexOf('@𝓯𝓻𝓮') < md.indexOf('@四叶草.') &&
  md.indexOf('@四叶草.') < md.indexOf('@鞠婧祎') &&
  md.indexOf('@鞠婧祎') < md.indexOf('@樱崽'), md.slice(0, 120));

/* ==================== 4. 边界 ==================== */
section('4. 边界：重叠 / 越界 / 空值 / 非 @ 段');

eq('没有 desc → 空串', SSR.buildRichText('', []), '');
eq('desc 不是字符串 → 空串', SSR.buildRichText(null, []), '');
eq('没有 descExtra → 原文', SSR.buildRichText('纯文本签名', null), '纯文本签名');
eq('空数组 → 原文', SSR.buildRichText('纯文本签名', []), '纯文本签名');

// 重叠：第二段起点落在第一段内部 → 跳过第二段，不拼出畸形串
const overlap = SSR.buildRichText('@甲 和 @乙', [
  { start: 0, end: 2, secUid: 'SEC_A' },
  { start: 1, end: 5, secUid: 'SEC_B' }
]);
eq('重叠区间：保留先出现的那段，后段跳过',
  overlap, '[@甲](https://www.douyin.com/user/SEC_A) 和 @乙');

// 越界：end 超出字符串长度 → 忽略（不 slice 出半截）
eq('越界区间被忽略', SSR.buildRichText('@甲', [{ start: 0, end: 99, secUid: 'SEC_A' }]), '@甲');
// 起点为负
eq('负起点被忽略', SSR.buildRichText('@甲', [{ start: -1, end: 2, secUid: 'SEC_A' }]), '@甲');
// end <= start
eq('空区间被忽略', SSR.buildRichText('@甲', [{ start: 2, end: 2, secUid: 'SEC_A' }]), '@甲');

// 有 secUid 但片段不以 @ 开头（话题等富文本）→ 不造用户链接
eq('非 @ 开头的富文本段不造链接',
  SSR.buildRichText('#话题', [{ start: 0, end: 3, secUid: 'SEC_A' }]), '#话题');

// link 字段优先于 secUid（网页链接）
eq('extra.link 是 http 时优先用它',
  SSR.buildRichText('看看这个', [{ start: 0, end: 2, secUid: 'SEC_A', link: 'https://example.com/x' }]),
  '[看看](https://example.com/x)这个');
// flight 里未定义是字符串 "$undefined"，不能当链接
eq('link 是 "$undefined" 时退回 secUid',
  SSR.buildRichText('@甲', [{ start: 0, end: 2, secUid: 'SEC_A', link: '$undefined' }]),
  '[@甲](https://www.douyin.com/user/SEC_A)');

/* ==================== 5. 统计三项 ==================== */
section('5. 统计三项：前缀剥离与缺项');

eq('"粉丝1640" → 1640', SSR.stripPrefix('粉丝1640', '粉丝'), '1640');
eq('"获赞2.9万" → 2.9万', SSR.stripPrefix('获赞2.9万', '获赞'), '2.9万');
eq('"IP属地：吉林" → 吉林', SSR.stripPrefix('IP属地：吉林', 'IP属地'), '吉林');
eq('"IP属地: 吉林"（半角冒号）→ 吉林', SSR.stripPrefix('IP属地: 吉林', 'IP属地'), '吉林');
eq('找不到前缀 → 空串', SSR.stripPrefix('随便什么', '粉丝'), '');
eq('空输入 → 空串', SSR.stripPrefix('', '粉丝'), '');

eq('三项齐全', SSR.formatStats({ fans: '1640', likes: '2.9万', ip: '吉林' }),
  '粉丝：1640 · 获赞：2.9万 · IP属地：吉林');
eq('缺 IP 时不出现「IP属地：」半截',
  SSR.formatStats({ fans: '1640', likes: '2.9万', ip: '' }), '粉丝：1640 · 获赞：2.9万');
eq('三项全缺 → 空串（不输出孤零零的分隔符）', SSR.formatStats({}), '');
eq('空参数 → 空串', SSR.formatStats(null), '');

/* ==================== 6. 性能（页面里有 79 个 script） ==================== */
section('6. 性能：不能把页面卡住');

const many = [];
for (let i = 0; i < 60; i++) many.push('self.__pace_f.push([1,"' + i + ':[]"])');
many.push(BIG, USER);
const t0 = Date.now();
const perf = SSR.readProfile(docOf(many), SEC);
const cost = Date.now() - t0;
truthy('79 个 script 全扫一遍仍能命中', !!perf);
truthy('耗时 < 500ms（真机实测个位数毫秒）', cost < 500, cost + 'ms');

/* ==================== 总结 ==================== */
console.log('\n' + '='.repeat(52));
if (fail === 0) console.log(`== 通过 ${pass} 项，失败 0 项 ==`);
else {
  console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
  failures.forEach((f) => console.log('  ✗ ' + f));
}
console.log('='.repeat(52));
process.exit(fail === 0 ? 0 : 1);
