/**
 * 简介长度上限（v2.8.2）—— 契约测试
 *
 * 这一版把原来写死在 data-processors.js 里的三个数搬进了设置页：
 *   社交账号 50000 / 影人 5000 / 其他 500
 *
 * 本测试要钉住三件事，缺一条这个开关就是假的：
 *   1. **默认值等于搬之前** —— 没配 descLimits 时，输出必须与 v2.8.1 逐字节一致；
 *   2. **配置真的被读** —— 改小上限，简介就真的变短；
 *   3. **0 = 不限制** —— 设置页那一栏的提示语向用户承诺过，不许变成「截成空字符串」。
 *
 * 测的是真实现：直接把 data-formatters.js 与 data-processors.js 塞进 sandbox 执行，
 * 再用自己的宿主对象调 processCommonFields，不给假桩。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const MT_PATH = path.join(ROOT, 'src/shared/config/media-types.js');
const FMT_PATH = path.join(ROOT, 'src/content/utils/data-formatters.js');
const DP_PATH = path.join(ROOT, 'src/content/utils/data-processors.js');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };
let pass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(C.green + '  ✓ ' + C.reset + name + (extra !== undefined && process.env.VERBOSE ? C.dim + '  → ' + extra + C.reset : ''));
  } else {
    fails.push(name + (extra !== undefined ? '（实际：' + extra + '）' : ''));
    console.log(C.red + '  ✗ ' + name + C.reset + (extra !== undefined ? C.dim + '  → ' + extra + C.reset : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name, a === b, a === b ? undefined : a + ' ≠ ' + b);
}

function section(t) {
  console.log('\n' + C.bold + t + C.reset);
}

/** 把 content 脚本塞进一个假 window 里执行（它们都是 (function(global){...})(window) 形态） */
function buildSandbox() {
  const win = {};
  const run = (file) => {
    const src = fs.readFileSync(file, 'utf8');
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', 'console', src);
    fn(win, console);
  };
  run(FMT_PATH);
  run(DP_PATH);
  return win;
}

const MT = require(MT_PATH);
const win = buildSandbox();

// isPersonRecord / isAccountRecord 依赖这个全局配置
win.mediaTypesConfig = {
  PERSON_KINDS: MT.PERSON_KINDS,
  getPersonFieldList: MT.getPersonFieldList
};

ok('data-processors 已挂到 window', !!win.DataProcessors);
ok('data-formatters 已挂到 window', !!win.DataFormatters);

const P = win.DataProcessors;
const F = win.DataFormatters;

/** 造一个「宿主」，等价于 MediaExtractor 实例（mixin 方法都靠 this 取东西） */
function host(descLimits) {
  const h = {
    formatRating: (v) => v,
    truncateText: (text, n) => F.truncateText(text, n)
  };
  if (descLimits !== undefined) h.descLimits = descLimits;
  return h;
}

/** 影视条目（非人物，走 500 那档） */
function movieData(desc) {
  return { 标题: '某部电影', 导演: '某人', 简介: desc };
}

/** 社交账号记录（account 6 列，走 social 那档） */
function accountData(desc) {
  return {
    平台: '抖音', 昵称: '昵称', 账号ID: 'dy_1', 账号名: '账号名', 网址: 'https://x/1', 简介: desc,
    mediaType: 'person', personKind: 'account'
  };
}

/** 影人记录（celebrity 12 列，走 person 那档） */
function celebrityData(desc) {
  return {
    姓名: '某人', 别名: '', 性别: '', 出生日期: '', 逝世日期: '', 国家: '',
    简介: desc, 豆瓣: '', IMDb: '', TMDB: '', Bangumi: '', 网址: '',
    mediaType: 'person', personKind: 'celebrity'
  };
}

function run(data, descLimits) {
  P.processCommonFields.call(host(descLimits), data);
  return data['简介'];
}

