// IMDB 反查能力探针（v2.5.75 批 2 前置实测，一次性工具，可复用）
//
// 为什么只能在真机 SW 里测：
//   TMDB 对命令行的请求恒 403（WAF 按浏览器指纹拒绝），curl 结果完全不可信。
//   而这两条链路（IMDb Suggest + TMDB /redirect）在扩展里都是 **Service Worker 发的**，
//   host_permissions 是否覆盖、Cloudflare 是否放行，只有真扩展里跑才知道。
//
// 测什么：
//   1. v3.sg.media-imdb.com 的建议接口在 SW 里通不通（权限没加会 Failed to fetch）
//   2. TMDB /redirect 对候选 tt 号的落地地址 —— 这是「命不命中」的唯一判据
//
// 用法：
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/imdb-reverse-probe.js

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
const PORT = 9400 + Math.floor(Math.random() * 90);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (p) =>
  new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try { res(JSON.parse(d)); } catch (e) { rej(e); }
      });
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
      throw new Error('脚本出错: ' + String(d || '').slice(0, 300));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  const prof = path.join(os.tmpdir(), 'clipmate-imdbprobe-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    '--headless=new',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank'
  ];
  if (process.env.CLIPMATE_PROXY) args.unshift(`--proxy-server=http://${process.env.CLIPMATE_PROXY}`);

  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  let ver = null;
  for (let i = 0; i < 60; i++) {
    try { ver = await getJson('/json/version'); break; } catch (e) { await sleep(250); }
  }
  if (!ver) throw new Error('Chrome 没起来（端口 ' + PORT + '）');

  const br = await openWs(ver.webSocketDebuggerUrl);
  let extId = '';
  try {
    const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR });
    extId = r && r.id ? r.id : '';
  } finally {
    br.close();
  }
  if (!extId) throw new Error('加载扩展没返回 ID');
  return { child, extId };
}

/**
 * 等**我们自己的** Service Worker 目标出现。
 *
 * 踩过的坑（2026-10-26）：只取第一个 type==='service_worker' 会连到别的内置扩展
 * （实测拿到 fign…/service_worker.js，而本次加载的是 knie…），
 * 那个 SW 没有本扩展的 host_permissions，于是每条 fetch 都是 Failed to fetch，
 * 看着像「权限没加成功」，其实是连错进程。必须按扩展 ID 精确匹配。
 */
async function findSw(extId) {
  for (let i = 0; i < 40; i++) {
    const targets = await getJson('/json/list').catch(() => []);
    const sw = (targets || []).find(
      (t) => t.type === 'service_worker' && String(t.url).indexOf(extId) !== -1
    );
    if (sw && sw.webSocketDebuggerUrl) return sw;
    await sleep(300);
  }
  const all = await getJson('/json/list').catch(() => []);
  console.log('没等到我们的 SW，现有目标：');
  (all || []).forEach((t) => console.log('  - ' + t.type + ' ' + t.url));
  return null;
}

const TESTS = [
  { word: '教父', note: '中文名（TMDB 页的「名字」）' },
  { word: 'the godfather', note: '英文原名（TMDB 页的「原作名」）' },
  { word: '兄弟连', note: '剧集中文名' },
  { word: '奥本海默', note: '2023 电影' }
];

const REDIRECT_TESTS = [
  ['tt0068646', '教父 → 期望落在 movie/238'],
  ['tt0086066', 'The Outsiders → 期望落在别的 movie（证明错候选会被拦下）'],
  ['tt0111161', '肖申克 → 期望 movie/278'],
  ['tt0185906', '兄弟连 → 期望 tv/4613'],
  ['tt0000000', '不存在的号 → 期望原地不动'],
  ['tt0069792', 'Black Caesar → 期望落在别的 movie']
];

(async () => {
  const { child, extId } = await launch();
  console.log('扩展 ID:', extId);
  const sw = await findSw(extId);
  if (!sw) {
    console.log('❌ 找不到 Service Worker 目标');
    child.kill();
    process.exit(1);
  }
  console.log('SW 目标:', sw.url);

  const cdp = await openWs(sw.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable').catch(() => {});

  console.log('\n===== ① IMDb Suggest（SW 内）=====');
  for (const t of TESTS) {
    const expr = `(async () => {
      const url = 'https://v3.sg.media-imdb.com/suggestion/x/' + encodeURIComponent(${JSON.stringify(t.word)}) + '.json';
      try {
        const r = await fetch(url);
        const txt = await r.text();
        let list = [];
        try { list = (JSON.parse(txt).d) || []; } catch (e) {}
        return JSON.stringify({
          status: r.status,
          count: list.length,
          top: list.slice(0, 5).map((x) => ({ id: x.id, l: x.l, qid: x.qid, y: x.y }))
        });
      } catch (e) {
        return JSON.stringify({ error: String(e && e.message) });
      }
    })()`;
    const raw = await cdp.evalJs(expr).catch((e) => JSON.stringify({ error: e.message }));
    let o;
    try { o = JSON.parse(raw); } catch (e) { o = { raw }; }
    console.log('\n[' + t.word + '] ' + t.note);
    console.log('  ' + JSON.stringify(o));
  }

  console.log('\n===== ② TMDB /redirect 落地地址（SW 内）=====');
  for (const [tt, note] of REDIRECT_TESTS) {
    const expr = `(async () => {
      const url = 'https://www.themoviedb.org/redirect?external_source=imdb_id&external_id=' + ${JSON.stringify(tt)};
      try {
        const r = await fetch(url);
        return JSON.stringify({ ok: r.ok, status: r.status, finalUrl: r.url });
      } catch (e) {
        return JSON.stringify({ error: String(e && e.message) });
      }
    })()`;
    const raw = await cdp.evalJs(expr).catch((e) => JSON.stringify({ error: e.message }));
    let o;
    try { o = JSON.parse(raw); } catch (e) { o = { raw }; }
    console.log('\n' + tt + '  // ' + note);
    console.log('  ' + JSON.stringify(o));
  }

  cdp.close();
  child.kill();
  await sleep(500);
  try { fs.rmSync(path.dirname(path.dirname(sw.url)), { recursive: true, force: true }); } catch (e) {}
})().catch((e) => {
  console.error('探针失败:', e);
  process.exit(1);
});
