import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePrice, servingsFromName, isMealItem, cheapestMeal, analyzeMenu, createEstimator, resolvePrice } from '../src/pricing.js';
import { classify } from '../src/categories.js';

test('가격 문자열 읽기', () => {
  assert.equal(parsePrice(8000), 8000);
  assert.equal(parsePrice('8,000원'), 8000);
  assert.equal(parsePrice(' 12,500 '), 12500);
  assert.equal(parsePrice('1.2만원'), 12000);
  assert.equal(parsePrice('8,000~10,000'), 8000);
  assert.equal(parsePrice('시가'), null);
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice(0), null);
  assert.equal(parsePrice(null), null);
});

test('몇 인분인지 이름에서 읽기', () => {
  assert.equal(servingsFromName('부대찌개 2인'), 2);
  assert.equal(servingsFromName('아구찜 소(2~3인)'), 2);
  assert.equal(servingsFromName('1인 세트'), 1);
  assert.equal(servingsFromName('김치찌개'), 1);
  assert.equal(servingsFromName('10인치 피자'), 1);
});

test('최소 주문 인원 표기는 나누지 않는다', () => {
  assert.equal(servingsFromName('쫀득한치회덮밥 (2인 이상)'), 1);
  assert.equal(servingsFromName('뼈없는닭갈비(1인분)(2인분부터)'), 1);
  assert.equal(servingsFromName('국물 떡도리탕 (3~4인)'), 3);
  assert.equal(servingsFromName('닭갈비점심세트 A(2인)'), 2);
});

test('실제 메뉴판 사례: 사이드·낱개·무게당 가격은 한 끼가 아니다', () => {
  const pick = (items, context = '') => cheapestMeal(items.map(([name, price]) => ({ name, price })), { context })?.name ?? null;
  // 회전초밥/초밥집: 낱개(1ea, 1p) 가격
  assert.equal(pick([['연어 초밥(1ea)', 1800], ['새도로 초밥(1ea)', 2000], ['특미초밥(12pcs)', 12000]], '음식점 > 일식 > 초밥,롤 은행골'), '특미초밥(12pcs)');
  assert.equal(pick([['생연어(1p)', 1900], ['계란초밥', 2000], ['문어(1p)', 3500]], '음식점 > 일식 > 초밥,롤 스시로'), null);
  // 마라탕 100g 당 가격
  assert.equal(pick([['마라탕 (100g)', 2200], ['마라샹궈 (100g)', 3600]], '음식점 > 중식 마라탕'), null);
  // 냉면집 만두·반접시
  assert.equal(pick([['손만두2알', 3800], ['손만두', 11000], ['떡만두국', 12000], ['물냉면', 13000]], '음식점 > 한식 > 냉면 함흥면옥'), '떡만두국');
  assert.equal(pick([['찐만두 (반접시)', 6000], ['찐만두', 10000], ['만두국', 11000]], '음식점 > 한식 > 냉면 강남면옥'), '만두국');
  // 만두 전문점의 만두는 식사
  assert.equal(pick([['만두(포장가능)', 11000], ['칼국수', 12000]], '음식점 > 분식 명동교자'), '만두(포장가능)');
  // 닭갈비집 볶음밥 추가와 사리
  assert.equal(
    pick(
      [['장인볶음밥(김치+날치알)', 3000], ['모듬사리(치즈+떡+당면or라면 택1)', 7500], ['뼈없는닭갈비(1인분)(2인분부터)', 13000], ['닭갈비점심세트 A(2인)', 26000]],
      '음식점 > 한식 > 육류,고기 > 닭요리 장인닭갈비',
    ),
    '뼈없는닭갈비(1인분)(2인분부터)',
  );
  // 베트남 식당 짜조·월남쌈
  assert.equal(pick([['짜죠2pcs(4쪽)', 6000], ['고이꾸온(월남쌈)', 9000], ['짜죠5pcs(10쪽)', 12000], ['퍼보(소고기쌀국수)', 12900]], '음식점 > 아시아음식 리틀하노이'), '퍼보(소고기쌀국수)');
  // 패스트푸드 사이드
  assert.equal(pick([['맥너겟(4조각)', 2600], ['후렌치 후라이', 2300], ['치즈버거', 3500]], '음식점 > 패스트푸드'), '치즈버거');
  // 갈비집의 이상하게 싼 곁들이(육회 1인) – 같은 가게 메뉴 대비 너무 쌈
  assert.equal(
    pick([['한우육회(1인)', 3200], ['돼지갈비정식(점심특선)', 15000], ['차돌박이정식', 17000], ['숯불삼겹살(1인)', 19000], ['LA갈비정식', 28000], ['한우갈비살(1인)', 43000]], '음식점 > 한식 > 육류,고기 > 갈비'),
    '돼지갈비정식(점심특선)',
  );
  // 고깃집의 싼 점심 식사는 지킨다
  assert.equal(pick([['김치찌개', 7000], ['삼겹살', 16000], ['목살', 16000], ['갈비', 18000], ['항정살', 18000], ['차돌', 20000]], '음식점 > 한식 > 육류,고기'), '김치찌개');
  // 분식집 김밥은 한 끼, 다방 음료·주먹밥은 아님
  assert.equal(pick([['원조김밥', 3500], ['라면', 5000], ['돈까스', 9000], ['제육덮밥', 9000], ['오므라이스', 8500]], '음식점 > 분식 김밥천국'), '원조김밥');
  assert.equal(pick([['쿨다방(파인애플)', 2000], ['김가루 주먹밥', 2500], ['아이스티(복숭아)', 2500], ['불향차돌떡볶이', 20000]], '음식점 > 분식 > 떡볶이 청년다방'), '불향차돌떡볶이');
  // 사이드: 계란찜, 튀김, 후식냉면
  assert.equal(pick([['폭탄계란찜', 7000], ['모듬튀김 4종', 4500], ['후식냉면', 4000], ['된장찌개', 8000]], '음식점 > 한식'), '된장찌개');
});

