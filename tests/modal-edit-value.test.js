/**
 * v2.12.1：浮窗两处调整
 *
 * A. 纵向表格字段名列不再写死 120px（表头左边一大片空白），改自适应
 * B. 编辑模式下双击单元格可改「内容」（以前只能双击表头改字段名）
 *
 * 钉住的行为：
 *   A1 两份样式表（Shadow 内 / 页面降级）都必须是 width:1% + nowrap，且不得再有 120px
 *   B1 编辑模式渲染出 is-editing，非编辑模式没有
 *   B2 编辑模式双击格子 → 出现 .field-editor，预填 data 原值，且**不触发复制**
 *   B3 Enter 保存 → data 更新、DOM 显示新值、表格仍是编辑态
 *   B4 Esc 撤销 → data 不变、DOM 还原
 *   B5 Shift+Enter 换行不保存
 *   B6 非编辑模式双击 → 仍走复制，不出现编辑器
 *   B7 影视「URL」手改后跨站补链不得覆盖（_urlManuallyEdited）
 *   B8 ESC 关窗监听必须同时挡 .field-editor
 *
 * 跑法：node tests/modal-edit-value.test.js
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
const ROOT = path.join(__dirname, '..', 'ClipMate_chrome', 'src');
const UI = path.join(ROOT, 'content', 'ui');
const read = (p) => fs.readFileSync(p, 'utf8');

const STYLE_SRC = read(path.join(UI, 'floating-window-styles.js'));
const PAGE_CSS = read(path.join(ROOT, 'content', 'content-styles.css'));
const RENDERER_SRC = read(path.join(UI, 'modal-table-renderer.js'));
const EDIT_SRC = read(path.join(UI, 'modal-edit-mode.js'));
const COPY_SRC = read(path.join(UI, 'modal-copy-export.js'));
const DATA_SRC = read(path.join(UI, 'modal-data-processor.js'));
const MANAGER_SRC = read(path.join(UI, 'modal-manager.js'));

let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) { pass++; return; }
  fails.push({ label, got, want });
  console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
}
function ok(label, cond) { eq(label, !!cond, true); }
function includes(label, haystack, needle) {
  eq(label, String(haystack).indexOf(needle) >= 0, true);
}

/* ---------------- A. 样式 ---------------- */

function ruleBlock(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(esc + '\\s*\\{[^}]*\\}'));
  return m ? m[0] : '';
}

function testStyles(win) {
  const css = win.FLOATING_WINDOW_CSS || '';
  ok('浮窗样式字符串已加载', css.length > 1000);

  const fb = ruleBlock(css, '.data-table.vertical-table th');
  ok('纵向表头规则存在（Shadow）', fb.length > 0);
  includes('纵向表头列宽自适应 width:1%（Shadow）', fb, 'width: 1%');
  includes('纵向表头不折行 nowrap（Shadow）', fb, 'white-space: nowrap');
  ok('纵向表头不再写死 120px（Shadow）', !/width:\s*120px/.test(fb));

  const pb = ruleBlock(PAGE_CSS, '.data-table.vertical-table th');
  ok('纵向表头规则存在（页面降级）', pb.length > 0);
  includes('页面侧列宽自适应 width:1%', pb, 'width: 1%');
  includes('页面侧不折行 nowrap', pb, 'white-space: nowrap');
  ok('页面侧不再写死 120px', !/width:\s*120px/.test(pb));

  // 编辑态提示：格子能双击改，必须看得出来
  ok('编辑态格子有文本光标', /\.data-table\.is-editing td\[data-field\]\s*\{[^}]*cursor:\s*text/.test(css));
  ok('编辑态链接不响应鼠标（防双击开新页）',
    /\.data-table\.is-editing td\[data-field\] a\s*\{[^}]*pointer-events:\s*none/.test(css));
}

/* ---------------- 宿主 ---------------- */

