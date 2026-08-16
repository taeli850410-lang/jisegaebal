import { NextResponse } from 'next/server'
import { browseDevelops, guCounts } from '@/lib/server/developStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/develops/browse?gu=마포구&sort=notice&limit=50
 * GET /api/develops/browse?ids=a,b,c        (관심·조회순 — 순서 유지)
 * GET /api/develops/browse?meta=gu          (자치구 목록 + 구역 수)
 *
 * 지도 뷰포트와 무관한 목록 조회. 사이드 패널(인기·관심·신규·지역별)이 쓴다.
 * 지오메트리를 빼서 응답을 가볍게 유지한다.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  if (searchParams.get('meta') === 'gu') {
    return NextResponse.json({ gus: guCounts() })
  }

  const ids = searchParams.get('ids')?.split(',').filter(Boolean)
  const gu = searchParams.get('gu') ?? undefined
  const sortParam = searchParams.get('sort')
  const sort =
    sortParam === 'name' || sortParam === 'area' || sortParam === 'notice' ? sortParam : 'notice'
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 50) || 50)

  const result = browseDevelops({ gu, ids, sort, limit })

  return NextResponse.json({
    ...result,
    _meta: {
      source:
        '경계·고시일: 서울 열린데이터광장 의제처리구역 / 진행단계: 서울시 정비사업 정보몽땅 / 자치구: 좌표 역지오코딩',
      note: '고시일은 고시 일련번호에서 추출한 값입니다.',
    },
  })
}
