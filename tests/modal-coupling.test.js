/**
 * v2.9.7：浮窗与按钮「联动」+ 尺寸规则（modal-window / floating-window / button-manager）
 *
 * 钉住的行为：
 *   A. 尺寸约束：宽度/最大高度来自全局设置（320–1200 / 300–2000），高度自适应有上限
 *   B. 拖浮窗 → 按钮跟着走；按钮被视口边界挡住时浮窗一起收回（整对刚体）
 *   C. 拖按钮 → 浮窗跟着走；浮窗被边界挡住时按钮一起收回
 *   D. 真 ButtonManager 拖动链：窗口开着才联动，关着不动
 *   E. 浏览器窗口变小 → 浮窗被推回来，按钮跟同一段距离
 *   F. 拖完一次性落盘（onDragEnd → commitExternalPosition，不逐帧写存储）
 *   G. 打开时锚定按钮正下方（右边缘对齐，让开头像溢出）
 *   I. v2.9.8 开窗后稳态校准：busy 态「提取中」文字比稳态宽一个字，等按钮
 *      尺寸连续两拍不变后重锚一次；用户拖过就不动
 *   H. 静态接线：schema / background / content-main / 渲染器都在
 *
 * 跑法：node tests/modal-coupling.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请把 NODE_PATH 指向含 jsdom 的 node_modules');
}

const { JSDOM } = loadJsdom();
const UI = path.join(__dirname, '..', 'ClipMate_chrome', 'src', 'content', 'ui');
const SHARED = path.join(__dirname, '..', 'ClipMate_chrome', 'src');
const STYLE_SRC = fs.readFileSync(path.join(UI, 'floating-window-styles.js'), 'utf8');
const WINDOW_SRC = fs.readFileSync(path.join(UI, 'floating-window.js'), 'utf8');
const MODAL_SRC = fs.readFileSync(path.join(UI, 'modal-window.js'), 'utf8');
const BTN_SRC = fs.readFileSync(path.join(UI, 'button-manager.js'), 'utf8');
const RENDERER_SRC = fs.readFileSync(path.join(UI, 'modal-table-renderer.js'), 'utf8');
const SCHEMA_SRC = fs.readFileSync(path.join(SHARED, 'shared', 'settings-schema.js'), 'utf8');
const BG_SRC = fs.readFileSync(path.join(SHARED, 'background', 'background.js'), 'utf8');
const MAIN_SRC = fs.readFileSync(path.join(SHARED, 'content', 'content-main.js'), 'utf8');

let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) { pass++; return; }
  fails.push({ label, got, want });
  console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
}
function ok(label, cond) { eq(label, !!cond, true); }

function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://movie.douban.com/subject/1291561/',
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.eval(STYLE_SRC);
  win.eval(WINDOW_SRC);
  win.eval(MODAL_SRC);

  const fw = new win.MediaFloatingWindow({
    id: 'fw-test', title: 't', width: 320, height: 500, minWidth: 320, minHeight: 300,
    x: 100, y: 100
  });
  fw.show();

  // 联动协调者：直接拿 mixin 挂到最小 this 上（不必起整个 ModalManager）
  const mm = Object.create(win.ModalWindowMixin);
  mm.floatingWindow = fw;
  mm.isOpen = true;

  // 假按钮：offset 系列补成确定数字
  const btn = win.document.createElement('div');
  win.document.body.appendChild(btn);
  const btnPos = { left: 100, top: 20, width: 120, height: 48 };
  Object.defineProperty(btn, 'offsetLeft', { configurable: true, get() { return btnPos.left; } });
  Object.defineProperty(btn, 'offsetTop', { configurable: true, get() { return btnPos.top; } });
  Object.defineProperty(btn, 'offsetWidth', { configurable: true, get() { return btnPos.width; } });
  Object.defineProperty(btn, 'offsetHeight', { configurable: true, get() { return btnPos.height; } });

  const handle = {
    button: btn,
    externalCalls: [],
    commitCalls: [],
    applyExternalPosition(l, t) { this.externalCalls.push([l, t]); btnPos.left = l; btnPos.top = t; },
    commitExternalPosition(l, t) { this.commitCalls.push([l, t]); }
  };
  mm.attachButton(handle);
  // 与 createFloatingWindow 相同的接线
  fw.onMove = (p) => mm._onFwMoved(p);
  fw.onDragEnd = () => mm._commitButtonPos();
  mm._syncPair();

  const stubScroll = (el, sh) => {
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get() { return sh; } });
  };

  return { dom, win, fw, mm, btn, btnPos, handle, stubScroll };
}

/* ============================================================ */
console.log('A. 尺寸约束');

