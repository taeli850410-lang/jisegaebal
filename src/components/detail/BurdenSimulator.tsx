'use client'

import { useMemo, useState } from 'react'
import {
  SCENARIO_LABEL,
  calcScenarios,
  estimateAppraisal,
  type BurdenInput,
  type ScenarioKey,
} from '@/lib/burden'

const 억 = 100_000_000
const 만 = 10_000

const fmt = (won: number) => {
  const sign = won < 0 ? '-' : ''
  const v = Math.abs(won)
  if (v >= 억) return `${sign}${(v / 억).toFixed(2).replace(/\.?0+$/, '')}억`
  return `${sign}${Math.round(v / 만).toLocaleString()}만`
}

/** 억 단위로 입력받는 칸 — 사용자는 원 단위를 세지 않는다 */
function EokField({
  label,
  value,
  onChange,
  hint,
  step = 0.1,
}: {
  label: string
  value: number
  onChange: (won: number) => void
  hint?: string
  step?: number
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={Number((value / 억).toFixed(2))}
          onChange={(e) => onChange(Number(e.target.value) * 억)}
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500"
        />
        <span className="shrink-0 text-xs text-gray-400">억</span>
      </div>
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  )
}

function NumField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  unit: string
  step?: number
  hint?: string
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-gray-500">{label}</span>
      <div className="mt-0.5 flex items-center gap-1">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500"
        />
        <span className="shrink-0 text-xs text-gray-400">{unit}</span>
      </div>
      {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
    </label>
  )
}

