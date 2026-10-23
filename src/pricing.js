// 메뉴 목록에서 "한 끼 식사"로 볼 수 있는 가장 싼 메뉴를 고르고,
// 여러 가격 출처(직접 입력 > 카카오맵 메뉴 > 착한가격업소 > 업종 추정) 중 하나를 정한다.

export const SOURCE_LABELS = {
  user: '직접 확인',
  menu: '카카오맵 메뉴',
  goodprice: '착한가격업소',
  estimate: '추정',
};

// 식사가 아닌 메뉴: 추가 메뉴, 음료, 주류, 디저트
const NON_MEAL =
  /공기\s*밥|공깃밥|^밥$|추가|사리$|곱빼기|후식|음료|콜라|사이다|환타|스프라이트|탄산|생수|소주|맥주|생맥|병맥|막걸리|동동주|와인|하이볼|사케|청하|주류|위스키|칵테일|커피|아메리카노|라떼|에이드|주스|쥬스|스무디|아이스티|밀크티|쉐이크|셰이크|프라푸치노|프라페|핫초코|아이스초코|미숫가루|말차|녹차|마[끼키]아[또토]|카페\s*모카|카푸치노|에스프레소|콜드\s*브루|요거트|요구르트|우유|두유|식혜|수정과|레모네이드|라씨|(?:유자|생강|녹|홍|보이|레몬|자몽|매실|대추|쌍화|허브|보리|옥수수)차$|디저트|아이스크림|빙수|츄러스|와플|케이크|쿠키|마카롱|푸딩|타르트|크로플|소프트콘|토핑|포장\s*(?:용기|비)|용기|배달|반찬|셀프|쿠폰|옵션/;
// 곁들이는 사이드 메뉴
const SIDE =
  /반접시|반공기|계란\s*[후프]라이|달걀\s*[후프]라이|에그\s*프라이|계란(?:찜|말이|지짐이?)$|달걀(?:찜|말이)$|튀김(?:\s*\d+\s*종)?$|^(?:오뎅|어묵)$|^(?:찰|모듬)?순대$|핫도그|너겟|감자\s*튀김|후렌치|프렌치\s*프라이|포테이토|해[시쉬]\s*브라운|치즈\s*스틱|콘\s*샐러드|코울슬로|사이드|짜조|짜죠|춘권|스프링\s*롤|월남쌈|고이꾸온|짜사이|자차이|냉채|황과|단무지|^김치$/;
// 세트/정식은 "음료 포함" 같은 문구가 있어도 식사로 본다
const MEAL_SET = /세트|정식|코스|백반|set/i;
// 이름만 봐도 한 끼 식사인 메뉴 (상대 가격 비교에서 보호)
const MEAL_WORDS =
  /찌개|국밥|정식|백반|점심|특선|런치|lunch|국수|칼국수|수제비|냉면|덮밥|비빔밥|볶음밥|라면|김밥|우동|소바|라멘|짜장|짬뽕|쌀국수|파스타|스파게티|리조또|버거|샌드위치|토스트|도시락|돈까스|돈가스|카레|오므라이스|뷔페|세트|탕$|국$|밥$|면$/i;
// 성인 1인 기준이 아닌 가격(뷔페 어린이 요금 등)
const NOT_ADULT = /어린이|유아|아동|키즈|초등|미취학|소인|청소년|중고생|경로|kids?/i;
// 낱개 가격: "(1ea)", "2알", "4pcs", "3조각" → 8개 미만이면 한 끼가 아니다
const PIECES = /(\d+)\s*(?:알|개|조각|피스|pcs?|ps|ea|p|점|쪽)(?![a-z가-힣])/i;
// 무게 가격: "(100g)" → 120g 이하는 100g당 가격
const GRAMS = /(\d+)\s*g(?![a-z])/i;
// 만두 한 접시(만두국·만두라면 제외)는 만두 전문점이 아니면 곁들이 메뉴
const DUMPLING_PLATE = /만두$/;
const DUMPLING_SHOP = /만두|교자|딤섬|dumpling/i;
// 주먹밥도 주먹밥 전문점이 아니면 곁들이 메뉴
const RICEBALL = /주먹밥$/;
const ADDON_RICE = /볶음밥|볶음면|치즈밥|날치알밥|김가루밥|마요밥/;

export const MIN_MEAL_PRICE = 2500;
const ADDON_RICE_MAX = 4500;
const RELATIVE_FLOOR = 0.5;

export function parsePrice(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  if (typeof value !== 'string') return null;
  const s = value.replace(/\s/g, '');
  const m = s.match(/(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(만)?/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]) n *= 10000;
  return n > 0 ? Math.round(n) : null;
}

/**
 * "2인분", "2~3인 세트" 같은 이름에서 몇 명 분량인지 (최소값 기준).
 * "(2인 이상)", "(2인분부터)"는 최소 주문 인원이라 1인 가격 그대로다.
 */
export function servingsFromName(name) {
  for (const m of String(name || '').matchAll(/(\d+)\s*(?:[~\-∼]\s*\d+\s*)?인(?!치)(?:분)?\s*(이상|부터)?/g)) {
    if (m[2]) continue;
    const n = parseInt(m[1], 10);
    return n >= 2 && n <= 10 ? n : 1;
  }
  return 1;
}

