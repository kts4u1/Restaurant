// Node.js 와 Cloudflare Workers 양쪽에서 쓰는 도구 (파일 시스템을 쓰지 않는다)

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

/**
 * 메모리 캐시. persist 를 주면 디스크 같은 곳에도 저장한다 (값은 JSON 직렬화 가능해야 한다).
 * persist = { read(key) => entry|null, write(key, entry) }
 */
export function createCache({ ttlMs, persist = null }) {
  const memory = new Map();

  function read(key) {
    const now = Date.now();
    const hit = memory.get(key);
    if (hit) {
      if (hit.expires > now) return hit;
      memory.delete(key);
    }
    const entry = persist?.read(key);
    if (entry && entry.expires > now) {
      memory.set(key, entry);
      return entry;
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
      try {
        persist?.write(key, entry);
      } catch {
        // 저장 실패는 무시 (메모리 캐시는 유지)
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

export async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
