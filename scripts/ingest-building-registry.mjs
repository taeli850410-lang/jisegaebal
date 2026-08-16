/**
 * 건축물대장 대량 파일 적재.
 *
 * 왜 필요한가
 *   지금은 건축물대장을 API 로 법정동마다 부른다. numOfRows 가 100 상한이라
 *   법정동 하나에 수십 페이지가 들고, 필지 단위 토지특성은 V-World 일일 한도에
 *   막혀 502 가 난다. 그래서 접도율·용도지역은 150필지 표본으로 낮췄고
 *   반지하 비율은 아예 못 낸다.
 *
 *   공공데이터포털은 같은 자료를 파일로 통째로 준다. 파일을 한 번 받아
 *   색인해 두면 한도도 표본도 없다. 전수로, 반지하까지 낼 수 있다.
 *
 * 받을 파일 (공공데이터포털 → 파일데이터, 로그인 필요)
 *   국토교통부_건축물대장 표제부      → data/raw/표제부.csv|xlsx
 *   국토교통부_건축물대장 층별개요    → data/raw/층별개요.csv|xlsx   (반지하)
 *   국토교통부_건축물대장 총괄표제부  → data/raw/총괄표제부.csv|xlsx (단지 세대수)
 *
 *   서울만 필요하면 서울특별시_건축물대장 표제부 정보(CSV)도 된다.
 *   XLSX 는 CSV 로 저장해서 넣는다 — 이 스크립트는 CSV 만 읽는다.
 *
 * 실행: node scripts/ingest-building-registry.mjs
 *   → data/building-index.json  (서울 법정동 × 지번 → 건물 요약)
 *
 * 열 이름으로 매핑하므로 파일 판(버전)이 바뀌어 열 순서가 달라져도 동작한다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const RAW = 'data/raw'
const OUT = 'data/building-index.json'

if (!existsSync(RAW)) {
  mkdirSync(RAW, { recursive: true })
  console.error(
    `${RAW} 폴더를 만들었습니다.\n` +
      '공공데이터포털에서 아래 파일을 받아 CSV 로 넣어주세요.\n' +
      '  · 국토교통부_건축물대장 표제부\n' +
      '  · 국토교통부_건축물대장 층별개요   (반지하 비율에 필요)\n' +
      '  · 국토교통부_건축물대장 총괄표제부 (단지 세대수에 필요)\n' +
      'https://www.data.go.kr → 데이터 목록 → 파일데이터 → "건축물대장" 검색',
  )
  process.exit(1)
}

/* ── CSV 파서 ── 따옴표 안의 쉼표·줄바꿈을 지킨다 ── */
function* parseCsv(text) {
  let field = ''
  let row = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      yield row
      row = []
      field = ''
    } else if (c !== '\r') field += c
  }
  if (field || row.length) {
    row.push(field)
    yield row
  }
}

/** 건축물대장 파일은 EUC-KR 인 경우가 많다. BOM/한글 깨짐으로 판별한다. */
function readText(path) {
  const buf = readFileSync(path)
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3))
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf)
  // U+FFFD 가 많으면 EUC-KR 로 본다
  const bad = (utf8.match(/�/g) ?? []).length
  if (bad > utf8.length / 500) return new TextDecoder('euc-kr').decode(buf)
  return utf8
}

