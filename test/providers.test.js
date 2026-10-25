import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createKakaoLocal } from '../src/providers/kakaoLocal.js';
import { createKakaoPlaceDetail, parsePlaceDetail } from '../src/providers/kakaoPlace.js';
import { parseOverpass } from '../src/providers/osm.js';
import { distanceMeters, boxAround, splitBox, boxIntersectsCircle } from '../src/geo.js';

const CENTER = { lat: 37.5636, lng: 126.9826 };

test('거리 계산과 영역 나누기', () => {
  const d = distanceMeters(37.5665, 126.978, 37.5651, 126.9895); // 시청 ~ 을지로입구 근처
  assert.ok(d > 900 && d < 1100, String(d));
  const box = boxAround(CENTER.lat, CENTER.lng, 300);
  assert.ok(Math.abs(distanceMeters(CENTER.lat, CENTER.lng, box.maxLat, CENTER.lng) - 300) < 1);
  const parts = splitBox(box);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((b) => boxIntersectsCircle(b, CENTER.lat, CENTER.lng, 300)));
  const far = { minLat: 37.6, maxLat: 37.61, minLng: 127.1, maxLng: 127.11 };
  assert.equal(boxIntersectsCircle(far, CENTER.lat, CENTER.lng, 300), false);
});

/** 식당 N곳이 있는 가짜 카카오 API (45개 제한까지 흉내) */
function fakeKakao(places, { extra = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push(u);
    assert.equal(opts.headers.Authorization, 'KakaoAK test-key');
    const p = Object.fromEntries(u.searchParams);
    let docs;
    if (u.pathname.endsWith('/category.json')) {
      docs = places.filter((d) => {
        if (p.rect) {
          const [x1, y1, x2, y2] = p.rect.split(',').map(Number);
          return d.x >= x1 && d.x <= x2 && d.y >= y1 && d.y <= y2;
        }
        return distanceMeters(Number(p.y), Number(p.x), d.y, d.x) <= Number(p.radius);
      });
    } else if (u.pathname.endsWith('/keyword.json')) {
      docs = extra[p.query] || [];
    } else docs = [];
    const page = Number(p.page || 1);
    const size = Number(p.size || 15);
    const pageable = docs.slice(0, 45);
    const slice = pageable.slice((page - 1) * size, page * size);
    return new Response(
      JSON.stringify({
        documents: slice.map((d) => ({ ...d, x: String(d.x), y: String(d.y) })),
        meta: { total_count: docs.length, pageable_count: pageable.length, is_end: page * size >= pageable.length },
      }),
      { status: 200 },
    );
  };
  return { fetchImpl, calls };
}

function makePlaces(n) {
  // 중심 주변 600m x 600m 안에 고르게 흩뿌린 식당
  const out = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    out.push({
      id: String(1000 + i),
      place_name: `식당${i}`,
      category_name: '음식점 > 한식',
      category_group_code: 'FD6',
      x: CENTER.lng + (rnd() - 0.5) * 0.0068,
      y: CENTER.lat + (rnd() - 0.5) * 0.0054,
      address_name: '서울 중구 명동2가 1',
      road_address_name: '서울 중구 명동길 1',
      place_url: `http://place.map.kakao.com/${1000 + i}`,
    });
  }
  return out;
}

test('카카오: 식당이 45곳 이하면 반경 검색 한 번으로 끝', async () => {
  const all = makePlaces(30);
  const { fetchImpl } = fakeKakao(all);
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  const { places, truncated } = await kakao.searchFoodPlaces({ ...CENTER, radius: 300 });
  const expected = all.filter((d) => distanceMeters(CENTER.lat, CENTER.lng, d.y, d.x) <= 300).length;
  assert.equal(places.length, expected);
  assert.equal(truncated, false);
  assert.ok(places.every((p) => p.distance <= 300 && p.id.startsWith('kakao:')));
});

test('카카오: 식당이 많으면(45곳 초과) 영역을 쪼개 전부 모은다', async () => {
  const all = makePlaces(400);
  const { fetchImpl, calls } = fakeKakao(all);
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  const { places } = await kakao.searchFoodPlaces({ ...CENTER, radius: 300 });
  const expected = all.filter((d) => distanceMeters(CENTER.lat, CENTER.lng, d.y, d.x) <= 300);
  assert.ok(expected.length > 45);
  assert.equal(places.length, expected.length, '반경 안 식당을 하나도 빠뜨리지 않아야 함');
  assert.ok(calls.some((u) => u.searchParams.has('rect')));
});

