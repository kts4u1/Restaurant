// 착한가격업소(행정안전부·지자체 공공데이터) 읽기와 식당 매칭
// 지자체마다 CSV 컬럼 구성이 달라서 컬럼 이름으로 자동 인식한다.
import { distanceMeters } from './geo.js';
import { normalizeName } from './util.js';
import { parsePrice } from './pricing.js';

/** CSV 바이트 → 문자열 (UTF-8 이 아니면 EUC-KR/CP949 로 읽는다) */
export function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buffer);
  }
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const NON_FOOD = /미용|이용|이발|세탁|목욕|사우나|숙박|모텔|여관|노래|PC|피씨|헬스|네일|사진|수선|기타서비스|서비스업/i;

function findCol(header, re) {
  return header.findIndex((h) => re.test(h));
}

/** "김치찌개 8,000원, 된장찌개 8000" 처럼 한 칸에 메뉴와 가격이 같이 적힌 경우 */
function parseMenuText(text) {
  const out = [];
  const re = /([^\d,/|·]+?)\s*[:：]?\s*(\d{1,3}(?:,\d{3})+|\d{4,6})\s*원?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].trim();
    if (name) out.push({ name, price: parsePrice(m[2]) });
  }
  return out;
}

/** 짧은 고유 ID 용 해시 (FNV-1a, 두 번 돌려 12자리) */
function hashText(text) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 12);
}

/** CSV 행들 → 착한가격업소 목록 */
export function rowsToEntries(rows, { sourceName = '' } = {}) {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.replace(/\s/g, '').trim());
  const col = {
    name: findCol(header, /^(업소명|업소명칭|상호|상호명|업체명|가게명|업소)$/),
    road: findCol(header, /도로명/),
    address: findCol(header, /^(주소|소재지|소재지주소|지번주소|업소주소|주소지|소재지\(지번\)|지번)$/),
    anyAddress: findCol(header, /주소|소재지/),
    lat: findCol(header, /위도|latitude|^y좌표$/i),
    lng: findCol(header, /경도|longitude|^x좌표$/i),
    industry: findCol(header, /업종|분류|업태/),
    phone: findCol(header, /전화|연락처/),
    date: findCol(header, /기준일|데이터기준|지정일/),
    sido: findCol(header, /^시도(명)?$/),
    sigungu: findCol(header, /^시군(구)?(명)?$/),
  };
  if (col.name < 0) throw new Error(`업소명 컬럼을 찾지 못했습니다 (컬럼: ${header.join(', ')})`);

  // 메뉴1/가격1, 메뉴2/가격2 ... 쌍 찾기
  const pairs = [];
  header.forEach((h, i) => {
    const m = h.match(/^(메뉴|품목|대표메뉴|주요품목|취급품목|품목명|메뉴명)(\d*)$/);
    if (!m) return;
    const n = m[2];
    const priceIdx = header.findIndex((p) => new RegExp(`^(가격|금액|요금|판매가격|가격\\(원\\))${n}$`).test(p));
    pairs.push({ menu: i, price: priceIdx });
  });

  const entries = [];
  for (const r of rows.slice(1)) {
    const get = (i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
    const name = get(col.name);
    if (!name) continue;
    const industry = get(col.industry);
    if (industry && NON_FOOD.test(industry)) continue;

    const menus = [];
    for (const p of pairs) {
      const menuText = get(p.menu);
      if (!menuText) continue;
      const price = parsePrice(get(p.price));
      if (price) menus.push({ name: menuText, price });
      else menus.push(...parseMenuText(menuText));
    }

    let address = get(col.road) || get(col.address) || get(col.anyAddress);
    const prefix = [get(col.sido), get(col.sigungu)].filter(Boolean).join(' ');
    if (prefix && address && !address.startsWith(prefix.split(' ')[0])) address = `${prefix} ${address}`;
    const lat = parseFloat(get(col.lat));
    const lng = parseFloat(get(col.lng));
    const id = 'gp:' + hashText(`${normalizeName(name)}|${address}`);
    entries.push({
      id,
      name,
      address,
      lat: Number.isFinite(lat) && lat > 30 && lat < 40 ? lat : null,
      lng: Number.isFinite(lng) && lng > 120 && lng < 135 ? lng : null,
      industry,
      menus,
      phone: get(col.phone),
      date: get(col.date) || null,
      source: sourceName,
    });
  }
  return entries;
}

function districtOf(address) {
  const tokens = String(address || '').split(/\s+/);
  return tokens.filter((t) => /(시|군|구)$/.test(t)).slice(0, 2).join(' ');
}

function roadOf(address) {
  const m = String(address || '').match(/([가-힣0-9.]+(?:로|길))\s*(\d+(?:-\d+)?)/);
  return m ? `${m[1]} ${m[2]}` : '';
}

export function createGoodPriceIndex(entries = []) {
  const byName = new Map();
  const grid = new Map();
  const cellKey = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
  for (const e of entries) {
    const key = normalizeName(e.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(e);
    if (e.lat != null && e.lng != null) {
      const k = cellKey(e.lat, e.lng);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(e);
    }
  }

  /** 좌표가 있는 업소 중 반경 안의 것 */
  function nearby(lat, lng, radius) {
    const out = [];
    const span = Math.ceil(radius / 900) + 1;
    const baseLat = Math.floor(lat * 100);
    const baseLng = Math.floor(lng * 100);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        for (const e of grid.get(`${baseLat + i},${baseLng + j}`) || []) {
          if (distanceMeters(lat, lng, e.lat, e.lng) <= radius) out.push(e);
        }
      }
    }
    return out;
  }

  /** 검색된 식당과 같은 착한가격업소 찾기 */
  function match(place) {
    const key = normalizeName(place.name);
    for (const e of byName.get(key) || []) {
      if (e.lat != null && place.lat != null) {
        if (distanceMeters(place.lat, place.lng, e.lat, e.lng) <= 200) return e;
        continue;
      }
      const road = roadOf(e.address);
      if (road && (roadOf(place.address) === road || roadOf(place.jibunAddress) === road)) return e;
      const district = districtOf(e.address);
      if (district && districtOf(place.address || place.jibunAddress) === district) return e;
    }
    // 이름이 조금 다른 경우(예: "OO식당" vs "OO") 가까운 곳에서만 찾는다
    if (key.length >= 2 && place.lat != null) {
      for (const e of nearby(place.lat, place.lng, 60)) {
        const ek = normalizeName(e.name);
        if (ek.length >= 2 && (ek.includes(key) || key.includes(ek))) return e;
      }
    }
    return null;
  }

  return { match, nearby, size: entries.length };
}
