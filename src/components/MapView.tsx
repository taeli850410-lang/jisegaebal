'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '@/lib/kakaoLoader'
import { DEVELOPS, TRANSACTION_DOTS, type Develop } from '@/lib/mock/develops'
import { PROJECT_TYPE_MAP } from '@/lib/taxonomy'
import { agingColor, centroid, formatKrwEok } from '@/lib/geo'
import type { Parcel } from '@/app/api/parcels/route'
import FilterBar from './FilterBar'
import { LayerToggles, ToolPanel, type LayerState, type ToolState } from './MapToolbar'
import DevelopPanel from './DevelopPanel'
import Sidebar from './Sidebar'

const INITIAL_CENTER = { lat: 37.4805, lng: 126.9762 }
const INITIAL_LEVEL = 5
/** 이 레벨보다 확대해야 필지를 그린다 (카카오는 숫자가 작을수록 확대) */
const PARCEL_MAX_LEVEL = 4

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const roadviewRef = useRef<HTMLDivElement>(null)

  const mapRef = useRef<any>(null)
  const polygonsRef = useRef<any[]>([])
  const labelsRef = useRef<any[]>([])
  const clustererRef = useRef<any>(null)
  const parcelPolysRef = useRef<any[]>([])
  const roadviewOverlayRef = useRef<any>(null)
  const roadviewRef2 = useRef<any>(null)
  const rulerRef = useRef<{ points: any[]; line: any | null; dots: any[] }>({
    points: [],
    line: null,
    dots: [],
  })
  const drawingRef = useRef<any>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diag, setDiag] = useState<{
    ok: boolean
    code: string
    origin: string
    message: string
  } | null>(null)
  const [level, setLevel] = useState(INITIAL_LEVEL)
  const [parcelCount, setParcelCount] = useState(0)
  const [rulerDistance, setRulerDistance] = useState<number | null>(null)
  const [virtualZone, setVirtualZone] = useState<{ area: number; points: number } | null>(null)
  const [selected, setSelected] = useState<Develop | null>(null)

  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set())
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set())
  const [layers, setLayers] = useState<LayerState>({
    transactions: true,
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

        const map = new kakao.maps.Map(containerRef.current, {
          center: new kakao.maps.LatLng(INITIAL_CENTER.lat, INITIAL_CENTER.lng),
          level: INITIAL_LEVEL,
        })
        mapRef.current = map

        kakao.maps.event.addListener(map, 'zoom_changed', () => setLevel(map.getLevel()))
        setReady(true)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        // 실패 원인을 서버가 대신 물어본다 (브라우저는 script 오류 본문을 못 읽는다)
        fetch('/api/diag/kakao')
          .then((r) => r.json())
          .then((d) => !cancelled && setDiag(d))
          .catch(() => {})
      })

    return () => {
      cancelled = true
    }
  }, [])

  /* ─────────────── 2. 구역 폴리곤 렌더 ─────────────── */
  const visibleDevelops = DEVELOPS.filter(
    (d) =>
      (selectedTypes.size === 0 || selectedTypes.has(d.projectType)) &&
      (selectedStages.size === 0 || selectedStages.has(d.stage)),
  )

  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    // 기존 오버레이 정리
    polygonsRef.current.forEach((p) => p.setMap(null))
    labelsRef.current.forEach((l) => l.setMap(null))
    polygonsRef.current = []
    labelsRef.current = []

    visibleDevelops.forEach((d) => {
      const type = PROJECT_TYPE_MAP.get(d.projectType)
      const color = type?.color ?? '#666'
      const path = d.ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng))

      const polygon = new kakao.maps.Polygon({
        map,
        path,
        strokeWeight: 2,
        strokeColor: color,
        strokeOpacity: 0.95,
        strokeStyle: 'solid',
        fillColor: color,
        fillOpacity: 0.18,
      })

      kakao.maps.event.addListener(polygon, 'mouseover', () => polygon.setOptions({ fillOpacity: 0.34 }))
      kakao.maps.event.addListener(polygon, 'mouseout', () => polygon.setOptions({ fillOpacity: 0.18 }))
      kakao.maps.event.addListener(polygon, 'click', () => setSelected(d))

      const [cLng, cLat] = centroid(d.ring)
      const label = new kakao.maps.CustomOverlay({
        map,
        position: new kakao.maps.LatLng(cLat, cLng),
        yAnchor: 0.5,
        clickable: false,
        content: `<div class="develop-label">
            <div class="develop-label__name" style="background:${color}">${d.name}</div><br/>
            <div class="develop-label__stage">${d.stageRaw}</div>
          </div>`,
      })

      polygonsRef.current.push(polygon)
      labelsRef.current.push(label)
    })
    // visibleDevelops는 파생값이라 의존성에 원본 상태를 넣는다
  }, [ready, selectedTypes, selectedStages])

  /* ─────────────── 3. 실거래 도트 + 클러스터러 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    if (clustererRef.current) {
      clustererRef.current.clear()
      clustererRef.current.setMap(null)
      clustererRef.current = null
    }
    if (!layers.transactions) return

    const visibleIds = new Set(visibleDevelops.map((d) => d.id))
    const markers = TRANSACTION_DOTS.filter((t) => visibleIds.has(t.developId)).map((t) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(t.lat, t.lng),
        title: `${t.type} ${formatKrwEok(t.price)}`,
      })
      const info = new kakao.maps.InfoWindow({
        content: `<div style="padding:6px 10px;font-size:12px;white-space:nowrap">
            <b>${t.type}</b> · ${t.dealDate}<br/>
            ${formatKrwEok(t.price)} · 대지 ${t.landSharePyeong}평
          </div>`,
      })
      kakao.maps.event.addListener(marker, 'click', () => info.open(map, marker))
      return marker
    })

    clustererRef.current = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 4,
      gridSize: 60,
      markers,
    })
  }, [ready, layers.transactions, selectedTypes, selectedStages])

  /* ─────────────── 4. 필지(지적도·노후도) — 벡터 렌더 ─────────────── */
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
                <b>${p.jibun}</b><br/>
                PNU ${p.pnu}<br/>
                사용승인 ${p.approvalYear ?? '나대지'} · ${p.areaM2}㎡
                ${p.postRightsBaseDate ? '<br/><span style="color:#DC2626">🚨 권리산정기준일 이후 신축</span>' : ''}
              </div>`,
            position: new kakao.maps.LatLng(p.ring[0][1], p.ring[0][0]),
          }).open(map)
        })

        parcelPolysRef.current.push(poly)
      })
      setParcelCount(data.parcels.length)
    } catch {
      /* 목업 단계에서는 조용히 무시 */
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

  /* ─────────────── 5. 위성뷰 / 용도(USE_DISTRICT) ─────────────── */
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

    // 로드뷰가 존재하는 도로를 지도 위에 표시
    roadviewOverlayRef.current = new kakao.maps.RoadviewOverlay()
    roadviewOverlayRef.current.setMap(map)

    const client = new kakao.maps.RoadviewClient()
    const onClick = (e: any) => {
      client.getNearestPanoId(e.latLng, 50, (panoId: number | null) => {
        if (!panoId || !roadviewRef.current) return
        if (!roadviewRef2.current) {
          roadviewRef2.current = new kakao.maps.Roadview(roadviewRef.current)
        }
        roadviewRef2.current.setPanoId(panoId, e.latLng)
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

      const marker = new kakao.maps.Marker({ map, position: e.latLng })
      r.dots.push(marker)

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
      // 실제 서비스: POST /api/v1/virtual-develops → PostGIS ST_Intersects 로 내부 통계 산출
    })

    manager.select(kakao.maps.drawing.OverlayType.POLYGON)

    return () => {
      manager.cancel?.()
      drawingRef.current = null
    }
  }, [ready, tools.drawing])

  /* ─────────────── 핸들러 ─────────────── */
  const toggleSet = (setter: typeof setSelectedTypes) => (code: string) =>
    setter((prev) => {
      const next = new Set(prev)
      next.has(code) ? next.delete(code) : next.add(code)
      return next
    })

  const parcelHint =
    (tools.cadastral || tools.aging) && level > PARCEL_MAX_LEVEL
      ? `지적·노후도는 확대해야 표시됩니다 (현재 레벨 ${level} → ${PARCEL_MAX_LEVEL} 이하)`
      : null

  return (
    <div className="flex h-full">
      <Sidebar develops={visibleDevelops} onSelect={setSelected} />

      <main className="relative flex-1">
        <div ref={containerRef} className="h-full w-full bg-gray-100" />

        {/* SDK 로드 실패 — 서버 진단 결과로 정확한 원인과 해결법을 안내한다 */}
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

                  <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
                    JavaScript 키는 브라우저에 노출되는 것이 정상이며, 도메인 등록이 유일한 보호
                    장치입니다. 등록하지 않으면 제3자가 키를 가져다 일일 쿼터(30만 건)를 소진시킬 수
                    있습니다.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm text-red-600">{diag?.message ?? error}</p>
                  {diag && (
                    <p className="mt-2 text-xs text-gray-400">
                      진단 코드: {diag.code} · origin {diag.origin}
                    </p>
                  )}
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
          onToggleType={toggleSet(setSelectedTypes)}
          onToggleStage={toggleSet(setSelectedStages)}
          onReset={() => {
            setSelectedTypes(new Set())
            setSelectedStages(new Set())
          }}
        />

        <LayerToggles
          layers={layers}
          onToggle={(k) => setLayers((p) => ({ ...p, [k]: !p[k] }))}
        />

        <ToolPanel tools={tools} onToggle={(k) => setTools((p) => ({ ...p, [k]: !p[k] }))} />

        {/* 상태 표시 */}
        <div className="absolute bottom-3 left-3 z-20 space-y-1.5">
          <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs text-gray-600 shadow-sm">
            구역 <b className="text-gray-900">{visibleDevelops.length}</b>개 · 레벨{' '}
            <b className="text-gray-900">{level}</b>
            {parcelCount > 0 && (
              <>
                {' '}
                · 필지 <b className="text-gray-900">{parcelCount}</b>
              </>
            )}
          </div>
          {parcelHint && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 shadow-sm">
              {parcelHint}
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

        {/* 거리뷰 패널 */}
        <div
          ref={roadviewRef}
          className={`absolute right-3 bottom-3 z-20 h-52 w-80 overflow-hidden rounded-xl border border-gray-200 shadow-lg ${
            tools.roadview ? 'block' : 'hidden'
          }`}
        />
        {tools.roadview && (
          <p className="absolute right-3 bottom-56 z-20 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
            파란 선이 있는 도로를 클릭하세요
          </p>
        )}

        {selected && <DevelopPanel develop={selected} onClose={() => setSelected(null)} />}
      </main>
    </div>
  )
}
