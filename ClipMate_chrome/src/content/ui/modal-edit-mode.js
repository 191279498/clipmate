/**
 * ModalManager 编辑模式模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  global.ModalEditMixin = {

    /* v2.5.93：把「现在是不是编辑模式」同步成标题栏底色。
       标题文字（原「媒体信息预览 - 编辑模式」）已隐藏，靠底色提示用户在改数据。
       每次进出编辑模式都必须调，漏一处就会出现「底色和实际状态不一致」。 */
    _syncHeaderEditVisual() {
      const win = this.floatingWindow;
      if (win && typeof win.setEditModeVisual === 'function') {
        win.setEditModeVisual(!!this.isEditMode);
      }
    },

    initDragAndDrop() {
    // 只在编辑模式下初始化拖拽功能
    if (!this.isEditMode) return;

    // 获取悬浮窗内容区域
    const contentElement = this.floatingWindow.getContentElement();
    if (!contentElement) return;

    const table = contentElement.querySelector('#dataTable');
    if (!table) return;

    const headers = table.querySelectorAll('.sortable-header');

    // v2.5.45（B17）：拖拽落点可视化 + 消除错位一格
    // 旧实现只有 dragover 的 preventDefault，看不到会插到哪儿；
    // 落点判定还依赖「删除后再按旧下标插入」，往右拖时必然偏一格。
    // 现在按指针相对目标表头的中线决定「插在前面还是后面」，并画一条插入线。
    const clearIndicators = () => {
      headers.forEach((h) => h.classList.remove('drop-before', 'drop-after'));
    };

    // 当前指针落在目标的哪一侧：横向看 clientX，纵向看 clientY
    const isAfter = (header, e) => {
      const rect = header.getBoundingClientRect();
      const horizontal = !!table.querySelector('thead');
      const offset = horizontal ? (e.clientX - rect.left) : (e.clientY - rect.top);
      const size = horizontal ? rect.width : rect.height;
      return offset > size / 2;
    };

    headers.forEach(header => {
      header.draggable = true;

      header.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', header.dataset.field);
        e.dataTransfer.effectAllowed = 'move';
        header.classList.add('dragging');
      });

      header.addEventListener('dragend', () => {
        header.classList.remove('dragging');
        clearIndicators();
      });

      header.addEventListener('dragover', (e) => {
        e.preventDefault();
        // 拖动中的元素自己不画落点线
        if (header.classList.contains('dragging')) return;
        const after = isAfter(header, e);
        header.classList.toggle('drop-after', after);
        header.classList.toggle('drop-before', !after);
      });

      header.addEventListener('dragleave', () => {
        header.classList.remove('drop-before', 'drop-after');
      });

      header.addEventListener('drop', (e) => {
        e.preventDefault();
        const after = isAfter(header, e);
        const draggedField = e.dataTransfer.getData('text/plain');
        const targetField = header.dataset.field;
        clearIndicators();

        if (draggedField && draggedField !== targetField) {
          this.reorderFields(draggedField, targetField, after);
        }
      });
    });
    },

    /**
     * 把 draggedField 移动到 targetField 的前面或后面（v2.5.45 修正错位一格）
     *
     * @param {string} draggedField 被拖动的字段
     * @param {string} targetField  落点所在字段
     * @param {boolean} after       true=插到目标之后，false=插到目标之前
     */
    reorderFields(draggedField, targetField, after) {
    // 只在编辑模式下允许重排序
    if (!this.isEditMode) return;

    const list = this.fieldOrder.slice();
    const from = list.indexOf(draggedField);
    if (from < 0) return;

    // 关键：先在副本里摘掉被拖项，再找目标下标。
    // 旧代码在「原数组」上先删后按旧下标插，往右拖时目标下标已左移一位，于是多偏一格。
    list.splice(from, 1);
    const targetIndex = list.indexOf(targetField);
    if (targetIndex < 0) return;

    const insertAt = after ? targetIndex + 1 : targetIndex;
    list.splice(insertAt, 0, draggedField);

    this.fieldOrder = list;

    // 重新渲染表格
    this.updateTable(true);
    },

    // 表头编辑功能 {
  startHeaderEditing(headerElement) {
    // 只在编辑模式下允许编辑
    if (!this.isEditMode || headerElement.classList.contains('editing')) return;

    const fieldName = headerElement.dataset.field;
    const currentValue = fieldName; // 表头显示的是字段名

    headerElement.classList.add('editing');
    const originalContent = headerElement.innerHTML;

    headerElement.innerHTML = `
      <input type="text" class="header-editor" value="${this.escapeHtml(currentValue)}" />
    `;

    const input = headerElement.querySelector('.header-editor');
    input.focus();
    input.select();

    const finishEditing = async () => {
      const newValue = input.value.trim();
      if (newValue && newValue !== currentValue) {
        // 保存当前编辑模式状态，确保在异步操作后保持一致
        const editMode = this.isEditMode;

        try {
          // 直接保存字段映射
          await this.saveFieldMapping(fieldName, newValue);

          // 重新加载映射并更新UI
          await this.applyFieldMappings();

          // 确保isEditMode状态正确
          this.isEditMode = editMode;
          this.updateTable(true);
        } catch (error) {
          console.error('编辑保存失败:', error);
          // 恢复编辑模式状态
          this.isEditMode = editMode;
        }
      } else {
        // 恢复原始内容
        headerElement.classList.remove('editing');
        headerElement.innerHTML = originalContent;
      }
    };

    input.addEventListener('blur', finishEditing);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        finishEditing();
      } else if (e.key === 'Escape') {
        headerElement.classList.remove('editing');
        headerElement.innerHTML = originalContent;
      }
    });
    },

    /**
     * v2.12.1：编辑模式下双击单元格改**内容**（用户 2026-11-05 要求）。
     *
     * 复用 .field-editor 类：表头改名用的就是这套输入框外观，两种编辑长得一样，
     * 用户不用重新学一遍。用 textarea 而非 input —— 简介/其他信息带换行，
     * input 会把换行吃掉，一保存就压成一整行。
     *
     * 保存规则：值真的变了才写回 this.data（复制 / 导出读的就是它）；
     * 没变只把 DOM 还原，不触发重渲染，避免无谓闪一下。
     */
    startFieldValueEditing(cell) {
      if (!this.isEditMode || !cell) return;
      if (cell.getAttribute('data-editing') === '1') return;

      const fieldName = cell.dataset.field;
      if (!fieldName) return;

      const originalHTML = cell.innerHTML;
      const rawValue = (this.data && this.data[fieldName] != null) ? String(this.data[fieldName]) : '';

      cell.setAttribute('data-editing', '1');

      const editor = document.createElement('textarea');
      editor.className = 'field-editor';
      editor.value = rawValue;
      editor.rows = this._estimateEditorRows(rawValue);

      cell.innerHTML = '';
      cell.appendChild(editor);
      editor.focus();
      // 光标落在末尾，方便接着改；个别环境不支持 setSelectionRange，忽略即可
      try { editor.setSelectionRange(rawValue.length, rawValue.length); } catch (e) { /* 忽略 */ }

      let finished = false;

      const restore = () => {
        cell.removeAttribute('data-editing');
        cell.innerHTML = originalHTML;
      };

      const commit = () => {
        if (finished) return;
        finished = true;
        cell.removeAttribute('data-editing');

        const nextValue = editor.value.replace(/^\s+|\s+$/g, '');
        if (nextValue === rawValue) {
          restore();
          return;
        }

        this.data[fieldName] = nextValue;

        // 影视类「URL」是自动拼出来的合并串（modal-data-processor._mergeLinksIntoUrl）。
        // 用户手工改过就以手工值为准，否则下一次重渲染会立刻把 IMDB/TMDB 段拼回去、
        // 把手改的内容盖掉。标记在 cancelEdit / 新数据到来时清掉。
        const mt = (typeof this.getMediaType === 'function') ? this.getMediaType() : '';
        if ((mt === 'movie' || mt === 'tv' || mt === 'media') && fieldName === 'URL') {
          this._urlManuallyEdited = true;
        }

        this.updateTable(true);

        const displayName = (this.fieldMappings && this.fieldMappings[fieldName]) || fieldName;
        if (typeof this.showMessage === 'function') {
          this.showMessage('已修改「' + displayName + '」', 'success');
        }
      };

      editor.addEventListener('blur', commit);
      editor.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          // 必须拦住冒泡：document 上的 ESC 监听会顺手把整个浮窗关掉
          e.preventDefault();
          e.stopPropagation();
          finished = true;
          restore();
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter 保存、Shift+Enter 换行 —— 与表头改名同一套手感
          e.preventDefault();
          e.stopPropagation();
          commit();
        }
      });
    },

    /**
     * 估算值编辑器行数（1～8 行）：显式换行 + 粗估折行。
     * 值列宽约 200px、12px 字号一行约 20 个汉字，所以用 20 做除数。
     */
    _estimateEditorRows(text) {
      const s = String(text == null ? '' : text);
      let rows = 0;
      s.split('\n').forEach((line) => {
        rows += 1 + Math.floor(line.length / 20);
      });
      return Math.max(1, Math.min(8, rows));
    },

    // 重置字段顺序为默认顺序 {
  resetOrder() {
    // 只在编辑模式下允许重置顺序
    if (!this.isEditMode) return;

    // 获取媒体类型
    const mediaType = this.getMediaType();

    // 重置为数据对象的默认键顺序
    this.fieldOrder = Object.keys(this.data);

    // 使用统一的展示顺序配置
    let displayOrder = [];

    // 尝试从mediaConfig获取展示顺序（支持子类型继承父类型顺序）
    if (mediaConfig && mediaConfig.getDisplayOrder) {
      displayOrder = mediaConfig.getDisplayOrder(mediaType);
    }

    // 如果获取到了有效的展示顺序，则应用它
    if (displayOrder.length > 0) {
      // 按照指定顺序重新排列字段
      const newFieldOrder = [];
      const remainingFields = [...this.fieldOrder];

      // 先添加指定顺序中的字段
      displayOrder.forEach(field => {
        const index = remainingFields.indexOf(field);
        if (index !== -1) {
          newFieldOrder.push(field);
          remainingFields.splice(index, 1);
        }
      });

      // 然后添加剩余的字段
      newFieldOrder.push(...remainingFields);

      this.fieldOrder = newFieldOrder;
    } else {
      // 如果没有获取到展示顺序配置，使用传统的媒体类型特定排序作为后备
      if (mediaType === 'book') {
        const bookDefaultOrder = ['书名', '作者', '原作名', '发布日期', '简介', '网络评分', '豆瓣链接', 'URL', 'ISBN', '篇幅', '别名', '其他信息'];

        // 按照指定顺序重新排列字段
        const newFieldOrder = [];
        const remainingFields = [...this.fieldOrder];

        // 先添加指定顺序中的字段
        bookDefaultOrder.forEach(field => {
          const index = remainingFields.indexOf(field);
          if (index !== -1) {
            newFieldOrder.push(field);
            remainingFields.splice(index, 1);
          }
        });

        // 然后添加剩余的字段
        newFieldOrder.push(...remainingFields);

        this.fieldOrder = newFieldOrder;
      }
      else if (mediaType === 'media' || this.isMediaTypeSubtype(mediaType, 'media')) {
        // 影视类使用统一的默认顺序作为后备
        // v2.5.67：「标签」插在「别名」之后（与 media-types.js 的清单顺序一致）
        // v2.11.2：IMDB / TMDB / Bangumi 三列撤销，改成在「URL」一格内合并展示
        // （见 modal-data-processor 的 _mergeLinksIntoUrl），这里只同步兜底顺序。
        const mediaDefaultOrder = ['名字', '别名', '标签', '影视类型', '上映日期', '简介', '网络评分',
          '原作名', '豆瓣链接', 'URL', '导演', '编剧', '主演', '片长', '集数', '单集片长', '其他信息'];

        // 按照指定顺序重新排列字段
        const newFieldOrder = [];
        const remainingFields = [...this.fieldOrder];

        // 先添加指定顺序中的字段
        mediaDefaultOrder.forEach(field => {
          const index = remainingFields.indexOf(field);
          if (index !== -1) {
            newFieldOrder.push(field);
            remainingFields.splice(index, 1);
          }
        });

        // 然后添加剩余的字段
        newFieldOrder.push(...remainingFields);

        this.fieldOrder = newFieldOrder;
      }
    }

    this.updateTable(true);

    // 显示适当的消息
    if (displayOrder.length > 0) {
      this.showMessage('字段顺序已重置为统一展示顺序');
    } else {
      this.showMessage('字段顺序已重置为默认顺序');
    }
    },

    // 进入编辑模式 {
  enterEditMode() {
    this.isEditMode = true;
    this.updateTable(true);
    this._syncHeaderEditVisual();   // v2.5.93：标题栏变橙
    this.showMessage('已进入编辑模式：双击表头改字段名，双击格子改内容，拖动表头调顺序', 'info');
    },

    // 取消编辑 {
  cancelEdit() {
    // 恢复原始数据和字段顺序
    this.data = JSON.parse(JSON.stringify(this.originalData));
    this.fieldOrder = [...this.originalFieldOrder];
    // v2.12.1：手工改过 URL 的保护标记也要一起撤，否则取消编辑后
    // 影视页的跨站补链会被这个残留标记一直挡住。
    this._urlManuallyEdited = false;
    this.isEditMode = false;
    this.updateTable(true);
    this._syncHeaderEditVisual();   // v2.5.93：标题栏恢复浅灰
    this.showMessage('已取消编辑，恢复原始状态', 'info');
    },

    // 确认编辑并保存更改 {
  async confirmEdit() {
    // 保存字段映射（需要找出所有被重命名的字段）
    const originalKeys = Object.keys(this.originalData);
    const currentKeys = Object.keys(this.data);

    // 找出被重命名的字段并保存映射
    for (const originalKey of originalKeys) {
      let found = false;
      for (const currentKey of currentKeys) {
        if (this.originalData[originalKey] === this.data[currentKey]) {
          // 数据值相同，但字段名可能不同
          if (originalKey !== currentKey) {
            await this.saveFieldMapping(originalKey, currentKey);
          }
          found = true;
          break;
        }
      }
    }

    // 保存字段顺序
    await this.saveFieldOrder();

    // 退出编辑模式
    this.isEditMode = false;
    this.updateTable(true);
    this._syncHeaderEditVisual();   // v2.5.93：标题栏恢复浅灰
    this.showMessage('修改已保存');

    // 更新原始数据引用，以便下次编辑使用
    this.originalData = JSON.parse(JSON.stringify(this.data));
    this.originalFieldOrder = [...this.fieldOrder];
    },

  };
})(window);

if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalEditMixin);
}
