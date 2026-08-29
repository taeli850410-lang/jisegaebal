/**
 * 두 벌의 답을 맞댄다.
 *
 * 우리와 호파인더는 같은 공공데이터를 따로 구현했다. 대개 같은 답이 나오고,
 * 가끔 갈린다. 갈리는 지점이 중요하다 — 거기가 등기부를 떼어 봐야 하는 곳이다.
 *
 * 그래서 한쪽을 골라 덮어쓰지 않는다. 둘 다 보여주고 근거를 함께 적는다.
 * "실측"과 "추정"은 같은 무게가 아니고, 그 차이를 사용자가 알아야 한다.
 */

export type CrossStatus =
  /** 두 곳이 같은 값 */
  | 'agree'
  /** 두 곳이 다른 값 — 확인이 필요하다 */
  | 'differ'
  /** 우리만 안다 */
  | 'onlyOurs'
  /** 호파인더만 안다 */
  | 'onlyTheirs'
  /** 둘 다 모른다 */
  | 'neither'

export interface CrossRow {
  field: string
  label: string
  ours: string | null
  theirs: string | null
  status: CrossStatus
  /** 왜 이 값인지 — 실측인가 추정인가 */
  note?: string
}

export interface CrossInput {
  ours: {
    ho?: string | null
    purpose?: string | null
    exclusiveAr?: number | null
    publicPrice?: number | null
    landSharePyeong?: number | null
    /** 대지지분을 어떤 근거로 냈는가 (landShareOf 의 basis) */
    landShareBasis?: string | null
    /** 그 근거의 짧은 이름 */
    landShareLabel?: string | null
  }
  theirs: {
    ho?: string | null
    purpose?: string | null
    exclusiveAr?: number | null
    publicPrice?: number | null
    /** 호파인더 대지지분은 전용면적 비례 추정치다 */
    landSharePyeong?: number | null
    /** 실거래에 실려 온 대지권면적(㎡) — 추정이 아닌 등기 원본 */
    dealLandShareM2?: number | null
    dealLabel?: string | null
  } | null
}

const PYEONG = 3.3058

/**
 * 호 이름을 견줄 수 있게 다듬는다.
 *
 * 대장 전유부는 "3층301호", 호파인더는 "301" 로 준다. 같은 집인데 글자가
 * 다르다고 "서로 다릅니다"라고 하면, 진짜로 다른 경우가 묻힌다.
 * 숫자만 남기되 층 표기는 떼어 낸다 — "3층301호" → "301".
 */
function hoKey(ho: string | null | undefined): string | null {
  if (!ho) return null
  const t = ho.trim()
  // "지층01호" / "지하1층02호" 처럼 지하면 부호를 남겨 지상과 섞이지 않게 한다
  const basement = /지층|지하|^B/i.test(t)
  const body = t.replace(/^.*?([0-9]+)호$/, '$1')
  const digits = (body.match(/[0-9]+/) ?? [t.replace(/[^0-9]/g, '')])[0]
  if (!digits) return null
  return (basement ? 'B' : '') + String(Number(digits))
}
const eok = (won: number) => (won / 100_000_000).toFixed(2).replace(/[.]?0+$/, '') + '억'

function cmp(
  field: string,
  label: string,
  ours: string | null,
  theirs: string | null,
  same: boolean,
  note?: string,
): CrossRow {
  const status: CrossStatus =
    ours != null && theirs != null
      ? same
        ? 'agree'
        : 'differ'
      : ours != null
        ? 'onlyOurs'
        : theirs != null
          ? 'onlyTheirs'
          : 'neither'
  return { field, label, ours, theirs, status, note }
}

