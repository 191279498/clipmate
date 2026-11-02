/**
 * 豆瓣影人提取器（v2.7.13）
 *
 * 归属：人物档案大类 → 影人形态（personKind = 'celebrity'），12 列：
 *   姓名、别名、性别、出生日期、逝世日期、国家、简介、豆瓣、IMDb、TMDB、Bangumi、网址
 *
 * ⚠️ 地址换了（2026-10-30 真机实测，方案文档里写的 `movie.douban.com/celebrity/<id>/` 已作废）
 * ----------------------------------------------------------------------------------
 *   旧：https://movie.douban.com/celebrity/1048026/   → **301 跳转**到
 *   新：https://www.douban.com/personage/27253787/
 * 旧地址现在只是个别名，浏览器会先跳到新地址，所以注入与识别一律只认 `/personage/`。
 *
 * 真机勘察（2026-10-30，接管用户已登录 Edge，样本 周星驰 27253787 / 吴孟达 27222494）
 * ------------------------------------------------------------------------------
 *   <h1 class="subject-name">周星驰 Stephen Chow</h1>          ← 中文名 + 外文名，空格分隔
 *   <ul class="subject-property">
 *     <li><span class="label">性别: </span><span class="value">男</span></li>
 *     <li><span class="label">出生日期: </span><span class="value">1962年6月22日</span></li>
 *     <li><span class="label">去世日期: </span><span class="value">2021年2月27日</span></li>
 *     <li><span class="label">出生地: </span><span class="value">中国,香港</span></li>
 *     <li><span class="label">更多中文名: </span><span class="value">星爷(昵称) / 周星星(昵称)</span></li>
 *     <li><span class="label">更多外文名: </span><span class="value">Sing-Chi Chow (本名) / Sing Jai (昵称)</span></li>
 *     <li><span class="label">IMDb编号: </span><span class="value">nm0159507</span></li>
 *     <li><span class="label">职业: </span><span class="value">演员 / 制片人 / 导演 / 作者</span></li>
 *   </ul>
 *   <section class="subject-mod subject-intro">
 *     <div class="desc"><div class="content"><p>…</p><p>…</p></div></div>
 *     <div class="fold-switch-block"><a class="fold-switch">(展开)</a></div>
 *   </section>
 *
 * 这些类名（`subject-name` / `subject-property` / `subject-intro` / `label` / `value`）都是
 * **语义化写法**，不像抖音主页那种构建哈希，可以放心当锚点。但仍然：
 *   · 属性行一律按「标签文本 → 值」读，**不按行号、不按位置**（豆瓣会增删行）；
 *   · 认不出的标签不丢，归进「简介」的「补充：」段（用户定的"其他信息兜底"）。
 *
 * 四条取值口径（这几条是 2026-10-30 定下的，改之前先想清楚）
 * ----------------------------------------------------------
 * ① 「姓名」= h1 **整串**：`吴孟达 Man Tat Ng` 整行进姓名（用户看截图后拍板）。
 *    中文名与外文名是同一个人的两种写法，不是别名，别拆。
 * ② 「别名」只收页面上「更多中文名 / 更多外文名」列出的名字，
 *    并且去掉 `(昵称)` `(本名)` 这类标注 —— 那是豆瓣对名字的分类说明，不是名字本身。
 *    保留会让别名列变成 `Sing Jai (昵称), 星仔 (昵称)…`，与豆瓣影视「别名」的干净写法不一致。
 * ③ 「简介」正文优先取 `og:description`：豆瓣把页面上可见的简介**服务端截断**在 250 字左右
 *    （吴孟达那条只到「直至1979年凭着演」就断了），而 og:description 有 1000 字左右的连续版本。
 *    只有当 og 版本确实更长、且开头与可见文本一致时才替换 —— 否则宁可用可见文本（它保段落）。
 * ④ 「网址」**留空**：本页链接已经在「豆瓣」列里，不再重复存一遍（用户 2026-10-30 定）。
 *    同一条规则适用于 IMDb / TMDB / Bangumi 影人页，写在 person-fields-builder 里。
 *
 * 纪律：只读 DOM，不点「(展开)」（点了会打豆瓣接口），遇到验证码 / 滑块由外层守卫负责停手。
 */

