// Collects public metrics for every candidate and appends one snapshot to data/metrics.json.
// Status per value: ok | absent (nothing exists) | carried (fetch failed, previous value kept)
// | missing (fetch failed and no previous value).
import { readJSON, writeJSON, getText, sleep, kstDate, registeredDomain } from './lib/util.mjs';
import { perkFigures } from './lib/perks.mjs';

const WEB_KEEP_DAYS = 70;
const SNAP_KEEP = 90;

const { vendors } = readJSON('data/vendors.json');
const store = readJSON('data/metrics.json', { web: {}, snapshots: [] });
const today = process.env.COLLECT_DATE || kstDate();
const prevSnap = store.snapshots.at(-1);

const warn = (msg) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `warning: ${msg}`);
const candidates = vendors.filter((v) => v.status !== 'excluded');

async function webRanks(domain) {
  const body = await getText(`https://tranco-list.eu/api/ranks/domain/${domain}`, { timeout: 25000 });
  const j = JSON.parse(body);
  return Array.isArray(j.ranks) ? j.ranks : [];
}

function trimWeb(hist) {
  const dates = Object.keys(hist).sort();
  const keep = dates.slice(-WEB_KEEP_DAYS);
  return Object.fromEntries(keep.map((d) => [d, hist[d]]));
}

async function playStats(id) {
  const html = await getText(`https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=ko&gl=KR`, {
    timeout: 25000,
  });
  const inst = html.match(/\["[0-9,]+\+",(\d+),(\d+),"[^"]*"\]/);
  const rv = html.match(/"ratingValue":"([0-9.]+)"/);
  const rc = html.match(/"ratingCount":"(\d+)"/);
  if (!inst) throw new Error('install figure not found');
  return {
    installs: Number(inst[1]),
    exact: Number(inst[2]),
    rating: rv ? Math.round(Number(rv[1]) * 10) / 10 : null,
    ratings: rc ? Number(rc[1]) : null,
  };
}

const snap = { date: today, web: {}, app: {}, perks: {} };
const counts = { web: [0, 0], app: [0, 0] };

for (const v of candidates) {
  // web popularity (current registered domain first, then older ones)
  const domains = (v.domains?.length ? v.domains : v.url ? [registeredDomain(new URL(v.url).hostname)] : []).map(
    registeredDomain,
  );
  if (!domains.length) {
    snap.web[v.id] = { s: 'absent' };
  } else {
    let got = null;
    let failed = false;
    for (const d of domains) {
      try {
        const ranks = await webRanks(d);
        await sleep(1100);
        if (ranks.length) {
          got = ranks;
          break;
        }
      } catch {
        failed = true;
        await sleep(1100);
      }
    }
    counts.web[1]++;
    if (got) {
      counts.web[0]++;
      const hist = { ...(store.web[v.id] || {}) };
      for (const r of got) hist[r.date] = r.rank;
      store.web[v.id] = trimWeb(hist);
      snap.web[v.id] = { s: 'ok', d: got[0].date };
    } else if (failed) {
      const had = store.web[v.id] && Object.keys(store.web[v.id]).length;
      snap.web[v.id] = { s: had ? 'carried' : 'missing' };
    } else {
      snap.web[v.id] = { s: 'absent' };
    }
  }

  // app installs (display figures are collected too)
  if (!v.playId) {
    snap.app[v.id] = { s: 'absent' };
  } else {
    counts.app[1]++;
    try {
      snap.app[v.id] = { s: 'ok', ...(await playStats(v.playId)) };
      counts.app[0]++;
    } catch {
      const old = prevSnap?.app?.[v.id];
      snap.app[v.id] = old && old.exact != null ? { ...old, s: 'carried' } : { s: 'missing' };
    }
    await sleep(800);
  }

  // confirmed perks at collection time
  const f = perkFigures(v.perks || []);
  snap.perks[v.id] = f.count ? { s: 'ok', join: f.join, events: f.events } : { s: 'absent', join: 0, events: 0 };
}

store.snapshots = store.snapshots.filter((s) => s.date !== today);
store.snapshots.push(snap);
store.snapshots = store.snapshots.slice(-SNAP_KEEP);
store.updated = today;
writeJSON('data/metrics.json', store);

console.log(`web ok ${counts.web[0]}/${counts.web[1]}, app ok ${counts.app[0]}/${counts.app[1]}`);
for (const k of ['web', 'app']) {
  if (counts[k][1] && counts[k][0] === 0) warn(`${k} metric: no value collected this run`);
  else if (counts[k][0] < counts[k][1]) warn(`${k} metric: ${counts[k][1] - counts[k][0]} value(s) not collected`);
}
