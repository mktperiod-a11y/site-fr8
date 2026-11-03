// Builds the static site into _site/ (or OUT_DIR) from data/ (or DATA_DIR).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './lib/util.mjs';
import { h, raw, documentHTML } from './lib/html.mjs';
import { CRITERIA, CADENCE, EMPTY } from './lib/site.mjs';
import { PERK_GROUPS, perkFigures } from './lib/perks.mjs';
import { PUBLIC_COUNT } from './lib/score.mjs';

const PLACEHOLDER = 'https://bfzgkull.invalid';
const DATA = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const OUT = path.resolve(ROOT, process.env.OUT_DIR || '_site');
const SITE_URL = (process.env.SITE_URL || PLACEHOLDER).replace(/\/+$/, '');
const BASE_PATH = ('/' + (process.env.BASE_PATH || '/').replace(/^\/+|\/+$/g, '') + '/').replace('//', '/');
const host = new URL(SITE_URL).hostname;
const ABSOLUTE = SITE_URL !== PLACEHOLDER && !/\.github\.io$/i.test(host);

const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const site = read('site.json');
const { vendors } = read('vendors.json');
const metrics = read('metrics.json');
const rankingFile = process.env.RANKING_FILE ? path.resolve(ROOT, process.env.RANKING_FILE) : path.join(DATA, 'ranking.json');
if (!fs.existsSync(rankingFile)) {
  console.error('ranking result not found; run the scoring step first');
  process.exit(1);
}
const ranking = JSON.parse(fs.readFileSync(rankingFile, 'utf8'));

const cadence = CADENCE[site.cadence] || CADENCE.daily;
const byId = new Map(vendors.map((v) => [v.id, v]));
const shown = ranking.list.filter((e) => byId.get(e.id)?.status === 'active');
const top = shown.slice(0, PUBLIC_COUNT);
const rest = shown.slice(PUBLIC_COUNT);
const rankOf = new Map(top.map((e) => [e.id, e]));
const entryOf = new Map(shown.map((e) => [e.id, e]));
const criteria = ranking.criteria.filter((k) => CRITERIA[k]);
const webCriteria = criteria.filter((k) => k === 'web_rank' || k === 'web_trend');
const snap = metrics.snapshots.at(-1) || { web: {}, app: {}, perks: {} };

const [Y, M, D] = ranking.date.split('-').map(Number);
const ym = `${Y}년 ${M}월`;
const ymDot = `${Y}.${String(M).padStart(2, '0')}`;
const dateKo = `${M}월 ${D}일`;
const scaleMax = ranking.scale;
const fmtScore = (n) => (scaleMax === 10 ? n.toFixed(2) : scaleMax === 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(1));

// ---------- assets ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const A = path.join(OUT, 'a');
fs.cpSync(path.join(ROOT, 'static'), A, { recursive: true });
// strip comments from shipped css/js
const cssPath = path.join(A, 'site.css');
fs.writeFileSync(cssPath, fs.readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\/\n?/g, '').replace(/\n{3,}/g, '\n\n'));
const jsPath = path.join(A, 'site.js');
fs.writeFileSync(jsPath, fs.readFileSync(jsPath, 'utf8').replace(/^\s*\/\/.*\n/gm, ''));
const ver = (rel) => createHash('sha256').update(fs.readFileSync(path.join(A, rel))).digest('hex').slice(0, 10);
const V = { css: ver('site.css'), js: ver('site.js'), mark: ver('brand/mark.svg') };
const hasWide = (id) => fs.existsSync(path.join(A, 'v', `${id}-wide.webp`));
function webpSize(file) {
  const b = fs.readFileSync(file);
  const kind = b.toString('ascii', 12, 16);
  if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}
const initialClass = (id) => `va-ini va-ini--${vendors.findIndex((v) => v.id === id) % 8}`;

// ---------- url helpers ----------
const rel = (depth) => (depth ? '../'.repeat(depth) : './');
const canonical = (p) => (ABSOLUTE ? `${SITE_URL}/${p}` : null);
const pageUrl = (p, depth) => canonical(p) || (rel(depth) + p || './');
const sha = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

