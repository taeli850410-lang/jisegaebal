'use client'

import { CASE_URL, SEARCH_URL, WEEK_URL, courtOf } from '@/lib/courtAuction'

/**
 * 법원경매 안내.
 *
 * 물건 목록을 못 싣는다 — 공개 API 가 없다. 그렇다고 빈 화면을 두거나
 * 그럴듯한 표를 지어낼 수는 없으므로, 원문으로 가장 짧게 데려간다.
 *
 * 부동산 경매는 소재지 지방법원 전속관할이라 자치구만 고르면 어느 법원인지
 * 확정된다. 사람들이 실제로 헷갈리는 지점이라 이 한 가지가 값어치를 한다.
 */
export default function CourtAuctionPanel({
  gu,
  guSelect,
}: {
  gu: string
  guSelect: React.ReactNode
}) {
  const court = courtOf(gu)

  return (
    <>
      <div className="flex gap-2 border-b border-gray-50 px-4 py-2.5">{guSelect}</div>

      {/* 왜 목록이 없는지부터 밝힌다. 찾다가 없다는 걸 알게 하면 안 된다. */}
      <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
        <b>법원경매 물건 목록은 제공하지 않습니다.</b> 대법원이 공개 API를 열지 않았고, 공공데이터
        포털의 경매 통계는 별도 플랫폼 가입이 필요합니다. 민간 경매 사이트를 긁어오는 방식은
        약관 위반이라 하지 않습니다.
        <br />
        아래에서 <b>법원경매정보</b> 원문으로 바로 이동하세요 — 공식·무료입니다.
      </div>

      {gu && court && (
        <div className="mx-4 mt-3 rounded-xl border border-gray-200 bg-white p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-bold text-gray-400">{gu} 경매 관할</p>
          <p className="mt-1 text-lg font-extrabold tracking-tight">{court.name}</p>
          <p className="mt-1 text-[11px] text-gray-500">
            부동산 경매는 소재지 지방법원 전속관할입니다 (민사집행법 제79조)
          </p>
          <a
            href={`tel:${court.tel}`}
            className="mt-2 inline-block text-[12px] font-bold text-indigo-600 hover:underline"
          >
            {court.tel}
          </a>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-400">
            같은 관할: {court.gus.join(' · ')}
          </p>
        </div>
      )}

      {!gu && (
        <div className="px-4 py-6">
          <p className="note-box note-box--center">
            자치구를 고르면 그 지역 경매를 담당하는 법원을 알려드립니다.
          </p>
        </div>
      )}

      <div className="mt-3 px-4">
        <p className="panel-sub mt-0">법원경매정보 바로가기</p>
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {[
            {
              label: '물건상세검색',
              note: '지역·용도·감정가·매각기일로 물건을 찾습니다',
              href: SEARCH_URL,
            },
            {
              label: '금주 매각기일',
              note: '이번 주 매각이 잡힌 물건',
              href: WEEK_URL,
            },
            {
              label: '경매사건검색',
              note: '사건번호(예: 2026타경12345)를 알 때',
              href: CASE_URL,
            },
          ].map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold">{l.label}</span>
                  <span className="block text-[11px] text-gray-400">{l.note}</span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-gray-400">열기 ↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 px-4">
        <p className="panel-sub mt-0">경매와 공매는 다릅니다</p>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-400">
              <th className="py-1 text-left font-medium">　</th>
              <th className="py-1 text-left font-medium">경매</th>
              <th className="py-1 text-left font-medium">공매</th>
            </tr>
          </thead>
          <tbody className="[&_td]:py-1.5 [&_td]:align-top">
            {[
              ['주관', '법원', '한국자산관리공사'],
              ['근거법', '민사집행법', '국세징수법'],
              ['사유', '채권 회수', '세금 체납 압류 등'],
              ['명도', '인도명령 가능', '명도소송 필요'],
              ['사이트', 'courtauction.go.kr', 'onbid.co.kr'],
            ].map(([k, a, b]) => (
              <tr key={k} className="border-t border-gray-50">
                <td className="font-bold text-gray-500">{k}</td>
                <td>{a}</td>
                <td className="text-gray-500">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-4 pt-3 pb-5 text-[10px] leading-relaxed text-gray-400">
        관할 법원은 민사집행법 제79조(부동산 소재지 지방법원 전속관할)에 따른 것입니다. 물건
        정보·권리관계·매각기일은 반드시 법원경매정보 원문에서 확인하세요. 본 서비스는
        중개·감정평가·투자자문을 제공하지 않습니다.
      </p>
    </>
  )
}
