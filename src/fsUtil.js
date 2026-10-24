// Node.js 전용: 파일 읽기·쓰기와 디스크 캐시
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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

/** createCache 의 persist 로 쓰는 폴더 저장소 */
export function fileCacheStore(dir, namespace) {
  const folder = path.join(dir, namespace);
  fs.mkdirSync(folder, { recursive: true });
  const fileFor = (key) => path.join(folder, crypto.createHash('sha1').update(String(key)).digest('hex') + '.json');
  return {
    read(key) {
      try {
        return JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
      } catch {
        return null;
      }
    },
    write(key, entry) {
      fs.writeFileSync(fileFor(key), JSON.stringify(entry));
    },
  };
}
