import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { baseConfig } from '../src/configCore.js';
import { createServices, createSharedCaches } from '../src/services.js';
import { createApi } from '../src/api.js';

const panel = fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url), 'utf8');

test('Cloudflare 방식: 키는 시크릿에서, 화면에서 바꿀 수 없음', async () => {
  const config = baseConfig({ KAKAO_REST_API_KEY: 'a1b2c3d4e5f60718293a4b5c6d7e8f90' });
  const services = createServices(config, { fetchImpl: async () => new Response('{}') });
  const api = createApi({ config, getServices: () => services, keySource: 'secret', detailBatch: 4 });
  const status = await api({ method: 'GET', pathname: '/api/status', searchParams: new URLSearchParams(), isLocal: false });
  assert.equal(status.body.kakao, true);
  assert.equal(status.body.keySource, 'secret');
  assert.equal(status.body.canEditKey, false);
  assert.equal(status.body.detailBatch, 4);
  assert.ok(!JSON.stringify(status.body).includes('a1b2c3d4e5f60718293a4b5c6d7e8f90'), '키 전체는 화면에 보내지 않음');
  const set = await api({ method: 'POST', pathname: '/api/kakao-key', searchParams: new URLSearchParams(), readBody: async () => ({ key: 'x' }), isLocal: true });
  assert.equal(set.status, 404);
});

test('Cloudflare 방식: 요청마다 서비스를 새로 만들어도 메뉴 저장본은 같이 쓴다', async () => {
  const config = baseConfig({ KAKAO_REST_API_KEY: 'k', KAKAO_PLACE_API_BASE: 'http://place.test' });
  const caches = createSharedCaches(config);
  let hits = 0;
  const fetchImpl = async () => {
    hits++;
    return new Response(panel);
  };
  const place = { id: 'kakao:10185787', kakaoId: '10185787', name: '칼국수', category: '음식점 > 한식', lat: 37.56, lng: 126.98 };
  for (let i = 0; i < 2; i++) {
    const services = createServices(config, { fetchImpl, caches });
    const api = createApi({ config, getServices: () => services, keySource: 'secret' });
    const r = await api({ method: 'POST', pathname: '/api/details', searchParams: new URLSearchParams(), readBody: async () => ({ places: [place] }), isLocal: false });
    assert.equal(r.body.results['kakao:10185787'].price.amount, 10000);
  }
  assert.equal(hits, 1, '두 번째 요청은 저장본 사용');
});
