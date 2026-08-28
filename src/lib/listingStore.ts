'use client'

import type { Listing } from './listingModel'

/**
 * 매물 저장소.
 *
 * 서버(Supabase)가 켜져 있으면 거기에 두고 모두가 본다.
 * 안 켜져 있으면 브라우저에 둔다 — 넣은 사람에게만 보인다.
 *
 * 어느 쪽인지 감추지 않는다. 화면이 `mode` 를 받아 그대로 알린다.
 * "저장했습니다"라고만 하고 사실은 그 브라우저에만 있으면, 중개사는
 * 손님이 못 본다는 걸 나중에야 알게 된다.
 *
 * 우리가 어디서 긁어온 매물은 하나도 없다. 전부 사람이 넣은 것이다.
 */

const KEY = 'jsg.listings.v1'

export type StoreMode = 'server' | 'local'

/* ── 브라우저 저장 ── */

function readLocal(): Listing[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Listing[]) : []
  } catch {
    return []
  }
}

function writeLocal(xs: Listing[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(xs))
    window.dispatchEvent(new CustomEvent('jsg:store', { detail: KEY }))
  } catch {
    /* 시크릿 모드 등 — 저장 실패는 조용히 넘긴다 */
  }
}

/* ── 읽기 ── */

export interface LoadResult {
  items: Listing[]
  mode: StoreMode
}

export async function loadListings(zoneId?: string | null): Promise<LoadResult> {
  try {
    const qs = zoneId ? `?zoneId=${encodeURIComponent(zoneId)}` : ''
    const r = await fetch(`/api/listings${qs}`, { cache: 'no-store' })
    if (r.ok) {
      const j = await r.json()
      return { items: (j.items ?? []) as Listing[], mode: 'server' }
    }
    // 501 = 저장소 미설정, 502 = 저장소 오류. 둘 다 브라우저로 되돌아간다.
  } catch {
    /* 네트워크가 끊겨도 화면은 살아야 한다 */
  }
  const xs = readLocal()
  return { items: zoneId ? xs.filter((l) => l.zoneId === zoneId) : xs, mode: 'local' }
}

/* ── 쓰기 ── */

export interface SaveResult {
  item: Listing
  mode: StoreMode
  /** 공개 목록에 올라갔는가 — 중개사 정보가 갖춰졌는가 */
  published: boolean
}

export async function saveListing(
  l: Omit<Listing, 'id' | 'savedAt'>,
  now: number,
): Promise<SaveResult> {
  try {
    const r = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(l),
    })
    if (r.ok) {
      const j = await r.json()
      return { item: j.item as Listing, mode: 'server', published: !!j.published }
    }
  } catch {
    /* 아래 브라우저 저장으로 */
  }
  const entry: Listing = { ...l, id: `${now}-${Math.round(now % 100000)}`, savedAt: now }
  writeLocal([entry, ...readLocal()].slice(0, 500))
  return { item: entry, mode: 'local', published: false }
}

export async function removeListing(id: string): Promise<void> {
  try {
    const r = await fetch(`/api/listings?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (r.ok) return
  } catch {
    /* 아래 브라우저에서 지운다 */
  }
  writeLocal(readLocal().filter((l) => l.id !== id))
}

/* ── 공유 ──────────────────────────────────────────────
   브라우저에만 있는 매물은 남에게 안 보인다. 그래서 주소에 실어 링크로 넘긴다.
   서버를 거치지 않으므로 우리 쪽에 남는 기록이 없다. */

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
  const json = JSON.stringify(obj)
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : json
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeListing(s: string | null): Partial<Listing> | null {
  if (!s) return null
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    const o = JSON.parse(decodeURIComponent(escape(atob(b64))))
    return o && typeof o === 'object' ? (o as Partial<Listing>) : null
  } catch {
    return null
  }
}
