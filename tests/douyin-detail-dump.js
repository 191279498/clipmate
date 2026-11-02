#!/usr/bin/env node
/**
 * 抖音详情页 / 弹窗页「字段原样抓取」真机脚本
 *
 * 用途：改共享代码（日期格式、字段映射、提取器）之前和之后，各跑一遍同样的页面，
 * 把 7 个字段原样 dump 出来做逐字对比。这是「改动前后结果一致」的实证工具，
 * 不是断言工具 —— 它只说事实，不判对错。
 *
 * 为什么不用 curl / 后台 HTTP：抖音按浏览器指纹 + 登录态发内容，命令行拿到的
 * 跟真浏览器完全不是一回事（本项目铁律）。所以这里起真 Chrome、真鼠标点按钮、
 * 真读浮窗里的表格。
 *
 * 用法：
 *   node tests/douyin-detail-dump.js                       # 跑内置 5 个页面
 *   node tests/douyin-detail-dump.js --out=a.json          # 另存 JSON
 *   node tests/douyin-detail-dump.js --urls=<url1>,<url2>  # 只跑指定页面
 *   CLIPMATE_EXT=<目录> node tests/douyin-detail-dump.js   # 指定加载哪个扩展目录（改前/改后对比用）
 *   node tests/douyin-detail-dump.js --headful             # 开窗口看一眼
 *
 * 对比两次结果：
 *   node tests/douyin-detail-dump.js --out=.workbuddy/tmp/before.json   # 用旧目录
 *   node tests/douyin-detail-dump.js --out=.workbuddy/tmp/after.json    # 用新目录
 *   然后逐字段 diff 两个 JSON（只看 fields 段）。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EXT_DIR = process.env.CLIPMATE_EXT || path.join(ROOT, 'ClipMate_chrome');
const PORT = Number(process.env.CLIPMATE_PORT || 9333);
const HEADFUL = process.argv.includes('--headful');

/** 取 `--key=值` 的值。注意不能用 split('=')[1] —— URL 里本身就带等号（?modal_id=…）会被截断。 */
function arg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}
const OUT = arg('--out=');
const URLS_ARG = arg('--urls=');
// --profile 必须解析成绝对路径：--user-data-dir 传相对路径 Chrome 会拒绝启动
const PROFILE = path.resolve(ROOT, arg('--profile=') || '.workbuddy/tmp/douyin-dump-profile');

const C = {
  reset: '\x1b[0m', gray: '\x1b[90m', red: '\x1b[31m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m'
};

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('找不到 Chrome/Edge 可执行文件');
  process.exit(2);
}

/* ------------------------------ 内置页面清单 ------------------------------ */
/* 2 个详情页来自存档（能跟快照直接对账），另外 3 个来自弹窗样本里的作品 ID，
 * 直接拼成详情页地址，正好覆盖「视频 / 图文」两类。
 */
const PAGES = URLS_ARG
  ? URLS_ARG.split(',').map((u) => ({ label: u.trim(), url: u.trim() }))
  : [
      { label: '视频详情页 A（存档）', url: 'https://www.douyin.com/video/7411950642865917225', kind: 'video' },
      { label: '视频详情页 B（弹窗样本转详情）', url: 'https://www.douyin.com/video/7672265848853220618', kind: 'video' },
      { label: '视频详情页 C（弹窗样本转详情）', url: 'https://www.douyin.com/video/7496043889296559386', kind: 'video' },
      { label: '图文详情页 A（存档）', url: 'https://www.douyin.com/note/7516480886684568891', kind: 'note' },
      { label: '精选流弹窗（图文，有 fiber 时间戳）', url: 'https://www.douyin.com/jingxuan?modal_id=7516480886684568891', kind: 'modal' },
      { label: '用户主页弹窗（视频，有 fiber 时间戳）', url: 'https://www.douyin.com/user/MS4wLjABAAAA-hAqMwU4p1xu2AlQSM4R38D7DhTKGOk6d-zYU_o0LxY?modal_id=7496043889296559386', kind: 'modal' }
    ];

const CORE_FIELDS = ['本页标题', '作者ID', '作者昵称', '作者主页', '发布日期', '本页文案', 'URL'];

/* --------------------------------- 工具 --------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const hrefs = {};
  if (host && host.shadowRoot) {
    [...host.shadowRoot.querySelectorAll('tr')].forEach((tr) => {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (!th || !td) return;
      const k = (th.textContent || '').trim();
      kv[k] = (td.textContent || '').trim();
      const a = td.querySelector('a');
      if (a) hrefs[k] = a.getAttribute('href');
    });
  }
  return JSON.stringify({
    href: location.href,
    docUrl: (performance.getEntriesByType('navigation')[0] || {}).name || '',
    btns: btns.length,
    anchor: b ? b.getAttribute('data-clipmate-anchor') : null,
    floatWin: !!(host && host.getClientRects().length),
    kv: kv,
    hrefs: hrefs
  });
})()`;

async function state(cdp) {
  return cdp.evalJs(PROBE).then((s) => JSON.parse(s || '{}')).catch(() => ({}));
}

const BTN_POS = `(() => {
  const b = document.querySelector('.media-extractor-button');
  if (!b) return JSON.stringify({ ok: false });
  const r = b.getBoundingClientRect();
  return JSON.stringify({ ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2 });
})()`;

async function clickAt(cdp, x, y) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
}

async function navigate(cdp, url) {
  await cdp.send('Page.navigate', { url });
  const deadline = Date.now() + 40000;
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

  const list = await getJson('/json/list');
  const pageTarget = list.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('没有可用的 page 目标');
  const cdp = await openWs(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  return { child, cdp, extId };
}

/* ------------------------------ 单个页面取数 ------------------------------ */

