#!/usr/bin/env node
/**
 * 提取结果快照回归
 *
 *   node tests/snapshot.js                 跑全部样本，和基线比对（有差异 → 退出码 1）
 *   node tests/snapshot.js --update        把当前结果写成新基线（改提取逻辑、且确认新结果正确时才用）
 *   node tests/snapshot.js --only=17k      只跑 id 里含 "17k" 的样本
 *   node tests/snapshot.js --verbose       打印每个样本提取到的全部字段
 *
 * 这是"不许影响提取功能"这条红线的机器护栏：
 * 改完代码跑一遍，字段有任何变化都会被抓出来，并且能直接看到 旧值 → 新值。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const H = require('./lib/harness');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const VERBOSE = args.includes('--verbose');
const onlyArg = args.find((a) => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.slice('--only='.length) : '';

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

/**
 * 页面自带的播放器 SDK（抖音弹窗里的 xgplayer）在 jsdom 里会「加载超时」，
 * 并以未处理的 Promise 拒绝形式抛到 node 进程 —— 它不是扩展的问题、也不影响字段，
 * 但会让整个快照跑批直接退出（实测崩在 douyin-modal-search 那条）。
 * 只吞已知的页面 SDK 噪声，其他未处理拒绝照旧当错误报出来。
 */
const PAGE_SDK_NOISE = /xgplayer|sdk load timeout|Script error/i;
const ignoredPageNoise = [];
process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (PAGE_SDK_NOISE.test(msg)) {
    ignoredPageNoise.push(msg);
    return;
  }
  console.error(`${C.red}未处理的 Promise 拒绝：${msg}${C.reset}`);
  process.exitCode = 1;
});

function short(v, max = 120) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s == null) return String(s);
  return s.length > max ? s.slice(0, max) + `…(${s.length}字)` : s;
}

function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'registry.json'), 'utf8'));
  return raw.fixtures || [];
}

/** 只比对真正重要的部分；mode/extractor 单独报，不算字段差异 */
function comparable(snapshot) {
  return snapshot && snapshot.data ? snapshot.data : {};
}

function diffData(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const out = [];
  for (const key of [...keys].sort()) {
    const a = prev ? prev[key] : undefined;
    const b = next ? next[key] : undefined;
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa === sb) continue;
    let kind = 'changed';
    if (a === undefined) kind = 'added';
    else if (b === undefined) kind = 'removed';
    out.push({ key, kind, before: a, after: b });
  }
  return out;
}

async function runFixture(fx, mediaConfigs) {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, fx.file), 'utf8');
  const page = await H.openPage({ url: fx.url, html, mediaConfigs });
  const warnings = [];
  let result = null;
  let error = null;

  try {
    const instance = await H.waitForInit(page);
    if (instance && instance.isInitialized) {
      result = await H.runRealPath(page, instance);
    } else if (fx.noEntry) {
      // v2.5.77 批 1：这类页面（抖音的弹窗入口：精选/搜索/用户主页…）本来就「没有可提取的详情页」，
      // media-detector 返回 null 是**预期行为**，不是「初始化失败」。不能拿兜底链路硬凑一份字段。
      // 快照记 mode=no-entry + 空字段；「按钮必须不存在」由 tests/douyin-inject-scope.test.js 断言。
      const buttonCount = page.window.document.querySelectorAll('.media-extractor-button').length;
      warnings.push(`本页按设计不出提取入口（noEntry），实测按钮数=${buttonCount}`);
      result = { mode: 'no-entry', extractor: '', mediaTypeUsed: null, data: {} };
    } else {
      warnings.push('页面未完成自动初始化（content-main.init 未走完）→ 走兜底链路');
      result = await H.runFallbackPath(page, fx);
    }
  } catch (err) {
    error = err;
    if (!/兜底/.test(String(err && err.message))) {
      // 真链路失败时再试一次兜底，尽量给出可比对的结果
      try {
        result = await H.runFallbackPath(page, fx);
        warnings.push('真链路抛错，已回退兜底：' + (err && err.message));
        error = null;
      } catch (err2) {
        error = err2;
      }
    }
  } finally {
    try { page.window.close(); } catch (e) { /* ignore */ }
  }

  if (error) {
    return { id: fx.id, site: fx.site, url: fx.url, error: String((error && error.message) || error), warnings };
  }

  const snapshot = {
    id: fx.id,
    site: fx.site,
    url: fx.url,
    extensionVersion: env.manifest.version,
    mode: result.mode,
    extractor: result.extractor,
    mediaTypeUsed: result.mediaTypeUsed,
    warnings,
    data: JSON.parse(H.stableStringify(result.data || {}))
  };

  // 期望值只做提示：命中不了说明路由/类型识别漂了，但字段没变就不算红灯
  if (fx.extractor && result.extractor && fx.extractor !== result.extractor) {
    warnings.push(`提取器与预期不符：预期 ${fx.extractor}，实际 ${result.extractor}`);
  }
  if (fx.mediaType && result.mediaTypeUsed && fx.mediaType !== result.mediaTypeUsed) {
    warnings.push(`媒体类型与预期不符：预期 ${fx.mediaType}，实际 ${result.mediaTypeUsed}`);
  }

  return snapshot;
}

