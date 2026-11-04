/**
 * v2.10.0 —— 作者档案皮肤：真实 DOM 行为
 *
 * 为什么单开一个文件：page-shape.test.js 那边是「代码里写没写」的结构断言，
 * 只能证明代码存在，证明不了它真的会把按钮改成另一个样子。
 * 这里用 jsdom 把 ButtonManager 真跑起来，量 class / 文案 / 头像地址。
 *
 * 用户 2026-11-04 的要求：档案页的按钮要和普通提取**一眼分得开**，
 * 所以三处必须同时变 —— 图标（整理档案的吉祥物）、配色（CSS 那条断言在
 * page-shape.test.js）、文案（整理档案）。少一处都会让人犹豫。
 */

'use strict';

const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const cands = [
    path.join(process.env.NODE_PATH || '', 'jsdom'),
    'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules/jsdom'
  ];
  for (const dir of cands) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  console.error('缺少 jsdom：请设置 NODE_PATH 指向全局 node_modules');
  process.exit(1);
}

const { JSDOM } = loadJsdom();
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ClipMate_chrome');

const BTN_CODE = fs.readFileSync(path.join(SRC, 'src/content/ui/button-manager.js'), 'utf8');

let pass = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? '  → ' + String(detail).slice(0, 180) : ''));
}

function eq(name, actual, expect) {
  ok(name, actual === expect, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expect));
}

/** 造一个带扩展运行时的按钮管理器（头像才会真的写 background-image） */
function setup() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://weibo.com/u/1188742767',
    runScripts: 'dangerously'
  });
  const win = dom.window;
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};
  win.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://kniejllhnjpcbbdaghfhbpdbpcckaccp/' + p
    }
  };

  const script = win.document.createElement('script');
  script.textContent = BTN_CODE;
  win.document.documentElement.appendChild(script);

  const bm = new win.ButtonManager();
  return { win, bm, btn: bm.button };
}

function faceOf(btn) {
  return btn.querySelector('.clipmate-mascot');
}

function bgOf(btn) {
  const f = faceOf(btn);
  return f ? (f.style.backgroundImage || '') : '';
}

/* ============================================================
 * 一、默认皮肤（先确认基线，不然下面的差异说明不了什么）
 * ==========================================================*/
console.log('一、默认皮肤');
{
  const t = setup();
  eq('默认待命文案是「提取」', t.btn.textContent.trim(), '提取');
  ok('默认不带档案类名', !t.btn.classList.contains('clipmate-arch'));
  ok('默认头像用举纸的吉祥物', /hero-doc\.svg/.test(bgOf(t.btn)), bgOf(t.btn));
  eq('默认皮肤字段是 default', t.bm._skin, 'default');
}

/* ============================================================
 * 二、切到档案皮肤：三处要同时变
 * ==========================================================*/
console.log('二、切到档案皮肤');
{
  const t = setup();
  t.bm.setSkin('arch');

  ok('加了 clipmate-arch 类（CSS 靠它换配色）', t.btn.classList.contains('clipmate-arch'));
  eq('文案变成「整理档案」', t.btn.textContent.trim(), '整理档案');
  ok('头像换成整理档案的吉祥物', /hero-archive\.svg/.test(bgOf(t.btn)), bgOf(t.btn));
  eq('皮肤字段是 arch', t.bm._skin, 'arch');
  ok('头像仍走扩展资源地址（不是空串降级成线稿）',
    bgOf(t.btn).indexOf('chrome-extension://') !== -1, bgOf(t.btn));
}

/* ============================================================
 * 三、切回普通皮肤：必须能褪干净（离开档案页不能留残影）
 * ==========================================================*/
console.log('三、切回普通皮肤');
{
  const t = setup();
  t.bm.setSkin('arch');
  t.bm.setSkin('default');

  ok('类名摘掉了', !t.btn.classList.contains('clipmate-arch'));
  eq('文案退回「提取」', t.btn.textContent.trim(), '提取');
  ok('头像退回举纸的吉祥物', /hero-doc\.svg/.test(bgOf(t.btn)), bgOf(t.btn));
}

/* ============================================================
 * 四、瞬态文案不许被换肤改掉
 * ==========================================================*/
console.log('四、瞬态文案不受影响');
{
  const t = setup();
  // 提取中：state 仍是 normal，文案是「提取中」
  t.bm._renderButton('normal', '提取中');
  t.bm.setSkin('arch');
  eq('提取中不会被改成「整理档案」', t.btn.textContent.trim(), '提取中');

  t.bm._renderButton('normal', '重试');
  t.bm.setSkin('default');
  eq('重试不会被改成「提取」', t.btn.textContent.trim(), '重试');
}

/* ============================================================
 * 五、只有常态换图标，成功/失败/忙碌保持原样
 * ==========================================================*/
console.log('五、只有常态换图标');
{
  const t = setup();
  t.bm.setSkin('arch');
  ok('档案皮肤下 成功态 仍是抱绿勾', /hero-done\.svg/.test(t.bm._mascotUrl('success')), t.bm._mascotUrl('success'));
  ok('档案皮肤下 失败态 仍是哭脸', /hero-cry\.svg/.test(t.bm._mascotUrl('error')), t.bm._mascotUrl('error'));
  ok('档案皮肤下 忙碌态 仍是 >_<', /face-busy\.svg/.test(t.bm._mascotUrl('busy')), t.bm._mascotUrl('busy'));
  ok('档案皮肤下 常态 是整理档案', /hero-archive\.svg/.test(t.bm._mascotUrl('normal')), t.bm._mascotUrl('normal'));
  ok('取不到状态名也当常态处理', /hero-archive\.svg/.test(t.bm._mascotUrl(undefined)), t.bm._mascotUrl(undefined));
}

/* ============================================================
 * 六、幂等 + 不许炸
 * ==========================================================*/
console.log('六、幂等与安全');
{
  const t = setup();
  t.bm.setSkin('arch');
  const before = t.btn.outerHTML;
  t.bm.setSkin('arch');
  eq('同一个皮肤重复调用不改 DOM', t.btn.outerHTML, before);

  // 没有按钮（按钮被摘掉 / 还没创建）时调用不许抛
  const t2 = setup();
  t2.bm.button = null;
  let threw = false;
  try { t2.bm.setSkin('arch'); } catch (e) { threw = true; }
  ok('按钮不存在时 setSkin 不抛错', !threw);

  // 传奇怪值当 default，不认成第三种皮肤
  const t3 = setup();
  t3.bm.setSkin('weird-value');
  eq('未知皮肤值回落 default', t3.bm._skin, 'default');
  eq('未知皮肤值不改文案', t3.btn.textContent.trim(), '提取');
}

/* ============================================================
 * 七、换肤不动位置与显隐（换肤不该让按钮跳一下）
 * ==========================================================*/
console.log('七、换肤不动其它状态');
{
  const t = setup();
  t.btn.style.left = '900px';
  t.btn.style.top = '20px';
  t.bm.setVisible(false);
  t.bm.setSkin('arch');
  eq('换肤不动 left', t.btn.style.left, '900px');
  eq('换肤不动 top', t.btn.style.top, '20px');
  eq('换肤不动显隐', t.btn.style.display, 'none');
}

/* ============================================================
 * 汇总
 * ==========================================================*/
console.log('');
if (fails.length === 0) {
  console.log(`\x1b[32m全部通过：${pass} 项\x1b[0m`);
  process.exit(0);
} else {
  console.log(`\x1b[31m失败 ${fails.length} 项 / 共 ${pass + fails.length} 项\x1b[0m`);
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
