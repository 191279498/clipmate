#!/usr/bin/env node
/**
 * v2.7.27 变异测试：X 个人主页提取器（x-profile.js）。
 *
 *   ① 防串台校验失效 → 别人频道的 JSON-LD 照用（数字ID/精确日期串台）
 *   ② 关注者 DOM 选择器失效 → 页面原样 7.2万 丢成精确值 72072
 *   ③ 加入日期不读 JSON-LD 顶层 → 退成年月（丢日）
 *   ④ relatedLink 不跳过 t.co → 外链变成壳短链
 *   ⑤ 网址不重拼官方形态
 *   ⑥ 账号名列不取 handle
 *   ⑦ 数字ID 不进简介
 *   ⑧ 简介正文不用 DOM 版 → 排版丢失
 *
 * 规矩同 v2.7.15 ~ v2.7.26：改坏必须红、逐字节还原、find 必须唯一。
 * x-profile.js 是 LF（v2.7.27 实测）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2727.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROFILE = 'src/content/extractors/x-profile.js';
const TEST_FILES = [path.join(__dirname, 'x-profile.test.js')];

const MUTATIONS = [
  {
    name: '① 防串台校验失效 → 别人的 JSON-LD 照用',
    file: PROFILE,
    find: '      if (!okByUrl && !okByName) {',
    repl: '      if (false) {'
  },
  {
    name: '② 关注者 DOM 选择器失效 → 7.2万 丢成 72072',
    file: PROFILE,
    find: "        const m = this._text(links[i]).match(/^([\\d.,]+\\s*[万亿kKmMwW]?)\\s/);",
    repl: '        const m = null;'
  },
  {
    name: '③ 加入日期不读 JSON-LD → 退成年月',
    file: PROFILE,
    find: "      const s = String(ld && ld.dateCreated || '');",
    repl: "      const s = '';"
  },
  {
    name: '④ relatedLink 不跳过 t.co → 外链变壳短链',
    file: PROFILE,
    find: ".filter((x) => x.indexOf('t.co/') === -1);",
    repl: '.filter(() => true);'
  },
  {
    name: '⑤ 网址不重拼官方形态',
    file: PROFILE,
    find: "      return h ? 'https://x.com/' + h : '';",
    repl: "      return h ? window.location.href : '';"
  },
  {
    name: '⑥ 账号名列不取 handle',
    file: PROFILE,
    find: '      return await this.extractAccountId();',
    repl: "      return '';"
  },
  {
    name: '⑦ 数字ID 不进简介',
    file: PROFILE,
    find: "      if (ent && ent.identifier) parts.push('数字ID：' + String(ent.identifier));",
    repl: '      void ent;'
  },
  {
    name: '⑧ 简介正文不用 DOM 版',
    file: PROFILE,
    find: "      let bio = this._textOf('[data-testid=\"UserDescription\"]');",
    repl: "      let bio = '';"
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

console.log('v2.7.27 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
