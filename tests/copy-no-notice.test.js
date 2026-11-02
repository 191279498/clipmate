/**
 * 「提示文字不跟着复制走」回归测试（v2.5.72）
 *
 * 用户明确要求（原话）：
 *   「没有结果就留空，提示"搜索不到"之类的。但这个提示的文字，在我点击复制时是不包含在内的」
 *
 * 所以提示条长什么样、复制按钮怎么按，都不该让「搜索不到，已留空」这几个字
 * 混进剪贴板里。三种复制（Notion 双格式 / Markdown / 纯文本）各验一遍。
 *
 * 做法：用 jsdom 搭一个跟真浮窗同构的 DOM（表格 + 标题栏下方的提示条），
 * 把 modal-copy-export.js 的复制方法跑一遍，拦下真正写进剪贴板的内容。
 * 这样测的是**真实复制路径**，不是我们以为的路径 —— 将来谁把复制改成
 * 「读整个浮窗文字」，「搜索不到」立刻出现，这条测试就会红。
 *
 * 用法：node tests/copy-no-notice.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  failures.push(name + (detail ? '：' + detail : ''));
}

function eq(name, got, want) {
  ok(name, got === want, got === want ? '' : `得到 ${JSON.stringify(got)}，期望 ${JSON.stringify(want)}`);
}

// ---------------- 搭一个跟真浮窗同构的 DOM ----------------

const NOTICE_TEXT = '番组计划 搜索不到，已留空';

const dom = new JSDOM(`<!doctype html><html><body>
  <div class="media-floating-window"><div id="shadow"></div></div>
</body></html>`, { url: 'https://www.imdb.com/title/tt0068646/' });

const win = dom.window;
const doc = win.document;

// 浮窗内容（shadow DOM 的等价物，这里直接放一份同构结构）
const shadow = doc.getElementById('shadow');
shadow.innerHTML = `
  <div class="title-bar"><span>《教父》</span></div>
  <div class="clipmate-notice">${NOTICE_TEXT}<button>×</button></div>
  <table><tbody>
    <tr><th>名字</th><td>The Godfather</td></tr>
    <tr><th>上映日期</th><td>1972/08/24</td></tr>
    <tr><th>Bangumi</th><td></td></tr>
  </tbody></table>
`;

// 拦下写剪贴板的内容
const captured = [];
win.ClipboardItem = function (obj) { this.obj = obj; };
Object.defineProperty(win.navigator, 'clipboard', {
  configurable: true,
  value: {
    write: async (items) => {
      for (const it of items) {
        for (const k of Object.keys(it.obj || {})) {
          const blob = it.obj[k];
          captured.push(typeof blob.text === 'function' ? await blob.text() : String(blob));
        }
      }
    },
    writeText: async (text) => { captured.push(String(text)); }
  }
});
doc.execCommand = () => true;

// ---------------- 载入复制 mixin ----------------

// 注意要连 `ClipboardItem` 一起传进去：函数体里是裸名 new ClipboardItem(...)，
// 少传一个就会走到「降级 → 失败」分支，测出来的东西跟真机不是一回事。
new Function('window', 'document', 'navigator', 'ClipboardItem', 'Blob', 'console', R('ClipMate_chrome/src/content/ui/modal-copy-export.js'))(
  win, doc, win.navigator, win.ClipboardItem, win.Blob, console
);

const Mixin = win.ModalCopyMixin;
ok('复制模块已加载', !!Mixin && typeof Mixin.copyDataAsPlainText === 'function');

function makeInstance() {
  const inst = Object.assign({}, Mixin);
  inst.data = {
    '名字': 'The Godfather',
    '上映日期': '1972/08/24',
    '豆瓣链接': 'https://movie.douban.com/subject/1291841/',
    'IMDB': 'https://www.imdb.com/title/tt0068646/',
    'Bangumi': ''
  };
  inst.fieldOrder = ['名字', '上映日期', '豆瓣链接', 'IMDB', 'Bangumi'];
  inst.displayMode = 'vertical';
  inst.getMediaType = () => 'movie';
  inst.showMessage = () => {};
  return inst;
}

const hasNotice = (s) => /搜索不到|已留空|已补上|不需要补齐/.test(s);

(async () => {
  // ---------- 一、纯文本 ----------
  console.log('\n一、复制纯文本');
  {
    const inst = makeInstance();
    const out = [];
    inst.copyToClipboard = async (text) => { out.push(text); return true; };
    const done = await inst.copyDataAsPlainText();
    ok('复制成功', done === true);
    eq('拦到 1 份内容', out.length, 1);
    const text = out[0] || '';
    ok('不含提示文字', !hasNotice(text), text.slice(0, 80));
    ok('含真实字段值', text.includes('The Godfather'), text.slice(0, 80));
    ok('空字段不出现在纯文本里', !text.includes('Bangumi'), text);
  }

  // ---------- 二、Markdown ----------
  console.log('\n二、复制 Markdown');
  {
    const inst = makeInstance();
    const out = [];
    inst.copyToClipboard = async (text) => { out.push(text); return true; };
    const done = await inst.copyDataAsMarkdown();
    ok('复制成功', done === true);
    const md = out[0] || '';
    ok('不含提示文字', !hasNotice(md), md.slice(0, 120));
    ok('含真实字段值', md.includes('The Godfather'), md.slice(0, 120));
  }

  // ---------- 三、Notion 双格式（HTML + TSV） ----------
  console.log('\n三、复制 Notion 双格式');
  {
    const inst = makeInstance();
    captured.length = 0;
    const done = await inst.copyData();
    ok('复制成功', done === true);
    eq('拦到 2 份内容（HTML + TSV）', captured.length, 2);
    captured.forEach((s, i) => {
      ok(`第 ${i + 1} 份不含提示文字`, !hasNotice(s), String(s).slice(0, 120));
    });
    ok('HTML 里有真实字段值', captured.some((s) => s.indexOf('The Godfather') !== -1));
  }

  // ---------- 四、提示条确实在表格之外 ----------
  console.log('\n四、提示条的位置');
  {
    const notice = shadow.querySelector('.clipmate-notice');
    ok('提示条存在', !!notice);
    ok('提示条不在表格里', !notice.closest('table'));
    const noticeRows = shadow.querySelectorAll('table tr .clipmate-notice');
    eq('表格里没有提示条', noticeRows.length, 0);
  }

  // ---------------- 汇总 ----------------
  console.log('\n' + '='.repeat(52));
  if (!fail) {
    console.log(`✅ 全部通过：${pass} 条断言`);
    process.exit(0);
  }
  console.log(`❌ 失败 ${fail} 条（共 ${pass + fail} 条）`);
  failures.forEach((f) => console.log('   · ' + f));
  process.exit(1);
})();
