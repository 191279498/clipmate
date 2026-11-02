/**
 * 快手「关闭自动连播 + 作者主页弹层」无头真机验收（v2.7.0）
 *
 * 为什么需要它：两件事都只能真机证明。
 *   ① 关连播靠的是**主世界**脚本在 document 捕获阶段拦 `ended` —— 单测只能在 jsdom 里模拟，
 *      真机上「扩展到底注进去了没有」「counter 会不会涨」必须实测。
 *   ② 作者主页弹层是**页内弹层**（地址不变、文档不换），单测证明不了按钮会不会跟着出现。
 *
 * 用法：node tests/kuaishou-live.js
 * 前置：C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe 存在。
 * `CLIPMATE_EXT=<目录>` 可指定验哪一版成品。
 *
 * 三条纪律：
 *  1. **临时 profile，不碰用户账号**（`--user-data-dir` 指到 tmp）。
 *  2. **伪装正常 Edge UA**：默认 UA 带 `HeadlessChrome`，快手风控会直接跳验证码。
 *     一旦发现验证码/风控页 → 立刻停手退出，不做任何重试（用户的 IP 已被风控过一次）。
 *  3. **导航次数压到最少**（2 次）：一次详情页、一次作者主页。不做反复刷新探测。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = process.env.CLIPMATE_EXT
  ? path.resolve(process.env.CLIPMATE_EXT)
  : path.join(ROOT, '发行包/ClipMate_采媒灵_v2.7.1_chrome');
const STAMP = Date.now();
const PROFILE = path.join(os.tmpdir(), 'cm-ks-live-' + STAMP);
const PORT = 9700 + (STAMP % 200);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

/** 真机抓过的地址（v2.7.0 勘察时打开过的两条） */
const DETAIL_URL = 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86?authorId=3xjspr8kqrpynxg';
const PROFILE_URL = 'https://www.kuaishou.com/profile/3xjspr8kqrpynxg';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let skipped = 0;
const fails = [];
function skip(name, why) { skipped++; console.log('  ⚠ skipped：' + name + '（' + why + '）'); }
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fails.push(name + (detail ? ' → ' + detail : '')); console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')); }
}

async function httpJson(url, method) {
  const r = await fetch(url, { method: method || 'GET' });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return t; }
}

/** 风控页判据：标题含「验证码」，或有可见的 verifycenter iframe */
const RISK_PROBE = `(function(){
  var vis = false;
  document.querySelectorAll('iframe[src*=verifycenter],iframe[src*=captcha]').forEach(function(f){
    var r = f.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) vis = true;
  });
  return {
    risk: /验证码|captcha|安全验证/i.test(document.title || '') || vis,
    title: (document.title || '').slice(0, 40),
    bodyLen: (document.body && document.body.innerText || '').length
  };
})()`;

const DETAIL_PROBE = `(function(){
  var btn = document.querySelector('.media-extractor-button');
  var v = document.querySelector('video');
  return {
    href: location.href.slice(0, 90),
    title: (document.title || '').slice(0, 40),
    bodyLen: (document.body && document.body.innerText || '').length,
    btn: document.querySelectorAll('.media-extractor-button').length,
    disp: btn ? getComputedStyle(btn).display : null,
    videos: document.querySelectorAll('video').length,
    hooked: window.__clipmateKsNoAutoplay === true,
    blockedCount: window.__clipmateKsNoAutoplayBlocked || 0,
    flag: document.documentElement.getAttribute('data-clipmate-ks-noautoplay'),
    loop: v ? v.loop : null,
    paused: v ? v.paused : null,
    dur: v ? Math.round(v.duration) : null
  };
})()`;

