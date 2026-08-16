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
  /* ── 정비몽땅 추진경과에서 오는 단계별 인가일 (scripts/merge-progress.mjs) ── */
  progress?: ZoneProgress
  /* ── 연속지적도 + 건축물대장으로 산출한 통계 (scripts/build-zone-stats.mjs) ── */
  stats?: ZoneStats

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

/**
 * 구역별 세대현황·노후도·개발여건 (scripts/build-zone-stats.mjs)
 *
 * 연속지적도(V-World)로 구역 안 필지를 세고, 그 지번의 건축물대장을 붙여 계산한다.
 * 산출한 구역만 채워지므로 없는 구역은 화면에서 미연동으로 표시한다.
 */
export interface ZoneStats {
  parcelCount: number
  legalDongs?: number
  households: { total: number; apt: number; house: number }
  aging: { base: number; denominator: number; now: number; in5: number; in10: number }
  conditions: {
    smallParcels: number
    parcels: number
    withBasement: number
    residentialBuildings: number
    householdsPerHa: number | null
    abutting?: number
    abuttingBase?: number
  }
  actual?: {
    far: number | null
    bcr: number | null
    platAreaM2: number
    buildings: number
    useZones: { label: string; areaM2: number }[]
    roadMix: { label: string; count: number }[]
  }
  landUse: { label: string; areaM2: number }[]
  landPrice: { medianPerM2: number; samples: number } | null
  source: string
}

/** 정비몽땅 추진경과에서 뽑은 단계별 인가일 (scripts/merge-progress.mjs) */
export interface ZoneProgress {
  cafeUrl: string
  siteName: string
  /** 정규화 단계코드 → 최초 인가일 */
  dates: Record<string, { date: string; rawStage: string; noticeNo: string | null }>
  history: {
    stage: string
    date: string
    note: string | null
    noticeNo: string | null
    vendor: string | null
  }[]
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
  const progresses = readJson<Record<string, ZoneProgress>>('data', 'zone-progress.json') ?? {}
  const zoneStats = readJson<Record<string, ZoneStats>>('data', 'zone-stats.json') ?? {}
  const byId = new Map(stages.map((s) => [s.developId, s]))

  cache = base.map((d) => {
    const summary = summaries[d.id]
    const progress = progresses[d.id]
    const stats = zoneStats[d.id]
    if (summary || progress || stats)
      d = {
        ...d,
        ...(summary && { summary }),
        ...(progress && { progress }),
        ...(stats && { stats }),
      }
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

export interface ClusterQuery {
  bbox: [number, number, number, number]
  by: 'gu' | 'dong'
  projectTypes?: string[]
  stages?: string[]
}

export interface Cluster {
  key: string
  label: string
  gu: string
  dong: string | null
  count: number
  /** 단계가 확인된 구역 수 — 배지에 진행도를 색으로 얹는 데 쓴다 */
  withStage: number
  center: [number, number]
}

/**
 * 축소했을 때 쓰는 지역별 집계.
 *
 * 구역을 다 그리면 화면이 폴리곤으로 덮이고 라벨도 못 읽는다.
 * 벤치마크(재개발닷컴)처럼 멀리서는 "이 동에 몇 개"만 보여주고,
 * 확대하면 개별 구역으로 바뀐다.
 *
 * 개수는 뷰포트 안 전체를 세므로 queryDevelops의 상한(400~600개)에 걸리지 않는다.
 */
export function clusterDevelops({ bbox, by, projectTypes, stages }: ClusterQuery): Cluster[] {
  const typeFilter = projectTypes?.length ? new Set(projectTypes) : null
  const stageFilter = stages?.length ? new Set(stages) : null

  const groups = new Map<string, { gu: string; dong: string | null; ds: StoredDevelop[] }>()
  for (const d of getAllDevelops()) {
    if (!d.gu) continue
    if (!intersects(d.bbox, bbox)) continue
    if (typeFilter && !typeFilter.has(d.projectType)) continue
    if (stageFilter && !(d.canonicalStage != null && stageFilter.has(d.canonicalStage))) continue

    // 동을 모르는 구역은 자치구로 올려 세어 개수가 새지 않게 한다
    const dong = by === 'dong' ? (d.dong ?? null) : null
    const key = dong ? `${d.gu}|${dong}` : d.gu
    const g = groups.get(key)
    if (g) g.ds.push(d)
    else groups.set(key, { gu: d.gu, dong, ds: [d] })
  }

  const out: Cluster[] = []
  for (const [key, { gu, dong, ds }] of groups) {
    // 배지 위치는 구역 중심들의 면적가중 평균 — 큰 구역 쪽으로 붙는 게 자연스럽다
    let x = 0
    let y = 0
    let w = 0
    for (const d of ds) {
      const c = d.center ?? [(d.bbox[0] + d.bbox[2]) / 2, (d.bbox[1] + d.bbox[3]) / 2]
      const a = Math.max(d.areaM2, 1)
      x += c[0] * a
      y += c[1] * a
      w += a
    }
    out.push({
      key,
      label: dong ?? gu,
      gu,
      dong,
      count: ds.length,
      withStage: ds.filter((d) => d.stage).length,
      center: [x / w, y / w],
    })
  }

  return out.sort((a, b) => b.count - a.count)
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
