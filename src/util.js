import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 동시에 실행되는 작업 수를 제한한다 */
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/** 메모리 + 파일 캐시 (값은 JSON 직렬화 가능해야 한다) */
export function createCache({ dir, namespace, ttlMs, memoryOnly = false }) {
  const memory = new Map();
  const folder = dir ? path.join(dir, namespace) : null;
  if (folder && !memoryOnly) fs.mkdirSync(folder, { recursive: true });

  const fileFor = (key) =>
    path.join(folder, crypto.createHash('sha1').update(String(key)).digest('hex') + '.json');

  function read(key) {
    const now = Date.now();
    const hit = memory.get(key);
    if (hit) {
      if (hit.expires > now) return hit;
      memory.delete(key);
    }
    if (!folder || memoryOnly) return null;
    try {
      const entry = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
      if (entry.expires > now) {
        memory.set(key, entry);
        return entry;
      }
    } catch {
      // 캐시 파일 없음
    }
    return null;
  }

  return {
    get(key) {
      const entry = read(key);
      return entry ? entry.value : undefined;
    },
    /** 값과 저장 시각을 함께 돌려준다 */
    getEntry(key) {
      return read(key);
    },
    set(key, value, customTtlMs = ttlMs) {
      const entry = { value, savedAt: Date.now(), expires: Date.now() + customTtlMs };
      memory.set(key, entry);
      if (memory.size > 5000) memory.delete(memory.keys().next().value);
      if (folder && !memoryOnly) {
        try {
          fs.writeFileSync(fileFor(key), JSON.stringify(entry));
        } catch {
          // 디스크 저장 실패는 무시 (메모리 캐시는 유지)
        }
      }
    },
  };
}

/** 한글 이름 비교용 정규화: 공백/특수문자 제거, 소문자 */
export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜/g, '')
    .replace(/[\s\-_.,·•'"`()[\]{}<>/\\|!?~@#$%^&*+=:;]/g, '');
}

export function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
