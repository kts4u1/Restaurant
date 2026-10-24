// 카카오 로컬 API (공식) - https://developers.kakao.com/docs/latest/ko/local/dev-guide
// 카테고리 검색은 한 번에 최대 45개만 주므로, 식당이 많은 곳은 영역을 4등분해 가며 빠짐없이 모은다.
import { boxAround, splitBox, boxIntersectsCircle, distanceMeters } from '../geo.js';
import { createLimiter, fetchWithTimeout } from '../util.js';

const PAGE_SIZE = 15;
const MAX_PAGEABLE = 45;
// 카테고리(FD6=음식점)에 안 잡히거나 분류가 애매한 곳까지 모으기 위한 추가 키워드
const EXTRA_KEYWORDS = ['기사식당', '한식뷔페', '구내식당', '백반'];

export class KakaoApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'KakaoApiError';
    this.status = status;
  }
}

function explainError(status, message = '') {
  if (status === 401) return '카카오 REST API 키가 올바르지 않습니다. .env 파일의 KAKAO_REST_API_KEY 값을 확인해 주세요.';
  if (/OPEN_MAP_AND_LOCAL|disabled/i.test(message)) {
    return '카카오 개발자 콘솔에서 카카오맵(로컬) 사용 설정이 꺼져 있습니다. [내 애플리케이션 > 앱 설정 또는 제품 설정 > 카카오맵]에서 사용 설정을 켜 주세요.';
  }
  if (status === 429) return '카카오 API 일일 사용량을 초과했습니다. 잠시 후 다시 시도해 주세요.';
  return `카카오 API 오류 (${status}): ${message}`;
}

export function isFoodDocument(doc) {
  return (
    doc.category_group_code === 'FD6' ||
    /음식점|식당|뷔페/.test(doc.category_name || '') ||
    /식당|뷔페|부페/.test(doc.place_name || '')
  );
}

export function toPlace(doc, lat, lng) {
  const plat = Number(doc.y);
  const plng = Number(doc.x);
  return {
    id: `kakao:${doc.id}`,
    kakaoId: String(doc.id),
    name: doc.place_name,
    category: doc.category_name || '',
    phone: doc.phone || '',
    address: doc.road_address_name || doc.address_name || '',
    jibunAddress: doc.address_name || '',
    lat: plat,
    lng: plng,
    url: doc.place_url || `https://place.map.kakao.com/${doc.id}`,
    distance: Math.round(distanceMeters(lat, lng, plat, plng)),
    provider: 'kakao',
  };
}

