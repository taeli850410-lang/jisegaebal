'use client'

import { useEffect, useRef } from 'react'
import { PROJECT_TYPE_MAP, STAGES } from '@/lib/taxonomy'

/**
 * 구역 리포트 — 브라우저 인쇄로 PDF 저장.
 *
 * 왜 인쇄인가:
 *  - 고시문 PDF 는 우리 것이 아니다. 재개발닷컴이 올려둔 파일을 긁어오는 것은
 *    저작권·약관 위반이고, 정비몽땅 정보공개 자료는 열람요청·로그인 기반이라
 *    자동으로 받아올 수 없다(전 항목 0건인 사업장도 많다).
 *  - 대신 우리가 실제로 보유한 값(경계·단계·인가일·실거래·인근 단지)을 묶어
 *    한 장짜리 리포트로 만든다. 출처가 명확하고 항상 최신이다.
 *  - jsPDF 류는 한글 폰트를 통째로 embed 해야 해서 수 MB가 붙는다.
 *    브라우저 인쇄는 시스템 폰트를 그대로 써 한글이 깨지지 않고 의존성이 0이다.
 */

export interface ReportData {
  name: string
  gu: string | null
  dong: string | null
  projectType: string
  stage: string | null
  currentStageLabel: string | null
  monthsInStage: number | null
  areaM2: number
  noticeDate: string | null
  noticeSn: string | null
  dealCount: number
  medianPerPyeong: number | null
  summary: {
    siteName: string
    areaM2: number | null
    memberCount: number | null
    landOwnerCount: number | null
    tenantCount: number | null
    useZone: string | null
    far: number | null
    bcr: number | null
    floors: string | null
  } | null
  progressDates: { label: string; date: string }[]
  deals: {
    dealDate: string
    typeLabel: string
    dong: string
    jibun: string
    price: number
    landPyeong: number | null
    pricePerLandPyeong: number | null
  }[]
  apartments: {
    name: string
    ageYears: number | null
    households: number | null
    distanceKm: number
    areas: { exclusiveAr: number; price: number }[]
  }[]
}

const eok = (won: number) =>
  won >= 100_000_000
    ? `${(won / 100_000_000).toFixed(2).replace(/\.?0+$/, '')}억`
    : `${Math.round(won / 10_000).toLocaleString()}만`

