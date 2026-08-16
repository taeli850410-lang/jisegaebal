'use client'

import { useEffect, useRef, useState } from 'react'
import { PROJECT_TYPE_MAP, STAGES, STAGE_MAP, stageColor } from '@/lib/taxonomy'
import { isFavorite, toggleFavorite } from '@/lib/userStore'
import type { ApiDevelop } from '@/lib/types'
import DealChart from './detail/DealChart'
import BurdenSimulator from './detail/BurdenSimulator'

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

interface FullData {
  zone: ApiDevelop & {
    dong: string | null
    noticeDate: string | null
    summary: ZoneSummary | null
    progress: ZoneProgress | null
  }
  deals: Deal[]
  dealCount: number
  medianPerPyeong: number | null
  series: { ym: string; value: number | null; count: number }[]
  nearby: Nearby[]
  apartments: Apartment[]
  unavailable: string | null
}

/** 인근 아파트 — 이 구역이 완성되면 얼마쯤 되나의 기준점 */
interface Apartment {
  name: string
  buildYear: number | null
  ageYears: number | null
  distanceKm: number
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

const TABS = [
  { key: 'deals', label: '실거래' },
  { key: 'progress', label: '진행현황' },
  { key: 'info', label: '구역정보' },
  { key: 'nearby', label: '인근 구역' },
] as const

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
  const [simOpen, setSimOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => setFav(isFavorite(develop.id)), [develop.id])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setShowAllDeals(false)
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

  const z = data?.zone ?? develop
  const type = PROJECT_TYPE_MAP.get(z.projectType)
  const canonical = z.canonicalStage ? STAGE_MAP.get(z.canonicalStage) : null
  const match = z.stageMatchBy ? MATCH_LABEL[z.stageMatchBy] : null
  const sColor = stageColor(z.canonicalStage)
  const pyeong = Math.round(z.areaM2 / 3.3058)
  const sum = data?.zone.summary ?? null
  const prog = data?.zone.progress ?? null

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

  /** 준공 후 시세 기본값 — 인근 아파트 중 평당가가 가장 높은 거래 */
  const nearbyTopPpp = (() => {
    const all = (data?.apartments ?? []).flatMap((a) =>
      a.areas.map((ar) => (ar.pyeong > 0 ? ar.price / ar.pyeong : 0)),
    )
    return all.length ? Math.round(Math.max(...all)) : null
  })()

