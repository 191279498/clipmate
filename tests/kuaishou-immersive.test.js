#!/usr/bin/env node
/**
 * 快手「推荐流」（/new-reco）识别与接线验收（v2.5.83）
 *
 * 与抖音那套的最大结构差异（2026-10-27 真机勘察）：
 *   快手**没有**「列表页点开作品弹层」这种态 —— 网格卡片点开就是整页跳 /short-video/<id>。
 *   唯一的沉浸流是推荐页 `/new-reco`：竖向 swiper 整屏播一条，地址栏一直不变。
 *   当前这一条靠 `.swiper-slide-active`（真机恰好 1 个），
 *   作品 ID 与发布日期**都写在封面图地址里**（`clientCacheKey=<id>.jpg`、`/upic/YYYY/MM/DD/`）。
 *
 * 本脚本钉住七节：
 *   一、URL 判定：只认 /new-reco（宁少不多）
 *   二、从封面图地址取作品 ID 与日期
 *   三、昵称清洗与主页补全（`@黑蛇` → `黑蛇`）
 *   四、认「当前这一条」：残影 / 两条候选 / 空壳 / 整页有版面但候选全 0×0
 *   五、watch：切条（只挪 class）能感知、离开推荐流变 closed、认不出为 pending
 *   六、端到端（真实 content-main）：出按钮 + 锚点标记 + 7 个字段
 *   七、作者ID 占位符（`SSSSSSSSS`）必须被拒
 *
 * 用法：
 *   node tests/kuaishou-immersive.test.js
 *   node tests/kuaishou-immersive.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const CONTEXT_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/shared/kuaishou-immersive-context.js');
const SOCIAL_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/extractors/kuaishou-social.js');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================== 载入 jsdom ============================== */

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请设置 NODE_PATH 或 CLIPMATE_NODE_PATH（见 tests/README.md）');
}
const { JSDOM } = loadJsdom();

function loadContext(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  delete require.cache[require.resolve(CONTEXT_PATH)];
  const prevWindow = global.window;
  global.window = dom.window;
  let api;
  try {
    api = require(CONTEXT_PATH);
  } finally {
    global.window = prevWindow;
  }
  return { dom, api, d: dom.window.document, w: dom.window };
}

/* ============================== 页面模板 ============================== */

/**
 * 真机实测的封面地址形态（2026-10-27 抓的原样，只把 ID 换成用例值）
 * @param {string} [variant] 封面变体后缀。真机上见过 `clientCacheKey=<作品ID>_ccc.jpg`
 *                           —— 后缀是封面裁图变体，不是作品 ID 的一部分。
 */
function coverSrc(id, y, m, d, variant) {
  // 真实地址里月日是补零的（`/upic/2026/08/18/`），这里照抄
  const pad = (n) => String(n).padStart(2, '0');
  return `https://p23.a.yximgs.com/upic/${y}/${pad(m)}/${pad(d)}/14/BMjAyNjEwMjYxNDI5MjhfMjg3MzIxODM4OV8xXzNf.json.jpg`
    + `?tag=1-1793114535-unknown-0-vepgxr4fs4&clientCacheKey=${id}${variant ? '_' + variant : ''}.jpg&bp=14944`;
}

/**
 * 一条 swiper slide。
 * @param {object} o
 * @param {string} o.id      作品 ID
 * @param {string} o.nick    昵称（不带 @）
 * @param {string} o.text    纯文案
 * @param {string[]} o.tags  话题标签
 * @param {string} o.date    封面日期 `YYYY/MM/DD`
 * @param {boolean} o.active 是否当前条
 * @param {boolean} o.noId   故意不给封面（模拟认不出）
 */
function slideHtml({ id, nick, text = '', tags = [], date = '2026/10/15', active = false, noId = false, variant = '' } = {}) {
  const [y, m, d] = String(date).split('/');
  const cover = noId
    ? '<img class="background" src="https://p23.a.yximgs.com/logo.png">'
    : `<img class="background" src="${coverSrc(id, y, m, d, variant)}">`;
  const tagHtml = tags.map((t) => `<a class="tag" href="/hashtag/${t}">#${t}</a>`).join('');
  return `
  <div class="swiper-slide${active ? ' swiper-slide-active' : ''}">
    <div class="video-sidebar-layout">
      ${cover}
      <div class="video-container">
        <div class="lb">
          <div class="line-1"><a class="name" href="https://www.kuaishou.com/profile/3xe9ystj68jpzgc">@${nick}</a><span class="timestamp"> · 1 天前</span></div>
          <div class="caption">${text ? '<span class="plain">' + text + '</span>' : ''}${tagHtml}</div>
        </div>
      </div>
    </div>
  </div>`;
}

function pageHtml(slides) {
  return `<!DOCTYPE html><html><head><title>快手</title></head><body>
  <div class="swiper-container"><div class="swiper-wrapper">${slides.join('\n')}</div></div>
  </body></html>`;
}

const URL_RECO = 'https://www.kuaishou.com/new-reco';
const URL_RECO_Q = 'https://www.kuaishou.com/new-reco?source=1';
const URL_DETAIL = 'https://www.kuaishou.com/short-video/3xs9ezatr424bpa';
const URL_HOME = 'https://www.kuaishou.com/?isHome=1';
const URL_FOLLOW = 'https://www.kuaishou.com/myFollow';
const URL_PROFILE = 'https://www.kuaishou.com/profile/3xe9ystj68jpzgc';

/** 给元素造几何（jsdom 里 getBoundingClientRect 恒 0） */
function geo(el, w, h, top = 0, left = 0) {
  if (!el) return el;
  el.getBoundingClientRect = () => ({
    width: w, height: h, top, left, right: left + w, bottom: top + h, x: left, y: top
  });
  return el;
}

