// /api/* 요청 처리 (Node.js 서버와 Cloudflare Workers 공통)
import { isValidLatLng } from './geo.js';

const PLACE_FIELDS = ['id', 'kakaoId', 'name', 'category', 'address', 'jibunAddress', 'lat', 'lng', 'phone', 'url', 'distance', 'provider'];

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export const maskKey = (key) => (key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '');

/**
 * @param {object} o
 * @param {object} o.config
 * @param {() => object} o.getServices  현재 서비스 (키가 바뀌면 새것)
 * @param {(key: string) => Promise<object>} [o.setKey]  앱 화면에서 키 저장 (PC 서버만)
 * @param {'local'|'secret'} [o.keySource]  키를 어디서 넣는지
 * @param {number} [o.detailBatch]  메뉴 가격을 한 번에 몇 곳씩 물어볼지
 */
export function createApi({ config, getServices, setKey = null, keySource = 'local', detailBatch = 8 }) {
  async function geocode(q) {
    const { kakao, osm } = getServices();
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

  async function handle({ method, pathname, searchParams: q, readBody, isLocal }) {
    const route = `${method} ${pathname}`;
    const { kakao, placeDetail, goodprice, estimates, service } = getServices();

    if (route === 'GET /api/status') {
      return {
        kakao: Boolean(kakao),
        keySource,
        keyMasked: maskKey(config.kakaoRestKey),
        canEditKey: Boolean(setKey) && isLocal,
        provider: kakao ? 'kakao' : 'osm',
        menuFetch: placeDetail.enabled,
        goodpriceCount: goodprice.size,
        minRadius: config.minRadius,
        maxRadius: config.maxRadius,
        detailBatch,
        estimatesBasis: estimates.basis || '',
      };
    }

    if (route === 'GET /api/geocode') {
      const text = (q.get('q') || '').trim();
      if (!text) throw httpError(400, '위치를 입력해 주세요.');
      if (text.length > 100) throw httpError(400, '위치가 너무 깁니다.');
      return geocode(text);
    }

    if (route === 'GET /api/places') {
      const lat = Number(q.get('lat'));
      const lng = Number(q.get('lng'));
      const radius = Math.round(Number(q.get('radius') || 300));
      if (!isValidLatLng(lat, lng)) throw httpError(400, '위치 좌표가 올바르지 않습니다.');
      if (!Number.isFinite(radius) || radius < config.minRadius || radius > config.maxRadius) {
        throw httpError(400, `반경은 ${config.minRadius}~${config.maxRadius}m 사이로 입력해 주세요.`);
      }
      return service.findPlaces({ lat, lng, radius });
    }

    if (route === 'POST /api/details') {
      const body = await readBody();
      const list = Array.isArray(body.places) ? body.places.slice(0, Math.max(detailBatch, 1) * 4) : [];
      const places = list
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => Object.fromEntries(PLACE_FIELDS.filter((f) => p[f] !== undefined).map((f) => [f, p[f]])))
        .map((p) => (p.kakaoId !== undefined && !/^\d{1,15}$/.test(String(p.kakaoId)) ? { ...p, kakaoId: undefined } : p));
      return { results: await service.details(places) };
    }

    if (route === 'POST /api/kakao-key') {
      if (!setKey) throw httpError(404, '없는 주소입니다.');
      if (!isLocal) {
        throw httpError(403, '카카오 키는 서버를 켠 컴퓨터에서 http://localhost:' + config.port + ' 으로 열어서 넣어 주세요.');
      }
      return setKey(String((await readBody()).key || '').trim());
    }

    throw httpError(404, '없는 주소입니다.');
  }

  /** @returns {Promise<{status:number, body:object}>} */
  return async function route(req) {
    try {
      return { status: 200, body: await handle(req) };
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[오류]', err);
      return { status, body: { error: err.message || '서버 오류' } };
    }
  };
}
