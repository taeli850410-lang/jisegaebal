'use client'

/**
 * 구역 실거래 추이 차트 — 월별 중앙 대지평당가(선) + 거래량(막대).
 *
 * 벤치마크는 개별 거래를 흩뿌린 산점도지만, 구역 안 거래는 월 몇 건 수준이라
 * 점을 뿌리면 오히려 읽기 어렵다. 중앙값 선 + 거래량 막대가 흐름을 더 잘 보여준다.
 */
export default function DealChart({
  series,
}: {
  series: { ym: string; value: number | null; count: number }[]
}) {
  const W = 320
  const H = 130
  const PAD_L = 4
  const PAD_B = 26

  const values = series.map((s) => s.value).filter((v): v is number => v != null)
  const counts = series.map((s) => s.count)
  const maxCount = Math.max(1, ...counts)

  if (values.length < 2) {
    return (
      <div className="flex h-[130px] items-center justify-center rounded-lg bg-gray-50 text-xs text-gray-400">
        추이를 그릴 만큼 거래가 없습니다
      </div>
    )
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const plotH = H - PAD_B - 8
  const stepX = (W - PAD_L * 2) / Math.max(1, series.length - 1)

  const x = (i: number) => PAD_L + i * stepX
  const y = (v: number) => 8 + plotH - ((v - min) / span) * plotH

  // 값이 있는 구간만 이어 그린다 (거래 없는 달은 선을 끊는다)
  const segments: string[] = []
  let cur: string[] = []
  series.forEach((s, i) => {
    if (s.value == null) {
      if (cur.length > 1) segments.push(cur.join(' '))
      cur = []
    } else {
      cur.push(`${x(i).toFixed(1)},${y(s.value).toFixed(1)}`)
    }
  })
  if (cur.length > 1) segments.push(cur.join(' '))

  const fmt = (n: number) =>
    n >= 100_000_000 ? `${(n / 100_000_000).toFixed(1)}억` : `${Math.round(n / 10_000)}만`

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="실거래 추이">
        {/* 거래량 막대 */}
        {series.map((s, i) => {
          if (!s.count) return null
          const h = (s.count / maxCount) * 18
          return (
            <rect
              key={s.ym}
              x={x(i) - stepX * 0.3}
              y={H - PAD_B - h + 18}
              width={Math.max(2, stepX * 0.6)}
              height={h}
              fill="#C7D2FE"
              rx={1}
            />
          )
        })}

        {/* 중앙 평당가 선 */}
        {segments.map((s, i) => (
          <polyline
            key={i}
            points={s}
            fill="none"
            stroke="#4F46E5"
            strokeWidth={1.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* 값이 있는 지점 */}
        {series.map((s, i) =>
          s.value == null ? null : (
            <circle key={s.ym} cx={x(i)} cy={y(s.value)} r={2} fill="#4F46E5" />
          ),
        )}

        {/* x축 라벨 — 6개월 간격만 */}
        {series.map((s, i) =>
          i % 6 === 0 ? (
            <text key={s.ym} x={x(i)} y={H - 4} fontSize={9} fill="#9CA3AF" textAnchor="middle">
              {s.ym.slice(2).replace('-', '.')}
            </text>
          ) : null,
        )}
      </svg>

      <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
        <span>
          <i className="mr-1 inline-block h-1.5 w-3 rounded-sm bg-indigo-600 align-middle" />
          중앙 대지평당가
          <i className="mr-1 ml-3 inline-block h-2 w-2 rounded-sm bg-indigo-200 align-middle" />
          거래량
        </span>
        <span>
          {fmt(min)} ~ {fmt(max)}
        </span>
      </div>
    </div>
  )
}
