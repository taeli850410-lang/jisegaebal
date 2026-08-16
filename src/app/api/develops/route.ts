import { NextResponse } from 'next/server'
import { queryDevelops } from '@/lib/server/developStore'

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

  const result = queryDevelops({
    bbox: parts as [number, number, number, number],
    level: Number.isNaN(level) ? 5 : level,
    projectTypes: types,
  })

  return NextResponse.json({
    ...result,
    _meta: {
      source: '서울 열린데이터광장 · 서울시 의제처리구역 위치정보(UPIS_C_UQ181)',
      license: '공공누리 1유형(출처표시)',
      grade: 'A',
      note: '구역 경계는 참고자료이며 법적 효력이 없습니다.',
    },
  })
}
