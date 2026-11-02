/**
 * Instagram 入口判定验收（v2.7.4）
 *
 * 覆盖两件事：
 *   ① 哪些地址算「有单条作品可提」（作者主页 / 用户 reels 列表 / 探索页都不算）
 *   ② 站点门禁（这份共享件挂在所有站点的原型上，抖音/快手来调必须拿 false）
 *
 * 真机依据（2026-10-30，用户已登录 Edge 实测）：
 *   作者主页         /ya_thinkabout/              → 列表页
 *   点开帖子         /p/DPodeoFEq8n/?img_index=1  → 作品页（换地址不换文档）
 *   用户 reels 列表  /vladaneslava/reels/         → 列表页（v2.7.4 前点提取会提到页脚文字）
 *   Reels 沉浸流     /reels/DeMBuPhh28s/          → 作品页
 */
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./lib/harness');
const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const SRC = path.join(CHROME, 'src/content/shared/instagram-entry-context.js');

let jsdom;
try {
  jsdom = require('jsdom');
} catch (e) {
  jsdom = require(path.join(process.env.CLIPMATE_NODE_PATH || path.join(process.env.HOME || process.env.USERPROFILE, '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules'), 'jsdom'));
}

const C = {
  green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m',
  dim: '\x1b[2m', reset: '\x1b[0m'
};

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ${C.green}✓${C.reset} ${name}`);
  } else {
    fail++;
    const detail = `${name} → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`;
    failures.push(detail);
    console.log(`  ${C.red}✗${C.reset} ${detail}`);
  }
}

/** 必须传第二个参数，否则是假断言（v2.7.1 踩过：ok(name) 只吃一参，条件被静默丢弃） */
function ok(name, cond) {
  if (arguments.length < 2) {
    fail++;
    const detail = `${name} → 断言写法错误：ok() 必须传第二个参数`;
    failures.push(detail);
    console.log(`  ${C.red}✗${C.reset} ${detail}`);
    return;
  }
  if (cond) {
    pass++;
    console.log(`  ${C.green}✓${C.reset} ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ${C.red}✗${C.reset} ${name}`);
  }
}

function section(title) {
  console.log(`\n${C.cyan}${title}${C.reset}`);
}

/** 按给定地址与页面结构加载判定器 */
function loadCtx(url, html) {
  const dom = new jsdom.JSDOM(html || '<html><body></body></html>', {
    url, runScripts: 'outside-only'
  });
  dom.window.eval(fs.readFileSync(SRC, 'utf8'));
  return {
    win: dom.window,
    doc: dom.window.document,
    ctx: dom.window.InstagramEntryContext
  };
}

const IG = 'https://www.instagram.com';

function workOf(pathname, html) {
  return loadCtx(IG + pathname, html).ctx.hasExtractableWork();
}

(async () => {
  console.log(`${C.cyan}Instagram 入口判定验收（v2.7.4）${C.reset}`);

  /* ============ 一、站点门禁（共享原型，每个站都会调到）============ */
  section('一、站点门禁');
  {
    const d = loadCtx('https://www.douyin.com/video/7411/', '<html><body></body></html>');
    const c = d.ctx;
    ok('加载成功', !!c);
    eq('[门禁] 抖音站 isInstagram=false', c.isInstagram(), false);
    eq('[门禁] 抖音站 hasExtractableWork=false', c.hasExtractableWork(), false);
    eq('[门禁] 抖音站 isListEntry=false（不能替别的站做决定）', c.isListEntry(), false);

    const k = loadCtx('https://www.kuaishou.com/short-video/3x', '<html><body></body></html>').ctx;
    eq('[门禁] 快手站 isListEntry=false', k.isListEntry(), false);

    const x = loadCtx('https://www.xiaohongshu.com/explore/abc', '<html><body></body></html>').ctx;
    eq('[门禁] 小红书站 isListEntry=false', x.isListEntry(), false);
  }
  {
    // 带端口 / 子域的 instagram 域名也要认（hostname 匹配是 (^|\.)instagram\.com$）
    const d = loadCtx('https://www.instagram.com/ya_thinkabout/', '<html><body></body></html>');
    eq('[门禁] www.instagram.com 认', d.ctx.isInstagram(), true);
  }

  /* ============ 二、作品地址白名单 ============ */
  section('二、作品地址 → 有可提取内容');
  eq('/p/<code>/', workOf('/p/DPodeoFEq8n/'), true);
  eq('/p/<code>/ 带 img_index 参数', workOf('/p/DPodeoFEq8n/?img_index=1'), true);
  eq('/reel/<code>/', workOf('/reel/DfFRzIHSe3g/'), true);
  eq('/reels/<code>/（Reels 沉浸流）', workOf('/reels/DeMBuPhh28s/'), true);
  eq('/tv/<code>/', workOf('/tv/B1a2C3d4E5f/'), true);
  eq('/<user>/p/<code>/（主页网格卡片形态）', workOf('/ya_thinkabout/p/DPodeoFEq8n/'), true);
  eq('/<user>/reel/<code>/', workOf('/ya_thinkabout/reel/DfFRzIHSe3g/'), true);
  eq('/stories/<user>/<id>/', workOf('/stories/ya_thinkabout/123456/'), true);
  eq('/stories/highlights/<id>/', workOf('/stories/highlights/12345/'), true);
  // v2.7.36：推广帖的作品地址是「编号 + ad 追踪串」，真机实测 43 位。
  // 旧上限 30 位会把这种地址判成「不是作品」→ 打开它时按钮不出来。
  eq('/p/<43 位编号>/（推广帖，真机形态）',
    workOf('/p/DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0/'), true);

  /* ============ 三、列表页 → 没有可提取内容 ============ */
  section('三、列表页 → 没有可提取内容（必须藏按钮）');
  eq('/（首页 feed）', workOf('/'), false);
  eq('/explore/', workOf('/explore/'), false);
  eq('/explore/tags/xxx/', workOf('/explore/tags/cosplay/'), false);
  eq('/ya_thinkabout/（作者主页，真机实测点)提取会出错）', workOf('/ya_thinkabout/'), false);
  eq('/ya_thinkabout/reels/（用户 reels 列表）', workOf('/ya_thinkabout/reels/'), false);
  eq('/vladaneslava/reels/（真机提取到页脚文字的那个页面）', workOf('/vladaneslava/reels/'), false);
  eq('/reels/（reels 入口，进来会自动跳到一条）', workOf('/reels/'), false);
  eq('/accounts/edit/', workOf('/accounts/edit/'), false);

  /* ============ 四、保留字排除（防短码规则误吞）============ */
  section('四、保留字排除');
  eq('/reels/audio/<id>/ 不是作品（真机弹层里见过这个链接）', workOf('/reels/audio/1234567890/'), false);
  eq('/explore/locations/<id>/xxx/ 不是作品', workOf('/explore/locations/102603811297839/bangkok-thailand/'), false);

  /* ============ 五、弹层说了算（规则①）============ */
  section('五、弹层态：不管地址栏写什么');
  {
    const DIALOG = '<html><body><div role="dialog"><header><a href="/ya_thinkabout/">x</a></header></div></body></html>';
    eq('[弹层] 地址还是作者主页、但弹层开着 → 算作品页',
      workOf('/ya_thinkabout/', DIALOG), true);
    eq('[弹层] 地址是首页、弹层开着 → 算作品页', workOf('/', DIALOG), true);
    eq('[弹层] 没有弹层、地址是作者主页 → 列表页', workOf('/ya_thinkabout/'), false);
    const d = loadCtx(IG + '/ya_thinkabout/', DIALOG);
    eq('[弹层] hasOpenDialog=true', d.ctx.hasOpenDialog(), true);
    const d2 = loadCtx(IG + '/ya_thinkabout/', '<html><body></body></html>');
    eq('[弹层] 关着时 hasOpenDialog=false', d2.ctx.hasOpenDialog(), false);
  }

  /* ============ 六、isListEntry 与 hasExtractableWork 互补 ============ */
  section('六、三个接口的互补关系');
  {
    const a = loadCtx(IG + '/ya_thinkabout/', '<html><body></body></html>').ctx;
    // 作品层面：作者主页没有单条作品 —— 这一层语义**没变**
    eq('主页：hasExtractableWork=false（没有单条作品）', a.hasExtractableWork(), false);
    // v2.7.20 契约变更：`/<username>/` 从「列表页」改判为**个人主页**（人物档案入口）。
    // 主页没有作品，但有整份档案可提；继续把它算成列表页就会把按钮藏掉，主页永远没按钮。
    eq('[v2.7.20] 主页：isListEntry=false（不再是列表页）', a.isListEntry(), false);
    eq('[v2.7.20] 主页：hasExtractableContent=true（按钮要出）', a.hasExtractableContent(), true);
    eq('[v2.7.20] 主页：isProfilePage=true', a.isProfilePage(), true);
    eq('[v2.7.20] 主页：isProfilePath 认单段路径', a.isProfilePath(IG + '/ya_thinkabout/'), true);

    // 真正的列表页（用户的 reels 列表 / 探索页）：仍然是列表页，按钮照旧藏
    const r = loadCtx(IG + '/vladaneslava/reels/', '<html><body></body></html>').ctx;
    eq('真·列表页（/user/reels/）：isListEntry=true', r.isListEntry(), true);
    eq('真·列表页：hasExtractableContent=false', r.hasExtractableContent(), false);
    const e = loadCtx(IG + '/explore/', '<html><body></body></html>').ctx;
    eq('探索页：isListEntry=true', e.isListEntry(), true);

    const b = loadCtx(IG + '/p/DPodeoFEq8n/', '<html><body></body></html>').ctx;
    eq('作品页：hasExtractableWork=true', b.hasExtractableWork(), true);
    eq('作品页：isListEntry=false', b.isListEntry(), false);
  }

  /* ============ 七、接线与源码层面 ============ */
  section('七、接线与源码层面');
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(CHROME, 'manifest.json'), 'utf8'));
    const js = manifest.content_scripts[0].js;
    const rel = 'src/content/shared/instagram-entry-context.js';
    ok('[接线] manifest 里注册了这个文件', js.indexOf(rel) > -1);
    ok('[接线] 注册位置在 ig-spa-handler.js 之前（顺序不能反）',
      js.indexOf(rel) > -1 && js.indexOf(rel) < js.indexOf('src/content/ui/ig-spa-handler.js'));
    ok('[接线] 注册位置在 content-main.js 之前（主流程要用到它）',
      js.indexOf(rel) > -1 && js.indexOf(rel) < js.indexOf('src/content/content-main.js'));
  }
  {
    const src = fs.readFileSync(SRC, 'utf8');
    // 站点门禁必须在函数体第一行：这份共享件会被 Object.assign 到所有站点的原型上
    ok('[源码] hasExtractableWork 第一行就是站点门禁',
      /function hasExtractableWork\([^)]*\)\s*\{\s*if \(!isInstagram\(\)\) return false;/.test(src));
    ok('[源码] isListEntry 第一行就是站点门禁',
      /function isListEntry\([^)]*\)\s*\{\s*if \(!isInstagram\(\)\) return false;/.test(src));
    ok('[源码] 挂到了 global（共享件标准写法）',
      /global\.InstagramEntryContext\s*=/.test(src));
  }

  /* ============ 八、真机链路：列表页藏按钮 / 作品页出按钮 ============ */
  section('八、真机链路（走完整 init，看按钮到底藏没藏）');
  {
    // 真机出问题的那个页面：用户 reels 列表（v2.7.4 前点了会提取到页脚文字）
    const listPage = await harness.openPage({
      url: 'https://www.instagram.com/vladaneslava/reels/',
      html: '<!DOCTYPE html><html><head><title>vladaneslava</title></head>'
        + '<body><div>一堆封面</div><footer>Meta 旗下其他产品</footer></body></html>'
    });
    const inst = await harness.waitForInit(listPage);
    ok('[列表页] 初始化完成（走的是「挂跟随 + 补收尾」那条分支）',
      !!(inst && inst.isInitialized));
    const btn = listPage.window.document.querySelector('button.media-extractor-button');
    ok('[列表页] 按钮**已创建**（不能摘掉 —— 摘了点开帖子就再也造不回来）', !!btn);
    if (btn) {
      eq('[列表页] 按钮被藏起来（display:none）', btn.style.display, 'none');
    }

    // 用户点开一条作品 → 弹层出现（换地址不换文档）→ 按钮必须自己露出来。
    // 这条链路断掉的话，列表页上永远点不出东西（藏了就没人再显示它）。
    const dlg = listPage.window.document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    dlg.innerHTML = '<header><span class="_ap3a _aaco _aacw _aacx _aad7 _aade">ya_thinkabout</span>'
      + '<a href="/ya_thinkabout/" role="link">ya_thinkabout</a></header>'
      + '<time datetime="2025-10-10T14:32:49.000Z">54周</time>';
    listPage.window.document.body.appendChild(dlg);

    let shown = false;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const b = listPage.window.document.querySelector('button.media-extractor-button');
      if (b && b.style.display === '') { shown = true; break; }
    }
    ok('[跟随] 弹层打开后按钮自动露出来（MutationObserver 接住了）', shown);

    // 关掉弹层 → 按钮与浮窗一起撤（不能留下一个「看着能点其实没东西」的按钮）
    dlg.remove();
    let hidden = false;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const b = listPage.window.document.querySelector('button.media-extractor-button');
      if (b && b.style.display === 'none') { hidden = true; break; }
    }
    ok('[跟随] 弹层关掉后按钮又藏回去', hidden);
  }
  {
    // v2.7.20：个人主页必须**一上来就有按钮**（人物档案入口）。
    // 这是新增功能的核心行为 —— 判据若还用 hasExtractableWork，这里会 display:none。
    const profilePage = await harness.openPage({
      url: 'https://www.instagram.com/cartierawards/',
      html: '<!DOCTYPE html><html><head><title>Instagram</title></head>'
        + '<body><header><span class="_aa_c">cartierawards</span>'
        + '<span>Cartier Women\'s Initiative</span></header></body></html>'
    });
    const instP = await harness.waitForInit(profilePage);
    ok('[主页] 初始化完成', !!(instP && instP.isInitialized));
    const btnP = profilePage.window.document.querySelector('button.media-extractor-button');
    ok('[主页] 按钮已创建', !!btnP);
    if (btnP) {
      eq('[主页] 按钮**可见**（v2.7.20：主页不许藏按钮）', btnP.style.display, '');
    }
  }
  {
    const workPage = await harness.openPage({
      url: 'https://www.instagram.com/p/DPodeoFEq8n/',
      html: '<!DOCTYPE html><html><head><title>帖子</title>'
        + '<meta property="og:title" content="ya_thinkabout (@ya_thinkabout)"></head>'
        + '<body><div role="dialog"><header>'
        + '<span class="_ap3a _aaco _aacw _aacx _aad7 _aade">ya_thinkabout</span>'
        + '<a href="/ya_thinkabout/" role="link">ya_thinkabout</a></header>'
        + '<time datetime="2025-10-10T14:32:49.000Z">54周</time></div></body></html>'
    });
    const inst = await harness.waitForInit(workPage);
    ok('[作品页] 初始化完成', !!(inst && inst.isInitialized));
    const btn = workPage.window.document.querySelector('button.media-extractor-button');
    ok('[作品页] 按钮存在', !!btn);
    if (btn) {
      eq('[作品页] 按钮可见（没被藏）', btn.style.display, '');
    }
  }

  console.log(`\n结果：${pass}/${pass + fail} 通过 — Instagram 入口判定（v2.7.4）`);
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常：', e);
  process.exit(1);
});
