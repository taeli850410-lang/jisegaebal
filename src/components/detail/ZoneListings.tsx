'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_ASSUMPTIONS,
  computeMetrics,
  isPublishable,
  sortListings,
  type Assumptions,
  type Listing,
  type ListingSort,
} from '@/lib/listingModel'
import { getListings, removeListing, saveListing } from '@/lib/listingStore'
import { subscribeStore } from '@/lib/userStore'

/**
 * 구역 매물.
 *
 * 우리가 어디서 긁어온 매물은 하나도 없다. 중개사나 사용자가 넣은 것이고,
 * 넣는 순간 우리가 공공데이터로 공시가·대지지분·용도를 붙인다.
 * 그러면 매매가 하나로 감정가·프리미엄·초기투자금이 다 나온다.
 *
 * 지금 저장소는 브라우저다. 그 사실을 감추지 않는다 — 다른 사람에게는
 * 안 보이고, 공유하려면 링크로 보내야 한다.
 */

const EOK = 100_000_000
const eok = (won: number | null | undefined) =>
  !won && won !== 0
    ? '—'
    : Math.abs(won) >= EOK
      ? `${(won / EOK).toFixed(2).replace(/\.?0+$/, '')}억`
      : `${Math.round(won / 10_000).toLocaleString()}만`

interface FormState {
  type: string
  price: string
  exclusiveAr: string
  floor: string
  brokerOffice: string
  brokerRegNo: string
  brokerTel: string
  memo: string
}

const EMPTY_FORM: FormState = {
  type: '다세대',
  price: '',
  exclusiveAr: '',
  floor: '',
  brokerOffice: '',
  brokerRegNo: '',
  brokerTel: '',
  memo: '',
}

