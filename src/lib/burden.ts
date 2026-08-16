/**
 * 권리분석 · 추가분담금 계산 (도시정비법 실무 기준)
 *
 * 조합 확정치가 나오기 전에는 어떤 값도 단정할 수 없다.
 * 그래서 모든 가정을 입력으로 노출하고, 이 모듈은 순수 계산만 한다.
 *
 *   비례율   = (종후자산 총액 − 총사업비) / 종전자산 총액 × 100
 *   권리가액 = 종전자산 감정평가액 × 비례율
 *   분담금   = 조합원분양가 − 권리가액        (음수면 환급)
 *   총투입   = 매입가 + 취득세 + 분담금 + 이주비이자 + 기타비용
 */

export const PYEONG_M2 = 3.3058

export interface BurdenInput {
  /** 매입가 (원) */
  purchasePrice: number
  /** 종전자산 감정평가액 (원) — 관리처분 전에는 추정치 */
  appraisalPrice: number
  /** 비례율 (%) */
  bijul: number
  /** 조합원분양가 (원/평) */
  memberPricePerPyeong: number
  /** 희망 평형 (평) */
  targetPyeong: number
  /** 취득세율 (%) */
  acquisitionTaxRate: number
  /** 이주비 대출이자 등 금융비용 (원) */
  financeCost: number
  /** 기타 비용 (원) */
  otherCosts: number
  /** 준공 후 예상 시세 (원/평) */
  expectedPricePerPyeong: number
}

export interface BurdenResult {
  /** 권리가액 = 감정가 × 비례율 */
  rightValue: number
  /** 조합원분양가 총액 */
  memberPrice: number
  /** 추가분담금 (음수 = 환급) */
  burden: number
  acquisitionTax: number
  /** 총 투입비용 */
  totalInvestment: number
  /** 준공 후 예상 자산가치 */
  expectedValue: number
  /** 예상 수익 */
  profit: number
  /** 수익률 (%) */
  roi: number
}

export function calcBurden(i: BurdenInput): BurdenResult {
  const rightValue = Math.round(i.appraisalPrice * (i.bijul / 100))
  const memberPrice = Math.round(i.memberPricePerPyeong * i.targetPyeong)
  const burden = memberPrice - rightValue
  const acquisitionTax = Math.round(i.purchasePrice * (i.acquisitionTaxRate / 100))

  // 분담금이 음수(환급)여도 그대로 더한다 — 환급은 투입을 줄인다
  const totalInvestment =
    i.purchasePrice + acquisitionTax + burden + i.financeCost + i.otherCosts

  const expectedValue = Math.round(i.expectedPricePerPyeong * i.targetPyeong)
  const profit = expectedValue - totalInvestment

  return {
    rightValue,
    memberPrice,
    burden,
    acquisitionTax,
    totalInvestment,
    expectedValue,
    profit,
    roi: totalInvestment > 0 ? Math.round((profit / totalInvestment) * 1000) / 10 : 0,
  }
}

export type ScenarioKey = 'conservative' | 'base' | 'optimistic'

export const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  conservative: '보수',
  base: '기준',
  optimistic: '낙관',
}

/**
 * 3시나리오.
 * 비례율은 ±10%p, 준공 후 시세는 ±15% 로 흔든다.
 * (실무에서 비례율은 사업시행인가~관리처분 사이에 이 정도 폭으로 움직인다)
 */
export function calcScenarios(base: BurdenInput): Record<ScenarioKey, BurdenResult> {
  return {
    conservative: calcBurden({
      ...base,
      bijul: Math.max(0, base.bijul - 10),
      expectedPricePerPyeong: base.expectedPricePerPyeong * 0.85,
    }),
    base: calcBurden(base),
    optimistic: calcBurden({
      ...base,
      bijul: base.bijul + 10,
      expectedPricePerPyeong: base.expectedPricePerPyeong * 1.15,
    }),
  }
}

/**
 * 종전자산 감정가 추정.
 * 관리처분 전에는 감정평가가 없으므로 대지지분 × 구역 대지평당가로 근사하고,
 * 감정가율을 곱한다. 감정가는 통상 시세보다 낮게 나오기 때문이다.
 * 어디까지나 추정이므로 화면에서 반드시 "추정" 표기와 함께 쓴다.
 */
export function estimateAppraisal(
  landSharePyeong: number,
  zoneLandPricePerPyeong: number,
  appraisalRatePct: number,
): number {
  return Math.round(landSharePyeong * zoneLandPricePerPyeong * (appraisalRatePct / 100))
}
