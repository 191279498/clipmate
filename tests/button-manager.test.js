/**
 * 「提取信息」按钮的点击门禁与拖拽实现（v2.5.92）
 *
 * 为什么单独写一份：按钮手感的两个问题（要点好几次、拖动发黏）都不是提取逻辑，
 * 快照测不到、真机只能靠肉眼。这里把 button-manager.js 的真代码放进 jsdom，
 * 用合成事件把「按下 → 抖动 → 松开 → 点击」这条链路逐步走一遍。
 *
 * 钉住的四件事：
 *   1) 手抖（<4px）不许吞点击；真拖动（≥4px）必须吞掉随之而来的 click；
 *   2) 拖动结束后没有 100ms 盲区，紧接着的点击必须生效；
 *   3) 拖到窗口外松手（pointercancel/失焦）之后不许留残留监听；
 *   4) 拖动过程中不读 offsetWidth/offsetTop（那是强制同步布局，卡顿的来源），
 *      且位移只写 transform、一帧一次。
 *
 * 跑法（项目根目录）：
 *   node tests/button-manager.test.js
 *   node tests/button-manager.test.js --verbose
 *
 * 判定：全部通过退出码 0，有任何失败退出码 1。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

/** jsdom 装在托管 node 的 workspace 里，不一定在 NODE_PATH 上（同 tests/lib/harness.js） */
function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请把 NODE_PATH 指向含 jsdom 的 node_modules，或设置 CLIPMATE_NODE_PATH');
}

const { JSDOM } = loadJsdom();

const SRC = path.join(__dirname, '..', 'ClipMate_chrome', 'src', 'content', 'ui', 'button-manager.js');
const SRC_CODE = fs.readFileSync(SRC, 'utf8');

