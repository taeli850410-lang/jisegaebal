import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAllDevelops } from '@/lib/server/developStore'
import { fetchParcels, hasVWorld, ringAreaM2 } from '@/lib/server/vworld'
import { fetchTransactions } from '@/lib/server/molit'
import { getExposMany } from '@/lib/server/expos'
import { getLandRightsMany } from '@/lib/server/landRight'
import { outerRings } from '@/lib/types'

/**
 * 구역 내 물건 카드 — GET /api/zone-parcels?id=<구역ID>
 *
 * 중개 매물이 없어도 구역 안에서 살 수 있는 것들을 지번 단위로 다 보여준다.
 * 벤치마크의 매물 카드에 있는 값 중 가격·유형을 뺀 나머지는 전부 공공데이터라
 * 우리도 낼 수 있다 — 대지면적·공시지가·용도지역·세대수·사용승인·연면적·
 * 공시가격·대지지분·최근 실거래.
 *
 * "지금 얼마에 나와 있나"만 우리가 모른다. 그건 저장하지 않고 링크로 넘긴다.
 * 링크를 거는 건 복제가 아니라서 남의 데이터베이스를 건드리지 않는다.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PYEONG = 3.3058

/** 건축물대장 파일 색인 — 지번마다 동 단위 제원 */
let buildingIndex: Record<string, { buildings: BuildingRow[]; semiBasement: number }> | null = null
interface BuildingRow {
  purpose: string
  hhld: number
  fmly: number
  ho: number
  apr: string
  plat: number
  far: number
  bcr: number
  ugrnd: number
  pk: string
}
function buildings(): Record<string, { buildings: BuildingRow[]; semiBasement: number }> {
  if (!buildingIndex) {
    try {
      buildingIndex = JSON.parse(
        readFileSync(join(process.cwd(), 'data', 'building-index.json'), 'utf-8'),
      )
    } catch {
      buildingIndex = {}
    }
  }
  return buildingIndex!
}

/** 공동주택 공시가격 — 지번마다 [전용면적, 공시가격, 지하여부] 목록 */
let priceCache: Record<string, { year: number; units: [number, number, boolean][] } | null> | null =
  null
