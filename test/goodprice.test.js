import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsv, parseCsv, rowsToEntries, createGoodPriceIndex } from '../src/goodprice.js';

test('CSV 읽기: 따옴표, 쉼표, 줄바꿈', () => {
  const rows = parseCsv('a,b,c\r\n"1,000","x ""y""",3\n\n4,5,6');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1,000', 'x "y"', '3'],
    ['4', '5', '6'],
  ]);
});

test('CSV 인코딩: UTF-8(BOM) 과 EUC-KR 모두 읽기', () => {
  const utf8 = Buffer.from('﻿업소명,주소\n김밥집,서울', 'utf8');
  assert.equal(decodeCsv(utf8).split('\n')[0], '업소명,주소');
  // "업소명" 을 EUC-KR 로 쓴 바이트
  const euckr = Buffer.from([0xbe, 0xf7, 0xbc, 0xd2, 0xb8, 0xed]);
  assert.equal(decodeCsv(euckr), '업소명');
});

test('지자체 형식 1 (위도·경도 있음, 가평군 형식)', () => {
  const csv = [
    '업소명,도로명주소,소재지주소,위도,경도,업종,메뉴1,가격1,메뉴2,가격2,메뉴3,가격3,전화번호,데이터기준일자',
    '가평식당,경기도 가평군 가평읍 가화로 1,경기도 가평군 가평읍 읍내리 1,37.8315,127.5105,한식,김치찌개,8000,된장찌개,8000,,,031-000-0000,2026-05-26',
    '가평미용실,경기도 가평군 가평읍 가화로 2,,37.83,127.51,미용업,커트,10000,,,,,,2026-05-26',
  ].join('\n');
  const entries = rowsToEntries(parseCsv(csv));
  assert.equal(entries.length, 1, '미용업은 뺀다');
  const e = entries[0];
  assert.equal(e.name, '가평식당');
  assert.equal(e.address, '경기도 가평군 가평읍 가화로 1');
  assert.equal(e.lat, 37.8315);
  assert.equal(e.lng, 127.5105);
  assert.deepEqual(e.menus, [
    { name: '김치찌개', price: 8000 },
    { name: '된장찌개', price: 8000 },
  ]);
  assert.equal(e.date, '2026-05-26');
});

test('지자체 형식 2 (좌표 없음, 시도/시군 따로, 장수군 형식)', () => {
  const csv = [
    '시도,시군,업종,업소명,연락처,주소,메뉴1,가격1,메뉴2,가격2,메뉴3,가격3',
    '전북특별자치도,장수군,한식_일반,장수밥상,063-000-0000,장수읍 군청길 1,백반,"7,000",,,,',
    '전북특별자치도,장수군,목욕업,장수탕,,장수읍 1,목욕,7000,,,,',
  ].join('\n');
  const entries = rowsToEntries(parseCsv(csv));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].address, '전북특별자치도 장수군 장수읍 군청길 1');
  assert.equal(entries[0].lat, null);
  assert.deepEqual(entries[0].menus, [{ name: '백반', price: 7000 }]);
});

test('메뉴와 가격이 한 칸에 있는 형식', () => {
  const csv = ['상호,소재지,품목', '할매국수,서울 중구 퇴계로 1,"잔치국수 5,000원, 비빔국수 6000원"'].join('\n');
  const [e] = rowsToEntries(parseCsv(csv));
  assert.deepEqual(e.menus, [
    { name: '잔치국수', price: 5000 },
    { name: '비빔국수', price: 6000 },
  ]);
});

test('업소명 컬럼이 없으면 알려준다', () => {
  assert.throws(() => rowsToEntries(parseCsv('a,b\n1,2')), /업소명 컬럼/);
});

test('검색된 식당과 착한가격업소 연결', () => {
  const index = createGoodPriceIndex([
    { id: 'gp:1', name: '할매 국수', address: '서울 중구 퇴계로 10', lat: 37.5605, lng: 126.982, menus: [{ name: '잔치국수', price: 5000 }] },
    { id: 'gp:2', name: '장수밥상', address: '전북특별자치도 장수군 장수읍 군청길 1', lat: null, lng: null, menus: [] },
    { id: 'gp:3', name: '명동 백반', address: '서울 중구 명동길 5', lat: 37.5637, lng: 126.9836, menus: [] },
  ]);
  // 이름 같고 좌표 가까움
  assert.equal(index.match({ name: '할매국수', lat: 37.5606, lng: 126.9821, address: '' })?.id, 'gp:1');
  // 이름 같지만 멀리 떨어진 다른 가게
  assert.equal(index.match({ name: '할매국수', lat: 37.6, lng: 127.0, address: '' }), null);
  // 좌표 없는 업소는 도로명/시군구로 연결
  assert.equal(index.match({ name: '장수밥상', lat: 35.64, lng: 127.52, address: '전북특별자치도 장수군 장수읍 군청길 1' })?.id, 'gp:2');
  // 이름이 조금 달라도(“식당” 붙음) 아주 가까우면 연결
  assert.equal(index.match({ name: '명동백반식당', lat: 37.5637, lng: 126.9836, address: '' })?.id, 'gp:3');
  // 반경 안 업소
  assert.deepEqual(
    index.nearby(37.5636, 126.9826, 400).map((e) => e.id).sort(),
    ['gp:1', 'gp:3'],
  );
});
