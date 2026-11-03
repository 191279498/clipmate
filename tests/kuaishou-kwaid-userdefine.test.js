#!/usr/bin/env node
/**
 * 快手号字段真名 = userDefineId（v2.7.10）
 *
 * 要钉住的事：**主页 HTML 里本来就有快手号，只是字段叫 `userDefineId` 不是 `kwaiId`。**
 *
 * 2026-10-30 真机实测（一次 GET，401ms，200）：
 *   window.INIT_STATE 的键名做了「字符码 -1」混淆，解码后是
 *   `rest/v/profile/user-object` / `rest/v/profile/feed-object` / `rest/v/profile/get-object`
 *   —— 也就是「钩接口」想拿的响应原文，服务器渲染 HTML 时已经塞进来了。
 *   作者那一块长这样：
 *     "profile":{"user_id":"3xw4rt6264tk6m2","user_name":"盖世小美眉*",...},
 *     "userDefineId":"xiaxinjia8888"
 *
 * 两条命门（本脚本前两节必须全绿）：
 *   1. **不许把登录者自己写进别人的作品**。同一份数据里 `/rest/v/profile/get` 那条
 *      的 userDefineId 是「当前登录的人自己」（1226566812 = 它自己的 userId，
 *      旁边还带着手机号）。抓第一个 userDefineId 就是一级事故。
 *   2. **不许猜**。锚不住作者内部 ID 就返回空串，宁可慢回 iframe 渲染。
 *
 * 本脚本七节：
 *   一、字段真名：真实结构能解析出来；旧字段名一个都不许再依赖
 *   二、防事故：登录者在前 / 只有登录者 / 内部ID当快手号 —— 全部不许误取
 *   三、窗口与伪造：长文案超旧 500 窗口仍命中；文案里伪造字段名骗不到
 *   四、护栏：锚点漂移（段内两个 user_id）、无 /profile/ 路径 → 一律返回空
 *   五、兼容：旧 kwaiId 字段、占位符 SSSSSSSSS、非法字符
 *   六、rendererDelay：HTML 先赢则 iframe 一次都不启动；含「iframe 先失败」回归
 *   七、接线：快手真的传了 rendererDelay，源码不再依赖 kwaiId 单锚点
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules \
 *     node tests/kuaishou-kwaid-userdefine.test.js [--verbose]
 *
 * 只读产品源码，不写任何东西。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM = null;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  JSDOM = null;
}

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const FETCHER_PATH = path.join(ROOT, 'src/content/shared/author-id-fetcher.js');
const EXTRACTOR_PATH = path.join(ROOT, 'src/content/extractors/kuaishou-social.js');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ======================== 真实样本 ======================== */

const AUTHOR_UID = '3xw4rt6264tk6m2';   // 作者内部 ID（主页 URL 里那段）
const AUTHOR_KWAI = 'xiaxinjia8888';    // 真快手号（页面上「快手号：」显示的就是它）
const SELF_UID = 1226566812;            // 当前登录者自己的数字 ID
const SELF_KWAI = '1226566812';         // `/rest/v/profile/get` 里把内部ID当快手号回的那条
const HOMEPAGE = `https://www.kuaishou.com/profile/${AUTHOR_UID}`;

/** 作者那一块（结构照抄实测 DOM：profile 在前，userDefineId 在后） */
function authorBlock(opts) {
  const o = opts || {};
  const uid = o.uid || AUTHOR_UID;
  const kwai = o.kwai === undefined ? AUTHOR_KWAI : o.kwai;
  const userText = o.userText === undefined ? '记录一下每天的成长轨迹' : o.userText;
  return '"userProfile":{"gender":"F","isFollowing":true,'
    + '"ownerCount":{"fan":153009,"follow":227,"like":2073582,"photo_public":2508},'
    + '"profile":{"headurl":"http://p4.a.yximgs.com/uhead/AB/x_s.jpg",'
    + `"user_id":"${uid}","user_name":"盖世小美眉*",`
    + '"user_profile_bg_url":"//s2-10623.kwimgs.com/kos/x.svg",'
    + `"user_text":${JSON.stringify(userText)}},`
    + `"userDefineId":"${kwai}","showCollectTab":false}`;
}

/** 登录者自己那一块（`/rest/v/profile/get`）：注意 userDefineId == 它自己的 userId */
function selfBlock() {
  return '"eid":"3xf36283kjefara","mobile":"155****7806","userName":"饭饭爱跳舞",'
    + `"userId":${SELF_UID},"userDefineId":"${SELF_KWAI}","result":1`;
}

