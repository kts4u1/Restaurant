#!/usr/bin/env node
// 착한가격업소 CSV(공공데이터포털에서 받은 파일)를 앱 데이터로 가져온다.
//
//   node scripts/import-goodprice.js 받은파일1.csv 받은파일2.csv ...
//   node scripts/import-goodprice.js --geocode 받은파일.csv   (좌표 없는 업소는 주소로 좌표 찾기)
//   node scripts/import-goodprice.js --reset 받은파일.csv     (기존 데이터를 지우고 새로)
//
// 결과는 data/goodprice.json 에 합쳐서 저장된다.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { decodeCsv, parseCsv, rowsToEntries } from '../src/goodprice.js';
import { createKakaoLocal } from '../src/providers/kakaoLocal.js';
import { createOsm } from '../src/providers/osm.js';
import { readJsonFile, writeJsonFile } from '../src/util.js';

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const geocode = args.includes('--geocode');
const reset = args.includes('--reset');

if (!files.length) {
  console.log(`사용법: node scripts/import-goodprice.js [--geocode] [--reset] 파일.csv ...

공공데이터포털(data.go.kr)에서 "착한가격업소"로 검색해 CSV 파일을 받은 뒤 실행하세요.
--geocode : 위도/경도가 없는 업소를 주소로 좌표 변환 (카카오 키가 있으면 카카오, 없으면 OpenStreetMap)
--reset   : 기존 data/goodprice.json 을 비우고 새로 만듭니다`);
  process.exit(1);
}

const config = loadConfig();
const outFile = path.join(config.dataDir, 'goodprice.json');
const existing = reset ? [] : readJsonFile(outFile, []);
const byId = new Map(existing.map((e) => [e.id, e]));

let added = 0;
for (const file of files) {
  const text = decodeCsv(fs.readFileSync(file));
  const entries = rowsToEntries(parseCsv(text), { sourceName: path.basename(file) });
  for (const e of entries) {
    if (!byId.has(e.id)) added++;
    byId.set(e.id, { ...byId.get(e.id), ...e, lat: e.lat ?? byId.get(e.id)?.lat ?? null, lng: e.lng ?? byId.get(e.id)?.lng ?? null });
  }
  console.log(`✔ ${path.basename(file)}: 음식점 ${entries.length}곳 읽음`);
}

if (geocode) {
  const geocoder = config.kakaoRestKey
    ? createKakaoLocal({ apiKey: config.kakaoRestKey, baseUrl: config.kakaoApiBase })
    : createOsm({ overpassUrls: [], nominatimUrl: config.nominatimUrl, userAgent: config.userAgent });
  const missing = [...byId.values()].filter((e) => e.lat == null && e.address);
  console.log(`좌표 찾는 중: ${missing.length}곳 (${config.kakaoRestKey ? '카카오' : 'OpenStreetMap - 1초에 1곳'})`);
  let ok = 0;
  for (const [i, e] of missing.entries()) {
    try {
      const [hit] = await geocoder.geocode(e.address);
      if (hit) {
        e.lat = hit.lat;
        e.lng = hit.lng;
        ok++;
      }
    } catch {
      // 다음 업소로
    }
    if (!config.kakaoRestKey) await new Promise((r) => setTimeout(r, 1100));
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${missing.length}`);
  }
  console.log(`✔ 좌표 ${ok}곳 찾음`);
}

const all = [...byId.values()];
writeJsonFile(outFile, all);
const withCoords = all.filter((e) => e.lat != null).length;
console.log(`\n저장 완료: ${outFile}\n  전체 ${all.length}곳 (새로 추가 ${added}곳), 좌표 있음 ${withCoords}곳`);
if (withCoords < all.length) {
  console.log('  ※ 좌표가 없는 업소는 지도 검색 결과와 이름·주소가 같을 때만 연결됩니다. --geocode 옵션을 쓰면 더 많이 연결됩니다.');
}
