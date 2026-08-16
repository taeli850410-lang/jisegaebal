/**
 * 목업 구역 데이터 — 실제로는 PostGIS에서 bbox 쿼리로 내려온다.
 * (기획서 5.3: GET /api/v1/develops?bbox=...&include=pt_dots,...)
 *
 * 좌표는 동작구 사당동 일대. 실제 구역 경계가 아니라 렌더 검증용 근사 폴리곤이다.
 */

export interface DevelopStats {
  areaM2: number
  ownerCount: number
  ownerCountEstimated: boolean
  /** 노후도(30년 기준) 현재 / 5년 후 / 10년 후 */
  agingNow: number
  aging5y: number
  aging10y: number
  landPricePerPyeong: number // 대지평당가(원)
  listingCount: number
  auctionCount: number
  postCount: number
  rightsBaseDate: string
}

export interface Develop {
  id: number
  name: string
  projectType: string // taxonomy code
  stage: string // 정규화 단계 code
  stageRaw: string // 원본 단계 라벨 (표시용)
  stageDate: string
  /** [lng, lat][] — GeoJSON 순서를 유지하고 렌더 시점에 변환한다 */
  ring: [number, number][]
  stats: DevelopStats
}

/**
 * 중심점 기준으로 약간 불규칙한 폴리곤을 만든다.
 * seed를 고정해 렌더할 때마다 같은 모양이 나오도록 한다.
 */
function ring(
  centerLng: number,
  centerLat: number,
  radiusDeg: number,
  seed: number,
  points = 9,
): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    // 결정적 의사난수 — 0.75 ~ 1.25 배 사이로 반경을 흔든다
    const wobble = 0.75 + ((Math.sin(seed * 12.9898 + i * 78.233) + 1) / 2) * 0.5
    const r = radiusDeg * wobble
    out.push([
      centerLng + Math.cos(angle) * r * 1.28, // 위도 37도에서 경도 1도가 더 짧으므로 보정
      centerLat + Math.sin(angle) * r,
    ])
  }
  out.push(out[0]) // 폴리곤 닫기
  return out
}

