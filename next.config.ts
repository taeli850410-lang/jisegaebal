import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * developStore는 런타임에 fs로 data/develops.seoul.json 을 읽는다.
   * 경로가 join(process.cwd(), ...) 로 조립되기 때문에 Next의 정적 추적이
   * 이 파일을 발견하지 못하고, 서버리스 번들에서 누락되어 구역이 0개가 된다.
   * 배포 대상 라우트에 명시적으로 포함시킨다.
   */
  outputFileTracingIncludes: {
    '/api/develops': ['./data/develops.seoul.json', './data/stages.seoul.json'],
    '/api/parcels': ['./data/develops.seoul.json', './data/stages.seoul.json'],
  },
}

export default nextConfig
