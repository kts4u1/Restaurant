// 설정값 (Node.js·Cloudflare 공통). env = 환경변수 객체
function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function baseConfig(env = {}) {
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    kakaoRestKey: String(env.KAKAO_REST_API_KEY || '').trim(),
    kakaoApiBase: env.KAKAO_API_BASE || 'https://dapi.kakao.com',
    kakaoPlaceApiBase: env.KAKAO_PLACE_API_BASE || 'https://place-api.map.kakao.com',
    enableMenuFetch: env.ENABLE_MENU_FETCH !== 'false',
    menuConcurrency: num(env.MENU_CONCURRENCY, 4),
    detailCacheHours: num(env.DETAIL_CACHE_HOURS, 6),
    maxPlaces: num(env.MAX_PLACES, 600),
    kakaoMaxRequests: num(env.KAKAO_MAX_REQUESTS, 0) || undefined,
    minRadius: 50,
    maxRadius: 2000,
    overpassUrls: (env.OVERPASS_URLS ||
      'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    userAgent: 'hankki-choijeoga/1.0 (+https://github.com/kts4u1/Restaurant)',
  };
}
