#!/usr/bin/env node
/**
 * v2.7.37 变异测试：IG 标题里的「昵称」被换成了用户名
 *
 * 真机事故（2026-11-01，用户换装 v2.7.36 后报「作者昵称提取也有问题」）：
 *   详情页与首页逐帖的标题都写成 `roxysitora…` / `anonymouzzz…`（**用户名**，特殊字符还被抹掉），
 *   而同一份数据里的显示名是 `Roxy` / `Andy ck`。
 *   根因：`extractTitle` 与 `_buildFeedPostRecord` 都把 `extractAuthorName()`（= 用户名）
 *   当昵称传进 `SocialTitleProcessor.generatePageTitle()`。
 *
 * 三条变异，每条都必须红：
 *   ① 详情页标题用回用户名（`extractTitle`）
 *   ② 首页逐帖标题用回用户名（`_buildFeedPostRecord`）
 *   ③ 首页逐帖的昵称变量退化成用户名（作者昵称列 + 标题一起坏）
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2737.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const SOCIAL = 'src/content/extractors/instagram-social.js';
const FEED_TEST = path.join(__dirname, 'instagram-feed-post.test.js');

const MUTATIONS = [
  {
    name: '① 详情页标题用回用户名（extractTitle）',
    file: SOCIAL,
    test: FEED_TEST,
    find: '      const authorName = this.extractAuthorNickname(context) || this.extractAuthorName(context);',
    repl: '      const authorName = this.extractAuthorName(context);'
  },
  {
    name: '② 首页逐帖标题用回用户名（_buildFeedPostRecord）',
    file: SOCIAL,
    test: FEED_TEST,
    find: '            return SocialTitleProcessor.generatePageTitle(nickname, caption, date, {',
    repl: '            return SocialTitleProcessor.generatePageTitle(author, caption, date, {'
  },
  {
    name: '③ 首页逐帖的昵称退化成用户名（作者昵称列 + 标题一起坏）',
    file: SOCIAL,
    test: FEED_TEST,
    find: '    const nickname = (inline && inline.fullName) || author;',
    repl: '    const nickname = author;'
  }
];

/* ======================== 执行框架（与 mutate-v2736 同一套） ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest(file) {
  const r = spawnSync(process.execPath, [file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 180000,
    env: Object.assign({}, process.env, {
      NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    })
  });
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.error && r.error.code === 'ETIMEDOUT') return { code: -2, text };
  return { code: r.status === null ? -2 : r.status, text };
}

function failedItems(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.indexOf('✗') > -1 || l.indexOf('❌') > -1)
    .slice(0, 5)
    .map((l) => l.trim());
}

/** 按文件实际换行风格拼多行 find / repl（CRLF 文件用 `\n` 拼永远命中不了） */
function shape(text, src) {
  if (typeof text !== 'string') return text;
  return /\r\n/.test(src) ? text.replace(/\n/g, '\r\n') : text;
}

console.log('v2.7.37 变异测试 —— ' + MUTATIONS.length + ' 条\n');

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = { buf: fs.readFileSync(target) };
  orig.hash = sha(orig.buf);
  const src = orig.buf.toString('utf8');
  const find = shape(m.find, src);
  const repl = shape(m.repl, src);

  if (src.indexOf(find) === -1) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，文件或换行风格变了）`);
    console.log(`  ⚠️  ${m.name}\n      变异点不存在`);
    return;
  }
  if (src.indexOf(find) !== src.lastIndexOf(find)) {
    problems.push(`${m.name} → find 不唯一（出现多次，replace 只会改第一处）`);
    console.log(`  ⚠️  ${m.name}\n      find 不唯一`);
    return;
  }

  fs.writeFileSync(target, src.replace(find, () => repl));

  const r = runTest(m.test);

  fs.writeFileSync(target, orig.buf);
  if (sha(fs.readFileSync(target)) !== orig.hash) {
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

console.log('');
if (problems.length) {
  console.log(`结论：${red}/${MUTATIONS.length} 条咬住，${problems.length} 个问题`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log(`结论：${red}/${MUTATIONS.length} 条改坏后全部变红，且逐字节还原`);
process.exit(0);
