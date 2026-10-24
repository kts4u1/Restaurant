// 검색 서비스 조립 (Node.js·Cloudflare 공통, 파일 시스템을 쓰지 않는다)
import { createKakaoLocal } from './providers/kakaoLocal.js';
import { createKakaoPlaceDetail } from './providers/kakaoPlace.js';
import { createOsm } from './providers/osm.js';
import { createGoodPriceIndex } from './goodprice.js';
import { createEstimator } from './pricing.js';
import { createSearchService } from './search.js';
import { createCache } from './util.js';

/** 요청 사이에 같이 쓸 수 있는 캐시 (데이터만 담는다) */
export function createSharedCaches(config) {
  return {
    detail: createCache({ ttlMs: config.detailCacheHours * 60 * 60 * 1000 }),
    places: createCache({ ttlMs: 30 * 60 * 1000 }),
  };
}

/**
 * @param {object} config
 * @param {object} deps
 * @param {Function} [deps.fetchImpl]
 * @param {object} [deps.estimates]  data/price-estimates.json 내용
 * @param {Array}  [deps.goodpriceEntries]  data/goodprice.json 내용
 * @param {object} [deps.detailCachePersist]  메뉴 캐시를 디스크에도 저장할 때
 * @param {object} [deps.caches]  요청 사이에 같이 쓸 캐시 { detail, places } (Cloudflare 용)
 */
export function createServices(
  config,
  { fetchImpl = fetch, estimates = {}, goodpriceEntries = [], detailCachePersist = null, caches = null } = {},
) {
  const kakao = config.kakaoRestKey
    ? createKakaoLocal({
        apiKey: config.kakaoRestKey,
        baseUrl: config.kakaoApiBase,
        fetchImpl,
        ...(config.kakaoMaxRequests ? { maxRequests: config.kakaoMaxRequests } : {}),
      })
    : null;
  const osm = createOsm({
    overpassUrls: config.overpassUrls,
    nominatimUrl: config.nominatimUrl,
    userAgent: config.userAgent,
    fetchImpl,
  });
  const placeDetail = createKakaoPlaceDetail({
    baseUrl: config.kakaoPlaceApiBase,
    fetchImpl,
    concurrency: config.menuConcurrency,
    enabled: config.enableMenuFetch,
    cache: caches?.detail || createCache({ ttlMs: config.detailCacheHours * 60 * 60 * 1000, persist: detailCachePersist }),
  });
  const goodprice = createGoodPriceIndex(Array.isArray(goodpriceEntries) ? goodpriceEntries : []);
  const service = createSearchService({
    primary: kakao || osm,
    fallback: kakao ? osm : null,
    placeDetail,
    goodprice,
    estimate: createEstimator(estimates),
    maxPlaces: config.maxPlaces,
    placesCache: caches?.places,
  });
  return { kakao, osm, placeDetail, goodprice, estimates, service };
}
