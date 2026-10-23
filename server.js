import http from 'node:http';
import os from 'node:os';
import { loadConfig } from './src/config.js';
import { buildServices, createHandler } from './src/app.js';

const config = loadConfig();
const services = buildServices(config);
const server = http.createServer(createHandler(config, services));

server.listen(config.port, config.host, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${config.port}`);
  console.log('\n🍚 한끼 최저가 찾기 서버가 시작되었습니다');
  console.log(`   이 컴퓨터에서:  http://localhost:${config.port}`);
  if (lan.length) console.log(`   같은 와이파이의 휴대폰에서: ${lan.join(', ')}`);
  console.log(
    `   장소 데이터: ${services.kakao ? '카카오 로컬 API' : 'OpenStreetMap (카카오 키 없음 - .env 에 KAKAO_REST_API_KEY 를 넣으면 훨씬 정확합니다)'}`,
  );
  console.log(`   카카오맵 메뉴 가격: ${services.placeDetail.enabled ? '사용' : '끔'}`);
  console.log(`   착한가격업소 데이터: ${services.goodprice.size}곳\n`);
});
