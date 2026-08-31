import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { remoteGet, remotePut } from './priceStore'
import { join } from 'node:path'

/**
 * 공동주택 공시가격("공주가") 조회.
 *
 * 어디서 오는가
 *   국토교통부 공동주택가격정보를 V-World 가 열어둔 getApartHousingPriceAttr.
 *   건축물대장의 주택가격(getBrHsprcInfo)과는 다른 대장이다 —
 *   그쪽은 다세대가 대부분 0건이라 쓸 수 없었다.
 *
 * 호를 어떻게 특정하나
 *   실거래는 동·호를 주지 않는다. 대신 전용면적을 준다.
 *   공시가격도 호별 전용면적을 주므로, 같은 지번에서 전용면적이 가장 가까운 호를 고른다.
 *   검증: 천호동 211-6 전용 36.2㎡ → 209,000,000원,
 *         천호동 321-56 전용 25.16㎡ → 100,000,000원 (벤치마크 표시값과 일치)
 *
 * 공시가격은 연 1회만 바뀌므로 지번 단위로 디스크에 캐시한다.
 */

const CACHE_PATH = join(process.cwd(), 'data', 'house-price-cache.json')

/** 한 지번의 최신 연도 호별 정보 */
interface LotPrices {
  year: number
  /** [전용면적㎡, 공시가격원, 지하여부] */
  units: [number, number, boolean][]
}

/**
 * 호명에서 지하 여부를 읽는다.
 *
 * 같은 전용면적이라도 반지하는 공시가격이 크게 낮다.
 * 청호빌라 36.69㎡ 는 101·201호가 1.18억인데 지층001호는 7,750만이다.
 * 층을 무시하면 반지하 거래에 지상 가격을 붙이게 된다.
 */
function isBasement(hoNm: string): boolean {
  return /지층|지하|^B|^b\d/.test(hoNm.trim())
}

let cache: Record<string, LotPrices | null> | null = null
let dirty = false

function load(): Record<string, LotPrices | null> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    cache = {}
  }
  return cache!
}

function persist() {
  if (!dirty || !cache) return
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache))
    dirty = false
  } catch {
    /* 서버리스는 읽기 전용 — 메모리 캐시만 유지 */
  }
}

const pad4 = (n: string | number) => String(n ?? '').padStart(4, '0')

/** 지번 주소 → PNU (카카오 주소검색이 법정동코드·본번·부번을 한 번에 준다) */
async function resolvePnu(query: string): Promise<string | null> {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return null
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const a = (await res.json()).documents?.[0]?.address
    if (!a?.b_code) return null
    // PNU = 법정동코드(10) + 산여부(1) + 본번(4) + 부번(4)
    const san = a.mountain_yn === 'Y' ? '2' : '1'
    return `${a.b_code}${san}${pad4(a.main_address_no)}${pad4(a.sub_address_no || 0)}`
  } catch {
    return null
  }
}

/**
 * 조회 결과.
 *
 * "정상 응답인데 자료 없음"(ok:true, lot:null)과 "호출 실패"(ok:false)를 반드시 구분한다.
 * V-World 는 부하가 걸리면 502 를 돌려주는데, 이걸 자료 없음으로 캐시에 박으면
 * 그 지번은 영구히 공주가가 비게 된다. (세대수 캐시에서 같은 실수를 한 적이 있다)
 */
type LotResult = { ok: true; lot: LotPrices | null } | { ok: false }

async function fetchLot(pnu: string): Promise<LotResult> {
  const key = process.env.VWORLD_API_KEY
  if (!key) return { ok: false }
  const domain = process.env.VWORLD_DOMAIN ?? 'https://jisegaebal.vercel.app'
  const url =
    `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?key=${key}` +
    `&domain=${encodeURIComponent(domain)}&format=json&numOfRows=1000&pageNo=1&pnu=${pnu}`

  // 502 는 일시적인 경우가 많아 잠깐 쉬었다 다시 시도한다
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 400 * attempt))
    const r = await tryOnce(url)
    if (r.ok || r.fatal) return r.ok ? { ok: true, lot: r.lot } : { ok: true, lot: null }
  }
  return { ok: false }
}

type Once =
  | { ok: true; lot: LotPrices | null; fatal?: false }
  | { ok: false; fatal: boolean }

