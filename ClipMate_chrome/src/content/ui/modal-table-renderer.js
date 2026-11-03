/**
 * ModalManager 表格渲染模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  /**
   * 简介里的裸网址（v2.7.32）：人物签名／影人简介里的网址也要能点。
   *
   * 分两支：
   *  - 带协议（http(s)/ftp）或 `www.` 开头 → 无条件认
   *  - 裸域名（`yuzong.ai/bio` 这种）→ 两道闸：
   *      ① 后行断言 `(?<![\w@.\/-])`：前面不许是字母数字 `@` `.` `/` `-`
   *         （挡掉邮箱 `a@b.com` 里的 `b.com`、以及长串中间的片段）
   *      ② TLD 必须是 2~10 个字母 → 挡掉 `9.9` `v2.7.31` `1.5万` 这类数字串
   * 中文标点（，。；！？、）】」』）不进 URL，避免把句号吃进 href。
   */
  const BARE_URL_RE = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'，。；！？、）】」』]+|(?<![\w@.\/-])(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,10}(?:\/[^\s<>"'，。；！？、）】」』]*)?/g;

  /** 链接样式：与「网址」列、社交「URL」保持同一套观感 */
  const LINK_STYLE = 'color:#056BF4;text-decoration:underline;';

  global.ModalTableMixin = {

    isUrl(text) {
    if (!text || typeof text !== 'string') return false;

    // 常见URL协议
    const protocols = ['http://', 'https://', 'ftp://', 'ftps://'];

    // 检查是否以常见协议开头
    if (protocols.some(protocol => text.startsWith(protocol))) {
      return true;
    }

    // 检查是否为域名格式（如www.example.com）
    const domainRegex = /^(www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/.*)?$/;
    if (domainRegex.test(text)) {
      return true;
    }

    return false;
    },

    /**
     * 人物档案「简介」专用：保留换行 + 把 Markdown 链接渲染成可点的 <a>
     *
     * 入参是**已经过 escapeHtml 的**文本（`[` `]` `(` `)` 原样保留，只转了 `& < >`），
     * 所以这里可以安全地做 `[文字](url)` → `<a>` 的转换：
     * - 链接文字不再二次转义（已经是转义过的）
     * - URL 只认 http(s)，且不允许出现空白 / 引号 / 尖括号，防注入
     *
     * `\n` → `<br>`：抖音签名是一行一条信息（粉丝/获赞/IP 一行，签名多行），
     * 挤成一行会完全没法读。豆瓣影人简介的「职业/补充/正文」三段也同理受益。
     */
    linkifyPersonBio(escapedText) {
      if (!escapedText) return '';

      // 占位符：先把生成好的 <a> 藏起来，避免后续扫描钻进标签属性里再包一层
      const slots = [];
      const park = (html) => '\u0000' + (slots.push(html) - 1) + '\u0000';

      let s = String(escapedText);

      // ① Markdown 链接 [文字](url) —— 必须**最先**做，做完立刻换成占位符。
      //    顺序反了（先扫裸网址）就会把刚生成的 <a href="https://…"> 里的 URL
      //    再包一层 <a>，标签直接烂掉。
      s = s.replace(
        /\[([^\[\]\n]{1,120})\]\((https?:\/\/[^\s()<>"']+)\)/g,
        (m, label, url) => park(`<a href="${url}" target="_blank" rel="noopener noreferrer" style="${LINK_STYLE}">${label}</a>`)
      );

      // ② 裸网址（v2.7.32）：抖音签名的 x.com、X 简介的 paywallpro.app / yuzong.ai/bio 之类
      s = s.replace(BARE_URL_RE, (m) => {
        let url = m;
        let tail = '';

        // 剥掉粘在末尾的英文标点（`看这里 https://a.com.` 的句号不是网址的一部分）
        const t = url.match(/[)\].,;:!?]+$/);
        if (t) {
          tail = t[0];
          url = url.slice(0, url.length - tail.length);
        }

        // 剥完只剩 `https://` 或 `www.` → 根本不是网址，原样留着
        const body = url.replace(/^(?:https?|ftp):\/\//i, '').replace(/^www\./i, '');
        if (!/[a-zA-Z0-9]/.test(body)) return m;

        const href = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : 'https://' + url;
        return park(`<a href="${href}" target="_blank" rel="noopener noreferrer" style="${LINK_STYLE}">${url}</a>`) + tail;
      });

      // ③ 还原占位符，最后才把换行变 <br>（<a> 内部没有换行，先后都安全，放最后更好读）
      s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => slots[Number(i)] || m);
      return s.replace(/\n/g, '<br>');
    },

    /**
     * 生成单元格内容（v2.5.45 抽出，纵向/横向共用同一套规则）
     * - 作者 ID 永不做 URL 检测，始终显示纯文本
     * - 其他字段是 URL 就渲染成链接；社交类的「URL」字段显示「点击访问」
     * - 发布日期用等宽字体且不换行
     * - 超过 120 字的长文本折叠成 3 行，并附一个「展开」小按钮
     */
    buildFieldContent(fieldName, displayValue, mediaType) {
      // 「账号ID」与「作者ID」同理：里面是 sec_uid 这类长串，永不做 URL 检测，
      // 否则 isUrl() 会把带点的字符串误判成域名渲染成链接（v2.7.11）
      if (fieldName === '作者ID' || fieldName === '账号ID') {
        return `<span class="data-field">${displayValue}</span>`;
      }
      // 人物档案的「网址」（v2.7.31 用户拍板改口径）：
      // - 显示的是网址原文，**不是**「点击访问」四个字（v2.7.13 定下的可读性要求不变）
      // - 但必须能点（v2.7.31 之前是纯文本，用户要求改成可点击超链接）
      // href 用 displayValue：它已经过 escapeHtml（只转 & < >），属性里可用；
      // 且 isUrl() 已限定 http(s)/ftp(s) 或纯域名形态，不会出现 javascript: 之类的注入。
      if (mediaType === 'person' && fieldName === '网址') {
        if (this.isUrl(displayValue)) {
          return `<a href="${displayValue}" target="_blank" rel="noopener noreferrer" style="color:#056BF4;text-decoration:underline;">${displayValue}</a>`;
        }
        return `<span class="data-field">${displayValue}</span>`;
      }
      // 人物档案的「简介」：保留换行 + @ 可点（v2.7.14）
      // 折叠阈值放宽到 400 字 —— 抖音签名加三项统计通常 130～200 字，
      // 按原来的 120 字阈值一打开就只剩 3 行，等于让人看不到完整签名。
      if (mediaType === 'person' && fieldName === '简介') {
        const html = this.linkifyPersonBio(displayValue);
        // 长度按**去掉链接 URL 之后**的可见文字算：抖音一条 @ 的 secUid 有 76 个字符，
        // 四条就是 300+，按原始长度算会把「看着只有五行字」的签名误判成超长文本折叠掉。
        const visibleLen = displayValue.replace(/\]\(https?:\/\/[^\s()<>"']+\)/g, ']').length;
        if (visibleLen > 400) {
          return `<span class="data-field is-clampable">${html}</span><span class="data-field-toggle">展开</span>`;
        }
        return `<span class="data-field">${html}</span>`;
      }
      if (this.isUrl(displayValue)) {
        // 社交类的「URL」显示成「点击访问」
        const isVisitLink = (mediaType === 'social' && fieldName === 'URL');
        if (isVisitLink) {
          return `<a href="${displayValue}" target="_blank" rel="noopener noreferrer" style="color: #056BF4; text-decoration: underline;" title="${displayValue}">点击访问</a>`;
        }
        return `<a href="${displayValue}" target="_blank" rel="noopener noreferrer" style="color: #056BF4; text-decoration: underline;">${displayValue}</a>`;
      }
      if (fieldName === '发布日期' && displayValue) {
        return `<span class="data-field" style="font-family: monospace; white-space: nowrap;">${displayValue}</span>`;
      }
      if (displayValue.length > 120) {
        return `<span class="data-field is-clampable">${displayValue}</span><span class="data-field-toggle">展开</span>`;
      }
      return `<span class="data-field">${displayValue}</span>`;
    },

    createTable() {
    const startTime = performance.now();
    ClipMateLog.debug('===== 开始创建表格内容 =====');

    // 根据需求，所有字段都需要完整显示，包括空字符串字段
    const fieldsToRender = this.fieldOrder;

    // 根据展示模式生成不同的表格结构
    if (this.displayMode === 'vertical') {
      // 纵向模式：每行一个字段，左侧是字段名，右侧是字段值
      let tableHTML = `
        <table class="data-table vertical-table" id="dataTable">
          <tbody>
      `;

      let fieldCount = 0;
      let emptyFieldCount = 0;

      for (const fieldName of fieldsToRender) {
        fieldCount++;
        const value = this.data[fieldName];
        // 添加调试日志跟踪豆瓣链接字段
        const displayValue = value !== null && value !== undefined ? this.escapeHtml(value) : '';

        if (displayValue === '') {
          emptyFieldCount++;
        } else {
          // 对"其他信息"、"主演"、"导演"和"编剧"字段做特殊处理，显示完整内容而不截断
          if (fieldName === '其他信息' || fieldName === '主演' || fieldName === '导演' || fieldName === '编剧') {
            // 对于较长的字段，可以按分隔符拆分并逐行显示
            if (displayValue.length > 100 && displayValue.includes('，')) {
              const parts = displayValue.split('，');
              parts.forEach((part, index) => {
              });
            } else if (displayValue.length > 100 && displayValue.includes(',')) {
              const parts = displayValue.split(',');
              parts.forEach((part, index) => {
              });
            }
          } else {
            // 其他字段保持原有截断逻辑
            const valuePreview = displayValue.length > 50 ? displayValue.substring(0, 50) + '...' : displayValue;
          }
        }

        // 使用fieldMappings处理字段显示名称
        let displayName = this.fieldMappings && this.fieldMappings[fieldName] ? this.fieldMappings[fieldName] : fieldName;

        // 媒体类型特定的字段显示名称映射
        const mediaType = this.getMediaType();
        if ((mediaType === 'movie' || mediaType === 'tv') && fieldName === 'URL') {
          displayName = '豆瓣链接';
        }
        const headerClass = this.isEditMode ? 'sortable-header' : 'sortable-header-disabled';
        const headerTitle = this.isEditMode ? '双击编辑' : '请先进入编辑模式';

        // v2.5.45：抽成 buildFieldContent，纵向/横向共用同一套规则（顺带支持长文本折叠）
        const fieldContent = this.buildFieldContent(fieldName, displayValue, mediaType);

        tableHTML += `
          <tr>
            <th data-field="${fieldName}" class="${headerClass}" title="${headerTitle}">${displayName}</th>
            <td data-field="${fieldName}">
              ${fieldContent}
            </td>
          </tr>
        `;
      }

      tableHTML += `
          </tbody>
        </table>
      `;

      ClipMateLog.debug(`纵向表格内容创建完成: 共${fieldCount}个字段，其中${emptyFieldCount}个空值字段，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      return tableHTML;
    } else {
      // 横向模式：保持原有的表格结构
      // 媒体类型在【表头循环】和【数据行循环】里都要用，必须提到外面声明一次。
      // （历史缺陷：原先只在表头循环里声明，数据行循环引用它时抛 ReferenceError，
      //   导致点「横向」按钮后表格被清空、一行都渲染不出来。v2.5.41 一并修复。）
      const mediaType = this.getMediaType();

      let tableHTML = `
        <table class="data-table horizontal-table" id="dataTable">
          <thead>
            <tr>
      `;

      // 表头 - 显示过滤后的字段
      let headerCount = 0;
      for (const fieldName of fieldsToRender) {
        headerCount++;
        const headerClass = this.isEditMode ? 'sortable-header' : 'sortable-header-disabled';
        const headerTitle = this.isEditMode ? '双击编辑' : '请先进入编辑模式';
        // 使用fieldMappings处理字段显示名称
        let displayName = this.fieldMappings && this.fieldMappings[fieldName] ? this.fieldMappings[fieldName] : fieldName;

        // 媒体类型特定的字段显示名称映射
        if (mediaType === 'movie' && fieldName === 'URL') {
          displayName = '豆瓣链接';
        }
        tableHTML += `<th data-field="${fieldName}" class="${headerClass}" title="${headerTitle}">${displayName}</th>`;
      }

      tableHTML += `
            </tr>
          </thead>
          <tbody>
            <tr>
      `;

      // 数据行 - 显示过滤后的字段
      let fieldCount = 0;
      let emptyFieldCount = 0;

      for (const fieldName of fieldsToRender) {
        fieldCount++;
        const value = this.data[fieldName];
        // 添加调试日志跟踪豆瓣链接字段
        const displayValue = value !== null && value !== undefined ? this.escapeHtml(value) : '';

        if (displayValue === '') {
          emptyFieldCount++;
        } else {
          // 对"其他信息"、"主演"、"导演"和"编剧"字段做特殊处理，显示完整内容而不截断
          if (fieldName === '其他信息' || fieldName === '主演' || fieldName === '导演' || fieldName === '编剧') {
            // 对于较长的"其他信息"，可以按分隔符拆分并逐行显示
            if (displayValue.length > 100 && displayValue.includes('，')) {
              const parts = displayValue.split('，');
              parts.forEach((part, index) => {
              });
            }
          } else {
            // 其他字段保持原有截断逻辑
            const valuePreview = displayValue.length > 50 ? displayValue.substring(0, 50) + '...' : displayValue;
          }
        }

        // v2.5.45：同上，横向模式也用统一规则
        const fieldContent = this.buildFieldContent(fieldName, displayValue, mediaType);

        tableHTML += `
          <td data-field="${fieldName}">
            ${fieldContent}
          </td>
        `;
      }

      tableHTML += `
            </tr>
          </tbody>
        </table>
      `;

      ClipMateLog.debug(`横向表格内容创建完成: 共${fieldCount}个字段，其中${emptyFieldCount}个空值字段，耗时: ${(performance.now() - startTime).toFixed(2)}ms`);
      return tableHTML;
    }

    ClipMateLog.debug('===== 表格内容创建完成 =====');
    },

    /**
     * 重建表格内容。
     * @param {boolean} force 用户主动操作（切换横纵、进出编辑模式）传 true。
     *   自动刷新（就地更新）传 false：此时若用户正在浮窗里选中文字，重建会销毁
     *   选中的文字节点、导致选区消失无法复制，故推迟到选区结束后再补刷。
     */
    updateTable(force = false) {
    // 确保floatingWindow存在
    if (!this.floatingWindow) return;

    if (force) {
      // 用户主动重建：之前被推迟的刷新作废（本次已带上最新数据）
      this._pendingTableRefresh = false;
      this._clearSelectionWatcher();
    } else if (this._isSelectingInWindow()) {
      // 用户正在选字复制：不碰 DOM，记下待刷新，等选区消失后自动补上
      this._pendingTableRefresh = true;
      this._watchSelectionEnd();
      return;
    }

    // 确保displayMode有初始值
    if (!this.displayMode) {
      this.displayMode = 'vertical';
    }

    // 保存当前编辑模式和展示模式状态
    const isInEditMode = this.isEditMode;
    const currentDisplayMode = this.displayMode;

    // 获取悬浮窗内容区域并更新表格内容
    const contentElement = this.floatingWindow.getContentElement();
    if (contentElement) {
      // v2.5.45：重建前记住滚动位置，重建后还原（否则刷新一次就跳回第一行）
      const prevScrollTop = contentElement.scrollTop;
      const prevScrollLeft = contentElement.scrollLeft;

      // 清除内容区域
      contentElement.innerHTML = '';

      // 添加表格内容
      contentElement.innerHTML = this.createTable();

      contentElement.scrollTop = prevScrollTop;
      contentElement.scrollLeft = prevScrollLeft;

      // v2.5.45：单元格点击复制 + 长文本展开（监听挂在内容区本身，重建不会丢）
      this._bindTableCellActions(contentElement);
    }

    // 确保状态一致性
    this.isEditMode = isInEditMode;
    this.displayMode = currentDisplayMode;

    // 更新标题栏按钮（因为编辑模式可能已更改）
    this.createFloatingWindowActions();

    // 初始化拖拽排序（仅编辑模式）
    if (isInEditMode) {
      this.initDragAndDrop();
    }

    // v2.5.45：每次渲染后重新绑定表头双击改名（updateTable 会重建 DOM，旧监听随之消失）
    if (typeof this._bindHeaderRename === 'function') {
      this._bindHeaderRename();
    }

    // 记录本次真正渲染的数据指纹（供 updateInPlace 判断「数据没变就不重建」）。
    // 注意：因选区推迟而提前 return 的路径不会走到这里，指纹保持旧值，补刷时仍会重建。
    // 防御：指纹方法缺失时只是不启用这道防线，绝不能让表格渲染本身失败。
    this._lastRenderFingerprint = (typeof this._computeDataFingerprint === 'function')
      ? this._computeDataFingerprint()
      : '';

    // v2.5.47（B4）：表格重建后把搜索高亮补回来。
    // 高亮 class 挂在表格 DOM 上，重建就没了；关键词还该留着，否则换横纵方向搜索就白输了。
    if (typeof this._reapplySearchAfterRender === 'function') {
      this._reapplySearchAfterRender();
    }

    // v2.5.47（B3）：胶囊上的字段数跟着刷新
    if (typeof this._syncCapsuleCount === 'function') {
      this._syncCapsuleCount();
    }

    // v2.9.7：内容变了高度重新贴合（上限由设置页的「浮窗最大高度」控制）
    if (typeof this._autoFitHeight === 'function') {
      this._autoFitHeight();
    }
    },

    toggleDisplayMode() {
    // 确保displayMode有值
    if (!this.displayMode) {
      this.displayMode = 'vertical';
    }

    // 立即切换显示模式
    this.displayMode = this.displayMode === 'horizontal' ? 'vertical' : 'horizontal';

    // v2.5.45：记住这类媒体的显示方向，下次打开直接沿用
    if (typeof this._saveUiPref === 'function') {
      const mt = (typeof this.getMediaType === 'function') ? this.getMediaType() : 'default';
      this._saveUiPref(mt, { layout: this.displayMode });
    }

    // 先直接更新表格显示，确保视图更新（用户主动操作，强制重建）
    this.updateTable(true);

    // 由于updateTable会重新创建按钮区域，这里不需要额外更新按钮文本
    },

    /**
     * 浮窗 Shadow 里是否存在非空选区（用户正在选字准备复制）。
     * 选区在 Shadow DOM 内时，document.getSelection() 的 anchorNode 仍指向 shadow 内节点。
     */
    _isSelectingInWindow() {
    try {
      const fw = this.floatingWindow;
      if (!fw) return false;
      const root = (typeof fw.getShadowRoot === 'function') ? fw.getShadowRoot() : null;
      if (!root) return false;
      const sel = (typeof window.getSelection === 'function') ? window.getSelection() : null;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      const anchor = sel.anchorNode;
      const focus = sel.focusNode;
      return !!((anchor && root.contains(anchor)) || (focus && root.contains(focus)));
    } catch (e) {
      return false;
    }
    },

    /**
     * 监听选区结束，把被推迟的那次重建补上（只挂一个监听器）。
     * selectionchange 是 document 级事件，Shadow DOM 内的选区变化也会在 document 上派发。
     */
    _watchSelectionEnd() {
    if (this._selectionEndWatcher) return;
    const self = this;
    this._selectionEndWatcher = function () {
      // 还在选（或改选了别的内容）→ 继续等
      if (self._isSelectingInWindow()) return;
      const pending = self._pendingTableRefresh;
      self._pendingTableRefresh = false;
      self._clearSelectionWatcher();
      // 有被推迟的刷新才补；否则只是清理监听器
      if (pending) self.updateTable(true);
    };
    document.addEventListener('selectionchange', this._selectionEndWatcher, true);
    },

    _clearSelectionWatcher() {
    if (this._selectionEndWatcher) {
      try { document.removeEventListener('selectionchange', this._selectionEndWatcher, true); } catch (e) { ClipMateLog.debug('[ClipMate] 已忽略异常:', e && e.message); }
      this._selectionEndWatcher = null;
    }
    },

    /**
     * 单元格交互（v2.5.45，v2.5.52 改为双击复制）
     * - 点「展开 / 收起」只切换长文本折叠（仍是单击）
     * - 单击单元格什么都不做，交给浏览器正常选中文字
     * - **双击单元格**才复制该字段的值
     * - 编辑模式下不绑定（那时点击是拖拽排序）
     * 监听挂在内容区上，updateTable 重建子节点不会丢。
     */
    _bindTableCellActions(contentElement) {
    if (!contentElement || contentElement.__clipmateCellBound) return;
    contentElement.__clipmateCellBound = true;

    contentElement.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      // 展开 / 收起（复制已挪到 dblclick，这里只留折叠开关）
      const toggle = target.closest('.data-field-toggle');
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        // 以「所在的单元格」为作用域找目标文本节点，比 parentElement 稳
        // （万一以后给单元格再套一层容器，parentElement 就指错层了）
        const holder = toggle.closest('td[data-field]') || toggle.parentElement;
        const field = holder ? holder.querySelector('.data-field') : null;
        if (!field) return;
        const nowCollapsed = field.classList.toggle('is-clampable');
        toggle.textContent = nowCollapsed ? '展开' : '收起';
        return;
      }
    });

    // v2.5.52：复制改由双击触发。单击只做文字选择，避免选个词就把整格内容顶掉剪贴板。
    contentElement.addEventListener('dblclick', (e) => {
      const target = e.target;
      if (!target || !target.closest) return;

      // 双击「展开 / 收起」不复制（那一下只该折叠）
      if (target.closest('.data-field-toggle')) return;

      const cell = target.closest('td[data-field]');
      if (!cell) return;
      if (this.isEditMode) return;            // 编辑模式下点击用于拖拽排序
      if (cell.querySelector('a')) return;     // 链接交给浏览器默认行为

      // 注意：这里不能再做「已有选区就跳过」的判断。
      // 浏览器双击本身就会选中光标处的一个词，那个判断放在双击里会把复制永远拦掉。

      const fieldName = cell.dataset.field;
      const value = this.data ? this.data[fieldName] : '';
      if (!value) return;
      this._copyCellValue(cell, value, fieldName);
    });
    },

    /** 复制单个字段的值，并给出视觉 + 提示反馈 */
    _copyCellValue(cell, value, fieldName) {
    let settled = false;
    let guard = null;

    const done = () => {
      if (settled) return;
      settled = true;
      if (guard) { clearTimeout(guard); guard = null; }
      try {
        cell.classList.add('is-copied');
        setTimeout(() => cell.classList.remove('is-copied'), 600);
      } catch (e) { /* 视觉反馈失败不影响复制结果 */ }
      const notice = (typeof window !== 'undefined') ? window.ClipMateNotice : null;
      if (notice && typeof notice.show === 'function') {
        notice.show('已复制「' + (fieldName || '') + '」', 'success');
      }
    };

    const fallback = () => this._copyViaTextarea(value, done);

    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        // 某些环境（没有用户手势、或策略限制）writeText 既不 resolve 也不 reject，
        // 会一直挂着——那样下面 .then/.catch 都不跑，用户点了格子一点反应都没有。
        // 500ms 还没落地就直接走兜底，保证反馈一定会出现。
        guard = setTimeout(fallback, 500);
        navigator.clipboard.writeText(value).then(() => done(), fallback);
        return;
      }
    } catch (e) { /* 落到兜底 */ }
    fallback();
    },

    /** 剪贴板 API 不可用时的兜底复制 */
    _copyViaTextarea(value, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {
      console.warn('[ClipMate] 复制单元格失败:', e && e.message);
    } finally {
      // 无论成败都给出反馈：这里失败通常意味着运行环境禁了剪贴板
      // （自动化测试就是这种情况），用户至少要知道「点了什么」。
      if (typeof done === 'function') done();
    }
    },

  };
})(window);

if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalTableMixin);
}
