// 검색 흐름: 장소 모으기 → 착한가격업소 합치기 → 가격 정하기
import { classify } from './categories.js';
import { resolvePrice, analyzeMenu } from './pricing.js';
import { distanceMeters } from './geo.js';
import { createCache } from './util.js';

const OPEN_FRESH_MS = 60 * 60 * 1000;
const seoulDate = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

/** 메뉴판에 '한 끼 아님' 이유를 붙인다 (메뉴 보기 화면용) */
function menuWithFlags(menu, context) {
  const { rows } = analyzeMenu(menu, { context });
  return menu.map((m, i) => ({ ...m, meal: !rows[i].reason, note: rows[i].reason || null }));
}

export function createSearchService({
  primary,
  fallback,
  placeDetail,
  goodprice,
  userPrices = null,
  estimate,
  maxPlaces = 600,
  now = () => Date.now(),
  placesCache = createCache({ ttlMs: 30 * 60 * 1000 }),
}) {

  /** 영업 정보는 1시간 안에 확인한 것만 보여준다 (오늘 영업시간은 당일까지) */
  function openInfo(detail) {
    if (!detail?.open || !detail.fetchedAt) return null;
    const age = now() - detail.fetchedAt;
    if (age <= OPEN_FRESH_MS) return { ...detail.open, checkedAt: detail.fetchedAt };
    if (seoulDate(detail.fetchedAt) === seoulDate(now()) && detail.open.today) {
      return { code: null, text: '', info: '', today: detail.open.today, checkedAt: detail.fetchedAt };
    }
    return null;
  }

  function enrich(place, detail) {
    const { key, label } = classify(place.category, place.name);
    const det = detail !== undefined ? detail : place.kakaoId ? placeDetail?.getCached(place.kakaoId) : undefined;
    const gp = place.goodprice !== undefined ? place.goodprice : goodprice.match(place);
    const context = `${place.category || ''} ${place.name || ''}`;
    const price = resolvePrice({
      userPrice: userPrices?.get(place.id) || null,
      menuItems: det?.menu,
      menuUpdatedAt: det?.menuUpdatedAt,
      goodprice: gp,
      estimate: estimate(place.category, place.name),
      context,
    });
    let detailStatus = 'none';
    if (place.kakaoId) {
      if (det === undefined || det === null) detailStatus = placeDetail?.enabled ? 'pending' : 'disabled';
      else detailStatus = det.failed ? 'failed' : 'done';
    }
    const { goodprice: _omit, ...rest } = place;
    return {
      ...rest,
      group: key,
      groupLabel: label,
      goodprice: gp ? { id: gp.id, name: gp.name, date: gp.date, menus: gp.menus } : null,
      price,
      menu: menuWithFlags(det?.menu?.length ? det.menu : gp?.menus || [], context),
      menuUpdatedAt: det?.menuUpdatedAt || null,
      open: openInfo(det),
      detailStatus,
    };
  }

  async function collect({ lat, lng, radius, continuation = null }) {
    // 끝까지 다 모은 결과만 저장해 둔다
    const key = `${lat.toFixed(4)},${lng.toFixed(4)},${radius}`;
    const cached = continuation ? null : placesCache.get(key);
    if (cached) return cached;

    const warnings = [];
    let result = null;
    let provider = null;
    for (const p of [primary, fallback].filter(Boolean)) {
      try {
        result = await p.searchFoodPlaces({ lat, lng, radius, continuation });
        provider = p.name;
        break;
      } catch (err) {
        if (continuation) throw err; // 이어 모으기는 같은 곳(카카오)에서만
        warnings.push(err.message);
      }
    }
    if (!result) {
      const err = new Error(warnings.join(' / ') || '식당 정보를 가져오지 못했습니다.');
      err.status = 502;
      throw err;
    }
    if (result.truncated) warnings.push('식당이 아주 많아 일부 구역은 다 못 가져왔을 수 있습니다. 반경을 줄이면 더 정확합니다.');
    const value = { provider, places: result.places, warnings, continuation: result.continuation || null };
    if (!continuation && !value.continuation) placesCache.set(key, value);
    return value;
  }

  /**
   * continuation 이 돌아오면 아직 덜 모은 것 → 같은 위치·반경으로 continuation 을 넘겨 다시 부르면 이어서 모은다.
   */
  async function findPlaces({ lat, lng, radius, continuation = null }) {
    const { provider, places: found, warnings, continuation: next } = await collect({ lat, lng, radius, continuation });
    const places = [...found];

    // 착한가격업소: 검색된 식당과 연결하고, 지도 데이터에 없는 업소는 따로 추가
    const matched = new Set();
    for (let i = 0; i < places.length; i++) {
      const gp = goodprice.match(places[i]);
      places[i] = { ...places[i], goodprice: gp };
      if (gp) matched.add(gp.id);
    }
    for (const e of continuation ? [] : goodprice.nearby(lat, lng, radius)) {
      if (matched.has(e.id)) continue;
      places.push({
        id: e.id,
        name: e.name,
        category: `음식점 > ${e.industry || '착한가격업소'}`,
        phone: e.phone,
        address: e.address,
        lat: e.lat,
        lng: e.lng,
        url: `https://map.kakao.com/?q=${encodeURIComponent(`${e.name} ${e.address}`)}`,
        distance: Math.round(distanceMeters(lat, lng, e.lat, e.lng)),
        provider: 'goodprice',
        goodprice: e,
      });
    }

    places.sort((a, b) => a.distance - b.distance);
    if (places.length > maxPlaces) {
      warnings.push(`식당이 ${places.length}곳이라 가까운 ${maxPlaces}곳만 표시합니다.`);
      places.length = maxPlaces;
    }
    return {
      provider,
      center: { lat, lng },
      radius,
      warnings,
      continuation: next,
      places: places.map((p) => enrich(p)),
    };
  }

  /** 카카오맵 메뉴·영업시간을 가져와 가격을 다시 계산 */
  async function details(places) {
    const results = {};
    await Promise.all(
      places.map(async (p) => {
        const detail = p.kakaoId && placeDetail ? await placeDetail.getDetail(p.kakaoId) : null;
        results[p.id] = enrich(p, detail ?? undefined);
      }),
    );
    return results;
  }

  return { findPlaces, details, enrich };
}
