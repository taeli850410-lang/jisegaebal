/**
 * 정비몽땅 사업장 목록 → 구역별 진행단계 매핑
 *
 * 원본: 서울시 정비사업 정보몽땅(cleanup.seoul.go.kr) 사업장검색 엑셀 내려받기
 * 문제: SHP(구역 경계)와 정비몽땅(진행단계) 사이에 공통 ID가 없다.
 * 해법: 대표지번을 지오코딩해 좌표를 얻고, 그 점을 포함하는 구역 폴리곤을 찾는다(공간조인).
 *       지오코딩이 실패하면 사업장명 유사도로 폴백한다.
 *
 * 실행: node scripts/build-stages.mjs
 */
import XLSX from 'xlsx'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const XLS = 'data/raw/cleanup_사업장목록.xls'
const DEVELOPS = 'data/develops.seoul.json'
const CACHE = 'data/raw/geocode-cache.json'
const OUT = 'data/stages.seoul.json'

const REST_KEY = process.env.KAKAO_REST_API_KEY
if (!REST_KEY) {
  console.error('KAKAO_REST_API_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

/* ─────────── 1. 사업장 목록 ─────────── */
// 엑셀에는 안건번호(wtnncSn)가 없어 HTML 수집본을 쓴다 (scripts/fetch-cleanup-sites.mjs)
const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8')).filter(
  (s) => s.gu && s.name,
)
console.log(`사업장 ${sites.length}건 (안건번호 ${sites.filter((s) => s.wtnncSn).length}건)`)

/* ─────────── 2. 지오코딩 (캐시) ─────────── */
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf-8')) : {}
let apiCalls = 0

async function kakao(path, query) {
  const url = `https://dapi.kakao.com/v2/local/search/${path}.json?query=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${REST_KEY}` } })
  apiCalls++
  if (!res.ok) return null
  const json = await res.json()
  const d = json.documents?.[0]
  return d ? [Number(d.x), Number(d.y)] : null
}

/** "개포동 138, 140 일대" 처럼 여러 지번이 붙어 있으면 첫 번째만 쓴다 */
function firstJibun(jibun) {
  return jibun
    .replace(/일대|일원|번지/g, ' ')
    .split(/[,·]/)[0]
    .trim()
}

async function geocode(site) {
  const key = `${site.gu}|${site.jibun}|${site.name}`
  if (key in cache) return cache[key]

  const jibun = firstJibun(site.jibun)
  const attempts = [
    ['address', `서울 ${site.gu} ${jibun}`],
    ['keyword', `서울 ${site.gu} ${jibun}`],
    ['keyword', site.name.replace(/정비사업.*$|조합.*$/g, '').trim()],
  ]

  for (const [path, q] of attempts) {
    if (!q || q.length < 4) continue
    try {
      const hit = await kakao(path, q)
      if (hit) {
        cache[key] = hit
        return hit
      }
    } catch {
      /* 계속 */
    }
  }
  cache[key] = null
  return null
}

/* ─────────── 3. 공간조인 ─────────── */
const develops = JSON.parse(readFileSync(DEVELOPS, 'utf-8'))

function outerRings(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0])
}

function pointInRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function findByPoint([lng, lat]) {
  const candidates = develops.filter(
    (d) => lng >= d.bbox[0] && lng <= d.bbox[2] && lat >= d.bbox[1] && lat <= d.bbox[3],
  )
  const containing = candidates.filter((d) => outerRings(d.geometry).some((r) => pointInRing(lng, lat, r)))
  if (!containing.length) return null
  // 여러 구역이 겹치면 가장 작은 구역이 더 구체적인 사업장이다
  return containing.sort((a, b) => a.areaM2 - b.areaM2)[0]
}

/**
 * 대표지번이 구역 경계 "바로 바깥"에 찍히는 경우가 많다.
 * (대표지번이 구역 가장자리이거나, 지오코딩이 인접 건물 POI로 잡히는 경우)
 * 그래서 포함 판정이 실패하면 일정 반경 안의 가장 가까운 구역으로 폴백한다.
 */
/**
 * 200m까지 허용하면 "반포미도1차 구역"에 "삼호가든5차 사업장"이 붙는 식의
 * 오연결이 생긴다. 반경을 좁히고, 그보다 멀면 이름이 겹칠 때만 인정한다.
 */
const NEAR_STRICT_DEG = 0.00045 // 약 50m — 이름 확인 없이 인정
const NEAR_LIMIT_DEG = 0.0018 // 약 200m — 이름이 겹칠 때만 인정

function distToRing(lng, lat, ring) {
  let min = Infinity
  for (const [x, y] of ring) {
    const dx = (x - lng) * 0.79 // 위도 37도 경도 보정
    const dy = y - lat
    const d = dx * dx + dy * dy
    if (d < min) min = d
  }
  return Math.sqrt(min)
}

function findNearest([lng, lat]) {
  let best = null
  let bestD = NEAR_LIMIT_DEG
  for (const d of develops) {
    if (
      lng < d.bbox[0] - NEAR_LIMIT_DEG || lng > d.bbox[2] + NEAR_LIMIT_DEG ||
      lat < d.bbox[1] - NEAR_LIMIT_DEG || lat > d.bbox[3] + NEAR_LIMIT_DEG
    ) continue
    for (const ring of outerRings(d.geometry)) {
      const dist = distToRing(lng, lat, ring)
      if (dist < bestD) {
        bestD = dist
        best = d
      }
    }
  }
  return best ? { zone: best, dist: bestD } : null
}

