import fs from 'node:fs';
import path from 'node:path';
import { createKakaoLocal } from './providers/kakaoLocal.js';
import { createKakaoPlaceDetail } from './providers/kakaoPlace.js';
import { createOsm } from './providers/osm.js';
import { loadGoodPrice } from './goodprice.js';
import { createEstimator } from './pricing.js';
import { createSearchService } from './search.js';
import { createCache, readJsonFile } from './util.js';
import { isValidLatLng } from './geo.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const PLACE_FIELDS = ['id', 'kakaoId', 'name', 'category', 'address', 'jibunAddress', 'lat', 'lng', 'phone', 'url', 'distance', 'provider'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readBody(req, limit = 512 * 1024) {
  // Vercel 함수에서는 본문이 이미 읽혀 req.body 에 들어 있다
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return JSON.parse(req.body || '{}');
      } catch {
        throw httpError(400, '잘못된 요청 형식입니다.');
      }
    }
    return req.body || {};
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, '잘못된 요청 형식입니다.');
  }
}

/** 설정값으로 서비스 구성 */
export function buildServices(config, { fetchImpl = fetch } = {}) {
  const kakao = config.kakaoRestKey
    ? createKakaoLocal({ apiKey: config.kakaoRestKey, baseUrl: config.kakaoApiBase, fetchImpl })
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
    cache: createCache({
      dir: config.cacheDir,
      namespace: 'kakao-place',
      ttlMs: config.detailCacheHours * 60 * 60 * 1000,
    }),
  });
  const goodprice = loadGoodPrice(path.join(config.dataDir, 'goodprice.json'));
  const estimates = readJsonFile(path.join(config.dataDir, 'price-estimates.json'), {});
  const service = createSearchService({
    primary: kakao || osm,
    fallback: kakao ? osm : null,
    placeDetail,
    goodprice,
    estimate: createEstimator(estimates),
    maxPlaces: config.maxPlaces,
  });
  return { kakao, osm, placeDetail, goodprice, estimates, service };
}

export function createHandler(config, services) {
  const { kakao, osm, placeDetail, goodprice, estimates, service } = services;
  const publicDir = path.resolve(config.publicDir);

  async function geocode(q) {
    const warnings = [];
    for (const g of [kakao, osm].filter(Boolean)) {
      try {
        const list = await g.geocode(q);
        if (list.length) return { candidates: list.slice(0, 6), provider: g.name, warnings };
      } catch (err) {
        warnings.push(err.message);
      }
    }
    return { candidates: [], warnings };
  }

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const q = url.searchParams;

    if (route === 'GET /api/status') {
      return sendJson(res, 200, {
        kakao: Boolean(kakao),
        provider: kakao ? 'kakao' : 'osm',
        menuFetch: placeDetail.enabled,
        goodpriceCount: goodprice.size,
        minRadius: config.minRadius,
        maxRadius: config.maxRadius,
        estimatesBasis: estimates.basis || '',
      });
    }

    if (route === 'GET /api/geocode') {
      const text = (q.get('q') || '').trim();
      if (!text) throw httpError(400, '위치를 입력해 주세요.');
      if (text.length > 100) throw httpError(400, '위치가 너무 깁니다.');
      return sendJson(res, 200, await geocode(text));
    }

    if (route === 'GET /api/places') {
      const lat = Number(q.get('lat'));
      const lng = Number(q.get('lng'));
      const radius = Math.round(Number(q.get('radius') || 300));
      if (!isValidLatLng(lat, lng)) throw httpError(400, '위치 좌표가 올바르지 않습니다.');
      if (!Number.isFinite(radius) || radius < config.minRadius || radius > config.maxRadius) {
        throw httpError(400, `반경은 ${config.minRadius}~${config.maxRadius}m 사이로 입력해 주세요.`);
      }
      return sendJson(res, 200, await service.findPlaces({ lat, lng, radius }));
    }

    if (route === 'POST /api/details') {
      const body = await readBody(req);
      const list = Array.isArray(body.places) ? body.places.slice(0, 30) : [];
      const places = list
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => Object.fromEntries(PLACE_FIELDS.filter((f) => p[f] !== undefined).map((f) => [f, p[f]])))
        .map((p) => (p.kakaoId !== undefined && !/^\d{1,15}$/.test(String(p.kakaoId)) ? { ...p, kakaoId: undefined } : p));
      return sendJson(res, 200, { results: await service.details(places) });
    }

    throw httpError(404, '없는 주소입니다.');
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, '허용되지 않는 요청입니다.');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw httpError(400, '잘못된 주소입니다.');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (!file.startsWith(publicDir + path.sep)) throw httpError(403, '접근할 수 없습니다.');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw httpError(404, '파일이 없습니다.');
    }
    if (!stat.isFile()) throw httpError(404, '파일이 없습니다.');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[오류]', err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || '서버 오류' });
      else res.end();
    }
  };
}
