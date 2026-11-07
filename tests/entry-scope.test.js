#!/usr/bin/env node
/**
 * 社交 9 站「入口场景」通用层（v2.12.9）
 *
 * 用户三条补充（对**所有社交站**同样要求，不是快手特例）：
 *   ① 弹层反复开 N 次，按钮换肤都要正确；
 *   ② 主页「整理档案」与弹层「提取」要有**两个独立的位置**；
 *   ③ 主页浮窗默认**横向**、弹层浮窗默认**纵向**，两者**独立设置**。
 * 用户改口：以上状态要**长期记住**（关掉浏览器明天再开仍生效）；
 * 但「当前此刻是哪种入口」不落盘，刷新后按页面重新判定。
 *
 * 本测试只读产品源码，用 jsdom 把真代码注入 window，跑真实 ButtonManager /
 * 真实 ModalWindowMixin.open / 真实 ModalTableMixin.toggleDisplayMode，
 * 不拿自己重写的假逻辑冒充被测对象。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const INLINE = read('src/content/shared/mascot-inline.js');
const RESOLVER = read('src/content/shared/mascot-url.js');
const SCOPE = read('src/content/shared/entry-scope.js');
const BTN = read('src/content/ui/button-manager.js');
const MODALWIN = read('src/content/ui/modal-window.js');
const MODALTBL = read('src/content/ui/modal-table-renderer.js');
const MAIN = read('src/content/content-main.js');
const MANIFEST = JSON.parse(read('manifest.json'));
// v2.12.10：站点状态机自己的锚点标记也要能归位（真机 K5/K6 抓到的残留）
const KSSPA = read('src/content/ui/kuaishou-spa-handler.js');
const DYSPA = read('src/content/ui/douyin-spa-handler.js');
const TTSPA = read('src/content/ui/tiktok-spa-handler.js');

let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++;
  else { failures.push(name); console.log(`  ❌ ${name}${detail ? '  ' + detail : ''}`); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, v, detail) { ok(name, !!v, detail); }
function falsy(name, v, detail) { ok(name, !v, detail); }
function section(t) { console.log(`\n${t}`); }

/** 注入真源码后立刻摘掉 script，不留文本在 DOM 里污染「整页搜」类提取器 */
function inject(win, code) {
  const s = win.document.createElement('script');
  s.textContent = code;
  win.document.documentElement.appendChild(s);
  if (s.parentNode) s.parentNode.removeChild(s);
}

function dumpStorage(win) {
  const out = {};
  for (let i = 0; i < win.localStorage.length; i++) {
    const k = win.localStorage.key(i);
    out[k] = win.localStorage.getItem(k);
  }
  return out;
}

/** 只装通用层（快），用于白名单 / 分桶 / 长期记住 */
function scopeWindow(host, seed, oldPrefs) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://' + host + '/', runScripts: 'dangerously'
  });
  const win = dom.window;
  win.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };
  win.WBR = {
    storage: { local: {
      get: async () => ({ clipmate_ui_prefs: oldPrefs || {} }),
      set: async () => {}
    } }
  };
  if (seed) Object.keys(seed).forEach((k) => win.localStorage.setItem(k, seed[k]));
  inject(win, SCOPE);
  return win;
}

/** 装全套（真按钮 + 真浮窗 mixin），用于端到端 */
function fullWindow(host, seed, oldPrefs) {
  const win = scopeWindow(host, seed, oldPrefs);
  win.requestAnimationFrame = (cb) => { cb(0); return 1; };
  win.cancelAnimationFrame = () => {};
  win.chrome = { runtime: { getURL: (p) => 'chrome-extension://fake/' + p } };
  win.FloatingWindowClass = function () {};   // 让 open() 跳过 2 秒等待
  for (const code of [INLINE, RESOLVER, BTN, MODALWIN, MODALTBL]) inject(win, code);
  return win;
}

/** 把两个 mixin 挂到桩 host 上，open / toggleDisplayMode 跑的是真代码 */
function makeModal(win, mediaType) {
  const host = Object.assign({}, win.ModalWindowMixin, win.ModalTableMixin, {
    floatingWindow: null,
    isOpen: false,
    displayMode: 'vertical',
    data: {},
    fieldOrder: [],
    uiPrefs: {},
    _savedOld: null,
    _prepareData: async () => {},
    createFloatingWindow: () => { host.floatingWindow = {}; },
    attachEvents: () => {},
    _bindWindowResize: () => {},
    updateTable: () => {},
    getMediaType: () => mediaType || 'person',
    _getUiPref(mt) { return (this.uiPrefs || {})[mt] || {}; },
    _saveUiPref(mt, patch) {
      this.uiPrefs[mt] = Object.assign({}, this.uiPrefs[mt] || {}, patch);
      this._savedOld = { mt, patch };
    }
  });
  return host;
}