const PROFILE_PROBE = `(function(){
  var btn = document.querySelector('.media-extractor-button');
  var pop = document.querySelectorAll('.player-pop').length;
  var act = document.querySelector('.player-pop .swiper-slide-active');
  var cover = act ? act.querySelector('img.background') : null;
  var video = act ? act.querySelector('video') : null;
  var name = act ? act.querySelector('a.name') : null;
  var cap = act ? act.querySelector('.caption') : null;
  return {
    href: location.href.slice(0, 90),
    cards: document.querySelectorAll('.photo-card').length,
    pop: pop,
    btn: document.querySelectorAll('.media-extractor-button').length,
    disp: btn ? getComputedStyle(btn).display : null,
    activeCount: act ? 1 : 0,
    coverSrc: cover ? String(cover.getAttribute('src') || '').slice(0, 80) : '',
    hasVideo: !!video,
    videoSrc: video ? String(video.getAttribute('src') || '').slice(0, 80) : '',
    nick: name ? (name.textContent || '').trim() : '',
    cap: cap ? (cap.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) : '',
    mark: window.__cmMark || '',
    navCount: performance.getEntriesByType('navigation').length
  };
})()`;

async function main() {
  if (!fs.existsSync(EXT)) { console.error('成品不存在：' + EXT); process.exit(2); }
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--user-data-dir=' + PROFILE, '--load-extension=' + EXT,
    '--remote-debugging-port=' + PORT, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-features=Translate', '--mute-audio', 'about:blank'], { stdio: 'ignore' });

  let ws = null;
  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try { await httpJson('http://127.0.0.1:' + PORT + '/json/version'); up = true; break; } catch (e) {}
    }
    if (!up) { console.error('CDP 端口没起来'); process.exit(2); }

    const tab = await httpJson('http://127.0.0.1:' + PORT + '/json/new?about:blank', 'PUT');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    let id = 0; const waiting = new Map();
    ws.addEventListener('message', (evt) => {
      const m = JSON.parse(evt.data);
      if (m.id && waiting.has(m.id)) {
        const w = waiting.get(m.id); waiting.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      }
    });
    const send = (method, params) => new Promise((res, rej) => {
      const i = ++id; waiting.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails.exception;
        return 'ERR:' + ((d && d.description) || r.exceptionDetails.text);
      }
      return r.result.value;
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'zh-CN,zh;q=0.9', platform: 'Win32' });

    /* -------------------- A. 详情页：关连播 + 按钮 -------------------- */
    console.log('\nA. 详情页（关连播 + 按钮）');
    await send('Page.navigate', { url: DETAIL_URL });
    let a = null;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      const risk = await ev(RISK_PROBE);
      if (risk && risk.risk) {
        console.log('  ⛔ 命中风控（' + risk.title + '），立刻停手');
        console.log('\n结论：风控拦住了，本次不做真机验收（单测与快照仍然有效）');
        process.exit(3);
      }
      const s = await ev(DETAIL_PROBE);
      if (typeof s === 'string') continue;
      a = s;
      if (s.videos > 0 && s.btn > 0 && s.hooked) break;
    }
    console.log('    实测：' + JSON.stringify(a));

    // 游客态（临时 profile 没有登录）下详情页只有壳子：正文 27 字、视频没有时长。
    // 这不影响本脚本要验的两件事（主世界脚本注进去没有 / ended 拦得住不住），
    // 所以「有没有正文」只作为样本质量提示，不当作失败。
    if (a && a.bodyLen > 200) {
      ok('详情页正文正常加载', true);
    } else {
      skip('详情页正文内容（作者/文案/日期）', '游客态只有壳子，bodyLen=' + (a && a.bodyLen));
    }
    ok('主世界关连播脚本已注入（window.__clipmateKsNoAutoplay）', !!(a && a.hooked));
    ok('开关属性已写到 <html>（缺省 on）', !!(a && a.flag === 'on'), 'flag=' + (a && a.flag));
    ok('页面上有 <video>', !!(a && a.videos > 0), 'videos=' + (a && a.videos));
    ok('提取按钮已出现', !!(a && a.btn === 1 && a.disp !== 'none'),
      'btn=' + (a && a.btn) + ' display=' + (a && a.disp));

    // 真机派发一次 ended：页面自己的监听收不到 = 拦住了
    const before = (a && a.blockedCount) || 0;
    const fireRes = await ev(`(function(){
      var v = document.querySelector('video');
      if (!v) return 'no video';
      var pageGot = 0;
      window.__cmPageEnded = 0;
      v.addEventListener('ended', function(){ window.__cmPageEnded++; });
      v.dispatchEvent(new Event('ended'));
      return { pageGot: window.__cmPageEnded, blocked: window.__clipmateKsNoAutoplayBlocked || 0 };
    })()`);
    if (typeof fireRes === 'string') {
      skip('派发 ended 验拦截', fireRes);
    } else {
      console.log('    派发 ended：' + JSON.stringify(fireRes));
      ok('页面自己的 ended 回调被挡住（真机）', fireRes.pageGot === 0, 'pageGot=' + fireRes.pageGot);
      ok('拦截计数 +1', fireRes.blocked === before + 1, before + ' → ' + fireRes.blocked);
    }

    /* -------------------- B. 作者主页：点卡片出按钮 -------------------- */
    console.log('\nB. 作者主页（点开作品 → 弹层 → 按钮）');
    await send('Page.navigate', { url: PROFILE_URL });
    let b = null;
    for (let i = 0; i < 30; i++) {
      await sleep(700);
      const risk = await ev(RISK_PROBE);
      if (risk && risk.risk) {
        console.log('  ⛔ 命中风控（' + risk.title + '），立刻停手');
        process.exit(3);
      }
      const s = await ev(PROFILE_PROBE);
      if (typeof s === 'string') continue;
      b = s;
      if (s.cards > 0) break;
    }
    console.log('    主页：' + JSON.stringify({ cards: b.cards, btn: b.btn, disp: b.disp, href: b.href }));

    if (!b || b.cards === 0) {
      skip('主页点卡片出按钮（3 条）', '没拿到卡片（游客态主页可能要求登录）');
    } else {
      ok('主页上按钮是藏着的（没有弹层就不出按钮）',
        b.btn === 0 || b.disp === 'none', 'btn=' + b.btn + ' display=' + b.disp);

      await ev("window.__cmMark = 'alive';");
      const clicked = await ev(`(function(){
        var card = document.querySelector('.photo-card');
        if (!card) return 'none';
        card.click();
        return 'clicked';
      })()`);
      console.log('    点击：' + clicked);
      let c = null;
      for (let i = 0; i < 30; i++) {
        await sleep(600);
        const s = await ev(PROFILE_PROBE);
        if (typeof s === 'string') continue;
        c = s;
        if (s.pop > 0 && s.disp && s.disp !== 'none') break;
      }
      console.log('    弹层：' + JSON.stringify({
        pop: c.pop, active: c.activeCount, btn: c.btn, disp: c.disp, navCount: c.navCount,
        mark: c.mark, nick: c.nick, cap: c.cap, hasVideo: c.hasVideo
      }));

      ok('点开作品出现页内弹层（.player-pop）', c.pop > 0, 'pop=' + c.pop);
      ok('确实是页内弹层不换文档（标记还活着、导航条目仍为 1）',
        c.mark === 'alive' && c.navCount === 1, 'mark=' + c.mark + ' nav=' + c.navCount);
      ok('弹层里认出当前这一条', c.activeCount === 1, 'active=' + c.activeCount);
      ok('弹层打开后按钮出现（display≠none）',
        c.btn === 1 && c.disp !== 'none', 'btn=' + c.btn + ' display=' + c.disp);
      ok('弹层里有作者昵称', !!c.nick, c.nick);
    }

    /* -------------------- 汇总 -------------------- */
    console.log('\n' + '─'.repeat(56));
    if (fails.length === 0) {
      console.log('真机验收全通过：' + pass + ' 项' + (skipped ? '（另有 ' + skipped + ' 项因样本不合适跳过）' : ''));
      process.exit(0);
    }
    console.log('失败 ' + fails.length + ' 项 / 通过 ' + pass + ' 项');
    fails.forEach((f) => console.log('  ❌ ' + f));
    process.exit(1);
  } catch (e) {
    console.error('真机验收异常：' + (e && e.message));
    process.exit(2);
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    await sleep(600);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
}

main();
