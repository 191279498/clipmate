/**
 * 小红书「文案 / 日期 / 作者」取值（v2.6.0）
 *
 * 背景（2026-10-29 真机勘察）
 * --------------------------
 * 1. 小红书的**标题和正文是两个独立字段**（`title` / `desc`），不是一整段。
 *    用户拍板：文案 = 标题 + 正文拼一起。
 * 2. DOM 的 `.note-content` 是**脏的** —— textContent 长这样：
 *      `第一部都看烦了… 现在全村的唯一希望… #三体 3小时前 内蒙古`
 *    日期和 IP 属地被一起吞进来。`.note-content .desc` 才是干净正文。
 * 3. content script 在**隔离世界**读不到 `window.__INITIAL_STATE__`，
 *    所以数据要经 `xiaohongshu-page-data.js`（MAIN world）写进 DOM 桥再读回来。
 * 4. `noteDetailMap` 是**累积**的，旧笔记不会删 → 桥上必须带 `urlId`，
 *    只认跟当前地址一致的那份，否则会拿到上一条（TikTok 那边就这么串台的）。
 *
 * 本文件钉住的契约
 * ----------------
 *   A. composeNoteText：标题+正文怎么拼（含「正文已含标题」不重复拼）
 *   B. 数据桥脚本本身：发什么、何时发 note:null、ref 包装能不能拆
 *   C. readBridgeNote 的 ID 闸口：过期数据一律不认
 *   D. extractPageText 优先级：一手数据 → DOM（剔底部）→ 宽松链，且**污染文本不许进**
 *   E. extractTimeFromBridge：毫秒/秒都要对，脏数据要挡
 *   F. 昵称 / 主页：一手数据优先，DOM 兜底不丢
 *   G. 结构：这些顺序是有意为之，写反了就是老 bug 复发
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const EXT_PATH = path.join(ROOT, 'src/content/extractors/xiaohongshu-social.js');
const BRIDGE_PATH = path.join(ROOT, 'src/content/xiaohongshu-page-data.js');
const EXT_SRC = fs.readFileSync(EXT_PATH, 'utf8');
const BRIDGE_SRC = fs.readFileSync(BRIDGE_PATH, 'utf8');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
let pass = 0;
let fail = 0;
function ok(name) { pass++; console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) {
  fail++;
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function eq(name, got, want) {
  if (got === want) return ok(name);
  bad(name, `期望 ${JSON.stringify(want)}\n        实得 ${JSON.stringify(got)}`);
}
function truthy(name, got) { if (got) return ok(name); else bad(name, `期望真值，实得 ${JSON.stringify(got)}`); }
function falsy(name, got) { if (!got) return ok(name); else bad(name, `期望假值，实得 ${JSON.stringify(got)}`); }
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }
function has(name, haystack, needle) {
  if (String(haystack).indexOf(needle) > -1) return ok(name);
  bad(name, `没找到 ${JSON.stringify(needle)}\n        原文 ${JSON.stringify(String(haystack).slice(0, 160))}`);
}
function hasNot(name, haystack, needle) {
  if (String(haystack).indexOf(needle) < 0) return ok(name);
  bad(name, `不该出现 ${JSON.stringify(needle)}\n        原文 ${JSON.stringify(String(haystack).slice(0, 160))}`);
}

/* -------------------------------------------------------------------------- */
/* jsdom（跟 tests/lib/harness.js 用同一个托管目录）                             */
/* -------------------------------------------------------------------------- */
function loadJsdom() {
  try { return require('jsdom'); } catch (e) { /* 继续找 */ }
  const dirs = [
    process.env.CLIPMATE_NODE_PATH,
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules')
  ].filter(Boolean);
  for (const dir of dirs) {
    try { return require(path.join(dir, 'jsdom')); } catch (e) { /* 下一个 */ }
  }
  throw new Error('找不到 jsdom，请设置 NODE_PATH 或 CLIPMATE_NODE_PATH');
}
const { JSDOM } = loadJsdom();

