import { SEOUL_LAWD } from './lawdCodes'

/**
 * 국토교통부 실거래가 조회 (서버 전용).
 *
 * 정비구역 투자자가 보는 지표는 "대지평당가"다.
 * 연립다세대 API는 landAr(대지권면적)을 함께 주므로 대지지분을 바로 계산할 수 있다.
 * 단독/다가구는 plottageAr(대지면적), 토지는 dealArea(거래면적)를 쓴다.
 */

export const PYEONG = 3.3058

export type Kind = 'villa' | 'house' | 'land'

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
          : num(pick(b, 'dealArea'))

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
        buildingName: pick(b, 'mhouseNm') ?? null,
        floor: num(pick(b, 'floor')),
        buildYear: num(pick(b, 'buildYear')),
        exclusiveAr,
        landAr,
        landPyeong: landPyeong ? Math.round(landPyeong * 100) / 100 : null,
        pricePerLandPyeong: landPyeong ? Math.round(price / landPyeong) : null,
        pricePerExclusivePyeong: exclPyeong ? Math.round(price / exclPyeong) : null,
        isDirect: (pick(b, 'dealingGbn') ?? '').includes('직거래'),
      },
    ]
  })
}

const cache = new Map<string, { at: number; data: Transaction[] }>()
const TTL = 1000 * 60 * 30

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
      jobs.push(
        fetch(url, { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : ''))
          .then((xml) => (xml ? parseItems(xml, kind) : []))
          .catch(() => []),
      )
    }
  }

  const items = (await Promise.all(jobs)).flat().sort((a, b) => b.dealDate.localeCompare(a.dealDate))
  cache.set(key, { at: Date.now(), data: items })
  return items
}

/** 중앙값 — 평균은 이상치 한 건에 크게 흔들려 시세 지표로 못 쓴다 */
export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2)
}
