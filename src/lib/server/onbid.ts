/**
 * 온비드 공매 물건 (한국자산관리공사).
 *
 * 서비스: 차세대 온비드 부동산 물건목록 조회 (B010003/OnbidRlstListSrvc2)
 *
 * 필수 파라미터가 prptDivCd(재산유형) + pvctTrgtYn(수의계약 가능여부)인데
 * 안내 문서에만 있고 오류 응답은 알려주지 않는다. 없으면 그냥
 * NO_MANDATORY_REQUEST_PARAMETERS_ERROR 만 돌아온다. 찾는 데 한참 걸렸으니
 * 여기 적어 둔다.
 *
 * 재산유형은 하나씩만 넣을 수 있어 유형별로 나눠 부른다.
 * 전국 5만 건이라 지역 필터(lctnSdnm/lctnSggnm)를 반드시 건다.
 *
 * 법원경매는 공개 API 가 없다. 여기 있는 건 전부 공매다.
 */

const BASE = 'https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2'

/**
 * 재산유형. 전수 조사해서 실제로 물건이 있는 것만 남겼다.
 * 0001·0003·0006 은 부동산 목록에 물건이 없다.
 */
export const PROPERTY_TYPES = [
  { code: '0007', label: '압류재산' },
  { code: '0005', label: '국유재산' },
  { code: '0002', label: '수탁재산' },
  { code: '0008', label: '신탁재산' },
  { code: '0004', label: '유입자산' },
] as const

export interface AuctionItem {
  /** 물건관리번호 — 온비드 상세 링크 키 */
  cltrMngNo: string
  pbctCdtnNo: string
  name: string
  /** 재산유형 (압류재산·국유재산 등) */
  propertyType: string
  /** 처분방식 (매각·임대) */
  disposal: string
  /** 용도 — 부동산 > 토지 > 임야 */
  useCategory: string
  sido: string
  sigungu: string
  dong: string
  /** 지번 PNU — 구역 필지와 바로 맞출 수 있다 (지오코딩 불필요) */
  pnu: string | null
  /** 감정평가액 (원) */
  appraisal: number | null
  /** 최저입찰가 (원) */
  minBid: number | null
  /** 최저입찰가 / 감정가 — 몇 번 유찰됐는지가 여기 드러난다 */
  discountPct: number | null
  landM2: number | null
  buildingM2: number | null
  /** 입찰 시작·종료 (YYYY-MM-DD HH:mm) */
  bidStart: string | null
  bidEnd: string | null
  status: string
  /** 온비드 물건 상세 페이지 */
  href: string
}

const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** 202611301400 → 2026-11-30 14:00 */
function dtm(v: string | undefined): string | null {
  const s = String(v ?? '').trim()
  if (s.length < 8) return null
  const d = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return s.length >= 12 ? `${d} ${s.slice(8, 10)}:${s.slice(10, 12)}` : d
}

function tag(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))
  return m ? m[1].trim() : undefined
}

function parseItems(xml: string): AuctionItem[] {
  const out: AuctionItem[] = []
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1]
    const appraisal = num(tag(it, 'apslEvlAmt'))
    const minBid = num(tag(it, 'lowstBidPrcIndctCont'))
    const mngNo = tag(it, 'cltrMngNo') ?? ''
    out.push({
      cltrMngNo: mngNo,
      pbctCdtnNo: tag(it, 'pbctCdtnNo') ?? '',
      name: (tag(it, 'onbidCltrNm') ?? '').replace(/\s+/g, ' ').trim(),
      propertyType: tag(it, 'prptDivNm') ?? '',
      disposal: tag(it, 'dspsMthodNm') ?? '',
      useCategory: [
        tag(it, 'cltrUsgMclsCtgrNm'),
        tag(it, 'cltrUsgSclsCtgrNm'),
      ]
        .filter(Boolean)
        .join(' · '),
      sido: tag(it, 'lctnSdnm') ?? '',
      sigungu: tag(it, 'lctnSggnm') ?? '',
      dong: tag(it, 'lctnEmdNm') ?? '',
      pnu: tag(it, 'ltnoPnu') || null,
      appraisal,
      minBid,
      discountPct:
        appraisal && minBid ? Math.round((minBid / appraisal) * 100) : null,
      landM2: num(tag(it, 'landSqms')),
      buildingM2: num(tag(it, 'bldSqms')),
      bidStart: dtm(tag(it, 'cltrBidBgngDt')),
      bidEnd: dtm(tag(it, 'cltrBidEndDt')),
      status: tag(it, 'pbctStatNm') ?? '',
      href: `https://www.onbid.co.kr/op/cta/cltrdtl/collateralDetailMoveableAssetDetail.do?cltrHstrNo=&cltrNo=&plnmNo=&pbctNo=&scrnGrpCd=&pbctCdtnNo=${tag(it, 'pbctCdtnNo') ?? ''}`,
    })
  }
  return out
}

export function hasOnbid(): boolean {
  return !!process.env.DATA_GO_KR_SERVICE_KEY
}

let lastError: string | null = null
export function lastOnbidError(): string | null {
  return lastError
}

/**
 * 자치구 단위로 공매 물건을 모은다.
 *
 * 재산유형마다 따로 불러야 해서 유형 수만큼 왕복한다.
 * 초당 한도가 빡빡하므로 순차로 돌리고, 유형 하나가 비어도(코드 03)
 * 나머지는 그대로 살린다.
 */
export async function fetchAuctions(
  gu: string,
  opts: { sido?: string; limit?: number } = {},
): Promise<AuctionItem[]> {
  const key = process.env.DATA_GO_KR_SERVICE_KEY
  if (!key) {
    lastError = 'NO_KEY'
    return []
  }
  lastError = null
  const sido = opts.sido ?? '서울특별시'
  const limit = opts.limit ?? 100
  const out: AuctionItem[] = []

  for (const t of PROPERTY_TYPES) {
    const url =
      `${BASE}?serviceKey=${key}&numOfRows=${limit}&pageNo=1` +
      `&prptDivCd=${t.code}&pvctTrgtYn=N` +
      `&lctnSdnm=${encodeURIComponent(sido)}&lctnSggnm=${encodeURIComponent(gu)}`
    try {
      const r = await fetch(url, { cache: 'no-store' })
      const xml = await r.text()
      const code = tag(xml, 'resultCode') ?? tag(xml, 'errMsg')
      // 03 = 해당 유형에 물건 없음. 오류가 아니다.
      if (code && code !== '00' && code !== '03') {
        lastError = tag(xml, 'resultMsg') ?? tag(xml, 'errMsg') ?? code
        continue
      }
      out.push(...parseItems(xml))
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'FETCH_FAILED'
    }
    // 초당 요청 한도를 피한다
    await new Promise((r) => setTimeout(r, 350))
  }

  // 마감이 가까운 순 — 사용자가 먼저 봐야 할 건 곧 닫히는 물건이다
  return out.sort((a, b) => (a.bidEnd ?? '9999').localeCompare(b.bidEnd ?? '9999'))
}
