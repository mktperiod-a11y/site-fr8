// Browser checks at five widths for the real and the edge data builds.
// Usage: node tests/view.mjs [--shots <dir>]   (exit code 1 on any defect)
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { serve } from './lib/serve.mjs';
import { buildReal, buildEdge, ROOT } from './lib/build-variants.mjs';

const WIDTHS = [360, 390, 768, 1024, 1440];
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? path.resolve(process.argv[si + 1]) : null;
const problems = [];
const fail = (where, what) => problems.push(`${where}: ${what}`);

const real = buildReal();
const { out: edge, ranking: edgeRanking } = buildEdge();
const realRanking = JSON.parse(
  fs.readFileSync(
    fs.existsSync(path.join(ROOT, 'data', 'ranking.json'))
      ? path.join(ROOT, 'data', 'ranking.json')
      : path.join(ROOT, '.out', 'test', 'ranking-real.json'),
    'utf8',
  ),
);

function pagesFor(ranking, dir) {
  const ids = ranking.list.map((e) => e.id);
  const pick = [ids[0], ids[3], ids.at(-1)].filter((id, i, a) => a.indexOf(id) === i);
  const perkTabs = fs.existsSync(path.join(dir, 'benefits'))
    ? fs.readdirSync(path.join(dir, 'benefits')).filter((f) => !f.endsWith('.html')).slice(0, 1)
    : [];
  return ['', 'guide/', 'benefits/', ...perkTabs.map((t) => `benefits/${t}/`), ...pick.map((id) => `webhard/${id}/`), 'no-such-page/'];
}

