/**
 * YouTube 频道页（个人主页）提取器 v2.7.24 —— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = `UC…`（频道内部稳定 ID）；账号名 = `@handle` 去 @
 *   C. 网址 = `https://www.youtube.com/channel/UC…`（用户 2026-10-31 拍板的官方形态），
 *      从 `/@handle` 进来也一样存这串；拿不到 UC 才回落 `@handle`
 *   D. 简介 = 统计行（`订阅者：… · 视频：…`）+ 签名全文 + 外链（**一行一条**）
 *   E. 数字**照页面原样**（`4660万位订阅者` → `4660万`，不许换成 JSON-LD 的 46600000）
 *   F. `microformat` 那份简介是**截断版**（真机 160 字 vs 全文 560 字），绝不能用
 *   G. 外链取自 JSON-LD `sameAs`，排除「订阅」按钮（`sub_confirmation=1`）与站内地址；
 *      DOM 兜底时要把 `/redirect?…&q=` 跳转壳解回真地址
 *
 * ⚠️ 一级红线（本文件最硬的断言）：
 *   1. JSON-LD 里的 UC / @handle 必须与地址栏一致，否则整份弃用（退 DOM）。
 *      本项目已经在小红书 `userInfo`、快手 `/rest/v/profile/get`、IG `PolarisViewer`、
 *      快手 v2.7.10 上栽过四次「数据块里不是页面主人」，这是第五次边界。
 *      **handle 比对必须大小写不敏感** —— 真机实测地址 `@MediaStorm`、页面 `@mediastorm`。
 *   2. 只认 `@type=ProfilePage` 的 JSON-LD；作品页的 `VideoObject` 不许当频道。
 *   3. 源码里不许出现 `microformatDataRenderer`、`window.ytInitialData`（剥注释后查）。
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge）
 *   `/@MediaStorm`：昵称 MediaStorm｜handle `@mediastorm`（页面小写）｜
 *                   UC = UCa91Shr2Old7rhvdBSPnVBw｜`2410位订阅者`、`235 个视频`｜简介 560 字
 *   `/@YouTube`  ：昵称 YouTube｜handle `@YouTube`｜UC = UCBR8-60-B28hp2BmDPdntcQ｜
 *                   `4660万位订阅者`、`1685 个视频`｜sameAs 第一条是订阅按钮
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

const UC = 'UCa91Shr2Old7rhvdBSPnVBw';
const HANDLE = 'mediastorm';
const SIGN = 'MediaStorm is committed to the power of storytelling.';
const BASE_URL = 'https://www.youtube.com/@' + HANDLE;
const CHANNEL_URL = 'https://www.youtube.com/channel/' + UC;

const LINKS = [
  'http://mediastorm.com',
  'https://www.facebook.com/mediastorm.org',
  'https://twitter.com/mediastorm',
  'http://linkedin.com/company/mediastorm/',
  'http://mediastorm.com/blog'
];

/**
 * JSON-LD（`<script type="application/ld+json">`），结构照真机
 * @param {Object} o 覆盖项
 *   - `type`     顶层 @type（默认 ProfilePage；作品页是 VideoObject）
 *   - `uc`       主体 url 里的 UC
 *   - `handle`   alternateName
 *   - `desc`     简介全文
 *   - `sameAs`   外链数组
 *   - `absent`   true = 整份不出现
 */
