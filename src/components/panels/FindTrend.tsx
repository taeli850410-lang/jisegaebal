'use client'

import { useMemo, useState } from 'react'
import type { FindItem } from '@/lib/findFilter'

/**
 * 거래 추이 — 벤치마크의 「매물 추이」 자리.
 *
 * 그쪽은 매물 수·매물 가격을 그린다. 우리는 매물이 없으니 실거래 건수·중앙가를
 * 그린다. 성격이 다른 값이라 축 이름도 그대로 "거래"라고 쓴다.
 *
 * 지금 걸린 필터를 그대로 반영한다 — 필터를 좁혔는데 차트가 전체를 보여주면
 * 두 화면이 다른 얘기를 하게 된다.
 */

const EOK = 100_000_000
type Mode = 'count' | 'price'

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export default function FindTrend({ items }: { items: FindItem[] }) {
  const [mode, setMode] = useState<Mode>('count')

  /** 최근 12개월 — 거래가 없는 달도 빈칸으로 남겨야 흐름이 안 왜곡된다 */
  const points = useMemo(() => {
    const now = new Date()
    const keys: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const byMonth = new Map<string, number[]>()
    for (const it of items) {
      const ym = it.dealDate.slice(0, 7)
      const cur = byMonth.get(ym)
      if (cur) cur.push(it.price)
      else byMonth.set(ym, [it.price])
    }
    return keys.map((ym) => {
      const ps = byMonth.get(ym) ?? []
      return { ym, count: ps.length, price: median(ps) }
    })
  }, [items])

  const values = points.map((p) => (mode === 'count' ? p.count : (p.price ?? 0)))
  const max = Math.max(...values, 1)
  const W = 340
  const H = 96
  const PAD = { l: 34, r: 6, t: 8, b: 18 }
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)

  // 가격 모드에서 거래가 없는 달은 선을 끊는다 — 0으로 이으면 폭락처럼 보인다
  const segs: string[] = []
  let cur = ''
  points.forEach((p, i) => {
    const v = mode === 'count' ? p.count : p.price
    if (mode === 'price' && v == null) {
      if (cur) segs.push(cur)
      cur = ''
      return
    }
    cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v ?? 0).toFixed(1)}`
  })
  if (cur) segs.push(cur)

  const label = (v: number) =>
    mode === 'count' ? `${v}건` : `${(v / EOK).toFixed(1)}억`

  return (
    <div className="mx-4 mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-[var(--shadow-card)]">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[12px] font-bold">거래 추이 <span className="font-normal text-gray-400">최근 12개월</span></p>
        <div className="flex gap-0.5 rounded-lg bg-gray-100 p-0.5">
          {(
            [
              ['count', '거래 수'],
              ['price', '거래가'],
            ] as [Mode, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setMode(k)}
              className={`rounded-md px-2 py-1 text-[11px] font-bold transition ${
                mode === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-6 text-center text-[11px] text-gray-400">조건에 맞는 거래가 없습니다.</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="월별 거래 추이">
          {[0, 0.5, 1].map((fr) => (
            <g key={fr}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y(max * fr)}
                y2={y(max * fr)}
                stroke="#e2e8f0"
                strokeDasharray="2 3"
              />
              <text x={PAD.l - 4} y={y(max * fr) + 3} textAnchor="end" fontSize="7.5" fill="#94a3b8">
                {label(max * fr)}
              </text>
            </g>
          ))}

          {mode === 'count' &&
            points.map((p, i) => (
              <rect
                key={p.ym}
                x={x(i) - 4}
                y={y(p.count)}
                width="8"
                height={Math.max(0, H - PAD.b - y(p.count))}
                rx="1.5"
                fill="#a5b4fc"
              />
            ))}

          {mode === 'price' &&
            segs.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="#4f46e5" strokeWidth="1.6" />
            ))}

          <text x={PAD.l} y={H - 4} fontSize="7.5" fill="#94a3b8">
            {points[0].ym.slice(2).replace('-', '.')}
          </text>
          <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="7.5" fill="#94a3b8">
            {points[points.length - 1].ym.slice(2).replace('-', '.')}
          </text>
        </svg>
      )}

      <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
        매물 수가 아니라 <b>실거래 신고 건수</b>입니다. 신고는 계약 후 30일 안에 하므로 최근 1~2개월은
        덜 찬 상태로 보입니다.
      </p>
    </div>
  )
}
