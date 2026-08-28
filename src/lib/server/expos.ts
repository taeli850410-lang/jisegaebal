import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 집합건축물대장 전유부 — 호별 전용면적.
 *
 * 왜 필요한가
 *   대지지분을 안분하려면 그 지번의 호별 전용면적이 있어야 한다.
 *   지금까지는 공동주택 공시가격이 호별 면적을 함께 주는 걸 이용했는데,
 *   공시가격이 있는 지번은 전체의 일부다 (장위15구역 498필지 중 49).
 *   전유부는 공시가격이 없는 다세대·연립까지 덮는다.
 *
 * 대지권은 여기 없다
 *   전유부가 주는 건 전용면적뿐이고 대지권(대지지분)은 등기부 대지권등록부
 *   소관이라 공개 API 가 없다. 그래서 안분 추정을 계속 쓴다 —
 *   장위동 68-902 에서 추정 7.99~8.9평, 같은 지번 실거래의 실제 지분 8.07평.
 *
 * 건축물대장은 거의 안 바뀌므로 지번 단위로 디스크에 캐시한다.
 */

const CACHE_PATH = join(process.cwd(), 'data', 'expos-cache.json')
const BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo'

/** 한 지번의 호별 전용면적 — [호명, 층, 전용면적㎡] */
export type ExposUnits = [string, number, number][]

type CacheValue = ExposUnits | null
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

/** 배치가 아니라 요청 중에도 쌓이므로, 실제로 바뀐 때만 쓴다 */
export function flushExpos() {
  if (!dirty || !cache) return
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache))
    dirty = false
  } catch {
    /* 서버리스는 디스크가 읽기 전용이다. 그러면 메모리 캐시로만 산다. */
  }
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return m ? m[1].trim() : undefined
}

/**
 * PNU → 건축HUB 파라미터.
 * 법정동코드(10) = 시군구(5) + 법정동(5), 그 뒤 산여부(1) + 본번(4) + 부번(4).
 */
export function pnuToParams(pnu: string) {
  if (pnu.length < 19) return null
  return {
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    bun: pnu.slice(11, 15),
    ji: pnu.slice(15, 19),
  }
}

async function fetchOne(pnu: string): Promise<CacheValue> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY
  const p = pnuToParams(pnu)
  if (!key || !p) return null

  const url =
    `${BASE}?serviceKey=${key}&sigunguCd=${p.sigunguCd}&bjdongCd=${p.bjdongCd}` +
    `&bun=${p.bun}&ji=${p.ji}&numOfRows=500&pageNo=1`
  try {
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) return null
    const xml = await r.text()
    if ((tag(xml, 'resultCode') ?? '00') !== '00') return null

    /*
     * 한 호에 여러 줄이 온다 — 전유 1줄 + 공용 여러 줄.
     * 대지지분 안분에 쓰는 건 전유면적이므로 전유만 골라 호별로 더한다.
     * (전유가 두 줄로 쪼개져 오는 건물이 있어 합산한다)
     */
    const byHo = new Map<string, { flr: number; area: number }>()
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const it = m[1]
      if (tag(it, 'exposPubuseGbCdNm') !== '전유') continue
      const ho = tag(it, 'hoNm') ?? ''
      if (!ho) continue
      const area = Number(tag(it, 'area') ?? 0)
      if (!Number.isFinite(area) || area <= 0) continue
      // 지하는 층수를 음수로 바꿔 둔다 — 반지하는 값이 크게 다르다
      const raw = Number(tag(it, 'flrNo') ?? 0)
      const flr = tag(it, 'flrGbCdNm') === '지하' ? -Math.abs(raw) : raw
      const cur = byHo.get(ho)
      if (cur) cur.area += area
      else byHo.set(ho, { flr, area })
    }
    if (!byHo.size) return null
    return [...byHo.entries()]
      .map(([ho, v]) => [ho, v.flr, Math.round(v.area * 100) / 100] as [string, number, number])
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
  } catch {
    return null
  }
}

/**
 * 여러 지번을 한 번에.
 *
 * budget 은 "이번 요청에서 새로 부를 최대 개수"다. 캐시에 있는 건 공짜로 주고,
 * 없는 건 예산만큼만 채운다 — 화면 한 번 여는 데 수백 콜을 쓸 수는 없다.
 * 실패를 캐시하지 않는다. 빈 값을 굳혀 두면 키를 고쳐도 계속 비어 보인다.
 */
export async function getExposMany(
  pnus: string[],
  budget = 30,
): Promise<Map<string, ExposUnits>> {
  const store = load()
  const out = new Map<string, ExposUnits>()
  const todo: string[] = []

  for (const pnu of pnus) {
    if (pnu in store) {
      const v = store[pnu]
      if (v) out.set(pnu, v)
    } else {
      todo.push(pnu)
    }
  }

  // 초당 한도가 있어 조금씩 나눠 부른다
  const pick = todo.slice(0, budget)
  const C = 4
  for (let i = 0; i < pick.length; i += C) {
    const slice = pick.slice(i, i + C)
    const got = await Promise.all(slice.map(fetchOne))
    slice.forEach((pnu, k) => {
      const v = got[k]
      if (v) {
        store[pnu] = v
        dirty = true
        out.set(pnu, v)
      } else {
        // 없는 지번(단독주택 등)은 없다고 기록해 다시 안 부른다.
        // 호출 자체가 실패한 경우와 구분이 안 되는 건 감수한다 —
        // 잘못 굳으면 캐시 파일을 지우고 다시 채우면 된다.
        store[pnu] = null
        dirty = true
      }
    })
    if (i + C < pick.length) await new Promise((r) => setTimeout(r, 250))
  }
  flushExpos()
  return out
}
