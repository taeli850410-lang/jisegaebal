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
  const withTax = computeMetrics(7 * 억, 3.58 * 억, 6.74)
  const noTax = computeMetrics(7 * 억, 3.58 * 억, 6.74, {
    ...DEFAULT_ASSUMPTIONS,
    acquisitionTaxRate: 0,
  })
  assert.ok(withTax.initialCash! > noTax.initialCash!)
  // 7억의 4.6% = 3,220만원 — 판단이 바뀌는 크기다
  assert.equal(withTax.initialCash! - noTax.initialCash!, 32_200_000)
})

test('레버리지는 공시가에 비율을 곱한다', () => {
  const m = computeMetrics(7 * 억, 3.58 * 억, 6.74, {
    ...DEFAULT_ASSUMPTIONS,
    acquisitionTaxRate: 0,
    leverageRate: 0.64,
  })
  // 7억 − 3.58억×64% = 4.71억
  assert.equal(Math.round(m.initialCash! / 1_000_000) / 100, 4.71)
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
