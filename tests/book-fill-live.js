// 豆瓣书籍「URL」补齐 · 真机验证（v2.5.76）
//
// 为什么必须真机跑：
//   这条链的两条请求（Goodreads `/book/isbn/`、番组 `/v0/search/subjects`）都在扩展
//   Service Worker 里发，靠 host_permissions 过。curl 能测到的只是「命令行能不能通」，
//   真扩展能不能带着权限通、豆瓣页上按钮到底出不出来、补出来的值是不是**这一本**，
//   只有真 Chrome + 真扩展 + 真点一下才知道。
//
// 这一版盯的四个规则（用户 2026-10-26 拍板）：
//   1. Goodreads 优先 —— 三体/小王子/鬼灭/进击/柯南 这五本 Goodreads 都有，
//      哪怕番组也命中，写进去的必须是 Goodreads。
//   2. 两个都命中时提示要带「番组计划也收录了这一部」（三体专门验这条）。
//   3. 番组只认主条目 —— 灌篮高手 Goodreads 没有，只能靠番组；
//      写进去的必须是主条目 36752，**不能是某一卷**。
//   4. 两站都没有就留空（海贼王港版：番组叫《航海王》对不上名、Goodreads 没有港版 ISBN）。
//
// 用法（项目根目录）：
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/book-fill-live.js
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/book-fill-live.js --only=santi
//   CLIPMATE_EXT=<成品目录> CLIPMATE_PROXY=... node tests/book-fill-live.js   # 直接验成品
//
// 不加 --only 时会把 7 本书全跑一遍，大约 1~2 分钟（每本之间停 1.5 秒，别把豆瓣打急了）。

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
const PORT = 9450 + Math.floor(Math.random() * 90);
const ARGV = process.argv.slice(2);
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';

// 每本书的「正确答案」都是 2026-10-26 实测出来的，不是猜的：
//   · Goodreads 那几条来自 /book/isbn/<ISBN> 的真实落地地址（还抓页面标题确认过是这本书）
//   · 番组那几条来自真机 SW 存档里挑出来的主条目
// 用精确值而不是正则 —— 这条链最怕的不是「没补上」，是「补了个同名的别的书」。
const SITES = [
  {
    id: 'santi',
    name: '三体（Goodreads 有、番组主条目也有）',
    url: 'https://book.douban.com/subject/2567698/',
    expectUrl: 'https://www.goodreads.com/book/show/9574008',
    // 规则 2：两个都命中时必须带这句
    noticeRe: /番组计划也收录了这一部/
  },
  {
    id: 'littleprince',
    name: '小王子（有原作名，番组多个同名主条目）',
    url: 'https://book.douban.com/subject/1084336/',
    expectUrl: 'https://www.goodreads.com/book/show/33550329'
  },
  {
    id: 'slamdunk-all',
    name: '灌篮高手（全31卷）：Goodreads 没有，只能靠番组主条目',
    url: 'https://book.douban.com/subject/2025999/',
    // 规则 3：必须是作品主条目 36752，不是某一卷
    expectUrl: 'https://bgm.tv/subject/36752',
    noticeRe: /番组计划/
  },
  {
    id: 'slamdunk-31',
    name: '灌篮高手31（单卷）：按规则 3 也指向主条目',
    url: 'https://book.douban.com/subject/1221515/',
    expectUrl: 'https://bgm.tv/subject/36752'
  },
  {
    id: 'kiki',
    name: '鬼灭之刃 1（台版，ISBN 认得出）',
    url: 'https://book.douban.com/subject/27105437/',
    expectUrl: 'https://www.goodreads.com/book/show/49535551'
  },
  {
    id: 'attack',
    name: '进击的巨人 01（台版，繁体书名 + 日文原作名）',
    url: 'https://book.douban.com/subject/5906052/',
    expectUrl: 'https://www.goodreads.com/book/show/52722642'
  },
  {
    id: 'conan',
    name: '名侦探柯南 1（陆版，番组超长系列）',
    url: 'https://book.douban.com/subject/1210303/',
    expectUrl: 'https://www.goodreads.com/book/show/35274941'
  },
  {
    id: 'onepiece',
    name: '海贼王 港版（两站都没有 → 必须留空）',
    url: 'https://book.douban.com/subject/1474773/',
    expectEmpty: true,
    noticeRe: /已留空/
  }
].filter((s) => (ONLY ? s.id.includes(ONLY) : true));

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
      throw new Error('页面脚本出错: ' + String(d || '').slice(0, 200));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  const prof = path.join(os.tmpdir(), 'clipmate-bookfill-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });

  // ⚠️ 为什么必须显式给 UA（2026-10-26 实测，踩过）：
  //   headless Chrome 里 Service Worker 的 `navigator.userAgent` 带 **HeadlessChrome/156**，
  //   Goodreads 的 WAF 直接回 403（一个带随机长度 HTML 注释的拦截页），
  //   于是「Goodreads 优先」永远命中不了，只能退到番组 —— 看上去像功能坏了。
  //   实测：同一个 URL，把 UA 换成普通 Chrome 之后立刻 `200 → /book/show/9574008`。
  //   加 Accept / credentials 都没用（试过了），只有 UA 是变量。
  //   用 --user-agent 而不是 CDP 覆盖 SW 目标：MV3 的 SW 会休眠重启，重启后覆盖就丢了。
  //   这是**测试环境**的坑，不是产品 bug —— 真人用有头 Chrome，UA 里没有 Headless。
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    '--headless=new',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank'
  ];
  if (process.env.CLIPMATE_PROXY) {
    args.unshift(`--proxy-server=http://${process.env.CLIPMATE_PROXY}`);
  }

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
  } catch (e) {
    br.close();
    throw new Error('加载扩展失败: ' + e.message);
  }
  br.close();
  if (!extId) throw new Error('加载扩展没返回 ID');

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
  } catch (e) {}

  return { child, cdp, extId };
}
/**
 * 等页面真加载完。
 * 只看 readyState 会误判（旧文档/空文档本来就 complete），所以三个条件都要满足：
 * 加载完成 + 地址是目标地址 + 正文有实质文字。
 */
