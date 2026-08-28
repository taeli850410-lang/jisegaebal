/**
 * 취득세율 (지방세법).
 *
 * 4.6% 를 일괄 적용하면 틀린다. 그건 주택이 아닌 것(근생·토지·상가)의 세율이다.
 * 7억짜리를 주택으로 사면 실효 약 1.8%, 근생으로 사면 4.6% —
 * 1,900만원 넘게 차이 나서 초기투자금 판단이 뒤집힌다.
 *
 * 세율은 개정이 잦다. 그래서 계산 로직이 아니라 이 파일 한 곳에 모아 둔다.
 * 개정되면 여기 숫자만 고치면 된다.
 *
 * 구성
 *   취득세 + 지방교육세 + 농어촌특별세
 *   지방교육세 = 취득세율의 10% (주택 일반), 중과·비주택은 고정
 *   농어촌특별세 = 전용 85㎡ 초과일 때만 (국민주택규모 이하는 비과세)
 */

export type PropertyKind = 'house' | 'nonHouse'

export interface TaxInput {
  /** 주택인가 — 근생·상가·토지는 nonHouse */
  kind: PropertyKind
  /** 취득가액 (원) */
  price: number
  /** 전용면적 (㎡). 85㎡ 초과면 농어촌특별세가 붙는다. */
  exclusiveAr?: number | null
  /** 취득 후 보유 주택 수 (중과 판정) */
  houseCount?: 1 | 2 | 3
  /** 조정대상지역 여부 */
  adjusted?: boolean
}

export interface TaxResult {
  /** 합계 실효세율 (%) */
  ratePct: number
  /** 세액 (원) */
  amount: number
  /** 어떻게 나왔는지 — 화면에 그대로 보여준다 */
  breakdown: { label: string; pct: number }[]
  note: string
}

const 억 = 100_000_000
/** 국민주택규모 — 이 이하는 농어촌특별세가 없다 */
const NATIONAL_SIZE_M2 = 85

/**
 * 주택 유상취득 기본세율.
 *   6억 이하        1%
 *   6억 초과 9억 이하  (가액[억] × 2/3 − 3) %  — 1%에서 3%로 매끄럽게 오른다
 *   9억 초과        3%
 */
function houseBaseRate(price: number): number {
  const eok = price / 억
  if (eok <= 6) return 1
  if (eok <= 9) return Math.round((eok * (2 / 3) - 3) * 100) / 100
  return 3
}

/** 다주택·조정대상지역 중과 */
function heavyRate(houseCount: number, adjusted: boolean): number | null {
  if (adjusted) {
    if (houseCount === 2) return 8
    if (houseCount >= 3) return 12
  } else {
    if (houseCount >= 3) return 8
  }
  return null
}

export function acquisitionTax(input: TaxInput): TaxResult {
  const { kind, price, exclusiveAr, houseCount = 1, adjusted = false } = input
  const big = (exclusiveAr ?? 0) > NATIONAL_SIZE_M2

  if (kind === 'nonHouse') {
    /* 근생·상가·토지 — 그리고 멸실된 입주권도 토지 취득이라 여기에 온다 */
    const parts = [
      { label: '취득세', pct: 4 },
      { label: '지방교육세', pct: 0.4 },
      { label: '농어촌특별세', pct: 0.2 },
    ]
    const ratePct = 4.6
    return {
      ratePct,
      amount: Math.round(price * (ratePct / 100)),
      breakdown: parts,
      note: '주택이 아닌 물건(근린생활시설·상가·토지)의 세율입니다. 멸실된 입주권도 토지 취득으로 봅니다.',
    }
  }

  const heavy = heavyRate(houseCount, adjusted)
  if (heavy) {
    // 중과는 지방교육세가 0.4% 로 고정, 농특세는 8%→0.6% / 12%→1.0%
    const edu = 0.4
    const farm = big ? (heavy === 8 ? 0.6 : 1.0) : 0
    const parts = [
      { label: '취득세(중과)', pct: heavy },
      { label: '지방교육세', pct: edu },
      ...(big ? [{ label: '농어촌특별세', pct: farm }] : []),
    ]
    const ratePct = Math.round((heavy + edu + farm) * 100) / 100
    return {
      ratePct,
      amount: Math.round(price * (ratePct / 100)),
      breakdown: parts,
      note: `${adjusted ? '조정대상지역 ' : ''}${houseCount}주택 중과 세율입니다. 일시적 2주택 등 예외가 있으니 반드시 확인하세요.`,
    }
  }

  const base = houseBaseRate(price)
  const edu = Math.round(base * 0.1 * 100) / 100
  const farm = big ? 0.2 : 0
  const parts = [
    { label: '취득세', pct: base },
    { label: '지방교육세', pct: edu },
    ...(big ? [{ label: '농어촌특별세', pct: farm }] : []),
  ]
  const ratePct = Math.round((base + edu + farm) * 100) / 100
  return {
    ratePct,
    amount: Math.round(price * (ratePct / 100)),
    breakdown: parts,
    note:
      `1주택 기준입니다. 전용 ${NATIONAL_SIZE_M2}㎡ ` +
      (big ? '초과라 농어촌특별세가 붙습니다.' : '이하라 농어촌특별세가 없습니다.'),
  }
}

/**
 * 건축물대장 주용도로 주택/비주택을 가른다.
 * 광고에 "다세대"라고 적혀 있어도 대장이 근생이면 근생 세율이다 —
 * 그 차이가 초기투자금을 크게 바꾼다.
 */
export function kindFromPurpose(purpose: string | null | undefined): PropertyKind {
  if (!purpose) return 'house'
  return /근린생활|판매시설|업무시설|공장|창고|교육연구|종교|의료|숙박|위락|운동|자동차|토지/.test(
    purpose,
  )
    ? 'nonHouse'
    : 'house'
}
