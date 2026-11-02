#!/usr/bin/env node
/**
 * v2.7.28 变异测试：B站个人空间提取器（bilibili-profile.js）。
 *
 *   ① 平台列写死成别站名
 *   ② 统计读 title 精确值（违反「页面原样」铁律 → 1887.7万 变 18,877,239）
 *   ③ 签名不限定 `.sign`（没签名时公告顶包）
 *   ④ 账号ID 拿昵称顶替（不读地址栏 mid）
 *   ⑤ 网址不重拼官方形态（tab 子页直接露原地址）
 *   ⑥ 统计标签配对失效（粉丝位被关注数顶包）
 *   ⑦ 简介不拼统计行
 *   ⑧ 签名的 title 兜底被删
 *
 * 规矩同 v2.7.15 ~ v2.7.27：改坏必须红、逐字节还原、find 必须唯一。
 * bilibili-profile.js 是 LF（v2.7.28 实测）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2728.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const PROFILE = 'src/content/extractors/bilibili-profile.js';
const WEIBO = 'src/content/extractors/weibo-profile.js';
const XPROF = 'src/content/extractors/x-profile.js';
const TEST_FILES = [
  path.join(__dirname, 'bilibili-profile.test.js'),
  path.join(__dirname, 'x-profile.test.js'),
  path.join(__dirname, 'weibo-profile.test.js')
];

const MUTATIONS = [
  {
    name: '① 平台列写死成别站名',
    file: PROFILE,
    find: "  async extractPlatform() {\n    return '哔哩哔哩';",
    repl: "  async extractPlatform() {\n    return '微博';"
  },
  {
    name: '② 统计读 title 精确值 → 1887.7万 变 18,877,239',
    file: PROFILE,
    find: "        return this._text(items[i].querySelector('.nav-statistics__item-num'));",
    repl: "        return this._norm(items[i].querySelector('.nav-statistics__item-num').getAttribute('title'));"
  },
  {
    name: '③ 签名不限定 .sign → 没签名时公告顶包',
    file: PROFILE,
    find: "      const el = document.querySelector('.upinfo .sign .pure-text') ||\n                 document.querySelector('.sign.header-sign .pure-text');",
    repl: "      const el = document.querySelector('.pure-text');"
  },
  {
    name: '④ 账号ID 拿昵称顶替（不读地址栏 mid）',
    file: PROFILE,
    find: '      return this._urlMid();\n    } catch (err) {\n      console.error(\'[BilibiliProfileExtractor] 提取账号ID失败:\', err);',
    repl: '      return await this.extractName();\n    } catch (err) {\n      console.error(\'[BilibiliProfileExtractor] 提取账号ID失败:\', err);'
  },
  {
    name: '⑤ 网址不重拼官方形态',
    file: PROFILE,
    find: "      return mid ? 'https://space.bilibili.com/' + mid : '';",
    repl: '      return mid ? window.location.href : \'\';'
  },
  {
    name: '⑥ 统计标签配对失效 → 粉丝位被关注数顶包',
    file: PROFILE,
    find: '        if (label.indexOf(keyword) === -1) continue;',
    repl: '        if (false) continue;'
  },
  {
    name: '⑦ 简介不拼统计行',
    file: PROFILE,
    find: '      const stats = this._statsLine();',
    repl: "      const stats = '';"
  },
  {
    name: '⑧ 签名的 title 兜底被删',
    file: PROFILE,
    find: '      return this._norm(el.getAttribute(\'title\'));',
    repl: "      return '';"
  },
  // ⑨⑩⑪ 真机踩出来的「6 个空行」：三个新提取器都必须有装配入口
  {
    name: '⑨ 微博缺 extractAllFields → 浮窗 6 个空行',
    file: WEIBO,
    find: '  async extractAllFields() {',
    repl: '  async extractAllFieldsX() {'
  },
  {
    name: '⑩ X 缺 extractAllFields → 浮窗 6 个空行',
    file: XPROF,
    find: '  async extractAllFields() {',
    repl: '  async extractAllFieldsX() {'
  },
  {
    name: '⑪ B站缺 extractAllFields → 浮窗 6 个空行',
    file: PROFILE,
    find: '  async extractAllFields() {',
    repl: '  async extractAllFieldsX() {'
  },
  {
    name: '⑫ X 简介不修锚内换行 → 链接断成 http:// / 域名 两行',
    file: XPROF,
    find: '          if (raw && flat && raw !== flat && t.indexOf(raw) > -1) {',
    repl: '          if (false) {'
  }
];

/* ======================== 执行框架 ======================== */

const problems = [];
let red = 0;

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest() {
  // ⚠️ `node a.js b.js` 只会执行 a.js（其余被当成 argv），三个测试必须逐个跑
  let text = '';
  for (const f of TEST_FILES) {
    const r = spawnSync(process.execPath, [f], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 120000,
      env: Object.assign({}, process.env, {
        NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
      })
    });
    text += (r.stdout || '') + (r.stderr || '');
    if (r.error && r.error.code === 'ETIMEDOUT') return { code: -2, text };
    const code = r.status === null ? -2 : r.status;
    if (code !== 0) return { code, text };
  }
  return { code: 0, text };
}

function failedItems(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.indexOf('✗') > -1 || l.indexOf('❌') > -1)
    .slice(0, 6)
    .map((l) => l.trim());
}

console.log('v2.7.28 变异测试 —— ' + MUTATIONS.length + ' 条\n');

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
