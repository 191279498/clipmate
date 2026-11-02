/**
 * 预览：用真机抓的 SSR 数据在 jsdom 里跑完整链路，打印出来人眼过一遍。
 * 不是测试，是给人看的（`node tests/preview-person-bio.js`）。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);
const FIX = path.join(__dirname, 'fixtures', 'douyin');
const SSR_BLOCK = fs.readFileSync(path.join(FIX, 'ssr-user-home-1.txt'), 'utf8');
const PAGE_URL = fs.readFileSync(path.join(FIX, 'ssr-user-home-url.txt'), 'utf8').trim();
const SEC = (PAGE_URL.match(/\/user\/([A-Za-z0-9_-]+)/) || [])[1];

const HTML = `<!DOCTYPE html><html><body>
  <div data-e2e="user-detail">
    <div data-e2e="user-info">
      <h1><span>恨海情天.</span></h1>
      <span class="h1">抖音号：77560001305</span>
      <span class="h2">IP属地：吉林</span>
      <div class="h3">闺蜜<span>@𝓯𝓻𝓮ᴺʸཨོོཾ安眠曲.(蜜鞠)</span> 不会找别的闺</div>
      <div class="h4">更多</div>
      <span data-e2e="user-info-fans">粉丝1640</span>
      <span data-e2e="user-info-like">获赞2.9万</span>
    </div>
  </div>
  <script>${SSR_BLOCK}</script>
</body></html>`;

const SCRIPTS = [
  'src/shared/country-names.js',
  'src/shared/country-extract.js',
  'src/content/shared/url-normalizer.js',
  'src/content/shared/person-date.js',
  'src/content/shared/person-fields-builder.js',
  'src/content/extractors/base-extractor.js',
  'src/content/extractors/douyin-profile-ssr.js',
  'src/content/extractors/douyin-profile.js',
  'src/content/ui/modal-table-renderer.js',
  'src/content/ui/modal-copy-export.js'
];

(async () => {
  const dom = new JSDOM(HTML, { url: 'https://www.douyin.com/user/' + SEC, runScripts: 'outside-only' });
  const w = dom.window;
  for (const rel of SCRIPTS) w.eval(fs.readFileSync(P(rel), 'utf8'));

  const data = await new w.DouyinProfileExtractor().extractAllFields();

  console.log('======== 1. 六列原文 ========');
  for (const k of ['平台', '昵称', '账号ID', '账号名', '网址', '简介']) {
    console.log('【' + k + '】 ' + String(data[k] || '').replace(/\n/g, '\n        '));
  }

  const order = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];
  const R = w.ModalTableMixin;
  console.log('\n======== 2. 浮窗「简介」格渲染后 ========');
  console.log(R.buildFieldContent.call(R, '简介', w.ModalCopyMixin.escapeHtml.call(w.ModalCopyMixin, data['简介']), 'person'));
  console.log('\n（链接数量：' + ((R.buildFieldContent.call(R, '简介', data['简介'], 'person').match(/<a /g) || []).length) + ' 个 <a>）');

  const X = w.ModalCopyMixin;
  console.log('\n======== 3. 复制 Markdown（横向表格） ========');
  let md = '| ' + order.join(' | ') + ' |\n| ' + order.map(() => '---').join(' | ') + ' |\n';
  md += '| ' + order.map((k) => X.escapeMarkdown.call(X, data[k] || '')).join(' | ') + ' |';
  console.log(md);

  console.log('\n======== 4. 复制到 Excel（TSV 单元格） ========');
  console.log(X.plainCell.call(X, data['简介']));

  console.log('\n======== 5. 复制到 Notion（HTML 单元格） ========');
  console.log(X.richCell.call(X, data['简介']));
})();