{
  const t = setup();
  t.mm.setUiConstraints({ width: 500, maxHeight: 600 });
  eq('maxHeight 取设置值（未超屏幕）', t.mm._maxHeightPx(), 600);

  t.mm.setUiConstraints({ width: 500, maxHeight: 99999 });
  eq('maxHeight 超 2000 → 钳到 2000', t.mm._maxHeightPx(), Math.min(2000, t.win.innerHeight - 16));

  t.mm.setUiConstraints({ width: 500, maxHeight: 'abc' });
  eq('maxHeight 脏值 → 回落 800（或屏幕上限）', t.mm._maxHeightPx(), Math.min(800, t.win.innerHeight - 16));

  t.mm.setUiConstraints({ width: 500, maxHeight: -5 });
  eq('maxHeight 低于下限 → 钳到 300', t.mm._maxHeightPx(), Math.min(300, t.win.innerHeight - 16));

  t.mm.setUiConstraints({ width: 99999, maxHeight: 600 });
  ok('width 钳制在开窗时做（约束本身不报错）', true);
  t.cleanup = null;
}

console.log('A2. autoFitHeight（量内容、夹上限）');

{
  const t = setup();
  // 内容 1500 + 标题 0（jsdom 无布局）→ 高度夹到 cap
  t.fw._heightCap = 600;
  t.stubScroll(t.fw.contentElement, 1500);
  t.fw.autoFitHeight();
  eq('内容 1500、上限 600 → 高度 600', t.fw.height, 600);

  t.fw._heightCap = 5000;
  t.fw.autoFitHeight();
  eq('上限放宽 → 仍不超过屏幕高度', t.fw.height, t.win.innerHeight - 16);

  t.stubScroll(t.fw.contentElement, 50);
  t.fw.autoFitHeight();
  eq('内容很矮 → 不低于 minHeight', t.fw.height, t.fw.minHeight);

  // 量不到（0）→ 维持现状
  t.stubScroll(t.fw.contentElement, 0);
  const before = t.fw.height;
  t.fw.autoFitHeight();
  eq('量不到内容 → 高度不动', t.fw.height, before);
}

{
  const t = setup();
  t.stubScroll(t.fw.contentElement, 1500);
  t.fw.isCollapsed = true;
  const h0 = t.fw.height;
  t.fw.autoFitHeight();
  eq('折叠态 → 不自适应', t.fw.height, h0);
  t.fw.isCollapsed = false;

  t.fw.isMinimized = true;
  t.fw.autoFitHeight();
  eq('胶囊态 → 不自适应', t.fw.height, h0);
  t.fw.isMinimized = false;
}

{
  // v2.9.7 真机回归：高度贴合后底部超出视口 → 整窗收回（豆瓣实测 y=165+800=965>877）
  const t = setup();
  t.stubScroll(t.fw.contentElement, 5000);
  t.fw._heightCap = t.win.innerHeight; // 内容长 → 高度顶到屏幕高
  t.fw.autoFitHeight();
  eq('高度顶到屏幕', t.fw.height, t.win.innerHeight - 16);
  t.fw.y = 165; // 开窗时锚在按钮下方，底部已出屏
  t.mm._autoFitHeight();
  const maxY = Math.max(8, t.win.innerHeight - t.fw.height - 8);
  eq('底部出屏 → y 被收回到贴底不出屏', t.fw.y, maxY);
  eq('收回后与按钮基准重新同步', t.mm._pairFwPos.y, maxY);

  // 本来就在屏内 → 不许乱动
  const t2 = setup();
  t2.stubScroll(t2.fw.contentElement, 50);
  t2.fw.autoFitHeight();
  const y0 = t2.fw.y;
  t2.mm._autoFitHeight();
  eq('屏内窗口 → 位置不动', t2.fw.y, y0);
}

/* ============================================================ */
console.log('B. 拖浮窗 → 按钮跟（_onFwMoved）');

{
  const t = setup();
  // 基准：fw(100,100) 按钮(100,20)。真实流程里 fw 已被拖到新位置、onMove 才上报
  t.fw.x = 160; t.fw.y = 140;
  t.mm._onFwMoved({ x: 160, y: 140 });
  eq('浮窗右移 60 → 按钮跟 60', t.btnPos.left, 160);
  eq('浮窗下移 40 → 按钮跟 40', t.btnPos.top, 60);
  eq('外部搬按钮被调用', t.handle.externalCalls.length, 1);
  eq('基准同步', t.mm._pairFwPos.x, 160);
}

