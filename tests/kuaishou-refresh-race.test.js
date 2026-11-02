#!/usr/bin/env node
/**
 * 快手「浮窗就地刷新」并发竞态 + 拆开关（v2.5.89）
 *
 * 要钉住的两件事：
 *   一、切条太快时，**先出发的那一轮刷新后结束，不许把新条的结果盖回旧条**。
 *       真机证据（2026-10-28，搜索页弹层）：连采样 5 次，
 *       当前播 `3xfjr5h4hfrbz66`，浮窗先是它（对），2 秒后自己退回 `3xw663xa8762kim`（错）。
 *       原因是每切一条起一次刷新，而一次提取要联网抓快手号 8~20 秒。
 *   二、推荐流与搜索页弹层**各有一个开关**（v2.5.89 起从共用一个拆成两个）。
 *
 * 用法：
 *   node tests/kuaishou-refresh-race.test.js
 *   node tests/kuaishou-refresh-race.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const SPA_PATH = path.join(ROOT, 'src/content/ui/kuaishou-spa-handler.js');
const OPTIONS_HTML = path.join(ROOT, 'src/options/options.html');
const OPTIONS_JS = path.join(ROOT, 'src/options/options.js');

const C = { reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m', cyan: '\u001b[36m', gray: '\u001b[90m' };

let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual, detail) {
  if (actual) ok(name, detail); else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual, detail) {
  if (!actual) ok(name, detail); else bad(name, '期望假值，实际 ' + JSON.stringify(actual));
}
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SRC = fs.readFileSync(SPA_PATH, 'utf8');

/** 把 mixin 源码加载进一个隔离的 window，返回 KuaishouSpaMixin */
function loadMixin(extra) {
  const sandbox = Object.assign({
    console,
    setTimeout,
    clearTimeout,
    location: {
      hostname: 'www.kuaishou.com',
      pathname: '/search/video',
      search: '?searchKey=x',
      href: 'https://www.kuaishou.com/search/video?searchKey=x'
    },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      documentElement: { clientWidth: 1200, clientHeight: 800 },
      body: { appendChild: () => {} }
    }
  }, extra || {});
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'kuaishou-spa-handler.js' });
  return sandbox.KuaishouSpaMixin;
}

/** 造一个「只关心刷新链路」的实例：其余方法全部打桩 */
function makeInstance(mixin, extract) {
  const inst = Object.create(mixin);
  inst.modalManager = {
    isOpen: true,
    writes: [],
    async updateInPlace(data) { this.writes.push(data['URL']); }
  };
  inst.extractFromCurrentPage = extract;
  return inst;
}

function dataWith(url) {
  return { URL: url, 本页文案: 'c', 作者昵称: 'n', 发布日期: 'd' };
}

