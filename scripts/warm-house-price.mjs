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
 *   기본은 data/jibun-cache.json — 실거래에 등장해 지오코딩까지 된 지번이다.
 *
 *   그런데 그 집합은 좁다. 실거래가 없던 건물은 영영 안 채워진다.
 *   실제로 용산구는 공동주택 3,346지번 중 666개(20%)만 차 있었다.
 *   나머지는 화면에서 "공시가 없음"으로 보이는데, 근생이라 정말 없는 것과
 *   구별이 안 된다.
 *
 *   --source building 을 주면 건축물대장 색인에서 공동주택이 있는 지번을
 *   전부 대상으로 삼는다. --gu 로 좁힐 수 있다.
 *
 * 실행
 *   node scripts/warm-house-price.mjs --limit 5000
 *   node scripts/warm-house-price.mjs --source building --gu 용산구 --limit 400
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
const SOURCE = arg('--source', 'jibun')
const ONLY_GU = arg('--gu', '')

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

const targets = []

if (SOURCE === 'building') {
  /*
   * 건축물대장 색인에서 공동주택이 있는 지번만 고른다.
   * 단독·근생만 있는 지번은 공동주택가격 자체가 없어 부를 이유가 없다 —
   * 괜히 부르면 남의 API 만 때리고 빈 값을 캐시하게 된다.
   */
  const { gunzipSync } = await import('node:zlib')
  const HOUSE = /공동주택|다세대|연립|아파트/
  let bi
  try {
    bi = JSON.parse(gunzipSync(readFileSync('data/building-slim.json.gz')).toString('utf-8'))
  } catch {
    console.error('data/building-slim.json.gz 가 필요합니다 (npm run build:slim-index)')
    process.exit(1)
  }
  for (const [key, v] of Object.entries(bi)) {
    const [gu, dong, num] = key.split('|')
    if (!gu || !dong || !num) continue
    if (ONLY_GU && gu !== ONLY_GU) continue
    if (!HOUSE.test((v.b ?? []).map((r) => r[0]).join(' '))) continue
    const bon = Number(num.slice(0, 4))
    const bu = Number(num.slice(4))
    const jb = bu ? bon + "-" + bu : String(bon)
    const lotKey = gu + "|" + dong + "|" + jb
    if (lotKey in cache) continue
    targets.push({ lotKey, query: "서울 " + gu + " " + dong + " " + jb })
    if (targets.length >= LIMIT) break
  }
} else {
  /* jibun-cache 키 형식: "서울 강동구 성내동 47-16" */
  const jibun = JSON.parse(readFileSync('data/jibun-cache.json', 'utf-8'))
  for (const key of Object.keys(jibun)) {
    const m = key.match(/^서울[ ]+([^ ]+구)[ ]+([^ ]+)[ ]+(.+)$/)
    if (!m) continue
    if (ONLY_GU && m[1] !== ONLY_GU) continue
    const lotKey = m[1] + "|" + m[2] + "|" + m[3]
    if (lotKey in cache) continue
    targets.push({ lotKey, query: key })
    if (targets.length >= LIMIT) break
  }
}

console.log(`대상 ${targets.length.toLocaleString()}지번 (기존 ${Object.keys(cache).length.toLocaleString()}건)`)

let done = 0
let hit = 0
/*
 * 실패를 한 덩어리로 세면 안 된다.
 *   noPnu   — 주소를 못 찾음 (그런 지번이 없거나 표기가 다름)
 *   apiFail — V-World 가 응답을 안 줌 (해외 IP 차단이면 전부 여기로 온다)
 *   noPrice — 정상 응답인데 공동주택가격이 없음 (근생·단독 등)
 * 셋을 뭉치면 "국내에서만 되는 API 를 해외에서 부르고 있다"를 못 본다.
 * 실제로 GitHub Actions 러너에서 300건이 전부 apiFail 이었다.
 */
let noPnu = 0
let apiFail = 0
let noPrice = 0
const C = 4

for (let i = 0; i < targets.length; i += C) {
  const slice = targets.slice(i, i + C)
  const res = await Promise.all(
    slice.map(async (t) => {
      const pnu = await resolvePnu(t.query)
      if (!pnu) return { ok: false, why: 'noPnu' }
      const r = await fetchLot(pnu)
      return r.ok ? r : { ok: false, why: 'apiFail' }
    }),
  )
  slice.forEach((t, k) => {
    done++
    if (!res[k].ok) {
      // 실패는 캐시에 남기지 않는다 — 다음에 다시 시도한다
      if (res[k].why === 'noPnu') noPnu++
      else apiFail++
      return
    }
    cache[t.lotKey] = res[k].lot
    if (res[k].lot) hit++
    else noPrice++
  })

  if (done % 200 === 0 || i + C >= targets.length) {
    mkdirSync('data', { recursive: true })
    writeFileSync(OUT, JSON.stringify(cache))
    console.log(
      `  ${done.toLocaleString()}/${targets.length.toLocaleString()} · 확보 ${hit.toLocaleString()} · 가격없음 ${noPrice} · 주소못찾음 ${noPnu} · 조회실패 ${apiFail}`,
    )
  }
  await sleep(80)
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(cache))
const withData = Object.values(cache).filter(Boolean).length
console.log(
  `\n완료: ${Object.keys(cache).length.toLocaleString()}지번 / 공시가격 있음 ${withData.toLocaleString()} · 이번 확보 ${hit} · 가격없음 ${noPrice} · 주소못찾음 ${noPnu} · 조회실패 ${apiFail}`,
)

/*
 * 조회가 통째로 실패하면 조용히 끝내지 않는다.
 * V-World 는 국내 IP 만 받는다 — 해외에서 부르면 전부 여기로 떨어진다.
 * 그때 성공한 척 끝내면 "채운 게 없네"로 보이고 원인을 못 찾는다.
 */
if (targets.length >= 20 && apiFail > targets.length * 0.5) {
  console.error(
    `
조회가 ${apiFail}/${targets.length} 실패했습니다. V-World 는 국내 IP 에서만 응답합니다 — ` +
      '해외 러너(GitHub Actions 등)에서는 채울 수 없습니다.',
  )
  process.exit(1)
}
