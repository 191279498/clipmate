/**
 * 小红书「全站动态适配」——路由与按钮显隐（v2.6.0）
 *
 * 背景（2026-10-29 真机勘察，接管已登录 Edge 实测）：
 *   小红书笔记详情**永远是弹层**（`.note-detail-mask`），点开/关闭只改地址不换文档。
 *   所以 content script 只在首次加载的那一页注入过，之后的站内跳转全靠轮询地址跟随。
 *
 *   实测的现状矩阵（v2.5.100）：
 *     /explore 首页列表            → 有按钮，点下去**报错**「未找到提取器」
 *     首页点开笔记（站内跳转）      → 有按钮，能提取，但文案尾巴脏
 *     /search_result               → **整页没注入**，没按钮
 *     搜索页点开笔记                → **没有按钮**（最常用的一条路）
 *     /user/profile/<id>           → v2.7.16 起**可提取**（人物档案 6 列），有按钮
 *     用户主页点开笔记              → **没有按钮**（v2.5.101 的老问题，仍未解决）
 *     关掉弹层回 /explore          → 按钮**残留**，点了报错
 *
 * 本文件钉住的契约
 * ----------------
 *   A. 路由判定：`/explore/<24位hex>` 或 `/discovery/item/<24位hex>` = 有当前笔记；
 *      `/user/profile/<24位hex>` = 个人主页（v2.7.16 起可提取，路由键 `profile:<id>`）；
 *      `/explore`、`/search_result`、`/board/*` 等 = 列表页，路由键为空
 *      （**主页地址里也是 24 位 hex，最容易被误判成笔记，这里专门钉住**）
 *   B. 显隐跟随：列表页藏 → 进笔记页恢复 → 退回列表页再藏
 *   C. 不越权：配置里关掉的按钮不会被打开；只恢复自己藏的那次
 *   D. 浮窗同关：列表页上按钮藏了，浮窗必须一起关（v2.5.101 的教训）
 *   E. 站点门禁：这份 mixin 挂在**共享原型**上、注入覆盖全站，
 *      别的网站必须一律放行（否则全站浮窗消失）
 *   F. 接线：manifest 注入范围、脚本注册顺序、content-main 的汇总器
 *
 * 反向验证清单在文件末尾。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const SRC_PATH = path.join(ROOT, 'src/content/ui/xiaohongshu-spa-handler.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) {
  fail++;
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function truthy(name, got) { if (got) return ok(name); else bad(name, `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got) { if (!got) return ok(name); else bad(name, `期望假值，实得 ${JSON.stringify(got)}`); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/* 真机抄下来的原样地址（令牌一个字都没改） */
const NOTE_A = 'https://www.xiaohongshu.com/explore/6adad8a9000000002b001cb2?xsec_token=ABSxZ3447qRAKPcDQ0Xj20KQaY6kPZmDW2Lz8101O_c0A=&xsec_source=pc_feed';
const NOTE_B = 'https://www.xiaohongshu.com/explore/69e089a4000000002200066c?xsec_token=ABxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=&xsec_source=pc_search';
const ID_A = '6adad8a9000000002b001cb2';
const EXPLORE = 'https://www.xiaohongshu.com/explore';
const SEARCH = 'https://www.xiaohongshu.com/search_result?keyword=%E7%BE%8E%E9%A3%9F&source=web_search_result_notes';
const PROFILE = 'https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568';
const PROFILE_ID = '6745e0e60000000001003568';

/* -------------------------------------------------------------------------- */
/* 沙箱：只喂 mixin 需要的那几个全局                                             */
/* -------------------------------------------------------------------------- */
function loadSpa(href, hostname) {
  const loc = { hostname: hostname || 'www.xiaohongshu.com', href: href || EXPLORE };
  const win = { addEventListener() {}, innerWidth: 1440, innerHeight: 900 };
  win.window = win;
  win.location = loc;
  const doc = {
    getElementById: () => null,
    querySelector: () => null,
    documentElement: { clientWidth: 1440, clientHeight: 900 }
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'setInterval', 'clearInterval', 'setTimeout', SRC)(
    win, doc, loc, () => 0, () => {}, () => 0
  );
  return { mixin: win.XiaohongshuSpaMixin, location: loc };
}

