'use strict';
/**
 * 变异测试：把 v2.7.16「小红书个人主页」的每处实现逐个改坏，确认对应断言真的会红，然后逐字节还原。
 *
 * 纪律（踩过六次假绿的教训）：
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

const MUTANTS = [
  {
    id: 'M1',
    why: '桥改读 userInfo（登录者自己）而不是 userPageData（页面主人）—— 一级事故',
    file: 'ClipMate_chrome/src/content/xiaohongshu-page-data.js',
    find: `      var up = unwrap(userBox.userPageData);`,
    replace: `      var up = unwrap(userBox.userInfo);`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '桥代码里没有 userInfo'
  },
  {
    id: 'M2',
    why: '桥去掉 urlUserId 闸口（SPA 换人时会拿上一个人的数据）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `      if (!curId || !payload || payload.urlUserId !== curId) return null;`,
    replace: `      if (!payload) return null;`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '签名没被桥带跑（用 DOM 那份）'
  },
  {
    id: 'M3',
    why: '网址退回 location.href（把会过期的 xsec_token 存进档案）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `      return 'https://www.xiaohongshu.com/user/profile/' + id;`,
    replace: `      return String(location.href || '');`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '主页 extractUrl() 直接就返回干净地址（不依赖下游）'
  },
  {
    id: 'M4',
    why: '统计行把「关注」当成粉丝（数字错位）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `        if (name.indexOf('粉丝') > -1) out.fans = value;`,
    replace: `        if (name.indexOf('关注') > -1) out.fans = value;`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '第一行是统计行'
  },
  {
    id: 'M5',
    why: '标签区从简介里拿掉（用户 2026-10-30 拍板要留）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `      return [stats, sign, tags].filter(Boolean).join('\\n');`,
    replace: `      return [stats, sign].filter(Boolean).join('\\n');`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '末行是标签区（空格连接）'
  },
  {
    id: 'M6',
    why: '签名只用 DOM（长简介会被页面截断，丢内容）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `    if (p && p.desc) return p.desc;
    return this._textOf('.user-desc');`,
    replace: `    return this._textOf('.user-desc');`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '签名走桥里的**完整版**（含第三段「耐力骑行」，DOM 里没有）'
  },
  {
    id: 'M7',
    why: 'url-normalizer 去掉主页分支（主页网址会被规范成空串）',
    file: 'ClipMate_chrome/src/content/shared/url-normalizer.js',
    find: `    const home = p.match(/^\\/user\\/profile\\/([0-9a-fA-F]{16,32})$/i);
    if (home) return 'https://www.xiaohongshu.com/user/profile/' + home[1];

`,
    replace: ``,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '小红书规则函数单独认主页路径'
  },
  {
    id: 'M8',
    why: 'spa-handler 主页路由键返回空（按钮被当成列表页藏掉）',
    file: 'ClipMate_chrome/src/content/ui/xiaohongshu-spa-handler.js',
    find: `      var uid = this._xhsProfileIdFromHref(href);
      if (uid) return 'profile:' + uid;`,
    replace: `      var uid = null;
      if (uid) return 'profile:' + uid;`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '主页路由键非空（= 按钮会出）'
  },
  {
    id: 'M9',
    why: 'media-detector 删掉小红书 person 规则（主页判不出人物档案）',
    file: 'ClipMate_chrome/src/content/utils/media-detector.js',
    find: `          { type: 'person', patterns: ['/user/profile/'] },
          { type: 'social', patterns: ['/discovery/item/', '/explore/'] }`,
    replace: `          { type: 'social', patterns: ['/discovery/item/', '/explore/'] }`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: 'media-detector 有小红书 person 规则'
  },
  {
    id: 'M10',
    why: '账号ID 拿小红书号顶替（跟作品页作者ID join 不上）',
    file: 'ClipMate_chrome/src/content/extractors/xiaohongshu-profile.js',
    find: `      return this._urlUserId();`,
    replace: `      return this._stripPrefix(this._textOf('.user-redId'), '小红书号');`,
    test: 'tests/xiaohongshu-profile.test.js',
    expect: '账号ID = 地址栏 userId'
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
const t = 'tests/xiaohongshu-profile.test.js';
const r = runTest(t);
console.log((r.code === 0 ? '✓ 绿' : '✗ 红') + ' ' + t);
if (r.code !== 0) allRed = false;
console.log(allRed ? `\n结果：${MUTANTS.length} 个变异全部变红，源码逐字节还原，测试全绿` : '\n结果：有问题，见上');
process.exit(allRed ? 0 : 1);
