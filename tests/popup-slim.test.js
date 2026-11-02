/**
 * popup 极简版（v2.8.4）—— 契约测试
 *
 * v2.8.2 把「全局默认」整块搬走了，但留下了「跟随全局 / 单独设置」的分段控件和
 * 「当前生效」核对区 —— 打开还是一屏文字。这一版重新设计：
 *
 *   · 删掉分段控件：不再先让你选「跟随」还是「单独」，改哪个开关就按本站存下来
 *   · 删掉核对区、删掉每项下面的说明文字：开关本身就是状态
 *   · 删掉「复制格式」里的「跟随全局」选项：只列三种格式，选回「继承值」时自动不写这条键
 *   · 删掉「同时对整个站生效」：popup 只管当前域名，要整站去设置页
 *   · 延迟 / 格式缩进成子行，父开关关掉就收起
 *   · 底部只在两件事上说话：「本站已单独设置 · 恢复默认」、「沿用 xxx 的设置」
 *
 * 断言分五层：静态结构 → 渲染与收起 → 写入与撤销 → 上层域名继承 → 深链与内部页
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const POPUP_DIR = path.join(ROOT, 'src', 'popup');
const HTML_PATH = path.join(POPUP_DIR, 'popup.html');
const JS_PATH = path.join(POPUP_DIR, 'popup.js');
const CSS_PATH = path.join(POPUP_DIR, 'popup.css');
const SITE_CONFIG_PATH = path.join(ROOT, 'src', 'shared', 'site-config.js');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };
let pass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(C.green + '  ✓ ' + C.reset + name);
  } else {
    fails.push(name + (extra !== undefined ? '（实际：' + extra + '）' : ''));
    console.log(C.red + '  ✗ ' + name + C.reset + (extra !== undefined ? C.dim + '  → ' + extra + C.reset : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name + (a === b ? '' : '  ← 期望 ' + b), a === b, actual);
}

function section(t) {
  console.log('\n' + C.bold + t + C.reset);
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

const HTML_RAW = fs.readFileSync(HTML_PATH, 'utf8');
const JS_SRC = fs.readFileSync(JS_PATH, 'utf8');
const CSS_SRC = fs.readFileSync(CSS_PATH, 'utf8');
const BODY_HTML = HTML_RAW
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '');

const BASE_CONFIG = {
  autoExtract: false,
  autoExtractDelay: 3,
  autoCopy: false,
  autoCopyFormat: 'markdown',
  showButton: true,
  siteOverrides: {},
  theme: 'system',
  fieldOrder: {},
  fieldMappings: {},
  features: {},
  settings: { enableCache: true, descLimits: { social: 50000, person: 5000, other: 500 } }
};

/** 起一个 popup 实例（tabUrl 决定「本站」是谁；configPatch 覆盖默认配置） */
function boot(tabUrl, configPatch) {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + BODY_HTML + '</body></html>', {
    url: 'chrome-extension://abc/src/popup/popup.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const state = {
    config: Object.assign({}, JSON.parse(JSON.stringify(BASE_CONFIG)), configPatch || {})
  };
  const created = [];
  const sent = [];
  let closed = false;

  win.chrome = {
    runtime: {
      getManifest: () => ({ version: '2.8.4' }),
      getURL: (p) => 'chrome-extension://abc/' + p,
      openOptionsPage: () => { throw new Error('不该再用 openOptionsPage（拿不到当前域名）'); },
      sendMessage: (msg) => {
        sent.push(JSON.parse(JSON.stringify(msg)));
        if (msg.action === 'getConfig') {
          return Promise.resolve({ config: JSON.parse(JSON.stringify(state.config)) });
        }
        if (msg.action === 'saveConfig') {
          state.config = Object.assign({}, state.config, msg.config || {});
          if (msg.config && msg.config.settings) {
            state.config.settings = Object.assign({}, state.config.settings, msg.config.settings);
          }
          return Promise.resolve({ success: true });
        }
        return Promise.resolve({});
      }
    },
    tabs: {
      query: () => Promise.resolve([{ id: 7, url: tabUrl, active: true }]),
      sendMessage: () => Promise.resolve({}),
      create: (opts) => { created.push(opts); }
    },
    storage: {
      local: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
      onChanged: { addListener: () => {} }
    }
  };

  win.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });
  win.close = () => { closed = true; };

  win.eval(fs.readFileSync(SITE_CONFIG_PATH, 'utf8'));
  // popup.js 里 popupManager 是 const 声明，不会自动挂到 window，补一行导出给测试用
  win.eval(JS_SRC + '\n;window.popupManager = popupManager;');

  return { win, doc: win.document, state, created, sent, page: win.popupManager, wasClosed: () => closed };
}