function prices() {
  if (!priceCache) {
    try {
      priceCache = JSON.parse(
        readFileSync(join(process.cwd(), 'data', 'house-price-cache.json'), 'utf-8'),
      )
    } catch {
      priceCache = {}
    }
  }
  return priceCache!
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

const pad = (v: number) => String(v || 0).padStart(4, '0')

export interface ParcelCard {
  pnu: string
  jibun: string
  dong: string
  /** 필지 면적 (㎡) */
  landM2: number
  landPyeong: number
  /** 개별공시지가 (원/㎡) */
  jigaPerM2: number | null
  /** 개별공시지가 평당 환산 */
  jigaPerPyeong: number | null
  /* ── 건축물대장 ── */
  purpose: string | null
  households: number | null
  approvalDate: string | null
  buildYear: number | null
  far: number | null
  bcr: number | null
  /* ── 공동주택 공시가격 ── */
  priceYear: number | null
  unitCount: number
  minUnitPrice: number | null
  maxUnitPrice: number | null
  /**
   * 호당 대지지분 추정 (평).
   * 필지면적을 전용면적 비율로 안분한다 — 등기부상 대지권과 다를 수 있다.
   */
  landShareMinPyeong: number | null
  landShareMaxPyeong: number | null
  /**
   * 대지지분을 어디서 냈나.
   *   right  대지권등록부의 실제 호별 대지면적 (추정이 아니다)
   *   price  공동주택 공시가격의 호별 전용면적으로 안분
   *   expos  집합건축물대장 전유부의 호별 전용면적으로 안분
   *   whole  집합건물이 아니다 — 필지 전체가 곧 대지지분
   *   none   건물이 없거나 판단할 근거가 없다
   */
  unitSource: 'right' | 'price' | 'expos' | 'whole' | 'none'
  /* ── 최근 실거래 ── */
  lastDeal: { date: string; price: number; typeLabel: string; landPyeong: number | null } | null
  /** 네이버 부동산 지번 검색 — 데이터를 저장하지 않고 링크만 건다 */
  naverUrl: string
  eumUrl: string
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const zone = getAllDevelops().find((z) => z.id === id)
  if (!zone) return NextResponse.json({ error: '구역을 찾을 수 없습니다.' }, { status: 404 })
  if (!hasVWorld()) {
    return NextResponse.json({ cards: [], unavailable: 'NO_KEY', total: 0 })
  }

  const k = zone.bbox.map((v) => v.toFixed(4)).join(',')
  const raw = await fetchParcels(zone.bbox, k)
  if (!raw?.length) {
    return NextResponse.json({ cards: [], unavailable: 'FETCH_FAILED', total: 0 })
  }

  const rings = outerRings(zone.geometry)
  const bi = buildings()
  const hp = prices()

  /* 구역 안 필지만 남긴다 (중심점 기준 — 경계에 걸친 필지를 통째로 세지 않는다) */
  const inside = raw.filter((p) => {
    let cx = 0
    let cy = 0
    for (const [x, y] of p.ring) {
      cx += x
      cy += y
    }
    cx /= p.ring.length
    cy /= p.ring.length
    return rings.some((r) => pointInRing(cx, cy, r))
  })

  /* 이 구역 자치구의 최근 1년 실거래 — 지번으로 붙인다 */
  const dealByJibun = new Map<string, { date: string; price: number; typeLabel: string; landPyeong: number | null }>()
  if (zone.gu && process.env.DATA_GO_KR_SERVICE_KEY) {
    try {
      for (const t of await fetchTransactions(zone.gu, 12)) {
        const key = `${t.dong}|${t.jibun}`
        const prev = dealByJibun.get(key)
        if (!prev || t.dealDate > prev.date) {
          dealByJibun.set(key, {
            date: t.dealDate,
            price: t.price,
            typeLabel: t.typeLabel,
            landPyeong: t.landPyeong,
          })
        }
      }
    } catch {
      /* 실거래가 없어도 카드는 만든다 */
    }
  }

  /*
   * 공시가격이 없는 지번은 전유부에서 호별 전용면적을 받는다.
   * 건물이 없는 필지(도로·나대지)는 부를 이유가 없으니 거른다.
   */
  const needExpos = inside
    .filter((p) => {
      const dong = p.dong ?? ''
      const jibun = (p.jibun ?? '').replace(/[^0-9-]/g, '').replace(/-$/, '')
      if (!p.gu || !dong) return false
      if (hp[`${p.gu}|${dong}|${jibun}`]) return false
      const bun = Number(p.pnu.slice(11, 15))
      const ji = Number(p.pnu.slice(15, 19))
      return !!bi[`${p.gu}|${dong}|${pad(bun)}${pad(ji)}`]
    })
    .map((p) => p.pnu)
  /*
   * 대지권등록부부터 본다. 실제 값이라 안분 추정보다 우선한다.
   * 건물이 있는 필지만 — 도로·나대지는 나눌 대지권이 없다.
   */
  const built = inside.filter((p) => {
    const dong = p.dong ?? ''
    if (!p.gu || !dong) return false
    const bun = Number(p.pnu.slice(11, 15))
    const ji = Number(p.pnu.slice(15, 19))
    return !!bi[`${p.gu}|${dong}|${pad(bun)}${pad(ji)}`]
  })
  const rights = await getLandRightsMany(
    built.map((p) => p.pnu),
    40,
  )
  const expos = await getExposMany(
    needExpos.filter((pnu) => !rights.has(pnu)),
    20,
  )

  const cards: ParcelCard[] = inside.map((p) => {
    const landM2 = Math.round(ringAreaM2(p.ring))
    const dong = p.dong ?? ''
    // 지번 문자열에서 지목 글자를 떼고 번호만 남긴다 ("603-13대" → "603-13")
    const jibun = (p.jibun ?? '').replace(/[^0-9-]/g, '').replace(/-$/, '')
    const bun = Number(p.pnu.slice(11, 15))
    const ji = Number(p.pnu.slice(15, 19))
    const b = p.gu && dong ? bi[`${p.gu}|${dong}|${pad(bun)}${pad(ji)}`] : undefined
    const main = b?.buildings?.[0] ?? null
    const hpEntry = p.gu && dong ? hp[`${p.gu}|${dong}|${jibun}`] : undefined

    const units = hpEntry?.units ?? []
    const unitPrices = units.map((u) => u[1]).filter((v) => v > 0)
    /*
     * 안분에 쓸 호별 전용면적.
     * 공시가격이 있으면 그걸 쓰고(가격까지 함께 오므로), 없으면 전유부를 쓴다.
     */
    const rg = rights.get(p.pnu) ?? null
    const ex = rg || units.length ? null : (expos.get(p.pnu) ?? null)
    const areas = units.length ? units.map((u) => u[0] || 0) : (ex?.map((u) => u[2]) ?? [])
    const totalExclusive = areas.reduce((s, a) => s + a, 0)
    /*
     * 대지지분 안분 — 필지면적 × (그 호 전용면적 / 전체 전용면적 합).
     * 등기부상 대지권과 다를 수 있으므로 화면에서 "추정"이라고 밝힌다.
     */
    /*
     * 집합건물이면 안분하고, 아니면 필지 전체가 대지지분이다.
     *
     * 공시가격도 전유부도 없는데 건물은 있다 — 그건 단독·다가구·근생처럼
     * 나뉘지 않은 건물이라는 뜻이다. 다가구는 여러 가구가 살아도 소유는
     * 하나라 대지가 쪼개지지 않는다. 이걸 "모름"으로 두면 정비사업에서
     * 제일 중요한 물건(단독주택)이 통째로 빠진다.
     */
    const whole = !rg && !totalExclusive && !!main
    const shares = rg
      ? // 대지권등록부의 실제 값 — 안분하지 않는다
        rg.map((u) => u[2] / PYEONG)
      : totalExclusive
        ? areas.map((a) => (landM2 * a) / totalExclusive / PYEONG)
        : whole
          ? [landM2 / PYEONG]
          : []

    const addr = `서울 ${p.gu ?? ''} ${dong} ${jibun}`.replace(/\s+/g, ' ').trim()
    return {
      pnu: p.pnu,
      jibun,
      dong,
      landM2,
      landPyeong: Math.round((landM2 / PYEONG) * 10) / 10,
      jigaPerM2: p.jiga ?? null,
      jigaPerPyeong: p.jiga ? Math.round(p.jiga * PYEONG) : null,
      purpose: main?.purpose ?? null,
      households: main?.hhld || null,
      approvalDate: main?.apr
        ? `${main.apr.slice(0, 4)}-${main.apr.slice(4, 6)}-${main.apr.slice(6, 8)}`
        : null,
      buildYear: main?.apr ? Number(main.apr.slice(0, 4)) : null,
      far: main?.far ?? null,
      bcr: main?.bcr ?? null,
      priceYear: hpEntry?.year ?? null,
      unitCount: rg?.length || units.length || (ex?.length ?? 0) || (whole ? 1 : 0),
      unitSource: rg
        ? ('right' as const)
        : units.length
          ? ('price' as const)
          : ex?.length
            ? ('expos' as const)
            : whole
              ? ('whole' as const)
              : ('none' as const),
      minUnitPrice: unitPrices.length ? Math.min(...unitPrices) : null,
      maxUnitPrice: unitPrices.length ? Math.max(...unitPrices) : null,
      landShareMinPyeong: shares.length ? Math.round(Math.min(...shares) * 100) / 100 : null,
      landShareMaxPyeong: shares.length ? Math.round(Math.max(...shares) * 100) / 100 : null,
      lastDeal: dealByJibun.get(`${dong}|${jibun}`) ?? null,
      naverUrl: `https://new.land.naver.com/search?sk=${encodeURIComponent(addr)}`,
      eumUrl: 'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp',
    }
  })

  // 건물이 있고 공시가격까지 아는 필지가 먼저 — 실제로 살 수 있는 물건이다
  cards.sort((a, b) => {
    const score = (c: ParcelCard) => (c.unitCount ? 4 : 0) + (c.households ? 2 : 0) + (c.purpose ? 1 : 0)
    return score(b) - score(a) || b.landM2 - a.landM2
  })

  return NextResponse.json({
    zoneId: zone.id,
    zoneName: zone.name,
    total: cards.length,
    // 건물이 잡힌 필지 — 세대수로 세면 근생·종교시설이 빠진다
    withBuilding: cards.filter((c) => c.purpose).length,
    withHouseholds: cards.filter((c) => c.households).length,
    withPrice: cards.filter((c) => c.unitSource === 'price').length,
    withRight: cards.filter((c) => c.unitSource === 'right').length,
    withExpos: cards.filter((c) => c.unitSource === 'expos').length,
    withWhole: cards.filter((c) => c.unitSource === 'whole').length,
    withLandShare: cards.filter((c) => c.landShareMinPyeong != null).length,
    cards: cards.slice(0, 200),
    _meta: {
      source:
        '필지·공시지가: 국토교통부 연속지적도(V-World) / 건축물: 건축물대장 / 공시가격: 공동주택 공시가격 / 실거래: 국토교통부',
      note: '대지지분은 대지권등록부(V-World 소유정보)의 실제 값을 우선 씁니다. 그 값이 없는 지번만 전용면적 비율로 안분한 추정값이며, 집합건물이 아닌 필지는 필지 전체가 대지지분입니다. 호가(매물 가격)는 저장하지 않고 네이버 부동산 검색으로 연결합니다.',
    },
  })
}