{
  const t = setup();
  // 按钮已在左边缘：fw 左移会让按钮先到 0，多出来的量由浮窗收回
  t.btnPos.left = 20;
  t.mm._syncPair();
  const fwX0 = t.fw.x;
  t.mm._onFwMoved({ x: t.fw.x - 100, y: t.fw.y });
  eq('按钮到 0 后不再负', t.btnPos.left, 0);
  eq('浮窗只跟到按钮停下为止（刚体）', t.fw.x, fwX0 - 20);
}

/* ============================================================ */
console.log('C. 拖按钮 → 浮窗跟（_onBtnDragged）');

{
  const t = setup();
  const fwX0 = t.fw.x;
  const fwY0 = t.fw.y;
  t.handle.onDragMove(200, 100); // 按钮目标 (200,100)，基准 (100,20) → dx=100, dy=80
  eq('浮窗跟按钮 dx', t.fw.x, fwX0 + 100);
  eq('浮窗跟按钮 dy', t.fw.y, fwY0 + 80);
  eq('基准同步（按钮）', t.mm._pairBtnPos.x, 200);
}

{
  const t = setup();
  // 浮窗已贴右缘：按钮继续右移，浮窗停在 max，按钮也被拽回来（刚体）
  t.fw.x = 1024 - t.fw.width - 8;
  t.mm._syncPair();
  const fwX0 = t.fw.x;
  t.btnPos.left = 500;
  t.mm._syncPair();
  t.handle.onDragMove(700, t.btnPos.top);
  eq('浮窗停在视口右缘内', t.fw.x, fwX0);
  eq('按钮被浮窗拽回来（刚体）', t.btnPos.left, 500);
  ok('外部搬按钮被调用过', t.handle.externalCalls.length >= 1);
}

/* ============================================================ */
console.log('D. 真 ButtonManager 拖动链');

{
  const t = setup();
  t.win.eval(BTN_SRC);
  const bm = new t.win.ButtonManager();
  const bmBtn = bm.button;
  const bPos = { left: 100, top: 20 };
  Object.defineProperty(bmBtn, 'offsetLeft', { configurable: true, get() { return bPos.left; } });
  Object.defineProperty(bmBtn, 'offsetTop', { configurable: true, get() { return bPos.top; } });
  Object.defineProperty(bmBtn, 'offsetWidth', { configurable: true, get() { return 120; } });
  Object.defineProperty(bmBtn, 'offsetHeight', { configurable: true, get() { return 48; } });

  t.mm.attachButton(bm);
  t.mm._syncPair();

  // 合成拖动：按下 (100,100)（按钮基准 100,20）→ 移到 (160,150) → flush 帧
  const fire = (type, x, y) => bmBtn.dispatchEvent(new t.win.MouseEvent(type, {
    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
  }));
  const frames = [];
  t.win.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };

  fire('pointerdown', 100, 100);
  fire('pointermove', 160, 150);
  const fwX0 = t.fw.x;
  const fwY0 = t.fw.y;
  while (frames.length) frames.shift()(0);

  eq('拖按钮 → 浮窗同步移动 dx=60', t.fw.x, fwX0 + 60);
  eq('拖按钮 → 浮窗同步移动 dy=50', t.fw.y, fwY0 + 50);
}

{
  // 窗口关着：拖按钮不碰浮窗
  const t = setup();
  t.win.eval(BTN_SRC);
  t.mm.isOpen = false;
  const bm = new t.win.ButtonManager();
  const bmBtn = bm.button;
  Object.defineProperty(bmBtn, 'offsetLeft', { configurable: true, get() { return 100; } });
  Object.defineProperty(bmBtn, 'offsetTop', { configurable: true, get() { return 20; } });
  Object.defineProperty(bmBtn, 'offsetWidth', { configurable: true, get() { return 120; } });
  Object.defineProperty(bmBtn, 'offsetHeight', { configurable: true, get() { return 48; } });
  t.mm.attachButton(bm);
  t.mm._syncPair();

  const fire = (type, x, y) => bmBtn.dispatchEvent(new t.win.MouseEvent(type, {
    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
  }));
  const frames = [];
  t.win.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  fire('pointerdown', 100, 100);
  fire('pointermove', 260, 200);
  const fwX0 = t.fw.x;
  while (frames.length) frames.shift()(0);
  eq('浮窗关着 → 拖按钮不动浮窗', t.fw.x, fwX0);
}

