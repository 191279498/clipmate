/**
 * 豆瓣「想看 / 在看 / 看过」列表页逐条按钮 · 单测（v2.11.4）
 *
 * 为什么单独做一份：
 *   这一版动了三块平时没人碰的东西，快照回归一个都测不到：
 *     ① `page-shape` 新增一张「只认列表」的白名单（判错会把豆瓣非列表页的大按钮藏掉）
 *     ② `content-main` 的自动收起判据从「站点组」扩到「页面形态」（判错会让全站浮窗乱关）
 *     ③ 豆瓣提取器改成「可换一份文档来读」（改错等于 20 多个站点的提取全乱）
 *   所以这里用**三份真实存档**（2026-11-04 接管已登录 Edge 抓的，原样保存）：
 *     douban-list-wish-grid.html    想看列表·网格视图，15 条
 *     douban-list-wish-list.html    想看列表·列表视图，30 条
 *     douban-movie-10441174.html    《基和皮尔 第一季》详情页，两套视图抓的都是它
 *
 * 跑法（项目根目录）：
 *   node tests/douban-list.test.js
 *   node tests/douban-list.test.js --verbose
 *
 * 判定：全部通过退出码 0，有任何失败退出码 1。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'ClipMate_chrome');
const FIXTURES = path.join(__dirname, 'fixtures', 'html');
const VERBOSE = process.argv.includes('--verbose');

const P = (rel) => path.join(EXT, rel);
const F = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

let pass = 0;
const fails = [];

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      实际 ${JSON.stringify(detail)}`}`);
  }
}

function eq(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${a}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}\n      得到 ${a}\n      期望 ${b}`);
  }
}

function section(t) {
  console.log(`\n${t}`);
}

/* ============================================================
 * 通用加载器：按 manifest 顺序把脚本塞进 jsdom
 * ==========================================================*/

const BASE_SCRIPTS = [
  'src/shared/config/media-types.js',
  'src/shared/country-names.js',
  'src/shared/country-extract.js',
  'src/content/utils/page-shape.js'
];

/** 造一个带 url 的 jsdom 页面，并注入指定脚本 */
function makePage({ url, html, scripts }) {
  const dom = new JSDOM(html || '<!DOCTYPE html><html><body></body></html>', {
    url,
    runScripts: 'outside-only'
  });
  const w = dom.window;
  // 提取器与 UI 组件都假设有 ClipMateLog
  w.eval('window.ClipMateLog = { debug: function () {}, warn: function () {}, error: function () {} };');
  for (const rel of scripts) {
    w.eval(fs.readFileSync(P(rel), 'utf8'));
  }
  return w;
}

/* ============================================================
 * 一、page-shape：豆瓣收藏三态 = feed，其它页面一个都不能误伤
 * ==========================================================*/