function ldHtml(o) {
  const opt = o || {};
  if (opt.absent) return '';
  const type = opt.type === undefined ? 'ProfilePage' : opt.type;

  if (type === 'VideoObject') {
    return `<script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'VideoObject',
      name: '某条视频',
      description: '视频简介',
      uploadDate: '2026-10-01T00:00:00Z'
    })}</script>`;
  }

  const uc = opt.uc === undefined ? UC : opt.uc;
  const handle = opt.handle === undefined ? '@' + HANDLE : opt.handle;
  const desc = opt.desc === undefined ? SIGN : opt.desc;
  const sameAs = opt.sameAs === undefined ? LINKS : opt.sameAs;

  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: 'https://www.youtube.com/channel/' + uc,
    name: '频道 - YouTube',
    description: desc,
    mainEntity: {
      '@type': 'Person',
      name: opt.name === undefined ? 'MediaStorm' : opt.name,
      url: 'https://www.youtube.com/channel/' + uc,
      alternateName: handle,
      image: 'https://yt3.googleusercontent.com/x=s88',
      description: desc,
      sameAs: sameAs,
      interactionStatistic: [{
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'FollowAction' },
        userInteractionCount: '2410'
      }]
    }
  })}</script>`;
}

/**
 * `ytInitialData` 数据块（inline script）
 *
 * 真实结构里统计两串都在 header.pageHeaderRenderer 的 metadataParts 里；
 * 这里只保证「文本里能找到」——提取器是按文本截 header 段再正则的。
 */
function ytDataHtml(o) {
  const opt = o || {};
  if (opt.absent || opt.ytAbsent) return '';
  const subs = opt.subs === undefined ? '2410位订阅者' : opt.subs;
  const vids = opt.vids === undefined ? '235 个视频' : opt.vids;
  const handle = opt.headerHandle === undefined ? '@' + HANDLE : opt.headerHandle;

  const data = {
    responseContext: { serviceTrackingParams: [] },
    header: {
      pageHeaderRenderer: {
        pageTitle: opt.headerTitle === undefined ? 'MediaStorm' : opt.headerTitle,
        content: {
          pageHeaderViewModel: {
            title: { dynamicTextViewModel: { text: { content: 'MediaStorm' } } },
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [{
                  metadataParts: [
                    { text: { content: handle } },
                    { text: { content: subs } },
                    { text: { content: vids } }
                  ]
                }]
              }
            }
          }
        }
      }
    }
  };
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
}

/**
 * about 页的 `aboutChannelViewModel`（v2.7.24）
 *
 * 结构照真机 2026-10-31 实拍（`@taishengding` / `@mediastorm`）：
 *   description        简介**全文**
 *   country            国家（`日本` / `美国`）
 *   joinedDateText     是对象 `{content:'2022年5月21日注册'}`，不是裸字符串
 *   viewCountText      `5,398,090次观看`（千分位就是页面原样）
 *   channelId          本频道 UC（防串台靠它）
 *   links[]            `channelExternalLinkViewModel`，真地址藏在
 *                      `link.commandRuns[].onTap.innertubeCommand.urlEndpoint.url` 的 redirect 壳里
 */
function aboutData(o) {
  const opt = o || {};
  return {
    aboutChannelViewModel: {
      description: opt.desc === undefined ? SIGN : opt.desc,
      descriptionLabel: { content: '说明', styleRuns: [{ startIndex: 0, length: 2 }] },
      country: opt.country === undefined ? '美国' : opt.country,
      subscriberCountText: opt.subs === undefined ? '2410位订阅者' : opt.subs,
      viewCountText: opt.views === undefined ? '260,221次观看' : opt.views,
      joinedDateText: {
        content: opt.joined === undefined ? '2006年8月29日注册' : opt.joined,
        styleRuns: [{ startIndex: 0, length: 12 }]
      },
      canonicalChannelUrl: opt.canonicalUrl === undefined
        ? ('http://www.youtube.com/@' + HANDLE) : opt.canonicalUrl,
      channelId: opt.channelId === undefined ? UC : opt.channelId,
      additionalInfoLabel: { content: '更多信息', styleRuns: [{ startIndex: 0, length: 4 }] },
      videoCountText: opt.vids === undefined ? '235 个视频' : opt.vids,
      links: opt.links === undefined ? [] : opt.links
    }
  };
}

/**
 * 页面 HTML
 *
 * ⚠️ 结构照真机（2026-10-31 `@MediaStorm` 实拍）：
 *   `<yt-page-header-view-model>` 里 h1 昵称 + `@handle` + 两串统计 + 简介块
 *   统计的文本形态是 `2410位订阅者`（数字与标签紧挨，无空格）
 */
function pageHtml(o) {
  const opt = o || {};
  const domHandle = opt.domHandle === undefined ? '@' + HANDLE : opt.domHandle;
  const domSubs = opt.domSubs === undefined ? '2410位订阅者' : opt.domSubs;
  const domVids = opt.domVids === undefined ? '235 个视频' : opt.domVids;
  const domTitle = opt.domTitle === undefined ? 'MediaStorm' : opt.domTitle;

  const statsHtml = [
    domHandle ? `<span>${domHandle}</span>` : '',
    domSubs ? `<span>${domSubs}</span>` : '',
    domVids ? `<span>${domVids}</span>` : ''
  ].filter(Boolean).join('<span>•</span>');

  // DOM 简介块（真机读出来是全文 + 「…更多」尾巴）
  const domDesc = opt.domDesc === undefined ? (SIGN + ' …更多') : opt.domDesc;
  const descHtml = domDesc ? `<div class="ytDescriptionPreviewViewModelHost ytPageHeaderViewModelDescr">${domDesc}</div>` : '';

  const canonical = opt.canonical === undefined ? CHANNEL_URL : opt.canonical;
  const canonHtml = canonical ? `<link rel="canonical" href="${canonical}">` : '';

  // 模拟「用户当前就停在 about 页」：数据直接摆在页面脚本里
  const aboutHtml = opt.aboutInPage
    ? `<script>var ytInitialData = ${JSON.stringify(aboutData(opt.about))};</script>`
    : '';

  return `<!doctype html><html><head>
    <title>${domTitle} - YouTube</title>
    ${canonHtml}
  </head><body>
    <yt-page-header-view-model>
      <h1>${domTitle}</h1>
      <div>${statsHtml}</div>
      ${descHtml}
    </yt-page-header-view-model>
    ${ldHtml(opt)}
    ${ytDataHtml(opt)}
    ${aboutHtml}
  </body></html>`;
}

/** 按依赖顺序装真正的模块 */
function makePage(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html, { url: opt.url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/youtube-profile.js'
  ];
  for (const rel of scripts) w.eval(fs.readFileSync(P(rel), 'utf8'));

  // fetch 桩：jsdom 没有 fetch，这里显式提供并**记录调用**。
  // 默认一律 reject —— 测试绝不允许发真实网络请求。
  const impl = typeof opt.fetch === 'function'
    ? opt.fetch
    : () => Promise.reject(new Error('no-fetch-in-test'));
  w.__fetchCalls = [];
  w.fetch = function (u, init) {
    w.__fetchCalls.push(String(u));
    return impl(u, init);
  };
  return w;
}

async function extract(w) {
  const ex = new w.YoutubeProfileExtractor();
  return await ex.extractAllFields();
}

const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];

/* ============================ 跑 ============================ */
(async () => {

  /* ==================== 1. 六列契约 ==================== */
  section('1. 六列契约：列名/列序/取值');

  const w1 = makePage({ url: BASE_URL, html: pageHtml() });
  const r1 = await extract(w1);

  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('平台 = YouTube', r1['平台'], 'YouTube');
  eq('昵称取 JSON-LD mainEntity.name', r1['昵称'], 'MediaStorm');
  eq('账号ID = UC 频道ID', r1['账号ID'], UC);
  eq('账号名 = alternateName 去 @', r1['账号名'], 'mediastorm');
  eq('网址 = /channel/UC… 官方形态', r1['网址'], CHANNEL_URL);
  eq('媒体类型标记', r1.mediaType, 'person');
  eq('personKind = account', r1.personKind, 'account');

  /* ==================== 2. 统计数字照页面原样 ==================== */
  section('2. 统计数字照页面原样');

  const bio1 = String(r1['简介'] || '');
  const lines1 = bio1.split('\n');
  eq('简介第一行 = 订阅者 / 视频', lines1[0], '订阅者：2410 · 视频：235');
  eq('简介里不出现「粉丝」（YouTube 叫订阅者）', /粉丝/.test(bio1), false);
  eq('简介第二行是签名全文', lines1[1], SIGN);

  // 大频道：页面 `4660万位订阅者`，JSON-LD 精确值 46600000 —— 必须用页面那份
  {
    const w = makePage({
      url: 'https://www.youtube.com/@YouTube',
      html: pageHtml({
        domHandle: '@YouTube',
        domSubs: '4660万位订阅者',
        domVids: '1685 个视频',
        domTitle: 'YouTube',
        uc: 'UCBR8-60-B28hp2BmDPdntcQ',
        handle: '@YouTube',
        desc: "YouTube's official YouTube channel",
        sameAs: [
          'https://youtube.com/user/youtube?sub_confirmation=1',
          'https://instagram.com/youtube',
          'https://www.tiktok.com/@youtube',
          'https://blog.youtube/creator-and-artist-stories/'
        ],
        subs: '4660万位订阅者',
        vids: '1685 个视频',
        headerHandle: '@YouTube'
      })
    });
    const r = await extract(w);
    const first = String(r['简介'] || '').split('\n')[0];
    eq('4660万 原样保留（不反解精确值）', first, '订阅者：4660万 · 视频：1685');
    eq('简介里不出现 46600000', /46600000/.test(String(r['简介'] || '')), false);
    eq('网址仍是 /channel/UC… 形态', r['网址'], 'https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ');
  }

  // 只有订阅数（没有视频数）→ 只出一项，不留「视频：」半截
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ vids: '', domVids: null }) });
    const r = await extract(w);
    const first = String(r['简介'] || '').split('\n')[0];
    eq('没有视频数 → 只出订阅者', first, '订阅者：2410');
    eq('不留「视频：」半截', /视频/.test(first), false);
  }

  /* ==================== 3. 简介：全文，绝不用 microformat 那份截断版 ==================== */
  section('3. 简介必须是全文');

  // 560 字长简介：JSON-LD 是全文，页面上另一处 microformat 只有 160 字
  {
    const longDesc = 'A'.repeat(520) + '这是结尾的一段话。';
    // ⚠️ 截断版必须**不是**全文的前缀子串，否则 `indexOf` 永远命中，断言恒绿。
    const shortDesc = 'MICROFORMAT-TRUNCATED-' + 'B'.repeat(120);

    // 真机里 microformat 那份就在 ytInitialData 的 metadata.microformat 下
    const ytData = {
      header: {
        pageHeaderRenderer: {
          pageTitle: 'MediaStorm',
          content: {
            pageHeaderViewModel: {
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [{
                    metadataParts: [
                      { text: { content: '@' + HANDLE } },
                      { text: { content: '2410位订阅者' } }
                    ]
                  }]
                }
              }
            }
          }
        }
      },
      metadata: { microformat: { microformatDataRenderer: { description: shortDesc } } }
    };
    const inject = '<script>var ytInitialData = ' + JSON.stringify(ytData) + ';</script></body>';
    const html = pageHtml({ desc: longDesc }).replace('</body>', inject);
    const w = makePage({ url: BASE_URL, html });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('长简介完整保留（520+ 字没被砍）', bio.indexOf(longDesc) > -1, '长度 ' + bio.length);
    eq('简介里不含 microformat 那份截断版尾巴',
      bio.indexOf(shortDesc) > -1, false);
  }

  // 页内跳转态（没有 JSON-LD）→ 读 DOM，剪掉「…更多」
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ absent: true }) });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('DOM 兜底能读到签名', bio.indexOf(SIGN) > -1, bio);
    eq('DOM 的「…更多」被剪掉', /更多/.test(bio), false);
  }

  // 简介里的换行保留
  {
    const multi = '第一段\n第二段';
    const w = makePage({ url: BASE_URL, html: pageHtml({ desc: multi }) });
    const r = await extract(w);
    truthy('多行签名保留换行', String(r['简介'] || '').indexOf('第一段\n第二段') > -1, r['简介']);
  }

  /* ==================== 4. 外链 ==================== */
  section('4. 外链：一行一条，排除订阅按钮与站内地址');

  const linkLines = lines1.slice(2);
  eq('外链条数与 sameAs 一致', linkLines.length, LINKS.length);
  eq('外链逐行原样', linkLines, LINKS);

  // YouTube 官方号：sameAs 第一条是订阅按钮（sub_confirmation=1）→ 排除
  {
    const w = makePage({
      url: 'https://www.youtube.com/@YouTube',
      html: pageHtml({
        domHandle: '@YouTube', domTitle: 'YouTube',
        uc: 'UCBR8-60-B28hp2BmDPdntcQ', handle: '@YouTube',
        desc: "YouTube's official YouTube channel",
        sameAs: [
          'https://youtube.com/user/youtube?sub_confirmation=1',
          'https://instagram.com/youtube',
          'https://www.tiktok.com/@youtube',
          'https://blog.youtube/creator-and-artist-stories/'
        ],
        subs: '4660万位订阅者', vids: '1685 个视频', headerHandle: '@YouTube'
      })
    });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('订阅按钮不许当外链', /sub_confirmation/.test(bio), false);
    eq('站内 /user/ 地址不许当外链', /youtube\.com\/user\//.test(bio), false);
    const links = bio.split('\n').slice(2);
    eq('剩下 3 条真外链', links, [
      'https://instagram.com/youtube',
      'https://www.tiktok.com/@youtube',
      'https://blog.youtube/creator-and-artist-stories/'
    ]);
  }

  // DOM 兜底：`yt-channel-external-link-view-model` 里是 /redirect?…&q= 跳转壳
  {
    const real = 'https://instagram.com/youtube';
    const shell = 'https://www.youtube.com/redirect?event=channel_description&redir_token=abc&q=' +
                  encodeURIComponent(real);
    const html = pageHtml({ absent: true }).replace('</body>',
      `<yt-channel-external-link-view-model><a href="${shell}">Instagram</a></yt-channel-external-link-view-model>
       <yt-channel-external-link-view-model><a href="https://youtube.com/user/youtube?sub_confirmation=1">Subscribe</a></yt-channel-external-link-view-model>
      </body>`);
    const w = makePage({ url: BASE_URL, html });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('跳转壳被解回真地址', bio.indexOf(real) > -1, bio);
    eq('壳地址本身不许进档案', /\/redirect\?/.test(bio), false);
  }

  /* ==================== 5. 防串台：闸口 ==================== */
  section('5. 防串台：JSON-LD 不是页面主人 → 整份弃用');

  // 地址是 /@mediastorm，JSON-LD 里是别人 → 弃用
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ uc: 'UCxxxxxxxxxxxxxxxxxxxxxx', handle: '@someone_else', name: '别人的频道', desc: '别人的签名' })
    });
    const r = await extract(w);
    eq('闸口挡住 → 账号ID 不拿别人的 UC', r['账号ID'], '');
    eq('闸口挡住 → 昵称回落 DOM', r['昵称'], 'MediaStorm');
    eq('闸口挡住 → 账号名回落 DOM/地址栏', r['账号名'], 'mediastorm');
    eq('闸口挡住 → 简介里没有别人的签名', String(r['简介'] || '').indexOf('别人的签名') > -1, false);
    eq('闸口挡住 → 网址回落 @handle 形态（绝不编 UC）', r['网址'], 'https://www.youtube.com/@mediastorm');
  }

  // ⚠️ 大小写：真机地址 `@MediaStorm`、页面 `@mediastorm` —— 必须放行
  {
    const w = makePage({ url: 'https://www.youtube.com/@MediaStorm', html: pageHtml() });
    const r = await extract(w);
    eq('handle 比对大小写不敏感 → 正常取到 UC', r['账号ID'], UC);
    eq('账号名用页面显示的原样（小写）', r['账号名'], 'mediastorm');
  }

  // 地址是 /channel/UC… → 按 UC 校验
  {
    const w = makePage({ url: CHANNEL_URL, html: pageHtml() });
    const r = await extract(w);
    eq('/channel/ 形态：UC 一致 → 正常', r['账号ID'], UC);
    eq('/channel/ 形态：网址仍是同一串', r['网址'], CHANNEL_URL);
  }

  // 地址是 /channel/别的UC → 弃用
  {
    const w = makePage({
      url: 'https://www.youtube.com/channel/UCzzzzzzzzzzzzzzzzzzzzzz',
      // DOM 上的签名必须与 JSON-LD 明显不同，否则「不许用 JSON-LD 那份」根本咬不住
      html: pageHtml({ domDesc: '这是页面上 DOM 自己的签名 …更多' })
    });
    const r = await extract(w);
    eq('UC 对不上 → 账号ID 用地址栏那个（不是 JSON-LD 的）', r['账号ID'], 'UCzzzzzzzzzzzzzzzzzzzzzz');
    eq('UC 对不上 → 简介里不许出现 JSON-LD 的签名', String(r['简介'] || '').indexOf(SIGN) > -1, false);
    truthy('UC 对不上 → 简介走 DOM 那份', String(r['简介'] || '').indexOf('这是页面上 DOM 自己的签名') > -1, r['简介']);
  }

  // 作品页的 VideoObject JSON-LD 不许当频道
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ type: 'VideoObject', absent: false }) });
    const r = await extract(w);
    eq('VideoObject 不被误认成频道 → 账号ID 从地址栏/兜底（/ @ 形态拿不到 UC）', r['账号ID'], '');
    eq('VideoObject 不被误认 → 昵称回 DOM', r['昵称'], 'MediaStorm');
  }

  /* ==================== 6. 统计的防串台 ==================== */
  section('6. 统计：header 段里的 handle 对不上就不用');

  // ytInitialData 的 header 里是别人（页内跳转后没更新）
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ subs: '9999位订阅者', vids: '888 个视频', headerHandle: '@someone_else' })
    });
    const r = await extract(w);
    const first = String(r['简介'] || '').split('\n')[0];
    eq('header 是别人的 → 用 DOM 自己的统计', first, '订阅者：2410 · 视频：235');
    eq('别人的数字没混进来', /9999|888/.test(first), false);
  }

  // 没有 ytInitialData → 全走 DOM
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ absent: true })
    });
    const r = await extract(w);
    eq('没有数据块 → 统计仍从 DOM 读到', String(r['简介'] || '').split('\n')[0], '订阅者：2410 · 视频：235');
  }

  /* ==================== 7. 站点判定（media-detector 真跑） ==================== */
  section('7. 站点判定：频道页 person、作品页 social');

  async function detect(url) {
    const w = makePage({ url, html: pageHtml() });
    w.eval(fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8'));
    // 构造时会异步读后台配置；给一个必失败桩让它走内置默认配置
    w.WBR = { runtime: { sendMessage: async () => { throw new Error('jsdom'); } } };
    const det = new w.MediaTypeDetector();
    await new Promise((r) => setTimeout(r, 30));
    return det.detect(url, w.document);
  }

  eq('/@handle → person', await detect(BASE_URL), 'person');
  eq('/@handle/ → person', await detect(BASE_URL + '/'), 'person');
  eq('/@handle/videos → person', await detect(BASE_URL + '/videos'), 'person');
  eq('/channel/UC… → person', await detect(CHANNEL_URL), 'person');
  eq('/channel/UC…/about → person', await detect(CHANNEL_URL + '/about'), 'person');
  eq('/watch?v= → social', await detect('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'social');
  eq('/shorts/<id> → social', await detect('https://www.youtube.com/shorts/abcdEFG1234'), 'social');
  eq('首页 → 不是 person', (await detect('https://www.youtube.com/')) === 'person', false);
  eq('订阅页 → 不是 person', (await detect('https://www.youtube.com/feed/subscriptions')) === 'person', false);
  eq('搜索结果页 → 不是 person', (await detect('https://www.youtube.com/results?search_query=abc')) === 'person', false);
  eq('旧式 /c/ → 不是 person（不新增口径）', (await detect('https://www.youtube.com/c/someone')) === 'person', false);

  /* ==================== 8. 工厂路由 ==================== */
  section('8. 工厂：person 规则必须排在通配 social 之前');

  {
    const w = makePage({ url: BASE_URL, html: pageHtml() });
    const src = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
    const personIdx = src.indexOf("hostname: 'www.youtube.com', mediaType: 'person'");
    const socialIdx = src.indexOf("hostname: 'www.youtube.com', mediaType: 'social'");
    truthy('工厂里有 YouTube person 规则', personIdx > -1);
    truthy('工厂里 person 排在 social 之前', personIdx > -1 && socialIdx > -1 && personIdx < socialIdx,
      { personIdx, socialIdx });
    truthy('工厂注册了 YoutubeProfileExtractor', /className: 'YoutubeProfileExtractor'/.test(src));
    truthy('工厂给 person 类型挂了 www.youtube.com', /YoutubeProfileExtractor[\s\S]{0,400}types: \['person'\]/.test(src));
  }

  /* ==================== 9. 网址规范化（url-normalizer 真跑） ==================== */
  section('9. 网址规范化：频道子页归一成主页');

  {
    const w = makePage({ url: BASE_URL, html: pageHtml() });
    const N = w.UrlNormalizer;
    eq('@handle 保留', N.normalize('https://www.youtube.com/@mediastorm'), 'https://www.youtube.com/@mediastorm');
    eq('@handle 带 ?si= 去掉', N.normalize('https://www.youtube.com/@mediastorm?si=abc'), 'https://www.youtube.com/@mediastorm');
    eq('/channel/UC… 保留', N.normalize(CHANNEL_URL), CHANNEL_URL);
    eq('/channel/UC…/videos 归一成主页', N.normalize(CHANNEL_URL + '/videos'), CHANNEL_URL);
    eq('/@handle/about 归一成主页', N.normalize(BASE_URL + '/about'), 'https://www.youtube.com/@mediastorm');
    eq('作品页规则不受影响', N.normalize('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'),
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    eq('Shorts 规则不受影响', N.normalize('https://www.youtube.com/shorts/abcdEFG1234?feature=share'),
      'https://www.youtube.com/shorts/abcdEFG1234');
  }

  /* ==================== 10. manifest 与源码纪律 ==================== */
  section('10. manifest 注册与源码纪律');

  {
    const mf = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
    truthy('manifest 注册了 youtube-profile.js',
      JSON.stringify(mf.content_scripts).indexOf('src/content/extractors/youtube-profile.js') > -1);
    truthy('manifest 版本已升到 2.12.0', mf.version === '2.12.10', mf.version);

    const src = stripComments(fs.readFileSync(P('src/content/extractors/youtube-profile.js'), 'utf8'));
    eq('源码里不许读 microformat 那份截断简介', /microformatDataRenderer/.test(src), false);
    eq('源码里不许用 window.ytInitialData（隔离世界读不到）', /window\.ytInitialData/.test(src), false);
    truthy('源码确实在读 JSON-LD', /application\/ld\+json/.test(src));
    truthy('源码确实在读 ytInitialData 的 script 文本',
      /indexOf\('ytInitialData'\)/.test(src));
    truthy('源码有 UC 一致性校验', /_ldMatchesLocation/.test(src));
    truthy('源码有 handle 大小写不敏感比对', /toLowerCase\(\) === urlHandle\.toLowerCase\(\)/.test(src));
    eq('源码里不许出现 canonical 兜底（页内跳转时它是旧的，会串台）',
      /link\[rel="canonical"\]/.test(src), false);
  }

  /* ==================== 11. 双份站点配置必须一字不差 ==================== */
  section('11. media-detector 与 background 的 YouTube 配置逐字一致');

  {
    const det = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
    const bg = fs.readFileSync(P('src/background/background.js'), 'utf8');

    // 抽**所有**含 channel/UC 的 person 正则，两份必须逐条一致。
    //
    // ⚠️ 不能只 `match` 第一条：同一段正则在本文件里出现两次（www + 裸域名），
    //    match 只会拿第一处 —— 改坏另一处时两边都取到"没坏的那份"，断言恒绿
    //    （v2.7.17 踩过：`String.replace` 只改第一处，改到的可能不是目标）。
    const collect = (src) => {
      const re = /\{ type: 'person', regex: '([^']*channel\/UC[^']*)' \}/g;
      const out = [];
      let m;
      while ((m = re.exec(src)) !== null) out.push(m[1]);
      return out;
    };
    const detList = collect(det);
    const bgList = collect(bg);
    eq('YouTube person 规则各 2 条（www + 裸域名）', detList.length, 2);
    eq('background 也是 2 条', bgList.length, 2);
    eq('两份 person 正则逐条逐字一致', detList, bgList);

    // 顺序：person 必须在 social 之前（social 在前会把主页吃成社交）
    const detPersonIdx = det.indexOf("{ type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC");
    const detSocialIdx = det.indexOf("'www.youtube.com': {");
    truthy('media-detector：YouTube 块里 person 在 social 之前', detPersonIdx > detSocialIdx,
      { detPersonIdx, detSocialIdx });

    // 弹窗持久化：YouTube person 兜底必须排在 `youtube.com/` → social 之前
    // ⚠️ `modal-persistence.js` 是 **CRLF** 文件，这里刻意只用单行匹配，
    //    不跨行拼 `\n`（v2.7.17 踩过：CRLF 下 indexOf 找不到，把红伪装成跳过）。
    const persist = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
    const pIdx = persist.indexOf("if (url.includes('youtube.com/')) {");
    const sIdx = persist.indexOf('// 社交媒体类型 - YouTube');
    truthy('弹窗持久化里有 YouTube 主页兜底', pIdx > -1);
    truthy('弹窗持久化：person 兜底排在 social 之前', pIdx > -1 && sIdx > -1 && pIdx < sIdx,
      { pIdx, sIdx });
  }

  /* ==================== 12. about 页：国家 / 加入日期 / 总观看（v2.7.24） ==================== */
  section('12. about 页数据：国家 / 加入日期 / 总观看');

  // 用户当前就停在 about 页 → 数据在页面脚本里，零请求
  {
    const w = makePage({ url: BASE_URL, html: pageHtml({ aboutInPage: true, about: {} }) });
    const r = await extract(w);
    const lines = String(r['简介'] || '').split('\n');
    eq('当前页有 about 数据 → 不发任何请求', w.__fetchCalls.length, 0);
    eq('行序：统计行 → 签名 → 国家 → 加入日期 → 总观看', lines.slice(0, 5),
      ['订阅者：2410 · 视频：235', SIGN, '国家：美国', '加入日期：2006年8月29日', '总观看：260,221']);
    eq('加入日期剥掉页面尾巴「注册」', /注册/.test(lines[3] || ''), false);
    eq('总观看保留千分位逗号（照页面原样）', lines[4], '总观看：260,221');
  }

  // 主页（页面没有 about）→ fetch 一次 about 页
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml(),
      fetch: (u) => {
        if (u !== '/@' + HANDLE + '/about') {
          return Promise.reject(new Error('fetch 了不该 fetch 的地址：' + u));
        }
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('<script>var ytInitialData = ' + JSON.stringify(aboutData({})) + ';</script>')
        });
      }
    });
    const r = await extract(w);
    eq('主页提取会 fetch 一次 about 页', w.__fetchCalls.length, 1);
    eq('fetch 的地址是 /@handle/about', w.__fetchCalls[0], '/@' + HANDLE + '/about');
    truthy('fetch 到 about 后简介带上国家', String(r['简介'] || '').indexOf('国家：美国') > -1, r['简介']);
  }

  // 地址是 /channel/UC… → fetch /channel/UC…/about
  {
    const w = makePage({
      url: CHANNEL_URL,
      html: pageHtml(),
      fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(aboutData({}))) })
    });
    await extract(w);
    eq('/channel/UC… 入口 → fetch /channel/UC…/about',
      w.__fetchCalls[0], '/channel/' + UC + '/about');
  }

  // fetch 失败（断网 / 被拦 / 超时）→ 优雅降级，不许抛错
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ sameAs: [] }),
      fetch: () => Promise.reject(new Error('network down'))
    });
    const r = await extract(w);
    eq('fetch 失败不影响其余字段', r['昵称'], 'MediaStorm');
    eq('fetch 失败 → 简介只剩统计行+签名', String(r['简介'] || '').split('\n').length, 2);
    eq('fetch 失败也不留「国家：」半截', /国家/.test(String(r['简介'] || '')), false);
  }

  // 简介里带英文引号 + 花括号 → JSON 里是 `\"` 和字面 `{`
  // 配平时必须正确识别「引号内的花括号不算结构括号」，否则整份解析失败
  {
    const tricky = 'He said "look at this {" marker."';
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ aboutInPage: true, about: { desc: tricky }, sameAs: [] })
    });
    const r = await extract(w);
    const lines = String(r['简介'] || '').split('\n');
    eq('简介含引号+花括号时 about 数据仍能完整解析', lines[1], tricky);
    truthy('该场景下国家仍在', lines.indexOf('国家：美国') > -1, lines);
  }

  // 数据块与 DOM 都读不到统计 → 必须用 about 里的同款字符串兜上
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({
        aboutInPage: true, about: {}, domSubs: null, domVids: null, ytAbsent: true
      })
    });
    const r = await extract(w);
    eq('数据块与 DOM 都没统计 → 用 about 兜底',
      String(r['简介'] || '').split('\n')[0], '订阅者：2410 · 视频：235');
  }

  /* ---------- v2.7.25 修正：两处「静默丢数据」的坑 ---------- */

  // ① 页面脚本里有 about 数据、但 channelId 是**别的频道** → 丢掉它之后必须继续 fetch。
  //    早先写法是「有对象就置 null 完事」，一份脏脚本数据能把 fetch 这条路整个堵死，
  //    表现就是国家/加入日期/总观看整份缺失，而且一点日志都没有。
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({ aboutInPage: true, about: { channelId: 'UCwrongwrongwrongwrong00' } }),
      fetch: () => Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(aboutData({})))
      })
    });
    const r = await extract(w);
    eq('脚本里的 about 是别的频道 → 仍要去 fetch 一次', w.__fetchCalls.length, 1);
    truthy('fetch 到的正确数据被采用（不是整份丢弃）',
      String(r['简介'] || '').indexOf('国家：美国') > -1, r['简介']);
    eq('两条来源都不可信时也不许编数据', /UCwrong/.test(String(r['账号ID'] || '')), false);
  }

  // ② 超时不能是「整段一个 3000ms」：about 页整份 HTML 约 2.5MB，
  //    真机实测头部 0.5~1.1 秒、正文读完要到 2.6 秒 —— 3 秒是临界值，
  //    扩展里再加一点调度抖动就被 abort，好数据被丢掉且不报错。
  {
    const src = fs.readFileSync(P('src/content/extractors/youtube-profile.js'), 'utf8');
    const a = src.indexOf('async _aboutFromFetch()');
    const end = src.indexOf('\n  /**', a);
    const body = a > -1 ? src.slice(a, end > a ? end : a + 4000) : '';
    truthy('找得到 _aboutFromFetch 方法体', body.length > 200, body.length);
    truthy('阶段一：等响应头 5 秒', /arm\(5000\)/.test(body));
    truthy('阶段二：读正文 6 秒（2.5MB 体量）', /arm\(6000\)/.test(body));
    eq('不再用单段 3000ms 定时器', /\b3000\b/.test(body), false);
    truthy('失败要 console.warn 留痕（否则字段为什么空查不出来）',
      (body.match(/console\.warn/g) || []).length >= 2);
  }

  // 地址是 /@handle/about：没有 UC、about 页的 JSON-LD 还是 VideoObject
  // → 账号ID 只能靠 about.channelId，绝不能留空、更不能拿 @账号名顶替
  {
    const w = makePage({
      url: BASE_URL + '/about',
      html: pageHtml({ aboutInPage: true, about: {}, absent: true })
    });
    const r = await extract(w);
    eq('about 页（无 JSON-LD、地址无 UC）→ 账号ID 来自 about.channelId', r['账号ID'], UC);
    eq('拿不到 UC 时不拿 @账号名顶替', r['账号ID'] === HANDLE, false);
    eq('网址仍是 /channel/UC… 形态', r['网址'], CHANNEL_URL);
  }

  /* ==================== 13. about 防串台 ==================== */
  section('13. about 防串台：channelId 必须是自己');
  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml(),
      fetch: () => Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(aboutData({
          channelId: 'UCZZZZZZZZZZZZZZZZZZZZZZ',
          country: '别人国',
          joined: '1999年1月1日注册'
        })))
      })
    });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    eq('about.channelId 不是本频道 → 整份弃用', /别人国|别人/.test(bio), false);
    eq('弃用后不写「加入日期：」', /加入日期/.test(bio), false);
    eq('账号ID 仍取自己那份', r['账号ID'], UC);
  }

  // 假命中：service 名清单里也有 aboutChannelViewModel 字样
  {
    const html = pageHtml({ sameAs: [] }).replace('</body>',
      '<script>var svc = ["aboutChannelViewModel","menuPopupRenderer","toggleMenuServiceItemRenderer"];</script></body>');
    const w = makePage({ url: BASE_URL, html, fetch: () => Promise.reject(new Error('nope')) });
    const r = await extract(w);
    eq('service 名清单不会被当成 about 数据', /国家/.test(String(r['简介'] || '')), false);
  }

  /* ==================== 14. 外链：about.links 兜底要解 redirect 壳 ==================== */
  section('14. 外链：about 页 links 兜底');

  {
    const w = makePage({
      url: BASE_URL,
      html: pageHtml({
        aboutInPage: true,
        sameAs: [],
        about: {
          links: [
            {
              channelExternalLinkViewModel: {
                title: { content: 'MediaStorm.com' },
                link: {
                  content: 'mediastorm.com',
                  commandRuns: [{
                    onTap: {
                      innertubeCommand: {
                        urlEndpoint: {
                          url: 'https://www.youtube.com/redirect?event=channel_description&q=http%3A%2F%2Fmediastorm.com'
                        }
                      }
                    }
                  }]
                }
              }
            },
            {
              channelExternalLinkViewModel: {
                title: { content: 'Twitter' },
                link: { content: 'twitter.com/mediastorm' }
              }
            }
          ]
        }
      })
    });
    const r = await extract(w);
    const bio = String(r['简介'] || '');
    truthy('解 redirect 壳 → 存真地址', bio.indexOf('http://mediastorm.com') > -1, bio);
    eq('绝不把跳转壳存进档案', /youtube\.com\/redirect/.test(bio), false);
    truthy('没有 commandRuns 时用显示文本并补协议',
      bio.indexOf('https://twitter.com/mediastorm') > -1, bio);
  }

  /* ==================== 15. 邮箱：只读 DOM，绝不发接口 ==================== */
  section('15. 邮箱：只读 DOM，不打 reveal 接口');

  {
    // 用户自己点开过「查看电子邮件地址」→ DOM 里能读到
    const html = pageHtml({ aboutInPage: true, about: {} }).replace('</body>',
      `<ytd-about-channel-renderer><div id="additional-info-container"><table><tbody>
         <tr class="description-item"><td><yt-icon icon="mail"></yt-icon></td><td>press@mediastorm.com</td></tr>
       </tbody></table></div></ytd-about-channel-renderer></body>`);
    const w = makePage({ url: BASE_URL, html });
    const r = await extract(w);
    truthy('DOM 展开过 → 简介带邮箱', String(r['简介'] || '').indexOf('邮箱：press@mediastorm.com') > -1, r['简介']);
  }

  {
    // 没展开 → 不写这一行，也绝不发请求去讨
    const w = makePage({ url: BASE_URL, html: pageHtml({ aboutInPage: true, about: {} }) });
    const r = await extract(w);
    eq('没有邮箱行 → 不写「邮箱：」', /邮箱/.test(String(r['简介'] || '')), false);
    eq('没有邮箱 → 一个请求都不发', w.__fetchCalls.length, 0);
  }

  /* ==================== 16. ytInitialData 必须选对脚本（v2.7.24 修正死路径） ==================== */
  section('16. ytInitialData 选对脚本');

  {
    // 真机实测页面有 3 个含 ytInitialData 字样的脚本：
    //   ① 3.2KB 播放器开关（不含 pageHeaderRenderer）
    //   ② 1.67MB 真数据（含 pageHeaderRenderer）
    //   ③ 1.2KB 契约脚本
    // 让「数据块」与「DOM」的统计**明显不同**，才分辨得出到底取了哪一份。
    const realData = JSON.stringify({
      header: {
        pageHeaderRenderer: {
          content: {
            pageHeaderViewModel: {
              metadata: {
                contentMetadataViewModel: {
                  metadataRows: [{
                    metadataParts: [
                      { text: { content: '@' + HANDLE } },
                      { text: { content: '9999位订阅者' } },
                      { text: { content: '777 个视频' } }
                    ]
                  }]
                }
              }
            }
          }
        }
      }
    });

    const html = pageHtml({ domSubs: '2410位订阅者', domVids: '235 个视频' })
      .replace(/<script>var ytInitialData = [\s\S]*?<\/script>/, '')  // 去掉默认那份
      .replace('</body>', `
        <script>if ("YOUTUBE_PREMIUM_LOGO" === window.ytInitialData?.topbar) { /* 开关 */ }</script>
        <script>var ytInitialData = ${realData};</script>
        <script>(function serverContract() { window['ytPageType'] = "channel"; });</script>
      </body>`);

    const w = makePage({ url: BASE_URL, html });
    const r = await extract(w);
    const first = String(r['简介'] || '').split('\n')[0];
    eq('取到的是**真数据块**（9999/777），不是 DOM 也不是开关脚本',
      first, '订阅者：9999 · 视频：777');
  }

  /* ==================== 17. 源码纪律（about / 邮箱 / 接口） ==================== */
  section('17. 源码纪律');

  {
    const src = stripComments(fs.readFileSync(P('src/content/extractors/youtube-profile.js'), 'utf8'));
    eq('绝不主动打 reveal_business_email 接口（用户 2026-10-31 拍板）',
      /reveal_business_email/.test(src), false);
    eq('绝不打 /youtubei/ 数据接口', /youtubei\/v1/.test(src), false);
    truthy('about 数据靠 fetch 页面 HTML 取得', /_aboutFromFetch/.test(src));
    truthy('有超时保护（AbortController）', /AbortController/.test(src));
    truthy('有 channelId 一致性校验', /_aboutMatchesLocation/.test(src));
    truthy('只认 "aboutChannelViewModel":{ 这个精确形态',
      /'"aboutChannelViewModel":\{'/.test(src));
  }

  /* ==================== 18. 作品页作者主页：按 ID 形态分流（v2.7.24 修正 404） ==================== */
  section('18. 作品页「作者主页」不许拼出 404 地址');

  {
    const dom = new JSDOM('<!doctype html><html><body></body></html>',
      { url: 'https://www.youtube.com/watch?v=abc', runScripts: 'outside-only' });
    const w = dom.window;
    w.eval(fs.readFileSync(P('src/content/extractors/base-extractor.js'), 'utf8'));
    w.eval(fs.readFileSync(P('src/content/extractors/youtube-social.js'), 'utf8'));

    const ex = new w.YouTubeSocialExtractor();
    ex._isShortsPage = () => false;

    // 真机实测：新版视频页给的是 handle（`@taishengding`），不是 UC
    ex.extractAuthorID = () => 'taishengding';
    eq('兜底：handle → /@handle（不是 /channel/handle）',
      ex.extractAuthorHomepage(), 'https://www.youtube.com/@taishengding');

    ex.extractAuthorID = () => 'UCjpjFop02meNbAgzlOZ1atA';
    eq('兜底：UC → /channel/UC…（保持原行为）',
      ex.extractAuthorHomepage(), 'https://www.youtube.com/channel/UCjpjFop02meNbAgzlOZ1atA');

    // 源码层面：兜底必须按形态判断，不能按「是不是 Shorts 页」分流
    const socialSrc = stripComments(fs.readFileSync(P('src/content/extractors/youtube-social.js'), 'utf8'));
    truthy('兜底按 ID 形态判断（/^UC/）', /\^UC\[A-Za-z0-9_-\]\{10,40\}\$/.test(socialSrc));
    truthy('第 2 步也认 /@ 链接（新版页面给的就是它）',
      /ytd-channel-name a\[href\*="\/@"\]/.test(socialSrc));
  }

  /* ==================== 收尾 ==================== */
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过：' + pass + ' 项');
})().catch((e) => {
  console.error('跑测试本身出错：', e);
  process.exit(1);
});
