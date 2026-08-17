'use client'

/**
 * 구역 카드용 추이 차트 — 값이 없는 달은 선을 잇지 않고 건너뛴다.
 *
 * 벤치마크처럼 선 아래를 옅게 채운다. 폭이 좁아 눈금을 못 넣는 대신
 * 면적으로 "얼마나 올랐나"가 먼저 읽히게 하려는 것이다.
 */
export default function Sparkline({
  series,
  width = 150,
  height = 46,
}: {
  series: { ym: string; value: number | null }[]
  width?: number
  height?: number
}) {
  const values = series.map((s) => s.value)
  const present = values.filter((v): v is number => v != null)
  if (present.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[10px] text-gray-300"
      >
        추이 부족
      </div>
    )
  }

  const min = Math.min(...present)
  const max = Math.max(...present)
  const span = max - min || 1
  const stepX = width / Math.max(1, series.length - 1)

  const pts = values.map((v, i) =>
    v == null ? null : [i * stepX, height - ((v - min) / span) * (height - 6) - 3],
  )

  // 값이 있는 구간만 이어 그린다
  const segments: string[] = []
  let cur: string[] = []
  for (const p of pts) {
    if (!p) {
      if (cur.length > 1) segments.push(cur.join(' '))
      cur = []
    } else {
      cur.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    }
  }
  if (cur.length > 1) segments.push(cur.join(' '))

  const last = [...pts].reverse().find(Boolean) as [number, number] | undefined

  // 가장 긴 구간만 면적으로 채운다 — 끊긴 구간까지 채우면 없는 값을 있는 것처럼 보인다
  const longest = segments.reduce((a, b) => (b.length > a.length ? b : a), '')
  const areaPath = longest
    ? (() => {
        const ps = longest.split(' ').map((s) => s.split(',').map(Number))
        const x0 = ps[0][0]
        const x1 = ps[ps.length - 1][0]
        return `M${x0},${height} L${ps.map((p) => `${p[0]},${p[1]}`).join(' L')} L${x1},${height} Z`
      })()
    : null

  return (
    <svg width={width} height={height} className="overflow-visible">
      {areaPath && <path d={areaPath} fill="#6366F1" fillOpacity={0.12} />}
      {segments.map((s, i) => (
        <polyline
          key={i}
          points={s}
          fill="none"
          stroke="#6366F1"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {last && <circle cx={last[0]} cy={last[1]} r={2.6} fill="#4F46E5" />}
    </svg>
  )
}
