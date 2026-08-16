/**
 * 실거래 지번 → 좌표 캐시 구축.
 *
 * 국토부 실거래 응답에는 좌표가 없어 구역 폴리곤과 붙이려면 지오코딩이 필요하다.
 * 지번 좌표는 변하지 않으므로 한 번 만들어 두면 계속 재사용된다.
 * (런타임에 즉석 조회하면 첫 요청이 느리고 커버리지도 떨어진다)
 *
 * 실행: KAKAO_REST_API_KEY=... DATA_GO_KR_SERVICE_KEY=... node scripts/build-jibun-cache.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const CACHE = 'data/jibun-cache.json'
const MONTHS = 6

const SEOUL_LAWD = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
}

const ENDPOINTS = [
  ['villa', 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade'],
  ['house', 'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade'],
  ['land', 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade'],
]

const KAKAO = process.env.KAKAO_REST_API_KEY
const MOLIT = process.env.DATA_GO_KR_SERVICE_KEY
if (!KAKAO || !MOLIT) {
  console.error('KAKAO_REST_API_KEY 와 DATA_GO_KR_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}
console.log(`기존 캐시 ${Object.keys(cache).length}건`)

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))
  return m?.[1]?.trim() ?? ''
}

async function jibunsOf(gu, lawd) {
  const now = new Date()
  const yms = []
  for (let i = 0; i < MONTHS; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    yms.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const out = new Set()
  for (const [, url] of ENDPOINTS) {
    for (const ym of yms) {
      try {
        const res = await fetch(
          `${url}?serviceKey=${MOLIT}&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`,
        )
        if (!res.ok) continue
        const xml = await res.text()
        for (const b of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
          const dong = tag(b, 'umdNm')
          const jibun = tag(b, 'jibun')
          if (dong && jibun) out.add(`서울 ${gu} ${dong} ${jibun}`)
        }
      } catch {
        /* 건너뛴다 */
      }
    }
  }
  return [...out]
}

async function geocode(q) {
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}`,
      { headers: { Authorization: `KakaoAK ${KAKAO}` } },
    )
    if (!res.ok) return null
    const j = await res.json()
    const d = j.documents?.[0]
    return d ? [Number(d.x), Number(d.y)] : null
  } catch {
    return null
  }
}

let added = 0
let hit = 0

for (const [gu, lawd] of Object.entries(SEOUL_LAWD)) {
  const list = await jibunsOf(gu, lawd)
  const todo = list.filter((q) => !(q in cache))
  process.stdout.write(`${gu}: 지번 ${list.length}건 (신규 ${todo.length}) `)

  const C = 8
  for (let i = 0; i < todo.length; i += C) {
    const slice = todo.slice(i, i + C)
    const res = await Promise.all(slice.map(geocode))
    slice.forEach((q, k) => {
      cache[q] = res[k]
      added++
      if (res[k]) hit++
    })
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(CACHE, JSON.stringify(cache))
  console.log(`→ 누적 ${Object.keys(cache).length}건`)
}

const resolved = Object.values(cache).filter(Boolean).length
console.log(`\n완료: 총 ${Object.keys(cache).length}건 / 좌표 확보 ${resolved}건`)
console.log(`이번 실행 신규 ${added}건 (성공 ${hit}건)`)
