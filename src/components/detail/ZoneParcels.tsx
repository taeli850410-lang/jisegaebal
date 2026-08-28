'use client'

import { useEffect, useState } from 'react'

/**
 * 구역 내 물건 — 지번 단위 카드.
 *
 * 중개 매물이 없어도 구역 안에서 살 수 있는 것들을 다 보여준다.
 * 벤치마크 매물 카드의 값 중 우리가 못 내는 건 "지금 얼마에 나와 있나" 하나뿐이고,
 * 나머지(대지면적·공시지가·용도·세대수·사용승인·공시가격·대지지분·최근 실거래)는
 * 전부 공공데이터다.
 *
 * 호가는 저장하지 않는다. 링크로 넘긴다 — 링크는 복제가 아니라서 남의
 * 데이터베이스를 건드리지 않는다.
 */

interface Card {
  pnu: string
  jibun: string
  dong: string
  landM2: number
  landPyeong: number
  jigaPerPyeong: number | null
  purpose: string | null
  households: number | null
  approvalDate: string | null
  buildYear: number | null
  far: number | null
  bcr: number | null
  priceYear: number | null
  unitCount: number
  minUnitPrice: number | null
  maxUnitPrice: number | null
  landShareMinPyeong: number | null
  landShareMaxPyeong: number | null
  unitSource: 'price' | 'expos' | 'whole' | 'none'
  lastDeal: { date: string; price: number; typeLabel: string; landPyeong: number | null } | null
  naverUrl: string
}

const EOK = 100_000_000
const eok = (won: number | null) =>
  !won ? '—' : won >= EOK ? `${(won / EOK).toFixed(2).replace(/\.?0+$/, '')}억` : `${Math.round(won / 10_000).toLocaleString()}만`

