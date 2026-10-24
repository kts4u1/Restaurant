// PC 에서 켜는 Node.js 서버: 화면 파일 + /api, 앱 화면에서 카카오 키 저장
import fs from 'node:fs';
import path from 'node:path';
import { createServices } from './services.js';
import { createApi, httpError, maskKey } from './api.js';
import { fileCacheStore, readJsonFile } from './fsUtil.js';
import { isValidKeyFormat, verifyKey, writeEnvKey } from './kakaoKey.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 512 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, '잘못된 요청 형식입니다.');
  }
}

/** 설정값으로 서비스 구성 (data/ 파일과 디스크 캐시 사용) */
export function buildServices(config, { fetchImpl = fetch } = {}) {
  return createServices(config, {
    fetchImpl,
    estimates: readJsonFile(path.join(config.dataDir, 'price-estimates.json'), {}),
    goodpriceEntries: readJsonFile(path.join(config.dataDir, 'goodprice.json'), []),
    detailCachePersist: fileCacheStore(config.cacheDir, 'kakao-place'),
  });
}

// 이 컴퓨터에서 직접 연 요청인지 (터널·프록시를 거쳐 들어온 요청은 주소가 127.0.0.1 이어도 외부로 본다)
const isLocalRequest = (req) => {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)) return false;
  const h = req.headers || {};
  if (h['x-forwarded-for'] || h['x-forwarded-host'] || h['cf-connecting-ip'] || h['forwarded'] || h['x-real-ip']) return false;
  const host = String(h.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1'].includes(host);
};

/**
 * @param {object} options
 * @param {(key: string) => object} [options.rebuild] 새 카카오 키로 서비스를 다시 만든다
 * @param {Function} [options.fetchImpl]
 */
export function createHandler(config, initialServices, { rebuild, fetchImpl = fetch } = {}) {
  let services = initialServices;
  const publicDir = path.resolve(config.publicDir);

  const setKey = rebuild
    ? async (key) => {
        if (!isValidKeyFormat(key)) {
          throw httpError(400, '키 형식이 맞지 않습니다. 카카오 개발자 사이트의 [앱 키]에서 "REST API 키"를 그대로 복사해 붙여넣어 주세요.');
        }
        const { warning } = await verifyKey(key, { baseUrl: config.kakaoApiBase, fetchImpl });
        writeEnvKey(config.envFile, key, config.envTemplate);
        config.kakaoRestKey = key;
        services = rebuild(key);
        return { ok: true, keyMasked: maskKey(key), warning };
      }
    : null;
  const api = createApi({ config, getServices: () => services, setKey, keySource: 'local' });

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, '허용되지 않는 요청입니다.');
    let rel;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw httpError(400, '잘못된 주소입니다.');
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(publicDir, '.' + rel);
    if (!file.startsWith(publicDir + path.sep)) throw httpError(403, '접근할 수 없습니다.');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw httpError(404, '파일이 없습니다.');
    }
    if (!stat.isFile()) throw httpError(404, '파일이 없습니다.');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const { status, body } = await api({
          method: req.method,
          pathname: url.pathname,
          searchParams: url.searchParams,
          readBody: () => readBody(req),
          isLocal: isLocalRequest(req),
        });
        sendJson(res, status, body);
      } else serveStatic(req, res, url);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[오류]', err);
      if (!res.headersSent) sendJson(res, status, { error: err.message || '서버 오류' });
      else res.end();
    }
  };
}
