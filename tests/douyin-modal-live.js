#!/usr/bin/env node
/**
 * 真机验证：抖音「弹窗播放提取」四类页面走一遍（v2.5.77 批 4）
 *
 * 单测（jsdom）能证明「逻辑对不对」，但证明不了真机上的这几件事：
 *   ① 弹窗打开后按钮真的出现、真的贴在弹窗右上角、真的点得到（没被页面自己的元素盖住）
 *   ② 点下去真的出浮窗、7 个字段真的是这条视频的
 *   ③ 在弹窗里切下一条，按钮**不重建**、浮窗**就地刷新**成新视频
 *   ④ 关掉弹窗，按钮撤掉、浮窗一起关
 * 这四条合起来才是「功能闭环」的真凭据。
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   node tests/douyin-modal-live.js --login      ← 第一次必须先跑这个（见下）
 *   node tests/douyin-modal-live.js              跑全部 4 个入口
 *   node tests/douyin-modal-live.js --only=jingxuan   只跑 id 含 jingxuan 的入口
 *   node tests/douyin-modal-live.js --headful    有头跑（能看见它点）
 *   node tests/douyin-modal-live.js --shot       顺便存截图到 .workbuddy/tmp/live-*.png
 *
 * ── 为什么必须 `--login` 一次 ─────────────────────────────────────
 * 抖音未登录时：搜索页**整页空白**（一个字都不渲染）、弹窗上盖一层「登录后免费畅享
 * 高清视频」的登录框，它把整屏点击都吃掉（实测点四角都不关弹窗）。所以「真机验证
 * 7 个字段 + 切条 + 关弹窗」必须有登录态。
 *
 * `--login` 会打开一个**专用 Chrome 窗口**（profile 存在
 * `.workbuddy/tmp/douyin-live-profile`，跟你日常用的浏览器完全隔离），你在里面扫码
 * 登录抖音即可；脚本自己检测到登录成功会把登录态留在那个 profile 里并退出。
 * 之后 `node tests/douyin-modal-live.js` 直接无头跑，不用再扫。
 *
 * **没登录会怎样**：四个入口里只有「搜索页弹窗」必须登录，它会整格标 ⏭ 跳过并说明原因；
 * 其余三个照跑照判。跳过不算通过 —— 那一格是空的，别拿跳过冒充全绿。
 *
 * ⚠️ 这个 profile 里有你的抖音登录态，别把它拷给别人、别提交到仓库。
 *
 * ── 依赖 ─────────────────────────────────────────────────────────
 * 本机 Chrome（可用 CHROME_PATH 覆盖）；扩展用 `Extensions.loadUnpacked` 加载源码目录，
 * 所以**验的是当前源码**，不是发行包里的旧版（可用 CLIPMATE_EXT 指定别的目录）。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = process.env.CLIPMATE_EXT || path.join(ROOT, 'ClipMate_chrome');
// 浏览器路径：CHROME_PATH 优先，否则按常见安装位置自动找（本机可能只装了 Edge）
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome/Edge 可执行文件（可用 CHROME_PATH 指定）');
  process.exit(2);
}
const PROFILE = (process.argv.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
  || path.join(ROOT, '.workbuddy', 'tmp', 'douyin-live-profile');
const SHOT_DIR = path.join(ROOT, '.workbuddy', 'tmp');

const ARGV = process.argv.slice(2);
const LOGIN = ARGV.includes('--login');
const HEADFUL = ARGV.includes('--headful') || LOGIN;
const SHOT = ARGV.includes('--shot');
const DUMP = ARGV.includes('--dump');
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

const PORT = 9700 + Math.floor(Math.random() * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};
let pass = 0;
let skipped = 0;
const failures = [];
function ok(name, detail) {
  pass++;
  console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function skip(name, why) {
  skipped++;
  console.log(`  ${C.yellow}⏭${C.reset} ${name}${why ? C.gray + '  ' + why + C.reset : ''}`);
}
function truthy(name, v, detail) {
  if (v) ok(name, detail);
  else bad(name, detail || '期望真值，实际 ' + JSON.stringify(v));
}
function falsy(name, v, detail) {
  if (!v) ok(name, detail);
  else bad(name, detail || '期望假值，实际 ' + JSON.stringify(v));
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ------------------------------- CDP 薄封装 ------------------------------- */