test('실제 강남역 메뉴판 사례 (Cloudflare 배포 후 확인)', () => {
  const pick = (items, context = '') => cheapestMeal(items.map(([name, price]) => ({ name, price })), { context })?.name ?? null;
  // 회전초밥 색깔 접시
  assert.equal(pick([['빨강접시', 2900], ['보라접시', 3700], ['소우동', 3800]], '음식점 > 일식 > 초밥,롤 갓덴스시'), null);
  // 닭갈비집 추가 재료와 사리
  assert.equal(
    pick([['떡볶이떡', 2500], ['소세지', 4000], ['모둠사리(모짜렐라치즈+떡+당면or라면)2인', 7500], ['닭갈비(1인분)', 14000]], '음식점 > 한식 > 육류,고기 > 닭요리 장인닭갈비'),
    '닭갈비(1인분)',
  );
  // 고깃집 된장찌개 4,000원은 고기 주문 후 추가, 막창집 라면도
  assert.equal(pick([['된장찌개(순한,매운맛)', 4000], ['물냉면', 12000], ['전설 삼겹살(200g)', 22000]], '음식점 > 한식 > 육류,고기 우대갈비'), '물냉면');
  assert.equal(pick([['라면', 4000], ['가마솥된장찌개', 6000], ['열무김치말이국수', 8000]], '음식점 > 한식 > 육류,고기 > 곱창,막창 달구막창'), '열무김치말이국수');
  // 쭈꾸미집 볶음밥(2인) 9,000원 = 1인 4,500원 → 추가 메뉴, 점심 찌개 9,000원은 식사
  assert.equal(pick([['된장찌개', 9000], ['쭈꾸미볶음밥(2인)', 9000], ['쭈꾸미불낙 (1인)', 12000]], '음식점 > 한식 > 해물,생선 다미 쭈꾸미'), '된장찌개');
  // 분식집 떡볶이 컵·꼬마김밥은 간식, 라멘집 교자는 사이드
  assert.equal(pick([['떡볶이 컵', 2500], ['순대 양념컵', 2800], ['꼬마유부김밥', 3500], ['컵밥', 3900], ['야채김밥', 4000]], '음식점 > 분식'), '컵밥');
  assert.equal(pick([['된장찌개', 9000], ['쭈꾸미볶음밥(2인)', 9000]], '음식점 > 한식 > 해물,생선 다미'), '된장찌개');
  assert.equal(pick([['튀김교자', 4500], ['돈코츠라멘', 10000]], '음식점 > 일식 > 일본식라면'), '돈코츠라멘');
  // 도시락집 고로케는 곁들이
  assert.equal(pick([['뉴 감자고로케', 2700], ['치킨마요', 3900], ['돈치킨', 4900]], '음식점 > 도시락 > 한솥도시락'), '치킨마요');
  // 해물칼국수집 칼국수는 그대로 식사
  assert.equal(pick([['바지락칼국수', 6000], ['해물파전', 15000]], '음식점 > 한식 > 국수 > 칼국수 해물칼국수'), '바지락칼국수');
});

test('식사가 아닌 메뉴는 뺀다', () => {
  for (const name of ['공기밥', '공깃밥', '라면사리', '콜라', '소주', '생맥주 500cc', '치즈 추가', '계란후라이', '어린이 뷔페', '포장용기', '핫초코 / 아이스초코', '미숫가루', '아이스 말차', '카라멜 마끼아또', '유자차']) {
    assert.equal(isMealItem(name), false, name);
  }
  for (const name of ['김치찌개', '칼국수(포장불가능)', '돈까스 정식(음료 포함)', '한식뷔페 성인', '프라이드치킨', '쌈밥', '라면']) {
    assert.equal(isMealItem(name), true, name);
  }
});

