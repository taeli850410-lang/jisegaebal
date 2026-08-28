'use client'

import type { Listing } from './listingModel'

/**
 * 매물 저장소.
 *
 * 지금은 브라우저에 둔다. 공용 목록을 만들려면 서버 저장소가 필요한데,
 * 그건 비용과 운영이 걸린 결정이라 우리가 임의로 정할 게 아니다.
 *
 * 대신 이 모듈의 읽기·쓰기만 서버 API 로 바꾸면 공용으로 전환된다.
 * 화면은 손댈 게 없도록 여기로 다 모아 뒀다.
 *
 * 우리가 어디서 긁어온 매물은 하나도 없다. 전부 사람이 넣은 것이다.
 */

const KEY = 'jsg.listings.v1'

function read(): Listing[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Listing[]) : []
  } catch {
    return []
  }
}

function write(xs: Listing[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(xs))
    window.dispatchEvent(new CustomEvent('jsg:store', { detail: KEY }))
  } catch {
    /* 시크릿 모드 등 — 저장 실패는 조용히 넘긴다 */
  }
}

export function getListings(zoneId?: string | null): Listing[] {
  const xs = read()
  return zoneId ? xs.filter((l) => l.zoneId === zoneId) : xs
}

export function saveListing(l: Omit<Listing, 'id' | 'savedAt'>, now: number): Listing {
  const entry: Listing = { ...l, id: `${now}-${Math.round(now % 100000)}`, savedAt: now }
  write([entry, ...read()].slice(0, 500))
  return entry
}

export function removeListing(id: string) {
  write(read().filter((l) => l.id !== id))
}

export function clearListings() {
  write([])
}

/* ── 공유 ──────────────────────────────────────────────
   저장소가 브라우저라 다른 사람에게 보이지 않는다.
   그래서 매물을 주소에 실어 링크로 넘긴다 — 중개사가 손님에게 보낼 때 쓴다.
   서버를 거치지 않으므로 우리 쪽에 남는 기록이 없다. */

/** 링크에 실을 최소 항목 — 나머지는 받는 쪽에서 공공데이터로 다시 붙인다 */
const SHARE_FIELDS = [
  'gu',
  'dong',
  'jibun',
  'type',
  'price',
  'exclusiveAr',
  'floor',
  'brokerOffice',
  'brokerRegNo',
  'brokerTel',
] as const

export function encodeListing(l: Listing): string {
  const obj: Record<string, unknown> = {}
  for (const f of SHARE_FIELDS) {
    const v = l[f]
    if (v !== undefined && v !== null && v !== '') obj[f] = v
  }
  // base64url — 주소에 그대로 들어가고 사람이 실수로 고치기 어렵다
  const json = JSON.stringify(obj)
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : json
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeListing(s: string | null): Partial<Listing> | null {
  if (!s) return null
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(escape(atob(b64)))
    const o = JSON.parse(json)
    return o && typeof o === 'object' ? (o as Partial<Listing>) : null
  } catch {
    return null
  }
}