class DoubanCelebrityExtractor extends BaseExtractor {
  constructor() {
    super();
    this.siteName = 'douban_celebrity';
  }

  /* ======================= 基础工具 ======================= */

  /** 压空格、去首尾空白 */
  _clean(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/\u00a0/g, ' ')
      .replace(/[\u3000\s]+/g, ' ')
      .trim();
  }

  /**
   * 块级感知取文本（保留 `<p>` / `<div>` 之间的换行）
   *
   * 不用 `el.innerText`：jsdom 不实现，离线单测会拿到 undefined。
   * 统一走 DOM 遍历，测试与真机走同一条代码路径。
   *
   * @param {Element} el
   * @param {string} [sep] - 块之间插入的分隔符，默认单换行
   */
  _blockText(el, sep) {
    if (!el) return '';
    const joiner = sep === undefined ? '\n' : sep;
    try {
      const BLOCK = /^(DIV|P|LI|UL|OL|H1|H2|H3|H4|H5|H6|SECTION|ARTICLE|HEADER|FOOTER|TR|TBODY|TABLE|BR|BLOCKQUOTE)$/;
      const out = [];
      const walk = (node) => {
        if (!node) return;
        if (node.nodeType === 3) {
          out.push(node.nodeValue || '');
          return;
        }
        if (node.nodeType !== 1) return;
        const isBlock = BLOCK.test(node.tagName || '');
        if (isBlock) out.push(joiner);
        const kids = node.childNodes || [];
        for (let i = 0; i < kids.length; i++) walk(kids[i]);
        if (isBlock) out.push(joiner);
      };
      walk(el);
      return out.join('')
        .replace(/\u00a0/g, ' ')
        .split('\n')
        .map((s) => s.replace(/[ \t\u3000]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
    } catch (e) {
      return '';
    }
  }

  /**
   * 资料区「标签 → 值」映射
   *
   * 只认 `ul.subject-property > li` 里的 `.label` / `.value`；
   * 拿不到列表就退到 `section.subject-target li`（豆瓣偶尔会把 ul 换掉）。
   *
   * 返回**数组**而不是对象：保留原始顺序，「补充：」段要按页面顺序拼。
   * @returns {Array<{label: string, value: string}>}
   */
  _propertyRows() {
    try {
      let lis = Array.from(document.querySelectorAll('ul.subject-property > li'));
      if (!lis.length) {
        lis = Array.from(document.querySelectorAll('section.subject-target li'));
      }
      const rows = [];
      for (const li of lis) {
        const labelEl = li.querySelector('.label');
        const valueEl = li.querySelector('.value');
        // 没有 .label/.value 结构的行整行跳过（可能是编辑入口之类的非资料行）
        if (!labelEl || !valueEl) continue;
        const label = this._clean(labelEl.textContent).replace(/[:：]\s*$/, '').trim();
        const value = this._clean(valueEl.textContent);
        if (!label) continue;
        rows.push({ label: label, value: value });
      }
      return rows;
    } catch (e) {
      console.error('[DoubanCelebrityExtractor] 读取资料区失败:', e);
      return [];
    }
  }

  /** 按标签取值（同标签出现多次只取第一条） */
  _valueOf(rows, labels) {
    const wanted = Array.isArray(labels) ? labels : [labels];
    for (const row of rows) {
      if (wanted.indexOf(row.label) > -1) return row.value;
    }
    return '';
  }

  /* ======================= 姓名 / 别名 ======================= */

  /**
   * 姓名 = h1 全串，不拆
   *
   * 2026-10-30 用户拍板改口径：截图里 h1「吴孟达 Man Tat Ng」整行都该进「姓名」，
   * 之前只留中文名、把外文名塞进「别名」是错的 —— 影人的中文名与外文名是同一个名字的
   * 两种写法，不是别名。别名只收页面上「更多中文名 / 更多外文名」列出的那些。
   *
   * 外文在前（`Stephen Chow 周星驰`）也照原样，不重排 —— 页面上怎么写就怎么存。
   */
  async extractName() {
    return this._headingText();
  }

  /** h1 原文（姓名的唯一来源） */
  _headingText() {
    try {
      const h1 = document.querySelector('h1.subject-name') || document.querySelector('h1');
      return this._clean(h1 ? h1.textContent : '');
    } catch (e) {
      return '';
    }
  }

  /**
   * 别名清洗：去掉豆瓣的名字分类标注，按 `/` 切分
   *
   * 只去掉这几类明确的标注 —— 不粗暴删所有括号内容，
   * 万一有名字本身带括号（`李小龙(Bruce Lee)` 这种）要能留住。
   */
  _splitAliasValue(value) {
    const MARK = /\s*[（(]\s*(本名|昵称|别名|曾用名|艺名|简称|全名|英文名|中文名)\s*[）)]\s*/g;
    return String(value || '')
      .split('/')
      .map((s) => this._clean(s.replace(MARK, ' ')))
      .filter(Boolean);
  }

  /* ======================= 12 列取值 ======================= */

  /**
   * 2. 别名：更多中文名 → 更多外文名（页面上列出的才算）
   *
   * 2026-10-30 起**不再**把 h1 里的外文名放进别名 —— 它已经进「姓名」了，
   * 再放一次就是同一个人两个名字各存两遍。
   * 去重与 `, ` 连接由 PersonFieldsBuilder 统一做，这里只负责按顺序给全。
   */
  async extractAliases() {
    try {
      const rows = this._propertyRows();
      const list = [];

      list.push(...this._splitAliasValue(this._valueOf(rows, ['更多中文名', '别名'])));
      list.push(...this._splitAliasValue(this._valueOf(rows, ['更多外文名', '外文名'])));

      return list;
    } catch (e) {
      console.error('[DoubanCelebrityExtractor] 提取别名失败:', e);
      return [];
    }
  }

  /** 3. 性别：男 / 女（中文化由装配器统一做） */
  async extractGender() {
    return this._valueOf(this._propertyRows(), ['性别']);
  }

  /** 4. 出生日期：`1962年6月22日`，补齐交给 person-date.js */
  async extractBirthDate() {
    return this._valueOf(this._propertyRows(), ['出生日期', '生日']);
  }

  /**
   * 5. 逝世日期
   *
   * 豆瓣的标签是 **`去世日期`**（真机取样确认），不是「逝世日期」。
   * 两个都认，防止豆瓣哪天改回来。
   */
  async extractDeathDate() {
    return this._valueOf(this._propertyRows(), ['去世日期', '逝世日期', '去世', '逝世']);
  }

  /** 6. 国家：这一列先返回**出生地原文**，国家由 country-extract.js 抽（抽不出留空） */
  async extractBirthPlace() {
    return this._valueOf(this._propertyRows(), ['出生地', '出生地点']);
  }

  /** 7-① 简介的「职业：」段 */
  async extractProfession() {
    return this._splitAliasValue(this._valueOf(this._propertyRows(), ['职业']));
  }

  /**
   * 7-② 简介的「补充：」段
   *
   * 页面资料区里**任何没被上面用掉的标签**都归到这里（用户定的"其他信息兜底"）。
   * 目前实测会出现的有：家庭成员 / 星座 / 身高 / 国籍 / 民族 …
   * 顺序按页面顺序，装配器负责拼成 `补充：家庭成员 xxx；星座 xxx`。
   *
   * @returns {Object} { 标签: 值 }
   */
  async extractExtras() {
    try {
      const USED = ['性别', '出生日期', '生日', '出生地', '出生地点',
        '去世日期', '逝世日期', '去世', '逝世',
        '更多中文名', '更多外文名', '别名', '外文名', '职业',
        'IMDb编号', 'IMDb', 'IMDb ID'];
      const extras = {};
      for (const row of this._propertyRows()) {
        if (USED.indexOf(row.label) > -1) continue;
        if (!row.value) continue;
        if (Object.prototype.hasOwnProperty.call(extras, row.label)) continue;
        extras[row.label] = row.value;
      }
      return extras;
    } catch (e) {
      console.error('[DoubanCelebrityExtractor] 提取补充信息失败:', e);
      return {};
    }
  }

  /**
   * 7-③ 简介正文
   *
   * 优先 `og:description`（1000 字左右、连续、不分段），
   * 只有当它确实比可见文本长、且开头与可见文本一致（= 同一段的更长版本）时才用。
   * 否则用页面上可见的 `.subject-intro .desc` 文本（短，但保留段落）。
   *
   * 都不存在 → 空串（没有简介的人不写占位词）。
   */
  async extractBio() {
    try {
      const visible = this._blockText(
        document.querySelector('section.subject-intro .desc .content')
        || document.querySelector('section.subject-intro .desc')
        || document.querySelector('.subject-intro .desc')
      );

      let og = '';
      try {
        const m = document.querySelector('meta[property="og:description"]');
        og = this._clean(m ? m.getAttribute('content') : '');
      } catch (e) { /* 没有 og 就走可见文本 */ }

      if (og && og.length > visible.length) {
        const head = (s) => String(s).replace(/\s+/g, '').slice(0, 40);
        if (!visible || head(og) === head(visible)) {
          return og.slice(0, 3000);
        }
      }

      return visible.slice(0, 3000);
    } catch (e) {
      console.error('[DoubanCelebrityExtractor] 提取简介失败:', e);
      return '';
    }
  }

  /** 8. 豆瓣：本页的规范地址 `https://www.douban.com/personage/<id>/` */
  async extractDoubanUrl() {
    try {
      const m = String(location.pathname || '').match(/^\/personage\/(\d+)\/?/);
      if (!m) return '';
      return 'https://www.douban.com/personage/' + m[1] + '/';
    } catch (e) {
      return '';
    }
  }

  /**
   * 9. IMDb：用 `IMDb编号` 拼全地址（方案 2 节明确「nm 编号拼全 URL」）
   *
   * 只认 `nm数字` 形态，别的形态一律留空 —— 宁可空，不要拼出一个 404 地址。
   */
  async extractImdbUrl() {
    try {
      const rows = this._propertyRows();
      const raw = this._clean(this._valueOf(rows, ['IMDb编号', 'IMDb', 'IMDb ID']));
      const m = /(nm\d{5,12})/i.exec(raw);
      if (!m) return '';
      return 'https://www.imdb.com/name/' + m[1].toLowerCase() + '/';
    } catch (e) {
      return '';
    }
  }

  /**
   * 10 / 11. TMDB、Bangumi：豆瓣影人页上没有这两个站的外链
   *
   * 不实现方法 = 装配器取不到 → 留空。刻意**不**去猜、不去反查
   * （反查要打第三方接口，违反"只读本页"的纪律）。
   */

  /**
   * 12. 网址：**留空**
   *
   * 用户 2026-10-30 定：豆瓣 / IMDb / TMDB / Bangumi 这四家各有专属列，
   * 本页链接已经在「豆瓣」列里了，再往「网址」存一遍就是同一条数据两列重复。
   * 想拿本页地址看「豆瓣」列即可。
   *
   * 装配器里另有一条总规则（四列任一有值 → 网址不兜底），两条互为保险。
   */
  async extractUrl() {
    return '';
  }

  /* ======================= 入口 ======================= */

  /**
   * 字段外壳（列名 / 列数 / 列序）统一由 PersonFieldsBuilder 按 12 列模板套用，
   * 取值仍走本类自己的方法。
   */
  async extractAllFields() {
    if (typeof PersonFieldsBuilder === 'undefined') {
      console.error('[DoubanCelebrityExtractor] PersonFieldsBuilder 未加载，无法装配字段');
      return {};
    }
    return await PersonFieldsBuilder.build(this, { kind: 'celebrity' });
  }

  async extractSpecificFields() {
    return {};
  }
}

// 注册到全局作用域，供提取器工厂按类名获取（window[className]）
window.DoubanCelebrityExtractor = DoubanCelebrityExtractor;
