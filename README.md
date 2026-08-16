# 정비사업 정보 플랫폼

재개발·재건축 **구역(폴리곤)을 축으로** 실거래·매물·경매·진행단계·구역제원을 한 화면에 모아 보는 서비스.
[재개발닷컴](https://jaegebal.com) 벤치마크 분석 기반. 상세 기획은 [개발기획서](./재개발플랫폼_개발기획서.md) 참조.

- **지도**: 카카오맵 JavaScript SDK
- **프레임워크**: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4

---

## ⚠️ 시작 전 필수 — 카카오 도메인 등록

**이 단계를 건너뛰면 지도가 뜨지 않습니다.** SDK가 다음 오류로 차단됩니다.

```json
{ "errorType": "AccessDeniedError",
  "message": "domain mismatched! caller=http://localhost:3000. check out registered web domains." }
```

### 해결

1. [카카오 개발자 콘솔](https://developers.kakao.com/console/app) 접속
2. 해당 애플리케이션 선택 → 좌측 **앱 설정 > 플랫폼**
3. **Web 플랫폼 등록** → 사이트 도메인에 아래를 각각 추가

   ```
   http://localhost:3000
   ```

   배포 시 스테이징·운영 도메인도 **모두** 추가해야 합니다.
4. 저장 후 브라우저 **강력 새로고침**(Ctrl+Shift+R)

> JavaScript 키는 브라우저에 노출되는 것이 정상입니다. 그래서 **도메인 등록이 유일한 보호 장치**입니다.
> 등록하지 않으면 제3자가 키를 가져다 우리 쿼터(일 30만 건)를 소진시킬 수 있습니다.

### ❗ 가장 흔한 실수 — `github.com` 을 등록하는 것

Web 플랫폼 도메인 칸에는 **소스코드가 보관된 곳**이 아니라
**앱이 브라우저에서 실제로 열리는 주소**를 적어야 합니다.

| 입력 | 결과 |
|---|---|
| `https://github.com` | ❌ 효과 없음 — 여기서 앱이 실행되지 않습니다 |
| `https://taeli850410-lang.github.io` | ❌ 효과 없음 — Pages 미사용 |
| `http://localhost:3000` | ✅ 개발 중 필요한 주소 |
| 배포 도메인 (예: `https://xxx.vercel.app`) | ✅ 배포 후 추가 등록 |

지도가 안 뜰 때 앱이 **어떤 도메인이 등록됐고 어떤 게 빠졌는지 스스로 진단해서 보여줍니다.**
서버가 `/api/diag/kakao` 로 카카오에 직접 물어본 결과입니다.

---

## 실행

```bash
npm install
```

```bash
cp .env.example .env.local
```

`.env.local`에 카카오 키를 채웁니다.

```bash
npm run dev
```

http://localhost:3000

---

## 환경변수

| 변수 | 용도 | 노출 |
|---|---|---|
| `NEXT_PUBLIC_KAKAO_MAP_JS_KEY` | 웹 지도 SDK | **공개 전제** — 도메인 등록 필수 |
| `KAKAO_REST_API_KEY` | 주소검색·좌표변환·로그인 토큰 교환 | 🔴 **서버 전용** |
| `KAKAO_CLIENT_SECRET` | 카카오 로그인 | 🔴 **서버 전용** |
| `KAKAO_NATIVE_APP_KEY` | Android/iOS SDK | 앱 빌드 설정에만 |

`.env.local`은 `.gitignore`에 포함되어 커밋되지 않습니다.

---

## 구조

```
src/
├─ app/
│  ├─ page.tsx              지도 화면
│  └─ api/parcels/route.ts  필지(지적) bbox 조회 — 실제로는 PostGIS
├─ components/
│  ├─ MapView.tsx           카카오맵 전체 제어 (폴리곤·클러스터·드로잉·로드뷰·거리재기)
│  ├─ FilterBar.tsx         사업종류 15종 / 진행단계 12단계 필터
│  ├─ MapToolbar.tsx        레이어 토글 + 도구 패널
│  ├─ DevelopPanel.tsx      구역 상세 (진행현황·제원·노후도)
│  └─ Sidebar.tsx           구역 목록
└─ lib/
   ├─ kakaoLoader.ts        SDK 단일 로드 (쿼터 절감의 핵심)
   ├─ taxonomy.ts           사업종류·진행단계 분류 체계
   ├─ geo.ts                centroid / point-in-polygon / 노후도 색상
   └─ mock/develops.ts      목업 구역 데이터
```

---

## 구현된 기능

| 기능 | 구현 |
|---|---|
| 구역 폴리곤 + 라벨 | `kakao.maps.Polygon` + `CustomOverlay` |
| 사업종류/진행단계 필터 | 15종 / 12단계 (벤치마크 실측 택소노미) |
| 실거래 도트 클러스터링 | `MarkerClusterer` |
| **지적도 (필지 경계)** | **자체 벡터** — 아래 주의 참조 |
| 노후도 히트맵 | 필지별 사용승인연도 색상 |
| 물딱지 경보 | 권리산정기준일 이후 신축 필지 적색 점선 |
| 위성뷰 | `MapTypeId.HYBRID` |
| 용도지역 | `MapTypeId.USE_DISTRICT` (참고용) |
| 거리뷰 | `Roadview` + `RoadviewOverlay` |
| 거리재기 | `Polyline.getLength()` |
| 가상구역 드로잉 | `drawing.DrawingManager` |

### ⚠️ 지적도는 카카오가 제공하지 않습니다

카카오의 `USE_DISTRICT`는 **용도지역을 색으로 칠한 편집도**이지 **필지 경계선이 아닙니다.**
카카오 공식 고지도 *"지적 정보와 일치하지 않을 수 있으며 참고 외 용도로 사용 불가"*입니다.

또한 카카오맵은 자체 좌표계(WCONGNAMUL 기반) 타일 스킴을 쓰기 때문에,
V-World 등 **표준 Web Mercator XYZ 타일을 `kakao.maps.Tileset`에 얹으면 어긋납니다.**

그래서 이 프로젝트는 필지를 **벡터(GeoJSON)로 내려받아 `Polygon`으로 렌더**합니다.
LatLng 기반이라 투영에 무관하게 정확히 맞고, 필지별 클릭(PNU 획득)과 색상 제어도 가능합니다.

---

## 현재 상태

목업 데이터로 지도 렌더링까지 동작합니다. 실제 데이터 파이프라인(공공 API 수집,
구역 폴리곤 구축, PostGIS 공간조인)은 [기획서 PART 4](./재개발플랫폼_개발기획서.md) 참조.

---

## 면책

본 서비스가 제공하는 정보는 공개 데이터를 가공한 **참고용**이며, 법적 효력이 있는 정보는
반드시 원본 공부(등기부등본·건축물대장·고시문)로 확인해야 합니다.
본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.