async function main() {
  const fixtures = loadRegistry().filter((f) => !ONLY || f.id.includes(ONLY));
  if (!fixtures.length) {
    console.error(`${C.red}没有匹配的样本${C.reset}（--only=${ONLY}）`);
    process.exit(2);
  }

  const mediaConfigs = await env.loadBackgroundMediaConfigs();
  if (mediaConfigs && mediaConfigs.__error) {
    console.log(`${C.yellow}⚠ 读取 background 站点配置表失败，类型识别可能退化：${mediaConfigs.__error}${C.reset}\n`);
  }

  console.log(`${C.cyan}扩展版本 v${env.manifest.version}｜样本 ${fixtures.length} 个${UPDATE ? '（写入基线模式）' : ''}${C.reset}\n`);

  let failures = 0;
  let warns = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i];
    const tag = `[${String(i + 1).padStart(2)}/${fixtures.length}]`;
    let snapshot;
    try {
      snapshot = await runFixture(fx, mediaConfigs);
    } catch (err) {
      console.log(`${tag} ${fx.id.padEnd(20)} ${C.red}运行崩溃${C.reset} ${err && err.message}`);
      failures++;
      continue;
    }

    if (snapshot.error) {
      console.log(`${tag} ${fx.id.padEnd(20)} ${C.red}提取失败${C.reset} ${snapshot.error}`);
      failures++;
      continue;
    }

    const goldPath = path.join(GOLDEN_DIR, `${fx.id}.json`);
    const fieldCount = Object.keys(comparable(snapshot)).length;

    if (UPDATE || !fs.existsSync(goldPath)) {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(goldPath, H.stableStringify(snapshot) + '\n', 'utf8');
      console.log(`${tag} ${fx.id.padEnd(20)} mode=${snapshot.mode.padEnd(8)} 字段 ${String(fieldCount).padStart(2)}  ${C.cyan}${fs.existsSync(goldPath) ? (UPDATE ? '已更新基线' : '已写入基线') : ''}${C.reset}`);
    } else {
      const prev = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
      const diffs = diffData(comparable(prev), comparable(snapshot));
      const routeChanged = prev.extractor !== snapshot.extractor || prev.mode !== snapshot.mode;

      if (!diffs.length && !routeChanged) {
        console.log(`${tag} ${fx.id.padEnd(20)} mode=${snapshot.mode.padEnd(8)} 字段 ${String(fieldCount).padStart(2)}  ${C.green}✅ 与基线一致${C.reset}`);
      } else {
        failures++;
        console.log(`${tag} ${fx.id.padEnd(20)} mode=${snapshot.mode.padEnd(8)} 字段 ${String(fieldCount).padStart(2)}  ${C.red}❌ ${diffs.length} 处字段变化${C.reset}`);
        if (routeChanged) {
          console.log(`        ${C.red}链路变化${C.reset}：${prev.mode}/${prev.extractor} → ${snapshot.mode}/${snapshot.extractor}`);
        }
        for (const d of diffs) {
          const mark = d.kind === 'added' ? C.yellow + '新增' : d.kind === 'removed' ? C.yellow + '丢失' : C.yellow + '改动';
          console.log(`        ${mark}${C.reset} ${d.key}`);
          console.log(`           旧: ${d.kind === 'added' ? '(无)' : short(d.before)}`);
          console.log(`           新: ${d.kind === 'removed' ? '(无)' : short(d.after)}`);
        }
      }
    }

    if (snapshot.warnings && snapshot.warnings.length) {
      warns += snapshot.warnings.length;
      for (const w of snapshot.warnings) console.log(`        ${C.gray}提示：${w}${C.reset}`);
    }

    if (VERBOSE) {
      for (const [k, v] of Object.entries(comparable(snapshot))) {
        console.log(`        ${C.gray}${k} = ${short(v, 200)}${C.reset}`);
      }
    }
  }

  console.log('');
  if (failures) {
    console.log(`${C.red}结论：${failures} 个样本有变化${C.reset}。若这是你有意改的，确认新值正确后跑 --update 更新基线。`);
    process.exit(1);
  }
  console.log(`${C.green}结论：全部 ${fixtures.length} 个样本与基线一致${C.reset}${warns ? `（${warns} 条提示）` : ''}`);
}

main().catch((err) => {
  console.error('快照脚本自身出错：', err);
  process.exit(3);
});
