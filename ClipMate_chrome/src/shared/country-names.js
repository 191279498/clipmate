/**
 * 采媒灵 · 国家 / 地区名称统一转换器
 * ============================================================================
 * v2.5.68 起，全扩展只有这一张国家名称表。原先分散的三张表已合并：
 *   ① base-extractor.js 的 regionStandardizationMap（14 条）→ 已删除，改为调用本文件
 *   ② imdb.js 的 IMDB_COUNTRY_TABLE（68 条）→ 已删除，改为调用本文件
 *   ③ douban-book.js 的 countryMap（单字码 [英]→英国）→ **保留**（单字无法并入总表），
 *      查不到时再回调本文件兜底
 *
 * 命名基准：**豆瓣电影**（用户 2026-10-25 裁决）。
 * 中国大陆的规范值按用户 2026-10-25 追加裁决取「中国」（非豆瓣原文的「中国大陆」）。
 *
 * 实证来源：
 *  1) 豆瓣「选电影」页（https://movie.douban.com/explore）真实抓取，条目里国家写法为：
 *     中国大陆 / 中国香港 / 中国台湾 / 美国 / 英国 / 日本 / 韩国 / 法国 / 德国 /
 *     加拿大 / 澳大利亚 / 奥地利 —— 多个国家用空格分隔。
 *  2) 豆瓣详情页真实存档（tests/fixtures/html/douban-movie-1292052.html）：
 *     `<span class="pl">制片国家/地区:</span> 美国<br>` —— 多个国家用 " / " 分隔。
 *  3) 第三方引用豆瓣原始数据的分析文（CSDN）样例值：`中国大陆 / 中国香港`。
 *  4) 豆瓣搜索接口 `j/new_search_subjects?countries=<中文名>` 对下列名称均正常返回：
 *     冰岛 / 尼日利亚 / 伊朗 / 越南 / 捷克 / 塞尔维亚 / 中国澳门。
 *  ※ 豆瓣详情页对 curl 返回 302（反爬），故未逐国抓详情页核对；表中数据级别见每行行尾注释。
 *
 * 结构：[规范中文, 代码, ...别名...]
 *   · 第 1 项 = 输出值（统一显示用这个名字）
 *   · 第 2 项 = 两/三字母代码（IMDb / ISO 风格），无代码填 ''
 *   · 第 3 项起 = 所有可接受的输入写法（英文全称、英文别名、中文变体），一律映射到第 1 项
 *   · **禁止加入单字别名**（如 '英'/'美'/'港'）：单字有歧义，还会误伤别的词
 *
 * 硬规则：
 *   · 历史国家**不并入现代国家**（西德 ≠ 德国、苏联 ≠ 俄罗斯、南斯拉夫 ≠ 塞尔维亚）
 *   · 查不到的写法**原样返回**，不猜、不丢
 *   · 输出多条时用 ", "（半角逗号 + 空格）连接，并去重
 */

