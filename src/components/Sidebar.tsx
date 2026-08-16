'use client'

import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'
import type { ApiDevelop } from '@/lib/types'
import type { PanelKey } from './SidePanel'
import SearchBox from './SearchBox'

export default function Sidebar({
  develops,
  total,
  truncated,
  loading,
  onSelect,
  onOpenPanel,
  favoriteCount,
  onSearchZone,
  onSearchPlace,
}: {
  develops: ApiDevelop[]
  total: number
  truncated: boolean
  loading: boolean
  onSelect: (d: ApiDevelop) => void
  onOpenPanel: (key: PanelKey) => void
  favoriteCount: number
  onSearchZone: (id: string, bbox: [number, number, number, number]) => void
  onSearchPlace: (lng: number, lat: number) => void
}) {
  return (
    <aside className="relative flex w-[340px] shrink-0 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-indigo-900 text-sm font-black text-white">
            정
          </span>
          <span className="text-[15px] font-bold">정비사업 정보 플랫폼</span>
        </div>
        <div className="mt-3">
          <SearchBox onSelectZone={onSearchZone} onSelectPlace={onSearchPlace} />
        </div>
      </div>

      <div className="grid grid-cols-6 gap-1 border-b border-gray-100 px-2 py-2.5 text-center">
        {(
          [
            ['🔥', '인기', 'hot'],
            ['⭐', '관심', 'favorites'],
            ['✨', '신규', 'new'],
            ['📊', '실거래', 'transactions'],
            ['🏢', '매물', 'listings'],
            ['🔨', '경매', 'auctions'],
          ] as const
        ).map(([icon, label, key]) => (
          <button
            key={label}
            onClick={() => onOpenPanel(key)}
            className="relative rounded-lg py-1 hover:bg-gray-50"
          >
            <div className="text-lg">{icon}</div>
            <div className="text-[11px] text-gray-600">{label}</div>
            {key === 'favorites' && favoriteCount > 0 && (
              <span className="absolute top-0 right-1 rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {favoriteCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-sm font-bold">화면 안의 구역</h2>
        <span className="text-xs text-gray-400">
          {loading ? '불러오는 중…' : `${total.toLocaleString()}개`}
        </span>
      </div>

      {truncated && (
        <p className="mx-3 mb-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          구역이 많아 면적이 큰 순으로 {develops.length}개만 표시합니다. 지도를 확대해 보세요.
        </p>
      )}

      <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
        {!loading && develops.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-gray-400">
            이 화면에는 정비구역이 없습니다.
            <br />
            지도를 이동하거나 축소해 보세요.
          </p>
        )}
        {/* 원본에 같은 이름·면적의 도형이 여러 건 들어 있어 목록이 지저분해진다. 하나만 남긴다. */}
        {develops
          .filter(
            (d, i, arr) =>
              arr.findIndex((x) => x.name === d.name && x.areaM2 === d.areaM2) === i,
          )
          .map((d, i) => {
          const type = PROJECT_TYPE_MAP.get(d.projectType)
          return (
            <button
              // id는 병합 후 유일하지만, 데이터 이상으로 중복이 생기면
              // React 리스트 재조정이 깨져 옛 항목이 남는다. 인덱스를 덧붙여 방어한다.
              key={`${d.id}-${i}`}
              onClick={() => onSelect(d)}
              className="mb-1.5 w-full rounded-xl border border-gray-100 px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ background: type?.color }}
                >
                  {type?.label}
                </span>
                <span className="truncate text-sm font-bold">{d.name}</span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-xs">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-bold"
                  style={
                    d.stage
                      ? {
                          color: stageColor(d.canonicalStage),
                          background: `${stageColor(d.canonicalStage)}1A`,
                        }
                      : { color: '#9CA3AF', background: '#F3F4F6' }
                  }
                >
                  {d.stage ?? '단계 미확인'}
                </span>
                <span className="truncate text-gray-500">{d.rawLabel}</span>
              </p>
              <p className="mt-1 text-xs text-gray-400">
                면적 {d.areaM2.toLocaleString()}㎡
                {d.areaM2 > 0 && ` (${Math.round(d.areaM2 / 3.3058).toLocaleString()}평)`}
              </p>
            </button>
            )
          })}
      </div>

      <p className="border-t border-gray-100 px-4 py-2.5 text-[10px] leading-relaxed text-gray-400">
        출처: 서울 열린데이터광장 「서울시 의제처리구역 위치정보」 (공공누리 1유형).
        구역 경계는 참고자료이며 법적 효력이 없습니다.
      </p>
    </aside>
  )
}
