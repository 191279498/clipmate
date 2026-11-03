#!/usr/bin/env node
/**
 * 抖音「弹窗按钮 + 跟随」验收（v2.5.77 批 3）
 *
 * 批 3 让功能闭环：弹窗开 → 按钮浮在弹窗右上角；弹窗关 → 按钮撤、浮窗一起关；
 * 切下一条 → 按钮不动、浮窗就地刷新。这个脚本逐条钉住，共九节：
 *
 *   一、3 个弹窗入口都能接管，按钮贴弹窗右上角（内缩 16px）
 *   二、点按钮出浮窗，7 个字段对（真值来自批 2 的真机存档）
 *   三、关弹窗 → 按钮撤 + 已开的浮窗一起关（用户定的第 4 条）
 *   四、弹窗里切下一条 → 按钮不动 + 浮窗就地刷新（不重建窗口）
 *   五、选项页开关关掉 → 行为完全等于批 1（脚本在场、不出按钮、不接管）
 *   六、熔断后不接管（连续取不到内容时的退路）
 *   七、域名门禁：非抖音页面一个监听都不多挂
 *   八、锚点夹取 + 用户拖动后不抢位置
 *   九、红线：详情页 /video/ 行为不变（不贴锚点、缓存键不带作品维度）
 *
 * 用法：
 *   node tests/douyin-modal-handler.test.js
 *   node tests/douyin-modal-handler.test.js --verbose
 *
 * 只读产品源码与存档，不写任何东西。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const env = require('./lib/env');
const H = require('./lib/harness');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const VERBOSE = process.argv.includes('--verbose');

// v2.6.1：文案出口统一去话题井号，端到端期望值要按清理后的样子算。
// 直接复用产品代码（而不是在测试里手写一份正则），保证「期望」与「实际」同源同规则。
const SocialHashtagCleaner = require(path.resolve(__dirname, '..', 'ClipMate_chrome/src/content/utils/social-hashtag-cleaner.js'));

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, `${JSON.stringify(actual)}`);
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function neq(name, actual, unexpected) {
  if (actual !== unexpected) ok(name, `${JSON.stringify(actual)}`);
  else bad(name, `不应等于 ${JSON.stringify(unexpected)}`);
}
function truthy(name, actual) {
  if (actual) ok(name);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual) {
  if (!actual) ok(name);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

/* ------------------------------ 存档与页面 ------------------------------ */

function loadFixtures() {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'registry.json'), 'utf8')).fixtures || [];
}
function fixtureById(id) {
  const f = loadFixtures().find((x) => x.id === id);
  if (!f) throw new Error('存档缺失：' + id);
  return f;
}
function htmlOf(id) {
  return fs.readFileSync(path.join(FIXTURES_DIR, fixtureById(id).file), 'utf8');
}

async function open(fixture, extra = {}) {
  const page = await H.openPage({
    url: fixture.url,
    html: htmlOf(fixture.id),
    mediaConfigs: extra.mediaConfigs,
    chromePatch: extra.chromePatch
  });
  const inst = await H.waitForInit(page, extra.timeout || 8000);
  return { page, inst, w: page.window, d: page.window.document };
}

