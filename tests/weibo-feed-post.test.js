/**
 * 微博「页面上每条博文一颗小按钮」验收（v2.7.39）
 *
 * 需求（用户 2026-11-01 拍板）
 * --------------------------
 *   「微博全站只要出现在页面上的博文，像 IG 首页一样加上小按钮，
 *     这样就不用单独点开博文详情页提取了。」
 *   三件事用户逐条拍板：① 转发帖只取博主自己写的转发理由（A 案）；
 *   ② 搜索页 s.weibo.com 要覆盖；③ 手机版 m.weibo.cn 要做。
 *
 * 这份测试盯死的是**真机上会出事故的地方**（全部来自 2026-11-01 实机勘察）：
 *   1. 三套页面结构完全不同（article / .card-wrap / .card9），取值必须只有一份实现；
 *   2. 搜索页的时间文本会混进「转赞人数超过100」，末尾还有「相关用户」这种非博文卡片；
 *   3. 手机版**博文编号不在 DOM 里**，只能靠主世界桥写在 data-cm-wb 上，没有桥就不许挂按钮；
 *   4. 纯转发帖不许拿原博正文顶包（否则存下来的是别人的话）；
 *   5. 列表页点全局按钮时不许再拼出「第一条的正文 + 列表页地址」。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const P = {
  context: path.join(CHROME, 'src/content/shared/weibo-feed-context.js'),
  buttons: path.join(CHROME, 'src/content/ui/weibo-feed-buttons.js'),
  handler: path.join(CHROME, 'src/content/ui/weibo-spa-handler.js'),
  bridge: path.join(CHROME, 'src/content/weibo-mobile-bridge.js'),
  social: path.join(CHROME, 'src/content/extractors/weibo-social.js'),
  mobile: path.join(CHROME, 'src/content/extractors/weibo-mobile-social.js'),
  main: path.join(CHROME, 'src/content/content-main.js'),
  detector: path.join(CHROME, 'src/content/utils/media-detector.js'),
  factory: path.join(CHROME, 'src/content/utils/extractor-factory.js'),
  background: path.join(CHROME, 'src/background/background.js'),
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
  'src/content/shared/weibo-feed-context.js',
  'src/content/extractors/base-extractor.js',
  'src/content/extractors/weibo-social.js',
  'src/content/extractors/weibo-mobile-social.js'
];

/** 只装上下文+按钮（测按钮用，不需要提取器） */
const UI_ONLY = [
  'src/content/utils/data-formatters.js',
  'src/content/shared/weibo-feed-context.js',
  'src/content/ui/weibo-feed-buttons.js'
];

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
 * weibo.com 的一条博文（真机形态 2026-11-01 勘察）
 *
 * · 昵称只在头像链接的 aria-label 上（纯转发帖 header 里没有 a[usercard]）
 * · 时间链接 href = weibo.com/<uid>/<mid>，**title 属性是绝对时间**
 * · 正文在 [class*="_ogText_"] 里（转发出来的原博在 .retweet，是另一块）
 */
function desktopPost(o) {
  const opt = o || {};
  const uid = opt.uid || '5700117586';
  const mid = opt.mid || 'RoJt40fZG';
  const nick = opt.nick || '天天超级烦';
  const title = opt.title || '2026-10-28 10:51';
  const timeText = opt.timeText || '10-28 10:51';
  const body = opt.body === undefined ? '故地重游就是刻舟求剑' : opt.body;
  const retweet = opt.retweet || '';
  return '<article><div class="_body_ecgcn_63">'
    + '<header class="woo-box-flex">'
    + '<a href="//weibo.com/u/' + uid + '" aria-label="' + nick + '">'
    + '<div usercard="' + uid + '"><img src="a.jpg"></div></a>'
    + '<div>'
    + '<a href="//weibo.com/u/' + uid + '">' + nick + '</a>'
    + '<a class="_time_1tpft_33" href="https://weibo.com/' + uid + '/' + mid + '" title="' + title + '">' + timeText + '</a>'
    + '<div class="_from_1tpft_24">来自 iPhone客户端</div>'
    + '</div>'
    + '<div class="woo-pop-wrap _more_1v5ao_27"><span class="woo-pop-ctrl">c</span></div>'
    + '</header>'
    + '<div class="_text_1j6t8_2 _ogText_1j6t8_70"><div class="_wbtext_1j6t8_46">' + body + '</div></div>'
    + (retweet ? '<div class="retweet">' + retweet + '</div>' : '')
    + '</div></article>';
}

/**
 * 桌面版「超话帖」（v2.7.40 真机取形）
 *
 * 发到「××超话」里的博文，header 首元素是**超话入口**（指向 `/p/1008…`），
 * 不是用户主页，所以整块 header 没有 `aria-label` —— 昵称只能从
 * 「来自 @发帖人」那一行的 `<a href="/u/<uid>">` 拿。
 * 真机实测（2026-11-01，`weibo.com/7771047739/Rp1Umw9uI`）：
 * header 文本 = `美依礼芽超话10-30 09:48 来自 @奶香啵啵的玲娜贝儿`。
 */
