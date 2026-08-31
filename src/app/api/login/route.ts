import { NextResponse } from 'next/server'
import { COOKIE, MAX_AGE, sign } from '@/lib/siteLock'

/**
 * 로그인 — POST /api/login
 *
 * 평범한 form 전송(application/x-www-form-urlencoded)과 JSON 을 둘 다 받는다.
 * 로그인은 들어오는 유일한 문이라 스크립트가 없어도 열려야 한다.
 *
 * 비밀번호 자체는 쿠키에 담지 않는다. 만료시각을 HMAC 으로 서명한 값만 오간다.
 *
 * 틀린 비밀번호에는 잠깐 쉬었다 답한다. 안 그러면 초당 수천 번 찔러
 * 맞을 때까지 돌릴 수 있다.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let fails = 0
let windowStart = Date.now()

/** 열린 리다이렉트가 되지 않게 우리 경로만 받는다 */
function safePath(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  return s.startsWith('/') && !s.startsWith('//') ? s : '/'
}

export async function POST(request: Request) {
  const secret = process.env.SITE_PASSWORD
  const ct = request.headers.get('content-type') ?? ''
  const isForm = ct.includes('form-urlencoded') || ct.includes('multipart/form-data')

  let password = ''
  let next = '/'
  try {
    if (isForm) {
      const f = await request.formData()
      password = String(f.get('password') ?? '')
      next = safePath(f.get('next'))
    } else {
      const j = (await request.json()) as { password?: unknown; next?: unknown }
      password = String(j.password ?? '')
      next = safePath(j.next)
    }
  } catch {
    return isForm
      ? NextResponse.redirect(new URL('/login?e=1', request.url), 303)
      : NextResponse.json({ error: '요청이 올바르지 않습니다.' }, { status: 400 })
  }

  const fail = (status: number, msg: string, code: string) =>
    isForm
      ? NextResponse.redirect(
          new URL(`/login?e=${code}&next=${encodeURIComponent(next)}`, request.url),
          303,
        )
      : NextResponse.json({ error: msg }, { status })

  if (!secret) return fail(503, '잠금이 설정되지 않았습니다.', '1')

  /* 1분에 10번 넘게 틀리면 그 창이 끝날 때까지 받지 않는다 */
  const now = Date.now()
  if (now - windowStart > 60_000) {
    windowStart = now
    fails = 0
  }
  if (fails >= 10) return fail(429, '시도가 너무 잦습니다. 잠시 후 다시 해주세요.', '429')

  if (password !== secret) {
    fails++
    await new Promise((r) => setTimeout(r, 700))
    return fail(401, '비밀번호가 맞지 않습니다.', '1')
  }

  const res = isForm
    ? NextResponse.redirect(new URL(next, request.url), 303)
    : NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, await sign(secret, Date.now() + MAX_AGE * 1000), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  })
  return res
}

/** 로그아웃 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
