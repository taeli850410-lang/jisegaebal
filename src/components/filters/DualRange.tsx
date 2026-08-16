'use client'

/**
 * 이중 손잡이 범위 슬라이더.
 *
 * <input type="range"> 두 개를 겹쳐 놓고 트랙만 직접 그린다.
 * 겹친 상태에서는 위에 있는 input이 항상 클릭을 먹으므로,
 * 트랙 영역은 pointer-events를 끄고 손잡이(thumb)에만 살려준다.
 */
export default function DualRange({
  min,
  max,
  step,
  value,
  onChange,
  ticks,
  format,
}: {
  min: number
  max: number
  step: number
  value: [number, number]
  onChange: (v: [number, number]) => void
  ticks?: number[]
  format: (n: number) => string
}) {
  const [lo, hi] = value
  const pct = (n: number) => ((n - min) / (max - min)) * 100

  return (
    <div className="px-1">
      <div className="relative h-6">
        {/* 트랙 */}
        <div className="absolute top-1/2 right-0 left-0 h-1 -translate-y-1/2 rounded-full bg-gray-200" />
        {/* 선택 구간 */}
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-indigo-500"
          style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
        />

        <input
          type="range"
          aria-label="최소값"
          min={min}
          max={max}
          step={step}
          value={lo}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className="dual-range absolute inset-0 w-full"
        />
        <input
          type="range"
          aria-label="최대값"
          min={min}
          max={max}
          step={step}
          value={hi}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className="dual-range absolute inset-0 w-full"
        />
      </div>

      {ticks && (
        <div className="mt-0.5 flex justify-between text-[10px] text-gray-400">
          {ticks.map((t) => (
            <span key={t}>{format(t)}</span>
          ))}
        </div>
      )}
    </div>
  )
}
