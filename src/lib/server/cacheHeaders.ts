/**
 * CDN 캐시 헤더.
 *
 * 우리 라우트는 대부분 공공데이터를 조합해 같은 입력에 같은 답을 낸다.
 * 그런데 헤더가 하나도 없어서 매번 처음부터 다시 계산하고 있었다.
 * 실측한 프로덕션 응답 시간이 그 값이다 —
 *   /api/deal-markers   31.4초
 *   /api/zone-parcels   13.9초
 *   /api/apt-markers    10.7초
 * 서울 전역을 훑는 화면에서 이건 사람이 기다릴 수 있는 시간이 아니다.
 *
 * 원자료가 얼마나 자주 바뀌는지에 맞춰 나눈다.
 *   실거래   국토부가 하루 단위로 갱신한다
 *   공시가격 연 1회
 *   필지     거의 안 바뀐다
 *   구역     고시가 나야 바뀐다 — 며칠에 한 번
 *
 * stale-while-revalidate 를 길게 둔다. 만료된 뒤에도 옛 답을 먼저 주고
 * 뒤에서 새로 만들기 때문에, 사용자가 31초를 기다리는 일이 사라진다.
 *
 * 사용자가 넣은 값이 섞이는 곳(매물 목록)에는 절대 쓰지 않는다.
 */

export type CacheProfile =
  /** 실거래·경매 — 하루 */
  | 'daily'
  /** 필지·공시가격 — 일주일 */
  | 'weekly'
  /** 구역 목록·검색 — 한 시간 */
  | 'hourly'

const S = {
  hourly: { max: 3600, swr: 86_400 },
  daily: { max: 86_400, swr: 604_800 },
  weekly: { max: 604_800, swr: 2_592_000 },
} as const

/**
 * CDN 에만 캐시한다(s-maxage). 브라우저는 캐시하지 않게 max-age=0 을 둔다 —
 * 사용자가 새로고침했을 때 CDN 이 갱신한 답을 바로 받아야 하기 때문이다.
 */
export function cacheHeaders(profile: CacheProfile): Record<string, string> {
  const { max, swr } = S[profile]
  return {
    'Cache-Control': `public, max-age=0, s-maxage=${max}, stale-while-revalidate=${swr}`,
  }
}

/** 조회가 실패했을 땐 캐시하지 않는다 — 실패를 하루 동안 돌려주면 안 된다 */
export const NO_CACHE: Record<string, string> = {
  'Cache-Control': 'no-store',
}