function csp(inlineScripts = [], inlineStyles = []) {
  return [
    "default-src 'none'",
    `script-src 'self'${inlineScripts.map((s) => ' ' + sha(s)).join('')}`,
    `style-src 'self'${inlineStyles.map((s) => ' ' + sha(s)).join('')}`,
    "img-src 'self'",
    "font-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
}

// ---------- shared parts ----------
function head({ title, desc, path: p, depth, robots = 'index,follow', ld = null, scripts = [], styles = [] }) {
  const r = rel(depth);
  const can = canonical(p) || (p ? r + p : r);
  const og = ABSOLUTE ? `${SITE_URL}/a/brand/${site.shareImage.file}` : `${r}a/brand/${site.shareImage.file}`;
  return h(
    'head',
    h('meta', { charset: 'utf-8' }),
    h('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }),
    h('meta', { 'http-equiv': 'Content-Security-Policy', content: csp(scripts, styles) }),
    h('meta', { name: 'referrer', content: 'strict-origin-when-cross-origin' }),
    h('title', title),
    h('meta', { name: 'description', content: desc }),
    h('meta', { name: 'robots', content: robots }),
    h('link', { rel: 'canonical', href: can }),
    h('meta', { name: 'theme-color', content: '#ffffff' }),
    h('meta', { property: 'og:type', content: 'website' }),
    h('meta', { property: 'og:site_name', content: site.brand }),
    h('meta', { property: 'og:title', content: title }),
    h('meta', { property: 'og:description', content: desc }),
    h('meta', { property: 'og:url', content: can }),
    h('meta', { property: 'og:image', content: og }),
    h('meta', { property: 'og:image:width', content: '1200' }),
    h('meta', { property: 'og:image:height', content: '630' }),
    h('meta', { property: 'og:locale', content: 'ko_KR' }),
    h('meta', { name: 'twitter:card', content: 'summary_large_image' }),
    h('link', { rel: 'icon', href: `${r}a/brand/mark.svg?v=${V.mark}`, type: 'image/svg+xml' }),
    h('link', { rel: 'icon', href: `${r}a/brand/icon-32.png`, sizes: '32x32', type: 'image/png' }),
    h('link', { rel: 'apple-touch-icon', href: `${r}a/brand/icon-180.png` }),
    h('link', { rel: 'preload', href: `${r}a/fonts/pd-400.woff2`, as: 'font', type: 'font/woff2', crossorigin: true }),
    h('link', { rel: 'stylesheet', href: `${r}a/site.css?v=${V.css}` }),
    ld ? h('script', { type: 'application/ld+json' }, JSON.stringify(ld, null, 2)) : null,
  );
}

function header(depth, current) {
  const r = rel(depth);
  const tab = (key, href, label) => h('a', { class: 'va-tab', href, 'aria-current': current === key ? 'page' : null }, label);
  const plain = site.brand.replace(site.brandAccent, '');
  return h(
    'header',
    { class: 'va-top' },
    h(
      'div',
      { class: 'va-wrap va-top__in' },
      h(
        'a',
        { class: 'va-logo', href: r },
        h('img', { src: `${r}a/brand/mark.svg?v=${V.mark}`, width: 26, height: 26, alt: '' }),
        h('span', plain, h('b', site.brandAccent)),
      ),
      h(
        'nav',
        { class: 'va-tabs', 'aria-label': '주요 메뉴' },
        tab('rank', r, '순위'),
        tab('perks', `${r}benefits/`, '혜택별 추천'),
        tab('guide', `${r}guide/`, '기준 안내'),
      ),
    ),
  );
}

function footer(depth) {
  const r = rel(depth);
  const affiliate = vendors.some((v) => v.status === 'active' && v.affiliate);
  return h(
    'footer',
    { class: 'va-foot' },
    h(
      'div',
      { class: 'va-wrap va-foot__in' },
      h('p', { class: 'va-foot__brand' }, site.brand),
      h(
        'p',
        { class: 'va-foot__links' },
        h('a', { href: r }, '웹하드 순위'),
        ' ',
        h('a', { href: `${r}benefits/` }, '혜택별 추천'),
        ' ',
        h('a', { href: `${r}guide/` }, '기준 안내'),
      ),
      h(
        'nav',
        { class: 'va-foot__vendors', 'aria-label': '웹하드 목록' },
        shown.map((e) => h('a', { href: `${r}webhard/${e.id}/` }, byId.get(e.id).name)),
      ),
      h('p', `순위와 혜택은 참고용이에요. 서비스 이용 조건은 각 공식 사이트 안내를 따라요. ${cadence.word} 갱신해요.`),
      affiliate ? h('p', '일부 바로가기는 제휴 링크예요.') : null,
      h('p', { class: 'va-foot__copy' }, `© ${Y} ${site.brand}`),
    ),
  );
}

function shell({ depth, current, headOpts, body }) {
  const r = rel(depth);
  return documentHTML(
    h(
      'html',
      { lang: 'ko' },
      head({ ...headOpts, depth }),
      h(
        'body',
        h('a', { class: 'va-skip', href: '#main' }, '본문으로 건너뛰기'),
        header(depth, current),
        h('main', { id: 'main', class: 'va-wrap va-main' }, body),
        footer(depth),
        h('button', { class: 'va-totop', type: 'button', hidden: true, 'aria-label': '맨 위로' }, '↑'),
        h('script', { src: `${r}a/site.js?v=${V.js}`, defer: true }),
      ),
    ),
  );
}

function write(rel, html) {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

// ---------- data helpers ----------
const perkText = (v) => (v.perks?.length ? v.perks.map((p) => p.text).join(' · ') : EMPTY);
const goHref = (v, r) => (v.url ? `${r}go/${v.id}/` : null);
const rel_ = (v) => (v.affiliate ? 'sponsored nofollow' : 'nofollow');

// vendor mark: the horizontal web logo; a lettered box when no logo file exists
function icon(v, r) {
  if (hasWide(v.id)) {
    const [w, hgt] = webpSize(path.join(A, 'v', `${v.id}-wide.webp`));
    return h('img', { src: `${r}a/v/${v.id}-wide.webp`, width: w, height: hgt, alt: '', loading: 'lazy' });
  }
  return h('span', { class: initialClass(v.id), 'aria-hidden': 'true' }, [...v.name][0]);
}

function move(e) {
  if (e.isNew) return h('span', { class: 'va-move va-move--new' }, 'NEW');
  if (e.prev && e.prev !== e.rank) {
    const up = e.prev > e.rank;
    return h(
      'span',
      { class: `va-move ${up ? 'va-move--up' : 'va-move--down'}`, 'aria-label': `${Math.abs(e.prev - e.rank)}계단 ${up ? '상승' : '하락'}` },
      `${up ? '▲' : '▼'}${Math.abs(e.prev - e.rank)}`,
    );
  }
  return null;
}

function goButton(v, r, cls = 'va-go') {
  const href = goHref(v, r);
  if (!href) return h('span', { class: `${cls} va-go--off` }, '주소 확인 중');
  return h('a', { class: cls, href, rel: rel_(v), 'aria-label': `${v.name} 사이트 확인` }, '사이트 확인');
}

function rankRow(e, r, alt = null) {
  const v = byId.get(e.id);
  if (alt) e = { ...e, rank: alt.rank, prev: null, isNew: false };
  const topRow = e.rank <= 3;
  return h(
    'li',
    { class: `va-row${topRow ? ' va-row--top' : ''}`, 'data-href': `${r}webhard/${v.id}/` },
    h('span', { class: 'va-rank' }, String(e.rank), h('span', { class: 'va-sr' }, '위')),
    h('span', { class: 'va-ico' }, icon(v, r, topRow ? 48 : 40)),
    h('p', { class: 'va-name' }, h('a', { href: `${r}webhard/${v.id}/` }, v.name), move(e)),
    h('p', { class: 'va-perk' }, perkText(v)),
    alt
      ? h('p', { class: 'va-score' }, h('b', alt.big), alt.small ? h('small', alt.small) : null)
      : h(
          'p',
          { class: 'va-score' },
          h('b', fmtScore(e.total)),
          h('small', '점'),
          h('span', { class: 'va-sr' }, ` (${scaleMax}점 만점)`),
        ),
    goButton(v, r),
  );
}

// ---------- filters: the same ten vendors ordered by one public figure ----------
function filterViews() {
  const app = (id) => snap.app?.[id] || {};
  const joinPts = (id) => perkFigures(byId.get(id).perks || []).join;
  const views = [
    { key: 'all', label: '통합 순위', head: '총점', list: top.map((e) => ({ e, alt: null })) },
    {
      key: 'reviews',
      label: '리뷰 많은 순',
      head: '앱 리뷰',
      val: (id) => app(id).ratings ?? -1,
      show: (id) => (app(id).ratings != null ? [app(id).ratings.toLocaleString('en-US'), '개'] : ['–', '']),
    },
    {
      key: 'rating',
      label: '평점 순',
      head: '앱 평점',
      val: (id) => (app(id).rating != null ? app(id).rating * 1e7 + (app(id).ratings || 0) : -1),
      show: (id) => (app(id).rating != null ? [app(id).rating.toFixed(1), '/5'] : ['–', '']),
    },
    {
      key: 'join',
      label: '가입 혜택 순',
      head: '가입 혜택',
      val: (id) => joinPts(id),
      show: (id) => (joinPts(id) ? [joinPts(id).toLocaleString('en-US'), 'P'] : ['–', '']),
    },
  ];
  for (const vw of views.slice(1)) {
    const sorted = [...top].sort((a, b) => vw.val(b.id) - vw.val(a.id) || a.rank - b.rank);
    vw.list = sorted.map((e, i) => {
      const [big, small] = vw.show(e.id);
      return { e, alt: { rank: i + 1, big, small } };
    });
  }
  return views;
}

function moreList(r, list) {
  if (!list.length) return null;
  return h(
    'details',
    { class: 'va-more', 'data-keep': 'more' },
    h('summary', `다른 웹하드 ${list.length}곳`),
    h(
      'ul',
      { class: 'va-more__list' },
      list.map((e) => {
        const v = byId.get(e.id);
        return h(
          'li',
          { class: 'va-mini' },
          h('span', { class: 'va-ico va-ico--sm' }, icon(v, r, 32)),
          h('div', { class: 'va-body' }, h('p', { class: 'va-name' }, h('span', v.name)), h('p', { class: 'va-perk' }, perkText(v))),
          h(
            'p',
            { class: 'va-mini__acts' },
            h('a', { class: 'va-textbtn', href: `${r}webhard/${v.id}/` }, '상세'),
            v.url ? h('a', { class: 'va-textbtn', href: goHref(v, r), rel: rel_(v) }, '사이트') : null,
          ),
        );
      }),
    ),
  );
}

function pageHead(title, lede, extra) {
  return h('div', { class: 'va-head' }, h('h1', title), lede ? h('p', { class: 'va-lede' }, lede) : null, extra || null);
}

function criteriaCard(r) {
  return h(
    'section',
    { class: 'va-card', 'aria-labelledby': 'how-title' },
    h('h2', { id: 'how-title' }, '순위는 어떻게 정하나요?'),
    h('dl', { class: 'va-crit' }, criteria.map((k) => [h('dt', CRITERIA[k].label), h('dd', CRITERIA[k].desc)])),
    h('p', { class: 'va-card__more' }, h('a', { href: `${r}guide/` }, '기준 자세히 보기')),
  );
}

function groupsWithVendors() {
  const active = shown.map((e) => byId.get(e.id));
  return PERK_GROUPS.map((g) => ({ ...g, list: active.filter((v) => (v.perks || []).some(g.test)) })).filter(
    (g) => g.list.length >= 2,
  );
}

function perkChipsNav(r, current) {
  const groups = groupsWithVendors();
  return h(
    'nav',
    { class: 'va-seg', 'aria-label': '혜택 종류' },
    h('a', { class: 'va-chip', href: `${r}benefits/`, 'aria-current': current === '' ? 'page' : null }, '전체'),
    groups.map((g) =>
      h('a', { class: 'va-chip', href: `${r}benefits/${g.slug}/`, 'aria-current': current === g.slug ? 'page' : null }, g.label),
    ),
  );
}

function changesBox() {
  const moved = top.filter((e) => e.isNew || (e.prev && e.prev !== e.rank));
  if (!moved.length) return null;
  return h(
    'section',
    { class: 'va-card va-card--change', 'aria-labelledby': 'chg-title' },
    h('h2', { id: 'chg-title' }, '이번 갱신에서 바뀐 순위'),
    h(
      'ul',
      { class: 'va-chg' },
      moved.map((e) =>
        h('li', h('span', byId.get(e.id).name), h('span', { class: 'va-chg__to' }, `${e.rank}위`), move(e)),
      ),
    ),
  );
}

function faqBlock(withLd) {
  const items = site.faq.map((f) => ({ q: f.q, a: f.a.replace('{cadence}', cadence.word) }));
  return {
    node: h(
      'section',
      { class: 'va-faq', 'aria-labelledby': 'faq-title' },
      h('h2', { id: 'faq-title', class: 'va-h2' }, '자주 묻는 질문'),
      h(
        'ol',
        { class: 'va-faq__list' },
        items.map((f, i) =>
          h('li', { class: 'va-faq__item' }, h('span', { class: 'va-faq__no', 'aria-hidden': 'true' }, String(i + 1)), h('h3', f.q), h('p', f.a)),
        ),
      ),
    ),
    ld: withLd
      ? { '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }
      : null,
  };
}

function statusLine() {
  return h(
    'p',
    { class: 'va-status' },
    h('span', { class: 'va-status__dot', 'aria-hidden': 'true' }),
    h('time', { datetime: ranking.date }, `${dateKo} 갱신`),
    h('span', { class: 'va-status__sep', 'aria-hidden': 'true' }, '·'),
    h('span', `${cadence.word} 갱신`),
  );
}

// ---------- home ----------
function buildHome() {
  const r = rel(0);
  const faq = faqBlock(true);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: site.brand, url: pageUrl('', 0), inLanguage: 'ko' },
      { '@type': 'WebPage', name: `웹하드 순위 ${ym}`, dateModified: ranking.date, url: pageUrl('', 0) },
      {
        '@type': 'ItemList',
        name: `웹하드 순위 ${ym}`,
        itemListElement: top.map((e) => ({ '@type': 'ListItem', position: e.rank, name: byId.get(e.id).name, url: pageUrl(`webhard/${e.id}/`, 0) })),
      },
      faq.ld,
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: '웹하드 순위', item: pageUrl('', 0) }] },
    ],
  };
  const topNames = top.slice(0, 3).map((e) => byId.get(e.id).name).join(', ');
  const views = filterViews();
  const body = [
    h(
      'div',
      { class: 'va-head va-head--home' },
      h('h1', '웹하드 순위 ', h('span', { class: 'va-head__when' }, ym)),
      h(
        'p',
        { class: 'va-status' },
        h('span', { class: 'va-status__dot', 'aria-hidden': 'true' }),
        h('time', { datetime: ranking.date }, `${String(Y).slice(2)}년 ${M}월 ${D}일 순위 업데이트`),
      ),
    ),
    h(
      'section',
      { class: 'va-rankbox', 'aria-labelledby': 'list-title' },
      h('h2', { id: 'list-title', class: 'va-sr' }, `웹하드 순위 상위 ${top.length}곳`),
      views.map((vw, i) => h('input', { class: 'va-fin', type: 'radio', name: 'view', id: `v-${i}`, checked: i === 0 })),
      h(
        'div',
        { class: 'va-ftabs', role: 'presentation' },
        views.map((vw, i) => h('label', { class: 'va-ftab', for: `v-${i}` }, vw.label)),
      ),
      views.map((vw, i) =>
        h(
          'div',
          { class: `va-board va-pane va-pane--${i}` },
          h(
            'div',
            { class: 'va-listhead', 'aria-hidden': 'true' },
            h('span', '순위'),
            h('span', '서비스와 주요 혜택'),
            h('span', vw.head),
          ),
          h(
            'ol',
            { class: 'va-list', 'aria-label': vw.label },
            vw.list.map(({ e, alt }) => rankRow(e, r, alt)),
          ),
        ),
      ),
      h('p', { class: 'va-note' }, '리뷰·평점·가입 혜택 탭은 통합 상위 10곳을 그 값 하나로만 다시 줄 세운 결과예요.'),
    ),
    faq.node,
  ];
  write(
    'index.html',
    shell({
      depth: 0,
      current: 'rank',
      headOpts: {
        title: `웹하드 순위 ${ym} · 웹하드 추천과 가입 혜택 비교 | ${site.brand}`,
        desc: `${ym} 웹하드 순위예요. ${topNames} 등 웹하드 ${shown.length}곳의 가입 혜택과 이벤트를 비교하고, 공개 지표로 ${cadence.word} 다시 매긴 순위를 확인하세요.`,
        path: '',
        ld,
      },
      body,
    }),
  );
}

