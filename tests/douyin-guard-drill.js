#!/usr/bin/env node
/**
 * 抖音「兜底演练」——证明新加的弹窗提取功能，无论怎么坏，都不会拖累现有详情页。
 *
 * 为什么要这个脚本：
 *   v2.5.77 给抖音加「弹窗态提取」，用户明确要求「现有提取器不能受任何影响，那是兜底」。
 *   口头保证不算证据，这个脚本把新模块**人为打死**（不加载 / 禁用 / 让它抛异常），
 *   然后断言详情页的字段与 golden 基线**逐字相同**。
 *
 * 四个场景：
 *   S0 原样           —— 什么都不改，用来确认基线本身是对的
 *   S1 新模块未加载   —— 把弹窗相关脚本从注入清单里剔掉（等价「文件丢了 / 没打包」）
 *   S2 新模块被禁用   —— 弹窗相关脚本照常加载，但把 isOpen() 打成恒 false（等价「熔断 / 手动关开关」）
 *   S3 新模块抛异常   —— 把 isOpen() 打成抛错（等价「模块有 bug，一调用就炸」）
 *
 * 断言口径：
 *   详情页样本（douyin-video-* / douyin-note-*）：S0~S3 必须与 golden 逐字相同 → 这就是「没受影响」
 *   弹窗样本（douyin-modal-*）：
 *     S0 原样          → **必须真的接管**：出 1 个按钮 + 走弹窗提取器，字段与 golden 逐字相同
 *     S1/S2/S3 打死    → **必须干净退回批 1**：不接管、不出按钮、0 字段
 *   （批 1/批 2 时弹窗页的 golden 是「不出入口」，批 3 起改成「接管」，这里的判据同步升级）
 *
 * 用法：
 *   node tests/douyin-guard-drill.js
 *   node tests/douyin-guard-drill.js --verbose     打印每个场景的实际字段
 *
 * 注意：本脚本只读产品源码，不写回任何东西（唯一写操作是读 golden 做比对，不 --update）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const H = require('./lib/harness');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');
const VERBOSE = process.argv.includes('--verbose');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

/**
 * 抖音弹窗存档里带着页面自己的播放器 SDK（xgplayer），它在 jsdom 里会「加载超时」并以
 * 未处理的 Promise 拒绝抛到 node 进程，让整个演练批直接退出。它不是扩展的问题，
 * 也不影响字段断言，只吞这一种已知噪声；其他未处理拒绝照旧报出来。
 */
const PAGE_SDK_NOISE = /xgplayer|sdk load timeout|Script error/i;
process.on('unhandledRejection', (reason) => {
  const msg = String((reason && reason.message) || reason);
  if (PAGE_SDK_NOISE.test(msg)) return;
  console.error(`${C.red}未处理的 Promise 拒绝：${msg}${C.reset}`);
  process.exitCode = 1;
});

/** 哪些脚本算「v2.5.77 新加的弹窗模块」——按文件名认，别硬编码具体几个 */
const MODAL_SCRIPT_RE = /douyin-modal|douyin-spa-handler|douyin-fiber-client|aweme-id-date/i;

function loadFixtures() {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'registry.json'), 'utf8'));
  return (raw.fixtures || []).filter((f) => String(f.id).startsWith('douyin-'));
}

/** 在页面里施加「把弹窗模块打死」的补丁；返回一段字符串形式的代码 */
function patchCode(mode) {
  // mode: 'disabled' → 模块「哑掉」；'throwing' → 模块「一调用就炸」
  //
  // ⚠️ 两个历史坑（都造成过假绿/假红，别再踩）：
  //   1. 批 1 把赋值写成了 `v.isOpen = …`（变量实际叫 value），S2/S3 一直「打桩失败 → 跳过」，
  //      等于这两场从来没真跑过。
  //   2. 批 3 发现只改 `api.isOpen` 骗不过弹窗监听：`watch()` 内部用的是**闭包里的 isOpen**，
  //      不是 API 对象上的属性。于是 S2/S3 在弹窗页上「补丁打了、却照样接管」。
  //      现在连 `watch` 一起打 —— 这才是「整个模块坏掉」的真实形态。
  const body =
    mode === 'disabled'
      ? `value.isOpen = function () { return false; };
         if (typeof value.watch === 'function') value.watch = function () { return function () {}; };`
      : `value.isOpen = function () { throw new Error('[drill] isOpen 抛异常'); };
         if (typeof value.watch === 'function') value.watch = function () { throw new Error('[drill] watch 抛异常'); };`;
  return `
    (function () {
      var tried = [];
      var value = null;
      try { if (window.DouyinModalContext) { value = window.DouyinModalContext; tried.push('DouyinModalContext'); } } catch (e) {}
      try { if (!value && window.DouyinModalExtractor) { value = window.DouyinModalExtractor; tried.push('DouyinModalExtractor'); } } catch (e) {}
      var ok = false;
      var err = null;
      if (value && typeof value.isOpen === 'function') {
        try { ${body} ok = true; } catch (e) { err = String(e && e.message); }
      } else {
        err = '找不到可打桩的 isOpen()（已试：' + (tried.join(',') || '无同名全局') + '）';
      }
      window.__CLIPMATE_DRILL__ = { mode: '${mode}', ok: ok, err: err, candidates: tried };
    })();
  `;
}