const COUNTRY_TABLE = [
  // ===================== 中国及港澳台 =====================
  // 用户裁决：豆瓣原文「中国大陆」，但扩展内统一显示「中国」（起点/番茄/17K 也写死「中国」）
  ['中国', 'CN', 'China', 'Mainland China', "People's Republic of China", 'PRC',
    '中国大陆', '中國', '中国内地', '中国内地地区', '中国大陆地区', '中國大陸', '内地', '大陆', '中华人民共和国'],
  ['中国香港', 'HK', 'Hong Kong', 'Hong Kong SAR', 'HK SAR', '香港', '中國香港'],
  ['中国澳门', 'MO', 'Macao', 'Macau', 'Macao SAR', '澳门', '澳門', '中國澳門'],
  ['中国台湾', 'TW', 'Taiwan', 'Taiwan Region', '台湾', '台灣', '臺灣', '中國台灣'],

  // ===================== 亚洲 =====================
  ['日本', 'JP', 'Japan', 'Nippon', '日本国'],
  ['韩国', 'KR', 'South Korea', 'Korea', 'Republic of Korea', 'ROK', 'KOR', '南韩', '南韓', '大韩民国'],
  ['朝鲜', 'KP', 'North Korea', 'DPRK', "Democratic People's Republic of Korea", '北韩', '北韓', '朝鲜民主主义人民共和国'],
  ['蒙古', 'MN', 'Mongolia', '蒙古国'],
  ['越南', 'VN', 'Vietnam', 'Viet Nam', '越南社会主义共和国'],
  ['老挝', 'LA', 'Laos', 'Lao', '寮国', '寮國'],
  ['柬埔寨', 'KH', 'Cambodia', 'Kampuchea', '高棉'],
  ['泰国', 'TH', 'Thailand', '暹罗', '暹羅'],
  ['缅甸', 'MM', 'Myanmar', 'Burma', '緬甸'],
  ['马来西亚', 'MY', 'Malaysia', '馬來西亞'],
  ['新加坡', 'SG', 'Singapore', '星加坡', '星洲'],
  ['印度尼西亚', 'ID', 'Indonesia', '印尼', '印度尼西亞'],
  ['菲律宾', 'PH', 'Philippines', 'the Philippines', '菲律賓'],
  ['文莱', 'BN', 'Brunei', 'Brunei Darussalam', '汶莱', '汶萊'],
  ['东帝汶', 'TL', 'East Timor', 'Timor-Leste', '東帝汶'],
  ['印度', 'IN', 'India', '印度共和国'],
  ['巴基斯坦', 'PK', 'Pakistan'],
  ['孟加拉国', 'BD', 'Bangladesh', '孟加拉'],
  ['斯里兰卡', 'LK', 'Sri Lanka', 'Ceylon', '锡兰', '錫蘭'],
  ['尼泊尔', 'NP', 'Nepal', '尼泊爾'],
  ['不丹', 'BT', 'Bhutan'],
  ['马尔代夫', 'MV', 'Maldives', '馬爾地夫'],
  ['阿富汗', 'AF', 'Afghanistan'],
  ['伊朗', 'IR', 'Iran', 'Persia', '波斯'],
  ['伊拉克', 'IQ', 'Iraq'],
  ['叙利亚', 'SY', 'Syria', '敘利亞'],
  ['黎巴嫩', 'LB', 'Lebanon'],
  ['约旦', 'JO', 'Jordan', '約旦'],
  ['以色列', 'IL', 'Israel'],
  ['巴勒斯坦', 'PS', 'Palestine', 'State of Palestine', '巴勒斯坦国'],
  ['沙特阿拉伯', 'SA', 'Saudi Arabia', '沙乌地阿拉伯', '沙烏地阿拉伯'],
  ['阿联酋', 'AE', 'United Arab Emirates', 'UAE', '阿拉伯联合酋长国', '阿聯酋'],
  ['卡塔尔', 'QA', 'Qatar', '卡達', '卡塔爾'],
  ['科威特', 'KW', 'Kuwait'],
  ['巴林', 'BH', 'Bahrain'],
  ['阿曼', 'OM', 'Oman'],
  ['也门', 'YE', 'Yemen', '葉門'],
  ['土耳其', 'TR', 'Turkey', 'Türkiye', 'Turkiye', '土爾其'],
  ['塞浦路斯', 'CY', 'Cyprus', '賽普勒斯'],
  ['格鲁吉亚', 'GE', 'Georgia', '喬治亞'],
  ['亚美尼亚', 'AM', 'Armenia', '亞美尼亞'],
  ['阿塞拜疆', 'AZ', 'Azerbaijan', '亞塞拜然'],
  ['哈萨克斯坦', 'KZ', 'Kazakhstan', '哈萨克', '哈薩克'],
  ['乌兹别克斯坦', 'UZ', 'Uzbekistan', '乌兹别克', '烏茲別克'],
  ['土库曼斯坦', 'TM', 'Turkmenistan'],
  ['吉尔吉斯斯坦', 'KG', 'Kyrgyzstan', 'Kirghizia', '吉尔吉斯'],
  ['塔吉克斯坦', 'TJ', 'Tajikistan', '塔吉克'],

  // ===================== 欧洲 =====================
  ['英国', 'GB', 'United Kingdom', 'UK', 'U.K.', 'Great Britain', 'Britain',
    'England', 'Scotland', 'Wales', 'Northern Ireland',
    '英国本土', '英格兰', '苏格兰', '威尔士', '北爱尔兰', '大不列颠', '英伦', '英格蘭'],
  ['爱尔兰', 'IE', 'Ireland', 'Republic of Ireland', '爱尔兰共和国', '愛爾蘭'],
  ['法国', 'FR', 'France', '法兰西', '法國'],
  ['德国', 'DE', 'Germany', 'Deutschland', '德意志', '德國'],
  ['意大利', 'IT', 'Italy', 'Italia', '義大利', '义大利'],
  ['西班牙', 'ES', 'Spain', 'España'],
  ['葡萄牙', 'PT', 'Portugal'],
  ['荷兰', 'NL', 'Netherlands', 'the Netherlands', 'Holland', '尼德兰', '荷蘭'],
  ['比利时', 'BE', 'Belgium', '比利時'],
  ['卢森堡', 'LU', 'Luxembourg', '盧森堡'],
  ['瑞士', 'CH', 'Switzerland', 'Schweiz', 'Suisse'],
  ['奥地利', 'AT', 'Austria', 'Österreich', '奧地利'],
  ['列支敦士登', 'LI', 'Liechtenstein'],
  ['摩纳哥', 'MC', 'Monaco', '摩納哥'],
  ['安道尔', 'AD', 'Andorra', '安道爾'],
  ['圣马力诺', 'SM', 'San Marino', '聖馬利諾'],
  ['梵蒂冈', 'VA', 'Vatican', 'Vatican City', 'Holy See', '教廷', '梵蒂岡'],
  ['马耳他', 'MT', 'Malta', '馬爾他'],
  ['丹麦', 'DK', 'Denmark', 'Danmark', '丹麥'],
  ['挪威', 'NO', 'Norway', 'Norge', '挪威'],
  ['瑞典', 'SE', 'Sweden', 'Sverige'],
  ['芬兰', 'FI', 'Finland', 'Suomi', '芬蘭'],
  ['冰岛', 'IS', 'Iceland', 'Ísland', '冰島'],
  ['法罗群岛', 'FO', 'Faroe Islands', 'Faroes', '法羅群島'],
  ['格陵兰', 'GL', 'Greenland', '格陵蘭'],
  ['波兰', 'PL', 'Poland', 'Polska', '波蘭'],
  ['捷克', 'CZ', 'Czech Republic', 'Czechia', '捷克共和国', '捷克共和國'],
  ['斯洛伐克', 'SK', 'Slovakia', 'Slovak Republic'],
  ['匈牙利', 'HU', 'Hungary', 'Magyarország'],
  ['罗马尼亚', 'RO', 'Romania', 'Rumania', '羅馬尼亞'],
  ['保加利亚', 'BG', 'Bulgaria', '保加利亞'],
  ['希腊', 'GR', 'Greece', 'Hellas', '希臘'],
  ['阿尔巴尼亚', 'AL', 'Albania', '阿爾巴尼亞'],
  ['塞尔维亚', 'RS', 'Serbia', '塞爾維亞'],
  ['克罗地亚', 'HR', 'Croatia', 'Hrvatska', '克羅埃西亞', '克羅地亞'],
  ['斯洛文尼亚', 'SI', 'Slovenia', '斯洛維尼亞'],
  ['波黑', 'BA', 'Bosnia and Herzegovina', 'Bosnia', '波斯尼亚和黑塞哥维那', '波士尼亞'],
  ['黑山', 'ME', 'Montenegro', '蒙特內哥羅'],
  ['北马其顿', 'MK', 'North Macedonia', 'Macedonia', '马其顿', '馬其頓'],
  ['科索沃', 'XK', 'Kosovo'],
  ['爱沙尼亚', 'EE', 'Estonia', '愛沙尼亞'],
  ['拉脱维亚', 'LV', 'Latvia', '拉脫維亞'],
  ['立陶宛', 'LT', 'Lithuania'],
  ['俄罗斯', 'RU', 'Russia', 'Russian Federation', '俄国', '俄國', '俄羅斯'],
  ['白俄罗斯', 'BY', 'Belarus', 'Byelorussia', '白俄羅斯'],
  ['乌克兰', 'UA', 'Ukraine', '烏克蘭'],
  ['摩尔多瓦', 'MD', 'Moldova', 'Moldavia', '摩爾多瓦'],
  ['直布罗陀', 'GI', 'Gibraltar'],

  // ===================== 非洲 =====================
  ['埃及', 'EG', 'Egypt'],
  ['利比亚', 'LY', 'Libya', '利比亞'],
  ['突尼斯', 'TN', 'Tunisia'],
  ['阿尔及利亚', 'DZ', 'Algeria', '阿爾及利亞'],
  ['摩洛哥', 'MA', 'Morocco'],
  ['西撒哈拉', 'EH', 'Western Sahara'],
  ['毛里塔尼亚', 'MR', 'Mauritania'],
  ['塞内加尔', 'SN', 'Senegal', '塞內加爾'],
  ['冈比亚', 'GM', 'Gambia', 'the Gambia', '甘比亞'],
  ['几内亚', 'GN', 'Guinea', '幾內亞'],
  ['几内亚比绍', 'GW', 'Guinea-Bissau', '幾內亞比索'],
  ['塞拉利昂', 'SL', 'Sierra Leone', '狮子山', '獅子山'],
  ['利比里亚', 'LR', 'Liberia', '賴比瑞亞'],
  ['科特迪瓦', 'CI', "Côte d'Ivoire", 'Ivory Coast', '象牙海岸', '科特迪瓦共和国'],
  ['加纳', 'GH', 'Ghana', '迦納'],
  ['多哥', 'TG', 'Togo'],
  ['贝宁', 'BJ', 'Benin', '貝南'],
  ['尼日利亚', 'NG', 'Nigeria', '奈及利亞'],
  ['尼日尔', 'NE', 'Niger', '尼日'],
  ['布基纳法索', 'BF', 'Burkina Faso'],
  ['马里', 'ML', 'Mali', '馬利'],
  ['乍得', 'TD', 'Chad', '查德'],
  ['苏丹', 'SD', 'Sudan'],
  ['南苏丹', 'SS', 'South Sudan', '南蘇丹'],
  ['埃塞俄比亚', 'ET', 'Ethiopia', '衣索比亞'],
  ['厄立特里亚', 'ER', 'Eritrea'],
  ['吉布提', 'DJ', 'Djibouti', '吉布地'],
  ['索马里', 'SO', 'Somalia', '索馬利亞'],
  ['肯尼亚', 'KE', 'Kenya', '肯亞'],
  ['乌干达', 'UG', 'Uganda', '烏干達'],
  ['坦桑尼亚', 'TZ', 'Tanzania', '坦尚尼亞'],
  ['卢旺达', 'RW', 'Rwanda', '盧安達'],
  ['布隆迪', 'BI', 'Burundi', '蒲隆地'],
  ['刚果（金）', 'CD', 'DR Congo', 'Democratic Republic of the Congo', 'Congo-Kinshasa',
    '刚果民主共和国', '剛果民主共和國'],
  ['刚果（布）', 'CG', 'Republic of the Congo', 'Congo', 'Congo-Brazzaville', '刚果共和国'],
  ['加蓬', 'GA', 'Gabon', '加彭'],
  ['喀麦隆', 'CM', 'Cameroon', '喀麥隆'],
  ['中非', 'CF', 'Central African Republic', 'CAR', '中非共和国'],
  ['赤道几内亚', 'GQ', 'Equatorial Guinea', '赤道幾內亞'],
  ['圣多美和普林西比', 'ST', 'Sao Tome and Principe', 'São Tomé and Príncipe'],
  ['安哥拉', 'AO', 'Angola'],
  ['赞比亚', 'ZM', 'Zambia', '尚比亞'],
  ['马拉维', 'MW', 'Malawi', '馬拉威'],
  ['莫桑比克', 'MZ', 'Mozambique', '莫三比克'],
  ['津巴布韦', 'ZW', 'Zimbabwe', '辛巴威'],
  ['博茨瓦纳', 'BW', 'Botswana', '波札那'],
  ['纳米比亚', 'NA', 'Namibia', '納米比亞'],
  ['南非', 'ZA', 'South Africa', '南非共和国'],
  ['莱索托', 'LS', 'Lesotho', '賴索托'],
  ['埃斯瓦蒂尼', 'SZ', 'Eswatini', 'Swaziland', '斯威士兰', '史瓦帝尼'],
  ['马达加斯加', 'MG', 'Madagascar', '馬達加斯加'],
  ['毛里求斯', 'MU', 'Mauritius', '模里西斯'],
  ['塞舌尔', 'SC', 'Seychelles', '塞席爾'],
  ['佛得角', 'CV', 'Cape Verde', 'Cabo Verde', '維德角'],
  ['科摩罗', 'KM', 'Comoros', '葛摩'],

  // ===================== 美洲 =====================
  ['美国', 'US', 'United States', 'United States of America', 'USA', 'U.S.A.', 'U.S.',
    'America', 'the United States', '美利坚合众国', '美利堅合眾國'],
  ['加拿大', 'CA', 'Canada'],
  ['墨西哥', 'MX', 'Mexico', 'México', '墨西哥合众国'],
  ['危地马拉', 'GT', 'Guatemala', '瓜地馬拉'],
  ['伯利兹', 'BZ', 'Belize', '貝里斯'],
  ['萨尔瓦多', 'SV', 'El Salvador', '薩爾瓦多'],
  ['洪都拉斯', 'HN', 'Honduras', '宏都拉斯'],
  ['尼加拉瓜', 'NI', 'Nicaragua'],
  ['哥斯达黎加', 'CR', 'Costa Rica', '哥斯大黎加'],
  ['巴拿马', 'PA', 'Panama', '巴拿馬'],
  ['古巴', 'CU', 'Cuba'],
  ['牙买加', 'JM', 'Jamaica', '牙買加'],
  ['海地', 'HT', 'Haiti'],
  ['多米尼加', 'DO', 'Dominican Republic', '多明尼加'],
  ['波多黎各', 'PR', 'Puerto Rico'],
  ['巴哈马', 'BS', 'Bahamas', 'the Bahamas', '巴哈馬'],
  ['特立尼达和多巴哥', 'TT', 'Trinidad and Tobago', '千里達'],
  ['巴巴多斯', 'BB', 'Barbados', '巴貝多'],
  ['哥伦比亚', 'CO', 'Colombia', '哥倫比亞'],
  ['委内瑞拉', 'VE', 'Venezuela'],
  ['圭亚那', 'GY', 'Guyana', '蓋亞那'],
  ['苏里南', 'SR', 'Suriname', 'Surinam', '蘇利南'],
  ['厄瓜多尔', 'EC', 'Ecuador', '厄瓜多'],
  ['秘鲁', 'PE', 'Peru', 'Perú', '秘魯'],
  ['巴西', 'BR', 'Brazil', 'Brasil'],
  ['玻利维亚', 'BO', 'Bolivia', '玻利維亞'],
  ['巴拉圭', 'PY', 'Paraguay'],
  ['乌拉圭', 'UY', 'Uruguay', '烏拉圭'],
  ['阿根廷', 'AR', 'Argentina'],
  ['智利', 'CL', 'Chile'],

  // ===================== 大洋洲 =====================
  ['澳大利亚', 'AU', 'Australia', '澳洲', '澳大利亞'],
  ['新西兰', 'NZ', 'New Zealand', '紐西蘭', '新西蘭'],
  ['斐济', 'FJ', 'Fiji', '斐濟'],
  ['巴布亚新几内亚', 'PG', 'Papua New Guinea', 'PNG', '巴布亞紐幾內亞'],
  ['萨摩亚', 'WS', 'Samoa', '薩摩亞'],
  ['汤加', 'TO', 'Tonga', '東加'],
  ['瓦努阿图', 'VU', 'Vanuatu', '萬那杜'],
  ['所罗门群岛', 'SB', 'Solomon Islands', '索羅門群島'],
  ['新喀里多尼亚', 'NC', 'New Caledonia', '新喀里多尼亞'],
  ['法属波利尼西亚', 'PF', 'French Polynesia', '大溪地', '法屬玻里尼西亞'],
  ['关岛', 'GU', 'Guam', '關島'],

  // ===================== 历史国家 / 特殊政区（**不并入现代国家**） =====================
  ['苏联', 'SU', 'Soviet Union', 'USSR', 'Union of Soviet Socialist Republics', '蘇聯', '苏俄'],
  ['南斯拉夫', 'YU', 'Yugoslavia', '南斯拉夫联盟'],
  ['捷克斯洛伐克', 'CS', 'Czechoslovakia', '捷克斯洛伐克共和国'],
  ['西德', 'XWG', 'West Germany', 'Federal Republic of Germany', '联邦德国', '聯邦德國'],
  ['东德', 'GDR', 'East Germany', 'German Democratic Republic', 'DD', '民主德国', '民主德國'],
  ['塞尔维亚和黑山', 'SCG', 'Serbia and Montenegro'],
  ['奥匈帝国', '', 'Austria-Hungary', 'Austro-Hungarian Empire', '奧匈帝國'],
  ['普鲁士', '', 'Prussia', '普魯士']
];

