#!/usr/bin/env node
/**
 * 抖音「切条后仍只认第一条」回归验收（v2.9.5）
 *
 * 用户报障（2026-11-03）：关注 / 推荐 / 个人主页打开弹层提取后，
 * **只能提取到第一个作品的数据**，之后的都不更新。v2.8.9 时正常。
 *
 * 排查结论：抖音的 `douyin-*.js` 从 v2.8.9 至今**一字节未改**，
 * 所以不是扩展改坏的，是抖音把「切条」的实现换了：
 * 以前整块重建节点（childList 变化），现在**复用同一个节点、只改 class**。
 * 这正好踩中我们两条脆弱假设：
 *
 *   ① watch 的 MutationObserver 只开 `childList` → 只改 class 时一次都收不到
 *      → 上层以为「没换作品」→ 不重新提取 → 浮窗永远是第一条。
 *   ② 状态签名只认「容器里第一个 video-info 的 data-e2e-aweme-id」，
 *      而这个属性是**后填**的，切条瞬间还是上一条 → 签名不变。
 *
 * 本脚本钉住四节：
 *   一、只改 class（不增删节点）的切条，watch 必须回调新作品
 *   二、resolve / getWorkId 在 modal_id 被抹掉后仍认得出当前条
 *   三、就地刷新必须按作品 ID 对账，旧条数据不许顶掉新条
 *   四、反例：软性变化（文案文字、评论数）不许误触发
 *
 * 用法：node tests/douyin-switch-reuse.test.js [--verbose]
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'ClipMate_chrome/src/content/shared/douyin-modal-context.js');
const HANDLER_PATH = path.join(ROOT, 'ClipMate_chrome/src/content/ui/douyin-spa-handler.js');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  cyan: '\u001b[36m', gray: '\u001b[90m'
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
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual) {
  if (actual) ok(name);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const candidates = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of candidates) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom。请设置 NODE_PATH（见 tests/README.md）');
}
const { JSDOM } = loadJsdom();

function loadModule(modPath, html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  delete require.cache[require.resolve(modPath)];
  const prevWindow = global.window;
  global.window = dom.window;
  let api;
  try {
    api = require(modPath);
  } finally {
    global.window = prevWindow;
  }
  return { dom, api, d: dom.window.document, w: dom.window };
}

/* ------------------------------ 页面模板 ------------------------------ */

/** 真机抓到的 class 串（只把 ID 换成占位） */
function realClass(id) {
  return `NhEiLku8 video_${id} sliderVideo dC20kVxI y65SoqsA side-card-typography-scope celP7Xjg Sqo3SkC7 relatedUiA`;
}

/**
 * 弹层页：container 里一条 feed（当前播放的那条）。
 * `INFO_MODE` 决定 info 的 aweme-id 是否「滞后一条」——真机上切条瞬间它还是旧的。
 */
function modalHtml({ id, nick = '作者', desc = '文案', infoId } = {}) {
  const sameId = infoId === undefined ? id : infoId;
  return `<!DOCTYPE html><html><head><title>抖音</title></head><body>
  <div data-e2e="modal-video-container">
    <div data-e2e="feed-video" class="${realClass(id)}">
      <video></video>
      <div data-e2e="video-info" data-e2e-aweme-id="${sameId}">
        <a data-e2e="video-avatar" href="//www.douyin.com/user/u1"></a>
        <span data-e2e="feed-video-nickname">@${nick}</span><span>· 1天前</span>
        <div data-e2e="video-desc">${desc}</div>
      </div>
    </div>
  </div>
  </body></html>`;
}

const ID_A = '7700906375912991603';
const ID_B = '7700622539806520994';
/** 弹层页地址：抖音几秒后会把 modal_id 抹掉，所以这里故意不带 */
const URL_MODAL = 'https://www.douyin.com/jingxuan';

/* ============ 一、只改 class 的切条必须能被感知（核心回归） ============ */

async function section1() {
  section('一、复用节点、只改 class 的切条：watch 必须回调新作品');

  const { api, d } = loadModule(CONTEXT_PATH, modalHtml({ id: ID_A, nick: 'A', desc: 'A 的文案' }), URL_MODAL);
  const events = [];
  const stop = api.watch((e) => events.push(e), { debounceMs: 20 });

  await sleep(60);
  eq('初始认出第一条', events.length && events[0].id, ID_A);

  // 切条：**不增删任何节点**，只改 class 上的 video_<id> 与 info 的 aweme-id
  const feed = d.querySelector('[data-e2e="feed-video"]');
  feed.className = realClass(ID_B);
  d.querySelector('[data-e2e="video-info"]').setAttribute('data-e2e-aweme-id', ID_B);

  await sleep(160);
  const last = events[events.length - 1];
  eq('只改 class → 回调了新作品', last && last.id, ID_B);
  eq('mode 仍是 modal', last && last.mode, 'modal');
  truthy('opened 仍为 true', last && last.opened);
  stop();
}

