// 카카오 로컬 API (공식) - https://developers.kakao.com/docs/latest/ko/local/dev-guide
// 카테고리 검색은 한 번에 최대 45개만 주므로, 식당이 많은 곳은 영역을 4등분해 가며 빠짐없이 모은다.
import { boxAround, splitBox, boxIntersectsCircle, distanceMeters } from '../geo.js';
import { fetchWithTimeout } from '../util.js';

const PAGE_SIZE = 15;
const MAX_PAGEABLE = 45;
// 카테고리(FD6=음식점)에 안 잡히거나 분류가 애매한 곳까지 모으기 위한 추가 키워드
const EXTRA_KEYWORDS = ['기사식당', '한식뷔페', '구내식당', '백반'];
// 반경 안 식당이 너무 많으면(넓은 반경) 전부 대신 싼 한 끼 종류를 반경 전체에서 찾는다
export const WIDE_KEYWORDS = ['김밥', '분식', '떡볶이', '기사식당', '한식뷔페', '구내식당', '백반', '국밥', '해장국', '칼국수', '국수', '중국집', '라면', '도시락', '착한가격업소', '함바'];
export const FULL_SCAN_LIMIT = 1000;

/** 남은 일 ↔ 짧은 문자열 목록 ("r:2", "c:013:1", "k:기사식당:1") */
export function encodeTasks(tasks) {
  return tasks.map((t) => (t.t === 'r' ? `r:${t.pg}` : t.t === 'c' ? `c:${t.path}:${t.pg}` : `${t.t}:${t.q}:${t.pg}`));
}

export function decodeTasks(list) {
  if (!Array.isArray(list) || list.length > 300) throw Object.assign(new Error('잘못된 이어받기 정보입니다.'), { status: 400 });
  return list.map((s) => {
    const m = String(s).match(/^(?:r:([1-3])|c:([0-3]{0,12}):([1-3])|([kw]):([가-힣]{1,10}):([1-3]))$/);
    if (!m) throw Object.assign(new Error('잘못된 이어받기 정보입니다.'), { status: 400 });
    if (m[1]) return { t: 'r', pg: Number(m[1]) };
    if (m[3]) return { t: 'c', path: m[2], pg: Number(m[3]) };
    return { t: m[4], q: m[5], pg: Number(m[6]) };
  });
}

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

  /**
   * 반경 안의 모든 음식점.
   * 요청 수 상한(maxRequests)에 걸리면 남은 일을 continuation 으로 돌려준다.
   * 같은 위치·반경으로 continuation 을 넘겨 다시 부르면 이어서 모은다.
   */
  async function searchFoodPlaces({ lat, lng, radius, continuation = null }) {
    const found = new Map();
    let requests = 0;
    let truncated = false;
    let wide = Boolean(continuation?.some?.((t) => String(t).startsWith('w:')));
    const root = boxAround(lat, lng, radius);
    const CATEGORY = '/v2/local/search/category.json';
    const KEYWORD = '/v2/local/search/keyword.json';
    const base = { category_group_code: 'FD6', x: lng, y: lat, sort: 'distance' };
    const r = Math.round(radius);

    const add = (docs) => {
      for (const doc of docs || []) {
        if (!found.has(doc.id) && isFoodDocument(doc)) found.set(doc.id, toPlace(doc, lat, lng));
      }
    };
    const boxOf = (path) => [...path].reduce((box, q) => splitBox(box)[Number(q)], root);
    const lastPage = (body, page) => body?.meta?.is_end !== false || page >= MAX_PAGEABLE / PAGE_SIZE;

    // 할 일: 반경 검색(r), 영역 검색(c:경로), 키워드 보강(k:키워드). 경로는 영역을 4등분한 번호(0~3)
    const queue = continuation
      ? decodeTasks(continuation)
      : [{ t: 'r', pg: 1 }, ...EXTRA_KEYWORDS.map((q) => ({ t: 'k', q, pg: 1 }))];

    async function run(task) {
      if (task.t === 'r') {
        const body = await call(CATEGORY, { ...base, radius: r, page: task.pg, size: PAGE_SIZE });
        const total = body.meta?.total_count ?? 0;
        if (task.pg === 1 && total > FULL_SCAN_LIMIT) {
          // 넓은 반경: 가까운 식당 + 싼 한 끼 종류를 반경 전체에서 (정확도순이라 멀리 있는 곳도 나온다)
          wide = true;
          add(body.documents);
          queue.splice(0, queue.length, ...WIDE_KEYWORDS.map((q) => ({ t: 'w', q, pg: 1 })));
          return;
        }
        if (task.pg === 1 && total > MAX_PAGEABLE) {
          queue.unshift({ t: 'c', path: '', pg: 1 }); // 식당이 많으면 영역을 쪼개서 전부 모은다
          return;
        }
        add(body.documents);
        if (!lastPage(body, task.pg)) queue.unshift({ ...task, pg: task.pg + 1 });
      } else if (task.t === 'c') {
        const box = boxOf(task.path);
        const body = await call(CATEGORY, {
          ...base,
          rect: `${box.minLng},${box.minLat},${box.maxLng},${box.maxLat}`,
          page: task.pg,
          size: PAGE_SIZE,
        });
        if (task.pg === 1 && (body.meta?.total_count ?? 0) > MAX_PAGEABLE) {
          if (task.path.length < maxDepth) {
            splitBox(box).forEach((child, i) => {
              if (boxIntersectsCircle(child, lat, lng, radius)) queue.unshift({ t: 'c', path: task.path + i, pg: 1 });
            });
            return;
          }
          truncated = true; // 더 쪼갤 수 없을 만큼 빽빽함
        }
        add(body.documents);
        if (!lastPage(body, task.pg)) queue.unshift({ ...task, pg: task.pg + 1 });
      } else {
        const sort = task.t === 'w' ? 'accuracy' : 'distance';
        const body = await call(KEYWORD, { query: task.q, x: lng, y: lat, radius: r, sort, page: task.pg, size: PAGE_SIZE });
        add(body.documents);
        if (!lastPage(body, task.pg)) queue.push({ ...task, pg: task.pg + 1 });
      }
    }

    await new Promise((resolve, reject) => {
      let active = 0;
      let failed = false;
      const pump = () => {
        if (failed) return;
        while (active < concurrency && queue.length && requests < maxRequests) {
          const task = queue.shift();
          requests++;
          active++;
          run(task).then(
            () => {
              active--;
              pump();
            },
            (err) => {
              failed = true;
              reject(err);
            },
          );
        }
        if (active === 0) resolve();
      };
      pump();
    });

    const places = [...found.values()].filter((p) => distanceMeters(lat, lng, p.lat, p.lng) <= radius);
    return { places, truncated, wide, requests, continuation: queue.length ? encodeTasks(queue) : null };
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