function makeButton() {
  return {
    style: {},
    offsetWidth: 96,
    offsetHeight: 40,
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
}

/** 假 ButtonManager：记下每一次显隐调用，方便断言「调用了几次」而不只是「最后是什么」 */
function makeButtonManager(visible) {
  return {
    button: makeButton(),
    isVisible: visible,
    userMoved: false,
    calls: [],
    setVisible(v) { this.calls.push(v); this.isVisible = v; }
  };
}

/** 假浮窗管理器：只关心「关了几次、现在开着没」 */
function makeModal(open) {
  return {
    isOpen: !!open,
    closed: 0,
    close() { this.closed++; this.isOpen = false; }
  };
}

/**
 * 造一套「浏览器环境 + 组件实例」
 * @param {Object} [opts]
 * @param {string} [opts.href] - 初始地址
 * @param {string} [opts.hostname] - 初始域名
 * @param {boolean} [opts.visible=true] - 按钮初始可见性
 * @param {boolean} [opts.noButton=false] - buttonManager 存在但按钮还没建出来
 * @param {boolean} [opts.noManager=false] - 压根没有 buttonManager
 * @param {boolean} [opts.modalOpen=true] - 浮窗初始开着
 */
function makeEnv(opts) {
  const o = opts || {};
  const href = o.href || EXPLORE;
  const env = loadSpa(href, o.hostname);
  const host = Object.assign({}, env.mixin);
  host._xhsLastHref = href;
  // 真实运行时由 _startXhsSpa 初始化成 false；这里照抄，免得断言拿到 undefined
  host._xhsRouteHidden = false;

  let bm = null;
  if (!o.noManager) {
    bm = makeButtonManager(o.visible === undefined ? true : o.visible);
    if (o.noButton) bm.button = null;
  }
  host.buttonManager = bm;
  host.modalManager = makeModal(o.modalOpen === undefined ? true : o.modalOpen);

  return {
    host: host,
    location: env.location,
    bm: bm,
    /** 把地址换掉再跑一拍轮询（模拟真实站内跳转） */
    go(nextHref, nextHostname) {
      env.location.href = nextHref;
      if (nextHostname) env.location.hostname = nextHostname;
      host._checkXhsRoute();
    }
  };
}

/* ========================================================================== */
function main() {
  section('一、路由判定：哪些页面有「当前笔记」');

  {
    const { host } = makeEnv({ href: NOTE_A });
    const yes = [
      ['笔记页（探索入口，带令牌）', NOTE_A, ID_A],
      ['笔记页（搜索入口，带令牌）', NOTE_B, '69e089a4000000002200066c'],
      ['笔记页（无令牌）', 'https://www.xiaohongshu.com/explore/' + ID_A, ID_A],
      ['笔记页（令牌在最前）', 'https://www.xiaohongshu.com/explore/' + ID_A + '?xsec_token=abc#top', ID_A],
      ['笔记页（大写 ID 也认）', 'https://www.xiaohongshu.com/explore/' + ID_A.toUpperCase(), ID_A.toUpperCase()],
      ['老地址 /discovery/item/', 'https://www.xiaohongshu.com/discovery/item/' + ID_A, ID_A],
      ['顶域没有 www', 'https://xiaohongshu.com/explore/' + ID_A, ID_A]
    ];
    for (const [label, href, wantId] of yes) {
      eq(label + ' → 笔记ID', host._xhsNoteIdFromHref(href), wantId);
      eq(label + ' → 路由键', host._xhsRouteKeyFromHref(href), 'note:' + wantId);
    }
  }

  {
    const { host } = makeEnv({ href: EXPLORE });
    const no = [
      ['探索首页（列表）', EXPLORE],
      ['探索首页带斜杠', EXPLORE + '/'],
      ['探索首页带参数', EXPLORE + '?channel_id=homefeed_recommend'],
      ['搜索页', SEARCH],
      ['话题/板块页', 'https://www.xiaohongshu.com/board/1234abcd'],
      ['通知页', 'https://www.xiaohongshu.com/notification'],
      ['消息页', 'https://www.xiaohongshu.com/messages'],
      ['根路径', 'https://www.xiaohongshu.com/'],
      // ID 不够 24 位 / 不是十六进制 → 不是笔记
      ['笔记 ID 太短', 'https://www.xiaohongshu.com/explore/6adad8a9'],
      ['笔记 ID 含非法字符', 'https://www.xiaohongshu.com/explore/zzzzzzzzzzzzzzzzzzzzzzzz'],
      // ID 凑够 24 位但后面还粘着别的字符 → 不是笔记（正则必须有结尾锚点）
      ['笔记 ID 后面还粘着字符', 'https://www.xiaohongshu.com/explore/' + ID_A + 'extra'],
      ['笔记 ID 后面粘着路径', 'https://www.xiaohongshu.com/explore/' + ID_A + '/comment'],
      // 别的网站同名路径不能认（这份 mixin 注入全站）
      ['豆瓣同名路径', 'https://book.douban.com/explore/' + ID_A],
      ['TikTok 作品页', 'https://www.tiktok.com/@x/video/7688932324901145870']
    ];
    for (const [label, href] of no) {
      eq(label + ' → 不当成笔记', host._xhsNoteIdFromHref(href), '');
      eq(label + ' → 路由键为空', host._xhsRouteKeyFromHref(href), '');
    }
  }

  {
    // v2.7.16：个人主页**本身可提取**（人物档案 6 列），路由键从「空」变成 `profile:<id>`。
    // ⚠ 主页地址里也是 24 位 hex，最容易跟笔记混淆，两件事分开钉：
    //   · 它不是笔记（`_xhsNoteIdFromHref` 必须还是空，否则会按笔记去提）
    //   · 但它是可提取目标（路由键非空，否则按钮被当成列表页藏掉）
    const { host } = makeEnv({ href: EXPLORE });
    const prof = [
      ['用户主页', PROFILE, PROFILE_ID],
      ['用户主页带参数', PROFILE + '?xsec_token=abc&xsec_source=pc_search', PROFILE_ID]
    ];
    for (const [label, href, wantId] of prof) {
      eq(label + ' → 不当成笔记（主页不是笔记）', host._xhsNoteIdFromHref(href), '');
      eq(label + ' → 路由键 = profile:<id>（按钮要出）', host._xhsRouteKeyFromHref(href), 'profile:' + wantId);
    }
  }

  {
    // 老地址真的被跳转过，但写法上要容错：`/discovery/item/<id>` 后面直接跟 `?`
    const { host } = makeEnv({ href: EXPLORE });
    eq('老地址带查询串', host._xhsNoteIdFromHref('https://www.xiaohongshu.com/discovery/item/' + ID_A + '?xsec_token=x'), ID_A);
    eq('老地址带锚点', host._xhsNoteIdFromHref('https://www.xiaohongshu.com/discovery/item/' + ID_A + '#a'), ID_A);
  }

  /* ---------------------------------------------------------------------- */
  section('二、显隐跟随：列表页藏 → 进笔记页显示 → 退回再藏');

  {
    // 起点：探索首页（列表页）—— 按钮必须被藏起来
    const e = makeEnv({ href: EXPLORE, visible: true });
    e.host._syncXhsRouteVisibility();
    eq('探索首页 → 按钮隐藏', e.bm.isVisible, false);
    eq('探索首页 → 记下「是我藏的」', e.host._xhsRouteHidden, true);
    eq('探索首页 → setVisible 只调一次', e.bm.calls.length, 1);

    // 再次同步（轮询会重复跑）→ 不重复调用，也不报错
    e.host._syncXhsRouteVisibility();
    eq('重复同步 → 幂等（不再调 setVisible）', e.bm.calls.length, 1);

    // 进笔记页 → 恢复
    e.go(NOTE_A);
    eq('进笔记页 → 按钮恢复', e.bm.isVisible, true);
    eq('进笔记页 → 清掉隐藏标记', e.host._xhsRouteHidden, false);

    // 再退回列表页 → 又藏
    e.go(EXPLORE);
    eq('退回列表页 → 按钮再藏', e.bm.isVisible, false);
  }

  {
    // 直接打开笔记页（最常见）→ 一上来就该是可见的，不能被藏
    const e = makeEnv({ href: NOTE_A, visible: true });
    e.host._syncXhsRouteVisibility();
    eq('直接打开笔记页 → 按钮保持可见', e.bm.isVisible, true);
    eq('直接打开笔记页 → 一次 setVisible 都不调', e.bm.calls.length, 0);
  }

  {
    // 换笔记（A → B）：都可见，不该有任何闪断
    const e = makeEnv({ href: NOTE_A, visible: true });
    e.go(NOTE_B);
    eq('笔记 A → 笔记 B：按钮一直可见', e.bm.isVisible, true);
    eq('笔记 A → 笔记 B：不调 setVisible（不闪）', e.bm.calls.length, 0);
    eq('笔记 A → 笔记 B：浮窗被关（换了一条）', e.host.modalManager.closed, 1);
  }

  {
    // 搜索页 → 点开笔记（用户最常用、v2.5.101 完全没按钮的那条路）
    const e = makeEnv({ href: SEARCH, visible: true });
    e.host._syncXhsRouteVisibility();
    eq('搜索页 → 按钮隐藏', e.bm.isVisible, false);
    e.go(NOTE_B);
    eq('搜索页点开笔记 → 按钮出现（关键修复）', e.bm.isVisible, true);
    e.go(SEARCH);
    eq('从笔记退回搜索页 → 按钮再藏', e.bm.isVisible, false);
  }

  {
    // 用户主页 → 点开笔记
    const e = makeEnv({ href: PROFILE, visible: true });
    e.host._syncXhsRouteVisibility();
    // v2.7.16：主页本身就能提取（人物档案），按钮**必须**在
    eq('用户主页 → 按钮出现（v2.7.16 起主页可提取）', e.bm.isVisible, true);
    e.go(NOTE_A);
    eq('主页点开笔记 → 按钮仍在', e.bm.isVisible, true);
  }

  /* ---------------------------------------------------------------------- */
  section('三、不越权：配置关掉的按钮不许被打开');

  {
    // 用户在设置里关掉了按钮 —— 列表页那拍按钮状态也是 false
    const e = makeEnv({ href: EXPLORE, visible: false });
    e.host._syncXhsRouteVisibility();
    eq('配置关掉 + 列表页 → 不调 setVisible（不抢方向盘）', e.bm.calls.length, 0);
    eq('配置关掉 + 列表页 → 不记隐藏标记', e.host._xhsRouteHidden, false);

    // 进笔记页也不许擅自打开
    e.go(NOTE_A);
    eq('配置关掉 + 进笔记页 → 仍然不打开', e.bm.isVisible, false);
    eq('配置关掉 + 进笔记页 → 一次都没调', e.bm.calls.length, 0);
  }

  {
    // 别处（比如配置变更）先藏了按钮，但不是我们藏的 → 我们无权恢复
    const e = makeEnv({ href: EXPLORE, visible: true });
    e.bm.setVisible(false);           // 模拟配置刚关掉
    e.bm.calls.length = 0;            // 清掉记录，只看本模块的动作
    e.host._xhsRouteHidden = false;   // 不是我们藏的
    e.go(NOTE_A);
    eq('不是自己藏的 → 不擅自恢复', e.bm.calls.length, 0);
    eq('不是自己藏的 → 按钮仍然关着', e.bm.isVisible, false);
  }

  /* ---------------------------------------------------------------------- */
  section('四、浮窗同关：按钮藏了浮窗不能留（v2.5.101 的教训）');

  {
    const e = makeEnv({ href: NOTE_A, visible: true, modalOpen: true });
    e.host._syncXhsRouteVisibility();
    eq('笔记页同步 → 浮窗不动', e.host.modalManager.closed, 0);

    e.go(EXPLORE);
    eq('退回列表页 → 浮窗被关', e.host.modalManager.closed, 1);
    eq('退回列表页 → 浮窗确实关了', e.host.modalManager.isOpen, false);
  }

  {
    // 浮窗本来就没开 → 不该多调 close（close 会重绘整个窗口）
    const e = makeEnv({ href: NOTE_A, visible: true, modalOpen: false });
    e.go(EXPLORE);
    eq('浮窗没开 → 不调 close', e.host.modalManager.closed, 0);
  }

  {
    // 按钮还没建出来（initComponents 慢一拍）：浮窗照样要关
    const e = makeEnv({ href: NOTE_A, noButton: true, modalOpen: true });
    e.go(EXPLORE);
    eq('按钮未建 + 退回列表页 → 浮窗仍然被关', e.host.modalManager.closed, 1);
  }

  {
    // 压根没有 buttonManager（showButton 全关）：浮窗照样要关
    const e = makeEnv({ href: NOTE_A, noManager: true, modalOpen: true });
    e.go(EXPLORE);
    eq('没有按钮管理器 + 退回列表页 → 浮窗仍然被关', e.host.modalManager.closed, 1);
  }

  {
    // 配置关掉按钮的用户：按钮一直不可见，但浮窗开了还是得关
    const e = makeEnv({ href: NOTE_A, visible: false, modalOpen: true });
    e.go(EXPLORE);
    eq('配置关掉按钮 + 退回列表页 → 浮窗仍然被关', e.host.modalManager.closed, 1);
  }

  {
    // close() 自己抛错 → 不能把按钮一起带下水
    const e = makeEnv({ href: NOTE_A, visible: true, modalOpen: true });
    e.host.modalManager.close = () => { throw new Error('close boom'); };
    let threw = null;
    try { e.go(EXPLORE); } catch (err) { threw = err; }
    eq('关闭浮窗抛错 → 异常不外泄', threw, null);
    eq('关闭浮窗抛错 → 按钮照常藏', e.bm.isVisible, false);
  }

  /* ---------------------------------------------------------------------- */
  section('五、提取途中离开：结果回来不许在列表页弹窗');

  {
    const { host } = makeEnv({ href: NOTE_A });
    eq('笔记页 → 照常弹窗', host._xhsShouldSuppressModal(), false);

    const { host: h2 } = makeEnv({ href: EXPLORE });
    eq('探索首页 → 拦下弹窗', h2._xhsShouldSuppressModal(), true);

    const { host: h3 } = makeEnv({ href: SEARCH });
    eq('搜索页 → 拦下弹窗', h3._xhsShouldSuppressModal(), true);

    const { host: h4 } = makeEnv({ href: PROFILE });
    // v2.7.16：主页是可提取目标，提取结果回来**要**弹窗（不拦）
    eq('用户主页 → 不拦弹窗', h4._xhsShouldSuppressModal(), false);
  }

  {
    const { host } = makeEnv({ href: EXPLORE });
    host._xhsRouteKeyFromHref = () => { throw new Error('boom'); };
    eq('判定抛错 → 放行（宁可多弹一次，也别把数据吞掉）', host._xhsShouldSuppressModal(), false);
  }

  {
    // ⚠ 这一段是保命的：这份 mixin 在 content-main 里被 Object.assign 到
    // **MediaExtractor.prototype**（共享原型），而 manifest 那条 content_scripts
    // 覆盖豆瓣 / B站 / 抖音 / 快手 / MobyGames 等全站 —— 别的网站也会调到这里。
    // 不加站点门禁的话，非小红书地址在 _xhsRouteKeyFromHref 里只会返回 ''，
    // 等于「除小红书外所有网站永远不弹窗」。
    const others = [
      ['豆瓣书籍页', 'https://book.douban.com/subject/1234567/', 'book.douban.com'],
      ['豆瓣电影页', 'https://movie.douban.com/subject/1292052/', 'movie.douban.com'],
      ['B站视频页', 'https://www.bilibili.com/video/BV1xx411c7mD', 'www.bilibili.com'],
      ['MobyGames 游戏页', 'https://www.mobygames.com/game/123/foo', 'www.mobygames.com'],
      ['快手作品页', 'https://www.kuaishou.com/short-video/3xabc', 'www.kuaishou.com'],
      ['抖音作品页', 'https://www.douyin.com/video/7411950642865917225', 'www.douyin.com'],
      ['TikTok 探索页', 'https://www.tiktok.com/explore', 'www.tiktok.com'],
      ['微博正文页', 'https://weibo.com/1234/AbCdEf', 'weibo.com'],
      // 域名看着像但不是（子域后缀不能蒙混过关）
      ['钓鱼域名 xiaohongshu.com.evil.com', 'https://www.xiaohongshu.com.evil.com/explore', 'www.xiaohongshu.com.evil.com'],
      ['钓鱼域名 notxiaohongshu.com', 'https://notxiaohongshu.com/explore', 'notxiaohongshu.com']
    ];
    for (const [label, href, hostname] of others) {
      const { host: h } = makeEnv({ href, hostname });
      eq(label + ' → 一律放行（不受小红书门禁影响）', h._xhsShouldSuppressModal(), false);
    }

    // 子域名要认：m.xiaohongshu.com 也是小红书
    const { host: mHost } = makeEnv({ href: 'https://m.xiaohongshu.com/explore', hostname: 'm.xiaohongshu.com' });
    eq('m.xiaohongshu.com 探索页 → 仍然拦下', mHost._xhsShouldSuppressModal(), true);
    // 顶域也要认
    const { host: topHost } = makeEnv({ href: 'https://xiaohongshu.com/explore', hostname: 'xiaohongshu.com' });
    eq('顶域 xiaohongshu.com 探索页 → 仍然拦下', topHost._xhsShouldSuppressModal(), true);
  }

  /* ---------------------------------------------------------------------- */
  section('六、启动门禁：不是小红书就一个定时器都不挂');

  {
    let timers = 0;
    const loc = { hostname: 'book.douban.com', href: 'https://book.douban.com/subject/1/' };
    const win = { addEventListener() {} };
    win.window = win;
    win.location = loc;
    const doc = { getElementById: () => null, querySelector: () => null, documentElement: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'setInterval', 'clearInterval', 'setTimeout', SRC)(
      win, doc, loc, () => { timers++; return 1; }, () => {}, () => 0
    );
    const host = Object.assign({}, win.XiaohongshuSpaMixin);
    const started = host._startXhsSpa();
    eq('豆瓣页面 → 不启动', started, false);
    eq('豆瓣页面 → 不挂轮询', timers, 0);
    eq('豆瓣页面 → 不标记已启动', host._xhsSpaStarted, undefined);
  }

  {
    let timers = 0;
    const loc = { hostname: 'www.xiaohongshu.com', href: NOTE_A };
    const win = { addEventListener() {} };
    win.window = win;
    win.location = loc;
    const doc = { getElementById: () => null, querySelector: () => null, documentElement: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', 'location', 'setInterval', 'clearInterval', 'setTimeout', SRC)(
      win, doc, loc, () => { timers++; return 1; }, () => {}, () => 0
    );
    const host = Object.assign({}, win.XiaohongshuSpaMixin);
    host.buttonManager = makeButtonManager(true);
    host.modalManager = makeModal(false);

    eq('小红书页面 → 启动成功', host._startXhsSpa(), true);
    eq('小红书页面 → 挂了 1 个轮询', timers, 1);
    eq('第二次调用 → 幂等（不再挂第二个）', host._startXhsSpa(), true);
    eq('第二次调用 → 仍然只有 1 个轮询', timers, 1);

    host._stopXhsSpa();
    eq('停止后标记复位', host._xhsSpaStarted, false);
  }

  /* ---------------------------------------------------------------------- */
  section('七、结构：关键语句写在正确的位置');

  // 1) 地址一变先同步显隐，且必须在 `if (!curKey || ...) return` **之前**。
  //    从笔记退回列表时 curKey 是空串，写在 return 之后那行就永远走不到（TikTok v2.5.100 踩过）。
  const checkBody = (SRC.match(/_checkXhsRoute\s*\(\s*\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  truthy('_checkXhsRoute 存在', checkBody.length > 0);
  const iSync = checkBody.indexOf('this._syncXhsRouteVisibility(href)');
  const iGuard = checkBody.indexOf("if (!curKey || curKey === prevKey) return;");
  truthy('地址变化后调了 _syncXhsRouteVisibility', iSync > -1);
  truthy('同步显隐在 return 之前（退回列表页才藏得掉）', iSync > -1 && iGuard > -1 && iSync < iGuard);

  // 2) 关窗必须写在按钮 if 之外（缩进 = 方法体第一层）
  const syncBody = (SRC.match(/_syncXhsRouteVisibility\s*\(\s*href\s*\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  eq('列表页关窗只写一处（不重复关）', (syncBody.match(/_closeXhsPanelOnly\s*\(/g) || []).length, 1);
  const closeIndent = (syncBody.match(/\n( +)this\._closeXhsPanelOnly\s*\(/) || [])[1];
  eq('关窗写在方法体第一层（按钮 if 之外）', closeIndent, '        ');
  falsy('方法开头不再「按钮没建就整条 return」（否则浮窗那条路被断掉）',
    /if\s*\(\s*!bm\s*\|\|\s*!bm\.button\s*\)\s*return;/.test(syncBody));

  // 3) 站点门禁必须在方法第一行（在碰 location / 路由之前）
  const gateBody = (SRC.match(/_xhsShouldSuppressModal\s*\(\s*\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  truthy('_xhsShouldSuppressModal 存在', gateBody.length > 0);
  truthy('站点门禁用正则（不靠 indexOf，防 tiktok.com.evil.com 那种蒙混）',
    /\/\(\^\|\\\.\)xiaohongshu\\\.com\$\/\.test/.test(gateBody));
  truthy('catch 里 return false（宁可多弹一次也别吞数据）', /catch[\s\S]{0,120}return false;/.test(gateBody));

  // 4) 方法名带站点前缀（共享原型上同名会互相覆盖）
  truthy('拦窗判定叫 _xhsShouldSuppressModal（带前缀）',
    /_xhsShouldSuppressModal\s*\(\s*\)\s*\{/.test(SRC));
  falsy('mixin 上没有裸名 _shouldSuppressModal（否则会盖掉别站实现）',
    /^    _shouldSuppressModal\s*\(\s*\)\s*\{/m.test(SRC));

  /* ---------------------------------------------------------------------- */
  section('八、接线：manifest 与 content-main');

  const MAIN_PATH = path.join(ROOT, 'src/content/content-main.js');
  const MAIN = fs.readFileSync(MAIN_PATH, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  // 8.1 注入范围必须覆盖搜索页 / 用户主页（原来只列了 /explore/ 与 /discovery/item/*）
  const bigBlock = manifest.content_scripts[0];
  truthy('主注入块匹配 https://www.xiaohongshu.com/*（搜索页与主页才注入得到）',
    bigBlock.matches.includes('https://www.xiaohongshu.com/*'));
  falsy('不再保留只匹配 /explore/ 的窄规则（否则两个规则打架）',
    bigBlock.matches.some((m) => m === 'https://www.xiaohongshu.com/explore/'));

  // 8.2 脚本注册，且必须在 content-main 之前（mixin 要先定义好）
  const jsList = bigBlock.js;
  const iBase = jsList.indexOf('src/content/xiaohongshu-page-data.js');
  const iSpa = jsList.indexOf('src/content/ui/xiaohongshu-spa-handler.js');
  const iMain = jsList.indexOf('src/content/content-main.js');
  truthy('小红书 SPA 模块已注册注入', iSpa > -1);
  truthy('小红书 SPA 模块在 content-main 之前加载', iSpa > -1 && iMain > -1 && iSpa < iMain);
  eq('SPA 模块不应出现在隔离世界（数据桥才走 MAIN）', iBase, -1);

  // 8.3 MAIN 世界的数据桥
  const mainBlocks = manifest.content_scripts.filter((c) => c.world === 'MAIN');
  const bridge = mainBlocks.find((c) => (c.js || []).includes('src/content/xiaohongshu-page-data.js'));
  truthy('数据桥已注册为 MAIN world 脚本', !!bridge);
  truthy('数据桥在 www.xiaohongshu.com 上跑', !!bridge && bridge.matches.includes('https://www.xiaohongshu.com/*'));

  // 8.4 content-main 的接线
  truthy('content-main 里注册了 XiaohongshuSpaMixin',
    /Object\.assign\(MediaExtractor\.prototype,\s*XiaohongshuSpaMixin\)/.test(MAIN));
  truthy('content-main 里启动了 _startXhsSpa', /this\._startXhsSpa\s*\(\)/.test(MAIN));
  truthy('启动用 typeof 判断（未注册时零影响）',
    /typeof this\._startXhsSpa === 'function'/.test(MAIN));

  // 8.5 汇总器要问一圈两个站点，且真实调用在 open 之前
  //
  // 断言必须锚**那一行代码**，不能锚裸词 —— 方法上方的注释里也写着
  // `_tiktokShouldSuppressModal` / `_xhsShouldSuppressModal` 这两个名字。
  // v2.5.101 反向验证时就栽过（把整块判断挪走都不红），这次直接抓数组字面量。
  const checksLine = (MAIN.match(/const checks = \[([^\]]*)\];/) || [])[1] || '';
  truthy('能解析出汇总器的检查清单', checksLine.length > 0);
  truthy('汇总器包含 TikTok 判定', /'_tiktokShouldSuppressModal'/.test(checksLine));
  truthy('汇总器包含小红书判定', /'_xhsShouldSuppressModal'/.test(checksLine));
  truthy('汇总器用 typeof 逐个问（没实现的站点跳过）',
    /typeof this\[name\] === 'function'/.test(MAIN));
  const iDispatch = MAIN.indexOf('suppressModal = !!this._shouldSuppressModal();');
  const iOpen = MAIN.indexOf('await this.modalManager.open(combinedData)');
  truthy('确实调了汇总器（不是只写在注释里）', iDispatch > -1);
  truthy('汇总器在 modalManager.open **之前**', iDispatch > -1 && iOpen > -1 && iDispatch < iOpen);

  // 8.6 URL 规则：列表页必须明确「无提取器」，不能靠 /explore/ 字面量蒙过去
  const factory = fs.readFileSync(path.join(ROOT, 'src/content/utils/extractor-factory.js'), 'utf8');
  truthy('小红书 URL 规则要求 24 位笔记 ID',
    /xiaohongshu\\\.com\\\/\(\?:explore\|discovery\\\/item\)\\\/\[0-9a-f\]\{24\}/i.test(factory));
  falsy('不再有「/explore/ 字面量」的旧规则',
    /\{ pattern: \/www\\\.xiaohongshu\\\.com\\\/explore\\\/\//.test(factory));

  // 8.7 版本号
  eq('版本号已升到 2.9.3', manifest.version, '2.9.3');

  // 8.8 mediaType 为空的那条分支也必须挂跟随
  //
  // 为什么要有：`detectMediaType()` 对小红书列表页是**靠正文关键词猜**出来的
  // （patterns 里只有 /explore/ 与 /discovery/item/，猜空就返回 null）。
  // 一旦猜空，init 会在「摘按钮 + return」之前就结束，`_startXhsSpa` 永远挂不上，
  // 从列表点开笔记时按钮永远不出现。所以那条分支要自己挂一次。
  const iEarlyStart = MAIN.indexOf('if (this._startXhsSpa()) {');
  const iButtonRemove = MAIN.indexOf('this.buttonManager.button.remove()');
  truthy('mediaType 为空的分支里也挂跟随', iEarlyStart > -1);
  truthy('挂跟随在「摘按钮」之前（button 被置空就再也造不回来）',
    iEarlyStart > -1 && iButtonRemove > -1 && iEarlyStart < iButtonRemove);

  // 切片右边界必须锚「这条分支自己的收尾日志」，不能用固定字符数 ——
  // 固定窗口（曾经写 1400）会跨过这条分支的 return; 一直伸进 init 主流程，
  // 于是主流程里那行 initUI() 会替被删掉的分支那行顶包，改坏也照样全绿。
  const iEarlyEnd = MAIN.indexOf('初始化收尾已补齐', iEarlyStart);
  const earlyBlock = MAIN.slice(iEarlyStart, iEarlyEnd > -1 ? iEarlyEnd : iEarlyStart + 1400);
  truthy('切片右边界落在分支内部（否则断言会读到主流程的代码）',
    iEarlyEnd > -1 && iEarlyEnd > iEarlyStart);
  truthy('这条分支补了 initFieldMapper（否则 fieldMapper 为空，提取必崩）',
    /initFieldMapper\('social'\)/.test(earlyBlock));
  truthy('这条分支补了 initUI（否则按钮没接点击回调，点下去没反应）',
    /this\.initUI\(\)/.test(earlyBlock));
  truthy('这条分支把 isInitialized 置真（否则点提取报「提取器未初始化」）',
    /this\.isInitialized = true;/.test(earlyBlock));
  falsy('这条分支不调度自动提取（列表页本来就没有可提的东西）',
    /_scheduleAutoExtract/.test(earlyBlock));

  // 主动分支（mediaType 正常时的 init 主流程）里那次调用也不能少
  truthy('init 主流程里也调了 _startXhsSpa（笔记页靠它管换条）',
    MAIN.indexOf('this._startXhsSpa();') > -1);

  /* ============================ 总结 ============================ */
  console.log(`\n${fail === 0 ? C.green : C.red}== 通过 ${pass} 项，失败 ${fail} 项 ==${C.reset}`);
  console.log(`
${C.cyan}反向验证清单（改坏任何一条，对应断言必须变红）${C.reset}
  ① _xhsNoteIdFromHref 的正则去掉 (?:[?#]|$) 锚点 → 第一节「笔记 ID 太短」等红
  ② 把 /user/profile 也当成笔记（放宽正则） → 第一节「用户主页 → 不当成笔记」红
  ③ 去掉 _xhsRouteHidden 判断，无条件 setVisible(true)
       → 第三节「配置关掉 + 进笔记页 → 仍然不打开」「不是自己藏的 → 不擅自恢复」红
  ④ 去掉 if (bm0.isVisible !== false) 的当前态判断（无条件 setVisible(false)）
       → 第三节「配置关掉 + 列表页 → 不调 setVisible」红
  ⑤ 删掉 _syncXhsRouteVisibility 里的 this._closeXhsPanelOnly(...)
       → 第四节全红（按钮藏了浮窗还留着，就是用户 2026-10-29 报的那个毛病）
  ⑥ 把关窗挪进 if (bm0 && bm0.button && ...) 判断里面
       → 第四节「按钮未建 / 没有按钮管理器 / 配置关掉按钮」三条红 + 缩进断言红
  ⑦ 在 _syncXhsRouteVisibility 开头恢复「按钮没建就整条 return」
       → 第四节「按钮未建 + 退回列表页」红
  ⑧ 把 _checkXhsRoute 里的同步调用挪到 return 之后
       → 第二节「退回列表页 → 按钮再藏」红 + 第七节「同步显隐在 return 之前」红
  ⑨ 去掉 _xhsShouldSuppressModal 开头的站点门禁
       → 第五节「豆瓣/B站/抖音/快手…一律放行」全部红
       （这条最要命：门禁一没，除小红书外所有网站永远不弹窗）
  ⑩ 把门禁的 catch 改成 return true → 第五节「判定抛错 → 放行」红
  ⑪ 把 _xhsShouldSuppressModal 改名成 _shouldSuppressModal
       → 第七节「mixin 上没有裸名」红（且会和 TikTok 那份互相覆盖）
  ⑫ 删掉 _startXhsSpa 开头的域名判断 → 第六节「豆瓣页面 → 不启动」红
  ⑬ manifest 把 matches 改回 /explore/ 窄规则
       → 第八节「主注入块匹配 /*」「不再保留窄规则」红
  ⑭ 把 xiaohongshu-spa-handler.js 移到 content-main.js 之后
       → 第八节「在 content-main 之前加载」红
  ⑮ content-main 的汇总器里删掉 _xhsShouldSuppressModal
       → 第八节「汇总器包含小红书判定」红
  ⑯ extractor-factory 的小红书规则改回 /explore/ 字面量
       → 第八节「要求 24 位笔记 ID」「不再有旧规则」红
`);

  process.exit(fail === 0 ? 0 : 1);
}

main();
