#!/usr/bin/env node
/**
 * 影视类标签统一转化库 · 专项单测（v2.12.0）
 *
 * 【为什么要单独一份，而不是只靠快照】
 * 快照只回答「字段值变没变」，不回答「变得对不对」。这次改动有 17 条拍板，
 * 任何一条落错都会在快照里表现成「一行差异」，人眼看着像正常改动。
 * 所以这里分两段：
 *   第一部分 · 归一器纯函数：44 个标准词、17 条拍板、[] 与未命中的区别、兜底不丢词；
 *   第二部分 · 五站端到端：**从 extractAllFields() / extractSpecificFields() 进**，
 *              用真实页面存档跑整条链路 —— 零件对但没装成整机，这里会红。
 *
 * 【跑法】（项目根目录）
 *   NODE_PATH=C:/Users/19127/.workbuddy/binaries/node/workspace/node_modules \
 *     node tests/movie-tags.test.js
 *   node tests/movie-tags.test.js --pure-only   # 只跑纯函数（秒级，改规则时用）
 *   node tests/movie-tags.test.js --verbose
 *
 * 全部通过退出码 0，有任何失败退出码 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EXT = path.join(ROOT, 'ClipMate_chrome');
const TAGS = require(path.join(EXT, 'src', 'shared', 'tag-normalizer.js'));

const VERBOSE = process.argv.includes('--verbose');
const PURE_ONLY = process.argv.includes('--pure-only');

let pass = 0;
const fails = [];

function eq(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${a}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}\n      得到 ${a}\n      期望 ${b}`);
  }
}

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label}`);
  } else {
    fails.push(label);
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      实际 ${JSON.stringify(detail)}`}`);
  }
}

/** 断言字符串「包含」某段 —— 用于「其他信息里必须有原词」这类 */
function has(label, haystack, needle) {
  const s = String(haystack == null ? '' : haystack);
  ok(label, s.indexOf(needle) >= 0, s.slice(0, 200));
}

function hasNot(label, haystack, needle) {
  const s = String(haystack == null ? '' : haystack);
  ok(label, s.indexOf(needle) < 0, s.slice(0, 200));
}

/** 从「其他信息」里抽出「其他标签：」这一段（到下一个全角逗号分段为止） */
function leftoverSegment(other) {
  const m = /其他标签：([^，]*)/.exec(String(other == null ? '' : other));
  return m ? m[1] : '';
}

/** 一段「A、B、C…（共 N 个）」里实际显示的词数（省略号之后不计） */
function countWordsIn(seg) {
  const s = String(seg == null ? '' : seg);
  if (!s) return 0;
  const cut = s.indexOf('…');
  const body = cut >= 0 ? s.slice(0, cut) : s;
  return body.split('、').filter(Boolean).length;
}

/** 「其他信息」里「其他标签：」那一段实际显示了多少个词 */
function countLeftover(other) {
  return countWordsIn(leftoverSegment(other));
}

const N = (site, words) => TAGS.normalize(site, words);

/* ============================================================
 * 第一部分 · 归一器纯函数
 * ==========================================================*/
