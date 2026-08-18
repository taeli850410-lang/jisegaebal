'use client'

import { useEffect, useState } from 'react'
import { StageBadge } from './shared'

/**
 * 공매 목록 (온비드).
 *
 * 법원경매는 공개 API 가 없어 여기 없다. 그 사실을 목록 아래에 적어 둔다 —
 * "경매"라는 이름만 보고 법원경매까지 있다고 읽으면 안 된다.
 */

export interface AuctionItem {
  cltrMngNo: string
  name: string
  propertyType: string
  disposal: string
  useCategory: string
  dong: string
  jibun: string | null
  appraisal: number | null
  minBid: number | null
  discountPct: number | null
  landM2: number | null
  buildingM2: number | null
  bidStart: string | null
  bidEnd: string | null
  status: string
  href: string
  zoneId: string | null
  zoneName: string | null
  canonicalStage: string | null
}

const EOK = 100_000_000

function money(won: number | null): string {
  if (!won) return '—'
  if (won >= EOK) {
    return `${(won / EOK).toFixed(won >= 10 * EOK ? 0 : 1).replace(/\.0$/, '')}억`
  }
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

/** 마감까지 남은 시간 — 곧 닫히는 물건이 먼저 눈에 들어와야 한다 */
function remain(bidEnd: string | null, now: number): { text: string; urgent: boolean } | null {
  if (!bidEnd || !now) return null
  const t = new Date(`${bidEnd.replace(' ', 'T')}:00`).getTime()
  if (!Number.isFinite(t)) return null
  const diff = t - now
  if (diff <= 0) return { text: '마감', urgent: false }
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return { text: `${hours}시간 후 마감`, urgent: true }
  const days = Math.floor(hours / 24)
  return { text: `${days}일 후 마감`, urgent: days <= 3 }
}

export default function AuctionPanel({
  gu,
  guSelect,
  onSelectZone,
}: {
  gu: string
  guSelect: React.ReactNode
  onSelectZone: (id: string) => void
}) {
  const [items, setItems] = useState<AuctionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<{ total: number; inZone: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [zoneOnly, setZoneOnly] = useState(false)
  const [shown, setShown] = useState(15)
  /**
   * 남은 시간 계산 기준.
   * 렌더 중에 Date.now 를 부르면 서버와 클라이언트 값이 달라 하이드레이션이 어긋난다.
   */
  const [now, setNow] = useState(0)

  useEffect(() => setNow(Date.now()), [items])

  useEffect(() => {
    if (!gu) {
      setItems([])
      setMeta(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setShown(15)
    fetch(`/api/auctions?gu=${encodeURIComponent(gu)}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return
        setItems(j.items ?? [])
        setMeta({ total: j.total ?? 0, inZone: j.inZone ?? 0 })
        setErr(j.unavailable ?? null)
      })
      .catch(() => !cancelled && setErr('FETCH_FAILED'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [gu])

  const list = zoneOnly ? items.filter((i) => i.zoneId) : items

  return (
    <>
      <div className="flex gap-2 border-b border-gray-50 px-4 py-2.5">{guSelect}</div>

      {gu && meta && !loading && (
        <div className="flex items-center justify-between border-b border-gray-50 px-4 py-2">
          <p className="text-[11px] text-gray-500">
            공매 {meta.total.toLocaleString()}건 · 정비구역 안 {meta.inZone}건
          </p>
          <button
            onClick={() => setZoneOnly((v) => !v)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
              zoneOnly ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            구역 안만
          </button>
        </div>
      )}

      {loading && <p className="px-4 py-10 text-center text-sm text-gray-400">불러오는 중…</p>}

      {!loading && err && (
        <div className="mx-4 my-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-[12px] leading-relaxed text-amber-900">
          <b>공매 정보를 불러오지 못했습니다.</b>
          <p className="mt-1 text-[11px]">온비드 응답: {err}</p>
        </div>
      )}

      {!loading && !err && !gu && (
        <div className="px-4 py-8">
          <p className="note-box note-box--center">자치구를 고르면 공매 물건을 보여줍니다.</p>
        </div>
      )}

      {!loading && !err && gu && list.length === 0 && (
        <div className="px-4 py-8">
          <p className="note-box note-box--center">
            {zoneOnly
              ? '정비구역 안에 진행 중인 공매가 없습니다.'
              : '이 자치구에 진행 중인 공매가 없습니다.'}
          </p>
        </div>
      )}

      {!loading &&
        list.slice(0, shown).map((it) => {
          const left = remain(it.bidEnd, now)
          return (
            <div key={it.cltrMngNo} className="border-b border-gray-50 px-4 py-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-bold">{it.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="chip" style={{ '--chip': '#0ea5e9' } as React.CSSProperties}>
                      {it.propertyType}
                    </span>
                    <span className="truncate text-[11px] text-gray-400">{it.useCategory}</span>
                  </div>
                </div>
                {left && (
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      left.urgent ? 'bg-rose-50 text-rose-600' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {left.text}
                  </span>
                )}
              </div>

              <div className="mt-2 flex items-end gap-3">
                <div>
                  <p className="text-[10px] text-gray-500">최저입찰가</p>
                  <p className="text-[15px] font-extrabold tabular-nums">{money(it.minBid)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500">감정가</p>
                  <p className="text-[13px] font-semibold tabular-nums text-gray-600">
                    {money(it.appraisal)}
                  </p>
                </div>
                {it.discountPct != null && it.discountPct < 100 && (
                  /* 최저가가 감정가의 몇 % 인지 — 유찰이 쌓일수록 내려간다 */
                  <span className="mb-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
                    감정가의 {it.discountPct}%
                  </span>
                )}
              </div>

              {it.zoneId && (
                <button
                  onClick={() => onSelectZone(it.zoneId as string)}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-left hover:bg-indigo-100"
                >
                  <StageBadge stage={null} canonical={it.canonicalStage} />
                  <span className="truncate text-[11px] font-bold text-indigo-800">
                    {it.zoneName}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-indigo-400">보기 ›</span>
                </button>
              )}

              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
                <span className="truncate">
                  {it.bidStart?.slice(5)} ~ {it.bidEnd?.slice(5)} · {it.status}
                </span>
                <a
                  href={it.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 shrink-0 font-bold text-gray-500 hover:text-indigo-600"
                >
                  온비드 ↗
                </a>
              </div>
            </div>
          )
        })}

      {!loading && list.length > shown && (
        <button
          onClick={() => setShown((n) => n + 15)}
          className="mx-3 my-2 w-[calc(100%-1.5rem)] rounded-lg border border-gray-200 py-2.5 text-xs font-bold text-gray-500 hover:bg-gray-50"
        >
          {Math.min(15, list.length - shown)}개 더보기{' '}
          <span className="font-normal text-gray-400">
            ({shown}/{list.length})
          </span>
        </button>
      )}

      {!loading && gu && (
        <p className="px-4 pt-2 pb-4 text-[10px] leading-relaxed text-gray-400">
          출처: 한국자산관리공사 온비드 공매. <b>법원경매는 공개 API가 없어 포함되지 않습니다.</b>{' '}
          구역 표시는 물건 지번을 좌표로 변환해 구역 경계 안으로 판정된 건입니다. 입찰
          조건·권리관계는 반드시 온비드 원문에서 확인하세요.
        </p>
      )}
    </>
  )
}
