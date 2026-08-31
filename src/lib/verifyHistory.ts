'use client'

/**
 * 검증 기록 — 내 브라우저에만 남는다.
 *
 * 왜 서버가 아닌가
 *   검증한 매물을 서버 DB 에 쌓기 시작하면, 남의 플랫폼에서 본 매물을
 *   우리 데이터베이스로 옮겨 적는 일이 된다. 한 건씩 손으로 해도
 *   반복되면 데이터베이스제작자 권리(저작권법 제93조)와 부딪힌다.
 *
 *   내가 검토한 것을 내 브라우저에 적어 두는 건 메모지다. 남에게 안 보이고,
 *   우리 서버에 남지 않고, 지우면 사라진다. 그 선을 코드로 지킨다.
 *
 * 그래서 여기에는 서버로 보내는 경로가 아예 없다. 실수로도 못 넘어가게.
 */

export interface VerifyNote {
  id: string
  at: number
  gu: string
  dong: string
  jibun: string
  floor: number | null
  exclusiveAr: number | null
  /** 호가 (원) — 남의 값이라 내 브라우저 밖으로 나가지 않는다 */
  price: number | null
  /* 우리가 공공데이터로 낸 값 */
  ho: string | null
  purpose: string | null
  publicPrice: number | null
  landSharePyeong: number | null
  landShareLabel: string | null
  verdict: string | null
  verdictLevel: string | null
  /** 호파인더와 갈린 항목 */
  crossDiffer: string[]
}

const KEY = 'jsg.verify.notes.v1'
const LIMIT = 100

export function readNotes(): VerifyNote[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as VerifyNote[]) : []
  } catch {
    return []
  }
}

function write(xs: VerifyNote[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(xs.slice(0, LIMIT)))
  } catch {
    /* 시크릿 모드 등 — 저장 실패는 조용히 넘긴다 */
  }
}

/** 같은 지번·층·면적은 덮어쓴다 — 같은 물건을 두 번 볼 때 줄이 늘지 않게 */
export function saveNote(n: Omit<VerifyNote, 'id' | 'at'>, now: number): VerifyNote[] {
  const key = (x: { gu: string; dong: string; jibun: string; floor: number | null; exclusiveAr: number | null }) =>
    [x.gu, x.dong, x.jibun, x.floor ?? '', x.exclusiveAr ?? ''].join('|')
  const entry: VerifyNote = { ...n, id: String(now), at: now }
  const rest = readNotes().filter((x) => key(x) !== key(entry))
  const next = [entry, ...rest]
  write(next)
  return next
}

export function removeNote(id: string): VerifyNote[] {
  const next = readNotes().filter((x) => x.id !== id)
  write(next)
  return next
}

export function clearNotes(): VerifyNote[] {
  write([])
  return []
}
