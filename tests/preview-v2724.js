'use strict';
/**
 * v2.7.24 真机文本预演（离线，不联网）
 *
 * 把 2026-10-31 真机抓到的原样数据喂给提取器，检查 6 列输出与简介排版。
 * 数据来源：BrowserSkill 接管用户已登录 Edge 实测
 *   · @taishengding  无外链、简介 7 字、国家「日本」
 *   · @mediastorm    5 条外链、简介 560 字、国家「美国」
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', 'ClipMate_chrome');
const P = (p) => path.join(ROOT, p);

/** @taishengding 真机原样 */
const TAISHENG = {
  url: 'https://www.youtube.com/@taishengding',
  uc: 'UCjpjFop02meNbAgzlOZ1atA',
  handle: 'taishengding',
  name: '丁太升',
  desc: '大刀阔斧说音乐',
  sameAs: null,
  domSubs: '4.76万位订阅者',
  domVids: '229 个视频',
  about: {
    description: '大刀阔斧说音乐',
    descriptionLabel: { content: '说明' },
    country: '日本',
    subscriberCountText: '4.76万位订阅者',
    viewCountText: '5,398,090次观看',
    joinedDateText: { content: '2022年5月21日注册' },
    canonicalChannelUrl: 'http://www.youtube.com/@taishengding',
    channelId: 'UCjpjFop02meNbAgzlOZ1atA',
    additionalInfoLabel: { content: '更多信息' },
    videoCountText: '229 个视频'
  }
};

/** @mediastorm 真机原样（长简介 + 5 条外链） */
const MEDIASTORM = {
  url: 'https://www.youtube.com/@MediaStorm',
  uc: 'UCa91Shr2Old7rhvdBSPnVBw',
  handle: 'mediastorm',
  name: 'MediaStorm',
  desc: 'MediaStorm is committed to the power of storytelling. We have collaborated with numerous clients to tell stories from around the globe and have created a toolset for branding, packaging and distributing visually-sophisticated experiences to empower other storytellers. Our innovative workshops provide hands-on storytelling training and our online training is a step-by-step guide to elevating the craft. Our award-winning channel showcases some of our best work, and we have had the honor of collaborating with some of the greatest storytellers in the world. ',
  sameAs: [
    'http://mediastorm.com',
    'https://www.facebook.com/mediastorm.org',
    'https://twitter.com/mediastorm',
    'http://linkedin.com/company/mediastorm/',
    'http://mediastorm.com/blog'
  ],
  links: [
    { channelExternalLinkViewModel: { title: { content: 'MediaStorm.com' },
      link: { content: 'mediastorm.com', commandRuns: [{ onTap: { innertubeCommand: {
        urlEndpoint: { url: 'https://www.youtube.com/redirect?event=channel_description&q=http%3A%2F%2Fmediastorm.com' } } } }] } } },
    { channelExternalLinkViewModel: { title: { content: 'Facebook' },
      link: { content: 'facebook.com/mediastorm.org', commandRuns: [{ onTap: { innertubeCommand: {
        urlEndpoint: { url: 'https://www.youtube.com/redirect?event=channel_description&q=https%3A%2F%2Fwww.facebook.com%2Fmediastorm.org' } } } }] } } }
  ],
  domSubs: '2410位订阅者',
  domVids: '235 个视频',
  about: {
    description: 'MediaStorm is committed to the power of storytelling. We have collaborated with numerous clients to tell stories from around the globe and have created a toolset for branding, packaging and distributing visually-sophisticated experiences to empower other storytellers. Our innovative workshops provide hands-on storytelling training and our online training is a step-by-step guide to elevating the craft. Our award-winning channel showcases some of our best work, and we have had the honor of collaborating with some of the greatest storytellers in the world. ',
    country: '美国',
    subscriberCountText: '2410位订阅者',
    viewCountText: '260,221次观看',
    joinedDateText: { content: '2006年8月29日注册' },
    canonicalChannelUrl: 'http://www.youtube.com/@mediastorm',
    channelId: 'UCa91Shr2Old7rhvdBSPnVBw',
    videoCountText: '235 个视频',
    links: [
      { channelExternalLinkViewModel: { title: { content: 'MediaStorm.com' },
        link: { content: 'mediastorm.com', commandRuns: [{ onTap: { innertubeCommand: {
          urlEndpoint: { url: 'https://www.youtube.com/redirect?event=channel_description&q=http%3A%2F%2Fmediastorm.com' } } } }] } } },
      { channelExternalLinkViewModel: { title: { content: 'Facebook' },
        link: { content: 'facebook.com/mediastorm.org', commandRuns: [{ onTap: { innertubeCommand: {
          urlEndpoint: { url: 'https://www.youtube.com/redirect?event=channel_description&q=https%3A%2F%2Fwww.facebook.com%2Fmediastorm.org' } } } }] } } }
    ]
  }
};

