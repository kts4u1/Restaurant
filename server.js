import http from 'node:http';
import os from 'node:os';
import { exec } from 'node:child_process';
import { loadConfig } from './src/config.js';
import { buildServices, createHandler } from './src/app.js';

const config = loadConfig();
const services = buildServices(config);
// 앱 화면에서 카카오 키를 넣으면 서버를 다시 켜지 않고 바로 적용한다
const rebuild = (key) => buildServices({ ...config, kakaoRestKey: key });
const server = http.createServer(createHandler(config, services, { rebuild }));

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠ ${config.port}번 포트를 이미 쓰고 있습니다. 앱이 이미 켜져 있을 수 있어요 → http://localhost:${config.port}`);
    console.error('  다른 창에 켜져 있는 서버를 끄고(Ctrl+C) 다시 실행해 주세요.\n');
    process.exit(1);
  }
  throw err;
});

server.listen(config.port, config.host, () => {
  const local = `http://localhost:${config.port}`;
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${config.port}`);
  console.log('\n🍚 한끼 최저가 찾기 서버가 시작되었습니다');
  console.log(`   이 컴퓨터에서:  ${local}`);
  if (lan.length) console.log(`   같은 와이파이의 휴대폰에서: ${lan.join(', ')}`);
  console.log(
    `   장소 데이터: ${services.kakao ? '카카오 로컬 API' : 'OpenStreetMap (카카오 키 없음 - 앱 화면 맨 위에서 키를 넣어 주세요)'}`,
  );
  console.log(`   카카오맵 메뉴 가격: ${services.placeDetail.enabled ? '사용' : '끔'}`);
  console.log(`   착한가격업소 데이터: ${services.goodprice.size}곳`);
  console.log('   끄려면 이 창에서 Ctrl+C\n');

  // 실행 파일(start-windows.bat / start-mac.command)로 켜면 브라우저를 자동으로 연다
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${local}"` : process.platform === 'darwin' ? `open "${local}"` : `xdg-open "${local}"`;
    exec(cmd, () => {});
  }
});
