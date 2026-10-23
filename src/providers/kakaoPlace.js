// 카카오맵 장소 상세(메뉴·가격·영업시간)
// 공식 API가 아니라 카카오맵 웹페이지가 쓰는 데이터를 읽는다. 형식이 바뀌면 메뉴 가격만 빠지고
// 나머지 기능(장소 검색, 추정 가격)은 그대로 동작한다.
import { createLimiter, fetchWithTimeout } from '../util.js';
import { parsePrice } from '../pricing.js';

const HEADERS = {
  pf: 'web',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://place.map.kakao.com/',
  Origin: 'https://place.map.kakao.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

const toDate = (s) => (typeof s === 'string' && s.length >= 10 ? s.slice(0, 10) : null);

/** 카카오맵 장소 JSON → { menu, menuUpdatedAt, open } */
export function parsePlaceDetail(data) {
  if (!data || typeof data !== 'object') return null;
  const menu = [];
  let menuUpdatedAt = null;

  // 현재 형식: menu.menus.items[{ name, price, desc }]
  const items = data.menu?.menus?.items;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it?.name) menu.push({ name: String(it.name).trim(), price: parsePrice(it.price), desc: it.desc || '' });
    }
    menuUpdatedAt = toDate(data.menu.menus.items_updated_at) || toDate(items[0]?.mod_at);
  }
  // 예전 형식: menuInfo.menuList[{ menu, price: "8,000" }]
  const legacy = data.menuInfo?.menuList;
  if (!menu.length && Array.isArray(legacy)) {
    for (const it of legacy) {
      if (it?.menu) menu.push({ name: String(it.menu).trim(), price: parsePrice(it.price), desc: it.desc || '' });
    }
    menuUpdatedAt = toDate(data.menuInfo?.timeexp) || null;
  }

  let open = null;
  const headline = data.open_hours?.headline;
  if (headline) {
    let today = null;
    for (const period of data.open_hours.week_from_today?.week_periods || []) {
      for (const day of period.days || []) {
        if (day.is_highlight) today = day.on_days?.start_end_time_desc || day.off_days_desc || null;
      }
    }
    open = {
      code: headline.code || null,
      text: headline.display_text || '',
      info: headline.display_text_info || '',
      today,
    };
  }
  return { menu, menuUpdatedAt, open, status: data.summary?.status || null };
}

export function createKakaoPlaceDetail({
  baseUrl = 'https://place-api.map.kakao.com',
  fetchImpl = fetch,
  cache,
  concurrency = 4,
  enabled = true,
}) {
  const limit = createLimiter(concurrency);
  const FAIL_TTL = 30 * 60 * 1000;

  async function fetchDetail(kakaoId) {
    const url = new URL(`/places/panel3/${encodeURIComponent(kakaoId)}`, baseUrl);
    const res = await fetchWithTimeout(fetchImpl, url, { headers: HEADERS }, 8000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePlaceDetail(await res.json());
  }

  /** 캐시에 있으면 바로 돌려준다 (네트워크 사용 안 함) */
  function getCached(kakaoId) {
    const entry = cache?.getEntry(kakaoId);
    return entry ? { ...entry.value, fetchedAt: entry.savedAt } : undefined;
  }

  async function getDetail(kakaoId) {
    const cached = getCached(kakaoId);
    if (cached !== undefined) return cached;
    if (!enabled) return null;
    return limit(async () => {
      const again = getCached(kakaoId);
      if (again !== undefined) return again;
      try {
        const detail = await fetchDetail(kakaoId);
        cache?.set(kakaoId, detail);
        return { ...detail, fetchedAt: Date.now() };
      } catch {
        // 실패하면 잠시 다시 시도하지 않는다
        cache?.set(kakaoId, { menu: [], menuUpdatedAt: null, open: null, failed: true }, FAIL_TTL);
        return { menu: [], menuUpdatedAt: null, open: null, failed: true, fetchedAt: Date.now() };
      }
    });
  }

  return { getDetail, getCached, enabled };
}
