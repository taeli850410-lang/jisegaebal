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

/** 특정 Referer로 SDK를 요청해 해당 도메인이 등록돼 있는지 판별한다 */
async function probe(appKey: string, origin: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`,
      { headers: { Referer: `${origin}/` }, cache: 'no-store' },
    )
    if (!res.ok) return false
    const body = await res.text()
    return !body.trimStart().startsWith('{')
  } catch {
    return false
  }
}

/**
 * 자주 헷갈리는 후보들.
 * 특히 github.com — 소스코드 보관처를 앱 실행 주소로 착각해 등록하는 사례가 많다.
 */
const COMMON_MISTAKES = ['https://github.com', 'https://taeli850410-lang.github.io']

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

    // 실패했다면, 흔히 잘못 등록하는 도메인들이 등록돼 있는지 함께 알려준다.
    // "등록은 분명히 했는데 왜 안 되지?"를 즉시 해소하기 위함이다.
    const misregistered = isDomain
      ? (
          await Promise.all(
            COMMON_MISTAKES.map(async (o) => ((await probe(appKey, o)) ? o : null)),
          )
        ).filter((o): o is string => o !== null)
      : []

    return NextResponse.json({
      ok: false,
      code: isDomain ? 'DOMAIN_NOT_REGISTERED' : (parsed.errorType ?? 'UNKNOWN'),
      origin,
      status: res.status,
      message: parsed.message ?? '알 수 없는 오류',
      misregistered,
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
