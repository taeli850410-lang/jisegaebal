# 정비맵 (jeongbi-map) — 작업 기준 문서

> 상위 명세(SSOT)는 사용자가 제공한 **「정비구역 통합 플랫폼 개발 명령 프롬프트」**.
> 이 파일은 그 요약 + 코딩 규칙 + Phase 체크리스트 + 결정 기록이다.
> 명세에 없는 사항은 **도시정비법 실무 관행** 기준으로 결정하고 §7에 남긴다.

---

## 1. 제품 한 줄

재개발·재건축·신속통합기획·모아타운 **정비구역을 1급 엔티티**로 삼아, 지도 위에서
실거래·매물·사업단계·권리분석을 통합 제공하는 웹 플랫폼. 사용자는 **개인 투자자**와
**정비구역 전문 공인중개사**(경량 워크스페이스) 두 종류.

## 2. 반드시 지키는 8원칙

| # | 원칙 | 구현상 의미 |
|---|---|---|
| 1 | **구역 = 1급 엔티티** | 모든 물건·실거래·매물·문서는 `zones`에 종속. 매물이 최상위가 아니다 |
| 2 | **사업단계는 시계열** | 현재 단계만이 아니라 `zone_stage_history`(날짜·근거)를 저장, "진행 속도" 산출 |
| 3 | **권리분석은 시뮬레이터** | 감정가·비례율·분담금은 입력 즉시 재계산되는 인터랙티브 도구. **정적 표 금지** |
| 4 | **구분항목 사용자 정의** | 사업유형·단계·물건종류·권리종류·규제라벨은 `codes` 테이블 CRUD |
| 5 | **구역-내-상대적 위치** | 개별 매물은 "얼마"보다 "구역 내 감정가 상위 몇 %"가 핵심 가치 |
| 6 | **가상구역** | 사용자가 그린 폴리곤 안의 실거래·공시가를 자동 집계 |
| 7 | **중개사 기능은 경량** | 담당구역·상담고객·브리핑자료만. 계약서 7종·회계는 **v2 이연** |
| 8 | **데이터 신뢰도 표시** | 모든 수치 옆에 출처·갱신일. 추정치는 "추정" 배지 |

## 3. 기술 스택

| 레이어 | 선택 |
|---|---|
| 프론트 | React 18 + TypeScript(strict) + **Vite** ※§7 D-01 확인 필요 |
| UI | Tailwind CSS + shadcn/ui, Pretendard |
| 상태 | TanStack Query(서버) + zustand(UI) |
| 폼·검증 | react-hook-form + zod |
| 표·차트·날짜 | TanStack Table / Recharts / date-fns |
| 백엔드 | **Supabase** (Postgres + **PostGIS** + Auth + Storage + RLS) |
| 지도 | Kakao Maps JS SDK + **VWorld 지적편집도 WMS**(가상구역 배경) |
| 외부 데이터 | ho-finder(공시가격), vworld MCP(지오코딩·용도지역·지적), 국토부 실거래가 API |
| 진행현황 원천 | 서울시 정비사업 정보몽땅(클린업) + 관리자 수기 입력 |
| 배포 | Vercel |

**데이터 엔진 재사용 원칙**: ho-finder / vworld MCP는 **신규 개발 금지**, 기존 엔드포인트 호출.

## 4. 코딩 규칙

- TypeScript **strict**, `any` 금지. 도메인 타입은 `supabase gen types` 산출물 기준
- 데이터 접근은 **어댑터로 추상화** → Supabase 키 없을 때 목데이터 모드로 UI 진행 가능
- 마이그레이션은 `supabase/migrations/` 순번 관리, 초기값은 `supabase/seed.sql`
- 모든 테이블: `id uuid PK default gen_random_uuid()`, `created_at`, `updated_at`, `deleted_at`(soft delete)
- 금액은 **만원 단위 정수** 저장(명세 §2.4/2.5 준수), 표시할 때 억/만원 병기 + `tabular-nums`
- 면적은 **㎡ 저장**, 평은 표시 시 환산(`/ 3.3058`)
- 커밋: conventional commits, 기능 단위

### 단위 테스트 필수 유틸 (§9)

- 대지지분/면적 환산
- 프리미엄 분해 (`호가 − 감정가(또는 추정 대지가치)`)
- 비례율·권리가액·추가분담금 계산식
- 감정가 percentile
- 지오메트리(폴리곤 내 좌표 판정)