test('가장 싼 한 끼 메뉴 고르기', () => {
  const best = cheapestMeal([
    { name: '공기밥', price: 1000 },
    { name: '콜라', price: 2000 },
    { name: '김치찌개', price: 9000 },
    { name: '된장찌개', price: '8,500원' },
    { name: '부대찌개 2인', price: 16000 },
    { name: '어린이 돈까스', price: 6000 },
    { name: '단무지', price: 500 },
  ]);
  assert.deepEqual(best, { name: '부대찌개 2인', price: 8000, rawPrice: 16000, servings: 2 });
  const { rows } = analyzeMenu([{ name: '공기밥', price: 1000 }, { name: '김치찌개', price: 9000 }, { name: '오늘의 메뉴' }]);
  assert.deepEqual(rows.map((r) => r.reason), ['추가·음료 메뉴', null, '가격 없음']);
  assert.equal(cheapestMeal([{ name: '콜라', price: 2000 }]), null);
  assert.equal(cheapestMeal([]), null);
  assert.equal(cheapestMeal(undefined), null);
});

test('실제 카카오맵 메뉴(명동칼국수남문교자)에서 최저가', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/kakao-panel3.json', import.meta.url)));
  const best = cheapestMeal(fixture.menu.menus.items);
  assert.equal(best.price, 10000);
  assert.ok(['왕만두 (한접시/6알)', '칼국수', '만두국', '냉모밀'].includes(best.name));
});

test('업종별 추정 가격', () => {
  const estimates = JSON.parse(fs.readFileSync(new URL('../data/price-estimates.json', import.meta.url)));
  const estimate = createEstimator(estimates);
  assert.equal(estimate('음식점 > 분식 > 김밥', '김밥천국').price, 3800);
  assert.equal(estimate('음식점 > 한식', 'OO기사식당').price, 9500);
  assert.equal(estimate('음식점 > 뷔페 > 한식뷔페', '오늘뷔페').price, 9000);
  assert.equal(estimate('음식점 > 뷔페 > 해산물뷔페', '바다뷔페').price, 30000);
  assert.equal(estimate('음식점 > 중식 > 중국요리', '홍콩반점').price, 7700);
  assert.equal(estimate('음식점 > 한식 > 해물,생선 > 회', '바다횟집').price, 25000);
  assert.equal(estimate('음식점 > 한식', '평양면옥 회관').price, 10000);
  assert.equal(estimate('', '').price, 11000);
});

test('가격 출처 우선순위: 직접 입력 > 메뉴 > 착한가격업소 > 추정', () => {
  const estimate = { price: 9000, label: '추정' };
  const menuItems = [{ name: '백반', price: 8000 }];
  const goodprice = { menus: [{ name: '김치찌개', price: 7000 }], date: '2026-05-26' };
  assert.equal(resolvePrice({ userPrice: { price: 6500, menu: '점심특선' }, menuItems, goodprice, estimate }).source, 'user');
  assert.equal(resolvePrice({ menuItems, goodprice, estimate }).source, 'menu');
  const gp = resolvePrice({ menuItems: [], goodprice, estimate });
  assert.equal(gp.source, 'goodprice');
  assert.equal(gp.amount, 7000);
  assert.equal(gp.updatedAt, '2026-05-26');
  const est = resolvePrice({ estimate });
  assert.equal(est.source, 'estimate');
  assert.equal(est.isEstimate, true);
});

test('식당 분류', () => {
  assert.equal(classify('음식점 > 한식 > 기사식당', '성산기사식당').key, 'driver');
  assert.equal(classify('음식점 > 한식', '돼지불백 기사식당').key, 'driver');
  assert.equal(classify('음식점 > 뷔페 > 한식뷔페', '엄마손뷔페').key, 'koreanBuffet');
  assert.equal(classify('음식점 > 술집 > 일본식주점', '이자카야 하루').key, 'bar');
  assert.equal(classify('음식점 > 간식 > 제과,베이커리', '파리바게뜨').key, 'dessert');
  assert.equal(classify('음식점 > 분식', '명동교자').key, 'bunsik');
  assert.equal(classify('음식점 > 한식 > 국수 > 칼국수', '칼국수집').key, 'korean');
  assert.equal(classify('음식점 > 일식 > 돈까스,우동', '돈까스집').key, 'japanese');
  assert.equal(classify('음식점', '그냥식당').key, 'etc');
  assert.equal(classify('음식점', '인생주점').key, 'bar');
});

test('식당 분류: 카페, 샐러드, 구체적인 카테고리 우선', () => {
  assert.equal(classify('음식점 > 카페 > 커피전문점 > 투썸플레이스', '투썸플레이스 명동점').key, 'dessert');
  assert.equal(classify('음식점 > 샐러드', '샐러디').key, 'salad');
  assert.equal(classify('음식점 > 한식 > 국수 > 칼국수', '명동우동칼국수').key, 'korean');
  assert.equal(classify('음식점 > 한식', '본도시락 명동점').key, 'lunchbox');
  assert.equal(classify('음식점 > 양식 > 햄버거', '프랭크버거').key, 'fastfood');
});
