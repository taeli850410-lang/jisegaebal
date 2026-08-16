import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 아파트 단지 정보(세대수·동수·사용승인일) 조회.
 *
 * K-apt 단지 API 는 우리 data.go.kr 키에 미등록이라 쓸 수 없다.
 * 대신 건축물대장 "총괄표제부"에 단지 전체 세대수가 있어 그걸 쓴다.
 *   실거래의 지번 → 카카오 주소검색(법정동코드·본번·부번) → 총괄표제부
 *
 * 단지 정보는 거의 변하지 않으므로 디스크 캐시를 우선한다.
 */

const CACHE_PATH = join(process.cwd(), 'data', 'apt-info-cache.json')

export interface AptInfo {
  /** 총 세대수 */
  households: number | null
  /** 동수 */
  buildings: number | null
  /** 사용승인일 (YYYY-MM-DD) */
  useApprovalDate: string | null
  /** 대장상 건물명 — 실거래 단지명과 다를 수 있어 함께 보관 */
  registerName: string | null
}

let cache: Record<string, AptInfo | null> | null = null
let dirty = false

function load(): Record<string, AptInfo | null> {
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

/** 지번 주소 → 법정동코드 + 본번/부번 (카카오 주소검색이 한 번에 준다) */
async function resolveLot(query: string) {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return null
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const json = await res.json()
    const a = json.documents?.[0]?.address
    if (!a?.b_code) return null
    return {
      sigunguCd: String(a.b_code).slice(0, 5),
      bjdongCd: String(a.b_code).slice(5, 10),
      bun: pad4(a.main_address_no),
      ji: pad4(a.sub_address_no || 0),
    }
  } catch {
    return null
  }
}

async function callRegister(op: string, p: Record<string, string>) {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY
  if (!serviceKey) return null
  const qs = new URLSearchParams({
    ...p,
    numOfRows: '10',
    pageNo: '1',
    _type: 'json',
  })
  try {
    const res = await fetch(
      `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${serviceKey}&${qs}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return null
    const json = await res.json()
    const item = json?.response?.body?.items?.item
    if (!item) return null
    return Array.isArray(item) ? item : [item]
  } catch {
    return null
  }
}

const toDate = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}
const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function getAptInfo(gu: string, dong: string, jibun: string): Promise<AptInfo | null> {
  const store = load()
  const key = `${gu}|${dong}|${jibun}`
  if (key in store) return store[key]

  const lot = await resolveLot(`서울 ${gu} ${dong} ${jibun}`)
  if (!lot) {
    store[key] = null
    dirty = true
    return null
  }

  // 단지형 아파트는 총괄표제부에 전체 세대수가 있다
  let rows = await callRegister('getBrRecapTitleInfo', { ...lot, platGbCd: '0' })

  // 단동 아파트는 총괄표제부가 없어 표제부로 떨어진다
  if (!rows?.length) {
    rows = await callRegister('getBrTitleInfo', { ...lot, platGbCd: '0' })
  }

  if (!rows?.length) {
    store[key] = null
    dirty = true
    persist()
    return null
  }

  // 표제부로 떨어진 경우 동이 여러 건일 수 있어 합산한다
  const households = rows.reduce((s, r) => s + (toNum(r.hhldCnt) ?? 0), 0) || null
  const info: AptInfo = {
    households,
    buildings: toNum(rows[0].mainBldCnt) ?? (rows.length > 1 ? rows.length : null),
    useApprovalDate: toDate(rows[0].useAprDay),
    registerName: String(rows[0].bldNm ?? '').trim() || null,
  }

  store[key] = info
  dirty = true
  persist()
  return info
}
