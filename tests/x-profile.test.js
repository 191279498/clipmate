/**
 * X 个人主页提取器（v2.7.27）—— 契约测试
 *
 * 钉住这几件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介）
 *   B. 账号ID = handle（地址栏）；数字ID（756319701861601281）进简介
 *   C. 统计行 = `帖子：1万 · 关注者：7.2万`（**页面原样**，不用 JSON-LD 的
 *      10549 / 72072 —— 数字照页面原样是全站铁律）
 *   D. 简介正文 = DOM UserDescription（带换行排版）；加入日期 = JSON-LD 精确到日
 *   E. 网址 = `https://x.com/<handle>`（官方形态，/about 子页也归到它）
 *   F. **防串台**：JSON-LD 与地址栏 handle 不一致 → 整份弃用
 *   G. **零接口**：全部数据来自当前文档（JSON-LD + DOM），绝不 fetch
 *
 * 取样来源：2026-10-31 真机（接管用户已登录 Edge，x.com/AI_Jasonyu 鱼总聊AI）
 *   JSON-LD：name 鱼总聊AI / additionalName AI_Jasonyu / identifier 756319701861601281 /
 *     dateCreated 2016-07-22T02:47:23.000Z / Follows 72072 / Friends 1687 / Tweets 10549 /
 *     relatedLink [t.co壳, yuzong.ai/bio]
 *   DOM：7.2万 关注者 / 1,687 正在关注 / 1万 帖子 / 位置「商务合作联系」/
 *     加入「2016年7月 加入」
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

function stripComments(src) {
  return String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/* ============================ 真机样本 ============================ */

const HANDLE = 'AI_Jasonyu';
const OTHER = 'elonmusk';

const LD = (o) => {
  const opt = o || {};
  const ent = {
    '@type': 'Person',
    additionalName: opt.ldHandle === undefined ? HANDLE : opt.ldHandle,
    name: '鱼总聊AI',
    description: '👋 AI & 出海& Saas & APP & 海外手机卡eSIM实操干货分享 📈 8年产品经验 | 单款产品营收 $200k+ （全自然流量 ）💻 代表作：@PaywallPro1 付费墙Agent：https://t.co/YJBXCacO1t 🍼 2胎爸爸 | 私信聊合作/咨询：jasonyu110',
    identifier: opt.identifier === undefined ? '756319701861601281' : opt.identifier,
    homeLocation: { '@type': 'Place', name: '商务合作联系👉' },
    interactionStatistic: [
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/FollowAction', name: 'Follows', userInteractionCount: 72072 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/SubscribeAction', name: 'Friends', userInteractionCount: 1687 },
      { '@type': 'InteractionCounter', interactionType: 'https://schema.org/WriteAction', name: 'Tweets', userInteractionCount: 10549 }
    ],
    url: opt.ldUrl === undefined ? 'https://x.com/' + HANDLE : opt.ldUrl
  };
  if (opt.identifier === null) delete ent.identifier;
  if (opt.noDate) { /* dateCreated 由外面拼 */ }
  const obj = {
    '@context': 'http://schema.org',
    '@type': 'ProfilePage',
    mainEntity: ent
  };
  if (!opt.noDate) obj.dateCreated = opt.dateCreated === undefined ? '2016-07-22T02:47:23.000Z' : opt.dateCreated;
  if (!opt.noLinks) obj.relatedLink = ['https://t.co/f423moSGNv', 'https://yuzong.ai/bio'];
  return JSON.stringify(obj);
};

