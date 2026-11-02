/**
 * 国家 / 地区名称统一转换器 · 纯函数单测（v2.5.68）
 *
 * 为什么单独做一份：13 个快照样本里，TMDB 抓的是**中文页**、IMDb 抓的是英国片，
 * 「英文页给 United States of America」这类洞快照永远测不出来，只能靠这里钉住。
 *
 * 跑法（项目根目录）：
 *   node tests/country-names.test.js
 *   node tests/country-names.test.js --verbose
 *
 * 判定：全部通过退出码 0，有任何失败退出码 1。
 */

'use strict';

const path = require('path');

const TARGET = path.join(__dirname, '..', 'ClipMate_chrome', 'src', 'shared', 'country-names.js');
const { COUNTRY_TABLE, countryDisplayName, standardizeRegionNames, standardizeCountryCode } = require(TARGET);

const VERBOSE = process.argv.includes('--verbose');

let pass = 0;
const fails = [];

function eq(label, got, want) {
  if (got === want) {
    pass++;
    if (VERBOSE) console.log(`  ✓ ${label} = ${JSON.stringify(got)}`);
  } else {
    fails.push({ label, got, want });
    console.log(`  ✗ ${label}\n      得到 ${JSON.stringify(got)}\n      期望 ${JSON.stringify(want)}`);
  }
}

/* ============================================================
 * 一、表结构自检
 * ==========================================================*/
console.log('一、表结构');
console.log(`  表的行数：${COUNTRY_TABLE.length}`);
eq('国家/地区数量够不够（≥190）', COUNTRY_TABLE.length >= 190, true);

// 规范名不能为空、不能重复
const canonicals = COUNTRY_TABLE.map(r => r[0]);
eq('没有重复的规范名', new Set(canonicals).size, canonicals.length);
eq('没有空的规范名', canonicals.filter(c => !c).length, 0);

// 禁止单字别名（单字有歧义：'新' 既是新加坡也是新西兰）
const singleCharAliases = [];
for (const row of COUNTRY_TABLE) {
  for (let i = 1; i < row.length; i++) {
    const v = String(row[i] || '');
    if (v.length === 1 && /[\u4e00-\u9fa5]/.test(v)) singleCharAliases.push(`${row[0]} ← ${v}`);
  }
}
eq('没有中文单字别名（防误伤）', singleCharAliases.join('|'), '');

// 每行必须自带规范名以外的至少一个别名
const rowsWithoutAlias = COUNTRY_TABLE.filter(r => r.length < 3).map(r => r[0]);
eq('每行至少有一个可识别写法', rowsWithoutAlias.join('|'), '');

/* ============================================================
 * 二、中国及港澳台（用户 2026-10-25 裁决：中国大陆 → 中国）
 * ==========================================================*/
console.log('二、中国及港澳台');
eq('中国大陆 → 中国', countryDisplayName('中国大陆'), '中国');
eq('中國大陸 → 中国', countryDisplayName('中國大陸'), '中国');
eq('中国 → 中国', countryDisplayName('中国'), '中国');
eq('中國 → 中国', countryDisplayName('中國'), '中国');
eq('内地 → 中国', countryDisplayName('内地'), '中国');
eq('大陆 → 中国', countryDisplayName('大陆'), '中国');
eq('中华人民共和国 → 中国', countryDisplayName('中华人民共和国'), '中国');
eq('Mainland China → 中国', countryDisplayName('Mainland China'), '中国');
eq('China → 中国', countryDisplayName('China'), '中国');
eq('PRC → 中国', countryDisplayName('PRC'), '中国');
eq('代码 CN → 中国', standardizeCountryCode('CN'), '中国');
eq('香港 → 中国香港', countryDisplayName('香港'), '中国香港');
eq('Hong Kong → 中国香港', countryDisplayName('Hong Kong'), '中国香港');
eq('代码 HK → 中国香港', standardizeCountryCode('HK'), '中国香港');
eq('澳门 → 中国澳门', countryDisplayName('澳门'), '中国澳门');
eq('Macau → 中国澳门', countryDisplayName('Macau'), '中国澳门');
eq('Macao → 中国澳门', countryDisplayName('Macao'), '中国澳门');
eq('台灣 → 中国台湾', countryDisplayName('台灣'), '中国台湾');
eq('臺灣 → 中国台湾', countryDisplayName('臺灣'), '中国台湾');
eq('代码 TW → 中国台湾', standardizeCountryCode('TW'), '中国台湾');

/* ============================================================
 * 三、大小写 / 标点 / 空白容错
 * ==========================================================*/
console.log('三、写法容错');
eq('小写代码 gb', standardizeCountryCode('gb'), '英国');
eq('USA → 美国', countryDisplayName('USA'), '美国');
eq('U.S.A. → 美国', countryDisplayName('U.S.A.'), '美国');
eq('united states（小写）', countryDisplayName('united states'), '美国');
eq('United States of America → 美国', countryDisplayName('United States of America'), '美国');
eq('前后空格', countryDisplayName('  日本  '), '日本');
eq('全角空格', countryDisplayName('日本　'), '日本');
eq('英文多空格', countryDisplayName('United   Kingdom'), '英国');

/* ============================================================
 * 四、英文 / 繁体 / 别名覆盖（快照测不到的那类）
 * ==========================================================*/
