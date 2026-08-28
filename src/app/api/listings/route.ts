import { NextResponse } from 'next/server'
import { hasSupabase, sbDelete, sbInsert, sbSelect } from '@/lib/server/supabase'

/**
 * 매물 목록 — GET/POST/DELETE /api/listings
 *
 * 우리가 어디서 긁어온 매물은 하나도 없다. 중개사·소유자가 넣은 것만 담는다.
 *
 * 아직 로그인이 없다. 그래서 아무나 쓸 수 있는 상태이고, 그 사실을 전제로
 * 설계한다 — 공개되는 건 중개사 정보가 갖춰진 것만이고, 나머지는 저장은
 * 되더라도 목록에 안 나온다. 로그인이 붙으면 소유자 검사를 여기 한 곳에
 * 추가하면 된다.
 *
 * 저장소가 없으면(키 미설정) 501 을 준다. 화면은 그걸 보고 브라우저 저장으로
 * 되돌아간다 — 조용히 실패하지 않는다.
 */

export const dynamic = 'force-dynamic'

const TABLE = 'listings'

/** 화면 모델 ↔ DB 컬럼 (스네이크) */
interface Row {
  id: string
  zone_id: string | null
  zone_name: string | null
  gu: string
  dong: string
  jibun: string
  type: string
  price: number
  exclusive_ar: number | null
  floor: number | null
  public_price: number | null
  land_share_pyeong: number | null
  land_share_source: string | null
  build_year: number | null
  purpose: string | null
  broker_office: string | null
  broker_reg_no: string | null
  broker_tel: string | null
  memo: string | null
  published: boolean
  created_at: string
}

function toClient(r: Row) {
  return {
    id: r.id,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    gu: r.gu,
    dong: r.dong,
    jibun: r.jibun,
    type: r.type,
    price: r.price,
    exclusiveAr: r.exclusive_ar,
    floor: r.floor,
    publicPrice: r.public_price,
    landSharePyeong: r.land_share_pyeong,
    landShareSource: r.land_share_source,
    buildYear: r.build_year,
    purpose: r.purpose,
    brokerOffice: r.broker_office,
    brokerRegNo: r.broker_reg_no,
    brokerTel: r.broker_tel,
    memo: r.memo ?? undefined,
    savedAt: new Date(r.created_at).getTime(),
  }
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown, max = 200) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

export async function GET(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ unavailable: 'NO_STORE', items: [] }, { status: 501 })
  }
  const zoneId = new URL(request.url).searchParams.get('zoneId')
  const q =
    `select=*&published=eq.true&order=created_at.desc&limit=200` +
    (zoneId ? `&zone_id=eq.${encodeURIComponent(zoneId)}` : '')
  const res = await sbSelect<Row>(TABLE, q)
  if (!res.ok) {
    return NextResponse.json({ unavailable: 'STORE_ERROR', items: [] }, { status: 502 })
  }
  return NextResponse.json({
    items: (res.data ?? []).map(toClient),
    _meta: {
      source: '등록 매물 (중개사·소유자 직접 등록)',
      note: '공개 목록에는 중개사무소명·등록번호·전화가 갖춰진 매물만 나옵니다 (공인중개사법 제18조의2).',
    },
  })
}

export async function POST(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ unavailable: 'NO_STORE' }, { status: 501 })
  }
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '본문이 올바르지 않습니다.' }, { status: 400 })
  }

  const gu = str(body.gu, 20)
  const dong = str(body.dong, 40)
  const jibun = str(body.jibun, 40)
  const price = num(body.price)
  if (!gu || !dong || !jibun) {
    return NextResponse.json({ error: 'gu·dong·jibun 이 필요합니다.' }, { status: 400 })
  }
  if (!price || price <= 0 || price > 1_000_000_000_000) {
    return NextResponse.json({ error: '매매가가 올바르지 않습니다.' }, { status: 400 })
  }

  const brokerOffice = str(body.brokerOffice, 80)
  const brokerRegNo = str(body.brokerRegNo, 40)
  const brokerTel = str(body.brokerTel, 40)
  /*
   * 공개 여부는 클라이언트가 정하지 않는다.
   * 중개대상물 광고는 개업공인중개사만 할 수 있고 사무소 정보를 함께 표시해야
   * 한다(공인중개사법 제18조의2). 세 값이 다 있을 때만 목록에 올린다.
   */
  const published = !!(brokerOffice && brokerRegNo && brokerTel)

  const row = {
    zone_id: str(body.zoneId, 60),
    zone_name: str(body.zoneName, 120),
    gu,
    dong,
    jibun,
    type: str(body.type, 20) ?? '기타',
    price,
    exclusive_ar: num(body.exclusiveAr),
    floor: num(body.floor),
    public_price: num(body.publicPrice),
    land_share_pyeong: num(body.landSharePyeong),
    land_share_source: str(body.landShareSource, 20),
    build_year: num(body.buildYear),
    purpose: str(body.purpose, 60),
    broker_office: brokerOffice,
    broker_reg_no: brokerRegNo,
    broker_tel: brokerTel,
    memo: str(body.memo, 500),
    published,
  }

  const res = await sbInsert<Row>(TABLE, row)
  if (!res.ok || !res.data?.[0]) {
    return NextResponse.json({ unavailable: 'STORE_ERROR' }, { status: 502 })
  }
  return NextResponse.json({ item: toClient(res.data[0]), published })
}

export async function DELETE(request: Request) {
  if (!hasSupabase()) {
    return NextResponse.json({ unavailable: 'NO_STORE' }, { status: 501 })
  }
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 가 필요합니다.' }, { status: 400 })
  /*
   * 로그인이 붙기 전까지는 누구나 지울 수 있다. 공개 전에 반드시 막아야 한다.
   * 그때 소유자 검사를 여기에 넣는다.
   */
  const res = await sbDelete(TABLE, `id=eq.${encodeURIComponent(id)}`)
  if (!res.ok) return NextResponse.json({ unavailable: 'STORE_ERROR' }, { status: 502 })
  return NextResponse.json({ ok: true })
}
