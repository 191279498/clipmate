/**
 * Instagram 作者主页提取验收（v2.7.4）
 *
 * 修的是什么 Bug（真机 2026-10-30，作者主页 /ya_thinkabout/ 点开帖子）
 * ------------------------------------------------------------------
 *   作者ID   = ya_thinkabout                            ← 对
 *   作者主页 = https://www.instagram.com/whoistaraaa/    ← 错！这是评论区第一个用户
 *
 * 根因：extractAuthorHomepage 的旧「策略1」是一条**超长混淆类名选择器**，
 * 真机上它在弹层里命中 **2 个**元素 —— 第一个是评论区的 `/whoistaraaa/`，
 * 第二个才是真作者 `/ya_thinkabout/`。`querySelector` 取第一个 → 取错人。
 * 旧「策略2」遍历整个弹层找第一个「像用户主页」的链接，同样会扫到评论区。
 *
 * 本测试的 fixture 是**照真机 DOM 逐项抄的**（含那条混淆类名），
 * 并且专门加了一条「旧选择器确实先命中评论区」的对照断言 ——
 * 否则 fixture 抄错了，测试会全绿但什么都没测到。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const EXTRACTOR_SRC = path.join(CHROME, 'src/content/extractors/instagram-social.js');

/** 那条把作者主页取错人的超长混淆类名选择器（旧策略1，v2.7.4 已废止） */
const OLD_STRAT1_SEL = 'a.x1i10hfl.xjbqb8w.x1ejq31n.x18oe1m7.x1sy0etr.xstzfhl.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x1ypdohk.xt0psk2.x3ct3a4.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x16tdsg8.x1hl2dhg.xggy1nq.x1a2a7pz.notranslate._a6hd[role="link"]';

/** 用户名 span（extractAuthorName 的策略1 认这个） */
const NAME_SPAN = '<span class="_ap3a _aaco _aacw _aacx _aad7 _aade">ya_thinkabout</span>';

/** 混淆类名串（真机 header 里的作者链接、评论区的用户链接都带这一串） */
const MESSY_CLS = 'x1i10hfl xjbqb8w x1ejq31n x18oe1m7 x1sy0etr xstzfhl x972fbf x10w94by x1qhh985 x14e42zd x9f619 x1ypdohk xt0psk2 x3ct3a4 xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x16tdsg8 x1hl2dhg xggy1nq x1a2a7pz notranslate _a6hd';

