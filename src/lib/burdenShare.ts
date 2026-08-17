'use client'

/**
 * 분담금 시뮬레이터 상태의 저장·공유.
 *
 * 계산은 순전히 입력값의 함수라 서버에 아무것도 둘 필요가 없다.
 * 입력을 통째로 URL 에 실으면 링크 하나가 곧 저장본이 된다 —
 * 계정도, 데이터베이스도, 만료도 없다.
 *
 * 이름 붙여 두는 쪽은 브라우저에 남긴다. 여러 조건을 나란히 놓고 비교하는 건
 * 혼자 쓰는 일이라 굳이 서버로 보낼 이유가 없다.
 */

const SAVE_KEY = 'jsg.burden.v1'

/** 시뮬레이터가 들고 있는 입력 전부 */
export interface BurdenState {
  landShare: number
  appraisalRate: number
  purchasePrice: number
  bijul: number
  memberPpp: number
  targetPyeong: number
  taxRate: number
  financeCost: number
  otherCosts: number
  expectedPpp: number
  /** 감정가를 직접 적었으면 그 값, 추정치를 쓰면 null */
  manualAppraisal: number | null
}

/**
 * 필드 순서 — 이 배열이 URL 포맷의 계약이다.
 *
 * 뒤에 덧붙이는 건 안전하다(옛 링크는 그 자리가 비고 기본값이 들어간다).
 * 중간에 끼워 넣거나 순서를 바꾸면 이미 공유된 링크가 다른 값을 가리킨다.
 */
const FIELDS = [
  'landShare',
  'appraisalRate',
  'purchasePrice',
  'bijul',
  'memberPpp',
  'targetPyeong',
  'taxRate',
  'financeCost',
  'otherCosts',
  'expectedPpp',
  'manualAppraisal',
] as const satisfies readonly (keyof BurdenState)[]

/**
 * 금액은 원 단위라 자릿수가 길다. 만원 단위로 줄여 URL 을 짧게 만든다.
 * 시뮬레이터 입력 자체가 만원 미만을 다루지 않으므로 잃는 정보가 없다.
 */
const IN_MAN = new Set<keyof BurdenState>([
  'purchasePrice',
  'memberPpp',
  'financeCost',
  'otherCosts',
  'expectedPpp',
  'manualAppraisal',
])

export function encodeBurden(s: BurdenState): string {
  return FIELDS.map((f) => {
    const v = s[f]
    if (v === null) return ''
    return String(IN_MAN.has(f) ? Math.round(v / 10_000) : v)
  }).join('-')
}

/** 링크가 깨졌거나 옛 포맷이면 읽힌 것만 돌려준다 — 통째로 버리지 않는다 */
export function decodeBurden(raw: string | null): Partial<BurdenState> | null {
  if (!raw) return null
  const parts = raw.split('-')
  const out: Partial<BurdenState> = {}
  FIELDS.forEach((f, i) => {
    const p = parts[i]
    if (p === undefined || p === '') return
    const n = Number(p)
    if (!Number.isFinite(n)) return
    out[f] = (IN_MAN.has(f) ? n * 10_000 : n) as never
  })
  return Object.keys(out).length ? out : null
}

/** 지금 화면을 그대로 여는 주소 */
export function shareUrl(zoneId: string, s: BurdenState): string {
  const u = new URL(window.location.href)
  u.search = ''
  u.hash = ''
  u.searchParams.set('zone', zoneId)
  u.searchParams.set('sim', encodeBurden(s))
  return u.toString()
}

/* ── 이름 붙여 저장 (브라우저) ── */

export interface SavedBurden {
  id: string
  name: string
  zoneId: string
  zoneName: string
  state: BurdenState
  savedAt: number
}

function readAll(): SavedBurden[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(SAVE_KEY)
    return raw ? (JSON.parse(raw) as SavedBurden[]) : []
  } catch {
    return []
  }
}

function writeAll(list: SavedBurden[]) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(list))
    window.dispatchEvent(new CustomEvent('jsg:store', { detail: SAVE_KEY }))
  } catch {
    /* 시크릿 모드 등 — 저장 실패는 조용히 넘긴다 */
  }
}

/** 한 구역에 저장된 것만 (다른 구역 것까지 섞이면 비교가 안 된다) */
export function getSaved(zoneId: string): SavedBurden[] {
  return readAll()
    .filter((s) => s.zoneId === zoneId)
    .sort((a, b) => b.savedAt - a.savedAt)
}

export function saveBurden(
  zoneId: string,
  zoneName: string,
  name: string,
  state: BurdenState,
  now: number,
): SavedBurden {
  const entry: SavedBurden = {
    // Date.now 를 인자로 받는다 — 저장 시점은 호출부가 정한다
    id: `${zoneId}:${now}`,
    name: name.trim() || '이름 없음',
    zoneId,
    zoneName,
    state,
    savedAt: now,
  }
  // 한 구역당 12개까지. 그 이상은 비교가 아니라 쌓아두기다.
  const rest = readAll().filter((s) => s.zoneId !== zoneId)
  const mine = [entry, ...getSaved(zoneId)].slice(0, 12)
  writeAll([...rest, ...mine])
  return entry
}

export function removeBurden(id: string) {
  writeAll(readAll().filter((s) => s.id !== id))
}
