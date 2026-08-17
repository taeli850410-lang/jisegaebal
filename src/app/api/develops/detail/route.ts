import { NextResponse } from 'next/server'
import { getAllDevelops } from '@/lib/server/developStore'
import { findSite } from '@/lib/server/siteStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/develops/detail?id=...
 *
 * 사이드 패널에서 고른 구역은 현재 필터·뷰포트 결과에 없을 수 있다.
 * (예: 진행단계 필터가 걸려 있거나, 상위 N개 제한에 잘린 경우)
 * 그때도 상세를 열 수 있도록 id로 직접 조회한다.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  // 경계 없는 사업장 — 면적·고시번호가 원본에 없으므로 0/null 로 정직하게 비운다
  if (id.startsWith('site-')) {
    const s = findSite(id)
    if (!s) return NextResponse.json({ error: '사업장을 찾을 수 없습니다.' }, { status: 404 })
    const [lng, lat] = s.center
    return NextResponse.json({
      id: s.id,
      name: s.name,
      projectType: s.projectType,
      rawLabel: s.bizType,
      areaM2: 0,
      noticeSn: null,
      stage: s.stage,
      canonicalStage: s.canonicalStage,
      stageSiteName: s.name,
      stageBizType: s.bizType,
      stageMatchBy: null,
      gu: s.gu,
      jibun: s.jibun,
      cafeUrl: s.cafeUrl,
      hasBoundary: false,
      precision: s.precision,
      bbox: [lng, lat, lng, lat],
      geometry: { type: 'Polygon' as const, coordinates: [] },
    })
  }

  const d = getAllDevelops().find((x) => x.id === id)
  if (!d) return NextResponse.json({ error: '구역을 찾을 수 없습니다.' }, { status: 404 })

  return NextResponse.json({
    id: d.id,
    name: d.name,
    projectType: d.projectType,
    rawLabel: d.rawLabel,
    areaM2: d.areaM2,
    noticeSn: d.noticeSn,
    stage: d.stage ?? null,
    canonicalStage: d.canonicalStage ?? null,
    stageSiteName: d.stageSiteName ?? null,
    stageBizType: d.stageBizType ?? null,
    stageMatchBy: d.stageMatchBy ?? null,
    gu: d.gu ?? null,
    bbox: d.bbox,
    // 상세 패널은 지오메트리를 쓰지 않으므로 빈 폴리곤을 돌려 응답을 가볍게 유지한다
    geometry: { type: 'Polygon' as const, coordinates: [] },
  })
}
