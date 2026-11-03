/**
 * 浮窗内部样式（注入 Shadow DOM）
 *
 * 【为什么样式写在 JS 字符串里，而不是独立的 .css 文件】
 *   1. Shadow DOM 内部的样式表无法通过 manifest 的 content_scripts.css 注入，那只作用于页面；
 *   2. 用 <link> 引外部文件是异步加载，首次打开会闪一下“无样式”的裸 DOM；
 *   3. 写成字符串同步塞进 <style>，零延迟、零额外权限（不需要 web_accessible_resources）。
 *
 * 【为什么这里一条 !important 都不写】
 *   Shadow DOM 会把页面样式彻底挡在外面，这里只与浏览器默认样式竞争，本表规则一律能赢。
 *   反过来——这里绝对不能给 background / color / opacity / display / 宽度高度 加 !important，
 *   否则会压死 floating-window.js、modal-manager.js 里用 element.style 做的悬停变色、
 *   折叠隐藏、拖拽缩放、最大化等动态效果。
 *
 * 【尺寸规范（v2.5.41 起全站统一，改这里就是改所有站点）】
 *   字号 12px ｜ 行高 1.3 ｜ 表头与内容同为常规体 400 ｜ 系统默认字体 ｜ 全白底极简
 *
 * 【字体为何用 inherit】
 *   字体由宿主元素（.media-floating-window）的内联样式 + content-styles.css 的 !important 加固共同钉死，
 *   shadow 内一律 inherit 取到同一份值，避免在这份字符串里重复写长串字体栈。
 */
