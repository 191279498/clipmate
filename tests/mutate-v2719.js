#!/usr/bin/env node
/**
 * v2.7.19 变异测试：把「个人主页不许摘按钮」改坏，测试必须变红。
 *
 * 每条变异：改坏 → 跑 kuaishou-route.test.js 期望**失败** → 逐字节还原（sha256 比对）。
 * 绿着不改红 = 断言没咬住；改坏后挂死 = 看门狗兜底（exit 1）。
 *
 * 用法：
 *   NODE_PATH=... node tests/mutate-v2719.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const TARGET = path.join(ROOT, 'src/content/ui/kuaishou-route-watcher.js');
const TEST = path.join(__dirname, 'kuaishou-route.test.js');

const original = fs.readFileSync(TARGET);
const originalHash = crypto.createHash('sha256').update(original).digest('hex');

const MUTATIONS = [
  {
    name: '① 启动时去掉主页门禁（回到 v2.7.18 的老实现）',
    find: `      if (!this._ksRouteIsDetail(location.pathname) && !this._ksRouteIsProfile(location.pathname)) {
        this._ksRouteHideButton();
      }`,
    repl: `      if (!this._ksRouteIsDetail(location.pathname)) {
        this._ksRouteHideButton();
      }`
  },
  {
    name: '② 离开详情页时不认主页（退回主页照样摘按钮）',
    find: `      if (this._ksRouteIsProfile(location.pathname)) {
        this._ksRouteRestoreProfilePerson();`,
    repl: `      if (false) {
        this._ksRouteRestoreProfilePerson();`
  },
  {
    name: '③ 主页正则改成认不出真机 ID（15 位）',
    find: `var PROFILE_RE = /^\\/profile\\/[A-Za-z0-9_-]{6,64}\\/?$/;`,
    repl: `var PROFILE_RE = /^\\/profile\\/[A-Za-z0-9_-]{20,64}\\/?$/;`
  },
  {
    name: '④ 回切后不恢复 isInitialized',
    find: `      var done = function () {
        self.isInitialized = true;
        self._ksRouteShowButton();
      };`,
    repl: `      var done = function () {
        self._ksRouteShowButton();
      };`
  },
  {
    name: '⑤ 回切时不换模板（只留按钮，仍是 social 7 列）',
    find: `          Promise.resolve(this._restoreKuaishouProfilePerson())`,
    repl: `          Promise.resolve(null)`
  },
  {
    name: '⑥ 进详情页复用旧映射器（主页跳过去仍是 6 列人物）',
    find: `      if (!this.fieldMapper || this._ksMapperType !== 'social') {
        this.fieldMapper = await this.initFieldMapper('social');
        this._ksMapperType = 'social';
      }`,
    repl: `      if (!this.fieldMapper) {
        this.fieldMapper = await this.initFieldMapper('social');
      }`
  }
];

function runTest() {
  const r = spawnSync(process.execPath, [TEST], {
    encoding: 'utf8',
    timeout: 180000,
    env: Object.assign({}, process.env)
  });
  if (r.error) return { code: -1, text: String(r.error && r.error.message) };
  return { code: r.status, text: (r.stdout || '') + (r.stderr || '') };
}

function lastFailures(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  lines.forEach((l) => { if (/\s+-\s/.test(l) && l.indexOf('::') > -1) out.push(l.trim()); });
  return out.slice(0, 3);
}

let red = 0;
const problems = [];

MUTATIONS.forEach((m) => {
  const src = fs.readFileSync(TARGET, 'utf8');
  if (src.indexOf(m.find) < 0) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，等于没验证）`);
    return;
  }
  fs.writeFileSync(TARGET, src.replace(m.find, m.repl));

  const r = runTest();
  fs.writeFileSync(TARGET, original);
  const nowHash = crypto.createHash('sha256').update(fs.readFileSync(TARGET)).digest('hex');
  if (nowHash !== originalHash) {
    problems.push(`${m.name} → 还原失败（sha256 不一致）`);
    return;
  }

  if (r.code === 0) {
    problems.push(`${m.name} → 改坏了还是绿的（断言没咬住）`);
    return;
  }
  red++;
  console.log(`  ✅ ${m.name}`);
  console.log(`     变红（exit=${r.code}）${lastFailures(r.text).map((x) => '\n       ' + x).join('')}`);
});

console.log('');
console.log(`变异 ${red}/${MUTATIONS.length} 变红，源文件 sha256 ${originalHash.slice(0, 16)}…`);
if (problems.length) {
  console.log('');
  problems.forEach((p) => console.log('  ❌ ' + p));
  process.exit(1);
}
console.log('全部变异都能变红，且已逐字节还原。');
