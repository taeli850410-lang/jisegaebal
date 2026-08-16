import { getAllDevelops } from './developStore'
import { STAGES } from '@/lib/taxonomy'

/**
 * 단계별 평균 체류 기간(개월).
 *
 * "사업시행인가 1개월째"만 보면 빠른 건지 느린 건지 알 수 없다.
 * 서울에서 실제로 이 단계를 통과한 구역들이 평균 몇 개월 걸렸는지를 옆에 붙인다.
 *
 * 정비몽땅 추진경과가 있는 구역(249개)의 연속한 두 인가일 간격으로 계산한다.
 * 중간 단계 날짜가 비어 있으면 그 구간은 건너뛴다 — 없는 단계를 0으로 세면
 * 평균이 실제보다 짧아진다.
 */

const ORDERED = STAGES.map((s) => s.code)

let cached: Record<string, { avgMonths: number; samples: number }> | null = null

export function stageDurations(): Record<string, { avgMonths: number; samples: number }> {
  if (cached) return cached

  const buckets = new Map<string, number[]>()

  for (const d of getAllDevelops()) {
    const dates = d.progress?.dates
    if (!dates) continue

    // 날짜가 있는 단계만 순서대로 남긴다
    const seq = ORDERED.filter((c) => dates[c]?.date).map((c) => ({ code: c, date: dates[c].date }))

    for (let i = 0; i + 1 < seq.length; i++) {
      const from = Date.parse(seq[i].date)
      const to = Date.parse(seq[i + 1].date)
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue
      const months = (to - from) / (1000 * 60 * 60 * 24 * 30.44)
      // 30년을 넘는 간격은 원본 오타(연도 오기)로 본다
      if (months > 360) continue
      const arr = buckets.get(seq[i].code)
      if (arr) arr.push(months)
      else buckets.set(seq[i].code, [months])
    }
  }

  const out: Record<string, { avgMonths: number; samples: number }> = {}
  for (const [code, arr] of buckets) {
    // 평균은 이상치에 끌려가므로 중앙값을 쓴다
    const sorted = [...arr].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    out[code] = { avgMonths: Math.round(median), samples: arr.length }
  }

  cached = out
  return out
}
