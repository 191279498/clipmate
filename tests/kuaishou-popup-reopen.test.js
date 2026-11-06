#!/usr/bin/env node
/**
 * 快手个人主页「关掉弹层再点开」按钮不换回提取（v2.12.8）
 *
 * 真机（2026-11-07，bsk 借用户 Edge，/profile/3xh222z4jc79ggw，DOM 变化时间线）：
 *   | 0ms      | 主页基线            | 弹层关 | 整理档案 / arch            |
 *   | 26111ms  | 第 1 次点开作品     | 弹层开 | 提取 / default        ✅   |
 *   | 85879ms  | 点关闭按钮          | 弹层关 | 整理档案 / arch       ✅   |
 *   | 97161ms  | 第 2 次点开同一作品 | 弹层开 | **仍 arch，零变化**   ❌   |
 *   连带：这时点按钮，浮窗是 7 列作品模板但除 URL 外全空。
 *
 * 根因：`_ksActivated` 只在 `_activateKuaishouComponents()` 里置 true，从来没人清过。
 * 第二次 opened=true 时 `if (!this._ksActivated)` 恒假 → 走 else 只补挂锚点 + 显示按钮，
 * 跳过整个一键激活（social 7 列模板 / _ksApplySkin('default') / 全局标记），
 * 而关弹层的 `_restoreKuaishouProfilePerson()` 已把这三样换回 person / arch / false。
 *
 * 本测试从 `_onKuaishouImmersiveState()` 整链进，用**真实** ButtonManager（断言按钮
 * class 与文案）和**真实** UniversalFieldMapper（断言模板类型），不拿假实现替代零件。
 *
 * 用法：node tests/kuaishou-popup-reopen.test.js [--verbose]
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SPA = read('src/content/ui/kuaishou-spa-handler.js');
const BTN = read('src/content/ui/button-manager.js');
const MAPPER = read('src/content/utils/field-mapper.js');
const MEDIA_TYPES = read('src/shared/config/media-types.js');
const INLINE = read('src/content/shared/mascot-inline.js');
const RESOLVER = read('src/content/shared/mascot-url.js');
const MAIN = read('src/content/content-main.js');
const MANIFEST = JSON.parse(read('manifest.json'));

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  cyan: '\u001b[36m', gray: '\u001b[90m'
};
let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}`); }
  else { failures.push(name); console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, v, detail) { ok(name, !!v, detail); }
function falsy(name, v, detail) { ok(name, !v, detail); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/** 让 _restoreKuaishouProfilePerson()（异步且调用处没 await）跑完 */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** 真实模块装进一个 jsdom window：ButtonManager 画真按钮，UniversalFieldMapper 造真模板 */
function freshWindow() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.kuaishou.com/profile/3xh222z4jc79ggw',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};
  win.matchMedia = win.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  // 真实 UniversalFieldMapper.fixDuplicateLinks() 会写日志；jsdom 里没加载日志模块，给个空壳
  win.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };
  for (const code of [MEDIA_TYPES, MAPPER, INLINE, RESOLVER, BTN, SPA]) {
    const s = win.document.createElement('script');
    s.textContent = code;
    win.document.documentElement.appendChild(s);
  }
  return win;
}

/**
 * 造一个「快手个人主页」实例：其余 init 阶段的方法打桩，
 * mixin 自身的方法（激活 / 撤离 / 恢复 / 换肤 / 贴位 / 显隐）全部用真的。
 */
