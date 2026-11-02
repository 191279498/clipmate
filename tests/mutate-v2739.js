#!/usr/bin/env node
/**
 * v2.7.39 变异测试：微博全站逐帖按钮（weibo.com / s.weibo.com / m.weibo.cn）
 *
 * 用户 2026-11-01 拍板的三件事：① 转发帖只取博主自己写的转发理由；
 * ② 搜索页要覆盖；③ 手机版要做。
 *
 * 八条变异，每条都必须红：
 *   ① 不剥正文尾部的「展开」→ 文案里会存进「展开c」这种按钮文字
 *   ② 不剥搜索页时间里的「转赞人数超过100」→ 日期解析不出来
 *   ③ 桌面版日期只读显示文本、不读 title → 「15小时前」被当成发布时间
 *   ④ 搜索页不排除「相关用户」卡片 → 非博文卡也挂一颗点了会出错的按钮
 *   ⑤ 手机版不校验桥数据里的编号 → 没有编号也造出一条记录
 *   ⑥ 只读出 1 条也挂按钮 → 详情页上冒出重复按钮
 *   ⑦ 纯转发帖的标题改回闭包内联拼 → v2.7.38 的「空文案→站名」兜底够不着，标题写「无文案」
 *   ⑧ 列表页去掉「取第一条」→ 全局按钮又拼出「第一条正文 + 列表页地址」
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一、挂死不算红。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2739.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const CONTEXT = 'src/content/shared/weibo-feed-context.js';
const BUTTONS = 'src/content/ui/weibo-feed-buttons.js';
const SOCIAL = 'src/content/extractors/weibo-social.js';

const TEST = path.join(__dirname, 'weibo-feed-post.test.js');

const MUTATIONS = [
  {
    name: '① 不剥正文尾部「展开」→ 文案存进按钮文字',
    file: CONTEXT,
    find: "    out = out.replace(EXPAND_TAIL_RE, '').trim();",
    repl: '    out = out.trim();'
  },
  {
    name: '② 不剥时间文本里的「转赞人数超过100」→ 日期解析不出来',
    file: CONTEXT,
    find: "    s = s.replace(/转赞人数超过\\s*[\\d.]+\\s*万?/g, ' ')",
    repl: '    s = s;'
  },
  {
    name: '③ 桌面版日期只读显示文本、不读 title → 「15小时前」变成发布时间',
    file: CONTEXT,
    find: "      date: normalizeDate(link.getAttribute('title') || textOf(link)),",
    repl: '      date: normalizeDate(textOf(link)),'
  },
  {
    name: '④ 搜索页不排除「相关用户」卡片 → 非博文卡也挂按钮',
    file: CONTEXT,
    find: [
      "    var from = card.querySelector('.from a');",
      '    if (!from) return null;                     // 「相关用户」「相关兴趣主页」等卡片',
      '    var match = PERMALINK_RE.exec(hrefOf(from));',
      '    if (!match) return null;'
    ].join('\n'),
    repl: [
      "    var from = card.querySelector('.from a');",
      '    // 变异：不再排除非博文卡片',
      "    var match = ['', '0', 'NOMID'];"
    ].join('\n')
  },
  {
    name: '⑤ 手机版不校验桥数据里的编号 → 没编号也造一条记录',
    file: CONTEXT,
    find: '    if (!data || !data.id) return null;',
    repl: '    if (!data) return null;'
  },
  {
    name: '⑥ 只读出 1 条也挂按钮 → 详情页冒出重复按钮',
    file: BUTTONS,
    find: '  var MIN_POSTS = 2;',
    repl: '  var MIN_POSTS = 1;'
  },
  {
    name: '⑦ 纯转发帖标题改回闭包内联拼 → 站名兜底够不着，标题写「无文案」',
    file: SOCIAL,
    find: '            return this.extractTitle(text, null, { nick: nick, date: date, uid: uid });',
    repl: "            return SocialTitleProcessor.generatePageTitle(nick || uid, text, date, { platform: 'weibo' }, uid);"
  },
  {
    name: '⑧ 列表页去掉「取第一条」→ 全局按钮拼出「第一条正文 + 列表页地址」',
    file: SOCIAL,
    find: [
      '    const firstPost = this._firstPostOnListPage();',
      '    if (firstPost) return await this._buildFeedRecord(firstPost);'
    ].join('\n'),
    repl: '    // 变异：列表页不再取第一条'
  }
];

let red = 0;
const problems = [];

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
    .slice(0, 4)
    .map((l) => l.trim());
}

/** CRLF 适配（这几个文件都是 LF，但保留这道保险） */
function shape(text, src) {
  if (typeof text !== 'string') return text;
  return /\r\n/.test(src) ? text.replace(/\n/g, '\r\n') : text;
}

console.log('v2.7.39 变异测试 —— ' + MUTATIONS.length + ' 条\n');

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = { buf: fs.readFileSync(target) };
  orig.hash = sha(orig.buf);
  const src = orig.buf.toString('utf8');
  const find = shape(m.find, src);
  const repl = shape(m.repl, src);

  if (src.indexOf(find) === -1) {
    problems.push(`${m.name} → 变异点不存在（find 没命中）`);
    console.log(`  ⚠️  ${m.name}\n      变异点不存在`);
    return;
  }
  if (src.indexOf(find) !== src.lastIndexOf(find)) {
    problems.push(`${m.name} → find 不唯一（replace 只会改第一处）`);
    console.log(`  ⚠️  ${m.name}\n      find 不唯一`);
    return;
  }

  fs.writeFileSync(target, src.replace(find, () => repl));
  const r = runTest(TEST);
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
  console.log(`  ✅ ${m.name}`);
  failedItems(r.text).forEach((l) => console.log(`       ${l}`));
});

console.log('');
if (problems.length) {
  console.log(`结论：${red}/${MUTATIONS.length} 条咬住，${problems.length} 个问题`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log(`结论：${red}/${MUTATIONS.length} 条改坏后全部变红，且逐字节还原`);
process.exit(0);
