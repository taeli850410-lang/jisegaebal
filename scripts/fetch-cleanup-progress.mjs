/**
 * 정비몽땅 추진경과 수집 — 단계별 인가일의 원천.
 *
 * 화면의 진행현황 타임라인에 날짜를 찍고, "현재 단계에 몇 개월째"를 계산하는 근거가 된다.
 * 고시번호도 함께 들어 있어 고시문 아카이브와 연결할 수 있다.
 *
 * bsnsPk 는 cafeId 에서 유도한다: cafeId '290100016005W31' → '11290-100016005'
 *
 * 실행: node scripts/fetch-cleanup-progress.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

const BASE = 'https://cleanup.seoul.go.kr'
const OUT = 'data/cleanup-progress.json'

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8')).filter((s) => s.cafeUrl)
const summary = JSON.parse(readFileSync('data/cleanup-summary.json', 'utf-8'))
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

console.log(`대상 ${sites.length}건 / 기존 ${Object.keys(cache).length}건`)

const clean = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

/** '2008- 04- 03' 처럼 공백이 섞여 나온다 */
const DATE_RE = /(\d{4})\s*[-.]\s*(\d{1,2})\s*[-.]\s*(\d{1,2})/

function bsnsPkFrom(cafeId) {
  // 앞 3자리는 시군구 뒷자리, 그다음 9자리가 사업 일련번호
  const m = String(cafeId).match(/^(\d{3})(\d{9})/)
  return m ? `11${m[1]}-${m[2]}` : null
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(String(res.status))
  return res.text()
}

async function collect(site) {
  let cafeId = summary[site.cafeUrl]?.cafeId ?? null
  if (!cafeId) {
    const main = await get(`${BASE}/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(site.cafeUrl)}`)
    cafeId = main.match(/cafeId=([A-Z0-9]+)/)?.[1] ?? null
  }
  if (!cafeId) return null

  const bsnsPk = bsnsPkFrom(cafeId)
  if (!bsnsPk) return null

  const html = await get(
    `${BASE}/cafe/mainIndx/cleanup-prtnelapse/vscr.do?cafeId=${cafeId}&bsnsPk=${bsnsPk}`,
  )

  const items = []
  for (const li of html.matchAll(/<li class="foldings-li[^"]*">([\s\S]*?)<\/li>/g)) {
    const inner = li[1]
    const title = clean(inner.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '')
    const body = clean(inner.replace(/<a[^>]*>[\s\S]*?<\/a>/, ''))
    if (!title) continue

    const m = body.match(DATE_RE)
    if (!m) continue

    const [, y, mo, d] = m
    items.push({
      stage: title,
      date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`,
      note: body.match(/\[([^\]]+)\]/)?.[1] ?? null,
      noticeNo: body.match(/고시번호\s*:?\s*(\S+)/)?.[1] ?? null,
      vendor: body.match(/선정업체명\s*:?\s*([^\[]+?)(?:\s{2,}|$)/)?.[1]?.trim() ?? null,
    })
  }

  return { cafeId, items }
}

const CONCURRENCY = 6
const todo = sites.filter((s) => !(s.cafeUrl in cache))
console.log(`신규 ${todo.length}건`)

let done = 0
let withItems = 0

for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const slice = todo.slice(i, i + CONCURRENCY)
  await Promise.all(
    slice.map(async (s) => {
      try {
        const r = await collect(s)
        cache[s.cafeUrl] = r
        if (r?.items?.length) withItems++
      } catch {
        cache[s.cafeUrl] = null
      }
      done++
    }),
  )
  if (i % 60 === 0) {
    mkdirSync('data', { recursive: true })
    writeFileSync(OUT, JSON.stringify(cache))
    console.log(`  ${done}/${todo.length} (이력보유 ${withItems})`)
  }
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(cache))

const vals = Object.values(cache).filter((v) => v?.items?.length)
const totalItems = vals.reduce((s, v) => s + v.items.length, 0)
console.log(`\n완료: ${Object.keys(cache).length}건 중 이력 보유 ${vals.length}건 / 총 ${totalItems}개 항목`)

const byStage = new Map()
for (const v of vals) for (const it of v.items) byStage.set(it.stage, (byStage.get(it.stage) ?? 0) + 1)
console.log('\n--- 이력 단계 상위 ---')
for (const [k, n] of [...byStage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${String(n).padStart(5)}  ${k}`)
}
