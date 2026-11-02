// 真机手感验证（v2.5.92）：按钮「手抖点击」与「拖动」两条链路
//
// 为什么要有这一步：
//   jsdom 能证明「逻辑分支对不对」（tests/button-manager.test.js），但证明不了
//   CDP 真实鼠标事件链下按钮到底接不接得住。这次改动的两个问题（要点好几次、
//   拖动发黏）只有真事件 + 真样式才有意义，所以专门做一份。
//
// 验的四件事：
//   A. 拖动：位置跟着鼠标走、拖动中只写 transform 不写 left、松手后落位并保存；
//   B. 拖动不误触：拖完不许弹浮窗；
//   C. 手抖点击：按下后偏 2px 再松手，仍然要弹浮窗（旧实现这里必失败）；
//   D. 拖动后立刻点击（同一个位置）：仍然要弹浮窗（旧实现有 100ms 盲区）。
//
// 用法（项目根目录）：
//   node tests/button-gesture-live.js
//   node tests/button-gesture-live.js --only=douban   # 目前只有一个站点
//   node tests/button-gesture-live.js --headful       # 想亲眼看一遍
//   CLIPMATE_EXT=发行包/ClipMate_采媒灵_v2.5.92_chrome node tests/button-gesture-live.js
//
// 判定：全过退出码 0；任一失败退出码 1。
// 注意：本脚本会**改变按钮位置**（拖动 150/120 像素），跑完想复原就手动拖回去，
//       或者在开发者工具里清掉 localStorage 的 clipmate-button-position-* 键。

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = process.env.CLIPMATE_EXT || path.join(ROOT, 'ClipMate_chrome');
const PORT = Number(process.env.CLIPMATE_PORT || 9457);
const HEADFUL = process.argv.includes('--headful');

const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

