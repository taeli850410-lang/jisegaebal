'use client'

import { useEffect, useMemo, useState } from 'react'
import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'
import { molitErrorMessage } from '@/lib/molitError'

/**
 * 아파트 단지 상세.
 *
 * 지도에서 단지 마커를 누르면 열린다. 구역 패널과 같은 자리를 쓰되
 * 내용은 완전히 다르다 — 여기 관심사는 "이 단지가 지금 얼마인가"와
 * "옆 구역이 어떻게 되고 있나" 둘이다.
 */

export interface AreaQuote {
  area: number
  pyeong: number
  latest: number
  latestDate: string
  median1y: number | null
  count: number
}

interface MonthPoint {
  ym: string
  price: number | null
  count: number
}

interface AptDeal {
  dealDate: string
  area: number
  price: number
  floor: number | null
  buildingName: string | null
}

interface NearbyZone {
  id: string
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  areaM2: number
  distanceKm: number
  landPerPyeong: number | null
}

interface AptDetail {
  name: string
  gu: string
  dong: string
  jibun: string
  households: number | null
  buildings: number | null
  buildYear: number | null
  ageYears: number | null
  quotes: AreaQuote[]
  series: Record<string, MonthPoint[]>
  deals: AptDeal[]
  dealCount: number
  nearby: NearbyZone[]
  unavailable: string | null
}

const EOK = 100_000_000

const eok = (won: number | null) =>
  won ? `${(won / EOK).toFixed(2).replace(/\.?0+$/, '')}억` : '—'

/**
 * 몇 해 뒤 값 = 지금 값 × (1+r)^n.
 *
 * 예측이 아니라 산수다. 이율을 화면에 띄우고 사용자가 바꾸게 한다 —
 * 고정된 숫자로 박아 두면 우리가 전망을 내는 것처럼 읽힌다.
 */
function project(now: number, ratePct: number, years: number): number {
  return Math.round(now * (1 + ratePct / 100) ** years)
}

/** 기간 탭 — 최근 5년 / 전체 */
type Range = '5y' | 'all'

function Chart({ points }: { points: MonthPoint[] }) {
  const W = 340
  const H = 150
  const PAD = { l: 40, r: 8, t: 10, b: 26 }

  const pts = points.filter((p) => p.price != null) as (MonthPoint & { price: number })[]
  if (pts.length < 2) {
    return (
      <p className="note-box note-box--center my-2">
        선을 그리려면 서로 다른 달의 거래가 2건 이상 필요합니다.
      </p>
    )
  }

  const prices = pts.map((p) => p.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min || 1
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b)

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join('')
  const maxCount = Math.max(...pts.map((p) => p.count), 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="월별 거래가 추이">
      {/* 가로 눈금 — 최저·중간·최고 세 줄이면 값을 읽는 데 충분하다 */}
      {[0, 0.5, 1].map((f) => {
        const v = min + span * f
        return (
          <g key={f}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke="#e2e8f0"
              strokeDasharray="2 3"
            />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize="8" fill="#94a3b8">
              {(v / EOK).toFixed(1)}억
            </text>
          </g>
        )
      })}

      {/* 거래량 — 값 추이와 같이 봐야 그 가격이 몇 건에서 나온 건지 안다 */}
      {pts.map((p, i) => {
        const h = (p.count / maxCount) * 16
        return (
          <rect
            key={p.ym}
            x={x(i) - 1}
            y={H - PAD.b + 8 - h}
            width="2"
            height={h}
            fill="#c7d2fe"
          />
        )
      })}

      <path d={line} fill="none" stroke="#4f46e5" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1].price)} r="2.5" fill="#4f46e5" />

      <text x={PAD.l} y={H - 4} fontSize="8" fill="#94a3b8">
        {pts[0].ym.replace('-', '.')}
      </text>
      <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="8" fill="#94a3b8">
        {pts[pts.length - 1].ym.replace('-', '.')}
      </text>
    </svg>
  )
}

