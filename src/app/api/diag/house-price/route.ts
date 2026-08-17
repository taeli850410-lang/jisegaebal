import { NextResponse } from 'next/server'

/**
 * 공시가격 경로 진단.
 *
 * 로컬에서는 값이 나오는데 운영에서만 비는 경우가 있어, 어느 단계에서 끊기는지
 * 그대로 드러낸다. 키 값은 노출하지 않고 존재 여부와 원문 응답 앞부분만 보여준다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  const kakao = process.env.KAKAO_REST_API_KEY
  const vkey = process.env.VWORLD_API_KEY
  const vdom = process.env.VWORLD_DOMAIN

  const out: Record<string, unknown> = {
    env: {
      KAKAO_REST_API_KEY: kakao ? `있음(${kakao.length}자)` : '없음',
      VWORLD_API_KEY: vkey ? `있음(${vkey.length}자)` : '없음',
      VWORLD_DOMAIN: vdom ?? '없음',
    },
  }

  // ① 카카오 주소검색 → PNU
  try {
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent('서울 강동구 성내동 47-16')}`,
      { headers: { Authorization: `KakaoAK ${kakao}` }, cache: 'no-store' },
    )
    const t = await r.text()
    const a = JSON.parse(t).documents?.[0]?.address
    out.kakao = {
      status: r.status,
      b_code: a?.b_code ?? null,
      본번: a?.main_address_no ?? null,
      부번: a?.sub_address_no ?? null,
      raw: a ? undefined : t.slice(0, 200),
    }
  } catch (e) {
    out.kakao = { error: String(e) }
  }

  // ② V-World 공동주택가격 (PNU 고정)
  const pnu = '1174010900101330004' // 강동구 천호동 133-4
  for (const dom of [vdom, 'https://jisegaebal.vercel.app', '']) {
    const label = dom ? `domain=${dom}` : 'domain 없음'
    try {
      const url =
        `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?key=${vkey}` +
        (dom ? `&domain=${encodeURIComponent(dom)}` : '') +
        `&format=json&numOfRows=3&pageNo=1&pnu=${pnu}`
      const r = await fetch(url, { cache: 'no-store' })
      const t = await r.text()
      out[`vworld[${label}]`] = { status: r.status, body: t.replace(/\s+/g, ' ').slice(0, 220) }
    } catch (e) {
      out[`vworld[${label}]`] = { error: String(e) }
    }
  }

  return NextResponse.json(out)
}
