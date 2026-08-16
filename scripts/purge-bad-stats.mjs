/**
 * 표제부 한도 초과 중에 저장된 구역 통계를 걷어낸다.
 *
 * getBrTitleInfo 가 429 를 돌려주는 동안에도 총괄표제부는 살아 있었다.
 * 그래서 세대수는 채워지고 노후도·용적률만 빈 구역이 저장됐다.
 * 그대로 두면 화면에 "사용승인일이 확인된 건물이 없습니다"로 나와
 * 진짜로 건물이 없는 구역과 구분되지 않는다.
 *
 * 판별: 세대가 있는데 노후도 분모가 0이고 현황 용적률도 없다.
 *       (건물이 실제로 없으면 세대수도 0이다)
 *
 * 실행: node scripts/purge-bad-stats.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs'

const DRY = process.argv.includes('--dry')
const PATH = 'data/zone-stats.json'
const stats = JSON.parse(readFileSync(PATH, 'utf-8'))
const develops = JSON.parse(readFileSync('data/develops.seoul.json', 'utf-8'))
const byId = new Map(develops.map((d) => [d.id, d]))

const bad = []
for (const [id, v] of Object.entries(stats)) {
  const noAging = !v.aging?.denominator
  const noFar = !v.actual?.far
  const hasHouseholds = (v.households?.total ?? 0) > 0
  if (hasHouseholds && noAging && noFar) bad.push(id)
}

console.log(`전체 ${Object.keys(stats).length}개 중 재계산 대상 ${bad.length}개`)
for (const id of bad.slice(0, 8)) {
  const v = stats[id]
  console.log(`  ${byId.get(id)?.name?.slice(0, 26)} — 세대 ${v.households.total} · 노후 0/0`)
}

if (DRY) {
  console.log('\n--dry 이므로 파일은 건드리지 않았습니다.')
} else {
  for (const id of bad) delete stats[id]
  writeFileSync(PATH, JSON.stringify(stats))
  console.log(`\n${bad.length}개 제거 — 남은 ${Object.keys(stats).length}개`)
}