(async function main() {
section('一、页面形态（page-shape）');
{
  const w = makePage({
    url: 'https://movie.douban.com/people/48250148/wish',
    scripts: ['src/content/utils/page-shape.js']
  });
  const PS = w.PageShape;

  const shape = (hostname, pathname, mediaType) =>
    PS.shapeOf({ hostname: hostname, pathname: pathname, mediaType: mediaType || null });

  // —— 该判成 feed 的：三态 × 两种视图（视图只差 ?mode=，pathname 完全一致）
  eq('想看 → feed', shape('movie.douban.com', '/people/48250148/wish'), 'feed');
  eq('在看 → feed', shape('movie.douban.com', '/people/48250148/do'), 'feed');
  eq('看过 → feed', shape('movie.douban.com', '/people/48250148/collect'), 'feed');
  eq('带尾部斜杠也认', shape('movie.douban.com', '/people/48250148/wish/'), 'feed');
  eq('别人 ID 的收藏页也认', shape('movie.douban.com', '/people/99999999/collect'), 'feed');

  // —— 一个都不能误伤的：豆瓣其它页面（判成 feed 会直接把大按钮藏掉）
  eq('条目详情页不算 feed', shape('movie.douban.com', '/subject/1292052/'), 'unknown');
  eq('影评页不算 feed', shape('movie.douban.com', '/review/1234567/'), 'unknown');
  eq('影人页不算 feed', shape('movie.douban.com', '/celebrity/1025141/'), 'unknown');
  eq('榜单页不算 feed', shape('movie.douban.com', '/chart'), 'unknown');
  eq('用户主页不算 feed', shape('movie.douban.com', '/people/48250148/'), 'unknown');
  eq('收藏页的子路径（分页之类）不算 feed',
    shape('movie.douban.com', '/people/48250148/wish/xx'), 'unknown');

  // —— v2.11.5：读书 / 游戏三态也纳入，但别的路径一个都不许被带进来
  eq('读书想读 → feed', shape('book.douban.com', '/people/48250148/wish'), 'feed');
  eq('读书在读 → feed', shape('book.douban.com', '/people/48250148/do'), 'feed');
  eq('读书读过 → feed', shape('book.douban.com', '/people/48250148/collect'), 'feed');
  eq('游戏三态（同一个 path，靠 ?action= 区分）→ feed',
    shape('www.douban.com', '/people/48250148/games'), 'feed');
  eq('www 的普通收藏路径不算 feed',
    shape('www.douban.com', '/people/48250148/wish'), 'unknown');
  eq('读书详情页不受影响', shape('book.douban.com', '/subject/1084336/'), 'unknown');
  eq('游戏详情页不受影响', shape('www.douban.com', '/game/26243433/'), 'unknown');
  eq('www 用户主页不受影响', shape('www.douban.com', '/people/48250148/'), 'unknown');

  // —— 微博 / X 的老规则必须一字不变（这两站是 v2.10.0 的既有行为）
  eq('微博首页仍是 feed', shape('weibo.com', '/'), 'feed');
  eq('微博单条仍是 detail', shape('weibo.com', '/123456/AbCdEfGh'), 'detail');
  eq('微博搜索页仍是 feed', shape('s.weibo.com', '/weibo?q=x'), 'feed');
  eq('X 首页仍是 feed', shape('x.com', '/home'), 'feed');
  eq('X 单条仍是 detail', shape('x.com', '/someone/status/123456'), 'detail');
  eq('没登记的站仍是 unknown', shape('www.douyin.com', '/'), 'unknown');

  // —— 白名单必须只认 pathname，不看 query（query 天天变，进去就漏）
  eq('LIST_PAGES 覆盖影视 / 读书 / 游戏三站',
    Object.keys(PS.LIST_PAGES).sort(),
    ['book.douban.com', 'douban.com', 'movie.douban.com']);
  eq('doubanListKind 影视 → movie', PS.doubanListKind('movie.douban.com', '/people/x/wish'), 'movie');
  eq('doubanListKind 读书 → book', PS.doubanListKind('book.douban.com', '/people/x/do'), 'book');
  eq('doubanListKind 游戏 → game', PS.doubanListKind('www.douban.com', '/people/x/games'), 'game');
  eq('doubanListKind 详情页 → null', PS.doubanListKind('movie.douban.com', '/subject/1292052/'), null);
  eq('doubanListKind 别站 → null', PS.doubanListKind('weibo.com', '/people/x/wish'), null);

  // —— 形态判定不能被「有没有大按钮」绑架（v2.11.4 修的那个死结）
  ok('shapeOf 是纯函数，不读 DOM 里的按钮',
    typeof PS.shapeOf === 'function' &&
    !/media-extractor-button/.test(w.eval('PageShape.shapeOf.toString()')));
}

/* ============================================================
 * 二、site-config：用户显式设置必须压过页面形态
 * ==========================================================*/
section('二、自动收起的配置判定（site-config）');
{
  const w = makePage({
    url: 'https://movie.douban.com/people/48250148/wish',
    scripts: ['src/shared/site-config.js']
  });
  const SC = w.ClipMateSites;

  const r1 = SC.resolve({}, 'movie.douban.com');
  eq('豆瓣默认：不开自动收起', r1.autoDismiss, false);
  eq('豆瓣默认：不是用户显式设的', r1.autoDismissExplicit, false);

  const r2 = SC.resolve({ siteOverrides: { 'movie.douban.com': { autoDismiss: true } } }, 'movie.douban.com');
  eq('站点覆盖开 → 开', r2.autoDismiss, true);
  eq('站点覆盖开 → 记录为显式', r2.autoDismissExplicit, true);

  const r3 = SC.resolve({ siteOverrides: { 'movie.douban.com': { autoDismiss: false } } }, 'movie.douban.com');
  eq('站点覆盖关 → 关', r3.autoDismiss, false);
  eq('站点覆盖关 → 记录为显式（形态不得覆盖它）', r3.autoDismissExplicit, true);

  const r4 = SC.resolve({ settings: { autoDismiss: false } }, 'movie.douban.com');
  eq('老配置「全局关」仍是关', r4.autoDismiss, false);
  eq('老配置「全局关」也算显式', r4.autoDismissExplicit, true);

  const r5 = SC.resolve({}, 'weibo.com');
  eq('微博（社交组）默认仍开', r5.autoDismiss, true);
  eq('微博不是显式（由站点组算出来的）', r5.autoDismissExplicit, false);
}

/* ============================================================
 * 二·B、_applyAutoDismiss 的真行为
 *
 * 为什么单独测：这是「滚动自动关浮窗」唯一的判定入口，两个调用方（正常页面 / 豆瓣列表页）
 * 共用它。如果只断言源码里有这么一行，改成 `if (false)` 也照样"通过"——
 * 所以这里把方法体从 content-main 里抠出来、真跑一遍，喂不同的形态与配置看它开关。
 * ==========================================================*/
section('二·B、自动收起判定的真行为（_applyAutoDismiss）');
{
  const CM_SRC = fs.readFileSync(P('src/content/content-main.js'), 'utf8');

  /** 从源码里抠出一个方法（按大括号配对），返回可执行函数 */
  function extractMethod(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) return null;
    let depth = 0;
    for (let j = src.indexOf('{', start); j < src.length; j++) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    return null;
  }

  const methodText = extractMethod(CM_SRC, '  _applyAutoDismiss(eff) {');
  ok('能从 content-main 里抠出 _applyAutoDismiss', !!methodText);

  if (methodText) {
    let factory = null;
    try {
      // eslint-disable-next-line no-new-func
      factory = new Function('ClipMateBrowseDismiss',
        'return ({ ' + methodText.trim() + ' })._applyAutoDismiss;');
    } catch (e) {
      ok('方法体能被求值（语法与独立函数兼容）', false, e && e.message);
    }

    if (factory) {
      const run = (shape, eff) => {
        const seen = { enabled: null, glide: null, called: 0 };
        const stub = {
          GLIDE_MS_FEED: 1000,
          setEnabled: (v) => { seen.enabled = v; seen.called++; },
          setGlide: (v) => { seen.glide = v; }
        };
        factory(stub).call({ _pageShape: shape }, eff);
        return seen;
      };

      // feed 形态 + 配置还没读（豆瓣列表页就走这条）→ 必须开
      const a = run('feed', null);
      eq('feed 形态、配置未读 → 开', a.enabled, true);
      eq('feed 形态 → 宽限期放宽到 1000ms', a.glide, 1000);

      // 非 feed、配置未读 → 不能凭空打开（否则任意站点翻滚都会关窗）
      const b = run('unknown', null);
      eq('非 feed、配置未读 → 不开', b.enabled, false);
      eq('非 feed → 宽限期仍是 350ms', b.glide, 350);

      // 非 feed + 社交站（eff 说开）→ 开
      const c = run('detail', { autoDismiss: true, autoDismissExplicit: false });
      eq('非 feed、站点组默认开 → 开', c.enabled, true);
      eq('非 feed 即便站点开，宽限期也不放宽', c.glide, 350);

      // feed + 用户显式关 → 必须听用户（这是最容易被形态硬覆盖掉的一条）
      const d = run('feed', { autoDismiss: false, autoDismissExplicit: true });
      eq('feed 形态但用户显式关 → 关（用户意愿最高）', d.enabled, false);

      // feed + 用户显式开 → 开
      const e2 = run('feed', { autoDismiss: true, autoDismissExplicit: true });
      eq('feed 形态且用户显式开 → 开', e2.enabled, true);

      // 非 feed + 用户显式开（豆瓣详情页手动打开）→ 开
      const f = run('unknown', { autoDismiss: true, autoDismissExplicit: true });
      eq('非 feed 但用户显式开 → 开', f.enabled, true);

      // 判定只调一次（防止有人顺手写成每帧调）
      eq('每次判定只应用一次', run('feed', null).called, 1);
    }
  }
}

/* ============================================================
 * 三、douban-list-fetch：地址解析 / 熔断 / 闸门 / 缓存
 * ==========================================================*/
section('三、抓取模块（douban-list-fetch）');
{
  const w = makePage({
    url: 'https://movie.douban.com/people/48250148/wish',
    scripts: ['src/content/ui/douban-list-fetch.js']
  });
  const LF = w.DoubanListFetch;

  // —— 地址解析
  eq('取条目编号（标准地址）', LF.subjectIdOf('https://movie.douban.com/subject/10441174/'), '10441174');
  eq('取条目编号（带查询串）', LF.subjectIdOf('https://movie.douban.com/subject/10441174/?from=x'), '10441174');
  eq('取条目编号（无尾部斜杠）', LF.subjectIdOf('https://movie.douban.com/subject/10441174'), '10441174');
  eq('取条目编号（相对地址）', LF.subjectIdOf('/subject/10441174/'), '10441174');
  eq('取条目编号（读书详情）', LF.subjectIdOf('https://book.douban.com/subject/3894842/'), '3894842');
  eq('取条目编号（游戏详情）', LF.subjectIdOf('https://www.douban.com/game/26243433/'), '26243433');
  eq('缓存键带站点（读书和影视同号不撞）',
    LF.cacheKeyOf('https://book.douban.com/subject/3894842/'), 'book.douban.com/p/3894842');
  eq('缓存键带站点（游戏）',
    LF.cacheKeyOf('https://www.douban.com/game/26243433/'), 'www.douban.com/p/26243433');
  eq('不是条目页 → 空', LF.subjectIdOf('https://movie.douban.com/people/48250148/wish'), '');
  eq('空值 → 空', LF.subjectIdOf(''), '');
  eq('归一化补全协议与尾斜杠',
    LF.normalize('//movie.douban.com/subject/10441174?x=1'),
    'https://movie.douban.com/subject/10441174/');

  // —— 熔断：四种风控形态，一个都不能漏
  ok('正常长度的页面 → 不拦', LF._blockHit('<html>' + 'x'.repeat(3000) + '</html>') === '');
  {
    const w2 = makePage({
      url: 'https://movie.douban.com/people/48250148/wish',
      scripts: ['src/content/ui/douban-list-fetch.js']
    });
    const L2 = w2.DoubanListFetch;
    const pad = 'x'.repeat(3000);

    ok('验证码域名 → 认成「验证码」', L2._blockHit(pad + 'sec.douban.com') === '验证码');
    ok('异常请求文案 → 认成「异常请求」', L2._blockHit(pad + '检测到有异常请求') === '异常请求');
    ok('被踢到登录页 → 认成「要登录」',
      L2._blockHit(pad + 'accounts.douban.com/passport/login') === '要登录');
    ok('内容过短 → 认成「页面内容为空」', L2._blockHit('<html></html>') === '页面内容为空');
    ok('正常页（长度够、没特征）→ 不拦', L2._blockHit(pad) === '');

    // —— 熔断后不再发请求：这是硬约束（用户定的风控铁律「遇验证码立刻停手」）
    L2._block('测试熔断');
    ok('熔断后 isBlocked 为真', L2.isBlocked() === true);
    ok('熔断原因带得出', L2.blockedReason() === '测试熔断');
    let fetchCalled = 0;
    const realFetch = w2.fetch;
    w2.fetch = () => { fetchCalled++; return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('x') }); };
    await L2.load('https://movie.douban.com/subject/10441174/').then((r) => {
      ok('熔断期间 load 直接失败', r.ok === false);
      ok('熔断期间一个请求都没发出去', fetchCalled === 0, fetchCalled);
    });
    w2.fetch = realFetch;
    L2.clearBlock();
    ok('清熔断后恢复可用', L2.isBlocked() === false);
  }

  // —— 单请求闸门：同一时刻只能有一个在飞
  {
    const w3 = makePage({
      url: 'https://movie.douban.com/people/48250148/wish',
      scripts: ['src/content/ui/douban-list-fetch.js']
    });
    const L3 = w3.DoubanListFetch;
    const detailHtml = F('douban-movie-10441174.html');
    let release = null;
    w3.fetch = () => new Promise((resolve) => {
      release = () => resolve({ ok: true, status: 200, text: () => Promise.resolve(detailHtml) });
    });

    const first = L3.load('https://movie.douban.com/subject/10441174/');
    ok('第一个请求在飞时 isBusy 为真', L3.isBusy() === true);
    const second = await L3.load('https://movie.douban.com/subject/10441175/');
    ok('第二个请求被闸门拦下', second.ok === false && /稍等/.test(second.reason), second.reason);

    release();
    const firstResult = await first;
    ok('第一个请求正常返回', firstResult.ok === true);
    ok('返回的文档能取到标题', /基和皮尔/.test(String(firstResult.doc.title)), String(firstResult.doc.title));
    ok('返回后 busy 归位', L3.isBusy() === false);

    // —— 内存缓存：同一条第二次不再发请求
    //    （先清掉上面闸门那段留下的缓存，否则这里测的是「上一段的缓存」而不是本段逻辑）
    L3._cache = null;
    let hits = 0;
    w3.fetch = () => { hits++; return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(detailHtml) }); };
    const a = await L3.load('https://movie.douban.com/subject/10441174/');
    const b = await L3.load('https://movie.douban.com/subject/10441174/');
    ok('两次都成功', a.ok === true && b.ok === true);
    ok('同一条连抓两次只发一次请求（第二次走缓存）', hits === 1, hits);

    // —— 缓存按条目编号隔离，不同条目互不串
    const c = await L3.load('https://movie.douban.com/subject/10441176/');
    ok('不同条目会重新请求', hits === 2, hits);
    ok('不同条目拿到的确实是新抓的那份', c.ok === true);
  }

  // —— 失败文案要说人话（按钮直接显示，不再二次翻译）
  {
    const w4 = makePage({
      url: 'https://movie.douban.com/people/48250148/wish',
      scripts: ['src/content/ui/douban-list-fetch.js']
    });
    const L4 = w4.DoubanListFetch;
    const r = await L4.load('https://movie.douban.com/people/48250148/wish');
    ok('地址不是条目页 → 说「没有可访问的详情页」', /详情页/.test(r.reason), r.reason);

    w4.fetch = () => Promise.resolve({
      ok: false, status: 403,
      text: () => Promise.resolve('forbidden')
    });
    const r2 = await L4.load('https://movie.douban.com/subject/10441174/');
    ok('403 的提示里带状态码', /403/.test(r2.reason), r2.reason);
    ok('403 之后进入熔断', L4.isBlocked() === true);
  }
}

