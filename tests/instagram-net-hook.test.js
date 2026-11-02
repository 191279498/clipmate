/**
 * Instagram 沉浸流「精确发布时间 + 完整文案」验收（v2.7.7）
 *
 * 背景（真机 2026-10-30，用户已登录 Edge，真实滚动切条 —— 注意：Agent 窗口里
 * `press ArrowDown` 根本切不动条，必须用「把滚动容器往下滚一屏」才等价于用户滑动，
 * 早前两轮「切条后浮窗不更新」的结论都是在页面压根没换条的情况下测出来的）
 * ---------------------------------------------------------------------------
 * 实测到三件事：
 *   ① `/reels/` 上 IG 不渲染任何日期（<time> 0 个、没有「3天前」、og/meta 全无）；
 *   ② 页面自带的 `<script>` 数据块**只预取首屏 1~2 条，切条不更新** ——
 *      v2.7.5 文件头里「切条会跟着更新」是错的；
 *   ③ React 运行时里每条 media 只有 `{code, pk, user{username}}`，没有 taken_at。
 * 但页面自己会向服务器要数据（首屏一批 12 条，滑到批末再来一批），
 * 响应正文里带 `{code, taken_at, user, caption.text}` —— 精确到秒 + 未折叠全文。
 *
 * 所以 v2.7.7 加 `instagram-net-hook.js`（主世界，document_start）：
 * **只听不发**，把听到的按作品编号写进桥节点 `#clipmate-instagram-net`，
 * 隔离世界 `instagram-inline-data.js` 优先读它。
 *
 * 本测试分五节：
 *   一、主世界接收器（解析 / 过滤 / 上限 / 写桥节点）
 *   二、隔离世界读取（桥节点优先 → 数据块兜底 → 坏节点不抛）
 *   三、文案策略（音频行、屏幕外旧条目、完整文案）
 *   四、无布局环境（jsdom 拿不到 rect）也要能取到正文
 *   五、无文案作品必须定案（v2.7.8：否则会把上一条的文案记到这条身上）
 *
 * 反向验证（改坏必须变红，已逐条跑过）：
 *   ① `findMedia` 里删掉 `findInNet` 那段 → 二节第 1/2/5 条红、三节第 1 条红
 *   ② `ingest` 里删掉 `plausibleTs` 判断 → 一节第 5 条红
 *   ③ `_reelsCaptionInView` 里删掉 `closest('a')` 排除 → 三节第 2 条红（拿到音频名）
 *   ④ 删掉「屏幕外跳过」（measurable 过滤）→ 三节第 3 条红（拿到上一条的旧文案）
 *   ⑤ `trim` 上限改成 Infinity → 一节第 8 条红
 */
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('./lib/harness');

const ROOT = path.resolve(__dirname, '..');
const CHROME = path.join(ROOT, 'ClipMate_chrome');
const read = (rel) => fs.readFileSync(path.join(CHROME, rel), 'utf8');
const IG = 'https://www.instagram.com';
const NET_NODE_ID = 'clipmate-instagram-net';

const C = { green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m', reset: '\x1b[0m' };
let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  if (actual === expected) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); return; }
  fail++;
  const d = `${name} → 实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}`;
  failures.push(d);
  console.log(`  ${C.red}✗${C.reset} ${d}`);
}
function ok(name, cond) {
  if (arguments.length < 2) {
    fail++; failures.push(name);
    console.log(`  ${C.red}✗${C.reset} ${name} → 断言写法错误：ok() 必须传第二个参数`);
    return;
  }
  if (cond) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
  else { fail++; failures.push(name); console.log(`  ${C.red}✗${C.reset} ${name}`); }
}
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/* -------------------------------------------------------------------------- */
/* 工具：主世界接收器沙箱（只给 window/document，定时器钉死成空转）              */
/* -------------------------------------------------------------------------- */
function loadNetHook() {
  const src = read('src/content/instagram-net-hook.js');
  const win = {};
  win.window = win;
  const nodes = {};
  const doc = {
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ type: '', id: '', textContent: '' }),
    head: { appendChild(el) { nodes[el.id] = el; } },
    documentElement: null
  };
  const st = global.setTimeout;
  global.setTimeout = function () { return 0; };
  try {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', src)(win, doc);
  } finally {
    global.setTimeout = st;
  }
  return { api: win.ClipMateInstagramNetParser, nodes };
}

