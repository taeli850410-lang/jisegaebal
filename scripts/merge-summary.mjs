/**
 * 사업개요(정비몽땅) → 구역 매핑
 *
 * stages.seoul.json 이 이미 "사업장 ↔ 구역"을 연결해 두었으므로,
 * 그 연결을 타고 사업개요를 구역 단위로 옮긴다.
 * (사업장은 cafeUrl 로, 구역은 developId 로 식별)
 *
 * 실행: node scripts/merge-summary.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const sites = JSON.parse(readFileSync('data/cleanup-sites.json', 'utf-8'))
const summary = JSON.parse(readFileSync('data/cleanup-summary.json', 'utf-8'))
const stages = JSON.parse(readFileSync('data/stages.seoul.json', 'utf-8'))

// 사업장명 → cafeUrl (stages 는 siteName 으로 사업장을 가리킨다)
const byName = new Map()
for (const s of sites) {
  if (s.name && s.cafeUrl && !byName.has(s.name)) byName.set(s.name, s.cafeUrl)
}

const out = {}
let matched = 0
let withData = 0

for (const st of stages) {
  const cafeUrl = byName.get(st.siteName)
  if (!cafeUrl) continue
  const sum = summary[cafeUrl]
  if (!sum) continue
  matched++

  // 값이 하나라도 있는 것만 담는다 (빈 껍데기는 화면에 노이즈만 만든다)
  const hasAny =
    sum.areaM2 != null ||
    sum.landOwnerCount != null ||
    sum.far != null ||
    sum.bcr != null ||
    (sum.useZone && sum.useZone.length > 0)
  if (!hasAny) continue

  withData++
  out[st.developId] = {
    cafeUrl,
    siteName: st.siteName,
    zoneName: sum.zoneName,
    address: sum.address,
    areaM2: sum.areaM2,
    memberCount: sum.memberCount,
    landOwnerCount: sum.landOwnerCount,
    tenantCount: sum.tenantCount,
    useZone: sum.useZone,
    useDistrict: sum.useDistrict,
    siteAreaM2: sum.siteAreaM2,
    buildingAreaM2: sum.buildingAreaM2,
    totalFloorAreaM2: sum.totalFloorAreaM2,
    bcr: sum.bcr,
    far: sum.far,
    floors: sum.floors,
    landUseHousing: sum.landUseHousing,
    landUseRoad: sum.landUseRoad,
    landUsePark: sum.landUsePark,
    landUseGreen: sum.landUseGreen,
  }
}

writeFileSync('data/zone-summary.json', JSON.stringify(out))

console.log(`stages ${stages.length}건 중 사업장 매칭 ${matched}건`)
console.log(`실제 값이 있는 구역 ${withData}개 → data/zone-summary.json`)

const vals = Object.values(out)
const has = (k) => vals.filter((v) => v[k] != null && v[k] !== '').length
console.log(
  `면적 ${has('areaM2')} / 토지등소유자 ${has('landOwnerCount')} / 용적률 ${has('far')} / ` +
    `건폐율 ${has('bcr')} / 용도지역 ${has('useZone')} / 층수 ${has('floors')}`,
)
