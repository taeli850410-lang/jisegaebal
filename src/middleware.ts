import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { COOKIE, valid } from '@/lib/siteLock'

/**
 * 사이트 잠금.
 *
 * 여기 매물에는 호가가 들어간다. 호가는 공개해서 좋을 게 없다 —
 * 중개대상물 광고는 개업공인중개사만 할 수 있고(공인중개사법 제18조의2),
 * 우리가 그걸 공개로 띄우면 광고가 된다. 그래서 통째로 잠근다.
 *
 * Vercel 의 배포 보호(Vercel Authentication)를 쓰려 했는데 Hobby 플랜은
 * 프로덕션에 걸 수 없다고 거부한다. 그래서 앱에서 막는다.
 *
 * 화면만 막으면 소용이 없다. /api/* 를 그대로 두면 주소만 알면 매물을
 * 다 읽어갈 수 있다. 그래서 정적 파일을 뺀 전부를 막는다.
 *
 * 비밀번호가 없으면 열지 않고 닫는다. 설정이 빠졌을 때 조용히 공개되는
 * 것보다 안 열리는 편이 낫다 — 잠그려고 만든 것이기 때문이다.
 */

export async function middleware(req: NextRequest) {
  const secret = process.env.SITE_PASSWORD
  const { pathname } = req.nextUrl

  // 로그인 화면과 로그인 처리는 잠그면 안 된다 — 들어올 문이 막힌다
  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next()

  /*
   * 크론은 쿠키를 들고 오지 않는다. 여기서 막으면 Vercel 크론이 401 만 받는다.
   * 대신 그 라우트가 CRON_SECRET 을 직접 확인한다 — 잠금을 푼 게 아니라
   * 다른 열쇠를 쓰는 것이다.
   */
  if (pathname.startsWith('/api/cron/')) return NextResponse.next()

  if (!secret) {
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><body style="font:15px/1.7 system-ui;padding:3rem;max-width:34rem;margin:auto">' +
        '<h1 style="font-size:1.1rem">잠금이 설정되지 않았습니다</h1>' +
        '<p>이 사이트에는 호가가 들어 있어 비밀번호 없이는 열지 않습니다.<br>' +
        'Vercel 환경변수에 <code>SITE_PASSWORD</code> 를 넣고 다시 배포하세요.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }

  if (await valid(req.cookies.get(COOKIE)?.value, secret)) return NextResponse.next()

  // API 는 로그인 화면으로 보내 봐야 소용없다 — 401 로 분명히 말한다
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const to = req.nextUrl.clone()
  to.pathname = '/login'
  to.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
  return NextResponse.redirect(to)
}

export const config = {
  /* 정적 파일과 파비콘만 뺀다 */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
}
