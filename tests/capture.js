// 浏览器抓存档：把需要真浏览器的页面抓成 HTML 存档，喂给 tests/snapshot.js
//
// 为什么需要它：
//   curl 抓不到豆瓣电影（反爬页）、TMDB（403）、Metacritic / 小黑盒 / MobyGames（Cloudflare），
//   所以这些站的快照样本只能靠真浏览器拿。本脚本只负责「打开页面 + 存 HTML」，不跑扩展、不点按钮。
//
// 用法：
//   node tests/capture.js                     抓 capture-targets.json 里所有 enabled 的目标
//   node tests/capture.js --only=douban-movie-1292052,tmdb-movie-278
//   node tests/capture.js --headful           用有头窗口（被 Cloudflare 拦时试这个）
//   node tests/capture.js --list              只列目标，不启动浏览器
//
// 抓不到怎么办：
//   - 报「反爬/挑战页」→ 加 --headful 再试一次；仍不行就是这个站只接受真人，人工另存页面到 tests/fixtures/html/
//   - 报「超时」→ 检查代理 127.0.0.1:7897 是否在跑（该目标若标了 proxy: true）

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'fixtures', 'html');
const PROFILE = path.join(ROOT, '.workbuddy', 'tmp', 'capture-profile');
const TARGETS_FILE = path.join(__dirname, 'capture-targets.json');

// 浏览器路径：CHROME_PATH 优先，否则按常见安装位置自动找（本机可能只装了 Edge）
const CHROME = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));
const PROXY = process.env.CLIPMATE_PROXY || '127.0.0.1:7897';

const ARGV = process.argv.slice(2);
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const HEADFUL = ARGV.includes('--headful');
const LIST_ONLY = ARGV.includes('--list');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function targets() {
  const raw = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
  let list = (raw.targets || []).filter((t) => t.enabled !== false);
  if (ONLY) {
    const ids = ONLY.split(',').map((s) => s.trim()).filter(Boolean);
    list = list.filter((t) => ids.includes(t.id));
  }
  return list;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {
    /* 忽略 */
  }
}

function cdpList(port) {
  return new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/list' }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          res(JSON.parse(d));
        } catch (e) {
          rej(e);
        }
      });
    });
    req.on('error', rej);
    req.setTimeout(4000, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

async function waitForPort(profileDir, timeoutMs) {
  const stamp = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(stamp)) {
      const txt = fs.readFileSync(stamp, 'utf8').trim().split(/\r?\n/);
      const port = Number(txt[0]);
      if (port > 0) return port;
    }
    await sleep(120);
  }
  throw new Error('Chrome 没起来（等不到 DevToolsActivePort）');
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let seq = 0;

    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 出错')));
    ws.addEventListener('open', () => {
      const send = (method, params) =>
        new Promise((res, rej) => {
          const id = ++seq;
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
      const evalJs = async (expression) => {
        const r = await send('Runtime.evaluate', {
          expression,
          returnByValue: true,
          awaitPromise: true
        });
        if (r.exceptionDetails) {
          const d = r.exceptionDetails.exception && r.exceptionDetails.exception.description;
          throw new Error('页面脚本执行出错: ' + String(d || '').slice(0, 200));
        }
        return r.result ? r.result.value : undefined;
      };
      resolve({ send, evalJs, close: () => ws.close() });
    });
  });
}

async function launch(useProxy) {
  rmrf(PROFILE);
  fs.mkdirSync(PROFILE, { recursive: true });

  const args = [
    '--remote-debugging-port=0',
    '--user-data-dir=' + PROFILE,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1440,1000',
    '--lang=zh-CN,zh',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  ];
  if (!HEADFUL) args.push('--headless=new');
  if (useProxy) args.push('--proxy-server=' + PROXY);
  args.push('about:blank');

  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: true });
  const port = await waitForPort(PROFILE, 20000);
  let list = [];
  for (let i = 0; i < 40; i++) {
    try {
      list = await cdpList(port);
      if (list.some((t) => t.type === 'page')) break;
    } catch (e) {
      /* 继续等 */
    }
    await sleep(150);
  }
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到可用的页面目标（CDP 起来了但没有 page）');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  return { child, cdp };
}

async function captureOne(cdp, t) {
  // 拦截长连接报错（豆瓣/TMDB 常有第三方资源 404），不影响页面本身
  await cdp.send('Page.navigate', { url: t.url });

  const minLen = t.minLen || 20000;
  const mustInclude = t.mustInclude || [];
  const readyExpr = t.ready || 'document.readyState === "complete"';

  const deadline = Date.now() + (t.timeoutMs || 45000);
  let lastLen = 0;
  let ready = false;

  while (Date.now() < deadline) {
    await sleep(150);
    let ok = false;
    try {
      ok = await cdp.evalJs('!!(' + readyExpr + ')');
    } catch (e) {
      ok = false;
    }
    lastLen = 0;
    try {
      lastLen = await cdp.evalJs('document.documentElement.outerHTML.length');
    } catch (e) {
      lastLen = 0;
    }
    if (ok && lastLen >= minLen) {
      ready = true;
      break;
    }
  }

  const html = await cdp.evalJs('document.documentElement.outerHTML');
  const finalUrl = await cdp.evalJs('location.href');
  const title = await cdp.evalJs('document.title');

  const missing = mustInclude.filter((s) => !html.includes(s));
  const problems = [];
  if (!ready) problems.push(`未就绪（bodyLen=${lastLen}，期望 ≥${minLen}）`);
  if (missing.length) problems.push('缺少特征标记: ' + missing.join(', '));
  // 关键保护：详情页 404 时很多站会 302 回首页，抓到的就成了首页（内容全错但字节数很大）。
  // 所以要求最终 URL 仍然包含 expectPath，否则直接判失败，绝不落盘当样本。
  if (t.expectPath && !String(finalUrl).includes(t.expectPath)) {
    problems.push(`页面被跳走了，最终 URL 不含「${t.expectPath}」: ${finalUrl}`);
  }

  return {
    ok: problems.length === 0,
    problems,
    finalUrl,
    title,
    bytes: Buffer.byteLength(html, 'utf8'),
    html
  };
}

