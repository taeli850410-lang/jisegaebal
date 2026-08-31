import { NextResponse } from 'next/server'
import { getBuildingIndex } from '@/lib/server/buildingIndex'
import { getPublicPrice } from '@/lib/server/housePrice'
import { hasSupabase, sbSelect } from '@/lib/server/supabase'

/**
 * 공시가격 채우기 — GET /api/cron/prices
 *
 * 왜 여기인가
 *   V-World 는 국내 IP 에서만 응답한다. GitHub Actions 러너에서 40건을
 *   시도했더니 39건이 거부됐다(주소 조회는 카카오라 39건 성공했으므로
 *   지오코딩 문제가 아니다). 우리 배포는 vercel.json 이 icn1 로 묶여 있어
 *   서울에서 돈다 — 이 API 를 부를 수 있는 곳은 여기뿐이다.
 *
 * 왜 조금씩인가
 *   함수 실행시간에 한계가 있고, 남의 API 를 몰아치면 안 된다.
 *   공시가격은 연 1회 고시라 급할 게 없다. 매일 조금씩 채우면 된다.
 *
 * 대상
 *   건축물대장에 공동주택이 있는 지번 중 아직 값을 모르는 것.
 *   단독·근생만 있는 지번은 공동주택가격 자체가 없어 부르지 않는다.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HOUSE = /공동주택|다세대|연립|아파트/
/** 한 번에 채울 지번 수 — 실행시간 안에 끝나야 한다 */
const BATCH = 60
/** 동시 호출 — 남의 API 를 몰아치지 않는다 */
const CONCURRENCY = 4

export async function GET(request: Request) {
  /*
   * Vercel 크론은 CRON_SECRET 이 있으면 Authorization 헤더에 실어 보낸다.
   * 사이트 잠금(미들웨어)은 /api/* 를 401 로 막으므로 크론도 막힌다 —
   * 그래서 미들웨어가 이 경로를 통과시키고, 대신 여기서 직접 확인한다.
   */
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: '허용되지 않습니다.' }, { status: 401 })
    }
  }

  if (!hasSupabase()) {
    /* 저장할 곳이 없으면 채워도 사라진다 — 조용히 성공한 척하지 않는다 */
    return NextResponse.json({ unavailable: 'NO_STORE' }, { status: 501 })
  }

  const url = new URL(request.url)
  const onlyGu = url.searchParams.get('gu')?.trim() || null
  const limit = Math.min(Number(url.searchParams.get('limit')) || BATCH, 200)

  /*
   * 이미 아는 지번은 건너뛴다.
   *
   * 여기서 조회가 실패하면 테이블이 없다는 뜻이다. 그걸 빈 집합으로 넘기면
   * 열심히 채우고도 하나도 안 쌓이는데 응답은 성공으로 보인다 —
   * 이 프로젝트에서 반복해 나온 실패 유형이다. 분명히 말하고 멈춘다.
   */
  const res = await sbSelect<{ lot_key: string }>('public_prices', 'select=lot_key&limit=50000')
  if (!res.ok) {
    return NextResponse.json(
      {
        unavailable: 'NO_TABLE',
        detail: res.error,
        note: 'supabase/schema.sql 의 public_prices 테이블을 Supabase SQL Editor 에서 만들어 주세요. 없으면 채워도 쌓이지 않습니다.',
      },
      { status: 501 },
    )
  }
  const known = new Set<string>((res.data ?? []).map((r) => r.lot_key))

  const bi = getBuildingIndex()
  const targets: { gu: string; dong: string; jibun: string; key: string }[] = []
  for (const [key, v] of Object.entries(bi)) {
    const [gu, dong, num] = key.split('|')
    if (!gu || !dong || !num) continue
    if (onlyGu && gu !== onlyGu) continue
    if (!HOUSE.test(v.buildings.map((b) => b.purpose).join(' '))) continue
    const bon = Number(num.slice(0, 4))
    const bu = Number(num.slice(4))
    const jibun = bu ? `${bon}-${bu}` : String(bon)
    const lotKey = `${gu}|${dong}|${jibun}`
    if (known.has(lotKey)) continue
    targets.push({ gu, dong, jibun, key: lotKey })
    if (targets.length >= limit) break
  }

  let found = 0
  let none = 0
  let failed = 0
  const started = Date.now()

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    /* 실행시간이 바닥나면 지금까지 채운 것만 남기고 끝낸다 */
    if (Date.now() - started > 45_000) break
    const slice = targets.slice(i, i + CONCURRENCY)
    const out = await Promise.all(
      slice.map(async (t) => {
        try {
          /*
           * getPublicPrice 가 조회하면서 Supabase 에 적어 준다.
           * 면적은 아무 값이나 넣어도 지번 단위 조회는 같다 — 여기서는
           * 값을 쓰려는 게 아니라 캐시를 채우는 게 목적이다.
           */
          const r = await getPublicPrice(t.gu, t.dong, t.jibun, 30)
          return r ? 'found' : 'none'
        } catch {
          return 'failed'
        }
      }),
    )
    for (const o of out) {
      if (o === 'found') found++
      else if (o === 'none') none++
      else failed++
    }
  }

  return NextResponse.json({
    gu: onlyGu ?? '서울 전체',
    남은대상: targets.length,
    확보: found,
    가격없음: none,
    실패: failed,
    소요초: Math.round((Date.now() - started) / 100) / 10,
    _meta: {
      note:
        '공동주택 공시가격(V-World getApartHousingPriceAttr)을 조금씩 받아 Supabase 에 쌓습니다. ' +
        'V-World 는 국내 IP 에서만 응답하므로 서울(icn1) 리전에서만 동작합니다.',
    },
  })
}
