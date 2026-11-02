#!/usr/bin/env node
/**
 * v2.7.38 变异测试：标题里的「无文案」→ 站名占位词（对社交媒体类统一）
 *
 * 两条用户需求（2026-11-01）：
 *   ① 无文案作品的标题要拼站名（`一支花Instagram帖子-2026年10月31日`），
 *      不再用老版本遗留的「无文案」三个字；
 *   ② 文案是纯 emoji / 纯标点 / 纯日韩俄泰文时，标题会被过滤器洗光，只剩「昵称-日期」，
 *      这种情况也要让站名顶上（**本页文案列保留原文**，用户拍板）。
 *
 * 六条变异，每条都必须红：
 *   ① 删掉「包 extractTitle」那一段 → IG 那种「外面传文案」的写法重新失效
 *   ② 把「洗光」判定恒置 false → 纯 emoji 文案不再走兜底
 *   ③ 文案列无条件覆盖成站名 → 用户的「保留原文」被破坏
 *   ④ 洗光时不再重写标题 → 标题又只剩「昵称-日期」
 *   ⑤ 标题过滤白名单去掉小写字母 → 纯英文文案被误判成「洗光」
 *   ⑥ IG 首页的标题改回内联拼 → 绕过统一入口，标题重新写「无文案」
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2738.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const BUILDER = 'src/content/shared/social-fields-builder.js';
const PROCESSOR = 'src/content/shared/social-title-processor.js';
const SOCIAL = 'src/content/extractors/instagram-social.js';

const EMPTY_TEST = path.join(__dirname, 'social-empty-text-fallback.test.js');
const FEED_TEST = path.join(__dirname, 'instagram-feed-post.test.js');

const MUTATIONS = [
  {
    name: '① 删掉「包 extractTitle」→ IG 那种外面传文案的写法重新失效',
    file: BUILDER,
    test: EMPTY_TEST,
    find: [
      '    let origTitle = null;',
      '    if (typeof extractor.extractTitle === \'function\') {',
      '      origTitle = extractor.extractTitle;',
      '      extractor.extractTitle = function () {',
      '        const args = Array.prototype.slice.call(arguments);',
      '        return origTitle.apply(this, [fallbackText].concat(args.slice(1)));',
      '      };',
      '    }'
    ].join('\n'),
    repl: '    let origTitle = null;'
  },
  {
    name: '② 「洗光」判定恒置 false → 纯 emoji 文案不再走兜底',
    file: BUILDER,
    test: EMPTY_TEST,
    find: '      const textBlankForTitle = !textIsBlank && isTextBlankAfterTitleFilter(rawText);',
    repl: '      const textBlankForTitle = false;'
  },
  {
    name: '③ 文案列无条件覆盖成站名 → 「保留原文」被破坏',
    file: BUILDER,
    test: EMPTY_TEST,
    find: '          if (textIsBlank) record[\'本页文案\'] = fallbackText;',
    repl: '          record[\'本页文案\'] = fallbackText;'
  },
  {
    name: '④ 洗光时不再重写标题 → 标题又只剩「昵称-日期」',
    file: BUILDER,
    test: EMPTY_TEST,
    find: '          if (textIsBlank ? titleHasPlaceholder : true) {',
    repl: '          if (textIsBlank ? titleHasPlaceholder : false) {'
  },
  {
    name: '⑤ 标题过滤白名单去掉小写字母 → 纯英文被误判成「洗光」',
    file: PROCESSOR,
    test: EMPTY_TEST,
    find: "    s = s.replace(/[^\\u4e00-\\u9fff0-9a-zA-Z_-]/g, '');",
    repl: "    s = s.replace(/[^\\u4e00-\\u9fff0-9A-Z-]/g, '');"
  },
  {
    name: '⑥ IG 首页标题改回内联拼 → 绕过统一入口，标题重新写「无文案」',
    file: SOCIAL,
    test: FEED_TEST,
    find: [
      "        '本页标题': () => this.extractTitle(caption, article, {",
      '          authorName: nickname,',
      '          authorId: author,',
      '          publishDate: date',
      '        }),'
    ].join('\n'),
    repl: [
      "        '本页标题': () => SocialTitleProcessor.generatePageTitle(nickname, caption, date, {",
      "          platform: 'instagram'",
      '        }, author),'
    ].join('\n')
  }
];

/* ======================== 执行框架（与 mutate-v2737 同一套） ======================== */

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

console.log('v2.7.38 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
