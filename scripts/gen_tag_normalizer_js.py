#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 影视类标签转化库_ruleset_v1.0.json 生成 src/shared/tag-normalizer.js

为什么要生成而不是手写：
  规则集是唯一数据源。手抄 393 条进 js 一定会漂，改了 JSON 忘了改 js 是最典型的
  「单测全绿、真机全废」来源。此脚本可重复执行，输出稳定（字典按规则集原序）。

输出形态：
  TAG_LOOKUP[站点][原词] = ['标签', ...]   // [] 表示「已知，但只进其他信息」
  键不存在 = 真未命中 → 走 D11 兜底（原词进其他信息，绝不丢）

用法：python scripts/gen_tag_normalizer_js.py
"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_JSON = os.path.join(ROOT, '影视类标签转化库_ruleset_v1.0.json')
OUT_JS = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'shared', 'tag-normalizer.js')

SITE_ORDER = ['豆瓣电影', 'IMDb', 'TMDB', 'Bangumi', '红果短剧']


def j(obj):
    """紧凑 JSON，中文不转义。"""
    return json.dumps(obj, ensure_ascii=False, separators=(', ', ': '))


def main():
    d = json.load(open(SRC_JSON, encoding='utf-8'))
    standards = d['standards']
    lookup = d['lookup']
    inject = d['inject']

    # 站点顺序固定，缺站补空（避免以后加站时顺序抖动导致成品哈希乱变）
    sites = [s for s in SITE_ORDER if s in lookup] + [s for s in lookup if s not in SITE_ORDER]

    # 注入表：站点 → 标签数组
    inject_map = {}
    for it in inject:
        inject_map.setdefault(it['site'], [])
        if it['tag'] not in inject_map[it['site']]:
            inject_map[it['site']].append(it['tag'])

    lines = []
    lines.append("""/**
 * 采媒灵 · 影视类标签统一转化库（归一器）· v1.0
 * ============================================================================
 * 【这个文件是生成物】由 scripts/gen_tag_normalizer_js.py 从
 *   影视类标签转化库_ruleset_v1.0.json 生成，**不要手改**。
 *   改规则 → 改那份 JSON 的生成器（scripts/gen_tag_library_final.py）→ 重跑本脚本。
 *
 * 【它解决什么】
 *   5 个影视站的「类型 / 题材」写法互不相同：豆瓣写「纪录片」、IMDb 写 Documentary、
 *   TMDB 写「剧情 / 犯罪」、Bangumi 是用户打的一堆散标签、红果是「都市脑洞、战神归来」。
 *   全站统一到用户自定的 44 个标准标签，未命中的原词退回「其他信息」，一个都不丢。
 *
 * 【查表语义 —— 最关键的一条】
 *   TAG_LOOKUP[站点][原词] = ['标签', ...]   → 写进「标签」列
 *   TAG_LOOKUP[站点][原词] = []              → **已知该词，但只进「其他信息」**
 *   键不存在                                  → 真未命中 → 走兜底，原词进「其他信息」
 *   前两者绝不能混：`[]` 是「查过了、故意不并」，undefined 是「没见过」。
 *   若把 `[]` 当未命中处理，D10 那批爽点/氛围词会反复被误判成新词。
 *
 * 【字面直通必须先落进表里】
 *   豆瓣 28 类里有 26 个与标准词同名（剧情/喜剧/动作…）。它们「本来不需要映射」，
 *   但代码查表会判成未命中 → 全掉进兜底 → 豆瓣标签全废。所以生成器已把标准词显式
 *   写进 lookup，并在生成时断言（见 gen_tag_library_final.py 的 _self_conflict 检查）。
 *
 * 【未命中兜底（D11）】
 *   UGC 标签（Bangumi 的用户标签、红果的运营题材）会不断冒新词。查不到的**不猜、
 *   不丢弃、不静默替换**，原样返回在 others 里，由调用方写进「其他信息」。
 *
 * 版本：v1.0（2026-11-05，对应 17 条拍板 D01–D17）
 */

(function () {
  'use strict';

  /** 规则集版本（与 影视类标签转化库_ruleset_v1.0.json 的 version 一致） */""")
    lines.append("  var RULESET_VERSION = %s;" % j(d.get('version', 'v1.0')))
    lines.append("")
    lines.append("  /** 44 个标准标签（顺序即用户私人库原序，别重排） */")
    lines.append("  var STANDARDS = %s;" % j(standards))
    lines.append("")
    lines.append("""  /**
   * 逐词映射表。键 = 站点名（site-config.js 的 name），值 = 原词 → 标准标签数组。
   * 数组为空 = 已知但只进「其他信息」；键缺失 = 真未命中。
   */""")
    lines.append("  var LOOKUP = {")
    for i, s in enumerate(sites):
        lines.append("    %s: {" % j(s))
        for w, tags in lookup[s].items():
            lines.append("      %s: %s," % (j(w), j(tags)))
        lines.append("    }%s" % (',' if i < len(sites) - 1 else ''))
    lines.append("  };")
    lines.append("")
    lines.append("""  /**
   * 固定注入（D9）：红果整站每条都带「短剧」，不依赖页面是否出现该词。
   * 这是站点事实，不是页面数据 —— 所以不能靠查表，必须硬注入。
   */""")
    lines.append("  var INJECT = %s;" % j(inject_map))
    lines.append("""
  /** 站点别名 → 规范站点名（调用方传域名 / 短名也能查） */
  var SITE_ALIASES = {
    'douban': '豆瓣电影',
    'douban-movie': '豆瓣电影',
    'movie.douban.com': '豆瓣电影',
    '豆瓣': '豆瓣电影',
    'imdb': 'IMDb',
    'www.imdb.com': 'IMDb',
    'tmdb': 'TMDB',
    'www.themoviedb.org': 'TMDB',
    'themoviedb': 'TMDB',
    'bgm': 'Bangumi',
    'bgm.tv': 'Bangumi',
    'bangumi.tv': 'Bangumi',
    'chii.in': 'Bangumi',
    'hongguo': '红果短剧',
    'hongguoduanju.com': '红果短剧',
    'www.hongguoduanju.com': '红果短剧',
    'novelquickapp': '红果短剧',
    'www.novelquickapp.com': '红果短剧'
  };

  /**
   * 词的归一键：小写、去掉所有空白/连字符/下划线/间隔号/斜杠。
   * 目的：让 'Sci-Fi' / 'Sci Fi' / 'SciFi'、'Film-Noir' / 'Film Noir'、
   * 'TV-Movie' / 'TV Movie' 都能命中同一条规则。
   * 中文不受影响（中文里本来就没有这些分隔符）。
   */
  function keyOf(word) {
    return String(word == null ? '' : word)
      .toLowerCase()
      .replace(/[\\s\\-_\\u00b7\\u30fb\\u2022\\/\\\\]+/g, '')
      .trim();
  }

  /** 拆词：支持数组，或「、，,/|｜」连接的字符串 */
  function splitWords(input) {
    if (input == null) return [];
    if (Array.isArray(input)) {
      var out = [];
      for (var i = 0; i < input.length; i++) {
        var piece = input[i];
        if (piece == null) continue;
        // 数组元素自身也可能带分隔符（IMDb 的 "Drama, Action" 这种写法）
        if (typeof piece === 'string' && /[、，,\\/|｜]/.test(piece)) {
          out = out.concat(splitWords(piece));
        } else {
          var t = String(piece).trim();
          if (t) out.push(t);
        }
      }
      return out;
    }
    return String(input)
      .split(/[、，,\\/|｜]+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return !!s; });
  }

  /** 站点名规范化 */
  function siteKeyOf(site) {
    var s = String(site == null ? '' : site).trim();
    if (!s) return '';
    if (LOOKUP[s]) return s;
    var low = s.toLowerCase();
    if (SITE_ALIASES[low]) return SITE_ALIASES[low];
    if (SITE_ALIASES[s]) return SITE_ALIASES[s];
    return s;
  }

  /**
   * 每站一份「归一键 → 标签数组」的索引，模块加载时建一次。
   * 只建索引不查原表，是为了让分隔符/大小写差异不用在调用点处理。
   * 冲突检测：同一站两个不同的原词归一到同一个键、且映射不同 → 记录在 CONFLICTS，
   * 由单测断言为空（否则谁覆盖谁全看遍历顺序，属于静默错）。
   */
  var INDEX = {};
  var CONFLICTS = [];
  Object.keys(LOOKUP).forEach(function (site) {
    var map = LOOKUP[site];
    var idx = {};
    Object.keys(map).forEach(function (word) {
      var k = keyOf(word);
      if (!k) return;
      if (Object.prototype.hasOwnProperty.call(idx, k)) {
        var prev = idx[k];
        var next = map[word];
        if (JSON.stringify(prev.tags) !== JSON.stringify(next)) {
          CONFLICTS.push({ site: site, key: k, keptBy: prev.word, conflictWith: word });
        }
        return;
      }
      idx[k] = { word: word, tags: map[word] };
    });
    INDEX[site] = idx;
  });

  /**
   * 标准词恒直通索引（keyOf(标准词) → 标准词）。
   *
   * 【为什么必须有这一层】
   * Bangumi 的标签是用户投票打的、红果的是运营题材，两边的词永远补不完 ——
   * 规则集里只收了那批「有明确近义关系」的词。于是会出现这种荒唐情况：
   * Bangumi 页面上明明白白写着「犯罪」（正好就是 44 个标准词之一），
   * 但查表查不到 → 判成未命中 → 掉进「其他信息」，标签列空着。
   * 实测：bgm-64965《教父》就是这样，标签列本来该是「犯罪」。
   *
   * 所以只要站点写的就是标准词本身，一律算命中。站点差异不会因此被抹掉：
   * 44 个标准词里没有任何一个在某个站被故意设成「只进其他信息」（生成时有断言拦）。
   */
  var STANDARD_BY_KEY = {};
  STANDARDS.forEach(function (t) {
    STANDARD_BY_KEY[keyOf(t)] = t;
  });

  /**
   * 归一主函数。
   *
   * @param {string} site  站点名（'豆瓣电影' / 'IMDb' / 'TMDB' / 'Bangumi' / '红果短剧'，也吃别名）
   * @param {string|string[]} input 原始词，字符串或数组，带「、，,/」分隔都行
   * @returns {{site: string, tags: string[], others: string[], unknown: string[]}}
   *   tags    写进「标签」列的**标准词**（已去重保序）
   *   others  写进「其他信息」的原词（已知不并 + 真未命中，去重保序）
   *   unknown others 里属于「真未命中」的那部分（调试 / 日志用）
   */
  function normalize(site, input) {
    var s = siteKeyOf(site);
    var words = splitWords(input);
    var idx = INDEX[s] || null;

    var tags = [];
    var others = [];
    var unknown = [];
    var seenTag = {};
    var seenOther = {};

    function pushTag(t) {
      if (!t || seenTag[t]) return;
      seenTag[t] = 1;
      tags.push(t);
    }
    function pushOther(w) {
      if (!w || seenOther[w]) return;
      seenOther[w] = 1;
      others.push(w);
    }

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var hit = idx ? idx[keyOf(w)] : null;
      if (!hit) {
        // 标准词恒直通（见 STANDARD_BY_KEY 的说明）：
        // 站点写的就是 44 个标准词之一，没道理判它未命中。
        var std = STANDARD_BY_KEY[keyOf(w)];
        if (std) hit = { word: w, tags: [std] };
      }
      if (hit) {
        if (hit.tags.length) {
          for (var j = 0; j < hit.tags.length; j++) pushTag(hit.tags[j]);
        } else {
          // 已知词、故意不并（D10）—— 原词照旧展示，但不算「未命中」
          pushOther(w);
        }
      } else {
        // 真未命中（D11 兜底）：不猜、不丢
        pushOther(w);
        unknown.push(w);
      }
    }

    // 站点固定注入（D9）
    var inj = INJECT[s] || [];
    for (var k = 0; k < inj.length; k++) pushTag(inj[k]);

    return { site: s, tags: tags, others: others, unknown: unknown };
  }

  /** 拼成「标签」列要的字符串（半角逗号，与豆瓣/红果历史格式一致） */
  function joinTags(site, input) {
    return normalize(site, input).tags.join(',');
  }

  /** 只要「其他信息」那部分原词，半角逗号连接 */
  function joinOthers(site, input) {
    return normalize(site, input).others.join(',');
  }

  var api = {
    RULESET_VERSION: RULESET_VERSION,
    STANDARDS: STANDARDS,
    LOOKUP: LOOKUP,
    INJECT: INJECT,
    SITE_ALIASES: SITE_ALIASES,
    CONFLICTS: CONFLICTS,
    keyOf: keyOf,
    splitWords: splitWords,
    siteKeyOf: siteKeyOf,
    isStandard: function (w) { return !!STANDARD_BY_KEY[keyOf(w)]; },
    normalize: normalize,
    joinTags: joinTags,
    joinOthers: joinOthers
  };

  if (typeof window !== 'undefined') {
    window.ClipMateTags = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
""")

    text = '\n'.join(lines)
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with open(OUT_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)

    total = sum(len(v) for v in lookup.values())
    print('已生成 %s' % os.path.relpath(OUT_JS, ROOT))
    print('  标准标签 %d 个 | 站点 %d 个 | 逐词 %d 条 | 注入 %s | %d 字节'
          % (len(standards), len(sites), total,
             ', '.join('%s→%s' % (k, '/'.join(v)) for k, v in inject_map.items()) or '无',
             len(text.encode('utf-8'))))


if __name__ == '__main__':
    main()
