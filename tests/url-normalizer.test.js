/**
 * URL 规范化（v2.5.91 · 批 3）
 *
 * 背景：社媒站里有一半提取器没有 `extractUrl()`，`SocialFieldsBuilder.build()` 直接用
 * `location.href` 兜底。于是 URL 字段里带着「用户怎么进来的」痕迹：
 *
 *   快手  `?authorId=…&streamSource=…`   （authorId 是作者内部编号，与作品无关）
 *   小红书 `?xsec_token=…`               （**会过期**，过期后链接直接 404）
 *   IG    `?igsh=…` ／ TikTok `?is_from_webapp=1` ／ B站 `?spm_id_from=…`
 *
 * 本文件钉住四组契约：
 *   A. 该去的参数去干净（8 个站，逐个真机形态）
 *   B. **不许去的参数一个都不许丢**（YouTube `?v=`、B站 `?p=`）
 *   C. 认不出 / 不合法 → 原样返回（宁可不改，也不能把能打开的地址改坏）
 *   D. 幂等：normalize 跑两次 == 跑一次
 *
 * 另外单独钉住「抖音图文弹窗」这一条：URL 必须和详情页一致（都出 `/note/`）。
 *
 * 反向验证（必须变红）：
 *   ① `normalize` 改成直接 `return href` → 第一、二节全红
 *   ② B站规则改成「一律不带 p」 → 第二节分P 用例红
 *   ③ YouTube 规则改成「一律只给 watch?v=」→ shorts 用例红
 *   ④ 去掉「认不出原样返回」的兜底（改成 return ''）→ 第三节红
 *   ⑤ `_isNoteFromRenderData` 恒返回 false → 第四节图文用例红
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', gray: '\x1b[90m', yellow: '\x1b[33m'
};
let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }

/* ============================ 加载被测代码 ============================ */

// 直接用 node 的 require 路径拿同一份源码（模块同时挂 window，浏览器里走另一条分支）
const UrlNormalizer = require(path.join(ROOT, 'src/content/shared/url-normalizer.js'));
const N = (u) => UrlNormalizer.normalize(u);

/* ==================== 一、八个站：该去的参数去干净 ==================== */

section('一、各站真实地址 → 规范地址（参数该去的去干净）');

// —— 抖音 ——
eq('抖音视频：路径已规范 → 去掉 query',
  N('https://www.douyin.com/video/7411950642865917225?previous_page=app_code_link'),
  'https://www.douyin.com/video/7411950642865917225');
eq('抖音图文：路径已规范',
  N('https://www.douyin.com/note/7516480886684568891?foo=1'),
  'https://www.douyin.com/note/7516480886684568891');
eq('抖音弹窗（精选页 modal_id）→ 作品地址',
  N('https://www.douyin.com/jingxuan?modal_id=7516480886684568891'),
  'https://www.douyin.com/video/7516480886684568891');
eq('抖音弹窗（搜索页 modal_id）→ 作品地址',
  N('https://www.douyin.com/search/%E7%BE%8E%E9%A3%9F?modal_id=7672265848853220618&type=general'),
  'https://www.douyin.com/video/7672265848853220618');

// —— 快手（真机地址必带 authorId，2026-10-28 记录）——
eq('快手详情：去掉 authorId / streamSource',
  N('https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66?authorId=3xerx8qy44may9i&streamSource=profile'),
  'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66');
eq('快手 /photo/<id> 归一成 /short-video/<id>',
  N('https://www.kuaishou.com/photo/3xfjr5h4hfrbz66?authorId=1'),
  'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66');
eq('快手 /fw/photo/<id> 归一成 /short-video/<id>',
  N('https://www.kuaishou.com/fw/photo/3xfjr5h4hfrbz66'),
  'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66');

// —— 小红书：token 必须留着（不带 token 真机实测直接 404），只去 xsec_source ——
eq('小红书 /explore/：保留 xsec_token，去掉 xsec_source',
  N('https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=ABC123&xsec_source=pc_feed'),
  'https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=ABC123');
eq('小红书 /discovery/item/ 归一成 /explore/（token 跟着走）',
  N('https://www.xiaohongshu.com/discovery/item/66a1b2c3000000001e01f3a1?xsec_token=XYZ789'),
  'https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=XYZ789');
