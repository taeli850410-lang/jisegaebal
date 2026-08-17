/**
 * 경계 없는 사업장을 점(point) 구역으로 만든다.
 *
 * 왜 필요한가
 *   지도의 구역 경계는 서울시 의제처리구역(정비구역)이라 가로주택·소규모재건축·
 *   지역주택·리모델링 같은 소규모 사업은 아예 들어 있지 않다.
 *   벤치마크 화면의 강동구 카드가 전부 그 유형인데 우리는 하나도 못 보여줬다.
 *
 *   정비몽땅 사업장 1,146개 중 547개만 구역에 연결됐고, 나머지 599개는
 *   경계가 없을 뿐 지번·자치구·사업유형·진행단계를 다 갖고 있다.
 *   지번을 좌표로 바꿔 "경계 없는 구역"으로 세운다.
 *
 * 실행: node scripts/build-sites.mjs
 *   → data/sites.seoul.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
const KAKAO = process.env.KAKAO_REST_API_KEY
if (!KAKAO) {
  console.error('KAKAO_REST_API_KEY 필요')
  process.exit(1)
}

const OUT = 'data/sites.seoul.json'
const GEO = 'data/jibun-cache.json'

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8'))
const stages = JSON.parse(readFileSync('data/stages.seoul.json', 'utf-8'))
const geo = existsSync(GEO) ? JSON.parse(readFileSync(GEO, 'utf-8')) : {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 이미 구역에 연결된 사업장은 제외 — 경계가 있는 쪽이 더 정확하다 */
const matched = new Set(stages.map((s) => s.siteName))
const targets = sites.filter((s) => !matched.has(s.name) && s.gu && s.jibun)

console.log(`대상 ${targets.length}건 (전체 ${sites.length} 중 구역 연결 ${matched.size})`)

async function kakao(kind, query) {
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(400 * a)
    try {
      const r = await fetch(
        `https://dapi.kakao.com/v2/local/search/${kind}.json?query=${encodeURIComponent(query)}`,
        { headers: { Authorization: `KakaoAK ${KAKAO}` } },
      )
      if (r.status === 429 || r.status >= 500) continue
      if (!r.ok) return { ok: true, docs: [] }
      return { ok: true, docs: (await r.json()).documents ?? [] }
    } catch {
      /* 재시도 */
    }
  }
  return { ok: false }
}

/**
 * 지번을 좌표로. 정확도를 같이 돌려준다.
 *
 * 정비사업 지번은 이미 합병·멸실된 경우가 많아 주소검색이 그냥 0건을 준다.
 * (예: 강북구 미아동 75 — 주소·장소 모두 0건)
 * 단계를 내려가며 찾되, 얼마나 정확한지를 숨기지 않는다.
 *   lot  본지번 그대로 찾음
 *   near 부번을 떼거나 장소검색으로 같은 법정동 안에서 찾음 (수십~수백 m 오차)
 *   없으면 버린다 — 동 중심 같은 걸 갖다 붙이면 없는 위치를 지어내는 셈이다.
 */
async function geocode(gu, jibun) {
  const key = `서울 ${gu} ${jibun}`
  const cached = geo[key]
  if (cached) return { ok: true, pt: cached, precision: 'lot' }

  const a = await kakao('address', key)
  if (!a.ok) return { ok: false }
  if (a.docs[0]) {
    const pt = [Number(a.docs[0].x), Number(a.docs[0].y)]
    geo[key] = pt
    return { ok: true, pt, precision: 'lot' }
  }

  const dong = jibun.split(/\s+/)[0]

  // ① 부번을 떼고 본번만 — "656-3" 이 없어도 "656" 은 남아 있을 때가 있다
  if (jibun.includes('-')) {
    const b = await kakao('address', `서울 ${gu} ${jibun.split('-')[0]}`)
    if (!b.ok) return { ok: false }
    if (b.docs[0]) return { ok: true, pt: [Number(b.docs[0].x), Number(b.docs[0].y)], precision: 'near' }
  }

  // ② 장소검색 — 같은 법정동 안에 떨어질 때만 받는다
  const c = await kakao('keyword', key)
  if (!c.ok) return { ok: false }
  const hit = c.docs.find((d) => (d.address_name ?? '').includes(dong))
  if (hit) return { ok: true, pt: [Number(hit.x), Number(hit.y)], precision: 'near' }

  return { ok: true, pt: null }
}

/**
 * 정비몽땅 원본 사업유형 → taxonomy 의 사업종류 코드.
 *
 * 재건축만 한 코드로 안 떨어진다 — taxonomy 는 단독주택/아파트를 나눠 놨는데
 * 정비몽땅은 그냥 "재건축"이다. 사업장 이름으로 가른다.
 */
const BIZ_TO_TYPE = {
  '재개발(주택정비형)': 'redev',
  '재개발(도시정비형)': 'redev',
  가로주택정비: 'garo',
  소규모재건축: 'small_rebuild',
  소규모재개발: 'small_redev',
  지역주택: 'local_union',
  리모델링: 'remodel',
}

function typeOf(site) {
  if (site.bizType === '재건축') {
    return /아파트|맨션|(\(아\))|타운|파크|팰리스/.test(site.name) ? 'rebuild_apt' : 'rebuild_house'
  }
  return BIZ_TO_TYPE[site.bizType] ?? 'virtual'
}

const out = []
let done = 0
let missing = 0
let failed = 0

const C = 4
for (let i = 0; i < targets.length; i += C) {
  const slice = targets.slice(i, i + C)
  const res = await Promise.all(slice.map((s) => geocode(s.gu, s.jibun)))
  slice.forEach((s, k) => {
    done++
    if (!res[k].ok) {
      failed++
      return
    }
    if (!res[k].pt) {
      missing++
      return
    }
    const [lng, lat] = res[k].pt
    out.push({
      id: `site-${s.no ?? done}`,
      name: s.name,
      gu: s.gu,
      jibun: s.jibun,
      bizType: s.bizType,
      projectType: typeOf(s),
      stage: s.stage || null,
      wtnncSn: s.wtnncSn || null,
      cafeUrl: s.cafeUrl || null,
      center: [lng, lat],
      precision: res[k].precision,
    })
  })
  if (done % 100 === 0) console.log(`  ${done}/${targets.length} · 좌표 ${out.length}`)
  await sleep(80)
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(out))
writeFileSync(GEO, JSON.stringify(geo))

const byType = {}
for (const s of out) byType[s.bizType] = (byType[s.bizType] ?? 0) + 1
const near = out.filter((s) => s.precision === 'near').length
console.log(
  `\n완료: ${out.length}건 (본지번 ${out.length - near} · 근사 ${near} · 못 찾음 ${missing} · 실패 ${failed})`,
)
for (const [k, v] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${v}`)
}
