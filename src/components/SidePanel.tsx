'use client'

import { useCallback, useEffect, useState } from 'react'
import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'
import { getFavorites, getViews, subscribeStore } from '@/lib/userStore'

export type PanelKey = 'hot' | 'favorites' | 'new' | 'transactions' | 'listings' | 'auctions'

export interface DevelopBrief {
  id: string
  name: string
  projectType: string
  rawLabel: string
  areaM2: number
  gu: string | null
  dong: string | null
  noticeDate: string | null
  stage: string | null
  canonicalStage: string | null
  center: [number, number] | null
  bbox: [number, number, number, number]
}

const TITLES: Record<PanelKey, string> = {
  hot: '인기 구역',
  favorites: '관심 구역',
  new: '신규 구역',
  transactions: '지역별 실거래',
  listings: '매물',
  auctions: '경매',
}

/* ───────────── 공통 조각 ───────────── */

function TypeBadge({ code }: { code: string }) {
  const t = PROJECT_TYPE_MAP.get(code)
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
      style={{ background: t?.color ?? '#888' }}
    >
      {t?.short ?? '기타'}
    </span>
  )
}

function StageText({ d }: { d: DevelopBrief }) {
  return (
    <span
      className="text-[11px] font-semibold"
      style={{ color: d.stage ? stageColor(d.canonicalStage) : '#9CA3AF' }}
    >
      {d.stage ?? '단계 미확인'}
    </span>
  )
}

