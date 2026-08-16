'use client'

import { useEffect, useRef } from 'react'

/** 필터 버튼 + 드롭다운 패널 — 세 필터가 같은 껍데기를 쓴다 */
export function FilterDropdown({
  label,
  active,
  open,
  onToggle,
  onClose,
  width = 'w-[420px]',
  children,
}: {
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  onClose: () => void
  width?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={onToggle}
        className={`flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold shadow-sm transition ${
          open || active
            ? 'border-indigo-500 bg-white text-indigo-600'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {label}
        <span className="text-[10px]">{open ? '∧' : '∨'}</span>
      </button>

      {open && (
        <div
          className={`thin-scroll absolute top-11 left-0 max-h-[70vh] ${width} overflow-y-auto rounded-2xl border border-gray-100 bg-white p-5 shadow-xl`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** 체크박스 한 줄 (전체 / 그룹) */
export function CheckRow({
  checked,
  label,
  onChange,
  emphasis,
}: {
  checked: boolean
  label: string
  onChange: () => void
  emphasis?: boolean
}) {
  return (
    <button
      onClick={onChange}
      className="flex w-full items-center gap-2.5 py-1.5 text-left"
    >
      <span
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border text-[11px] font-bold ${
          checked
            ? 'border-indigo-600 bg-indigo-600 text-white'
            : 'border-gray-300 bg-white text-transparent'
        }`}
      >
        ✓
      </span>
      <span
        className={`text-sm font-bold ${
          emphasis ? (checked ? 'text-indigo-600' : 'text-gray-700') : 'text-gray-700'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

/** 알약 버튼 — 사업종류는 색 점을 앞에 붙인다 */
export function Pill({
  label,
  selected,
  dot,
  color,
  onClick,
}: {
  label: string
  selected: boolean
  dot?: boolean
  color?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${
        selected
          ? 'border-transparent text-white'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
      style={selected ? { background: color ?? '#4F46E5' } : undefined}
    >
      {dot && (
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: selected ? 'rgba(255,255,255,.85)' : (color ?? '#9CA3AF') }}
        />
      )}
      {label}
    </button>
  )
}
