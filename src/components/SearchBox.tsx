'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PROJECT_TYPE_MAP, stageColor } from '@/lib/taxonomy'
import { clearViews, getRecentViews, subscribeStore } from '@/lib/userStore'
import type { DevelopBrief } from './panels/shared'

export interface ZoneHit {
  kind: 'zone'
  id: string
  name: string
  projectType: string
  stage: string | null
  canonicalStage: string | null
  gu: string | null
  bbox: [number, number, number, number]
}

export interface PlaceHit {
  kind: 'place'
  id: string
  name: string
  category: string
  detail: string
  lng: number
  lat: number
}

/** 검색어와 일치하는 부분만 강조 — 어디가 걸렸는지 바로 보이게 한다 */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className="text-indigo-600">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  )
}

function TypeChip({ code }: { code: string }) {
  const t = PROJECT_TYPE_MAP.get(code)
  return (
    <span
      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: `${t?.color ?? '#888'}1A`, color: t?.color ?? '#666' }}
    >
      {t?.label ?? '기타'}
    </span>
  )
}

export default function SearchBox({
  onSelectZone,
  onSelectPlace,
}: {
  onSelectZone: (id: string, bbox: [number, number, number, number]) => void
  onSelectPlace: (lng: number, lat: number) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [zones, setZones] = useState<ZoneHit[]>([])
  const [places, setPlaces] = useState<PlaceHit[]>([])
  const [recent, setRecent] = useState<DevelopBrief[]>([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  /* 바깥 클릭 시 닫기 */
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  /* 최근 본 구역 — 조회 기록 id 를 실제 구역 정보로 바꿔 온다 */
  const loadRecent = useCallback(async () => {
    const ids = getRecentViews(15).map((v) => v.id)
    if (!ids.length) {
      setRecent([])
      return
    }
    try {
      const res = await fetch(`/api/develops/browse?ids=${ids.join(',')}`)
      const json = await res.json()
      setRecent(json.items ?? [])
    } catch {
      setRecent([])
    }
  }, [])

  useEffect(() => {
    loadRecent()
    return subscribeStore(loadRecent)
  }, [loadRecent])

  /* 입력 디바운스 — 글자마다 API를 때리지 않는다 */
  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setZones([])
      setPlaces([])
      return
    }
    setLoading(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => r.json())
        .then((j) => {
          setZones(j.zones ?? [])
          setPlaces(j.places ?? [])
        })
        .catch(() => {
          setZones([])
          setPlaces([])
        })
        .finally(() => setLoading(false))
    }, 220)
    return () => clearTimeout(timer)
  }, [q])

  const showRecent = !q.trim()
  const hasResult = zones.length > 0 || places.length > 0

  return (
    <div ref={boxRef} className="relative">
      <div
        className={`flex items-center gap-2 rounded-full border px-3.5 py-2.5 transition ${
          open ? 'border-indigo-500 bg-white ring-2 ring-indigo-100' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="구역 이름, 주소, 지하철 역으로 검색"
          className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
        />
        {q && (
          <button
            onClick={() => setQ('')}
            aria-label="지우기"
            className="shrink-0 text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        )}
        <span className="shrink-0 text-gray-400">🔍</span>
      </div>

      {open && (
        <div className="thin-scroll absolute top-[calc(100%+6px)] right-0 left-0 z-50 max-h-[70vh] overflow-y-auto rounded-2xl border border-gray-200 bg-white py-2 shadow-xl">
          {/* 최근 본 구역 */}
          {showRecent && (
            <>
              <div className="flex items-center justify-between px-4 py-1.5">
                <span className="text-xs font-bold text-gray-500">최근 본 구역</span>
                {recent.length > 0 && (
                  <button
                    onClick={() => {
                      clearViews()
                      setRecent([])
                    }}
                    aria-label="최근 본 구역 전체 삭제"
                    className="text-gray-300 hover:text-rose-500"
                  >
                    🗑
                  </button>
                )}
              </div>
              {recent.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-gray-400">
                  최근 본 구역이 없습니다.
                  <br />
                  지도에서 구역을 눌러보세요.
                </p>
              )}
              {recent.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    onSelectZone(d.id, d.bbox)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  <TypeChip code={d.projectType} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">{d.name}</span>
                  <span className="shrink-0 text-gray-300">›</span>
                </button>
              ))}
            </>
          )}

          {/* 검색 결과 */}
          {!showRecent && (
            <>
              {loading && !hasResult && (
                <p className="px-4 py-6 text-center text-xs text-gray-400">검색 중…</p>
              )}
              {!loading && !hasResult && (
                <p className="px-4 py-6 text-center text-xs text-gray-400">
                  검색 결과가 없습니다.
                </p>
              )}

              {zones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => {
                    onSelectZone(z.id, z.bbox)
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  <TypeChip code={z.projectType} />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    <Highlight text={z.name} q={q.trim()} />
                  </span>
                  <span
                    className="shrink-0 text-[11px] font-semibold"
                    style={{ color: z.stage ? stageColor(z.canonicalStage) : '#9CA3AF' }}
                  >
                    {z.stage ?? '단계 미확인'}
                  </span>
                  <span className="shrink-0 text-gray-300">›</span>
                </button>
              ))}

              {zones.length > 0 && places.length > 0 && (
                <div className="my-1 border-t border-gray-100" />
              )}

              {places.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    onSelectPlace(p.lng, p.lat)
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      <Highlight text={p.name} q={q.trim()} />
                      <span className="ml-1.5 text-[11px] font-normal text-gray-400">
                        {p.category}
                      </span>
                    </p>
                    {p.detail && (
                      <p className="truncate text-[11px] text-gray-400">{p.detail}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-300">›</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
