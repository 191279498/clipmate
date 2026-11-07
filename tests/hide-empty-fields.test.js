/**
 * 「空白字段四档」专项测试（v2.12.11）
 *
 * 用户 2026-11-07 拍板：设置页四选一，全局 + 每站点都能设，默认不隐藏。
 *   off     不隐藏：浮窗全量、复制全量（升级后行为零变化）
 *   display A 档：只隐藏浮窗显示，复制导出仍全量
 *   all     B 档：显示 + 复制导出一起少列
 *   custom  两个独立小开关自由组合
 *
 * 本项目铁律：契约测试必须跑**整机链路**，不能只测零件。
 * 所以这里用 jsdom 把真的 modal-table-renderer / modal-copy-export / modal-search
 * 三个 mixin 装到同一个实例上，真调 createTable() / copyData() /
 * copyDataAsMarkdown() / copyDataAsPlainText()，拦下真正写进剪贴板的内容。
 * 只测 `visibleFields()` 那种零件，就算渲染层忘了接线也永远全绿。
 *
 * 跑法（项目根目录）：
 *   node tests/hide-empty-fields.test.js
 *   node tests/hide-empty-fields.test.js --verbose
 */
'use strict';

const fs = require('fs');
const path = require('path');

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    process.env.NODE_PATH,
    path.join(require('os').homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请把 NODE_PATH 指向含 jsdom 的 node_modules');
}

const { JSDOM } = loadJsdom();
const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SRC = {
  siteconfig: R('ClipMate_chrome/src/shared/site-config.js'),
  schema: R('ClipMate_chrome/src/shared/settings-schema.js'),
  table: R('ClipMate_chrome/src/content/ui/modal-table-renderer.js'),
  copy: R('ClipMate_chrome/src/content/ui/modal-copy-export.js'),
  search: R('ClipMate_chrome/src/content/ui/modal-search.js'),
  main: R('ClipMate_chrome/src/content/content-main.js'),
  background: R('ClipMate_chrome/src/background/background.js'),
  options: R('ClipMate_chrome/src/options/options.js')
};

const VERBOSE = process.argv.includes('--verbose');
let pass = 0;
const fails = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    if (VERBOSE) console.log('  ✅ ' + name);
  } else {
    fails.push(name + (detail ? '  → ' + detail : ''));
    console.log('  ❌ ' + name + (detail ? '  → ' + detail : ''));
  }
}
function eq(name, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  ok(name, a === b, a === b ? '' : ('得到 ' + a + '，期望 ' + b));
}
function section(t) { console.log('\n【' + t + '】'); }

// ---------------- 一、配置解析（唯一事实来源） ----------------

const S = require(path.join(ROOT, 'ClipMate_chrome', 'src', 'shared', 'site-config.js'));
const cfg = (mode, d, c, overrides) => ({
  settings: { hideEmptyMode: mode, hideEmptyDisplay: !!d, hideEmptyCopy: !!c },
  siteOverrides: overrides || {}
});
const pol = (o) => S.resolveHideEmpty(o, 'www.example.com');

section('一、配置解析 · 四档与默认值');
eq('空配置 → off（升级后零变化）', pol({}), { mode: 'off', display: false, copy: false });
eq('off', pol(cfg('off', true, true)), { mode: 'off', display: false, copy: false });
eq('A display', pol(cfg('display')), { mode: 'display', display: true, copy: false });
eq('B all', pol(cfg('all')), { mode: 'all', display: true, copy: true });
eq('custom 00', pol(cfg('custom', false, false)), { mode: 'custom', display: false, copy: false });
eq('custom 10 只隐藏显示', pol(cfg('custom', true, false)), { mode: 'custom', display: true, copy: false });
eq('custom 01 只隐藏复制', pol(cfg('custom', false, true)), { mode: 'custom', display: false, copy: true });
eq('custom 11', pol(cfg('custom', true, true)), { mode: 'custom', display: true, copy: true });
eq('脏档位回退 off', pol(cfg('zzz', true, true)), { mode: 'off', display: false, copy: false });
eq('档位大小写容错', pol(cfg('ALL')), { mode: 'all', display: true, copy: true });
eq('四档常量顺序', S.HIDE_EMPTY_MODES, ['off', 'display', 'all', 'custom']);
eq('默认档常量', S.HIDE_EMPTY_DEFAULT, 'off');

