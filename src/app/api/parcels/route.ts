import { NextResponse } from 'next/server'
import { queryDevelops, type StoredDevelop } from '@/lib/server/developStore'
import { fetchParcels, hasVWorld, ringAreaM2 } from '@/lib/server/vworld'
import { outerRings } from '@/lib/types'

/**
 * 필지(지적) 조회 API — bbox 안의 필지를 "벡터"로 내려준다.
 *
 * ⚠️ 현재 필지 자체는 목업이다.
 * 실제 구역 경계(서울시 의제처리구역 SHP) 안에 격자를 채워 생성한다.
 * 연속지적도(D-03)를 적재하면 이 생성 로직만 PostGIS 쿼리로 교체하면 된다.
 *
 * ⚠️ 왜 래스터 타일이 아니라 벡터인가
 * 카카오맵은 자체 좌표계 타일 스킴을 쓰기 때문에 표준 Web Mercator XYZ 타일을
 * kakao.maps.Tileset에 얹으면 어긋난다. LatLng 기반 Polygon은 투영에 무관하다.
 * 필지별 클릭(PNU)과 색상 제어(노후도·물딱지)에도 벡터가 맞다.
 */

export const dynamic = 'force-dynamic'

export interface Parcel {
  pnu: string
  developId: string
  jibun: string
  ring: [number, number][]
  approvalYear: number | null
  areaM2: number
  /** 개별공시지가 (원/㎡) — 연속지적도에서만 채워진다 */
  landPrice?: number | null
  postRightsBaseDate: boolean
}

const GRID = 0.00042 // 약 35~45m 격자 — 도시형 필지 스케일 근사

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

const cache = new Map<string, Parcel[]>()

function parcelsFor(d: {
  id: string
  name: string
  bbox: [number, number, number, number]
  geometry: StoredDevelop['geometry']
}): Parcel[] {
  const cached = cache.get(d.id)
  if (cached) return cached

  const rings = outerRings(d.geometry)
  const [minLng, minLat, maxLng, maxLat] = d.bbox
  const out: Parcel[] = []
  let n = 0

  // 아주 큰 구역에서 격자가 폭발하지 않도록 상한을 둔다
  const MAX = 1200

  for (let lng = minLng; lng <= maxLng && out.length < MAX; lng += GRID * 1.28) {
    for (let lat = minLat; lat <= maxLat && out.length < MAX; lat += GRID) {
      const cx = lng + GRID * 0.64
      const cy = lat + GRID * 0.5
      if (!rings.some((r) => pointInRing(cx, cy, r))) continue

      n++
      const r = Math.abs(Math.sin(n * 3.77 + d.id.length * 7.13))
      const isVacant = r > 0.94
      const aged = r < 0.62
      const approvalYear = isVacant
        ? null
        : aged
          ? 1968 + (Math.floor(r * 100) % 28)
          : 1996 + (Math.floor(r * 1000) % 30)

      const pad = GRID * 0.06
      out.push({
        pnu: `${d.id.slice(-8)}${String(n).padStart(4, '0')}`,
        developId: d.id,
        jibun: `${d.name.slice(0, 10)} ${100 + n}-${(n % 40) + 1}`,
        ring: [
          [lng + pad * 1.28, lat + pad],
          [lng + GRID * 1.28 - pad * 1.28, lat + pad],
          [lng + GRID * 1.28 - pad * 1.28, lat + GRID - pad],
          [lng + pad * 1.28, lat + GRID - pad],
          [lng + pad * 1.28, lat + pad],
        ],
        approvalYear,
        areaM2: Math.round(120 + r * 260),
        // 권리산정기준일 데이터가 아직 없어 임시 규칙을 쓴다
        postRightsBaseDate: approvalYear !== null && approvalYear >= 2022,
      })
    }
  }

  cache.set(d.id, out)
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bboxParam = searchParams.get('bbox')

  if (!bboxParam) {
    return NextResponse.json({ error: 'bbox 파라미터가 필요합니다.' }, { status: 400 })
  }

  const bbox = bboxParam.split(',').map(Number) as [number, number, number, number]
  if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    return NextResponse.json({ error: 'bbox 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  // 화면 안의 구역만 대상으로 필지를 만든다
  const { develops } = queryDevelops({ bbox, level: 3, limit: 40 })

  /* ── ① V-World 연속지적도 (실데이터) ── */
  if (hasVWorld()) {
    // bbox 를 소수 4자리로 눌러 캐시 키를 안정시킨다 (지도를 조금 움직여도 재사용)
    const k = bbox.map((v) => v.toFixed(4)).join(',')
    const real = await fetchParcels(bbox, k)
    if (real?.length) {
      // 구역 경계 안쪽 필지에만 developId 를 붙인다 — 색칠·집계 대상 구분용
      const zones = develops.map((d) => ({ id: d.id, rings: outerRings(d.geometry) }))
      const parcels: Parcel[] = real.map((p) => {
        let cx = 0
        let cy = 0
        for (const [x, y] of p.ring) {
          cx += x
          cy += y
        }
        cx /= p.ring.length
        cy /= p.ring.length
        const hit = zones.find((z) => z.rings.some((r) => pointInRing(cx, cy, r)))
        return {
          pnu: p.pnu,
          developId: hit?.id ?? '',
          jibun: p.jibun,
          ring: p.ring,
          // 사용승인연도는 건축물대장이 있어야 안다. 아직 안 붙였으므로 비운다.
          approvalYear: null,
          areaM2: Math.round(ringAreaM2(p.ring)),
          landPrice: p.jiga,
          postRightsBaseDate: false,
        }
      })
      return NextResponse.json({
        parcels,
        count: parcels.length,
        _meta: {
          source: '필지: 국토교통부 연속지적도(V-World WFS) / 구역: 서울시 의제처리구역',
          grade: 'A',
          note: '공시지가는 연속지적도에 포함된 개별공시지가(원/㎡)입니다. 사용승인연도(노후도)는 아직 연동되지 않았습니다.',
        },
      })
    }
  }

  /* ── ② 실패하거나 키가 없으면 목업으로 떨어진다 ── */
  const parcels: Parcel[] = []
  for (const d of develops) {
    for (const p of parcelsFor(d)) {
      const [l, t] = p.ring[0]
      const [r2, b2] = p.ring[2]
      if (r2 >= bbox[0] && l <= bbox[2] && b2 >= bbox[1] && t <= bbox[3]) parcels.push(p)
    }
    if (parcels.length > 4000) break
  }

  return NextResponse.json({
    parcels,
    count: parcels.length,
    _meta: {
      source: '구역 경계는 서울시 의제처리구역(실데이터), 필지는 목업',
      grade: 'D',
      note: '연속지적도 적재 시 실제 필지로 교체됩니다.',
    },
  })
}
