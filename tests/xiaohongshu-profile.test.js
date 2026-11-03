/**
 * 小红书个人主页提取器（v2.7.16）—— 契约测试
 *
 * 钉住五件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介），不多不少
 *   B. 账号ID 只从地址栏取（必须与作品页「作者ID」同串，否则 join 不上）
 *   C. 网址是**干净地址**，不带 xsec_token（那是会过期的临时令牌）
 *   D. 简介 = 统计行（粉丝/获赞/IP属地）+ 完整签名 + 标签区，顺序固定
 *   E. 桥数据带 urlUserId 闸口：不是当前这个人就一律不用（防 SPA 换人串台）
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   小红书页面内存里 `user.userInfo` 是**当前登录者自己**，不是页面主人。
 *   任何人往主页链路里引入 userInfo，都会把用户自己的昵称/简介记到别人档案上。
 *   第 5 节用源码断言把这条钉死。
 *
 * 取样来源：2026-10-30 真机（接管用户已登录 Edge）
 *   /user/profile/5b5ec8414eacab426643fe29（王弈可）
 *   DOM：.user-name / .user-redId / .user-IP / .user-desc / .user-interactions / .user-tags
 *   桥：__INITIAL_STATE__.user.userPageData.basicInfo
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

const USER_ID = '5b5ec8414eacab426643fe29';
const BASE_URL = 'https://www.xiaohongshu.com/user/profile/' + USER_ID;

/** 建一个 jsdom 页面，并按 manifest 顺序塞进内容脚本 */
function makePage({ url, html, bridge }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;

  // 桥节点：主世界脚本会写它，测试里直接预置（等价于桥刚跑完一拍）
  if (bridge !== null) {
    const node = w.document.createElement('script');
    node.id = 'clipmate-xhs-profile';
    node.type = 'application/json';
    node.textContent = JSON.stringify(bridge);
    w.document.body.appendChild(node);
  }

  const scripts = [
    'src/shared/country-names.js',
    'src/shared/country-extract.js',
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-date.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/xiaohongshu-profile.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));
  return w;
}

/**
 * 真机结构的最小复刻（2026-10-30 王弈可主页）
 * 注意 `.user-IP` 前面那个空格是**真机原样**（两个 span 之间没有块级换行），
 * 剥前缀时必须先 trim，否则会拿到「 IP属地：北京」这种带前导空格的脏值。
 */
const HTML_FULL = `<!DOCTYPE html><html><body>
  <div class="user">
    <div class="user-info">
      <div class="info">
        <div class="user-basic">
          <div class="user-nickname"><div class="user-name">王弈可</div></div>
          <div class="user-content">
            <span class="user-redId">小红书号：631287077</span><span class="user-IP"> IP属地：北京</span>
          </div>
        </div>
        <div class="user-desc">北理物理研究生，人工智能程序媛
马拉松爱好者，10K44，半马138，全马338</div>
        <div class="user-tags"><!--[-->
          <div class="tag-item"><div class="gender"><svg><use href="#female"/></svg><span class="gender-text">27岁</span></div></div>
          <div class="tag-item"><div>河北张家口</div></div>
          <div class="tag-item"><div>运动博主</div></div>
          <div class="tag-item"><div>北京理工大学</div></div>
        <!--]--></div>
        <div class="user-interactions"><!--[-->
          <div class="clickable"><span class="count">326</span><span class="shows">关注</span></div>
          <div class="clickable"><span class="count">9591</span><span class="shows">粉丝</span></div>
          <div class="clickable"><span class="count">11.3万</span><span class="shows">获赞与收藏</span></div>
        <!--]--></div>
      </div>
    </div>
  </div>
</body></html>`;

/** 桥上「数据已就绪」的形态（urlUserId 与地址栏一致） */
const BRIDGE_OK = {
  urlUserId: USER_ID,
  profile: {
    nickname: '王弈可',
    redId: '631287077',
    desc: '北理物理研究生，人工智能程序媛\n马拉松爱好者，10K44，半马138，全马338\n耐力骑行爱好者，1200km不间断骑行中国区女子记录：64h54min',
    ipLocation: '北京',
    tags: ['27岁', '河北张家口', '运动博主', '北京理工大学']
  }
};

