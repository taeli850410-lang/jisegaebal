-- 0005. 중개사 워크스페이스 (원칙 7 — 경량화)
-- 계약서 7종·회계 결산은 스코프 제외(v2 이연). 담당구역·상담고객·브리핑만.
-- 명세 §2.8

create table broker_offices (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  broker_reg_no text,
  phone        text,
  address      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

select attach_updated_at('broker_offices');

create table broker_profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  office_id  uuid not null references broker_offices(id) on delete cascade,
  name       text not null,
  role       text not null default 'agent' check (role in ('admin','agent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index broker_profiles_office_idx on broker_profiles (office_id);

select attach_updated_at('broker_profiles');

-- 매물의 중개사무소 FK (0003 에서 컬럼만 만들어 두었다)
alter table listings
  add constraint listings_broker_office_fk
  foreign key (broker_office_id) references broker_offices(id) on delete set null;

-- 담당 구역 — 구역 상세에 "이 구역 전문 중개사" 카드로 노출
create table zone_assignments (
  id         uuid primary key default gen_random_uuid(),
  office_id  uuid not null references broker_offices(id) on delete cascade,
  zone_id    uuid not null references zones(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (office_id, zone_id)
);

create index zone_assignments_zone_idx on zone_assignments (zone_id) where deleted_at is null;

select attach_updated_at('zone_assignments');

-- 상담 고객 — 계약서·금전관리 없음 (원칙 7)
-- 이름·연락처는 마스킹해 표시하지만 저장은 사무소 격리(RLS)로 보호한다.
create table consult_customers (
  id                uuid primary key default gen_random_uuid(),
  office_id         uuid not null references broker_offices(id) on delete cascade,
  name              text not null,
  phone             text,
  class_code        text,                 -- codes(customer_class)
  interested_zone_id uuid references zones(id) on delete set null,
  memo              text,
  manager_id        uuid references broker_profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create index consult_customers_office_idx on consult_customers (office_id) where deleted_at is null;

select attach_updated_at('consult_customers');

-- 브리핑 문서 — 구역개요+단계+감정가+시뮬 결과 스냅샷을 1클릭 생성
create table briefing_documents (
  id           uuid primary key default gen_random_uuid(),
  office_id    uuid not null references broker_offices(id) on delete cascade,
  zone_id      uuid not null references zones(id) on delete cascade,
  zone_unit_id uuid references zone_units(id) on delete set null,
  simulation_id uuid references rights_simulations(id) on delete set null,
  title        text not null,
  body_html    text not null,
  share_token  text unique,
  created_by   uuid references broker_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index briefing_documents_office_idx on briefing_documents (office_id, created_at desc);

select attach_updated_at('briefing_documents');