function makeHost(win, content, opts) {
  const host = Object.assign({},
    win.ModalTableMixin, win.ModalEditMixin, win.ModalCopyMixin, win.ModalDataMixin);

  host.data = opts.data;
  host.fieldOrder = opts.fieldOrder || Object.keys(opts.data);
  host.fieldMappings = opts.fieldMappings || {};
  host.isEditMode = !!opts.isEditMode;
  host.displayMode = 'vertical';
  host.mediaType = opts.mediaType || 'game';
  host.floatingWindow = {
    getContentElement: () => content,
    getShadowRoot: () => null
  };
  // 这些是 ModalManager 本体的事，测试里不需要真做
  host.createFloatingWindowActions = () => {};
  host.initDragAndDrop = () => {};
  host.getMediaType = () => host.mediaType;
  host.showMessage = (m) => host.notices.push(m);
  host.notices = [];
  host.copied = [];
  host._copyCellValue = (cell, value, field) => host.copied.push({ value, field });

  host.updateTable(true);
  return host;
}

function dblclick(win, el) {
  el.dispatchEvent(new win.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
}

function key(win, el, k, extra) {
  el.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({
    key: k, bubbles: true, cancelable: true
  }, extra || {})));
}

/* ---------------- B. 值编辑 ---------------- */

function testRender(win, content) {
  const host = makeHost(win, content, { data: { 名字: '艾琳 Elin', 平台: 'PC' }, isEditMode: true });
  const table = content.querySelector('#dataTable');
  ok('编辑模式表格挂 is-editing', table && table.classList.contains('is-editing'));
  ok('编辑模式格子带「双击改内容」提示',
    (content.querySelector('td[data-field="名字"]') || {}).title === '双击改内容');

  const cell = content.querySelector('td[data-field="名字"]');
  dblclick(win, cell);
  const editor = content.querySelector('.field-editor');
  ok('编辑模式双击格子出现编辑器', !!editor);
  eq('编辑器预填当前值', editor ? editor.value : null, '艾琳 Elin');
  eq('编辑模式双击不触发复制', host.copied.length, 0);

  // Enter 保存
  editor.value = '艾琳 Elin（改）';
  key(win, editor, 'Enter');
  eq('Enter 保存后 data 已更新', host.data['名字'], '艾琳 Elin（改）');
  const cellAfter = content.querySelector('td[data-field="名字"]');
  includes('Enter 保存后 DOM 显示新值', cellAfter.textContent, '艾琳 Elin（改）');
  ok('保存后仍在编辑模式', host.isEditMode === true);
  ok('保存后表格仍是 is-editing',
    (content.querySelector('#dataTable') || {}).classList.contains('is-editing'));
  ok('保存后给出提示', host.notices.some((n) => n.indexOf('已修改') === 0));
  ok('保存后编辑器已消失', !content.querySelector('.field-editor'));
}

function testEscape(win, content) {
  const host = makeHost(win, content, { data: { 名字: '原名' }, isEditMode: true });
  const cell = content.querySelector('td[data-field="名字"]');
  const before = cell.innerHTML;

  dblclick(win, cell);
  const editor = content.querySelector('.field-editor');
  editor.value = '改成别的';
  key(win, editor, 'Escape');

  eq('Esc 后 data 未变', host.data['名字'], '原名');
  ok('Esc 后编辑器消失', !content.querySelector('.field-editor'));
  eq('Esc 后 DOM 还原', content.querySelector('td[data-field="名字"]').innerHTML, before);
}

function testShiftEnter(win, content) {
  const host = makeHost(win, content, { data: { 简介: '第一行' }, isEditMode: true });
  const cell = content.querySelector('td[data-field="简介"]');
  dblclick(win, cell);
  const editor = content.querySelector('.field-editor');
  editor.value = '第一行\n第二行';
  key(win, editor, 'Enter', { shiftKey: true });

  ok('Shift+Enter 不保存（编辑器还在）', !!content.querySelector('.field-editor'));
  eq('Shift+Enter 后 data 未变', host.data['简介'], '第一行');
}

function testNonEditMode(win, content) {
  const host = makeHost(win, content, { data: { 名字: '原名' }, isEditMode: false });
  ok('非编辑模式表格没有 is-editing',
    !(content.querySelector('#dataTable') || {}).classList.contains('is-editing'));

  const cell = content.querySelector('td[data-field="名字"]');
  dblclick(win, cell);

  ok('非编辑模式双击不出现编辑器', !content.querySelector('.field-editor'));
  eq('非编辑模式双击仍走复制', host.copied.length, 1);
  eq('复制取的是整格原值', host.copied[0] && host.copied[0].value, '原名');
}

