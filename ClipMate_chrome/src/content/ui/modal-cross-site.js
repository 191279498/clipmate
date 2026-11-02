/**
 * ModalManager 跨站补网址模块（v2.5.72 新增，v2.5.73 扩成影视四站互跳）
 * 通过 Object.assign 合并到 ModalManager.prototype。
 *
 * 做什么：在浮窗菜单里点一下，就去豆瓣 / IMDB / TMDB / 番组计划找这一条，
 *        找到的把网址写进对应格子，找不到的留空并在提示条里说一声。
 *
 * v2.5.73 起覆盖影视四个站互相补（12 格）：
 *   在 IMDb 页    → 补豆瓣 / TMDB / Bangumi（IMDB 是本页，跳过）
 *   在豆瓣电影页  → 补 IMDB（页面自带编号，本地直接拼）/ TMDB / Bangumi
 *   在番组计划页  → 补豆瓣 / IMDB / TMDB
 *   在 TMDB 页    → 补豆瓣 / Bangumi / **IMDB**（v2.5.75 起，走「猜候选 + 回 TMDB 验证」）
 *
 * v2.5.76 起多一条独立的链：**豆瓣书籍页补「URL」**（Goodreads 按 ISBN + 番组计划主条目）。
 * 书籍和影视的字段清单、源站、判据全都不一样，所以不复用下面那套 TARGETS/轮次机制，
 * 单独走 _fillBookUrl。别的书籍站（番组/起点/番茄/Goodreads）本来就把 URL 填成了
 * 自己那一页，所以这条链只在豆瓣书籍页会真正干活。
 *
 * 三条硬规则（用户 2026-10-26 明确）：
 *   1. **已有网址的格子绝不覆盖** —— 豆瓣页、番组计划页本来就带 IMDb 网址，
 *      补全过的值比重新搜出来的更可信，直接跳过。
 *   2. **找不到就留空**，只提示，不往格子里写任何占位文字。
 *   3. 提示走 ClipMateNotice（浮窗标题栏下方的横幅），**不是表格里的一行**，
 *      所以复制（Notion / Markdown / 纯文本）都不会把它带上。
 */
