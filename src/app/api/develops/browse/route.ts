import { NextResponse } from 'next/server'
import { browseDevelops, guCounts, type DevelopBrief } from '@/lib/server/developStore'
import { findSite, siteGuCounts, sitesInGu, type SiteBrief } from '@/lib/server/siteStore'

export const dynamic = 'force-dynamic'

const META = {
  source:
    '경계·고시일: 서울 열린데이터광장 의제처리구역 / 진행단계·사업장: 서울시 정비사업 정보몽땅 / 자치구: 좌표 역지오코딩',
  note: '고시일은 고시 일련번호에서 추출한 값입니다. 경계가 없는 사업장(가로주택·소규모·지역주택 등)은 면적·고시일이 원본에 없어 비어 있습니다.',
}

function mapSite(id: string) {
  const s = findSite(id)
  return s ? siteToBrief(s) : undefined
}

/**
 * 경계 없는 사업장을 목록 레코드 모양으로 맞춘다.
 *
 * 면적·고시일은 원본에 없다. 0/null 로 채우면 "0㎡ 구역"처럼 보이므로
 * areaM2 는 0, noticeDate 는 null 로 두고 화면에서 hasBoundary 를 보고 감춘다.
 */
function siteToBrief(s: SiteBrief): DevelopBrief & { hasBoundary: false; bizType: string } {
  const [lng, lat] = s.center
  return {
    id: s.id,
    name: s.name,
    projectType: s.projectType,
    rawLabel: s.bizType,
    areaM2: 0,
    gu: s.gu,
    dong: s.jibun.split(/\s+/)[0] ?? null,
    noticeDate: null,
    stage: s.stage,
    canonicalStage: s.canonicalStage,
    center: [lng, lat],
    bbox: [lng, lat, lng, lat],
    hasBoundary: false,
    bizType: s.bizType,
  }
}

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
    // 경계 없는 사업장도 목록에 나오므로 자치구 개수에 함께 센다
    const extra = siteGuCounts()
    const gus = guCounts().map((g) => ({ ...g, count: g.count + (extra.get(g.gu) ?? 0) }))
    const known = new Set(gus.map((g) => g.gu))
    for (const [gu, count] of extra) if (!known.has(gu)) gus.push({ gu, count })
    return NextResponse.json({ gus: gus.sort((a, b) => a.gu.localeCompare(b.gu, 'ko')) })
  }

  const ids = searchParams.get('ids')?.split(',').filter(Boolean)
  const gu = searchParams.get('gu') ?? undefined
  const sortParam = searchParams.get('sort')
  const sort =
    sortParam === 'name' || sortParam === 'area' || sortParam === 'notice' ? sortParam : 'notice'
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 50) || 50)

  if (ids?.length) {
    // 관심·조회순은 요청한 순서가 곧 의미다. 구역과 사업장을 섞어 순서대로 되돌린다.
    const zoneIds = ids.filter((id) => !id.startsWith('site-'))
    const zones = new Map(
      browseDevelops({ ids: zoneIds }).items.map((d) => [d.id, d as DevelopBrief]),
    )
    const items = ids
      .map((id) => (id.startsWith('site-') ? mapSite(id) : zones.get(id)))
      .filter((x): x is DevelopBrief => !!x)
    return NextResponse.json({ total: items.length, items, _meta: META })
  }

  const zones = browseDevelops({ gu, sort, limit })
  const sites = sitesInGu(gu).map(siteToBrief)

  /**
   * 사업장은 고시일·면적이 없어 정렬 키가 비어 있다.
   * 고시일순·면적순에서는 뒤로 밀리고, 이름순에서만 섞인다 — 빈 값을 위로 올려
   * "최신"인 척하게 두지 않는다.
   */
  let items: DevelopBrief[]
  if (sort === 'name') {
    items = [...zones.items, ...sites].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  } else {
    items = [...zones.items, ...sites.sort((a, b) => a.name.localeCompare(b.name, 'ko'))]
  }

  return NextResponse.json({
    total: zones.total + sites.length,
    items: items.slice(0, limit),
    _meta: META,
  })
}
