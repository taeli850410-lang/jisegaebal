/**
 * 공동주택 공시가격 캐시 예열.
 *
 * 왜 필요한가
 *   V-World 는 로컬(국내)에서는 정상 응답하는데 Vercel 에서는 502 를 돌려준다.
 *   필지(WFS)도 운영에서 목업으로 떨어지는 걸 확인했다. 즉 배포 환경에서는
 *   V-World 를 실시간으로 부를 수 없다.
 *
 *   그래서 구역 통계와 같은 방식을 쓴다 — 여기서 미리 받아 커밋하고,
 *   운영은 캐시만 읽는다.
 *
 * 대상
 *   data/jibun-cache.json 의 지번들. 실거래에 실제로 등장해 지오코딩까지 된
 *   지번이라, 화면에 나올 수 있는 것과 정확히 같은 집합이다.
 *
 * 실행: node scripts/warm-house-price.mjs [--limit 5000]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const VKEY = process.env.VWORLD_API_KEY
const KAKAO = process.env.KAKAO_REST_API_KEY
const DOMAIN = process.env.VWORLD_DOMAIN ?? 'https://jisegaebal.vercel.app'
if (!VKEY || !KAKAO) {
  console.error('VWORLD_API_KEY / KAKAO_REST_API_KEY 필요')
  process.exit(1)
}

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const LIMIT = Number(arg('--limit', '20000'))

const OUT = 'data/house-price-cache.json'
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pad4 = (v) => String(Number(v) || 0).padStart(4, '0')
const isBasement = (ho) => /지층|지하|^B|^b\d/.test(String(ho).trim())

async function resolvePnu(query) {
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(300 * a)
    try {
      const r = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `KakaoAK ${KAKAO}` } },
      )
      if (r.status === 429 || r.status >= 500) continue
      if (!r.ok) return null
      const a2 = (await r.json()).documents?.[0]?.address
      if (!a2?.b_code) return null
      const san = a2.mountain_yn === 'Y' ? '2' : '1'
      return `${a2.b_code}${san}${pad4(a2.main_address_no)}${pad4(a2.sub_address_no || 0)}`
    } catch {
      /* 재시도 */
    }
  }
  return null
}

/** {ok, lot} — 실패와 "자료 없음"을 구분한다 (실패를 캐시하면 영구히 빈다) */
async function fetchLot(pnu) {
  const url =
    `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?key=${VKEY}` +
    `&domain=${encodeURIComponent(DOMAIN)}&format=json&numOfRows=1000&pageNo=1&pnu=${pnu}`
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(500 * a)
    try {
      const r = await fetch(url)
      if (!r.ok) {
        if (r.status < 500) return { ok: true, lot: null }
        continue
      }
      const t = await r.text()
      if (!t.trimStart().startsWith('{')) continue
      const j = JSON.parse(t)
      const b = j[Object.keys(j)[0]]
      if (b?.resultCode === 'INCORRECT_KEY') {
        console.error('키 권한 오류 — 중단합니다.')
        process.exit(1)
      }
      const raw = b?.field
      if (!raw) return { ok: true, lot: null }
      const rows = Array.isArray(raw) ? raw : [raw]

      let year = 0
      for (const x of rows) {
        const y = Number(x.stdrYear)
        if (Number.isFinite(y) && y > year) year = y
      }
      if (!year) return { ok: true, lot: null }

      const units = []
      const seen = new Set()
      for (const x of rows) {
        if (Number(x.stdrYear) !== year) continue
        const ar = Number(x.prvuseAr)
        const pc = Number(x.pblntfPc)
        if (!(ar > 0 && pc > 0)) continue
        const ho = String(x.hoNm ?? '')
        const k = `${ho}|${ar}|${pc}`
        if (seen.has(k)) continue
        seen.add(k)
        units.push([ar, pc, isBasement(ho)])
      }
      return { ok: true, lot: units.length ? { year, units } : null }
    } catch {
      /* 재시도 */
    }
  }
  return { ok: false }
}

/* jibun-cache 키 형식: "서울 강동구 성내동 47-16" */
const jibun = JSON.parse(readFileSync('data/jibun-cache.json', 'utf-8'))
const targets = []
for (const key of Object.keys(jibun)) {
  const m = key.match(/^서울\s+(\S+구)\s+(\S+)\s+(.+)$/)
  if (!m) continue
  const lotKey = `${m[1]}|${m[2]}|${m[3]}`
  if (lotKey in cache) continue
  targets.push({ lotKey, query: key })
  if (targets.length >= LIMIT) break
}

console.log(`대상 ${targets.length.toLocaleString()}지번 (기존 ${Object.keys(cache).length.toLocaleString()}건)`)

let done = 0
let hit = 0
let failed = 0
const C = 4

for (let i = 0; i < targets.length; i += C) {
  const slice = targets.slice(i, i + C)
  const res = await Promise.all(
    slice.map(async (t) => {
      const pnu = await resolvePnu(t.query)
      if (!pnu) return { ok: false }
      return fetchLot(pnu)
    }),
  )
  slice.forEach((t, k) => {
    done++
    if (!res[k].ok) {
      failed++
      return // 실패는 캐시에 남기지 않는다
    }
    cache[t.lotKey] = res[k].lot
    if (res[k].lot) hit++
  })

  if (done % 200 === 0 || i + C >= targets.length) {
    mkdirSync('data', { recursive: true })
    writeFileSync(OUT, JSON.stringify(cache))
    console.log(
      `  ${done.toLocaleString()}/${targets.length.toLocaleString()} · 공시가격 보유 ${hit.toLocaleString()} · 미확정 ${failed}`,
    )
  }
  await sleep(80)
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(cache))
const withData = Object.values(cache).filter(Boolean).length
console.log(
  `\n완료: ${Object.keys(cache).length.toLocaleString()}지번 / 공시가격 있음 ${withData.toLocaleString()} · 이번 실패 ${failed}`,
)
