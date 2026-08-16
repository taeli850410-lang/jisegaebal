'use client'

import { useEffect, useState } from 'react'
import { PROJECT_TYPES, PROJECT_TYPE_MAP } from '@/lib/taxonomy'
import { getViews } from '@/lib/userStore'
import Sparkline from './Sparkline'
import { Empty, formatPerPyeong, type DevelopBrief } from './shared'
import type { ZoneDeals } from './ZoneDealCard'

type Tab = 'volume' | 'views' | 'price'

/** 탭마다 강조색이 다르다 — 상위 3위를 그 색으로 물들여 순위를 즉시 인지시킨다 */
const ACCENT: Record<Tab, string> = {
  volume: '#2563EB',
  views: '#F97316',
  price: '#10B981',
}

const HEADINGS: Record<Tab, { icon: string; title: string; desc: string }> = {
  volume: {
    icon: '📊',
    title: '가장 많이 거래된 구역',
    desc: '선택 기간에 구역 안에서 가장 활발히 거래된 정비구역을 확인해보세요',
  },
  views: {
    icon: '🔥',
    title: '가장 많이 조회된 구역',
    desc: '가장 관심받고 있는 정비구역을 확인해보세요 (이 브라우저 조회 기준)',
  },
  price: {
    icon: '💠',
    title: '대지평당가가 높은 구역',
    desc: '다세대 실거래의 대지평당가 중앙값 기준 (표본 3건 이상만 집계)',
  },
}

/** 표본이 1~2건이면 시세가 아니라 우연이라 랭킹에서 제외한다 */
const MIN_PRICE_SAMPLE = 3

const PERIODS: Record<Tab, { key: number; label: string }[]> = {
  volume: [
    { key: 30, label: '30일' },
    { key: 90, label: '90일' },
    { key: 365, label: '1년' },
  ],
  price: [
    { key: 30, label: '30일' },
    { key: 90, label: '90일' },
    { key: 365, label: '1년' },
  ],
  views: [
    { key: 0, label: '실시간' },
    { key: 30, label: '30일' },
    { key: 90, label: '90일' },
    { key: 365, label: '1년' },
  ],
}

/** 지역 선택에서 "서울 전체"를 가리키는 값 */
const ALL_GU = 'all'