/* 真机抄下来的地址 */
const ID_A = '6adad8a9000000002b001cb2';
const ID_B = '69e089a4000000002200066c';
const URL_A = 'https://www.xiaohongshu.com/explore/' + ID_A + '?xsec_token=ABSxZ3447qRAKPcDQ0Xj20KQaY6kPZmDW2Lz8101O_c0A=&xsec_source=pc_feed';
const URL_B = 'https://www.xiaohongshu.com/explore/' + ID_B + '?xsec_token=ABxxxx=&xsec_source=pc_search';
const URL_LIST = 'https://www.xiaohongshu.com/explore';

/**
 * 把提取器类装进一个 jsdom window
 * 只桩掉「浏览器边界」上的依赖（标题处理器 / 作者ID抓取器 / 字段外壳），
 * 被测的取值逻辑一行不改。
 */
function loadExtractorClass(win) {
  const BaseExtractor = class { constructor() {} };
  const SocialTitleProcessor = { generatePageTitle: () => 'TITLE' };
  const SocialFieldsBuilder = { build: async () => ({}) };
  const AuthorIdFetcher = { dedupe: (m, k, fn) => Promise.resolve(fn()), extract: async () => '' };
  const SocialDomUtils = { readMeta: () => '' };

  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'window', 'document', 'location', 'navigator', 'NodeFilter', 'XPathResult',
    'BaseExtractor', 'SocialTitleProcessor', 'SocialFieldsBuilder', 'AuthorIdFetcher', 'SocialDomUtils',
    EXT_SRC + '\n;return XiaohongshuSocialExtractor;'
  );
  return factory(
    win, win.document, win.location, win.navigator, win.NodeFilter, win.XPathResult,
    BaseExtractor, SocialTitleProcessor, SocialFieldsBuilder, AuthorIdFetcher, SocialDomUtils
  );
}

/**
 * 造一个提取器实例
 * @param {Object} [opts]
 * @param {string} [opts.url] - 页面地址（决定「当前笔记 ID」）
 * @param {string} [opts.html] - 页面 HTML
 * @param {Object|string|null} [opts.bridge] - 桥节点内容；不传 = 没有桥节点
 */
function mk(opts) {
  const o = opts || {};
  const dom = new JSDOM(
    o.html || '<!doctype html><html><head></head><body></body></html>',
    { url: o.url || URL_A }
  );
  const win = dom.window;
  if (o.bridge !== undefined && o.bridge !== null) {
    const node = win.document.createElement('script');
    node.id = 'clipmate-xhs-note';
    node.type = 'application/json';
    node.textContent = typeof o.bridge === 'string' ? o.bridge : JSON.stringify(o.bridge);
    win.document.head.appendChild(node);
  }
  const Cls = loadExtractorClass(win);
  const ex = new Cls();
  return { win, dom, ex };
}

/**
 * 桥里一条正常笔记。
 * **字段形态照真机数据抄**：作者是**嵌套**的 `note.user.{userId,nickname}`，
 * 不是平铺在 note 上。造数据时写成平铺会掩盖「归一化只认一种形态」的 bug
 * （TikTok 那边就因为只认嵌套，作者字段整片空白过）。
 */
function notePayload(id, over) {
  const base = {
    noteId: id,
    title: '第一部都看烦了，全拿来当噱头然后中途夭折',
    desc: '现在全村的唯一希望竟然是网飞。\n#三体[话题]#',
    time: 1761798903000,
    lastUpdateTime: 1761798903000,
    ipLocation: '内蒙古',
    type: 'normal',
    user: {
      userId: '6745e0e60000000001003568',
      nickname: '小梦是一股泥石流'
    }
  };
  return Object.assign(base, over || {});
}

/**
 * 跑 MAIN world 的数据桥脚本（`xiaohongshu-page-data.js`）
 * @returns {{tick:Function, intervals:number, win:Object}}
 */
function runBridge(state, url) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: url || URL_A });
  const win = dom.window;
  if (state !== undefined) win.__INITIAL_STATE__ = state;
  let tick = null;
  let intervals = 0;
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'location', 'setInterval', BRIDGE_SRC)(
    win, win.document, win.location, (fn) => { intervals++; tick = fn; return 1; }
  );
  return { tick, intervals, win, dom };
}

/** 读桥节点上的 JSON（没节点返回 null） */
function readBridgeNode(win) {
  const node = win.document.getElementById('clipmate-xhs-note');
  if (!node || !node.textContent) return null;
  try { return JSON.parse(node.textContent); } catch (e) { return null; }
}

