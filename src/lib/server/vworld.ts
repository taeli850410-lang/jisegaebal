/**
 * V-World 연속지적도 — 진짜 필지 경계.
 *
 * 그동안 필지는 구역 경계 안을 격자로 채운 목업이었다. 국토부 NSDI 오픈API
 * (1611000/nsdi/…)는 폐기되어 NO_OPENAPI_SERVICE_ERROR 를 돌려주고, 그 서비스들은
 * V-World 로 이관됐다. 승인된 키로 WFS 를 부르면 bbox 한 번에 필지 폴리곤과
 * PNU·지번·공시지가가 함께 온다.
 *
 * 주의: V-World 키는 도메인 잠금이라 domain 파라미터가 없으면 INCORRECT_KEY 가 난다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_PATH = join(process.cwd(), 'data', 'parcel-cache.json')
const LAYER = 'lp_pa_cbnd_bubun'
const MAX_FEATURES = 1000

export interface VParcel {
  pnu: string
  jibun: string
  /** 개별공시지가 (원/㎡) — 연속지적도가 함께 준다 */
  jiga: number | null
  ring: [number, number][]
  /* 건축물대장·공시가격 색인은 코드가 아니라 이름으로 키를 잡는다 */
  gu: string | null
  dong: string | null
}

let cache: Record<string, VParcel[]> | null = null

function load(): Record<string, VParcel[]> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'))
  } catch {
    cache = {}
  }
  return cache!
}

function persist() {
  try {
    mkdirSync(join(process.cwd(), 'data'), { recursive: true })
    writeFileSync(CACHE_PATH, JSON.stringify(cache))
  } catch {
    /* 서버리스는 읽기 전용 — 메모리 캐시만 유지 */
  }
}

export function hasVWorld(): boolean {
  return !!process.env.VWORLD_API_KEY
}

/** MultiPolygon/Polygon 을 바깥 링들로 편다 */
function ringsOf(geom: {
  type: string
  coordinates: number[][][] | number[][][][]
}): [number, number][][] {
  if (geom.type === 'Polygon') return [(geom.coordinates as number[][][])[0] as [number, number][]]
  if (geom.type === 'MultiPolygon')
    return (geom.coordinates as number[][][][]).map((p) => p[0] as [number, number][])
  return []
}

/**
 * bbox 안 필지.
 *
 * cacheKey 를 주면 디스크에 남겨 다음 호출부터는 V-World 를 부르지 않는다.
 * (구역 상세처럼 같은 범위를 반복해서 보는 화면이 대부분이다)
 */
export async function fetchParcels(
  bbox: [number, number, number, number],
  cacheKey?: string,
): Promise<VParcel[] | null> {
  const key = process.env.VWORLD_API_KEY
  if (!key) return null

  if (cacheKey) {
    const store = load()
    if (cacheKey in store) return store[cacheKey]
  }

  const domain = process.env.VWORLD_DOMAIN ?? 'https://jisegaebal.vercel.app'
  const url =
    `https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature&VERSION=1.1.0` +
    `&TYPENAME=${LAYER}&SRSNAME=EPSG:4326&OUTPUT=application/json` +
    `&MAXFEATURES=${MAX_FEATURES}&BBOX=${bbox.join(',')}` +
    `&key=${key}&domain=${encodeURIComponent(domain)}`

  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const text = await res.text()
    // 오류는 XML 로 온다 (JSON 을 요청해도)
    if (!text.trimStart().startsWith('{')) return null

    const json = JSON.parse(text) as {
      features?: {
        geometry: { type: string; coordinates: number[][][] | number[][][][] }
        properties: Record<string, string>
      }[]
    }

    const out: VParcel[] = []
    for (const f of json.features ?? []) {
      const p = f.properties ?? {}
      if (!p.pnu) continue
      for (const ring of ringsOf(f.geometry)) {
        if (ring.length < 4) continue
        const jiga = Number(p.jiga)
        out.push({
          pnu: p.pnu,
          // "751-13 대" 처럼 지목이 붙어 온다
          jibun: (p.jibun ?? '').trim(),
          jiga: Number.isFinite(jiga) && jiga > 0 ? jiga : null,
          gu: p.sig_nm ?? null,
          dong: p.emd_nm ?? null,
          ring,
        })
      }
    }

    if (cacheKey) {
      load()[cacheKey] = out
      persist()
    }
    return out
  } catch {
    return null
  }
}

/** 링 면적(㎡) — 위도 37도 기준 등적 근사. 과소필지 판정에 쓴다. */
export function ringAreaM2(ring: [number, number][]): number {
  if (ring.length < 4) return 0
  const latRad = (ring[0][1] * Math.PI) / 180
  const mPerLng = 111_320 * Math.cos(latRad)
  const mPerLat = 110_574
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * mPerLng
    const yi = ring[i][1] * mPerLat
    const xj = ring[j][0] * mPerLng
    const yj = ring[j][1] * mPerLat
    s += xj * yi - xi * yj
  }
  return Math.abs(s / 2)
}
