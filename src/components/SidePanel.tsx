'use client'

import { useCallback, useEffect, useState } from 'react'
import { getFavorites, getViews, subscribeStore } from '@/lib/userStore'
import ZoneDealCard, { type ZoneDeals } from './panels/ZoneDealCard'
import HotPanel from './panels/HotPanel'
import AuctionPanel from './panels/AuctionPanel'
import {
  Empty,
  PanelHint,
  RankRow,
  StageBadge,
  TypeBadge,
  areaLabel,
  type DevelopBrief,
} from './panels/shared'

/** 지역 선택에서 서울 전체를 가리키는 값 (HotPanel 과 같은 규칙) */
const ALL_GU = 'all'

export type PanelKey = 'hot' | 'favorites' | 'new' | 'transactions' | 'listings' | 'auctions'
export type { DevelopBrief }

/**
 * 더보기 버튼.
 *
 * 한 번에 전부 펼치면 수백 개가 쏟아져 스크롤이 무의미해진다.
 * 누를 때마다 한 묶음씩 이어 붙여 계속 내려보게 한다.
 */
function MoreButton({
  total,
  shown,
  step,
  onMore,
}: {
  total: number
  shown: number
  step: number
  onMore: () => void
}) {
  if (total <= shown) return null
  const next = Math.min(step, total - shown)
  return (
    <button
      onClick={onMore}
      className="mx-3 my-2 w-[calc(100%-1.5rem)] rounded-lg border border-gray-200 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-50"
    >
      {next}개 더보기 <span className="font-normal text-gray-400">({shown}/{total})</span>
    </button>
  )
}

