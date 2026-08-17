import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RAW_STAGE_TO_CANONICAL } from '@/lib/taxonomy'

/**
 * 경계 없는 사업장 저장소 (서버 전용)
 *
 * 지도의 구역 경계는 서울시 의제처리구역(= 정비구역 고시가 난 곳)이다.
 * 그래서 가로주택·소규모재건축·지역주택·리모델링처럼 정비구역 고시 없이
 * 진행되는 사업은 경계 데이터가 아예 존재하지 않는다.
 *
 * 그렇다고 안 보여줄 수는 없다 — 벤치마크 화면의 강동구 카드는 대부분 그 유형이다.
 * 정비몽땅 사업장의 대표지번을 지오코딩해 "점"으로 세운다.
 * 경계가 없다는 사실은 hasBoundary:false 로 숨기지 않고 그대로 내보낸다.
 *
 * 원본: 서울시 정비사업 정보몽땅 사업장 목록 (scripts/build-sites.mjs)
 */

export interface StoredSite {
  id: string
  name: string
  gu: string
  jibun: string
  /** 정비몽땅 원본 사업유형 라벨 */
  bizType: string
  /** taxonomy 코드 */
  projectType: string
  stage: string | null
  wtnncSn: string | null
  cafeUrl: string | null
  center: [number, number]
  /** lot=본지번 일치 · near=부번 생략/장소검색 (수십~수백 m 오차) */
  precision: 'lot' | 'near'
}

export interface SiteBrief extends StoredSite {
  canonicalStage: string | null
  /** 항상 false — 목록·지도에서 구역(경계 있음)과 섞일 때 구분자로 쓴다 */
  hasBoundary: false
}

let cache: SiteBrief[] | null = null

export function getAllSites(): SiteBrief[] {
  if (cache) return cache
  let raw: StoredSite[] = []
  try {
    raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'sites.seoul.json'), 'utf-8'))
  } catch {
    // 파일이 없으면 사업장 레이어만 비는 게 맞다. 구역은 그대로 나와야 한다.
    raw = []
  }
  cache = raw.map((s) => ({
    ...s,
    canonicalStage: s.stage ? (RAW_STAGE_TO_CANONICAL[s.stage] ?? null) : null,
    hasBoundary: false as const,
  }))
  return cache
}

/**
 * 뷰포트 안의 사업장.
 *
 * 점이라 폴리곤처럼 겹칠 일이 없지만, 확대 전에는 라벨이 서로 먹으므로
 * 지도가 충분히 들어갔을 때(level<=4)만 의미가 있다. 레벨 판단은 호출부에 맡긴다.
 */
export function querySites(
  bbox: [number, number, number, number],
  opts: { projectTypes?: string[]; stages?: string[]; limit?: number } = {},
): SiteBrief[] {
  const [minLng, minLat, maxLng, maxLat] = bbox
  const { projectTypes, stages, limit = 400 } = opts
  const out: SiteBrief[] = []
  for (const s of getAllSites()) {
    const [lng, lat] = s.center
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue
    if (projectTypes?.length && !projectTypes.includes(s.projectType)) continue
    if (stages?.length && !stages.includes(s.canonicalStage ?? '')) continue
    out.push(s)
    if (out.length >= limit) break
  }
  return out
}

export function sitesInGu(gu?: string): SiteBrief[] {
  const all = getAllSites()
  return gu ? all.filter((s) => s.gu === gu) : all
}

export function findSite(id: string): SiteBrief | undefined {
  return getAllSites().find((s) => s.id === id)
}

/** 자치구별 사업장 수 — 구역 수와 합쳐 드롭다운에 표시한다 */
export function siteGuCounts(): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of getAllSites()) m.set(s.gu, (m.get(s.gu) ?? 0) + 1)
  return m
}