/** 让 jsdom 的 body 看起来「有版面」（hasPageLayout 用 scrollHeight 判定） */
function markPageLayout(d) {
  Object.defineProperty(d.body, 'scrollHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(d.body, 'scrollWidth', { configurable: true, get: () => 1280 });
}

/* ============================ 一、URL 判定 ============================ */

function section1() {
  section('一、URL 判定：只认 /new-reco');
  const { api } = loadContext(pageHtml([slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', active: true })]), URL_RECO);

  eq('[URL] /new-reco 算推荐流', api.isImmersivePage(URL_RECO), true);
  eq('[URL] /new-reco?source=1 也算', api.isImmersivePage(URL_RECO_Q), true);

  const notImmersive = {
    '详情页 /short-video/<id>': URL_DETAIL,
    '发现网格 /?isHome=1': URL_HOME,
    '关注网格 /myFollow': URL_FOLLOW,
    '作者主页 /profile/<id>': URL_PROFILE,
    '首页 /': 'https://www.kuaishou.com/',
    '直播页 /live/xxx': 'https://www.kuaishou.com/live/abc',
    '别的域名': 'https://www.douyin.com/new-reco'
  };
  for (const [label, url] of Object.entries(notImmersive)) {
    eq(`[URL] ${label} 不算推荐流`, api.isImmersivePage(url), false);
  }
}

/* ====================== 二、从封面图地址取 ID 与日期 ====================== */

function section2() {
  section('二、作品 ID 与日期都从封面图地址里取（零请求）');
  const { api } = loadContext(pageHtml([slideHtml({ id: 'x', nick: 'x', active: true })]), URL_RECO);

  eq('[ID] clientCacheKey 形态',
    api.idFromCoverSrc(coverSrc('3xs9ezatr424bpa', 2026, 10, 15)), '3xs9ezatr424bpa');
  eq('[ID] 老形态 Key= 也认',
    api.idFromCoverSrc('https://p1.a.yximgs.com/upic/2026/10/15/a.jpg?Key=3xkdnjqjmta58tq.jpg&x=1'), '3xkdnjqjmta58tq');
  eq('[ID] 没有 ID 的地址返回空',
    api.idFromCoverSrc('https://p23.a.yximgs.com/logo.png'), '');
  eq('[ID] 空地址返回空', api.idFromCoverSrc(''), '');

  // v2.5.82 真机踩到：clientCacheKey 可能是 `<作品ID>_ccc.jpg`，
  // 后缀是封面裁图变体，不剥离就会拼出打不开的作品 URL。
  eq('[ID] 封面变体后缀 _ccc 必须剥掉',
    api.idFromCoverSrc(coverSrc('3xdj86q2ifn7hds', 2026, 8, 18, 'ccc')), '3xdj86q2ifn7hds');
  eq('[ID] 变体后缀不影响日期',
    api.dateFromSrc(coverSrc('3xdj86q2ifn7hds', 2026, 8, 18, 'ccc')), '2026/08/18');
  eq('[ID] 真机原样（带变体）取到的仍是真 ID',
    api.idFromCoverSrc('https://p5.a.yximgs.com/upic/2026/08/18/18/BMjAyNjA4MTgxODI3MDJf_ccc_B4b57d4dd529fa.jpg'
      + '?tag=1-1&clientCacheKey=3xdj86q2ifn7hds_ccc.jpg&di=1&bp=1'), '3xdj86q2ifn7hds');
  eq('[ID] 无变体时原样返回（不许误伤）',
    api.idFromCoverSrc(coverSrc('3xs9ezatr424bpa', 2026, 10, 15)), '3xs9ezatr424bpa');

  eq('[日期] /upic/YYYY/MM/DD/ 取到日',
    api.dateFromSrc(coverSrc('3xs9ezatr424bpa', 2026, 10, 15)), '2026/10/15');
  eq('[日期] 补零形态原样保留',
    api.dateFromSrc('https://p1.a.yximgs.com/upic/2025/02/09/01/x.jpg'), '2025/02/09');
  eq('[日期] 地址里没有日期返回空',
    api.dateFromSrc('https://p23.a.yximgs.com/logo.png'), '');
  eq('[日期] 头像地址（/uhead/）不会被当成作品日期',
    api.dateFromSrc('https://p66.a.kwimgs.com/uhead/AB/2023/04/27/19/x_s.jpg'), '');
}

/* ===================== 三、昵称清洗与主页补全 ===================== */

function section3() {
  section('三、昵称与主页：与详情页输出必须逐字一致');
  const { api } = loadContext(pageHtml([slideHtml({ id: 'x', nick: 'x', active: true })]), URL_RECO);

  eq('[昵称] 去掉开头的 @', api.cleanNickname('@黑蛇'), '黑蛇');
  eq('[昵称] 多个 @ 也去掉', api.cleanNickname('@@黑蛇'), '黑蛇');
  eq('[昵称] 中间的空格保留', api.cleanNickname('@黑 蛇'), '黑 蛇');
  eq('[昵称] 空值返回空', api.cleanNickname(''), '');

  const { d } = loadContext(pageHtml([
    slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '文案', active: true })
  ]), URL_RECO);
  const ctx = api.slideContext(d.querySelector('.swiper-slide-active'));
  eq('[主页] 完整 https 地址原样返回',
    ctx && ctx.homepage, 'https://www.kuaishou.com/profile/3xe9ystj68jpzgc');
  eq('[ID] slide 上下文里带上作品 ID', ctx && ctx.id, '3xs9ezatr424bpa');
  eq('[日期] slide 上下文里带上日期', ctx && ctx.date, '2026/10/15');
  eq('[昵称] slide 上下文里不带 @', ctx && ctx.nickname, '黑蛇');
}

/* ==================== 四、认「当前这一条」 ==================== */

function section4() {
  section('四、认当前这一条：残影 / 两条候选 / 空壳');

  // 4.1 干净页面：1 个 active
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '宝宝 人这一生太短', tags: ['菊花台'], active: true }),
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: '下一条' })
    ]), URL_RECO);
    const c = api.immersiveContext(d);
    eq('[正常] 认出当前条 ID', c && c.id, '3xs9ezatr424bpa');
    eq('[正常] 昵称', c && c.nickname, '黑蛇');
    eq('[正常] 日期', c && c.date, '2026/10/15');
    eq('[正常] 文案带空格（标签前不粘连）', c && c.caption, '宝宝 人这一生太短 #菊花台');
  }

  // 4.2 残影：另一个 active 是 0×0（快手预加载下一条的形态）
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: '残留的', active: true }),
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '真的这条', active: true })
    ]), URL_RECO);
    markPageLayout(d);
    const acts = Array.from(d.querySelectorAll('.swiper-slide-active'));
    geo(acts[0], 0, 0);
    geo(acts[1], 805, 809);
    const c = api.immersiveContext(d);
    eq('[残影] 0×0 的残影不算候选', c && c.id, '3xs9ezatr424bpa');
  }

  // 4.3 两条都有版面 → 认不出（宁空不错）
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: 'A', active: true }),
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: 'B', active: true })
    ]), URL_RECO);
    markPageLayout(d);
    const acts = Array.from(d.querySelectorAll('.swiper-slide-active'));
    geo(acts[0], 805, 809);
    geo(acts[1], 805, 809);
    eq('[两条都像] 返回 null，绝不猜', api.immersiveContext(d), null);
  }

  // 4.4 整页有版面、候选却全 0×0（换页瞬间只剩残影）→ 认不出
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: '残影', active: true })
    ]), URL_RECO);
    markPageLayout(d);
    geo(d.querySelector('.swiper-slide-active'), 0, 0);
    eq('[全是残影] 整页有版面时不拿 0×0 当锚点', api.immersiveContext(d), null);
  }

  // 4.5 没有封面地址（认不出 ID）→ null
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: 'x', nick: '黑蛇', text: '文案', active: true, noId: true })
    ]), URL_RECO);
    eq('[无 ID] 返回 null', api.immersiveContext(d), null);
  }

  // 4.6 没有 active → null
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '文案' })
    ]), URL_RECO);
    eq('[没有当前条] 返回 null', api.immersiveContext(d), null);
  }

  // 4.7 不是推荐流页 → null（哪怕结构齐全）
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '文案', active: true })
    ]), URL_DETAIL);
    eq('[详情页] 不认', api.immersiveContext(d), null);
    eq('[详情页] isOpen 为假', api.isOpen(d), false);
    eq('[详情页] getWorkId 为空', api.getWorkId(d), '');
  }
}

