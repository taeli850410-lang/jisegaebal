/**
 * Supabase 접근 (서버 전용).
 *
 * 클라이언트 라이브러리를 넣지 않고 PostgREST 를 직접 부른다.
 * 의존성이 없어 번들이 안 늘고, 무엇보다 키가 서버 밖으로 새지 않는다 —
 * 브라우저가 Supabase 에 직접 붙는 구조로 만들면 키를 클라이언트에 실어야 하고,
 * 그러면 누구나 우리 테이블을 두드릴 수 있다.
 *
 * 그래서 여기 쓰는 건 service_role 키다. 절대 NEXT_PUBLIC_ 을 붙이지 않는다.
 * 검증은 우리 API 라우트가 한다.
 *
 * 키가 없으면 조용히 꺼진다. 그때는 매물이 브라우저에만 저장된다.
 */

const URL_ENV = 'SUPABASE_URL'
const KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY'

export function hasSupabase(): boolean {
  return !!(process.env[URL_ENV] && process.env[KEY_ENV])
}

function base(): { url: string; key: string } | null {
  const url = process.env[URL_ENV]
  const key = process.env[KEY_ENV]
  if (!url || !key) return null
  return { url: url.replace(/\/+$/, ''), key }
}

function headers(key: string, extra: Record<string, string> = {}) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

export interface SbResult<T> {
  ok: boolean
  data: T | null
  /** 화면에 그대로 띄우지 않는다 — 로그·진단용 */
  error: string | null
}

export async function sbSelect<T>(
  table: string,
  query: string,
): Promise<SbResult<T[]>> {
  const b = base()
  if (!b) return { ok: false, data: null, error: 'NO_CONFIG' }
  try {
    const r = await fetch(`${b.url}/rest/v1/${table}?${query}`, {
      headers: headers(b.key),
      cache: 'no-store',
    })
    const body = await r.text()
    if (!r.ok) return { ok: false, data: null, error: `${r.status} ${body.slice(0, 200)}` }
    return { ok: true, data: JSON.parse(body) as T[], error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : 'FETCH_FAILED' }
  }
}

export async function sbInsert<T>(table: string, row: unknown): Promise<SbResult<T[]>> {
  const b = base()
  if (!b) return { ok: false, data: null, error: 'NO_CONFIG' }
  try {
    const r = await fetch(`${b.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers(b.key, { Prefer: 'return=representation' }),
      body: JSON.stringify(row),
      cache: 'no-store',
    })
    const body = await r.text()
    if (!r.ok) return { ok: false, data: null, error: `${r.status} ${body.slice(0, 200)}` }
    return { ok: true, data: JSON.parse(body) as T[], error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : 'FETCH_FAILED' }
  }
}

export async function sbDelete(table: string, query: string): Promise<SbResult<null>> {
  const b = base()
  if (!b) return { ok: false, data: null, error: 'NO_CONFIG' }
  try {
    const r = await fetch(`${b.url}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: headers(b.key),
      cache: 'no-store',
    })
    if (!r.ok) {
      const body = await r.text()
      return { ok: false, data: null, error: `${r.status} ${body.slice(0, 200)}` }
    }
    return { ok: true, data: null, error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : 'FETCH_FAILED' }
  }
}

/**
 * 있으면 갈아끼우고 없으면 넣는다.
 *
 * 공시가격처럼 "한 번 받아 두고 계속 쓰는" 값에 쓴다. 넣기 전에 조회해서
 * 있는지 보면 왕복이 두 번이고, 그 사이에 다른 요청이 넣으면 충돌한다.
 */
export async function sbUpsert<T>(
  table: string,
  rows: unknown,
  /** 충돌 판정에 쓸 컬럼 (기본키) */
  onConflict: string,
): Promise<SbResult<T[]>> {
  const b = base()
  if (!b) return { ok: false, data: null, error: 'NO_CONFIG' }
  try {
    const r = await fetch(
      `${b.url}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: 'POST',
        headers: headers(b.key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(rows),
        cache: 'no-store',
      },
    )
    if (!r.ok) {
      const body = await r.text()
      return { ok: false, data: null, error: `${r.status} ${body.slice(0, 200)}` }
    }
    return { ok: true, data: [] as T[], error: null }
  } catch (e) {
    return { ok: false, data: null, error: e instanceof Error ? e.message : 'FETCH_FAILED' }
  }
}