/** 触发一次「用户改了开关 / 下拉」 */
function fire(inst, el, prop, value) {
  if (!el) throw new Error('元素不存在');
  if (prop) el[prop] = value;
  el.dispatchEvent(new inst.win.Event('change'));
}

async function main() {
  console.log(C.bold + '\npopup 极简版（v2.8.4）' + C.reset);

  /* ============ 一、静态：旧结构不许长回来 ============ */
  section('一、静态结构：分段控件、核对区、说明段全部删干净');

  ok('popup.html 不再有 #siteSeg 分段控件', HTML_RAW.indexOf('id="siteSeg"') === -1);
  ok('popup.html 不再有 data-mode="follow"', HTML_RAW.indexOf('data-mode="follow"') === -1);
  ok('popup.html 不再有 #applyToParent（作用范围行已砍）', HTML_RAW.indexOf('id="applyToParent"') === -1);
  ok('popup.html 不再有 #effList 核对区', HTML_RAW.indexOf('id="effList"') === -1);
  ok('popup.html 不再有 #effSrc「来源：」', HTML_RAW.indexOf('id="effSrc"') === -1);
  // 注释里可以提这段历史，用户能看到的文字里不许有
  const HTML_VISIBLE = HTML_RAW.replace(/<!--[\s\S]*?-->/g, '');
  ok('popup.html 里已经不出现「跟随全局」四个字',
    HTML_VISIBLE.indexOf('跟随全局') === -1);
  ok('popup.html 里没有「单独设置」模式按钮',
    HTML_VISIBLE.indexOf('单独设置') === -1);
  ok('popup.css 里没有 .seg 分段样式', CSS_SRC.indexOf('.seg ') === -1 && CSS_SRC.indexOf('.seg{') === -1);
  ok('popup.css 里没有 .scope-row 样式', CSS_SRC.indexOf('.scope-row') === -1);
  ok('popup.js 里不再有 switchToFollow / switchToOwn',
    JS_SRC.indexOf('switchToFollow') === -1 && JS_SRC.indexOf('switchToOwn') === -1);

  ok('popup.js 不再调 clearCache（那个会把 config 一起删）', JS_SRC.indexOf("action: 'clearCache'") === -1);
  ok('popup.js 不再有 resetSettings 方法', JS_SRC.indexOf('async resetSettings') === -1);
  ok('不再用 openOptionsPage（拿不到当前域名）', JS_SRC.indexOf('runtime.openOptionsPage') === -1);
  ok('popup.html 不再有主题单选组', HTML_RAW.indexOf('name="theme"') === -1);

  // 四项设置 + 两个子项一个都不能少（砍了就会和设置页漂移）
  ['siteAutoExtract', 'siteAutoExtractDelay', 'siteAutoCopy', 'siteAutoCopyFormat', 'siteShowButton']
    .forEach((id) => ok('保留 #' + id, HTML_RAW.indexOf('id="' + id + '"') !== -1));

  eq('openOptions 只有一处', (HTML_RAW.match(/id="openOptions"/g) || []).length, 1);
  ok('设置入口是右上角图标按钮（带 aria-label 完整设置）',
    /id="openOptions"[^>]*aria-label="完整设置"/.test(HTML_RAW));
  ok('保存提示仍在', HTML_RAW.indexOf('id="savedTip"') !== -1);
  ok('恢复默认入口在', HTML_RAW.indexOf('id="restoreGlobal"') !== -1);

  // 说明文字与核对区一起消失 —— 只留开关本身
  ok('popup.html 里没有 .setting-description 说明段', HTML_RAW.indexOf('setting-description') === -1);
  ok('popup.html 里没有 .effective 核对块', HTML_RAW.indexOf('class="effective"') === -1);

  // 格式下拉：只有三种格式，没有「空值 = 跟随全局」那一项
  const fmtOptions = (HTML_RAW.match(/<option[^>]*value="([^"]*)"/g) || [])
    .map((s) => s.replace(/.*value="/, '').replace('"', ''));
  eq('格式下拉只有三种格式', fmtOptions, ['notion', 'markdown', 'plaintext']);

  /* ============ 二、渲染：值来自生效值，子行跟着父开关收 ============ */
  section('二、渲染：直接显示当前生效值，子项按需收放');

  const inst = boot('https://www.douyin.com/video/123');
  await tick(120);
  const { doc, state } = inst;

  ok('页面实例已创建', !!inst.page);
  eq('站点名识别为抖音', doc.getElementById('siteName').textContent, '抖音');
  eq('域名显示', doc.getElementById('siteHost').textContent, 'www.douyin.com');
  eq('版本号显示', doc.getElementById('popVersion').textContent, 'v2.8.4');
  eq('五个控件都在', doc.querySelectorAll('#siteRows input, #siteRows select').length, 5);
  eq('底部默认不说话（既没改过、也不继承别的规则）',
    doc.getElementById('footState').hidden, true);

  eq('自动提取关 → 等待秒数那行收起', doc.getElementById('rowDelay').hidden, true);
  eq('自动复制关 → 复制格式那行收起', doc.getElementById('rowFormat').hidden, true);
  eq('按钮开着 → 没有「按钮已隐藏」提示', doc.getElementById('rowBtnHint').hidden, true);

  // 打开这两个开关（渲染层面），子行应该露出来
  const onBoth = boot('https://www.douyin.com/video/123', { autoExtract: true, autoCopy: true, showButton: false });
  await tick(120);
  eq('自动提取开 → 等待秒数那行出现', onBoth.doc.getElementById('rowDelay').hidden, false);
  eq('自动复制开 → 复制格式那行出现', onBoth.doc.getElementById('rowFormat').hidden, false);
  eq('自动提取开 → 开关本身是勾上的', onBoth.doc.getElementById('siteAutoExtract').checked, true);
  eq('延迟显示当前生效的 3 秒', onBoth.doc.getElementById('siteDelayValue').textContent, '3');
  eq('格式下拉显示当前生效的 markdown',
    onBoth.doc.getElementById('siteAutoCopyFormat').value, 'markdown');
  eq('按钮关了 → 出现「按钮已隐藏」提示', onBoth.doc.getElementById('rowBtnHint').hidden, false);

  /* ============ 三、写入：改就直接按本站存，底部给撤销 ============ */
  section('三、写入：没有「先切换到单独设置」这一步');

  eq('一开始没有任何站点规则', Object.keys(state.config.siteOverrides).length, 0);

  // 直接改一个开关 —— 不点任何模式按钮
  const swBtn = doc.getElementById('siteShowButton');
  fire(inst, swBtn, 'checked', false);
  await tick(60);

  const ov = state.config.siteOverrides['www.douyin.com'];
  ok('第一次改动直接写出本站规则', !!ov);
  eq('快照含其余四项、不含格式键（格式继续跟着变）',
    Object.keys(ov || {}).sort(),
    ['autoCopy', 'autoExtract', 'autoExtractDelay', 'showButton']);
  eq('改的那一项落了盘', ov && ov.showButton, false);
  eq('底部出现「本站已单独设置」',
    doc.getElementById('footState').hidden, false);
  ok('底部出现「恢复默认」按钮', !doc.getElementById('restoreGlobal').hidden);
  eq('底部文案', doc.getElementById('footText').textContent, '本站已单独设置 ·');
  eq('提示词闪的是「已保存」', doc.getElementById('savedTip').textContent, '已保存');

  // 格式：选一个与继承值不同的 → 写下来
  const fmtSel = doc.getElementById('siteAutoCopyFormat');
  fire(inst, fmtSel, 'value', 'notion');
  await tick(60);
  eq('选 Notion（全局是 markdown）→ 写入 autoCopyFormat',
    state.config.siteOverrides['www.douyin.com'].autoCopyFormat, 'notion');

  // 再选回与继承值相同的 → 这条键必须被删掉，不能变成「冻死」
  fire(inst, fmtSel, 'value', 'markdown');
  await tick(60);
  ok('选回 markdown（等于继承值）→ 不写这条键，继续跟着全局变',
    !Object.prototype.hasOwnProperty.call(state.config.siteOverrides['www.douyin.com'], 'autoCopyFormat'));
  eq('其余四项仍在', Object.keys(state.config.siteOverrides['www.douyin.com']).sort(),
    ['autoCopy', 'autoExtract', 'autoExtractDelay', 'showButton']);

  // 恢复默认：删掉本站规则，底部重新闭嘴
  doc.getElementById('restoreGlobal').click();
  await tick(60);
  ok('恢复默认后本站规则被删掉',
    !Object.prototype.hasOwnProperty.call(state.config.siteOverrides, 'www.douyin.com'));
  eq('底部重新隐藏', doc.getElementById('footState').hidden, true);
  eq('按钮回到全局默认值（显示）', doc.getElementById('siteShowButton').checked, true);
  eq('提示词是「已恢复默认」', doc.getElementById('savedTip').textContent, '已恢复默认');

  /* ============ 四、上层域名规则：继承要说清楚，改一项不许把别的打回全局 ============ */
  section('四、继承 douban.com：说清来源，改一项不牵连其余');

  const doubanConfig = {
    autoExtract: false,
    autoCopy: true,
    autoCopyFormat: 'markdown',
    showButton: true,
    siteOverrides: {
      'douban.com': { autoExtract: true, autoExtractDelay: 8, autoCopy: false, autoCopyFormat: 'notion', showButton: false }
    }
  };
  const d = boot('https://book.douban.com/subject/1084336/', doubanConfig);
  await tick(120);

  eq('站点名识别为豆瓣读书', d.doc.getElementById('siteName').textContent, '豆瓣读书');
  eq('继承来的自动提取值（开）', d.doc.getElementById('siteAutoExtract').checked, true);
  eq('继承来的等待秒数（8）', d.doc.getElementById('siteDelayValue').textContent, '8');
  eq('继承来的格式（notion）', d.doc.getElementById('siteAutoCopyFormat').value, 'notion');
  eq('继承来的按钮状态（关）', d.doc.getElementById('siteShowButton').checked, false);
  eq('底部说明继承自哪条规则',
    d.doc.getElementById('footText').textContent, '沿用 douban.com 的设置');
  eq('继承状态下没有「恢复默认」（没有本站规则可恢复）',
    d.doc.getElementById('restoreGlobal').hidden, true);

  // 改一项 → 其余必须保持继承来的值，不许回落到全局
  fire(d, d.doc.getElementById('siteShowButton'), 'checked', true);
  await tick(60);
  const bookOv = d.state.config.siteOverrides['book.douban.com'];
  ok('写出的是 book.douban.com 这条（不是覆盖 douban.com）', !!bookOv);
  eq('父域名那条原样没动',
    d.state.config.siteOverrides['douban.com'].showButton, false);
  eq('快照里其余项保持继承值，没有被打回全局',
    { autoExtract: bookOv.autoExtract, autoExtractDelay: bookOv.autoExtractDelay, autoCopy: bookOv.autoCopy },
    { autoExtract: true, autoExtractDelay: 8, autoCopy: false });
  eq('改的那一项生效', bookOv.showButton, true);
  eq('底部改成「本站已单独设置」', d.doc.getElementById('footText').textContent, '本站已单独设置 ·');

  // 关键边界：继承值是 notion、全局是 markdown，本站选 markdown 必须真写下去
  fire(d, d.doc.getElementById('siteAutoCopyFormat'), 'value', 'markdown');
  await tick(60);
  eq('继承 notion、选 markdown → 必须写入（否则选择被父规则吃掉）',
    d.state.config.siteOverrides['book.douban.com'].autoCopyFormat, 'markdown');
  eq('写完显示 markdown', d.doc.getElementById('siteAutoCopyFormat').value, 'markdown');

  // 再恢复默认 → 回到 douban.com 那条
  d.doc.getElementById('restoreGlobal').click();
  await tick(60);
  ok('恢复默认删掉 book.douban.com 这条',
    !Object.prototype.hasOwnProperty.call(d.state.config.siteOverrides, 'book.douban.com'));
  eq('回到父规则（按钮重新变关）', d.doc.getElementById('siteShowButton').checked, false);
  eq('底部回到「沿用 douban.com 的设置」',
    d.doc.getElementById('footText').textContent, '沿用 douban.com 的设置');

  /* ============ 五、深链与内部页 ============ */
  section('五、设置入口：带上当前域名；内部页不瞎猜');

  doc.getElementById('openOptions').click();
  await tick(40);
  eq('打开了一个新标签', inst.created.length, 1);
  eq('URL 带 #sites?focus=<当前域名>',
    inst.created[0] && inst.created[0].url,
    'chrome-extension://abc/src/options/options.html#sites?focus=www.douyin.com');
  ok('打开后关掉 popup', inst.wasClosed());

  const internal = boot('chrome://extensions/');
  await tick(120);
  eq('内部页标题是「本站设置」', internal.doc.getElementById('siteName').textContent, '本站设置');
  ok('内部页提示「不支持单独设置」',
    internal.doc.getElementById('siteNote').textContent.indexOf('不支持单独设置') !== -1,
    internal.doc.getElementById('siteNote').textContent);
  eq('内部页把整块设置行收起来（不留五个灰开关）',
    internal.doc.getElementById('siteRows').hidden, true);
  internal.doc.getElementById('openOptions').click();
  await tick(40);
  eq('内部页退化为不带 focus',
    internal.created[0] && internal.created[0].url,
    'chrome-extension://abc/src/options/options.html');
  ok('内部页不会拼出 focus=undefined',
    String(internal.created[0].url).indexOf('undefined') === -1);

  // 没收录的站：留提示，但设置仍然能存
  const unknown = boot('https://example.org/a');
  await tick(120);
  eq('未收录站点名用域名', unknown.doc.getElementById('siteName').textContent, 'example.org');
  eq('未收录站给出提示', unknown.doc.getElementById('siteNote').hidden, false);
  eq('未收录站设置行仍然显示', unknown.doc.getElementById('siteRows').hidden, false);

  /* ============ 六、主题仍是「读配置」，界面上不再有开关 ============ */
  section('六、主题：跟着 config.theme 走，界面上没有开关');

  const themed = boot('https://www.douban.com/subject/1/');
  await tick(120);
  ok('默认（system）不加 theme-dark', !themed.doc.body.classList.contains('theme-dark'));

  const themedDark = boot('https://www.douban.com/subject/1/', { theme: 'dark' });
  await tick(120);
  ok('config.theme=dark → body 加 theme-dark',
    themedDark.doc.body.classList.contains('theme-dark'));

  themedDark.page.applyTheme('default');
  ok('未知值 default 按跟随系统处理',
    !themedDark.doc.body.classList.contains('theme-dark') ||
    themedDark.doc.body.classList.contains('theme-light'));

  // ============ 汇总 ============
  console.log('\n' + '─'.repeat(56));
  if (fails.length) {
    console.log(C.red + '❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项' + C.reset);
    fails.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  } else {
    console.log(C.green + '✅ 全部通过：' + pass + ' 项' + C.reset);
  }
}

main().catch((e) => {
  console.error('测试自身崩了：', (e && e.stack) || e);
  process.exitCode = 1;
});