export default function ZoneReport({
  data,
  onClose,
}: {
  data: ReportData
  onClose: () => void
}) {
  const printedAt = useRef(new Date().toLocaleString('ko-KR'))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const type = PROJECT_TYPE_MAP.get(data.projectType)
  const pyeong = Math.round(data.areaM2 / 3.3058)
  const sum = data.summary

  const rows: [string, string][] = [
    ['구역명', data.name],
    ['소재지', `${data.gu ?? '—'} ${data.dong ?? ''}`.trim()],
    ['사업종류', type?.label ?? data.projectType],
    ['진행단계', data.currentStageLabel ?? data.stage ?? '미확인'],
    ['구역면적', `${data.areaM2.toLocaleString()}㎡ (${pyeong.toLocaleString()}평)`],
    ['고시일', data.noticeDate?.replace(/-/g, '.') ?? '—'],
    ...(data.noticeSn ? ([['고시 일련번호', data.noticeSn]] as [string, string][]) : []),
    ...(sum?.landOwnerCount
      ? ([['토지등소유자', `${sum.landOwnerCount.toLocaleString()}명`]] as [string, string][])
      : []),
    ...(sum?.memberCount
      ? ([['조합원', `${sum.memberCount.toLocaleString()}명`]] as [string, string][])
      : []),
    ...(sum?.useZone ? ([['용도지역', sum.useZone]] as [string, string][]) : []),
    ...(sum?.far != null ? ([['용적률', `${sum.far}%`]] as [string, string][]) : []),
    ...(sum?.bcr != null ? ([['건폐율', `${sum.bcr}%`]] as [string, string][]) : []),
    ...(sum?.floors ? ([['층수', sum.floors]] as [string, string][]) : []),
  ]

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-600/50 print:static print:overflow-visible print:bg-white">
      {/* 화면에서만 보이는 조작 막대 */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-gray-900 px-4 py-2.5 text-white print:hidden">
        <span className="text-sm font-bold">구역 리포트 미리보기</span>
        <span className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded bg-indigo-500 px-3 py-1.5 text-xs font-bold hover:bg-indigo-400"
          >
            PDF로 저장 / 인쇄
          </button>
          <button
            onClick={onClose}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs font-bold hover:bg-gray-600"
          >
            닫기
          </button>
        </span>
      </div>

      <div className="zone-report mx-auto my-6 max-w-[820px] bg-white p-10 text-gray-900 shadow-xl print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-5 border-b-2 border-gray-900 pb-3">
          <p className="text-[11px] font-bold text-gray-500">정비사업 구역 리포트</p>
          <h1 className="mt-1 text-2xl font-black break-keep">{data.name}</h1>
          <p className="mt-1 text-xs text-gray-500">
            {data.gu ?? ''} {data.dong ?? ''} · {type?.label ?? ''} ·{' '}
            {data.currentStageLabel ?? data.stage ?? '단계 미확인'}
            {data.monthsInStage != null && ` (${data.monthsInStage}개월째)`}
          </p>
        </header>

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold">1. 구역 개요</h2>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k} className="border-b border-gray-200">
                  <th className="w-32 bg-gray-50 px-2.5 py-1.5 text-left font-semibold text-gray-600">
                    {k}
                  </th>
                  <td className="px-2.5 py-1.5">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {data.progressDates.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-bold">2. 진행 경과</h2>
            <table className="w-full border-collapse text-xs">
              <tbody>
                {data.progressDates.map((p) => (
                  <tr key={p.label} className="border-b border-gray-200">
                    <th className="w-32 bg-gray-50 px-2.5 py-1.5 text-left font-semibold text-gray-600">
                      {p.label}
                    </th>
                    <td className="px-2.5 py-1.5">{p.date.replace(/-/g, '.')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-gray-400">
              출처: 서울시 정비사업 정보몽땅 추진경과
              {STAGES.length > 0 && ' · 인가일이 등록된 단계만 표시'}
            </p>
          </section>
        )}

        <section className="mb-6">
          <h2 className="mb-2 text-sm font-bold">
            3. 실거래
            <span className="ml-1.5 text-[10px] font-normal text-gray-500">
              최근 24개월 · 구역 경계 내 {data.dealCount}건
              {data.medianPerPyeong && ` · 중앙 대지평당가 ${eok(data.medianPerPyeong)}/평`}
            </span>
          </h2>
          {data.deals.length ? (
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-gray-300 bg-gray-50 text-gray-600">
                  <th className="px-2 py-1.5 text-left font-semibold">계약일</th>
                  <th className="px-2 py-1.5 text-left font-semibold">유형</th>
                  <th className="px-2 py-1.5 text-left font-semibold">주소</th>
                  <th className="px-2 py-1.5 text-right font-semibold">거래가</th>
                  <th className="px-2 py-1.5 text-right font-semibold">대지지분</th>
                  <th className="px-2 py-1.5 text-right font-semibold">평당가</th>
                </tr>
              </thead>
              <tbody>
                {data.deals.slice(0, 25).map((d, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1">{d.dealDate.replace(/-/g, '.')}</td>
                    <td className="px-2 py-1">{d.typeLabel}</td>
                    <td className="px-2 py-1">
                      {d.dong} {d.jibun}
                    </td>
                    <td className="px-2 py-1 text-right font-semibold">{eok(d.price)}</td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {d.landPyeong ? `${d.landPyeong}평` : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {d.pricePerLandPyeong ? `${eok(d.pricePerLandPyeong)}/평` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-500">구역 경계 안에서 신고된 거래가 없습니다.</p>
          )}
        </section>

        {data.apartments.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-bold">
              4. 인근 아파트
              <span className="ml-1.5 text-[10px] font-normal text-gray-500">
                반경 1.5km · 최근 12개월 실거래
              </span>
            </h2>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-gray-300 bg-gray-50 text-gray-600">
                  <th className="px-2 py-1.5 text-left font-semibold">단지</th>
                  <th className="px-2 py-1.5 text-right font-semibold">거리</th>
                  <th className="px-2 py-1.5 text-right font-semibold">연차</th>
                  <th className="px-2 py-1.5 text-right font-semibold">세대수</th>
                  <th className="px-2 py-1.5 text-right font-semibold">최근 거래</th>
                </tr>
              </thead>
              <tbody>
                {data.apartments.map((a) => (
                  <tr key={a.name} className="border-b border-gray-100">
                    <td className="px-2 py-1 font-semibold">{a.name}</td>
                    <td className="px-2 py-1 text-right text-gray-500">{a.distanceKm}km</td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {a.ageYears != null ? `${a.ageYears}년` : '—'}
                    </td>
                    <td className="px-2 py-1 text-right text-gray-500">
                      {a.households != null ? a.households.toLocaleString() : '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {a.areas
                        .map((ar) => `${Math.round(ar.exclusiveAr)}㎡ ${eok(ar.price)}`)
                        .join(' / ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="mt-8 border-t border-gray-300 pt-3 text-[10px] leading-relaxed text-gray-500">
          <p>
            출처 — 구역 경계: 서울 열린데이터광장 「서울시 의제처리구역 위치정보(UPIS_C_UQ181)」 /
            진행단계·인가일·사업개요: 서울시 정비사업 정보몽땅 / 실거래: 국토교통부 실거래가 /
            세대수·사용승인일: 국토교통부 건축물대장.
          </p>
          <p className="mt-1">
            구역 경계와 진행단계는 참고자료이며 법적 효력이 없습니다. 실거래는 지번을 좌표로 바꿔
            구역 경계 안으로 판정된 건만 집계하므로 실제와 다를 수 있습니다. 본 서비스는
            중개·감정평가·투자자문을 제공하지 않습니다.
          </p>
          <p className="mt-1">생성 시각: {printedAt.current}</p>
        </footer>
      </div>
    </div>
  )
}
