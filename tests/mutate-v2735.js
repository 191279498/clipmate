#!/usr/bin/env node
/**
 * v2.7.35 变异测试：Instagram 首页「逐帖提取按钮」
 *
 * 这一版新增的东西全部是「看着能跑、真机会错」的类型，所以每条断言都要证明能红：
 *   ① 首页判据写成恒真            → 探索页/详情页也挂按钮（用户会看到一堆莫名其妙的按钮）
 *   ② 不排除弹层里的帖子          → 点开帖子后信息流按钮还挂着，两层按钮打架
 *   ③ 编号不挡 /liked_by/         → 存下来的网址变点赞列表（v2.7.21 真机事故）
 *   ④ 幂等判断失效                → 每次 sync 多挂一颗，滚动几下按钮叠成串
 *   ⑤ 点击不拦冒泡                → 点「提取」变成「打开帖子」（核心体验直接废）
 *   ⑥ 接口说「没文案」还去读 DOM  → 别人的文案记到这一条上（v2.7.8 真机事故）
 *   ⑦ 不剥「… 更多」尾巴          → 文案末尾永远挂着「… 更多」三个字
 *   ⑧ 首页也去关浮窗              → 点完按钮浮窗闪一下就没了
 *   ⑨ feedPost 标记没透传         → 走回通用策略，提到信息流别人家的内容
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2735.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const ENTRY = 'src/content/shared/instagram-entry-context.js';
const BTN = 'src/content/ui/instagram-feed-buttons.js';
const SOCIAL = 'src/content/extractors/instagram-social.js';
const HANDLER = 'src/content/ui/ig-spa-handler.js';
const MAIN = 'src/content/content-main.js';
const TEST_FILES = [path.join(__dirname, 'instagram-feed-post.test.js')];

const MUTATIONS = [
  {
    name: '① 首页判据恒真（探索页也挂按钮）',
    file: ENTRY,
    find: "    return /^\\/+$/.test(pathOf(href || ((global.location && global.location.href) || '')));",
    repl: '    return true;'
  },
  {
    name: '② 不排除弹层里的帖子',
    file: BTN,
    find: '        if (this._inDialog(article)) continue;',
    repl: '        if (false) continue;'
  },
  {
    name: '③ 作品地址正则去掉 `$` 锚（/liked_by/ 被当成作品）',
    file: BTN,
    find: "  var PERMALINK_RE = /^\\/(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]{5,30})\\/?$/;",
    repl: "  var PERMALINK_RE = /^\\/(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]{5,30})/;"
  },
  {
    name: '④ 幂等判断失效（每次 sync 多挂一颗）',
    file: BTN,
    find: '        var existing = this._ownButtonOf(article);',
    repl: '        var existing = null;'
  },
  {
    name: '⑤ 点击完全不拦（冒泡出去 = 打开帖子）',
    file: BTN,
    // 三条一起改：只删一条的话，另外两条仍然挡得住冒泡，测试照绿 ——
    // 那种「改坏仍绿」是假绿，必须整块搬走（本项目踩过多次）。
    find: '        ev.preventDefault();\n        ev.stopPropagation();\n        ev.stopImmediatePropagation();',
    repl: '        void 0;'
  },
  {
    name: '⑥ 接口说「没文案」还去读 DOM（串台）',
    file: SOCIAL,
    find: '    if (inline && inline.captionKnown) {',
    repl: '    if (inline && inline.captionKnown && inline.caption) {'
  },
  {
    name: '⑦ 不剥「… 更多」尾巴',
    file: SOCIAL,
    find: "    t = t.replace(/(?:\\u2026|\\.\\.\\.)\\s*(?:更多|more)\\s*$/i, '');",
    repl: '    t = t;'
  },
  {
    name: '⑧ 首页也去关浮窗（点完就没）',
    file: HANDLER,
    find: '      if (this._isIgFeedPage()) {',
    repl: '      if (false) {'
  },
  {
    name: '⑨ feedPost 标记没透传（走回通用策略）',
    file: MAIN,
    find: '        extractedData = await this.extractFromCurrentPage(this.activeContext, opts);',
    repl: '        extractedData = await this.extractFromCurrentPage(this.activeContext);'
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  const r = spawnSync(process.execPath, [TEST_FILES[0]], {
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

console.log('v2.7.35 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
