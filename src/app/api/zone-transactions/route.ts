import { NextResponse } from 'next/server'
import { getAllDevelops } from '@/lib/server/developStore'
import { fetchTransactions, median, type Kind, type Transaction } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { outerRings } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 구역별 실거래 집계.
 *
 * GET /api/zone-transactions?gu=강동구&days=30
 *
 * 국토부 응답에는 좌표가 없으므로 지번을 지오코딩해 구역 폴리곤과 공간조인한다.
 * 지번 좌표는 변하지 않아 캐시가 잘 먹는다(최초 조회만 느리고 이후는 즉시).
 */

/** 스파크라인은 6개월이면 충분하지만, 365일 집계는 그만큼 더 받아야 한다 */
function monthsFor(days: number) {
  return Math.max(6, Math.ceil(days / 30) + 1)
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export interface ZoneTransactions {
  id: string
  name: string
  projectType: string
  rawLabel: string
  stage: string | null
  canonicalStage: string | null
  bbox: [number, number, number, number]
  /** 선택 기간 내 거래 */
  deals: Transaction[]
  dealCount: number
  /** 기간 내 대지평당가 중앙값 */
  medianPerPyeong: number | null
  /** 직전 동일 기간 대비 변화율(%) */
  changePct: number | null
  /** 월별 중앙 대지평당가 (오래된 순) — 스파크라인용 */
  series: { ym: string; value: number | null }[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gu = searchParams.get('gu') ?? ''
  const days = Math.min(365, Math.max(7, Number(searchParams.get('days') ?? 30) || 30))
  // 가격순은 "다세대 기준"처럼 유형을 좁혀야 지표가 흔들리지 않는다
  const kinds = (searchParams.get('kinds')?.split(',').filter(Boolean) ?? [
    'villa',
    'house',
    'land',
  ]) as Kind[]
  const SERIES_MONTHS = monthsFor(days)

  if (!gu) return NextResponse.json({ error: 'gu 파라미터가 필요합니다.' }, { status: 400 })
  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    return NextResponse.json({ error: '실거래 인증키 미설정', code: 'NO_KEY' }, { status: 503 })
  }

  const zones = getAllDevelops().filter((d) => d.gu === gu)
  if (!zones.length) return NextResponse.json({ gu, days, zones: [], total: 0 })

  const all = await fetchTransactions(gu, SERIES_MONTHS, kinds)

  // 지번 좌표 확보 (캐시 우선). 예산을 둬 한 요청이 API를 과하게 쓰지 않게 한다.
  const uniqueQueries = [...new Set(all.map((t) => `서울 ${gu} ${t.dong} ${t.jibun}`))]
  const coords = await geocodeMany(uniqueQueries, 150)

  // 구역별로 거래를 담는다. 겹치는 구역이 있으면 작은 구역이 더 구체적이다.
  const sortedZones = [...zones].sort((a, b) => a.areaM2 - b.areaM2)
  const bucket = new Map<string, Transaction[]>()

  for (const t of all) {
    const pt = coords.get(`서울 ${gu} ${t.dong} ${t.jibun}`)
    if (!pt) continue
    const [lng, lat] = pt
    const zone = sortedZones.find(
      (z) =>
        lng >= z.bbox[0] &&
        lng <= z.bbox[2] &&
        lat >= z.bbox[1] &&
        lat <= z.bbox[3] &&
        outerRings(z.geometry).some((r) => pointInRing(lng, lat, r)),
    )
    if (!zone) continue
    const list = bucket.get(zone.id) ?? []
    list.push(t)
    bucket.set(zone.id, list)
  }

  const now = new Date()
  const cut = new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10)
  const prevCut = new Date(now.getTime() - days * 2 * 86400_000).toISOString().slice(0, 10)

  const ymKeys: string[] = []
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymKeys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const result: ZoneTransactions[] = []

  for (const [zoneId, deals] of bucket) {
    const z = zones.find((x) => x.id === zoneId)!
    const inPeriod = deals.filter((d) => d.dealDate >= cut)
    if (!inPeriod.length) continue

    const prevPeriod = deals.filter((d) => d.dealDate >= prevCut && d.dealDate < cut)
    const cur = median(inPeriod.map((d) => d.pricePerLandPyeong ?? NaN))
    const prev = median(prevPeriod.map((d) => d.pricePerLandPyeong ?? NaN))

    result.push({
      id: z.id,
      name: z.name,
      projectType: z.projectType,
      rawLabel: z.rawLabel,
      stage: z.stage ?? null,
      canonicalStage: z.canonicalStage ?? null,
      bbox: z.bbox,
      deals: inPeriod.slice(0, 20),
      dealCount: inPeriod.length,
      medianPerPyeong: cur,
      changePct: cur && prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
      series: ymKeys.map((ym) => ({
        ym,
        value: median(
          deals.filter((d) => d.dealDate.startsWith(ym)).map((d) => d.pricePerLandPyeong ?? NaN),
        ),
      })),
    })
  }

  result.sort((a, b) => b.dealCount - a.dealCount || (b.medianPerPyeong ?? 0) - (a.medianPerPyeong ?? 0))

  return NextResponse.json({
    gu,
    days,
    total: result.length,
    matchedDeals: [...bucket.values()].reduce((s, l) => s + l.length, 0),
    fetchedDeals: all.length,
    geocoded: uniqueQueries.filter((q) => coords.get(q)).length,
    unresolved: uniqueQueries.filter((q) => !coords.has(q)).length,
    zones: result,
    _meta: {
      source: '국토교통부 실거래가 + 서울시 의제처리구역 경계',
      note: '지번 지오코딩 후 공간조인으로 연결한 값입니다. 구역 경계 밖 거래는 제외됩니다.',
    },
  })
}