function superTopicPost(o) {
  const opt = o || {};
  const uid = opt.uid || '7771047739';
  const mid = opt.mid || 'Rp1Umw9uI';
  const nick = opt.nick || '奶香啵啵的玲娜贝儿';
  const title = opt.title || '2026-10-30 09:48';
  const body = opt.body === undefined ? '美依礼芽 MARiA 的可' : opt.body;
  return '<article><div class="_body_ecgcn_63">'
    + '<header class="woo-box-flex">'
    + '<a href="https://weibo.com/p/1008089fe2127e7a8482aecaa852ae29288894" class="_none_fvu9w_16">'
    + '<div class="woo-avatar _avatar_ygi5b_15" usercard="' + uid + '"><img src="a.jpg"></div></a>'
    + '<div class="_main_ygi5b_20"><div class="_content_wrap_ygi5b_114">'
    + '<a href="//weibo.com/p/1008089fe2127e7a8482aecaa852ae29288894" class="_superText_ygi5b_131">'
    + '<span title="美依礼芽超话">美依礼芽超话</span></a>'
    + '<div class="_info_1tpft_10">'
    + '<a class="_time_1tpft_33" title="' + title + '" href="https://weibo.com/' + uid + '/' + mid + '">10-30   09:48</a>'
    + '<div class="_from_1tpft_24"><div> 来自 <a href="/u/' + uid + '" class="_cut_1tpft_29">'
    + '<span title="@' + nick + '">@' + nick + '</span></a></div></div>'
    + '</div></div></div>'
    + '<div class="woo-pop-wrap _more_1v5ao_27"><span class="woo-pop-ctrl">c</span></div>'
    + '</header>'
    + '<div class="_text_1j6t8_2 _ogText_1j6t8_70"><div class="_wbtext_1j6t8_46">' + body + '</div></div>'
    + '</div></article>';
}

/** s.weibo.com 的一条博文（.card-wrap，时间在 .from a 里、没有 title 属性） */
function searchCard(o) {
  const opt = o || {};
  const uid = opt.uid || '7847210480';
  const mid = opt.mid || 'RpgfDebQV';
  const nick = opt.nick || '其实我也不是很丑吧喵';
  const timeText = opt.timeText || '10月31日 22:18';
  const body = opt.body === undefined ? '53222【丑猫】晚上刷到的直播' : opt.body;
  const cls = opt.txtCls || 'txt';
  return '<div class="card-wrap"><div class="card"><div class="content"><div class="info">'
    + '<a class="name" href="//weibo.com/' + uid + '?refer_flag=1001030103_">' + nick + '</a>'
    + '<div class="from"><a href="//weibo.com/' + uid + '/' + mid + '?refer_flag=1001030103_" target="_blank">'
    + timeText + '</a></div>'
    + '</div><p class="' + cls + '">' + body + '</p></div></div></div>';
}

/** 搜索页末尾的「相关用户」卡片：没有 .from，必须认成非博文 */
const NON_POST_CARD = '<div class="card-wrap"><div class="card card-topic-presenter">'
  + '<h4 class="title">相关用户</h4><div>猫君大白</div></div></div>';

/** m.weibo.cn 的一条博文（编号只存在于 data-cm-wb，由主世界桥写入） */
function mobileCard(o) {
  const opt = o || {};
  const payload = opt.payload !== undefined ? opt.payload : {
    id: '5360401470719371',
    mid: '5360401470719371',
    uid: '1765335300',
    nick: '黑桐谷歌',
    createdAt: 'Sun Nov 01 11:12:45 +0800 2026',
    text: '喝药有技巧，在连招动作刚结束的时候喝药'
  };
  const attr = payload === null ? '' : ' data-cm-wb=\'' + (typeof payload === 'string' ? payload : JSON.stringify(payload)) + '\'';
  return '<div class="card m-panel card9 f-weibo"' + attr + '>'
    + '<div class="card-wrap"><header class="weibo-top m-box"><div class="m-text-box">'
    + '<h3 class="m-text-cut">黑桐谷歌</h3><h4 class="m-text-cut">3分钟前 来自 微博网页版</h4>'
    + '</div></header></div>'
    + '<div class="card-wrap"><div class="weibo-text">喝药有技巧</div></div>'
    + '</div>';
}

function doc(body) {
  return '<!DOCTYPE html><html><head><title>微博</title></head><body>' + body + '</body></html>';
}

