const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** 두 좌표 사이의 직선 거리(m) */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 중심과 반경을 감싸는 사각형 */
export function boxAround(lat, lng, radius) {
  const dLat = (radius / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(toRad(lat));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/** 사각형을 4등분 */
export function splitBox(box) {
  const midLat = (box.minLat + box.maxLat) / 2;
  const midLng = (box.minLng + box.maxLng) / 2;
  return [
    { minLat: box.minLat, maxLat: midLat, minLng: box.minLng, maxLng: midLng },
    { minLat: box.minLat, maxLat: midLat, minLng: midLng, maxLng: box.maxLng },
    { minLat: midLat, maxLat: box.maxLat, minLng: box.minLng, maxLng: midLng },
    { minLat: midLat, maxLat: box.maxLat, minLng: midLng, maxLng: box.maxLng },
  ];
}

/** 사각형이 원(중심, 반경)과 겹치는지 */
export function boxIntersectsCircle(box, lat, lng, radius) {
  const nearLat = Math.min(Math.max(lat, box.minLat), box.maxLat);
  const nearLng = Math.min(Math.max(lng, box.minLng), box.maxLng);
  return distanceMeters(lat, lng, nearLat, nearLng) <= radius;
}

export function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}