const DOUYIN_MODALS = [
  {
    id: 'douyin-modal-search-video-7672265848853220618',
    label: '搜索页弹窗',
    awemeId: '7672265848853220618',
    desc: '980秒静静欣赏美食，鸡腿拉面、巴西烤肉 #街头美食 #路边摊美味',
    nick: '杰诺探美食',
    date: '2026/08/11'
  },
  {
    id: 'douyin-modal-jingxuan-note-7516480886684568891',
    label: '精选页图文弹窗',
    awemeId: '7516480886684568891',
    desc: '6月16日-6月30日，「送TA上精选」把选择权交给你，快来为你支持的创作者投票吧！#送TA上精选 #抖音精选',
    nick: '抖音作者助手',
    date: '2025/06/16'
  },
  {
    id: 'douyin-modal-user-video-7496043889296559386',
    label: '用户主页弹窗',
    awemeId: '7496043889296559386',
    desc: '精选开放麦第三期上线啦！一起看五位“航海家”@Olga姐姐 @李娃娃 @造梦小懿 @米雪食记 @米雷-RayDog 如何寻找人生“新大陆”！#抖音精选 #精选开放麦',
    nick: '抖音作者助手',
    date: '2025/04/22'
  }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ 一、接管与定位 ============================ */

async function testTakeover(mediaConfigs) {
  section('一、3 个弹窗入口：接管 + 按钮贴弹窗右上角');

  for (const t of DOUYIN_MODALS) {
    const fx = fixtureById(t.id);
    const { page, inst, d, w } = await open(fx, { mediaConfigs });
    const tag = `[${t.label}]`;

    // jsdom 没有布局：offsetWidth=0、getBoundingClientRect 全 0 → 走「视口 + 兜底宽度」分支
    const vw = w.innerWidth;
    const expectedLeft = vw - 120 - 16; // 兜底按钮宽 120 + 内缩 16
    const btns = d.querySelectorAll('.media-extractor-button');

    eq(`${tag} 按钮恰好 1 个`, btns.length, 1);
    truthy(`${tag} 已接管页面（isInitialized）`, inst && inst.isInitialized);
    eq(`${tag} 认出了当前作品 ID`, inst && inst._douyinModalId, t.awemeId);
    eq(`${tag} 缓存键按作品维度`, inst && inst.cacheKey, `www.douyin.com/p/${t.awemeId}`);
    eq(`${tag} 类型补认成 social`, inst && inst.detectMediaType(), 'social');
    eq(`${tag} 字段映射器是 social`, inst && inst.fieldMapper && inst.fieldMapper.mediaType, 'social');

    if (btns.length) {
      const b = btns[0];
      eq(`${tag} 按钮打了弹窗锚点标记`, b.getAttribute('data-clipmate-anchor'), 'douyin-modal');
      eq(`${tag} 贴在右上角（left）`, b.style.left, expectedLeft + 'px');
      eq(`${tag} 贴在右上角（top=内缩 16px）`, b.style.top, '16px');
      eq(`${tag} 清掉了 CSS 的 right 定位`, b.style.right, 'auto');
      eq(`${tag} 清掉了 CSS 的 bottom 定位`, b.style.bottom, 'auto');
      falsy(`${tag} 按钮可点（没 disabled）`, b.disabled);
      falsy(`${tag} 按钮已脱离 pending 灰态`, b.classList.contains('pending'));
    }

    page.dom.window.close();
  }
}

/* ============================ 二、点按钮出浮窗 ============================ */

async function testExtractOpensPanel(mediaConfigs) {
  section('二、点按钮 → 浮窗打开，7 个字段对');

  for (const t of DOUYIN_MODALS) {
    const fx = fixtureById(t.id);
    const { page, inst, w } = await open(fx, { mediaConfigs });
    const tag = `[${t.label}]`;

    await inst.handleExtract();

    eq(`${tag} 浮窗已打开`, inst.modalManager && inst.modalManager.isOpen, true);
    const fw = inst.modalManager && inst.modalManager.floatingWindow;
    truthy(`${tag} 浮窗对象存在`, !!fw);
    const content = fw && fw.getContentElement ? fw.getContentElement() : null;
    truthy(`${tag} 表格已渲染`, content && content.querySelectorAll('tr').length > 0);

    const data = inst.modalManager.data || (fw && fw.data) || {};
    const field = (k) => String(data[k] == null ? '' : data[k]).trim();

    eq(`${tag} 作者昵称`, field('作者昵称'), t.nick);
    // v2.6.1：文案出口统一去掉话题井号（用户 2026-10-29 要求，所有社交站生效），
    // 所以这里不能直接比原文 desc，要跟清理后的结果比。
    eq(`${tag} 本页文案`, field('本页文案'), SocialHashtagCleaner.strip(t.desc));
    truthy(`${tag} 发布日期以 ${t.date} 开头`, field('发布日期').indexOf(t.date) === 0);
    neq(`${tag} 日期不是页面配置里的假日期 2023/06/07`, field('发布日期'), '2023/06/07');
    truthy(`${tag} URL 是规范地址（含作品 ID）`, field('URL').indexOf('douyin.com/') > 0 && field('URL').indexOf(t.awemeId) > 0);
    truthy(`${tag} 作者主页指向本条作者`, field('作者主页').indexOf('/user/') > 0);
    // 7 个字段全部在（作者ID 要走网络抓作者主页，离线恒空，不算缺）
    ['本页标题', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'].forEach((k) => {
      truthy(`${tag} 字段「${k}」非空`, field(k) !== '');
    });

    w.close();
  }
}

