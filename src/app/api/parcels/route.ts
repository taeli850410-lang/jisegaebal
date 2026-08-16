import { NextResponse } from 'next/server'
import { DEVELOPS } from '@/lib/mock/develops'
import { bboxOf, pointInRing, type Ring } from '@/lib/geo'

/**
 * 필지(지적) 조회 API — bbox 안의 필지를 "벡터"로 내려준다.
 *
 * ⚠️ 왜 래스터 타일이 아니라 벡터인가 (부록 C.1 정정 사항)
 * 카카오맵은 자체 좌표계(WCONGNAMUL 기반)의 타일 스킴을 쓰기 때문에,
 * V-World 등 표준 Web Mercator XYZ 타일을 kakao.maps.Tileset에 그대로 얹으면
 * 타일이 어긋난다. 반면 LatLng 기반 Polygon 오버레이는 투영에 무관하게 정확히 맞는다.
 * 게다가 우리는 필지별 클릭(PNU 획득)과 색상 제어(노후도·물딱지)가 필요하므로
 * 벡터가 요구사항에도 부합한다.
 *
 * 실제 구현에서는 PostGIS:
 *   SELECT pnu, ST_AsGeoJSON(geom), approval_year, ...
 *   FROM parcel WHERE geom && ST_MakeEnvelope($1,$2,$3,$4, 4326)
 */

export interface Parcel {
  pnu: string
  developId: number
  jibun: string
  ring: Ring
  /** 건축물 사용승인연도 (없으면 나대지) */
  approvalYear: number | null
  areaM2: number
  /** 권리산정기준일 이후 신축 — 물딱지 경보 대상 (F-28) */
  postRightsBaseDate: boolean
}

const GRID = 0.00042 // 약 35~45m 격자 — 도시형 필지 스케일 근사

function buildParcels(): Parcel[] {
  const out: Parcel[] = []

  for (const d of DEVELOPS) {
    const [minLng, minLat, maxLng, maxLat] = bboxOf(d.ring)
    const rightsBaseYear = Number(d.stats.rightsBaseDate.slice(0, 4))
    let n = 0

    for (let lng = minLng; lng <= maxLng; lng += GRID * 1.28) {
      for (let lat = minLat; lat <= maxLat; lat += GRID) {
        const cx = lng + GRID * 0.64
        const cy = lat + GRID * 0.5
        if (!pointInRing(cx, cy, d.ring)) continue

        n++
        // 결정적 의사난수로 사용승인연도 분포를 만든다 (노후도 비율에 맞춰 편향)
        const r = Math.abs(Math.sin(d.id * 7.13 + n * 3.77))
        const isVacant = r > 0.94
        const aged = r < d.stats.agingNow / 100
        const approvalYear = isVacant
          ? null
          : aged
            ? 1968 + Math.floor(r * 100) % 28 // 1968~1995
            : 1996 + Math.floor(r * 1000) % 30 // 1996~2025

        // 필지를 격자보다 살짝 줄여 경계선이 보이게 한다
        const pad = GRID * 0.06
        const ring: Ring = [
          [lng + pad * 1.28, lat + pad],
          [lng + GRID * 1.28 - pad * 1.28, lat + pad],
          [lng + GRID * 1.28 - pad * 1.28, lat + GRID - pad],
          [lng + pad * 1.28, lat + GRID - pad],
          [lng + pad * 1.28, lat + pad],
        ]

        out.push({
          pnu: `1159010${String(d.id).padStart(4, '0')}${String(n).padStart(4, '0')}`,
          developId: d.id,
          jibun: `${d.name.replace(/[()가-힣]*동?\s?/, '') || '사당동'} ${100 + n}-${(n % 40) + 1}`,
          ring,
          approvalYear,
          areaM2: Math.round(120 + (r * 260)),
          postRightsBaseDate: approvalYear !== null && approvalYear > rightsBaseYear,
        })
      }
    }
  }

  return out
}

// 목업이므로 모듈 로드 시 1회만 생성해 캐시한다
const ALL_PARCELS = buildParcels()

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const bbox = searchParams.get('bbox') // minLng,minLat,maxLng,maxLat

  if (!bbox) {
    return NextResponse.json({ error: 'bbox 파라미터가 필요합니다.' }, { status: 400 })
  }

  const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number)
  if ([minLng, minLat, maxLng, maxLat].some(Number.isNaN)) {
    return NextResponse.json({ error: 'bbox 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const parcels = ALL_PARCELS.filter((p) => {
    const [pMinLng, pMinLat, pMaxLng, pMaxLat] = bboxOf(p.ring)
    return pMaxLng >= minLng && pMinLng <= maxLng && pMaxLat >= minLat && pMinLat <= maxLat
  })

  return NextResponse.json({
    parcels,
    count: parcels.length,
    // 기획서 4.4 — 모든 수치에 신뢰도 등급과 출처를 함께 내려준다
    _meta: {
      source: '국가공간정보포털 연속지적도 (목업)',
      grade: 'A',
      updatedAt: '2026-08-01',
    },
  })
}
