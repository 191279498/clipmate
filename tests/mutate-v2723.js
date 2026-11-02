#!/usr/bin/env node
/**
 * v2.7.23 变异测试：YouTube 频道页（个人主页）这一版的每条关键逻辑，逐项改坏，测试必须变红。
 *
 * 规矩（与 v2.7.15 ~ v2.7.22 同一套）：
 *   · 改坏 → 跑测试期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不算红）。
 *
 * ⚠️ 换行风格（v2.7.17 踩过的坑）：
 *   `modal-persistence.js` 是 **CRLF**，其余 5 个文件是 LF。
 *   所以下面凡是跨行拼 find 的，都只用在 LF 文件上；
 *   modal-persistence 那一条只用**单行** find，不拼 `\n`。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2723.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');

const TEST_FILES = [path.join(__dirname, 'youtube-profile.test.js')];

const PROFILE = 'src/content/extractors/youtube-profile.js';
const DETECTOR = 'src/content/utils/media-detector.js';
const BACKGROUND = 'src/background/background.js';
const FACTORY = 'src/content/utils/extractor-factory.js';
const NORMALIZER = 'src/content/shared/url-normalizer.js';
const PERSIST = 'src/content/ui/modal-persistence.js';
const MANIFEST = 'manifest.json';

/** media-detector / background 里那条 person 正则的原文（两份必须一样） */
const PERSON_RE = "{ type: 'person', regex: '^/(?:@[A-Za-z0-9._-]{2,40}|channel/UC[A-Za-z0-9_-]{10,40})(?:/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?/?$' }";
/** 把 channel 分支改成永不匹配（保留 @ 分支，用来单独咬「/channel/ 也是主页」） */
const PERSON_RE_NO_CHANNEL = PERSON_RE.replace('channel/UC[A-Za-z0-9_-]{10,40}', 'channel/UCZZZZZZZZZZZZZZZZZZZZZZ');

const MUTATIONS = [
  {
    name: '① handle 比对改成大小写敏感（真机 @MediaStorm vs 页面 @mediastorm → 全部失效）',
    file: PROFILE,
    find: `      return alt.toLowerCase() === urlHandle.toLowerCase();`,
    repl: `      return alt === urlHandle;`
  },
  {
    name: '② 拆掉 JSON-LD 闸口（数据块里是别人也照用 → 串台）',
    file: PROFILE,
    find: `  _ldMatchesLocation(entity) {
    if (!entity) return false;`,
    repl: `  _ldMatchesLocation(entity) {
    if (!entity) return false;
    return true;`
  },
  {
    name: '③ 账号ID 加回 canonical 兜底（频道间页内跳转拿到上一个频道的 UC）',
    file: PROFILE,
    find: `      return this._urlChannelId();
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取账号ID失败:', err);`,
    repl: `      const __link = document.querySelector('link[rel="canonical"]');
      return this._urlChannelId() || (__link ? this._ucFrom(__link.getAttribute('href') || '') : '');
    } catch (err) {
      console.error('[YoutubeProfileExtractor] 提取账号ID失败:', err);`
  },
  {
    name: '④ 不读 JSON-LD 的简介（长简介被 DOM 那份截断/丢字）',
    file: PROFILE,
    find: `  _signature() {
    const e = this._ldEntity();
    if (e) return this._norm(e.description || '');`,
    repl: `  _signature() {
    const e = null;
    if (e) return this._norm(e.description || '');`
  },
  {
    name: '⑤ 统计不校验 header 里的 handle（页内跳转后把上一个频道的订阅数记到这个人头上）',
    file: PROFILE,
    find: `    if (!hasOwnHandle) return null;`,
    repl: `    if (false) return null;`
  },
  {
    name: '⑥ 外链不排除「订阅」按钮与站内地址（sub_confirmation=1 当外链存）',
    file: PROFILE,
    // ⚠️ 三条排除必须**一起拆**：只拆 sub_confirmation 那条时，
    //    `youtube.com/user/…` 与「站内地址」两条还会兜住它，测试照样绿 —— 那是假绿。
    find: `    if (/[?&]sub_confirmation=/i.test(u)) return '';
    if (/^(?:https?:\\/\\/)?(?:www\\.|m\\.)?youtube\\.com\\/user\\//i.test(u)) return '';

    // ③ 站内地址不算外链
    if (/^https?:\\/\\/(?:www\\.|m\\.)?youtube\\.com(?:\\/|$)/i.test(u)) return '';
    if (/^https?:\\/\\/youtu\\.be(?:\\/|$)/i.test(u)) return '';`,
    repl: `    if (false) return '';
    if (false) return '';

    // ③ 站内地址不算外链
    if (false) return '';
    if (false) return '';`
  },
  {
    name: '⑦ 外链不解 /redirect 跳转壳（壳地址进档案，点不开）',
    file: PROFILE,
    find: `    if (m && m[1] && u.indexOf('/redirect') > -1) {`,
    repl: `    if (false) {`
  },
  {
    name: '⑧ DOM 简介不剪「…更多」尾巴（档案里多一句平台话术）',
    file: PROFILE,
    find: `    return String(s || '').replace(/\\s*(?:\\.{2,}|…)\\s*(?:更多|more)\\s*$/i, '').trim();`,
    repl: `    return String(s || '').trim();`
  },
  {
    name: '⑨ 站点规则里删掉 channel/UC 分支（/channel/ 形态的主页被判成社交）',
    file: DETECTOR,
    find: `      'www.youtube.com': {
        rules: [
          ` + PERSON_RE,
    repl: `      'www.youtube.com': {
        rules: [
          ` + PERSON_RE_NO_CHANNEL
  },
  {
    name: '⑩ 站点规则把 person 排到 social 之后（主页永远判成社交）',
    file: DETECTOR,
    find: `      'www.youtube.com': {
        rules: [
          ` + PERSON_RE + `,
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] }`,
    repl: `      'www.youtube.com': {
        rules: [
          { type: 'social', patterns: ['/watch', '/shorts/', '/channel/', '/@'] },
          ` + PERSON_RE
  },
  {
    name: '⑪ background 那份把 channel 分支改坏（两份配置不一致）',
    file: BACKGROUND,
    find: `      'www.youtube.com': {
        rules: [
          ` + PERSON_RE,
    repl: `      'www.youtube.com': {
        rules: [
          ` + PERSON_RE_NO_CHANNEL
  },
  {
    name: '⑫ 工厂里删掉 person URL 规则（主页走作品提取器）',
    file: FACTORY,
    find: `      { pattern: /www\\.youtube\\.com\\/(?:@[A-Za-z0-9._-]{2,40}|channel\\/UC[A-Za-z0-9_-]{10,40})(?:\\/(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search))?\\/?(?:[?#]|$)/, hostname: 'www.youtube.com', mediaType: 'person' },
`,
    repl: ``
  },
  {
    name: '⑬ 网址规范化不认频道子页（/videos 与主页存成两个字符串）',
    file: NORMALIZER,
    find: `    const YT_SUB = '(?:videos|shorts|streams|playlists|community|channels|about|featured|podcasts|releases|courses|store|posts|search)';`,
    repl: `    const YT_SUB = '(?:NOMATCH)';`
  },
  {
    name: '⑭ manifest 不注册提取器脚本（运行时类不存在）',
    file: MANIFEST,
    find: `        "src/content/extractors/youtube-profile.js",
`,
    repl: ``
  },
  {
    name: '⑮ 弹窗持久化删掉 YouTube 主页兜底（浮窗按 7 列渲染，6 列档案全乱）',
    file: PERSIST,
    find: `      if (url.includes('youtube.com/')) {`,
    repl: `      if (false) {`
  }
];

