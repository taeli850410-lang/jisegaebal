import { SEOUL_LAWD } from './lawdCodes'

/**
 * 국토교통부 실거래가 조회 (서버 전용).
 *
 * 정비구역 투자자가 보는 지표는 "대지평당가"다.
 * 연립다세대 API는 landAr(대지권면적)을 함께 주므로 대지지분을 바로 계산할 수 있다.
 * 단독/다가구는 plottageAr(대지면적), 토지는 dealArea(거래면적)를 쓴다.
 */

export const PYEONG = 3.3058

export type Kind = 'villa' | 'house' | 'land' | 'apt'

const ENDPOINTS: Record<Kind, { url: string; label: string }> = {
  villa: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
    label: '다세대',
  },
  house: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
    label: '단독',
  },
  land: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
    label: '토지',
  },
  // 아파트는 대지지분이 없어 구역 실거래 집계에는 넣지 않고, 인근 아파트 시세용으로만 쓴다
  apt: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade',
    label: '아파트',
  },
}

export interface Transaction {
  kind: Kind
  typeLabel: string
  dealDate: string
  price: number
  dong: string
  jibun: string
  buildingName: string | null
  floor: number | null
  buildYear: number | null
  exclusiveAr: number | null
  landAr: number | null
  landPyeong: number | null
  pricePerLandPyeong: number | null
  pricePerExclusivePyeong: number | null
  isDirect: boolean
  /** 등기일자 존재 여부 */
  registered: boolean
}

function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  const v = m?.[1]?.trim()
  return v && v.length ? v : null
}

function num(v: string | null): number | null {
  if (!v) return null
  const n = Number(v.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseItems(xml: string, kind: Kind): Transaction[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []

  return blocks.flatMap((b) => {
    const amountManwon = num(pick(b, 'dealAmount'))
    const y = num(pick(b, 'dealYear'))
    const mo = num(pick(b, 'dealMonth'))
    const d = num(pick(b, 'dealDay'))
    if (amountManwon == null || y == null || mo == null || d == null) return []

    const price = amountManwon * 10_000
    const exclusiveAr = num(pick(b, 'excluUseAr'))
    const landAr =
      kind === 'villa'
        ? num(pick(b, 'landAr'))
        : kind === 'house'
          ? num(pick(b, 'plottageAr'))
          : kind === 'land'
            ? num(pick(b, 'dealArea'))
            : null // 아파트는 대지지분이 제공되지 않는다

    const landPyeong = landAr ? landAr / PYEONG : null
    const exclPyeong = exclusiveAr ? exclusiveAr / PYEONG : null

    return [
      {
        kind,
        typeLabel: ENDPOINTS[kind].label,
        dealDate: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        price,
        dong: pick(b, 'umdNm') ?? '',
        jibun: pick(b, 'jibun') ?? '',
        buildingName: pick(b, 'mhouseNm') ?? pick(b, 'aptNm') ?? null,
        floor: num(pick(b, 'floor')),
        buildYear: num(pick(b, 'buildYear')),
        exclusiveAr,
        landAr,
        landPyeong: landPyeong ? Math.round(landPyeong * 100) / 100 : null,
        pricePerLandPyeong: landPyeong ? Math.round(price / landPyeong) : null,
        pricePerExclusivePyeong: exclPyeong ? Math.round(price / exclPyeong) : null,
        isDirect: (pick(b, 'dealingGbn') ?? '').includes('직거래'),
        // 등기일자가 찍혀 있으면 소유권 이전까지 끝난 거래다 — 해제 가능성이 사실상 없다
        registered: !!(pick(b, 'rgstDate') ?? '').trim(),
      },
    ]
  })
}

const cache = new Map<string, { at: number; data: Transaction[] }>()
const TTL = 1000 * 60 * 30

/**
 * 초당 요청 제한기.
 *
 * 실거래 API 는 일일 한도와 별개로 초당 한도가 있다
 * (LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR).
 * "서울 전체"는 25개 구 x 12개월 x 3종 = 900콜이라 그냥 Promise.all 로 던지면
 * 대부분 429 로 돌아오고, 기간을 늘렸는데 결과가 오히려 줄어든다.
 *
 * 그래서 전역으로 초당 처리량을 묶는다. 실패해도 조용히 빈 배열이 되던 것도
 * 429 일 때는 잠깐 쉬었다 한 번 더 시도한다.
 */
const RATE_PER_SEC = 8
let windowStart = 0
let windowCount = 0

async function rateLimited<T>(run: () => Promise<T>): Promise<T> {
  for (;;) {
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      windowCount = 0
    }
    if (windowCount < RATE_PER_SEC) {
      windowCount++
      return run()
    }
    await new Promise((r) => setTimeout(r, 1000 - (now - windowStart) + 20))
  }
}

/**
 * 마지막으로 관측한 공공데이터포털 오류.
 *
 * 예전에는 실패를 빈 문자열로 뭉개서, 키가 거부돼도 화면은 "실거래 0건"이라고
 * 말했다. 거래가 없는 것과 못 불러온 것은 완전히 다른 얘기다.
 * 라우트가 사용자에게 사유를 밝힐 수 있도록 밖으로 들고 나간다.
 */
let lastError: string | null = null

/** 공공데이터포털이 XML/JSON 어느 쪽으로 오든 오류코드를 뽑는다 */
function errorOf(body: string): string | null {
  const m =
    body.match(/<errMsg>([^<]*)<\/errMsg>/) ??
    body.match(/"errMsg"\s*:\s*"([^"]*)"/) ??
    body.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/)
  return m ? m[1].trim() : null
}

export function lastMolitError(): string | null {
  return lastError
}

async function fetchXml(url: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const xml = await rateLimited(async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' })
        const body = await r.text()
        if (!r.ok) {
          // 403 본문에 사유가 들어 있다 (등록되지 않은 서비스키 등)
          lastError = errorOf(body) ?? `HTTP_${r.status}`
          return ''
        }
        return body
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'FETCH_FAILED'
        return ''
      }
    })
    const err = xml ? errorOf(xml) : null
    if (err) lastError = err
    if (!/PER_SECOND_EXCEEDS/.test(xml)) return xml
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
  }
  return ''
}

export async function fetchTransactions(
  gu: string,
  months: number,
  kinds: Kind[] = ['villa', 'house', 'land'],
): Promise<Transaction[]> {
  const lawd = SEOUL_LAWD[gu]
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY
  if (!lawd || !serviceKey) return []

  const key = `${gu}|${months}|${kinds.join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.data
  lastError = null

  const now = new Date()
  const ymList: string[] = []
  for (let i = 0; i < months; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymList.push(`${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const jobs: Promise<Transaction[]>[] = []
  for (const kind of kinds) {
    for (const ym of ymList) {
      const url =
        `${ENDPOINTS[kind].url}?serviceKey=${serviceKey}` +
        `&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`
      jobs.push(fetchXml(url).then((xml) => (xml ? parseItems(xml, kind) : [])))
    }
  }

  const items = (await Promise.all(jobs)).flat().sort((a, b) => b.dealDate.localeCompare(a.dealDate))
  /*
   * 실패한 조회는 캐시하지 않는다.
   * 빈 배열을 캐시해 두면 키를 고친 뒤에도 TTL 동안 계속 0건으로 보인다 —
   * 공주가 캐시에서 똑같은 실수를 한 적이 있다.
   */
  if (!(lastError && items.length === 0)) cache.set(key, { at: Date.now(), data: items })
  return items
}

/** 중앙값 — 평균은 이상치 한 건에 크게 흔들려 시세 지표로 못 쓴다 */
export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
}
