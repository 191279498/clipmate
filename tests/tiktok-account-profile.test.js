/**
 * TikTok 个人主页提取器（v2.7.24）—— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = `secUid`；账号名 = `uniqueId`（用户 2026-10-31 拍板，与抖音 sec_uid 对称）
 *   C. 网址是干净地址：`https://www.tiktok.com/@<handle>`（丢掉 `?lang=` 这类参数）
 *   D. 简介 = 统计行（粉丝 · 获赞，**不带关注、没有 IP 属地**）+ 完整签名 + 外链
 *   E. 数字**照页面原样**（`96.5M` 不反解成 96500000；精确值只在 DOM 读不到时兜底）
 *   F. 签名：数据块全文 → DOM 兜底；**一手拿到但签名空 = 真的没写，不许回落 DOM 占位话**
 *   G. 外链要原始地址，不是 `tiktok.com/link/v2?…` 跳转壳
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   1. 数据块的 `uniqueId` 必须等于地址栏 `@账号名`，否则整份弃用（走 DOM）。
 *      本项目已经在小红书 `userInfo`、快手 `/rest/v/profile/get`、IG `PolarisViewer`
 *      上栽过三次「数据块里是登录者自己」，这是第四次边界 —— 闸口照旧钉死。
 *   2. 提取器**不许自己解析数据块**（不出现 `__UNIVERSAL_DATA_FOR_REHYDRATION__`
 *      / `webapp.user-detail`），一律走 `tiktok-page-data.js` 那个已经带闸口的入口。
 *      自己开一条路 = 绕开闸口 = 迟早串台。源码断言剥掉注释再查。
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge，`https://www.tiktok.com/@tiktok`）
 *   user.id=107955｜uniqueId=tiktok｜nickname=TikTok｜secUid=MS4wLjABAAAAv7iSuuXDJGDvJkmH_vz1qkDZYo1apxgzaxdBSeIuPiM
 *   stats: followerCount=96500000｜heartCount=466200000｜videoCount=1515｜followingCount=1
 *   DOM : followers-count `96.5M`｜likes-count `466.2M`｜user-link 显示 `tiktok.com/discovermore`
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

/** 剥掉注释再断言源码（注释里写着「不许出现 xxx」，不剥就会被自己命中） */
function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ 真机样本 ============================ */

const HANDLE = 'tiktok';
const BASE_URL = 'https://www.tiktok.com/@' + HANDLE;

const SEC_UID = 'MS4wLjABAAAAv7iSuuXDJGDvJkmH_vz1qkDZYo1apxgzaxdBSeIuPiM';
const SIGN = 'Your next discovery is waiting on TikTok.';
const LINK_HREF = 'https://www.tiktok.com/link/v2?aid=1988&lang=zh-Hans&scene=bio_url&target=tiktok.com%2Fdiscovermore';

/**
 * 首屏数据块（`__UNIVERSAL_DATA_FOR_REHYDRATION__`），字段与真机一致
 * @param {Object} o - 覆盖项；`o.absent=true` 表示整个块不出现
 */
function userDetailHtml(o) {
  const opt = o || {};
  if (opt.absent) return '';
  const data = {
    __DEFAULT_SCOPE__: {
      'webapp.user-detail': {
        userInfo: {
          user: {
            id: opt.id === undefined ? '107955' : opt.id,
            uniqueId: opt.uniqueId === undefined ? HANDLE : opt.uniqueId,
            nickname: opt.nickname === undefined ? 'TikTok' : opt.nickname,
            signature: opt.signature === undefined ? SIGN : opt.signature,
            secUid: opt.secUid === undefined ? SEC_UID : opt.secUid,
            createTime: 1425144149,
            verified: true,
            bioLink: opt.bioLink === undefined ? { link: 'tiktok.com/discovermore', risk: 0 } : opt.bioLink
          },
          stats: {
            followerCount: opt.followerCount === undefined ? 96500000 : opt.followerCount,
            followingCount: 1,
            // ⚠️ `heart` 与 `heartCount` 都要跟着变：`normalizeUser` 里写的是
            //    `st.heartCount || st.heart`，只把 heartCount 设 0 会回落 `heart` 那个旧值，
            //    「只有粉丝」这种用例就会假红（第一版正是这么踩的）。
            heart: opt.heartCount === undefined ? 466200000 : opt.heartCount,
            heartCount: opt.heartCount === undefined ? 466200000 : opt.heartCount,
            videoCount: 1515,
            diggCount: 0
          },
          itemList: []
        }
      }
    }
  };
  return `<script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(data)}</script>`;
}

