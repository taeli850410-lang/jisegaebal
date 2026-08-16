-- 0007. Row Level Security
-- 명세 §6. 원칙: 공개 데이터는 read 개방, 쓰기는 역할 제한, 중개사 데이터는 office 격리

-- 관리자 판별 — auth.users.raw_app_meta_data 의 role 을 본다.
create or replace function is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- 현재 사용자의 중개사무소
create or replace function my_office_id()
returns uuid
language sql
stable
as $$
  select office_id from broker_profiles
  where user_id = auth.uid() and deleted_at is null
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────
-- 공개 읽기 · 관리자 쓰기
-- ─────────────────────────────────────────────────────────────
alter table code_groups enable row level security;
alter table codes       enable row level security;

create policy codes_read      on codes       for select using (true);
create policy code_groups_read on code_groups for select using (true);
create policy codes_admin     on codes       for all using (is_admin()) with check (is_admin());
create policy code_groups_admin on code_groups for all using (is_admin()) with check (is_admin());

alter table zones enable row level security;
-- 초안(가상구역 미승인)은 작성자와 관리자만 (D-07)
create policy zones_read on zones for select
  using (deleted_at is null and (is_draft = false or created_by = auth.uid() or is_admin()));
-- 로그인 사용자는 가상구역을 만들 수 있다. 단 초안으로만.
create policy zones_insert_virtual on zones for insert
  with check (auth.uid() is not null and is_virtual = true and is_draft = true and created_by = auth.uid());
create policy zones_update_own on zones for update
  using (created_by = auth.uid() and is_virtual = true) with check (is_virtual = true);
create policy zones_admin on zones for all using (is_admin()) with check (is_admin());

alter table zone_stage_history enable row level security;
create policy zone_stage_read  on zone_stage_history for select using (true);
create policy zone_stage_admin on zone_stage_history for all using (is_admin()) with check (is_admin());

alter table zone_boundary_edits enable row level security;
create policy zone_edits_read on zone_boundary_edits for select
  using (edited_by = auth.uid() or is_admin());
create policy zone_edits_insert on zone_boundary_edits for insert
  with check (edited_by = auth.uid());

alter table zone_units enable row level security;
create policy zone_units_read  on zone_units for select
  using (deleted_at is null and (is_draft = false or is_admin()));
create policy zone_units_admin on zone_units for all using (is_admin()) with check (is_admin());

alter table unit_owners enable row level security;
create policy unit_owners_read  on unit_owners for select using (true);
create policy unit_owners_admin on unit_owners for all using (is_admin()) with check (is_admin());

alter table trades enable row level security;
create policy trades_read  on trades for select using (deleted_at is null);
create policy trades_admin on trades for all using (is_admin()) with check (is_admin());

alter table unmatched_trades enable row level security;
create policy unmatched_admin on unmatched_trades for all using (is_admin()) with check (is_admin());

alter table bijul_presets enable row level security;
create policy bijul_read  on bijul_presets for select using (true);
create policy bijul_admin on bijul_presets for all using (is_admin()) with check (is_admin());

-- ─────────────────────────────────────────────────────────────
-- 매물 — 공개 읽기, 등록자/중개사무소/관리자 쓰기
-- 연락처 노출은 애플리케이션에서 "문의하기" 시에만 조회한다(컬럼 자체는 RLS로 못 가림).
-- ─────────────────────────────────────────────────────────────
alter table listings enable row level security;
create policy listings_read on listings for select using (deleted_at is null);
create policy listings_insert on listings for insert
  with check (auth.uid() is not null and registered_by = auth.uid());
create policy listings_update_own on listings for update
  using (registered_by = auth.uid() or broker_office_id = my_office_id() or is_admin());

alter table listing_photos enable row level security;
create policy listing_photos_read on listing_photos for select using (true);
create policy listing_photos_write on listing_photos for all
  using (exists (
    select 1 from listings l
    where l.id = listing_id
      and (l.registered_by = auth.uid() or l.broker_office_id = my_office_id() or is_admin())
  ));

-- ─────────────────────────────────────────────────────────────
-- 개인 데이터 — 본인만
-- ─────────────────────────────────────────────────────────────
alter table zone_watchlist enable row level security;
create policy watchlist_own on zone_watchlist for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table alerts enable row level security;
create policy alerts_own on alerts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table notification_jobs enable row level security;
create policy notification_jobs_admin on notification_jobs for all
  using (is_admin()) with check (is_admin());

-- 시뮬레이션: 본인 + 공유링크로 공개된 것
alter table rights_simulations enable row level security;
create policy simulations_own on rights_simulations for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy simulations_shared_read on rights_simulations for select
  using (is_public = true and share_token is not null);

-- ─────────────────────────────────────────────────────────────
-- 중개사 워크스페이스 — office 격리 (명세 §6)
-- ─────────────────────────────────────────────────────────────
alter table broker_offices enable row level security;
create policy offices_read on broker_offices for select using (true);
create policy offices_admin on broker_offices for all using (is_admin()) with check (is_admin());

alter table broker_profiles enable row level security;
create policy profiles_read_own on broker_profiles for select
  using (user_id = auth.uid() or office_id = my_office_id() or is_admin());

alter table zone_assignments enable row level security;
-- "이 구역 전문 중개사" 카드는 공개 노출이므로 read 는 열어둔다
create policy assignments_read on zone_assignments for select using (true);
create policy assignments_write on zone_assignments for all
  using (office_id = my_office_id() or is_admin())
  with check (office_id = my_office_id() or is_admin());

alter table consult_customers enable row level security;
create policy customers_office on consult_customers for all
  using (office_id = my_office_id() or is_admin())
  with check (office_id = my_office_id() or is_admin());

alter table briefing_documents enable row level security;
create policy briefings_office on briefing_documents for all
  using (office_id = my_office_id() or is_admin())
  with check (office_id = my_office_id() or is_admin());
-- 공유링크로 연 사람은 읽기만
create policy briefings_shared_read on briefing_documents for select
  using (share_token is not null);