section('二、配置解析 · 全局 / 站点覆盖');
eq('后缀匹配：douban.com 规则命中 movie.douban.com',
  S.resolveHideEmpty(cfg('off', false, false, { 'douban.com': { hideEmptyMode: 'all' } }), 'movie.douban.com'),
  { mode: 'all', display: true, copy: true });
eq('别名域名回退：game.douban.com 沿用 www.douban.com 的规则',
  S.resolveHideEmpty(cfg('off', false, false, { 'www.douban.com': { hideEmptyMode: 'display' } }), 'game.douban.com'),
  { mode: 'display', display: true, copy: false });
eq('站点逐键覆盖：只盖 copy，display 继续跟随全局',
  S.resolveHideEmpty(cfg('custom', false, false, { 'douban.com': { hideEmptyCopy: true } }), 'movie.douban.com'),
  { mode: 'custom', display: false, copy: true });
eq('站点规则没写 mode → 继续跟随通用（跟随通用语义）',
  S.resolveHideEmpty(cfg('all', false, false, { 'douban.com': { autoCopy: true } }), 'movie.douban.com'),
  { mode: 'all', display: true, copy: true });
eq('规则写成 null（显式跟随通用）→ 退回全局',
  S.resolveHideEmpty(cfg('display', false, false, { 'douban.com': null }), 'movie.douban.com'),
  { mode: 'display', display: true, copy: false });
// 等价改写护栏：resolve() 现在与 findSiteOverride 共用同一套查找
eq('findSiteOverride 与 resolve().rule 一致（后缀匹配）',
  S.findSiteOverride({ siteOverrides: { 'douban.com': { autoCopy: true } } }, 'movie.douban.com').rule,
  'douban.com');
eq('resolve().rule 仍是 douban.com（等价改写没改坏）',
  S.resolve({ siteOverrides: { 'douban.com': { autoCopy: true } } }, 'movie.douban.com').rule,
  'douban.com');
eq('别名回退时 resolve().rule 指向主域名',
  S.resolve({ siteOverrides: { 'www.douban.com': { autoCopy: true } } }, 'game.douban.com').rule,
  'www.douban.com');

section('三、配置解析 · 站点快照不固化全局档位');
const baseConfig = {
  autoExtract: false, autoCopy: false, showButton: true,
  settings: { hideEmptyMode: 'all' },
  siteOverrides: {}
};
eq('默认快照只有基础五项，不含任何空白字段键',
  S.siteSnapshot(baseConfig, 'movie.douban.com'),
  { autoExtract: false, autoExtractDelay: 0, autoCopy: false, showButton: true, autoDismiss: false });
const ownCfg = Object.assign({}, baseConfig, {
  siteOverrides: { 'movie.douban.com': { autoCopy: true, hideEmptyMode: 'custom', hideEmptyCopy: true } }
});
const snapOwn = S.siteSnapshot(ownCfg, 'movie.douban.com');
eq('本站自己设过的档位会被快照带上（改别的开关不丢）', snapOwn.hideEmptyMode, 'custom');
eq('本站自己设过的 copy 小开关也在', snapOwn.hideEmptyCopy, true);
eq('本站没设过的 display 小开关不会被凭空固化',
  Object.prototype.hasOwnProperty.call(snapOwn, 'hideEmptyDisplay'), false);
eq('可跟随键清单', S.HIDE_EMPTY_KEYS, ['hideEmptyMode', 'hideEmptyDisplay', 'hideEmptyCopy']);

