import { NextResponse } from 'next/server'
import { fetchAuctions, hasOnbid, lastOnbidError, type AuctionItem } from '@/lib/server/onbid'
import { getAllDevelops } from '@/lib/server/developStore'
import { geocodeMany } from '@/lib/server/geocode'
import { outerRings } from '@/lib/types'
import { NO_CACHE, cacheHeaders } from '@/lib/server/cacheHeaders'

/**
 * 공매 물건 조회 — GET /api/auctions?gu=강동구
 *
 * 법원경매는 공개 API 가 없다. 여기 있는 건 전부 공매(온비드)다.
 *
 * 구역 매칭은 실거래와 같은 길을 쓴다 — 지번을 좌표로 바꿔 구역 경계 안팎을
 * 가른다. 온비드가 PNU 를 주므로 주소 문자열을 파싱할 필요 없이 지번을
 * 정확히 뽑을 수 있고, 이미 쌓인 지번 좌표 캐시를 그대로 탄다.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * PNU → 지번.
 * 법정동코드(10) + 산여부(1) + 본번(4) + 부번(4).
 * 주소 문자열을 쪼개는 것보다 정확하다 — 물건명은 표기가 제각각이다.
 */
function jibunOf(pnu: string | null): string | null {
  if (!pnu || pnu.length < 19) return null
  const san = pnu[10] === '2' ? '산 ' : ''
  const bon = Number(pnu.slice(11, 15))
  const bu = Number(pnu.slice(15, 19))
  if (!bon) return null
  return `${san}${bon}${bu ? `-${bu}` : ''}`
}

/**
 * PNU 가 없을 때 물건명에서 지번을 건진다.
 *
 * 집합건물(오피스텔·상가 호실)은 대지 PNU 가 비어 있다 — 강동구 140건 중 30건.
 * 대신 물건명에 전체 주소가 들어 있다("… 천호동 560-2외 2필지 더하임 305호").
 * 동 이름 뒤의 첫 번호가 대지 지번이다. "외 2필지"는 붙어 있는 나머지 필지라
 * 첫 번호만 쓰면 된다.
 */
function jibunFromName(name: string, dong: string): string | null {
  if (!dong) return null
  /*
   * 동 이름 뒤의 첫 번호가 대지 지번이다.
   * 역슬래시 이스케이프를 쓰지 않는다 — 문자 클래스로 같은 뜻을 낸다.
   * (\s, \d 는 여기까지 오는 동안 한 겹씩 벗겨져 몇 번 조용히 깨졌다)
   */
  const re = new RegExp(dong + '[ ]+(산[ ]*)?([0-9]+)(?:[-]([0-9]+))?')
  const m = name.match(re)
  if (!m) return null
  return `${m[1] ? '산 ' : ''}${Number(m[2])}${m[3] ? `-${Number(m[3])}` : ''}`
}

interface Zoned extends AuctionItem {
  jibun: string | null
  zoneId: string | null
  zoneName: string | null
  canonicalStage: string | null
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gu = searchParams.get('gu')
  if (!gu) return NextResponse.json({ error: 'gu 파라미터가 필요합니다.' }, { status: 400 })

  if (!hasOnbid()) {
    return NextResponse.json({
      gu,
      total: 0,
      inZone: 0,
      items: [],
      unavailable: 'NO_KEY',
      _meta: { source: '한국자산관리공사 온비드 공매', note: '서비스키가 설정되지 않았습니다.' },
    })
  }

  const items = await fetchAuctions(gu)

  // 지번을 좌표로 — 캐시에 없는 것만 카카오로 채운다
  const withJibun = items.map((it) => ({
    it,
    jibun: jibunOf(it.pnu) ?? jibunFromName(it.name, it.dong),
  }))
  const queries = [
    ...new Set(
      withJibun
        .filter((x) => x.jibun && x.it.dong)
        .map((x) => `서울 ${gu} ${x.it.dong} ${x.jibun}`),
    ),
  ]
  // 공매는 자치구당 100~200건이라 실거래보다 훨씬 적다. 넉넉히 잡아도 부담이 없다.
  const coords = await geocodeMany(queries, 150)

  const zones = getAllDevelops()
    .filter((d) => d.gu === gu)
    .map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.canonicalStage ?? null,
      bbox: d.bbox,
      rings: outerRings(d.geometry),
    }))

  const zoned: Zoned[] = withJibun.map(({ it, jibun }) => {
    const pt = jibun && it.dong ? coords.get(`서울 ${gu} ${it.dong} ${jibun}`) : null
    let hit: (typeof zones)[number] | undefined
    if (pt) {
      const [lng, lat] = pt
      hit = zones.find(
        (z) =>
          lng >= z.bbox[0] &&
          lng <= z.bbox[2] &&
          lat >= z.bbox[1] &&
          lat <= z.bbox[3] &&
          z.rings.some((r) => pointInRing(lng, lat, r)),
      )
    }
    return {
      ...it,
      jibun,
      zoneId: hit?.id ?? null,
      zoneName: hit?.name ?? null,
      canonicalStage: hit?.stage ?? null,
    }
  })

  const payload = {
    gu,
    total: zoned.length,
    inZone: zoned.filter((z) => z.zoneId).length,
    geocoded: [...coords.values()].filter(Boolean).length,
    items: zoned,
    unavailable: lastOnbidError(),
    _meta: {
      source: '한국자산관리공사 온비드 공매 (차세대 부동산 물건목록)',
      note: '법원경매는 공개 API가 없어 포함되지 않습니다. 구역 표시는 물건 지번을 좌표로 변환해 구역 경계 안으로 판정된 건입니다.',
    },
  }
  /*
   * 조회가 실패한 응답은 캐시하지 않는다.
   * unavailable 이 담긴 답을 CDN 이 하루 동안 돌려주면, 원인이 사라진 뒤에도
   * 계속 "가져올 수 없습니다"를 보게 된다.
   */
  return NextResponse.json(payload, {
    headers: payload.unavailable ? NO_CACHE : cacheHeaders('daily'),
  })
}
