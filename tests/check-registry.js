#!/usr/bin/env node
/**
 * 站点清单对账（site registry consistency check）
 *
 * 采媒灵加一个站要改 6~8 处清单，漏一处就会出「打开页面提示未找到」这类事故
 * （v2.5.48 的 bgm.tv 书籍漏注册就是这么来的）。这个脚本一次性把 6 处对完。
 *
 *   node tests/check-registry.js
 *   node tests/check-registry.js --verbose
 *
 * 只读。任何一项 ❌ 都会让退出码为 1。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const env = require('./lib/env');

const VERBOSE = process.argv.includes('--verbose');

const C = {
  reset: '\u001b[0m', red: '\u001b[31m', green: '\u001b[32m',
  yellow: '\u001b[33m', cyan: '\u001b[36m', gray: '\u001b[90m'
};

let errors = 0;
let warnings = 0;

function ok(msg) { console.log(`  ${C.green}✅${C.reset} ${msg}`); }
function warn(msg) { warnings++; console.log(`  ${C.yellow}⚠ ${C.reset} ${msg}`); }
function bad(msg) { errors++; console.log(`  ${C.red}❌${C.reset} ${msg}`); }
function section(title) { console.log(`\n${C.cyan}${title}${C.reset}`); }
function info(msg) { if (VERBOSE) console.log(`  ${C.gray}· ${msg}${C.reset}`); }

// ---------- Chrome match pattern → 正则 ----------
function escapeRe(s) { return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'); }

/** 把 manifest 里的 match pattern 变成可判定 URL 的正则（按 Chrome 的语义） */
function matchPatternToRegex(pattern) {
  const m = /^(\*|https?|file|ftp):\/\/([^/]+)(\/.*)?$/.exec(pattern);
  if (!m) return null;
  const scheme = m[1];
  const host = m[2];
  const rawPath = m[3] || '/';

  let hostRe;
  if (host === '*') hostRe = '[^/]+';
  else if (host.startsWith('*.')) hostRe = '(?:[^/]+\\.)?' + host.slice(2).split('*').map(escapeRe).join('.*');
  else hostRe = host.split('*').map(escapeRe).join('.*');

  // 路径里的 * 要变成 .*，不能整体 escape（否则 * 会退化成"重复前一个字符"）
  const pathRe = rawPath.split('*').map(escapeRe).join('.*');
  const schemeRe = scheme === '*' ? 'https?' : scheme;
  // 路径被完整写出时 Chrome 要求精确匹配，但允许附带 query / hash
  return new RegExp('^' + schemeRe + '://' + hostRe + pathRe + '(?:[?#].*)?$');
}

function matchesAny(url, patterns) {
  for (const p of patterns || []) {
    const re = matchPatternToRegex(p);
    if (re && re.test(url)) return p;
  }
  return null;
}

// ---------- 加载真实的站点清单 ----------
function loadExtractorFactory() {
  const win = {};
  // extractor-factory 会把 document 传给 detector，节点里没有，给个空壳
  const ctx = vm.createContext({ window: win, document: {}, console: env.silentConsole() });
  vm.runInContext(env.readSrc('src/content/utils/extractor-factory.js'), ctx, { filename: 'extractor-factory.js' });
  const Factory = win.ExtractorFactory;
  if (!Factory) throw new Error('extractor-factory.js 未导出 ExtractorFactory');

  // 用同名空类占位，这样 getExtractorByUrl 的返回值能报出"预期哪个提取器"
  for (const cfg of Factory.EXTRACTOR_CONFIG) {
    const named = { [cfg.className]: class {} }[cfg.className];
    win[cfg.className] = named;
  }
  // bgm 走 auto 类型，真实实现要读 DOM；这里用可控桩，让路由断言能跑
  let detectType = 'movie';
  win.MediaTypeDetector = class {
    detect() { return detectType; }
  };

  return {
    Factory,
    factory: new Factory(),
    setDetectType(t) { detectType = t; },
    configs: Factory.EXTRACTOR_CONFIG
  };
}

