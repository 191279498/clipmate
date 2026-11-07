/**
 * ModalManager 复制导出模块
 * 通过 Object.assign 合并到 ModalManager.prototype。
 */
(function(global) {
  'use strict';

  global.ModalCopyMixin = {

    cleanData(text) {
    // 处理null、undefined或空值
    if (!text) return '';

    // 确保是字符串类型，如果不是则转换为字符串
    if (typeof text !== 'string') {
      // 如果是数组，转换为逗号分隔的字符串
      if (Array.isArray(text)) {
        text = text.join(', ');
      } else {
        // 其他类型转换为字符串
        text = String(text);
      }
    }

    // 替换制表符为空格
    text = text.replace(/\t/g, ' ');
    // 替换多余的换行符（连续多个换行替换为单个）
    text = text.replace(/\n{3,}/g, '\n\n');
    // 去除首尾空白
    return text.trim();
    },

    /**
     * 纯文本单元格（TSV / Excel）：Markdown 链接降级成「@某人」，换行压成空格
     *
     * 为什么必须压换行：TSV 里单元格内的 `\n` 会被 Excel 当成换行，
     * 一条人物记录会裂成好几行（抖音签名有天生的多行）。
     * 为什么必须降级链接：复制到 Excel 是给表格看的，`[@四叶草.](https://…)`
     * 在单元格里是纯噪音。（v2.7.14）
     */
    plainCell(text) {
    if (!text) return '';
    return String(text)
      .replace(/\[([^\[\]\n]{1,200})\]\((https?:\/\/[^\s()<>"']+)\)/g, '$1')
      .replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .trim();
    },

    /**
     * HTML 单元格（粘到 Notion / 富文本编辑器）：Markdown 链接转成真 <a>，换行转 <br>
     *
     * 做法是「先整体转义、再替换成标签」：转义保证原文里的尖括号不会变成标签，
     * 替换插入的 <a> 因此不会被二次转义。URL 里被转义成 &amp; 的 & 在属性里是合法的。
     */
    richCell(text) {
    const escaped = this.escapeHtml(text == null ? '' : String(text));
    return escaped
      .replace(/\[([^\[\]\n]{1,200})\]\((https?:\/\/[^\s()<>"']+)\)/g, (m, label, url) => `<a href="${url}">${label}</a>`)
      .replace(/\n/g, '<br>');
    },

    async copyData() {
    try {
      // v2.12.11：默认全量（含空字段，顺序不变）；B / 自定义档才按「复制隐藏」过滤。
      // 只单独加载本 mixin 的测试替身没有 _visibleFields（真整机由 modal-table-renderer 挂上），
      // 这种情况退回 this.fieldOrder，绝不能让复制功能整个抛错。
      const fieldsToCopy = (typeof this._visibleFields === 'function')
        ? this._visibleFields(this.fieldOrder, 'copy') : this.fieldOrder;

      const dataItems = [];
      for (const fieldName of fieldsToCopy) {
        const value = this.data[fieldName];
        const cleanValue = value !== null && value !== undefined ? this.cleanData(value) : '';
        dataItems.push({ field: fieldName, value: cleanValue });
      }

      // 1. 生成TSV格式（Excel兼容）
      // 注意：只复制数据行，跳过表头
      const tsvValues = dataItems.map(item => this.plainCell(item.value));
      const tsvData = tsvValues.join('\t');

      // 2. 生成HTML表格格式（Notion兼容）
      let html = '<table>';
      html += '<tbody><tr>';
      dataItems.forEach(item => {
        html += `<td>${this.richCell(item.value)}</td>`;
      });
      html += '</tr></tbody>';
      html += '</table>';

      // 尝试使用ClipboardItem API进行多格式复制
      if (window.ClipboardItem && navigator.clipboard.write) {
        // 创建Blob对象
        const tsvBlob = new Blob([tsvData], { type: 'text/plain' });
        const htmlBlob = new Blob([html], { type: 'text/html' });

        // 创建ClipboardItem对象
        const clipboardItem = new ClipboardItem({
          'text/plain': tsvBlob,
          'text/html': htmlBlob
        });

        // 写入剪贴板
        await navigator.clipboard.write([clipboardItem]);
        this.showMessage('数据已复制（HTML和TSV双格式）', 'success');
        return true; // v2.5.47（B7）：把成功与否交回调用方，按钮才能变「已复制」
      } else {
        // 降级方案：使用execCommand，优先复制HTML格式
        try {
          // 创建临时元素
          const tempElement = document.createElement('div');
          tempElement.style.position = 'fixed';
          tempElement.style.left = '-9999px';
          tempElement.innerHTML = html;
          document.body.appendChild(tempElement);

          // 创建选区
          const range = document.createRange();
          range.selectNode(tempElement);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);

          // 执行复制
          const successful = document.execCommand('copy');
          document.body.removeChild(tempElement);

          if (successful) {
            this.showMessage('数据已复制（HTML格式）', 'success');
            return true; // v2.5.47（B7）
          } else {
            // 如果HTML复制失败，尝试复制TSV
            return await this.copyToClipboard(tsvData, '数据已复制（TSV格式）');
          }
        } catch (execError) {
          // 最终降级到简单的文本复制
          return await this.copyToClipboard(tsvData, '数据已复制（TSV格式）');
        }
      }
    } catch (error) {
      console.error('复制数据失败:', error);
      this.showMessage('复制失败，请手动复制', 'error');
      return false; // v2.5.47（B7）
    }
    },

    async copyDataAsMarkdown() {
    try {
      // v2.12.11：同 copyData，按「复制隐藏」档位过滤（A 档仍是全量）；
      // 兜底原因同上，单独加载本 mixin 时不许抛错。
      const fieldsToCopy = (typeof this._visibleFields === 'function')
        ? this._visibleFields(this.fieldOrder, 'copy') : this.fieldOrder;

      // 确保displayMode有值
      if (!this.displayMode) {
        this.displayMode = 'vertical';
      }

      // 获取媒体类型，用于判断是否为社交媒体
      const mediaType = this.getMediaType();

      // 根据展示模式生成不同方向的Markdown表格
      let markdown = '';

      if (this.displayMode === 'horizontal') {
        // 横向模式：表头是字段名，数据行是字段值
        const dataItems = [];
        for (const fieldName of fieldsToCopy) {
          const value = this.data[fieldName];
          let cleanValue = value !== null && value !== undefined ? this.cleanData(value) : '';

          // 对社交媒体类型的URL字段进行特殊处理
          // 只处理社交「URL」；人物档案「网址」直接输出网址本身，不做超链接（v2.7.13）
          if (mediaType === 'social' && fieldName === 'URL' && cleanValue) {
            cleanValue = `[点击访问](${cleanValue})`;
          }

          dataItems.push({ field: fieldName, value: cleanValue });
        }

        // 添加表头
        markdown += '| ' + dataItems.map(item => item.field).join(' | ') + ' |\n';

        // 添加分隔线
        markdown += '| ' + dataItems.map(() => '---').join(' | ') + ' |\n';

        // 添加数据行
        markdown += '| ' + dataItems.map(item => this.escapeMarkdown(item.value)).join(' | ') + ' |\n';
      } else {
        // 纵向模式：第一列是字段名，第二列是字段值
        markdown += '| 字段 | 内容 |\n';
        markdown += '| --- | --- |\n';

        for (const fieldName of fieldsToCopy) {
          const value = this.data[fieldName];
          let cleanValue = value !== null && value !== undefined ? this.cleanData(value) : '';

          // 对社交媒体类型的URL字段进行特殊处理
          // 只处理社交「URL」；人物档案「网址」直接输出网址本身，不做超链接（v2.7.13）
          if (mediaType === 'social' && fieldName === 'URL' && cleanValue) {
            cleanValue = `[点击访问](${cleanValue})`;
          }

          markdown += '| ' + this.escapeMarkdown(fieldName) + ' | ' + this.escapeMarkdown(cleanValue) + ' |\n';
        }
      }

      // 复制到剪贴板
      return await this.copyToClipboard(markdown, `数据已复制（${this.displayMode === 'horizontal' ? '横向' : '纵向'}Markdown格式）`);
    } catch (error) {
      console.error('复制Markdown数据失败:', error);
      this.showMessage('复制失败，请手动复制', 'error');
      return false; // v2.5.47（B7）
    }
    },

    /**
     * 复制为纯文本（v2.5.65）
     *
     * 和「复制Notion」「复制Markdown」的三点关键区别：
     *   1. 剪贴板里只放 text/plain 一份，**不放 HTML 副本** —— 一旦塞了 HTML 表格，
     *      Notion / 邮件 / Word 会把它重新还原成表格，那就不是「纯文本」了；
     *   2. 一行一条「字段：值」，没有表格线、没有 `|`、没有对齐空格；
     *   3. 空字段整行跳过（表格里空着不碍事，纯文本里留一行「别名：」很碍眼）。
     *
     * 多行内容（简介这种）保留换行、续行缩进两格，保证「一行一条」的结构不被打断。
     * 顺序仍走 this.fieldOrder（用户拖过的顺序生效），导出全量，不跟随搜索过滤，
     * 与另外两种复制保持一致。不受「横向 / 纵向」影响 —— 那个切换只对表格有意义。
     */
    async copyDataAsPlainText() {
    try {
      const fieldsToCopy = this.fieldOrder || [];
      const lines = [];

      for (const fieldName of fieldsToCopy) {
        const value = this.data ? this.data[fieldName] : '';
        const cleanValue = value !== null && value !== undefined ? this.cleanData(value) : '';
        if (!cleanValue) continue;

        // 按行拆开、去空行：多行内容里夹的空行在「一行一条」里没有意义，
        // 留着会看起来像两条字段之间断开了。第一行接在「字段：」后面，其余缩两格。
        const parts = String(cleanValue).split('\n').map(l => l.trim()).filter(l => l);
        if (!parts.length) continue;

        let block = fieldName + '：' + parts[0];
        if (parts.length > 1) block += '\n' + parts.slice(1).map(l => '  ' + l).join('\n');
        lines.push(block);
      }

      if (!lines.length) {
        this.showMessage('没有可复制的内容', 'error');
        return false;
      }

      const text = lines.join('\n');

      // 先走统一写入；正常是用户点了菜单项，有手势不会被拒
      const ok = await this.copyToClipboard(text, '已复制为纯文本');
      if (ok) return true;

      // 兜底：writeText 被拒（无手势 / 权限）时退回 execCommand
      return this._copyPlainTextFallback(text);
    } catch (error) {
      console.error('复制纯文本失败:', error);
      this.showMessage('复制失败，请手动复制', 'error');
      return false;
    }
    },

    /**
     * 纯文本写入兜底（v2.5.65）：textarea + execCommand('copy')
     * 只在 copyToClipboard 失败时用，不改动另外两种复制的写入路径。
     */
    _copyPlainTextFallback(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) {
        this.showMessage('已复制为纯文本', 'success');
        return true;
      }
      this.showMessage('复制失败，请手动复制', 'error');
      return false;
    } catch (e) {
      console.warn('[ClipMate] 纯文本兜底复制失败:', e && e.message);
      this.showMessage('复制失败，请手动复制', 'error');
      return false;
    }
    },

    escapeMarkdown(text) {
    if (!text) return '';

    // 转义Markdown中的特殊字符
    return text.toString()
      .replace(/\|/g, '\\|')     // 转义管道符
      .replace(/\n/g, '<br>')    // 将换行符转换为HTML换行标签
      .replace(/\r/g, '');       // 移除回车符
    },

    async copyToClipboard(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      this.showMessage(successMessage, 'success');
      return true; // v2.5.47（B7）
    } catch (err) {
      console.error('复制失败:', err);
      this.showMessage('复制失败，请手动复制', 'error');
      return false; // v2.5.47（B7）
    }
    },

    /**
     * 显示提示（v2.5.44 起统一交给 ClipMateNotice 渲染）
     *
     * 相比旧实现的两处关键变化：
     *   1. 不再 appendChild 到网页 body —— 提示会塞进浮窗 Shadow DOM 的标题栏下方（横幅），
     *      浮窗不存在时（例如提取失败）才退回页面顶部居中的卡片；
     *   2. 不再有 setTimeout —— 不会 3 秒后自动消失，只能点右侧 × 关掉，或等下一条提示替换。
     *
     * @param {string} message 提示文字
     * @param {string} type    success | error | info
     */
    showMessage(message, type = 'success') {
    const notice = (typeof window !== 'undefined') ? window.ClipMateNotice : null;
    if (notice && typeof notice.show === 'function') {
      notice.show(message, type);
      return;
    }

    // 兜底：组件未加载时至少还能看到提示（同样不自动消失）
    console.warn('[ClipMate] 提示组件未加载，降级显示:', message);
    const fallbackType = (type === 'error') ? 'error' : (type === 'info' ? 'info' : 'success');
    const messageEl = document.createElement('div');
    messageEl.className = 'clipmate-notice clipmate-notice--page clipmate-notice--' + fallbackType;
    messageEl.textContent = message;
    messageEl.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 14px;background:#fff;border:1px solid #333;font-size:14px;';
    document.body.appendChild(messageEl);
    },

    escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
    },

  };
})(window);

if (typeof ModalManager !== 'undefined') {
  Object.assign(ModalManager.prototype, ModalCopyMixin);
}
