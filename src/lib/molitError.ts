/**
 * 공공데이터포털 오류코드를 사람 말로.
 *
 * 원문 코드를 그대로 띄우면 사용자는 우리가 고장 났다고 읽는다.
 * 무엇이 막혔고 언제 풀리는지까지 말해야 기다릴지 말지 판단할 수 있다.
 */
export function molitErrorMessage(code: string): { title: string; detail: string } {
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED/.test(code)) {
    return {
      title: '국토교통부 실거래가 연동이 중단되었습니다.',
      detail: '공공데이터포털 서비스키가 만료되었거나 승인이 해제된 상태입니다. 갱신 후 자동으로 복구됩니다.',
    }
  }
  if (/LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS/.test(code)) {
    return {
      title: '오늘 조회 한도를 모두 썼습니다.',
      detail: '공공데이터포털 일일 한도 초과입니다. 자정이 지나면 다시 조회됩니다.',
    }
  }
  if (/PER_SECOND/.test(code)) {
    return {
      title: '요청이 잠시 몰렸습니다.',
      detail: '잠시 후 다시 열어 주세요.',
    }
  }
  if (/DEADLINE_HAS_EXPIRED/.test(code)) {
    return {
      title: '국토교통부 실거래가 활용기간이 만료되었습니다.',
      detail: '공공데이터포털에서 활용기간을 연장하면 복구됩니다.',
    }
  }
  return {
    title: '실거래 데이터를 불러오지 못했습니다.',
    detail: `공공데이터포털 응답: ${code}`,
  }
}
