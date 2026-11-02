#!/usr/bin/env node
/**
 * 抖音作品页「原始数据（fiber）」勘察探针
 *
 * 只回答一个问题：**这一页的 React fiber 里到底有没有 awemeInfo，里面有哪些字段，
 * 与页面 DOM 上能读到的值是否逐字一致。**
 *
 * 它不加载扩展、不点按钮、不改任何东西 —— 纯读数。
 * 之所以单独写：批 1 要把详情页的文案 / 昵称 / 主页改从 fiber 取，
 * 必须先证明「fiber 拿得到」且「与现在 DOM 取到的值一样」，否则就是拿猜测改代码。
 *
 * 用法：
 *   node tests/douyin-detail-probe.js --url=https://www.douyin.com/video/xxx --headful
 *   node tests/douyin-detail-probe.js --url=... --profile=.workbuddy/tmp/dy-probe-profile
 *
 * 输出：fiber 段 / DOM 段 / 一致性判定 三块。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.CLIPMATE_PORT || 9334);
const HEADFUL = process.argv.includes('--headful');

function arg(prefix) {
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}
const URL_ARG = arg('--url=');
const PROFILE = path.resolve(ROOT, arg('--profile=') || '.workbuddy/tmp/douyin-probe-profile');

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));

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
    ws.onerror = () => rej(new Error('CDP 连接失败'));
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
      throw new Error('页面脚本出错: ' + String(d || '').slice(0, 300));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

/* 页面侧探针：fiber 段（复用 src/background/douyin-fiber.js 原函数）+ DOM 段 */
function buildProbe(pageUrl) {
  const idMatch = /\/(?:video|note)\/(\d{6,25})/.exec(pageUrl) || /modal_id=(\d{6,25})/.exec(pageUrl);
  const id = idMatch ? idMatch[1] : '';
  const fiberSrc = fs.readFileSync(path.join(ROOT, 'ClipMate_chrome/src/background/douyin-fiber.js'), 'utf8');
  return `(() => {
${fiberSrc}
    var targetId = ${JSON.stringify(id)};
    var meta = null;
    var t0 = performance.now();
    try { meta = readDouyinAwemeInfo(targetId); } catch (e) { meta = { __error: String(e && e.message) }; }
    var fiberMs = Math.round((performance.now() - t0) * 100) / 100;

    // ---- DOM 侧：现在详情页取字段用到的那些来源 ----
    var dom = {};
    var md = document.querySelector('meta[name="description"]');
    dom.metaDescription = md ? (md.getAttribute('content') || '') : '';
    var ld = document.querySelector('script[type="application/ld+json"]');
    dom.jsonLdOk = false;
    dom.breadcrumbAuthor = null;
    try {
      if (ld) {
        var data = JSON.parse(ld.textContent);
        dom.jsonLdOk = true;
        var it = (data.itemListElement || []).find(function (x) { return x.position === 2; });
        if (it) dom.breadcrumbAuthor = { name: it.name || '', item: it.item || '' };
      }
    } catch (e) { dom.jsonLdError = String(e && e.message).slice(0, 100); }

    var infoEl = document.querySelector('[data-e2e="video-info"]');
    dom.videoInfoExists = !!infoEl;
    dom.videoInfoAwemeId = infoEl ? infoEl.getAttribute('data-e2e-aweme-id') : null;
    var descEl = document.querySelector('[data-e2e="video-desc"]');
    dom.videoDescText = descEl ? descEl.textContent.trim().slice(0, 200) : '';
    var nickEl = document.querySelector('[data-e2e="feed-video-nickname"]');
    dom.feedNickname = nickEl ? nickEl.textContent.trim() : '';
    var timeEl = document.querySelector('[data-e2e="detail-video-publish-time"], [data-e2e="video-publish-time"]');
    dom.publishTimeText = timeEl ? timeEl.textContent.trim() : '';
    var avatarA = document.querySelector('[data-e2e="video-user-avatar"] a, [data-e2e="author-avatar"] a, a[href*="/user/"]');
    dom.authorHref = avatarA ? String(avatarA.getAttribute('href') || '') : '';

    // ---- 页面结构指纹：详情页是不是 feed-video 那套 ----
    var feeds = document.querySelectorAll('[data-e2e="feed-video"], [data-e2e="feed-active-video"]');
    dom.feedCount = feeds.length;
    dom.feedClasses = [];
    for (var i = 0; i < feeds.length && i < 4; i++) dom.feedClasses.push(String(feeds[i].className || '').slice(0, 120));
    dom.hasPlayerContainer = !!document.querySelector('[data-e2e="player-container"]');
    dom.title = document.title.slice(0, 80);

    return JSON.stringify({ targetId: targetId, fiberMs: fiberMs, meta: meta, dom: dom }, null, 2);
  })()`;
}

(async () => {
  if (!URL_ARG) {
    console.error('用法：node tests/douyin-detail-probe.js --url=<作品页地址> [--headful]');
    process.exit(2);
  }
  if (!CHROME) {
    console.error('找不到 Chrome/Edge');
    process.exit(2);
  }

  fs.mkdirSync(PROFILE, { recursive: true });
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank'
  ];
  if (!HEADFUL) args.splice(2, 0, '--headless=new');
  const child = spawn(CHROME, args, { stdio: 'ignore', windowsHide: !HEADFUL });

  let ver = null;
  for (let i = 0; i < 200 && !ver; i++) {
    await sleep(200);
    try { ver = await getJson('/json/version'); } catch (e) { /* 继续等 */ }
  }
  if (!ver) { console.error('浏览器没起来'); child.kill(); process.exit(2); }

  const list = await getJson('/json/list');
  const page = list.find((t) => t.type === 'page');
  const cdp = await openWs(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  console.log('打开：' + URL_ARG);
  await cdp.send('Page.navigate', { url: URL_ARG });

  // 等到正文有内容（抖音是异步渲染）
  const deadline = Date.now() + 45000;
  let len = 0;
  while (Date.now() < deadline) {
    await sleep(700);
    len = await cdp.evalJs('document.body ? document.body.innerText.replace(/\\s+/g,"").length : 0').catch(() => 0);
    if (len > 200) break;
  }
  await sleep(3000); // 再给 fiber 一点时间挂上

  console.log('正文字数：' + len);
  try {
    const raw = await cdp.evalJs(buildProbe(URL_ARG));
    console.log('\n=== 探针结果 ===');
    console.log(raw);
  } catch (e) {
    console.log('探针失败：' + e.message);
  }

  cdp.close();
  child.kill();
})().catch((e) => { console.error('失败：' + e.message); process.exit(2); });
