/**
 * TikTok —— 缓存串台 + 空文案纪律（v2.5.99）
 *
 * 真机验收（2026-10-29）抓到三个问题，本文件逐个钉住：
 *
 *   ① 缓存串台：TikTok 推荐流换条后地址一个字不变（恒为 `https://www.tiktok.com/`），
 *      而 `content-main.js` 的缓存键只在 init 里算一次、之后永不更新，
 *      于是第二次点提取直接命中上一次的结果。
 *      真机实证：换到 `_.janisz_`（uid `janisnnn`）之后连点三次，
 *      三次浮窗给的都是最早那条 `ClausMagic`（`clausmagicus`）。
 *      同一个成因还会让「作品页之间点着跳转」串台（地址变了、键没变）。
 *
 *   ② 作品页空文案被平台 SEO 话术填满：
 *      `@168cherry_jp` 那条作品一手 `desc = ''`，改前文案栏给的是
 *      「TikTok 上的 あいりす 🐿🥨⌇淡色カフェ･低身長コーデ (@168cherry_…」——
 *      og:description 的 SEO 话术。文案栏永远不空 → v2.5.98 的「空文案填站名」永远轮不到。
 *
 *   ③ 主页空签名被占位文案填满：
 *      同一账号一手 `signature = ''`，`[data-e2e="user-bio"]` 显示的是
 *      「尚无个人简介。」—— 平台占位话。改前文案栏与标题都被这句污染。
 *
 * 修法纪律（本文件守护）：
 *   · 一手数据拿到了，就以一手为准：有就有，空就空（空位交给 SocialFieldsBuilder 兜底）；
 *   · 一手完全拿不到，才回落 DOM / meta（老链路原样保留）；
 *   · 缓存键每次提取前重算，推荐流额外把「当前这一条的作品 ID」并进去。
 *
 * 反向验证（改坏任一处，对应用例必须变红）：
 *   ① `_contentSalt` 只认 `/`（漏掉 /foryou /following /friends）  → 一节 2~4 条红
 *   ② `handleExtract` 不重算 cacheKey                              → 二节第 1 条红
 *   ③ `_contentSalt` 不看 scope                                    → 一节第 6 条红
 *   ④ 主页文案改回 `if (pf && pf.signature) …`                      → 三节第 1、3 条红
 *   ⑤ 作品页文案改回 `if (tk && tk.desc) return tk.desc`            → 三节第 5、7 条红
 *
 * 用法：
 *   node tests/tiktok-cache-and-empty-text.test.js
 *   node tests/tiktok-cache-and-empty-text.test.js --verbose
 */

'use strict';

const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const H = require('./lib/harness');

const C = {
  reset: '\u001b[0m', green: '\u001b[32m', red: '\u001b[31m', cyan: '\u001b[36m'
};
let pass = 0;
const failures = [];

