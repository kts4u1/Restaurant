import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env 파일이 있으면 읽는다 (Node 20.12+ 내장 기능)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env 가 없어도 동작한다
}

const env = process.env;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(overrides = {}) {
  return {
    port: num(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    kakaoRestKey: (env.KAKAO_REST_API_KEY || '').trim(),
    kakaoApiBase: env.KAKAO_API_BASE || 'https://dapi.kakao.com',
    kakaoPlaceApiBase: env.KAKAO_PLACE_API_BASE || 'https://place-api.map.kakao.com',
    enableMenuFetch: env.ENABLE_MENU_FETCH !== 'false',
    menuConcurrency: num(env.MENU_CONCURRENCY, 4),
    detailCacheHours: num(env.DETAIL_CACHE_HOURS, 6),
    maxPlaces: num(env.MAX_PLACES, 600),
    minRadius: 50,
    maxRadius: 2000,
    overpassUrls: (env.OVERPASS_URLS ||
      'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter,https://maps.mail.ru/osm/tools/overpass/api/interpreter')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    cacheDir: env.CACHE_DIR || path.join(ROOT, '.cache'),
    publicDir: path.join(ROOT, 'public'),
    userAgent: 'hankki-choijeoga/1.0 (+https://github.com/kts4u1/Restaurant)',
    ...overrides,
  };
}
