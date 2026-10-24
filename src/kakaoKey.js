// 앱 화면에서 넣은 카카오 키를 확인하고 .env 파일에 저장한다
import fs from 'node:fs';
import { createKakaoLocal } from './providers/kakaoLocal.js';

// 카카오 REST API 키는 영문·숫자 32자리다 (줄바꿈 등이 .env 에 들어가지 않게 형식을 확인)
export function isValidKeyFormat(key) {
  return /^[A-Za-z0-9]{20,64}$/.test(key);
}

export function maskKey(key) {
  return key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '';
}

/** .env 의 KAKAO_REST_API_KEY 줄만 바꾸고 나머지 설정은 그대로 둔다 */
export function writeEnvKey(envFile, key, templateFile) {
  let text = '';
  if (fs.existsSync(envFile)) text = fs.readFileSync(envFile, 'utf8');
  else if (templateFile && fs.existsSync(templateFile)) text = fs.readFileSync(templateFile, 'utf8');
  const line = `KAKAO_REST_API_KEY=${key}`;
  if (/^KAKAO_REST_API_KEY=.*$/m.test(text)) text = text.replace(/^KAKAO_REST_API_KEY=.*$/m, line);
  else text = `${text.replace(/\s*$/, '')}${text ? '\n' : ''}${line}\n`;
  fs.writeFileSync(envFile, text);
}

/**
 * 카카오에 실제로 한 번 물어봐서 키가 맞는지 확인한다.
 * 키가 틀리면 오류, 카카오맵 사용 설정이 꺼져 있으면 저장은 하되 안내를 돌려준다.
 */
export async function verifyKey(key, { baseUrl, fetchImpl = fetch }) {
  const kakao = createKakaoLocal({ apiKey: key, baseUrl, fetchImpl });
  try {
    await kakao.geocode('서울시청');
    return { warning: null };
  } catch (err) {
    if (err.status === 401) throw Object.assign(new Error(err.message), { status: 400 });
    if (err.status === 403) return { warning: err.message };
    return { warning: `카카오에 연결해 키를 확인하지 못했습니다. 저장은 했으니 검색해 보세요. (${err.message})` };
  }
}