/* ========================================================================== */
function main() {
  section('一、composeNoteText：标题和正文怎么拼');

  {
    const { ex } = mk();
    eq('两段都有 → 换行拼起来',
      ex.composeNoteText('标题甲', '正文乙'), '标题甲\n正文乙');
    eq('只有正文 → 就是正文', ex.composeNoteText('', '正文乙'), '正文乙');
    eq('只有标题 → 就是标题', ex.composeNoteText('标题甲', ''), '标题甲');
    eq('都没有 → 空串', ex.composeNoteText('', ''), '');
    eq('undefined 也不崩', ex.composeNoteText(undefined, undefined), '');
    eq('null 也不崩', ex.composeNoteText(null, null), '');
    eq('前后空白先 trim 再拼', ex.composeNoteText('  标题甲  ', '  正文乙  '), '标题甲\n正文乙');
  }

  {
    // 不少用户会把标题原样再写进正文第一句 —— 这种情况只留正文，不重复
    const { ex } = mk();
    const title = '第一部都看烦了，全拿来当噱头然后中途夭折';
    const desc = title + '\n\n现在全村的唯一希望竟然是网飞。';
    eq('正文开头已经包含标题 → 不重复拼', ex.composeNoteText(title, desc), desc.trim());
  }

  {
    const { ex } = mk();
    // 标题只是正文里出现的片段（不在开头）→ 仍然要拼，不能丢标题
    const desc = '先说说背景。\n三体这个IP被反复改编。';
    eq('标题出现在正文中间（不在开头）→ 照常拼',
      ex.composeNoteText('三体这个IP', desc), '三体这个IP\n' + desc);
  }

  /* ---------------------------------------------------------------------- */
  section('二、数据桥脚本：发给隔离世界的东西对不对');

  {
    // 笔记页 + 内存里有这条
    const state = { note: { noteDetailMap: { [ID_A]: { note: notePayload(ID_A) } } } };
    const b = runBridge(state, URL_A);
    eq('脚本挂了一个 250ms 轮询', b.intervals, 1);
    const p = readBridgeNode(b.win);
    truthy('桥节点已创建', !!p);
    eq('urlId = 地址里的笔记 ID', p.urlId, ID_A);
    eq('note 拿到了', !!p.note, true);
    eq('标题原样带回', p.note.title, notePayload(ID_A).title);
    eq('正文原样带回', p.note.desc, notePayload(ID_A).desc);
    eq('毫秒时间戳带回', p.note.time, 1761798903000);
    eq('昵称带回', p.note.nickname, '小梦是一股泥石流');
    eq('作者 userId 带回', p.note.userId, '6745e0e60000000001003568');
    eq('IP 属地带回（暂不展示，留着备用）', p.note.ipLocation, '内蒙古');
    // 只挑字段，别把整份几百 KB 的对象塞进 DOM
    eq('没把整个 note 对象塞进去（只有 9 个字段）', Object.keys(p.note).length, 9);
    falsy('不带 imageList 这种大字段', 'imageList' in p.note);
  }

  {
    // 作者信息平铺在 note 上（不是嵌套 note.user）也要认 —— 单点兼容，
    // 免得哪天小红书改了形态，昵称和主页整片空掉且不报错。
    const flat = notePayload(ID_A);
    flat.userId = flat.user.userId;
    flat.nickname = flat.user.nickname;
    delete flat.user;
    const b = runBridge({ note: { noteDetailMap: { [ID_A]: { note: flat } } } }, URL_A);
    const p = readBridgeNode(b.win);
    eq('作者信息平铺 → 昵称也认', p.note.nickname, '小梦是一股泥石流');
    eq('作者信息平铺 → userId 也认', p.note.userId, '6745e0e60000000001003568');
  }

  {
    // 列表页：必须明确告诉隔离世界「当前没有笔记」
    const b = runBridge({ note: { noteDetailMap: { [ID_A]: { note: notePayload(ID_A) } } } }, URL_LIST);
    const p = readBridgeNode(b.win);
    truthy('列表页 → 桥节点仍然存在（发空，不是不发）', !!p);
    eq('列表页 → urlId 是空串', p && p.urlId, '');
    eq('列表页 → note 是 null（不是上一条的残留）', p && p.note, null);
  }

  {
    // 笔记页但内存里还没这条（刚点开，接口还没回来）→ 仍然要报 urlId
    const b = runBridge({ note: { noteDetailMap: {} } }, URL_A);
    const p = readBridgeNode(b.win);
    truthy('数据没到 → 桥节点仍然存在（不能什么都不发）', !!p);
    eq('数据没到 → urlId 仍然报当前 ID', p && p.urlId, ID_A);
    eq('数据没到 → note 是 null（比什么都不发安全）', p && p.note, null);
  }

  {
    // 内存里只有上一条（切条后旧数据残留）→ 绝不能拿旧数据顶
    const state = { note: { noteDetailMap: { [ID_B]: { note: notePayload(ID_B) } } } };
    const b = runBridge(state, URL_A);
    const p = readBridgeNode(b.win);
    eq('内存里只有别的笔记 → urlId 还是当前 ID', p.urlId, ID_A);
    eq('内存里只有别的笔记 → note 为 null（不串台）', p.note, null);
  }

  {
    // Vue 的 ref 包装（原始值在 _rawValue / _value 里）
    const inner = { noteDetailMap: { [ID_A]: { note: notePayload(ID_A) } } };
    const state = { note: { _rawValue: inner } };
    const b = runBridge(state, URL_A);
    const p = readBridgeNode(b.win);
    eq('note 被 ref 包着 → 也能拆出来', p.note && p.note.title, notePayload(ID_A).title);
  }

  {
    const innerMap = { [ID_A]: { _value: { note: notePayload(ID_A) } } };
    const state = { note: { noteDetailMap: { _rawValue: innerMap } } };
    const b = runBridge(state, URL_A);
    const p = readBridgeNode(b.win);
    eq('noteDetailMap 被 ref 包着 → 也认', p.note && p.note.noteId, ID_A);
  }

  {
    // noteId 字段万一没了，用 map 的键兜底（键本身就是笔记 ID）
    const n = notePayload(ID_A);
    delete n.noteId;
    const b = runBridge({ note: { noteDetailMap: { [ID_A]: { note: n } } } }, URL_A);
    const p = readBridgeNode(b.win);
    eq('noteId 缺失 → 用 map 键兜底', p.note && p.note.noteId, ID_A);
  }

  {
    // 页面内存压根没有 __INITIAL_STATE__（比如改版了）→ 不崩，发 null
    const b = runBridge(undefined, URL_A);
    const p = readBridgeNode(b.win);
    eq('没有页面内存 → note 为 null', p.note, null);
    eq('没有页面内存 → 不崩、urlId 照报', p.urlId, ID_A);
  }

  {
    // 内容没变就不碰 DOM（避免无意义的 mutation 触发页面观察器）
    const state = { note: { noteDetailMap: { [ID_A]: { note: notePayload(ID_A) } } } };
    const b = runBridge(state, URL_A);
    const node = b.win.document.getElementById('clipmate-xhs-note');
    let writes = 0;
    let stored = node.textContent;
    Object.defineProperty(node, 'textContent', {
      configurable: true,
      get() { return stored; },
      set(v) { writes++; stored = v; }
    });

    b.tick();
    eq('数据没变 → 不重写 textContent', writes, 0);

    state.note.noteDetailMap[ID_A].note.desc = '改过的正文';
    b.tick();
    eq('数据变了 → 写一次', writes, 1);
    eq('写进去的是新正文', readBridgeNode(b.win).note.desc, '改过的正文');
  }

  /* ---------------------------------------------------------------------- */
  section('三、readBridgeNote：过期数据一律不认（串台防护）');

  {
    const { ex } = mk({ url: URL_A });
    eq('没有桥节点 → null', ex.readBridgeNote(), null);

    const { ex: e2 } = mk({ url: URL_A, bridge: { urlId: ID_A, note: notePayload(ID_A) } });
    eq('桥里就是当前这条 → 认', e2.readBridgeNote() && e2.readBridgeNote().noteId, ID_A);

    const { ex: e3 } = mk({ url: URL_A, bridge: { urlId: ID_B, note: notePayload(ID_B) } });
    eq('桥里是上一条（切条后残留）→ 不认', e3.readBridgeNote(), null);

    const { ex: e4 } = mk({ url: URL_A, bridge: { urlId: '', note: null } });
    eq('桥说这里是列表页 → 不认', e4.readBridgeNote(), null);

    const { ex: e5 } = mk({ url: URL_A, bridge: { urlId: ID_A, note: null } });
    eq('桥说「数据还没到」→ 不认', e5.readBridgeNote(), null);

    const { ex: e6 } = mk({ url: URL_A, bridge: '{坏掉的 JSON' });
    eq('桥内容是坏 JSON → 不认，不崩', e6.readBridgeNote(), null);
  }

  {
    // 列表页：即使桥里残留着某条笔记，也不能认（当前地址没有笔记 ID）
    const { ex } = mk({ url: URL_LIST, bridge: { urlId: ID_A, note: notePayload(ID_A) } });
    eq('列表页 + 桥里有残留 → 不认', ex.readBridgeNote(), null);
  }

  /* ---------------------------------------------------------------------- */
  section('四、extractPageText：一手优先，污染文本不许进');

  const POLLUTED_HTML = `<!doctype html><html><head></head><body>
    <div class="note-detail-mask">
      <div class="note-content">
        <div class="title">第一部都看烦了，全拿来当噱头然后中途夭折</div>
        <div class="desc">现在全村的唯一希望竟然是网飞。
#三体[话题]#</div>
        <div class="bottom-container">
          <div class="bottom-left"><span class="date">3小时前 内蒙古</span></div>
          <div class="bottom-right">1.2万赞</div>
        </div>
        <div class="comments-container"><div class="comment-item">这条评论不该出现</div></div>
      </div>
    </div>
  </body></html>`;

  {
    // 1) 桥有数据 → 用 title + desc，页面上的脏东西一个都不带
    const { ex } = mk({
      url: URL_A,
      html: POLLUTED_HTML,
      bridge: { urlId: ID_A, note: notePayload(ID_A) }
    });
    const text = ex.extractPageText();
    eq('一手数据 → 标题+正文', text, notePayload(ID_A).title + '\n' + notePayload(ID_A).desc);
    hasNot('不带「3小时前」', text, '3小时前');
    hasNot('不带 IP 属地「内蒙古」', text, '内蒙古');
    hasNot('不带「1.2万赞」', text, '1.2万赞');
    hasNot('不带评论区', text, '这条评论不该出现');
  }

  {
    // 2) 桥说没数据 → 走 DOM，且必须剔掉底部日期/互动/评论
    const { ex } = mk({ url: URL_A, html: POLLUTED_HTML, bridge: { urlId: ID_A, note: null } });
    const text = ex.extractPageText();
    has('DOM 兜底 → 有标题', text, '第一部都看烦了');
    has('DOM 兜底 → 有正文', text, '现在全村的唯一希望');
    has('DOM 兜底 → 有话题标签（属于正文的一部分）', text, '#三体');
    hasNot('DOM 兜底 → 不带「3小时前」', text, '3小时前');
    hasNot('DOM 兜底 → 不带 IP 属地', text, '内蒙古');
    hasNot('DOM 兜底 → 不带点赞数', text, '1.2万赞');
    hasNot('DOM 兜底 → 不带评论', text, '这条评论不该出现');
  }

  {
    // 3) 完全没有桥（比如 MAIN 脚本没注入）→ 仍然走 DOM，不能整条空掉
    const { ex } = mk({ url: URL_A, html: POLLUTED_HTML });
    const text = ex.extractPageText();
    has('没有桥 → DOM 兜底仍然有正文', text, '现在全村的唯一希望');
    hasNot('没有桥 → 也不带日期', text, '3小时前');
  }

  {
    // 4) 只有标题、没有正文（用户没写正文）
    const { ex } = mk({
      url: URL_A,
      html: POLLUTED_HTML,
      bridge: { urlId: ID_A, note: notePayload(ID_A, { desc: '' }) }
    });
    eq('只有标题 → 文案就是标题', ex.extractPageText(), notePayload(ID_A).title);
  }

  {
    // 5) 标题和正文都空（纯图片笔记）→ 返回空，交给上层兜底成「小红书笔记」
    const { ex } = mk({
      url: URL_A,
      html: '<!doctype html><html><body></body></html>',
      bridge: { urlId: ID_A, note: notePayload(ID_A, { title: '', desc: '' }) }
    });
    eq('标题正文都空 → 空串（交上层兜底）', ex.extractPageText(), '');
  }

  {
    // 6) 老路仍然可用：只有 `.note-detail` 这种宽松选择器时不能整条断掉
    const html = '<!doctype html><html><body><div class="note-detail">这是一段足够长的旧版兜底文案</div></body></html>';
    const { ex } = mk({ url: URL_A, html });
    eq('宽松选择器兜底还在', ex.extractPageText(), '这是一段足够长的旧版兜底文案');
  }

  /* ---------------------------------------------------------------------- */
  section('五、extractTimeFromBridge：毫秒/秒都要对，脏数据要挡');

  {
    const { ex } = mk({ url: URL_A, bridge: { urlId: ID_A, note: notePayload(ID_A) } });
    const t = ex.extractTimeFromBridge();
    // 1761798903000 → 本地时区 2025/10/30 12:35:03（GMT+8）
    truthy('毫秒时间戳 → 格式化成功', /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(t));
    eq('格式与项目其它站点一致（斜杠 + 到秒）', t.length, 19);
    has('年份对', t, '2025/');
  }

  {
    // 10 位秒级时间戳也要认（万一站点改了单位）
    const { ex } = mk({
      url: URL_A,
      bridge: { urlId: ID_A, note: notePayload(ID_A, { time: 1761798903 }) }
    });
    truthy('10 位秒级 → 也能格式化', /^\d{4}\/\d{2}\/\d{2} /.test(ex.extractTimeFromBridge()));
  }

  {
    const cases = [
      ['没有桥', undefined, ''],
      ['桥里没有这条（过期）', { urlId: ID_B, note: notePayload(ID_B) }, ''],
      ['time 是 0', { urlId: ID_A, note: notePayload(ID_A, { time: 0 }) }, ''],
      ['time 是 undefined', { urlId: ID_A, note: notePayload(ID_A, { time: undefined }) }, ''],
      ['time 是字符串', { urlId: ID_A, note: notePayload(ID_A, { time: 'abc' }) }, ''],
      ['time 太小（1970 附近）', { urlId: ID_A, note: notePayload(ID_A, { time: 12345 }) }, ''],
      ['time 在明天（未来）', { urlId: ID_A, note: notePayload(ID_A, { time: Date.now() + 3 * 86400000 }) }, '']
    ];
    for (const [label, bridge, want] of cases) {
      const { ex } = mk({ url: URL_A, bridge });
      eq(label + ' → 不编时间', ex.extractTimeFromBridge(), want);
    }
  }

  {
    // 关键回归：一手时间必须排在「DOM 相对时间」前面。
    // 否则从搜索页点开的笔记会一路落到「3小时前」，被算成「现在减3小时」的假秒数。
    const { ex } = mk({ url: URL_A, html: POLLUTED_HTML, bridge: { urlId: ID_A, note: notePayload(ID_A) } });
    const got = ex.extractPublishDate();
    eq('一手时间优先（不是拿「3小时前」算出来的）', got, ex.extractTimeFromBridge());
    hasNot('不是「现在减3小时」那种整点近似', got.slice(-2), '00');
  }

  {
    // 没有一手数据时才退回 DOM 的「3小时前」——这条路仍然要能走通
    const { ex } = mk({ url: URL_A, html: POLLUTED_HTML });
    truthy('没有一手数据 → DOM 相对时间仍然能出值', /^\d{4}\/\d{2}\/\d{2} /.test(ex.extractPublishDate()));
  }

  /* ---------------------------------------------------------------------- */
  section('六、昵称与作者主页：一手优先，DOM 兜底不丢');

  const AUTHOR_HTML = `<!doctype html><html><head></head><body>
    <div class="note-detail-mask">
      <a href="/user/profile/6745e0e60000000001003568" class="author">
        <span class="username">DOM里的昵称</span>
      </a>
      <div class="note-content"><div class="desc">正文</div></div>
    </div>
  </body></html>`;

  {
    const { ex } = mk({
      url: URL_A,
      html: AUTHOR_HTML,
      bridge: { urlId: ID_A, note: notePayload(ID_A) }
    });
    // 注意：这里的 note 是**嵌套**形态（note.user.nickname），不是桥脚本发出的扁平形态。
    // 桥跨了一个世界边界，两种形态都要能认 —— 只认一种的话作者字段会静默整片空掉。
    eq('昵称取一手数据（嵌套形态也认）', ex.extractAuthorName(), '小梦是一股泥石流');
    eq('主页由 userId 拼出来',
      ex.extractAuthorHomepage(), 'https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568');
  }

  {
    // 桥脚本真正发出的扁平形态
    const flat = {
      noteId: ID_A, title: '标题甲', desc: '正文乙', time: 1761798903000,
      lastUpdateTime: 1761798903000, ipLocation: '内蒙古', type: 'normal',
      userId: '6745e0e60000000001003568', nickname: '扁平形态的昵称'
    };
    const { ex } = mk({ url: URL_A, html: AUTHOR_HTML, bridge: { urlId: ID_A, note: flat } });
    eq('扁平形态 → 昵称照拿', ex.extractAuthorName(), '扁平形态的昵称');
    eq('扁平形态 → 主页照拼',
      ex.extractAuthorHomepage(), 'https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568');
  }

  {
    const { ex } = mk({ url: URL_A, html: AUTHOR_HTML });
    eq('没有一手数据 → 昵称回落 DOM', ex.extractAuthorName(), 'DOM里的昵称');
    eq('没有一手数据 → 主页回落 DOM 链接',
      ex.extractAuthorHomepage(), 'https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568');
  }

  {
    // 一手数据里 userId 为空（极少数情况）→ 不能拼出 /user/profile/undefined
    const { ex } = mk({
      url: URL_A,
      html: AUTHOR_HTML,
      bridge: { urlId: ID_A, note: notePayload(ID_A, { user: { userId: '', nickname: '小梦是一股泥石流' } }) }
    });
    eq('userId 空 → 回落 DOM 主页，不拼脏地址',
      ex.extractAuthorHomepage(), 'https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568');
    falsy('没有 undefined 混进地址', /undefined/.test(ex.extractAuthorHomepage()));
  }

  /* ---------------------------------------------------------------------- */
  section('七、结构：顺序写反就是老 bug 复发');

  // 7.1 日期：一手桥 必须在最前
  const dateBody = (EXT_SRC.match(/extractPublishDate\s*\(\s*\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  truthy('extractPublishDate 存在', dateBody.length > 0);
  const iBridgeTime = dateBody.indexOf('this.extractTimeFromBridge()');
  const iStateTime = dateBody.indexOf('this.extractTimeFromNoteState()');
  const iDateEl = dateBody.indexOf('this.extractTimeFromNoteDateElement()');
  truthy('日期先问一手桥', iBridgeTime > -1);
  truthy('一手桥在页面状态之前', iBridgeTime > -1 && iStateTime > -1 && iBridgeTime < iStateTime);
  truthy('一手桥在 DOM 日期元素之前（否则会算出假秒数）',
    iBridgeTime > -1 && iDateEl > -1 && iBridgeTime < iDateEl);

  // 7.2 文案：一手 必须在 DOM 之前
  const textBody = (EXT_SRC.match(/extractPageText\s*\(\s*\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  truthy('extractPageText 存在', textBody.length > 0);
  const iBridgeText = textBody.indexOf('this.readBridgeNote()');
  const iDomText = textBody.indexOf('this.extractNoteTextFromDom()');
  truthy('文案先问一手桥', iBridgeText > -1);
  truthy('一手桥在 DOM 兜底之前', iBridgeText > -1 && iDomText > -1 && iBridgeText < iDomText);

  // 7.3 DOM 兜底必须「先克隆再按容器剔」，不能直接吃 textContent
  const domBody = (EXT_SRC.match(/extractNoteTextFromDom\s*\(\s*\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  truthy('extractNoteTextFromDom 存在', domBody.length > 0);
  truthy('用 cloneNode 而不是直接读 textContent', /cloneNode\s*\(\s*true\s*\)/.test(domBody));
  truthy('剔除底部日期/互动容器', /\.bottom-container/.test(domBody) && /\.bottom-left/.test(domBody));
  truthy('剔除评论区', /\.comments-container/.test(domBody));
  truthy('在弹层内优先找（列表卡片里没有 note-content，但不写死也行）',
    /note-detail-mask \.note-content/.test(domBody));

  // 7.4 桥读取必须有 ID 闸口
  const readBody = (EXT_SRC.match(/readBridgeNote\s*\(\s*\)\s*\{[\s\S]*?\n  \}/) || [''])[0];
  truthy('readBridgeNote 存在', readBody.length > 0);
  truthy('有 urlId 闸口（不带闸口就会串台）', /payload\.urlId\s*!==\s*curId/.test(readBody));
  truthy('拿不到当前笔记ID时直接 null', /if\s*\(\s*!curId/.test(readBody));

  // 7.5 桥脚本自身的纪律
  truthy('桥脚本只挑字段（没有把整个 note 塞过去）', /readNote\s*\(\s*id\s*\)/.test(BRIDGE_SRC));
  truthy('桥脚本 250ms 轮询', /POLL_MS\s*=\s*250/.test(BRIDGE_SRC));
  truthy('桥脚本明确发 urlId', /publish\(\{\s*urlId:\s*id,\s*note:/.test(BRIDGE_SRC));
  truthy('列表页发空 urlId（不是什么都不发）', /publish\(\{\s*urlId:\s*''\s*,\s*note:\s*null\s*\}\)/.test(BRIDGE_SRC));
  truthy('内容没变不重写 DOM', /if\s*\(node\.textContent\s*!==\s*text\)/.test(BRIDGE_SRC));
  truthy('有防重复注入的哨兵', /window\.__clipmateXhsBridge/.test(BRIDGE_SRC));

  /* ============================ 总结 ============================ */
  console.log(`\n${fail === 0 ? C.green : C.red}== 通过 ${pass} 项，失败 ${fail} 项 ==${C.reset}`);
  console.log(`
${C.cyan}反向验证清单（改坏任何一条，对应断言必须变红）${C.reset}
  ① composeNoteText 去掉「正文已含标题」判断 → 第一节「不重复拼」红
  ② composeNoteText 只用 desc（丢掉标题） → 第一节「两段都有」「只有标题」红
  ③ 桥脚本 readNote 去掉 urlId（publish 时恒发空）→ 第三节「桥里就是当前这条 → 认」红
  ④ 桥脚本去掉「列表页发空 urlId」的分支 → 第二节「列表页 → urlId 是空串」红
  ⑤ 桥脚本把「内存里没这条」当成「什么都不发」→ 第二节「数据没到 → urlId 仍然报当前 ID」红
  ⑥ 桥脚本去掉 unwrap（ref 包装不拆）→ 第二节「note 被 ref 包着 → 也能拆出来」红
  ⑦ readBridgeNote 去掉 payload.urlId !== curId 闸口 → 第三节「桥里是上一条 → 不认」红
  ⑧ extractPageText 把 DOM 分支挪到一手数据之前 → 第四节「一手数据 → 标题+正文」红（会带上 3小时前）
  ⑨ extractNoteTextFromDom 改成直接读 textContent（不克隆不剔）
       → 第四节「DOM 兜底 → 不带「3小时前」」「不带点赞数」红
  ⑩ extractPublishDate 把 extractTimeFromBridge 挪到 extractTimeFromNoteDateElement 之后
       → 第五节「一手时间优先」红（会变成「现在减3小时」的整点）
  ⑪ extractTimeFromBridge 去掉合理性校验 → 第五节「time 太小 / 在明天」红
  ⑫ extractAuthorName 去掉一手优先 → 第六节「昵称取一手数据（嵌套形态也认）」红
  ⑬ extractAuthorHomepage 去掉 bridged.userId 判断 → 第六节「userId 空 → 回落 DOM」红
  ⑭ 删掉 normalizeBridgeNote（readBridgeNote 直接返回 payload.note）
       → 第六节「昵称取一手数据（嵌套形态也认）」红
       （桥上要是嵌套形态，作者字段会静默整片空掉，还不报错）
`);

  process.exit(fail === 0 ? 0 : 1);
}

main();
