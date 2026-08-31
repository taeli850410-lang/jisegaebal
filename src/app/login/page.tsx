/**
 * 잠금 화면.
 *
 * 자바스크립트 없이 도는 평범한 form 이다. 로그인은 들어오는 유일한 문이라
 * 스크립트가 막히거나 늦게 뜨는 상황에서도 열려야 한다.
 * (실제로 어떤 브라우저는 비밀번호 입력 페이지의 스크립트를 막는다.)
 *
 * 무엇을 지키는지도 밝힌다 — 그냥 "비밀번호"만 물으면 왜 막혔는지 알 수 없다.
 */

export const dynamic = 'force-dynamic'

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; e?: string }>
}) {
  const { next, e } = await searchParams
  /* 열린 리다이렉트가 되지 않게 우리 경로만 받는다 */
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

  const message =
    e === '1'
      ? '비밀번호가 맞지 않습니다.'
      : e === '429'
        ? '시도가 너무 잦습니다. 잠시 후 다시 해주세요.'
        : null

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gray-50 px-5">
      <form method="POST" action="/api/login" className="w-full max-w-sm">
        <input type="hidden" name="next" value={safeNext} />

        <div className="mb-5 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
            정
          </span>
          <h1 className="text-base font-bold text-gray-900">정비사업 정보 플랫폼</h1>
        </div>

        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-900">
          이 사이트에는 <b>매물 호가</b>가 들어 있어 비공개로 두었습니다. 중개대상물 광고는
          개업공인중개사만 할 수 있습니다(공인중개사법 제18조의2).
        </p>

        <label className="block">
          <span className="text-[11px] text-gray-500">비밀번호</span>
          <input
            type="password"
            name="password"
            autoFocus
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>

        {message && <p className="mt-2 text-[11px] font-bold text-rose-600">{message}</p>}

        <button
          type="submit"
          className="mt-3 w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          들어가기
        </button>
      </form>
    </div>
  )
}