function makeHarness(opts) {
  const win = freshWindow();
  const counters = { mapper: [], initUI: 0, refresh: 0, anchorRetry: 0, addEvent: [] };
  const origAdd = win.addEventListener.bind(win);
  win.addEventListener = function (type) { counters.addEvent.push(type); return origAdd.apply(null, arguments); };

  const inst = Object.create(win.KuaishouSpaMixin);
  const bm = new win.ButtonManager();
  bm.setSkin('arch');                     // 主页初始：档案皮 +「整理档案」

  Object.assign(inst, {
    buttonManager: bm,
    modalManager: { isOpen: false },
    _ksEnabled: true,
    _ksImmersiveOn: true,
    _ksPopupOn: true,
    _ksProfilePerson: opts && opts.profilePerson === false ? false : true,
    _ksWorkId: '',
    _ksMode: '',
    _ksActivated: false,
    _ksUserMoved: false,
    _ksAnchorBound: false,
    _ksMapperType: 'person',
    fieldMapper: new win.UniversalFieldMapper('person'),
    activeShortcode: null,
    cacheKey: 'home',
    autoExtract: false,
    isInitialized: false,
    _ksLog: () => {},
    generateCacheKey: (href, id) => 'key:' + (id || 'home'),
    initFieldMapper: async (t) => { counters.mapper.push(t); return new win.UniversalFieldMapper(t); },
    initUI: () => { counters.initUI++; bm.setClickHandler(() => {}); },
    refreshConfig: async () => { counters.refresh++; },
    _anchorKuaishouRetry: () => { counters.anchorRetry++; }
  });
  if (opts && opts.handover) inst._ksRouteIsDetail = () => true;

  return { win, inst, bm, counters, M: win.KuaishouSpaMixin };
}

function snapshot(H) {
  const { win, inst, bm } = H;
  return {
    skin: bm._skin,
    arch: bm.button.classList.contains('clipmate-arch'),
    label: (bm.button.textContent || '').trim(),
    mapper: inst.fieldMapper.mediaType,
    mapperTag: inst._ksMapperType,
    global: win.__clipmateKsImmersiveActive,
    activated: inst._ksActivated,
    inDom: !!bm.button.parentNode,
    workId: inst._ksWorkId,
    anchorBound: inst._ksAnchorBound
  };
}

const EVENT_OPEN = { id: '3xe456wj9c4ei86', opened: true, mode: 'popup' };
const EVENT_CLOSE = { id: '3xe456wj9c4ei86', opened: false, mode: 'popup' };

