import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import {
  DEFAULT_ASSUMPTIONS,
  computeMetrics,
  isPublishable,
  sortListings,
  type Listing,
} from './listingModel.ts'

const 억 = 100_000_000

test('벤치마크 화면의 숫자가 재현된다 — 감정가는 공시가 × 배수', () => {
  // 공시가 3.58억 × 1.7 = 6.086억 → 그쪽 표시 6.08억
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74)
  assert.equal(Math.round(m.appraisal! / 1_000_000) / 100, 6.09)
})

test('추정 프리미엄 = 매매가 − 추정 감정가', () => {
  // 7억 − 6.086억 = 0.914억 → 그쪽 표시 0.91억
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74)
  assert.equal(Math.round(m.premium! / 1_000_000) / 100, 0.91)
})

test('초기투자금에 취득세를 포함한다 — 빼놓으면 실제보다 작게 나온다', () => {
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74, DEFAULT_ASSUMPTIONS, '다세대주택', 42.96)
  const leverage = Math.round(3.58 * 억 * DEFAULT_ASSUMPTIONS.leverageRate)
  assert.equal(m.initialCash, 7 * 억 + m.tax! - leverage)
  assert.ok(m.tax! > 0)
})

test('레버리지는 공시가에 비율을 곱한다', () => {
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74, {
    ...DEFAULT_ASSUMPTIONS,
    leverageRate: 0.64,
  })
  // 7억 + 취득세 − 3.58억×64%
  assert.equal(m.initialCash, 7 * 억 + m.tax! - Math.round(3.58 * 억 * 0.64))
})

test('배수를 바꾸면 감정가와 프리미엄이 함께 움직인다', () => {
  const a = computeMetrics(7 * 억, 3.58 * 억, 6.74, { ...DEFAULT_ASSUMPTIONS, appraisalMultiple: 2 })
  assert.equal(a.appraisal, 7.16 * 억)
  // 감정가가 매매가보다 크면 프리미엄이 음수 — 그대로 보여준다
  assert.ok(a.premium! < 0)
})

test('공시가를 모르면 감정가·프리미엄을 내지 않는다', () => {
  const m = computeMetrics(7 * 억, null, 6.74)
  assert.equal(m.appraisal, null)
  assert.equal(m.premium, null)
})

test('대지 평당 매매가 = 매매가 / 대지지분', () => {
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74)
  // 7억 / 6.74평 ≈ 1.04억/평 — 그쪽 표시 1.0억/평
  assert.equal(Math.round(m.pricePerLandPyeong! / 1_000_000) / 100, 1.04)
})

const base: Listing = {
  id: '1',
  gu: '용산구',
  dong: '서계동',
  jibun: '245-11',
  type: '다세대',
  price: 7 * 억,
  publicPrice: 3.58 * 억,
  landSharePyeong: 6.74,
  savedAt: 1,
}

test('중개사 정보가 갖춰져야 공개 목록에 올릴 수 있다', () => {
  assert.equal(isPublishable(base), false)
  assert.equal(
    isPublishable({
      ...base,
      brokerOffice: '가람공인중개사사무소',
      brokerRegNo: '11680-2019-00420',
      brokerTel: '02-567-8007',
    }),
    true,
  )
})

test('등록번호가 빠지면 공개 불가 — 표시·광고 의무를 못 채운다', () => {
  assert.equal(isPublishable({ ...base, brokerOffice: 'A', brokerTel: '02-0000-0000' }), false)
})

test('초기투자금 낮은순 정렬', () => {
  const xs = [
    { ...base, id: 'a', price: 9 * 억 },
    { ...base, id: 'b', price: 5 * 억 },
  ]
  assert.equal(sortListings(xs, 'cash')[0].id, 'b')
})

test('프리미엄 정렬에서 값 없는 건은 뒤로 간다', () => {
  const xs = [
    { ...base, id: 'a', publicPrice: null },
    { ...base, id: 'b' },
  ]
  assert.equal(sortListings(xs, 'premium')[1].id, 'a')
})

test('취득세를 유형별로 가른다 — 근생이면 4.6%, 주택이면 훨씬 낮다', () => {
  const house = computeMetrics(7 * 억, 3.58 * 억, 6.74, DEFAULT_ASSUMPTIONS, '다세대주택', 42.96)
  const non = computeMetrics(7 * 억, 3.58 * 억, 6.74, DEFAULT_ASSUMPTIONS, '기타제1종근린생활시설', 42.96)
  assert.equal(non.taxRatePct, 4.6)
  assert.ok(house.taxRatePct! < 2)
  assert.ok(non.tax! - house.tax! > 19_000_000)
})

test('공시가를 모르면 초기투자금을 내지 않는다 — 0으로 두면 전액 현금이 된다', () => {
  const m = computeMetrics(7 * 억, null, 6.74, DEFAULT_ASSUMPTIONS, '기타제1종근린생활시설', 42.96)
  assert.equal(m.needsPublicPrice, true)
  assert.equal(m.initialCash, null)
  assert.equal(m.appraisal, null)
  assert.equal(m.premium, null)
  // 취득세는 공시가 없이도 나온다 — 매매가만 있으면 계산된다
  assert.ok(m.tax! > 0)
})

test('공시가가 있으면 초기투자금이 나온다', () => {
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74, DEFAULT_ASSUMPTIONS, '다세대주택', 42.96)
  assert.equal(m.needsPublicPrice, false)
  assert.ok(m.initialCash! > 0)
})

test('다주택 중과를 가정에 반영한다', () => {
  const one = computeMetrics(7 * 억, 3.58 * 억, 6.74, DEFAULT_ASSUMPTIONS, '다세대주택', 42.96)
  const three = computeMetrics(
    7 * 억,
    3.58 * 억,
    6.74,
    { ...DEFAULT_ASSUMPTIONS, houseCount: 3, adjusted: true },
    '다세대주택',
    42.96,
  )
  assert.ok(three.initialCash! > one.initialCash!)
  assert.equal(three.taxRatePct, 12.4)
})
