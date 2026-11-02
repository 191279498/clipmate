#!/usr/bin/env node
/**
 * 真机验证：抖音「原始数据 + 弹窗界面接线」（v2.5.77 批 2 / 批 3）
 *
 * 单测（tests/douyin-modal-extract.test.js / douyin-modal-handler.test.js）能验证到
 * 「函数逻辑对不对」，但有几件事只能在真扩展里验，jsdom 一辈子测不出来：
 *
 *   ① background 的 `importScripts('douyin-fiber.js')` 能不能加载（路径对不对、SW 里有没有权限）
 *   ② `chrome.scripting.executeScript({world:'MAIN'})` 在 MV3 里能不能真的跑进页面环境
 *   ③ 注入到抖音页面后，拿到的到底是不是数字（不是 null、不是别人的数据）
 *   ④ 【批 3】69 个内容脚本真的注入到这个页面了没有：隔离环境里拿得到 `DouyinSpaMixin`
 *      和 `DouyinModalContext`，且**认得出作品时按钮贴着弹窗、认不出时一个都不出**
 *
 * 做法：用 CDP 启动真实 Chrome → Extensions.loadUnpacked 加载源码目录 →
 * 连到扩展的 service worker → 用 `chrome.scripting.executeScript` 在页面的隔离世界里取事实。
 *
 * ⚠️ 这一步**不需要抖音登录态**：未登录时字段会是 null、弹层可能起不来，
 *    但「注入成功、不抛错、按钮该出/不该出的判断对不对」照样能证明。
 *    实测弹层约 6~9 秒才渲染，所以批 3 那段是**轮询等**（最多 25 秒）而不是固定 sleep。
 *
 * 用法：
 *   node tests/douyin-fiber-sw-check.js
 *   node tests/douyin-fiber-sw-check.js --modal=7672265848853220618   指定要读的作品
 *   node tests/douyin-fiber-sw-check.js --no-page                     只查 SW，不开抖音页面
 *
 * 依赖：本机 Chrome（路径可用 CHROME_PATH 覆盖）。
 */
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

const ARGV = process.argv.slice(2);
const MODAL = (ARGV.find((a) => a.startsWith('--modal=')) || '').split('=')[1] || '7672265848853220618';
const NO_PAGE = ARGV.includes('--no-page');

const PORT = 9500 + Math.floor(Math.random() * 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};
let pass = 0;
const failures = [];
function ok(name, detail) {
  pass++;
  console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function truthy(name, v) {
  if (v) ok(name, typeof v === 'string' ? v : '');
  else bad(name, '期望真值，实际 ' + JSON.stringify(v));
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

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
      throw new Error('SW 脚本出错: ' + String(d || '').slice(0, 200));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, evalJs, close: () => ws.close() };
}