function ok(name, detail) {
  pass++;
  if (VERBOSE) console.log(`  ${C.green}✓${C.reset} ${name}${detail ? '  ' + detail : ''}`);
}
function bad(name, detail) {
  failures.push({ name, detail });
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function eq(name, got, want) {
  if (got === want) return ok(name, JSON.stringify(got));
  bad(name, `期望 ${JSON.stringify(want)}，实得 ${JSON.stringify(got)}`);
}
function truthy(name, got, detail) {
  if (got) return ok(name, detail);
  bad(name, `期望真值，实得 ${JSON.stringify(got)}`);
}
function falsy(name, got, detail) {
  if (!got) return ok(name, detail);
  bad(name, `期望假值，实得 ${JSON.stringify(got)}`);
}
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/* ========================================================================== */
/* 真机原样数据（2026-10-29，字段值取自页面一手数据，未改一个字符）              */
/* ========================================================================== */

/** 推荐流第一条（真机 `Meow Meow` 那条） */
const FYP_ITEM = {
  id: '7681609972911705374',
  desc: 'HAHAHA FUNNY 🤣🤪😂#trending #funny #animals #viral #cats  @Meow Meow ',
  createTime: 1788631200,
  nickname: 'Meow Meow',
  uniqueId: 'meowmeowcinematic',
  secUid: 'MS4wLjABAAAA-test',
  authorId: '111',
  duration: 9,
  isPhoto: false
};

/** 换条之后的第二条（真机 `_.janisz_` 那条） */
const FYP_ITEM_B = {
  id: '7679574777723440414',
  desc: 'second item',
  createTime: 1788040353,
  nickname: '_.janisz_',
  uniqueId: 'janisnnn',
  secUid: 'MS4wLjABAAAA-test-b',
  authorId: '222',
  duration: 7,
  isPhoto: false
};

/** 作品页样本：一手 desc 为空（真机 `@168cherry_jp`） */
const EMPTY_DESC_ITEM = {
  id: '7698980327007505684',
  desc: '',
  createTime: 1761076551,
  nickname: 'あいりす',
  uniqueId: '168cherry_jp',
  secUid: 'MS4wLjABAAAA-empty',
  authorId: '333',
  duration: 12,
  isPhoto: false
};

/** 图集样本：一手 desc 为空 + isPhoto（真机 `/photo/` 入口） */
const EMPTY_DESC_PHOTO = {
  id: '7692501454971571508',
  desc: '',
  createTime: 1759476295,
  nickname: 'kariina_choi',
  uniqueId: 'kariina_choi',
  secUid: 'MS4wLjABAAAA-photo',
  authorId: '444',
  duration: 0,
  isPhoto: true
};

/* ========================================================================== */
/* 页面模板                                                                    */
/* ========================================================================== */

/** 桥节点 JSON（`scope` 决定推荐流 / 作品页） */
function bridgeJson(item, scope, ts) {
  return JSON.stringify({
    v: 1,
    scope: scope || 'item',
    urlId: item.id,
    id: item.id,
    ts: ts === undefined ? Date.now() : ts,
    data: item
  });
}

/** 推荐流页：三列布局 + 当前播放器 + 创作身份区（真机结构） */
function fypHtml(item, o) {
  const opt = o || {};
  return `<!DOCTYPE html><html><head><title>TikTok - Make Your Day</title>
  <meta property="og:description" content="TikTok - trends start here.">
  </head><body>
  <div data-e2e="anchoring-player-column" style="width:865px;height:877px">
    <video src="blob:test"></video>
    <div data-e2e="cinema-creator-identity">
      <div><a href="/@${item.uniqueId}"><img alt="avatar"></a></div>
      <div class="DivCreatorUsername">${item.nickname}</div>
      <div><button>Follow</button></div>
    </div>
    <div data-e2e="video-desc">${item.desc || ''}</div>
  </div>
  <script type="application/json" id="clipmate-tiktok-fiber">${bridgeJson(item, 'fyp', opt.ts)}</script>
  </body></html>`;
}

/** 作品页 / 图集页：一手数据 + 屏幕文案 + 平台 SEO 的 og:description */
function itemHtml(item, o) {
  const opt = o || {};
  const kind = item.isPhoto ? 'photo' : 'video';
  const seo = `TikTok 上的 ${item.nickname} (@${item.uniqueId}) 的短视频`;
  return `<!DOCTYPE html><html><head><title>${item.nickname} | TikTok</title>
  <meta property="og:description" content="${seo}">
  </head><body>
  <div data-e2e="browse-video">
    ${item.isPhoto ? '<img src="https://example.com/a.jpg">' : '<video src="blob:test"></video>'}
    <div class="DivCreatorInfoContainer">
      <span class="TUXText">${item.nickname} · 2026-09-20</span>
    </div>
    <div data-e2e="video-desc">${opt.domDesc === undefined ? (item.desc || '') : opt.domDesc}</div>
    <a href="/@${item.uniqueId}">@${item.uniqueId}</a>
  </div>
  <script type="application/json" id="clipmate-tiktok-fiber">${bridgeJson(item, 'item')}</script>
  </body></html>`;
}

/** 主页：首屏数据块（一手签名为空时 DOM 上有平台占位「尚无个人简介。」） */
function profileHtml(handle, o) {
  const opt = o || {};
  const signature = opt.signature === undefined ? '' : opt.signature;
  const rehydration = {
    __DEFAULT_SCOPE__: {
      'webapp.user-detail': {
        userInfo: {
          user: {
            id: '999',
            uniqueId: handle,
            nickname: opt.nickname || 'あいりす',
            signature: signature,
            secUid: 'MS4wLjABAAAA-profile',
            createTime: 1700000000,
            verified: false
          },
          stats: { followerCount: 1000, followingCount: 10, heartCount: 5000, videoCount: 16 }
        }
      }
    }
  };
  const rehNode = opt.noRehydration
    ? ''
    : `<script type="application/json" id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify(rehydration)}</script>`;
  return `<!DOCTYPE html><html><head><title>${handle} | TikTok</title>
  <meta property="og:description" content="TikTok 上的 ${opt.nickname || 'あいりす'} |1000 个赞。">
  </head><body>
  <h1 data-e2e="user-title">${opt.nickname || 'あいりす'}</h1>
  <h2 data-e2e="user-subtitle">@${handle}</h2>
  <div data-e2e="user-bio">${signature || '尚无个人简介。'}</div>
  ${rehNode}
  </body></html>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 开一个页面并等 init 完成 */
async function open(url, html) {
  const page = await H.openPage({ url, html });
  const inst = await H.waitForInit(page, 15000);
  return { page, inst };
}

/* ========================================================================== */
/* 一、缓存盐 `_contentSalt`                                                    */
/* ========================================================================== */

async function section1() {
  section('一、缓存盐：推荐流必须把「当前这一条」并进缓存键');

  const { page, inst } = await open('https://www.tiktok.com/', fypHtml(FYP_ITEM));
  truthy('拿得到实例', !!inst);
  if (!inst) return;

  eq('推荐流根地址 → 带当前作品 ID',
    inst._contentSalt(), '#fyp-7681609972911705374');

  // 三条推荐流入口都要加盐（与 tiktok-page-data 的 isFypUrl 一致）
  const cases = ['/foryou', '/following', '/friends', '/foryou/'];
  for (const p of cases) {
    page.dom.reconfigure({ url: 'https://www.tiktok.com' + p });
    eq(`推荐流入口 ${p} 也加盐`, inst._contentSalt(), '#fyp-7681609972911705374');
  }

  // 作品页 / 图集页 / 主页：地址本身就是内容标识，不加盐
  const noSalt = [
    ['作品页', 'https://www.tiktok.com/@meowmeowcinematic/video/7681609972911705374'],
    ['图集页', 'https://www.tiktok.com/@kariina_choi/photo/7692501454971571508'],
    ['主页', 'https://www.tiktok.com/@kariina_choi'],
    ['搜索页', 'https://www.tiktok.com/search?q=cat']
  ];
  for (const [name, url] of noSalt) {
    page.dom.reconfigure({ url });
    eq(`${name} 不加盐`, inst._contentSalt(), '');
  }

  // 桥节点各种异常：一律返回空串（宁可不加盐，也不能误伤正常缓存）
  page.dom.reconfigure({ url: 'https://www.tiktok.com/' });
  const node = page.window.document.getElementById('clipmate-tiktok-fiber');

  node.textContent = bridgeJson(FYP_ITEM, 'item');
  eq('桥 scope 是 item（不是推荐流）→ 不加盐', inst._contentSalt(), '');

  node.textContent = JSON.stringify({ v: 1, scope: 'fyp', data: FYP_ITEM });
  eq('桥上没有 urlId → 不加盐', inst._contentSalt(), '');

  node.textContent = '{ 坏掉的 JSON';
  eq('桥 JSON 坏掉 → 不加盐（不许抛）', inst._contentSalt(), '');

  node.textContent = '';
  eq('桥节点为空 → 不加盐', inst._contentSalt(), '');

  node.textContent = bridgeJson(FYP_ITEM, 'fyp');
  eq('还原成正常推荐流 → 盐回来了', inst._contentSalt(), '#fyp-7681609972911705374');

  // 非 TikTok 域名不加盐
  page.dom.reconfigure({ url: 'https://www.douyin.com/' });
  eq('非 TikTok 域名 → 不加盐', inst._contentSalt(), '');

  page.dom.reconfigure({ url: 'https://www.tiktok.com/' });
  eq('换条后盐跟着变（这是不串台的关键）',
    (() => { node.textContent = bridgeJson(FYP_ITEM_B, 'fyp'); return inst._contentSalt(); })(),
    '#fyp-7679574777723440414');
}

/* ========================================================================== */
/* 二、缓存键每次提取前重算                                                     */
/* ========================================================================== */

async function section2() {
  section('二、缓存键：每次提取前重算，换条 / 页面内跳转都不许串台');

  // ---- 2.1 作品页之间 SPA 跳转（地址变了，键必须跟着变）----
  const A = { ...FYP_ITEM, id: '7681609972911705374' };
  const B = { ...FYP_ITEM_B, id: '7679574777723440414' };
  const { page, inst } = await open(
    `https://www.tiktok.com/@${A.uniqueId}/video/${A.id}`,
    itemHtml(A)
  );
  truthy('作品页 A 拿到实例', !!inst);
  if (!inst) return;

  eq('作品页 A 识别成社交类', inst.detectMediaType(), 'social');

  // 把「点按钮后浮窗拿到的那份数据」截下来 —— 这是唯一能证明缓存有没有串台的证据。
  // 不能用 runRealPath：它直接调 extractFromCurrentPage，永远重新解析，绕过缓存，
  // 断言恒真（第一版就是这么写的，反向验证时没变红，等于白测）。
  let shown = null;
  inst.modalManager.open = async (data) => { shown = data; };

  await inst.handleExtract();
  eq('A：点按钮后浮窗里是 A 的作者ID', shown && shown['作者ID'], A.uniqueId);
  // v2.6.1：话题井号被清掉，且清理时会把多余空格压成一个（原文 `#cats  @Meow` 是两个空格）
  eq('A：点按钮后浮窗里是 A 的文案', shown && shown['本页文案'],
    'HAHAHA FUNNY 🤣🤪😂trending funny animals viral cats @Meow Meow');
  const cacheAfterA = inst.cache.size;

  // 页面内跳转到作品 B：地址变、桥节点换成 B —— 但不重新加载页面（这就是 SPA 跳转）
  page.dom.reconfigure({ url: `https://www.tiktok.com/@${B.uniqueId}/video/${B.id}` });
  page.window.document.getElementById('clipmate-tiktok-fiber').textContent =
    JSON.stringify({ v: 1, scope: 'item', urlId: B.id, id: B.id, ts: Date.now(), data: B });

  await inst.handleExtract();
  eq('跳转后点按钮：浮窗里必须变成 B 的作者ID（改前是 A → 串台）',
    shown && shown['作者ID'], B.uniqueId);
  eq('跳转后点按钮：浮窗里必须变成 B 的文案', shown && shown['本页文案'], B.desc);
  truthy('两个地址各占一份缓存（改前只有一份，B 被 A 顶掉）',
    inst.cache.size > cacheAfterA, `size ${cacheAfterA} → ${inst.cache.size}`);

  // ---- 2.2 同一地址重复提取仍然命中缓存（缓存不能被改废）----
  const sizeBefore = inst.cache.size;
  await inst.handleExtract();
  eq('同一地址再点一次：数据不变', shown && shown['作者ID'], B.uniqueId);
  eq('同一地址再点一次：不会再多占缓存', inst.cache.size, sizeBefore);
}

