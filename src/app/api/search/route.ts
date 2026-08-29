import { NextResponse } from 'next/server'
import { getAllDevelops } from '@/lib/server/developStore'
import { cacheHeaders } from '@/lib/server/cacheHeaders'

export const dynamic = 'force-dynamic'

/**
 * 통합검색 — 구역 + 장소(지하철역·아파트·주소)
 *
 * GET /api/search?q=서울역
 *
 * 구역은 우리 DB에서, 지하철역·아파트·주소는 카카오 로컬 API에서 가져온다.
 * (지하철·단지 데이터를 따로 구축하지 않고 카카오 검색을 그대로 활용)
 */

export interface ZoneHit {
  kind: 'zone'
  id: string
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  gu: string | null
  bbox: [number, number, number, number]
}

export interface PlaceHit {
  kind: 'place'
  id: string
  name: string
  /** 지하철역 / 아파트 / 주소 등 분류 라벨 */
  category: string
  detail: string
  lng: number
  lat: number
}

/** 검색어를 얼마나 잘 맞췄는지 — 앞에서 일치할수록 먼저 보여준다 */
function score(name: string, q: string): number {
  const i = name.indexOf(q)
  if (i < 0) return -1
  return 1000 - i * 10 - name.length
}

async function kakaoSearch(path: string, params: string): Promise<any[]> {
  const key = process.env.KAKAO_REST_API_KEY
  if (!key) return []
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?${params}`, {
      headers: { Authorization: `KakaoAK ${key}` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const json = await res.json()
    return json.documents ?? []
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get('q') ?? '').trim()
  if (q.length < 1) return NextResponse.json({ zones: [], places: [] })

  /* ── 구역 ── */
  const zones: ZoneHit[] = getAllDevelops()
    .map((d) => ({ d, s: Math.max(score(d.name, q), score(`${d.dong ?? ''}`, q) - 200) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
    .map(({ d }) => ({
      kind: 'zone' as const,
      id: d.id,
      name: d.name,
      projectType: d.projectType,
      stage: d.stage ?? null,
      canonicalStage: d.canonicalStage ?? null,
      gu: d.gu ?? null,
      bbox: d.bbox,
    }))

  /* ── 장소: 지하철역 우선, 그다음 일반 키워드 ── */
  const enc = encodeURIComponent(q)
  const [subways, keywords, addresses] = await Promise.all([
    kakaoSearch('keyword', `query=${enc}&category_group_code=SW8&size=4`),
    kakaoSearch('keyword', `query=${enc}&size=6`),
    kakaoSearch('address', `query=${enc}&size=3`),
  ])

  const places: PlaceHit[] = []
  const seen = new Set<string>()

  const push = (p: PlaceHit) => {
    const key = `${p.name}|${p.lng.toFixed(5)}`
    if (seen.has(key)) return
    seen.add(key)
    places.push(p)
  }

  for (const s of subways) {
    push({
      kind: 'place',
      id: `sw-${s.id}`,
      name: s.place_name,
      category: '지하철역',
      // 카카오는 "수도권1호선,경부선" 형태로 노선을 넘겨준다
      detail: (s.category_name ?? '').split('>').pop()?.trim() || s.address_name,
      lng: Number(s.x),
      lat: Number(s.y),
    })
  }

  for (const k of keywords) {
    if (k.category_group_code === 'SW8') continue
    push({
      kind: 'place',
      id: `kw-${k.id}`,
      name: k.place_name,
      category: k.category_group_name || '장소',
      detail: k.road_address_name || k.address_name,
      lng: Number(k.x),
      lat: Number(k.y),
    })
  }

  for (const a of addresses) {
    push({
      kind: 'place',
      id: `ad-${a.address_name}`,
      name: a.address_name,
      category: '주소',
      detail: a.road_address?.address_name ?? '',
      lng: Number(a.x),
      lat: Number(a.y),
    })
  }

  return NextResponse.json({ zones, places: places.slice(0, 8) }, { headers: cacheHeaders('hourly') })
}
