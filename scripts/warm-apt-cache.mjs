/**
 * 아파트 단지 정보 캐시 예열.
 *
 * 서버리스는 파일 쓰기가 사라지므로, 배포 전에 캐시를 미리 만들어 커밋한다.
 * 그러면 운영에서 첫 조회도 즉시 응답한다.
 *
 * data.go.kr 은 동시 호출이 몰리면 빈 본문이나 XML 에러를 돌려준다.
 * 그걸 "세대수 없음"으로 캐시에 박으면 영구히 빈 칸이 되므로,
 * 실패는 캐시에 남기지 않고 재시도한다.
 *
 * 실행: node scripts/warm-apt-cache.mjs
 *   --retry-null   이미 null 로 저장된 항목도 다시 시도한다
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

// .env.local 로드 (Next 없이 단독 실행하므로)
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

const RETRY_NULL = process.argv.includes('--retry-null')
const OUT = 'data/apt-info-cache.json'
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

if (RETRY_NULL) {
  let dropped = 0
  for (const k of Object.keys(cache)) {
    if (!cache[k]) {
      delete cache[k]
      dropped++
    }
  }
  console.log(`null ${dropped}건 폐기 후 재시도`)
}

const SEOUL_LAWD = {
  종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215',
  동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320',
  노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470',
  강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590',
  관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740',
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? ''
const pad4 = (n) => String(n ?? '').padStart(4, '0')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

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

/** 정상 응답이면 {ok:true, rows}, 실패면 {ok:false} — 이 구분이 캐시 오염을 막는다 */
async function callRegister(op, p) {
  const qs = new URLSearchParams({ ...p, numOfRows: '100', pageNo: '1', _type: 'json' })
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400 * 2 ** attempt)
    try {
      const res = await fetch(
        `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${DGK}&${qs}`,
      )
      if (!res.ok) continue
      const text = await res.text()
      if (!text.trim()) continue
      let json
      try {
        json = JSON.parse(text)
      } catch {
        continue
      }
      if (json?.response?.header?.resultCode !== '00') continue
      const item = json.response.body?.items?.item
      return { ok: true, rows: item ? (Array.isArray(item) ? item : [item]) : [] }
    } catch {
      /* 재시도 */
    }
  }
  return { ok: false }
}

async function resolveLot(query) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(400 * 2 ** attempt)
    try {
      const res = await fetch(
        `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `KakaoAK ${KAKAO}` } },
      )
      if (res.status === 429 || res.status >= 500) continue
      if (!res.ok) return { ok: false }
      const a = (await res.json()).documents?.[0]?.address
      if (!a?.b_code) return { ok: true, lot: null }
      return {
        ok: true,
        lot: {
          sigunguCd: String(a.b_code).slice(0, 5),
          bjdongCd: String(a.b_code).slice(5, 10),
          platGbCd: '0',
          bun: pad4(a.main_address_no),
          ji: pad4(a.sub_address_no || 0),
        },
      }
    } catch {
      /* 재시도 */
    }
  }
  return { ok: false }
}

/** 확정된 결과면 {settled:true, info}, 실패해서 캐시하면 안 되면 {settled:false} */
async function lookup(gu, dong, jibun) {
  const g = await resolveLot(`서울 ${gu} ${dong} ${jibun}`)
  if (!g.ok) return { settled: false }
  if (!g.lot) return { settled: true, info: null }

  const recap = await callRegister('getBrRecapTitleInfo', g.lot)
  const title = recap.ok && recap.rows.length ? null : await callRegister('getBrTitleInfo', g.lot)
  const rows = recap.ok && recap.rows.length ? recap.rows : title?.ok ? title.rows : []

  if (!rows.length) return recap.ok && title?.ok ? { settled: true, info: null } : { settled: false }

  const households = rows.reduce((s, r) => s + (num(r.hhldCnt) ?? 0), 0) || null
  const dwellings = rows.filter((r) => (num(r.hhldCnt) ?? 0) > 0).length
  const ap = String(rows[0].useAprDay ?? '').trim()
  return {
    settled: true,
    info: {
      households,
      buildings: num(rows[0].mainBldCnt) ?? (dwellings > 1 ? dwellings : null),
      useApprovalDate: /^\d{8}$/.test(ap) ? `${ap.slice(0, 4)}-${ap.slice(4, 6)}-${ap.slice(6, 8)}` : null,
      registerName: String(rows[0].bldNm ?? '').trim() || null,
    },
  }
}

let done = 0
let hit = 0
let failed = 0

for (const [gu, lawd] of Object.entries(SEOUL_LAWD)) {
  const lots = await aptLots(gu, lawd)
  const todo = lots.filter((k) => !(k in cache))
  process.stdout.write(`${gu}: 단지지번 ${lots.length} (신규 ${todo.length}) `)

  const C = 2 // 스로틀링을 피한다 — 빠른 실패보다 느린 성공이 낫다
  for (let i = 0; i < todo.length; i += C) {
    const slice = todo.slice(i, i + C)
    const res = await Promise.all(
      slice.map((k) => {
        const [g, d, j] = k.split('|')
        return lookup(g, d, j).catch(() => ({ settled: false }))
      }),
    )
    slice.forEach((k, idx) => {
      done++
      if (!res[idx].settled) {
        failed++
        return // 캐시에 남기지 않는다 — 다음 실행에서 재시도된다
      }
      cache[k] = res[idx].info
      if (res[idx].info?.households) hit++
    })
    await sleep(120)
  }

  mkdirSync('data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(cache))
  const ok = Object.values(cache).filter((v) => v?.households).length
  console.log(`→ 누적 ${Object.keys(cache).length}건 (세대수 ${ok})`)
}

const ok = Object.values(cache).filter((v) => v?.households).length
console.log(`\n완료: ${Object.keys(cache).length}건 / 세대수 ${ok}건 · 이번 ${hit}/${done} · 미확정 ${failed}건(다음 실행 재시도)`)
