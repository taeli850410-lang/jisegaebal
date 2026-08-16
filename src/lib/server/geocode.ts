import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 지번 주소 → 좌표 (서버 전용, 캐시 우선).
 *
 * 실거래를 정비구역에 붙이려면 좌표가 필요한데, 국토부 응답에는 좌표가 없다.
 * 지번의 좌표는 변하지 않으므로 한 번 조회하면 계속 재사용할 수 있다.
 * 그래서 디스크 캐시를 먼저 보고, 없을 때만 카카오 API를 부른다.
 */

const CACHE_PATH = join(process.cwd(), 'data', 'jibun-cache.json')

let cache: Record<string, [number, number] | null> | null = null
let dirty = false

function load(): Record<string, [number, number] | null> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    cache = {}
  }
  return cache!
}

/** 서버리스에서는 쓰기가 사라질 수 있다. 로컬 스크립트 실행 시 축적하는 용도. */
export function persist() {
  if (!dirty || !cache) return
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache))
    dirty = false
  } catch {
    /* 읽기 전용 환경이면 무시 */
  }
}

async function callKakao(query: string): Promise<[number, number] | null> {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return null
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}`,
      { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const json = await res.json()
    const d = json.documents?.[0]
    return d ? [Number(d.x), Number(d.y)] : null
  } catch {
    return null
  }
}

/**
 * 여러 주소를 한 번에 해석한다.
 * 캐시에 없는 것만 제한된 동시성으로 조회하고, budget으로 상한을 둬
 * 한 요청이 API를 과도하게 소모하지 않게 한다.
 */
export async function geocodeMany(
  queries: string[],
  budget = 120,
): Promise<Map<string, [number, number] | null>> {
  const store = load()
  const out = new Map<string, [number, number] | null>()
  const missing: string[] = []

  for (const q of queries) {
    if (q in store) out.set(q, store[q])
    else if (!missing.includes(q)) missing.push(q)
  }

  const targets = missing.slice(0, budget)
  const CONCURRENCY = 8

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY)
    const results = await Promise.all(slice.map((q) => callKakao(q)))
    slice.forEach((q, idx) => {
      store[q] = results[idx]
      dirty = true
      out.set(q, results[idx])
    })
  }

  persist()
  return out
}

export function cacheSize(): number {
  return Object.keys(load()).length
}