/* ====== 二、modal_id 被抹掉后，resolve 仍要以「正在播的那条」为准 ====== */

function section2() {
  section('二、modal_id 缺失 + info 滞后：resolve 必须认 class 里的新 ID');

  // info 还是上一条（A），class 已经是 B —— 这就是切条瞬间的真实形态
  const { api, d } = loadModule(
    CONTEXT_PATH,
    modalHtml({ id: ID_B, nick: 'B', desc: 'B 的文案', infoId: ID_A }),
    URL_MODAL
  );
  const ctx = api.resolve(d);
  eq('resolve 认出新条（class 优先）', ctx && ctx.id, ID_B);
  eq('getWorkId 同源', api.getWorkId(d), ID_B);
  eq('mode = modal', ctx && ctx.mode, 'modal');

  // 反例：class 与 info 一致时，行为与改动前完全一样
  const same = loadModule(CONTEXT_PATH, modalHtml({ id: ID_A }), URL_MODAL);
  eq('class/info 一致时仍返回同一条', same.api.getWorkId(same.d), ID_A);
}

/* ========== 三、就地刷新必须按 ID 对账（旧条数据不许顶掉新条） ========== */

function section3() {
  section('三、_refreshDouyinPanel 的 ID 对账');

  const loaded = loadModule(HANDLER_PATH, '<!DOCTYPE html><html><body></body></html>', URL_MODAL);
  // douyin-spa-handler.js 是 `global.DouyinSpaMixin = {...}`，从 window 取
  const mixin = loaded.w.DouyinSpaMixin;
  truthy('拿到 DouyinSpaMixin', !!mixin);
  const host = Object.create(mixin);

  truthy('旧条数据（A）在目标是 B 时被拒', host._douyinDataMatchesTarget({ URL: 'https://www.douyin.com/video/' + ID_A }, ID_B) === false);
  truthy('新条数据（B）在目标是 B 时通过', host._douyinDataMatchesTarget({ URL: 'https://www.douyin.com/video/' + ID_B }, ID_B) === true);
  truthy('目标为空时一律放行（认不出就别拦）', host._douyinDataMatchesTarget({ URL: 'https://www.douyin.com/video/' + ID_A }, '') === true);
  truthy('URL 形态不认识时放行（不误伤）', host._douyinDataMatchesTarget({ URL: 'https://www.douyin.com/user/abc' }, ID_B) === true);
  truthy('图文作品 /note/<id> 同样能对账', host._douyinDataMatchesTarget({ URL: 'https://www.douyin.com/note/' + ID_B }, ID_B) === true);

  // 接线断言：光有方法不算数，_refreshDouyinPanel 必须**真的调用它**。
  // （变异验证发现：只测方法本身时，把调用点改回「只判非空」测试仍然全绿 —— 那是假绿。）
  const src = fs.readFileSync(HANDLER_PATH, 'utf8');
  truthy(
    '就地刷新把「非空」与「ID 对账」用 && 串起来',
    /_isDouyinDataValid\(data\)\s*&&\s*this\._douyinDataMatchesTarget\(data,\s*targetId\)/.test(src)
  );
  truthy(
    '对账目标取自当前作品 ID（_douyinModalId）',
    /var\s+targetId\s*=\s*String\(this\._douyinModalId\s*\|\|\s*''\)/.test(src)
  );
}

/* ================== 四、反例：软性变化不许误触发 ================== */

async function section4() {
  section('四、反例：文案文字变化、评论数变化不许触发重提取');

  const { api, d } = loadModule(CONTEXT_PATH, modalHtml({ id: ID_A }), URL_MODAL);
  const events = [];
  const stop = api.watch((e) => events.push(e), { debounceMs: 20 });
  await sleep(60);
  const before = events.length;

  // 评论数、播放进度这类变化在真机上每秒都在发生，绝不能让它重提取
  d.querySelector('[data-e2e="video-desc"]').textContent = '文案被点赞数刷新的抖动改了一下';
  await sleep(120);
  eq('纯文字变化不触发', events.length, before);

  // class 不变、只加一个与状态无关的 class，也不该被当成换条
  const feed = d.querySelector('[data-e2e="feed-video"]');
  feed.classList.add('hover-active');
  await sleep(120);
  eq('加了无关 class 但 video_<id> 没变 → 不触发', events.length, before);

  stop();
}

(async () => {
  await section1();
  section2();
  section3();
  await section4();

  console.log('');
  if (failures.length) {
    console.log(`${C.red}失败 ${failures.length} 项${C.reset}，通过 ${pass} 项`);
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? '：' + f.detail : ''}`);
    process.exit(1);
  }
  console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
})();
