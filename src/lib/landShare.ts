/**
 * 대지지분 (대지권).
 *
 * 재개발에서 가장 무거운 숫자다. 감정평가액이 여기서 갈리고, 조합 분담금이
 * 거기서 갈린다. 그래서 어떻게 구한 값인지를 값과 함께 내보낸다.
 *
 * 왜 다시 만들었나
 *   V-World 소유정보의 lndpclAr 을 "호별 실측 대지권"으로 믿고 썼는데
 *   아니었다. 캐시에 쌓인 104개 건물 중 60개(58%)에서 모든 호가 같은 값이고,
 *   그 값 × 호수가 정확히 필지면적이다 — 필지를 호수로 균등분할한 것이다.
 *
 *   서계동 245-11 이 그 예다. 7개 호가 전부 15.69㎡ 로 나왔는데
 *   실거래 신고서의 대지권면적은 301호 22.27㎡, 지층02호 9.91㎡ 였다.
 *   전용면적이 44.48 과 19.8 인데 대지권이 같을 수가 없다.
 *
 * 무엇이 맞나
 *   실거래 560건을 훑어 같은 건물에서 전용면적이 다른 거래를 비교했다.
 *   49개 건물 중 40개(82%)에서 대지권/전용 비율이 소수점 셋째 자리까지 같았다.
 *     장위동 229-41  40.55→25.51 (0.629) · 33.02→20.77 (0.629)
 *     장위동 219-314 20.02→15.25 (0.762) · 29.89→22.77 (0.762)
 *   대지권은 전용면적에 비례한다. 균등분할이 아니다.
 *
 *   맞지 않는 9개는 실제로 지분이 다르게 등기된 건물이다(한 호만 3.35㎡ 같은
 *   경우). 그래서 비례도 "추정"이라고 부르고, 실거래 원본이 있으면 그걸 앞세운다.
 */

export type LandShareBasis =
  /** 이 호의 실거래 신고서에 실린 대지권면적 — 등기에서 온 값 */
  | 'deal'
  /** 같은 건물 다른 거래의 대지권/전용 비율을 이 호 전용에 적용 */
  | 'buildingRatio'
  /** 대지권 총면적을 전용면적 비율로 나눔 */
  | 'proportional'
  /** 총면적 ÷ 호수 — 근거가 약하다 */
  | 'equal'
  | 'none'

export interface LandShareInput {
  /** 이 호의 전용면적 (㎡) */
  unitArea?: number | null
  /** 건물 전체 호의 전용면적 (㎡) */
  allUnitAreas?: number[] | null
  /** 대지권 총면적 (㎡) */
  totalLandM2?: number | null
  /** 이 호로 추정되는 실거래의 대지권면적 (㎡) */
  dealLandM2?: number | null
  /** 같은 건물의 다른 실거래 — 비율을 뽑는 데 쓴다 */
  buildingDeals?: { area: number; landM2: number }[] | null
}

export interface LandShare {
  m2: number | null
  pyeong: number | null
  basis: LandShareBasis
  /** 화면에 붙일 짧은 꼬리표 */
  label: string
  /** 왜 이 값인지 */
  note: string
}

const PYEONG = 3.3058
const r2 = (n: number) => Math.round(n * 100) / 100

function done(m2: number, basis: LandShareBasis, label: string, note: string): LandShare {
  return { m2: r2(m2), pyeong: r2(m2 / PYEONG), basis, label, note }
}

export function landShareOf(input: LandShareInput): LandShare {
  const { unitArea, allUnitAreas, totalLandM2, dealLandM2, buildingDeals } = input

  /* ① 이 호의 실거래에 대지권면적이 실려 있으면 그게 등기 값이다 */
  if (dealLandM2 && dealLandM2 > 0) {
    return done(
      dealLandM2,
      'deal',
      '실거래 신고',
      '이 호로 추정되는 실거래 신고서의 대지권면적입니다. 등기에서 온 값이라 가장 무겁습니다. 다만 실거래는 호수를 공개하지 않아 그 거래가 이 호인지는 추정입니다.',
    )
  }

  /*
   * ② 같은 건물의 다른 거래에서 비율을 뽑아 이 호에 적용한다.
   *
   * 건물마다 비율이 다르므로(0.475 ~ 0.825) 남의 건물 비율을 가져오면 안 되고,
   * 이 건물 것만 쓴다. 거래가 여러 건이면 중앙값을 써서 이상치를 피한다.
   */
  if (unitArea && unitArea > 0 && buildingDeals?.length) {
    const ratios = buildingDeals
      .filter((d) => d.area > 0 && d.landM2 > 0)
      .map((d) => d.landM2 / d.area)
      .sort((a, b) => a - b)
    if (ratios.length) {
      const mid = ratios[Math.floor(ratios.length / 2)]
      return done(
        unitArea * mid,
        'buildingRatio',
        '같은 건물 실거래 비율',
        `이 건물 실거래 ${ratios.length}건의 대지권/전용 비율(${r2(mid)})을 이 호 전용면적에 적용했습니다. 추정입니다.`,
      )
    }
  }

  /* ③ 대지권 총면적을 전용면적 비율로 나눈다 */
  const sum = (allUnitAreas ?? []).reduce((s, a) => s + a, 0)
  if (unitArea && unitArea > 0 && totalLandM2 && totalLandM2 > 0 && sum > 0) {
    return done(
      (totalLandM2 * unitArea) / sum,
      'proportional',
      '전용면적 비례 추정',
      '대지권 총면적을 호별 전용면적 비율로 나눈 추정치입니다. 실거래로 확인한 건물의 82%가 이 방식과 맞았습니다. 확정은 등기부 대지권비율입니다.',
    )
  }

  /*
   * ④ 균등분할 — 근거가 약하다.
   * 이 값을 내보낼 땐 반드시 약하다고 함께 말한다. 전용면적이 두 배 차이 나는
   * 호들이 같은 대지지분을 가질 리 없기 때문이다.
   */
  const n = (allUnitAreas ?? []).length
  if (totalLandM2 && totalLandM2 > 0 && n > 0) {
    return done(
      totalLandM2 / n,
      'equal',
      '균등분할 (근거 약함)',
      `대지권 총면적을 호수(${n})로 나눈 값입니다. 실제 대지권은 대개 전용면적에 비례하므로 이 값은 크게 어긋날 수 있습니다. 등기부 확인이 필요합니다.`,
    )
  }

  return {
    m2: null,
    pyeong: null,
    basis: 'none',
    label: '확인 불가',
    note: '대지권을 산정할 근거가 없습니다. 등기부등본(대지권등록부)을 확인하세요.',
  }
}
