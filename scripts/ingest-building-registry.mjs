/**
 * 건축물대장 대량 파일 적재.
 *
 * 왜 필요한가
 *   API 는 numOfRows 100 상한에 일일 요청 한도까지 있어 1,690개 구역을 다 돌 수 없다.
 *   실제로 표제부가 429(일일 한도 초과)에 걸려 21%에서 멈췄다.
 *   파일은 한도가 없고, API 에 없는 층별개요까지 있어 반지하 비율을 낼 수 있다.
 *
 * 파일은 서울시 판(열린데이터광장)이라 국토부 API 와 형식이 다르다.
 *   - 코드가 아니라 이름이 온다 (시군구코드명 "은평구", 법정동코드명 "응암동")
 *   - 지번이 번/지 가 아니라 주지번/부지번
 *   - EUC-KR
 *   그래서 법정동코드가 아니라 (구명·동명·본번·부번) 으로 색인한다.
 *   연속지적도 WFS 가 sig_nm·emd_nm 을 함께 주므로 같은 키로 맞출 수 있다.
 *
 * 표제부 250MB · 층별개요 757MB 라 통째로 읽으면 문자열 한계를 넘는다. 줄 단위로 흘린다.
 *
 * 실행: node scripts/ingest-building-registry.mjs [--dir <폴더>]
 *   → data/building-index.json
 */
import { createReadStream } from 'node:fs'
import { existsSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i >= 0 ? process.argv[i + 1] : d
}
const DIRS = [arg('--dir', null), '.claude', 'data/raw'].filter(Boolean).filter(existsSync)
if (!DIRS.length) {
  console.error('CSV 폴더를 찾지 못했습니다. --dir 로 지정하세요.')
  process.exit(1)
}

/**
 * 이름으로 파일을 고른다.
 * "표제부"로 찾으면 "총괄표제부"가 먼저 걸린다(가나다순으로 총 < 표).
 * 그래서 배제어를 함께 받는다.
 */
function findFile(keywords, exclude = []) {
  for (const dir of DIRS) {
    for (const f of readdirSync(dir)) {
      if (!/\.csv$/i.test(f)) continue
      if (/기본개요/.test(f)) continue // 우리가 쓰지 않는다
      if (exclude.some((x) => f.includes(x))) continue
      if (keywords.some((k) => f.includes(k))) return join(dir, f)
    }
  }
  return null
}

/** EUC-KR 파일을 줄 단위로 흘린다 (통째로 디코드하면 메모리·문자열 한계에 걸린다) */
async function* lines(path) {
  const dec = new TextDecoder('euc-kr')
  let buf = ''
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    buf += dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, i).replace(/\r$/, '')
      buf = buf.slice(i + 1)
    }
  }
  buf += dec.decode()
  if (buf.trim()) yield buf.replace(/\r$/, '')
}

