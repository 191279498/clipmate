/**
 * 设置页 + 设置项定义 + 站点专属开关 + 字段页 / 数据页（v2.8.0 / v2.8.1）
 *
 * 为什么单独写一份：
 *   这一批改的全是「设置层」，提取逻辑一行没动 —— 快照（19 样本）正好测不到它。
 *   而设置层最容易出的错恰恰是「看起来改了、其实没写进去」和「写进去了、但落错了地方」：
 *     · 旧版就踩过：设置页改完站点设置，另一个已打开的标签要刷新才生效；
 *     · 抖音/快手那几个开关存在**旧独立键**里，设置页若只写新位置，
 *       旧代码读不到 → 开关拨了没反应，而且不会有任何报错。
 *
 * 钉住的四件事：
 *   1) settings-schema：默认值 / 脏值回退 / 越界收敛 / 嵌套补丁不吞兄弟键；
 *   2) feature-flags：新位置优先、旧键回退、缺省=开（升级不改变既有行为）；
 *   3) 设置页渲染：通用 6 项、23 个站、站点专属开关只挂在对应站上；
 *   4) 写盘形状：站点开关写「快照 + 只改一项」、功能开关**双写** config 与旧键、撤销能回退。
 *
 * 跑法（项目根目录）：
 *   node tests/settings-page.test.js
 *   node tests/settings-page.test.js --verbose
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
const OPTIONS_DIR = path.join(ROOT, 'options');

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

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

// ============ 一、两个纯模块（Node 直接 require） ============

const schema = require(path.join(ROOT, 'shared', 'settings-schema.js'));
const flags = require(path.join(ROOT, 'shared', 'feature-flags.js'));

console.log('\n【一】设置项定义 settings-schema');

eq('共 11 个设置项', schema.ITEMS.length, 11);
eq('站点可单独设的 6 项', schema.siteItems().map((i) => i.key),
  ['autoExtract', 'autoExtractDelay', 'autoCopy', 'autoCopyFormat', 'showButton', 'autoDismiss']);
ok('autoDismiss 是 siteOnly（只在站点卡片，通用页不显示）',
  schema.byKey('autoDismiss').siteOnly === true);
ok('enableCache 不允许站点覆盖', schema.byKey('enableCache').siteOverridable === false);

// 正文：脏值 / 缺字段都回退默认
eq('缺字段 → 默认 false', schema.read({}, schema.byKey('autoExtract')), false);
eq('脏值 abc → 默认 3', schema.read({ autoExtractDelay: 'abc' }, schema.byKey('autoExtractDelay')), 3);
eq('越界 99 → 收到 20', schema.read({ autoExtractDelay: 99 }, schema.byKey('autoExtractDelay')), 20);
eq('负数 -5 → 收到 0', schema.read({ autoExtractDelay: -5 }, schema.byKey('autoExtractDelay')), 0);
eq('非法格式 → markdown',
  schema.read({ autoCopyFormat: 'rtf' }, schema.byKey('autoCopyFormat')), 'markdown');
eq('showButton 缺省 → true', schema.read({}, schema.byKey('showButton')), true);

// v2.8.2 新增：主题 + 简介长度三档
eq('主题默认跟随系统', schema.read({}, schema.byKey('theme')), 'system');
eq('老配置里的 default 当跟随系统', schema.read({ theme: 'default' }, schema.byKey('theme')), 'system');
eq('主题三个选项', schema.byKey('theme').options.map((o) => o.value), ['system', 'light', 'dark']);
eq('简介长度三项的落点', ['descSocial', 'descPerson', 'descOther'].map((k) => schema.byKey(k).path.join('.')),
  ['settings.descLimits.social', 'settings.descLimits.person', 'settings.descLimits.other']);
eq('简介长度默认值与搬进设置页之前完全一致',
  ['descSocial', 'descPerson', 'descOther'].map((k) => schema.read({}, schema.byKey(k))),
  [50000, 5000, 500]);
eq('填 0 = 不限制（不许被收敛成下限）',
  schema.read({ settings: { descLimits: { other: 0 } } }, schema.byKey('descOther')), 0);
eq('脏值 abc → 回默认 500',
  schema.read({ settings: { descLimits: { other: 'abc' } } }, schema.byKey('descOther')), 500);
eq('越界 999999 → 收到 200000',
  schema.read({ settings: { descLimits: { other: 999999 } } }, schema.byKey('descOther')), 200000);

// 补丁形状：嵌套项必须带上兄弟键，否则后台浅合并会把它们吃掉
eq('顶层补丁', schema.buildPatch({}, 'autoExtract', true), { autoExtract: true });
const cachePatch = schema.buildPatch(
  { settings: { enableCache: true, descLimits: { social: 1 } } }, 'enableCache', false);
eq('嵌套补丁保留兄弟键', cachePatch,
  { settings: { enableCache: false, descLimits: { social: 1 } } });

// v2.8.2：三层嵌套（settings.descLimits.social）要逐层带上兄弟键，否则浅合并会吃掉
const deepPatch = schema.buildPatch(
  { settings: { enableCache: false, descLimits: { social: 50000, person: 5000, other: 500 } } },
  'descSocial', 12000);
eq('三层补丁：只换目标，两层兄弟键全带上', deepPatch,
  { settings: { enableCache: false, descLimits: { social: 12000, person: 5000, other: 500 } } });

console.log('\n【二】站点专属开关 feature-flags');

eq('注册 8 个功能', flags.FEATURES.length, 8);
eq('旧键 5 个', flags.legacyKeys().sort(), [
  'douyinImmersiveEnabled', 'douyinModalEnabled',
  'kuaishouImmersiveEnabled', 'kuaishouNoAutoplayEnabled', 'kuaishouPopupEnabled'
].sort());

// 读取优先级：新位置 > 旧键 > 默认开
ok('新位置优先（false 生效）',
  flags.isEnabled('douyinModal', { config: { features: { douyinModal: false } }, douyinModalEnabled: true }) === false);
ok('新位置优先（true 生效）',
  flags.isEnabled('douyinModal', { config: { features: { douyinModal: true } }, douyinModalEnabled: false }) === true);
ok('旧键回退（老用户升级不丢设置）',
  flags.isEnabled('douyinModal', { config: {}, douyinModalEnabled: false }) === false);
ok('都没设过 → 开',
  flags.isEnabled('douyinModal', { config: {} }) === true);
ok('旧键 true + 新位置缺 → 开',
  flags.isEnabled('kuaishouPopup', { config: {}, kuaishouPopupEnabled: true }) === true);
ok('未知 key 一律当开', flags.isEnabled('notExist', {}) === true);

// 归属：设置页靠这个把开关挂到对应站
eq('抖音挂 2 条', flags.forDomain('www.douyin.com').map((f) => f.key), ['douyinModal', 'douyinImmersive']);
eq('快手挂 3 条', flags.forDomain('www.kuaishou.com').map((f) => f.key),
  ['kuaishouImmersive', 'kuaishouPopup', 'kuaishouNoAutoplay']);
eq('X 挂 1 条', flags.forDomain('x.com').map((f) => f.key), ['xFeedButtons']);
eq('TikTok 没有专属开关', flags.forDomain('www.tiktok.com').length, 0);
eq('无旧键的三个新功能不写旧键',
  flags.FEATURES.filter((f) => !f.legacyKey).map((f) => f.key),
  ['xFeedButtons', 'weiboFeedButtons', 'igFeedButtons']);

// ============ 二、把真设置页放进 jsdom ============

const htmlRaw = fs.readFileSync(path.join(OPTIONS_DIR, 'options.html'), 'utf8');
const bodyHtml = htmlRaw
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^[\s\S]*?<body>/, '')
  .replace(/<\/body>[\s\S]*$/, '');

function makeConfig() {
  // v2.8.2：与 background 的默认配置保持同一形状（三个死字段已删）
  return {
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
}

function boot() {
  const dom = new JSDOM('<!DOCTYPE html><html><body>' + bodyHtml + '</body></html>', {
    url: 'chrome-extension://abc/src/options/options.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const win = dom.window;

  const state = {
    config: makeConfig(),
    douyinModalEnabled: true,
    douyinImmersiveEnabled: true,
    kuaishouImmersiveEnabled: true,
    kuaishouPopupEnabled: true,
    kuaishouNoAutoplayEnabled: true
  };
  const sent = [];
  // 假缓存键：跟真实现一样，一项一个键（media_extractor_pcache:<key>）
  let cacheKeys = ['media_extractor_pcache:a', 'media_extractor_pcache:b', 'media_extractor_pcache:c'];

  win.chrome = {
    runtime: {
      getManifest: () => ({ version: '2.8.5' }),
      sendMessage: (msg) => {
        sent.push(JSON.parse(JSON.stringify(msg)));
        if (msg.action === 'getConfig') return Promise.resolve({ config: JSON.parse(JSON.stringify(state.config)) });
        if (msg.action === 'saveConfig') {
          const next = Object.assign({}, state.config, msg.config || {});
          if (msg.config && msg.config.settings) {
            next.settings = Object.assign({}, state.config.settings, msg.config.settings);
          }
          state.config = next;
          Object.keys(msg.extras || {}).forEach((k) => { state[k] = msg.extras[k]; });
          return Promise.resolve({ success: true });
        }
        if (msg.action === 'getCacheStats') {
          return Promise.resolve({ stats: { entries: cacheKeys.length, bytes: cacheKeys.length * 682 } });
        }
        if (msg.action === 'clearCacheOnly') {
          const n = cacheKeys.length;
          cacheKeys = [];
          return Promise.resolve({ success: true, result: { removed: n, bytes: n * 682 } });
        }
        if (msg.action === 'resetFeatures') {
          state.config.features = {};
          (msg.legacyKeys || []).forEach((k) => { delete state[k]; });
          return Promise.resolve({ success: true, result: { removedKeys: (msg.legacyKeys || []).length } });
        }
        return Promise.resolve({});
      }
    },
    storage: {
      local: {
        get: (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(state, k)) out[k] = state[k];
          });
          return Promise.resolve(out);
        },
        set: () => Promise.resolve(),
        remove: (keys) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete state[k]; });
          return Promise.resolve();
        },
        getBytesInUse: () => Promise.resolve(0)
      },
      onChanged: { addListener: () => {} }
    }
  };

  win.matchMedia = win.matchMedia || (() => ({ matches: false, addListener: () => {}, removeListener: () => {} }));
  win.confirm = () => true;

  ['shared/site-config.js', 'shared/settings-schema.js', 'shared/feature-flags.js',
    'shared/config/media-types.js', 'options/options.js']
    .forEach((rel) => {
      win.eval(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    });

  return { win, state, sent, cache: () => cacheKeys.slice() };
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 30));

async function main() {
  const { win, state, sent, cache } = boot();
  await tick(60);

  const doc = win.document;
  const page = win.page;

  console.log('\n【三】设置页渲染');

  ok('页面实例已创建', !!page);
  // v2.9.6：autoDismiss 转为站点级（siteOnly），通用页少一行
  eq('通用页渲染 10 项', doc.querySelectorAll('#generalGroups .row').length, 10);
  eq('站点页渲染 23 个站', doc.querySelectorAll('.site').length, 23);
  eq('关于页站点数', doc.getElementById('aboutSiteCount').textContent, '23 个');
  eq('版本号显示', doc.getElementById('brandVersion').textContent, 'v2.8.5');

  // 站点专属开关只挂在对应站上
  const douyin = doc.querySelector('.site[data-domain="www.douyin.com"]');
  const tiktok = doc.querySelector('.site[data-domain="www.tiktok.com"]');
  const kuaishou = doc.querySelector('.site[data-domain="www.kuaishou.com"]');
  ok('抖音行存在', !!douyin);
  eq('抖音卡里 2 个专属开关', douyin.querySelectorAll('.feature-block .sw').length, 2);
  eq('快手卡里 3 个专属开关', kuaishou.querySelectorAll('.feature-block .sw').length, 3);
  eq('TikTok 没有专属开关块', tiktok.querySelectorAll('.feature-block').length, 0);
  eq('抖音卡里 6 个通用设置项', douyin.querySelectorAll('.site-body .row').length, 2 + 6);

  // ============ 四、写盘形状 ============

  console.log('\n【四】写盘形状');

  // 4.1 通用开关：只写一个顶层键
  doc.querySelector('#generalGroups .row[data-key="autoExtract"] .sw').click();
  await tick(30);
  const last1 = sent[sent.length - 1];
  eq('通用开关发送 saveConfig', last1.action, 'saveConfig');
  eq('通用开关只改 autoExtract', last1.config, { autoExtract: true });
  ok('本地 config 同步', state.config.autoExtract === true);

  // 4.2 功能开关：config.features + 旧键双写
  douyin.querySelector('.site-head').click();
  await tick(20);
  const featSw = douyin.querySelectorAll('.feature-block .sw')[0]; // douyinModal
  featSw.click();
  await tick(30);
  const last2 = sent[sent.length - 1];
  eq('功能开关写 config.features', last2.config.features.douyinModal, false);
  eq('功能开关同时写旧键（抖音/快手内容脚本还在读它）', last2.extras, { douyinModalEnabled: false });
  ok('旧键在存储里真的变了', state.douyinModalEnabled === false);

  // 4.3 站点开关：以生效值做快照，只改一项
  // 注意：4.1 已经把全局 autoExtract 打开了，此时豆瓣站的生效值也是 true，
  // 所以这里挑 showButton（true → false）来验证「只翻转这一项、其余照原样落进快照」。
  const douban = doc.querySelector('.site[data-domain="movie.douban.com"]');
  douban.querySelector('.site-head').click();
  await tick(20);
  const siteSw = douban.querySelector('.site-body .row[data-key="showButton"] .sw');
  ok('找到豆瓣的按钮开关', !!siteSw);
  siteSw.click();
  await tick(30);
  const last3 = sent[sent.length - 1];
  const ov = last3.config.siteOverrides['movie.douban.com'];
  eq('站点快照带上其余五项', ov,
    { autoExtract: true, autoExtractDelay: 3, autoCopy: false, showButton: false, autoDismiss: false });
  ok('站点覆盖里没有多余的 autoCopyFormat 键',
    !Object.prototype.hasOwnProperty.call(ov, 'autoCopyFormat'));
  ok('站点行变成「已自定义」', !!doc.querySelector('.site[data-domain="movie.douban.com"].is-own'));
  ok('计数显示已单独设置 1 个',
    doc.getElementById('siteCount').textContent.indexOf('已单独设置 1 个') !== -1,
    doc.getElementById('siteCount').textContent);

  // 4.4 恢复跟随通用：删掉本站那条
  const resetBtn = doc.querySelector('.site[data-domain="movie.douban.com"] .site-actions .link-btn');
  resetBtn.click();
  await tick(30);
  const last4 = sent[sent.length - 1];
  ok('恢复后该站规则被删除',
    !Object.prototype.hasOwnProperty.call(last4.config.siteOverrides, 'movie.douban.com'),
    JSON.stringify(last4.config.siteOverrides));

  // ============ 五、撤销 ============

  console.log('\n【五】撤销');

  // 上一步刚做过一次保存，撤销应回到「有本站规则」的状态
  doc.getElementById('undoBtn').click();
  await tick(40);
  const last5 = sent[sent.length - 1];
  ok('撤销写回旧 siteOverrides',
    !!last5.config.siteOverrides['movie.douban.com'],
    JSON.stringify(last5.config.siteOverrides));

  // ============ 六、搜索 / 深链 ============

  console.log('\n【六】搜索与深链');

  const search = doc.getElementById('siteSearch');
  search.value = 'douban';
  search.dispatchEvent(new win.Event('input'));
  await tick(20);
  eq('搜 douban 命中 3 个站', doc.querySelectorAll('.site').length, 3);

  search.value = 'bgm.tv';
  search.dispatchEvent(new win.Event('input'));
  await tick(20);
  eq('搜域名别名也能命中（bgm.tv → Bangumi）', doc.querySelectorAll('.site').length, 1);

  search.value = '';
  search.dispatchEvent(new win.Event('input'));
  await tick(20);

  win.location.hash = '#sites?focus=www.kuaishou.com';
  win.dispatchEvent(new win.Event('hashchange'));
  await tick(40);
  ok('深链自动展开目标站', !!doc.querySelector('.site[data-domain="www.kuaishou.com"].is-open'));
  ok('深链切到网站页签', doc.getElementById('tab-sites').hidden === false);

  // ============ 七、字段页 ============

  console.log('\n【七】字段页');

  const groups = doc.querySelectorAll('.field-group');
  eq('字段页 5 个类型', groups.length, 5);
  eq('类型顺序固定', [].map.call(groups, (g) => g.dataset.fieldKey),
    ['media', 'book', 'game', 'social', 'person']);
  eq('社交媒体 7 个字段',
    doc.querySelectorAll('.field-group[data-field-key="social"] .field-row').length, 7);
  eq('社交第一个字段是「本页标题」',
    doc.querySelector('.field-group[data-field-key="social"] .field-row .field-name').textContent, '本页标题');
  ok('没调过时不显示「已调整」',
    !doc.querySelector('.field-group[data-field-key="social"] .badge'));

  // 先塞一份别的类型的历史顺序，验证「改 A 类型不冲掉 B 类型」
  state.config.fieldOrder = { book: ['作者', '书名'] };
  page.config.fieldOrder = { book: ['作者', '书名'] };
  page.renderFields();

  const socialRows = doc.querySelectorAll('.field-group[data-field-key="social"] .field-row');
  socialRows[0].querySelectorAll('.move-btn')[1].click();   // 第 1 个下移
  await tick(40);

  const moved = sent[sent.length - 1];
  eq('挪一下发 saveConfig', moved.action, 'saveConfig');
  eq('作者ID 抢到第一',
    moved.config.fieldOrder.social.slice(0, 3), ['作者ID', '本页标题', '作者昵称']);
  eq('长度不变（是挪，不是删）', moved.config.fieldOrder.social.length, 7);
  eq('不动别的类型（book 原样带回）', moved.config.fieldOrder.book, ['作者', '书名']);
  ok('改过的类型显示「已调整」',
    !!doc.querySelector('.field-group[data-field-key="social"] .badge.own'));
  ok('第一个字段的「上移」已禁用',
    doc.querySelector('.field-group[data-field-key="social"] .field-row .move-btn').disabled === true);
  const lastRowBtns = doc.querySelectorAll('.field-group[data-field-key="social"] .field-row');
  ok('最后一个字段的「下移」已禁用',
    lastRowBtns[lastRowBtns.length - 1].querySelectorAll('.move-btn')[1].disabled === true);

  // 新加的字段要排在末尾，失效的旧字段要丢掉（否则保存一次就把以后的字段挤没了）
  state.config.fieldOrder = { social: ['作者ID', '这个字段已经不存在了'] };
  page.config.fieldOrder = { social: ['作者ID', '这个字段已经不存在了'] };
  page.renderFields();
  eq('存过的顺序优先、其余按默认补齐',
    [].map.call(doc.querySelectorAll('.field-group[data-field-key="social"] .field-row .field-name'),
      (n) => n.textContent),
    ['作者ID', '本页标题', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL']);
  eq('失效的旧字段被丢掉（不算进数量）',
    doc.querySelector('.field-group[data-field-key="social"] .field-count').textContent, '7 个');

  // 恢复默认：只删这一类型
  doc.querySelector('.field-group[data-field-key="social"] .field-actions .link-btn').click();
  await tick(40);
  const rs = sent[sent.length - 1];
  ok('恢复默认删掉该类型顺序',
    !Object.prototype.hasOwnProperty.call(rs.config.fieldOrder, 'social'),
    JSON.stringify(rs.config.fieldOrder));

  // ============ 八、数据页 ============

  console.log('\n【八】数据页');

  await tick(20);
  eq('缓存显示条数与大小', doc.getElementById('cacheInfo').textContent, '3 条 · 2.0 KB');
  eq('重置档位 3 个（缓存单独在卡片里）',
    doc.querySelectorAll('#resetList [data-reset]').length, 3);

  const payload = page.buildExportPayload();
  eq('导出标明是设置文件', payload.kind, 'settings');
  eq('导出带扩展版本', payload.version, '2.8.5');
  ok('导出内容含 config', !!payload.config);
  ok('导出不含缓存 / 提取历史（都是机器生成的）',
    !Object.prototype.hasOwnProperty.call(payload, 'extractedData') &&
    !Object.prototype.hasOwnProperty.call(payload, 'cache'));

  eq('空对象拒绝导入', page.validateImport({}).ok, false);
  eq('字符串拒绝导入', page.validateImport('abc').ok, false);
  eq('没有可识别项的拒绝', page.validateImport({ config: { foo: 1 } }).ok, false);
  const v1 = page.validateImport({
    app: 'clipmate', kind: 'settings', version: '2.8.5',
    config: { siteOverrides: { 'x.com': { showButton: false } }, features: { douyinModal: false } }
  });
  eq('认出本页导出的文件', v1.ok, true);
  const sum1 = page.summarizeImport(v1.config);
  ok('摘要里有站点数', sum1.indexOf('1 个站点设置') !== -1, sum1);
  ok('摘要里有开关数', sum1.indexOf('1 个功能开关') !== -1, sum1);
  eq('裸 config 也认', page.validateImport({ autoExtract: true, showButton: false }).ok, true);

  // 清缓存：只发 clearCacheOnly，绝不能顺手把设置写一遍
  const beforeConfig = JSON.stringify(state.config);
  sent.length = 0;
  doc.getElementById('clearCacheBtn').click();
  await tick(80);
  ok('清缓存走 clearCacheOnly', sent.some((m) => m.action === 'clearCacheOnly'));
  ok('清缓存不发 saveConfig', !sent.some((m) => m.action === 'saveConfig'));
  eq('清缓存后设置一个字都没变', JSON.stringify(state.config), beforeConfig);
  eq('缓存键真的被删', cache().length, 0);
  await tick(40);
  eq('清完自动刷新成「没有缓存」', doc.getElementById('cacheInfo').textContent, '没有缓存');

  // 重置：三档各清各的
  sent.length = 0;
  doc.querySelector('[data-reset="sites"] .btn').click();
  await tick(40);
  eq('重置网站设置只写 siteOverrides', sent[sent.length - 1].config, { siteOverrides: {} });

  sent.length = 0;
  doc.querySelector('[data-reset="fields"] .btn').click();
  await tick(40);
  eq('重置字段顺序只写 fieldOrder', sent[sent.length - 1].config, { fieldOrder: {} });

  state.config.features = { douyinModal: false };
  state.douyinModalEnabled = false;
  sent.length = 0;
  doc.querySelector('[data-reset="features"] .btn').click();
  await tick(80);
  const rf = sent.filter((m) => m.action === 'resetFeatures')[0];
  ok('重置功能开关发 resetFeatures', !!rf);
  eq('带上全部 5 个旧键', rf.legacyKeys.length, 5);
  ok('旧键真被删掉（回到「缺省 = 开」）', state.douyinModalEnabled === undefined);
  eq('config.features 清空', Object.keys(state.config.features).length, 0);

  // 导入真的写盘
  sent.length = 0;
  await page.applyImport({ siteOverrides: { 'y.com': { showButton: false } }, features: { xFeedButtons: false } },
    '1 个站点设置');
  await tick(60);
  const imp = sent.filter((m) => m.action === 'saveConfig' && m.config && m.config.siteOverrides)[0];
  ok('导入把设置写进 saveConfig', !!imp && !!imp.config.siteOverrides['y.com']);
  ok('导入后本地状态同步', !!page.config.siteOverrides['y.com']);


  // ============ 九、简介长度与主题（v2.8.2） ============

  console.log('\n【九】简介长度与主题');

  const numOf = (k) => doc.querySelector('#generalGroups .row[data-key="' + k + '"] .num');

  eq('通用页分 5 组', doc.querySelectorAll('#generalGroups .group').length, 5);
  eq('简介长度渲染出 3 个数字输入', doc.querySelectorAll('#generalGroups .num').length, 3);
  ok('社交简介输入框存在', !!numOf('descSocial'));
  eq('社交简介初值 50000', numOf('descSocial') && numOf('descSocial').value, '50000');
  eq('影人简介初值 5000', numOf('descPerson').value, '5000');
  eq('其他简介初值 500', numOf('descOther').value, '500');
  eq('带单位「字」',
    doc.querySelector('#generalGroups .row[data-key="descSocial"] .num-unit').textContent, '字');

  // 写盘：三层嵌套只改一项，两层兄弟键都得原样带上
  sent.length = 0;
  numOf('descSocial').value = '12000';
  numOf('descSocial').dispatchEvent(new win.Event('change'));
  await tick(40);
  const np = sent[sent.length - 1];
  eq('改社交简介发 saveConfig', np.action, 'saveConfig');
  eq('三层嵌套的写盘形状', np.config,
    { settings: { enableCache: true, descLimits: { social: 12000, person: 5000, other: 500 } } });
  ok('本地 config 同步', page.config.settings.descLimits.social === 12000);

  // 0 = 不限制（提示语里向用户承诺过）
  sent.length = 0;
  numOf('descOther').value = '0';
  numOf('descOther').dispatchEvent(new win.Event('change'));
  await tick(40);
  eq('其他简介存成 0', sent[sent.length - 1].config.settings.descLimits.other, 0);
  ok('提示语说「不限制」', doc.getElementById('saveText').textContent.indexOf('不限制') !== -1,
    doc.getElementById('saveText').textContent);

  // 非数字：不写盘，回填原值（别把 NaN 存进 config）
  sent.length = 0;
  numOf('descPerson').value = 'abc';
  numOf('descPerson').dispatchEvent(new win.Event('change'));
  await tick(30);
  eq('非数字不写盘', sent.filter((m) => m.action === 'saveConfig').length, 0);
  eq('非数字回填原值', numOf('descPerson').value, '5000');

  // 越界：收敛到上限并回写输入框
  sent.length = 0;
  numOf('descPerson').value = '999999';
  numOf('descPerson').dispatchEvent(new win.Event('change'));
  await tick(40);
  eq('超上限收敛到 200000', sent[sent.length - 1].config.settings.descLimits.person, 200000);
  eq('输入框显示收敛后的值', numOf('descPerson').value, '200000');

  // 主题：只写 theme 一个键，且设置页立刻换色
  const themeSel = doc.querySelector('#generalGroups .row[data-key="theme"] select');
  ok('主题渲染成下拉', !!themeSel);
  eq('主题当前值跟随系统', themeSel && themeSel.value, 'system');
  sent.length = 0;
  themeSel.value = 'dark';
  themeSel.dispatchEvent(new win.Event('change'));
  await tick(40);
  eq('改主题只写 theme 一个键', sent[sent.length - 1].config, { theme: 'dark' });
  eq('设置页立刻变深色', doc.documentElement.getAttribute('data-theme'), 'dark');

  themeSel.value = 'light';
  themeSel.dispatchEvent(new win.Event('change'));
  await tick(40);
  eq('切回浅色', doc.documentElement.getAttribute('data-theme'), 'light');

  console.log('\n' + '─'.repeat(56));
  if (fails.length) {
    console.log('❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项');
    fails.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  } else {
    console.log('✅ 全部通过：' + pass + ' 项');
  }
}

main().catch((e) => {
  console.error('测试自身崩了：', e && e.stack || e);
  process.exitCode = 1;
});