export function createKakaoLocal({
  apiKey,
  baseUrl = 'https://dapi.kakao.com',
  fetchImpl = fetch,
  maxDepth = 6,
  maxRequests = 250,
  concurrency = 4,
}) {
  async function call(pathname, params) {
    const url = new URL(pathname, baseUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
    let res;
    try {
      res = await fetchWithTimeout(fetchImpl, url, { headers: { Authorization: `KakaoAK ${apiKey}` } }, 10000);
    } catch (err) {
      throw new KakaoApiError(`카카오 API에 연결하지 못했습니다: ${err.message}`, 0);
    }
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // JSON 이 아닌 응답
    }
    if (!res.ok) throw new KakaoApiError(explainError(res.status, body?.message || body?.msg || text.slice(0, 200)), res.status);
    return body || { documents: [], meta: { is_end: true, total_count: 0 } };
  }

  /** 반경 안의 모든 음식점 */
  async function searchFoodPlaces({ lat, lng, radius }) {
    const limit = createLimiter(concurrency);
    const found = new Map();
    let requests = 0;
    let truncated = false;
    // 요청 수 상한 (Cloudflare 무료 플랜은 한 번에 50개까지). 넘으면 더 묻지 않고 '일부만'으로 표시
    const request = async (pathname, params) => {
      if (requests >= maxRequests) {
        truncated = true;
        return null;
      }
      requests++;
      return limit(() => call(pathname, params));
    };
    const add = (docs) => {
      for (const doc of docs || []) {
        if (!found.has(doc.id) && isFoodDocument(doc)) found.set(doc.id, toPlace(doc, lat, lng));
      }
    };
    const restPages = async (pathname, params, first) => {
      add(first.documents);
      let body = first;
      for (let page = 2; page <= MAX_PAGEABLE / PAGE_SIZE && body?.meta?.is_end === false; page++) {
        body = await request(pathname, { ...params, page, size: PAGE_SIZE });
        if (body) add(body.documents);
      }
    };

    const CATEGORY = '/v2/local/search/category.json';
    const base = { category_group_code: 'FD6', x: lng, y: lat, sort: 'distance' };

    // 1) 반경 검색: 45개 이하면 이걸로 끝
    const circleParams = { ...base, radius: Math.round(radius) };
    const first = await request(CATEGORY, { ...circleParams, page: 1, size: PAGE_SIZE });
    if ((first.meta?.total_count ?? 0) <= MAX_PAGEABLE) {
      await restPages(CATEGORY, circleParams, first);
    } else {
      // 2) 식당이 많으면 영역을 쪼개서 전부 모은다
      const searchCell = async (box, depth) => {
        if (!boxIntersectsCircle(box, lat, lng, radius)) return;
        const params = { ...base, rect: `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}` };
        const body = await request(CATEGORY, { ...params, page: 1, size: PAGE_SIZE });
        if (!body) return;
        const total = body.meta?.total_count ?? 0;
        if (total > MAX_PAGEABLE) {
          if (depth < maxDepth && requests + 4 <= maxRequests) {
            await Promise.all(splitBox(box).map((b) => searchCell(b, depth + 1)));
            return;
          }
          truncated = true;
        }
        await restPages(CATEGORY, params, body);
      };
      await searchCell(boxAround(lat, lng, radius), 0);
    }

    // 3) 기사식당·한식뷔페·구내식당 등 키워드 보강 (남은 요청 수 안에서만, 상한 때문에 빠져도 '일부만' 표시는 안 함)
    const KEYWORD = '/v2/local/search/keyword.json';
    const wasTruncated = truncated;
    await Promise.all(
      EXTRA_KEYWORDS.map(async (query) => {
        const params = { query, x: lng, y: lat, radius: Math.round(radius), sort: 'distance' };
        const body = await request(KEYWORD, { ...params, page: 1, size: PAGE_SIZE });
        if (body) await restPages(KEYWORD, params, body);
      }),
    );
    truncated = wasTruncated;

    const places = [...found.values()].filter((p) => distanceMeters(lat, lng, p.lat, p.lng) <= radius);
    return { places, truncated, requests };
  }

  /** 위치 이름/주소 → 좌표 후보 */
  async function geocode(query) {
    const [addr, keyword] = await Promise.all([
      call('/v2/local/search/address.json', { query, size: 5 }).catch(() => ({ documents: [] })),
      call('/v2/local/search/keyword.json', { query, size: 5 }),
    ]);
    const results = [];
    for (const d of addr.documents || []) {
      results.push({
        name: d.road_address?.building_name || d.address_name,
        address: d.road_address?.address_name || d.address_name,
        lat: Number(d.y),
        lng: Number(d.x),
        type: 'address',
      });
    }
    for (const d of keyword.documents || []) {
      results.push({
        name: d.place_name,
        address: d.road_address_name || d.address_name,
        lat: Number(d.y),
        lng: Number(d.x),
        type: 'place',
      });
    }
    // 거의 같은 위치는 하나만
    return results.filter(
      (r, i) => results.findIndex((o) => distanceMeters(o.lat, o.lng, r.lat, r.lng) < 15) === i,
    );
  }

  return { searchFoodPlaces, geocode, name: 'kakao' };
}