/** 造一份仿真的 IG /graphql/query 响应（真机就是这个嵌套：edges[].node.media）
 *  it.noCaption === true    → `caption: null`（接口明确「这条没文案」）
 *  it.noCaptionKey === true → 整个 caption 键都不出现（这份 fragment 没查它）
 */
function igResponse(items) {
  return JSON.stringify({
    data: {
      xdt_api__v1__clips__home__connection_v2: {
        edges: items.map((it) => {
          const media = {
            __typename: 'XDTMediaDict',
            code: it.code,
            pk: '4018709754353422199',
            taken_at: it.ts,
            user: { username: it.user || 'someone', full_name: it.name || 'Some One' }
          };
          if (it.noCaption === true) media.caption = null;
          else if (it.noCaptionKey === true) { /* 不写 caption 键 */ }
          else media.caption = { edges: [{ node: { text: it.caption === undefined ? '文案' : it.caption } }] };
          return { node: { media } };
        })
      }
    }
  });
}

/* -------------------------------------------------------------------------- */
/* 工具：Reels 沉浸流 fixture                                                  */
/* -------------------------------------------------------------------------- */

/** 视口内/外的矩形（jsdom 默认全 0，必须自己钉） */
const RECT_IN = () => ({ top: 700, bottom: 720, left: 0, right: 300, width: 300, height: 20 });
const RECT_ABOVE = () => ({ top: -66, bottom: -46, left: 0, right: 300, width: 300, height: 20 });

/**
 * 沉浸流页面：上一条滑走了（屏幕外），当前这条有「音频行 + 正文行」。
 * 真机实测：音频行与正文行**同用 `span.xuxw1ft`**，只有「音频行包在 /reels/audio/ 链接里」
 * 这一个结构性差别。
 */
function reelsFlowHtml(opts) {
  const o = opts || {};
  const bridge = o.bridge === undefined ? '' : o.bridge;
  const dataScript = o.dataScript === undefined ? '' : o.dataScript;
  // ⚠️ 旧条目的文案故意做得**比当前条目更长**：否则「取最长」那条规则会顺手选中当前条，
  // 就算把「排除屏幕外」整段删掉也不会变红 —— 那就是假绿（v2.7.7 真踩到了）。
  const oldItem = o.withOld === false ? '' : `<div id="old-item">
      <span class="xuxw1ft" id="old-caption">上一条滑走的旧文案内容很长很长很长很长很长很长很长很长很长很长很长很长</span>
    </div>`;
  return `<!DOCTYPE html><html><head>${bridge}${dataScript}</head><body>
    ${oldItem}
    <div id="cur-item">
      <span class="xuxw1ft" id="cur-author">someone</span>
      <a href="/reels/audio/1854209584874650/"><span class="xuxw1ft" id="cur-audio">Carter Burwell · Bella's Lullaby (Twilight Soundtrack Version)</span></a>
      <a href="/explore/locations/106287062743373/"><span class="xuxw1ft" id="cur-loc">巴塞罗那</span></a>
      <span class="xuxw1ft" id="cur-caption">这是一条真正的正文文案，比音频名字长很多… 更多</span>
    </div>
    </body></html>`;
}

/** 把 fixture 里几个 span 的矩形钉成「旧条在屏幕外、当前条在屏幕内」 */
function stubRects(win) {
  const doc = win.document;
  const above = ['old-caption'];
  const inView = ['cur-author', 'cur-audio', 'cur-loc', 'cur-caption'];
  above.forEach((id) => {
    const el = doc.getElementById(id);
    if (el) el.getBoundingClientRect = RECT_ABOVE;
  });
  inView.forEach((id) => {
    const el = doc.getElementById(id);
    if (el) el.getBoundingClientRect = RECT_IN;
  });
}