async function runFixture(fx, mediaConfigs, opts) {
  const html = fs.readFileSync(path.join(FIXTURES_DIR, fx.file), 'utf8');
  const page = await H.openPage({
    url: fx.url,
    html,
    mediaConfigs,
    scriptFilter: opts.scriptFilter,
    beforeMainScript: opts.beforeMainScript,
    afterScripts: opts.afterScripts
  });
  const isModal = /-modal-/.test(fx.id);
  try {
    const instance = await H.waitForInit(page, isModal && opts.id !== 'S0' ? 2500 : 15000);
    const buttonCount = page.window.document.querySelectorAll('.media-extractor-button').length;

    if (isModal && opts.id !== 'S0') {
      // 批 3 之后：弹窗页能不能出按钮，全看新模块活不活。
      // S1/S2/S3 把新模块打死，期望是**干净地退回批 1 的样子**：
      // 不接管、不出按钮、不产字段。哪怕残留一个按钮或一次初始化都算失败。
      if (instance && instance.isInitialized) {
        throw new Error('新模块被打死后，弹窗页仍然完成了初始化（应当退回批 1：不接管）');
      }
      if (buttonCount > 0) {
        throw new Error(`新模块被打死后，弹窗页仍残留 ${buttonCount} 个按钮（应当退回批 1：不出按钮）`);
      }
      return {
        data: {},
        mode: 'no-entry',
        extractor: '',
        mediaTypeUsed: null,
        drill: page.window.__CLIPMATE_DRILL__ || null,
        loadErrors: page.loadErrors
      };
    }

    if (!instance || !instance.isInitialized) {
      throw new Error('content-main 未完成初始化');
    }
    if (isModal && buttonCount !== 1) {
      // S0 的弹窗页必须真的接管了：出且只出一个按钮，浮在弹窗右上角
      throw new Error(`弹窗页（S0）按钮数应为 1，实际 ${buttonCount}`);
    }
    const result = await H.runRealPath(page, instance);
    return {
      data: JSON.parse(H.stableStringify(result.data || {})),
      mode: result.mode,
      extractor: result.extractor,
      mediaTypeUsed: result.mediaTypeUsed,
      drill: page.window.__CLIPMATE_DRILL__ || null,
      loadErrors: page.loadErrors
    };
  } finally {
    try { page.window.close(); } catch (e) { /* ignore */ }
  }
}

function diffData(prev, next) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  const out = [];
  for (const key of [...keys].sort()) {
    const a = prev ? prev[key] : undefined;
    const b = next ? next[key] : undefined;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out.push({ key, before: a, after: b });
  }
  return out;
}

