// Pure scoring: (profile, vendors, metrics store, previous result) -> ranking result.
import { median } from './util.mjs';

export const METRIC_KEYS = ['web_rank', 'web_trend', 'perks', 'app_installs'];
export const PUBLIC_COUNT = 10;
const PRESENT_FLOOR = 0.1;
const TREND_TOLERANCE_DAYS = 4;

const DAY = 86400e3;
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/** Throws when a profile breaks the rules. */
export function validateProfile(p) {
  const errs = [];
  if (!p || !Array.isArray(p.metrics)) throw new Error('profile: metrics');
  if (p.metrics.length < 3 || p.metrics.length > 4) errs.push('metric count');
  if (!p.metrics.every((m) => METRIC_KEYS.includes(m))) errs.push('unknown metric');
  if (!p.metrics.some((m) => m === 'web_trend' || m === 'perks')) errs.push('needs a change metric');
  const w = p.weights || {};
  const sum = p.metrics.reduce((a, m) => a + (w[m] || 0), 0);
  if (sum !== 100) errs.push('weights sum');
  for (const m of p.metrics) if (!(w[m] >= 15 && w[m] <= 50 && w[m] % 5 === 0)) errs.push(`weight ${m}`);
  if ((w.web_rank || 0) + (w.web_trend || 0) < 50) errs.push('web share');
  if ((w.app_installs || 0) > 20) errs.push('app share');
  for (const m of p.metrics) if (!['log', 'pct', 'zcap'].includes(p.transform?.[m])) errs.push(`transform ${m}`);
  if (!(p.alpha === null || (p.alpha >= 0.5 && p.alpha <= 0.8))) errs.push('alpha');
  if (!['prev', 'first', 'name'].includes(p.tie)) errs.push('tie');
  if (![10, 100, 1000].includes(p.scale)) errs.push('scale');
  if (!(p.starFloor >= 3.4 && p.starFloor <= 3.8)) errs.push('starFloor');
  if (![14, 21, 28].includes(p.trendDays)) errs.push('trendDays');
  if (!['join', 'event', 'mix'].includes(p.perksMode)) errs.push('perksMode');
  if (errs.length) throw new Error('profile: ' + errs.join(', '));
  return p;
}

function rankAt(hist, date) {
  if (!hist) return null;
  const dates = Object.keys(hist).filter((d) => d <= date).sort();
  return dates.length ? { date: dates.at(-1), rank: hist[dates.at(-1)] } : null;
}

/** Raw values for one snapshot: { metric: { vendorId: { v, s } } } */
export function rawValues(profile, ids, store, snap) {
  const out = Object.fromEntries(METRIC_KEYS.map((k) => [k, {}]));
  const maxJoin = Math.max(1, ...ids.map((id) => snap.perks?.[id]?.join || 0));
  for (const id of ids) {
    const ws = snap.web?.[id]?.s || 'missing';
    const hist = store.web?.[id];
    const now = ws === 'absent' ? null : rankAt(hist, snap.date);
    if (ws === 'absent') {
      out.web_rank[id] = { s: 'absent' };
      out.web_trend[id] = { s: 'absent' };
    } else if (!now) {
      out.web_rank[id] = { s: 'missing' };
      out.web_trend[id] = { s: 'missing' };
    } else {
      const s = ws === 'ok' ? 'ok' : 'carried';
      out.web_rank[id] = { s, v: now.rank };
      const then = rankAt(hist, addDays(now.date, -profile.trendDays));
      const gap = then ? (Date.parse(addDays(now.date, -profile.trendDays)) - Date.parse(then.date)) / DAY : 99;
      out.web_trend[id] =
        then && gap <= TREND_TOLERANCE_DAYS ? { s, v: (then.rank - now.rank) / then.rank } : { s: 'missing' };
    }
    const a = snap.app?.[id];
    out.app_installs[id] =
      !a || a.s === 'missing' ? { s: 'missing' } : a.s === 'absent' ? { s: 'absent' } : { s: a.s, v: a.exact ?? a.installs };
    const p = snap.perks?.[id];
    if (!p || p.s === 'absent') out.perks[id] = { s: 'absent' };
    else {
      const j = Math.log1p(p.join) / Math.log1p(maxJoin);
      const e = Math.min(p.events, 2) / 2;
      const v = profile.perksMode === 'join' ? p.join : profile.perksMode === 'event' ? p.events : 0.5 * j + 0.5 * e;
      out.perks[id] = { s: 'ok', v };
    }
  }
  return out;
}

/** Fill "missing" with the median of collected values (recorded as "filled"). */
function fillMissing(vals) {
  const present = Object.values(vals).filter((x) => x.v !== undefined).map((x) => x.v);
  const med = median(present);
  for (const x of Object.values(vals)) if (x.s === 'missing' && med !== null) Object.assign(x, { s: 'filled', v: med });
}

function orient(metric, v) {
  // larger is better after this step
  if (metric === 'web_rank') return -Math.log(v);
  if (metric === 'app_installs') return Math.log1p(v);
  return v;
}

