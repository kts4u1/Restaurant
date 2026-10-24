// Vercel 함수용: 함수 인스턴스마다 한 번만 서비스를 만든다
import { loadConfig } from './config.js';
import { buildServices, createHandler } from './app.js';

let handler = null;

export default function vercelHandler(req, res) {
  if (!handler) {
    const config = loadConfig();
    handler = createHandler(config, buildServices(config));
  }
  return handler(req, res);
}