/**
 * 主页 HTML
 *
 * ⚠️ 结构必须照真机写（2026-10-31 `@tiktok` 实拍）：
 *   `<h1 data-e2e="user-title">` 昵称
 *   `<h2 data-e2e="user-subtitle">` 账号名（**真机不带 @**；这里默认也不带，
 *      另一个用例专门喂带 @ 的旧形态，验证会剥）
 *   `<strong data-e2e="followers-count" title="粉丝">96.5M</strong>`（标签在 title 上，数字在 strong 自己）
 *   `<a data-e2e="user-link" href="跳转壳">显示文本</a>`
 */
function pageHtml(o) {
  const opt = o || {};
  const sub = opt.subtitle === undefined ? HANDLE : opt.subtitle;
  const fans = opt.fans === undefined ? '96.5M' : opt.fans;
  const likes = opt.likes === undefined ? '466.2M' : opt.likes;

  const fansHtml = (fans === null) ? '' :
    `<li><strong data-e2e="followers-count" title="粉丝">${fans}</strong><span>粉丝</span></li>`;
  const likesHtml = (likes === null) ? '' :
    `<li><strong data-e2e="likes-count" title="赞">${likes}</strong><span>赞</span></li>`;

  const bio = opt.bio === undefined ? SIGN : opt.bio;
  const bioHtml = (bio === null) ? '' : `<h2 data-e2e="user-bio">${bio}</h2>`;

  const link = opt.link === undefined ? LINK_HREF : opt.link;
  const linkHtml = (link === null) ? '' :
    `<a data-e2e="user-link" href="${link}">${opt.linkText === undefined ? 'tiktok.com/discovermore' : opt.linkText}</a>`;

  // ⚠️ DOM 上的昵称要能**单独**设（`domNickname`）：
  //    只用一个 nickname 参数的话，「数据块是别人、DOM 是本主」这种闸口用例
  //    两边会一起变，测出来永远是"一致"，闸口等于没测。
  const domNick = opt.domNickname === undefined
    ? (opt.nickname === undefined ? 'TikTok' : opt.nickname)
    : opt.domNickname;

  return `<!doctype html><html><head><title>TikTok (@${HANDLE}) | TikTok</title></head><body>
    <main data-e2e="user-page">
      <h1 data-e2e="user-title">${domNick}</h1>
      <h2 data-e2e="user-subtitle">${sub}</h2>
      ${bioHtml}
      <ul>${fansHtml}${likesHtml}</ul>
      ${linkHtml}
    </main>
    ${userDetailHtml(opt)}
  </body></html>`;
}

/** 按依赖顺序装真正的模块（数据块解析与闸口都用真实现，不用桩） */
function makePage({ url, html }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/shared/tiktok-page-data.js',
    'src/content/extractors/tiktok-profile.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));
  // MediaTypeDetector 构造时会 `WBR.runtime.sendMessage` 读后台配置。
  // jsdom 里没有 WBR → 它会走 catch 退回内置默认配置，但那是**异步**的：
  // 检测器立刻被调用时 `siteConfigs` 还可能是 null（于是走正文猜测，测试假绿/假红都可能）。
  // 这里给一个必失败的桩 + 调用前 await 一拍，保证走的是"真的站点规则"。
  w.WBR = { runtime: { sendMessage: async () => { throw new Error('jsdom: no runtime'); } } };
  return w;
}

async function extract(w) {
  const ex = new w.TikTokProfileExtractor();
  return await ex.extractAllFields();
}

const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];