const SITE_KEYS = ['bilibili', 'douyin', 'kuaishou', 'xiaohongshu', 'weibo',
  'x', 'instagram', 'youtube', 'tiktok'];
const SITE_HOSTS = {
  bilibili: 'space.bilibili.com', douyin: 'www.douyin.com',
  kuaishou: 'www.kuaishou.com', xiaohongshu: 'www.xiaohongshu.com',
  weibo: 'weibo.com', x: 'x.com', instagram: 'www.instagram.com',
  youtube: 'www.youtube.com', tiktok: 'www.tiktok.com'
};

(async function main() {
  console.log('============ 社交 9 站「入口场景」通用层（v2.12.9）============');

  /* ============================================================
   * 一、白名单：只认社交分组 9 站，其它分组一个字节不碰
   * ==========================================================*/
  section('一、白名单与入口判定');
  {
    const win = scopeWindow('www.kuaishou.com');
    const E = win.ClipMateEntryScope;
    eq('白名单恰好 9 站', E.SITES.length, 9);
    SITE_KEYS.forEach((k) => truthy(`白名单含 ${k}`, E.SITES.some((s) => s.key === k)));
    eq('站点归一 space.bilibili.com', E.siteKeyOf('space.bilibili.com'), 'bilibili');
    eq('站点归一 m.weibo.cn', E.siteKeyOf('m.weibo.cn'), 'weibo');
    eq('站点归一 s.weibo.com', E.siteKeyOf('s.weibo.com'), 'weibo');
    eq('站点归一 m.youtube.com', E.siteKeyOf('m.youtube.com'), 'youtube');
    eq('站点归一 v.douyin.com', E.siteKeyOf('v.douyin.com'), 'douyin');
    eq('豆瓣电影不是社交站', E.siteKeyOf('movie.douban.com'), '');
    eq('豆瓣读书不是社交站', E.siteKeyOf('book.douban.com'), '');
    eq('notx.com 不许误判成 x.com', E.siteKeyOf('notx.com'), '');
    eq('fakeinstagram.com 不许误判', E.siteKeyOf('fakeinstagram.com'), '');
    truthy('快手已启用', E.enabled());
    falsy('豆瓣未启用', scopeWindow('movie.douban.com').ClipMateEntryScope.enabled());

    eq('初始入口为空（页面事实，未判定）', E.current(), '');
    eq('未判定时按作品兜底', E.effectiveScope(), 'work');
    eq('scopeFromSkin arch → profile', E.scopeFromSkin('arch'), 'profile');
    eq('scopeFromSkin default → work', E.scopeFromSkin('default'), 'work');

    const t1 = E.onSkin('arch');
    eq('换档案皮 → profile', E.current(), 'profile');
    truthy('首次切换 changed=true', t1 && t1.changed);
    const t2 = E.onSkin('arch');
    falsy('同皮肤重复换不重复触发', t2 && t2.changed);
    eq('confirm(person) 校准 profile', (E.confirm('person'), E.current()), 'profile');
    eq('confirm(social) 校准 work', (E.confirm('social'), E.current()), 'work');
    eq('confirm(movie) 不越权', E.confirm('movie'), null);
    eq('confirm(undefined) 不越权', E.confirm(undefined), null);
    eq('set(非法值) 不越权', E.set('feed'), null);
    E.resetRuntime();
    eq('resetRuntime 只清运行时', E.current(), '');

    const douban = scopeWindow('movie.douban.com').ClipMateEntryScope;
    eq('非社交站 onSkin 返回 null', douban.onSkin('arch'), null);
    eq('非社交站 confirm 返回 null', douban.confirm('person'), null);
    eq('非社交站位置键仍是老键', douban.positionKey(), 'clipmate-button-position-movie.douban.com');
    eq('非社交站读方向为空', douban.readLayout('work'), '');
    falsy('非社交站写方向被拒', douban.writeLayout('work', 'horizontal'));
    falsy('非社交站写拖过标记被拒', douban.writeUserMoved('work', true));
  }

  /* ============================================================
   * 二、分桶 + 长期记住 + 老键只读迁移
   * ==========================================================*/
  section('二、分桶、长期记住、老键迁移');
  {
    const E = scopeWindow('www.kuaishou.com').ClipMateEntryScope;
    eq('bucket(profile)', E.bucket('profile'), 'kuaishou@profile');
    eq('bucket(work)', E.bucket('work'), 'kuaishou@work');
    eq('defaultLayout(profile) 横向', E.defaultLayout('profile'), 'horizontal');
    eq('defaultLayout(work) 纵向', E.defaultLayout('work'), 'vertical');
    eq('positionKey(profile)', E.positionKey('profile'), 'clipmate-button-position-kuaishou@profile');
    eq('positionKey(work)', E.positionKey('work'), 'clipmate-button-position-kuaishou@work');

    truthy('写 profile 横向', E.writeLayout('profile', 'horizontal'));
    truthy('写 work 纵向', E.writeLayout('work', 'vertical'));
    eq('读 profile 横向', E.readLayout('profile'), 'horizontal');
    eq('读 work 纵向', E.readLayout('work'), 'vertical');
    E.writeLayout('profile', 'vertical');
    eq('改 profile 不影响 work', E.readLayout('work'), 'vertical');
    eq('改后 profile 是纵向', E.readLayout('profile'), 'vertical');
    falsy('非法方向被拒', E.writeLayout('work', 'diagonal'));
    eq('被拒后 work 保持纵向', E.readLayout('work'), 'vertical');

    truthy('写 profile 拖过', E.writeUserMoved('profile', true));
    truthy('写 work 没拖过', E.writeUserMoved('work', false));
    eq('读 profile 拖过', E.readUserMoved('profile'), true);
    eq('读 work 没拖过', E.readUserMoved('work'), false);
    E.writeUserMoved('work', true);
    eq('改 work 不影响 profile', E.readUserMoved('profile'), true);

    // 「关浏览器、明天再开」：把落盘数据整份搬进一个全新 window
    const seed = dumpStorage(scopeWindow('www.kuaishou.com'));
    const win1 = scopeWindow('www.kuaishou.com', seed);
    // 上面那个 win 不是同一个 window，重新在 win1 里写一遍再复制，才是真·跨会话
    win1.ClipMateEntryScope.writeLayout('profile', 'horizontal');
    win1.ClipMateEntryScope.writeLayout('work', 'vertical');
    win1.ClipMateEntryScope.writeUserMoved('profile', true);
    win1.ClipMateEntryScope.writeUserMoved('work', false);
    win1.localStorage.setItem('clipmate-button-position-kuaishou@profile', '{"left":111,"top":222}');
    win1.localStorage.setItem('clipmate-button-position-kuaishou@work', '{"left":333,"top":444}');
    const reopened = scopeWindow('www.kuaishou.com', dumpStorage(win1)).ClipMateEntryScope;
    eq('重开后 profile 方向还在', reopened.readLayout('profile'), 'horizontal');
    eq('重开后 work 方向还在', reopened.readLayout('work'), 'vertical');
    eq('重开后 profile 拖过标记还在', reopened.readUserMoved('profile'), true);
    eq('重开后 work 拖过标记还在', reopened.readUserMoved('work'), false);
    eq('★ 当前入口没有被记住（仍是未判定）', reopened.current(), '');
    eq('★ 重开后按作品兜底', reopened.effectiveScope(), 'work');
  }
  {
    const legacy = '{"left":50,"top":60}';
    const win = scopeWindow('www.douyin.com', {
      'clipmate-button-position-www.douyin.com': legacy
    });
    const E = win.ClipMateEntryScope;
    eq('迁移前 profile 新键不存在', win.localStorage.getItem('clipmate-button-position-douyin@profile'), null);
    E.positionKey();
    eq('迁移后 profile 新键 = 老值', win.localStorage.getItem('clipmate-button-position-douyin@profile'), legacy);
    eq('迁移后 work 新键 = 老值', win.localStorage.getItem('clipmate-button-position-douyin@work'), legacy);
    eq('★ 老键只读，未被删改', win.localStorage.getItem('clipmate-button-position-www.douyin.com'), legacy);
    eq('迁移标记已写', win.localStorage.getItem('clipmate-entry-migrated-douyin'), '1');
    win.localStorage.setItem('clipmate-button-position-douyin@profile', '{"left":9,"top":9}');
    E.positionKey();
    eq('★ 迁移只做一次，不覆盖用户后来拖的位置',
      win.localStorage.getItem('clipmate-button-position-douyin@profile'), '{"left":9,"top":9}');
  }

  /* ============================================================
   * 三、真实浮窗：方向按入口独立；非社交站零回归
   * ==========================================================*/
  section('三、真实 open / toggleDisplayMode');
  {
    const win = fullWindow('www.kuaishou.com');
    const E = win.ClipMateEntryScope;
    const modal = makeModal(win, 'person');

    E.onSkin('arch');                     // 主页
    await modal.open({ 名字: '某人' });
    eq('★ 主页首次开窗 = 横向', modal.displayMode, 'horizontal');

    E.onSkin('default');                  // 弹层
    await modal.open({ 文案: '一条作品' });
    eq('★ 弹层开窗 = 纵向（不沿用主页）', modal.displayMode, 'vertical');

    // 用户在弹层手动切成横向 → 只写 work 桶
    modal.displayMode = 'vertical';
    modal.toggleDisplayMode();
    eq('手动切后当前是横向', modal.displayMode, 'horizontal');
    eq('★ 手动切换写进 work 桶', E.readLayout('work'), 'horizontal');
    eq('★ 手动切换没串到 profile 桶', E.readLayout('profile'), '');
    falsy('★ 手动切换不写老键 clipmate_ui_prefs', modal._savedOld);

    await modal.open({ 名字: '某人' });   // 同一实例、没换页，验证不沿用旧值
    eq('★ 弹层再开窗仍是横向（记住了）', modal.displayMode, 'horizontal');
    E.onSkin('arch');
    await modal.open({ 名字: '某人' });
    eq('★ 回主页开窗仍是横向默认（没被弹层带坏）', modal.displayMode, 'horizontal');

    // 两个入口各自手动设成相反值，来回切必须各回各的
    E.writeLayout('profile', 'vertical');
    E.writeLayout('work', 'horizontal');
    E.onSkin('arch'); await modal.open({ 名字: '某人' });
    eq('★ profile 自定义纵向生效', modal.displayMode, 'vertical');
    E.onSkin('default'); await modal.open({ 文案: '作品' });
    eq('★ work 自定义横向生效', modal.displayMode, 'horizontal');
    E.onSkin('arch'); await modal.open({ 名字: '某人' });
    eq('★ 再回 profile 仍纵向', modal.displayMode, 'vertical');

    // 非社交站：完全走老逻辑，新键一个字节不写
    const dbWin = fullWindow('movie.douban.com', {}, { person: { layout: 'horizontal' } });
    const dbModal = makeModal(dbWin, 'person');
    await dbModal.open({ 名字: '某电影' });
    eq('非社交站仍读老 pref', dbModal.displayMode, 'horizontal');
    dbModal.toggleDisplayMode();
    eq('非社交站手动切换仍写老 pref', dbModal._savedOld && dbModal._savedOld.mt, 'person');
    eq('非社交站手动切换 layout', dbModal._savedOld && dbModal._savedOld.patch.layout, 'vertical');
    eq('★ 非社交站不产生新键', dbWin.localStorage.getItem('clipmate_entry_prefs'), null);
  }

  /* ============================================================
   * 四、真实按钮：位置 / 拖过标记按入口独立，4 轮往返
   * ==========================================================*/
  section('四、真实 ButtonManager 位置隔离（4 轮往返）');
  {
    const win = fullWindow('www.kuaishou.com');
    const E = win.ClipMateEntryScope;
    const bm = new win.ButtonManager();
    const pos = (scope) => JSON.parse(win.localStorage.getItem('clipmate-button-position-kuaishou@' + scope) || 'null');

    bm.setSkin('arch');
    eq('主页态 scope', E.current(), 'profile');
    bm.savePosition({ left: 111, top: 222 });
    bm.userMoved = true;
    bm._persistUserMoved(true);

    bm.setSkin('default');
    eq('弹层态 scope', E.current(), 'work');
    eq('★ 切到弹层后位置键换了桶', E.positionKey(), 'clipmate-button-position-kuaishou@work');
    eq('★ 弹层态拖过标记独立归零', bm.userMoved, false);
    bm.savePosition({ left: 333, top: 444 });
    eq('★ 弹层位置没写进 profile 桶', pos('profile').left, 111);

    for (let round = 1; round <= 4; round++) {
      bm.setSkin('arch');
      eq(`第 ${round} 轮回主页 scope`, E.current(), 'profile');
      eq(`第 ${round} 轮回主页位置`, pos('profile').left, 111);
      eq(`第 ${round} 轮回主页拖过标记`, bm.userMoved, true);
      bm.setSkin('default');
      eq(`第 ${round} 轮进弹层 scope`, E.current(), 'work');
      eq(`第 ${round} 轮进弹层位置`, pos('work').left, 333);
      eq(`第 ${round} 轮进弹层拖过标记`, bm.userMoved, false);
    }
    // 位置恢复真的落到按钮上（不是只存在 localStorage 里）
    bm.setSkin('arch');
    eq('★ 回主页按钮坐标被恢复', bm.button.style.left, '111px');
    bm.setSkin('default');
    eq('★ 进弹层按钮坐标被换成另一个桶', bm.button.style.left, '333px');

    const dbWin = fullWindow('movie.douban.com');
    const dbBm = new dbWin.ButtonManager();
    dbBm.savePosition({ left: 77, top: 88 });
    eq('★ 非社交站位置仍写老键',
      dbWin.localStorage.getItem('clipmate-button-position-movie.douban.com'), '{"left":77,"top":88}');
    dbBm.setSkin('arch');
    eq('★ 非社交站换肤不动入口', dbWin.ClipMateEntryScope.current(), '');
  }

  /* ============================================================
   * 五、9 站 × 4 轮往返（离线覆盖每一站）
   * ==========================================================*/
  section('五、9 站 × 4 轮往返');
  for (const key of SITE_KEYS) {
    const host = SITE_HOSTS[key];
    const win = scopeWindow(host);
    const E = win.ClipMateEntryScope;
    truthy(`${key} 已启用`, E.enabled());
    eq(`${key} bucket 前缀`, E.bucket('profile'), key + '@profile');
    E.writeLayout('profile', 'horizontal');
    E.writeLayout('work', 'vertical');
    for (let round = 1; round <= 4; round++) {
      E.onSkin('arch');
      eq(`${key} 第 ${round} 轮 profile`, E.current(), 'profile');
      eq(`${key} 第 ${round} 轮横向`, E.readLayout('profile'), 'horizontal');
      eq(`${key} 第 ${round} 轮位置键`, E.positionKey(), `clipmate-button-position-${key}@profile`);
      E.onSkin('default');
      eq(`${key} 第 ${round} 轮 work`, E.current(), 'work');
      eq(`${key} 第 ${round} 轮纵向`, E.readLayout('work'), 'vertical');
      eq(`${key} 第 ${round} 轮位置键`, E.positionKey(), `clipmate-button-position-${key}@work`);
    }
    // 该站改自己，不许影响别的站
    E.writeLayout('profile', 'vertical');
    const other = key === 'kuaishou' ? 'douyin' : 'kuaishou';
    const otherWin = scopeWindow(SITE_HOSTS[other]);
    otherWin.ClipMateEntryScope.writeLayout('profile', 'horizontal');
    eq(`${key} 与 ${other} 分桶互不影响`, E.readLayout('profile'), 'vertical');
    eq(`${other} 仍是横向`, otherWin.ClipMateEntryScope.readLayout('profile'), 'horizontal');
  }

  /* ============================================================
   * 六、接线与版本（静态钉住，防止「零件对但没装成整机」）
   * ==========================================================*/
  section('六、接线与版本');
  {
    const js = MANIFEST.content_scripts[0].js;
    const iScope = js.indexOf('src/content/shared/entry-scope.js');
    const iBtn = js.indexOf('src/content/ui/button-manager.js');
    const iWin = js.indexOf('src/content/ui/modal-window.js');
    const iTbl = js.indexOf('src/content/ui/modal-table-renderer.js');
    truthy('manifest 注入了 entry-scope.js', iScope >= 0);
    truthy('★ entry-scope 在 button-manager 之前加载', iScope >= 0 && iScope < iBtn);
    truthy('★ entry-scope 在 modal-window 之前加载', iScope >= 0 && iScope < iWin);
    truthy('entry-scope 在 modal-table-renderer 之前加载', iScope >= 0 && iScope < iTbl);
    eq('manifest 版本', MANIFEST.version, '2.12.10');

    truthy('★ button-manager.setSkin 接了 onSkin', /ClipMateEntryScope\.onSkin\(next\)/.test(BTN));
    truthy('★ 幂等 return 仍排在 onSkin 之前',
      /setSkin\(skin\)[\s\S]{0,240}?if \(this\._skin === next\) return;[\s\S]{0,400}?ClipMateEntryScope\.onSkin/.test(BTN));
    truthy('★ 切入口会恢复按钮位置', /if \(tr && tr\.changed\) this\._restoreEntryScopePosition\(\);/.test(BTN));
    truthy('★ savePosition 走分桶键', /ClipMateEntryScope\.positionKey\(\)/.test(BTN));
    truthy('★ loadSavedPosition 走分桶键', /loadSavedPosition\(\)[\s\S]{0,300}?ClipMateEntryScope\.positionKey\(\)/.test(BTN));
    truthy('★ 拖过标记会落盘', /_persistUserMoved\(true\)/.test(BTN));

    truthy('★ open 接了入口分支', /ClipMateEntryScope\.enabled\(\)/.test(MODALWIN) &&
      /ClipMateEntryScope\.defaultLayout\(scope\)/.test(MODALWIN));
    truthy('★ open 每次显式给方向', /this\.displayMode = \(saved === 'horizontal' \|\| saved === 'vertical'\)/.test(MODALWIN));
    truthy('★ open 非社交站保留老逻辑', /const savedLayout = this\._getUiPref\(this\.getMediaType\(\)\)\.layout;/.test(MODALWIN));
    truthy('★ toggleDisplayMode 写入口分桶', /ClipMateEntryScope\.writeLayout/.test(MODALTBL));
    truthy('★ toggleDisplayMode 非社交站保留老逻辑', /this\._saveUiPref\(mt, \{ layout: this\.displayMode \}\)/.test(MODALTBL));

    const iConfirm = MAIN.indexOf('ClipMateEntryScope.confirm(mapperType)');
    const iOpen = MAIN.indexOf('await this.modalManager.open(combinedData)');
    truthy('★ handleExtract 在开窗前用字段模板校准入口', iConfirm > 0 && iOpen > iConfirm);
    truthy('★ 校准改变入口时同步恢复位置', /_restoreEntryScopePosition\(\)/.test(MAIN));
    // 只查「字符串字面量」：注释里提到老键是在解释为什么不碰它，
    // 用 indexOf 全文搜会假红（v2.11.x 注释命中事故同一类）。
    truthy('★ 通用层不碰老键 clipmate_ui_prefs', !/['"]clipmate_ui_prefs['"]/.test(SCOPE));
    truthy('★ 当前入口不落盘（没有写 current 的落盘语句）',
      !/lsSet\([^)]*current|_scope\s*=\s*JSON\.parse/.test(SCOPE));
    truthy('★ 判定不靠网址', !/location\.pathname|location\.href/.test(SCOPE));
  }

  section('七、站点状态机的锚点标记必须能归位（v2.12.10）');
  {
    // 9 站通用层故意不碰 `data-clipmate-anchor`（TikTok 靠它判「离开推荐流」），
    // 所以每个会写这个标记的站点，都必须自己负责清 —— 不许只清快手一家。
    const writers = [['快手', KSSPA], ['抖音', DYSPA], ['TikTok', TTSPA]];
    writers.forEach(([name, src]) => {
      truthy(`★ ${name} 会写锚点标记`, /setAttribute\('data-clipmate-anchor'/.test(src));
      truthy(`★ ${name} 有清理锚点标记的代码`, /removeAttribute\('data-clipmate-anchor'\)/.test(src));
    });
    const iRestore = KSSPA.indexOf('async _restoreKuaishouProfilePerson()');
    const iNext = KSSPA.indexOf('_isKuaishouBreakerTripped()', iRestore);
    const restoreBody = iRestore > 0 && iNext > iRestore ? KSSPA.slice(iRestore, iNext) : '';
    truthy('★ 快手「回主页」出口里会清锚点标记（不是只挂在别的分支）',
      restoreBody.length > 0 && /removeAttribute\('data-clipmate-anchor'\)/.test(restoreBody));
    truthy('★ 通用层不碰站点标记（TikTok 要读它）', !/data-clipmate-anchor/.test(SCOPE));
    truthy('★ ButtonManager 位置恢复不碰站点标记',
      !/removeAttribute\('data-clipmate-anchor'\)/.test(BTN));
  }

  console.log(`\n${pass} 通过，${failures.length} 失败`);
  if (failures.length) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
