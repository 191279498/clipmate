/**
 * Instagram Reels 发布日期验收（v2.7.5）
 *
 * 修的是什么（真机 2026-10-30，用户已登录 Edge，连切 3 条 Reels 沉浸流）
 * -----------------------------------------------------------------------
 *   /reels/<code>/ 页面上，Instagram 根本没把日期写进可见内容：
 *     · <time> 元素 0 个
 *     · 没有「3天前 / 2026年10月5日」这类时间文本（span/div 全扫，0 命中）
 *     · og:* / twitter:* meta 全空（SPA 只换 DOM，不换 <head>）
 *   → 原有三个来源全落空，发布日期恒空，标题还跟着缺日期尾巴。
 *
 * 但页面渲染用的 <script> 数据块里有 `{code, taken_at}`。
 * ⚠️ v2.7.7 更正：真机复测发现这份数据块**只预取首屏 1~2 条，切条不更新**
 * （本文件头原来写「切条时会跟着更新」，实测反证）。所以这里验的是「单条页面 / 首屏条目」
 * 这条兜底路径；沉浸流翻页后的精确时间由 `instagram-net-hook.js` 负责，
 * 见 `tests/instagram-net-hook.test.js`。
 *
 * 同时验第二个改动：`_isExtractedDataValid` 删掉了「发布日期必须非空」这条门槛。
 * 它才是「站内跳转浮窗不更新」的真凶 —— Reels 上日期恒空 → 4 次重试全被判无效 →
 * 浮窗永远停在旧内容上。日期只是七个字段之一，缺它不该让整份结果作废。
 *
 * 每条断言都配了对照组（拿掉数据块 / 拿掉门槛），否则 fixture 抄错会假绿。
 */
'use strict';

const path = require('path');
const harness = require('./lib/harness');

const ROOT = path.join(__dirname, '..');
const IG = 'https://www.instagram.com';

/** 真机抄下来的数据块形态（外层是 ScheduledServerJS 的包裹，关键是里面的 code + taken_at） */
function dataScript(code, ts) {
  // 用 JSON.stringify 生成，别手写括号 —— 手写少一个 `}` 时 JSON.parse 会失败，
  // 数据块就只能走正则兜底，测的就不是「精确解析」那条主路了（v2.7.6 踩过）。
  const payload = {
    require: [['ScheduledServerJS', 'handle', null, [{
      __bbox: {
        complete: true,
        result: {
          data: {
            xdt_api__v1__clips__home__connection_v2: {
              edges: [{ node: { media: { code, taken_at: ts, user: { username: 'someone', full_name: 'Someone' } } } }]
            }
          }
        }
      }
    }]]]
  };
  return `<script type="application/json">${JSON.stringify(payload)}</script>`;
}

/** Reels 沉浸流页面：只有作者名 + 文案，没有任何日期元素（真机就是这个样） */
function reelsHtml(opts) {
  const o = opts || {};
  return `<!DOCTYPE html><html><head></head><body>
    <div><span>作者名</span><span>这是一条 Reels 的正文内容，页面上没有日期</span></div>
    ${o.scripts === undefined ? dataScript('DfEmtZgTeu_', 1793263488) : o.scripts}
    </body></html>`;
}

/** 本地时区换算成 YYYY/MM/DD（和 extractor 的 formatDateToSlash 同一种算法） */
function slashOf(tsSec) {
  const d = new Date(tsSec * 1000);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`  ${C.green}✓${C.reset} ${name}`);
  } else {
    fail++;
    const detail = `${name} → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`;
    failures.push(detail);
    console.log(`  ${C.red}✗${C.reset} ${detail}`);
  }
}
function ok(name, cond) {
  if (arguments.length < 2) {
    fail++;
    const d = `${name} → 断言写法错误：ok() 必须传第二个参数`;
    failures.push(d);
    console.log(`  ${C.red}✗${C.reset} ${d}`);
    return;
  }
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; failures.push(name); console.log(`  ${C.red}✗${C.reset} ${name}`); }
}
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

