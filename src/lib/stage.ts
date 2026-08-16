// node --test 는 타입 스트리핑만 하므로 확장자가 있어야 해석된다
import { STAGES, STAGE_MAP, type Stage } from './taxonomy.ts'

/**
 * 사업장 목록의 단계와 추진경과의 인가일을 맞춰 실제 현재 단계를 정한다.
 *
 * 정비몽땅은 두 곳에서 단계를 알려주는데 시점이 다르다.
 *   - 사업장 목록: 스냅샷. 갱신이 늦을 수 있다.
 *   - 추진경과: 단계별 인가일. 새 인가가 나면 여기 먼저 찍힌다.
 *
 * 그대로 두면 "현재 단계: 추진위승인" 밑에 "조합설립인가 2026.06.06"이
 * 같이 보이는 모순이 생긴다. 인가일이 있는 가장 앞선 단계를 현재로 본다.
 * (뒤로 되돌리지는 않는다 — 인가일이 누락된 단계가 많기 때문이다)
 */
export interface ResolvedStage {
  /** 화면에 현재 단계로 표시할 것 */
  current: Stage | null
  /** 사업장 목록이 알려준 단계 */
  listed: Stage | null
  /** 추진경과가 목록보다 앞서 있는가 — 근거를 함께 보여주기 위한 플래그 */
  ahead: boolean
}

export function resolveStage(
  canonicalStage: string | null | undefined,
  progressDates: Record<string, { date: string }> | null | undefined,
): ResolvedStage {
  const listed = canonicalStage ? (STAGE_MAP.get(canonicalStage) ?? null) : null

  const fromProgress = progressDates
    ? (STAGES.filter((s) => progressDates[s.code]?.date).sort((a, b) => b.order - a.order)[0] ??
      null)
    : null

  if (fromProgress && (!listed || fromProgress.order > listed.order)) {
    return { current: fromProgress, listed, ahead: !!listed }
  }
  return { current: listed, listed, ahead: false }
}