/** 따옴표 안의 쉼표를 지키는 한 줄 분해 */
function splitCsv(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** 헤더에서 열 위치를 이름으로 찾는다 — 판이 바뀌어 순서가 달라져도 동작한다 */
function columnMap(header, wanted) {
  const clean = header.map((h) => h.replace(/["\s]/g, ''))
  const idx = {}
  for (const [key, names] of Object.entries(wanted)) {
    for (const n of names) {
      const i = clean.indexOf(n)
      if (i >= 0) {
        idx[key] = i
        break
      }
    }
  }
  return idx
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[",\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const pad4 = (v) => String(num(v)).padStart(4, '0')

/**
 * 자치구 이름 정규화.
 * CSV 는 "서울특별시 은평구", 연속지적도 WFS 는 "은평구" 로 준다.
 * 시·도를 떼어 양쪽 키를 맞춘다.
 */
const normGu = (v) =>
  String(v ?? '')
    .replace(/["]/g, '')
    .trim()
    .replace(/^[가-힣]+(특별시|광역시|특별자치시|특별자치도|도)\s+/, '')

const key = (gu, dong, bun, ji) =>
  `${normGu(gu)}|${String(dong ?? '').replace(/["]/g, '').trim()}|${pad4(bun)}${pad4(ji)}`

const index = {}
const touch = (k) => (index[k] ??= { buildings: [], semiBasement: 0 })
/** 지하 1층에 주거가 있는 건물의 대장 PK 목록 */
const semiPks = []

const mb = (p) => Math.round(statSync(p).size / 1024 / 1024)

/* ── ① 표제부 ── */
{
  const path = findFile(['표제부'], ['총괄'])
  if (!path) {
    console.error('표제부 CSV 를 찾지 못했습니다.')
    process.exit(1)
  }
  console.log(`표제부 (${mb(path)}MB): ${path}`)
  const it = lines(path)
  const header = splitCsv((await it.next()).value ?? '')
  const c = columnMap(header, {
    gu: ['시군구코드명'],
    dong: ['법정동코드명'],
    bun: ['주지번'],
    ji: ['부지번'],
    purpose: ['주용도코드명'],
    hhld: ['세대수'],
    fmly: ['가구수'],
    ho: ['호수'],
    // 서울시 판은 "사용승인일자"다. "사용승인일"로만 찾으면 전부 빈 값이 되어
    // 노후도가 0/0 으로 나온다.
    apr: ['사용승인일자', '사용승인일'],
    plat: ['대지면적'],
    far: ['용적률'],
    bcr: ['건폐율'],
    ugrnd: ['지하층수'],
    pk: ['건축물대장일련번호'],
  })
  for (const k of ['gu', 'dong', 'bun', 'ji']) {
    if (c[k] == null) {
      console.error(`필수 열 없음: ${k}`)
      console.error('헤더:', header.slice(0, 20).join(' | '))
      process.exit(1)
    }
  }

  let n = 0
  for await (const line of it) {
    if (!line) continue
    const r = splitCsv(line)
    const k = key(r[c.gu], r[c.dong], r[c.bun], r[c.ji])
    touch(k).buildings.push({
      purpose: (r[c.purpose] ?? '').trim(),
      hhld: num(r[c.hhld]),
      fmly: num(r[c.fmly]),
      ho: num(r[c.ho]),
      apr: (r[c.apr] ?? '').replace(/\D/g, '').slice(0, 8),
      plat: num(r[c.plat]),
      far: num(r[c.far]),
      bcr: num(r[c.bcr]),
      ugrnd: num(r[c.ugrnd]),
      pk: (r[c.pk] ?? '').trim(),
    })
    if (++n % 300_000 === 0) console.log(`  ${n.toLocaleString()}행`)
  }
  console.log(`표제부 완료: ${n.toLocaleString()}동 / 지번 ${Object.keys(index).length.toLocaleString()}개`)
}

/* ── ② 층별개요 ── 반지하: 지하 1층에 주거 용도 ── */
{
  const path = findFile(['층별'])
  if (!path) console.log('층별개요 파일이 없어 반지하는 건너뜁니다.')
  else {
    console.log(`층별개요 (${mb(path)}MB): ${path}`)
    const it = lines(path)
    const header = splitCsv((await it.next()).value ?? '')
    const c = columnMap(header, {
      gu: ['시군구코드명'],
      dong: ['법정동코드명'],
      bun: ['주지번'],
      ji: ['부지번'],
      flrGb: ['층구분코드명'],
      flrNo: ['층번호'],
      purpose: ['주용도코드명'],
      pk: ['건축물대장일련번호'],
    })
    let n = 0
    let hit = 0
    const seen = new Set()
    for await (const line of it) {
      if (!line) continue
      const r = splitCsv(line)
      n++
      if (!/지하/.test(r[c.flrGb] ?? '')) continue
      if (num(r[c.flrNo]) !== 1) continue
      if (!/주택|주거/.test(r[c.purpose] ?? '')) continue
      /*
       * 지번 단위로 세면 안 된다.
       * 한 지번이 여러 필지로 잡히거나 산/일반이 같은 키로 합쳐지면 중복 합산되어
       * 분자가 분모를 넘는다(상계2가 745/388동, 192% 로 나왔다).
       * 건축물대장 PK 를 그대로 모아두고, 구역 계산에서 그 구역의 건물 목록과
       * 교집합을 세면 분모를 넘을 수 없다.
       */
      const pk = (r[c.pk] ?? '').replace(/"/g, '').trim()
      if (!pk || seen.has(pk)) continue
      seen.add(pk)
      semiPks.push(pk)
      hit++
      if (n % 1_000_000 === 0) console.log(`  ${n.toLocaleString()}행 · 반지하 ${hit.toLocaleString()}`)
    }
    console.log(`층별개요 완료: ${n.toLocaleString()}행 중 반지하 ${hit.toLocaleString()}동`)
  }
}

/* ── ③ 총괄표제부 ── 단지 세대수 ── */
{
  const path = findFile(['총괄'])
  if (path) {
    console.log(`총괄표제부 (${mb(path)}MB): ${path}`)
    const it = lines(path)
    const header = splitCsv((await it.next()).value ?? '')
    const c = columnMap(header, {
      gu: ['시군구코드명'],
      dong: ['법정동코드명'],
      bun: ['주지번'],
      ji: ['부지번'],
      hhld: ['세대수'],
      main: ['주건축물수'],
    })
    let n = 0
    for await (const line of it) {
      if (!line) continue
      const r = splitCsv(line)
      touch(key(r[c.gu], r[c.dong], r[c.bun], r[c.ji])).recap = {
        hhld: num(r[c.hhld]),
        main: num(r[c.main]),
      }
      n++
    }
    console.log(`총괄표제부 완료: ${n.toLocaleString()}건`)
  }
}

mkdirSync('data', { recursive: true })
writeFileSync('data/building-index.json', JSON.stringify(index))
writeFileSync('data/semi-basement-pks.json', JSON.stringify(semiPks))
console.log(
  `\n저장: data/building-index.json — 지번 ${Object.keys(index).length.toLocaleString()}개`,
)
console.log(`      data/semi-basement-pks.json — 반지하 건물 ${semiPks.length.toLocaleString()}동`)
