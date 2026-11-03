import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildReal, buildEdge, ROOT } from './lib/build-variants.mjs';
import { width, LINE_LIMIT } from '../scripts/lib/html.mjs';
import { labelsNotInUse } from '../scripts/lib/site.mjs';
import { PUBLIC_COUNT } from '../scripts/lib/score.mjs';

const out = {};
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile());
const text = (dir) => files(dir).filter((f) => /\.(html|txt|xml|css|js)$/.test(f));
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');

before(() => {
  out.real = buildReal();
  const edge = buildEdge();
  out.edge = edge.out;
  out.edgeInfo = edge;
  out.abs = buildReal({ SITE_URL: 'https://webhard-example.test' }, path.join(ROOT, '.out', 'test', 'abs'));
  out.gh = buildReal({ SITE_URL: 'https://someone.github.io/some-repo', BASE_PATH: '/some-repo/' }, path.join(ROOT, '.out', 'test', 'gh'));
});

const variants = () => [out.real, out.edge, out.abs, out.gh];

test('only public files are deployed', () => {
  for (const dir of variants()) {
    for (const f of files(dir)) {
      assert.ok(!/\.(json|mjs|md|yml|yaml|sha256)$/i.test(f), `unexpected file ${f}`);
      assert.ok(!/^(data|scripts|tests|\.github)\//.test(f), `unexpected path ${f}`);
    }
  }
});

test('no comments, placeholders or over-long lines', () => {
  for (const dir of variants()) {
    for (const f of text(dir)) {
      const s = read(dir, f);
      assert.ok(!s.includes('.invalid'), `placeholder in ${f}`);
      if (f.endsWith('.html')) assert.ok(!/<!--/.test(s), `comment in ${f}`);
      s.split('\n').forEach((line, i) => assert.ok(width(line) <= LINE_LIMIT, `${f}:${i + 1} is ${width(line)} columns`));
    }
  }
});

test('deployed css has comments stripped', () => {
  for (const dir of variants()) assert.ok(!/\/\*[\s\S]*?\*\//.test(read(dir, 'a/site.css')));
});

test('inline style and script blocks match the CSP hashes', () => {
  const sha = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  for (const dir of variants()) {
    for (const f of text(dir).filter((x) => x.endsWith('.html'))) {
      const s = read(dir, f);
      const cspm = s.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
      assert.ok(cspm, `CSP missing in ${f}`);
      const csp = cspm[1].replace(/\s+/g, ' ');
      assert.ok(/default-src 'none'/.test(csp) && /object-src 'none'/.test(csp) && /form-action 'none'/.test(csp));
      assert.ok(/<meta name="referrer"/.test(s), `referrer meta in ${f}`);
      assert.ok(!/\sstyle="/.test(s), `style attribute in ${f}`);
      for (const m of s.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
        assert.ok(!m[1].includes('\n'), `inline script spans lines in ${f}`);
        assert.ok(csp.includes(sha(m[1])), `script hash missing in ${f}`);
      }
      for (const m of s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
        assert.ok(!m[1].includes('\n'), `inline style spans lines in ${f}`);
        assert.ok(csp.includes(sha(m[1])), `style hash missing in ${f}`);
      }
      assert.ok(!/https?:\/\/(?!schema\.org|www\.sitemaps\.org|webhard-example\.test)[^"'\s]+\.(js|css|woff2?)/.test(s), `external asset in ${f}`);
    }
  }
});

test('public list shows ten vendors and the rest stay unranked', () => {
  const s = read(out.real, 'index.html');
  const firstPane = s.split('va-pane--0')[1].split('va-pane--1')[0];
  assert.equal((firstPane.match(/<li class="va-row/g) || []).length, PUBLIC_COUNT);
  const panes = (s.match(/class="va-board va-pane/g) || []).length;
  assert.equal((s.match(/<li class="va-row/g) || []).length, PUBLIC_COUNT * panes, 'every view shows the same ten');
});

test('every "site" link leads to a generated redirect page', () => {
  for (const dir of variants()) {
    for (const f of text(dir).filter((x) => x.endsWith('.html') && !x.startsWith('go/') && x !== '404.html')) {
      const s = read(dir, f);
      for (const m of s.matchAll(/href="((?:\.\.\/)*|\.\/)go\/([^/"]+)\/"/g)) {
        assert.ok(fs.existsSync(path.join(dir, 'go', m[2], 'index.html')), `${f} -> go/${m[2]}`);
      }
      for (const m of s.matchAll(/href="([^"#]+)"/g)) {
        const href = m[1];
        if (/^(https?:|mailto:)/.test(href)) continue;
        const target = path.normalize(path.join(path.dirname(path.join(dir, f)), href.split('?')[0]));
        const exists = fs.existsSync(target) && (fs.statSync(target).isFile() || fs.existsSync(path.join(target, 'index.html')));
        assert.ok(exists, `${f}: broken link ${href}`);
      }
    }
  }
  // vendors without an address get neither a redirect page nor a link
  assert.ok(!fs.existsSync(path.join(out.edge, 'go', 'e13')));
  assert.ok(!read(out.edge, 'webhard/e13/index.html').includes('go/e13/'));
});

test('redirect pages decode to the official address', () => {
  const { vendors } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'vendors.json'), 'utf8'));
  for (const v of vendors.filter((x) => x.status === 'active' && x.url)) {
    const s = read(out.real, `go/${v.id}/index.html`);
    const enc = s.match(/data-u="([^"]+)"/)[1];
    assert.equal(Buffer.from(enc.split('').reverse().join(''), 'base64').toString('utf8'), v.url);
    assert.ok(/noindex,nofollow/.test(s));
  }
});

test('404 page links home without a domain on the default address', () => {
  assert.ok(read(out.gh, '404.html').includes('href="/some-repo/"'));
  assert.ok(read(out.abs, '404.html').includes('href="https://webhard-example.test/"'));
  assert.ok(/noindex/.test(read(out.gh, '404.html')));
});

test('absolute addresses and sitemap only with an own domain', () => {
  assert.ok(fs.existsSync(path.join(out.abs, 'sitemap.xml')));
  assert.ok(!fs.existsSync(path.join(out.gh, 'sitemap.xml')));
  for (const f of text(out.gh)) assert.ok(!read(out.gh, f).includes('github.io'), `account address in ${f}`);
  assert.ok(read(out.abs, 'index.html').includes('rel="canonical" href="https://webhard-example.test/"'));
});

test('no internal numbers leak into pages', () => {
  for (const dir of variants()) {
    for (const f of text(dir)) {
      const s = read(dir, f);
      assert.ok(!/"items"|"weights"|"transform"|"alpha"|profile\.sha256/.test(s), `internal field in ${f}`);
    }
  }
});

test('only current criteria names appear', () => {
  for (const [dir, rankingPath] of [
    [out.real, null],
    [out.edge, path.join(ROOT, '.out', 'test', 'edge-data', 'ranking.json')],
  ]) {
    const criteria = rankingPath
      ? JSON.parse(fs.readFileSync(rankingPath, 'utf8')).criteria
      : JSON.parse(fs.readFileSync(fs.existsSync(path.join(ROOT, 'data', 'ranking.json')) ? path.join(ROOT, 'data', 'ranking.json') : path.join(ROOT, '.out', 'test', 'ranking-real.json'), 'utf8')).criteria;
    const banned = labelsNotInUse(criteria);
    for (const f of text(dir).filter((x) => /\.(html|txt)$/.test(x))) {
      const s = read(dir, f);
      for (const b of banned) assert.ok(!s.includes(b), `${f} mentions "${b}"`);
    }
  }
  // the share image text is checked the same way
  const share = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8')).shareImage;
  const siteJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'site.json'), 'utf8'));
  const shareText = [...share.lines, share.sub, ...share.chips].join(' ');
  for (const b of labelsNotInUse([]).filter((l) => !siteJson.shareImage.lines.join(' ').includes(l))) assert.ok(!shareText.includes(b), `share image mentions "${b}"`);
  const otherWord = siteJson.cadence === 'weekly' ? '매일' : '매주';
  assert.ok(!shareText.includes(otherWord), 'share image cadence matches');
  for (const f of text(out.real)) assert.ok(!read(out.real, f).includes(`${otherWord} 갱신`), `${f} cadence words`);
});

test('excluded vendors never reach the pages', () => {
  for (const f of text(out.edge)) assert.ok(!read(out.edge, f).includes('숨김업체'), f);
  assert.ok(!fs.existsSync(path.join(out.edge, 'webhard', 'e15')));
});

test('images carry no metadata chunks', () => {
  for (const f of files(path.join(ROOT, 'static'))) {
    const b = fs.readFileSync(path.join(ROOT, 'static', f));
    if (f.endsWith('.png')) {
      for (const chunk of ['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']) assert.ok(!b.includes(Buffer.from(chunk)), `${f} has ${chunk}`);
    }
    if (f.endsWith('.webp')) for (const chunk of ['EXIF', 'XMP ']) assert.ok(!b.includes(Buffer.from(chunk)), `${f} has ${chunk}`);
    if (f.endsWith('.svg')) assert.ok(!/<metadata|inkscape|sodipodi|illustrator|data:image/i.test(b.toString()), f);
  }
});

test('hover and focus only change the overlay, never layout or colour', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static', 'site.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1];
    if (!/:hover/.test(sel)) continue;
    const props = m[2].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean);
    for (const p of props) assert.ok(['opacity', 'text-decoration'].includes(p), `${sel.trim()} changes ${p}`);
  }
});

test('initial boxes use distinct dark colours with 7:1 white text', () => {
  const css = fs.readFileSync(path.join(ROOT, 'static', 'site.css'), 'utf8');
  const cols = [...css.matchAll(/\.va-ini--\d\s*\{\s*background:\s*(#[0-9a-f]{6})/g)].map((m) => m[1]);
  assert.equal(new Set(cols).size, cols.length);
  const lum = (hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const c of cols) assert.ok(1.05 / (lum(c) + 0.05) >= 7, `${c} contrast`);
});
