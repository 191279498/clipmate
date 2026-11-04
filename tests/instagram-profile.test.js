/**
 * Instagram 个人主页提取器（v2.7.20）—— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = 接口的内部数字 `pk`；账号名 = username（用户 2026-10-31 拍板，跟快手同口径）
 *   C. 网址是干净地址：丢掉 `?hl=zh-cn` / `?igsh=…`
 *   D. 简介 = 统计行（粉丝 · 帖子，**不带关注**）+ 完整签名 + 外链
 *   E. 数字**照页面原样**（`5.5万` 不反解成 55468）
 *   F. 签名三档：桥节点 → meta（**必须校验用户名**）→ DOM（截断去尾）
 *   G. 外链要原始地址，不是 `l.instagram.com` 跳转壳
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   1. 页面 `<script>` 里的 `PolarisViewer` 是**当前登录者自己**（实测 `Shan San0421`），
 *      不是页面主人。谁把它引入主页链路，就会把用户自己的账号写进别人的档案。
 *   2. `meta[name=description]` 在 **SPA 站内跳转后不更新**（实测连跳两个号，meta 一直停在
 *      最开始那个）。不校验用户名就照抄，会把别人的简介记到当前账号上。
 *   两件事都用「行为断言 + 源码断言」双重钉死。
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge）
 *   /cartierawards/（Cartier Women's Initiative，走 XHR /api/graphql 取样）
 *   /uni_mitsubishi_pencil/（uni 三菱鉛筆，首屏 SSR，meta 带全文）
 *   /zengsong9/（赠送，无简介）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function truthy(name, cond, detail) { if (cond) ok(name); else bad(name, detail); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}
function section(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

/**
 * 剥掉注释再断言源码。
 *
 * ⚠️ 不剥就会踩「假绿/假红」的老坑：文件头注释里必须写着
 * 「绝不碰 PolarisViewer」，直接 indexOf 会被自己的注释命中，
 * 测试就永远红（这次一次就踩上了）。
 * `(^|[^:])` 是为了别把 `https://…` 里的 `//` 当注释起点。
 */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ 真机样本 ============================ */

const USER = 'cartierawards';
const BASE_URL = 'https://www.instagram.com/' + USER + '/';

/** 真机 `/api/graphql` 响应里 data.user 的关键字段（2026-10-31 实拍） */
const BRIDGE_ROW = {
  u: USER,
  pk: '582782014',
  fn: "Cartier Women's Initiative",
  bio: 'Driving change by empowering women impact entrepreneurs.',
  ext: 'http://bit.ly/m/CartierWomensInitiative',
  fc: 55468,
  gc: 446,
  mc: 1079,
  pv: 0,
  vf: 1
};

/** 桥节点整份（格式与 instagram-net-hook.js 写出来的一致，v2） */
function netNode(profiles) {
  return JSON.stringify({ v: 2, ts: 1746000000000, media: {}, profiles: profiles || {} });
}

/**
 * 真机 header 的最小复刻（2026-10-31 cartierawards 实拍）
 *
 * 必须照真机写的地方：
 *   1. 用户名和昵称是**两个独立 span**，用户名在前；
 *   2. 统计是「数字 span」+「标签 span」两个独立元素（不是一段文本）；
 *   3. bio 段落的类名是 `_ap3a _aaco ...`，且真机渲染出来的文本带 `... 更多` 尾巴；
 *   4. 外链的 href 是 `l.instagram.com/?u=<编码后的真实地址>`。
 */
