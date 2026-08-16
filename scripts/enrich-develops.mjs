/**
 * 구역 데이터 보강
 *  1) 자치구 — SIGNGU_SE 는 1,690건 중 1,163건이 '11000'(서울시 본청)이라 쓸 수 없다.
 *     구역 중심좌표를 카카오 좌표→행정구역 API로 역지오코딩해 채운다.
 *  2) 고시일 — 고시 일련번호(예: 11000NTC20240520 0001)에 날짜가 들어 있다.
 *     "최근 고시된 구역"(신규) 정렬에 쓴다.
 *
 * 실행: KAKAO_REST_API_KEY=... node scripts/enrich-develops.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const FILE = 'data/develops.seoul.json'
const CACHE = 'data/raw/region-cache.json'

const REST_KEY = process.env.KAKAO_REST_API_KEY
if (!REST_KEY) {
  console.error('KAKAO_REST_API_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

const develops = JSON.parse(readFileSync(FILE, 'utf-8'))
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}

let calls = 0
let failed = 0

async function regionOf(lng, lat) {
  const key = `${lng.toFixed(5)},${lat.toFixed(5)}`
  if (key in cache) return cache[key]

  const url =
    `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`
  try {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${REST_KEY}` } })
    calls++
    if (!res.ok) {
      cache[key] = null
      return null
    }
    const json = await res.json()
    // region_type 'B'(법정동) 우선, 없으면 첫 결과
    const doc = json.documents?.find((d) => d.region_type === 'B') ?? json.documents?.[0]
    const out = doc ? { gu: doc.region_2depth_name, dong: doc.region_3depth_name } : null
    cache[key] = out
    return out
  } catch {
    cache[key] = null
    return null
  }
}

/**
 * 고시 일련번호에서 고시일 추출.
 * 형식: 11000NTC20170608 8160  (시군구코드 + 3글자 구분 + YYYYMMDD + 일련번호)
 * 아무 데서나 8자리를 긁으면 뒤쪽 일련번호가 잡혀 2081년 같은 값이 나온다.
 * 반드시 구분자 바로 뒤 8자리만 쓰고, 연도 범위를 검증한다.
 */
const THIS_YEAR = 2026

function noticeDate(sn) {
  if (!sn) return null
  const m = String(sn).match(/[A-Z]{3}(\d{8})/)
  if (!m) return null

  const raw = m[1]
  const y = Number(raw.slice(0, 4))
  const mo = Number(raw.slice(4, 6))
  const d = Number(raw.slice(6, 8))

  if (y < 1970 || y > THIS_YEAR + 1) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null

  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
}

for (let i = 0; i < develops.length; i++) {
  const d = develops[i]
  const lng = (d.bbox[0] + d.bbox[2]) / 2
  const lat = (d.bbox[1] + d.bbox[3]) / 2

  const region = await regionOf(lng, lat)
  if (region) {
    d.gu = region.gu
    d.dong = region.dong
  } else {
    failed++
  }

  d.noticeDate = noticeDate(d.noticeSn)
  d.center = [Number(lng.toFixed(6)), Number(lat.toFixed(6))]

  if ((i + 1) % 200 === 0) {
    console.log(`  ${i + 1}/${develops.length} (API ${calls}회)`)
    mkdirSync('data/raw', { recursive: true })
    writeFileSync(CACHE, JSON.stringify(cache))
  }
}

mkdirSync('data/raw', { recursive: true })
writeFileSync(CACHE, JSON.stringify(cache))
writeFileSync(FILE, JSON.stringify(develops))

const byGu = new Map()
for (const d of develops) byGu.set(d.gu ?? '(미상)', (byGu.get(d.gu ?? '(미상)') ?? 0) + 1)
const withDate = develops.filter((d) => d.noticeDate).length

console.log(`\nAPI 호출 ${calls}회 / 역지오코딩 실패 ${failed}건`)
console.log(`자치구 확인 ${develops.length - failed}/${develops.length}`)
console.log(`고시일 확인 ${withDate}/${develops.length}`)
console.log('\n--- 자치구별 구역 수 (상위 10) ---')
for (const [k, v] of [...byGu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`${String(v).padStart(5)}  ${k}`)
}
