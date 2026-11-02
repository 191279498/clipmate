'use strict';
/**
 * 变异测试：把 v2.7.17「快手个人主页」的每处实现逐个改坏，确认对应断言真的会红，然后逐字节还原。
 *
 * 纪律（踩过多次假绿的教训）：
 *   - 只改一处、跑一次、看名字是否命中预期的那条断言
 *   - 还原后用 sha256 校验逐字节一致，不一致立刻停
 *   - 不许只看退出码：有的变异会让测试崩（不算红），必须确认「预期那条断言失败了」
 *   - CRLF 文件要用 shapeCrlf 适配，否则 indexOf 找不到 → 把红伪装成「跳过」
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const P = (p) => path.join(ROOT, p);

function sha(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, Buffer.from(s, 'utf8')); }

function shapeCrlf(text, like) {
  return like.indexOf('\r\n') > -1 ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
}

function runTest(rel) {
  try {
    const out = execFileSync(process.execPath, [P(rel)], {
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules' }
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? 1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const KS = 'ClipMate_chrome/src/content/extractors/kuaishou-profile.js';
const NORM = 'ClipMate_chrome/src/content/shared/url-normalizer.js';
const DET = 'ClipMate_chrome/src/content/utils/media-detector.js';
const PERSIST = 'ClipMate_chrome/src/content/ui/modal-persistence.js';
const MAIN = 'ClipMate_chrome/src/content/content-main.js';
const SPA = 'ClipMate_chrome/src/content/ui/kuaishou-spa-handler.js';
const T = 'tests/kuaishou-profile.test.js';

const MUTANTS = [
  {
    id: 'M1',
    why: '账号ID 拿快手号顶替（跟作品页作者ID join 不上）',
    file: KS,
    find: `  async extractAccountId() {
    try {
      return this._urlUserId();`,
    replace: `  async extractAccountId() {
    try {
      return this._stripPrefix(this._textOf('.uid'), '快手号');`,
    test: T,
    expect: '账号ID = 地址栏那段（快手内部ID）'
  },
  {
    id: 'M2',
    why: '账号名不剥「快手号：」前缀（存进档案的是整句话）',
    file: KS,
    find: `      return this._stripPrefix(this._textOf('.uid'), '快手号');`,
    replace: `      return this._textOf('.uid');`,
    test: T,
    expect: '账号名 = 快手号（剥掉「快手号：」前缀）'
  },
  {
    id: 'M3',
    why: '网址退回 location.href（?source=SEARCH 这种来源标记会存进档案）',
    file: KS,
    find: `      return 'https://www.kuaishou.com/profile/' + id;`,
    replace: `      return String(location.href || '');`,
    test: T,
    expect: 'extractUrl() 自己就返回干净地址（不依赖下游规范化）'
  },
  {
    id: 'M4',
    why: '签名只取 textContent（页面只渲染 3 行，长简介会丢内容）',
    file: KS,
    find: `      const title = String(el.getAttribute && el.getAttribute('title') || '').trim();
      if (title) return this._squeeze(title);
      return this._text(el);`,
    replace: `      return this._text(el);`,
    test: T,
    expect: '签名取的是 **title 全文**（含第三行，页面 textContent 里没有）'
  },
  {
    id: 'M5',
    why: '不压缩连续空格（页面排版空格会带进 Excel/Notion）',
    file: KS,
    // ⚠️ 必须锚到 `_squeeze` 里那一处：`.replace(/[ \t\r\u3000]+/g, ' ')` 在本文件里出现**两次**
    //    （`_text()` 里还有一份），只写这一行的话 `String.replace` 只会改到第一处，
    //    改的是 `_text` —— 签名根本不走它，于是测试照样绿（假绿）。
    //    带上 `.map((x) => x.trim())` 才能唯一定位到 `_squeeze`（那边变量名是 x）。
    find: `      .replace(/\\u00a0/g, ' ')
      .replace(/[ \\t\\r\\u3000]+/g, ' ')
      .split('\\n')
      .map((x) => x.trim())`,
    replace: `      .replace(/\\u00a0/g, ' ')
      .split('\\n')
      .map((x) => x.trim())`,
    test: T,
    expect: '签名里的长串排版空格已压成一个'
  },
  {
    id: 'M6',
    why: '统计数字按「关注」取（粉丝数错位成 30）',
    file: KS,
    find: `        if (name.indexOf('粉丝') > -1) out.fans = value;`,
    replace: `        if (name.indexOf('关注') > -1) out.fans = value;`,
    test: T,
    expect: '第一行是统计行'
  },
  {
    id: 'M7',
    why: 'url-normalizer 去掉主页分支（主页网址会被规范成空串→原样返回带参地址）',
    file: NORM,
    find: `    const h = p.match(/^\\/profile\\/([A-Za-z0-9_-]{6,64})$/);
    if (h) return 'https://www.kuaishou.com/profile/' + h[1];
`,
    replace: ``,
    test: T,
    expect: 'url-normalizer 认得快手主页（否则会被原样返回、带上 source 参数）'
  },
  {
    id: 'M8',
    why: 'media-detector 删掉快手 person 规则（主页判不出人物档案）',
    file: DET,
    find: `        rules: [
          { type: 'person', patterns: ['/profile/'] },
          { type: 'social', patterns: ['/short-video/', '/video/'] }
        ]`,
    replace: `        rules: [
          { type: 'social', patterns: ['/short-video/', '/video/'] }
        ]`,
    test: T,
    expect: 'media-detector 快手用多规则且含 person /profile/'
  },
  {
    id: 'M9',
    why: 'modal-persistence 删掉快手主页兜底（重渲染会落到 general）',
    file: PERSIST,
    find: `      if (url.includes('kuaishou.com/profile/')) {
        return 'person';
      }`,
    replace: ``,
    test: T,
    expect: 'modal-persistence 有快手主页的 person 兜底（否则重渲染会落到 general）'
  },
  {
    id: 'M10',
    why: '弹层补认退回只对「类型为空」生效（主页上开弹层切不成 social）',
    file: MAIN,
    find: `      if ((!mediaType || mediaType === 'person') && typeof this._kuaishouOverrideType === 'function') {`,
    replace: `      if (!mediaType && typeof this._kuaishouOverrideType === 'function') {`,
    test: T,
    expect: 'detectMediaType 允许 person 被快手弹层补认成 social'
  },
  {
    id: 'M11',
    why: '接管时沿用 person 的 6 列映射器（作品数据会被套进人物字段里）',
    file: SPA,
    find: `      if (!this.fieldMapper || this._ksMapperType !== 'social') {
        this.fieldMapper = await this.initFieldMapper('social');
        this._ksMapperType = 'social';
      }`,
    replace: `      if (!this.fieldMapper) {
        this.fieldMapper = await this.initFieldMapper('social');
      }`,
    test: T,
    expect: '_activateKuaishouComponents 按 _ksMapperType 重建 social 映射器'
  },
  {
    id: 'M12',
    why: '从主页挂监听时照样藏按钮（主页就提不到人物档案了）',
    file: SPA,
    find: `      if (!keepButton) {
        // 还没认出「正在播的那一条」之前，页面上不许有按钮（灰的也不行）
        this._hideKuaishouButton();
      }`,
    replace: `      this._hideKuaishouButton();`,
    test: T,
    expect: 'watcher 支持 keepButton（主页进来时不许把按钮藏掉）'
  },
  {
    id: 'M13',
    why: '弹层关掉后不切回人物档案（关掉弹层按钮就消失）',
    file: SPA,
    find: `      if (this._ksProfilePerson && wasActive) {`,
    replace: `      if (false) {`,
    test: T,
    expect: '弹层关掉后切回 person（_ksProfilePerson + _restoreKuaishouProfilePerson）'
  },
  {
    id: 'M14',
    why: '红线：主页链路去读 INIT_STATE.userInfo（那是登录者自己，不是页面主人）',
    file: KS,
    find: `      return this._textOf('h1.user .name') || this._textOf('.user-info .name');`,
    replace: `      var mine = (window.INIT_STATE && window.INIT_STATE.userInfo) || null;
      if (mine && mine.nickname) return mine.nickname;
      return this._textOf('h1.user .name') || this._textOf('.user-info .name');`,
    test: T,
    expect: '代码里不许出现 userInfo'
  }
];

const before = {};
for (const m of MUTANTS) if (!before[m.file]) before[m.file] = { sha: sha(P(m.file)), text: read(P(m.file)) };

let allRed = true;
for (const m of MUTANTS) {
  const p = P(m.file);
  const src = before[m.file].text;
  const find = shapeCrlf(m.find, src);
  const repl = shapeCrlf(m.replace, src);
  if (src.indexOf(find) === -1) {
    console.log(`${m.id} ✗ 变异点找不到（源码已变），跳过 —— 这本身就是失败`);
    allRed = false;
    continue;
  }
  write(p, src.replace(find, repl));

  const r = runTest(m.test);
  const hit = r.out.indexOf('✗ ' + m.expect) > -1;
  const failed = r.code !== 0;

  // 还原并逐字节校验
  write(p, before[m.file].text);
  const restored = sha(p) === before[m.file].sha;

  const verdict = failed && hit ? 'RED(预期)' : (failed ? '红但没命中预期断言' : '竟然全绿＝假绿');
  if (!(failed && hit) || !restored) allRed = false;
  console.log(`${m.id} ${verdict}｜${m.why}｜还原${restored ? 'ok' : '失败!'}`);
  if (failed && !hit) console.log('   实际失败行：' + r.out.split('\n').filter((l) => l.indexOf('✗') > -1).slice(0, 3).join(' / '));
}

// 最终状态：全部文件应逐字节还原，且测试全绿
console.log('\n--- 还原后复跑 ---');
for (const f of Object.keys(before)) {
  console.log((sha(P(f)) === before[f].sha ? '✓ 逐字节一致' : '✗ 已污染') + ' ' + f);
}
const r = runTest(T);
console.log((r.code === 0 ? '✓ 绿' : '✗ 红') + ' ' + T);
if (r.code !== 0) allRed = false;
console.log(allRed ? `\n结果：${MUTANTS.length} 个变异全部变红，源码逐字节还原，测试全绿` : '\n结果：有问题，见上');
process.exit(allRed ? 0 : 1);