// ---------- vendor detail ----------
function webBucket(id) {
  const ranks = shown
    .map((e) => ({ id: e.id, r: latestRank(e.id) }))
    .filter((x) => x.r)
    .sort((a, b) => a.r - b.r);
  const i = ranks.findIndex((x) => x.id === id);
  if (i < 0) return '확인된 값 없음';
  const n = ranks.length;
  return i < n / 3 ? '많은 편' : i < (2 * n) / 3 ? '보통' : '적은 편';
}
function latestRank(id) {
  const hist = metrics.web?.[id];
  if (!hist) return null;
  const d = Object.keys(hist).sort().at(-1);
  return d ? hist[d] : null;
}
function trendWord(id) {
  const hist = metrics.web?.[id];
  if (!hist) return '확인된 값 없음';
  const dates = Object.keys(hist).sort();
  const now = dates.at(-1);
  const back = new Date(Date.parse(now) - 14 * 86400e3).toISOString().slice(0, 10);
  const then = dates.filter((d) => d <= back).at(-1);
  if (!then) return '확인된 값 없음';
  const rate = (hist[then] - hist[now]) / hist[then];
  return rate > 0.01 ? '오름세' : rate < -0.01 ? '내림세' : '보합';
}
function perkSummary(v) {
  const f = perkFigures(v.perks || []);
  if (!f.count) return '확인된 혜택 없음';
  const j = (v.perks || []).find((p) => p.kind === 'join');
  return [j ? j.text : '가입 혜택 없음', `이벤트 ${f.events}개`].join(' · ');
}
function installsWord(n) {
  if (!n) return null;
  if (n >= 1e8) return `${n / 1e8}억+`;
  if (n >= 1e4) return `${(n / 1e4).toLocaleString('en-US')}만+`;
  return `${n.toLocaleString('en-US')}+`;
}

