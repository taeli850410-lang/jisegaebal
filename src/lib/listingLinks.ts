/**
 * 매물 딥링크.
 *
 * 우리는 중개 매물 호가를 저장하지 않는다. 대신 사용자를 그 매물이 실제로
 * 올라와 있는 곳으로 가장 짧게 데려간다. 링크를 만드는 건 복제가 아니라서
 * 남의 데이터베이스를 건드리지 않는다 — 우리 서버는 그 사이트에 접속조차
 * 하지 않고, 클릭한 사용자의 브라우저가 이동할 뿐이다.
 *
 * 왜 여러 곳인가
 *   한 곳에 걸면 그쪽이 주소 형식을 바꾸는 순간 링크가 죽는다.
 *   그리고 재개발 물건(빌라·단독)은 플랫폼마다 물량이 다르다.
 *
 * 왜 검색형인가
 *   내부 API 를 흉내 내는 주소는 언제든 깨지고, 흉내 내는 것 자체가
 *   정당한 접근이 아니다. 사람이 검색창에 넣는 것과 같은 공개 경로만 쓴다.
 *   형식이 바뀌어도 최악이 "그 사이트 검색 화면"이라 사용자를 잃지 않는다.
 */

/**
 * 네이버 부동산 매물종류 코드.
 * 재개발 구역에서 사고파는 건 대개 빌라(다세대·연립)와 단독·다가구다.
 * 아파트를 섞으면 재건축 단지 매물이 목록을 덮는다.
 */
export const NAVER_REDEV_TYPES = ['VL', 'DDDGG', 'JGB', 'JGC'] as const

export interface LinkTarget {
  /** 화면에 쓰는 이름 */
  label: string
  /** 왜 이 곳인지 — 툴팁 */
  note: string
  href: string
}

const enc = encodeURIComponent

/** 지번 하나를 여러 곳에서 찾아보는 링크 */
export function parcelLinks(gu: string, dong: string, jibun: string): LinkTarget[] {
  const addr = `서울 ${gu} ${dong} ${jibun}`.replace(/\s+/g, ' ').trim()
  return [
    {
      label: '네이버 부동산',
      note: '이 지번의 매물 — 재개발 구역 물량이 가장 많습니다',
      href: `https://new.land.naver.com/search?sk=${enc(addr)}`,
    },
    {
      label: '디스코',
      note: '지번 단위 실거래·등기·건축물 정보',
      href: `https://www.disco.re/?q=${enc(addr)}`,
    },
    {
      label: '밸류맵',
      note: '토지·단독주택 거래에 강합니다',
      href: `https://www.valueupmap.com/?search=${enc(addr)}`,
    },
  ]
}

/**
 * 구역 일대를 지도로 여는 링크.
 *
 * 카드를 하나씩 눌러 지번마다 확인하는 건 품이 너무 든다.
 * 구역 중심 좌표로 지도를 열면 그 일대 매물이 한 화면에 뜬다.
 */
export function zoneLinks(
  zoneName: string,
  center: [number, number] | null,
  gu: string | null,
): LinkTarget[] {
  const out: LinkTarget[] = []
  if (center) {
    const [lng, lat] = center
    /*
     * ms=위도,경도,줌 · a=매물종류 · e=RETAIL(매매)
     * 파라미터가 바뀌어도 최악이 기본 지도 화면이라 사용자를 잃지 않는다.
     */
    out.push({
      label: '네이버 지도에서 이 구역 매물',
      note: `빌라·단독·재개발·재건축만 — ${zoneName} 일대`,
      href:
        `https://new.land.naver.com/houses?ms=${lat.toFixed(6)},${lng.toFixed(6)},16` +
        `&a=${NAVER_REDEV_TYPES.join(':')}&e=RETAIL`,
    })
  }
  out.push({
    label: '네이버에서 구역명으로 검색',
    note: '중개사가 구역명을 적어 올린 매물이 잡힙니다',
    href: `https://new.land.naver.com/search?sk=${enc(zoneName)}`,
  })
  if (gu) {
    out.push({
      label: `${gu} 공인중개사 찾기`,
      note: '이 지역 매물을 실제로 갖고 있는 곳 — 직접 물어보는 게 가장 빠릅니다',
      href: `https://map.naver.com/p/search/${enc(`${gu} 공인중개사`)}`,
    })
  }
  return out
}

/**
 * 구역명에서 검색에 쓸 짧은 이름을 뽑는다.
 * "장위15구역 주택재개발정비사업" → "장위15구역"
 * 긴 법정 명칭 그대로 넣으면 검색이 0건 난다.
 */
export function searchName(zoneName: string): string {
  const name = zoneName.trim()
  /*
   * 앞쪽에 나오는 첫 "구역/지구"까지가 사람들이 부르는 이름이다.
   *   장위15구역 주택재개발정비사업        → 장위15구역
   *   서계 통합구역 주택정비형 재개발구역   → 서계 통합구역
   *   천호2구역주택재개발사업              → 천호2구역
   * 뒤쪽 "재개발구역"까지 끌고 가면 검색이 0건 난다.
   * 앞 12자 안에서만 찾는다 — "주택재개발사업구역"처럼 이름 자체가
   * 긴 경우까지 잘라내면 오히려 뜻이 사라진다.
   */
  const i = name.search(/(구역|지구)/)
  if (i >= 0 && i <= 12) return name.slice(0, i + 2).trim()
  return name.replace(/(주택재개발|주택재건축|도시환경|주거환경|재정비촉진)?정비사업.*$/, '').trim() || name
}
