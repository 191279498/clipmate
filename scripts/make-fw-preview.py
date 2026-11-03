"""生成浮窗预览页（浅色 / 深色各两种宽度）。

为什么要脚本生成、而不是手写一份 HTML：
浮窗样式写在 floating-window-styles.js 的模板字符串里，改一次就得手工同步到预览页，
同步漏了就会出现「预览是新的、实机是旧的」这种最坑的判断错误。
这里每次从源码里现抽，保证预览用的就是扩展真正注入的那份 CSS。

用法：python scripts/make-fw-preview.py
产物：tests/_fw-preview.html
"""

import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'ui', 'floating-window-styles.js')
PAGE_CSS = os.path.join(ROOT, 'ClipMate_chrome', 'src', 'content', 'content-styles.css')
OUT = os.path.join(ROOT, 'tests', '_fw-preview.html')

MASCOT = 'http://127.0.0.1:8899/ClipMate_chrome/icons/mascot/face-idle.svg'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def extract_fw_css(src):
    m = re.search(r'window\.FLOATING_WINDOW_CSS\s*=\s*`([\s\S]*?)`;', src)
    if not m:
        raise SystemExit('没在 floating-window-styles.js 里找到 FLOATING_WINDOW_CSS 模板字符串')
    return m.group(1)


def extract_vars(css):
    """抽出 :root 与 .clipmate-dark 两个变量块（含注释头），照搬进预览页。"""
    start = css.index('/* ============ 配色变量')
    end = css.index('}', css.index('.clipmate-dark {')) + 1
    return css[start:end]


def window_html(width_class, label):
    return f'''<h3>{label}</h3>
<div class="wrap {width_class}"><div class="floating-window">
  <div class="floating-window-header">
    <div class="floating-window-brand" style="background-image:url(&quot;{MASCOT}&quot;)"></div>
    <div class="floating-window-title">媒体信息预览</div>
    <div class="floating-window-title-buttons">
      <button class="floating-window-title-button">复制</button>
      <button class="floating-window-title-button">导出</button>
      <button class="floating-window-title-button is-icon">🔍</button>
      <button class="floating-window-title-button is-icon">⋯</button>
      <button class="floating-window-title-button is-icon">—</button>
    </div>
    <div class="floating-window-close">×</div>
  </div>
  <div class="floating-window-content"><table class="data-table">
    <tr><th>标题</th><td>示例作品标题，用来占一行看排版</td></tr>
    <tr><th>作者</th><td>示例作者</td></tr>
    <tr><th>日期</th><td>2026-11-03</td></tr>
    <tr><th>简介</th><td>一段稍微长一点的说明文字，用来看正文在两种底色下的可读性</td></tr>
  </table></div>
</div></div>'''


HTML = '''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<title>浮窗配色预览 v2.9.3（浅色 / 深色）</title>
<style>
html,body{{margin:0}}
body{{font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#fff}}
h3{{font-size:12px;font-weight:600;color:#6B7278;margin:0 0 10px}}
.wrap{{border-radius:10px;overflow:hidden;box-shadow:0 12px 28px -14px rgba(17,24,32,.32);
      margin-bottom:26px;font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",Roboto,"Helvetica Neue",Arial,sans-serif;
      font-size:12px}}
.wrap.narrow{{width:372px}}
.wrap{{width:560px}}
.band{{padding:24px 30px}}
.band.dark{{background:#191817}}
.band.dark h3{{color:#A39C8E}}
</style>
<style>
/* ===== 变量层：与扩展注入的那份逐字一致（从 content-styles.css 抽取） ===== */
{vars}
</style>
<style>
/* ===== 浮窗样式：与扩展注入 Shadow DOM 的那份逐字一致 ===== */
{fwcss}
</style>
</head><body>

<div class="band light">
{light_wide}
{light_narrow}
</div>

<div class="band dark">
<div class="clipmate-dark">
{dark_wide}
{dark_narrow}
</div>
</div>

</body></html>
'''

if __name__ == '__main__':
    fw = extract_fw_css(read(JS))
    vars_css = extract_vars(read(PAGE_CSS))
    html = HTML.format(
        vars=vars_css,
        fwcss=fw,
        light_wide=window_html('', '浅色站点 · 宽 560px'),
        light_narrow=window_html('narrow', '浅色站点 · 窄窗 372px'),
        dark_wide=window_html('', '深色站点 · 宽 560px（挂在 .clipmate-dark 上）'),
        dark_narrow=window_html('narrow', '深色站点 · 窄窗 372px'),
    )
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(html)
    print('已生成', OUT)
    print('浮窗 CSS', len(fw), '字符；变量块', len(vars_css), '字符')
