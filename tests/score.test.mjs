import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRanking, validateProfile, normalize, PUBLIC_COUNT } from '../scripts/lib/score.mjs';
import { randomProfile, edgeData } from './lib/fixtures.mjs';

const ENTRY_KEYS = ['id', 'rank', 'prev', 'isNew', 'total', 'stars', 'items'].sort();
const RESULT_KEYS = ['date', 'scale', 'criteria', 'list', 'pending', 'notes'].sort();

function runAll(profile, data) {
  let prev = null;
  const out = [];
  for (let k = 1; k <= data.metrics.snapshots.length; k++) {
    const store = { web: data.metrics.web, snapshots: data.metrics.snapshots.slice(0, k) };
    prev = computeRanking(profile, data.vendors, store, prev);
    out.push(prev);
  }
  return out;
}

test('100 random profiles keep every scoring rule', () => {
  for (let i = 0; i < 100; i++) {
    const profile = randomProfile();
    const data = edgeData();
    for (const res of runAll(profile, data)) {
      assert.deepEqual(Object.keys(res).sort(), RESULT_KEYS);
      assert.ok(res.list.length >= PUBLIC_COUNT);
      let last = Infinity;
      for (const e of res.list) {
        assert.deepEqual(Object.keys(e).sort(), ENTRY_KEYS, 'no extra fields in result rows');
        const sum = Object.values(e.items).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(sum - e.total) < 0.011, 'item scores add up to the total');
        for (const [m, v] of Object.entries(e.items)) {
          const max = (profile.weights[m] * profile.scale) / 100;
          assert.ok(v <= max + 1e-9, `item ${m} within its maximum`);
          assert.ok(v >= 0);
        }
        assert.ok(e.total <= last + 1e-9, 'order follows totals only');
        last = e.total;
        assert.ok(e.stars >= profile.starFloor && e.stars <= 5);
      }
      assert.ok(!res.list.some((e) => e.id === 'e15'), 'excluded vendors never compete');
    }
  }
});

test('same inputs give the same ranking', () => {
  const profile = randomProfile();
  const data = edgeData();
  const a = runAll(profile, data).at(-1);
  const b = runAll(profile, data).at(-1);
  assert.deepEqual(a, b);
});

test('absent values score zero, missing values use the median', () => {
  const vals = { a: { s: 'ok', v: 10 }, b: { s: 'ok', v: 20 }, c: { s: 'absent' } };
  const n = normalize('perks', 'log', vals);
  assert.equal(n.c, 0);
  assert.ok(n.a > 0 && n.b > n.a);

  const profile = { ...randomProfile(), alpha: null, metrics: ['perks', 'web_rank', 'web_trend'], weights: { perks: 30, web_rank: 40, web_trend: 30 }, transform: { perks: 'pct', web_rank: 'pct', web_trend: 'pct' } };
  validateProfile(profile);
  const data = edgeData();
  const snap = data.metrics.snapshots.at(-1);
  // one vendor fails to load its web value and has no history: it gets the median value
  const id = 'e02';
  const store = { web: { ...data.metrics.web, [id]: {} }, snapshots: [{ ...snap, web: { ...snap.web, [id]: { s: 'missing' } } }] };
  const res = computeRanking(profile, data.vendors, store, null);
  assert.ok(res.notes.includes(`web_rank:${id}:filled`));
  const row = res.list.find((e) => e.id === id);
  const others = res.list.filter((e) => e.id !== id).map((e) => e.items.web_rank).sort((x, y) => x - y);
  assert.ok(row.items.web_rank <= others.at(-1), 'a failed fetch never lifts a vendor to the top of that item');
});

test('carried web values come from the stored history', () => {
  const profile = randomProfile();
  const data = edgeData();
  const res = runAll(profile, data).at(-1);
  if (profile.metrics.includes('web_rank')) {
    const row = res.list.find((e) => e.id === 'e08');
    assert.ok(row.items.web_rank > 0, 'carried value still counts');
  }
});

test('previous item scores are capped to the current maximum', () => {
  const profile = { ...randomProfile(), alpha: 0.5 };
  const data = edgeData();
  const prev = {
    scale: profile.scale,
    list: data.vendors.map((v, i) => ({
      id: v.id,
      rank: i + 1,
      items: Object.fromEntries(profile.metrics.map((m) => [m, profile.scale * 5])),
    })),
  };
  const res = computeRanking(profile, data.vendors, { web: data.metrics.web, snapshots: data.metrics.snapshots }, prev);
  for (const e of res.list) {
    for (const [m, v] of Object.entries(e.items)) assert.ok(v <= (profile.weights[m] * profile.scale) / 100 + 1e-9);
  }
});

test('profiles that break the rules are rejected', () => {
  const ok = randomProfile();
  assert.throws(() => validateProfile({ ...ok, weights: { ...ok.weights, [ok.metrics[0]]: ok.weights[ok.metrics[0]] + 5 } }));
  assert.throws(() =>
    validateProfile({
      ...ok,
      metrics: ['web_rank', 'perks', 'app_installs'],
      weights: { web_rank: 40, perks: 35, app_installs: 25 },
      transform: { web_rank: 'log', perks: 'log', app_installs: 'log' },
    }),
  );
  assert.throws(() =>
    validateProfile({
      ...ok,
      metrics: ['web_rank', 'perks', 'app_installs'],
      weights: { web_rank: 45, perks: 40, app_installs: 15 },
      transform: { web_rank: 'log', perks: 'log', app_installs: 'log' },
    }),
  );
});
