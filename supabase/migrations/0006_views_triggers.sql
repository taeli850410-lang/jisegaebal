-- 0006. 파생 뷰 · 트리거
-- 명세 §4.3 (AI 감정 순위), §2.4/§2.2 (알림 트리거)

-- ─────────────────────────────────────────────────────────────
-- AI 감정 순위 ★원칙 5
-- 감정가가 없으면(관리처분 전) 추정 감정가로 순위를 매기되,
-- is_estimated 를 함께 내려 UI가 "추정" 배지를 붙일 수 있게 한다 (D-05).
-- ─────────────────────────────────────────────────────────────
create view v_zone_unit_ranks as
select
  u.id,
  u.zone_id,
  u.address,
  u.unit_type_code,
  u.land_share,
  u.appraisal_price,
  u.estimated_appraisal_price,
  coalesce(u.appraisal_price, u.estimated_appraisal_price) as effective_price,
  (u.appraisal_price is null)                              as is_estimated,
  rank() over (
    partition by u.zone_id
    order by coalesce(u.appraisal_price, u.estimated_appraisal_price) desc nulls last
  ) as appraisal_rank_in_zone,
  count(*) over (partition by u.zone_id) as zone_unit_count,
  -- 상위 몇 % — "상위 12%" 표기에 그대로 쓴다
  round(
    percent_rank() over (
      partition by u.zone_id
      order by coalesce(u.appraisal_price, u.estimated_appraisal_price) desc nulls last
    )::numeric * 100, 1
  ) as top_percentile,
  case
    when u.land_share is not null and u.land_share > 0
    then round(coalesce(u.appraisal_price, u.estimated_appraisal_price) / (u.land_share / 3.3058))
  end as price_per_land_pyeong
from zone_units u
where u.deleted_at is null;

-- ─────────────────────────────────────────────────────────────
-- 구역 진행 속도 (원칙 2)
-- 현재 단계에 머문 개월 수. 동종 사업유형 평균과 비교해 "빠름/느림"을 판단한다.
-- ─────────────────────────────────────────────────────────────
create view v_zone_progress as
with latest as (
  select distinct on (zone_id)
    zone_id, stage_code, changed_at
  from zone_stage_history
  where deleted_at is null
  order by zone_id, changed_at desc
)
select
  z.id as zone_id,
  z.project_type_code,
  l.stage_code           as latest_stage_code,
  l.changed_at           as latest_stage_at,
  (date_part('year',  age(now(), l.changed_at)) * 12
   + date_part('month', age(now(), l.changed_at)))::int as months_in_stage,
  (select count(*) from zone_stage_history h
    where h.zone_id = z.id and h.deleted_at is null)     as stage_change_count
from zones z
left join latest l on l.zone_id = z.id
where z.deleted_at is null;

-- ─────────────────────────────────────────────────────────────
-- 알림 트리거
-- 관심 등록자에게만 만든다. 구역당 관심자가 많아질 수 있으므로 insert-select 한 번으로 처리.
-- ─────────────────────────────────────────────────────────────
create or replace function notify_new_listing()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into alerts (user_id, alert_type_code, zone_id, payload)
  select w.user_id, 'new_listing', new.zone_id,
         jsonb_build_object('listing_id', new.id, 'asking_price', new.asking_price)
  from zone_watchlist w
  where w.zone_id = new.zone_id
    and w.deleted_at is null
    -- 본인이 올린 매물로 본인에게 알림이 가지 않게 한다
    and w.user_id is distinct from new.registered_by;
  return new;
end;
$$;

create trigger trg_listing_alert
after insert on listings
for each row execute function notify_new_listing();

create or replace function notify_stage_change()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into alerts (user_id, alert_type_code, zone_id, payload)
  select w.user_id, 'stage_change', new.zone_id,
         jsonb_build_object('stage_code', new.stage_code, 'changed_at', new.changed_at)
  from zone_watchlist w
  where w.zone_id = new.zone_id and w.deleted_at is null;

  -- 구역의 현재 단계도 함께 갱신한다 (이력이 곧 현재 상태의 근거)
  update zones
     set current_stage_code = new.stage_code
   where id = new.zone_id
     and (current_stage_code is distinct from new.stage_code);

  return new;
end;
$$;

create trigger trg_stage_alert
after insert on zone_stage_history
for each row execute function notify_stage_change();

-- 가격 하락 알림 (명세 §4.6)
create or replace function notify_price_drop()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.asking_price < old.asking_price then
    insert into alerts (user_id, alert_type_code, zone_id, payload)
    select w.user_id, 'price_change', new.zone_id,
           jsonb_build_object(
             'listing_id', new.id,
             'before', old.asking_price,
             'after',  new.asking_price
           )
    from zone_watchlist w
    where w.zone_id = new.zone_id and w.deleted_at is null;
  end if;
  return new;
end;
$$;

create trigger trg_listing_price_alert
after update of asking_price on listings
for each row execute function notify_price_drop();
