/**
 * 구역별 세대현황·노후도·개발여건 산출.
 *
 * 두 원천을 필지 단위로 붙인다.
 *   ① V-World 연속지적도 WFS — 구역 bbox 안의 필지 경계·PNU·면적·공시지가
 *   ② 국토교통부 건축물대장 표제부 — 법정동 단위로 통째로 받아 bun/ji 로 색인
 *
 * 표제부가 법정동 단위 대량 조회를 지원하는 게 핵심이다. 필지마다 부르면
 * 구역당 수백 콜인데, 법정동당 6콜이면 그 동의 건물이 전부 온다.
 *
 * 실행: node scripts/build-zone-stats.mjs [--limit 30] [--gu 은평구]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const VKEY = process.env.VWORLD_API_KEY
const DGK = process.env.DATA_GO_KR_SERVICE_KEY
const DOMAIN = process.env.VWORLD_DOMAIN ?? 'https://jisegaebal.vercel.app'
if (!VKEY || !DGK) {
  console.error('VWORLD_API_KEY / DATA_GO_KR_SERVICE_KEY 필요')
  process.exit(1)
}

// --limit 40 과 --limit=40 을 둘 다 받는다.
// 등호 형식이 조용히 무시되는 바람에 400개 돌린다고 하고 40개만 돈 적이 있다.
const arg = (name, dflt) => {
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg('--limit', '40'))
const GU = arg('--gu', null)
/**
 * 이 면적 미만 구역은 건너뛴다.
 *
 * 처음엔 3,000㎡ 였다 — API 한도가 빠듯해 큰 구역부터 챙겨야 했다.
 * 건축물대장을 파일 색인으로 바꾼 뒤로는 그 이유가 없어졌고,
 * 중구 도시환경정비사업지구처럼 수백㎡ 짜리도 엄연한 구역이라 기본값을 낮춘다.
 */
const MIN_AREA = Number(arg('--min-area', '500'))
/** 이미 산출한 구역도 다시 계산한다 (필드를 추가했을 때) */
const REFRESH = process.argv.includes('--refresh')
/**
 * 값싼 항목만 낸다 — 세대현황·노후도·과소필지·유형별 토지면적.
 *
 * 필지 단위 V-World 호출(토지특성·토지이용·소유)을 통째로 건너뛴다.
 * 그것들이 구역당 300콜을 먹어 1,690개 구역을 도는 걸 막고 있었다.
 * tier1 은 구역당 WFS 1콜 + 법정동 캐시라 전 구역을 돌 수 있다.
 */
const TIER1 = process.argv.includes('--tier1')

/**
 * tier1 이 남기고 간 것만 채운다 — 접도율·용도지역·규제·소유.
 *
 * tier1 을 전 구역에 돌려 세대·노후는 1,399개까지 왔는데, V-World 필지 항목은
 * 106개에서 멈춰 있다. 그것만 있는 구역을 골라 다시 돈다.
 * 건물은 파일 색인에서 오므로 여기서 드는 비용은 V-World 뿐이다.
 */
const VWORLD_ONLY = process.argv.includes('--vworld')

const OUT = 'data/zone-stats.json'
const stats = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf-8')) : {}

const develops = JSON.parse(readFileSync('data/develops.seoul.json', 'utf-8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

/* ── 기하 ───────────────────────────────────────────── */
function outerRings(g) {
  if (!g) return []
  if (g.type === 'Polygon') return [g.coordinates[0]]
  if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0])
  return []
}
function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function ringAreaM2(ring) {
  if (ring.length < 4) return 0
  const mLng = 111320 * Math.cos((ring[0][1] * Math.PI) / 180)
  const mLat = 110574
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    s += ring[j][0] * mLng * (ring[i][1] * mLat) - ring[i][0] * mLng * (ring[j][1] * mLat)
  }
  return Math.abs(s / 2)
}

