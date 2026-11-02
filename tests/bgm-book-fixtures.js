// 番组计划「书籍」搜索能力探针（v2.5.76 前置实测，一次性工具）
//
// 为什么必须在真机 SW 里测：
//   命令行打 api.bgm.tv 时好时坏（2026-10-26 实测：同一分钟内 v0 接口 000、
//   网页端 bgm.tv 200），curl 的结论不可信。扩展里是 **Service Worker** 发的请求，
//   host_permissions 覆盖不覆盖、Cloudflare 放不放行，只有真扩展里跑才知道。
//
// 测什么（这一批的核心问题）：
//   1. 中文书名能不能搜到（历史结论：0 条）
//   2. **日文原名**能不能搜到（用户 2026-10-26 的判断：日文/漫画大概率能）
//   3. 豆瓣「原作名」带卷号（如「鬼滅の刃 1」）时，能不能定位到对应的那一卷
//   4. 返回里有没有作者字段 —— 决定「同名书」能不能校验
//
// 用法：
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/bgm-book-probe.js

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
const PORT = 9300 + Math.floor(Math.random() * 90);

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
  const prof = path.join(os.tmpdir(), 'clipmate-bgmbook-' + Date.now());
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
  return { child, extId, prof };
}

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

// 每个用例都写明「豆瓣上长什么样」，便于把两边的名字对上
const OUT_DIR = path.join(__dirname, 'fixtures', 'json');

const CASES = [
  { kw: '進撃の巨人', file: 'bgm-book-k0975', note: '进击的巨人 原作名' },
  { kw: '鬼滅の刃 1', file: 'bgm-book-kiki1', note: '鬼灭之刃 原作名（带卷号）' },
  { kw: '鬼滅の刃', file: 'bgm-book-kiki', note: '鬼灭之刃 去卷号' },
  { kw: '名探偵コナン 1', file: 'bgm-book-conan1', note: '柯南 原作名（带卷号）' },
  { kw: '名探偵コナン', file: 'bgm-book-conan', note: '柯南 去卷号' },
  { kw: '海贼王', file: 'bgm-book-onepiece-cn', note: '海贼王 豆瓣书名（无原作名）' },
  { kw: 'ONE PIECE', file: 'bgm-book-onepiece-en', note: 'ONE PIECE 兜底' },
  { kw: '三体', file: 'bgm-book-santi', note: '三体 中文原创' },
  { kw: '小王子', file: 'bgm-book-littleprince-cn', note: '小王子 中文名' },
  { kw: 'Le Petit Prince', file: 'bgm-book-littleprince-fr', note: '小王子 原作名' },
  { kw: '灌篮高手', file: 'bgm-book-slamdunk-cn', note: '灌篮高手 中文名' },
  { kw: '灌篮高手31', file: 'bgm-book-slamdunk31', note: '灌篮高手31 带卷号' }
];

(async () => {
  const { child, extId, prof } = await launch();
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

  console.log('\n===== 番组 v0/search/subjects（type=书籍）→ 存档 =====');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const c of CASES) {
    const expr = `(async () => {
      const body = { keyword: ${JSON.stringify(c.kw)}, filter: { type: [1] } };
      try {
        const r = await fetch('https://api.bgm.tv/v0/search/subjects?limit=20', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const txt = await r.text();
        let o = null;
        try { o = JSON.parse(txt); } catch (e) {}
        if (!o) return JSON.stringify({ __status: r.status, __text: txt.slice(0, 200) });
        return JSON.stringify({ __raw: o, __status: r.status });
      } catch (e) {
        return JSON.stringify({ __error: String(e && e.message) });
      }
    })()`;
    const raw = await cdp.evalJs(expr).catch((e) => JSON.stringify({ __error: e.message }));
    let o;
    try { o = JSON.parse(raw); } catch (e) { o = { __error: 'unparsable' }; }
    const file = path.join(OUT_DIR, c.file + '.json');
    if (o.__raw) {
      fs.writeFileSync(file, JSON.stringify(o.__raw, null, 2), 'utf8');
      const items = o.__raw.data || [];
      console.log('  ✓ ' + c.kw.padEnd(16) + ' total=' + String(o.__raw.total).padEnd(6) +
        ' 返回=' + items.length + '  → ' + c.file + '.json');
    } else {
      fs.writeFileSync(file, JSON.stringify(o, null, 2), 'utf8');
      console.log('  ✗ ' + c.kw.padEnd(16) + ' ' + JSON.stringify(o).slice(0, 120));
    }
    await sleep(1500);
  }

  cdp.close();
  child.kill();
  await sleep(500);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) {}
})().catch((e) => {
  console.error('探针失败:', e);
  process.exit(1);
});
