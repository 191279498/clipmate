#!/usr/bin/env node
/**
 * v2.7.33 变异测试：社交账号「简介」解除字数限制（影人仍 5000，非人物仍 500）
 *
 *   ① 账号退回 5000 一刀切        → 账号 2 万字被砍
 *   ② isAccountRecord 读错字段清单 → 账号永远判不出，退回 5000
 *   ③ 影人被连带放宽              → 影人 2 万字不截（用户明确只要放开账号）
 *   ④ 非人物被连带放宽            → 影视/书籍简介跟着变长
 *   ⑤ 防炸上限失效（50000→0）      → 6 万字垃圾全量入库
 *   ⑥ 断链保护失效                → 超长截断切出「开了头没闭合」的链接
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 * ⚠ data-processors.js 是 **CRLF**，data-formatters.js 同为 CRLF ——
 *   这里每条 find 都是**单行**片段，不含换行，所以不受换行风格影响。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2733.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROC = 'src/content/utils/data-processors.js';
const FMT = 'src/content/utils/data-formatters.js';
const TEST_FILES = [path.join(__dirname, 'bio-truncate.test.js')];

const MUTATIONS = [
  {
    name: '① 账号退回 5000 一刀切（账号 2 万字被砍）',
    file: PROC,
    find: 'isAccountRecord(data) ? 50000 : 5000',
    repl: '5000'
  },
  {
    name: '② isAccountRecord 读成影人清单（账号永远判不出）',
    file: PROC,
    find: '    var list = cfg.getPersonFieldList(cfg.PERSON_KINDS.ACCOUNT) || [];',
    repl: '    var list = cfg.getPersonFieldList(cfg.PERSON_KINDS.CELEBRITY) || [];'
  },
  {
    name: '③ 影人被连带放宽（影人 2 万字不截）',
    file: PROC,
    find: 'isAccountRecord(data) ? 50000 : 5000',
    repl: 'isAccountRecord(data) ? 50000 : 50000'
  },
  {
    name: '④ 非人物被连带放宽（影视简介跟着变长）',
    file: PROC,
    find: "data['简介'] = this.truncateText(data['简介'], 500);",
    repl: "data['简介'] = this.truncateText(data['简介'], 50000);"
  },
  {
    name: '⑤ 防炸上限失效（50000 → 0 = 不截）',
    file: PROC,
    find: 'isAccountRecord(data) ? 50000 : 5000',
    repl: 'isAccountRecord(data) ? 0 : 5000'
  },
  {
    name: '⑥ 断链保护失效（超长截断切出半个链接）',
    file: FMT,
    find: '      cut = cut.slice(0, open);',
    repl: '      cut = cut;'
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  let text = '';
  for (const f of TEST_FILES) {
    const r = spawnSync(process.execPath, [f], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 120000,
      env: Object.assign({}, process.env, {
        NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
      })
    });
    text += (r.stdout || '') + (r.stderr || '');
    if (r.error && r.error.code === 'ETIMEDOUT') return { code: -2, text };
    const code = r.status === null ? -2 : r.status;
    if (code !== 0) return { code, text };
  }
  return { code: 0, text };
}

function failedItems(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.indexOf('✗') > -1 || l.indexOf('❌') > -1)
    .slice(0, 6)
    .map((l) => l.trim());
}

console.log('v2.7.33 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
  const items = failedItems(r.text);
  console.log(`  ✅ ${m.name}`);
  items.forEach((l) => console.log(`       ${l}`));
});

console.log('\n====================================================');
if (problems.length) {
  console.log(`== 变异 ${red}/${MUTATIONS.length} 变红，另有 ${problems.length} 个问题 ==`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log(`== 变异 ${red}/${MUTATIONS.length} 全部改坏后变红，且已逐字节还原 ==`);