section('四、配置解析 · 判空与过滤是纯函数');
eq('null / undefined / 空串 / 纯空白都算空',
  [null, undefined, '', '   ', '\n\t'].map(S.isBlankValue), [true, true, true, true, true]);
eq('0 / false / 中文都不算空（0/false 是有效值），空数组算空',
  [0, false, '阿采', []].map(S.isBlankValue), [false, false, false, true]);
eq('visibleFields 不隐藏时返回同一个数组（不改引用、不改内容）',
  S.visibleFields(['a', 'b'], { a: '' }, false), ['a', 'b']);
eq('visibleFields 隐藏时按 data 判空',
  S.visibleFields(['a', 'b', 'c'], { a: '有', b: '', c: '  ' }, true), ['a']);
eq('setHideEmptyPolicy 会按档位归一（不许出现档位与布尔打架）',
  S.setHideEmptyPolicy({ mode: 'all', display: false, copy: false }),
  { mode: 'all', display: true, copy: true });
S.setHideEmptyPolicy({ mode: 'off' });

// ---------------- 五、整机链路：造一个真的 ModalManager 替身 ----------------

const FIELDS = ['昵称', '简介', '别名', '发布日期'];
const DATA = { '昵称': '阿采', '简介': '', '别名': '   ', '发布日期': '2026-11-07' };
const NON_EMPTY = ['昵称', '发布日期'];

function makeManager(mode, d, c, extra) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only', url: 'https://www.kuaishou.com/profile/abc'
  });
  const win = dom.window;
  win.ClipMateLog = { debug() {}, warn() {}, error() {} };
  win.eval(SRC.siteconfig);
  win.eval(SRC.table);
  win.eval(SRC.copy);
  win.eval(SRC.search);

  const Sites = win.ClipMateSites;
  Sites.setHideEmptyPolicy(Sites.resolveHideEmpty(cfg(mode, d, c), 'www.kuaishou.com'));

  const captured = [];
  win.Blob = function (parts, opts) {
    this._text = (parts || []).join('');
    this.type = (opts && opts.type) || '';
    this.text = async () => this._text;
  };
  win.ClipboardItem = function (obj) { this.obj = obj; };
  Object.defineProperty(win.navigator, 'clipboard', {
    configurable: true,
    value: {
      write: async (items) => {
        for (const it of items) {
          for (const k of Object.keys(it.obj || {})) {
            const blob = it.obj[k];
            captured.push(typeof blob.text === 'function' ? await blob.text() : String(blob));
          }
        }
      },
      writeText: async (text) => { captured.push(String(text)); }
    }
  });
  win.document.execCommand = () => true;

  const Proto = Object.assign({}, win.ModalTableMixin, win.ModalCopyMixin, win.ModalSearchMixin);
  const m = Object.create(Proto);
  m.fieldOrder = FIELDS.slice();
  m.data = Object.assign({}, DATA);
  m.displayMode = 'vertical';
  m.isEditMode = false;
  m._searchOpen = false;
  m._searchKeyword = '';
  m.showMessage = () => {};
  m.getMediaType = () => 'social';
  if (extra) Object.assign(m, extra);
  return { m, captured, Sites, win };
}

function rowFields(html) {
  const out = [];
  const re = /data-field="([^"]+)"/g;
  let hit;
  // th 与 td 都会带 data-field，只取 th（纵向）/ 第一个表头（横向）
  while ((hit = re.exec(html))) {
    if (out.indexOf(hit[1]) === -1) out.push(hit[1]);
  }
  return out;
}
async function render(mode, d, c, extra) {
  const { m } = makeManager(mode, d, c, extra);
  const vertical = m.createTable();
  m.displayMode = 'horizontal';
  const horizontal = m.createTable();
  return {
    vertical, horizontal,
    vFields: rowFields(vertical), hFields: rowFields(horizontal),
    order: m.fieldOrder, data: m.data
  };
}