test('카카오: 키워드(기사식당 등)로 찾은 곳도 합친다', async () => {
  const all = makePlaces(10);
  const driver = {
    id: '999',
    place_name: '명동기사식당',
    category_name: '음식점 > 한식',
    category_group_code: '',
    x: CENTER.lng + 0.0005,
    y: CENTER.lat,
  };
  const notFood = { id: '998', place_name: '백반 반찬가게', category_name: '가정,생활 > 식품판매', x: CENTER.lng, y: CENTER.lat };
  const { fetchImpl } = fakeKakao(all, { extra: { 기사식당: [driver], 백반: [notFood] } });
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  const { places } = await kakao.searchFoodPlaces({ ...CENTER, radius: 300 });
  assert.ok(places.some((p) => p.name === '명동기사식당'));
  assert.ok(!places.some((p) => p.name === '백반 반찬가게'));
});

test('카카오: 키 오류는 알아듣기 쉬운 메시지', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ errorType: 'AccessDeniedError', message: 'cannot find app' }), { status: 401 });
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  await assert.rejects(kakao.searchFoodPlaces({ ...CENTER, radius: 300 }), /REST API 키가 올바르지 않습니다/);
  const fetch403 = async () =>
    new Response(JSON.stringify({ errorType: 'NotAuthorizedError', message: 'App(x) disabled OPEN_MAP_AND_LOCAL service.' }), { status: 403 });
  const kakao403 = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl: fetch403 });
  await assert.rejects(kakao403.searchFoodPlaces({ ...CENTER, radius: 300 }), /카카오맵\(로컬\) 사용 설정/);
});

test('카카오맵 장소 상세: 메뉴·영업시간 읽기 (실제 응답 형식)', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url)));
  const d = parsePlaceDetail(fixture);
  assert.equal(d.menu.length, 7);
  assert.deepEqual(d.menu[0], { name: '칼만두', price: 11000, desc: '' });
  assert.equal(d.menuUpdatedAt, '2026-08-31');
  assert.equal(d.open.code, 'OPEN');
  assert.equal(d.open.text, '영업 중');
  assert.equal(d.open.today, '11:00 ~ 18:00');
});

test('카카오맵 장소 상세: 예전 형식도 읽기', () => {
  const d = parsePlaceDetail({ menuInfo: { menuList: [{ menu: '김치찌개', price: '8,000' }, { menu: '공기밥', price: '1,000' }] } });
  assert.deepEqual(
    d.menu.map((m) => [m.name, m.price]),
    [
      ['김치찌개', 8000],
      ['공기밥', 1000],
    ],
  );
  assert.equal(parsePlaceDetail(null), null);
});

test('카카오맵 장소 상세: 캐시와 실패 처리', async () => {
  const fixture = fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url), 'utf8');
  let hits = 0;
  const fetchImpl = async (url, opts) => {
    hits++;
    assert.equal(opts.headers.pf, 'web');
    if (String(url).endsWith('/bad')) return new Response('', { status: 406 });
    return new Response(fixture, { status: 200 });
  };
  const store = new Map();
  const cache = {
    getEntry: (k) => store.get(k),
    set: (k, value) => store.set(k, { value, savedAt: Date.now() }),
  };
  const detail = createKakaoPlaceDetail({ baseUrl: 'http://place.test', fetchImpl, cache });
  const a = await detail.getDetail('10185787');
  const b = await detail.getDetail('10185787');
  assert.equal(a.menu.length, 7);
  assert.equal(b.menu.length, 7);
  assert.equal(hits, 1, '두 번째는 캐시에서');
  const bad = await detail.getDetail('bad');
  assert.equal(bad.failed, true);
  assert.equal(detail.getCached('nothing'), undefined);
});

test('OpenStreetMap 결과 읽기', () => {
  const json = {
    elements: [
      { type: 'node', id: 1, lat: 37.5637, lon: 126.9827, tags: { amenity: 'restaurant', name: '김밥나라', cuisine: 'korean' } },
      { type: 'way', id: 2, center: { lat: 37.564, lon: 126.983 }, tags: { amenity: 'fast_food', name: 'Burger', 'name:ko': '버거집', cuisine: 'burger' } },
      { type: 'node', id: 3, lat: 37.5, lon: 126.9, tags: { amenity: 'restaurant' } },
    ],
  };
  const places = parseOverpass(json, CENTER.lat, CENTER.lng);
  assert.equal(places.length, 2);
  assert.equal(places[0].category, '음식점 > 한식');
  assert.equal(places[1].name, '버거집');
  assert.equal(places[1].category, '음식점 > 패스트푸드 > 햄버거');
  assert.ok(places[0].distance < 50);
});