/* ============================== 五、watch ============================== */

async function section5() {
  section('五、watch：切条只挪 class 也要感知到');

  // 5.1 初始认出
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '第一条', active: true }),
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: '第二条' })
    ]), URL_RECO);
    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 150 });
    await sleep(50);
    eq('[watch] 起点就认出第一条', events.length && events[0].id, '3xs9ezatr424bpa');
    eq('[watch] opened=true', events[0] && events[0].opened, true);
    eq('[watch] mode=immersive', events[0] && events[0].mode, 'immersive');

    // 5.2 切条：只挪 class（不重建节点）—— 这是快手与抖音最大的差异
    const slides = Array.from(d.querySelectorAll('.swiper-slide'));
    slides[0].classList.remove('swiper-slide-active');
    slides[1].classList.add('swiper-slide-active');

    await sleep(160);
    const last = events[events.length - 1];
    eq('[watch] 切条后回调新的一条', last && last.id, '3xkbpgjvzdkc6a4');
    eq('[watch] 切条不算关闭（没有 opened=false）', events.filter((e) => !e.opened).length, 0);
    stop();
  }

  // 5.3 离开推荐流 → closed
  {
    const { api, d, w } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '第一条', active: true })
    ]), URL_RECO);
    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 120 });
    await sleep(50);
    w.history.pushState({}, '', '/short-video/3xs9ezatr424bpa');
    await sleep(160);
    const closed = events.filter((e) => !e.opened);
    truthy('[watch] 地址离开 /new-reco 后回调关闭', closed.length >= 1);
    stop();
  }

  // 5.4 认不出（active 没了）→ pending 不回调，超时后才算关闭
  {
    const { api, d } = loadContext(pageHtml([
      slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '第一条', active: true })
    ]), URL_RECO);
    const events = [];
    const stop = api.watch((e) => events.push(e), { debounceMs: 20, pendingMs: 220 });
    await sleep(50);
    const before = events.length;
    d.querySelector('.swiper-slide-active').classList.remove('swiper-slide-active');
    await sleep(120);
    eq('[watch] 认不出的这一瞬间不回调（按钮/浮窗保持现状）', events.length, before);
    await sleep(260);
    truthy('[watch] 超过兜底时长才按关闭处理',
      events.filter((e) => !e.opened).length >= 1);
    stop();
  }
}

/* ============================ 六、端到端 ============================ */

/** 从 background.js 真源码里抠快手的媒体配置 */
function kuaishouMediaConfigFromSource() {
  const bgPath = path.resolve(__dirname, '../ClipMate_chrome/src/background/background.js');
  const src = fs.readFileSync(bgPath, 'utf8');
  const anchor = src.indexOf("'www.kuaishou.com':");
  if (anchor < 0) throw new Error('background.js 里找不到 www.kuaishou.com 的媒体配置');
  const tail = src.slice(anchor, anchor + 900);

  // v2.7.17：快手从「单条 type + patterns」改成 **多规则**（`/profile/<id>` 是个人主页 person，
  // `/short-video/`、`/video/` 是作品页 social）。两种写法都要认得。
  const rules = [];
  const rulesIdx = tail.indexOf('rules:');
  if (rulesIdx > -1) {
    const block = tail.slice(rulesIdx, rulesIdx + 400);
    const re = /\{\s*type:\s*'([^']+)',\s*patterns:\s*\[([^\]]*)\]\s*\}/g;
    let m;
    while ((m = re.exec(block))) {
      rules.push({
        type: m[1],
        patterns: m[2].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
      });
    }
  }

  const typeM = /type:\s*'([^']+)'/.exec(tail);
  const patM = /patterns:\s*\[([^\]]*)\]/.exec(tail);
  const patList = (s) => s.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  // 顶层 type / patterns 保持「作品页 social」的口径（harness 按旧结构吃），
  // 有 rules 时以 social 那一条为准 —— 否则会误取到 rules 里第一条（person）。
  const socialRule = rules.filter((r) => r.type === 'social')[0];

  return {
    type: socialRule ? socialRule.type : (typeM ? typeM[1] : ''),
    patterns: socialRule ? socialRule.patterns : (patM ? patList(patM[1]) : []),
    rules,
    noContentFallback: /noContentFallback:\s*true/.test(tail)
  };
}

async function section6() {
  section('六、端到端：真实 content-main 在推荐流出按钮 + 7 个字段');

  const H = require('./lib/harness');

  const cfg = kuaishouMediaConfigFromSource();
  eq('[后台] 声明了 noContentFallback（少了这条 /new-reco 会被按正文猜类型）', cfg.noContentFallback, true);
  // v2.7.17 起快手是多规则：`/profile/<id>` 个人主页（person）+ 作品页（social）。
  // 这里只钉「作品页那条还在、且是 social」—— 推荐流端到端用的就是它。
  eq('[后台] 作品页 patterns 仍是这两条', cfg.patterns.join(','), '/short-video/,/video/');
  eq('[后台] 作品页类型是 social', cfg.type, 'social');
  truthy('[后台] 多出了 person 规则（/profile/ = 个人主页，v2.7.17）',
    cfg.rules.some((r) => r.type === 'person' && r.patterns.indexOf('/profile/') > -1),
    JSON.stringify(cfg.rules));

  const mediaConfigs = { 'www.kuaishou.com': cfg };

  const page = await H.openPage({
    url: URL_RECO,
    html: pageHtml([
      slideHtml({
        id: '3xs9ezatr424bpa',
        nick: '黑蛇',
        text: '宝宝 人这一生太短 爱上什么人都不为过',
        tags: ['菊花台', '周杰伦'],
        date: '2026/10/15',
        // 真机上封面常带变体后缀，端到端必须走这条路径（否则 URL 字段会拼错）
        variant: 'ccc',
        active: true
      }),
      slideHtml({ id: '3xkbpgjvzdkc6a4', nick: '琪昱', text: '下一条' })
    ]),
    mediaConfigs,
    // 作者ID 那条链会去抓作者主页（fetch），这里给一份带 kwaiId 的静态 HTML，
    // 免得走 iframe 渲染兜底白等 10 秒超时。
    beforeMainScript: `
      window.fetch = function () {
        return Promise.resolve({
          ok: true, status: 200,
          text: function () { return Promise.resolve('<html>{"kwaiId":"heishe7758521"}</html>'); }
        });
      };
    `
  });

  const inst = await H.waitForInit(page, 8000);
  const w = page.window;
  const d = w.document;

  truthy('拿得到 content-main 实例', inst);
  eq('页面上一共 1 个提取按钮', d.querySelectorAll('.media-extractor-button').length, 1);
  const btn = d.querySelector('.media-extractor-button');
  eq('按钮打了推荐流锚点标记', btn && btn.getAttribute('data-clipmate-anchor'), 'kuaishou-immersive');
  truthy('实例已接管（isInitialized）', inst && inst.isInitialized);
  eq('记下的作品 ID 是当前这一条', inst && inst._ksWorkId, '3xs9ezatr424bpa');
  eq('类型补认成 social', inst && inst.detectMediaType(), 'social');
  truthy('挂了监听', inst && typeof inst._ksWatch === 'function');

  const anchorEl = inst && inst._kuaishouAnchorElement ? inst._kuaishouAnchorElement() : null;
  truthy('锚点取的是当前条里的播放器容器', anchorEl && (anchorEl.classList.contains('video-container') || anchorEl.classList.contains('swiper-slide')));

  let data = null;
  try {
    data = await inst.extractFromCurrentPage();
  } catch (e) {
    bad('提取抛错', e && e.message);
  }
  truthy('提取出了字段', data && typeof data === 'object');

  const SOCIAL_KEYS = ['本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'];
  const keys = data ? Object.keys(data) : [];
  eq('7 个社交业务字段一个不少', SOCIAL_KEYS.every((k) => keys.includes(k)), true);
  eq('URL 指向这条作品', data && data['URL'], 'https://www.kuaishou.com/short-video/3xs9ezatr424bpa');
  eq('作者昵称（不带 @）', data && data['作者昵称'], '黑蛇');
  eq('作者主页', data && data['作者主页'], 'https://www.kuaishou.com/profile/3xe9ystj68jpzgc');
  eq('发布日期（与详情页同一套规则）', data && data['发布日期'], '2026/10/15');
  eq('本页文案（标签前有空格）',
    // v2.6.1：文案出口去掉话题井号（用户 2026-10-29 要求）
    data && data['本页文案'], '宝宝 人这一生太短 爱上什么人都不为过 菊花台 周杰伦');
  eq('作者ID 来自作者主页', data && data['作者ID'], 'heishe7758521');
  truthy('本页标题非空', data && String(data['本页标题'] || '').trim());
  eq('媒体类型是 social（浮窗才会按 7 行显示）', data && data.mediaType, 'social');
  eq('站点标识不变', data && data.sourceSite, 'kuaishou_social');

  // 切条：只挪 class
  const slides = Array.from(d.querySelectorAll('.swiper-slide'));
  slides[0].classList.remove('swiper-slide-active');
  slides[1].classList.add('swiper-slide-active');
  await sleep(900);
  eq('切条后记下新条的作品 ID', inst && inst._ksWorkId, '3xkbpgjvzdkc6a4');
  eq('按钮仍在（切条不是离开）', d.querySelectorAll('.media-extractor-button').length, 1);

  w.close();
  await sleep(50);
}