async function tryOnce(url: string): Promise<Once> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    // 5xx 는 재시도할 값어치가 있다. 4xx 는 다시 불러도 같다.
    if (!res.ok) return { ok: false, fatal: res.status < 500 }
    const text = await res.text()
    if (!text.trimStart().startsWith('{')) return { ok: false, fatal: false }
    const json = JSON.parse(text) as Record<string, { field?: unknown; resultCode?: string }>
    const body = json[Object.keys(json)[0]]
    if (body?.resultCode === 'INCORRECT_KEY') return { ok: false, fatal: true }
    const raw = body?.field
    // 정상 응답인데 그 지번에 공동주택이 없는 경우다
    if (!raw) return { ok: true, lot: null }
    const rows = (Array.isArray(raw) ? raw : [raw]) as {
      stdrYear?: string
      prvuseAr?: string
      pblntfPc?: string
      hoNm?: string
    }[]

    // 여러 해가 섞여 오므로 최신 연도만 남긴다
    let year = 0
    for (const r of rows) {
      const y = Number(r.stdrYear)
      if (Number.isFinite(y) && y > year) year = y
    }
    // 연도가 없으면 쓸 수 있는 행이 없다는 뜻 — 정상 응답이지만 자료 없음
    if (!year) return { ok: true, lot: null }

    const units: [number, number, boolean][] = []
    const seen = new Set<string>()
    for (const r of rows) {
      if (Number(r.stdrYear) !== year) continue
      const ar = Number(r.prvuseAr)
      const pc = Number(r.pblntfPc)
      if (!(ar > 0 && pc > 0)) continue
      // 같은 호가 여러 번 오므로 호명으로 한 번만 담는다
      const ho = String(r.hoNm ?? '')
      const k = `${ho}|${ar}|${pc}`
      if (seen.has(k)) continue
      seen.add(k)
      units.push([ar, pc, isBasement(ho)])
    }
    return { ok: true, lot: units.length ? { year, units } : null }
  } catch {
    return { ok: false, fatal: false }
  }
}

/**
 * 지번 + 전용면적 → 공시가격.
 * 전용면적이 1㎡ 넘게 어긋나면 다른 평형이라 보고 돌려주지 않는다.
 */
export async function getPublicPrice(
  gu: string,
  dong: string,
  jibun: string,
  exclusiveAr: number | null,
  /** 실거래의 층. 음수면 반지하라 지하 호와 맞춘다. */
  floor?: number | null,
): Promise<{ price: number; year: number } | null> {
  if (!exclusiveAr || exclusiveAr <= 0) return null

  const store = load()
  const lotKey = `${gu}|${dong}|${jibun}`

  let lot: LotPrices | null
  if (lotKey in store) {
    lot = store[lotKey]
  } else {
    /*
     * 배포에 실린 디스크 캐시에 없으면 Supabase 를 본다.
     * 서버리스는 디스크가 읽기 전용이라 여기서 받은 값을 파일에 못 쌓는다 —
     * 그래서 한 번 알아낸 건 Supabase 에 적어 두고 다음부터 거기서 읽는다.
     */
    const remote = await remoteGet(lotKey)
    if (remote.hit) {
      lot = remote.lot
    } else {
      const pnu = await resolvePnu(`서울 ${gu} ${dong} ${jibun}`)
      if (!pnu) return null // 지오코딩 실패는 일시적일 수 있어 캐시하지 않는다
      const res = await fetchLot(pnu)
      if (!res.ok) return null // 호출 실패도 캐시하지 않는다 — 다음에 다시 시도한다
      lot = res.lot
      /* 없다는 사실도 알아낸 것이다. 그것까지 적어야 다시 안 묻는다. */
      await remotePut(lotKey, lot)
    }
    store[lotKey] = lot
    dirty = true
    persist()
  }
  if (!lot) return null

  // 실거래 층이 음수면 반지하다. 지하 호끼리, 지상은 지상끼리 맞춘다.
  const wantBasement = typeof floor === 'number' && floor < 0
  const pool = lot.units.filter((u) => u[2] === wantBasement)
  const candidates = pool.length ? pool : lot.units

  let best: [number, number, boolean] | null = null
  let bestGap = Infinity
  for (const u of candidates) {
    const gap = Math.abs(u[0] - exclusiveAr)
    if (gap < bestGap) {
      bestGap = gap
      best = u
    }
  }
  // 같은 지번이라도 평형이 다르면 값이 크게 다르다. 1㎡ 넘게 벌어지면 포기한다.
  if (!best || bestGap > 1) return null
  return { price: best[1], year: lot.year }
}

/** 여러 거래를 한 번에 — 같은 지번은 한 번만 조회한다 */
export async function attachPublicPrices<
  T extends { dong: string; jibun: string; exclusiveAr: number | null; floor?: number | null },
>(gu: string, deals: T[]): Promise<(T & { publicPrice: number | null })[]> {
  const out: (T & { publicPrice: number | null })[] = deals.map((d) => ({
    ...d,
    publicPrice: null,
  }))

  const C = 4
  for (let i = 0; i < out.length; i += C) {
    await Promise.all(
      out.slice(i, i + C).map(async (d) => {
        const hit = await getPublicPrice(gu, d.dong, d.jibun, d.exclusiveAr, d.floor).catch(() => null)
        if (hit) d.publicPrice = hit.price
      }),
    )
  }
  return out
}
