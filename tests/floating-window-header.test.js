/**
 * 浮窗标题栏改版（v2.5.93）
 *
 * 用户原话：「去除截图中画红圈的区域（媒体信息预览），感觉太占位置了……
 *            去掉后，我的那些按钮就不会那么挤了」。
 *
 * 钉住四件事：
 *   1) 标题文字不显示、也不再占 120px（否则按钮照样挤成两行）；
 *   2) 标题元素仍然留在 DOM 里 —— setTitle() 每次提取都往里写字，删元素会在那儿抛错；
 *   3) 编辑模式的提示从「标题文字」换成「标题栏底色」，进/退/保存三条路径都要跟着变，
 *      漏一条就会出现「底色和实际状态不一致」；
 *   4) 标题栏仍然是拖窗把手 —— 标题没了不等于窗口拖不动了。
 *
 * 跑法（项目根目录）：
 *   node tests/floating-window-header.test.js
 *   node tests/floating-window-header.test.js --verbose
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
  throw new Error('找不到 jsdom。请把 NODE_PATH 指向含 jsdom 的 node_modules，或设置 CLIPMATE_NODE_PATH');
}

const { JSDOM } = loadJsdom();

const UI = path.join(__dirname, '..', 'ClipMate_chrome', 'src', 'content', 'ui');
const STYLE_SRC = fs.readFileSync(path.join(UI, 'floating-window-styles.js'), 'utf8');
const WINDOW_SRC = fs.readFileSync(path.join(UI, 'floating-window.js'), 'utf8');
const EDIT_SRC = fs.readFileSync(path.join(UI, 'modal-edit-mode.js'), 'utf8');

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

function ok(label, cond, detail) {
  if (cond) { pass++; if (VERBOSE) console.log(`  ✓ ${label}`); return; }
  fails.push({ label, detail });
  console.log(`  ✗ ${label}${detail ? '\n      ' + detail : ''}`);
}

/* ============================================================
 * 环境：jsdom 里跑真源码（样式字符串 + 浮窗类 + 编辑模式 mixin）
 * ==========================================================*/
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://movie.douban.com/subject/1291561/',
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const win = dom.window;

  win.eval(STYLE_SRC);      // 定义 window.FLOATING_WINDOW_CSS
  win.eval(WINDOW_SRC);     // 定义 window.MediaFloatingWindow
  win.eval(EDIT_SRC);       // 定义 window.ModalEditMixin

  const Ctor = win.MediaFloatingWindow;
  if (typeof Ctor !== 'function') throw new Error('MediaFloatingWindow 未挂到 window 上');

  const fw = new Ctor({
    id: 'media-info-floating-window',
    title: '媒体信息预览',
    width: 600,
    height: 500,
    x: 50,
    y: 60
  });
  // show() 只是挂到 body，jsdom 里没有副作用，挂上去更接近真实
  fw.show();

  return { dom, win, fw, Ctor };
}

const { win, fw } = setup();
const sr = fw.shadowRoot;
const CSS = win.FLOATING_WINDOW_CSS;

/* ============================================================
 * A. 标题不占位，但元素还在
 * ==========================================================*/
console.log('\nA. 标题文字不再显示');
{
  const title = sr.querySelector('.floating-window-title');
  ok('标题元素仍存在于 shadow DOM（setTitle 要往里写字）', !!title);
  eq('标题内联 display = none', title && title.style.display, 'none');
  eq('标题文案仍被写入（不影响隐藏）', title && title.textContent, '媒体信息预览');

  const head = sr.querySelector('.floating-window-header');
  eq('标题栏仍存在（拖窗把手）', !!head, true);
  // v2.9.2：最左边多了一只吉祥物头（品牌锚点），从 3 个变 4 个
  eq('标题栏子元素是 4 个（吉祥物 + 标题 + 按钮组 + 关闭）', head.children.length, 4);
  ok('第一个子元素是吉祥物（放最左，不许挤到按钮后面）',
    !!head.children[0] && head.children[0].className === 'floating-window-brand',
    head.children[0] && head.children[0].className);
  eq('吉祥物对读屏隐藏（纯装饰）',
    head.children[0] && head.children[0].getAttribute('aria-hidden'), 'true');

  // 真正决定「挤不挤」的是标题有没有宽度：display:none 的元素不参与 flex 排布
  let threw = null;
  try { fw.setTitle('媒体信息预览 - 编辑模式'); } catch (e) { threw = e; }
  ok('setTitle 在标题隐藏后不抛错（元素没被删掉）', threw === null, threw && threw.message);
}

/* ============================================================
 * B. 样式：不仅元素隐藏，样式表也不能把 120px 加回来
 * ==========================================================*/
