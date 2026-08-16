export type Ring = [number, number][] // [lng, lat][]

export function centroid(ring: Ring): [number, number] {
  let x = 0
  let y = 0
  const n = ring.length - 1 // 마지막 점은 첫 점과 동일
  for (let i = 0; i < n; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  return [x / n, y / n]
}

export function bboxOf(ring: Ring): [number, number, number, number] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** ray casting */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 노후도 색상 — 사용승인 경과연수 기준 (30년 이상 = 노후) */
export function agingColor(approvalYear: number, baseYear = 2026): string {
  const age = baseYear - approvalYear
  if (age >= 40) return '#7F1D1D'
  if (age >= 30) return '#DC2626'
  if (age >= 20) return '#F97316'
  if (age >= 10) return '#FACC15'
  return '#22C55E'
}

export function formatKrwEok(won: number): string {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(eok >= 10 ? 0 : 1)}억`
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

/** CustomOverlay는 HTML 문자열을 그대로 삽입하므로 값은 반드시 이스케이프한다 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 지도 라벨용 짧은 구역명.
 * 원본은 "상도14구역 주택정비형 재개발구역"처럼 사업 유형이 이름에 붙어 있는데,
 * 유형은 위쪽 배지에서 이미 보여주므로 라벨에서는 걷어낸다.
 */
const NAME_SUFFIXES = [
  '아파트 재건축정비사업',
  '관리형 주거환경개선사업',
  '재건축정비사업',
  '재개발정비사업',
  '정비형 재개발',
  '정비사업조합',
  '정비사업',
  '재정비촉진구역',
  '재정비촉진지구',
  '주택정비형 재개발구역',
  '도시정비형 재개발구역',
  '주택정비형 재개발',
  '도시정비형 재개발',
  '주택재개발사업구역',
  '주택재개발사업',
  '도시환경정비사업구역',
  '도시환경정비사업',
  '주거환경관리사업구역',
  '주거환경관리사업',
  '주거환경개선사업구역',
  '주거환경개선사업',
  '재건축사업구역',
  '주택재건축사업',
  '가로주택정비사업',
  '소규모재건축사업',
  '일대',
  '일원',
  '구역',
  '지구',
  '사업',
]

/**
 * 반드시 긴 접미어부터 검사해야 한다.
 * "적선3구역도시환경정비사업"에서 짧은 '정비사업'이 먼저 잘리면
 * '도시환경'이 남아 "적선3구역도시환경"이 되어버린다.
 */
const SORTED_SUFFIXES = [...NAME_SUFFIXES].sort((a, b) => b.length - a.length)

export function shortName(name: string, max = 12): string {
  let s = name
    .trim()
    // 자치구명은 상세 패널에서 따로 보여주므로 라벨에서는 뺀다
    .replace(/^[가-힣]{1,3}(구|시)\s+/, '')
    // "주택재개발사업(북아현1-3구역)"처럼 유형이 앞에 붙고 실제 이름이 괄호 안인 경우
    .replace(
      /^(주택재개발사업|도시환경정비사업|주택재건축사업|재건축사업|재개발사업)\s*\(([^)]+)\)\s*$/,
      '$2',
    )

  let changed = true
  while (changed) {
    changed = false
    for (const suf of SORTED_SUFFIXES) {
      if (s.length > suf.length && s.endsWith(suf)) {
        s = s.slice(0, -suf.length).trim()
        changed = true
        break // 자르면 처음부터 다시 — 다시 긴 것부터 본다
      }
    }
  }

  // 원본 이름 자체가 "재건축사업구역"처럼 일반명사인 구역이 있다(고유명이 없음).
  // 이런 경우까지 잘라내면 "재건축" 같은 무의미한 라벨이 되므로 원본을 쓴다.
  const GENERIC = new Set([
    '재건축',
    '재개발',
    '도시환경',
    '주거환경',
    '정비',
    '주택',
    '주택재개발',
    '도시정비형',
    '주택정비형',
  ])
  if (!s || s.length < 2 || GENERIC.has(s)) s = name.trim()

  return s.length > max ? `${s.slice(0, max)}…` : s
}

/**
 * 라벨을 붙일 구역 내부 점.
 *
 * bbox 중심을 쓰면 ㄱ자·ㄷ자 구역이나 여러 조각으로 나뉜 구역에서
 * 그 점이 구역 바깥으로 떨어진다(서울 1,690개 중 111개). 그러면 라벨이
 * 엉뚱한 빈 땅에 떠서 어느 구역 것인지 읽을 수 없다.
 *
 * 가장 큰 링을 골라 무게중심을 쓰되, 그 점이 링 밖이면
 * 무게중심의 위도선을 링과 교차시켜 가장 긴 내부 구간의 중점을 쓴다.
 */
export function labelPoint(rings: number[][][]): [number, number] | null {
  let best: number[][] | null = null
  let bestArea = -1
  for (const ring of rings) {
    const a = Math.abs(signedArea(ring))
    if (a > bestArea) {
      bestArea = a
      best = ring
    }
  }
  if (!best || best.length < 3) return null

  const c = areaCentroid(best)
  if (pointInRing(c[0], c[1], best as Ring)) return c

  // 무게중심이 밖이다 — 같은 위도에서 가장 넓은 내부 구간을 찾는다
  const xs: number[] = []
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const [xi, yi] = best[i]
    const [xj, yj] = best[j]
    if (yi > c[1] !== yj > c[1]) xs.push(((xj - xi) * (c[1] - yi)) / (yj - yi) + xi)
  }
  xs.sort((a, b) => a - b)
  let span = -1
  let x = c[0]
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const w = xs[i + 1] - xs[i]
    if (w > span) {
      span = w
      x = (xs[i] + xs[i + 1]) / 2
    }
  }
  return span > 0 ? [x, c[1]] : c
}

function signedArea(ring: number[][]): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return s / 2
}

/**
 * 면적 가중 무게중심.
 *
 * 위의 centroid()는 꼭짓점 평균이라 경계가 촘촘한 쪽으로 끌려간다.
 * 라벨 자리는 도형의 실제 중심이어야 하므로 여기서는 면적으로 가중한다.
 */
function areaCentroid(ring: number[][]): [number, number] {
  let x = 0
  let y = 0
  let a = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += f
    x += (ring[j][0] + ring[i][0]) * f
    y += (ring[j][1] + ring[i][1]) * f
  }
  if (!a) return [ring[0][0], ring[0][1]]
  return [x / (3 * a), y / (3 * a)]
}

export function formatPerPyeong(won: number): string {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(1)}억/평`
  return `${Math.round(won / 10_000).toLocaleString()}만/평`
}
