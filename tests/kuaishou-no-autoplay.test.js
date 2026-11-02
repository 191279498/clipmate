#!/usr/bin/env node
/**
 * 快手「强制关闭自动连播」验收（v2.7.0）
 *
 * 要钉住的事：**作品播完必须停住**（弹层不自动切下一条、详情页不播完重播），
 * 而且这个功能要能被设置页的开关关掉、且关掉后真的立刻放行。
 *
 * 真机证据（2026-10-29 21:50，借用户 Edge）：
 *   | 场景 | 拦 `ended` 之前 | 拦之后 |
 *   | 主页弹层 | 20 秒自己切了 2 条 | 停在最后、`paused: true`、文案没变 |
 *   | 详情页   | 播完重头再来（11.8s → 3.4s） | 停在最后（14.5 === 14.5）、地址标题都没变 |
 *
 * 技术上唯一可行的路：**MAIN world + document_start + document 捕获阶段拦 `ended`**。
 * 隔离世界（默认内容脚本）的 `stopImmediatePropagation()` 只能挡住隔离世界自己的监听器，
 * 挡不住页面自己的 —— 两个世界的事件监听表是分开的。
 *
 * 本脚本六节：
 *   一、脚本文本：站点门禁第一行、幂等标记、capture、stopImmediatePropagation、loop 兜底
 *   二、真跑一遍（jsdom）：页面自己的 ended 回调被挡住 / 开关关掉后放行
 *   三、幂等：重复注入不叠监听
 *   四、loop 兜底：`loop=true` 会被强制关掉；开关关掉后不碰
 *   五、开关桥：存储 → `<html data-clipmate-ks-noautoplay>`，含变更监听与站点门禁
 *   六、接线：manifest 块位置与 options 开关
 *
 * 用法：
 *   node tests/kuaishou-no-autoplay.test.js
 *   node tests/kuaishou-no-autoplay.test.js --verbose
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const NOAUTO_PATH = path.join(ROOT, 'src/content/kuaishou-no-autoplay.js');
const FLAG_PATH = path.join(ROOT, 'src/content/kuaishou-no-autoplay-flag.js');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  cyan: '\u001b[36m', gray: '\u001b[90m'
};

let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✅${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}❌${C.reset} ${name}${detail ? C.gray + '  ' + detail + C.reset : ''}`);
}
function eq(name, actual, expected) {
  if (actual === expected) ok(name, JSON.stringify(actual));
  else bad(name, `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function truthy(name, actual, detail) {
  if (actual) ok(name, detail);
  else bad(name, '期望真值，实际 ' + JSON.stringify(actual));
}
function falsy(name, actual, detail) {
  if (!actual) ok(name, detail);
  else bad(name, '期望假值/空，实际 ' + JSON.stringify(actual));
}
function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

const SRC = fs.readFileSync(NOAUTO_PATH, 'utf8');
const FLAG_SRC = fs.readFileSync(FLAG_PATH, 'utf8');

/** 快手详情页的最小形态：有一个 video */
function pageHtml(extra) {
  return `<!doctype html><html><head><title>快手</title></head><body>
<div class="video-container"><video id="v" src="https://v1.a.yximgs.com/upic/2026/10/23/x.mp4"></video></div>
${extra || ''}
</body></html>`;
}

/**
 * 在 jsdom 里真跑一遍脚本。
 *
 * `setInterval` 被换成一个只记录回调的桩：脚本里那条 2 秒巡检不该在单测里真的跑，
 * 由测试自己手动调一次，才能稳定断言。
 */
function runScript(html, url, flagValue) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const win = dom.window;
  if (flagValue !== undefined) {
    win.document.documentElement.setAttribute('data-clipmate-ks-noautoplay', flagValue);
  }
  const intervals = [];
  win.setInterval = (fn, ms) => {
    intervals.push({ fn, ms });
    return intervals.length;
  };
  win.eval(SRC);
  return { dom, win, doc: win.document, intervals };
}

/* ======================== 一、脚本文本 ======================== */

function section1() {
  section('一、脚本文本：站点门禁 / 幂等 / capture / 拦截手段');

  const gateIdx = SRC.indexOf("location.hostname !== 'www.kuaishou.com'");
  truthy('[文] 有站点门禁', gateIdx > -1);
  // 「第一行」是硬要求：本项目的共享注入脚本第一行必须自判宿主，否则别的站也会跑到
  const firstCodeLine = SRC.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
  }).slice(0, 4).join('\n');
  truthy('[文] 门禁落在最前面几行里（不是藏在函数里）',
    firstCodeLine.indexOf('www.kuaishou.com') > -1, firstCodeLine.replace(/\n/g, ' ⏎ '));

  truthy('[文] 有幂等标记', SRC.indexOf('window.__clipmateKsNoAutoplay') > -1);
  truthy('[文] 用捕获阶段监听 ended',
    /addEventListener\('ended', onEnded, true\)/.test(SRC));
  truthy('[文] 用的是 stopImmediatePropagation（不是 stopPropagation）',
    SRC.indexOf('stopImmediatePropagation()') > -1);
  truthy('[文] 有 loop=false 兜底', /vs\[i\]\.loop = false/.test(SRC));
  truthy('[文] 开关属性名固定', SRC.indexOf("'data-clipmate-ks-noautoplay'") > -1);
  truthy('[文] 读不到开关时按「开」处理（缺省开）',
    /return el\.getAttribute\(FLAG_ATTR\) !== 'off';/.test(SRC));
  truthy('[文] 全脚本没有裸 console（不许在页面控制台留噪音）',
    SRC.indexOf('console.') === -1);
}

