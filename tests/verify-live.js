// 真机验证：加载扩展，在真实 Chrome 里走一遍「打开页面 → 按钮可点 → 点击 → 出表格」
//
// 为什么必须有这一步：
//   tests/snapshot.js 是在 jsdom 里跑提取代码，它证明不了三件事——
//     1. manifest 加了新文件（src/shared/logger.js）后扩展能不能正常加载；
//     2. background 的站点类型表改了之后，页面上的按钮还在不在；
//     3. 真实鼠标点击能不能走通（jsdom 里没有真实事件链）。
//
// 【Chrome 156 起的重要变化】
//   `--load-extension` 命令行开关已被彻底移除（137 起逐步废弃），继续用它扩展不会加载，
//   表现为「页面没按钮」而让人误判成代码坏了。
//   现在唯一可用的自动化加载方式是 CDP 的 Extensions.loadUnpacked，
//   且启动时必须带 `--enable-unsafe-extension-debugging`。
//
// 用法：
//   node tests/verify-live.js              验 3 个代表站
//   node tests/verify-live.js --shot       额外存截图到 .workbuddy/tmp/
//   node tests/verify-live.js --only=steam 只验一个
//   CLIPMATE_EXT=<目录> node tests/verify-live.js   验别的成品目录（新旧对照实验）
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/verify-live.js --only=goodreads
//     ↑ 外网站点（Goodreads / IMDb / TMDB）必须给代理，且这些站默认不在常规 3 站里
//
// 依赖：本机 Chrome。douban / steam / bgm 三站是直连，不需要代理。

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
const SHOT_DIR = path.join(ROOT, '.workbuddy', 'tmp');

const ARGV = process.argv.slice(2);
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const SHOT = ARGV.includes('--shot');
const DUMP = ARGV.includes('--dump');

// 端口随机，避免上一轮残留进程占用
const PORT = 9400 + Math.floor(Math.random() * 90);

const SITES = [
  { id: 'douban-book', name: '豆瓣读书', url: 'https://book.douban.com/subject/1084336/', minFields: 8 },
  { id: 'steam', name: 'Steam', url: 'https://store.steampowered.com/app/570/Dota_2/', minFields: 8 },
  // v2.5.70 待办：这个页面（EVA 动画）信息框里没有 IMDb，
  // 真机上「IMDB」必须是空。快照基线里的 tt1234567 是测试脚手架自己造出来的假值，
  // 用它做对照会把假值当真值，所以这里钉一条真机断言。
  { id: 'bgm', name: 'Bangumi', url: 'https://bgm.tv/subject/265', minFields: 8, expect: { 'IMDB': '' } },
  // v2.5.71：豆瓣电影删掉了「整页文字搜 tt 编号」的兜底。
  // 这条用来证明「编号仍然抓得到」——它来自 #info 里的 `IMDb: tt0111161`（方法1），
  // 跟被删的兜底无关。平时不跑，用 --only=douban-movie 单独验。
  {
    id: 'douban-movie',
    name: '豆瓣电影（肖申克）',
    url: 'https://movie.douban.com/subject/1292052/',
    minFields: 8,
    extra: true,
    expect: { 'IMDB': 'https://www.imdb.com/title/tt0111161/' }
  },
  // v2.5.70：删掉 Bangumi「整页乱搜 tt 编号」的兜底后，必须证明真页面的编号仍抓得到。
  // 《教父》信息框里是 imdb_id: tt0068646，只能用 --only=bgm-godfather 单独跑。
  // v2.5.71：这一页信息框的日期字段是「上映日: 1972-03-15」（不是放送开始/上映年度），
  // 顺手钉住「上映日期」这一格必须真有值，且格式跟其他站一致（YYYY/MM/DD）。
  {
    id: 'bgm-godfather',
    name: 'Bangumi 电影（教父）',
    url: 'https://bgm.tv/subject/64965',
    minFields: 8,
    extra: true,
    expect: {
      'IMDB': 'https://www.imdb.com/title/tt0068646/',
      '上映日期': '1972/03/15'
    }
  },
  // v2.5.69：Goodreads 的「国家」要联网抓作者页，jsdom 快照测不到，只能真机验。
  // 外网站点平时不跑（extra），要验时用 --only=goodreads，并给 CLIPMATE_PROXY。
  {
    id: 'goodreads',
    name: 'Goodreads',
    url: 'https://www.goodreads.com/book/show/11084145-steve-jobs',
    minFields: 8,
    extra: true,
    expect: { '国家': '美国' }
  }
].filter((s) => (ONLY ? s.id.includes(ONLY) : !s.extra));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (p) =>
  new Promise((res, rej) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
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
    req.setTimeout(4000, () => req.destroy(new Error('timeout')));
  });