/* ============================================================
 * 四、douban-list-buttons：两种视图都要挂得上、挂得准
 * ==========================================================*/
section('四、列表按钮（douban-list-buttons）');
{
  const load = (file, url) => makePage({
    url,
    html: F(file),
    scripts: [
      'src/content/ui/douban-list-fetch.js',
      'src/content/ui/douban-list-buttons.js'
    ]
  });

  const URL_GRID = 'https://movie.douban.com/people/48250148/wish';
  const URL_LIST = 'https://movie.douban.com/people/48250148/wish?mode=list';

  // —— 网格视图
  {
    const w = load('douban-list-wish-grid.html', URL_GRID);
    const items = w.document.querySelectorAll('.item');
    const btns = new w.DoubanListButtons({ onExtract: async () => true });
    btns.start();

    const mounted = w.document.querySelectorAll('.clipmate-douban-item-btn');
    eq('网格视图：每条都挂上', mounted.length, items.length);
    eq('网格视图：条目数 15', items.length, 15);

    let inTitle = 0;
    mounted.forEach((b) => { if (b.closest('.title')) inTitle++; });
    // v2.11.7：按钮从标题里搬到了条目上（绝对定位），否则标题长短会让每一条位置都不一样
    eq('网格视图：没有一颗按钮落在标题里', inTitle, 0);

    let direct = 0;
    items.forEach((it) => {
      for (let k = 0; k < it.children.length; k++) {
        if (it.children[k].classList.contains('clipmate-douban-item-btn')) direct++;
      }
    });
    eq('网格视图：按钮是条目的直接子节点', direct, items.length);

    const css = w.document.getElementById('clipmate-douban-item-style');
    ok('按钮用绝对定位（不占文档流 → 行高不会变）',
      !!css && /\.clipmate-douban-item-btn\{[^}]*position:absolute/.test(css.textContent));
    ok('按钮不再用 inline-block + 负 margin 撑在标题里',
      !!css && !/inline-block/.test(css.textContent) && !/margin:-5px/.test(css.textContent));

    let hosts = 0;
    items.forEach((it) => { if (it.style.position === 'relative') hosts++; });
    eq('网格视图：每个条目都成了定位祖先', hosts, items.length);

    let withSubject = 0;
    mounted.forEach((b) => { if (/^\d+$/.test(b.getAttribute('data-cm-subject') || '')) withSubject++; });
    eq('网格视图：每个按钮都记着条目编号', withSubject, mounted.length);

    // 每颗按钮的编号必须与它所在条目的链接一致（挂错位置最难发现）
    let mismatch = 0;
    items.forEach((it) => {
      const a = it.querySelector('.title a[href*="/subject/"]');
      const b = it.querySelector('.clipmate-douban-item-btn');
      if (!a || !b) { mismatch++; return; }
      const id = (/\/subject\/(\d+)/.exec(a.getAttribute('href')) || [])[1];
      if (b.getAttribute('data-cm-subject') !== id) mismatch++;
    });
    eq('网格视图：按钮编号与所在条目一一对应', mismatch, 0);

    // 幂等：再同步一次不能翻倍
    btns.sync();
    eq('网格视图：重复 sync 不会挂出第二批',
      w.document.querySelectorAll('clipmate-douban-item-btn, .clipmate-douban-item-btn').length,
      mounted.length);

    btns.stop();
    eq('stop 后按钮全摘', w.document.querySelectorAll('.clipmate-douban-item-btn').length, 0);
  }

  // —— 列表视图
  {
    const w = load('douban-list-wish-list.html', URL_LIST);
    const items = w.document.querySelectorAll('.item');
    const btns = new w.DoubanListButtons({ onExtract: async () => true });
    btns.start();

    eq('列表视图：条目数 30', items.length, 30);
    eq('列表视图：每条都挂上',
      w.document.querySelectorAll('.clipmate-douban-item-btn').length, items.length);

    let inTitle = 0;
    w.document.querySelectorAll('.clipmate-douban-item-btn').forEach((b) => {
      if (b.closest('.title')) inTitle++;
    });
    eq('列表视图：按钮也不在标题里（每行位置才统一）', inTitle, 0);

    let direct = 0;
    items.forEach((it) => {
      for (let k = 0; k < it.children.length; k++) {
        if (it.children[k].classList.contains('clipmate-douban-item-btn')) direct++;
      }
    });
    eq('列表视图：按钮是条目的直接子节点', direct, items.length);
    btns.stop();
  }

  // —— 不是收藏页就一颗都不挂（详情页、条目页、别人的普通主页）
  {
    const w = makePage({
      url: 'https://movie.douban.com/subject/10441174/',
      html: F('douban-movie-10441174.html'),
      scripts: ['src/content/ui/douban-list-fetch.js', 'src/content/ui/douban-list-buttons.js']
    });
    const btns = new w.DoubanListButtons({ onExtract: async () => true });
    btns.start();
    eq('详情页一颗都不挂', w.document.querySelectorAll('.clipmate-douban-item-btn').length, 0);
    btns.stop();
  }
  {
    const w = makePage({
      url: 'https://movie.douban.com/people/48250148/',
      html: F('douban-list-wish-grid.html'),
      scripts: ['src/content/ui/douban-list-fetch.js', 'src/content/ui/douban-list-buttons.js']
    });
    const btns = new w.DoubanListButtons({ onExtract: async () => true });
    btns.start();
    eq('用户主页（不是三态列表）一颗都不挂',
      w.document.querySelectorAll('.clipmate-douban-item-btn').length, 0);
    btns.stop();
  }

  // —— 点击行为：闸门 + 状态机
  {
    const w = load('douban-list-wish-grid.html', URL_GRID);
    let calls = 0;
    let resolvers = [];
    const btns = new w.DoubanListButtons({
      onExtract: () => new Promise((resolve) => { calls++; resolvers.push(resolve); })
    });
    btns.start();

    const btn = w.document.querySelector('.clipmate-douban-item-btn');
    btn.click();
    ok('点一下：进入 busy', btn.getAttribute('data-state') === 'busy', btn.getAttribute('data-state'));

    const btn2 = w.document.querySelectorAll('.clipmate-douban-item-btn')[1];
    btn2.click();
    eq('还有请求在飞时，第二次点击被忽略', calls, 1);
    eq('第二次点击的按钮保持待命', btn2.getAttribute('data-state'), 'idle');

    resolvers[0](true);
    await new Promise((r) => setTimeout(r, 0));
    eq('成功后变成 ok', btn.getAttribute('data-state'), 'ok');

    // 失败态 + 原因写进 title（悬停可见）
    btns.setFailReason('豆瓣要验证了（验证码）');
    const btn3 = w.document.querySelectorAll('.clipmate-douban-item-btn')[2];
    btn3.click();
    await new Promise((r) => setTimeout(r, 0));
    resolvers[1](false);
    await new Promise((r) => setTimeout(r, 0));
    eq('失败后变成 fail', btn3.getAttribute('data-state'), 'fail');
    ok('失败原因写在按钮上（悬停可见）',
      /验证/.test(btn3.getAttribute('title') || ''), btn3.getAttribute('title'));

    btns.stop();
  }
}