function testPure() {
  console.log('\n【一】归一器：标准词表与规则集');

  eq('标准标签 44 个', TAGS.STANDARDS.length, 44);
  eq('第 21 位是「短片」（D1 改名）', TAGS.STANDARDS[20], '短片');
  ok('「短篇」已不在标准词里', TAGS.STANDARDS.indexOf('短篇') < 0);
  eq('归一键冲突数 = 0（有冲突说明两套规则抢同一个词）', TAGS.CONFLICTS.length, 0);
  eq('注入规则：红果全站固定「短剧」', TAGS.INJECT, { '红果短剧': ['短剧'] });

  console.log('\n【二】17 条拍板逐条验收');
  // D1 短篇 → 短片
  eq('D1 Bangumi「短篇」→ 短片', N('Bangumi', '短篇').tags, ['短片']);
  eq('D1 豆瓣「短片」→ 短片', N('豆瓣电影', '短片').tags, ['短片']);
  eq('D1 IMDb「Short」→ 短片', N('IMDb', 'Short').tags, ['短片']);
  // D1 的另一半：OVA/剧场版 不能被当成短片（同行多词只改了「短篇」）
  eq('D1 Bangumi「OVA」只进其他信息', N('Bangumi', 'OVA').tags, []);
  eq('D1 Bangumi「剧场版」只进其他信息', N('Bangumi', '剧场版').tags, []);
  // D2 纪录片 → 纪录
  eq('D2 豆瓣「纪录片」→ 纪录', N('豆瓣电影', '纪录片').tags, ['纪录']);
  // D3 家庭 → 生活
  eq('D3 豆瓣「家庭」→ 生活', N('豆瓣电影', '家庭').tags, ['生活']);
  eq('D3 IMDb「Family」→ 生活', N('IMDb', 'Family').tags, ['生活']);
  eq('D3 红果「都市日常」→ 生活', N('红果短剧', '都市日常').tags, ['生活', '短剧']);
  // D4 黑色电影 → 黑暗
  eq('D4 豆瓣「黑色电影」→ 黑暗', N('豆瓣电影', '黑色电影').tags, ['黑暗']);
  eq('D4 IMDb「Film-Noir」→ 黑暗', N('IMDb', 'Film-Noir').tags, ['黑暗']);
  // D5 悬疑/推理双写
  eq('D5 红果「悬疑推理」→ 悬疑+推理', N('红果短剧', '悬疑推理').tags, ['悬疑', '推理', '短剧']);
  eq('D5 红果「刑侦破案」→ 犯罪+推理', N('红果短剧', '刑侦破案').tags, ['犯罪', '推理', '短剧']);
  eq('D5 IMDb「Mystery」单写悬疑', N('IMDb', 'Mystery').tags, ['悬疑']);
  // D6 同性收百合
  eq('D6 Bangumi「百合」→ 同性', N('Bangumi', '百合').tags, ['同性']);
  eq('D6 Bangumi「耽美」→ 同性', N('Bangumi', '耽美').tags, ['同性']);
  // D7 综艺边界
  eq('D7 豆瓣「真人秀」→ 综艺', N('豆瓣电影', '真人秀').tags, ['综艺']);
  eq('D7 豆瓣「脱口秀」→ 综艺', N('豆瓣电影', '脱口秀').tags, ['综艺']);
  eq('D7 IMDb「News」→ 综艺', N('IMDb', 'News').tags, ['综艺']);
  eq('D7 IMDb「Game-Show」→ 综艺', N('IMDb', 'Game-Show').tags, ['综艺']);
  eq('D7 IMDb「Talk-Show」→ 综艺', N('IMDb', 'Talk-Show').tags, ['综艺']);
  eq('D7 TMDB「Reality」→ 综艺', N('TMDB', 'Reality').tags, ['综艺']);
  // D8 AI剧 是题材
  eq('D8 红果「AI剧」→ AI剧', N('红果短剧', 'AI剧').tags, ['AI剧', '短剧']);
  // D9 短剧固定注入
  eq('D9 红果空标签也带「短剧」', N('红果短剧', []).tags, ['短剧']);
  eq('D9 红果「真人剧」→ 短剧', N('红果短剧', '真人剧').tags, ['短剧']);
  // D16 漫剧 → AI剧+短剧（第二轮拍板）
  eq('D16 红果「漫剧」→ AI剧+短剧', N('红果短剧', '漫剧').tags, ['AI剧', '短剧']);
  // 第二轮：Superhero/青春/肉番
  eq('D12 IMDb「Superhero」→ 奇幻', N('IMDb', 'Superhero').tags, ['奇幻']);
  eq('D13 Bangumi「青春」→ 校园', N('Bangumi', '青春').tags, ['校园']);
  eq('D14 Bangumi「肉番」→ 成人', N('Bangumi', '肉番').tags, ['成人']);

  console.log('\n【三】查表语义：[] 与「未命中」绝不能混');
  // 「脑洞」是已知但不并（D10）→ 进 others，但**不算 unknown**
  const bored = N('红果短剧', '脑洞');
  eq('D10 红果「脑洞」不进标签', bored.tags, ['短剧']);
  eq('D10 红果「脑洞」进其他信息', bored.others, ['脑洞']);
  eq('D10 已知词不算「未命中」', bored.unknown, []);
  // 真未命中的新词 → others + unknown 都有
  const fresh = N('红果短剧', '量子穿越爽剧');
  eq('D11 未命中词不进标签', fresh.tags, ['短剧']);
  eq('D11 未命中词原样进其他信息', fresh.others, ['量子穿越爽剧']);
  eq('D11 未命中词记在 unknown 里', fresh.unknown, ['量子穿越爽剧']);
  // 空值不能变成 NaN / undefined
  eq('空输入不炸', N('豆瓣电影', '').tags, []);
  eq('null 输入不炸', N('豆瓣电影', null).tags, []);

  console.log('\n【四】标准词恒直通（UGC 站的词永远补不完）');
  // Bangumi 的「犯罪」不在词表里（规则集只收了有近义关系的词），
  // 但它本身就是标准词 —— 必须命中，否则标签列空着、原词掉进其他信息。
  // 实测出处：bgm-64965《教父》页面标签区写的就是「犯罪」。
  ok('「犯罪」是标准词', TAGS.isStandard('犯罪'));
  eq('Bangumi「犯罪」直通命中', N('Bangumi', '犯罪').tags, ['犯罪']);
  eq('Bangumi「犯罪」不再掉进其他信息', N('Bangumi', '犯罪').others, []);
  eq('豆瓣 28 类字面直通：剧情', N('豆瓣电影', '剧情').tags, ['剧情']);
  eq('豆瓣 28 类字面直通：西部', N('豆瓣电影', '西部').tags, ['西部']);

  console.log('\n【五】写法容错：大小写 / 连字符 / 分隔符');
  eq('IMDb「SCI-FI」大小写不敏感', N('IMDb', 'SCI-FI').tags, ['科幻']);
  eq('IMDb「Sci Fi」空格写法', N('IMDb', 'Sci Fi').tags, ['科幻']);
  eq('IMDb「film noir」小写+空格', N('IMDb', 'film noir').tags, ['黑暗']);
  eq('TMDB「TV Movie」空格写法', N('TMDB', 'TV Movie').tags, []);
  eq('TMDB「Action & Adventure」拆双写', N('TMDB', 'Action & Adventure').tags, ['动作', '冒险']);
  eq('「剧情 / 犯罪」斜杠分隔', N('TMDB', '剧情 / 犯罪').tags, ['剧情', '犯罪']);
  eq('「剧情,犯罪」半角逗号', N('豆瓣电影', '剧情,犯罪').tags, ['剧情', '犯罪']);
  eq('「剧情、犯罪」顿号', N('豆瓣电影', '剧情、犯罪').tags, ['剧情', '犯罪']);
  eq('数组输入', N('IMDb', ['Action', 'Drama']).tags, ['动作', '剧情']);
  eq('去重保序', N('豆瓣电影', ['剧情', '犯罪', '剧情']).tags, ['剧情', '犯罪']);

  console.log('\n【六】站点别名');
  eq('域名也能查：movie.douban.com', N('movie.douban.com', '纪录片').tags, ['纪录']);
  eq('域名也能查：www.imdb.com', N('www.imdb.com', 'Drama').tags, ['剧情']);
  eq('域名也能查：novelquickapp.com（红果子域）', N('www.novelquickapp.com', '漫剧').tags, ['AI剧', '短剧']);

  console.log('\n【七】生成物与规则集一致（防止改了 JSON 忘了重生成 js）');
  const ruleset = JSON.parse(fs.readFileSync(path.join(ROOT, '影视类标签转化库_ruleset_v1.0.json'), 'utf8'));
  eq('标准词与规则集一致', TAGS.STANDARDS, ruleset.standards);
  const rulesetWords = Object.keys(ruleset.lookup).reduce((n, s) => n + Object.keys(ruleset.lookup[s]).length, 0);
  const jsWords = Object.keys(TAGS.LOOKUP).reduce((n, s) => n + Object.keys(TAGS.LOOKUP[s]).length, 0);
  eq('逐词条数与规则集一致', jsWords, rulesetWords);
  for (const site of Object.keys(ruleset.lookup)) {
    const missing = Object.keys(ruleset.lookup[site]).filter((w) => !(w in TAGS.LOOKUP[site]));
    ok(`规则集里的词 ${site} 全在 js 里（缺 ${missing.length} 个）`, missing.length === 0, missing.slice(0, 5));
  }
}

