export type Ring = [number, number][] // [lng, lat][]

export function centroid(ring: Ring): [number, number] {
  let x = 0
  let y = 0
  const n = ring.length - 1 // 마지막 점은 첫 점과 동일
  for (let i = 0; i < n; i++) {
    x += ring[i][0]
    y += ring[i][1]
  }
  return [x / n, y / n]
}

export function bboxOf(ring: Ring): [number, number, number, number] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  return [minLng, minLat, maxLng, maxLat]
}

/** ray casting */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 노후도 색상 — 사용승인 경과연수 기준 (30년 이상 = 노후) */
export function agingColor(approvalYear: number, baseYear = 2026): string {
  const age = baseYear - approvalYear
  if (age >= 40) return '#7F1D1D'
  if (age >= 30) return '#DC2626'
  if (age >= 20) return '#F97316'
  if (age >= 10) return '#FACC15'
  return '#22C55E'
}

export function formatKrwEok(won: number): string {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(eok >= 10 ? 0 : 1)}억`
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

export function formatPerPyeong(won: number): string {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(1)}억/평`
  return `${Math.round(won / 10_000).toLocaleString()}만/평`
}
