'use strict';
/**
 * 变异测试：把 v2.7.15 的每处修复逐个改坏，确认对应断言**真的会红**，然后逐字节还原。
 *
 * 纪律（踩过六次假绿的教训）：
 *   - 只改一处、跑一次、看名字是否命中预期的那条断言
 *   - 还原后用 sha256 校验**逐字节**一致，不一致立刻停
 *   - 不许只看退出码：有的变异会让测试崩（不算红），必须确认「预期那条断言失败了」
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

/**
 * 源码里有的文件是 CRLF（data-processors.js 就是），变异串是按 LF 写的，
 * 直接用 indexOf 找不到 —— 这本身会伪装成「变异点不存在」。按文件实际换行风格适配。
 */
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

const MUTANTS = [
  {
    id: 'M1',
    why: 'truncateRichText 去掉「不切链接」保护，退回裸切',
    file: 'ClipMate_chrome/src/content/utils/data-formatters.js',
    find: `    var cut = text.slice(0, maxLength);
    var open = cut.lastIndexOf('](');
    // \`](\` 之后找不到 \`)\` = 正好切在 URL 里 → 整条链接不要
    if (open > -1 && cut.indexOf(')', open) === -1) {
      cut = cut.slice(0, open);
    }
    return cut + '...';`,
    replace: `    return text.slice(0, maxLength) + '...';`,
    test: 'tests/bio-truncate.test.js',
    expect: '切点在 URL 内 → 输出里没有半截链接'
  },
  {
    id: 'M2',
    why: '人物分支整块拿掉，全站一律 500',
    file: 'ClipMate_chrome/src/content/utils/data-processors.js',
    find: `      var richTruncate = global.DataFormatters && global.DataFormatters.truncateRichText;
      if (isPersonRecord(data) && typeof richTruncate === 'function') {
        data['简介'] = richTruncate(data['简介'], 5000);
      } else {
        data['简介'] = this.truncateText(data['简介'], 500);
      }`,
    replace: `      data['简介'] = this.truncateText(data['简介'], 500);`,
    test: 'tests/bio-truncate.test.js',
    expect: '人物简介一字不丢（长度与原文一致）'
  },
  {
    id: 'M3',
    why: '上限 5000 改成 500（等于没放宽，但链接保护还在）',
    file: 'ClipMate_chrome/src/content/utils/data-processors.js',
    find: `richTruncate(data['简介'], 5000)`,
    replace: `richTruncate(data['简介'], 500)`,
    test: 'tests/bio-truncate.test.js',
    expect: '人物简介一字不丢（长度与原文一致）'
  },
  {
    id: 'M4',
    why: 'isPersonRecord 恒为真（把所有类型当人物放行）',
    file: 'ClipMate_chrome/src/content/utils/data-processors.js',
    find: `  function isPersonRecord(data) {
    if (!data || typeof data !== 'object') return false;`,
    replace: `  function isPersonRecord(data) {
    return true;
    if (!data || typeof data !== 'object') return false;`,
    test: 'tests/bio-truncate.test.js',
    expect: '影视简介仍截到 500 字 + 省略号'
  },
  {
    id: 'M5',
    why: '账号名正则退回贪婪（会把 IP属地 的 IP 吃掉）',
    file: 'ClipMate_chrome/src/content/extractors/douyin-profile.js',
    find: `/抖音号[：:]\\s*([A-Za-z0-9_.\\-]{1,64}?)(?=\\s|IP属地|关注|粉丝|获赞|$)/`,
    replace: `/抖音号[：:]\\s*([A-Za-z0-9_.\\-]+)/`,
    test: 'tests/douyin-profile.test.js',
    expect: '账号名不吃「IP属地」的 IP（真机形态：两行挨着）'
  },
  {
    id: 'M6',
    why: '简介 从话题清理字段表里拿掉（签名里的 #话题 又变豁免）',
    file: 'ClipMate_chrome/src/content/utils/social-hashtag-cleaner.js',
    find: `['本页文案', '本页标题', '简介'].forEach`,
    replace: `['本页文案', '本页标题'].forEach`,
    test: 'tests/social-hashtag-cleaner.test.js',
    expect: '人物简介里的话题去井号（#话题 不豁免）'
  },
  {
    id: 'M7',
    why: 'content-main 的门禁去掉 person（人物简介根本走不到清理）',
    file: 'ClipMate_chrome/src/content/content-main.js',
    find: `if ((mediaType === 'social' || mediaType === 'person') && typeof SocialHashtagCleaner !== 'undefined') {`,
    replace: `if (mediaType === 'social' && typeof SocialHashtagCleaner !== 'undefined') {`,
    test: 'tests/social-hashtag-cleaner.test.js',
    expect: '对社交站与人物档案生效（v2.7.15 起把 person 并进来，其他类型不碰）'
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
  const hit = r.out.indexOf('✗ ' + m.expect) > -1 || r.out.indexOf(m.expect) > -1;
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
for (const t of ['tests/bio-truncate.test.js', 'tests/douyin-profile.test.js']) {
  const r = runTest(t);
  console.log((r.code === 0 ? '✓ 绿' : '✗ 红') + ' ' + t);
  if (r.code !== 0) allRed = false;
}
console.log(allRed ? `\n结果：${MUTANTS.length} 个变异全部变红，源码逐字节还原，测试全绿` : '\n结果：有问题，见上');
process.exit(allRed ? 0 : 1);
