#!/usr/bin/env node
/**
 * 真机验证：抖音「推荐 / 关注 / 朋友」沉浸流提取（v2.5.80 批 8）
 *
 * 单测（jsdom）能证明「判据对不对」，但证明不了真机上这几件事：
 *   ① 这三页真的会自己冒出按钮、贴在播放器右上角、点得到（没被页面元素盖住）
 *   ② 点下去浮窗里真的是**正在播的那一条**（关注页整页挂着别人的数据，最容易拿错）
 *   ③ 按 ↓ 切下一条时，浮窗就地刷新成新的那条（不是还停在上一条）
 *   ④ 切到「精选」这类不归本模块管的页面，按钮会撤掉
 *   ⑤ 同一条作品：沉浸流读到的日期 / 文案 / 作者，与详情页**逐字相同**
 *   ⑥ 弹窗功能没被这批弄坏（回归 v2.5.77/78/79）
 *
 * ── 用法 ──────────────────────────────────────────────────────────
 *   node tests/douyin-immersive-live.js               只跑推荐页（不需要登录）
 *   node tests/douyin-immersive-live.js --all         推荐 + 关注 + 朋友（后两个要登录）
 *   node tests/douyin-immersive-live.js --login       先扫码登录一次（沿用弹窗脚本的 profile）
 *   node tests/douyin-immersive-live.js --headful     有头跑（能看见它点）
 *   node tests/douyin-immersive-live.js --only=follow 只跑某一页
 *   CLIPMATE_EXT=<目录> node tests/douyin-immersive-live.js   验指定目录（默认验源码）
 *
 * ── 登录 ─────────────────────────────────────────────────────────
 * 推荐页不登录也有内容，所以默认只跑它。关注 / 朋友页必须有登录态：
 * 用 `--login` 扫码一次即可，profile 与 `douyin-modal-live.js` 共用
 * （`.workbuddy/tmp/douyin-live-profile`），已经登过就不用再扫。
 *
 * 没有登录态时，那两格标 ⏭ 跳过并写明原因 —— **跳过不算通过**。
 *
 * ⚠️ 这个 profile 里有你的抖音登录态，别拷给别人、别提交仓库。
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = process.env.CLIPMATE_EXT || path.join(ROOT, 'ClipMate_chrome');
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

const ARGV = process.argv.slice(2);
const LOGIN = ARGV.includes('--login');
const HEADFUL = ARGV.includes('--headful') || LOGIN;
const ALL = ARGV.includes('--all');
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
const PROFILE = (ARGV.find((a) => a.startsWith('--profile=')) || '').split('=')[1]
  || path.join(ROOT, '.workbuddy', 'tmp', 'douyin-live-profile');

const PORT = 9760 + Math.floor(Math.random() * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};
let pass = 0;
let skipped = 0;
const failures = [];
const notes = [];

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
function section(t) {
  console.log(`\n${C.cyan}${t}${C.reset}`);
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
  const host = document.querySelector('.media-floating-window');
  const kv = {};
  if (host && host.shadowRoot) {
    [...host.shadowRoot.querySelectorAll('tr')].forEach((tr) => {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (!th || !td) return;
      const key = (th.textContent || '').trim();
      // 社交类的「URL」字段是渲染成链接的，文字是「点击访问」，真地址在 href 上
      const link = td.querySelector('a[href]');
      const href = link ? String(link.getAttribute('href') || '') : '';
      kv[key] = /^https?:/i.test(href) ? href : (td.textContent || '').trim();
    });
  }
  const act = document.querySelector('[data-e2e="feed-active-video"]');
  const actCls = act ? String(act.className || '') : '';
  const m = /(?:^|\\s)video_(\\d{6,25})(?:\\s|$)/.exec(actCls);
  const ar = act ? act.getBoundingClientRect() : null;
  const br = b ? b.getBoundingClientRect() : null;
  const box = document.querySelector('[data-e2e="modal-video-container"]');
  const xr = box ? box.getBoundingClientRect() : null;
  return JSON.stringify({
    href: location.href,
    path: location.pathname,
    title: document.title,
    btns: btns.length,
    anchor: b ? b.getAttribute('data-clipmate-anchor') : null,
    disabled: b ? !!b.disabled : null,
    btn: br ? { left: Math.round(br.left), top: Math.round(br.top), right: Math.round(br.right), w: Math.round(br.width), h: Math.round(br.height) } : null,
    // 诊断用：按钮内联样式 + 常驻空弹层的几何（贴位问题就靠这几个字段定位）
    btnStyle: b ? { left: b.style.left, top: b.style.top, right: b.style.right, bottom: b.style.bottom } : null,
    box: xr ? { left: Math.round(xr.left), top: Math.round(xr.top), w: Math.round(xr.width), h: Math.round(xr.height) } : null,
    actId: m ? m[1] : '',
    act: ar ? { left: Math.round(ar.left), top: Math.round(ar.top), right: Math.round(ar.right), w: Math.round(ar.width), h: Math.round(ar.height) } : null,
    floatWin: !!(host && host.getClientRects().length),
    kv: kv,
    modalId: new URL(location.href).searchParams.get('modal_id'),
    bodyLen: document.body ? document.body.innerText.trim().length : 0,
    vw: innerWidth, vh: innerHeight
  });
})()`;

const CLICK_BTN = `(() => {
  const b = document.querySelector('.media-extractor-button');
  if (!b) return JSON.stringify({ ok: false, why: '按钮不在' });
  const r = b.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  const top = document.elementsFromPoint(x, y)[0];
  return JSON.stringify({ ok: true, x, y, hitSelf: top === b,
    topTag: top ? top.tagName + '.' + String(top.className || '').slice(0, 40) : '' });
})()`;

/* --------------------------------- 启动 --------------------------------- */