/* ============================ 跑 ============================ */
(async () => {

  /* ==================== 1. 六列契约（数据块齐备） ==================== */
  section('1. 六列契约：列名/列序/取值');

  const w1 = makePage({ url: BASE_URL, html: pageHtml() });
  const r1 = await extract(w1);

  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('平台 = TikTok', r1['平台'], 'TikTok');
  eq('昵称取数据块 nickname', r1['昵称'], 'TikTok');
  eq('账号ID = secUid', r1['账号ID'], SEC_UID);
  eq('账号名 = uniqueId', r1['账号名'], 'tiktok');
  eq('网址是干净主页地址', r1['网址'], 'https://www.tiktok.com/@tiktok');
  eq('媒体类型标记', r1.mediaType, 'person');
  eq('personKind = account', r1.personKind, 'account');

  /* ==================== 2. 统计数字照页面原样 ==================== */
  section('2. 统计数字照页面原样（96.5M 不反解）');

  const bio1 = String(r1['简介'] || '');
  const lines1 = bio1.split('\n');
  eq('简介第一行 = 粉丝 / 获赞（不带关注）', lines1[0], '粉丝：96.5M · 获赞：466.2M');
  eq('简介里不出现「关注」', /关注/.test(bio1), false);
  eq('简介里不出现「作品」', /作品/.test(bio1), false);
  eq('简介第二行是签名', lines1[1], SIGN);
  eq('简介第三行是外链（去壳 + 补协议）', lines1[2], 'https://tiktok.com/discovermore');
  eq('简介恰好三行', lines1.length, 3);

  // 页面是 96.5M，数据块是 96500000 —— 必须用页面那份（照页面原样）
  eq('数字没被换成接口精确值', /96500000|466200000/.test(bio1), false);

  // DOM 读不到（没有 strong 锚点）→ 才用精确值，且原样存整数
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ fans: null, likes: null }) });
    const r = await extract(w);
    eq('DOM 没有统计锚点 → 用数据块精确值（原样整数，不缩写）',
      String(r['简介'] || '').split('\n')[0], '粉丝：96500000 · 获赞：466200000');
  }

  // 只有粉丝没有获赞 → 只出粉丝，不留「获赞：」半截
  // （DOM 锚点去掉**且**数据块 heartCount 也是 0 才算"真的没有"；
  //   只去掉 DOM 的话会正常走精确值兜底，那是正确行为，不是缺陷）
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ likes: null, heartCount: 0 }) });
    const r = await extract(w);
    const first = String(r['简介'] || '').split('\n')[0];
    eq('只有粉丝 → 只出粉丝一项', first, '粉丝：96.5M');
    eq('不留「获赞：」半截', /获赞/.test(first), false);
  }

  // 数字里混进标签文字（`96.5M粉丝`）→ 按 title 剥掉
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ fans: '96.5M粉丝' }) });
    const r = await extract(w);
    eq('数字里混进标签文字 → 剥掉', String(r['简介'] || '').split('\n')[0], '粉丝：96.5M · 获赞：466.2M');
  }

  // 数字形态不认识（比如整个容器文本混进来）→ 不认，走精确值
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ fans: '粉丝 96.5M 人' }) });
    const r = await extract(w);
    eq('格式不认识 → 不硬认，走精确值', String(r['简介'] || '').split('\n')[0], '粉丝：96500000 · 获赞：466.2M');
  }

  /* ==================== 3. 签名 ==================== */
  section('3. 签名：数据块全文 → DOM 兜底；空就是空');

  // 多行签名要保留换行
  {
    const multi = '第一行\n第二行\n第三行';
    const w = makePage({ url: BASE_URL, html: pageHtml({ signature: multi, bio: 'DOM 上被截断的…' }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('多行签名保留换行', bio.indexOf('第一行\n第二行\n第三行') > -1, bio);
    eq('数据块有签名时不看 DOM', bio.indexOf('DOM 上被截断的') > -1, false);
  }

  // ⚠️ 一手拿到但签名为空 = 真的没写，不许回落 DOM 占位话
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ signature: '', bio: '尚无个人简介。' }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('一手签名空 → 简介里没有占位话', /尚无个人简介/.test(bio), false);
    eq('一手签名空 → 只剩统计行', bio.split('\n').length, 2); // 统计行 + 外链
  }

  // ⚠️ 同一条纪律的**可咬版**：DOM 上是「像真签名的一段话」（不是占位话）。
  //    上一版只有占位话用例时，「签名空也回落 DOM」这个变异是绿的 ——
  //    因为它回落的占位话又被 `_stripPlaceholderBio` 兜掉了，两条逻辑互相掩护。
  //    这里要的是：一手说空，就连 DOM 上看起来正常的签名也不许拿。
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ signature: '', bio: '页面上残留的旧签名' }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('一手签名空 → 不许拿 DOM 上的签名顶替', bio.indexOf('页面上残留的旧签名') > -1, false);
    eq('一手签名空 → 简介仍是统计行 + 外链', bio.split('\n').length, 2);
  }

  // 一手完全拿不到（数据块缺失）→ 回落 DOM，并剪「更多」尾巴
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ absent: true, bio: '页面上的简介… 更多' }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('数据块缺失 → 回落 DOM 简介', bio.indexOf('页面上的简介') > -1, bio);
    eq('DOM 的「… 更多」尾巴被剪掉', /更多/.test(bio), false);
  }

  // 一手拿不到 + DOM 也是占位话 → 简介里什么都不留（只剩统计行）
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ absent: true, bio: '尚无个人简介。' }) });
    const r = await extract(w);
    eq('DOM 也是占位话 → 不存', /尚无个人简介/.test(String(r['简介'] || '')), false);
  }

  /* ==================== 4. 外链去壳 ==================== */
  section('4. 外链：解 target= 去壳，绝不存壳地址');

  // 真机形态：壳 + target 是**不带协议**的域名
  eq('真机壳地址 → 解出真实地址并补 https',
    String(r1['简介'] || '').split('\n')[2], 'https://tiktok.com/discovermore');

  // 第三方外链
  {
    const href = 'https://www.tiktok.com/link/v2?aid=1988&lang=zh-Hans&scene=bio_url&target=https%3A%2F%2Fwww.example.com%2Fshop%3Fa%3D1';
    const w = makePage({ url: BASE_URL, html: pageHtml({ link: href, linkText: 'example.com/shop' }) });
    const r = await extract(w);
    eq('第三方外链解出来是原始 URL',
      String(r['简介'] || '').split('\n').pop(), 'https://www.example.com/shop?a=1');
    eq('不把 tiktok.com/link 壳存进档案', /tiktok\.com\/link/.test(String(r['简介'] || '')), false);
  }

  // href 本身就是外链
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ link: 'https://linktr.ee/someone', linkText: 'linktr.ee/someone' }) });
    const r = await extract(w);
    eq('href 直接是外链 → 原样用',
      String(r['简介'] || '').split('\n').pop(), 'https://linktr.ee/someone');
  }

  // 只有显示文本、href 解不出来
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ link: 'https://www.tiktok.com/link/v2?aid=1988', linkText: 'mysite.cn/blog' }) });
    const r = await extract(w);
    eq('只能靠显示文本 → 补 https 后使用',
      String(r['简介'] || '').split('\n').pop(), 'https://mysite.cn/blog');
  }

  // 没有外链 → 简介不留空行
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ link: null }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('没有外链 → 简介两行', bio.split('\n').length, 2);
    eq('末尾没有空行', /\n$/.test(bio), false);
  }

  /* ==================== 5. 闸口：数据块不是这个账号就不用 ==================== */
  section('5. 闸口：uniqueId 与地址不一致 → 整份弃用（防串台）');

  {
    // 数据块里是别人（登录者自己 / 上一条 / 别人的号），DOM 才是页面主人。
    // ⚠️ 签名也必须**分成两份不同的字符串**：两边写成一样的话，
    //    「用了别人的签名」和「回落 DOM」得出同一个结果，这条断言永远咬不住。
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({
        uniqueId: 'someone_else',
        nickname: '别人的昵称',
        domNickname: 'TikTok',
        signature: '别人的签名内容',
        bio: 'DOM 上的本主签名'
      })
    });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('闸口挡住 → 账号ID 留空（不拿别人的 secUid）', String(r['账号ID'] || ''), '');
    eq('闸口挡住 → 账号名回落到地址栏', r['账号名'], 'tiktok');
    eq('闸口挡住 → 昵称回落 DOM（不许用别人的昵称）', r['昵称'], 'TikTok');
    eq('闸口挡住 → 简介用 DOM 的签名', bio.indexOf('DOM 上的本主签名') > -1, true);
    eq('闸口挡住 → 简介里不出现别人的签名', bio.indexOf('别人的签名内容') > -1, false);
  }

  // 大小写不敏感：地址 @TikTok、数据块 tiktok → 认（同一个人），且用数据块原始写法
  {
    const w = makePage({ url: 'https://www.tiktok.com/@TikTok', html: pageHtml({ uniqueId: 'tiktok' }) });
    const r = await extract(w);
    eq('大小写不同不算串台 → secUid 拿到', r['账号ID'], SEC_UID);
    eq('账号名用数据块的原始写法', r['账号名'], 'tiktok');
    eq('网址也用数据块的写法', r['网址'], 'https://www.tiktok.com/@tiktok');
  }

  /* ==================== 6. 网址与账号名形态 ==================== */
  section('6. 网址：丢 ?lang= 这类参数；账号名剥 @');

  {
    const w = makePage({ url: 'https://www.tiktok.com/@tiktok?lang=zh-Hans&is_from_webapp=1', html: pageHtml() });
    const r = await extract(w);
    eq('带 ?lang= 的地址 → 存干净地址', r['网址'], 'https://www.tiktok.com/@tiktok');
  }

  // 数据块缺失时，DOM 的 user-subtitle 可能带 @（旧形态/别的界面）
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ absent: true, subtitle: '@tiktok' }) });
    const r = await extract(w);
    eq('DOM 的账号名带 @ → 剥掉', r['账号名'], 'tiktok');
    eq('数据块缺失时账号ID 为空（绝不拿 @账号名顶替）', String(r['账号ID'] || ''), '');
  }

  /* ==================== 7. 源码红线 ==================== */
  section('7. 源码红线：不许自己解析数据块（会绕开闸口）');

  const SRC = stripComments(fs.readFileSync(P('src/content/extractors/tiktok-profile.js'), 'utf8'));
  eq('提取器不出现 __UNIVERSAL_DATA_FOR_REHYDRATION__',
    SRC.indexOf('__UNIVERSAL_DATA_FOR_REHYDRATION__') === -1, true);
  eq('提取器不出现 webapp.user-detail', SRC.indexOf('webapp.user-detail') === -1, true);
  truthy('提取器统一走 TiktokPageData.getProfile', /TiktokPageData\.getProfile/.test(SRC));
  eq('提取器不自己 JSON.parse 数据块', /JSON\.parse/.test(SRC), false);
  eq('提取器不读 PolarisViewer 这类登录者数据', /PolarisViewer|userInfo/.test(SRC), false);

  /* ==================== 8. 接线：站点规则 / 工厂 / manifest ==================== */
  section('8. 接线：站点规则 / 工厂 / manifest');

  const MF = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  const FAC = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  const DET = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
  const BG = fs.readFileSync(P('src/background/background.js'), 'utf8');
  const MP = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');

  truthy('manifest 注册了 tiktok-profile.js',
    MF.content_scripts.some((cs) => (cs.js || []).some((x) => x === 'src/content/extractors/tiktok-profile.js')));
  truthy('脚本排在 tiktok-social.js 之后（同 world 顺序）', (() => {
    const js = MF.content_scripts[0].js;
    const a = js.indexOf('src/content/extractors/tiktok-social.js');
    const b = js.indexOf('src/content/extractors/tiktok-profile.js');
    return a > -1 && b > -1 && a < b;
  })());
  truthy('注入范围含 www.tiktok.com', (MF.content_scripts[0].matches || []).includes('https://www.tiktok.com/*'));

  truthy('工厂注册了 TikTokProfileExtractor',
    /className: 'TikTokProfileExtractor'/.test(FAC));
  truthy('工厂把 person 绑到 TikTok 两个域名',
    /className: 'TikTokProfileExtractor', entries: \[[\s\S]{0,300}?www\.tiktok\.com[\s\S]{0,120}?types: \['person'\]/.test(FAC));

  // 顺序断言：person 规则必须出现在通配 social 那条之前
  const iPerson = FAC.indexOf('/www\\.tiktok\\.com\\/@[A-Za-z0-9_.]{2,40}');
  const iSocial = FAC.indexOf("{ pattern: /www\\.tiktok\\.com\\//, hostname: 'www.tiktok.com', mediaType: 'social' }");
  truthy('person 规则在通配 social 规则**之前**（顺序错了主页永远走 social）',
    iPerson > -1 && iSocial > -1 && iPerson < iSocial, `person@${iPerson} social@${iSocial}`);

  // 用真实 URL 跑工厂规则里那条正则
  const tkPersonRe = /www\.tiktok\.com\/@[A-Za-z0-9_.]{2,40}\/?(?:[?#]|$)/;
  truthy('规则命中主页', tkPersonRe.test('https://www.tiktok.com/@tiktok'));
  truthy('规则命中带查询串的主页', tkPersonRe.test('https://www.tiktok.com/@tiktok?lang=zh-Hans'));
  truthy('规则命中带尾斜杠的主页', tkPersonRe.test('https://www.tiktok.com/@tiktok/'));
  truthy('规则不命中作品页', !tkPersonRe.test('https://www.tiktok.com/@tiktok/video/7698980327007505684'));
  truthy('规则不命中图集页', !tkPersonRe.test('https://www.tiktok.com/@tiktok/photo/7692501454971571508'));
  truthy('规则不命中探索页', !tkPersonRe.test('https://www.tiktok.com/explore'));

  // 两份站点配置必须逐字一致
  const reInDet = (DET.match(/'www\.tiktok\.com': \{[\s\S]{0,600}?regex: '([^']+)'/) || [])[1] || '';
  const reInBg = (BG.match(/'www\.tiktok\.com': \{[\s\S]{0,600}?regex: '([^']+)'/) || [])[1] || '';
  truthy('两处都取到了 TikTok 正则', !!reInDet && !!reInBg, `det=${reInDet} bg=${reInBg}`);
  eq('media-detector 与 background 的 TikTok 正则逐字一致', reInDet, reInBg);
  truthy('media-detector 的 TikTok 配置改成多规则',
    /'www\.tiktok\.com': \{[\s\S]{0,600}?rules: \[/.test(DET));
  truthy('background 的 TikTok 配置也改多规则（两份对齐）',
    /'www\.tiktok\.com': \{[\s\S]{0,600}?rules: \[/.test(BG));

  // 用检测器真跑一遍
  const wD = makePage({ url: BASE_URL, html: pageHtml() });
  wD.eval(fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8'));
  const det = new wD.MediaTypeDetector();
  await new Promise((r) => setTimeout(r, 20));   // 等 loadConfigs 的 catch 落地（否则 siteConfigs 还是 null）
  truthy('检测器拿到了站点配置（不是靠正文猜）', !!det.siteConfigs, 'siteConfigs 为空 = 下面的判定其实没走规则表');
  eq('检测器判主页 = person', det.detect('https://www.tiktok.com/@tiktok', wD.document), 'person');
  eq('检测器判主页（带查询串）= person',
    det.detect('https://www.tiktok.com/@tiktok?lang=zh-Hans', wD.document), 'person');
  eq('检测器判作品页 = social',
    det.detect('https://www.tiktok.com/@tiktok/video/7698980327007505684', wD.document), 'social');
  eq('检测器判图集页 = social',
    det.detect('https://www.tiktok.com/@tiktok/photo/7692501454971571508', wD.document), 'social');
  eq('检测器判推荐流 = social', det.detect('https://www.tiktok.com/', wD.document), 'social');
  eq('检测器判探索页 = social（不是某个叫 explore 的人）',
    det.detect('https://www.tiktok.com/explore', wD.document), 'social');

  // modal-persistence 的 6/7 列分叉
  truthy('modal-persistence 有 TikTok 主页 person 兜底', /tkPath/.test(MP));
  const iMpPerson = MP.indexOf("if (url.includes('tiktok.com/@'))");
  const iMpSocial = MP.indexOf("if (url.includes('tiktok.com/') || url.includes('www.tiktok.com/'))");
  truthy('modal-persistence 的 person 判定排在 social 之前',
    iMpPerson > -1 && iMpSocial > -1 && iMpPerson < iMpSocial, `person@${iMpPerson} social@${iMpSocial}`);

  truthy('url-normalizer 已有 TikTok 主页分支（本次不动）',
    /const profile = p\.match\(\/\^\\\/@\(\[A-Za-z0-9_\.\]\{2,40\}\)\$\/\)/.test(
      fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8')));

  /* ==================== 9. 版本号 ==================== */
  section('9. 版本号');
  eq('manifest 版本已升到 2.12.0', MF.version, '2.12.1');

  /* ==================== 真机形态预览 ==================== */
  if (process.argv.includes('--dump')) {
    console.log(`\n${C.bold}真机形态复刻（${BASE_URL}）${C.reset}`);
    for (const k of CONTENT_KEYS) {
      console.log(`  【${k}】${String(r1[k] || '').replace(/\n/g, '\n         ')}`);
    }
  }

  console.log(`\n${C.bold}结果：${pass} 通过，${fail} 失败${C.reset}`);
  if (fail) { failures.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('测试崩了:', e); process.exit(1); });
