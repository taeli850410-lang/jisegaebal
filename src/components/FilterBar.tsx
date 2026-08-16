'use client'

import { useState } from 'react'
import {
  PROJECT_TYPES,
  STAGES,
  type ProjectTypeGroup,
  type StageGroup,
} from '@/lib/taxonomy'
import { CheckRow, FilterDropdown, Pill } from './filters/FilterShell'
import DualRange from './filters/DualRange'

interface Props {
  selectedTypes: Set<string>
  selectedStages: Set<string>
  onToggleType: (code: string) => void
  onToggleStage: (code: string) => void
  onSetTypes: (codes: string[]) => void
  onSetStages: (codes: string[]) => void
  onReset: () => void
}

const TYPE_GROUPS: ProjectTypeGroup[] = ['민간주도', '공공주도', '소규모', '기타']
const STAGE_GROUPS: StageGroup[] = ['추진중', '진행중', '완료']

/** SHP 경계 데이터에 실제로 존재하는 유형 (나머지는 별도 소스 연동 필요) */
const AVAILABLE_TYPES = new Set(['redev', 'rebuild_apt', 'garo', 'small_rebuild'])

const EOK = 100_000_000

function formatEok(n: number) {
  return n === 0 ? '0' : `${n}억`
}

export default function FilterBar({
  selectedTypes,
  selectedStages,
  onToggleType,
  onToggleStage,
  onSetTypes,
  onSetStages,
  onReset,
}: Props) {
  const [open, setOpen] = useState<'type' | 'stage' | 'listing' | null>(null)

  /* 매물 필터 — 매물 데이터 연동 전이라 값만 보관한다 */
  const [unitKind, setUnitKind] = useState('all')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 20])
  const [officialRange, setOfficialRange] = useState<[number, number]>([0, 10])

  const toggleGroup = (
    codes: string[],
    selected: Set<string>,
    setAll: (c: string[]) => void,
  ) => {
    const allOn = codes.every((c) => selected.has(c))
    const next = new Set(selected)
    codes.forEach((c) => (allOn ? next.delete(c) : next.add(c)))
    setAll([...next])
  }

  return (
    <div className="absolute top-3 left-3 z-30 flex items-start gap-2">
      <button
        onClick={onReset}
        title="필터 초기화"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm hover:bg-gray-50"
      >
        ↺
      </button>

      {/* ── 사업종류 ── */}
      <FilterDropdown
        label={selectedTypes.size ? `사업종류 ${selectedTypes.size}` : '사업종류'}
        active={selectedTypes.size > 0}
        open={open === 'type'}
        onToggle={() => setOpen(open === 'type' ? null : 'type')}
        onClose={() => setOpen(null)}
      >
        <div className="border-b border-gray-100 pb-2">
          <CheckRow
            emphasis
            checked={selectedTypes.size === 0}
            label="전체"
            onChange={() => onSetTypes([])}
          />
        </div>

        {TYPE_GROUPS.map((g) => {
          const items = PROJECT_TYPES.filter((t) => t.group === g)
          const codes = items.map((t) => t.code)
          return (
            <div key={g} className="mt-3">
              <CheckRow
                checked={codes.every((c) => selectedTypes.has(c))}
                label={g}
                onChange={() => toggleGroup(codes, selectedTypes, onSetTypes)}
              />
              <div className="mt-1.5 flex flex-wrap gap-2 pl-1">
                {items.map((t) => (
                  <Pill
                    key={t.code}
                    dot
                    color={t.color}
                    label={t.label}
                    selected={selectedTypes.has(t.code)}
                    onClick={() => onToggleType(t.code)}
                  />
                ))}
              </div>
            </div>
          )
        })}

        <p className="mt-4 border-t border-gray-100 pt-2.5 text-[11px] leading-relaxed text-gray-400">
          경계 데이터에 포함된 유형은{' '}
          {PROJECT_TYPES.filter((t) => AVAILABLE_TYPES.has(t.code))
            .map((t) => t.label)
            .join(' · ')}{' '}
          입니다. 나머지는 별도 소스 연동 후 표시됩니다.
        </p>
      </FilterDropdown>

      {/* ── 진행단계 ── */}
      <FilterDropdown
        label={selectedStages.size ? `진행단계 ${selectedStages.size}` : '진행단계'}
        active={selectedStages.size > 0}
        open={open === 'stage'}
        onToggle={() => setOpen(open === 'stage' ? null : 'stage')}
        onClose={() => setOpen(null)}
        width="w-[400px]"
      >
        <div className="border-b border-gray-100 pb-2">
          <CheckRow
            emphasis
            checked={selectedStages.size === 0}
            label="전체"
            onChange={() => onSetStages([])}
          />
        </div>

        {STAGE_GROUPS.map((g) => {
          const items = STAGES.filter((s) => s.group === g)
          const codes = items.map((s) => s.code)
          return (
            <div key={g} className="mt-3">
              <CheckRow
                checked={codes.every((c) => selectedStages.has(c))}
                label={g}
                onChange={() => toggleGroup(codes, selectedStages, onSetStages)}
              />
              <div className="mt-1.5 flex flex-wrap gap-2 pl-1">
                {items.map((s) => (
                  <Pill
                    key={s.code}
                    label={s.label}
                    color={s.color}
                    selected={selectedStages.has(s.code)}
                    onClick={() => onToggleStage(s.code)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </FilterDropdown>

      {/* ── 매물 ── */}
      <FilterDropdown
        label="매물"
        active={false}
        open={open === 'listing'}
        onToggle={() => setOpen(open === 'listing' ? null : 'listing')}
        onClose={() => setOpen(null)}
        width="w-[440px]"
      >
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          ⚠️ 매물 데이터는 아직 연동되지 않았습니다. 조건은 저장되지만 지도에 반영되지 않습니다.
        </div>

        <p className="text-sm font-bold text-gray-800">유형</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { key: 'all', label: '전체', color: undefined as string | undefined, dot: false },
            { key: 'multi', label: '공동주택', color: '#4F46E5', dot: true },
            { key: 'single', label: '단독주택', color: '#10B981', dot: true },
            { key: 'etc', label: '기타', color: '#6B7280', dot: true },
          ].map((o) => (
            <Pill
              key={o.key}
              label={o.label}
              dot={o.dot}
              color={o.color}
              selected={unitKind === o.key}
              onClick={() => setUnitKind(o.key)}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <p className="text-sm font-bold text-gray-800">매매가</p>
          <button
            onClick={() => setPriceRange([0, 20])}
            className="text-xs font-bold text-indigo-600"
          >
            전체
          </button>
        </div>
        <div className="mt-2">
          <DualRange
            min={0}
            max={20}
            step={1}
            value={priceRange}
            onChange={setPriceRange}
            ticks={[0, 5, 10, 15, 20]}
            format={formatEok}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            ['전체', 0, 20],
            ['~ 1억', 0, 1],
            ['~ 3억', 0, 3],
            ['~ 4억', 0, 4],
            ['~ 5억', 0, 5],
            ['5 ~ 10억', 5, 10],
            ['10 ~ 15억', 10, 15],
            ['15 ~ 20억', 15, 20],
            ['20억 ~', 20, 20],
          ].map(([label, lo, hi]) => (
            <Pill
              key={label as string}
              label={label as string}
              selected={priceRange[0] === lo && priceRange[1] === hi}
              onClick={() => setPriceRange([lo as number, hi as number])}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <p className="flex items-center gap-1 text-sm font-bold text-gray-800">
            공시가 <span title="프리미엄 기능">👑</span>
          </p>
          <button
            onClick={() => setOfficialRange([0, 10])}
            className="text-xs font-bold text-indigo-600"
          >
            전체
          </button>
        </div>
        <div className="mt-2">
          <DualRange
            min={0}
            max={10}
            step={1}
            value={officialRange}
            onChange={setOfficialRange}
            ticks={[0, 2, 5, 10]}
            format={formatEok}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            ['전체', 0, 10],
            ['~ 1억', 0, 1],
            ['1 ~ 2억', 1, 2],
            ['2 ~ 3억', 2, 3],
            ['3 ~ 4억', 3, 4],
            ['4 ~ 5억', 4, 5],
            ['5 ~ 10억', 5, 10],
            ['10억 ~', 10, 10],
          ].map(([label, lo, hi]) => (
            <Pill
              key={label as string}
              label={label as string}
              selected={officialRange[0] === lo && officialRange[1] === hi}
              onClick={() => setOfficialRange([lo as number, hi as number])}
            />
          ))}
        </div>
      </FilterDropdown>
    </div>
  )
}