(function (global) {
  'use strict';

  global.ModalCrossSiteMixin = {

    /**
     * 补齐豆瓣 / IMDB / TMDB / 番组计划网址
     * 菜单项唯一入口；执行期间不做界面锁定（最多两轮请求，每轮 ≤10 秒）
     */
    async fillCrossSiteLinks() {
      const Linker = (typeof window !== 'undefined') ? window.CrossSiteLinker : null;
      if (!Linker) {
        this.showMessage('跨站补齐组件未加载，无法查询', 'error');
        return;
      }

      // v2.5.76：豆瓣书籍页补的是「URL」一格，源站和判据都跟影视不同，走单独的链
      if (Linker.isDoubanBookPage(window.location.href)) {
        return this._fillBookUrl(Linker);
      }

      const pageUrl = window.location.href;
      const plan = Linker.buildPlan(this.data, pageUrl);
      const tmdbPage = Linker.tmdbPageOf(pageUrl);

      // 待补清单：已填好的、以及「当前页自己那一格」都会被 pendingTargets 滤掉
      const pending = Linker.pendingTargets(this.data, pageUrl).filter((t) => {
        if (t.kind === 'imdb') {
          // IMDB 这一格有两种来源，别的来源一律不列进待补（免得提示里冒出
          // 一句不准确的「IMDB 搜索不到」）：
          //   · 页面自带 tt 编号（豆瓣电影页、番组计划页的信息框）→ 本地拼网址
          //   · 当前页是 TMDB 条目页 → 联网反查（v2.5.75 批 2）
          return !!Linker.imdbUrlOf(plan) || !!tmdbPage;
        }
        return true;
      });

      if (!pending.length) {
        this.showMessage('豆瓣、IMDB、TMDB、番组计划这几格都已经有网址了，不需要补齐', 'info');
        return;
      }

      if (!plan.keyword && !plan.keyword2 && !plan.cnKeyword && !plan.imdbId) {
        this.showMessage('这一页取不到片名，没法跨站搜索', 'error');
        return;
      }

      const found = {};
      const hardFailed = [];

      // ① 本地就能得出的（IMDB：页面自带 tt 编号，直接拼网址，不发请求）
      const remote = [];
      let wantImdbReverse = false;
      pending.forEach((t) => {
        if (t.kind === 'imdb') {
          const url = Linker.imdbUrlOf(plan);
          if (url) found.imdb = url;
          // 拼不出来但当前页是 TMDB 条目页 → 走反查（v2.5.75）
          else if (tmdbPage) wantImdbReverse = true;
          return;
        }
        remote.push(t);
      });

      // ② 需要联网问的（提示只发一次，别让用户看到两次「正在找」闪一下）
      const asked = [];
      if (wantImdbReverse) asked.push('IMDB');
      if (remote.some((t) => t.kind === 'douban')) asked.push('豆瓣');
      if (remote.some((t) => t.kind === 'bgm')) asked.push('番组计划');
      if (remote.some((t) => t.kind === 'tmdb')) asked.push('TMDB');
      if (asked.length) this.showMessage('正在' + asked.join('、') + '上找这一条…', 'info');

      // 两条链**同时**跑，别串行。
      // v2.5.75 修正：原来先等豆瓣/番组/TMDB 那轮结束，再做 IMDB 反查（反查自己还要
      // 两批请求），串起来最坏 30 秒。真机上就撞见过「豆瓣、番组都补上了，IMDB 还空着」
      // ——不是查不到，是还没轮到。并发之后总耗时取最长的那一条，体感快一半。
      const tasks = [];
      if (remote.length) {
        tasks.push({ key: 'remote', run: this._runCrossSiteRounds(Linker, plan, remote) });
      }
      if (wantImdbReverse) {
        tasks.push({ key: 'imdb', run: this._resolveImdbFromTmdb(Linker, plan, tmdbPage) });
      }

      if (tasks.length) {
        const settled = await Promise.allSettled(tasks.map((t) => t.run));
        settled.forEach((r, i) => {
          const key = tasks[i].key;
          if (r.status === 'fulfilled') {
            if (key === 'remote') {
              Object.assign(found, r.value.found);
              hardFailed.push.apply(hardFailed, r.value.hardFailed);
            } else if (r.value.url) {
              found.imdb = r.value.url;
            } else if (r.value.hard) {
              hardFailed.push('imdb');
            }
            return;
          }
          // 一条链崩了不影响另一条：照实说「连不上」，别的格子该填还填
          console.warn('[ClipMate] ' + (key === 'imdb' ? 'IMDB 反查' : '跨站查询') + '失败:',
            r.reason && r.reason.message);
          if (key === 'imdb') hardFailed.push('imdb');
          else hardFailed.push.apply(hardFailed, remote.map((t) => t.kind));
        });
      }

      const filled = [];
      const missed = [];
      pending.forEach((t) => {
        const url = found[t.kind];
        if (url) {
          this.data[t.key] = url;
          filled.push(t.label);
        } else {
          missed.push(t.label);
        }
      });

      if (filled.length) {
        this.updateTable(true);
        // 同步一份「原始数据」，否则下一次「取消编辑」会把刚补的网址一起还原掉
        // （cancelEdit 是 this.data = JSON.parse(JSON.stringify(this.originalData))）
        if (this.originalData) {
          this.originalData = JSON.parse(JSON.stringify(this.data));
        }
        if (Array.isArray(this.originalFieldOrder) && this.fieldOrder) {
          this.originalFieldOrder = [...this.fieldOrder];
        }
      }

      this._reportCrossSiteResult(filled, missed, hardFailed);
    },

    /**
     * 跑查询轮次：第一轮尽量精确，第二轮只对「服务器有回话但没找到」的站放开条件
     * @returns {{found: Object, hardFailed: string[]}}
     */
    async _runCrossSiteRounds(Linker, plan, pending) {
      const found = {};
      const hardFailed = [];
      // 2026-10-26 修正（v2.5.74）：这里原来写的是 `pending.slice()`。
      // pending 是「目标对象数组」{kind, key, label}，不是 kind 字符串数组，
      // 而 buildRequests 内部是 `kind === 'douban'` 这样比字符串的 ——
      // 传对象进去恒不相等，于是**一个请求都不会构造**，requests.length 为 0
      // 让循环第一轮就 break，最后全部走「搜索不到」分支。
      // 单测没抓到是因为单测直接喂的是 ['douban','bgm'] 字符串数组。
      let kinds = pending.map((t) => t.kind);

      for (let round = 1; round <= 2 && kinds.length; round++) {
        const requests = Linker.buildRequests(plan, round, kinds);
        if (!requests.length) break;

        const response = await WBR.runtime.sendMessage({
          action: 'crossSiteLookup',
          requests: requests
        });
        const raw = (response && response.results) || {};

        const next = [];
        kinds.forEach((kind) => {
          const r = raw[kind];
          if (!r) {
            // 后台没回这个站（极少见），下一轮再试一次
            next.push(kind);
            return;
          }
          if (!r.ok) {
            // 网络层就失败了（超时 / 被拦 / 4xx-5xx），换关键词也没用，直接认输
            hardFailed.push(kind);
            return;
          }
          // v2.5.73：多传一个最终地址 —— TMDB 的精确跳转模式答案在那儿（r.text 是空的）
          const url = Linker.parseResult(kind, r.text, plan, r.url);
          if (url) {
            found[kind] = url;
          } else {
            next.push(kind);
          }
        });
        kinds = next;
      }

      return { found: found, hardFailed: hardFailed };
    },

    /**
     * TMDB 页 → IMDB 格（v2.5.75 批 2）
     *
     * 为什么不能一条请求解决：TMDB 网页上没有 IMDb 编号（官方明确说不链 IMDb），
     * 所以只能「猜 + 验」两步：
     *   ① 拿片名去 IMDb 建议接口猜几个 tt 号候选；
     *   ② 逐个拿 tt 号问 TMDB `/redirect?external_source=imdb_id`，
     *      **落地条目和当前页同号才算数**。
     *
     * 这样写错的可能性被第二步彻底堵住：猜歪了只会白花一个请求，不会写出错网址。
     * 实测（2026-10-26）：tt0086066（The Outsiders）落在 movie/227，
     * 当前页是 movie/238 的《教父》→ 对不上，丢掉；号不存在时 TMDB 干脆 404 不跳。
     *
     * 请求量：最多 2 个搜索 + 4 个验证，且分两批发，每批都在后台 6 个的上限内。
     *
     * @returns {Promise<{url: string|null, hard: boolean}>}
     *          hard=true 表示「网络层面就没问通」（跟「IMDb 没收录」要分开报）
     */
    async _resolveImdbFromTmdb(Linker, plan, tmdbPage) {
      if (!tmdbPage) return { url: null, hard: false };

      // 验证时的权重：类型以**当前页地址**为准（/tv/4613 → 找剧集），
      // 不看 data['影视类型']，那个字段各站写法不一，靠不住。
      const verifyPlan = {
        isTv: tmdbPage.kind === 'tv',
        year: plan.year,
        cnKeyword: plan.cnKeyword,
        keyword: plan.keyword,
        keyword2: plan.keyword2
      };

      // ① 猜候选：中文名 + 原名一起问。
      //    实测中文名反而更准（搜「教父」第一条就是 tt0068646，搜
      //    「the godfather」虽然第一条也对，但后面混着 Black Caesar、
      //    James Brown 这类噪音），所以中文名列第一位。
      const words = [];
      [plan.cnKeyword, plan.keyword, plan.keyword2].forEach((w) => {
        const s = (w || '').trim();
        if (s && words.indexOf(s) === -1) words.push(s);
      });
      const wordList = words.slice(0, 2);
      if (!wordList.length) return { url: null, hard: false };

      let suggestResults = {};
      try {
        const resp = await WBR.runtime.sendMessage({
          action: 'crossSiteLookup',
          requests: Linker.imdbSuggestRequests(wordList)
        });
        suggestResults = (resp && resp.results) || {};
      } catch (e) {
        return { url: null, hard: true };
      }

      let cands = [];
      let anyAnswered = false;
      wordList.forEach((w, i) => {
        const r = suggestResults['imdbs' + i];
        if (!r || !r.ok) return;      // 某个词 502 / 超时不影响另一个词
        anyAnswered = true;
        const list = Linker.parseImdbSuggest(r.text);
        if (list) cands = cands.concat(list);
      });
      if (!anyAnswered) return { url: null, hard: true };  // 两个词都没问通
      if (!cands.length) return { url: null, hard: false }; // 问了，IMDb 没这条

      // ② 验证候选：先问最有把握的那一个，命中立刻收工；不中再并发送剩下的。
      //    v2.5.76：原来 4 个候选一次并发问完，真机上约 6 次有 1 次撞限流
      //    （接口本身压测 20/20 全通、耗时只有 4~5 秒，所以不是慢，是被抖掉）。
      const ids = Linker.rankImdbCandidates(cands, verifyPlan, 4);
      if (!ids.length) return { url: null, hard: false };

      const rounds = Linker.imdbVerifyRounds(ids);
      const checked = [];
      let asked = 0;
      let answered = 0;
      for (let i = 0; i < rounds.length; i++) {
        const out = await this._verifyImdbBatch(Linker, rounds[i]);
        asked += rounds[i].length;
        answered += out.checked.length;
        checked.push.apply(checked, out.checked);
        const hit = Linker.pickVerifiedImdb(tmdbPage, out.checked);
        if (hit) {
          this._recordImdbReverse({ words: wordList, ids: ids, checked: checked, hit: hit });
          return { url: hit, hard: false };
        }
      }

      this._recordImdbReverse({ words: wordList, ids: ids, checked: checked, hit: null });
      // 一个都没问通 = 「暂时连不上」；问通了但对不上号 = 「IMDb 搜不到这一条」
      return { url: null, hard: asked > 0 && answered === 0 };
    },

    /**
     * 发一批验证请求，失败的单条自动重试一次（v2.5.76）
     *
     * 为什么要重试：这些请求是并发的短连接，偶发一条被限流/抖掉，
     * 只要丢的是正确答案那条，整个功能就白跑 —— 重试一次的代价远小于白跑。
     * 404（号不存在）在后台体现为 ok=false，重试一次仍然 false，不影响结论。
     *
     * @returns {Promise<{checked: Array<{id:string, finalUrl:string}>}>}
     */
    async _verifyImdbBatch(Linker, ids) {
      let batch = (ids || []).slice();
      const checked = [];
      for (let attempt = 1; attempt <= 2 && batch.length; attempt++) {
        let resp = null;
        try {
          resp = await WBR.runtime.sendMessage({
            action: 'crossSiteLookup',
            requests: Linker.imdbVerifyRequests(batch)
          });
        } catch (e) {
          continue;   // 消息通道本身抖了，整批再试一次
        }
        const raw = (resp && resp.results) || {};
        const retry = [];
        batch.forEach((tt, i) => {
          const r = raw['imdbv' + i];
          if (r && r.ok) checked.push({ id: tt, finalUrl: r.url });
          else retry.push(tt);
        });
        batch = retry;
      }
      return { checked: checked };
    },

    /** 留一份现场，下次再出「补不上」可以直接看是没猜中还是请求被抖掉 */
    _recordImdbReverse(info) {
      this._imdbReverseDebug = info;
      try {
        if (typeof window !== 'undefined') window.__CLIPMATE_IMDB_DEBUG__ = info;
      } catch (e) { /* 页面可能不允许挂属性，忽略 */ }
      if (!info.hit) {
        console.warn('[ClipMate] IMDB 反查没命中：', JSON.stringify(info));
      }
    },

    /* ================================================================
     * 豆瓣书籍页 → 「URL」格（v2.5.76）
     *
     * 用户拍板的四条规则（2026-10-26）：
     *   1. **Goodreads 优先**（ISBN 是全球唯一编号，版本级证据）
     *   2. 两个都命中时，提示里**要带**一句「番组计划也收录了这一部」
     *   3. 番组**只要主条目**，分卷条目不要
     *   4. 不做繁简转换
     * ============================================================== */

    async _fillBookUrl(Linker) {
      const plan = Linker.buildBookPlan(this.data);

      // 红线：已有值绝不覆盖（虽然豆瓣书籍页本来就是空的，防手动填过的）
      if (this.data && this.data['URL']) {
        this.showMessage('URL 这一格已经有网址了，不会覆盖', 'info');
        return;
      }
      if (!plan.words.length && !plan.isbn) {
        this.showMessage('这一页取不到书名和 ISBN，没法搜索', 'error');
        return;
      }

      this.showMessage('正在 Goodreads 和番组计划上找这一本…', 'info');

      // 两条链并发，谁先回来都行；最后按「Goodreads 优先」定胜负
      const tasks = [];
      if (plan.isbn) tasks.push({ key: 'goodreads', run: this._lookupGoodreads(Linker, plan) });
      if (plan.words.length) tasks.push({ key: 'bgm', run: this._lookupBgmBook(Linker, plan) });

      let goodreadsUrl = null;
      let bgmUrl = null;
      const hardFailed = [];

      const settled = await Promise.allSettled(tasks.map((t) => t.run));
      settled.forEach((r, i) => {
        const key = tasks[i].key;
        const label = key === 'goodreads' ? 'Goodreads' : '番组计划';
        if (r.status !== 'fulfilled') {
          console.warn('[ClipMate] 书籍 URL 补齐（' + label + '）失败:', r.reason && r.reason.message);
          hardFailed.push(label);
          return;
        }
        if (r.value.url) {
          if (key === 'goodreads') goodreadsUrl = r.value.url;
          else bgmUrl = r.value.url;
        } else if (r.value.hard) {
          hardFailed.push(label);
        }
      });

      this._recordBookFill({ plan, goodreadsUrl, bgmUrl, hardFailed });

      // 规则 1：Goodreads 优先（ISBN 是全球唯一编号），番组兜底。判据收在 linker 里，可单测。
      const picked = Linker.pickBookUrl(goodreadsUrl, bgmUrl);
      if (!picked) {
        // 「连不上」和「没收录」要分开说，两者含义完全不同
        const miss = [];
        if (!plan.isbn) miss.push('这一页没有 ISBN，Goodreads 用不上');
        else if (hardFailed.indexOf('Goodreads') !== -1) miss.push('Goodreads 暂时连不上');
        else miss.push('Goodreads 上没有这一版');

        if (!plan.words.length) miss.push('取不到书名，番组计划搜不了');
        else if (hardFailed.indexOf('番组计划') !== -1) miss.push('番组计划暂时连不上');
        else miss.push('番组计划上也没收这一本');

        this.showMessage(miss.join('，') + '，已留空', 'error');
        return;
      }

      this.data['URL'] = picked.url;
      this.updateTable(true);
      // 同步一份「原始数据」，否则下一次「取消编辑」会把刚补的网址还原掉
      if (this.originalData) {
        this.originalData = JSON.parse(JSON.stringify(this.data));
      }
      if (Array.isArray(this.originalFieldOrder) && this.fieldOrder) {
        this.originalFieldOrder = [...this.fieldOrder];
      }

      let text;
      if (picked.source === 'goodreads') {
        text = 'URL 已补上（Goodreads，按 ISBN 精确命中）';
        // 规则 2：番组也收录了就说一声，信息不丢，URL 仍然只放一格
        if (picked.alsoBgm) text += '；番组计划也收录了这一部';
      } else {
        text = 'URL 已补上（番组计划，作品主页）';
      }
      this.showMessage(text, 'success');
    },

    /**
     * Goodreads：ISBN 直达。
     * 判据是「落地地址有没有变成 /book/show/<id>」——不是 200 就算命中，
     * 因为不存在的 ISBN 会停在 /book/isbn/…（实测 404，不跳转）。
     * @returns {Promise<{url: string|null, hard: boolean}>} hard = 网络层面没问通
     */
    async _lookupGoodreads(Linker, plan) {
      const req = Linker.goodreadsIsbnRequest(plan.isbn);
      if (!req) return { url: null, hard: false };

      for (let attempt = 1; attempt <= 2; attempt++) {
        let resp = null;
        try {
          resp = await WBR.runtime.sendMessage({ action: 'crossSiteLookup', requests: [req] });
        } catch (e) {
          continue;   // 消息通道抖了，再试一次
        }
        const r = resp && resp.results && resp.results['grisbn'];
        if (!r) continue;
        const url = Linker.parseGoodreadsIsbn(r.url);
        if (url) return { url: url, hard: false };
        // 有回话但没跳到条目页 = Goodreads 没这一版（软失败，重试也没用）
        if (!r.error) return { url: null, hard: false };
      }
      return { url: null, hard: true };
    },

    /**
     * 番组计划：搜书籍，只认主条目。
     *
     * 为什么可能要重试：番组 v0 接口连续打会返回 502（实测），
     * 两个词并发时偶尔抖掉一个。丢的如果是原作名那个词，整条就白跑了。
     *
     * @returns {Promise<{url: string|null, hard: boolean}>}
     */
    async _lookupBgmBook(Linker, plan) {
      const words = (plan.words || []).slice(0, 2);
      if (!words.length) return { url: null, hard: false };

      const allReqs = Linker.bgmBookSearchRequests(words);
      if (!allReqs.length) return { url: null, hard: false };

      const pool = [];
      const answered = [];   // 哪些词已经问通了（下标）

      for (let attempt = 1; attempt <= 2; attempt++) {
        const todo = words.map((w, i) => i).filter((i) => answered.indexOf(i) === -1);
        if (!todo.length) break;
        // kind 是 bgmb0 / bgmb1，末尾数字就是词的下标，靠它把结果对回原词
        const requests = allReqs.filter((r) => todo.indexOf(Number(r.kind.slice(4))) !== -1);
        if (!requests.length) break;

        let resp = null;
        try {
          resp = await WBR.runtime.sendMessage({ action: 'crossSiteLookup', requests: requests });
        } catch (e) {
          continue;   // 消息通道抖了，再试一次
        }
        const raw = (resp && resp.results) || {};
        todo.forEach((i) => {
          const r = raw['bgmb' + i];
          if (!r || !r.ok) return;   // 这个词被限流/抖掉，下一轮再问
          answered.push(i);
          const list = Linker.parseBgmBookSearch(r.text);
          if (list) {
            list.forEach((x) => {
              if (!pool.some((y) => y.id === x.id)) pool.push(x);
            });
          }
        });
      }

      if (!answered.length) return { url: null, hard: true };
      const hit = Linker.pickBgmBookMain(pool, plan);
      return { url: hit ? hit.url : null, hard: false };
    },

    /** 留一份现场：以后再出现「补不上」，能直接看出来是没搜到还是请求被抖掉 */
    _recordBookFill(info) {
      this._bookFillDebug = info;
      try {
        if (typeof window !== 'undefined') window.__CLIPMATE_BOOK_DEBUG__ = info;
      } catch (e) { /* 页面可能不允许挂属性，忽略 */ }
      if (!info.goodreadsUrl && !info.bgmUrl) {
        console.warn('[ClipMate] 书籍 URL 补齐没命中：', JSON.stringify(info));
      }
    },

    /** 把结果拼成一句人话 */
    _reportCrossSiteResult(filled, missed, hardFailed) {
      const Linker = (typeof window !== 'undefined') ? window.CrossSiteLinker : null;
      const labelOf = (kind) => {
        const t = Linker && Linker.TARGETS.find((x) => x.kind === kind);
        return t ? t.label : kind;
      };
      // 「连不上」和「搜不到」要分开说：一个是网络/接口问题，一个是站里真没有
      const hardLabels = (hardFailed || []).map(labelOf);
      const softLabels = (missed || []).filter((label) => hardLabels.indexOf(label) === -1);

      if (!filled.length) {
        const parts = [];
        if (softLabels.length) parts.push(softLabels.join('、') + ' 搜索不到');
        if (hardLabels.length) parts.push(hardLabels.join('、') + ' 暂时连不上');
        this.showMessage((parts.join('，') || '这几个站都搜索不到这一条') + '，已留空', 'error');
        return;
      }

      let text = filled.join('、') + ' 已补上';
      if (missed.length) {
        const parts = [];
        if (softLabels.length) parts.push(softLabels.join('、') + ' 搜索不到');
        if (hardLabels.length) parts.push(hardLabels.join('、') + ' 暂时连不上');
        text += '；' + parts.join('，') + '，已留空';
      }
      this.showMessage(text, missed.length ? 'info' : 'success');
    }

  };

  if (typeof ModalManager !== 'undefined' && ModalManager && ModalManager.prototype) {
    Object.assign(ModalManager.prototype, global.ModalCrossSiteMixin);
  }
})(window);
