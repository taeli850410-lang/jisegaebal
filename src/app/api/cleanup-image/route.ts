import { NextResponse } from 'next/server'

/**
 * 정비몽땅 도면 이미지 중계.
 *
 * 왜 직접 링크하지 않는가
 *  - 사용자 브라우저가 볼 때마다 정비몽땅을 직접 때리게 된다. 도면이 1~2MB라
 *    남의 서버에 부담을 준다. 여기서 한 번 받아 오래 캐시한다.
 *  - 참조 경로가 /servlet/image?url=... 와 /servlet/image/... 두 가지라
 *    한 곳에서 흡수하는 편이 낫다.
 *
 * 열린 프록시가 되지 않도록 정비몽땅 이미지 경로만 허용한다.
 */
export const revalidate = 86400

const HOST = 'https://cleanup.seoul.go.kr'
const ALLOWED = /^\/servlet\/image(\?url=)?[/A-Za-z0-9._%=&-]*$/

export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path가 필요합니다.' }, { status: 400 })

  // 외부 호스트로 새어나가지 않게 한다 — 경로만 받는다
  if (!path.startsWith('/servlet/image') || !ALLOWED.test(path) || path.includes('..')) {
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
        // 도면은 인가 때마다 바뀌는 정도라 하루면 충분하다
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    })
  } catch {
    return NextResponse.json({ error: '가져오지 못했습니다.' }, { status: 502 })
  }
}
