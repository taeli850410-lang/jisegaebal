'use client'

import { useCallback, useState } from 'react'
import VerifyResult, { type VerifyPayload } from '@/components/detail/VerifyResult'
import { computeMetrics, DEFAULT_ASSUMPTIONS, type Assumptions } from '@/lib/listingModel'

/**
 * 매물 검증 — 주소와 호가만 넣으면 나머지는 공공데이터가 채운다.
 *
 * 원래 이 기능은 구역 상세의 매물 등록 폼 안에만 있었다. 그런데 실제로는
 * 등록할 생각 없이 "이 호가가 말이 되나"만 보고 싶을 때가 대부분이다.
 * 그래서 따로 뺐다.
 *
 * 여기서 넣은 호가는 저장하지 않는다. 우리가 들고 있을 이유가 없다.
 */

const EOK = 100_000_000

const GU = [
  '강남구', '강동구', '강북구', '강서구', '관악구', '광진구', '구로구', '금천구', '노원구',
  '도봉구', '동대문구', '동작구', '마포구', '서대문구', '서초구', '성동구', '성북구', '송파구',
  '양천구', '영등포구', '용산구', '은평구', '종로구', '중구', '중랑구',
]

const eok = (won: number | null) =>
  won == null ? '—' : (won / EOK).toFixed(2).replace(/[.]?0+$/, '') + '억'

const FIELD =
  'mt-0.5 w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm outline-none focus:border-indigo-500'