/* ============================================================
 * 五、提取器「换一份文档来读」：这是整条链路的地基
 * ==========================================================*/
section('五、提取器换源（douban-movie setSource）');
{
  const EXTRACT_SCRIPTS = BASE_SCRIPTS.concat([
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/douban-movie.js'
  ]);

  const details = F('douban-movie-10441174.html');

  // ① 默认行为：读当前页（改造前的老路，必须一个字都不变）
  const w1 = makePage({
    url: 'https://movie.douban.com/subject/10441174/',
    html: details,
    scripts: EXTRACT_SCRIPTS
  });
  const e1 = new w1.DoubanMovieExtractor();
  const direct = await e1.extractAllFields();
  ok('当前页提取：拿到片名', /基和皮尔/.test(String(direct['片名'])), direct['片名']);
  eq('当前页提取：豆瓣链接就是当前地址',
    direct['豆瓣链接'], 'https://movie.douban.com/subject/10441174/');

  // ② 换源：页面是列表页，提取源指向「另一份文档」
  const w2 = makePage({
    url: 'https://movie.douban.com/people/48250148/wish',
    html: F('douban-list-wish-grid.html'),
    scripts: EXTRACT_SCRIPTS
  });
  const altDoc = new w2.DOMParser().parseFromString(details, 'text/html');
  const e2 = new w2.DoubanMovieExtractor();
  e2.setSource(altDoc, 'https://movie.douban.com/subject/10441174/');
  const fromAlt = await e2.extractAllFields();

  eq('换源提取：片名来自详情页', fromAlt['片名'], direct['片名']);
  eq('换源提取：评分来自详情页', fromAlt['网络评分'], direct['网络评分']);
  eq('换源提取：简介来自详情页', fromAlt['简介'], direct['简介']);
  eq('换源提取：主演来自详情页', fromAlt['主演'], direct['主演']);
  eq('换源提取：豆瓣链接用传进来的地址（不是列表页地址）',
    fromAlt['豆瓣链接'], 'https://movie.douban.com/subject/10441174/');
  ok('换源提取：豆瓣链接里没有 /people/（没读到当前页）',
    String(fromAlt['豆瓣链接']).indexOf('/people/') === -1, fromAlt['豆瓣链接']);

  // 全字段逐一比对：两份结果必须完全一致（除豆瓣链接按地址算，两边同值）
  const keysA = Object.keys(direct).sort();
  const keysB = Object.keys(fromAlt).sort();
  eq('换源提取：字段集合与直接提取完全一致', keysB, keysA);
  const diff = keysA.filter((k) => JSON.stringify(direct[k]) !== JSON.stringify(fromAlt[k]));
  eq('换源提取：每个字段的值都与直接提取一致', diff, []);

  // ③ 还原：之后必须重新读当前页（工厂会复用实例，不还原就是「读错文档」）
  e2.setSource(null);
  const back = await e2.extractAllFields();
  ok('setSource(null) 后回到当前页（列表页读不到片名）',
    !/基和皮尔/.test(String(back['片名'] || '')), back['片名']);

  // ④ 默认成员：新实例的 doc 就是当前页 document，pageUrl 就是当前地址
  const e3 = new w2.DoubanMovieExtractor();
  ok('新实例默认 doc = 当前页 document', e3.doc === w2.document);
  eq('新实例默认 pageUrl = 当前地址', e3.pageUrl, 'https://movie.douban.com/people/48250148/wish');
}

/* ============================================================
 * 六、端到端：点小按钮 → 抓 → 换源提取 → 出数据
 *     这条能抓住「零件都对、但没接线」的情况
 * ==========================================================*/