/* ========================== 三、关弹窗一起关浮窗 ========================== */

async function testCloseModal(mediaConfigs) {
  section('三、关弹窗 → 按钮撤 + 已开的浮窗一起关');

  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, w, d } = await open(fx, { mediaConfigs });

  await inst.handleExtract();
  eq('[关弹窗·前置] 浮窗已打开', inst.modalManager.isOpen, true);

  // 模拟真实关闭：抖音同时做两件事 —— 地址栏的 modal_id 消失、弹层节点被卸载
  w.history.replaceState({}, '', 'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F');
  d.querySelectorAll('[data-e2e="modal-video-container"]').forEach((el) => el.remove());
  d.body.appendChild(d.createElement('span')); // 触发 MutationObserver
  await sleep(900);

  eq('按钮已撤下', d.querySelectorAll('.media-extractor-button').length, 0);
  eq('浮窗一起关掉（用户定的第 4 条）', inst.modalManager.isOpen, false);
  eq('当前作品 ID 已清空', inst._douyinModalId, '');
  eq('作用域已清空', inst.activeShortcode, null);
  eq('缓存键恢复成页面维度（不再按作品）', inst.cacheKey.indexOf('/p/'), -1);
  eq('缓存键就是当前页面', inst.cacheKey, 'www.douyin.com/search/%E7%BE%8E%E9%A3%9F'); // pathname 保留百分号编码

  w.close();
}

/* ============================ 四、切下一条 ============================ */

async function testSwitchNext(mediaConfigs) {
  section('四、弹窗里切下一条 → 按钮不动 + 浮窗就地刷新');

  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, w, d } = await open(fx, { mediaConfigs });
  const OLD = '7672265848853220618';
  const NEW = '7000000000000000001';

  await inst.handleExtract();
  eq('[切条·前置] 浮窗已打开', inst.modalManager.isOpen, true);

  // 记录就地刷新次数（不改变行为，只观测）
  const calls = [];
  const origUpdate = inst.modalManager.updateInPlace.bind(inst.modalManager);
  inst.modalManager.updateInPlace = async (data) => { calls.push(data); return origUpdate(data); };
  const fwBefore = inst.modalManager.floatingWindow;

  // 模拟真实切条：URL 换 ID + 本条节点换 ID/昵称/文案（抖音是原地换内容，不换窗口）
  w.history.replaceState({}, '', 'https://www.douyin.com/search/x?modal_id=' + NEW);
  const info = d.querySelector(`[data-e2e="video-info"][data-e2e-aweme-id="${OLD}"]`);
  truthy('[切条·前置] 找到本条信息节点', !!info);
  info.setAttribute('data-e2e-aweme-id', NEW);
  const nickEl = info.querySelector('[data-e2e="feed-video-nickname"]');
  if (nickEl) nickEl.textContent = '新作者';
  const scope = info.closest('[data-e2e="feed-video"], [data-e2e="feed-active-video"]') || info.parentElement;
  const descEl = scope.querySelector('[data-e2e="video-desc"]');
  if (descEl) descEl.textContent = '切条后的新文案 #测试';   // 页面原文带话题井号
  d.body.appendChild(d.createElement('span'));
  await sleep(1300);

  eq('浮窗被就地刷新 1 次', calls.length, 1);
  if (calls.length) {
    // v2.6.1：井号会被清掉，期望值也跟着变（顺便验证清理在「切条后再次提取」这条路上也生效）
    eq('刷新进来的是新一条的文案', String(calls[0]['本页文案'] || ''), '切条后的新文案 测试');
    eq('刷新进来的是新一条的作者', String(calls[0]['作者昵称'] || ''), '新作者');
    truthy('新一条的 URL 带新作品 ID', String(calls[0]['URL'] || '').indexOf(NEW) > 0);
  }
  eq('浮窗没有被重建（同一个窗口对象）', inst.modalManager.floatingWindow === fwBefore, true);
  eq('按钮还在，仍然只有 1 个', d.querySelectorAll('.media-extractor-button').length, 1);
  eq('按钮锚点没丢', d.querySelector('.media-extractor-button').getAttribute('data-clipmate-anchor'), 'douyin-modal');
  eq('当前作品 ID 跟着换成新的', inst._douyinModalId, NEW);
  eq('缓存键跟着换成新的', inst.cacheKey, `www.douyin.com/p/${NEW}`);

  // 同一条重复通知（抖音评论滚动等抖动）不该再刷新
  inst._onDouyinModalState({ id: NEW, opened: true });
  await sleep(300);
  eq('同一条再通知一次 → 不重复刷新', calls.length, 1);

  w.close();
}

