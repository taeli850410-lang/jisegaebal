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
import { loadListings, removeListing, saveListing, type StoreMode } from '@/lib/listingStore'
import { subscribeStore } from '@/lib/userStore'
import VerifyResult, { type VerifyPayload } from './VerifyResult'

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
  /** 지금 어디에 저장되고 있는가 — 감추지 않는다 */
  const [mode, setMode] = useState<StoreMode>('local')
  const [tick, setTick] = useState(0)
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState<ListingSort>('price')
  const [a, setA] = useState<Assumptions>(DEFAULT_ASSUMPTIONS)
  const [f, setF] = useState<FormState>(EMPTY_FORM)
  const [jibun, setJibun] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /* 등록 전에 보여줄 검증 결과 — 계산해 놓고 감추지 않는다 */
  const [check, setCheck] = useState<VerifyPayload | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => subscribeStore(() => setTick((t) => t + 1)), [])
  useEffect(() => {
    let cancelled = false
    loadListings(zoneId).then((r) => {
      if (cancelled) return
      setItems(r.items)
      setMode(r.mode)
    })
    return () => {
      cancelled = true
    }
  }, [zoneId, tick])

  /** 지번·면적·층으로 공공데이터를 조회한다. 등록과 검증이 같은 경로를 쓴다. */
  const runVerify = useCallback(async (): Promise<VerifyPayload | null> => {
    if (!gu || !dong || !jibun.trim()) {
      setErr('지번을 입력하세요.')
      return null
    }
    const q = new URLSearchParams({
      gu,
      dong,
      jibun: jibun.trim(),
      type: f.type,
      ...(f.exclusiveAr ? { area: f.exclusiveAr } : {}),
      ...(f.floor ? { floor: f.floor } : {}),
      ...(f.price ? { price: String(Math.round(Number(f.price) * EOK)) } : {}),
    })
    return fetch(`/api/verify?${q}`).then((r) => r.json())
  }, [f, gu, dong, jibun])

  /*
   * 등록하기 전에 먼저 본다.
   *
   * 근생이라 분양자격이 다르다거나 대지지분 근거가 약하다는 건 등록 후가 아니라
   * 등록 전에 봐야 하는 이야기다. 그래서 검증을 따로 눌러볼 수 있게 한다.
   */
  const preview = useCallback(async () => {
    setErr(null)
    setBusy(true)
    try {
      setCheck(await runVerify())
    } catch {
      setErr('조회 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [runVerify])

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
      const v = await runVerify()
      setCheck(v)
      const res = await saveListing(
        {
          gu,
          dong,
          jibun: jibun.trim(),
          type: f.type,
          price,
          exclusiveAr: f.exclusiveAr ? Number(f.exclusiveAr) : null,
          floor: f.floor ? Number(f.floor) : null,
          publicPrice: v?.facts?.publicPrice ?? null,
          landSharePyeong: v?.landShare?.pyeong ?? null,
          landShareSource: v?.landShare?.label ?? null,
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
      if (res.mode === 'local') {
        setNotice('이 브라우저에만 저장되었습니다. 다른 사람에게는 보이지 않습니다.')
      } else if (!res.published) {
        setNotice('저장되었습니다. 중개사무소명·등록번호·전화가 없어 공개 목록에는 올라가지 않습니다.')
      } else {
        setNotice(null)
      }
      setF(EMPTY_FORM)
      setJibun('')
      setTick((t) => t + 1)
    } catch {
      setErr('등록 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }, [f, gu, dong, jibun, zoneId, zoneName, runVerify])

  const list = sortListings(items, sort, a)

  return (
    <>
      {/* 이 목록이 어디서 왔는지부터 밝힌다 */}
      <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-[11px] leading-relaxed text-sky-900">
        <b>이 목록은 등록된 매물입니다.</b> 우리가 다른 사이트에서 가져온 것이 아니라 중개사·소유자가
        직접 넣은 것입니다. 넣는 순간 공시가·대지지분·용도를 공공데이터로 붙여 감정가·프리미엄·
        초기투자금을 계산합니다.
        <br />
        {mode === 'server' ? (
          <>
            <b>서버에 저장되어 모두가 봅니다.</b> 공개 목록에 나오려면 중개사무소명·등록번호·
            전화가 있어야 합니다 (공인중개사법 제18조의2).
          </>
        ) : (
          <>
            <b>지금은 이 브라우저에만 저장됩니다</b> — 다른 사람에게는 보이지 않습니다. 서버
            저장소가 연결되면 자동으로 공용으로 바뀝니다.
          </>
        )}
      </div>

      {notice && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          {notice}
        </p>
      )}

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

          {/*
            검증을 먼저 눌러볼 수 있게 한다.
            근생이라 분양자격이 다르다는 건 올리기 전에 알아야 한다.
          */}
          <div className="flex gap-2">
            <button
              onClick={preview}
              disabled={busy}
              className="flex-1 rounded-lg border border-indigo-200 bg-white py-2 text-sm font-bold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
            >
              {busy ? '조회 중…' : '먼저 검증만'}
            </button>
            <button
              onClick={add}
              disabled={busy}
              className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? '확인 중…' : '등록하고 검증'}
            </button>
          </div>

          {check && (
            <div className="border-t border-gray-100 pt-2">
              <VerifyResult v={check} />
            </div>
          )}
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
                  const m = computeMetrics(
                    l.price,
                    l.publicPrice ?? null,
                    l.landSharePyeong ?? null,
                    a,
                    l.purpose,
                    l.exclusiveAr,
                  )
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
                        {m.needsPublicPrice ? (
                          /* 공시가가 없으면 레버리지를 못 낸다. 0 으로 두면
                             "전액 현금"이라는 전혀 다른 숫자가 나온다. */
                          <span
                            className="text-[10px] font-bold text-amber-600"
                            title="공시가격이 없어 레버리지를 산정할 수 없습니다. 근린생활시설 등은 공동주택가격 대상이 아닙니다."
                          >
                            산정 불가
                          </span>
                        ) : (
                          <>
                            {eok(m.initialCash)}
                            {m.initialCashPct != null && (
                              <span className="block text-[9px] text-gray-400">
                                {m.initialCashPct}%
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-gray-500">
                        {l.publicPrice ? (
                          eok(l.publicPrice)
                        ) : (
                          <span
                            className="text-[10px] text-amber-600"
                            title="공동주택 공시가격 대상이 아니거나 아직 등재되지 않았습니다"
                          >
                            없음
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.landSharePyeong ? `${l.landSharePyeong}평` : '—'}
                      </td>
                      <td
                        className={`py-1.5 text-right font-bold tabular-nums ${
                          (m.premium ?? 0) < 0 ? 'text-emerald-600' : 'text-rose-500'
                        }`}
                      >
                        {m.premium == null ? (
                          <span className="text-[10px] font-normal text-amber-600">산정 불가</span>
                        ) : (
                          eok(m.premium)
                        )}
                      </td>
                      <td className="py-1.5 pl-1 text-right">
                        <button
                          onClick={async () => {
                            await removeListing(l.id)
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
        다릅니다. <b>취득세는 대장 용도로 갈립니다</b> — 근린생활시설·토지는 4.6%, 주택은 가액·면적·
        주택수에 따라 1.1~13.4% 입니다(지방세법). 광고에 주택으로 적혀 있어도 대장이 근생이면
        근생 세율입니다. <b>공시가격이 없으면 초투·감정가·추정 P를 내지 않습니다</b> — 0으로
        계산하면 전혀 다른 숫자가 됩니다. 공시가·대지지분·용도는 공공데이터(공동주택 공시가격·대지권등록부·건축물대장)에서
        자동으로 붙입니다. 본 서비스는 중개·감정평가·투자자문을 제공하지 않습니다.
      </p>
    </>
  )
}
