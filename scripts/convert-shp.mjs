/**
 * 서울시 의제처리구역 SHP → 정비구역 GeoJSON 변환
 *
 * 원본: 서울 열린데이터광장 「서울시 의제처리구역 위치정보」(UPIS_C_UQ181)
 * 좌표계: EPSG:5174 (Korean 1985 중부원점, Bessel 1841) → WGS84(EPSG:4326)
 *
 * 실행: node scripts/convert-shp.mjs
 */
import * as shapefile from 'shapefile'
import proj4 from 'proj4'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'data/raw/uq181/shp파일/UPIS_C_UQ181'
// 서버가 런타임에 fs로 읽는다 (번들에 5MB를 밀어넣지 않기 위해)
const OUT = 'data/develops.seoul.json'

// 중부원점(보정) — towgs84 파라미터가 없으면 수백 m 어긋난다
const EPSG5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 ' +
  '+ellps=bessel +units=m +no_defs ' +
  '+towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342'
const toWgs84 = proj4(EPSG5174, proj4.WGS84)

/** 레이어표_181.xlsx 코드표 기준 — 소분류/속성코드 → 우리 사업종류 */
const CODE_TO_TYPE = {
  UQ1211: 'redev', // 주거환경개선사업
  UQ1212: 'redev', // 주거환경관리사업
  UQ1210: 'redev',
  UQ1221: 'redev', // 주택재개발(주택정비형 재개발)
  UQ1231: 'redev',
  UQ1222: 'redev', // 도시환경정비(도시정비형 재개발)
  UQ1232: 'redev',
  UQ1220: 'redev',
  UQ1230: 'redev',
  UQ1240: 'rebuild_apt', // 재건축사업구역
  UQ1206: 'rebuild_apt', // 주택재건축사업
  UQ1250: 'redev', // 결합정비구역
  UQ1260: 'small_rebuild', // 자율주택정비사업
  UQ1270: 'garo', // 가로주택정비사업
  UQ1280: 'small_rebuild', // 소규모재건축사업
  UQ1290: 'redev', // 정비구역(도시및주거환경정비)
}

/** 화면 표시용 원본 라벨 */
const CODE_TO_LABEL = {
  UQ1211: '주거환경개선사업',
  UQ1212: '주거환경관리사업',
  UQ1210: '주거환경개선사업구역',
  UQ1221: '주택정비형 재개발',
  UQ1231: '주택정비형 재개발지구',
  UQ1222: '도시정비형 재개발',
  UQ1232: '도시정비형 재개발지구',
  UQ1220: '재개발사업구역',
  UQ1230: '재개발사업지구',
  UQ1240: '재건축사업구역',
  UQ1206: '주택재건축사업',
  UQ1250: '결합정비구역',
  UQ1260: '자율주택정비사업',
  UQ1270: '가로주택정비사업',
  UQ1280: '소규모재건축사업',
  UQ1290: '정비구역',
}

const round6 = (n) => Math.round(n * 1e6) / 1e6

function project(coords) {
  if (typeof coords[0] === 'number') {
    const [x, y] = toWgs84.forward(coords)
    return [round6(x), round6(y)]
  }
  return coords.map(project)
}

/** 링 좌표에서 중복/미세 좌표를 걷어내 payload를 줄인다 */
function dedupeRing(ring) {
  const out = []
  for (const p of ring) {
    const prev = out[out.length - 1]
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p)
  }
  return out.length >= 4 ? out : ring
}

function cleanGeometry(geom) {
  if (geom.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geom.coordinates.map(dedupeRing) }
  }
  if (geom.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geom.coordinates.map((poly) => poly.map(dedupeRing)),
    }
  }
  return geom
}

function bboxOfGeometry(geom) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minLng) minLng = c[0]
      if (c[0] > maxLng) maxLng = c[0]
      if (c[1] < minLat) minLat = c[1]
      if (c[1] > maxLat) maxLat = c[1]
      return
    }
    c.forEach(walk)
  }
  walk(geom.coordinates)
  return [minLng, minLat, maxLng, maxLat]
}

const source = await shapefile.open(`${BASE}.shp`, `${BASE}.dbf`, { encoding: 'euc-kr' })

const develops = []
const skipped = new Map()
const badCoords = []
let total = 0

