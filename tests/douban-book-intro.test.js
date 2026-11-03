/**
 * 豆瓣书籍简介 + og: 兜底键优先级（v2.8.3）—— 契约测试
 *
 * 【这版修的是什么】
 *   用户把设置页「其他简介」改成 0（不限制），豆瓣书籍页提取出来的简介还是「不完整、结尾有 …」。
 *   查下去发现跟那个设置根本无关，是两个老问题叠在一起：
 *
 *   ① 豆瓣把简介在 DOM 里放了两份：
 *        <span class="short">      默认显示的折叠摘要（末尾自带 ... 和「(展开全部)」）
 *        <span class="all hidden"> 完整正文
 *      老实现从 #link-report 往下找第一个 .intro，命中的永远是短摘要。
 *
 *   ② 页面 <meta property="og:description"> 里是豆瓣服务端截断过的摘要（实测 103 字 + ...）。
 *      字段映射按「后写赢」，而 og:description 在数据里排在最后，会把提取器抠到的简介整段盖掉。
 *      → 所以无论上限设 500 还是 0，看到的都是同一段 103 字摘要。
 *
 * 【本测试钉什么】
 *   一、书籍简介取的是完整正文（不是短摘要），且清掉了「(展开全部)」和内嵌 CSS；
 *   二、简介不再等于 og:description 那份摘要，也不许把 og:* 透传成多出来的列；
 *   三、og: 作为兜底的职责还在：目标字段为空时它仍要能补上；
 *   四、「其他简介」上限照常生效：500 截断 / 0 全文。
 *
 * 测的是真实现：真页面存档 → jsdom → 按 manifest 顺序注入全部内容脚本 → 走「点按钮」链路。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const env = require('./lib/env');
const H = require('./lib/harness');

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };
let pass = 0;
const fails = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(C.green + '  ✓ ' + C.reset + name + (extra !== undefined && process.env.VERBOSE ? C.dim + '  → ' + extra + C.reset : ''));
  } else {
    fails.push(name + (extra !== undefined ? '（实际：' + String(extra).slice(0, 160) + '）' : ''));
    console.log(C.red + '  ✗ ' + name + C.reset + (extra !== undefined ? C.dim + '  → ' + String(extra).slice(0, 160) + C.reset : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  ok(name, a === b, a === b ? undefined : a + ' ≠ ' + b);
}

function section(t) {
  console.log('\n' + C.bold + t + C.reset);
}

const URL_BOOK = 'https://book.douban.com/subject/1084336/';
const HTML_BOOK = path.join(__dirname, 'fixtures/html/douban-book-1084336.html');

/** 起一个页面并跑完整真实链路，返回 { data, ogDesc, ogTitle } */
async function extractPage(mediaConfigs, otherLimit) {
  const html = fs.readFileSync(HTML_BOOK, 'utf8');
  const page = await H.openPage({
    url: URL_BOOK,
    html,
    mediaConfigs,
    config: {
      autoExtract: false,
      autoCopy: false,
      showButton: true,
      settings: { enableCache: true, descLimits: { social: 50000, person: 5000, other: otherLimit } }
    }
  });
  const inst = await H.waitForInit(page);
  const doc = page.window.document;
  const ogDesc = (doc.querySelector('meta[property="og:description"]') || {}).content || '';
  const ogTitle = (doc.querySelector('meta[property="og:title"]') || {}).content || '';
  const r = await H.runRealPath(page, inst);
  const out = { data: r.data || {}, ogDesc, ogTitle, bridge: page.bridge, window: page.window };
  try { page.window.close(); } catch (e) { /* ignore */ }
  return out;
}

