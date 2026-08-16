/**
 * 정비몽땅 사업개요의 "계획" 표들 수집.
 *
 * 기존 fetch-cleanup-summary.mjs 는 면적·소유자·용적률만 읽었다.
 * 같은 페이지에 공급계획·공동이용시설·개량계획·시행시기가 표로 더 있고,
 * 찾아오시는길에 추진 주체 주소·전화가 있다. 벤치마크가 보여주는 항목이
 * 대부분 여기서 나온다.
 *
 * 실행: node scripts/fetch-cleanup-plan.mjs [--limit 400]
 *   → data/cleanup-plan.json  (cafeUrl → 계획 정보)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const BASE = 'https://cleanup.seoul.go.kr'
const UA = { 'User-Agent': 'Mozilla/5.0' }
const OUT = 'data/cleanup-plan.json'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const LIMIT = Number(arg('--limit', '400'))

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8')).filter((s) => s.cafeUrl)
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const get = async (u) => {
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(600 * a)
    try {
      const r = await fetch(u, { headers: UA })
      if (r.ok) return await r.text()
    } catch {
      /* 재시도 */
    }
  }
  return ''
}
const clean = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
const num = (v) => {
  const m = String(v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

/** 표를 caption 으로 찾아 행렬로 돌려준다 */
function tablesOf(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((t) => ({
    caption: clean(t[1].match(/<caption[^>]*>([\s\S]*?)<\/caption>/)?.[1] ?? ''),
    rows: [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => clean(c[1])),
    ),
  }))
}
const findTable = (tables, ...keys) =>
  tables.find((t) => keys.every((k) => t.caption.replace(/\s/g, '').includes(k.replace(/\s/g, ''))))

/**
 * 주택공급계획 표.
 *   1행: 대지면적 | 건축면적 | 연면적 | 동수 | 전용면적별 세대수 | 비고
 *   2행: 계 | 60㎡이하 | 60㎡초과~85㎡이하 | 85㎡초과      ← 구간 이름
 *   3행: (앞 4칸 제원) 이후가 구간별 세대수
 * 구간 이름 개수만큼 뒤에서부터 잘라 붙인다 — 앞쪽 빈 칸 수가 구역마다 달라서다.
 */
function supplyPlan(table) {
  if (!table || table.rows.length < 3) return null
  const buckets = table.rows[1].filter(Boolean)
  const values = table.rows[2]
  if (!buckets.length) return null
  const tail = values.slice(Math.max(0, values.length - buckets.length - 1))
  const out = []
  for (let i = 0; i < buckets.length; i++) {
    const n = num(tail[i])
    if (n != null) out.push({ label: buckets[i], households: n })
  }
  // "계" 칸이 비어 있는 구역이 많아 직접 합산한다
  const listed = out.find((x) => x.label === '계')?.households ?? null
  const parts = out.filter((x) => x.label !== '계')
  const total = listed ?? (parts.length ? parts.reduce((s, x) => s + x.households, 0) : null)
  return { total, byArea: parts }
}

let done = 0
const targets = sites.filter((s) => !(s.cafeUrl in cache)).slice(0, LIMIT)
console.log(`대상 ${targets.length}건 (기존 ${Object.keys(cache).length}건)`)

for (const [i, site] of targets.entries()) {
  const main = await get(`${BASE}/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(site.cafeUrl)}`)
  const cafeId = main.match(/cafeId=([A-Z0-9]+)/)?.[1]
  if (!cafeId) {
    cache[site.cafeUrl] = null
    continue
  }
  const step =
    main.match(/bsnsSumry\/execute\.do\?cafeId=[A-Z0-9]+&(?:amp;)?stepSeCode=(\d+)/)?.[1] ?? '102'

  const html = await get(
    `${BASE}/cafe/mastr-cleanup-bsnsSumry/execute.do?cafeId=${cafeId}&stepSeCode=${step}&div=sumry`,
  )
  if (!html) {
    cache[site.cafeUrl] = null
    continue
  }
  const tables = tablesOf(html)

  /* 건축계획 — 최고높이·층수는 사업개요 표에만 있다 */
  const arch = findTable(tables, '건축계획')
  const archRow = arch?.rows?.[1] ?? []
  const archHead = arch?.rows?.[0] ?? []
  const pick = (label) => {
    const i = archHead.findIndex((h) => h.replace(/\s/g, '').startsWith(label))
    return i >= 0 ? archRow[i] : null
  }

  /* 공동이용시설 */
  const fac = findTable(tables, '공동이용')
  const facilities = (fac?.rows ?? [])
    .slice(1)
    .map((r) => ({ label: r[0], areaM2: num(r[2]) }))
    .filter((f) => f.label && f.areaM2)

  /* 기존 건축물 개량계획 */
  const impr = findTable(tables, '기존', '개량')
  const imprRow = impr?.rows?.[2] ?? []
  const improvement = impr
    ? {
        total: num(imprRow[0]),
        keep: num(imprRow[1]),
        repair: num(imprRow[2]),
        rebuild: num(imprRow[3]),
      }
    : null

  /* 시행 예정시기 */
  const sched = findTable(tables, '예정시기')
  const schedule = sched?.rows?.[0]?.[1] ?? null

  /* 추진 주체 — 찾아오시는길 */
  const adi = await get(`${BASE}/cafe/cleanup-asscinfo/vscrAsscAdi.do?cafeId=${cafeId}`)
  const at = clean(adi)
  // 국번을 아무거나 허용하면 사업자번호·우편번호가 전화로 잡힌다(06-1419-2232 같은 것).
  // 실재하는 지역번호·이동통신 국번만 받는다.
  const phoneRe = /\b(02|0(?:3[1-3]|4[1-4]|5[1-5]|6[1-4])|070|010)[-)\s]?(\d{3,4})[-\s]?(\d{4})\b/
  const pm = at.match(phoneRe)
  const office = {
    address: at.match(/서울특별시[^|]{5,60}?(?=\s*(전화|팩스|$))/)?.[0]?.trim() ?? null,
    phone: pm ? `${pm[1]}-${pm[2]}-${pm[3]}` : null,
  }

  cache[site.cafeUrl] = {
    cafeId,
    supplySale: supplyPlan(findTable(tables, '주택공급계획', '분양')),
    supplyRent: supplyPlan(findTable(tables, '주택공급계획', '임대')),
    maxHeightM: num(pick('최고높이')),
    floors: pick('층수'),
    mainUse: archRow[0] ?? null,
    facilities,
    improvement,
    schedule,
    office: office.address || office.phone ? office : null,
  }
  done++

  if (done % 10 === 0 || i === targets.length - 1) {
    mkdirSync('data', { recursive: true })
    writeFileSync(OUT, JSON.stringify(cache))
    const c = cache[site.cafeUrl]
    console.log(
      `  [${i + 1}/${targets.length}] ${site.name?.slice(0, 24)} — ` +
        `분양 ${c.supplySale?.total ?? '—'} · 임대 ${c.supplyRent?.total ?? '—'} · ` +
        `시설 ${c.facilities.length} · 연락처 ${c.office?.phone ?? '—'}`,
    )
  }
  await sleep(120)
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(cache))
const withSupply = Object.values(cache).filter((v) => v?.supplySale?.total).length
const withOffice = Object.values(cache).filter((v) => v?.office?.phone).length
console.log(
  `\n완료: ${Object.keys(cache).length}건 / 공급계획 ${withSupply} · 연락처 ${withOffice}`,
)
