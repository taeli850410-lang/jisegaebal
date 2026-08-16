import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RAW_STAGE_TO_CANONICAL } from '@/lib/taxonomy'

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

  /* ── scripts/enrich-develops.mjs 로 채워지는 항목 ── */
  /** 중심좌표 역지오코딩으로 얻은 자치구 (SIGNGU_SE는 대부분 '11000'이라 못 쓴다) */
  dong?: string
  /** 고시 일련번호에서 뽑은 고시일 (YYYY-MM-DD) */
  noticeDate?: string | null
  center?: [number, number]

  /* ── 정비몽땅 사업개요에서 오는 제원 (scripts/merge-summary.mjs) ── */
  summary?: ZoneSummary

  /* ── 정비몽땅 매칭으로 채워지는 항목 (미매칭 구역은 비어 있다) ── */
  stage?: string
  canonicalStage?: string | null
  stageSiteName?: string
  stageBizType?: string
  stageMatchBy?: StageRecord['matchBy']
  gu?: string
}

/**
 * 정비몽땅 사업개요에서 가져온 구역 제원.
 * 고시문 HWP 파싱 대신 이 경로를 쓴다 — 서버 HTML 이라 훨씬 안정적이다.
 */
export interface ZoneSummary {
  cafeUrl: string
  siteName: string
  zoneName: string | null
  address: string | null
  areaM2: number | null
  memberCount: number | null
  landOwnerCount: number | null
  tenantCount: number | null
  useZone: string | null
  useDistrict: string | null
  siteAreaM2: number | null
  buildingAreaM2: number | null
  totalFloorAreaM2: number | null
  bcr: number | null
  far: number | null
  floors: string | null
  landUseHousing: number | null
  landUseRoad: number | null
  landUsePark: number | null
  landUseGreen: number | null
}

/** 정비몽땅에서 붙인 진행단계 (scripts/build-stages.mjs 산출물) */
export interface StageRecord {
  developId: string
  siteName: string
  gu: string
  jibun: string
  bizType: string
  stage: string
  opStage: string
  /**
   * id=안건번호 정확 조인(확정), point=폴리곤 포함, near=근접,
   * name/name~=이름 매칭 — 뒤로 갈수록 신뢰도가 낮다.
   */
  matchBy: 'id' | 'point' | 'near' | 'name' | 'name~'
}

let cache: StoredDevelop[] | null = null

function readJson<T>(...segments: string[]): T | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), ...segments), 'utf-8')) as T
  } catch {
    return null
  }
}

export function getAllDevelops(): StoredDevelop[] {
  if (cache) return cache

  const base = readJson<StoredDevelop[]>('data', 'develops.seoul.json') ?? []
  const stages = readJson<StageRecord[]>('data', 'stages.seoul.json') ?? []
  const summaries = readJson<Record<string, ZoneSummary>>('data', 'zone-summary.json') ?? {}
  const byId = new Map(stages.map((s) => [s.developId, s]))

  cache = base.map((d) => {
    const summary = summaries[d.id]
    if (summary) d = { ...d, summary }
    const s = byId.get(d.id)
    // gu는 enrich 단계에서 이미 채워져 있다. 정비몽땅 값으로 덮어쓰지 않는다.
    return s
      ? {
          ...d,
          stage: s.stage,
          canonicalStage: RAW_STAGE_TO_CANONICAL[s.stage] ?? null,
          stageSiteName: s.siteName,
          stageBizType: s.bizType,
          stageMatchBy: s.matchBy,
          gu: d.gu ?? s.gu,
        }
      : d
  })
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

/** 목록 화면용 경량 레코드 — 지오메트리를 뺀다 (사이드 패널은 지도를 안 그린다) */
export interface DevelopBrief {
  id: string
  name: string
  projectType: string
  rawLabel: string
  areaM2: number
  gu: string | null
  dong: string | null
  noticeDate: string | null
  stage: string | null
  canonicalStage: string | null
  center: [number, number] | null
  bbox: [number, number, number, number]
}

function toBrief(d: StoredDevelop): DevelopBrief {
  return {
    id: d.id,
    name: d.name,
    projectType: d.projectType,
    rawLabel: d.rawLabel,
    areaM2: d.areaM2,
    gu: d.gu ?? null,
    dong: d.dong ?? null,
    noticeDate: d.noticeDate ?? null,
    stage: d.stage ?? null,
    canonicalStage: d.canonicalStage ?? null,
    center: d.center ?? null,
    bbox: d.bbox,
  }
}

export interface BrowseQuery {
  gu?: string
  ids?: string[]
  sort?: 'notice' | 'name' | 'area'
  limit?: number
}

/** 지도 뷰포트와 무관한 목록 조회 (인기·관심·신규·지역별 패널용) */
export function browseDevelops({ gu, ids, sort = 'notice', limit = 50 }: BrowseQuery) {
  const all = getAllDevelops()

  if (ids?.length) {
    // 요청한 순서를 그대로 유지한다 (조회순·추가순 등 순서 자체가 의미를 가짐)
    const byId = new Map(all.map((d) => [d.id, d]))
    const items = ids.map((id) => byId.get(id)).filter((d): d is StoredDevelop => !!d)
    return { total: items.length, items: items.map(toBrief) }
  }

  let hits = gu ? all.filter((d) => d.gu === gu) : all

  if (sort === 'notice') {
    hits = [...hits].sort((a, b) => (b.noticeDate ?? '').localeCompare(a.noticeDate ?? ''))
  } else if (sort === 'name') {
    hits = [...hits].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  } else {
    hits = [...hits].sort((a, b) => b.areaM2 - a.areaM2)
  }

  return { total: hits.length, items: hits.slice(0, limit).map(toBrief) }
}

/** 자치구별 구역 수 — 지역 선택 드롭다운에 개수를 함께 보여준다 */
export function guCounts(): { gu: string; count: number }[] {
  const map = new Map<string, number>()
  for (const d of getAllDevelops()) {
    if (!d.gu) continue
    map.set(d.gu, (map.get(d.gu) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([gu, count]) => ({ gu, count }))
    .sort((a, b) => a.gu.localeCompare(b.gu, 'ko'))
}

export interface DevelopQuery {
  bbox: [number, number, number, number]
  level: number
  projectTypes?: string[]
  stages?: string[]
  limit?: number
}

export function queryDevelops({ bbox, level, projectTypes, stages, limit }: DevelopQuery) {
  const cap = limit ?? limitForLevel(level)
  const all = getAllDevelops()
  const typeFilter = projectTypes?.length ? new Set(projectTypes) : null
  const stageFilter = stages?.length ? new Set(stages) : null

  let hits = all.filter(
    (d) =>
      intersects(d.bbox, bbox) &&
      (!typeFilter || typeFilter.has(d.projectType)) &&
      (!stageFilter || (d.canonicalStage != null && stageFilter.has(d.canonicalStage))),
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
    withStage: hits.filter((d) => d.stage).length,
    develops: hits.map((d) => ({
      id: d.id,
      name: d.name,
      projectType: d.projectType,
      rawLabel: d.rawLabel,
      areaM2: d.areaM2,
      noticeSn: d.noticeSn,
      stage: d.stage ?? null,
      canonicalStage: d.canonicalStage ?? null,
      stageSiteName: d.stageSiteName ?? null,
      stageBizType: d.stageBizType ?? null,
      stageMatchBy: d.stageMatchBy ?? null,
      gu: d.gu ?? null,
      bbox: d.bbox,
      geometry: simplifyGeometry(d.geometry, tol),
    })),
  }
}