(async function main() {
  console.log('============ 快手主页弹层「开→关→再开」（v2.12.8）============');

  /* ============================================================
   * 一、端到端：三次打开，每一次都必须完整换装
   * ==========================================================*/
  section('一、开→关→再开：皮肤 / 模板 / 全局标记三处同步');
  {
    const H = makeHarness();
    const s0 = snapshot(H);
    eq('★ 主页基线是档案皮', s0.skin, 'arch');
    eq('★ 主页基线文案', s0.label, '整理档案');
    eq('★ 主页基线模板是 person', s0.mapper, 'person');

    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    const s1 = snapshot(H);
    eq('第 1 次打开：皮肤 default', s1.skin, 'default');
    eq('第 1 次打开：文案「提取」', s1.label, '提取');
    falsy('第 1 次打开：没有 arch class', s1.arch);
    eq('第 1 次打开：模板 social', s1.mapper, 'social');
    eq('第 1 次打开：模板标记 social', s1.mapperTag, 'social');
    eq('第 1 次打开：全局标记 true', s1.global, true);
    eq('第 1 次打开：_ksActivated true', s1.activated, true);
    truthy('第 1 次打开：按钮在 DOM 里', s1.inDom);

    await H.inst._onKuaishouImmersiveState(EVENT_CLOSE);
    await settle();
    const s2 = snapshot(H);
    eq('关弹层：皮肤换回 arch', s2.skin, 'arch');
    eq('关弹层：文案换回「整理档案」', s2.label, '整理档案');
    truthy('关弹层：arch class 回来了', s2.arch);
    eq('关弹层：模板换回 person', s2.mapper, 'person');
    eq('关弹层：全局标记 false', s2.global, false);
    eq('★ 关弹层：_ksActivated 必须归零', s2.activated, false);
    eq('关弹层：作品 ID 清空', s2.workId, '');
    truthy('关弹层：主页按钮不撤（不许摘）', s2.inDom);

    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    const s3 = snapshot(H);
    eq('★★ 第 2 次打开：皮肤必须是 default', s3.skin, 'default');
    eq('★★ 第 2 次打开：文案必须是「提取」', s3.label, '提取');
    falsy('★★ 第 2 次打开：不许残留 arch class', s3.arch);
    eq('★★ 第 2 次打开：模板必须是 social', s3.mapper, 'social');
    eq('★★ 第 2 次打开：模板标记 social', s3.mapperTag, 'social');
    eq('★★ 第 2 次打开：全局标记必须 true', s3.global, true);
    eq('★★ 第 2 次打开：_ksActivated true', s3.activated, true);
    truthy('★★ 第 2 次打开：按钮仍在 DOM 里', s3.inDom);

    // 真机内伤：person 模板去映射 social 数据 → 7 列除 URL 外全空
    const mapped = H.inst.fieldMapper.mapToUniversalFields({
      '本页标题': '快手作品标题',
      '作者昵称': '某作者',
      '本页文案': '这是一条作品文案',
      '发布日期': '2026-11-04 12:00:00',
      URL: 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86'
    }, 'www.kuaishou.com');
    truthy('★★ 第 2 次打开：作品文案能映射进 7 列', String(mapped['本页文案'] || '').indexOf('这是一条作品文案') >= 0,
      JSON.stringify(mapped).slice(0, 200));
    truthy('★★ 第 2 次打开：作品标题能映射进 7 列', String(mapped['本页标题'] || '').indexOf('快手作品标题') >= 0);
    eq('★★ 第 2 次打开：骨架就是 social 7 列',
      Object.keys(H.inst.fieldMapper.fieldTemplates).join(','), 'social');
    eq('★★ 第 2 次打开：骨架 7 个键',
      Object.keys(H.inst.fieldMapper.fieldTemplates.social).length, 7);

    // 第 3 轮，确认不是「只修好第二次」
    await H.inst._onKuaishouImmersiveState(EVENT_CLOSE);
    await settle();
    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    const s4 = snapshot(H);
    eq('第 3 次打开：皮肤 default', s4.skin, 'default');
    eq('第 3 次打开：文案「提取」', s4.label, '提取');
    eq('第 3 次打开：模板 social', s4.mapper, 'social');
    eq('第 3 次打开：全局标记 true', s4.global, true);

    eq('三轮共重跑 initUI 3 次', H.counters.initUI, 3);
    // 3 次一键激活 + 2 次 _restoreKuaishouProfilePerson（它自己也要 refreshConfig）= 5
    eq('三轮共重跑 refreshConfig 5 次（3 激活 + 2 恢复）', H.counters.refresh, 5);
    eq('模板重建顺序：social→person→social→person→social',
      H.counters.mapper.join('>'), 'social>person>social>person>social');
    // 幂等：绑定不叠加（每轮解绑后重挂，resize 恰好 3 次）
    eq('resize 监听不叠加（3 轮 = 3 次）',
      H.counters.addEvent.filter((t) => t === 'resize').length, 3);
  }

  /* ============================================================
   * 二、wasActive 语义不许被归零动作破坏
   * ==========================================================*/
  section('二、归零必须排在 wasActive 之后（否则关弹层不还原主页态）');
  {
    // init 阶段的第一次 opened=false：从未激活过 → 什么都不该改
    const H = makeHarness();
    await H.inst._onKuaishouImmersiveState({ opened: false, mode: 'popup' });
    await settle();
    eq('init 阶段的 opened=false：模板保持 person', H.inst._ksMapperType, 'person');
    eq('init 阶段的 opened=false：皮肤保持 arch', H.bm._skin, 'arch');
    eq('init 阶段的 opened=false：不重建模板', H.counters.mapper.length, 0);
    eq('init 阶段的 opened=false：不重跑 initUI', H.counters.initUI, 0);
    eq('init 阶段的 opened=false：全局标记 false', H.win.__clipmateKsImmersiveActive, false);
  }
  {
    // 源码结构：归零语句必须在撤离函数体内，且位于 wasActive 计算之后
    const start = SPA.indexOf('_deactivateKuaishouImmersive() {');
    truthy('找到 _deactivateKuaishouImmersive 定义', start >= 0);
    const body = SPA.slice(start, start + 6000);
    const iWas = body.indexOf('var wasActive = !!(this._ksWorkId || this._ksActivated);');
    const iClear = body.indexOf('this._ksActivated = false;');
    truthy('★ 撤离函数里确实有归零语句', iClear >= 0);
    truthy('★ 归零排在 wasActive 之后', iWas >= 0 && iClear > iWas,
      `wasActive@${iWas} / clear@${iClear}`);
    truthy('★ 归零排在 _ksWorkId 清空之前', body.indexOf("this._ksWorkId = '';") > iClear);
    truthy('★ 归零排在 handover 分支之前', body.indexOf('var handover = false;') > iClear);
  }

  /* ============================================================
   * 三、交棒详情页 / 非主页两条分支也不能被带坏
   * ==========================================================*/
  section('三、交棒详情页与推荐流分支');
  {
    const H = makeHarness({ handover: true });
    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    await H.inst._onKuaishouImmersiveState(EVENT_CLOSE);
    await settle();
    truthy('交棒详情页：按钮不撤', snapshot(H).inDom);
    eq('交棒详情页：_ksActivated 也已归零', H.inst._ksActivated, false);
    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    eq('交棒后再开：仍换回 default', snapshot(H).skin, 'default');
  }
  {
    const H = makeHarness({ profilePerson: false });
    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    eq('非主页第 1 次打开：default', snapshot(H).skin, 'default');
    await H.inst._onKuaishouImmersiveState(EVENT_CLOSE);
    await settle();
    falsy('非主页关掉：按钮撤下', snapshot(H).inDom);
    eq('非主页关掉：_ksActivated 归零', H.inst._ksActivated, false);
    await H.inst._onKuaishouImmersiveState(EVENT_OPEN);
    await settle();
    const s = snapshot(H);
    truthy('非主页再开：按钮回来', s.inDom);
    eq('非主页再开：皮肤 default', s.skin, 'default');
    eq('非主页再开：模板 social', s.mapper, 'social');
  }

  /* ============================================================
   * 四、幂等前提：一键激活里的每一步重跑都安全
   * ==========================================================*/
  section('四、重跑一键激活的幂等前提（静态钉住）');
  {
    const i = MAIN.indexOf('  initUI() {');
    truthy('找到 content-main.js 的 initUI', i >= 0);
    const fn = MAIN.slice(i, i + 900);
    truthy('initUI 只做 setClickHandler（不做 addEventListener）',
      /setClickHandler\(/.test(fn) && !/addEventListener\(/.test(fn));
    truthy('setClickHandler 是覆盖赋值而非追加',
      /this\.onClick\s*=\s*handler;/.test(BTN));
    truthy('_bindKuaishouAnchor 自带 _ksAnchorBound 闸口',
      /_bindKuaishouAnchor\(\)\s*\{\s*if \(this\._ksAnchorBound\) return;/.test(SPA));
    truthy('_unbindKuaishouAnchor 会把闸口归零',
      /this\._ksAnchorBound = false;/.test(SPA));
    truthy('setSkin 幂等（同皮肤直接 return）',
      /setSkin\(skin\)[\s\S]{0,240}?if \(this\._skin === next\) return;/.test(BTN));
    truthy('ButtonManager.show 幂等（已在 DOM 就不重复插）',
      /show\(\)\s*\{\s*if \(!this\.button\.parentNode\)/.test(BTN));
    truthy('一键激活只在 !_ksActivated 时进入',
      /if \(!this\._ksActivated\)\s*\{\s*await this\._activateKuaishouComponents\(\);/.test(SPA));
    truthy('一键激活自带二次闸口', /_activateKuaishouComponents\(\)\s*\{\s*if \(this\._ksActivated\) return;/.test(SPA));
  }

  /* ============================================================
   * 五、版本与注册
   * ==========================================================*/
  section('五、版本');
  eq('manifest 版本是 2.12.8', MANIFEST.version, '2.12.8');
  truthy('快手 spa-handler 已在 content_scripts 注册',
    JSON.stringify(MANIFEST.content_scripts).indexOf('kuaishou-spa-handler.js') >= 0);

  console.log(`\n${failures.length ? C.red : C.green}${pass} 通过，${failures.length} 失败${C.reset}`);
  if (failures.length) {
    failures.slice(0, 12).forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})().catch((e) => {
  console.error(C.red + '测试自身抛错：' + (e && e.stack || e) + C.reset);
  process.exit(1);
});
