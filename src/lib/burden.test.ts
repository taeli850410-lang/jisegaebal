/**
 * 분담금 계산식 테스트 — 명세 §9 필수 항목.
 * 실행: npm test  (node --test, 별도 러너 없이 타입 스트리핑으로 돈다)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcBurden, calcScenarios, estimateAppraisal, type BurdenInput } from './burden.ts'

const 억 = 100_000_000

const base: BurdenInput = {
  purchasePrice: 6 * 억,
  appraisalPrice: 4 * 억,
  bijul: 100,
  memberPricePerPyeong: 3000 * 10_000, // 3,000만원/평
  targetPyeong: 25,
  acquisitionTaxRate: 4.6,
  financeCost: 0,
  otherCosts: 0,
  expectedPricePerPyeong: 4000 * 10_000, // 4,000만원/평
}

test('비례율 100%면 권리가액은 감정가와 같다', () => {
  const r = calcBurden(base)
  assert.equal(r.rightValue, 4 * 억)
})

test('비례율 120%면 권리가액이 20% 늘어난다', () => {
  const r = calcBurden({ ...base, bijul: 120 })
  assert.equal(r.rightValue, 4.8 * 억)
})

test('분담금 = 조합원분양가 − 권리가액', () => {
  const r = calcBurden(base)
  assert.equal(r.memberPrice, 7.5 * 억) // 3,000만 × 25평
  assert.equal(r.burden, 7.5 * 억 - 4 * 억)
})

test('권리가액이 분양가보다 크면 환급(음수)이 된다', () => {
  const r = calcBurden({ ...base, appraisalPrice: 9 * 억 })
  assert.ok(r.burden < 0, '분담금이 음수여야 한다')
  // 환급이면 총투입이 매입가+취득세보다 작아진다
  assert.ok(r.totalInvestment < base.purchasePrice + r.acquisitionTax)
})

test('총투입 = 매입가 + 취득세 + 분담금 + 금융 + 기타', () => {
  const r = calcBurden({ ...base, financeCost: 0.2 * 억, otherCosts: 0.1 * 억 })
  const expected =
    6 * 억 + Math.round(6 * 억 * 0.046) + (7.5 * 억 - 4 * 억) + 0.2 * 억 + 0.1 * 억
  assert.equal(r.totalInvestment, expected)
})

test('수익 = 준공 후 가치 − 총투입, 수익률은 총투입 대비', () => {
  const r = calcBurden(base)
  assert.equal(r.expectedValue, 10 * 억) // 4,000만 × 25평
  assert.equal(r.profit, r.expectedValue - r.totalInvestment)
  assert.equal(r.roi, Math.round((r.profit / r.totalInvestment) * 1000) / 10)
})

test('시나리오는 보수 < 기준 < 낙관 순으로 수익이 커진다', () => {
  const s = calcScenarios(base)
  assert.ok(s.conservative.profit < s.base.profit)
  assert.ok(s.base.profit < s.optimistic.profit)
})

test('보수 시나리오는 비례율 10%p 하락을 반영한다', () => {
  const s = calcScenarios({ ...base, bijul: 100 })
  assert.equal(s.conservative.rightValue, Math.round(4 * 억 * 0.9))
})

test('비례율이 10%p 미만이어도 음수로 내려가지 않는다', () => {
  const s = calcScenarios({ ...base, bijul: 5 })
  assert.equal(s.conservative.rightValue, 0)
})

test('감정가 추정 = 대지지분 × 평당가 × 감정가율', () => {
  // 10평 × 1억/평 × 70% = 7억
  assert.equal(estimateAppraisal(10, 1 * 억, 70), 7 * 억)
})

test('총투입이 0이면 수익률은 0으로 떨어뜨린다(0 나눗셈 방지)', () => {
  const r = calcBurden({
    ...base,
    purchasePrice: 0,
    acquisitionTaxRate: 0,
    appraisalPrice: 0,
    memberPricePerPyeong: 0,
    expectedPricePerPyeong: 0,
  })
  assert.equal(r.totalInvestment, 0)
  assert.equal(r.roi, 0)
})
