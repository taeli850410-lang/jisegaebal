'use client'

/**
 * 구역 카드용 추이 차트 — 값이 없는 달은 선을 잇지 않고 건너뛴다.
 *
 * 벤치마크처럼 선 아래를 옅게 채운다. 폭이 좁아 눈금을 못 넣는 대신
 * 면적으로 "얼마나 올랐나"가 먼저 읽히게 하려는 것이다.
 */
export default function Sparkline({
  series,
  deals,
  width = 150,
  height = 46,
}: {
  series: { ym: string; value: number | null }[]
  /**
   * 개별 거래. 월별 중앙값이 한 점뿐이면 선이 안 그려지는데,
   * 거래가 1~2건인 구역이 많아 그 카드만 그래프가 비어 보인다.
   * 그럴 때는 거래를 계약일 순으로 찍어 한 건씩이라도 흐름을 보여준다.
   */
  deals?: { dealDate: string; pricePerLandPyeong: number | null }[]
  width?: number
  height?: number
}) {
  const monthly = series.map((s) => s.value)
  const monthlyPresent = monthly.filter((v): v is number => v != null)

  // 월별로 점이 부족하면 개별 거래로 대체한다
  const usingDeals = monthlyPresent.length < 2
  const dealPoints = usingDeals
    ? (deals ?? [])
        .filter((d) => d.pricePerLandPyeong != null)
        .slice()
        .sort((a, b) => a.dealDate.localeCompare(b.dealDate))
        .map((d) => d.pricePerLandPyeong as number)
    : []

  const values: (number | null)[] = usingDeals ? dealPoints : monthly
  const present = values.filter((v): v is number => v != null)

  if (present.length === 1) {
    // 한 건뿐이면 선이 아니라 점 하나로 — 없는 추세를 그리지 않는다
    return (
      <svg width={width} height={height} className="overflow-visible">
        <line
          x1={4}
          y1={height / 2}
          x2={width - 4}
          y2={height / 2}
          stroke="#E5E7EB"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <circle cx={width / 2} cy={height / 2} r={3.2} fill="#4F46E5" />
      </svg>
    )
  }

  if (present.length < 1) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[10px] text-gray-300"
      >
        거래 없음
      </div>
    )
  }

  const min = Math.min(...present)
  const max = Math.max(...present)
  const span = max - min || 1
  const stepX = width / Math.max(1, values.length - 1)

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
