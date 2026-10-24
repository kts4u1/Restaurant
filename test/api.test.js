import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { buildServices, createHandler } from '../src/app.js';

const CENTER = { lat: 37.5636, lng: 126.9826 };
const panelFixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url)));

const DOCS = [
  { id: '1', place_name: '명동칼국수', category_name: '음식점 > 한식 > 국수 > 칼국수', category_group_code: 'FD6', dy: 0.0005, dx: 0 },
  { id: '2', place_name: '김밥나라 명동점', category_name: '음식점 > 분식 > 김밥', category_group_code: 'FD6', dy: 0, dx: 0.0008 },
  { id: '3', place_name: '을지로기사식당', category_name: '음식점 > 기사식당', category_group_code: 'FD6', dy: -0.001, dx: 0 },
  { id: '4', place_name: '명동 호프', category_name: '음식점 > 술집 > 호프,요리주점', category_group_code: 'FD6', dy: 0.0003, dx: 0.0003 },
  { id: '5', place_name: '아주먼식당', category_name: '음식점 > 한식', category_group_code: 'FD6', dy: 0.01, dx: 0.01 },
];

const MENUS = {
  1: panelFixture,
  2: { menu: { menus: { items: [{ name: '원조김밥', price: 3500 }, { name: '라면', price: 5000 }, { name: '콜라', price: 2000 }], items_updated_at: '2026-01-10 10:00:00' } } },
  3: { menu: { menus: { items: [] } } },
};

function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  if (u.host === 'kakao.test') {
    assert.equal(opts.headers.Authorization, 'KakaoAK test-key');
    const p = Object.fromEntries(u.searchParams);
    let docs = [];
    if (u.pathname.endsWith('/category.json')) docs = DOCS;
    if (u.pathname.endsWith('/keyword.json')) {
      docs = p.query === '기사식당' ? DOCS.filter((d) => d.id === '3') : [];
      if (p.query === '명동역') docs = [{ id: '77', place_name: '명동역 4호선', address_name: '서울 중구 충무로2가', x: String(CENTER.lng), y: String(CENTER.lat) }];
    }
    if (u.pathname.endsWith('/address.json')) docs = [];
    const documents = docs.map((d) =>
      d.dx === undefined ? d : { ...d, x: String(CENTER.lng + d.dx), y: String(CENTER.lat + d.dy), place_url: `http://place.map.kakao.com/${d.id}` },
    );
    return Promise.resolve(new Response(JSON.stringify({ documents, meta: { total_count: documents.length, is_end: true } })));
  }
  if (u.host === 'place.test') {
    const id = u.pathname.split('/').pop();
    if (!MENUS[id]) return Promise.resolve(new Response('', { status: 406 }));
    return Promise.resolve(new Response(JSON.stringify(MENUS[id])));
  }
  return Promise.reject(new Error('unexpected ' + url));
}

let server;
let base;
let tmp;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hankki-'));
  fs.writeFileSync(path.join(tmp, 'price-estimates.json'), fs.readFileSync(new URL('../data/price-estimates.json', import.meta.url)));
  fs.writeFileSync(
    path.join(tmp, 'goodprice.json'),
    JSON.stringify([
      { id: 'gp:a', name: '을지로기사식당', address: '서울 중구 을지로 1', lat: CENTER.lat - 0.001, lng: CENTER.lng, menus: [{ name: '돼지불백', price: 8000 }], date: '2026-05-01' },
      { id: 'gp:b', name: '착한분식', address: '서울 중구 명동길 9', lat: CENTER.lat + 0.0002, lng: CENTER.lng, menus: [{ name: '떡볶이', price: 4000 }], industry: '한식' },
    ]),
  );
  const config = loadConfig({
    kakaoRestKey: 'test-key',
    kakaoApiBase: 'http://kakao.test',
    kakaoPlaceApiBase: 'http://place.test',
    dataDir: tmp,
    cacheDir: path.join(tmp, 'cache'),
    enableMenuFetch: true,
  });
  const services = buildServices(config, { fetchImpl: fakeFetch });
  server = http.createServer(createHandler(config, services));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};
const post = async (p, body) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('상태', async () => {
  const { body } = await get('/api/status');
  assert.equal(body.kakao, true);
  assert.equal(body.goodpriceCount, 2);
});

test('위치 검색(지오코딩)', async () => {
  const { body } = await get('/api/geocode?q=' + encodeURIComponent('명동역'));
  assert.equal(body.candidates[0].name, '명동역 4호선');
  assert.equal(body.provider, 'kakao');
});

test('주변 식당 → 메뉴 가격 → 가격순', async () => {
  const { status, body } = await get(`/api/places?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=300`);
  assert.equal(status, 200);
  const names = body.places.map((p) => p.name);
  assert.ok(!names.includes('아주먼식당'), '반경 밖은 제외');
  assert.ok(names.includes('착한분식'), '지도에 없는 착한가격업소도 추가');
  const driver = body.places.find((p) => p.name === '을지로기사식당');
  assert.equal(driver.goodprice.name, '을지로기사식당');
  assert.equal(driver.price.source, 'goodprice');
  assert.equal(driver.price.amount, 8000);
  const kimbap = body.places.find((p) => p.kakaoId === '2');
  assert.equal(kimbap.detailStatus, 'pending');
  assert.equal(kimbap.price.isEstimate, true);
  assert.equal(body.places.find((p) => p.kakaoId === '4').group, 'bar');

  const kakaoPlaces = body.places.filter((p) => p.kakaoId);
  const { body: det } = await post('/api/details', { places: kakaoPlaces });
  const kb = det.results['kakao:2'];
  assert.equal(kb.detailStatus, 'done');
  assert.deepEqual([kb.price.source, kb.price.amount, kb.price.menuName], ['menu', 3500, '원조김밥']);
  assert.equal(kb.menuUpdatedAt, '2026-01-10');
  assert.equal(kb.menu.find((m) => m.name === '콜라').meal, false);
  const kal = det.results['kakao:1'];
  assert.equal(kal.price.amount, 10000);
  assert.equal(kal.open.code, 'OPEN');
  // 메뉴가 빈 기사식당은 착한가격업소 가격 유지
  assert.equal(det.results['kakao:3'].price.source, 'goodprice');
  // 메뉴 정보를 못 가져온 곳은 실패로 표시하고 추정 가격
  assert.equal(det.results['kakao:4'].detailStatus, 'failed');
  assert.equal(det.results['kakao:4'].price.isEstimate, true);

  // 다시 검색하면 캐시된 메뉴 가격이 바로 들어있다
  const { body: again } = await get(`/api/places?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=300`);
  assert.equal(again.places.find((p) => p.kakaoId === '2').price.amount, 3500);
});

test('잘못된 입력', async () => {
  const odd = await post('/api/details', { places: [{ id: 'kakao:x', kakaoId: '../../etc', name: '이상한 곳', category: '음식점' }] });
  assert.equal(odd.status, 200);
  assert.equal(odd.body.results['kakao:x'].detailStatus, 'none', '숫자가 아닌 카카오 ID 는 무시');
  assert.equal((await get('/api/places?lat=abc&lng=1&radius=300')).status, 400);
  assert.equal((await get(`/api/places?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=99999`)).status, 400);
  assert.equal((await get('/api/geocode?q=')).status, 400);
  assert.equal((await get('/api/nothing')).status, 404);
});

test('화면 파일 제공과 경로 보호', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /한끼 최저가/);
  const evil = await fetch(base + '/..%2f..%2fpackage.json');
  assert.ok([403, 404].includes(evil.status));
});
