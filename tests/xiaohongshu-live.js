/**
 * 小红书「全站动态适配」无头真机验收（v2.6.0）
 *
 * 为什么要这个脚本：小红书笔记详情是**页内弹层**（换地址不换文档），
 * 光跑单测证明不了「按钮会不会跟着出现/消失」「桥里的数据对不对」。
 * 这里用 headless Edge + 加载成品扩展 + CDP 驱动，全程不碰用户账号。
 *
 * 用法：node tests/xiaohongshu-live.js
 * 前置：C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe 存在；能上外网。
 *
 * 两条纪律（踩过坑）：
 *  1. 必须 Emulation.setUserAgentOverride 换成正常 Edge UA —— 默认 UA 带 HeadlessChrome，
 *     小红书风控直接跳 website-login/error?error_code=300012「IP存在风险」，卡片永远是 0。
 *  2. 页面上可能弹登录浮层挡住卡片点击，先摘掉 .reds-alert* 那几层再点。
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 默认验最新成品；用 CLIPMATE_EXT=<目录> 可以验别的版本（新旧对照实验）
const EXT = process.env.CLIPMATE_EXT
  ? path.resolve(process.env.CLIPMATE_EXT)
  : path.join(ROOT, '发行包/ClipMate_采媒灵_v2.6.1_chrome');
const STAMP = Date.now();
const PROFILE = path.join(os.tmpdir(), 'cm-xhs-live-' + STAMP);
const PORT = 9700 + (STAMP % 200);
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

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

// 每一拍都先摘登录浮层，再读状态
const PROBE = `(function(){
  try {
    document.querySelectorAll('.reds-alert-mask, .reds-alert-wrapper, .reds-alert, .login-container, .sign-in-container')
      .forEach(function(n){ n.remove(); });
  } catch (e) {}
  var b = document.querySelector('.media-extractor-button');
  var w = document.querySelector('.media-floating-window');
  var sr = w && w.shadowRoot;
  // 只取内容区：shadowRoot.textContent 会把 <style> 里的 CSS 也算进正文，
  // 上一版就因此把「.floating-window-header{...}」当成浮窗内容，判定全乱。
  var contentEl = sr ? (sr.querySelector('.floating-window-content') || sr.querySelector('.data-table')) : null;
  var bridge = null;
  try {
    var node = document.getElementById('clipmate-xhs-note');
    if (node && node.textContent) bridge = JSON.parse(node.textContent);
  } catch (e) { bridge = 'PARSE_ERR'; }
  var note = bridge && bridge.note ? bridge.note : null;
  return {
    href: location.href,
    mark: window.__cmMark || '',
    navCount: performance.getEntriesByType('navigation').length,
    cards: document.querySelectorAll('section.note-item').length,
    btn: document.querySelectorAll('.media-extractor-button').length,
    disp: b ? getComputedStyle(b).display : null,
    vis: b ? getComputedStyle(b).visibility : null,
    mask: document.querySelectorAll('.note-detail-mask').length,
    win: document.querySelectorAll('.media-floating-window').length,
    winText: contentEl ? (contentEl.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 1500) : '',
    urlId: bridge && typeof bridge === 'object' ? bridge.urlId : null,
    note: note ? {
      noteId: note.noteId || '', title: (note.title || '').slice(0, 40),
      desc: (note.desc || '').slice(0, 40),
      nickname: note.nickname || '', userId: note.userId || '',
      time: note.time || 0
    } : null
  };
})()`;

async function main() {
  if (!fs.existsSync(EXT)) { console.error('成品不存在：' + EXT); process.exit(2); }
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(EDGE, ['--headless=new', '--user-data-dir=' + PROFILE, '--load-extension=' + EXT,
    '--remote-debugging-port=' + PORT, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-features=Translate', 'about:blank'], { stdio: 'ignore' });

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

    /* -------------------- A. 探索首页（列表页） -------------------- */
    console.log('\nA. 探索首页 /explore');
    await send('Page.navigate', { url: 'https://www.xiaohongshu.com/explore' });
    let a = null;
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      const s = await ev(PROBE);
      if (typeof s === 'string') { console.log('    探针错：' + s); continue; }
      a = s;
      if (s.cards > 0 && s.btn > 0) break;
    }
    console.log('    实测：' + JSON.stringify({ cards: a.cards, btn: a.btn, disp: a.disp, urlId: a.urlId, navCount: a.navCount }));
    ok('探索页能拿到卡片（≥10）', a.cards >= 10, 'cards=' + a.cards);
    ok('探索页按钮存在（构造时插入）', a.btn === 1, 'btn=' + a.btn);
    ok('探索页按钮是藏着的（这一页没有单条笔记）', a.disp === 'none', 'display=' + a.disp);
    ok('探索页桥上 urlId 为空串（明确告诉脚本「这页没笔记」）', a.urlId === '', 'urlId=' + JSON.stringify(a.urlId));
    ok('探索页没有浮窗', a.win === 0, 'win=' + a.win);

    /* -------------------- B. 点卡片进笔记（弹层） -------------------- */
    console.log('\nB. 点开一张卡片（页内弹层，不换文档）');
    await ev("window.__cmMark = 'alive';");
    const beforeNav = a.navCount;

    // v2.6.1 要验「话题井号被清掉」，样本必须**真的带话题**才有说服力。
    // 首页卡片随机，所以最多换 4 张，专挑一手文案里带 `#` 的那张；
    // 4 张都不带就照常继续，并把清理那两条改成 skipped（不假装通过）。
    let b = null;
    let topicSample = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const clicked = await ev(`(function(){
        var cards = document.querySelectorAll('section.note-item');
        var idx = ${'${attempt}'};
        var card = cards[idx] || cards[0];
        if (!card) return 'none';
        var al = card.querySelector('a[href*="xsec_token"]');
        if (al) { al.click(); return 'anchor'; }
        var cov = card.querySelector('.cover');
        if (cov) { cov.click(); return 'cover'; }
        return 'none';
      })()`.replace('${attempt}', String(attempt)));
      console.log('    第 ' + (attempt + 1) + ' 张，点击：' + clicked);
      if (clicked === 'none') break;
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        const s = await ev(PROBE);
        if (typeof s === 'string') continue;
        b = s;
        if (/\/explore\/[0-9a-f]{24}/i.test(s.href) && s.disp && s.disp !== 'none' && s.note) break;
      }
      const rawDesc = (b && b.note) ? await ev(`(function(){
        try { var p = JSON.parse(document.getElementById('clipmate-xhs-note').textContent);
              return (p && p.note && (p.note.desc || '')) || ''; } catch (e) { return ''; }
      })()`) : '';
      if (typeof rawDesc === 'string' && rawDesc.indexOf('#') > -1) { topicSample = true; break; }
      console.log('    这张文案里没有话题，换一张');
      await ev('history.back()');
      await sleep(2000);
    }
    console.log('    是否含话题样本：' + (topicSample ? '是' : '否（4 张都没话题）'));
    const urlNoteId = (String(b.href).match(/\/explore\/([0-9a-f]{24})/i) || [])[1] || '';
    console.log('    地址：' + String(b.href).slice(0, 60));
    console.log('    实测：' + JSON.stringify({ mask: b.mask, btn: b.btn, disp: b.disp, urlId: b.urlId, navCount: b.navCount, mark: b.mark }));
    console.log('    桥数据：' + JSON.stringify(b.note));

    ok('点开后地址变成 /explore/<24 位笔记 ID>', !!urlNoteId, String(b.href).slice(0, 80));
    ok('笔记弹层出现（.note-detail-mask = 1）', b.mask === 1, 'mask=' + b.mask);
    ok('按钮变成可见（display 不是 none）', !!b.disp && b.disp !== 'none', 'display=' + b.disp);
    ok('按钮只有一个（不叠两个）', b.btn === 1, 'btn=' + b.btn);
    ok('整个过程没有整页重载（标记还活着）', b.mark === 'alive', 'mark=' + b.mark);
    ok('导航条目没增加（确认是弹层不是新文档）', b.navCount === beforeNav, beforeNav + ' → ' + b.navCount);
    ok('桥里 urlId 等于地址里的笔记 ID（不串台）', b.urlId === urlNoteId, b.urlId + ' vs ' + urlNoteId);
    ok('桥里有笔记对象', !!b.note);
    if (b.note) {
      ok('桥里拿到了作者昵称', !!b.note.nickname, JSON.stringify(b.note.nickname));
      ok('桥里拿到了作者 userId', !!b.note.userId, JSON.stringify(b.note.userId));
      ok('桥里拿到了发布时间（毫秒戳）', Number(b.note.time) > 1000000000000, String(b.note.time));
      ok('桥里有标题或正文（至少一份）', !!(b.note.title || b.note.desc),
        JSON.stringify({ t: b.note.title, d: b.note.desc }));
    }

    /* -------------------- C. 点按钮 → 浮窗出数据 -------------------- */
    console.log('\nC. 点提取按钮，看浮窗数据');
    const btnRect = await ev(`(function(){
      var b = document.querySelector('.media-extractor-button');
      if (!b) return null;
      var r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), txt: (b.textContent||'').trim() };
    })()`);
    console.log('    按钮几何：' + JSON.stringify(btnRect));
    ok('按钮有实际尺寸（不是 0 宽 0 高）', !!btnRect && btnRect.w > 0 && btnRect.h > 0, JSON.stringify(btnRect));

    await ev(`(function(){ var b = document.querySelector('.media-extractor-button'); if (b) b.click(); return 'ok'; })()`);
    let c = null;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      const s = await ev(PROBE);
      if (typeof s === 'string') continue;
      c = s;
      if (s.win > 0 && s.winText) break;
    }
    console.log('    浮窗文本：' + (c.winText || '(空)').slice(0, 500));
    ok('浮窗出来了', c.win === 1, 'win=' + c.win);
    ok('浮窗里有内容', !!c.winText && c.winText.length > 20, String(c.winText).length + ' 字');
    const wt = String(c.winText || '');
    ok('浮窗里有昵称', !!b.note && wt.indexOf(b.note.nickname) > -1, b.note && b.note.nickname);
    ok('文案里没有「小时前」这类相对时间脏词', wt.indexOf('小时前') < 0 && wt.indexOf('分钟前') < 0,
      (wt.match(/.{0,8}(小时前|分钟前).{0,8}/) || [])[0] || '');
    ok('文案里没有「点赞/收藏/评论」这类界面词',
      !/点赞|收藏|评论\s*\d/.test(wt), (wt.match(/.{0,8}(点赞|收藏|评论).{0,8}/) || [])[0] || '');
    ok('日期是「YYYY年MM月DD日」形态', /20\d{2}年\d{2}月\d{2}日/.test(wt),
      (wt.match(/20\d{2}年\d{2}月\d{2}日[^\s]*/) || [])[0] || '');
    ok('作者主页带 xiaohongshu.com/user/profile/', /xiaohongshu\.com\/user\/profile\//.test(wt),
      (wt.match(/https?:\/\/[^\s"']*user\/profile\/[^\s"']*/) || [])[0] || '');
    // 标题规范：昵称 + 文案前 20 字 + '-' + 日期到秒（段间无空格，和快手/TikTok 同一套）
    // 注意昵称里的标点/emoji 会被标题处理器剥掉（「怡宝^」→「怡宝」，「一只墩墩🏠」→「一只墩墩」），
    // 所以比对前缀前先把昵称也洗一遍，否则断言会误报。
    const titleCell = (wt.match(/本页标题\s*(.{0,140}?)\s*作者ID/) || [])[1] || '';
    const bareNick = String((b.note && b.note.nickname) || '').replace(/[^\w\u4e00-\u9fa5]/g, '');
    ok('标题形态是「昵称+文案前 20 字-日期到秒」',
      !!bareNick && titleCell.indexOf(bareNick) === 0 && /-\d{4}年\d{2}月\d{2}日\d{6}$/.test(titleCell),
      titleCell || '(没抓到标题格)');
    // v2.6.1：话题清理。样本必须真的是带话题那条，否则这两条毫无意义（宁可 skipped）
    const textCell = (wt.match(/本页文案\s*([\s\S]*?)\s*URL/) || [])[1] || '';
    if (topicSample) {
      ok('本页文案里没有话题井号（`#ABC` → `ABC`）', textCell.indexOf('#') < 0,
        (textCell.match(/.{0,12}#.{0,12}/) || [])[0] || '');
      ok('本页文案里没有 [话题] 标记', textCell.indexOf('[话题]') < 0,
        (textCell.match(/.{0,12}\[话题\].{0,12}/) || [])[0] || '');
      console.log('    （样本）本页文案：' + textCell.slice(0, 120));
    } else {
      skip('话题清理两条', '这次点开的 4 张卡片文案都不含话题');
    }
    // 作者ID 依赖「抓作者主页 HTML 再解析小红书号」，无头 profile 没有登录态，
    // 主页会回一个 userPageData:{} 的空壳，必然抓不到。这条只做观察，不判死。
    const authorIdCell = (wt.match(/作者ID\s*(.{0,40}?)\s*作者昵称/) || [])[1] || '';
    console.log('    （观察项）作者ID：' + (authorIdCell ? JSON.stringify(authorIdCell) : '空 —— 无登录态抓不到主页，属环境限制'));

    /* -------------------- D. 后退回列表（按钮与浮窗一起走） -------------------- */
    console.log('\nD. 关掉笔记（后退回 /explore）');
    await ev('history.back()');
    let d = null;
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const s = await ev(PROBE);
      if (typeof s === 'string') continue;
      d = s;
      if (!/\/explore\/[0-9a-f]{24}/i.test(s.href) && s.disp === 'none') break;
    }
    console.log('    实测：' + JSON.stringify({ href: String(d.href).slice(0, 55), disp: d.disp, win: d.win, urlId: d.urlId, mark: d.mark }));
    ok('地址回到列表页（没有笔记 ID）', !/\/explore\/[0-9a-f]{24}/i.test(d.href), String(d.href).slice(0, 80));
    ok('按钮重新藏起来', d.disp === 'none', 'display=' + d.disp);
    ok('浮窗跟着一起消失（v2.6.0 重点）', d.win === 0, 'win=' + d.win);
    ok('全程还是同一个文档（标记仍在）', d.mark === 'alive', 'mark=' + d.mark);
    ok('桥上 urlId 清空（不再残留旧笔记）', d.urlId === '', 'urlId=' + JSON.stringify(d.urlId));

    /* -------------------- 汇总 -------------------- */
    console.log('\n' + '='.repeat(56));
    if (fails.length === 0) {
      console.log('真机验收全通过：' + pass + ' 项' + (skipped ? '（另有 ' + skipped + ' 项因样本不合适跳过）' : ''));
    } else {
      console.log('真机验收：通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
      fails.forEach((f) => console.log('  ✗ ' + f));
    }
    console.log('='.repeat(56));
    process.exit(fails.length === 0 ? 0 : 1);
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { child.kill('SIGKILL'); } catch (e) {}
    await sleep(300);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch((e) => { console.error('脚本挂了：' + e.message); process.exit(2); });
