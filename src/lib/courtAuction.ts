/**
 * 법원경매 안내.
 *
 * 물건 목록을 실을 수 없다. 공개 API 가 없고, 공공데이터포털의 통계 4종은
 * 전부 연계데이터라 금융빅데이터플랫폼 별도 가입이 필요한데 그 플랫폼마저
 * 이관 중이다. 네이버·사설 경매포털 크롤링은 약관 위반이고 형사 판례도 있다.
 *
 * 그래서 데이터를 지어내는 대신, 사용자를 원문으로 가장 짧게 데려간다.
 * 부동산 경매는 관할 법원이 정해져 있어(민사집행법 제79조 — 부동산 소재지
 * 지방법원 전속관할) 자치구만 알면 어느 법원인지 확정된다.
 * 그 한 가지가 실제로 사람이 헷갈리는 지점이라 값어치가 있다.
 */

export interface Court {
  name: string
  /** 법원경매정보 사이트의 법원 코드 */
  code: string
  gus: string[]
  tel: string
}

/** 서울 25개 자치구의 경매 관할 법원 (5개 지방법원) */
export const SEOUL_COURTS: Court[] = [
  {
    name: '서울중앙지방법원',
    code: 'B000210',
    gus: ['종로구', '중구', '강남구', '서초구', '관악구', '동작구'],
    tel: '02-530-1114',
  },
  {
    name: '서울동부지방법원',
    code: 'B000211',
    gus: ['성동구', '광진구', '강동구', '송파구'],
    tel: '02-2204-2114',
  },
  {
    name: '서울남부지방법원',
    code: 'B000212',
    gus: ['영등포구', '강서구', '양천구', '구로구', '금천구'],
    tel: '02-2192-1114',
  },
  {
    name: '서울북부지방법원',
    code: 'B000213',
    gus: ['동대문구', '중랑구', '성북구', '도봉구', '강북구', '노원구'],
    tel: '02-910-3114',
  },
  {
    name: '서울서부지방법원',
    code: 'B000215',
    gus: ['서대문구', '마포구', '은평구', '용산구'],
    tel: '02-3271-1114',
  },
]

const BY_GU = new Map<string, Court>()
for (const c of SEOUL_COURTS) for (const g of c.gus) BY_GU.set(g, c)

export function courtOf(gu: string | null | undefined): Court | null {
  return gu ? (BY_GU.get(gu) ?? null) : null
}

/** 법원경매정보 물건상세검색 */
export const SEARCH_URL =
  'https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ151F00.xml'

/** 법원경매정보 경매사건검색 (사건번호를 알 때) */
export const CASE_URL =
  'https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml'

/** 매각기일이 임박한 물건 — 첫 화면의 금주 매각기일 */
export const WEEK_URL = 'https://www.courtauction.go.kr/pgj/index.on'
