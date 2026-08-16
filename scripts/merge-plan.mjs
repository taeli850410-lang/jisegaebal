/**
 * 계획 정보(공급계획·공동이용시설·추진주체) → 구역 매핑
 *
 * merge-summary.mjs 와 같은 경로를 쓴다.
 * (사업장은 cafeUrl 로, 구역은 developId 로 식별 — stages 의 siteName 이 다리다)
 *
 * 실행: node scripts/merge-plan.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8'))
const plan = JSON.parse(readFileSync('data/cleanup-plan.json', 'utf-8'))
const stages = JSON.parse(readFileSync('data/stages.seoul.json', 'utf-8'))

const byName = new Map()
for (const s of sites) {
  if (s.name && s.cafeUrl && !byName.has(s.name)) byName.set(s.name, s.cafeUrl)
}

const out = {}
let matched = 0

for (const st of stages) {
  const cafeUrl = byName.get(st.siteName)
  if (!cafeUrl) continue
  const p = plan[cafeUrl]
  if (!p) continue

  // 값이 하나라도 있는 것만 — 빈 껍데기는 화면에 섹션만 만든다
  const hasAny =
    p.supplySale?.total ||
    p.supplyRent?.total ||
    p.facilities?.length ||
    p.office?.phone ||
    p.floors ||
    p.improvement?.total ||
    p.schedule ||
    p.drawings
  if (!hasAny) continue

  matched++
  out[st.developId] = {
    cafeUrl,
    siteName: st.siteName,
    supplySale: p.supplySale ?? null,
    supplyRent: p.supplyRent ?? null,
    maxHeightM: p.maxHeightM ?? null,
    floors: p.floors ?? null,
    mainUse: p.mainUse ?? null,
    facilities: p.facilities ?? [],
    improvement: p.improvement ?? null,
    schedule: p.schedule ?? null,
    office: p.office ?? null,
    drawings: p.drawings ?? null,
  }
}

writeFileSync('data/zone-plan.json', JSON.stringify(out))
const supply = Object.values(out).filter((v) => v.supplySale?.total).length
const office = Object.values(out).filter((v) => v.office?.phone).length
console.log(`구역 ${matched}개 — 공급계획 ${supply} · 추진주체 ${office}`)