function writeHtml(id, html) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, id + '.html');
  const withDocType = /^<!DOCTYPE/i.test(html) ? html : '<!DOCTYPE html>\n' + html;
  fs.writeFileSync(file, withDocType, 'utf8');
  return file;
}

(async () => {
  const list = targets();
  if (!list.length) {
    console.log('没有匹配的目标（检查 tests/capture-targets.json 或 --only 拼写）');
    return;
  }

  if (LIST_ONLY) {
    list.forEach((t) => {
      console.log(`${t.proxy ? '[代理]' : '[直连]'} ${t.id.padEnd(30)} ${t.url}`);
    });
    console.log(`--- 共 ${list.length} 个目标`);
    return;
  }

  // 按是否走代理分两轮（--proxy-server 是全局参数，一轮只能用一种网络配置）
  const groups = [
    { proxy: false, items: list.filter((t) => !t.proxy) },
    { proxy: true, items: list.filter((t) => t.proxy) }
  ];

  const results = [];

  for (const g of groups) {
    if (!g.items.length) continue;
    console.log(`\n=== ${g.proxy ? '走代理 ' + PROXY : '直连'}｜${g.items.length} 个目标 ===`);

    let session;
    try {
      session = await launch(g.proxy);
    } catch (e) {
      console.log('启动浏览器失败: ' + e.message);
      g.items.forEach((t) => results.push({ id: t.id, ok: false, problems: ['浏览器起不来'] }));
      continue;
    }

    for (const t of g.items) {
      process.stdout.write(`${t.id.padEnd(30)} `);
      try {
        const r = await captureOne(session.cdp, t);
        if (r.ok) {
          const file = writeHtml(t.id, r.html);
          console.log(`✅ ${(r.bytes / 1024).toFixed(0)} KB  ${path.relative(ROOT, file)}`);
          console.log(`${''.padEnd(31)}标题: ${String(r.title).slice(0, 60)}`);
          if (r.finalUrl && r.finalUrl !== t.url) {
            console.log(`${''.padEnd(31)}⚠ 最终 URL 与目标不同（被跳转了）: ${r.finalUrl}`);
          }
        } else {
          console.log('❌ ' + r.problems.join('；'));
          console.log(`${''.padEnd(31)}标题: ${String(r.title).slice(0, 60)}｜最终 URL: ${r.finalUrl}`);
        }
        results.push({
          id: t.id,
          site: t.site,
          url: t.url,
          mediaType: t.mediaType,
          extractor: t.extractor,
          note: t.note,
          ...r
        });
      } catch (e) {
        console.log('❌ ' + e.message);
        results.push({
          id: t.id,
          site: t.site,
          url: t.url,
          mediaType: t.mediaType,
          extractor: t.extractor,
          note: t.note,
          ok: false,
          problems: [e.message]
        });
      }
    }

    try {
      session.cdp.close();
    } catch (e) {
      /* 忽略 */
    }
    try {
      session.child.kill();
    } catch (e) {
      /* 忽略 */
    }
    await sleep(400);
  }

  // 汇总
  const okList = results.filter((r) => r.ok);
  const failList = results.filter((r) => !r.ok);

  console.log('\n========== 汇总 ==========');
  console.log(`成功 ${okList.length} 个，失败 ${failList.length} 个`);
  if (failList.length) {
    console.log('\n失败清单：');
    failList.forEach((r) => console.log(`  ${r.id.padEnd(30)} ${r.problems.join('；')}`));
    console.log('\n提示：Cloudflare / 反爬页可以加 --headful 再试；仍失败就人工另存页面到 tests/fixtures/html/');
  }

  if (okList.length) {
    console.log('\n下一步：把下面条目按需补进 tests/fixtures/registry.json 的 fixtures 数组，');
    console.log('      再跑  node tests/snapshot.js --update  建立基线。\n');
    okList.forEach((r) => {
      console.log(JSON.stringify({
        id: r.id,
        site: r.site,
        file: 'html/' + r.id + '.html',
        url: r.url,
        mediaType: r.mediaType,
        extractor: r.extractor,
        note: r.note || ''
      }));
    });
  }
})().catch((e) => {
  console.error('异常：' + e.message);
  process.exit(1);
});