eq('小红书 token 里的 + 和 = 不许被解码（解了就打不开）',
  N('https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=AB+a/b==&xsec_source=pc_feed'),
  'https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=AB+a/b==');
eq('小红书地址本就没 token → 不带 query',
  N('https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1'),
  'https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1');

// —— 微博 ——
eq('微博移动版 /detail/<id>',
  N('https://m.weibo.cn/detail/5234567890123456?featurecode=newtitle'),
  'https://m.weibo.cn/detail/5234567890123456');
eq('微博主站 /<uid>/<mid>：去掉 refer_flag',
  N('https://weibo.com/1234567890/PabcdEFGHI?refer_flag=1001030103_'),
  'https://weibo.com/1234567890/PabcdEFGHI');
eq('微博个人页 /u/<uid>',
  N('https://weibo.com/u/1234567890?is_all=1'),
  'https://weibo.com/u/1234567890');

// —— B站 ——
eq('B站：去掉 spm_id_from / vd_source',
  N('https://www.bilibili.com/video/BV1GJ411x7h7?spm_id_from=333.999.0.0&vd_source=abc'),
  'https://www.bilibili.com/video/BV1GJ411x7h7');
eq('B站 av 号',
  N('https://www.bilibili.com/video/av170001?spm_id_from=333'),
  'https://www.bilibili.com/video/av170001');