export default function ZoneListings({
  zoneId,
  zoneName,
  gu,
  dong,
}: {
  zoneId: string
  zoneName: string
  gu: string | null
  dong: string | null
}) {
  const [items, setItems] = useState<Listing[]>([])
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<ListingSort>('price')
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS)
  const [f, setF] = useState<FormState>(EMPTY_FORM)
  const [jibun, setJibun] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => subscribeStore(() => setTick((t) => t + 1)), [])
  useEffect(() => setItems(getListings(zoneId)), [zoneId, tick])

  /**
   * 등록할 때 공공데이터를 붙인다.
   * 중개사는 지번·가격·면적만 넣고, 공시가·대지지분·용도는 우리가 채운다 —
   * 그게 우리가 하는 일이다.
   */
  const add = useCallback(async () => {
    setErr(null)
    const price = Math.round(Number(f.price) * EOK)
    if (!gu || !dong || !jibun.trim()) {
      setErr('지번을 입력하세요.')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      setErr('매매가를 억 단위로 입력하세요. (예: 7 또는 7.5)')
      return
    }
    setBusy(true)
    try {
      const q = new URLSearchParams({
        gu,
        dong,
        jibun: jibun.trim(),
        type: f.type,
        ...(f.exclusiveAr ? { area: f.exclusiveAr } : {}),
        ...(f.floor ? { floor: f.floor } : {}),
      })
      const v = await fetch(`/api/verify?${q}`).then((r) => r.json())
      saveListing(
        {
          gu,
          dong,
          jibun: jibun.trim(),
          type: f.type,
          price,
          exclusiveAr: f.exclusiveAr ? Number(f.exclusiveAr) : null,
          floor: f.floor ? Number(f.floor) : null,
          publicPrice: v?.facts?.publicPrice ?? null,
          landSharePyeong: v?.facts?.landSharePyeong ?? null,
          landShareSource: v?.facts?.landShareSource ?? null,
          buildYear: v?.facts?.approvalDate ? Number(v.facts.approvalDate.slice(0, 4)) : null,
          purpose: v?.facts?.matchedUnit?.purpose ?? v?.facts?.purpose ?? null,
          zoneId,
          zoneName,
          brokerOffice: f.brokerOffice || null,
          brokerRegNo: f.brokerRegNo || null,
          brokerTel: f.brokerTel || null,
          memo: f.memo || undefined,
        },
        Date.now(),
      )
      setF(EMPTY_FORM)
      setJibun('')
      setOpen(false)
      setTick((t) => t + 1)
    } catch {
      setErr('등록 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [f, gu, dong, jibun, zoneId, zoneName])

  const list = sortListings(items, sort, a)

  return (
    <>
      {/* 이 목록이 어디서 왔는지부터 밝힌다 */}
      <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11px] leading-relaxed text-sky-900">
        <b>이 목록은 등록된 매물입니다.</b> 우리가 다른 사이트에서 가져온 것이 아니라 중개사·소유자가
        직접 넣은 것입니다. 넣는 순간 공시가·대지지분·용도를 공공데이터로 붙여 감정가·프리미엄·
        초기투자금을 계산합니다.
        <br />
        <b>지금은 이 브라우저에만 저장됩니다</b> — 다른 사람에게는 보이지 않습니다.
      </div>

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-gray-500">
          매물 <b className="text-gray-700">{items.length}</b>건
        </p>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-full bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-700"
        >
          {open ? '닫기' : '+ 매물 등록'}
        </button>
      </div>

      {open && (
        <div className="card mb-3 space-y-2 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-gray-500">지번 *</span>
              <input
                value={jibun}
                onChange={(e) => setJibun(e.target.value)}
                placeholder={dong ? `${dong} 245-11 의 "245-11"` : '245-11'}
                className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">매매가 (억) *</span>
              <input
                type="number"
                step={0.1}
                value={f.price}
                onChange={(e) => setF({ ...f, price: e.target.value })}
                placeholder="7"
                className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">유형</span>
              <select
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
                className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              >
                {['다세대', '연립', '단독', '다가구', '아파트', '상가', '토지'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">전용면적 (㎡)</span>
              <input
                type="number"
                step={0.01}
                value={f.exclusiveAr}
                onChange={(e) => setF({ ...f, exclusiveAr: e.target.value })}
                placeholder="42.96"
                className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-500">층 (지하는 −1)</span>
              <input
                type="number"
                value={f.floor}
                onChange={(e) => setF({ ...f, floor: e.target.value })}
                placeholder="4"
                className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-indigo-500"
              />
            </label>
          </div>

          {/* 공인중개사법 제18조의2 — 광고에는 사무소 정보가 함께 있어야 한다 */}
          <p className="pt-1 text-[10px] font-bold text-gray-500">
            중개사 정보 (공개 목록에 올리려면 필요합니다)
          </p>
          <div className="grid grid-cols-3 gap-2">
            <input
              value={f.brokerOffice}
              onChange={(e) => setF({ ...f, brokerOffice: e.target.value })}
              placeholder="사무소명"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <input
              value={f.brokerRegNo}
              onChange={(e) => setF({ ...f, brokerRegNo: e.target.value })}
              placeholder="등록번호"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
            <input
              value={f.brokerTel}
              onChange={(e) => setF({ ...f, brokerTel: e.target.value })}
              placeholder="전화"
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
            />
          </div>

          {err && <p className="text-[11px] font-bold text-rose-600">{err}</p>}

          <button
            onClick={add}
            disabled={busy}
            className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? '공공데이터 확인 중…' : '등록하고 검증'}
          </button>
          <p className="text-[10px] leading-relaxed text-gray-400">
            중개대상물 표시·광고는 개업공인중개사만 할 수 있습니다(공인중개사법 제18조의2). 사무소명·
            등록번호·전화가 없으면 이 브라우저에만 남고 공개 목록에는 올라가지 않습니다.
          </p>
        </div>
      )}

      {/* 가정값 — 감추지 않는다 */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-[10px] text-gray-500">
        <span className="font-bold">계산 가정</span>
        <label className="flex items-center gap-1">
          감정가 = 공시가 ×
          <input
            type="number"
            step={0.1}
            value={a.appraisalMultiple}
            onChange={(e) => setA({ ...a, appraisalMultiple: Number(e.target.value) })}
            className="w-12 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1">
          레버리지 = 공시가 ×
          <input
            type="number"
            step={0.05}
            value={a.leverageRate}
            onChange={(e) => setA({ ...a, leverageRate: Number(e.target.value) })}
            className="w-12 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums"
          />
        </label>
        <label className="flex items-center gap-1">
          취득세
          <input
            type="number"
            step={0.1}
            value={a.acquisitionTaxRate}
            onChange={(e) => setA({ ...a, acquisitionTaxRate: Number(e.target.value) })}
            className="w-11 rounded border border-gray-200 px-1 py-0.5 text-right tabular-nums"
          />
          %
        </label>
      </div>

      {items.length === 0 ? (
        <p className="note-box note-box--center">
          아직 등록된 매물이 없습니다.
          {'\n'}위 「매물 등록」으로 넣으면 공공데이터를 붙여 계산해 드립니다.
        </p>
      ) : (
        <>
          <div className="mb-1 flex gap-3 text-[11px]">
            {(
              [
                ['price', '가격 낮은순'],
                ['cash', '초투 낮은순'],
                ['premium', '추정 P 낮은순'],
                ['landShare', '대지지분 큰순'],
              ] as [ListingSort, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`font-bold ${sort === k ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-gray-400">
                  <th className="py-1 text-left font-medium">유형</th>
                  <th className="py-1 text-right font-medium">매매가</th>
                  <th className="py-1 text-right font-medium">초투</th>
                  <th className="py-1 text-right font-medium">공시가</th>
                  <th className="py-1 text-right font-medium">대지지분</th>
                  <th className="py-1 text-right font-medium">추정 P</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {list.map((l) => {
                  const m = computeMetrics(l.price, l.publicPrice ?? null, l.landSharePyeong ?? null, a)
                  return (
                    <tr key={l.id} className="border-t border-gray-50">
                      <td className="py-1.5">
                        <span className="block font-bold">{l.type}</span>
                        <span className="block text-[10px] text-gray-400">
                          {l.dong} {l.jibun}
                          {l.buildYear ? ` · ${l.buildYear}년` : ''}
                        </span>
                        {!isPublishable(l) && (
                          <span className="mt-0.5 inline-block rounded bg-amber-50 px-1 text-[9px] font-bold text-amber-700">
                            비공개
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-bold tabular-nums text-indigo-600">
                        {eok(l.price)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {eok(m.initialCash)}
                        {m.initialCashPct != null && (
                          <span className="block text-[9px] text-gray-400">
                            {m.initialCashPct}%
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">
                        {eok(l.publicPrice)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.landSharePyeong ? `${l.landSharePyeong}평` : '—'}
                      </td>
                      <td
                        className={`py-1.5 text-right font-bold tabular-nums ${
                          (m.premium ?? 0) < 0 ? 'text-emerald-600' : 'text-rose-500'
                        }`}
                      >
                        {eok(m.premium)}
                      </td>
                      <td className="py-1.5 pl-1 text-right">
                        <button
                          onClick={() => {
                            removeListing(l.id)
                            setTick((t) => t + 1)
                          }}
                          aria-label="삭제"
                          className="rounded px-1 text-gray-300 hover:bg-gray-100 hover:text-rose-500"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
        <b>초투</b> = 매매가 + 취득세 − 공시가×레버리지. <b>추정 감정가</b> = 공시가×배수,{' '}
        <b>추정 P</b> = 매매가 − 추정 감정가. 전부 위 가정값에 따른 산수이며 조합이 확정한 감정가와
        다릅니다. 공시가·대지지분·용도는 공공데이터(공동주택 공시가격·대지권등록부·건축물대장)에서
        자동으로 붙입니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.
      </p>
    </>
  )
}
