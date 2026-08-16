'use client'

import { PROJECT_TYPE_MAP } from '@/lib/taxonomy'
import type { ApiDevelop } from '@/lib/types'

/** 신뢰도 등급 배지 (기획서 4.4) */
function Grade({ grade }: { grade: 'A' | 'B' | 'C' | 'D' }) {
  const map = {
    A: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '공식' },
    B: { cls: 'bg-blue-50 text-blue-700 border-blue-200', label: '산출' },
    C: { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: '추정' },
    D: { cls: 'bg-gray-100 text-gray-500 border-gray-200', label: '미연동' },
  }[grade]
  return (
    <span className={`ml-1 rounded border px-1 py-px text-[10px] font-semibold ${map.cls}`}>
      {grade}·{map.label}
    </span>
  )
}

export default function DevelopPanel({
  develop,
  onClose,
}: {
  develop: ApiDevelop
  onClose: () => void
}) {
  const type = PROJECT_TYPE_MAP.get(develop.projectType)
  const pyeong = Math.round(develop.areaM2 / 3.3058)

  return (
    <aside className="thin-scroll absolute top-0 right-0 bottom-0 z-30 w-[380px] overflow-y-auto border-l border-gray-200 bg-white shadow-xl">
      <div className="sticky top-0 border-b border-gray-100 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ background: type?.color }}
            >
              {type?.label}
            </span>
            <h2 className="mt-1.5 text-lg leading-snug font-bold break-keep">{develop.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {develop.rawLabel}
              <Grade grade="A" />
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        <section>
          <h3 className="mb-2 text-sm font-bold">기본 정보</h3>
          <dl className="divide-y divide-gray-100 text-sm">
            <div className="flex items-center justify-between py-2">
              <dt className="text-gray-500">구역면적</dt>
              <dd className="font-semibold">
                {develop.areaM2.toLocaleString()}㎡
                <Grade grade="A" />
              </dd>
            </div>
            <div className="flex items-center justify-between py-2">
              <dt className="text-gray-500">평 환산</dt>
              <dd className="font-semibold">
                {pyeong.toLocaleString()}평
                <Grade grade="B" />
              </dd>
            </div>
            {develop.noticeSn && (
              <div className="flex items-center justify-between py-2">
                <dt className="text-gray-500">고시 일련번호</dt>
                <dd className="font-mono text-[11px] text-gray-600">{develop.noticeSn}</dd>
              </div>
            )}
          </dl>
        </section>

        {/* 아직 연동되지 않은 항목을 숨기지 않고 명시한다 */}
        <section>
          <h3 className="mb-2 text-sm font-bold">아직 연동되지 않은 정보</h3>
          <ul className="space-y-1.5 text-sm">
            {[
              ['진행단계 · 인가일', '서울 열린데이터광장 정비사업 현황 API'],
              ['토지등소유자 · 권리산정기준일', '고시문 파싱'],
              ['노후도 · 개발여건', '건축물대장 + 연속지적도'],
              ['실거래 · 매물 · 경매', '국토부 실거래 API 등'],
            ].map(([k, src]) => (
              <li
                key={k}
                className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2"
              >
                <span className="text-gray-600">{k}</span>
                <span className="shrink-0 text-right text-[11px] text-gray-400">{src}</span>
              </li>
            ))}
          </ul>
        </section>

        <button
          disabled
          className="w-full cursor-not-allowed rounded-lg bg-gray-100 py-2.5 text-sm font-bold text-gray-400"
        >
          💰 분담금 시뮬레이터 (Phase 2)
        </button>

        <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
          출처: 서울 열린데이터광장 「서울시 의제처리구역 위치정보」(공공누리 1유형). 구역 경계는
          참고자료이며 법적 효력이 없습니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.
        </p>
      </div>
    </aside>
  )
}