/* ── 연속지적도 ─────────────────────────────────────── */
async function parcelsIn(zone) {
  const [minLng, minLat, maxLng, maxLat] = zone.bbox
  const url =
    `https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature&VERSION=1.1.0` +
    `&TYPENAME=lp_pa_cbnd_bubun&SRSNAME=EPSG:4326&OUTPUT=application/json&MAXFEATURES=1000` +
    `&BBOX=${minLng},${minLat},${maxLng},${maxLat}&key=${VKEY}&domain=${encodeURIComponent(DOMAIN)}`
  for (let a = 0; a < 3; a++) {
    if (a) await sleep(800 * a)
    try {
      const t = await (await fetch(url)).text()
      if (!t.trimStart().startsWith('{')) continue
      const j = JSON.parse(t)
      const rings = outerRings(zone.geometry)

      /*
       * 원칙은 "필지 중심이 구역 안"이다 — 경계에 걸친 필지를 통째로 세면
       * 세대수·노후도가 부풀기 때문이다.
       *
       * 그런데 도로변 도시환경정비구역처럼 폭 20m 짜리 띠 모양 구역은
       * 중심이 들어오는 필지가 하나도 없다. 서초금호·마포로1-8 등 4개 구역이
       * 그래서 통계가 통째로 비어 있었다.
       * 중심 판정으로 한 필지도 못 건지면 "겹치기만 해도" 로 한 번 더 훑는다.
       */
      const centroidOf = (ring) => {
        let cx = 0
        let cy = 0
        for (const [x, y] of ring) {
          cx += x
          cy += y
        }
        return [cx / ring.length, cy / ring.length]
      }
      const overlaps = (ring) =>
        ring.some(([x, y]) => rings.some((r) => pointInRing(x, y, r))) ||
        rings.some((r) => r.some(([x, y]) => pointInRing(x, y, ring)))

      const collect = (hit) => {
        const acc = []
        for (const f of j.features ?? []) {
          const p = f.properties ?? {}
          if (!p.pnu) continue
          const polys =
            f.geometry.type === 'Polygon'
              ? [f.geometry.coordinates[0]]
              : f.geometry.coordinates.map((q) => q[0])
          for (const ring of polys) {
            if (ring.length < 4) continue
            if (!hit(ring)) continue
            acc.push([p, ring])
          }
        }
        return acc
      }

      let picked = collect((ring) => {
        const [cx, cy] = centroidOf(ring)
        return rings.some((r) => pointInRing(cx, cy, r))
      })
      let loose = false
      if (!picked.length) {
        picked = collect(overlaps)
        loose = picked.length > 0
      }
      if (loose) console.log(`    (중심 판정 0필지 — 겹침 판정으로 ${picked.length}필지)`)

      const out = picked.map(([p, ring]) => ({
        pnu: p.pnu,
        jimok: (p.jibun ?? '').split(' ').pop() ?? '',
        areaM2: Math.round(ringAreaM2(ring)),
        jiga: num(p.jiga) || null,
        // 건축물대장 파일은 코드가 아니라 이름으로 오므로 함께 들고 다닌다
        gu: p.sig_nm ?? null,
        dong: p.emd_nm ?? null,
        bonbun: p.bonbun ?? null,
        bubun: p.bubun ?? null,
      }))
      /*
       * 한 필지가 여러 조각(MultiPolygon)이면 링 수만큼 항목이 생긴다.
       * 그대로 두면 필지 수가 부풀고, 지번 단위 값(반지하 동수)이 조각 수만큼
       * 중복 합산된다 — 실제로 반지하 비율이 219%로 나왔다.
       * PNU 로 합치고 면적만 더한다.
       */
      const byPnu = new Map()
      for (const p of out) {
        const prev = byPnu.get(p.pnu)
        if (prev) prev.areaM2 += p.areaM2
        else byPnu.set(p.pnu, { ...p })
      }
      return [...byPnu.values()]
    } catch {
      /* 재시도 */
    }
  }
  return null
}

/* ── 토지특성 (필지 단위) ───────────────────────────
   접도율·용도지역의 원천. PNU 하나당 한 번씩 불러야 하지만 응답이 매우 빨라
   (5건 74ms) 구역당 수백 건도 감당된다. */
async function landCharacteristics(pnus) {
  const out = new Map()
  // 동시 10건으로 구역당 900필지를 몰아치니 V-World 가 502를 돌려주기 시작했다.
  // 접도율·용도지역은 비율이라 표본으로 충분하다. 천천히, 적게 부른다.
  const C = 4
  for (let i = 0; i < pnus.length; i += C) {
    const slice = pnus.slice(i, i + C)
    await Promise.all(
      slice.map(async (pnu) => {
        for (let a = 0; a < 2; a++) {
          if (a) await sleep(300)
          try {
            const j = await (
              await fetch(
                `https://api.vworld.kr/ned/data/getLandCharacteristics?key=${VKEY}` +
                  `&domain=${encodeURIComponent(DOMAIN)}&format=json&numOfRows=1&pageNo=1&pnu=${pnu}`,
              )
            ).json()
            const b = j[Object.keys(j)[0]]
            const f = b?.field ? (Array.isArray(b.field) ? b.field : [b.field]) : []
            // 최신 연도 한 건만 쓴다 (응답이 연도 오름차순이라 마지막)
            if (f.length) out.set(pnu, f[f.length - 1])
            return
          } catch {
            /* 재시도 */
          }
        }
      }),
    )
    await sleep(120)
  }
  return out
}

/**
 * 토지이용계획(지역·지구 지정) — 토지이음이 보여주는 규제 항목의 원천이다.
 *
 * 토지이음(eum.go.kr)은 공개 API 가 없고 필지 조회가 세션·POST 기반이라
 * 자동으로 끌어올 수 없다. 같은 LURIS 자료가 V-World 로 열려 있어 그쪽을 쓴다.
 *
 * 규제는 구역 전체에 걸리는 것이 대부분이라 표본 몇 필지면 충분하다.
 */
