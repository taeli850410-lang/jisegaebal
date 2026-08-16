'use client'

import { useState } from 'react'
import { PROJECT_TYPES, STAGES, type ProjectTypeGroup, type StageGroup } from '@/lib/taxonomy'

interface Props {
  selectedTypes: Set<string>
  selectedStages: Set<string>
  onToggleType: (code: string) => void
  onToggleStage: (code: string) => void
  onReset: () => void
}

const STAGE_GROUPS: StageGroup[] = ['추진중', '진행중', '완료']

const TYPE_GROUPS: ProjectTypeGroup[] = ['민간주도', '공공주도', '소규모', '기타']

/** SHP에 실제로 존재하는 유형만 활성화한다 (나머지는 별도 소스 연동 필요) */
const AVAILABLE = new Set(['redev', 'rebuild_apt', 'garo', 'small_rebuild'])

export default function FilterBar({
  selectedTypes,
  selectedStages,
  onToggleType,
  onToggleStage,
  onReset,
}: Props) {
  const [open, setOpen] = useState<'type' | 'stage' | null>(null)

  return (
    <div className="absolute top-3 left-3 z-20 flex items-start gap-2">
      <button
        onClick={onReset}
        title="필터 초기화"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50"
      >
        ↺
      </button>

      <div className="relative">
        <button
          onClick={() => setOpen(open === 'type' ? null : 'type')}
          className={`h-9 rounded-lg border px-3 text-sm font-medium shadow-sm ${
            selectedTypes.size
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {selectedTypes.size === 0 ? '사업종류' : `사업종류 ${selectedTypes.size}`} ▾
        </button>
        {open === 'type' && (
          <div className="thin-scroll absolute top-11 left-0 max-h-[60vh] w-64 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            {TYPE_GROUPS.map((g) => (
              <div key={g} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-xs font-bold text-gray-400">{g}</p>
                {PROJECT_TYPES.filter((t) => t.group === g).map((t) => {
                  const enabled = AVAILABLE.has(t.code)
                  return (
                    <label
                      key={t.code}
                      title={enabled ? undefined : '이 유형은 아직 데이터가 연동되지 않았습니다'}
                      className={`flex items-center gap-2 rounded px-1 py-1.5 ${
                        enabled ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed opacity-40'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!enabled}
                        checked={selectedTypes.has(t.code)}
                        onChange={() => onToggleType(t.code)}
                        className="h-4 w-4 accent-indigo-600"
                      />
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: t.color }}
                      />
                      <span className="text-sm text-gray-700">{t.label}</span>
                    </label>
                  )
                })}
              </div>
            ))}
            <p className="mt-1 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
              흐린 항목은 서울시 의제처리구역 SHP에 포함되지 않는 유형입니다. 신통기획·모아타운 등은
              별도 소스 연동이 필요합니다.
            </p>
          </div>
        )}
      </div>

      <div className="relative">
        <button
          onClick={() => setOpen(open === 'stage' ? null : 'stage')}
          className={`h-9 rounded-lg border px-3 text-sm font-medium shadow-sm ${
            selectedStages.size
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          {selectedStages.size === 0 ? '진행단계' : `진행단계 ${selectedStages.size}`} ▾
        </button>
        {open === 'stage' && (
          <div className="absolute top-11 left-0 w-56 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
            {STAGE_GROUPS.map((g) => (
              <div key={g} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-xs font-bold text-gray-400">{g}</p>
                {STAGES.filter((s) => s.group === g).map((s) => (
                  <label
                    key={s.code}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedStages.has(s.code)}
                      onChange={() => onToggleStage(s.code)}
                      className="h-4 w-4 accent-indigo-600"
                    />
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: s.color }}
                    />
                    <span className="text-sm text-gray-700">{s.label}</span>
                  </label>
                ))}
              </div>
            ))}
            <p className="mt-1 border-t border-gray-100 pt-2 text-[11px] leading-relaxed text-gray-400">
              진행단계는 정비몽땅 사업장을 대표지번 공간조인으로 연결한 값입니다. 단계가 확인되지
              않은 구역은 필터에서 제외됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
