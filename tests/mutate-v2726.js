#!/usr/bin/env node
/**
 * v2.7.26 变异测试：微博个人主页提取器（weibo-profile.js）。
 *
 *   ① 粉丝数选择器兜底回通配 → 命中「关注」按钮，关注数 3096 顶包粉丝数
 *   ② 页面主人 uid 改从 $CONFIG 取 → 登录者 uid 1647019414 串台（本项目第五次同坑）
 *   ③ 账号ID 页头拿不到时改用自定义域名顶替 → 该留空的被瞎填
 *   ④ 统计行丢微博数
 *   ⑤ 认证说明（desc_text）不进简介 → 认证号丢一行
 *   ⑥ 详情接口 uid 改成登录者硬编码 → 把用户隐私请求到别人记录里
 *   ⑦ 网址不重拼官方形态
 *   ⑧ 账号名列不取自定义域名
 *
 * 规矩同 v2.7.15 ~ v2.7.25：改坏必须红、逐字节还原、find 必须唯一。
 * weibo-profile.js 是 LF（v2.7.26 实测）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2726.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROFILE = 'src/content/extractors/weibo-profile.js';
const TEST_FILES = [path.join(__dirname, 'weibo-profile.test.js')];

const MUTATIONS = [
  /* ---------- ① 粉丝数不能碰「关注」按钮 ---------- */
  {
    name: '① 粉丝数兜底回通配 /u/page/follow/ → 关注数 3096 顶包粉丝数',
    file: PROFILE,
    find: "      const a = document.querySelector('a[href*=\"?relate=fans\"]');",
    repl: "      const a = document.querySelector('a[href*=\"/u/page/follow/\"]');"
  },

  /* ---------- ② $CONFIG 是登录者自己 ---------- */
  {
    name: '② 页面主人 uid 改从 $CONFIG.uid 取 → 登录者串台',
    file: PROFILE,
    find: "      const a = document.querySelector('a[href*=\"?relate=fans\"]') ||\n                document.querySelector('a[href*=\"/u/page/follow/\"]');",
    repl: "      return String((typeof window !== 'undefined' && window.$CONFIG && window.$CONFIG.uid) || '');"
  },

  /* ---------- ③ 拿不到 uid 不许瞎填 ---------- */
  {
    name: '③ 账号ID 页头拿不到时用自定义域名顶替 → 该留空的被瞎填',
    file: PROFILE,
    find: "      return this._urlUid();",
    repl: "      return this._urlCustomDomain();"
  },

  /* ---------- ④ 统计行 ---------- */
  {
    name: '④ 统计行丢微博数',
    file: PROFILE,
    find: "    if (posts) parts.push('微博：' + posts);",
    repl: '    void posts;'
  },

  /* ---------- ⑤ 认证说明不许丢 ---------- */
  {
    name: '⑤ 认证说明（desc_text）不进简介 → 认证号丢一行',
    file: PROFILE,
    find: "    if (desc && desc !== sig) out.push(desc);",
    repl: '    void desc;'
  },

  /* ---------- ⑥ 详情接口 uid ---------- */
  {
    name: '⑥ 详情接口 uid 改成登录者硬编码 → 隐私写进别人记录',
    file: PROFILE,
    find: "        const resp = await fetch('/ajax/profile/detail?uid=' + encodeURIComponent(uid), {",
    repl: "        const resp = await fetch('/ajax/profile/detail?uid=' + encodeURIComponent('1647019414'), {"
  },

  /* ---------- ⑦ 网址官方形态 ---------- */
  {
    name: '⑦ 网址不重拼官方形态 /u/<uid>',
    file: PROFILE,
    find: "      if (uid) return 'https://weibo.com/u/' + uid;",
    repl: "      if (uid) return 'https://weibo.com/' + uid;"
  },

  /* ---------- ⑧ 账号名 ---------- */
  {
    name: '⑧ 账号名列不取自定义域名',
    file: PROFILE,
    find: "      return this._urlCustomDomain();",
    repl: "      return '';"
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

console.log('v2.7.26 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
