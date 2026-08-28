import { resolveRightsDate } from './rightsDate.ts'

/**
 * 매물 검증.
 *
 * 우리는 매물 호가를 못 구한다. 대신 사용자가 들고 온 매물이 말이 되는지
 * 공공데이터로 따져볼 수는 있다. 그게 개수 경쟁보다 값어치 있다 —
 * 틀린 숫자 열여덟 개보다 맞는 경고 하나가 돈을 지킨다.
 *
 * 입력은 사용자가 넣는다. 우리 서버가 남의 플랫폼에 접속하지 않고,
 * 결과를 공개 목록으로 저장하지도 않는다. 계산기이지 매물 DB가 아니다.
 */

export type Level = 'danger' | 'warn' | 'ok' | 'unknown'

export interface Finding {
  code: string
  level: Level
  title: string
  detail: string
}

/** 사용자가 넣는 값 — 광고에 적힌 그대로 */
export interface ListingInput {
  /** 광고에 적힌 유형 (다세대·연립·단독·아파트 등) */
  type?: string | null
  /** 광고에 적힌 전용면적 (㎡) */
  exclusiveAr?: number | null
  /** 층 (지하는 음수) */
  floor?: number | null
  price?: number | null
}

/** 우리가 공공데이터에서 붙이는 값 */
export interface ListingFacts {
  /** 건축물대장 주용도 (건물 대표) */
  purpose?: string | null
  /**
   * 광고 면적·층으로 특정한 그 호의 정보.
   * 건물 대표용도만 보면 안 된다 — 서계동 245-11 은 대표가 공동주택인데
   * 101호만 제1종근린생활시설이었다. 분양자격이 갈리는 건 호별 용도다.
   */
  matchedUnit?: { ho: string; floor: number; area: number; purpose: string } | null
  /** 사용승인일 (YYYY-MM-DD) */
  approvalDate?: string | null
  /** 대지권등록부/추정 대지지분 (평) */
  landSharePyeong?: number | null
  landShareSource?: 'right' | 'price' | 'expos' | 'whole' | 'none'
  /** 공동주택 공시가격 (원) */
  publicPrice?: number | null
  /** 그 지번에서 확인된 호별 전용면적 목록 (㎡) */
  unitAreas?: number[]
  /** 구역 정보 */
  zoneName?: string | null
  zoneStage?: string | null
  /** 구역의 권리산정기준일 판정 */
  rightsBasis?: ReturnType<typeof resolveRightsDate> | null
}

/** 주택이 아닌 용도 — 정비사업에서 분양자격이 갈리는 지점이다 */
const NON_HOUSING = /근린생활|판매시설|업무시설|공장|창고|교육연구|종교|의료|숙박|위락|운동|자동차/

/** 주택 용도 */
const HOUSING = /공동주택|단독주택|다가구|다세대|연립|아파트|주택/