export function crossCheck({ ours, theirs }: CrossInput): CrossRow[] {
  const t = theirs
  const rows: CrossRow[] = []

  /* ① 호 특정 — 여기가 어긋나면 아래 값이 전부 다른 집 이야기가 된다 */
  rows.push(
    cmp(
      'ho',
      '호 특정',
      ours.ho ?? null,
      t?.ho ?? null,
      hoKey(ours.ho) != null && hoKey(ours.ho) === hoKey(t?.ho),
      ours.ho && t?.ho && hoKey(ours.ho) !== hoKey(t.ho)
        ? '두 곳이 다른 호를 잡았습니다. 층·전용면적을 다시 확인하세요.'
        : undefined,
    ),
  )

  /* ② 용도 — 주택인가 근생인가. 분양자격과 취득세가 여기서 갈린다. */
  const op = ours.purpose ?? null
  const tp = t?.purpose ?? null
  rows.push(
    cmp('purpose', '대장 용도', op, tp, !!op && !!tp && op === tp, '분양자격·취득세가 갈립니다'),
  )

  /* ③ 전용면적 — 0.5㎡ 안이면 같은 것으로 본다 (반올림 자릿수 차이) */
  const oa = ours.exclusiveAr ?? null
  const ta = t?.exclusiveAr ?? null
  rows.push(
    cmp(
      'area',
      '전용면적',
      oa != null ? oa + '㎡' : null,
      ta != null ? ta + '㎡' : null,
      oa != null && ta != null && Math.abs(oa - ta) <= 0.5,
    ),
  )

  /* ④ 공시가격 — 같은 원본을 보므로 갈리면 호를 잘못 잡은 것이다 */
  const opp = ours.publicPrice ?? null
  const tpp = t?.publicPrice ?? null
  rows.push(
    cmp(
      'publicPrice',
      '공시가격',
      opp ? eok(opp) : null,
      tpp ? eok(tpp) : null,
      opp != null && tpp != null && opp === tpp,
      opp == null && tpp == null
        ? '두 곳 모두 없습니다 — 근린생활시설 등 공동주택가격 대상이 아닐 수 있습니다'
        : undefined,
    ),
  )

  /*
   * ⑤ 대지지분 — 여기가 핵심이다.
   *
   * 우리 값이 대지권등록부 실측이면 호파인더 추정보다 무겁다.
   * 우리도 추정이면 둘 다 추정이라고 말한다. 어느 쪽이든 등기부가 최종이다.
   */
  const ol = ours.landSharePyeong ?? null
  const tl = t?.landSharePyeong ?? null
  /*
   * 두 값의 무게가 다르다는 걸 말해 준다.
   * 실거래 신고서의 대지권면적은 등기에서 온 값이고, 전용면적 비례는 추정이다.
   * 같은 무게로 나란히 놓으면 사용자가 어느 쪽을 믿을지 알 수 없다.
   */
  const basis = ours.landShareBasis ?? null
  const grounded = basis === 'deal' || basis === 'buildingRatio'
  const tolerance = 0.2 // 평
  rows.push(
    cmp(
      'landShare',
      '대지지분',
      ol != null ? ol + '평' : null,
      tl != null ? tl + '평' : null,
      ol != null && tl != null && Math.abs(ol - tl) <= tolerance,
      grounded
        ? `우리 값은 실거래 신고서의 대지권면적에 기댄 것이고(${ours.landShareLabel ?? basis}), ` +
          '호파인더 값은 건축물대장 대지면적을 전용면적으로 나눈 추정입니다. ' +
          '확정은 등기부 대지권비율입니다.'
        : `두 값 모두 추정입니다(우리: ${ours.landShareLabel ?? '추정'}). 확정은 등기부 대지권비율입니다.`,
    ),
  )

  /*
   * ⑥ 실거래에 실려 온 대지권면적.
   *
   * 이건 추정이 아니라 등기에서 온 원본이다. 그래서 위 두 값을 판정하는
   * 기준이 된다 — 다만 그 거래가 정말 이 호인지는 추정이라 단정하지 않는다.
   */
  const dm = t?.dealLandShareM2 ?? null
  if (dm != null) {
    const dp = Math.round((dm / PYEONG) * 100) / 100
    rows.push({
      field: 'dealLandShare',
      label: '실거래 대지권면적',
      ours: ol != null ? ol + '평' : null,
      theirs: dp + '평',
      status: ol != null && Math.abs(ol - dp) <= tolerance ? 'agree' : 'differ',
      note:
        '실거래 신고서의 대지권면적입니다 — 추정이 아닌 등기 값입니다.' +
        (t?.dealLabel ? ` (${t.dealLabel})` : '') +
        ' 다만 그 거래가 이 호인지는 추정입니다(실거래 호수는 비공개).',
    })
  }

  return rows
}

/** 한 줄 요약 — 갈린 항목이 있으면 그걸 먼저 말한다 */
export function crossVerdict(rows: CrossRow[]): {
  level: 'agree' | 'differ' | 'partial' | 'none'
  text: string
} {
  const differ = rows.filter((r) => r.status === 'differ')
  const agree = rows.filter((r) => r.status === 'agree')
  if (differ.length) {
    return {
      level: 'differ',
      text: `${differ.map((r) => r.label).join('·')} 이(가) 서로 다릅니다 — 등기부·대장 원본 확인이 필요합니다`,
    }
  }
  if (!agree.length) {
    return { level: 'none', text: '대조할 값이 없습니다' }
  }
  /*
   * 비교조차 못 한 항목이 하나라도 있으면 "모두 일치"라고 하지 않는다.
   * 대지지분을 양쪽 다 모르는 채로 "모두 일치"라고 하면, 사용자는
   * 대지지분까지 확인된 것으로 읽는다. 확인 안 된 건 안 됐다고 말한다.
   */
  const uncompared = rows.filter((r) => r.status !== 'agree' && r.status !== 'differ')
  if (uncompared.length) {
    return {
      level: 'partial',
      text:
        `${agree.length}개 항목이 일치합니다. ` +
        `${uncompared.map((r) => r.label).join('·')} 은(는) 대조하지 못했습니다`,
    }
  }
  return { level: 'agree', text: `${agree.length}개 항목이 모두 일치합니다` }
}