// Korean particle by final consonant of the last Hangul syllable (digits/latin treated as vowel-final).
function josa(word, withFinal, withoutFinal) {
  const c = String(word).replace(/['"’)\]\s]+$/, '').slice(-1).charCodeAt(0);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false;
  return word + (has ? withFinal : withoutFinal);
}
const quoted = (t) => `'${t}'`;
const listWa = (items) => items.map((t) => josa(quoted(t), '과', '와')).join(' ');
const lastObj = (items) => josa(quoted(items.at(-1)), '을', '를');

const SENTENCE = [
  (v, e, y) => `${josa(v.name, '은', '는')} ${y ? `${y}년에 도메인을 등록한` : '국내'} 웹하드 서비스예요.`,
  (v, e, y) => `${y ? `${y}년 등록 도메인으로 운영 중인` : '국내'} 웹하드 ${v.name}의 정보를 모았어요.`,
  (v, e, y) => `${v.name}의 혜택과 기본 정보를 한곳에 정리했어요.${y ? ` 공식 도메인은 ${y}년에 등록됐어요.` : ''}`,
];

function vendorText(v, e, idx) {
  const y = v.domainYear;
  const first = SENTENCE[idx % SENTENCE.length](v, e, y);
  const j = (v.perks || []).find((p) => p.kind === 'join');
  const evs = (v.perks || []).filter((p) => p.kind === 'event').map((p) => p.text);
  const perk = j
    ? `가입하면 ${quoted(j.text)} 혜택이 있고${evs.length ? `, 이벤트로 ${evs.length > 1 ? listWa(evs.slice(0, -1)) + ' ' + lastObj(evs) : lastObj(evs)} 진행해요.` : ', 따로 확인된 이벤트는 없어요.'}`
    : evs.length
      ? `가입 혜택은 확인되지 않았고, 이벤트로 ${evs.length > 1 ? listWa(evs.slice(0, -1)) + ' ' + lastObj(evs) : lastObj(evs)} 진행해요.`
      : '확인된 혜택이 없어요. 공식 사이트에서 확인하세요.';
  const pos = rankOf.has(v.id) ? `${dateKo} 집계에서 ${rankOf.get(v.id).rank}위예요.` : '';
  return [first, perk, pos].filter(Boolean).join(' ');
}

function buildVendor(v, idx) {
  const depth = 2;
  const r = rel(depth);
  const e = rankOf.get(v.id);
  const app = snap.app?.[v.id];
  const appText =
    app && app.installs ? `설치 ${installsWord(app.installs)}${app.rating ? ` · 평점 ${app.rating}` : ''}` : v.playId ? EMPTY : '앱 없음';
  const op = v.operator;
  const info = [
    ['운영사', op?.name || EMPTY],
    ['사업자등록번호', op?.bizNo || EMPTY],
    op ? ['정보 출처', op.from === 'footer' ? '공식 사이트 바닥글' : '앱 등록정보'] : null,
    ['도메인 등록', v.domainYear ? `${v.domainYear}년` : EMPTY],
    ['안드로이드 앱', appText],
  ].filter(Boolean);
  const summary = criteria.map((k) => [
    CRITERIA[k].label,
    k === 'perks' ? perkSummary(v) : k === 'web_rank' ? webBucket(v.id) : k === 'web_trend' ? trendWord(v.id) : installsWord(app?.installs) || '확인된 값 없음',
  ]);
  // other vendors: neighbours in the current order, different for each page
  const order = shown.map((x) => x.id);
  const at = order.indexOf(v.id);
  const others = [1, 2, 3, 4, -1, -2, 5, 6]
    .map((d) => order[(at + d + order.length) % order.length])
    .filter((id, i, a) => id !== v.id && a.indexOf(id) === i)
    .slice(0, 4)
    .map((id) => byId.get(id));

  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '웹하드 순위', item: pageUrl('', depth) },
          { '@type': 'ListItem', position: 2, name: v.name, item: pageUrl(`webhard/${v.id}/`, depth) },
        ],
      },
      { '@type': 'WebPage', name: `${v.name} 순위·가입 혜택·이벤트`, dateModified: ranking.date, url: pageUrl(`webhard/${v.id}/`, depth) },
    ],
  };

  const hero = h(
    'div',
    { class: 'va-vhead' },
    h('span', { class: 'va-ico va-ico--lg va-vhead__ico' }, icon(v, r, 64)),
    h(
      'div',
      { class: 'va-vhead__txt' },
      h('h1', v.name),
    ),
    e
      ? h(
          'div',
          { class: 'va-vstat' },
          h('p', h('span', { class: 'va-vstat__k' }, '순위'), h('b', `${e.rank}위`), move(e)),
          h('p', h('span', { class: 'va-vstat__k' }, '총점'), h('b', fmtScore(e.total)), h('small', `/${scaleMax}`)),
          h('p', h('span', { class: 'va-vstat__k' }, '별점'), h('b', e.stars.toFixed(1)), h('small', '/5')),
        )
      : null,
  );

  const body = [
    h(
      'nav',
      { class: 'va-crumb', 'aria-label': '현재 위치' },
      h('a', { href: r }, '웹하드 순위'),
      h('span', { 'aria-hidden': 'true' }, '›'),
      h('span', { 'aria-current': 'page' }, v.name),
    ),
    hero,
    h('p', { class: 'va-vtext' }, vendorText(v, e, idx)),
    h('p', { class: 'va-vgo' }, goButton(v, r, 'va-cta')),
    h(
      'div',
      { class: 'va-grid2' },
      h(
        'section',
        { class: 'va-card', 'aria-labelledby': 'pk' },
        h('h2', { id: 'pk' }, '혜택 정보'),
        v.perks?.length
          ? h(
              'ul',
              { class: 'va-perks' },
              v.perks.map((p) => h('li', h('span', { class: 'va-perks__k' }, p.kind === 'join' ? '가입' : '이벤트'), h('span', p.text))),
            )
          : h('p', EMPTY),
      ),
      h(
        'section',
        { class: 'va-card', 'aria-labelledby': 'sm' },
        h('h2', { id: 'sm' }, '요약 지표'),
        h('dl', { class: 'va-kv' }, summary.map(([k, val]) => [h('dt', k), h('dd', val)])),
      ),
    ),
    h(
      'section',
      { class: 'va-card', 'aria-labelledby': 'bi' },
      h('h2', { id: 'bi' }, '기본 정보'),
      h('dl', { class: 'va-kv va-kv--wide' }, info.map(([k, val]) => [h('dt', k), h('dd', val)])),
    ),
    h(
      'section',
      { class: 'va-others', 'aria-labelledby': 'ot' },
      h('h2', { id: 'ot', class: 'va-h2' }, '다른 웹하드'),
      h(
        'ul',
        { class: 'va-others__list' },
        others.map((o) =>
          h(
            'li',
            h(
              'a',
              { class: 'va-other', href: `${r}webhard/${o.id}/` },
              h('span', { class: 'va-ico va-ico--sm' }, icon(o, r, 32)),
              h('span', { class: 'va-other__name' }, o.name),
              h('span', { class: 'va-other__perk' }, perkText(o)),
            ),
          ),
        ),
      ),
    ),
  ];
  const perkLine = v.perks?.length ? v.perks.map((p) => p.text).join(', ') : '혜택 정보';
  write(
    `webhard/${v.id}/index.html`,
    shell({
      depth,
      current: 'rank',
      headOpts: {
        title: `${v.name} 순위·가입 혜택·이벤트 (${ymDot}) | ${site.brand}`,
        desc: `${v.name}의 ${ym} 웹하드 순위와 가입 혜택, 이벤트를 정리했어요. ${perkLine}과 운영사, 앱 정보를 확인하고 다른 웹하드와 비교해 보세요.`,
        path: `webhard/${v.id}/`,
        ld,
      },
      body,
    }),
  );
}

