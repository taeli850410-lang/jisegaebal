import { NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { getAllDevelops } from '@/lib/server/developStore'
import { getLandRightsMany } from '@/lib/server/landRight'
import { getExposMany } from '@/lib/server/expos'
import { geocodeMany } from '@/lib/server/geocode'
import { fetchParcels, ringAreaM2 } from '@/lib/server/vworld'
import { getPublicPrice } from '@/lib/server/housePrice'
import { getBuildingIndex, buildingIndexStatus } from '@/lib/server/buildingIndex'
import { resolveRightsDate } from '@/lib/rightsDate'
import { verifyListing, verdict, type ListingFacts } from '@/lib/verifyListing'
import { outerRings } from '@/lib/types'
import { hasHofinder, hofinderVerify } from '@/lib/server/hofinder'
import { crossCheck, crossVerdict } from '@/lib/crossCheck'
import { landShareOf } from '@/lib/landShare'

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

let hp: Record<string, { year: number; units: [number, number, boolean][] } | null> | null = null
function loadIndexes() {
  const bi = getBuildingIndex()
  if (!hp) {
    try {
      hp = JSON.parse(readFileSync(join(process.cwd(), 'data', 'house-price-cache.json'), 'utf-8'))
    } catch {
      hp = {}
    }
  }
  return { bi, hp: hp! }
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

  /*
   * 호파인더에 같은 물건을 동시에 물어본다.
   *
   * 우리 조회(지오코딩·대지권·전유부)도 네트워크라 기다리는 시간이 겹친다.
   * 그래서 나란히 띄우면 응답이 사실상 안 늦는다.
   * 여기서 await 하지 않는다 — 맨 끝에서 받는다.
   */
  const hofinderP = hasHofinder()
    ? hofinderVerify({
        gu,
        dong,
        jibun,
        floor: input.floor,
        exclusiveAr: input.exclusiveAr,
        price: input.price,
      })
    : Promise.resolve(null)

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
  /*
   * 색인이 안 실렸을 때 호파인더가 건물 개요를 대신 준다.
   *
   * 색인이 없다고 "용도 미상"으로 넘기면 근생을 주택으로 오인하게 된다.
   * 그건 분양자격이 걸린 문제라 비워 둘 수 없다.
   */
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
  /*
   * 전용면적이 가장 가까운 호를 고르되, 1㎡ 넘게 벌어지면 포기한다.
   *
   * 이 가드가 없어서 42.96㎡ 근생에 44.48㎡ 호의 공시가 3.58억을 붙였다.
   * 벤치마크가 낸 것과 똑같은 오류다 — "가장 가까운 값"은 "맞는 값"이 아니다.
   */
  const nearest =
    input.exclusiveAr && pool.length
      ? pool.reduce((a, b) =>
          Math.abs(b[0] - input.exclusiveAr!) < Math.abs(a[0] - input.exclusiveAr!) ? b : a,
        )
      : null
  const matched =
    nearest && input.exclusiveAr && Math.abs(nearest[0] - input.exclusiveAr) <= 1 ? nearest : null

  /*
   * 미리 받아둔 캐시에 이 지번이 없을 수 있다. 캐시는 구역 단위로 훑어 채운
   * 것이라 구역 밖이나 나중에 물어본 지번은 빠져 있다.
   *
   * 그때 "공시가 없음"으로 답하면 근생이라 정말 없는 것과 구별이 안 된다.
   * 그래서 한 번 직접 물어본다 — getPublicPrice 가 캐시 미스면 조회한다.
   */
  let livePrice: number | null = null
  if (!matched && input.exclusiveAr) {
    livePrice = (await getPublicPrice(gu, dong, jibun, input.exclusiveAr, input.floor))?.price ?? null
  }

  /* ── 대지지분 ── */
  let landSharePyeong: number | null = null
  let landShareSource: ListingFacts['landShareSource'] = 'none'
  /*
   * PNU 가 있어야 전유부·대지권을 부를 수 있다.
   *
   * 처음엔 호출한 쪽이 넘겨주기를 기대했는데, 정작 화면은 지번만 넣고 부른다.
   * 그래서 호·용도·대지지분이 전부 빈 채로 나갔다 — 호파인더와 대조해 보고서야
   * 드러났다. 지번만 받아도 우리가 알아낸다.
   *
   * 좌표는 위에서 이미 구했으니 그 자리의 지적도에서 필지를 집으면 된다.
   */
  let pnu = q.get('pnu')
  let parcelAreaM2: number | null = null
  if (!pnu && pt) {
    const d = 0.0006 // 약 60m — 한 필지를 덮기에 충분하고 응답도 가볍다
    const near = await fetchParcels([pt[0] - d, pt[1] - d, pt[0] + d, pt[1] + d])
    if (near?.length) {
      /* 지적도 jibun 은 "245-11대" 처럼 지목이 붙어 온다 */
      const want = jibun.replace(/[^0-9-]/g, '')
      const hit =
        near.find((f) => f.jibun.replace(/[^0-9-]/g, '') === want) ??
        near.find((f) => f.jibun.startsWith(want))
      if (hit) {
        pnu = hit.pnu
        /* 필지면적을 챙겨 둔다 — 대지권 조회가 실패해도 나눌 총면적이 있어야 한다 */
        parcelAreaM2 = Math.round(ringAreaM2(hit.ring))
      }
    }
  }
  /*
   * 여기서는 대지권 "총면적"만 모은다.
   *
   * 예전엔 이 API 의 호별 lndpclAr 을 그 호의 대지지분으로 믿고 중앙값을 썼다.
   * 아니었다 — 58% 의 건물에서 모든 호가 같은 값이고, 그건 필지를 호수로
   * 균등분할한 것이다. 전용면적이 두 배 차이 나는 호가 같은 대지지분일 수 없다.
   * 호별 배분은 아래에서 landShareOf 가 한다.
   */
  let totalLandM2: number | null = null
  if (pnu) {
    const rights = await getLandRightsMany([pnu], 2)
    const rg = rights.get(pnu)
    if (rg?.length) totalLandM2 = rg.reduce((sum, u) => sum + u[2], 0)
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

  /* ── 호파인더 대조 ──────────────────────────────────
     여기서 기다린다. 우리 조회가 다 끝난 뒤라 대기가 겹쳐 시간이 늘지 않는다.
     실패하면 null 이고, 그래도 우리 검증은 그대로 나간다. */
  const hf = await hofinderP

  /*
   * ── 대지지분 ──
   * 실거래 신고서의 대지권면적 → 같은 건물 비율 → 전용면적 비례 순으로 고른다.
   * 어느 근거로 나온 값인지 함께 내보낸다.
   */
  const liveDeals = (hf?.deals ?? []).filter((d) => !d.canceled && d.landShareArea)
  const ourHo = matchedUnit?.ho ?? null
  const myDeal =
    ourHo && matchedUnit
      ? (liveDeals.find(
          (d) =>
            d.estimatedHo?.replace(/[^0-9]/g, '') === ourHo.replace(/[^0-9]/g, '') &&
            Math.abs(d.exclusiveArea - matchedUnit.area) <= 0.5,
        ) ?? null)
      : null
  /*
   * 근거를 하나라도 더 잇는다.
   *
   * 전유부 조회와 호파인더가 동시에 실패한 적이 있다. 그때 "확인 불가"가
   * 나갔는데, 정작 공시가격은 나왔다 — 호별 전용면적 목록을 이미 갖고
   * 있었다는 뜻이다. 있는 걸 안 쓰고 포기하면 안 된다.
   *
   * 총면적도 마찬가지다. 대지권 자료가 없으면 지적도 필지면적을 쓴다.
   * 구역 필지 화면이 하는 것과 같은 방식이라 두 화면의 값이 어긋나지 않는다.
   */
  const unitAreaList = ex?.length
    ? ex.map((u) => u[2])
    : units.length
      ? units.map((u) => u[0])
      : null
  const share = landShareOf({
    unitArea: matchedUnit?.area ?? input.exclusiveAr,
    allUnitAreas: unitAreaList,
    totalLandM2: totalLandM2 ?? parcelAreaM2,
    dealLandM2: myDeal?.landShareArea ?? null,
    buildingDeals: liveDeals.map((d) => ({ area: d.exclusiveArea, landM2: d.landShareArea! })),
  })
  landSharePyeong = share.pyeong
  landShareSource =
    share.basis === 'deal' ? 'right' : share.basis === 'none' ? 'none' : 'expos'

  /*
   * 용도가 주택이 아니면 공동주택가격이 애초에 없다.
   *
   * 근린생활시설·상가는 공동주택가격 고시 대상이 아니다. 같은 지번의 옆 호
   * 값을 면적이 비슷하다는 이유로 붙이면, 없는 감정가·프리미엄이 만들어진다.
   * 서계동 245-11 101호가 그 경우다.
   */
  const NON_HOUSE = /근린생활|판매시설|업무시설|공장|창고|교육연구|종교|의료|숙박|위락|운동|자동차/
  const unitIsHouse = matchedUnit ? !NON_HOUSE.test(matchedUnit.purpose) : true
  const publicPrice = unitIsHouse ? (matched?.[1] ?? livePrice) : null

  const hfBuilding = hf?.building ?? null
  const facts: ListingFacts = {
    purpose: main?.purpose ?? hfBuilding?.mainPurpose ?? null,
    matchedUnit,
    approvalDate: (() => {
      const a = main?.apr || hfBuilding?.approvalDate
      return a && a.length >= 8 ? `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}` : null
    })(),
    landSharePyeong,
    landShareSource,
    landShareLabel: share.label,
    publicPrice,
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

  const hfMatched = hf?.matched ?? null
  /* 호파인더가 잡은 호의 공시가는 units 목록에서 찾는다 */
  const hfUnit = hfMatched
    ? (hf?.units ?? []).find((u) => u.ho === hfMatched.ho) ?? null
    : null

  const crossRows = hf
    ? crossCheck({
        ours: {
          ho: ourHo,
          purpose: matchedUnit?.purpose ?? null,
          exclusiveAr: matchedUnit?.area ?? null,
          publicPrice: facts.publicPrice,
          landSharePyeong: facts.landSharePyeong,
          landShareBasis: share.basis,
          landShareLabel: share.label,
        },
        theirs: {
          ho: hfMatched?.ho ?? null,
          purpose: hfMatched?.purpose ?? null,
          exclusiveAr: hfMatched?.area ?? null,
          publicPrice: hfUnit?.officialPrice ?? null,
          landSharePyeong: hfUnit?.estLandSharePyeong ?? null,
          dealLandShareM2: myDeal?.landShareArea ?? null,
          dealLabel: myDeal
            ? `${myDeal.contractDate} ${(myDeal.priceMan / 10_000).toFixed(2).replace(/[.]?0+$/, '')}억`
            : null,
        },
      })
    : []

  return NextResponse.json({
    address: `${gu} ${dong} ${jibun}`,
    input,
    zone: zone
      ? { id: zone.id, name: zone.name, stage: zone.stage ?? null, projectType: zone.projectType }
      : null,
    facts,
    findings,
    verdict: verdict(findings),
    /* 대지지분을 어떤 근거로 냈는가 — 숫자만 주면 실측인지 추정인지 알 수 없다 */
    landShare: share,
    /*
     * 호파인더 대조. 우리 판정을 덮어쓰지 않는다 — 나란히 놓는다.
     * unavailable 이면 "일치한다"가 아니라 "못 물어봤다"는 뜻이다.
     */
    cross: hf
      ? {
          rows: crossRows,
          summary: crossVerdict(crossRows),
          verdict: hf.verdict ?? null,
          appraisal: hf.estAppraisal != null ? hf.estAppraisal * 10_000 : null,
          premium: hf.premium != null ? hf.premium * 10_000 : null,
          deals: (hf.deals ?? []).filter((d) => !d.canceled).slice(0, 5),
          units: (hf.units ?? []).length,
        }
      : { unavailable: hasHofinder() ? 'HOFINDER_UNREACHABLE' : 'HOFINDER_OFF' },
    _meta: {
      buildingIndex: buildingIndexStatus(),
      source:
        '건축물대장 / 공동주택 공시가격 / 대지권등록부(V-World 소유정보) / 서울시 의제처리구역' +
        (hf ? ' · 호파인더 대조' : ''),
      note: '입력값은 사용자가 제공한 것이며 저장하지 않습니다. 본 결과는 참고용이고 계약 전 등기부등본·건축물대장 원본과 조합·구청 확인이 필요합니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.',
    },
  })
}