/** 标准弹层：header 里有作者，评论区有 whoistaraaa */
function modalHtml(opts) {
  const o = opts || {};
  const headerLinks = o.headerLinks === undefined
    ? `<a href="/ya_thinkabout/" role="link" class="x1i10hfl x1qjc9v5 xjbqb8w"></a>
       <a href="/ya_thinkabout/" role="link" class="${MESSY_CLS}">ya_thinkabout</a>`
    : o.headerLinks;
  // ⚠️ 评论区**故意放在 header 之前**：真机（React 动态渲染）实测就是这么个顺序 ——
  // 同一页面两次读取 `a.notranslate` / `a._a6hd` 的顺序都不一样，评论者有时就排在作者前面。
  // fixture 不放成这样，旧代码的「取第一个」就不会错，测试会全绿但什么都没测到。
  return `<!DOCTYPE html><html><head>
    <meta property="og:title" content="ya_thinkabout (@ya_thinkabout)">
    <meta property="og:url" content="https://www.instagram.com/ya_thinkabout/">
    </head><body>
    <div role="dialog">
      <div class="comment-area">
        <a href="/p/DPodeoFEq8n/liked_by/" role="link">407 人赞了</a>
        <a href="/whoistaraaa/" role="link" class="${MESSY_CLS}">whoistaraaa</a>
        <a href="/daveswave2.0/" role="link" class="${MESSY_CLS}">daveswave2.0</a>
      </div>
      <header>${NAME_SPAN}${headerLinks}
        <a href="/explore/locations/102603811297839/bangkok-thailand/" role="link">Bangkok, Thailand</a>
      </header>
    </div>
    </body></html>`;
}

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
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
function ok(name, cond) {
  if (arguments.length < 2) {
    fail++;
    const d = `${name} → 断言写法错误：ok() 必须传第二个参数`;
    failures.push(d);
    console.log(`  ${C.red}✗${C.reset} ${d}`);
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
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

(async () => {
  console.log(`${C.cyan}Instagram 作者主页提取验收（v2.7.4）${C.reset}`);

  const page = await harness.openPage({
    url: 'https://www.instagram.com/p/DPodeoFEq8n/',
    html: modalHtml()
  });
  const win = page.window;
  const doc = win.document;
  const Extractor = win.eval('InstagramSocialExtractor');
  ok('提取器类加载成功', typeof Extractor === 'function');
  const inst = new Extractor();
  const dialog = doc.querySelector('div[role="dialog"]');
  ok('弹层节点找到', !!dialog);

  /* ============ 一、fixture 忠实度（先证明这个测试能抓到那个 Bug）============ */
  section('一、先证明 fixture 真的复现了真机结构');
  {
    const hit = [].slice.call(dialog.querySelectorAll(OLD_STRAT1_SEL));
    const hrefs = hit.map((a) => a.getAttribute('href'));
    ok('[对照] 旧策略1 的选择器在弹层里命中多个元素（真机命中 2 个）', hit.length >= 2, hit.length);
    // 真机实测：这条选择器同时命中**作者本人**和**评论区用户**，谁排第一取决于
    // React 当时的渲染顺序（同一页面两次读取顺序都不一样）—— 所以「取第一个」
    // 这个写法本身就是错的，不能指望靠类名把两者分开。
    ok('[对照] 命中集合里同时含作者 /ya_thinkabout/',
      hrefs.indexOf('/ya_thinkabout/') > -1);
    ok('[对照] 命中集合里同时含评论区用户 /whoistaraaa/（这就是旧代码取错人的来源）',
      hrefs.indexOf('/whoistaraaa/') > -1);
    eq('[对照] 旧策略1「取第一个」拿到的正是评论区的 whoistaraaa（真机 Bug 复现）',
      hrefs.length ? hrefs[0] : null, '/whoistaraaa/');
    const all = [].slice.call(dialog.querySelectorAll('a[href^="/"]:not([href^="//"])'));
    const idxAuthor = all.findIndex((a) => a.getAttribute('href') === '/ya_thinkabout/');
    const idxCommenter = all.findIndex((a) => a.getAttribute('href') === '/whoistaraaa/');
    ok('[对照] 评论者排在作者**之前**（DOM 顺序不可依赖，旧策略2 遍历也会先撞上它）',
      idxAuthor > -1 && idxCommenter > -1 && idxCommenter < idxAuthor);
  }

  /* ============ 二、核心：作者主页必须是作者本人 ============ */
  section('二、作者主页不能取成评论者（本次修的 Bug）');
  {
    const home = inst.extractAuthorHomepage(dialog);
    eq('弹层态作者主页 = 作者本人', home, 'https://www.instagram.com/ya_thinkabout/');
    ok('不含评论区用户 whoistaraaa', home.indexOf('whoistaraaa') === -1);
    ok('不是第二个评论者 daveswave2.0', home.indexOf('daveswave2.0') === -1);
  }
  {
    const id = inst.extractAuthorName(dialog);
    eq('作者ID 与主页路径一致（两份数据不许打架）', id, 'ya_thinkabout');
    const home = inst.extractAuthorHomepage(dialog);
    ok('主页里含作者ID', home.indexOf(id) > -1);
  }

  /* ============ 三、header 里没有作者链接时，也不能退回评论区 ============ */
  section('三、header 里没有作者链接 → 用作者ID 拼，绝不扫评论区');
  {
    const dialog2 = doc.createElement('div');
    dialog2.setAttribute('role', 'dialog');
    dialog2.innerHTML = `<header>${NAME_SPAN}
        <a href="/explore/locations/102603811297839/bangkok-thailand/">Bangkok</a></header>
      <div><a href="/whoistaraaa/" role="link" class="${MESSY_CLS}">whoistaraaa</a></div>`;
    doc.body.appendChild(dialog2);
    const home = inst.extractAuthorHomepage(dialog2);
    eq('header 里只有地点链接 → 仍取到作者本人', home, 'https://www.instagram.com/ya_thinkabout/');
    ok('依然不含 whoistaraaa', home.indexOf('whoistaraaa') === -1);
    dialog2.remove();
  }

  /* ============ 四、Reels 页：专用策略全落空时用作者ID 兜底 ============ */
  section('四、Reels 沉浸流（真机实测作者主页曾是空）');
  {
    const reelsPage = await harness.openPage({
      url: 'https://www.instagram.com/reels/DeMBuPhh28s/',
      html: `<!DOCTYPE html><html><head><meta property="og:title" content="yaoyanhuozongfx"></head>
        <body><div><span class="_ap3a _aaco _aacw _aacx _aad7 _aade">yaoyanhuozongfx</span></div></body></html>`
    });
    const rInst = new (reelsPage.window.eval('InstagramSocialExtractor'))();
    eq('[Reels] 页面类型判定为 reels', rInst.getPageType(), 'reels');
    // 真机：Reels 专用策略（og:url 等）落空 → 必须回落到「作者ID 拼主页」而不是返回空
    rInst.extractReelsAuthorHomepage = () => '';
    rInst.extractAuthorName = () => 'yaoyanhuozongfx';
    eq('[Reels] 专用策略落空 → 用作者ID 拼出主页（不再返回空）',
      rInst.extractAuthorHomepage(), 'https://www.instagram.com/yaoyanhuozongfx/');
  }
  {
    // 连作者ID 都没有才允许返回空（不能凭空编一个）
    const rPage = await harness.openPage({
      url: 'https://www.instagram.com/reels/DeMBuPhh28s/',
      html: '<!DOCTYPE html><html><head></head><body></body></html>'
    });
    const rInst = new (rPage.window.eval('InstagramSocialExtractor'))();
    rInst.extractReelsAuthorHomepage = () => '';
    rInst.extractAuthorName = () => '';
    eq('[Reels] 连作者ID 都没有 → 返回空，不编造', rInst.extractAuthorHomepage(), '');
  }

  /* ============ 五、源码层面钉死（防回潮）============ */
  section('五、源码层面');
  {
    const src = fs.readFileSync(EXTRACTOR_SRC, 'utf8');
    const fnStart = src.indexOf('extractAuthorHomepage(context = document)');
    ok('找到 extractAuthorHomepage 定义', fnStart > -1);
    const body = src.slice(fnStart, fnStart + 6000);
    ok('不再有那条超长混淆类名选择器（旧策略1 已废止）',
      body.indexOf(OLD_STRAT1_SEL) === -1);
    ok('有「与作者ID 交叉校验」的强证据分支',
      /const authorId = \(this\.extractAuthorName\(context\)/.test(body));
    ok('遍历限定在 header 内（不会扫到评论区）',
      /const postHeader = context\.querySelector\('header'\)/.test(body));
    ok('Reels 分支有作者ID 兜底（不再直接 return 空）',
      /const reelsId = \(this\.extractAuthorName\(context\)/.test(body));
  }

  /* ============ 六、弹层 URL 必须是帖子永久链接（v2.7.21）============ */
  section('六、弹层 URL：不能取成点赞列表 liked_by');
  {
    // 真机 2026-10-31（cartierawards 主页点开一条帖子）：
    //   存下来的网址 = https://www.instagram.com/p/Dej2vAlDN0Q/liked_by/
    //   正确应是     https://www.instagram.com/p/Dej2vAlDN0Q/
    // 根因：弹层里 `…/p/<code>/liked_by/`（点赞列表）排在作品永久链接之前，
    // 老代码只过滤了音频和评论链接，于是「第一个含 /p/ 的链接」就把点赞列表抢走了。
    const page2 = await harness.openPage({
      url: 'https://www.instagram.com/p/DPodeoFEq8n/',
      html: modalHtml()
    });
    const w2 = page2.window;
    const dialog2 = w2.document.querySelector('div[role="dialog"]');
    ok('弹层节点找到', !!dialog2);

    // 先证明 fixture 里点赞链接确实排在前面（否则这条测试什么都没测到）
    const firstP = [].slice.call(dialog2.querySelectorAll('a[href*="/p/"]'))[0];
    eq('[对照] 弹层里第一个含 /p/ 的链接就是 liked_by（真机 Bug 的来源）',
      firstP ? firstP.getAttribute('href') : null, '/p/DPodeoFEq8n/liked_by/');

    const inst2 = new (w2.eval('InstagramSocialExtractor'))();
    const data = await inst2.extractAllFields({ context: dialog2 });
    eq('弹层 URL = 帖子永久链接', data['URL'], 'https://www.instagram.com/p/DPodeoFEq8n/');
    ok('URL 里没有 liked_by', String(data['URL']).indexOf('liked_by') === -1, data['URL']);
  }

  /* ============ 七、弹层作者昵称走桥节点（v2.7.21）============ */
  section('七、弹层作者昵称：head 里的 meta 是旧的，改走桥节点');
  {
    // 真机现象：作者昵称显示成 username（cartierawards），应为显示名
    // （Cartier Women's Initiative）。原因是昵称只靠 twitter:title，
    // 而弹层/站内跳转后 head 里的 meta 是「上一次整页加载」留下的。
    const page3 = await harness.openPage({
      url: 'https://www.instagram.com/p/DPodeoFEq8n/',
      html: modalHtml()
    });
    const w3 = page3.window;
    const doc3 = w3.document;
    const dialog3 = doc3.querySelector('div[role="dialog"]');
    const inst3 = new (w3.eval('InstagramSocialExtractor'))();

    // 没有任何 meta / 桥 → 本方法返回空，**由调用点用作者ID 顶上**
    // （`'作者昵称': () => this.extractAuthorNickname(context) || this.extractAuthorName(context)`）
    // 这就是真机上昵称显示成 username 的来路。
    eq('[对照] 没有 meta 也没有桥时，昵称返回空（调用点于是用作者ID 顶成 username）',
      inst3.extractAuthorNickname(dialog3), '');

    // 塞一份桥节点（按 username 建索引，跟 instagram-net-hook.js 写出来的一致）
    const node = doc3.createElement('script');
    node.type = 'application/json';
    node.id = 'clipmate-instagram-net';
    node.textContent = JSON.stringify({
      v: 2, ts: 1746000000000, media: {},
      profiles: {
        ya_thinkabout: { u: 'ya_thinkabout', pk: '111', fn: 'Ya Think About', bio: '简介', ext: '', fc: 1, gc: 2, mc: 3, pv: 0, vf: 0 },
        whoistaraaa: { u: 'whoistaraaa', pk: '222', fn: '评论区的人', bio: '', ext: '', fc: 1, gc: 1, mc: 1, pv: 0, vf: 0 }
      }
    });
    doc3.head.appendChild(node);

    eq('桥节点里按作者 username 取到显示名', inst3.extractAuthorNickname(dialog3), 'Ya Think About');
    ok('绝不会取到评论区那个人的显示名',
      inst3.extractAuthorNickname(dialog3).indexOf('评论区') === -1);
  }

  /* ============ 八、源码层面：v2.7.21 两处修复不许回潮 ============ */
  section('八、源码层面（v2.7.21）');
  {
    const src = fs.readFileSync(EXTRACTOR_SRC, 'utf8');
    ok('弹层永久链接必须整条匹配（不再只判「含 /p/」）',
      /\(\?:p\|reel\|reels\|tv\)\\\/\\\[A-Za-z0-9_-\]\{5,20\}/.test(src) ||
      src.indexOf('`/p/<code>/liked_by/') > -1);
    ok('作者昵称有桥节点策略 _igBridgeNickname', src.indexOf('_igBridgeNickname(context = document)') > -1);
    ok('桥策略在 meta 之前调用',
      src.indexOf('this._igBridgeNickname(context)') < src.indexOf("const twitterTitleMeta = this._meta('meta[name=\"twitter:title\"]')"));
    ok('调用点确实是「昵称取不到就用作者ID」（真机显示 username 的原因）',
      /'作者昵称': \(\) => this\.extractAuthorNickname\(context\) \|\| this\.extractAuthorName\(context\)/.test(src));
  }

  console.log(`\n结果：${pass}/${pass + fail} 通过 — Instagram 作者主页（v2.7.4）`);
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常：', e);
  process.exit(1);
});
