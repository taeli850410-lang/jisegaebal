import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { resolveRightsDate, verifyLinks } from './rightsDate.ts'

test('일반 재개발은 정비구역 지정 고시일을 기준일로 본다', () => {
  const r = resolveRightsDate({
    name: '장위4구역 주택재개발정비사업',
    rawLabel: '주택정비형 재개발',
    noticeDate: '2017-06-08',
  })
  assert.equal(r.basis, 'notice')
  assert.equal(r.date, '2017-06-08')
})

test('공공재개발은 후보지 선정일이 따로 있으므로 고시일을 내지 않는다', () => {
  const r = resolveRightsDate({
    name: '신설 제1 주택정비형 공공재개발사업',
    rawLabel: '주택정비형 재개발',
    noticeDate: '2021-03-29',
  })
  assert.equal(r.basis, 'candidate')
  assert.equal(r.date, null)
})

test('역세권 장기전세도 예외로 가른다', () => {
  const r = resolveRightsDate({
    name: '천왕3역세권 장기전세주택 도시정비형 재개발정비구역',
    noticeDate: '2024-05-20',
  })
  assert.equal(r.basis, 'candidate')
})

test('신속통합기획·모아타운도 예외다', () => {
  assert.equal(resolveRightsDate({ name: '신속통합기획 후보지', noticeDate: '2022-01-01' }).basis, 'candidate')
  assert.equal(resolveRightsDate({ name: '중화동 모아타운', noticeDate: '2023-01-01' }).basis, 'candidate')
})

test('사업종류 코드로도 예외를 잡는다 — 이름에 안 들어가는 경우가 있다', () => {
  assert.equal(
    resolveRightsDate({ name: 'A구역', projectType: 'sintong', noticeDate: '2022-01-01' }).basis,
    'candidate',
  )
  assert.equal(
    resolveRightsDate({ name: 'B구역', projectType: 'moa', noticeDate: '2022-01-01' }).basis,
    'candidate',
  )
})

test('고시일이 없으면 unknown — 없는 날짜를 지어내지 않는다', () => {
  const r = resolveRightsDate({ name: '주택재개발사업구역', noticeDate: null })
  assert.equal(r.basis, 'unknown')
  assert.equal(r.date, null)
})

test('예외 구역이면 고시일이 있어도 날짜를 내지 않는다', () => {
  const r = resolveRightsDate({ name: '모아타운 대상지', noticeDate: '2023-05-05' })
  assert.equal(r.date, null)
})

test('어느 경우든 확인하라는 안내가 붙는다', () => {
  for (const n of ['일반구역', '모아타운 구역']) {
    const r = resolveRightsDate({ name: n, noticeDate: '2020-01-01' })
    assert.ok(r.note.length > 10)
  }
})

test('자치구를 알면 그 구 고시·공고 링크가 먼저 온다', () => {
  const l = verifyLinks('장위4구역', '성북구', '장위동 174')
  assert.equal(l[0].label, '성북구 고시·공고')
  assert.ok(l.some((x) => x.label === '토지이음'))
})

test('자치구를 몰라도 시 단위 링크는 준다', () => {
  const l = verifyLinks('어떤구역', null)
  assert.ok(l.length >= 3)
  assert.ok(!l.some((x) => x.label.endsWith('구 고시·공고')))
})