async function dumpPage(cdp, p) {
  console.log(`\n${C.cyan}━━━ ${p.label}${C.reset}`);
  console.log(`${C.gray}${p.url}${C.reset}`);

  const ok = await navigate(cdp, p.url);
  if (!ok) {
    console.log(`  ${C.red}页面没打开${C.reset}`);
    return { label: p.label, url: p.url, ok: false, reason: '页面没打开' };
  }

  // 等按钮出现（弹窗页要 6~9 秒才渲染完）
  let st = {};
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    st = await state(cdp);
    if (st.btns > 0 && !st.floatWin) break;
    if (st.btns > 0 && st.floatWin) break;
    await sleep(1000);
  }

  if (!st.btns) {
    const body = await cdp.evalJs(`document.body ? document.body.innerText.replace(/\\s+/g,' ').slice(0,120) : ''`).catch(() => '');
    console.log(`  ${C.red}45 秒没等到按钮${C.reset}｜地址=${st.href}｜正文=${String(body).slice(0, 60)}`);
    return { label: p.label, url: p.url, ok: false, reason: '没等到按钮', href: st.href, body: body };
  }

  // 真鼠标点按钮
  const pos = JSON.parse(await cdp.evalJs(BTN_POS).catch(() => '{"ok":false}'));
  if (!pos.ok) throw new Error('按钮拿不到坐标');
  await clickAt(cdp, pos.x, pos.y);

  // 等浮窗出表格
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    st = await state(cdp);
    if (st.floatWin && Object.keys(st.kv || {}).length >= 4) break;
  }

  const fields = {};
  CORE_FIELDS.forEach((k) => { fields[k] = st.kv[k] !== undefined ? st.kv[k] : ''; });

  console.log(`  ${C.gray}地址: ${st.href}${C.reset}`);
  console.log(`  ${C.gray}按钮: ${st.btns} 个｜锚点=${st.anchor || '(无)'}｜浮窗=${st.floatWin ? '开着' : '没开'}｜表格 ${Object.keys(st.kv || {}).length} 行${C.reset}`);
  CORE_FIELDS.forEach((k) => {
    const v = String(fields[k] === undefined ? '' : fields[k]);
    console.log(`   ${k.padEnd(6)} = ${v.length > 70 ? v.slice(0, 70) + '…' : v}`);
  });

  return {
    label: p.label,
    kind: p.kind || '',
    url: p.url,
    ok: true,
    href: st.href,
    docUrl: st.docUrl,
    btns: st.btns,
    anchor: st.anchor,
    allKeys: Object.keys(st.kv || {}),
    fields: fields,
    hrefs: st.hrefs || {}
  };
}

/* --------------------------------- main --------------------------------- */

(async () => {
  console.log(`${C.cyan}抖音字段原样抓取（真机）${C.reset}`);
  console.log(`${C.gray}扩展目录：${EXT_DIR}${C.reset}`);
  const ver = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version;
  console.log(`${C.gray}扩展版本：${ver}｜profile：${PROFILE}${C.reset}`);

  const { child, cdp, extId } = await launch();
  console.log(`${C.gray}扩展 ID：${extId}${C.reset}`);

  const results = [];
  try {
    for (const p of PAGES) {
      try {
        results.push(await dumpPage(cdp, p));
      } catch (e) {
        console.log(`  ${C.red}出错：${e.message}${C.reset}`);
        results.push({ label: p.label, url: p.url, ok: false, reason: e.message });
      }
      // 浮窗关掉，免得影响下一页读数
      await cdp.evalJs(`(() => {
        const host = document.querySelector('.media-floating-window');
        const btn = host && host.shadowRoot && host.shadowRoot.querySelector('[class*="close"]');
        if (btn) btn.click();
        const b = document.querySelector('.media-extractor-button');
        if (b) b.click();
        return true;
      })()`).catch(() => {});
      await sleep(600);
    }
  } finally {
    cdp.close();
    child.kill();
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n${C.cyan}========== 汇总 ==========${C.reset}`);
  console.log(`取到字段：${okCount} / ${results.length}`);
  results.filter((r) => !r.ok).forEach((r) => console.log(`  ${C.red}✗${C.reset} ${r.label}：${r.reason}`));

  if (OUT) {
    const p = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ version: ver, ext: EXT_DIR, at: new Date().toISOString(), results }, null, 2), 'utf8');
    console.log(`${C.gray}已写：${p}${C.reset}`);
  }

  process.exit(results.length && okCount === 0 ? 1 : 0);
})().catch((e) => {
  console.error(`${C.red}失败：${e.message}${C.reset}`);
  process.exit(2);
});
