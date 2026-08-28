import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { acquisitionTax, kindFromPurpose } from './tax.ts'

const 억 = 100_000_000
const rate = (i: Parameters<typeof acquisitionTax>[0]) => acquisitionTax(i).ratePct

test('주택 6억 이하 85㎡ 이하 = 1.1%', () => {
  assert.equal(rate({ kind: 'house', price: 5 * 억, exclusiveAr: 59 }), 1.1)
})

test('주택 6억 이하 85㎡ 초과면 농어촌특별세가 붙어 1.3%', () => {
  assert.equal(rate({ kind: 'house', price: 5 * 억, exclusiveAr: 114 }), 1.3)
})

test('주택 9억 초과 = 3.3%', () => {
  assert.equal(rate({ kind: 'house', price: 12 * 억, exclusiveAr: 59 }), 3.3)
})

test('6~9억 구간은 매끄럽게 오른다 — 7억이면 약 1.83%', () => {
  const r = rate({ kind: 'house', price: 7 * 억, exclusiveAr: 42.96 })
  assert.ok(r > 1.7 && r < 2.0, `실제 ${r}`)
})

test('구간 경계에서 튀지 않는다', () => {
  assert.equal(rate({ kind: 'house', price: 6 * 억, exclusiveAr: 59 }), 1.1)
  const just = rate({ kind: 'house', price: 6.01 * 억, exclusiveAr: 59 })
  assert.ok(just >= 1.1 && just < 1.2, `실제 ${just}`)
})

test('근생·토지는 4.6% — 이게 일괄 적용하면 안 되는 그 값이다', () => {
  assert.equal(rate({ kind: 'nonHouse', price: 7 * 억, exclusiveAr: 42.96 }), 4.6)
})

test('같은 7억이라도 주택과 근생이 1,900만원 넘게 차이 난다', () => {
  const house = acquisitionTax({ kind: 'house', price: 7 * 억, exclusiveAr: 42.96 }).amount
  const non = acquisitionTax({ kind: 'nonHouse', price: 7 * 억, exclusiveAr: 42.96 }).amount
  assert.ok(non - house > 19_000_000, `차이 ${non - house}`)
})

test('조정대상지역 2주택은 중과 8.4%', () => {
  assert.equal(rate({ kind: 'house', price: 7 * 억, exclusiveAr: 59, houseCount: 2, adjusted: true }), 8.4)
})

test('비조정 2주택은 중과가 아니다', () => {
  const r = rate({ kind: 'house', price: 7 * 억, exclusiveAr: 59, houseCount: 2, adjusted: false })
  assert.ok(r < 3, `실제 ${r}`)
})

test('조정 3주택은 12.4%, 85㎡ 초과면 13.4%', () => {
  assert.equal(rate({ kind: 'house', price: 7 * 억, exclusiveAr: 59, houseCount: 3, adjusted: true }), 12.4)
  assert.equal(rate({ kind: 'house', price: 7 * 억, exclusiveAr: 114, houseCount: 3, adjusted: true }), 13.4)
})

test('계산 근거를 함께 돌려준다 — 숫자만 던지지 않는다', () => {
  const t = acquisitionTax({ kind: 'house', price: 7 * 억, exclusiveAr: 114 })
  assert.ok(t.breakdown.some((b) => b.label === '취득세'))
  assert.ok(t.breakdown.some((b) => b.label === '농어촌특별세'))
  assert.ok(t.note.length > 5)
})

test('대장 용도로 주택/비주택을 가른다 — 광고 문구가 아니라 대장이 기준이다', () => {
  assert.equal(kindFromPurpose('기타제1종근린생활시설'), 'nonHouse')
  assert.equal(kindFromPurpose('다세대주택'), 'house')
  assert.equal(kindFromPurpose('공동주택'), 'house')
  assert.equal(kindFromPurpose(null), 'house')
})