async function landUse(pnus) {
  const tally = new Map()
  for (const pnu of pnus) {
    try {
      const j = await (
        await fetch(
          `https://api.vworld.kr/ned/data/getLandUseAttr?key=${VKEY}` +
            `&domain=${encodeURIComponent(DOMAIN)}&format=json&numOfRows=100&pageNo=1&pnu=${pnu}`,
        )
      ).json()
      const b = j[Object.keys(j)[0]]
      const f = b?.field ? (Array.isArray(b.field) ? b.field : [b.field]) : []
      for (const x of f) {
        const nm = String(x.prposAreaDstrcCodeNm ?? '').trim()
        if (!nm) continue
        const cur = tally.get(nm) ?? { label: nm, code: x.prposAreaDstrcCode, count: 0 }
        cur.count++
        tally.set(nm, cur)
      }
    } catch {
      /* 건너뛴다 */
    }
    await sleep(150)
  }
  return [...tally.values()].sort((a, b) => b.count - a.count)
}

/**
 * 토지소유정보 — 소유자별 토지 면적(개인·국유지·공유지·법인).
 *
 * 한 필지에 공유자가 여럿이면 같은 면적이 사람 수만큼 반복해서 온다.
 * 면적을 그대로 더하면 부풀려지므로, 필지마다 대표 소유구분 하나만 세고
 * 면적은 한 번만 더한다.
 */
async function possession(pnus) {
  const byPnu = new Map()
  const C = 4
  for (let i = 0; i < pnus.length; i += C) {
    await Promise.all(
      pnus.slice(i, i + C).map(async (pnu) => {
        try {
          const j = await (
            await fetch(
              `https://api.vworld.kr/ned/data/getPossessionAttr?key=${VKEY}` +
                `&domain=${encodeURIComponent(DOMAIN)}&format=json&numOfRows=50&pageNo=1&pnu=${pnu}`,
            )
          ).json()
          const b = j[Object.keys(j)[0]]
          const f = b?.field ? (Array.isArray(b.field) ? b.field : [b.field]) : []
          if (!f.length) return
          // 공유 필지는 가장 많은 소유구분을 그 필지의 성격으로 본다
          const tally = {}
          for (const r of f) {
            const nm = String(r.posesnSeCodeNm ?? '').trim()
            if (nm) tally[nm] = (tally[nm] ?? 0) + 1
          }
          const top = Object.entries(tally).sort((a, b2) => b2[1] - a[1])[0]
          if (top) byPnu.set(pnu, { kind: top[0], areaM2: num(f[0].lndpclAr) })
        } catch {
          /* 건너뛴다 */
        }
      }),
    )
    await sleep(120)
  }
  return byPnu
}

/** 소유구분을 사진처럼 네 갈래로 묶는다 */
function ownerGroup(kind) {
  if (/국유/.test(kind)) return '국공유지'
  if (/시유|도유|군유|구유|공유지/.test(kind)) return '국공유지'
  if (/법인/.test(kind)) return '법인'
  if (/개인/.test(kind)) return '개인'
  return '기타'
}

/**
 * 접도 여부.
 *
 * 도시정비법의 접도율은 "폭 4m 이상 도로에 접한 대지" 기준이다.
 * 토지특성 도로접면 코드에서 광대로·중로·소로 계열이 여기 해당하고,
 * 세로(가)·세로(불)·맹지는 4m 미만이거나 도로에 닿지 않는다.
 */
function isAbutting(roadSideCodeNm) {
  const s = String(roadSideCodeNm ?? '')
  if (!s) return null
  if (/맹지|세로/.test(s)) return false
  if (/광대|중로|소로/.test(s)) return true
  return null
}

/* ── 건축물대장 표제부 (법정동 단위, 캐시) ──────────── */
/**
 * 대량 파일 색인이 있으면 API 대신 그걸 쓴다.
 * (scripts/ingest-building-registry.mjs 로 만든다)
 *
 * API 는 numOfRows 100 상한 때문에 법정동 하나에 수십 페이지가 들고,
 * 표제부에는 층별 정보가 없어 반지하를 낼 수 없다. 파일에는 둘 다 있다.
 */
const BUILDING_INDEX = existsSync('data/building-index.json')
  ? JSON.parse(readFileSync('data/building-index.json', 'utf-8'))
  : null
if (BUILDING_INDEX) {
  console.log(`건축물대장 색인 사용 — 지번 ${Object.keys(BUILDING_INDEX).length.toLocaleString()}개`)
}

/**
 * 지하 1층에 주거가 있는 건물 PK 집합.
 * 구역의 건물 목록과 교집합을 세므로 분자가 분모를 넘을 수 없다.
 */
const SEMI_PKS = existsSync('data/semi-basement-pks.json')
  ? new Set(JSON.parse(readFileSync('data/semi-basement-pks.json', 'utf-8')))
  : null
