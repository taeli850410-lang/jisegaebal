import { NextResponse } from 'next/server'
import { fetchTransactions, lastMolitError, median } from '@/lib/server/molit'
import { getAptInfo } from '@/lib/server/aptInfo'
import { getAllDevelops } from '@/lib/server/developStore'
import { geocodeMany } from '@/lib/server/geocode'

/**
 * 아파트 단지 상세 — GET /api/apt-detail?gu=강동구&dong=암사동&jibun=508&name=...
 *
 * 지도에서 단지 마커를 누르면 여기로 온다.
 *
 * 실거래는 전용면적별로 나눈다. 같은 단지라도 59㎡ 와 114㎡ 는 다른 물건이라
 * 하나로 뭉친 "이 단지 시세"는 아무 뜻이 없다.
 *
 * 세대수·준공연도는 건축물대장 총괄표제부에서 온다 (K-apt 미등록 단지 대체 경로).
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 실거래를 얼마나 거슬러 볼지 — 차트의 "전체" 탭이 이 범위다 */
const MONTHS = 120

export interface AreaQuote {
  /** 전용면적(㎡, 정수) */
  area: number
  pyeong: number
  /** 최근 실거래가 */
  latest: number
  latestDate: string
  /** 최근 1년 중앙값 — 최근 1건은 특이 거래일 수 있다 */
  median1y: number | null
  count: number
}

export interface AptDeal {
  dealDate: string
  area: number
  price: number
  floor: number | null
  buildingName: string | null
}

export interface MonthPoint {
  ym: string
  /** 그 달 중앙 거래가 */
  price: number | null
  count: number
}

function roughKm(a: [number, number], b: [number, number]) {
  const dx = (a[0] - b[0]) * 88.8
  const dy = (a[1] - b[1]) * 111
  return Math.sqrt(dx * dx + dy * dy)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gu = searchParams.get('gu')
  const dong = searchParams.get('dong')
  const jibun = searchParams.get('jibun')
  const name = searchParams.get('name')
  if (!gu || !dong || !jibun || !name) {
    return NextResponse.json({ error: 'gu·dong·jibun·name 이 필요합니다.' }, { status: 400 })
  }

  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    return NextResponse.json({ unavailable: 'NO_KEY', error: '실거래 인증키 미설정' }, { status: 503 })
  }

  const all = await fetchTransactions(gu, MONTHS, ['apt'])
  /*
   * 같은 지번에 여러 단지가 있을 수 있고(예: 1·2차), 반대로 한 단지가
   * 여러 지번에 걸치기도 한다. 단지명이 더 안정적인 열쇠라 이름을 우선하고
   * 지번은 같은 이름이 다른 동네에 또 있을 때를 가른다.
   */
  const deals = all.filter((d) => d.buildingName === name && d.dong === dong)
  const unavailable = lastMolitError()

  /* ── 전용면적별 시세 ── */
  const byArea = new Map<number, typeof deals>()
  for (const d of deals) {
    if (!d.exclusiveAr) continue
    const a = Math.round(d.exclusiveAr)
    const cur = byArea.get(a)
    if (cur) cur.push(d)
    else byArea.set(a, [d])
  }

  const yearAgo = (() => {
    const t = new Date()
    t.setFullYear(t.getFullYear() - 1)
    return t.toISOString().slice(0, 10)
  })()

  const quotes: AreaQuote[] = [...byArea.entries()]
    .map(([area, ds]) => {
      const latest = ds.reduce((a, b) => (b.dealDate > a.dealDate ? b : a))
      return {
        area,
        pyeong: Math.round((area / 3.3058) * 10) / 10,
        latest: latest.price,
        latestDate: latest.dealDate,
        median1y: median(ds.filter((d) => d.dealDate >= yearAgo).map((d) => d.price)),
        count: ds.length,
      }
    })
    .sort((a, b) => a.area - b.area)

  /* ── 면적별 월별 시계열 ── */
  const series: Record<number, MonthPoint[]> = {}
  for (const [area, ds] of byArea) {
    const byMonth = new Map<string, number[]>()
    for (const d of ds) {
      const ym = d.dealDate.slice(0, 7)
      const cur = byMonth.get(ym)
      if (cur) cur.push(d.price)
      else byMonth.set(ym, [d.price])
    }
    series[area] = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, ps]) => ({ ym, price: median(ps), count: ps.length }))
  }

  /* ── 단지 제원 ── */
  const info = await getAptInfo(gu, dong, jibun).catch(() => null)
  const approvalYear = info?.useApprovalDate ? Number(info.useApprovalDate.slice(0, 4)) : null
  const buildYear = approvalYear ?? deals.find((d) => d.buildYear)?.buildYear ?? null

  /* ── 인근 정비구역 ──
     아파트를 보는 사람에게 옆 구역의 진행 단계와 대지평당가는
     "여기가 앞으로 어떻게 되나"의 단서다. */
  const pt = (await geocodeMany([`서울 ${gu} ${dong} ${jibun}`], 5)).get(
    `서울 ${gu} ${dong} ${jibun}`,
  )
  const nearby = pt
    ? getAllDevelops()
        .filter((z) => z.gu === gu)
        .map((z) => ({
          z,
          km: roughKm(pt, z.center ?? [(z.bbox[0] + z.bbox[2]) / 2, (z.bbox[1] + z.bbox[3]) / 2]),
        }))
        .filter((x) => x.km <= 1.5)
        .sort((a, b) => a.km - b.km)
        .slice(0, 10)
        .map(({ z, km }) => ({
          id: z.id,
          name: z.name,
          projectType: z.projectType,
          stage: z.stage ?? null,
          canonicalStage: z.canonicalStage ?? null,
          areaM2: z.areaM2,
          distanceKm: Math.round(km * 10) / 10,
          /** 대지평당가 — 구역 통계의 개별공시지가 중앙값 (원/㎡ → 원/평) */
          landPerPyeong: z.stats?.landPrice?.medianPerM2
            ? Math.round(z.stats.landPrice.medianPerM2 * 3.3058)
            : null,
        }))
    : []

  const list: AptDeal[] = deals
    .sort((a, b) => b.dealDate.localeCompare(a.dealDate))
    .slice(0, 300)
    .map((d) => ({
      dealDate: d.dealDate,
      area: Math.round(d.exclusiveAr ?? 0),
      price: d.price,
      floor: d.floor ?? null,
      buildingName: d.buildingName ?? null,
    }))

  return NextResponse.json({
    name,
    gu,
    dong,
    jibun,
    households: info?.households ?? null,
    buildings: info?.buildings ?? null,
    buildYear,
    useApprovalDate: info?.useApprovalDate ?? null,
    ageYears: buildYear ? new Date().getFullYear() - buildYear : null,
    quotes,
    series,
    deals: list,
    dealCount: deals.length,
    nearby,
    unavailable: deals.length === 0 ? unavailable : null,
    _meta: {
      source: '실거래: 국토교통부 아파트 매매 / 세대수·준공: 국토교통부 건축물대장 총괄표제부',
      note: '전용면적은 반올림한 정수로 묶습니다. 세대수·준공연도는 대장상 값이며 단지명이 실거래와 다를 수 있습니다.',
    },
  })
}
