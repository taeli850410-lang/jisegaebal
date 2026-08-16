'use client'

import type { Develop } from '@/lib/mock/develops'
import { PROJECT_TYPE_MAP } from '@/lib/taxonomy'
import { formatPerPyeong } from '@/lib/geo'

export default function Sidebar({
  develops,
  onSelect,
}: {
  develops: Develop[]
  onSelect: (d: Develop) => void
}) {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* 헤더 */}
      <div className="border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded bg-indigo-900 text-sm font-black text-white">
            정
          </span>
          <span className="text-[15px] font-bold">정비사업 정보 플랫폼</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-gray-400">🔍</span>
          <input
            placeholder="구역 이름, 주소, 지하철역으로 검색"
            className="w-full text-sm outline-none placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* 퀵메뉴 */}
      <div className="grid grid-cols-6 gap-1 border-b border-gray-100 px-2 py-2.5 text-center">
        {[
          ['🔥', '인기'],
          ['⭐', '관심'],
          ['✨', '신규'],
          ['📊', '실거래'],
          ['🏢', '매물'],
          ['🔨', '경매'],
        ].map(([icon, label]) => (
          <button key={label} className="rounded-lg py-1 hover:bg-gray-50">
            <div className="text-lg">{icon}</div>
            <div className="text-[11px] text-gray-600">{label}</div>
          </button>
        ))}
      </div>

      {/* 구역 리스트 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h2 className="text-sm font-bold">구역 목록</h2>
        <span className="text-xs text-gray-400">{develops.length}개</span>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
        {develops.length === 0 && (
          <p className="px-2 py-8 text-center text-sm text-gray-400">
            조건에 맞는 구역이 없습니다.
          </p>
        )}
        {develops.map((d) => {
          const type = PROJECT_TYPE_MAP.get(d.projectType)
          return (
            <button
              key={d.id}
              onClick={() => onSelect(d)}
              className="mb-1.5 w-full rounded-xl border border-gray-100 px-3 py-3 text-left transition hover:border-indigo-200 hover:bg-indigo-50/40"
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ background: type?.color }}
                >
                  {type?.label}
                </span>
                <span className="text-sm font-bold">{d.name}</span>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {d.stageRaw} · 노후도 {d.stats.agingNow}%
              </p>
              <div className="mt-1.5 flex items-center gap-3 text-xs">
                <span className="font-semibold text-indigo-700">
                  {formatPerPyeong(d.stats.landPricePerPyeong)}
                </span>
                <span className="text-gray-400">매물 {d.stats.listingCount}</span>
                <span className="text-gray-400">경매 {d.stats.auctionCount}</span>
              </div>
            </button>
          )
        })}
      </div>

      <p className="border-t border-gray-100 px-4 py-2.5 text-[10px] leading-relaxed text-gray-400">
        목업 데이터입니다. 실제 서비스는 PostGIS bbox 쿼리로 구역을 내려받습니다.
      </p>
    </aside>
  )
}