section('五、真渲染 · 四档 × 纵向/横向');
(async function () {

  const off = await render('off');
  eq('off 纵向全量 4 行', off.vFields, FIELDS);
  eq('off 横向全量 4 列', off.hFields, FIELDS);
  ok('off 纵向真的画出了空字段行', off.vertical.indexOf('data-field="简介"') !== -1);
  ok('off 横向真的画出了空字段列', off.horizontal.indexOf('data-field="别名"') !== -1);

  const A = await render('display');
  eq('A 只隐藏显示：纵向剩 2 行', A.vFields, NON_EMPTY);
  eq('A 只隐藏显示：横向剩 2 列', A.hFields, NON_EMPTY);
  ok('A 纵向里「简介」整行不见', A.vertical.indexOf('data-field="简介"') === -1);
  ok('A 横向表头里「别名」整列不见', A.horizontal.indexOf('data-field="别名"') === -1);

  const B = await render('all');
  eq('B 显示与复制都隐藏：纵向剩 2 行', B.vFields, NON_EMPTY);
  eq('B 横向剩 2 列', B.hFields, NON_EMPTY);

  const cd = await render('custom', true, false);
  eq('自定义「只开显示隐藏」→ 纵向剩 2 行', cd.vFields, NON_EMPTY);
  const cc = await render('custom', false, true);
  eq('自定义「只开复制隐藏」→ 显示仍全量 4 行', cc.vFields, FIELDS);
  const c0 = await render('custom', false, false);
  eq('自定义两个都不开 → 跟不隐藏一样', c0.vFields, FIELDS);

  const edit = await render('display', false, false, { isEditMode: true });
  eq('编辑模式强制全量（空字段要能补填）', edit.vFields, FIELDS);
  ok('编辑模式给表格挂了 is-editing', edit.vertical.indexOf('is-editing') !== -1);
  const search = await render('display', false, false, { _searchOpen: true, _searchKeyword: '别名' });
  eq('搜索条打开时强制全量（字段名也搜得到）', search.vFields, FIELDS);

  eq('渲染没改 fieldOrder', off.order, FIELDS);
  eq('渲染没改 data', off.data, DATA);
  eq('A 档渲染也没改 fieldOrder', A.order, FIELDS);
  eq('A 档渲染也没改 data', A.data, DATA);

  // ---------------- 六、真复制链路 ----------------
  section('六、真复制 · A 全量 / B 少列 / 纯文本始终跳过空');

  async function notion(mode, d, c) {
    const { m, captured } = makeManager(mode, d, c);
    await m.copyData();
    // copyData 的 ClipboardItem 里 text/plain 在前、text/html 在后
    const tsv = captured[0] || '';
    return { cells: String(tsv).split('\t'), html: captured.find((s) => s.indexOf('<table>') !== -1) || '' };
  }
  async function markdown(mode, d, c) {
    const { m, captured } = makeManager(mode, d, c);
    await m.copyDataAsMarkdown();
    return captured[0] || '';
  }
  async function plaintext(mode, d, c) {
    const { m, captured } = makeManager(mode, d, c);
    await m.copyDataAsPlainText();
    return captured[0] || '';
  }

  const nOff = await notion('off');
  eq('off：Notion/TSV 仍是 4 格（含两个空格）', nOff.cells.length, 4);
  eq('off：TSV 顺序不变', nOff.cells, ['阿采', '', '', '2026-11-07']);
  eq('off：HTML 表格 4 个 td', (nOff.html.match(/<td>/g) || []).length, 4);

  const nA = await notion('display');
  eq('★ A 档：复制导出仍全量 4 格（不跟着隐藏）', nA.cells.length, 4);
  eq('★ A 档：TSV 顺序与 off 逐字节一致', nA.cells, ['阿采', '', '', '2026-11-07']);

  const nB = await notion('all');
  eq('★ B 档：复制导出也只剩 2 格', nB.cells.length, 2);
  eq('★ B 档：剩下的顺序仍按 fieldOrder', nB.cells, ['阿采', '2026-11-07']);
  eq('B 档：HTML 表格也只剩 2 个 td', (nB.html.match(/<td>/g) || []).length, 2);

  const nCustom = await notion('custom', false, true);
  eq('自定义只开「复制隐藏」→ 复制 2 格', nCustom.cells.length, 2);
  const nCustomDisplay = await notion('custom', true, false);
  eq('自定义只开「显示隐藏」→ 复制仍 4 格', nCustomDisplay.cells.length, 4);

  const mdOff = await markdown('off');
  ok('off：Markdown 含空字段「简介」那一行', mdOff.indexOf('| 简介 |') !== -1);
  const mdA = await markdown('display');
  ok('★ A 档：Markdown 仍含空字段行', mdA.indexOf('| 简介 |') !== -1);
  const mdB = await markdown('all');
  ok('★ B 档：Markdown 不再有「简介」行', mdB.indexOf('| 简介 |') === -1);
  ok('★ B 档：Markdown 仍保留有值的「昵称」行', mdB.indexOf('| 昵称 | 阿采 |') !== -1);
  eq('★ B 档：Markdown 只剩 2 条数据行', (mdB.match(/^\| (?!字段|---)/gm) || []).length, 2);

  const ptOff = await plaintext('off');
  const ptB = await plaintext('all');
  eq('纯文本复制本来就跳过空字段', ptOff, '昵称：阿采\n发布日期：2026-11-07');
  eq('纯文本复制不受任何档位影响', ptB, ptOff);

  // ---------------- 七、接线静态断言 ----------------
  section('七、接线静态断言（零件对了没装整机也必须红）');
  ok('createTable 走 _visibleFields(display)',
    /const fieldsToRender = this\._visibleFields\(this\.fieldOrder, 'display'\)/.test(SRC.table));
  eq('两个表格复制方法都走 _visibleFields(copy)',
    (SRC.copy.match(/this\._visibleFields\(this\.fieldOrder, 'copy'\)/g) || []).length, 2);
  ok('content-main 真的把策略写进共享模块',
    SRC.main.indexOf('resolver.setHideEmptyPolicy(he)') !== -1);
  ok('content-main 真的写页面探针属性（自动重载实测判据）',
    SRC.main.indexOf("rootEl.setAttribute('data-clipmate-hide-empty', he.mode)") !== -1 &&
    SRC.main.indexOf("'data-clipmate-hide-empty-combo'") !== -1);
  ok('background 两处默认配置都写了 off',
    (SRC.background.match(/hideEmptyMode: 'off'/g) || []).length === 2);
  ok('schema 里四档齐全',
    ["value: 'off'", "value: 'display'", "value: 'all'", "value: 'custom'"]
      .every((s) => SRC.schema.indexOf(s) !== -1));
  ok('schema 里自定义两项用 equals 依赖',
    (SRC.schema.match(/equals: 'custom'/g) || []).length === 2);
  ok('options 的依赖判断支持 equals',
    SRC.options.indexOf('hasOwnProperty.call(dep, \'equals\')') !== -1);
  ok('options 的站点快照统一走 siteSnapshot',
    SRC.options.indexOf('SITES.siteSnapshot(') !== -1);
  ok('搜索与编辑模式都走 _displayAllFields',
    SRC.table.indexOf('if (this.isEditMode) return true;') !== -1 &&
    SRC.table.indexOf('return !!this._searchOpen;') !== -1);

  // ---------------- 汇总 ----------------
  console.log('\n' + '─'.repeat(60));
  if (fails.length) {
    console.log('❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项');
    fails.forEach((f) => console.log('   · ' + f));
    process.exit(1);
  }
  console.log('✅ 全部通过：' + pass + ' 项');
})().catch((e) => {
  console.error('测试自身抛错：', e && e.stack ? e.stack : e);
  process.exit(1);
});
