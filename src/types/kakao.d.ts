// 카카오맵 SDK는 공식 타입 정의를 제공하지 않으므로 최소 선언만 둔다.
// 프로덕션에서는 실제 사용하는 API 표면만 점진적으로 타입을 좁혀 나갈 것.
declare global {
  interface Window {
    kakao: any
  }
  const kakao: any
}

export {}
