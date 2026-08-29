import { NextResponse } from 'next/server'
import { getAllDevelops, type StoredDevelop } from '@/lib/server/developStore'
import { findSite } from '@/lib/server/siteStore'
import { fetchTransactions, lastMolitError, median, type Transaction } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { getAptInfo } from '@/lib/server/aptInfo'
import { stageDurations } from '@/lib/server/stageStats'
import { outerRings } from '@/lib/types'
import { NO_CACHE, cacheHeaders } from '@/lib/server/cacheHeaders'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 구역 상세 한 번에 가져오기 — 상세 화면이 여러 번 왕복하지 않도록 묶는다.
 *
 * GET /api/develops/full?id=...
 *   { zone, deals, series, volume, nearby }
 */

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function centerOf(z: StoredDevelop): [number, number] {
  return z.center ?? [(z.bbox[0] + z.bbox[2]) / 2, (z.bbox[1] + z.bbox[3]) / 2]
}

/** 위도 37도 기준 대략적인 거리(km) — 인근 구역 정렬에만 쓰므로 이 정도면 충분하다 */
function roughKm(a: [number, number], b: [number, number]) {
  const dx = (a[0] - b[0]) * 88.8
  const dy = (a[1] - b[1]) * 111
  return Math.sqrt(dx * dx + dy * dy)
}

const MONTHS = 24

/**
 * 경계 없는 사업장의 실거래 판정 반경(km).
 *
 * 구역은 폴리곤 안팎으로 딱 갈리지만 사업장은 대표지번 한 점밖에 없다.
 * 가로주택·소규모재건축은 보통 한 블록(수십~150m) 규모라 250m 로 잡았다.
 * 정확한 경계가 아니라 "이 근처"라는 점은 응답 note 에 밝힌다.
 */
