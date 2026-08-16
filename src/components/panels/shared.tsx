'use client'

import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'

export interface DevelopBrief {
  id: string
  name: string
  projectType: string
  rawLabel: string
  areaM2: number
  gu: string | null
  dong: string | null
  noticeDate: string | null
  stage: string | null
  canonicalStage: string | null
  center: [number, number] | null
  bbox: [number, number, number, number]
}

export function formatEok(won: number) {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(eok >= 10 ? 1 : 2).replace(/\.?0+$/, '')}억`
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

/** 평당가는 억 단위로 넘어가는 경우가 많아 별도 포맷을 쓴다 */
export function formatPerPyeong(won: number) {
  const eok = won / 100_000_000
  if (eok >= 1) return `${eok.toFixed(1)}억`
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

export function TypeBadge({ code, className = '' }: { code: string; className?: string }) {
  const t = PROJECT_TYPE_MAP.get(code)
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${className}`}
      style={{ background: `${t?.color ?? '#888'}1A`, color: t?.color ?? '#666' }}
    >
      {t?.short ?? '기타'}
    </span>
  )
}

export function StageBadge({
  stage,
  canonical,
}: {
  stage: string | null
  canonical: string | null
}) {
  const c = stage ? stageColor(canonical) : '#9CA3AF'
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `${c}1A`, color: c }}
    >
      {stage ?? '단계 미확인'}
    </span>
  )
}

/** 순위 목록 한 줄 (인기·신규 패널 공용) */
export function RankRow({
  rank,
  d,
  right,
  onSelect,
}: {
  rank: number
  d: DevelopBrief
  right?: React.ReactNode
  onSelect: (d: DevelopBrief) => void
}) {
  return (
    <button
      onClick={() => onSelect(d)}
      className="flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-2.5 text-left hover:bg-gray-50"
    >
      <span className="w-5 shrink-0 text-center text-xs font-bold text-gray-400">{rank}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <TypeBadge code={d.projectType} />
          <span className="truncate text-sm font-bold">{d.name}</span>
        </div>
        <p
          className="mt-0.5 truncate text-[11px] font-semibold"
          style={{ color: d.stage ? stageColor(d.canonicalStage) : '#9CA3AF' }}
        >
          {d.stage ?? '단계 미확인'}
          {d.gu && <span className="font-normal text-gray-400"> · {d.gu}</span>}
        </p>
      </div>
      {right}
    </button>
  )
}

/** 기간 토글(7/30/90)처럼 숫자 키도 쓰므로 string|number 를 받는다 */
export function SegTabs<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T
  options: { key: T; label: string; icon?: string; disabled?: boolean; hint?: string }[]
  onChange: (k: T) => void
  size?: 'sm' | 'md'
}) {
  return (
    <div className={`flex gap-1 ${size === 'sm' ? '' : 'px-4 py-2.5'}`}>
      {options.map((o) => (
        <button
          key={o.key}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold whitespace-nowrap transition ${
            o.disabled
              ? 'cursor-not-allowed bg-gray-50 text-gray-300'
              : value === o.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {o.icon ? `${o.icon} ` : ''}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PanelHint({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border-b border-gray-50 px-4 pt-1 pb-3">
      <p className="text-sm font-bold text-gray-800">{title}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">{desc}</p>
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-sm leading-relaxed text-gray-400">{text}</p>
}
