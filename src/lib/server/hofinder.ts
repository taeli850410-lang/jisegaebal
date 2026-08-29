/**
 * 호파인더 연동.
 *
 * 호파인더는 우리와 같은 공공데이터(건축물대장·공시가격·실거래)를 따로 구현한
 * 서비스다. 그래서 같은 물건을 넣으면 두 벌의 답이 나온다.
 *
 * 우리는 그걸 "대체"가 아니라 "대조"로 쓴다.
 *   대체하면 — 우리 계산을 지우고 남의 답을 믿는 것이다. 틀려도 알 수가 없다.
 *   대조하면 — 두 답이 갈리는 순간이 보인다. 그게 정확히 사람이 등기부를
 *              떼어 봐야 하는 지점이다.
 *
 * 실제로 갈린다. 서계동 245-11 301호 대지지분이
 *   우리   V-World 대지권등록부 실측
 *   호파인더 전용면적 비례 추정 20.13㎡
 *   실거래 원본                22.27㎡
 * 추정이 2.14㎡ 어긋났다. 감추고 하나만 골랐으면 아무도 몰랐을 것이다.
 *
 * 접속 규약
 *   MCP over HTTP (JSON-RPC 2.0). 세션 핸드셰이크 없이 tools/call 이 바로 된다.
 *   호파인더가 죽어도 우리 검증은 그대로 나와야 한다 — 실패를 삼키고 null 을
 *   돌려준다. 다만 "조회 안 됨"과 "조회했더니 없음"은 구분해서 넘긴다.
 */

const ENDPOINT = process.env.HOFINDER_URL ?? 'https://ho-finder.vercel.app/api/mcp'
/** 우리 응답을 붙잡아 둘 수 없다. 이 시간을 넘기면 호파인더 없이 답한다. */
const TIMEOUT_MS = Number(process.env.HOFINDER_TIMEOUT_MS ?? 6000)

export function hasHofinder(): boolean {
  return !!ENDPOINT
}

/* 람다 한 개 안에서만 사는 캐시. 같은 지번을 연달아 물으면 두 번 가지 않는다. */
const cache = new Map<string, { at: number; v: unknown }>()
const TTL_MS = 10 * 60 * 1000

export interface HofinderUnit {
  dong: string | null
  ho: string
  floor: number
  floorLabel?: string
  area: number
  purpose: string
  /** 전용면적 비례 추정 — 실측이 아니다 */
  estLandShare?: number
  estLandSharePyeong?: number
  officialPrice?: number
  officialPriceYear?: number
}

export interface HofinderDeal {
  contractDate: string
  priceMan: number
  floor: number
  exclusiveArea: number
  /** 연립다세대 실거래에 실려 오는 대지권면적 — 추정이 아닌 원본 */
  landShareArea?: number | null
  /** 층·면적 대조로 추정한 호. 실거래 호수는 법적 비공개라 추정치다. */
  estimatedHo?: string | null
  canceled?: boolean
}

export interface HofinderResult {
  building?: {
    mainPurpose?: string
    platArea?: number
    households?: number
    approvalDate?: string
  }
  matchTier?: string
  matched?: { ho: string; floor: number; area: number; purpose: string } | null
  estAppraisal?: number | null
  premium?: number | null
  verdict?: string
  flags?: { level: string; code: string; title: string; desc: string }[]
  units?: HofinderUnit[]
  deals?: HofinderDeal[]
  error?: string
}

async function call(name: string, args: Record<string, unknown>): Promise<HofinderResult | null> {
  if (!ENDPOINT) return null
  const key = name + '|' + JSON.stringify(args)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.v as HofinderResult | null

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: ac.signal,
      cache: 'no-store',
    })
    if (!r.ok) return null
    const j = await r.json()
    const text = j?.result?.content?.[0]?.text
    if (typeof text !== 'string') return null
    const data = JSON.parse(text) as HofinderResult
    // 호파인더가 error 를 담아 보내면 그것도 사실이다 — 조용히 버리지 않는다
    cache.set(key, { at: Date.now(), v: data })
    return data
  } catch {
    /* 타임아웃·네트워크 — 우리 검증은 그대로 나가야 한다 */
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 매물 검증 (호 특정 + 대지지분 + 공시가 + 실거래) */
export function hofinderVerify(input: {
  gu: string
  dong: string
  jibun: string
  floor?: number | null
  exclusiveAr?: number | null
  price?: number | null
  rightsDate?: string | null
  appraisalMultiple?: number
}): Promise<HofinderResult | null> {
  return call('verify_listing', {
    address: `서울 ${input.gu} ${input.dong} ${input.jibun}`,
    ...(input.floor != null ? { floor: input.floor } : {}),
    ...(input.exclusiveAr ? { exclusive_area: input.exclusiveAr } : {}),
    // 호파인더는 만원 단위를 받는다
    ...(input.price ? { price_man: Math.round(input.price / 10_000) } : {}),
    ...(input.rightsDate ? { right_base_date: input.rightsDate } : {}),
    ...(input.appraisalMultiple ? { appraisal_multiplier: input.appraisalMultiple } : {}),
  })
}
