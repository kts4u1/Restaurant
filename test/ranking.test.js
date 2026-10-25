import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { qualityScore, valueScore, isTasty, comparator } from '../public/ranking.js';
import { parsePlaceDetail } from '../src/providers/kakaoPlace.js';

test('카카오맵 평점·리뷰 읽기 (실제 응답 형식)', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url)));
  assert.deepEqual(parsePlaceDetail(fixture).rating, { score: 3.7, count: 36, blog: 72, taste: 7, value: 1 });
  assert.equal(parsePlaceDetail({ menu: {} }).rating, null);
});

test('리뷰 2개짜리 5.0 보다 리뷰 300개짜리 4.5 가 맛집', () => {
  const few = { score: 5.0, count: 2, blog: 0, taste: 2 };
  const many = { score: 4.5, count: 300, blog: 200, taste: 120 };
  assert.ok(qualityScore(many) > qualityScore(few));
  assert.equal(isTasty(many), true);
  assert.equal(isTasty(few), false, '리뷰가 너무 적으면 맛집 표시 안 함');
  assert.equal(qualityScore(null), null);
});

const place = (name, amount, rating, distance = 100) => ({ name, rating, distance, price: { amount, isEstimate: false } });

test('정렬: 싼 곳 / 맛집 / 가성비', () => {
  const list = [
    place('싼데 평범', 4000, { score: 3.4, count: 40, blog: 5, taste: 2 }),
    place('비싼 맛집', 15000, { score: 4.6, count: 400, blog: 300, taste: 200 }),
    place('적당한 맛집', 8000, { score: 4.4, count: 150, blog: 80, taste: 70, value: 30 }),
    place('평점 없음', 3000, null),
  ];
  const names = (mode) => [...list].sort(comparator(mode)).map((p) => p.name);
  assert.deepEqual(names('price'), ['평점 없음', '싼데 평범', '적당한 맛집', '비싼 맛집']);
  assert.deepEqual(names('tasty'), ['비싼 맛집', '적당한 맛집', '싼데 평범', '평점 없음'], '평점 없는 곳은 맨 뒤');
  assert.equal(names('value')[0], '적당한 맛집', '평 좋고 적당히 싼 곳이 가성비 1위');
  assert.ok(valueScore(list[2].rating, 8000) > valueScore(list[1].rating, 15000));
});
