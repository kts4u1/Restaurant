import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { buildStatic, readAreas, slimPlace } from '../src/staticBuild.js';

const CENTER = { lat: 37.5636, lng: 126.9826 };
const panel = fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url), 'utf8');

function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  if (u.host === 'kakao.test') {
    assert.equal(opts.headers.Authorization, 'KakaoAK secret-key');
    const p = Object.fromEntries(u.searchParams);
    let documents = [];
    if (u.pathname.endsWith('/keyword.json') && p.query === '명동역') {
      documents = [{ id: '9', place_name: '명동역 4호선', address_name: '서울 중구', x: String(CENTER.lng), y: String(CENTER.lat) }];
    }
    if (u.pathname.endsWith('/category.json')) {
      documents = [
        { id: '1', place_name: '칼국수집', category_name: '음식점 > 한식 > 국수 > 칼국수', category_group_code: 'FD6', x: String(CENTER.lng), y: String(CENTER.lat + 0.001) },
        { id: '2', place_name: '김밥집', category_name: '음식점 > 분식', category_group_code: 'FD6', x: String(CENTER.lng + 0.001), y: String(CENTER.lat) },
      ];
    }
    return Promise.resolve(new Response(JSON.stringify({ documents, meta: { total_count: documents.length, is_end: true } })));
  }
  if (u.host === 'place.test') {
    return Promise.resolve(u.pathname.endsWith('/1') ? new Response(panel) : new Response('', { status: 406 }));
  }
  return Promise.reject(new Error('unexpected ' + url));
}

test('areas.json 읽기와 검사', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'areas-'));
  const file = path.join(tmp, 'areas.json');
  fs.writeFileSync(file, JSON.stringify({ areas: [{ name: '집', location: '망원역', radius: 2000 }, { name: '회사', lat: 37.5, lng: 127.0 }] }));
  assert.deepEqual(readAreas(file).map((a) => [a.id, a.name, a.radius]), [['a1', '집', 2000], ['a2', '회사', 1500]]);
  fs.writeFileSync(file, JSON.stringify({ areas: [{ name: '너무 넓음', location: '서울', radius: 10000 }] }));
  assert.throws(() => readAreas(file), /반경은 100~3000m/);
  // 저장소에 들어 있는 기본 areas.json 도 올바른 형식
  assert.ok(readAreas(new URL('../areas.json', import.meta.url).pathname).length >= 1);
});

test('정적 데이터 만들기: 지역 위치 찾기 → 식당 → 메뉴 가격 → 파일', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'static-'));
  const config = loadConfig({
    kakaoRestKey: 'secret-key',
    kakaoApiBase: 'http://kakao.test',
    kakaoPlaceApiBase: 'http://place.test',
    cacheDir: path.join(tmp, 'cache'),
  });
  const outDir = path.join(tmp, 'out');
  const index = await buildStatic({ config, areas: [{ id: 'a1', name: '명동', location: '명동역', radius: 500 }], outDir, fetchImpl: fakeFetch, log: () => {} });
  assert.equal(index.areas[0].count, 2);
  assert.equal(index.areas[0].realPriceCount, 1);
  const data = JSON.parse(fs.readFileSync(path.join(outDir, 'a1.json'), 'utf8'));
  const kal = data.places.find((p) => p.kakaoId === '1');
  assert.deepEqual([kal.price.source, kal.price.amount], ['menu', 10000]);
  assert.equal(kal.open, undefined, '영업 중 여부는 금방 바뀌므로 저장하지 않음');
  const all = fs.readFileSync(path.join(outDir, 'a1.json'), 'utf8') + fs.readFileSync(path.join(outDir, 'index.json'), 'utf8');
  assert.ok(!all.includes('secret-key'), '키가 사이트 파일에 들어가면 안 됨');
});

test('키가 없으면 알기 쉬운 오류', async () => {
  await assert.rejects(buildStatic({ config: loadConfig({ kakaoRestKey: '' }), areas: [], outDir: os.tmpdir(), log: () => {} }), /Secrets and variables/);
});

test('slimPlace 는 필요한 값만 남긴다', () => {
  const s = slimPlace({ id: 'x', name: 'n', lat: 37.123456789, lng: 127.1, price: { amount: 1 }, menu: [{ name: 'a', price: 5000, meal: true, desc: '긴 설명' }], open: { code: 'OPEN' } });
  assert.equal(s.lat, 37.123457);
  assert.deepEqual(s.menu, [{ name: 'a', price: 5000, meal: true, note: undefined }]);
  assert.equal('open' in s, false);
});
