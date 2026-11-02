// 跨站补网址 · 真机验证（v2.5.72）
//
// 为什么必须有这一步：
//   jsdom 快照不联网；curl 又不可信（TMDB 的 curl 恒 403，真浏览器正常）。
//   而且这个功能的**全部网络请求都在扩展 Service Worker 里**（内容脚本跨域会被 CORS 拦），
//   它到底能不能带着 host_permissions 通过 Cloudflare、能不能过番组计划的 UA 检查，
//   只有把真扩展装进真 Chrome、真点一下才知道。
//
// 【IMDb 页会自己刷新】
//   2026-10-26 实测：IMDb 标题页打开约 15 秒后，页面自己的内联脚本会把同一个 URL 重新
//   导航一次（CDP 抓到 initiator=script, url=imdb.com/title/...）。**跟本扩展无关**——
//   对照实验：打开浮窗后什么都不点，15 秒后浮窗同样消失。所以这个脚本每次尝试都要
//   赶在刷新之前跑完，刷新了就整体重来一次（最多 2 次）。
//
// 验的场景：
//   A. IMDb《教父》—— 豆瓣链接 / Bangumi / TMDB 三格应被写上真实网址；
//      「IMDB」格原本就有值，必须原样不动（用户明确：已有值绝不覆盖）；
//      再点一次应提示「都已有网址」，三格一个字符不变。
//   B. 豆瓣《肖申克》—— 豆瓣链接本来就有值，必须保持原样；
//      Bangumi / TMDB 两格被补上。验证「不覆盖」在真实页面上成立。
//   C.（v2.5.75）TMDB 电影页 / 剧集页 —— IMDB 格必须补出**正确的那一条**：
//      movie/238 只能是 tt0068646，tv/4613 只能是 tt0185906。
//      这条链是「猜候选 + 回 TMDB 验证」，最容易出的错是写出同名的相近条目，
//      所以用 mustEqual 钉死具体编号，而不是只查格式。
//
// 用法（项目根目录）：
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js --only=imdb --dump
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js --only=tmdb
//   CLIPMATE_PROXY=127.0.0.1:7897 node tests/cross-site-live.js --site=tmdb   （只跑 TMDB《教父》）

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
const ARGV = process.argv.slice(2);
const ONLY = (ARGV.find((a) => a.startsWith('--only=')) || '').split('=')[1] || '';
// --site=<id> 精确匹配单个用例（--only 是模糊包含，tmdb 会把 tmdb/tmdb2/tmdb-tv 全带上）。
// 反复跑同一个页面统计稳定性时用这个，省时间。
const SITE = (ARGV.find((a) => a.startsWith('--site=')) || '').split('=')[1] || '';
const DUMP = ARGV.includes('--dump');

const RE_DOUBAN = /^https:\/\/movie\.douban\.com\/subject\/\d+\/$/;
const RE_BGM = /^https:\/\/bgm\.tv\/subject\/\d+$/;
const RE_TMDB = /^https:\/\/www\.themoviedb\.org\/(movie|tv)\/\d+/;
const RE_IMDB = /^https:\/\/www\.imdb\.com\/title\/tt\d+\/$/;

