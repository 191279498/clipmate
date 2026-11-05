/**
 * X（推特）「页面上每条推文一颗小按钮」验收（v2.7.43）
 *
 * 需求（用户 2026-11-01 拍板，与微博同一套口径）
 * --------------------------
 *   「为推特 X 的每一条推文增加小按钮，跟微博类似。」
 *   三条拍板：① 长推文接受列表页截断（A 案，不主动展开）；
 *   ② 详情页主贴不挂按钮（回复挂）；③ 引用帖只取博主自己写的那段，
 *   他一个字没写 → 文案空 → 标题写「X推文」。
 *
 * 这份测试盯死的是**真机上会出事故的地方**（全部来自 2026-11-01 实机勘察）：
 *   1. X 把表情符号渲染成 `<img alt="🔥">`，textContent 读不到 → 必须按 alt 拼回，
 *      否则「美得太过分了 🥰」洗成「美得太过分了」（X 独有的坑）；
 *   2. 编号链接的变体（/analytics、/quotes）必须挡掉 —— 拿它们当编号会拼出
 *      用户点不开的地址；
 *   3. 引用帖被引用那条的正文也在 tweetText 里，靠 role=link 判归属；
 *   4. 详情页主贴的 User-Name 里**没有**编号链接（时间在正文下方），
 *      只能退回整条找第一个纯 status 链接；而它的 `<time>` 又**可能**是被引用那条的
 *      → 时间必须从「编号链接内部」取；
 *   5. 「⋯」顶部有三档（12/18/28）→ 按钮必须逐卡按自己的 caret 定位（微博栽过）；
 *   6. 空文案推文的标题兜底必须够得着装配器那层包装（IG v2.7.37 错过一次）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const P = {
  context: path.join(CHROME, 'src/content/shared/x-feed-context.js'),
  buttons: path.join(CHROME, 'src/content/ui/x-feed-buttons.js'),
  handler: path.join(CHROME, 'src/content/ui/x-spa-handler.js'),
  social: path.join(CHROME, 'src/content/extractors/x-social.js'),
  main: path.join(CHROME, 'src/content/content-main.js'),
  names: path.join(CHROME, 'src/content/shared/social-site-names.js'),
  manifest: path.join(CHROME, 'manifest.json')
};

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };

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

const { JSDOM, VirtualConsole } = loadJsdom();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 提取器链路要加载的真文件（顺序即浏览器注入顺序） */
const CHAIN = [
  'src/content/utils/data-formatters.js',
  'src/content/shared/social-date-utils.js',
  'src/content/shared/social-site-names.js',
  'src/content/shared/social-title-processor.js',
  'src/content/shared/social-fields-builder.js',
  'src/content/shared/x-feed-context.js',
  'src/content/extractors/base-extractor.js',
  'src/content/extractors/x-social.js'
];

/** 只装上下文+按钮（测按钮用，不需要提取器） */
const UI_ONLY = [
  'src/content/utils/data-formatters.js',
  'src/content/shared/x-feed-context.js',
  'src/content/ui/x-feed-buttons.js'
];

/** UI + SPA mixin（测第六节用） */
const UI_WITH_MIXIN = UI_ONLY.concat(['src/content/ui/x-spa-handler.js']);

function openDom(html, url, files) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', (e) => errs.push(String((e && e.message) || e)));
  const dom = new JSDOM(html, {
    url: url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return this.textContent; },
      set(v) { this.textContent = v; }
    });
  }
  for (const rel of (files || UI_ONLY)) {
    const el = w.document.createElement('script');
    el.textContent = fs.readFileSync(path.join(CHROME, rel), 'utf8');
    w.document.documentElement.appendChild(el);
    el.remove();     // 跑完就摘：别让源码文本污染页面文本
  }
  return { dom, w, errs };
}

// ---------------------------------------------------------------- 夹具

/**
 * X 的一条列表页推文（真机形态 2026-11-01 勘察）
 *
 * · `article[data-testid="tweet"]`；通知卡是 `notification`（另一条铁律）
 * · User-Name 里第一个链接是昵称、第二个是 @处理名、第三个是时间链接（= 编号来源）
 * · 真正的时刻在时间链接内部的 `<time datetime="ISO">`，链接文本只是「8小时」
 * · 正文在 tweetText；引用块整块套在 div[role="link"] 里
 */
