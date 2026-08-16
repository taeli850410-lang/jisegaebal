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

/**
 * 건축물대장 호출.
 *
 * "응답은 정상인데 결과가 없음"(ok:true, rows:[])과 "호출이 실패함"(ok:false)을
 * 반드시 구분한다. data.go.kr 은 트래픽이 몰리면 빈 본문을 돌려주는데,
 * 이걸 "없음"으로 취급해 캐시에 박아두면 영구히 세대수가 비게 된다.
 */
type RegisterResult =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false }

async function callRegister(op: string, p: Record<string, string>): Promise<RegisterResult> {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY
  if (!serviceKey) return { ok: false }
  const qs = new URLSearchParams({
    ...p,
    // 표제부는 동별로 한 건씩 나온다. 10건에서 끊으면 대단지 세대수가 잘린다.
    numOfRows: '100',
    pageNo: '1',
    _type: 'json',
  })
  try {
    const res = await fetch(
      `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?serviceKey=${serviceKey}&${qs}`,
      { cache: 'no-store' },
    )
    if (!res.ok) return { ok: false }
    const text = await res.text()
    if (!text.trim()) return { ok: false } // 빈 본문 = 스로틀링
    let json: {
      response?: { header?: { resultCode?: string }; body?: { items?: { item?: unknown } } }
    }
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false } // JSON 을 요청했는데 XML 이 오면 에러 응답이다
    }
    if (json?.response?.header?.resultCode !== '00') return { ok: false }
    const item = json.response.body?.items?.item
    if (!item) return { ok: true, rows: [] }
    return { ok: true, rows: (Array.isArray(item) ? item : [item]) as Record<string, unknown>[] }
  } catch {
    return { ok: false }
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
  // 지오코딩 실패는 스로틀링일 수도 있으므로 캐시에 남기지 않는다
  if (!lot) return null

  // 단지형 아파트는 총괄표제부에 전체 세대수가 있다
  const recap = await callRegister('getBrRecapTitleInfo', { ...lot, platGbCd: '0' })

  // 단동 아파트는 총괄표제부가 없어 표제부로 떨어진다
  const title =
    recap.ok && recap.rows.length ? null : await callRegister('getBrTitleInfo', { ...lot, platGbCd: '0' })

  const rows = recap.ok && recap.rows.length ? recap.rows : title?.ok ? title.rows : []

  if (!rows.length) {
    // 두 호출이 모두 "정상 응답 + 결과 없음"일 때만 없음으로 확정한다
    if (recap.ok && title?.ok) {
      store[key] = null
      dirty = true
      persist()
    }
    return null
  }

  // 표제부로 떨어진 경우 동이 여러 건일 수 있어 합산한다
  const households = rows.reduce((s, r) => s + (toNum(r.hhldCnt) ?? 0), 0) || null
  // 표제부로 떨어진 경우 상가·부속건물이 섞이므로 세대가 있는 동만 센다
  const dwellingRows = rows.filter((r) => (toNum(r.hhldCnt) ?? 0) > 0).length
  const info: AptInfo = {
    households,
    buildings: toNum(rows[0].mainBldCnt) ?? (dwellingRows > 1 ? dwellingRows : null),
    useApprovalDate: toDate(rows[0].useAprDay),
    registerName: String(rows[0].bldNm ?? '').trim() || null,
  }

  store[key] = info
  dirty = true
  persist()
  return info
}
