/**
 * 后台「数据」相关逻辑（v2.8.1）
 *
 * 为什么单独写：设置页那两个按钮走的是后台，而设置页的 jsdom 测试里后台是**假**的
 * （只记录发了什么消息），真后台一行没跑过。这里把 background.js 真的 require 进来，
 * 用内存假存储跑它的清理逻辑，钉住三件最容易出事、且用户无法自行发现的事：
 *
 *   1) 「清缓存」只删缓存键 —— 绝不能顺手把 config 删掉（老 clearCache 就是连 config 一起删，
 *      所以 popup 的「恢复默认」一按全没了）。这个错误在界面上看不出来：
 *      缓存确实清干净了，设置也悄悄没了。
 *   2) 缓存键是**分片**的（media_extractor_pcache:<key>，v2.5.50 起）。
 *      只删 media_extractor_persistent_cache 那个旧单键 = 什么都没清。
 *   3) 「重置功能开关」要连旧独立键一起删（删，不是写 true），否则下次改默认值不跟着走。
 *
 * 跑法：node tests/data-page-background.test.js
 */

'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', 'ClipMate_chrome', 'src');
const BG_PATH = path.join(ROOT, 'background', 'background.js');

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; }
  else {
    fails.push(name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
    console.log('  ❌ ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
  }
}
function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

// ============ 内存版 chrome.* ============

const store = {
  config: {
    autoExtract: true,
    showButton: false,
    siteOverrides: { 'movie.douban.com': { showButton: false } },
    features: { douyinModal: false, xFeedButtons: false },
    fieldOrder: { social: ['URL', '本页标题'] },
    settings: { enableCache: true }
  },
  'media_extractor_pcache:abc': { data: 'x'.repeat(200) },
  'media_extractor_pcache:def': { data: 'y'.repeat(200) },
  media_extractor_persistent_cache: { legacy: true },
  cache: { junk: true },
  douyinModalEnabled: false,
  kuaishouPopupEnabled: true
};

const sentToTabs = [];
let bytesAsked = null;

global.chrome = {
  runtime: {
    onInstalled: { addListener: () => {} },
    onMessage: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    getManifest: () => ({ version: '2.8.5' })
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    query: () => Promise.resolve([{ id: 11 }, { id: 22 }]),
    sendMessage: (tabId, msg) => { sentToTabs.push({ tabId, msg }); return Promise.resolve({}); }
  },
  storage: {
    local: {
      get: (keys) => {
        if (keys === null || keys === undefined) return Promise.resolve(Object.assign({}, store));
        const out = {};
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
          if (Object.prototype.hasOwnProperty.call(store, k)) out[k] = store[k];
        });
        return Promise.resolve(out);
      },
      set: (obj) => { Object.assign(store, obj); return Promise.resolve(); },
      remove: (keys) => {
        (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete store[k]; });
        return Promise.resolve();
      },
      getBytesInUse: (keys) => {
        bytesAsked = Array.isArray(keys) ? keys.slice() : keys;
        return Promise.resolve(1234);
      }
    },
    onChanged: { addListener: () => {} }
  }
};

// background.js 末尾会 new BackgroundService()，构造函数里立刻注册监听 + 跑 initStorage
const BackgroundService = require(BG_PATH);
const bg = BackgroundService.instance || new BackgroundService();

const tick = (ms) => new Promise((r) => setTimeout(r, ms || 20));

(async function main() {
  await tick(40);

  console.log('\n【一】getCacheStats');
  const stats = await bg.getCacheStats();
  eq('数出 4 个缓存键（2 个分片 + 旧单键 + 更早的 cache）', stats.entries, 4);
  eq('占用大小取自 getBytesInUse', stats.bytes, 1234);
  eq('只问了缓存键的大小', bytesAsked, [
    'media_extractor_pcache:abc', 'media_extractor_pcache:def',
    'media_extractor_persistent_cache', 'cache'
  ]);
  ok('config 还在', !!store.config);

  console.log('\n【二】clearCacheOnly（设置必须一个不少）');
  const configBefore = JSON.stringify(store.config);
  const r = await bg.clearCacheOnly();

  eq('返回删掉的条数', r.removed, 4);
  ok('分片键 abc 被删', store['media_extractor_pcache:abc'] === undefined);
  ok('分片键 def 被删', store['media_extractor_pcache:def'] === undefined);
  ok('旧单键被删', store.media_extractor_persistent_cache === undefined);
  ok('更早的 cache 键被删', store.cache === undefined);

  eq('config 一个字都没变（这是「只清缓存」的全部意义）',
    JSON.stringify(store.config), configBefore);
  ok('站点设置在', !!store.config.siteOverrides['movie.douban.com']);
  ok('功能开关在', store.config.features.douyinModal === false);
  ok('字段顺序在', JSON.stringify(store.config.fieldOrder) === JSON.stringify({ social: ['URL', '本页标题'] }));

  const broadcast = sentToTabs.filter((x) => x.msg && x.msg.action === 'clearCache');
  eq('通知了 2 个标签清内存缓存（只删存储不清内存 = 当前页面照样命中旧结果）',
    broadcast.map((x) => x.tabId), [11, 22]);

  const afterStats = await bg.getCacheStats();
  eq('清完再数一遍是 0', afterStats.entries, 0);

  console.log('\n【三】resetFeatures（连旧独立键一起删）');
  eq('重置前 features 有 2 项', Object.keys(store.config.features).length, 2);
  ok('重置前旧键存在', store.douyinModalEnabled === false);

  const rf = await bg.resetFeatures(['douyinModalEnabled', 'kuaishouPopupEnabled']);
  eq('删掉 2 个旧键', rf.removedKeys, 2);
  eq('config.features 清空', store.config.features, {});
  ok('旧键 douyinModalEnabled 被删（删掉 = 回到「缺省开」，而不是写死 true）',
    store.douyinModalEnabled === undefined);
  ok('旧键 kuaishouPopupEnabled 被删', store.kuaishouPopupEnabled === undefined);
  ok('其他设置不受影响：站点设置还在', !!store.config.siteOverrides['movie.douban.com']);
  ok('其他设置不受影响：字段顺序还在',
    JSON.stringify(store.config.fieldOrder) === JSON.stringify({ social: ['URL', '本页标题'] }));

  console.log('\n【四】脏参数不炸');
  const rf2 = await bg.resetFeatures(null);
  eq('legacyKeys 传 null 不炸，返回 0', rf2.removedKeys, 0);
  const rf3 = await bg.resetFeatures(['', null, 42, 'okKey']);
  eq('只有合法字符串键会被算进删除数', rf3.removedKeys, 1);

  console.log('\n【五】initStorage 不再写死键 extractedData');
  ok('安装初始化没再写 extractedData',
    !Object.prototype.hasOwnProperty.call(store, 'extractedData'),
    Object.keys(store));

  console.log('\n' + '─'.repeat(56));
  if (fails.length) {
    console.log('❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项');
    fails.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  } else {
    console.log('✅ 全部通过：' + pass + ' 项');
  }
})().catch((e) => {
  console.error('测试自身崩了：', (e && e.stack) || e);
  process.exitCode = 1;
});