export default function BurdenSimulator({
  zoneName,
  zoneLandPricePerPyeong,
  nearbyTopPricePerPyeong,
  onClose,
}: {
  zoneName: string
  /** 구역 대지평당가 중앙값 — 감정가 추정의 기준 */
  zoneLandPricePerPyeong: number | null
  /** 인근 아파트 최고 평당가 — 준공 후 시세의 출발점 */
  nearbyTopPricePerPyeong: number | null
  onClose: () => void
}) {
  const landPpp = zoneLandPricePerPyeong ?? 5000 * 만
  const newPpp = nearbyTopPricePerPyeong ?? 4000 * 만

  const [landShare, setLandShare] = useState(10)
  const [appraisalRate, setAppraisalRate] = useState(70)
  const [purchasePrice, setPurchasePrice] = useState(Math.round(landPpp * 10))
  const [bijul, setBijul] = useState(100)
  const [memberPpp, setMemberPpp] = useState(Math.round(newPpp * 0.75))
  const [targetPyeong, setTargetPyeong] = useState(25)
  const [taxRate, setTaxRate] = useState(4.6)
  const [financeCost, setFinanceCost] = useState(0)
  const [otherCosts, setOtherCosts] = useState(0)
  const [expectedPpp, setExpectedPpp] = useState(newPpp)
  const [manualAppraisal, setManualAppraisal] = useState<number | null>(null)

  const estimated = estimateAppraisal(landShare, landPpp, appraisalRate)
  const appraisalPrice = manualAppraisal ?? estimated

  const input: BurdenInput = {
    purchasePrice,
    appraisalPrice,
    bijul,
    memberPricePerPyeong: memberPpp,
    targetPyeong,
    acquisitionTaxRate: taxRate,
    financeCost,
    otherCosts,
    expectedPricePerPyeong: expectedPpp,
  }

  const scenarios = useMemo(() => calcScenarios(input), [
    purchasePrice, appraisalPrice, bijul, memberPpp, targetPyeong, taxRate,
    financeCost, otherCosts, expectedPpp,
  ])

  const base = scenarios.base

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
        <button
          onClick={onClose}
          aria-label="뒤로"
          className="rounded px-1 text-lg text-gray-400 hover:bg-gray-100"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">분담금 시뮬레이터</h2>
          <p className="truncate text-[11px] text-gray-400">{zoneName}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-rose-500"
        >
          ✕
        </button>
      </div>

      <div className="thin-scroll flex-1 overflow-y-auto px-4 py-3">
        {/* 결과 먼저 — 입력을 만질 때마다 즉시 반응하는 게 이 도구의 핵심이다 */}
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              ['권리가액', base.rightValue, '감정가 × 비례율'],
              [base.burden >= 0 ? '추가분담금' : '환급금', Math.abs(base.burden), '분양가 − 권리가액'],
              ['총 투입비용', base.totalInvestment, '매입가+취득세+분담금+비용'],
              ['예상 수익', base.profit, `수익률 ${base.roi}%`],
            ].map(([label, v, hint], i) => (
              <div key={label as string}>
                <p className="text-[11px] text-gray-500">{label}</p>
                <p
                  className={`text-lg font-bold tabular-nums ${
                    i === 3 ? ((v as number) >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-gray-900'
                  }`}
                >
                  {fmt(v as number)}
                </p>
                <p className="text-[10px] text-gray-400">{hint}</p>
              </div>
            ))}
          </div>

          {/* 3시나리오 */}
          <table className="mt-4 w-full text-[11px]">
            <thead>
              <tr className="text-gray-400">
                <th className="py-1 text-left font-medium">시나리오</th>
                <th className="py-1 text-right font-medium">비례율</th>
                <th className="py-1 text-right font-medium">분담금</th>
                <th className="py-1 text-right font-medium">수익</th>
                <th className="py-1 text-right font-medium">수익률</th>
              </tr>
            </thead>
            <tbody>
              {(['conservative', 'base', 'optimistic'] as ScenarioKey[]).map((k) => {
                const s = scenarios[k]
                const b = k === 'conservative' ? bijul - 10 : k === 'optimistic' ? bijul + 10 : bijul
                return (
                  <tr key={k} className={k === 'base' ? 'font-bold' : 'text-gray-600'}>
                    <td className="py-1.5">{SCENARIO_LABEL[k]}</td>
                    <td className="py-1.5 text-right tabular-nums">{Math.max(0, b)}%</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.burden)}</td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${
                        s.profit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {fmt(s.profit)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{s.roi}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-gray-400">
            보수/낙관은 비례율 ±10%p, 준공 후 시세 ±15%를 적용한 값입니다.
          </p>
        </div>

        {/* 입력 */}
        <h3 className="mt-5 mb-2 text-sm font-bold">내 물건</h3>
        <div className="grid grid-cols-2 gap-3">
          <EokField label="매입가(호가)" value={purchasePrice} onChange={setPurchasePrice} />
          <NumField label="대지지분" value={landShare} onChange={setLandShare} unit="평" step={0.1} />
          <NumField
            label="감정가율"
            value={appraisalRate}
            onChange={(v) => {
              setAppraisalRate(v)
              setManualAppraisal(null)
            }}
            unit="%"
            hint="감정가는 통상 시세보다 낮게 나옵니다"
          />
          <EokField
            label="종전 감정가"
            value={appraisalPrice}
            onChange={setManualAppraisal}
            hint={
              manualAppraisal == null
                ? `추정: 대지지분 × ${fmt(landPpp)}/평 × ${appraisalRate}%`
                : '직접 입력됨'
            }
          />
        </div>

        <h3 className="mt-5 mb-2 text-sm font-bold">사업 가정</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="비례율" value={bijul} onChange={setBijul} unit="%" />
          <NumField label="희망 평형" value={targetPyeong} onChange={setTargetPyeong} unit="평" />
          <NumField
            label="조합원분양가"
            value={Math.round(memberPpp / 만)}
            onChange={(v) => setMemberPpp(v * 만)}
            unit="만/평"
            step={100}
          />
          <NumField
            label="준공 후 시세"
            value={Math.round(expectedPpp / 만)}
            onChange={(v) => setExpectedPpp(v * 만)}
            unit="만/평"
            step={100}
            hint={nearbyTopPricePerPyeong ? '인근 아파트 기준' : '기본값'}
          />
        </div>

        <h3 className="mt-5 mb-2 text-sm font-bold">부대 비용</h3>
        <div className="grid grid-cols-2 gap-3">
          <NumField label="취득세율" value={taxRate} onChange={setTaxRate} unit="%" step={0.1} />
          <EokField label="이주비 이자 등" value={financeCost} onChange={setFinanceCost} />
          <EokField label="기타 비용" value={otherCosts} onChange={setOtherCosts} />
        </div>

        <div className="mt-5 rounded-lg bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
          ⚠️ 본 계산은 <b>사용자가 입력한 가정치</b> 기반 참고용이며, 조합이 확정한 값과 다를 수
          있습니다. 실제 분담금은 <b>관리처분계획 인가 시 확정</b>됩니다. 본 서비스는
          중개·감정평가·투자자문을 제공하지 않습니다.
        </div>

        <p className="mt-2 mb-4 text-[10px] leading-relaxed text-gray-400">
          감정가 추정에 쓰인 대지평당가는 이 구역의 최근 실거래 중앙값이고, 준공 후 시세 기본값은
          반경 1.5km 인근 아파트 실거래에서 가져왔습니다.
        </p>
      </div>
    </div>
  )
}
