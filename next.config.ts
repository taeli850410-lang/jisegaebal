import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * 도면 썸네일은 /api/cleanup-image 를 거쳐 온다.
   * 로컬 dev 최적화기는 그냥 통과시키지만 Vercel 은 허용목록을 요구해
   * INVALID_IMAGE_OPTIMIZE_REQUEST 를 돌려준다. 그 경로만 열어둔다.
   */
  images: {
    localPatterns: [{ pathname: '/api/cleanup-image/**' }],
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
    '/api/zone-transactions': [
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
