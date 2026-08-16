import { NextResponse } from 'next/server'
import { SEOUL_LAWD } from '@/lib/server/lawdCodes'

export const dynamic = 'force-dynamic'

/**
 * 국토교통부 실거래가 조회.
 *
 * GET /api/transactions?gu=마포구&months=3&types=villa,house,land
 *
 * 정비구역 투자자가 실제로 보는 지표는 "대지평당가"다.
 * 연립다세대 API는 landAr(대지권면적)을 함께 주기 때문에 대지지분을 바로 계산할 수 있다.
 * 단독/다가구는 대지면적(plottageAr), 토지는 거래면적(dealArea)을 쓴다.
 */

const PYEONG = 3.3058

type Kind = 'villa' | 'house' | 'land'

const ENDPOINTS: Record<Kind, { url: string; label: string }> = {
  villa: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
    label: '다세대',
  },
  house: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade',
    label: '단독',
  },
  land: {
    url: 'https://apis.data.go.kr/1613000/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
    label: '토지',
  },
}

export interface Transaction {
  kind: Kind
  typeLabel: string
  dealDate: string
  price: number // 원
  dong: string
  jibun: string
  buildingName: string | null
  floor: number | null
  buildYear: number | null
  exclusiveAr: number | null // ㎡
  landAr: number | null // ㎡ (대지지분/대지면적)
  landPyeong: number | null
  pricePerLandPyeong: number | null
  pricePerExclusivePyeong: number | null
  isDirect: boolean
}

/** 평평한 XML에서 태그 값 뽑기 — 응답 구조가 단순해 파서를 따로 두지 않는다 */
function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  const v = m?.[1]?.trim()
  return v && v.length ? v : null
}

function num(v: string | null): number | null {
  if (!v) return null
  const n = Number(v.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function parseItems(xml: string, kind: Kind): Transaction[] {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? []

  return blocks.flatMap((b) => {
    const amountManwon = num(pick(b, 'dealAmount'))
    const y = num(pick(b, 'dealYear'))
    const mo = num(pick(b, 'dealMonth'))
    const d = num(pick(b, 'dealDay'))
    if (amountManwon == null || y == null || mo == null || d == null) return []

    const price = amountManwon * 10_000
    const exclusiveAr = num(pick(b, 'excluUseAr'))

    // 유형마다 면적 필드 이름이 다르다
    const landAr =
      kind === 'villa'
        ? num(pick(b, 'landAr'))
        : kind === 'house'
          ? num(pick(b, 'plottageAr'))
          : num(pick(b, 'dealArea'))

    const landPyeong = landAr ? landAr / PYEONG : null
    const exclPyeong = exclusiveAr ? exclusiveAr / PYEONG : null

    return [
      {
        kind,
        typeLabel: ENDPOINTS[kind].label,
        dealDate: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        price,
        dong: pick(b, 'umdNm') ?? '',
        jibun: pick(b, 'jibun') ?? '',
        buildingName: pick(b, 'mhouseNm') ?? pick(b, 'houseType') ?? null,
        floor: num(pick(b, 'floor')),
        buildYear: num(pick(b, 'buildYear')),
        exclusiveAr,
        landAr,
        landPyeong: landPyeong ? Math.round(landPyeong * 100) / 100 : null,
        pricePerLandPyeong: landPyeong ? Math.round(price / landPyeong) : null,
        pricePerExclusivePyeong: exclPyeong ? Math.round(price / exclPyeong) : null,
        isDirect: (pick(b, 'dealingGbn') ?? '').includes('직거래'),
      },
    ]
  })
}

/** 같은 조회를 반복하지 않도록 짧게 캐시한다 (공공 API 쿼터 절약) */
const cache = new Map<string, { at: number; data: Transaction[] }>()
const TTL = 1000 * 60 * 30

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const gu = searchParams.get('gu') ?? ''
  const months = Math.min(12, Math.max(1, Number(searchParams.get('months') ?? 3) || 3))
  const kinds = (searchParams.get('types')?.split(',').filter(Boolean) ?? [
    'villa',
    'house',
    'land',
  ]) as Kind[]

  const lawd = SEOUL_LAWD[gu]
  if (!lawd) {
    return NextResponse.json(
      { error: '서울 자치구 이름이 필요합니다.', supported: Object.keys(SEOUL_LAWD) },
      { status: 400 },
    )
  }

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY
  if (!serviceKey) {
    return NextResponse.json(
      { error: 'DATA_GO_KR_SERVICE_KEY 가 설정되지 않았습니다.', code: 'NO_KEY' },
      { status: 503 },
    )
  }

  const key = `${gu}|${months}|${kinds.join(',')}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json({ gu, months, count: hit.data.length, items: hit.data, cached: true })
  }

  // 최근 N개월치 조회 (오늘 기준)
  const now = new Date()
  const ymList: string[] = []
  for (let i = 0; i < months; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    ymList.push(`${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}`)
  }

  const jobs: Promise<Transaction[]>[] = []
  for (const kind of kinds) {
    if (!ENDPOINTS[kind]) continue
    for (const ym of ymList) {
      const url =
        `${ENDPOINTS[kind].url}?serviceKey=${serviceKey}` +
        `&LAWD_CD=${lawd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1`
      jobs.push(
        fetch(url, { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : ''))
          .then((xml) => (xml ? parseItems(xml, kind) : []))
          .catch(() => []),
      )
    }
  }

  const items = (await Promise.all(jobs)).flat().sort((a, b) => b.dealDate.localeCompare(a.dealDate))

  cache.set(key, { at: Date.now(), data: items })

  return NextResponse.json({
    gu,
    months,
    count: items.length,
    items,
    _meta: {
      source: '국토교통부 실거래가 공개시스템 (공공데이터포털)',
      grade: 'A',
      note: '대지평당가·전용평당가는 신고 면적으로 계산한 값입니다.',
    },
  })
}