/* ---------------- 影视 URL：手改保护 ---------------- */

function testUrlProtection(win) {
  const box = win.document.createElement('div');
  win.document.body.appendChild(box);

  const host = makeHost(win, box, {
    data: { URL: '豆瓣：https://movie.douban.com/subject/1/', IMDB: 'https://www.imdb.com/title/tt1/' },
    fieldOrder: ['URL', 'IMDB'],
    mediaType: 'movie',
    isEditMode: true
  });

  // 渲染时已自动合并：本页 + IMDB
  includes('影视 URL 渲染前已合并 IMDB', host.data['URL'], 'IMDB：https://www.imdb.com/title/tt1/');

  // 走真实链路：双击格子 → 改值 → Enter
  const cell = box.querySelector('td[data-field="URL"]');
  ok('影视 URL 格存在', !!cell);
  dblclick(win, cell);
  const editor = box.querySelector('.field-editor');
  ok('URL 格也能双击编辑', !!editor);
  editor.value = '豆瓣：https://movie.douban.com/subject/2/';
  key(win, editor, 'Enter');

  eq('手改的 URL 已写回 data', host.data['URL'], '豆瓣：https://movie.douban.com/subject/2/');
  eq('手改后置上保护标记', host._urlManuallyEdited, true);
  ok('手改后重渲染没有被自动合并盖回去',
    host.data['URL'].indexOf('IMDB') === -1);

  // 再主动合并一次，仍应保持手改值
  host._mergeLinksIntoUrl();
  eq('主动补链也不覆盖手改值', host.data['URL'], '豆瓣：https://movie.douban.com/subject/2/');

  // 撤掉标记（相当于取消编辑 / 新数据）→ 自动合并恢复
  host._urlManuallyEdited = false;
  host._rawPageUrl = undefined;
  host._lastMergedUrl = undefined;
  host._mergeLinksIntoUrl();
  includes('取消编辑后自动合并恢复', host.data['URL'], 'IMDB：https://www.imdb.com/title/tt1/');
}

function testEscCloseGuard() {
  const m = MANAGER_SRC.match(/querySelector\('([^']*(?:header-editor|field-editor)[^']*)'\)/);
  ok('ESC 关窗前会检查输入框', !!m);
  const sel = m ? m[1] : '';
  includes('ESC 关窗同时挡 .header-editor', sel, '.header-editor');
  includes('ESC 关窗同时挡 .field-editor', sel, '.field-editor');
}

/* ---------------- 主流程 ---------------- */

function main() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.douban.com/game/36350869/',
    pretendToBeVisual: true,
    runScripts: 'dangerously'
  });
  const win = dom.window;

  // UI 组件都假设有 ClipMateLog（真实环境里由 log 模块提供）
  win.eval('window.ClipMateLog = { debug: function () {}, warn: function () {}, info: function () {}, error: function () {} };');

  win.eval(STYLE_SRC);
  win.eval(RENDERER_SRC);
  win.eval(EDIT_SRC);
  win.eval(COPY_SRC);
  win.eval(DATA_SRC);

  ok('ModalTableMixin 已加载', !!win.ModalTableMixin);
  ok('ModalEditMixin 已加载', !!win.ModalEditMixin);
  ok('ModalDataMixin 已加载', !!win.ModalDataMixin);

  testStyles(win);

  const c1 = win.document.createElement('div');
  win.document.body.appendChild(c1);
  testRender(win, c1);

  const c2 = win.document.createElement('div');
  win.document.body.appendChild(c2);
  testEscape(win, c2);

  const c3 = win.document.createElement('div');
  win.document.body.appendChild(c3);
  testShiftEnter(win, c3);

  const c4 = win.document.createElement('div');
  win.document.body.appendChild(c4);
  testNonEditMode(win, c4);

  testUrlProtection(win);
  testEscCloseGuard();

  console.log(`\n通过 ${pass} 项`);
  if (fails.length) {
    console.log(`失败 ${fails.length} 项`);
    process.exit(1);
  }
  console.log('全部通过 ✅');
}

main();