/** 页面 HTML（照真机 DOM 形态构造） */
function pageHtml(o) {
  const opt = o || {};
  const posts = opt.posts === undefined ? '1万' : opt.posts;
  const followers = opt.followers === undefined ? '7.2万' : opt.followers;
  const following = opt.following === undefined ? '1,687' : opt.following;
  const handle = opt.handle === undefined ? HANDLE : opt.handle;

  const statLinks = `
  <div><a href="/${handle}/following"><span>${following} 正在关注</span></a>
  <a href="/${handle}/verified_followers"><span>${followers} 关注者</span></a></div>`;
  return `<!doctype html><html><head><title>鱼总聊AI (@${handle}) / X</title>
  <script type="application/ld+json">${opt.ldHtml === undefined ? LD(opt.ldOpt) : opt.ldHtml}</script>
  </head><body>
  <div data-testid="UserName"><span>鱼总聊AI</span><span>@${handle}</span></div>
  ${posts == null ? '' : `<span>${posts} 帖子</span>`}
  <div data-testid="UserDescription">AI &amp; 出海&amp; Saas &amp; APP &amp; 海外手机卡eSIM实操干货分享
代表作：@PaywallPro1
付费墙Agent：http://paywallpro.app
2胎爸爸 | 私信聊合作/咨询：jasonyu110</div>
  <div data-testid="UserProfileHeader_Items">
    <span data-testid="UserProfessionalCategory">社交媒体影响者</span>
    <span data-testid="UserLocation">${opt.location === undefined ? '商务合作联系' : opt.location}</span>
    ${opt.userUrl === null ? '' : `<a href="https://t.co/f423moSGNv"><span data-testid="UserUrl">${opt.userUrl === undefined ? 'yuzong.ai/bio' : opt.userUrl}</span></a>`}
    <a href="/${handle}/about"><span data-testid="UserJoinDate">2016年7月 加入</span></a>
    <span data-testid="UserJoinDate">2016年7月 加入</span>
  </div>
  ${opt.noStatLinks ? '' : statLinks}
  </body></html>`;
}

