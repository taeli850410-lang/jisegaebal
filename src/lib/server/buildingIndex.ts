import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * 건축물대장 색인.
 *
 * 원본 data/building-index.json 은 106MB 라 서버리스 함수에 넣으면
 * 콜드스타트마다 2.2초를 파싱에 쓴다. 실제로 읽는 필드는 여섯 개뿐이어서
 * scripts/build-slim-index.mjs 가 32MB / 1.0초짜리로 줄여 둔다.
 *
 * 배포에는 그 슬림본을 gzip 한 것만 올라간다(7.9MB, 푸는 데 90ms).
 * 43.6MB 를 그대로 저장소에 두면 클론이 무거워지고, Vercel 은 파일당 100MB 를
 * 넘기면 배포 자체를 거부한다 — 원본 106MB 가 실제로 그래서 막혔다.
 *
 * 읽는 순서는 gzip 슬림본 → 슬림본 → 원본이다. 로컬에는 원본만 있을 수 있다.
 * 셋 다 없으면 빈 색인이지만, 그 사실을 감추지 않는다.
 * 예전에 이걸 조용히 {} 로 두는 바람에 배포된 화면이 "0건"을 사실처럼 보여줬다.
 */

export interface BuildingRow {
  purpose: string
  /** 세대수 */
  hhld: number
  /** 호수 */
  ho: number
  /** 사용승인일 YYYYMMDD */
  apr: string
  /** 용적률 */
  far: number
  /** 건폐율 */
  bcr: number
}

export interface BuildingLot {
  buildings: BuildingRow[]
  semiBasement: number
}

type SlimRow = [string, number, number, string, number, number]
type Slim = Record<string, { b: SlimRow[]; s?: number }>

let index: Record<string, BuildingLot> | null = null
/** 색인이 어디서 왔는가 — 비어 있으면 왜 비었는지 말할 수 있어야 한다 */
let origin: 'slim-gz' | 'slim' | 'full' | 'missing' = 'missing'

function fromSlim(s: Slim): Record<string, BuildingLot> {
  const out: Record<string, BuildingLot> = {}
  for (const [k, v] of Object.entries(s)) {
    out[k] = {
      buildings: v.b.map((r) => ({
        purpose: r[0],
        hhld: r[1],
        ho: r[2],
        apr: r[3],
        far: r[4],
        bcr: r[5],
      })),
      semiBasement: v.s ?? 0,
    }
  }
  return out
}

export function getBuildingIndex(): Record<string, BuildingLot> {
  if (index) return index
  const dir = join(process.cwd(), 'data')
  try {
    const gz = gunzipSync(readFileSync(join(dir, 'building-slim.json.gz'))).toString('utf-8')
    index = fromSlim(JSON.parse(gz) as Slim)
    origin = 'slim-gz'
    return index
  } catch {
    /* 압축본이 없으면 아래로 */
  }
  try {
    index = fromSlim(JSON.parse(readFileSync(join(dir, 'building-slim.json'), 'utf-8')) as Slim)
    origin = 'slim'
    return index
  } catch {
    /* 로컬에는 원본만 있을 수 있다 */
  }
  try {
    index = JSON.parse(readFileSync(join(dir, 'building-index.json'), 'utf-8')) as Record<
      string,
      BuildingLot
    >
    origin = 'full'
    return index
  } catch {
    index = {}
    origin = 'missing'
    return index
  }
}

/** 색인이 실렸는가 — 화면이 "건물 없음"과 "색인 없음"을 구분할 수 있게 */
export function buildingIndexStatus(): { origin: typeof origin; size: number } {
  const i = getBuildingIndex()
  return { origin, size: Object.keys(i).length }
}

/** 지번 키 — 구|동|본번4+부번4 */
export function lotKey(gu: string, dong: string, jibun: string): string {
  const [bun, ji] = jibun.replace(/[^0-9-]/g, '').split('-')
  const pad = (v: number) => String(v || 0).padStart(4, '0')
  return `${gu}|${dong}|${pad(Number(bun))}${pad(Number(ji ?? 0))}`
}