// —— YouTube ——
eq('YouTube：保留 v，去掉 list / t / si / pp',
  N('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2&t=30s&si=xyz'),
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
eq('YouTube shorts',
  N('https://www.youtube.com/shorts/abcDEF12345?feature=share'),
  'https://www.youtube.com/shorts/abcDEF12345');
eq('youtu.be 短链展开成 watch 地址',
  N('https://youtu.be/dQw4w9WgXcQ?t=30'),
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ');

// —— TikTok ——
eq('TikTok：去掉 is_from_webapp / sender_device',
  N('https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1&sender_device=pc'),
  'https://www.tiktok.com/@scout2015/video/6718335390845095173');
eq('TikTok 图文 photo',
  N('https://www.tiktok.com/@user1/photo/7300000000000000000?is_from_webapp=1'),
  'https://www.tiktok.com/@user1/photo/7300000000000000000');

// —— Instagram ——
eq('IG 帖子：去掉 igsh，补末尾斜杠',
  N('https://www.instagram.com/p/C8xYzAbCdEf/?igsh=MXBhbnN3'),
  'https://www.instagram.com/p/C8xYzAbCdEf/');
eq('IG /reels/ 归一成 /reel/',
  N('https://www.instagram.com/reels/C8xYzAbCdEf/'),
  'https://www.instagram.com/reel/C8xYzAbCdEf/');
eq('IG 快拍',
  N('https://www.instagram.com/stories/someuser/3400000000000000000?igsh=abc'),
  'https://www.instagram.com/stories/someuser/3400000000000000000');

/* ==================== 二、必要参数一个都不许丢 ==================== */

section('二、必要参数必须保留（删多了就是改坏）');

eq('B站分P p=2 必须保留',
  N('https://www.bilibili.com/video/BV1GJ411x7h7?p=2&spm_id_from=333'),
  'https://www.bilibili.com/video/BV1GJ411x7h7?p=2');
eq('B站 p=1（默认分P）不写进地址',
  N('https://www.bilibili.com/video/BV1GJ411x7h7?p=1'),
  'https://www.bilibili.com/video/BV1GJ411x7h7');
eq('B站 BV 号大小写原样保留（大小写敏感）',
  N('https://www.bilibili.com/video/BV1GJ411x7h7?p=3'),
  'https://www.bilibili.com/video/BV1GJ411x7h7?p=3');
eq('YouTube 没有 v 参数时不敢乱猜 → 原样返回',
  N('https://www.youtube.com/watch?list=PL123'),
  'https://www.youtube.com/watch?list=PL123');
eq('抖音 modal_id 非数字 → 原样返回',
  N('https://www.douyin.com/jingxuan?modal_id=abc'),
  'https://www.douyin.com/jingxuan?modal_id=abc');

/* ==================== 三、认不出就不动 ==================== */

section('三、认不出的站 / 不合法输入 → 原样返回');

eq('抖音个人主页不是作品 → 原样',
  N('https://www.douyin.com/user/MS4wLjABAAAAxyz'),
  'https://www.douyin.com/user/MS4wLjABAAAAxyz');
eq('小红书个人主页 → 原样',
  N('https://www.xiaohongshu.com/user/profile/5f1a2b3c'),
  'https://www.xiaohongshu.com/user/profile/5f1a2b3c');
eq('未知站点 → 原样',
  N('https://example.com/whatever?utm_source=x'),
  'https://example.com/whatever?utm_source=x');
eq('豆瓣（不在规则表）→ 原样',
  N('https://book.douban.com/subject/1084336/?from=xxx'),
  'https://book.douban.com/subject/1084336/?from=xxx');
eq('空串 → 空串', N(''), '');
eq('null 不炸', N(null), '');
eq('非 URL 字符串 → 原样', N('not a url'), 'not a url');
eq('javascript: 伪协议 → 原样', N('javascript:void(0)'), 'javascript:void(0)');

/* ==================== 四、抖音图文判定（块 B） ==================== */

section('四、抖音图文弹窗：URL 必须和详情页一致（/note/）');

/**
 * 用真样本 HTML 跑 `DouyinModalExtractor._isNoteFromRenderData`。
 * 这条是块 B 的护栏：它一变，弹窗的 URL 就会退回 `/video/`，两个入口又不一致了。
 */
(function testNoteDetection() {
  let JSDOM;
  try {
    JSDOM = require('jsdom').JSDOM;
  } catch (e) {
    const dirs = [
      process.env.CLIPMATE_NODE_PATH,
      path.join(require('os').homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
    ].filter(Boolean);
    for (const d of dirs) {
      try { JSDOM = require(path.join(d, 'jsdom')).JSDOM; break; } catch (err) { /* 下一个 */ }
    }
  }
  if (!JSDOM) {
    bad('jsdom 不可用，无法跑图文判定用例', '设置 NODE_PATH 指向含 jsdom 的 node_modules');
    return;
  }

  const src = read('src/content/extractors/douyin-modal.js');
  // 只取这一个方法体：整个类依赖一大堆浏览器全局，直接实例化会把测试拖进无底洞
  const m = src.match(/_isNoteFromRenderData\(id\)\s*\{[\s\S]*?\n  \}\n/);
  if (!m) {
    bad('在 douyin-modal.js 里找不到 _isNoteFromRenderData 方法', '方法被改名或删掉了？');
    return;
  }
  const body = m[0].replace(/_isNoteFromRenderData\(id\)/, 'function _isNote(id)');

  function makeChecker(html) {
    const doc = new JSDOM(html).window.document;
    // 方法体里用到 document，这里给它的作用域挂一个同名变量
    const fn = new Function('document', 'var _isNote = ' + body + '; return _isNote;')(doc);
    return fn;
  }

  const cases = [
    ['douyin-modal-jingxuan-note-7516480886684568891', '7516480886684568891', true],
    ['douyin-modal-search-video-7672265848853220618', '7672265848853220618', false],
    ['douyin-modal-user-video-7496043889296559386', '7496043889296559386', false]
  ];

  for (const [name, id, want] of cases) {
    const html = fs.readFileSync(path.join(__dirname, 'fixtures/html', name + '.html'), 'utf8');
    let got;
    try {
      got = makeChecker(html)(id);
    } catch (e) {
      bad(name + ' 判定抛错', String(e && e.message));
      continue;
    }
    eq(name.replace('douyin-modal-', '') + ' → ' + (want ? '图文' : '非图文'), got, want);
  }

  // 拿另一条作品的 id 去问图文样本，必须判成「不是」—— 防串台
  const noteHtml = fs.readFileSync(
    path.join(__dirname, 'fixtures/html/douyin-modal-jingxuan-note-7516480886684568891.html'), 'utf8');
  eq('用别的作品 id 去问 → 不当成图文（不串台）', makeChecker(noteHtml)('7000000000000000000'), false);
  eq('空 id → false', makeChecker(noteHtml)(''), false);
})();

/* ==================== 五、幂等 ==================== */

section('五、幂等：跑两遍和跑一遍结果一样');

const SAMPLES = [
  'https://www.douyin.com/jingxuan?modal_id=7516480886684568891',
  'https://www.douyin.com/note/7516480886684568891',
  'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66?authorId=3xerx8qy44may9i',
  'https://www.xiaohongshu.com/explore/66a1b2c3000000001e01f3a1?xsec_token=A',
  'https://weibo.com/1234567890/PabcdEFGHI?refer_flag=1',
  'https://www.bilibili.com/video/BV1GJ411x7h7?p=2&spm_id_from=333',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=30',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1',
  'https://www.instagram.com/p/C8xYzAbCdEf/?igsh=X',
  'https://example.com/whatever?utm_source=x'
];
let idemOk = true;
for (const s of SAMPLES) {
  const once = N(s);
  const twice = N(once);
  if (once !== twice) {
    idemOk = false;
    bad('幂等失败: ' + s.slice(0, 60), `第一次 ${JSON.stringify(once)} / 第二次 ${JSON.stringify(twice)}`);
  }
}
if (idemOk) ok(`${SAMPLES.length} 条样本全部幂等`);

/* ==================== 六、接入口：URL 字段真的被改了 ==================== */

section('六、SocialFieldsBuilder 接入口（URL 字段最终值）');

(function testBuilder() {
  const src = read('src/content/shared/social-fields-builder.js');
  if (src.indexOf('normalizeUrl(record') < 0) {
    bad('social-fields-builder.js 里没有调用 normalizeUrl', 'URL 不会被规范化');
    return;
  }
  ok('social-fields-builder.js 在装配末尾调用了 normalizeUrl');

  if (src.indexOf("if (!url) return url || '';") < 0) {
    bad('normalizeUrl 缺少空值保护', '空 URL 会走进规范化');
    return;
  }
  ok('normalizeUrl 有空值保护');

  // 真跑一遍：在干净上下文里加载 builder，喂一个快手地址
  const vm = require('vm');
  const ctx = vm.createContext({
    console: { log() {}, error() {}, warn() {}, info() {} },
    location: { href: 'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66?authorId=3xigv7h6q8jfmy&streamSource=profile' },
    // vm 的干净上下文里没有 URL 构造器（浏览器有）。缺了它 normalize 会静默降级成原样返回，
    // 测试就会「看起来通过、其实没测到」，所以必须补进来。
    URL
  });
  // 两个脚本都用「有 window 就挂 window」，让 window 指向上下文自己的全局，
  // 这样 UrlNormalizer 与 SocialFieldsBuilder 才在同一个对象上互相看得见（和浏览器一致）
  vm.runInContext('globalThis.window = globalThis;', ctx);

  // 先装 normalizer（浏览器里它在 builder 之前加载）
  vm.runInContext(read('src/content/shared/url-normalizer.js'), ctx, { filename: 'url-normalizer.js' });
  vm.runInContext(read('src/content/shared/social-fields-builder.js'), ctx, { filename: 'social-fields-builder.js' });

  const SB = vm.runInContext('SocialFieldsBuilder', ctx);
  if (!SB || typeof SB.build !== 'function') {
    bad('SocialFieldsBuilder 没挂到全局', '加载顺序或导出名变了？');
    return;
  }

  const extractor = {
    siteName: 'kuaishou_social',
    extractTitle: async () => '标题',
    extractAuthorId: async () => '3xigv7h6q8jfmy',
    extractAuthorName: async () => '作者',
    extractAuthorHomepage: async () => 'https://www.kuaishou.com/profile/3xigv7h6q8jfmy',
    extractPublishDate: async () => '2026/10/20 15:55:01',
    extractPageText: async () => '文案',
    // 故意不提供 extractUrl —— 走兜底路径，正是本批要修的场景
    getMediaType: () => 'social'
  };

  SB.build(extractor).then((rec) => {
    eq('没写 extractUrl 的站：URL 自动去掉 authorId',
      rec['URL'], 'https://www.kuaishou.com/short-video/3xfjr5h4hfrbz66');
    eq('其它字段没被影响', rec['作者昵称'], '作者');
    finish();
  }).catch((e) => {
    bad('builder 跑挂', String(e && e.message));
    finish();
  });
})();

/* ============================ 收尾 ============================ */

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log('');
  if (fail === 0) {
    console.log(`${C.green}全部通过：${pass} 项${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}失败 ${fail} 项，通过 ${pass} 项${C.reset}`);
    process.exit(1);
  }
}

// 同步用例跑完后若异步那条没回来，也要收尾（防止挂死）
setTimeout(finish, 3000).unref();
