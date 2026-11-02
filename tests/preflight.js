#!/usr/bin/env node
/**
 * 发布前自检（一条命令出结论）
 *
 *   node tests/preflight.js              全跑：语法 → 清单对账 → 快照回归 → 成品比对
 *   node tests/preflight.js --fast       跳过快照（改的是文档/注释时用）
 *
 * 任何一步失败，退出码非 0。按项目规矩：每批结束、出成品之前跑一遍。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const env = require('./lib/env');

const FAST = process.argv.includes('--fast');
const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

const results = [];
function step(name, okFlag, detail) {
  results.push({ name, ok: okFlag, detail });
  console.log(`  ${okFlag ? C.green + '✅' : C.red + '❌'}${C.reset} ${name}${detail ? `  ${C.gray}${detail}${C.reset}` : ''}`);
}

function walk(dir, base = dir) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------- 1. 语法检查 ----------
function checkSyntax() {
  console.log(`\n${C.cyan}1. 语法检查（node --check）${C.reset}`);
  const files = walk(env.SRC).filter((f) => f.endsWith('.js'));
  const unique = [...new Set(files)];
  const failed = [];
  for (const rel of unique) {
    const r = spawnSync(process.execPath, ['--check', path.join(env.SRC, rel)], { encoding: 'utf8' });
    if (r.status !== 0) failed.push({ rel, err: (r.stderr || '').split('\n').slice(0, 3).join(' ') });
  }
  if (failed.length) {
    for (const f of failed) console.log(`     ${C.red}${f.rel}${C.reset} ${f.err}`);
    step(`语法检查（${unique.length} 个 js）`, false, `${failed.length} 个文件报错`);
    return false;
  }
  step(`语法检查（${unique.length} 个 js）`, true, '全部通过');
  return true;
}

// ---------- 2. manifest 自检 ----------
function checkManifest() {
  console.log(`\n${C.cyan}2. manifest 自检${C.reset}`);
  const m = env.manifest;
  let ok = true;

  const verOk = /^\d+\.\d+\.\d+$/.test(m.version || '');
  step('版本号格式', verOk, verOk ? 'v' + m.version : String(m.version));
  ok = ok && verOk;

  const cs = m.content_scripts || [];
  const dupJs = [];
  const missing = [];
  cs.forEach((entry, i) => {
    const seen = new Set();
    for (const rel of entry.js || []) {
      if (seen.has(rel)) dupJs.push(rel);
      seen.add(rel);
      if (!fs.existsSync(path.join(env.SRC, rel))) missing.push(rel);
    }
    if (!entry.matches || !entry.matches.length) missing.push(`content_scripts[${i}].matches 为空`);
  });
  step('脚本文件都存在', missing.length === 0, missing.length ? missing.join(', ') : `${cs[0].js.length} 个`);
  ok = ok && missing.length === 0;
  if (dupJs.length) { step('没有重复加载', false, dupJs.join(', ')); ok = false; }
  else step('没有重复加载', true, '');

  // 测试目录不能混进扩展包里（否则会被打进 zip 交给用户）
  const leaked = fs.existsSync(path.join(env.SRC, 'tests')) || fs.existsSync(path.join(env.SRC, 'node_modules'));
  step('扩展目录里没有测试/依赖垃圾', !leaked, leaked ? 'ClipMate_chrome 下出现了 tests/ 或 node_modules/' : '');
  ok = ok && !leaked;

  return ok;
}

function runChild(script, args = []) {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: process.env.NODE_PATH || '' }
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ---------- 3. 站点清单对账 ----------
function checkRegistry() {
  console.log(`\n${C.cyan}3. 站点清单对账（check-registry.js）${C.reset}`);
  const r = runChild('check-registry.js');
  const lines = r.out.split('\n');
  const pass = lines.filter((l) => l.includes('✅')).length;
  const warn = lines.filter((l) => l.includes('⚠')).length;
  const fail = lines.filter((l) => l.includes('❌')).length;
  if (r.code !== 0) {
    for (const l of lines.filter((x) => x.includes('❌'))) console.log('     ' + l.trim());
    step('清单对账', false, `${fail} 项不通过`);
    return false;
  }
  step('清单对账', true, `${pass} 项通过，${warn} 项提示`);
  return true;
}

// ---------- 4. 提取快照回归 ----------
function checkSnapshot() {
  console.log(`\n${C.cyan}4. 提取快照回归（snapshot.js）${C.reset}`);
  if (FAST) {
    console.log(`  ${C.yellow}⏭${C.reset}  已按 --fast 跳过（只改了文档/注释时可以用）`);
    return true;
  }
  const r = runChild('snapshot.js');
  const lines = r.out.split('\n');
  const same = lines.filter((l) => l.includes('✅')).length;
  if (r.code !== 0) {
    for (const l of lines) {
      if (l.includes('❌') || l.includes('    旧:') || l.includes('    新:') || l.includes('      旧:') || l.includes('      新:')) {
        console.log('     ' + l.trim());
      }
    }
    step('快照回归', false, '提取结果有变化（见上）');
    return false;
  }
  step('快照回归', true, `${same} 个样本与基线一致`);
  return true;
}

// ---------- 5. 成品比对 ----------
function checkPackage() {
  console.log(`\n${C.cyan}5. 与最新成品比对${C.reset}`);
  const distRoot = path.join(env.ROOT, '发行包');
  if (!fs.existsSync(distRoot)) {
    console.log(`  ${C.gray}· 还没有发行包目录，跳过${C.reset}`);
    return true;
  }
  const dirs = fs.readdirSync(distRoot)
    .map((d) => { const m = /_v(\d+\.\d+\.\d+)_chrome$/.exec(d); return m ? { name: d, ver: m[1] } : null; })
    .filter(Boolean)
    .sort((a, b) => {
      const A = a.ver.split('.').map(Number); const B = b.ver.split('.').map(Number);
      for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
      return 0;
    });
  if (!dirs.length) {
    console.log(`  ${C.gray}· 没有 chrome 成品文件夹，跳过${C.reset}`);
    return true;
  }
  const latest = dirs[dirs.length - 1];
  const latestDir = path.join(distRoot, latest.name);
  const srcFiles = walk(env.SRC);
  const pkgFiles = walk(latestDir);

  const onlySrc = srcFiles.filter((f) => !pkgFiles.includes(f));
  const onlyPkg = pkgFiles.filter((f) => !srcFiles.includes(f));

  console.log(`  ${C.gray}最新成品：${latest.name}（${pkgFiles.length} 个文件）｜源码 ${srcFiles.length} 个${C.reset}`);
  if (onlySrc.length) console.log(`  ${C.gray}仅在源码里：${onlySrc.join(', ')}${C.reset}`);
  if (onlyPkg.length) console.log(`  ${C.gray}仅在成品里：${onlyPkg.join(', ')}${C.reset}`);

  // 逐文件哈希，列出内容有差异的
  const changed = [];
  for (const rel of srcFiles) {
    if (!pkgFiles.includes(rel)) continue;
    if (sha256(path.join(env.SRC, rel)) !== sha256(path.join(latestDir, rel))) changed.push(rel);
  }

  const sameVersion = latest.ver === env.manifest.version;
  if (sameVersion && changed.length) {
    console.log(`  ${C.yellow}⚠${C.reset}  版本号仍是 v${env.manifest.version}，但已有 ${changed.length} 个文件与成品不同：${changed.slice(0, 8).join(', ')}${changed.length > 8 ? ' …' : ''}`);
    console.log(`     按项目规矩，改了代码就要更版本 + 出新的成品文件夹。`);
  }

  step('成品比对', true, sameVersion
    ? (changed.length ? `${changed.length} 个文件已改动（这批还没出成品）` : '与成品完全一致')
    : `源码已升级到 v${env.manifest.version}，成品最新是 v${latest.ver}`);

  if (changed.length > 12) {
    console.log(`  ${C.gray}改动文件较多（${changed.length} 个），这批值得在报告里逐条说明${C.reset}`);
  }
  return true;
}

// ---------- 汇总 ----------
function main() {
  console.log(`${C.cyan}采媒灵发布前自检${C.reset}  源码 v${env.manifest.version}｜${new Date().toLocaleString('zh-CN')}`);
  checkSyntax();
  checkManifest();
  checkRegistry();
  checkSnapshot();
  checkPackage();

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.log(`${C.red}结论：${failed.length} 项不通过${C.reset} — ${failed.map((f) => f.name).join('、')}`);
    process.exit(1);
  }
  console.log(`${C.green}结论：可以出成品${C.reset}（${results.length} 项全过）`);
  process.exit(0);
}

main();
