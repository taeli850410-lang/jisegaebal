// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { acquisitionTax, kindFromPurpose } from '../config/tax.ts'

/**
 * 매물 지표 계산.
 *
 * 벤치마크 매물 카드의 값을 뜯어보면 외부에서 온 건 매매가 하나뿐이다.
 * 나머지는 매매가와 공공데이터로 만든 것이다. 실제로 역산이 맞아떨어진다 —
 *   공시가 3.58억 × 1.7        = 6.086억  → 그쪽 "AI 감정가 6.08억"
 *   매매가 7억 − 6.08억        = 0.92억   → 그쪽 "추정 P 0.91억"
 *   매매가 7억 − 3.58억 × 64%  = 4.71억   → 그쪽 "초투 4.7억"
 *
 * 그래서 우리도 만들 수 있다. 다만 "AI"라고 부르지 않는다.
 * 공시가에 배수를 곱한 산수이고, 배수는 화면에 띄워 사용자가 바꾸게 한다.
 * 모델을 감추고 AI라고 하면 사용자가 검증할 수 없는 숫자가 된다.
 */

export interface Assumptions {
  /**
   * 감정가 배수 — 공시가 대비 몇 배로 감정평가가 나오는가.
   * 지역·시기·물건에 따라 크게 다르다. 그래서 고정하지 않는다.
   */
  appraisalMultiple: number
  /** 레버리지 비율 — 공시가 대비 대출·전세로 조달 가능하다고 보는 몫 */
  leverageRate: number
  /** 취득 후 보유 주택 수 (중과 판정) */
  houseCount: 1 | 2 | 3
  /** 조정대상지역 여부 */
  adjusted: boolean
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  appraisalMultiple: 1.7,
  leverageRate: 0.6,
  houseCount: 1,
  adjusted: false,
}

export interface ListingMetrics {
  /** 추정 감정가 = 공시가 × 배수 */
  appraisal: number | null
  /** 추정 프리미엄 = 매매가 − 추정 감정가 */
  premium: number | null
  /**
   * 초기투자금 = 매매가 + 취득세 − 레버리지.
   *
   * 공시가를 모르면 레버리지를 못 낸다. 그때 0 으로 두면 "전액 현금"이라는
   * 전혀 다른 숫자가 나오므로 아예 내지 않는다 —
   * 실제로 서계동 101호가 그 경우였다(근생이라 공동주택가격 대상이 아니다).
   */
  initialCash: number | null
  initialCashPct: number | null
  /** 취득세 (원) — 유형·가액·면적·주택수로 갈린다 */
  tax: number | null
  taxRatePct: number | null
  taxNote: string | null
  /** 대지 평당 매매가 = 매매가 / 대지지분 */
  pricePerLandPyeong: number | null
  /** 공시가가 없어 감정가·프리미엄·초투를 못 낸 경우 */
  needsPublicPrice: boolean
}

export function computeMetrics(
  price: number | null,
  publicPrice: number | null,
  landSharePyeong: number | null,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
  /** 건축물대장 주용도 — 주택인지 근생인지로 취득세가 갈린다 */
  purpose?: string | null,
  exclusiveAr?: number | null,
): ListingMetrics {
  const appraisal = publicPrice ? Math.round(publicPrice * a.appraisalMultiple) : null
  const premium = price && appraisal ? price - appraisal : null

  /*
   * 취득세를 4.6% 로 일괄 적용하면 틀린다. 그건 주택이 아닌 것의 세율이다.
   * 7억짜리를 주택으로 사면 약 1.8%, 근생이면 4.6% — 1,900만원 넘게 벌어져
   * 초기투자금 판단이 뒤집힌다. 광고 문구가 아니라 대장 용도로 가른다.
   */
  const t = price
    ? acquisitionTax({
        kind: kindFromPurpose(purpose),
        price,
        exclusiveAr,
        houseCount: a.houseCount,
        adjusted: a.adjusted,
      })
    : null

  const needsPublicPrice = !publicPrice
  const leverage = publicPrice ? Math.round(publicPrice * a.leverageRate) : null
  const initialCash =
    price && t && leverage != null ? price + t.amount - leverage : null

  return {
    appraisal,
    premium,
    initialCash,
    initialCashPct: price && initialCash ? Math.round((initialCash / price) * 100) : null,
    tax: t?.amount ?? null,
    taxRatePct: t?.ratePct ?? null,
    taxNote: t?.note ?? null,
    pricePerLandPyeong: price && landSharePyeong ? Math.round(price / landSharePyeong) : null,
    needsPublicPrice,
  }
}

/* ── 매물 레코드 ───────────────────────────────────────
   중개사나 사용자가 넣는다. 우리가 어디서 긁어오지 않는다. */

export interface Listing {
  id: string
  /** 등록한 사람이 붙인 이름 (선택) */
  title?: string
  gu: string
  dong: string
  jibun: string
  pnu?: string | null
  /** 다세대·단독·연립 등 */
  type: string
  /** 호가 (원) */
  price: number
  /** 전용면적 (㎡) */
  exclusiveAr?: number | null
  /** 층 (지하 음수) */
  floor?: number | null
  /** 우리가 공공데이터로 붙인 값 */
  publicPrice?: number | null
  landSharePyeong?: number | null
  landShareSource?: string | null
  buildYear?: number | null
  purpose?: string | null
  zoneId?: string | null
  zoneName?: string | null
  /* ── 표시·광고 의무 (공인중개사법 제18조의2) ──
     중개대상물 광고는 개업공인중개사만 할 수 있고, 사무소 정보를 함께
     표시해야 한다. 그 값이 없으면 공개 목록에 올리지 않는다. */
  brokerName?: string | null
  brokerOffice?: string | null
  brokerRegNo?: string | null
  brokerTel?: string | null
  /** 등록 시각 (ms) */
  savedAt: number
  memo?: string
}

/** 공개 목록에 올릴 수 있는가 — 중개사 정보가 갖춰졌는가 */
export function isPublishable(l: Listing): boolean {
  return !!(l.brokerOffice && l.brokerRegNo && l.brokerTel)
}

export type ListingSort = 'price' | 'cash' | 'premium' | 'landShare' | 'recent'

export function sortListings(
  xs: Listing[],
  key: ListingSort,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): Listing[] {
  const m = (l: Listing) =>
    computeMetrics(
      l.price,
      l.publicPrice ?? null,
      l.landSharePyeong ?? null,
      a,
      l.purpose,
      l.exclusiveAr,
    )
  const ys = [...xs]
  switch (key) {
    case 'price':
      return ys.sort((x, y) => x.price - y.price)
    case 'cash':
      return ys.sort((x, y) => (m(x).initialCash ?? Infinity) - (m(y).initialCash ?? Infinity))
    case 'premium':
      // 값을 모르는 건은 뒤로 — 0으로 치면 "프리미엄 없는 물건"으로 올라온다
      return ys.sort((x, y) => (m(x).premium ?? Infinity) - (m(y).premium ?? Infinity))
    case 'landShare':
      return ys.sort((x, y) => (y.landSharePyeong ?? -1) - (x.landSharePyeong ?? -1))
    default:
      return ys.sort((x, y) => y.savedAt - x.savedAt)
  }
}