export const DEVELOPS: Develop[] = [
  {
    id: 3692,
    name: '사당15',
    projectType: 'sintong',
    stage: 'site_selected',
    stageRaw: '대상지선정',
    stageDate: '2025-08-28',
    ring: ring(126.9750, 37.4795, 0.0035, 1),
    stats: {
      areaM2: 139545,
      ownerCount: 1823,
      ownerCountEstimated: true,
      agingNow: 67,
      aging5y: 70,
      aging10y: 79,
      landPricePerPyeong: 110_000_000,
      listingCount: 44,
      auctionCount: 0,
      postCount: 214,
      rightsBaseDate: '2025-07-30',
    },
  },
  {
    id: 3701,
    name: '사당21',
    projectType: 'sintong',
    stage: 'site_selected',
    stageRaw: '대상지선정',
    stageDate: '2025-08-28',
    ring: ring(126.9702, 37.4832, 0.0031, 2),
    stats: {
      areaM2: 114000,
      ownerCount: 1490,
      ownerCountEstimated: true,
      agingNow: 62,
      aging5y: 68,
      aging10y: 74,
      landPricePerPyeong: 130_000_000,
      listingCount: 22,
      auctionCount: 1,
      postCount: 88,
      rightsBaseDate: '2025-07-30',
    },
  },
  {
    id: 4210,
    name: '(가)사당동 419',
    projectType: 'private_urban',
    stage: 'prepare',
    stageRaw: '추진준비',
    stageDate: '2026-02-11',
    ring: ring(126.9805, 37.4768, 0.0024, 3),
    stats: {
      areaM2: 55000,
      ownerCount: 720,
      ownerCountEstimated: true,
      agingNow: 47,
      aging5y: 55,
      aging10y: 63,
      landPricePerPyeong: 87_760_000,
      listingCount: 32,
      auctionCount: 2,
      postCount: 41,
      rightsBaseDate: '2026-01-15',
    },
  },
  {
    id: 3695,
    name: '사당16',
    projectType: 'sintong',
    stage: 'site_selected',
    stageRaw: '대상지선정',
    stageDate: '2025-08-28',
    ring: ring(126.9788, 37.4855, 0.0021, 4),
    stats: {
      areaM2: 42000,
      ownerCount: 560,
      ownerCountEstimated: true,
      agingNow: 67,
      aging5y: 72,
      aging10y: 80,
      landPricePerPyeong: 71_390_000,
      listingCount: 6,
      auctionCount: 0,
      postCount: 19,
      rightsBaseDate: '2025-07-30',
    },
  },
  {
    id: 5102,
    name: '(가)동작남성역',
    projectType: 'local_union',
    stage: 'prepare',
    stageRaw: '조합원모집신고',
    stageDate: '2026-04-02',
    ring: ring(126.9838, 37.4812, 0.0016, 5),
    stats: {
      areaM2: 23000,
      ownerCount: 310,
      ownerCountEstimated: true,
      agingNow: 75,
      aging5y: 79,
      aging10y: 85,
      landPricePerPyeong: 67_560_000,
      listingCount: 6,
      auctionCount: 0,
      postCount: 12,
      rightsBaseDate: '2026-03-01',
    },
  },
  {
    id: 5330,
    name: '사당동 300',
    projectType: 'moa',
    stage: 'numbering',
    stageRaw: '연번부여',
    stageDate: '2026-05-20',
    ring: ring(126.9692, 37.4758, 0.0020, 6),
    stats: {
      areaM2: 40000,
      ownerCount: 480,
      ownerCountEstimated: true,
      agingNow: 55,
      aging5y: 61,
      aging10y: 70,
      landPricePerPyeong: 75_140_000,
      listingCount: 13,
      auctionCount: 3,
      postCount: 27,
      rightsBaseDate: '2026-04-30',
    },
  },
  {
    id: 5401,
    name: '방배동 946 가로주택',
    projectType: 'garo',
    stage: 'union',
    stageRaw: '조합설립인가',
    stageDate: '2025-11-14',
    ring: ring(126.9880, 37.4870, 0.0013, 7),
    stats: {
      areaM2: 12000,
      ownerCount: 140,
      ownerCountEstimated: false,
      agingNow: 81,
      aging5y: 86,
      aging10y: 90,
      landPricePerPyeong: 96_200_000,
      listingCount: 4,
      auctionCount: 1,
      postCount: 8,
      rightsBaseDate: '2025-10-01',
    },
  },
]

/** 실거래 도트 목업 — include=pt_dots 로 함께 내려오는 데이터 */
export interface TransactionDot {
  id: string
  developId: number
  lng: number
  lat: number
  type: '다세대' | '단독' | '토지'
  price: number // 원
  landSharePyeong: number
  dealDate: string
}

export const TRANSACTION_DOTS: TransactionDot[] = DEVELOPS.flatMap((d) => {
  // 각 구역 내부에 결정적으로 흩뿌린다
  const center = d.ring[0]
  const count = Math.min(30, Math.max(6, Math.round(d.stats.listingCount * 0.8)))
  const types: TransactionDot['type'][] = ['다세대', '단독', '토지']

  return Array.from({ length: count }, (_, i) => {
    const a = Math.sin(d.id * 3.1 + i * 7.7)
    const b = Math.cos(d.id * 1.7 + i * 4.3)
    const type = types[i % 3]
    const landShare = 6 + ((i * 37) % 24)
    return {
      id: `${d.id}-${i}`,
      developId: d.id,
      lng: center[0] + a * 0.0022,
      lat: center[1] + b * 0.0018,
      type,
      price: Math.round(landShare * d.stats.landPricePerPyeong * (0.8 + ((i % 5) * 0.1))),
      landSharePyeong: landShare,
      dealDate: `2026-0${(i % 8) + 1}-1${i % 9}`,
    }
  })
})