function headerHtml(opts) {
  const o = opts || {};
  const stats = o.stats === false ? '' : (o.stats === 'text' ? `
    <ul>
      <li><span class="html-span">4135</span>帖子</li>
      <li><a href="#"><span class="html-span">1661万</span>粉丝</a></li>
      <li><a href="#"><span class="html-span">3</span>关注</a></li>
    </ul>` : `
    <ul>
      <li><span class="html-span">1079</span><span>帖子</span></li>
      <li><a href="#"><span class="html-span">5.5万</span><span>粉丝</span></a></li>
      <li><a href="#"><span class="html-span">446</span><span>关注</span></a></li>
    </ul>`);
  const bio = o.bio === false ? '' : `
    <div>
      <span class="_ap3a _aaco _aacu _aacx _aad7 _aade">Driving change by empowering women impact entrepreneurs.</span>
      <button>更多</button>
    </div>`;
  const link = o.link === false ? '' : `
    <a href="https://l.instagram.com/?u=http%3A%2F%2Fbit.ly%2Fm%2FCartierWomensInitiative&amp;e=AUBPqmy">www.mpuni.co.jp</a>`;
  return `
  <header>
    <a href="/${o.user || USER}/"><img alt="avatar"></a>
    <section>
      <h2><span class="_aa_c">${o.user || USER}</span></h2>
      <span class="x1lliihq x1plvlek xryxfnj">${o.nick || "Cartier Women's Initiative"}</span>
      ${stats}
      ${bio}
      ${link}
    </section>
  </header>`;
}

function pageHtml(opts) {
  const o = opts || {};
  // ⚠️ 这里的 meta 签名必须与 BRIDGE_ROW.bio **明显不同**。
  //    写成一样的话，「桥优先」和「meta 优先」两种实现都得出同一个结果，
  //    变异 ④（把 meta 提到桥前面）就咬不住 —— 第一版正是这么绿掉的。
  const meta = (o.metaDesc === undefined)
    ? '167K 位粉丝、已关注 266 人、 1,317 篇帖子 - Instagram 用户 Cartier Women\'s Initiative (@cartierawards)：“META 里那份签名，长度和内容都不一样”'
    : o.metaDesc;
  return `<!doctype html><html><head>
    <meta name="description" content="${String(meta).replace(/"/g, '&quot;')}">
    <script type="application/json">{"require":[["PolarisViewer",[],{"data":{"biography":"自己的简介","full_name":"Shan San0421","id":"1396136356"}},1]]}</script>
  </head><body>${headerHtml(o)}</body></html>`;
}

