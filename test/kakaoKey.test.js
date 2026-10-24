import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../src/config.js';
import { buildServices, createHandler } from '../src/app.js';
import { writeEnvKey, isValidKeyFormat, maskKey } from '../src/kakaoKey.js';

const GOOD = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const DISABLED = 'ffffffffffffffffffffffffffffffff';

function fakeFetch(url, opts = {}) {
  const auth = opts.headers?.Authorization || '';
  if (auth === `KakaoAK ${GOOD}`) return Promise.resolve(new Response(JSON.stringify({ documents: [], meta: { total_count: 0, is_end: true } })));
  if (auth === `KakaoAK ${DISABLED}`) {
    return Promise.resolve(new Response(JSON.stringify({ message: 'App(1) disabled OPEN_MAP_AND_LOCAL service.' }), { status: 403 }));
  }
  return Promise.resolve(new Response(JSON.stringify({ message: 'wrong appKey' }), { status: 401 }));
}

let server, base, tmp, config;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hankki-key-'));
  fs.copyFileSync(new URL('../data/price-estimates.json', import.meta.url), path.join(tmp, 'price-estimates.json'));
  fs.writeFileSync(path.join(tmp, '.env.example'), '# 설명\nKAKAO_REST_API_KEY=\nPORT=3000\n');
  config = loadConfig({
    kakaoRestKey: '',
    kakaoApiBase: 'http://kakao.test',
    dataDir: tmp,
    cacheDir: path.join(tmp, 'cache'),
    envFile: path.join(tmp, '.env'),
    envTemplate: path.join(tmp, '.env.example'),
  });
  const services = buildServices(config, { fetchImpl: fakeFetch });
  const rebuild = (key) => buildServices({ ...config, kakaoRestKey: key }, { fetchImpl: fakeFetch });
  server = http.createServer(createHandler(config, services, { rebuild, fetchImpl: fakeFetch }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const status = async () => (await fetch(base + '/api/status')).json();
const saveKey = async (key) => {
  const res = await fetch(base + '/api/kakao-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
  return { status: res.status, body: await res.json() };
};

test('키 형식 확인과 가리기', () => {
  assert.equal(isValidKeyFormat(GOOD), true);
  assert.equal(isValidKeyFormat('abc'), false);
  assert.equal(isValidKeyFormat(`${GOOD}\nPORT=1`), false, '.env 에 다른 줄을 끼워 넣을 수 없음');
  assert.equal(maskKey(GOOD), 'a1b2…8f90');
});

test('.env 파일: 키 줄만 바꾸고 다른 설정은 유지', () => {
  const file = path.join(tmp, 'x.env');
  fs.writeFileSync(file, 'PORT=4000\nKAKAO_REST_API_KEY=old\nMAX_PLACES=100\n');
  writeEnvKey(file, GOOD);
  assert.equal(fs.readFileSync(file, 'utf8'), `PORT=4000\nKAKAO_REST_API_KEY=${GOOD}\nMAX_PLACES=100\n`);
  const fresh = path.join(tmp, 'y.env');
  writeEnvKey(fresh, GOOD);
  assert.equal(fs.readFileSync(fresh, 'utf8'), `KAKAO_REST_API_KEY=${GOOD}\n`);
});

test('앱 화면에서 키 넣기: 형식 오류 → 틀린 키 → 맞는 키', async () => {
  let s = await status();
  assert.equal(s.kakao, false);
  assert.equal(s.canEditKey, true);

  const bad = await saveKey('복사 잘못함');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /REST API 키/);

  const wrong = await saveKey('0123456789abcdef0123456789abcdef');
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /올바르지 않습니다/);
  assert.equal(fs.existsSync(config.envFile), false, '틀린 키는 저장하지 않음');

  const ok = await saveKey(GOOD);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.warning, null);
  assert.match(fs.readFileSync(config.envFile, 'utf8'), new RegExp(`^KAKAO_REST_API_KEY=${GOOD}$`, 'm'));
  assert.match(fs.readFileSync(config.envFile, 'utf8'), /^PORT=3000$/m, '.env.example 내용을 바탕으로 만듦');
  s = await status();
  assert.equal(s.kakao, true, '서버를 다시 켜지 않아도 바로 적용');
  assert.equal(s.keyMasked, 'a1b2…8f90');
});

test('카카오맵 사용 설정이 꺼진 키는 저장하고 안내', async () => {
  const r = await saveKey(DISABLED);
  assert.equal(r.status, 200);
  assert.match(r.body.warning, /카카오맵\(로컬\) 사용 설정/);
});
