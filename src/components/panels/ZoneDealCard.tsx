'use client'

import Sparkline from './Sparkline'
import { StageBadge, TypeBadge, formatEok, formatPerPyeong } from './shared'

export interface ZoneDeals {
  id: string
  name: string
  projectType: string
  rawLabel: string
  stage: string | null
  canonicalStage: string | null
  bbox: [number, number, number, number]
  deals: {
    typeLabel: string
    dealDate: string
    price: number
    dong: string
    jibun: string
    buildingName: string | null
    floor: number | null
    buildYear: number | null
    exclusiveAr: number | null
    landPyeong: number | null
    pricePerLandPyeong: number | null
    isDirect: boolean
    registered?: boolean
  }[]
  dealCount: number
  medianPerPyeong: number | null
  priceSampleCount?: number
  changePct: number | null
  series: { ym: string; value: number | null }[]
}

/** 지역별 실거래 화면의 구역 단위 카드 */
export default function ZoneDealCard({
  zone,
  onOpen,
}: {
  zone: ZoneDeals
  onOpen: (bbox: [number, number, number, number], id: string) => void
}) {
  const up = (zone.changePct ?? 0) > 0
  const flat = zone.changePct == null || zone.changePct === 0

  return (
    <div className="mx-3 mb-2.5 rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-start gap-2 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-bold">{zone.name}</span>
            <button
              onClick={() => onOpen(zone.bbox, zone.id)}
              className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 hover:bg-indigo-100"
            >
              자세히 보기 →
            </button>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <TypeBadge code={zone.projectType} />
            <StageBadge stage={zone.stage} canonical={zone.canonicalStage} />
            <span className="text-[11px] font-semibold text-indigo-600">
              {zone.dealCount}건의 거래
            </span>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <Sparkline series={zone.series} />
          <p className="text-[12px] font-bold text-gray-800">
            {zone.medianPerPyeong ? `${formatPerPyeong(zone.medianPerPyeong)}/평` : '—'}
          </p>
          <p
            className={`text-[10px] font-semibold ${
              flat ? 'text-gray-400' : up ? 'text-rose-500' : 'text-blue-500'
            }`}
          >
            {flat ? '전월대비 —' : `전월대비 ${up ? '↑' : '↓'} ${Math.abs(zone.changePct!)}%`}
          </p>
        </div>
      </div>

      <table className="mt-2 w-full text-[11px]">
        <thead>
          <tr className="border-y border-gray-50 text-gray-400">
            <th className="py-1 pl-3 text-left font-medium">계약일</th>
            <th className="py-1 text-left font-medium">유형</th>
            <th className="py-1 text-left font-medium">주소</th>
            <th className="py-1 text-right font-medium">가격</th>
            <th className="py-1 pr-3 text-right font-medium">대지지분</th>
          </tr>
        </thead>
        <tbody>
          {zone.deals.slice(0, 6).map((d, i) => (
            <tr key={i} className="border-b border-gray-50 last:border-0 align-top">
              <td className="py-1.5 pl-3 whitespace-nowrap text-gray-500">
                {d.dealDate.slice(5).replace('-', '. ')}
              </td>
              <td className="py-1.5 whitespace-nowrap">
                <span className="text-gray-700">{d.typeLabel}</span>
                {d.buildYear && <div className="text-[10px] text-gray-400">{d.buildYear}년</div>}
              </td>
              <td className="max-w-[110px] py-1.5 pr-1">
                <div className="truncate text-gray-700">
                  {d.dong} {d.jibun}
                </div>
                <div className="truncate text-[10px] text-gray-400">
                  {d.buildingName ?? ''}
                  {d.floor ? ` ${d.floor}층` : ''}
                  {d.exclusiveAr ? ` 전용 ${(d.exclusiveAr / 3.3058).toFixed(1)}평` : ''}
                </div>
              </td>
              <td className="py-1.5 text-right whitespace-nowrap">
                {d.isDirect && (
                  <span className="mr-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">
                    직
                  </span>
                )}
                {/* 등기일자가 찍혔으면 소유권 이전까지 끝난 거래다 */}
                {d.registered && (
                  <span className="mr-1 rounded bg-gray-100 px-1 text-[9px] font-bold text-gray-500">
                    등기
                  </span>
                )}
                <span className="font-bold text-gray-800">{formatEok(d.price)}</span>
              </td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {d.pricePerLandPyeong && (
                  <div className="font-bold text-indigo-600">
                    {formatPerPyeong(d.pricePerLandPyeong)}/평
                  </div>
                )}
                {d.landPyeong && <div className="text-gray-400">{d.landPyeong}평</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