/** 打开一个 CDP 连接，返回 {send, evalJs, close} */
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
      throw new Error('页面脚本出错: ' + String(d || '').slice(0, 160));
    }
    return r.result ? r.result.value : undefined;
  };

  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  const prof = path.join(os.tmpdir(), 'clipmate-verify-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    // 不带 headless 时页面可能不可见，CDP 的 Input 事件会被静默丢弃 → 点不动按钮
    '--headless=new',
    // 允许通过 CDP 加载未打包扩展（Chrome 156 下这是唯一可行方式）
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,1000',
    'about:blank'
  ];

  // 外网站点（Goodreads / IMDb / TMDB…）走本机代理：CLIPMATE_PROXY=127.0.0.1:7897
  if (process.env.CLIPMATE_PROXY) {
    args.unshift(`--proxy-server=http://${process.env.CLIPMATE_PROXY}`);
  }

  const child = spawn(
    CHROME,
    args,
    { stdio: 'ignore', windowsHide: true }
  );

  let ver = null;
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try {
      ver = await getJson('/json/version');
      if (ver) break;
    } catch (e) {
      /* 继续等 */
    }
  }
  if (!ver) throw new Error('Chrome 没起来（等不到 CDP 端口）');

  // ① 连 browser 端点加载扩展
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
  console.log(`扩展已加载｜ID = ${extId}`);

  // ② 等扩展的 service worker 出现（扩展真跑起来的证据）
  let swSeen = false;
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const list = await getJson('/json/list').catch(() => []);
    if (list.some((t) => t.type === 'service_worker' && String(t.url).includes(extId))) {
      swSeen = true;
      break;
    }
  }
  if (!swSeen) console.log('提示：没看到扩展的 service worker（MV3 会休眠，可能只是还没醒，不影响内容脚本）');

  // ③ 连页面
  const targets = await getJson('/json/list');
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page 目标');

  const cdp = await openWs(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  // 抹掉 HeadlessChrome 指纹：headless 的默认 UA 里带 "HeadlessChrome"，
  // Goodreads / IMDb 这类站看到就回一个空壳页（实测 Goodreads 只回 3KB 白页），
  // 会被误判成「提取器坏了」。这里换成与真实版本号一致的正规 UA。
  try {
    const major = String((ver.Browser || '').split('/')[1] || '156').split('.')[0];
    const realUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      `(KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
    await cdp.send('Network.enable');
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: realUa,
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8'
    });
  } catch (e) {
    console.log('提示：UA 覆盖失败（老版本 Chrome？），外网站点可能拿到空壳页：' + e.message);
  }

  return { child, cdp, extId, close: () => cdp.close() };
}

// 等按钮进入「可点」状态。条件轮询，不用固定 sleep。
async function waitButton(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'none';
  while (Date.now() < deadline) {
    await sleep(150);
    const raw = await cdp.evalJs(`(() => {
      const b = document.querySelector('.media-extractor-button');
      if (!b) return 'none';
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return JSON.stringify({
        disabled: !!b.disabled,
        cls: String(b.className || ''),
        w: Math.round(r.width), h: Math.round(r.height),
        display: cs.display, visibility: cs.visibility,
        text: (b.textContent || '').trim().slice(0, 24)
      });
    })()`).catch(() => 'none');
    last = raw;
    if (raw && raw !== 'none') {
      const o = JSON.parse(raw);
      if (!o.disabled && !o.cls.includes('pending') && o.w > 0 && o.h > 0) return { ok: true, info: o };
    }
  }
  return { ok: false, info: last };
}

async function readTable(cdp) {
  return cdp.evalJs(`(() => {
    const host = document.querySelector('.media-floating-window');
    if (!host || !host.shadowRoot) return JSON.stringify({ found: false });
    const table = host.shadowRoot.querySelector('table');
    if (!table) return JSON.stringify({ found: false, shadow: true });
    const rows = [...host.shadowRoot.querySelectorAll('tr')];
    const kv = [];
    rows.forEach((tr) => {
      const th = tr.querySelector('th');
      const td = tr.querySelector('td');
      if (th && td) kv.push([ (th.textContent || '').trim(), (td.textContent || '').trim() ]);
    });
    const nonEmpty = kv.filter(([, v]) => v !== '');
    return JSON.stringify({ found: true, rows: kv.length, nonEmpty: nonEmpty.length, sample: nonEmpty.slice(0, 4), all: kv });
  })()`);
}

async function verifySite(cdp, site) {
  const report = { id: site.id, name: site.name, steps: [], ok: false };

  await cdp.send('Page.navigate', { url: site.url });

  const navDeadline = Date.now() + 30000;
  while (Date.now() < navDeadline) {
    await sleep(150);
    const rs = await cdp.evalJs('document.readyState').catch(() => '');
    if (rs === 'complete') break;
  }

  const btn = await waitButton(cdp, 20000);
  if (!btn.ok) {
    report.steps.push({
      name: '按钮出现且可点',
      ok: false,
      detail: typeof btn.info === 'string' ? btn.info : JSON.stringify(btn.info)
    });
    return report;
  }
  report.steps.push({ name: '按钮出现且可点', ok: true, detail: btn.info.text });

  // 派发前确认按钮没被别的元素盖住（盖住时点击会打到别人身上）
  const hitObj = JSON.parse(
    await cdp.evalJs(`(() => {
      const b = document.querySelector('.media-extractor-button');
      const r = b.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const top = document.elementsFromPoint(x, y)[0];
      return JSON.stringify({ x, y, hitSelf: top === b, topTag: top ? top.tagName : '' });
    })()`)
  );
  if (!hitObj.hitSelf) {
    report.steps.push({ name: '按钮未被遮挡', ok: false, detail: `点上去命中的是 ${hitObj.topTag}` });
    return report;
  }
  report.steps.push({ name: '按钮未被遮挡', ok: true, detail: `(${Math.round(hitObj.x)},${Math.round(hitObj.y)})` });

  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', {
      type,
      x: hitObj.x,
      y: hitObj.y,
      button: 'left',
      clickCount: 1
    });
  }

  let table = null;
  const tDeadline = Date.now() + 20000;
  while (Date.now() < tDeadline) {
    await sleep(150);
    const o = JSON.parse(await readTable(cdp).catch(() => '{"found":false}'));
    if (o.found && o.rows > 0) {
      table = o;
      break;
    }
  }

  if (!table) {
    report.steps.push({ name: '点击后出结果表格', ok: false, detail: '20 秒内没出表格' });
    return report;
  }
  report.steps.push({ name: '点击后出结果表格', ok: true, detail: `${table.rows} 行` });

  if (DUMP) {
    const info = await cdp.evalJs(`JSON.stringify({
      title: document.title,
      href: location.href,
      htmlLen: document.documentElement.outerHTML.length,
      textLen: (document.body ? document.body.innerText.length : 0),
      text: (document.body ? document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300) : '')
    })`).catch((e) => `{"err":"${e.message}"}`);
    console.log('\n[DUMP] ' + info + '\n');
  }

  const enough = table.nonEmpty >= site.minFields;
  report.steps.push({
    name: `非空字段 ≥ ${site.minFields}`,
    ok: enough,
    detail:
      `${table.nonEmpty} 个｜样例：` +
      (table.sample || []).map(([k, v]) => `${k}=${String(v).slice(0, 16)}`).join(' / ')
  });

  // 指定字段的期望值（如 Goodreads 的「国家」必须等于「美国」）
  if (site.expect) {
    const pairs = table.all || [];
    Object.keys(site.expect).forEach((key) => {
      const want = site.expect[key];
      const hit = pairs.filter(([k]) => k === key)[0];
      const got = hit ? hit[1] : '(表格里没有这一行)';
      report.steps.push({
        name: `字段「${key}」= ${want}`,
        ok: got === want,
        detail: `实际：${got}`
      });
    });
  }

  if (SHOT) {
    await sleep(500);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(SHOT_DIR, `verify-${site.id}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    report.steps.push({ name: '截图', ok: true, detail: path.relative(ROOT, file) });
  }

  report.ok = report.steps.every((s) => s.ok);
  return report;
}

