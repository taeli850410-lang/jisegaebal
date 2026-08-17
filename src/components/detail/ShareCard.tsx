'use client'

import { useEffect, useRef } from 'react'
import { drawShareCard, downloadShareCard, type ShareCardInput } from '@/lib/shareCard'

/**
 * 구역 공유 카드 미리보기.
 *
 * 캔버스에 그린 걸 그대로 붙여 보여준다 — 미리보기와 내려받는 파일이
 * 다른 코드로 그려지면 결국 어긋난다.
 */
export default function ShareCard({ data, onClose }: { data: ShareCardInput; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const canvas = drawShareCard(data)
    canvas.style.width = '100%'
    canvas.style.height = 'auto'
    canvas.style.display = 'block'
    canvas.style.borderRadius = '12px'
    box.replaceChildren(canvas)
  }, [data])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">구역 공유 카드</h3>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div ref={boxRef} className="overflow-hidden rounded-xl" />

        <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
          카드의 값은 모두 이 화면에 표시된 실제 데이터입니다. 자료가 없는 항목은 비워 둡니다 —
          조감도처럼 실제로 없는 이미지를 지어내지 않습니다.
        </p>

        <div className="mt-3 flex gap-2">
          <button
            onClick={() => downloadShareCard(data)}
            className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
          >
            PNG 내려받기 ↓
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
