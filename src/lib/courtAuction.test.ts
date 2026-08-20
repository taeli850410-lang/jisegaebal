import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { SEOUL_COURTS, courtOf } from './courtAuction.ts'

test('서울 25개 자치구가 빠짐없이, 겹침 없이 배정된다', () => {
  const all = SEOUL_COURTS.flatMap((c) => c.gus)
  assert.equal(all.length, 25)
  assert.equal(new Set(all).size, 25)
})

test('관할이 정확하다 — 강동구는 동부, 마포구는 서부', () => {
  assert.equal(courtOf('강동구')?.name, '서울동부지방법원')
  assert.equal(courtOf('마포구')?.name, '서울서부지방법원')
  assert.equal(courtOf('강남구')?.name, '서울중앙지방법원')
  assert.equal(courtOf('노원구')?.name, '서울북부지방법원')
  assert.equal(courtOf('구로구')?.name, '서울남부지방법원')
})

test('성북구는 중앙이 아니라 북부다 — 헷갈리기 쉬운 곳', () => {
  assert.equal(courtOf('성북구')?.name, '서울북부지방법원')
})

test('모르는 자치구는 null', () => {
  assert.equal(courtOf('부산진구'), null)
  assert.equal(courtOf(null), null)
  assert.equal(courtOf(undefined), null)
})
