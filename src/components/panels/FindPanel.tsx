'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'
import { getFavorites, subscribeStore } from '@/lib/userStore'
import { molitErrorMessage } from '@/lib/molitError'
import {
  EMPTY_FILTERS,
  PRESETS,
  estimatePremium,
  matches,
  rollupByZone,
  sortItems,
  stageGroups,
  typeGroups,
  type FindItem,
  type Filters,
  type SortKey,
} from '@/lib/findFilter'
import type { ZoneDeals } from './ZoneDealCard'

/**
 * 매물 찾기.
 *
 * 벤치마크와 같은 구조 — 추천 필터 / 구역 필터 / 매물 필터 / 구역별·매물별 탭.
 * 다만 채우는 값이 다르다. 우리에겐 중개 매물이 없어서 국토교통부 실거래를 쓴다.
 * 호가가 아니라 체결가라는 차이는 화면 맨 위에서 밝힌다.
 */

const EOK = 100_000_000

function eok(won: number | null | undefined): string {
  if (!won) return '—'
  if (won >= EOK) return `${(won / EOK).toFixed(2).replace(/\.?0+$/, '')}억`
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

/** 여닫이 필터 버튼 — 열려 있는 하나만 남긴다 */
function Popover({
  label,
  active,
  open,
  onToggle,
  children,
}: {
  label: string
  active: boolean
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold transition ${
          active
            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
            : open
              ? 'border-gray-900 text-gray-900'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1.5 w-[280px] rounded-xl border border-gray-200 bg-white p-3 shadow-[var(--shadow-float)]">
          {children}
        </div>
      )}
    </div>
  )
}