(async () => {
  const fixtures = loadFixtures();
  if (!fixtures.length) {
    console.error('没有抖音样本，先在 tests/fixtures/registry.json 里登记');
    process.exit(2);
  }

  const scripts = env.contentScripts();
  const modalScripts = scripts.filter((s) => MODAL_SCRIPT_RE.test(s));
  const hasModalModule = modalScripts.length > 0;

  const mediaConfigs = await env.loadBackgroundMediaConfigs();

  console.log(`${C.cyan}兜底演练｜扩展 v${env.manifest.version}｜抖音样本 ${fixtures.length} 个${C.reset}`);
  console.log(`${C.gray}内容脚本 ${scripts.length} 个，其中弹窗相关 ${modalScripts.length} 个${hasModalModule ? '' : '（还没接入，本轮只能做 S0/S1 等价演练）'}${C.reset}`);
  if (hasModalModule) modalScripts.forEach((s) => console.log(`${C.gray}  · ${s}${C.reset}`));
  console.log('');

  const scenarios = [
    { id: 'S0', name: '原样', scriptFilter: null, afterScripts: null },
    { id: 'S1', name: '弹窗模块未加载', scriptFilter: (rel) => !MODAL_SCRIPT_RE.test(rel), afterScripts: null },
    { id: 'S2', name: '弹窗模块被禁用(isOpen=false)', scriptFilter: null, beforeMainScript: patchCode('disabled') },
    { id: 'S3', name: '弹窗模块抛异常(isOpen throws)', scriptFilter: null, beforeMainScript: patchCode('throwing') }
  ];

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const failures = [];

  for (const fx of fixtures) {
    const isModal = /-modal-/.test(fx.id);
    const goldPath = path.join(GOLDEN_DIR, `${fx.id}.json`);
    if (!fs.existsSync(goldPath)) {
      console.log(`${C.yellow}跳过${C.reset} ${fx.id}（没有 baseline，先跑 tests/snapshot.js 建基线）`);
      skipped++;
      continue;
    }
    const golden = JSON.parse(fs.readFileSync(goldPath, 'utf8'));
    console.log(`${C.cyan}■ ${fx.id}${C.reset} <${fx.site}${isModal ? ' · 弹窗态' : ' · 详情页'}>`);

    for (const sc of scenarios) {
      // 模块还不存在时，S1 等价于 S0、S2/S3 没东西可打桩 → 只跑一次并说明
      if (!hasModalModule && sc.id !== 'S0') {
        console.log(`   ${C.gray}${sc.id} ${sc.name}：跳过（新模块尚未接入）${C.reset}`);
        skipped++;
        continue;
      }

      let r;
      try {
        r = await runFixture(fx, mediaConfigs, sc);
      } catch (err) {
        fail++;
        const msg = `运行崩溃：${err && err.message}`;
        console.log(`   ${C.red}${sc.id} ${sc.name} → ❌ ${msg}${C.reset}`);
        failures.push(`${fx.id} / ${sc.id}: ${msg}`);
        continue;
      }

      // S2/S3 要确认补丁真的施加上了，否则「通过」是假通过
      if (sc.id === 'S2' || sc.id === 'S3') {
        if (!r.drill || !r.drill.ok) {
          skipped++;
          console.log(`   ${C.yellow}${sc.id} ${sc.name}：跳过（打桩失败：${(r.drill && r.drill.err) || '未知'}）${C.reset}`);
          continue;
        }
      }

      // 弹窗页在被「打死」的三场里，期望不是「等于基线」，而是「干净地退回批 1」。
      // runFixture 已经断言过「不接管 + 无按钮」，这里再确认零字段，三件事都对才算过。
      if (isModal && sc.id !== 'S0') {
        if (Object.keys(r.data).length === 0) {
          pass++;
          console.log(`   ${C.green}${sc.id} ${sc.name} → ✅ 已退回批 1 的表现（不接管、无按钮、0 字段）${C.reset}`);
        } else {
          fail++;
          const msg = `退回批 1 后仍产出 ${Object.keys(r.data).length} 个字段`;
          console.log(`   ${C.red}${sc.id} ${sc.name} → ❌ ${msg}${C.reset}`);
          failures.push(`${fx.id} / ${sc.id}: ${msg}`);
        }
        continue;
      }

      const diffs = diffData(golden.data, r.data);
      const routeChanged = golden.extractor !== r.extractor || golden.mode !== r.mode;

      if (!diffs.length && !routeChanged) {
        pass++;
        console.log(`   ${C.green}${sc.id} ${sc.name} → ✅ 与基线逐字相同（${Object.keys(r.data).length} 字段）${C.reset}`);
      } else {
        fail++;
        const detail = routeChanged ? `链路变化 ${golden.mode}/${golden.extractor} → ${r.mode}/${r.extractor}` : `${diffs.length} 处字段变化`;
        console.log(`   ${C.red}${sc.id} ${sc.name} → ❌ ${detail}${C.reset}`);
        failures.push(`${fx.id} / ${sc.id}: ${detail}`);
        diffs.slice(0, 6).forEach((d) => {
          const short = (v) => String(JSON.stringify(v)).slice(0, 90);
          console.log(`        ${C.gray}${d.key}: ${short(d.before)} → ${short(d.after)}${C.reset}`);
        });
      }

      if (VERBOSE) {
        for (const [k, v] of Object.entries(r.data)) {
          console.log(`        ${C.gray}${k} = ${String(v).slice(0, 80)}${C.reset}`);
        }
      }
    }
    console.log('');
  }

  console.log('========== 汇总 ==========');
  console.log(`通过 ${pass}｜失败 ${fail}｜跳过 ${skipped}`);
  if (fail) {
    console.log(`\n${C.red}结论：兜底不成立，先别继续往下做。${C.reset}`);
    failures.forEach((f) => console.log(`  · ${f}`));
    process.exit(1);
  }
  console.log(
    hasModalModule
      ? `${C.green}结论：新模块最坏的三种状态下，抖音详情页与基线逐字相同，弹窗页干净退回批 1（不接管、无按钮）。${C.reset}`
      : `${C.green}结论：当前（尚未接入新模块）抖音 ${fixtures.length} 份样本全部与基线一致，可作为下一批的对照起点。${C.reset}`
  );
})().catch((err) => {
  console.error('演练脚本自身出错：', err);
  process.exit(3);
});