function bridgeNode(media) {
  return `<script type="application/json" id="${NET_NODE_ID}">${JSON.stringify({ v: 1, ts: Date.now(), media })}</script>`;
}

(async () => {
  console.log(`${C.cyan}Instagram 沉浸流 精确发布时间 + 完整文案（v2.7.7）${C.reset}`);

  /* ======================= 一、主世界接收器 ======================= */
  section('一、主世界接收器（只听不发）');
  {
    const { api } = loadNetHook();
    ok('接收器已挂上（window.ClipMateInstagramNetParser）', !!api);
    if (!api) throw new Error('接收器没挂上，后面没法测');

    api.reset();
    const body = igResponse([
      { code: 'DfEptevTXBo', ts: 1793265017, user: 'peach.yarn', name: 'Peach Yarn', caption: 'I know I didn’t cut the sparkly ends' },
      { code: 'DcuZmw2RsWO', ts: 1788223448, user: 'zeyin_0000', name: 'Zeyin', caption: '220k - Set mặc nhà đi ngủ chất lụa xinh #dongu' }
    ]);
    eq('一份响应里两条 media 全部吃下（返回条数）', api.ingest(body), 2);

    const snap = api.snapshot();
    ok('两条都按作品编号分别存好（不会串台）',
      !!snap.media.DfEptevTXBo && !!snap.media.DcuZmw2RsWO);
    eq('[精确] 第一条时间戳逐个对得上', snap.media.DfEptevTXBo[0], 1793265017);
    eq('[精确] 第二条时间戳逐个对得上', snap.media.DcuZmw2RsWO[0], 1788223448);
    eq('作者用户名取到', snap.media.DfEptevTXBo[1], 'peach.yarn');
    eq('作者昵称取到', snap.media.DfEptevTXBo[2], 'Peach Yarn');
    eq('完整文案取到（不是被「更多」折叠的那段）', snap.media.DcuZmw2RsWO[3], '220k - Set mặc nhà đi ngủ chất lụa xinh #dongu');

    eq('[过滤] 不含 taken_at 的响应 → 0 条', api.ingest(JSON.stringify({ data: { x: 1, y: 'zzz' } })), 0);
    eq('[过滤] 不是 JSON → 0 条（不抛）', api.ingest('<html>not json</html>'), 0);
    eq('[过滤] 空正文 → 0 条', api.ingest(''), 0);

    api.reset();
    api.ingest(igResponse([{ code: 'BADTS000001', ts: 123, caption: '时间不像话' }]));
    eq('[过滤] 时间戳不像话（123）→ 不入库', Object.keys(api.snapshot().media).length, 0);

    api.reset();
    const longCaption = 'x'.repeat(3000);
    api.ingest(igResponse([{ code: 'LONGCAP001', ts: 1793265017, caption: longCaption }]));
    // v2.7.36：上限从 1200 提到 2400 —— IG 正文硬上限是 2200 字符，
    // 1200 会把长文案静默砍掉半截还照旧标成「已知全文」，用户看到的就是「文案缺一截」。
    eq('[上限] 超长文案截到 2400 字（高于 IG 正文上限 2200，正常文案不会被砍）',
      api.snapshot().media.LONGCAP001[3].length, 2400);

    api.reset();
    // 切点正好落在 emoji 的代理对中间：2399 个 a 之后是 🤷（U+1F937 = 高代理 + 低代理）
    const emojiTail = 'a'.repeat(2399) + '🤷' + 'b'.repeat(10);
    api.ingest(igResponse([{ code: 'EMOJICUT001', ts: 1793265017, caption: emojiTail }]));
    const cut = api.snapshot().media.EMOJICUT001[3];
    eq('[上限] 切点落在 emoji 上时退一格（不许切出半个字符）', cut, 'a'.repeat(2399));
    ok('[上限] 结果末尾不是孤立的高位代理（否则会显示成乱码）',
      !/[\uD800-\uDBFF]$/.test(cut));

    api.reset();
    const many = [];
    for (let i = 0; i < 305; i++) many.push({ code: 'C' + String(i).padStart(9, '0'), ts: 1793265017 });
    api.ingest(igResponse(many));
    const keys = Object.keys(api.snapshot().media);
    eq('[上限] 只留最近 300 条', keys.length, 300);
    ok('[上限] 淘汰的是最旧的（最早那条已不在）', keys.indexOf('C000000000') === -1);
    ok('[上限] 最新的还在', keys.indexOf('C000000304') > -1);

    api.reset();
    api.ingest(igResponse([{ code: 'WRITE00001', ts: 1793265017, user: 'u1', caption: '写节点用' }]));
    ok('写桥节点成功', api.write() === true);
  }

  {
    const { api, nodes } = loadNetHook();
    api.ingest(igResponse([{ code: 'WRITE00002', ts: 1793265017, user: 'u2', caption: '节点内容' }]));
    api.write();
    const node = nodes[NET_NODE_ID];
    ok('桥节点写进了 head，id 正确', !!node && node.type === 'application/json');
    let parsed = null;
    try { parsed = JSON.parse(node.textContent); } catch (e) { /* 留空 */ }
    ok('桥节点是合法 JSON', !!parsed);
    eq('桥节点里带着这条的时间戳', parsed && parsed.media.WRITE00002[0], 1793265017);
    eq('桥节点里带着这条的完整文案', parsed && parsed.media.WRITE00002[3], '节点内容');
  }

  /* ======================= 二、隔离世界读取 ======================= */
  section('二、隔离世界读取（桥节点优先，数据块兜底）');
  {
    const page = await harness.openPage({
      url: IG + '/reels/BRIDGE00001/',
      html: reelsFlowHtml({
        bridge: bridgeNode({ BRIDGE00001: [1793265017, 'peach.yarn', 'Peach Yarn', '来自页面自己请求的完整文案'] }),
        dataScript: ''
      })
    });
    const win = page.window;
    const ILD = win.InstagramInlineData;
    ok('InstagramInlineData 已加载', !!ILD);

    const m = ILD.findMedia('BRIDGE00001');
    ok('桥节点命中 → 拿到这条', !!m);
    eq('[精确] 时间戳来自桥节点', m && m.takenAt, 1793265017);
    eq('用户名来自桥节点', m && m.username, 'peach.yarn');
    eq('昵称来自桥节点', m && m.fullName, 'Peach Yarn');
    eq('完整文案来自桥节点', m && m.caption, '来自页面自己请求的完整文案');
    eq('findTakenAt 也走桥节点', ILD.findTakenAt('/reels/BRIDGE00001/'), 1793265017);
    eq('[未命中] 桥节点里没有这个编号 → null', ILD.findMedia('NOTINBRIDGE1'), null);
  }

  {
    // 桥节点没有这条 → 必须回落到 <script> 数据块（v2.7.5 那条老路）
    const payload = { require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { complete: true, result: { data: {
      xdt_api__v1__clips__home__connection_v2: { edges: [{ node: { media: {
        code: 'FALLBACK001', taken_at: 1793263488, user: { username: 'fb.user', full_name: 'FB User' },
        caption: { edges: [{ node: { text: '数据块里的文案' } }] }
      } } }] }
    } } } }]]] };
    const page = await harness.openPage({
      url: IG + '/reels/FALLBACK001/',
      html: reelsFlowHtml({
        bridge: bridgeNode({ OTHER000001: [1793265017, 'x', 'X', 'x'] }),
        dataScript: `<script type="application/json">${JSON.stringify(payload)}</script>`
      })
    });
    const ILD = page.window.InstagramInlineData;
    const m = ILD.findMedia('FALLBACK001');
    ok('[兜底] 桥节点没这条时回落到数据块', !!m);
    eq('[兜底] 数据块的时间戳取到了', m && m.takenAt, 1793263488);
    eq('[兜底] 数据块的文案也带上了', m && m.caption, '数据块里的文案');
  }

  {
    // 桥节点是坏 JSON → 不许抛，继续回落到数据块
    const page = await harness.openPage({
      url: IG + '/reels/BROKEN00001/',
      html: reelsFlowHtml({
        bridge: `<script type="application/json" id="${NET_NODE_ID}">{坏掉的JSON</script>`,
        dataScript: ''
      })
    });
    const ILD = page.window.InstagramInlineData;
    let threw = false;
    let got = 'unset';
    try { got = ILD.findMedia('BROKEN00001'); } catch (e) { threw = true; }
    ok('[健壮] 桥节点坏掉时不抛异常', !threw);
    eq('[健壮] 桥节点坏掉时返回 null（交给各字段自己兜底）', got, null);
  }

  {
    // 站点门禁：非 IG 站点一律 null
    const page = await harness.openPage({
      url: 'https://www.douyin.com/video/7400000000000000000',
      html: `<html><head>${bridgeNode({ OTHER000002: [1793265017, 'x', 'X', 'x'] })}</head><body><div>x</div></body></html>`
    });
    const ILD = page.window.InstagramInlineData;
    eq('[门禁] 抖音页面上取 IG 数据 → null', ILD.findMedia('OTHER000002'), null);
  }

  /* ======================= 三、文案策略 ======================= */
  section('三、文案：只认屏幕内那一条，且不把音频名当文案');
  {
    const page = await harness.openPage({
      url: IG + '/reels/CURITEM0001/',
      html: reelsFlowHtml({ bridge: '', dataScript: '' })
    });
    const win = page.window;
    const doc = win.document;
    stubRects(win);
    const Extractor = win.eval('InstagramSocialExtractor');
    ok('提取器类加载成功', typeof Extractor === 'function');

    // 对照：旧写法（全文档第一个同类名 span）会拿到屏幕外的旧条目 —— 证明 fixture 真能复现
    const oldFirst = doc.querySelector('span.x6ikm8r.x10wlt62.xuxw1ft') || doc.querySelector('#old-caption');
    ok('[对照] 旧写法「取第一个」正是屏幕外的上一条文案（真机 Bug 复现）',
      (oldFirst.textContent || '').indexOf('上一条滑走的旧文案') > -1);

    const inst = new Extractor();
    const text = inst.extractPageText(doc);
    eq('取到的是当前这条的正文', text, '这是一条真正的正文文案，比音频名字长很多');
    ok('没有把音频名当文案', text.indexOf('Bella') === -1);
    ok('没有把地点当文案', text.indexOf('巴塞罗那') === -1);
    ok('没有取到屏幕外的旧条目', text.indexOf('上一条滑走') === -1);
    ok('「… 更多」尾巴被切掉', text.indexOf('更多') === -1);

    // 直接调内部方法，确认规则本身
    eq('_reelsCaptionInView 直接调用结果一致',
      inst._reelsCaptionInView ? inst._reelsCaptionInView() : text, '这是一条真正的正文文案，比音频名字长很多');
  }

  {
    // 桥节点里有完整文案 → 优先用它（哪怕 DOM 上只有折叠版）
    const page = await harness.openPage({
      url: IG + '/reels/PRIFER00001/',
      html: reelsFlowHtml({
        bridge: bridgeNode({ PRIFER00001: [1793265017, 'peach.yarn', 'Peach Yarn', '这是接口里的完整文案，后面还有被折叠掉的一大段 #tag'] }),
        dataScript: ''
      })
    });
    const win = page.window;
    stubRects(win);
    const Extractor = win.eval('InstagramSocialExtractor');
    const inst = new Extractor();
    const text = inst.extractPageText(win.document);
    eq('桥节点有文案时优先用接口全文（不用 DOM 的折叠版）',
      text, '这是接口里的完整文案，后面还有被折叠掉的一大段 #tag');
  }

  /* ======================= 四、无布局环境 ======================= */
  section('四、拿不到元素位置时也不能取空（jsdom / 隐藏标签页）');
  {
    const page = await harness.openPage({
      url: IG + '/reels/NORECT00001/',
      // 这一节只验「量不出位置也别交白卷」，所以不带屏幕外旧条目 ——
      // 没有位置信息时按「取最长」兜底，带着更长的旧文案会干扰断言。
      html: reelsFlowHtml({ bridge: '', dataScript: '', withOld: false })
    });
    const win = page.window;
    const Extractor = win.eval('InstagramSocialExtractor');
    const inst = new Extractor();
    // 不 stub 任何矩形：jsdom 里 getBoundingClientRect 全 0
    const text = inst.extractPageText(win.document);
    ok('rect 全 0 时仍能取到正文（不因量不出位置就交白卷）',
      text.indexOf('这是一条真正的正文文案') === 0, JSON.stringify(text));
  }

  /* ======================= 五、无文案作品（v2.7.8） ======================= */
  section('五、这条作品真的没文案时，必须定案，不许抓上一条的');
  {
    // 5.1 钩子：三种情况必须分得开
    const { api } = loadNetHook();
    api.reset();
    api.ingest(igResponse([
      { code: 'NOCAP000001', ts: 1793265017, user: 'a', noCaption: true },
      { code: 'NOKEY000001', ts: 1793265018, user: 'b', noCaptionKey: true },
      { code: 'HASCAP00001', ts: 1793265019, user: 'c', caption: '正常文案' }
    ]));
    const snap = api.snapshot().media;
    eq('[无文案] caption:null → 明确记录「知道」这一位=1', snap.NOCAP000001[4], 1);
    eq('[无文案] caption:null → 文案本身是空串', snap.NOCAP000001[3], '');
    eq('[无文案] 响应里没带 caption 键 → 不臆断，这一位=0', snap.NOKEY000001[4], 0);
    eq('[无文案] 有文案 → 这一位=1', snap.HASCAP00001[4], 1);

    // 5.2 同一作品来第二份响应（没带 caption）→ 不许把已知结论冲成「不知道」
    api.ingest(igResponse([{ code: 'NOCAP000001', ts: 1793265017, user: 'a', noCaptionKey: true }]));
    eq('[合并] 后到的无 caption 响应不会冲掉「已确认没文案」',
      api.snapshot().media.NOCAP000001[4], 1);
    api.ingest(igResponse([{ code: 'HASCAP00001', ts: 1793265019, user: 'c', noCaptionKey: true }]));
    eq('[合并] 后到的无 caption 响应不会冲掉已知文案',
      api.snapshot().media.HASCAP00001[3], '正常文案');
    eq('[合并] 已知文案的「知道」标记也保留',
      api.snapshot().media.HASCAP00001[4], 1);
  }

  {
    // 5.3 读取侧：桥节点里 captionKnown 要透传出来
    const page = await harness.openPage({
      url: IG + '/reels/NOCAP000009/',
      html: reelsFlowHtml({
        bridge: bridgeNode({
          NOCAP000009: [1793265017, 'nobody', 'No Body', '', 1],
          OLDROW00009: [1793265018, 'old', 'Old', '老格式四位']
        }),
        dataScript: ''
      })
    });
    const ILD = page.window.InstagramInlineData;
    const m = ILD.findMedia('NOCAP000009');
    ok('[读取] 命中桥节点', !!m);
    eq('[读取] 空文案原样返回空串', m && m.caption, '');
    eq('[读取] captionKnown 透传为 true', m && m.captionKnown, true);
    const old = ILD.findMedia('OLDROW00009');
    eq('[读取] 老格式（4 位）不臆断 → captionKnown 为 false', old && old.captionKnown, false);
  }

  {
    // 5.4 提取器：当前条没文案 + 页面上还留着上一条的长文案 → 必须交空串，
    //     否则装配器之外的旧兜底会把上一条的文案当成本条内容（真机 siumai_l0v3r）。
    const page = await harness.openPage({
      url: IG + '/reels/NOCAP000010/',
      html: reelsFlowHtml({
        bridge: bridgeNode({ NOCAP000010: [1793265017, 'siumai', 'Siumai', '', 1] }),
        dataScript: ''
      })
    });
    const win = page.window;
    stubRects(win);
    const Extractor = win.eval('InstagramSocialExtractor');
    const inst = new Extractor();
    const text = inst.extractPageText(win.document);
    eq('[定案] 当前条明确没文案 → 交空串（交给装配器填 Instagram帖子）', text, '');

    // 对照：把「知道」这一位去掉（老格式）→ 立刻退回旧兜底，抓到上一条
    // —— 证明这个 fixture 真能复现那个 bug，断言不是假绿。
    const p2 = await harness.openPage({
      url: IG + '/reels/NOCAP000011/',
      html: reelsFlowHtml({
        bridge: bridgeNode({ NOCAP000011: [1793265017, 'siumai', 'Siumai', ''] }),
        dataScript: ''
      })
    });
    stubRects(p2.window);
    const inst2 = new (p2.window.eval('InstagramSocialExtractor'))();
    const t2 = inst2.extractPageText(p2.window.document);
    ok('[对照] 没有「知道」标记时，旧逻辑确实会把上一条的文案捡回来（Bug 复现）',
      t2.indexOf('上一条滑走') > -1 || t2.indexOf('正文文案') > -1);
  }

  {
    // 5.5 数据块兜底路径（单条 /reels/<code>/ 页最常用）也要能表达「这条没文案」
    const mk = (code, cap) => JSON.stringify({ require: [['ScheduledServerJS', 'handle', null, [{ __bbox: { complete: true, result: { data: {
      xdt_api__v1__clips__home__connection_v2: { edges: [{ node: { media: Object.assign(
        { code, taken_at: 1793263488, user: { username: 'db.user', full_name: 'DB User' } },
        cap === 'NONE' ? { caption: null } : { caption: { edges: [{ node: { text: cap } }] } }
      ) } }] }
    } } } }]]] });
    const page = await harness.openPage({
      url: IG + '/reels/DBLOCK00001/',
      html: reelsFlowHtml({ bridge: '', dataScript: `<script type="application/json">${mk('DBLOCK00001', 'NONE')}</script>` })
    });
    const m = page.window.InstagramInlineData.findMedia('DBLOCK00001');
    eq('[数据块] caption:null → 文案为空串', m && m.caption, '');
    eq('[数据块] caption:null → captionKnown 为 true', m && m.captionKnown, true);

    const page2 = await harness.openPage({
      url: IG + '/reels/DBLOCK00002/',
      html: reelsFlowHtml({ bridge: '', dataScript: `<script type="application/json">${mk('DBLOCK00002', '数据块里的正常文案')}</script>` })
    });
    const m2 = page2.window.InstagramInlineData.findMedia('DBLOCK00002');
    eq('[数据块] 有文案 → captionKnown 也是 true', m2 && m2.captionKnown, true);
  }

  /* ======================= 汇总 ======================= */
  console.log(`\n结果：${pass}/${pass + fail} 通过 — Instagram 沉浸流精确时间与文案（v2.7.8）`);
  if (fail) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  // 必须显式退出：jsdom 的 window 会留下定时器/句柄，不加这行进程会一直挂着，
  // 反向验证时「挂死」会被误判成「红」（本项目已经踩过这个坑）。
  process.exit(0);
})().catch((e) => {
  console.error('\n测试脚本自身出错：', e && e.stack || e);
  process.exit(1);
});
