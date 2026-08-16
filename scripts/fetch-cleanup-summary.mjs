/**
 * 정비몽땅 사업개요 수집 — 구역 제원(면적·소유자수·용적률·공급세대)의 원천.
 *
 * 경로: cafeUrl → mainIndx.do 에서 cafeId 추출 → 사업개요 페이지 파싱
 * 고시문 HWP 파싱 없이 서버 HTML 로 받을 수 있어 훨씬 안정적이다.
 *
 * 실행: node scripts/fetch-cleanup-summary.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const SITES = 'data/cleanup-sites.json'
const OUT = 'data/cleanup-summary.json'
const BASE = 'https://cleanup.seoul.go.kr'

const sites = JSON.parse(readFileSync(SITES, 'utf-8')).filter((s) => s.cafeUrl)
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

console.log(`대상 ${sites.length}건 / 기존 수집 ${Object.keys(cache).length}건`)

const clean = (s) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** HTML → 테이블 > 행 > 셀 */
function parseTables(html) {
  return [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((t) =>
    [...t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => clean(c[1])),
    ),
  )
}

const num = (s) => {
  if (!s) return null
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}

/** 라벨 바로 뒤 셀을 값으로 읽는다 (정비사업개요는 라벨/값 교차 배치) */
function pairValue(tables, label) {
  for (const rows of tables) {
    for (const cells of rows) {
      for (let i = 0; i < cells.length - 1; i++) {
        if (cells[i].replace(/\s/g, '').startsWith(label.replace(/\s/g, ''))) {
          const v = cells[i + 1]
          if (v) return v
        }
      }
    }
  }
  // 라벨과 값이 다른 행에 있는 경우(토지등 소유자 수)
  for (const rows of tables) {
    for (let r = 0; r < rows.length - 1; r++) {
      const idx = rows[r].findIndex((c) => c.replace(/\s/g, '').startsWith(label.replace(/\s/g, '')))
      if (idx >= 0 && rows[r + 1][idx]) return rows[r + 1][idx]
    }
  }
  return null
}

/** 헤더행 + 데이터행 구조에서 헤더 이름으로 값을 꺼낸다 (건축계획 등) */
function headerValue(tables, headerLabel, valueLabel) {
  for (const rows of tables) {
    const hIdx = rows.findIndex((cells) => cells.some((c) => c.includes(headerLabel)))
    if (hIdx < 0) continue
    const header = rows[hIdx]
    const col = header.findIndex((c) => c.includes(valueLabel))
    if (col < 0) continue
    for (let r = hIdx + 1; r < rows.length; r++) {
      const v = rows[r][col]
      if (v) return v
    }
  }
  return null
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(String(res.status))
  return res.text()
}

async function collect(site) {
  const main = await get(`${BASE}/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(site.cafeUrl)}`)
  const cafeId = main.match(/cafeId=([A-Z0-9]+)/)?.[1]
  if (!cafeId) return null

  // 사업개요 링크의 stepSeCode 를 그대로 쓴다 (단계마다 값이 다르다)
  const step = main.match(/bsnsSumry\/execute\.do\?cafeId=[A-Z0-9]+&(?:amp;)?stepSeCode=(\d+)/)?.[1] ?? '102'

  const html = await get(
    `${BASE}/cafe/mastr-cleanup-bsnsSumry/execute.do?cafeId=${cafeId}&stepSeCode=${step}&div=sumry`,
  )
  const tables = parseTables(html)

  return {
    cafeId,
    zoneName: pairValue(tables, '정비구역 명칭'),
    bizKind: pairValue(tables, '사업구분'),
    address: pairValue(tables, '정비구역 위치'),
    areaM2: num(pairValue(tables, '정비구역 면적')),
    memberCount: num(pairValue(tables, '조합원 수')),
    landOwnerCount: num(pairValue(tables, '토지등 소유자 수')),
    tenantCount: num(pairValue(tables, '세입자 수')),
    useZone: pairValue(tables, '용도지역'),
    useDistrict: pairValue(tables, '용도지구'),
    // 건축계획
    siteAreaM2: num(headerValue(tables, '건폐율', '대지면적')),
    buildingAreaM2: num(headerValue(tables, '건폐율', '건축면적')),
    totalFloorAreaM2: num(headerValue(tables, '건폐율', '연면적')),
    bcr: num(headerValue(tables, '건폐율', '건폐율')),
    far: num(headerValue(tables, '건폐율', '용적률')),
    floors: headerValue(tables, '건폐율', '층수'),
    // 토지이용계획
    landUseHousing: num(headerValue(tables, '정비기반시설', '택지')),
    landUseRoad: num(headerValue(tables, '정비기반시설', '도로')),
    landUsePark: num(headerValue(tables, '정비기반시설', '공원')),
    landUseGreen: num(headerValue(tables, '정비기반시설', '녹지')),
    fetchedAt: new Date().toISOString().slice(0, 10),
  }
}

const CONCURRENCY = 6
let done = 0
let ok = 0
let fail = 0

const todo = sites.filter((s) => !(s.cafeUrl in cache))
console.log(`신규 수집 ${todo.length}건`)

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const slice = todo.slice(i, i + CONCURRENCY)
  await Promise.all(
    slice.map(async (s) => {
      try {
        const r = await collect(s)
        cache[s.cafeUrl] = r
        if (r?.areaM2 || r?.landOwnerCount || r?.far) ok++
        else fail++
      } catch {
        cache[s.cafeUrl] = null
        fail++
      }
      done++
    }),
  )
  if (i % 60 === 0) {
    mkdirSync('data', { recursive: true })
    writeFileSync(OUT, JSON.stringify(cache))
    console.log(`  ${done}/${todo.length} (유효 ${ok} / 실패 ${fail})`)
  }
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(cache))

const vals = Object.values(cache).filter(Boolean)
const has = (k) => vals.filter((v) => v[k] != null && v[k] !== '').length
console.log(`\n완료: ${Object.keys(cache).length}건 수집`)
console.log(`면적 ${has('areaM2')} / 토지등소유자 ${has('landOwnerCount')} / 조합원 ${has('memberCount')}`)
console.log(`용적률 ${has('far')} / 건폐율 ${has('bcr')} / 용도지역 ${has('useZone')} / 층수 ${has('floors')}`)
