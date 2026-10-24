// 카카오 키가 없을 때 쓰는 대체 데이터: OpenStreetMap (Overpass API / Nominatim)
import { distanceMeters } from '../geo.js';
import { fetchWithTimeout } from '../util.js';

const CUISINE_KO = {
  korean: '한식',
  chinese: '중식 > 중국요리',
  japanese: '일식',
  sushi: '일식 > 초밥',
  ramen: '일식 > 라멘',
  udon: '일식 > 우동',
  noodle: '한식 > 국수',
  noodles: '한식 > 국수',
  burger: '패스트푸드 > 햄버거',
  sandwich: '패스트푸드 > 샌드위치',
  pizza: '양식 > 피자',
  chicken: '치킨',
  fried_chicken: '치킨',
  italian: '양식 > 이탈리안',
  western: '양식',
  steak_house: '양식 > 스테이크',
  vietnamese: '아시아음식 > 베트남음식',
  thai: '아시아음식 > 태국음식',
  indian: '아시아음식 > 인도음식',
  asian: '아시아음식',
  mexican: '아시아음식 > 멕시칸',
  buffet: '뷔페',
  barbecue: '한식 > 육류,고기',
  bbq: '한식 > 육류,고기',
  seafood: '한식 > 해물,생선',
  kimbap: '분식 > 김밥',
  gimbap: '분식 > 김밥',
  snack: '분식',
  coffee_shop: '간식',
  bakery: '간식 > 제과,베이커리',
  ice_cream: '간식 > 아이스크림',
  dessert: '간식 > 디저트',
};

export function osmCategory(tags = {}) {
  const cuisines = String(tags.cuisine || '')
    .split(/[;,]/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  for (const c of cuisines) if (CUISINE_KO[c]) return `음식점 > ${CUISINE_KO[c]}`;
  if (tags.amenity === 'food_court') return '음식점 > 푸드코트';
  if (tags.amenity === 'fast_food') return '음식점 > 패스트푸드';
  return '음식점';
}

export function parseOverpass(json, lat, lng) {
  const places = [];
  for (const el of json?.elements || []) {
    const tags = el.tags || {};
    const name = tags['name:ko'] || tags.name;
    const plat = el.lat ?? el.center?.lat;
    const plng = el.lon ?? el.center?.lon;
    if (!name || !Number.isFinite(plat) || !Number.isFinite(plng)) continue;
    const address = [tags['addr:city'], tags['addr:district'], tags['addr:street'], tags['addr:housenumber']]
      .filter(Boolean)
      .join(' ');
    places.push({
      id: `osm:${el.type}/${el.id}`,
      name,
      category: osmCategory(tags),
      phone: tags.phone || tags['contact:phone'] || '',
      address: tags['addr:full'] || address,
      lat: plat,
      lng: plng,
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      distance: Math.round(distanceMeters(lat, lng, plat, plng)),
      provider: 'osm',
    });
  }
  return places;
}

export function createOsm({ overpassUrls, nominatimUrl, userAgent, fetchImpl = fetch, hedgeMs = 6000 }) {
  async function queryOverpass(endpoint, query, lat, lng, radius) {
    const res = await fetchWithTimeout(
      fetchImpl,
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': userAgent },
        body: 'data=' + encodeURIComponent(query),
      },
      30000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const places = parseOverpass(await res.json(), lat, lng).filter((p) => distanceMeters(lat, lng, p.lat, p.lng) <= radius);
    return { places, truncated: false };
  }

  /** 첫 서버가 늦으면 몇 초 뒤 다음 서버에도 물어보고, 먼저 온 답을 쓴다 */
  async function searchFoodPlaces({ lat, lng, radius, continuation = null }) {
    if (continuation) throw Object.assign(new Error('이어 모으기는 카카오 검색에서만 됩니다.'), { status: 400 });
    const query = `[out:json][timeout:25];nwr(around:${Math.round(radius)},${lat},${lng})["amenity"~"^(restaurant|fast_food|food_court)$"];out center tags;`;
    let settled = false;
    const attempts = overpassUrls.map(
      (endpoint, i) =>
        new Promise((resolve, reject) => {
          setTimeout(() => {
            if (settled) return reject(new Error('취소'));
            queryOverpass(endpoint, query, lat, lng, radius).then(resolve, reject);
          }, i * hedgeMs);
        }),
    );
    try {
      const result = await Promise.any(attempts);
      settled = true;
      return result;
    } catch (err) {
      const reason = err.errors?.map((e) => e.message).join(', ') || err.message;
      throw new Error(`OpenStreetMap 서버에 연결하지 못했습니다 (${reason})`);
    }
  }

  async function geocode(query) {
    const url = new URL('/search', nominatimUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('countrycodes', 'kr');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'ko');
    const res = await fetchWithTimeout(fetchImpl, url, { headers: { 'User-Agent': userAgent } }, 10000);
    if (!res.ok) throw new Error(`위치 검색 실패 (HTTP ${res.status})`);
    const rows = await res.json();
    return rows.map((r) => ({
      name: r.name || String(r.display_name).split(',')[0],
      address: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.category === 'place' || r.addresstype === 'road' ? 'address' : 'place',
    }));
  }

  return { searchFoodPlaces, geocode, name: 'osm' };
}