function buildHtml(s) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: 'https://www.youtube.com/channel/' + s.uc,
    name: s.name + ' - YouTube',
    mainEntity: {
      '@type': 'Person',
      name: s.name,
      url: 'https://www.youtube.com/channel/' + s.uc,
      alternateName: '@' + s.handle,
      description: s.desc,
      sameAs: s.sameAs,
      interactionStatistic: [{
        '@type': 'InteractionCounter',
        interactionType: { '@type': 'FollowAction' },
        userInteractionCount: '1'
      }]
    }
  };

  // 主页数据块：只有统计，没有 about（真机就是这样）
  const ytData = {
    header: {
      pageHeaderRenderer: {
        content: {
          pageHeaderViewModel: {
            metadata: {
              contentMetadataViewModel: {
                metadataRows: [{ metadataParts: [
                  { text: { content: '@' + s.handle } },
                  { text: { content: s.domSubs } },
                  { text: { content: s.domVids } }
                ] }]
              }
            }
          }
        }
      }
    }
  };

  return `<!doctype html><html><head><title>${s.name} - YouTube</title></head><body>
    <yt-page-header-view-model>
      <h1>${s.name}</h1>
      <div><span>@${s.handle}</span><span>${s.domSubs}</span><span>${s.domVids}</span></div>
      <div class="ytPageHeaderViewModelDescr">${s.desc} …更多</div>
    </yt-page-header-view-model>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>
    <script>var ytInitialData = ${JSON.stringify(ytData)};</script>
  </body></html>`;
}

async function run(s, label) {
  const dom = new JSDOM(buildHtml(s), { url: s.url, runScripts: 'outside-only' });
  const w = dom.window;
  for (const rel of [
    'src/content/shared/url-normalizer.js',
    'src/content/shared/person-fields-builder.js',
    'src/content/extractors/base-extractor.js',
    'src/content/extractors/youtube-profile.js'
  ]) w.eval(fs.readFileSync(P(rel), 'utf8'));

  // 模拟「主页 fetch 一次 about 页」拿到的 HTML
  w.fetch = (u) => {
    if (u.indexOf('/about') === -1) return Promise.reject(new Error('bad url ' + u));
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(
        '<script>var ytInitialData = ' + JSON.stringify({ aboutChannelViewModel: s.about }) + ';</script>'
      )
    });
  };

  const ex = new w.YoutubeProfileExtractor();
  const rec = await ex.extractAllFields();

  console.log('\n========== ' + label + ' ==========');
  console.log('【fetch】' + (w.__calls || '/' + s.handle + '/about（预期）'));
  Object.keys(rec).forEach((k) => {
    if (k === '简介') return;
    console.log('  ' + k + '  →  ' + rec[k]);
  });
  const bio = String(rec['简介'] || '');
  const lines = bio.split('\n');
  console.log('  简介  →  ' + lines.length + ' 行');
  lines.forEach((l, i) => {
    const shown = l.length > 70 ? l.slice(0, 70) + '…（共' + l.length + ' 字）' : l;
    console.log('     [' + (i + 1) + '] ' + shown);
  });
  return rec;
}

(async () => {
  await run(TAISHENG, '@taishengding（无外链，简介 7 字）');
  await run(MEDIASTORM, '@MediaStorm（780 字长简介 + 外链）');
})().catch((e) => { console.error('ERR', e); process.exit(1); });