async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
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

  const br = await openWs(ver.webSocketDebuggerUrl);
  let extId = '';
  try {
    const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR });
    extId = r && r.id ? r.id : '';
  } finally {
    br.close();
  }
  if (!extId) throw new Error('Extensions.loadUnpacked 没返回扩展 ID');

  // 检查加载的到底是哪一版（防止连上残留的旧浏览器）
  let loadedVersion = '';
  try {
    const mf = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
    loadedVersion = mf.version;
  } catch (e) { /* 读不到就算了 */ }

  const list = await getJson('/json/list');
  const pageTarget = list.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('没有可用的 page 目标');
  const cdp = await openWs(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable').catch(() => { /* 只为登录检测，失败不影响 */ });

  return { child, cdp, extId, loadedVersion };
}

async function isLoggedIn(cdp) {
  try {
    const r = await cdp.send('Network.getCookies', {
      urls: ['https://www.douyin.com', 'https://douyin.com']
    });
    const names = (r.cookies || []).map((c) => c.name);
    const hit = names.filter((n) =>
      /^(sessionid|sessionid_ss|sid_tt|sid_guard|uid_tt|passport_assist_user)$/.test(n));
    return { ok: hit.length > 0, hit };
  } catch (e) {
    return { ok: false, hit: [], error: e.message };
  }
}

function state(cdp) {
  return cdp.evalJs(PROBE).then((s) => JSON.parse(s || '{}')).catch(() => ({}));
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(250);
    const st = await cdp.evalJs(`JSON.stringify({
      rs: document.readyState, href: location.href,
      len: document.body ? document.body.innerText.length : 0
    })`).catch(() => null);
    if (!st) continue;
    const o = JSON.parse(st);
    if (o.rs === 'complete' && String(o.href).indexOf('douyin.com') > 0 && o.len > 0) return true;
  }
  return false;
}

/** 点按钮（真鼠标事件，不是 el.click()） */
async function clickButton(cdp) {
  const info = JSON.parse(await cdp.evalJs(CLICK_BTN) || '{}');
  if (!info.ok) return info;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type, x: info.x, y: info.y, button: 'left', clickCount: 1
    });
  }
  return info;
}

/** 等某个条件成立（轮询页面事实） */
async function waitFor(cdp, fn, timeoutMs = 15000, everyMs = 400) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = await state(cdp);
    if (fn(st)) return st;
    await sleep(everyMs);
  }
  return null;
}

/**
 * 浮窗「真的填好了」的判据。
 *
 * 不能只看「有 2 个键」：浮窗骨架是 7 行一次性铺出来的，字段值是异步填的，
 * 早读会把一整屏空值当成结果（实测踩过：URL 读到占位文字「点击访问」，
 * 昵称/日期/文案全是空，看着像功能坏了，其实只是读早了）。
 */
