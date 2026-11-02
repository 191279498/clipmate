/**
 * 抖音作者个人主页提取器（v2.7.11）—— 契约测试
 *
 * 这个站是人物档案的第一批，钉住四件事：
 *   A. 输出恰好 6 列（平台 / 昵称 / 账号ID / 账号名 / 网址 / 简介），不多不少
 *   B. 账号ID 只从地址栏取，`/user/self` 时留空（不拿抖音号顶替，否则作品记录 join 不上）
 *   C. 昵称清洗与作品页 `douyin-social.js` 逐字同款（同一作者两个入口必须同名）
 *   D. 没有签名就留空，不写任何占位词
 *
 * 取样来源：2026-10-30 真机（用户已登录 Edge）在 `www.douyin.com/user/self` 上读到的真实结构：
 *   [data-e2e="user-detail"] 容器 / h1 昵称 / 文本「抖音号：61339369848」
 *   类名（enTGrzPh、x02b7nYS…）是构建哈希，**测试里刻意不写**，防止有人照着类名写选择器。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m' };
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`); }
function bad(name, detail) { fail++; failures.push(name); console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`); }
function truthy(name, cond, detail) { if (cond) ok(name); else bad(name, detail); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}
function section(t) { console.log(`\n${C.bold}${t}${C.reset}`); }

/** 建一个 jsdom 页面，并把内容脚本按 manifest 的顺序塞进去 */
function makePage({ url, html }) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const w = dom.window;
  const scripts = [
    'src/shared/country-names.js',
    'src/shared/country-extract.js',
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-date.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/douyin-profile-ssr.js',
    'src/content/extractors/douyin-profile.js'
  ];
  for (const rel of scripts) {
    w.eval(fs.readFileSync(P(rel), 'utf8'));
  }
  return w;
}

/** 真实结构的最小复刻（含签名两块，块级元素保证能分出换行） */
const HTML_WITH_BIO = `<!DOCTYPE html><html><body>
  <div data-e2e="user-detail">
    <div class="hash-a">
      <h1><span>阿尔弗雷德</span></h1>
      <div class="stat">关注</div>
      <div class="stat">粉丝</div>
      <div class="stat">获赞</div>
      <span class="hash-b">抖音号：61339369848</span>
      <div class="hash-c">这是签名第一行</div>
      <div class="hash-d">这是签名第二行</div>
      <div class="hash-e">我公开展示的群聊</div>
      <span class="hash-f">作品</span>
      <span class="hash-f">私密作品</span>
      <span class="hash-f">合集</span>
    </div>
  </div>
</body></html>`;

const HTML_NO_BIO = `<!DOCTYPE html><html><body>
  <div data-e2e="user-detail">
    <div class="hash-a">
      <h1><span>无签名用户企业认证</span></h1>
      <div class="stat">关注</div>
      <div class="stat">粉丝</div>
      <div class="stat">获赞</div>
      <span class="hash-b">抖音号：88888888</span>
      <div class="hash-e">我公开展示的群聊</div>
      <span class="hash-f">作品</span>
    </div>
  </div>
</body></html>`;

const SEC = 'MS4wLjABAAAATeeWHaXZ7dWwyDuDEOZAXpKT2EWH2pdixzq9cU3cBkZstCaNaPwYy724UjSZPxMZ';