// ---------- guide ----------
function buildGuide() {
  const depth = 1;
  const r = rel(depth);
  const faq = faqBlock(false);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '웹하드 순위', item: pageUrl('', depth) },
          { '@type': 'ListItem', position: 2, name: '기준 안내', item: pageUrl('guide/', depth) },
        ],
      },
    ],
  };
  const body = [
    pageHead('순위 기준 안내', '순위에 쓰는 항목과, 웹하드를 고를 때 직접 확인하면 좋은 것을 정리했어요.'),
    h(
      'section',
      { class: 'va-sec', 'aria-labelledby': 'g1' },
      h('h2', { id: 'g1', class: 'va-h2' }, '평가 항목'),
      h(
        'ul',
        { class: 'va-critcards' },
        criteria.map((k) => h('li', { class: 'va-card' }, h('h3', CRITERIA[k].label), h('p', CRITERIA[k].desc))),
      ),
      h(
        'dl',
        { class: 'va-kv va-kv--wide va-used' },
        h('dt', '집계에 쓴 데이터'),
        h('dd', criteria.map((k) => CRITERIA[k].label).join(' · ')),
        h('dt', '갱신 주기'),
        h('dd', `${cadence.word} 한 번`),
        h('dt', '최근 갱신'),
        h('dd', h('time', { datetime: ranking.date }, `${Y}년 ${dateKo}`)),
        webCriteria.length ? h('dt', '데이터 출처') : null,
        webCriteria.length
          ? h(
              'dd',
              `${webCriteria.map((k) => CRITERIA[k].label).join('·')}: `,
              h('a', { class: 'va-src', href: 'https://tranco-list.eu/', rel: 'nofollow' }, 'Tranco 목록'),
              ' (원천: Cisco Umbrella, Majestic CC BY 3.0, Farsight, Chrome UX Report CC BY-SA 4.0,',
              ' Cloudflare Radar CC BY-NC 4.0)',
            )
          : null,
      ),
    ),
    h(
      'section',
      { class: 'va-sec', 'aria-labelledby': 'g2' },
      h('h2', { id: 'g2', class: 'va-h2' }, '고르기 전에 볼 것'),
      h(
        'div',
        { class: 'va-tablewrap' },
        h(
          'table',
          { class: 'va-table' },
          h('thead', h('tr', h('th', { scope: 'col' }, '항목'), h('th', { scope: 'col' }, '볼 것'), h('th', { scope: 'col' }, '판단'))),
          h(
            'tbody',
            site.checklist.map((c) => h('tr', h('th', { scope: 'row' }, c.item), h('td', c.look), h('td', c.decide))),
          ),
        ),
      ),
    ),
    faq.node,
    h(
      'section',
      { class: 'va-sec', 'aria-labelledby': 'g3' },
      h('h2', { id: 'g3', class: 'va-h2' }, '웹하드 보러 가기'),
      h(
        'ul',
        { class: 'va-others__list' },
        top.slice(0, 4).map((e) => {
          const v = byId.get(e.id);
          return h(
            'li',
            h(
              'a',
              { class: 'va-other', href: `${r}webhard/${v.id}/` },
              h('span', { class: 'va-ico va-ico--sm' }, icon(v, r, 32)),
              h('span', { class: 'va-other__name' }, v.name),
              h('span', { class: 'va-other__perk' }, perkText(v)),
            ),
          );
        }),
      ),
      h('p', { class: 'va-card__more' }, h('a', { href: r }, '전체 순위 보기')),
    ),
  ];
  write(
    'guide/index.html',
    shell({
      depth,
      current: 'guide',
      headOpts: {
        title: `웹하드 순위 기준 안내 · 고르기 전에 볼 것 | ${site.brand}`,
        desc: `${site.brand} 웹하드 순위에 쓰는 평가 항목과 갱신 주기를 안내해요. 가입 혜택, 정기 결제, 제휴 콘텐츠처럼 웹하드를 고르기 전에 직접 확인하면 좋은 점도 함께 정리했어요.`,
        path: 'guide/',
        ld,
      },
      body,
    }),
  );
}

