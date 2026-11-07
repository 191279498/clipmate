/**
 * ModalManager 表格内搜索模块（v2.5.47 / B4）
 *
 * 目标：一屏几十行时快速定位某个字段。
 *
 * 【设计原则】
 *   1. 搜索只改 class（is-search-hit / is-search-dim），**绝不碰 this.data**——
 *      「复制Notion / 复制Markdown」导出的永远是全量字段，不是命中的那几行。
 *   2. 搜索条默认不出现（点 🔍 或按 / 才滑出），平时不占高度、不挤压表格。
 *   3. 搜索条不放在内容区里，所以 updateTable 重建表格不会把它冲掉；
 *      但高亮标记挂在表格 DOM 上，重建后就没了，必须重渲染后再应用一次。
 *
 * 【布局顺序】标题栏 → 提示横幅 → 搜索条 → 内容区
 *   横幅必须始终是最靠上的一行，由 floating-window.js 的 showNotice 用
 *   attachSearchBar() 登记的锚点保证。
 */
(function(global) {
  'use strict';

  global.ModalSearchMixin = {

    /** 搜索状态（默认关闭、空关键词、不过滤） */
    _searchOpen: false,
    _searchKeyword: '',
    _searchOnlyHits: false,
    _searchBar: null,

    /** 放大镜按钮：开 / 关 */
    toggleSearch() {
      if (this._searchOpen) {
        this.closeSearch();
      } else {
        this.openSearch();
      }
    },

    /** 展开搜索条并聚焦输入框 */
    openSearch() {
      if (!this.floatingWindow) return;
      this._ensureSearchBar();

      const bar = this._searchBar;
      if (!bar) return;

      this._searchOpen = true;
      bar.classList.add('is-open');

      const input = bar.querySelector('.clipmate-search-input');
      if (input) {
        try {
          input.focus();
          input.select();
        } catch (e) { /* 焦点被页面抢走时忽略，不影响搜索本身 */ }
      }

      // v2.12.11：搜索要按**全量字段**判定。显示隐藏开着时，
      // 打开搜索条得先重绘成全量表格（否则空字段行根本不在 DOM 里，搜字段名搜不到）。
      // updateTable 里会补跑一次 _applySearch，所以两条路只走一条。
      const p = (typeof this._hideEmptyPolicy === 'function') ? this._hideEmptyPolicy() : null;
      if (p && p.display && typeof this.updateTable === 'function') {
        this.updateTable(true);
        return;
      }
      this._applySearch();
    },

    /** 收起搜索条，清空关键词与所有高亮 */
    closeSearch() {
      this._searchOpen = false;
      this._searchKeyword = '';
      this._searchOnlyHits = false;

      const bar = this._searchBar;
      if (bar) {
        bar.classList.remove('is-open');
        const input = bar.querySelector('.clipmate-search-input');
        if (input) input.value = '';
        const filterBtn = bar.querySelector('.clipmate-search-filter');
        if (filterBtn) {
          filterBtn.classList.remove('is-active');
          filterBtn.textContent = '只看命中';
        }
      }

      // v2.12.11：关搜索后回到「隐藏空白字段」的视图（_searchOpen 已置 false，重绘会自动重新过滤）
      const p = (typeof this._hideEmptyPolicy === 'function') ? this._hideEmptyPolicy() : null;
      if (p && p.display && typeof this.updateTable === 'function') this.updateTable(true);

      this._clearSearchMarks();
      this._updateSearchCount(0, this._countSearchUnits(this._getSearchTable()));
    },

    /**
     * 创建搜索条（只建一次）
     * 用 createElement 逐节点建，不用 innerHTML —— 输入框要拿引用，
     * 拼字符串既拿不到引用，也会多一条 lint 的 Unsafe assignment 警告。
     */
    _ensureSearchBar() {
      const fw = this.floatingWindow;
      if (!fw) return;

      if (this._searchBar && this._searchBar.parentNode) return;

      const bar = document.createElement('div');
      bar.className = 'clipmate-search';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'clipmate-search-input';
      input.placeholder = '搜索字段名或内容…';
      input.setAttribute('autocomplete', 'off');
      input.value = this._searchKeyword || '';

      const count = document.createElement('span');
      count.className = 'clipmate-search-count';
      count.textContent = '0 / 0';

      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = 'clipmate-search-filter';
      filterBtn.textContent = this._searchOnlyHits ? '显示全部' : '只看命中';
      filterBtn.title = '只显示命中的行';
      if (this._searchOnlyHits) filterBtn.classList.add('is-active');

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'clipmate-search-close';
      closeBtn.textContent = '×';
      closeBtn.title = '关闭搜索（Esc）';

      bar.appendChild(input);
      bar.appendChild(count);
      bar.appendChild(filterBtn);
      bar.appendChild(closeBtn);

      input.addEventListener('input', () => {
        this._searchKeyword = input.value;
        this._applySearch();
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.closeSearch();
        }
        if (e.key === 'Enter') e.preventDefault(); // 回车不要触发页面上的表单提交
      });

      filterBtn.addEventListener('click', () => {
        this._searchOnlyHits = !this._searchOnlyHits;
        filterBtn.classList.toggle('is-active', this._searchOnlyHits);
        filterBtn.textContent = this._searchOnlyHits ? '显示全部' : '只看命中';
        this._applySearch();
      });

      closeBtn.addEventListener('click', () => this.closeSearch());

      // 插到内容区前面；同时告诉浮窗「横幅要插在搜索条上面」
      const content = fw.getContentElement();
      if (content && content.parentNode) {
        content.parentNode.insertBefore(bar, content);
      }
      if (typeof fw.attachSearchBar === 'function') fw.attachSearchBar(bar);

      this._searchBar = bar;
    },

    /** 浮窗销毁时清掉搜索条与所有状态 */
    _destroySearchBar() {
      const bar = this._searchBar;
      if (bar && bar.parentNode) {
        bar.parentNode.removeChild(bar);
      }
      this._searchBar = null;
      this._searchOpen = false;
      this._searchKeyword = '';
      this._searchOnlyHits = false;
      if (this.floatingWindow && typeof this.floatingWindow.detachSearchBar === 'function') {
        this.floatingWindow.detachSearchBar();
      }
    },

    /** 取当前表格元素（浮窗内容区里，注意不是 document） */
    _getSearchTable() {
      const fw = this.floatingWindow;
      if (!fw || typeof fw.getContentElement !== 'function') return null;
      const content = fw.getContentElement();
      if (!content) return null;
      return content.querySelector('table.data-table') || content.querySelector('table');
    },

    /** 当前视角下的「单元」总数：纵向算行，横向算列 */
    _countSearchUnits(tb) {
      if (!tb) return 0;
      if (this.displayMode === 'horizontal') {
        return tb.querySelectorAll('thead th').length;
      }
      return tb.querySelectorAll('tbody tr').length;
    },

    /** 清掉所有搜索标记（表格重建前/关闭搜索时） */
    _clearSearchMarks(tb) {
      const table = tb || this._getSearchTable();
      if (!table) return;
      const marked = table.querySelectorAll('.is-search-hit, .is-search-dim');
      Array.prototype.forEach.call(marked, (el) => {
        el.classList.remove('is-search-hit');
        el.classList.remove('is-search-dim');
      });
      table.classList.remove('is-search-filtering');
    },

    /** 按当前关键词重新打标 + 更新计数 */
    _applySearch() {
      const tb = this._getSearchTable();
      if (!tb) return;

      const kw = String(this._searchKeyword || '').trim().toLowerCase();
      this._clearSearchMarks(tb);

      if (!kw) {
        this._updateSearchCount(0, this._countSearchUnits(tb));
        return;
      }

      let total = 0;
      let hits = 0;

      if (this.displayMode === 'horizontal') {
        // 横向：表头一行、数据一行，按「列」判断，整列一起变色
        const ths = tb.querySelectorAll('thead th');
        const tds = tb.querySelectorAll('tbody td');
        total = ths.length;
        for (let i = 0; i < total; i++) {
          const th = ths[i];
          const td = tds[i];
          if (!th) continue;
          const text = (th.textContent + ' ' + (td ? td.textContent : '')).toLowerCase();
          const hit = text.indexOf(kw) !== -1;
          th.classList.add(hit ? 'is-search-hit' : 'is-search-dim');
          if (td) td.classList.add(hit ? 'is-search-hit' : 'is-search-dim');
          if (hit) hits++;
        }
      } else {
        // 纵向：一行一个字段，字段名和值都参与匹配
        const rows = tb.querySelectorAll('tbody tr');
        total = rows.length;
        Array.prototype.forEach.call(rows, (tr) => {
          const hit = tr.textContent.toLowerCase().indexOf(kw) !== -1;
          tr.classList.add(hit ? 'is-search-hit' : 'is-search-dim');
          if (hit) hits++;
        });
      }

      tb.classList.toggle('is-search-filtering', !!this._searchOnlyHits);
      this._updateSearchCount(hits, total);
    },

    /** 右上角计数：命中 / 总数，无命中直接说「无匹配」 */
    _updateSearchCount(hits, total) {
      const bar = this._searchBar;
      if (!bar) return;
      const counter = bar.querySelector('.clipmate-search-count');
      if (!counter) return;

      const kw = String(this._searchKeyword || '').trim();
      if (!kw) {
        counter.textContent = '0 / ' + (total || 0);
        counter.classList.remove('is-none');
        return;
      }
      if (!hits) {
        counter.textContent = '无匹配';
        counter.classList.add('is-none');
        return;
      }
      counter.textContent = hits + ' / ' + (total || 0);
      counter.classList.remove('is-none');
    },

    /**
     * 表格重建后补一次搜索（updateTable / createFloatingWindow 渲染完调用）
     *
     * 高亮 class 挂在表格 DOM 上，重建后全没了；但关键词还该保留，
     * 否则用户换个横纵方向搜索就白输了。
     */
    _reapplySearchAfterRender() {
      if (!this._searchOpen) return;
      const tb = this._getSearchTable();
      if (!tb) return;
      this._applySearch();
    },

    /**
     * 「/」唤起搜索（跟 GitHub、各种列表页的习惯一致）
     * 只在浮窗打开、非编辑模式、且焦点不在输入框里时生效。
     */
    _bindSearchShortcut() {
      if (this._searchShortcutHandler) {
        document.removeEventListener('keydown', this._searchShortcutHandler);
      }
      this._searchShortcutHandler = (e) => {
        if (e.key !== '/' || !this.isOpen || this.isEditMode) return;
        const el = document.activeElement;
        const tag = el ? String(el.tagName || '').toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (el && el.isContentEditable)) return;
        e.preventDefault();
        this.openSearch();
      };
      document.addEventListener('keydown', this._searchShortcutHandler);
    },

    _unbindSearchShortcut() {
      if (this._searchShortcutHandler) {
        document.removeEventListener('keydown', this._searchShortcutHandler);
        this._searchShortcutHandler = null;
      }
    }

  };
})(window);

if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalSearchMixin);
}