/* ============================================================
 * 第二部分 · 五站端到端（真实存档，从 extractAllFields() 进）
 * ==========================================================*/
function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'registry.json'), 'utf8'));
  return raw.fixtures || [];
}

const CASES = [
  // id                   站点     断言
  {
    id: 'douban-movie-1292052', name: '豆瓣《肖申克的救赎》',
    check(d) {
      eq('豆瓣 标签 = 剧情,犯罪', d['标签'], '剧情,犯罪');
      hasNot('豆瓣 其他信息里不应再有「其他标签」', d['其他信息'], '其他标签');
    }
  },
  {
    id: 'imdb-tt0185906', name: 'IMDb 剧集',
    check(d) {
      eq('IMDb 标签 = 动作,剧情,历史', d['标签'], '动作,剧情,历史');
      has('IMDb 其他信息保留英文原词', d['其他信息'], '类型：Action、Drama、History');
    }
  },
  {
    id: 'tmdb-movie-278', name: 'TMDB《肖申克的救赎》',
    check(d) {
      eq('TMDB 标签 = 剧情,犯罪', d['标签'], '剧情,犯罪');
      has('TMDB 其他信息保留原词', d['其他信息'], '类型：');
    }
  },
  {
    id: 'bgm-265', name: 'Bangumi《EVA》（TV 动画）',
    check(d) {
      eq('Bangumi 标签 = 科幻（机战也并进科幻且去重）', d['标签'], '科幻');
      // v2.12.1：前缀与豆瓣/红果统一成「其他标签」（原来这里叫「站内标签」）
      has('Bangumi 其他信息有「其他标签」段', d['其他信息'], '其他标签：');
      hasNot('Bangumi 不再用「站内标签」这个旧前缀', d['其他信息'], '站内标签');
      ok('Bangumi 其他标签不超过 8 个', countLeftover(d['其他信息']) <= 8, countLeftover(d['其他信息']));
      has('Bangumi 未并的词留在其他信息（TV）', d['其他信息'], 'TV');
      hasNot('Bangumi 其他信息里不该出现「犯罪 107」这种带计数的词', d['其他信息'], ' 107');
    }
  },
  {
    id: 'bgm-64965-the-godfather', name: 'Bangumi《教父》（三次元）',
    check(d) {
      eq('Bangumi 标签 = 犯罪（标准词恒直通）', d['标签'], '犯罪');
      has('Bangumi 背景词留在其他信息（美国）', d['其他信息'], '美国');
    }
  },
  {
    id: 'hongguo-7701935931787316286', name: '红果 真人剧',
    check(d) {
      eq('红果 真人剧 标签 = 生活,短剧', d['标签'], '生活,短剧');
      has('红果 子分类仍在其他信息', d['其他信息'], '子分类：真人剧');
      has('红果 爽点词进其他信息（扮猪吃虎）', d['其他信息'], '扮猪吃虎');
    }
  },
  {
    id: 'hongguo-7701226234214108185', name: '红果 漫剧',
    check(d) {
      eq('红果 漫剧 标签 = 玄幻,AI剧,短剧', d['标签'], '玄幻,AI剧,短剧');
    }
  },
  {
    id: 'hongguo-7671966197985856536', name: '红果 AI剧',
    check(d) {
      has('红果 AI剧 标签含 AI剧', d['标签'], 'AI剧');
      has('红果 AI剧 标签含 短剧', d['标签'], '短剧');
    }
  }
];

