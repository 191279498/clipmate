/**
 * TikTok 列表页不出按钮（v2.5.100）
 *
 * 背景（v2.5.99 真机实测）：
 *   TikTok 探索页 `/explore` 是「分类条 + 头条区 + 四列网格」的**列表页**，
 *   页面上没有「当前作品」。原来的实现不判断路由，于是在这里也出了按钮，
 *   点下去只能从页面上猜一个作者ID，得到的是：
 *     作者ID=ther0bb0s / 昵称空 / 日期空 / URL=/explore      ← 假数据
 *
 * 用户拍板（2026-10-29）：**先修假数据（最小改动）** ——
 *   `/explore` 不出按钮；点进某条作品变成 `/@user/video/<id>` 后按钮再出现。
 *
 * 本文件钉住的契约
 * ----------------
 *   A. 路由判定：作品页 / 图集页 / 主页 / 推荐流 = 可提取；探索、搜索、话题、
 *      音乐、直播、上传、消息这类**列表页** = 不可提取
 *   B. 显隐跟随：探索页藏 → 点进作品恢复 → 退回探索页再藏（**这条最关键**：
 *      退回时 curKey 是空串，如果显隐写在 `return` 之后，这里就会红）
 *   C. 不越权：配置里关掉的按钮不会被本逻辑打开；也不抢 `isVisible` 的方向盘
 *   D. 容错：判定抛错 → 当可提取（宁可多一个按钮，不能误藏）
 *   E. 结构：两个调用点（启动时 / 地址变化时）都在，且顺序正确
 *
 * 反向验证（必须变红，见文件末尾清单）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const SRC_PATH = path.join(ROOT, 'src/content/ui/tiktok-spa-handler.js');
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

/* 真机用过的地址（都是浏览器地址栏里抄下来的原样形式） */
const ITEM_A = 'https://www.tiktok.com/@ianthioo/video/7688932324901145870';
const ITEM_B = 'https://www.tiktok.com/@ech0d0gg/video/7692237845101318414';
const PHOTO = 'https://www.tiktok.com/@kariina_choi/photo/7692501454971571508';
const PROFILE = 'https://www.tiktok.com/@ianthioo';
const FYP = 'https://www.tiktok.com/';
const EXPLORE = 'https://www.tiktok.com/explore';

/* -------------------------------------------------------------------------- */
/* 沙箱：只喂 mixin 需要的那几个全局                                             */
/* -------------------------------------------------------------------------- */
function loadSpa(href, hostname) {
  const loc = { hostname: hostname || 'www.tiktok.com', href: href || FYP };
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
  return { mixin: win.TikTokSpaMixin, location: loc };
}

/** 假按钮（只要够 _syncTikTokFypAnchor / _anchorTikTokButton 用） */
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

/**
 * 造一套「浏览器环境 + 组件实例」
 * @param {Object} [opts]
 * @param {string} [opts.href] - 初始地址
 * @param {boolean} [opts.visible=true] - 按钮初始可见性
 * @param {boolean} [opts.noButton=false] - buttonManager 存在但按钮还没建
 * @param {boolean} [opts.noManager=false] - 压根没有 buttonManager
 */
