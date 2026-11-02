// 浮窗按钮布局 · 真机验证（v2.5.74 / 批3 · 方案乙）
//
// 为什么要有这一步：
//   jsdom 量不出真实像素。方案乙的核心是「放不下就自己折行」，
//   而「放不放得下」完全取决于真浏览器的字号、内边距、按钮实际宽度，
//   jsdom 里没有任何渲染引擎，算出来的宽度恒为 0，只能靠真机量。
//
// 验什么：
//   A. 非编辑模式（影视页）：9 个按钮全部摊在标题栏，「⋯」按钮必须消失；
//      按钮不能溢出浮窗右边界；标题保底 120px；表格区域不能被挤没。
//   B. 折行行为：600px（默认宽）量一次行数，拖宽到 780px 再量一次 ——
//      宽了应该回到 1 行，这是「自适应」的定义。
//   C. 编辑模式：按钮集合换成 横向 / 重置顺序 / 取消 / 确认 / —，
//      不能出现「复制」「补齐网址」。
//   D. 点「复制纯文本」按钮：要真的走通复制链路（按钮原地变「已复制」）。
//   E. 截图存档，人眼确认观感。
//
// 用国内能直连的豆瓣电影页，不需要代理。
//
// 用法（项目根目录）：
//   node tests/buttons-live.js
//   node tests/buttons-live.js --no-shot     只量尺寸，不截图
//   CLIPMATE_EXT=<成品目录> node tests/buttons-live.js

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
const ARGV = process.argv.slice(2);
const NO_SHOT = ARGV.includes('--no-shot');

const PAGE_URL = 'https://movie.douban.com/subject/1292052/';
const DEFAULT_W = 600;
const WIDE_W = 780;

// 非编辑模式应该有这些按钮（id → 人话名）。少一个就是「藏起来了」，多一个也无所谓。
const EXPECT_NORMAL = [
  ['toggleDisplayMode', '横向/纵向'],
  ['enterEditMode', '编辑'],
  ['copyData', '复制Notion'],
  ['copyMarkdown', '复制Markdown'],
  ['copyPlainText', '复制纯文本'],
  ['crossSiteFill', '补齐网址'],
  ['searchToggle', '搜索'],
  ['resetFieldOrderBtn', '重置排序'],
  ['minimizeWindow', '最小化']
];

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
  const prof = path.join(os.tmpdir(), 'clipmate-buttons-' + Date.now());
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

/** 等页面真的加载完（不能只看 readyState，导航刚发出时旧文档本来就是 complete） */
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

async function click(cdp, point) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  }
}

/** 点页面上的提取按钮，等浮窗出表格 */
async function openFloating(cdp) {
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
  if (!btnPoint) return false;

  await click(cdp, btnPoint);

  const tDeadline = Date.now() + 20000;
  while (Date.now() < tDeadline) {
    await sleep(150);
    const ok = await cdp.evalJs(`(() => {
      const host = document.querySelector('.media-floating-window');
      if (!host || !host.shadowRoot) return false;
      const t = host.shadowRoot.querySelector('.data-table');
      return !!(t && t.querySelectorAll('tr').length > 2);
    })()`).catch(() => false);
    if (ok) return true;
  }
  return false;
}

/**
 * 量标题栏布局。
 * 行数按每行第一个按钮的 top 值去重算 —— 比用容器高度猜更准
 * （容器高度受行高、padding 影响，20px 和 30px 的差别不好定阈值）。
 */
async function measure(cdp) {
  const raw = await cdp.evalJs(`(() => {
    const host = document.querySelector('.media-floating-window');
    if (!host || !host.shadowRoot) return 'null';
    const sr = host.shadowRoot;
    const head = sr.querySelector('.floating-window-header');
    const title = sr.querySelector('.floating-window-title');
    const box = sr.querySelector('.floating-window-title-buttons');
    const content = sr.querySelector('.floating-window-content');
    if (!head || !box) return 'null';

    const hr = host.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    const items = [...box.children].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.id || el.className,
        text: (el.textContent || '').trim().slice(0, 12),
        top: Math.round(r.top),
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    });
    const tops = [...new Set(items.map((x) => x.top))].sort((a, b) => a - b);
    return JSON.stringify({
      hostW: Math.round(hr.width),
      hostH: Math.round(hr.height),
      hostLeft: Math.round(hr.left),
      hostRight: Math.round(hr.right),
      headH: Math.round(head.getBoundingClientRect().height),
      titleW: title ? Math.round(title.getBoundingClientRect().width) : 0,
      boxW: Math.round(br.width),
      boxH: Math.round(br.height),
      contentH: content ? Math.round(content.getBoundingClientRect().height) : 0,
      rows: tops.length,
      items: items,
      hasMore: !!sr.querySelector('#moreActions'),
      hasMenu: !!sr.querySelector('.clipmate-title-menu')
    });
  })()`).catch(() => 'null');
  if (!raw || raw === 'null') return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

async function shot(cdp, file) {
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return true;
  } catch (e) {
    return false;
  }
}