async function launch() {
  const prof = path.join(os.tmpdir(), 'clipmate-fiber-' + Date.now());
  fs.mkdirSync(prof, { recursive: true });
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${prof}`,
      '--headless=new',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=1440,1000',
      'about:blank'
    ],
    { stdio: 'ignore', windowsHide: true }
  );

  let ver = null;
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    try {
      ver = await getJson('/json/version');
      if (ver) break;
    } catch (e) { /* 继续等 */ }
  }
  if (!ver) throw new Error('Chrome 没起来（等不到 CDP 端口）');
  return { child, ver };
}

async function findSwTarget(extId, tries) {
  for (let i = 0; i < tries; i++) {
    const list = await getJson('/json/list').catch(() => []);
    const sw = list.find((t) => t.type === 'service_worker' && String(t.url).includes(extId));
    if (sw) return sw;
    await sleep(250);
  }
  return null;
}

(async () => {
  console.log(`${C.cyan}抖音原始数据 · 注入链路真机验证（v2.5.77 批 2）${C.reset}`);
  console.log(`${C.gray}扩展目录 ${EXT_DIR}${C.reset}`);

  let child = null;
  let cdpPage = null;
  let sw = null;
  try {
    const launched = await launch();
    child = launched.child;

    // ① 加载扩展
    const br = await openWs(launched.ver.webSocketDebuggerUrl);
    let extId = '';
    try {
      const r = await br.send('Extensions.loadUnpacked', { path: EXT_DIR });
      extId = r && r.id ? r.id : '';
    } finally {
      br.close();
    }
    if (!extId) throw new Error('Extensions.loadUnpacked 没返回扩展 ID');
    ok('扩展加载成功', extId);

    // ② 等 SW 出现（MV3 会休眠，这里给它一点时间；没出现也没关系，下一步会唤醒）
    let swTarget = await findSwTarget(extId, 20);

    if (!swTarget) {
      // 打开一个真实站点，让 content script 发消息 → 唤醒 SW
      const list = await getJson('/json/list');
      const pageTarget = list.find((t) => t.type === 'page');
      cdpPage = await openWs(pageTarget.webSocketDebuggerUrl);
      await cdpPage.send('Page.enable');
      await cdpPage.send('Page.navigate', { url: 'https://book.douban.com/subject/1084336/' });
      await sleep(4000);
      swTarget = await findSwTarget(extId, 40);
    }
    truthy('扩展的 service worker 起来了', swTarget ? swTarget.url.split('/').pop() : '');

    if (swTarget) {
      sw = await openWs(swTarget.webSocketDebuggerUrl);
      await sw.send('Runtime.enable');

      // ③ 关键断言一：importScripts 有没有把函数加载进 SW
      const probe = await sw.evalJs(`JSON.stringify({
        hasReader: typeof readDouyinAwemeInfo,
        hasScripting: !!(chrome.scripting && chrome.scripting.executeScript),
        hasTabs: !!(chrome.tabs && chrome.tabs.query),
        version: chrome.runtime.getManifest().version,
        fiberInScripts: (chrome.runtime.getManifest().web_accessible_resources || []).length
      })`);
      const p = JSON.parse(probe || '{}');
      eq('SW 里能拿到 readDouyinAwemeInfo（importScripts 成功）', p.hasReader, 'function');
      truthy('SW 里 chrome.scripting.executeScript 可用', p.hasScripting);
      truthy('SW 里 chrome.tabs.query 可用', p.hasTabs);
      // 版本号跟 manifest 对一遍（不写死版本，免得每次升级都误报）
      const manifestVer = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')).version;
      eq('SW 读到的版本号与 manifest 一致', p.version, manifestVer);

      // ④ 关键断言二：世界注入能不能跑进页面环境（用「页面里有 window.xxx、隔离环境没有」来判）
      if (!NO_PAGE) {
        let pageCdp = cdpPage;
        let ownPage = false;
        if (!pageCdp) {
          const list = await getJson('/json/list');
          const pageTarget = list.find((t) => t.type === 'page');
          pageCdp = await openWs(pageTarget.webSocketDebuggerUrl);
          ownPage = true;
        }
        await pageCdp.send('Page.enable');
        await pageCdp.send('Page.navigate', { url: `https://www.douyin.com/jingxuan?modal_id=${MODAL}` });
        await sleep(7000);

        // 在 SW 里调 executeScript：先在页面环境放一个记号函数，再读回来
        const injectResult = await sw.evalJs(`(async () => {
          try {
            const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
            if (!tabs.length) return JSON.stringify({ error: '没有 douyin 标签页' });
            const tabId = tabs[0].id;
            const probe = await chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: function () {
                return { href: location.href, hasFiberKey: (function () {
                  var n = document.querySelectorAll('*');
                  for (var i = 0; i < n.length; i++) {
                    var ks = Object.keys(n[i]);
                    for (var j = 0; j < ks.length; j++) if (ks[j].indexOf('__reactFiber$') === 0) return ks[j];
                  }
                  return null;
                })() };
              }
            });
            const real = await chrome.scripting.executeScript({
              target: { tabId },
              world: 'MAIN',
              func: readDouyinAwemeInfo,
              args: ['${MODAL}']
            });
            return JSON.stringify({
              ok: true,
              tabId,
              probe: probe && probe[0] ? probe[0].result : null,
              meta: real && real[0] ? real[0].result : null,
              error: null
            });
          } catch (e) {
            return JSON.stringify({ ok: false, error: String(e && e.message) });
          }
        })()`);

        const r = JSON.parse(injectResult || '{}');
        if (!r.ok) {
          bad('从 SW 注入到抖音页面', r.error);
        } else {
          truthy('world:MAIN 注入成功（页面环境能跑）', r.probe && r.probe.href);
          if (r.probe) eq('注入看得到页面地址', String(r.probe.href).indexOf('douyin.com') > 0, true);
          if (r.probe && r.probe.hasFiberKey) {
            ok('页面里确实有 React fiber 挂载点', r.probe.hasFiberKey);
          } else {
            bad('页面里没找到 __reactFiber$ 挂载点', '页面可能还没渲染完 / 未登录');
          }
          if (r.meta) {
            ok('注入读到了作品原始数据', `id=${r.meta.awemeId} 昵称=${r.meta.nickname} 时间=${r.meta.createTime}`);
            eq('读到的就是请求的那一条', String(r.meta.awemeId), MODAL);
          } else {
            console.log(`  ${C.yellow}⚠${C.reset} 注入成功但没读到数据（未登录 / 弹窗未出现 / 作品不可见），属可接受情况`);
          }
        }
        if (ownPage) pageCdp.close();

        /* ---------- ⑤ 批 3：弹窗界面接线在真扩展里到底加载了没有 ----------
           为什么这条只能在真机做：`DouyinSpaMixin` / `DouyinModalContext` 是内容脚本
           隔离环境里的全局，jsdom 测试是把源码当普通脚本塞进页面，天生看不到
           「Chrome 到底把这 69 个脚本注入到这个页面了没有」这一层。

           判据不依赖登录态，但要**等**：
           实测弹层大约 6~9 秒才渲染出来（t≈2s 时连 modal-video-container 都还没有），
           在那之前「认不出作品 → 不出按钮」是正确行为。所以这里轮询到认出作品为止，
           最多等 25 秒；等不到就按「弹层没出现」处理，断言「一个按钮都不许有」。 */
        let u = null;
        for (let i = 0; i < 25; i++) {
          u = JSON.parse(await sw.evalJs(`(async () => {
            try {
              const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' });
              if (!tabs.length) return JSON.stringify({ error: '没有 douyin 标签页' });
              const tabId = tabs[0].id;
              const r = await chrome.scripting.executeScript({
                target: { tabId },
                func: function () {
                  var ctx = (typeof DouyinModalContext !== 'undefined') ? DouyinModalContext : null;
                  var open = null, workId = '';
                  try { open = !!(ctx && typeof ctx.isOpen === 'function' && ctx.isOpen(document)); }
                  catch (e) { open = 'throw'; }
                  try { workId = (ctx && typeof ctx.getWorkId === 'function') ? String(ctx.getWorkId(document) || '') : ''; }
                  catch (e) { workId = ''; }
                  var btns = document.querySelectorAll('.media-extractor-button');
                  var inst = (typeof mediaExtractorInstance !== 'undefined') ? mediaExtractorInstance : null;
                  var box = document.querySelector('[data-e2e="modal-video-container"]');
                  return {
                    hasMixin: typeof DouyinSpaMixin,
                    hasWatcher: !!(ctx && typeof ctx.watch === 'function'),
                    open: open,
                    workId: workId,
                    buttons: btns.length,
                    anchor: btns.length ? btns[0].getAttribute('data-clipmate-anchor') : null,
                    disabled: btns.length ? !!btns[0].disabled : null,
                    // 下面四个只用于「等不到就打印原因」，不参与真假判定
                    hasBox: !!box,
                    initialized: !!(inst && inst.isInitialized),
                    watched: !!(inst && inst._douyinWatch)
                  };
                }
              });
              return JSON.stringify({ ok: true, r: r && r[0] ? r[0].result : null });
            } catch (e) {
              return JSON.stringify({ ok: false, error: String(e && e.message) });
            }
          })()`));
          if (!u || !u.ok) break;
          if (u.r && u.r.workId) break;
          await sleep(1000);
        }

        if (!u || !u.ok) {
          bad('批 3：查弹窗界面接线', (u && u.error) || '注入没返回结果');
        } else if (!u.r) {
          bad('批 3：查弹窗界面接线', '注入没返回结果');
        } else {
          eq('批 3：内容脚本里拿得到 DouyinSpaMixin', u.r.hasMixin, 'object');
          eq('批 3：DouyinModalContext.watch 可用', u.r.hasWatcher, true);
          eq('批 3：弹窗监听已挂上', u.r.watched, true);
          if (u.r.workId) {
            // 认得出是哪一条 → 必须接管，且按钮贴着弹窗
            eq('批 3：认得出作品 → 恰好 1 个按钮', u.r.buttons, 1);
            eq('批 3：按钮贴着弹窗锚点', u.r.anchor, 'douyin-modal');
            eq('批 3：按钮可点（没 disabled）', u.r.disabled, false);
            eq('批 3：接管后实例已初始化', u.r.initialized, true);
            console.log(`  ${C.gray}（真机认出的作品：${u.r.workId}）${C.reset}`);
          } else {
            // 认不出（未上线弹层 / 被登录墙拦住）→ 宁空不错：一个按钮都不许有、也不许初始化
            eq('批 3：认不出作品 → 一个按钮都不许有', u.r.buttons, 0);
            eq('批 3：认不出作品 → 实例不许初始化', u.r.initialized, false);
            console.log(`  ${C.gray}（等待 25s 仍认不出作品：isOpen=${JSON.stringify(u.r.open)} 弹层容器=${u.r.hasBox}；按「宁空不错」不出按钮，属可接受）${C.reset}`);
          }
        }
      }
    }
  } catch (e) {
    bad('流程异常', e && e.message);
  } finally {
    try { if (sw) sw.close(); } catch (e) { /* ignore */ }
    try { if (cdpPage) cdpPage.close(); } catch (e) { /* ignore */ }
    try { if (child) child.kill(); } catch (e) { /* ignore */ }
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}通过 ${pass} 项，失败 ${failures.length} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}✗${C.reset} ${f.name}${f.detail ? '  ' + f.detail : ''}`));
  process.exit(1);
})();
