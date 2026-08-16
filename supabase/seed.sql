-- 초기 코드 시드 (명세 §2.1)
-- 색상은 지도 폴리곤·배지에 그대로 쓰인다 (명세 §4.1, §7).

insert into code_groups (key, name, is_system) values
  ('project_type',     '정비사업 유형', true),
  ('project_stage',    '사업단계',      true),
  ('unit_type',        '물건 종류',     true),
  ('right_type',       '권리 종류',     true),
  ('regulation_label', '규제 라벨',     true),
  ('customer_class',   '상담 고객 분류', false),
  ('alert_type',       '알림 유형',     true)
on conflict (key) do nothing;

-- ── 정비사업 유형 ────────────────────────────────────────────
-- 명세 §4.1 지정 색상: 재개발=주황, 재건축=파랑, 신통기획=보라, 모아타운=초록
insert into codes (group_id, value, label, color, sort_order)
select g.id, v.value, v.label, v.color, v.sort_order
from code_groups g, (values
  ('redevelopment',  '재개발',            '#F97316', 1),
  ('reconstruction', '재건축',            '#2563EB', 2),
  ('sintong',        '신속통합기획',      '#7C3AED', 3),
  ('moa_town',       '모아타운',          '#10B981', 4),
  ('self_housing',   '자율주택정비',      '#F59E0B', 5),
  ('small_recon',    '소규모재건축',      '#0EA5E9', 6),
  ('street_housing', '가로주택정비',      '#EA580C', 7)
) as v(value, label, color, sort_order)
where g.key = 'project_type'
on conflict (group_id, value) do nothing;

-- ── 사업단계 ────────────────────────────────────────────────
-- 명세 §7: 진행 정도에 따라 회색 → 연파랑 → 진파랑 → 초록 그라데이션
insert into codes (group_id, value, label, color, sort_order)
select g.id, v.value, v.label, v.color, v.sort_order
from code_groups g, (values
  ('pre_designation', '구역지정 전(예정구역)', '#94A3B8', 1),
  ('designated',      '정비구역지정',          '#78909C', 2),
  ('committee',       '추진위구성',            '#60A5FA', 3),
  ('association',     '조합설립인가',          '#3B82F6', 4),
  ('implementation',  '사업시행인가',          '#2563EB', 5),
  ('management',      '관리처분인가',          '#1D4ED8', 6),
  ('relocation',      '이주',                  '#7C3AED', 7),
  ('demolition',      '철거',                  '#9333EA', 8),
  ('construction',    '착공',                  '#059669', 9),
  ('general_sale',    '일반분양',              '#10B981', 10),
  ('completion',      '준공',                  '#047857', 11),
  ('dissolved',       '해산/해제',             '#9CA3AF', 12)
) as v(value, label, color, sort_order)
where g.key = 'project_stage'
on conflict (group_id, value) do nothing;

-- ── 물건 종류 ────────────────────────────────────────────────
insert into codes (group_id, value, label, sort_order)
select g.id, v.value, v.label, v.sort_order
from code_groups g, (values
  ('apartment',   '아파트',           1),
  ('villa',       '다세대(빌라)',     2),
  ('house',       '다가구/단독',      3),
  ('commercial',  '상가',             4),
  ('unlicensed',  '무허가건물(뚜껑)', 5),
  ('vacant_land', '나대지',           6),
  ('road_share',  '도로/공유지분',    7)
) as v(value, label, sort_order)
where g.key = 'unit_type'
on conflict (group_id, value) do nothing;

-- ── 권리 종류 ────────────────────────────────────────────────
insert into codes (group_id, value, label, sort_order)
select g.id, v.value, v.label, v.sort_order
from code_groups g, (values
  ('landowner',    '토지등소유자',     1),
  ('member_right', '조합원 입주권',    2),
  ('cash_settle',  '현금청산 대상',    3),
  ('public_land',  '국공유지',         4)
) as v(value, label, sort_order)
where g.key = 'right_type'
on conflict (group_id, value) do nothing;

-- ── 규제 라벨 ────────────────────────────────────────────────
insert into codes (group_id, value, label, color, sort_order)
select g.id, v.value, v.label, v.color, v.sort_order
from code_groups g, (values
  ('speculation_zone', '투기과열지구',              '#DC2626', 1),
  ('adjustment_zone',  '조정대상지역',              '#F97316', 2),
  ('land_permit_zone', '토지거래허가구역',          '#B45309', 3),
  ('post_management',  '관리처분인가 후(입주권 전환)', '#1D4ED8', 4)
) as v(value, label, color, sort_order)
where g.key = 'regulation_label'
on conflict (group_id, value) do nothing;

-- ── 상담 고객 분류 (중개사 워크스페이스) ─────────────────────
insert into codes (group_id, value, label, sort_order)
select g.id, v.value, v.label, v.sort_order
from code_groups g, (values
  ('consult',   '투자상담',  1),
  ('sell_wish', '매도희망',  2),
  ('buy_wish',  '매수희망',  3),
  ('in_deal',   '계약진행',  4),
  ('done',      '계약완료',  5)
) as v(value, label, sort_order)
where g.key = 'customer_class'
on conflict (group_id, value) do nothing;

-- ── 알림 유형 ────────────────────────────────────────────────
insert into codes (group_id, value, label, sort_order)
select g.id, v.value, v.label, v.sort_order
from code_groups g, (values
  ('new_listing',  '신규매물',       1),
  ('price_change', '가격변동',       2),
  ('stage_change', '사업단계변경',   3),
  ('zone_news',    '관심구역 뉴스',  4)
) as v(value, label, sort_order)
where g.key = 'alert_type'
on conflict (group_id, value) do nothing;
