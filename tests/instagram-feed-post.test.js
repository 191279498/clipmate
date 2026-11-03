/**
 * Instagram 首页「逐帖提取按钮」验收（v2.7.35）
 *
 * 需求（用户 2026-11-01 拍板）
 * --------------------------
 *   首页 `/` 是无限流。想存某一条不该先点开详情页 ——
 *   在每条帖子右上角挂一枚小按钮，**只有点了才提取那一条**。
 *
 * 这份测试盯死四件事（每一条都是真机上会出事故的地方）：
 *   1. 按钮只挂首页，且**挂在帖子节点上**（首页没有「当前这一条」，挂全局就会提到邻居）；
 *   2. 认编号要认**整条作品地址**（`/p/<code>/liked_by/` 这类同前缀链接必须挡掉，
 *      否则存下来的网址会变成点赞列表 —— v2.7.21 真机踩过）；
 *   3. 取数不能串台：接口/数据块里有的用它的全文，接口明确说「没文案」时
 *      **不许**回头读 DOM（v2.7.8 真机踩过：「上一条残留」被记到这一条上）；
 *   4. 首页浮窗不许被页面变化关掉（首页 ok 恒为 false，老逻辑见列表页就关窗）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const harness = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const P = {
  entry: path.join(CHROME, 'src/content/shared/instagram-entry-context.js'),
  inline: path.join(CHROME, 'src/content/shared/instagram-inline-data.js'),
  buttons: path.join(CHROME, 'src/content/ui/instagram-feed-buttons.js'),
  handler: path.join(CHROME, 'src/content/ui/ig-spa-handler.js'),
  social: path.join(CHROME, 'src/content/extractors/instagram-social.js'),
  main: path.join(CHROME, 'src/content/content-main.js'),
  manifest: path.join(CHROME, 'manifest.json')
};

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };

/**
 * 首页第 1 条（昵称 `Roxy`、用户名 `roxy_sitora`）应有的标题。
 *
 * 首页逐帖与详情页**共用这一个常量**：改一处没改另一处，或者谁把昵称换回用户名，立刻红。
 * 2026-11-01 真机事故的原文是 `roxysitoraBoocrew-2026年11月01日`（用户名 + 文案前20字 + 日期）。
 */
const EXPECT_IG_TITLE = 'RoxyPrettymucheveryone-2026年10月31日';

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (arguments.length < 2) throw new Error('ok(name, cond) 必须传两个参数: ' + name);
  if (typeof cond !== 'boolean') throw new Error('ok() 第二参数必须是布尔: ' + name);
  if (cond) {
    pass++;
    console.log('  ' + C.green + '✓' + C.reset + ' ' + name);
  } else {
    fail++;
    const extra = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
    failures.push(name + extra);
    console.log('  ' + C.red + '✗' + C.reset + ' ' + name + extra);
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, { actual, expected });
}

function section(t) {
  console.log('\n' + C.cyan + t + C.reset);
}

function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const dir = process.env.CLIPMATE_NODE_PATH
    || path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules');
  return require(path.join(dir, 'jsdom'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在 jsdom 里只装「入口判定 + 逐帖按钮」两个文件，不跑整套扩展 */
function openFeedDom(html, url) {
  const { JSDOM, VirtualConsole } = loadJsdom();
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => errs.push(String((e && e.message) || e)));
  const dom = new JSDOM(html, {
    url: url || 'https://www.instagram.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  // jsdom 没有 innerText，扩展里到处用它，补一个近似实现
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return this.textContent; },
      set(v) { this.textContent = v; }
    });
  }
  for (const [file, label] of [[P.entry, 'entry'], [P.inline, 'inline'], [P.buttons, 'buttons']]) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(file, 'utf8');
    w.document.documentElement.appendChild(el);
    el.remove();   // 跑完就摘：别让源码文本污染页面文本
    if (!w[label === 'entry' ? 'InstagramEntryContext' : (label === 'inline' ? 'InstagramInlineData' : 'InstagramFeedButtons')]) {
      throw new Error('注入失败：' + file);
    }
  }
  return { dom, w, errs };
}

/** 一条信息流帖子的真机形态（2026-11-01 勘察：无 h1、time 在 /p/<code>/ 链接里、正文 span 带 _aacu） */
function feedPost(opts) {
  const o = opts || {};
  const code = o.code;
  const user = o.user || 'roxy_sitora';
  return '<article>'
    + '<div><div><div>'
    + '<a href="/' + user + '/"><img alt="头像"></a>'
    + '<a href="/' + user + '/">' + user + '</a>'
    + '<a href="/p/' + code + '/"><time datetime="' + (o.datetime || '2026-10-31T15:32:08.000Z')
    + '" title="2026年10月31日">2小时</time></a>'
    + '<button type="button" aria-label="更多选项"></button>'
    + '</div></div>'
    + '<div><img alt="' + (o.alt || '图片') + '"></div>'
    + '<div>'
    + '<a href="/' + user + '/">' + user + '</a>'
    + '<span class="_ap3a _aaco _aacu _aacx _aad7 _aade">' + (o.caption || '正文') + '</span>'
    + '<a href="/p/' + code + '/liked_by/">62 人赞了</a>'
    + '<a href="/explore/tags/tokyo/">#Tokyo</a>'
    + '</div>'
    + '</article>';
}

const FEED_HTML = '<!DOCTYPE html><html><head><title>Instagram</title></head><body><main>'
  + feedPost({ code: 'AAAAAAAAAAA', caption: 'Pretty much everyone asks me that.🤷🏻‍♀️… 更多' })
  + feedPost({ code: 'BBBBBBBBBBB', user: 'reiannwadare', caption: 'ゴーゴー夕張' })
  + '</main></body></html>';