(async function main() {

  /* ==================== 1. 有签名的主页 ==================== */
  section('1. 有签名的主页 → 6 列');

  const w1 = makePage({ url: 'https://www.douyin.com/user/' + SEC + '?from_tab_name=main', html: HTML_WITH_BIO });
  const ex1 = new w1.DouyinProfileExtractor();
  const r1 = await ex1.extractAllFields();

  const CONTENT_KEYS = ['平台', '昵称', '账号ID', '账号名', '网址', '简介'];
  eq('内容列恰好这 6 个（顺序一致）', CONTENT_KEYS.filter((k) => k in r1), CONTENT_KEYS);
  eq('媒体类型 = person', r1.mediaType, 'person');
  eq('记录形态 = account', r1.personKind, 'account');
  eq('平台 = 抖音', r1['平台'], '抖音');
  eq('昵称取自 h1', r1['昵称'], '阿尔弗雷德');
  eq('账号ID 取自地址栏 sec_uid', r1['账号ID'], SEC);
  eq('账号名取自「抖音号：」', r1['账号名'], '61339369848');
  eq('网址去掉 ?from_tab_name=', r1['网址'], 'https://www.douyin.com/user/' + SEC);
  eq('简介只取签名两行，不吃到「群聊」', r1['简介'], '这是签名第一行\n这是签名第二行');
  truthy('简介里没有区块词（作品/合集/群聊）',
    !/作品|合集|群聊|关注|粉丝|获赞/.test(r1['简介']), '简介=' + JSON.stringify(r1['简介']));
  truthy('记录里没有影人字段（不串骨架）',
    r1['姓名'] === undefined && r1['国家'] === undefined && r1['出生日期'] === undefined);

  /* ==================== 2. 没签名 + 昵称带认证后缀 ==================== */
  section('2. 没签名 / 昵称带认证后缀');

  const w2 = makePage({ url: 'https://www.douyin.com/user/' + SEC, html: HTML_NO_BIO });
  const r2 = await new w2.DouyinProfileExtractor().extractAllFields();

  eq('没有签名 → 简介留空（不写占位词）', r2['简介'], '');
  eq('昵称去掉「企业认证」后缀', r2['昵称'], '无签名用户');
  eq('账号名照原样存（系统数字也存）', r2['账号名'], '88888888');

  /* ==================== 3. /user/self ==================== */
  section('3. 「我的主页」/user/self');

  const w3 = makePage({ url: 'https://www.douyin.com/user/self', html: HTML_WITH_BIO });
  const r3 = await new w3.DouyinProfileExtractor().extractAllFields();

  eq('self 不是固定 ID → 账号ID 留空', r3['账号ID'], '');
  eq('其他列照常取', r3['昵称'], '阿尔弗雷德');
  truthy('**绝不拿抖音号顶替账号ID**', r3['账号ID'] !== r3['账号名'],
    '账号ID=' + JSON.stringify(r3['账号ID']) + ' 账号名=' + JSON.stringify(r3['账号名']));

  /* ==================== 4. 与作品页昵称清洗同款 ==================== */
  section('4. 昵称清洗必须与作品页逐字同款');

  const SOCIAL_SRC = fs.readFileSync(P('src/content/extractors/douyin-social.js'), 'utf8');
  const PROFILE_SRC = fs.readFileSync(P('src/content/extractors/douyin-profile.js'), 'utf8');
  // 两边都必须有这条去掉认证后缀的正则，且内容一字不差
  const BADGE = '/(认证徽章|企业认证|官方认证|个人认证|机构认证|蓝V认证)$/u';
  truthy('作品页有认证后缀清洗规则', SOCIAL_SRC.indexOf(BADGE) > -1, '未找到 ' + BADGE);
  truthy('主页也有同一条规则', PROFILE_SRC.indexOf(BADGE) > -1, '未找到 ' + BADGE);
  truthy('主页的 @ 前缀清洗也一致', PROFILE_SRC.indexOf("name.replace(/^@+/, '')") > -1);

  /* ==================== 5. 注册与接线 ==================== */
  section('5. 注册与接线');

  const MANIFEST = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  truthy('版本号已升到 2.7.11 或更高', /^2\.(7\.(1[1-9]|[2-9]\d)|[89]\.\d+)$/.test(MANIFEST.version), MANIFEST.version);
  const js = MANIFEST.content_scripts[0].js;
  const idx = (n) => js.findIndex((x) => x.indexOf(n) > -1);
  truthy('manifest 加载了 country-extract', idx('country-extract') > -1);
  truthy('manifest 加载了 person-date', idx('person-date') > -1);
  truthy('manifest 加载了 person-fields-builder', idx('person-fields-builder') > -1);
  truthy('manifest 加载了 douyin-profile', idx('douyin-profile') > -1);
  truthy('country-names 在 country-extract 之前', idx('country-names') < idx('country-extract'));
  truthy('person-fields-builder 在 douyin-profile 之前', idx('person-fields-builder') < idx('douyin-profile'));

  const FACTORY_SRC = fs.readFileSync(P('src/content/utils/extractor-factory.js'), 'utf8');
  truthy('工厂注册了 DouyinProfileExtractor',
    /className: 'DouyinProfileExtractor', entries: \[\s*\{\s*hostname: 'www\.douyin\.com', types: \['person'\]/.test(FACTORY_SRC));

  /* ==================== 6. 完整签名（SSR）+ 三项统计 ==================== */
  section('6. 完整签名（SSR 预渲染数据）+ 粉丝/获赞/IP属地');

  // 真机存档的 SSR 数据块（2026-10-30，用户标签页原样抓取，未做任何修改）
  const SSR_BLOCK = fs.readFileSync(path.join(__dirname, 'fixtures', 'douyin', 'ssr-user-home-1.txt'), 'utf8');
  // DOM 里签名**是截断的**（真机就是这样）：只到「不会找别的闺」+ 一个「更多」按钮
  const HTML_SSR = `<!DOCTYPE html><html><body>
  <div data-e2e="user-detail">
    <div data-e2e="user-info">
      <h1><span>恨海情天.</span></h1>
      <span class="hash-a">抖音号：77560001305</span><span class="hash-b">IP属地：吉林</span>
      <div class="hash-c">闺蜜<span>@𝓯𝓻𝓮ᴺʸཨོོཾ安眠曲.(蜜鞠)</span><span> 不会找别的闺</span></div>
      <div class="hash-d">更多</div>
      <span data-e2e="user-info-fans">粉丝1640</span>
      <span data-e2e="user-info-like">获赞2.9万</span>
    </div>
  </div>
  <script>` + SSR_BLOCK + `</script>
</body></html>`;

  const w6 = makePage({ url: 'https://www.douyin.com/user/' + SEC, html: HTML_SSR });
  const r6 = await new w6.DouyinProfileExtractor().extractAllFields();
  const bio6 = r6['简介'];

  eq('统计行原样照页面（1640 / 2.9万），用 · 连一行',
    bio6.split('\n')[0], '粉丝：1640 · 获赞：2.9万 · IP属地：吉林');
  truthy('统计行排在签名前面', bio6.indexOf('粉丝：') < bio6.indexOf('闺蜜'), bio6.slice(0, 80));
  truthy('签名拿到 DOM 里根本没有的后半句「（不处谢谢）」',
    bio6.indexOf('（不处谢谢）') > -1, '简介尾部=' + JSON.stringify(bio6.slice(-60)));
  truthy('签名不残留截断标记「...」', bio6.indexOf('...') === -1, bio6.slice(0, 80));
  truthy('签名不残留「更多」按钮文字', bio6.indexOf('更多') === -1);
  eq('4 个 @ 全部带上目标用户链接',
    (bio6.match(/\[@[^\]]+\]\(https:\/\/www\.douyin\.com\/user\/MS4wLjABAAAA/g) || []).length, 4);
  truthy('第一个 @ 的链接指向「蜜鞠」那个 sec_uid',
    bio6.indexOf('(https://www.douyin.com/user/MS4wLjABAAAATEUccmr0JONaIZh6RD373Z1KD2LI4-Vwe_zEUYygxMvgZtY6Fu8WdGyitEXYqRNg)') > -1);
  truthy('签名里的换行保留（不是压成一坨）', bio6.split('\n').length >= 6, '行了数=' + bio6.split('\n').length);

  // v2.7.15：真机里「抖音号：77560001305」和「IP属地：吉林」是两个相邻行内元素，
  // 中间没有块级换行，压成文本后连成一串；贪婪匹配会把 IP属地 的 IP 吃进账号名。
  eq('账号名不吃「IP属地」的 IP（真机形态：两行挨着）', r6['账号名'], '77560001305');

  /* ==================== 6b. 账号名的几种边界形态 ==================== */
  section('6b. 账号名边界（都不许拖泥带水）');

  const mkAccPage = (line) => makePage({
    url: 'https://www.douyin.com/user/' + SEC,
    html: `<!DOCTYPE html><html><body>
      <div data-e2e="user-detail"><div data-e2e="user-info">
        <h1><span>某人</span></h1><span class="h">${line}</span>
      </div></div></body></html>`
  });
  const accOf = async (line) => (await new (mkAccPage(line).DouyinProfileExtractor)().extractAllFields())['账号名'];

  eq('纯数字 + 紧跟 IP属地', await accOf('抖音号：77560001305<span>IP属地：吉林</span>'), '77560001305');
  eq('含字母下划线 + 紧跟 IP属地', await accOf('抖音号：abc_123.xy<span>IP属地：北京</span>'), 'abc_123.xy');
  eq('后面跟「关注/粉丝/获赞」也停', await accOf('抖音号：dy7788 关注 100 粉丝 200'), 'dy7788');
  eq('行尾没有别的字', await accOf('抖音号：61339369848'), '61339369848');
  eq('认不出来就留空（不猜）', await accOf('这是一段没有抖音号的文本'), '');

  /* ==================== 7. SSR 对不上就退回 DOM（防记错人） ==================== */
  section('7. SSR 数据与地址栏 sec_uid 对不上 → 退回 DOM 截断版');

  const OTHER_SEC = 'MS4wLjABAAAAsomeOtherUserSecUid1234567890abcd';
  const w7 = makePage({ url: 'https://www.douyin.com/user/' + OTHER_SEC, html: HTML_SSR });
  const r7 = await new w7.DouyinProfileExtractor().extractAllFields();
  truthy('**绝不把别人页面的签名记到这个人头上**',
    r7['简介'].indexOf('（不处谢谢）') === -1, '简介=' + JSON.stringify(r7['简介'].slice(0, 120)));
  truthy('退回 DOM 兜底仍能拿到可见的那截签名',
    r7['简介'].indexOf('不会找别的闺') > -1, '简介=' + JSON.stringify(r7['简介']));
  truthy('统计三项与签名无关，照常保留', r7['简介'].indexOf('粉丝：1640') > -1);

  /* ==================== 8. 注册顺序 ==================== */
  section('8. SSR 模块必须在提取器之前加载');

  const MANIFEST2 = JSON.parse(fs.readFileSync(P('manifest.json'), 'utf8'));
  const js2 = MANIFEST2.content_scripts[0].js;
  const iSsr = js2.findIndex((x) => x.indexOf('douyin-profile-ssr') > -1);
  const iExt = js2.findIndex((x) => x.indexOf('douyin-profile.js') > -1);
  truthy('manifest 里有 douyin-profile-ssr.js', iSsr > -1);
  truthy('它排在 douyin-profile.js 之前', iSsr > -1 && iSsr < iExt, 'ssr=' + iSsr + ' 提取器=' + iExt);

  /* ==================== 9. 没有签名 ≠ 把元数据当签名（v2.7.34） ==================== */
  section('9. 无签名主页：兜底不许抓「IP属地 / UID」，SSR 命中空 desc 就定案');

  // 真机结构（2026-11-01 用户标签 1）：整块资料区只有账号元数据 + 操作按钮，作者没写签名。
  // ⚠ 按钮区必须按真机原样带上：`[data-e2e="user-detail"]` 把作品区也包进来了，
  //   少写这几行就测不出「分享主页/私信」被当签名那个坑。
  const NO_BIO_LINES = ['杜培程…T^T…', '关注', '83', '粉丝', '578', '获赞', '3899',
    '抖音号：27659734592', 'IP属地：广东', 'UID：86622082429',
    '分享主页', '私信已关注', '已关注私信', '下载电脑客户端，桌面快捷访问', '下载',
    '作品34', '推荐', '喜欢'];
  const domHtml = (lines) => `<!DOCTYPE html><html><body><div data-e2e="user-detail">${
    lines.map((l) => `<div>${l}</div>`).join('')}</div></body></html>`;

  {
    const w = makePage({ url: 'https://www.douyin.com/user/MS4wLjABAAAA1fxA0Y88NGJaYSE9C3H8Lgs0g7UjuninSZbDIi9ToSY', html: domHtml(NO_BIO_LINES) });
    const ex = new w.DouyinProfileExtractor();
    eq('没有签名 → DOM 兜底返回空串（不拿 IP属地 / UID / 按钮文字顶包）', ex._signatureFromDom(), '');
  }

  // 有的主页没有 UID 行，按钮文字照样不许被当成签名
  {
    const w = makePage({
      url: 'https://www.douyin.com/user/MS4wLjABAAAAnoUid',
      html: domHtml(['某人', '抖音号：123', 'IP属地：广东', '分享主页', '私信', '作品 3'])
    });
    eq('没有 UID 行也不会把「分享主页」当签名',
      new w.DouyinProfileExtractor()._signatureFromDom(), '');
  }

  // 真机结构（2026-11-01 标签 2）：签名排在「抖音号 / IP属地 / 年龄 / 地区」之后
  const BIO_AFTER_META = ['独卧孤城醉望一轮月', '关注', '28', '粉丝', '2823', '获赞', '2.4万',
    '抖音号：21232777921', 'IP属地：天津', '18岁', '天津·滨海新区',
    '朋友：@邢老师在枫叶普高 @Zz- @吻你才是重头戏 @skltmy @归远不是桂圆', '更多', 'UID：3910295660013998'];

  {
    const w = makePage({ url: 'https://www.douyin.com/user/MS4wLjABAAAAxy5ETeWIkQhSouk8KrQtSgpZGv85yE5Swzlj5yDMsrrVPDqpxN', html: domHtml(BIO_AFTER_META) });
    const sig = new w.DouyinProfileExtractor()._signatureFromDom();
    eq('签名排在元数据之后也认得出来（元数据只跳过、不中断）',
      sig, '朋友：@邢老师在枫叶普高 @Zz- @吻你才是重头戏 @skltmy @归远不是桂圆');
    truthy('年龄行（18岁）没混进签名', sig.indexOf('18岁') === -1, sig);
    truthy('地区行（天津·滨海新区）没混进签名', sig.indexOf('滨海新区') === -1, sig);
  }

  // 反例守卫：签名本身带 `·` 时不许被「地区行」规则吃掉
  {
    const w = makePage({
      url: 'https://www.douyin.com/user/MS4wLjABAAAAzz',
      html: domHtml(['某某', '抖音号：123', '摄影·旅行', '小红书同名'])
    });
    eq('签名里的「摄影·旅行」保留（地区规则只咬紧跟年龄/IP属地之后的那行）',
      new w.DouyinProfileExtractor()._signatureFromDom(), '摄影·旅行\n小红书同名');
  }

  // SSR 命中但 desc 为空 = 这个人确实没写签名 → 必须定案，不许退回 DOM 猜。
  // ⚠ 为了咬住「又退回 DOM」这种改法，DOM 里**故意放一句像签名的文字**：
  //   修复后必须仍然返回空（信 SSR），改回去就会把它抓上来 → 变红。
  {
    const secUid = 'MS4wLjABAAAAemptyDesc';
    const tree = ['$', '$La', null, { user: { user: { uid: '1', secUid, nickname: '某人', desc: '', descExtra: [] } } }];
    const literal = JSON.stringify('8:' + JSON.stringify(tree));
    const html = `<!DOCTYPE html><html><body>
      <script>self.__pace_f = self.__pace_f || []; self.__pace_f.push([1,${literal}])</script>
      <div data-e2e="user-info"><span data-e2e="user-info-fans">粉丝 5</span><span data-e2e="user-info-like">获赞 6</span></div>
      <div data-e2e="user-detail"><div>某人</div><div>抖音号：123</div><div>页面上的可疑文字</div><div>UID：99</div></div>
    </body></html>`;
    const w = makePage({ url: 'https://www.douyin.com/user/' + secUid, html });
    const ex = new w.DouyinProfileExtractor();
    eq('SSR 命中、desc 为空 → 签名定案为空（known 空，不猜）', ex._signature(), '');
    truthy('DOM 兜底确实能抓到那句可疑文字（说明上一条不是「恰好都空」的假绿）',
      ex._signatureFromDom() === '页面上的可疑文字', JSON.stringify(ex._signatureFromDom()));
    const bio = await ex.extractBio();
    eq('简介只剩统计行（一行）', bio.split('\n').length, 1);
    truthy('简介里没有 UID 之类元数据', bio.indexOf('UID') === -1, bio);
    truthy('简介里没有那句可疑文字', bio.indexOf('可疑文字') === -1, bio);
  }

  // 同一条通道的正例：SSR 有 desc 就照常用它（别把定案写成「永远不用 SSR」）
  {
    const secUid = 'MS4wLjABAAAAhasDesc';
    const tree = ['$', '$La', null, { user: { user: { uid: '1', secUid, nickname: '某人', desc: '真签名', descExtra: [] } } }];
    const literal = JSON.stringify('8:' + JSON.stringify(tree));
    const html = `<!DOCTYPE html><html><body>
      <script>self.__pace_f = self.__pace_f || []; self.__pace_f.push([1,${literal}])</script>
      <div data-e2e="user-detail"><div>某人</div><div>抖音号：123</div><div>UID：99</div></div>
    </body></html>`;
    const w = makePage({ url: 'https://www.douyin.com/user/' + secUid, html });
    eq('SSR 有签名 → 直接用 SSR 的', new w.DouyinProfileExtractor()._signature(), '真签名');
  }

  /* ==================== 总结 ==================== */
  console.log('\n' + '='.repeat(52));
  if (fail === 0) console.log(`== 通过 ${pass} 项，失败 0 项 ==`);
  else {
    console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  console.log('='.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})();