const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${JSON.stringify(got)}`);
  } else {
    fails.push({ label, got, want });
    console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
  }
}

function ok(label, cond) {
  eq(label, !!cond, true);
}

/* ============================================================
 * 环境搭建：jsdom + 手动 rAF（帧由测试自己 flush，避免等真实时间）
 * ==========================================================*/
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/page',
    pretendToBeVisual: true,
    // 必须开，否则内联 <script> 根本不会执行，window.ButtonManager 永远是 undefined
    runScripts: 'dangerously'
  });
  const win = dom.window;

  // 手动 rAF：能精确数「排了几帧」，不用 sleep
  const frames = [];
  let seq = 1;
  win.requestAnimationFrame = (cb) => { const id = seq++; frames.push({ id, cb }); return id; };
  win.cancelAnimationFrame = (id) => { const i = frames.findIndex((f) => f.id === id); if (i >= 0) frames.splice(i, 1); };

  const script = win.document.createElement('script');
  script.textContent = SRC_CODE;
  win.document.documentElement.appendChild(script);
  if (script.parentNode) script.parentNode.removeChild(script);

  const bm = new win.ButtonManager();
  const btn = bm.button;

  // jsdom 没有布局引擎，offsetLeft/Top 是 undefined，这里补成确定的数字
  let left = 0;
  let top = 0;
  let widthReads = 0;
  Object.defineProperty(btn, 'offsetWidth', { configurable: true, get() { widthReads++; return 120; } });
  Object.defineProperty(btn, 'offsetHeight', { configurable: true, get() { return 48; } });
  Object.defineProperty(btn, 'offsetLeft', { configurable: true, get() { return left; } });
  Object.defineProperty(btn, 'offsetTop', { configurable: true, get() { return top; } });

  const fire = (type, x, y) => {
    btn.dispatchEvent(new win.MouseEvent(type, {
      clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true
    }));
  };
  const click = () => btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  const flushFrames = () => {
    let n = 0;
    while (frames.length) { const f = frames.shift(); f.cb(0); n++; }
    return n;
  };

  return {
    win, bm, btn, fire, click, flushFrames,
    frameCount: () => frames.length,
    resetWidthReads: () => { widthReads = 0; },
    widthReads: () => widthReads,
    setBase: (l, t) => { left = l; top = t; }
  };
}

/* ============================================================
 * 一、点击门禁
 * ==========================================================*/
console.log('一、点击门禁（手抖不许吞点击）');

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });

  t.fire('pointerdown', 100, 100);
  t.fire('pointerup', 100, 100);
  t.click();
  eq('原地按下松开 → 触发 1 次', calls, 1);
}

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });
  t.setBase(10, 20);

  // 手抖 2px（真实鼠标/触控板的常态）
  t.fire('pointerdown', 100, 100);
  t.fire('pointermove', 102, 101);
  t.fire('pointerup', 102, 101);
  t.click();
  eq('抖动 2px → 仍然算点击', calls, 1);
  eq('抖动 2px → 不算拖动', t.bm.isDragging, false);
  eq('抖动 2px → 按钮没被挪走', t.btn.style.left, '');
}

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });
  t.setBase(0, 0);

  t.fire('pointerdown', 100, 100);
  t.fire('pointermove', 103, 100);   // 3px：阈值内
  t.fire('pointerup', 103, 100);
  t.click();
  eq('阈值内 3px → 仍算点击', calls, 1);
}

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });
  t.setBase(0, 0);

  t.fire('pointerdown', 100, 100);
  t.fire('pointermove', 104, 100);   // 4px：刚好到阈值，算拖动
  t.flushFrames();
  t.fire('pointerup', 104, 100);
  t.click();
  eq('阈值 4px → 算拖动，click 被吞', calls, 0);
  eq('阈值 4px → 位置落到 left', t.btn.style.left, '4px');
}

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });
  t.setBase(0, 0);

  t.fire('pointerdown', 100, 100);
  t.fire('pointermove', 140, 100);
  t.flushFrames();
  t.fire('pointerup', 140, 100);
  t.click();
  eq('拖 40px → click 被吞', calls, 0);

  // 关键：拖动后「立刻」再点一次（没有等 100ms）。旧实现这里会失败。
  t.fire('pointerdown', 500, 500);
  t.fire('pointerup', 500, 500);
  t.click();
  eq('拖动后立刻再点 → 生效（没有 100ms 盲区）', calls, 1);
}

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });

  t.click();
  t.click();
  eq('连续两次点击 → 各触发一次', calls, 2);
}

/* ============================================================
 * 二、拖动收尾：位置、transform、残留监听
 * ==========================================================*/
console.log('\n二、拖动收尾');

{
  const t = setup();
  t.bm.setClickHandler(() => {});
  t.setBase(50, 60);

  t.fire('pointerdown', 200, 200);
  t.fire('pointermove', 260, 240);
  eq('拖动中 → 已标记 dragging', t.bm.isDragging, true);
  eq('拖动中 → 有 dragging 样式', t.btn.classList.contains('dragging'), true);
  t.flushFrames();
  eq('拖动中 → 只写 transform', t.btn.style.transform, 'translate3d(60px,40px,0)');
  eq('拖动中 → 不写 left', t.btn.style.left, '');

  t.fire('pointerup', 260, 240);
  eq('松手 → transform 清空', t.btn.style.transform, '');
  eq('松手 → left 落位', t.btn.style.left, '110px');
  eq('松手 → top 落位', t.btn.style.top, '100px');
  eq('松手 → right 置 auto', t.btn.style.right, 'auto');
  eq('松手 → 去掉 dragging 样式', t.btn.classList.contains('dragging'), false);
  eq('松手 → isDragging 立刻复位', t.bm.isDragging, false);

  const saved = t.win.localStorage.getItem('clipmate-button-position-example.com');
  ok('松手 → 位置写进 localStorage', saved && saved.indexOf('110') >= 0);
}

{
  const t = setup();
  t.bm.setClickHandler(() => {});
  t.setBase(0, 0);

  // 模拟「拖到浏览器窗口外松手」：只收到 pointercancel
  t.fire('pointerdown', 100, 100);
  t.fire('pointermove', 200, 100);
  t.flushFrames();
  t.fire('pointercancel', 200, 100);
  eq('取消后 → isDragging 复位', t.bm.isDragging, false);

  const before = t.btn.style.transform;
  t.fire('pointermove', 400, 400);      // 松手后残留的 mousemove 若还在，会改写 transform
  eq('取消后 → pointermove 不再生效（监听已摘）', t.btn.style.transform, before);

  let calls = 0;
  t.bm.onClick = () => { calls++; };
  t.fire('pointerdown', 500, 500);
  t.fire('pointerup', 500, 500);
  t.click();
  eq('取消后 → 下一次点击正常', calls, 1);
}

/* ============================================================
 * 三、性能约束：不读布局、一帧一写
 * ==========================================================*/
console.log('\n三、性能约束');

{
  const t = setup();
  t.bm.setClickHandler(() => {});
  t.setBase(0, 0);

  t.fire('pointerdown', 10, 10);
  t.resetWidthReads();
  for (let i = 1; i <= 50; i++) t.fire('pointermove', 10 + i, 10);
  eq('50 次移动 → 只排 1 帧', t.frameCount(), 1);
  eq('50 次移动 → 一次 offsetWidth 都没读', t.widthReads(), 0);
  t.flushFrames();
  eq('一帧写完 → transform 是最后一次位置', t.btn.style.transform, 'translate3d(50px,0px,0)');
  t.fire('pointerup', 60, 10);
  eq('收尾时也不读 offsetWidth', t.widthReads(), 0);
}

{
  const t = setup();
  t.bm.setClickHandler(() => {});
  t.setBase(0, 0);
  t.win.innerWidth = 200;
  t.win.innerHeight = 100;

  // 视口 200×100、按钮 120×48 → 最大 left 80、最大 top 52
  t.fire('pointerdown', 10, 10);
  t.fire('pointermove', 900, 900);
  t.flushFrames();
  t.fire('pointerup', 900, 900);
  eq('超左边界 → 夹到 80', t.btn.style.left, '80px');
  eq('超下边界 → 夹到 52', t.btn.style.top, '52px');
}

/* ============================================================
 * 四、提取中的重复点击
 * ==========================================================*/
console.log('\n四、提取中重复点击');

{
  const t = setup();
  let calls = 0;
  t.bm.setClickHandler(() => { calls++; });

  const notices = [];
  t.bm.showMessage = (msg, type) => { notices.push({ msg, type }); };

  t.bm.setLoading(true);
  eq('提取中 → 按钮不禁用（否则连点击都收不到）', t.btn.disabled, false);
  eq('提取中 → 按钮显示「提取中」（v2.8.5 去掉了省略号，头像负责表示在动）', t.btn.textContent.trim(), '提取中');

  t.click();
  t.click();
  eq('提取中点击 → 不重复触发提取', calls, 0);
  eq('提取中点击 → 弹了提示（且 2 秒内只弹一次）', notices.length, 1);
  eq('提示类型是 info', notices[0] && notices[0].type, 'info');

  t.bm.setSuccess();
  eq('成功后恢复可点', t.btn.disabled, false);
  eq('成功后按钮文字恢复', t.btn.classList.contains('success'), true);
  t.click();
  eq('成功后点击 → 正常触发', calls, 1);
}

/* ============================================================
 * 汇总
 * ==========================================================*/
console.log('');
if (fails.length) {
  console.log(`有 ${fails.length} 项不通过（共 ${pass + fails.length} 项）`);
  process.exit(1);
}
console.log(`全部通过：${pass} 项`);
