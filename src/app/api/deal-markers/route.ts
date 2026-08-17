import { NextResponse } from 'next/server'
import { getAllDevelops } from '@/lib/server/developStore'
import { fetchTransactions } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { SEOUL_LAWD } from '@/lib/server/lawdCodes'
import { outerRings } from '@/lib/types'

/**
 * 지도 위 개별 실거래 마커.
 *
 * GET /api/deal-markers?bbox=minLng,minLat,maxLng,maxLat&months=12
 *
 * 단지 레이어(아파트 평형 시세)와 달리 여기는 거래 한 건 한 건을 찍는다.
 * 정비구역 투자자가 보는 건 아파트가 아니라 다세대·단독·토지라, 대지지분이
 * 나오는 이 세 유형만 다룬다.
 *
 * 마커 색은 그 거래가 속한 구역의 진행단계 색을 따른다. 구역 밖 거래는 회색이다
 * — 같은 화면에 있어도 정비사업과 무관한 거래라는 걸 색으로 구분한다.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export interface DealMarker {
  lng: number
  lat: number
  price: number
  typeLabel: string
  dealDate: string
  dong: string
  jibun: string
  /** 이 지번에서 기간 내 신고된 거래 수 */
  count: number
  /** 속한 구역 (없으면 null) */
  zoneId: string | null
  canonicalStage: string | null
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

/** bbox 안에 걸치는 자치구 — 3x3 격자를 역지오코딩해 모은다 */
async function guInBbox(bbox: [number, number, number, number]): Promise<string[]> {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return []
  const [minLng, minLat, maxLng, maxLat] = bbox
  const pts: [number, number][] = []
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      pts.push([minLng + ((maxLng - minLng) * i) / 2, minLat + ((maxLat - minLat) * j) / 2])
    }
  }
  const found = new Set<string>()
  await Promise.all(
    pts.map(async ([lng, lat]) => {
      try {
        const r = await fetch(
          `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`,
          { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
        )
        if (!r.ok) return
        for (const d of (await r.json()).documents ?? []) {
          if (d.region_1depth_name?.includes('서울') && d.region_2depth_name) {
            found.add(d.region_2depth_name)
          }
        }
      } catch {
        /* 건너뛴다 */
      }
    }),
  )
  return [...found].filter((g) => g in SEOUL_LAWD)
}

const cache = new Map<string, { at: number; markers: DealMarker[] }>()
const TTL = 20 * 60 * 1000

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams
  const bboxParam = sp.get('bbox')
  const months = Math.min(24, Math.max(1, Number(sp.get('months') ?? 12) || 12))
  if (!bboxParam) return NextResponse.json({ error: 'bbox 가 필요합니다.' }, { status: 400 })
  const bbox = bboxParam.split(',').map(Number) as [number, number, number, number]
  if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    return NextResponse.json({ error: 'bbox 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    return NextResponse.json({ error: '실거래 인증키 미설정', code: 'NO_KEY' }, { status: 503 })
  }

  const gus = await guInBbox(bbox)
  if (!gus.length) return NextResponse.json({ markers: [], gus: [] })

  const all = getAllDevelops()
  const markers: DealMarker[] = []

  for (const gu of gus) {
    const ck = `${gu}|${months}`
    const hit = cache.get(ck)
    if (hit && Date.now() - hit.at < TTL) {
      markers.push(...hit.markers)
      continue
    }

    const deals = await fetchTransactions(gu, months, ['villa', 'house', 'land'])
    const queries = [...new Set(deals.map((d) => `서울 ${gu} ${d.dong} ${d.jibun}`))]
    // 지오코딩은 캐시만 쓴다 — 마커 때문에 수천 건을 새로 부를 수는 없다
    const coords = await geocodeMany(queries, 0)

    // 겹치는 구역이 있으면 작은 쪽이 더 구체적이다
    const zones = all
      .filter((z) => z.gu === gu)
      .sort((a, b) => a.areaM2 - b.areaM2)

    /* 지번 단위로 묶어 최신 거래 하나만 남긴다 (한 지번에 수십 건이면 라벨이 겹친다) */
    const byLot = new Map<string, { pt: [number, number]; deals: typeof deals }>()
    for (const d of deals) {
      const pt = coords.get(`서울 ${gu} ${d.dong} ${d.jibun}`)
      if (!pt) continue
      const k = `${d.dong}|${d.jibun}`
      const cur = byLot.get(k)
      if (cur) cur.deals.push(d)
      else byLot.set(k, { pt: pt as [number, number], deals: [d] })
    }

    const list: DealMarker[] = []
    for (const [k, v] of byLot) {
      const latest = v.deals.reduce((a, b) => (b.dealDate > a.dealDate ? b : a))
      const [lng, lat] = v.pt
      const zone = zones.find(
        (z) =>
          lng >= z.bbox[0] &&
          lng <= z.bbox[2] &&
          lat >= z.bbox[1] &&
          lat <= z.bbox[3] &&
          outerRings(z.geometry).some((r) => pointInRing(lng, lat, r)),
      )
      const [dong, jibun] = k.split('|')
      list.push({
        lng,
        lat,
        price: latest.price,
        typeLabel: latest.typeLabel,
        dealDate: latest.dealDate,
        dong,
        jibun,
        count: v.deals.length,
        zoneId: zone?.id ?? null,
        canonicalStage: zone?.canonicalStage ?? null,
      })
    }

    cache.set(ck, { at: Date.now(), markers: list })
    markers.push(...list)
  }

  const inView = markers.filter(
    (m) => m.lng >= bbox[0] && m.lng <= bbox[2] && m.lat >= bbox[1] && m.lat <= bbox[3],
  )

  return NextResponse.json({
    gus,
    months,
    total: inView.length,
    inZone: inView.filter((m) => m.zoneId).length,
    // 구역 안 거래를 먼저 보낸다 — 라벨 자리가 모자라면 그쪽이 남아야 한다
    markers: inView
      .sort((a, b) => {
        const az = a.zoneId ? 1 : 0
        const bz = b.zoneId ? 1 : 0
        return bz - az || b.dealDate.localeCompare(a.dealDate)
      })
      .slice(0, 400),
    _meta: {
      source: '국토교통부 실거래가 (연립다세대·단독다가구·토지)',
      note: '지번마다 최근 거래 1건입니다. 아파트는 대지지분이 없어 단지 레이어에서 따로 봅니다.',
    },
  })
}