if (SEMI_PKS) console.log(`반지하 건물 ${SEMI_PKS.size.toLocaleString()}동`)

/**
 * 법정동 단위 건축물대장 캐시 — 디스크에 남긴다.
 *
 * 서울 법정동은 약 470개뿐이고 구역은 1,690개다. 여러 구역이 같은 동을 공유하므로
 * 한 번 받아두면 나머지 구역은 공짜다. 실행 사이에도 살아 있어야 의미가 있어
 * 메모리가 아니라 파일에 둔다. (구역 1,690개를 API 로 다 도는 유일한 방법이다)
 */
const BLD_CACHE_PATH = 'data/building-dong-cache.json'
const bldDisk = existsSync(BLD_CACHE_PATH)
  ? JSON.parse(readFileSync(BLD_CACHE_PATH, 'utf-8'))
  : {}
let bldDirty = 0
function persistBld() {
  if (!bldDirty) return
  try {
    mkdirSync('data', { recursive: true })
    writeFileSync(BLD_CACHE_PATH, JSON.stringify(bldDisk))
    bldDirty = 0
  } catch (e) {
    // 캐시는 있으면 좋은 것이지 없으면 안 되는 것이 아니다.
    // 파일이 너무 커져 직렬화가 실패해도 배치를 죽이지 않는다.
    console.warn(`  (캐시 저장 실패 — 메모리로만 계속합니다: ${e.message})`)
    bldDirty = 0
  }
}

/** data.go.kr 일일 한도에 걸리면 여기에 남는다 — 배치를 즉시 멈추기 위해 */
let quotaExhausted = null

