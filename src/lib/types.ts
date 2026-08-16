export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }

/** /api/develops 응답 항목 */
export interface ApiDevelop {
  id: string
  name: string
  projectType: string
  rawLabel: string
  areaM2: number
  noticeSn: string | null
  bbox: [number, number, number, number]
  geometry: Geometry
}

export interface DevelopsResponse {
  total: number
  truncated: boolean
  develops: ApiDevelop[]
  _meta?: { source: string; license: string; grade: string; note: string }
}

/** 지오메트리에서 바깥 링들만 뽑는다 (구멍은 렌더/판정에서 제외) */
export function outerRings(geom: Geometry): number[][][] {
  return geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0])
}