/* ==================== 七、作者ID 占位符（老 bug） ==================== */

function section7() {
  section('七、作者ID 的 `SSSSSSSSS` 占位必须被拒（v2.5.82 顺带修）');

  const src = fs.readFileSync(SOCIAL_PATH, 'utf8');
  truthy('实现了占位判据 _isPlaceholderKwaiId', /_isPlaceholderKwaiId\s*\(/.test(src));
  truthy('iframe 渲染路径会跳过占位', /_isPlaceholderKwaiId\(m\[1\]\)/.test(src));
  // v2.7.10：静态解析路径的占位闸从原来的 `... continue` 收进了 _normalizeKwaiId
  // （同一个函数里还管「值等于内部ID就拒」「非法字符」）。所以这里断言的是
  // 「静态路径确实走那道闸」，而不是写死旧写法。行为断言见
  // tests/kuaishou-kwaid-userdefine.test.js 的「占位符 SSSSSSSSS 不认」。
  truthy('静态解析路径会跳过占位',
    /_normalizeKwaiId\(m\[1\], userId\)/.test(src) && /_isPlaceholderKwaiId\(id\)\)\s*return ''/.test(src));
  truthy('写缓存前用 validate 挡占位', /validate:\s*\(id\)\s*=>\s*!this\._isPlaceholderKwaiId\(id\)/.test(src));
  truthy('读缓存结果也会再挡一次', /if\s*\(kwaiId\s*&&\s*this\._isPlaceholderKwaiId\(kwaiId\)\)/.test(src));

  // 真实判据（从源码里把类抠出来，只测这一个方法，不建整页）
  const sandbox = { console, ClipMateLog: { debug() {}, warn() {}, error() {}, info() {} } };
  const vm = require('vm');
  // 只取 `_isPlaceholderKwaiId` 那段方法体，避免整类依赖 window
  const m = /_isPlaceholderKwaiId\(id\)\s*\{([\s\S]*?)\n  \}/.exec(src);
  truthy('能抠出方法体', !!m);
  if (m) {
    const fn = new vm.Script(`(function(id){${m[1]}})`).runInNewContext(vm.createContext(sandbox));
    eq('[占位] SSSSSSSSS 判为占位', fn('SSSSSSSSS'), true);
    eq('[占位] xxxx 判为占位', fn('xxxx'), true);
    eq('[占位] 000000 判为占位', fn('000000'), true);
    eq('[占位] 空串判为占位', fn(''), true);
    eq('[占位] 真快手号 heishe7758521 放行', fn('heishe7758521'), false);
    eq('[占位] 真快手号 fanfan_123 放行', fn('fanfan_123'), false);
    eq('[占位] 含双 S 的真号（SS88）放行', fn('SS88'), false);
  }
}

/* ============ 八、方法签名契约（v2.5.82 真机抓到的 bug） ============ */

/**
 * 这一节守的是一次真机事故：
 *
 *   推荐流提取器把父类的**同步**方法 `extractAuthorHomepage()` 覆盖成了 async。
 *   父类 `extractAuthorInternalId()` 内部按字符串用它（`homepage.match(/\/profile\/(\w+)/)`），
 *   拿到 Promise 后 `.match` 抛异常 → 被 catch 吞掉 → 作者ID 兜底失效 → **字段变空**。
 *
 *   原单测为什么没抓到：端到端那节用 `await` 调用，async 也拿得到值；而且 fetch 被 stub
 *   成「一定能拿到快手号」，正好绕开了崩溃的兜底路径。两层巧合叠成假绿。
 *
 *   所以这里改成按**父类真实的调用方式**断言：同步调用、同步取值。
 */