while (true) {
  const { done, value } = await source.read()
  if (done) break
  total++

  const p = value.properties
  // 대분류 UQ1200 = 정비구역
  if (p.LCLAS_CL !== 'UQ1200') {
    skipped.set(p.LCLAS_CL, (skipped.get(p.LCLAS_CL) ?? 0) + 1)
    continue
  }
  if (!value.geometry) continue

  // 소분류 → 속성코드 → 중분류 순으로 유형을 결정한다
  const code =
    CODE_TO_TYPE[p.SCLAS_CL] ? p.SCLAS_CL
    : CODE_TO_TYPE[p.ATRB_SE] ? p.ATRB_SE
    : CODE_TO_TYPE[p.MLSFC_CL] ? p.MLSFC_CL
    : null

  const geometry = cleanGeometry({
    type: value.geometry.type,
    coordinates: project(value.geometry.coordinates),
  })

  const bbox = bboxOfGeometry(geometry)

  // 원본에 좌표가 깨진 피처가 섞여 있다(경도 99 등). 서울 범위를 벗어나면 버린다.
  if (bbox[0] < 126.5 || bbox[2] > 127.3 || bbox[1] < 37.3 || bbox[3] > 37.8) {
    badCoords.push(`${p.DGM_NM} (${bbox.map((v) => v.toFixed(3)).join(',')})`)
    continue
  }

  develops.push({
    id: p.PRESENT_SN,
    name: (p.DGM_NM ?? '이름없음').trim(),
    projectType: code ? CODE_TO_TYPE[code] : 'redev',
    rawLabel: code ? CODE_TO_LABEL[code] : '정비구역',
    classCode: p.SCLAS_CL ?? p.ATRB_SE ?? p.MLSFC_CL,
    areaM2: Math.round(p.DGM_AR ?? 0),
    /** 고시 일련번호 — 고시/공고 아카이브와 연결하는 키 */
    noticeSn: p.NTFC_SN ?? null,
    /**
     * 안건 일련번호. 정비몽땅 사업장검색의 mapOpenPopup(wtnncSn) 인자와 같은 체계라
     * 이름·좌표 매칭 없이 사업장과 정확히 연결할 수 있는 유일한 키다.
     */
    wtnncSn: p.WTNNC_SN ?? null,
    sigungu: p.SIGNGU_SE ?? null,
    bbox,
    geometry,
  })
}

/**
 * PRESENT_SN(도형번호)은 유일하지 않다. 하나의 구역이 여러 폴리곤 조각으로
 * 나뉘어 별도 피처로 저장돼 있기 때문이다. 같은 번호끼리 MultiPolygon으로 합친다.
 * (합치지 않으면 목록에 같은 구역이 중복으로 나오고, React key 충돌로 렌더가 깨진다)
 */
function mergeByPresentSn(list) {
  const groups = new Map()
  for (const d of list) {
    const g = groups.get(d.id)
    if (!g) {
      groups.set(d.id, d)
      continue
    }
    const toParts = (geom) =>
      geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
    g.geometry = {
      type: 'MultiPolygon',
      coordinates: [...toParts(g.geometry), ...toParts(d.geometry)],
    }
    g.areaM2 += d.areaM2
    // 조각마다 안건번호가 비어 있을 수 있어 하나라도 있으면 살린다
    g.wtnncSn = g.wtnncSn ?? d.wtnncSn
    g.bbox = [
      Math.min(g.bbox[0], d.bbox[0]),
      Math.min(g.bbox[1], d.bbox[1]),
      Math.max(g.bbox[2], d.bbox[2]),
      Math.max(g.bbox[3], d.bbox[3]),
    ]
  }
  return [...groups.values()]
}

const beforeMerge = develops.length
const mergedDevelops = mergeByPresentSn(develops)

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(mergedDevelops))

const byType = new Map()
for (const d of mergedDevelops) byType.set(d.rawLabel, (byType.get(d.rawLabel) ?? 0) + 1)

console.log(`전체 피처 ${total.toLocaleString()}개 중 정비구역 ${beforeMerge.toLocaleString()}개 추출`)
console.log(
  `도형번호 병합: ${beforeMerge.toLocaleString()} → ${mergedDevelops.length.toLocaleString()}개 구역`,
)
console.log(`출력: ${OUT}`)
console.log('\n--- 유형별 ---')
for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${v.toString().padStart(6)}  ${k}`)
}
if (badCoords.length) {
  console.log(`\n--- 좌표 이상으로 제외 (${badCoords.length}건) ---`)
  badCoords.slice(0, 10).forEach((s) => console.log('   ' + s))
}

console.log('\n--- 제외된 대분류 ---')
for (const [k, v] of [...skipped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`${v.toString().padStart(6)}  ${k}`)
}