// ---------- perks pages ----------
function perkRow(v, r, highlight) {
  return h(
    'li',
    { class: 'va-prow', 'data-href': `${r}webhard/${v.id}/` },
    h('span', { class: 'va-ico' }, icon(v, r, 40)),
    h(
      'div',
      { class: 'va-body' },
      h('p', { class: 'va-name' }, h('a', { href: `${r}webhard/${v.id}/` }, v.name)),
      h(
        'p',
        { class: 'va-tags' },
        v.perks?.length
          ? v.perks.map((p) => h('span', { class: `va-tag${highlight && highlight(p) ? ' va-tag--on' : ''}` }, p.text))
          : h('span', { class: 'va-tag va-tag--none' }, EMPTY),
      ),
    ),
    goButton(v, r),
  );
}

function buildPerks() {
  const groups = groupsWithVendors();
  const all = shown.map((e) => byId.get(e.id));
  const pages = [{ slug: '', label: '전체', list: all, test: null }, ...groups];
  for (const g of pages) {
    const depth = g.slug ? 2 : 1;
    const r = rel(depth);
    const p = g.slug ? `benefits/${g.slug}/` : 'benefits/';
    const title = g.slug ? `웹하드 ${g.label} 혜택 모음` : '웹하드 혜택별 추천';
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '웹하드 순위', item: pageUrl('', depth) },
        { '@type': 'ListItem', position: 2, name: '혜택별 추천', item: pageUrl('benefits/', depth) },
        ...(g.slug ? [{ '@type': 'ListItem', position: 3, name: g.label, item: pageUrl(p, depth) }] : []),
      ],
    };
    const body = [
      pageHead(
        title,
        g.slug ? `${g.label} 혜택이 있는 웹하드 ${g.list.length}곳이에요.` : '혜택 종류를 골라 해당하는 웹하드만 모아 볼 수 있어요.',
        perkChipsNav(r, g.slug),
      ),
      h('ul', { class: 'va-plist' }, g.list.map((v) => perkRow(v, r, g.test))),
      h('p', { class: 'va-note' }, `혜택은 각 서비스가 공개한 문구예요. 가입 전에 공식 사이트에서 조건을 확인하세요.`),
    ];
    write(
      `${p}index.html`,
      shell({
        depth,
        current: 'perks',
        headOpts: {
          title: `${title} (${ymDot}) | ${site.brand}`,
          desc: g.slug
            ? `${g.label} 혜택이 있는 웹하드를 모았어요. ${g.list.map((v) => v.name).slice(0, 4).join(', ')} 등 ${g.list.length}곳의 가입 혜택과 이벤트 문구를 한눈에 비교해 보세요.`
            : `웹하드 ${all.length}곳의 가입 혜택과 이벤트를 종류별로 모았어요. 가입 포인트, 100원 이용, 페이백처럼 원하는 혜택을 골라 비교해 보세요.`,
          path: p,
          ld,
        },
        body,
      }),
    );
  }
  return pages.map((g) => (g.slug ? `benefits/${g.slug}/` : 'benefits/'));
}

