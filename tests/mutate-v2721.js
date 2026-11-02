#!/usr/bin/env node
/**
 * v2.7.21 变异测试：把这一版修的三处逐项改坏，测试必须变红。
 *
 * 这一版修的是真机验收咬出来的三个问题：
 *   ① 粉丝/帖子被存成接口精确值（页面 `5.5万` → 存 `55468`）——
 *      因为真机的标签是**纯文字节点**，v2.7.20 只写了「按标签 span 配对」，一次都没走通；
 *   ② 弹层存下来的网址是 `…/p/<code>/liked_by/`（点赞列表），不是帖子永久链接；
 *   ③ 弹层作者昵称显示成 username（meta 是上一次整页加载的，弹层里不更新）。
 *
 * 规矩（与 v2.7.15 ~ v2.7.20 同一套）：
 *   · 改坏 → 跑测试期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不算红）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2721.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');

const TEST_FILES = [
  path.join(__dirname, 'instagram-profile.test.js'),
  path.join(__dirname, 'instagram-author-homepage.test.js')
];

const PROFILE = 'src/content/extractors/instagram-profile.js';
const SOCIAL = 'src/content/extractors/instagram-social.js';

const MUTATIONS = [
  {
    name: '① 统计不认「标签是文字节点」的形态（退回只按标签 span 配对）',
    file: PROFILE,
    find: `    return this._statFromLines(labelRe);`,
    repl: `    return '';`
  },
  {
    name: '② 逐行配对不校验标签词（「粉丝包括xxx +12人」会被认成粉丝数）',
    file: PROFILE,
    find: `      if (m && LABEL_WORDS.test(m[2].trim()) && labelRe.test(m[2].trim())) {`,
    repl: `      if (m) {`
  },
  {
    name: '③ 数字不认「万/亿/K/M/B」单位（1661万 被截成 1661）',
    file: PROFILE,
    find: `    const NUM = '([\\\\d.,]+\\\\s*[万亿KMB]?)';`,
    repl: `    const NUM = '([\\\\d.,]+)';`
  },
  {
    name: '④ 弹层网址只判「含 /p/」（退回旧写法，会被点赞列表抢走）',
    file: SOCIAL,
    find: `        if (!/^\\/(?:[A-Za-z0-9_.]+\\/)?(?:p|reel|reels|tv)\\/[A-Za-z0-9_-]{5,20}\\/?$/.test(href)) continue;`,
    repl: `        /* 变异：放行一切含 /p/、/reel 的链接 */`
  },
  {
    name: '⑤ 作者昵称不用桥节点（弹层里又显示成 username）',
    file: SOCIAL,
    find: `      const bridgeNick = this._igBridgeNickname(context);
      if (bridgeNick) {
        return bridgeNick;
      }`,
    repl: `      /* 变异：不用桥节点里的显示名 */`
  },
  {
    name: '⑥ 桥节点取昵称时不按作者 username 查（查了个空 key，拿不到显示名）',
    file: SOCIAL,
    find: `        const p = src.findProfile(username);`,
    repl: `        const p = src.findProfile('');`
  }
];

/** 读原始字节（还原要逐字节，不能用字符串写回） */
const cache = Object.create(null);
function original(rel) {
  if (!cache[rel]) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    cache[rel] = { buf, hash: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  return cache[rel];
}

function runTest() {
  let out = '';
  for (const t of TEST_FILES) {
    const r = spawnSync(process.execPath, [t], {
      encoding: 'utf8',
      timeout: 180000,
      env: Object.assign({}, process.env)
    });
    if (r.error) return { code: -1, text: String(r.error && r.error.message) };
    if (r.signal) return { code: -2, text: '被信号终止：' + r.signal };
    out += (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) return { code: r.status, text: out };
  }
  return { code: 0, text: out };
}

/** 从测试输出里挑出失败项（格式：`  - 名字`） */
function failedItems(text) {
  const out = [];
  String(text || '').split('\n').forEach((l) => {
    const m = l.match(/^\s{2}-\s(.+)$/);
    if (m) out.push(m[1].trim());
  });
  return out.slice(0, 3);
}

let red = 0;
const problems = [];

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = original(m.file);
  const src = orig.buf.toString('utf8');

  if (src.indexOf(m.find) < 0) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，等于没验证）`);
    return;
  }

  fs.writeFileSync(target, src.replace(m.find, m.repl));

  const r = runTest();

  // 无论测试结果如何，先逐字节还原
  fs.writeFileSync(target, orig.buf);
  const nowHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (nowHash !== orig.hash) {
    problems.push(`${m.name} → 还原失败（sha256 不一致）`);
    return;
  }

  if (r.code === 0) {
    problems.push(`${m.name} → 改坏了还是绿的（断言没咬住）`);
    return;
  }
  if (r.code === -2) {
    problems.push(`${m.name} → 挂死/超时，不算红`);
    return;
  }

  red++;
  console.log(`  ✅ ${m.name}`);
  console.log(`     变红（exit=${r.code}）${failedItems(r.text).map((x) => '\n       ✗ ' + x).join('')}`);
});

console.log('');
console.log(`变异 ${red}/${MUTATIONS.length} 变红`);
if (problems.length) {
  console.log('');
  problems.forEach((p) => console.log('  ❌ ' + p));
  process.exit(1);
}
console.log('全部变异都能变红，且已逐字节还原。');
