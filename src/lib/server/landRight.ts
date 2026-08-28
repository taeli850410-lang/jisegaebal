import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 호별 대지권(대지지분).
 *
 * 등기부등본을 떼야 하는 줄 알았는데 아니었다.
 * V-World 의 소유정보(getPossessionAttr)가 호마다 lndpclAr — 그 호에 딸린
 * 대지면적 — 을 준다. 출처도 등기부가 아니라 토지대장/대지권등록부다.
 * 무료이고 우리 키로 이미 열려 있었다. 구역 통계에서 같은 API 를 부르면서
 * 소유구분만 읽고 이 값을 버리고 있었다.
 *
 * 검증: 장위동 68-902 (월드빌, 15호)
 *   101~403호 26.87㎡(8.13평), 202·203호만 13.43㎡(4.06평)
 *   같은 지번 실거래의 신고 대지지분 8.07평 — 맞는다.
 *   (전용면적 안분 추정은 7.99~8.9평이었다. 이제 추정을 안 써도 된다.)
 *
 * 한 호에 공유자가 여럿이면 레코드가 여러 줄 온다. 호별로 접어야
 * 같은 지분을 두 번 세지 않는다 — 15호짜리가 17줄로 왔다.
 */

const CACHE_PATH = join(process.cwd(), 'data', 'land-right-cache.json')
const BASE = 'https://api.vworld.kr/ned/data/getPossessionAttr'

/** 한 지번의 호별 대지지분 — [호명, 층, 대지면적㎡] */
export type LandRights = [string, string, number][]

type CacheValue = LandRights | null
let cache: Record<string, CacheValue> | null = null
let dirty = false

function load(): Record<string, CacheValue> {
  if (cache) return cache
  try {
    cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) : {}
  } catch {
    cache = {}
  }
  return cache!
}

function flush() {
  if (!dirty || !cache) return
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache))
    dirty = false
  } catch {
    /* 서버리스 디스크는 읽기 전용일 수 있다. 그러면 메모리 캐시로만 산다. */
  }
}

interface Row {
  buldHoNm?: string
  buldFloorNm?: string
  lndpclAr?: string
}

async function fetchOne(pnu: string): Promise<CacheValue> {
  const key = process.env.VWORLD_API_KEY
  const domain = process.env.VWORLD_DOMAIN
  if (!key) return null
  const url =
    `${BASE}?key=${key}&pnu=${pnu}&format=json&numOfRows=300&pageNo=1` +
    (domain ? `&domain=${encodeURIComponent(domain)}` : '')
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    const j = JSON.parse(await r.text())
    const rows: Row[] = j?.possessions?.field ?? []
    if (!rows.length) return null

    /*
     * 호별로 접는다. 공유자가 여럿이면 같은 호가 여러 줄 오는데,
     * lndpclAr 은 그 호 전체의 대지면적이라 더하면 안 되고 하나만 쓴다.
     */
    const byHo = new Map<string, { flr: string; area: number }>()
    for (const row of rows) {
      const ho = (row.buldHoNm ?? '').trim()
      const area = Number(row.lndpclAr)
      if (!ho || !Number.isFinite(area) || area <= 0) continue
      if (!byHo.has(ho)) byHo.set(ho, { flr: (row.buldFloorNm ?? '').trim(), area })
    }
    if (!byHo.size) return null
    return [...byHo.entries()]
      .map(([ho, v]) => [ho, v.flr, Math.round(v.area * 100) / 100] as [string, string, number])
      .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
  } catch {
    return null
  }
}

/**
 * 여러 지번을 한 번에.
 * budget 은 이번 요청에서 새로 부를 최대 개수 — 캐시에 있는 건 공짜로 준다.
 */
export async function getLandRightsMany(
  pnus: string[],
  budget = 30,
): Promise<Map<string, LandRights>> {
  const store = load()
  const out = new Map<string, LandRights>()
  const todo: string[] = []

  for (const pnu of pnus) {
    if (pnu in store) {
      const v = store[pnu]
      if (v) out.set(pnu, v)
    } else {
      todo.push(pnu)
    }
  }

  const pick = todo.slice(0, budget)
  const C = 4
  for (let i = 0; i < pick.length; i += C) {
    const slice = pick.slice(i, i + C)
    const got = await Promise.all(slice.map(fetchOne))
    slice.forEach((pnu, k) => {
      // 없는 지번(단독주택 등)도 없다고 기록해 다시 안 부른다
      store[pnu] = got[k]
      dirty = true
      if (got[k]) out.set(pnu, got[k]!)
    })
    if (i + C < pick.length) await new Promise((r) => setTimeout(r, 250))
  }
  flush()
  return out
}