(async () => {
  console.log(`${C.cyan}Instagram Reels 发布日期验收（v2.7.5）${C.reset}`);

  /* ================= 一、数据块取时间戳（instagram-inline-data.js）================= */
  section('一、从网页自带数据块取发布时间');
  const page = await harness.openPage({
    url: IG + '/reels/DfEmtZgTeu_/',
    html: reelsHtml()
  });
  const win = page.window;
  const ILD = win.InstagramInlineData;
  ok('InstagramInlineData 已随 content script 加载', !!ILD, Object.keys(win).filter((k) => k.indexOf('Instagram') === 0));

  eq('[命中] 传作品编号 → 拿到 taken_at', ILD.findTakenAt('DfEmtZgTeu_'), 1793263488);
  eq('[命中] 传地址形式也认', ILD.findTakenAt('/reels/DfEmtZgTeu_/'), 1793263488);
  eq('[未命中] 数据块里没有这个编号 → null', ILD.findTakenAt('ZZZZZZZZZZZ'), null);
  eq('[空参数] 传空值 → null', ILD.findTakenAt(''), null);
  eq('[地址解析] shortcodeFromLocation 认 /reels/<code>/', ILD.shortcodeFromLocation(), 'DfEmtZgTeu_');
  eq('[编号归一] normalizeCode 抽地址里的编号', ILD.normalizeCode('/reels/Abc12345/'), 'Abc12345');

  /* ================= 二、站点门禁（这份文件全站都会加载）================= */
  section('二、站点门禁：别的站绝不去扫人家的 script');
  {
    const other = await harness.openPage({
      url: 'https://www.douyin.com/video/7411/',
      html: reelsHtml()
    });
    const D2 = other.window.InstagramInlineData;
    ok('抖音站上 InstagramInlineData 同样存在（全站注入）', !!D2);
    eq('[门禁] 抖音站 findTakenAt → null', D2.findTakenAt('DfEmtZgTeu_'), null);
    eq('[门禁] 抖音站 shortcodeFromLocation 不做 IG 解析',
      D2.shortcodeFromLocation(), null);
  }

  /* ================= 三、相邻条目不串号（按字符距离取最近的那个）================= */
  section('三、同一段数据里有两条 → 各拿各的，不串号');
  {
    // 真机形态：一个 edges 数组里连着好几条，每条都是 code + taken_at。
    // 若只取「第一个含该 code 的时间戳」，第二条会拿到第一条的时间。
    const two = `<script type="application/json">{"edges":[` +
      `{"node":{"code":"AAAAAAAAAAA","taken_at":1700000000}},` +
      `{"node":{"code":"BBBBBBBBBBB","taken_at":1800000000}}]}</script>`;
    const p2 = await harness.openPage({ url: IG + '/reels/BBBBBBBBBBB/', html: reelsHtml({ scripts: two }) });
    const D3 = p2.window.InstagramInlineData;
    eq('[串号] 第一条拿自己的时间戳', D3.findTakenAt('AAAAAAAAAAA'), 1700000000);
    eq('[串号] 第二条拿自己的时间戳（不是第一条的）', D3.findTakenAt('BBBBBBBBBBB'), 1800000000);
  }

  /* ================= 四、切条后数据块会变 → 缓存必须失效重扫 ================= */
  section('四、切条：新数据块加进来后要能查到（缓存失效）');
  {
    const p3 = await harness.openPage({ url: IG + '/reels/OLDCODE1234/', html: reelsHtml() });
    const D4 = p3.window.InstagramInlineData;
    eq('[缓存] 先查一个不存在编号（会扫一遍并缓存）', D4.findTakenAt('NOTEXIST123'), null);
    // 模拟切条：IG 会往页面里追加新的数据块
    const s = p3.window.document.createElement('script');
    s.setAttribute('type', 'application/json');
    s.textContent = '{"node":{"code":"NEWCODE1234","taken_at":1799999999}}';
    p3.window.document.body.appendChild(s);
    eq('[缓存] 追加新数据块后能查到新编号（说明重扫了）', D4.findTakenAt('NEWCODE1234'), 1799999999);
  }

  /* ================= 五、集成：Reels 页面发布日期不再为空 ================= */
  section('五、Reels 页面：发布日期不再为空（本次修的 Bug）');
  {
    const expected = slashOf(1793263488);
    const p4 = await harness.openPage({ url: IG + '/reels/DfEmtZgTeu_/', html: reelsHtml() });
    const w4 = p4.window;
    const inst = new w4.InstagramSocialExtractor();
    eq('[集成] extractPublishDate = 数据块里的日期', inst.extractPublishDate(w4.document), expected);

    // 对照组：把数据块拿掉，就是 v2.7.5 之前的表现 —— 必须为空，
    // 否则说明这条断言根本没在测新来源（拿掉也一样过 = 假绿）
    const p5 = await harness.openPage({ url: IG + '/reels/DfEmtZgTeu_/', html: reelsHtml({ scripts: '' }) });
    const inst5 = new p5.window.InstagramSocialExtractor();
    eq('[对照] 没有数据块时日期为空（v2.7.5 前的老表现，证明上面那条真的测了新来源）',
      inst5.extractPublishDate(p5.window.document), '');
  }

  /* ================= 六、门槛：缺日期不再让整份结果作废 ================= */
  section('六、浮窗就地刷新：缺日期也要照常刷新（v2.7.5 拆掉的门槛）');
  {
    const p6 = await harness.openPage({ url: IG + '/reels/DfEmtZgTeu_/', html: reelsHtml() });
    const M = p6.bridge.MediaExtractor;
    ok('MediaExtractor 类加载成功', typeof M === 'function');
    const ctx = new M();
    ok('_isExtractedDataValid 存在', typeof ctx._isExtractedDataValid === 'function');

    eq('[门槛] 只有文案、没有日期 → 判有效（以前会判无效，浮窗就卡住不更新）',
      ctx._isExtractedDataValid({ '本页文案': '这是一条 Reels 正文', '发布日期': '' }), true);
    eq('[门槛] 文案 + 日期都有 → 有效', ctx._isExtractedDataValid({ '本页文案': '正文', '发布日期': '2026/10/29' }), true);
    eq('[门槛] 文案为空 → 无效', ctx._isExtractedDataValid({ '本页文案': '', '发布日期': '2026/10/29' }), false);
    eq('[门槛] 文案是主页页脚统计文字 → 无效（这条门槛必须留着）',
      ctx._isExtractedDataValid({ '本页文案': '6,037 位粉丝、已关注 930 人、 395 篇帖子', '发布日期': '2026/10/29' }), false);
    eq('[门槛] 传空对象 → 无效', ctx._isExtractedDataValid(null), false);
  }

  /* ============ 七、切条后作者/昵称/URL 也要跟着换（v2.7.6）============ */
  section('七、沉浸流切条：meta 是首屏那条的，作者/昵称/URL 必须按地址走');
  {
    // 真机形态（2026-10-30 实测）：地址已到第二条，但 head 里的 meta 还停在上一条。
    // 数据块里两条都有，靠「地址里的编号」精确匹配才能拿到当前这条。
    const stale = `<!DOCTYPE html><html><head>
      <meta property="twitter:title" content="yaoyanhuozongfx (@yaoyanhuozongfx) • Instagram Reels">
      <meta property="og:title" content="Instagram 用户 yaoyanhuozongfx : &quot;old&quot;">
      <meta property="og:url" content="https://www.instagram.com/yaoyanhuozongfx/reel/DeVSPNwvLK7/">
      </head><body>
      <div><span>kariina.choi</span><span>这是第二条的正文</span></div>
      <script type="application/json">{"edges":[
        {"node":{"media":{"code":"DeVSPNwvLK7","taken_at":1793000000,"user":{"username":"yaoyanhuozongfx","full_name":"old name"}}}},
        {"node":{"media":{"code":"Dd2jVDvOhoc","taken_at":1793500000,"user":{"username":"kariina.choi","full_name":"Kariina Choi"}}}}
      ]}</script></body></html>`;

    const p7 = await harness.openPage({ url: IG + '/reels/Dd2jVDvOhoc/', html: stale });
    const w7 = p7.window;
    const inst7 = new w7.InstagramSocialExtractor();

    eq('[切条] 作者ID = 地址这一条的（不是 meta 里首屏那条）',
      inst7.extractAuthorName(w7.document), 'kariina.choi');
    eq('[切条] 作者昵称 = 这一条的 full_name', inst7.extractAuthorNickname(w7.document), 'Kariina Choi');
    eq('[切条] 作者主页跟着作者ID 走', inst7.extractAuthorHomepage(w7.document), IG + '/kariina.choi/');
    eq('[切条] URL = 这一条的 <作者>/reel/<编号>/',
      inst7.extractReelsUrl('kariina.choi'), IG + '/kariina.choi/reel/Dd2jVDvOhoc/');
    eq('[切条] 发布日期 = 这一条的 taken_at', inst7.extractPublishDate(w7.document), slashOf(1793500000));

    // findMedia 单元断言
    const ILD7 = w7.InstagramInlineData;
    const m = ILD7.findMedia('Dd2jVDvOhoc');
    ok('[findMedia] 返回对象', !!m);
    eq('[findMedia] username', m && m.username, 'kariina.choi');
    eq('[findMedia] fullName', m && m.fullName, 'Kariina Choi');
    eq('[findMedia] takenAt', m && m.takenAt, 1793500000);
    eq('[findMedia] 另一条也拿自己的作者', (ILD7.findMedia('DeVSPNwvLK7') || {}).username, 'yaoyanhuozongfx');
    eq('[findMedia] 不存在的编号 → null', ILD7.findMedia('ZZZZZZZZZZZ'), null);

    // 对照组：把数据块拿掉 → 三个字段必然退回 meta 里那条首屏数据（证明上面的断言真在测新来源）
    const staleNoData = stale.replace(/<script[\s\S]*?<\/script>/, '');
    const p8 = await harness.openPage({ url: IG + '/reels/Dd2jVDvOhoc/', html: staleNoData });
    const inst8 = new p8.window.InstagramSocialExtractor();
    eq('[对照] 没有数据块时作者ID 退回 meta 的首屏作者（这就是 v2.7.5 的 Bug）',
      inst8.extractAuthorName(p8.window.document), 'yaoyanhuozongfx');
  }

  console.log(`\n结果：${pass}/${pass + fail} 通过 — Instagram Reels 发布日期（v2.7.6）`);
  // 必须显式退出：jsdom 页面里的定时器会让 node 进程一直挂着不结束
  if (failures.length) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
