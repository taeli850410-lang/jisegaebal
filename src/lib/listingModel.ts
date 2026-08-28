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
  /** 취득세율 (%) */
  acquisitionTaxRate: number
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  appraisalMultiple: 1.7,
  leverageRate: 0.6,
  acquisitionTaxRate: 4.6,
}

export interface ListingMetrics {
  /** 추정 감정가 = 공시가 × 배수 */
  appraisal: number | null
  /** 추정 프리미엄 = 매매가 − 추정 감정가 */
  premium: number | null
  /** 초기투자금 = 매매가 + 취득세 − 레버리지 */
  initialCash: number | null
  /** 초기투자금이 매매가의 몇 % 인가 */
  initialCashPct: number | null
  /** 대지 평당 매매가 = 매매가 / 대지지분 */
  pricePerLandPyeong: number | null
}

export function computeMetrics(
  price: number | null,
  publicPrice: number | null,
  landSharePyeong: number | null,
  a: Assumptions = DEFAULT_ASSUMPTIONS,
): ListingMetrics {
  const appraisal = publicPrice ? Math.round(publicPrice * a.appraisalMultiple) : null
  const premium = price && appraisal ? price - appraisal : null
  /*
   * 취득세를 빼놓으면 초기투자금이 실제보다 작게 나온다.
   * 7억짜리면 4.6% 만 해도 3,220만원이다 — 사람 판단이 바뀌는 크기다.
   */
  const tax = price ? Math.round(price * (a.acquisitionTaxRate / 100)) : 0
  const leverage = publicPrice ? Math.round(publicPrice * a.leverageRate) : 0
  const initialCash = price ? price + tax - leverage : null
  return {
    appraisal,
    premium,
    initialCash,
    initialCashPct: price && initialCash ? Math.round((initialCash / price) * 100) : null,
    pricePerLandPyeong:
      price && landSharePyeong ? Math.round(price / landSharePyeong) : null,
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
  const m = (l: Listing) => computeMetrics(l.price, l.publicPrice ?? null, l.landSharePyeong ?? null, a)
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