function page() {
  const parts = Array.prototype.slice.call(arguments);
  return '<html><head><script>window.INIT_STATE = {'
    + parts.join(',')
    + '}</script></head><body></body></html>';
}

/* ======================== 加载提取器（照 kuaishou-author-id-speed 的做法） ======================== */

if (typeof global.window === 'undefined') global.window = globalThis;

const Fetcher = require(FETCHER_PATH);
const EXTRACTOR_SRC = fs.readFileSync(EXTRACTOR_PATH, 'utf8');

/** jsdom 里把真源码 eval 进 window，拿到能真跑的 KuaishouSocialExtractor 实例 */
function makeExtractor() {
  return makeExtractorAt({});
}

/** 可指定 url / body / Apollo 缓存的版本（第八节要用） */
function makeExtractorAt(opts) {
  const o = opts || {};
  const dom = new JSDOM('<!doctype html><html><body>' + (o.body || '') + '</body></html>', {
    url: o.url || 'https://www.kuaishou.com/short-video/3xabc123',
    runScripts: 'outside-only'
  });
  const win = dom.window;
  win.BaseExtractor = class BaseExtractor {};
  win.ClipMateLog = { debug() {}, info() {}, warn() {}, error() {} };
  win.MediaExtractor = class MediaExtractor {};
  if (o.apollo !== undefined) win.__APOLLO_STATE__ = o.apollo;
  win.eval(EXTRACTOR_SRC);
  const Ctor = win.KuaishouSocialExtractor;
  if (!Ctor) return null;
  return new Ctor();
}

const realFetch = global.fetch;
function useFetch(impl) { global.fetch = impl; }
function restoreFetch() {
  if (realFetch) global.fetch = realFetch;
  else delete global.fetch;
}

/* ======================== 一、字段真名 ======================== */

function section1(ex) {
  section('一、字段真名：真实结构里 userDefineId 能解析出来（旧代码找不到）');

  const html = page(authorBlock());

  eq('[真名] 作者块能解析出快手号', ex.parseKwaiIdFromHtml(html, HOMEPAGE), AUTHOR_KWAI);

  // 现场证据：整份样本里根本没有 kwaiId 这个词 —— 旧实现怎么找都是空
  truthy('[真名] 样本里确实没有 kwaiId 字样（旧实现必然落空）',
    html.indexOf('kwaiId') < 0);
  truthy('[真名] 样本里有 userDefineId（真名）',
    html.indexOf('"userDefineId"') >= 0);

  // 主页 URL 带查询串也要认（详情页跳过来常带 ?source=SEARCH）
  eq('[真名] 主页带 ?source= 查询串也能锚定',
    ex.parseKwaiIdFromHtml(html, HOMEPAGE + '?source=SEARCH'), AUTHOR_KWAI);
}

/* ======================== 二、防事故 ======================== */

function section2(ex) {
  section('二、防事故：登录者自己绝不许被当成作者');

  // 1) 最危险顺序：登录者那块排在前面（抓第一个一定错）
  const both = page(selfBlock(), authorBlock());
  eq('[事故] 登录者在前、作者在后 → 必须取作者的快手号',
    ex.parseKwaiIdFromHtml(both, HOMEPAGE), AUTHOR_KWAI);
  truthy('[事故] 结果绝不能是登录者那个内部ID',
    ex.parseKwaiIdFromHtml(both, HOMEPAGE) !== SELF_KWAI);

  // 2) 只有登录者那一块（作者资料没吐）→ 宁可空，也不许拿用户自己的号顶
  const onlySelf = page(selfBlock());
  eq('[事故] 只有登录者数据时返回空串（不许拿用户自己的号冒充作者）',
    ex.parseKwaiIdFromHtml(onlySelf, HOMEPAGE), '');

  // 3) 作者块里把内部ID当快手号回（接口的另一种形态）→ 也不许认
  const idAsKwai = page(authorBlock({ kwai: AUTHOR_UID }));
  eq('[事故] userDefineId 等于内部ID时不认（那是内部ID不是快手号）',
    ex.parseKwaiIdFromHtml(idAsKwai, HOMEPAGE), '');
}

/* ======================== 三、窗口与伪造 ======================== */

function section3(ex) {
  section('三、窗口与伪造：长文案要命中，伪装的字段名不许骗到');

  // 旧实现窗口只有 500 字符；文案一长就跨不过去
  const longText = '长文案测试'.repeat(400); // 约 2000 字，远超 500
  const longHtml = page(authorBlock({ userText: longText }));
  eq('[窗口] user_text 约 2000 字仍能命中（旧 500 窗口会落空）',
    ex.parseKwaiIdFromHtml(longHtml, HOMEPAGE), AUTHOR_KWAI);

  // 用户在简介里写 "userDefineId":"xxx" —— JSON 转义后是 \"userDefineId\"，骗不到
  const fakeText = '我说的"userDefineId":"fake_evil"怎么样';
  const fakeHtml = page(authorBlock({ userText: fakeText }));
  eq('[伪造] 文案里伪造的字段名骗不到（转义后不是合法字段）',
    ex.parseKwaiIdFromHtml(fakeHtml, HOMEPAGE), AUTHOR_KWAI);
}

