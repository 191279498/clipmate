/**
 * 「无文案」占位词不得出现在标题里（v2.7.9）
 *
 * 用户规则（2026-10-29）
 * ----------------------
 * 社交站抓不到文案时，「本页文案」填「站名+形态」（TikTok视频 / Instagram帖子 …），
 * **标题也必须用同一个词**，不许出现内部占位词「无文案」。
 *
 * 真机报障（2026-10-30，IG 作者主页 → 第一个帖子）
 * ------------------------------------------------
 * 浮窗：本页文案=Instagram帖子（对）、本页标题=`realyami无文案-2026年10月27日`（错，出现占位词）。
 *
 * 根因
 * ----
 * `social-fields-builder.js` 的 `rebuildTitleWith()` 把「取文案」的方法临时替换成
 * **异步**箭头（`() => Promise.resolve(fallbackText)`），然后重跑一次标题。
 *   · 抖音 / 小红书 / 快手 / 微博 / B站 的 `extractTitle` 是 `async` 且 `await this.extractPageText()`
 *     → 拿到字符串 → 重建成功；
 *   · IG / TikTok / X / YouTube 的 `extractTitle` 是**同步**调用
 *     → 拿到 Promise → `processPageText` 里 `pageText.trim()` 抛 TypeError
 *     → 被各站 extractTitle 的 try/catch 吞掉、返回空串 → 重建结果为空 → 不覆盖 → 标题保留「无文案」。
 *
 * 所以是「规则只改了一半」：异步写法的站生效，同步写法的站漏了。
 *
 * 本文件钉住的契约
 * ----------------
 *   A. 同步写法的站（IG/TikTok/X/YouTube）：空文案 → 标题必须含站名词、**不得含「无文案」**
 *   B. 异步写法的站（抖音风格）：同样正确（防止修改把这几个站弄坏）
 *   C. 文案非空：标题一个字都不许被兜底词污染
 *   D. 站名表里没有的站：标题保持原样（不硬凑）
 *
 * 反向验证（必须变红）：把 `rebuildTitleWith` 里的替换函数改回 `() => Promise.resolve(x)`，
 * A 节四条全部变红。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const BUILDER_PATH = path.join(ROOT, 'src/content/shared/social-fields-builder.js');
const SocialSiteNames = require(path.join(ROOT, 'src/content/shared/social-site-names.js'));
const { SocialTitleProcessor } = require(path.join(ROOT, 'src/content/shared/social-title-processor.js'));

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', cyan: '\x1b[36m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (arguments.length < 2) throw new Error('ok(name, cond) 必须传两个参数: ' + name);
  if (typeof cond !== 'boolean') throw new Error('ok() 第二参数必须是布尔: ' + name);
  if (cond) {
    pass++;
    console.log(`  ${C.green}✓${C.reset} ${name}`);
  } else {
    fail++;
    const extra = detail === undefined ? '' : ' → ' + JSON.stringify(detail);
    failures.push(name + extra);
    console.log(`  ${C.red}✗ ${name}${C.reset}${extra}`);
  }
}
function eq(name, got, want) {
  ok(name, got === want, got === want ? undefined : { actual: got, expected: want });
}
function section(t) { console.log(`\n${C.cyan}${t}${C.reset}`); }

/** 在 vm 沙箱里加载装配器（与真实浏览器一样只有 window 这一个全局入口） */
function loadBuilder(href) {
  const win = { location: { href: href || 'https://www.instagram.com/p/AAAA1111/' } };
  win.SocialSiteNames = SocialSiteNames;
  const sandbox = { window: win, console: console };
  sandbox.module = { exports: {} };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(BUILDER_PATH, 'utf8'), ctx, { filename: BUILDER_PATH });
  return sandbox.module.exports;
}

/**
 * 造一个「同步标题」的提取器 —— IG / TikTok / X / YouTube 都是这种写法：
 * `extractTitle()` 内部**不 await** 地调 `this.extractPageText()`。
 *
 * @param {string} site - sourceSite，例如 instagram_social
 * @param {string} text - 文案（空串表示这条没文案）
 */