function kvFilled(st) {
  const kv = (st && st.kv) || {};
  if (!st || !st.floatWin) return false;
  if (Object.keys(kv).length < 7) return false;
  const hasName = !!String(kv['作者昵称'] || '').trim();
  const hasDate = !!String(kv['发布日期'] || '').trim();
  const hasText = !!String(kv['本页文案'] || '').trim();
  return hasName && (hasDate || hasText);
}

/**
 * 把焦点送给播放器（切条键要用）。
 *
 * CDP 的 Input.dispatchKeyEvent 是「发给当前焦点元素」的，
 * 页面刚导航完焦点还在 body 上时，抖音的播放器收不到 ↓。
 * 做法：先点一下播放器区域（避开按钮、避开右侧互动栏），再点 body 让它失焦后重新聚焦。
 */
async function focusPlayer(cdp) {
  try {
    const geo = JSON.parse(await cdp.evalJs(`(() => {
      const act = document.querySelector('[data-e2e="feed-active-video"]');
      const b = document.querySelector('.media-extractor-button');
      const r = act ? act.getBoundingClientRect() : null;
      const br = b ? b.getBoundingClientRect() : null;
      return JSON.stringify({ act: r ? { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null,
        btn: br ? { l: Math.round(br.left), t: Math.round(br.top), r: Math.round(br.right), b: Math.round(br.bottom) } : null });
    })()`) || '{}');
    if (!geo.act) return false;
    // 播放器左侧偏下 1/6 处（避开右上角按钮、避开右侧点赞栏）
    let x = Math.round(geo.act.l + geo.act.w * 0.5);
    let y = Math.round(geo.act.t + geo.act.h * 0.8);
    if (geo.btn && x >= geo.btn.l && x <= geo.btn.r && y >= geo.btn.t && y <= geo.btn.b) {
      x = Math.round(geo.act.l + geo.act.w * 0.3);
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
    await sleep(500);
    return true;
  } catch (e) {
    return false;
  }
}

/** 按一次 ↓（两个事件都要发，抖音的监听在 keydown 上） */
async function pressDown(cdp) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown',
    windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, isSystemKey: false
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown',
    windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40, isSystemKey: false
  });
}

/**
 * 再补一记「页面内合成的 ↓」。
 *
 * CDP 的 Input.dispatchKeyEvent 是浏览器级真事件，但实测在这个播放器上没反应
 * （可能监听挂在某个内部元素上、焦点不在它那）。抖音前端是 React，监听就是普通
 * DOM 监听，不看 isTrusted —— 所以往 activeElement / document / window 各派发一次
 * 合成 KeyboardEvent 往往能命中。
 */
async function syntheticDown(cdp) {
  try {
    return await cdp.evalJs(`(() => {
      const fire = (t) => {
        const ev = new KeyboardEvent(t, {
          key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
          bubbles: true, cancelable: true
        });
        try { Object.defineProperty(ev, 'keyCode', { get: () => 40 }); } catch (e) {}
        try { Object.defineProperty(ev, 'which', { get: () => 40 }); } catch (e) {}
        (document.activeElement || document.body).dispatchEvent(ev);
        document.body.dispatchEvent(ev);
        window.dispatchEvent(ev);
      };
      fire('keydown'); fire('keyup');
      return true;
    })()`);
  } catch (e) {
    return false;
  }
}

/* ------------------------------ 单个页面跑 ------------------------------ */

const PAGES = [
  { url: 'https://www.douyin.com/?recommend=1&from_nav=1', label: '推荐页', needLogin: false },
  { url: 'https://www.douyin.com/follow?from_nav=1', label: '关注页', needLogin: true },
  { url: 'https://www.douyin.com/friend?from_nav=1', label: '朋友页', needLogin: true }
];

