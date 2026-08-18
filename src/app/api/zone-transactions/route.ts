import { NextResponse } from 'next/server'
import { getAllDevelops } from '@/lib/server/developStore'
import { fetchTransactions, median, type Kind, type Transaction, lastMolitError } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { attachPublicPrices } from '@/lib/server/housePrice'
import { outerRings } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * 구역별 실거래 집계.
 *
 * GET /api/zone-transactions?gu=강동구&days=30
 *
 * 국토부 응답에는 좌표가 없으므로 지번을 지오코딩해 구역 폴리곤과 공간조인한다.
 * 지번 좌표는 변하지 않아 캐시가 잘 먹는다(최초 조회만 느리고 이후는 즉시).
 */

/** 스파크라인은 6개월이면 충분하지만, 365일 집계는 그만큼 더 받아야 한다 */
function monthsFor(days: number) {
  return Math.max(6, Math.ceil(days / 30) + 1)
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

export interface ZoneTransactions {
  id: string
  name: string
  projectType: string
  rawLabel: string
  stage: string | null
  canonicalStage: string | null
  bbox: [number, number, number, number]
  /** 선택 기간 내 거래 (화면에 보이는 건에는 공시가격이 붙는다) */
  deals: (Transaction & { publicPrice?: number | null })[]
  dealCount: number
  /** 기간 내 대지평당가 중앙값 */
  medianPerPyeong: number | null
  /** 중앙값 산출에 쓰인 표본 수 — 1~2건이면 시세로 보기 어렵다 */
  priceSampleCount: number
  /** 직전 동일 기간 대비 변화율(%) */
  changePct: number | null
  /** 월별 중앙 대지평당가 (오래된 순) — 스파크라인용 */
  series: { ym: string; value: number | null }[]
}

/**
 * 서울 전체 집계는 25개 구를 도는 만큼 무겁다. 짧게 캐시한다.
 *
 * 다만 서버리스 함수 한도(60초) 안에 못 끝나는 경우가 있어, 화면에서는
 * 구별로 나눠 부르고 합친다. 이 경로는 직접 호출용으로만 남긴다.
 */
const ALL_CACHE = new Map<string, { at: number; body: unknown }>()
const ALL_TTL = 10 * 60 * 1000

async function computeForGu(
  gu: string,
  days: number,
  kinds: Kind[],
  SERIES_MONTHS: number,
  /** 서울 전체에서는 지오코딩 예산을 0으로 둬 캐시만 쓴다 (25개 구를 새로 지오코딩할 수는 없다) */
  geocodeBudget: number,
) {
  const zones = getAllDevelops().filter((d) => d.gu === gu)
  if (!zones.length) return { result: [] as ZoneTransactions[], fetched: 0, matched: 0 }

  const all = await fetchTransactions(gu, SERIES_MONTHS, kinds)

  // 지번 좌표 확보 (캐시 우선). 예산을 둬 한 요청이 API를 과하게 쓰지 않게 한다.
  const uniqueQueries = [...new Set(all.map((t) => `서울 ${gu} ${t.dong} ${t.jibun}`))]
  const coords = await geocodeMany(uniqueQueries, geocodeBudget)

  // 구역별로 거래를 담는다. 겹치는 구역이 있으면 작은 구역이 더 구체적이다.
  const sortedZones = [...zones].sort((a, b) => a.areaM2 - b.areaM2)
  const bucket = new Map<string, Transaction[]>()

  for (const t of all) {
    const pt = coords.get(`서울 ${gu} ${t.dong} ${t.jibun}`)
    if (!pt) continue
    const [lng, lat] = pt
    const zone = sortedZones.find(
      (z) =>
        lng >= z.bbox[0] &&
        lng <= z.bbox[2] &&
        lat >= z.bbox[1] &&
        lat <= z.bbox[3] &&
        outerRings(z.geometry).some((r) => pointInRing(lng, lat, r)),
    )
    if (!zone) continue
    const list = bucket.get(zone.id) ?? []
    list.push(t)
    bucket.set(zone.id, list)
  }

  const now = new Date()
  const cut = new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10)
  const prevCut = new Date(now.getTime() - days * 2 * 86400_000).toISOString().slice(0, 10)

  const ymKeys: string[] = []
  for (let i = SERIES_MONTHS - 1; i >= 0; i--) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymKeys.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const result: ZoneTransactions[] = []

  for (const [zoneId, deals] of bucket) {
    const z = zones.find((x) => x.id === zoneId)!
    const inPeriod = deals.filter((d) => d.dealDate >= cut)
    if (!inPeriod.length) continue

    const prevPeriod = deals.filter((d) => d.dealDate >= prevCut && d.dealDate < cut)
    const priceable = inPeriod.filter((d) => d.pricePerLandPyeong != null)
    const cur = median(priceable.map((d) => d.pricePerLandPyeong!))
    const prev = median(prevPeriod.map((d) => d.pricePerLandPyeong ?? NaN))

    // 화면에 보이는 건에만 공주가를 붙인다 (지번 캐시라 재조회는 거의 없다)
    const shown = await attachPublicPrices(gu, inPeriod.slice(0, 20))

    result.push({
      id: z.id,
      name: z.name,
      projectType: z.projectType,
      rawLabel: z.rawLabel,
      stage: z.stage ?? null,
      canonicalStage: z.canonicalStage ?? null,
      bbox: z.bbox,
      deals: shown,
      dealCount: inPeriod.length,
      medianPerPyeong: cur,
      priceSampleCount: priceable.length,
      changePct: cur && prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null,
      series: ymKeys.map((ym) => ({
        ym,
        value: median(
          deals.filter((d) => d.dealDate.startsWith(ym)).map((d) => d.pricePerLandPyeong ?? NaN),
        ),
      })),
    })
  }

  return {
    result,
    fetched: all.length,
    matched: [...bucket.values()].reduce((s, l) => s + l.length, 0),
    geocoded: uniqueQueries.filter((q) => coords.get(q)).length,
    unresolved: uniqueQueries.filter((q) => !coords.has(q)).length,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const guParam = searchParams.get('gu') ?? ''
  // gu=all 또는 빈 값이면 서울 전체
  const isAll = !guParam || guParam === 'all' || guParam === '서울 전체'
  const days = Math.min(365, Math.max(7, Number(searchParams.get('days') ?? 30) || 30))
  // 가격순은 "다세대 기준"처럼 유형을 좁혀야 지표가 흔들리지 않는다
  const kinds = (searchParams.get('kinds')?.split(',').filter(Boolean) ?? [
    'villa',
    'house',
    'land',
  ]) as Kind[]
  const SERIES_MONTHS = monthsFor(days)

  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    return NextResponse.json({ error: '실거래 인증키 미설정', code: 'NO_KEY' }, { status: 503 })
  }

  if (!isAll) {
    const r = await computeForGu(guParam, days, kinds, SERIES_MONTHS, 150)
    r.result.sort(
      (a, b) => b.dealCount - a.dealCount || (b.medianPerPyeong ?? 0) - (a.medianPerPyeong ?? 0),
    )
    return NextResponse.json({
      gu: guParam,
      days,
      total: r.result.length,
      matchedDeals: r.matched,
      fetchedDeals: r.fetched,
      geocoded: r.geocoded,
      unresolved: r.unresolved,
      zones: r.result,
      // 0건이 진짜 0건인지, 공공데이터포털이 막은 건지 구분한다
      unavailable: lastMolitError(),
      _meta: {
        source: '국토교통부 실거래가 + 서울시 의제처리구역 경계',
        note: '실거래는 지번 지오코딩 후 구역 경계 안으로 판정된 건만 집계합니다.',
      },
    })
  }

  /* ── 서울 전체 ──
     25개 구를 도는 만큼 무겁다. 지오코딩은 캐시만 쓰고(예산 0), 결과는 10분 캐시한다.
     새로 지오코딩까지 하면 한 요청이 수천 콜을 쓰게 된다. */
  const cacheKey = `${days}|${kinds.join(',')}`
  const hit = ALL_CACHE.get(cacheKey)
  if (hit && Date.now() - hit.at < ALL_TTL) return NextResponse.json(hit.body)

  const gus = [...new Set(getAllDevelops().map((d) => d.gu).filter(Boolean))] as string[]
  const merged: ZoneTransactions[] = []
  let fetched = 0
  let matched = 0
  const C = 4
  for (let i = 0; i < gus.length; i += C) {
    const part = await Promise.all(
      gus.slice(i, i + C).map((g) =>
        computeForGu(g, days, kinds, SERIES_MONTHS, 0).catch(() => null),
      ),
    )
    for (const r of part) {
      if (!r) continue
      merged.push(...r.result)
      fetched += r.fetched
      matched += r.matched
    }
  }
  merged.sort(
    (a, b) => b.dealCount - a.dealCount || (b.medianPerPyeong ?? 0) - (a.medianPerPyeong ?? 0),
  )

  const body = {
    gu: '',
    scope: '서울 전체',
    days,
    total: merged.length,
    matchedDeals: matched,
    fetchedDeals: fetched,
    // 상위권만 쓰므로 200개면 충분하다 — 전량을 보내면 응답이 수 MB가 된다
    zones: merged.slice(0, 200),
    // 0건이 진짜 0건인지, 공공데이터포털이 막은 건지 구분한다
    unavailable: lastMolitError(),
    _meta: {
      source: '국토교통부 실거래가 + 서울시 의제처리구역 경계',
      note:
        '서울 25개 자치구를 합산했습니다. 지오코딩은 캐시된 지번만 사용하므로 ' +
        '개별 자치구를 선택했을 때보다 일부 거래가 빠질 수 있습니다.',
    },
  }
  ALL_CACHE.set(cacheKey, { at: Date.now(), body })
  return NextResponse.json(body)
}