(function () {
  'use strict';

  window.FLOATING_WINDOW_CSS = `
/* ==================== 统一基线 ==================== */
.floating-window-header,
.floating-window-title,
.floating-window-title-buttons,
.floating-window-title-button,
.floating-window-close,
.floating-window-collapse-handle,
.floating-window-content,
.data-table,
.data-table th,
.data-table td,
.data-field,
.header-editor,
.field-editor,
.btn {
  box-sizing: border-box;
  font-family: inherit;
  font-style: normal;
  font-variant: normal;
  letter-spacing: normal;
  word-spacing: normal;
  text-transform: none;
  -webkit-font-smoothing: inherit;
}

/* ==================== 标题栏 ==================== */
.floating-window-header {
  background: #F1EFE8;
  padding: 10px 15px;
  border-bottom: 1px solid #E1DCD1;
  border-top: none;
  border-left: none;
  border-right: none;
  cursor: move;
  display: flex;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  position: relative;
  margin: 0;
}

/* v2.5.93：标题文字隐藏，腾出 120px 给右侧工具栏。
   元素还在（setTitle 仍往里写），但 display:none 后不占任何宽度、
   也不参与 flex 分配，按钮组从左往右铺开即可。
   注意：这行的空白仍属标题栏，按住照样能拖窗口。 */
.floating-window-title {
  display: none;
}

/* v2.5.93：编辑模式视觉提示。
   标题文字里的「 - 编辑模式」随标题一起消失，改用整条标题栏换底色。
   底色写在样式表、不写内联，保证退出编辑时 class 一去就恢复原色。 */
.floating-window-header.is-edit-mode {
  background: #FDF3D6;
  border-bottom-color: #E8C46A;
}

.floating-window-title-buttons {
  /* v2.5.47：按钮从 5 个增到 7 个（+🔍 +⋯ +—），间距从 8px 收到 6px。
     v2.5.73（批3·方案乙）：按钮不再收进⋯ 菜单，全部直接摊在标题栏。
     容器从 flex:0 0 auto 改成 flex:0 1 auto —— 必须**允许收缩**，内部才可能触发折行
     （定宽容器永远等于内容宽度，flex-wrap 就永远不会生效）。
     空间够 → 一行排开；不够 → 自己折到第二行，不再挤掉标题、也不出横向滚动条。
     justify-content 从 flex-end 改 flex-start：折行后每一行都左对齐才整齐，
     单行时容器宽度等于内容宽度，两种取值视觉上没有差别。 */
  flex: 0 1 auto;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  align-items: center;
  align-content: center;
  margin: 0 10px;
  gap: 6px;
  padding: 0;
  min-width: 0;
}

/* 按钮的 background / color / opacity 由 JS 悬停动态改写，此处只定基础排版 */
.floating-window-title-button {
  font-size: 12px;
  font-weight: 400;
  line-height: 1.2;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  margin: 0;
  text-align: center;
  vertical-align: middle;
}

/* 初始 background / color 在这里定，悬停时由 JS 写内联样式覆盖（内联优先于本表） */

/* v2.8.5：高频区 / 低频区之间的细分隔线。
   是真元素（div），不是 ::after —— 按钮容器是 flex-wrap，
   伪元素折行时会挂在最后一个按钮的尾巴上，分隔线就跑到行中间去了。
   align-self:center 让它和按钮垂直居中；高度按小字行高取，不撑高标题栏。 */
.floating-window-title-divider {
  width: 1px;
  height: 16px;
  flex: none;
  align-self: center;
  margin: 0 2px;
  background: #CBC5B7;
}
.floating-window-close {
  width: 24px;
  height: 24px;
  min-width: 24px;
  border-radius: 50%;
  background: #E8E4D9;
  color: #6B7278;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 18px;
  font-weight: 400;
  line-height: 1;
  padding: 0;
  border: none;
  margin: 0;
  flex: 0 0 auto;
  text-align: center;
  transition: all 0.2s;
}

/* ==================== 提示横幅（v2.5.44） ====================
 * 位置：标题栏正下方，横跨整个浮窗宽度，占独立一行（内容区 flex:1 自动让位，无需 JS 重排）。
 * 为什么这么设计：复制是高频操作，反馈必须落在视线内、面积够大、且不遮挡表格。
 * 不自动消失 —— 浮窗内不允许出现定时器，只能点右侧 × 或等下一条替换。
 * 配色用低饱和浅底深字，和「全白极简」不冲突，但色块面积足够一眼看到。
 * 折叠状态下横幅同样可见，高度由 floating-window.js 的 _applyCollapsedHeight() 一起算。
 */
.clipmate-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  min-height: 40px;
  padding: 10px 14px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: normal;
  text-align: left;
  user-select: text;
}

/* 浮窗形态：贴边、无圆角，靠左侧色条和底色区分状态 */
.clipmate-notice--window {
  flex: 0 0 auto;
  width: 100%;
  border-radius: 0;
  border-left: 4px solid transparent;
  border-bottom: 1px solid #E1DCD1;
  animation: clipmate-notice-in 180ms ease-out;
}

.clipmate-notice--success {
  background: #EAF7F0;
  border-left-color: #0E7A3E;
  color: #0B5A2E;
}

.clipmate-notice--error {
  background: #FDECEC;
  border-left-color: #B42318;
  color: #8C1D16;
}

.clipmate-notice--info {
  background: #EEF4FF;
  border-left-color: #056BF4;
  color: #0448A6;
}

.clipmate-notice-icon {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.clipmate-notice-icon svg {
  display: block;
}

.clipmate-notice-text {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: normal;
}

/* 关闭按钮：不加强制优先级，颜色继承当前状态文字色，靠 opacity 表达可点击 */
.clipmate-notice-close {
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  min-width: 20px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 16px;
  font-weight: 400;
  line-height: 1;
  text-align: center;
  cursor: pointer;
  opacity: 0.55;
  transition: opacity 0.15s ease;
}

.clipmate-notice-close:hover {
  opacity: 1;
}

/* ===== 技术细节块（v2.5.45 / B6）=====
   失败提示的第二层内容：等宽字体、可滚动、可一键复制。
   只在带 detail 时出现，不带时不改变原来 41px 单行横幅的样子。 */
.clipmate-notice.has-detail {
  height: auto;
  min-height: 41px;
  align-items: flex-start;
  padding-top: 9px;
  padding-bottom: 9px;
}

.clipmate-notice.has-detail .clipmate-notice-close {
  align-self: flex-start;
}

/* 带细节时文本列变成块级容器，细节块才能独占一行 */
.clipmate-notice.has-detail .clipmate-notice-text {
  display: block;
}

.clipmate-notice-detail {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(17, 24, 32, 0.04);
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.5;
  color: #6B7278;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 108px;
  overflow: auto;
  text-align: left;
  user-select: text;
}

.clipmate-notice-detail-copy {
  display: block;
  margin-top: 6px;
  padding: 2px 8px;
  border: 1px solid #D5CFC1;
  border-radius: 4px;
  background: #FFFFFF;
  color: #111820;
  font-family: inherit;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
}

.clipmate-notice-detail-copy:hover {
  background: #F1EFE8;
}

@keyframes clipmate-notice-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ==================== 内容区 ==================== */
.floating-window-content {
  flex: 1;
  padding: 15px;
  overflow: auto;
  background: #F7F6F2;
  user-select: text;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  text-align: left;
  scrollbar-width: thin;
  scrollbar-color: #CBC5B7 #F1EFE8;
}

.floating-window-content::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.floating-window-content::-webkit-scrollbar-thumb {
  background: #CBC5B7;
  border-radius: 5px;
}
.floating-window-content::-webkit-scrollbar-track {
  background: #F1EFE8;
}

/* ==================== 底部折叠手柄 / 缩放角 ==================== */
.floating-window-collapse-handle {
  height: 20px;
  background: #F1EFE8;
  border-top: 1px solid #E1DCD1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  line-height: 1;
  color: #6B7278;
  transition: all 0.2s;
  margin: 0;
  padding: 0;
  user-select: none;
}

.floating-window-resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 15px;
  height: 15px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, #C9C3B5 50%);
  border-bottom-right-radius: 8px;
}

/* ==================== 数据表格 ==================== */
.data-table {
  width: 100%;
  border-collapse: collapse;
  border-spacing: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  text-align: left;
  table-layout: auto;
  margin: 0;
}

.data-table th,
.data-table td {
  padding: 2px;
  text-align: left;
  border: 1px solid #D9D3C5;
  vertical-align: top;
  word-break: break-word;
  overflow-wrap: break-word;
  color: #111820;
  background: transparent;
  font-size: 12px;
  line-height: 1.3;
  white-space: normal;
}

/* 表头与内容同为常规体（v2.5.41 统一口径：最简洁） */
.data-table th {
  font-weight: 400;
}

/* 纵向表格：字段名一列固定宽度、右对齐。
   v2.5.45：整列吸左（sticky），长表格往下滚时字段名不会滚走；
   吸顶/吸左都必须给不透明底色，否则下面的内容会透出来。 */
.data-table.vertical-table th {
  width: 120px;
  text-align: right;
  position: sticky;
  left: 0;
  background: #F1EFE8;
  z-index: 2;
}

/* 横向表格：表头吸顶（v2.5.45） */
.data-table.horizontal-table thead th {
  position: sticky;
  top: 0;
  background: #F1EFE8;
  z-index: 3;
}

/* 行悬停高亮（v2.5.45）：23 列宽表格横向看容易串行 */
.data-table tbody tr:hover td,
.data-table tbody tr:hover th {
  background: #F1EFE8;
}

.data-table a {
  color: #056BF4;
  text-decoration: underline;
  font-size: 12px;
  line-height: 1.3;
}

/* 单元格文字 */
.data-field {
  padding: 2px 4px;
  display: block;
  color: #111820;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  text-align: left;
  white-space: pre-wrap;
  margin: 0;
}

/* 长文本默认折叠 3 行（v2.5.45）：简介/其他信息过长时会把表格撑得没法看 */
.data-field.is-clampable {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

/* 「展开 / 收起」小按钮：只切换折叠，不触发单元格复制 */
.data-field-toggle {
  display: inline-block;
  margin-left: 6px;
  color: #0448A6;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  line-height: 1.3;
}
.data-field-toggle:hover {
  text-decoration: underline;
}

/* 点单元格复制后的短暂反馈（v2.5.45） */
.data-table td.is-copied {
  background: #EAF7F0;
}

/* ==================== 编辑模式 ==================== */
.header-editor,
.field-editor {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid #CBC5B7;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  background: #FFFFFF;
  outline: none;
  margin: 0;
  border-radius: 0;
  appearance: none;
  -moz-appearance: none;
}

.sortable-header {
  cursor: move;
}

.sortable-header-disabled {
  cursor: default;
}

.sortable-ghost {
  opacity: 0.4;
}

.sortable-chosen {
  background: #E8E4D9;
}

/* v2.5.45（B17）拖拽落点提示：
   拖动时在目标表头的「前/后」画一条 2px 蓝线，明确告诉你会插到哪儿。
   注意不写 !important —— Shadow DOM 已隔离，写了反而会压死 JS 加的类。 */
.sortable-header.drop-before {
  position: relative;
}

.sortable-header.drop-before::before,
.sortable-header.drop-after::after {
  content: "";
  position: absolute;
  background: #056BF4;
  pointer-events: none;
  z-index: 5;
}

.sortable-header.drop-before::before {
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}

.sortable-header.drop-after {
  position: relative;
}

.sortable-header.drop-after::after {
  right: 0;
  top: 0;
  bottom: 0;
  width: 2px;
}

/* 纵向模式（一行一个字段）时落点线画成横线，跟着方向走 */
.vertical-table .sortable-header.drop-before::before {
  left: 0;
  right: 0;
  top: 0;
  bottom: auto;
  width: auto;
  height: 2px;
}

.vertical-table .sortable-header.drop-after::after {
  left: 0;
  right: 0;
  top: auto;
  bottom: 0;
  width: auto;
  height: 2px;
}

/* 旧式按钮类（保留兼容） */
.btn {
  padding: 4px 8px;
  border: 1px solid #CBC5B7;
  background: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  border-radius: 0;
  margin: 0;
}

/* ==================== v2.5.47（B3）：最小化胶囊 ==================== */

/* 平时不显示；最小化时由 floating-window.js 用内联 display:flex 叫出来。
   这里不写 :host()，因为不支持 Shadow DOM 的降级路径下 :host 不生效。 */
.floating-window-capsule {
  display: none;
  position: absolute;
  inset: 0;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  background: #F7F6F2;
  border-radius: inherit;
  cursor: pointer;
  user-select: none;
  overflow: hidden;
}

.floating-window-capsule-icon {
  font-size: 12px;
  line-height: 1;
  color: #0448A6;
  flex: 0 0 auto;
}

.floating-window-capsule-name {
  font-size: 12px;
  line-height: 1;
  color: #111820;
  white-space: nowrap;
  flex: 0 0 auto;
}

.floating-window-capsule-divider {
  width: 1px;
  height: 12px;
  background: #CBC5B7;
  flex: 0 0 auto;
}

.floating-window-capsule-count {
  font-size: 12px;
  line-height: 1;
  color: #6B7278;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

/* 最小化期间来了提示 → 右上角冒红点，提示原文进 title 悬停可见 */
.floating-window-capsule-badge {
  position: absolute;
  top: 3px;
  right: 5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #E0453C;
  display: none;
}

.floating-window-capsule-badge.is-on {
  display: block;
}

/* ==================== v2.5.47（B4）：表格内搜索 ==================== */

.clipmate-search {
  display: none;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #F1EFE8;
  border-bottom: 1px solid #E1DCD1;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1.3;
}

.clipmate-search.is-open {
  display: flex;
}

.clipmate-search-input {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  border: 1px solid #CBC5B7;
  border-radius: 5px;
  background: #FFFFFF;
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  outline: none;
  margin: 0;
}

.clipmate-search-input:focus {
  border-color: #056BF4;
  box-shadow: 0 0 0 2px rgba(5, 107, 244, 0.16);
}

.clipmate-search-count {
  color: #6B7278;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.clipmate-search-count.is-none {
  color: #B42318;
  font-weight: 600;
}

.clipmate-search-filter,
.clipmate-search-close {
  border: 1px solid #CBC5B7;
  background: #FFFFFF;
  color: #111820;
  border-radius: 5px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 400;
  line-height: 1.3;
  padding: 2px 8px;
  cursor: pointer;
  flex: 0 0 auto;
  white-space: nowrap;
  margin: 0;
}

.clipmate-search-close {
  padding: 2px 7px;
}

.clipmate-search-filter:hover,
.clipmate-search-close:hover {
  background: #F1EFE8;
}

.clipmate-search-filter.is-active {
  background: #056BF4;
  border-color: #056BF4;
  color: #FFFFFF;
}

/* 搜索命中 / 未命中。写在表格基础样式之后，同特异性下靠顺序取胜，
   不用 !important（shadow 内一律不写）。 */
.data-table tr.is-search-hit th,
.data-table tr.is-search-hit td,
.data-table th.is-search-hit,
.data-table td.is-search-hit {
  background: #FBF3CE;
}

.data-table tr.is-search-dim {
  opacity: 0.26;
}

.data-table th.is-search-dim,
.data-table td.is-search-dim {
  opacity: 0.26;
}

.data-table.is-search-filtering tr.is-search-dim,
.data-table.is-search-filtering th.is-search-dim,
.data-table.is-search-filtering td.is-search-dim {
  display: none;
}

/* ==================== v2.5.47：标题栏「⋯」菜单 ==================== */

/* 用 fixed 定位（JS 算坐标）：宿主有 overflow:hidden，菜单留在流内会被折叠状态裁掉 */
.clipmate-title-menu {
  position: fixed;
  z-index: 10;
  min-width: 120px;
  padding: 4px;
  background: #FFFFFF;
  border: 1px solid #E1DCD1;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(17, 24, 32, 0.16);
}

.clipmate-title-menu button {
  display: block;
  width: 100%;
  padding: 6px 10px;
  border: none;
  background: transparent;
  border-radius: 4px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.3;
  color: #111820;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  margin: 0;
}

.clipmate-title-menu button:hover {
  background: #F1EFE8;
}

/* 图标按钮（🔍/⋯/—）：方形窄按钮，省标题栏位置 */
.floating-window-title-button.is-icon {
  width: 26px;
  min-width: 26px;
  padding: 4px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1.2;
}
`;

})();
