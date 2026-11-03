/**
 * 人物档案类型（person）—— 契约测试（v2.7.11）
 *
 * 用户 2026-10-30 拍板的规则，逐条钉在这里：
 *   1. 一个大类 person，内部两种形态：celebrity（影人/作者档案 12 列）/ account（社交账号 6 列）
 *   2. 影人 12 列：姓名、别名、性别、出生日期、逝世日期、国家、简介、豆瓣、IMDb、TMDB、Bangumi、网址
 *      账号  6 列：平台、昵称、账号ID、账号名、网址、简介
 *   3. **日期补齐只对人物档案生效**（「1955年4月」→ 1955-04-01），其他大类一个字不动
 *   4. 国家从出生地抽，抽不出**留空**（不拿城市名凑数）
 *   5. 别名只用英文逗号 `, ` 分隔
 *   6. 影人简介 = 职业 + 补充 + 正文，**正文在后**
 *   7. 不隐藏空值列
 *   8. 抖音 `/user/<sec_uid>` 是人物档案，带 `?modal_id=` 的是作品弹窗（仍走 social）
 *
 * 断言写法约定（防假绿，见项目 warm 文件）：
 *   · 结构断言必须锚在**本模块自己的代码**上，不能用固定字符窗口跨过别的函数；
 *   · 每条断言都要能在「把实现改坏」时真的变红。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');

const MEDIA_TYPES_PATH = path.join(ROOT, 'src/shared/config/media-types.js');
const PERSON_DATE_PATH = path.join(ROOT, 'src/content/shared/person-date.js');
const COUNTRY_EXTRACT_PATH = path.join(ROOT, 'src/shared/country-extract.js');
const BUILDER_PATH = path.join(ROOT, 'src/content/shared/person-fields-builder.js');
const DETECTOR_PATH = path.join(ROOT, 'src/content/utils/media-detector.js');
const FACTORY_PATH = path.join(ROOT, 'src/content/utils/extractor-factory.js');
const URL_NORMALIZER_PATH = path.join(ROOT, 'src/content/shared/url-normalizer.js');
const DATA_PROCESSOR_PATH = path.join(ROOT, 'src/content/ui/modal-data-processor.js');
const TABLE_RENDERER_PATH = path.join(ROOT, 'src/content/ui/modal-table-renderer.js');
const COPY_EXPORT_PATH = path.join(ROOT, 'src/content/ui/modal-copy-export.js');
const MODAL_WINDOW_PATH = path.join(ROOT, 'src/content/ui/modal-window.js');
const PERSISTENCE_PATH = path.join(ROOT, 'src/content/ui/modal-persistence.js');
const CACHE_KEY_PATH = path.join(ROOT, 'src/shared/cache-key-manager.js');
const BACKGROUND_PATH = path.join(ROOT, 'src/background/background.js');

const C = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m'
};
let pass = 0;
const failures = [];
let fail = 0;

function ok(name) {
  pass++;
  if (process.argv.includes('--verbose')) console.log(`  ${C.green}✓${C.reset} ${name}`);
}
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log(`  ${C.red}✗ ${name}${C.reset}${detail ? `\n      → ${detail}` : ''}`);
}
function truthy(name, cond, detail) {
  if (cond) ok(name); else bad(name, detail);
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name); else bad(name, `期望 ${e}，实际 ${a}`);
}

function section(title) {
  console.log(`\n${C.bold}${title}${C.reset}`);
}

/** 读源码（结构断言用） */
function src(p) { return fs.readFileSync(p, 'utf8'); }