/* ======================== 二、真跑一遍 ======================== */

function section2() {
  section('二、真跑一遍：页面自己的 ended 回调被挡住 / 开关关掉后放行');

  const url = 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86';

  // ① 缺省（没写开关属性）= 开 → 拦住
  {
    const env = runScript(pageHtml(), url);
    const { doc } = env;
    const video = doc.getElementById('v');
    let pageCalled = 0;
    // 模拟快手自己挂在 video 上的「播完了，下一条」
    video.addEventListener('ended', () => { pageCalled++; });

    // 先把页面监听注册好，再跑脚本？—— 不行，脚本必须是先注册的那一方（document_start）。
    // 所以这里的用例是：脚本已在 document 捕获阶段注册，页面监听后在 target 上收到。
    const ev = new env.win.Event('ended', { bubbles: false });
    video.dispatchEvent(ev);

    eq('[跑] 缺省（缺省开）时页面收不到 ended', pageCalled, 0);
    eq('[跑] 计数加了一次', env.win.__clipmateKsNoAutoplayBlocked, 1);
  }

  // ② 开关显式 'off' → 放行（页面照旧收到）
  {
    const env = runScript(pageHtml(), url, 'off');
    const { doc } = env;
    const video = doc.getElementById('v');
    let pageCalled = 0;
    video.addEventListener('ended', () => { pageCalled++; });
    video.dispatchEvent(new env.win.Event('ended', { bubbles: false }));

    eq('[跑] 开关关掉后页面正常收到 ended（放行）', pageCalled, 1);
    eq('[跑] 没拦就别计数', env.win.__clipmateKsNoAutoplayBlocked, undefined);
  }

  // ③ 开关显式 'on' → 拦住
  {
    const env = runScript(pageHtml(), url, 'on');
    const { doc } = env;
    const video = doc.getElementById('v');
    let pageCalled = 0;
    video.addEventListener('ended', () => { pageCalled++; });
    video.dispatchEvent(new env.win.Event('ended', { bubbles: false }));
    eq('[跑] 开关打开时拦住', pageCalled, 0);
  }

  // ④ 别的站（豆瓣）→ 脚本一个监听都不装
  {
    const env = runScript(pageHtml(), 'https://book.douban.com/subject/123/');
    eq('[门] 非快手站点不装 interval', env.intervals.length, 0);
    eq('[门] 非快手站点不打幂等标记', env.win.__clipmateKsNoAutoplay, undefined);
    const { doc } = env;
    const video = doc.getElementById('v');
    let pageCalled = 0;
    video.addEventListener('ended', () => { pageCalled++; });
    video.dispatchEvent(new env.win.Event('ended', { bubbles: false }));
    eq('[门] 非快手站点不拦 ended', pageCalled, 1);
  }
}

/* ======================== 三、幂等 ======================== */

function section3() {
  section('三、幂等：重复注入不叠监听、不叠定时器');

  const url = 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86';
  const env = runScript(pageHtml(), url);
  const before = env.intervals.length;
  env.win.eval(SRC);   // 第二次注入
  eq('[幂] 第二次注入不再挂 interval', env.intervals.length, before);

  const { doc } = env;
  const video = doc.getElementById('v');
  let pageCalled = 0;
  video.addEventListener('ended', () => { pageCalled++; });
  video.dispatchEvent(new env.win.Event('ended', { bubbles: false }));
  eq('[幂] 拦一次的事件只计数一次（没有两套监听）',
    env.win.__clipmateKsNoAutoplayBlocked, 1);
}

/* ======================== 四、loop 兜底 ======================== */

function section4() {
  section('四、loop 兜底：`loop=true` 会被强制关掉（那种情况 ended 根本不触发）');

  const url = 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86';

  // ① 开着：巡检一次就把 loop 关掉
  {
    const env = runScript(pageHtml('<video id="v2" loop src="https://v1.a.yximgs.com/x.mp4"></video>'), url);
    eq('[环] 巡检间隔是 2000ms', env.intervals.length === 1 && env.intervals[0].ms, 2000);
    const v2 = env.doc.getElementById('v2');
    eq('[环] 一开始 loop 是 true', v2.loop, true);
    env.intervals[0].fn();
    eq('[环] 巡检一次后 loop 变 false', v2.loop, false);
  }

  // ② 关掉：巡检不许碰
  {
    const env = runScript(pageHtml('<video id="v2" loop src="https://v1.a.yximgs.com/x.mp4"></video>'), url, 'off');
    const v2 = env.doc.getElementById('v2');
    env.intervals[0].fn();
    eq('[环] 开关关掉后 loop 原样保留', v2.loop, true);
  }
}

