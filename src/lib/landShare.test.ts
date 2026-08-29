import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landShareOf } from './landShare.ts'

/* 서계동 245-11 — 실거래 원본이 있는 건물 */
const SEOGYE_AREAS = [23.16, 19.8, 42.96, 26.58, 17.9, 44.48, 44.48] // 합 219.36
const SEOGYE_LAND = 109.83

test('실거래 대지권면적이 있으면 그걸 쓴다', () => {
  const r = landShareOf({ unitArea: 44.48, dealLandM2: 22.27 })
  assert.equal(r.basis, 'deal')
  assert.equal(r.m2, 22.27)
  assert.equal(r.pyeong, 6.74)
  assert.match(r.note, /추정입니다/) // 호 특정은 추정이라고 밝힌다
})

test('전용면적 비례가 실거래 원본을 재현한다 — 301호', () => {
  const r = landShareOf({
    unitArea: 44.48,
    allUnitAreas: SEOGYE_AREAS,
    totalLandM2: SEOGYE_LAND,
  })
  assert.equal(r.basis, 'proportional')
  // 실거래 신고서: 22.27㎡
  assert.ok(Math.abs(r.m2! - 22.27) < 0.05, `${r.m2} 가 22.27 에 가까워야 한다`)
})

test('전용면적 비례가 실거래 원본을 재현한다 — 지층02호', () => {
  const r = landShareOf({ unitArea: 19.8, allUnitAreas: SEOGYE_AREAS, totalLandM2: SEOGYE_LAND })
  // 실거래 신고서: 9.91㎡
  assert.ok(Math.abs(r.m2! - 9.91) < 0.05, `${r.m2} 가 9.91 에 가까워야 한다`)
})

test('균등분할은 실거래와 크게 어긋난다 — 그래서 마지막이다', () => {
  const equal = landShareOf({ allUnitAreas: SEOGYE_AREAS, totalLandM2: SEOGYE_LAND })
  assert.equal(equal.basis, 'equal')
  assert.equal(equal.m2, 15.69) // 우리가 실측이라고 믿었던 그 값
  // 301호 실제 22.27 대비 6.58㎡(약 2평) 부족하다
  assert.ok(Math.abs(equal.m2! - 22.27) > 6)
  assert.match(equal.label, /근거 약함/)
})

test('같은 건물 실거래 비율을 이 호에 적용한다', () => {
  // 장위동 229-41 — 비율 0.629 가 4건 모두 같았다
  const r = landShareOf({
    unitArea: 39.38,
    buildingDeals: [
      { area: 40.55, landM2: 25.51 },
      { area: 33.02, landM2: 20.77 },
    ],
  })
  assert.equal(r.basis, 'buildingRatio')
  assert.ok(Math.abs(r.m2! - 24.77) < 0.1, `${r.m2} 가 24.77 에 가까워야 한다`)
})

test('건물 비율은 중앙값을 써 이상치를 피한다', () => {
  // 장위동 219-97 — 한 호만 0.114 로 튄다
  const r = landShareOf({
    unitArea: 42.3,
    buildingDeals: [
      { area: 23.4, landM2: 19.31 }, // 0.825
      { area: 29.35, landM2: 3.35 }, // 0.114 ← 이상치
      { area: 42.3, landM2: 34.9 }, // 0.825
    ],
  })
  assert.ok(Math.abs(r.m2! - 34.9) < 0.5, `${r.m2} — 이상치에 끌려가면 안 된다`)
})

test('실거래가 비례보다 앞선다', () => {
  const r = landShareOf({
    unitArea: 44.48,
    allUnitAreas: SEOGYE_AREAS,
    totalLandM2: SEOGYE_LAND,
    dealLandM2: 22.27,
  })
  assert.equal(r.basis, 'deal')
})

test('근거가 없으면 숫자를 만들지 않는다', () => {
  const r = landShareOf({ unitArea: 44.48 })
  assert.equal(r.basis, 'none')
  assert.equal(r.m2, null)
  assert.equal(r.pyeong, null)
  assert.match(r.note, /등기부등본/)
})
