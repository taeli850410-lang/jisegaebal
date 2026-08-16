'use client'

import type { Develop } from '@/lib/mock/develops'
import { PROJECT_TYPE_MAP, STAGES, STAGE_MAP, AVG_STAGE_MONTHS } from '@/lib/taxonomy'
import { formatPerPyeong } from '@/lib/geo'

/** 신뢰도 등급 배지 (기획서 4.4) */
function Grade({ grade }: { grade: 'A' | 'B' | 'C' | 'D' }) {
  const map = {
    A: { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: '공식' },
    B: { bg: 'bg-blue-50 text-blue-700 border-blue-200', label: '산출' },
    C: { bg: 'bg-amber-50 text-amber-700 border-amber-200', label: '추정' },
    D: { bg: 'bg-gray-100 text-gray-500 border-gray-200', label: '제보' },
  }[grade]
  return (
    <span className={`ml-1 rounded border px-1 py-px text-[10px] font-semibold ${map.bg}`}>
      {grade}·{map.label}
    </span>
  )
}

function monthsSince(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date('2026-08-16')
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

export default function DevelopPanel({
  develop,
  onClose,
}: {
  develop: Develop
  onClose: () => void
}) {
  const type = PROJECT_TYPE_MAP.get(develop.projectType)
  const stage = STAGE_MAP.get(develop.stage)
  const elapsed = monthsSince(develop.stageDate)
  const avg = AVG_STAGE_MONTHS[develop.stage]
  const delayed = avg ? elapsed > avg * 1.5 : false

  return (
    <aside className="thin-scroll absolute top-0 right-0 bottom-0 z-30 w-[380px] overflow-y-auto border-l border-gray-200 bg-white shadow-xl">
      {/* 헤더 */}
      <div className="sticky top-0 border-b border-gray-100 bg-white px-5 py-4">
        <div className="flex items-start justify-between">
          <div>
            <span
              className="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold text-white"
              style={{ background: type?.color }}
            >
              {type?.label}
            </span>
            <h2 className="mt-1.5 text-xl font-bold">{develop.name}</h2>
            <p className="mt-1 text-sm text-gray-500">
              {develop.stageRaw} ({develop.stageDate.replace(/-/g, '.')})
              <Grade grade="A" />
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          {[
            { label: '매물', value: `${develop.stats.listingCount}개` },
            { label: '경매', value: `${develop.stats.auctionCount}건` },
            { label: '커뮤니티', value: `${develop.stats.postCount}` },
          ].map((c) => (
            <div key={c.label} className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <p className="text-[11px] text-gray-500">{c.label}</p>
              <p className="text-sm font-bold">{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {/* 진행현황 */}
        <section>
          <h3 className="mb-2 text-sm font-bold">진행현황</h3>
          <ol className="space-y-0">
            {STAGES.filter((s) => s.group !== '완료').map((s) => {
              const done = stage ? s.order <= stage.order : false
              const current = s.code === develop.stage
              return (
                <li key={s.code} className="flex items-center gap-2 py-1">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                      current ? 'bg-indigo-600 ring-4 ring-indigo-100' : done ? 'bg-indigo-400' : 'bg-gray-200'
                    }`}
                  />
                  <span
                    className={`text-sm ${current ? 'font-bold text-gray-900' : done ? 'text-gray-600' : 'text-gray-400'}`}
                  >
                    {s.label}
                  </span>
                </li>
              )
            })}
          </ol>
          {avg && (
            <p
              className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                delayed ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-600'
              }`}
            >
              {delayed && '⚠️ '}
              <b>{elapsed}개월째 진행중</b> (동종 사업 평균 {avg}개월)
            </p>
          )}
        </section>

        {/* 구역정보 */}
        <section>
          <h3 className="mb-2 text-sm font-bold">구역정보</h3>
          <dl className="divide-y divide-gray-100 text-sm">
            {[
              { k: '구역면적', v: `${develop.stats.areaM2.toLocaleString()}㎡`, g: 'A' as const },
              {
                k: '토지등소유자',
                v: `${develop.stats.ownerCount.toLocaleString()}명`,
                g: develop.stats.ownerCountEstimated ? ('C' as const) : ('A' as const),
              },
              { k: '권리산정기준일', v: develop.stats.rightsBaseDate.replace(/-/g, '.'), g: 'A' as const },
              {
                k: '대지평당가',
                v: formatPerPyeong(develop.stats.landPricePerPyeong),
                g: 'B' as const,
              },
            ].map((row) => (
              <div key={row.k} className="flex items-center justify-between py-2">
                <dt className="text-gray-500">{row.k}</dt>
                <dd className="font-semibold">
                  {row.v}
                  <Grade grade={row.g} />
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 노후도 */}
        <section>
          <h3 className="mb-2 text-sm font-bold">
            노후도 (30년 기준)
            <Grade grade="B" />
          </h3>
          <div className="space-y-2">
            {[
              { label: '현재', value: develop.stats.agingNow },
              { label: '5년 후', value: develop.stats.aging5y },
              { label: '10년 후', value: develop.stats.aging10y },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <span className="w-12 shrink-0 text-xs text-gray-500">{row.label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-indigo-500"
                    style={{ width: `${row.value}%` }}
                  />
                </div>
                <span className="w-9 text-right text-xs font-semibold">{row.value}%</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-gray-400">
            정비구역 지정 요건 충족 시점을 가늠하는 지표입니다.
          </p>
        </section>

        <button className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
          💰 분담금 시뮬레이터 (Phase 2)
        </button>

        <p className="border-t border-gray-100 pt-3 text-[11px] leading-relaxed text-gray-400">
          본 정보는 공개 데이터를 가공한 참고용이며, 법적 효력이 있는 정보는 반드시 원본
          공부(등기부등본·건축물대장·고시문)로 확인하시기 바랍니다. 본 서비스는 중개·감정평가·투자자문을
          제공하지 않습니다.
        </p>
      </div>
    </aside>
  )
}
