import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '정비사업 정보 플랫폼',
  description: '재개발·재건축 구역별 실거래, 진행현황, 매물, 경매 정보',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  )
}