console.log('四、别名覆盖');
eq('Great Britain → 英国', countryDisplayName('Great Britain'), '英国');
eq('Scotland → 英国', countryDisplayName('Scotland'), '英国');
eq('Wales → 英国', countryDisplayName('Wales'), '英国');
eq('South Korea → 韩国', countryDisplayName('South Korea'), '韩国');
eq('南韩 → 韩国', countryDisplayName('南韩'), '韩国');
eq('North Korea → 朝鲜', countryDisplayName('North Korea'), '朝鲜');
eq('Burma → 缅甸', countryDisplayName('Burma'), '缅甸');
eq('锡兰 → 斯里兰卡', countryDisplayName('Ceylon'), '斯里兰卡');
eq('荷蘭 → 荷兰', countryDisplayName('荷蘭'), '荷兰');
eq('Türkiye → 土耳其', countryDisplayName('Türkiye'), '土耳其');
eq('荷属东印度未收录 → 原样', countryDisplayName('荷属东印度', { keepUnknown: true }), '荷属东印度');
eq('小国 冰岛', countryDisplayName('Iceland'), '冰岛');
eq('小国 尼日利亚', countryDisplayName('Nigeria'), '尼日利亚');
eq('小国 阿塞拜疆', countryDisplayName('Azerbaijan'), '阿塞拜疆');
eq('代码 AZ → 阿塞拜疆', standardizeCountryCode('AZ'), '阿塞拜疆');

/* ============================================================
 * 五、历史国家不并入现代国家（不篡改史实）
 * ==========================================================*/
console.log('五、历史国家');
eq('West Germany 仍是西德', countryDisplayName('West Germany'), '西德');
eq('East Germany 仍是东德', countryDisplayName('East Germany'), '东德');
eq('USSR 仍是苏联', countryDisplayName('USSR'), '苏联');
eq('Yugoslavia 仍是南斯拉夫', countryDisplayName('Yugoslavia'), '南斯拉夫');
eq('Czechoslovakia 仍是捷克斯洛伐克', countryDisplayName('Czechoslovakia'), '捷克斯洛伐克');
eq('Germany 仍是德国', countryDisplayName('Germany'), '德国');
eq('Russia 仍是俄罗斯', countryDisplayName('Russia'), '俄罗斯');
eq('代码 XWG → 西德', standardizeCountryCode('XWG'), '西德');
eq('代码 SU → 苏联', standardizeCountryCode('SU'), '苏联');

/* ============================================================
 * 六、多值 / 分隔符 / 去重
 * ==========================================================*/
console.log('六、多值处理');
eq('豆瓣详情页斜杠', standardizeRegionNames('美国 / 英国'), '美国, 英国');
eq('英文逗号', standardizeRegionNames('美国,英国'), '美国, 英国');
eq('中文逗号', standardizeRegionNames('美国，英国'), '美国, 英国');
eq('顿号', standardizeRegionNames('美国、英国'), '美国, 英国');
eq('豆瓣选电影的空格', standardizeRegionNames('美国 英国 加拿大'), '美国, 英国, 加拿大');
eq('去重', standardizeRegionNames('美国, 美国'), '美国');
eq('去重（别名同指）', standardizeRegionNames('美国, USA'), '美国');
eq('数组输入', standardizeRegionNames(['US', 'GB']), '美国, 英国');
eq('中英混排空格不切碎', standardizeRegionNames('美国 / Japan'), '美国, 日本');
eq('英文多词不切碎', standardizeRegionNames('South Korea'), '韩国');
eq('英文多词不切碎2', standardizeRegionNames('United States of America'), '美国');
eq('英文多词不切碎3', standardizeRegionNames('New Zealand'), '新西兰');
eq('英文多值', standardizeRegionNames('United States, United Kingdom'), '美国, 英国');
eq('未收录的夹在中间不丢', standardizeRegionNames('Atlantis, 美国'), 'Atlantis, 美国');
eq('空串', standardizeRegionNames(''), '');
eq('null', standardizeRegionNames(null), '');
eq('undefined', standardizeRegionNames(undefined), '');
eq('纯空白', standardizeRegionNames('   '), '');

/* ============================================================
 * 七、查不到时的行为（用户裁决：原样返回）
 * ==========================================================*/
console.log('七、未知值');
eq('中文未知原样', countryDisplayName('阿特兰蒂斯', { keepUnknown: true }), '阿特兰蒂斯');
eq('英文未知原样', countryDisplayName('Atlantis', { keepUnknown: true }), 'Atlantis');
eq('中文未知（不保留时留空）', countryDisplayName('阿特兰蒂斯'), '');
eq('代码未知返回空', standardizeCountryCode('ZZ'), '');
eq('代码未知返回空2', standardizeCountryCode('QQ'), '');

/* ============================================================
 * 八、13 个快照样本的现值回归（合并后必须一条都不变）
 * ==========================================================*/
console.log('八、快照样本现值回归');
eq('17K 三个样本现为「中国」', standardizeRegionNames('中国'), '中国');
eq('Bangumi 样本 日本', standardizeRegionNames('日本'), '日本');
eq('豆瓣读书样本 法国', standardizeRegionNames('法国'), '法国');
eq('豆瓣电影样本 美国', standardizeRegionNames('美国'), '美国');
eq('IMDb 样本 英国', standardizeRegionNames('英国'), '英国');
eq('TMDB 样本 美国', standardizeRegionNames('美国'), '美国');

/* ============================================================
 * 结果
 * ==========================================================*/
console.log('');
if (fails.length === 0) {
  console.log(`✅ 全部通过：${pass} 条断言，${COUNTRY_TABLE.length} 个国家/地区`);
  process.exit(0);
} else {
  console.log(`❌ 失败 ${fails.length} 条 / 共 ${pass + fails.length} 条断言`);
  fails.forEach(f => console.log(`   · ${f.label}：得到 ${JSON.stringify(f.got)}，期望 ${JSON.stringify(f.want)}`));
  process.exit(1);
}
