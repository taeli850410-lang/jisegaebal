/**
 * 정비사업 분류 체계 (기획서 PART 1.4 — 벤치마크 실측 전수)
 *
 * 중요: 사업종류마다 실제 단계 체계가 다르다(모아타운은 관리계획수립→고시,
 * 도심공공은 예정지구→본지구). 그래서 필터/집계에 쓰는 "정규화 단계"와
 * 화면에 표시하는 "원본 단계"를 분리한다.
 */

export type ProjectTypeGroup = '민간주도' | '공공주도' | '소규모' | '기타'

export interface ProjectType {
  code: string
  label: string
  group: ProjectTypeGroup
  /** 지도 폴리곤 색상 (색약 대응: 색상 + 패턴 이중 인코딩 예정) */
  color: string
}

export const PROJECT_TYPES: ProjectType[] = [
  // 민간주도
  { code: 'redev', label: '재개발', group: '민간주도', color: '#E03131' },
  { code: 'sintong', label: '신통기획', group: '민간주도', color: '#F03E3E' },
  { code: 'private_urban', label: '민간도심복합', group: '민간주도', color: '#C2255C' },
  { code: 'rebuild_house', label: '재건축(단독주택)', group: '민간주도', color: '#AE3EC9' },
  { code: 'rebuild_apt', label: '재건축(아파트)', group: '민간주도', color: '#7048E8' },
  { code: 'local_union', label: '지역주택조합', group: '민간주도', color: '#4C6EF5' },

  // 공공주도
  { code: 'public_redev', label: '공공재개발', group: '공공주도', color: '#1C7ED6' },
  { code: 'public_urban', label: '도심공공복합', group: '공공주도', color: '#1098AD' },
  { code: 'station_area', label: '역세권활성화', group: '공공주도', color: '#0CA678' },
  { code: 'long_lease', label: '장기전세(역세권시프트)', group: '공공주도', color: '#37B24D' },

  // 소규모
  { code: 'moa', label: '모아타운', group: '소규모', color: '#F59F00' },
  { code: 'garo', label: '가로주택', group: '소규모', color: '#F76707' },
  { code: 'small_rebuild', label: '소규모', group: '소규모', color: '#E8590C' },

  // 기타
  { code: 'virtual', label: '가상구역', group: '기타', color: '#868E96' },
]

export const PROJECT_TYPE_MAP = new Map(PROJECT_TYPES.map((t) => [t.code, t]))

export type StageGroup = '추진중' | '진행중' | '완료'

export interface Stage {
  code: string
  label: string
  group: StageGroup
  /** 진행 순서 — 타임라인 정렬 및 "몇 단계까지 왔나" 계산용 */
  order: number
}

export const STAGES: Stage[] = [
  { code: 'prepare', label: '추진준비', group: '추진중', order: 1 },
  { code: 'numbering', label: '연번부여', group: '추진중', order: 2 },
  { code: 'safety_check', label: '안전진단', group: '추진중', order: 3 },
  { code: 'site_selected', label: '대상지선정', group: '진행중', order: 4 },
  { code: 'zone_designated', label: '구역지정', group: '진행중', order: 5 },
  { code: 'committee', label: '추진위승인', group: '진행중', order: 6 },
  { code: 'union', label: '조합설립인가', group: '진행중', order: 7 },
  { code: 'impl_approval', label: '사업시행인가', group: '진행중', order: 8 },
  { code: 'mgmt_disposal', label: '관리처분인가', group: '진행중', order: 9 },
  { code: 'construction', label: '착공', group: '진행중', order: 10 },
  { code: 'completed', label: '준공', group: '완료', order: 11 },
]

export const STAGE_MAP = new Map(STAGES.map((s) => [s.code, s]))

/**
 * 정비몽땅(cleanup.seoul.go.kr)의 원본 진행단계 → 우리 정규화 단계.
 *
 * 원본은 사업 유형·시행방식마다 라벨이 다르고 조합 운영 단계(해산·청산)까지 섞여 있다.
 * 필터·집계는 정규화 단계로 하고, 화면에는 원본 라벨을 그대로 보여준다.
 */
export const RAW_STAGE_TO_CANONICAL: Record<string, string> = {
  '정비계획 수립': 'prepare',
  '추진위구성': 'prepare',
  '안전진단': 'safety_check',
  '정비구역지정': 'zone_designated',
  '추진위원회승인': 'committee',
  '조합원 모집신고': 'committee',
  '조합규약작성': 'committee',
  '조합창립총회': 'committee',
  '조합설립인가': 'union',
  '지구단위계획수립/건축심의/교통심의': 'union',
  '사업시행인가': 'impl_approval',
  '관리처분인가': 'mgmt_disposal',
  '철거': 'construction',
  '착공': 'construction',
  '분양': 'construction',
  '준공인가': 'completed',
  '이전고시': 'completed',
  '조합해산': 'completed',
  '조합청산': 'completed',
}

/** 사업종류별 코호트 평균 단계 소요기간(개월) — "평균 15개월" 비교용 (현재는 예시값) */
export const AVG_STAGE_MONTHS: Record<string, number> = {
  site_selected: 15,
  zone_designated: 18,
  committee: 12,
  union: 24,
  impl_approval: 30,
  mgmt_disposal: 20,
}
