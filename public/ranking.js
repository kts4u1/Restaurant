// 정렬 기준: 가격순 / 맛집순 / 가성비순 (화면과 테스트에서 같이 쓴다)

// 리뷰가 적은 곳의 평점은 전체 평균(3.6) 쪽으로 당겨서 본다 (리뷰 2개짜리 5.0 이 앞서지 않게)
export const PRIOR_SCORE = 3.6;
const PRIOR_WEIGHT = 8;

/** 맛집 점수: 평점(리뷰 수 반영) + 인기(리뷰·블로그 수) + "맛" 추천 비율 */
export function qualityScore(rating) {
  if (!rating || (!rating.count && !rating.blog)) return null;
  const n = rating.count || 0;
  const avg = rating.score ?? PRIOR_SCORE;
  const bayes = (PRIOR_SCORE * PRIOR_WEIGHT + avg * n) / (PRIOR_WEIGHT + n);
  const popularity = Math.log10(1 + n + (rating.blog || 0) / 3); // 0 ~ 약 3
  const taste = n ? Math.min(1, (rating.taste || 0) / n) : 0;
  return bayes + 0.12 * popularity + 0.25 * taste;
}

// 리뷰가 없어 맛을 모르는 곳은 가성비에서 평균보다 낮게 본다
const UNKNOWN_SCORE = 3.2;

/** 가성비 점수: 맛집 점수에서, 1인 가격이 8천원보다 2배 비쌀 때마다 0.9점씩 뺀다 */
export function valueScore(rating, price) {
  const q = qualityScore(rating) ?? UNKNOWN_SCORE;
  const valueShare = rating?.count ? Math.min(1, (rating.value || 0) / rating.count) : 0;
  return q + 0.3 * valueShare - 0.9 * Math.log2(Math.max(price || 0, 1000) / 8000);
}

/** 맛집 표시: 리뷰 10개 이상이고 점수가 높은 곳 */
export function isTasty(rating) {
  const q = qualityScore(rating);
  return q != null && (rating.count || 0) >= 10 && q >= 4.1;
}

export const SORTS = {
  price: '가격순',
  tasty: '맛집순',
  value: '가성비순',
};

/** 정렬 함수. 모두 같은 점수면 싼 곳 → 확인된 가격 → 가까운 곳 순 */
export function comparator(mode) {
  const byPrice = (a, b) =>
    a.price.amount - b.price.amount || Number(a.price.isEstimate) - Number(b.price.isEstimate) || a.distance - b.distance;
  if (mode === 'tasty') {
    return (a, b) => {
      const qa = qualityScore(a.rating);
      const qb = qualityScore(b.rating);
      if (qa == null && qb == null) return byPrice(a, b);
      if (qa == null) return 1; // 평점 없는 곳은 뒤로
      if (qb == null) return -1;
      return qb - qa || byPrice(a, b);
    };
  }
  if (mode === 'value') {
    return (a, b) => valueScore(b.rating, b.price.amount) - valueScore(a.rating, a.price.amount) || byPrice(a, b);
  }
  return byPrice;
}