/* =========================== 五、开关关掉 = 批 1 =========================== */

async function testPrefOff(mediaConfigs) {
  section('五、选项页开关关掉 → 完全等于批 1（不出按钮、不接管）');

  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, d } = await open(fx, {
    mediaConfigs,
    timeout: 1500,
    chromePatch: (chrome) => {
      // chromePatch 在脚本注入前执行；set 是同步写 store（async 函数体同步段）
      chrome.storage.local.set({ douyinModalEnabled: false });
    }
  });

  eq('按钮没出现（元素都不在）', d.querySelectorAll('.media-extractor-button').length, 0);
  falsy('实例未接管页面', inst && inst.isInitialized);
  // v2.5.80：两个开关独立 —— 弹窗关掉、沉浸流还开着时，监听**仍要挂**（沉浸流要靠它），
  // 但这一页是弹窗页，弹窗开关关了就不许接管。用户能感知的是「不出按钮」，不是「挂没挂监听」。
  falsy('弹窗页没有被接管（按钮不出来）', inst && inst._douyinActivated);
  falsy('没有弹窗标志', inst && inst._douyinModalId);
  eq('类型检测仍然返回空（批 1 的行为）', inst && inst.detectMediaType(), null);
  falsy('弹窗开关关掉后，弹窗状态不会被接管',
    await (async () => {
      if (!inst || typeof inst._onDouyinModalState !== 'function') return false;
      inst._onDouyinModalState({ id: '7672265848853220618', opened: true, mode: 'modal' });
      await sleep(50);
      return !!(inst._douyinActivated || inst._douyinModalId);
    })());
  eq('仍然一个按钮都没有', d.querySelectorAll('.media-extractor-button').length, 0);

  page.dom.window.close();
}

/* ============================== 六、熔断 ============================== */

async function testBreaker(mediaConfigs) {
  section('六、熔断后不接管（连续取不到内容的退路）');

  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, w, d } = await open(fx, { mediaConfigs });
  const Cls = w.DouyinModalExtractor;
  truthy('[熔断·前置] 提取器类可访问', !!Cls);

  Cls.disabled = true;
  await inst._onDouyinModalState({ id: '7672265848853220618', opened: true });
  await sleep(60);
  eq('熔断后按钮不出现', d.querySelectorAll('.media-extractor-button').length, 0);

  Cls.disabled = false;
  await inst._onDouyinModalState({ id: '7672265848853220618', opened: true });
  await sleep(60);
  eq('熔断解除后按钮回来', d.querySelectorAll('.media-extractor-button').length, 1);

  Cls._emptyStreak = 0;
  w.close();
}

/* =========================== 七、域名门禁 =========================== */

async function testOtherSitesUnaffected(mediaConfigs) {
  section('七、域名门禁：非抖音页面一个监听都不多挂');

  const fx = fixtureById('douban-book-1084336');
  const { page, inst, d, w } = await open(fx, { mediaConfigs });

  truthy('[豆瓣] 页面照常初始化', inst && inst.isInitialized);
  eq('[豆瓣] 按钮照常出现', d.querySelectorAll('.media-extractor-button').length, 1);
  falsy('[豆瓣] 没有弹窗监听', inst._douyinWatch);
  falsy('[豆瓣] 没有弹窗标志', inst._douyinModalId);
  eq('[豆瓣] 按钮没有弹窗锚点', d.querySelector('.media-extractor-button').getAttribute('data-clipmate-anchor'), null);
  eq('[豆瓣] 类型检测不受影响', inst.detectMediaType(), 'book');
  eq('[豆瓣] 缓存键不带作品维度', inst.cacheKey.indexOf('/p/'), -1);

  w.close();
}

/* =========================== 八、锚点计算 =========================== */

