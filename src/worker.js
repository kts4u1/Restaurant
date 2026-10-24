// Cloudflare Workers: 화면 파일(public/)은 Cloudflare 가 바로 주고, /api/* 만 여기서 처리한다.
// 카카오 키는 Cloudflare 비밀값 KAKAO_REST_API_KEY (GitHub Actions 가 GitHub 시크릿에서 넣어 준다).
import { baseConfig } from './configCore.js';
import { createServices, createSharedCaches } from './services.js';
import { createApi } from './api.js';
import estimates from '../data/price-estimates.json';
import goodpriceEntries from '../data/goodprice.json';

// Cloudflare 무료 플랜: 요청 하나에서 바깥으로 50번까지만 물어볼 수 있다
const FREE_PLAN_SUBREQUESTS = 45;
const DETAIL_BATCH = 4;

// 메뉴·식당 목록 저장본(단순 데이터)만 요청 사이에 같이 쓴다.
// 진행 중인 작업(대기열, fetch)은 Cloudflare 에서 요청끼리 공유하면 안 되므로 서비스는 요청마다 새로 만든다.
let shared = null;
function getApi(env) {
  const config = {
    ...baseConfig(env),
    kakaoMaxRequests: Number(env.KAKAO_MAX_REQUESTS) || FREE_PLAN_SUBREQUESTS,
    menuConcurrency: DETAIL_BATCH,
  };
  if (!shared || shared.key !== config.kakaoRestKey) shared = { key: config.kakaoRestKey, caches: createSharedCaches(config) };
  const services = createServices(config, { estimates, goodpriceEntries, caches: shared.caches });
  return createApi({ config, getServices: () => services, keySource: 'secret', detailBatch: DETAIL_BATCH });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const { status, body } = await getApi(env)({
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      readBody: async () => {
        const text = await request.text();
        if (text.length > 512 * 1024) throw Object.assign(new Error('요청이 너무 큽니다.'), { status: 413 });
        try {
          return text ? JSON.parse(text) : {};
        } catch {
          throw Object.assign(new Error('잘못된 요청 형식입니다.'), { status: 400 });
        }
      },
      isLocal: false,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
