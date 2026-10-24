// PC(Node.js) 용 설정: .env 파일을 읽고 폴더 경로를 붙인다
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseConfig } from './configCore.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// .env 파일이 있으면 읽는다 (Node 20.12+ 내장 기능)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env 가 없어도 동작한다
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  return {
    ...baseConfig(env),
    envFile: path.join(ROOT, '.env'),
    envTemplate: path.join(ROOT, '.env.example'),
    dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
    cacheDir: env.CACHE_DIR || path.join(ROOT, '.cache'),
    publicDir: path.join(ROOT, 'public'),
    ...overrides,
  };
}
