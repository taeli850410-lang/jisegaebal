import { NextResponse } from 'next/server'
import { fetchTransactions, lastMolitError } from '@/lib/server/molit'
import { geocodeMany } from '@/lib/server/geocode'
import { SEOUL_LAWD } from '@/lib/server/lawdCodes'

/**
 * 지도 위 아파트 단지 시세 마커.
 *
 * GET /api/apt-markers?bbox=minLng,minLat,maxLng,maxLat
 *   → [{ name, lng, lat, area, price, dealDate, count }]
 *
 * 벤치마크의 "단지" 레이어처럼 단지마다 "84 17억" 한 줄을 띄운다.
 * 전용 84㎡ 를 기준으로 잡되, 없으면 그 단지에서 가장 많이 거래된 면적을 쓴다.
 * (같은 단지라도 평형마다 값이 크게 달라 하나로 뭉치면 숫자가 무의미해진다)
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MONTHS = 12
/** 84㎡ 를 기준 평형으로 본다. 이 범위 안에서 가장 84 에 가까운 걸 고른다. */
const PREFERRED = { min: 82, max: 86 }

export interface AptMarker {
  name: string
  lng: number
  lat: number
  /** 전용면적(㎡, 정수) */
  area: number
  price: number
  dealDate: string
  /** 같은 면적대 거래 수 — 1건이면 시세로 보기 어렵다 */
  count: number
  /* 상세 조회 키 — 마커를 눌렀을 때 이 단지를 다시 찾으려면 필요하다 */
  gu: string
  dong: string
  jibun: string
}

/** bbox 안에 어떤 자치구가 걸치는지 — 3x3 격자를 역지오코딩해 모은다 */
async function guInBbox(bbox: [number, number, number, number]): Promise<string[]> {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return []
  const [minLng, minLat, maxLng, maxLat] = bbox
  const pts: [number, number][] = []
  for (let i = 0; i <= 2; i++) {
    for (let j = 0; j <= 2; j++) {
      pts.push([minLng + ((maxLng - minLng) * i) / 2, minLat + ((maxLat - minLat) * j) / 2])
    }
  }
  const found = new Set<string>()
  await Promise.all(
    pts.map(async ([lng, lat]) => {
      try {
        const r = await fetch(
          `https://dapi.kakao.com/v2/local/geo/coord2regioncode.json?x=${lng}&y=${lat}`,
          { headers: { Authorization: `KakaoAK ${key}` }, cache: 'no-store' },
        )
        if (!r.ok) return
        const docs = (await r.json()).documents ?? []
        for (const d of docs) {
          if (d.region_1depth_name?.includes('서울') && d.region_2depth_name) {
            found.add(d.region_2depth_name)
          }
        }
      } catch {
        /* 건너뛴다 */
      }
    }),
  )
  return [...found].filter((g) => g in SEOUL_LAWD)
}

const cache = new Map<string, { at: number; markers: AptMarker[] }>()
const TTL = 20 * 60 * 1000

export async function GET(request: Request) {
  const bboxParam = new URL(request.url).searchParams.get('bbox')
  if (!bboxParam) return NextResponse.json({ error: 'bbox 가 필요합니다.' }, { status: 400 })
  const bbox = bboxParam.split(',').map(Number) as [number, number, number, number]
  if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    return NextResponse.json({ error: 'bbox 형식이 올바르지 않습니다.' }, { status: 400 })
  }
  if (!process.env.DATA_GO_KR_SERVICE_KEY) {
    return NextResponse.json({ error: '실거래 인증키 미설정', code: 'NO_KEY' }, { status: 503 })
  }

  const gus = await guInBbox(bbox)
  if (!gus.length) return NextResponse.json({ markers: [], gus: [] })

  // 자치구 단위로 캐시한다 — 지도를 조금 움직여도 재사용된다
  const markers: AptMarker[] = []
  for (const gu of gus) {
    const hit = cache.get(gu)
    if (hit && Date.now() - hit.at < TTL) {
      markers.push(...hit.markers)
      continue
    }

    const deals = await fetchTransactions(gu, MONTHS, ['apt'])
    const queries = [...new Set(deals.map((d) => `서울 ${gu} ${d.dong} ${d.jibun}`))]
    // 지오코딩은 캐시만 쓴다. 마커 하나 띄우자고 수천 건을 새로 지오코딩할 수는 없다.
    const coords = await geocodeMany(queries, 0)

    /* 단지 + 전용면적(정수)으로 묶는다 */
    const byUnit = new Map<
      string,
      {
        name: string
        lng: number
        lat: number
        area: number
        dong: string
        jibun: string
        deals: typeof deals
      }
    >()
    for (const d of deals) {
      if (!d.buildingName || !d.exclusiveAr) continue
      const pt = coords.get(`서울 ${gu} ${d.dong} ${d.jibun}`)
      if (!pt) continue
      const area = Math.round(d.exclusiveAr)
      const k = `${d.buildingName}|${d.dong}|${d.jibun}|${area}`
      const cur = byUnit.get(k)
      if (cur) cur.deals.push(d)
      else
        byUnit.set(k, {
          name: d.buildingName,
          lng: pt[0],
          lat: pt[1],
          area,
          dong: d.dong,
          jibun: d.jibun,
          deals: [d],
        })
    }

    /* 단지별로 대표 평형 하나만 남긴다 */
    const byComplex = new Map<string, AptMarker>()
    for (const u of byUnit.values()) {
      const latest = u.deals.reduce((a, b) => (b.dealDate > a.dealDate ? b : a))
      const cand: AptMarker = {
        name: u.name,
        lng: u.lng,
        lat: u.lat,
        area: u.area,
        price: latest.price,
        dealDate: latest.dealDate,
        count: u.deals.length,
        gu,
        dong: u.dong,
        jibun: u.jibun,
      }
      const key = `${u.name}|${u.lng.toFixed(5)}|${u.lat.toFixed(5)}`
      const prev = byComplex.get(key)
      if (!prev) {
        byComplex.set(key, cand)
        continue
      }
      // 84㎡ 에 가까운 쪽이 우선, 둘 다 아니면 거래가 많은 쪽
      const score = (m: AptMarker) => {
        const preferred = m.area >= PREFERRED.min && m.area <= PREFERRED.max
        return preferred ? 1000 - Math.abs(m.area - 84) : m.count
      }
      if (score(cand) > score(prev)) byComplex.set(key, cand)
    }

    const list = [...byComplex.values()]
    cache.set(gu, { at: Date.now(), markers: list })
    markers.push(...list)
  }

  // 화면 안의 것만
  const inView = markers.filter(
    (m) => m.lng >= bbox[0] && m.lng <= bbox[2] && m.lat >= bbox[1] && m.lat <= bbox[3],
  )

  return NextResponse.json({
    gus,
    total: inView.length,
    // 너무 많으면 라벨이 서로 덮는다. 최근 거래 순으로 잘라 보낸다.
    markers: inView.sort((a, b) => b.dealDate.localeCompare(a.dealDate)).slice(0, 300),
    // 0건이 진짜 0건인지, 공공데이터포털이 막은 건지 구분한다
    unavailable: lastMolitError(),
    _meta: {
      source: '국토교통부 아파트 매매 실거래 (최근 12개월)',
      note: '단지별 대표 평형 1건입니다. 전용 84㎡가 있으면 그것을, 없으면 거래가 가장 많은 평형을 씁니다.',
    },
  })
}