/** 두 이름이 2글자 이상 공통 토막을 공유하는가 (아파트명·동명 등) */
function namesOverlap(a, b) {
  const x = normalizeName(a)
  const y = normalizeName(b)
  if (x.length < 2 || y.length < 2) return false
  if (x.includes(y) || y.includes(x)) return true
  for (let i = 0; i <= x.length - 3; i++) {
    if (y.includes(x.slice(i, i + 3))) return true
  }
  return false
}

/** 이름 정규화 — 접미어를 걷어내고 핵심 토큰만 남긴다 */
function normalizeName(s) {
  return s
    .replace(/정비사업|재정비촉진|주택재개발|도시환경정비|주택재건축|재개발|재건축|가로주택|소규모/g, '')
    .replace(/조합|추진위원회|사업|구역|지구|일대|\(.*?\)/g, '')
    .replace(/\s+/g, '')
    .trim()
}

const nameIndex = new Map()
for (const d of develops) {
  const k = normalizeName(d.name)
  if (k.length >= 2 && !nameIndex.has(k)) nameIndex.set(k, d)
}

/* ─────────── 4. 실행 ─────────── */
/**
 * 안건번호(wtnncSn) 색인.
 * 이게 있으면 이름·좌표 추정 없이 확정 연결이 되므로 가장 먼저 본다.
 */
const byWtnnc = new Map()
for (const d of develops) {
  if (d.wtnncSn && !byWtnnc.has(d.wtnncSn)) byWtnnc.set(d.wtnncSn, d)
}

const out = []
const stats = { id: 0, point: 0, name: 0, 'name~': 0, near: 0, none: 0, geocodeFail: 0 }

for (let i = 0; i < sites.length; i++) {
  const site = sites[i]

  // ① 안건번호 정확 조인 — 지오코딩조차 필요 없다
  if (site.wtnncSn && byWtnnc.has(site.wtnncSn)) {
    const hit = byWtnnc.get(site.wtnncSn)
    stats.id++
    out.push({
      developId: hit.id,
      developName: hit.name,
      siteName: site.name,
      gu: site.gu,
      jibun: site.jibun,
      bizType: site.bizType,
      stage: site.stage,
      opStage: '',
      matchBy: 'id',
      lng: null,
      lat: null,
    })
    continue
  }

  const pt = await geocode(site)
  if (!pt) stats.geocodeFail++

  let hit = pt ? findByPoint(pt) : null
  let matchBy = hit ? 'point' : null

  if (!hit) {
    const k = normalizeName(site.name)
    if (k.length >= 2 && nameIndex.has(k)) {
      hit = nameIndex.get(k)
      matchBy = 'name'
    }
  }

  // 정규화 이름이 정확히 일치하지 않아도 한쪽이 다른 쪽을 포함하면 같은 사업지로 본다
  if (!hit) {
    const k = normalizeName(site.name)
    if (k.length >= 3) {
      for (const [nk, nd] of nameIndex) {
        if (nk.length >= 3 && (nk.includes(k) || k.includes(nk))) {
          hit = nd
          matchBy = 'name~'
          break
        }
      }
    }
  }

  if (!hit && pt) {
    const near = findNearest(pt)
    // 아주 가깝거나(≈50m 이내), 멀더라도 이름이 겹칠 때만 인정한다
    if (near && (near.dist <= NEAR_STRICT_DEG || namesOverlap(site.name, near.zone.name))) {
      hit = near.zone
      matchBy = 'near'
    }
  }

  if (hit) {
    stats[matchBy]++
    out.push({
      developId: hit.id,
      developName: hit.name,
      siteName: site.name,
      gu: site.gu,
      jibun: site.jibun,
      bizType: site.bizType,
      stage: site.stage,
      opStage: '',
      matchBy,
      lng: pt?.[0] ?? null,
      lat: pt?.[1] ?? null,
    })
  } else {
    stats.none++
  }

  if ((i + 1) % 100 === 0) {
    console.log(`  ${i + 1}/${sites.length} 처리 (API ${apiCalls}회)`)
    mkdirSync('data/raw', { recursive: true })
    writeFileSync(CACHE, JSON.stringify(cache))
  }
}

mkdirSync('data/raw', { recursive: true })
writeFileSync(CACHE, JSON.stringify(cache))

// 한 구역에 여러 사업장이 매칭되면 진행이 앞선 것을 남긴다
const ORDER = [
  '정비계획 수립', '안전진단', '정비구역지정', '추진위원회승인', '조합설립인가',
  '사업시행인가', '관리처분인가', '철거', '착공', '분양', '준공인가',
  '이전고시', '조합해산', '조합청산',
]
const byDevelop = new Map()
for (const r of out) {
  const prev = byDevelop.get(r.developId)
  if (!prev || ORDER.indexOf(r.stage) > ORDER.indexOf(prev.stage)) byDevelop.set(r.developId, r)
}

const merged = [...byDevelop.values()]
writeFileSync(OUT, JSON.stringify(merged))

console.log(`\n지오코딩 API 호출 ${apiCalls}회 (캐시 적중분 제외)`)
console.log(`지오코딩 실패 ${stats.geocodeFail}건`)
console.log(
  `매칭: 안건번호 ${stats.id} / 포함 ${stats.point} / 근접 ${stats.near} / ` +
    `이름일치 ${stats.name} / 이름부분 ${stats['name~']} / 실패 ${stats.none}`,
)
console.log(`매칭률 ${(((sites.length - stats.none) / sites.length) * 100).toFixed(1)}%`)
console.log(`구역 기준 중복 정리 후 ${merged.length}개 구역에 진행단계 부여`)
console.log(`출력: ${OUT}`)

const byStage = new Map()
for (const m of merged) byStage.set(m.stage, (byStage.get(m.stage) ?? 0) + 1)
console.log('\n--- 진행단계 분포 ---')
for (const [k, v] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(v).padStart(5)}  ${k}`)
}