function makeSyncExtractor(site, text) {
  return {
    siteName: site,
    extractPageText() { return text; },
    extractTitle() {
      try {
        // 关键：这里同步取，不 await —— 真实 IG 就是 `const text = this.extractPageText(context)`
        const pageText = this.extractPageText();
        return SocialTitleProcessor.generatePageTitle('某人', pageText, '2026/10/27', {}, 'someone');
      } catch (e) {
        // 真实 IG 的 extractTitle 有 try/catch，异常时返回空串（这正是「无文案」留下来的原因）
        return '';
      }
    },
    extractAuthorId() { return 'someone'; },
    extractAuthorName() { return '某人'; },
    extractAuthorHomepage() { return 'https://www.instagram.com/someone/'; },
    extractPublishDate() { return '2026/10/27'; },
    extractUrl() { return 'https://www.instagram.com/p/AAAA1111/'; }
  };
}

/** 造一个「异步标题」的提取器 —— 抖音 / 小红书 / 快手 / 微博 / B站 是这种写法 */
function makeAsyncExtractor(site, text) {
  return {
    siteName: site,
    async extractPageText() { return text; },
    async extractTitle() {
      const pageText = await this.extractPageText();
      return SocialTitleProcessor.generatePageTitle('某人', pageText, '2026/10/27', {}, 'someone');
    },
    extractAuthorId() { return 'someone'; },
    extractAuthorName() { return '某人'; },
    extractAuthorHomepage() { return 'https://www.douyin.com/user/someone'; },
    extractPublishDate() { return '2026/10/27'; },
    extractUrl() { return 'https://www.douyin.com/video/1'; }
  };
}

(async () => {
  const B = loadBuilder();

  /* ================= A. 同步写法的站：标题不许出现「无文案」 ================= */
  section('A. 同步标题写法的站：空文案 → 标题用站名词（IG/TikTok/X/YouTube）');

  const syncCases = [
    ['instagram_social', 'Instagram帖子'],
    ['tiktok_social', 'TikTok视频'],
    ['x_social', 'X推文'],
    ['youtube_social', 'YouTube视频']
  ];

  for (const [site, label] of syncCases) {
    const data = await B.build(makeSyncExtractor(site, ''));
    eq(`[A] ${site} 本页文案=站名词`, String(data['本页文案'] || ''), label);
    eq(`[A] ${site} 标题里没有「无文案」`, String(data['本页标题'] || '').indexOf('无文案'), -1);
    ok(`[A] ${site} 标题里带了站名词`, String(data['本页标题'] || '').indexOf(label) > -1,
      String(data['本页标题'] || ''));
  }

  /* ================= B. 异步写法：不能被弄坏 ================= */
  section('B. 异步标题写法的站（抖音风格）：同样用站名词');

  for (const [site, label] of [['douyin_social', '抖音视频'], ['xiaohongshu_social', '小红书笔记']]) {
    const data = await B.build(makeAsyncExtractor(site, ''));
    eq(`[B] ${site} 本页文案=站名词`, String(data['本页文案'] || ''), label);
    eq(`[B] ${site} 标题里没有「无文案」`, String(data['本页标题'] || '').indexOf('无文案'), -1);
    ok(`[B] ${site} 标题里带了站名词`, String(data['本页标题'] || '').indexOf(label) > -1,
      String(data['本页标题'] || ''));
  }

  /* ================= C. 文案非空：标题不许被兜底词污染 ================= */
  section('C. 文案非空：标题保持原样，不许出现兜底词');

  {
    const data = await B.build(makeSyncExtractor('instagram_social', '真实文案内容'));
    eq('[C] 本页文案原样', String(data['本页文案'] || ''), '真实文案内容');
    eq('[C] 标题不含「Instagram帖子」', String(data['本页标题'] || '').indexOf('Instagram帖子'), -1);
    ok('[C] 标题含真实文案', String(data['本页标题'] || '').indexOf('真实文案') > -1,
      String(data['本页标题'] || ''));
  }

  /* ================= D. 词表里没有的站：不硬凑 ================= */
  section('D. 站名表里没有的站：文案与标题都不硬凑');

  {
    const data = await B.build(makeSyncExtractor('unknown_site', ''));
    eq('[D] 本页文案保持空', String(data['本页文案'] || ''), '');
    eq('[D] 标题不含「无文案」以外的兜底词', String(data['本页标题'] || '').indexOf('帖子'), -1);
  }

  /* ================= 汇总 ================= */
  console.log(`\n结果：${pass}/${pass + fail} 通过 — 标题不得出现「无文案」占位词（v2.7.9）`);
  if (fail) {
    console.log('失败明细：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常：' + e.message);
  process.exit(1);
});