/** 读原始字节（还原要逐字节，不能用字符串写回） */
const cache = Object.create(null);
function original(rel) {
  if (!cache[rel]) {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    cache[rel] = { buf, hash: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  return cache[rel];
}

/** 按文件实际换行风格拼 find（CRLF 文件里 `\n` 找不到——本项目必踩的坑） */
function shape(src, text) {
  return src.indexOf('\r\n') > -1 ? String(text).replace(/\r?\n/g, '\r\n') : String(text);
}

function runTest() {
  let out = '';
  for (const t of TEST_FILES) {
    const r = spawnSync(process.execPath, [t], {
      encoding: 'utf8',
      timeout: 180000,
      env: Object.assign({}, process.env)
    });
    if (r.error) return { code: -1, text: String(r.error && r.error.message) };
    if (r.signal) return { code: -2, text: '被信号终止：' + r.signal };
    out += (r.stdout || '') + (r.stderr || '');
    if (r.status !== 0) return { code: r.status, text: out };
  }
  return { code: 0, text: out };
}

/** 从测试输出里挑出失败项 */
function failedItems(text) {
  const out = [];
  String(text || '').split('\n').forEach((l) => {
    const m = l.match(/^\s{2}-\s(.+)$/);
    if (m) out.push(m[1].trim());
  });
  return out.slice(0, 3);
}

let red = 0;
const problems = [];

// 先跑一遍基线：测试本身必须是绿的，否则后面的红全是假的
{
  const base = runTest();
  if (base.code !== 0) {
    console.log('❌ 基线不绿，变异无意义。先修测试：');
    console.log(failedItems(base.text).map((x) => '   ✗ ' + x).join('\n'));
    process.exit(1);
  }
  console.log('基线：测试全绿（' + (base.text.match(/全部通过：(\d+)/) || [, '?'])[1] + ' 项）\n');
}

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = original(m.file);
  const src = orig.buf.toString('utf8');

  const find = shape(src, m.find);
  const repl = shape(src, m.repl);

  if (src.indexOf(find) < 0) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，等于没验证）`);
    return;
  }
  // 唯一性：同一个 find 出现两次时 replace 只改第一处，改到的可能根本不是目标路径
  if (src.indexOf(find) !== src.lastIndexOf(find)) {
    problems.push(`${m.name} → find 不唯一（出现多次，replace 只会改第一处）`);
    return;
  }

  // ⚠️ 必须用**函数式**替换：repl 里常含 `$`（正则的 `$` 结尾锚点），
  //    而 `String.replace(find, repl)` 会把 `$'` / `$&` / `$1` 当特殊模式，
  //    结果是文本被重复插入、长度暴涨，测试红得莫名其妙（v2.7.23 踩过）。
  fs.writeFileSync(target, src.replace(find, () => repl));

  const r = runTest();

  // 无论测试结果如何，先逐字节还原
  fs.writeFileSync(target, orig.buf);
  const nowHash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
  if (nowHash !== orig.hash) {
    problems.push(`${m.name} → 还原失败（sha256 不一致）`);
    return;
  }

  if (r.code === 0) {
    problems.push(`${m.name} → 改坏了还是绿的（断言没咬住）`);
    return;
  }
  if (r.code === -2) {
    problems.push(`${m.name} → 挂死/超时，不算红`);
    return;
  }

  red++;
  console.log(`  ✅ ${m.name}`);
  console.log(`     变红（exit=${r.code}）${failedItems(r.text).map((x) => '\n       ✗ ' + x).join('')}`);
});

console.log('');
console.log(`变异 ${red}/${MUTATIONS.length} 变红`);
if (problems.length) {
  console.log('');
  problems.forEach((p) => console.log('  ❌ ' + p));
  process.exit(1);
}
console.log('全部变异都能变红，且已逐字节还原。');