{
  // D2 v2.9.7 真机回归：逐帧钳制下的拖动不许复利放大。
  // 场景＝豆瓣实测炸点：浮窗比视口矮一截但底部贴边（fyMax=60 < fw.y=100），
  // 每帧都触发「浮窗到边 → applyExternalPosition 回拉按钮」；
  // 旧实现每帧用被改写过的 _basePos 当基准 → 指针位移每帧叠一遍，4 帧多跑一倍。
  const t = setup();
  t.win.eval(BTN_SRC);
  const bm = new t.win.ButtonManager();
  const bmBtn = bm.button;
  const bPos = { left: 100, top: 20 };
  Object.defineProperty(bmBtn, 'offsetLeft', { configurable: true, get() { return bPos.left; } });
  Object.defineProperty(bmBtn, 'offsetTop', { configurable: true, get() { return bPos.top; } });
  Object.defineProperty(bmBtn, 'offsetWidth', { configurable: true, get() { return 120; } });
  Object.defineProperty(bmBtn, 'offsetHeight', { configurable: true, get() { return 48; } });
  // 把外部搬按钮的调用镜像进 bPos（真 bm 只改 style.left/top 与内部 _basePos）
  const origAEP = bm.applyExternalPosition.bind(bm);
  bm.applyExternalPosition = (l, tp) => { bPos.left = l; bPos.top = tp; origAEP(l, tp); };

  t.mm.attachButton(bm);
  // 制造「每帧都钳」的态势：浮窗 320x700 @ (500,100)，视口 1024x768 → fyMax=60 < 100
  t.fw.x = 500;
  t.fw.height = 700;
  t.mm._syncPair();

  const fire = (type, x, y) => bmBtn.dispatchEvent(new t.win.MouseEvent(type, {
    clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
  }));
  const frames = [];
  t.win.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };

  fire('pointerdown', 100, 100);
  // 4 帧、每帧指针 +30x +30y（总 +120,+120）
  [[130, 130], [160, 160], [190, 190], [220, 220]].forEach(([x, y]) => {
    fire('pointermove', x, y);
    while (frames.length) frames.shift()(0);
  });

  eq('D2 指针总共 +120 → 浮窗 x = 500+120（不许放大）', t.fw.x, 620);
  eq('D2 按钮同步 +120 → left = 100+120', bPos.left, 220);
  eq('D2 浮窗 y 钳在 fyMax=60', t.fw.y, 60);
  eq('D2 刚体：浮窗位移 == 按钮位移',
    t.fw.x - 500, bPos.left - 100);
  fire('pointerup', 220, 220);
}

/* ============================================================ */
console.log('E. 浏览器窗口变小 → 整对回位');

{
  const t = setup();
  t.mm._bindWindowResize();
  ok('resize 监听已挂', typeof t.mm._resizeHandler === 'function');
  // 把浮窗扔到屏幕外再触发 handler
  t.fw.x = 2000;
  t.mm._resizeHandler();
  ok('浮窗被推回视口内', t.fw.x <= 1024 - t.fw.width - 8);
  eq('按钮被同一距离推回（到左缘 0）', t.btnPos.left, 0);
  eq('按钮与浮窗基准已同步', t.mm._pairFwPos.x, t.fw.x);
}

/* ============================================================ */
console.log('F. 拖完落盘（onDragEnd → commitExternalPosition）');

{
  const t = setup();
  t.mm._onFwMoved({ x: t.fw.x + 30, y: t.fw.y });
  eq('拖动中不落盘', t.handle.commitCalls.length, 0);
  t.fw.isDragging = true;
  t.fw.handleMouseUp();
  eq('拖完落盘 1 次', t.handle.commitCalls.length, 1);
  eq('落的是按钮当前位置', t.handle.commitCalls[0][0], t.btnPos.left);
}

/* ============================================================ */
console.log('G. 打开时锚定按钮正下方');

{
  const t = setup();
  const rect = { right: 420, bottom: 100, width: 120, height: 44 };
  t.btn.getBoundingClientRect = () => rect;
  // 让 document.querySelector 命中我们的按钮
  const origQs = t.win.document.querySelector.bind(t.win.document);
  t.win.document.querySelector = (sel) =>
    (sel === '.media-extractor-button') ? t.btn : origQs(sel);
  const pos = t.mm._computeFloatingPosition(320, 500);
  eq('右边缘对齐按钮右缘', pos.x, 420 - 320);
  eq('顶部 = 按钮底 + 12（让开头像溢出）', pos.y, 100 + 12);
}

/* ============================================================ */
console.log('I. v2.9.8 开窗后稳态校准（busy 文字偏宽 → 回稳后重锚）');

