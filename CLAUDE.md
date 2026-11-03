# 작업 메모

정적 사이트. 의존성 없는 Node 스크립트로 `data/` → `_site/`를 만들고 GitHub Actions로 Pages에 배포한다.
이미지 처리(sharp)와 화면 검사(Playwright)만 개발 의존성이다.

## 명령

| 할 일 | 명령 |
|---|---|
| 의존성 설치 | `npm ci` |
| 지표 수집 | `npm run collect` (`data/metrics.json`에 스냅숏 추가) |
| 순위 계산 | `npm run score` (환경 변수 `SCORE_PROFILE` 필요, 로컬 미리보기는 `--profile <파일> --out .out/preview`) |
| 혜택 문구 읽기 | `npm run perks` (바뀐 곳만 `data/vendors.json` 수정) |
| 업체 아이콘·로고 받기 | `npm run assets [업체id ...]` (원본은 `.cache/raw`, 결과만 `static/v`) |
| 빌드 | `npm run build` (미리보기는 `RANKING_FILE=.out/preview/ranking.json npm run build`) |
| 규칙 테스트 | `npm test` |
| 화면 검사 | `npm run view` (5개 폭 × 실제·극단 데이터, 스크린샷은 `.out/shots`) |
| 공개 정보 검사 | `npm run scan` (`DENY_LIST`, `LEAK_LIST` 환경 변수, 줄바꿈 구분) |

검사 명령 출력을 자를 때는 `set -o pipefail`로 종료 코드를 지킨다.

## 폴더

- `data/vendors.json` 업체 목록. `status`: `active` | `excluded`(데이터만 보관, 화면·계산 제외) | `pending`(확인 대기)
- `data/metrics.json` `web`: 업체별 날짜→웹 순위(최근 70일), `snapshots`: 수집 회차별 상태와 값(최근 90회)
  - 값 상태 `s`: `ok` | `absent`(값이 없음, 0점) | `carried`(조회 실패, 직전 값) | `missing`(조회 실패, 직전 값도 없음 → 가운데 값)
- `data/ranking.json` 최신 결과, `data/history.json` 결과 기록(최근 90회), `data/baseline.json` 첫 결과
- `data/profile.sha256` 허용하는 계산 설정 해시(한 줄에 하나)
- `data/site.json` 브랜드 이름, 첫 화면 안내 문장, FAQ, 체크리스트, 공유 이미지 문구
- `scripts/` 빌드(`delta.mjs`), 수집(`lumen.mjs`), 계산(`spruce.mjs`, `lib/score.mjs`), 혜택(`harbor.mjs`),
  자산(`kite.mjs`), 공개 정보 검사(`birch-ledger.mjs`), HTML 출력(`lib/html.mjs`)
- `static/` 그대로 `_site/a/`로 복사(CSS·JS 주석은 빌드 때 제거)
- `tests/` 규칙 테스트(`*.test.mjs`), 화면 검사(`view.mjs`), 극단 데이터 생성(`lib/fixtures.mjs`)
- `.github/workflows/` `marble.yml` 검사, `flint.yml` 정기 갱신·배포, `sieve.yml` 혜택 문구 PR

## 데이터 형식

- 혜택: `{ "kind": "join" | "event", "text": "가입 1,000P" }`, 가입 1개·이벤트 2개까지, 16자 이내, 꼬리말 없음
- 결과 행: `{ id, rank, prev, isNew, total, stars, items }` — `items` 합 = `total`, 항목마다 최대치 이하
- 화면에 쓰는 기준 이름은 `scripts/lib/site.mjs`의 `CRITERIA` 한 곳에서만 정한다.

## 디자인 변수 (`static/site.css` `:root`)

- `--va-key` 마크·순위 숫자·포커스·현재 탭 밑줄·선택 칩 테두리
- `--va-key-strong` 19px 굵게 이상의 큰 글자, `--va-key-ink` 작은 글자(변동 표시·혜택 칩), `--va-key-tint` 옅은 바탕
- `--va-bg` `--va-card` `--va-surface` `--va-line` `--va-line-strong` `--va-text` `--va-sub` `--va-faint`
- `--va-btn` 채운 버튼(화면당 하나), `--va-btn2` 연한 버튼, `--va-radius` `--va-radius-lg` `--va-gap` `--va-block`
- 클래스는 `va-` 접두사. 호버·포커스는 `::after` 덧칠(투명도)만 바꾼다.

## 검사 목록

- 공개 10곳, 항목 합 = 총점, 항목 ≤ 최대치, 결과 행에 다른 칸 없음, 같은 입력 = 같은 순위
- 혜택 문구 규칙, 남은 주소 자리표시·주석·140칸 넘는 줄 없음, 인라인 style·script 한 줄 + CSP 해시
- 404 첫 화면 링크, 모든 "사이트 확인" → 실제 이동 페이지, 주소 없는 업체는 이동 페이지 없음
- 쓰지 않는 기준 이름이 화면·`llms.txt`·공유 이미지 문구에 없음
- 화면: 가로 스크롤·콘솔 오류·CSP 위반·깨진 이미지·링크 0, 대비 AA, 누르는 영역 44px, 짧은 라벨 한 줄,
  360×780 첫 화면에 갱신일과 1~3위, 1~3위는 4위와 두 가지 이상 다름, 자바스크립트 없이도 동작
