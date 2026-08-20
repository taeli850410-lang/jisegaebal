'use client'

export interface LayerState {
  transactions: boolean
  listings: boolean
  auctions: boolean
  apartments: boolean
}

export interface ToolState {
  /** 필지 경계 — 카카오 미제공, 자체 벡터로 구현 */
  cadastral: boolean
  satellite: boolean
  /** 카카오 USE_DISTRICT — 용도지역 편집도 (참고용) */
  useDistrict: boolean
  /** 필지별 사용승인연도 색상 */
  aging: boolean
  roadview: boolean
  ruler: boolean
  drawing: boolean
}

const LAYERS: { key: keyof LayerState; label: string }[] = [
  { key: 'transactions', label: '실거래' },
  { key: 'listings', label: '매물' },
  { key: 'apartments', label: '단지' },
]

const TOOLS: { key: keyof ToolState; label: string; note?: string }[] = [
  { key: 'drawing', label: '가상\n구역', note: '카카오 Drawing 라이브러리' },
  { key: 'cadastral', label: '지적도', note: '자체 벡터 (카카오 미제공)' },
  { key: 'satellite', label: '위성뷰', note: 'MapTypeId.HYBRID' },
  { key: 'aging', label: '노후도', note: '필지별 사용승인연도' },
  { key: 'useDistrict', label: '용도', note: 'MapTypeId.USE_DISTRICT (참고용)' },
  { key: 'roadview', label: '거리뷰', note: 'Roadview + RoadviewOverlay' },
  { key: 'ruler', label: '거리\n재기', note: 'Polyline.getLength()' },
]

export function LayerToggles({
  layers,
  onToggle,
}: {
  layers: LayerState
  onToggle: (key: keyof LayerState) => void
}) {
  return (
    <div className="absolute top-16 left-3 z-20 flex flex-col gap-1.5">
      {LAYERS.map((l) => (
        <button
          key={l.key}
          onClick={() => onToggle(l.key)}
          className={`h-11 w-11 rounded-lg border text-xs font-bold shadow-sm transition ${
            layers[l.key]
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function ToolPanel({
  tools,
  onToggle,
}: {
  tools: ToolState
  onToggle: (key: keyof ToolState) => void
}) {
  return (
    // 화면이 낮아져도 우하단 확대/축소 컨트롤과 맞닿지 않도록 높이를 제한한다
    <div className="thin-scroll absolute top-3 right-3 z-20 flex max-h-[calc(100%-10rem)] flex-col gap-1.5 overflow-y-auto">
      {TOOLS.map((t) => (
        <button
          key={t.key}
          onClick={() => onToggle(t.key)}
          title={t.note}
          className={`h-11 w-12 shrink-0 rounded-lg border text-[11px] leading-tight font-bold whitespace-pre-line shadow-sm transition ${
            tools[t.key]
              ? 'border-indigo-600 bg-indigo-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
