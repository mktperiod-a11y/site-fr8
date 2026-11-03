// Labels shown on the site. CRITERIA is the single list of metric names the pages may mention.

export const CRITERIA = {
  perks: { label: '혜택 경쟁력', desc: '가입 혜택의 크기와 진행 중인 이벤트 수를 함께 봐요.' },
  web_rank: { label: '웹 이용 규모', desc: '웹사이트를 찾는 이용자가 얼마나 많은지 봐요.' },
  web_trend: { label: '웹 관심 상승세', desc: '요즘 들어 찾는 사람이 늘고 있는지 봐요.' },
  app_installs: { label: '앱 이용 규모', desc: '안드로이드 앱이 얼마나 설치됐는지 봐요.' },
};

/** Names that must not appear unless they are part of the current calculation. */
export const RETIRED_LABELS = ['검색 관심도', '검색 관심도 상승세', '실시간', '클릭 수', '회원 수'];

export function labelsNotInUse(criteria) {
  const used = new Set(criteria.map((k) => CRITERIA[k]?.label));
  return [...Object.values(CRITERIA).map((c) => c.label), ...RETIRED_LABELS].filter((l) => !used.has(l));
}

export const CADENCE = {
  daily: { word: '매일', next: 1 },
  weekly: { word: '매주', next: 7 },
};

export const EMPTY = '공식 사이트에서 확인하세요.';
