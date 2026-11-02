#!/usr/bin/env node
/**
 * v2.7.22 变异测试：TikTok 个人主页这一版的每一条关键逻辑，逐项改坏，测试必须变红。
 *
 * 规矩（与 v2.7.15 ~ v2.7.21 同一套）：
 *   · 改坏 → 跑测试期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不算红）。
 *
 * ⚠️ 本文件所有 find 都按 LF 写。改前已实测这 5 个文件都是 LF；
 *    将来谁把它们转成 CRLF，变异会报「变异点不存在」，那时要按实际换行风格适配，
 *    不要直接删断言。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2722.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');

const TEST_FILES = [
  path.join(__dirname, 'tiktok-account-profile.test.js'),
  path.join(__dirname, 'tiktok-cache-and-empty-text.test.js')
];

const PROFILE = 'src/content/extractors/tiktok-profile.js';
const PAGEDATA = 'src/content/shared/tiktok-page-data.js';
const FACTORY = 'src/content/utils/extractor-factory.js';
const DETECTOR = 'src/content/utils/media-detector.js';
const PERSIST = 'src/content/ui/modal-persistence.js';

const MUTATIONS = [
  {
    name: '① 统计改成「接口精确值优先」（页面 96.5M 会被存成 96500000）',
    file: PROFILE,
    find: `    const fans = this._statFromDom('followers-count') ||
                 this._exact(profile && profile.followerCount);`,
    repl: `    const fans = this._exact(profile && profile.followerCount) ||
                 this._statFromDom('followers-count');`
  },
  {
    name: '② 统计不校验格式（容器里的杂物会被当数字存进去）',
    file: PROFILE,
    find: `    if (!/^[\\d.,]+\\s*[KMB万亿]{0,2}$/i.test(text)) return '';`,
    repl: `    if (false) return '';`
  },
  {
    name: '③ 签名：一手拿到但为空时仍回落 DOM（占位话「尚无个人简介。」混进档案）',
    file: PROFILE,
    find: `  _signature(profile) {
    if (profile) return this._norm(profile.signature || '');`,
    repl: `  _signature(profile) {
    if (profile && profile.signature) return this._norm(profile.signature);`
  },
  {
    name: '④ 占位话过滤器失效（DOM 上的「尚无个人简介。」被当签名）',
    file: PROFILE,
    find: `    if (/^(?:尚无个人简介|暂无个人简介|暂无简介|还没有简介|这个人很懒[^。]*|No bio yet|Add a bio)[.。]?$/i.test(t)) {`,
    repl: `    if (false) {`
  },
  {
    name: '⑤ 外链不去壳（存成 tiktok.com/link/v2?… 跳转壳）',
    file: PROFILE,
    find: `    if (/^https?:\\/\\//i.test(href) &&
        href.indexOf('tiktok.com/link/') === -1 &&`,
    repl: `    if (/^https?:\\/\\//i.test(href) &&`
  },
  {
    name: '⑥ 外链不补协议（`tiktok.com/discovermore` 原样存，点不开）',
    file: PROFILE,
    find: `    if (/^https?:\\/\\//i.test(t)) return t;`,
    repl: `    if (true) return t;`
  },
  {
    name: '⑦ 账号ID 回落 @账号名（两列变成同一个东西，IG/快手同款事故）',
    file: PROFILE,
    find: `      return (p && p.secUid) ? String(p.secUid) : '';`,
    repl: `      return (p && p.secUid) ? String(p.secUid) : this._urlHandle();`
  },
  {
    name: '⑧ DOM 的账号名不剥 @（`@tiktok` 与作品页的 `tiktok` join 不上）',
    file: PROFILE,
    find: `      return this._domText('[data-e2e="user-subtitle"]').replace(/^@+/, '').trim();`,
    repl: `      return this._domText('[data-e2e="user-subtitle"]').trim();`
  },
  {
    name: '⑨ 网址用地址栏写法（地址输 @TikTok 就存成 @TikTok，与账号名列不一致）',
    file: PROFILE,
    find: `      const handle = this._realHandle();`,
    repl: `      const handle = this._urlHandle();`
  },
  {
    name: '⑩ 不读数据块（全回落 DOM：账号ID 永远空、签名被截断）',
    file: PROFILE,
    find: `      if (typeof TiktokPageData !== 'undefined' && TiktokPageData &&
          typeof TiktokPageData.getProfile === 'function') {
        this._profileCache = TiktokPageData.getProfile() || null;`,
    repl: `      if (false) {
        this._profileCache = null;`
  },
  {
    name: '⑪ 提取器自己解析数据块（绕过 uniqueId 闸口）',
    file: PROFILE,
    find: `  async extractBio() {`,
    repl: `  async extractBio() {
    var __bypass = '__UNIVERSAL_DATA_FOR_REHYDRATION__';`
  },
  {
    name: '⑫ 拆掉数据块闸口（数据块里是登录者/别人也照用 → 串台）',
    file: PAGEDATA,
    find: `      if (handle && user.uniqueId.toLowerCase() !== String(handle).toLowerCase()) return null;`,
    repl: `      if (false) return null;`
  },
  {
    name: '⑬ 工厂里 person 规则排到通配 social 之后（主页永远走作品提取器）',
    file: FACTORY,
    find: `      { pattern: /www\\.tiktok\\.com\\/@[A-Za-z0-9_.]{2,40}\\/?(?:[?#]|$)/, hostname: 'www.tiktok.com', mediaType: 'person' },
      // 添加TikTok社交媒体URL模式
      { pattern: /www\\.tiktok\\.com\\//, hostname: 'www.tiktok.com', mediaType: 'social' },`,
    repl: `      // 添加TikTok社交媒体URL模式
      { pattern: /www\\.tiktok\\.com\\//, hostname: 'www.tiktok.com', mediaType: 'social' },
      { pattern: /www\\.tiktok\\.com\\/@[A-Za-z0-9_.]{2,40}\\/?(?:[?#]|$)/, hostname: 'www.tiktok.com', mediaType: 'person' },`
  },
  {
    name: '⑭ 站点规则里删掉 person 那条（检测器把主页判成 social）',
    file: DETECTOR,
    find: `          { type: 'person', regex: '^/@[A-Za-z0-9_.]{2,40}/?$' },
`,
    repl: ``
  },
  {
    name: '⑮ 弹窗持久化删掉 TikTok 主页兜底（浮窗按 7 列渲染，6 列档案全乱）',
    file: PERSIST,
    find: `      if (url.includes('tiktok.com/@')) {`,
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

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = original(m.file);
  const src = orig.buf.toString('utf8');

  if (src.indexOf(m.find) < 0) {
    problems.push(`${m.name} → 变异点不存在（find 没命中，等于没验证）`);
    return;
  }

  fs.writeFileSync(target, src.replace(m.find, m.repl));

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
