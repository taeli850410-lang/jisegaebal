import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAllDevelops } from '@/lib/server/developStore'
import { getLandRightsMany } from '@/lib/server/landRight'
import { getExposMany } from '@/lib/server/expos'
import { geocodeMany } from '@/lib/server/geocode'
import { resolveRightsDate } from '@/lib/rightsDate'
import { verifyListing, verdict, type ListingFacts } from '@/lib/verifyListing'
import { outerRings } from '@/lib/types'

/**
 * 매물 검증 — GET /api/verify?gu=..&dong=..&jibun=..&area=..&floor=..&type=..&ho=..
 *
 * 사용자가 어디선가 본 매물의 지번·면적·층을 넣으면, 우리가 가진 공공데이터로
 * 그게 말이 되는지 따져준다.
 *
 * 우리 서버는 남의 플랫폼에 접속하지 않는다. 입력은 사용자가 넣고, 결과는
 * 그 응답에만 담기며 공개 매물 목록으로 저장하지 않는다.
 * 계산기이지 매물 데이터베이스가 아니다.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const PYEONG = 3.3058
const pad = (v: number) => String(v || 0).padStart(4, '0')

let bi: Record<string, { buildings: { purpose: string; hhld: number; apr: string }[] }> | null = null
let hp: Record<string, { year: number; units: [number, number, boolean][] } | null> | null = null
function loadIndexes() {
  if (!bi) {
    try {
      bi = JSON.parse(readFileSync(join(process.cwd(), 'data', 'building-index.json'), 'utf-8'))
    } catch {
      bi = {}
    }
  }
  if (!hp) {
    try {
      hp = JSON.parse(readFileSync(join(process.cwd(), 'data', 'house-price-cache.json'), 'utf-8'))
    } catch {
      hp = {}
    }
  }
  return { bi: bi!, hp: hp! }
}

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams
  const gu = q.get('gu')?.trim()
  const dong = q.get('dong')?.trim()
  const jibun = q.get('jibun')?.trim()
  if (!gu || !dong || !jibun) {
    return NextResponse.json({ error: 'gu·dong·jibun 이 필요합니다.' }, { status: 400 })
  }
  const num = (k: string) => {
    const v = Number(q.get(k))
    return Number.isFinite(v) && v !== 0 ? v : null
  }
  const input = {
    type: q.get('type'),
    exclusiveAr: num('area'),
    floor: num('floor'),
    price: num('price'),
  }

  const { bi, hp } = loadIndexes()

  /* ── 지번 → 좌표 → 어느 구역인가 ── */
  const addr = `서울 ${gu} ${dong} ${jibun}`
  const pt = (await geocodeMany([addr], 3)).get(addr) ?? null
  const zone = pt
    ? getAllDevelops().find(
        (z) =>
          z.gu === gu &&
          pt[0] >= z.bbox[0] &&
          pt[0] <= z.bbox[2] &&
          pt[1] >= z.bbox[1] &&
          pt[1] <= z.bbox[3] &&
          outerRings(z.geometry).some((r) => pointInRing(pt[0], pt[1], r)),
      )
    : undefined

  /* ── 건축물대장 ── */
  const [bunRaw, jiRaw] = jibun.replace(/[^0-9-]/g, '').split('-')
  const bkey = `${gu}|${dong}|${pad(Number(bunRaw))}${pad(Number(jiRaw ?? 0))}`
  const main = bi[bkey]?.buildings?.[0] ?? null

  /* ── 공동주택 공시가격 ── */
  const priceLot = hp[`${gu}|${dong}|${jibun}`] ?? null
  const units = priceLot?.units ?? []
  /*
   * 광고 면적과 층으로 호를 특정한다.
   * 반지하는 같은 면적이라도 값이 크게 다르므로 층 부호를 먼저 맞춘다.
   */
  const wantBasement = typeof input.floor === 'number' && input.floor < 0
  const pool = units.filter((u) => u[2] === wantBasement)
  const matched =
    input.exclusiveAr && pool.length
      ? pool.reduce((a, b) =>
          Math.abs(b[0] - input.exclusiveAr!) < Math.abs(a[0] - input.exclusiveAr!) ? b : a,
        )
      : null

  /* ── 대지지분 ── */
  let landSharePyeong: number | null = null
  let landShareSource: ListingFacts['landShareSource'] = 'none'
  const pnu = q.get('pnu')
  if (pnu) {
    const rights = await getLandRightsMany([pnu], 2)
    const rg = rights.get(pnu)
    if (rg?.length) {
      landShareSource = 'right'
      // 층이 주어지면 그 층의 호를 고르고, 아니면 중앙값을 쓴다
      const sameFloor =
        input.floor != null ? rg.filter((u) => Number(u[1]) === Math.abs(input.floor!)) : []
      const pickFrom = sameFloor.length ? sameFloor : rg
      const areas = pickFrom.map((u) => u[2]).sort((a, b) => a - b)
      landSharePyeong = Math.round((areas[Math.floor(areas.length / 2)] / PYEONG) * 100) / 100
    } else if (!main) {
      landShareSource = 'none'
    }
  }

  /* ── 대장 전유부: 호별 면적·용도 ── */
  const ex = pnu ? ((await getExposMany([pnu], 2)).get(pnu) ?? null) : null
  const unitAreas = ex?.length ? ex.map((u) => u[2]) : units.map((u) => u[0])

  /*
   * 광고 면적·층으로 호를 특정한다.
   * 층이 주어지면 층을 먼저 맞추고, 그 안에서 면적이 가장 가까운 호를 고른다.
   * 같은 면적이 여러 층에 있는 건물이 흔해서 층을 안 보면 엉뚱한 호를 잡는다.
   */
  let matchedUnit: ListingFacts['matchedUnit'] = null
  if (ex?.length && input.exclusiveAr) {
    const sameFloor =
      input.floor != null ? ex.filter((u) => u[1] === input.floor) : []
    const pool2 = sameFloor.length ? sameFloor : ex
    const best = pool2.reduce((a, b) =>
      Math.abs(b[2] - input.exclusiveAr!) < Math.abs(a[2] - input.exclusiveAr!) ? b : a,
    )
    // 1㎡ 넘게 벌어지면 그 호라고 단정하지 않는다
    if (Math.abs(best[2] - input.exclusiveAr) <= 1) {
      matchedUnit = { ho: best[0], floor: best[1], area: best[2], purpose: best[3] }
    }
  }

  const facts: ListingFacts = {
    purpose: main?.purpose ?? null,
    matchedUnit,
    approvalDate: main?.apr
      ? `${main.apr.slice(0, 4)}-${main.apr.slice(4, 6)}-${main.apr.slice(6, 8)}`
      : null,
    landSharePyeong,
    landShareSource,
    publicPrice: matched?.[1] ?? null,
    unitAreas,
    zoneName: zone?.name ?? null,
    zoneStage: zone?.stage ?? null,
    rightsBasis: zone
      ? resolveRightsDate({
          name: zone.name,
          rawLabel: zone.rawLabel,
          projectType: zone.projectType,
          noticeDate: zone.noticeDate ?? null,
        })
      : null,
  }

  const findings = verifyListing(input, facts)

  return NextResponse.json({
    address: `${gu} ${dong} ${jibun}`,
    input,
    zone: zone
      ? { id: zone.id, name: zone.name, stage: zone.stage ?? null, projectType: zone.projectType }
      : null,
    facts,
    findings,
    verdict: verdict(findings),
    _meta: {
      source:
        '건축물대장 / 공동주택 공시가격 / 대지권등록부(V-World 소유정보) / 서울시 의제처리구역',
      note: '입력값은 사용자가 제공한 것이며 저장하지 않습니다. 본 결과는 참고용이고 계약 전 등기부등본·건축물대장 원본과 조합·구청 확인이 필요합니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.',
    },
  })
}
