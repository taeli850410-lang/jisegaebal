'use client'

import { useCallback, useEffect, useState } from 'react'
import { getFavorites, getViews, subscribeStore } from '@/lib/userStore'
import ZoneDealCard, { type ZoneDeals } from './panels/ZoneDealCard'
import {
  Empty,
  PanelHint,
  RankRow,
  SegTabs,
  StageBadge,
  TypeBadge,
  formatPerPyeong,
  type DevelopBrief,
} from './panels/shared'

export type PanelKey = 'hot' | 'favorites' | 'new' | 'transactions' | 'listings' | 'auctions'
export type { DevelopBrief }

const TITLES: Record<PanelKey, string> = {
  hot: '인기 구역',
  favorites: '관심 구역',
  new: '신규 구역',
  transactions: '지역별 실거래',
  listings: '매물',
  auctions: '경매',
}

export default function SidePanel({
  panel,
  onClose,
  onSelect,
  onFocus,
}: {
  panel: PanelKey
  onClose: () => void
  onSelect: (d: DevelopBrief) => void
  onFocus: (bbox: [number, number, number, number], id: string) => void
}) {
  /* 공통 */
  const [items, setItems] = useState<DevelopBrief[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const [gus, setGus] = useState<{ gu: string; count: number }[]>([])
  const [gu, setGu] = useState('')

  /* 인기 */
  const [hotTab, setHotTab] = useState<'volume' | 'views' | 'price'>('views')
  const [hotDays, setHotDays] = useState<7 | 30 | 90>(30)

  /* 관심 */
  const [favSort, setFavSort] = useState<'recent' | 'added' | 'name'>('added')

  /* 실거래 */
  const [days, setDays] = useState<7 | 30>(30)
  const [zoneDeals, setZoneDeals] = useState<ZoneDeals[]>([])
  const [zdLoading, setZdLoading] = useState(false)
  const [zdMeta, setZdMeta] = useState<{ matched: number; fetched: number } | null>(null)

  useEffect(() => subscribeStore(() => setTick((t) => t + 1)), [])

  const fetchByIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return []
    const res = await fetch(`/api/develops/browse?ids=${ids.join(',')}`)
    const json = await res.json()
    return (json.items ?? []) as DevelopBrief[]
  }, [])

  /* 자치구 목록 — 실거래·인기에서 공용 */
  useEffect(() => {
    if (gus.length) return
    if (panel !== 'transactions' && panel !== 'hot') return
    fetch('/api/develops/browse?meta=gu')
      .then((r) => r.json())
      .then((j) => setGus(j.gus ?? []))
      .catch(() => {})
  }, [panel, gus.length])

  /* 구역별 실거래 (실거래 패널 + 인기 거래량/가격순이 함께 쓴다) */
  const needsZoneDeals =
    (panel === 'transactions' && !!gu) || (panel === 'hot' && hotTab !== 'views' && !!gu)

  useEffect(() => {
    if (!needsZoneDeals) {
      setZoneDeals([])
      setZdMeta(null)
      return
    }
    let cancelled = false
    setZdLoading(true)
    const d = panel === 'hot' ? hotDays : days
    fetch(`/api/zone-transactions?gu=${encodeURIComponent(gu)}&days=${d}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setZoneDeals(j.zones ?? [])
        setZdMeta({ matched: j.matchedDeals ?? 0, fetched: j.fetchedDeals ?? 0 })
      })
      .catch(() => !cancelled && setZoneDeals([]))
      .finally(() => !cancelled && setZdLoading(false))
    return () => {
      cancelled = true
    }
  }, [needsZoneDeals, gu, days, hotDays, panel])

  /* 신규 · 관심 · 인기(조회순) */
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        if (panel === 'new') {
          const res = await fetch('/api/develops/browse?sort=notice&limit=50')
          const json = await res.json()
          if (!cancelled) setItems(json.items ?? [])
        } else if (panel === 'favorites') {
          const favs = getFavorites()
          const views = getViews()
          const sorted = [...favs].sort((a, b) => {
            if (favSort === 'added') return b.addedAt - a.addedAt
            if (favSort === 'recent') {
              const va = views.find((v) => v.id === a.id)?.lastAt ?? 0
              const vb = views.find((v) => v.id === b.id)?.lastAt ?? 0
              return vb - va
            }
            return 0
          })
          let list = await fetchByIds(sorted.map((f) => f.id))
          if (favSort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
          if (!cancelled) setItems(list)
        } else if (panel === 'hot' && hotTab === 'views') {
          const top = getViews()
            .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
            .slice(0, 30)
          const list = await fetchByIds(top.map((v) => v.id))
          if (!cancelled) setItems(list)
        } else if (!cancelled) {
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [panel, favSort, hotTab, tick, fetchByIds])

  const views = getViews()

  /* 인기 - 거래량순 / 가격순은 구역별 실거래에서 파생한다 */
  const hotRanked = [...zoneDeals].sort((a, b) =>
    hotTab === 'volume'
      ? b.dealCount - a.dealCount
      : (b.medianPerPyeong ?? 0) - (a.medianPerPyeong ?? 0),
  )

  const GuSelect = (
    <select
      value={gu}
      onChange={(e) => setGu(e.target.value)}
      className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
    >
      <option value="">구/군 선택</option>
      {gus.map((g) => (
        <option key={g.gu} value={g.gu}>
          {g.gu} ({g.count})
        </option>
      ))}
    </select>
  )

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <button
          onClick={onClose}
          aria-label="뒤로"
          className="rounded px-1 text-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </button>
        <h2 className="flex-1 text-lg font-bold">{TITLES[panel]}</h2>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-500"
        >
          ✕
        </button>
      </div>

      {/* ── 인기 ── */}
      {panel === 'hot' && (
        <>
          <SegTabs
            value={hotTab}
            onChange={setHotTab}
            options={[
              { key: 'volume', label: '거래량순', icon: '📊' },
              { key: 'views', label: '조회순', icon: '🔥' },
              { key: 'price', label: '가격순', icon: '💠' },
            ]}
          />
          {hotTab === 'views' ? (
            <PanelHint
              title="가장 많이 조회된 구역"
              desc="이 브라우저에서 열어본 횟수 기준입니다. 전체 이용자 집계는 계정·집계 서버가 필요합니다."
            />
          ) : (
            <>
              <div className="px-4 pb-2">
                <div className="flex gap-2">{GuSelect}</div>
                <div className="mt-2">
                  <SegTabs
                    size="sm"
                    value={hotDays}
                    onChange={setHotDays}
                    options={[
                      { key: 7, label: '7일' },
                      { key: 30, label: '30일' },
                      { key: 90, label: '90일' },
                    ]}
                  />
                </div>
              </div>
              <PanelHint
                title={hotTab === 'volume' ? '가장 많이 거래된 구역' : '대지평당가가 높은 구역'}
                desc={
                  hotTab === 'volume'
                    ? '선택 기간 내 구역 안에서 신고된 실거래 건수 기준입니다.'
                    : '선택 기간 실거래의 대지평당가 중앙값 기준입니다.'
                }
              />
            </>
          )}
        </>
      )}

      {/* ── 관심 ── */}
      {panel === 'favorites' && (
        <div className="flex gap-3 border-b border-gray-50 px-4 py-2.5 text-xs">
          {(
            [
              ['recent', '최근 본 순'],
              ['added', '추가순'],
              ['name', '이름순'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFavSort(k)}
              className={favSort === k ? 'font-bold text-indigo-600' : 'text-gray-400'}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ── 신규 ── */}
      {panel === 'new' && (
        <PanelHint
          title="최근 고시된 구역"
          desc="고시 일련번호에서 추출한 고시일이 늦은 순서입니다."
        />
      )}

      {/* ── 지역별 실거래 ── */}
      {panel === 'transactions' && (
        <div className="border-b border-gray-50 px-4 py-2.5">
          <div className="flex gap-2">
            <select
              disabled
              className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-500"
            >
              <option>서울특별시</option>
            </select>
            {GuSelect}
          </div>
          {gu && (
            <div className="mt-2.5 flex items-center justify-between">
              <p className="text-sm font-bold">{gu} 실거래</p>
              <div className="flex w-32 gap-1">
                <SegTabs
                  size="sm"
                  value={days}
                  onChange={setDays}
                  options={[
                    { key: 7, label: '7일' },
                    { key: 30, label: '30일' },
                  ]}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 목록 ── */}
      <div className="thin-scroll flex-1 overflow-y-auto pt-2">
        {(loading || zdLoading) && (
          <p className="px-4 py-8 text-center text-sm text-gray-400">불러오는 중…</p>
        )}

        {panel === 'listings' && !loading && (
          <Empty text="매물 데이터는 아직 연동되지 않았습니다.\n중개사 매물 등록 또는 제휴 연동이 필요합니다." />
        )}
        {panel === 'auctions' && !loading && (
          <Empty text="경매 데이터는 아직 연동되지 않았습니다.\n법원경매정보 수집 연동이 필요합니다." />
        )}

        {/* 인기 - 조회순 */}
        {panel === 'hot' && hotTab === 'views' && !loading && (
          <>
            {items.length === 0 && (
              <Empty text="아직 열어본 구역이 없습니다. 지도에서 구역을 눌러보세요." />
            )}
            {items.map((d, i) => (
              <RankRow
                key={d.id}
                rank={i + 1}
                d={d}
                onSelect={onSelect}
                right={
                  <span className="shrink-0 text-sm font-bold text-orange-500">
                    {views.find((v) => v.id === d.id)?.count ?? 0}회
                  </span>
                }
              />
            ))}
          </>
        )}

        {/* 인기 - 거래량순 / 가격순 */}
        {panel === 'hot' && hotTab !== 'views' && !zdLoading && (
          <>
            {!gu && <Empty text="구/군을 선택하면 순위를 계산합니다." />}
            {gu && hotRanked.length === 0 && (
              <Empty text="선택 기간에 구역 안에서 신고된 거래가 없습니다." />
            )}
            {hotRanked.map((z, i) => (
              <button
                key={z.id}
                onClick={() => onFocus(z.bbox, z.id)}
                className="flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-2.5 text-left hover:bg-gray-50"
              >
                <span className="w-5 shrink-0 text-center text-xs font-bold text-gray-400">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <TypeBadge code={z.projectType} />
                    <span className="truncate text-sm font-bold">{z.name}</span>
                  </div>
                  <div className="mt-0.5">
                    <StageBadge stage={z.stage} canonical={z.canonicalStage} />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold text-indigo-600">
                  {hotTab === 'volume'
                    ? `${z.dealCount}건`
                    : z.medianPerPyeong
                      ? `${formatPerPyeong(z.medianPerPyeong)}/평`
                      : '—'}
                </span>
              </button>
            ))}
          </>
        )}

        {/* 관심 */}
        {panel === 'favorites' && !loading && (
          <>
            {items.length === 0 && (
              <Empty text="관심 구역이 없습니다.\n구역 상세에서 ♡를 눌러 추가하세요." />
            )}
            {items.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelect(d)}
                className="flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <TypeBadge code={d.projectType} />
                    <span className="truncate text-sm font-bold">{d.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <StageBadge stage={d.stage} canonical={d.canonicalStage} />
                    {d.gu && <span className="text-[11px] text-gray-400">{d.gu}</span>}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">
                  {Math.round(d.areaM2 / 3.3058).toLocaleString()}평
                </span>
                <span className="shrink-0 text-gray-300">›</span>
              </button>
            ))}
          </>
        )}

        {/* 신규 */}
        {panel === 'new' && !loading && (
          <>
            <button className="mx-3 mb-3 w-[calc(100%-1.5rem)] rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700">
              🔔 새로운 구역 알림받기
            </button>
            {items.map((d, i) => (
              <RankRow
                key={d.id}
                rank={i + 1}
                d={d}
                onSelect={onSelect}
                right={
                  d.noticeDate ? (
                    <span className="shrink-0 text-[11px] text-gray-400">
                      {d.noticeDate.replace(/-/g, '.').slice(2)}
                    </span>
                  ) : null
                }
              />
            ))}
          </>
        )}

        {/* 지역별 실거래 */}
        {panel === 'transactions' && !zdLoading && (
          <>
            {!gu && <Empty text="구/군을 선택하면 구역별 실거래를 보여줍니다." />}
            {gu && zoneDeals.length === 0 && (
              <Empty text="선택 기간에 구역 안에서 신고된 거래가 없습니다.\n기간을 넓혀보세요." />
            )}
            {zoneDeals.map((z) => (
              <ZoneDealCard key={z.id} zone={z} onOpen={onFocus} />
            ))}
            {gu && zdMeta && (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-gray-400">
                {gu}에서 최근 6개월 {zdMeta.fetched.toLocaleString()}건을 조회해 구역 경계 안{' '}
                {zdMeta.matched.toLocaleString()}건을 연결했습니다. 구역 밖 거래는 제외됩니다.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