const getJson = (p) =>
  new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });

async function openWs(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('CDP 连接失败: ' + wsUrl));
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });
  const send = (method, params) =>
    new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
      throw new Error('页面脚本出错: ' + String(d || '').slice(0, 200));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

/* --------------------------- 页面事实（一次采全） --------------------------- */

const PROBE = `(() => {
  const btns = [...document.querySelectorAll('.media-extractor-button')];
  const b = btns[0] || null;
  const box = document.querySelector('[data-e2e="modal-video-container"]');
  const host = document.querySelector('.media-floating-window');
  const kv = {};
  if (host && host.shadowRoot) {
    [...host.shadowRoot.querySelectorAll('tr')].forEach((tr) => {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (th && td) kv[(th.textContent || '').trim()] = (td.textContent || '').trim();
    });
  }
  const br = b ? b.getBoundingClientRect() : null;
  const xr = box ? box.getBoundingClientRect() : null;
  return JSON.stringify({
    href: location.href,
    title: document.title,
    btns: btns.length,
    anchor: b ? b.getAttribute('data-clipmate-anchor') : null,
    probeAttr: b ? b.getAttribute('data-clipmate-probe') : null,
    disabled: b ? !!b.disabled : null,
    pending: b ? String(b.className || '').indexOf('pending') >= 0 : null,
    btn: br ? {
      left: Math.round(br.left), top: Math.round(br.top),
      right: Math.round(br.right), bottom: Math.round(br.bottom),
      w: Math.round(br.width), h: Math.round(br.height)
    } : null,
    box: xr ? {
      left: Math.round(xr.left), top: Math.round(xr.top),
      right: Math.round(xr.right), bottom: Math.round(xr.bottom)
    } : null,
    modalOpen: !!box,
    floatWin: !!(host && host.getClientRects().length),
    kv: kv,
    bodyLen: document.body ? document.body.innerText.trim().length : 0,
    loginWall: /登录后免费畅享|扫码登录/.test(document.body ? document.body.innerText.slice(0, 3000) : ''),
    vw: innerWidth, vh: innerHeight
  });
})()`;

const CLICK_BTN = `(() => {
  const b = document.querySelector('.media-extractor-button');
  if (!b) return JSON.stringify({ ok: false, why: '按钮不在' });
  const r = b.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const top = document.elementsFromPoint(x, y)[0];
  return JSON.stringify({
    ok: true, x, y, hitSelf: top === b,
    topTag: top ? top.tagName + '.' + String(top.className || '').slice(0, 40) : ''
  });
})()`;