// runs inside the page
function inspect() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push(`horizontal scroll ${document.documentElement.scrollWidth}>${vw}`);
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) =>
    [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const bgOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > -1000;
  };
  // contrast for elements that own text
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.va-sr, .va-skip, script, style')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg) continue;
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = el.closest('.va-ini') ? 7 : large ? 3 : 4.5;
    const cr = ratio(fg, bgOf(el));
    if (cr + 0.01 < need) out.push(`contrast ${cr.toFixed(2)}<${need} "${el.textContent.trim().slice(0, 20)}"`);
  }
  // touch targets
  for (const el of document.querySelectorAll('a, button, summary')) {
    if (!visible(el) || el.closest('.va-skip') || el.hidden) continue;
    if (el.closest('.va-vtext, .va-faq__item p, .va-note, noscript')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    if (r.height < 43.5 || r.width < 43.5) out.push(`target ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 16)}"`);
    void padY;
  }
  // images
  for (const img of document.images) {
    if (!img.hasAttribute('alt')) out.push(`img without alt ${img.getAttribute('src')}`);
    if (img.complete && img.naturalWidth === 0) out.push(`broken image ${img.getAttribute('src')}`);
  }
  // short labels must stay on one line
  const lines = (el) => {
    const tops = new Set();
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim() || n.parentElement.closest('.va-sr')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.bottom));
    }
    // baseline-aligned pieces of one line can differ by a few pixels
    const sorted = [...tops].sort((a, b) => a - b);
    return sorted.filter((t, i) => i === 0 || t - sorted[i - 1] > 8).length;
  };
  for (const el of document.querySelectorAll('.va-go, .va-chip, .va-tab, .va-score, .va-textbtn, .va-cta, .va-move, .va-vstat b, .va-rank, .va-perks__k, .va-tag')) {
    if (visible(el) && lines(el) > 1) out.push(`label wraps "${el.textContent.trim().slice(0, 16)}"`);
  }
  // children stay inside their row/card
  for (const box of document.querySelectorAll('.va-row, .va-prow, .va-card, .va-other, .va-faq__item, .va-mini, .va-vstat')) {
    if (!visible(box)) continue;
    const b = box.getBoundingClientRect();
    for (const c of box.querySelectorAll('*')) {
      if (!visible(c) || c.closest('.va-sr')) continue;
      const r = c.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1) out.push(`overflows its box "${c.textContent.trim().slice(0, 16)}"`);
    }
  }
  // headings: no single-character last line
  for (const el of document.querySelectorAll('h1, h2, h3')) {
    if (!visible(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    const tops = [...new Set(rects.map((r) => Math.round(r.top)))];
    if (tops.length > 1) {
      const lastW = rects.filter((r) => Math.round(r.top) === tops.at(-1)).reduce((s, r) => s + r.width, 0);
      if (lastW < parseFloat(getComputedStyle(el).fontSize) * 2.2) out.push(`orphan in heading "${el.textContent.trim().slice(0, 16)}"`);
    }
  }
  return [...new Set(out)];
}

function rowFacts() {
  const rows = [...document.querySelectorAll('.va-list > .va-row')];
  return rows.slice(0, 4).map((r) => {
    const cs = getComputedStyle(r);
    const q = (s) => r.querySelector(s);
    return {
      border: cs.borderTopWidth + cs.borderTopStyle,
      pad: cs.paddingTop,
      rank: getComputedStyle(q('.va-rank')).fontSize + getComputedStyle(q('.va-rank')).color,
      ico: q('.va-ico').getBoundingClientRect().width,
      score: getComputedStyle(q('.va-score b')).fontSize,
      bg: cs.backgroundColor,
      name: getComputedStyle(q('.va-name')).fontSize,
    };
  });
}

const browser = await chromium.launch();
for (const [label, dir, ranking] of [
  ['real', real, realRanking],
  ['edge', edge, edgeRanking],
]) {
  const { server, url } = await serve(dir);
  const pages = pagesFor(ranking, dir);

  // internal links once
  const seen = new Set();
  const ctx0 = await browser.newContext();
  const p0 = await ctx0.newPage();
  for (const pg of pages.filter((p) => p !== 'no-such-page/')) {
    await p0.goto(url + pg);
    const hrefs = await p0.$$eval('a[href]', (as) => as.map((a) => a.href));
    for (const h of hrefs) {
      if (!h.startsWith(url) || seen.has(h)) continue;
      seen.add(h);
      const res = await p0.request.get(h);
      if (res.status() !== 200) fail(`${label} ${pg}`, `broken link ${h.replace(url, '/')}`);
    }
  }
  await ctx0.close();

  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 600 ? 780 : 900 } });
    await ctx.addInitScript(() => {
      window.__csp = [];
      document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective));
    });
    for (const pg of pages) {
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && !(pg === 'no-such-page/' && /404/.test(m.text()))) errs.push(m.text().slice(0, 120));
      });
      page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
      await page.goto(url + pg, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const where = `${label} ${pg || 'home'} @${w}`;
      for (const e of errs) fail(where, `console: ${e}`);
      const csp = await page.evaluate(() => window.__csp);
      for (const c of csp) fail(where, `CSP violation ${c}`);
      for (const p of await page.evaluate(inspect)) fail(where, p);

      if (pg === '') {
        const facts = await page.evaluate(rowFacts);
        if (facts.length === 4) {
          for (let i = 0; i < 3; i++) {
            const diff = Object.keys(facts[3]).filter((k) => facts[i][k] !== facts[3][k]).length;
            if (diff < 2) fail(where, `top row ${i + 1} looks like the rest (${diff} difference)`);
          }
        }
        if (w === 360) {
          const m = await page.evaluate(() => {
            const st = document.querySelector('.va-status').getBoundingClientRect();
            const third = document.querySelectorAll('.va-list > .va-row')[2].getBoundingClientRect();
            return { st: st.bottom, third: third.bottom };
          });
          if (m.st > 780 || m.third + 16 > 780) fail(where, `first view: status ${Math.round(m.st)}, 3rd row ends ${Math.round(m.third)}`);
        }
        // keyboard focus is visible
        if (w === 1024) {
          for (let i = 0; i < 25; i++) {
            await page.keyboard.press('Tab');
            const f = await page.evaluate(() => {
              const el = document.activeElement;
              if (!el || el === document.body) return null;
              const cs = getComputedStyle(el);
              return { ok: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0, t: el.textContent.trim().slice(0, 16) };
            });
            if (f && !f.ok) fail(where, `focus not visible on "${f.t}"`);
          }
        }
      }
      if (SHOTS && (pg === '' || pg.startsWith('webhard/') || pg === 'guide/' || pg === 'benefits/')) {
        const d = path.join(SHOTS, label);
        fs.mkdirSync(d, { recursive: true });
        await page.screenshot({ path: path.join(d, `${(pg || 'home').replace(/\//g, '_')}-${w}.png`), fullPage: true });
      }
      await page.close();
    }
    await ctx.close();
  }

  // without JavaScript: everything still readable and usable
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 780 } });
  const pj = await noJs.newPage();
  await pj.goto(url);
  const rows = await pj.locator('.va-list > .va-row').count();
  if (rows < Math.min(10, ranking.list.length)) fail(`${label} no-js`, `only ${rows} rows`);
  if (await pj.locator('.va-more').count()) {
    await pj.locator('.va-more > summary').click();
    if (!(await pj.locator('.va-more .va-mini').first().isVisible())) fail(`${label} no-js`, 'other vendors list does not open');
  }
  if (await pj.locator('.va-totop').isVisible()) fail(`${label} no-js`, 'back-to-top shown without script');
  const goCount = await pj.locator('.va-row .va-go[href]').count();
  if (goCount < 1) fail(`${label} no-js`, 'no site links');
  await noJs.close();
  server.close();
}
await browser.close();

if (SHOTS) console.log(`screenshots: ${fs.readdirSync(SHOTS, { recursive: true }).filter((f) => f.endsWith('.png')).length}`);
if (problems.length) {
  for (const p of problems) console.log('FAIL ' + p);
  console.log(`${problems.length} problem(s)`);
  process.exit(1);
}
console.log('view checks passed');