function Row({
  d,
  rank,
  right,
  onSelect,
}: {
  d: DevelopBrief
  rank?: number
  right?: React.ReactNode
  onSelect: (d: DevelopBrief) => void
}) {
  return (
    <button
      onClick={() => onSelect(d)}
      className="flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-2.5 text-left hover:bg-gray-50"
    >
      {rank !== undefined && (
        <span className="w-5 shrink-0 text-center text-xs font-bold text-gray-400">{rank}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <TypeBadge code={d.projectType} />
          <span className="truncate text-sm font-bold">{d.name}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <StageText d={d} />
          {d.gu && <span className="text-[11px] text-gray-400">· {d.gu}</span>}
        </div>
      </div>
      {right}
      <span className="shrink-0 text-gray-300">›</span>
    </button>
  )
}

function Tabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { key: T; label: string; disabled?: boolean; hint?: string }[]
  onChange: (k: T) => void
}) {
  return (
    <div className="flex gap-1 px-4 py-2.5">
      {options.map((o) => (
        <button
          key={o.key}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-bold transition ${
            o.disabled
              ? 'cursor-not-allowed bg-gray-50 text-gray-300'
              : value === o.key
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NotConnected({ what, need }: { what: string; need: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-bold text-gray-500">{what} 데이터 미연동</p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-400">
        {need}
        <br />
        연동 전까지는 목록을 제공하지 않습니다.
      </p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-10 text-center text-sm text-gray-400">{text}</p>
}

/* ───────────── 본체 ───────────── */

export default function SidePanel({
  panel,
  onClose,
  onSelect,
}: {
  panel: PanelKey
  onClose: () => void
  onSelect: (d: DevelopBrief) => void
}) {
  const [items, setItems] = useState<DevelopBrief[]>([])
  const [loading, setLoading] = useState(false)
  const [hotTab, setHotTab] = useState<'views' | 'volume' | 'price'>('views')
  const [favSort, setFavSort] = useState<'recent' | 'added' | 'name'>('added')
  const [gus, setGus] = useState<{ gu: string; count: number }[]>([])
  const [gu, setGu] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => subscribeStore(() => setTick((t) => t + 1)), [])

  const fetchByIds = useCallback(async (ids: string[]) => {
    if (!ids.length) return []
    const res = await fetch(`/api/develops/browse?ids=${ids.join(',')}`)
    const json = await res.json()
    return (json.items ?? []) as DevelopBrief[]
  }, [])

  /* 자치구 목록 (지역별 실거래 탭에서 사용) */
  useEffect(() => {
    if (panel !== 'transactions' || gus.length) return
    fetch('/api/develops/browse?meta=gu')
      .then((r) => r.json())
      .then((j) => setGus(j.gus ?? []))
      .catch(() => {})
  }, [panel, gus.length])

  /* 패널별 데이터 로드 */
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
        } else if (panel === 'hot') {
          if (hotTab !== 'views') {
            if (!cancelled) setItems([])
          } else {
            const top = getViews()
              .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
              .slice(0, 30)
            const list = await fetchByIds(top.map((v) => v.id))
            if (!cancelled) setItems(list)
          }
        } else if (panel === 'transactions') {
          if (!gu) {
            if (!cancelled) setItems([])
          } else {
            const res = await fetch(
              `/api/develops/browse?gu=${encodeURIComponent(gu)}&sort=notice&limit=100`,
            )
            const json = await res.json()
            if (!cancelled) setItems(json.items ?? [])
          }
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
  }, [panel, favSort, hotTab, gu, tick, fetchByIds])

  const views = getViews()

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <button
          onClick={onClose}
          aria-label="뒤로"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ‹
        </button>
        <h2 className="flex-1 text-lg font-bold">{TITLES[panel]}</h2>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          ✕
        </button>
      </div>

      {/* 패널별 컨트롤 */}
      {panel === 'hot' && (
        <>
          <Tabs
            value={hotTab}
            onChange={setHotTab}
            options={[
              { key: 'volume', label: '거래량순', disabled: true, hint: '국토부 실거래 API 미연동' },
              { key: 'views', label: '조회순' },
              { key: 'price', label: '가격순', disabled: true, hint: '국토부 실거래 API 미연동' },
            ]}
          />
          <p className="px-4 pb-2 text-[11px] leading-relaxed text-gray-400">
            조회순은 <b>이 브라우저에서 열어본 횟수</b> 기준입니다. 전체 이용자 기준 인기도는 계정·집계
            서버가 필요합니다.
          </p>
        </>
      )}

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

      {panel === 'new' && (
        <p className="border-b border-gray-50 px-4 py-2.5 text-xs text-gray-500">
          최근 <b>고시일</b>이 늦은 구역부터 보여줍니다.
        </p>
      )}

      {panel === 'transactions' && (
        <div className="border-b border-gray-50 px-4 py-2.5">
          <div className="flex gap-2">
            <select
              disabled
              className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-500"
            >
              <option>서울특별시</option>
            </select>
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
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
            ⚠️ 실거래가는 아직 미연동입니다. 지금은 선택한 구의 <b>정비구역 목록</b>만 보여줍니다.
          </p>
        </div>
      )}

      {/* 목록 */}
      <div className="thin-scroll flex-1 overflow-y-auto">
        {loading && <p className="px-4 py-8 text-center text-sm text-gray-400">불러오는 중…</p>}

        {!loading && panel === 'listings' && (
          <NotConnected what="매물" need="중개사 매물 등록 또는 제휴 연동이 필요합니다." />
        )}
        {!loading && panel === 'auctions' && (
          <NotConnected what="경매" need="법원경매정보 수집 연동이 필요합니다." />
        )}

        {!loading && panel === 'hot' && hotTab !== 'views' && (
          <NotConnected
            what={hotTab === 'volume' ? '거래량' : '가격'}
            need="국토교통부 실거래가 API 연동이 필요합니다."
          />
        )}

        {!loading && panel === 'hot' && hotTab === 'views' && items.length === 0 && (
          <Empty text="아직 열어본 구역이 없습니다. 지도에서 구역을 눌러보세요." />
        )}
        {!loading && panel === 'favorites' && items.length === 0 && (
          <Empty text="관심 구역이 없습니다. 구역 상세에서 ♡를 눌러 추가하세요." />
        )}
        {!loading && panel === 'transactions' && !gu && (
          <Empty text="구/군을 선택하면 해당 지역 정비구역을 보여줍니다." />
        )}

        {!loading &&
          items.map((d, i) => (
            <Row
              key={d.id}
              d={d}
              rank={panel === 'new' || panel === 'hot' ? i + 1 : undefined}
              onSelect={onSelect}
              right={
                panel === 'hot' && hotTab === 'views' ? (
                  <span className="shrink-0 text-sm font-bold text-orange-500">
                    {views.find((v) => v.id === d.id)?.count ?? 0}회
                  </span>
                ) : panel === 'new' && d.noticeDate ? (
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {d.noticeDate.replace(/-/g, '.').slice(2)}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] text-gray-400">
                    {Math.round(d.areaM2 / 3.3058).toLocaleString()}평
                  </span>
                )
              }
            />
          ))}
      </div>
    </div>
  )
}