function makeEnv(opts) {
  const o = opts || {};
  const href = o.href || FYP;
  const env = loadSpa(href, o.hostname);
  const host = Object.assign({}, env.mixin);
  host.modalManager = null;
  host._tkLastHref = href;

  let bm = null;
  if (!o.noManager) {
    bm = makeButtonManager(o.visible === undefined ? true : o.visible);
    if (o.noButton) bm.button = null;
  }
  host.buttonManager = bm;

  return {
    host: host,
    location: env.location,
    bm: bm,
    /** 把地址换成 href 并跑一拍轮询（模拟真实换页） */
    go(nextHref) {
      env.location.href = nextHref;
      host._checkTikTokRoute();
    }
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

/* ========================================================================== */
function main() {
  section('一、路由判定：哪些页面有「当前作品」');

  {
    const { host } = makeEnv({ href: ITEM_A });
    const yes = [
      ['作品页', ITEM_A, 'item:7688932324901145870'],
      ['作品页带跟踪参数', ITEM_A + '?is_from_webapp=1&sender_device=pc',
        'item:7688932324901145870'],
      ['图集页 /photo/', PHOTO, 'item:7692501454971571508'],
      ['个人主页', PROFILE, 'profile:ianthioo'],
      ['个人主页带参数', PROFILE + '?lang=en', 'profile:ianthioo'],
      ['个人主页带斜杠', PROFILE + '/', 'profile:ianthioo'],
      ['推荐流（首页）', FYP, 'fyp'],
      ['推荐流 /foryou', 'https://www.tiktok.com/foryou', 'fyp'],
      ['推荐流 /following', 'https://www.tiktok.com/following', 'fyp'],
      ['推荐流 /friends', 'https://www.tiktok.com/friends', 'fyp']
    ];
    for (const [label, href, want] of yes) {
      eq(label + ' → 可提取', host._tkRouteKeyFromHref(href), want);
    }
  }

  {
    const { host } = makeEnv({ href: EXPLORE });
    const no = [
      ['探索页', 'https://www.tiktok.com/explore'],
      ['探索页带语言参数', 'https://www.tiktok.com/explore?lang=en'],
      ['搜索结果页', 'https://www.tiktok.com/search?q=cat'],
      ['搜索视频页', 'https://www.tiktok.com/search/video?q=cat'],
      ['话题页', 'https://www.tiktok.com/tag/mukbang'],
      ['音乐页', 'https://www.tiktok.com/music/original-sound-7123456789'],
      ['直播页', 'https://www.tiktok.com/live'],
      ['发现页', 'https://www.tiktok.com/discover'],
      ['上传页', 'https://www.tiktok.com/upload'],
      ['消息页', 'https://www.tiktok.com/messages'],
      ['关于页', 'https://www.tiktok.com/about']
    ];
    for (const [label, href] of no) {
      eq(label + ' → 不可提取', host._tkRouteKeyFromHref(href), '');
    }
  }

  /* ==================== 二、显隐跟随 ==================== */
  section('二、显隐跟随：探索页藏 → 进作品恢复 → 退回再藏');

  {
    // ① 一进来就在探索页（真实用户从侧栏点进探索）
    const e = makeEnv({ href: EXPLORE, visible: true });
    e.host._syncTikTokRouteVisibility();
    eq('探索页：按钮被藏', e.bm.isVisible, false);
    eq('探索页：藏起来的责任人记在自己账上（_tkRouteHidden）', e.host._tkRouteHidden, true);
    eq('探索页：只调了一次 setVisible', e.bm.calls.join(','), 'false');

    // ② 点开网格里的一条 → 变成作品页
    e.go(ITEM_A);
    eq('点进作品：按钮恢复', e.bm.isVisible, true);
    eq('点进作品：责任人标记清空', e.host._tkRouteHidden, false);
    eq('两次显隐调用顺序正确', e.bm.calls.join(','), 'false,true');

    // ③ 退回探索页（**最关键的一条**：此时 curKey 是空串）
    e.go(EXPLORE);
    eq('退回探索：按钮重新藏起来', e.bm.isVisible, false);
    eq('三次显隐调用顺序正确', e.bm.calls.join(','), 'false,true,false');

    // ④ 再点进另一条作品，仍然要恢复
    e.go(ITEM_B);
    eq('再点进作品：按钮又恢复（不会被上次的隐藏状态卡死）', e.bm.isVisible, true);
  }

  {
    // 探索页里切分类：地址不变 → 一拍都不该多调
    const e = makeEnv({ href: EXPLORE, visible: true });
    e.go(EXPLORE + '?lang=en');       // 地址变了但还是探索页
    eq('探索页切分类（地址微变）：仍然藏', e.bm.isVisible, false);
    eq('探索页切分类：只调了一次', e.bm.calls.length, 1);
    e.host._syncTikTokRouteVisibility();   // 300ms 那一拍再同步一次
    eq('重复同步不会重复调用（幂等）', e.bm.calls.length, 1);
  }

  {
    // 作品页 → 作品页：不能误藏
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.go(ITEM_B);
    eq('作品页之间换条：按钮一直可见', e.bm.isVisible, true);
    eq('作品页之间换条：一次都没动显隐', e.bm.calls.length, 0);
  }

  {
    // 图集翻图只改 ?image_index= → 同一件作品，不该动
    const e = makeEnv({ href: PHOTO, visible: true });
    e.go(PHOTO + '?image_index=2');
    eq('图集翻图：按钮不动', e.bm.isVisible, true);
    eq('图集翻图：一次都没动显隐', e.bm.calls.length, 0);
  }

  {
    // 推荐流 → 作品页 → 推荐流，都不该藏
    const e = makeEnv({ href: FYP, visible: true });
    e.go(ITEM_A);
    e.go(FYP);
    eq('推荐流进出作品页：按钮始终可见', e.bm.isVisible, true);
    eq('推荐流进出作品页：一次都没动显隐', e.bm.calls.length, 0);
  }

  /* ==================== 三、不越权 ==================== */
  section('三、不越权：配置关掉的按钮不会被本逻辑打开');

  {
    // 用户在设置里关掉了按钮（isVisible=false，但不是本模块藏的）
    const e = makeEnv({ href: ITEM_A, visible: false });
    e.go(ITEM_B);
    eq('配置关掉 + 作品页：仍然是关的', e.bm.isVisible, false);
    eq('配置关掉 + 作品页：一次都没动', e.bm.calls.length, 0);
  }

  {
    // 配置关掉，且当前在探索页 → 不能把「隐藏责任人」记到自己头上，
    // 否则下次回到作品页就会擅自把配置关掉的按钮打开
    const e = makeEnv({ href: EXPLORE, visible: false });
    e.go(EXPLORE + '?lang=en');
    eq('配置关掉 + 探索页：仍然是关的', e.bm.isVisible, false);
    eq('配置关掉 + 探索页：没有认领隐藏责任', e.host._tkRouteHidden, undefined);
    e.go(ITEM_A);
    eq('配置关掉 + 回到作品页：不许擅自打开', e.bm.isVisible, false);
    eq('配置关掉 + 回到作品页：一次都没动', e.bm.calls.length, 0);
  }

  /* ==================== 四、容错 ==================== */
  section('四、容错：判定抛错宁可多一个按钮，也不能误藏');

  {
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host._tkRouteKeyFromHref = () => { throw new Error('boom'); };
    e.host._syncTikTokRouteVisibility(EXPLORE);
    eq('判定抛错 → 不藏', e.bm.isVisible, true);
    eq('判定抛错 → 一次都没动', e.bm.calls.length, 0);
  }

  {
    const e = makeEnv({ href: ITEM_A, visible: true, noButton: true });
    e.host._syncTikTokRouteVisibility(EXPLORE);
    eq('按钮还没建出来 → 不报错也不乱调', e.bm.calls.length, 0);
  }

  {
    const e = makeEnv({ href: ITEM_A, visible: true, noManager: true });
    let threw = null;
    try { e.host._syncTikTokRouteVisibility(EXPLORE); } catch (err) { threw = err; }
    eq('压根没有 buttonManager → 静默返回', threw, null);
  }

  /* ==================== 五、结构：两个调用点都在 ==================== */
  section('五、结构：启动时同步一次，地址变化时再同步一次');

  truthy('_syncTikTokRouteVisibility 方法存在', /_syncTikTokRouteVisibility\s*\(\s*href\s*\)\s*\{/.test(SRC));

  const startBody = (SRC.match(/_startTikTokSpa\s*\(\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  truthy('_startTikTokSpa 里调了同步', /_syncTikTokRouteVisibility\s*\(/.test(startBody));
  eq('_startTikTokSpa 里调了两次（进页面 + 300ms 那一拍）',
    (startBody.match(/_syncTikTokRouteVisibility\s*\(/g) || []).length, 2);
  truthy('_startTikTokSpa 里把隐藏责任标记初始化成 false',
    /_tkRouteHidden\s*=\s*false/.test(startBody));

  // 顺序：同步必须在 `if (!curKey || curKey === prevKey) return;` **之前**
  const checkBody = (SRC.match(/_checkTikTokRoute\s*\(\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  const iSync = checkBody.indexOf('_syncTikTokRouteVisibility');
  const iGuard = checkBody.indexOf('if (!curKey || curKey === prevKey) return;');
  truthy('_checkTikTokRoute 里调了同步', iSync > -1);
  truthy('同步在「换没换东西」的提前返回之前（否则退回探索页藏不掉）',
    iSync > -1 && iGuard > -1 && iSync < iGuard);

  /* ==================== 六、浮窗同关（v2.5.101） ==================== */
  section('六、列表页藏按钮时，浮窗必须一起关（v2.5.101 用户反馈）');

  {
    // 用户报的真实路径：探索页 → 点开作品 → 点提取（浮窗开）→ 关掉作品回探索页
    // 退回那一步 curKey 是 ''，_checkTikTokRoute 会在关窗那行之前就 return，
    // 所以关窗只能靠 _syncTikTokRouteVisibility —— 这条就是钉它。
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host.modalManager = makeModal(true);
    e.go(EXPLORE);
    eq('退回探索页：按钮藏起来', e.bm.isVisible, false);
    eq('退回探索页：浮窗跟着关掉', e.host.modalManager.isOpen, false);
    eq('退回探索页：确实调了 close 一次', e.host.modalManager.closed, 1);
  }

  {
    // 浮窗本来就没开：不许乱调 close（否则每次切分类都记一次「关闭」，日志全是噪音）
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host.modalManager = makeModal(false);
    e.go(EXPLORE);
    eq('浮窗没开时：不去调 close', e.host.modalManager.closed, 0);
    eq('浮窗没开时：按钮照常藏', e.bm.isVisible, false);
  }

  {
    // 作品页之间换条：浮窗照旧关（v2.5.95 定下的规矩，不能被这版改坏）
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host.modalManager = makeModal(true);
    e.go(ITEM_B);
    eq('作品页换条：按钮一直可见', e.bm.calls.length, 0);
    eq('作品页换条：浮窗关一次（按钮保留）', e.host.modalManager.closed, 1);
  }

  {
    // 配置关掉按钮（isVisible=false），人在作品页开着浮窗 → 退回探索页
    // 关窗写在按钮判断**之外**，所以哪怕按钮早就是关的，浮窗一样要关
    const e = makeEnv({ href: ITEM_A, visible: false });
    e.host.modalManager = makeModal(true);
    e.go(EXPLORE);
    eq('配置关掉按钮 + 退回探索页：一次都没动按钮', e.bm.calls.length, 0);
    eq('配置关掉按钮 + 退回探索页：浮窗仍然被关', e.host.modalManager.closed, 1);
  }

  {
    // 按钮还没建出来（自动提取比 initComponents 更早跑到的情形）
    // v2.5.100 开头那句 `if (!bm || !bm.button) return;` 会把这条路整条断掉
    const e = makeEnv({ href: ITEM_A, visible: true, noButton: true });
    e.host.modalManager = makeModal(true);
    e.go(EXPLORE);
    eq('按钮未建 + 退回探索页：浮窗仍然被关', e.host.modalManager.closed, 1);
  }

  {
    // 压根没有浮窗管理器
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host.modalManager = null;
    let threw = null;
    try { e.go(EXPLORE); } catch (err) { threw = err; }
    eq('没有浮窗管理器 → 不抛异常', threw, null);
    eq('没有浮窗管理器 → 按钮照常藏', e.bm.isVisible, false);
  }

  {
    // close() 自己抛错 → 不能把按钮一起带下水
    const e = makeEnv({ href: ITEM_A, visible: true });
    e.host.modalManager = { isOpen: true, close() { throw new Error('close boom'); } };
    let threw = null;
    try { e.go(EXPLORE); } catch (err) { threw = err; }
    eq('关闭浮窗抛错 → 异常不外泄', threw, null);
    eq('关闭浮窗抛错 → 按钮照常藏', e.bm.isVisible, false);
  }

  /* ==================== 七、提取途中离开（v2.5.101） ==================== */
  section('七、提取途中离开：结果回来不许在列表页弹窗');

  // v2.6.0：方法名从 `_shouldSuppressModal` 改成带站点前缀的
  // `_tiktokShouldSuppressModal`。原因是小红书那份 mixin 也挂同一个共享原型，
  // 同名会互相覆盖（后 assign 的顶掉前一个），而且不报错，极难查。
  // content-main 里的 `_shouldSuppressModal()` 现在只是个「挨个问一圈」的汇总器。
  {
    const { host } = makeEnv({ href: EXPLORE });
    eq('探索页 → 拦下弹窗', host._tiktokShouldSuppressModal(), true);

    const { host: h2 } = makeEnv({ href: 'https://www.tiktok.com/search?q=cat' });
    eq('搜索页 → 拦下弹窗', h2._tiktokShouldSuppressModal(), true);

    const { host: h3 } = makeEnv({ href: 'https://www.tiktok.com/tag/mukbang' });
    eq('话题页 → 拦下弹窗', h3._tiktokShouldSuppressModal(), true);

    const allow = [
      ['作品页', ITEM_A],
      ['图集页', PHOTO],
      ['个人主页', PROFILE],
      ['推荐流', FYP]
    ];
    for (const [label, href] of allow) {
      const { host: h } = makeEnv({ href });
      eq(label + ' → 照常弹窗', h._tiktokShouldSuppressModal(), false);
    }
  }

  {
    const { host } = makeEnv({ href: EXPLORE });
    host._tkRouteKeyFromHref = () => { throw new Error('boom'); };
    eq('判定抛错 → 放行（宁可多弹一次，也别把数据吞掉）', host._tiktokShouldSuppressModal(), false);
  }

  {
    // ⚠ 这一段是保命的：这份 mixin 在 content-main 里被 Object.assign 到
    // **MediaExtractor.prototype**（共享原型），而 manifest 那条 content_scripts
    // 覆盖豆瓣 / B站 / 抖音 / 快手 / MobyGames 等全站 —— 别的网站也会调到这里。
    // 不加站点门禁的话，非 TikTok 地址在 _tkRouteKeyFromHref 里只会返回 ''，
    // 等于「除了纯数字 /video/ 的抖音页，所有别的网站永远不弹窗」。
    const others = [
      ['豆瓣书籍页', 'https://book.douban.com/subject/1234567/', 'book.douban.com'],
      ['豆瓣电影页', 'https://movie.douban.com/subject/1292052/', 'movie.douban.com'],
      ['B站视频页', 'https://www.bilibili.com/video/BV1xx411c7mD', 'www.bilibili.com'],
      ['MobyGames 游戏页', 'https://www.mobygames.com/game/123/foo', 'www.mobygames.com'],
      ['快手作品页', 'https://www.kuaishou.com/short-video/3xabc', 'www.kuaishou.com'],
      ['小红书笔记页', 'https://www.xiaohongshu.com/explore/123abc', 'www.xiaohongshu.com'],
      ['微博正文页', 'https://weibo.com/1234/AbCdEf', 'weibo.com'],
      // 域名看着像但不是（子域后缀不能蒙混过关）
      ['钓鱼域名 tiktok.com.evil.com', 'https://www.tiktok.com.evil.com/explore', 'www.tiktok.com.evil.com']
    ];
    for (const [label, href, hostname] of others) {
      const { host: h } = makeEnv({ href, hostname });
      eq(label + ' → 一律放行（不受 TikTok 门禁影响）', h._tiktokShouldSuppressModal(), false);
    }

    // 子域名要认：m.tiktok.com 也是 TikTok
    const { host: mHost } = makeEnv({ href: 'https://m.tiktok.com/explore', hostname: 'm.tiktok.com' });
    eq('m.tiktok.com 探索页 → 仍然拦下', mHost._tiktokShouldSuppressModal(), true);
  }

  /* ==================== 八、结构 ==================== */
  section('八、结构：两处关窗/拦窗都写在正确的位置');

  const MAIN_PATH = path.join(ROOT, 'src/content/content-main.js');
  const MAIN = fs.readFileSync(MAIN_PATH, 'utf8');
  truthy('content-main 里问了 _shouldSuppressModal', MAIN.indexOf('_shouldSuppressModal') > -1);
  // 位置断言必须锚**代码**，不能锚 `_shouldSuppressModal` 这个裸词 ——
  // 上面那段注释里也写着这个词，锚裸词的话把整块判断挪到 open 之后都不会红（反向验证 ⑬ 抓到过）。
  const iSuppress = MAIN.indexOf('suppressModal = !!this._shouldSuppressModal();');
  const iOpen = MAIN.indexOf('await this.modalManager.open(combinedData)');
  truthy('确实调了 _shouldSuppressModal（不是只写在注释里）', iSuppress > -1);
  truthy('这个判断在 modalManager.open **之前**', iSuppress > -1 && iOpen > -1 && iSuppress < iOpen);
  truthy('用 typeof 判断（没实现这条约定的站点零影响）',
    /typeof this\._shouldSuppressModal === 'function'/.test(MAIN));
  truthy('跳过弹窗的分支里收掉了按钮加载态（否则按钮一直转圈）',
    /if\s*\(suppressModal\)\s*\{[\s\S]{0,240}setLoading\(false\)/.test(MAIN));

  truthy('_closeTikTokPanelOnly 支持自定义日志文案', /_closeTikTokPanelOnly\s*\(\s*logMsg\s*\)/.test(SRC));
  // v2.6.0：mixin 上的实现改名叫 _tiktokShouldSuppressModal（避免与小红书同名互覆盖）
  truthy('拦窗判定定义在 mixin 上（带 tiktok 前缀）', /_tiktokShouldSuppressModal\s*\(\s*\)\s*\{/.test(SRC));
  falsy('mixin 上不再有裸名 _shouldSuppressModal（否则会盖掉别站实现）',
    /^    _shouldSuppressModal\s*\(\s*\)\s*\{/m.test(SRC));

  const syncBody = (SRC.match(/_syncTikTokRouteVisibility\s*\(\s*href\s*\)\s*\{[\s\S]*?\n    \},/) || [''])[0];
  eq('列表页关窗只写一处（不重复关）', (syncBody.match(/_closeTikTokPanelOnly\s*\(/g) || []).length, 1);
  const closeIndent = (syncBody.match(/\n( +)this\._closeTikTokPanelOnly\s*\(/) || [])[1];
  eq('关窗写在方法体第一层（按钮 if 之外，按钮已隐藏那拍也要关）', closeIndent, '        ');
  falsy('方法开头不再「按钮没建就整条 return」（否则浮窗那条路被断掉）',
    /if\s*\(\s*!bm\s*\|\|\s*!bm\.button\s*\)\s*return;/.test(syncBody));

  /* ============================ 总结 ============================ */
  console.log(`\n${fail === 0 ? C.green : C.red}== 通过 ${pass} 项，失败 ${fail} 项 ==${C.reset}`);
  console.log(`
${C.cyan}反向验证清单（改坏任何一条，对应断言必须变红）${C.reset}
  ① _syncTikTokRouteVisibility 里去掉 if (!ok)，改成永远不藏
       → 第二节「探索页：按钮被藏」「退回探索：按钮重新藏起来」红
  ② 把 _checkTikTokRoute 里的同步挪到 if (!curKey || ...) return; 之后
       → 第二节「退回探索：按钮重新藏起来」红（第五节顺序断言也红）
  ③ 判定改成永远返回 ok（不调 _tkRouteKeyFromHref）
       → 第一节全部「不可提取」红 + 第二节全红
  ④ 去掉 _tkRouteHidden 的「只恢复自己藏起来的」判断（无条件 setVisible(true)）
       → 第三节「配置关掉 + 回到作品页：不许擅自打开」红
  ⑤ 去掉 bm.isVisible !== false 的当前态判断（无条件 setVisible(false)）
       → 第二节「重复同步不会重复调用（幂等）」红 + 第三节「配置关掉 + 探索页」红
  ⑥ 去掉 try/catch 的 ok = true 兜底（抛错时也藏）
       → 第四节「判定抛错 → 不藏」红
  ⑦ _startTikTokSpa 里删掉 300ms 那一拍 → 第五节调用次数断言红
  ── v2.5.101 新增（浮窗同关 / 提取途中离开）──
  ⑧ 删掉 _syncTikTokRouteVisibility 里的 this._closeTikTokPanelOnly(...)
       → 第六节「退回探索页：浮窗跟着关掉」「按钮未建 + 退回探索页」等全红
  ⑨ 把关窗挪进 if (bm0 && ... isVisible !== false) 判断里面
       → 第六节「配置关掉按钮 + 退回探索页：浮窗仍然被关」红（缩进断言也红）
  ⑩ 在 _syncTikTokRouteVisibility 开头恢复「按钮没建就整条 return」
       → 第六节「按钮未建 + 退回探索页：浮窗仍然被关」红
  ⑪ content-main 里让 suppressModal 判断永远不生效（改成 if (false)）
       → 第八节「跳过弹窗的分支里收掉了按钮加载态」红
  ⑫ 把 _shouldSuppressModal 的 catch 改成 return true
       → 第七节「判定抛错 → 放行」红
  ⑬ 把 content-main 里那整块判断挪到 open 之后
       → 第八节「这个判断在 modalManager.open **之前**」红
  ⑭ 去掉 _shouldSuppressModal 开头的站点门禁
       → 第七节「豆瓣/B站/MobyGames/快手…一律放行」全部红
       （这条最要命：门禁一没，除 TikTok 外所有网站永远不弹窗）
`);
  if (fail !== 0) process.exit(1);
}

main();
