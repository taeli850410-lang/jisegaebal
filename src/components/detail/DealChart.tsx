'use client'

import { useMemo, useState } from 'react'

/**
 * 구역 실거래 추이 차트.
 *
 * 벤치마크(재개발닷컴)와 같은 구성:
 *   - 왼쪽 눈금 + 가로 격자선으로 값의 크기를 읽게 한다
 *   - 유형(다세대·단독·토지)을 계열로 나눈다. 하나로 뭉치면 성격이 다른 물건이
 *     평균으로 섞여 추이가 사라진다
 *   - 아래에 거래량 막대 — 값이 튀는 달이 표본 1건인지 20건인지 같이 보여야 한다
 *   - 인가 시점을 세로 점선으로 세워 "무슨 일 뒤에 올랐나"를 붙여 읽는다
 *   - 마우스를 올리면 그 달의 값·건수를 띄운다
 */

export interface ChartPoint {
  ym: string
  value: number | null
  price: number | null
  byKind: Record<string, number | null>
  count: number
}

export interface Milestone {
  ym: string
  label: string
  color: string
}

/** 유형별 선 색 — 진행단계 색과 겹치지 않게 고른다 */
const KIND_COLOR: Record<string, string> = {
  villa: '#4F46E5',
  house: '#059669',
  land: '#D97706',
  apt: '#DB2777',
}

const W = 340
const H = 168
const PAD_L = 40
const PAD_R = 8
const PAD_T = 16
const BAR_H = 22
const AXIS_H = 16

const plotTop = PAD_T
const plotBottom = H - AXIS_H - BAR_H
const plotH = plotBottom - plotTop