function loadSiteCatalog() {
  const ctx = vm.createContext({ console: env.silentConsole() });
  vm.runInContext(env.readSrc('src/shared/site-config.js'), ctx, { filename: 'site-config.js' });
  if (!ctx.ClipMateSites) throw new Error('site-config.js 未导出 ClipMateSites');
  return ctx.ClipMateSites;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return null; }
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch (e) { return null; }
}

async function main() {
  const manifest = env.manifest;
  const cs = manifest.content_scripts[0];
  const hostPermissions = manifest.host_permissions || [];
  const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'url-samples.json'), 'utf8'));

  const { Factory, factory, setDetectType, configs } = loadExtractorFactory();
  const Catalog = loadSiteCatalog();
  const bgConfigs = await env.loadBackgroundMediaConfigs();
  const bgOk = !(bgConfigs && bgConfigs.__error);

  console.log(`${C.cyan}采媒灵站点清单对账${C.reset}  扩展 v${manifest.version}｜站点样本 ${samples.samples.length} 个｜负样本 ${samples.negatives.length} 个`);

  // ---------- A. 文件清单 ----------
  section('A. 脚本文件清单');
  const missingFiles = cs.js.filter((rel) => !fs.existsSync(path.join(env.SRC, rel)));
  if (missingFiles.length) {
    bad(`manifest 里列出但磁盘上不存在：${missingFiles.join(', ')}`);
  } else {
    ok(`manifest 的 ${cs.js.length} 个内容脚本全部存在`);
  }

  const extractorDir = path.join(env.SRC, 'src/content/extractors');
  const onDisk = fs.readdirSync(extractorDir).filter((f) => f.endsWith('.js')).map((f) => 'src/content/extractors/' + f);
  const notLoaded = onDisk.filter((rel) => !cs.js.includes(rel));
  if (notLoaded.length) {
    bad(`提取器写好了但没在 manifest 里加载（等于没写）：${notLoaded.join(', ')}`);
  } else {
    ok(`${onDisk.length} 个提取器文件全部已加载`);
  }

  // ---------- B. 六处清单互相锚定 ----------
  section('B. 站点清单一致性');

  const permHosts = new Set(hostPermissions.map((p) => {
    const m = /^https?:\/\/([^/]+)\//.exec(p);
    return m ? m[1] : p;
  }));

  const catalogHosts = new Set();
  for (const site of Catalog.CATALOG) {
    for (const d of Catalog.domainsOf(site)) catalogHosts.add(String(d).toLowerCase());
  }

  const cfgHosts = [];
  for (const cfg of configs) {
    for (const entry of cfg.entries) if (!cfgHosts.includes(entry.hostname)) cfgHosts.push(entry.hostname);
  }

  const hasMatch = (h) => (cs.matches || []).some((p) => p.includes('://' + h + '/') || p.includes('://*.' + h + '/'));
  const matchedHosts = cfgHosts.filter(hasMatch);

  // B1 三种"没接上"分开判：只有"授权了却不注入"才肯定是事故
  const onlyPerm = cfgHosts.filter((h) => !hasMatch(h) && permHosts.has(h));
  const neither = cfgHosts.filter((h) => !hasMatch(h) && !permHosts.has(h));
  if (onlyPerm.length) {
    bad(`在 host_permissions 里授权了，但没有任何 matches 会让它注入（等于白授权）：${onlyPerm.join(', ')}`);
  } else {
    ok(`每个注册域名都有 matches 规则（共 ${matchedHosts.length} 个）`);
  }
  if (neither.length) {
    warn(`死注册：既没有 matches 也没授权，永远不会生效（不影响使用，可顺手删）：${neither.join(', ')}`);
  }
  const matchOnly = cfgHosts.filter((h) => hasMatch(h) && !permHosts.has(h));
  if (matchOnly.length) info(`只在 matches、没在 host_permissions（能注入，但内容脚本自己发请求会受限）：${matchOnly.join(', ')}`);
  info(`host_permissions 覆盖 ${permHosts.size} 个域名`);

  // B3 设置页站点目录能认出
  const notInCatalog = cfgHosts.filter((h) => !Catalog.findSite(h));
  if (notInCatalog.length) warn(`这些域名在 site-config CATALOG 里找不到（设置页不会出现该站）：${notInCatalog.join(', ')}`);
  else ok('每个注册域名都能在 CATALOG 里找到（设置页会显示）');

  // B4 CATALOG 的域名至少要能被注入，否则设置页会出现一个永远不生效的站
  const catDead = [...catalogHosts].filter((h) => !permHosts.has(h) && !hasMatch(h));
  if (catDead.length) warn(`CATALOG 里的站既没有 matches 也没授权（设置页会显示但永不生效）：${catDead.join(', ')}`);
  else ok(`CATALOG 的 ${catalogHosts.size} 个域名都能被注入`);

  // B5 background 的类型表
  if (!bgOk) {
    warn(`读取 background.getMediaConfigs() 失败：${bgConfigs.__error}`);
  } else {
    const bgHosts = Object.keys(bgConfigs);
    const missBg = cfgHosts.filter((h) => !bgHosts.includes(h));
    if (missBg.length) {
      warn(`background 类型表只有 ${bgHosts.length} 个域名，缺这 ${missBg.length} 个：${missBg.join(', ')}\n     影响：命中不了就退化成"按页面正文关键词猜类型"，猜错时按钮会出现但提取出别类的字段。`);
    } else {
      ok(`background 类型表覆盖全部 ${cfgHosts.length} 个域名`);
    }
  }

  // ---------- C. 正样本路由 ----------
  section('C. 详情页应当命中提取器');
  let routeFail = 0;
  for (const s of samples.samples) {
    const matchedPattern = matchesAny(s.url, cs.matches);
    const excludedBy = matchesAny(s.url, cs.exclude_matches);
    let extractorName = '';
    let threw = '';
    try {
      setDetectType(s.mediaType === 'auto' ? 'movie' : s.mediaType);
      const ex = factory.getExtractorByUrl(s.url);
      extractorName = ex ? (ex.constructor && ex.constructor.name) : '';
    } catch (err) {
      threw = (err && err.message) || String(err);
    }

    const problems = [];
    const soft = [];
    if (!matchedPattern) problems.push('matches 未命中（扩展不会注入）');
    if (excludedBy) problems.push(`被 exclude 挡掉：${excludedBy}`);
    if (threw) problems.push('getExtractorByUrl 抛错：' + threw);
    else if (!extractorName) {
      // 没显式路由、但域名注册过 → 靠 detectMediaType 兜底，能用但脆
      if (cfgHosts.includes(hostOf(s.url))) soft.push('getExtractorByUrl 没有显式规则，靠 detectMediaType 兜底（建议补一条 urlPattern）');
      else problems.push('getExtractorByUrl 未命中');
    } else if (s.extractor && extractorName !== s.extractor) {
      problems.push(`提取器不符：预期 ${s.extractor}，实际 ${extractorName}`);
    }
    if (bgOk) {
      const host = hostOf(s.url);
      const cfg = bgConfigs[host];
      if (!cfg) soft.push('background 类型表没有这个域名（类型靠猜）');
      else if (cfg.patterns && cfg.patterns.length) {
        const p = pathOf(s.url) || '';
        const hit = cfg.patterns.some((pat) => p.includes(String(pat).replace(/\*/g, '')));
        if (!hit) soft.push(`background 的路径规则没覆盖这个 URL（${cfg.patterns.join(' / ')}）`);
      }
    }

    if (problems.length) { bad(`${s.site.padEnd(14)} ${s.url}\n     ${problems.join('；')}`); routeFail++; }
    else if (soft.length) { warn(`${s.site.padEnd(14)} → ${extractorName || '(兜底)'}\n     ${soft.join('；')}`); }
    else ok(`${s.site.padEnd(14)} → ${extractorName}`);
  }
  if (!routeFail) info('全部正样本路由正确');

  // ---------- D. 负样本 ----------
  section('D. 子页/列表页不该命中');
  const knownPath = path.join(__dirname, 'known-issues.json');
  const knownList = fs.existsSync(knownPath)
    ? (JSON.parse(fs.readFileSync(knownPath, 'utf8')).knownProblems || [])
    : [];
  const knownByUrl = new Map(knownList.map((k) => [k.url, k]));

  let negFail = 0;
  for (const n of samples.negatives) {
    const matchedPattern = matchesAny(n.url, cs.matches);
    const excludedBy = matchesAny(n.url, cs.exclude_matches);
    let extractorName = '';
    try {
      setDetectType('game');
      const ex = factory.getExtractorByUrl(n.url);
      extractorName = ex ? (ex.constructor && ex.constructor.name) : '';
    } catch (err) { extractorName = ''; }

    const willInject = !!matchedPattern && !excludedBy;
    // `inject: true` = 「这一页注入是预期的」，不算缺陷。
    // 用例：小红书 `/explore` 首页 —— v2.6.0 起它**必须**注入（笔记详情是页内弹层，
    // 宿主就是这一页），按钮靠 xiaohongshu-spa-handler 按路由藏。
    // 这种情况下仍然要求 getExtractorByUrl 不命中（否则点按钮会报「未找到提取器」）。
    const expectInject = n.inject === true;
    const problems = [];
    if (willInject && !expectInject) problems.push('仍然会被注入（用户会看到一个点了没用的按钮）');
    if (!willInject && expectInject) problems.push('声明了会注入，实际没有注入（注入范围可能被改窄了）');
    if (extractorName) problems.push(`getExtractorByUrl 仍命中 ${extractorName}`);

    if (problems.length) {
      const k = knownByUrl.get(n.url);
      if (k) {
        warn(`${n.site.padEnd(16)} 已知问题（v${k.since} 起就有）：${problems.join('；')}\n     记录：${k.reason}`);
      } else {
        bad(`${n.site.padEnd(16)} ${n.url}\n     ${problems.join('；')}`);
        negFail++;
      }
    } else {
      const tag = [excludedBy ? '（' + excludedBy + '）' : '', expectInject ? '（注入是预期的，按钮由路由逻辑藏）' : ''].join('');
      ok(`${n.site.padEnd(16)} 已挡住${tag}`);
    }
  }

  // ---------- E. 版本与基线 ----------
  section('E. 版本与基线');
  const distDir = path.join(env.ROOT, '发行包');
  if (fs.existsSync(distDir)) {
    const dirs = fs.readdirSync(distDir)
      .map((d) => { const m = /_v(\d+\.\d+\.\d+)_chrome$/.exec(d); return m ? { name: d, ver: m[1] } : null; })
      .filter(Boolean);
    if (dirs.length) {
      const latest = dirs.sort((a, b) => {
        const A = a.ver.split('.').map(Number); const B = b.ver.split('.').map(Number);
        for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] - B[i];
        return 0;
      }).pop();
      if (latest.ver === manifest.version) ok(`manifest 版本 v${manifest.version} 与最新成品文件夹一致`);
      else warn(`manifest 是 v${manifest.version}，但最新成品文件夹是 v${latest.ver}（这批还没出成品？）`);
    }
  }

  const goldDir = path.join(__dirname, 'golden');
  if (fs.existsSync(goldDir)) {
    const golds = fs.readdirSync(goldDir).filter((f) => f.endsWith('.json'));
    const staleVer = [];
    for (const g of golds) {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(goldDir, g), 'utf8'));
        if (snap.extensionVersion && snap.extensionVersion !== manifest.version) staleVer.push(`${g}(v${snap.extensionVersion})`);
      } catch (e) { /* 坏文件由 snapshot.js 报 */ }
    }
    if (staleVer.length) warn(`这些基线是旧版本采的，跑一次 snapshot.js --update 刷新：${staleVer.join(', ')}`);
    else ok(`${golds.length} 份快照基线与当前版本一致`);
  } else {
    warn('还没有 tests/golden/ 基线，先跑 node tests/snapshot.js --update');
  }

  // ---------- 汇总 ----------
  console.log('');
  if (errors) {
    console.log(`${C.red}结论：${errors} 项不通过${warnings ? `，${warnings} 项提示` : ''}${C.reset}`);
    process.exit(1);
  }
  console.log(`${C.green}结论：全部通过${C.reset}${warnings ? `（${warnings} 项提示，多为「等这批做完再补」）` : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('对账脚本自身出错：', err);
  process.exit(3);
});
