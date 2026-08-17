import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { decodeBurden, encodeBurden, type BurdenState } from './burdenShare.ts'

const S: BurdenState = {
  landShare: 10.5,
  appraisalRate: 70,
  purchasePrice: 1_200_000_000,
  bijul: 105,
  memberPpp: 42_000_000,
  targetPyeong: 25,
  taxRate: 4.6,
  financeCost: 30_000_000,
  otherCosts: 5_000_000,
  expectedPpp: 61_000_000,
  manualAppraisal: null,
}

test('인코딩한 걸 디코딩하면 원래 값이 나온다', () => {
  const back = decodeBurden(encodeBurden(S))
  assert.deepEqual({ ...S, ...back }, S)
})

test('직접 입력한 감정가도 왕복한다', () => {
  const s = { ...S, manualAppraisal: 830_000_000 }
  assert.equal(decodeBurden(encodeBurden(s))?.manualAppraisal, 830_000_000)
})

test('감정가를 안 넣었으면 복원해도 비어 있다 — 추정치를 쓰라는 뜻이다', () => {
  assert.equal(decodeBurden(encodeBurden(S))?.manualAppraisal, undefined)
})

test('소수점이 있는 값도 잃지 않는다', () => {
  const back = decodeBurden(encodeBurden(S))
  assert.equal(back?.landShare, 10.5)
  assert.equal(back?.taxRate, 4.6)
})

test('빈 문자열과 null 은 null 을 돌려준다', () => {
  assert.equal(decodeBurden(null), null)
  assert.equal(decodeBurden(''), null)
})

test('필드가 모자란 옛 링크는 읽힌 것만 돌려준다', () => {
  // 앞의 네 칸만 있는 링크
  const back = decodeBurden('10.5-70-120000-105')
  assert.equal(back?.landShare, 10.5)
  assert.equal(back?.purchasePrice, 1_200_000_000)
  assert.equal(back?.targetPyeong, undefined)
})

test('숫자가 아닌 칸은 건너뛰고 나머지를 살린다', () => {
  const back = decodeBurden('abc-70-120000')
  assert.equal(back?.landShare, undefined)
  assert.equal(back?.appraisalRate, 70)
})

test('전부 쓰레기면 null', () => {
  assert.equal(decodeBurden('-'), null)
})

test('금액은 만원 단위로 줄여 URL 을 짧게 만든다', () => {
  // 12억 = 120000만
  assert.ok(encodeBurden(S).includes('120000'))
  assert.ok(!encodeBurden(S).includes('1200000000'))
})
