/**
 * 권리산정기준일 도출.
 *
 * 도정법 원칙은 "정비구역 지정 고시일"이다. 우리는 고시 일련번호에서 뽑은
 * 고시일을 1,600개 구역(95%)에 갖고 있으므로, 그 원칙이 적용되는 구역은
 * 계산해서 보여줄 수 있다.
 *
 * 다만 그대로 쓰면 안 되는 구역이 있다.
 * 신속통합기획·공공재개발·모아타운·도심공공복합·역세권 장기전세처럼 공모로
 * 뽑힌 곳은 투기를 막으려고 기준일을 "후보지 선정일"로 앞당겨 고시한다.
 * 그 날짜는 서울시 공모 공고문에 있고 우리 데이터에는 없다.
 *
 * 그래서 이 모듈은 값을 만들어내는 게 아니라 세 가지를 가른다.
 *   notice     원칙 적용 — 고시일을 기준일로 제시한다 (확인 링크와 함께)
 *   candidate  후보지 선정일이 따로 있다 — 값을 내지 않고 어디서 보는지 알린다
 *   unknown    고시일조차 없다
 *
 * 어느 쪽이든 "고시문 원문으로 확인하라"는 안내를 함께 낸다. 분양권 여부가
 * 갈리는 날짜라 우리 추정만 믿고 판단하면 안 된다.
 */

export type RightsBasis = 'notice' | 'candidate' | 'unknown'

export interface RightsDate {
  basis: RightsBasis
  /** basis==='notice' 일 때만 채워진다 (YYYY-MM-DD) */
  date: string | null
  /** 화면에 그대로 쓰는 한 줄 설명 */
  note: string
}

/**
 * 후보지 선정일이 별도로 적용되는 사업 유형.
 * 구역명·원본 라벨에 이 말이 들어가면 원칙을 적용하지 않는다.
 */
const CANDIDATE_RE =
  /신속통합|신통기획|모아타운|모아주택|공공재개발|도심공공|공공주택복합|역세권\s*활성화|장기전세/

export function resolveRightsDate(input: {
  name: string
  rawLabel?: string | null
  projectType?: string | null
  noticeDate?: string | null
}): RightsDate {
  const hay = `${input.name} ${input.rawLabel ?? ''}`
  if (CANDIDATE_RE.test(hay) || input.projectType === 'sintong' || input.projectType === 'moa') {
    return {
      basis: 'candidate',
      date: null,
      note: '공모로 선정된 사업이라 후보지 선정일이 기준일로 앞당겨 적용됩니다. 서울시 공모 선정 공고문에서 확인하세요.',
    }
  }
  if (input.noticeDate) {
    return {
      basis: 'notice',
      date: input.noticeDate,
      note: '도정법 원칙에 따라 정비구역 지정 고시일을 기준일로 봅니다. 고시문 본문에 별도 기준일이 명시된 경우 그쪽이 우선합니다.',
    }
  }
  return {
    basis: 'unknown',
    date: null,
    note: '이 구역은 고시일 정보가 없습니다. 자치구 고시·공고에서 원문을 확인하세요.',
  }
}

/** 자치구 이름 → 고시·공고 게시판 주소 */
const GU_NOTICE: Record<string, string> = {
  종로구: 'https://www.jongno.go.kr/portal/bbs/list.do?key=2432',
  중구: 'https://www.junggu.seoul.kr/content.do?cmsid=14186',
  용산구: 'https://www.yongsan.go.kr/portal/bbs/B0000002/list.do?menuNo=200233',
  성동구: 'https://www.sd.go.kr/main/selectBbsNttList.do?bbsNo=192&key=1922',
  광진구: 'https://www.gwangjin.go.kr/portal/bbs/B0000005/list.do?menuNo=200147',
  동대문구: 'https://www.ddm.go.kr/www/selectBbsNttList.do?bbsNo=6&key=1834',
  중랑구: 'https://www.jungnang.go.kr/portal/bbs/list/B0000002.do?menuNo=200168',
  성북구: 'https://www.sb.go.kr/main/selectBbsNttList.do?bbsNo=25&key=1364',
  강북구: 'https://www.gangbuk.go.kr/portal/bbs/B0000003/list.do?menuNo=200136',
  도봉구: 'https://www.dobong.go.kr/bbs.do?bbsId=BBSMSTR_000000000012',
  노원구: 'https://www.nowon.kr/www/selectBbsNttList.do?bbsNo=8&key=2313',
  은평구: 'https://www.ep.go.kr/www/selectBbsNttList.do?bbsNo=71&key=1216',
  서대문구: 'https://www.sdm.go.kr/news/notice/gosi.do',
  마포구: 'https://www.mapo.go.kr/site/main/board/gosi/list',
  양천구: 'https://www.yangcheon.go.kr/site/yangcheon/ex/bbs/List.do?cbIdx=254',
  강서구: 'https://www.gangseo.seoul.kr/gs040101',
  구로구: 'https://www.guro.go.kr/www/selectBbsNttList.do?bbsNo=6&key=1846',
  금천구: 'https://www.geumcheon.go.kr/portal/bbs/B0000002/list.do?menuNo=200234',
  영등포구: 'https://www.ydp.go.kr/www/selectBbsNttList.do?bbsNo=574&key=2582',
  동작구: 'https://www.dongjak.go.kr/portal/bbs/B0000178/list.do?menuNo=200425',
  관악구: 'https://www.gwanak.go.kr/site/gwanak/ex/bbs/List.do?cbIdx=1046',
  서초구: 'https://www.seocho.go.kr/site/seocho/ex/bbs/List.do?cbIdx=125',
  강남구: 'https://www.gangnam.go.kr/notice/list.do?mid=ID05_040201',
  송파구: 'https://www.songpa.go.kr/www/selectBbsNttList.do?bbsNo=224&key=2851',
  강동구: 'https://www.gangdong.go.kr/web/newportal/bbs/b_312',
}

/** 확인용 바깥 링크 — 우리 값이 아니라 원문으로 데려간다 */
export function verifyLinks(zoneName: string, gu: string | null, jibun?: string | null) {
  const q = encodeURIComponent(zoneName)
  const links: { label: string; note: string; href: string }[] = []

  if (gu && GU_NOTICE[gu]) {
    links.push({
      label: `${gu} 고시·공고`,
      note: '구역명으로 검색 — 고시문 본문에 기준일이 있습니다',
      href: GU_NOTICE[gu],
    })
  }
  links.push({
    label: '서울시 고시·공고',
    note: '시 단위 고시 (재정비촉진지구·도시정비형 등)',
    href: `https://www.seoul.go.kr/news/news_notice.do#list/1/cntPerPage=20&srchType=title&srchWord=${q}`,
  })
  links.push({
    label: '서울특별시보',
    note: '고시문 원문 PDF',
    href: 'https://www.seoul.go.kr/story/gazette/gazetteList.do',
  })
  links.push({
    label: '토지이음',
    note: jibun
      ? `${jibun} 토지이용계획확인서 — 정비구역 지정 여부·고시번호`
      : '지번 입력 후 토지이용계획확인서에서 고시번호 확인',
    href: 'https://www.eum.go.kr/web/ar/lu/luLandDet.jsp',
  })
  return links
}
