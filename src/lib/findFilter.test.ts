import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import {
  EMPTY_FILTERS,
  estimatePremium,
  matches,
  rollupByZone,
  sortItems,
  type FindItem,
} from './findFilter.ts'

const base: FindItem = {
  zoneId: 'z1',
  zoneName: '서계통합',
  projectType: 'redev',
  canonicalStage: 'union',
  stage: '조합설립인가',
  typeLabel: '다세대',
  dealDate: '2026-07-04',
  price: 7_0000_0000,
  dong: '서계동',
  jibun: '245-11',
  buildYear: 1996,
  exclusiveAr: 44.48,
  landPyeong: 6.74,
  pricePerLandPyeong: 1_0000_0000,
  publicPrice: 3_5800_0000,
  premium: null,
}

const F = { ...EMPTY_FILTERS }
const none = new Set<string>()

test('추정 프리미엄 = 거래가 − 대지지분 × 대지평당가 × 감정가율', () => {
  // 6.74평 × 1억/평 × 70% = 4.718억 → 7억 − 4.718억 = 2.282억
  assert.equal(estimatePremium(7_0000_0000, 6.74, 1_0000_0000, 70), 2_2820_0000)
})

test('대지지분이나 평당가를 모르면 프리미엄을 내지 않는다', () => {
  assert.equal(estimatePremium(7_0000_0000, null, 1_0000_0000), null)
  assert.equal(estimatePremium(7_0000_0000, 6.74, null), null)
})

test('가격 상한은 초과분을 뺀다', () => {
  assert.ok(matches(base, { ...F, priceMax: 8_0000_0000 }, none))
  assert.ok(!matches(base, { ...F, priceMax: 6_0000_0000 }, none))
})

test('공시가를 모르는 건은 "공시가 N억 이하"에 들지 않는다', () => {
  const unknown = { ...base, publicPrice: null }
  assert.ok(!matches(unknown, { ...F, publicPriceMax: 1_0000_0000 }, none))
})

test('단계 미확인 구역은 단계 필터를 걸면 빠진다', () => {
  const nostage = { ...base, canonicalStage: null }
  assert.ok(matches(nostage, F, none))
  assert.ok(!matches(nostage, { ...F, stages: ['union'] }, none))
})

test('사업종류·단계 필터가 맞으면 통과한다', () => {
  assert.ok(matches(base, { ...F, types: ['redev'], stages: ['union'] }, none))
  assert.ok(!matches(base, { ...F, types: ['garo'] }, none))
})

test('관심구역만 보기는 즐겨찾기에 있는 구역만 남긴다', () => {
  assert.ok(!matches(base, { ...F, favoritesOnly: true }, none))
  assert.ok(matches(base, { ...F, favoritesOnly: true }, new Set(['z1'])))
})

test('사용승인 연도 상한은 그보다 오래된 것만 남긴다', () => {
  assert.ok(matches(base, { ...F, builtBefore: 2000 }, none))
  assert.ok(!matches(base, { ...F, builtBefore: 1990 }, none))
})

test('대지지분·전용면적 하한이 걸린다', () => {
  assert.ok(matches(base, { ...F, landPyeongMin: 6 }, none))
  assert.ok(!matches(base, { ...F, landPyeongMin: 10 }, none))
  assert.ok(matches(base, { ...F, areaMin: 40 }, none))
  assert.ok(!matches(base, { ...F, areaMin: 50 }, none))
})

test('가격 오름차순 정렬', () => {
  const xs = [
    { ...base, price: 9_0000_0000 },
    { ...base, price: 5_0000_0000 },
  ]
  assert.equal(sortItems(xs, 'price')[0].price, 5_0000_0000)
})

test('프리미엄 정렬에서 값을 모르는 건은 뒤로 간다', () => {
  const xs = [
    { ...base, premium: null },
    { ...base, premium: 3_0000_0000 },
    { ...base, premium: 1_0000_0000 },
  ]
  const s = sortItems(xs, 'premium')
  assert.equal(s[0].premium, 1_0000_0000)
  assert.equal(s[2].premium, null)
})

test('구역별로 접으면 건수·최저가·중앙 평당가가 나온다', () => {
  const xs = [
    { ...base, price: 7_0000_0000, pricePerLandPyeong: 1_0000_0000 },
    { ...base, price: 9_0000_0000, pricePerLandPyeong: 1_2000_0000 },
    { ...base, zoneId: 'z2', zoneName: '정릉동', price: 3_2000_0000 },
  ]
  const r = rollupByZone(xs)
  assert.equal(r.length, 2)
  assert.equal(r[0].id, 'z1')
  assert.equal(r[0].count, 2)
  assert.equal(r[0].minPrice, 7_0000_0000)
  assert.equal(r[1].minPrice, 3_2000_0000)
})
