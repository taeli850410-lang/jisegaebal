import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * 정비몽땅 도면(조감도·위치도·배치도) 썸네일.
   *
   * 처음에는 우리 API 로 중계하고 next/image 를 태우려 했는데, Vercel 최적화기가
   * 라우트 핸들러 응답을 소스로 받지 않는다(INVALID_IMAGE_OPTIMIZE_REQUEST).
   * 원격 소스로 직접 두면 최적화기가 한 번 받아 CDN 에 캐시하므로,
   * 오히려 우리가 중계할 때보다 정비몽땅을 덜 때린다.
   */
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cleanup.seoul.go.kr', pathname: '/servlet/image/**' },
      { protocol: 'https', hostname: 'cleanup.seoul.go.kr', pathname: '/servlet/image' },
    ],
    minimumCacheTTL: 604800,
  },

  /**
   * developStore는 런타임에 fs로 data/develops.seoul.json 을 읽는다.
   * 경로가 join(process.cwd(), ...) 로 조립되기 때문에 Next의 정적 추적이
   * 이 파일을 발견하지 못하고, 서버리스 번들에서 누락되어 구역이 0개가 된다.
   * 배포 대상 라우트에 명시적으로 포함시킨다.
   */
  outputFileTracingIncludes: {
    '/api/develops': ['./data/develops.seoul.json', './data/stages.seoul.json', './data/zone-summary.json', './data/zone-progress.json'],
    '/api/develops/browse': ['./data/develops.seoul.json', './data/stages.seoul.json', './data/zone-summary.json', './data/zone-progress.json'],
    '/api/develops/clusters': ['./data/develops.seoul.json', './data/stages.seoul.json', './data/zone-summary.json', './data/zone-progress.json'],
    '/api/develops/detail': ['./data/develops.seoul.json', './data/stages.seoul.json', './data/zone-summary.json', './data/zone-progress.json'],
    '/api/parcels': ['./data/develops.seoul.json', './data/stages.seoul.json', './data/zone-summary.json', './data/zone-progress.json'],
    // 단지 마커는 지번 좌표 캐시만 있으면 된다 (구역 데이터는 안 쓴다)
    '/api/apt-markers': ['./data/jibun-cache.json'],
    // 개별 실거래 마커는 구역 경계로 안팎을 가르므로 구역 데이터도 필요하다
    '/api/deal-markers': [
      './data/jibun-cache.json',
      './data/develops.seoul.json',
      './data/stages.seoul.json',
    ],
    '/api/zone-transactions': [
      './data/house-price-cache.json',
      './data/develops.seoul.json',
      './data/stages.seoul.json',
      './data/zone-summary.json', './data/zone-progress.json', './data/zone-plan.json',
      './data/jibun-cache.json',
    ],
    '/api/develops/full': [
      './data/develops.seoul.json',
      './data/stages.seoul.json',
      './data/zone-summary.json', './data/zone-progress.json', './data/zone-plan.json',
      './data/jibun-cache.json',
      './data/apt-info-cache.json',
      './data/zone-stats.json',
    ],
    '/api/search': [
      './data/develops.seoul.json',
      './data/stages.seoul.json',
      './data/zone-summary.json', './data/zone-progress.json', './data/zone-plan.json',
    ],
  },
}

export default nextConfig
