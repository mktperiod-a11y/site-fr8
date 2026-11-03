// Generates test data: random scoring profiles and an "edge" data set with extreme values.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { validateProfile, computeRanking } from '../../scripts/lib/score.mjs';

const pick = (a) => a[randomInt(a.length)];

export function randomProfile() {
  for (;;) {
    const pool = ['web_rank', 'web_trend', 'perks', 'app_installs'];
    const n = pick([3, 4]);
    const metrics = [];
    while (metrics.length < n) metrics.push(pool.splice(randomInt(pool.length), 1)[0]);
    const weights = Object.fromEntries(metrics.map((m) => [m, 15 + 5 * randomInt(8)]));
    const p = {
      metrics,
      weights,
      transform: Object.fromEntries(metrics.map((m) => [m, pick(['log', 'pct', 'zcap'])])),
      alpha: pick([null, 0.5, 0.6, 0.7, 0.8]),
      tie: pick(['prev', 'first', 'name']),
      scale: pick([10, 100, 1000]),
      starFloor: pick([3.4, 3.5, 3.6, 3.7, 3.8]),
      trendDays: pick([14, 21, 28]),
      perksMode: pick(['join', 'event', 'mix']),
    };
    try {
      return validateProfile(p);
    } catch {
      /* draw again */
    }
  }
}

const day = (base, n) => new Date(Date.parse(base) + n * 86400e3).toISOString().slice(0, 10);

/** Edge data set: odd names, 0-3 perks, missing logos/urls, gaps in metrics. */
export function edgeData() {
  const names = [
    ['e01', '아주아주긴이름을가진웹하드서비스플러스프리미엄'],
    ['e02', '결'],
    ['e03', 'Q'],
    ['e04', '세번째로긴이름의디스크'],
    ['e05', '다섯번째파일'],
    ['e06', '여섯'],
    ['e07', '일곱번째 웹하드'],
    ['e08', '여덟번째'],
    ['e09', '아홉'],
    ['e10', '열번째서비스'],
    ['e11', '열하나'],
    ['e12', '열둘'],
    ['e13', '주소없음'],
    ['e14', '대기업체'],
  ];
  const perkSets = [
    [],
    [{ kind: 'join', text: '가입 5,000P' }],
    [{ kind: 'join', text: '본인인증 1,000B' }, { kind: 'event', text: '첫 결제 100원' }],
    [
      { kind: 'join', text: '첫 달 자유이용권 100원' },
      { kind: 'event', text: '정기권 결제 쿠폰 3장' },
      { kind: 'event', text: '출석 최대 3,300P' },
    ],
  ];
  const vendors = names.map(([id, name], i) => ({
    id,
    name,
    status: id === 'e14' ? 'active' : 'active',
    url: id === 'e13' ? null : `https://www.${id}.example/`,
    domains: [`${id}.example`],
    playId: i % 3 === 0 ? null : `com.example.${id}`,
    appStoreId: null,
    logoSrc: null,
    perks: perkSets[i % 4],
    operator: i % 2 ? { name: `주식회사 ${name.slice(0, 6)}`, bizNo: null, from: 'footer' } : null,
    domainYear: i % 5 ? 2000 + i : null,
    affiliate: i === 4,
  }));
  vendors.push({ ...vendors[0], id: 'e15', name: '숨김업체', status: 'excluded' });

  const base = '2026-09-01';
  const web = {};
  for (const v of vendors) {
    if (['e05', 'e13'].includes(v.id)) continue; // not in list
    web[v.id] = {};
    for (let d = 0; d < 60; d++) web[v.id][day(base, d)] = 1000 + randomInt(900000);
  }
  const snaps = [];
  for (let k = 0; k < 4; k++) {
    const date = day(base, 56 + k);
    const s = { date, web: {}, app: {}, perks: {} };
    for (const [i, v] of vendors.entries()) {
      s.web[v.id] = web[v.id] ? { s: k === 3 && i === 7 ? 'carried' : 'ok' } : { s: 'absent' };
      s.app[v.id] = !v.playId
        ? { s: 'absent' }
        : k === 3 && i === 8
          ? { s: 'missing' }
          : { s: 'ok', installs: 10000, exact: 1000 + randomInt(5e6), rating: 4.1, ratings: 100 };
      const n = v.perks.length;
      s.perks[v.id] = n ? { s: 'ok', join: 1000 * randomInt(6), events: Math.min(2, n) } : { s: 'absent', join: 0, events: 0 };
    }
    snaps.push(s);
  }
  return { vendors, metrics: { web, snapshots: snaps } };
}

/** Writes a complete data dir (vendors, metrics, ranking, site) for build tests. */
export function writeEdgeDir(dir, siteJson) {
  const { vendors, metrics } = edgeData();
  const profile = randomProfile();
  let prev = null;
  let res;
  for (let k = 1; k <= metrics.snapshots.length; k++) {
    const store = { web: metrics.web, snapshots: metrics.snapshots.slice(0, k) };
    res = computeRanking(profile, vendors, store, prev);
    prev = res;
  }
  // force the extremes the pages must survive
  // longest names always land in the moved list and in the unranked list
  const take = (id) => res.list.splice(res.list.findIndex((e) => e.id === id), 1)[0];
  const longest = take('e01');
  const second = take('e04');
  res.list.splice(1, 0, longest);
  res.list.push(second);
  res.list.forEach((e, i) => (e.rank = i + 1));
  const list = res.list;
  list[0].total = profile.scale;
  list[0].stars = 5;
  list.at(-1).total = 0;
  list[1].prev = 5;
  list[2].prev = 1;
  list[3].isNew = true;
  list[3].prev = null;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'vendors.json'), JSON.stringify({ vendors }, null, 2));
  fs.writeFileSync(path.join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2));
  fs.writeFileSync(path.join(dir, 'ranking.json'), JSON.stringify(res, null, 2));
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(siteJson, null, 2));
  return { profile, vendors, ranking: res };
}