  return (
    <aside className="absolute top-0 right-0 bottom-0 z-30 flex w-[400px] flex-col border-l border-gray-200 bg-white shadow-xl">
      {/* ── 헤더 ── */}
      <div className="shrink-0 border-b border-gray-100 px-5 pt-4 pb-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-bold" style={{ color: type?.color }}>
              {type?.label}
            </p>
            <h2 className="mt-0.5 text-lg leading-snug font-bold break-keep">{z.name}</h2>
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

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-bold"
            style={
              z.stage
                ? { color: sColor, background: `${sColor}1A` }
                : { color: '#9CA3AF', background: '#F3F4F6' }
            }
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

        <div className="mt-3 flex gap-2 pb-3">
          {[
            { label: '구역면적', value: `${pyeong.toLocaleString()}평` },
            { label: '실거래', value: loading ? '…' : `${data?.dealCount ?? 0}건` },
            {
              label: '대지평당가',
              value: data?.medianPerPyeong ? perPyeong(data.medianPerPyeong) : '—',
            },
          ].map((c) => (
            <div key={c.label} className="flex-1 rounded-lg bg-gray-50 px-2 py-1.5 text-center">
              <p className="text-[10px] text-gray-500">{c.label}</p>
              <p className="text-[13px] font-bold">{c.value}</p>
            </div>
          ))}
        </div>

        {/* 탭 — 클릭하면 해당 섹션으로 스크롤 */}
        <nav className="flex gap-4 border-t border-gray-100">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => goToSection(t.key)}
              className="py-2.5 text-[13px] font-bold text-gray-500 hover:text-indigo-600"
            >
              {t.label}
            </button>
          ))}
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
            <section data-section="deals"
              className="border-b-8 border-gray-50 px-5 py-4"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-bold">실거래</h3>
                <span className="text-[11px] text-gray-400">최근 24개월</span>
              </div>

              {data?.unavailable ? (
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
                  실거래 데이터를 불러올 수 없습니다.
                </p>
              ) : deals.length === 0 ? (
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs leading-relaxed text-gray-500">
                  구역 경계 안에서 신고된 거래가 없습니다.
                  <br />
                  경계 밖 거래는 집계에서 제외됩니다.
                </p>
              ) : (
                <>
                  <DealChart series={data!.series} />

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
            <section data-section="progress"
              className="border-b-8 border-gray-50 px-5 py-4"
            >
              <h3 className="mb-3 text-sm font-bold">진행현황</h3>
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
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-xs leading-relaxed text-gray-500">
                  정비몽땅 사업장과 연결되지 않아 진행단계를 확인할 수 없습니다. 해제·완료된 과거
                  구역이거나, 지역주택·리모델링처럼 경계 데이터에 없는 유형일 수 있습니다.
                </p>
              )}

              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-[11px] leading-relaxed text-gray-500">
                {z.stage && (
                  <p>
                    정비몽땅 원본 단계 <b className="text-gray-700">{z.stage}</b>
                    {z.stageBizType && <span className="text-gray-400"> · {z.stageBizType}</span>}
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

            {/* 구역정보 */}
            <section data-section="info"
              className="border-b-8 border-gray-50 px-5 py-4"
            >
              <h3 className="mb-2 text-sm font-bold">구역정보</h3>
              <dl className="divide-y divide-gray-100 text-sm">
                {[
                  { k: '구역면적', v: `${z.areaM2.toLocaleString()}㎡`, g: 'A' as const },
                  { k: '평 환산', v: `${pyeong.toLocaleString()}평`, g: 'B' as const },
                  { k: '소재지', v: `${z.gu ?? '—'} ${data?.zone.dong ?? ''}`.trim(), g: 'B' as const },
                  {
                    k: '고시일',
                    v: data?.zone.noticeDate?.replace(/-/g, '.') ?? '—',
                    g: 'A' as const,
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

              {/* 정비몽땅 사업개요 제원 — 있는 구역만 */}
              {sum && (
                <>
                  <h3 className="mt-5 mb-2 text-sm font-bold">
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
                      <h3 className="mt-5 mb-2 text-sm font-bold">토지이용 계획</h3>
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

              <p className="mt-5 mb-1.5 text-xs font-bold text-gray-500">아직 연동되지 않은 정보</p>
              <ul className="space-y-1">
                {[
                  ...(sum ? [] : [['사업 제원 (면적·소유자·용적률)', '정비몽땅 사업개요 미등록'] as const]),
                  ...(prog ? [] : [['단계별 인가일', '정비몽땅 추진경과 미등록'] as const]),
                  ['권리산정기준일', '고시문 파싱'],
                  ['노후도 · 개발여건', '건축물대장 + 연속지적도(V-World)'],
                  ['아파트 세대수 · 동수', 'K-apt (서비스 활용신청 필요)'],
                  ['매물 · 경매', '중개 제휴 / 법원경매'],
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

            {/* 인근 구역 */}
            <section data-section="nearby"
              className="px-5 py-4"
            >
              <h3 className="mb-2 text-sm font-bold">인근 구역</h3>
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
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
                  반경 3km 안에 다른 정비구역이 없습니다.
                </p>
              )}

              {/* 인근 아파트 */}
              <h3 className="mt-6 mb-2 text-sm font-bold">
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
                <p className="rounded-lg bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">
                  반경 1.5km 안에 최근 아파트 실거래가 없습니다.
                </p>
              )}

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

      {simOpen && (
        <BurdenSimulator
          zoneName={z.name}
          zoneLandPricePerPyeong={data?.medianPerPyeong ?? null}
          nearbyTopPricePerPyeong={nearbyTopPpp}
          onClose={() => setSimOpen(false)}
        />
      )}
    </aside>
  )
}