/** 按 manifest 顺序装内容脚本 */
function makePage({ url, html, profiles }) {
  const withBridge = html.replace('</body>',
    `<script type="application/json" id="clipmate-instagram-net">${netNode(profiles)}</script></body>`);
  const dom = new JSDOM(withBridge, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/shared/country-names.js',
    'src/shared/country-extract.js',
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-date.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/shared/instagram-entry-context.js',
    'src/content/shared/instagram-inline-data.js',
    'src/content/extractors/instagram-profile.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));
  return w;
}

async function extract(w) {
  const ex = new w.InstagramProfileExtractor();
  return await ex.extractAllFields();
}

/**
 * 给 header 装一份 innerText（v2.7.21）
 *
 * jsdom **没有实现 innerText**（读出来是 undefined），但真机 Chrome 有。
 * 「统计数字照页面原样」这条在真机上是靠 innerText 逐行配对实现的，
 * 不装这一份，`_statFromLines` 永远返回空，测试就会以为走了接口兜底是正常的 ——
 * 正是这个缺口让 v2.7.20 的「照页面原样」在真机上一次都没生效。
 */
function setHeaderInnerText(w, text) {
  const h = w.document.querySelector('header');
  Object.defineProperty(h, 'innerText', { value: text, configurable: true, writable: true });
  return h;
}

/* ============================ 跑 ============================ */
(async () => {

  /* ==================== 1. 六列契约（桥节点齐备） ==================== */
  section('1. 六列契约：列名/列序/取值');

  const w1 = makePage({ url: BASE_URL, html: pageHtml(), profiles: { [USER]: BRIDGE_ROW } });
  const r1 = await extract(w1);

  // 装配器还会附三个元数据键（mediaType / personKind / sourceSite），那是给渲染层看的，
  // 不算「内容列」—— 只断言内容列恰好这 6 个且顺序一致（与快手/小红书同款写法）。
  const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];
  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('平台 = Instagram', r1['平台'], 'Instagram');
  eq('昵称取 full_name（接口一手）', r1['昵称'], "Cartier Women's Initiative");
  eq('账号ID = 内部数字 pk', r1['账号ID'], '582782014');
  eq('账号名 = username', r1['账号名'], 'cartierawards');
  eq('网址是干净主页地址', r1['网址'], 'https://www.instagram.com/cartierawards/');

  /* ==================== 2. 简介三段：统计 + 签名 + 外链 ==================== */
  section('2. 简介 = 统计行 + 签名 + 外链');

  const lines = String(r1['简介']).split('\n');
  eq('第一行是统计行（粉丝 · 帖子，不带关注）', lines[0], '粉丝：5.5万 · 帖子：1079');
  truthy('统计行里不许出现「关注」', !/关注/.test(lines[0]), lines[0]);
  eq('第二行是签名全文', lines[1], 'Driving change by empowering women impact entrepreneurs.');
  eq('第三行是外链（原始地址，不是 l.instagram.com 壳）', lines[2], 'http://bit.ly/m/CartierWomensInitiative');
  truthy('外链里不许出现跳转壳域名', !/l\.instagram\.com/.test(lines[2] || ''), lines[2]);

  // 4.1b 桥里没有 external_url 时才走 DOM：必须把 `?u=` 里的真实地址解出来，
  //      不能把 `l.instagram.com/?u=…` 这个跳转壳存进档案。
  const wLink = makePage({
    url: BASE_URL,
    html: pageHtml({ bio: false }),
    profiles: { [USER]: Object.assign({}, BRIDGE_ROW, { ext: '' }) }
  });
  const rLink = await extract(wLink);
  const linkLine = String(rLink['简介']).split('\n').pop();
  eq('桥没有外链时，从 DOM 的 ?u= 解出真实地址', linkLine, 'http://bit.ly/m/CartierWomensInitiative');
  truthy('解出来的地址里没有跳转壳域名', !/l\.instagram\.com/.test(linkLine), linkLine);

  /* ==================== 3. 数字照页面原样 ==================== */
  section('3. 数字口径：照页面原样，不反解');

  truthy('粉丝取页面的 5.5万（而不是接口的 55468）',
    /粉丝：5\.5万/.test(lines[0]) && !/55468/.test(lines[0]), lines[0]);
  truthy('帖子取页面的 1079', /帖子：1079/.test(lines[0]), lines[0]);

  // 页面没有统计时的兜底：用接口精确值，原样存整数（不做缩写换算）
  const w3 = makePage({ url: BASE_URL, html: pageHtml({ stats: false }), profiles: { [USER]: BRIDGE_ROW } });
  const r3 = await extract(w3);
  eq('页面读不到统计时，用接口精确值兜底', String(r3['简介']).split('\n')[0], '粉丝：55468 · 帖子：1079');

  /* ---------- 3.2 真机形态：标签是纯文字节点（v2.7.21 修的 Bug） ---------- */
  // 真机 2026-10-31 实测（cartierawards / cartier 两个号都是这样）：
  //   DOM 是 `<span>1661万</span>粉丝` —— 标签是**文字节点、不是 span**。
  //   v2.7.20 只写了「按标签 span 配对」，真机上一次都没匹配上，
  //   全被接口精确值接走 → 页面 `5.5万` 被存成 `55468`，口径等于没实现。
  {
    const wText = makePage({
      url: BASE_URL,
      html: pageHtml({ stats: 'text' }),
      // 接口值刻意与页面不同：走接口就会露馅（16618514 / 9999）
      profiles: { [USER]: Object.assign({}, BRIDGE_ROW, { fc: 16618514, mc: 9999 }) }
    });
    setHeaderInnerText(wText, [
      USER,
      "Cartier Women's Initiative",
      '4135帖子',
      '1661万粉丝',
      '3关注',
      'Driving change by empowering women impact entrepreneurs.',
      'bit.ly/m/CartierWomensInitiative'
    ].join('\n'));
    const rText = await extract(wText);
    eq('真机形态（标签是文字节点）：粉丝照页面原样 1661万',
      String(rText['简介']).split('\n')[0], '粉丝：1661万 · 帖子：4135');
    truthy('没有退回接口精确值 16618514',
      !/16618514/.test(String(rText['简介'])), String(rText['简介']).split('\n')[0]);
  }

  // 干扰行不能被认成统计：「粉丝包括xxx、yyy +12人」这种是关注者名单，不是粉丝数
  {
    const wDecoy = makePage({
      url: BASE_URL,
      html: pageHtml({ stats: false }),
      profiles: { [USER]: BRIDGE_ROW }
    });
    setHeaderInnerText(wDecoy, [
      USER,
      '粉丝包括cakecakeww、cvoyagez +12人',
      'Alexandria 2024 — 12'
    ].join('\n'));
    const rDecoy = await extract(wDecoy);
    eq('干扰行（粉丝包括… +12人）不被当成粉丝数，仍走接口兜底',
      String(rDecoy['简介']).split('\n')[0], '粉丝：55468 · 帖子：1079');
  }

  // 英文界面/反序：`1,079 posts`、`followers 5.5K`
  {
    const wEn = makePage({
      url: BASE_URL,
      html: pageHtml({ stats: false }),
      profiles: { [USER]: Object.assign({}, BRIDGE_ROW, { fc: 1, mc: 2 }) }
    });
    setHeaderInnerText(wEn, ['Cartier', 'posts 1,079', 'followers 5.5K'].join('\n'));
    const rEn = await extract(wEn);
    eq('英文/反序两种写法都认（posts 1,079 / followers 5.5K）',
      String(rEn['简介']).split('\n')[0], '粉丝：5.5K · 帖子：1,079');
  }

  /* ==================== 4. 签名三档优先级 ==================== */
  section('4. 签名来源：桥节点 → meta（校验用户名）→ DOM');

  // 4.1 桥节点有 bio → 用它
  truthy('桥节点有 bio 时优先用桥（不被 meta 覆盖）',
    /empowering women impact entrepreneurs/.test(String(r1['简介'])) &&
    !/META 里那份签名|167K/.test(String(r1['简介'])), String(r1['简介']));

  // 4.2 桥节点没有这个号 → 用 meta（meta 里用户名一致）
  const metaFull = '关于卡地亚的简介第一行\n第二行内容\n第三行内容';
  const w4 = makePage({
    url: BASE_URL,
    html: pageHtml({ bio: false, metaDesc: `1,317 篇帖子 - Instagram 用户 Cartier Women's Initiative (@cartierawards)：“${metaFull}”` }),
    profiles: {}
  });
  const r4 = await extract(w4);
  eq('桥没有时用 meta，且换行保留', String(r4['简介']).split('\n').slice(1, 4), metaFull.split('\n'));
  truthy('meta 里的包裹文字（1,317 篇帖子 / Instagram 用户）不许残留',
    !/Instagram 用户|1,317 篇帖子/.test(String(r4['简介'])), String(r4['简介']));

  // 4.3 桥没有、meta 是**上一个号**的（用户名不一致）→ 必须拒用，落 DOM
  const staleMeta = `167K 位粉丝、已关注 266 人 - Instagram 用户 uni 三菱鉛筆 (@uni_mitsubishi_pencil)：“上一个号的简介”`;
  const w5 = makePage({
    url: BASE_URL,
    html: pageHtml({ metaDesc: staleMeta }),
    profiles: {}
  });
  const r5 = await extract(w5);
  truthy('meta 里的用户名对不上时，绝不采用（防串台）',
    !/上一个号的简介|uni 三菱鉛筆/.test(String(r5['简介'])), String(r5['简介']));
  truthy('这种情况下退回 DOM 的 bio（截断版）',
    /Driving change by empowering women/.test(String(r5['简介'])), String(r5['简介']));

  // 4.4 桥有 bio 但是空字符串（这个号真的没简介）→ 不该被当成「知道没有」而放弃 meta/DOM？
  //     真机语义：接口明确返回 "" = 这个号没简介，此时 meta / DOM 也是空，最终简介只剩统计行+外链。
  const w6 = makePage({
    url: BASE_URL,
    html: pageHtml({ bio: false, link: false }),
    profiles: { [USER]: Object.assign({}, BRIDGE_ROW, { bio: '' }) }
  });
  const r6 = await extract(w6);
  eq('接口明说没简介时，简介只剩统计行', String(r6['简介']).split('\n')[0], '粉丝：5.5万 · 帖子：1079');
  truthy('没有简介时不许把昵称塞进简介', !/Cartier Women's Initiative/.test(String(r6['简介'])), String(r6['简介']));

  /* ==================== 5. DOM 兜底：截断尾巴必须剪掉 ==================== */
  section('5. DOM 兜底：`... 更多` 尾巴必须剪掉');

  const w7 = makePage({
    url: BASE_URL,
    html: pageHtml({ metaDesc: '', bio: false }).replace('</section>',
      `<div><span class="_ap3a _aaco">前面一段说明文字，足够长的一段内容... 更多</span><button>更多</button></div></section>`),
    profiles: {}
  });
  const r7 = await extract(w7);
  truthy('截断尾巴「... 更多」被剪掉', !/\.\.\.\s*更多/.test(String(r7['简介'])), String(r7['简介']));
  truthy('截断正文本身保留', /前面一段说明文字/.test(String(r7['简介'])), String(r7['简介']));

  /* ==================== 6. 桥节点按用户名索引（串台防御） ==================== */
  section('6. 桥节点按 username 索引：同页有多个号也不串台');

  const w8 = makePage({
    url: BASE_URL,
    html: pageHtml(),
    profiles: {
      // 故意把别人的资料排在前面，且字段明显不同
      uni_mitsubishi_pencil: { u: 'uni_mitsubishi_pencil', pk: '111', fn: 'uni 三菱鉛筆', bio: '别人的简介', ext: '', fc: 1, gc: 2, mc: 3, pv: 0, vf: 1 },
      [USER]: BRIDGE_ROW
    }
  });
  const r8 = await extract(w8);
  eq('昵称取当前地址那个号', r8['昵称'], "Cartier Women's Initiative");
  eq('账号ID 取当前地址那个号', r8['账号ID'], '582782014');
  truthy('简介里不许出现别人的内容', !/uni 三菱鉛筆|别人的简介/.test(JSON.stringify(r8)), JSON.stringify(r8));

  /* ==================== 7. 红线：绝不碰 PolarisViewer ==================== */
  section('7. 红线：PolarisViewer 是登录者自己，绝不采用');

  // 页面里埋了 PolarisViewer（biography=自己的简介 / Shan San0421），桥是一个空表
  const w9 = makePage({ url: BASE_URL, html: pageHtml({ bio: false, link: false }), profiles: {} });
  const r9 = await extract(w9);
  truthy('资料里不许出现登录者自己的名字', !/Shan San0421/.test(JSON.stringify(r9)), JSON.stringify(r9));
  truthy('资料里不许出现登录者自己的简介', !/自己的简介/.test(JSON.stringify(r9)), JSON.stringify(r9));

  // 源码断言：谁把 PolarisViewer / INIT_STATE 引入 IG 主链路就打红。
  // ⚠️ 必须剥注释：这三个文件的文件头都写着「绝不碰 PolarisViewer」这句红线说明，
  //    直接 indexOf 会被自己的注释命中（老坑，这次一次就踩上）。
  const PROFILE_CODE = stripComments(fs.readFileSync(P('src/content/extractors/instagram-profile.js'), 'utf8'));
  const HOOK_CODE = stripComments(fs.readFileSync(P('src/content/instagram-net-hook.js'), 'utf8'));
  const INLINE_CODE = stripComments(fs.readFileSync(P('src/content/shared/instagram-inline-data.js'), 'utf8'));

  truthy('提取器里不许出现 PolarisViewer', PROFILE_CODE.indexOf('PolarisViewer') === -1);
  truthy('钩子里不许出现 PolarisViewer', HOOK_CODE.indexOf('PolarisViewer') === -1);
  truthy('读取侧不许出现 PolarisViewer', INLINE_CODE.indexOf('PolarisViewer') === -1);
  truthy('三处都不许出现 INIT_STATE / profile/get（那是别的站的坑）',
    !/INIT_STATE|profile\/get|userInfo/.test(PROFILE_CODE + HOOK_CODE + INLINE_CODE));
  truthy('钩子只认 data.user（不碰 data.viewer）',
    /var u = d\.user;/.test(HOOK_CODE) && !/d\.viewer/.test(HOOK_CODE),
    '认了 viewer 就会把登录者自己写进档案');
  truthy('钩子用 biography 这个键当「主页资料」闸口',
    /hasOwnProperty\.call\(u, 'biography'\)/.test(HOOK_CODE));

  /* ==================== 8. 钩子 ingestProfile 行为 ==================== */
  section('8. 钩子 ingestProfile：认得主页响应，不认作者碎片');

  /** 在主世界沙箱里跑 hook（它只依赖 window / document） */
  function makeHook(w) {
    w.eval(fs.readFileSync(P('src/content/instagram-net-hook.js'), 'utf8'));
    return w.ClipMateInstagramNetParser;
  }

  const wHook = makePage({ url: BASE_URL, html: pageHtml({ bio: false, link: false }), profiles: {} });
  const parser = makeHook(wHook);

  // 8.1 标准主页响应
  const homeResp = JSON.stringify({
    data: {
      user: {
        pk: '582782014', username: 'cartierawards', full_name: "Cartier Women's Initiative",
        biography: 'Driving change by empowering women impact entrepreneurs.',
        external_url: 'http://bit.ly/m/CartierWomensInitiative',
        follower_count: 55468, following_count: 446, media_count: 1079,
        is_private: false, is_verified: true
      }
    }
  });
  eq('主页响应被收下（返回 1）', parser.ingestProfile(homeResp), 1);
  const snap = parser.snapshot();
  truthy('按 username 建索引', !!snap.profiles['cartierawards'], JSON.stringify(snap.profiles));
  eq('pk 原样保存', snap.profiles['cartierawards'].pk, '582782014');
  eq('biography 全文保存', snap.profiles['cartierawards'].bio, 'Driving change by empowering women impact entrepreneurs.');

  // 8.2 帖子响应（作者碎片，没有 biography 键）→ 不收。
  // ⚠️ `debug_label: 'biography'` 是**故意**放的：ingestProfile 第一行有一条廉价过滤
  //    `text.indexOf('"biography"') === -1`（带引号，是为了不撞上 biography_with_entities），
  //    不塞这个字符串的话请求在廉价过滤那行就退了，`hasOwnProperty('biography')` 那道
  //    真闸口根本跑不到 —— 变异 ⑧ 删掉闸口也照样绿（第一版就是这么假绿的）。
  parser.reset();
  const postResp = JSON.stringify({
    data: {
      user: { pk: '999', username: 'someone', full_name: '某人' },
      debug_label: 'biography'
    }
  });
  eq('作者碎片（无 biography 键）不收', parser.ingestProfile(postResp), 0);
  truthy('作者碎片没被写进 profiles', !parser.snapshot().profiles['someone'], JSON.stringify(parser.snapshot().profiles));

  // 8.3 登录者自己的 viewer 响应 → 不收
  parser.reset();
  const viewerResp = JSON.stringify({
    data: { viewer: { pk: '1396136356', username: 'yaoyanhuozongfx', biography: '我自己的简介' } }
  });
  eq('data.viewer（登录者自己）不收', parser.ingestProfile(viewerResp), 0);

  // 8.4 沉浸流 media 响应 → 不收
  parser.reset();
  const mediaResp = JSON.stringify({
    data: { xdt_api__v1__clips__home__connection_v2: { edges: [{ node: { media: { code: 'DfEmtZgTeu_', taken_at: 1793263488 } } }] } }
  });
  eq('media 响应（没有 biography）不收', parser.ingestProfile(mediaResp), 0);

  // 8.5 空简介也是「有效资料」（这个号确实没写简介）
  parser.reset();
  const emptyBio = JSON.stringify({ data: { user: { pk: '1', username: 'zengsong9', full_name: '赠送', biography: '' } } });
  eq('空简介也算有效（biography 键在）', parser.ingestProfile(emptyBio), 1);
  eq('空简介原样保存为空串', parser.snapshot().profiles['zengsong9'].bio, '');

  /* ==================== 9. 入口判定：主页要出按钮 ==================== */
  section('9. 入口判定：个人主页不是列表页');

  const wE = makePage({ url: BASE_URL, html: pageHtml({ bio: false, link: false }), profiles: {} });
  const ctx = wE.InstagramEntryContext;

  truthy('/cartierawards/ 是主页', ctx.isProfilePath('https://www.instagram.com/cartierawards/'));
  truthy('/uni_mitsubishi_pencil 是主页（无尾斜杠）', ctx.isProfilePath('https://www.instagram.com/uni_mitsubishi_pencil'));
  eq('/p/<code>/ 不是主页', ctx.isProfilePath('https://www.instagram.com/p/DPodeoFEq8n/'), false);
  eq('/explore/ 不是主页', ctx.isProfilePath('https://www.instagram.com/explore/'), false);
  eq('/<user>/reels/ 不是主页', ctx.isProfilePath('https://www.instagram.com/vladaneslava/reels/'), false);
  eq('/stories/... 不是主页', ctx.isProfilePath('https://www.instagram.com/stories/highlights/123/'), false);
  eq('/p/ 这种光秃秃的类型段不是主页', ctx.isProfilePath('https://www.instagram.com/p/'), false);

  truthy('主页有可提内容（按钮要出）', ctx.hasExtractableContent('https://www.instagram.com/cartierawards/'));
  truthy('主页不算列表页（不许藏按钮）', ctx.isListEntry('https://www.instagram.com/cartierawards/') === false);
  truthy('/explore/ 仍算列表页', ctx.isListEntry('https://www.instagram.com/explore/') === true);
  truthy('/<user>/reels/ 仍算列表页', ctx.isListEntry('https://www.instagram.com/vladaneslava/reels/') === true);
  truthy('作品页有可提内容', ctx.hasExtractableContent('https://www.instagram.com/p/DPodeoFEq8n/'));
  truthy('旧接口 hasExtractableWork 语义不变（主页仍为 false）',
    ctx.hasExtractableWork('https://www.instagram.com/cartierawards/') === false);

  /* ==================== 10. 提取器选择与站点规则 ==================== */
  section('10. 工厂 / 检测器 / 规范化 / 注册');

  const FAC = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  const DET = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
  const BG = fs.readFileSync(P('src/background/background.js'), 'utf8');
  const NORM = fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8');
  const MF = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));

  truthy('工厂注册了 InstagramProfileExtractor（person 类型）',
    /className: 'InstagramProfileExtractor'/.test(FAC) && /types: \['person'\]/.test(FAC));
  truthy('工厂的 IG person 规则标了「必须排在通配 social 之前」',
    /Instagram 个人主页/.test(FAC) && /必须排在下面那条/.test(FAC));

  // 真正的顺序断言：person 规则的 pattern 必须在文件里出现在 IG 通配 social 那条之前，
  // 否则 `getExtractorByUrl` 按顺序取第一条 → 主页永远命中 social（这是这类规则最常见的翻车点）。
  const iLeftPerson = FAC.indexOf('/www\\.instagram\\.com\\/(?!');
  const iLeftSocial = FAC.indexOf("{ pattern: /www\\.instagram\\.com\\//, hostname: 'www.instagram.com', mediaType: 'social' }");
  truthy('person 规则在通配 social 规则**之前**（顺序错了主页就永远走 social）',
    iLeftPerson > -1 && iLeftSocial > -1 && iLeftPerson < iLeftSocial,
    `person@${iLeftPerson} social@${iLeftSocial}`);

  // 用真实 URL 读工厂规则（正则直接验，避免只做字符串断言）
  const igPersonRe = /www\.instagram\.com\/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)\/?(?:[?#]|$))[A-Za-z0-9_.]+\/?(?:[?#]|$)/;
  truthy('规则命中主页地址', igPersonRe.test('https://www.instagram.com/cartierawards/'));
  truthy('规则命中带 ?hl= 的主页地址', igPersonRe.test('https://www.instagram.com/cartierawards/?hl=zh-cn'));
  truthy('规则不命中帖子地址', !igPersonRe.test('https://www.instagram.com/p/DPodeoFEq8n/'));
  truthy('规则不命中探索页', !igPersonRe.test('https://www.instagram.com/explore/'));
  truthy('规则不命中 reels 列表', !igPersonRe.test('https://www.instagram.com/vladaneslava/reels/'));

  truthy('media-detector 支持 regex 规则', /if \(rule\.regex\)/.test(DET));
  truthy('media-detector 的 IG 配置改成多规则', /'www\.instagram\.com': \{[\s\S]{0,1500}?\n\s+rules: \[/.test(DET));
  truthy('background 的 IG 配置也改多规则（三处对齐）',
    /'www\.instagram\.com': \{[\s\S]{0,1500}?\n\s+rules: \[/.test(BG));

  // 两份 IG 正则必须逐字一致（改一处漏一处 = 弹窗和按钮行为不一致）
  const reInDet = (DET.match(/'www\.instagram\.com': \{[\s\S]{0,1500}?regex: '([^']+)'/) || [])[1] || '';
  const reInBg = (BG.match(/'www\.instagram\.com': \{[\s\S]{0,1500}?regex: '([^']+)'/) || [])[1] || '';
  truthy('两处都取到了 IG 正则', !!reInDet && !!reInBg, `det=${reInDet.length} bg=${reInBg.length}`);
  eq('media-detector 与 background 的 IG 正则逐字一致', reInDet, reInBg);

  // 用检测器真跑一遍：主页必须出 person，作品页必须出 social
  const wD = makePage({ url: BASE_URL, html: pageHtml({ bio: false, link: false }), profiles: {} });
  wD.eval(fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8'));
  const det = new wD.MediaTypeDetector();
  eq('检测器判主页 = person', det.detect('https://www.instagram.com/cartierawards/', wD.document), 'person');
  eq('检测器判帖子 = social', det.detect('https://www.instagram.com/p/DPodeoFEq8n/', wD.document), 'social');
  eq('检测器判探索页 = social（不是某个叫 explore 的人）',
    det.detect('https://www.instagram.com/explore/', wD.document), 'social');
  eq('检测器判 reels 列表 = social',
    det.detect('https://www.instagram.com/vladaneslava/reels/', wD.document), 'social');
  eq('检测器判 reels 沉浸流 = social',
    det.detect('https://www.instagram.com/reels/DfEmtZgTeu_/', wD.document), 'social');

  truthy('url-normalizer 有 IG 主页分支', /个人主页：单段/.test(NORM) && /IG_RESERVED/.test(NORM));

  truthy('manifest 注册了 instagram-profile.js',
    MF.content_scripts.some((cs) => (cs.js || []).some((x) => x === 'src/content/extractors/instagram-profile.js')));
  truthy('脚本排在 instagram-social.js 之后（同 world 顺序）', (() => {
    const js = MF.content_scripts[0].js;
    return js.indexOf('src/content/extractors/instagram-social.js') < js.indexOf('src/content/extractors/instagram-profile.js');
  })());

  /* ==================== 11. 入口显隐用 hasExtractableContent ==================== */
  section('11. 按钮显隐判据已切到 hasExtractableContent');

  const SPA = fs.readFileSync(P('src/content/ui/ig-spa-handler.js'), 'utf8');
  truthy('IgSpaMixin 用 hasExtractableContent 判显隐',
    /ctx\.hasExtractableContent\(\)/.test(SPA), '还用 hasExtractableWork 会把主页按钮藏掉');
  eq('IgSpaMixin 里不再用 hasExtractableWork', /ctx\.hasExtractableWork\(\)/.test(SPA), false);

  const MP = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
  truthy('modal-persistence 有 IG 主页 person 兜底', /instagram\.com\//.test(MP) && /igPath/.test(MP));

  /* ==================== 12. 版本号 ==================== */
  section('12. 版本号');
  eq('manifest 版本已升到 2.11.4', MF.version, '2.11.4');

  /* ==================== 真机形态预览 ==================== */
  if (process.argv.includes('--dump')) {
    console.log(`\n${C.bold}真机形态复刻（${BASE_URL}）${C.reset}`);
    for (const k of Object.keys(r1)) {
      console.log(`  【${k}】${String(r1[k] || '').replace(/\n/g, '\n         ')}`);
    }
  }

  console.log(`\n${C.bold}结果：${pass} 通过，${fail} 失败${C.reset}`);
  if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('测试崩了:', e); process.exit(1); });