section('六、端到端（点按钮 → 抓详情页 → 出字段）');
{
  const details = F('douban-movie-10441174.html');
  const w = makePage({
    url: 'https://movie.douban.com/people/48250148/wish',
    html: F('douban-list-wish-grid.html'),
    scripts: BASE_SCRIPTS.concat([
      'src/content/extractors/base-extractor.js',
      'src/content/extractors/douban-movie.js',
      'src/content/ui/douban-list-fetch.js',
      'src/content/ui/douban-list-buttons.js',
      'src/content/ui/douban-list-handler.js'
    ])
  });

  // 桩：抓详情页（不打真豆瓣）
  let fetchCount = 0;
  w.fetch = () => {
    fetchCount++;
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(details)
    });
  };

  // 假 host：把 mixin 需要的两个东西造出来
  const host = {
    activeShortcode: '',
    doubanListButtons: null,
    // handleExtract 的替身：只保留「换源 → 提取」这段真实逻辑
    handleExtract: async (opts) => {
      if (!opts || !opts.doc) throw new Error('handleExtract 没收到 doc');
      host.lastOpts = opts;
      // 记录此刻的 activeShortcode —— handleExtract 用它算缓存键。
      // 列表页几十条的地址完全一样，不按条目编号区分就会「点谁都弹第一条」。
      host.lastShortcode = host.activeShortcode;
      const ext = new w.DoubanMovieExtractor();
      ext.setSource(opts.doc, opts.pageUrl);
      try {
        host.lastData = await ext.extractAllFields();
      } finally {
        ext.setSource(null);
      }
      return true;
    }
  };
  Object.assign(host, w.DoubanListMixin);

  host._initDoubanListButtons();
  ok('端到端：按钮挂上了', !!host.doubanListButtons);
  const btns = w.document.querySelectorAll('.clipmate-douban-item-btn');
  ok('端到端：挂出 15 颗', btns.length === 15, btns.length);

  const first = btns[0];
  const firstId = first.getAttribute('data-cm-subject');
  first.click();
  await new Promise((r) => setTimeout(r, 30));

  ok('端到端：真的去抓了一次', fetchCount === 1, fetchCount);
  ok('端到端：拿到字段了', !!(host.lastData && host.lastData['片名']), host.lastData && host.lastData['片名']);
  eq('端到端：抓的就是点的那一条', host.lastOpts.pageUrl,
    'https://movie.douban.com/subject/' + firstId + '/');
  ok('端到端：提取源是详情页，不是列表页',
    String(host.lastData['豆瓣链接']).indexOf('/people/') === -1, host.lastData['豆瓣链接']);
  eq('端到端：按钮变绿', first.getAttribute('data-state'), 'ok');
  eq('端到端：缓存键带站点 + 条目号（列表页几十条地址相同，不区分就会互相串）',
    host.lastShortcode, 'movie.douban.com/p/' + firstId);
  // 存档是《基和皮尔 第一季》= 剧集：不判这一条的话，电视剧会走电影分支（集数 / 单集片长错位）
  eq('端到端：剧集会标成 tv', host.lastOpts.forceMediaType, 'tv');

  // 缓存：同一条再点一次不该再抓
  first.click();
  await new Promise((r) => setTimeout(r, 30));
  eq('端到端：同一条点第二次不再请求豆瓣', fetchCount, 1);
  eq('端到端：第二次仍然变绿', first.getAttribute('data-state'), 'ok');

  // 换一条：必须重新抓，而且抓到的是那一条
  const second = btns[1];
  const secondId = second.getAttribute('data-cm-subject');
  second.click();
  await new Promise((r) => setTimeout(r, 30));
  eq('端到端：换一条会重新请求', fetchCount, 2);
  eq('端到端：抓到的是新的那一条', host.lastOpts.pageUrl,
    'https://movie.douban.com/subject/' + secondId + '/');

  // 失败路径：抓不到时按钮变红，不弹空浮窗
  w.fetch = () => Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve('x') });
  const third = btns[2];
  third.click();
  await new Promise((r) => setTimeout(r, 30));
  eq('端到端：403 时按钮变红', third.getAttribute('data-state'), 'fail');

  // 熔断已置位：再点别的条目，一个请求都不该发
  const before = fetchCount;
  const fourth = btns[3];
  fourth.click();
  await new Promise((r) => setTimeout(r, 30));
  eq('端到端：熔断后不再发请求', fetchCount, before);
  eq('端到端：熔断后也是红脸', fourth.getAttribute('data-state'), 'fail');

  host.doubanListButtons.stop();
}

/* ============================================================
 * 七、接线检查：源码层面确认「该挂的都挂上了」
 * ==========================================================*/