{
  const t = setup();
  // 开窗瞬间按钮还是 busy 态（宽 156），浮窗已按瞬态 rect 锚在 x=483
  const busyRect = { right: 803, bottom: 197, width: 156, height: 48 };
  const idleRect = { right: 786, bottom: 197, width: 139, height: 48 };
  let cur = busyRect;
  t.btn.getBoundingClientRect = () => cur;
  const origQsI = t.win.document.querySelector.bind(t.win.document);
  t.win.document.querySelector = (sel) =>
    (sel === '.media-extractor-button') ? t.btn : origQsI(sel);
  t.fw.x = 803 - 320;
  t.fw.y = 197 + 12;
  t.mm._syncPair();
  t.mm._scheduleAnchorCalibration();
  // 同步驱动 _anchorStep：busy 一拍 → 回稳态 → 连续两拍相同 → 校准
  t.mm._anchorStep();
  cur = idleRect;
  t.mm._anchorStep();
  t.mm._anchorStep();
  eq('尺寸没回稳前不动浮窗', t.fw.x, 483);
  t.mm._anchorStep();
  eq('回稳态后重新锚定右缘（只动浮窗）', t.fw.x, 786 - 320);
  eq('y 不变（按钮 bottom 没变）', t.fw.y, 197 + 12);
  clearTimeout(t.mm._anchorTimer);
}

{
  // 用户拖过（_buttonPosDirty）→ 放弃校准，保住用户位置
  const t = setup();
  t.btn.getBoundingClientRect = () => ({ right: 786, bottom: 197, width: 139, height: 48 });
  const origQsJ = t.win.document.querySelector.bind(t.win.document);
  t.win.document.querySelector = (sel) =>
    (sel === '.media-extractor-button') ? t.btn : origQsJ(sel);
  t.fw.x = 100;
  t.fw.y = 100;
  t.mm._syncPair();
  t.mm._buttonPosDirty = true;
  t.mm._scheduleAnchorCalibration();
  t.mm._anchorStep();
  t.mm._anchorStep();
  t.mm._anchorStep();
  t.mm._anchorStep();
  eq('用户拖动过就不重锚', t.fw.x, 100);
  clearTimeout(t.mm._anchorTimer);
}

/* ============================================================ */
console.log('H. 静态接线');

{
  ok('settings-schema 有 floatingWindowWidth（默认 320，范围 320–1200）',
    /key: 'floatingWindowWidth'[\s\S]{0,300}default: 320,[\s\S]{0,120}min: 320,[\s\S]{0,40}max: 1200,/.test(SCHEMA_SRC));
  ok('settings-schema 有 floatingWindowMaxHeight（默认 800，范围 300–2000）',
    /key: 'floatingWindowMaxHeight'[\s\S]{0,300}default: 800,[\s\S]{0,120}min: 300,[\s\S]{0,40}max: 2000,/.test(SCHEMA_SRC));
  ok('两项都不是站点可覆盖项（popup 天然不放）',
    !/key: 'floatingWindowWidth'[\s\S]{0,400}siteOverridable: true/.test(SCHEMA_SRC));
  ok('background 默认配置有两键', /floatingWindowWidth: 320,/.test(BG_SRC) && /floatingWindowMaxHeight: 800,/.test(BG_SRC));
  ok('content-main 接了 setUiConstraints', /setUiConstraints\(\{/.test(MAIN_SRC));
  ok('content-main 接了 attachButton', /attachButton\(this\.buttonManager\)/.test(MAIN_SRC));
  ok('浮窗类有 autoFitHeight', /autoFitHeight\(capOverride\)/.test(WINDOW_SRC));
  ok('浮窗拖完回调 onDragEnd', /onDragEnd/.test(WINDOW_SRC));
  ok('渲染器每次刷新后自适应高度', /_autoFitHeight\(\)/.test(RENDERER_SRC));
  ok('按钮管理器有外部搬位置入口', /applyExternalPosition\(left, top\)/.test(BTN_SRC));
  ok('modal 尺寸不再按媒体类型记忆宽高（uiPref.width 移除）',
    !/uiPref\.width \|\| 600/.test(MODAL_SRC));
  ok('开窗后安排稳态校准（v2.9.8 busy 文字偏宽补偿）',
    /this\._scheduleAnchorCalibration\(\);/.test(MODAL_SRC));
  ok('校准以独立 _anchorStep 存在（测试可同步驱动）',
    /_anchorStep = \(\) => \{/.test(MODAL_SRC));
  ok('关窗时清掉校准定时器',
    /clearTimeout\(this\._anchorTimer\)/.test(MODAL_SRC));
}

/* ============================================================ */
console.log(`\nmodal-coupling：${pass} 通过 / ${fails.length} 失败`);
if (fails.length) process.exit(1);
