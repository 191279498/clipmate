#!/usr/bin/env node
/**
 * v2.7.25 变异测试：本版只修了「about 数据整份静默丢失」这一个问题，
 * 两个根因逐项改坏，测试必须变红。
 *
 *   ① `_aboutFromFetch()` 超时改回单段 3000ms（正文 2.5MB 读完要 2.6 秒 = 临界）
 *   ② `_aboutData()` 里一份脏脚本数据就能把 fetch 这条路堵死
 *
 * 规矩（与 v2.7.15 ~ v2.7.24 同一套）：
 *   · 改坏 → 跑测试期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不算红）；
 *   · 替换必须用**函数式**（`replace(find, () => repl)`）——
 *     repl 里的 `$` 会被 String.replace 当特殊模式（v2.7.23 踩过，文件暴涨 15KB）。
 *
 * 文件是 **LF**（v2.7.25 实测：youtube-profile.js 全 LF）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2725.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROFILE = 'src/content/extractors/youtube-profile.js';
const TEST_FILES = [path.join(__dirname, 'youtube-profile.test.js')];

const MUTATIONS = [
  /* ---------- ① 两段超时 ---------- */
  {
    name: '① 阶段一等响应头退回 3000ms → 与旧版同值，临界超时复发',
    file: PROFILE,
    find: `        arm(5000); // 阶段一：等响应头`,
    repl: `        arm(3000); // 阶段一：等响应头`
  },
  {
    name: '② 阶段二读正文退回 3000ms → 2.5MB 读不完就被 abort',
    file: PROFILE,
    find: `      arm(6000); // 阶段二：读正文（about 页整份 HTML 约 2.5MB）`,
    repl: `      arm(3000); // 阶段二：读正文（about 页整份 HTML 约 2.5MB）`
  },
  {
    name: '③ 失败不留痕（删掉 catch 里的 console.warn）→ 字段为什么空查不出来',
    file: PROFILE,
    find: `      console.warn('[ClipMate] YouTube about 页读取失败（已降级）：' + (e && (e.name || e.message)));`,
    repl: `      void 0;`
  },

  /* ---------- ② 脏脚本不许堵死 fetch ---------- */
  {
    name: '④ 脚本有对象就用（不校验）→ 脏数据直接把 fetch 堵死',
    file: PROFILE,
    find: `      if (fromScripts && this._aboutMatchesLocation(fromScripts)) {`,
    repl: `      if (fromScripts) {`
  },
  {
    name: '⑤ 脚本校验不过就整份结束（退回 v2.7.24 的写法）→ 永远不 fetch',
    file: PROFILE,
    find: `      const fetched = await this._aboutFromFetch();`,
    repl: `      const fetched = null;`
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  const r = spawnSync(process.execPath, TEST_FILES, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000,
    env: Object.assign({}, process.env, {
      NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    })
  });
  if (r.error && r.error.code === 'ETIMEDOUT') return { code: -2, text: '' };
  return { code: r.status === null ? -2 : r.status, text: (r.stdout || '') + (r.stderr || '') };
}

function failedItems(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.indexOf('✗') > -1 || l.indexOf('❌') > -1)
    .slice(0, 6)
    .map((l) => l.trim());
}

console.log('v2.7.25 变异测试 —— ' + MUTATIONS.length + ' 条\n');

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = { buf: fs.readFileSync(target) };
  orig.hash = sha(orig.buf);
  const src = orig.buf.toString('utf8');

  if (src.indexOf(m.find) === -1) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，文件或换行风格变了）`);
    console.log(`  ⚠️  ${m.name}\n      变异点不存在`);
    return;
  }
  if (src.indexOf(m.find) !== src.lastIndexOf(m.find)) {
    problems.push(`${m.name} → find 不唯一（出现多次，replace 只会改第一处）`);
    console.log(`  ⚠️  ${m.name}\n      find 不唯一`);
    return;
  }

  fs.writeFileSync(target, src.replace(m.find, () => m.repl));

  const r = runTest();

  fs.writeFileSync(target, orig.buf);
  const nowHash = sha(fs.readFileSync(target));
  if (nowHash !== orig.hash) {
    problems.push(`${m.name} → 还原失败（sha256 不一致）`);
    console.log(`  ❌ ${m.name}\n      还原失败`);
    return;
  }

  if (r.code === 0) {
    problems.push(`${m.name} → 改坏了还是绿的（断言没咬住）`);
    console.log(`  ❌ ${m.name}\n      改坏后仍绿`);
    return;
  }
  if (r.code === -2) {
    problems.push(`${m.name} → 挂死/超时，不算红`);
    console.log(`  ❌ ${m.name}\n      挂死，不算红`);
    return;
  }

  red++;
  const hit = failedItems(r.text);
  console.log(`  ✅ ${m.name}`);
  if (hit.length) console.log('      变红的断言：' + hit.join(' / '));
});

console.log(`\n变红 ${red}/${MUTATIONS.length} 条`);
if (problems.length) {
  console.log('\n问题：');
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
if (red !== MUTATIONS.length) {
  console.log('\n未全部变红，判定失败');
  process.exit(1);
}
console.log('全部变异都被咬住，还原校验通过');