function section8() {
  section('八、方法签名契约：父类同步的方法，子类不许改成 async');

  const vm = require('vm');
  const IMMERSIVE_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/extractors/kuaishou-immersive.js');

  const sandbox = {
    console,
    window: {},
    BaseExtractor: class { constructor() { this.siteName = ''; } },
    ClipMateLog: { debug() {}, warn() {}, info() {}, error() {} },
    AuthorIdFetcher: { dedupe: () => Promise.resolve(''), extract: () => Promise.resolve('') },
    SocialTitleProcessor: {}, SocialFieldsBuilder: {}, CacheKeyManager: {}
  };
  sandbox.window.BaseExtractor = sandbox.BaseExtractor;
  const ctxObj = vm.createContext(sandbox);

  try {
    vm.runInContext(fs.readFileSync(SOCIAL_PATH, 'utf8'), ctxObj, { filename: 'kuaishou-social.js' });
    vm.runInContext(fs.readFileSync(IMMERSIVE_PATH, 'utf8'), ctxObj, { filename: 'kuaishou-immersive.js' });
  } catch (e) {
    bad('能把两个提取器类塞进沙箱', String(e && e.message).slice(0, 120));
    return;
  }

  const Social = sandbox.window.KuaishouSocialExtractor;
  const Immersive = sandbox.window.KuaishouImmersiveExtractor;
  truthy('取得到父类 KuaishouSocialExtractor', !!Social);
  truthy('取得到子类 KuaishouImmersiveExtractor', !!Immersive);
  if (!Social || !Immersive) return;

  // —— 父子类签名必须一致 ——
  const SYNC_METHODS = ['extractAuthorName', 'extractAuthorHomepage', 'extractDescription', 'extractPublishDate'];
  const pSrc = fs.readFileSync(SOCIAL_PATH, 'utf8');
  const cSrc = fs.readFileSync(IMMERSIVE_PATH, 'utf8');
  for (const name of SYNC_METHODS) {
    const decl = new RegExp('\\n\\s*(async\\s+)?' + name + '\\s*\\(');
    const pm = decl.exec(pSrc);
    const cm = decl.exec(cSrc);
    truthy(`[签名] 父类里有 ${name}`, !!pm);
    truthy(`[签名] 子类里有 ${name}`, !!cm);
    if (pm && cm) {
      eq(`[签名] ${name} 与父类同步性一致（父类${pm[1] ? 'async' : '同步'}/子类${cm[1] ? 'async' : '同步'}）`,
        !!cm[1], !!pm[1]);
    }
  }

  // —— 真机那条崩溃路径：同步调用必须拿到字符串 ——
  const inst = new Immersive();
  inst._ctxResolved = true;
  inst._ctx = {
    id: '3xs9ezatr424bpa',
    homepage: 'https://www.kuaishou.com/profile/3xe9ystj68jpzgc',
    nickname: '黑蛇',
    date: '2026/10/15',
    caption: '宝宝 人这一生太短 爱上什么人都不为过'
  };

  const hp = inst.extractAuthorHomepage();
  falsy('[崩溃路径] 作者主页同步调用不能返回 Promise（返回 Promise 会让 .match() 抛异常）',
    typeof (hp && hp.then) === 'function');
  eq('[崩溃路径] 作者主页同步调用拿到的是字符串',
    typeof hp === 'string' ? hp : '(不是字符串)', 'https://www.kuaishou.com/profile/3xe9ystj68jpzgc');

  // 这一格就是真机上变空的字段：快手号抓不到时的兜底
  eq('[崩溃路径] 抓不到快手号时，作者ID 兜底成内部 ID', inst.extractAuthorInternalId(), '3xe9ystj68jpzgc');

  eq('[崩溃路径] 作者昵称同步可取', inst.extractAuthorName(), '黑蛇');
  eq('[崩溃路径] 发布日期同步可取', inst.extractPublishDate(), '2026/10/15');
  truthy('[崩溃路径] 本页文案同步可取', String(inst.extractDescription() || '').trim());
}

/* ============ 九、页面自带的「作品档案」（v2.5.83：补位数据源） ============ */

const STATE_READER = path.resolve(__dirname, '../ClipMate_chrome/src/background/kuaishou-state.js');
const KS_CLIENT = path.resolve(__dirname, '../ClipMate_chrome/src/content/shared/kuaishou-state-client.js');

/**
 * 注意：那个读取器是**被调用时**才去读 `window.INIT_STATE`（在页面里跑的东西必须这样），
 * 所以这里返回的包装函数要在调用那一刻才把假窗口装上去，调用完立刻还原。
 */
function loadStateReader(fakeWindow) {
  delete require.cache[require.resolve(STATE_READER)];

  function swapTemp() {
    const prev = global.window;
    if (fakeWindow === undefined) delete global.window;
    else global.window = fakeWindow;
    return prev;
  }
  function restore(prev) {
    if (prev === undefined) delete global.window;
    else global.window = prev;
  }

  const prevLoad = swapTemp();
  let fn;
  try {
    fn = require(STATE_READER);
  } finally {
    restore(prevLoad);
  }

  return function run() {
    const prev = swapTemp();
    try {
      return fn();
    } finally {
      restore(prev);
    }
  };
}

/** 把真机那份数据的样子捏出来（键名是 ASCII+1 偏移过的原样，值就是纯 JS 对象） */
function realShapeState() {
  return {
    'tusjoh.0sftu0w0tztufn0tubsuvq-pckfdu.': { result: 1, 'host-name': 'HS' },
    // 推荐流这一批（真机上正好 19 条，这里给 2 条）
    'tusjoh.0sftu0w0gffe0ipu-pckfdu.': {
      result: 1,
      pcursor: 'next-page',
      llsid: 'x',
      'host-name': 'HS',
      feeds: [
        {
          type: 1,
          tags: [],
          photo: {
            id: '3xd6gbdievjweyw',
            caption: '没有足够的胆识怎么出来混？ #神仙剪刀手',
            timestamp: 1792729528034,
            duration: 587666,
            viewCount: 251462,
            likeCount: 1200,
            coverUrl: 'https://p23.a.yximgs.com/upic/2026/10/23/12/x_b_Bb2cf5edc3a4f11a59.jpg',
            photoUrls: [{ cdn: 'v23-3.kwaicdn.com', url: 'https://v23-3.kwaicdn.com/x.mp4?pkey=AAVQ' }]
          },
          author: { id: '3xzthwmvysfgeni', name: '大帅影视', following: false, headerUrl: 'https://p66.a.kwimgs.com/uhead/x.jpg' }
        },
        {
          photo: { id: '3xy24servz7byuq', caption: '我差点就被抬走了 #猫meme', timestamp: 1792166419000, viewCount: 3732568 },
          author: { id: '3xehb48y2cxursa', name: '猫meme羊仔' }
        }
      ]
    },
    // 评论那份也带个数组，但形状不是「一条作品」，不许被误认
    'tusjoh.0sftu0w0qipup0dpnnfou0mjtu-pckfdu.qdvstps.uvtkpi\\\\u002F.qipupJe.uvtkpi\\\\u002F5zet;8t64{z9voe': {
      result: 1,
      pcursorV2: '',
      commentCountV2: 12,
      rootCommentsV2: [{ commentId: 'c1', content: '哈哈' }, { commentId: 'c2', content: '+1' }]
    }
  };
}

