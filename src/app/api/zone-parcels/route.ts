import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { getBuildingIndex } from '@/lib/server/buildingIndex'
import { join } from 'node:path'
import { getAllDevelops } from '@/lib/server/developStore'
import { fetchParcels, hasVWorld, ringAreaM2 } from '@/lib/server/vworld'
import { fetchTransactions } from '@/lib/server/molit'
import { getExposMany } from '@/lib/server/expos'
import { getLandRightsMany } from '@/lib/server/landRight'
import { outerRings } from '@/lib/types'
import { parcelLinks, searchName, zoneLinks, type LinkTarget } from '@/lib/listingLinks'

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
/* 색인은 buildingIndex 모듈이 읽는다 — 배포에는 32MB 슬림본이 올라간다 */
function buildings(): Record<string, { buildings: BuildingRow[]; semiBasement: number }> {
  return getBuildingIndex() as unknown as Record<
    string,
    { buildings: BuildingRow[]; semiBasement: number }
  >
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
  /**
   * 이 지번의 매물을 찾아보는 링크들.
   * 우리 서버는 이 사이트들에 접속하지 않는다 — 주소 문자열만 만든다.
   */
  links: LinkTarget[]
  /** 이전 화면과의 호환 — 첫 링크(네이버)를 그대로 둔다 */
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
   * 대지권 자료는 "총면적"으로만 쓴다.
   *
   * 예전엔 이 API 의 호별 값을 실측 대지권으로 믿고 안분 추정보다 앞세웠다.
   * 반대였다 — 캐시 104개 건물 중 60개(58%)에서 모든 호가 같은 값이고
   * 그 값 × 호수가 정확히 필지면적이다. 균등분할이다.
   * 실거래 560건으로 확인하니 대지권은 전용면적에 비례한다(82% 일치).
   * 그래서 총면적만 받아 전용면적으로 나눈다. 자세한 건 lib/landShare.ts.
   *
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
  /*
   * 대지권이 있어도 전유부가 있어야 호별로 나눌 수 있다.
   * 예전엔 rights 가 있으면 전유부를 건너뛰었는데, 그래서 나눌 근거가 없어
   * 균등분할값을 그대로 쓰게 됐다.
   */
  const expos = await getExposMany(needExpos, 20)

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
    const ex = units.length ? null : (expos.get(p.pnu) ?? null)
    const areas = units.length ? units.map((u) => u[0] || 0) : (ex?.map((u) => u[2]) ?? [])
    const totalExclusive = areas.reduce((s, a) => s + a, 0)
    /*
     * 나눌 대지 총면적.
     * 대지권 자료가 있으면 그 합이 지적도 필지면적보다 정확하다 — 집합건물의
     * 대지가 여러 필지에 걸칠 수 있기 때문이다. 서계동 245-11 이 그런 경우로,
     * 지적 99.25㎡ 인데 대지권 합은 109.83㎡ 이고, 실거래 대지권면적은
     * 후자로 계산해야 맞는다.
     */
    const totalLand = rg?.length ? rg.reduce((sum, u) => sum + u[2], 0) : landM2
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
    const whole = !totalExclusive && !!main
    const shares = totalExclusive
      ? // 전용면적 비례 — 실거래로 확인한 건물의 82%가 이 방식과 맞았다
        areas.map((a) => (totalLand * a) / totalExclusive / PYEONG)
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
      unitCount: units.length || (ex?.length ?? 0) || rg?.length || (whole ? 1 : 0),
      unitSource: units.length
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
      links: parcelLinks(p.gu ?? '', dong, jibun),
      naverUrl: parcelLinks(p.gu ?? '', dong, jibun)[0].href,
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
    /* 지번마다 눌러 보는 건 품이 든다 — 구역 일대를 한 번에 여는 링크 */
    zoneLinks: zoneLinks(
      searchName(zone.name),
      zone.center ?? [(zone.bbox[0] + zone.bbox[2]) / 2, (zone.bbox[1] + zone.bbox[3]) / 2],
      zone.gu ?? null,
    ),
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
      note: '대지지분은 대지 총면적을 호별 전용면적 비율로 나눈 추정값입니다. 실거래 신고서의 대지권면적 560건과 대조해 82%의 건물에서 이 방식이 맞았습니다. 대지권등록부 자료가 있으면 그 합을 총면적으로 쓰고(집합건물의 대지는 여러 필지에 걸칠 수 있습니다), 없으면 지적도 필지면적을 씁니다. 집합건물이 아닌 필지는 필지 전체가 대지지분입니다. 확정은 등기부 대지권비율입니다. 호가(매물 가격)는 저장하지 않고 네이버 부동산 검색으로 연결합니다.',
    },
  })
}
