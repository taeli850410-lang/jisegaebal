import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '정비사업 정보 플랫폼',
  description: '재개발·재건축 구역별 실거래, 진행현황, 매물, 경매 정보',
}

/**
 * viewport 메타가 없으면 모바일 브라우저는 화면을 가짜 980px 로 잡고
 * 두 손가락 제스처를 "페이지 확대"로 먹어버린다 — 지도까지 내려오질 않는다.
 * 실제 화면 폭으로 그리게 하고 핀치를 지도에 넘긴다.
 *
 * maximumScale 을 막지 않는다. 페이지 확대는 저시력 사용자의 유일한 확대 수단이라
 * 지도 핀치를 살리자고 그걸 잠그면 안 된다. 지도 위에서는 컨테이너의
 * touch-action 이 제스처를 가져가므로 둘이 부딪히지 않는다.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  )
}