section('七、接线（源码断言）· v2.11.7 重点');
{
  const CM = fs.readFileSync(P('src/content/content-main.js'), 'utf8');
  const MF = fs.readFileSync(P('manifest.json'), 'utf8');
  const FF = fs.readFileSync(P('src/shared/feature-flags.js'), 'utf8');

  /** 从源码里抠出一个方法（按大括号配对），返回方法体文本 */
  function extractMethod(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) return null;
    let depth = 0;
    for (let j = src.indexOf('{', start); j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    return null;
  }

  ok('mixin 已 Object.assign 进 MediaExtractor 原型',
    /if \(typeof DoubanListMixin !== 'undefined'\) \{\s*Object\.assign\(MediaExtractor\.prototype, DoubanListMixin\);/.test(CM));

  // ---------------------------------------------------------------- 分支前提（血案）
  // v2.11.4 把「挂按钮」放进 `if (!mediaType)`，前提是收藏页会被判成没有媒体类型。
  // 这里用**真实存档 + 真实 URL** 跑一遍上游判定，把这个前提的反面证据钉死。
  {
    const dom = new JSDOM(F('douban-list-wish-grid.html'), {
      url: 'https://movie.douban.com/people/48250148/wish',
      runScripts: 'outside-only'
    });
    const w = dom.window;
    w.eval('window.WBR={runtime:{sendMessage:function(){return Promise.resolve({configs:{}});}}};');
    w.eval(fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8'));
    const D = w.MediaTypeDetector;
    const d = new D();
    d.siteConfigs = d.getDefaultConfigs();   // loadConfigs 是 async，这里给确定的配置
    const detected = d.detect('https://movie.douban.com/people/48250148/wish', w.document);
    ok('真实收藏页经 media-detector 判定返回的是真值（不是 null / 空串）',
      !!detected, detected);
    ok('因此 if (!mediaType) 恒假 —— 挂按钮绝不能放进那个分支',
      !!detected);
  }

  // ---------------------------------------------------------------- 初始化顺序
  const initBody = extractMethod(CM, '  async init() {');
  ok('能从 content-main 抠出 init() 方法体', !!initBody);
  if (initBody) {
    const call = initBody.indexOf('_initDoubanListButtons(');
    // 必须带缩进和花括号：新分支的注释里也写了 `if (!mediaType)` 这几个字，
    // 直接 indexOf 会命中注释，断言就变成假绿（v2.5.20 起反复踩过的坑）。
    const branch = initBody.indexOf('      if (!mediaType) {');
    const detect = initBody.indexOf('this.detectMediaType()');
    ok('init() 里确实调用了 _initDoubanListButtons', call > -1);
    ok('挂按钮在 detectMediaType() 之前（不依赖媒体类型）',
      call > -1 && detect > -1 && call < detect, { call, detect });
    ok('挂按钮不在 if (!mediaType) 分支里（v2.11.4 的血案）',
      call > -1 && branch > -1 && call < branch, { call, branch });
    ok('用 doubanListKind 白名单认页面，不猜类型',
      /PageShape\.doubanListKind\(location\.hostname, location\.pathname\)/.test(initBody));
    ok('白名单分支里先记 feed 形态再应用滚动关窗',
      /this\._pageShape = 'feed'/.test(initBody) &&
      /this\._applyAutoDismiss\(null\)/.test(initBody));
    ok('白名单分支提前 return，不跑详情页那套自动提取',
      /this\.isInitialized = true;\s*return;/.test(initBody));
    ok('白名单分支把大按钮藏掉（只藏不摘）',
      /this\.buttonManager\.setVisible\(false\)/.test(initBody));
  }

  // ---------------------------------------------------------------- 落点设置（v2.11.7）
  {
    const SCHEMA = fs.readFileSync(P('src/shared/settings-schema.js'), 'utf8');
    const HANDLER = fs.readFileSync(P('src/content/ui/douban-list-handler.js'), 'utf8');
    const BTNS = fs.readFileSync(P('src/content/ui/douban-list-buttons.js'), 'utf8');

    ok('设置页有这个开关（settings-schema 里登记了 doubanListBtnLayout）',
      /key: 'doubanListBtnLayout'/.test(SCHEMA));
    ok('默认值是 A', /key: 'doubanListBtnLayout'[\s\S]{0,400}?default: 'A'/.test(SCHEMA));
    ok('三个选项都在（A / B / C）',
      /key: 'doubanListBtnLayout'[\s\S]{0,600}?value: 'A'[\s\S]{0,200}?value: 'B'[\s\S]{0,200}?value: 'C'/.test(SCHEMA));
    ok('落点是全局项（不跟站点覆盖走，避免三个站各设一套）',
      /key: 'doubanListBtnLayout'[\s\S]{0,700}?path: \['settings', 'doubanListBtnLayout'\]/.test(SCHEMA) &&
      !/key: 'doubanListBtnLayout'[\s\S]{0,700}?siteOverridable: true/.test(SCHEMA));

    ok('content-main 读了这一项', /config\.settings\.doubanListBtnLayout/.test(CM));
    ok('content-main 把读到的落点交给已挂好的按钮（改完立刻生效）',
      /this\.doubanListButtons\.setLayout\(this\.doubanListBtnLayout\)/.test(CM));
    ok('列表页分支自己读一次配置（否则设置永远不生效）',
      !!initBody && /await this\.refreshConfig\(\)/.test(initBody) &&
      initBody.indexOf('await this.refreshConfig()') < initBody.indexOf('_initDoubanListButtons('));
    ok('初始化按钮时把落点传下去', /layout: this\.doubanListBtnLayout/.test(HANDLER));
    ok('按钮组件支持 setLayout 且做了归一化',
      /setLayout\(mode\)/.test(BTNS) && /function normalizeLayout\(mode\)/.test(BTNS));
  }

  // ---------------------------------------------------------------- 详情页不开滚动关窗
  {
    const w = makePage({
      url: 'https://movie.douban.com/subject/1292052/',
      scripts: ['src/content/utils/page-shape.js', 'src/shared/site-config.js']
    });
    const shape = w.PageShape.shapeOf({
      hostname: 'movie.douban.com', pathname: '/subject/1292052/', mediaType: 'movie'
    });
    const eff = w.ClipMateSites.resolve({}, 'movie.douban.com');
    eq('豆瓣详情页形态不是 feed', shape, 'unknown');
    eq('豆瓣详情页站点默认不开自动收起（用户拍板：详情页不要开）', eff.autoDismiss, false);
    // 二·B 已真跑过：非 feed + 非显式 → _applyAutoDismiss 不开
    ok('两者组合 → 详情页不会滚动关窗', shape !== 'feed' && eff.autoDismiss !== true);
  }

  ok('extractFromCurrentPage 支持换源并把 doc 传给提取器',
    /const altDoc = \(extraOpts && extraOpts\.doc\) \|\| null;/.test(CM) &&
    /const altSourceOn = !!\(altDoc && typeof extractor\.setSource === 'function'\);/.test(CM) &&
    // 必须是「受 altSourceOn 控制的真调用」，不是 `if (false) setSource(...)` 这种死代码
    /if \(altSourceOn\) extractor\.setSource\(altDoc, altUrl\);/.test(CM));

  ok('换源用完必须还原（否则工厂复用的实例会一直读错文档）',
    /if \(altSourceOn\) extractor\.setSource\(null\);/.test(CM));

  const manifest = JSON.parse(MF);
  const matches = manifest.content_scripts[0].matches;
  eq('manifest matches 数（v2.11.4 的 44 + 读书/游戏两条）', matches.length, 46);
  ok('读书 people 路径已注入',
    matches.indexOf('https://book.douban.com/people/*') > -1);
  ok('游戏 games 路径已注入',
    matches.indexOf('https://www.douban.com/people/*/games*') > -1);
  ok('影视 people 路径仍在',
    matches.indexOf('https://movie.douban.com/people/*') > -1);

  ok('feature flag 覆盖三站',
    /sites: \['movie\.douban\.com', 'book\.douban\.com', 'www\.douban\.com'\]/.test(FF));

  ok('manifest 带上了三个新脚本',
    /douban-list-fetch\.js/.test(MF) && /douban-list-buttons\.js/.test(MF) &&
    /douban-list-handler\.js/.test(MF));

  // 三个脚本必须在 content-main 之前（顺序错了真实环境里 DoubanListMixin 是 undefined）
  ok('handler 脚本排在 content-main 之前',
    MF.indexOf('douban-list-handler.js') < MF.indexOf('content-main.js') &&
    MF.indexOf('douban-list-fetch.js') < MF.indexOf('content-main.js'));
}

/* ============================================================
 * 八、三站 × 四种 DOM 结构：逐条按钮真的挂上去了吗（真实存档）
 * ==========================================================*/
section('八、三站四结构（真实存档 · 逐条按钮）');
{
  const CASES = [
    ['影视·网格', 'douban-list-wish-grid.html',
      'https://movie.douban.com/people/48250148/wish', '.item', 'movie', '/subject/'],
    ['影视·列表', 'douban-list-wish-list.html',
      'https://movie.douban.com/people/48250148/wish?mode=list', '.item', 'movie', '/subject/'],
    ['读书·网格', 'douban-book-wish-grid.html',
      'https://book.douban.com/people/48250148/wish', 'li.subject-item', 'book', '/subject/'],
    ['读书·列表', 'douban-book-wish-list.html',
      'https://book.douban.com/people/48250148/wish?mode=list', 'li.item', 'book', '/subject/'],
    ['游戏', 'douban-game-wish.html',
      'https://www.douban.com/people/48250148/games?action=wish', 'div.common-item', 'game', '/game/']
  ];

  for (const [label, file, url, itemSel, kind, urlPart] of CASES) {
    const w = makePage({
      url, html: F(file),
      scripts: ['src/content/ui/douban-list-fetch.js', 'src/content/ui/douban-list-buttons.js']
    });
    const items = w.document.querySelectorAll(itemSel);
    let seen = null;
    const btns = new w.DoubanListButtons({
      onExtract: (t) => { seen = t; return Promise.resolve(true); }
    });
    btns.start();

    const all = w.document.querySelectorAll('.clipmate-douban-item-btn');
    ok(label + '：每条都挂上按钮', items.length > 0 && all.length === items.length,
      { items: items.length, buttons: all.length });
    const ids = Array.prototype.map.call(all, (b) => b.getAttribute('data-cm-subject'));
    ok(label + '：编号不重复（不会点谁都弹第一条）', new Set(ids).size === ids.length);
    ok(label + '：编号都是纯数字', ids.every((x) => /^\d+$/.test(String(x))), ids.slice(0, 3));
    ok(label + '：详情地址指向对应站', all[0] && String(all[0].__cmUrl).indexOf(urlPart) > -1,
      all[0] && all[0].__cmUrl);

    if (all[0]) {
      all[0].click();
      await new Promise((r) => setTimeout(r, 0));
      eq(label + '：点击时告诉接线层这是哪一类', seen && seen.kind, kind);
    }
    btns.stop();
    eq(label + '：stop() 后按钮全清', w.document.querySelectorAll('.clipmate-douban-item-btn').length, 0);
  }
}

/* ============================================================
 * 九、读书 / 游戏提取器也能「换一份文档来读」
 *     只改了 movie 而漏了这两个，换源提取会读到列表页 → 整表全空
 * ==========================================================*/
section('九、读书 / 游戏提取器换源');
{
  const SPECS = [
    {
      label: '读书', cls: 'DoubanBookExtractor', file: 'douban-book.js',
      detail: 'douban-book-1084336.html', list: 'douban-book-wish-grid.html',
      detailUrl: 'https://book.douban.com/subject/1084336/',
      listUrl: 'https://book.douban.com/people/48250148/wish'
    },
    {
      label: '游戏', cls: 'DoubanGameExtractor', file: 'douban-game.js',
      detail: 'douban-game-26243433.html', list: 'douban-game-wish.html',
      detailUrl: 'https://www.douban.com/game/26243433/',
      listUrl: 'https://www.douban.com/people/48250148/games?action=wish'
    }
  ];

  for (const sp of SPECS) {
    const scripts = BASE_SCRIPTS.concat([
      'src/content/extractors/base-extractor.js',
      'src/content/extractors/' + sp.file
    ]);
    const detailHtml = F(sp.detail);

    const w1 = makePage({ url: sp.detailUrl, html: detailHtml, scripts });
    const e1 = new w1[sp.cls]();
    const direct = await e1.extractAllFields();
    ok(sp.label + '：当前页提取拿到非空字段',
      Object.keys(direct).filter((k) => direct[k] !== '' && direct[k] != null).length >= 5,
      Object.keys(direct).length);

    const w2 = makePage({ url: sp.listUrl, html: F(sp.list), scripts });
    const altDoc = new w2.DOMParser().parseFromString(detailHtml, 'text/html');
    const e2 = new w2[sp.cls]();
    ok(sp.label + '：有 setSource', typeof e2.setSource === 'function');
    ok(sp.label + '：新实例默认 doc = 当前页', e2.doc === w2.document);
    eq(sp.label + '：新实例默认 pageUrl = 当前地址', e2.pageUrl, sp.listUrl);

    e2.setSource(altDoc, sp.detailUrl);
    const fromAlt = await e2.extractAllFields();
    eq(sp.label + '：换源字段集合与直接提取一致',
      Object.keys(fromAlt).sort(), Object.keys(direct).sort());
    const diff = Object.keys(direct).filter(
      (k) => JSON.stringify(direct[k]) !== JSON.stringify(fromAlt[k]));
    eq(sp.label + '：换源每个字段值都一致（没读到列表页）', diff, []);
    ok(sp.label + '：换源后地址字段是详情页',
      String(fromAlt['豆瓣链接'] || '').indexOf('/people/') === -1,
      fromAlt['豆瓣链接']);

    e2.setSource(null);
    ok(sp.label + '：setSource(null) 回到当前页', e2.doc === w2.document);
  }
}

/* ============================================================
 * 十、三站各自该用哪个提取器
 * ==========================================================*/
section('十、按站点选提取器（forcedTypeOf）');
{
  const w = makePage({
    url: 'https://movie.douban.com/people/x/wish',
    scripts: ['src/content/ui/douban-list-handler.js']
  });
  const M = w.DoubanListMixin;
  ok('mixin 已导出', !!M);
  if (M) {
    eq('读书 → book', M._doubanForcedType('book', null), 'book');
    eq('游戏 → game', M._doubanForcedType('game', null), 'game');
    eq('影视（电影）→ movie', M._doubanForcedType('movie', null), 'movie');
    const tvDoc = new w.DOMParser().parseFromString(
      '<html><body><div id="info">集数: 10 单集片长: 22分钟</div></body></html>', 'text/html');
    eq('影视（剧集）→ tv', M._doubanForcedType('movie', tvDoc), 'tv');
    eq('读书不受 #info 影响', M._doubanForcedType('book', tvDoc), 'book');
  }
}

/* ============================================================
 * 十一、列表页独立通道的字段映射器（v2.11.6 真机验收补的）
 *
 * 血案：v2.11.5 在 init() 里提前 return，跳过了
 *   `this.fieldMapper = await this.initFieldMapper(mediaType)`。
 * 结果按钮挂得上、点击也进 busy，但 extractFromCurrentPage() 一调
 * `this.fieldMapper.mapToUniversalFields(...)` 就抛
 * "Cannot read properties of null"，浮窗一个都不出。
 * 上一版的 209 项测试全绿却没抓到，因为没有任何一条**真的跑这条链路**。
 *
 * 这里造一个最小 host，把 `_onDoubanListItemExtract` 从头到尾跑一遍。
 * 不只验「不为空」，还要验「类型跟随条目」—— 否则点读书条目会弹电影表。
 * ==========================================================*/
section('十一、点击 → 建 mapper → 提取（端到端）');
{
  const w = makePage({
    url: 'https://book.douban.com/people/x/wish',
    scripts: ['src/content/ui/douban-list-handler.js']
  });
  const M = w.DoubanListMixin;
  const doc = new w.DOMParser().parseFromString(
    '<html><body><h1>测试书</h1><div id="info">出版社: 测试</div></body></html>', 'text/html');

  let builds = 0, captured = null;
  const host = Object.assign({
    fieldMapper: null,
    doubanListButtons: { setFailReason: function () {} },
    activeShortcode: null,
    initFieldMapper: async function (t) {
      builds++;
      return { mediaType: t, mapToUniversalFields: function (d) { return d; } };
    },
    handleExtract: async function (opts) { captured = opts; return true; }
  }, M);

  w.DoubanListFetch = {
    isBlocked: function () { return false; },
    blockedReason: function () { return ''; },
    load: async function () {
      return { ok: true, doc: doc, url: 'https://book.douban.com/subject/123/', id: '123', key: 'book.douban.com/p/123' };
    }
  };

  const click = (kind) => host._onDoubanListItemExtract({
    subjectUrl: 'https://book.douban.com/subject/123/',
    subjectId: '123', kind: kind, anchor: null
  });

  eq('读书条目返回成功', await click('book'), true);
  ok('fieldMapper 不再是 null（漏了就是真机上那条报错）', !!host.fieldMapper,
    host.fieldMapper);
  eq('mapper 按本条类型建 = book', host.fieldMapper && host.fieldMapper.mediaType, 'book');
  eq('handleExtract 收到 forceMediaType = book', captured && captured.forceMediaType, 'book');
  ok('doc / pageUrl / anchorEl 都透传了',
    !!(captured && captured.doc === doc && captured.pageUrl && 'anchorEl' in captured), captured);
  eq('activeShortcode 用完还原', host.activeShortcode, null);
  eq('第一次建了 1 次', builds, 1);

  eq('同一类型再点一次仍成功', await click('book'), true);
  eq('类型没变不重复建', builds, 1);

  eq('切到游戏条目', await click('game'), true);
  eq('mapper 重建为 game', host.fieldMapper && host.fieldMapper.mediaType, 'game');
  eq('handleExtract 收到 forceMediaType = game', captured && captured.forceMediaType, 'game');
  eq('类型变了才多建 1 次', builds, 2);

  // 熔断时连 mapper 都不该建（别在风控之后还继续发请求 / 改状态）
  w.DoubanListFetch.isBlocked = function () { return true; };
  w.DoubanListFetch.blockedReason = function () { return '豆瓣要验证了'; };
  const buildsBefore = builds;
  eq('熔断时返回失败', await click('book'), false);
  eq('熔断时不建 mapper', builds, buildsBefore);
}

/* ============================================================
 * 十二、小按钮落点 A / B / C（v2.11.7：默认 A + 设置里可切换）
 * ==========================================================*/
section('十二、小按钮落点 A / B / C（v2.11.7）');
{
  const URL_GRID = 'https://movie.douban.com/people/48250148/wish';
  const URL_LIST = 'https://movie.douban.com/people/48250148/wish?mode=list';

  const mk = (url, file) => makePage({
    url,
    html: F(file),
    scripts: ['src/content/ui/douban-list-fetch.js', 'src/content/ui/douban-list-buttons.js']
  });
  const rect = (left, top, width, height) => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top
  });
  const stub = (el, r) => { el.getBoundingClientRect = () => r; };

  // —— 影视网格：条目 675×164、封面框 80×158、封面图 80×114（2026-11-04 真机量的）
  const w = mk(URL_GRID, 'douban-list-wish-grid.html');
  const item = w.document.querySelector('.item');
  stub(item, rect(100, 200, 675, 164));
  stub(item.querySelector('.pic'), rect(100, 200, 80, 158));
  stub(item.querySelector('.pic img'), rect(100, 200, 80, 114));

  const B1 = new w.DoubanListButtons({ onExtract: async () => true, layout: 'A' });
  B1.start();
  const btn = item.querySelector('.clipmate-douban-item-btn');
  ok('按钮挂上了', !!btn);

  // 纵向基准线 = 封面图下缘 114（不是封面框底 158：框会被行高拉伸）
  eq('默认 A：贴封面图右下角（右缘内缩 4、下缘内缩 4）',
    [btn.style.left, btn.style.top], ['52px', '86px']);

  eq('切到 B', B1.setLayout('B'), 'B');
  eq('B：封面图正下方 +4、水平居中对齐封面',
    [btn.style.left, btn.style.top], ['28px', '118px']);
  ok('换模式不重建按钮（还是同一个节点）',
    item.querySelector('.clipmate-douban-item-btn') === btn);
  ok('换模式后条目归属没变', btn.getAttribute('data-cm-subject') === '10441174',
    btn.getAttribute('data-cm-subject'));

  eq('切到 C', B1.setLayout('C'), 'C');
  eq('C：条目最右侧内缩 10，纵向与 A 同一条基准线',
    [btn.style.left, btn.style.top], ['641px', '86px']);

  eq('小写也认（c → C）', B1.setLayout('c'), 'C');
  eq('脏值一律回 A（绝不把按钮弄没）', B1.setLayout('M'), 'A');
  eq('回到 A 的坐标', [btn.style.left, btn.style.top], ['52px', '86px']);

  // 构造器上的初始模式（设置页刚打开就是这个值）
  const w2 = mk(URL_GRID, 'douban-list-wish-grid.html');
  const it2 = w2.document.querySelector('.item');
  stub(it2, rect(0, 0, 675, 164));
  stub(it2.querySelector('.pic'), rect(0, 0, 80, 158));
  stub(it2.querySelector('.pic img'), rect(0, 0, 80, 114));
  const B2 = new w2.DoubanListButtons({ onExtract: async () => true, layout: 'b' });
  B2.start();
  eq('构造器传小写 b 也归一化成 B', B2.layout, 'B');
  const btn2 = it2.querySelector('.clipmate-douban-item-btn');
  eq('构造器传 B 时第一屏就是 B 的位置',
    [btn2.style.left, btn2.style.top], ['28px', '118px']);

  // —— 行高被标题行数撑开时，纵向仍必须一致（这就是「整齐」的硬指标）
  {
    const wu = mk(URL_GRID, 'douban-list-wish-grid.html');
    const its = wu.document.querySelectorAll('.item');
    // 第 1 行 164 高、第 2 行 208 高（标题多两行），封面框也跟着被拉伸 158 / 202，
    // 但两张海报图一样高 114 —— 按钮必须落在同一个 y 上。
    stub(its[0], rect(0, 0, 675, 164));
    stub(its[0].querySelector('.pic'), rect(0, 0, 80, 158));
    stub(its[0].querySelector('.pic img'), rect(0, 0, 80, 114));
    stub(its[1], rect(0, 200, 675, 208));
    stub(its[1].querySelector('.pic'), rect(0, 200, 80, 202));
    stub(its[1].querySelector('.pic img'), rect(0, 200, 80, 114));
    const UB = new wu.DoubanListButtons({ onExtract: async () => true, layout: 'A' });
    UB.start();
    const b0 = its[0].querySelector('.clipmate-douban-item-btn');
    const b1 = its[1].querySelector('.clipmate-douban-item-btn');
    eq('行高 164 与 208 的两行，按钮同一 y（不跟行高漂）', [b0.style.top, b1.style.top],
      ['86px', '86px']);
    eq('两行按钮同一 x', [b0.style.left, b1.style.left], ['52px', '52px']);
    UB.stop();
  }

  // —— 游戏页（真机 2026-11-05 量的：条目 675×159、封面框 102×138、下方只剩 21px）
  {
    const wg = makePage({
      url: 'https://www.douban.com/people/48250148/games?action=wish',
      html: F('douban-game-wish.html'),
      scripts: ['src/content/ui/douban-list-fetch.js', 'src/content/ui/douban-list-buttons.js']
    });
    const gis = wg.document.querySelectorAll('div.common-item');
    // 第 1 行 159 高、第 2 行 180 高（简介长的行更高），封面框都是 138
    stub(gis[0], rect(0, 0, 675, 159));
    stub(gis[0].querySelector('.pic'), rect(0, 0, 102, 138));
    stub(gis[1], rect(0, 200, 675, 180));
    stub(gis[1].querySelector('.pic'), rect(0, 200, 102, 138));
    const GB = new wg.DoubanListButtons({ onExtract: async () => true, layout: 'B' });
    GB.start();
    const gb = gis[0].querySelector('.clipmate-douban-item-btn');
    const gb2 = gis[1].querySelector('.clipmate-douban-item-btn');
    eq('游戏页 B：水平居中对齐封面（102 宽 → 左 39）', gb.style.left, '39px');
    eq('游戏页 B：下方只留 21px → 贴条目内下缘 135（不被裁掉）', gb.style.top, '135px');
    eq('游戏页 B：行高不同也落在同一个 y（按最矮那行算一次）',
      [gb.style.top, gb2.style.top], ['135px', '135px']);
    eq('游戏页 B 的按钮不会探出条目', Number(String(gb.style.top).replace('px', '')) + 24 <= 159, true);
    GB.stop();
  }

  // —— 列表视图（没有封面）：A/B/C 都退回「日期左侧 8px、垂直居中」
  const w3 = mk(URL_LIST, 'douban-list-wish-list.html');
  const items3 = w3.document.querySelectorAll('.item');
  items3.forEach((it, i) => {
    stub(it, rect(100, 200 + i * 28, 675, 28));
    stub(it.querySelector('.date'), rect(718, 206 + i * 28, 66, 16));
  });
  const B3 = new w3.DoubanListButtons({ onExtract: async () => true, layout: 'A' });
  B3.start();

  const xs = new Set();
  w3.document.querySelectorAll('.clipmate-douban-item-btn').forEach((b) => xs.add(b.style.left));
  eq('列表视图：所有行同一个 x（这就是「整齐」）', xs.size, 1);
  eq('列表视图：x = 日期左缘（条目内 618）− 按钮 24 − 间距 8', [...xs][0], '586px');

  const firstBtn = items3[0].querySelector('.clipmate-douban-item-btn');
  eq('列表视图：垂直居中于日期（不压日期、不出屏）', firstBtn.style.top, '2px');

  B3.setLayout('C');
  const xs2 = new Set();
  w3.document.querySelectorAll('.clipmate-douban-item-btn').forEach((b) => xs2.add(b.style.left));
  eq('列表视图就算选 C 也还是同一列（否则会压住日期）', [...xs2], ['586px']);

  B3.stop();
  eq('stop 后条目 position 还原为空（不给豆瓣留改动）', items3[0].style.position, '');
  eq('stop 后按钮全摘', w3.document.querySelectorAll('.clipmate-douban-item-btn').length, 0);

  // —— 条目本身已经是定位祖先 → 一个字节都不改
  const w4 = mk(URL_GRID, 'douban-list-wish-grid.html');
  const it4 = w4.document.querySelector('.item');
  it4.style.position = 'absolute';
  stub(it4, rect(0, 0, 675, 164));
  stub(it4.querySelector('.pic'), rect(0, 0, 80, 158));
  stub(it4.querySelector('.pic img'), rect(0, 0, 80, 114));
  const B4 = new w4.DoubanListButtons({ onExtract: async () => true });
  B4.start();
  eq('条目原本就定位好了 → 不去改它', it4.style.position, 'absolute');
  B4.stop();
  eq('stop 时也不会把它清空', it4.style.position, 'absolute');

  // —— 量不到尺寸（隐藏条目 / 还没排版）→ 按钮照样挂着，只是先不定位
  const w5 = mk(URL_LIST, 'douban-list-wish-list.html');
  const it5 = w5.document.querySelector('.item');
  stub(it5, rect(0, 0, 0, 0));
  const B5 = new w5.DoubanListButtons({ onExtract: async () => true, layout: 'A' });
  B5.start();
  eq('量不到条目尺寸也不崩，按钮照样挂着',
    w5.document.querySelectorAll('.clipmate-douban-item-btn').length, 30);
  const btn5 = it5.querySelector('.clipmate-douban-item-btn');
  eq('量不到尺寸时先不写坐标（等 resize / 图片 load 再排）', btn5.style.left, '');
  B5.stop();
}

/* ============================================================
 * 汇总
 * ==========================================================*/
console.log('\n' + '─'.repeat(56));
if (fails.length === 0) {
  console.log(`✅ 全部通过：${pass} 项`);
  process.exit(0);
} else {
  console.log(`❌ 失败 ${fails.length} 项 / 共 ${pass + fails.length} 项`);
  fails.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
})();
