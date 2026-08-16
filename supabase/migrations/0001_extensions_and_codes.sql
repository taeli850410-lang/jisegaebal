-- 0001. 확장 · 공통 규약 · 사용자 정의 코드 시스템
-- 명세 §2 공통규칙, §2.1

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "postgis";    -- 구역 폴리곤 · 공간쿼리 (명세 필수)
create extension if not exists "pg_trgm";    -- 구역명 fuzzy 검색 (명세 §4.1)

-- ─────────────────────────────────────────────────────────────
-- 공통: updated_at 자동 갱신
-- 모든 테이블이 같은 트리거를 쓰도록 함수 하나만 둔다.
-- ─────────────────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 테이블마다 트리거를 손으로 붙이면 빠뜨리기 쉬워 헬퍼로 만든다.
create or replace function attach_updated_at(p_table regclass)
returns void
language plpgsql
as $$
begin
  execute format(
    'create trigger trg_%s_updated_at before update on %s
     for each row execute function set_updated_at()',
    replace(p_table::text, '.', '_'), p_table
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 구분항목(코드) — 원칙 4: 관리자 화면에서 CRUD 가능해야 한다
-- ─────────────────────────────────────────────────────────────
create table code_groups (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  -- is_system = true 인 그룹은 삭제 불가(코드 로직이 key 를 참조)
  is_system   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table codes (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references code_groups(id) on delete cascade,
  value       text not null,
  label       text not null,
  -- 지도 폴리곤·배지 색상. 원칙 4에 따라 UI가 이 값을 그대로 쓴다.
  color       text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (group_id, value)
);

create index codes_group_active_idx on codes (group_id, is_active, sort_order);

select attach_updated_at('code_groups');
select attach_updated_at('codes');

-- 코드 값을 편하게 참조하기 위한 뷰
create view v_codes as
select g.key as group_key, c.value, c.label, c.color, c.sort_order, c.is_active
from codes c
join code_groups g on g.id = c.group_id
where c.deleted_at is null and g.deleted_at is null;