const won = (n: number) => {
  if (n >= 100_000_000) {
    const e = n / 100_000_000
    return `${e >= 10 ? Math.round(e) : e.toFixed(1).replace(/\.0$/, '')}억`
  }
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`
  return `${Math.round(n).toLocaleString()}`
}

/** 사람이 읽기 좋은 눈금 간격 (1·2·5 × 10ⁿ) */
function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) out.push(v)
  return out
}

export default function DealChart({
  series,
  milestones = [],
  kindLabels = {},
}: {
  series: ChartPoint[]
  milestones?: Milestone[]
  kindLabels?: Record<string, string>
}) {
  const [metric, setMetric] = useState<'land' | 'price'>('land')
  const [hover, setHover] = useState<number | null>(null)

  /** 계열로 그릴 유형 — 점이 2개 미만인 유형은 선이 안 되므로 뺀다 */
  const kinds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of series) {
      for (const [k, v] of Object.entries(s.byKind ?? {})) {
        if (v != null) counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
    return [...counts.entries()].filter(([, n]) => n >= 2).map(([k]) => k)
  }, [series])

  const valueOf = (s: ChartPoint) => (metric === 'land' ? s.value : s.price)

  const all = useMemo(() => {
    const vs: number[] = []
    for (const s of series) {
      const v = valueOf(s)
      if (v != null) vs.push(v)
      if (metric === 'land') {
        for (const kv of Object.values(s.byKind ?? {})) if (kv != null) vs.push(kv)
      }
    }
    return vs
  }, [series, metric])

  const maxCount = Math.max(1, ...series.map((s) => s.count))

  if (all.length < 2) {
    return (
      <div className="flex h-[168px] items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-400">
        추이를 그릴 만큼 거래가 없습니다
      </div>
    )
  }

  const lo = Math.min(...all)
  const hi = Math.max(...all)
  // 위아래에 여백을 줘야 선이 테두리에 붙지 않는다
  const pad = (hi - lo) * 0.12 || hi * 0.1 || 1
  const min = Math.max(0, lo - pad)
  const max = hi + pad
  const ticks = niceTicks(min, max)

  const stepX = (W - PAD_L - PAD_R) / Math.max(1, series.length - 1)
  const x = (i: number) => PAD_L + i * stepX
  const y = (v: number) => plotBottom - ((v - min) / (max - min || 1)) * plotH

  /** 값이 있는 구간만 이어 그린다 — 거래 없는 달은 선을 끊는다 */
  const pathOf = (get: (s: ChartPoint) => number | null) => {
    const segs: string[] = []
    let cur: string[] = []
    series.forEach((s, i) => {
      const v = get(s)
      if (v == null) {
        if (cur.length > 1) segs.push(cur.join(' '))
        cur = []
      } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    })
    if (cur.length > 1) segs.push(cur.join(' '))
    return segs
  }

  const ymIndex = new Map(series.map((s, i) => [s.ym, i]))
  const marks = milestones
    .map((m) => ({ ...m, i: ymIndex.get(m.ym) }))
    .filter((m): m is Milestone & { i: number } => m.i != null)

  const hoverPoint = hover != null ? series[hover] : null

  return (
    <div>
      {/* 지표 전환 */}
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex gap-1">
          {(
            [
              ['land', '대지평당가'],
              ['price', '거래가격'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setMetric(k)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                metric === k
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-400">최근 {series.length}개월</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="실거래 추이"
        onMouseLeave={() => setHover(null)}
      >
        {/* 가로 격자 + 왼쪽 눈금 */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD_L}
              y1={y(t)}
              x2={W - PAD_R}
              y2={y(t)}
              stroke="#F1F5F9"
              strokeWidth={1}
            />
            <text x={PAD_L - 5} y={y(t) + 3} fontSize={8.5} fill="#94A3B8" textAnchor="end">
              {won(t)}
            </text>
          </g>
        ))}

        {/* 인가 시점 */}
        {marks.map((m) => {
          const near = m.i > series.length * 0.7
          return (
            <g key={m.ym + m.label}>
              <line
                x1={x(m.i)}
                y1={plotTop - 6}
                x2={x(m.i)}
                y2={plotBottom + BAR_H}
                stroke={m.color}
                strokeWidth={1}
                strokeDasharray="3 2"
                opacity={0.5}
              />
              <text
                x={near ? x(m.i) - 3 : x(m.i) + 3}
                y={plotTop - 8}
                fontSize={8}
                fontWeight={700}
                fill={m.color}
                textAnchor={near ? 'end' : 'start'}
              >
                {m.label}
              </text>
            </g>
          )
        })}

        {/* 거래량 막대 */}
        {series.map((s, i) =>
          s.count ? (
            <rect
              key={s.ym}
              x={x(i) - Math.max(1.5, stepX * 0.32)}
              y={plotBottom + BAR_H - (s.count / maxCount) * BAR_H}
              width={Math.max(3, stepX * 0.64)}
              height={(s.count / maxCount) * BAR_H}
              fill={hover === i ? '#818CF8' : '#E0E7FF'}
              rx={1}
            />
          ) : null,
        )}

        {/* 유형별 계열 (평당가일 때만 — 총액은 유형별로 비교 의미가 약하다) */}
        {metric === 'land' &&
          kinds.map((k) =>
            pathOf((s) => s.byKind?.[k] ?? null).map((d, j) => (
              <polyline
                key={`${k}-${j}`}
                points={d}
                fill="none"
                stroke={KIND_COLOR[k] ?? '#94A3B8'}
                strokeWidth={1.6}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={0.9}
              />
            )),
          )}

        {/* 전체 중앙값 — 유형 계열이 여럿일 때만 굵게 얹는다 */}
        {(metric === 'price' || kinds.length !== 1) &&
          pathOf(valueOf).map((d, j) => (
            <polyline
              key={`all-${j}`}
              points={d}
              fill="none"
              stroke="#1E293B"
              strokeWidth={metric === 'price' ? 1.8 : 1.2}
              strokeDasharray={metric === 'price' ? undefined : '4 3'}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={metric === 'price' ? 1 : 0.45}
            />
          ))}

        {/* x축 라벨 */}
        {series.map((s, i) =>
          i % 6 === 0 ? (
            <text
              key={s.ym}
              x={x(i)}
              y={H - 3}
              fontSize={8.5}
              fill="#94A3B8"
              textAnchor={i === 0 ? 'start' : 'middle'}
            >
              {s.ym.slice(2).replace('-', '.')}
            </text>
          ) : null,
        )}

        {/* 호버 표시 */}
        {hover != null && (
          <line
            x1={x(hover)}
            y1={plotTop - 6}
            x2={x(hover)}
            y2={plotBottom + BAR_H}
            stroke="#334155"
            strokeWidth={1}
            opacity={0.35}
          />
        )}
        {hover != null && valueOf(series[hover]) != null && (
          <circle cx={x(hover)} cy={y(valueOf(series[hover])!)} r={3} fill="#1E293B" />
        )}

        {/* 마우스 히트박스 — 열 단위로 잡는다 */}
        {series.map((s, i) => (
          <rect
            key={`hit-${s.ym}`}
            x={x(i) - stepX / 2}
            y={0}
            width={stepX}
            height={H}
            fill="transparent"
            // mouseenter 는 React 가 위임으로 흉내내는 이벤트라 SVG 안에서 놓치는 경우가 있다.
            // 실제로 버블링되는 mousemove 를 쓴다.
            onMouseMove={() => setHover(i)}
          />
        ))}
      </svg>

      {/* 범례 + 호버 값 */}
      <div className="mt-1 flex min-h-[16px] items-center justify-between text-[10px]">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-gray-400">
          {metric === 'land' &&
            kinds.map((k) => (
              <span key={k} className="flex items-center gap-1">
                <i
                  className="inline-block h-1.5 w-3 rounded-sm"
                  style={{ background: KIND_COLOR[k] ?? '#94A3B8' }}
                />
                {kindLabels[k] ?? k}
              </span>
            ))}
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm bg-indigo-100" />
            거래량
          </span>
        </span>
        <span className="shrink-0 tabular-nums text-gray-500">
          {hoverPoint ? (
            <>
              <b className="text-gray-700">{hoverPoint.ym.replace('-', '.')}</b>{' '}
              {valueOf(hoverPoint) != null
                ? `${won(valueOf(hoverPoint)!)}${metric === 'land' ? '/평' : ''}`
                : '거래 없음'}
              {hoverPoint.count > 0 && ` · ${hoverPoint.count}건`}
            </>
          ) : (
            `${won(lo)} ~ ${won(hi)}`
          )}
        </span>
      </div>
    </div>
  )
}
