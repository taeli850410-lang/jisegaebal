'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { PROJECT_TYPE_MAP, STAGES, stageColor } from '@/lib/taxonomy'
import { resolveStage } from '@/lib/stage'
import { isFavorite, toggleFavorite } from '@/lib/userStore'
import type { ApiDevelop } from '@/lib/types'
import DealChart, { type ChartPoint } from './detail/DealChart'
import BurdenSimulator from './detail/BurdenSimulator'
import ZoneReport from './detail/ZoneReport'
import ShareCard from './detail/ShareCard'
import { resolveRightsDate, verifyLinks } from '@/lib/rightsDate'
import { molitErrorMessage } from '@/lib/molitError'

/** 매칭 방식에 따라 신뢰도가 다르다 — 숨기지 않고 드러낸다 */
const MATCH_LABEL: Record<string, { text: string; grade: 'A' | 'B' | 'C' }> = {
  id: { text: '안건번호 정확 일치', grade: 'A' },
  point: { text: '구역 내 대표지번 일치', grade: 'A' },
  near: { text: '대표지번 근접(50m 이내)', grade: 'B' },
  name: { text: '사업장명 일치', grade: 'B' },
  'name~': { text: '사업장명 부분 일치', grade: 'C' },
}

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

interface Deal {
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
}

interface Nearby {
  id: string
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  areaM2: number
  noticeDate: string | null
  distanceKm: number
  bbox: [number, number, number, number]
}

/** 정비몽땅 사업개요 제원 */
interface ZoneSummary {
  siteName: string
  address: string | null
  areaM2: number | null
  memberCount: number | null
  landOwnerCount: number | null
  tenantCount: number | null
  useZone: string | null
  useDistrict: string | null
  siteAreaM2: number | null
  totalFloorAreaM2: number | null
  bcr: number | null
  far: number | null
  floors: string | null
  landUseHousing: number | null
  landUseRoad: number | null
  landUsePark: number | null
  landUseGreen: number | null
}

/** 정비몽땅 추진경과에서 온 단계별 인가일 */
interface ZoneProgress {
  /** 정비몽땅 사업장 페이지 경로 조각 — 자료실에서 원문으로 보낸다 */
  cafeUrl: string | null
  siteName: string
  dates: Record<string, { date: string; rawStage: string; noticeNo: string | null }>
  history: {
    stage: string
    date: string
    note: string | null
    noticeNo: string | null
    vendor: string | null
  }[]
}

/** 인근에서 실제로 삽을 떴거나 준공된 구역 */
interface ConstructionZone extends Nearby {
  startDate: string | null
  completeDate: string | null
}

interface NewsItem {
  title: string
  source: string | null
  date: string | null
  link: string
}

/** 연속지적도 + 건축물대장으로 산출한 구역 통계 */
interface ZoneStats {
  parcelCount: number
  households: { total: number; apt: number; house: number }
  aging: { base: number; denominator: number; now: number; in5: number; in10: number }
  conditions: {
    smallParcels: number
    parcels: number
    withBasement: number
    residentialBuildings: number
    householdsPerHa: number | null
    abutting?: number
    abuttingBase?: number
    semiBasement?: number
    totalBuildings?: number
  }
  actual?: {
    far: number | null
    bcr: number | null
    platAreaM2: number
    buildings: number
    useZones: { label: string; areaM2: number }[]
    roadMix: { label: string; count: number }[]
  }
  landUse: { label: string; areaM2: number }[]
  landPrice: { medianPerM2: number; samples: number } | null
  regulations?: { label: string; scope: 'all' | 'partial' }[]
  ownership?: { sampled: number; byOwner: { label: string; areaM2: number }[] }
  landCharSampled?: number
  source: string
}

/** 정비몽땅 사업개요의 계획 표들 */
interface ZonePlan {
  siteName: string
  supplySale: { total: number | null; byArea: { label: string; households: number }[] } | null
  supplyRent: { total: number | null; byArea: { label: string; households: number }[] } | null
  maxHeightM: number | null
  floors: string | null
  mainUse: string | null
  facilities: { label: string; areaM2: number }[]
  improvement: {
    total: number | null
    keep: number | null
    repair: number | null
    rebuild: number | null
  } | null
  schedule: string | null
  office: { address: string | null; phone: string | null } | null
  drawings: { location?: string; aerial?: string; layout?: string } | null
}

interface FullData {
  zone: ApiDevelop & {
    dong: string | null
    noticeDate: string | null
    summary: ZoneSummary | null
    progress: ZoneProgress | null
    stats: ZoneStats | null
    plan: ZonePlan | null
    /** false 면 정비구역 고시 전 사업장 — 경계·면적·고시일이 원본에 없다 */
    hasBoundary?: boolean
    jibun?: string
    precision?: 'lot' | 'near'
    cafeUrl?: string | null
  }
  deals: Deal[]
  dealCount: number
  medianPerPyeong: number | null
  series: ChartPoint[]
  kindLabels: Record<string, string>
  nearby: (Nearby & {
    memberCount: number | null
    far: number | null
    bcr: number | null
    floors: string | null
  })[]
  apartments: Apartment[]
  constructionZones: ConstructionZone[]
  stageDurations: Record<string, { avgMonths: number; samples: number }>
  unavailable: string | null
}

/** 인근 아파트 — 이 구역이 완성되면 얼마쯤 되나의 기준점 */
interface Apartment {
  name: string
  buildYear: number | null
  ageYears: number | null
  distanceKm: number
  households: number | null
  buildings: number | null
  useApprovalDate: string | null
  areas: { pyeong: number; exclusiveAr: number; price: number; dealDate: string }[]
}

const eok = (won: number) =>
  won >= 100_000_000
    ? `${(won / 100_000_000).toFixed(2).replace(/\.?0+$/, '')}억`
    : `${Math.round(won / 10_000).toLocaleString()}만`

const perPyeong = (won: number) =>
  won >= 100_000_000
    ? `${(won / 100_000_000).toFixed(1)}억`
    : `${Math.round(won / 10_000).toLocaleString()}만`

/**
 * 뉴스 검색어용 구역명.
 * "주택재개발정비사업구역" 같은 꼬리표가 붙으면 기사가 하나도 안 걸린다.
 * 기사에 실제로 쓰이는 고유명만 남긴다.
 */
function shortenForSearch(name: string): string {
  const s = name
    .replace(/^[가-힣]{1,3}구\s+/, '')
    .replace(
      /(주택재개발|주택재건축|도시환경|주거환경개선|주거환경관리|재정비촉진|가로주택|소규모재건축)?정비사업(구역)?$/,
      '',
    )
    .replace(/(사업)?구역$/, '')
    .trim()
  return s.length >= 2 ? s : name
}

const TABS = [
  { key: 'deals', label: '실거래' },
  { key: 'progress', label: '진행현황' },
  { key: 'library', label: '자료실' },
  { key: 'info', label: '구역정보' },
  { key: 'news', label: '뉴스' },
  { key: 'nearby', label: '인근 구역' },
  { key: 'apts', label: '인근 아파트' },
  { key: 'construction', label: '신축 공사' },
] as const

/**
 * 현재 구역 ↔ 인근 구역 가로 비교표.
 *
 * 값이 하나도 없는 행은 빈 칸만 늘어나므로 통째로 뺀다.
 * (정비몽땅 사업개요가 없는 구역이 많아, 안 그러면 표가 대부분 대시가 된다)
 */
