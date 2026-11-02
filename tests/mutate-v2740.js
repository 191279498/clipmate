#!/usr/bin/env node
/**
 * v2.7.40 变异测试：v2.7.39 真机验收揪出来的三个漏洞
 *
 * 换来的是三条真机事故（都在 2026-11-01 换装后当场复现）：
 *   A. 搜索页 `s.weibo.com` 上一颗按钮都不少，点下去**浮窗 6 列全空**
 *      —— 搜索页缺 media-detector / background / extractor-factory 三处配置，
 *         按整页通用提取跑了。
 *   B. 作者主页 `weibo.com/u/<uid>` 点博文按钮同样空表
 *      —— 整页类型是 person，按地址匹配选到人物档案提取器，它不认识 feedPost。
 *   C. 超话帖标题写成 `7771047739美依礼芽…`
 *      —— 超话帖 header 没有 aria-label，昵称读成空，只能拿 UID 顶上。
 *
 * 九条变异，每条都必须红。规矩同前：改坏必须红、逐字节还原、find 必须唯一、
 * 挂死不算红（框架里有超时判 -2）。
 *
 * 用法：
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules node tests/mutate-v2740.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../ClipMate_chrome');
const CONTEXT = 'src/content/shared/weibo-feed-context.js';
const HANDLER = 'src/content/ui/weibo-spa-handler.js';
const MAIN = 'src/content/content-main.js';
const DETECTOR = 'src/content/utils/media-detector.js';
const FACTORY = 'src/content/utils/extractor-factory.js';
const BACKGROUND = 'src/background/background.js';
const BRIDGE = 'src/content/weibo-mobile-bridge.js';

const TEST = path.join(__dirname, 'weibo-feed-post.test.js');

const MUTATIONS = [
  {
    name: '① 删掉超话帖的昵称兜底 → 昵称读成空，标题拿 UID 顶上',
    file: CONTEXT,
    find: [
      '    if (!nick) {',
      '      var owners = header.querySelectorAll(\'a[href]\');'
    ].join('\n'),
    repl: '    if (false) {   // 变异：超话帖兜底不再执行'
  },
  {
    name: '② 兜底不比对 uid → 把「转发来源」当作者',
    file: CONTEXT,
    find: "        if (!own || own[1] !== match[1]) continue;",
    repl: '        if (!own) continue;'
  },
  {
    name: '③ 点按钮不传 forceMediaType → 作者主页上走人物档案提取器（空表）',
    file: HANDLER,
    find: [
      '        return await this.handleExtract({',
      '          feedPost: { container: container, post: post },',
      "          forceMediaType: 'social'",
      '        });'
    ].join('\n'),
    repl: '        return await this.handleExtract({ feedPost: { container: container, post: post } });'
  },
  {
    name: '④ 强制类型挪到 URL 匹配之后 → 一律被 person 规则抢走',
    file: MAIN,
    find: [
      '      // 强制类型优先：直接用「域名 + 指定类型」查表，跳过地址匹配',
      '      if (forcedMediaType) {',
      '        extractor = this.extractorFactory.getExtractor(hostname, forcedMediaType);',
      '      }',
      '',
      '      // 首先尝试通过URL模式匹配获取提取器（支持路径级别的区分）',
      '      if (!extractor) {',
      '        extractor = this.extractorFactory.getExtractorByUrl(window.location.href);',
      '      }'
    ].join('\n'),
    repl: [
      '      // 首先尝试通过URL模式匹配获取提取器（支持路径级别的区分）',
      '      if (!extractor) {',
      '        extractor = this.extractorFactory.getExtractorByUrl(window.location.href);',
      '      }',
      '',
      '      // 变异：强制类型挪到了 URL 匹配之后',
      '      if (forcedMediaType) {',
      '        extractor = this.extractorFactory.getExtractor(hostname, forcedMediaType);',
      '      }'
    ].join('\n')
  },
  {
    name: '⑤ forcedMediaType 不覆盖 mediaType → processData 仍按人物档案跑',
    file: MAIN,
    find: '      const mediaType = forcedMediaType || this.detectMediaType();',
    repl: '      const mediaType = this.detectMediaType();'
  },
  {
    name: '⑥ media-detector 少了 s.weibo.com → 搜索页探测不出类型',
    file: DETECTOR,
    find: [
      "      's.weibo.com': {",
      "        type: 'social',",
      "        patterns: ['/']",
      '      },',
      "      'm.weibo.cn': {"
    ].join('\n'),
    repl: "      'm.weibo.cn': {"
  },
  {
    name: '⑦ media-detector 的 hostname 特判漏了 s.weibo.com',
    file: DETECTOR,
    find: "    } else if (hostname === 'www.weibo.com' || hostname === 'weibo.com' || hostname === 's.weibo.com') {",
    repl: "    } else if (hostname === 'www.weibo.com' || hostname === 'weibo.com') {"
  },
  {
    name: '⑧ background 的 getMediaConfigs 少了 s.weibo.com',
    file: BACKGROUND,
    find: [
      "      's.weibo.com': {",
      "        type: 'social',",
      "        patterns: ['/']",
      '      },',
      "      'm.weibo.cn': {"
    ].join('\n'),
    repl: "      'm.weibo.cn': {"
  },
  {
    name: '⑨ extractor-factory 注册表少了 s.weibo.com → 拿不到微博提取器',
    file: FACTORY,
    find: [
      "      { hostname: 'weibo.com', types: ['social'] },",
      '      // v2.7.40：搜索页独立域名。漏了这条的后果是搜索页落回工厂兜底，',
      '      // 点逐帖按钮时根本拿不到微博提取器（浮窗 6 列全空）。',
      "      { hostname: 's.weibo.com', types: ['social'] }"
    ].join('\n'),
    repl: "      { hostname: 'weibo.com', types: ['social'] }"
  },
  {
    name: '⑩ extractor-factory 的 urlPattern 少了 s.weibo.com',
    file: FACTORY,
    find: [
      '      // v2.7.40：搜索页 `s.weibo.com` 必须排在**所有** `weibo.com` 规则之前。',
      '      // 因为它自身也含 `weibo.com/` 这段字符，排后面会被 `weibo.com/u/…` 之类的',
      '      // person 规则先吃掉（搜索页没有主页，但通配规则照样会命中）。',
      "      { pattern: /s\\.weibo\\.com\\//, hostname: 's.weibo.com', mediaType: 'social' },"
    ].join('\n'),
    repl: '      // 变异：搜索页 urlPattern 整条删掉'
  },
  {
    name: '⑪ 手机版桥不把 HTML 文案转纯文本 → 标题写成 ahrefhttpsm…',
    file: BRIDGE,
    find: "      text: htmlToText(item.text).slice(0, MAX_TEXT)",
    repl: "      text: String(item.text || '').slice(0, MAX_TEXT)"
  }
];

let red = 0;
const problems = [];

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runTest(file) {
  const r = spawnSync(process.execPath, [file], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 180000,
    env: Object.assign({}, process.env, {
      NODE_PATH: 'C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules'
    })
  });
  const text = (r.stdout || '') + (r.stderr || '');
  if (r.error && r.error.code === 'ETIMEDOUT') return { code: -2, text };
  return { code: r.status === null ? -2 : r.status, text };
}

function failedItems(text) {
  return String(text)
    .split('\n')
    .filter((l) => l.indexOf('✗') > -1 || l.indexOf('❌') > -1)
    .slice(0, 4)
    .map((l) => l.trim());
}

/** CRLF 适配（这几个文件都是 LF，但保留这道保险） */
function shape(text, src) {
  if (typeof text !== 'string') return text;
  return /\r\n/.test(src) ? text.replace(/\n/g, '\r\n') : text;
}