console.log('\nB. 样式表');
{
  const m = CSS.match(/\.floating-window-title\s*\{[^}]*\}/);
  ok('样式表里有 .floating-window-title 规则', !!m);
  ok('该规则包含 display: none', !!m && /display\s*:\s*none/.test(m[0]),
    m ? m[0].replace(/\s+/g, ' ') : '');

  let minWidthLeft = false;
  CSS.replace(/\.floating-window-title\s*\{[^}]*\}/g, (block) => {
    if (/min-width\s*:\s*120px/.test(block)) minWidthLeft = true;
    return block;
  });
  ok('标题的 min-width:120px 保底宽度已移除（红色圈里的占位来源）', !minWidthLeft);

  const editRule = CSS.match(/\.floating-window-header\.is-edit-mode\s*\{[^}]*\}/);
  ok('样式表里有 .floating-window-header.is-edit-mode 规则', !!editRule);
  ok('编辑态底色是琥珀纸 #FDF3D6（v2.9.1 米纸色板）', !!editRule && /#FDF3D6/i.test(editRule[0]),
    editRule ? editRule[0].replace(/\s+/g, ' ') : '');

  // shadow 内不允许写 !important（会压死 JS 内联的悬停/折叠效果）
  ok('新增规则没有用 !important', !!editRule && !/!important/.test(editRule[0]));
}

/* ============================================================
 * C. 编辑模式 → 标题栏变底色
 * ==========================================================*/
console.log('\nC. 编辑态底色');
{
  const head = sr.querySelector('.floating-window-header');

  fw.setEditModeVisual(true);
  ok('setEditModeVisual(true) 加上 is-edit-mode', head.classList.contains('is-edit-mode'));

  fw.setEditModeVisual(false);
  ok('setEditModeVisual(false) 去掉 is-edit-mode', !head.classList.contains('is-edit-mode'));

  fw.setEditModeVisual(true);
  fw.setEditModeVisual();
  ok('setEditModeVisual() 无参视为关闭（不会卡在橙色）', !head.classList.contains('is-edit-mode'));

  // ---- 真实的进 / 退 / 保存三条路径 ----
  const mixin = win.ModalEditMixin;
  ok('modal-edit-mode.js 暴露了 ModalEditMixin', !!mixin);

  function makeManager(fwRef) {
    return Object.assign(Object.create(mixin), {
      floatingWindow: fwRef,
      isEditMode: false,
      updateTable() {},
      showMessage() {},
      saveFieldMapping: async () => {},
      saveFieldOrder: async () => {},
      data: { 名字: '千与千寻', 上映日期: '2001/07/20' },
      originalData: { 名字: '千与千寻', 上映日期: '2001/07/20' },
      fieldOrder: ['名字', '上映日期'],
      originalFieldOrder: ['名字', '上映日期']
    });
  }

  const mgr = makeManager(fw);
  mgr.enterEditMode();
  ok('enterEditMode() 后标题栏变橙', head.classList.contains('is-edit-mode'));
  eq('enterEditMode() 真的置了 isEditMode', mgr.isEditMode, true);

  mgr.cancelEdit();
  ok('cancelEdit() 后标题栏恢复', !head.classList.contains('is-edit-mode'));

  mgr.enterEditMode();
  const p = mgr.confirmEdit();
  ok('confirmEdit() 返回 Promise（保持原有 async 契约）', typeof p.then === 'function');
  p.then(() => {
    ok('confirmEdit() 保存后标题栏恢复', !head.classList.contains('is-edit-mode'));

    // 浮窗还没建好时不许炸（提取中/关窗后的边界）
    const noWin = makeManager(null);
    let threw = null;
    try { noWin.enterEditMode(); } catch (e) { threw = e; }
    ok('窗口不存在时进入编辑模式不抛错', threw === null, threw && threw.message);

    finish();
  });
}

/* ============================================================
 * D. 标题没了，窗口还得拖得动
 * ==========================================================*/
function testDrag() {
  console.log('\nD. 拖窗仍然可用');
  const head = sr.querySelector('.floating-window-header');
  const closeBtn = sr.querySelector('.floating-window-close');

  const leftBefore = fw.windowElement.style.left;
  const topBefore = fw.windowElement.style.top;

  // 按住标题栏空白处 → 拖 80,40 → 松手
  head.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: 60, clientY: 70 }));
  win.document.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 140, clientY: 110 }));
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, clientX: 140, clientY: 110 }));

  ok('按下标题栏开始拖动', head && fw.windowElement.style.left !== leftBefore || fw.windowElement.style.top !== topBefore,
    `left ${leftBefore} → ${fw.windowElement.style.left}，top ${topBefore} → ${fw.windowElement.style.top}`);
  eq('水平位移 +80px', fw.x, 130);
  eq('垂直位移 +40px', fw.y, 100);

  // 关闭按钮上按下不该开始拖动（原有行为，别被这次改动带坏）
  const xBefore = fw.x;
  closeBtn.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true, clientX: 0, clientY: 0 }));
  win.document.dispatchEvent(new win.MouseEvent('mousemove', { bubbles: true, clientX: 300, clientY: 300 }));
  win.document.dispatchEvent(new win.MouseEvent('mouseup', { bubbles: true, clientX: 300, clientY: 300 }));
  eq('在 ✕ 上按下不会拖动窗口', fw.x, xBefore);
}

function finish() {
  testDrag();

  console.log(`\n${fails.length === 0 ? '全部通过' : '有失败'}：通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length) {
    fails.forEach((f) => console.log(`  - ${f.label}`));
    process.exitCode = 1;
  }
}

// 上面 confirmEdit 的 then 里调用 finish；若 Promise 链没跑（异常），兜底计时器报错
setTimeout(() => {
  if (pass + fails.length < 20) {
    console.log('\n✗ 测试未走完（Promise 链可能中断）');
    process.exitCode = 1;
  }
}, 1500);
