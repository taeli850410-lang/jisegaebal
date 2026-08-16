/**
 * 정비몽땅 wtnncSn ↔ SHP WTNNC_SN 겹침 검증 (일회성 조사)
 * 겹친다면 이름·근접 매칭 대신 ID 정확 조인을 쓸 수 있다.
 */
import * as shapefile from 'shapefile'

const BASE = 'data/raw/uq181/shp파일/UPIS_C_UQ181'

const html = await (
  await fetch('https://cleanup.seoul.go.kr/cleanup/bsnssttus/lscrMainIndx.do?cpage=1&pageSize=2000')
).text()

const siteCodes = new Set(
  [...html.matchAll(/mapOpenPopup\('([^']+)'\)/g)].map((m) => m[1]),
)
console.log(`정비몽땅 wtnncSn: ${siteCodes.size}건`)

const source = await shapefile.open(`${BASE}.shp`, `${BASE}.dbf`, { encoding: 'euc-kr' })
const shpAll = new Set()
const shpUq1200 = new Set()

while (true) {
  const { done, value } = await source.read()
  if (done) break
  const p = value.properties
  if (p.WTNNC_SN) {
    shpAll.add(p.WTNNC_SN)
    if (p.LCLAS_CL === 'UQ1200') shpUq1200.add(p.WTNNC_SN)
  }
}

console.log(`SHP WTNNC_SN(전체): ${shpAll.size}건 / 정비구역(UQ1200): ${shpUq1200.size}건`)

const hitAll = [...siteCodes].filter((c) => shpAll.has(c))
const hitZone = [...siteCodes].filter((c) => shpUq1200.has(c))

console.log(`\n겹침 — 전체 대비 ${hitAll.length}건 / 정비구역 대비 ${hitZone.length}건`)
console.log(`정비몽땅 코드 중 SHP에 있는 비율: ${((hitAll.length / siteCodes.size) * 100).toFixed(1)}%`)
console.log('\n샘플:', hitZone.slice(0, 5))
