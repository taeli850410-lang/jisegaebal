/**
 * 카카오맵 SDK 단일 로드 보장 (부록 C.4 — 쿼터 절감의 핵심)
 *
 * 지도 API 쿼터는 "SDK 스크립트 호출" 시점에 카운트된다.
 * 지도를 이동·확대해도 추가 카운트되지 않으므로, 세션당 1회 로드로 억제하면
 * 무료 쿼터(일 30만) 안에서 상당한 트래픽을 감당할 수 있다.
 *
 * 페이지 전환마다 <script>를 다시 붙이는 실수가 가장 흔한 쿼터 누수 원인이다.
 * 그래서 모듈 스코프 Promise 싱글턴으로 잠근다.
 */

const SDK_LIBRARIES = ['services', 'clusterer', 'drawing'] as const

let loadPromise: Promise<any> | null = null

export function loadKakaoMaps(): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('loadKakaoMaps는 브라우저에서만 호출할 수 있습니다.'))
  }

  // 이미 로드 완료
  if (window.kakao?.maps?.Map) {
    return Promise.resolve(window.kakao)
  }

  // 로드 진행 중 — 같은 Promise를 재사용 (중복 삽입 방지)
  if (loadPromise) return loadPromise

  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY

  loadPromise = new Promise((resolve, reject) => {
    if (!appKey) {
      reject(
        new Error(
          'NEXT_PUBLIC_KAKAO_MAP_JS_KEY가 설정되지 않았습니다. .env.local을 확인하세요.',
        ),
      )
      return
    }

    // 다른 코드가 이미 삽입한 스크립트가 있으면 재사용
    const existing = document.getElementById('kakao-maps-sdk') as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')

    if (!existing) {
      script.id = 'kakao-maps-sdk'
      script.async = true
      // autoload=false : SDK 실행 시점을 우리가 제어한다
      script.src =
        `https://dapi.kakao.com/v2/maps/sdk.js` +
        `?appkey=${appKey}` +
        `&autoload=false` +
        `&libraries=${SDK_LIBRARIES.join(',')}`
    }

    script.addEventListener('load', () => {
      window.kakao.maps.load(() => resolve(window.kakao))
    })

    script.addEventListener('error', () => {
      loadPromise = null // 재시도 가능하도록 초기화
      reject(
        new Error(
          '카카오맵 SDK 로드에 실패했습니다. ' +
            '카카오 개발자 콘솔 > 내 애플리케이션 > 플랫폼 > Web 에 ' +
            '현재 도메인이 등록되어 있는지 확인하세요.',
        ),
      )
    })

    if (!existing) document.head.appendChild(script)
  })

  return loadPromise
}