async function testAnchorMath(mediaConfigs) {
  section('八、锚点夹取 + 用户拖动后不抢位置');

  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, w, d } = await open(fx, { mediaConfigs });
  const btn = d.querySelector('.media-extractor-button');
  const vw = w.innerWidth;
  const vh = w.innerHeight;

  // 弹窗正常居中：右边缘 900、上边缘 120 → 按钮落在 (900-120-16, 120+16)
  inst._douyinAnchorElement = () => ({
    getBoundingClientRect: () => ({ right: 900, top: 120, width: 700, height: 600, left: 200, bottom: 720 })
  });
  inst._anchorDouyinButton();
  eq('正常弹窗：贴住右边缘内缩 16px', btn.style.left, (900 - 120 - 16) + 'px');
  eq('正常弹窗：贴住上边缘内缩 16px', btn.style.top, (120 + 16) + 'px');

  // 弹窗比屏幕还宽（全屏 / 缩放异常）→ 夹回视口右边
  inst._douyinAnchorElement = () => ({
    getBoundingClientRect: () => ({ right: 4000, top: -200, width: 4000, height: 2000, left: 0, bottom: 1800 })
  });
  inst._anchorDouyinButton();
  eq('超宽弹窗：夹回视口右边', btn.style.left, (vw - 120 - 16) + 'px');
  eq('超出上边：夹回 16px', btn.style.top, '16px');

  // 用户拖动过 → 不再抢位置
  btn.style.left = '333px';
  btn.style.top = '222px';
  inst._douyinUserMoved = true;
  inst._douyinAnchorElement = () => ({
    getBoundingClientRect: () => ({ right: 900, top: 120, width: 700, height: 600, left: 200, bottom: 720 })
  });
  inst._anchorDouyinButton();
  eq('拖动后：位置不被抢走（left）', btn.style.left, '333px');
  eq('拖动后：位置不被抢走（top）', btn.style.top, '222px');

  // 关弹窗后重置，下次重新贴
  inst._deactivateDouyinModal();
  falsy('关弹窗后「用户拖过」标志被清掉', inst._douyinUserMoved);

  truthy('视口高度可读（夹取需要）', vh > 0);
  w.close();
}

/* ========================== 九、详情页红线 ========================== */

async function testDetailPageRedLine(mediaConfigs) {
  section('九、红线：抖音详情页行为不变');

  const fx = fixtureById('douyin-video-7411950642865917225');
  const { page, inst, d, w } = await open(fx, { mediaConfigs });

  truthy('详情页照常初始化', inst && inst.isInitialized);
  eq('详情页按钮 1 个', d.querySelectorAll('.media-extractor-button').length, 1);
  eq('详情页按钮不贴弹窗锚点', d.querySelector('.media-extractor-button').getAttribute('data-clipmate-anchor'), null);
  falsy('详情页没有弹窗监听', inst._douyinWatch);
  eq('详情页缓存键不带作品维度', inst.cacheKey.indexOf('/p/'), -1);

  const r = await H.runRealPath(page, inst);
  eq('详情页用的还是原提取器', r.extractor, 'DouyinSocialExtractor');
  eq('详情页类型仍是 social', r.mediaTypeUsed, 'social');

  w.close();
}

/* ====================== 十、认不出是哪一条 = 不出按钮 ====================== */

async function testUnknownWorkId(mediaConfigs) {
  section('十、认不出是哪一条 → 不出按钮（真机发现的规则）');

  // 真机实测（批 3 · headless 未登录）：弹层容器还没渲染出来时，
  // isOpen() 可能为真（地址栏带 modal_id）但 getWorkId() 为空。
  // 这种时候若接管，按钮出来了却取不到任何字段，点了只会给一堆错值 —— 必须不出按钮。
  const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
  const { page, inst, w, d } = await open(fx, { mediaConfigs });

  // 手工摆出「还没接管」的状态（正常页面加载时因为信息区已就绪会直接接管）
  inst._douyinActivated = false;
  inst._douyinModalId = '';
  inst.isInitialized = false;

  await inst._onDouyinModalState({ id: '', opened: true });
  await sleep(60);
  eq('认不出作品：一个按钮都不出', d.querySelectorAll('.media-extractor-button').length, 0);
  falsy('认不出作品：不接管（isInitialized 保持假）', inst.isInitialized);
  eq('认不出作品：作品 ID 仍为空', inst._douyinModalId, '');

  // 等 DOM 渲染完、认出作品 → 立刻接管
  await inst._onDouyinModalState({ id: '7672265848853220618', opened: true });
  await sleep(120);
  eq('认出作品后：按钮回来了', d.querySelectorAll('.media-extractor-button').length, 1);
  truthy('认出作品后：完成接管', inst.isInitialized);
  eq('认出作品后：按钮贴着锚点', d.querySelector('.media-extractor-button').getAttribute('data-clipmate-anchor'), 'douyin-modal');

  // 已接管的状态下遇到瞬时空 ID（切条过程中会出现）→ 保持现状，不许闪一下
  await inst._onDouyinModalState({ id: '', opened: true });
  await sleep(60);
  eq('已接管时遇到瞬时空 ID：按钮不消失', d.querySelectorAll('.media-extractor-button').length, 1);
  eq('已接管时遇到瞬时空 ID：记录的作品不被清空', inst._douyinModalId, '7672265848853220618');

  w.close();
}