function tweet(o) {
  const opt = o || {};
  const handle = opt.handle || 'halvenruns';
  const mid = opt.mid || '1718000000000000001';
  const nick = opt.nick || '星辰大海';
  const iso = opt.iso || '2026-10-31T13:40:03.000Z';
  const timeText = opt.timeText || '8小时';
  const body = opt.body === undefined ? '美得太过分了' : opt.body;
  const hrefTail = opt.hrefTail || '';
  const quoted = opt.quoted || '';
  const extra = opt.extra || '';
  // 详情页主贴的 User-Name 里没有时间链接（timeLink:false）
  const timeLink = opt.timeLink === false ? '' :
    '<a href="/' + handle + '/status/' + mid + hrefTail + '"><time datetime="' + iso + '">' + timeText + '</time></a>';
  return '<article data-testid="tweet">'
    + '<div data-testid="User-Name">'
    + '<a href="/' + handle + '">' + nick + '</a>'
    + '<a href="/' + handle + '">@' + handle + '</a>'
    + timeLink
    + '</div>'
    + (body === '' ? '' : '<div data-testid="tweetText">' + body + '</div>')
    + (quoted ? '<div role="link">' + quoted + '</div>' : '')
    + extra
    + '<div data-testid="caret"></div>'
    + '</article>';
}

/** 详情页主贴：时间链接在正文**下方**（User-Name 里没有），这是真机的排法 */
function detailMainPost(o) {
  return tweet(Object.assign({ timeLink: false }, o, {
    extra: '<a href="/' + (o && o.handle || 'halvenruns') + '/status/' + (o && o.mid || '1718000000000000001') + '">'
      + '<time datetime="' + (o && o.iso || '2026-10-31T13:40:03.000Z') + '">10月31日</time></a>'
  }));
}

/** 通知卡（谁点赞/转推了你）：没有推文编号，绝不能挂按钮 */
const NOTIFICATION_CARD = '<article data-testid="notification">'
  + '<div data-testid="User-Name"><a href="/someone">某人</a></div>'
  + '<div>赞了你的推文</div></article>';

function doc(body) {
  return '<!DOCTYPE html><html><head><title>X</title></head><body>' + body + '</body></html>';
}