/* ======================== 四、护栏 ======================== */

function section4(ex) {
  section('四、护栏：锚不住就返回空，绝不猜');

  // 段内出现第二个 user_id = 窗口漂到别人身上了 → 放弃
  const drift = page('"userProfile":{"profile":{"user_id":"' + AUTHOR_UID
    + '","user_name":"a"},"profile2":{"user_id":"someone_else_x","user_name":"b"}'
    + ',"userDefineId":"wrong_one"}');
  eq('[护栏] 段内出现两个 user_id（锚点漂移）时放弃',
    ex.parseKwaiIdFromHtml(drift, HOMEPAGE), '');

  // 主页 URL 不是 /profile/ 形态（比如作品页地址）→ 没有锚，不许猜
  const html = page(authorBlock());
  eq('[护栏] homepage 没有 /profile/ 路径时返回空串',
    ex.parseKwaiIdFromHtml(html, 'https://www.kuaishou.com/short-video/3xabc123'), '');
  eq('[护栏] homepage 为空时返回空串', ex.parseKwaiIdFromHtml(html, ''), '');
  eq('[护栏] html 为空时返回空串', ex.parseKwaiIdFromHtml('', HOMEPAGE), '');
}

/* ======================== 五、兼容 ======================== */

function section5(ex) {
  section('五、兼容：旧 kwaiId 字段、占位符、非法字符');

  // 老字段仍然认（有些接口形态还是 kwaiId）
  eq('[兼容] 只有旧 kwaiId 字段时仍能命中',
    ex.parseKwaiIdFromHtml(page('"author":{"id":"x","kwaiId":"legacy123"}'), HOMEPAGE), 'legacy123');

  // 占位符：服务端没数据时吐 SSSSSSSSS
  eq('[兼容] 占位符 SSSSSSSSS 不认',
    ex.parseKwaiIdFromHtml(page(authorBlock({ kwai: 'SSSSSSSSS' })), HOMEPAGE), '');

  // 带非法字符
  eq('[兼容] 含空格/引号的值不认',
    ex.parseKwaiIdFromHtml(page(authorBlock({ kwai: 'bad id!' })), HOMEPAGE), '');

  // 正常快手号里的下划线和点要认
  eq('[兼容] 下划线/点组成的快手号正常认',
    ex.parseKwaiIdFromHtml(page(authorBlock({ kwai: 'fan.fan_2026' })), HOMEPAGE), 'fan.fan_2026');
}

/* ======================== 六、rendererDelay ======================== */

