'use client'

import type { Finding, Level } from '@/lib/verifyListing'
import type { CrossRow } from '@/lib/crossCheck'

/**
 * 매물 검증 결과.
 *
 * 계산만 하고 감추면 아무 소용이 없다. 특히 "이 호는 근린생활시설이라
 * 분양자격이 다르다" 같은 건 등록 전에 봐야 하는 이야기다.
 *
 * 호파인더 대조는 우리 판정을 덮어쓰지 않고 나란히 놓는다. 두 곳이 갈리는
 * 지점이 곧 등기부를 떼어 봐야 하는 지점이라, 그걸 지우면 안 된다.
 */

export interface VerifyPayload {
  facts?: {
    publicPrice?: number | null
    purpose?: string | null
    approvalDate?: string | null
    matchedUnit?: { ho: string; floor: number; area: number; purpose: string } | null
  }
  findings?: Finding[]
  verdict?: { level: Level; text: string }
  landShare?: { pyeong: number | null; m2: number | null; label: string; note: string } | null
  cross?: {
    rows?: CrossRow[]
    summary?: { level: string; text: string }
    verdict?: string | null
    unavailable?: string
  } | null
}

const TONE: Record<string, string> = {
  danger: 'border-rose-200 bg-rose-50 text-rose-900',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  unknown: 'border-gray-200 bg-gray-50 text-gray-700',
}
const DOT: Record<string, string> = {
  danger: 'bg-rose-500',
  warn: 'bg-amber-500',
  ok: 'bg-emerald-500',
  unknown: 'bg-gray-400',
}

export default function VerifyResult({ v }: { v: VerifyPayload }) {
  const rows = v.cross?.rows ?? []
  const differ = rows.filter((r) => r.status === 'differ')

  return (
    <div className="space-y-2">
      {v.verdict && (
        <div className={`rounded-lg border px-3 py-2 text-[11px] font-bold ${TONE[v.verdict.level]}`}>
          {v.verdict.text}
        </div>
      )}

      {/* 우리 판정 */}
      {!!v.findings?.length && (
        <ul className="space-y-1">
          {v.findings.map((f) => (
            <li key={f.code} className="flex gap-2 text-[11px] leading-relaxed">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[f.level]}`} />
              <span>
                <b className="text-gray-800">{f.title}</b>
                <span className="text-gray-600"> — {f.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 대지지분은 값보다 근거가 중요하다 */}
      {v.landShare?.pyeong != null && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-gray-500">대지지분</span>
            <span className="text-sm font-bold tabular-nums text-gray-900">
              {v.landShare.pyeong}평
              <span className="ml-1 text-[10px] font-normal text-gray-400">
                {v.landShare.m2}㎡
              </span>
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
            <b className="text-gray-700">{v.landShare.label}</b> — {v.landShare.note}
          </p>
        </div>
      )}

      {/* 호파인더 대조 */}
      {v.cross?.unavailable ? (
        <p className="text-[10px] text-gray-400">
          {v.cross.unavailable === 'HOFINDER_OFF'
            ? '호파인더 대조는 꺼져 있습니다.'
            : '호파인더에 닿지 못해 대조하지 못했습니다 — 위 판정은 우리 데이터만으로 낸 것입니다.'}
        </p>
      ) : rows.length ? (
        <details className="rounded-lg border border-gray-200 bg-white" open={differ.length > 0}>
          <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-gray-700">
            호파인더 대조
            <span
              className={`ml-1.5 font-normal ${differ.length ? 'text-rose-600' : 'text-emerald-600'}`}
            >
              {v.cross?.summary?.text}
            </span>
          </summary>
          <table className="w-full border-t border-gray-100 text-[10px]">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1 pl-3 text-left font-normal">항목</th>
                <th className="py-1 text-right font-normal">우리</th>
                <th className="py-1 pr-3 text-right font-normal">호파인더</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.field}
                  className={`border-t border-gray-50 ${r.status === 'differ' ? 'bg-rose-50/60' : ''}`}
                >
                  <td className="py-1.5 pl-3 text-gray-600">
                    {r.status === 'differ' && <span className="mr-1 text-rose-500">✗</span>}
                    {r.label}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800">{r.ours ?? '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-gray-500">
                    {r.theirs ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows
            .filter((r) => r.note && (r.status === 'differ' || r.field === 'landShare'))
            .map((r) => (
              <p key={r.field} className="px-3 pb-2 text-[10px] leading-relaxed text-gray-500">
                <b>{r.label}</b> — {r.note}
              </p>
            ))}
          <p className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400">
            호파인더는 같은 공공데이터를 따로 구현한 서비스입니다. 두 곳이 갈리는 항목은 등기부·
            건축물대장 원본으로 확인하세요.
          </p>
        </details>
      ) : null}
    </div>
  )
}
