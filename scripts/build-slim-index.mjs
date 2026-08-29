/**
 * 배포용 건축물대장 색인을 만든다.
 *
 * data/building-index.json 은 106MB 다. 서버리스 함수에 넣으면 콜드스타트마다
 * 2.2초를 파싱에 쓴다. 그런데 우리가 실제로 읽는 필드는 여섯 개뿐이고,
 * plat·pk·fmly·ugrnd 는 아무도 안 본다.
 *
 * 필드만 추려도 32MB / 1.0초가 된다. 지번은 하나도 안 버린다 —
 * 구역 밖 주소도 검증할 수 있어야 하기 때문이다.
 *
 *   node scripts/build-slim-index.mjs
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs'

const SRC = 'data/building-index.json'
const OUT = 'data/building-slim.json'

const bi = JSON.parse(readFileSync(SRC, 'utf-8'))
const slim = {}
let dropped = 0
for (const [key, v] of Object.entries(bi)) {
  const bs = (v.buildings ?? []).map((b) => [
    b.purpose ?? '',
    b.hhld ?? 0,
    b.ho ?? 0,
    b.apr ?? '',
    b.far ?? 0,
    b.bcr ?? 0,
  ])
  if (!bs.length) {
    dropped++
    continue
  }
  slim[key] = v.semiBasement ? { b: bs, s: 1 } : { b: bs }
}

const out = JSON.stringify(slim)
writeFileSync(OUT, out)
const mb = (n) => (n / 1048576).toFixed(1) + 'MB'
console.log(`${Object.keys(bi).length.toLocaleString()} 지번 → ${Object.keys(slim).length.toLocaleString()}`)
console.log(`건물 없는 지번 ${dropped.toLocaleString()}개 제외`)
console.log(`${mb(statSync(SRC).size)} → ${mb(out.length)}`)
