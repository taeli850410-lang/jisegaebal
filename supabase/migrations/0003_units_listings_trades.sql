-- 0003. 구역 내 물건 · 매물 · 실거래
-- 명세 §2.3 §2.4 §2.5

-- ─────────────────────────────────────────────────────────────
-- 구역 내 물건 — "AI 감정 순위"(원칙 5)의 기반 데이터
-- ─────────────────────────────────────────────────────────────
create table zone_units (
  id                uuid primary key default gen_random_uuid(),
  zone_id           uuid not null references zones(id) on delete cascade,
  unit_type_code    text not null,            -- codes(unit_type)
  right_type_code   text,                     -- codes(right_type)

  address           text not null,            -- 지번
  building_name     text,
  dong              text,
  ho                text,

  land_area         numeric(12,2),            -- 대지면적 ㎡
  -- 대지지분 — 재개발 투자가치의 핵심 지표. 평당가 계산의 분모.
  land_share        numeric(12,2),
  building_area     numeric(12,2),

  -- 관리처분인가 이후 확정. 그 전엔 null 이고 추정치를 별도 표기한다(D-05).
  appraisal_price   bigint,                   -- 원
  official_price    bigint,                   -- 공시가격, ho-finder 연동
  -- 감정가가 없을 때 공시가 × 지역배율로 만든 추정치. 반드시 "추정" 배지와 함께 노출.
  estimated_appraisal_price bigint,

  pnu               text,                     -- vworld 필지고유번호 (건축물대장 연동 키)
  build_year        int,
  source            text not null default 'manual'
                    check (source in ('building_register','manual','user_report','molit')),
  last_verified_at  timestamptz,
  is_draft          boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index zone_units_zone_idx on zone_units (zone_id) where deleted_at is null;
create index zone_units_pnu_idx  on zone_units (pnu) where pnu is not null;
create index zone_units_appraisal_idx on zone_units (zone_id, appraisal_price desc nulls last);

select attach_updated_at('zone_units');

-- 소유자 — 실명·연락처는 저장하지 않는다 (D-04, 명세 §6)
create table unit_owners (
  id              uuid primary key default gen_random_uuid(),
  zone_unit_id    uuid not null references zone_units(id) on delete cascade,
  owner_type_code text not null,              -- 개인 | 법인 | 국공유
  is_resident     boolean,                    -- 거주 여부 (통계용)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

select attach_updated_at('unit_owners');

-- ─────────────────────────────────────────────────────────────
-- 매물
-- ─────────────────────────────────────────────────────────────
create table listings (
  id               uuid primary key default gen_random_uuid(),
  zone_id          uuid not null references zones(id) on delete cascade,
  zone_unit_id     uuid references zone_units(id) on delete set null,

  trade_type_code  text not null default '매매',   -- 매매 | 분양권
  -- 금액은 만원 단위 정수 (D-02)
  asking_price     bigint not null,
  -- 호가 − 감정가(또는 추정 대지가치). 자동 분해하되 사용자가 직접 조정할 수 있다.
  premium          bigint,
  land_share       numeric(12,2),

  description      text,
  status           text not null default '공개중'
                   check (status in ('공개중','거래중','거래완료','만료')),

  registered_by    uuid references auth.users(id) on delete set null,
  broker_office_id uuid,     -- 0005 에서 FK 추가 (테이블 생성 순서)
  -- 연락처는 "문의하기" 클릭 시에만 노출한다 (명세 §6). 목록 응답에 포함 금지.
  contact_phone    text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create index listings_zone_idx   on listings (zone_id, status) where deleted_at is null;
create index listings_unit_idx   on listings (zone_unit_id) where zone_unit_id is not null;
create index listings_price_idx  on listings (zone_id, premium nulls last);

select attach_updated_at('listings');

create table listing_photos (
  id         uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index listing_photos_listing_idx on listing_photos (listing_id, sort_order);

select attach_updated_at('listing_photos');

-- ─────────────────────────────────────────────────────────────
-- 실거래 (국토부)
-- ─────────────────────────────────────────────────────────────
create table trades (
  id            uuid primary key default gen_random_uuid(),
  zone_id       uuid references zones(id) on delete set null,
  zone_unit_id  uuid references zone_units(id) on delete set null,

  raw_address   text not null,
  -- 지오코딩 결과. 구역 매칭은 이 점을 ST_Contains 로 판정한다 (D-06).
  point         geometry(Point, 4326),

  deal_date     date not null,
  price         bigint not null,              -- 만원
  land_share    numeric(12,2),
  building_area numeric(12,2),
  exclusive_area numeric(12,2),
  build_year    int,
  floor         int,

  deal_type     text not null default '매매'
                check (deal_type in ('매매','분양권전매')),
  unit_type_code text,                        -- 다세대 | 단독 | 토지 …
  is_direct     boolean not null default false,

  source        text not null default 'molit_api',
  molit_raw     jsonb,                        -- 원본 보관 — 재매칭용

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index trades_zone_date_idx on trades (zone_id, deal_date desc);
create index trades_point_gix     on trades using gist (point);
-- 동일 신고건 중복 적재 방지
create unique index trades_dedupe_idx
  on trades (raw_address, deal_date, price, coalesce(exclusive_area, 0));

select attach_updated_at('trades');

-- 구역 매칭 실패 큐 — 관리자가 수동 매칭 (명세 §2.5)
create table unmatched_trades (
  id          uuid primary key default gen_random_uuid(),
  trade_id    uuid not null references trades(id) on delete cascade,
  reason      text not null,   -- geocode_failed | outside_all_zones
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index unmatched_trades_open_idx on unmatched_trades (resolved_at) where resolved_at is null;

select attach_updated_at('unmatched_trades');