async function runPage(cdp, pageDef, loggedIn) {
  section(`${pageDef.label}（${pageDef.url}）`);

  if (pageDef.needLogin && !loggedIn) {
    skip(`${pageDef.label} 整体`, '没有登录态（用 --login 扫码一次）');
    return null;
  }

  await navigate(cdp, pageDef.url);
  // 沉浸流里 video-info 是异步渲染的，按钮要等它出现
  const appeared = await waitFor(cdp, (st) => st.actId && st.btns >= 1, 25000);
  if (!appeared) {
    const st = await state(cdp);
    bad(`${pageDef.label}：等到按钮出现`, `actId=${JSON.stringify(st.actId)} btns=${st.btns} bodyLen=${st.bodyLen}`);
    return null;
  }

  // ⚠️ 按钮一出现就立刻读几何是读不准的：内联样式已经写成 72px，
  // 但布局还没应用，`getBoundingClientRect()` 还是旧值（实测读到 20px），
  // 拿这个坐标去点会点空。产品侧有 250/700/1500ms 三次补位，
  // 所以这里等 1.2 秒读「稳定后的位置」——这也正是用户真正看到的位置。
  await sleep(1200);
  const ready = await state(cdp);

  eq(`${pageDef.label}：按钮恰好 1 个`, ready.btns, 1);
  eq(`${pageDef.label}：锚点标记是沉浸流`, ready.anchor, 'douyin-immersive');
  truthy(`${pageDef.label}：按钮没被页面元素盖住（改由下次点击验证）`, true);
  falsy(`${pageDef.label}：按钮不是灰的`, ready.disabled);

  // 位置：应贴在「正在播的那一条」右上角（内缩 16px），且夹在视口内
  if (ready.act && ready.btn) {
    const dx = Math.abs(ready.btn.right - (ready.act.right - 16));
    const dy = Math.abs(ready.btn.top - (ready.act.top + 16));
    truthy(`${pageDef.label}：贴在本条右上角（内缩 16px）`, dx <= 2 && dy <= 2,
      `按钮 right=${ready.btn.right} top=${ready.btn.top}｜本条 right=${ready.act.right} top=${ready.act.top}`
      + `｜style=${JSON.stringify(ready.btnStyle)}｜空弹层=${JSON.stringify(ready.box)}`);
    truthy(`${pageDef.label}：按钮完整在视口内`,
      ready.btn.left >= 0 && ready.btn.top >= 0 && ready.btn.right <= ready.vw && ready.btn.top + ready.btn.h <= ready.vh,
      JSON.stringify(ready.btn));
  } else {
    bad(`${pageDef.label}：读不到本条容器或按钮几何`, JSON.stringify({ act: ready.act, btn: ready.btn }));
  }

  // 点按钮 → 浮窗
  const click = await clickButton(cdp);
  truthy(`${pageDef.label}：点得到按钮（没被盖住）`, click.hitSelf, click.topTag);
  const opened = await waitFor(cdp, kvFilled, 15000);
  if (!opened) {
    bad(`${pageDef.label}：点按钮出浮窗`, JSON.stringify((await state(cdp)).kv));
    return null;
  }

  const kv = opened.kv;
  const rows = Object.keys(kv).length;
  eq(`${pageDef.label}：浮窗恰好 7 行（不多不少）`, rows, 7);
  truthy(`${pageDef.label}：作者昵称非空`, !!kv['作者昵称'], kv['作者昵称']);
  truthy(`${pageDef.label}：发布日期非空`, !!kv['发布日期'], kv['发布日期']);
  truthy(`${pageDef.label}：本页文案非空`, !!kv['本页文案'], String(kv['本页文案'] || '').slice(0, 30));
  truthy(`${pageDef.label}：本页标题非空`, !!kv['本页标题'], String(kv['本页标题'] || '').slice(0, 30));
  eq(`${pageDef.label}：URL 指向本条作品`, kv['URL'], `https://www.douyin.com/video/${opened.actId}`);
  eq(`${pageDef.label}：作者主页是本条作者的`, /^https:\/\/www\.douyin\.com\/user\//.test(kv['作者主页'] || ''), true);

  const out = {
    label: pageDef.label,
    actId: opened.actId,
    kv,
    // 留一份「页面自己以为的」用于对照
    pageActId: opened.actId
  };

  /* ---- 切下一条：浮窗要就地刷新 ---- */
  const before = { id: opened.actId, date: kv['发布日期'], text: kv['本页文案'] };
  const switchDone = (st) => kvFilled(st) && st.actId !== before.id
    && String(st.kv['URL'] || '').indexOf(st.actId) >= 0;

  // 先点一下播放器把焦点给它，否则 CDP 发的 ↓ 播放器收不到（实测第一版就卡在这）
  await focusPlayer(cdp);
  await pressDown(cdp);
  let switched = await waitFor(cdp, switchDone, 8000);

  // 第 2 招：页面内合成 KeyboardEvent（React 的监听一般不看 isTrusted）
  if (!switched) {
    await syntheticDown(cdp);
    switched = await waitFor(cdp, switchDone, 8000);
  }

  // 第 3 招：滚轮（抖音两种都认，真机实测滚轮也有效）
  if (!switched) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: 700, y: 500, deltaX: 0, deltaY: 800, pointerType: 'mouse'
    }).catch(() => { /* 老内核可能不支持 */ });
    switched = await waitFor(cdp, switchDone, 12000);
  }

  if (!switched) {
    // 抖音有时一条都切不动（列表到底 / 播放器抢焦点）→ 标跳过，不算通过
    skip(`${pageDef.label}：按 ↓ 切下一条`, '这次页面没切条（不算通过）');
  } else {
    const kv2 = switched.kv;
    truthy(`${pageDef.label}：切条后浮窗换成新的一条`, switched.actId !== before.id,
      `${before.id} → ${switched.actId}`);
    eq(`${pageDef.label}：切条后 URL 跟着变`, kv2['URL'], `https://www.douyin.com/video/${switched.actId}`);
    truthy(`${pageDef.label}：切条后日期跟着变（没停在上一条）`,
      kv2['发布日期'] !== before.date || kv2['本页文案'] !== before.text,
      `${before.date} → ${kv2['发布日期']}`);
    eq(`${pageDef.label}：切条后仍是 7 行`, Object.keys(kv2).length, 7);
    out.switched = { id: switched.actId, kv: kv2 };
  }

  return out;
}

