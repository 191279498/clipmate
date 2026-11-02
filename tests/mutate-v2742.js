#!/usr/bin/env node
/**
 * v2.7.42 变异测试：① 标题过滤白名单加下划线（用户 2026-11-01 拍板「选 A」）
 *                    ② 搜索页按钮逐卡对齐到自己的「⋯」（同轮真机验出来的压字问题）
 *
 * 需求一：昵称里的下划线要保留。起因是微博超话帖 —— 昵称列 `Gufei_GF`，标题里被洗成
 * `GufeiGF`，同一条记录两处对不上。下划线与短横线同等对待，但**不许**换成短横线，
 * 也不许顺手把别的符号（点号 / 冒号 / @ / 全角括号）也留下。
 *
 * 需求二：搜索页同一页里卡片高度不齐（带「热门」条的「⋯」在 top 55，不带的在 top 21），
 * 写死 top 50 会在后者身上压到正文第一行（真机实证压住一条 `@某人` 链接 3px）。
 *
 * 四条变异，每条都必须红：
 *   ① 白名单去掉 `_` → 下划线又被洗掉（回到 v2.7.41 的 bug）
 *   ② 把下划线「规整」成短横线 → 昵称变了样（另一种错法，容易被当成修复）
 *   ③ 搜索页不再逐卡算 → 退回写死的 top
 *   ④ 居中算式写成贴齐「⋯」上沿 → 落点偏下 5px（看着没事，实测会压字）
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2742.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROCESSOR = 'src/content/shared/social-title-processor.js';
const BUTTONS = 'src/content/ui/weibo-feed-buttons.js';
const TITLE_TEST = path.join(__dirname, 'social-hashtag-cleaner.test.js');
const WEIBO_TEST = path.join(__dirname, 'weibo-feed-post.test.js');

/** 白名单那一行 —— 整个仓库只有这一处写成 `s = s.replace(...)`（注释里的不算） */
const WHITELIST_LINE = "    s = s.replace(/[^\\u4e00-\\u9fff0-9a-zA-Z_-]/g, '');";

const MUTATIONS = [
  {
    name: '① 白名单去掉 `_` → 昵称里的下划线又被洗掉',
    file: PROCESSOR,
    test: TITLE_TEST,
    find: WHITELIST_LINE,
    repl: "    s = s.replace(/[^\\u4e00-\\u9fff0-9a-zA-Z-]/g, '');"
  },
  {
    name: '② 把下划线换成短横线 → 昵称被改名（不是「保留」）',
    file: PROCESSOR,
    test: TITLE_TEST,
    find: WHITELIST_LINE,
    repl: [
      "    s = s.replace(/_/g, '-');",
      WHITELIST_LINE
    ].join('\n')
  },
  {
    name: '③ 搜索页不再逐卡算 → 退回写死的 top（又压正文第一行）',
    file: BUTTONS,
    test: WEIBO_TEST,
    find: '        var anchTop = this._anchorTop(container);',
    repl: '        var anchTop = null;'
  },
  {
    name: '④ 居中算式贴齐「⋯」上沿 → 落点整体偏下 5px',
    file: BUTTONS,
    test: WEIBO_TEST,
    find: '        return Math.round(mr.top - cr.top + (mr.height - 26) / 2);',
    repl: '        return Math.round(mr.top - cr.top);'
  }
];

/* ======================== 执行框架（与 mutate-v2738 同一套） ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest(file) {
  const r = spawnSync(process.execPath, [file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 300000,
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
    .slice(0, 4)
    .map((l) => l.trim());
}

/** 按文件实际换行风格拼多行 find / repl（CRLF 文件用 `\n` 拼永远命中不了） */
function shape(text, src) {
  if (typeof text !== 'string') return text;
  return /\r\n/.test(src) ? text.replace(/\n/g, '\r\n') : text;
}

console.log('v2.7.42 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
