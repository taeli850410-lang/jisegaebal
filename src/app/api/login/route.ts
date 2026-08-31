import { NextResponse } from 'next/server'
import { COOKIE, MAX_AGE, sign } from '@/lib/siteLock'

/**
 * 로그인 — POST /api/login
 *
 * 비밀번호를 확인하고 서명 쿠키를 굽는다. 비밀번호 자체는 쿠키에 안 담는다.
 *
 * 틀린 비밀번호에는 잠깐 쉬었다 답한다. 안 그러면 초당 수천 번 찔러
 * 맞출 때까지 돌릴 수 있다.
 */

export const runtime = 'nodejs'

let recentFails = 0
let windowStart = Date.now()

export async function POST(request: Request) {
  const secret = process.env.SITE_PASSWORD
  if (!secret) {
    return NextResponse.json({ error: '잠금이 설정되지 않았습니다.' }, { status: 503 })
  }

  let password = ''
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? '')
  } catch {
    return NextResponse.json({ error: '요청이 올바르지 않습니다.' }, { status: 400 })
  }

  /* 1분에 10번 넘게 틀리면 그 창이 끝날 때까지 받지 않는다 */
  const now = Date.now()
  if (now - windowStart > 60_000) {
    windowStart = now
    recentFails = 0
  }
  if (recentFails >= 10) {
    return NextResponse.json({ error: '시도가 너무 잦습니다. 잠시 후 다시 해주세요.' }, { status: 429 })
  }

  if (password !== secret) {
    recentFails++
    await new Promise((r) => setTimeout(r, 700))
    return NextResponse.json({ error: '비밀번호가 맞지 않습니다.' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
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
