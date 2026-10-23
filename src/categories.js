// 식당 분류: 카카오 카테고리 문자열("음식점 > 한식 > 국밥")과 상호명으로 그룹을 정한다.

export const GROUPS = [
  { key: 'driver', label: '기사식당', test: /기사식당/ },
  { key: 'cafeteria', label: '구내식당', test: /구내식당|사내식당|학생식당|함바/ },
  { key: 'koreanBuffet', label: '한식뷔페', test: /한식\s*뷔페|한식\s*부페/ },
  { key: 'buffet', label: '뷔페', test: /뷔페|부페|buffet/i },
  { key: 'bunsik', label: '분식·김밥', test: /분식|김밥|떡볶이|주먹밥/ },
  { key: 'lunchbox', label: '도시락', test: /도시락/ },
  { key: 'fastfood', label: '패스트푸드', test: /패스트푸드|햄버거|버거|샌드위치|토스트|핫도그|fast_food|burger|sandwich/i },
  { key: 'chinese', label: '중식', test: /중식|중국요리|중화요리|짜장|짬뽕|마라|chinese/i },
  { key: 'japanese', label: '일식', test: /일식|초밥|스시|돈까스|돈가스|우동|라멘|소바|덮밥|japanese|sushi|ramen/i },
  { key: 'asian', label: '아시안', test: /아시아|베트남|쌀국수|태국|인도음식|동남아|멕시칸|vietnamese|thai|indian|asian|mexican/i },
  { key: 'western', label: '양식', test: /양식|이탈리안|파스타|피자|스테이크|브런치|western|italian|pizza|pasta|steak/i },
  { key: 'chicken', label: '치킨', test: /치킨|닭강정|chicken/i },
  { key: 'salad', label: '샐러드', test: /샐러드|포케|salad|poke/i },
  { key: 'meat', label: '고기·구이', test: /육류|고기|삼겹|갈비|곱창|막창|족발|보쌈|bbq|barbecue/i },
  { key: 'seafood', label: '해물·회', test: /해물|생선|횟집|생선회|조개|아구|장어|seafood|fish/i },
  { key: 'korean', label: '한식', test: /한식|백반|국밥|해장국|찌개|국수|칼국수|냉면|설렁탕|곰탕|korean/i },
];

const BAR = { key: 'bar', label: '술집' };
const DESSERT = { key: 'dessert', label: '카페·간식' };
const ETC = { key: 'etc', label: '기타' };

/** 기본 검색에서 빼는 그룹 (한 끼 식사가 아닌 곳) */
export const NON_MEAL_GROUPS = new Set(['bar', 'dessert']);

export function classify(category = '', name = '') {
  const parts = String(category)
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean);
  const level2 = parts[1] || '';
  const text = `${category} ${name}`;

  // 기사식당/구내식당/뷔페는 상호명에만 표시된 경우가 많아 먼저 본다
  for (const g of GROUPS.slice(0, 4)) {
    if (g.test.test(text)) return { key: g.key, label: g.label };
  }
  const generic = parts.length <= 1;
  if (level2 === '술집' || /요리주점|호프|포차|이자카야|와인바|^bar$|^pub$/i.test(parts.at(-1) || '')) return BAR;
  if (generic && /주점|호프|포차|이자카야|와인바|맥주|펍$|\bpub\b|\bbar\b/i.test(name)) return BAR;
  if (level2 === '간식' || level2 === '카페' || /제과|베이커리|아이스크림|도넛|디저트|빙수|커피|bakery|ice_cream|dessert|cafe|coffee/i.test(category)) {
    return DESSERT;
  }
  const find = (str) => GROUPS.slice(4).find((g) => g.test.test(str));
  // 카테고리가 구체적이면(3단계 이상) 카테고리를 믿고, 대략적이면 상호명을 먼저 본다
  const byCategory = find(category);
  const g = parts.length >= 3 && byCategory ? byCategory : find(name) || byCategory;
  return g ? { key: g.key, label: g.label } : ETC;
}

export function groupLabel(key) {
  if (key === BAR.key) return BAR.label;
  if (key === DESSERT.key) return DESSERT.label;
  return GROUPS.find((g) => g.key === key)?.label || ETC.label;
}