/** 헤더에서 원하는 열을 찾는다 — 이름이 조금 달라도 잡히게 부분일치 */
function columnMap(header, wanted) {
  const idx = {}
  for (const [key, patterns] of Object.entries(wanted)) {
    for (const p of patterns) {
      const i = header.findIndex((h) => h.replace(/\s/g, '').includes(p))
      if (i >= 0) {
        idx[key] = i
        break
      }
    }
  }
  return idx
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const pad4 = (v) => String(num(v)).padStart(4, '0')

function findFile(...keywords) {
  const files = readdirSync(RAW).filter((f) => /\.csv$/i.test(f))
  return files.find((f) => keywords.some((k) => f.includes(k)))
}

/* ── ① 표제부 ── 동별 건물: 용도·세대·사용승인·대지면적·지하층 ── */
const titleFile = findFile('표제부', 'title')
if (!titleFile) {
  console.error(`${RAW} 에서 "표제부" 가 들어간 CSV 를 찾지 못했습니다.`)
  process.exit(1)
}
console.log(`표제부 읽는 중: ${titleFile}`)

const index = {} // "법정동코드|본번부번" → { buildings: [...] }
let scanned = 0
let kept = 0

{
  const text = readText(join(RAW, titleFile))
  const it = parseCsv(text)
  const header = it.next().value ?? []
  const c = columnMap(header, {
    sigungu: ['시군구코드'],
    bjdong: ['법정동코드'],
    bun: ['번'],
    ji: ['지'],
    purpose: ['주용도코드명', '주용도'],
    hhld: ['세대수'],
    fmly: ['가구수'],
    ho: ['호수'],
    apr: ['사용승인일'],
    plat: ['대지면적'],
    far: ['용적률'],
    bcr: ['건폐율'],
    ugrnd: ['지하층수'],
    pk: ['관리건축물대장PK', '대장PK'],
  })
  const missing = ['sigungu', 'bjdong', 'bun', 'ji'].filter((k) => c[k] == null)
  if (missing.length) {
    console.error('필수 열을 찾지 못했습니다:', missing.join(', '))
    console.error('헤더 샘플:', header.slice(0, 20).join(' | '))
    process.exit(1)
  }

  for (const row of it) {
    scanned++
    const sgg = String(row[c.sigungu] ?? '').trim()
    // 서울만 (11로 시작)
    if (!sgg.startsWith('11')) continue
    const key = `${sgg}${String(row[c.bjdong] ?? '').trim()}|${pad4(row[c.bun])}${pad4(row[c.ji])}`
    const b = {
      purpose: String(row[c.purpose] ?? '').trim(),
      hhld: num(row[c.hhld]),
      fmly: num(row[c.fmly]),
      ho: num(row[c.ho]),
      apr: String(row[c.apr] ?? '').trim().slice(0, 8),
      plat: num(row[c.plat]),
      far: num(row[c.far]),
      bcr: num(row[c.bcr]),
      ugrnd: num(row[c.ugrnd]),
      pk: String(row[c.pk] ?? '').trim(),
    }
    ;(index[key] ??= { buildings: [], semiBasement: 0 }).buildings.push(b)
    kept++
    if (scanned % 500_000 === 0) console.log(`  ${scanned.toLocaleString()}행 · 서울 ${kept.toLocaleString()}건`)
  }
  console.log(`표제부 완료: ${scanned.toLocaleString()}행 중 서울 ${kept.toLocaleString()}건`)
}

/* ── ② 층별개요 ── 반지하: 지하 1층에 주거 용도가 있는 동 ── */
const floorFile = findFile('층별', 'floor')
if (floorFile) {
  console.log(`층별개요 읽는 중: ${floorFile}`)
  const text = readText(join(RAW, floorFile))
  const it = parseCsv(text)
  const header = it.next().value ?? []
  const c = columnMap(header, {
    sigungu: ['시군구코드'],
    bjdong: ['법정동코드'],
    bun: ['번'],
    ji: ['지'],
    flrGb: ['층구분코드명', '층구분'],
    flrNo: ['층번호'],
    purpose: ['주용도코드명', '주용도'],
  })
  let n = 0
  let hits = 0
  const seen = new Set()
  for (const row of it) {
    n++
    const sgg = String(row[c.sigungu] ?? '').trim()
    if (!sgg.startsWith('11')) continue
    const gb = String(row[c.flrGb] ?? '')
    const no = num(row[c.flrNo])
    // 지하 1층이면서 주거 용도 = 반지하로 본다
    if (!/지하/.test(gb) || no !== 1) continue
    const purpose = String(row[c.purpose] ?? '')
    if (!/주택|주거/.test(purpose)) continue
    const key = `${sgg}${String(row[c.bjdong] ?? '').trim()}|${pad4(row[c.bun])}${pad4(row[c.ji])}`
    const uniq = `${key}|${no}|${purpose}`
    if (seen.has(uniq)) continue
    seen.add(uniq)
    const e = (index[key] ??= { buildings: [], semiBasement: 0 })
    e.semiBasement++
    hits++
  }
  console.log(`층별개요 완료: ${n.toLocaleString()}행 중 서울 반지하 ${hits.toLocaleString()}동`)
} else {
  console.log('층별개요 파일이 없어 반지하 비율은 건너뜁니다.')
}

/* ── ③ 총괄표제부 ── 단지형 아파트 세대수 ── */
const recapFile = findFile('총괄')
if (recapFile) {
  console.log(`총괄표제부 읽는 중: ${recapFile}`)
  const text = readText(join(RAW, recapFile))
  const it = parseCsv(text)
  const header = it.next().value ?? []
  const c = columnMap(header, {
    sigungu: ['시군구코드'],
    bjdong: ['법정동코드'],
    bun: ['번'],
    ji: ['지'],
    hhld: ['세대수'],
    main: ['주건축물수', '주건축물'],
  })
  let n = 0
  for (const row of it) {
    const sgg = String(row[c.sigungu] ?? '').trim()
    if (!sgg.startsWith('11')) continue
    const key = `${sgg}${String(row[c.bjdong] ?? '').trim()}|${pad4(row[c.bun])}${pad4(row[c.ji])}`
    const e = (index[key] ??= { buildings: [], semiBasement: 0 })
    e.recap = { hhld: num(row[c.hhld]), main: num(row[c.main]) }
    n++
  }
  console.log(`총괄표제부 완료: 서울 ${n.toLocaleString()}건`)
}

mkdirSync('data', { recursive: true })
writeFileSync(OUT, JSON.stringify(index))
console.log(`\n저장: ${OUT} — 지번 ${Object.keys(index).length.toLocaleString()}개`)
console.log('이제 build-zone-stats.mjs 가 API 대신 이 색인을 씁니다 (--use-index).')