(async () => {

  /* ==================== 1. 六列骨架 ==================== */
  section('1. 输出恰好 6 列，键序与清单一致');

  const w1 = makePage({ url: BASE_URL + '?xsec_token=ABC123', html: HTML_FULL, bridge: BRIDGE_OK });
  const ex1 = new w1.XiaohongshuProfileExtractor();
  const r1 = await ex1.extractAllFields();

  const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];
  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('媒体类型 = person', r1.mediaType, 'person');
  eq('记录形态 = account', r1.personKind, 'account');
  truthy('记录里没有影人字段（不串骨架）',
    r1['姓名'] === undefined && r1['国家'] === undefined && r1['出生日期'] === undefined);
  eq('平台 = 小红书', r1['平台'], '小红书');
  eq('昵称 = 王弈可', r1['昵称'], '王弈可');
  eq('账号ID = 地址栏 userId', r1['账号ID'], USER_ID);
  eq('账号名 = 小红书号（已剥前缀）', r1['账号名'], '631287077');
  eq('网址 = 干净地址（不带 xsec_token）', r1['网址'], BASE_URL);

  /* ==================== 2. 简介三段 ==================== */
  section('2. 简介 = 统计行 + 完整签名 + 标签区');

  const bio1 = r1['简介'];
  const lines1 = bio1.split('\n');
  eq('第一行是统计行', lines1[0], '粉丝：9591 · 获赞：11.3万 · IP属地：北京');
  eq('统计行不含「关注」', /关注/.test(lines1[0]), false);
  truthy('获赞照页面原样（11.3万，不反解成 113123）',
    lines1[0].indexOf('11.3万') > -1, lines1[0]);
  truthy('签名走桥里的**完整版**（含第三段「耐力骑行」，DOM 里没有）',
    bio1.indexOf('耐力骑行爱好者') > -1, bio1);
  eq('签名换行保留（三段三行）',
    ['北理物理研究生，人工智能程序媛', '马拉松爱好者，10K44，半马138，全马338', '耐力骑行爱好者，1200km不间断骑行中国区女子记录：64h54min']
      .every((s) => bio1.split('\n').indexOf(s) > -1), true);
  eq('末行是标签区（空格连接）', lines1[lines1.length - 1], '27岁 河北张家口 运动博主 北京理工大学');

  /* ==================== 3. 桥的 ID 闸口 ==================== */
  section('3. 桥数据带 urlUserId 闸口（不是这个人就不用）');

  // 换人：桥里还是上一个人的（SPA 换人时文档不换，桥可能没跟上）
  const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const w3 = makePage({
    url: BASE_URL, html: HTML_FULL,
    bridge: { urlUserId: OTHER, profile: { nickname: '别人', redId: '999', desc: '别人的签名', ipLocation: '上海', tags: ['别人的标签'] } }
  });
  const r3 = await new w3.XiaohongshuProfileExtractor().extractAllFields();
  eq('昵称没被桥带跑', r3['昵称'], '王弈可');
  eq('账号名没被桥带跑', r3['账号名'], '631287077');
  truthy('签名没被桥带跑（用 DOM 那份）',
    r3['简介'].indexOf('别人的签名') === -1 && r3['简介'].indexOf('北理物理研究生') > -1, r3['简介']);
  truthy('标签没被桥带跑', r3['简介'].indexOf('别人的标签') === -1, r3['简介']);

  // 桥明确说「这个人的数据还没到」→ 走 DOM
  const w4 = makePage({ url: BASE_URL, html: HTML_FULL, bridge: { urlUserId: USER_ID, profile: null } });
  const r4 = await new w4.XiaohongshuProfileExtractor().extractAllFields();
  eq('profile:null 时昵称走 DOM', r4['昵称'], '王弈可');
  truthy('profile:null 时签名走 DOM', r4['简介'].indexOf('北理物理研究生') > -1, r4['简介']);

  // 完全没有桥节点（主世界脚本没跑 / 被拦）
  const w5 = makePage({ url: BASE_URL, html: HTML_FULL, bridge: null });
  const r5 = await new w5.XiaohongshuProfileExtractor().extractAllFields();
  eq('没桥时昵称走 DOM', r5['昵称'], '王弈可');
  eq('没桥时统计行照样出来', r5['简介'].split('\n')[0], '粉丝：9591 · 获赞：11.3万 · IP属地：北京');
  truthy('没桥时签名走 DOM（不带桥那段）',
    r5['简介'].indexOf('耐力骑行') === -1, r5['简介']);

  /* ==================== 4. 边界：不在主页 / 字段缺失 ==================== */
  section('4. 边界');

  // 作品页地址（不该出账号ID和网址，绝不拿笔记ID当 userId）
  const w6 = makePage({
    url: 'https://www.xiaohongshu.com/explore/69e089a4000000002200066c?xsec_token=T',
    html: HTML_FULL, bridge: null
  });
  const ex6 = new w6.XiaohongshuProfileExtractor();
  const r6 = await ex6.extractAllFields();
  eq('作品页地址 → 账号ID 留空（不拿笔记ID顶替）', r6['账号ID'], '');
  // 提取器自己**绝不**编一个主页地址（编出来就是指向错误的人）
  eq('作品页地址 → extractUrl() 返回空', await ex6.extractUrl(), '');
  // 装配器会兜底填「当前页地址」，那是全站统一行为；这里只要它没被填成主页地址即可
  truthy('作品页地址 → 网址不会被填成 /user/profile/',
    r6['网址'].indexOf('/user/profile/') === -1, r6['网址']);

  // 空页面：一项都取不到，全部留空，不写占位词
  const w7 = makePage({ url: BASE_URL, html: '<!DOCTYPE html><html><body></body></html>', bridge: null });
  const r7 = await new w7.XiaohongshuProfileExtractor().extractAllFields();
  eq('空页面 → 昵称留空', r7['昵称'], '');
  eq('空页面 → 账号名留空', r7['账号名'], '');
  eq('空页面 → 简介留空（不写「暂无简介」之类占位）', r7['简介'], '');
  eq('空页面 → 账号ID 仍在（地址栏有）', r7['账号ID'], USER_ID);

  // 只有粉丝、没有获赞和 IP属地 → 统计行只出现粉丝那一项
  const HTML_PARTIAL = `<!DOCTYPE html><html><body>
    <div class="user-name">只露一半的人</div>
    <div class="user-desc">一行签名</div>
    <div class="user-interactions">
      <div class="clickable"><span class="count">12</span><span class="shows">粉丝</span></div>
    </div>
  </body></html>`;
  const w8 = makePage({ url: BASE_URL, html: HTML_PARTIAL, bridge: null });
  const r8 = await new w8.XiaohongshuProfileExtractor().extractAllFields();
  eq('缺项不出现（不留「获赞：」这种半截）', r8['简介'].split('\n')[0], '粉丝：12');
  eq('没有标签区就不加标签行', r8['简介'], '粉丝：12\n一行签名');

  /* ==================== 5. 红线：绝不碰 userInfo ==================== */
  section('5. 一级红线：主页链路不得出现 userInfo（那是登录者自己）');

  const PROF_SRC = fs.readFileSync(P('src/content/extractors/xiaohongshu-profile.js'), 'utf8');
  const BRIDGE_SRC = fs.readFileSync(P('src/content/xiaohongshu-page-data.js'), 'utf8');

  // 注释里出现 userInfo 是允许的（本文件就靠注释警示），所以只查**代码里**的引用：
  // 把整行注释掉再搜。做法：去掉所有以 * 或 // 开头的行，以及行尾注释。
  const stripComments = (s) => s.split('\n')
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n');

  truthy('提取器代码里没有 userInfo',
    stripComments(PROF_SRC).indexOf('userInfo') === -1, '出现了 userInfo 引用');
  truthy('桥代码里没有 userInfo',
    stripComments(BRIDGE_SRC).indexOf('userInfo') === -1, '出现了 userInfo 引用');
  truthy('桥只写 userPageData',
    /userPageData/.test(stripComments(BRIDGE_SRC)), '桥里找不到 userPageData');

  /* ==================== 6. 接线：三处规则表 + 网址规范化 ==================== */
  section('6. 接线：规则表三处一致 + 网址规范化 + 按钮路由');

  const DET_SRC = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
  const BG_SRC = fs.readFileSync(P('src/background/background.js'), 'utf8');
  const FAC_SRC = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  const NORM_SRC = fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8');
  const SPA_SRC = fs.readFileSync(P('src/content/ui/xiaohongshu-spa-handler.js'), 'utf8');
  const PERSIST_SRC = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
  const MANIFEST = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));

  const XHS_RULE = /\{ type: 'person', patterns: \['\/user\/profile\/'\] \}/;
  truthy('media-detector 有小红书 person 规则', XHS_RULE.test(DET_SRC), '找不到 /user/profile/ 的 person 规则');
  truthy('background 有小红书 person 规则（两处必须逐字对齐）', XHS_RULE.test(BG_SRC), '两处规则表不一致');

  truthy('extractor-factory 注册了 XiaohongshuProfileExtractor',
    /className: 'XiaohongshuProfileExtractor'/.test(FAC_SRC), '没注册');
  // 源码里这一行是 `{ pattern: /www\.xiaohongshu\.com\/user\/profile\/[0-9a-fA-F]{24}/, ...`
  // 注意源码里是**带反斜杠的字面量**，子串匹配必须把反斜杠也写进去，
  // 否则正则会被当成「匹配 www.xiaohongshu.com」而源码里其实是 `www\.xiaohongshu\.com` → 永远找不到。
  const HOME_PATTERN_LITERAL = 'www\\.xiaohongshu\\.com\\/user\\/profile\\/[0-9a-fA-F]{24}';
  truthy('extractor-factory 有主页 URL 规则',
    FAC_SRC.indexOf(HOME_PATTERN_LITERAL) > -1, '找不到主页 URL 规则');
  // 顺序：主页规则必须排在作品页规则之前
  const NOTE_PATTERN_LITERAL = 'xiaohongshu\\.com\\/(?:explore|discovery';
  const iHome = FAC_SRC.indexOf(HOME_PATTERN_LITERAL);
  const iNote = FAC_SRC.indexOf(NOTE_PATTERN_LITERAL);
  truthy('主页 URL 规则排在作品页规则**之前**', iHome > -1 && iNote > -1 && iHome < iNote,
    `home=${iHome} note=${iNote}`);

  truthy('url-normalizer 认 /user/profile/（否则主页网址会被规范成空串）',
    /\\\/user\\\/profile\\\/|user\/profile/.test(NORM_SRC), '规范化里没有主页分支');

  truthy('modal-persistence URL 兜底认小红书主页',
    /xiaohongshu\.com\/user\/profile\//.test(PERSIST_SRC), '找不到兜底');

  truthy('manifest 加载了 xiaohongshu-profile.js',
    MANIFEST.content_scripts[0].js.indexOf('src/content/extractors/xiaohongshu-profile.js') > -1,
    'manifest 里没有这个脚本');

  // SPA 路由：主页必须算「可提取」，否则按钮被藏掉
  truthy('spa-handler 认主页路由（返回非空才出按钮）',
    /_xhsProfileIdFromHref/.test(SPA_SRC) && /profile:' \+ uid|'profile:'/.test(SPA_SRC),
    'spa-handler 没认主页');

  /* ==================== 7. 行为验证：网址规范化 + SPA 路由键 ==================== */
  section('7. 行为验证（真实调用规范化与路由键）');

  // ⚠️ 这一节的页面地址**必须带 token**：如果用不带 token 的地址，
  // 那么 extractUrl 就算退化成 `return location.href` 也照样是干净的，
  // 变异测试就发现不了（M3 第一次就是这么假绿的）。
  const wN = makePage({ url: BASE_URL + '?xsec_token=TOKEN_TEST&xsec_source=pc_followed', html: HTML_FULL, bridge: null });

  // 7a. 提取器自己就必须给干净地址 —— 不能指望下游规范化来擦屁股。
  //     只断言装配后的结果会被「规范化兜底」掩盖（normalize 认不出时是原样返回），
  //     那样即使 extractUrl 返回带 token 的地址，测试也还是绿的。
  const exN = new wN.XiaohongshuProfileExtractor();
  eq('主页 extractUrl() 直接就返回干净地址（不依赖下游）', await exN.extractUrl(), BASE_URL);

  // 7b. 规范化规则**单独**拿出来也得认主页（否则主页地址会被当成「认不出」原样带 token）
  const U = wN.UrlNormalizer;
  truthy('UrlNormalizer 已加载', !!U, '没挂上');
  if (U) {
    eq('带 token 的主页地址 → 规范化成干净地址',
      U.normalize(BASE_URL + '?xsec_token=ABSZRtVKjL773cwz7Jvn_o_v5Bd8BbdT0c-KaKcHsTELI=&xsec_source=pc_followed'),
      BASE_URL);
    // 直接调规则函数：normalize 在规则返回 '' 时会「原样返回 href」，会掩盖规则失效
    eq('小红书规则函数单独认主页路径',
      U._rules.xiaohongshu(U._parse(BASE_URL + '?xsec_token=ABC')), BASE_URL);
    eq('小红书规则函数仍认笔记路径（不回归）',
      U._rules.xiaohongshu(U._parse('https://www.xiaohongshu.com/explore/69e089a4000000002200066c?xsec_token=T')),
      'https://www.xiaohongshu.com/explore/69e089a4000000002200066c?xsec_token=T');
  }

  const wN2 = makePage({
    url: BASE_URL + '?xsec_token=ABSZRtVKjL773cwz7Jvn_o_v5Bd8BbdT0c-KaKcHsTELI=&xsec_source=pc_followed',
    html: HTML_FULL, bridge: null
  });
  const rN = await new wN2.XiaohongshuProfileExtractor().extractAllFields();
  eq('带 token+source 的真实地址 → 网址仍干净', rN['网址'], BASE_URL);

  // SPA 路由键：主页不能是空串（空串 = 按钮被藏）
  const SPA = wN.eval(fs.readFileSync(P('src/content/ui/xiaohongshu-spa-handler.js'), 'utf8')) || true;
  const mixin = wN.XiaohongshuSpaMixin;
  truthy('XiaohongshuSpaMixin 已挂上', !!mixin, '没挂上');
  if (mixin) {
    eq('主页路由键非空（= 按钮会出）',
      mixin._xhsRouteKeyFromHref(BASE_URL), 'profile:' + USER_ID);
    eq('笔记页路由键仍是 note:',
      mixin._xhsRouteKeyFromHref('https://www.xiaohongshu.com/explore/69e089a4000000002200066c'),
      'note:69e089a4000000002200066c');
    eq('列表页路由键仍是空串（= 按钮藏）',
      mixin._xhsRouteKeyFromHref('https://www.xiaohongshu.com/explore'), '');
  }

  /* ==================== 汇总 ==================== */
  // --dump：把真机形态的完整结果打出来（写报告 / 人眼核对用）
  if (process.argv.includes('--dump')) {
    console.log('\n--- 真机形态的完整输出 ---');
    for (const k of Object.keys(r1)) {
      console.log('【' + k + '】' + String(r1[k]).replace(/\n/g, '\n         '));
    }
  }

  console.log(`\n${C.bold}结果：${pass} 通过，${fail} 失败${C.reset}`);
  if (fail) {
    console.log('失败清单：');
    failures.forEach((f) => console.log('  · ' + f));
    process.exit(1);
  }
})();
