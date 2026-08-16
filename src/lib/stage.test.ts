import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveStage } from './stage.ts'

const d = (date: string) => ({ date })

test('추진경과가 목록보다 앞서면 추진경과를 현재 단계로 본다', () => {
  // 응암동 700번지: 목록은 추진위승인, 추진경과에는 조합설립인가 2026-06-06
  const r = resolveStage('committee', {
    zone_designated: d('2025-08-14'),
    committee: d('2025-11-10'),
    union: d('2026-06-06'),
  })
  assert.equal(r.current?.code, 'union')
  assert.equal(r.listed?.code, 'committee')
  assert.equal(r.ahead, true)
})

test('목록이 더 앞서면 목록을 따른다 — 인가일 누락으로 되돌리지 않는다', () => {
  const r = resolveStage('mgmt_disposal', { union: d('2012-01-01') })
  assert.equal(r.current?.code, 'mgmt_disposal')
  assert.equal(r.ahead, false)
})

test('둘이 같으면 그대로', () => {
  const r = resolveStage('union', { committee: d('2004-09-24'), union: d('2008-02-18') })
  assert.equal(r.current?.code, 'union')
  assert.equal(r.ahead, false)
})

test('추진경과가 없으면 목록만 쓴다', () => {
  const r = resolveStage('committee', null)
  assert.equal(r.current?.code, 'committee')
  assert.equal(r.ahead, false)
})

test('목록 단계가 없으면 추진경과에서 뽑되 ahead 로 표시하지 않는다', () => {
  const r = resolveStage(null, { union: d('2020-01-01') })
  assert.equal(r.current?.code, 'union')
  assert.equal(r.ahead, false)
})

test('둘 다 없으면 null', () => {
  const r = resolveStage(null, null)
  assert.equal(r.current, null)
  assert.equal(r.listed, null)
})

test('빈 날짜는 무시한다', () => {
  const r = resolveStage('committee', { union: { date: '' } })
  assert.equal(r.current?.code, 'committee')
})
