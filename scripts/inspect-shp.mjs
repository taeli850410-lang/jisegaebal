import * as shapefile from 'shapefile'

const BASE = 'data/raw/uq181/shp파일/UPIS_C_UQ181'

const source = await shapefile.open(`${BASE}.shp`, `${BASE}.dbf`, { encoding: 'euc-kr' })

let count = 0
const typeCounts = new Map()
let sample = null

while (true) {
  const { done, value } = await source.read()
  if (done) break
  count++
  if (!sample) sample = value.properties

  // 구역 유형을 담고 있을 법한 필드를 모두 집계한다
  for (const [k, v] of Object.entries(value.properties)) {
    if (typeof v !== 'string' || !v) continue
    if (!/구역|지구|사업|명|NAME|NM/i.test(k)) continue
    const key = `${k}`
    if (!typeCounts.has(key)) typeCounts.set(key, new Map())
    const m = typeCounts.get(key)
    m.set(v, (m.get(v) ?? 0) + 1)
  }
}

console.log('총 피처 수:', count)
console.log('\n--- 샘플 속성 ---')
console.log(sample)

console.log('\n--- 필드별 상위 값 ---')
for (const [field, values] of typeCounts) {
  const top = [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  console.log(`\n[${field}] 고유값 ${values.size}개`)
  for (const [v, n] of top) console.log(`   ${n.toString().padStart(6)}  ${v}`)
}