export default function AptPanel({
  gu,
  dong,
  jibun,
  name,
  onClose,
  onSelectZone,
}: {
  gu: string
  dong: string
  jibun: string
  name: string
  onClose: () => void
  onSelectZone: (id: string) => void
}) {
  const [data, setData] = useState<AptDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [area, setArea] = useState<number | null>(null)
  const [range, setRange] = useState<Range>('all')
  const [shown, setShown] = useState(5)
  /** 예상 시세 가정 이율 (%) — 사용자가 바꿀 수 있어야 한다 */
  const [rate, setRate] = useState(3)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setData(null)
    setShown(5)
    const q = new URLSearchParams({ gu, dong, jibun, name })
    fetch(`/api/apt-detail?${q}`)
      .then((r) => r.json())
      .then((j: AptDetail) => {
        if (cancelled) return
        setData(j)
        // 84㎡ 에 가까운 평형을 기본으로 — 사람들이 기준으로 삼는 크기다
        const qs = j.quotes ?? []
        const pick =
          qs.find((x) => x.area >= 82 && x.area <= 86) ??
          qs.reduce<AreaQuote | null>((a, b) => (!a || b.count > a.count ? b : a), null)
        setArea(pick?.area ?? null)
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [gu, dong, jibun, name])

  const points = useMemo(() => {
    if (!data || area == null) return []
    const all = data.series[String(area)] ?? []
    if (range === 'all') return all
    const cut = (() => {
      const t = new Date()
      t.setFullYear(t.getFullYear() - 5)
      return t.toISOString().slice(0, 7)
    })()
    return all.filter((p) => p.ym >= cut)
  }, [data, area, range])

  const dealsOfArea = useMemo(
    () => (data && area != null ? data.deals.filter((d) => d.area === area) : []),
    [data, area],
  )

  return (
    <aside
      className="absolute top-0 right-0 bottom-0 z-30 flex w-full flex-col border-l border-gray-200 bg-white sm:w-[400px]"
      style={{ boxShadow: 'var(--shadow-float)' }}
    >
      {/* ── 헤더 ── */}
      <div className="shrink-0 border-b border-gray-100 bg-white/85 px-5 py-4 backdrop-blur-md">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-tight text-indigo-600">
              <span className="inline-block h-3 w-[3px] rounded-sm bg-indigo-600" />
              아파트 단지
            </p>
            <h2 className="mt-1 text-lg leading-snug font-bold tracking-tight break-keep">
              {name}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-rose-500"
          >
            ✕
          </button>
        </div>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-gray-500">
          <span>
            {dong} {jibun}
          </span>
          {data?.households && (
            <>
              <span className="text-gray-300">|</span>
              <span>{data.households.toLocaleString()}세대</span>
            </>
          )}
          {data?.buildYear && (
            <>
              <span className="text-gray-300">|</span>
              <span>
                {data.buildYear}년{data.ageYears != null && ` (${data.ageYears}년차)`}
              </span>
            </>
          )}
        </p>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto">
        {loading && <p className="px-5 py-10 text-center text-sm text-gray-400">불러오는 중…</p>}

        {!loading && data?.unavailable && (
          <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-relaxed text-amber-900">
            <b>{molitErrorMessage(data.unavailable).title}</b>
            <p className="mt-1 text-[11px]">{molitErrorMessage(data.unavailable).detail}</p>
          </div>
        )}

        {!loading && data && !data.unavailable && data.quotes.length === 0 && (
          <div className="px-5 py-8">
            <p className="note-box note-box--center">
              최근 10년간 이 단지의 매매 실거래 신고가 없습니다.
            </p>
          </div>
        )}

        {!loading && data && data.quotes.length > 0 && (
          <>
            {/* ── 시세 ── */}
            <section
              className="panel-section"
              style={{ '--accent': '#6366f1' } as React.CSSProperties}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="panel-h mb-0">시세</h3>
                <label className="flex items-center gap-1 text-[10px] text-gray-400">
                  연
                  <input
                    type="number"
                    value={rate}
                    step={0.5}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className="w-11 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums outline-none focus:border-indigo-500"
                  />
                  % 가정
                </label>
              </div>

              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="py-1 text-left font-medium">전용</th>
                    <th className="py-1 text-right font-medium">실거래</th>
                    <th className="py-1 text-right font-medium">5년 후</th>
                    <th className="py-1 text-right font-medium">10년 후</th>
                  </tr>
                </thead>
                <tbody>
                  {data.quotes.map((q) => (
                    <tr
                      key={q.area}
                      onClick={() => setArea(q.area)}
                      className={`cursor-pointer border-t border-gray-50 ${
                        q.area === area ? 'bg-indigo-50/60' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-1.5 font-bold">
                        {q.area}㎡
                        <span className="ml-1 font-normal text-[10px] text-gray-400">
                          {q.pyeong}평
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-bold tabular-nums">
                        {eok(q.latest)}
                        <span className="ml-1 text-[10px] font-normal text-gray-400">
                          ({q.latestDate.slice(2, 7).replace('-', '.')})
                        </span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-rose-500">
                        {eok(project(q.latest, rate, 5))}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-rose-600">
                        {eok(project(q.latest, rate, 10))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 이 표에서 유일하게 사실이 아닌 두 열이다. 그걸 분명히 적는다. */}
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-900">
                <b>5년 후 · 10년 후는 예측이 아닙니다.</b> 최근 실거래가에 연 {rate}% 복리를 곱한
                단순 산수이며, 실제 시세는 정비사업 진행·금리·공급 등에 따라 전혀 다르게 움직입니다.
                이율을 바꿔 가며 감을 잡는 용도로만 쓰세요.
              </p>
            </section>

            {/* ── 실거래 ── */}
            <section
              className="panel-section"
              style={{ '--accent': '#0ea5e9' } as React.CSSProperties}
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="panel-h mb-0">실거래</h3>
                <select
                  value={area ?? ''}
                  onChange={(e) => {
                    setArea(Number(e.target.value))
                    setShown(5)
                  }}
                  className="rounded-lg border border-gray-200 px-2 py-1 text-[11px]"
                >
                  {data.quotes.map((q) => (
                    <option key={q.area} value={q.area}>
                      전용 {q.area}㎡
                    </option>
                  ))}
                </select>
              </div>

              <div className="mb-2 flex gap-1">
                {(
                  [
                    ['5y', '최근 5년'],
                    ['all', '전체'],
                  ] as [Range, string][]
                ).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setRange(k)}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
                      range === k
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <Chart points={points} />

              <table className="mt-2 w-full text-[11px]">
                <thead>
                  <tr className="text-gray-400">
                    <th className="py-1 text-left font-medium">계약일</th>
                    <th className="py-1 text-right font-medium">전용</th>
                    <th className="py-1 text-right font-medium">가격</th>
                    <th className="py-1 text-right font-medium">층</th>
                  </tr>
                </thead>
                <tbody>
                  {dealsOfArea.slice(0, shown).map((d, i) => (
                    <tr key={`${d.dealDate}-${d.floor}-${i}`} className="border-t border-gray-50">
                      <td className="py-1.5 tabular-nums">{d.dealDate.replace(/-/g, '.')}</td>
                      <td className="py-1.5 text-right tabular-nums">{d.area}㎡</td>
                      <td className="py-1.5 text-right font-bold tabular-nums">{eok(d.price)}</td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">
                        {d.floor != null ? `${d.floor}층` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {dealsOfArea.length > shown && (
                <button
                  onClick={() => setShown((n) => n + 10)}
                  className="mt-2 w-full rounded-lg border border-gray-200 py-2 text-xs font-bold text-gray-500 hover:bg-gray-50"
                >
                  더보기{' '}
                  <span className="font-normal text-gray-400">
                    ({shown}/{dealsOfArea.length})
                  </span>
                </button>
              )}
            </section>

            {/* ── 인근 구역 ── */}
            <section
              className="panel-section"
              style={{ '--accent': '#ec4899' } as React.CSSProperties}
            >
              <h3 className="panel-h">인근 구역</h3>
              {data.nearby.length === 0 ? (
                <p className="note-box note-box--center">반경 1.5km 안에 정비구역이 없습니다.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="py-1 text-left font-medium">이름</th>
                      <th className="py-1 text-right font-medium">단계</th>
                      <th className="py-1 text-right font-medium">면적</th>
                      <th className="py-1 text-right font-medium">대지평당가</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.nearby.map((z) => (
                      <tr
                        key={z.id}
                        onClick={() => onSelectZone(z.id)}
                        className="cursor-pointer border-t border-gray-50 hover:bg-gray-50"
                      >
                        <td className="max-w-[110px] truncate py-1.5 font-bold">
                          <span
                            className="mr-1 inline-block h-2 w-[2px] rounded-sm align-middle"
                            style={{
                              background: PROJECT_TYPE_MAP.get(z.projectType)?.color ?? '#9ca3af',
                            }}
                          />
                          {z.name}
                        </td>
                        <td
                          className="py-1.5 text-right font-semibold"
                          style={{ color: stageColor(z.canonicalStage) }}
                        >
                          {z.stage ?? '미확인'}
                        </td>
                        <td className="py-1.5 text-right tabular-nums text-gray-500">
                          {(z.areaM2 / 10000).toFixed(1)}만㎡
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {z.landPerPyeong
                            ? `${Math.round(z.landPerPyeong / 10000).toLocaleString()}만/평`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
                대지평당가는 구역 필지의 개별공시지가 중앙값입니다(공시지가는 통상 시세보다
                낮습니다). 실거래: 국토교통부 / 세대수·준공: 건축물대장 총괄표제부. 본 서비스는
                중개·감정평가·투자자문을 제공하지 않습니다.
              </p>
            </section>
          </>
        )}
      </div>
    </aside>
  )
}
