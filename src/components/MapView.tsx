'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '@/lib/kakaoLoader'
import { PROJECT_TYPE_MAP, STAGES, UNKNOWN_STAGE_COLOR, stageColor } from '@/lib/taxonomy'
import { agingColor, escapeHtml, labelPoint, shortName } from '@/lib/geo'
import { outerRings, type ApiDevelop, type DevelopsResponse } from '@/lib/types'
import type { Parcel } from '@/app/api/parcels/route'
import FilterBar from './FilterBar'
import { LayerToggles, ToolPanel, type LayerState, type ToolState } from './MapToolbar'
import DevelopPanel from './DevelopPanel'
import Sidebar from './Sidebar'
import SidePanel, { type PanelKey } from './SidePanel'
import { getFavorites, recordView, subscribeStore } from '@/lib/userStore'

const INITIAL_CENTER = { lat: 37.5502, lng: 126.9908 } // 서울 중심
const INITIAL_LEVEL = 8
/** 이 레벨보다 확대해야 필지를 그린다 (카카오는 숫자가 작을수록 확대) */
const PARCEL_MAX_LEVEL = 4
/**
 * 라벨 표시 규칙.
 *
 * 서울 1,690개 구역 중 1,143개(68%)는 정비몽땅에 사업장이 없어 단계를 모른다.
 * 이걸 단계 있는 구역과 똑같이 2줄 라벨로 띄우면 화면 라벨의 2/3가
 * "단계 미확인"이라는 같은 글자가 되어 지도가 읽히지 않는다.
 *
 * 그래서 ① 단계가 있는 구역을 먼저 배치하고, ② 단계 미확인은 충분히
 * 확대했을 때만 이름 한 줄짜리 작은 라벨로 남긴다. (경계는 항상 그린다)
 */
const LABEL_MAX_LEVEL = 6
/** 단계 미확인 구역에 이름 라벨을 허용하는 줌 (이보다 확대해야 보인다) */
const UNKNOWN_LABEL_MAX_LEVEL = 4
const LABEL_MAX_COUNT = 40

/**
 * 축소 뷰 — 지역별 집계 배지.
 *
 * 서울 전체를 폴리곤으로 그리면 구역이 겹쳐 형태도 라벨도 읽히지 않는다.
 * 멀리서는 "이 동에 몇 개"만 보여주고, 확대하면 개별 구역으로 바뀐다.
 * 배지를 누르면 그 지역으로 확대한다.
 */
const CLUSTER_MIN_LEVEL = 7
/** 이보다 더 축소하면 동이 너무 많아 자치구 단위로 묶는다 */
const GU_CLUSTER_LEVEL = 9
/** 배지를 눌렀을 때 이동할 줌 */
const CLUSTER_ZOOM_TO = 5

interface Cluster {
  key: string
  label: string
  gu: string
  dong: string | null
  count: number
  withStage: number
  center: [number, number]
}

/**
 * 라벨이 차지할 화면 크기.
 *
 * 글자 수 × 상수로 어림하면 실제 렌더 폭과 어긋나 겹침 판정이 헐거워진다.
 * 캔버스로 같은 폰트의 실제 텍스트 폭을 재서 판정한다. (레이아웃을 건드리지 않아 싸다)
 */