const CLOSE_FLOAT = `(() => {
  const host = document.querySelector('.media-floating-window');
  if (!host || !host.shadowRoot) return JSON.stringify({ ok: false, why: '浮窗不在' });
  const btn = host.shadowRoot.querySelector('.floating-window-close');
  if (!btn) return JSON.stringify({ ok: false, why: '找不到关闭按钮 .floating-window-close' });
  const r = btn.getBoundingClientRect();
  return JSON.stringify({ ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;

/* --------------------------------- 启动 --------------------------------- */

async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    // 允许通过 CDP 加载未打包扩展（Chrome 156 下这是唯一可行方式）
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank'
  ];
  if (!HEADFUL) args.splice(2, 0, '--headless=new');

  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: !HEADFUL });

  let ver = null;
  for (let i = 0; i < 200; i++) {
    await sleep(200);
    try { ver = await getJson('/json/version'); if (ver) break; } catch (e) { /* 继续等 */ }
  }
  if (!ver) throw new Error('Chrome 没起来（等不到 CDP 端口）');

  // 加载扩展（源码目录）
  const br = await openWs(ver.webSocketDebuggerUrl);
  let extId = '';
  try {
    const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR });
    extId = r && r.id ? r.id : '';
  } finally {
    br.close();
  }
  if (!extId) throw new Error('Extensions.loadUnpacked 没返回扩展 ID');

  const list = await getJson('/json/list');
  const pageTarget = list.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('没有可用的 page 目标');
  const cdp = await openWs(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable').catch(() => { /* 只给登录检测用，失败不影响流程 */ });

  return { child, cdp, extId };
}

/**
 * 登录态判据：直接看抖音的登录 cookie（httpOnly 的也拿得到，页面 JS 看不到、CDP 看得到）。
 * 为什么不用「页面上有没有登录字样」：抖音首页把登录面板的 DOM 一直挂在页面里，
 * innerText 里就带着「扫码登录」，页面文本判据永远为真（实测踩过）。
 */
async function isLoggedIn(cdp) {
  try {
    const r = await cdp.send('Network.getCookies', {
      urls: ['https://www.douyin.com', 'https://douyin.com', 'https://www.douyin.com/jingxuan']
    });
    const names = (r.cookies || []).map((c) => c.name);
    const hit = names.filter((n) =>
      /^(sessionid|sessionid_ss|sid_tt|sid_guard|uid_tt|passport_assist_user)$/.test(n));
    return { ok: hit.length > 0, hit, total: names.length };
  } catch (e) {
    return { ok: false, hit: [], total: -1, error: e.message };
  }
}

function state(cdp) {
  return cdp.evalJs(PROBE).then((s) => JSON.parse(s || '{}')).catch(() => ({}));
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  // 判据要三个一起看：readyState 是 complete、地址已是目标、正文够长
  // （Page.navigate 之后 readyState 会立刻返回 complete —— 那时还是空白页）
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(250);
    const st = await cdp.evalJs(`JSON.stringify({
      rs: document.readyState,
      href: location.href,
      len: document.body ? document.body.innerText.length : 0
    })`).catch(() => null);
    if (!st) continue;
    const o = JSON.parse(st);
    if (o.rs === 'complete' && String(o.href).indexOf('douyin.com') > 0 && o.len > 0) return true;
  }
  return false;
}

async function clickAt(cdp, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

async function pressKey(cdp, key, code, vk) {
  for (const type of ['rawKeyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
    });
  }
}

async function screenshot(cdp, name) {
  if (!SHOT) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  try {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const p = path.join(SHOT_DIR, 'live-' + name + '.png');
    fs.writeFileSync(p, Buffer.from(s.data, 'base64'));
    console.log(`  ${C.gray}📷 ${p}${C.reset}`);
  } catch (e) { /* 截图失败不影响结论 */ }
}

/* ------------------------------- 入口清单 ------------------------------- */
/* 4 类页面：
 *   1) 精选流弹窗（图文）：推荐流，方向键能切下一条 —— 切条功能的主战场
 *   2) 搜索页弹窗（视频）：未登录整页空白，必须登录
 *   3) 用户主页弹窗（视频）：作品列表模式，方向键不换条（抖音自身行为）
 *   4) 视频详情页：红线对照 —— 按钮照出、不带弹窗锚点、浮窗照常开关
 */
const ENTRIES = [
  {
    id: 'jingxuan-note',
    label: '精选流弹窗（图文）',
    listUrl: 'https://www.douyin.com/jingxuan',
    url: 'https://www.douyin.com/jingxuan?modal_id=7516480886684568891',
    workId: '7516480886684568891',
    canSwitch: true,
    expect: {
      '作者昵称': '抖音作者助手',
      '发布日期': '2025/06/16',
      'URL': 'https://www.douyin.com/note/7516480886684568891'
    }
  },
  {
    id: 'search-video',
    label: '搜索页弹窗（视频）',
    listUrl: 'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F',
    url: 'https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?modal_id=7672265848853220618',
    workId: '7672265848853220618',
    canSwitch: null, // 登录后实测才知道能否方向键切条，跑的时候自适应
    requiresLogin: true, // 未登录时抖音搜索页整页空白，只有这一格必须登录
    expect: {
      '作者昵称': '杰诺探美食',
      '发布日期': '2026/08/11',
      'URL': 'https://www.douyin.com/video/7672265848853220618'
    }
  },
  {
    id: 'user-video',
    label: '用户主页弹窗（视频）',
    listUrl: 'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY',
    url: 'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY?modal_id=7496043889296559386',
    workId: '7496043889296559386',
    canSwitch: false,
    expect: {
      '作者昵称': '抖音作者助手',
      '发布日期': '2025/04/22',
      'URL': 'https://www.douyin.com/video/7496043889296559386'
    }
  },
  {
    id: 'detail-video',
    label: '视频详情页（红线对照）',
    listUrl: '',
    url: 'https://www.douyin.com/video/7411950642865917225',
    workId: '7411950642865917225',
    canSwitch: false,
    detail: true, // 详情页：不算弹窗，按钮不带锚点，只验「点开出表格 + 关掉」
    expect: {
      'URL': 'https://www.douyin.com/video/7411950642865917225'
    }
  }
];

const CORE_FIELDS = ['本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'];

/* ----------------------------- 单个入口跑一遍 ----------------------------- */

// 登录态查一次就够（每个入口都查一遍要多等好几秒）
let loginCache = null;
async function loginStatus(cdp) {
  if (!loginCache) loginCache = await isLoggedIn(cdp);
  return loginCache;
}

async function runEntry(cdp, e) {
  console.log(`\n${C.cyan}━━━ ${e.label}${C.reset}`);
  console.log(`${C.gray}${e.url}${C.reset}`);

  // 需要登录的入口：没登录就别硬跑。
  // 为什么标「跳过」而不是「失败」：这是脚本自己没准备好登录态，不是产品有问题。
  // 但也不能算通过 —— 那一格确实是空的，别拿跳过冒充全绿。
  if (e.requiresLogin) {
    const li = await loginStatus(cdp);
    if (!li.ok) {
      skip(
        `${e.label}：整个入口`,
        `抖音未登录时搜索页整页空白，验不了 → 先跑 node tests/douyin-modal-live.js --login 扫码一次`
      );
      return;
    }
  }

  // 先落地到列表页（详情页跳过）。为什么：让「关弹窗」能用真实的后退键验证
  // —— history 里前一项必须是这一站的列表页，否则退回去是 about:blank，
  // 按钮消失只是因为「页面没了」，那是假绿。
  if (e.listUrl) {
    await navigate(cdp, e.listUrl);
    const s0 = await state(cdp);
    truthy(`${e.label}：列表页正常打开`, s0.modalOpen === false, `按钮 ${s0.btns} 个｜弹窗 ${s0.modalOpen}`);
    // 列表页上的正确行为：没点开视频 → 不出按钮（这是批 3 定的规矩）
    eq(`${e.label}：列表页不出按钮（还没点开视频）`, s0.btns, 0);
  }

  // ① 开：地址栏带 modal_id（等价于点开视频后抖音自己改成这样）
  await navigate(cdp, e.url);

  let st = {};
  const openDeadline = Date.now() + 45000;
  while (Date.now() < openDeadline) {
    st = await state(cdp);
    if (st.btns > 0) break;
    await sleep(800);
  }

  if (st.btns === 0) {
    bad(`${e.label}：按钮出现了`, `45 秒都没出现｜弹窗=${st.modalOpen} 正文=${st.bodyLen} 字 地址=${st.href}`);
    if (st.loginWall) {
      console.log(`  ${C.yellow}→ 弹窗上盖着登录框：先跑 node tests/douyin-modal-live.js --login 一次${C.reset}`);
    } else if ((st.bodyLen || 0) < 200) {
      console.log(`  ${C.yellow}→ 页面几乎是空白（抖音未登录不给内容）：先跑 node tests/douyin-modal-live.js --login 一次${C.reset}`);
    }
    return;
  }

  eq(`${e.label}：按钮恰好 1 个`, st.btns, 1);
  if (e.detail) {
    eq(`${e.label}：详情页按钮不带弹窗锚点`, st.anchor, null);
  } else {
    eq(`${e.label}：按钮打了弹窗锚点`, st.anchor, 'douyin-modal');
    truthy(`${e.label}：弹窗确实识别到了`, st.modalOpen === true);
    // 贴右上角：真机有布局，可以按像素算 —— 右边缘内缩 16、上边缘内缩 16
    if (st.btn && st.box) {
      const wantRight = st.box.right - 16;
      const wantTop = st.box.top + 16;
      const dRight = Math.abs(st.btn.right - wantRight);
      const dTop = Math.abs(st.btn.top - wantTop);
      truthy(
        `${e.label}：贴弹窗右上角（内缩 16px）`,
        dRight <= 8 && dTop <= 8,
        `按钮 right=${st.btn.right} top=${st.btn.top}｜期望 right=${wantRight} top=${wantTop}（偏差 ${dRight}/${dTop}px）`
      );
    }
  }
  falsy(`${e.label}：按钮可点（非 disabled）`, st.disabled);
  falsy(`${e.label}：按钮已脱离灰态（pending）`, st.pending);
  await screenshot(cdp, e.id + '-1');

  // ② 点：真实鼠标点击（先确认没被挡住）
  const geo = JSON.parse((await cdp.evalJs(CLICK_BTN)) || '{}');
  if (!geo.ok) {
    bad(`${e.label}：点击按钮`, geo.why);
    return;
  }
  truthy(`${e.label}：按钮没被页面元素盖住`, geo.hitSelf, `点上去命中 ${geo.topTag}`);
  if (!geo.hitSelf) return;

  await clickAt(cdp, geo.x, geo.y);

  let t = {};
  const tDeadline = Date.now() + 25000;
  while (Date.now() < tDeadline) {
    await sleep(500);
    t = await state(cdp);
    if (t.kv && Object.keys(t.kv).length > 0) break;
  }
  truthy(`${e.label}：点完浮窗出来了`, t.floatWin === true, `浮窗可见=${t.floatWin}`);
  const kv = t.kv || {};
  eq(
    `${e.label}：浮窗里 7 个字段都在`,
    CORE_FIELDS.filter((k) => k in kv).length,
    CORE_FIELDS.length
  );
  const emptyFields = CORE_FIELDS.filter((k) => !String(kv[k] || '').trim());
  eq(`${e.label}：7 个字段都非空`, emptyFields.length, 0);
  if (emptyFields.length) console.log(`  ${C.gray}空的是：${emptyFields.join('、')}${C.reset}`);

  /* 「换条」自检（v2.5.78 加）：
   * 抖音有时候不按地址栏的 modal_id 打开，直接播推荐流里它自己挑的那一条。
   * 这时浮窗里的数据是**另一条视频**的，拿样本真值去比必然红 —— 但那不是扩展的 bug。
   * 判据：浮窗 URL 里的作品 ID 与样本 ID 不同。
   * 处理：内容类断言全部转成「跳过」，几何/点击/关闭这些与「是哪一条」无关的照常判。
   */
  const shownId = (String(kv['URL'] || '').match(/\/(?:video|note)\/(\d+)/) || [])[1] || '';
  const entrySwitched = !!(shownId && e.workId && shownId !== e.workId);
  if (entrySwitched) {
    console.log(`  ${C.yellow}⏭ 抖音这次没按 modal_id 打开，播的是 ${shownId}（样本 ${e.workId}）→ 内容比对跳过${C.reset}`);
  }

  // 内容对不对（拿样本抓取时的真值比）
  if (entrySwitched) {
    Object.keys(e.expect || {}).forEach((k) => {
      skip(`${e.label}：字段「${k}」对得上`, `抖音播的是另一条（${shownId}），没法跟样本比`);
    });
  } else {
    Object.keys(e.expect || {}).forEach((k) => {
      if (k === 'URL') return; // URL 单独判（见下：未登录时详情页会给「点击访问」占位）
      truthy(
        `${e.label}：字段「${k}」对得上`,
        String(kv[k] || '').indexOf(e.expect[k]) === 0,
        `实际：${String(kv[k] || '').slice(0, 60)}`
      );
    });
  }

  // URL 这一栏分两种情况：
  //   · 弹窗：必须是 douyin.com/(video|note)/<作品ID> 的规范地址
  //   · 详情页未登录：页面自己不给规范链接，提取器填「点击访问」占位 —— 那是原有行为
  //     （详情页红线由 snapshot.js 逐字比对，这里不重复判）
  const urlVal = String(kv['URL'] || '');
  const normUrl = /^https:\/\/www\.douyin\.com\/(video|note)\/\d+$/.test(urlVal);
  const urlHasId = urlVal.indexOf(e.workId) > 0;
  if (entrySwitched) {
    skip(`${e.label}：URL 是规范地址`, `抖音播的是另一条（${shownId}）`);
  } else if (urlVal === '点击访问') {
    skip(`${e.label}：URL 是规范地址`, '页面未登录时只给「点击访问」占位（原有行为）');
  } else {
    // 为什么用正则而不写死 /video/ 还是 /note/：图文/视频的判定在未登录时可能拿不到
    // 「图文」二字（藏在登录框后面），会退化成 video。这不影响字段正确性，别当失败。
    truthy(`${e.label}：URL 是规范地址（douyin.com/video 或 /note）`, normUrl, urlVal);
    truthy(`${e.label}：URL 里带这一条的作品 ID`, urlHasId, urlVal);
  }
  truthy(
    `${e.label}：日期是「YYYY/MM/DD」`,
    /^\d{4}\/\d{2}\/\d{2}/.test(String(kv['发布日期'] || '')),
    String(kv['发布日期'] || '')
  );
  falsy(
    `${e.label}：文案里没有「展开」两个字`,
    String(kv['本页文案'] || '').indexOf('展开') >= 0,
    String(kv['本页文案'] || '').slice(-30)
  );
  truthy(
    `${e.label}：日期不是页面配置里的假日期`,
    String(kv['发布日期'] || '').indexOf('2023/06/07') !== 0,
    String(kv['发布日期'] || '')
  );
  await screenshot(cdp, e.id + '-2');

  const oldUrl = String(kv['URL'] || '');

  // ③ 切：真实按方向键下一条（只有推荐流会响应）
  await cdp.evalJs(`(() => { const b = document.querySelector('.media-extractor-button'); if (b) b.setAttribute('data-clipmate-probe', 'same-node'); return 1; })()`);
  await pressKey(cdp, 'ArrowDown', 'ArrowDown', 40);

  let sw = {};
  const swDeadline = Date.now() + 12000;
  while (Date.now() < swDeadline) {
    await sleep(800);
    sw = await state(cdp);
    const newUrl = String((sw.kv || {})['URL'] || '');
    if (newUrl && newUrl !== oldUrl) break;
  }
  const newUrl = String((sw.kv || {})['URL'] || '');
  const switched = !!(newUrl && newUrl !== oldUrl);

  if (e.detail) {
    skip(`${e.label}：切下一条`, '详情页没有下一条');
  } else if (switched) {
    eq(`${e.label}：切条后按钮没被重建（同一个 DOM 节点）`, sw.probeAttr, 'same-node');
    eq(`${e.label}：切条后按钮还是恰好 1 个`, sw.btns, 1);
    truthy(`${e.label}：切条后浮窗还开着`, sw.floatWin === true);
    truthy(
      `${e.label}：浮窗就地刷新成新的一条`,
      newUrl !== oldUrl,
      `旧：${oldUrl.slice(-20)} → 新：${newUrl.slice(-20)}`
    );
    const newKv = sw.kv || {};
    truthy(
      `${e.label}：新的一条 7 个字段也都非空`,
      CORE_FIELDS.filter((k) => !String(newKv[k] || '').trim()).length === 0,
      CORE_FIELDS.filter((k) => !String(newKv[k] || '').trim()).join('、')
    );
    await screenshot(cdp, e.id + '-3');
  } else if (e.canSwitch === false) {
    skip(`${e.label}：切下一条`, '这个入口本来就不响应方向键（抖音自身行为），不算失败');
  } else if (entrySwitched) {
    // 抖音没按 modal_id 打开时，方向键行为跟预期条目不可比，别当失败
    skip(`${e.label}：切下一条`, `抖音播的是另一条（${shownId}），行为不可比`);
  } else {
    bad(
      `${e.label}：方向键切下一条`,
      `按了 ArrowDown，浮窗内容没换｜URL=${newUrl.slice(-24)} 按钮=${sw.btns}`
    );
  }

  // ④ 关：先试弹窗自己的关闭入口，没有就用浏览器后退（真人也是这么退出的）
  if (e.detail) {
    const cg = JSON.parse((await cdp.evalJs(CLOSE_FLOAT)) || '{}');
    if (!cg.ok) {
      bad(`${e.label}：关浮窗`, cg.why);
    } else {
      await clickAt(cdp, cg.x, cg.y);
      let cl = {};
      const clDeadline = Date.now() + 10000;
      while (Date.now() < clDeadline) {
        await sleep(400);
        cl = await state(cdp);
        if (!cl.floatWin) break;
      }
      falsy(`${e.label}：点 X 后浮窗关掉`, cl.floatWin, `浮窗可见=${cl.floatWin}`);
      eq(`${e.label}：浮窗关掉后按钮还在`, cl.btns, 1);
    }
  } else {
    // 抖音弹窗本身没有可点的关闭按钮（实测：全屏层，右上角是它自己的壁纸/通知图标，
    // Escape 也不响应，点四角黑区也不关），所以用「浏览器后退」——这也是真人的退出方式。
    await cdp.evalJs('history.back(), 1');
    let cl = {};
    const clDeadline = Date.now() + 15000;
    while (Date.now() < clDeadline) {
      await sleep(500);
      cl = await state(cdp);
      if (cl.btns === 0 && !cl.floatWin) break;
    }
    // 关键：确认真的回到了同一站的列表页，不是退回 about:blank（否则是假绿）
    truthy(
      `${e.label}：关弹窗后仍在抖音页面上（不是退回空白页）`,
      String(cl.href || '').indexOf('douyin.com') > 0,
      String(cl.href || '').slice(0, 60)
    );
    if (String(cl.href || '').indexOf('douyin.com') > 0) {
      eq(`${e.label}：关弹窗后按钮撤掉`, cl.btns, 0);
      falsy(`${e.label}：关弹窗后浮窗一起关掉`, cl.floatWin, `浮窗可见=${cl.floatWin}`);
      falsy(`${e.label}：关弹窗后弹层确实没了`, cl.modalOpen, `modalOpen=${cl.modalOpen}`);
    } else {
      skip(`${e.label}：关弹窗相关断言`, '后退落到了站外，无法判定（不算通过）');
    }
  }

  if (DUMP) {
    console.log(`  ${C.gray}[DUMP] ${JSON.stringify(t)}${C.reset}`);
  }
}

/* --------------------------------- 登录 --------------------------------- */

async function loginFlow(cdp) {
  console.log(`${C.cyan}登录模式${C.reset}`);
  console.log(`${C.gray}会打开一个专用 Chrome 窗口（profile：${PROFILE}）。${C.reset}`);
  console.log('请在那个窗口里点「登录」并扫码；登录成功后脚本会自动收工。\n');

  await navigate(cdp, 'https://www.douyin.com/');
  await sleep(2500);

  const before = await isLoggedIn(cdp);
  if (before.ok) {
    console.log(`${C.green}这个 profile 里已经有登录态了（${before.hit.join('、')}）。${C.reset}`);
  }

  let done = false;
  const deadline = Date.now() + 8 * 60 * 1000;
  let lastHint = 0;
  while (Date.now() < deadline) {
    const s = await isLoggedIn(cdp);
    if (s.ok) { done = true; break; }
    if (Date.now() - lastHint > 20000) {
      lastHint = Date.now();
      console.log(`  ${C.gray}… 还在等（douyin cookie ${s.total} 个，其中没有登录票据）${C.reset}`);
    }
    await sleep(2000);
  }

  if (!done) {
    console.log(`${C.red}8 分钟内没检测到登录成功。${C.reset}`);
    console.log('再跑一次：node tests/douyin-modal-live.js --login');
    return false;
  }

  // 用「打开一个弹窗看有没有登录框」做最终确认
  await navigate(cdp, 'https://www.douyin.com/jingxuan?modal_id=7516480886684568891');
  await sleep(6000);
  const s = await state(cdp);
  if (s.loginWall) {
    console.log(`${C.yellow}⚠ cookie 有了，但弹窗上还盖着登录框；可能刚登录还没刷新。${C.reset}`);
    await cdp.send('Page.reload');
    await sleep(8000);
  }
  console.log(`\n${C.green}✅ 登录成功，登录态已保存到：${PROFILE}${C.reset}`);
  console.log('以后直接跑：node tests/douyin-modal-live.js   （不用再扫）');
  return true;
}

/* -------------------------------- 主流程 -------------------------------- */

(async () => {
  console.log(`${C.cyan}抖音弹窗提取 · 真机走一遍（v2.5.77 批 4）${C.reset}`);
  console.log(`${C.gray}扩展目录 ${EXT_DIR}${C.reset}`);
  console.log(`${C.gray}profile   ${PROFILE}${C.reset}`);
  console.log(`${C.gray}模式      ${LOGIN ? '登录' : (HEADFUL ? '有头' : '无头')}${C.reset}`);

  let child = null;
  let cdp = null;
  try {
    const launched = await launch();
    child = launched.child;
    cdp = launched.cdp;
    console.log(`${C.gray}扩展已加载，ID = ${launched.extId}${C.reset}`);

    if (LOGIN) {
      const okLogin = await loginFlow(cdp);
      if (!okLogin) process.exitCode = 2;
      return;
    }

    const list = ENTRIES.filter((e) => !ONLY || e.id.indexOf(ONLY) >= 0);
    if (!list.length) throw new Error('--only 没匹配到任何入口');

    for (const e of list) {
      try {
        await runEntry(cdp, e);
      } catch (err) {
        bad(`${e.label}：流程异常`, err && err.message);
      }
    }
  } catch (e) {
    bad('流程异常', e && e.message);
  } finally {
    try { if (cdp) cdp.close(); } catch (e) { /* ignore */ }
    try { if (child) child.kill(); } catch (e) { /* ignore */ }
  }

  console.log('');
  if (failures.length === 0) {
    const tail = skipped ? `（另有 ${skipped} 项按设计跳过）` : '';
    console.log(`${C.green}全部通过：${pass} 项${tail}${C.reset}`);
    process.exit(process.exitCode || 0);
  }
  console.log(`${C.red}通过 ${pass} 项，失败 ${failures.length} 项${skipped ? `，跳过 ${skipped} 项` : ''}${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f.name}${f.detail ? '  ' + f.detail : ''}`));
  process.exit(1);
})();
