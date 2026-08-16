import { NextResponse } from 'next/server'

/**
 * 카카오맵 SDK 진단 엔드포인트
 *
 * 브라우저에서 <script> 로드가 실패하면 onerror만 발생할 뿐 응답 본문을 읽을 수 없어
 * "왜 실패했는지"를 알 수 없다. 그래서 서버가 동일한 Referer로 SDK를 대신 호출해
 * 카카오가 내려주는 실제 오류 메시지를 읽어 프론트에 전달한다.
 *
 * 가장 흔한 원인:
 *   {"errorType":"AccessDeniedError","message":"domain mismatched! caller=... "}
 *   → 카카오 개발자 콘솔 > 앱 설정 > 플랫폼 > Web 에 해당 도메인 미등록
 */

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const origin = new URL(request.url).origin
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY

  if (!appKey) {
    return NextResponse.json({
      ok: false,
      code: 'NO_KEY',
      origin,
      message: '.env.local 에 NEXT_PUBLIC_KAKAO_MAP_JS_KEY 가 없습니다.',
    })
  }

  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`,
      { headers: { Referer: `${origin}/` }, cache: 'no-store' },
    )
    const body = await res.text()

    // 정상이면 자바스크립트가, 실패하면 JSON이 내려온다
    if (res.ok && !body.trimStart().startsWith('{')) {
      return NextResponse.json({ ok: true, code: 'OK', origin, status: res.status })
    }

    let parsed: { errorType?: string; message?: string } = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = { message: body.slice(0, 200) }
    }

    const isDomain = /domain mismatched/i.test(parsed.message ?? '')

    return NextResponse.json({
      ok: false,
      code: isDomain ? 'DOMAIN_NOT_REGISTERED' : (parsed.errorType ?? 'UNKNOWN'),
      origin,
      status: res.status,
      message: parsed.message ?? '알 수 없는 오류',
    })
  } catch (e) {
    return NextResponse.json({
      ok: false,
      code: 'NETWORK',
      origin,
      message: e instanceof Error ? e.message : '네트워크 오류',
    })
  }
}