async function section6() {
  section('六、rendererDelay：HTML 先赢则 iframe 一次都不启动');

  // 1) HTML 在延时内命中 → renderer 调用次数必须是 0（主页请求 2 次 → 1 次）
  let rendererCalls = 0;
  useFetch(async () => ({ ok: true, status: 200, text: async () => authorBlock() }));
  const t0 = Date.now();
  const fast = await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: (html) => 'html_wins',
    renderer: async () => { rendererCalls += 1; return 'renderer_value'; },
    rendererDelay: 150,
    validate: (v) => !!v
  });
  eq('[延时] HTML 命中后用的是 HTML 的值', fast, 'html_wins');
  const cost1 = Date.now() - t0; // 必须在 sleep 之前取，否则量到的是 sleep 的时间
  truthy('[延时] 返回很快，不白等 iframe（< 200ms）', cost1 < 200, cost1 + 'ms');
  await sleep(220); // 等过延时点，确认它真的没启动
  eq('[延时] HTML 先赢时 renderer 一次都没被调用（省掉一次主页请求）', rendererCalls, 0);

  // 2) HTML 慢于延时 → renderer 照常并行开跑
  rendererCalls = 0;
  useFetch(async () => {
    await sleep(260);
    return { ok: true, status: 200, text: async () => 'x' };
  });
  const slow = await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: () => '',
    renderer: async () => { rendererCalls += 1; return 'renderer_wins'; },
    rendererDelay: 60,
    validate: (v) => !!v
  });
  eq('[延时] HTML 慢于延时点时 iframe 仍然照常开跑并给结果', slow, 'renderer_wins');
  eq('[延时] 这种情况下 renderer 确实被调用了', rendererCalls, 1);

  // 3) HTML 明确落空 → 不等延时，立刻开 iframe
  let started = false;
  let startedAt = 0;
  const base = Date.now();
  useFetch(async () => ({ ok: true, status: 200, text: async () => '<html>空壳</html>' }));
  await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: () => '',
    renderer: async () => { started = true; startedAt = Date.now() - base; return 'from_iframe'; },
    rendererDelay: 500,
    validate: (v) => !!v
  });
  // 注意：不能写 startedAt > 0 —— 同一毫秒内启动时差就是 0，会假红
  truthy('[延时] HTML 落空后立刻开 iframe（不等 500ms 延时）',
    started && startedAt < 300, 'startedAt=' + startedAt + 'ms');

  // 4) ★回归：iframe 先失败 + HTML 后成功，不许提前收工
  //    （v2.7.10 写这段时真踩到了：只数 rendererDone 就会在 HTML 还在飞时 resolve('')）
  useFetch(async () => {
    await sleep(120);
    return { ok: true, status: 200, text: async () => 'x' };
  });
  const late = await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: () => 'html_late_but_right',
    renderer: async () => '',          // 立刻失败
    validate: (v) => !!v
  });
  eq('[回归] iframe 先失败时不许提前返回空，要等 HTML 的迟到真值', late, 'html_late_but_right');

  // 5) 不传 rendererDelay → renderer 立刻启动（抖音/小红书老行为不变）
  let immediate = false;
  let immediateAt = 0;
  const base2 = Date.now();
  useFetch(async () => {
    await sleep(150);
    return { ok: true, status: 200, text: async () => 'x' };
  });
  await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: () => 'html_value',
    renderer: async () => { immediate = true; immediateAt = Date.now() - base2; return 'r'; },
    validate: (v) => !!v
  });
  truthy('[延时] 不传 rendererDelay 时 iframe 立即启动（老行为不变）',
    immediate && immediateAt < 60, 'immediateAt=' + immediateAt + 'ms');

  // 6) 两路皆空 → 空串，且不挂死
  useFetch(async () => ({ ok: true, status: 200, text: async () => '' }));
  const tEmpty = Date.now();
  const none = await Fetcher.raceIdSources({
    homepage: HOMEPAGE,
    parse: () => '',
    renderer: async () => '',
    rendererDelay: 80,
    validate: (v) => !!v
  });
  eq('[延时] 两路皆空返回空串', none, '');
  truthy('[延时] 两路皆空也及时返回（不挂死）', Date.now() - tEmpty < 600);

  restoreFetch();
}

/* ======================== 七、接线 ======================== */

/**
 * 只保留真代码行（剔掉注释）
 *
 * 踩过的坑：JSDoc 里写了 `rendererDelay: 800` 这句说明，断言用 match 去源码文本里找，
 * 结果实现删掉了、注释还在 → 测试照样绿（假绿）。注释不是实现。
 */
const CODE_ONLY = EXTRACTOR_SRC
  .split('\n')
  .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
  .join('\n');

