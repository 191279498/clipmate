#!/usr/bin/env node
/**
 * v2.7.20 变异测试：把「Instagram 个人主页」的关键判断逐个改坏，测试必须变红。
 *
 * 规矩（与 v2.7.15 ~ v2.7.19 同一套）：
 *   · 改坏 → 跑 instagram-profile.test.js 期望**失败**（exit ≠ 0）→ 逐字节还原（sha256 比对）；
 *   · 变异点找不到 = 等于没验证，直接记为问题（不许当成"跳过"）；
 *   · 改坏后挂死 = 由 spawnSync 的 timeout 兜底（不是绿）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2720.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');

/**
 * 任一测试变红即算咬住。
 *   · instagram-profile.test.js       —— 六列契约 / 签名三档 / 钩子 / 规则
 *   · instagram-entry-context.test.js —— 主页必须「一上来就有按钮」这条**行为**（走完整 init）
 * 只跑第一个的话，改坏 ig-spa-handler 只会命中源码断言，
 * 行为那一层是不是真的坏了，测不出来。
 */
const TEST_FILES = [
  path.join(__dirname, 'instagram-profile.test.js'),
  path.join(__dirname, 'instagram-entry-context.test.js')
];

const PROFILE = 'src/content/extractors/instagram-profile.js';
const HOOK = 'src/content/instagram-net-hook.js';
const ENTRY = 'src/content/shared/instagram-entry-context.js';
const FACTORY = 'src/content/utils/extractor-factory.js';
const DETECTOR = 'src/content/utils/media-detector.js';
const SPA = 'src/content/ui/ig-spa-handler.js';

const MUTATIONS = [
  {
    name: '① 统计行把「关注」也放进去（跟三站口径不一致）',
    file: PROFILE,
    find: `    if (posts) parts.push('帖子：' + posts);`,
    repl: `    if (posts) parts.push('帖子：' + posts);
    if (bridge && typeof bridge.followingCount === 'number') parts.push('关注：' + bridge.followingCount);`
  },
  {
    name: '② 数字改用接口精确值（丢掉了「照页面原样」）',
    file: PROFILE,
    find: `    const fans = this._statFromDom(/(粉丝|followers?)$/i) ||
                 (bridge && typeof bridge.followerCount === 'number' ? String(bridge.followerCount) : '');`,
    repl: `    const fans = (bridge && typeof bridge.followerCount === 'number' ? String(bridge.followerCount) : '') ||
                 this._statFromDom(/(粉丝|followers?)$/i);`
  },
  {
    name: '③ meta 不校验用户名（换成只认「(@」，旧号的数据会串进来）',
    file: PROFILE,
    find: `    const at = desc.indexOf('(@' + username + ')');
    if (at === -1) return '';                       // 红线一：不是这个号的 meta，一律不用`,
    repl: `    const at = desc.indexOf('(@');
    if (at === -1) return '';`
  },
  {
    name: '④ 签名优先用 meta（把桥节点的一手全文挤掉）',
    file: PROFILE,
    find: `    if (bridge && typeof bridge.bio === 'string' && bridge.bio) {
      return this._norm(bridge.bio);
    }
    const fromMeta = this._bioFromMeta(username);
    if (fromMeta) return fromMeta;`,
    repl: `    const fromMeta = this._bioFromMeta(username);
    if (fromMeta) return fromMeta;
    if (bridge && typeof bridge.bio === 'string' && bridge.bio) {
      return this._norm(bridge.bio);
    }`
  },
  {
    name: '⑤ DOM 兜底不剪「... 更多」（把展开提示当正文存进去）',
    file: PROFILE,
    find: `      return this._norm(this._stripMoreTail(raw));
    }

    // 第二优先：长度启发式（≥12 字、不是昵称/用户名/统计标签）`,
    repl: `      return this._norm(raw);
    }

    // 第二优先：长度启发式（≥12 字、不是昵称/用户名/统计标签）`
  },
  {
    name: '⑥ 外链直接存 l.instagram.com 跳转壳',
    file: PROFILE,
    find: `          if (/^https?:\\/\\//i.test(real)) return real;`,
    repl: `          if (/^https?:\\/\\//i.test(real)) return href;`
  },
  {
    name: '⑦ 钩子改认 data.viewer（把登录者自己写进别人档案）',
    file: HOOK,
    find: `    var u = d.user;`,
    repl: `    var u = d.viewer || d.user;`
  },
  {
    name: '⑧ 钩子去掉 biography 闸口（帖子作者碎片也被当主页资料）',
    file: HOOK,
    find: `    if (!Object.prototype.hasOwnProperty.call(u, 'biography')) return null;`,
    repl: `    if (false) return null;`
  },
  {
    name: '⑨ 主页判定允许多段路径（reels 列表被当成主页）',
    file: ENTRY,
    find: `    if (seg.length !== 1) return false;`,
    repl: `    if (seg.length === 0) return false;`
  },
  {
    name: '⑩ 工厂删掉 IG person 规则（主页退回通配 social）',
    file: FACTORY,
    find: `      {
        pattern: /www\\.instagram\\.com\\/(?!(?:p|reel|reels|tv|stories|explore|accounts|direct|settings|about|legal|api|developer|emails|session|challenge|web|directory|oauth|privacy|terms|press|blog|jobs|help|your_activity|nametag|lite|download|emoji|ads)\\/?(?:[?#]|$))[A-Za-z0-9_.]+\\/?(?:[?#]|$)/,
        hostname: 'www.instagram.com',
        mediaType: 'person'
      },
`,
    repl: ``
  },
  {
    name: '⑪ 检测器去掉 regex 规则支持（主页判不出 person）',
    file: DETECTOR,
    find: `    if (rule.regex) {`,
    repl: `    if (false) {`
  },
  {
    name: '⑫ 入口显隐退回 hasExtractableWork（主页按钮又被藏）',
    file: SPA,
    find: `      ok = !!ctx.hasExtractableContent();`,
    repl: `      ok = !!ctx.hasExtractableWork();`
  }
];

/** 按文件缓存原始字节与 sha256 */
const originals = Object.create(null);
function original(file) {
  if (!originals[file]) {
    const buf = fs.readFileSync(path.join(ROOT, file));
    originals[file] = { buf, hash: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  return originals[file];
}

function runTest() {
  // 逐个跑，第一个红的就够（省时间）；全绿才算「没咬住」
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

/** 从测试输出里挑出失败项（格式：`  - 名字`） */
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