function main() {
  console.log(C.bold + '\n简介长度上限（v2.8.2）' + C.reset);

  /* ============ 1. 默认值必须等于搬家之前 ============ */
  section('一、没配 descLimits 时 = 旧行为（19 样本快照零差异的前提）');

  const long600 = 'a'.repeat(600);
  eq('影视简介 600 字 → 截到 500 + ...',
    run(movieData(long600), undefined).length, 503);
  ok('影视简介截断后以 ... 结尾', run(movieData(long600), undefined).endsWith('...'));

  const acc = run(accountData('b'.repeat(60000)), undefined);
  eq('社交账号 6 万字 → 按 50000 截断', acc.length, 50003);
  const accShort = run(accountData('b'.repeat(2000)), undefined);
  eq('社交账号 2000 字 → 一个字不动（这是「体感不限制」的由来）', accShort.length, 2000);

  const cel = run(celebrityData('c'.repeat(6000)), undefined);
  eq('影人 6000 字 → 按 5000 截断', cel.length, 5003);

  /* ============ 2. 配置真的被读 ============ */
  section('二、改设置就真的变（否则这个开关是假的）');

  eq('social 改成 100 → 截到 100',
    run(accountData('b'.repeat(2000)), { social: 100, person: 5000, other: 500 }).length, 103);
  eq('person 改成 50 → 截到 50',
    run(celebrityData('c'.repeat(600)), { social: 50000, person: 50, other: 500 }).length, 53);
  eq('other 改成 20 → 截到 20',
    run(movieData('a'.repeat(600)), { social: 50000, person: 5000, other: 20 }).length, 23);

  // 三档互不影响：改 social 不许动到影人与其他
  const onlySocial = { social: 10, person: 5000, other: 500 };
  eq('改 social 不影响影人那档（6000 字仍按 5000 切）',
    run(celebrityData('c'.repeat(6000)), onlySocial).length, 5003);
  eq('改 social 不影响其他那档',
    run(movieData('a'.repeat(600)), onlySocial).length, 503);

  /* ============ 3. 0 = 不限制 ============ */
  section('三、填 0 = 不限制（设置页的提示语承诺过）');

  const huge = 20000;
  eq('other=0 → 2 万字原样保留（不截断、不加 ...）',
    run(movieData('a'.repeat(huge)), { social: 50000, person: 5000, other: 0 }).length, huge);
  ok('other=0 时不追加 ...',
    !run(movieData('a'.repeat(huge)), { social: 50000, person: 5000, other: 0 }).endsWith('...'));
  eq('social=0 → 影人那档不受影响，社交不限',
    run(accountData('b'.repeat(60000)), { social: 0, person: 5000, other: 500 }).length, 60000);
  eq('person=0 → 6000 字影人简介原样保留',
    run(celebrityData('c'.repeat(6000)), { social: 50000, person: 0, other: 500 }).length, 6000);

  /* ============ 4. 脏值安全 ============ */
  section('四、脏值不许把简介清空');

  eq('非数字 → 回退默认 500', run(movieData(long600), { other: 'abc' }).length, 503);
  eq('缺这一档 → 回退默认（social 缺 → 50000）',
    run(accountData('b'.repeat(60000)), { person: 5000 }).length, 50003);
  eq('descLimits 整个是空对象 → 全按默认',
    run(movieData(long600), {}).length, 503);
  // 负数按「不限制」处理（与 content-main 的 numOr 同一口径）
  eq('负数 -1 → 不限制', run(movieData('a'.repeat(huge)), { other: -1 }).length, huge);

  /* ============ 5. 别把「其他信息」「评分」顺手改坏 ============ */
  section('五、同函数里的相邻逻辑没被带坏');

  const d = movieData('短简介');
  d['网络评分'] = '8.5/10';
  P.processCommonFields.call(host({ other: 500 }), d);
  eq('短简介原样返回', d['简介'], '短简介');
  eq('评分仍走 formatRating', d['网络评分'], '8.5/10');

  // ============ 汇总 ============
  console.log('\n' + '─'.repeat(56));
  if (fails.length) {
    console.log(C.red + '❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项' + C.reset);
    fails.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  } else {
    console.log(C.green + '✅ 全部通过：' + pass + ' 项' + C.reset);
  }
}

main();