const TITLES: Record<PanelKey, string> = {
  hot: '인기 구역',
  favorites: '관심 구역',
  new: '신규 구역',
  transactions: '지역별 실거래',
  listings: '매물',
  auctions: '공매 (온비드)',
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

  /* 관심 */
  const [favSort, setFavSort] = useState<'recent' | 'added' | 'name'>('added')

  /* 실거래 */
  const [days, setDays] = useState<7 | 30>(30)

  /**
   * 목록은 10개씩 끊어 보여주고, 더보기를 누를 때마다 10개씩 이어 붙인다.
   * (인기 탭은 HotPanel이 자체 관리)
   */
  const TOP_N = 10
  const [shown, setShown] = useState(TOP_N)
  useEffect(() => setShown(TOP_N), [panel, gu, days])
  const cut = <T,>(list: T[]) => list.slice(0, shown)
  const more = () => setShown((n) => n + TOP_N)
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

  /** 구역 id 하나로 상세를 연다 — 공매 항목처럼 구역 객체가 없는 곳에서 쓴다 */
  const selectById = useCallback(
    async (id: string) => {
      const [d] = await fetchByIds([id])
      if (d) onSelect(d)
    },
    [fetchByIds, onSelect],
  )

  /* 자치구 목록 — 실거래·인기·경매에서 공용 */
  useEffect(() => {
    if (gus.length) return
    if (panel !== 'transactions' && panel !== 'hot' && panel !== 'auctions') return
    fetch('/api/develops/browse?meta=gu')
      .then((r) => r.json())
      .then((j) => setGus(j.gus ?? []))
      .catch(() => {})
  }, [panel, gus.length])

  /* 구역별 실거래 (지역별 실거래 패널) */
  useEffect(() => {
    if (panel !== 'transactions' || !gu) {
      setZoneDeals([])
      setZdMeta(null)
      return
    }
    let cancelled = false
    setZdLoading(true)

    const one = (g: string) =>
      fetch(`/api/zone-transactions?gu=${encodeURIComponent(g)}&days=${days}`)
        .then((r) => r.json())
        .catch(() => ({ zones: [], matchedDeals: 0, fetchedDeals: 0 }))

    /*
     * 서울 전체는 구별로 나눠 부른다.
     * 서버에서 25개 구를 한 번에 돌면 함수 시간 한도를 넘고(FUNCTION_INVOCATION_TIMEOUT),
     * 구를 따로 볼 때 만들어둔 캐시도 못 쓴다.
     */
    if (gu === ALL_GU) {
      const names = gus.map((g) => g.gu)
      const acc: ZoneDeals[] = []
      let matched = 0
      let fetched = 0
      ;(async () => {
        for (let i = 0; i < names.length && !cancelled; i += 5) {
          const part = await Promise.all(names.slice(i, i + 5).map(one))
          if (cancelled) return
          for (const j of part) {
            acc.push(...((j.zones ?? []) as ZoneDeals[]))
            matched += j.matchedDeals ?? 0
            fetched += j.fetchedDeals ?? 0
          }
          setZoneDeals([...acc].sort((a, b) => b.dealCount - a.dealCount))
          setZdMeta({ matched, fetched })
        }
        if (!cancelled) setZdLoading(false)
      })()
      return () => {
        cancelled = true
      }
    }

    one(gu)
      .then((j) => {
        if (cancelled) return
        setZoneDeals(j.zones ?? [])
        setZdMeta({ matched: j.matchedDeals ?? 0, fetched: j.fetchedDeals ?? 0 })
      })
      .finally(() => !cancelled && setZdLoading(false))
    return () => {
      cancelled = true
    }
  }, [panel, gu, days, gus])

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
  }, [panel, favSort, tick, fetchByIds])

  const GuSelect = (
    <select
      value={gu}
      onChange={(e) => setGu(e.target.value)}
      className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
    >
      <option value="">구/군 선택</option>
      {panel === 'transactions' && <option value={ALL_GU}>서울 전체</option>}
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
        <HotPanel
          gus={gus}
          onSelect={onSelect}
          onFocus={onFocus}
          fetchByIds={fetchByIds}
          storeTick={tick}
        />
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
              <p className="text-sm font-bold">{gu === ALL_GU ? '서울 전체' : gu} 실거래</p>
              <div className="flex gap-1">
                {([7, 30] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`rounded-lg px-3 py-1 text-xs font-bold ${
                      days === d
                        ? 'bg-indigo-600 text-white'
                        : 'border border-gray-200 bg-white text-gray-500'
                    }`}
                  >
                    {d}일
                  </button>
                ))}
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
          <Empty text={"매물 데이터는 아직 연동되지 않았습니다.\n중개사 매물 등록 또는 제휴 연동이 필요합니다."} />
        )}
        {panel === 'auctions' && (
          <AuctionPanel gu={gu === ALL_GU ? '' : gu} guSelect={GuSelect} onSelectZone={selectById} />
        )}

        {/* 관심 */}
        {panel === 'favorites' && !loading && (
          <>
            {items.length === 0 && (
              <Empty text={"관심 구역이 없습니다.\n구역 상세에서 ♡를 눌러 추가하세요."} />
            )}
            {items.map((d) => (
              <button
                key={d.id}
                onClick={() => onSelect(d)}
                className="list-row flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
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
                  {areaLabel(d)}
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
            {cut(items).map((d, i) => (
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
            <MoreButton total={items.length} shown={cut(items).length} step={TOP_N} onMore={more} />
          </>
        )}

        {/* 지역별 실거래 */}
        {panel === 'transactions' && !zdLoading && (
          <>
            {!gu && <Empty text="구/군을 선택하면 구역별 실거래를 보여줍니다." />}
            {gu && zoneDeals.length === 0 && (
              <Empty text={"선택 기간에 구역 안에서 신고된 거래가 없습니다.\n기간을 넓혀보세요."} />
            )}
            {cut(zoneDeals).map((z) => (
              <ZoneDealCard key={z.id} zone={z} onOpen={onFocus} />
            ))}
            <MoreButton total={zoneDeals.length} shown={cut(zoneDeals).length} step={TOP_N} onMore={more} />
            {gu && zdMeta && (
              <p className="px-4 py-3 text-[11px] leading-relaxed text-gray-400">
                {gu === ALL_GU ? '서울 전체' : gu}에서 최근 6개월 {zdMeta.fetched.toLocaleString()}건을 조회해 구역 경계 안{' '}
                {zdMeta.matched.toLocaleString()}건을 연결했습니다. 구역 밖 거래는 제외됩니다.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
