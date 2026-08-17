import { NextResponse } from 'next/server'

/**
 * V-World 접근 진단 (운영 전용 임시).
 *
 * 로컬(국내)에서는 200 인데 Vercel 에서만 502 가 난다.
 * 키·도메인 파라미터는 같으므로, 요청 모양(헤더·프로토콜·호스트)에 따라
 * 달라지는지 한 번에 확인한다.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PNU = '1174010900101330004' // 강동구 천호동 133-4

export async function GET() {
  const key = process.env.VWORLD_API_KEY
  const dom = process.env.VWORLD_DOMAIN ?? 'https://jisegaebal.vercel.app'
  if (!key) return NextResponse.json({ error: 'VWORLD_API_KEY 없음' }, { status: 500 })

  const qs =
    `key=${key}&domain=${encodeURIComponent(dom)}&format=json&numOfRows=3&pageNo=1&pnu=${PNU}`

  const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

  const cases: { label: string; url: string; init?: RequestInit }[] = [
    { label: 'https 기본', url: `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?${qs}` },
    {
      label: 'https + UA',
      url: `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?${qs}`,
      init: { headers: { 'User-Agent': UA } },
    },
    {
      label: 'https + UA + Referer',
      url: `https://api.vworld.kr/ned/data/getApartHousingPriceAttr?${qs}`,
      init: { headers: { 'User-Agent': UA, Referer: dom, Origin: dom } },
    },
    { label: 'http 기본', url: `http://api.vworld.kr/ned/data/getApartHousingPriceAttr?${qs}` },
    {
      label: 'http + UA',
      url: `http://api.vworld.kr/ned/data/getApartHousingPriceAttr?${qs}`,
      init: { headers: { 'User-Agent': UA } },
    },
    // 다른 V-World 서비스로 접근 자체가 되는지 대조
    {
      label: '대조: WFS 연속지적도',
      url:
        `https://api.vworld.kr/req/wfs?SERVICE=WFS&REQUEST=GetFeature&VERSION=1.1.0` +
        `&TYPENAME=lp_pa_cbnd_bubun&SRSNAME=EPSG:4326&OUTPUT=application/json&MAXFEATURES=2` +
        `&BBOX=126.915,37.583,126.919,37.587&key=${key}&domain=${encodeURIComponent(dom)}`,
      init: { headers: { 'User-Agent': UA } },
    },
    {
      label: '대조: 개별공시지가',
      url: `https://api.vworld.kr/ned/data/getIndvdLandPriceAttr?${qs}`,
      init: { headers: { 'User-Agent': UA } },
    },
  ]

  const out: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? '(로컬)' }

  for (const c of cases) {
    const t0 = Date.now()
    try {
      const r = await fetch(c.url, { cache: 'no-store', ...(c.init ?? {}) })
      const body = await r.text()
      out[c.label] = {
        status: r.status,
        ms: Date.now() - t0,
        body: body.replace(/\s+/g, ' ').slice(0, 130),
      }
    } catch (e) {
      out[c.label] = { error: String(e).slice(0, 160), ms: Date.now() - t0 }
    }
  }

  return NextResponse.json(out)
}