/** 造一个带页面的环境（fetch 桩一律 reject：本提取器绝不许发请求） */
function makePage(o) {
  const opt = o || {};
  const dom = new JSDOM(opt.html || pageHtml(opt), {
    url: opt.url || 'https://x.com/' + HANDLE,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.__fetchCalls = [];
  w.fetch = (u) => { w.__fetchCalls.push(String(u)); return Promise.reject(new Error('no-fetch-allowed')); };

  w.eval(fs.readFileSync(P('src/content/shared/url-normalizer.js'), 'utf8'));
  w.eval(fs.readFileSync(P('src/content/extractors/base-extractor.js'), 'utf8'));
  w.eval(fs.readFileSync(P('src/content/extractors/x-profile.js'), 'utf8'));
  // 装配入口用的（v2.7.29 补测）
  w.eval(fs.readFileSync(P('src/content/shared/person-fields-builder.js'), 'utf8'));
  return w;
}

/** 跑一遍 6 个字段 */
async function extract(w) {
  const ex = new w.XProfileExtractor();
  return {
    '平台': await ex.extractPlatform(),
    '昵称': await ex.extractName(),
    '账号ID': await ex.extractAccountId(),
    '账号名': await ex.extractAccountName(),
    '网址': await ex.extractUrl(),
    '简介': await ex.extractBio()
  };
}

/* ============================ 断言 ============================ */

(async () => {

  /* ==================== 1. 六列与字段口径 ==================== */
  section('1. 六列与字段口径（鱼总聊AI）');
  {
    const r = await extract(makePage());
    eq('平台', r['平台'], 'X');
    eq('昵称', r['昵称'], '鱼总聊AI');
    eq('账号ID = handle', r['账号ID'], HANDLE);
    eq('账号名 = handle', r['账号名'], HANDLE);
    eq('网址 = 官方形态', r['网址'], 'https://x.com/' + HANDLE);

    const lines = String(r['简介'] || '').split('\n');
    eq('简介行数（统计/正文4行/位置/数字ID/加入日期/外链）', lines.length, 9);
    eq('统计行（页面原样，不用 10549/72072）', lines[0], '帖子：1万 · 关注者：7.2万');
    eq('正文第 1 行（DOM 版排版）', lines[1], 'AI & 出海& Saas & APP & 海外手机卡eSIM实操干货分享');
    eq('正文含第 2 行', lines[2], '代表作：@PaywallPro1');
    eq('位置（DOM 的，不带 emoji）', lines[5], '位置：商务合作联系');
    eq('数字ID 进简介', lines[6], '数字ID：756319701861601281');
    eq('加入日期精确到日', lines[7], '加入日期：2016年7月22日');
    eq('外链一行（显示文本）', lines[8], 'yuzong.ai/bio');
  }

  /* ==================== 2. about 子页入口 ==================== */
  section('2. /about 子页入口');
  {
    const r = await extract(makePage({ url: 'https://x.com/' + HANDLE + '/about' }));
    eq('about 子页账号ID 不受影响', r['账号ID'], HANDLE);
    eq('网址归一成官方形态', r['网址'], 'https://x.com/' + HANDLE);
  }

  /* ==================== 3. 防串台 ==================== */
  section('3. 防串台：JSON-LD 是别人的就整份弃用');
  {
    // JSON-LD 里是别人 → 不能用：数字ID/精确加入日期不得出现
    const r = await extract(makePage({ ldOpt: { ldHandle: OTHER, ldUrl: 'https://x.com/' + OTHER } }));
    truthy('数字ID 不出现', String(r['简介'] || '').indexOf('756319701861601281') === -1, r['简介']);
    truthy('加入日期不出现（JSON-LD 弃用后无精确源）', String(r['简介'] || '').indexOf('加入日期：2016年7月22日') === -1);
    truthy('网址仍是地址栏的 handle', r['网址'] === 'https://x.com/' + HANDLE, r['网址']);
  }
  {
    // handle 大小写不一致（X 大小写不敏感）→ 必须能用
    const r = await extract(makePage({ url: 'https://x.com/ai_jasonyu' }));
    eq('大小写不敏感防串台（地址栏小写）', r['账号ID'], 'ai_jasonyu');
    truthy('JSON-LD（大写）仍可用 → 数字ID 在', String(r['简介'] || '').indexOf('数字ID：756319701861601281') > -1);
    eq('网址重拼用地址栏原样', r['网址'], 'https://x.com/ai_jasonyu');
  }

  /* ==================== 4. 兜底链 ==================== */
  section('4. 兜底链：DOM 锚点挂了用 JSON-LD 精确值');
  {
    const r = await extract(makePage({ posts: null, followers: '看不了', ldOpt: {} }));
    const first = String(r['简介'] || '').split('\n')[0];
    eq('DOM 取不到数字 → 两个都 JSON-LD 兜底', first, '帖子：10549 · 关注者：72072');
  }
  {
    const r = await extract(makePage({ followers: null }));
    const first = String(r['简介'] || '').split('\n')[0];
    eq('关注者 DOM 没有 → JSON-LD 兜底', first, '帖子：1万 · 关注者：72072');
  }
  {
    // JSON-LD 没有 dateCreated → DOM「2016年7月 加入」兜底（照页面原样，不补日期）
    const r = await extract(makePage({ ldOpt: { noDate: true } }));
    const lines = String(r['简介'] || '').split('\n');
    eq('加入日期退 DOM 的年月（不补 00:00）', lines[7], '加入日期：2016年7月');
  }
  {
    // UserUrl 没有 → relatedLink 里非 t.co 的那条兜底
    const r = await extract(makePage({ userUrl: null }));
    const lines = String(r['简介'] || '').split('\n');
    eq('外链退 relatedLink（跳过 t.co 壳，完整 URL）', lines[8], 'https://yuzong.ai/bio');
  }
  {
    // JSON-LD 整个没有 → 简介仍有统计行与正文，只是没有数字ID/精确日期
    const r = await extract(makePage({ ldHtml: '' }));
    const lines = String(r['简介'] || '').split('\n');
    eq('无 JSON-LD 时统计行仍 DOM 原样', lines[0], '帖子：1万 · 关注者：7.2万');
    truthy('数字ID 不瞎编', lines.every((l) => l.indexOf('数字ID') === -1));
  }

  /* ==================== 5. 零接口纪律 ==================== */
  section('5. 零接口纪律');
  {
    const w = makePage();
    await extract(w);
    eq('全程不发任何请求', w.__fetchCalls.length, 0);
  }

  /* ==================== 6. 源码纪律 ==================== */
  section('6. 源码纪律');
  {
    const src = stripComments(fs.readFileSync(P('src/content/extractors/x-profile.js'), 'utf8'));
    truthy('不碰 __INITIAL_STATE__（隔离世界读不到页面主世界全局，快手 Apollo 同坑）',
      src.indexOf('__INITIAL_STATE__') === -1);
    truthy('不出现 fetch（零接口）', src.indexOf('fetch(') === -1);
    truthy('数字ID 行格式钉死', /数字ID：/.test(src));
    truthy('防串台校验存在（比对 handle）', /toLowerCase\(\)/.test(src));
  }

  /* ==================== 7. 路由：person 必须排在通配 social 之前 ==================== */
  section('7. 路由');
  {
    // 静态断言（media-detector 的 loadConfigs 依赖扩展环境，eval 不了）：
    // 两份配置（media-detector / background）逐字一致 + person 在 social 之前
    const det = fs.readFileSync(P('src/content/utils/media-detector.js'), 'utf8');
    const bg = fs.readFileSync(P('src/background/background.js'), 'utf8');
    const fac = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');

    const grab = (s) => {
      const i = s.indexOf("'x.com': {");
      const j = s.indexOf("'www.x.com': {", i);
      return i > -1 && j > i ? s.slice(i, j) : '';
    };
    const detSeg = grab(det);
    const bgSeg = grab(bg);
    truthy('两份配置都找得到 X 块', detSeg.length > 100 && bgSeg.length > 100,
      { det: detSeg.length, bg: bgSeg.length });
    truthy('两份配置的 person 正则逐字一致',
      detSeg.indexOf("'^/(?!home") > -1 && bgSeg.indexOf("'^/(?!home") > -1 &&
      detSeg.indexOf("'^/(?!home") === detSeg.lastIndexOf("'^/(?!home") &&
      detSeg === bgSeg, 'X 配置块必须逐字一致');
    const detU = detSeg.indexOf("type: 'person'");
    const detS = detSeg.indexOf("type: 'social', patterns: ['/']");
    truthy('media-detector：person 在 social 之前', detU > -1 && detS > -1 && detU < detS,
      { detU, detS });
    truthy('media-detector：有 about 子页规则', detSeg.indexOf("/about/?$'") > -1);

    const facP = fac.indexOf("hostname: 'x.com', mediaType: 'person'");
    const facS = fac.indexOf("{ pattern: /x\\.com\\//, hostname: 'x.com', mediaType: 'social' }");
    truthy('工厂：person 规则在 social 之前', facP > -1 && facS > -1 && facP < facS,
      { facP, facS });
    truthy('工厂注册了 XProfileExtractor', /className: 'XProfileExtractor'/.test(fac));
    truthy('工厂注册了 person 类型', /XProfileExtractor[\s\S]{0,200}types: \['person'\]/.test(fac));

    const persist = fs.readFileSync(P('src/content/ui/modal-persistence.js'), 'utf8');
    const pP = persist.indexOf('X 个人主页');
    // social 的注释在插入点之前，所以比 return：person 块的 `return 'person'`
    // 必须出现在它后面第一个 X social `return 'social'` 之前
    const pPersonRet = persist.indexOf("return 'person';", pP);
    const pSocialRet = persist.indexOf("return 'social';", pP);
    truthy('弹窗持久化：X person 兜底排在 social 之前',
      pP > -1 && pPersonRet > -1 && pSocialRet > -1 && pPersonRet < pSocialRet,
      { pP, pPersonRet, pSocialRet });

    const mf = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
    const files = mf.content_scripts.reduce((a, c) => a.concat(c.js || []), []);
    truthy('manifest 注册了 x-profile.js',
      files.indexOf('src/content/extractors/x-profile.js') > -1);
    eq('x-profile.js 只注册一次',
      files.filter((f) => f === 'src/content/extractors/x-profile.js').length, 1);
    truthy('manifest 版本已升到 2.12.0', mf.version === '2.12.7', mf.version);
  }

  /* ==================== 8. URL 归一化 ==================== */
  section('8. URL 归一化');
  {
    const w = makePage();
    const N = w.UrlNormalizer;
    eq('主页 → 官方形态', N.normalize('https://x.com/AI_Jasonyu'), 'https://x.com/AI_Jasonyu');
    eq('about 子页 → 主页', N.normalize('https://x.com/AI_Jasonyu/about'), 'https://x.com/AI_Jasonyu');
    eq('功能页 /home 不动', N.normalize('https://x.com/home'), 'https://x.com/home');
    eq('单条推文不动', N.normalize('https://x.com/AI_Jasonyu/status/1719999999999999999'), 'https://x.com/AI_Jasonyu/status/1719999999999999999');
    eq('旧域名 twitter.com 也认', N.normalize('https://twitter.com/AI_Jasonyu/about'), 'https://x.com/AI_Jasonyu');
    eq('带参数的主页归一', N.normalize('https://x.com/AI_Jasonyu?mx=2'), 'https://x.com/AI_Jasonyu');
  }

  /* ==================== Y. 链接被块级 span 拆断行（v2.7.30 真机踩到） ==================== */
  section('Y. 链接不许被 span 拆成两行（模拟真机 innerText）');
  {
    const html = `<!doctype html><html><head><title>t</title>
    <script type="application/ld+json">${LD({})}</script></head><body>
    <div data-testid="UserName"><span>鱼总聊AI</span><span>@${HANDLE}</span></div>
    <span>1万 帖子</span>
    <div data-testid="UserDescription">代表作：<a href="https://t.co/YJBXCacO1t"><span aria-hidden="true">http://</span>paywallpro.app</a> 结束</div>
    <div><a href="/${HANDLE}/verified_followers"><span>7.2万 关注者</span></a></div>
    </body></html>`;
    const w = makePage({ html });

    // jsdom 没有 innerText —— 按真机实测形态装一个：
    // X 把协议头塞进 display:block 的 aria-hidden span，innerText 因此多出两个换行
    const d = w.document.querySelector('[data-testid="UserDescription"]');
    Object.defineProperty(d, 'innerText', {
      configurable: true,
      get() { return '代表作：\nhttp://\npaywallpro.app 结束'; }
    });
    Object.defineProperty(d.querySelector('a'), 'innerText', {
      configurable: true,
      get() { return 'http://\npaywallpro.app'; }
    });

    const bio = await new w.XProfileExtractor().extractBio();
    truthy('链接拼回单行 http://paywallpro.app', String(bio).indexOf('http://paywallpro.app') > -1, bio);
    truthy('不再出现 http:// 单独占一行', String(bio).indexOf('http://\n') === -1, bio);
  }

  /* ==================== Z. 装配入口（v2.7.29 补：真机踩过的空浮窗） ==================== */
  section('Z. 装配入口 extractAllFields（缺了就是 6 个空行）');
  {
    const w = makePage({});
    const ex = new w.XProfileExtractor();
    truthy('有 extractAllFields 方法', typeof ex.extractAllFields === 'function',
      '没有入口方法 → 主流程调用会失败，浮窗渲染 6 个空行');
    if (typeof ex.extractAllFields === 'function') {
      const all = await ex.extractAllFields();
      const keys = Object.keys(all || {}).filter((k) => k !== 'mediaType' && k !== 'personKind' && k !== 'sourceSite');
      eq('装配后恰好 6 列（顺序固定）', keys, ['平台', '昵称', '账号ID', '账号名', '网址', '简介']);
      eq('元字段标记为 person / account', [all && all.mediaType, all && all.personKind], ['person', 'account']);
      const direct = await extract(makePage({}));
      const six = {};
      keys.forEach((k) => { six[k] = all[k]; });
      eq('装配值与六个分字段逐一一致', six, direct);
      truthy('装配后没有空列（平台/昵称/账号ID/网址都非空）',
        !!(all && all['平台'] && all['昵称'] && all['账号ID'] && all['网址']), all);
    }
  }

  /* ==================== 结果 ==================== */
  console.log(`\n结果：${pass} 通过，${fail} 失败`);
  if (fail) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('全部通过：' + pass + ' 项');
})().catch((e) => { console.error(e); process.exit(1); });