async function rectOf(cdp, selector) {
  const raw = await cdp.evalJs(`(() => {
    const host = document.querySelector('.media-floating-window');
    if (!host || !host.shadowRoot) return 'null';
    const el = host.shadowRoot.querySelector(${JSON.stringify(selector)});
    if (!el) return 'null';
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return 'null';
    return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  })()`).catch(() => 'null');
  return raw && raw !== 'null' ? JSON.parse(raw) : null;
}

async function main() {
  const report = [];
  const rec = (name, ok, detail) => {
    report.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
    console.log(`  ${ok ? '·' : '✗'} ${name}${detail !== undefined && detail !== '' ? '：' + detail : ''}`);
  };

  console.log('浮窗按钮布局 · 真机验证（批3 · 方案乙）');
  console.log('扩展目录：' + EXT_DIR);
  console.log('页面：' + PAGE_URL + '\n');

  const { child, cdp } = await launch();
  try {
    await cdp.send('Page.navigate', { url: PAGE_URL });
    const ready = await waitReady(cdp, PAGE_URL, 45000);
    if (!ready || ready.textLen <= 500) {
      console.log('页面没加载出来（textLen=' + (ready && ready.textLen) + '），网络问题，先解决网络再跑');
      return 1;
    }

    const opened = await openFloating(cdp);
    if (!opened) {
      console.log('点了提取但没出表格，先看提取链路');
      return 1;
    }

    // ---------- A. 非编辑模式：按钮全在 ----------
    console.log('\n一、非编辑模式（影视页，默认 600px 宽）');
    const m1 = await measure(cdp);
    if (!m1) { console.log('量不到布局'); return 1; }

    const ids = m1.items.map((x) => x.id);
    EXPECT_NORMAL.forEach((pair) => {
      rec(`「${pair[1]}」在标题栏上`, ids.indexOf(pair[0]) !== -1,
        ids.indexOf(pair[0]) !== -1 ? '' : '看不到这个按钮');
    });
    rec('「⋯」按钮已取消', !m1.hasMore, m1.hasMore ? '居然还在' : '已移除');
    rec('没有残留的下拉菜单', !m1.hasMenu, m1.hasMenu ? '菜单 DOM 还在' : '干净');

    const overflow = m1.items.filter((x) => x.right > m1.hostRight + 1);
    rec('没有按钮溢出浮窗右边界', overflow.length === 0,
      overflow.length ? overflow.map((x) => `${x.id} 右沿 ${x.right} > ${m1.hostRight}`).join('；') : '');

    /* v2.5.93：标题文字「媒体信息预览」已隐藏（腾出 120px 给按钮），
       所以这里反过来断言「标题宽度必须是 0/看不见」。
       原来的断言是「标题保底宽度 ≥ 120px」，那是旧版为了不让标题被挤成两个字而定下的，
       现在标题整块不显示了，这条必然失效。 */
    rec('标题文字已隐藏（宽度为 0）', m1.titleW === 0, `实际 ${m1.titleW}px`);
    rec('表格区域还在（没被标题栏挤没）', m1.contentH >= 100, `内容区高 ${m1.contentH}px`);

    console.log(`  · 布局：浮窗 ${m1.hostW}×${m1.hostH}｜标题栏高 ${m1.headH}｜按钮 ${m1.items.length} 个排 ${m1.rows} 行`);
    m1.items.forEach((x) => {
      console.log(`      ${String(x.id).padEnd(20)} ${String(x.text).padEnd(14)} x=${x.left}~${x.right} w=${x.width} top=${x.top}`);
    });
    rec(`默认 600px 宽时按钮占 ${m1.rows} 行（方案乙允许折行）`, m1.rows >= 1, '');
    if (!NO_SHOT) {
      const f1 = path.join(ROOT, 'v2.5.74_按钮布局_600px.png');
      rec('截图 600px', await shot(cdp, f1), f1);
    }

    // ---------- B. 拖宽后应该收成一行 ----------
    console.log('\n二、拖宽到 ' + WIDE_W + 'px（自适应：宽了应回一行）');
    await cdp.evalJs(`(() => {
      const host = document.querySelector('.media-floating-window');
      host.style.width = '${WIDE_W}px';
      return true;
    })()`);
    await sleep(400);
    const m2 = await measure(cdp);
    if (m2) {
      console.log(`  · 布局：浮窗 ${m2.hostW}px｜标题栏高 ${m2.headH}｜按钮 ${m2.items.length} 个排 ${m2.rows} 行`);
      rec('拖宽后行数不增加', m2.rows <= m1.rows, `${m1.rows} 行 → ${m2.rows} 行`);
      rec('拖宽后确实收成 1 行（宽度够就该一行）', m2.rows === 1, `实际 ${m2.rows} 行`);
      if (!NO_SHOT) {
        const f2 = path.join(ROOT, 'v2.5.74_按钮布局_780px.png');
        rec('截图 780px', await shot(cdp, f2), f2);
      }
    }
    // 还原宽度
    await cdp.evalJs(`(() => {
      const host = document.querySelector('.media-floating-window');
      host.style.width = '${DEFAULT_W}px';
      return true;
    })()`);
    await sleep(300);

    // ---------- C. 编辑模式 ----------
    console.log('\n三、编辑模式');
    const editBtn = await rectOf(cdp, '#enterEditMode');
    if (editBtn) {
      await click(cdp, editBtn);
      await sleep(600);
      const m3 = await measure(cdp);
      if (m3) {
        const ids3 = m3.items.map((x) => x.id);
        ['toggleDisplayMode', 'resetOrder', 'cancelEdit', 'confirmEdit', 'minimizeWindow'].forEach((id) => {
          rec(`编辑模式有「${id}」`, ids3.indexOf(id) !== -1, ids3.join(' / '));
        });
        rec('编辑模式没有「复制」类按钮', ids3.indexOf('copyData') === -1 && ids3.indexOf('copyPlainText') === -1, ids3.join(' / '));
        rec('编辑模式没有「补齐网址」', ids3.indexOf('crossSiteFill') === -1, ids3.join(' / '));
        console.log(`  · 编辑模式 ${m3.items.length} 个按钮排 ${m3.rows} 行｜标题栏高 ${m3.headH}`);
        if (!NO_SHOT) {
          const f3 = path.join(ROOT, 'v2.5.74_按钮布局_编辑模式.png');
          rec('截图 编辑模式', await shot(cdp, f3), f3);
        }
      }
      const cancel = await rectOf(cdp, '#cancelEdit');
      if (cancel) { await click(cdp, cancel); await sleep(600); }
    } else {
      rec('编辑模式按钮可点', false, '找不到 #enterEditMode');
    }

    // ---------- D. 复制纯文本按钮真能复制 ----------
    console.log('\n四、复制纯文本按钮（原来在 ⋯ 菜单里）');
    const copyBtn = await rectOf(cdp, '#copyPlainText');
    if (copyBtn) {
      await click(cdp, copyBtn);
      await sleep(700);
      const txt = await cdp.evalJs(`(() => {
        const host = document.querySelector('.media-floating-window');
        const el = host && host.shadowRoot && host.shadowRoot.querySelector('#copyPlainText');
        return el ? (el.textContent || '').trim() : '';
      })()`).catch(() => '');
      rec('点完按钮有原地反馈（已复制/复制失败）', /已复制|复制失败/.test(String(txt)), txt);
    } else {
      rec('复制纯文本按钮可点', false, '找不到 #copyPlainText');
    }

    // ---------- E. 重置排序按钮在（点了会弹提示，放最后以免干扰截图） ----------
    console.log('\n五、重置排序按钮（原来在 ⋯ 菜单里）');
    const resetBtn = await rectOf(cdp, '#resetFieldOrderBtn');
    rec('重置排序按钮可见可点', !!resetBtn, resetBtn ? `@${Math.round(resetBtn.x)},${Math.round(resetBtn.y)}` : '找不到');
  } finally {
    try { child.kill(); } catch (e) {}
  }

  const pass = report.filter((r) => r.ok).length;
  const fail = report.length - pass;
  console.log('\n' + '='.repeat(52));
  if (fail) {
    console.log(`✗ 失败 ${fail} 条，通过 ${pass} 条：`);
    report.filter((r) => !r.ok).forEach((r) => console.log(`   - ${r.name}：${r.detail}`));
  } else {
    console.log(`✅ 全部通过：${pass} 条断言`);
  }
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('跑挂了：' + (e && e.message));
  process.exit(1);
});
