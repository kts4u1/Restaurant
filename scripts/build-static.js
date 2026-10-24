#!/usr/bin/env node
// GitHub Actions 용: areas.json 의 지역 식당·메뉴 가격을 public/data/ 에 저장한다.
//   KAKAO_REST_API_KEY=키 node scripts/build-static.js
import path from 'node:path';
import { loadConfig, ROOT } from '../src/config.js';
import { buildStatic, readAreas } from '../src/staticBuild.js';

const config = loadConfig();
try {
  const areas = readAreas(path.join(ROOT, 'areas.json'));
  const index = await buildStatic({ config, areas, outDir: path.join(ROOT, 'public', 'data') });
  const total = index.areas.reduce((n, a) => n + a.count, 0);
  console.log(`\n완료: 지역 ${index.areas.length}곳, 식당 ${total}곳 → public/data/`);
} catch (err) {
  console.error(`\n✖ ${err.message}`);
  process.exit(1);
}
