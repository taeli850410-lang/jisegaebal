-- 매물 테이블
--
-- 우리가 어디서 긁어온 매물은 하나도 없다. 중개사·소유자가 직접 넣은 것만 담는다.
-- 공시가·대지지분·용도는 등록 시점에 우리가 공공데이터로 붙여 함께 저장한다
-- (나중에 공시가가 바뀌어도 그때 본 값이 남아 있어야 판단 근거가 보존된다).
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run

create table if not exists public.listings (
  id                uuid primary key default gen_random_uuid(),

  -- 어느 구역인가
  zone_id           text,
  zone_name         text,

  -- 물건
  gu                text not null,
  dong              text not null,
  jibun             text not null,
  type              text not null default '기타',
  price             bigint not null check (price > 0),
  exclusive_ar      numeric,
  floor             integer,

  -- 등록 시점에 공공데이터로 붙인 값
  public_price      bigint,
  land_share_pyeong numeric,
  land_share_source text,
  build_year        integer,
  purpose           text,

  -- 공인중개사법 제18조의2 — 중개대상물 광고에는 사무소 정보가 함께 있어야 한다
  broker_office     text,
  broker_reg_no     text,
  broker_tel        text,

  memo              text,

  -- 세 값이 다 있을 때만 공개 목록에 나온다. 서버가 정하고 클라이언트는 못 바꾼다.
  published         boolean not null default false,

  created_at        timestamptz not null default now()
);

create index if not exists listings_zone_idx on public.listings (zone_id, created_at desc);
create index if not exists listings_pub_idx  on public.listings (published, created_at desc);

-- RLS 를 켜고 정책을 두지 않는다.
-- 우리 서버 라우트는 service_role 로 붙어 RLS 를 통과하고,
-- 혹시 anon 키가 새더라도 이 테이블은 읽지도 쓰지도 못한다.
alter table public.listings enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 공동주택 공시가격 캐시
--
-- 왜 DB 인가
--   V-World 는 국내 IP 에서만 응답한다. GitHub Actions 러너는 해외라
--   40건 중 39건이 거부됐다 — 그래서 수집을 서울(icn1)에서 도는 우리
--   배포 안으로 옮겼다. 그런데 서버리스 디스크는 읽기 전용이라 받은 값을
--   파일에 못 쌓는다. 그 자리를 이 테이블이 맡는다.
--
--   공시가격은 연 1회 고시라 한 번 채우면 거의 안 바뀐다.
--   그래서 캐시로 두기에 알맞다.
--
-- 키
--   lot_key = '용산구|서계동|245-11' — 디스크 캐시와 같은 형식이라
--   둘을 섞어 읽을 수 있다.
create table if not exists public_prices (
  lot_key    text primary key,
  year       int,
  -- [전용면적㎡, 공시가격원, 지하여부] 목록. 값이 없으면 빈 배열이 아니라
  -- null 로 둔다 — "조회했더니 없음"과 "아직 안 봤음"을 구별해야 한다.
  units      jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists public_prices_updated_idx on public_prices (updated_at desc);

-- listings 와 같은 이유로 RLS 를 켜고 정책을 두지 않는다.
-- anon 키로는 아무것도 못 하고, 서버 라우트만 service_role 로 접근한다.
alter table public_prices enable row level security;
