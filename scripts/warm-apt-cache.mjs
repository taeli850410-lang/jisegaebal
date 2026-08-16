/**
 * 아파트 단지 정보 캐시 예열.
 *
 * 서버리스는 파일 쓰기가 사라지므로, 배포 전에 캐시를 미리 만들어 커밋한다.
 * 그러면 운영에서 첫 조회도 즉시 응답한다.
 *
 * 실행: node scripts/warm-apt-cache.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const KAKAO = process.env.KAKAO_REST_API_KEY
const DGK = process.env.DATA_GO_KR_SERVICE_KEY
if (!KAKAO || !DGK) {
  console.error('KAKAO_REST_API_KEY / DATA_GO_KR_SERVICE_KEY 필요')
  process.exit(1)
}

const OUT = 'data/apt-info-cache.json'
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

const SEOUL_LAWD = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? ''
const pad4 = (n) => String(n ?? '').padStart(4, '0')

/** 최근 6개월 아파트 실거래에서 단지 지번을 모은다 */
async function aptLots(gu, lawd) {
  const now = new Date()
  const out = new Set()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
    try {
      const xml = await (
        await fetch(
          `https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade?serviceKey=${DGK}` +
            `&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`,
        )
      ).text()
      for (const b of xml.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
        const dong = tag(b, 'umdNm')
        const jibun = tag(b, 'jibun')
        if (dong && jibun) out.add(`${gu}|${dong}|${jibun}`)
      }
    } catch {
      /* 건너뛴다 */
    }
  }
  return [...out]
}

async function lookup(gu, dong, jibun) {
  const g = await (
    await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(`서울 ${gu} ${dong} ${jibun}`)}`,
      { headers: { Authorization: `KakaoAK ${KAKAO}` } },
    )
  ).json()
  const a = g.documents?.[0]?.address
  if (!a?.b_code) return null

  const p = new URLSearchParams({
    sigunguCd: String(a.b_code).slice(0, 5),
    bjdongCd: String(a.b_code).slice(5, 10),
    platGbCd: '0',
    bun: pad4(a.main_address_no),
    ji: pad4(a.sub_address_no || 0),
    numOfRows: '10',
    pageNo: '1',
    _type: 'json',
  })

  for (const op of ['getBrRecapTitleInfo', 'getBrTitleInfo']) {
    try {
      const j = await (
        await fetch(
          `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${DGK}&${p}`,
        )
      ).json()
      const item = j?.response?.body?.items?.item
      if (!item) continue
      const rows = Array.isArray(item) ? item : [item]
      const num = (v) => {
        const n = Number(String(v ?? '').replace(/,/g, ''))
        return Number.isFinite(n) && n > 0 ? n : null
      }
      const households = rows.reduce((s, r) => s + (num(r.hhldCnt) ?? 0), 0) || null
      if (!households) continue
      const ap = String(rows[0].useAprDay ?? '').trim()
      return {
        households,
        buildings: num(rows[0].mainBldCnt) ?? (rows.length > 1 ? rows.length : null),
        useApprovalDate: /^\d{8}$/.test(ap)
          ? `${ap.slice(0, 4)}-${ap.slice(4, 6)}-${ap.slice(6, 8)}`
          : null,
        registerName: String(rows[0].bldNm ?? '').trim() || null,
      }
    } catch {
      /* 다음 오퍼레이션 */
    }
  }
  return null
}

let done = 0
let hit = 0

for (const [gu, lawd] of Object.entries(SEOUL_LAWD)) {
  const lots = await aptLots(gu, lawd)
  const todo = lots.filter((k) => !(k in cache))
  process.stdout.write(`${gu}: 단지지번 ${lots.length} (신규 ${todo.length}) `)

  const C = 5
  for (let i = 0; i < todo.length; i += C) {
    const slice = todo.slice(i, i + C)
    const res = await Promise.all(
      slice.map((k) => {
        const [g, d, j] = k.split('|')
        return lookup(g, d, j).catch(() => null)
      }),
    )
    slice.forEach((k, idx) => {
      cache[k] = res[idx]
      done++
      if (res[idx]) hit++
    })
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(cache))
  console.log(`→ 누적 ${Object.keys(cache).length}건`)
}

const ok = Object.values(cache).filter(Boolean).length
console.log(`\n완료: ${Object.keys(cache).length}건 / 세대수 확보 ${ok}건 (이번 실행 ${hit}/${done})`)
