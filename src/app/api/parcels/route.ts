import { NextResponse } from 'next/server'
import { queryDevelops, type StoredDevelop } from '@/lib/server/developStore'
import { fetchParcels, hasVWorld, ringAreaM2 } from '@/lib/server/vworld'
import { outerRings } from '@/lib/types'

/**
 * 필지(지적) 조회 API — bbox 안의 필지를 "벡터"로 내려준다.
 *
 * 원본은 국토교통부 연속지적도(V-World WFS)다.
 * 못 가져오면 빈 배열과 unavailable 을 돌려준다 — 예전에는 격자 목업으로
 * 떨어졌는데, 가짜 필지가 진짜처럼 보여서 V-World 가 통째로 막힌 걸
 * 한참 눈치채지 못했다.
 *
 * 왜 래스터 타일이 아니라 벡터인가
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

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
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

  /* ── ② 실패하면 아무것도 그리지 않는다 ──
     예전에는 격자 목업으로 떨어졌다. 그런데 가짜 필지가 진짜처럼 보여서,
     Vercel 리전 문제로 V-World 가 통째로 막혔을 때 한참을 눈치채지 못했다.
     못 가져왔으면 못 가져왔다고 말하는 편이 낫다. */
  return NextResponse.json({
    parcels: [],
    count: 0,
    unavailable: hasVWorld() ? 'FETCH_FAILED' : 'NO_KEY',
    _meta: {
      source: '필지: 국토교통부 연속지적도(V-World WFS)',
      grade: null,
      note: hasVWorld()
        ? 'V-World 연속지적도를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : 'V-World 인증키가 설정되지 않았습니다.',
    },
  })
}