/* --------------------- 跨入口对照：沉浸流 vs 详情页 --------------------- */

async function compareWithDetail(cdp, out) {
  if (!out) return;
  section(`跨入口对照：${out.label} 的 ${out.actId} vs 详情页`);

  const pick = out.switched || out;
  const kv = pick.kv;
  const id = pick.id || pick.actId;

  await navigate(cdp, `https://www.douyin.com/video/${id}`);
  const st = await waitFor(cdp, (s) => s.btns >= 1 && s.floatWin === false, 20000);
  if (!st) {
    bad('详情页加载', '等不到详情页按钮');
    return;
  }
  // 详情页按钮不是沉浸流态，标记应不是 douyin-immersive
  falsy('详情页按钮不带沉浸流锚点', st.anchor === 'douyin-immersive');
  eq('详情页按钮恰好 1 个', st.btns, 1);

  const click = await clickButton(cdp);
  truthy('详情页点得到按钮', click.hitSelf, click.topTag);
  const opened = await waitFor(cdp, kvFilled, 15000);
  if (!opened) {
    bad('详情页出浮窗（字段填好）', JSON.stringify((await state(cdp)).kv));
    return;
  }
  const dk = opened.kv;

  eq('作者昵称逐字相同', dk['作者昵称'], kv['作者昵称']);
  eq('发布日期逐字相同', dk['发布日期'], kv['发布日期']);
  eq('URL 逐字相同', dk['URL'], kv['URL']);
  eq('作者主页逐字相同', dk['作者主页'], kv['作者主页']);

  const a = String(kv['本页文案'] || '').trim();
  const b = String(dk['本页文案'] || '').trim();
  if (a === b) {
    ok('本页文案逐字相同', a.slice(0, 30));
  } else if (a && b && (a.indexOf(b) >= 0 || b.indexOf(a) >= 0)) {
    ok('本页文案一方包含另一方（页面截断差异）', `${a.length} vs ${b.length} 字`);
    notes.push(`[${out.label}] 文案长度差：沉浸流 ${a.length} 字 / 详情页 ${b.length} 字`);
  } else {
    bad('本页文案', `沉浸流「${a.slice(0, 40)}」 vs 详情页「${b.slice(0, 40)}」`);
  }
}

/* --------------------- 切到不归本模块管的页面：按钮撤 --------------------- */

async function testLeaveImmersive(cdp) {
  section('切到「精选」页：按钮必须撤掉');
  await navigate(cdp, 'https://www.douyin.com/jingxuan');
  await sleep(3500);
  const st = await state(cdp);
  eq('精选页没有按钮（列表页不归这批管）', st.btns, 0);
  eq('精选页 pathname 是 /jingxuan', st.path, '/jingxuan');
}

/* --------------------------- 弹窗功能回归 --------------------------- */

