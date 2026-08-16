/**
 * 추진경과 → 구역 매핑 + 정규화
 *
 * 정비몽땅 이력 단계명은 20종이 넘고 원본 그대로다.
 * 화면 타임라인은 12단계 정규화 체계를 쓰므로, 여기서 매핑해 단계별 대표일을 뽑는다.
 * (같은 단계에 변경 이력이 여러 건이면 가장 이른 날짜 = 최초 인가일을 쓴다)
 *
 * 실행: node scripts/merge-progress.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8'))
const progress = JSON.parse(readFileSync('data/cleanup-progress.json', 'utf-8'))
const stages = JSON.parse(readFileSync('data/stages.seoul.json', 'utf-8'))

/** 추진경과 원본 단계명 → 정규화 단계 코드 */
const HISTORY_TO_CANONICAL = [
  [/기본계획/, 'prepare'],
  [/안전진단/, 'safety_check'],
  [/정비구역\s*지정|정비계획/, 'zone_designated'],
  [/추진위원회\s*승인|조합설립추진위원회승인/, 'committee'],
  [/조합설립인가|조합\s*설립/, 'union'],
  [/사업시행인가|사업시행계획인가/, 'impl_approval'],
  [/관리처분/, 'mgmt_disposal'],
  [/착공|철거/, 'construction'],
  [/준공|이전고시/, 'completed'],
]

function toCanonical(stageName) {
  for (const [re, code] of HISTORY_TO_CANONICAL) if (re.test(stageName)) return code
  return null
}

// 사업장명 → cafeUrl
const byName = new Map()
for (const s of sites) {
  if (s.name && s.cafeUrl && !byName.has(s.name)) byName.set(s.name, s.cafeUrl)
}

const out = {}
let matched = 0

for (const st of stages) {
  const cafeUrl = byName.get(st.siteName)
  const p = cafeUrl ? progress[cafeUrl] : null
  if (!p?.items?.length) continue

  // 정규화 단계별 최초 일자
  const dates = {}
  for (const it of p.items) {
    const code = toCanonical(it.stage)
    if (!code) continue
    if (!dates[code] || it.date < dates[code].date) {
      dates[code] = { date: it.date, rawStage: it.stage, noticeNo: it.noticeNo }
    }
  }
  if (!Object.keys(dates).length) continue

  matched++
  out[st.developId] = {
    cafeUrl,
    siteName: st.siteName,
    dates,
    // 원본 이력도 함께 보관 — 화면에서 "정비사업전문관리업자선정" 같은 세부도 보여줄 수 있다
    history: p.items.slice(0, 40),
  }
}

writeFileSync('data/zone-progress.json', JSON.stringify(out))

console.log(`구역 ${matched}개에 단계 이력 부여 → data/zone-progress.json`)

const cnt = {}
for (const v of Object.values(out)) for (const k of Object.keys(v.dates)) cnt[k] = (cnt[k] ?? 0) + 1
console.log('\n--- 단계별 일자 보유 구역 수 ---')
for (const [k, n] of Object.entries(cnt).sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(5)}  ${k}`)
}