async function waitReady(cdp, url, budgetMs) {
  const deadline = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(200);
    const raw = await cdp.evalJs(`(() => {
      const body = document.body;
      return JSON.stringify({
        rs: document.readyState,
        href: location.href,
        textLen: body ? (body.innerText || '').replace(/\\s+/g, ' ').trim().length : 0
      });
    })()`).catch(() => 'null');
    if (!raw || raw === 'null') continue;
    let o;
    try { o = JSON.parse(raw); } catch (e) { continue; }
    last = o;
    const sameUrl = o.href.split('?')[0] === url.split('?')[0];
    if (o.rs === 'complete' && sameUrl && o.textLen > 500) return o;
  }
  return last;
}

/** 在 Shadow DOM 里取某个元素中心点坐标 */
async function rectOf(cdp, selector) {
  const raw = await cdp.evalJs(`(() => {
    const host = document.querySelector('.media-floating-window');
    if (!host || !host.shadowRoot) return 'null';
    const el = host.shadowRoot.querySelector(${JSON.stringify(selector)});
    if (!el) return 'null';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'null';
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim().slice(0, 30) });
  })()`).catch(() => 'null');
  return raw && raw !== 'null' ? JSON.parse(raw) : null;
}

async function click(cdp, point) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
}

/** 读表格里所有键值对 + 提示条文字 */
async function readState(cdp) {
  const raw = await cdp.evalJs(`(() => {
    const host = document.querySelector('.media-floating-window');
    if (!host || !host.shadowRoot) return JSON.stringify({ found: false });
    const kv = {};
    [...host.shadowRoot.querySelectorAll('tr')].forEach((tr) => {
      const th = tr.querySelector('th'), td = tr.querySelector('td');
      if (th && td) kv[(th.textContent || '').trim()] = (td.textContent || '').trim();
    });
    const noticeEl = host.shadowRoot.querySelector('.clipmate-notice');
    return JSON.stringify({
      found: true,
      rows: Object.keys(kv).length,
      notice: noticeEl ? (noticeEl.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      kv: kv
    });
  })()`).catch(() => '{"found":false}');
  return JSON.parse(raw);
}

/** 提取一次，返回提取完成后的状态 */
async function extractOnce(cdp) {
  const btnDeadline = Date.now() + 25000;
  let btnPoint = null;
  while (Date.now() < btnDeadline) {
    await sleep(150);
    const b = await cdp.evalJs(`(() => {
      const el = document.querySelector('.media-extractor-button');
      if (!el || el.disabled) return 'null';
      if (String(el.className || '').includes('pending')) return 'null';
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return 'null';
      return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    })()`).catch(() => 'null');
    if (b && b !== 'null') { btnPoint = JSON.parse(b); break; }
  }
  if (!btnPoint) return null;

  await click(cdp, btnPoint);

  const tDeadline = Date.now() + 20000;
  while (Date.now() < tDeadline) {
    await sleep(150);
    const s = await readState(cdp);
    if (s.found && s.rows > 0) return s;
  }
  return null;
}

