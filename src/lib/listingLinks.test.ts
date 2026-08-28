import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { parcelLinks, searchName, zoneLinks } from './listingLinks.ts'

test('지번 링크는 여러 곳을 준다 — 한 곳이 죽어도 남는다', () => {
  const l = parcelLinks('용산구', '서계동', '245-11')
  assert.ok(l.length >= 3)
  assert.ok(l.every((x) => x.href.startsWith('https://')))
})

test('주소가 인코딩되어 들어간다', () => {
  const [naver] = parcelLinks('용산구', '서계동', '245-11')
  assert.match(naver.href, /sk=/)
  assert.ok(naver.href.includes(encodeURIComponent('서울 용산구 서계동 245-11')))
})

test('구역 지도 링크에 재개발 매물종류만 실린다 — 아파트를 섞으면 목록이 덮인다', () => {
  const l = zoneLinks('장위15구역', [127.05, 37.61], '성북구')
  const map = l.find((x) => x.label.includes('지도'))!
  assert.match(map.href, /a=VL:DDDGG:JGB:JGC/)
  assert.ok(!map.href.includes('APT:'))
})

test('좌표가 없으면 지도 링크를 만들지 않는다 — 엉뚱한 곳을 열면 안 된다', () => {
  const l = zoneLinks('장위15구역', null, '성북구')
  assert.ok(!l.some((x) => x.label.includes('지도')))
  assert.ok(l.length >= 1)
})

test('자치구를 알면 중개사 찾기를 함께 준다', () => {
  const l = zoneLinks('장위15구역', [127.05, 37.61], '성북구')
  assert.ok(l.some((x) => x.label.includes('공인중개사')))
})

test('긴 법정 명칭에서 검색용 짧은 이름을 뽑는다', () => {
  assert.equal(searchName('장위15구역 주택재개발정비사업'), '장위15구역')
  assert.equal(searchName('천호2구역주택재개발사업'), '천호2구역')
  assert.equal(searchName('서계 통합구역 주택정비형 재개발구역'), '서계 통합구역')
})

test('구역 패턴이 아니면 원문을 크게 훼손하지 않는다', () => {
  const n = searchName('주택재개발사업구역')
  assert.ok(n.length > 0)
})
