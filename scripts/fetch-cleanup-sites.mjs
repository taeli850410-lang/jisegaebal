/**
 * 정비몽땅 사업장 목록 수집 (HTML)
 *
 * 엑셀 내려받기에는 안건번호(wtnncSn)가 없다.
 * 목록 HTML의 mapOpenPopup('...') 인자에만 들어 있어서 HTML을 직접 파싱한다.
 * 이 값이 SHP의 WTNNC_SN 과 같은 체계라 구역과 정확히 연결할 수 있다.
 *
 * 실행: node scripts/fetch-cleanup-sites.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs'

const URL_LIST =
  'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do?cpage=1&pageSize=2000'
const OUT = 'data/cleanup-sites.json'

const html = await (await fetch(URL_LIST)).text()
console.log(`HTML ${Math.round(html.length / 1024)}KB 수신`)

const strip = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1])

const sites = []
for (const row of rows) {
  const tds = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]))
  // 번호 자치구 사업구분 사업장명 대표지번 진행단계 공개자료수 공개적시성 자료충실도 이동
  if (tds.length < 6) continue
  if (!/^\d+$/.test(tds[0])) continue

  const wtnnc = row.match(/mapOpenPopup\('([^']+)'\)/)?.[1] ?? null
  const cafe = row.match(/cafeOpenPopup\('([^']+)'\)/)?.[1] ?? null

  sites.push({
    no: Number(tds[0]),
    gu: tds[1],
    bizType: tds[2],
    name: tds[3],
    jibun: tds[4],
    stage: tds[5],
    wtnncSn: wtnnc,
    cafeUrl: cafe,
  })
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(sites))

const withCode = sites.filter((s) => s.wtnncSn).length
console.log(`사업장 ${sites.length}건 / 안건번호 보유 ${withCode}건 (${((withCode / sites.length) * 100).toFixed(1)}%)`)
console.log(`출력: ${OUT}`)

const byStage = new Map()
for (const s of sites) byStage.set(s.stage, (byStage.get(s.stage) ?? 0) + 1)
console.log('\n--- 진행단계 원본 라벨 ---')
for (const [k, v] of [...byStage.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(v).padStart(5)}  ${k}`)
}