let measureCtx: CanvasRenderingContext2D | null = null
function textWidth(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 12
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

const HEAD_FONT = '800 12px system-ui, sans-serif'
const TYPE_FONT = '800 10.5px system-ui, sans-serif'
const STAGE_FONT = '700 11px system-ui, sans-serif'
const QUIET_FONT = '700 11px system-ui, sans-serif'
const CLUSTER_FONT = '700 12px system-ui, sans-serif'
const APT_FONT = '700 11px system-ui, sans-serif'

/** 단지 마커를 그리는 줌 — 이보다 축소하면 라벨이 지도를 덮는다 */
const APT_MAX_LEVEL = 5

interface AptMarker {
  name: string
  lng: number
  lat: number
  area: number
  price: number
  dealDate: string
  count: number
}

/** 마커에 넣을 짧은 가격 — "17억", "8.5억", "9,500만" */
function eokLabel(won: number): string {
  if (won >= 100_000_000) {
    const e = won / 100_000_000
    return `${e >= 10 ? Math.round(e) : e.toFixed(1).replace(/\.0$/, '')}억`
  }
  return `${Math.round(won / 10_000).toLocaleString()}만`
}

function labelBox(d: ApiDevelop): { w: number; h: number } {
  const name = shortName(d.name)
  if (!d.stage) {
    return { w: textWidth(shortName(d.name, 10), QUIET_FONT) + 14, h: 20 }
  }
  const type = PROJECT_TYPE_MAP.get(d.projectType)?.short ?? ''
  // 머리: 좌우 패딩 18 + 유형 글자 + 간격 5
  const head = textWidth(name, HEAD_FONT) + (type ? textWidth(type, TYPE_FONT) + 5 : 0) + 18
  const stage = textWidth(d.stage, STAGE_FONT) + 21 // 패딩 18 + 좌측 색 띠 3
  return { w: Math.max(head, stage), h: 44 }
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const roadviewRef = useRef<HTMLDivElement>(null)

  const mapRef = useRef<any>(null)
  const polygonsRef = useRef<any[]>([])
  const labelsRef = useRef<any[]>([])
  const clusterOverlaysRef = useRef<any[]>([])
  const aptOverlaysRef = useRef<any[]>([])
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
  const [clusters, setClusters] = useState<Cluster[]>([])
  const [totalInView, setTotalInView] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [parcelCount, setParcelCount] = useState(0)
  const [aptCount, setAptCount] = useState(0)
  const [aptLoading, setAptLoading] = useState(false)
  const [rulerDistance, setRulerDistance] = useState<number | null>(null)
  const [virtualZone, setVirtualZone] = useState<{ area: number; points: number } | null>(null)
  const [selected, setSelected] = useState<ApiDevelop | null>(null)

  const [withStage, setWithStage] = useState(0)
  const [legendOpen, setLegendOpen] = useState(false)
  const [panel, setPanel] = useState<PanelKey | null>(null)
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null)
  const [favCount, setFavCount] = useState(0)
  const [roadviewMiss, setRoadviewMiss] = useState(false)
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
    const filterQs = `${types ? `&types=${types}` : ''}${stages ? `&stages=${stages}` : ''}`
    const lv = map.getLevel()

    const seq = ++fetchSeqRef.current
    setLoading(true)
    try {
      // 축소 상태에서는 개별 구역 대신 지역별 개수만 받는다.
      // 지오메트리를 아예 안 내려받으므로 응답도 훨씬 가볍다.
      if (lv >= CLUSTER_MIN_LEVEL) {
        const by = lv >= GU_CLUSTER_LEVEL ? 'gu' : 'dong'
        const res = await fetch(`/api/develops/clusters?bbox=${bbox}&by=${by}${filterQs}`)
        const data: { clusters?: Cluster[]; total?: number } = await res.json()
        if (seq !== fetchSeqRef.current) return
        if (sig !== filterSigRef.current) return
        setClusters(data.clusters ?? [])
        setDevelops([])
        setTotalInView(data.total ?? 0)
        setTruncated(false)
        setWithStage((data.clusters ?? []).reduce((s, c) => s + c.withStage, 0))
        return
      }

      const res = await fetch(`/api/develops?bbox=${bbox}&level=${lv}${filterQs}`)
      const data: DevelopsResponse = await res.json()
      // 늦게 도착한 이전 요청이 최신 결과를 덮어쓰지 않도록 한다
      if (seq !== fetchSeqRef.current) return
      // 필터가 바뀐 뒤 도착한 구(舊) 조건 응답은 버린다
      if (sig !== filterSigRef.current) return
      setClusters([])
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

    /**
     * 라벨 선별 — 서울은 구역이 촘촘해 그냥 다 그리면 라벨이 서로 덮어 읽을 수 없다.
     *  1) 같은 이름은 가장 큰 구역 하나만
     *  2) 단계가 있는 구역 → 단계 미확인 순으로, 각 그룹 안에서는 큰 구역부터
     *  3) 이미 놓인 라벨과 화면에서 겹치면 건너뛴다
     */
    const labelIds = new Set<string>()
    const anchors = new Map<string, { lat: number; lng: number }>()

    if (level <= LABEL_MAX_LEVEL) {
      const pickedByName = new Map<string, ApiDevelop>()
      for (const d of develops) {
        const key = shortName(d.name)
        const prev = pickedByName.get(key)
        if (!prev || d.areaM2 > prev.areaM2) pickedByName.set(key, d)
      }

      const projection = map.getProjection()
      const placed: { l: number; t: number; r: number; b: number }[] = []
      const GAP = 10

      // 단계 있는 구역이 항상 우선권을 갖는다
      const candidates = [...pickedByName.values()]
        .filter((d) => !!d.stage || level <= UNKNOWN_LABEL_MAX_LEVEL)
        .sort((a, b) => {
          const s = Number(!!b.stage) - Number(!!a.stage)
          return s !== 0 ? s : b.areaM2 - a.areaM2
        })

      for (const d of candidates) {
        if (labelIds.size >= LABEL_MAX_COUNT) break

        const p = labelPoint(outerRings(d.geometry))
        const [minLng, minLat, maxLng, maxLat] = d.bbox
        const anchor = p
          ? { lng: p[0], lat: p[1] }
          : { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 }
        const pt = projection.containerPointFromCoords(new kakao.maps.LatLng(anchor.lat, anchor.lng))

        const { w, h } = labelBox(d)
        const box = {
          l: pt.x - w / 2 - GAP,
          t: pt.y - h / 2 - GAP,
          r: pt.x + w / 2 + GAP,
          b: pt.y + h / 2 + GAP,
        }
        const hits = placed.some(
          (p2) => !(box.r <= p2.l || p2.r <= box.l || box.b <= p2.t || p2.b <= box.t),
        )
        if (hits) continue

        placed.push(box)
        labelIds.add(d.id)
        anchors.set(d.id, anchor)
      }
    }

    develops.forEach((d) => {
      const type = PROJECT_TYPE_MAP.get(d.projectType)
      // 폴리곤·라벨 모두 진행단계 색으로 통일한다.
      // 지도에서 "어디까지 진행됐나"가 한눈에 읽히는 쪽이 훨씬 유용하다.
      const fill = stageColor(d.canonicalStage)
      const known = !!d.stage

      outerRings(d.geometry).forEach((ring) => {
        const path = ring.map(([lng, lat]) => new kakao.maps.LatLng(lat, lng))
        // 미확인 구역이 1,143개라 조금만 진해도 회색이 지도를 덮는다
        const baseOpacity = known ? 0.22 : 0.05
        const polygon = new kakao.maps.Polygon({
          map,
          path,
          strokeWeight: known ? 2 : 1,
          strokeColor: fill,
          strokeOpacity: known ? 0.95 : 0.35,
          // 단계 미확인 구역은 점선으로 한 번 더 구분한다
          strokeStyle: known ? 'solid' : 'shortdash',
          fillColor: fill,
          fillOpacity: baseOpacity,
        })
        kakao.maps.event.addListener(polygon, 'mouseover', () =>
          polygon.setOptions({ fillOpacity: baseOpacity + 0.2 }),
        )
        kakao.maps.event.addListener(polygon, 'mouseout', () =>
          polygon.setOptions({ fillOpacity: baseOpacity }),
        )
        kakao.maps.event.addListener(polygon, 'click', () => {
          setSelected(d)
          recordView(d.id)
        })
        polygonsRef.current.push(polygon)
      })

      if (labelIds.has(d.id)) {
        const [minLng, minLat, maxLng, maxLat] = d.bbox
        const a = anchors.get(d.id) ?? { lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 }
        const sColor = stageColor(d.canonicalStage)

        // 라벨 머리도 폴리곤과 같은 진행단계 색으로 칠한다.
        // 사업종류 색을 쓰면 폴리곤(단계색)과 어긋나 같은 구역인데 두 색이 충돌한다.
        // 사업종류는 같은 색 띠 안에 인라인 글자로 얹는다 — 별도 칩은 폭만 먹는다.
        const content = d.stage
          ? `<div class="develop-label">
              <div class="develop-label__head" style="background:${sColor}">
                <span class="develop-label__type">${escapeHtml(type?.short ?? '')}</span>${escapeHtml(shortName(d.name))}
              </div>
              <div class="develop-label__stage" style="color:${sColor}">${escapeHtml(d.stage)}</div>
            </div>`
          : // 단계를 모르는 구역까지 2줄로 띄우면 "단계 미확인"만 화면을 덮는다.
            // 이름만 조용히 남기고, 단계는 클릭해서 상세에서 본다.
            `<div class="develop-label develop-label--quiet">${escapeHtml(shortName(d.name, 10))}</div>`

        const label = new kakao.maps.CustomOverlay({
          map,
          position: new kakao.maps.LatLng(a.lat, a.lng),
          yAnchor: 0.5,
          clickable: false,
          content,
        })
        labelsRef.current.push(label)
      }
    })
  }, [ready, develops, level])

  /* ─────────────── 3-b. 지역별 집계 배지 (축소 뷰) ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    clusterOverlaysRef.current.forEach((o) => o.setMap(null))
    clusterOverlaysRef.current = []
    if (!clusters.length) return

    // 배지끼리도 겹치면 못 읽는다. 개수가 많은 지역부터 자리를 잡는다.
    const projection = map.getProjection()
    const placed: { l: number; t: number; r: number; b: number }[] = []
    const GAP = 4

    for (const c of clusters) {
      const pos = new kakao.maps.LatLng(c.center[1], c.center[0])
      const pt = projection.containerPointFromCoords(pos)
      const w = Math.max(52, textWidth(c.label, CLUSTER_FONT) + 20)
      const h = 46
      const box = {
        l: pt.x - w / 2 - GAP,
        t: pt.y - h / 2 - GAP,
        r: pt.x + w / 2 + GAP,
        b: pt.y + h / 2 + GAP,
      }
      if (placed.some((p) => !(box.r <= p.l || p.r <= box.l || box.b <= p.t || p.b <= box.t))) {
        continue
      }
      placed.push(box)

      const overlay = new kakao.maps.CustomOverlay({
        map,
        position: pos,
        yAnchor: 0.5,
        zIndex: 3,
        clickable: true,
        content: `<button type="button" class="zone-cluster" data-lat="${c.center[1]}" data-lng="${c.center[0]}">
            <span class="zone-cluster__name">${escapeHtml(c.label)}</span>
            <span class="zone-cluster__count">${c.count}</span>
          </button>`,
      })
      clusterOverlaysRef.current.push(overlay)
    }

    // CustomOverlay 안의 DOM은 React 밖이라 이벤트를 직접 건다.
    // 위임으로 걸면 오버레이가 지워질 때 핸들러도 같이 사라진다.
    const container = map.getNode() as HTMLElement
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('.zone-cluster') as HTMLElement | null
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      map.setCenter(new kakao.maps.LatLng(Number(el.dataset.lat), Number(el.dataset.lng)))
      map.setLevel(CLUSTER_ZOOM_TO)
    }
    container.addEventListener('click', onClick)
    return () => container.removeEventListener('click', onClick)
  }, [ready, clusters])

  /* ─────────────── 3-c. 아파트 단지 시세 마커 ─────────────── */
  useEffect(() => {
    if (!ready) return
    const kakao = window.kakao
    const map = mapRef.current

    aptOverlaysRef.current.forEach((o) => o.setMap(null))
    aptOverlaysRef.current = []

    if (!layers.apartments) {
      setAptCount(0)
      return
    }
    // 축소 상태에서는 단지가 수백 개라 라벨이 지도를 덮는다
    if (level > APT_MAX_LEVEL) {
      setAptCount(0)
      return
    }

    let cancelled = false
    const b = map.getBounds()
    const sw = b.getSouthWest()
    const ne = b.getNorthEast()
    const bbox = [sw.getLng(), sw.getLat(), ne.getLng(), ne.getLat()].join(',')

    setAptLoading(true)
    fetch(`/api/apt-markers?bbox=${bbox}`)
      .then((r) => r.json())
      .then((j: { markers?: AptMarker[] }) => {
        if (cancelled) return
        const list = j.markers ?? []

        // 라벨끼리 겹치면 못 읽는다. 최근 거래부터 자리를 잡는다.
        const projection = map.getProjection()
        const placed: { l: number; t: number; r: number; b: number }[] = []
        const GAP = 3
        let shown = 0

        for (const m of list) {
          const pos = new kakao.maps.LatLng(m.lat, m.lng)
          const pt = projection.containerPointFromCoords(pos)
          const label = `${m.area} ${eokLabel(m.price)}`
          const w = textWidth(label, APT_FONT) + 18
          const h = 22
          const box = {
            l: pt.x - w / 2 - GAP,
            t: pt.y - h - GAP,
            r: pt.x + w / 2 + GAP,
            b: pt.y + GAP,
          }
          if (placed.some((p) => !(box.r <= p.l || p.r <= box.l || box.b <= p.t || p.b <= box.t))) {
            continue
          }
          placed.push(box)
          shown++

          const overlay = new kakao.maps.CustomOverlay({
            map,
            position: pos,
            yAnchor: 1,
            zIndex: 2,
            clickable: false,
            content:
              `<div class="apt-price" title="${escapeHtml(m.name)} · 전용 ${m.area}㎡ · ` +
              `${m.dealDate} · ${m.count}건">` +
              `<b>${m.area}</b> ${escapeHtml(eokLabel(m.price))}</div>`,
          })
          aptOverlaysRef.current.push(overlay)
        }
        setAptCount(shown)
      })
      .catch(() => !cancelled && setAptCount(0))
      .finally(() => !cancelled && setAptLoading(false))

    return () => {
      cancelled = true
    }
  }, [ready, layers.apartments, level, develops])

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
      // 반경 50m는 축소된 화면에서 도로를 거의 못 맞춘다. 넉넉히 잡는다.
      client.getNearestPanoId(e.latLng, 250, (panoId: number | null) => {
        if (!panoId || !roadviewRef.current) {
          setRoadviewMiss(true)
          return
        }
        setRoadviewMiss(false)
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

  const focusByBounds = (bbox: [number, number, number, number]) => {
    const map = mapRef.current
    if (!map) return
    const kakao = window.kakao
    map.setBounds(
      new kakao.maps.LatLngBounds(
        new kakao.maps.LatLng(bbox[1], bbox[0]),
        new kakao.maps.LatLng(bbox[3], bbox[2]),
      ),
    )
  }

  const focusDevelop = (d: ApiDevelop) => {
    setSelected(d)
    recordView(d.id)
    focusByBounds(d.bbox)
  }

  /**
   * 패널에서 고른 구역의 상세를 연다.
   * 뷰포트 응답에 들어 있으면 그걸 쓰고, 필터에 걸려 빠졌으면 id로 직접 가져온다.
   */
  useEffect(() => {
    if (!pendingSelectId) return
    const id = pendingSelectId

    const hit = develops.find((d) => d.id === id)
    if (hit) {
      setSelected(hit)
      recordView(hit.id)
      setPendingSelectId(null)
      return
    }

    let cancelled = false
    fetch(`/api/develops/detail?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ApiDevelop | null) => {
        if (cancelled || !d) return
        setSelected(d)
        recordView(d.id)
        setPendingSelectId(null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [develops, pendingSelectId])

  /** 관심 구역 수 (배지용) */
  useEffect(() => {
    const sync = () => setFavCount(getFavorites().length)
    sync()
    return subscribeStore(sync)
  }, [])

  const parcelHint =
    (tools.cadastral || tools.aging) && level > PARCEL_MAX_LEVEL
      ? `지적·노후도는 확대해야 표시됩니다 (현재 레벨 ${level} → ${PARCEL_MAX_LEVEL} 이하)`
      : null

  // 단지는 이제 실제로 그린다. 나머지 셋만 아직 미연동이다.
  const unavailableLayer = layers.transactions || layers.listings || layers.auctions

  const aptHint = layers.apartments
    ? level > APT_MAX_LEVEL
      ? `단지 시세는 확대해야 표시됩니다 (현재 레벨 ${level} → ${APT_MAX_LEVEL} 이하)`
      : aptLoading
        ? '단지 시세 불러오는 중…'
        : `단지 ${aptCount}개 · 최근 12개월 아파트 실거래`
    : null

  return (
    <div className="flex h-full">
      <div className="relative flex">
        <Sidebar
          develops={develops}
          clusters={clusters}
          total={totalInView}
          truncated={truncated}
          loading={loading}
          onSelect={focusDevelop}
          onSelectCluster={(lng, lat) => {
            const map = mapRef.current
            if (!map) return
            map.setCenter(new window.kakao.maps.LatLng(lat, lng))
            map.setLevel(CLUSTER_ZOOM_TO)
          }}
          onOpenPanel={setPanel}
          favoriteCount={favCount}
          onSearchZone={(id, bbox) => {
            focusByBounds(bbox)
            setPendingSelectId(id)
          }}
          onSearchPlace={(lng, lat) => {
            const map = mapRef.current
            if (!map) return
            // 장소는 구역이 아니므로 상세를 열지 않고 위치만 옮긴다.
            // 주변 구역이 보이도록 적당히 확대한다.
            map.setLevel(4)
            map.panTo(new window.kakao.maps.LatLng(lat, lng))
          }}
        />
        {panel && (
          <SidePanel
            panel={panel}
            onClose={() => setPanel(null)}
            onSelect={(b) => {
              setPanel(null)
              focusByBounds(b.bbox)
              // 상세는 지도 응답이 오면 폴리곤 클릭 없이도 열리도록 id로 지정한다
              setPendingSelectId(b.id)
            }}
            onFocus={(bbox, id) => {
              setPanel(null)
              focusByBounds(bbox)
              setPendingSelectId(id)
            }}
          />
        )}
      </div>

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
          onSetTypes={(codes) => setSelectedTypes(new Set(codes))}
          onSetStages={(codes) => setSelectedStages(new Set(codes))}
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
          {aptHint && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs text-indigo-800 shadow-sm">
              {aptHint}
            </div>
          )}
          {unavailableLayer && (
            <div className="rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs text-gray-600 shadow-sm">
              실거래·매물·경매 레이어는 아직 <b>미연동</b>입니다 (중개 제휴·법원경매 연동 필요)
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
          {/* 진행단계 색상 범례 — 지도를 가리지 않도록 기본은 접어둔다 */}
          <div className="rounded-lg border border-gray-200 bg-white/95 shadow-sm">
            <button
              onClick={() => setLegendOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600"
            >
              <span className="flex gap-0.5">
                {STAGES.slice(3, 11).map((s) => (
                  <i
                    key={s.code}
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: s.color }}
                  />
                ))}
              </span>
              진행단계 색상
              <span className="text-gray-400">{legendOpen ? '▾' : '▸'}</span>
            </button>
            {legendOpen && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 px-3 py-2">
                {STAGES.map((s) => (
                  <span key={s.code} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                    <i
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: s.color }}
                    />
                    {s.label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <i
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: UNKNOWN_STAGE_COLOR }}
                  />
                  단계 미확인
                </span>
              </div>
            )}
          </div>

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
            {roadviewMiss
              ? '이 근처에는 로드뷰가 없습니다 — 파란 선 위를 클릭하세요'
              : '파란 선이 있는 도로를 클릭하세요'}
          </p>
        )}

        {selected && (
          <DevelopPanel
            develop={selected}
            onClose={() => setSelected(null)}
            onFocus={(bbox, id) => {
              focusByBounds(bbox)
              setPendingSelectId(id)
            }}
          />
        )}
      </main>
    </div>
  )
}