export default function VerifyPage() {
  const [gu, setGu] = useState('용산구')
  const [dong, setDong] = useState('')
  const [jibun, setJibun] = useState('')
  const [floor, setFloor] = useState('')
  const [area, setArea] = useState('')
  const [price, setPrice] = useState('')
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [v, setV] = useState<VerifyPayload | null>(null)

  const run = useCallback(async () => {
    if (!dong.trim() || !jibun.trim()) {
      setErr('동과 지번을 입력하세요. (예: 서계동 / 245-11)')
      return
    }
    setErr(null)
    setBusy(true)
    setV(null)
    try {
      const q = new URLSearchParams({
        gu,
        dong: dong.trim(),
        jibun: jibun.trim(),
        ...(floor ? { floor } : {}),
        ...(area ? { area } : {}),
        ...(price ? { price: String(Math.round(Number(price) * EOK)) } : {}),
      })
      const r = await fetch('/api/verify?' + q)
      const j = await r.json()
      if (!r.ok) {
        setErr(j?.error ?? '조회에 실패했습니다.')
        return
      }
      setV(j)
    } catch {
      setErr('연결에 실패했습니다. 잠시 후 다시 해주세요.')
    } finally {
      setBusy(false)
    }
  }, [gu, dong, jibun, floor, area, price])

  /* 호가를 넣었을 때만 돈 계산을 한다 */
  const m =
    v && price
      ? computeMetrics(
          Math.round(Number(price) * EOK),
          v.facts?.publicPrice ?? null,
          v.landShare?.pyeong ?? null,
          a,
          v.facts?.matchedUnit?.purpose ?? v.facts?.purpose ?? null,
          v.facts?.matchedUnit?.area ?? (area ? Number(area) : null),
        )
      : null

  return (
    <div className="mx-auto min-h-dvh max-w-2xl bg-gray-50 px-5 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">매물 검증</h1>
        <a href="/" className="text-[11px] text-indigo-600 hover:underline">
          지도로 →
        </a>
      </div>
      <p className="mb-5 text-[11px] leading-relaxed text-gray-500">
        주소와 호가만 넣으면 건축물대장·공시가격·실거래로 대조합니다. <b>호파인더</b>에도 같은
        물건을 물어 두 답을 나란히 놓습니다 — 갈리는 항목이 등기부를 떼어 봐야 하는 곳입니다.
        입력한 호가는 저장하지 않습니다.
      </p>

      <div className="card space-y-2.5 p-4">
        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[10px] text-gray-500">자치구</span>
            <select value={gu} onChange={(e) => setGu(e.target.value)} className={FIELD}>
              {GU.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500">법정동 *</span>
            <input
              value={dong}
              onChange={(e) => setDong(e.target.value)}
              placeholder="서계동"
              className={FIELD}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500">지번 *</span>
            <input
              value={jibun}
              onChange={(e) => setJibun(e.target.value)}
              placeholder="245-11"
              className={FIELD}
            />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <label className="block">
            <span className="text-[10px] text-gray-500">층</span>
            <input
              type="number"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="3 (지하 -1)"
              className={FIELD + ' text-right tabular-nums'}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500">전용면적 ㎡</span>
            <input
              type="number"
              step={0.01}
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="44.48"
              className={FIELD + ' text-right tabular-nums'}
            />
          </label>
          <label className="block">
            <span className="text-[10px] text-gray-500">호가 (억)</span>
            <input
              type="number"
              step={0.1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="7"
              className={FIELD + ' text-right tabular-nums'}
            />
          </label>
        </div>

        <p className="text-[10px] leading-relaxed text-gray-400">
          층과 전용면적을 함께 넣어야 호를 특정합니다. 하나만 있으면 건물 전체 기준으로만 답합니다.
        </p>

        {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}

        <button
          onClick={run}
          disabled={busy}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? '공공데이터 조회 중…' : '검증'}
        </button>
      </div>

      {v && (
        <div className="mt-4 space-y-3">
          {m && (
            <div className="card p-4">
              {/* 가정값을 감추지 않는다 — 사용자가 바꿀 수 있어야 검증이 된다 */}
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500">
                <span className="font-bold">계산 가정</span>
                <label className="flex items-center gap-1">
                  감정가 배수
                  <input
                    type="number"
                    step={0.05}
                    value={a.appraisalMultiple}
                    onChange={(e) => setA({ ...a, appraisalMultiple: Number(e.target.value) })}
                    className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1">
                  레버리지
                  <input
                    type="number"
                    step={0.05}
                    value={a.leverageRate}
                    onChange={(e) => setA({ ...a, leverageRate: Number(e.target.value) })}
                    className="w-14 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums"
                  />
                </label>
                <label className="flex items-center gap-1">
                  주택 수
                  <select
                    value={a.houseCount}
                    onChange={(e) => setA({ ...a, houseCount: Number(e.target.value) as 1 | 2 | 3 })}
                    className="rounded border border-gray-200 px-1 py-0.5"
                  >
                    <option value={1}>1주택</option>
                    <option value={2}>2주택</option>
                    <option value={3}>3주택+</option>
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={a.adjusted}
                    onChange={(e) => setA({ ...a, adjusted: e.target.checked })}
                  />
                  조정대상지역
                </label>
              </div>

              <dl className="grid grid-cols-4 gap-2 text-center">
                {[
                  ['추정 감정가', m.needsPublicPrice ? '산정 불가' : eok(m.appraisal)],
                  ['추정 P', m.premium == null ? '산정 불가' : eok(m.premium)],
                  ['취득세', m.tax == null ? '—' : eok(m.tax) + ' · ' + m.taxRatePct + '%'],
                  ['초기투자금', m.needsPublicPrice ? '산정 불가' : eok(m.initialCash)],
                ].map(([k, val]) => (
                  <div key={k} className="rounded-lg bg-gray-50 px-2 py-2">
                    <dt className="text-[10px] text-gray-500">{k}</dt>
                    <dd
                      className={
                        'mt-0.5 font-bold tabular-nums ' +
                        (val === '산정 불가'
                          ? 'text-[11px] text-amber-600'
                          : 'text-sm text-gray-900')
                      }
                    >
                      {val}
                    </dd>
                  </div>
                ))}
              </dl>

              {m.taxNote && (
                <p className="mt-2 text-[10px] leading-relaxed text-gray-500">{m.taxNote}</p>
              )}
              {m.needsPublicPrice && (
                <p className="mt-1 text-[10px] leading-relaxed text-amber-700">
                  공시가격이 없어 감정가·프리미엄·초투를 내지 않았습니다. 0으로 계산하면 전혀 다른
                  숫자가 됩니다 — 근린생활시설은 공동주택가격 대상이 아닙니다.
                </p>
              )}
            </div>
          )}

          <div className="card p-4">
            <VerifyResult v={v} />
          </div>
        </div>
      )}
    </div>
  )
}