(async function main() {

  /* ==================== 1. 字段清单 ==================== */
  section('1. 字段清单（media-types.js）');

  const MT = require(MEDIA_TYPES_PATH);

  truthy('person 是独立的大类', MT.MEDIA_TYPES.PERSON === 'person');
  eq('两种记录形态', MT.PERSON_KINDS, { CELEBRITY: 'celebrity', ACCOUNT: 'account' });

  eq('影人档案 12 列（顺序固定）', MT.getPersonFieldList('celebrity'), [
    '姓名', '别名', '性别', '出生日期', '逝世日期', '国家', '简介',
    '豆瓣', 'IMDb', 'TMDB', 'Bangumi', '网址'
  ]);
  eq('社交账号 6 列（顺序固定）', MT.getPersonFieldList('account'), [
    '平台', '昵称', '账号ID', '账号名', '网址', '简介'
  ]);

  eq('影人模板键数 = 12', Object.keys(MT.getFullFieldTemplate('person', 'celebrity')).length, 12);
  eq('账号模板键数 = 6', Object.keys(MT.getFullFieldTemplate('person', 'account')).length, 6);
  eq('不带 kind 时退回 16 列并集（骨架兜底，不丢字段）',
    Object.keys(MT.getFullFieldTemplate('person')).length, 16);

  eq('getDisplayOrder 带 kind = 6 列', MT.getDisplayOrder('person', 'account').length, 6);
  eq('getDisplayOrder 带 kind = 12 列', MT.getDisplayOrder('person', 'celebrity').length, 12);
  eq('getDisplayOrder 不带 kind = 16 列（渲染层必须传，否则账号列会被撑大）',
    MT.getDisplayOrder('person').length, 16);
  eq('认不出的 kind 按 celebrity 兜底', MT.getPersonFieldList('???').length, 12);

  // 回归：其他大类的列一个都不能变
  eq('书籍仍是 17 列', MT.getDisplayOrder('book').length, 17);
  eq('社交仍是 7 列', MT.getDisplayOrder('social').length, 7);
  truthy('影视清单未被动过（24 项、首项「名字」、末项「结束时间」）',
    MT.MEDIA_FIELD_LISTS.media.length === 24
      && MT.MEDIA_FIELD_LISTS.media[0] === '名字'
      && MT.MEDIA_FIELD_LISTS.media[23] === '结束时间',
    '长度 ' + MT.MEDIA_FIELD_LISTS.media.length);

  /* ==================== 2. 日期补齐 ==================== */
  section('2. 日期补齐（person-date.js）');

  const PD = require(PERSON_DATE_PATH);
  const D = (v) => PD.fillPersonDate(v);

  eq('年月日齐全原样', D('1955年4月25日'), '1955-04-25');
  eq('斜杠日期', D('1955/4/25'), '1955-04-25');
  eq('点分日期', D('1955.04.25'), '1955-04-25');
  eq('只有年月 → 补当月 1 日', D('1955年4月'), '1955-04-01');
  eq('只有年月（短横线）', D('1955-04'), '1955-04-01');
  eq('只有年 → 补 1 月 1 日', D('1955年'), '1955-01-01');
  eq('只有年（纯数字）', D('1955'), '1955-01-01');
  eq('日期后面跟年龄括号', D('1955-04-25（70岁）'), '1955-04-25');

  truthy('**只补 01 不补 00**（补 00 会让 Excel 整列变文本）',
    D('1955年4月').slice(-2) === '01' && D('1955年').indexOf('-00') === -1);
  eq('不存在的日期原样返回，不猜', D('1955年2月30日'), '1955年2月30日');
  eq('明写「不详」→ 空', D('不详'), '');
  eq('空串 → 空', D(''), '');
  eq('纯空白 → 空', D('   '), '');
  eq('null → 空', D(null), '');
  eq('幂等：补齐过的再补一次不变', D(D('1955年4月')), '1955-04-01');

  /* ==================== 3. 国家抽取 ==================== */
  section('3. 国家抽取（country-extract.js）');

  const CE = require(COUNTRY_EXTRACT_PATH);
  const K = (v) => CE.extractCountry(v);

  eq('整串精确', K('美国'), '美国');
  eq('前缀匹配（带州名）', K('美国纽约州'), '美国');
  eq('分段匹配（国家在后）', K('纽约，美国'), '美国');
  eq('英文分段', K('New York, NY, USA'), '美国');
  eq('英文分段（全称）', K('New York City, New York, United States'), '美国');
  eq('中文空格分隔', K('美国 加利福尼亚州 洛杉矶'), '美国');
  eq('香港归一成中国香港', K('香港'), '中国香港');
  eq('已规范化值幂等', K('中国香港'), '中国香港');

  // 这条是本模块存在的理由：包含匹配会把「新墨西哥州」判成墨西哥
  eq('**新墨西哥州不能被「墨西哥」吃掉**', K('新墨西哥州，美国'), '美国');
  // 上面那条走的是「分段精确」，抓不到前缀匹配里的同类错误，所以再钉一条只剩前缀路径的：
  eq('**前缀匹配也不能被地名中间的国名吃掉**', K('美国新墨西哥州'), '美国');
  eq('墨西哥城仍判墨西哥（真正的墨西哥）', K('墨西哥城'), '墨西哥');
  eq('抽不出 → 留空（不拿城市名凑数）', K('好莱坞'), '');
  eq('抽不出 → 留空（日本地名没写国名）', K('東京都'), '');
  eq('空 → 空', K(''), '');
  eq('null → 空', K(null), '');

  /* ==================== 4. 装配器 ==================== */
  section('4. 人物装配器（person-fields-builder.js）');

  const B = require(BUILDER_PATH);

  eq('别名去重且只用英文逗号', B.normalizeAliases(['Al Pacino', '阿尔弗雷多', 'Al Pacino']), 'Al Pacino, 阿尔弗雷多');
  eq('别名不吃中文逗号输入但要输出英文逗号', B.normalizeAliases('甲，乙、丙'), '甲, 乙, 丙');
  truthy('别名分隔符里没有中文逗号', B.normalizeAliases('甲，乙').indexOf('，') === -1);
  eq('性别 Male → 男', B.normalizeGender('Male'), '男');
  eq('性别 Female → 女', B.normalizeGender('Female'), '女');
  eq('性别 男 原样', B.normalizeGender('男'), '男');
  eq('性别未知留空', B.normalizeGender(''), '');

  const celebFixture = {
    siteName: 'douban_celebrity',
    extractName: async () => '阿尔·帕西诺',
    extractAliases: async () => ['Al Pacino', '阿尔弗雷多·詹姆斯·帕西诺', 'Al Pacino'],
    extractGender: async () => 'Male',
    extractBirthDate: async () => '1940年4月',
    extractDeathDate: async () => '',
    extractBirthPlace: async () => '美国纽约州纽约市',
    extractProfession: async () => ['演员', '导演'],
    extractExtras: async () => ({ '星座': '水瓶座', '身高': '178cm' }),
    extractBio: async () => '简介正文。',
    extractImdbUrl: async () => 'https://www.imdb.com/name/nm0000199/',
    extractUrl: async () => 'https://movie.douban.com/celebrity/1041029/'
  };
  const rec = await B.build(celebFixture, { kind: 'celebrity' });

  eq('影人记录恰好 12 个内容列', MT.getPersonFieldList('celebrity').filter((k) => k in rec).length, 12);
  eq('mediaType = person', rec.mediaType, 'person');
  eq('personKind = celebrity', rec.personKind, 'celebrity');
  eq('姓名', rec['姓名'], '阿尔·帕西诺');
  eq('别名（外文名在前、去重）', rec['别名'], 'Al Pacino, 阿尔弗雷多·詹姆斯·帕西诺');
  eq('性别中文化', rec['性别'], '男');
  eq('出生日期补齐', rec['出生日期'], '1940-04-01');
  eq('逝世日期空', rec['逝世日期'], '');
  eq('国家从出生地抽出', rec['国家'], '美国');
  eq('简介：职业在前 + 补充 + 空行 + 正文',
    rec['简介'], '职业：演员, 导演\n补充：星座 水瓶座；身高 178cm\n\n简介正文。');
  truthy('简介正文在最后（用户明确要求）',
    rec['简介'].lastIndexOf('简介正文。') === rec['简介'].length - '简介正文。'.length);
  eq('外链 IMDb', rec['IMDb'], 'https://www.imdb.com/name/nm0000199/');

  const acctFixture = {
    siteName: 'douyin_profile',
    platformName: '抖音',
    extractNickname: async () => '东东来了',
    extractAccountId: async () => ' MS4wLjABAAAA ',
    extractAccountName: async () => 'ddy666',
    extractBio: async () => '',
    extractUrl: async () => 'https://www.douyin.com/user/MS4wLjABAAAA?from_tab_name=main'
  };
  const acct = await B.build(acctFixture, { kind: 'account' });

  eq('账号记录恰好 6 个内容列', MT.getPersonFieldList('account').filter((k) => k in acct).length, 6);
  eq('personKind = account', acct.personKind, 'account');
  eq('平台取自 platformName', acct['平台'], '抖音');
  eq('账号ID 只去空白，不改写内部 ID', acct['账号ID'], 'MS4wLjABAAAA');
  eq('没有签名就留空（不写站名兜底）', acct['简介'], '');
  truthy('账号记录里没有影人字段', acct['姓名'] === undefined && acct['国家'] === undefined);
  truthy('影人记录里没有账号字段', rec['平台'] === undefined && rec['昵称'] === undefined);

  // 单字段抛错不能拖垮整份数据
  const broken = {
    siteName: 'x',
    extractName: async () => { throw new Error('boom'); },
    extractBirthDate: async () => '1990-01-01'
  };
  const recBroken = await B.build(broken, { kind: 'celebrity' });
  eq('单字段抛错 → 该列置空', recBroken['姓名'], '');
  eq('其他列仍正常', recBroken['出生日期'], '1990-01-01');
  eq('兜底仍是完整 12 列', MT.getPersonFieldList('celebrity').filter((k) => k in recBroken).length, 12);

  /* ==================== 5. 类型判定（多规则） ==================== */
  section('5. 抖音 /user/ 双语义判定（media-detector.js）');

  global.WBR = { runtime: { sendMessage: async () => ({ configs: {} }) } };
  // media-detector 的 checkSiteSpecificIndicators() 直接用 window.location；
  // 给一个安全 mock，免得测到「需要内容二次确认」的站（豆瓣/番组/微博）时在 Node 里炸。
  global.window = global.window || { location: { hostname: 'localhost', pathname: '/', href: 'https://localhost/' } };
  const Detector = require(DETECTOR_PATH);
  const detector = Object.create(Detector.prototype);
  detector.siteConfigs = detector.getDefaultConfigs();
  const fakeDoc = { title: '', body: { innerText: '' }, querySelectorAll: () => [], querySelector: () => null };

  const SEC = 'MS4wLjABAAAATeeWHaXZ7dWwyDuDEOZAXpKT2EWH2pdixzq9cU3cBkZstCaNaPwYy724UjSZPxMZ';
  eq('作者主页 → person', detector.detect('https://www.douyin.com/user/' + SEC, fakeDoc), 'person');
  eq('主页带 from_tab_name 仍是 person',
    detector.detect('https://www.douyin.com/user/' + SEC + '?from_tab_name=main', fakeDoc), 'person');
  eq('**同一路径带 modal_id 是作品弹窗 → 不是 person**',
    detector.detect('https://www.douyin.com/user/' + SEC + '?modal_id=7672265848853220618', fakeDoc), null);
  eq('视频页仍是 social', detector.detect('https://www.douyin.com/video/7672265848853220618', fakeDoc), 'social');
  eq('图文页仍是 social', detector.detect('https://www.douyin.com/note/7672265848853220618', fakeDoc), 'social');
  eq('精选流仍不出按钮', detector.detect('https://www.douyin.com/jingxuan', fakeDoc), null);

  // 回归：其他站点判定一个都不能变
  // 只挑「路径命中即定案」的站（豆瓣电影 / 番组 / 微博要走正文二次确认，那不是本次改动面）
  eq('豆瓣书籍仍是 book', detector.detect('https://book.douban.com/subject/1084336/', fakeDoc), 'book');
  eq('起点仍是 book', detector.detect('https://www.qidian.com/book/1010462882/', fakeDoc), 'book');
  eq('IMDb 仍是 movie', detector.detect('https://www.imdb.com/title/tt0068646/', fakeDoc), 'movie');
  eq('TMDB 剧集仍是 movie', detector.detect('https://www.themoviedb.org/tv/1399/', fakeDoc), 'movie');
  eq('MobyGames 仍是 game', detector.detect('https://www.mobygames.com/game/1234/x/', fakeDoc), 'game');
  eq('快手仍是 social', detector.detect('https://www.kuaishou.com/short-video/3xabc', fakeDoc), 'social');
  eq('IG 仍是 social', detector.detect('https://www.instagram.com/p/ABC123/', fakeDoc), 'social');

  // v2.7.16 / v2.7.17：小红书、快手的个人主页同样是人物档案。
  // 这两条是「三站口径统一」的最后一环 —— 少了它们，主页地址在 detect 层面就还是 null，
  // 页面上一颗按钮都不会出现（init 会走「类型为空」分支）。
  eq('小红书个人主页 → person',
    detector.detect('https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568', fakeDoc), 'person');
  eq('小红书个人主页带 token 仍是 person',
    detector.detect('https://www.xiaohongshu.com/user/profile/6745e0e60000000001003568?xsec_token=abc', fakeDoc), 'person');
  eq('快手个人主页 → person',
    detector.detect('https://www.kuaishou.com/profile/3xb7355iu5cb6r4', fakeDoc), 'person');
  eq('快手个人主页带 source=SEARCH 仍是 person（真机形态）',
    detector.detect('https://www.kuaishou.com/profile/3xb7355iu5cb6r4?source=SEARCH', fakeDoc), 'person');
  eq('快手作品页不被主页规则吃掉',
    detector.detect('https://www.kuaishou.com/short-video/3xb7355iu5cb6r4', fakeDoc), 'social');
  eq('小红书笔记页不被主页规则吃掉',
    detector.detect('https://www.xiaohongshu.com/explore/6745e0e60000000001003568', fakeDoc), 'social');

  const DETECTOR_SRC = src(DETECTOR_PATH);
  truthy('detect 走规则数组（不是单个 type）', /_rulesOf\(siteConfig\)/.test(DETECTOR_SRC));
  truthy('有排除参数机制', /excludeQuery/.test(DETECTOR_SRC));
  truthy('背景配置与服务端配置都有同一条抖音 person 规则',
    (src(BACKGROUND_PATH).match(/type: 'person', patterns: \['\/user\/'\], excludeQuery: \['modal_id'\]/g) || []).length === 1
    && (DETECTOR_SRC.match(/type: 'person', patterns: \['\/user\/'\], excludeQuery: \['modal_id'\]/g) || []).length === 1);

  /* ==================== 6. 提取器路由顺序 ==================== */
  section('6. 提取器路由（extractor-factory.js）');

  const FACTORY_SRC = src(FACTORY_PATH);
  // 用「规则自己的特征串」定位，绕开正则字面量里 `\/` 与结束斜杠叠一起的转义陷阱
  const iPerson = FACTORY_SRC.indexOf("hostname: 'www.douyin.com', mediaType: 'person'");
  const iSocial = FACTORY_SRC.indexOf("hostname: 'www.douyin.com', mediaType: 'social'");
  truthy('抖音 person 规则存在', iPerson > -1, '未找到 person 规则');
  truthy('抖音 social 规则存在', iSocial > -1, '未找到 social 规则');
  truthy('**person 规则必须排在 social 之前**（否则 /user/ 被 social 吃掉）',
    iPerson > -1 && iSocial > -1 && iPerson < iSocial, `person@${iPerson} social@${iSocial}`);
  truthy('person 规则带 excludeQuery', /mediaType: 'person', excludeQuery: \['modal_id'\]/.test(FACTORY_SRC));
  truthy('排除参数是 continue 不是 return null（否则弹窗态丢掉 social 提取器）',
    /excludeQuery\.some\(\s*\(key\)[\s\S]{0,200}?\)\s*\{\s*continue;/.test(FACTORY_SRC));

  /* ==================== 7. UI 层 ==================== */
  section('7. UI 层适配');

  const DP_SRC = src(DATA_PROCESSOR_PATH);
  truthy('person 有自己的字段裁剪分支', /mediaType === 'person'/.test(DP_SRC));
  truthy('person 分支按 personKind 取列', /getPersonFieldKeys\(personKind\)/.test(DP_SRC));
  truthy('**进度四列不注入 person**', /mediaType !== 'social' && mediaType !== 'person'/.test(DP_SRC));
  truthy('getDisplayOrder 调用带上了 kind', /getDisplayOrder\(mediaType, personKind\)/.test(DP_SRC));
  truthy('没有「隐藏空值列」逻辑（用户明确不要）',
    DP_SRC.indexOf('hideEmpty') === -1 && DP_SRC.indexOf('filterEmpty') === -1);

  const TR_SRC = src(TABLE_RENDERER_PATH);
  truthy('渲染层：person 的「网址」走专用分支（显示原文，不走社交的「点击访问」）', /mediaType === 'person' && fieldName === '网址'/.test(TR_SRC));
  truthy('渲染层：账号ID 不做 URL 检测', /fieldName === '账号ID'/.test(TR_SRC));

  // v2.7.13 用户定：人物档案的「网址」直接显示网址本身，不做超链接，也不输出 [点击访问](url)
  const CE_SRC = src(COPY_EXPORT_PATH);
  eq('导出层：person 的「网址」不再包成 [点击访问](url)',
    (CE_SRC.match(/mediaType === 'person' && fieldName === '网址'/g) || []).length, 0);
  eq('导出层：社交「URL」的两处 [点击访问] 仍在（横向+纵向）',
    (CE_SRC.match(/mediaType === 'social' && fieldName === 'URL'/g) || []).length, 2);

  // 真跑导出：源码里"没写 person"不等于"实际不输出"，还得跑一遍才算数
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(COPY_EXPORT_PATH, 'utf8'));
    const M = dom.window.ModalCopyMixin;
    async function mdOf(fields, mediaType, mode) {
      let captured = '';
      const ctx = Object.assign(Object.create(M), {
        data: fields, fieldOrder: Object.keys(fields), displayMode: mode,
        getMediaType: () => mediaType,
        cleanData: (v) => String(v), escapeMarkdown: (v) => String(v),
        copyToClipboard: async (t) => { captured = t; return true; },
        showMessage: () => {}
      });
      const r = await M.copyDataAsMarkdown.call(ctx);
      return r === false ? '__FAILED__' : captured;
    }
    const pv = await mdOf({ 姓名: '甲', 网址: 'https://www.douyin.com/user/abc' }, 'person', 'vertical');
    truthy('导出真跑（纵向）：person 的「网址」是裸网址',
      pv.indexOf('https://www.douyin.com/user/abc') > -1 && pv.indexOf('点击访问') === -1, pv);
    const ph = await mdOf({ 姓名: '甲', 网址: 'https://www.douyin.com/user/abc' }, 'person', 'horizontal');
    truthy('导出真跑（横向）：person 的「网址」是裸网址',
      ph.indexOf('https://www.douyin.com/user/abc') > -1 && ph.indexOf('点击访问') === -1, ph);
    const sh = await mdOf({ URL: 'https://x.com/a' }, 'social', 'horizontal');
    truthy('导出真跑（横向）：social 的「URL」仍输出 [点击访问](url)',
      sh.indexOf('[点击访问](https://x.com/a)') > -1, sh);
    const sv = await mdOf({ URL: 'https://x.com/a' }, 'social', 'vertical');
    truthy('导出真跑（纵向）：social 的「URL」仍输出 [点击访问](url)',
      sv.indexOf('[点击访问](https://x.com/a)') > -1, sv);
  }

  // 真跑渲染层：person 网址必须**可点**，且显示的是网址原文（v2.7.31 用户改口径）
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(TABLE_RENDERER_PATH, 'utf8'));
    const M = dom.window.ModalTableMixin;
    const personCell = M.buildFieldContent.call(M, '网址', 'https://www.douyin.com/user/abc', 'person');
    truthy('渲染层：person 的「网址」是可点超链接（v2.7.31）',
      personCell.indexOf('<a ') > -1, personCell);
    truthy('渲染层：链接 href 指向该网址且新窗口打开',
      personCell.indexOf('href="https://www.douyin.com/user/abc"') > -1
      && personCell.indexOf('target="_blank"') > -1, personCell);
    truthy('渲染层：person 的「网址」原样显示网址串（不是「点击访问」四个字）',
      personCell.indexOf('https://www.douyin.com/user/abc') > -1 && personCell.indexOf('点击访问') === -1, personCell);
    // 不是网址的值不能硬套链接（防 javascript: 注入 / 脏数据变可点）
    const badCell = M.buildFieldContent.call(M, '网址', 'javascript:alert(1)', 'person');
    truthy('渲染层：非 URL 的「网址」不渲染成链接',
      badCell.indexOf('<a ') === -1, badCell);
    const socialCell = M.buildFieldContent.call(M, 'URL', 'https://x.com/a', 'social');
    truthy('渲染层：social 的「URL」仍是「点击访问」（这次改动没波及社交站）',
      socialCell.indexOf('点击访问') > -1, socialCell);
  }

  // v2.7.14：人物档案「简介」要保留换行 + 把 Markdown 链接渲染成可点的 <a>
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(TABLE_RENDERER_PATH, 'utf8'));
    const M = dom.window.ModalTableMixin;
    const bio = '粉丝：1640 · 获赞：2.9万\n闺蜜[@甲](https://www.douyin.com/user/SEC1) \n不会找别的闺蜜';
    const cell = M.buildFieldContent.call(M, '简介', bio, 'person');
    truthy('渲染层：person 简介里的 [文字](url) 变成可点 <a>',
      cell.indexOf('<a href="https://www.douyin.com/user/SEC1"') > -1, cell);
    truthy('渲染层：链接文字不再带方括号', cell.indexOf('[@甲]') === -1, cell);
    truthy('渲染层：换行变成 <br>（不是压成一坨）', cell.indexOf('<br>') > -1, cell);
    truthy('渲染层：单元格里不残留 Markdown 语法 "](http"', cell.indexOf('](http') === -1, cell);
    truthy('渲染层：统计行还在最前面', cell.indexOf('粉丝：1640') > -1, cell);

    // 同一段文字在社交站必须保持原样 —— 这个渲染改动只该作用在人物档案
    const socialBio = M.buildFieldContent.call(M, '简介', bio, 'social');
    truthy('渲染层：社交站的简介不被链接化（改动不外溢）', socialBio.indexOf('<a ') === -1, socialBio);

    // 超长仍折叠，但不能把「粉丝…」那行折叠掉（400 字阈值）
    const long = bio + '\n' + '很长的签名'.repeat(100); // ~530 字，越过 400 阈值
    const longCell = M.buildFieldContent.call(M, '简介', long, 'person');
    truthy('渲染层：超 400 字仍会折叠（不撑破浮窗）', longCell.indexOf('is-clampable') > -1, longCell.slice(0, 80));

    // 关键：长度要按「可见文字」算。抖音一条 @ 的 secUid 76 个字符，
    // 四条就是 300+，按原始长度算会把只有五行字的签名误判成超长文本折叠掉。
    // URL 要够长（>400）才能区分两种算法：按原始长度算必然折叠，按可见长度算不折叠
    const longUrl = 'https://www.douyin.com/user/' + 'A'.repeat(400);
    const shortVisible = '粉丝：1640\n[@甲](' + longUrl + ') 不算长';
    const svCell = M.buildFieldContent.call(M, '简介', shortVisible, 'person');
    truthy('渲染层：链接 URL 长度不计入折叠判断（可见文字短就不折叠）',
      svCell.indexOf('is-clampable') === -1, svCell.slice(0, 80));
    truthy('渲染层：长 URL 的 @ 仍然是可点链接', svCell.indexOf('<a href="' + longUrl + '"') > -1, svCell.slice(0, 120));
  }

  // v2.7.32：简介里的**裸网址**也要能点（用户 2026-11-01 提，样本取自 x.com/AI_Jasonyu 真机简介）
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(TABLE_RENDERER_PATH, 'utf8'));
    const M = dom.window.ModalTableMixin;
    const L = (v) => M.linkifyPersonBio(v);

    // ① 带协议：href 原样、链接文字就是网址本身
    const a1 = L('付费墙Agent：\nhttp://paywallpro.app');
    truthy('裸网址①：带协议的网址变成 <a>',
      a1.indexOf('<a href="http://paywallpro.app"') > -1 && a1.indexOf('>http://paywallpro.app</a>') > -1, a1);

    // ② 无协议域名：href 补 https://，显示仍是原样
    const a2 = L('个人站 yuzong.ai/bio 欢迎');
    truthy('裸网址②：无协议域名 href 补 https://',
      a2.indexOf('<a href="https://yuzong.ai/bio"') > -1, a2);
    truthy('裸网址②：显示文字不许多出 https://',
      a2.indexOf('>yuzong.ai/bio</a>') > -1, a2);

    // ③ 顺序铁律：Markdown 链接先占位，裸网址扫描不许钻进 <a href> 里套娃
    const a3 = L('[@甲](https://www.douyin.com/user/SEC1) 还有 x.com/a');
    eq('裸网址③：Markdown 链接 + 裸网址 → 正好 2 个 <a>', (a3.match(/<a /g) || []).length, 2);
    truthy('裸网址③：没有套娃标签', a3.indexOf('"><a ') === -1, a3);
    truthy('裸网址③：Markdown 那条仍然完整',
      a3.indexOf('<a href="https://www.douyin.com/user/SEC1"') > -1, a3);

    // ④ 数字串绝不许误伤（版本号 / 小数 / 中文计数）
    eq('裸网址④：9.9 / v2.7.31 / 1.5万 都不变链接',
      (L('收益 $200k+ 比例 9.9 版本 v2.7.31 粉丝 1.5万').match(/<a /g) || []).length, 0);

    // ⑤ 邮箱绝不许误伤
    eq('裸网址⑤：邮箱不变链接',
      (L('联系 a@b.com 或 mail@c.org').match(/<a /g) || []).length, 0);

    // ⑥ 中文标点不许吃进 href（字符类已排除，属于「本来就不会进」）
    truthy('裸网址⑥：中文句号留在链接外面',
      L('看这里https://a.com。后面这句').indexOf('>https://a.com</a>。') > -1);

    // ⑥b 英文标点才是真正需要剥的（`.` `,` `)` 都在 URL 字符类里，不剥就会被吃进 href）
    const a6b = L('visit https://a.com. 结束');
    truthy('裸网址⑥b：英文句号被剥到链接外面',
      a6b.indexOf('<a href="https://a.com"') > -1 && a6b.indexOf('</a>.') > -1, a6b);
    const a6c = L('see (https://a.com/x) 结束');
    truthy('裸网址⑥c：右括号被剥到链接外面',
      a6c.indexOf('<a href="https://a.com/x"') > -1 && a6c.indexOf('</a>)') > -1, a6c);

    // ⑦ 端到端：真机 X 简介形态 → 两个网址都成链接、换行还在
    const real = '帖子：10552 · 关注者：7.2万\n付费墙Agent：\nhttp://paywallpro.app 2胎爸爸\nyuzong.ai/bio';
    const cell = M.buildFieldContent.call(M, '简介', real, 'person');
    eq('裸网址⑦：真机简介里 2 个网址都成链接', (cell.match(/<a /g) || []).length, 2);
    truthy('裸网址⑦：换行仍在（>=3 个 <br>）', (cell.match(/<br>/g) || []).length >= 3, cell);
    truthy('裸网址⑦：正文文字没被改动（2胎爸爸/关注者 仍在）',
      cell.indexOf('2胎爸爸') > -1 && cell.indexOf('关注者：7.2万') > -1, cell);

    // ⑧ 只作用于人物档案，社交站不许外溢
    eq('裸网址⑧：社交站简介仍不链接化',
      (M.buildFieldContent.call(M, '简介', '正文见 https://x.com/a 谢谢', 'social').match(/<a /g) || []).length, 0);
  }

  // v2.7.14：导出层三种格式各自的正确形态
  {
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<html><body></body></html>', { runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(COPY_EXPORT_PATH, 'utf8'));
    const M = dom.window.ModalCopyMixin;
    const bio = '粉丝：1640\n[@甲](https://www.douyin.com/user/SEC1)';

    eq('导出层 TSV：链接降级成纯文字、换行压成空格',
      M.plainCell.call(M, bio), '粉丝：1640 @甲');
    const h = M.richCell.call(M, bio);
    truthy('导出层 HTML：链接是真 <a>',
      h.indexOf('<a href="https://www.douyin.com/user/SEC1">@甲</a>') > -1, h);
    truthy('导出层 HTML：换行变 <br>', h.indexOf('<br>') > -1, h);
    eq('导出层 Markdown：链接原样保留、换行变 <br>',
      M.escapeMarkdown.call(M, bio), '粉丝：1640<br>[@甲](https://www.douyin.com/user/SEC1)');
  }

  // 方法测了不等于接线了（v2.7.14 踩过：plainCell 定义得好好的，copyData 却没调用，
  // 测试照样全绿）。这两条把「调用点」也钉住，改回 item.value 会立刻变红。
  {
    const XP_SRC = src(COPY_EXPORT_PATH);
    truthy('导出层接线：TSV 生成处调的是 this.plainCell 而不是原始值',
      /const tsvValues = dataItems\.map\(item => this\.plainCell\(item\.value\)\);/.test(XP_SRC),
      (XP_SRC.match(/const tsvValues = [^;]+;/) || [''])[0]);
    truthy('导出层接线：HTML 单元格生成处调的是 this.richCell',
      /<td>\$\{this\.richCell\(item\.value\)\}<\/td>/.test(XP_SRC),
      (XP_SRC.match(/html \+= `<td>[^`]+`;/) || [''])[0]);
  }

  // v2.7.12：getMediaType() 原先完全没有 person 分支 —— 人物档案被判成 general，
  // 渲染按 person 并集骨架 + 4 个进度字段 = 20 行。这里**真跑**这个方法，不只看源码文本。
  const { JSDOM } = require('jsdom');
  function getMediaType(href, data) {
    const dom = new JSDOM('<html><body></body></html>', { url: href, runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(PERSISTENCE_PATH, 'utf8'));
    return dom.window.ModalPersistenceMixin.getMediaType.call({ data: data });
  }
  // 用**认不出的网址**测「数据优先」这条分支：网址若也写成 /personage/，
  // 就算把数据分支删掉，URL 兜底照样返回 person，断言永远绿（典型假绿）。
  eq('getMediaType：数据自带 mediaType=person 时，与网址无关地直出 person',
    getMediaType('https://example.com/some-page', { mediaType: 'person' }), 'person');
  eq('getMediaType：数据被裁过（无 mediaType）时靠 URL 认出豆瓣影人',
    getMediaType('https://www.douban.com/personage/27253787/', { 姓名: '周星驰' }), 'person');
  eq('getMediaType：抖音作者主页 → person',
    getMediaType('https://www.douyin.com/user/MS4wLjABAAAATeeWHaXZ', { 昵称: '吹漫漫' }), 'person');
  truthy('getMediaType：抖音作品弹窗不能被当成人物主页',
    getMediaType('https://www.douyin.com/user/MS4wLjABAAAATeeWHaXZ?modal_id=7672265848853220618', {}) !== 'person');
  truthy('就地重渲染时 personKind 缺失可按「账号ID/账号名」反推',
    /'账号ID' in this\.data/.test(DP_SRC));

  const MW_SRC = src(MODAL_WINDOW_PATH);
  truthy('人物档案默认横向', /getMediaType\(\) === 'person'[\s\S]{0,200}?displayMode = 'horizontal'/.test(MW_SRC));

  const CK_SRC = src(CACHE_KEY_PATH);
  truthy('缓存键白名单加了 person', /'book', 'movie', 'tv', 'game', 'social', 'person'/.test(CK_SRC));

  /* ==================== 8. URL 规范化 ==================== */
  section('8. URL 规范化（url-normalizer.js）');

  const URLN = require(URL_NORMALIZER_PATH);
  eq('抖音主页去 query', URLN.normalize('https://www.douyin.com/user/' + SEC + '?from_tab_name=main'),
    'https://www.douyin.com/user/' + SEC);
  eq('**主页带 modal_id 时按作品处理**（不能被写成主页）',
    URLN.normalize('https://www.douyin.com/user/' + SEC + '?modal_id=7672265848853220618'),
    'https://www.douyin.com/video/7672265848853220618');
  eq('视频地址行为不变', URLN.normalize('https://www.douyin.com/video/7672265848853220618?previous_page=x'),
    'https://www.douyin.com/video/7672265848853220618');

  /* ==================== 总结 ==================== */
  console.log('\n' + '='.repeat(52));
  if (fail === 0) {
    console.log(`== 通过 ${pass} 项，失败 0 项 ==`);
  } else {
    console.log(`== 通过 ${pass} 项，失败 ${fail} 项 ==`);
    failures.forEach((f) => console.log('  ✗ ' + f));
  }
  console.log('='.repeat(52));
  process.exit(fail === 0 ? 0 : 1);
})();