function section9() {
  section('九、页面自带的「作品档案」（v2.5.83 新增的补位数据源）');

  // —— 9.1 读取器：按形状认，不靠键名 ——
  const reader = loadStateReader({ INIT_STATE: realShapeState() });
  const feeds = reader();

  truthy('[档案] 真机形态下能读出这一批', !!feeds);
  if (feeds) {
    eq('[档案] 条数（评论那份不掺进来）', feeds.count, 2);
    truthy('[档案] 第一条在里面', !!feeds.items['3xd6gbdievjweyw']);
    eq('[档案] 第 1 条发布时间是毫秒时间戳', feeds.items['3xd6gbdievjweyw'].t, 1792729528034);
    eq('[档案] 第 1 条作者内部 ID', feeds.items['3xd6gbdievjweyw'].a, '3xzthwmvysfgeni');
    eq('[档案] 第 1 条作者昵称', feeds.items['3xd6gbdievjweyw'].n, '大帅影视');
    eq('[档案] 第 1 条文案', feeds.items['3xd6gbdievjweyw'].c, '没有足够的胆识怎么出来混？ #神仙剪刀手');
    eq('[档案] 第 2 条文案', feeds.items['3xy24servz7byuq'].c, '我差点就被抬走了 #猫meme');
    eq('[档案] 不认识的键（评论）没有被算进来', Object.keys(feeds.items).length, 2);
  }

  // 形状不对：只有 photo 没有 author → **只跳过这一条**，同一批里其它作品照收
  const mixed = loadStateReader({
    INIT_STATE: {
      a: {
        feeds: [
          { photo: { id: 'fullOne', caption: '我要这条', timestamp: 1792166419000 }, author: { id: 'u1', name: '作者1' } },
          { photo: { id: 'noAuthor', caption: '缺作者的一条', timestamp: 1792166419000 } }
        ]
      }
    }
  });
  const mixedOut = mixed();
  truthy('[档案] 同一批里缺 author 的只跳过那一条，不整批报废', !!mixedOut);
  if (mixedOut) {
    eq('[档案] 缺 author 的那条不算进条数', mixedOut.count, 1);
    truthy('[档案] 形状完整那条照收', !!mixedOut.items.fullOne);
    falsy('[档案] 缺 author 的那条不在结果里', mixedOut.items.noAuthor);
  }

  // 形状不对：feeds 不是数组 → 不认
  const notArray = loadStateReader({ INIT_STATE: { a: { feeds: { length: 3 } } } });
  truthy('[档案] feeds 不是数组就不认', notArray() === null);

  // 页面上没有这份数据（比如详情页）→ null
  eq('[档案] 页面没有 INIT_STATE 时返回 null', loadStateReader({})(), null);
  eq('[档案] INIT_STATE 为空对象时返回 null', loadStateReader({ INIT_STATE: {} })(), null);
  eq('[档案] 连 window 都没有时不崩、返回 null', loadStateReader(undefined)(), null);

  // 脏数据不许崩
  const dirty = loadStateReader({
    INIT_STATE: {
      // eslint-disable-next-line no-undef
      badNull: null,
      // eslint-disable-next-line no-undef
      badStr: 'x',
      badItem: { feeds: [null, undefined, 3, { photo: null, author: {} }, { photo: { id: null }, author: {} }] },
      weirdTs: { feeds: [{ photo: { id: 'z1', caption: 'c2', timestamp: 'not-a-number' }, author: { id: '', name: '' } }] }
    }
  });
  const dirtyOut = dirty();
  truthy('[档案] 脏数据不崩溃', dirtyOut === null || !!dirtyOut.items.z1);
  if (dirtyOut && dirtyOut.items.z1) {
    eq('[档案] 时间戳不是数字时记 0（不许变成 NaN）', dirtyOut.items.z1.t, 0);
  }

  // —— 9.2 快客户端：毫秒转日期、清洗、缓存 ——
  delete require.cache[require.resolve(KS_CLIENT)];
  const client = require(KS_CLIENT);

  // 选一个正午 UTC 的时刻：无论本机是 UTC 还是 UTC+8，都落在同一天
  const noonMs = Date.UTC(2026, 9, 16, 12, 0, 0);
  const expectLocal = (() => {
    const d = new Date(noonMs);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate());
  })();
  eq('[快客户端] 毫秒时间戳转成 YYYY/MM/DD', client.dateFromTimestamp(noonMs), expectLocal);
  eq('[快客户端] 非法时间戳返回空串', client.dateFromTimestamp(0), '');
  eq('[快客户端] 非数字时间戳返回空串', client.dateFromTimestamp('x'), '');
  eq('[快客户端] 文案尾部「展开」要去掉', client.cleanCaption('你好世界 展开'), '你好世界');
  eq('[快客户端] 昵称开头的 @ 要去掉', client.cleanNickname('@黑蛇'), '黑蛇');

  // 走一遍 sendMessage：一整批只发一次
  let calls = 0;
  const prevChrome = global.chrome;
  global.chrome = {
    runtime: {
      sendMessage: () => {
        calls += 1;
        return Promise.resolve({ ok: true, feeds: { count: 2, items: { AAA: { t: noonMs, c: '文案A', n: '@作者A', a: 'uidA' }, BBB: { t: noonMs, c: '文案B', n: '作者B', a: 'uidB' } } } });
      }
    }
  };
  client.resetCache();

  const metaA = client.getMeta('AAA');
  const metaB = client.getMeta('BBB');
  // 两个请求是在同一 tick 发出的 → 应该合并成一次注入
  return Promise.all([metaA, metaB]).then(async ([a, b]) => {
    eq('[快客户端] 第一次 iOS 注入后能取到第 1 条', a && a.date, expectLocal);
    eq('[快客户端] 能取到第 2 条（同一批不用重发）', b && b.caption, '文案B');
    eq('[快客户端] 作者昵称去掉 @', a && a.nickname, '作者A');
    eq('[快客户端] 作者主页按内部 ID 拼出', a && a.homepage, 'https://www.kuaishou.com/profile/uidA');
    eq('[快客户端] 同一批并发两个请求只注入一次', calls, 1);

    // 缓存命中不再注入
    const cached = await client.getMeta('AAA');
    truthy('[快客户端] 第二次取同一条命中缓存', !!cached);
    eq('[快客户端] 命中缓存不再发消息', calls, 1);

    // 失败不缓存：后台报错后还能重试
    client.resetCache();
    global.chrome = { runtime: { sendMessage: () => Promise.resolve({ ok: false, feeds: null }) } };
    const failed = await client.getMeta('AAA');
    eq('[快客户端] 后台拿不到时返回 null（不打扰提取）', failed, null);
    const retried = await client.getMeta('AAA');
    eq('[快客户端] 失败不写缓存，下次还会重试', retried, null);

    global.chrome = prevChrome;
    await section9Extractor(client, noonMs, expectLocal);
  }).catch((e) => {
    bad('第九节异步分支自身出错', String(e && e.message));
  });
}

/**
 * 9.3 提取器接线：档案只在老办法取空时补位，绝不改动现有输出
 */
