import { hasSupabase, sbSelect, sbUpsert } from './supabase'

/**
 * 공시가격 원격 캐시.
 *
 * 디스크 캐시(data/house-price-cache.json)는 커밋해서 배포에 싣는다.
 * 그런데 서울 전역을 다 채워 넣기엔 크고, 새로 채운 값을 서버리스에서
 * 파일에 쓸 수도 없다(읽기 전용).
 *
 * 그래서 배포 뒤에 알게 된 값은 Supabase 에 쌓는다. 읽는 순서는
 *   디스크 캐시 → Supabase → V-World
 * 이고, V-World 에서 받은 건 곧바로 Supabase 에 적어 다음부터 안 부른다.
 *
 * 왜 V-World 를 마지막에 두는가
 *   국내 IP 에서만 응답한다. 우리 배포는 서울(icn1)이라 되지만
 *   한 번에 7초씩 걸린다. 두 번 부를 이유가 없다.
 */

const TABLE = 'public_prices'

/** [전용면적㎡, 공시가격원, 지하여부] */
export type PriceUnits = [number, number, boolean][]
export interface LotPrices {
  year: number
  units: PriceUnits
}

interface Row {
  lot_key: string
  year: number | null
  units: PriceUnits | null
}

/* 람다 한 개 안에서만 사는 캐시 — 같은 지번을 연달아 물으면 두 번 안 간다 */
const mem = new Map<string, LotPrices | null>()

export async function remoteGet(lotKey: string): Promise<{
  hit: boolean
  lot: LotPrices | null
}> {
  if (mem.has(lotKey)) return { hit: true, lot: mem.get(lotKey) ?? null }
  if (!hasSupabase()) return { hit: false, lot: null }

  const res = await sbSelect<Row>(
    TABLE,
    `select=lot_key,year,units&lot_key=eq.${encodeURIComponent(lotKey)}&limit=1`,
  )
  if (!res.ok || !res.data?.length) return { hit: false, lot: null }

  const r = res.data[0]
  /* units 가 null 이면 "조회했더니 공시가격이 없더라" 는 뜻이다.
     그것도 알아낸 사실이라 다시 묻지 않는다. */
  const lot = r.units && r.year ? { year: r.year, units: r.units } : null
  mem.set(lotKey, lot)
  return { hit: true, lot }
}

export async function remotePut(lotKey: string, lot: LotPrices | null): Promise<boolean> {
  mem.set(lotKey, lot)
  if (!hasSupabase()) return false
  const res = await sbUpsert(
    TABLE,
    { lot_key: lotKey, year: lot?.year ?? null, units: lot?.units ?? null },
    'lot_key',
  )
  return res.ok
}

/** 여러 건을 한 번에 — 크론이 채울 때 쓴다 */
export async function remotePutMany(
  rows: { lotKey: string; lot: LotPrices | null }[],
): Promise<boolean> {
  for (const r of rows) mem.set(r.lotKey, r.lot)
  if (!hasSupabase() || !rows.length) return false
  const res = await sbUpsert(
    TABLE,
    rows.map((r) => ({
      lot_key: r.lotKey,
      year: r.lot?.year ?? null,
      units: r.lot?.units ?? null,
    })),
    'lot_key',
  )
  return res.ok
}

/** 이미 아는 지번 — 크론이 건너뛸 대상을 고를 때 쓴다 */
export async function remoteKnownKeys(limit = 10_000): Promise<Set<string>> {
  if (!hasSupabase()) return new Set()
  const res = await sbSelect<{ lot_key: string }>(
    TABLE,
    `select=lot_key&limit=${limit}`,
  )
  return new Set((res.data ?? []).map((r) => r.lot_key))
}
