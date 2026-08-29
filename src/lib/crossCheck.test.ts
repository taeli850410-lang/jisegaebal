import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crossCheck, crossVerdict } from './crossCheck.ts'

const row = (rows: ReturnType<typeof crossCheck>, f: string) => rows.find((r) => r.field === f)!

test('같은 답이면 일치로 본다', () => {
  const rows = crossCheck({
    ours: { ho: '301', purpose: '다세대주택', exclusiveAr: 44.48, publicPrice: 358_000_000 },
    theirs: { ho: '301', purpose: '다세대주택', exclusiveAr: 44.48, publicPrice: 358_000_000 },
  })
  assert.equal(row(rows, 'ho').status, 'agree')
  assert.equal(row(rows, 'publicPrice').status, 'agree')
  assert.equal(crossVerdict(rows).level, 'partial') // 대지지분은 양쪽 없음
})

test('호가 갈리면 갈렸다고 말하고 이유를 붙인다', () => {
  const rows = crossCheck({
    ours: { ho: '101', exclusiveAr: 42.96 },
    theirs: { ho: '301', exclusiveAr: 44.48 },
  })
  const r = row(rows, 'ho')
  assert.equal(r.status, 'differ')
  assert.match(r.note!, /다른 호/)
  assert.equal(crossVerdict(rows).level, 'differ')
})

test('전용면적은 0.5㎡ 안이면 같은 것으로 본다', () => {
  const near = crossCheck({ ours: { exclusiveAr: 44.48 }, theirs: { exclusiveAr: 44.5 } })
  assert.equal(row(near, 'area').status, 'agree')
  const far = crossCheck({ ours: { exclusiveAr: 42.96 }, theirs: { exclusiveAr: 44.48 } })
  assert.equal(row(far, 'area').status, 'differ')
})

test('대지지분 — 우리가 실측이면 그렇다고 적는다', () => {
  const rows = crossCheck({
    ours: { landSharePyeong: 6.74, landShareBasis: 'deal', landShareLabel: '실거래 신고' },
    theirs: { landSharePyeong: 6.09 },
  })
  const r = row(rows, 'landShare')
  assert.equal(r.status, 'differ')
  assert.match(r.note!, /실거래 신고서/)
  assert.match(r.note!, /추정/)
})

test('대지지분 — 우리도 추정이면 둘 다 추정이라고 적는다', () => {
  const rows = crossCheck({
    ours: { landSharePyeong: 6.1, landShareBasis: 'proportional', landShareLabel: '전용면적 비례 추정' },
    theirs: { landSharePyeong: 6.09 },
  })
  const r = row(rows, 'landShare')
  assert.equal(r.status, 'agree') // 0.2평 안
  assert.match(r.note!, /모두 추정/)
})

test('실거래 대지권면적은 등기 원본이라 따로 세운다', () => {
  // 서계동 245-11 301호 실거래 신고서의 대지권면적 22.27㎡ = 6.74평
  const rows = crossCheck({
    ours: { landSharePyeong: 6.09, landShareBasis: 'proportional' },
    theirs: { landSharePyeong: 6.09, dealLandShareM2: 22.27, dealLabel: '2024-10-07 6.90억' },
  })
  const r = row(rows, 'dealLandShare')
  assert.equal(r.theirs, '6.74평')
  assert.equal(r.status, 'differ') // 6.09 vs 6.74 — 추정이 0.65평 어긋났다
  assert.match(r.note!, /등기 값/)
  assert.match(r.note!, /2024-10-07/)
})

test('공시가가 양쪽 다 없으면 이유를 적는다', () => {
  const rows = crossCheck({ ours: { ho: '101' }, theirs: { ho: '101' } })
  const r = row(rows, 'publicPrice')
  assert.equal(r.status, 'neither')
  assert.match(r.note!, /공동주택가격 대상이 아닐/)
})

test('호파인더가 없으면 우리 값만 남는다', () => {
  const rows = crossCheck({ ours: { ho: '301', publicPrice: 358_000_000 }, theirs: null })
  assert.equal(row(rows, 'ho').status, 'onlyOurs')
  assert.equal(crossVerdict(rows).level, 'none')
})

test('호 표기가 달라도 같은 집이면 일치로 본다', () => {
  // 대장은 "3층301호", 호파인더는 "301"
  const rows = crossCheck({ ours: { ho: '3층301호' }, theirs: { ho: '301' } })
  assert.equal(row(rows, 'ho').status, 'agree')
})

test('지하와 지상은 번호가 같아도 섞지 않는다', () => {
  const rows = crossCheck({ ours: { ho: '지층01호' }, theirs: { ho: '101' } })
  assert.equal(row(rows, 'ho').status, 'differ')
})

test('앞자리 0 은 무시한다', () => {
  const rows = crossCheck({ ours: { ho: '지층02호' }, theirs: { ho: 'B2' } })
  assert.equal(row(rows, 'ho').status, 'agree')
})