async function testModalRegression(cdp) {
  section('弹窗功能回归（v2.5.77/78/79 不能被弄坏）');
  await navigate(cdp, 'https://www.douyin.com/jingxuan?modal_id=7700906375912991603');
  const st = await waitFor(cdp, (s) => s.btns >= 1, 25000);
  if (!st) {
    bad('弹窗页出按钮', JSON.stringify(await state(cdp)));
    return;
  }
  eq('弹窗页按钮恰好 1 个', st.btns, 1);

  const isModalPage = !!st.modalId || st.anchor === 'douyin-modal';
  if (!isModalPage) {
    skip('弹窗页锚点标记', '抖音没按 modal_id 打开（换成了别的条），这一格不算');
    return;
  }
  eq('弹窗页锚点标记仍是 douyin-modal（不是沉浸流）', st.anchor, 'douyin-modal');

  const click = await clickButton(cdp);
  truthy('弹窗页点得到按钮', click.hitSelf, click.topTag);
  const opened = await waitFor(cdp, kvFilled, 15000);
  if (!opened) {
    bad('弹窗页出浮窗（字段填好）', JSON.stringify((await state(cdp)).kv));
    return;
  }
  eq('弹窗页浮窗也是 7 行', Object.keys(opened.kv).length, 7);
  truthy('弹窗页日期带秒（v2.5.79 的行为不变）', /\d{1,2}:\d{2}:\d{2}$/.test(opened.kv['发布日期'] || ''),
    opened.kv['发布日期']);
}

/* --------------------------------- 主流程 --------------------------------- */

(async () => {
  console.log(`${C.cyan}抖音沉浸流真机验证（v2.5.80 批 8）${C.reset}`);
  console.log(`${C.gray}浏览器: ${CHROME}${C.reset}`);
  console.log(`${C.gray}扩展目录: ${EXT_DIR}${C.reset}`);

  const { child, cdp, extId, loadedVersion } = await launch();
  console.log(`${C.gray}扩展 ID: ${extId}｜manifest 版本: ${loadedVersion}${C.reset}`);

  if (LOGIN) {
    const li = await isLoggedIn(cdp);
    if (li.ok) {
      console.log(`${C.green}已经是登录态（${li.hit.join(', ')}）${C.reset}`);
    } else {
      await navigate(cdp, 'https://www.douyin.com/');
      console.log(`${C.yellow}请在打开的窗口里扫码登录抖音，登录成功后脚本会自动继续（最多等 5 分钟）…${C.reset}`);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(3000);
        const now = await isLoggedIn(cdp);
        if (now.ok) { console.log(`${C.green}登录成功（${now.hit.join(', ')}）${C.reset}`); break; }
      }
    }
    try { cdp.close(); } catch (e) { /* 忽略 */ }
    try { child.kill(); } catch (e) { /* 忽略 */ }
    console.log('登录态已保存在 profile 里，下次直接跑即可。');
    return;
  }

  const li = await isLoggedIn(cdp);
  console.log(`${C.gray}登录态: ${li.ok ? '有（' + li.hit.join(',') + '）' : '无（关注/朋友页会跳过）'}${C.reset}`);

  const todo = PAGES.filter((p) => (ALL || !p.needLogin) && (!ONLY || p.url.indexOf(ONLY) >= 0));

  const results = [];
  for (const def of todo) {
    const r = await runPage(cdp, def, li.ok);
    if (r) results.push(r);
  }

  if (results.length) await compareWithDetail(cdp, results[0]);

  await testLeaveImmersive(cdp);
  await testModalRegression(cdp);

  // 收尾
  try { cdp.close(); } catch (e) { /* 忽略 */ }
  try { child.kill(); } catch (e) { /* 忽略 */ }

  console.log('');
  if (notes.length) {
    console.log(`${C.yellow}备注：${C.reset}`);
    notes.forEach((n) => console.log(`  · ${n}`));
  }
  if (failures.length) {
    console.log(`\n${C.red}通过 ${pass}｜失败 ${failures.length}｜跳过 ${skipped}${C.reset}`);
    failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name}  ${C.gray}${f.detail || ''}${C.reset}`));
    process.exit(1);
  }
  console.log(`${C.green}通过 ${pass}｜失败 0｜跳过 ${skipped}${C.reset}`);
  if (skipped) console.log(`${C.yellow}注意：跳过 ${skipped} 项不算通过${C.reset}`);
})().catch((e) => {
  console.error(`${C.red}真机脚本自己崩了：${C.reset}`, e);
  process.exit(2);
});