export default function HotPanel({
  gus,
  onSelect,
  onFocus,
  fetchByIds,
  storeTick,
}: {
  gus: { gu: string; count: number }[]
  onSelect: (d: DevelopBrief) => void
  onFocus: (bbox: [number, number, number, number], id: string) => void
  fetchByIds: (ids: string[]) => Promise<DevelopBrief[]>
  storeTick: number
}) {
  const [tab, setTab] = useState<Tab>('volume')
  const [gu, setGu] = useState('')
  const [type, setType] = useState('')
  const [period, setPeriod] = useState(90)

  const [zones, setZones] = useState<ZoneDeals[]>([])
  const [views, setViews] = useState<DevelopBrief[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const TOP_N = 10
  const accent = ACCENT[tab]
  const heading = HEADINGS[tab]

  // 탭을 바꾸면 그 탭의 기본 기간으로 되돌린다 (탭마다 기간 체계가 다르다)
  useEffect(() => {
    setExpanded(false)
    if (tab === 'volume') setPeriod(90)
    else if (tab === 'views') setPeriod(0)
    else setPeriod(90)
  }, [tab])

  useEffect(() => setExpanded(false), [gu, type, period])

  /* 거래량순 · 가격순 — 실거래 기반 */
  useEffect(() => {
    if (tab === 'views' || !gu) {
      setZones([])
      return
    }
    let cancelled = false
    setLoading(true)
    const kinds = tab === 'price' ? '&kinds=villa' : ''
    fetch(`/api/zone-transactions?gu=${encodeURIComponent(gu)}&days=${period}${kinds}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setZones(j.zones ?? []))
      .catch(() => !cancelled && setZones([]))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tab, gu, period])

  /* 조회순 — 로컬 조회 기록 */
  useEffect(() => {
    if (tab !== 'views') return
    let cancelled = false
    setLoading(true)
    const since = period ? Date.now() - period * 86400_000 : 0
    const top = getViews()
      .filter((v) => v.lastAt >= since)
      .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
      .slice(0, 40)
    fetchByIds(top.map((v) => v.id))
      .then((list) => !cancelled && setViews(list))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [tab, period, storeTick, fetchByIds])

  const viewCounts = getViews()

  /* 공통 행 데이터로 정규화 */
  type Row = {
    id: string
    name: string
    projectType: string
    stage: string | null
    value: string
    /** 가격순에서 중앙값 산출 표본 수 — 근거를 숨기지 않는다 */
    sample?: number | null
    changePct: number | null
    series: { ym: string; value: number | null }[] | null
    open: () => void
  }

  let rows: Row[] = []

  if (tab === 'views') {
    rows = views
      .filter((d) => !type || d.projectType === type)
      .map((d) => ({
        id: d.id,
        name: d.name,
        projectType: d.projectType,
        stage: d.stage,
        value: `${viewCounts.find((v) => v.id === d.id)?.count ?? 0}명`,
        changePct: null,
        series: null,
        open: () => onSelect(d),
      }))
  } else {
    const sorted = [...zones]
      .filter((z) => !type || z.projectType === type)
      // 가격순은 표본이 너무 적으면 시세가 아니라 우연이다. 최소 3건을 요구한다.
      .filter((z) => tab !== 'price' || (z.priceSampleCount ?? 0) >= MIN_PRICE_SAMPLE)
      .sort((a, b) =>
        tab === 'volume'
          ? b.dealCount - a.dealCount
          : (b.medianPerPyeong ?? 0) - (a.medianPerPyeong ?? 0),
      )
    rows = sorted.map((z) => ({
      id: z.id,
      name: z.name,
      projectType: z.projectType,
      stage: z.stage,
      sample: tab === 'price' ? (z.priceSampleCount ?? 0) : null,
      value:
        tab === 'volume'
          ? `${z.dealCount}건`
          : z.medianPerPyeong
            ? `${formatPerPyeong(z.medianPerPyeong)}/평`
            : '—',
      changePct: z.changePct,
      series: z.series,
      open: () => onFocus(z.bbox, z.id),
    }))
  }

  const shown = expanded ? rows : rows.slice(0, TOP_N)

  return (
    <>
      {/* 탭 */}
      <div className="flex gap-1.5 px-4 py-3">
        {(
          [
            ['volume', '📊 거래량순'],
            ['views', '🔥 조회순'],
            ['price', '💠 가격순'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg py-2 text-xs font-bold whitespace-nowrap transition ${
              tab === k
                ? 'text-white shadow-sm'
                : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
            }`}
            style={tab === k ? { background: ACCENT[k] } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 제목 + 설명 */}
      <div className="px-4 pb-3">
        <p className="flex items-center gap-1.5 text-[15px] font-bold text-gray-900">
          <span>{heading.icon}</span>
          {heading.title}
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-400">{heading.desc}</p>
      </div>

      {/* 기간 */}
      {PERIODS[tab].length > 0 && (
        <div className="flex gap-1.5 px-4 pb-2.5">
          {PERIODS[tab].map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                period === p.key
                  ? 'text-white'
                  : 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
              }`}
              style={period === p.key ? { background: accent } : undefined}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* 지역 · 사업종류 */}
      <div className="flex gap-2 px-4 pb-3">
        <select
          value={gu}
          onChange={(e) => setGu(e.target.value)}
          disabled={tab === 'views'}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-300"
        >
          <option value="">{tab === 'views' ? '전국' : '지역 선택'}</option>
          {tab !== 'views' && <option value={ALL_GU}>서울 전체</option>}
          {gus.map((g) => (
            <option key={g.gu} value={g.gu}>
              {g.gu}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
        >
          <option value="">전체</option>
          {PROJECT_TYPES.filter((t) =>
            ['redev', 'rebuild_apt', 'garo', 'small_rebuild'].includes(t.code),
          ).map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* 목록 */}
      <div className="thin-scroll flex-1 overflow-y-auto border-t border-gray-100">
        {loading && <p className="px-4 py-10 text-center text-sm text-gray-400">불러오는 중…</p>}

        {!loading && tab !== 'views' && !gu && (
          <Empty text="지역을 선택하면 순위를 계산합니다." />
        )}
        {!loading && tab === 'views' && rows.length === 0 && (
          <Empty text={"아직 열어본 구역이 없습니다.\n지도에서 구역을 눌러보세요."} />
        )}
        {!loading && tab !== 'views' && gu && rows.length === 0 && (
          <Empty text={"선택 조건에 해당하는 거래가 없습니다.\n기간을 넓히거나 사업종류를 바꿔보세요."} />
        )}

        {!loading &&
          shown.map((r, i) => {
            const top3 = i < 3
            const t = PROJECT_TYPE_MAP.get(r.projectType)
            return (
              <button
                key={r.id}
                onClick={r.open}
                className="flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
              >
                <span
                  className="w-4 shrink-0 text-center text-sm font-bold"
                  style={{ color: top3 ? accent : '#9CA3AF' }}
                >
                  {i + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={top3 ? { color: accent } : undefined}>
                    <span style={{ color: top3 ? accent : t?.color }}>{t?.short ?? ''}</span>{' '}
                    {r.name}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-400">
                    {r.stage ?? '단계 미확인'}
                  </p>
                </div>

                {r.series && <Sparkline series={r.series} width={44} height={20} />}

                <div className="w-[72px] shrink-0 text-right">
                  <p className="text-sm font-bold" style={{ color: top3 ? accent : '#374151' }}>
                    {r.value}
                  </p>
                  {r.changePct != null && r.changePct !== 0 && (
                    <p
                      className={`text-[10px] font-semibold ${
                        r.changePct > 0 ? 'text-rose-500' : 'text-blue-500'
                      }`}
                    >
                      {r.changePct > 0 ? '↑' : '↓'} {Math.abs(r.changePct)}%
                    </p>
                  )}
                  {r.sample != null && (
                    <p className="text-[10px] text-gray-400">표본 {r.sample}건</p>
                  )}
                </div>
              </button>
            )
          })}

        {!loading && rows.length > shown.length && (
          <button
            onClick={() => setExpanded(true)}
            className="mx-3 my-2.5 w-[calc(100%-1.5rem)] rounded-lg border border-gray-200 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50"
          >
            나머지 {rows.length - shown.length}개 더보기
          </button>
        )}
      </div>
    </>
  )
}
