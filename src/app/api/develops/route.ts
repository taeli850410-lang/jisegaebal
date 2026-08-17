import { NextResponse } from 'next/server'
import { queryDevelops } from '@/lib/server/developStore'
import { querySites } from '@/lib/server/siteStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/develops?bbox=minLng,minLat,maxLng,maxLat&level=5&types=redev,garo
 *
 * 벤치마크(재개발닷컴)와 동일하게 뷰포트 단위로 구역을 내려준다.
 * 레벨에 따라 지오메트리 단순화 강도를 바꿔 페이로드를 조절한다.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const bboxParam = searchParams.get('bbox')
  if (!bboxParam) {
    return NextResponse.json({ error: 'bbox 파라미터가 필요합니다.' }, { status: 400 })
  }

  const parts = bboxParam.split(',').map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return NextResponse.json({ error: 'bbox 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const level = Number(searchParams.get('level') ?? 5)
  const types = searchParams.get('types')?.split(',').filter(Boolean)
  const stages = searchParams.get('stages')?.split(',').filter(Boolean)

  const bbox = parts as [number, number, number, number]
  const lv = Number.isNaN(level) ? 5 : level

  const result = queryDevelops({ bbox, level: lv, projectTypes: types, stages })

  /**
   * 경계 없는 사업장(가로주택·소규모·지역주택 등)은 점으로 같이 내려준다.
   * 축소된 화면에서는 점이 수백 개 찍혀 지도를 덮으므로 확대했을 때만 붙인다.
   */
  const sites = lv <= 5 ? querySites(bbox, { projectTypes: types, stages }) : []

  return NextResponse.json({
    ...result,
    sites,
    _meta: {
      source:
        '경계: 서울 열린데이터광장 의제처리구역(UPIS_C_UQ181) / 진행단계·사업장: 서울시 정비사업 정보몽땅',
      license: '공공누리 1유형(출처표시)',
      grade: 'A',
      note: '구역 경계는 참고자료이며 법적 효력이 없습니다. 진행단계는 대표지번 공간조인으로 연결한 값입니다. 가로주택·소규모·지역주택 사업은 정비구역 고시가 없어 경계 데이터가 존재하지 않으므로 대표지번 위치에 점으로 표시합니다.',
    },
  })
}