/* ========================================================================== */
/* 三、空文案纪律（一手为准，空就空着）                                          */
/* ========================================================================== */

async function section3() {
  section('三、空文案纪律：一手说空就是空，不许拿平台话术凑数');

  // ---- 3.1 作品页：一手 desc 为空 ----
  {
    const { page, inst } = await open(
      `https://www.tiktok.com/@${EMPTY_DESC_ITEM.uniqueId}/video/${EMPTY_DESC_ITEM.id}`,
      itemHtml(EMPTY_DESC_ITEM, { domDesc: '' })
    );
    truthy('[作品页] 拿到实例', !!inst);
    if (inst) {
      const r = await H.runRealPath(page, inst);
      eq('[作品页] 一手 desc 空 + meta 有 SEO 话术 → 文案空着（不许拿 SEO 话术）',
        inst.currentExtractor.extractPageText(), '');
      eq('[作品页] 文案栏最终填的是兜底站名', r.data['本页文案'], 'TikTok视频');
      eq('[作品页] 标题里不许出现「TikTok 上的」',
        /TikTok 上的/.test(String(r.data['本页标题'] || '')), false);
    }
  }

  // ---- 3.2 作品页：一手 desc 有值（不许被纪律误伤）----
  {
    const { page, inst } = await open(
      `https://www.tiktok.com/@${FYP_ITEM.uniqueId}/video/${FYP_ITEM.id}`,
      itemHtml(FYP_ITEM)
    );
    if (inst) {
      await H.runRealPath(page, inst);
      eq('[作品页] 一手 desc 有值 → 原样返回', inst.currentExtractor.extractPageText(), FYP_ITEM.desc);
    }
  }

  // ---- 3.3 作品页：一手数据完全拿不到 → 回落 DOM（老链路不能丢）----
  {
    const html = itemHtml(FYP_ITEM).replace(/<script type="application\/json" id="clipmate-tiktok-fiber">[\s\S]*?<\/script>/, '');
    const { page, inst } = await open(
      `https://www.tiktok.com/@${FYP_ITEM.uniqueId}/video/${FYP_ITEM.id}`,
      html
    );
    if (inst) {
      await H.runRealPath(page, inst);
      // DOM 兜底会 trim，所以期望值也 trim（一手数据那个分支不 trim，见上一条）
      eq('[作品页] 一手拿不到 → 回落屏幕上的文案',
        inst.currentExtractor.extractPageText(), FYP_ITEM.desc.trim());
    }
  }

  // ---- 3.4 图集页：一手 desc 为空 → 兜底要写「图文」----
  {
    const { page, inst } = await open(
      `https://www.tiktok.com/@${EMPTY_DESC_PHOTO.uniqueId}/photo/${EMPTY_DESC_PHOTO.id}`,
      itemHtml(EMPTY_DESC_PHOTO)
    );
    truthy('[图集页] 拿到实例', !!inst);
    if (inst) {
      const r = await H.runRealPath(page, inst);
      eq('[图集页] 一手 desc 空 → 文案空着', inst.currentExtractor.extractPageText(), '');
      eq('[图集页] 兜底值是「TikTok图文」', r.data['本页文案'], 'TikTok图文');
      eq('[图集页] URL 拼成 /photo/', /\/photo\/7692501454971571508$/.test(String(r.data['URL'] || '')), true);
    }
  }

  // ---- 3.5 主页：一手签名空 → 不许拿「尚无个人简介。」----
  //
  // ⚠️ v2.7.22 契约变更：主页 `/@handle` 从「社交」改判「人物档案」，
  //    这条走的是 TikTokProfileExtractor（6 列），不再有 `extractPageText`。
  //    纪律本身不变：**签名空就是空，不许拿站点占位话凑数** —— 只是判据从
  //    「本页文案 空着」变成「简介里不许出现占位话」。
  {
    const { page, inst } = await open(
      'https://www.tiktok.com/@168cherry_jp',
      profileHtml('168cherry_jp')
    );
    truthy('[主页] 拿到实例', !!inst);
    if (inst) {
      // currentExtractor 是 extractFromCurrentPage 里赋值的，必须**跑完再读**
      const r = await H.runRealPath(page, inst);
      eq('[主页] v2.7.22 起走人物档案提取器',
        H.extractorNameOf(inst.currentExtractor), 'TikTokProfileExtractor');
      const bio = String(r.data['简介'] || '');
      eq('[主页] 空签名 + DOM 有占位 → 简介里不许出现「尚无个人简介」',
        /尚无个人简介/.test(bio), false);
      eq('[主页] 空签名也不许回落平台话术「TikTok视频」',
        /TikTok视频/.test(bio), false);
      eq('[主页] 账号名剥掉 @', r.data['账号名'], '168cherry_jp');
    }
  }

  // ---- 3.6 主页：一手签名有值 → 原样进简介 ----
  {
    const { page, inst } = await open(
      'https://www.tiktok.com/@kariina_choi',
      profileHtml('kariina_choi', { signature: '爱拍照的猫奴', nickname: 'kariina_choi' })
    );
    if (inst) {
      const r = await H.runRealPath(page, inst);
      eq('[主页] 一手签名有值 → 原样进简介',
        String(r.data['简介'] || '').indexOf('爱拍照的猫奴') > -1, true);
    }
  }

  // ---- 3.7 主页：首屏数据块缺失（一手完全拿不到）→ 回落 DOM ----
  {
    const { page, inst } = await open(
      'https://www.tiktok.com/@kariina_choi',
      profileHtml('kariina_choi', { signature: 'DOM 上的简介', noRehydration: true })
    );
    if (inst) {
      const r = await H.runRealPath(page, inst);
      eq('[主页] 一手拿不到 → 回落 DOM 简介', String(r.data['简介'] || ''), 'DOM 上的简介');
      // 空值会被 processData 裁掉（键不存在），所以按「取出来是空串」断言；
      // 这条仍能咬住「拿 @账号名顶替账号ID」的变异（那样这里会变成 kariina_choi）。
      eq('[主页] 一手拿不到时账号ID 留空（绝不拿 @账号名顶替）', String(r.data['账号ID'] || ''), '');
      eq('[主页] 账号名仍从 DOM 兜底', r.data['账号名'], 'kariina_choi');
    }
  }
}

/* ========================================================================== */
/* 主流程                                                                      */
/* ========================================================================== */

(async () => {
  console.log(`${C.cyan}TikTok 缓存串台 + 空文案纪律（v2.5.99）${C.reset}`);

  try {
    await section1();
    await section2();
    await section3();
  } catch (error) {
    bad('测试执行异常', String((error && error.stack) || error));
  }

  console.log('');
  if (failures.length) {
    console.log(`${C.red}✗ 失败 ${failures.length} 项，通过 ${pass} 项${C.reset}`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}${f.detail ? '  ' + f.detail : ''}`));
    process.exit(1);
  }
  console.log(`${C.green}✓ 全部通过：${pass} 项${C.reset}`);
  process.exit(0);
})();