const SITES = [
  {
    id: 'imdb',
    name: 'IMDb《教父》',
    url: 'https://www.imdb.com/title/tt0068646/',
    extra: true,
    // 提取后这三格应为空
    emptyAfterExtract: ['豆瓣链接', 'Bangumi', 'TMDB'],
    // 补完之后这三格必须命中正则
    mustFill: { '豆瓣链接': RE_DOUBAN, 'Bangumi': RE_BGM, 'TMDB': RE_TMDB },
    // 这一格补之前就有值，补之后必须一模一样
    mustKeep: 'IMDB',
    // 这一页会自己刷新，赶时间
    hurry: true
  },
  {
    id: 'douban',
    name: '豆瓣《肖申克》',
    url: 'https://movie.douban.com/subject/1292052/',
    // v2.5.73：豆瓣页的 IMDB 格由页面自带的 tt 编号**本地拼**出来（不发请求）
    mustFill: { 'IMDB': RE_IMDB, 'TMDB': RE_TMDB },
    // 豆瓣链接本来就有值 → 必须原样保留
    mustKeep: '豆瓣链接',
    // 番组计划根本没收录这部片（中文名搜 total=0，英文名搜回来 1000 条无关结果）。
    // 这里必须留空 —— 「写个错网址」比「留空」糟得多。
    mustEmpty: ['Bangumi']
  },
  {
    id: 'bgm',
    name: '番组计划《教父》',
    url: 'https://bgm.tv/subject/64965',
    // 番组页信息框自带 IMDb 编号；Bangumi 格本来就是这个页面的地址 —— 两格都必须原样不动
    mustKeep: ['IMDB', 'Bangumi'],
    // v2.5.73：豆瓣用 tt 编号问，TMDB 用 tt 编号精确跳转
    mustFill: { '豆瓣链接': RE_DOUBAN, 'TMDB': RE_TMDB }
  },
  {
    id: 'tmdb',
    name: 'TMDB《教父》',
    url: 'https://www.themoviedb.org/movie/238-the-godfather',
    extra: true,
    // v2.5.75（批2）：IMDB 这一格现在能补了 —— 先拿片名去 IMDb 建议接口猜候选，
    // 再拿候选回 TMDB /redirect 验「是不是同一条」，同号才写。
    // 豆瓣用中文名（教父）、番组计划用英文原名（The Godfather）
    mustFill: { '豆瓣链接': RE_DOUBAN, 'Bangumi': RE_BGM, 'IMDB': RE_IMDB },
    // 光命中格式不够：238 就是《教父》，正确值唯一，必须是这个号
    mustEqual: { 'IMDB': 'https://www.imdb.com/title/tt0068646/' },
    // 本页那一格本来就有值，必须原样不动
    mustKeep: 'TMDB'
  },
  {
    id: 'tmdb2',
    name: 'TMDB《教父2》（同名系列，最容易猜错）',
    url: 'https://www.themoviedb.org/movie/240-the-godfather-part-ii',
    extra: true,
    // 这个是本批最该盯的边界：搜「教父」时 IMDb 第一条是《教父》(tt0068646)，
    // 热门度也远比《教父2》高。如果只取第一条，就会把 tt0068646 写进《教父2》的格子。
    // 正确做法就是现在这套：多猜几个候选，逐个回 TMDB 验证，同号才算。
    mustFill: { 'IMDB': RE_IMDB },
    mustEqual: { 'IMDB': 'https://www.imdb.com/title/tt0071562/' },
    mustKeep: 'TMDB'
  },
  {
    id: 'tmdb-tv',
    name: 'TMDB《兄弟连》剧集',
    url: 'https://www.themoviedb.org/tv/4613-band-of-brothers',
    extra: true,
    // 剧集侧单独验一遍：类型要从**地址里的 /tv/** 判定，不能只看「影视类型」字段
    mustFill: { 'IMDB': RE_IMDB },
    mustEqual: { 'IMDB': 'https://www.imdb.com/title/tt0185906/' },
    mustKeep: 'TMDB'
  }
].filter((s) => (SITE ? s.id === SITE : (ONLY ? s.id.includes(ONLY) : true)));

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
  const prof = path.join(os.tmpdir(), 'clipmate-crosssite-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });

  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${prof}`,
    '--headless=new',
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
 * 提取发生那一刻，页面自己有什么可用的「名字/日期」来源。
 * 只用于排查「提取出来的名字/原作名/上映日期全空」这类问题，正常跑不看它。
 */
async function pageFacts(cdp) {
  const raw = await cdp.evalJs(`(() => {
    const ld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const j = JSON.parse(s.textContent);
        ld.push({ type: j && j['@type'], name: j && j.name, date: j && j.datePublished });
      } catch (e) { ld.push({ type: 'PARSE_FAIL', name: e.message }); }
    });
    const og = (p) => {
      const el = document.querySelector('meta[property="og:' + p + '"]');
      return el ? el.content : null;
    };
    const hero = document.querySelector('[data-testid="hero__pageTitle"]');
    const h1 = document.querySelector('h1');
    return JSON.stringify({
      readyState: document.readyState,
      title: document.title,
      ogTitle: og('title'),
      ogType: og('type'),
      ogDesc: (og('description') || '').slice(0, 80),
      heroTitle: hero ? (hero.textContent || '').trim() : null,
      h1: h1 ? (h1.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) : null,
      ldCount: ld.length,
      ld: ld
    });
  })()`).catch((e) => JSON.stringify({ err: e.message }));
  try { return JSON.parse(raw); } catch (e) { return { err: raw }; }
}

/**
 * 等页面真的加载完。
 *
 * 不能只等 readyState==='complete'：Page.navigate 刚发出时，当前文档可能还是上一页
 * 或空白页，它的 readyState 本来就是 complete，会立刻误判为「加载好了」，
 * 于是提取跑在一个几乎没内容的文档上（2026-10-26 实测：IMDb 页因此拿到
 * 名字/原作名/上映日期全空，只有 location 相关的 IMDB 格子有值）。
 * 判据加上「location 已经是目标地址」和「body 有实质文字」。
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
        titleLen: (document.title || '').length,
        textLen: body ? (body.innerText || '').replace(/\\s+/g, ' ').trim().length : 0,
        ldCount: document.querySelectorAll('script[type="application/ld+json"]').length
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

// v2.5.74（批3）：「⋯」菜单取消，按钮全部直接摊在标题栏，
// 原来点「⋯」再点菜单项的 helper（menuItemRect）已无用，删掉避免误用。

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

  // IMDb 会自己刷新，所以最多试两次
  const attempts = site.hurry ? 2 : 1;
  let before = null;
  let after = null;
  let notice = '';
  let titleBtnChecked = false; // 批3 的按钮断言只记一次

  for (let attempt = 1; attempt <= attempts && !after; attempt++) {
    if (attempt > 1) console.log(`  · 页面被刷新，第 ${attempt} 次重试`);

    await cdp.send('Page.navigate', { url: site.url });
    const ready = await waitReady(cdp, site.url, 40000);
    if (DUMP) console.log('\n[加载完成] ' + JSON.stringify(ready));
    if (!ready || ready.textLen <= 500) {
      console.log('  · 页面没真正加载出来（body 几乎没文字），这一轮跳过');
      continue;
    }
    if (DUMP) console.log('\n[页面事实·提取前] ' + JSON.stringify(await pageFacts(cdp), null, 2));

    before = await extractOnce(cdp);
    if (!before) break;

    // v2.5.74（批3·方案乙）：原来收在 ⋯ 菜单里的三项，现在必须直接摊在标题栏，
    // 「⋯」按钮本身必须消失。只查一次（IMDb 页会重试，重复记录会把统计数冲乱）。
    if (!titleBtnChecked) {
      titleBtnChecked = true;
      for (const pair of [
        ['copyPlainText', '复制纯文本'],
        ['resetFieldOrderBtn', '重置排序'],
        ['crossSiteFill', '补齐网址']
      ]) {
        const r = await rectOf(cdp, '#' + pair[0]);
        rec(`「${pair[1]}」在标题栏上（原来藏在 ⋯ 里）`, !!r,
          r ? `可见 @${Math.round(r.x)},${Math.round(r.y)}` : '找不到这个按钮');
      }
      const moreBtn = await rectOf(cdp, '#moreActions');
      rec('「⋯」按钮已取消', !moreBtn, moreBtn ? '居然还在' : '已移除');

      // 折行情况：容器高度 > 32 说明掉了第二行（按钮本身约 24px 高 + 6px 行距）
      const layout = await cdp.evalJs(`(() => {
        const host = document.querySelector('.media-floating-window');
        const sr = host && host.shadowRoot;
        if (!sr) return 'null';
        const box = sr.querySelector('.floating-window-title-buttons');
        const head = sr.querySelector('.floating-window-header');
        const fw = host.getBoundingClientRect();
        if (!box || !head) return 'null';
        return JSON.stringify({
          fwWidth: Math.round(fw.width),
          boxWidth: Math.round(box.getBoundingClientRect().width),
          boxHeight: Math.round(box.getBoundingClientRect().height),
          headHeight: Math.round(head.getBoundingClientRect().height),
          count: box.querySelectorAll('button').length
        });
      })()`).catch(() => 'null');
      if (layout && layout !== 'null') {
        const L = JSON.parse(layout);
        const rows = L.boxHeight > 32 ? 2 : 1;
        console.log(`  · 按钮布局：浮窗 ${L.fwWidth}px｜按钮区 ${L.boxWidth}×${L.boxHeight}px｜标题栏高 ${L.headHeight}px｜${L.count} 个按钮｜约 ${rows} 行`);
      }
    }

    if (DUMP) console.log('\n[页面事实·提取后] ' + JSON.stringify(await pageFacts(cdp), null, 2));

    // v2.5.74（批3）：⋯ 菜单取消，补齐网址直接是标题栏按钮，不用再点两级
    const fillBtn = await rectOf(cdp, '#crossSiteFill');
    if (!fillBtn) break;
    const fillStart = Date.now();
    await click(cdp, fillBtn);

    // 赶在 IMDb 自己刷新之前把结果读出来：快轮询
    // v2.5.73：判据从 some 改成 every —— IMDB 那一格是**本地瞬间拼**的（不发请求），
    // 用 some 会在它填上的那一刻就以为完事了，等不到还需要联网的 TMDB / 番组计划。
    const wantKeys = Object.keys(site.mustFill || {});
    // v2.5.75：窗口从 25s 放宽到 40s。原因是真机上偶尔出现「豆瓣、番组都补上了，
    // IMDB 还空着」——先要判明这是「真的查不到」还是「只是慢」。放宽后如果失败消失，
    // 就说明是耗时问题而不是逻辑问题。耗时每次都打印出来，便于看分布。
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      await sleep(150);
      const s = await readState(cdp);
      if (!s.found) {
        // 浮窗没了 = 页面被刷新，这一轮作废
        break;
      }
      const allFilled = wantKeys.length > 0 && wantKeys.every((k) => s.kv && s.kv[k]);
      if (allFilled) { after = s; break; }
      // 提示条已经给出结论（补上了 / 搜索不到 / 连不上 / 不需要补）→ 流程结束
      if (s.notice && /已补上|搜索不到|连不上|不需要补齐/.test(s.notice)) { after = s; break; }
    }
    if (after) {
      notice = after.notice || '';
      console.log(`  · 「补齐网址」耗时 ${Date.now() - fillStart} ms`);
    } else {
      console.log(`  · 「补齐网址」${Date.now() - fillStart} ms 内什么也没等到`);
    }
  }

  if (!before) { rec('点提取后出表格', false, '没出表格（或页面刷新太快）'); return report; }
  rec('点提取后出表格', true, `${before.rows} 行`);

  (site.emptyAfterExtract || []).forEach((key) => {
    rec(`提取后「${key}」为空`, (before.kv[key] || '') === '', JSON.stringify(before.kv[key]));
  });

  // mustKeep 可以是单个字段名，也可以是数组（番组页/TMDB 页都有「两格本来就有值」）
  const keepKeys = site.mustKeep
    ? (Array.isArray(site.mustKeep) ? site.mustKeep : [site.mustKeep])
    : [];
  const keepBefore = {};
  keepKeys.forEach((k) => {
    keepBefore[k] = before.kv[k];
    rec(`提取后「${k}」有值（待会儿必须原样保留）`, !!keepBefore[k], keepBefore[k]);
  });

  if (!after) { rec('点「补齐网址」后有结果', false, '25 秒内没看到任何格子被填上'); return report; }

  Object.keys(site.mustFill || {}).forEach((key) => {
    const re = site.mustFill[key];
    const got = after.kv[key] || '';
    rec(`「${key}」被写上`, re.test(got), got);
  });

  // v2.5.75：mustEqual 比 mustFill 更严 —— 不只是「格式对」，还得是**指定的那一条**。
  // TMDB 反查最容易犯的错就是「猜了条同名的相近条目」，光用正则挡不住。
  // v2.5.76：对不上时把扩展留在页面上的现场（window.__CLIPMATE_IMDB_DEBUG__）打出来，
  // 一眼能分清是「候选里就没有对的」还是「请求被抖掉了」。
  for (const key of Object.keys(site.mustEqual || {})) {
    const want = site.mustEqual[key];
    const got = after.kv[key] || '';
    const pass = got === want;
    rec(`「${key}」是正确的那一条`, pass, pass ? got : `得到 ${got}，应为 ${want}`);
    if (!pass) {
      const dbg = await evalJs(cdp, 'window.__CLIPMATE_IMDB_DEBUG__ || null').catch(() => null);
      console.log('  · 现场：' + JSON.stringify(dbg));
    }
  }

  (site.mustEmpty || []).forEach((key) => {
    const got = after.kv[key] || '';
    rec(`「${key}」留空（宁空不错）`, got === '', got === '' ? '(空)' : `竟然写了 ${got}`);
  });

  keepKeys.forEach((k) => {
    rec(`「${k}」原样未动（已有值不覆盖）`, after.kv[k] === keepBefore[k],
      `${keepBefore[k]} → ${after.kv[k]}`);
  });

  // v2.5.73：本页自己那一格不该被重写。
  // v2.5.74 修正：原来用「值是否等于当前页地址」来判断，这在番组页/TMDB 页是**错的** ——
  // 番组页的 Bangumi 格本来就是 bgm.tv/subject/64965（等于当前页），TMDB 页的 TMDB 格
  // 本来就是那一页的地址。它们「等于当前页」是页面自带的结果，根本不是我们写进去的。
  // 正确判据是「补完之后的字符串必须和补之前一模一样」，所以这类格子统一改用 mustKeep。
  if (site.mustNotEqualPage) {
    const got = after.kv[site.mustNotEqualPage] || '';
    const pageKey = site.url.replace(/^https?:\/\//, '').split(/[?#]/)[0];
    const sameAsPage = got && got.replace(/^https?:\/\//, '').indexOf(pageKey) === 0;
    rec(`「${site.mustNotEqualPage}」没被写成当前页地址（本页跳过）`, !sameAsPage,
      got ? `值=${got}｜当前页=${site.url}` : '(空)');
  }

  rec('提示条有话说', !!notice, notice);

  // 再点一次：必须一个字符都不变（v2.5.74：直接点标题栏上的按钮，不再走 ⋯ 菜单）
  const fillBtn2 = await rectOf(cdp, '#crossSiteFill');
  if (fillBtn2) {
    await click(cdp, fillBtn2);
    await sleep(1200);
    const again = await readState(cdp);
    const same = again.found &&
      Object.keys(site.mustFill || {}).every((k) => (again.kv[k] || '') === (after.kv[k] || ''));
    rec('再点一次：一个字符都没变', same, again.found ? (again.notice || '(无提示)') : '浮窗已消失（页面刷新）');
  }

  if (DUMP) console.log('\n[DUMP] ' + JSON.stringify(after, null, 2));
  return report;
}

(async () => {
  console.log(`跨站补网址 真机验证｜扩展目录 ${EXT_DIR}`);
  if (!process.env.CLIPMATE_PROXY) {
    console.log('提示：没给 CLIPMATE_PROXY，TMDB / 番组计划很可能连不上（本机代理 127.0.0.1:7897）');
  }

  const { child, cdp, extId } = await launch();
  console.log(`扩展已加载｜ID = ${extId}`);

  const all = [];
  try {
    for (const site of SITES) {
      console.log(`\n[${site.id}] ${site.name}`);
      const r = await runSite(cdp, site);
      all.push({ site: site.id, name: site.name, steps: r, ok: r.length > 0 && r.every((x) => x.ok) });
    }
  } finally {
    try { child.kill(); } catch (e) {}
  }

  const bad = all.filter((s) => !s.ok);
  const total = all.reduce((n, s) => n + s.steps.length, 0);
  const passed = all.reduce((n, s) => n + s.steps.filter((x) => x.ok).length, 0);
  console.log('\n' + '='.repeat(52));
  if (!bad.length) {
    console.log(`结果：${passed}/${total} 通过（${all.length} 个站点全部通过）`);
    process.exit(0);
  } else {
    console.log(`结果：${passed}/${total} 通过，失败站点：${bad.map((b) => b.name).join('、')}`);
    bad.forEach((b) => b.steps.filter((s) => !s.ok).forEach((s) => console.log(`  ✗ ${b.name} / ${s.name}：${s.detail}`)));
    process.exit(1);
  }
})().catch((e) => {
  console.error('真机验证失败:', e.message);
  process.exit(1);
});