const SITE_RADIUS_KM = 0.25

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const all = getAllDevelops()

  /**
   * 경계 없는 사업장도 같은 화면을 쓴다.
   * 구역 모양으로 맞추되 없는 값을 지어내지 않는다 — 면적 0, 고시 null,
   * geometry 는 빈 폴리곤. 아래 실거래 판정이 "링이 비면 반경"으로 갈라진다.
   */
  const site = id.startsWith('site-') ? findSite(id) : undefined
  const zone: StoredDevelop | undefined = site
    ? {
        id: site.id,
        name: site.name,
        projectType: site.projectType,
        rawLabel: site.bizType,
        classCode: null,
        areaM2: 0,
        noticeSn: null,
        sigungu: null,
        bbox: [site.center[0], site.center[1], site.center[0], site.center[1]],
        geometry: { type: 'Polygon', coordinates: [] },
        center: site.center,
        gu: site.gu,
        dong: site.jibun.split(/\s+/)[0],
        stage: site.stage ?? undefined,
        canonicalStage: site.canonicalStage,
        stageSiteName: site.name,
        stageBizType: site.bizType,
      }
    : all.find((z) => z.id === id)
  if (!zone) return NextResponse.json({ error: '구역을 찾을 수 없습니다.' }, { status: 404 })

  /* ── 인근 구역 ── */
  const c = centerOf(zone)
  const around = all
    .filter((z) => z.id !== zone.id && z.gu === zone.gu)
    .map((z) => ({ z, km: roughKm(c, centerOf(z)) }))
    .filter((x) => x.km <= 3)
    .sort((a, b) => a.km - b.km)

  const briefZone = (z: StoredDevelop, km: number) => ({
    id: z.id,
    name: z.name,
    projectType: z.projectType,
    rawLabel: z.rawLabel,
    stage: z.stage ?? null,
    canonicalStage: z.canonicalStage ?? null,
    areaM2: z.areaM2,
    noticeDate: z.noticeDate ?? null,
    distanceKm: Math.round(km * 10) / 10,
    bbox: z.bbox,
  })

  const nearby = around.slice(0, 5).map(({ z, km }) => ({
    ...briefZone(z, km),
    // 비교표용 — 정비몽땅 사업개요가 있는 구역만 채워진다
    memberCount: z.summary?.memberCount ?? null,
    far: z.summary?.far ?? null,
    bcr: z.summary?.bcr ?? null,
    floors: z.summary?.floors ?? null,
  }))

  /* ── 신축 공사 ──
     착공한 뒤로는 "언제 입주하나"가 관심사다. 건축인허가 API 는 우리 키에
     미등록이라, 이미 가진 두 가지로 만든다.
       ① 인근 정비구역 중 착공·준공 단계인 곳 (정비몽땅 추진경과 인가일)
       ② 인근 아파트 중 최근 준공된 단지 (건축물대장 사용승인일) — 아래에서 붙인다 */
  const constructionZones = around
    .map(({ z, km }) => ({
      ...briefZone(z, km),
      startDate: z.progress?.dates?.construction?.date ?? null,
      completeDate: z.progress?.dates?.completed?.date ?? null,
    }))
    .filter(
      (z) =>
        // 착공 중이거나, 착공·준공 날짜를 아는 구역만.
        // 조합해산·청산도 canonicalStage가 completed라 날짜 없이 걸려 들어온다.
        z.canonicalStage === 'construction' || z.startDate || z.completeDate,
    )
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    .slice(0, 8)

  /* ── 이 구역의 실거래 ── */
  let deals: Transaction[] = []
  let unavailable: string | null = null

  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    unavailable = 'NO_KEY'
  } else if (!zone.gu) {
    unavailable = 'NO_GU'
  } else {
    const all24 = await fetchTransactions(zone.gu, MONTHS)
    const queries = [...new Set(all24.map((t) => `서울 ${zone.gu} ${t.dong} ${t.jibun}`))]
    const coords = await geocodeMany(queries, 60)
    const rings = outerRings(zone.geometry)

    deals = all24.filter((t) => {
      const pt = coords.get(`서울 ${zone.gu} ${t.dong} ${t.jibun}`)
      if (!pt) return false
      const [lng, lat] = pt
      // 경계가 없는 사업장은 폴리곤 판정이 불가능하다 — 대표지번 반경으로 잡는다
      if (!rings.length) return roughKm(c, [lng, lat]) <= SITE_RADIUS_KM
      if (lng < zone.bbox[0] || lng > zone.bbox[2] || lat < zone.bbox[1] || lat > zone.bbox[3])
        return false
      return rings.some((r) => pointInRing(lng, lat, r))
    })
  }

  // 거래 0건이 진짜 0건인지, 포털이 막은 건지 가른다
  if (!unavailable && deals.length === 0) {
    const err = lastMolitError()
    if (err) unavailable = err
  }

  /* ── 인근 아파트 ──
     아파트는 대지지분이 없어 구역 실거래에는 넣지 않지만,
     "이 구역이 완성되면 얼마쯤 되나"의 기준점이라 별도로 보여준다. */
  const apartments: {
    name: string
    buildYear: number | null
    ageYears: number | null
    distanceKm: number
    households: number | null
    buildings: number | null
    useApprovalDate: string | null
    areas: { pyeong: number; exclusiveAr: number; price: number; dealDate: string }[]
  }[] = []

  if (zone.gu && process.env.DATA_GO_KR_SERVICE_KEY) {
    const aptDeals = await fetchTransactions(zone.gu, 12, ['apt'])
    const queries = [...new Set(aptDeals.map((t) => `서울 ${zone.gu} ${t.dong} ${t.jibun}`))]
    const aptCoords = await geocodeMany(queries, 40)

    // 단지별로 묶고, 구역 중심에서 가까운 순으로 추린다
    const byApt = new Map<string, { deals: typeof aptDeals; km: number }>()
    for (const t of aptDeals) {
      if (!t.buildingName) continue
      const pt = aptCoords.get(`서울 ${zone.gu} ${t.dong} ${t.jibun}`)
      if (!pt) continue
      const km = roughKm(c, pt)
      if (km > 1.5) continue
      const cur = byApt.get(t.buildingName)
      if (cur) cur.deals.push(t)
      else byApt.set(t.buildingName, { deals: [t], km })
    }

    const thisYear = new Date().getFullYear()
    const picked = [...byApt.entries()].sort((a, b) => a[1].km - b[1].km).slice(0, 6)

    // 세대수·동수는 건축물대장 총괄표제부에서 가져온다 (K-apt 미등록 대체 경로)
    const infos = await Promise.all(
      picked.map(([, { deals: ds }]) => {
        const d = ds[0]
        return getAptInfo(zone.gu!, d.dong, d.jibun).catch(() => null)
      }),
    )

    for (let idx = 0; idx < picked.length; idx++) {
      const [name, { deals: ds, km }] = picked[idx]
      const info = infos[idx]
      // 전용면적대별 최근 거래 1건씩
      const byArea = new Map<number, (typeof ds)[number]>()
      for (const d of ds) {
        if (!d.exclusiveAr) continue
        const key = Math.round(d.exclusiveAr)
        const prev = byArea.get(key)
        if (!prev || d.dealDate > prev.dealDate) byArea.set(key, d)
      }
      // 사용승인일이 있으면 그쪽이 정확하다 (실거래 buildYear 는 연도만 준다)
      const approvalYear = info?.useApprovalDate ? Number(info.useApprovalDate.slice(0, 4)) : null
      const buildYear = approvalYear ?? ds.find((d) => d.buildYear)?.buildYear ?? null

      apartments.push({
        name,
        buildYear,
        ageYears: buildYear ? thisYear - buildYear : null,
        distanceKm: Math.round(km * 10) / 10,
        households: info?.households ?? null,
        buildings: info?.buildings ?? null,
        useApprovalDate: info?.useApprovalDate ?? null,
        areas: [...byArea.entries()]
          .sort((a, b) => a[0] - b[0])
          .slice(0, 3)
          .map(([, d]) => ({
            pyeong: Math.round((d.exclusiveAr! / 3.3058) * 10) / 10,
            exclusiveAr: d.exclusiveAr!,
            price: d.price,
            dealDate: d.dealDate,
          })),
      })
    }
  }

  /* ── 월별 시계열 (중앙 대지평당가 + 거래량) ── */
  const now = new Date()
  const ymKeys: string[] = []
  for (let i = MONTHS - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  // 유형을 섞어 하나의 중앙값만 주면 다세대와 단독이 평균으로 뭉개진다.
  // 차트에서 계열을 나눠 그릴 수 있도록 유형별 값도 같이 내려준다.
  const kinds = [...new Set(deals.map((d) => d.kind))]
  const series = ymKeys.map((ym) => {
    const inMonth = deals.filter((d) => d.dealDate.startsWith(ym))
    const byKind: Record<string, number | null> = {}
    for (const k of kinds) {
      byKind[k] = median(inMonth.filter((d) => d.kind === k).map((d) => d.pricePerLandPyeong ?? NaN))
    }
    return {
      ym,
      value: median(inMonth.map((d) => d.pricePerLandPyeong ?? NaN)),
      // 거래가격(총액) 중앙값 — 평당가와 번갈아 볼 수 있게
      price: median(inMonth.map((d) => d.price)),
      byKind,
      count: inMonth.length,
    }
  })

  const kindLabels: Record<string, string> = {}
  for (const k of kinds) kindLabels[k] = deals.find((d) => d.kind === k)!.typeLabel

  const payload = {
    zone: {
      id: zone.id,
      name: zone.name,
      projectType: zone.projectType,
      rawLabel: zone.rawLabel,
      stage: zone.stage ?? null,
      canonicalStage: zone.canonicalStage ?? null,
      stageSiteName: zone.stageSiteName ?? null,
      stageBizType: zone.stageBizType ?? null,
      stageMatchBy: zone.stageMatchBy ?? null,
      areaM2: zone.areaM2,
      gu: zone.gu ?? null,
      dong: zone.dong ?? null,
      noticeSn: zone.noticeSn,
      noticeDate: zone.noticeDate ?? null,
      bbox: zone.bbox,
      // 정비몽땅 사업개요 제원 / 추진경과 인가일 (없는 구역은 null)
      summary: zone.summary ?? null,
      progress: zone.progress ?? null,
      // 연속지적도 + 건축물대장 산출 (아직 계산 안 된 구역은 null)
      stats: zone.stats ?? null,
      // 정비몽땅 사업개요의 공급계획·공동이용시설·추진주체
      plan: zone.plan ?? null,
      // 경계 없는 사업장인지 — 화면이 "면적 0㎡"를 진짜 값처럼 그리지 않도록 알린다
      hasBoundary: !site,
      ...(site && { jibun: site.jibun, precision: site.precision, cafeUrl: site.cafeUrl }),
    },
    deals: deals.slice(0, 60),
    dealCount: deals.length,
    medianPerPyeong: median(deals.map((d) => d.pricePerLandPyeong ?? NaN)),
    series,
    kindLabels,
    nearby,
    apartments,
    constructionZones,
    // 단계별 중앙 체류기간 — "1개월째"가 빠른지 느린지 비교 기준이 된다
    stageDurations: stageDurations(),
    unavailable,
    _meta: {
      source: site
        ? '사업장: 서울시 정비사업 정보몽땅 / 실거래: 국토교통부'
        : '경계: 서울시 의제처리구역 / 단계: 정비사업 정보몽땅 / 실거래: 국토교통부',
      note: site
        ? `이 사업장은 정비구역 고시가 없어 경계 데이터가 존재하지 않습니다. 실거래는 대표지번(${zone.gu} ${site.jibun})에서 반경 ${SITE_RADIUS_KM * 1000}m 안의 건만 집계한 근사값이며, 구역 면적·용적률 등 제원은 원본에 없습니다.`
        : '실거래는 지번 지오코딩 후 구역 경계 안으로 판정된 건만 집계합니다.',
    },
  }
  /*
   * 조회가 실패한 응답은 캐시하지 않는다.
   * unavailable 이 담긴 답을 CDN 이 하루 동안 돌려주면, 원인이 사라진 뒤에도
   * 계속 "가져올 수 없습니다"를 보게 된다.
   */
  return NextResponse.json(payload, {
    headers: payload.unavailable ? NO_CACHE : cacheHeaders('hourly'),
  })
}
