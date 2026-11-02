#!/usr/bin/env node
/**
 * v2.7.24 变异测试：这版改了三件事，逐项改坏，测试必须变红。
 *
 *   ① 作品页「作者主页」兜底按 ID 形态分流（修 /channel/handle 404）
 *   ② `_ytInitialText()` 优先挑含 `"pageHeaderRenderer"` 的脚本（修真死路径）
 *   ③ 新增 about 页数据源（国家 / 加入日期 / 总观看 / 外链 / 邮箱只读 DOM）
 *
 * 规矩（与 v2.7.15 ~ v2.7.23 同一套）：
 *   · 改坏 → 跑测试期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不算红）；
 *   · 替换必须用**函数式**（`replace(find, () => repl)`）——
 *     repl 里的 `$` 会被 String.replace 当特殊模式（v2.7.23 踩过，文件暴涨 15KB）。
 *
 * 两个文件都是 **LF**（v2.7.24 实测：youtube-profile 956 LF / youtube-social 693 LF）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2724.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROFILE = 'src/content/extractors/youtube-profile.js';
const SOCIAL = 'src/content/extractors/youtube-social.js';

const TEST_FILES = [path.join(__dirname, 'youtube-profile.test.js')];

const MUTATIONS = [
  /* ---------- 修 bug ②：选对数据块脚本 ---------- */
  {
    name: '① 数据块退回「含 ytInitialData 就取第一个」→ 恒取播放器开关脚本（死路径复发）',
    file: PROFILE,
    find: `        if (t.indexOf('"pageHeaderRenderer"') > -1) {`,
    repl: `        if (true) {`
  },

  /* ---------- 修 bug ①：作品页作者主页 ---------- */
  {
    name: '② 作者主页兜底退回「非 Shorts 就拼 /channel/」→ handle 拼成 404',
    file: SOCIAL,
    find: `        const homepageUrl = isChannelId
          ? \`\${YOUTUBE_ORIGIN}/channel/\${authorId}\`
          : \`\${YOUTUBE_ORIGIN}/@\${authorId}\`;`,
    repl: `        const homepageUrl = isShorts
          ? \`\${YOUTUBE_ORIGIN}/@\${authorId}\`
          : \`\${YOUTUBE_ORIGIN}/channel/\${authorId}\`;`
  },

  /* ---------- ③ about 数据源：取数 ---------- */
  {
    name: '③ 不认 /@handle 形态 → 主页永远 fetch 不到 about',
    file: PROFILE,
    find: `    if (handle) return '/@' + handle + '/about';`,
    repl: `    if (false) return '/@' + handle + '/about';`
  },
  {
    name: '④ 括号配平不处理转义 → 简介带英文引号时整份解析失败',
    file: PROFILE,
    find: `      if (c === '\\\\') { esc = true; continue; }`,
    repl: `      if (false) { esc = true; continue; }`
  },
  {
    name: '⑤ 统计不再用 about 兜底 → 数据块/DOM 都读不到时整行消失',
    file: PROFILE,
    find: `                 this._pickStat(this._textOf(about && about.subscriberCountText), '位订阅者|subscribers?');`,
    repl: `                 '';`
  },
  {
    name: '⑥ 账号ID 不再从 about.channelId 取 → /@handle/about 页账号ID 留空',
    file: PROFILE,
    find: `      if (about && about.channelId) return String(about.channelId);`,
    repl: `      if (false) return String(about.channelId);`
  },

  /* ---------- ③ about 数据源：防串台 ---------- */
  {
    name: '⑦ 不比对 channelId → 别人频道的 about 数据也照用（串台）',
    file: PROFILE,
    find: `      if (fromScripts && this._aboutMatchesLocation(fromScripts)) {`,
    repl: `      if (fromScripts) {`
  },
  {
    name: '⑧ 闸口只剩 handle 比对（=/@handle 入口只自己证明自己）',
    file: PROFILE,
    find: `    const ldUc = e ? this._ucFrom(e.url) : '';
    if (ldUc) return aboutId === ldUc.toLowerCase();`,
    repl: `    const ldUc = '';
    if (ldUc) return aboutId === ldUc.toLowerCase();`
  },

  /* ---------- ③ 简介拼装 ---------- */
  {
    name: '⑨ 不剥「注册」尾巴 → 写成「加入日期：2006年8月29日注册」',
    file: PROFILE,
    find: `      .replace(/\\s*(?:注册|加入)\\s*$/, '')`,
    repl: `      .replace(/\\s*(?:ZZZZZ)\\s*$/, '')`
  },
  {
    name: '⑩ 丢掉国家行',
    file: PROFILE,
    find: `    if (country) lines.push('国家：' + country);`,
    repl: `    if (false) lines.push('国家：' + country);`
  },
  {
    name: '⑪ 丢掉总观看行',
    file: PROFILE,
    find: `    if (views) lines.push('总观看：' + views);`,
    repl: `    if (false) lines.push('总观看：' + views);`
  },
  {
    name: '⑫ 不用 about.links 兜底 → 只有 JSON-LD 没 sameAs 时外链全丢',
    file: PROFILE,
    find: `    if (about && Array.isArray(about.links)) {`,
    repl: `    if (false && about && Array.isArray(about.links)) {`
  },
  {
    name: '⑬ 不取 links 里的 redirect 目标 → 退回显示文本（存成 https://mediastorm.com）',
    file: PROFILE,
    find: `        if (url) return String(url);`,
    repl: `        if (false) return String(url);`
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  const args = TEST_FILES;
  const r = spawnSync(process.execPath, args, {
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

console.log('v2.7.24 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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

  // 函数式替换：repl 里含 `$` 时避免被当成特殊模式
  fs.writeFileSync(target, src.replace(m.find, () => m.repl));

  const r = runTest();

  // 无论结果如何，先逐字节还原
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
    console.log(`  ❌ ${m.name}\n      挂死`);
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
