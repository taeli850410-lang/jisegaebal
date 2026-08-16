-- 0002. 정비구역 ★핵심 엔티티 (원칙 1)
-- 명세 §2.2

create table zones (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  project_type_code       text not null,   -- codes(project_type).value
  current_stage_code      text,            -- codes(project_stage).value
  -- 행정구역
  city                    text not null default '서울특별시',
  gu                      text,
  dong                    text,
  -- 경계 (PostGIS). SRID 4326 고정 — 원본이 EPSG:5174 여도 적재 전에 변환한다.
  boundary                geometry(MultiPolygon, 4326),
  center_lat              double precision,
  center_lng              double precision,

  area_total              numeric(14,2),   -- 구역면적 ㎡
  household_count_planned int,             -- 계획세대수
  building_count          int,             -- 기존 건축물 수

  association_name        text,
  association_est_date    date,

  -- 원칙 8: 출처와 갱신일을 항상 들고 다닌다
  data_source             text not null default 'manual'
                          check (data_source in ('clean_up_system','manual','scraped','user_report')),
  last_verified_at        timestamptz,

  -- 가상구역 (원칙 6)
  is_virtual              boolean not null default false,
  created_by              uuid references auth.users(id) on delete set null,
  -- 관리자 승인 전에는 비공개 (명세 §6, D-07)
  is_draft                boolean not null default false,

  -- 배치로 캐시하는 집계값(감정가 평균/최고/최저, 평균 프리미엄 등)
  summary_stats           jsonb not null default '{}'::jsonb,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

-- 지도 뷰포트 조회가 가장 잦은 쿼리라 공간 인덱스는 필수
create index zones_boundary_gix  on zones using gist (boundary);
create index zones_type_idx      on zones (project_type_code) where deleted_at is null;
create index zones_stage_idx     on zones (current_stage_code) where deleted_at is null;
create index zones_region_idx    on zones (city, gu, dong) where deleted_at is null;
create index zones_public_idx    on zones (is_draft, is_virtual) where deleted_at is null;
-- 구역명 부분검색(fuzzy) 대비
create index zones_name_trgm_idx on zones using gin (name gin_trgm_ops);

select attach_updated_at('zones');

-- ─────────────────────────────────────────────────────────────
-- 사업단계 이력 ★원칙 2 — "이 구역이 최근 얼마나 빨리 진행되는지"의 근거
-- ─────────────────────────────────────────────────────────────
create table zone_stage_history (
  id           uuid primary key default gen_random_uuid(),
  zone_id      uuid not null references zones(id) on delete cascade,
  stage_code   text not null,
  changed_at   date not null,
  -- 지자체 원본 라벨을 그대로 보존한다 (D-03).
  -- 정비몽땅은 유형별로 라벨 체계가 달라 12단계로 1:1 매핑되지 않는다.
  source_note  text,
  document_url text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (zone_id, stage_code, changed_at)
);

create index zone_stage_history_zone_idx on zone_stage_history (zone_id, changed_at desc);

select attach_updated_at('zone_stage_history');

-- ─────────────────────────────────────────────────────────────
-- 가상구역 경계 편집 이력 — 잘못 그렸을 때 되돌리기 (명세 §2.2)
-- ─────────────────────────────────────────────────────────────
create table zone_boundary_edits (
  id         uuid primary key default gen_random_uuid(),
  zone_id    uuid not null references zones(id) on delete cascade,
  geometry   geometry(MultiPolygon, 4326) not null,
  edited_by  uuid references auth.users(id) on delete set null,
  edited_at  timestamptz not null default now(),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index zone_boundary_edits_zone_idx on zone_boundary_edits (zone_id, edited_at desc);

select attach_updated_at('zone_boundary_edits');
