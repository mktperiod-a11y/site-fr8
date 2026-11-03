// Perk text helpers shared by collection, scoring, build and tests.

export const PERK_MAX_CHARS = 16;
const BAD_TAIL = /(지급|진행\s*중|진행중|시)$/;

/** Returns a list of problems with one perk entry (empty when valid). */
export function perkProblems(p) {
  const out = [];
  if (!p || (p.kind !== 'join' && p.kind !== 'event')) out.push('kind');
  const t = String(p?.text ?? '');
  if (!t.trim()) out.push('empty');
  if ([...t].length > PERK_MAX_CHARS) out.push('length');
  if (BAD_TAIL.test(t.trim())) out.push('tail');
  if (/[!！~]/.test(t)) out.push('mark');
  return out;
}

/** Point size of a join perk such as "가입 1,000P" (0 when no point figure). */
export function joinPoints(text) {
  const m = String(text).match(/([\d,]+)\s*(P|B|포인트|캐시|쿠키)/i);
  return m ? Number(m[1].replace(/,/g, '')) : 0;
}

export function perkFigures(perks) {
  const joins = perks.filter((p) => p.kind === 'join');
  const events = perks.filter((p) => p.kind === 'event');
  return {
    join: joins.reduce((m, p) => Math.max(m, joinPoints(p.text)), 0),
    events: Math.min(events.length, 2),
    count: joins.length + events.length,
  };
}

// Groups used by the perk pages. A group shows only when 2+ vendors match.
export const PERK_GROUPS = [
  { slug: 'join-point', label: '가입 포인트', test: (p) => p.kind === 'join' && joinPoints(p.text) > 0 },
  { slug: '100won', label: '100원 이용', test: (p) => /100원/.test(p.text) },
  { slug: 'payback', label: '페이백·적립', test: (p) => /페이백|적립|배/.test(p.text) },
  { slug: 'app', label: '앱 설치 혜택', test: (p) => /앱 설치/.test(p.text) },
  { slug: 'attend', label: '출석·참여', test: (p) => /출석|리뷰|친구|팔로우/.test(p.text) },
];