const bldCache = new Map()
async function buildingsOf(ldCode, op = 'getBrTitleInfo') {
  const ck = `${op}|${ldCode}`
  if (bldCache.has(ck)) return bldCache.get(ck)
  if (bldDisk[ck]) {
    bldCache.set(ck, bldDisk[ck])
    return bldDisk[ck]
  }
  const sigungu = ldCode.slice(0, 5)
  const bjdong = ldCode.slice(5, 10)
  /*
   * numOfRows 는 100 이 상한이다. 법정동 하나가 5,000동이면 51페이지.
   * 순차로 넘기면 법정동당 1분 가까이 걸려 1,690개 구역을 도는 게 불가능하다.
   * 1페이지에서 totalCount 를 얻은 뒤 나머지는 동시에 받는다.
   */
  const PAGE = 100
  const MAX_PAGES = 200
  // 8로 올리니 표제부가 조용히 실패하기 시작했다(총괄표제부만 남았다). 4로 낮춘다.
  const CONC = 4

  const fetchPage = async (page) => {
    const qs = new URLSearchParams({
      serviceKey: DGK,
      sigunguCd: sigungu,
      bjdongCd: bjdong,
      numOfRows: String(PAGE),
      pageNo: String(page),
      _type: 'json',
    })
    for (let a = 0; a < 3; a++) {
      if (a) await sleep(600 * a)
      try {
        const t = await (
          await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/${op}?${qs}`)
        ).text()
        if (!t.trim() || !t.trimStart().startsWith('{')) continue
        // 일일 한도를 넘으면 재시도해도 소용없다. 조용히 빈 결과로 흘려보내면
        // 노후도 0/0 인 구역이 대량으로 저장돼 나중에 구분할 수 없다.
        if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS/.test(t)) {
          quotaExhausted = op
          return null
        }
        const j = JSON.parse(t)
        if (j?.response?.header?.resultCode !== '00') continue
        const it = j.response.body?.items?.item
        const arr = it ? (Array.isArray(it) ? it : [it]) : []
        return {
          total: num(j.response.body?.totalCount) || 0,
          // 표제부는 한 건에 80개 필드가 온다. 그대로 캐시에 쌓으니 파일이
          // JSON.stringify 한계(문자열 최대 길이)를 넘어 배치가 죽었다.
          // 계산에 실제로 쓰는 것만 남긴다.
          rows: arr.map((b) => ({
            bun: b.bun,
            ji: b.ji,
            mainPurpsCdNm: b.mainPurpsCdNm,
            hhldCnt: b.hhldCnt,
            fmlyCnt: b.fmlyCnt,
            useAprDay: b.useAprDay,
            platArea: b.platArea,
            vlRat: b.vlRat,
            bcRat: b.bcRat,
            ugrndFlrCnt: b.ugrndFlrCnt,
            mainBldCnt: b.mainBldCnt,
            mgmBldrgstPk: b.mgmBldrgstPk,
            dongNm: b.dongNm,
          })),
        }
      } catch {
        /* 재시도 */
      }
    }
    return null
  }

  const first = await fetchPage(1)
  // 실패를 빈 값으로 캐시하면 그 법정동의 모든 구역이 영구히 건물 0동이 된다.
  // 캐시에 넣지 않고 빈 배열만 돌려 다음 구역에서 다시 시도하게 한다.
  if (!first) return []
  const rows = [...first.rows]
  const pages = Math.min(MAX_PAGES, Math.ceil(first.total / PAGE))

  for (let p = 2; p <= pages; p += CONC) {
    const batch = []
    for (let k = p; k < Math.min(p + CONC, pages + 1); k++) batch.push(k)
    const res = await Promise.all(batch.map(fetchPage))
    // 한 페이지라도 못 받으면 그 법정동은 불완전하다. 캐시에 굳히지 않는다.
    if (res.some((r) => !r)) return rows
    for (const r of res) rows.push(...r.rows)
    await sleep(80)
  }
  bldCache.set(ck, rows)
  bldDisk[ck] = rows
  bldDirty++
  if (bldDirty >= 3) persistBld()
  return rows
}

/* ── 통계 산출 ──────────────────────────────────────── */
const RESIDENTIAL = /주택/
const YEAR = new Date().getFullYear()

function compute(zone, parcels, buildingsByLd, recapsByLd, landChars) {
  // 법정동 + 본번 + 부번으로 색인한다.
  // 본번/부번만 쓰면 여러 법정동에 걸친 구역에서 다른 동의 같은 지번이 섞인다.
  const byLot = new Map()
  for (const [ldCode, rows] of buildingsByLd) {
    for (const b of rows) {
      const k = `${ldCode}|${b.bun}${b.ji}`
      const arr = byLot.get(k)
      if (arr) arr.push(b)
      else byLot.set(k, [b])
    }
  }

  const byRecap = new Map()
  for (const [ldCode, rows] of recapsByLd) {
    for (const b of rows) byRecap.set(`${ldCode}|${b.bun}${b.ji}`, b)
  }

  const mine = []
  const recaps = []
  for (const p of parcels) {
    // PNU = 법정동(10) + 산여부(1) + 본번(4) + 부번(4)
    const k = `${p.pnu.slice(0, 10)}|${p.pnu.slice(11, 15)}${p.pnu.slice(15, 19)}`
    for (const b of byLot.get(k) ?? []) mine.push(b)
    const rc = byRecap.get(k)
    if (rc) recaps.push(rc)
  }
  // 같은 지번에 표제부가 여러 건(동별) 있을 수 있어 관리번호로 중복 제거
  const seen = new Set()
  const blds = mine.filter((b, i) => {
    // ?? 를 쓰면 빈 문자열 PK 가 그대로 키가 되어 그런 동이 전부 한 건으로 뭉친다.
    // (대조1구역이 주거동 30동에서 4동으로 줄어 있었다)
    const k =
      b.mgmBldrgstPk ||
      `${b.bun}${b.ji}|${b.dongNm ?? ''}|${b.useAprDay ?? ''}|${b.mainPurpsCdNm ?? ''}|${b.platArea ?? ''}|${i}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const homes = blds.filter((b) => RESIDENTIAL.test(b.mainPurpsCdNm ?? ''))
  const apts = homes.filter((b) => (b.mainPurpsCdNm ?? '').includes('공동'))
  const houses = homes.filter((b) => !(b.mainPurpsCdNm ?? '').includes('공동'))

  let aptHouseholds = apts.reduce((s, b) => s + num(b.hhldCnt), 0)
  const houseHouseholds = houses.reduce((s, b) => s + Math.max(num(b.fmlyCnt), 1), 0)

  /*
   * 단지형 아파트는 동별 표제부에 세대수가 비어 있고 총괄표제부에만 있다.
   * 그래서 재건축 완료 구역이 0세대로 나왔다.
   *
   * 다만 총괄표제부는 한 단지가 여러 지번에 걸쳐 있으면 지번마다 같은 세대수를
   * 반복해서 들고 있다. 그대로 더하면 34필지짜리 구역이 18,943세대가 된다.
   * 같은 값이 반복되는 것이므로 합이 아니라 최댓값을 쓴다.
   */
  const recapHouseholds = recaps.reduce((m, b) => Math.max(m, num(b.hhldCnt)), 0)
  if (recapHouseholds > aptHouseholds) aptHouseholds = recapHouseholds

  // 노후도 — 주거용 동 중 사용승인 30년 경과 비율
  const withApr = homes.filter((b) => /^\d{8}$/.test(String(b.useAprDay ?? '').trim()))
  const aged = (offset) =>
    withApr.filter((b) => YEAR + offset - Number(String(b.useAprDay).slice(0, 4)) >= 30).length

  // 유형별 토지 면적 — 표제부 대지면적을 주용도로 묶는다
  const landBy = {}
  for (const b of blds) {
    const purpose = (b.mainPurpsCdNm ?? '기타').trim() || '기타'
    const key = purpose.includes('공동주택')
      ? '공동주택'
      : purpose.includes('단독주택')
        ? '단독주택'
        : purpose.includes('근린생활')
          ? '근린생활시설'
          : '기타'
    landBy[key] = (landBy[key] ?? 0) + num(b.platArea)
  }
  // 도로는 건축물이 없으므로 연속지적도 지목에서 센다
  const roadArea = parcels
    .filter((p) => p.jimok === '도' || p.jimok === '도로')
    .reduce((s, p) => s + p.areaM2, 0)
  if (roadArea) landBy['도로'] = roadArea

  const small = parcels.filter((p) => p.areaM2 > 0 && p.areaM2 < 90).length
  const totalHouseholds = aptHouseholds + houseHouseholds
  const ha = zone.areaM2 / 10000

  /* ── 접도율 ── 건물이 있는 필지만 대상으로 한다 (도로·공원 필지는 의미 없다) */
  const builtPnus = new Set()
  for (const p of parcels) {
    const k = `${p.pnu.slice(0, 10)}|${p.pnu.slice(11, 15)}${p.pnu.slice(15, 19)}`
    if ((byLot.get(k) ?? []).length) builtPnus.add(p.pnu)
  }
  let abutting = 0
  let roadKnown = 0
  const roadMix = {}
  for (const pnu of builtPnus) {
    const lc = landChars?.get(pnu)
    const v = isAbutting(lc?.roadSideCodeNm)
    if (v === null) continue
    roadKnown++
    if (v) abutting++
    const nm = String(lc.roadSideCodeNm).trim()
    roadMix[nm] = (roadMix[nm] ?? 0) + 1
  }

  /* ── 용도지역 분포 (공부상 면적 기준) ── */
  const zoneMix = {}
  for (const p of parcels) {
    const lc = landChars?.get(p.pnu)
    const nm = String(lc?.prposArea1Nm ?? '').trim()
    if (!nm || nm === '지정되지않음') continue
    zoneMix[nm] = (zoneMix[nm] ?? 0) + (num(lc.lndpclAr) || p.areaM2)
  }

  /* ── 실제 용적률·건폐율 ── 표제부 값을 대지면적으로 가중 평균한다.
     정비몽땅 사업개요가 없는 구역에서도 현황 밀도를 알 수 있다. */
  const weighted = (field) => {
    let sw = 0
    let sv = 0
    for (const b of blds) {
      const w = num(b.platArea)
      const v = num(b[field])
      if (w > 0 && v > 0) {
        sw += w
        sv += v * w
      }
    }
    return sw > 0 ? Math.round((sv / sw) * 10) / 10 : null
  }

  return {
    parcelCount: parcels.length,
    households: {
      total: totalHouseholds,
      apt: aptHouseholds,
      house: houseHouseholds,
    },
    aging: {
      base: 30,
      denominator: withApr.length,
      now: aged(0),
      in5: aged(5),
      in10: aged(10),
    },
    conditions: {
      smallParcels: small,
      parcels: parcels.length,
      // 지하층이 있는 주거용 동 — 반지하의 대리지표다 (층별개요를 봐야 정확하다)
      withBasement: homes.filter((b) => num(b.ugrndFlrCnt) > 0).length,
      residentialBuildings: homes.length,
      /*
       * 반지하 분모는 주거동이 아니라 전체 동수를 쓴다.
       * 근린생활시설 지하 1층에 주거가 있는 경우가 있어, 주거동만 세면
       * 분자가 분모를 넘는 구역이 나온다(21개 있었다).
       * 벤치마크도 접도율과 같은 분모(전체 동)를 쓴다.
       */
      totalBuildings: blds.length,
      // 이 구역 건물 중 지하 1층에 주거가 있는 동
      ...(SEMI_PKS
        ? { semiBasement: blds.filter((b) => SEMI_PKS.has(b.mgmBldrgstPk)).length }
        : {}),
      householdsPerHa: ha > 0 ? Math.round(totalHouseholds / ha) : null,
      // 접도율 — 건물이 있는 필지 중 폭 4m 이상 도로에 접한 비율
      abutting,
      abuttingBase: roadKnown,
    },
    /* 현황 제원 — 정비몽땅 사업개요가 없는 구역의 대체값 */
    actual: {
      far: weighted('vlRat'),
      bcr: weighted('bcRat'),
      platAreaM2: Math.round(blds.reduce((s, b) => s + num(b.platArea), 0)),
      buildings: blds.length,
      useZones: Object.entries(zoneMix)
        .map(([label, areaM2]) => ({ label, areaM2: Math.round(areaM2) }))
        .sort((a, b) => b.areaM2 - a.areaM2)
        .slice(0, 5),
      roadMix: Object.entries(roadMix)
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    },
    landUse: Object.entries(landBy)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ label: k, areaM2: Math.round(v) }))
      .sort((a, b) => b.areaM2 - a.areaM2),
    landPrice: (() => {
      const vs = parcels.map((p) => p.jiga).filter((v) => v)
      if (!vs.length) return null
      vs.sort((a, b) => a - b)
      return { medianPerM2: vs[Math.floor(vs.length / 2)], samples: vs.length }
    })(),
    source: '필지: 연속지적도(V-World) / 건물: 국토교통부 건축물대장 표제부',
  }
}

/* ── 실행 ───────────────────────────────────────────── */
let targets = develops.filter((d) => d.gu && d.areaM2 > MIN_AREA)
if (GU) targets = targets.filter((d) => d.gu === GU)
if (VWORLD_ONLY) {
  // 통계는 이미 있는데 필지 단위 V-World 항목만 비어 있는 구역
  targets = targets.filter((d) => stats[d.id] && !stats[d.id].conditions?.abuttingBase)
} else if (!REFRESH) {
  // 이미 만든 구역은 건너뛰고, 큰 구역부터 — 관심도가 높다
  targets = targets.filter((d) => !(d.id in stats))
}
targets = targets.sort((a, b) => b.areaM2 - a.areaM2)
targets = targets.slice(0, LIMIT)

console.log(`대상 ${targets.length}개 구역 (기존 ${Object.keys(stats).length}개)`)

/**
 * 결과 저장.
 * OneDrive 동기화가 파일을 잡고 있으면 쓰기가 실패한다. 잠깐 기다렸다 다시 시도하고,
 * 그래도 안 되면 다음 저장 시점으로 미룬다 — 여기서 배치가 죽으면 안 된다.
 */
function saveStats() {
  mkdirSync('data', { recursive: true })
  for (let a = 0; a < 4; a++) {
    try {
      writeFileSync(OUT, JSON.stringify(stats))
      return true
    } catch (e) {
      if (a === 3) {
        console.warn(`  (저장 실패, 다음에 다시 시도합니다: ${e.code ?? e.message})`)
        return false
      }
      const until = Date.now() + 400 * (a + 1)
      while (Date.now() < until) {
        /* 동기화가 놓아줄 때까지 잠깐 */
      }
    }
  }
  return false
}

let ok = 0
for (const [i, zone] of targets.entries()) {
  const parcels = await parcelsIn(zone)
  if (!parcels?.length) {
    console.log(`  [${i + 1}/${targets.length}] ${zone.name} — 필지 0`)
    continue
  }
  // 구역은 여러 법정동에 걸친다. 필지에 등장한 법정동을 모두 받아야 건물이 안 샌다.
  const ldCodes = [...new Set(parcels.map((p) => p.pnu.slice(0, 10)))]
  const buildingsByLd = new Map()
  const recapsByLd = new Map()

  if (BUILDING_INDEX) {
    // 색인은 지번 단위라 법정동 묶음을 만들 필요 없이 필지에서 바로 찾는다
    for (const ld of ldCodes) {
      buildingsByLd.set(ld, [])
      recapsByLd.set(ld, [])
    }
    for (const p of parcels) {
      const ld = p.pnu.slice(0, 10)
      // 색인 키는 (구명·동명·본번·부번) 이다. 서울시 파일이 코드 대신 이름을 준다.
      const bun = p.bonbun ?? p.pnu.slice(11, 15)
      const ji = p.bubun ?? p.pnu.slice(15, 19)
      const pad = (v) => String(Number(v) || 0).padStart(4, '0')
      const e = p.gu && p.dong ? BUILDING_INDEX[`${p.gu}|${p.dong}|${pad(bun)}${pad(ji)}`] : null
      if (!e) continue
      // compute() 는 PNU 슬라이스로 맞추므로 내부 키는 그대로 둔다.
      // 이름 기반 키는 색인 조회에만 쓴다.
      const lot = { bun: p.pnu.slice(11, 15), ji: p.pnu.slice(15, 19) }
      for (const b of e.buildings) {
        buildingsByLd.get(ld).push({
          ...lot,
          mainPurpsCdNm: b.purpose,
          hhldCnt: b.hhld,
          fmlyCnt: b.fmly,
          hoCnt: b.ho,
          useAprDay: b.apr,
          platArea: b.plat,
          vlRat: b.far,
          bcRat: b.bcr,
          ugrndFlrCnt: b.ugrnd,
          mgmBldrgstPk: b.pk,
        })
      }
      if (e.recap) {
        recapsByLd.get(ld).push({ ...lot, hhldCnt: e.recap.hhld, mainBldCnt: e.recap.main })
      }
    }
    // 파일 색인은 법정동 API 캐시를 쓰지 않는다 — 표제부가 이미 다 들어 있다
    persistBld()
  } else {
    for (const ld of ldCodes) {
      buildingsByLd.set(ld, await buildingsOf(ld))
      recapsByLd.set(ld, await buildingsOf(ld, 'getBrRecapTitleInfo'))
    }
  }

  /*
   * 토지특성은 필지 단위 조회만 된다. 전수로 부르면 V-World 하루 한도를 넘고
   * 502 가 나기 시작한다(구역당 900필지 x 400구역).
   * 접도율·용도지역은 비율이라 표본으로 충분하므로 고르게 솎아 뽑는다.
   */
  const CAP = 150
  const all = parcels.map((p) => p.pnu)
  const step = Math.max(1, Math.ceil(all.length / CAP))
  const pnus = TIER1 ? [] : all.filter((_, i) => i % step === 0).slice(0, CAP)

  const landChars = pnus.length ? await landCharacteristics(pnus) : new Map()
  // 규제는 구역 전체에 걸리므로 표본 8필지면 충분하다
  const regulations = pnus.length ? await landUse(pnus.slice(0, 8)) : []
  const owners = pnus.length ? await possession(pnus) : new Map()

  // 표제부가 한도로 막혔으면 세대수만 있고 노후도·용적률이 빈 값이 된다.
  // 그걸 저장하면 "확인된 건물 없음"으로 굳어져 나중에 진짜와 구분되지 않는다.
  if (quotaExhausted) {
    console.log(`\n일일 요청 한도 초과(${quotaExhausted}) — 여기서 멈춥니다.`)
    console.log('내일 다시 돌리거나, 건축물대장 파일을 넣으면 한도 없이 진행됩니다.')
    break
  }

  const s = compute(zone, parcels, buildingsByLd, recapsByLd, landChars)
  if (regulations.length) {
    s.regulations = regulations.map((r) => ({
      label: r.label,
      // 표본 전부에 걸리면 구역 전역, 일부면 일부 필지
      scope: r.count >= Math.min(8, pnus.length) ? 'all' : 'partial',
    }))
  }
  if (owners.size) {
    const tally = {}
    for (const { kind, areaM2 } of owners.values()) {
      const g = ownerGroup(kind)
      tally[g] = (tally[g] ?? 0) + (areaM2 || 0)
    }
    s.ownership = {
      sampled: owners.size,
      byOwner: Object.entries(tally)
        .map(([label, areaM2]) => ({ label, areaM2: Math.round(areaM2) }))
        .sort((a, b) => b.areaM2 - a.areaM2),
    }
  }
  s.legalDongs = ldCodes.length
  if (pnus.length < all.length) s.landCharSampled = pnus.length

  /*
   * tier1 은 필지 단위 V-World 를 건너뛰므로 접도율·용도지역·규제·소유가 비어 있다.
   * 이미 그 값이 있는 구역을 tier1 으로 덮어쓰면 애써 받은 걸 잃는다.
   * 값싼 항목만 갈아끼우고 비싼 항목은 이전 것을 살린다.
   */
  const prev = stats[zone.id]
  // vworld 모드에서도 이번에 못 받은 항목은 이전 것을 살린다 —
  // 한도에 걸린 한 번의 실행이 이미 받아 둔 값을 지우면 안 된다
  // 이번에 못 받은 항목만 이전 것으로 되돌린다. 받은 건 새 값이 이긴다 —
  // 그래야 tier1(항상 빈 값)과 vworld(채우러 온 실행)를 한 규칙으로 다룰 수 있다.
  if (prev) {
    if (!s.regulations?.length && prev.regulations) s.regulations = prev.regulations
    if (!s.ownership && prev.ownership) s.ownership = prev.ownership
    if (!s.landCharSampled && prev.landCharSampled) s.landCharSampled = prev.landCharSampled
    if (!s.conditions.abuttingBase && prev.conditions?.abuttingBase) {
      s.conditions.abutting = prev.conditions.abutting
      s.conditions.abuttingBase = prev.conditions.abuttingBase
    }
    if (!s.actual.useZones?.length && prev.actual?.useZones?.length) {
      s.actual.useZones = prev.actual.useZones
    }
    if (!s.actual.roadMix?.length && prev.actual?.roadMix?.length) {
      s.actual.roadMix = prev.actual.roadMix
    }
  }
  stats[zone.id] = s
  ok++
  console.log(
    `  [${i + 1}/${targets.length}] ${zone.name} — 필지 ${s.parcelCount} · 세대 ${s.households.total} · ` +
      `노후 ${s.aging.now}/${s.aging.denominator} · 과소 ${s.conditions.smallParcels} · ` +
      `접도 ${s.conditions.abutting}/${s.conditions.abuttingBase} · 용적 ${s.actual.far ?? '—'}%`,
  )
  // 구역마다 저장하면 1,400번 쓰게 되고, OneDrive 폴더에서는 동기화가 파일을 잠가
  // EBUSY/UNKNOWN 으로 배치가 죽는다. 묶어서 드물게 저장한다.
  if (ok % 25 === 0) saveStats()
  await sleep(200)
}

persistBld()
saveStats()
console.log(`\n완료: ${ok}개 산출 / 누적 ${Object.keys(stats).length}개`)
console.log(`법정동 건축물대장 캐시: ${Object.keys(bldDisk).length}건`)