export default function ZoneParcels({ zoneId }: { zoneId: string }) {
  const [data, setData] = useState<{
    total: number
    withBuilding: number
    withPrice: number
    withExpos: number
    withWhole: number
    withLandShare: number
    cards: Card[]
    unavailable?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [shown, setShown] = useState(6)
  const [onlyBuilt, setOnlyBuilt] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setShown(6)
    fetch(`/api/zone-parcels?id=${encodeURIComponent(zoneId)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setData(j))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [zoneId])

  if (loading) return <p className="note-box note-box--center">필지를 불러오는 중…</p>
  if (!data) return null

  if (data.unavailable) {
    return (
      <p className="note-box note-box--center">
        {data.unavailable === 'NO_KEY'
          ? '연속지적도 인증키가 설정되지 않았습니다.'
          : '연속지적도(V-World)를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'}
      </p>
    )
  }

  const list = onlyBuilt ? data.cards.filter((c) => c.purpose) : data.cards

  return (
    <>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-gray-500">
          필지 <b className="text-gray-700">{data.total.toLocaleString()}</b>개 · 건물{' '}
          {data.withBuilding} · 대지지분 <b className="text-gray-700">{data.withLandShare}</b>
        </p>
        <button
          onClick={() => {
            setOnlyBuilt((v) => !v)
            setShown(6)
          }}
          className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
            onlyBuilt ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          건물 있는 필지만
        </button>
      </div>

      {list.length === 0 && (
        <p className="note-box note-box--center">조건에 맞는 필지가 없습니다.</p>
      )}

      <ul className="space-y-2">
        {list.slice(0, shown).map((c) => (
          <li key={c.pnu} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold">
                  {c.dong} {c.jibun}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {[c.purpose, c.households ? `${c.households}세대` : null, c.buildYear ? `${c.buildYear}년` : null]
                    .filter(Boolean)
                    .join(' · ') || '건축물대장 기록 없음'}
                </p>
              </div>
              <a
                href={c.naverUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                title="이 지번의 매물을 네이버 부동산에서 검색합니다"
              >
                매물 보기 ↗
              </a>
            </div>

            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <div className="flex justify-between border-b border-gray-50 py-0.5">
                <dt className="text-gray-500">필지면적</dt>
                <dd className="font-semibold tabular-nums">{c.landPyeong}평</dd>
              </div>
              <div className="flex justify-between border-b border-gray-50 py-0.5">
                <dt className="text-gray-500">공시지가</dt>
                <dd className="font-semibold tabular-nums">
                  {c.jigaPerPyeong ? `${Math.round(c.jigaPerPyeong / 10000).toLocaleString()}만/평` : '—'}
                </dd>
              </div>
              {c.unitSource === 'price' && (
                <div className="flex justify-between border-b border-gray-50 py-0.5">
                  <dt className="text-gray-500">공시가격</dt>
                  <dd className="font-semibold tabular-nums">
                    {c.minUnitPrice === c.maxUnitPrice
                      ? eok(c.minUnitPrice)
                      : `${eok(c.minUnitPrice)}~${eok(c.maxUnitPrice)}`}
                  </dd>
                </div>
              )}
              {c.landShareMinPyeong != null && (
                <div className="flex justify-between border-b border-gray-50 py-0.5">
                  <dt className="text-gray-500">
                    대지지분
                    {/* 어디서 온 면적으로 나눴는지 밝힌다 — 정밀도가 다르다 */}
                    <span className="ml-1 text-[9px] text-gray-300">
                      {c.unitSource === 'price' ? '공시' : c.unitSource === 'expos' ? '대장' : '단독'}
                    </span>
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {c.landShareMinPyeong === c.landShareMaxPyeong
                      ? `${c.landShareMinPyeong}평`
                      : `${c.landShareMinPyeong}~${c.landShareMaxPyeong}평`}
                  </dd>
                </div>
              )}
              {Boolean(c.far || c.bcr) && (
                <div className="flex justify-between border-b border-gray-50 py-0.5">
                  <dt className="text-gray-500">용적·건폐</dt>
                  <dd className="font-semibold tabular-nums">
                    {c.far ? `${Math.round(c.far)}%` : '—'} / {c.bcr ? `${Math.round(c.bcr)}%` : '—'}
                  </dd>
                </div>
              )}
              {c.approvalDate && (
                <div className="flex justify-between border-b border-gray-50 py-0.5">
                  <dt className="text-gray-500">사용승인</dt>
                  <dd className="font-semibold tabular-nums">
                    {c.approvalDate.replace(/-/g, '.')}
                  </dd>
                </div>
              )}
            </dl>

            {c.lastDeal && (
              <p className="mt-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-[11px] text-indigo-800">
                최근 실거래 <b>{eok(c.lastDeal.price)}</b>
                <span className="ml-1 text-indigo-400">
                  {c.lastDeal.date.replace(/-/g, '.')} · {c.lastDeal.typeLabel}
                  {c.lastDeal.landPyeong ? ` · 지분 ${c.lastDeal.landPyeong}평` : ''}
                </span>
              </p>
            )}
          </li>
        ))}
      </ul>

      {list.length > shown && (
        <button
          onClick={() => setShown((n) => n + 10)}
          className="mt-2 w-full rounded-lg border border-gray-200 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50"
        >
          더보기 <span className="font-normal text-gray-400">({shown}/{list.length})</span>
        </button>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        <b>대지지분은 추정값</b>입니다 — 필지면적을 호별 전용면적 비율로 안분한 값이라 등기부상
        대지권과 다를 수 있습니다. 호별 전용면적은 공동주택 공시가격(<b>공시</b>)이나 집합건축물대장
        전유부(<b>대장</b>)에서 옵니다. <b>단독</b>은 집합건물이 아니어서 필지 전체가 곧
        대지지분인 경우입니다(단독·다가구·근생 등). 어느 쪽인지 항목에 표시했습니다. <b>호가는 저장하지 않습니다.</b> 「매물 보기」는 그 지번을 네이버
        부동산에서 검색하는 링크이며, 우리 서버는 매물 정보를 갖고 있지 않습니다. 출처 — 필지·공시지가:
        연속지적도(V-World) / 건축물: 건축물대장 / 공시가격: 공동주택 공시가격 / 실거래: 국토교통부.
      </p>
    </>
  )
}
