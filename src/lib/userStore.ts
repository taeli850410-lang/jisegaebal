'use client'

/**
 * 관심 구역 · 조회 기록 로컬 저장소.
 *
 * 계정 기능이 아직 없으므로 브라우저에 보관한다.
 * 로그인을 붙이면 이 모듈의 read/write만 서버 API로 바꾸면 된다.
 */

const FAV_KEY = 'jsg.favorites.v1'
const VIEW_KEY = 'jsg.views.v1'

export interface FavoriteEntry {
  id: string
  addedAt: number
}

export interface ViewEntry {
  id: string
  count: number
  lastAt: number
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    // 같은 탭의 다른 컴포넌트도 갱신되도록 알린다
    window.dispatchEvent(new CustomEvent('jsg:store', { detail: key }))
  } catch {
    /* 저장 실패는 무시 (시크릿 모드 등) */
  }
}

/* ── 관심 구역 ── */

export function getFavorites(): FavoriteEntry[] {
  return read<FavoriteEntry[]>(FAV_KEY, [])
}

export function isFavorite(id: string): boolean {
  return getFavorites().some((f) => f.id === id)
}

export function toggleFavorite(id: string): boolean {
  const list = getFavorites()
  const idx = list.findIndex((f) => f.id === id)
  if (idx >= 0) {
    list.splice(idx, 1)
    write(FAV_KEY, list)
    return false
  }
  list.push({ id, addedAt: Date.now() })
  write(FAV_KEY, list)
  return true
}

/* ── 조회 기록 ── */

export function recordView(id: string) {
  const list = read<ViewEntry[]>(VIEW_KEY, [])
  const hit = list.find((v) => v.id === id)
  if (hit) {
    hit.count++
    hit.lastAt = Date.now()
  } else {
    list.push({ id, count: 1, lastAt: Date.now() })
  }
  // 무한정 쌓이지 않도록 최근 300개만 유지
  const trimmed = list.sort((a, b) => b.lastAt - a.lastAt).slice(0, 300)
  write(VIEW_KEY, trimmed)
}

export function getViews(): ViewEntry[] {
  return read<ViewEntry[]>(VIEW_KEY, [])
}

/** 저장소 변경 구독 (같은 탭 + 다른 탭 모두) */
export function subscribeStore(cb: () => void): () => void {
  const onCustom = () => cb()
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAV_KEY || e.key === VIEW_KEY) cb()
  }
  window.addEventListener('jsg:store', onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('jsg:store', onCustom)
    window.removeEventListener('storage', onStorage)
  }
}
