/**
 * 공시가격 순차 백필.
 *
 * warm-house-price 를 자치구마다 차례로 부른다. 한 구가 끝나면 다음 구로
 * 넘어가고, 진행 상황을 파일에 남겨 중간에 끊겨도 이어서 할 수 있다.
 *
 * 왜 국내에서 도는가
 *   V-World 는 해외 IP 를 거부한다. GitHub Actions 러너에서 40건 중 39건이
 *   실패했다. 이 PC 는 국내라 조회실패가 0 이다.
 *
 * 순서
 *   정비구역이 많은 구부터. 이 앱이 쓰이는 곳이 거기이기 때문이다.
 *
 * 실행
 *   node --max-old-space-size=4096 scripts/backfill-prices.mjs
 *   node --max-old-space-size=4096 scripts/backfill-prices.mjs --only 중구,종로구
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean)
/** 한 번에 요청할 지번 수 — 너무 크면 한 번 끊길 때 잃는 게 많다 */
const CHUNK = Number(arg('--chunk', '800'))
const PROGRESS = 'data/price-backfill-progress.json'

const HOUSE = /공동주택|다세대|연립|아파트/

function remaining() {
  const bi = JSON.parse(gunzipSync(readFileSync('data/building-slim.json.gz')).toString('utf-8'))
  const hp = JSON.parse(readFileSync('data/house-price-cache.json', 'utf-8'))
  const out = {}
  for (const [k, v] of Object.entries(bi)) {
    if (!HOUSE.test((v.b ?? []).map((r) => r[0]).join(' '))) continue
    const [gu, dong, num] = k.split('|')
    const bon = Number(num.slice(0, 4))
    const bu = Number(num.slice(4))
    const jb = bu ? `${bon}-${bu}` : String(bon)
    if (hp[`${gu}|${dong}|${jb}`] !== undefined) continue
    out[gu] = (out[gu] ?? 0) + 1
  }
  return out
}

/* 정비구역이 많은 구부터 — 이 앱이 쓰이는 곳이 거기다 */
function order() {
  const dev = JSON.parse(readFileSync('data/develops.seoul.json', 'utf-8'))
  const arr = Array.isArray(dev) ? dev : (dev.items ?? Object.values(dev)[0])
  const zones = {}
  for (const z of arr) if (z.gu) zones[z.gu] = (zones[z.gu] ?? 0) + 1
  const left = remaining()
  return Object.keys(left)
    .filter((gu) => !ONLY.length || ONLY.includes(gu))
    .sort((a, b) => (zones[b] ?? 0) - (zones[a] ?? 0))
    .map((gu) => ({ gu, left: left[gu], zones: zones[gu] ?? 0 }))
}

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`)

const progress = existsSync(PROGRESS) ? JSON.parse(readFileSync(PROGRESS, 'utf-8')) : { done: [] }
const queue = order().filter((x) => !progress.done.includes(x.gu))

log(`남은 구 ${queue.length}개 · 지번 ${queue.reduce((s, x) => s + x.left, 0).toLocaleString()}`)

for (const { gu, left, zones } of queue) {
  log(`${gu} 시작 — 구역 ${zones} · 남은 지번 ${left.toLocaleString()}`)
  let round = 0
  for (;;) {
    round++
    const r = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=4096',
        'scripts/warm-house-price.mjs',
        '--source',
        'building',
        '--gu',
        gu,
        '--limit',
        String(CHUNK),
      ],
      { encoding: 'utf-8' },
    )
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    const last = out.trim().split('\n').pop() ?? ''
    log(`  ${gu} ${round}회: ${last.replace(/^완료: /, '')}`)

    /* V-World 가 거부하기 시작하면 더 두드리지 않는다 */
    if (r.status !== 0) {
      log(`  ${gu} 중단 — 스크립트가 ${r.status} 로 끝났다`)
      writeFileSync(PROGRESS, JSON.stringify(progress, null, 1))
      process.exit(1)
    }
    /* 대상이 CHUNK 보다 적게 잡히면 그 구는 끝난 것이다 */
    const m = out.match(/대상 ([\d,]+)지번/)
    const picked = m ? Number(m[1].replace(/,/g, '')) : 0
    if (picked < CHUNK) break
  }
  progress.done.push(gu)
  writeFileSync(PROGRESS, JSON.stringify(progress, null, 1))
  log(`${gu} 완료 (누적 ${progress.done.length}개 구)`)
}

log('전부 끝났다')