export function verifyListing(input: ListingInput, facts: ListingFacts): Finding[] {
  const out: Finding[] = []

  /* ── ⓪ 그 호의 용도 ──
     건물 전체가 공동주택이어도 한두 호가 근생인 건물이 흔하다.
     사려는 건 건물이 아니라 그 호다. */
  const u = facts.matchedUnit
  if (u) {
    if (NON_HOUSING.test(u.purpose)) {
      out.push({
        code: 'unit-not-housing',
        level: 'danger',
        title: `${u.ho}의 대장 용도가 '${u.purpose}'입니다`,
        detail: `건물 대표용도는 '${facts.purpose ?? '—'}'이지만 이 호는 주택이 아닙니다. 정비사업 분양자격·주택수 산정·대출 조건이 모두 달라집니다. 광고에 주택으로 적혀 있다면 특히 확인하세요.`,
      })
    } else {
      out.push({
        code: 'unit-housing',
        level: 'ok',
        title: `${u.ho} · 전용 ${u.area}㎡ · ${u.purpose}`,
        detail: '광고 면적·층으로 특정한 호의 대장 용도입니다.',
      })
    }
  }

  /* ── ① 건축물대장 용도 ──
     광고는 "다세대"인데 대장은 근린생활시설인 경우가 실제로 있다.
     주택이 아니면 정비사업 분양자격 판단이 완전히 달라진다. */
  if (!facts.purpose) {
    out.push({
      code: 'purpose-unknown',
      level: 'unknown',
      title: '건축물대장을 찾지 못했습니다',
      detail:
        '무허가 건물이거나 지번이 다를 수 있습니다. 건축물대장을 직접 발급받아 확인하세요.',
    })
  } else if (NON_HOUSING.test(facts.purpose)) {
    out.push({
      code: 'not-housing',
      level: 'danger',
      title: `건축물대장 용도가 '${facts.purpose}'입니다`,
      detail:
        input.type && HOUSING.test(input.type)
          ? `광고에는 '${input.type}'으로 적혀 있으나 대장은 주택이 아닙니다. 정비사업 분양자격·주택수 산정·대출 조건이 모두 달라집니다.`
          : '주택이 아닙니다. 정비사업 분양자격과 대출 조건을 반드시 확인하세요.',
    })
  } else if (!u && input.type && HOUSING.test(input.type) && HOUSING.test(facts.purpose)) {
    out.push({
      code: 'purpose-ok',
      level: 'ok',
      title: `건축물대장 용도 '${facts.purpose}'`,
      detail: '광고 유형과 대장 용도가 모두 주택입니다.',
    })
  }

  /* ── ② 권리산정기준일 이후 신축 (이른바 물딱지) ──
     기준일 뒤에 지어지거나 쪼개진 건물은 현금청산 대상이 될 수 있다.
     기준일을 모르는 구역에서는 판단하지 않는다 — 모르면서 안전하다고 하면 안 된다. */
  const rights = facts.rightsBasis
  if (facts.approvalDate && rights) {
    if (rights.basis === 'notice' && rights.date) {
      if (facts.approvalDate > rights.date) {
        out.push({
          code: 'post-rights-date',
          level: 'danger',
          title: '권리산정기준일 이후에 사용승인된 건물입니다',
          detail: `사용승인 ${facts.approvalDate.replace(/-/g, '.')} > 기준일 ${rights.date.replace(/-/g, '.')}. 분양자격이 없어 현금청산될 수 있습니다. 조합·구청에 반드시 확인하세요.`,
        })
      } else {
        out.push({
          code: 'pre-rights-date',
          level: 'ok',
          title: '권리산정기준일 이전 건물입니다',
          detail: `사용승인 ${facts.approvalDate.replace(/-/g, '.')} ≤ 기준일 ${rights.date.replace(/-/g, '.')}. 다만 지분 쪼개기·용도 변경 이력은 별도로 확인해야 합니다.`,
        })
      }
    } else {
      out.push({
        code: 'rights-date-unknown',
        level: 'warn',
        title: '권리산정기준일을 확정할 수 없습니다',
        detail:
          rights.basis === 'candidate'
            ? '공모로 선정된 사업이라 후보지 선정일이 기준일입니다. 서울시 공모 공고문에서 확인하세요.'
            : '이 구역은 기준일 정보가 없습니다. 자치구 고시·공고 원문을 확인하세요.',
      })
    }
  }

  /* ── ③ 전용면적 대조 ──
     광고 면적이 대장에 없는 값이면 다른 호이거나 잘못 적힌 것이다. */
  const areas = facts.unitAreas ?? []
  if (input.exclusiveAr && areas.length) {
    const near = areas.reduce((a, b) =>
      Math.abs(b - input.exclusiveAr!) < Math.abs(a - input.exclusiveAr!) ? b : a,
    )
    const gap = Math.abs(near - input.exclusiveAr)
    if (gap > 1) {
      out.push({
        code: 'area-mismatch',
        level: 'warn',
        title: '광고 전용면적이 대장 값과 다릅니다',
        detail: `광고 ${input.exclusiveAr}㎡ · 이 지번에서 가장 가까운 대장 값 ${near}㎡ (차이 ${gap.toFixed(2)}㎡). 다른 호이거나 공급면적을 전용면적으로 적었을 수 있습니다.`,
      })
    } else {
      out.push({
        code: 'area-ok',
        level: 'ok',
        title: `전용면적 ${input.exclusiveAr}㎡ 확인`,
        detail: `대장 값 ${near}㎡ 와 일치합니다.`,
      })
    }
  }

  /* ── ④ 공시가격 등재 여부 ──
     공시가격이 없으면 감정평가·대출·세금 계산의 기준이 하나 빈다. */
  if (facts.publicPrice) {
    out.push({
      code: 'public-price-ok',
      level: 'ok',
      title: `공동주택 공시가격 ${Math.round(facts.publicPrice / 1_000_000) / 100}억`,
      detail: '공시가격이 등재되어 있습니다.',
    })
  } else if (facts.purpose && HOUSING.test(facts.purpose)) {
    out.push({
      code: 'no-public-price',
      level: 'warn',
      title: '공동주택 공시가격이 없습니다',
      detail:
        '단독·다가구이거나 아직 미등재일 수 있습니다. 감정평가·취득세·대출 한도 산정의 기준이 되므로 확인이 필요합니다.',
    })
  }

  /* ── ⑤ 대지지분 ──
     정비사업에서 권리가액은 대지지분이 좌우한다. */
  if (facts.landSharePyeong) {
    const src =
      facts.landShareSource === 'right'
        ? '대지권등록부'
        : facts.landShareSource === 'whole'
          ? '집합건물이 아니어서 필지 전체'
          : '전용면적 안분 추정'
    out.push({
      code: 'land-share',
      level: 'ok',
      title: `대지지분 ${facts.landSharePyeong}평`,
      detail: `근거: ${src}. 권리가액은 이 값이 좌우합니다.`,
    })
  } else {
    out.push({
      code: 'no-land-share',
      level: 'warn',
      title: '대지지분을 확인하지 못했습니다',
      detail: '등기부등본(대지권등록부)에서 직접 확인하세요. 정비사업에서 가장 중요한 값입니다.',
    })
  }

  /* ── ⑥ 반지하 ──
     같은 면적이라도 값이 크게 다르고, 침수 이력·주거 제한이 걸린다. */
  if (typeof input.floor === 'number' && input.floor < 0) {
    out.push({
      code: 'basement',
      level: 'warn',
      title: '지하(반지하) 물건입니다',
      detail:
        '같은 전용면적이라도 공시가격·시세가 크게 낮습니다. 침수 이력과 주거 용도 제한을 확인하세요.',
    })
  }

  // 위험 → 주의 → 확인 → 정상 순으로 — 먼저 봐야 할 것이 위에 온다
  const rank: Record<Level, number> = { danger: 0, warn: 1, unknown: 2, ok: 3 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

export function summarize(findings: Finding[]) {
  return {
    danger: findings.filter((f) => f.level === 'danger').length,
    warn: findings.filter((f) => f.level === 'warn').length,
    unknown: findings.filter((f) => f.level === 'unknown').length,
    ok: findings.filter((f) => f.level === 'ok').length,
  }
}

/** 한 줄 판정 */
export function verdict(findings: Finding[]): { level: Level; text: string } {
  const s = summarize(findings)
  if (s.danger) return { level: 'danger', text: `위험 ${s.danger}건 — 계약 전 확인이 필요합니다` }
  if (s.warn) return { level: 'warn', text: `주의 ${s.warn}건 — 확인해 볼 항목이 있습니다` }
  if (s.unknown) return { level: 'unknown', text: '판단할 자료가 부족합니다' }
  return { level: 'ok', text: '확인한 항목에서 문제를 찾지 못했습니다' }
}
