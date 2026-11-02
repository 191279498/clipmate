// 番组「长系列分卷」取法探针（v2.5.76 前置实测）
//
// 问题来源：2026-10-26 离线原型 5/8，《名侦探柯南1》失败 —— 番组 total=1000，
// 第 1 卷排不进前 20 条，光靠搜索拿不到。
//
// 测三条可能的出路：
//   ① GET /v0/subjects/{id}/subjects  —— 先搜到系列主条目，再取它的关联条目（分卷）
//   ② limit 上限与 offset 翻页        —— 能不能靠翻页翻到第 1 卷
//   ③ 搜「名探偵コナン (1)」这种精确写法 —— 直接命中
//
// 用法：CLIPMATE_PROXY=127.0.0.1:7897 node tests/bgm-series-probe.js

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
const PORT = 9200 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 连接失败')); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('脚本出错: ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 300));
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  const prof = path.join(os.tmpdir(), 'clipmate-bgmseries-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--headless=new',
    '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', 'about:blank'
  ];
  if (process.env.CLIPMATE_PROXY) args.unshift(`--proxy-server=http://${process.env.CLIPMATE_PROXY}`);
  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  let ver = null;
  for (let i = 0; i < 60; i++) { try { ver = await getJson('/json/version'); break; } catch (e) { await sleep(250); } }
  if (!ver) throw new Error('Chrome 没起来');
  const br = await openWs(ver.webSocketDebuggerUrl);
  let extId = '';
  try { const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR }); extId = r && r.id; }
  finally { br.close(); }
  return { child, extId, prof };
}

async function findSw(extId) {
  for (let i = 0; i < 40; i++) {
    const targets = await getJson('/json/list').catch(() => []);
    const sw = (targets || []).find((t) => t.type === 'service_worker' && String(t.url).indexOf(extId) !== -1);
    if (sw && sw.webSocketDebuggerUrl) return sw;
    await sleep(300);
  }
  return null;
}

// 在 SW 里跑一段 fetch，返回文本
const runFetch = (cdp, url, opts) =>
  cdp.evalJs(`(async () => {
    try {
      const r = await fetch(${JSON.stringify(url)}, ${JSON.stringify(opts || {})});
      const t = await r.text();
      return JSON.stringify({ status: r.status, len: t.length, body: t.slice(0, 30000) });
    } catch (e) { return JSON.stringify({ error: String(e && e.message) }); }
  })()`).then((raw) => { try { return JSON.parse(raw); } catch (e) { return { error: 'unparsable' }; } });

const postSearch = (cdp, kw, extra) =>
  runFetch(cdp, 'https://api.bgm.tv/v0/search/subjects' + (extra || ''), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword: kw, filter: { type: [1] } })
  });

(async () => {
  const { child, extId, prof } = await launch();
  const sw = await findSw(extId);
  if (!sw) { console.log('❌ 找不到 SW'); child.kill(); process.exit(1); }
  const cdp = await openWs(sw.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable').catch(() => {});
  console.log('扩展 ID:', extId);

  console.log('\n===== ① 关联条目：/v0/subjects/{id}/subjects =====');
  for (const id of [565, 8491]) {
    const r = await runFetch(cdp, 'https://api.bgm.tv/v0/subjects/' + id + '/subjects');
    if (r.error) { console.log('  ' + id + '  ❌ ' + r.error); await sleep(1500); continue; }
    let arr = [];
    try { arr = JSON.parse(r.body); } catch (e) {}
    console.log('  ' + id + '  status=' + r.status + '  条数=' + (Array.isArray(arr) ? arr.length : '非数组'));
    (Array.isArray(arr) ? arr : []).slice(0, 12).forEach((x) =>
      console.log('     - ' + x.id + '  ' + x.name + (x.name_cn ? ' / ' + x.name_cn : '') +
        '  relation=' + (x.relation || '') + '  type=' + (x.type || '')));
    await sleep(1500);
  }

  console.log('\n===== ② limit 上限 =====');
  for (const lim of [25, 50]) {
    const r = await postSearch(cdp, '名探偵コナン', '?limit=' + lim);
    if (r.error) { console.log('  limit=' + lim + '  ❌ ' + r.error); }
    else {
      let o = null; try { o = JSON.parse(r.body); } catch (e) {}
      console.log('  limit=' + lim + '  status=' + r.status + '  data数=' + (o && o.data ? o.data.length : '?') +
        (o && o.data ? '  末条=' + o.data[o.data.length - 1].name : ''));
    }
    await sleep(1500);
  }

  console.log('\n===== ③ offset 翻页找第 1 卷 =====');
  for (const off of [0, 20, 40, 60]) {
    const r = await postSearch(cdp, '名探偵コナン', '?limit=20&offset=' + off);
    if (r.error) { console.log('  offset=' + off + ' ❌ ' + r.error); await sleep(1500); continue; }
    let o = null; try { o = JSON.parse(r.body); } catch (e) {}
    const hit = (o && o.data || []).filter((x) => /\(1\)$|（1）$/.test(x.name));
    console.log('  offset=' + off + '  data数=' + ((o && o.data) || []).length +
      '  含(1)=' + (hit.length ? hit.map((x) => x.id + ':' + x.name).join(',') : '无'));
    await sleep(1500);
  }

  console.log('\n===== ④ 精确写法直接搜 =====');
  for (const kw of ['名探偵コナン (1)', '名探偵コナン 1巻', '名侦探柯南1']) {
    const r = await postSearch(cdp, kw, '?limit=5');
    if (r.error) { console.log('  [' + kw + '] ❌ ' + r.error); await sleep(1500); continue; }
    let o = null; try { o = JSON.parse(r.body); } catch (e) {}
    console.log('  [' + kw + '] total=' + (o && o.total) + '  ' +
      ((o && o.data) || []).slice(0, 3).map((x) => x.id + ':' + x.name).join(' | '));
    await sleep(1500);
  }

  cdp.close(); child.kill(); await sleep(400);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
})().catch((e) => { console.error('探针失败:', e); process.exit(1); });