async function testEndToEnd() {
  console.log('\n【八】五站端到端（真实存档 → 点按钮链路 → 字段）');
  // harness 里 jsdom 的查找逻辑自己会找 NODE_PATH，这里照旧用
  const H = require('./lib/harness');
  const registry = loadRegistry();

  for (const c of CASES) {
    const fx = registry.find((f) => f.id === c.id);
    if (!fx) {
      fails.push(`${c.id} 在 registry.json 里找不到`);
      console.log(`  ✗ ${c.id} 在 registry.json 里找不到`);
      continue;
    }
    let page = null;
    try {
      const html = fs.readFileSync(path.join(__dirname, 'fixtures', fx.file), 'utf8');
      page = await H.openPage({ url: fx.url, html });
      const inst = await H.waitForInit(page);
      if (!inst || !inst.isInitialized) throw new Error('content-main 未完成初始化');
      const r = await H.runRealPath(page, inst);
      ok(`${c.name} 走的是真实链路（非兜底）`, r.mode === 'real', r.mode);
      c.check(r.data);

      // v2.12.1：其他标签最多 8 个。样本本身到不了 8 个，所以借当前页面
      // 的 BaseExtractor 实例补一刀真截断（10 个未命中词 → 只显示 8 个 + 总数）。
      if (c.id === 'bgm-265') {
        const B = page.window.BaseExtractor;
        ok('BaseExtractor 挂在 window 上（截断测试的前提）', typeof B === 'function');
        if (typeof B === 'function') {
          const ex = new B();
          const words = ['词一', '词二', '词三', '词四', '词五', '词六', '词七', '词八', '词九', '词十'];
          const seg = ex._leftoverTags('Bangumi', words);
          ok('10 个未命中词只显示 8 个', countWordsIn(seg) === 8, seg);
          has('截断时必须带总数，不许静默丢词', seg, '共 10 个');
          eq('不超过 8 个时原样全给', ex._leftoverTags('Bangumi', ['词一', '词二']), '词一、词二');
        }
      }
    } catch (err) {
      fails.push(`${c.name} 跑挂了`);
      console.log(`  ✗ ${c.name} 跑挂了: ${err && err.message}`);
    } finally {
      try { if (page) page.window.close(); } catch (e) { /* ignore */ }
    }
  }
}

/* ============================================================
 * 汇总
 * ==========================================================*/
(async () => {
  testPure();
  if (!PURE_ONLY) {
    await testEndToEnd();
  } else {
    console.log('\n（--pure-only：已跳过端到端）');
  }

  console.log('');
  if (fails.length) {
    console.log(`✗ ${pass} 项通过，${fails.length} 项失败`);
    for (const f of fails) console.log(`   - ${f}`);
    process.exit(1);
  }
  console.log(`✓ 全部 ${pass} 项通过`);
})().catch((e) => {
  console.error('测试脚本自身出错:', e);
  process.exit(1);
});