(async () => {
  if (!SITES.length) {
    console.log('没有匹配的站点（检查 --only 拼写）');
    return;
  }

  console.log(`真机验证｜扩展目录 ${EXT_DIR}`);
  console.log(`站点 ${SITES.length} 个｜Chrome ${CHROME}｜端口 ${PORT}\n`);

  let session;
  try {
    session = await launch();
  } catch (e) {
    console.log('浏览器启动失败: ' + e.message);
    process.exit(1);
  }

  const reports = [];
  for (const site of SITES) {
    process.stdout.write(`${site.name.padEnd(12)} `);
    try {
      const r = await verifySite(session.cdp, site);
      reports.push(r);
      console.log(r.ok ? '✅ 通过' : '❌ 失败');
      r.steps.forEach((s) => {
        console.log(`  ${s.ok ? '·' : '✗'} ${s.name}${s.detail ? '：' + String(s.detail).slice(0, 90) : ''}`);
      });
    } catch (e) {
      console.log('❌ 异常: ' + e.message);
      reports.push({ id: site.id, name: site.name, ok: false, steps: [{ name: '异常', ok: false, detail: e.message }] });
    }
  }

  try {
    session.close();
  } catch (e) {
    /* 忽略 */
  }
  try {
    session.child.kill();
  } catch (e) {
    /* 忽略 */
  }

  const pass = reports.filter((r) => r.ok).length;
  console.log(`\n========== 结果：${pass}/${reports.length} 通过 ==========`);
  if (pass !== reports.length) {
    console.log('失败时按停住的步骤定位：');
    console.log('  停在「按钮出现」→ manifest / matches 出问题，扩展没注入到该页');
    console.log('  停在「出表格」  → 提取或渲染出问题');
    console.log('  「按钮被遮挡」  → 页面弹窗/遮罩挡住了，未必是扩展的问题');
    process.exit(1);
  }
})().catch((e) => {
  console.error('异常：' + e.message);
  process.exit(1);
});