## 5. 환경변수

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_KAKAO_MAP_KEY=            # JS 키 — 도메인 등록 필수
VITE_VWORLD_API_KEY=
KAKAO_REST_API_KEY=            # 서버 전용
DATA_GO_KR_SERVICE_KEY=        # 국토부 실거래가, 서버 전용
```

> 🔴 REST 키는 **절대 클라이언트 번들에 넣지 않는다**. Vite는 `VITE_` 접두사만 노출되므로
> 서버 키는 Supabase Edge Function 또는 별도 서버 라우트에서만 사용한다.

## 6. Phase 체크리스트

- [ ] **P1 기반** — Vite 셋업 / Supabase 스키마(PostGIS) + RLS + 코드 시드 / Auth / 지도 홈 뼈대 / 설정>구분항목 관리
- [ ] **P2 구역 데이터** — `zones`·`zone_stage_history` 확정, 서울 주요 구역 20~30개 시드, 구역 상세(개요·단계 타임라인)
- [ ] **P3 물건·실거래** — ho-finder/vworld로 `zone_units` 채우기, 국토부 실거래 연동 + 구역 매칭 배치, 감정 순위 percentile 뷰
- [ ] **P4 매물·알림** — `listings` CRUD, 사진 업로드, `zone_watchlist`·`alerts`, 신규매물/단계변경 트리거
- [ ] **P5 가상구역** — 지적편집도 레이어, 폴리곤 드로잉, 필지 자동 수집 배치, 관리자 승인 큐
- [ ] **P6 시뮬레이터** — `rights_simulations`, `bijul_presets`, 실시간 계산 + 공유링크
- [ ] **P7 중개사 워크스페이스** — offices/assignments/consult_customers/briefing_documents
- [ ] **P8 관리자 대시보드 & 마감** — 운영 KPI, 반응형·접근성, 데모 시드(구역 30·매물 100·실거래 300·시뮬 20)

**Phase 완료 보고 형식**: ① 만든 것 ② 확인 방법(경로/시나리오) ③ 다음 Phase 계획.

## 7. 결정 기록 (Decision Log)

| ID | 사안 | 결정 | 근거 |
|---|---|---|---|
| **D-01** | 프론트 스택: 명세는 Vite SPA인데 현행 코드는 Next.js 16 | **사용자 확인 대기** | Vite SPA는 서버 라우트가 없어 국토부·카카오 REST 키를 숨길 수 없다. 현행 Next.js는 이미 서버 라우트로 은닉 중. 아래 §8 자산 참조 |
| D-02 | 금액 단위 | **만원 단위 정수** | 명세 §2.4 `asking_price(만원)`, §2.5 `price(만원)` 명시 |
| D-03 | 사업단계 코드 체계 | 명세 §2.1 12단계를 `codes`에 시드하되, 지자체 원본 라벨은 `zone_stage_history.source_note`에 원문 보존 | 정비몽땅 원본 라벨이 유형별로 달라(모아타운=관리계획고시 등) 1:1 매핑 불가 |
| D-04 | 소유자 개인정보 | `unit_owners`에 **실명·연락처 저장 안 함**. 유형·거주여부만 | 명세 §6, 개인정보 리스크 최소화 |
| D-05 | 감정가 없는 구역(관리처분 전) | `공시가격 × 지역 평균 배율`로 **추정 감정가** + "추정" 배지 | 명세 §4.3, 원칙 8 |
| D-06 | 실거래↔구역 매칭 | 지번 지오코딩 후 **PostGIS `ST_Contains`** 공간조인. 실패 건은 `unmatched_trades` 큐 | 명세 §2.5. 국토부 응답에 좌표가 없음 |
| D-07 | 가상구역 공개 | 관리자 승인 전까지 `is_draft=true`로 비공개 | 명세 §6 |

## 8. 이미 확보한 자산 (재사용 대상 — 다시 만들지 말 것)

현행 Next.js 앱에서 실데이터로 검증 완료된 것들. 스택을 바꾸더라도 **데이터와 스크립트는 그대로 이전**한다.

| 자산 | 내용 | 위치 |
|---|---|---|
| 구역 경계 | 서울 **1,690개** 정비구역 폴리곤 (EPSG:5174→WGS84 변환 완료) | `data/develops.seoul.json` |
| 변환 스크립트 | 의제처리구역 SHP → GeoJSON | `scripts/convert-shp.mjs` |
| 사업단계 | 정비몽땅 1,150 사업장 → **523개 구역** 매칭 (매칭방식·신뢰도 포함) | `data/stages.seoul.json`, `scripts/build-stages.mjs` |
| 자치구·고시일 | 1,690/1,690 자치구, 1,600건 고시일 | `scripts/enrich-develops.mjs` |
| 지번 좌표 캐시 | **13,657건** (실거래↔구역 공간조인의 핵심) | `data/jibun-cache.json`, `scripts/build-jibun-cache.mjs` |
| 실거래 연동 | 국토부 연립다세대·단독·토지 + 대지지분/대지평당가 산출 | `src/lib/server/molit.ts` |
| 구역별 실거래 집계 | 지오코딩 → 공간조인 → 중앙 평당가·전기간 대비·6개월 추이 | `src/app/api/zone-transactions/route.ts` |
| 가상구역 드로잉 | Kakao Drawing 폴리곤 + 면적 산출 (동작 확인) | `src/components/MapView.tsx` |
| 택소노미 | 사업종류 15종 / 진행단계 12단계 + 단계별 색상 | `src/lib/taxonomy.ts` |

> 이 자산들은 명세의 **P2·P3·P5 상당 부분을 이미 충족**한다. Supabase 이전 시
> `zones`/`zone_stage_history`/`trades` 시드로 그대로 투입한다.

## 9. 면책 (상시 노출 문구)

- 시뮬레이터: "본 계산은 사용자 입력 가정치 기반 참고용이며 조합 확정치와 다를 수 있습니다"
- 구역 경계·단계: 참고자료이며 법적 효력 없음. 원본 공부(등기부·건축물대장·고시문)로 확인
- 본 서비스는 **중개·감정평가·투자자문을 제공하지 않는다**
