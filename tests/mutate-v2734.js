#!/usr/bin/env node
/**
 * v2.7.34 变异测试：两个真机 bug
 *
 *   A. 人物记录带着装配器元字段（mediaType/personKind/sourceSite）→ 被判成「非人物」
 *      → 简介走 truncateText(500)，抖音主页简介硬生生砍在 500 字。
 *   B. 没有签名的主页 → DOM 兜底把「IP属地：广东 / UID：…」当签名塞进简介。
 *
 *   ① META_KEYS 漏掉 mediaType          → 带元字段的记录又被打回 500
 *   ② columnKeys 的过滤整行删掉          → 等于不过滤，同上
 *   ③ SSR 命中空 desc 又退回 DOM 猜      → 「UID」回来的那一条
 *   ④ 兜底不跳过元数据行                 → IP属地/UID 进签名
 *   ⑤ 地区行规则丢掉「紧跟元数据」前置条件 → 签名里的「摄影·旅行」被吃掉
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 * ⚠ data-processors.js 是 **CRLF**，下面的 find 全是**单行**片段，不含换行，安全。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2734.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROC = 'src/content/utils/data-processors.js';
const DOUYIN = 'src/content/extractors/douyin-profile.js';
const TEST_FILES = [
  path.join(__dirname, 'bio-truncate.test.js'),
  path.join(__dirname, 'douyin-profile.test.js')
];

const MUTATIONS = [
  {
    name: '① META_KEYS 漏掉 mediaType（人物记录被打回 500）',
    file: PROC,
    find: 'var META_KEYS = { mediaType: true, personKind: true, sourceSite: true };',
    repl: 'var META_KEYS = { personKind: true, sourceSite: true };'
  },
  {
    name: '② columnKeys 的过滤整行删掉（等于不过滤）',
    file: PROC,
    find: '      if (META_KEYS[allKeys[i]] === true) continue;',
    repl: ''
  },
  {
    name: '③ SSR 命中空 desc 又退回 DOM 猜（UID 当签名）',
    file: DOUYIN,
    find: '        if (user) {',
    repl: '        if (user && user.desc) {'
  },
  {
    name: '④ 兜底不跳过元数据行（IP属地/UID 进签名）',
    file: DOUYIN,
    find: '      if (META.test(line) || META_AGE.test(line)) { prevWasMeta = true; continue; }',
    repl: '      if (META.test(line) || META_AGE.test(line)) { prevWasMeta = true; }'
  },
  {
    name: '⑤ 地区规则丢了「紧跟元数据」前置条件（吃掉「摄影·旅行」）',
    file: DOUYIN,
    find: '      if (prevWasMeta && META_REGION.test(line)) continue;',
    repl: '      if (META_REGION.test(line)) continue;'
  },
  {
    name: '⑥ 去掉硬停规则（「分享主页 / 私信」被当成签名）',
    file: DOUYIN,
    find: '      if (HARD_STOP.test(line)) break;',
    repl: ''
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
      timeout: 180000,
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

console.log('v2.7.34 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
