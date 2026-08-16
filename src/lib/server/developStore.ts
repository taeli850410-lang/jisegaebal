import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 서울 정비구역 저장소 (서버 전용)
 *
 * 실제 서비스에서는 PostGIS + ST_Intersects 로 대체된다. 지금은 변환된 GeoJSON을
 * 메모리에 올려 bbox 선형 스캔한다. 2,300여 건 규모에서는 충분히 빠르다.
 *
 * 원본: 서울 열린데이터광장 「서울시 의제처리구역 위치정보」(UPIS_C_UQ181)
 *       공공누리 1유형(출처표시) · EPSG:5174 → WGS84 변환
 */

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

export interface StoredDevelop {
  id: string
  name: string
  projectType: string
  rawLabel: string
  classCode: string | null
  areaM2: number
  noticeSn: string | null
  sigungu: string | null
  bbox: [number, number, number, number]
  geometry: Geometry
}

let cache: StoredDevelop[] | null = null

export function getAllDevelops(): StoredDevelop[] {
  if (cache) return cache
  try {
    const raw = readFileSync(join(process.cwd(), 'data', 'develops.seoul.json'), 'utf-8')
    cache = JSON.parse(raw) as StoredDevelop[]
  } catch {
    // 변환 스크립트를 아직 돌리지 않은 경우
    cache = []
  }
  return cache
}

function intersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
}

/**
 * 거리 기반 링 단순화.
 * 정식 Douglas-Peucker보다 거칠지만, 축소된 화면에서 폴리곤 수천 개를 그릴 때
 * 페이로드를 크게 줄이면서 형태는 알아볼 수 있게 유지한다.
 */
function simplifyRing(ring: number[][], tol: number): number[][] {
  if (tol <= 0 || ring.length <= 8) return ring
  const out: number[][] = [ring[0]]
  for (let i = 1; i < ring.length - 1; i++) {
    const last = out[out.length - 1]
    const dx = ring[i][0] - last[0]
    const dy = ring[i][1] - last[1]
    if (dx * dx + dy * dy >= tol * tol) out.push(ring[i])
  }
  out.push(ring[ring.length - 1])
  // 폴리곤이 무너지면 원본을 쓴다
  return out.length >= 4 ? out : ring
}

function simplifyGeometry(geom: Geometry, tol: number): Geometry {
  if (tol <= 0) return geom
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map((r) => simplifyRing(r, tol)) }
  }
  return {
    type: 'MultiPolygon',
    coordinates: geom.coordinates.map((p) => p.map((r) => simplifyRing(r, tol))),
  }
}

/**
 * 카카오 지도 레벨(1=최대확대 … 14)에 따른 단순화 강도(도 단위).
 * 경도 0.0001도 ≈ 9m. 축소될수록 화면상 1px이 담는 실거리가 커지므로
 * 그만큼 과감히 점을 버려도 형태 차이가 눈에 띄지 않는다.
 */
function toleranceForLevel(level: number): number {
  if (level <= 2) return 0
  if (level === 3) return 0.00003
  if (level <= 5) return 0.00010
  if (level <= 7) return 0.00025
  if (level <= 9) return 0.00060
  return 0.00150
}

/** 레벨별 최대 반환 개수 — 축소될수록 작은 구역은 어차피 점으로 보인다 */
function limitForLevel(level: number): number {
  if (level <= 5) return 900
  if (level <= 7) return 600
  return 400
}

export interface DevelopQuery {
  bbox: [number, number, number, number]
  level: number
  projectTypes?: string[]
  limit?: number
}

export function queryDevelops({ bbox, level, projectTypes, limit }: DevelopQuery) {
  const cap = limit ?? limitForLevel(level)
  const all = getAllDevelops()
  const typeFilter = projectTypes?.length ? new Set(projectTypes) : null

  let hits = all.filter(
    (d) => intersects(d.bbox, bbox) && (!typeFilter || typeFilter.has(d.projectType)),
  )

  const total = hits.length
  // 화면에 다 못 담을 때는 큰 구역부터 — 작은 구역은 어차피 보이지 않는다
  let truncated = false
  if (hits.length > cap) {
    hits = [...hits].sort((a, b) => b.areaM2 - a.areaM2).slice(0, cap)
    truncated = true
  }

  const tol = toleranceForLevel(level)

  return {
    total,
    truncated,
    develops: hits.map((d) => ({
      id: d.id,
      name: d.name,
      projectType: d.projectType,
      rawLabel: d.rawLabel,
      areaM2: d.areaM2,
      noticeSn: d.noticeSn,
      bbox: d.bbox,
      geometry: simplifyGeometry(d.geometry, tol),
    })),
  }
}
