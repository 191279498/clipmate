#!/usr/bin/env node
/**
 * v2.7.36 变异测试：首页浮窗被「整页范围的数据」覆盖（真机事故）+ 长文案被砍
 *
 * 这一版改的全部是「少一行代码就会回到事故现场」的闸口，所以每条都必须证明能红：
 *   ① `_doPageChange` 的首页早退被拿掉 → 首页任何一次 DOM 变化都会按整页范围刷新浮窗，
 *      用户看到「先对、几秒后被替换成首条的作者 + 广告的文案」；
 *   ② `_refreshOpenPanel` 的整页闸被拿掉 → 别的入口拿着 `document` 也能把浮窗写坏；
 *   ③ emoji 退格被拿掉 → 长文案尾巴切出半个字符（乱码）；
 *   ④ 文案上限退回 1200 → IG 允许 2200 字，长文案被静默砍掉一截。
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2736.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const HANDLER = 'src/content/ui/ig-spa-handler.js';
const HOOK = 'src/content/instagram-net-hook.js';

const FEED_TEST = path.join(__dirname, 'instagram-feed-post.test.js');
const HOOK_TEST = path.join(__dirname, 'instagram-net-hook.test.js');

const MUTATIONS = [
  {
    name: '① 首页早退被拿掉（页面自己一动就按整页范围刷新浮窗）',
    file: HANDLER,
    test: FEED_TEST,
    find: "    if (this._isIgFeedPage()) {\n      safeLog('[MediaExtractor] Instagram 首页：页面自己在变，浮窗与按钮都不动');\n      return;\n    }",
    repl: '    void 0;'
  },
  {
    name: '② 整页范围刷新的闸被拿掉（任何调用方都能写坏首页浮窗）',
    file: HANDLER,
    test: FEED_TEST,
    find: "    if (this._isIgFeedPage() && (!this.activeContext || this.activeContext === document)) {\n      safeLog('[MediaExtractor] 首页没有「当前这一条」，拒绝按整页范围刷新浮窗');\n      return;\n    }",
    repl: '    void 0;'
  },
  {
    name: '③ emoji 退格被拿掉（长文案尾巴切出半个字符）',
    file: HOOK,
    test: HOOK_TEST,
    find: '    if (code >= 0xD800 && code <= 0xDBFF) cut--;',
    repl: '    void 0;'
  },
  {
    name: '④ 文案上限退回 1200（IG 允许 2200 字，长文案被砍）',
    file: HOOK,
    test: HOOK_TEST,
    find: '  var MAX_CAPTION = 2400;',
    repl: '  var MAX_CAPTION = 1200;'
  },
  {
    name: '⑤ 按钮认编号上限退回 30 位（推广帖一颗按钮都没有）',
    file: 'src/content/ui/instagram-feed-buttons.js',
    test: FEED_TEST,
    find: '(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]{5,64})\\/?$/;',
    repl: '(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]{5,30})\\/?$/;'
  },
  {
    name: '⑥ 编号规整上限退回 30 位（推广帖查不到接口数据 → 昵称变用户名）',
    file: 'src/content/shared/instagram-inline-data.js',
    test: FEED_TEST,
    find: "  var WORK_CODE = '[A-Za-z0-9_-]{5,64}';",
    repl: "  var WORK_CODE = '[A-Za-z0-9_-]{5,30}';"
  },
  {
    name: '⑦ 作品地址判定上限退回 30 位（打开推广帖时按钮不出来）',
    file: 'src/content/shared/instagram-entry-context.js',
    test: path.join(__dirname, 'instagram-entry-context.test.js'),
    find: "  var CODE = '[A-Za-z0-9_-]{5,64}';",
    repl: "  var CODE = '[A-Za-z0-9_-]{5,30}';"
  },
  {
    name: '⑧ 弹层监听没启动（页面变化一条也收不到，「时序用例」应当变红）',
    file: HANDLER,
    test: FEED_TEST,
    find: '    this.modalWatcher.start();',
    repl: '    void 0;'
  }
];

/* ======================== 执行框架 ======================== */

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

/**
 * 按文件实际的换行风格拼多行 find / repl。
 *
 * `ig-spa-handler.js` 是 **CRLF**：脚本里用 `\n` 拼出来的多行 find 永远命中不了，
 * 报出来的还是「变异点不存在」—— 把「红」伪装成「跳过」（v2.7.33 踩过同一个坑）。
 */
function shape(text, src) {
  if (typeof text !== 'string') return text;
  return /\r\n/.test(src) ? text.replace(/\n/g, '\r\n') : text;
}

console.log('v2.7.36 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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

console.log('\n====================================================');
if (problems.length) {
  console.log(`== 变异 ${red}/${MUTATIONS.length} 变红，另有 ${problems.length} 个问题 ==`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log(`== 变异 ${red}/${MUTATIONS.length} 全部改坏后变红，且已逐字节还原 ==`);