async function section9Extractor(client, noonMs, expectLocal) {
  const vm = require('vm');
  const IMMERSIVE_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/extractors/kuaishou-immersive.js');

  const sandbox = {
    console,
    window: {},
    BaseExtractor: class { constructor() { this.siteName = ''; } },
    ClipMateLog: { debug() {}, warn() {}, info() {}, error() {} },
    AuthorIdFetcher: { dedupe: () => Promise.resolve(''), extract: () => Promise.resolve('') },
    SocialTitleProcessor: {}, SocialFieldsBuilder: {}, CacheKeyManager: {},
    KuaishouImmersiveContext: {
      immersiveContext: () => sandbox.__ctx
    },
    KuaishouStateClient: {
      getMeta: async () => sandbox.__state
    }
  };
  sandbox.window.BaseExtractor = sandbox.BaseExtractor;
  const ctxObj = vm.createContext(sandbox);
  try {
    vm.runInContext(fs.readFileSync(SOCIAL_PATH, 'utf8'), ctxObj, { filename: 'kuaishou-social.js' });
    vm.runInContext(fs.readFileSync(IMMERSIVE_PATH, 'utf8'), ctxObj, { filename: 'kuaishou-immersive.js' });
  } catch (e) {
    bad('第九节能把提取器塞进沙箱', String(e && e.message).slice(0, 140));
    return;
  }
  const Immersive = sandbox.window.KuaishouImmersiveExtractor;
  if (!Immersive) { bad('第九节取得到 KuaishouImmersiveExtractor', '未定义'); return; }

  // 场景一：老办法 && 档案都有值 → **必须用老办法的值**（这是「不改输出」的钉子）
  sandbox.__ctx = {
    id: '3xd6gbdievjweyw',
    homepage: 'https://www.kuaishou.com/profile/3xzthwmvysfgeni',
    nickname: '大帅影视',
    date: '2026/10/23',
    caption: '没有足够的胆识怎么出来混？'
  };
  sandbox.__state = { date: '1999/01/01', caption: '档案里的另一个文案', nickname: '档案作者', homepage: 'https://www.kuaishou.com/profile/nope' };

  let inst = new Immersive();
  await inst._primeState();
  eq('[接线] 老办法有值时昵称照旧（不被档案覆盖）', inst.extractAuthorName(), '大帅影视');
  eq('[接线] 老办法有值时日期照旧', inst.extractPublishDate(), '2026/10/23');
  eq('[接线] 老办法有值时文案照旧', inst.extractDescription(), '没有足够的胆识怎么出来混？');
  eq('[接线] 老办法有值时主页照旧', inst.extractAuthorHomepage(), 'https://www.kuaishou.com/profile/3xzthwmvysfgeni');
  eq('[接线] URL 仍由作品 ID 拼出', inst.extractUrl(), 'https://www.kuaishou.com/short-video/3xd6gbdievjweyw');

  // 场景二：老办法全空（CDN 地址规则变了）→ 档案补位
  sandbox.__ctx = { id: '3xd6gbdievjweyw', homepage: '', nickname: '', date: '', caption: '' };
  sandbox.__state = { date: expectLocal, caption: '档案里的文案', nickname: '档案作者', homepage: 'https://www.kuaishou.com/profile/3xzthwmvysfgeni' };

  inst = new Immersive();
  await inst._primeState();
  eq('[接线] 老办法空时日期由档案补上', inst.extractPublishDate(), expectLocal);
  eq('[接线] 老办法空时文案由档案补上', inst.extractDescription(), '档案里的文案');
  eq('[接线] 老办法空时昵称由档案补上', inst.extractAuthorName(), '档案作者');
  eq('[接线] 老办法空时主页由档案补上', inst.extractAuthorHomepage(), 'https://www.kuaishou.com/profile/3xzthwmvysfgeni');

  // 场景三：档案也拿不到 → 不抛、安静留空
  sandbox.__ctx = { id: '3xd6gbdievjweyw', homepage: '', nickname: '', date: '', caption: '' };
  sandbox.__state = null;
  inst = new Immersive();
  await inst._primeState();
  eq('[接线] 档案拿不到时不抛、日期留空', inst.extractPublishDate(), '');
  eq('[接线] 档案拿不到时文案留空', inst.extractDescription(), '');

  // 场景四：认不出是哪一条（ctx 为 null）→ 完全按父类老行为，不谈档案
  sandbox.__ctx = null;
  sandbox.__state = { date: expectLocal, caption: 'x', nickname: 'y', homepage: 'z' };
  inst = new Immersive();
  await inst._primeState();
  eq('[接线] 认不出当前条时 URL 为空（不拿档案硬凑）', inst.extractUrl(), '');

  // 场景五：KuaishouStateClient 整个不存在（脚本没加载）→ 不许崩
  const sandbox2 = {
    console,
    window: {},
    BaseExtractor: sandbox.BaseExtractor,
    ClipMateLog: sandbox.ClipMateLog,
    AuthorIdFetcher: sandbox.AuthorIdFetcher,
    SocialTitleProcessor: {}, SocialFieldsBuilder: {}, CacheKeyManager: {},
    KuaishouImmersiveContext: { immersiveContext: () => ({ id: 'x1', homepage: '', nickname: '', date: '', caption: '' }) }
  };
  sandbox2.window.BaseExtractor = sandbox2.BaseExtractor;
  const ctx2 = vm.createContext(sandbox2);
  vm.runInContext(fs.readFileSync(SOCIAL_PATH, 'utf8'), ctx2, { filename: 'kuaishou-social.js' });
  vm.runInContext(fs.readFileSync(IMMERSIVE_PATH, 'utf8'), ctx2, { filename: 'kuaishou-immersive.js' });
  const inst2 = new sandbox2.window.KuaishouImmersiveExtractor();
  await inst2._primeState();
  eq('[接线] 快客户端不存在时也不崩、日期留空', inst2.extractPublishDate(), '');
}

/* ============== 十、精确到秒的发布时间（v2.5.84） ============== */
const COVER_TIME_PATH = path.resolve(__dirname, '../ClipMate_chrome/src/content/shared/kuaishou-cover-time.js');

function loadCoverTime() {
  delete require.cache[require.resolve(COVER_TIME_PATH)];
  return require(COVER_TIME_PATH);
}

/** 造一个「文件名时间 = 路径日期」的真实形态封面地址 */
function linkedCoverSrc(st) {
  const pad = (n) => String(n).padStart(2, '0');
  const plain = `${st.y}${pad(st.m)}${pad(st.d)}${pad(st.h)}${pad(st.mi)}${pad(st.s)}_4094461426_210988047505_1_3`;
  const b64 = Buffer.from(plain, 'utf8').toString('base64').replace(/=+$/, '');
  return `https://p2.a.yximgs.com/upic/${st.y}/${pad(st.m)}/${pad(st.d)}/${pad(st.h)}/B${b64}_B50798f74ce55fe479a1574cb8ece779a.jpg?clientCacheKey=3xs9ezatr424bpa.jpg`;
}

// 真机原样（同一条作品 3xqcmsz5d55jhz2，推荐流与详情页抓到的串逐字相同）
const REAL_DETAIL_COVER = 'https://p2.a.yximgs.com/upic/2026/10/03/19/BMjAyNjEwMDMxOTU4NDNfNDA5NDQ2MTQyNl8yMTA5ODgwNDc1MDVfMV8z_B50798f74ce55fe479a1574cb8ece779a.jpg?tag=1-1793124133-xpcwebdetail-0-ekcexsxt3x&clientCacheKey=3xqcmsz5d55jhz2.jpg';
const REAL_UHEAD = 'https://p66.a.kwimgs.com/uhead/AB/2026/10/05/01/BMjAyNjEwMDUwMTAxMTFfNDA5NDQ2MTQyNl8xX2hkNDYyXzEyMQ==_s.jpg';

