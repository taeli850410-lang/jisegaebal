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

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : dflt
}
const LIMIT = Number(arg('--limit', '40'))
const GU = arg('--gu', null)

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
      const out = []
      for (const f of j.features ?? []) {
        const p = f.properties ?? {}
        if (!p.pnu) continue
        const polys =
          f.geometry.type === 'Polygon'
            ? [f.geometry.coordinates[0]]
            : f.geometry.coordinates.map((q) => q[0])
        for (const ring of polys) {
          if (ring.length < 4) continue
          let cx = 0
          let cy = 0
          for (const [x, y] of ring) {
            cx += x
            cy += y
          }
          cx /= ring.length
          cy /= ring.length
          // 구역 경계 안쪽 필지만 센다
          if (!rings.some((r) => pointInRing(cx, cy, r))) continue
          out.push({
            pnu: p.pnu,
            jimok: (p.jibun ?? '').split(' ').pop() ?? '',
            areaM2: Math.round(ringAreaM2(ring)),
            jiga: num(p.jiga) || null,
          })
        }
      }
      return out
    } catch {
      /* 재시도 */
    }
  }
  return null
}

/* ── 건축물대장 표제부 (법정동 단위, 캐시) ──────────── */
const bldCache = new Map()
async function buildingsOf(ldCode, op = 'getBrTitleInfo') {
  const ck = `${op}|${ldCode}`
  if (bldCache.has(ck)) return bldCache.get(ck)
  const sigungu = ldCode.slice(0, 5)
  const bjdong = ldCode.slice(5, 10)
  // numOfRows 는 100 이 상한이다. 더 크게 요청해도 100 만 온다.
  // totalCount 를 보고 끝까지 넘겨야 한다.
  const PAGE = 100
  const MAX_PAGES = 120 // 법정동 하나에 12,000동이면 충분하다
  const rows = []
  let total = Infinity
  for (let page = 1; page <= MAX_PAGES && rows.length < total; page++) {
    const qs = new URLSearchParams({
      serviceKey: DGK,
      sigunguCd: sigungu,
      bjdongCd: bjdong,
      numOfRows: String(PAGE),
      pageNo: String(page),
      _type: 'json',
    })
    let got = 0
    for (let a = 0; a < 3; a++) {
      if (a) await sleep(700 * a)
      try {
        const t = await (
          await fetch(`https://apis.data.go.kr/1613000/BldRgstHubService/${op}?${qs}`)
        ).text()
        if (!t.trim() || !t.trimStart().startsWith('{')) continue
        const j = JSON.parse(t)
        if (j?.response?.header?.resultCode !== '00') continue
        total = num(j.response.body?.totalCount) || 0
        const it = j.response.body?.items?.item
        const arr = it ? (Array.isArray(it) ? it : [it]) : []
        rows.push(...arr)
        got = arr.length
        break
      } catch {
        /* 재시도 */
      }
    }
    if (!got) break
    await sleep(60)
  }
  bldCache.set(ck, rows)
  return rows
}

/* ── 통계 산출 ──────────────────────────────────────── */
const RESIDENTIAL = /주택/
const YEAR = new Date().getFullYear()

function compute(zone, parcels, buildingsByLd, recapsByLd) {
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
  const blds = mine.filter((b) => {
    const k = b.mgmBldrgstPk ?? `${b.bun}${b.ji}${b.dongNm}${b.useAprDay}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const homes = blds.filter((b) => RESIDENTIAL.test(b.mainPurpsCdNm ?? ''))
  const apts = homes.filter((b) => (b.mainPurpsCdNm ?? '').includes('공동'))
  const houses = homes.filter((b) => !(b.mainPurpsCdNm ?? '').includes('공동'))

  let aptHouseholds = apts.reduce((s, b) => s + num(b.hhldCnt), 0)
  const houseHouseholds = houses.reduce((s, b) => s + Math.max(num(b.fmlyCnt), 1), 0)

  // 단지형 아파트는 동별 표제부에 세대수가 비어 있고 총괄표제부에만 있다.
  // 그래서 재건축 완료 구역이 0세대로 나왔다. 더 큰 쪽을 쓴다.
  const recapHouseholds = recaps.reduce((s, b) => s + num(b.hhldCnt), 0)
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
      householdsPerHa: ha > 0 ? Math.round(totalHouseholds / ha) : null,
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
let targets = develops.filter((d) => d.gu && d.areaM2 > 3000)
if (GU) targets = targets.filter((d) => d.gu === GU)
// 이미 만든 구역은 건너뛰고, 큰 구역부터 — 관심도가 높다
targets = targets.filter((d) => !(d.id in stats)).sort((a, b) => b.areaM2 - a.areaM2)
targets = targets.slice(0, LIMIT)

console.log(`대상 ${targets.length}개 구역 (기존 ${Object.keys(stats).length}개)`)

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
  for (const ld of ldCodes) {
    buildingsByLd.set(ld, await buildingsOf(ld))
    recapsByLd.set(ld, await buildingsOf(ld, 'getBrRecapTitleInfo'))
  }

  const s = compute(zone, parcels, buildingsByLd, recapsByLd)
  s.legalDongs = ldCodes.length
  stats[zone.id] = s
  ok++
  console.log(
    `  [${i + 1}/${targets.length}] ${zone.name} — 필지 ${s.parcelCount} · 세대 ${s.households.total} · ` +
      `노후 ${s.aging.now}/${s.aging.denominator} · 과소 ${s.conditions.smallParcels}`,
  )
  mkdirSync('data', { recursive: true })
  writeFileSync(OUT, JSON.stringify(stats))
  await sleep(200)
}

console.log(`\n완료: ${ok}개 산출 / 누적 ${Object.keys(stats).length}개`)