const PAGE = {
  id: 'douban',
  label: '豆瓣读书',
  url: 'https://book.douban.com/subject/1084336/'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}${extra ? '｜' + extra : ''}`);
  } else {
    fails.push(label);
    console.log(`  ❌ ${label}${extra ? '｜' + extra : ''}`);
  }
}

function getJson(p) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    });
    req.on('error', rej);
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });
}

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
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
      throw new Error('页面脚本出错: ' + String(d || '').slice(0, 160));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  if (!CHROME) throw new Error('找不到 Chrome / Edge，请设置 CHROME_PATH');
  const prof = path.join(os.tmpdir(), 'clipmate-gesture-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank'
  ];
  // 无头下 CDP 的 Input 事件仍会派发，但有些站会按可见性做手脚；调试时用 --headful
  if (!HEADFUL) args.unshift('--headless=new');

  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });

  let ver = null;
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try { ver = await getJson('/json/version'); if (ver) break; } catch (e) { /* 继续等 */ }
  }
  if (!ver) throw new Error('Chrome 没起来（等不到 CDP 端口）');

  const br = await openWs(ver.webSocketDebuggerUrl);
  let extId = '';
  try {
    const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR });
    extId = r && r.id ? r.id : '';
  } catch (e) {
    br.close();
    throw new Error('加载扩展失败: ' + e.message);
  }
  br.close();
  if (!extId) throw new Error('加载扩展没返回 ID');
  console.log(`扩展已加载｜ID = ${extId}｜目录 ${EXT_DIR}\n`);

  await sleep(600);
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page 目标');
  const cdp = await openWs(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  try {
    await cdp.send('Network.enable');
    const major = String((ver.Browser || '').split('/')[1] || '156').split('.')[0];
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8'
    });
  } catch (e) { /* 老版本没有 Network.setUserAgentOverride 就算了 */ }

  return { child, cdp, close: () => { try { cdp.close(); } catch (e) {} try { child.kill(); } catch (e) {} } };
}

/** 等按钮出现并进入可点状态 */
async function waitReady(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'none';
  while (Date.now() < deadline) {
    const st = await cdp.evalJs(`(() => {
      const b = document.querySelector('.media-extractor-button');
      if (!b) return { state: 'none' };
      const r = b.getBoundingClientRect();
      return {
        state: 'ok',
        disabled: !!b.disabled,
        pending: b.classList.contains('pending'),
        hidden: b.style.display === 'none',
        w: r.width, h: r.height,
        x: r.left + r.width / 2, y: r.top + r.height / 2,
        left: r.left, top: r.top
      };
    })()`).catch(() => null);
    if (st && st.state === 'ok') {
      last = JSON.stringify(st);
      if (!st.disabled && !st.pending && st.w > 0 && st.h > 0) return st;
    }
    await sleep(200);
  }
  throw new Error('按钮一直没就绪：' + last);
}

const btnState = (cdp) => cdp.evalJs(`(() => {
  const b = document.querySelector('.media-extractor-button');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return {
    left: r.left, top: r.top,
    inlineLeft: b.style.left, inlineTop: b.style.top,
    transform: b.style.transform,
    dragging: b.classList.contains('dragging')
  };
})()`);

const windowCount = (cdp) => cdp.evalJs(
  `document.querySelectorAll('.media-floating-window').length`
);

async function mouse(cdp, type, x, y, extra) {
  await cdp.send('Input.dispatchMouseEvent', Object.assign({
    type, x, y, button: 'left', clickCount: 1
  }, extra || {}));
}

async function waitWindow(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await windowCount(cdp).catch(() => 0)) return true;
    await sleep(150);
  }
  return false;
}

async function run() {
  const ctx = await launch();
  const { cdp } = ctx;
  try {
    console.log(`站点：${PAGE.label}`);
    await cdp.send('Page.navigate', { url: PAGE.url });
    await sleep(1200);

    let st = await waitReady(cdp, 20000);
    console.log(`  · 按钮就绪：中心 (${Math.round(st.x)},${Math.round(st.y)})`);
    check('初始状态没有浮窗', (await windowCount(cdp)) === 0);

    /* ---------- A. 拖动 ---------- */
    const from = { x: Math.round(st.x), y: Math.round(st.y) };
    const to = { x: from.x - 150, y: from.y + 120 };
    const before = await btnState(cdp);

    await mouse(cdp, 'mousePressed', from.x, from.y, { buttons: 1 });
    // 分 12 步移动，模拟真实拖动的事件流
    let midState = null;
    for (let i = 1; i <= 12; i++) {
      const x = Math.round(from.x + (to.x - from.x) * i / 12);
      const y = Math.round(from.y + (to.y - from.y) * i / 12);
      await mouse(cdp, 'mouseMoved', x, y, { buttons: 1 });
      if (i === 6) {
        await sleep(40);
        midState = await btnState(cdp);
      }
    }
    await sleep(60);
    await mouse(cdp, 'mouseReleased', to.x, to.y, { buttons: 0 });

    const after = await btnState(cdp);
    const movedX = Math.round(after.left - before.left);
    const movedY = Math.round(after.top - before.top);

    check('拖动中按钮进入 dragging 态', !!(midState && midState.dragging), midState ? 'dragging=' + midState.dragging : '没取到中间态');
    check('拖动中只写 transform，不写 left/top',
      !!(midState && midState.transform && !midState.inlineLeft && !midState.inlineTop),
      midState ? `transform=${midState.transform || '(空)'} left=${midState.inlineLeft || '(空)'}` : '');
    check('松手后 transform 清空', after.transform === '', `transform=${after.transform || '(空)'}`);
    check('松手后位置落成 left/top', !!after.inlineLeft && !!after.inlineTop,
      `left=${after.inlineLeft} top=${after.inlineTop}`);
    check('按钮跟着鼠标走了约 (-150,+120)',
      Math.abs(movedX + 150) <= 6 && Math.abs(movedY - 120) <= 6,
      `实际位移 (${movedX},${movedY})`);
    check('拖完不弹浮窗（拖动不误触提取）', (await windowCount(cdp)) === 0);

    /* ---------- B. 拖动后立刻点击 + 手抖 ---------- */
    // 关键：没有等 100ms，按下、偏 2px、松手 —— 旧实现这里必被吞
    const now = await btnState(cdp);
    const cx = Math.round(now.left + (await cdp.evalJs(
      `document.querySelector('.media-extractor-button').offsetWidth`)) / 2);
    const cy = Math.round(now.top + (await cdp.evalJs(
      `document.querySelector('.media-extractor-button').offsetHeight`)) / 2);

    await mouse(cdp, 'mousePressed', cx, cy, { buttons: 1 });
    await mouse(cdp, 'mouseMoved', cx + 2, cy + 1, { buttons: 1 });
    await mouse(cdp, 'mouseReleased', cx + 2, cy + 1, { buttons: 0 });

    const opened = await waitWindow(cdp, 8000);
    check('拖动后立刻点击 + 抖 2px → 仍然弹浮窗', opened,
      opened ? '浮窗已出现' : '8 秒内没等到浮窗');

    if (opened) {
      // 关掉，避免影响后续判断
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(600);
      check('ESC 能关掉浮窗（不影响后续验证）', (await windowCount(cdp)) === 0);
    }

    /* ---------- C. 朴素单击（对照） ---------- */
    const st2 = await waitReady(cdp, 8000);
    await mouse(cdp, 'mousePressed', Math.round(st2.x), Math.round(st2.y), { buttons: 1 });
    await mouse(cdp, 'mouseReleased', Math.round(st2.x), Math.round(st2.y), { buttons: 0 });
    check('朴素单击 → 弹浮窗', await waitWindow(cdp, 8000));

  } finally {
    ctx.close();
  }
}

run()
  .then(() => {
    console.log('');
    if (fails.length) {
      console.log(`结果：${pass} 项通过，${fails.length} 项失败`);
      fails.forEach((f) => console.log('  - ' + f));
      process.exit(1);
    }
    console.log(`结果：全部通过（${pass} 项）`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('\n真机验证中断：' + (e && e.message ? e.message : e));
    process.exit(2);
  });