async function section10() {
  section('十、精确到秒的发布时间（v2.5.84）');
  const ct = loadCoverTime();

  // 浏览器里工具挂在 window 上自动可见；node 里要手动放到全局才是同一回事
  global.KuaishouCoverTime = ct;
  try {

  // —— 基本能力 ——
  eq('[秒] 真机原样的详情页封面 → 精确到秒',
    ct.publishDateTimeFromSrc(REAL_DETAIL_COVER), '2026/10/03 19:58:43');
  eq('[秒] 同形态的另一条（夜里）',
    ct.publishDateTimeFromSrc(linkedCoverSrc({ y: 2026, m: 10, d: 15, h: 23, mi: 56, s: 37 })),
    '2026/10/15 23:56:37');
  eq('[秒] 午夜零点也要正确',
    ct.publishDateTimeFromSrc(linkedCoverSrc({ y: 2026, m: 10, d: 4, h: 0, mi: 0, s: 0 })),
    '2026/10/04 00:00:00');
  eq('[秒] 跨年夜 23:59:59',
    ct.publishDateTimeFromSrc(linkedCoverSrc({ y: 2026, m: 12, d: 31, h: 23, mi: 59, s: 59 })),
    '2026/12/31 23:59:59');

  // —— 三条保命规矩 ——
  eq('[规矩1] 头像地址（/uhead/）解出来的是头像上传时间，绝不能用 → 空',
    ct.publishDateTimeFromSrc(REAL_UHEAD), '');
  eq('[规矩1] 完全不带 /upic/ 的地址 → 空',
    ct.publishDateTimeFromSrc('https://p23.a.yximgs.com/s1/i/def/head_u.png'), '');
  eq('[规矩2] 文件名解出的日期与路径对不上 → 宁可只到日',
    ct.publishDateTimeFromSrc(linkedCoverSrc({ y: 2026, m: 10, d: 3, h: 19, mi: 58, s: 43 })
      .replace('/upic/2026/10/03/', '/upic/2026/10/15/')), '2026/10/15');
  eq('[规矩2] 月份非法（解出 13 月）→ 只到日',
    ct.publishDateTimeFromSrc(linkedCoverSrc({ y: 2026, m: 13, d: 3, h: 19, mi: 58, s: 43 })
      .replace('/upic/2026/13/', '/upic/2026/10/').replace(/MjAyNjEz/g, 'MjAyNjEz')), '2026/10/03');
  eq('[规矩3] 文件名不是那套编码（普通 png）→ 回落到到日',
    ct.publishDateTimeFromSrc('https://p23.a.yximgs.com/upic/2026/10/15/14/logo.png'), '2026/10/15');
  eq('[规矩3] 文件名解出来是乱码 → 回落到到日',
    ct.publishDateTimeFromSrc('https://p23.a.yximgs.com/upic/2026/10/15/14/JA4DkZACbHCgkraEDURtcg.jpg'), '2026/10/15');
  eq('[规矩3] 连参数一并传过来也能用（带 tag/clientCacheKey 尾巴）',
    ct.publishDateTimeFromSrc(REAL_DETAIL_COVER + '&bp=14944'), '2026/10/03 19:58:43');

  // —— 不能破坏历史行为 ——
  eq('[回归] 本文件里其它节用的模板封面（文件名时间 ≠ 路径日期）→ 保持原来的到日',
    ct.publishDateTimeFromSrc(coverSrc('3xs9ezatr424bpa', 2026, 10, 15)), '2026/10/15');

  // —— 两个入口必须给出同一个字符串（铁律）——
  const legacyCtx = loadContext(
    pageHtml([slideHtml({ id: '3xs9ezatr424bpa', nick: '黑蛇', text: '人这一生太短', date: '2026/10/15', active: true })]),
    URL_RECO
  );
  eq('[端到端] 模板封面的 context 日期保持到日（不破坏历史）', legacyCtx.api.immersiveContext().date, '2026/10/15');

  // 把封面地址换成「文件名时间与路径同源」的那条，其余 DOM 结构不动
  const linkedCover = linkedCoverSrc({ y: 2026, m: 10, d: 3, h: 19, mi: 58, s: 43 });
  const linkedHtml = pageHtml([slideHtml({ id: '3xs9ezatr424bpa', nick: '软面小包', text: '看个热闹', date: '2026/10/03', active: true })])
    .replace(/https:\/\/p23\.a\.yximgs\.com\/upic\/[^"]+/g, linkedCover);
  const linkedCtx = loadContext(linkedHtml, URL_RECO);
  eq('[端到端] 推荐流 context 能到秒', linkedCtx.api.immersiveContext().date, '2026/10/03 19:58:43');

  // 详情页那条路（KuaishouSocialExtractor._dateFromKuaishouUrl）
  const vm = require('vm');
  function loadSocialInSandbox(withTool) {
    const sb = {
      console,
      window: {},
      BaseExtractor: class { constructor() { this.siteName = ''; } },
      ClipMateLog: { debug() {}, warn() {}, info() {}, error() {} },
      AuthorIdFetcher: { dedupe: () => Promise.resolve(''), extract: () => Promise.resolve('') },
      SocialTitleProcessor: {}, SocialFieldsBuilder: {}, CacheKeyManager: {}
    };
    if (withTool) sb.KuaishouCoverTime = ct;
    sb.window.BaseExtractor = sb.BaseExtractor;
    const c = vm.createContext(sb);
    vm.runInContext(fs.readFileSync(SOCIAL_PATH, 'utf8'), c, { filename: 'kuaishou-social.js' });
    return sb.window.KuaishouSocialExtractor;
  }

  const Soc = loadSocialInSandbox(true);
  truthy('[端到端] 取得到 KuaishouSocialExtractor', !!Soc);
  if (Soc) {
    eq('[铁律] 详情页入口给同一个地址 → 和推荐流同一字符串',
      new Soc()._dateFromKuaishouUrl(REAL_DETAIL_COVER), '2026/10/03 19:58:43');
    eq('[铁律] 详情页入口给模板封面 → 同样只到日，与推荐流一致',
      new Soc()._dateFromKuaishouUrl(coverSrc('3xs9ezatr424bpa', 2026, 10, 15)), '2026/10/15');
  }
  const SocNoTool = loadSocialInSandbox(false);
  if (SocNoTool) {
    eq('[兜底] 工具没加载到时详情页回落到到日',
      new SocNoTool()._dateFromKuaishouUrl(REAL_DETAIL_COVER), '2026/10/03');
  } else {
    bad('[兜底] 无工具环境也能造出提取器', '未定义');
  }
  } finally {
    delete global.KuaishouCoverTime;
  }
}

/* ================================ 主流程 ================================ */

(async () => {
  console.log(`${C.cyan}快手推荐流识别与接线验收（v2.5.83）${C.reset}`);
  section1();
  section2();
  section3();
  section4();
  await section5();
  await section6();
  section7();
  section8();
  await section9();
  await section10();

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
  failures.forEach((f) => console.log(`  - ${f.name}${f.detail ? '：' + f.detail : ''}`));
  process.exit(1);
})().catch((e) => {
  console.error('测试脚本自身出错：', e);
  process.exit(2);
});