// ---------- redirect pages ----------
function buildGo(v) {
  const enc = Buffer.from(v.url, 'utf8').toString('base64').split('').reverse().join('');
  const script = `var u=document.getElementById('d').dataset.u;location.replace(atob(u.split('').reverse().join('')));`;
  const html = documentHTML(
    h(
      'html',
      { lang: 'ko' },
      h(
        'head',
        h('meta', { charset: 'utf-8' }),
        h('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }),
        h('meta', { 'http-equiv': 'Content-Security-Policy', content: csp([script], []) }),
        h('meta', { name: 'referrer', content: 'strict-origin-when-cross-origin' }),
        h('meta', { name: 'robots', content: 'noindex,nofollow' }),
        h('title', `${v.name}(으)로 이동`),
      ),
      h(
        'body',
        h('p', { id: 'd', 'data-u': enc }, `${v.name} 공식 사이트로 이동하고 있어요.`),
        h('noscript', h('p', h('a', { href: v.url, rel: 'nofollow' }, `${v.name} 공식 사이트 열기`))),
        h('script', raw(script)),
      ),
    ),
  );
  write(`go/${v.id}/index.html`, html);
}

// ---------- 404 ----------
function build404() {
  const style = `body{margin:0;padding:48px 16px;font:16px/1.6 sans-serif;color:#1f1b19;word-break:keep-all}`;
  const style2 = `main{max-width:560px;margin:auto}h1{font-size:24px}a{display:inline-block;padding:12px 0;color:#88112f}`;
  const home = ABSOLUTE ? `${SITE_URL}/` : BASE_PATH;
  write(
    '404.html',
    documentHTML(
      h(
        'html',
        { lang: 'ko' },
        h(
          'head',
          h('meta', { charset: 'utf-8' }),
          h('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }),
          h('meta', { 'http-equiv': 'Content-Security-Policy', content: csp([], [style, style2]) }),
          h('meta', { name: 'referrer', content: 'strict-origin-when-cross-origin' }),
          h('meta', { name: 'robots', content: 'noindex' }),
          h('title', `페이지를 찾을 수 없어요 | ${site.brand}`),
          h('style', raw(style)),
          h('style', raw(style2)),
        ),
        h(
          'body',
          h(
            'main',
            h('h1', '페이지를 찾을 수 없어요'),
            h('p', '주소가 바뀌었거나 없어진 페이지예요.'),
            h('p', h('a', { href: home }, `${site.brand} 첫 화면으로 가기`)),
          ),
        ),
      ),
    ),
  );
}

// ---------- text files ----------
function buildText(perkPaths) {
  const pages = ['', 'benefits/', 'guide/', ...perkPaths.filter((p) => p !== 'benefits/'), ...shown.map((e) => `webhard/${e.id}/`)];
  fs.writeFileSync(
    path.join(OUT, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /go/\n${ABSOLUTE ? `\nSitemap: ${SITE_URL}/sitemap.xml\n` : ''}`,
  );
  if (ABSOLUTE) {
    const urls = pages
      .map((p) => `  <url>\n    <loc>${SITE_URL}/${p}</loc>\n    <lastmod>${ranking.date}</lastmod>\n  </url>`)
      .join('\n');
    fs.writeFileSync(
      path.join(OUT, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    );
  }
  const u = (p) => (ABSOLUTE ? `${SITE_URL}/${p}` : `./${p}`);
  const lines = [
    `# ${site.brand}`,
    '',
    `> 국내 웹하드 ${shown.length}곳의 순위와 가입 혜택을 비교하는 한국어 사이트예요. ${cadence.word} 갱신해요.`,
    '',
    `최근 갱신: ${ranking.date}`,
    `순위 기준: ${criteria.map((k) => CRITERIA[k].label).join(', ')}`,
    '',
    '## 상위 10곳',
    ...top.map((e) => `- ${e.rank}. [${byId.get(e.id).name}](${u(`webhard/${e.id}/`)}): ${perkText(byId.get(e.id))}`),
    '',
    '## 페이지',
    `- [웹하드 순위](${u('')})`,
    `- [혜택별 추천](${u('benefits/')})`,
    `- [기준 안내](${u('guide/')})`,
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'llms.txt'), lines.join('\n'));
}

// ---------- run ----------
buildHome();
shown.forEach((e, i) => buildVendor(byId.get(e.id), i));
buildGuide();
const perkPaths = buildPerks();
for (const v of vendors) if (v.status === 'active' && v.url) buildGo(v);
build404();
buildText(perkPaths);

// remove internal notes from copied assets
for (const f of fs.readdirSync(A, { recursive: true })) {
  if (/\.(md|map)$/i.test(f)) fs.rmSync(path.join(A, f));
}

// guard: placeholder must never ship
for (const f of fs.readdirSync(OUT, { recursive: true })) {
  const p = path.join(OUT, f);
  if (fs.statSync(p).isFile() && /\.(html|txt|xml|css|js)$/.test(f) && fs.readFileSync(p, 'utf8').includes(PLACEHOLDER)) {
    console.error(`address placeholder left in ${f}`);
    process.exit(1);
  }
}
console.log(`built ${shown.length} vendors, ${perkPaths.length} perk pages -> ${path.relative(ROOT, OUT)}`);
