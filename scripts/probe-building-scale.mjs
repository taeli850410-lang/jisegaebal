/**
 * 노후도 계산 규모 산정 (일회성 조사)
 *
 * 건축물대장은 법정동 단위 대량조회가 되지만, 대장에는 좌표가 없어
 * 구역 경계 안/밖을 가르려면 지번을 지오코딩해야 한다.
 * 그 비용이 감당 가능한지 실제 법정동 몇 곳으로 재본다.
 */
import { readFileSync } from 'node:fs'

const KAKAO = process.env.KAKAO_REST_API_KEY
const DGK = process.env.DATA_GO_KR_SERVICE_KEY
if (!KAKAO || !DGK) {
  console.error('키 필요')
  process.exit(1)
}

// 단계는 stages.seoul.json 에 따로 있다 (런타임 병합 구조)
const staged = new Set(
  JSON.parse(readFileSync('data/stages.seoul.json', 'utf-8')).map((s) => s.developId),
)
const zones = JSON.parse(readFileSync('data/develops.seoul.json', 'utf-8')).filter(
  (z) => staged.has(z.id) && z.center,
)
console.log(`단계 있는 구역: ${zones.length}개`)

// 표본 8개 구역의 법정동을 본다
const sample = zones.slice(0, 8)
const dongCodes = new Map()

for (const z of sample) {
  const [x, y] = z.center
  const r = await fetch(
    `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${x}&y=${y}`,
    { headers: { Authorization: `KakaoAK ${KAKAO}` } },
  ).then((r) => r.json())
  const b = r.documents?.find((d) => d.region_type === 'B') ?? r.documents?.[0]
  if (!b?.code) continue

  const code = b.code
  if (dongCodes.has(code)) continue

  const u =
    `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo?serviceKey=${DGK}` +
    `&sigunguCd=${code.slice(0, 5)}&bjdongCd=${code.slice(5, 10)}&numOfRows=1&pageNo=1&_type=json`
  try {
    const j = await fetch(u).then((r) => r.json())
    const cnt = j?.response?.body?.totalCount ?? 0
    dongCodes.set(code, cnt)
    console.log(`  ${z.name.slice(0, 16).padEnd(18)} ${b.region_3depth_name} (${code}) → ${cnt}동`)
  } catch (e) {
    console.log(`  ${z.name.slice(0, 16)} 오류`)
  }
}

const counts = [...dongCodes.values()]
const avg = counts.reduce((a, b) => a + b, 0) / (counts.length || 1)
console.log(`\n표본 법정동 ${counts.length}곳 평균 ${Math.round(avg)}동`)

// 전체 규모 추정: 단계 있는 구역이 걸치는 법정동 수를 대략 구역수/2 로 본다
const estDong = Math.round(zones.length / 2)
console.log(`추정: 법정동 약 ${estDong}곳 × ${Math.round(avg)}동 = 건물 약 ${(estDong * avg / 1000).toFixed(0)}천 건`)
console.log(`지오코딩 필요량(지번 중복 제외 60% 가정): 약 ${Math.round((estDong * avg * 0.6) / 1000)}천 건`)
console.log(`카카오 로컬 일 쿼터 10만건 기준 ${((estDong * avg * 0.6) / 100000).toFixed(1)}일치`)
