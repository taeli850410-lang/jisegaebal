import { NextResponse } from 'next/server'

/**
 * 정비몽땅 도면 이미지 중계.
 *
 * 왜 쿼리가 아니라 경로 세그먼트인가
 *   next/image 최적화기는 쿼리스트링이 붙은 로컬 소스를 400 으로 거부한다.
 *   (localPatterns 의 search 는 정확히 일치해야 해서 동적 쿼리를 못 쓴다)
 *   원본 경로를 base64url 로 한 세그먼트에 담으면 그 제약을 피한다.
 *
 * 왜 직접 링크하지 않는가
 *   도면이 1~2MB 라 사용자가 볼 때마다 정비몽땅을 때리게 된다.
 *   여기서 한 번 받아 오래 캐시하고, next/image 가 썸네일로 줄인다.
 *
 * 열린 프록시가 되지 않도록 정비몽땅 이미지 경로만 허용한다.
 */
export const revalidate = 86400

const HOST = 'https://cleanup.seoul.go.kr'

export function encodeImagePath(path: string): string {
  return Buffer.from(path, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function decode(token: string): string | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/')
    return Buffer.from(b64, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

export async function GET(_request: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const path = decode(token)

  if (
    !path ||
    !path.startsWith('/servlet/image') ||
    path.includes('..') ||
    // 스킴이나 호스트를 끼워 넣어 외부로 나가는 걸 막는다
    /[:\\]|\/\//.test(path.slice(1))
  ) {
    return NextResponse.json({ error: '허용되지 않은 경로입니다.' }, { status: 400 })
  }

  try {
    const res = await fetch(HOST + path, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 86400 },
    })
    if (!res.ok) return NextResponse.json({ error: `원본 ${res.status}` }, { status: 502 })

    const type = res.headers.get('content-type') ?? ''
    if (!type.startsWith('image/')) {
      return NextResponse.json({ error: '이미지가 아닙니다.' }, { status: 502 })
    }

    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': type.split(';')[0],
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: '가져오지 못했습니다.' }, { status: 502 })
  }
}
