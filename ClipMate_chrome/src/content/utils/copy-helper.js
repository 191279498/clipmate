/**
 * 复制功能工具函数
 *
 * 从 content-main.js MediaExtractor 类中抽离的复制相关函数。
 */

(function(global) {
  'use strict';

  const C = {};

  /**
   * 根据选择的格式格式化提取数据，用于自动复制
   */
  C.formatDataForCopy = function(data, format) {
    if (!data) return '';

    switch (format) {
      case 'notion': {
        const lines = [];
        for (const [key, value] of Object.entries(data)) {
          if (value && value.toString().trim()) {
            lines.push(`${key}\t${value}`);
          }
        }
        return lines.join('\n');
      }

      case 'markdown': {
        const rows = [];
        for (const [key, value] of Object.entries(data)) {
          if (value && value.toString().trim()) {
            rows.push(`| ${key} | ${value} |`);
          }
        }
        if (rows.length === 0) return '';
        return `| 字段 | 值 |\n| --- | --- |\n${rows.join('\n')}`;
      }

      case 'plain':
      default: {
        const lines = [];
        for (const [key, value] of Object.entries(data)) {
          if (value && value.toString().trim()) {
            lines.push(`${key}：${value}`);
          }
        }
        return lines.join('\n');
      }
    }
  };

  /**
   * 复制降级方案：使用隐藏 textarea + document.execCommand('copy')
   */
  C.copyFallback = function(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.height = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  // 注册到全局
  global.CopyHelper = C;

})(window);
