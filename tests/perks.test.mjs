import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { perkProblems, joinPoints, perkFigures } from '../scripts/lib/perks.mjs';
import { extractPerks, mergePerks, samePerks } from '../scripts/lib/perk-text.mjs';

const { vendors } = JSON.parse(fs.readFileSync(new URL('../data/vendors.json', import.meta.url), 'utf8'));

test('vendor list: unique ids and names, valid states', () => {
  const ids = new Set();
  const names = new Set();
  for (const v of vendors) {
    assert.ok(/^[a-z0-9-]+$/.test(v.id), v.id);
    assert.ok(!ids.has(v.id) && !names.has(v.name), `duplicate ${v.id}`);
    ids.add(v.id);
    names.add(v.name);
    assert.ok(['active', 'excluded', 'pending'].includes(v.status));
    if (v.url) assert.ok(/^https:\/\//.test(v.url), `${v.id} url`);
  }
});

test('perk text follows the short "condition + benefit" form', () => {
  for (const v of vendors) {
    const perks = v.perks || [];
    assert.ok(perks.filter((p) => p.kind === 'join').length <= 1, `${v.id}: one join perk at most`);
    assert.ok(perks.filter((p) => p.kind === 'event').length <= 2, `${v.id}: two events at most`);
    for (const p of perks) assert.deepEqual(perkProblems(p), [], `${v.id}: ${p.text}`);
  }
  assert.deepEqual(perkProblems({ kind: 'join', text: '가입 시 1,000P 지급' }).sort(), ['tail']);
  assert.ok(perkProblems({ kind: 'event', text: '아주 긴 이벤트 문구가 여기에 계속 이어집니다' }).includes('length'));
});

test('join points and figures', () => {
  assert.equal(joinPoints('가입 1,000P'), 1000);
  assert.equal(joinPoints('본인인증 1,000B'), 1000);
  assert.equal(joinPoints('첫 달 자유이용권 100원'), 0);
  assert.deepEqual(perkFigures([{ kind: 'join', text: '가입 300P' }, { kind: 'event', text: 'a' }]), { join: 300, events: 1, count: 2 });
});

test('page text becomes short perk phrases', () => {
  const html = `<img alt="신규 회원가입 시 3,000포인트 즉시 지급!"><p>앱 설치하면 2,000P</p>
    <p>출석체크 최대 3,300P</p><p>성인 19금 가입 5,000P</p><p>정액제 요금 9,900원</p>`;
  const got = extractPerks(html).map((p) => p.text);
  assert.ok(got.includes('가입 3,000P'));
  assert.ok(got.includes('앱 설치 2,000P'));
  assert.ok(got.includes('출석 최대 3,300P'));
  assert.ok(!got.includes('가입 5,000P'), 'adult lines are skipped');
});

test('merge keeps new phrases first and fills the rest from existing values', () => {
  const merged = mergePerks(
    [{ kind: 'event', text: '첫 결제 100원' }],
    [
      { kind: 'join', text: '가입 300P' },
      { kind: 'event', text: '출석 50P' },
      { kind: 'event', text: '친구 초대 1,000P' },
    ],
  );
  assert.deepEqual(merged.map((p) => p.text), ['가입 300P', '첫 결제 100원', '출석 50P']);
  assert.ok(samePerks(merged, [...merged].reverse()), 'order alone is not a change');
  const generic = mergePerks([{ kind: 'event', text: '페이백 이벤트', generic: '페이백' }], [{ kind: 'event', text: '정액권 100% 페이백' }]);
  assert.deepEqual(generic.map((p) => p.text), ['정액권 100% 페이백']);
});