function CompareTable({
  zone,
  sum,
  nearby,
}: {
  zone: ApiDevelop & { dong?: string | null }
  sum: ZoneSummary | null
  nearby: FullData['nearby']
}) {
  interface Col {
    name: string
    self: boolean
    stage: string | null
    projectType: string
    areaM2: number
    memberCount: number | null
    far: number | null
    bcr: number | null
    floors: string | null
    distanceKm: number
  }

  const cols: Col[] = [
    {
      name: zone.name,
      self: true,
      stage: zone.stage ?? null,
      projectType: zone.projectType,
      areaM2: zone.areaM2,
      memberCount: sum?.memberCount ?? null,
      far: sum?.far ?? null,
      bcr: sum?.bcr ?? null,
      floors: sum?.floors ?? null,
      distanceKm: 0,
    },
    ...nearby.slice(0, 3).map((n) => ({
      name: n.name,
      self: false,
      stage: n.stage,
      projectType: n.projectType,
      areaM2: n.areaM2,
      memberCount: n.memberCount,
      far: n.far,
      bcr: n.bcr,
      floors: n.floors,
      distanceKm: n.distanceKm,
    })),
  ]

  // 배열 리터럴에 바로 .filter 를 붙이면 문맥 타입이 콜백 인자까지 흐르지 않는다.
  // 타입을 붙인 변수에 먼저 담고 나서 거른다.
  const allRows: { label: string; get: (c: Col) => string | null }[] = [
    {
      label: '사업종류',
      get: (c) => PROJECT_TYPE_MAP.get(c.projectType)?.label ?? null,
    },
    { label: '진행단계', get: (c) => c.stage ?? null },
    { label: '사업면적', get: (c) => `${(c.areaM2 / 10000).toFixed(1)}만㎡` },
    {
      label: '조합원',
      get: (c) => (c.memberCount ? `${c.memberCount.toLocaleString()}명` : null),
    },
    { label: '용적률', get: (c) => (c.far != null ? `${c.far}%` : null) },
    { label: '건폐율', get: (c) => (c.bcr != null ? `${c.bcr}%` : null) },
    { label: '층수', get: (c) => c.floors ?? null },
  ]
  const rows = allRows.filter((r) => cols.some((c) => r.get(c)))

  return (
    <>
      <h4 className="mt-5 mb-2 text-[13px] font-bold">비교</h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] text-[11px]">
          <thead>
            <tr>
              <th className="w-14" />
              {cols.map((c) => (
                <th key={c.name} className="px-1 pb-1.5 align-bottom">
                  <span
                    className="block truncate rounded px-1 py-0.5 text-[10px] font-bold"
                    style={{
                      background: c.self ? '#4F46E51A' : '#F3F4F6',
                      color: c.self ? '#4F46E5' : '#6B7280',
                    }}
                    title={c.name}
                  >
                    {c.name}
                  </span>
                  {!c.self && (
                    <span className="mt-0.5 block text-[10px] font-normal text-gray-400">
                      {c.distanceKm}km
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-gray-100">
                <td className="py-1.5 text-gray-400">{r.label}</td>
                {cols.map((c) => (
                  <td
                    key={c.name}
                    className={`px-1 py-1.5 text-center ${
                      c.self ? 'font-bold text-gray-900' : 'text-gray-600'
                    }`}
                  >
                    {r.get(c) ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** 사진의 "전체 세대 수 / 1,899 (95%)" 처럼 값과 비율을 한 줄로 놓는 표 */
function StatRows({
  rows,
}: {
  rows: { k: string; v: string; sub?: string | null }[]
}) {
  return (
    <dl className="divide-y divide-gray-100 text-[13px]">
      {rows.map((r) => (
        <div key={r.k} className="flex items-center justify-between gap-2 py-2">
          <dt className="shrink-0 text-gray-500">{r.k}</dt>
          <dd className="text-right font-semibold">
            {r.v}
            {r.sub && <span className="ml-1 font-normal text-gray-400">{r.sub}</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const pct = (a: number, b: number) => (b > 0 ? `(${Math.round((a / b) * 100)}%)` : '')


/** 면적 항목을 사진처럼 이름 · 막대 · "N㎡ (P%)" 로 늘어놓는다 */
function AreaBars({
  items,
  colors = {},
}: {
  items: { label: string; areaM2: number }[]
  colors?: Record<string, string>
}) {
  const total = items.reduce((s, i) => s + i.areaM2, 0)
  return (
    <div className="space-y-1.5">
      {items.map((i) => {
        const p = total ? Math.round((i.areaM2 / total) * 100) : 0
        return (
          <div key={i.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs text-gray-500" title={i.label}>
              {i.label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full"
                style={{ width: `${p}%`, background: colors[i.label] ?? '#94A3B8' }}
              />
            </div>
            <span className="w-24 shrink-0 text-right text-[11px] text-gray-500">
              {i.areaM2.toLocaleString()}㎡ ({p}%)
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function DevelopPanel({
  develop,
  onClose,
  onFocus,
}: {
  develop: ApiDevelop
  onClose: () => void
  onFocus: (bbox: [number, number, number, number], id: string) => void
}) {
  const [data, setData] = useState<FullData | null>(null)
  const [loading, setLoading] = useState(true)
  const [fav, setFav] = useState(false)
  const [showAllDeals, setShowAllDeals] = useState(false)
  /**
   * 공유 링크(?zone=…&sim=…)로 들어오면 시뮬레이터를 펼친 채 시작한다.
   * 링크를 받은 사람이 패널을 뒤져 시뮬레이터를 찾아 들어가야 한다면
   * 공유가 아니라 안내에 가깝다.
   */
  const [simOpen, setSimOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    const p = new URLSearchParams(window.location.search)
    return p.get('zone') === develop.id && !!p.get('sim')
  })
  const [reportOpen, setReportOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState(false)
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [activeTab, setActiveTab] = useState<string>('deals')
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabBarRef = useRef<HTMLElement>(null)

  useEffect(() => setFav(isFavorite(develop.id)), [develop.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setNews(null)
    setShowAllDeals(false)
    setActiveTab('deals')
    if (scrollRef.current) scrollRef.current.scrollTop = 0

    fetch(`/api/develops/full?id=${encodeURIComponent(develop.id)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setData(j))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [develop.id])

  /**
   * 뉴스는 상세와 분리해서 부른다.
   * 외부(구글 뉴스 RSS)라 느리거나 실패할 수 있는데, 그것 때문에
   * 나머지 상세 전체가 늦어지면 안 된다.
   */
  useEffect(() => {
    let cancelled = false
    // 구역명만 넣으면 동명이인 기사가 섞인다. 자치구를 붙여 좁힌다.
    const q = [develop.gu, shortenForSearch(develop.name), '재개발'].filter(Boolean).join(' ')
    fetch(`/api/news?q=${encodeURIComponent(q)}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setNews(j.items ?? []))
      .catch(() => !cancelled && setNews([]))
    return () => {
      cancelled = true
    }
  }, [develop.id, develop.gu, develop.name])

  /** 스크롤 위치에 맞춰 탭 밑줄을 옮긴다 — 지금 어디를 보고 있는지 알려준다 */
  useEffect(() => {
    const box = scrollRef.current
    if (!box || loading) return
    const onScroll = () => {
      const secs = [...box.querySelectorAll<HTMLElement>('[data-section]')]
      let cur = secs[0]?.dataset.section ?? 'deals'
      for (const s of secs) {
        if (s.offsetTop - box.offsetTop - 40 <= box.scrollTop) cur = s.dataset.section!
      }
      setActiveTab((p) => (p === cur ? p : cur))
    }
    onScroll()
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [loading])

  /** 활성 탭이 탭바 밖으로 나가면 보이도록 끌어온다 (탭이 8개라 가로 스크롤된다) */
  useEffect(() => {
    const el = tabBarRef.current?.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [activeTab])

  const z = data?.zone ?? develop
  const type = PROJECT_TYPE_MAP.get(z.projectType)
  const { current: canonical, listed, ahead: stageAhead } = resolveStage(
    z.canonicalStage,
    data?.zone.progress?.dates,
  )
  const match = z.stageMatchBy ? MATCH_LABEL[z.stageMatchBy] : null
  const sColor = stageColor(z.canonicalStage)
  const pyeong = Math.round(z.areaM2 / 3.3058)
  /**
   * 경계 없는 사업장(가로주택·소규모·지역주택·리모델링).
   * 정비구역 고시가 없어 면적·고시일이 원본에 아예 존재하지 않는다.
   * 0을 그대로 그리면 "0평짜리 구역"으로 읽히므로 빈 값으로 둔다.
   */
  const noBoundary = data?.zone.hasBoundary === false

  /**
   * 권리산정기준일 — 도정법 원칙은 정비구역 지정 고시일이다.
   * 공모로 뽑힌 사업(신통·공공재개발·모아타운·장기전세)은 후보지 선정일이
   * 앞당겨 적용되므로 고시일을 그대로 쓰면 안 된다. 그 경우 값을 내지 않는다.
   */
  const rights = resolveRightsDate({
    name: z.name,
    rawLabel: z.rawLabel,
    projectType: z.projectType,
    noticeDate: data?.zone.noticeDate ?? null,
  })
  const rightsLinks = verifyLinks(z.name, z.gu ?? null, data?.zone.jibun ?? null)
  const sum = data?.zone.summary ?? null
  const prog = data?.zone.progress ?? null
  const stats = data?.zone.stats ?? null
  const plan = data?.zone.plan ?? null

  /** 현재 단계에 머문 개월 수 — 해당 단계 인가일이 있을 때만 계산한다 */
  const currentSince = canonical ? prog?.dates[canonical.code]?.date : null
  const monthsInStage = currentSince
    ? Math.max(
        0,
        Math.round((Date.now() - new Date(currentSince).getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
      )
    : null

  /**
   * 섹션으로 이동.
   * ref 맵 대신 data 속성으로 찾는다 — 섹션이 조건부 렌더라 ref 가 비어 있는 경우가 있었다.
   * scrollTo({behavior:'smooth'})는 환경에 따라 무시되므로 scrollTop 에 직접 대입한다.
   */
  const goToSection = (key: string) => {
    const box = scrollRef.current
    const el = box?.querySelector<HTMLElement>(`[data-section="${key}"]`)
    if (!el || !box) return
    box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 8)
  }

  const deals = data?.deals ?? []
  const shownDeals = showAllDeals ? deals : deals.slice(0, 5)

  /**
   * 차트에 얹을 인가 시점.
   * 사진의 벤치마크처럼 "대상지선정·조합설립" 같은 사건을 값 그래프 위에 세워
   * 가격이 어느 사건 뒤에 뛰었는지 한눈에 보이게 한다.
   */
  const milestones = STAGES.filter((s) => prog?.dates[s.code])
    .map((s) => ({
      ym: prog!.dates[s.code].date.slice(0, 7),
      label: s.label,
      color: s.color,
    }))
    .filter((m, i, arr) => arr.findIndex((x) => x.ym === m.ym) === i)

  /** 최근 10년 안에 사용승인된 인근 단지 — "이 동네에 뭐가 새로 섰나" */
  const recentApts = (() => {
    const cut = new Date()
    cut.setFullYear(cut.getFullYear() - 10)
    const iso = cut.toISOString().slice(0, 10)
    return (data?.apartments ?? [])
      .filter((a) => a.useApprovalDate && a.useApprovalDate >= iso)
      .sort((a, b) => (b.useApprovalDate ?? '').localeCompare(a.useApprovalDate ?? ''))
  })()

  /** 준공 후 시세 기본값 — 인근 아파트 중 평당가가 가장 높은 거래 */
  const nearbyTopPpp = (() => {
    const all = (data?.apartments ?? []).flatMap((a) =>
      a.areas.map((ar) => (ar.pyeong > 0 ? ar.price / ar.pyeong : 0)),
    )
    return all.length ? Math.round(Math.max(...all)) : null
  })()

  return (
    <aside
      /* 좁은 화면에서는 400px 이 화면을 넘어 지도까지 밀어낸다. 전체 폭으로 덮는다. */
      className="absolute top-0 right-0 bottom-0 z-30 flex w-full flex-col border-l border-gray-200 bg-white sm:w-[400px]"
      style={{ boxShadow: 'var(--shadow-float)' }}
    >
      {/* ── 헤더 ──
          스크롤해도 구역명·단계·탭은 남아야 한다. 본문이 밑으로 지나가므로
          반투명 + 블러로 띄운다 (참고 앱 헤더와 같은 처리). */}
      <div className="shrink-0 border-b border-gray-100 bg-white/85 px-5 pt-4 pb-0 backdrop-blur-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {/* 사업종류를 색 막대로 한 번 더 인코딩한다 — 글자만으로는 스캔이 안 된다 */}
            <p
              className="flex items-center gap-1.5 text-[11px] font-bold tracking-tight"
              style={{ color: type?.color }}
            >
              <span
                className="inline-block h-3 w-[3px] rounded-sm"
                style={{ background: type?.color }}
              />
              {type?.label}
            </p>
            <h2 className="mt-1 text-lg leading-snug font-bold tracking-tight break-keep">
              {z.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={() => setFav(toggleFavorite(z.id))}
              aria-label={fav ? '관심 구역에서 제거' : '관심 구역에 추가'}
              className={`rounded p-1.5 text-lg leading-none ${
                fav ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'
              }`}
            >
              {fav ? '★' : '☆'}
            </button>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-rose-500"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {/* 현재 단계만 꽉 찬 색. 나머지 배지는 틴트로 낮춰 위계를 만든다. */}
          <span
            className={z.stage ? 'chip chip--solid' : 'chip'}
            style={{ '--chip': z.stage ? sColor : '#9CA3AF' } as React.CSSProperties}
          >
            {z.stage ?? '단계 미확인'}
          </span>
          {z.gu && (
            <span className="text-[11px] text-gray-400">
              {z.gu}
              {data?.zone.dong ? ` ${data.zone.dong}` : ''}
            </span>
          )}
          {match && <Grade grade={match.grade} />}
        </div>

        {noBoundary && (
          /* 경계가 없다는 건 우리 데이터의 결함이 아니라 원본의 사실이다.
             지도의 점이 구역 경계인 줄 알고 읽지 않도록 먼저 밝힌다. */
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            <b>정비구역 고시 전 사업</b>이라 경계 데이터가 없습니다. 지도의 표시는 대표지번(
            {data?.zone.jibun ?? '—'}) 위치이며
            {data?.zone.precision === 'near' && ' 지번이 합병·멸실되어 근사 위치이고'} 구역 면적·용적률 등
            제원은 원본에 존재하지 않습니다. 실거래는 대표지번 반경 250m 기준입니다.
          </p>
        )}

        {/* 핵심 수치 — 한 그릇에 담고 안쪽을 선으로 나눈다.
            카드 3개를 띄우면 셋이 각각 떠서 헤더가 산만해진다. */}
        <div className="card mt-3 mb-3 flex divide-x divide-gray-100">
          {[
            { label: '구역면적', value: noBoundary ? '—' : `${pyeong.toLocaleString()}평` },
            { label: '실거래', value: loading ? '…' : `${data?.dealCount ?? 0}건` },
            {
              label: '대지평당가',
              value: data?.medianPerPyeong ? perPyeong(data.medianPerPyeong) : '—',
            },
          ].map((c) => (
            <div key={c.label} className="flex-1 px-2 py-2 text-center">
              <p className="text-[10px] font-medium tracking-tight text-gray-500">{c.label}</p>
              <p className="mt-0.5 text-[14px] font-extrabold tracking-tight tabular-nums">
                {c.value}
              </p>
            </div>
          ))}
        </div>

        {/* 탭 — 클릭하면 해당 섹션으로 스크롤. 8개라 가로 스크롤된다.
            활성 탭은 밑줄 + 색. 밑줄만 쓰면 가로 스크롤 중에 어디가 활성인지 놓친다. */}
        <nav
          ref={tabBarRef}
          className="thin-scroll -mx-5 flex gap-4 overflow-x-auto border-t border-gray-100 px-5"
        >
          {TABS.map((t) => {
            const on = activeTab === t.key
            return (
              <button
                key={t.key}
                data-tab={t.key}
                onClick={() => goToSection(t.key)}
                className={`shrink-0 border-b-2 py-2.5 text-[13px] font-bold tracking-tight whitespace-nowrap transition-colors ${
                  on
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-400 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ── 스크롤 본문 ── */}
      {/* scroll-smooth 는 쓰지 않는다 — 일부 환경에서 부드러운 스크롤이
          아예 실행되지 않아 scrollTop 대입이 무시된다 */}
      <div ref={scrollRef} className="thin-scroll flex-1 overflow-y-auto">
        {loading && <p className="px-5 py-10 text-center text-sm text-gray-400">불러오는 중…</p>}

        {!loading && (
          <>
            {/* 실거래 */}
            <section data-section="deals" className="panel-section"
              style={{ '--accent': '#6366f1' } as React.CSSProperties}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="panel-h mb-0">실거래</h3>
                <span className="text-[11px] text-gray-400">최근 24개월</span>
              </div>

              {data?.unavailable ? (
                /* 왜 비었는지 말한다. "0건"으로 두면 거래가 없는 구역처럼 읽힌다. */
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-relaxed text-amber-900">
                  <b>{molitErrorMessage(data.unavailable).title}</b>
                  <p className="mt-1 text-[11px] text-amber-800">
                    {molitErrorMessage(data.unavailable).detail}
                  </p>
                </div>
              ) : deals.length === 0 ? (
                <p className="note-box note-box--center">
                  {noBoundary ? (
                    <>
                      대표지번 반경 250m 안에서 신고된 거래가 없습니다.
                      <br />이 사업장은 경계 데이터가 없어 반경으로 집계합니다.
                    </>
                  ) : (
                    <>
                      구역 경계 안에서 신고된 거래가 없습니다.
                      <br />
                      경계 밖 거래는 집계에서 제외됩니다.
                    </>
                  )}
                </p>
              ) : (
                <>
                  <DealChart
                    series={data!.series}
                    milestones={milestones}
                    kindLabels={data!.kindLabels}
                  />

                  <table className="mt-3 w-full text-[11px]">
                    <thead>
                      <tr className="border-y border-gray-100 text-gray-400">
                        <th className="py-1.5 text-left font-medium">계약일</th>
                        <th className="py-1.5 text-left font-medium">유형</th>
                        <th className="py-1.5 text-left font-medium">주소</th>
                        <th className="py-1.5 text-right font-medium">가격</th>
                        <th className="py-1.5 text-right font-medium">대지지분</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDeals.map((d, i) => (
                        <tr key={i} className="border-b border-gray-50 align-top last:border-0">
                          <td className="py-2 whitespace-nowrap text-gray-500">
                            {d.dealDate.slice(2).replace(/-/g, '.')}
                          </td>
                          <td className="py-2 whitespace-nowrap">
                            <div className="text-gray-700">{d.typeLabel}</div>
                            {d.buildYear && (
                              <div className="text-[10px] text-gray-400">{d.buildYear}년</div>
                            )}
                          </td>
                          <td className="max-w-[104px] py-2 pr-1">
                            <div className="truncate text-gray-700">
                              {d.dong} {d.jibun}
                            </div>
                            <div className="truncate text-[10px] text-gray-400">
                              {d.buildingName ?? ''}
                              {d.floor ? ` ${d.floor}층` : ''}
                              {d.exclusiveAr
                                ? ` 전용 ${(d.exclusiveAr / 3.3058).toFixed(1)}평`
                                : ''}
                            </div>
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {d.isDirect && (
                              <span className="mr-1 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700">
                                직
                              </span>
                            )}
                            <span className="font-bold text-gray-800">{eok(d.price)}</span>
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            {d.pricePerLandPyeong && (
                              <div className="font-bold text-indigo-600">
                                {perPyeong(d.pricePerLandPyeong)}/평
                              </div>
                            )}
                            {d.landPyeong && (
                              <div className="text-gray-400">{d.landPyeong}평</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {deals.length > shownDeals.length && (
                    <button
                      onClick={() => setShowAllDeals(true)}
                      className="mt-2 w-full rounded-lg border border-gray-200 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50"
                    >
                      더보기 ({deals.length - shownDeals.length}건)
                    </button>
                  )}
                </>
              )}
            </section>

            {/* 진행현황 */}
            <section data-section="progress" className="panel-section"
              style={{ '--accent': '#0ea5e9' } as React.CSSProperties}
            >
              <h3 className="panel-h">진행현황</h3>
              {canonical ? (
                <ol className="relative">
                  {STAGES.filter((s) => s.group !== '완료').map((s, i, arr) => {
                    const done = s.order <= canonical.order
                    const current = s.code === canonical.code
                    return (
                      <li key={s.code} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < arr.length - 1 && (
                          <span
                            className="absolute top-4 left-[7px] h-full w-px"
                            style={{ background: done ? s.color : '#E5E7EB' }}
                          />
                        )}
                        <span
                          className="relative z-10 mt-0.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 bg-white"
                          style={{
                            borderColor: done ? s.color : '#E5E7EB',
                            background: done ? s.color : '#fff',
                            boxShadow: current ? `0 0 0 4px ${s.color}22` : undefined,
                          }}
                        />
                        <div className="min-w-0">
                          <p
                            className={`flex items-center gap-1.5 text-[13px] ${
                              current
                                ? 'font-bold text-gray-900'
                                : done
                                  ? 'text-gray-600'
                                  : 'text-gray-400'
                            }`}
                          >
                            {s.label}
                            {/* 인가일이 있으면 함께 — 진행 속도를 읽는 근거가 된다 */}
                            {prog?.dates[s.code] && (
                              <span className="text-[11px] font-normal text-gray-400">
                                {prog.dates[s.code].date.replace(/-/g, '.')}
                              </span>
                            )}
                          </p>
                          {current && (
                            <p className="mt-0.5 text-[11px]" style={{ color: s.color }}>
                              현재 단계
                              {monthsInStage != null && ` · ${monthsInStage}개월째`}
                              {/* 이 단계에 보통 몇 달 머무는지 — 빠른지 느린지 판단 기준 */}
                              {data?.stageDurations?.[s.code] && (
                                <span className="text-gray-400">
                                  {' '}
                                  (서울 중앙값 {data.stageDurations[s.code].avgMonths}개월 · 표본{' '}
                                  {data.stageDurations[s.code].samples})
                                </span>
                              )}
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="note-box">
                  정비몽땅 사업장과 연결되지 않아 진행단계를 확인할 수 없습니다. 해제·완료된 과거
                  구역이거나, 지역주택·리모델링처럼 경계 데이터에 없는 유형일 수 있습니다.
                </p>
              )}

              <div className="note-box mt-3">
                {z.stage && (
                  <p>
                    정비몽땅 원본 단계 <b className="text-gray-700">{z.stage}</b>
                    {z.stageBizType && <span className="text-gray-400"> · {z.stageBizType}</span>}
                  </p>
                )}
                {stageAhead && canonical && (
                  <p className="mt-0.5 text-gray-400">
                    사업장 목록에는 「{listed?.label}」로 되어 있으나, 추진경과에 「{canonical.label}
                    」 인가일({prog?.dates[canonical.code]?.date.replace(/-/g, '.')})이 있어 그쪽을
                    현재 단계로 봅니다.
                  </p>
                )}
                {z.stageSiteName && z.stageSiteName !== z.name && (
                  <p className="mt-0.5 text-gray-400">사업장명: {z.stageSiteName}</p>
                )}
                {match && (
                  <p className="mt-0.5 text-gray-400">연결 방식: {match.text}</p>
                )}
                {prog ? (
                  <p className="mt-1.5 text-gray-400">
                    인가일 출처: 정비몽땅 추진경과 · 사업장 「{prog.siteName}」
                  </p>
                ) : (
                  <p className="mt-1.5 text-gray-400">
                    이 사업장은 정비몽땅에 추진경과가 등록되어 있지 않습니다.
                  </p>
                )}
              </div>
            </section>

            {/* 자료실 — 원문으로 바로 가는 링크. 파일을 우리가 복제해 두지는 않는다. */}
            <section data-section="library" className="panel-section"
              style={{ '--accent': '#8b5cf6' } as React.CSSProperties}
            >
              <h3 className="panel-h">자료실</h3>

              <button
                onClick={() => setReportOpen(true)}
                className="mb-2 flex w-full items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-left hover:bg-indigo-100"
              >
                <span>
                  <span className="block text-[13px] font-bold text-indigo-800">
                    구역 리포트 PDF
                  </span>
                  <span className="block text-[11px] text-indigo-500">
                    개요·경과·실거래·인근 단지 — 지금 데이터로 즉시 생성
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-indigo-600">내려받기 ↓</span>
              </button>

              {/* 공유 카드 — 링크만 던지면 아무것도 안 보이고, 화면을 캡처하면
                  지도·패널이 같이 찍힌다. 지금 값으로 카드 한 장을 그려 준다. */}
              <button
                onClick={() => setCardOpen(true)}
                className="mb-3 flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800 px-3 py-2.5 text-left hover:bg-slate-700"
              >
                <span>
                  <span className="block text-[13px] font-bold text-white">구역 공유 카드 PNG</span>
                  <span className="block text-[11px] text-slate-400">
                    카카오톡·블로그용 이미지 — 지금 데이터로 즉시 생성
                  </span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-slate-300">미리보기 →</span>
              </button>

              <ul className="divide-y divide-gray-100">
                {[
                  {
                    label: prog ? `정비사업 정보몽땅 — ${prog.siteName}` : '정비사업 정보몽땅',
                    note: prog ? '사업개요·추진경과·고시문' : '사업장 검색',
                    href: prog?.cafeUrl
                      ? `https://cleanup.seoul.go.kr/cleanup/${prog.cafeUrl}`
                      : `https://cleanup.seoul.go.kr/user/cn/prjt/prjtList.do?searchWrd=${encodeURIComponent(
                          z.stageSiteName ?? z.name,
                        )}`,
                  },
                  {
                    label: '서울시 고시·공고',
                    note: '정비구역 지정 고시문 원문',
                    href: `https://www.seoul.go.kr/news/news_notice.do#list/1/cntPerPage=20&srchType=title&srchWord=${encodeURIComponent(
                      shortenForSearch(z.name),
                    )}`,
                  },
                  {
                    label: '국토교통부 실거래가 공개시스템',
                    note: z.gu ? `${z.gu} 원문 조회` : '원문 조회',
                    href: 'https://rt.molit.go.kr/',
                  },
                  {
                    label: '서울 도시계획 포털 (정비사업)',
                    note: '정비구역 현황·기준',
                    href: 'https://urban.seoul.go.kr/',
                  },
                  ...(z.noticeSn
                    ? [
                        {
                          label: '서울 열린데이터광장 — 의제처리구역',
                          note: `고시 일련번호 ${z.noticeSn}`,
                          href: 'https://data.seoul.go.kr/dataList/OA-21112/S/1/datasetView.do',
                        },
                      ]
                    : []),
                ].map((r) => (
                  <li key={r.label}>
                    <a
                      href={r.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 py-2.5 hover:bg-gray-50"
                    >
                      <span className="flex min-w-0 items-start gap-1.5">
                        <span className="mt-px shrink-0 text-gray-300">🔗</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-gray-800 underline decoration-gray-200 underline-offset-2">
                            {r.label}
                          </span>
                          <span className="block truncate text-[11px] text-gray-400">{r.note}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] font-bold text-indigo-600">열기</span>
                    </a>
                  </li>
                ))}

                {/* 소유주 전용 — 정비몽땅 정보공개는 소유주 인증을 거쳐야 열린다.
                    우리가 대신 받아올 수 없으므로 어디로 가야 하는지만 정확히 알린다. */}
                <li className="flex items-center justify-between gap-2 py-2.5">
                  <span className="flex min-w-0 items-start gap-1.5">
                    <span className="mt-px shrink-0 text-gray-300">🔒</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold text-gray-500">
                          의사록 · 자금운용 · 용역계약
                        </span>
                        <span className="shrink-0 rounded-full bg-indigo-50 px-1.5 py-px text-[10px] font-bold text-indigo-500">
                          소유주 전용
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-gray-400">
                        정비몽땅 정보공개 — 본인인증 후 열람
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-300">잠김</span>
                </li>
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                고시문·의사록 파일은 저작권·개인정보 문제로 복제해 두지 않고 원문 사이트로
                연결합니다. 정비몽땅 정보공개 자료는 소유주 본인인증이 필요해 자동으로 가져올 수
                없습니다.
              </p>
            </section>

            {/* 구역정보 */}
            <section data-section="info" className="panel-section"
              style={{ '--accent': '#14b8a6' } as React.CSSProperties}
            >
              <h3 className="panel-h">구역정보</h3>
              <dl className="divide-y divide-gray-100 text-sm">
                {[
                  {
                    k: '구역면적',
                    v: noBoundary ? '—' : `${z.areaM2.toLocaleString()}㎡`,
                    g: 'A' as const,
                  },
                  {
                    k: '평 환산',
                    v: noBoundary ? '—' : `${pyeong.toLocaleString()}평`,
                    g: 'B' as const,
                  },
                  {
                    k: '소재지',
                    v: noBoundary
                      ? `${z.gu ?? ''} ${data?.zone.jibun ?? ''}`.trim() || '—'
                      : `${z.gu ?? '—'} ${data?.zone.dong ?? ''}`.trim(),
                    g: 'A' as const,
                  },
                  {
                    k: '고시일',
                    v: data?.zone.noticeDate?.replace(/-/g, '.') ?? '—',
                    g: 'A' as const,
                  },
                  {
                    // 원칙(고시일)을 적용한 값. 후보지 선정으로 앞당겨지는 구역은 값을 비운다.
                    k: '권리산정기준일',
                    v: rights.label,
                    g: rights.basis === 'notice' ? ('B' as const) : ('D' as const),
                  },
                ].map((r) => (
                  <div key={r.k} className="flex items-center justify-between py-2">
                    <dt className="text-gray-500">{r.k}</dt>
                    <dd className="font-semibold">
                      {r.v}
                      <Grade grade={r.g} />
                    </dd>
                  </div>
                ))}
                {z.noticeSn && (
                  <div className="flex items-center justify-between py-2">
                    <dt className="text-gray-500">고시 일련번호</dt>
                    <dd className="font-mono text-[11px] text-gray-600">{z.noticeSn}</dd>
                  </div>
                )}
              </dl>

              {/* ── 권리산정기준일 안내 ──
                  분양권이 나오느냐가 이 날짜 하나로 갈린다. 우리 계산만 믿고
                  판단하면 안 되므로, 무엇을 근거로 냈는지와 원문을 어디서 보는지를
                  값 바로 옆에 붙인다. */}
              <div
                className={
                  rights.basis === 'notice'
                    ? 'mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600'
                    : 'mt-3 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900'
                }
              >
                <b>권리산정기준일</b> — {rights.note}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {rightsLinks.map((l) => (
                    <a
                      key={l.label}
                      href={l.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={l.note}
                      className="rounded-md border border-current/25 bg-white/70 px-2 py-1 font-bold hover:bg-white"
                    >
                      {l.label} ↗
                    </a>
                  ))}
                </div>
              </div>

              {/* 정비몽땅 사업개요 제원 — 있는 구역만 */}
              {sum && (
                <>
                  <h3 className="panel-sub">
                    사업 제원
                    <Grade grade="A" />
                  </h3>
                  <dl className="divide-y divide-gray-100 text-sm">
                    {[
                      ['정비구역 면적', sum.areaM2 ? `${sum.areaM2.toLocaleString()}㎡` : null],
                      ['토지등소유자', sum.landOwnerCount ? `${sum.landOwnerCount.toLocaleString()}명` : null],
                      ['조합원 수', sum.memberCount ? `${sum.memberCount.toLocaleString()}명` : null],
                      ['세입자 수', sum.tenantCount != null ? `${sum.tenantCount.toLocaleString()}명` : null],
                      ['용도지역', sum.useZone],
                      ['용도지구', sum.useDistrict],
                      ['용적률', sum.far != null ? `${sum.far}%` : null],
                      ['건폐율', sum.bcr != null ? `${sum.bcr}%` : null],
                      ['층수', sum.floors],
                      ['연면적', sum.totalFloorAreaM2 ? `${sum.totalFloorAreaM2.toLocaleString()}㎡` : null],
                    ]
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <div key={k as string} className="flex items-center justify-between py-2">
                          <dt className="text-gray-500">{k}</dt>
                          <dd className="font-semibold">{v}</dd>
                        </div>
                      ))}
                  </dl>

                  {/* 토지이용계획 — 값이 하나라도 있을 때만 */}
                  {(sum.landUseHousing || sum.landUseRoad || sum.landUsePark || sum.landUseGreen) && (
                    <>
                      <h3 className="panel-sub">토지이용 계획</h3>
                      <div className="space-y-1.5">
                        {(
                          [
                            ['택지', sum.landUseHousing, '#4F46E5'],
                            ['도로', sum.landUseRoad, '#9CA3AF'],
                            ['공원', sum.landUsePark, '#10B981'],
                            ['녹지', sum.landUseGreen, '#22C55E'],
                          ] as [string, number | null, string][]
                        )
                          .filter(([, v]) => v)
                          .map(([label, v, color]) => {
                            const total =
                              (sum.landUseHousing ?? 0) +
                              (sum.landUseRoad ?? 0) +
                              (sum.landUsePark ?? 0) +
                              (sum.landUseGreen ?? 0)
                            const pct = total ? Math.round((v! / total) * 100) : 0
                            return (
                              <div key={label} className="flex items-center gap-2">
                                <span className="w-10 shrink-0 text-xs text-gray-500">{label}</span>
                                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${pct}%`, background: color }}
                                  />
                                </div>
                                <span className="w-24 shrink-0 text-right text-[11px] text-gray-500">
                                  {v!.toLocaleString()}㎡ ({pct}%)
                                </span>
                              </div>
                            )
                          })}
                      </div>
                    </>
                  )}

                  <p className="mt-2 text-[11px] text-gray-400">
                    출처: 서울시 정비사업 정보몽땅 사업개요 · 사업장 「{sum.siteName}」
                  </p>
                </>
              )}

              {/* ── 도면 (조감도·위치도·배치도) ──
                  사진의 상단 이미지 자리다. 원본이 1~2MB라 직접 링크하지 않고
                  /api/cleanup-image 로 중계해 캐시한다. */}
              {plan?.drawings && (
                <div className="mb-4 -mx-1 flex gap-2 overflow-x-auto pb-1">
                  {(
                    [
                      ['aerial', '조감도'],
                      ['location', '위치도'],
                      ['layout', '배치도'],
                    ] as const
                  )
                    .filter(([k]) => plan.drawings![k])
                    .map(([k, label]) => (
                      <a
                        key={k}
                        href={`https://cleanup.seoul.go.kr${plan.drawings![k]!}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative block shrink-0"
                      >
                        {/* 원본이 1~2MB 라 썸네일로 그대로 쓰면 패널 하나에 5MB 가 든다.
                            next/image 로 리사이즈·webp 변환을 태운다. */}
                        <Image
                          src={`https://cleanup.seoul.go.kr${plan.drawings![k]!}`}
                          alt={label}
                          width={160}
                          height={112}
                          unoptimized={false}
                          className="h-28 w-40 rounded-lg border border-gray-200 bg-gray-50 object-cover"
                        />
                        <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {label}
                        </span>
                      </a>
                    ))}
                </div>
              )}

              {/* ── 공급 계획 (정비몽땅 사업개요) ── */}
              {plan && (plan.supplySale?.total || plan.supplyRent?.total) && (
                <>
                  <h3 className="panel-sub">
                    공급 계획
                    <Grade grade="A" />
                  </h3>
                  {(() => {
                    const sale = plan.supplySale?.total ?? 0
                    const rent = plan.supplyRent?.total ?? 0
                    const total = sale + rent
                    return (
                      <StatRows
                        rows={[
                          { k: '공급 세대', v: `${total.toLocaleString()}세대` },
                          ...(sale
                            ? [
                                {
                                  k: '분양',
                                  v: `${sale.toLocaleString()}세대`,
                                  sub: pct(sale, total),
                                },
                              ]
                            : []),
                          ...(rent
                            ? [
                                {
                                  k: '임대',
                                  v: `${rent.toLocaleString()}세대`,
                                  sub: pct(rent, total),
                                },
                              ]
                            : []),
                        ]}
                      />
                    )
                  })()}

                  {/* 전용면적 구간별 — 분양·임대를 한 표에 나란히 */}
                  {(() => {
                    const labels = [
                      ...new Set([
                        ...(plan.supplySale?.byArea ?? []).map((a) => a.label),
                        ...(plan.supplyRent?.byArea ?? []).map((a) => a.label),
                      ]),
                    ]
                    if (!labels.length) return null
                    const at = (
                      side: { byArea: { label: string; households: number }[] } | null,
                      label: string,
                    ) => side?.byArea.find((a) => a.label === label)?.households ?? null
                    return (
                      <table className="mt-2 w-full text-[11px]">
                        <thead>
                          <tr className="border-y border-gray-100 text-gray-400">
                            <th className="py-1.5 text-left font-medium">전용면적</th>
                            <th className="py-1.5 text-right font-medium">분양</th>
                            <th className="py-1.5 text-right font-medium">임대</th>
                          </tr>
                        </thead>
                        <tbody>
                          {labels.map((l) => (
                            <tr key={l} className="border-b border-gray-50 last:border-0">
                              <td className="py-1.5 text-gray-600">{l}</td>
                              <td className="py-1.5 text-right font-semibold">
                                {at(plan.supplySale, l)?.toLocaleString() ?? '—'}
                              </td>
                              <td className="py-1.5 text-right text-gray-500">
                                {at(plan.supplyRent, l)?.toLocaleString() ?? '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )
                  })()}

                  {(plan.floors || plan.maxHeightM || plan.improvement?.total) && (
                    <>
                      <h3 className="panel-sub">
                        건축 계획
                        <Grade grade="A" />
                      </h3>
                      <StatRows
                        rows={[
                          ...(sum?.far != null ? [{ k: '용적률', v: `${sum.far}%` }] : []),
                          ...(sum?.bcr != null ? [{ k: '건폐율', v: `${sum.bcr}%` }] : []),
                          ...(plan.floors ? [{ k: '층수', v: plan.floors }] : []),
                          ...(plan.maxHeightM
                            ? [{ k: '최고높이', v: `${plan.maxHeightM}m` }]
                            : []),
                          ...(plan.mainUse ? [{ k: '주용도', v: plan.mainUse }] : []),
                          ...(plan.improvement?.rebuild
                            ? [
                                {
                                  k: '철거 후 신축',
                                  v: `${plan.improvement.rebuild.toLocaleString()}동`,
                                  sub: plan.improvement.total
                                    ? `(전체 ${plan.improvement.total.toLocaleString()}동)`
                                    : null,
                                },
                              ]
                            : []),
                          ...(plan.schedule ? [{ k: '시행 예정시기', v: plan.schedule }] : []),
                        ]}
                      />
                    </>
                  )}

                  {plan.facilities.length > 0 && (
                    <>
                      <h3 className="panel-sub">
                        공동이용 시설
                        <Grade grade="A" />
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        {plan.facilities.map((f) => (
                          <span
                            key={f.label}
                            className="rounded bg-gray-100 px-1.5 py-1 text-[11px] text-gray-600"
                          >
                            {f.label}{' '}
                            <b className="font-semibold text-gray-800">
                              {f.areaM2.toLocaleString()}㎡
                            </b>
                          </span>
                        ))}
                      </div>
                    </>
                  )}

                  {plan.office && (plan.office.address || plan.office.phone) && (
                    <>
                      <h3 className="panel-sub">
                        추진 주체
                        <Grade grade="A" />
                      </h3>
                      <dl className="divide-y divide-gray-100 text-[13px]">
                        <div className="flex items-start justify-between gap-3 py-2">
                          <dt className="shrink-0 text-gray-500">사업장</dt>
                          <dd className="text-right font-semibold break-keep">{plan.siteName}</dd>
                        </div>
                        {plan.office.address && (
                          <div className="flex items-start justify-between gap-3 py-2">
                            <dt className="shrink-0 text-gray-500">주소</dt>
                            <dd className="text-right break-keep">{plan.office.address}</dd>
                          </div>
                        )}
                        {plan.office.phone && (
                          <div className="flex items-center justify-between gap-3 py-2">
                            <dt className="shrink-0 text-gray-500">전화</dt>
                            <dd>
                              <a
                                href={`tel:${plan.office.phone}`}
                                className="font-semibold text-indigo-600 hover:underline"
                              >
                                {plan.office.phone}
                              </a>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </>
                  )}

                  <p className="mt-2 text-[11px] text-gray-400">
                    출처: 서울시 정비사업 정보몽땅 사업개요 · 사업장 「{plan.siteName}」
                  </p>
                </>
              )}

              {/* ── 세대 현황 · 노후도 · 개발 여건 · 유형별 토지 면적 ── */}
              {stats && (
                <>
                  <h3 className="panel-sub">
                    세대 현황
                    <Grade grade="B" />
                  </h3>
                  <StatRows
                    rows={[
                      { k: '전체 세대 수', v: stats.households.total.toLocaleString() },
                      {
                        k: '공동 세대 수',
                        v: stats.households.apt.toLocaleString(),
                        sub: pct(stats.households.apt, stats.households.total),
                      },
                      {
                        k: '단독 세대 수',
                        v: stats.households.house.toLocaleString(),
                        sub: pct(stats.households.house, stats.households.total),
                      },
                    ]}
                  />

                  <h3 className="panel-sub">
                    노후도
                    <span className="ml-1 text-[11px] font-normal text-gray-400">
                      {stats.aging.base}년 기준 · 주거용 동
                    </span>
                    <Grade grade="B" />
                  </h3>
                  {stats.aging.denominator > 0 ? (
                    <StatRows
                      rows={(
                        [
                          ['현재', stats.aging.now],
                          ['5년 후', stats.aging.in5],
                          ['10년 후', stats.aging.in10],
                        ] as [string, number][]
                      ).map(([k, n]) => ({
                        k,
                        v: `${n} / ${stats.aging.denominator}`,
                        sub: pct(n, stats.aging.denominator),
                      }))}
                    />
                  ) : (
                    <p className="note-box">
                      구역 안에서 사용승인일이 확인된 주거용 건물이 없습니다.
                    </p>
                  )}

                  <h3 className="panel-sub">
                    개발 여건
                    <Grade grade="B" />
                  </h3>
                  <StatRows
                    rows={[
                      {
                        k: '과소필지',
                        v: `${stats.conditions.smallParcels} / ${stats.conditions.parcels}`,
                        sub: pct(stats.conditions.smallParcels, stats.conditions.parcels),
                      },
                      {
                        k: '호수밀도',
                        v:
                          stats.conditions.householdsPerHa != null
                            ? `${stats.conditions.householdsPerHa}호/ha`
                            : '—',
                        sub: `(${stats.households.total.toLocaleString()}호)`,
                      },
                      ...(stats.conditions.abuttingBase
                        ? [
                            {
                              k: '접도율',
                              v: `${stats.conditions.abutting} / ${stats.conditions.abuttingBase}필지`,
                              sub: pct(
                                stats.conditions.abutting ?? 0,
                                stats.conditions.abuttingBase,
                              ),
                            },
                          ]
                        : []),
                      // 층별개요 파일이 있으면 진짜 반지하, 없으면 지하층 보유로 대체한다
                      stats.conditions.semiBasement != null
                        ? (() => {
                            // 근린생활시설 지하 1층에도 주거가 있어, 주거동만 분모로 쓰면
                            // 분자가 분모를 넘는다. 전체 동수를 분모로 쓴다.
                            const base =
                              stats.conditions.totalBuildings ??
                              stats.conditions.residentialBuildings
                            return {
                              k: '반지하 비율',
                              v: `${stats.conditions.semiBasement}동 / ${base}동`,
                              sub: pct(stats.conditions.semiBasement, base),
                            }
                          })()
                        : {
                            k: '지하층 보유',
                            v: `${stats.conditions.withBasement}동 / ${stats.conditions.residentialBuildings}동`,
                            sub: pct(
                              stats.conditions.withBasement,
                              stats.conditions.residentialBuildings,
                            ),
                          },
                      ...(stats.landPrice
                        ? [
                            {
                              k: '개별공시지가',
                              v: `${Math.round(stats.landPrice.medianPerM2 / 10000).toLocaleString()}만원/㎡`,
                              sub: `(중앙값 · 표본 ${stats.landPrice.samples})`,
                            },
                          ]
                        : []),
                    ]}
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                    과소필지는 90㎡ 미만 필지입니다. 접도율은 건물이 있는 필지 중 폭 4m 이상
                    도로(소로 이상)에 접한 비율이며, 도로접면 등급은 토지특성 자료를 따릅니다.
                    지하층 보유는 반지하의 대리지표로, 정확한 반지하 비율은 층별개요를 봐야 합니다.
                  </p>

                  {/* 현황 제원 — 정비몽땅 사업개요가 없는 구역도 지금 밀도를 알 수 있다 */}
                  {stats.actual && (stats.actual.far || stats.actual.useZones.length > 0) && (
                    <>
                      <h3 className="panel-sub">
                        현황 제원
                        <span className="ml-1 text-[11px] font-normal text-gray-400">
                          건축물대장 기준
                        </span>
                        <Grade grade="B" />
                      </h3>
                      <StatRows
                        rows={[
                          ...(stats.actual.far
                            ? [{ k: '현황 용적률', v: `${stats.actual.far}%` }]
                            : []),
                          ...(stats.actual.bcr
                            ? [{ k: '현황 건폐율', v: `${stats.actual.bcr}%` }]
                            : []),
                          {
                            k: '건물 대지면적',
                            v: `${stats.actual.platAreaM2.toLocaleString()}㎡`,
                            sub: `(${stats.actual.buildings}동)`,
                          },
                          ...stats.actual.useZones.slice(0, 3).map((u, i) => ({
                            k: i === 0 ? '용도지역' : '',
                            v: u.label,
                            sub: `${u.areaM2.toLocaleString()}㎡`,
                          })),
                        ]}
                      />
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                        계획값이 아니라 지금 서 있는 건물의 실측 평균입니다. 용적률·건폐율은
                        대지면적으로 가중했습니다. 용도지역은 토지특성(V-World) 기준입니다.
                      </p>
                    </>
                  )}

                  {stats.landUse.length > 0 && (
                    <>
                      <h3 className="panel-sub">
                        유형별 토지 면적
                        <Grade grade="B" />
                      </h3>
                      <div className="space-y-1.5">
                        {(() => {
                          const total = stats.landUse.reduce((s, l) => s + l.areaM2, 0)
                          const COLOR: Record<string, string> = {
                            공동주택: '#4F46E5',
                            단독주택: '#0EA5E9',
                            근린생활시설: '#F59E0B',
                            도로: '#9CA3AF',
                            기타: '#CBD5E1',
                          }
                          return stats.landUse.map((l) => {
                            const p = total ? Math.round((l.areaM2 / total) * 100) : 0
                            return (
                              <div key={l.label} className="flex items-center gap-2">
                                <span className="w-20 shrink-0 truncate text-xs text-gray-500">
                                  {l.label}
                                </span>
                                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${p}%`,
                                      background: COLOR[l.label] ?? '#CBD5E1',
                                    }}
                                  />
                                </div>
                                <span className="w-28 shrink-0 text-right text-[11px] text-gray-500">
                                  {l.areaM2.toLocaleString()}㎡ ({p}%)
                                </span>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </>
                  )}

                  {/* 용도별 토지 면적 — 토지특성의 용도지역, 면적 기준 */}
                  {stats.actual?.useZones && stats.actual.useZones.length > 0 && (
                    <>
                      <h3 className="panel-sub">
                        용도별 토지 면적
                        <Grade grade="B" />
                      </h3>
                      <AreaBars
                        items={stats.actual.useZones}
                        colors={{
                          제1종전용주거지역: '#93C5FD',
                          제1종일반주거지역: '#60A5FA',
                          제2종일반주거지역: '#3B82F6',
                          제3종일반주거지역: '#1D4ED8',
                          준주거지역: '#8B5CF6',
                          일반상업지역: '#F97316',
                        }}
                      />
                    </>
                  )}

                  {/* 소유자별 토지 면적 — 토지소유정보의 소유구분 */}
                  {stats.ownership && stats.ownership.byOwner.length > 0 && (
                    <>
                      <h3 className="panel-sub">
                        소유자별 토지 면적
                        <Grade grade="B" />
                      </h3>
                      <AreaBars
                        items={stats.ownership.byOwner}
                        colors={{
                          개인: '#4F46E5',
                          국공유지: '#10B981',
                          법인: '#F59E0B',
                          기타: '#CBD5E1',
                        }}
                      />
                      <p className="mt-1 text-[11px] leading-relaxed text-gray-400">
                        국토교통부 토지소유정보 기준입니다. 공유 필지는 소유자가 여럿이라 면적이
                        중복되므로, 필지마다 대표 소유구분 하나만 세고 면적은 한 번만 더했습니다.
                        {stats.ownership.sampled &&
                          ` 표본 ${stats.ownership.sampled}필지.`}
                      </p>
                    </>
                  )}

                  {/* 규제 정보 — 토지이용계획 지역·지구 지정.
                      토지이음이 보여주는 항목과 같은 LURIS 자료다. */}
                  {stats.regulations && stats.regulations.length > 0 && (
                    <>
                      <h3 className="panel-sub">
                        규제 정보
                        <span className="ml-1 text-[11px] font-normal text-gray-400">
                          토지이용계획
                        </span>
                        <Grade grade="A" />
                      </h3>
                      <div className="flex flex-wrap gap-1">
                        {stats.regulations.map((r) => (
                          <span
                            key={r.label}
                            className={`rounded px-1.5 py-1 text-[11px] font-semibold ${
                              r.scope === 'all'
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-gray-100 text-gray-500'
                            }`}
                          >
                            {r.label}
                            {r.scope === 'partial' && (
                              <span className="ml-1 font-normal text-gray-400">일부</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                        토지이음(eum.go.kr)이 보여주는 지역·지구 지정과 같은 자료입니다. 토지이음은
                        공개 API가 없어, 동일한 국토교통부 LURIS 자료를 V-World로 받습니다. 붉은
                        항목은 표본 필지 전부에 걸린 것, 회색은 일부 필지만 해당합니다. 정확한 행위
                        제한은 토지이음 열람과 담당 부서 확인이 필요합니다.
                      </p>
                    </>
                  )}

                  <p className="mt-2 text-[11px] text-gray-400">
                    출처: {stats.source} · 구역 안 필지 {stats.parcelCount.toLocaleString()}개
                    {stats.landCharSampled &&
                      ` · 접도율·용도지역·규제는 ${stats.landCharSampled}필지 표본`}
                  </p>
                </>
              )}

              <p className="mt-5 mb-1.5 text-xs font-bold text-gray-500">아직 연동되지 않은 정보</p>
              <ul className="space-y-1">
                {[
                  // 사업개요가 없어도 현황 제원(건축물대장)으로 밀도는 알 수 있다.
                  // 계획값이 비었다는 사실만 남긴다.
                  ...(plan?.supplySale?.total
                    ? []
                    : [
                        [
                          '공급 계획 (분양·임대 세대)',
                          stats?.actual?.far
                            ? '정비몽땅 사업개요 미등록 — 위 현황 제원으로 대체'
                            : '정비몽땅 사업개요 미등록',
                        ] as const,
                      ]),
                  ...(prog ? [] : [['단계별 인가일', '정비몽땅 추진경과 미등록'] as const]),
                  ...(stats
                    ? []
                    : [['세대현황 · 노후도 · 개발여건', '이 구역은 아직 산출 전입니다'] as const]),
                  ['토지등소유자 수', '개인정보 — 공개 API 없음'],
                  ['반지하 비율', '건축물대장 층별개요 (현재는 지하층 보유로 대체)'],
                  ['매물', '중개 제휴 필요'],
                  /*
                   * 공매(온비드)는 붙였다 — 왼쪽 공매 메뉴.
                   * 법원경매는 다른 제도이고 물건 목록 API 가 없다.
                   * 공공데이터포털에 있는 건 감정평가사협회의 매각 통계뿐이라
                   * 개별 물건을 못 낸다.
                   */
                  ['법원경매 물건', '공개 API 없음 (통계만 공개) — courtauction.go.kr 직접 조회'],
                ].map(([k, src]) => (
                  <li
                    key={k}
                    className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs"
                  >
                    <span className="text-gray-600">{k}</span>
                    <span className="shrink-0 text-right text-[11px] text-gray-400">{src}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 뉴스 — 구글 뉴스 RSS. 제목·언론사·링크만 보여주고 본문은 원문으로 보낸다. */}
            <section data-section="news" className="panel-section"
              style={{ '--accent': '#f59e0b' } as React.CSSProperties}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="panel-h mb-0">뉴스</h3>
                <span className="text-[11px] text-gray-400">구글 뉴스</span>
              </div>
              {news === null ? (
                <p className="note-box note-box--center">
                  불러오는 중…
                </p>
              ) : news.length === 0 ? (
                <p className="note-box note-box--center">
                  이 구역 관련 기사를 찾지 못했습니다.
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {news.slice(0, 8).map((n) => (
                    <li key={n.link}>
                      <a
                        href={n.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block py-2.5 hover:bg-gray-50"
                      >
                        <p className="text-[13px] leading-snug font-semibold break-keep text-gray-800">
                          {n.title}
                        </p>
                        <p className="mt-1 text-[11px] text-gray-400">
                          {n.source ?? '출처 미상'}
                          {n.date && ` · ${n.date.replace(/-/g, '.')}`}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 인근 구역 */}
            <section data-section="nearby" className="panel-section"
              style={{ '--accent': '#ec4899' } as React.CSSProperties}
            >
              <h3 className="panel-h">인근 구역</h3>
              {data?.nearby.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-gray-100 text-gray-400">
                        <th className="py-1.5 text-left font-medium">구역</th>
                        <th className="py-1.5 text-right font-medium">거리</th>
                        <th className="py-1.5 text-right font-medium">면적</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.nearby.map((n) => {
                        const t = PROJECT_TYPE_MAP.get(n.projectType)
                        return (
                          <tr
                            key={n.id}
                            onClick={() => onFocus(n.bbox, n.id)}
                            className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50"
                          >
                            <td className="py-2 pr-2">
                              <div className="flex items-center gap-1">
                                <span
                                  className="shrink-0 rounded px-1 py-px text-[9px] font-bold"
                                  style={{
                                    background: `${t?.color ?? '#888'}1A`,
                                    color: t?.color ?? '#666',
                                  }}
                                >
                                  {t?.short}
                                </span>
                                <span className="truncate font-semibold">{n.name}</span>
                              </div>
                              <div
                                className="mt-0.5 text-[10px] font-semibold"
                                style={{
                                  color: n.stage ? stageColor(n.canonicalStage) : '#9CA3AF',
                                }}
                              >
                                {n.stage ?? '단계 미확인'}
                              </div>
                            </td>
                            <td className="py-2 text-right whitespace-nowrap text-gray-500">
                              {n.distanceKm}km
                            </td>
                            <td className="py-2 text-right whitespace-nowrap text-gray-500">
                              {Math.round(n.areaM2 / 3.3058).toLocaleString()}평
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="note-box note-box--center">
                  반경 3km 안에 다른 정비구역이 없습니다.
                </p>
              )}

              {/* 비교표 — 사진의 가로 비교표. 값이 있는 항목만 행으로 만든다. */}
              {data?.nearby.length ? <CompareTable zone={z} sum={sum} nearby={data.nearby} /> : null}
            </section>

            {/* 인근 아파트 */}
            <section data-section="apts" className="panel-section"
              style={{ '--accent': '#3b82f6' } as React.CSSProperties}
            >
              <h3 className="panel-h">
                인근 아파트
                <span className="ml-1 text-[11px] font-normal text-gray-400">
                  반경 1.5km · 최근 12개월 실거래
                </span>
              </h3>
              {data?.apartments.length ? (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400">
                      <th className="py-1.5 text-left font-medium">이름</th>
                      <th className="py-1.5 text-right font-medium">연차</th>
                      <th className="py-1.5 text-right font-medium">세대수</th>
                      <th className="py-1.5 text-right font-medium">전용</th>
                      <th className="py-1.5 text-right font-medium">가격</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.apartments.map((a) =>
                      a.areas.map((ar, i) => (
                        <tr key={`${a.name}-${ar.exclusiveAr}`} className="border-b border-gray-50 last:border-0">
                          {i === 0 && (
                            <>
                              <td rowSpan={a.areas.length} className="py-2 pr-2 align-top">
                                <div className="font-semibold">{a.name}</div>
                                <div className="text-[10px] text-gray-400">{a.distanceKm}km</div>
                              </td>
                              <td rowSpan={a.areas.length} className="py-2 text-right align-top text-gray-500">
                                {a.ageYears != null ? `${a.ageYears}년` : '—'}
                              </td>
                              <td rowSpan={a.areas.length} className="py-2 text-right align-top text-gray-500">
                                {a.households != null ? (
                                  <>
                                    <div>{a.households.toLocaleString()}</div>
                                    {a.buildings != null && (
                                      <div className="text-[10px] text-gray-400">
                                        {a.buildings}개동
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </>
                          )}
                          <td className="py-2 text-right whitespace-nowrap text-gray-600">
                            {Math.round(ar.exclusiveAr)}㎡
                          </td>
                          <td className="py-2 text-right font-bold whitespace-nowrap">
                            {eok(ar.price)}
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              ) : (
                <p className="note-box note-box--center">
                  반경 1.5km 안에 최근 아파트 실거래가 없습니다.
                </p>
              )}
            </section>

            {/* 신축 공사 */}
            <section data-section="construction" className="panel-section"
              style={{ '--accent': '#10b981' } as React.CSSProperties}
            >
              <h3 className="panel-h">
                신축 공사
                <span className="ml-1 text-[11px] font-normal text-gray-400">반경 3km</span>
              </h3>

              {data?.constructionZones.length ? (
                <ul className="divide-y divide-gray-100">
                  {data.constructionZones.map((n) => {
                    const t = PROJECT_TYPE_MAP.get(n.projectType)
                    const building = n.canonicalStage === 'construction' && !n.completeDate
                    return (
                      <li key={n.id}>
                        <button
                          onClick={() => onFocus(n.bbox, n.id)}
                          className="flex w-full items-start justify-between gap-2 py-2.5 text-left hover:bg-gray-50"
                        >
                          <span className="min-w-0">
                            <span className="flex items-center gap-1">
                              <span
                                className="shrink-0 rounded px-1 py-px text-[9px] font-bold"
                                style={{
                                  background: `${t?.color ?? '#888'}1A`,
                                  color: t?.color ?? '#666',
                                }}
                              >
                                {t?.short}
                              </span>
                              <span className="truncate text-[13px] font-semibold">{n.name}</span>
                            </span>
                            <span className="mt-0.5 block text-[11px] text-gray-400">
                              {n.startDate && `착공 ${n.startDate.replace(/-/g, '.')}`}
                              {n.startDate && n.completeDate && ' → '}
                              {n.completeDate && `준공 ${n.completeDate.replace(/-/g, '.')}`}
                              {!n.startDate && !n.completeDate && (n.stage ?? '')}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span
                              className="block rounded px-1.5 py-0.5 text-[10px] font-bold"
                              style={
                                building
                                  ? { background: '#ECFDF5', color: '#059669' }
                                  : { background: '#F3F4F6', color: '#6B7280' }
                              }
                            >
                              {building ? '공사중' : '준공'}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-gray-400">
                              {n.distanceKm}km
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="note-box note-box--center">
                  반경 3km 안에 착공·준공 기록이 있는 구역이 없습니다.
                </p>
              )}

              {/* 최근 준공 아파트 — 건축물대장 사용승인일 기준 */}
              {recentApts.length > 0 && (
                <>
                  <h4 className="mt-5 mb-2 text-[13px] font-bold">
                    최근 준공 단지
                    <span className="ml-1 text-[11px] font-normal text-gray-400">
                      10년 이내 · 사용승인 기준
                    </span>
                  </h4>
                  <ul className="divide-y divide-gray-100">
                    {recentApts.map((a) => (
                      <li key={a.name} className="flex items-center justify-between py-2 text-[12px]">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{a.name}</span>
                          <span className="block text-[11px] text-gray-400">
                            {a.useApprovalDate?.replace(/-/g, '.')} 사용승인 · {a.distanceKm}km
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-gray-500">
                          {a.households != null && (
                            <span className="block font-semibold">
                              {a.households.toLocaleString()}세대
                            </span>
                          )}
                          {a.buildings != null && (
                            <span className="block text-[10px] text-gray-400">
                              {a.buildings}개동
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                국토교통부 건축인허가(건축HUB) API 는 아직 연동되지 않아, 착공·준공일은 정비몽땅
                추진경과, 준공 단지는 건축물대장 사용승인일에서 가져옵니다.
              </p>

              <button
                onClick={() => setSimOpen(true)}
                className="mt-5 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
              >
                💰 분담금 시뮬레이터
              </button>

              <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                출처 — 경계: 서울 열린데이터광장 「서울시 의제처리구역 위치정보」 / 진행단계: 서울시
                정비사업 정보몽땅 / 실거래: 국토교통부. 구역 경계·진행단계는 참고자료이며 법적
                효력이 없습니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.
              </p>
            </section>
          </>
        )}
      </div>

      {reportOpen && (
        <ZoneReport
          data={{
            name: z.name,
            gu: z.gu ?? null,
            dong: data?.zone.dong ?? null,
            projectType: z.projectType,
            stage: z.stage ?? null,
            currentStageLabel: canonical?.label ?? null,
            monthsInStage,
            areaM2: z.areaM2,
            noticeDate: data?.zone.noticeDate ?? null,
            noticeSn: z.noticeSn ?? null,
            dealCount: data?.dealCount ?? 0,
            medianPerPyeong: data?.medianPerPyeong ?? null,
            summary: sum,
            progressDates: STAGES.filter((s) => prog?.dates[s.code]).map((s) => ({
              label: s.label,
              date: prog!.dates[s.code].date,
            })),
            deals,
            apartments: data?.apartments ?? [],
          }}
          onClose={() => setReportOpen(false)}
        />
      )}

      {cardOpen && (
        <ShareCard
          data={{
            name: z.name,
            projectType: z.projectType,
            stage: z.stage ?? null,
            canonicalStage: z.canonicalStage ?? null,
            gu: z.gu ?? null,
            dong: noBoundary ? (data?.zone.jibun ?? null) : (data?.zone.dong ?? null),
            // 경계 없는 사업장은 면적이 원본에 없다. 0 을 넘기면 카드가 0평으로 그린다.
            areaM2: noBoundary ? null : z.areaM2,
            households: stats?.households.total ?? sum?.memberCount ?? null,
            agingPct:
              stats && stats.aging.denominator > 0
                ? Math.round((stats.aging.now / stats.aging.denominator) * 100)
                : null,
            medianPerPyeong: data?.medianPerPyeong ?? null,
            dealCount: data?.dealCount ?? null,
            noticeDate: data?.zone.noticeDate ?? null,
            source: noBoundary
              ? '출처: 서울시 정비사업 정보몽땅 · 국토교통부 실거래가'
              : '출처: 서울 열린데이터광장 · 정비사업 정보몽땅 · 국토교통부',
          }}
          onClose={() => setCardOpen(false)}
        />
      )}

      {simOpen && (
        <BurdenSimulator
          zoneId={z.id}
          zoneName={z.name}
          zoneLandPricePerPyeong={data?.medianPerPyeong ?? null}
          nearbyTopPricePerPyeong={nearbyTopPpp}
          onClose={() => setSimOpen(false)}
        />
      )}
    </aside>
  )
}
