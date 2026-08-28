// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { PROJECT_TYPES, STAGES } from './taxonomy.ts'

/**
 * 매물 찾기 필터.
 *
 * 벤치마크의 「매물 찾기」와 같은 구조지만 채우는 값이 다르다.
 * 우리에겐 중개 매물이 없다(제휴가 필요하다). 대신 국토교통부 실거래를 쓴다 —
 * 호가가 아니라 실제로 팔린 값이라 오히려 단단하고, 매물 목록에 있는
 * 공시가·대지지분·대지평당가가 실거래에도 전부 붙어 있다.
 *
 * 그 차이(호가 ≠ 체결가)는 화면에서 감추지 않는다.
 */

/** 매물 목록 한 줄이 되는 실거래 한 건 */
export interface FindItem {
  zoneId: string
  zoneName: string
  projectType: string
  canonicalStage: string | null
  stage: string | null
  typeLabel: string
  dealDate: string
  price: number
  dong: string
  jibun: string
  buildYear: number | null
  exclusiveAr: number | null
  landPyeong: number | null
  pricePerLandPyeong: number | null
  publicPrice: number | null
  /**
   * 추정 프리미엄 = 거래가 − 추정 권리가액.
   * 권리가액은 분담금 시뮬레이터와 같은 모델(대지지분 × 대지평당가 × 감정가율)을
   * 쓴다. 두 화면이 다른 수를 내면 어느 쪽도 못 믿는다.
   */
  premium: number | null
}

/** 감정가율 기본값 — 감정가는 통상 시세보다 낮게 나온다 */
export const DEFAULT_APPRAISAL_RATE = 70

export function estimatePremium(
  price: number,
  landPyeong: number | null,
  landPerPyeong: number | null,
  ratePct = DEFAULT_APPRAISAL_RATE,
): number | null {
  if (!landPyeong || !landPerPyeong) return null
  return Math.round(price - landPyeong * landPerPyeong * (ratePct / 100))
}

export interface Filters {
  /** 사업종류 코드 (빈 배열 = 전체) */
  types: string[]
  /** 정규화 진행단계 코드 (빈 배열 = 전체) */
  stages: string[]
  /** 관심 구역만 */
  favoritesOnly: boolean
  /** 거래 유형 라벨 (다세대·단독 등) */
  kinds: string[]
  priceMax: number | null
  publicPriceMax: number | null
  /** 사용승인 연도가 이 값보다 오래된 것만 (노후 물건 찾기) */
  builtBefore: number | null
  landPyeongMin: number | null
  areaMin: number | null
}

export const EMPTY_FILTERS: Filters = {
  types: [],
  stages: [],
  favoritesOnly: false,
  kinds: [],
  priceMax: null,
  publicPriceMax: null,
  builtBefore: null,
  landPyeongMin: null,
  areaMin: null,
}

/**
 * 추천 필터.
 *
 * 벤치마크가 네 개를 첫 화면에 박아 둔 이유가 있다 — 정비사업 물건을 찾는
 * 사람의 질문은 대개 "싸게 들어갈 수 있나"와 "얼마나 초기인가" 둘이다.
 * 그 둘을 한 번에 누를 수 있게 둔다.
 */
export const PRESETS = [
  { key: 'cheap', label: '매매가 4억 이하', patch: { priceMax: 4_0000_0000 } },
  { key: 'lowpub', label: '공시가 1억 이하', patch: { publicPriceMax: 1_0000_0000 } },
  {
    key: 'early',
    label: '초기 재개발',
    // 구역지정 전후 — 아직 조합도 없는 단계
    patch: { stages: ['prepare', 'numbering', 'safety_check', 'site_selected', 'zone_designated'] },
  },
  {
    key: 'mid',
    label: '중기 재개발',
    // 조합이 서고 인가가 붙기 시작하는 구간
    patch: { stages: ['committee', 'union', 'impl_approval'] },
  },
] as const satisfies readonly { key: string; label: string; patch: Partial<Filters> }[]