/* ============================================================================
 * 转换器实现
 * ==========================================================================*/

/** 归一化：去首尾空白、合并连续空格、ASCII 转小写、去掉点号与末尾标点 */
function _normCountryKey(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u3000\s]+/g, ' ')
    .trim()
    .replace(/\./g, '')
    .replace(/[，、;；]+$/, '')
    .toLowerCase();
}

/** 构建查找索引：规范名 / 代码 / 英文别名 / 中文变体 → 规范中文 */
const _COUNTRY_LOOKUP = (() => {
  const map = new Map();
  let order = 0;
  const put = (key, zh) => {
    const k = _normCountryKey(key);
    if (!k) return;
    // 先写入者优先（表顺序即优先级），避免后写的别名覆盖规范值
    if (!map.has(k)) map.set(k, { zh, order: order++ });
  };
  for (const row of COUNTRY_TABLE) {
    const canonical = row[0];
    put(canonical, canonical); // 规范名本身必须可被识别（否则「中国大陆」「韩国」这类会查不到）
    for (let i = 1; i < row.length; i++) put(row[i], canonical);
  }
  return map;
})();

/**
 * 单值转换
 * @param {string} value
 * @param {{keepUnknown?: boolean}} [opts] keepUnknown=true 时查不到返回原文（IMDb 别名需要）
 */