function Chip({
  on,
  onClick,
  children,
  color,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition ${
        on
          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {color && (
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      )}
      {children}
    </button>
  )
}

export default function FindPanel({
  gus,
  guSelect,
  gu,
  onSelectZone,
}: {
  gus: { gu: string; count: number }[]
  guSelect: React.ReactNode
  gu: string
  onSelectZone: (id: string) => void
}) {
  const [raw, setRaw] = useState<FindItem[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState<Filters>(EMPTY_FILTERS)
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<'zone' | 'item'>('zone')
  const [sort, setSort] = useState<SortKey>('price')
  const [shown, setShown] = useState(20)
  const [favTick, setFavTick] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeStore(() => setFavTick((t) => t + 1)), [])
  const favorites = useMemo(() => new Set(getFavorites().map((v) => v.id)), [favTick])

  /* 바깥을 누르면 열린 필터를 닫는다 */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.find-filters')) setOpen(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /* ── 실거래 수집 ──
     구역별 실거래 API 를 그대로 쓴다. 매물 목록에 필요한 값(공시가·대지지분·
     대지평당가·사용승인)이 이미 거기 붙어 있다. */
  const load = useCallback(async () => {
    if (!gu) {
      setRaw([])
      return
    }
    setLoading(true)
    setErr(null)
    setShown(20)
    try {
      const j = await fetch(`/api/zone-transactions?gu=${encodeURIComponent(gu)}&days=365`).then(
        (r) => r.json(),
      )
      setErr(j.unavailable ?? null)
      const items: FindItem[] = []
      for (const z of (j.zones ?? []) as ZoneDeals[]) {
        for (const d of z.deals) {
          items.push({
            zoneId: z.id,
            zoneName: z.name,
            projectType: z.projectType,
            canonicalStage: z.canonicalStage,
            stage: z.stage,
            typeLabel: d.typeLabel,
            dealDate: d.dealDate,
            price: d.price,
            dong: d.dong,
            jibun: d.jibun,
            buildYear: d.buildYear,
            exclusiveAr: d.exclusiveAr,
            landPyeong: d.landPyeong,
            pricePerLandPyeong: d.pricePerLandPyeong,
            publicPrice: d.publicPrice ?? null,
            premium: estimatePremium(d.price, d.landPyeong, z.medianPerPyeong),
          })
        }
      }
      setRaw(items)
    } catch {
      setErr('FETCH_FAILED')
    } finally {
      setLoading(false)
    }
  }, [gu])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(
    () => raw.filter((it) => matches(it, f, favorites)),
    [raw, f, favorites],
  )
  const items = useMemo(() => sortItems(filtered, sort), [filtered, sort])
  const zones = useMemo(() => rollupByZone(filtered), [filtered])

  const set = (patch: Partial<Filters>) => {
    setF((p) => ({ ...p, ...patch }))
    setShown(20)
  }
  const toggleIn = (key: 'types' | 'stages' | 'kinds', v: string) =>
    set({ [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] } as Partial<Filters>)

  const kinds = useMemo(() => [...new Set(raw.map((r) => r.typeLabel))].sort(), [raw])
  const dirty =
    JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS) ? true : false

  return (
    <div ref={boxRef} className="thin-scroll flex-1 overflow-y-auto">
      {/* 우리 매물이 아니라는 걸 먼저 말한다 */}
      <div className="mx-4 mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11px] leading-relaxed text-sky-900">
        <b>중개 매물은 아직 연동되지 않았습니다.</b> 아래 목록은 <b>국토교통부 실거래</b>(최근
        1년)입니다 — 호가가 아니라 실제 체결가라 지금 살 수 있는 값과는 다릅니다. 매물 호가는
        중개 플랫폼이나 중개사에서 확인하세요.
      </div>

      <div className="find-filters px-4 pt-3">
        {/* ── 추천 필터 ── */}
        <p className="mb-1.5 text-[11px] font-bold text-gray-400">추천 필터</p>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const on = Object.entries(p.patch).every(
              ([k, v]) => JSON.stringify(f[k as keyof Filters]) === JSON.stringify(v),
            )
            return (
              <button
                key={p.key}
                onClick={() =>
                  set(
                    on
                      ? (Object.fromEntries(
                          Object.keys(p.patch).map((k) => [k, EMPTY_FILTERS[k as keyof Filters]]),
                        ) as Partial<Filters>)
                      : (p.patch as Partial<Filters>),
                  )
                }
                className={`rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition ${
                  on
                    ? 'border-rose-500 bg-rose-50 text-rose-600'
                    : 'border-rose-200 text-rose-500 hover:bg-rose-50'
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        {/* ── 구역 필터 ── */}
        <div className="mt-3 mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-bold text-gray-400">구역 필터</p>
          {dirty && (
            <button
              onClick={() => setF(EMPTY_FILTERS)}
              className="text-[11px] font-bold text-gray-400 hover:text-gray-700"
            >
              ↺ 초기화
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div className="w-full">{guSelect}</div>

          <Popover
            label="사업종류"
            active={f.types.length > 0}
            open={open === 'type'}
            onToggle={() => setOpen(open === 'type' ? null : 'type')}
          >
            {typeGroups().map(([group, ts]) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="mb-1 text-[11px] font-bold text-gray-500">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {ts.map((t) => (
                    <Chip
                      key={t.code}
                      on={f.types.includes(t.code)}
                      color={t.color}
                      onClick={() => toggleIn('types', t.code)}
                    >
                      {t.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </Popover>

          <Popover
            label="진행단계"
            active={f.stages.length > 0}
            open={open === 'stage'}
            onToggle={() => setOpen(open === 'stage' ? null : 'stage')}
          >
            {stageGroups().map(([group, ss]) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="mb-1 text-[11px] font-bold text-gray-500">{group}</p>
                <div className="flex flex-wrap gap-1">
                  {ss.map((s) => (
                    <Chip
                      key={s.code}
                      on={f.stages.includes(s.code)}
                      color={s.color}
                      onClick={() => toggleIn('stages', s.code)}
                    >
                      {s.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </Popover>

          <button
            onClick={() => set({ favoritesOnly: !f.favoritesOnly })}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold transition ${
              f.favoritesOnly
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            관심구역
          </button>
        </div>

        {/* ── 매물 필터 ── */}
        <p className="mt-3 mb-1.5 text-[11px] font-bold text-gray-400">매물 필터</p>
        <div className="flex flex-wrap gap-1.5">
          <Popover
            label="유형"
            active={f.kinds.length > 0}
            open={open === 'kind'}
            onToggle={() => setOpen(open === 'kind' ? null : 'kind')}
          >
            <div className="flex flex-wrap gap-1">
              {kinds.length === 0 && <p className="text-[11px] text-gray-400">거래가 없습니다</p>}
              {kinds.map((k) => (
                <Chip key={k} on={f.kinds.includes(k)} onClick={() => toggleIn('kinds', k)}>
                  {k}
                </Chip>
              ))}
            </div>
          </Popover>

          <Popover
            label="가격"
            active={f.priceMax != null}
            open={open === 'price'}
            onToggle={() => setOpen(open === 'price' ? null : 'price')}
          >
            <div className="flex flex-wrap gap-1">
              {[1, 3, 4, 5, 10, 15, 20].map((e) => (
                <Chip
                  key={e}
                  on={f.priceMax === e * EOK}
                  onClick={() => set({ priceMax: f.priceMax === e * EOK ? null : e * EOK })}
                >
                  ~{e}억
                </Chip>
              ))}
            </div>
          </Popover>

          <Popover
            label="공시가"
            active={f.publicPriceMax != null}
            open={open === 'pub'}
            onToggle={() => setOpen(open === 'pub' ? null : 'pub')}
          >
            <div className="flex flex-wrap gap-1">
              {[1, 2, 3, 5, 10].map((e) => (
                <Chip
                  key={e}
                  on={f.publicPriceMax === e * EOK}
                  onClick={() =>
                    set({ publicPriceMax: f.publicPriceMax === e * EOK ? null : e * EOK })
                  }
                >
                  ~{e}억
                </Chip>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
              공동주택 공시가격. 값을 모르는 거래는 제외됩니다.
            </p>
          </Popover>

          <Popover
            label="사용승인"
            active={f.builtBefore != null}
            open={open === 'built'}
            onToggle={() => setOpen(open === 'built' ? null : 'built')}
          >
            <div className="flex flex-wrap gap-1">
              {[1990, 1995, 2000, 2005, 2010].map((y) => (
                <Chip
                  key={y}
                  on={f.builtBefore === y}
                  onClick={() => set({ builtBefore: f.builtBefore === y ? null : y })}
                >
                  {y}년 이전
                </Chip>
              ))}
            </div>
          </Popover>

          <Popover
            label="대지지분"
            active={f.landPyeongMin != null}
            open={open === 'land'}
            onToggle={() => setOpen(open === 'land' ? null : 'land')}
          >
            <div className="flex flex-wrap gap-1">
              {[5, 10, 15, 20, 30].map((p) => (
                <Chip
                  key={p}
                  on={f.landPyeongMin === p}
                  onClick={() => set({ landPyeongMin: f.landPyeongMin === p ? null : p })}
                >
                  {p}평 이상
                </Chip>
              ))}
            </div>
          </Popover>

          <Popover
            label="면적"
            active={f.areaMin != null}
            open={open === 'area'}
            onToggle={() => setOpen(open === 'area' ? null : 'area')}
          >
            <div className="flex flex-wrap gap-1">
              {[30, 40, 50, 60, 85].map((a) => (
                <Chip
                  key={a}
                  on={f.areaMin === a}
                  onClick={() => set({ areaMin: f.areaMin === a ? null : a })}
                >
                  {a}㎡ 이상
                </Chip>
              ))}
            </div>
          </Popover>
        </div>
      </div>

      {/* ── 구역별 / 매물별 ── */}
      <div className="mt-4 flex border-b border-gray-100 px-4">
        {(
          [
            ['zone', `구역별 ${zones.length}`],
            ['item', `거래별 ${filtered.length}`],
          ] as ['zone' | 'item', string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 border-b-2 py-2 text-[13px] font-bold transition ${
              tab === k
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'item' && (
        <div className="flex gap-3 px-4 py-2 text-[11px]">
          {(
            [
              ['price', '가격 낮은순'],
              ['premium', '추정 P 낮은순'],
              ['landPyeong', '대지지분 큰순'],
              ['recent', '최근순'],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`font-bold ${sort === k ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="px-4 py-10 text-center text-sm text-gray-400">불러오는 중…</p>}

      {!loading && err && (
        <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-relaxed text-amber-900">
          <b>{molitErrorMessage(err).title}</b>
          <p className="mt-1 text-[11px]">{molitErrorMessage(err).detail}</p>
        </div>
      )}

      {!loading && !err && !gu && (
        <div className="px-4 py-8">
          <p className="note-box note-box--center">자치구를 고르면 조건에 맞는 거래를 찾습니다.</p>
        </div>
      )}

      {!loading && !err && gu && filtered.length === 0 && (
        <div className="px-4 py-8">
          <p className="note-box note-box--center">
            조건에 맞는 거래가 없습니다.
            {dirty && '\n필터를 넓혀 보세요.'}
          </p>
        </div>
      )}

      {/* ── 구역별 ── */}
      {!loading &&
        tab === 'zone' &&
        zones.slice(0, shown).map((z) => (
          <button
            key={z.id}
            onClick={() => onSelectZone(z.id)}
            className="list-row flex w-full items-center gap-2.5 border-b border-gray-50 px-4 py-3 text-left hover:bg-gray-50"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span
                  className="chip shrink-0"
                  style={
                    { '--chip': PROJECT_TYPE_MAP.get(z.projectType)?.color } as React.CSSProperties
                  }
                >
                  {PROJECT_TYPE_MAP.get(z.projectType)?.short ?? '기타'}
                </span>
                <span className="truncate text-sm font-bold">{z.name}</span>
              </div>
              <p
                className="mt-0.5 text-[11px] font-semibold"
                style={{ color: stageColor(z.canonicalStage) }}
              >
                {z.stage ?? '단계 미확인'}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] text-gray-400">
                거래 <b className="text-gray-700">{z.count}건</b>
              </p>
              <p className="text-[12px] font-bold text-indigo-600">최저 {eok(z.minPrice)}</p>
            </div>
          </button>
        ))}

      {/* ── 거래별 ── */}
      {!loading && tab === 'item' && (
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-white">
            <tr className="text-gray-400">
              <th className="px-4 py-1.5 text-left font-medium">유형</th>
              <th className="py-1.5 text-right font-medium">거래가</th>
              <th className="py-1.5 text-right font-medium">공시가</th>
              <th className="py-1.5 text-right font-medium">대지지분</th>
              <th className="px-4 py-1.5 text-right font-medium">추정 P</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(0, shown).map((it, i) => (
              <tr
                key={`${it.dong}-${it.jibun}-${it.dealDate}-${i}`}
                onClick={() => onSelectZone(it.zoneId)}
                className="cursor-pointer border-t border-gray-50 hover:bg-gray-50"
              >
                <td className="px-4 py-2">
                  <span className="block font-bold">{it.typeLabel}</span>
                  <span className="block text-[10px] text-gray-400">
                    {it.dong} {it.jibun}
                    {it.buildYear ? ` · ${it.buildYear}년` : ''}
                  </span>
                </td>
                <td className="py-2 text-right font-bold tabular-nums text-indigo-600">
                  {eok(it.price)}
                </td>
                <td className="py-2 text-right tabular-nums text-gray-500">
                  {eok(it.publicPrice)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {it.landPyeong ? `${it.landPyeong.toFixed(1)}평` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-bold tabular-nums text-rose-500">
                  {it.premium != null ? eok(it.premium) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading &&
        (tab === 'zone' ? zones.length : items.length) > shown && (
          <button
            onClick={() => setShown((n) => n + 20)}
            className="mx-3 my-2 w-[calc(100%-1.5rem)] rounded-lg border border-gray-200 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-50"
          >
            더보기{' '}
            <span className="font-normal text-gray-400">
              ({shown}/{tab === 'zone' ? zones.length : items.length})
            </span>
          </button>
        )}

      {!loading && gu && filtered.length > 0 && (
        <p className="px-4 pt-2 pb-5 text-[10px] leading-relaxed text-gray-400">
          <b>추정 P</b> = 거래가 − 대지지분 × 구역 대지평당가 × 감정가율 70%. 분담금 시뮬레이터와
          같은 모델이며 조합이 확정한 감정가와 다릅니다. 공시가는 공동주택 공시가격, 대지평당가는
          구역 실거래 중앙값입니다. 출처: 국토교통부. 본 서비스는 중개·감정평가·투자자문을
          제공하지 않습니다.
        </p>
      )}
    </div>
  )
}
