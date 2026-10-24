// GitHub Actions 에서 실행: areas.json 의 지역마다 식당과 메뉴 가격을 모아 정적 데이터 파일로 저장한다.
// 카카오 키는 Actions 시크릿에만 있고, 만들어진 사이트(휴대폰 화면)에는 들어가지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { buildServices } from './app.js';

export const MAX_AREA_RADIUS = 3000;

/** 화면에서 쓰는 값만 남긴다 (파일 크기 줄이기) */
export function slimPlace(p) {
  return {
    id: p.id,
    kakaoId: p.kakaoId,
    name: p.name,
    category: p.category,
    group: p.group,
    groupLabel: p.groupLabel,
    phone: p.phone || undefined,
    address: p.address,
    lat: Math.round(p.lat * 1e6) / 1e6,
    lng: Math.round(p.lng * 1e6) / 1e6,
    url: p.url,
    provider: p.provider,
    goodprice: p.goodprice ? { name: p.goodprice.name, date: p.goodprice.date } : null,
    price: p.price,
    menu: (p.menu || []).map((m) => ({ name: m.name, price: m.price || null, meal: m.meal, note: m.note || undefined })),
    menuUpdatedAt: p.menuUpdatedAt || null,
    detailStatus: 'done',
  };
}

export function readAreas(file) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(json) ? json : json.areas;
  if (!Array.isArray(list) || !list.length) throw new Error(`${file} 에 지역(areas)이 없습니다.`);
  return list.map((a, i) => {
    const radius = Math.round(Number(a.radius) || 1500);
    if (radius < 100 || radius > MAX_AREA_RADIUS) throw new Error(`'${a.name}' 반경은 100~${MAX_AREA_RADIUS}m 로 넣어 주세요.`);
    if (!a.location && !(Number.isFinite(a.lat) && Number.isFinite(a.lng))) throw new Error(`'${a.name || i + 1}' 에 location(위치)이 없습니다.`);
    return { id: `a${i + 1}`, name: String(a.name || a.location), location: a.location || '', lat: a.lat, lng: a.lng, radius };
  });
}

export async function buildStatic({ config, areas, outDir, fetchImpl = fetch, log = console.log }) {
  if (!config.kakaoRestKey) {
    throw new Error('KAKAO_REST_API_KEY 가 없습니다. 저장소 Settings → Secrets and variables → Actions 에 넣어 주세요.');
  }
  const { kakao, service } = buildServices({ ...config, maxPlaces: 100000, kakaoMaxRequests: 3000 }, { fetchImpl });
  fs.mkdirSync(outDir, { recursive: true });
  const index = { generatedAt: new Date().toISOString(), areas: [] };

  for (const area of areas) {
    let { lat, lng } = area;
    let resolved = '';
    if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
      const [hit] = await kakao.geocode(area.location);
      if (!hit) throw new Error(`'${area.location}' 위치를 카카오에서 찾지 못했습니다. areas.json 을 고쳐 주세요.`);
      ({ lat, lng } = hit);
      resolved = `${hit.name} (${hit.address})`;
    }
    log(`▶ ${area.name}: ${resolved || `${lat},${lng}`} 반경 ${area.radius}m`);
    const found = await service.findPlaces({ lat, lng, radius: area.radius });
    for (const w of found.warnings) log(`  ⚠ ${w}`);
    if (found.provider !== 'kakao') throw new Error('카카오에서 식당 목록을 받지 못했습니다.');
    log(`  식당 ${found.places.length}곳, 메뉴 가격 확인 중…`);

    const places = [];
    for (let i = 0; i < found.places.length; i += 40) {
      const batch = found.places.slice(i, i + 40);
      const results = await service.details(batch);
      for (const p of batch) places.push(slimPlace(results[p.id] || p));
      if ((i / 40) % 10 === 9) log(`  ${Math.min(i + 40, found.places.length)}/${found.places.length}`);
    }
    const real = places.filter((p) => !p.price.isEstimate).length;
    const failed = found.places.length ? places.filter((p) => p.kakaoId && !p.menu.length).length : 0;
    log(`  ✔ 실제 가격 확인 ${real}곳 / 메뉴 정보 없음 ${failed}곳`);

    const file = `${area.id}.json`;
    fs.writeFileSync(path.join(outDir, file), JSON.stringify({ id: area.id, places }));
    index.areas.push({
      id: area.id,
      name: area.name,
      location: area.location,
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      radius: area.radius,
      count: places.length,
      realPriceCount: real,
      file,
    });
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}