function section7() {
  section('七、接线：快手真的传了 rendererDelay，源码不再只靠 kwaiId');

  truthy('[接线] kuaishou-social.js 真的传了 rendererDelay: 800（不是只写在注释里）',
    /rendererDelay\s*:\s*800\s*,/.test(CODE_ONLY));
  truthy('[接线] 解析函数的字段清单里有 userDefineId',
    /'userDefineId'/.test(CODE_ONLY));
  truthy('[接线] 锚点含 user_id（旧代码只认 "id"）',
    /'user_id'/.test(CODE_ONLY));
  truthy('[接线] 有「只认锚定结果」的专用函数 _parseKwaiIdAnchored',
    /_parseKwaiIdAnchored\s*\(/.test(CODE_ONLY));
  // 裸 userDefineId 的全局兜底必须不存在（那就是事故写法）
  falsy('[接线] 没有「全局抓第一个 userDefineId」的兜底',
    /patterns\.push\(\s*\/"userDefineId"/.test(CODE_ONLY));
}

/* ======================== 八、作者主页定位 ======================== */

function section8() {
  section('八、作者主页定位：绝不去抓「你自己」的主页');

  const SELF_PROFILE = '/profile/3xf36283kjefara';   // 评论区头像 = 登录者自己

  // 1) Apollo 键名自带作者ID（详情页实测形态）
  const byApollo = makeExtractorAt({
    apollo: { defaultClient: {
      ['VisionVideoDetailAuthor:' + AUTHOR_UID]: { id: AUTHOR_UID, name: '盖世小美眉*' },
      'VisionVideoDetailPhoto:3xd6z5j72953xm4': { id: '3xd6z5j72953xm4' }
    } }
  });
  eq('[定位] Apollo 里的 VisionVideoDetailAuthor 键直接给出作者主页',
    byApollo && byApollo.extractAuthorHomepage(),
    'https://www.kuaishou.com/profile/' + AUTHOR_UID);

  // 2) Apollo 里有多个不同作者 → 不猜，退回老路（没有 DOM 链接就只有空）
  const multiApollo = makeExtractorAt({
    apollo: { defaultClient: {
      'VisionVideoDetailAuthor:author_aaa': {},
      'VisionVideoDetailAuthor:author_bbb': {}
    } }
  });
  eq('[定位] 预取了多个不同作者时不猜（返回空而不是随便挑一个）',
    multiApollo && multiApollo.extractAuthorHomepage(), '');

  // 3) 没有 Apollo：作者区链接优先，即便评论区的「自己」排在前面
  const domAuthorFirst = makeExtractorAt({
    body: '<a class="comment-profile" href="' + SELF_PROFILE + '"></a>'
      + '<div class="profile-user"><a class="profile-user-name" href="/profile/' + AUTHOR_UID + '"></a></div>'
  });
  eq('[定位] 作者区（.profile-user）优先，取作者不取自己',
    domAuthorFirst && domAuthorFirst.extractAuthorHomepage(),
    'https://www.kuaishou.com/profile/' + AUTHOR_UID);

  // 4) 只有评论区「自己」那一条 → 必须返回空（旧代码会抓自己的主页）
  const selfOnly = makeExtractorAt({
    body: '<a class="comment-profile" href="' + SELF_PROFILE + '"></a>'
  });
  eq('[定位] 只有评论区自己的链接时返回空（宁可慢，不许抓自己）',
    selfOnly && selfOnly.extractAuthorHomepage(), '');

  // 5) 没有 .profile-user 包裹，但作者链接在前 → 照旧取第一个
  const plainBoth = makeExtractorAt({
    body: '<a href="/profile/' + AUTHOR_UID + '"></a><a class="comment-profile" href="' + SELF_PROFILE + '"></a>'
  });
  eq('[定位] 没有作者区包裹时按顺序取第一个（作者在前）',
    plainBoth && plainBoth.extractAuthorHomepage(),
    'https://www.kuaishou.com/profile/' + AUTHOR_UID);

  // 6) 没有作者区包裹，且「自己」排在前面 → 排除后仍取作者
  const selfFirst = makeExtractorAt({
    body: '<a class="comment-profile" href="' + SELF_PROFILE + '"></a>'
      + '<a href="/profile/' + AUTHOR_UID + '"></a>'
  });
  eq('[定位] 评论区自己排在前时，排除它之后取作者',
    selfFirst && selfFirst.extractAuthorHomepage(),
    'https://www.kuaishou.com/profile/' + AUTHOR_UID);

  // 7) URL 带 ?userId= 时仍然优先（老行为不变）
  const byUrl = makeExtractorAt({
    url: 'https://www.kuaishou.com/short-video/3xabc?userId=' + AUTHOR_UID
  });
  eq('[定位] URL 带 ?userId= 时优先用它（老行为不变）',
    byUrl && byUrl.extractAuthorHomepage(),
    'https://www.kuaishou.com/profile/' + AUTHOR_UID);
}

/* ======================== 主流程 ======================== */

(async () => {
  // 挂死 = 假绿：到点必须报失败并退出，不许静默挂着
  const watchdog = setTimeout(() => {
    console.log(`\n${C.red}❌ 测试挂死超过 30 秒，强制失败退出${C.reset}`);
    process.exit(1);
  }, 30000);

  try {
    if (!JSDOM) {
      bad('[环境] jsdom 未安装，无法运行（需要 NODE_PATH 指到 workspace/node_modules）');
    } else {
      const ex = makeExtractor();
      if (!ex) {
        bad('[环境] 加载不到 KuaishouSocialExtractor');
      } else {
        section1(ex);
        section2(ex);
        section3(ex);
        section4(ex);
        section5(ex);
        await section6();
        section7();
        section8();
      }
    }
  } catch (e) {
    bad('[异常] 测试过程抛错: ' + (e && e.message), e && e.stack);
  }

  clearTimeout(watchdog);

  const total = pass + failures.length;
  console.log(`\n${failures.length ? C.red : C.green}${pass}/${total} 通过${C.reset}`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  ${C.red}·${C.reset} ${f.name}  ${C.gray}${f.detail || ''}${C.reset}`));
    process.exit(1);
  }
  process.exit(0);
})();