/* ======================== 五、开关桥 ======================== */

async function section5() {
  section('五、开关桥：存储 → <html data-clipmate-ks-noautoplay>');

  truthy('[桥] 缺省先写 on', /apply\(true\);/.test(FLAG_SRC));
  truthy('[桥] 读存储的键名固定', FLAG_SRC.indexOf("'kuaishouNoAutoplayEnabled'") > -1);
  truthy('[桥] 监听存储变更（改完设置立刻生效）',
    FLAG_SRC.indexOf('storage.onChanged') > -1);

  const { JSDOM } = require('jsdom');

  /**
   * 造一个只有 storage 的 WBR 桩，跑一遍桥脚本。
   * @param {object} opts {value: 存储里的值, url: 页面地址}
   */
  async function runFlag(opts) {
    const o = opts || {};
    const url = o.url || 'https://www.kuaishou.com/short-video/3xe456wj9c4ei86';
    const html = pageHtml();
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    const win = dom.window;
    const listeners = [];
    win.WBR = {
      storage: {
        local: {
          get(keys) {
            const out = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
              if (o.value !== undefined) out[k] = o.value;
            });
            return Promise.resolve(out);
          }
        },
        onChanged: { addListener(fn) { listeners.push(fn); } }
      }
    };
    win.eval(FLAG_SRC);
    return { win, doc: win.document, listeners };
  }

  // ① 存的是 false（用户关掉了）→ 属性必须变 off
  {
    const env = await runFlag({ value: false });
    await new Promise((r) => setTimeout(r, 20));
    eq('[桥] 存 false → 属性 off',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'off');
  }

  // ② 存的是 true / 没存过 → on
  {
    const env = await runFlag({ value: true });
    await new Promise((r) => setTimeout(r, 20));
    eq('[桥] 存 true → 属性 on',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'on');
  }
  {
    const env = await runFlag({});
    await new Promise((r) => setTimeout(r, 20));
    eq('[桥] 没存过（缺省）→ 属性 on',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'on');
  }

  // ③ 变更监听：改设置后立刻同步过来
  {
    const env = await runFlag({ value: true });
    await new Promise((r) => setTimeout(r, 20));
    eq('[桥] 监听已挂上', env.listeners.length, 1);
    env.listeners[0]({ kuaishouNoAutoplayEnabled: { newValue: false } }, 'local');
    eq('[桥] 改成 false → 属性立刻 off',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'off');
    env.listeners[0]({ kuaishouNoAutoplayEnabled: { newValue: true } }, 'local');
    eq('[桥] 改回 true → 属性立刻 on',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'on');
    // 别的键变化不该动它
    env.listeners[0]({ 别的设置: { newValue: false } }, 'local');
    eq('[桥] 别的键变化不误改',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), 'on');
  }

  // ④ 站点门禁：不是快手就别往 <html> 上写东西
  {
    const env = await runFlag({ value: false, url: 'https://www.douyin.com/video/123' });
    await new Promise((r) => setTimeout(r, 20));
    eq('[门] 非快手站点不写开关属性',
      env.doc.documentElement.getAttribute('data-clipmate-ks-noautoplay'), null);
  }
}

/* ======================== 六、接线 ======================== */

function section6() {
  section('六、接线：manifest 注入块与设置页开关');

  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const blocks = m.content_scripts || [];
  const blk = blocks.filter((b) => (b.js || []).indexOf('src/content/kuaishou-no-autoplay.js') > -1);
  eq('[接] 独立注入块只有 1 个', blk.length, 1);
  if (blk.length === 1) {
    eq('[接] world=MAIN', blk[0].world, 'MAIN');
    eq('[接] run_at=document_start', blk[0].run_at, 'document_start');
    eq('[接] 只对 www.kuaishou.com 生效',
      JSON.stringify(blk[0].matches), JSON.stringify(['https://www.kuaishou.com/*']));
  }
  const mainJs = (blocks[0] || {}).js || [];
  truthy('[接] 开关桥在主内容脚本里', mainJs.indexOf('src/content/kuaishou-no-autoplay-flag.js') > -1);
  truthy('[接] 桥在 content-main 之前',
    mainJs.indexOf('src/content/kuaishou-no-autoplay-flag.js')
      < mainJs.indexOf('src/content/content-main.js'));
}

/* ======================== 主流程 ======================== */

(async function main() {
  console.log('快手「强制关闭自动连播」验收（v2.7.0）\n');
  section1();
  section2();
  section3();
  section4();
  await section5();
  section6();

  console.log('\n' + '─'.repeat(60));
  if (failures.length === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  }
  console.log(`${C.red}失败 ${failures.length} 项 / 通过 ${pass} 项${C.reset}`);
  failures.forEach((f) => console.log(`  ${C.red}❌${C.reset} ${f.name}` + (f.detail ? `  ${C.gray}${f.detail}${C.reset}` : '')));
  process.exit(1);
})();