/** Map present raw values to [PRESENT_FLOOR, 1]; absent -> 0. */
export function normalize(metric, method, vals) {
  const ids = Object.keys(vals).filter((id) => vals[id].v !== undefined);
  const res = Object.fromEntries(Object.keys(vals).map((id) => [id, 0]));
  if (!ids.length) return res;
  let x;
  if (method === 'log') {
    x = ids.map((id) => {
      const o = orient(metric, vals[id].v);
      return metric === 'web_rank' || metric === 'app_installs' ? o : Math.sign(o) * Math.log1p(Math.abs(o) * 10);
    });
    const lo = Math.min(...x);
    const hi = Math.max(...x);
    x = x.map((v) => (hi === lo ? 1 : (v - lo) / (hi - lo)));
  } else if (method === 'pct') {
    const o = ids.map((id) => orient(metric, vals[id].v));
    x = o.map((v) => {
      if (o.length === 1) return 1;
      const below = o.filter((w) => w < v).length;
      const same = o.filter((w) => w === v).length - 1;
      return (below + same / 2) / (o.length - 1);
    });
  } else {
    const o = ids.map((id) => orient(metric, vals[id].v));
    const mean = o.reduce((a, b) => a + b, 0) / o.length;
    const sd = Math.sqrt(o.reduce((a, b) => a + (b - mean) ** 2, 0) / o.length);
    x = o.map((v) => (sd === 0 ? 1 : (Math.max(-2, Math.min(2, (v - mean) / sd)) + 2) / 4));
  }
  ids.forEach((id, i) => (res[id] = PRESENT_FLOOR + (1 - PRESENT_FLOOR) * x[i]));
  return res;
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * @returns {{date, scale, criteria, list, pending, notes}}
 * list: every competing vendor ordered by rank: { id, rank, prev, total, items, stars, isNew }
 */
export function computeRanking(profile, vendors, store, prev) {
  validateProfile(profile);
  const snap = store.snapshots.at(-1);
  if (!snap) throw new Error('no snapshot');
  const pool = vendors.filter((v) => v.status === 'active').map((v) => v.id);
  const prevList = prev?.list || [];
  const prevById = new Map(prevList.map((e) => [e.id, e]));
  const raw = rawValues(profile, pool, store, snap);
  const notes = [];

  // waiting: new vendors without any value
  const pending = pool.filter(
    (id) => !prevById.has(id) && profile.metrics.every((m) => raw[m][id].v === undefined && raw[m][id].s !== 'absent'),
  );
  const ids = pool.filter((id) => !pending.includes(id));

  const unit = profile.scale / 100;
  const norm = {};
  for (const m of profile.metrics) {
    const vals = Object.fromEntries(ids.map((id) => [id, { ...raw[m][id] }]));
    fillMissing(vals);
    for (const [id, x] of Object.entries(vals)) if (x.s === 'filled') notes.push(`${m}:${id}:filled`);
    norm[m] = normalize(m, profile.transform[m], vals);
  }

  const prevUnit = (prev?.scale || profile.scale) / 100;
  const rows = ids.map((id) => {
    const items = {};
    for (const m of profile.metrics) {
      const max = profile.weights[m] * unit;
      let val = norm[m][id] * max;
      const before = prevById.get(id)?.items?.[m];
      if (profile.alpha !== null && Number.isFinite(before)) {
        const capped = Math.min((before / prevUnit) * unit, max);
        val = profile.alpha * val + (1 - profile.alpha) * capped;
      }
      items[m] = Math.min(r2(val), r2(max));
    }
    const total = r2(Object.values(items).reduce((a, b) => a + b, 0));
    return { id, items, total };
  });

  const nameOf = new Map(vendors.map((v) => [v.id, v.name]));
  const first = profile.metrics[0];
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (profile.tie === 'prev') {
      const pa = prevById.get(a.id)?.rank ?? 1e9;
      const pb = prevById.get(b.id)?.rank ?? 1e9;
      if (pa !== pb) return pa - pb;
    } else if (profile.tie === 'first') {
      if (b.items[first] !== a.items[first]) return b.items[first] - a.items[first];
    }
    return String(nameOf.get(a.id)).localeCompare(String(nameOf.get(b.id)), 'ko');
  });

  const full = profile.scale;
  const list = rows.map((r, i) => {
    const rank = i + 1;
    const before = prevById.get(r.id);
    const prevRank = before && before.rank <= PUBLIC_COUNT ? before.rank : null;
    const stars = Math.round((profile.starFloor + (5 - profile.starFloor) * (r.total / full)) * 10) / 10;
    return {
      id: r.id,
      rank,
      prev: prevRank,
      isNew: rank <= PUBLIC_COUNT && prevList.length > 0 && prevRank === null,
      total: r.total,
      stars: Math.min(5, stars),
      items: r.items,
    };
  });

  return { date: snap.date, scale: profile.scale, criteria: [...profile.metrics], list, pending, notes };
}
