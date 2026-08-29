import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cacheHeaders, NO_CACHE } from './cacheHeaders.ts'

test('브라우저는 캐시하지 않고 CDN 만 캐시한다', () => {
  const h = cacheHeaders('daily')['Cache-Control']
  assert.match(h, /max-age=0/) // 브라우저
  assert.match(h, /s-maxage=86400/) // CDN
})

test('만료 뒤에도 옛 답을 먼저 준다', () => {
  // 이게 없으면 만료 직후 한 명이 31초를 기다린다
  for (const p of ['hourly', 'daily', 'weekly'] as const) {
    assert.match(cacheHeaders(p)['Cache-Control'], /stale-while-revalidate=[0-9]+/)
  }
})

test('원자료가 자주 바뀔수록 짧다', () => {
  const n = (p: 'hourly' | 'daily' | 'weekly') =>
    Number(cacheHeaders(p)['Cache-Control'].match(/s-maxage=([0-9]+)/)![1])
  assert.ok(n('hourly') < n('daily'))
  assert.ok(n('daily') < n('weekly'))
})

test('실패는 캐시하지 않는다', () => {
  assert.equal(NO_CACHE['Cache-Control'], 'no-store')
})