(async () => {
  const Y = new Date().getFullYear();

  /* ============ 一、日期归一 ============ */
  section('一、日期归一 normalizeDate：三套页面五种写法');
  {
    // 只测纯函数，不需要 DOM 结构
    const { w } = openDom(doc(''), 'https://weibo.com/');
    const ctx = w.WeiboFeedContext;

    eq('桌面版 title 的绝对时间 → 斜杠格式', ctx.normalizeDate('2026-10-31 20:24'), '2026/10/31 20:24');
    eq('绝对时间（斜杠）原样归一', ctx.normalizeDate('2026/10/31 20:24'), '2026/10/31 20:24');
    eq('缺年份 10-28 10:51 → 补成不晚于现在的那一年',
      ctx.normalizeDate('10-28 10:51'), Y + '/10/28 10:51');
    eq('缺年份 01-01 00:00 → 一定是当年（1 月 1 日不可能是未来）',
      ctx.normalizeDate('01-01 00:00'), Y + '/01/01 00:00');
    eq('中文月日 01月01日 09:30 → 当年', ctx.normalizeDate('01月01日 09:30'), Y + '/01/01 09:30');
    eq('手机版 C 语言式 → 去掉秒，只到分',
      ctx.normalizeDate('Sun Nov 01 11:12:45 +0800 2026'), '2026/11/01 11:12');
    eq('空串 → 空串', ctx.normalizeDate(''), '');
    eq('null → 空串', ctx.normalizeDate(null), '');

    // 搜索页的时间文本会混进「转赞人数超过N」
    const noisy = ctx.normalizeDate('2分钟前 转赞人数超过100');
    ok('剥掉「转赞人数超过100」', String(noisy).indexOf('转赞') === -1, noisy);
    ok('剥完仍然是个能用的日期（含年月日）', /^\d{4}\/\d{2}\/\d{2}/.test(String(noisy)), noisy);
    ok('剥完不含「来自」', String(ctx.normalizeDate('3小时前 来自 iPhone客户端')).indexOf('来自') === -1);

    // 「今天/昨天」带时刻（formatSocialDate 只认裸「昨天」，不认「昨天05:11」）
    const d = new Date();
    const todayStr = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0')
      + '/' + String(d.getDate()).padStart(2, '0');
    eq('今天05:11 → 今天的日期 + 时刻', ctx.normalizeDate('今天05:11'), todayStr + ' 05:11');
    const y = new Date(Date.now() - 86400000);
    const yStr = y.getFullYear() + '/' + String(y.getMonth() + 1).padStart(2, '0')
      + '/' + String(y.getDate()).padStart(2, '0');
    eq('昨天05:11 → 昨天的日期 + 时刻', ctx.normalizeDate('昨天05:11'), yStr + ' 05:11');
  }

  /* ============ 二、正文尾巴 ============ */
  section('二、正文尾部「展开」必须剥掉（不能存进文案）');
  {
    const { w } = openDom(doc(''), 'https://weibo.com/');
    const ctx = w.WeiboFeedContext;
    eq('桌面版尾巴 `...展开`', ctx.stripExpandTail('情况最好的是 ​​​ ...展开'), '情况最好的是');
    eq('搜索页尾巴 `展开c`', ctx.stripExpandTail('后面还是坚持 ​ 展开c'), '后面还是坚持');
    eq('正文中间出现「展开」不许动',
      ctx.stripExpandTail('他展开双臂拥抱'), '他展开双臂拥抱');
    eq('空串安全', ctx.stripExpandTail(''), '');
  }

  /* ============ 三、桌面版 weibo.com ============ */
  section('三、桌面版读取：article（含纯转发帖）');
  {
    const html = doc(
      desktopPost({ mid: 'RoJt40fZG', body: '故地重游就是刻舟求剑' })
      + desktopPost({
        uid: '5440374917', mid: 'Rpfv1oUHH', nick: 'BtoZ-Movie',
        title: '2026-10-31 20:24', timeText: '15小时前',
        body: '', retweet: '@华坚冯力士v「自译#新片推荐#」…'
      })
    );
    const { w } = openDom(html, 'https://weibo.com/');
    const ctx = w.WeiboFeedContext;

    eq('站点识别 desktop', ctx.getSite(), 'desktop');
    const cs = ctx.findContainers();
    eq('两条 article 都认成容器', cs.length, 2);

    const p0 = ctx.readPost(cs[0]);
    eq('作者ID 来自时间链接', p0.uid, '5700117586');
    eq('博文编号 来自时间链接', p0.mid, 'RoJt40fZG');
    eq('URL 是这条博文的永久地址（不是列表页）', p0.url, 'https://weibo.com/5700117586/RoJt40fZG');
    eq('昵称取 aria-label，不是账号名', p0.nick, '天天超级烦');
    eq('日期取 title 属性（绝对时间，不是「10-28 10:51」）', p0.date, '2026/10/28 10:51');
    eq('正文取 _ogText_', p0.text, '故地重游就是刻舟求剑');

    const p1 = ctx.readPost(cs[1]);
    eq('纯转发帖：作者ID 仍能取到', p1.uid, '5440374917');
    eq('纯转发帖：昵称取 aria-label', p1.nick, 'BtoZ-Movie');
    // 这条的显示文本是「15小时前」，title 是绝对时间 —— 必须用 title。
    // 只读文本会算出「当前时间」，与真实发布时间差一天以上，这条断言就是拦它的。
    eq('纯转发帖：日期取 title 属性，不是「15小时前」', p1.date, '2026/10/31 20:24');
    eq('纯转发帖：文案为空（A 案：不拿原博正文顶包）', p1.text, '');
    ok('纯转发帖：文案里没有原博的内容', String(p1.text).indexOf('冯力士') === -1, p1.text);

    // 认不出编号的 article（广告位 / 骨架屏）→ null
    const { w: w2 } = openDom(doc('<article><header><a href="/u/1">x</a></header></article>'), 'https://weibo.com/');
    eq('没有博文地址的 article → null（不挂按钮）', w2.WeiboFeedContext.readPost(w2.document.querySelector('article')), null);

    /* ---- v2.7.40：超话帖的昵称（v2.7.39 真机漏掉的分支） ---- */
    const st = openDom(doc(superTopicPost({})), 'https://weibo.com/');
    const sp = st.w.WeiboFeedContext.readPost(st.w.WeiboFeedContext.findContainers()[0]);
    ok('超话帖：能读出编号（不是被整条丢掉）', !!sp && sp.mid === 'Rp1Umw9uI');
    eq('超话帖：昵称从「来自 @发帖人」那一行取', sp.nick, '奶香啵啵的玲娜贝儿');
    ok('超话帖：昵称不是一串数字 UID（v2.7.39 真机就是把 UID 当昵称写进标题的）',
      !/^\d+$/.test(sp.nick), sp.nick);
    ok('超话帖：昵称没带前导 @', sp.nick.charAt(0) !== '@', sp.nick);
    ok('超话帖：超话名不能当昵称', sp.nick.indexOf('超话') === -1, sp.nick);
    eq('超话帖：日期照样取 title 属性', sp.date, '2026/10/30 09:48');

    // 反向：只有 uid 对得上才认，别把「转发来源」当成作者
    const wrong = superTopicPost({ uid: '7771047739' })
      .replace('<div> 来自 <a href="/u/7771047739"', '<div> 来自 <a href="/u/9999999999"');
    const wr = openDom(doc(wrong), 'https://weibo.com/');
    eq('超话帖：来源 uid 与本条不符 → 不用它当昵称',
      wr.w.WeiboFeedContext.readPost(wr.w.WeiboFeedContext.findContainers()[0]).nick, '');
  }

  /* ============ 四、搜索页 s.weibo.com ============ */
  section('四、搜索页读取：.card-wrap（非博文卡片必须排除）');
  {
    const html = doc(
      searchCard({ timeText: '10月31日 22:18' })
      + searchCard({ uid: '5109911143', mid: 'RpkUvr4o7', nick: '我叫猫天天', timeText: '2分钟前 转赞人数超过100', body: '今天拍到的小猫 ​ 展开c' })
      + NON_POST_CARD
    );
    const { w } = openDom(html, 'https://s.weibo.com/weibo?q=%E7%8C%AB');
    const ctx = w.WeiboFeedContext;

    eq('站点识别 search（不是 desktop）', ctx.getSite(), 'search');
    const cs = ctx.findContainers();
    eq('三个 .card-wrap 都算容器', cs.length, 3);

    const posts = cs.map((el) => ctx.readPost(el));
    eq('「相关用户」卡片读不出博文 → null', posts[2], null);
    ok('两个真博文都能读出编号', !!(posts[0] && posts[0].mid) && !!(posts[1] && posts[1].mid));

    eq('搜索页：昵称取 .name', posts[0].nick, '其实我也不是很丑吧喵');
    eq('搜索页：URL 去掉 ?refer_flag 尾巴', posts[0].url, 'https://weibo.com/7847210480/RpgfDebQV');
    eq('搜索页：正文取 .txt', posts[0].text, '53222【丑猫】晚上刷到的直播');

    eq('搜索页：「2分钟前 转赞人数超过100」→ 剥干净并归一',
      posts[1].date, ctx.normalizeDate('2分钟前 转赞人数超过100'));
    ok('搜索页：归一后的日期不含「转赞」', String(posts[1].date).indexOf('转赞') === -1, posts[1].date);
    eq('搜索页：`展开c` 尾巴被剥掉', posts[1].text, '今天拍到的小猫');

    // 长文展开后正文在 .txt-all，短帖只有 .txt
    const { w: w2 } = openDom(doc(searchCard({ body: '完整长文', txtCls: 'txt txt-all' })
      + searchCard({ mid: 'OTHER', body: '短帖' })), 'https://s.weibo.com/weibo?q=x');
    const cs2 = w2.WeiboFeedContext.findContainers();
    eq('长文用 .txt-all', w2.WeiboFeedContext.readPost(cs2[0]).text, '完整长文');
  }

  /* ============ 五、手机版 m.weibo.cn ============ */
  section('五、手机版读取：.card9 + 主世界桥属性');
  {
    const html = doc(mobileCard({}) + mobileCard({ payload: null }));
    const { w } = openDom(html, 'https://m.weibo.cn/');
    const ctx = w.WeiboFeedContext;

    eq('站点识别 mobile', ctx.getSite(), 'mobile');
    const cs = ctx.findContainers();
    eq('两个 .card9 都算容器', cs.length, 2);

    const p0 = ctx.readPost(cs[0]);
    eq('手机版：编号取桥属性', p0.mid, '5360401470719371');
    eq('手机版：作者ID 取桥属性', p0.uid, '1765335300');
    eq('手机版：昵称取桥属性', p0.nick, '黑桐谷歌');
    eq('手机版：日期把 C 语言式转成斜杠格式', p0.date, '2026/11/01 11:12');
    eq('手机版：全文取桥属性', p0.text, '喝药有技巧，在连招动作刚结束的时候喝药');
    eq('手机版：URL 拼成 weibo.com 永久地址', p0.url, 'https://weibo.com/1765335300/5360401470719371');

    eq('没有桥属性的卡片 → null（绝不靠猜挂按钮）', ctx.readPost(cs[1]), null);

    // 桥属性坏了 / 缺编号
    const { w: w2 } = openDom(doc(mobileCard({ payload: '{坏掉的 JSON' })
      + mobileCard({ payload: { nick: '没编号' } })), 'https://m.weibo.cn/');
    const cs2 = w2.WeiboFeedContext.findContainers();
    eq('桥属性是坏 JSON → null', w2.WeiboFeedContext.readPost(cs2[0]), null);
    eq('桥属性里没有 id → null', w2.WeiboFeedContext.readPost(cs2[1]), null);

    /* ---- v2.7.40：桥必须把 item.text 的 HTML 转成纯文本 ----
     * 真机事故（2026-11-01，v2.7.39）：手机版三条里两条的标题是
     * `什么值得买ahrefhttpsm-2026年11月01日1203` —— 因为 `item.text` 是
     * `【<a href="https://m.weibo.cn/search?...">#话题#</a>】正文` 这种带标签的 HTML，
     * 桥原样搬进属性，文案列和标题就都存了标签。 */
    const raw = openDom(doc(mobileCard({ payload: null })), 'https://m.weibo.cn/');
    const wb = raw.w;
    const card = wb.document.querySelector('.card9');
    card.__vue__ = {
      item: {
        id: '5360414138308752',
        mid: '5360414138308752',
        created_at: 'Sun Nov 01 12:03:05 +0800 2026',
        text: '【<a href="https://m.weibo.cn/search?containerid=1">#值得买才是双11#</a>】今年双11真香<br />第二段',
        user: { id: '1823348853', screen_name: '什么值得买' },
        item_category: 'status'
      }
    };
    const sEl = wb.document.createElement('script');
    sEl.textContent = fs.readFileSync(P.bridge, 'utf8');
    wb.document.documentElement.appendChild(sEl);
    sEl.remove();
    // jsdom 构造完时 readyState 仍是 'loading'，桥会等 DOMContentLoaded 才 scan；
    // 真机上这个事件早就过去了（脚本在 document_idle 注入）。这里补一次。
    if (!card.getAttribute('data-cm-wb')) {
      wb.document.dispatchEvent(new wb.Event('DOMContentLoaded'));
    }

    const wrote = card.getAttribute('data-cm-wb');
    ok('桥把 item 写进了 data-cm-wb', !!wrote);
    const data = wrote ? JSON.parse(wrote) : {};
    ok('桥：文案里不能残留 HTML 标签',
      String(data.text || '').indexOf('<') === -1 && String(data.text || '').indexOf('href') === -1,
      data.text);
    // `#话题#` 的井号由下游 SocialHashtagCleaner 统一洗（在全站出口那一处），桥只负责剥标签，
    // 别在这里顺手洗 —— 否则就多了一份话题规则。
    eq('桥：文案转成纯文本，<br /> 变空格（不粘成一个词）',
      data.text, '【#值得买才是双11#】今年双11真香 第二段');
    eq('桥：昵称照原样搬', data.nick, '什么值得买');
    eq('桥：编号照原样搬', data.id, '5360414138308752');
  }

  /* ============ 六、按钮组件 ============ */
  section('六、按钮组件：挂载 / 门禁 / 点击');
  {
    const html = doc(desktopPost({}) + desktopPost({ uid: '2', mid: 'BBBB', nick: '第二个人' }));
    const { w } = openDom(html, 'https://weibo.com/');
    const calls = [];
    const mgr = new w.WeiboFeedButtons({ onExtract: (t) => { calls.push(t); return true; } });
    mgr.start();

    const btns = w.document.querySelectorAll('.clipmate-weibo-feed-btn');
    eq('两条博文挂两颗按钮', btns.length, 2);
    eq('按钮挂在博文容器内部（不是 body）', btns[0].parentElement.tagName, 'ARTICLE');
    eq('按钮记着这条的编号', btns[0].getAttribute('data-mid'), 'RoJt40fZG');
    eq('容器被设为定位锚点', btns[0].parentElement.style.position, 'relative');
    ok('按钮在容器右上角（absolute 定位）', /position:absolute/.test(
      w.document.getElementById('clipmate-weibo-feed-style').textContent));

    // 点按钮
    btns[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    await sleep(30);
    eq('点一次只触发一次提取', calls.length, 1);
    ok('回调拿到的是「这一条」的容器', !!(calls[0] && calls[0].container && calls[0].post));
    eq('回调拿到的编号是这一条的', calls[0].post.mid, 'RoJt40fZG');

    mgr.stop();
    eq('stop() 后按钮全摘', w.document.querySelectorAll('.clipmate-weibo-feed-btn').length, 0);
    eq('stop() 后容器 position 还原', w.document.querySelector('article').style.position, '');

    // 只有 1 条 = 详情页 → 不挂
    const one = openDom(doc(desktopPost({})), 'https://weibo.com/5700117586/RoJt40fZG');
    const m1 = new one.w.WeiboFeedButtons({ onExtract: () => true });
    m1.start();
    eq('详情页只有 1 条博文 → 一颗都不挂', one.w.document.querySelectorAll('.clipmate-weibo-feed-btn').length, 0);
    m1.stop();
  }

  {
    // 搜索页：非博文卡片不许挂
    const html = doc(searchCard({}) + searchCard({ mid: 'X2', uid: '2' }) + NON_POST_CARD);
    const { w } = openDom(html, 'https://s.weibo.com/weibo?q=x');
    const mgr = new w.WeiboFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('搜索页：两颗按钮（非博文卡片没有）', w.document.querySelectorAll('.clipmate-weibo-feed-btn').length, 2);
    mgr.stop();
  }

  {
    // 手机版：没桥数据就一颗都不挂
    const html = doc(mobileCard({}) + mobileCard({ payload: null }));
    const { w } = openDom(html, 'https://m.weibo.cn/');
    const mgr = new w.WeiboFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('手机版：只有 1 条带编号 → 不足 2 条，一颗都不挂',
      w.document.querySelectorAll('.clipmate-weibo-feed-btn').length, 0);
    mgr.stop();
  }

  {
    // 站点门禁：别的网站不干活
    const { w } = openDom(doc(desktopPost({}) + desktopPost({ mid: 'B', uid: '2' })), 'https://www.douyin.com/');
    const mgr = new w.WeiboFeedButtons({ onExtract: () => true });
    mgr.start();
    eq('非微博站点 → 一颗都不挂', w.document.querySelectorAll('.clipmate-weibo-feed-btn').length, 0);
    eq('非微博站点 → 连样式都不注入', w.document.getElementById('clipmate-weibo-feed-style'), null);
  }

  {
    // v2.7.42：搜索页逐卡锚点。同一页卡片高度不齐 —— 带「热门」条的「⋯」在 top 55，
    // 不带的在 top 21，写死 top 50 就会在后者身上压到正文第一行
    // （真机实证：搜 `Gufei_GF` 时 `QivYUligt` 那条的 `@某人` 链接被压住 3px）。
    const { w } = openDom(doc(searchCard({}) + searchCard({ mid: 'X2', uid: '2' })), 'https://s.weibo.com/weibo?q=x');
    const cards = w.document.querySelectorAll('.card-wrap');
    [55, 21].forEach((menuTop, i) => {
      const card = cards[i];
      const menu = w.document.createElement('div');
      menu.className = 'menu';                       // 真机：颗「⋯」的外层
      // 真机里两者都是视口坐标，卡片顶在 100 → 菜单顶 = 100 + 卡片内偏移
      menu.getBoundingClientRect = () => ({ top: 100 + menuTop, bottom: 115 + menuTop, height: 15, width: 18, left: 600, right: 618 });
      card.querySelector('.content').appendChild(menu);
      card.getBoundingClientRect = () => ({ top: 100, bottom: 600, height: 500, width: 642, left: 0, right: 642 });
    });

    const mgr = new w.WeiboFeedButtons({ onExtract: () => true });
    mgr.start();
    const b1 = w.document.querySelector('.clipmate-weibo-feed-btn[data-mid="RpgfDebQV"]');
    const b2 = w.document.querySelector('.clipmate-weibo-feed-btn[data-mid="X2"]');
    eq('带「热门」条：跟自己的「⋯」居中 → top 50px', b1.style.top, '50px');
    eq('不带「热门」条：跟自己的「⋯」居中 → top 16px', b2.style.top, '16px');
    ok('两张卡片算出不一样的高度（证明是逐卡算的，不是写死的）', b1.style.top !== b2.style.top);
    mgr.stop();

    // 没有「⋯」的卡片 → 算不出来，退回 CSS 固定值（不加内联 top）
    const { w: w2 } = openDom(doc(searchCard({}) + searchCard({ mid: 'X3', uid: '3' })), 'https://s.weibo.com/weibo?q=x');
    const m2 = new w2.WeiboFeedButtons({ onExtract: () => true });
    m2.start();
    eq('找不到「⋯」→ 不加内联 top（用样式表兜底）',
      w2.document.querySelector('.clipmate-weibo-feed-btn').style.top, '');
    m2.stop();

    // 别的站不吃这一套：桌面版 / 手机版都不能被搜索页的规则影响
    const dt = openDom(doc(desktopPost({})), 'https://weibo.com/');
    eq('桌面版不走逐卡锚点',
      new dt.w.WeiboFeedButtons({ onExtract: () => true })._anchorTop(dt.w.document.querySelector('article')), null);
  }

  /* ============ 七、提取器契约（从 extractAllFields 进） ============ */
  section('七、提取器契约：必须从 extractAllFields 进');
  {
    const html = doc(
      desktopPost({ mid: 'RoJt40fZG', body: '故地重游就是刻舟求剑' })
      + desktopPost({
        uid: '5440374917', mid: 'Rpfv1oUHH', nick: 'BtoZ-Movie',
        title: '2026-10-31 20:24', timeText: '15小时前', body: ''
      })
    );
    const { w } = openDom(html, 'https://weibo.com/', CHAIN);
    const ctx = w.WeiboFeedContext;
    const cs = ctx.findContainers();
    const ex = new w.WeiboSocialExtractor();

    const rec = await ex.extractAllFields({ feedPost: { container: cs[0], post: ctx.readPost(cs[0]) } });
    eq('6 列：作者ID', rec['作者ID'], '5700117586');
    eq('6 列：作者昵称', rec['作者昵称'], '天天超级烦');
    eq('6 列：作者主页', rec['作者主页'], 'https://weibo.com/u/5700117586');
    eq('6 列：发布日期', rec['发布日期'], '2026/10/28 10:51');
    eq('6 列：本页文案', rec['本页文案'], '故地重游就是刻舟求剑');
    eq('6 列：URL 是这条博文', rec['URL'], 'https://weibo.com/5700117586/RoJt40fZG');
    eq('6 列：标题 = 昵称+文案前20字+日期（与全站口径一致，含时分）',
      rec['本页标题'], '天天超级烦故地重游就是刻舟求剑-2026年10月28日1051');
    eq('6 列：站点标识', rec.sourceSite, 'weibo_social');

    // 纯转发：文案为空 → 站名占位「微博博文」，标题同步改写（v2.7.38 兜底必须够得着）
    const rec2 = await ex.extractAllFields({ feedPost: { container: cs[1], post: ctx.readPost(cs[1]) } });
    eq('纯转发帖：文案用站名顶上', rec2['本页文案'], '微博博文');
    eq('纯转发帖：标题也用站名顶上（不是空、不是「无文案」）',
      rec2['本页标题'], 'BtoZ-Movie微博博文-2026年10月31日2024');
    ok('纯转发帖：标题里没有「无文案」三个字', String(rec2['本页标题']).indexOf('无文案') === -1);

    // 列表页点全局按钮：不许再拼「第一条正文 + 列表页地址」
    const recList = await ex.extractAllFields();
    eq('列表页全局按钮：URL 变成第一条博文的永久地址',
      recList['URL'], 'https://weibo.com/5700117586/RoJt40fZG');
    eq('列表页全局按钮：作者ID 也是第一条的', recList['作者ID'], '5700117586');

    // 详情页（只 1 条）→ 维持原来的整页取值，不许崩
    const one = openDom(doc(desktopPost({})), 'https://weibo.com/5700117586/RoJt40fZG', CHAIN);
    const recOne = await new one.w.WeiboSocialExtractor().extractAllFields();
    ok('详情页仍走整页取值（不抛错、有记录）', !!recOne && typeof recOne === 'object');
  }

  {
    // 手机版提取器
    const html = doc(mobileCard({}));
    const { w } = openDom(html, 'https://m.weibo.cn/', CHAIN);
    const ctx = w.WeiboFeedContext;
    const el = ctx.findContainers()[0];
    const rec = await new w.WeiboMobileSocialExtractor()
      .extractAllFields({ feedPost: { container: el, post: ctx.readPost(el) } });
    eq('手机版 6 列：作者ID', rec['作者ID'], '1765335300');
    eq('手机版 6 列：昵称', rec['作者昵称'], '黑桐谷歌');
    eq('手机版 6 列：日期', rec['发布日期'], '2026/11/01 11:12');
    eq('手机版 6 列：URL', rec['URL'], 'https://weibo.com/1765335300/5360401470719371');
    eq('手机版 6 列：站点标识', rec.sourceSite, 'weibo_mobile_social');
    ok('手机版 6 列：标题带昵称开头', String(rec['本页标题']).indexOf('黑桐谷歌') === 0, rec['本页标题']);
  }

  /* ============ 八、注入与清单 ============ */
  section('八、注入范围与清单（搜索页 / 手机版桥）');
  {
    const mf = JSON.parse(fs.readFileSync(P.manifest, 'utf8'));
    ok('host_permissions 覆盖 s.weibo.com（搜索页）',
      (mf.host_permissions || []).indexOf('https://s.weibo.com/*') > -1);
    ok('host_permissions 仍有 m.weibo.cn（手机版）',
      (mf.host_permissions || []).indexOf('https://m.weibo.cn/*') > -1);

    const main = (mf.content_scripts || [])[0];
    ok('主 content_scripts 覆盖 s.weibo.com',
      (main.matches || []).indexOf('https://s.weibo.com/*') > -1);

    const js = main.js || [];
    const iCtx = js.indexOf('src/content/shared/weibo-feed-context.js');
    const iBtn = js.indexOf('src/content/ui/weibo-feed-buttons.js');
    const iMixin = js.indexOf('src/content/ui/weibo-spa-handler.js');
    ok('上下文脚本已注册', iCtx > -1);
    ok('按钮脚本已注册', iBtn > -1);
    ok('mixin 已注册', iMixin > -1);
    ok('上下文必须排在按钮之前（按钮启动就要用）', iCtx > -1 && iBtn > -1 && iCtx < iBtn);
    ok('按钮必须排在 mixin 之前', iBtn > -1 && iMixin > -1 && iBtn < iMixin);

    const mainWorld = (mf.content_scripts || []).filter((c) => c.world === 'MAIN'
      && (c.matches || []).some((u) => u.indexOf('m.weibo.cn') > -1));
    eq('手机版桥注册为主世界脚本', mainWorld.length, 1);
    eq('手机版桥只注入 m.weibo.cn', JSON.stringify(mainWorld[0].matches), '["https://m.weibo.cn/*"]');
    eq('手机版桥的脚本名', JSON.stringify(mainWorld[0].js), '["src/content/weibo-mobile-bridge.js"]');

    /* ---- v2.7.40：搜索页三处配置必须齐全 ----
     * v2.7.39 只改了 manifest（注入范围），漏了这三处 —— 结果页面照挂按钮、
     * 点下去却按「整页通用提取」跑，浮窗 6 列全空（真机实证）。 */
    const det = fs.readFileSync(P.detector, 'utf8');
    const bg = fs.readFileSync(P.background, 'utf8');
    const fac = fs.readFileSync(P.factory, 'utf8');

    // 注意：不能只查 `'s.weibo.com'` 在不在文件里 —— 这个文件下面还有一处
    // hostname 特判同样写着它，删掉类型表照样命中，那条断言会变成假绿（变异 ⑥ 实证）。
    ok('media-detector 的类型表有 s.weibo.com',
      /'s\.weibo\.com':\s*\{\s*\n\s*type: 'social'/.test(det));
    ok('media-detector 的 hostname 特判有 s.weibo.com',
      /hostname === 's\.weibo\.com'/.test(det));
    ok('background 的 getMediaConfigs 有 s.weibo.com',
      /'s\.weibo\.com':\s*\{\s*\n\s*type: 'social'/.test(bg));
    ok('extractor-factory 注册表把 s.weibo.com 指给微博社交提取器',
      /hostname: 's\.weibo\.com', types: \['social'\]/.test(fac));
    ok('extractor-factory 的 urlPattern 有 s.weibo.com', /pattern: \/s\\\.weibo\\\.com\\\//.test(fac));
    // 顺序有讲究：`s.weibo.com` 自身含 `weibo.com/`，排到通配规则后面会被先吃掉。
    // 两个 index 都必须命中（-1 会让「-1 < n」恒真，变成假绿）。
    const iS = fac.indexOf("hostname: 's.weibo.com', mediaType: 'social'");
    const iW = fac.indexOf("hostname: 'weibo.com', mediaType: 'social'");
    ok('s.weibo.com 的 urlPattern 必须排在 weibo.com 通配之前',
      iS > -1 && iW > -1 && iS < iW, { iS, iW });
  }

  /* ============ 九、桥脚本纪律 ============ */
  section('九、主世界桥的纪律（只写属性、只听 childList）');
  {
    const src = fs.readFileSync(P.bridge, 'utf8');
    ok('只写 data-cm-wb 一个属性', src.indexOf("'data-cm-wb'") > -1);
    ok('监听 childList，不监听 attributes（否则自己写属性会自激）',
      /childList:\s*true/.test(src) && !/attributes:\s*true/.test(src));
    ok('拿不到 Vue 实例就什么都不写（宁可没按钮，也不挂错的）',
      src.indexOf('if (!item) return false;') > -1);
    ok('非 status 类别（广告/推荐位）跳过', src.indexOf("item_category !== 'status'") > -1);
    ok('不发网络请求', !/\bfetch\s*\(/.test(src) && !/XMLHttpRequest/.test(src));
  }

  /* ============ 十、逐帖提取强制 social ============ */
  section('十、逐帖提取必须强制走 social（作者主页那条路）');
  {
    /* 真机事故（2026-11-01，v2.7.39）：微博作者主页 `weibo.com/u/<uid>` 整页类型是
     * person，按地址匹配选到「人物档案提取器」，它不认识 feedPost —— 点博文按钮
     * 弹出来的是 6 列空表。所以逐帖这条路上必须强制指定 social。 */
    const h = fs.readFileSync(P.handler, 'utf8');
    ok('点按钮时传了 forceMediaType: social', /forceMediaType:\s*'social'/.test(h));
    ok('forceMediaType 与 feedPost 在同一次 handleExtract 调用里',
      /feedPost:[\s\S]{0,200}?forceMediaType:\s*'social'/.test(h));

    const m = fs.readFileSync(P.main, 'utf8');
    ok('extractFromCurrentPage 会读 extraOpts.forceMediaType',
      /extraOpts\s*&&\s*extraOpts\.forceMediaType/.test(m));
    ok('forcedMediaType 覆盖 mediaType（不覆盖的话 processData 还是按 person 跑）',
      /const mediaType = forcedMediaType \|\| this\.detectMediaType\(\)/.test(m));

    // 顺序是这条的命门：强制类型必须在 URL 匹配**之前**取到提取器
    const iForce = m.indexOf('if (forcedMediaType) {');
    const iUrl = m.indexOf('extractor = this.extractorFactory.getExtractorByUrl(window.location.href);');
    ok('强制类型优先于 URL 匹配（否则一律被 person 规则抢走）',
      iForce > -1 && iUrl > -1 && iForce < iUrl, { iForce, iUrl });
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
