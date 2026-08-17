/**
 * 아파트 단지 지번 좌표 예열.
 *
 * 지도의 "단지" 레이어는 아파트 실거래 지번을 좌표로 바꿔 마커를 찍는다.
 * 그런데 기존 jibun-cache 는 구역 판정용이라 다세대·단독·토지 지번만 들어 있어
 * 아파트 지번은 좌표가 하나도 없었다(강동구 302개 중 0개).
 *
 * 여기서 미리 채워 커밋한다. 지번 좌표는 변하지 않으므로 한 번만 하면 된다.
 *
 * 실행: node scripts/warm-apt-geocode.mjs [--limit 20000]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const KAKAO = process.env.KAKAO_REST_API_KEY
const DGK = process.env.DATA_GO_KR_SERVICE_KEY
if (!KAKAO || !DGK) {
  console.error('KAKAO_REST_API_KEY / DATA_GO_KR_SERVICE_KEY 필요')
  process.exit(1)
}

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const LIMIT = Number(arg('--limit', '20000'))

const OUT = 'data/jibun-cache.json'
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}
const before = Object.keys(cache).length

const SEOUL_LAWD = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tag = (xml, n) => xml.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`))?.[1]?.trim() ?? ''

/** 최근 12개월 아파트 실거래의 지번을 모은다 */
async function aptLots(gu, lawd) {
  const now = new Date()
  const out = new Set()
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
    for (let a = 0; a < 3; a++) {
      if (a) await sleep(600 * a)
      try {
        const xml = await (
          await fetch(
            `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${DGK}` +
              `&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`,
          )
        ).text()
        if (/PER_SECOND_EXCEEDS/.test(xml)) continue
        for (const b of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
          const dong = tag(b, 'umdNm')
          const jibun = tag(b, 'jibun')
          if (dong && jibun) out.add(`서울 ${gu} ${dong} ${jibun}`)
        }
        break
      } catch {
        /* 재시도 */
      }
    }
    await sleep(140)
  }
  return [...out]
}

async function geocode(query) {
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(400 * a)
    try {
      const r = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `KakaoAK ${KAKAO}` } },
      )
      if (r.status === 429 || r.status >= 500) continue
      if (!r.ok) return { ok: true, pt: null }
      const d = (await r.json()).documents?.[0]
      if (!d) return { ok: true, pt: null }
      return { ok: true, pt: [Number(d.x), Number(d.y)] }
    } catch {
      /* 재시도 */
    }
  }
  return { ok: false }
}

let total = 0
let added = 0
let failed = 0

for (const [gu, lawd] of Object.entries(SEOUL_LAWD)) {
  const lots = await aptLots(gu, lawd)
  const todo = lots.filter((q) => !(q in cache)).slice(0, LIMIT - total)
  process.stdout.write(`${gu}: 아파트지번 ${lots.length} (신규 ${todo.length}) `)

  const C = 4
  for (let i = 0; i < todo.length; i += C) {
    const slice = todo.slice(i, i + C)
    const res = await Promise.all(slice.map(geocode))
    slice.forEach((q, k) => {
      total++
      if (!res[k].ok) {
        failed++
        return // 실패는 캐시하지 않는다
      }
      cache[q] = res[k].pt
      if (res[k].pt) added++
    })
    await sleep(90)
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(cache))
  console.log(`→ 누적 ${Object.keys(cache).length.toLocaleString()}건`)
  if (total >= LIMIT) break
}

writeFileSync(OUT, JSON.stringify(cache))
console.log(
  `\n완료: ${before.toLocaleString()} → ${Object.keys(cache).length.toLocaleString()}건 ` +
    `(좌표 확보 ${added.toLocaleString()} · 실패 ${failed})`,
)