async function runSite(cdp, site) {
  const report = [];
  const rec = (name, ok, detail) => {
    report.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
    console.log(`  ${ok ? '·' : '✗'} ${name}${detail !== undefined && detail !== '' ? '：' + detail : ''}`);
  };

  await cdp.send('Page.navigate', { url: site.url });
  const ready = await waitReady(cdp, site.url, 40000);
  if (!ready || ready.textLen <= 500) {
    rec('页面加载', false, '正文文字太少（' + JSON.stringify(ready) + '）');
    return report;
  }

  const before = await extractOnce(cdp);
  if (!before) { rec('点提取后出表格', false, '没出表格'); return report; }
  rec('点提取后出表格', true, `${before.rows} 行`);

  // 豆瓣书籍页的正常状态：URL 空着、豆瓣链接有值 —— 这正是这条链要补的那种状态
  rec('提取后「URL」为空（该补的状态）', (before.kv['URL'] || '') === '', JSON.stringify(before.kv['URL']));
  rec('提取后「豆瓣链接」有值（待会儿必须原样保留）', !!before.kv['豆瓣链接'], before.kv['豆瓣链接']);

  // v2.5.76：按钮显示条件加了「豆瓣书籍页」这一条，先确认它真的出来了
  const fillBtn = await rectOf(cdp, '#crossSiteFill');
  rec('「补齐网址」按钮出现在书籍页', !!fillBtn, fillBtn ? fillBtn.text : '找不到');
  if (!fillBtn) return report;

  const fillStart = Date.now();
  await click(cdp, fillBtn);

  // 等到「提示条给出结论」为止：补上的会写「已补上」，两站都没收会写「已留空」
  const deadline = Date.now() + 35000;
  let after = null;
  while (Date.now() < deadline) {
    await sleep(150);
    const s = await readState(cdp);
    if (!s.found) break;                       // 浮窗没了 = 页面被刷，作废
    if (s.notice && /已补上|已留空|已经有网址|取不到/.test(s.notice)) { after = s; break; }
  }
  if (!after) {
    rec('点「补齐网址」后有结果', false, `${Date.now() - fillStart} ms 内提示条没给结论`);
    return report;
  }
  console.log(`  · 耗时 ${Date.now() - fillStart} ms，提示条：「${after.notice}」`);

  const gotUrl = (after.kv['URL'] || '').trim();
  if (site.expectEmpty) {
    rec('「URL」留空（宁空不错）', gotUrl === '', JSON.stringify(gotUrl));
  } else {
    rec('「URL」是正确的那一条', gotUrl === site.expectUrl,
      gotUrl === site.expectUrl ? gotUrl : `得到 ${JSON.stringify(gotUrl)}，应为 ${site.expectUrl}`);
  }

  if (site.noticeRe) {
    rec('提示条内容符合预期', site.noticeRe.test(after.notice), after.notice);
  }

  // 红线：豆瓣链接绝不能被这个功能改动
  rec('「豆瓣链接」原样未动', (after.kv['豆瓣链接'] || '') === (before.kv['豆瓣链接'] || ''),
    after.kv['豆瓣链接']);

  return report;
}

(async () => {
  const { cdp } = await launch();
  let pass = 0;
  const fails = [];

  for (const site of SITES) {
    console.log(`\n[${SITES.indexOf(site) + 1}/${SITES.length}] ${site.name}`);
    let rep = [];
    try {
      rep = await runSite(cdp, site);
    } catch (e) {
      rep = [{ name: '整体跑了', ok: false, detail: e.message }];
    }
    rep.forEach((r) => { if (r.ok) pass++; else fails.push({ site: site.id, ...r }); });
    await sleep(1500);   // 别把豆瓣打急了
  }

  console.log('\n' + '='.repeat(56));
  if (!fails.length) {
    console.log(`✅ 全部通过：${pass} 条断言（${SITES.length} 本书）`);
  } else {
    console.log(`❌ 失败 ${fails.length} 条（共 ${pass + fails.length} 条）`);
    fails.forEach((f) => console.log(`   · [${f.site}] ${f.name}：${f.detail}`));
  }
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('脚本崩了:', e && e.message);
  process.exit(1);
});