function countryDisplayName(value, opts) {
  const keepUnknown = !!(opts && opts.keepUnknown);
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const hit = _COUNTRY_LOOKUP.get(_normCountryKey(raw));
  if (hit) return hit.zh;
  return keepUnknown ? raw : '';
}

/**
 * 多值转换（主入口，签名与现有 standardizeRegionNames 兼容）
 * 输入：'美国 / 英国' | '美国,英国' | ['US', 'GB']
 * 输出：'美国, 英国'（去重，保持首次出现顺序）
 */
function standardizeRegionNames(value) {
  try {
    let list;
    if (Array.isArray(value)) {
      list = value;
    } else if (typeof value === 'string') {
      // 纯中文（不含拉丁字母）时，「豆瓣选电影」式的空格分隔也算多值：
      // "美国 英国 加拿大" → 三个值；含英文字母时不按空格切，否则
      // "United States of America" / "South Korea" 会被切碎。
      if (/[\u4e00-\u9fa5]/.test(value) && !/[A-Za-z]/.test(value)) {
        list = value.split(/[\s,，、/;；|]+/);
      } else {
        list = value.split(/[,，、/;；|]/);
      }
    } else {
      return '';
    }

    const out = [];
    for (const item of list) {
      const zh = countryDisplayName(item, { keepUnknown: true });
      if (zh && out.indexOf(zh) === -1) out.push(zh);
    }
    return out.join(', ');
  } catch (e) {
    return typeof value === 'string' ? value : '';
  }
}

/** 代码专用入口（IMDb 内嵌数据只给 US/GB/CN 这种两字母码） */
function standardizeCountryCode(code) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return '';
  const hit = _COUNTRY_LOOKUP.get(_normCountryKey(raw));
  // 代码查不到时**返回空**，不把 "AZ" 这种原始码丢给用户
  return hit ? hit.zh : '';
}

/* 挂到 window 上，供 base-extractor / imdb / douban-book 等在同一隔离环境里调用
 * （与 platform-utils.js 的做法一致：浏览器扩展里不用 export 语法）
 * `typeof window` 判断是为了让离线单测能在纯 Node 下 require 本文件 */
if (typeof window !== 'undefined') {
  window.CountryNames = {
    COUNTRY_TABLE,
    countryDisplayName,
    standardizeRegionNames,
    standardizeCountryCode
  };
}

/* 离线单测用（Node 环境才有 module，浏览器里这段不执行） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COUNTRY_TABLE, countryDisplayName, standardizeRegionNames, standardizeCountryCode };
}
