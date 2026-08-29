import { test } from 'node:test'
import assert from 'node:assert/strict'
// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { verdict, verifyListing, type ListingFacts } from './verifyListing.ts'
import { resolveRightsDate } from './rightsDate.ts'

const has = (fs: ReturnType<typeof verifyListing>, code: string) => fs.some((f) => f.code === code)
const find = (fs: ReturnType<typeof verifyListing>, code: string) => fs.find((f) => f.code === code)

const zoneRights = resolveRightsDate({ name: '장위4구역', noticeDate: '2017-06-08' })

test('광고는 다세대인데 대장이 근린생활시설이면 위험으로 잡는다', () => {
  const f = verifyListing(
    { type: '다세대', exclusiveAr: 44.48 },
    { purpose: '제1종근린생활시설' },
  )
  assert.equal(find(f, 'not-housing')?.level, 'danger')
  assert.equal(verdict(f).level, 'danger')
})

test('둘 다 주택이면 정상으로 표시한다', () => {
  const f = verifyListing({ type: '다세대' }, { purpose: '공동주택' })
  assert.equal(find(f, 'purpose-ok')?.level, 'ok')
})

test('권리산정기준일 이후 사용승인은 물딱지 위험이다', () => {
  const facts: ListingFacts = { purpose: '공동주택', approvalDate: '2019-05-01', rightsBasis: zoneRights }
  const f = verifyListing({}, facts)
  assert.equal(find(f, 'post-rights-date')?.level, 'danger')
})

test('기준일 이전이면 통과시키되 쪼개기 확인을 덧붙인다', () => {
  const facts: ListingFacts = { purpose: '공동주택', approvalDate: '1996-12-27', rightsBasis: zoneRights }
  const f = verifyListing({}, facts)
  assert.equal(find(f, 'pre-rights-date')?.level, 'ok')
  assert.match(find(f, 'pre-rights-date')!.detail, /쪼개기/)
})

test('기준일을 모르는 구역에서는 안전하다고 말하지 않는다', () => {
  const unknown = resolveRightsDate({ name: '모아타운 대상지', noticeDate: '2023-01-01' })
  const f = verifyListing({}, { purpose: '공동주택', approvalDate: '2024-01-01', rightsBasis: unknown })
  assert.ok(!has(f, 'post-rights-date'))
  assert.ok(!has(f, 'pre-rights-date'))
  assert.equal(find(f, 'rights-date-unknown')?.level, 'warn')
})

test('광고 면적이 대장에 없는 값이면 주의로 잡는다', () => {
  const f = verifyListing({ exclusiveAr: 42.96 }, { unitAreas: [44.48, 62.01] })
  assert.equal(find(f, 'area-mismatch')?.level, 'warn')
  assert.match(find(f, 'area-mismatch')!.detail, /44.48/)
})

test('1㎡ 안쪽 차이는 같은 호로 본다', () => {
  const f = verifyListing({ exclusiveAr: 44.0 }, { unitAreas: [44.48] })
  assert.equal(find(f, 'area-ok')?.level, 'ok')
})

test('주택인데 공시가격이 없으면 주의로 남긴다', () => {
  const f = verifyListing({}, { purpose: '공동주택' })
  assert.equal(find(f, 'no-public-price')?.level, 'warn')
})

test('주택이 아니면 공시가격 없음을 문제 삼지 않는다', () => {
  const f = verifyListing({}, { purpose: '제2종근린생활시설' })
  assert.ok(!has(f, 'no-public-price'))
})

test('대지지분 근거를 함께 밝힌다 — 산정한 쪽이 붙인 꼬리표를 그대로 쓴다', () => {
  /*
   * 예전엔 여기서 'right' 를 "대지권등록부"라고 옮겼는데, 그 출처가 실은
   * 필지를 호수로 균등분할한 값이었다. 판정문이 근거를 지어내면 안 된다.
   * 이제는 landShareOf 가 붙인 꼬리표를 받아 그대로 적는다.
   */
  const f = verifyListing(
    {},
    { landSharePyeong: 6.74, landShareLabel: '실거래 신고' },
  )
  assert.match(find(f, 'land-share')!.detail, /실거래 신고/)

  const g = verifyListing({}, { landSharePyeong: 6.09, landShareLabel: '전용면적 비례 추정' })
  assert.match(find(g, 'land-share')!.detail, /비례 추정/)
})

test('지하 물건은 따로 짚는다', () => {
  const f = verifyListing({ floor: -1 }, {})
  assert.equal(find(f, 'basement')?.level, 'warn')
})

test('건축물대장을 못 찾으면 모른다고 한다 — 통과로 두지 않는다', () => {
  const f = verifyListing({ type: '다세대' }, {})
  assert.equal(find(f, 'purpose-unknown')?.level, 'unknown')
  assert.notEqual(verdict(f).level, 'ok')
})

test('위험이 먼저 오도록 정렬한다', () => {
  const f = verifyListing(
    { type: '다세대', floor: -1 },
    { purpose: '제1종근린생활시설', landSharePyeong: 5, landShareSource: 'right' },
  )
  assert.equal(f[0].level, 'danger')
})
