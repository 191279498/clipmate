#!/usr/bin/env node
/**
 * v2.7.43 变异测试：X（推特）逐帖按钮
 *
 * 全部锚定 2026-11-01 真机勘察出的事故点，11 条，每条都必须红：
 *   ① emoji 的 alt 拼回去掉 → 「美得太过分了 🥰」洗成「美得太过分了」（X 独有坑）
 *   ② 编号正则去掉 `$` 锚 → /analytics 等变体混进编号，拼出点不开的地址
 *   ③ 引用归属判恒 false → 引用帖拿被引用那条的正文顶包（用户拍板只取外层）
 *   ④ MIN_POSTS 2→1 → 单条详情视图也挂按钮（和全局按钮重复，用户拍板主贴不挂）
 *   ⑤ 按钮竖向落点写死 → 转推卡（「⋯」在 top 28）压字（微博搜索页同款坑）
 *   ⑥ 空文案不留给装配器 → 文案写「无文案」（v2.7.38 铁律：标题不许出现这三个字）
 *   ⑦ 逐帖提取丢掉 forceMediaType → 作者主页被人物档案提取器抢走，6 列空表
 *      （微博 v2.7.39 真机同款事故）
 *   ⑧ 横向避让失效 → 按钮压住「Grok 操作」按钮（v2.7.44 真机复验发现的事故）
 *   ⑨ 避让退回「只扫 caret 父层」→ v2.7.44 真机证明 X 操作行没有 role=group，
 *      老写法必然扫不到「Grok 操作」，按钮照旧压在它上面（v2.7.45 修的就是这条）
 *   ⑩ 忘了排除自己挂的按钮 → 它自己被当成紧邻控件，位置自我带偏（76 → 70）
 *   ⑪ 「紧邻」判据不设限 → 远处的日期链接被当成紧邻控件，按钮跑到操作行正中间
 *
 * 规矩同前：改坏必须红、逐字节还原、find 必须唯一。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2743.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const CONTEXT = 'src/content/shared/x-feed-context.js';
const BUTTONS = 'src/content/ui/x-feed-buttons.js';
const SOCIAL = 'src/content/extractors/x-social.js';
const HANDLER = 'src/content/ui/x-spa-handler.js';
const X_TEST = path.join(__dirname, 'x-feed-post.test.js');

const MUTATIONS = [
  {
    name: '① emoji 的 alt 拼回去掉 → 正文洗掉表情',
    file: CONTEXT,
    test: X_TEST,
    find: "          out += child.getAttribute('alt') || '';",
    repl: "          out += '';"
  },
  {
    name: '② 编号正则去掉 $ 锚 → /analytics 变体混进编号',
    file: CONTEXT,
    test: X_TEST,
    find: "  var STATUS_HREF_RE = /^\\/([A-Za-z0-9_]+)\\/status\\/(\\d+)$/;",
    repl: "  var STATUS_HREF_RE = /^\\/([A-Za-z0-9_]+)\\/status\\/(\\d+)/;"
  },
  {
    name: '③ 引用归属判恒 false → 引用帖拿被引用正文顶包',
    file: CONTEXT,
    test: X_TEST,
    find: '      return !!(el && el.closest && el.closest(QUOTE_SELECTOR));',
    repl: '      return false;'
  },
  {
    name: '④ MIN_POSTS 2→1 → 单条详情视图也挂按钮',
    file: BUTTONS,
    test: X_TEST,
    find: '  var MIN_POSTS = 2;',
    repl: '  var MIN_POSTS = 1;'
  },
  {
    name: '⑤ 按钮竖向落点写死 → 转推卡压字',
    file: BUTTONS,
    test: X_TEST,
    find: '        return Math.round(cr.top - ar.top + (cr.height - BTN_SIZE) / 2);',
    repl: '        return 12;'
  },
  {
    name: '⑥ 空文案自己填「无文案」→ 绕开装配器兜底（标题会出现这三个字）',
    file: SOCIAL,
    test: X_TEST,
    find: "        '本页文案': text,",
    repl: "        '本页文案': text || '无文案',"
  },
  {
    name: "⑦ 逐帖提取丢掉 forceMediaType:'social' → 作者主页被 person 抢走",
    file: HANDLER,
    test: X_TEST,
    find: "          forceMediaType: 'social'",
    repl: "          forceMediaType: undefined"
  },
  {
    name: '⑧ 横向避让失效 → 按钮压住「Grok 操作」按钮（v2.7.44 真机事故）',
    file: BUTTONS,
    test: X_TEST,
    find: '        return Math.round(ar.right - nearest + SIDE_GAP);   // 右缘贴到它左边，留 6px 间隙',
    repl: '        return null;'
  },
  {
    name: '⑨ 横向避让退回「只扫 caret 父层」（v2.7.44 的老写法）→ 真机必然扫不到 Grok',
    file: BUTTONS,
    test: X_TEST,
    find: "        var ctrls = container.querySelectorAll('button, a[href], [role=\"button\"]');",
    repl: "        var ctrls = caret.parentElement.querySelectorAll('button, a[href], [role=\"button\"]');"
  },
  {
    name: '⑩ 忘了排除自己挂的按钮 → 位置自我带偏（76 → 70）',
    file: BUTTONS,
    test: X_TEST,
    find: '          if (el.classList && el.classList.contains(BTN_CLASS)) continue;',
    repl: '          // 变异：忘了排除自己'
  },
  {
    name: '⑪ 「紧邻」判据放宽成不设限 → 远处的日期链接被当成紧邻控件，按钮跑到操作行中间',
    file: BUTTONS,
    test: X_TEST,
    find: '          if (cr.left - r.right > NEAR_GAP) continue;',
    repl: '          // 变异：不判断远近'
  }
];

/* ======================== 执行框架（与 mutate-v2742 同一套） ======================== */

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

console.log('v2.7.43 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