async function main() {
  console.log(C.bold + '\n豆瓣书籍简介与 og: 兜底优先级（v2.8.3）' + C.reset);
  const mediaConfigs = await env.loadBackgroundMediaConfigs();

  /* ============ 一、默认 500：取完整正文，而不是短摘要 ============ */
  section('一、默认上限 500 —— 简介取的是完整正文');

  const a = await extractPage(mediaConfigs, 500);
  const d1 = a.data['简介'] || '';

  ok('页面 og:description 确实是「短摘要」（结尾带 ...，本测试的前提）',
    a.ogDesc.length > 50 && a.ogDesc.endsWith('...'), a.ogDesc.length + ' 字');
  ok('简介不再等于 og:description 那份摘要', d1 !== a.ogDesc, '简介 ' + d1.length + ' 字');
  eq('默认上限仍然是 500 字（截断后 500 + ...）', d1.length, 503);
  ok('以 ... 结尾（这是 500 上限截的，不是页面摘要自带的）', d1.endsWith('...'));
  ok('含完整正文才有的「六个行星，各种见闻」', d1.indexOf('六个行星，各种见闻') !== -1);
  ok('含短摘要里根本不会出现的「B612」', d1.indexOf('B612') !== -1,
    '短摘要止于「飞行员一...」，到不了 B612');
  ok('不含「(展开全部)」这个链接文本', d1.indexOf('展开全部') === -1);
  ok('不含内嵌的 CSS 源码（text-indent）', d1.indexOf('text-indent') === -1);
  ok('没有把 og:title 透传成多出来的一列', !Object.prototype.hasOwnProperty.call(a.data, 'og:title'),
    Object.keys(a.data).join(','));
  ok('没有把 og:description 透传成多出来的一列', !Object.prototype.hasOwnProperty.call(a.data, 'og:description'));
  eq('书名仍是提取器自己抓到的值（没被 og:title 盖住）', a.data['书名'], a.ogTitle || a.data['书名']);

  /* ============ 二、改成 0 = 不限制：全文，且结尾没有省略号 ============ */
  section('二、上限改成 0（不限制）—— 全文拿到，结尾没有 …');

  const b = await extractPage(mediaConfigs, 0);
  const d2 = b.data['简介'] || '';

  eq('整段简介一字不砍（628 字）', d2.length, 628);
  ok('不以 ... 结尾', !d2.endsWith('...'), JSON.stringify(d2.slice(-20)));
  ok('结尾是正文最后一句「著名的一部童话小说。」', d2.endsWith('著名的一部童话小说。'));
  ok('含最后一段才有的「不仅赢得了儿童读者」', d2.indexOf('不仅赢得了儿童读者') !== -1);
  eq('按段落拼成 4 段（换行连接）', d2.split('\n').length, 4);

  /* ============ 三、og: 兜底的职责不能丢 ============ */
  section('三、og: 仍是兜底来源 —— 目标字段为空时必须补上');

  const Mapper = (a.bridge && a.bridge.UniversalFieldMapper) || null;
  ok('拿到真实的 UniversalFieldMapper 类', typeof Mapper === 'function');

  if (typeof Mapper === 'function') {
    // 站点名故意用一个不存在的，走「媒体类型默认映射」这条路（与未知站点一致）
    const m = new Mapper('book');
    const raw = {
      '书名': '某本书',
      '简介': '这是提取器抠到的正文',
      'og:description': '这是 meta 里的摘要...',
      'og:title': 'meta 书名'
    };
    const mapped = m.mapToUniversalFields(raw, '__no_such_site__');
    eq('有正文时 og:description 不许覆盖', mapped['简介'], '这是提取器抠到的正文');
    eq('有书名时 og:title 不许覆盖', mapped['书名'], '某本书');
    ok('被跳过的 og: 键不会变成新列',
      !Object.prototype.hasOwnProperty.call(mapped, 'og:description') &&
      !Object.prototype.hasOwnProperty.call(mapped, 'og:title'),
      Object.keys(mapped).join(','));

    // 反过来：目标为空时 og: 必须能兜底，否则「兜底」这层就白写了
    const m2 = new Mapper('book');
    const mapped2 = m2.mapToUniversalFields({ '书名': '某本书', 'og:description': 'meta 摘要...' }, '__no_such_site__');
    eq('简介为空时 og:description 照常兜底', mapped2['简介'], 'meta 摘要...');

    const m3 = new Mapper('book');
    const mapped3 = m3.mapToUniversalFields({ 'og:title': '只有 meta 的书名' }, '__no_such_site__');
    eq('书名全缺时 og:title 照常兜底', mapped3['书名'], '只有 meta 的书名');
  }

  /* ============ 汇总 ============ */
  console.log('\n' + '─'.repeat(56));
  if (fails.length) {
    console.log(C.red + '❌ 失败 ' + fails.length + ' 项 / 共 ' + (pass + fails.length) + ' 项' + C.reset);
    fails.forEach((f) => console.log('   · ' + f));
    process.exitCode = 1;
  } else {
    console.log(C.green + '✅ 全部通过：' + pass + ' 项' + C.reset);
  }
}

main().catch((err) => {
  console.error(C.red + '测试崩溃：' + C.reset, err);
  process.exitCode = 1;
});
