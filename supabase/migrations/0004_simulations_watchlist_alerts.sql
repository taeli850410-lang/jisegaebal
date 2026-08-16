-- 0004. 권리분석 시뮬레이터 · 관심 · 알림
-- 명세 §2.6 §2.7 §2.9

-- ─────────────────────────────────────────────────────────────
-- 구역별 비례율 참고치 — 조합 확정 전이므로 "예상치"임을 항상 표기 (원칙 8)
-- ─────────────────────────────────────────────────────────────
create table bijul_presets (
  id          uuid primary key default gen_random_uuid(),
  zone_id     uuid not null references zones(id) on delete cascade,
  bijul_low   numeric(6,2),     -- %
  bijul_mid   numeric(6,2),
  bijul_high  numeric(6,2),
  -- 3.3㎡당 조합원 분양가 참고치 (만원)
  member_price_per_pyeong bigint,
  note        text,
  updated_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (zone_id)
);

select attach_updated_at('bijul_presets');

-- ─────────────────────────────────────────────────────────────
-- 내 시나리오 (원칙 3 — 정적 표가 아니라 저장 가능한 시뮬레이션)
-- 계산값도 함께 저장한다: 공유링크로 연 사람에게 당시 결과를 그대로 보여줘야 하고,
-- 나중에 비례율 참고치가 바뀌어도 저장 시점 값이 남아야 한다.
-- ─────────────────────────────────────────────────────────────
create table rights_simulations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  zone_id      uuid not null references zones(id) on delete cascade,
  zone_unit_id uuid references zone_units(id) on delete set null,
  title        text,

  -- 입력값 (만원 / %)
  purchase_price                  bigint not null,
  assumed_bijul                   numeric(6,2) not null,
  assumed_member_price_per_pyeong bigint,
  target_area_pyeong              numeric(6,2),
  moving_loan_interest            bigint default 0,
  other_costs                     bigint default 0,

  -- 계산 결과 스냅샷
  appraisal_price_used bigint,
  right_value          bigint,   -- 권리가액 = 감정가 × 비례율
  additional_burden    bigint,   -- 추가분담금 = 조합원분양가 − 권리가액
  total_investment     bigint,
  expected_profit      bigint,

  -- 공유링크: 로그인 없이 read-only 열람 (명세 §4.4)
  share_token  text unique,
  is_public    boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index rights_simulations_user_idx  on rights_simulations (user_id, created_at desc);
create index rights_simulations_share_idx on rights_simulations (share_token) where share_token is not null;

select attach_updated_at('rights_simulations');

-- ─────────────────────────────────────────────────────────────
-- 관심 · 알림
-- ─────────────────────────────────────────────────────────────
create table zone_watchlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  zone_id       uuid not null references zones(id) on delete cascade,
  -- 특정 물건까지 좁혀 관심 등록 가능 (명세 §2.7)
  watch_unit_id uuid references zone_units(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (user_id, zone_id, watch_unit_id)
);

create index zone_watchlist_zone_idx on zone_watchlist (zone_id) where deleted_at is null;

select attach_updated_at('zone_watchlist');

create table alerts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  alert_type_code text not null,             -- codes(alert_type)
  zone_id         uuid references zones(id) on delete cascade,
  payload         jsonb not null default '{}'::jsonb,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index alerts_user_unread_idx on alerts (user_id, is_read, created_at desc);

select attach_updated_at('alerts');

-- 발송 큐 (명세 §2.9)
create table notification_jobs (
  id             uuid primary key default gen_random_uuid(),
  type           text not null,
  target_user_id uuid references auth.users(id) on delete cascade,
  payload        jsonb not null default '{}'::jsonb,
  status         text not null default 'pending'
                 check (status in ('pending','sent','failed')),
  scheduled_at   timestamptz not null default now(),
  sent_at        timestamptz,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create index notification_jobs_pending_idx
  on notification_jobs (status, scheduled_at) where status = 'pending';

select attach_updated_at('notification_jobs');