/* ================= 十一、切标签 / 撤下再接管（v2.5.81） ================= */

/** 真机 class 串（关注页 2026-10-27 抓的原样） */
function immersiveClass(id) {
  return `NhEiLku8 video_${id} sliderVideo dC20kVxE y65SoqsA side-card-typography-scope celP7Xjg Sqo3SkC7 relatedUiA`;
}

function immersiveActHtml(id, nick, desc) {
  return `
  <div data-e2e="feed-active-video" class="${immersiveClass(id)}">
    <video></video>
    <div data-e2e="video-info" data-e2e-aweme-id="${id}">
      <a data-e2e="video-avatar" href="//www.douyin.com/user/MS4wLjABAAAA${id}"></a>
      <span data-e2e="feed-video-nickname">@${nick}</span><span>· 1天前</span>
      <div data-e2e="video-desc">${desc}展开</div>
    </div>
  </div>`;
}

function immersivePageHtml(inner) {
  return `<!DOCTYPE html><html><head><title>抖音 - 记录美好生活</title></head><body>
  <div id="header">抖音</div>${inner}</body></html>`;
}

/** 给 jsdom 元素伪造版面尺寸 */
function fakeRect(el, width, height) {
  el.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON() { return {}; }
  });
  return el;
}

async function testTabSwitch(mediaConfigs) {
  section('十一、切标签（v2.5.81）：关浮窗，但按钮必须留住');

  const OLD_ID = '7701311909727863225';
  const NEW_ID = '7700943436304125625';

  // ---- 11.1 真实链路：推荐 → 关注（不刷新），旧节点缩成 0×0 留在原地 ----
  {
    const page = await H.openPage({
      url: 'https://www.douyin.com/?recommend=1',
      html: immersivePageHtml(immersiveActHtml(OLD_ID, '推荐', '推荐页正在播的')),
      mediaConfigs
    });
    const inst = await H.waitForInit(page, 6000);
    const d = page.window.document;
    const w = page.window;
    const btnSel = '.media-extractor-button';

    // jsdom 里没有版面，先给推荐页那条一个真实几何（真机是 805×809）
    fakeRect(d.querySelector('[data-e2e="feed-active-video"]'), 805, 809);
    d.body.appendChild(d.createElement('span'));
    await sleep(500);

    eq('[切标签·起点] 按钮 1 个', d.querySelectorAll(btnSel).length, 1);
    eq('[切标签·起点] 锚点标记是沉浸流',
      d.querySelector(btnSel).getAttribute('data-clipmate-anchor'), 'douyin-immersive');
    eq('[切标签·起点] 认出推荐页这条', inst._douyinModalId, OLD_ID);

    await inst.handleExtract();
    eq('[切标签·起点] 浮窗已打开', inst.modalManager.isOpen, true);

    // 用户真的拖过按钮（跨页后应该重新贴位，不能沿用旧位置）
    inst._douyinUserMoved = true;

    // 切到关注页：抖音把旧节点缩成 0×0（不销毁），另挂一个关注页的节点
    fakeRect(d.querySelector('[data-e2e="feed-active-video"]'), 0, 0);
    w.history.replaceState({}, '', '/follow');
    const holder = d.createElement('div');
    holder.innerHTML = immersiveActHtml(NEW_ID, '关注', '关注页正在播的');
    fakeRect(holder.firstElementChild, 597, 809);
    d.body.appendChild(holder.firstElementChild);
    await sleep(1500);

    eq('[切标签] 浮窗被关掉（用户 2026-10-27 选 B）', inst.modalManager.isOpen, false);
    eq('[切标签] 按钮还在，仍只有 1 个', d.querySelectorAll(btnSel).length, 1);
    eq('[切标签] 锚点标记仍是沉浸流',
      d.querySelector(btnSel).getAttribute('data-clipmate-anchor'), 'douyin-immersive');
    eq('[切标签] 记录的作品换成关注页那条', inst._douyinModalId, NEW_ID);
    eq('[切标签] 缓存键跟着换成新的', inst.cacheKey, `www.douyin.com/p/${NEW_ID}`);
    falsy('[切标签] 换页后重置「用户拖过」标志（新页要重新贴位）', inst._douyinUserMoved);
    truthy('[切标签] 按钮有位置', /^\d+px$/.test(d.querySelector(btnSel).style.left));

    // 切回推荐页：旧关注页节点变 0×0，推荐页那条恢复版面 → 必须重新认出来（不许永久失效）
    const all = Array.from(d.querySelectorAll('[data-e2e="feed-active-video"]'));
    fakeRect(all[0], 805, 809);   // 推荐页那条（旧的第一条）
    fakeRect(all[1], 0, 0);       // 关注页那条
    w.history.replaceState({}, '', '/?recommend=1');
    d.body.appendChild(d.createElement('span'));
    await sleep(800);
    eq('[切回推荐] 按钮仍然在', d.querySelectorAll(btnSel).length, 1);
    eq('[切回推荐] 记录的作品换回推荐页那条', inst._douyinModalId, OLD_ID);

    w.close();
    await sleep(50);
  }

  // ---- 11.2 撤下再接管 → resize / 滚动监听必须重新挂上 ----
  {
    const fx = fixtureById('douyin-modal-search-video-7672265848853220618');
    const { page, inst, w, d } = await open(fx, { mediaConfigs });
    const btn = d.querySelector('.media-extractor-button');

    inst._douyinAnchorElement = () => ({
      getBoundingClientRect: () => ({ right: 900, top: 120, width: 700, height: 600, left: 200, bottom: 720 })
    });
    inst._anchorDouyinButton();
    const leftBefore = btn.style.left;
    eq('[撤下前] 贴住右边缘内缩 16px', leftBefore, (900 - 120 - 16) + 'px');

    // 撤下（关弹窗 / 切到精选都会走这里）：监听被摘掉
    inst._deactivateDouyinModal();
    eq('[撤下后] 按钮被摘掉', d.querySelectorAll('.media-extractor-button').length, 0);

    // 重新接管（再点开另一条）
    await inst._onDouyinModalState({ id: '7672265848853220618', opened: true, mode: 'modal' });
    await sleep(200);
    eq('[重新接管] 按钮回来了', d.querySelectorAll('.media-extractor-button').length, 1);

    // 改视口宽度再触发 resize：如果监听没补挂，位置不会重算
    Object.defineProperty(w, 'innerWidth', { value: 500, configurable: true, writable: true });
    w.dispatchEvent(new w.Event('resize'));
    await sleep(300);
    eq('[重新接管] resize 后按钮重算到新视口内', btn.style.left, (500 - 120 - 16) + 'px');

    w.close();
  }
}

/* ================================ 主流程 ================================ */

(async () => {
  console.log(`${C.cyan}抖音弹窗按钮与跟随验收（v2.5.77 批 3）${C.reset}`);
  console.log(`${C.gray}源码目录：${env.ROOT}${C.reset}`);

  const mediaConfigs = await env.loadBackgroundMediaConfigs();
  if (mediaConfigs && mediaConfigs.__error) {
    console.log(`${C.red}拿不到 background 的媒体配置：${mediaConfigs.__error}${C.reset}`);
    process.exit(2);
  }

  await testTakeover(mediaConfigs);
  await testExtractOpensPanel(mediaConfigs);
  await testCloseModal(mediaConfigs);
  await testSwitchNext(mediaConfigs);
  await testPrefOff(mediaConfigs);
  await testBreaker(mediaConfigs);
  await testOtherSitesUnaffected(mediaConfigs);
  await testAnchorMath(mediaConfigs);
  await testDetailPageRedLine(mediaConfigs);
  await testUnknownWorkId(mediaConfigs);
  await testTabSwitch(mediaConfigs);

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
    failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name} — ${f.detail || ''}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error(`${C.red}脚本自身异常：${C.reset}`, err);
  process.exit(3);
});