(async function main() {
  console.log('==================== 快手刷新竞态 + 拆开关（v2.5.89）====================');

  /* ============================================================
   * 一、竞态：旧结果后到，不许覆盖新结果
   * ============================================================ */
  section('一、竞态：先出发、后结束的那一轮必须作废');

  {
    const mixin = loadMixin();
    let call = 0;
    // 第一轮（旧）90ms 才回来；第二轮（新）10ms 就回来
    const inst = makeInstance(mixin, () => {
      call += 1;
      const n = call;
      return new Promise((r) => setTimeout(() => r(dataWith(n === 1 ? 'OLD' : 'NEW')), n === 1 ? 90 : 10));
    });

    const first = inst._refreshKuaishouPanel();     // 旧的一轮先出发
    await sleep(5);
    const second = inst._refreshKuaishouPanel();    // 新的一轮后出发、先结束
    await Promise.all([first, second]);
    await sleep(50);

    eq('浮窗只写了一次', inst.modalManager.writes.length, 1);
    eq('写进去的是新条', inst.modalManager.writes[0], 'NEW');
    falsy('旧条一个字都没写进去', inst.modalManager.writes.includes('OLD'));
  }

  {
    // 更刁的一版：旧的一轮第一次取到的是「无效数据」（切条瞬间还没渲染完），
    // 它会 sleep 400ms 再重试。重试之后也必须发现自己过期了。
    const mixin = loadMixin();
    let call = 0;
    const inst = makeInstance(mixin, () => {
      call += 1;
      const n = call;
      if (n === 1) return new Promise((r) => setTimeout(() => r({ URL: '' }), 20));   // 无效
      if (n === 2) return new Promise((r) => setTimeout(() => r(dataWith('NEW')), 5)); // 新条
      return new Promise((r) => setTimeout(() => r(dataWith('OLD')), 1));              // 旧条重试
    });

    inst._refreshKuaishouPanel();
    await sleep(3);
    inst._refreshKuaishouPanel();
    await sleep(700); // 足够走完 400ms 的重试间隔

    eq('重试路径也不许写旧条', inst.modalManager.writes.join(','), 'NEW');
  }

  {
    // 只有一轮（正常切条）：必须照常写，别被序号误伤
    const mixin = loadMixin();
    const inst = makeInstance(mixin, () => Promise.resolve(dataWith('ONLY')));
    await inst._refreshKuaishouPanel();
    eq('单轮刷新照常写入', inst.modalManager.writes.join(','), 'ONLY');
  }

  {
    // 浮窗没开：一个字都不许碰
    const mixin = loadMixin();
    const inst = makeInstance(mixin, () => Promise.resolve(dataWith('X')));
    inst.modalManager.isOpen = false;
    await inst._refreshKuaishouPanel();
    eq('浮窗关着时不提取不写入', inst.modalManager.writes.length, 0);
  }

  /* ============================================================
   * 二、源码守护：序号保护不许被顺手删掉
   * ============================================================ */
  section('二、源码守护（删掉序号保护会红）');

  truthy('_refreshKuaishouPanel 里有 _ksRefreshSeq', /_ksRefreshSeq\s*=\s*\(this\._ksRefreshSeq/.test(SRC));
  truthy('提取之后要对一次号', /await this\.extractFromCurrentPage\(\)[\s\S]{0,200}?isStale\(this\)/.test(SRC));
  truthy('重试等待之后也要对号', /setTimeout\(r,\s*400\)[\s\S]{0,80}?isStale\(this\)/.test(SRC));
  truthy('写入浮窗之前要再对一次号', /isStale\(this\)[\s\S]{0,220}?updateInPlace/.test(SRC));

  /* ============================================================
   * 三、拆开关：两个键各读各的，缺省都开
   * ============================================================ */
  section('三、拆开关：kuaishouImmersiveEnabled / kuaishouPopupEnabled');

  {
    const mixin = loadMixin({
      WBR: { storage: { local: { get: async () => ({ kuaishouPopupEnabled: false }) } } }
    });
    const inst = Object.create(mixin);
    const s = await inst._readKuaishouSwitches();
    eq('只关弹层 → 推荐流仍开', s.immersive, true);
    eq('只关弹层 → 弹层关', s.popup, false);
  }

  {
    const mixin = loadMixin({
      WBR: { storage: { local: { get: async () => ({ kuaishouImmersiveEnabled: false }) } } }
    });
    const inst = Object.create(mixin);
    const s = await inst._readKuaishouSwitches();
    eq('只关推荐流 → 推荐流关', s.immersive, false);
    eq('只关推荐流 → 弹层仍开', s.popup, true);
  }

  {
    const mixin = loadMixin({ WBR: { storage: { local: { get: async () => ({}) } } } });
    const inst = Object.create(mixin);
    const s = await inst._readKuaishouSwitches();
    truthy('存储里没有这两个键 → 都按开', s.immersive && s.popup);
  }

  {
    const mixin = loadMixin({
      WBR: { storage: { local: { get: async () => { throw new Error('boom'); } } } }
    });
    const inst = Object.create(mixin);
    const s = await inst._readKuaishouSwitches();
    truthy('读存储抛异常 → 也按开（不许因存储抖动关功能）', s.immersive && s.popup);
  }

  {
    const mixin = loadMixin();
    const inst = Object.create(mixin);
    eq('_ksModeEnabled(popup)，未初始化默认开', inst._ksModeEnabled('popup'), true);
    inst._ksPopupOn = false;
    eq('_ksModeEnabled(popup)，关掉后为假', inst._ksModeEnabled('popup'), false);
    eq('关弹层不影响推荐流判定', inst._ksModeEnabled('immersive'), true);
    inst._ksImmersiveOn = false;
    eq('_ksModeEnabled(immersive)，关掉后为假', inst._ksModeEnabled('immersive'), false);
  }

  /* ============================================================
   * 四、门禁：关掉的那一种态不出按钮、不接管
   * ============================================================ */
  section('四、门禁：关掉的那一种态不许接管');

  function makeGateInstance(mixin) {
    const inst = Object.create(mixin);
    inst._ksEnabled = true;
    inst._ksImmersiveOn = true;
    inst._ksPopupOn = true;
    inst._ksActivated = false;
    inst._ksWorkId = '';
    inst.gate = { hidden: 0, activated: 0, bound: 0, shown: 0, refreshed: 0 };
    inst._hideKuaishouButton = function () { this.gate.hidden += 1; };
    inst._showKuaishouButton = function () { this.gate.shown += 1; };
    inst._bindKuaishouAnchor = function () { this.gate.bound += 1; };
    inst._anchorKuaishouButton = function () { };
    inst._anchorKuaishouRetry = function () { };
    inst._deactivateKuaishouImmersive = function () { this.gate.deactivated = (this.gate.deactivated || 0) + 1; };
    inst._refreshKuaishouPanel = function () { this.gate.refreshed += 1; };
    // 打桩也要还原真实顺序：真实实现装好组件后自己调 _showKuaishouButton()
    inst._activateKuaishouComponents = async function () {
      this.gate.activated += 1;
      this._ksActivated = true;
      this._showKuaishouButton();
    };
    inst.generateCacheKey = function () { return 'k'; };
    inst.autoExtract = false;
    inst.modalManager = { isOpen: false };
    return inst;
  }

  {
    const mixin = loadMixin();
    const inst = makeGateInstance(mixin);
    inst._ksPopupOn = false; // 弹层关、推荐流开
    await inst._onKuaishouImmersiveState({ opened: true, id: 'abc', mode: 'popup' });
    eq('弹层开关关 → 不接管', inst.gate.activated, 0);
    truthy('弹层开关关 → 按钮被摘掉', inst.gate.hidden >= 1);
    eq('弹层开关关 → 不出按钮', inst.gate.shown, 0);
  }

  {
    const mixin = loadMixin();
    const inst = makeGateInstance(mixin);
    inst._ksImmersiveOn = false; // 推荐流关、弹层开
    await inst._onKuaishouImmersiveState({ opened: true, id: 'abc', mode: 'immersive' });
    eq('推荐流开关关 → 不接管', inst.gate.activated, 0);
    eq('推荐流开关关 → 不出按钮', inst.gate.shown, 0);
  }

  {
    const mixin = loadMixin();
    const inst = makeGateInstance(mixin);
    await inst._onKuaishouImmersiveState({ opened: true, id: 'abc', mode: 'popup' });
    eq('弹层开关开 → 正常接管', inst.gate.activated, 1);
    truthy('弹层开关开 → 按钮出现', inst.gate.shown >= 1);
    eq('接管时锚点模式记成 popup', inst._ksMode, 'popup');
  }

  {
    const mixin = loadMixin();
    const inst = makeGateInstance(mixin);
    await inst._onKuaishouImmersiveState({ opened: true, id: 'abc', mode: 'immersive' });
    eq('推荐流开关开 → 正常接管', inst.gate.activated, 1);
    eq('接管时锚点模式记成 immersive', inst._ksMode, 'immersive');
  }

  {
    // 已经用弹层接管过，随后开关在别处被关掉、状态机又抛来一次 → 要撤干净
    const mixin = loadMixin();
    const inst = makeGateInstance(mixin);
    inst._ksActivated = true;
    inst._ksWorkId = 'abc';
    inst._ksPopupOn = false;
    await inst._onKuaishouImmersiveState({ opened: true, id: 'abc', mode: 'popup' });
    truthy('开关关掉后已接管的要撤销', (inst.gate.deactivated || 0) >= 1);
  }

  /* ============================================================
   * 五、options 页面：两个开关都在，且各存各的键
   * ============================================================ */
  section('五、两个开关（v2.8.0 起收进站点卡片，不再是页面顶部的独立复选框）');

  const optJs = fs.readFileSync(OPTIONS_JS, 'utf8');
  const flagsJs = fs.readFileSync(path.join(ROOT, 'src/shared/feature-flags.js'), 'utf8');

  // 两条必须**分别**注册，且各自带自己的旧键：拆开的意义就是「关一个不影响另一个」
  truthy('注册了 kuaishouImmersive（推荐页）', /key:\s*'kuaishouImmersive'/.test(flagsJs));
  truthy('注册了 kuaishouPopup（搜索页弹层）', /key:\s*'kuaishouPopup'/.test(flagsJs));
  truthy('两条各自带旧键，互不共用',
    /key:\s*'kuaishouImmersive'[\s\S]{0,300}?legacyKey:\s*'kuaishouImmersiveEnabled'/.test(flagsJs) &&
    /key:\s*'kuaishouPopup'[\s\S]{0,300}?legacyKey:\s*'kuaishouPopupEnabled'/.test(flagsJs));
  truthy('options.js 会按 feature 的 legacyKey 双写（内容脚本读的是旧键）',
    optJs.indexOf('extras[feature.legacyKey] = !!enabled') > -1);
  truthy('options.js 有统一的 saveFeature 写入方法', /saveFeature\s*\(/.test(optJs));
  truthy('设置页里没有硬编码这两条旧键（杜绝第二份定义）',
    !/kuaishouImmersiveEnabled/.test(optJs) && !/kuaishouPopupEnabled/.test(optJs));
  falsy('旧的「共用一个开关」方法已移除', /saveKuaishouImmersiveFlag/.test(optJs));

  /* ============================================================ */
  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
  failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? '：' + f.detail : ''}`));
  process.exit(1);
})().catch((e) => {
  console.error('测试脚本自身出错：', e);
  process.exit(1);
});