const stripBrackets = (name) =>
  String(name || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 메뉴 하나가 한 끼 식사인지 이름과 가격만으로 판단한다.
 * @returns {string|null} 식사가 아니면 그 이유
 */
export function nonMealReason(name, price, context = '') {
  const full = String(name || '');
  const cleaned = stripBrackets(full);
  if (!cleaned) return '이름 없음';
  if (NOT_ADULT.test(full)) return '어린이·할인 요금';
  if (!MEAL_SET.test(cleaned)) {
    if (NON_MEAL.test(cleaned)) return '추가·음료 메뉴';
    if (SIDE.test(cleaned)) return '사이드 메뉴';
    const pieces = full.match(PIECES);
    if (pieces && Number(pieces[1]) < 8) return '낱개 가격';
    const grams = full.match(GRAMS);
    if (grams && Number(grams[1]) <= 120) return '무게당 가격';
    if (DUMPLING_PLATE.test(cleaned) && !DUMPLING_SHOP.test(context)) return '사이드 메뉴';
    if (RICEBALL.test(cleaned) && !/주먹밥/.test(context)) return '사이드 메뉴';
    if (ADDON_RICE.test(cleaned) && price && price < ADDON_RICE_MAX) return '추가 메뉴';
  }
  return null;
}

/** 이전 버전 호환: 이름만으로 식사인지 */
export function isMealItem(name, context = '') {
  return nonMealReason(name, null, context) === null;
}

/**
 * 메뉴 전체를 보고 각 메뉴가 한 끼인지 표시하고 가장 싼 한 끼를 고른다.
 * @param {{name:string, price:any}[]} items
 * @param {{context?: string, minPrice?: number}} options context = "카테고리 상호명"
 */
export function analyzeMenu(items, { context = '', minPrice = MIN_MEAL_PRICE } = {}) {
  const rows = (items || []).map((item) => {
    const name = String(item?.name ?? '').trim();
    const rawPrice = parsePrice(item?.price);
    const servings = servingsFromName(name);
    const perPerson = rawPrice ? Math.round(rawPrice / servings / 10) * 10 : null;
    let reason = rawPrice ? nonMealReason(name, rawPrice, context) : '가격 없음';
    if (!reason && perPerson < minPrice) reason = '너무 싼 곁들이 메뉴';
    return { name, rawPrice, servings, perPerson, reason };
  });

  // 같은 가게 메뉴 중 하위 25% 가격의 절반보다 싼 메뉴는(식사 이름이 아니면) 곁들이로 본다.
  // 예) 갈비집의 육회(1인) 3,200원, 다방의 음료 2,000원
  const candidates = rows.filter((r) => !r.reason);
  if (candidates.length >= 5) {
    const sorted = candidates.map((r) => r.perPerson).sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    for (const r of candidates) {
      if (r.perPerson < q1 * RELATIVE_FLOOR && !MEAL_WORDS.test(stripBrackets(r.name))) r.reason = '곁들이 메뉴로 추정';
    }
  }

  let best = null;
  for (const r of rows) {
    if (!r.reason && (!best || r.perPerson < best.price)) {
      best = { name: r.name, price: r.perPerson, rawPrice: r.rawPrice, servings: r.servings };
    }
  }
  return { rows, best };
}

/**
 * @returns {{name:string, price:number, rawPrice:number, servings:number} | null}
 *   price = 1인 가격
 */
export function cheapestMeal(items, options = {}) {
  return analyzeMenu(items, options).best;
}

export function createEstimator(estimates) {
  const rules = (estimates?.rules || []).map((r) => ({ ...r, re: new RegExp(r.match, 'i') }));
  const fallback = estimates?.default || { price: 11000, label: '일반 식사' };
  return function estimate(category = '', name = '') {
    const text = `${category} ${name}`;
    const rule = rules.find((r) => r.re.test(text)) || fallback;
    return { price: rule.price, label: rule.label, note: rule.note || '' };
  };
}

/**
 * 가격 출처를 하나로 정한다.
 * @returns {{amount:number, menuName:string, source:string, sourceLabel:string,
 *   updatedAt:string|null, servings:number, rawPrice:number, isEstimate:boolean}}
 */
export function resolvePrice({ userPrice, menuItems, menuUpdatedAt, goodprice, estimate, context = '' }) {
  const make = (source, amount, menuName, updatedAt = null, servings = 1, rawPrice = amount) => ({
    amount,
    menuName,
    source,
    sourceLabel: SOURCE_LABELS[source],
    updatedAt,
    servings,
    rawPrice,
    isEstimate: source === 'estimate',
  });

  if (userPrice && parsePrice(userPrice.price)) {
    return make('user', parsePrice(userPrice.price), userPrice.menu || '직접 입력한 가격', userPrice.updatedAt);
  }
  const fromMenu = cheapestMeal(menuItems, { context });
  if (fromMenu) {
    return make('menu', fromMenu.price, fromMenu.name, menuUpdatedAt || null, fromMenu.servings, fromMenu.rawPrice);
  }
  const fromGood = goodprice ? cheapestMeal(goodprice.menus, { context }) : null;
  if (fromGood) {
    return make('goodprice', fromGood.price, fromGood.name, goodprice.date || null, fromGood.servings, fromGood.rawPrice);
  }
  return { ...make('estimate', estimate.price, estimate.label), note: estimate.note || '' };
}
