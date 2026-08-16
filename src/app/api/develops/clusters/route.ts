import { NextResponse } from 'next/server'
import { clusterDevelops } from '@/lib/server/developStore'

export const dynamic = 'force-dynamic'

/**
 * GET /api/develops/clusters?bbox=minLng,minLat,maxLng,maxLat&by=dong&types=&stages=
 *
 * 축소했을 때 개별 구역 대신 내려주는 지역별 집계.
 * 필터는 /api/develops 와 같은 파라미터를 받아 배지 숫자가 필터와 어긋나지 않게 한다.
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

  const by = searchParams.get('by') === 'gu' ? 'gu' : 'dong'

  const clusters = clusterDevelops({
    bbox: parts as [number, number, number, number],
    by,
    projectTypes: searchParams.get('types')?.split(',').filter(Boolean),
    stages: searchParams.get('stages')?.split(',').filter(Boolean),
  })

  return NextResponse.json({
    by,
    clusters,
    total: clusters.reduce((s, c) => s + c.count, 0),
  })
}