(async () => {

  /* ============ 一、编号解析 / 日期归一 / 站名占位词 ============ */
  section('一、parseStatusHref / normalizeDate / 站名占位词');
  {
    const { w } = openDom(doc(''), 'https://x.com/home');
    const ctx = w.XFeedContext;

    eq('站点识别 x', ctx.getSite(), 'x');

    // 编号链接：纯 status 才认
    eq('纯 status 链接 → 拆出处理名与编号',
      JSON.stringify(ctx.parseStatusHref('/halvenruns/status/1718000000000000001')),
      JSON.stringify({ handle: 'halvenruns', id: '1718000000000000001' }));
    eq('/analytics 变体 → null（拿它当编号会拼出点不开的地址）',
      ctx.parseStatusHref('/halvenruns/status/123/analytics'), null);
    eq('/quotes 变体 → null', ctx.parseStatusHref('/halvenruns/status/123/quotes'), null);
    eq('/photo/1 变体 → null', ctx.parseStatusHref('/halvenruns/status/123/photo/1'), null);
    eq('系统路径 home/status/… → null（home 不是用户名）',
      ctx.parseStatusHref('/home/status/123'), null);
    eq('非 status 链接 → null', ctx.parseStatusHref('/halvenruns'), null);
    eq('permalink 拼回', ctx.permalink('halvenruns', '123'), 'https://x.com/halvenruns/status/123');

    // 日期：X 是 ISO 8601，**原样透传**（整页路径也是原样 → 同一作品任何入口同一字符串）
    eq('ISO 带毫秒 → 原样透传',
      ctx.normalizeDate('2026-10-31T13:40:03.000Z'), '2026-10-31T13:40:03.000Z');
    eq('ISO 不带毫秒 → 原样透传',
      ctx.normalizeDate('2026-10-31T13:40:03Z'), '2026-10-31T13:40:03Z');
    eq('空串 → 空串', ctx.normalizeDate(''), '');
    eq('null → 空串', ctx.normalizeDate(null), '');
    ok('相对文本兜底不抛错、非空', !!ctx.normalizeDate('10月30日'));

    // 空文案的站名占位词（用户拍板：标题不许出现「无文案」）
    const nmSrc = fs.readFileSync(P.names, 'utf8');
    ok('站名表里 x_social 的形态词是「推文」', /x_social:[\s\S]{0,60}推文/.test(nmSrc));

    // 详情页地址栏编号
    const d = openDom(doc(''), 'https://x.com/halvenruns/status/1718000000000000009');
    eq('详情页地址栏里的编号', d.w.XFeedContext.currentStatusId(), '1718000000000000009');
    const h = openDom(doc(''), 'https://x.com/home');
    eq('首页地址栏没有编号 → 空串', h.w.XFeedContext.currentStatusId(), '');
  }

  /* ============ 二、textWithAlt：emoji 与图标 ============ */
  section('二、textWithAlt：X 把 emoji 渲染成 <img alt>，必须拼回');
  {
    const { w } = openDom(doc(''), 'https://x.com/');
    const ctx = w.XFeedContext;

    const el = w.document.createElement('div');
    el.innerHTML = '美得太过分了 <img alt="🥰"><img alt="🔥">';
    eq('emoji img 按 alt 拼回', ctx.textWithAlt(el), '美得太过分了 🥰🔥');

    const el2 = w.document.createElement('div');
    el2.innerHTML = '前<svg><path></path></svg>后';
    eq('svg（认证徽章/图标）跳过，不产出空串', ctx.textWithAlt(el2), '前后');

    const el3 = w.document.createElement('div');
    el3.innerHTML = '第一行<br>第二行';
    eq('<br> 变空格（不粘成一个词）', ctx.textWithAlt(el3), '第一行 第二行');

    const el4 = w.document.createElement('div');
    el4.innerHTML = '带\u200b零宽\ufeff字符';
    eq('零宽字符剥掉', ctx.textWithAlt(el4), '带零宽字符');

    eq('null 安全', ctx.textWithAlt(null), '');
  }

  /* ============ 三、readPost：列表页 / 引用帖 / 详情页主贴 ============ */
  section('三、readPost：六值读取与四类特殊容器');
  {
    const html = doc(
      tweet({ mid: '1718000000000000001', body: '美得太过分了 <img alt="🥰">' })
      + tweet({
        handle: 'elonmusk', mid: '1718000000000000002', nick: 'Elon Musk',
        iso: '2026-10-30T09:00:00.000Z', timeText: '10月30日',
        body: '博主自己的话',
        quoted: '<div data-testid="tweetText">被引用那条的正文</div>'
      })
      + NOTIFICATION_CARD
    );
    const { w } = openDom(html, 'https://x.com/home');
    const ctx = w.XFeedContext;
    const cs = ctx.findContainers();

    eq('通知卡不算推文容器（data-testid 是 notification）', cs.length, 2);

    const p0 = ctx.readPost(cs[0]);
    eq('处理名来自 User-Name 第一个链接', p0.handle, 'halvenruns');
    eq('编号来自时间链接', p0.mid, '1718000000000000001');
    eq('URL 是这条推文的永久地址（不是列表页）', p0.url, 'https://x.com/halvenruns/status/1718000000000000001');
    eq('昵称取第一个链接的文字', p0.nick, '星辰大海');
    eq('日期是 ISO 原样（不转格式，与整页路径一致）', p0.date, '2026-10-31T13:40:03.000Z');
    eq('正文里的 emoji 按 alt 拼回（textContent 会丢）', p0.text, '美得太过分了 🥰');
    eq('hasText 标记', p0.hasText, true);

    // 引用帖：只取外层博主自己写的（用户拍板 A 案）
    const p1 = ctx.readPost(cs[1]);
    eq('引用帖：处理名仍是外层作者', p1.handle, 'elonmusk');
    eq('引用帖：文案只取外层那段', p1.text, '博主自己的话');
    ok('引用帖：文案里没有被引用那条的内容', p1.text.indexOf('被引用') === -1, p1.text);

    // 纯转发（博主一个字没写）：唯一的 tweetText 在 role=link 里 → 文案判空
    const rt = openDom(doc(tweet({
      body: '',
      quoted: '<div data-testid="tweetText">原推的正文</div>'
    })), 'https://x.com/home');
    const pr = rt.w.XFeedContext.readPost(rt.w.XFeedContext.findContainers()[0]);
    ok('纯转发：能读出编号（整条不许丢）', !!pr && pr.mid === '1718000000000000001');
    eq('纯转发：文案为空串（A 案：不拿原推正文顶包）', pr.text, '');
    eq('纯转发：hasText 为 false', pr.hasText, false);
    ok('纯转发：文案里没有原推内容', String(pr.text).indexOf('原推') === -1, pr.text);

    // 详情页主贴：User-Name 里没有编号链接，退回整条找第一个纯 status 链接
    const dt = openDom(doc(detailMainPost({ mid: '1718000000000000009' })), 'https://x.com/halvenruns/status/1718000000000000009');
    const pd = dt.w.XFeedContext.readPost(dt.w.XFeedContext.findContainers()[0]);
    ok('详情页主贴：能读出编号', !!pd && pd.mid === '1718000000000000009');
    eq('详情页主贴：日期从「编号链接内部的 time」取',
      pd.date, '2026-10-31T13:40:03.000Z');
    eq('详情页主贴：处理名照读', pd.handle, 'halvenruns');

    // 长推文「显示更多」尾巴剥掉（用户拍板：接受列表页截断，但尾巴不能存进文案）
    const sm = openDom(doc(tweet({ body: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑… 显示更多' })), 'https://x.com/home');
    eq('「显示更多」尾巴剥掉',
      sm.w.XFeedContext.readPost(sm.w.XFeedContext.findContainers()[0]).text,
      '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑');

    // 异常容器：认不出编号绝不猜
    const bad = openDom(doc('<article data-testid="tweet"><div>推荐位</div></article>'), 'https://x.com/');
    eq('没有编号链接的 article → null（不挂按钮）',
      bad.w.XFeedContext.readPost(bad.w.document.querySelector('article')), null);

    // /analytics 变体不能当编号：整条唯一「像编号」的链接带尾巴 → null
    const an = openDom(doc(tweet({ hrefTail: '/analytics' })), 'https://x.com/');
    eq('编号链接带 /analytics 尾巴 → null', an.w.XFeedContext.readPost(an.w.XFeedContext.findContainers()[0]), null);

    // 系统路径不是用户名
    const sys = openDom(doc(tweet({ handle: 'home' })), 'https://x.com/');
    eq('处理名是系统路径（home）→ null', sys.w.XFeedContext.readPost(sys.w.XFeedContext.findContainers()[0]), null);
  }

  /* ============ 四、firstPostOnListPage ============ */
  section('四、firstPostOnListPage：列表页全局按钮的自洽口径');
  {
    const two = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222', nick: '乙' })), 'https://x.com/home');
    const fp = two.w.XFeedContext.firstPostOnListPage();
    ok('两条以上 → 返回第一条', !!fp && fp.mid === '1718000000000000001');
    eq('第一条的 URL 自洽', fp.url, 'https://x.com/halvenruns/status/1718000000000000001');

    const one = openDom(doc(tweet({})), 'https://x.com/home');
    eq('只读出 1 条（详情视图）→ null，维持整页取值零回归',
      one.w.XFeedContext.firstPostOnListPage(), null);
  }

  /* ============ 五、按钮组件 ============ */
  section('五、按钮组件：挂载 / 门禁 / 逐卡定位 / 点击');
  {
    const html = doc(tweet({}) + tweet({ handle: 'b', mid: '222', nick: '乙' }));
    const { w } = openDom(html, 'https://x.com/home');
    const calls = [];
    const mgr = new w.XFeedButtons({ onExtract: (t) => { calls.push(t); return true; } });
    mgr.start();

    const btns = w.document.querySelectorAll('.clipmate-x-feed-btn');
    eq('两条推文挂两颗按钮', btns.length, 2);
    eq('按钮挂在推文容器内部（不是 body）', btns[0].parentElement.tagName, 'ARTICLE');
    eq('按钮记着这条的编号', btns[0].getAttribute('data-cm-mid'), '1718000000000000001');
    ok('容器被设为定位锚点', btns[0].parentElement.style.position === 'relative',
      btns[0].parentElement.style.position);
    ok('按钮在容器右上角（absolute 定位）', /position:absolute/.test(
      w.document.getElementById('clipmate-x-feed-style').textContent));

    // 点按钮
    btns[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(30);
    eq('点一次只触发一次提取', calls.length, 1);
    ok('回调拿到的是「这一条」的容器', !!(calls[0] && calls[0].container && calls[0].post));
    eq('回调拿到的编号是这一条的', calls[0].post.mid, '1718000000000000001');

    mgr.stop();
    eq('stop() 后按钮全摘', w.document.querySelectorAll('.clipmate-x-feed-btn').length, 0);
    eq('stop() 后容器 position 还原', w.document.querySelector('article').style.position, '');
  }

  {
    // 详情页：主贴不挂、回复挂（用户拍板 A 案）
    const html = doc(
      detailMainPost({ mid: '1718000000000000009' })
      + tweet({ handle: 'replier', mid: '1718000000000000010', nick: '路人甲', body: '回复正文' })
    );
    const { w } = openDom(html, 'https://x.com/halvenruns/status/1718000000000000009');
    const mgr = new w.XFeedButtons({ onExtract: () => true });
    mgr.start();
    const btns = w.document.querySelectorAll('.clipmate-x-feed-btn');
    eq('详情页：只挂回复那一条（主贴已有全局按钮）', btns.length, 1);
    eq('挂的是回复的编号', btns[0] && btns[0].getAttribute('data-cm-mid'), '1718000000000000010');
    mgr.stop();

    // 从列表页点进详情页若有历史遗留按钮 → sync 摘掉
    const stale = w.document.createElement('button');
    stale.className = 'clipmate-x-feed-btn';
    stale.setAttribute('data-cm-mid', '1718000000000000009');
    w.document.querySelector('article[data-testid="tweet"]').appendChild(stale);
    const mgr2 = new w.XFeedButtons({ onExtract: () => true });
    mgr2.start();
    eq('主贴上的历史遗留按钮被摘掉', w.document.contains(stale), false);
    const after = w.document.querySelectorAll('.clipmate-x-feed-btn');
    eq('页面上只剩回复那一颗', after.length, 1);
    eq('留下的确实是回复的编号', after[0] && after[0].getAttribute('data-cm-mid'), '1718000000000000010');
    mgr2.stop();
  }

  {
    // 单条详情视图 → 一颗都不挂
    const { w } = openDom(doc(detailMainPost({})), 'https://x.com/halvenruns/status/1718000000000000009');
    const mgr = new w.XFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('单条详情视图 → 一颗都不挂', w.document.querySelectorAll('.clipmate-x-feed-btn').length, 0);
    mgr.stop();
  }

  {
    // 通知卡不挂
    const html = doc(tweet({}) + tweet({ handle: 'b', mid: '222' }) + NOTIFICATION_CARD);
    const { w } = openDom(html, 'https://x.com/notifications');
    const mgr = new w.XFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('通知页：只有两条真推文挂按钮', w.document.querySelectorAll('.clipmate-x-feed-btn').length, 2);
    mgr.stop();
  }

  {
    // 站点门禁：别的网站不干活
    const { w } = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://www.douyin.com/');
    const mgr = new w.XFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('非 X 站点 → 一颗都不挂', w.document.querySelectorAll('.clipmate-x-feed-btn').length, 0);
    eq('非 X 站点 → 连样式都不注入', w.document.getElementById('clipmate-x-feed-style'), null);
  }

  {
    // v2.7.43：逐卡 caret 定位。「⋯」顶部三档（普通 12 / 转推 28），写死必压字
    // （微博搜索页真机压住 @某人 3px 的同款坑，X 的转推行更高）
    const { w } = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://x.com/home');
    const cards = w.document.querySelectorAll('article[data-testid="tweet"]');
    [12, 28].forEach((caretTop, i) => {
      const card = cards[i];
      const caret = card.querySelector('[data-testid="caret"]');
      // 两者都是视口坐标，卡片顶在 100 → caret 顶 = 100 + 卡片内偏移
      caret.getBoundingClientRect = () => ({ top: 100 + caretTop, bottom: 120 + caretTop, height: 20, width: 19, left: 600, right: 619 });
      card.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500, width: 600, left: 0, right: 600 });
    });

    const mgr = new w.XFeedButtons({ onExtract: () => true });
    mgr.start();
    const b1 = w.document.querySelector('.clipmate-x-feed-btn[data-cm-mid="1718000000000000001"]');
    const b2 = w.document.querySelector('.clipmate-x-feed-btn[data-cm-mid="222"]');
    // v2.8.8：按钮 26 → 28（换成头像后要放得下 20px 的头），竖向居中的 top 因此各减 1
    eq('普通卡：跟自己的「⋯」居中 → top 8px', b1.style.top, '8px');
    eq('转推卡（多一行「已转帖」）：top 24px', b2.style.top, '24px');
    ok('两张卡片算出不一样的高度（证明是逐卡算的，不是写死的）', b1.style.top !== b2.style.top);

    // v2.7.45：横向避让（真机复验发现 v2.7.44 的避让**根本没生效**）。
    //
    // 真机事实：X 的操作行**没有 role=group**（往上七层全是普通 div.css-g5y9jx），
    // 所以靠 `caret.closest('div[role="group"]')` 找操作行必然落空 → 避让从未生效，
    // 按钮仍旧整个盖住「Grok 操作」（真机实测按钮 701-727 vs Grok 706-726）。
    // 修法：改成**纯几何**判据 —— 与「⋯」同一行、整个在它左边、间隙 ≤30px，
    // 取最靠右（最紧邻）的那个，把按钮放到它左边留 6px。
    //
    // 这里的 DOM **刻意复现真机形态：没有 role=group**（铁律：测试要照真机造）。
    cards.forEach((card) => {
      const caret = card.querySelector('[data-testid="caret"]');
      // 真机形态：caret 被两层 div 套着（真机往上七层全是 div.css-g5y9jx），
      // 「Grok 操作」在**另一层**里，不是 caret 的兄弟 → 只扫 caret 父层必然扫不到它
      const l1 = w.document.createElement('div');
      const l2 = w.document.createElement('div');
      card.appendChild(l1);
      l1.appendChild(l2);
      l2.appendChild(caret);
      const grok = w.document.createElement('button');
      grok.setAttribute('aria-label', 'Grok 操作');
      card.appendChild(grok);
      // 视口坐标：卡片右缘 600；caret l565-584；Grok l530-550（紧贴 caret 左边，间隙 15）
      caret.getBoundingClientRect = () => ({ top: 112, bottom: 132, height: 20, width: 19, left: 565, right: 584 });
      grok.getBoundingClientRect = () => ({ top: 112, bottom: 132, height: 20, width: 20, left: 530, right: 550 });
      card.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500, width: 600, left: 0, right: 600 });
    });
    mgr.sync();
    eq('有 Grok 按钮：右缘让到它左边留 6px 间隙 → right 76px（600-530+6）',
      b1.style.right, '76px');
    ok('Grok 按钮不再被压住', true);
    ok('真机形态（没有 role=group）也能避让 —— 回归 v2.7.44 的失效点',
      b1.style.right !== '' && b1.style.right !== '41px');

    // 防自反馈：自己挂的按钮也是 <button>，扫整张卡时必须把它排除掉。
    // 把它伪造成紧贴「⋯」左边（间隙 5px）—— 若没排除，就会把自己当成紧邻控件，
    // 位置被自己带偏（76 → 70），按钮越算越歪。
    b1.getBoundingClientRect = () => ({ top: 100, bottom: 126, height: 26, width: 26, left: 536, right: 560 });
    mgr.sync();
    eq('自己挂的按钮不会被当成障碍（位置不自我带偏）', b1.style.right, '76px');

    // 离得远的控件不算「紧邻」（真机里日期链接离「⋯」有 252px，
    // 当成紧邻的话按钮会跑到操作行正中间）→ 仍回落固定值
    {
      const { w: w3 } = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://x.com/home');
      const c3 = w3.document.querySelectorAll('article[data-testid="tweet"]');
      c3.forEach((card) => {
        const caret = card.querySelector('[data-testid="caret"]');
        const far = w3.document.createElement('a');
        far.setAttribute('href', '/x/status/1');
        far.textContent = '10月17日';
        card.appendChild(far);
        caret.getBoundingClientRect = () => ({ top: 112, bottom: 132, height: 20, width: 19, left: 565, right: 584 });
        far.getBoundingClientRect = () => ({ top: 112, bottom: 132, height: 20, width: 63, left: 419, right: 482 });
        card.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500, width: 600, left: 0, right: 600 });
      });
      const m3 = new w3.XFeedButtons({ onExtract: () => true });
      m3.start();
      m3.sync();
      const bb = w3.document.querySelector('.clipmate-x-feed-btn');
      eq('离得远的控件不算紧邻 → 不加内联 right（回落样式表 41）', bb.style.right, '');
      m3.stop();
    }

    // 把 Grok 摘掉 → 回落 CSS 固定值（不加内联 right）
    cards.forEach((card) => {
      const grok = card.querySelector('button[aria-label="Grok 操作"]');
      if (grok) grok.remove();
    });
    mgr.sync();
    eq('没有 Grok 按钮 → 不加内联 right（用样式表 right 41 兜底）',
      b1.style.right, '');
    mgr.stop();

    // 没有「⋯」的卡片 → 算不出来，退回 CSS 固定值（不加内联 top）
    const { w: w2 } = openDom(doc(tweet({}) + tweet({ handle: 'c', mid: '333' })), 'https://x.com/home');
    w2.document.querySelectorAll('[data-testid="caret"]').forEach((el) => el.remove());
    const m2 = new w2.XFeedButtons({ onExtract: () => true });
    m2.start();
    eq('找不到「⋯」→ 不加内联 top（用样式表兜底）',
      w2.document.querySelector('.clipmate-x-feed-btn').style.top, '');
    m2.stop();
  }

  /* ============ 六、SPA mixin ============ */
  section('六、SPA mixin：初始化门禁与逐帖提取转接');
  {
    // 门禁：x.com 才初始化
    const xw = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://x.com/home', UI_WITH_MIXIN);
    const fake = { xFeedButtons: null };
    xw.w.XSpaMixin._initXFeedButtons.call(fake);
    ok('x.com：初始化出按钮组件', !!fake.xFeedButtons);
    eq('按钮已挂上', xw.w.document.querySelectorAll('.clipmate-x-feed-btn').length, 2);
    const inst = fake.xFeedButtons;
    xw.w.XSpaMixin._initXFeedButtons.call(fake);
    ok('幂等：重复调用不换实例', fake.xFeedButtons === inst);

    // 非 X 站不初始化
    const ww = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://weibo.com/', UI_WITH_MIXIN);
    const fake2 = { xFeedButtons: null };
    ww.w.XSpaMixin._initXFeedButtons.call(fake2);
    eq('非 x.com：不初始化', fake2.xFeedButtons, null);
  }

  {
    // 点按钮 → handleExtract 收到 feedPost + forceMediaType，上下文用完还原
    const { w } = openDom(doc(tweet({}) + tweet({ handle: 'b', mid: '222' })), 'https://x.com/home', UI_WITH_MIXIN);
    const captured = [];
    const fake = Object.assign({}, w.XSpaMixin, {
      activeContext: 'prev-ctx',
      activeShortcode: 'prev-sc',
      handleExtract: async (opts) => { captured.push(opts); return true; }
    });
    const ctx = w.XFeedContext;
    const el = ctx.findContainers()[1];
    const post = ctx.readPost(el);
    const result = await fake._onXPostExtract({ container: el, post: post });

    eq('返回布尔 true', result, true);
    eq('handleExtract 只被调一次', captured.length, 1);
    eq('feedPost 里是这一条的编号', captured[0].feedPost.post.mid, '222');
    eq('强制按社交推文提取（作者主页是 person，不强制会被抢走）',
      captured[0].forceMediaType, 'social');
    eq('提取后 activeContext 还原', fake.activeContext, 'prev-ctx');
    eq('提取后 activeShortcode 还原', fake.activeShortcode, 'prev-sc');

    // 缺编号 → false，不打 handleExtract
    eq('缺 post → false', await fake._onXPostExtract({ container: el, post: null }), false);
    eq('坏调用不出提取', captured.length, 1);

    // handleExtract 抛错 → false（按钮闪红），错误不外漏
    const boom = Object.assign({}, w.XSpaMixin, {
      handleExtract: async () => { throw new Error('boom'); }
    });
    eq('提取抛错 → 返回 false', await boom._onXPostExtract({ container: el, post: post }), false);
  }

  /* ============ 七、提取器契约（从 extractAllFields 进） ============ */
  section('七、提取器契约：必须从 extractAllFields 进');
  {
    const html = doc(
      tweet({ mid: '1718000000000000001', body: '美得太过分了 <img alt="🥰">' })
      + tweet({
        handle: 'elonmusk', mid: '1718000000000000002', nick: 'Elon Musk',
        body: '', quoted: '<div data-testid="tweetText">原推的正文</div>'
      })
      + tweet({ handle: 'longtext', mid: '1718000000000000003', nick: '长文哥', body: '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯' })
    );
    const { w } = openDom(html, 'https://x.com/home', CHAIN);
    const ctx = w.XFeedContext;
    const cs = ctx.findContainers();
    const ex = new w.XSocialExtractor();

    const rec = await ex.extractAllFields({ feedPost: { container: cs[0], post: ctx.readPost(cs[0]) } });
    eq('6 列：作者ID', rec['作者ID'], 'halvenruns');
    eq('6 列：作者昵称', rec['作者昵称'], '星辰大海');
    eq('6 列：作者主页', rec['作者主页'], 'https://x.com/halvenruns');
    eq('6 列：发布日期原样 ISO', rec['发布日期'], '2026-10-31T13:40:03.000Z');
    eq('6 列：本页文案带 emoji', rec['本页文案'], '美得太过分了 🥰');
    eq('6 列：URL 是这条推文', rec['URL'], 'https://x.com/halvenruns/status/1718000000000000001');
    eq('6 列：标题 = 昵称+文案+日期（ISO 转 UTC+8，到秒）',
      rec['本页标题'], '星辰大海美得太过分了-2026年10月31日214003');
    eq('6 列：站点标识', rec.sourceSite, 'x_social');
    ok('6 列：标题里没有「无文案」', String(rec['本页标题']).indexOf('无文案') === -1);
    ok('6 列：标题里的 emoji 被洗掉', String(rec['本页标题']).indexOf('🥰') === -1, rec['本页标题']);

    // 纯转发：文案为空 → 站名占位「X推文」，标题同步改写（装配器兜底必须够得着）
    const rec2 = await ex.extractAllFields({ feedPost: { container: cs[1], post: ctx.readPost(cs[1]) } });
    eq('纯转发：文案用站名顶上', rec2['本页文案'], 'X推文');
    // 注：标题过滤器白名单（汉字/数字/字母/-/_）会洗掉空格 —— 全站统一既有行为，
    // 「Elon Musk」进标题变「ElonMusk」；文案列不受影响，照原样保留空格。
    eq('纯转发：标题也用站名顶上（不是空、不是「无文案」）',
      rec2['本页标题'], 'ElonMuskX推文-2026年10月31日214003');
    ok('纯转发：标题里没有「无文案」三个字', String(rec2['本页标题']).indexOf('无文案') === -1);
    ok('纯转发：文案里没有原推内容', String(rec2['本页文案']).indexOf('原推') === -1, rec2['本页文案']);

    // 标题截断：文案超过 20 字取前 20 字
    const rec3 = await ex.extractAllFields({ feedPost: { container: cs[2], post: ctx.readPost(cs[2]) } });
    eq('长文案：标题只取前 20 字',
      rec3['本页标题'], '长文哥一二三四五六七八九十甲乙丙丁戊己庚辛壬癸-2026年10月31日214003');

    // 装配器对 extractTitle 的临时包装必须复原（复原失败 = 提取器残废，实测踩过）
    const origTitle = w.XSocialExtractor.prototype.extractTitle;
    eq('extractTitle 用完复原（不许留包装）', ex.extractTitle === origTitle
      || String(ex.extractTitle).indexOf('fallbackText') === -1, true);

    // 列表页点全局按钮：不许再拼「第一条正文 + 列表页地址」
    const recList = await ex.extractAllFields();
    eq('列表页全局按钮：URL 变成第一条推文的永久地址',
      recList['URL'], 'https://x.com/halvenruns/status/1718000000000000001');
    eq('列表页全局按钮：作者ID 也是第一条的', recList['作者ID'], 'halvenruns');

    // 详情页（只 1 条）→ 维持原来的整页取值，不许崩
    const one = openDom(doc(detailMainPost({})), 'https://x.com/halvenruns/status/1718000000000000009', CHAIN);
    const recOne = await new one.w.XSocialExtractor().extractAllFields();
    ok('详情页仍走整页取值（不抛错、有记录）', !!recOne && typeof recOne === 'object');
  }

  /* ============ 八、注入与清单 ============ */
  section('八、注入范围与清单（manifest / content-main 门禁）');
  {
    const mf = JSON.parse(fs.readFileSync(P.manifest, 'utf8'));
    ok('host_permissions 覆盖 x.com', (mf.host_permissions || []).indexOf('https://x.com/*') > -1);
    ok('host_permissions 覆盖 www.x.com', (mf.host_permissions || []).indexOf('https://www.x.com/*') > -1);

    const main = (mf.content_scripts || [])[0];
    ok('主 content_scripts 覆盖 x.com', (main.matches || []).indexOf('https://x.com/*') > -1);

    const js = main.js || [];
    const iCtx = js.indexOf('src/content/shared/x-feed-context.js');
    const iBtn = js.indexOf('src/content/ui/x-feed-buttons.js');
    const iMixin = js.indexOf('src/content/ui/x-spa-handler.js');
    ok('上下文脚本已注册', iCtx > -1);
    ok('按钮脚本已注册', iBtn > -1);
    ok('mixin 已注册', iMixin > -1);
    ok('上下文必须排在按钮之前（按钮启动就要用）', iCtx > -1 && iBtn > -1 && iCtx < iBtn);
    ok('按钮必须排在 mixin 之前', iBtn > -1 && iMixin > -1 && iBtn < iMixin);

    eq('版本号升到 2.12.0', mf.version, '2.12.3');

    // content-main 门禁与 mixin 注册
    const mainSrc = fs.readFileSync(P.main, 'utf8');
    ok('content-main 有 x.com 的域名门禁', /x\\\.com\$\/i\.test\(location\.hostname\)/.test(mainSrc));
    ok('content-main 调用 _initXFeedButtons', mainSrc.indexOf('this._initXFeedButtons()') > -1);
    ok('XSpaMixin 注册到共享原型', /Object\.assign\(MediaExtractor\.prototype,\s*XSpaMixin\)/.test(mainSrc));

    // 按钮组件不写自己的选择器（微博 v2.7.39 的教训：选择器各写一份，改一处漏一处）
    const btnSrc = fs.readFileSync(P.buttons, 'utf8');
    ok('按钮组件不硬编码 tweet 选择器（一律问 XFeedContext）',
      btnSrc.indexOf('data-testid="tweet"') === -1);
    ok('按钮定位用 ctx 的 caret 选择器', btnSrc.indexOf('CARET_SELECTOR') > -1);

    // SPA handler 的两条纪律
    const hSrc = fs.readFileSync(P.handler, 'utf8');
    ok('点按钮时传了 forceMediaType: social', /forceMediaType:\s*'social'/.test(hSrc));
    ok('forceMediaType 与 feedPost 在同一次 handleExtract 调用里',
      /feedPost:[\s\S]{0,200}?forceMediaType:\s*'social'/.test(hSrc));
    ok('mixin 自己也有域名门禁（共享原型铁律）',
      /x\\\.com\$\/i\.test\(host\)/.test(hSrc));

    // 提取器：空文案标题必须走 extractTitle 第一参数（装配器兜底够得着）
    const xSrc = fs.readFileSync(P.social, 'utf8');
    ok('标题在 overrides 里走 this.extractTitle（文案当第一参数）',
      /this\.extractTitle\(text,\s*null,\s*\{\s*nick/.test(xSrc));
    ok('列表页口径走 firstPostOnListPage', xSrc.indexOf('firstPostOnListPage') > -1);
  }

  /* ============ 总结 ============ */
  console.log('\n' + '─'.repeat(56));
  if (fail === 0) {
    console.log(C.green + '全部通过：' + pass + ' 项' + C.reset);
  } else {
    console.log(C.red + '失败 ' + fail + ' 项，通过 ' + pass + ' 项' + C.reset);
    failures.forEach((f) => console.log('  · ' + f));
    process.exitCode = 1;
  }
})();