test('OpenStreetMap: 첫 서버가 안 되면 다음 서버 응답을 쓴다', async () => {
  const { createOsm } = await import('../src/providers/osm.js');
  const body = JSON.stringify({ elements: [{ type: 'node', id: 9, lat: CENTER.lat, lon: CENTER.lng, tags: { amenity: 'restaurant', name: '백반집' } }] });
  const fetchImpl = async (url) => {
    if (String(url).includes('bad')) throw new Error('connection reset');
    return new Response(body);
  };
  const osm = createOsm({ overpassUrls: ['http://bad.test/api', 'http://good.test/api'], nominatimUrl: 'http://n.test', userAgent: 't', fetchImpl, hedgeMs: 10 });
  const { places } = await osm.searchFoodPlaces({ ...CENTER, radius: 300 });
  assert.deepEqual(places.map((p) => p.name), ['백반집']);
  const allBad = createOsm({ overpassUrls: ['http://bad.test/a', 'http://bad.test/b'], nominatimUrl: 'http://n.test', userAgent: 't', fetchImpl, hedgeMs: 10 });
  await assert.rejects(allBad.searchFoodPlaces({ ...CENTER, radius: 300 }), /OpenStreetMap 서버에 연결하지 못했습니다/);
});

test('카카오: 요청 수 상한에 걸리면 남은 일을 넘겨주고, 이어 부르면 빠짐없이 모은다', async () => {
  const all = makePlaces(400);
  const expected = all.filter((d) => distanceMeters(CENTER.lat, CENTER.lng, d.y, d.x) <= 300).length;
  const { fetchImpl, calls } = fakeKakao(all);
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl, maxRequests: 12 });
  const ids = new Set();
  let continuation = null;
  let rounds = 0;
  do {
    const before = calls.length;
    const r = await kakao.searchFoodPlaces({ ...CENTER, radius: 300, continuation });
    assert.ok(calls.length - before <= 12, '한 번에 12번을 넘지 않음');
    assert.equal(r.truncated, false);
    for (const p of r.places) ids.add(p.id);
    continuation = r.continuation;
    rounds++;
    if (continuation) assert.ok(JSON.stringify(continuation).length < 2000, '이어받기 정보는 짧게');
  } while (continuation && rounds < 50);
  assert.ok(rounds > 1, '여러 번에 나눠 모음');
  assert.equal(ids.size, expected, '반경 안 식당을 하나도 빠뜨리지 않아야 함');
});

test('카카오: 잘못된 이어받기 정보는 거절', async () => {
  const { fetchImpl } = fakeKakao([]);
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  await assert.rejects(kakao.searchFoodPlaces({ ...CENTER, radius: 300, continuation: ['c:9:1'] }), /이어받기/);
  await assert.rejects(kakao.searchFoodPlaces({ ...CENTER, radius: 300, continuation: 'x' }), /이어받기/);
});

test('카카오: 넓은 반경(식당 1,000곳 초과)이면 싼 한 끼 종류를 반경 전체에서 찾는다', async () => {
  const many = makePlaces(1200).map((d) => ({ ...d, x: CENTER.lng + (d.x - CENTER.lng) * 15, y: CENTER.lat + (d.y - CENTER.lat) * 15 }));
  const far = { id: 'far1', place_name: '멀리김밥', category_name: '음식점 > 분식 > 김밥', category_group_code: 'FD6', x: CENTER.lng + 0.03, y: CENTER.lat };
  const { fetchImpl, calls } = fakeKakao(many, { extra: { 김밥: [far] } });
  const kakao = createKakaoLocal({ apiKey: 'test-key', baseUrl: 'http://kakao.test', fetchImpl });
  const r = await kakao.searchFoodPlaces({ ...CENTER, radius: 5000 });
  assert.equal(r.wide, true);
  assert.ok(r.places.some((p) => p.name === '멀리김밥'), '반경 끝쪽 김밥집도 찾음');
  assert.ok(!calls.some((u) => u.searchParams.has('rect')), '전체 영역 나누기는 하지 않음');
  assert.ok(calls.some((u) => u.pathname.endsWith('/keyword.json') && u.searchParams.get('sort') === 'accuracy'));
  assert.ok(calls.length < 60, String(calls.length));
});
