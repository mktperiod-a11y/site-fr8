// Turns raw page text into short perk phrases ("조건 + 혜택").
import { perkProblems } from './perks.mjs';

const SKIP = /성인|19금|에로|AV|노출|요금|정액|가격표|원\/월|VAT|부가세/;

function pageTexts(html) {
  const out = [];
  for (const m of html.matchAll(/\b(?:alt|title)\s*=\s*"([^"]{2,80})"/gi)) out.push(m[1]);
  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&');
  for (const line of body.split(/\n+/)) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (t.length >= 4 && t.length <= 60) out.push(t);
  }
  return out;
}

const num = (s) => Number(String(s).replace(/,/g, ''));
const fmt = (n) => n.toLocaleString('en-US');
const unitOf = (u) => (!u ? 'P' : /B/i.test(u) ? 'B' : 'P');

const RULES = [
  {
    kind: 'join',
    re: /(?:신규\s*)?(?:회원\s*)?가입\s*(?:시|즉시|하면|만\s*해도)?\s*(?:바로\s*)?(?:무료\s*)?([\d,]{3,6})\s*(P|B|포인트|캐시|쿠키|보너스)/i,
    make: (m) => `가입 ${fmt(num(m[1]))}${unitOf(m[2])}`,
  },
  {
    kind: 'join',
    re: /본인\s*인증\s*(?:시|하면)?\s*([\d,]{3,6})\s*(P|B|포인트|보너스)/i,
    make: (m) => `본인인증 ${fmt(num(m[1]))}${unitOf(m[2])}`,
  },
  {
    kind: 'event',
    re: /앱\s*(?:설치|다운로드?)\s*(?:시|하면)?\s*([\d,]{3,6})\s*(P|B|포인트)/i,
    make: (m) => `앱 설치 ${fmt(num(m[1]))}${unitOf(m[2])}`,
  },
  { kind: 'event', re: /앱\s*설치\s*(?:시)?\s*쿠폰\s*(\d)\s*장/, make: (m) => `앱 설치 쿠폰 ${m[1]}장` },
  {
    kind: 'event',
    re: /출석\s*(?:체크)?\s*(?:시)?\s*(최대)?\s*([\d,]{2,6})\s*(P|B|포인트)/i,
    make: (m) => `출석 ${m[1] ? '최대 ' : ''}${fmt(num(m[2]))}${unitOf(m[3])}`,
  },
  { kind: 'event', re: /첫\s*결제\s*100\s*원/, make: () => '첫 결제 100원' },
  { kind: 'event', re: /첫\s*달\s*100\s*원/, make: () => '첫 달 100원' },
  { kind: 'event', re: /(\d{1,2})\s*배\s*적립/, make: (m) => `결제 ${m[1]}배 적립` },
  { kind: 'event', re: /페이\s*백/, make: () => '페이백 이벤트', generic: '페이백' },
  {
    kind: 'event',
    re: /친구\s*초대\s*(?:시)?\s*([\d,]{3,6})\s*(P|B|포인트)/i,
    make: (m) => `친구 초대 ${fmt(num(m[1]))}${unitOf(m[2])}`,
  },
];

export function extractPerks(html) {
  const found = [];
  const seen = new Set();
  for (const t of pageTexts(html)) {
    if (SKIP.test(t)) continue;
    for (const r of RULES) {
      const m = t.match(r.re);
      if (!m) continue;
      const p = { kind: r.kind, text: r.make(m), ...(r.generic ? { generic: r.generic } : {}) };
      const key = p.kind + '|' + p.text;
      if (!seen.has(key) && !perkProblems(p).length) {
        seen.add(key);
        found.push(p);
      }
    }
  }
  return found;
}

/** New phrases first (1 join, 2 events), remaining slots filled with existing values. */
export function mergePerks(found, existing) {
  const fresh = found.filter((p) => !p.generic || !existing.some((q) => q.text.includes(p.generic)));
  const pick = (kind, max) => {
    const out = [];
    for (const p of [...fresh, ...existing]) {
      if (p.kind === kind && out.length < max && !out.some((q) => q.text === p.text)) out.push({ kind, text: p.text });
    }
    return out;
  };
  return [...pick('join', 1), ...pick('event', 2)];
}

/** Order-insensitive comparison. */
export function samePerks(a, b) {
  const k = (l) => l.map((p) => p.kind + '|' + p.text).sort().join('\n');
  return k(a) === k(b);
}
