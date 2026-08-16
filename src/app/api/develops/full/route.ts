import { NextResponse } from 'next/server'
import { getAllDevelops, type StoredDevelop } from '@/lib/server/developStore'
import { fetchTransactions, median, type Transaction } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { outerRings } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 구역 상세 한 번에 가져오기 — 상세 화면이 여러 번 왕복하지 않도록 묶는다.
 *
 * GET /api/develops/full?id=...
 *   { zone, deals, series, volume, nearby }
 */

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function centerOf(z: StoredDevelop): [number, number] {
  return z.center ?? [(z.bbox[0] + z.bbox[2]) / 2, (z.bbox[1] + z.bbox[3]) / 2]
}

/** 위도 37도 기준 대략적인 거리(km) — 인근 구역 정렬에만 쓰므로 이 정도면 충분하다 */
function roughKm(a: [number, number], b: [number, number]) {
  const dx = (a[0] - b[0]) * 88.8
  const dy = (a[1] - b[1]) * 111
  return Math.sqrt(dx * dx + dy * dy)
}

const MONTHS = 24

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const all = getAllDevelops()
  const zone = all.find((z) => z.id === id)
  if (!zone) return NextResponse.json({ error: '구역을 찾을 수 없습니다.' }, { status: 404 })

  /* ── 인근 구역 ── */
  const c = centerOf(zone)
  const nearby = all
    .filter((z) => z.id !== zone.id && z.gu === zone.gu)
    .map((z) => ({ z, km: roughKm(c, centerOf(z)) }))
    .filter((x) => x.km <= 3)
    .sort((a, b) => a.km - b.km)
    .slice(0, 5)
    .map(({ z, km }) => ({
      id: z.id,
      name: z.name,
      projectType: z.projectType,
      rawLabel: z.rawLabel,
      stage: z.stage ?? null,
      canonicalStage: z.canonicalStage ?? null,
      areaM2: z.areaM2,
      noticeDate: z.noticeDate ?? null,
      distanceKm: Math.round(km * 10) / 10,
      bbox: z.bbox,
    }))

  /* ── 이 구역의 실거래 ── */
  let deals: Transaction[] = []
  let unavailable: string | null = null

  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    unavailable = 'NO_KEY'
  } else if (!zone.gu) {
    unavailable = 'NO_GU'
  } else {
    const all24 = await fetchTransactions(zone.gu, MONTHS)
    const queries = [...new Set(all24.map((t) => `서울 ${zone.gu} ${t.dong} ${t.jibun}`))]
    const coords = await geocodeMany(queries, 60)
    const rings = outerRings(zone.geometry)

    deals = all24.filter((t) => {
      const pt = coords.get(`서울 ${zone.gu} ${t.dong} ${t.jibun}`)
      if (!pt) return false
      const [lng, lat] = pt
      if (lng < zone.bbox[0] || lng > zone.bbox[2] || lat < zone.bbox[1] || lat > zone.bbox[3])
        return false
      return rings.some((r) => pointInRing(lng, lat, r))
    })
  }

  /* ── 월별 시계열 (중앙 대지평당가 + 거래량) ── */
  const now = new Date()
  const ymKeys: string[] = []
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const series = ymKeys.map((ym) => {
    const inMonth = deals.filter((d) => d.dealDate.startsWith(ym))
    return {
      ym,
      value: median(inMonth.map((d) => d.pricePerLandPyeong ?? NaN)),
      count: inMonth.length,
    }
  })

  return NextResponse.json({
    zone: {
      id: zone.id,
      name: zone.name,
      projectType: zone.projectType,
      rawLabel: zone.rawLabel,
      stage: zone.stage ?? null,
      canonicalStage: zone.canonicalStage ?? null,
      stageSiteName: zone.stageSiteName ?? null,
      stageBizType: zone.stageBizType ?? null,
      stageMatchBy: zone.stageMatchBy ?? null,
      areaM2: zone.areaM2,
      gu: zone.gu ?? null,
      dong: zone.dong ?? null,
      noticeSn: zone.noticeSn,
      noticeDate: zone.noticeDate ?? null,
      bbox: zone.bbox,
    },
    deals: deals.slice(0, 60),
    dealCount: deals.length,
    medianPerPyeong: median(deals.map((d) => d.pricePerLandPyeong ?? NaN)),
    series,
    nearby,
    unavailable,
    _meta: {
      source: '경계: 서울시 의제처리구역 / 단계: 정비사업 정보몽땅 / 실거래: 국토교통부',
      note: '실거래는 지번 지오코딩 후 구역 경계 안으로 판정된 건만 집계합니다.',
    },
  })
}
