'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '@/lib/kakaoLoader'
import { PROJECT_TYPE_MAP } from '@/lib/taxonomy'
import { agingColor } from '@/lib/geo'
import { outerRings, type ApiDevelop, type DevelopsResponse } from '@/lib/types'
import type { Parcel } from '@/app/api/parcels/route'
import FilterBar from './FilterBar'
import { LayerToggles, ToolPanel, type LayerState, type ToolState } from './MapToolbar'
import DevelopPanel from './DevelopPanel'
import Sidebar from './Sidebar'

const INITIAL_CENTER = { lat: 37.5502, lng: 126.9908 } // 서울 중심
const INITIAL_LEVEL = 8
/** 이 레벨보다 확대해야 필지를 그린다 (카카오는 숫자가 작을수록 확대) */
const PARCEL_MAX_LEVEL = 4
/** 라벨이 너무 많으면 DOM이 폭발하므로 이 개수 이하일 때만 표시 */
const LABEL_MAX_COUNT = 70

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const roadviewRef = useRef<HTMLDivElement>(null)

  const mapRef = useRef<any>(null)
  const polygonsRef = useRef<any[]>([])
  const labelsRef = useRef<any[]>([])
  const parcelPolysRef = useRef<any[]>([])
  const roadviewOverlayRef = useRef<any>(null)
  const roadviewInstanceRef = useRef<any>(null)
  const rulerRef = useRef<{ points: any[]; line: any | null; dots: any[] }>({
    points: [],
    line: null,
    dots: [],
  })
  const drawingRef = useRef<any>(null)
  const fetchSeqRef = useRef(0)
  /**
   * 필터가 바뀌는 순간 지도 idle 이벤트가 함께 발생해 요청이 두 갈래로 나간다.
   * 순번만 비교하면 "필터 이전 조건으로 나간 요청"이 늦게 도착해 최신 결과를 덮어쓴다.
   * 그래서 요청에 사용한 필터 서명을 함께 들고 다니며 현재 서명과 일치할 때만 반영한다.
   */
  const filterSigRef = useRef('')

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diag, setDiag] = useState<{
    ok: boolean
    code: string
    origin: string
    message: string
    misregistered?: string[]
  } | null>(null)

  const [level, setLevel] = useState(INITIAL_LEVEL)
  const [develops, setDevelops] = useState<ApiDevelop[]>([])
  const [totalInView, setTotalInView] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parcelCount, setParcelCount] = useState(0)
  const [rulerDistance, setRulerDistance] = useState<number | null>(null)
  const [virtualZone, setVirtualZone] = useState<{ area: number; points: number } | null>(null)
  const [selected, setSelected] = useState<ApiDevelop | null>(null)

  const [withStage, setWithStage] = useState(0)
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set())
  const [layers, setLayers] = useState<LayerState>({
    transactions: false,
    listings: false,
    auctions: false,
    apartments: false,
  })
  const [tools, setTools] = useState<ToolState>({
    cadastral: false,
    satellite: false,
    useDistrict: false,
    aging: false,
    roadview: false,
    ruler: false,
    drawing: false,
  })

  /* ─────────────── 1. 지도 초기화 (1회) ─────────────── */
  useEffect(() => {
    let cancelled = false

    loadKakaoMaps()
      .then((kakao) => {
        if (cancelled || !containerRef.current) return
        // StrictMode는 이 이펙트를 두 번 실행한다. SDK가 이미 로드돼 있으면
        // 첫 실행의 Promise가 cleanup보다 먼저 resolve되어 지도가 중복 생성되고,
        // 버려진 지도가 계속 이벤트를 발생시켜 상태를 되돌린다.
        if (mapRef.current) return

        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(INITIAL_CENTER.lat, INITIAL_CENTER.lng),
          level: INITIAL_LEVEL,
        })
        mapRef.current = map

        const syncLevel = () => setLevel(map.getLevel())
        kakao.maps.event.addListener(map, 'zoom_changed', syncLevel)
        kakao.maps.event.addListener(map, 'idle', syncLevel)
        syncLevel()
        setReady(true)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        fetch('/api/diag/kakao')
          .then((r) => r.json())
          .then((d) => !cancelled && setDiag(d))
          .catch(() => {})
      })

    return () => {
      cancelled = true
    }
  }, [])

  /* ─────────────── 2. 뷰포트 구역 조회 ─────────────── */
  const fetchDevelops = useCallback(async () => {
    const map = mapRef.current
    if (!map) return

    const b = map.getBounds()
    const sw = b.getSouthWest()
    const ne = b.getNorthEast()
    const bbox = [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()].join(',')
    const types = [...selectedTypes].join(',')
    const stages = [...selectedStages].join(',')
    const sig = `${types}|${stages}`

    const seq = ++fetchSeqRef.current
    setLoading(true)
    try {
      const res = await fetch(
        `/api/develops?bbox=${bbox}&level=${map.getLevel()}` +
          `${types ? `&types=${types}` : ''}${stages ? `&stages=${stages}` : ''}`,
      )
      const data: DevelopsResponse = await res.json()
      // 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 한다
      if (seq !== fetchSeqRef.current) return
      // 필터가 바뀐 뒤 도착한 구(舊) 조건 응답은 버린다
      if (sig !== filterSigRef.current) return
      setDevelops(data.develops ?? [])
      setTotalInView(data.total ?? 0)
      setTruncated(!!data.truncated)
      setWithStage(data.withStage ?? 0)
    } catch {
      /* 무시 */
    } finally {
      if (seq === fetchSeqRef.current) setLoading(false)
    }
  }, [selectedTypes, selectedStages])

  // 현재 필터 서명을 렌더 시점에 갱신해 둔다 (fetch 완료 시 대조용)
  filterSigRef.current = `${[...selectedTypes].join(',')}|${[...selectedStages].join(',')}`

  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current
    fetchDevelops()
    const handler = () => fetchDevelops()
    kakao.maps.event.addListener(map, 'idle', handler)
    return () => kakao.maps.event.removeListener(map, 'idle', handler)
  }, [ready, fetchDevelops])

  /* ─────────────── 3. 구역 폴리곤 렌더 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    polygonsRef.current.forEach((p) => p.setMap(null))
    labelsRef.current.forEach((l) => l.setMap(null))
    polygonsRef.current = []
    labelsRef.current = []

    const showLabels = develops.length <= LABEL_MAX_COUNT

    develops.forEach((d) => {
      const type = PROJECT_TYPE_MAP.get(d.projectType)
      const color = type?.color ?? '#666'

      outerRings(d.geometry).forEach((ring) => {
        const path = ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng))
        const polygon = new kakao.maps.Polygon({
          map,
          path,
          strokeWeight: 2,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeStyle: 'solid',
          fillColor: color,
          fillOpacity: 0.18,
        })
        kakao.maps.event.addListener(polygon, 'mouseover', () =>
          polygon.setOptions({ fillOpacity: 0.36 }),
        )
        kakao.maps.event.addListener(polygon, 'mouseout', () =>
          polygon.setOptions({ fillOpacity: 0.18 }),
        )
        kakao.maps.event.addListener(polygon, 'click', () => setSelected(d))
        polygonsRef.current.push(polygon)
      })

      if (showLabels) {
        const [minLng, minLat, maxLng, maxLat] = d.bbox
        const label = new kakao.maps.CustomOverlay({
          map,
          position: new kakao.maps.LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2),
          yAnchor: 0.5,
          clickable: false,
          content: `<div class="develop-label">
              <div class="develop-label__name" style="background:${color}">${d.name}</div><br/>
              <div class="develop-label__stage">${d.stage ?? d.rawLabel}</div>
            </div>`,
        })
        labelsRef.current.push(label)
      }
    })
  }, [ready, develops])

  /* ─────────────── 4. 필지(지적도·노후도) ─────────────── */
  const drawParcels = useCallback(async () => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    parcelPolysRef.current.forEach((p) => p.setMap(null))
    parcelPolysRef.current = []
    setParcelCount(0)

    if (!tools.cadastral && !tools.aging) return
    if (map.getLevel() > PARCEL_MAX_LEVEL) return

    const b = map.getBounds()
    const sw = b.getSouthWest()
    const ne = b.getNorthEast()
    const bbox = [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()].join(',')

    try {
      const res = await fetch(`/api/parcels?bbox=${bbox}`)
      const data: { parcels: Parcel[] } = await res.json()

      data.parcels.forEach((p) => {
        const fill = tools.aging && p.approvalYear ? agingColor(p.approvalYear) : '#000000'
        const poly = new kakao.maps.Polygon({
          map,
          path: p.ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng)),
          strokeWeight: 1,
          strokeColor: p.postRightsBaseDate ? '#DC2626' : '#7C7C7C',
          strokeOpacity: p.postRightsBaseDate ? 1 : 0.7,
          strokeStyle: p.postRightsBaseDate ? 'shortdash' : 'solid',
          fillColor: fill,
          fillOpacity: tools.aging && p.approvalYear ? 0.55 : 0,
        })
        kakao.maps.event.addListener(poly, 'click', () => {
          new kakao.maps.InfoWindow({
            content: `<div style="padding:8px 10px;font-size:12px;white-space:nowrap">
                <b>${p.jibun}</b><br/>사용승인 ${p.approvalYear ?? '나대지'} · ${p.areaM2}㎡
                <br/><span style="color:#999">필지는 목업 데이터입니다</span>
              </div>`,
            position: new kakao.maps.LatLng(p.ring[0][1], p.ring[0][0]),
          }).open(map)
        })
        parcelPolysRef.current.push(poly)
      })
      setParcelCount(data.parcels.length)
    } catch {
      /* 무시 */
    }
  }, [ready, tools.cadastral, tools.aging])

  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current
    drawParcels()
    const handler = () => drawParcels()
    kakao.maps.event.addListener(map, 'idle', handler)
    return () => kakao.maps.event.removeListener(map, 'idle', handler)
  }, [ready, drawParcels])

  /* ─────────────── 5. 위성뷰 / 용도 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    mapRef.current.setMapTypeId(
      tools.satellite ? kakao.maps.MapTypeId.HYBRID : kakao.maps.MapTypeId.ROADMAP,
    )
  }, [ready, tools.satellite])

  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current
    if (tools.useDistrict) map.addOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT)
    else map.removeOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT)
  }, [ready, tools.useDistrict])

  /* ─────────────── 6. 거리뷰 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    if (!tools.roadview) {
      roadviewOverlayRef.current?.setMap(null)
      roadviewOverlayRef.current = null
      return
    }

    roadviewOverlayRef.current = new kakao.maps.RoadviewOverlay()
    roadviewOverlayRef.current.setMap(map)

    const client = new kakao.maps.RoadviewClient()
    const onClick = (e: any) => {
      client.getNearestPanoId(e.latLng, 50, (panoId: number | null) => {
        if (!panoId || !roadviewRef.current) return
        if (!roadviewInstanceRef.current) {
          roadviewInstanceRef.current = new kakao.maps.Roadview(roadviewRef.current)
        }
        roadviewInstanceRef.current.setPanoId(panoId, e.latLng)
      })
    }
    kakao.maps.event.addListener(map, 'click', onClick)
    return () => kakao.maps.event.removeListener(map, 'click', onClick)
  }, [ready, tools.roadview])

  /* ─────────────── 7. 거리재기 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    const clear = () => {
      rulerRef.current.line?.setMap(null)
      rulerRef.current.dots.forEach((d) => d.setMap(null))
      rulerRef.current = { points: [], line: null, dots: [] }
      setRulerDistance(null)
    }

    if (!tools.ruler) {
      clear()
      return
    }

    const onClick = (e: any) => {
      const r = rulerRef.current
      r.points.push(e.latLng)
      r.dots.push(new kakao.maps.Marker({ map, position: e.latLng }))
      r.line?.setMap(null)
      r.line = new kakao.maps.Polyline({
        map,
        path: r.points,
        strokeWeight: 3,
        strokeColor: '#DC2626',
        strokeOpacity: 0.9,
        strokeStyle: 'solid',
      })
      setRulerDistance(Math.round(r.line.getLength()))
    }

    kakao.maps.event.addListener(map, 'click', onClick)
    return () => {
      kakao.maps.event.removeListener(map, 'click', onClick)
      clear()
    }
  }, [ready, tools.ruler])

  /* ─────────────── 8. 가상구역 드로잉 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    if (!tools.drawing) {
      drawingRef.current?.cancel?.()
      setVirtualZone(null)
      return
    }

    const manager = new kakao.maps.drawing.DrawingManager({
      map,
      drawingMode: [kakao.maps.drawing.OverlayType.POLYGON],
      polygonOptions: {
        draggable: true,
        removable: true,
        strokeColor: '#2563EB',
        strokeWeight: 3,
        fillColor: '#3B82F6',
        fillOpacity: 0.3,
        hintStrokeStyle: 'dash',
      },
    })
    drawingRef.current = manager

    manager.addListener('drawend', (e: any) => {
      const path: any[] = e.target.getPath()
      const poly = new kakao.maps.Polygon({ path })
      setVirtualZone({ area: Math.round(poly.getArea()), points: path.length })
    })

    manager.select(kakao.maps.drawing.OverlayType.POLYGON)

    return () => {
      manager.cancel?.()
      drawingRef.current = null
    }
  }, [ready, tools.drawing])

  /* ─────────────── 핸들러 ─────────────── */
  const makeToggle =
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (code: string) =>
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(code)) next.delete(code)
        else next.add(code)
        return next
      })

  const toggleType = makeToggle(setSelectedTypes)
  const toggleStage = makeToggle(setSelectedStages)

  /** 카카오 레벨 범위는 1(최대 확대)~14 */
  const zoomBy = (delta: number) => {
    const map = mapRef.current
    if (!map) return
    // setLevel에 { animate: true }를 주면 zoom_changed/idle 이벤트가 발생하지 않아
    // 레벨 상태가 갱신되지 않고 연속 클릭 시 값이 고착된다. 애니메이션 없이 호출한다.
    map.setLevel(Math.min(14, Math.max(1, map.getLevel() + delta)))
  }

  const focusDevelop = (d: ApiDevelop) => {
    setSelected(d)
    const map = mapRef.current
    if (!map) return
    const kakao = window.kakao
    const bounds = new kakao.maps.LatLngBounds(
      new kakao.maps.LatLng(d.bbox[1], d.bbox[0]),
      new kakao.maps.LatLng(d.bbox[3], d.bbox[2]),
    )
    map.setBounds(bounds)
  }

  const parcelHint =
    (tools.cadastral || tools.aging) && level > PARCEL_MAX_LEVEL
      ? `지적·노후도는 확대해야 표시됩니다 (현재 레벨 ${level} → ${PARCEL_MAX_LEVEL} 이하)`
      : null

  const unavailableLayer =
    layers.transactions || layers.listings || layers.auctions || layers.apartments

  return (
    <div className="flex h-full">
      <Sidebar
        develops={develops}
        total={totalInView}
        truncated={truncated}
        loading={loading}
        onSelect={focusDevelop}
      />

      <main className="relative flex-1">
        <div ref={containerRef} className="h-full w-full bg-gray-100" />

        {error && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/95 p-8">
            <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-lg">
              <p className="text-base font-bold text-gray-900">지도를 불러오지 못했습니다</p>

              {diag?.code === 'DOMAIN_NOT_REGISTERED' ? (
                <>
                  <p className="mt-1 text-sm text-gray-500">
                    코드 문제가 아닙니다. 카카오가 <b>도메인 미등록</b>을 이유로 SDK 배포를
                    거부했습니다.
                  </p>
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-900 px-3 py-2 text-[11px] leading-relaxed text-red-300">
                    {diag.message}
                  </pre>

                  {!!diag.misregistered?.length && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-900">
                        ⚠️ 다른 도메인이 등록되어 있습니다
                      </p>
                      <ul className="mt-1.5 space-y-1">
                        {diag.misregistered.map((d) => (
                          <li key={d} className="font-mono text-[12px] text-amber-900/80">
                            ✅ {d} <span className="font-sans">— 등록됨</span>
                          </li>
                        ))}
                        <li className="font-mono text-[12px] text-red-700">
                          ❌ {diag.origin} <span className="font-sans">— 미등록</span>
                        </li>
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                    <p className="text-sm font-bold text-indigo-900">해결 방법 (2분)</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-sm text-indigo-900/90">
                      <li>
                        <a
                          href="https://developers.kakao.com/console/app"
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline"
                        >
                          카카오 개발자 콘솔
                        </a>{' '}
                        접속 후 해당 앱 선택
                      </li>
                      <li>
                        좌측 <b>앱 설정 &gt; 플랫폼</b> → <b>Web 플랫폼 등록</b>
                      </li>
                      <li>
                        사이트 도메인에 아래 값을 <b>그대로</b> 입력 후 저장
                        <div className="mt-1.5 flex items-center gap-2">
                          <code className="flex-1 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[13px] text-indigo-700 ring-1 ring-indigo-200">
                            {diag.origin}
                          </code>
                          <button
                            onClick={() => navigator.clipboard?.writeText(diag.origin)}
                            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            복사
                          </button>
                        </div>
                      </li>
                    </ol>
                  </div>

                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white hover:bg-gray-800"
                  >
                    등록했습니다 — 다시 확인
                  </button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-red-600">{diag?.message ?? error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white hover:bg-gray-800"
                  >
                    다시 확인
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <FilterBar
          selectedTypes={selectedTypes}
          selectedStages={selectedStages}
          onToggleType={toggleType}
          onToggleStage={toggleStage}
          onReset={() => {
            setSelectedTypes(new Set())
            setSelectedStages(new Set())
          }}
        />

        <LayerToggles layers={layers} onToggle={(k) => setLayers((p) => ({ ...p, [k]: !p[k] }))} />
        <ToolPanel tools={tools} onToggle={(k) => setTools((p) => ({ ...p, [k]: !p[k] }))} />

        {/* 상태 표시 */}
        <div className="absolute bottom-3 left-3 z-20 max-w-sm space-y-1.5">
          <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs text-gray-600 shadow-sm">
            구역 <b className="text-gray-900">{totalInView.toLocaleString()}</b>개
            {truncated && <span className="text-amber-600"> (상위 {develops.length} 표시)</span>} ·
            단계확인 <b className="text-gray-900">{withStage}</b> · 레벨{' '}
            <b className="text-gray-900">{level}</b>
            {parcelCount > 0 && (
              <>
                {' '}
                · 필지 <b className="text-gray-900">{parcelCount}</b>
              </>
            )}
            {loading && <span className="text-gray-400"> · 불러오는 중…</span>}
          </div>

          {parcelHint && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
              {parcelHint}
            </div>
          )}
          {unavailableLayer && (
            <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs text-gray-600 shadow-sm">
              실거래·매물·경매·단지는 아직 <b>미연동</b>입니다 (국토부 실거래 API 등 연동 필요)
            </div>
          )}
          {rulerDistance !== null && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700 shadow-sm">
              총 거리 <b>{rulerDistance.toLocaleString()}m</b> · 지도를 클릭해 점을 추가하세요
            </div>
          )}
          {virtualZone && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-800 shadow-sm">
              가상구역 면적 <b>{virtualZone.area.toLocaleString()}㎡</b> · 꼭짓점{' '}
              {virtualZone.points}개
            </div>
          )}
          {tools.aging && (
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-[11px] shadow-sm">
              <span className="text-gray-500">노후</span>
              {[
                ['#22C55E', '~10년'],
                ['#FACC15', '10~20'],
                ['#F97316', '20~30'],
                ['#DC2626', '30~40'],
                ['#7F1D1D', '40년~'],
              ].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1">
                  <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 확대 / 축소 / 내 위치 — 우상단 도구 패널과 반대편 모서리 */}
        <div className="absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          <button
            aria-label="확대"
            onClick={() => zoomBy(-1)}
            className="h-9 w-9 border-b border-gray-100 text-lg text-gray-600 hover:bg-gray-50"
          >
            +
          </button>
          <button
            aria-label="축소"
            onClick={() => zoomBy(1)}
            className="h-9 w-9 border-b border-gray-100 text-lg text-gray-600 hover:bg-gray-50"
          >
            −
          </button>
          <button
            aria-label="내 위치"
            onClick={() =>
              navigator.geolocation?.getCurrentPosition((pos) =>
                mapRef.current?.panTo(
                  new window.kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude),
                ),
              )
            }
            className="h-9 w-9 text-sm text-gray-600 hover:bg-gray-50"
          >
            ◎
          </button>
        </div>

        <div
          ref={roadviewRef}
          className={`absolute right-16 bottom-3 z-20 h-52 w-80 overflow-hidden rounded-xl border border-gray-200 shadow-lg ${
            tools.roadview ? 'block' : 'hidden'
          }`}
        />
        {tools.roadview && (
          <p className="absolute right-16 bottom-56 z-20 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
            파란 선이 있는 도로를 클릭하세요
          </p>
        )}

        {selected && <DevelopPanel develop={selected} onClose={() => setSelected(null)} />}
      </main>
    </div>
  )
}