/** 사업종류를 화면과 같은 묶음으로 — 민간주도 / 공공주도 / 소규모 / 기타 */
export function typeGroups() {
  const groups = new Map<string, typeof PROJECT_TYPES>()
  for (const t of PROJECT_TYPES) {
    const cur = groups.get(t.group)
    if (cur) cur.push(t)
    else groups.set(t.group, [t])
  }
  return [...groups.entries()]
}

/** 진행단계를 추진중 / 진행중 / 완료로 */
export function stageGroups() {
  const groups = new Map<string, typeof STAGES>()
  for (const s of STAGES) {
    const cur = groups.get(s.group)
    if (cur) cur.push(s)
    else groups.set(s.group, [s])
  }
  return [...groups.entries()]
}

export function matches(it: FindItem, f: Filters, favorites: Set<string>): boolean {
  if (f.types.length && !f.types.includes(it.projectType)) return false
  // 단계 미확인 구역은 단계 필터를 걸면 빠진다 — 모르는 걸 있다고 할 수 없다
  if (f.stages.length && !(it.canonicalStage && f.stages.includes(it.canonicalStage))) return false
  if (f.favoritesOnly && !favorites.has(it.zoneId)) return false
  if (f.kinds.length && !f.kinds.includes(it.typeLabel)) return false
  if (f.priceMax != null && it.price > f.priceMax) return false
  // 공시가를 모르는 건은 "1억 이하"를 만족한다고 볼 수 없다
  if (f.publicPriceMax != null && !(it.publicPrice != null && it.publicPrice <= f.publicPriceMax)) {
    return false
  }
  if (f.builtBefore != null && !(it.buildYear != null && it.buildYear <= f.builtBefore)) return false
  if (f.landPyeongMin != null && !(it.landPyeong != null && it.landPyeong >= f.landPyeongMin)) {
    return false
  }
  if (f.areaMin != null && !(it.exclusiveAr != null && it.exclusiveAr >= f.areaMin)) return false
  return true
}

export type SortKey = 'price' | 'premium' | 'recent' | 'landPyeong'

export function sortItems(items: FindItem[], key: SortKey): FindItem[] {
  const xs = [...items]
  switch (key) {
    case 'price':
      return xs.sort((a, b) => a.price - b.price)
    case 'premium':
      // 값을 모르는 건은 뒤로 — 0으로 치면 "프리미엄 없는 물건"으로 올라온다
      return xs.sort((a, b) => (a.premium ?? Infinity) - (b.premium ?? Infinity))
    case 'landPyeong':
      return xs.sort((a, b) => (b.landPyeong ?? -1) - (a.landPyeong ?? -1))
    default:
      return xs.sort((a, b) => b.dealDate.localeCompare(a.dealDate))
  }
}

export interface ZoneRollup {
  id: string
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  count: number
  minPrice: number
  medianPerPyeong: number | null
}

/** 구역별 탭 — 조건에 맞는 건을 구역으로 접는다 */
export function rollupByZone(items: FindItem[]): ZoneRollup[] {
  const m = new Map<string, FindItem[]>()
  for (const it of items) {
    const cur = m.get(it.zoneId)
    if (cur) cur.push(it)
    else m.set(it.zoneId, [it])
  }
  return [...m.values()]
    .map((xs) => {
      const ppp = xs.map((x) => x.pricePerLandPyeong).filter((v): v is number => !!v)
      ppp.sort((a, b) => a - b)
      return {
        id: xs[0].zoneId,
        name: xs[0].zoneName,
        projectType: xs[0].projectType,
        stage: xs[0].stage,
        canonicalStage: xs[0].canonicalStage,
        count: xs.length,
        minPrice: Math.min(...xs.map((x) => x.price)),
        medianPerPyeong: ppp.length ? ppp[Math.floor(ppp.length / 2)] : null,
      }
    })
    .sort((a, b) => b.count - a.count)
}
