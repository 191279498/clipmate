#!/usr/bin/env node
/**
 * v2.7.32 变异测试：人物档案「简介」里的裸网址也渲染成可点链接。
 *
 *   ① 裸网址不再链接化（return 退化成原文）
 *   ② 破坏占位保护 → 裸网址扫描钻进已生成的 <a href> 里套娃
 *   ③ 去掉后行断言 → 邮箱 a@b.com 被误当链接
 *   ④ 不剥尾部标点 → 中文句号被吃进 href
 *
 * 规矩同 v2.7.15 ~ v2.7.31：改坏必须红、逐字节还原、find 必须唯一。
 * modal-table-renderer.js 是 LF（v2.7.31 实测）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2732.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const RENDERER = 'src/content/ui/modal-table-renderer.js';
const TEST_FILES = [
  path.join(__dirname, 'person-type.test.js'),
  path.join(__dirname, 'bio-truncate.test.js')
];

const MUTATIONS = [
  {
    name: '① 裸网址不再链接化（return 退化成原文）',
    file: RENDERER,
    find: '        return park(`<a href="${href}" target="_blank" rel="noopener noreferrer" style="${LINK_STYLE}">${url}</a>`) + tail;',
    repl: '        return m;'
  },
  {
    name: '② 破坏占位保护 → 钻进 <a href> 里套娃',
    file: RENDERER,
    find: '        (m, label, url) => park(`<a href="${url}"',
    repl: '        (m, label, url) => (`<a href="${url}"'
  },
  {
    name: '③ 去掉后行断言 → 邮箱变链接',
    file: RENDERER,
    find: '|(?<![\\w@.\\/-])',
    repl: '|'
  },
  {
    name: '④ 不剥尾部标点 → 中文句号被吃进 href',
    file: RENDERER,
    find: '        const t = url.match(/[)\\].,;:!?]+$/);',
    repl: '        const t = null;'
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  // ⚠️ `node a.js b.js` 只会执行 a.js（其余被当成 argv），多个测试必须逐个跑
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

console.log('v2.7.32 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