(async () => {
  /* ============ 一、入口判定：只认首页 ============ */
  section('一、入口判定 isFeedPath / isFeedPage');
  {
    const vm = require('vm');
    const src = fs.readFileSync(P.entry, 'utf8');
    function load(hostname, pathname) {
      const sandbox = {};
      sandbox.window = sandbox;
      sandbox.location = { hostname, pathname, href: 'https://' + hostname + pathname };
      sandbox.URL = URL;
      sandbox.console = console;
      vm.createContext(sandbox);
      vm.runInContext(src, sandbox);
      return sandbox.InstagramEntryContext;
    }
    const ig = load('www.instagram.com', '/');
    ok('首页 `/` → isFeedPage', ig.isFeedPage() === true);
    ok('根路径带查询串也算首页', ig.isFeedPage('https://www.instagram.com/?__coig_ufac=1') === true);
    ok('`/explore/` 不是首页', ig.isFeedPage('https://www.instagram.com/explore/') === false);
    ok('作品页 `/p/xxx/` 不是首页', ig.isFeedPage('https://www.instagram.com/p/DPodeoFEq8n/') === false);
    ok('个人主页 `/user/` 不是首页', ig.isFeedPage('https://www.instagram.com/cartierawards/') === false);
    ok('`/reels/` 不是首页', ig.isFeedPage('https://www.instagram.com/reels/DeMBuPhh28s/') === false);
    const other = load('www.douyin.com', '/');
    ok('站点门禁：抖音同路径不算 IG 首页', other.isFeedPage() === false);
    ok('两个新判据都挂到了 global', typeof ig.isFeedPath === 'function' && typeof ig.isFeedPage === 'function');
  }

  /* ============ 二、按钮挂载 ============ */
  section('二、按钮挂载：每条帖子一颗、编号认整条作品地址');
  {
    const { w } = openFeedDom(FEED_HTML);
    const calls = [];
    const mgr = new w.InstagramFeedButtons({ onExtract: (t) => { calls.push(t); return true; } });
    mgr.start();

    const btns = w.document.querySelectorAll('main article > button.clipmate-ig-feed-btn');
    eq('两条帖子挂了 2 颗按钮', btns.length, 2);
    eq('第 1 颗编号 = AAAAAAAAAAA', btns[0] && btns[0].getAttribute('data-code'), 'AAAAAAAAAAA');
    eq('第 2 颗编号 = BBBBBBBBBBB', btns[1] && btns[1].getAttribute('data-code'), 'BBBBBBBBBBB');

    const art0 = w.document.querySelectorAll('main article')[0];
    ok('article 上留了编号标记', art0.getAttribute('data-clipmate-ig-post') === 'AAAAAAAAAAA');
    eq('原本 static 的 article 被改成 relative', art0.style.position, 'relative');
    ok('留了还原标记', art0.hasAttribute('data-clipmate-ig-pos'));
    ok('按钮是 article 的**直系子节点**（不能塞进 header 里，会被 React 连带重绘）',
      btns[0] && btns[0].parentNode === art0);

    // 幂等：再 sync 一次不能变 4 颗
    mgr.sync();
    eq('重复 sync 不重复挂', w.document.querySelectorAll('main article > button.clipmate-ig-feed-btn').length, 2);

    // 「liked_by / comments / audio」这类同前缀链接必须挡掉（v2.7.21 真机事故）
    const dirty = '<!DOCTYPE html><html><body><main><article>'
      + '<a href="/p/CCCCCCCCCCC/liked_by/">62 人赞了</a>'
      + '<a href="/reels/audio/611640219248713/">音频</a>'
      + '<a href="/p/DDDDDDDDDDD/c/123456/">评论</a>'
      + '<a href="/p/EEEEEEEEEEE/"><time datetime="2026-10-31T15:32:08.000Z">2小时</time></a>'
      + '</article></main></body></html>';
    const d = openFeedDom(dirty);
    const mgr2 = new d.w.InstagramFeedButtons({ onExtract: () => true });
    mgr2.start();
    const b2 = d.w.document.querySelector('main article > button.clipmate-ig-feed-btn');
    eq('点赞/音频/评论链接一律不认，只认整条作品地址', b2 && b2.getAttribute('data-code'), 'EEEEEEEEEEE');
    mgr2.stop();

    // 推广帖：作品地址是「编号 + ad 追踪串」，真机实测 43 位。
    // v2.7.35 卡在 30 位 → 这种帖子在首页**一颗按钮都没有**（2026-11-01 真机验收发现）。
    const AD_CODE = 'DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0';
    const adHtml = '<!DOCTYPE html><html><body><main><article>'
      + '<a href="/kellywang_studio/">kellywang_studio</a>'
      + '<a href="/p/' + AD_CODE + '/"><time datetime="2026-11-01T02:10:11.000Z">3小时</time></a>'
      + '</article></main></body></html>';
    const ad = openFeedDom(adHtml);
    const mgrAd = new ad.w.InstagramFeedButtons({ onExtract: () => true });
    mgrAd.start();
    const bAd = ad.w.document.querySelector('main article > button.clipmate-ig-feed-btn');
    eq('推广帖（43 位编号）也挂按钮', bAd && bAd.getAttribute('data-code'), AD_CODE);
    mgrAd.stop();
    mgr.stop();
  }

  /* ============ 二·B 让位：头部有「关注」时必须站到它左边 ============ */
  section('二·B 让位：头部有「关注」按钮时不许压上去');
  {
    // v2.8.9 真机实证：关注按钮 599~659、⋯ 667~691，写死 right:40 的按钮落在
    // 633~661 —— 整整压住关注 26px。改为按几何算：右边缘站到「同一行最左那颗」左边 6px。
    const html = '<!DOCTYPE html><html><body><main><article>'
      + '<a href="/p/AAAAAAAAAAA/"><time datetime="2026-10-31T15:32:08.000Z">1小时</time></a>'
      + '<button aria-label="关注" type="button">关注</button>'
      + '<button aria-label="更多选项" type="button"><svg></svg></button>'
      + '</article></main></body></html>';
    const { w } = openFeedDom(html);
    const art = w.document.querySelector('main article');
    art.getBoundingClientRect = () => ({ left: 231, right: 701, top: 0, bottom: 600, width: 470, height: 600 });
    art.querySelector('[aria-label="关注"]').getBoundingClientRect =
      () => ({ left: 599, right: 659, top: 12, bottom: 44, width: 60, height: 32 });
    art.querySelector('[aria-label="更多选项"]').getBoundingClientRect =
      () => ({ left: 667, right: 691, top: 14, bottom: 38, width: 24, height: 24 });

    const mgr = new w.InstagramFeedButtons({ onExtract: () => true });
    mgr.start();
    const btn = w.document.querySelector('main article > button.clipmate-ig-feed-btn');
    // 701 - 599 + 6 = 108 → 按钮右边缘 593，离关注左沿 6px
    eq('让开「关注」：right 从 40 变成 108', btn.style.right, '108px');
    eq('行内 right 必须带 important（否则压不过样式表里那条 !important）',
      btn.style.getPropertyPriority('right'), 'important');
    mgr.stop();

    // 没有关注按钮 → 落到「⋯」左边，正好等于 CSS 默认的 40
    const only = '<!DOCTYPE html><html><body><main><article>'
      + '<a href="/p/BBBBBBBBBBB/"><time datetime="2026-10-31T15:32:08.000Z">1小时</time></a>'
      + '<button aria-label="更多选项" type="button"><svg></svg></button>'
      + '</article></main></body></html>';
    const s = openFeedDom(only);
    const art2 = s.w.document.querySelector('main article');
    art2.getBoundingClientRect = () => ({ left: 231, right: 701, top: 0, bottom: 600, width: 470, height: 600 });
    art2.querySelector('[aria-label="更多选项"]').getBoundingClientRect =
      () => ({ left: 667, right: 691, top: 14, bottom: 38, width: 24, height: 24 });
    const m2 = new s.w.InstagramFeedButtons({ onExtract: () => true });
    m2.start();
    eq('没有「关注」时落到 ⋯ 左边 → right 40（701-667+6）',
      s.w.document.querySelector('main article > button.clipmate-ig-feed-btn').style.right, '40px');
    m2.stop();

    // 头像那颗「可点按钮」（离 ⋯ 400 多 px、宽 468）不能被当成避让目标，
    // 否则按钮会被推到帖子最左边压住头像
    const wide = '<!DOCTYPE html><html><body><main><article>'
      + '<a href="/p/CCCCCCCCCCC/"><time datetime="2026-10-31T15:32:08.000Z">1小时</time></a>'
      + '<button aria-label="头像" type="button"></button>'
      + '<button aria-label="更多选项" type="button"><svg></svg></button>'
      + '</article></main></body></html>';
    const t = openFeedDom(wide);
    const art3 = t.w.document.querySelector('main article');
    art3.getBoundingClientRect = () => ({ left: 231, right: 701, top: 0, bottom: 600, width: 470, height: 600 });
    art3.querySelector('[aria-label="头像"]').getBoundingClientRect =
      () => ({ left: 248, right: 280, top: 10, bottom: 42, width: 32, height: 32 });
    art3.querySelector('[aria-label="更多选项"]').getBoundingClientRect =
      () => ({ left: 667, right: 691, top: 14, bottom: 38, width: 24, height: 24 });
    const m3 = new t.w.InstagramFeedButtons({ onExtract: () => true });
    m3.start();
    eq('远处的头像不算避让目标 → 仍是 40',
      t.w.document.querySelector('main article > button.clipmate-ig-feed-btn').style.right, '40px');
    m3.stop();
  }

  /* ============ 三、只挂首页 / 弹层里不挂 / 离开要摘干净 ============ */
  section('三、范围：只挂首页；弹层里的帖子不挂；换页要撤干净');
  {
    // 非首页：一颗都不许挂
    const exp = openFeedDom(FEED_HTML, 'https://www.instagram.com/explore/');
    const m1 = new exp.w.InstagramFeedButtons({ onExtract: () => true });
    m1.start();
    eq('探索页一颗都不挂', exp.w.document.querySelectorAll('button.clipmate-ig-feed-btn').length, 0);

    // 首页 → 换到探索页：按钮与改过的样式都要还原
    const { w } = openFeedDom(FEED_HTML);
    const m2 = new w.InstagramFeedButtons({ onExtract: () => true });
    m2.start();
    eq('首页先挂上 2 颗', w.document.querySelectorAll('button.clipmate-ig-feed-btn').length, 2);
    const art0 = w.document.querySelectorAll('main article')[0];
    w.history.pushState({}, '', '/explore/');
    m2.sync();
    eq('换到探索页后按钮全摘', w.document.querySelectorAll('button.clipmate-ig-feed-btn').length, 0);
    eq('article 的 position 还原成空（不把布局改脏）', art0.style.position, '');
    ok('编号标记也清掉', !art0.hasAttribute('data-clipmate-ig-post'));

    // 弹层里那条不归这里管（弹层由 ModalWatcher 负责）。
    // ⚠️ 弹层故意塞在 `main` **里面**：真机上 dialog 是挂到 body 的 Portal，正常不会被
    //    `main article` 扫到；但 IG 换过几次挂载点，而「多挂一颗按钮在弹层上」的代价是
    //    两层按钮打架。这里就按最坏形态钉住 —— 弹层在 main 里也一颗都不许挂。
    const dialogHtml = '<!DOCTYPE html><html><body><main>'
      + feedPost({ code: 'FFFFFFFFFFFF' })
      + '<div role="dialog">' + feedPost({ code: 'GGGGGGGGGGGG' }) + '</div>'
      + '</main></body></html>';
    const dg = openFeedDom(dialogHtml);
    const m3 = new dg.w.InstagramFeedButtons({ onExtract: () => true });
    m3.start();
    const inDialog = dg.w.document.querySelectorAll('div[role="dialog"] article button.clipmate-ig-feed-btn');
    eq('弹层里的帖子不挂按钮', inDialog.length, 0);
    eq('信息流里的照挂', dg.w.document.querySelectorAll('main article > button.clipmate-ig-feed-btn').length, 1);
    m3.stop();
    m2.stop();
    m1.stop();
  }

  /* ============ 四、点击：拦得住、参数对、连点只跑一次 ============ */
  section('四、点击：不打开帖子、参数是这一条、连点只跑一次');
  {
    const { w } = openFeedDom(FEED_HTML);
    let parentClicked = 0;
    // IG 在帖子外层挂了「点一下打开帖子」——这里模拟它
    w.document.querySelectorAll('main article').forEach((a) => {
      a.addEventListener('click', () => { parentClicked++; });
    });

    let seen = null;
    let release = null;
    const mgr = new w.InstagramFeedButtons({
      onExtract: (t) => {
        seen = { code: t.shortcode, sameArticle: t.article === w.document.querySelectorAll('main article')[1] };
        return new Promise((res) => { release = res; });
      }
    });
    mgr.start();

    const btn = w.document.querySelectorAll('main article')[1].querySelector('button.clipmate-ig-feed-btn');
    const ev = new w.MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);

    await sleep(20);
    eq('点击没有冒泡出去（不会打开帖子）', parentClicked, 0);
    ok('默认行为被拦下', ev.defaultPrevented === true);
    ok('回调拿到了这一条（不是第 0 条）', !!(seen && seen.sameArticle));
    eq('回调拿到的编号正确', seen && seen.code, 'BBBBBBBBBBB');
    ok('提取中按钮是忙碌态', btn.classList.contains('is-busy'));

    // 连点：提取中再点一次不许再跑一遍
    btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(20);
    eq('提取中再点一次被忽略（只跑了一次）', seen && seen.code, 'BBBBBBBBBBB');
    ok('忙碌态没被清掉', btn.classList.contains('is-busy'));

    release(true);
    await sleep(60);
    ok('成功后闪绿', btn.classList.contains('is-ok'));

    // 失败也要有反馈（换一份干净 DOM：同一个页面上只该有一个管理器实例）
    const second = openFeedDom(FEED_HTML);
    let release2 = null;
    const mgr2 = new second.w.InstagramFeedButtons({ onExtract: () => new Promise((res) => { release2 = res; }) });
    mgr2.start();
    const btn2 = second.w.document.querySelectorAll('main article')[0].querySelector('.clipmate-ig-feed-btn');
    btn2.dispatchEvent(new second.w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(20);
    release2(false);
    await sleep(60);
    ok('失败后闪红', btn2.classList.contains('is-err'));
    mgr2.stop();
    mgr.stop();
  }

  /* ============ 五、React 重绘把按钮摘掉后要补回来 ============ */
  section('五、React 重绘：按钮被摘掉要自动补挂');
  {
    const { w } = openFeedDom(FEED_HTML);
    const mgr = new w.InstagramFeedButtons({ onExtract: () => true });
    mgr.start();
    const art = w.document.querySelectorAll('main article')[0];
    const btn = art.querySelector('.clipmate-ig-feed-btn');
    eq('先有 1 颗', art.querySelectorAll('.clipmate-ig-feed-btn').length, 1);

    // 模拟 React 整体替换子树：按钮被摘走，但编号标记还留在 article 上
    btn.remove();
    await sleep(500);
    eq('按钮被摘掉后补挂回来（标记留着不算数，要看按钮在不在）',
      art.querySelectorAll('.clipmate-ig-feed-btn').length, 1);
    ok('补回来的按钮编号还对', art.querySelector('.clipmate-ig-feed-btn').getAttribute('data-code') === 'AAAAAAAAAAA');
    mgr.stop();
  }

  /* ============ 六、真机链路：初始化后按钮真的出现 ============ */
  section('六、真机链路（走完整 init）');
  {
    const page = await harness.openPage({
      url: 'https://www.instagram.com/',
      html: FEED_HTML
    });
    const inst = await harness.waitForInit(page);
    ok('首页初始化完成', !!(inst && inst.isInitialized));
    const btns = page.window.document.querySelectorAll('main article > button.clipmate-ig-feed-btn');
    eq('初始化后首页自动挂上 2 颗逐帖按钮', btns.length, 2);
    const globalBtn = page.window.document.querySelector('button.media-extractor-button');
    ok('全局悬浮按钮在首页仍然藏着（首页没有「当前这一条」）',
      !!globalBtn && globalBtn.style.display === 'none');

    // 首页：浮窗不许被页面变化关掉
    let closed = false;
    inst.modalManager.isOpen = true;
    inst.modalManager.close = () => { closed = true; };
    inst._syncInstagramEntryVisibility();
    ok('首页上同步入口显隐**不许**关浮窗', closed === false);

    // 对照：探索页照旧要关（老行为不能被这次改动带坏）
    page.window.history.pushState({}, '', '/explore/');
    inst._syncInstagramEntryVisibility();
    ok('非首页（探索页）照旧关浮窗', closed === true);
  }

  /* ============ 七、逐帖提取的字段（真机形态 fixture） ============ */
  section('七、逐帖提取：全文/日期/作者/网址都对，且不串台');
  {
    // 桥节点：给 A 这条存一份「后端口径」的数据（文案是全文，比页面上多一段标签）
    const BRIDGE = JSON.stringify({
      v: 2,
      ts: Date.now(),
      media: {
        AAAAAAAAAAA: [1793460728, 'roxy_sitora', 'Roxy', 'Pretty much everyone asks me that.🤷🏻‍♀️\n\n#Tokyo\n#halloween', 1],
        // 推广帖：43 位编号（真机 `DfLVqntiJM_…Zk0` 形态）
        DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0: [1793489411, 'kellywang_studio', 'Kelly Wang', '推广帖的完整文案', 1]
      },
      profiles: {}
    });
    // 数据块：模拟首屏那批「服务端直出」的数据（桥节点收不到，只能扫 script）
    const DATA_SCRIPT = JSON.stringify({
      require: [['ScheduledServerJS', 'handle', null, [{
        xdt_api__v1__feed__timeline__connection: {
          edges: [{
            node: {
              media: {
                code: 'BBBBBBBBBBB',
                taken_at: 1793428000,
                user: { username: 'reiannwadare', full_name: 'れいあん' },
                caption: { text: 'ゴーゴー夕張\n#japan' },
                like_count: 466
              }
            }
          }]
        }
      }]]]
    });

    const html = '<!DOCTYPE html><html><head><title>Instagram</title>'
      + '<script type="application/json" id="clipmate-instagram-net">' + BRIDGE + '<\/script>'
      + '<script type="application/json">' + DATA_SCRIPT + '<\/script>'
      + '</head><body><main>'
      + feedPost({ code: 'AAAAAAAAAAA', caption: 'Pretty much everyone asks me that.🤷🏻‍♀️… 更多' })
      + feedPost({ code: 'BBBBBBBBBBB', user: 'reiannwadare', caption: 'ゴーゴー夕張' })
      + feedPost({ code: 'DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0', user: 'kellywang_studio', caption: '推广帖的完整文案… 更多' })
      + '</main></body></html>';

    const page = await harness.openPage({ url: 'https://www.instagram.com/', html });
    const inst = await harness.waitForInit(page);
    ok('初始化完成', !!(inst && inst.isInitialized));

    // 走**真链路**：点第二颗按钮 → handleExtract → 提取器 → 浮窗
    const arts = page.window.document.querySelectorAll('main article');
    const captured = [];
    inst.modalManager.open = async (data) => { captured.push(data); };

    eq('第 1 条（桥节点有数据）提取成功', await inst._onFeedPostExtract({ article: arts[0], shortcode: 'AAAAAAAAAAA' }), true);
    eq('第 2 条（数据块有数据）提取成功', await inst._onFeedPostExtract({ article: arts[1], shortcode: 'BBBBBBBBBBB' }), true);
    eq('第 3 条（43 位编号的推广帖）提取成功',
      await inst._onFeedPostExtract({ article: arts[2], shortcode: 'DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0' }), true);
    eq('三条都弹了浮窗', captured.length, 3);

    const d1 = captured[0] || {};
    const d2 = captured[1] || {};
    const d3 = captured[2] || {};

    eq('[A] 文案 = 接口全文（不被「… 更多」截断）',
      d1['本页文案'], 'Pretty much everyone asks me that.🤷🏻‍♀️\n\n#Tokyo\n#halloween');
    eq('[A] 日期 = 接口时间戳（2026/10/31）', d1['发布日期'], '2026/10/31');
    eq('[A] 作者ID', d1['作者ID'], 'roxy_sitora');
    eq('[A] 作者昵称 = 接口里的显示名', d1['作者昵称'], 'Roxy');
    eq('[A] 作者主页', d1['作者主页'], 'https://www.instagram.com/roxy_sitora/');
    eq('[A] 网址 = 这条作品自己的永久地址（不是点赞列表）', d1['URL'], 'https://www.instagram.com/p/AAAAAAAAAAA/');
    // 标题必须与「点开详情页再提取」逐字相同 —— 铁律：同一作品任何入口同一字符串。
    // v2.7.37：**两个入口都用昵称**（原来都错用用户名，真机标题写成 `roxysitora…`，
    // 用户一眼看出「作者昵称不对」）。这里昵称是 `Roxy`、用户名是 `roxy_sitora`，
    // 只要有人偷偷改回用户名，这条断言立刻红。
    eq('[A] 标题 = 昵称 + 文案前20字 + 日期（与详情页同一口径）',
      d1['本页标题'], EXPECT_IG_TITLE);
    ok('[A] 标题里的昵称不是用户名', String(d1['本页标题'] || '').indexOf('roxysitora') === -1,
      d1['本页标题']);
    ok('[A] 标题里不许出现「更多」', String(d1['本页标题'] || '').indexOf('更多') === -1, d1['本页标题']);

    eq('[B] 文案 = 数据块全文', d2['本页文案'], 'ゴーゴー夕張\n#japan');
    eq('[B] 日期 = 数据块时间戳', d2['发布日期'], '2026/10/31');
    eq('[B] 作者昵称 = 数据块 full_name', d2['作者昵称'], 'れいあん');
    eq('[B] 网址', d2['URL'], 'https://www.instagram.com/p/BBBBBBBBBBB/');

    // [C] 43 位编号的推广帖：编号规整的上限必须够长，否则连桥节点都查不到（退回 DOM 截断文案）
    eq('[C] 文案 = 桥节点全文（43 位编号也查得到接口数据）', d3['本页文案'], '推广帖的完整文案');
    eq('[C] 作者ID', d3['作者ID'], 'kellywang_studio');
    eq('[C] 作者昵称', d3['作者昵称'], 'Kelly Wang');
    eq('[C] 网址带完整编号', d3['URL'], 'https://www.instagram.com/p/DfLVqntiJM_Srd_cXI8d1gg5xKk8tXIFdgNVZk0/');
  }

  section('八、逐帖提取：接口说「没文案」时不许回去读 DOM');
  {
    // 真机 v2.7.8 的坑：接口明确 caption=null，代码却继续往下读 DOM，
    // 于是把页面上残留的、别人的文案记到了这一条上。
    const BRIDGE = JSON.stringify({
      v: 2, ts: Date.now(),
      media: { HHHHHHHHHHH: [1793460728, 'somebody', 'Some Body', '', 1] },
      profiles: {}
    });
    const html = '<!DOCTYPE html><html><head><title>Instagram</title>'
      + '<script type="application/json" id="clipmate-instagram-net">' + BRIDGE + '<\/script>'
      + '</head><body><main>'
      // 页面里**故意**放一段「像文案的脏文本」：接口说没文案时它不能被写进去
      + feedPost({ code: 'HHHHHHHHHHH', user: 'somebody', caption: '这是上一条帖子残留的脏文案，绝不能被当成这一条的正文' })
      + '</main></body></html>';
    const page = await harness.openPage({ url: 'https://www.instagram.com/', html });
    const inst = await harness.waitForInit(page);
    const art = page.window.document.querySelectorAll('main article')[0];

    const captured = [];
    inst.modalManager.open = async (data) => { captured.push(data); };
    eq('提取成功', await inst._onFeedPostExtract({ article: art, shortcode: 'HHHHHHHHHHH' }), true);

    const d = captured[0] || {};
    // 文案兜底是「Instagram帖子」（v2.5.98 起的空文案兜底），关键是不能是那段脏文本
    ok('文案不是 DOM 里那段脏文本', String(d['本页文案'] || '').indexOf('上一条帖子残留') === -1, d['本页文案']);
    eq('空文案走站名兜底', d['本页文案'], 'Instagram帖子');
    ok('标题里也不许带脏文本', String(d['本页标题'] || '').indexOf('上一条帖子残留') === -1, d['本页标题']);

    // v2.7.38：标题必须跟着文案走 —— 文案列早就写「Instagram帖子」了，标题却还写着
    // 「无文案」（真机：`一支花无文案-2026年10月31日`），一半新一半旧，用户一眼看出不对。
    // 根因是首页这条路径的内联拼标题绕过了装配器的「兜底词重生成」机制，v2.7.38 改成走
    // 统一入口 `extractTitle()`。把这里改回内联 generatePageTitle，下面三条立刻红。
    ok('空文案时标题用站名顶上（不再是「无文案」）',
      String(d['本页标题'] || '').indexOf('Instagram帖子') > -1, d['本页标题']);
    eq('标题里没有「无文案」三个字',
      String(d['本页标题'] || '').indexOf('无文案'), -1);
    ok('标题仍以昵称开头（昵称+站名+日期，段间无空格）',
      String(d['本页标题'] || '').indexOf('SomeBody') === 0, d['本页标题']);
  }

  section('八、逐帖提取：没有接口数据时走 DOM 兜底（剥掉「… 更多」尾巴）');
  {
    // 真机事实：首页首屏那批帖子是服务端直出的，桥节点收不到；
    // 正常情况能从 <script> 数据块补上，但数据块也可能读不到（页面结构变化）。
    // 这条用例把「两个来源都没有」的最差情况钉住：只能读 DOM，且必须把「… 更多」切掉。
    const html = '<!DOCTYPE html><html><head><title>Instagram</title></head><body><main>'
      + feedPost({ code: 'IIIIIIIIIII', caption: 'Pretty much everyone asks me that.🤷🏻‍♀️… 更多' })
      + '</main></body></html>';
    const page = await harness.openPage({ url: 'https://www.instagram.com/', html });
    const inst = await harness.waitForInit(page);
    const art = page.window.document.querySelectorAll('main article')[0];
    const captured = [];
    inst.modalManager.open = async (data) => { captured.push(data); };

    eq('提取成功', await inst._onFeedPostExtract({ article: art, shortcode: 'IIIIIIIIIII' }), true);
    const d = captured[0] || {};
    eq('文案从 DOM 取，并剥掉「… 更多」尾巴',
      d['本页文案'], 'Pretty much everyone asks me that.🤷🏻‍♀️');
    eq('日期从这条自己的 <time datetime> 取', d['发布日期'], '2026/10/31');
    eq('作者从单段链接取（不是话题/地点链接）', d['作者ID'], 'roxy_sitora');
    eq('网址用编号拼', d['URL'], 'https://www.instagram.com/p/IIIIIIIIIII/');
  }

  /* ============ 九、页面自己在变时，浮窗不许被整页范围覆盖 ============ */
  section('九、首页「页面自己在变」不许覆盖浮窗（v2.7.36 真机事故）');
  {
    // 事故经过（2026-11-01，用户换装 v2.7.35 后报）：
    //   「点完前几秒是对的，过几秒自己变了；再滚动提取别的帖子，会被换回第一条的信息」。
    // 根因：IG 首页每秒都在改 DOM（视频、点赞数、懒加载、滚动），ModalWatcher 把任何
    // body 变化都当成 SPA 换页 → `_doPageChange` 把作用域重置成 `document` 并刷新浮窗。
    // 首页没有「当前这一条」，整页范围提出来的是**别人**的作者、**别处**的文案、第一条的日期。
    // 真机实测被换成的就是：作者 alessc00（文档里第一个用户名）+ 一条广告的文案 + 第一条的时间。
    const page = await harness.openPage({ url: 'https://www.instagram.com/', html: FEED_HTML });
    const inst = await harness.waitForInit(page);
    ok('初始化完成', !!(inst && inst.isInitialized));
    const arts = page.window.document.querySelectorAll('main article');

    const updates = [];
    inst.modalManager.isOpen = true;
    inst.modalManager.updateInPlace = async (d) => { updates.push(d); };
    // 数「重新提取」的次数，而不是靠浮窗有没有变 —— 整页范围提取在 jsdom 里可能被判无效、
    // 也可能抛错，只看浮窗变没变会让这条断言时红时绿（真机事故就是这么藏了一版）。
    let extracted = 0;
    inst.extractFromCurrentPage = async () => { extracted++; return { '本页文案': '整页范围的脏文案' }; };

    // 模拟「用户刚点完某一条」的状态。
    // ⚠️ cacheKey 必须一并改成**作品维度**的键：真机上 handleExtract 每次都会重算它，
    //    点完之后 cacheKey 就是 `host/p/<code>`；如果这里仍留着首页键，
    //    _doPageChange 会判「还是同一个目标」直接返回，这条用例就永远绿（假绿）。
    inst.activeContext = arts[0];
    inst.activeShortcode = 'AAAAAAAAAAA';
    inst.cacheKey = 'www.instagram.com/p/AAAAAAAAAAA';
    await inst._doPageChange();
    eq('首页页面变化：一次都不许重新提取', extracted, 0);
    eq('首页页面变化：一次都不许刷新浮窗（真机事故的直接闸口）', updates.length, 0);
    ok('首页页面变化：作用域不许被重置成整页（首页没有「当前这一条」）',
      inst.activeContext === arts[0]);

    // 第二条闸：就算有人（老代码 / 别的入口）拿着整页作用域来刷新，也必须被拒
    inst.activeContext = page.window.document;
    extracted = 0;                                   // 从现在开始计数，只量这一次
    await inst._refreshOpenPanel();
    eq('整页作用域 Refresh：不许重新提取', extracted, 0);
    eq('整页作用域 Refresh：同样一次都不许刷新', updates.length, 0);

    // 第一道闸的第二个作用：开了「自动提取」的用户，首页页面变化也不许自动跑一次提取。
    //（首页没有「当前这一条」，跑出来的必然是整页范围的垃圾 —— 跟上面是同一个病。
    //  这里拦在 handleExtract 这一层，只量「有没有走这条分支」。）
    inst.modalManager.isOpen = false;
    inst.autoExtract = true;
    let autoCalls = 0;
    inst.handleExtract = async () => { autoCalls++; return true; };
    await inst._doPageChange();
    eq('首页 + 自动提取：也不许自动跑一次提取', autoCalls, 0);
    inst.autoExtract = false;
    inst.modalManager.isOpen = true;

    // 对照：帖子详情页照旧要刷新 —— 别把老行为一起带坏
    const page2 = await harness.openPage({ url: 'https://www.instagram.com/p/AAAAAAAAAAA/', html: FEED_HTML });
    const inst2 = await harness.waitForInit(page2);
    ok('详情页初始化完成', !!(inst2 && inst2.isInitialized));
    let refreshed = 0;
    inst2.modalManager.isOpen = true;
    inst2.modalManager.updateInPlace = async () => {};
    inst2.extractFromCurrentPage = async () => { refreshed++; return { '本页文案': '详情页自己的文案' }; };
    inst2.cacheKey = 'force-different';       // 让「同一目标」判定不成立，走刷新分支
    await inst2._doPageChange();
    eq('非首页（帖子详情页）照旧就地刷新浮窗', refreshed, 1);
  }

  /* ============ 十、真机时序：页面每秒都在变，浮窗仍然不动 ============ */
  section('十、真机时序：每秒都在变的信息流里浮窗不许动（走真 MutationObserver）');
  {
    // 上面第九节是「直接喊一声 _doPageChange」；这一节把整条链跑通：
    // body 持续突变 → IGModalWatcher（150ms 防抖）→ onPageChange（idle 800ms）
    // → 页面切换防抖（500ms）→ _doPageChange。
    // 真机上这条链每隔一两秒就走一遍，v2.7.35 就是这样把用户的浮窗换掉的。
    const page = await harness.openPage({ url: 'https://www.instagram.com/', html: FEED_HTML });
    const inst = await harness.waitForInit(page);
    ok('初始化完成', !!(inst && inst.isInitialized));
    const arts = page.window.document.querySelectorAll('main article');

    const updates = [];
    inst.modalManager.isOpen = true;
    inst.modalManager.updateInPlace = async (d) => { updates.push(d); };
    let extracted = 0;
    inst.extractFromCurrentPage = async () => { extracted++; return { '本页文案': '整页范围的脏文案' }; };
    inst.activeContext = arts[0];
    inst.cacheKey = 'www.instagram.com/p/AAAAAAAAAAA';   // 点完之后就是这个键（见上一节的说明）

    // 数「页面变化」被喊了几次：证明这条链路真的在跑（接线断了应当变红）
    let pageChanges = 0;
    const rawDoPageChange = inst._doPageChange.bind(inst);
    inst._doPageChange = function () { pageChanges++; return rawDoPageChange(); };

    // 每 150ms 往帖子里塞一个节点 —— 点赞数变化、懒加载、滚出新帖都是这个形态
    const timer = setInterval(() => {
      try {
        const el = page.window.document.createElement('div');
        el.textContent = 'like-count ' + Date.now();
        arts[1].appendChild(el);
      } catch (e) { /* 页面卸载就停 */ }
    }, 150);
    await sleep(3000);
    clearInterval(timer);
    await sleep(2200);      // 留足：150 + 800 + 500，让最后一批突变把整条链走完

    // ⚠️ 先证明这条链**真的跑起来过**：否则断言恒绿 = 空转（本项目踩过多次假绿的坑）。
    // 数 _doPageChange 被调用的次数，同时保留原实现。
    ok('这 3 秒里「页面变化」真的触发过（链路是活的，不是空转）', pageChanges > 0, pageChanges);
    eq('真时序：一次都没重新提取过', extracted, 0);
    eq('真时序：浮窗一次都没被刷新', updates.length, 0);
  }

  /* ============ 十一、详情页标题口径（v2.7.37） ============ */
  section('十一、详情页标题也用昵称（同一作品两个入口必须同一字符串）');
  {
    // v2.7.37 的真机事故：标题写成 `roxysitoraBoocrew-…`（用户名），用户一眼看出「作者昵称不对」。
    // 根因在 `extractTitle` 把 `extractAuthorName()`（用户名）当昵称传进标题处理器。
    // 这里打桩昵称/用户名两个来源，验的就是「传进去的到底是谁」——不依赖 IG 那堆混淆类名，
    // 也就不会因为页面改版而假绿。
    const page = await harness.openPage({
      url: 'https://www.instagram.com/p/AAAAAAAAAAA/',
      html: '<!DOCTYPE html><html><head></head><body><article></article></body></html>'
    });
    const fx = new page.bridge.ExtractorFactory();
    const ex = fx.getExtractorByUrl('https://www.instagram.com/p/AAAAAAAAAAA/');
    ok('详情页拿到 IG 提取器', !!ex);
    if (ex) {
      ex.extractAuthorNickname = () => 'Roxy';
      ex.extractAuthorName = () => 'roxy_sitora';
      ex.extractPublishDate = () => '2026/10/31';
      const t = ex.extractTitle('Pretty much everyone asks me that.🤷🏻‍♀️\n\n#Tokyo\n#halloween');
      eq('详情页标题 = 昵称 + 文案前20字 + 日期', t, EXPECT_IG_TITLE);
      ok('详情页标题里不许出现用户名', String(t).indexOf('roxy_sitora') === -1, t);
      // 与第七节首页逐帖那条用的是**同一个常量**：只改一处、另一处没改，这里立刻红。
      eq('与首页逐帖的标题逐字相同（同一作品任何入口同一字符串）', t, EXPECT_IG_TITLE);
    }
  }

  /* ============ 十二、接线与源码（防「代码写了但没接上」） ============ */
  section('十二、接线与源码');
  {
    const manifest = JSON.parse(fs.readFileSync(P.manifest, 'utf8'));
    const allScripts = (manifest.content_scripts || []).reduce((acc, cs) => acc.concat(cs.js || []), []);
    const iBtn = allScripts.indexOf('src/content/ui/instagram-feed-buttons.js');
    const iMain = allScripts.indexOf('src/content/content-main.js');
    const iHandler = allScripts.indexOf('src/content/ui/ig-spa-handler.js');
    ok('manifest 注册了 instagram-feed-buttons.js', iBtn > -1);
    ok('注册顺序：在 ig-spa-handler.js 之前', iBtn > -1 && iHandler > -1 && iBtn < iHandler);
    ok('注册顺序：在 content-main.js 之前（初始化时要用到）', iBtn > -1 && iMain > -1 && iBtn < iMain);
    ok('版本号已更新到 2.7.36 及以上（当前 2.8.x）',
      /^2\.(7\.(3[6-9]|[4-9]\d)|[89]\.\d+)$/.test(String(manifest.version || '')), manifest.version);

    const main = fs.readFileSync(P.main, 'utf8');
    ok('[接线] content-main 的 IG 分支调用了 _initInstagramFeedButtons',
      /_initInstagramFeedButtons\(\)/.test(main));
    ok('[接线] handleExtract 返回布尔（逐帖按钮靠它闪绿/闪红）',
      /return true;\s*\n\s*\} catch \(error\) \{/.test(main) && /return false;/.test(main));
    ok('[接线] handleExtract 把 opts 透传给 extractFromCurrentPage',
      /extractFromCurrentPage\(this\.activeContext, opts\)/.test(main));
    ok('[接线] extractFromCurrentPage 把 extraOpts 并进 extractAllFields',
      /extractAllFields\(Object\.assign\(\{[\s\S]{0,120}\}, extraOpts \|\| \{\}\)\)/.test(main));

    const handler = fs.readFileSync(P.handler, 'utf8');
    ok('[接线] ig-spa-handler 里首页判定出现在关浮窗之前',
      handler.indexOf('_isIgFeedPage()') > -1
      && handler.indexOf('_isIgFeedPage()') < handler.lastIndexOf('_closeIgPanelOnly('));
    ok('[接线] 逐帖提取会还原 activeContext（首页没有「当前这一条」）',
      /finally\s*\{[\s\S]{0,200}this\.activeContext = prevContext;/.test(handler));

    const social = fs.readFileSync(P.social, 'utf8');
    ok('[提取] extractAllFields 里有 feedPost 分支',
      /if \(opts\.feedPost\)\s*\{\s*return await this\._buildFeedPostRecord/.test(social));
    ok('[提取] 正文容器选择器用真机验过的 _aacu',
      social.indexOf('span._ap3a._aaco._aacu._aacx._aad7._aade') > -1);
    ok('[提取] 有剥「… 更多」尾巴的处理', /_stripMoreTail/.test(social));
    ok('[提取] 日期三步：接口时间戳 → time[datetime] → 相对时间',
      /inline\.takenAt/.test(social) && /querySelector\('time'\)/.test(social));
  }

  console.log('\n结果：' + pass + '/' + (pass + fail) + ' 通过 — Instagram 首页逐帖提取（v2.7.37）');
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试自身异常：', e);
  process.exit(1);
});