console.log('v2.7.40 变异测试 —— ' + MUTATIONS.length + ' 条\n');

MUTATIONS.forEach((m) => {
  const target = path.join(ROOT, m.file);
  const orig = { buf: fs.readFileSync(target) };
  orig.hash = sha(orig.buf);
  const src = orig.buf.toString('utf8');
  const find = shape(m.find, src);
  const repl = shape(m.repl, src);

  if (src.indexOf(find) === -1) {
    problems.push(`${m.name} → 变异点不存在（find 没命中）`);
    console.log(`  ⚠️  ${m.name}\n      变异点不存在`);
    return;
  }
  if (src.indexOf(find) !== src.lastIndexOf(find)) {
    problems.push(`${m.name} → find 不唯一（replace 只会改第一处）`);
    console.log(`  ⚠️  ${m.name}\n      find 不唯一`);
    return;
  }

  fs.writeFileSync(target, src.replace(find, () => repl));
  const r = runTest(TEST);
  fs.writeFileSync(target, orig.buf);

  if (sha(fs.readFileSync(target)) !== orig.hash) {
    problems.push(`${m.name} → 还原失败（sha256 不一致）`);
    console.log(`  ❌ ${m.name}\n      还原失败`);
    return;
  }

  if (r.code === 0) {
    problems.push(`${m.name} → 改坏了还是绿的（断言没咬住）`);
    console.log(`  ❌ ${m.name}\n      改坏后仍绿`);
    return;
  }
  if (r.code === -2) {
    problems.push(`${m.name} → 挂死/超时，不算红`);
    console.log(`  ❌ ${m.name}\n      挂死，不算红`);
    return;
  }

  red++;
  console.log(`  ✅ ${m.name}`);
  failedItems(r.text).forEach((l) => console.log(`       ${l}`));
});

console.log('');
if (problems.length) {
  console.log(`结论：${red}/${MUTATIONS.length} 条咬住，${problems.length} 个问题`);
  problems.forEach((p) => console.log('  - ' + p));
  process.exit(1);
}
console.log(`结论：${red}/${MUTATIONS.length} 条改坏后全部变红，且逐字节还原`);
process.exit(0);
